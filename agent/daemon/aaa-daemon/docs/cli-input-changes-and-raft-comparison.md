# CLI 输入变化 + 与 Raft 生产 CLI 命令对比

---

## 一、输入变化对 Prompt 的影响

### 1.1 新增的全局输入选项

| 选项 | 说明 | Prompt 影响 |
|------|------|-------------|
| `--format <text\|json>` | 输出格式（默认 text） | **高**：模型需要知道默认输出是文本，需要 JSON 时加 `--format json` |
| `--version` | 显示 CLI 版本 | 低：调试用，不影响协作 |
| `--help` / `-h` | 每层命令都有自动帮助 | 低：模型可自行查看帮助 |

### 1.2 输入参数兼容性

**所有旧参数格式仍然可用**（相对 smallkhoj 旧 CLI / legacy wrapper 零 breaking change on input）：

| 输入方式 | 状态 | 示例 |
|----------|------|------|
| 长选项 `--target "#general"` | ✅ 不变 | |
| 短选项 `-t "#general"` | ✅ 不变 | |
| 别名 `--channel` / `-c` | ✅ 不变 | |
| positional 参数 | ✅ 不变 | `message send --target #general hello world` |
| `--json` body data | ✅ 不变（不与 `--format` 冲突） | `task update --id 1 --json '{"k":"v"}'` |
| stdin 输入 | ✅ 不变 | `echo "content" | slock message send --target #general` |
| 多值选项 | ✅ 不变 | `task claim --channel #general --number 1 --number 2` |

### 1.3 输入校验变化（新增强，不放松）

| 校验 | Before | After | Prompt 影响 |
|------|--------|-------|-------------|
| memory scope | proxy 端拒绝 | **本地拒绝**（不发请求） | 低：更快失败，错误信息相同 |
| memory path `../` | proxy 端拒绝 | **本地拒绝** | 低：同上 |
| 数字参数 | proxy 端拒绝 | **本地拒绝**（INVALID_NUMBER） | 低：同上 |
| `--json` 无效 JSON | proxy 端拒绝 | **本地拒绝**（INVALID_JSON） | 低：同上 |
| 缺少必填参数 | JSON 错误 | 三段式错误（但 code 相同） | **中**：错误格式变了 |

### 1.4 关键安全边界变化

| 安全 | Before | After | Prompt 影响 |
|------|--------|-------|-------------|
| 写权限 | env 控制 | env 控制（CLI 不暴露 `--allow-writes`） | 低：prompt 不应教模型自启写门 |
| credential 暴露 | 可能泄露 | **所有错误输出自动脱敏** | 低：更安全，不影响正常使用 |

### 1.5 Prompt 中最可能需要改的输入相关内容

1. 如果 prompt 有示例命令，输出格式从 JSON → 文本，示例的"预期输出"部分需要更新
2. 如果 prompt 教模型解析错误 `JSON.parse(stderr)`，需改为读 `Code:` 行
3. 如果 prompt 提到"输出是 JSON"，需改为"默认输出是人类可读文本，加 `--format json` 获取 JSON"

---

## 二、与 Raft 生产 CLI 的命令对比

### 2.1 Raft 有但我们没有的命令

> 全部标为「需要」。按 @codex-m-krill 优先级排序。标「后置」的不阻塞当前迭代。

| 优先级 | Raft 命令 | 说明 | 状态 |
|--------|-----------|------|------|
| **P0** | `raft inbox check` | 收件箱摘要（不 drain 内容，只看 pending targets） | 需要 |
| **P0** | `raft channel mute` | 静音频道 | 需要 |
| **P0** | `raft channel unmute` | 取消静音 | 需要 |
| **P0** | `raft manual get` | 获取操作手册/运行规则，可缩短 prompt | 需要 |
| **P0** | `raft auth whoami` | 认证自省/运行上下文诊断 | 需要 |
| **P1** | `raft channel create` | 创建频道 | 需要 |
| **P1** | `raft channel update` | 更新频道设置 | 需要 |
| **P1** | `raft channel add-member` | 添加成员 | 需要 |
| **P1** | `raft channel remove-member` | 移除成员 | 需要 |
| **P1** | `raft server update` | 更新服务器设置 | 需要（后置）|
| **P1** | `raft integration env` | 集成环境变量 | 需要（后置）|
| **P1** | `raft integration invoke` | 调用集成 API | 需要 |
| **P1** | `raft mention` | 发送侧 @mention 操作 | 需要 |
| **P2** | `raft attachment comments` | 附件评论 | 需要（后置）|
| **P2** | `raft action prepare` | 动作卡片/quick-commit | 需要（后置）|
| **P2** | `raft integration app` | 第三方 app 注册 | 需要（后置）|
| **P3** | `raft agent login` | 设备码登录 → sk_agent | 需要（后置）— 外部 agent onboarding |
| **P3** | `raft agent list` | 列出本地 profiles | 需要（后置）— 诊断 |
| **P3** | `raft agent bridge` | Agent 桥接 | 需要（后置）— 跨 daemon 协作 |
| **P3** | `raft --profile <slug>` | Profile 凭证 | 需要（后置）— 外部 agent 场景 |

