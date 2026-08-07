# Windows Computer 三阶段安装与连接流程

## Goal

让 Windows 和 macOS 目标电脑都可以在没有预装 Node.js/npm/npx 的情况下完成 SmallKhoj Computer 接入，并把“确保 Aura 可用、初始化本机身份、连接服务器”拆成可观察、可恢复的产品流程。用户应能知道当前停在哪一步、失败原因是什么，以及下一步应执行的命令；重复执行安装命令不得无条件重新下载同一份大归档，也不得把手工 `export PATH=...` 当成安装完成。

## Background and confirmed facts

- 当前 Computer 页面生成的连接命令固定使用 `npx -y --package <artifact> aura --server-url ... --api-key ...`（`backend/routers/public_api.py:294-310`）。
- 当前发行物的 launcher 是 Bash 脚本并执行 `node dist/cmd/main.js`，manifest 要求 Node `>=20`（`scripts/build_daemon_distribution.py:92-127`）；安装器目前只生成 `install.sh`（`scripts/build_daemon_distribution.py:205-269`），没有 Windows `install.ps1`。
- daemon 已经区分一次性 `sk_connect_` ticket 与持久化 `sk_machine_` token，并会自动保存 machine ID、向服务器注册和发送 heartbeat（`agent/daemon/aaa-daemon/src/cmd/main.ts:146-231`、`agent/daemon/aaa-daemon/src/daemon/daemon.ts:883-940`）。
- 前端当前主要等待后端发现同名且 `online`/`active` 的 Computer；连接凭证存在时每 3 秒刷新，没有命令失败或等待超时状态（`frontend/app/(app)/computers/connect-computer-form.tsx:48-100`、`frontend/app/(app)/computers/page.tsx:726-739`）。
- 参考流程 `irm .../install.ps1 | iex` → `raft-computer setup ...` → connect command 将环境安装、本机 setup、服务器连接分成三步；安装器是自包含 Windows `.exe`，不依赖 npm/npx，并进行版本、架构和 SHA-256 校验。
- Windows standalone 发行方向没有协议或业务层阻塞：daemon 的 connect、machine token、machine ID、heartbeat 和运行时发现均为 Node API/网络/文件系统行为，可以由嵌入 Node 运行时的 Windows 可执行发行物承载。
- “严格单文件 `.exe`”不能直接由当前源码无改造生成：项目为 ESM，运行时读取外部 `package.json`（`agent/daemon/aaa-daemon/src/version.ts:1-16`），后台模式使用 `process.execPath + process.argv[1]` 自重启（`agent/daemon/aaa-daemon/src/cmd/main.ts:78-91`），Pi 依赖包含 N-API clipboard 原生绑定和 Photon WASM 资源；这些需要打包配置、sidecar/按需解包或代码调整。
- daemon 自身的 standalone 不等于捆绑所有 Agent runtime：Claude、Codex、OpenCode、Pi、CC Switch、`sqlite3` 等本地工具仍属于外部可探测能力。缺失的 runtime 应显示为 unavailable，而不应导致 daemon 安装失败。
- 云端当前只把 `release-artifacts/smallkhoj-daemon` 静态挂载进后端镜像（`backend/main.py:23-24,72-76`），CI 只在 Ubuntu 运行且没有 Windows build/release job（`.github/workflows/ci.yml:19-23,51-54`）。增加 Windows artifact、manifest、安装脚本和发布矩阵在现有下载边界内可行，但需要新增交付链路。
- 本地开发可以继续使用 TypeScript/Node 的 `npm run build/dev`；Windows standalone 应是发布与 smoke-test 产物，不要求日常开发每次生成 `.exe`。
- 当前 `sk_connect_` ticket 的有效期为 300 秒（`backend/routers/public_api.py:176,4620-4637`）；连接接口会拒绝过期/已消费 ticket，并在同一 Computer 仍有有效 daemon lease 时返回冲突（`backend/routers/agent_api.py:1625-1663`）。因此用户手动分两步时存在“Setup 完成但 Connect 等待过久导致 ticket 过期”的流程风险。
- 当前 macOS `install.sh` 把版本、平台、归档和 SHA 固定进脚本；每次执行都会下载、解包并覆盖版本目录。它把 launcher 写入 `~/.smallkhoj/bin`，但主流程仍依赖调用者手工刷新 PATH；正式产物调用系统 `node`，Codex ACP 又通过运行时 `npx -y @zed-industries/codex-acp@0.16.0` 动态解析。这些行为不满足正式安装体验。

