# Daemon claude_code Runtime 在 Windows 启动失败 — 诊断报告

> **状态：根因已确认 + 修复已实现并验证通过（集成测试）。**
> 两个独立问题：(A) claude_code 启动失败，(B) 日志中文乱码。
> 诊断环境：Windows 10.0.18363 x64，daemon v0.2.6（npx 安装），claude-code 2.1.175。

## ✅ 最终根因（诊断日志铁证）

spawn claude 子进程时，传入的 `env.PATH` **为空**（只剩 wrapperDir 一项，共 185 字符），导致 cmd.exe 在 PATH 里找不到 `claude.cmd`。

诊断 JSON 关键字段（daemon 实测）：
```
"pathLength":185, "pathHasRoamingNpm":false, "claudeResolvesTo":null,
"pathHead":["<wrapperDir>", ""]
```
数学验证：`prependPathEnv(wrapperDir, '')` = `wrapperDir + ";" + ""` = 184+1 = **185**，精确匹配。

**为什么 daemon 进程 PATH 为空**：daemon 通过 `npx`/connect-ticket 启动，其长驻进程的 `process.env.PATH` 在该启动方式下为空。`buildClaudeRuntimeEnv` 调 `prependPathEnv(wrapperDir, baseEnv.PATH ?? '')` 时 `baseEnv.PATH` 为空字符串，子进程 PATH 只剩 wrapperDir，系统命令（claude.cmd 等）全部找不到。

**为什么 Mac 正常**：mac 上 claude 是无扩展名真二进制，`commandNamesForRuntime` 返回 `['claude']`，`shell:false` 直接 execve；且 mac 的启动方式不会清空 daemon 进程 PATH。

## ✅ 修复（已实现 + 验证）

**文件**：`agent/daemon/aaa-daemon/src/runtime/slock-wrapper.ts`

`prependPathEnv` 在 Windows 上检测到 `basePath` 为空时，从 Windows 注册表读持久化 PATH 兜底（进程级缓存）。覆盖所有 4 个 runtime（claude/codex/pi/opencode 都走 prependPathEnv）。注册表兜底逻辑抽成**可复用导出函数 `resolveWindowsRegistryPath()`**，供命令解析阶段（如 `resolveNpxCommand`）复用。

**实现用 PowerShell 而非 reg.exe**（可移植性关键）：
- 用 `[Environment]::GetEnvironmentVariable('Path','User'/'Machine')`，返回 .NET UTF-16 字符串——**对中文用户名机器编码安全**（reg.exe 输出系统代码页 GBK，`encoding:'utf-8'` 解码会把中文用户名变乱码，导致 `C:\张三\AppData\Roaming\npm` 失效）。
- 自动展开 `REG_EXPAND_SZ` 的 `%APPDATA%`/`%USERPROFILE%` 引用——npm 默认把全局 bin 存成 `%APPDATA%\npm`，不展开则修复失效。
- PowerShell 路径用 `SYSTEMROOT ?? WINDIR ?? 'C:\Windows'` 三重兜底。
- 无硬编码本机路径（无用户名、无盘符假设）。

**验证**（`probe-integration.cjs`，精确复现根因条件）：
- 模拟 daemon 进程 `process.env.PATH` 为空（length=0）
- 修复后 `buildClaudeRuntimeEnv` 产出 PATH length=3225，`hasRoamingNpm=true`，`hasFFFD=false`（编码干净），`fallbackApplied=true`
- `spawn('claude.cmd', args, {shell:true})` → **exit 0，输出 `2.1.175 (Claude Code)`**，无 "not found" 错误 ✅

### 同根因的另一表现：codex ACP `spawn npx ENOENT`

codex ACP runtime 报 `spawn npx ENOENT`，根因相同（daemon PATH 为空）但触发点不同：
- `resolveNpxCommand`（`codex-acp-bridge.ts:44-50`）在**命令解析阶段**用空 PATH 调 `commandAppearsOnPath('npx.cmd', '')` → false → 回退命令名 `npx`（无扩展名）。
- spawn 时 env 虽经 `buildCodexRuntimeEnv` → `prependPathEnv` 修复了 PATH，但命令名已定为 `npx`，`runtimeCommandSpawnSpec('npx')` → `{shell:false}`（无扩展名不触发 shell），Windows `CreateProcess('npx')` 找不到（`npx` 是 .cmd shim 不是真二进制）→ **ENOENT**。

