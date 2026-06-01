# TMWebDriver / `tmwd_slock_bridge` 问题清单

> 范围：当前生产用的 `tmwd_slock_bridge`（端口 28765，ws 客户端，主动连 master）。
> 写作日期：2026-06-01。
> 读者：接手维护/重写的其他 agent。
> 数据来源：直接读源码 `twd.py` / `tmwebdriver_core.py` / `tmwd_slock_bridge/*.js`，
> 端口与权限差异与 `tmwd_cdp_bridge`（已废弃，端口 18765）逐项对照。

---

## 0. TL;DR

- CLI（`twd.py`）→ `TMWebDriver.execute_js()` → ws 发 `{id, code, tabId}` → 扩展 `background.js` 的
  `ws.onmessage` 收到 → **协议层完全跑得通**：`cmd_cdp / cmd_screenshot / cmd_ext` 链路是**对的**，
  不存在"协议层错配"或"`data` 双剥"。
- **真问题集中在扩展层**：`content.js` 整条 DOM 桥**当前是死代码**（CLI 不走它），
  维护成本高、与 `background.js` 重复、还引入了 streamlit 跳过/CSP strip/全页面脚本注入三个副作用。
- CLI 层有 1 处脆弱假设：`unwrap_exec_result` 依赖 `len(r) <= 2`，扩字段就崩。

---

## 1. 仓库与协议栈（先建立共识）

```
slock-agent / twd.py (CLI)
    └─→ TMWebDriver.execute_js(json_str, session_id)
            └─→ ws.send({id, code:json_str, tabId})
                    └─→ 扩展 background.js ws.onmessage
                            ├─ code 是 JSON 字符串且含 cmd → handleExtMessage → handleCDP/handleTabs/handleGroups...
                            └─ code 是纯 JS 字符串       → handleWsExec → chrome.tabs.executeScript
                            └─ 回包: {type:'result'|'error', id, result: res.data ?? res.results ?? res}
                                    └─→ core.results[id] = {success, data, newTabs}
                                            └─→ execute_js 返回 {data, [newTabs]}
                                                    └─→ twd.unwrap_exec_result() 剥出 data
```

关键事实：
- 端口由 `TMWebDriver(port=…)` 决定；扩展 manifest 不写端口。slock_bridge 主动连 `ws://127.0.0.1:28765`（硬编码在 `background.js:291`）。
- 协议层三态分支（`background.js:441-457`）是**对的设计**，**之前的"协议层错配"判断是错的**，已修正。
- `unwrap_exec_result` 假设 `r ∈ {data:…, newTabs:?}` ≤ 2 字段（`twd.py:103-107`）。

---

## 2. 问题清单（按优先级）

### P0 — 必须修复

#### 2.1 `content.js` 整条 DOM 桥是死代码

**证据**：
- CLI 所有命令（`cmd_cdp / cmd_screenshot / cmd_ext / cmd_groups / cmd_eval / cmd_scan / cmd_input / cmd_click / cmd_snapshot / cmd_act / cmd_goto`）都走
  `driver.execute_js(json.dumps(cmd), session_id=…)` → 直接命中 `background.js` 的 `ws.onmessage`。
- `content.js` 的入参形式是监听 DOM 中 `id="__ljq_211b42"` 元素（`config.js` 暴露的 `TID`）的 `textContent` 变化。
  这要求"调用方先在页面里塞一个 `<div id=__ljq_211b42>{json}</div>`"，**CLI 不做这件事**。
- 没有人/没有调用方触发该 DOM 协议 → `content.js` 的 47 行代码 + 维护成本是纯负债。

**建议**：
- 短期：删 `content.js` + `config.js`（`popup.html/js` 另议），从 `manifest.json` content_scripts 中移除两条脚本。
- 长期：若未来真有"页面内 JS 直接调扩展"需求，再做一条**带鉴权 + schema 校验**的简化版，
  不要再写一个和 `background.js` 等价的 `handleCmdX` 分支。

#### 2.2 `content.js` 顶部无差别跳过 streamlit 页面

