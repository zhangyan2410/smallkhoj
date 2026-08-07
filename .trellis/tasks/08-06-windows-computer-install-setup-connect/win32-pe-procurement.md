# win32-x64 PE 获取办法(node.exe / codex-acp.exe / aura.exe)

> 目的:让 Mac/Linux/云端 CI 不依赖 Windows 机器,也能拿到 builder `require_pe_executable` 校验所需的 3 个合法 win32-x64 PE,从而独立构建 `smallkhoj-daemon-v0.2.6-win32-x64.zip`。
> 构建本身**不依赖 Windows**(builder 的 `sys.platform=="win32"` 守卫只管 npm/npx 解析;PE 校验只看输入文件头)。Windows 机器只对**真实主机验收**不可替代。

## 我们打包的确切版本(2026-08-07 实测)

| PE | 版本 | 官方来源 | 实测 SHA-256 |
|---|---|---|---|
| `node.exe` | Node.js v22.14.0 (win32-x64) | nodejs.org 官方 zip | `33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b` |
| `codex-acp.exe` | @zed-industries/codex-acp-win32-x64 0.16.0 | npm 平台包 | `9074f7c8b278bbdf771215bc3c2816686feb3aa155ad165f62bb8010c314da33` |
| `aura.exe` | Go 源码交叉编译 | `tools/aura-launcher/`(git 已入库) | 由源码构建,可复现 |

## 1. node.exe —— 从 nodejs.org 下载官方 win32-x64

官方 zip 里含 `node.exe`,解压取出即可。**任何平台**(Mac/Linux/Windows)都能下这个 zip,里面的 `node.exe` 就是官方编译好的 win32-x64 PE。

```bash
# 在一个临时目录(任意平台)
NODE_VERSION=v22.14.0
curl -fL -o node.zip "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win32-x64.zip"
# 校验官方 SHASUMS(同目录下有 SHASUMS256.txt)
curl -fL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" | grep "node-${NODE_VERSION}-win32-x64.zip"
# 解压取 node.exe
unzip -j node.zip "node-${NODE_VERSION}-win32-x64/node.exe" -d ./aura-build-runtime
```

校验(应等于上表):
```bash
shasum -a 256 ./aura-build-runtime/node.exe
# 期望: 33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b
```

> 版本固定为 v22.14.0(我们打包并实测的版本)。如需升级,改 `NODE_VERSION` 并重测 daemon runtime 兼容性。

## 2. codex-acp.exe —— 从 npm 取官方平台包

`@zed-industries/codex-acp` 用 npm 的 optionalDependencies 分平台发布;win32-x64 的 PE 在 `@zed-industries/codex-acp-win32-x64` 的 `bin/codex-acp.exe`。**用 `npm pack` 在任意平台都能拿到这个 tarball**(不需要 Windows)。

```bash
# 任意平台(需 npm)
mkdir codex-acp-fetch && cd codex-acp-fetch
npm pack @zed-industries/codex-acp-win32-x64@0.16.0
# 产出 zed-industries-codex-acp-win32-x64-0.16.0.tgz
tar -xzf zed-industries-codex-acp-win32-x64-0.16.0.tgz
# PE 在 package/bin/codex-acp.exe
cp package/bin/codex-acp.exe ../codex-acp.exe
```

校验(应等于上表):
```bash
shasum -a 256 ../codex-acp.exe
# 期望: 9074f7c8b278bbdf771215bc3c2816686feb3aa155ad165f62bb8010c314da33
```

> 版本固定 0.16.0(builder `copy_codex_acp_binary` 硬编码这个版本写进 sidecar manifest)。升级需同步改 builder。

## 3. aura.exe —— Go 源码交叉编译(任意平台)

源码已在 git: `tools/aura-launcher/main.go` + `go.mod`。`CGO_ENABLED=0` 零 C 依赖,Mac/Linux 用标准 Go 交叉编译产出**字节级可复现**的 win32-x64 PE。

```bash
cd tools/aura-launcher
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ../../aura-build-runtime/aura.exe .
```

> 不需要把 `aura.exe` 进 git(已 `.gitignore`);源码在 git 即可,任何环境一秒编出。

## 4. 拿到 3 个 PE 后,喂给 builder 产出完整 ZIP

builder 期望:
- `--windows-runtime-dir <dir>`:目录里放 `node.exe` + `aura.exe`
- `--codex-acp-binary <path>`:指向 `codex-acp.exe`

```bash
# 准备 runtime 目录(放 node.exe + aura.exe)
mkdir -p aura-build-runtime
# (把上面 1、3 步产出的 node.exe 和 aura.exe 放进这个目录)

python scripts/build_daemon_distribution.py \
  --root . \
  --output-dir release-artifacts/smallkhoj-daemon \
  --platform win32-x64 \
  --source-revision "$(git rev-parse HEAD)" \
  --windows-runtime-dir ./aura-build-runtime \
  --codex-acp-binary ./codex-acp.exe \
  --clean-output-dir \
  --json
```

产出:
- `smallkhoj-daemon-v0.2.6-win32-x64.zip`(含 aura.exe/node.exe/dist/node_modules/sidecars/codex-acp/codex-acp.exe/manifest.json/package.json)
- `.sha256` / `.manifest.json` / `install.ps1` / `.tgz`

## 5. 校验(builder 内置 PE 头检查)

builder 的 `require_pe_executable` 会对 3 个输入校验 MZ + PE\0\0 头;Mac Mach-O 改名 `.exe` 会被拒。所以:
- **node.exe / codex-acp.exe 必须是官方 win32-x64 PE**(不是本机编译的,不是 Mac 二进制改名)
- 只要按上面 1/2 步从官方渠道取,builder 校验必过

## 6. 为什么不进 git / 不靠 Windows 机器传

- 这两个 PE 加起来 ~260MB(node.exe 79.5MB + codex-acp.exe 178.9MB),进 git 不合理
- `release-artifacts/` gitignored,Mac `git pull` 拿不到产物
- 但两个 PE 都是**官方公开渠道可下载**,且 builder 跑在任意平台都能产 ZIP
- 所以 Mac/云端 CI 完全可以:下载 2 个官方 PE + 编译 aura.exe + 跑 builder = 独立产出 ZIP,不依赖 Windows 机器

## 唯一仍需 Windows 机器的事

**真实主机验收**:install.ps1 在 PS 5.1 的 MAX_PATH/CRLF/BOM、CodexSandbox 拦截、icacls ACL、PATH 刷新、aura/aura.cmd 在真 cmd/PowerShell 的可发现性——这些 Mac/Linux 发现不了,必须真 Windows 跑(Windows 侧已完成,见 `evidence/REAL_windows-computer-install-setup-connect_20260807020416-*`)。