## Product requirements (draft)

### R1. Windows 与 macOS 环境安装

提供 Windows PowerShell 与 macOS shell 安装入口；两端正式发行物都不得要求目标机预装 Node.js/npm/npx。macOS 安装命令是稳定的 `curl .../install.sh | SMALLKHOJ_DAEMON_VERSION=<server-selected-version> sh`，版本由服务端/UI 自动注入，用户不手工选择。安装器先做平台、架构、本地 active 版本、artifact identity 和完整性检测，再决定复用、修复、升级或首次安装；同版本同 SHA 且完整时只读取小型 manifest，跳过大归档下载。安装完成后当前用户应能直接执行 `aura`，不得要求手工 `export`、`source` 或重开终端。任何无法满足命令可发现性或完整性的情况必须失败并保留旧 active 版本。

### R2. 本机 setup

提供独立的 setup 步骤，用于设置 Computer 名称、生成或确认 machine ID、写入本地配置，并明确选择 managed/legacy daemon 兼容模式。setup 不应要求用户先手工安装 npm/npx。

### R3. 服务器连接

提供独立的 connect/start 命令：首次使用 `sk_connect_` ticket 换取并持久化 `sk_machine_` token；后续重启/重连复用既有本地 Setup（配置和 machine ID），直接使用当前发布的最新兼容 standalone daemon，不要求重新 Setup。Connect 自己负责选择 active Aura、检查进程/lease、必要时 graceful restart、启动 daemon 并等待注册/heartbeat；`restart/status/doctor` 是本机诊断与恢复入口，不是用户完成 onboarding 的必做步骤。连接成功必须以服务器注册和 heartbeat 为准。

### R4. Web 流程可观察性

连接页面展示 Install、Setup、Connect、Online 的阶段状态；对命令未执行、环境缺失、token 过期、服务器不可达等情况提供失败/超时状态、恢复动作和平台对应命令。

### R5. 兼容现有用户

现有 macOS/Linux npx 入口仅作为开发和兼容回退保留，不再作为新用户的正式产品路径；已有 machine token、旧 daemon 状态和当前 API 合约不能被无意破坏。Windows/macOS 重连都不是迁移流程：当旧 daemon 已离线或不再提供有效连接时，直接用 active standalone daemon 复用既有 identity；只有实际活跃的 daemon 进程/lease 才触发冲突保护。

### R6. 多运行时共存与冲突检测

Windows standalone 安装和重连必须通过命令解析、运行进程检查、本地配置、machine ID 和 daemon 版本检测，避免与已有 Node/npm/npx daemon 或 legacy daemon 争用同一身份、端口、状态目录和后台进程。旧版本安装本身不视为迁移冲突；只有检测到实际活跃进程或有效远端 lease 时才阻止重复启动，并给出停止/等待/重试原因，不得静默杀进程或覆盖状态。

### R7. 内部编排能力（不作为 MVP 用户入口）

Install/Setup/Connect 可以在未来由一个内部 orchestrator（编排器）串联，但第一版不向用户提供会隐藏三阶段的“一命令 onboarding”入口。无论是否存在内部编排，Setup 成功而 Connect 失败时，本地配置和 machine ID 必须保留；只有用户明确发起 Connect/Reconnect 动作时才申请新的 ticket，重试不得重新生成或覆盖已有 identity。

### R8. 平台感知的连接指引

连接 API 不再只返回一个无法区分平台的 `command` 字符串；应返回结构化的 Install、Setup、Connect 命令，并至少区分 Windows PowerShell 与 macOS/Linux shell。Web 连接对话框提供平台切换（可根据浏览器平台给默认值但允许手动切换），每个平台显示对应的安装入口、命令、复制操作和连接状态；`sk_connect_` ticket 的过期时间只在用户点击 Connect/Reconnect 并成功生成 ticket 后显示，Install/Setup 预览不得显示虚假的倒计时。

