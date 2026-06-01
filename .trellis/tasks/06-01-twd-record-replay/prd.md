# TWD Record & Replay

状态：TODO
创建：2026-06-01
负责人：张岩.ean

## 背景

twd.py 浏览器自动化 CLI 已有原子操作能力（eval/scan/input/click/act/snapshot/groups）。
目标是加入"录制人操作"功能，让大模型总结为可复用的意图级 recipe，
稳定后交给小模型执行，出错上报大模型修复。

最终效果：人在 slock 上创建 task → agent 组合已验证的原子操作完成浏览器任务。

## 架构分层

- **twd**：录制 + 原子执行（现有命令）
- **slock**：agent 编排 + 大小模型调度
- **agent（Claude Code/Codex）**：看 recipe，调 twd 命令执行

## 功能设计

### 1. 录制（twd record start / stop）

- CLI 命令：`twd record start` / `twd record stop`
- 人控制起止，只录有效片段
- 扩展 content_script 监听 DOM 事件（click / input / scroll）
- 每个事件：
  - 生成稳定 selector（多层降级：aria-label → 文字匹配 → CSS path）
  - 调 `_ga_snap(text_only=true)` 抓操作前后 snapshot
  - 录制时脱敏：`input[type=password]` 的值替换为 `***`
- 产物存 `~/.twd/recordings/<timestamp>.json`

### 2. 录制产物格式

```json
{
  "meta": {
    "url": "https://linux.do",
    "title": "页面标题",
    "recorded_at": "2026-06-01T15:30:00",
    "duration_ms": 12000
  },
  "steps": [
    {
      "seq": 1,
      "event": "click",
      "selector": "a.title[href='/t/topic/12345']",
      "text": "按钮文案",
      "value": null,
      "snapshot_before": "...",
      "snapshot_after": "..."
    },
    {
      "seq": 2,
      "event": "input",
      "selector": "textarea.d-editor-input",
      "text": "",
      "value": "输入的内容",
      "snapshot_before": "...",
      "snapshot_after": "..."
    }
  ]
}
```

### 3. 大模型总结

- 不在 twd 里，由 slock 的 agent 完成
- 输出意图级 recipe（不是脚本）：

```json
{
  "name": "操作名称",
  "goal": "这个操作的目标",
  "steps": [
    {"intent": "做什么", "hint": "怎么找元素/操作"},
    {"intent": "做什么", "hint": "怎么找元素/操作"}
  ],
  "params": ["可变参数列表"]
}
```

### 4. 执行

- agent 拿 recipe + 当前 snapshot，用现有 twd 命令执行
- recipe 是意图（不是指令），agent 自适应页面变化
- 小模型做确定性操作

### 5. 稳定降级

- 大模型先跑新流程
- 连续 N 次成功 + 大模型标记 verified → 降级为小模型可执行
- 小模型执行时 snapshot diff 偏差超过阈值 → 自动上报大模型

## 与传统 Workflows 的区别

| | Workflows | 本方案 |
|--|-----------|--------|
| 元素定位 | 写死 selector/XPath | 小模型看 snapshot 自适应 |
| 页面变化 | 直接报错，人工修 | 小模型自适应，搞不定才上报 |
| 新场景 | 从零搭建 | 人录一遍，大模型总结 |
| 判断能力 | 无（规则匹配） | 有（LLM 理解 snapshot） |

## MVP 范围

- 事件类型：click + input + scroll（先跑通闭环）
- 录制 → JSON 文件 → 大模型总结 → agent 用 twd 执行

## 后续扩展

- 更多事件类型（keydown / drag / hover）
- recipe 存储和检索（操作库）
- 跨 tab 录制
- popup UI 按钮控制录制起止

## 实现需要的改动

### 扩展侧（tmwd_slock_bridge）
- content_script 加录制模块：监听 DOM 事件 + 生成 selector + 缓存事件队列
- background.js 加 `record_start` / `record_stop` 命令处理
- 脱敏：password 类型 input 值替换

### twd.py 侧
- 新增 `twd record start` / `twd record stop` CLI 命令
- serve 端处理录制控制消息
- 录制产物写文件

### 不改动的部分
- 现有 twd 原子命令（eval/click/input/scan/act 等）
- slock 编排逻辑（由 slock 独立负责）
