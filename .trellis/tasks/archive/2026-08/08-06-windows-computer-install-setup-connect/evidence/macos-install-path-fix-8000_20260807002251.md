# Mac 安装命令 PATH 修复证据

**marker：** `REAL_macos-daemon-path-fix-8000_20260807002251`  
**候选 commit：** `0b6222202921001e88d6aec159410ad54543edb6`  
**主机：** macOS 15.5 Darwin arm64；Node `v22.14.0`；npm `10.9.2`  
**carrier：** 当前 worktree 的 FastAPI StaticFiles carrier，`http://127.0.0.1:8000`，
`uvicorn main:app --host 127.0.0.1 --port 8000 --lifespan off`（PID 69302）。

## 复现的真实问题

按用户原命令执行，命令本身退出码为 `0`，但安装后在同一个新 shell 中：

```text
AURA_ON_PATH=no
/Users/lee/.smallkhoj/bin/aura --version -> 0.2.6
```

也就是说下载、解包和 launcher 没坏，真正缺陷是产品安装命令完成后没有把
`/Users/lee/.smallkhoj/bin` 注入当前命令链；下一步 UI 的 `aura setup` 会因此报
`command not found`。

## 修复

- `backend/routers/public_api.py` 生成的 macOS/Linux Install 命令现在以
  `&& export PATH="$HOME/.smallkhoj/bin:$PATH"` 收尾，Setup 可以在同一个终端继续执行。
- `scripts/build_daemon_distribution.py` 生成的 `install.sh` 现在打印可直接粘贴的
  `export PATH=".../.smallkhoj/bin:$PATH"`，不再只给模糊的“if aura is not found”提示。
- 后端 command contract 回归：**12/12 PASS**；distribution builder 回归：**8/8 PASS**。

## 修复后真实命令

```bash
curl -fsSL http://localhost:8000/downloads/smallkhoj-daemon/install.sh \
  | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=http://localhost:8000/downloads/smallkhoj-daemon bash \
  && export PATH="$HOME/.smallkhoj/bin:$PATH" \
  && command -v aura \
  && aura --version
```

实际输出：

```text
Installed AuraTeam daemon 0.2.6 (darwin-arm64) to /Users/lee/.smallkhoj/daemon/versions/v0.2.6-darwin-arm64
Run now: export PATH="/Users/lee/.smallkhoj/bin:$PATH"
/Users/lee/.smallkhoj/bin/aura
0.2.6
```

随后在同一隔离状态根执行 `aura setup` 成功；`aura status --json` stdout 是单一可解析
JSON，停止状态退出码 `1`（预期语义）。安装包 manifest 的新 SHA-256 为
`8fbd0052d5e0de6fee286266f7bac657d29b43302c99bdb2a60fd1f0c62a859a`，
`sourceRevision` 为本文件候选 commit。

## 边界

这次证据证明的是 macOS 安装命令到 CLI/PATH/Setup 的链路；8000 carrier 仍以
`lifespan off` 运行，因此不扩大为真实 SmallKhoj backend Online 或云端 Connect 通过。
