# 单活跃 daemon 租约强制（防多实例重复投递）

## Goal

同一台 computer（machine 凭证）同时只允许**一个**活跃 daemon 实例接收
runtime 命令与消息事件；后检测到的新实例接管租约，旧实例的 WS 注册与
runtime 归属被立即剥离。

## Background（2026-08-16 事故复盘）

真机事故：@ee（codex/DeepSeek）一句话收到 **6 条回复**。定位：**6 个
daemon 进程**同时认领了同一 computer（cancel-e2e-mac）——两个是测试
残留（新旧两代隔离 daemon），四个是用户 ~/.smallkhoj 下被托管拉起的
孤儿实例（其全局 credential 在 18:58 被一次 connect 流程改写后，
supervisor 连续 spawn）。每个 daemon 都收到 start_runtime、都在同一
workspace 起了自己的 runtime、每条消息六路投递 → 六个 turn 六条回复。

后端有 active_daemon_id / daemon_lease_expires_at 字段与
_apply_daemon_ws_activity，但**没有强制**：secondary 实例的 WS register
照常入 hub、push_events 对每个连接各投一份、runtime 命令不校验归属。

## Requirements（方向）

- WS register / heartbeat：daemonId ≠ computer.active_daemon_id 时——
  新实例接管（更新 active_daemon_id + lease）并**踢掉旧连接**
  （hub.remove 该 computer 全部旧 websocket）。
- start_runtime / cancel_turn 控制命令：仅投给 active daemon。
- daemon 侧：收到"租约丢失"信号时停自己的 runtimes（或至少不再消费
  消息事件），避免双写。
- 清理脚本/文档：孤儿 daemon（parent=launchd 且凭证失效）的识别与
  安全清理指引。

## Acceptance（验收方向）

- 复现事故形态（两个进程同凭证连同一 server）→ 只有一个实例的 runtime
  收到消息；另一个被踢/停。
- 单测：hub 层 secondary-register 踢旧连接；控制命令只投 active。
