---
id: spec-zh-refresh
name: 中文镜像刷新
description: 重译 manifest 哈希过期的 spec 中文镜像、补译新增文件，更新 manifest.json
timeoutMinutes: 60
---

你在 /Users/code/project/smallkhoj 仓库执行「中文镜像刷新」固定工作流。目标：让 `.trellis/spec-zh/` 与 `.trellis/spec/`（英文，唯一事实来源）保持同步。

## 执行纪律

- **顺序执行，不要派生子代理/并行任务**（headless 模式下并行子代理不稳定）；逐项做完再做下一项。

## 步骤

1. 读 `.trellis/spec-zh/manifest.json`（记每个文件的源 sha256）。计算每个 `.trellis/spec/**/*.md` 当前 sha256：
   - 哈希 ≠ manifest 记录 → **过期**，需重译该文件
   - spec 里有但 manifest 没有 → **新增**，需新译
   - 三个空模板（backend/directory-structure.md、error-handling.md、logging-guidelines.md）**跳过**（无内容，且其去留待用户定）
2. 对每个需译文件：读英文源，写 `.trellis/spec-zh/<相同相对路径>`，然后更新 manifest 该文件的新 sha256。

## 翻译规则（严格）

- 1:1 翻译，不增删内容，标题层级/列表/表格结构保持一致
- 代码块（``` 围栏内）一个字符不动；行内反引号里的字面量（标识符/命令/路径/字段名/状态值）不动
- 术语首次出现用「中文（English）」之后只用中文，统一术语表：contract→契约 / scenario→场景 / scope→作用域 / lease→租约 / cursor→游标 / unread→未读 / badge→徽标 / event→事件 / envelope→信封 / fail-closed→失败关闭 / idempotent→幂等 / optimistic lock→乐观锁 / high-water mark→高水位 / backoff→退避 / onboarding→接入 / rollout→发布上线 / rollback→回滚 / baseline→基线 / snapshot→快照 / heartbeat→心跳 / watchdog→看门狗 / stale→失效 / drift→漂移 / invariant→不变量 / backfill→回填 / tombstone→墓碑 / fanout→扇出 / payload→载荷 / migration→迁移 / graceful→优雅 / turn→回合 / takeover→接管 / hydration→水合 / layout→布局 / rail→侧栏 / drawer→抽屉 / dialog→对话框 / palette→色板 / surface→表面 / material→材质 / membership→成员关系 / revision→修订号 / thread→线程 / memory→记忆 / summary→摘要
- 保留原名：daemon、runtime 产品名（claude_code/codex/goose/pi/opencode）、SSE、WS、ACP、API、CLI、CI、alembic、Caddy、Feishu、Jira、Postgres、Playwright、Docker、Bun、better-auth、next-intl、Next.js、React、dnd-kit、Inkframe（首次"墨框（Inkframe）"）、shuimo（水墨）
- 简明书面中文，不要翻译腔；英文硬换行段落可合并为单行（行数差异正常）

## 边界

- 只允许写 `.trellis/spec-zh/**`。不修改英文 spec、不碰代码、不 git commit。
- 完成后输出中文总结：重译 n、新译 m、跳过（空模板）k、无需变动 j。
