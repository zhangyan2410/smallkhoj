---
topics: [ai-agent, tooling, setup]
doc_kind: note
created: 2026-06-17
updated: 2026-06-19
---

> 对应文章：`ai-coding-agent-cost-optimization.md`
> 配置目标：Claude Code + Codex
> 更新时间：2026-06-17

## 已安装工具

| 工具 | 版本 | 安装方式 | 作用 |
| --- | --- | --- | --- |
| RTK | 0.42.4 | 官方 install script → `~/.local/bin/rtk` | 压缩终端命令输出（git/test/grep 等） |
| context-mode | v1.0.162 | `npm install -g context-mode` | MCP server，沙箱化工具返回值、保留 compact 现场 |
| Graphify | 0.8.40 | `uv tool install graphifyy` | 代码知识图谱，AI 查图替代反复 grep |

## 暂不配置

- **headroom**：全局代理层，改动较大，后续评估后再开。
- **CodeGraph**：与 Graphify 同类型，先保留 Graphify。
- **Caveman**：主要面向 CodeBuddy，对 Claude Code / Codex 无官方支持。

## Claude Code 配置

### 1. RTK

已写入 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "rtk hook claude"
          }
        ]
      }
    ]
  }
}
```

作用：Bash 命令自动被改写成 `rtk xxx`，输出变精简。

验证：

```bash
rtk gain
```

### 2. context-mode

已启用 Claude Code 插件：`~/.claude/settings.json` 中 `"enabledPlugins": { "context-mode@context-mode": true }`。

验证（重启 Claude Code 后）：

```
/context-mode:ctx-doctor
/context-mode:ctx-stats
```

### 3. Graphify

已在项目 `CLAUDE.md` 中写入 graphify 规则，并在 `~/.claude/settings.json` 注册了 PreToolUse hooks。

当前项目已生成**代码图谱（code-only，无 LLM 调用）**：

```bash
cd /Users/code/project/smallkhoj
graphify update .
```

输出：

- `graphify-out/graph.json`（13 MB，13073 nodes / 17135 edges）
- `graphify-out/GRAPH_REPORT.md`（273 KB）
- `graphify-out/manifest.json`

使用方式：

```
/graphify query "daemon 启动流程"
/graphify path "CreateOrder" "inventory"
/graphify explain "AgentWorkspace"
```

> **关于语义提取**：当前图谱只解析了代码 AST，没有处理文档、论文、图片。项目里有 805 个 docs / 191 张图片，如果希望把它们也纳入图谱（例如让 AI 通过图谱查设计文档、截图），需要设置 LLM API key 后重新跑完整提取：
>
> ```bash
> # 推荐 Gemini（性价比高）
> export GEMINI_API_KEY=xxx
> # 或
> export GOOGLE_API_KEY=xxx
>
> cd /Users/code/project/smallkhoj
> graphify .
> ```
>
> 完整提取会调用 LLM 对 doc/paper/image 做语义抽取，会产生 token 费用。日常代码更新仍建议用 `graphify update .`（无 API 费用）。

## Codex 配置

### 1. RTK

已写入项目级 `.codex/hooks.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/lee/.local/bin/rtk hook codex"
          }
        ]
      }
    ]
  }
}
```

同时全局 `~/.codex/AGENTS.md` 已引用 `~/.codex/RTK.md`，提示模型在所有项目用 `rtk` 前缀。

### 2. context-mode

已在 `~/.codex/config.toml` 注册 MCP server：

```toml
[mcp_servers.context-mode]
type = "stdio"
command = "/Users/lee/.npm-global/bin/context-mode"
```

重启 Codex 后，工具列表里会出现 `ctx_execute`、`ctx_search` 等工具。

### 3. Graphify

已在项目 `AGENTS.md` 中写入 graphify 规则，并在项目 `.codex/hooks.json` 注册了 `graphify hook-check` PreToolUse hook。

当前项目已生成的是 **code-only 图谱**。如需把文档、图片也纳入，参考上方 Claude Code 一节的「关于语义提取」说明。

## 使用建议

1. **最先启用 RTK**：零感知，命令输出自动压缩，收益最明显。
2. **再开 context-mode**：解决 `/compact` 后丢失文件编辑状态、任务进度的问题。
3. **Graphify 用于大仓库**：当前项目图谱已生成，后续跨文件问题可直接问图谱。

## 常用验证命令

```bash
# RTK
rtk gain
rtk git status
rtk test cargo test

# context-mode
context-mode doctor
context-mode statusline

# Graphify
graphify --version
graphify update .        # 代码变更后更新图谱，无 API 费用
graphify query "..."
```

## 注意事项

- 以上配置修改了 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.codex/AGENTS.md`、项目 `CLAUDE.md` / `AGENTS.md`、项目 `.codex/hooks.json`。
- Codex 的 hooks 是项目级的，其他项目需要单独复制 `.codex/hooks.json` 或重新跑 `graphify codex install` / `rtk init -g --codex`。
- Graphify 当前是 **code-only 图谱**（仅 AST，无 LLM 调用）。如需把项目里的 docs / images 也做语义提取并纳入图谱，必须设置 `GEMINI_API_KEY` 或 `GOOGLE_API_KEY` 后跑 `graphify .`；这会产生 LLM token 费用，建议只在大版本整理或需要文档关联时跑一次。
- 日常代码变更后，用 `graphify update .` 更新图谱，**无 API 费用**。