### R10. 重连路径

对已完成 Setup 的 Computer，Web 只展示 Connect（重连）阶段；命令应拉取或启动当前最新兼容 daemon，复用已有 machine ID、server URL 和本地配置。版本升级是重连的默认行为，不向用户展示“迁移”语义；若旧 daemon 仍活跃，则由本地进程检查和服务器 lease 冲突返回可操作的停止、等待或重试提示。

### R9. 双语与互斥显示

中文（`zh-CN`）为默认 UI 语言，同时提供英文（`en`）翻译。Windows 与 macOS/Linux tabs 必须在视觉、标题、shell 标识和警示文案上明确为互斥平台；任何时刻只显示并允许复制当前选中平台的命令，避免用户误把 Unix 命令复制到 Windows 或反之。切换平台时保留用户填写的 Computer 名称，但不混用另一平台的命令或状态说明。

### R11. 中文命令行引导

Install/Setup/Connect 仍以用户在目标机执行命令为主，但中文 UI 必须提供可跟随的操作引导：Windows 说明如何打开 PowerShell、macOS/Linux 说明如何打开 Terminal（终端）、明确复制/粘贴位置、预期成功输出、权限/网络提示、失败后的重试路径和联系客服/日志入口。图形化安装器、远程代执行和“完全不接触命令行”的 onboarding（首次引导）不属于本任务 MVP，作为后续产品方向保留。

### R12. Just-in-time ticket（即时连接凭证）

`sk_connect_` ticket 不应在用户刚填写 Computer 名称、打开连接弹窗、切换平台或查看 Install/Setup/Connect 预览时就开始计时；这些阶段只准备本机命令和 Connect 操作提示。只有用户主动点击“生成连接命令”/“Connect（连接）”或“Reconnect（重连）”时才创建 ticket，并在生成成功的响应中返回过期时间、重新生成和失败恢复入口。Reconnect（重连）同样即时生成新 ticket。

### R13. Windows 与 macOS 跨平台测试

Windows 和 macOS 都是本任务的必测平台，不能只验证 Windows standalone（独立安装包）而跳过 macOS，也不能用 macOS 通过来替代 Windows 真实主机验收。测试分为四层：

1. **后端契约测试（contract tests，接口契约测试）**：覆盖平台命令结构、Windows 与 macOS/Linux 命令互斥、Install/Setup 预览不创建 ticket、点击 Connect/Reconnect 才创建 ticket、300 秒过期、重新生成、ticket 消费和有效 lease 冲突。
2. **daemon 自动化测试**：覆盖 macOS 的 Ensure/版本检测/active pointer/launcher 可发现性/私有 Node 与 ACP 依赖、Windows 的路径解析、machine ID 持久化、配置/credential、版本检测、进程识别、升级/回滚和冲突处理；npx 只作为兼容回归。测试不得把 `win32` 平台标签误当成 32 位架构。
3. **前端/UI 测试**：覆盖中文默认语言、英文切换、Windows 与 macOS/Linux tabs（平台标签页）默认选择和手动切换、未选平台命令不可见/不可复制、三阶段卡片、ticket 过期提示和 Online/失败状态。需要使用项目 WebDriver（`./twd`）验证实际可见行为。
4. **真实主机验收（real-host acceptance，实机验收）**：
   - Windows x64：干净用户环境、无 Node.js/npm/npx，验证 PowerShell 安装、架构检测、PATH、`%LOCALAPPDATA%\Aura` 布局、sidecar、Setup 幂等性、首次 Connect、重连、升级、回滚、旧 daemon/lease 冲突和日志；记录 PowerShell 与系统版本。
   - macOS：使用当前开发机或独立干净用户环境，验证固定版本 Ensure 的首次安装、同版本零归档下载、损坏修复、低版本升级、高版本拒绝降级、离线复用、当前 shell 直接可发现 `aura`、Setup/Connect/重连、machine ID 和 credential 复用、ticket 即时生成/过期重试、旧 npx/legacy daemon 共存，以及 ACP doctor/preflight 和真实 Claude Code 回复；记录 macOS 版本、CPU 架构、私有 Node/ACP 版本。
   - Linux：至少运行现有 npx 命令、后端连接回归和 daemon 基础 smoke test（冒烟测试）；若没有稳定 Linux 实机，不把 Linux 实机作为本任务阻塞条件，但必须保留自动化回归。