**修复**（`codex-acp-bridge.ts` 的 `resolveNpxCommand`）：PATH 为空时调 `resolveWindowsRegistryPath()` 兜底，正确解析出 `npx.cmd`。

**验证**（本地新 dist，空 PATH）：
1. `resolveNpxCommand({PATH:''}, 'win32')` → **`npx.cmd`** ✅
2. spawn env PATH 含 nodejs ✅
3. spawnSpec → `{command:'npx.cmd', shell:true}` ✅
4. `spawn npx.cmd --version` → **exit 0** ✅（不再 ENOENT）

单元测试：`codex-acp-mvp.test.mjs` 新增 `resolveNpxCommand restores npx.cmd on Windows when the inherited PATH is empty`（通过）。

**单元测试**：`test/proxy-wrapper.test.mjs` 新增 `prependPathEnv restores a usable PATH on Windows when the inherited basePath is empty`（通过）。daemon 全套测试 301 个，296 pass / 2 fail（2 个失败为预存环境问题：pi-runtime EBUSY + real bundled Pi，与本次修复无关）。

**实现注意**：dist 是 ESM（`"type":"module"`），不能用 `require('child_process')`（会静默失败导致兜底无效）——必须用顶层 `import { spawnSync } from 'child_process'`。第一版用 lazy require 在 ESM 下失效，已修正。

---

---

## 问题 A：`claude_code runtime` 启动失败 — `'claude.cmd' 不是内部或外部命令`

### 现象（daemon/logs jsonrpc 实测）
```
claude_code runtime started for agent ca7d9011-...: pid=35084 (status=starting)
claude_code runtime ... stderr: 'claude.cmd' 不是内部或外部命令，也不是可运行的程序
claude_code runtime ... stderr: 或批处理文件。
claude_code runtime ... exited: code=1 signal=null
```
- 报错是 **cmd.exe 的标准两行报错**（spawn 用 `shell:true` → `cmd.exe /d /s /c claude.cmd ...`）。
- 乱码原文即 `'claude.cmd' 不是内部或外部命令，也不是可运行的程序` + `或批处理文件。`

### 链路定位（已 100% 确认）
1. 入口：WS `control` 事件 → `daemon.ts:775` → `handleControlCommand` (`daemon.ts:1695`) → `startRuntimeForAgent` (`daemon.ts:972`)。
2. **command 解析**（`daemon.ts:1005-1018`）：本机 6 个 providers 全是 OpenCode，**无 claude_code provider**，`resolveRuntimeProviderLaunch` 对 claude 无结果 → 走 else 分支 (`daemon.ts:1017`) → `resolveDetectedRuntimeCommand('claude_code', inventory)` → 返回 **`inventory.claudeCommand` = `"claude.cmd"`**（纯名，靠 PATH）。
3. **spawn**（`claude-runtime.ts:497-502`）：
   ```ts
   const spawnSpec = runtimeCommandSpawnSpec('claude.cmd', args);   // → {command:'claude.cmd', shell:true}
   const child = spawn(spawnSpec.command, spawnSpec.args, runtimeProcessSpawnOptions({
     cwd: this.options.workspacePath,    // = ~/.smallkhoj/daemon/workspaces/.slock-runtimes/<...>/<launchId>
     env: buildClaudeRuntimeEnv(...),    // 继承 process.env，PATH 前置 wrapperDir
     stdio: ['pipe','pipe','pipe'], shell: spawnSpec.shell,   // shell:true
   }));
   ```
