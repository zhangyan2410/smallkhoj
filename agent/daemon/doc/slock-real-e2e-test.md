# Slock CLI / aaa-daemon 真实联调测试报告

日期：2026-05-29  
项目路径：`D:/ai/khoj/smallkhoj/agent/daemon/aaa-daemon`  
文档位置：`D:/ai/khoj/smallkhoj/agent/daemon/doc/slock-real-e2e-test.md`  
测试对象：`aaa-daemon` 中的 Slock CLI 代理能力，包括消息读取、发送、搜索与浏览器端真实 DM 交互。

## 1. 测试结论

`aaa-daemon` 可以通过本项目自建的 `AgentProxy` 接入本机 Slock agent runtime，并完成与 `app.slock.ai` 的真实消息收发闭环。

已验证能力：

- CLI 从真实 Slock DM 读取消息。
- CLI 向真实 Slock DM 发送消息。
- CLI 搜索真实 Slock DM 消息。
- 浏览器页面向 DeepSeek DM 发送消息后，CLI 可以读取到该消息。
- CLI 发送给 DM 的消息可以在真实 DM 历史中读回。

主要限制 / 注意点：

- 不建议直接连接官方或已运行 daemon proxy 来测本项目能力，本次直连失败，错误为：`machine API key required`。
- 正确方式是在测试进程中启动本项目 `AgentProxy`，再调用本项目 `runSlockCli(...)`。
- 与浏览器中的 DeepSeek DM 交互时，CLI target 需要写对端人类用户：`dm:@zy-ean`。
- `dm:@deepseek` 表示 DeepSeek agent 自己，实际读取为空，不是浏览器里的人类 ↔ DeepSeek DM。

## 2. 测试环境

### 2.1 项目

```text
D:/ai/khoj/smallkhoj/agent/daemon/aaa-daemon
```

### 2.2 浏览器页面

```text
https://app.slock.ai/s/zhangyan-ean/dm/8305721f-bd5d-40dd-9f87-43a0cffa3f6b
```

该页面是用户 `zy-ean` 与 agent `deepseek` 的 DM 页面。

### 2.3 已验证的 DeepSeek agent runtime

```text
C:/Users/zhangyan.ean/.slock/agents/d7942034-805b-4ee4-956d-4fe9483fdcd8/.slock
```

注意：该路径只用于引用本机 Slock runtime。不要读取、移动或复制其中的密钥文件。

## 3. 构建

Windows / PowerShell 环境下优先使用 `npm.cmd`：

```powershell
npm.cmd run build
```

本次测试中，项目构建成功。

## 4. 推荐测试方式

### 4.1 不推荐：直连官方/已运行 daemon proxy

本次尝试直连官方/已运行 daemon proxy 失败：

```text
machine API key required
```

因此，这条路径不适合验证 `aaa-daemon` 当前实现。

### 4.2 推荐：测试进程内启动本项目 AgentProxy

测试脚本的核心流程：

1. `importSlockRuntime(...)` 导入本机 DeepSeek agent runtime。
2. 创建并启动本项目 `AgentProxy`。
3. 使用 `writeSlockWrapper(...)` 写入临时 wrapper。
4. 通过 `runSlockCli(...)` 执行真实 CLI 命令。
5. 测试结束后停止 proxy，并删除临时 workspace。

核心依赖：

```ts
import { AgentProxy, generateProxyToken } from './dist/proxy/agent-proxy.js';
import { importSlockRuntime } from './dist/runtime/import-slock-runtime.js';
import { writeSlockWrapper } from './dist/runtime/slock-wrapper.js';
import { runSlockCli } from './dist/slock-cli.js';
```

## 5. DM target 规则

这是本次测试中最关键的坑点。

浏览器页面是：

```text
zy-ean <-> deepseek
```

但 CLI 是以 DeepSeek agent 身份运行的，所以 CLI 访问该 DM 时，target 应写对端人类用户：

```text
dm:@zy-ean
```

不要写：

```text
dm:@deepseek
```

原因：`dm:@deepseek` 对 DeepSeek agent 来说等于自己，读取结果为空。

