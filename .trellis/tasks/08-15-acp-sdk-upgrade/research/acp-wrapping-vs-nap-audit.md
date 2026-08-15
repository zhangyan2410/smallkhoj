# ACP 封装逐项对比：smallkhoj vs agent-platform（NAP）

> H 项产出（2026-08-15）。NAP 源码：`/Users/code/project/agent-platform`
> （internal/acp-adapter/ + agents/{codex,goose,claude-code}）。
> 方法：对每个已发现问题在 NAP 找对应实现，判定「漏抄 / 双方都有 / 我们独有」，
> 并记录可抄的参考解法。

## 对比总表

| 维度 | NAP 做法 | 我们做法 | 判定 |
|---|---|---|---|
| 系统提示词注入 | **AGENTS.md**（workspace + goose 全局 config 两处；config.ts:121-140），每 turn 只发裸消息 `bridge.prompt(sessionId, message, images)`（acp-server.ts:490） | `buildCodexPrompt` 把 ~9k token 的 slock 提示词拼进**每条 user 消息**重发（goose 抄自 codex） | **漏抄**（G2 的根因） |
| session 持久化 | meta.json 落盘（session-store.ts:87-102：`{native_id}`，createSession 即写），重启可恢复；platform UUID 预生成，天然无 scope 映射层 | `ScopedProviderSessionStore` 纯内存 Map，重启全丢 | **我们独有**（架构差异暴露的缺口：NAP 是 platform 持 id 请求驱动，我们是 resident daemon 管 scope 映射——映射持久化没有可抄的，要自己设计） |
| prompt cache | 无显式策略，靠「AGENTS.md 常驻 + 裸消息 + session 稳定」三件套自然命中 | 会话内前缀稳定（实测 98-99% 命中，已验证封装无前缀抖动）；坏在 session churn（G1）与每 turn 重发（G2） | 问题都是上面两条的衍生，无独立缺陷 |
| 用户侧取消 | `POST /sessions/:id/interrupt` → `bridge.cancel(sessionId)`（acp-server.ts:659-669） | 只有 stall 看门狗触发 `requestGracefulCancel` | **漏抄**（登记表 B 的参考实现就是它） |
| 桥生命周期 | **每 session 一桥** + LRU 驱逐（idle TTL 10min / 上限 10 个 / 60s 巡检，acp-server.ts:104-115；动机：codex-acp 子进程 ~127MB，防 OOM）+ `pendingDestroy`（改配置后下一 prompt 重拉进程） | 每 runtime 单桥，跨 scope 用 loadSession 切换 | 架构差异，非缺陷；但 NAP 的「改配置→pendingDestroy→下一 prompt 重建」对我们改 provider env 有借鉴 |
| usage 记账 | recordUsage 双 shape（accumulated 优先 + fallback） | 已移植并加强（message_usage 逐次累加层，修了 NAP 也没有的迟到通知竞态） | **已超越参考** |
| ext 通知 | onExtNotification 通用回调（0.14 时代） | 已移植并改用 SDK 0.28+ 原生 `onNotification` 精确注册 | 已超越参考 |
| 压缩（compaction） | 无处理（grep 无命中）；依赖 agent 自身 | 同样无处理 | 双方都有（潜在改进项，暂不立项） |
| 孤儿 session 清理 | sweepOrphanSessionDirs（meta.json 缺失且停止变化即清理） | 无（agentId 前缀方案下目录即 agentId，无需 GC——08-06 已论证） | 不适用 |

## 各问题判定与修法

### G2（slock 提示词每 turn 重发）→ 漏抄，修法明确

NAP 的解法直接可抄：**系统提示词写 AGENTS.md，prompt 只发裸消息**。
goose 和 codex 都原生读工作区 `./AGENTS.md`（goose 另读全局
`~/.config/goose/AGENTS.md`）。

我们的落点注意一个隔离细节：per-agent 的 `GOOSE_PATH_ROOT/config` 目前
symlink 到共享 `~/.config/goose`——**不能**写共享全局 AGENTS.md（多 agent
互相覆盖）。应写 **`<workspacePath>/AGENTS.md`**（每个 agent 工作区天然
隔离，goose/codex 均从 cwd 读项目级 AGENTS.md）。现有 `writeGoosePromptFile`
已写文件但写到了 wrapperDir 且 goose 不读——改为写到 workspace 根并在
runtime 启动/提示词变更时刷新。codex driver 同修。每 turn 的频道 roster/
记忆上下文附加仍是合法的追加上下文，保留。

### G1（scope→session 映射不持久化）→ 我们独有，自设计修法

NAP 无此层（platform 请求带持久 id）。修法方向：把映射落到 daemon 已有的
持久化设施（sessionManager SQLite 或 runtime 状态文件），重启后
`scopedProviderSessions` 从中恢复；codec 方向无需变（agentId 前缀可逆）。

### G3（session 命名开关失效）→ NAP 无对应（其 config 全托管）

自行处理：查 goose 1.46 config.yaml 的 `GOOSE_DISABLE_SESSION_NAMING` 等价
配置项（`goose configure` 文档/源码），或接受每次 ~6k input 的代价并记录。

### B（用户侧取消入口）→ 漏抄，参考实现即 NAP 的 interrupt 端点

daemon 已有 `requestGracefulCancel`，产品链路补一个「取消当前 turn」的
控制入口即可（backend control command → daemon → cancel）。

## 结论

- 三个已定位问题中：**G2、B 是漏抄**（NAP 有现成解法），**G1 是我们架构
  独有**（需自设计），**G3 自查**。
- 修复顺序维持 H → G2 → G1 → G3；G2 修完后用 usage 日志复测缓存命中率
  与 per-turn input 曲线作为验收（新 session 首调应从 ~10-30k 降到 ~1-2k
  量级——系统提示词进入 agent 自身的 system 槽/AGENTS.md 后，不再计入
  我们的 user 消息）。
