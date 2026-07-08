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

| Raft 命令 | 说明 | 我们是否需要 |
|-----------|------|-------------|
| `raft auth whoami` | 认证自省 | ❌ 我们走 daemon proxy，不需要 agent 自行认证 |
| `raft agent login` | 设备码登录 → sk_agent | ❌ 我们通过 daemon 注册，不需要 CLI 登录 |
| `raft agent list` | 列出本地 profiles | ❌ 同上 |
| `raft agent bridge` | Agent 桥接 | ❌ daemon 管理 |
| `raft channel create` | 创建频道 | ⚠️ 可能需要 |
| `raft channel update` | 更新频道设置 | ⚠️ 可能需要 |
| `raft channel add-member` | 添加成员 | ⚠️ 可能需要 |
| `raft channel remove-member` | 移除成员 | ⚠️ 可能需要 |
| `raft channel mute` | 静音频道 | ⚠️ 可能需要 |
| `raft channel unmute` | 取消静音 | ⚠️ 可能需要 |
| `raft server update` | 更新服务器设置 | ❌ 低优先级 |
| `raft manual get` | Raft 操作手册 | ❌ 我们用自己的 prompt 体系 |
| `raft inbox check` | 收件箱摘要 | ⚠️ 可能需要 |
| `raft attachment comments` | 附件评论 | ❌ 低优先级 |
| `raft mention` | 发送侧 @mention 操作 | ⚠️ 可能需要 |
| `raft integration env` | 集成环境变量 | ❌ 我们走 daemon 管理 |
| `raft integration invoke` | 调用集成 API | ⚠️ 可能需要 |
| `raft integration app` | 应用注册 | ❌ 低优先级 |
| `raft action prepare` | 动作卡片 | ❌ 我们不做这个 |
| `raft --profile <slug>` | Profile 凭证 | ❌ 我们走 daemon wrapper |

### 2.2 我们有但 Raft 没有的命令（smallkhoj 扩展）

| 我们的命令 | 说明 | Raft 是否有对应 |
|-----------|------|----------------|
| `memory read` | 读取记忆内容 | ❌ Raft 无 memory 系统 |
| `memory search` | 搜索记忆 | ❌ |
| `memory context` | 获取上下文清单 | ❌ |
| `memory write` | 写入记忆 | ❌ |
| `memory propose` | 提议记忆变更 | ❌ |
| `memory proposals` | 列出提议 | ❌ |
| `memory accept-proposal` | 接受提议 | ❌ |
| `memory reject-proposal` | 拒绝提议 | ❌ |
| `memory delete` | 删除记忆 | ❌ |
| `task summary` | 写任务总结到记忆 | ❌ |
| `task promote` | 将任务记忆提升到频道 | ❌ |
| `thread read` | 读取线程消息 | ⚠️ Raft 通过 message read --target thread 实现 |
| `thread summary` | 写线程总结 | ❌ |
| `attachment download` | 下载附件到文件 | ⚠️ Raft 的 attachment view 可能包含 |

### 2.3 两边都有但实现不同的命令

| 命令 | Raft | 我们 | 差异 |
|------|------|------|------|
| `message check` | 有 | 有 | 输出格式不同（Raft canonical text, 我们也做了 canonical text） |
| `message send` | 有 | 有 | 基本一致 |
| `message read` | 有 | 有 | 基本一致 |
| `message search` | 有 | 有 | 基本一致 |
| `message resolve` | 有 | 有 | 基本一致 |
| `message react` | 有 | 有 | 基本一致 |
| `channel members` | 有 | 有 | **输入形态不同**：Raft 支持 positional target（channel/DM/thread）；smallkhoj 是 `--channel/--target/-c`，语义主要是 channel members |
| `channel join/leave` | 有 | 有 | 基本一致 |
| `server info` | 有 | 有 | Raft 输出更丰富（包含 runtime/model/computer 信息） |
| `task list/create/claim/unclaim/update` | 有 | 有 | 我们额外支持 channel+number dual-mode |
| `profile show/update` | 有 | 有 | 基本一致 |
| `integration list/login` | 有 | 有 | Raft 的更完整（env/invoke/app） |
| `reminder *` | 有 | 有 | 基本一致 |
| `attachment upload/view` | 有 | 有 | **语义不同**：Raft `attachment view <id> --output` 是下载文件；smallkhoj `attachment view` 是 metadata 卡片，`attachment download` 才是文件下载。即 Raft view ≈ smallkhoj download，smallkhoj view metadata 是扩展 |
| `thread unfollow` | 有 | 有 | 基本一致 |

### 2.4 总结

| 类别 | 数量 |
|------|------|
| 两边都有 | ~30 条 |
| Raft 有我们没有 | ~18 条（大部分是 auth/agent/channel 管理，优先级低） |
| 我们有 Raft 没有 | ~14 条（memory 系统 + task summary/promote + thread summary） |
| 建议优先补的 Raft 命令 | channel mute/unmute, inbox check |

---

## 三、建议下一步

1. **@zy-ean review prompt impact checklist** — 决定提示词怎么改
2. **补 Raft 缺失命令**（如果需要）— 按优先级：channel mute/unmute > inbox check > channel create/update
3. **runtime behavior gate** — 用真实 runtime 验证模型按新 canonical text 正确行动
