# Agent-Facing CLI 合约 + Prompt Impact Checklist

## 概述

本文档记录 `feat/slock-cli-productization` 分支上所有 CLI 输出格式变化，
供 @zy-ean review 提示词影响。**提示词的最终措辞由 @zy-ean 决定。**

---

## 一、全局变化

### 1.1 输出模式

| 模式 | Before | After |
|------|--------|-------|
| 默认 | raw JSON passthrough | canonical 人类可读文本（见 §1.5 例外） |
| `--format json` | — | raw JSON passthrough（兼容旧行为） |

**Prompt 影响**：如果 runtime prompt 里解析 CLI 输出的 JSON，现在默认输出
不再是 JSON。需要改用 `--format json`，或让模型按 canonical 文本理解。

### 1.2 错误格式

```
Before: {"ok":false,"code":"MISSING_TARGET","message":"Missing --target"}
After:  Error: Missing --target
        Code: MISSING_TARGET
        Next action: Specify the target with --target "#channel" or --target dm:@user
```

**Prompt 影响**：模型如果用 `JSON.parse(stderr)` 判断错误，会失败。
新格式是三行文本，模型可以直接读 Error/Code 判断错误类型。

### 1.3 写安全门

```
Before: {"ok":false,"code":"WRITES_NOT_ALLOWED","message":"..."}
After:  Error: Write-capable slock commands require SLOCK_ALLOW_WRITES=1
        Code: WRITES_NOT_ALLOWED
        Next action: This permission must be granted by the daemon or operator via environment variable or launch config.
```

**关键**：CLI 不暴露 `--allow-writes` flag。写权限只能来自 daemon/operator env。

### 1.4 Credential 脱敏

所有错误输出中的 `sk_agent_*`、`sk_machine_*`、`sap_*`、`Bearer` token、
credential 文件路径都会被替换为 `<redacted>`。

### 1.5 例外：仍然 passthrough / 特殊输出的命令

以下命令不走 canonical 文本格式，即使不加 `--format json` 也是特殊输出：

| 命令 | 输出方式 | 原因 |
|------|----------|------|
| `memory context` | raw JSON passthrough | 返回复杂的 context-manifest 结构，不适合简化为文本 |
| `reminder log` | raw JSON passthrough | 返回 lifecycle entries 列表，保持 JSON |
| `attachment view/download --output` | 二进制文件 + canonical 下载状态 | 写入本地文件；默认文本输出 `Downloaded to: <path>`，`--format json` 输出 `{ok, output}` |

**Prompt 影响**：`memory context` / `reminder log` 仍然需要按 JSON 处理；附件下载需要按本地文件输出处理。

---

## 二、逐命令输出对照

### message check

```
Before: {"messages":[{"target":"#general","msg":"abc12345","time":"...","type":"human","sender":"@alice","content":"hello"}]}
After:  [target=#general msg=abc12345 time=2026-07-08T15:00:00Z type=human] @alice: hello
        No more new messages.
```

### message read

```
Before: {"messages":[...]}
After:  [target=#general msg=abc12345 time=... type=human] @alice: hello
        [target=#general msg=def67890 time=... type=agent] @bot: hi
```

### message send

```
Before: {"state":"sent","messageSeq":42}
After:  Message sent. (seq=42)
```

### message search

```
Before: {"results":[{"target":"#general","msg":"abc12345","sender":"@alice","content":"hello world"}]}
After:  [target=#general msg=abc12345 time=2026-07-08T10:00:00Z] @alice: hello world
```

### message resolve

```
Before: {"target":"#general:abc12345","channel":"#general","threadId":"abc12345"}
After:  Target: #general:abc12345
        Channel: #general
        Thread ID: abc12345
```

### message react

```
Before: {"reacted":true,"body":{"reaction":"+1"}}
After:  Reaction added.    (or "Reaction removed." with --remove)
```

### server info

