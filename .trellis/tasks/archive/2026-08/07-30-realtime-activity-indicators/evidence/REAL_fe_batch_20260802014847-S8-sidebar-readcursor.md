# S8 侧栏未读 + read-cursor — 部分 PASS, 发现后端 scope.kind bug

## PASS 部分
- zy-ean 在 /tasks, 同事发 DM(curl, seq 2)→ store 正确递增:
  chat:channel:id:1400fc51 {count:2}, chat:channel:name:dm:@colleague {count:2}
- 侧栏渲染正常, 有 colleague DM 项
- 进 DM 页后, sidebar 的清除 effect 触发: POST /api/v1/chat/read-cursors HTTP 200(后端日志确认)

## FAIL 部分 + 根因(后端 bug, 非本次前端批次)
进 DM 后 store 未清零(count 仍 2), chat 徽标不消失。

根因: 后端 public_events.py:276/287 构造 SSE envelope scope 时, DM 事件 scope.kind 被硬编码为 "channel"(不是 "dm"):
  scope: dict = {"kind": "channel"}  # 对 DM 也是 channel
导致 key 不匹配:
- 递增(chatScopeKeys): scope.kind="channel" → chat:channel:id:... / chat:channel:name:dm:@colleague
- 清除(chatEntityKeys): entity.type="dm" → entityKind("dm")="dm" → chat:dm:id:... / chat:dm:name:...
- channel ≠ dm → 清除的 key 不在 store 里 → 清不掉

read-cursor 表(chat_thread_read_cursors)为空(thread 级, DM 不写 channel 级 cursor), 也是同一根因连锁。

## 影响判断
- 前端逻辑(chat-sidebar 清除 + chatEntityKeys/entityKind)正确
- 后端 public_events.py 的 scope.kind 对 DM 应为 "dm"(参照 channel 表 type 字段 public|private|dm)
- 此 bug 在后端, 不属于本次前端三连批次, 建议另立后端任务修复

## 复现
1. zy-ean 停 /tasks, 同事发 DM → store 递增(kind=channel)
2. 进 DM 页 → sidebar 清(kind=dm) → key 不匹配 → store 不清零
3. 表现: chat 徽标进 DM 后不消失, read-cursor 表空