4. `claude.cmd` 是 npm 生成的 shim（`%~dp0\node_modules\@anthropic-ai\claude-code\bin\claude.exe %*`），真二进制 `claude.exe`（245MB）在 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\`。

### 关键矛盾（无法离线复现）
我做了 **7 组对照实验**，全部**成功**，唯独真实 daemon 那一次失败：

| 实验 | 环境/cwd/env | 结果 |
|---|---|---|
| 直接 `node spawn claude.cmd --version` | 默认 env，shell:true | ✅ exit 0 |
| npx 环境同上 | npx PATH（含 `_npx\...\.bin` 前置） | ✅ exit 0 |
| 深层 workspace cwd + 默认 env | cwd=runtime workspace | ✅ exit 0 |
| **完全 daemon 同款**（cwd+env+spawnSpec+spawnOpts，调 daemon dist） | 一模一样 | ✅ exit 0 |
| `probe-spawn-exact.cjs`（13 个完整 args + system-prompt-file） | 一模一样 | ✅ 跑到 timeout（正常等待 stdin） |
| cmd.exe 手动 `claude.cmd --version`（深层 cwd） | 直接终端 | ✅ 2.1.175 |
| `claude.exe` 直接 spawn（绕过 shim） | shell:false / true | ✅ exit 0 |

**唯一无法重现的是：daemon 进程启动那一刻（04:45:27）的运行时环境快照。** daemon 是常驻进程，`process.env` 是它 npx 启动瞬间的快照。

### 最可能的真相（高置信度，未 100% 证实）
daemon 启动子进程时，其 `process.env.PATH` 在那一刻**没有包含** `C:\Users\<user>\AppData\Roaming\npm`（claude.cmd 所在目录）。可能场景：
- daemon 从一个 PATH 不全的终端/shell 启动（如某些 IDE 集成终端、或 claude 是 daemon 启动后才装的）。
- npx 的 PATH 操作在某些时序下临时遮蔽了全局 npm 目录。

证据支撑：cmd.exe 的 "不是内部或外部命令" **正是 PATH 找不到时**的报错；而我所有复现里 PATH 都含 `Roaming\npm` 所以都成功。

### 次要可能（已排除）
- ❌ 不是 cwd 不存在（目录在，177 字符 < MAX_PATH 260）。
- ❌ 不是 spawnSpec 引号 bug（纯 `claude.cmd` → `{command:'claude.cmd', shell:true}`，无引号；带引号/带路径的 command 才会触发 not-found，但 daemon 不走那条）。
- ❌ 不是 `.cmd` shim 的 `%~dp0` 解析（手动跑 shim 正常）。

### 修复方向（给方案 agent）

**方向 1（最稳，推荐）：检测到 `claude.cmd` 时优先用 `claude.exe` 真二进制**
- `local-command-provider.ts:92-94` 的 `commandNamesForRuntime` 当前 Windows 候选是 `['claude','claude.cmd','claude.exe']`。`claude.cmd`（shim）排在 `claude.exe`（真二进制）前面。
- 把 `claude.exe` 优先级提前，或检测到 `.cmd` shim 时解析其指向的 `.exe`。`.exe` 是真二进制，`shell:false` 直接 CreateProcess 即可，**完全绕过 cmd.exe + PATH shim 脆弱链**。
- 注意：`claude.exe` 路径不在 PATH（在 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\`），需在 candidates 里加这个解析路径（e2e 测试 `claude-spawn-e2e.mjs:62-64` 已经这么做了，是现成范式）。

**方向 2（根因补丁）：spawn 时给子进程补全 PATH**
- `buildClaudeRuntimeEnv` (`claude-runtime.ts:370`) 可在 Windows 上确保 `%APPDATA%\npm` 在子进程 PATH 里（若缺失则补）。
- 治标，不治本（仍依赖 cmd.exe shim）。

**方向 3（诊断增强，必做）：spawn 前把 command/cwd/env.PATH/env-len 写日志**
- 当前 spawn 失败只有 stderr，无法判断是 PATH 缺失还是别的。在 `claude-runtime.ts:497` spawn 前 `this.emit('stderr', ...)` 或 daemon log 一行诊断信息（command、shell、cwd、PATH 是否含 npm 目录、PATH 长度）。下次失败立刻定位。

**方向 4（健壮性）：spawn error/exit 时把 ENOENT/exit=1 翻译成可读 activity**
- 现在 `daemon.ts:1565-1604` 的 error handler 把 stderr 原样上报，GBK 乱码（见问题 B）。应在 Windows 上以正确编码读 stderr，或对 "不是内部或外部命令" 这类做明确提示。

---

## 问题 B：daemon 日志中文乱码 — 已 100% 确认根因

### 现象
daemon 日志里 claude 子进程的 stderr 显示为乱码：
```
stderr: 'claude.cmd' 不是一个外部或内部命令...   ← 实际显示为乱码
```

### 根因
1. daemon 用 `shell:true` spawn → 子进程是 **`cmd.exe`**。
2. Windows 中文系统下 cmd.exe 的输出编码是 **GBK (CP936)**（活动代码页 936）。
3. daemon 的 Node 进程以 **UTF-8** 解码子进程 stdout/stderr（Node 默认）。
4. GBK 字节 → UTF-8 解码 → 乱码。

涉及代码：`claude-runtime.ts:505-506` 的 `child.stdout.setEncoding('utf-8')` / `child.stderr.setEncoding('utf-8')` 硬编码 UTF-8。

### 修复方向
**方向 A（推荐）：spawn 子进程时强制 UTF-8 环境**
- 在 `buildClaudeRuntimeEnv` (`claude-runtime.ts:370`) 里，Windows 下设：
  - `env.PYTHONIOENCODING='utf-8'`
  - 在 spawn cmd.exe 时让 chcp 65001（如 `cmd.exe /d /s /c "chcp 65001 >nul && claude.cmd ..."`）—— 但 `shell:true` 下不易注入。
- 或设 `env.LANG='en_US.UTF-8'` / `env.LC_ALL`（部分工具尊重）。

**方向 B：以正确编码解码 stderr**
- 不硬编码 `setEncoding('utf-8')`，Windows 下用 `iconv-lite` 或 `Buffer` + 按系统代码页（`child_process` 拿到的本就是 Buffer，可延迟解码）。
- 复杂度较高，方向 A 更干净。

---

## 验证手段（给修复 agent 用）

### 重现 claude 启动
1. daemon 已在跑（proxy-port 见 `daemon/logs`）。或重连：Computers 页 → Reconnect → 跑连接命令。
2. 创建 agent：Runtime=Claude Code，绑 computer。
3. 抓日志：
   ```bash
   curl -sS http://127.0.0.1:<proxy-port>/internal/daemon/jsonrpc \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}'
   ```
   看是否有 `Handling control command start_runtime` + 后续 stderr。

### 验证 spawn 链路（离线）
- daemon dist 路径（npx 缓存）：`C:\Users\<user>\AppData\Local\npm-cache\_npx\<hash>\node_modules\@smallkhoj\smallkhoj-daemon\dist`
- 关键函数：`runtimeCommandSpawnSpec`、`runtimeProcessSpawnOptions`（`runtime/process-tree.ts`）、`buildClaudeRuntimeEnv`（`runtime/claude-runtime.ts`）、`detectClaudeCommand`（`runtime/providers/local-command-provider.ts`）。

### 关键文件清单
- `agent/daemon/aaa-daemon/src/runtime/process-tree.ts:11-36`（spawn helpers + Windows 处理）
- `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts:370-525`（env 构建 + spawn + setEncoding）
- `agent/daemon/aaa-daemon/src/runtime/providers/local-command-provider.ts:42-126`（检测 + candidates）
- `agent/daemon/aaa-daemon/src/daemon/daemon.ts:972-1022`（command 解析）+ `1565-1604`（error handler）
- `agent/daemon/aaa-daemon/test/claude-spawn-e2e.mjs:62-64`（claude.exe 路径的现成范式）

### 旁证：mac 上为何正常
- mac 上 claude 是 `claude`（无扩展名真二进制/可执行脚本），`commandNamesForRuntime` 返回 `['claude']`，spawn `shell:false` 直接 execve，不依赖 cmd.exe shim，无 PATH shim 脆弱性，无 GBK 编码问题。

---

## 环境信息
- daemon: v0.2.6，npx 安装（`npx -y --package <tgz> aura --server-url ... --api-key ...`）
- claude-code: 2.1.175，装于 `%APPDATA%\npm`（claude.cmd shim + claude.exe 245MB 二进制）
- Windows 活动代码页: 936 (GBK)
- 失败 agent: `ca7d9011-9d32-4703-a92e-9794a83fddfa`，runtime workspace: `~/.smallkhoj/daemon/workspaces/.slock-runtimes/...`