每个平台的验收证据至少包括：脱敏后的命令输出、Aura/daemon 版本、安装/配置路径、machine ID 是否复用的结果、Online/heartbeat（在线/心跳）记录、失败与重试结果。任何一项 Windows 或 macOS 必测项失败，都不能将本任务标记为完成。

## Acceptance Criteria (draft)

- [ ] 干净 Windows 主机（无 Node/npm/npx）可以通过产品提供的安装入口安装 daemon，并得到明确的成功或失败结果。
- [ ] 用户可以独立完成 setup；本机重启后 machine ID、Computer 名称和模式配置保持一致。
- [ ] 首次 connect 能完成 `sk_connect_` → `sk_machine_` 交换并显示 Online；后续 start/reconnect 不要求再次执行一次性 ticket。
- [ ] 打开弹窗、切换平台、查看 Install/Setup/Connect 预览都不会创建或消耗 ticket；只有点击 Connect/生成连接命令或 Reconnect 后才创建 ticket，响应返回过期时间，过期后可重新生成而不重复 Setup。
- [ ] 已 Setup 的 Computer 重连时不重复显示 Install/Setup；重连命令使用当前发布的最新兼容 daemon，并复用原 machine ID 与本地配置。
- [ ] 虚拟机克隆、整机复制或显式 reset 时能安全重新生成 machine ID，并避免与原 Computer 复用身份。
- [ ] 目标机命令未启动或环境安装失败时，Web 页面在有限时间内进入失败状态并给出可执行的恢复路径，不会无限停留在 pending。
- [ ] macOS 正式 Ensure/Connect/Reconnect 流程通过；现有 macOS/Linux npx 入口作为兼容回退仍保持通过。
- [ ] macOS 同版本完整安装第二次执行时不下载大归档；仅 manifest/本地完整性检查发生。
- [ ] macOS 安装成功后当前终端可直接运行 `aura restart`、`aura status`、`aura doctor`，不需要手工 `export`、`source` 或重启终端。
- [ ] macOS 无 credential 执行 `aura restart` 不伪造 prototype credential、不创建服务器状态，并明确报告已安装/未连接；Connect 后 `aura restart` 才启动正式注册和 heartbeat。
- [ ] macOS release manifest 同时覆盖 `darwin-arm64` 与 `darwin-x64`；Rosetta 下优先选择真实 Apple Silicon arm64，未发布架构 fail closed。
- [ ] Codex ACP 依赖随正式 Aura 产物固定、校验并从本地路径启动；核心安装不因可选 ACP 缺失失败，但 `aura doctor` 和选择 Codex 时必须给出可执行诊断。
- [ ] 真实命令链完成 Install/Ensure → Setup → Connect，并由 Claude Code runtime 收到唯一 marker、通过 Aura/slock 发送可见回复；新增 `tools/integration-gate` 产品语义 Gate 必须 PASS，未通过前不得宣称任务完成。
- [ ] 在同一台 Windows 主机同时存在 standalone、Node/npm 和 legacy daemon 时，安装、setup、start、stop、status 能识别各实例并拒绝危险的重复启动/身份复用。
- [ ] 旧 daemon 仅安装但未运行时，不触发“迁移”流程；旧 daemon 进程或远端 lease 仍活跃时，重连明确阻止重复启动并提供停止/等待/重试路径。
- [ ] standalone daemon 的版本、machine ID、配置目录和进程状态可独立查询，并能明确说明当前正在运行的实现类型。
- [ ] 在真实 Windows 主机上验证安装、路径解析、PATH、配置/日志/PID/sidecar 写入、升级、重连和冲突处理；不能仅以 macOS/Linux 或静态类型检查通过作为 Windows 完成证明。
- [ ] 在真实 macOS 主机上验证 Ensure/Connect/Reconnect、ticket 即时生成与过期重试、machine ID/credential 复用、私有 Node/ACP 与 legacy/npx 共存；不能仅以 Windows 通过作为 macOS 完成证明。
- [ ] 后端契约、daemon 自动化、前端可见行为、Windows x64 实机和 macOS 实机测试均有可复核证据；Windows 或 macOS 任一必测平台未通过时，不得宣称本任务完成。
- [ ] Windows 安装器能正确识别 `x64`/`arm64`/`x86`，对不支持或架构不匹配的主机给出明确错误；不能把 `win32` 标签当作 CPU 架构判断。
- [ ] Windows 用户看到的安装器、命令、路径和状态文案使用 Aura；内部 `@smallkhoj/smallkhoj-daemon` artifact（产物）命名可以暂时保留以降低开发期改动，但不要求安装器提供用户可见的旧命令别名。
- [ ] Web 连接对话框可以在 Windows 与 macOS/Linux 之间切换，并且不会把 Unix `curl|bash` 或 `npx` 命令错误地展示给 Windows 用户。
- [ ] 后端返回的每个平台命令包含明确 shell 类型和阶段名称；macOS/Linux 使用版本固定的 Ensure + 稳定 Aura launcher，npx 仅作为兼容回退，Windows 使用 standalone 安装器和 executable 命令。
- [ ] 中文默认 UI 与英文 UI 覆盖平台 tabs、Install/Setup/Connect 阶段、shell 标签、互斥提示、复制反馈、过期/失败/冲突文案；不存在未翻译的硬编码用户文案。
- [ ] 中文 UI 能让不熟悉命令行的用户按步骤完成“打开终端 → 复制命令 → 粘贴执行 → 查看结果 → 继续下一步”；英文 UI 提供等价信息。
- [ ] 任意时刻只有当前平台 tab 的命令卡片可见/可复制；自动默认仅选择初始 tab，不会锁定用户切换。
- [ ] 当前选中的平台始终显示 Install、Setup、Connect 三个阶段；不使用本地“已完成”勾选作为真实成功依据，只有服务器 Online 状态确认最终连接成功。