`content.js:1` `if (/streamlit/i.test(document.title)) return;`。
若 `app.slock.ai` 站点的 `document.title` 含 "Streamlit"（slock 看起来是 Streamlit 应用），
DOM 桥在 slock 页面**完全失效**。即便有人用 DOM 桥调 `slock.ai` 也会哑火。
这与 2.1 是同源问题（DOM 桥没人用），但作为 bug 单列出来是给"保留 DOM 桥"派的警告。

#### 2.3 `manifest.json` 的 `disable_dialogs.js` + CSP strip 是**全局副作用**

- `disable_dialogs.js` 注入到**所有 frame、document_start、MAIN world**（`manifest.json:21-29`）。
  它会劫持/抑制 `window.alert/confirm/prompt`，**对 slock 这种带原生气泡的页面是隐性破坏**。
- `background.js:6-23` 的 `declarativeNetRequest` 用 rule `8765` 改写响应头去掉 `Content-Security-Policy`，
  范围是**所有 URL**（manifest `host_permissions` 包含 `<all_urls>`）。
  这两个是为了让扩展本身能 `eval` / 注入主世界代码——但代价是污染所有站点的 CSP 策略。
- 对 slock 这类有严格 CSP 的站点，去 CSP 后可能让 slock 自身的某些内联脚本原本被挡的行为突然放行，
  行为不可预测。

**建议**：
- 把 `host_permissions` / `declarativeNetRequest` 规则收窄到 `https://app.slock.ai/*` 等明确白名单。
- `disable_dialogs.js` 改为按需注入（仅 `chrome.scripting.executeScript` 在特定 tab 调用时）。
- 这条与 2.1 是耦合的：删 `content.js` 后整组副作用自然消失。

### P1 — 应该修

#### 2.4 `twd.py:103-107 unwrap_exec_result` 脆弱假设

```python
def unwrap_exec_result(r):
    if isinstance(r, dict) and "data" in r and len(r) <= 2:
        return r["data"]
    return r
```

`core.execute_js` 实际包成 `{'data': …, [newTabs: …]}`（`tmwebdriver_core.py:262-265`），
所以 `len(r) <= 2` 是给 `newTabs` 留位置。但**任何第三字段**（如某天有人加 `error: None`、或扩展
回包 `result` 自带 `success`/`error` 字段经过 unwrap 之前的某层包装）就会**整段 fallthrough**，
上层拿到 `{data: …, error: 'xxx'}` 这样的双字段歧义对象。

**建议**：改成显式白名单：
```python
def unwrap_exec_result(r):
    if not isinstance(r, dict): return r
    if "newTabs" in r and set(r.keys()) <= {"data", "newTabs"}:
        return r["data"]
    return r
```

#### 2.5 `cmd_cdp` 错误路径下 `r` 形状可能误导

`cmd_screenshot` 在失败时打印 `err(..., result=r)`，但**没有把 r 标准化**。
`handleCDP` 失败时扩展回 `res = {ok:false, error:'xxx'}`，
`res.data` 为 `undefined` → 走 `res.data ?? res.results ?? res` → 落到整个 `res`。
`r` 实际是 `{ok:False, error:'xxx'}`，与"成功时 r 是 CDP 真实返回"形状不同。
当前 `r.get('data')` 走 `None` 分支所以没事，但**未来调用方依赖 `r['data']` 就会踩雷**。

**建议**：让 `cmd_screenshot` / `cmd_cdp` 在 `r.get('ok') is False` 时走错误分支，不依赖字段名猜测。

#### 2.6 `background.js:4` `onInstalled` 立即 `connectWS()` 但没等 master

扩展装上时 master 未必在跑。`scheduleProbe()` 5s 重试是预期行为，**不算 bug**。
但 `connectWS()` 内若抛同步异常（如 `new WebSocket` 在 chrome 某些版本下抛 `Error`），`onInstalled` listener
内未被 catch 会导致扩展"装上就崩"。**建议**在 `connectWS()` 顶部加 try/catch + 日志。

### P2 — 观测/治理

#### 2.7 `cdp_bridge` vs `slock_bridge` 双套实现的历史包袱

