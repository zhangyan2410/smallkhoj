# P2: Thread、DM、Files、Activity Logs、Reminders

## 目标
完善高级功能模块，覆盖 Slock 完整产品功能。

## 依赖
- P0、P1 全部完成

## 模块清单
1. **Thread** — 消息下的子对话（message 1:N thread）
2. **DM** — 两人私聊频道（type=dm）
3. **Files** — 文件上传/下载（本地存储，后续 MinIO/S3）
4. **Activity Logs** — 操作日志（agent 启动/停止/消息投递）
5. **Reminders** — 定时提醒（schedule/snooze/cancel）
6. **Reactions** — 消息表情回应
7. **Permissions** — 15 个权限 key 精细控制

## 验收标准
- [ ] 每个模块有后端 API + 简单前端展示
- [ ] daemon CLI 对应命令能正常工作
- [ ] twd.py e2e 测试覆盖核心流程