## 6. 已验证命令形态

### 6.1 读取 DM

```bash
message read --target dm:@zy-ean --limit 2
```

验证结果：成功读取真实 DM 历史消息。

### 6.2 发送 DM

```bash
message send --target dm:@zy-ean --content "[aaa-daemon real e2e] ping"
```

验证结果：发送成功，并能在后续读取结果中看到该消息。

### 6.3 搜索 DM

```bash
message search --target dm:@zy-ean --query "aaa-daemon" --limit 5
```

验证结果：能搜索到测试消息。

### 6.4 接收浏览器发来的消息

浏览器中通过 DM 输入框向 DeepSeek 发送测试消息后，CLI 执行：

```bash
message check --limit 10
```

或：

```bash
message read --target dm:@zy-ean --limit 5
```

验证结果：CLI 成功读到浏览器发送的消息，例如：

```text
[browser->deepseek 2026-05-29T05:19:09.052Z] aaa-daemon receive test 请忽略
```

## 7. 浏览器端发信方式

使用浏览器自动化 JS 时，不要只改 textarea.value。需要使用原生 setter，并触发事件链，然后检查发送按钮状态。

示例逻辑：

```js
const ta = [...document.querySelectorAll('textarea')]
  .find(e => (e.placeholder || '').includes('@deepseek'));

ta.focus();

const setter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value'
).set;

setter.call(ta, message);
ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
ta.dispatchEvent(new Event('change', { bubbles: true }));

const send = document.querySelector('button[aria-label="Send"]');
if (!send.disabled) send.click();
```

本次测试中，该方式可以成功从浏览器发送消息，随后 `aaa-daemon` CLI 可以读取到。

## 8. 本次真实闭环结果

| 场景 | 结果 |
| --- | --- |
| 构建项目 | 成功 |
| 直连官方/已运行 daemon proxy | 失败，`machine API key required` |
| 本项目 `AgentProxy` 启动 | 成功 |
| CLI 读取 `dm:@zy-ean` | 成功 |
| CLI 发送到 `dm:@zy-ean` | 成功 |
| CLI 搜索测试消息 | 成功 |
| 浏览器发送给 DeepSeek，CLI 接收 | 成功 |
| `dm:@deepseek` 作为 target | 读空，不适合该测试场景 |

## 9. 已落地的复用脚本

- `agent/daemon/aaa-daemon/package.json` 增加：

```bash
npm.cmd run test:slock-real-e2e
```

- 脚本文件：`agent/daemon/aaa-daemon/test/slock-real-e2e.mjs`
  - 启动本项目 `AgentProxy`。
  - 导入已有 Slock runtime。
  - 写入一次性 slock wrapper。
  - 通过 `runSlockCli` 验证 send/read/search。
  - 默认 target 为 `dm:@zy-ean`。
  - 可设置 `SLOCK_REAL_SKIP_SEND=1` 只做 read/search，避免发送真实消息。

- 浏览器端 helper：`agent/daemon/aaa-daemon/test/slock-browser-helper.mjs`
  - 封装 textarea 定位、原生 setter、input/change 事件、Send 按钮检查与点击。
  - 当前可由 GA 内置浏览器 bridge/runcode 调用；后续拆出浏览器桥时可直接复用 helper 生成的脚本字符串。

- CLI 侧补充保护/提示：
  - 对 `dm:@deepseek` 作为写入 target 的误用给出提示：该真实 DM 中 CLI 身份是 DeepSeek agent，应使用人类对端 `dm:@zy-ean`。
  - 对 `machine API key required` 类错误追加说明：真实联调应导入本地 Slock runtime，并走本项目 `AgentProxy`，不要把测试 CLI 直接指向官方/已运行 daemon proxy。

## 10. 后续建议

- 后续拆 GA 浏览器桥时，把当前 helper 的执行入口从 GA runcode 替换为独立 bridge 即可。
- 若要纳入 CI，建议默认使用 `SLOCK_REAL_SKIP_SEND=1`，把真实发送测试保留为手动触发。