## Decisions confirmed

- Windows 采用 standalone 安装包：`smallkhoj-daemon.exe` 加必要 WASM/原生 sidecar 资源；目标机不要求预装 Node.js/npm/npx。
- macOS 正式产品路径改为 managed standalone Ensure，不再以 npx 作为新用户主流程；开发和旧消费者可继续使用 npx 兼容入口。
- macOS 正式发行目录带私有 Node runtime、daemon `dist`、生产依赖、固定版本的 `@zed-industries/codex-acp` 与必要 sidecar；不要求用户安装 Node/npm/npx，也不强制第一版做成严格单文件 SEA。
- macOS 用户状态继续保存在 `~/.smallkhoj/daemon`；稳定用户命令放在 `~/.local/bin/aura`，并保留 `~/.smallkhoj/bin/aura` 兼容 shim。安装器优先选择当前 PATH 中已有且可写的用户目录，成功后当前终端必须直接解析 `aura`。
- macOS UI 的正式安装命令自动注入服务端已发布版本；不带版本的直接安装入口从 release manifest 选择最新兼容版本。普通用户不手工拼版本、包名、下载地址或 PATH。
- macOS Ensure 状态机：无安装则下载；同版本、同平台、同 artifact SHA 且文件完整则跳过归档；损坏则修复；旧版本自动升级并保留旧目录；本机更新版本默认拒绝降级；网络不可达但本机版本完整且满足最低兼容版本时允许 `offline-reused`；任何失败都不得切换 active pointer。
- macOS 同时设计 `darwin-arm64` 与 `darwin-x64` 发行；Rosetta 终端必须通过硬件能力检测选择原生 arm64。架构产物未发布时 fail closed。
- `aura restart/status/doctor` 是本机诊断和恢复入口，不是 onboarding 必做步骤；Connect 自己负责 active 版本、冲突检查、graceful restart、启动、注册和 heartbeat。无 credential 的 restart 不使用 prototype credential，也不产生远端状态。
- Codex ACP 不再由正式产品路径在运行时临时 `npx -y` 下载；产物携带可校验的本地 ACP 入口。ACP 仍是可选 runtime：缺失不阻塞核心 Aura 安装，但 doctor/选择 Codex 必须 fail closed 并说明原因。
- macOS 完成条件不是单元测试或 fake upstream：必须执行产品给出的真实安装命令，完成 Setup/Connect，并由 Claude Code runtime 通过 Aura/slock 对唯一 marker 产生可见回复；该流程必须由 `tools/integration-gate` 的产品语义 Gate 判定 PASS。
- 用户可见的 Windows executable（可执行文件）和 CLI（命令行）名称为 `aura.exe` / `aura`，默认安装根目录为 `%LOCALAPPDATA%\Aura`；`smallkhoj-daemon` 仅作为开发期内部 artifact/源码名称保留。
- standalone 内部采用用户可见 `aura.exe` 加私有 `node.exe`、daemon `dist`、生产依赖以及 N-API/WASM sidecar 资源的可安装目录；不要求目标机预装 Node.js/npm/npx，也不以纯单文件原生编译为第一版阻塞条件。
- Windows standalone 的 credential（本地凭证）默认存放在 `%LOCALAPPDATA%\Aura\daemon\credential.json`，使用当前用户 ACL 保护；Connect 成功后原子写入 machine token，legacy 凭证目录保持不变。
- machine ID 首次 Setup 自动生成并持久化；版本升级和重连复用原 ID；只有虚拟机克隆、整机复制或明确 reset（重置）操作才允许重新生成。
- 版本策略：本地版本低于服务器声明版本时自动升级；相同版本做完整性校验后继续使用；本地版本更高时默认拒绝降级，只有显式 rollback/force（回滚 / 强制）才允许降级。
- 具体 compatibility policy（兼容策略）暂不在需求阶段定稿；实现前沿用现有服务器最低 daemon 版本校验作为临时边界，兼容矩阵和回退规则在 design/Windows 实测阶段补齐。
- 产品流程固定拆成 Install、Setup、Connect 三阶段。
- standalone 必须与现有 Node/npm daemon、已有 machine ID、配置和 legacy daemon 共存且不冲突；冲突检测至少覆盖命令、进程、配置、machine ID 和版本。
- 第一版优先采用“平台选择 + 三段命令卡片 + 连接状态轮询”的最小产品路径；不先引入服务器预注册 setup 状态，也不把三段命令压缩成无法观察的黑盒脚本。
- 前端默认中文并提供英文；平台使用显式 Windows / macOS/Linux tabs，按浏览器系统自动默认但允许手动切换；未选中的平台命令不可见、不可复制。
- 历史“一条可复制 daemon 命令”的前端契约废弃，规范更新和回归测试调整属于本任务交付的一部分。
- 第一版继续使用现有 Computers 连接 Dialog，改造成“平台 tabs + 三阶段命令卡片 + Online/失败状态”的承载方式，不新增独立 onboarding 路由。
- Setup（初始化 / 本机配置）只在目标机本地执行，不访问服务器；Connect（连接服务器）才消费 connect ticket、换取 machine token 并开始 registration/heartbeat。
- `sk_connect_` ticket 在用户点击 Connect（连接）或 Reconnect（重连）时即时生成；Install/Setup 阶段不消耗 ticket 有效期。
- 重连默认跳过已完成的 Install/Setup，直接执行 Connect；使用最新兼容 daemon 不视为迁移。
- 只有实际活跃 daemon 进程或有效远端 lease 才构成冲突；已安装但离线的旧版本不阻止 standalone 重连。
- 若本地发现旧 daemon 进程仍在运行但远端 lease 已失效，reconnect（重连）先尝试 graceful stop（优雅停止）再启动新版本；停止失败不得强制 kill；远端 lease 仍有效时不得自动停止旧 daemon。
- 本任务保持单一端到端 Trellis 验收；Install、Setup、Connect、standalone 构建、云端发布、前端 UI 和 reconnect 验证按 implement.md 的顺序在同一个实现会话中完成，不拆成需要分别验收的子任务。
- Windows 安装目录、配置目录、machine ID、日志、PID 和 sidecar 路径必须使用 Windows 原生路径 API/环境变量（例如 `%LOCALAPPDATA%`、`%USERPROFILE%`），不能把 macOS/Linux 的 `~`、`/` 或 Bash 目录约定直接带入；用户可见产品名和命令统一使用 Aura，默认根目录为 `%LOCALAPPDATA%\Aura`；路径规则必须在真实 Windows 主机完成安装、升级、重连和卸载/回滚测试后定稿。
- Windows standalone 的真实主机测试是本任务的必要验收门槛；macOS/Linux 可在当前开发环境完成自测和兼容回归，但不能替代 Windows 验收。
- `win32` 只表示 Windows 平台前缀，不直接表示 32 位；安装器必须在目标机区分 `x64`、`arm64` 和真正的 `x86`（32 位 Windows），并拒绝下载不匹配的 artifact。公司测试机的实际架构需要在 Windows 实机验收前通过系统 API/PowerShell 检查确认。
- 当前公司 Windows 验收机按 x64 目标处理；实现仍必须使用 Windows 原生架构检测，不能把 `win32` 平台标签误当 CPU 架构。
- 第一版 Windows standalone 以 x64 为公司验收目标；架构检测保留 arm64/x86 分支和明确不支持错误，不在第一版强行承诺所有架构 artifact。
- 现有 `.trellis/spec/frontend/quality-guidelines.md` 中“Daemon Onboarding Shows One Copyable Command”是已废弃的历史需求；本任务完成后必须把它更新为“当前选中平台显示互斥的 Install/Setup/Connect 三阶段命令”，并同步测试要求，避免后续任务恢复单命令 UI。
- 图形化安装器、远程代执行和无命令行 onboarding 明确后置，不阻塞本任务的命令引导 MVP。

