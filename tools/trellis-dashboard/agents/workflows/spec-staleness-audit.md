---
id: spec-staleness-audit
name: Spec 时效核验
description: 逐节对照现行代码验证 .trellis/spec 是否失效，更新 spec-audit.json（不改 spec 正文，发现与建议写入审计结果）
timeout_minutes: 40
---

你在 /Users/code/project/smallkhoj 仓库执行「Spec 时效核验」固定工作流。目标：验证 .trellis/spec/ 下每个 Markdown 文件的每个章节内容是否仍符合现行代码，把结论写入 .trellis/spec/spec-audit.json。

## 执行纪律

- **顺序执行，不要派生子代理/并行任务**（headless 模式下并行子代理不稳定）；逐项做完再做下一项。

## 背景

- 这个仓库的 spec 是给 AI/开发者的可执行契约库；代码演进后 spec 会漂移失效。
- spec-audit.json 是台账，schema 为 trellis.spec-audit.v1：
  {"schema": "trellis.spec-audit.v1", "auditedAt": "<今天>", "method": "...", "files": [{"path": "<相对 .trellis/spec/ 的路径>", "sections": {"total": n, "current": n, "partial": n, "stale": n, "unverifiable": n}, "findings": [{"section": "<节标题>", "verdict": "partial|stale|unverifiable", "evidence": "<≤1行证据>"}]}]}
- 已有 findings 里带 "fixed": true 的条目表示已被修复，本轮重新判定后以新结果为准（保留 fixed 标记仅当问题确实仍在但已修）。

## 方法（严格遵守）

1. 列出 .trellis/spec/{backend,frontend,guides}/ 全部 .md 文件。三个空模板文件（backend/directory-structure.md、error-handling.md、logging-guidelines.md）保持 stale 判定即可，不必深审。
2. 逐文件列出全部 `## `/`### ` 章节。
3. 每节抽 1-3 个最具体的可验证断言（组件名/函数/路径/命令/常量/端口号），用 rg/read 在 frontend/、backend/、agent/daemon/、scripts/、Makefile 里验证。抽样即可，不必逐字。
4. 判定：
   - current：抽查断言与代码一致（不进 findings）
   - stale：代码已矛盾（给证据：实际路径/组件/行为）
   - partial：节内部分失效（说明哪半）
   - unverifiable：纯流程性/前瞻方法论，无从对码
5. 重写 .trellis/spec/spec-audit.json：auditedAt 更新为今天，全部文件重判（不是增量合并），保持 schema 一致。

## 边界

- 只允许写 .trellis/spec/spec-audit.json 这一个文件；不修改 spec 正文、不碰代码、不 git commit。
- 不要运行测试套件或启动服务；验证只用静态读取（rg/cat/ls）。
- 完成后输出一段中文总结：总节数、current/partial/stale/unverifiable 计数、新发现的最危险 3 个失效节。
