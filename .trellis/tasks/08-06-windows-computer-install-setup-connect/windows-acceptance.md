# Windows x64 实机验收清单

本文件是 Windows 侧的执行手册，不是 Mac 静态测试的替代品。验收主机应为干净的 Windows x64 用户环境；所有证据使用同一个 marker：

```text
REAL_windows-computer-install-setup-connect_<YYYYMMDDHHMMSS>
```

## 0. 记录候选身份（先做，失败则停止）

在 PowerShell 保存以下输出（删去用户名、URL 中的 token 和机器标识后提交）：

```powershell
$marker = "REAL_windows-computer-install-setup-connect_$(Get-Date -Format yyyyMMddHHmmss)"
$PSVersionTable | Out-File "$marker-preflight.txt"
[Environment]::OSVersion.Version | Out-File "$marker-preflight.txt" -Append
[Environment]::Is64BitOperatingSystem | Out-File "$marker-preflight.txt" -Append
$env:PROCESSOR_ARCHITEW6432 | Out-File "$marker-preflight.txt" -Append
$env:PROCESSOR_ARCHITECTURE | Out-File "$marker-preflight.txt" -Append
Get-Command node,npm,npx,aura -ErrorAction SilentlyContinue |
  Select-Object Name,Source,Version | Out-File "$marker-preflight.txt" -Append
$env:Path -split ';' | Out-File "$marker-preflight.txt" -Append
```

预期：公司验收目标为 `x64`；若 `PROCESSOR_ARCHITEW6432=AMD64`，以该 override 为准。若候选 commit、API、发布目录或账号无法证明属于本任务，记录 `BLOCKED_CANDIDATE_IDENTITY`，不要继续业务断言。

## 1. 发布物前置条件

- Windows 侧提供真实 PE 格式 `node.exe` 和 `aura.exe`；Mac 不生成或替代它们。
- 运行 distribution builder 的 `--platform win32-x64`，产出 ZIP、`.sha256`、`.manifest.json` 和 `install.ps1`。
- 将这些文件发布到后端静态目录 `release-artifacts/smallkhoj-daemon` 对应的 `/downloads/smallkhoj-daemon`，并确认 manifest 的 `version`/`platform`/`sha256` 与 ZIP 一致。
- 发布前先用测试账号确认 Windows preview 的 `available=true`；没有 manifest 时应明确显示 unavailable warning，不能输出可复制的残缺 Windows 命令。

## 2. 安装（Install）

- [ ] 干净用户环境中 `Get-Command node,npm,npx` 不返回命令（或记录例外）。
- [ ] 执行产品提供的 PowerShell 命令（脱敏后记录）：

  ```powershell
  $env:AURA_DOWNLOAD_BASE_URL = "https://<server>/downloads/smallkhoj-daemon"
  irm "$env:AURA_DOWNLOAD_BASE_URL/install.ps1" | iex
  ```

- [ ] 安装器拒绝架构不匹配或未知架构，并给出可读错误。
- [ ] `%LOCALAPPDATA%\\Aura\\versions\\v<version>-win32-x64` 包含 `aura.exe`、私有 `node.exe`、`dist`、生产依赖、manifest 和所需 sidecar。
- [ ] `%LOCALAPPDATA%\\Aura\\bin` 与用户 PATH 更新成功；打开新 PowerShell 后 `aura --version` 成功。
- [ ] `active.json` 指向当前版本；原子切换失败时旧版本仍可用。

## 3. 初始化（Setup）

```powershell
aura setup --name "<computer-name>" --server-url "https://<server>"
aura status --json
```

- [ ] Setup 不访问服务器、不创建 ConnectTicket。
- [ ] `%LOCALAPPDATA%\\Aura\\daemon\\config.json`、`machine-id`、日志/PID 路径符合 Windows 原生路径。
- [ ] 首次输出 machine ID；关闭并重新打开 PowerShell 后再次 Setup 保留同一 machine ID 和名称。
- [ ] `credential.json` 只在 Connect 成功后写入 machine token，且 ACL 仅限当前用户（记录 ACL 摘要，不提交 token）。
- [ ] `aura status --json` 能区分 `implementationType`、平台、架构和状态目录。
- [ ] 复制/克隆场景只通过显式 `--reset` 换 machine ID；普通升级/重连不换 ID。

## 4. 首次 Connect / Online

- [ ] Web 打开/切换 tabs/查看 Install/Setup 预览时没有 ticket 或过期时间。
- [ ] 只有点击 Connect 后才出现一次性命令和 300 秒 `expiresAt`。
- [ ] 在同一台 Windows 主机执行命令，服务器 Computer 注册为 Online，并有 heartbeat 记录。
- [ ] 失败/网络不可达/权限被拦截时，页面在有限时间内给出重试动作，不无限 pending。

## 5. Reconnect / 冲突

- [ ] 停止当前 daemon 后，Web 重连卡只显示 Connect，不重复 Install/Setup。
- [ ] Reconnect 使用当前发布的最新兼容版本，复用原 machine ID、Computer 名称和本地配置。
- [ ] 活跃旧进程或有效远端 lease 存在时，拒绝重复启动并显示停止/等待/重试原因。
- [ ] 本地旧进程存在但远端 lease 已失效时，只尝试 graceful stop；停止失败不得 force kill。

## 6. 升级、失败恢复与回滚

- [ ] 新版本完整下载、SHA-256 校验、分层写入并原子切换；旧版本目录保留到新进程健康。
- [ ] 本地版本高于服务器版本时默认不降级；只有显式 rollback/force 才允许降级。
- [ ] 下载失败、checksum 错误或新版本启动失败时，active pointer 和最后已知良好版本保持可恢复。
- [ ] 回滚后 machine ID、配置和 credential 不被覆盖。

## 7. 证据提交格式

放入本目录 `evidence/`，至少包括：

- `<marker>-preflight.txt`：系统/PowerShell/架构/PATH/Node 发现结果；
- `<marker>-install.txt`：安装命令输出、目录树、`aura --version`；
- `<marker>-setup.txt`：两次 Setup、status JSON（脱敏）；
- `<marker>-connect.txt`：Connect/Online/heartbeat 对账；
- `<marker>-reconnect.txt`：复用 machine ID 和冲突处理；
- `<marker>-upgrade-rollback.txt`：升级、失败恢复、回滚；
- `<marker>-summary.md`：版本、主机架构、结果、阻塞项和脱敏文件列表。

所有文件都必须注明实际 Windows 版本、CPU 架构、PowerShell 版本、候选 commit、API/前端 URL 和 PASS/BLOCKED；不得把原始 `sk_connect_`/`sk_machine_` token 写入仓库。