```
Before: {"id":"server-1","channels":[{"name":"general"}]}
After:  Server: My Server

        Channels:
          #general [public, joined] — General chat

        Agents:
          @bot (online) — Helper

        Humans:
          @alice [owner]
```

### channel members

```
Before: {"members":[{"name":"alice","role":"owner"}]}
After:    @alice [owner]
          @bot (online) — Helper
```

输入兼容：优先使用 Raft 形态 `channel members <target>`，其中 target 可以是 channel、DM 或 thread；旧形态 `--channel` / `--target` / `-c` 仍可用。

### channel join / leave

```
Before: {"joined":true}
After:  Joined channel.    (or "Left channel.")
```

### channel mute / unmute

```
After:  Channel muted.    (or "Channel unmuted.")
```

输入边界：只接受 regular channel target，例如 `channel mute #general`；DM 和 thread target 会以 `INVALID_TARGET` 本地失败。写门仍然适用。

### inbox check

```
After:  Inbox update: 2 unread messages total; 1 changed target
        #mac:e987ddbf  pending: 2 messages · first msg=ea1af606 · latest sender @Cindy · latest msg=cde07759 · mention · thread
```

用途：只查看 pending inbox target 摘要，不 drain message body。

### thread read

```
Before: {"thread":{"id":"thread-1"},"replies":[]}
After:  [target=#general:abc12345 msg=def67890 time=...] @bob: reply
```

### thread unfollow

```
Before: {"unfollowed":true}
After:  Thread unfollowed.
```

### thread summary

```
Before: {"updated":true}
After:  Thread summary written.
```

### task list

```
Before: {"tasks":[{"number":1,"title":"Fix bug","status":"in_progress","assignee":"@alice"}]}
After:    #1 [in_progress] @alice — Fix bug
          #2 [todo] — Write docs
```

### task create / claim / unclaim / update

```
Before: {"state":"sent","body":{...}}  or  {"claimed":true,"body":{...}}
After:  Task created.   /   Task claimed.   /   Task unclaimed.   /   Task updated.
```

### task summary / promote

```
Before: {"ok":true}
After:  Task summary written.   /   Task memory promoted.
```

### memory read

```
Before: {"content":"# Memory\n\nNotes.","sha":"abc123","path":"notes.md"}
After:  Path: notes.md
        # Memory

        Notes.
          (sha: abc123)
```

### memory search

```
Before: {"scope":"agent","entries":[{"path":"notes.md","contentText":"Important notes"}]}
After:    notes.md: Important notes
```

### memory context

```
Before: {"scopeType":"agent","scopeId":"me","prompt":"...","topK":5,...}
After:  （raw JSON passthrough — 见 §1.5）
```

### memory write / propose / delete

```
Before: {"sha":"newsha123"}
After:  Memory written.   /   Proposal created.   /   Memory deleted.
```

### memory proposals

```
Before: {"proposals":[{"id":"p1","path":"notes.md","status":"pending"}]}
After:    p1 notes.md [pending] — Reason text
```

### memory accept-proposal / reject-proposal

```
Before: {"accepted":true}
After:  Proposal accepted.   /   Proposal rejected.
```

### profile show / get

```
Before: {"profile":{"handle":"@alice","displayName":"Alice","role":"owner"}}
After:  Name: Alice
        Handle: @alice
        Role: owner
        Status: active
```

### profile update

```
Before: {"profile":{"displayName":"New Name"}}
After:  Profile updated.
```

### reminder list

```
Before: {"reminders":[{"title":"Standup","fireAt":"...","repeat":{"cadence":"daily"},"channel":"#general","status":"pending"}]}
After:    Standup @ 2026-07-09T09:00:00Z (daily) #general [pending]
```

**注意**：status 现在显示 backend 的 label（pending/fired/cancelled），不只是 done。

### reminder log

```
Before: {"reminderId":"rem-1","entries":[]}
After:  （raw JSON passthrough — 见 §1.5）
```