- `cdp_bridge` 是 ws server（master 主动连它），`slock_bridge` 是 ws client（它主动连 master）。
- 同一份 CLI 期望的协议行为相同（`{id, code, tabId}`），但**两份 background.js 各自维护**。
- 用户已删除 `tmwd_cdp_bridge_local`，但 `tmwd_cdp_bridge/` 目录代码可能仍在仓库。
  **建议**：确认 `tmwd_cdp_bridge/` 是否已删；若未删，与 `slock_bridge` diff 看看能否合一份。
  （注：cdp_bridge 没 `tabGroups` 权限，groups 协议合并会丢能力，需要先定 groups 是不是真废弃——参见 2.8。）

#### 2.8 `groups` 协议现状

- 用户在前几轮明确说"放弃 group 功能"（"应该是一改都会改错 先后退代码 放弃本次 group 功能"）。
- 但 `slock_bridge/manifest.json` 仍包含 `tabGroups` 权限，`background.js` 仍实现 `handleGroups`。
- 状态：CLI 侧是否有 `cmd_groups` 未在本轮确认（搜索 `twd.py` 中 `cmd_groups` 应能确认）。
  **建议**：要么彻底删 groups 相关（manifest 权限 + background.js 分支 + CLI），要么恢复使用——目前半成品是最大风险。

#### 2.9 `background.js` 体积过大 / 重复 cookie/cdp 处理

`background.js` 21975 字节，混了 ws 客户端 + ws 协议分发 + cookie 句柄 + cdp 句柄 + group 句柄 + tab 句柄 +
CSP 改写 + 连接管理 + 探针调度 + keepalive + tabs_update 推送。**建议**未来按职责拆成多个模块（即便 MV3 SW 不能直接
import，也可用 `importScripts`）。

---

## 3. 验证步骤（给其他 agent 的可执行 checklist）

不要直接相信本文件结论；请按以下顺序验证：

1. **协议链路**：
   ```bash
   python twd.py serve --port 28765   # 启 master
   # 浏览器加载 tmwd_slock_bridge，打开任意 https 页面
   python twd.py tabs                  # 应列出会话
   python twd.py cdp --method Page.captureScreenshot --tabId <id> --params '{}'  --out t.png
   python twd.py ext --tabId <id> --json '{"cmd":"groups","method":"list"}'
   ```
   期望：`cdp` 输出含 `data.format/data.data`；`ext groups` 输出列表。

2. **DOM 桥真的没被用**：
   ```bash
   grep -rn "__ljq_211b42\|TID" ../../      # 排除扩展自身
   ```
   期望：CLI / 其他 agent 代码无引用 → 证实 2.1。

3. **副作用影响范围**：
   ```bash
   # 在打开 https://app.slock.ai 后
   python twd.py eval --tabId <id> --script 'JSON.stringify({title:document.title, csp:document.querySelector("meta[http-equiv='Content-Security-Policy']")?.content})'
   ```
   期望：csp 字段为 `null`（被扩展 strip 了）——证实 2.3 真的在生效。

4. **groups 真死/活**：
   ```bash
   grep -n "cmd_groups\|def cmd_groups" twd.py
   ```
   期望：搜不到 → 2.8 现状。

---

## 4. 修复优先级建议

按"风险 × 收益"排序：
1. **删 `content.js` + `config.js` + 收窄 manifest 权限/规则**（一次干掉 2.1 / 2.2 / 2.3）
2. **改 `unwrap_exec_result` 为白名单**（2.4，5 行改动）
3. **标准化 `cmd_cdp / cmd_screenshot` 错误路径**（2.5）
4. **groups 协议二选一**（2.8）
5. cdp_bridge 处置（2.7）

---

## 5. 已知不在本任务范围

- `cdp_bridge` 整体功能保留/删除策略：用户已表态删除 `cdp_bridge_local`，本文件不重复决策。
- 把 `twd.py` 改造成"自带环境 + 真 CLI 工具"（用户曾要求但推迟）；那是另一个任务线。
- groups 协议能力本身是否恢复使用：等用户拍板。

---

## 6. 变更历史

- 2026-06-01：初版。基于直接读 `twd.py` / `tmwebdriver_core.py` / `tmwd_slock_bridge/*` 源码。