### 2.2 我们有但 Raft 没有的命令（smallkhoj 扩展）

> **后置，暂不进 prompt。** 后续等产品确定 memory/summary 体系是正式主路径，再单独纳入 prompt。

| 我们的命令 | 说明 | 状态 |
|-----------|------|------|
| `memory read` | 读取记忆内容 | 后置，暂不进 prompt |
| `memory search` | 搜索记忆 | 后置，暂不进 prompt |
| `memory context` | 获取上下文清单 | 后置，暂不进 prompt |
| `memory write` | 写入记忆 | 后置，暂不进 prompt |
| `memory propose` | 提议记忆变更 | 后置，暂不进 prompt |
| `memory proposals` | 列出提议 | 后置，暂不进 prompt |
| `memory accept-proposal` | 接受提议 | 后置，暂不进 prompt |
| `memory reject-proposal` | 拒绝提议 | 后置，暂不进 prompt |
| `memory delete` | 删除记忆 | 后置，暂不进 prompt |
| `task summary` | 写任务总结到记忆 | 后置，暂不进 prompt |
| `task promote` | 将任务记忆提升到频道 | 后置，暂不进 prompt |
| `thread read` | 读取线程消息 | 后置 — Raft 用 `message read --target <thread>` |
| `thread summary` | 写线程总结 | 后置，暂不进 prompt |
| `attachment download` | 下载附件到文件 | 后置 — Raft 用 `attachment view --output` |

### 2.3 两边都有但实现不同的命令

> 需要修改与 Raft 一致。按优先级排序。

| 优先级 | 命令 | 差异 | 对齐方向 |
|--------|------|------|----------|
| **P0** | `attachment view/download` | Raft `view <id> --output` 是下载保存；smallkhoj `view=metadata`、`download=file` | 改成 Raft 语义：`view` 支持下载，metadata 另起 `attachment info` 或兼容 alias |
| **P0** | `channel members` | Raft 支持 positional target（channel/DM/thread）；smallkhoj 是 `--channel/--target/-c` | 支持 positional target，尽量支持 DM/thread target |
| **P1** | `server info` | Raft 输出更丰富（runtime/model/computer 信息） | 补齐重要字段 |
| **P1** | `profile show/update` | 大体接近，需复核 positional target、字段名、avatar 参数 | 确认与 Raft 一致 |
| **P1** | `integration list/login` | Raft 更完整（env/invoke/app） | 补 env/invoke 后接近 Raft |
| **P2** | `task list/create/claim/unclaim/update` | 我们额外支持 channel+number dual-mode | 保留兼容，prompt 示例优先用 Raft 标准形态 |
| **P2** | `thread read` | Raft 走 `message read --target #channel:thread` | prompt 优先使用 `message read --target`，`thread read` 后置/兼容 |
| — | `message check/send/read/search/resolve/react` | 基本一致 | 无需修改 |
| — | `channel join/leave` | 基本一致 | 无需修改 |
| — | `reminder *` | 基本一致 | 无需修改 |
| — | `thread unfollow` | 基本一致 | 无需修改 |

### 2.4 总结

| 类别 | 数量 | 说明 |
|------|------|------|
| 两边都有 | ~30 条 | 其中 ~8 条需对齐差异（P0-P2），其余基本一致 |
| Raft 有我们需要补 | 20 条 | P0: 5 条（inbox/channel mute-unmute/manual/auth whoami）；P1: 8 条；P2: 3 条；P3: 4 条（后置）|
| 我们有 Raft 没有 | 14 条 | 全部后置，暂不进 prompt |

> 优先级表由 @codex-m-krill 制定，文档由 @关关 维护。实现等 @zy-ean 确认后拆任务。

---

## 三、下一步流程

1. **Phase 0（当前）**：@关关 收口文档 + 优先级表 → @codex-m-krill review → @zy-ean 确认
2. **Phase 1**：@codex-m-krill 实现 P0 对齐 → 同步 prompt refs 给 @关关
3. **Phase 2**：@能哥 真实环境验证

> **文档调整完后不马上开始实现，等 @zy-ean 确认。**