## Open decisions

- Windows standalone 的构建实现细节（私有 Node runtime 的版本、launcher 生成、sidecar 布局和升级策略）进入 design/implement 阶段，但不得改变用户可见的 `aura.exe` 和无 Node 前置条件。
- Windows 是否完全复用 macOS 的 `offline-reused` 兼容回退，需要在 Windows 真机升级/回滚验收后定稿；macOS 已确认允许复用本地完整且满足最低版本的 Aura，但连接本身仍必须以服务器 Online 为准。

## Terminology

- Install（安装）：下载、校验并安装 standalone daemon 及其 sidecar resources（伴随资源）。
- Setup（初始化 / 本机配置）：写入 Computer 名称、machine ID、server URL、运行模式和冲突检测结果。
- Connect（连接服务器）：使用 `sk_connect_` ticket 换取 `sk_machine_` token，并开始 daemon registration/heartbeat（注册 / 心跳）。
- standalone package（独立运行安装包）：不要求目标机预装 Node.js/npm/npx 的 Windows 或 macOS 发行目录；不等同于必须使用单文件原生二进制。
- Aura：用户可见的 Computer daemon 产品名和 CLI 名称；SmallKhoj：服务端/代码仓库和 artifact 的内部开发名称。
- sidecar resources（伴随资源）：与 `.exe` 一起安装的 WASM、N-API 原生模块和必要元数据。
- platform tabs（平台标签页）：Windows 与 macOS/Linux 的互斥命令视图。
- pending / timeout（等待中 / 超时）：Web 尚未收到 Online 状态或已超过连接等待期限。

## Notes

- 本文件只记录需求、约束和验收标准；技术边界、数据流、迁移和执行顺序应在需求收敛后分别写入 `design.md` 与 `implement.md`。
- R4/R8/R9/R11/R12 的 UI 落地设计（布局、组件组合、状态矩阵、i18n key、testid 钩子、`./twd` 验证断言）见 `ui-design.md`。
