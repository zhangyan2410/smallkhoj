# TWD 打包与分发

状态：TODO
创建：2026-06-01
负责人：张岩.ean

## 背景

twd.py 浏览器自动化 CLI 已完成核心功能（eval/scan/input/click/act/groups），
当前以 `python twd.py` 方式运行，需要源码。目标是打包为独立二进制，隐藏源码，
体验类似 Kimi WebBridge 的 `kimi-webbridge` 命令。

## 当前状态

- `twd.py`：CLI 入口（Python）
- `twd.cmd` / `twd.ps1` / `twd`（无后缀）：wrapper 脚本，转发到 `python twd.py`
- `tmwd_slock_bridge/`：独立 Chrome 扩展（端口 28765，支持 tabGroups）
- `tmwd_cdp_bridge/`：GA 共享版 Chrome 扩展（端口 18765）
- `TWD_PORT` 环境变量切换端口，`TWD_TOKEN` 支持 token 认证

## TODO

### Phase 1：PyInstaller 打包
- [ ] 用 PyInstaller 将 twd.py 打包为 `twd.exe`
- [ ] 打包产物放到 `~/.twd/bin/` 或项目 `dist/`
- [ ] 加入 PATH 后可直接 `twd tabs`
- [ ] 不暴露 .py 源码

### Phase 2：一键安装脚本
- [ ] 类似 Kimi WebBridge 的 `install.sh` / `install.ps1`
- [ ] 下载二进制 → 写入 `~/.twd/bin/` → 注册 PATH
- [ ] 检测并提示安装 Chrome 扩展（tmwd_slock_bridge）
- [ ] 启动后台 serve 进程

### Phase 3：扩展自安装
- [ ] `twd install-extension` 命令自动加载 Chrome 扩展
- [ ] 或打包时把扩展嵌入二进制，首次 serve 自动注入
- [ ] 解决 MV3 service worker 冷启动问题（当前靠 onInstalled + content_scripts 事件）

### Phase 4：集成到 slock daemon
- [ ] slock daemon 启动时自动启动 twd serve（TWD_PORT=28765）
- [ ] twd serve 作为 daemon 子进程，生命周期由 daemon 管理
- [ ] 类似 Kimi WebBridge 的 session 概念，每个 agent 用独立 group

## 不做

- MCP 协议接口（保持 CLI + JSON）
- 权限隔离 / 多用户
- HTTP API（保持 WS）

## 参考

- Kimi WebBridge：`~/.kimi-webbridge/bin/kimi-webbridge.exe`，一键安装 + daemon 管理
- slock CLI：`slock message send`，独立二进制
