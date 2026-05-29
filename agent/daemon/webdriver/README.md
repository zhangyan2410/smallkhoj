# TMWebDriver 轻量拆出版

目标：先给自己、Claude Code、Codex 使用，不做复杂 daemon / MCP / 权限模型。  
形态：一个常驻 master + 一个 CLI。源码和 Chrome 扩展都在本目录，后续可以直接改。

## 目录

- `twd.py`：CLI 入口。
- `tmwebdriver_core.py`：从 GA 拆出的 TMWebDriver 核心。
- `tmwd_cdp_bridge/`：Chrome 扩展源码，负责连接本机 `127.0.0.1:18765`。
- `requirements.txt`：Python 依赖。

## 安装依赖

```powershell
cd D:\ai\khoj\smallkhoj\agent\daemon\webdriver
python -m pip install -r requirements.txt
```

## Chrome 扩展

如果当前 Chrome 已经装过 GA 的 `TMWD CDP Bridge`，通常不用重装。

如果没装：

1. 打开 Chrome：`chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择：`D:\ai\khoj\smallkhoj\agent\daemon\webdriver\tmwd_cdp_bridge`

扩展会连接本机 `ws://127.0.0.1:18765`，并暴露 cookies / tabs / CDP / JS 执行能力。

## 推荐使用方式

开一个长期终端跑 master：

```powershell
cd D:\ai\khoj\smallkhoj\agent\daemon\webdriver
python twd.py serve
```

然后其他 agent / 终端用 CLI 调用：

```powershell
python D:\ai\khoj\smallkhoj\agent\daemon\webdriver\twd.py tabs
```

输出是 JSON，适合 Claude Code / Codex 解析。

## 常用命令

### 列出 tab

```powershell
python twd.py tabs
```

### 执行 JS

注意：JS 里使用 `await` 时，必须显式 `return`。

```powershell
python twd.py eval "return {title: document.title, url: location.href}"
```

指定 tab：

```powershell
python twd.py eval --tab 123 "return document.body.innerText.slice(0, 500)"
```

按 URL 匹配：

```powershell
python twd.py eval --url-match slock.ai "return location.href"
```

从文件执行：

```powershell
python twd.py eval --file script.js
```

从 stdin 执行：

```powershell
@'
const r = await fetch(location.href);
return {status: r.status, url: location.href};
'@ | python twd.py eval -
```

### 扫页面

文本：

```powershell
python twd.py scan --text --url-match slock.ai
```

HTML 写文件：

```powershell
python twd.py scan --out page.html --url-match slock.ai
```

### 导航

```powershell
python twd.py goto --url-match slock.ai "https://example.com"
```

### 输入和点击

```powershell
python twd.py input --url-match slock.ai "textarea" "hello from cli" --contains "@deepseek"
python twd.py click --url-match slock.ai "button" --contains "Send"
```

`input` 会用原生 value setter，并派发 `input/change` 事件。  
`click` 是 JS click；如果页面要求 `isTrusted=true`，后续再加 CDP 坐标点击。

### CDP 调用

```powershell
python twd.py cdp --url-match slock.ai Runtime.evaluate "{\"expression\":\"document.title\",\"returnByValue\":true}"
```

截图：

```powershell
python twd.py screenshot --url-match slock.ai shot.png
```

### 原始扩展命令

```powershell
python twd.py ext "{\"cmd\":\"tabs\"}"
python twd.py ext --url-match slock.ai "{\"cmd\":\"cookies\"}"
```

支持的原始命令来自扩展：`tabs` / `cookies` / `cdp` / `batch` / `management`。


### 紧凑 JSON 输出

`--compact` 是全局参数，必须放在子命令前面：

```powershell
python twd.py --compact tabs
python twd.py --compact scan --text --url-match slock.ai
```

这样 stdout 仍是纯 JSON，但会压成单行，更适合其他 agent 解析。

## 给 Claude Code / Codex 的最小提示词

```text
浏览器自动化可用 CLI：D:\ai\khoj\smallkhoj\agent\daemon\webdriver\twd.py
先假设用户已开一个常驻：python twd.py serve
常用：
- python twd.py tabs
- python twd.py scan --text --url-match <domain>
- python twd.py eval --url-match <domain> "return document.title"
- python twd.py input --url-match <domain> "textarea" "文本" --contains "占位/标签关键字"
- python twd.py click --url-match <domain> "button" --contains "按钮文字"
输出都是 JSON；失败时看 ok=false/code/message。
单行 JSON 用：python twd.py --compact <cmd> ...（--compact 放在子命令前）。
JS 中 await 必须显式 return。
```

## 排障

1. `tabs` 为空：确认 Chrome 已打开普通网页，不要只开 `chrome://` / `about:blank`。
2. 确认扩展已安装并启用：`TMWD CDP Bridge`。
3. 确认 master 在跑：`python twd.py serve`，端口是 `18765/18766`。
4. 如果扩展刚装或服务刚启动，等 5 秒或刷新网页。
5. 后台 tab 可能被节流；关键操作可以先切到目标 tab。

## 设计取舍

当前版本故意保持简单：CLI + JSON 输出，方便 Claude/Codex 用 shell 调用。后续如果要给别人用，再加 MCP/HTTP API、权限隔离、日志审计、CDP 坐标点击等。 