### reminder schedule / create / update / snooze / cancel

```
Before: {"reminderId":"rem-1","method":"POST","body":{...}}
After:  Reminder scheduled.  /  Reminder updated.  /  Reminder canceled.
```

### integration list

```
Before: {"integrations":[{"service":"github","loggedIn":true}]}
After:    github (logged in)
          slack (disconnected)
```

### integration login

```
Before: {"login":"github","body":{...}}
After:  Login ready.
```

### manual get / search

```
After:  Manual content text...

After:    recipes/preview-env — Create preview environments
```

用途：读取或搜索 Raft agent manual / recipes，减少 prompt 内硬编码操作规则。

### auth whoami

```
After:  Agent ID: agent-1
        Server URL: http://127.0.0.1:...
        Server ID: server-1
        Client mode: managed-runner
        Secret source: agent-proxy-token-file
```

### attachment view

```
Before: {"id":"att-1","filename":"report.pdf","mimeType":"application/pdf","size":1024}
After:  ID: att-1
        Filename: report.pdf
        Type: application/pdf
        Size: 1024
```

带 `--output` 时对齐 Raft：`attachment view <id> --output <path>` 会下载附件并输出 `Downloaded to: <path>`；需要 JSON 状态时加 `--format json`。

### attachment download

```
Before: （二进制内容 + {ok:true, output:"file.bin"}）
After:  兼容 alias，等价于 `attachment view <id> --output <path>`；默认文本输出 `Downloaded to: <path>`，`--format json` 输出 `{ok, output}`
```

### attachment upload

```
Before: {"attachment":{"multipart":true,"size":12}}
After:  Attachment uploaded (id: att-new).
```

---

## 三、Prompt 影响评估

### 高影响（必须改 prompt）

1. **所有使用 CLI 输出的地方**：默认输出从 JSON 变成文本（除 §1.5 特殊输出外）。
   如果 prompt 指示模型 `JSON.parse(slock output)`，必须改为 `--format json`
   或让模型按文本理解。

2. **错误处理**：如果 prompt 指示模型检查 `JSON.parse(stderr).code`，
   需改为读取 `Code:` 行。

### 中影响（建议检查）

3. **message check/read 格式**：消息格式变了，但语义不变（target/msg/time/type/sender/content）。
   如果模型按消息头解析，新格式 `[target=... msg=... time=... type=...]` 更规则。

4. **reminder list status**：现在显示 `[pending]`/`[fired]`/`[cancelled]` 等 backend label，
   不只是 `[done]`。

5. **server info**：现在是 markdown 渲染，信息量更大但格式不同。

### 低影响（可能不需要改）

6. **写操作成功输出**：从 JSON 变成简短文本（如 "Message sent."），
   模型通常只需确认成功，不需要解析具体字段。

7. **--json body 参数**：`--json` 仍然是 body data 参数，
   不受 `--format` 影响，不需要改。

---

## 四、建议的 prompt 适配方向

（这些是建议，最终由 @zy-ean 决定）

1. 在 prompt 中明确 CLI 默认输出是人类可读文本，如需 JSON 加 `--format json`
2. 错误处理改为读取三段式 Error/Code/Next action
3. 如果有解析 server info 或 reminder list 的逻辑，适配新的 canonical 格式
4. 保持 `--json` body 参数用法不变

---

## 五、测试验证状态

- 245 tests pass, 0 fail
- 65 golden tests 覆盖主要已 canonical 化命令的成功/错误/写门输出
- `--format json` 在主要命令上验证 backward compatibility
- write-gate denial 在所有写命令上验证
- credential redaction 验证
- INVALID_JSON/INVALID_SCOPE/INVALID_PATH 本地校验验证

> 注：alias 去重后 46 条产品命令；含 alias（如 remove、list-proposals、create 等）共 48 个 COMMAND_META key。
