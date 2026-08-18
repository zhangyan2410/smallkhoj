# 成员身份、建议与移除 UI 契约（contract）

## 1. 作用域（Scope）/ 触发条件

本契约适用于注册、Agent 创建/编辑、成员列表、频道输入区（composer）建议、
通知、从消息创建任务，以及频道（Channel）成员管理。UI 中文优先且双语。
产品标签是 `名字` / `Name`；不要把实现术语 `handle` 当作相互竞争的字段
暴露。

## 2. 签名

```typescript
validateMemberName(raw: string): MemberNameValidation
activeComposerToken(text: string, caret: number): ComposerToken | null
replaceComposerToken(text: string, token: ComposerToken, value: string): string
mentionedAgentHandle(memberIds: string[], channelMembers: Member[], fallback: Member[]): string | null
markChannelMemberRemoved(barrier, channelId, memberId): void
markChannelMemberPresent(barrier, channelId, memberId): void
filterRemovedChannelMembers(barrier, channelId, members): Member[]
```

相关的 action 与请求：

```text
signup -> Better Auth -> POST /api/v1/auth/better-auth/bridge { name }
create Agent -> POST /api/v1/members/agents { name, description?, ...runtime fields }
send message -> { content, mentionMemberIds: string[] }
remove Agent -> DELETE /api/v1/channels/{channelId}/members/{agentId}
```

## 3. 契约

### 名字与 Description UI

- Sign Up 要求名字（Name）并显示不可变的 `@name` 预览/可用性。Sign In
  没有名字字段。引导失败保持可重试，且不重复 Better Auth 注册。
- Agent 创建只有一个 Agent 名字字段，没有分开的 Name/handle/displayName
  概念。名字 + 计算机占第一行，Description 占第二行，Runtime 与 Provider
  占第三行；窄布局（layout）保持该语义顺序。
- Description 明显可选、纯文本、面向专长方向，并显示本地化的 `0/200`
  计数器。人类界面绝不提交它。
- Agent 标签渲染规范 `name`/`handle`；人类 displayName 只能作为次要装饰。
  Agent displayName 不是 API/UI 概念。

### Runtime 与 Provider 选项是检测出来的，不是硬编码的

- 创建 Agent 的 Runtime 下拉由
  `runtimeOptionsFromDetected(computers, filters)`（`frontend/lib/runtime-options.ts`）
  从 `computer.detectedRuntimes` 构建——与 Provider 下拉
  （`detectedProviderOptions`，同样来自 `detectedRuntimes`）是同一数据源。
  一个来源，两个控件；它们绝不能分叉。
- 选项状态：检测到的 runtime → 可选；已知但未检测到（`claude_code`、
  `codex`）→ 渲染为禁用的"不可用"项（`components/create-agent-form.tsx` 中的
  `disabled: !opt.available`），而不是隐藏；`custom` 永远可选；捆绑的 Pi
  永远可选并带捆绑标记。`not_installed` 条目是存在性证据，不是可用性——
  它们不得让选项变为可选。
- 在表单里硬编码 runtime 或 provider 列表，或"为了测试"让未检测项可选，
  都是契约违规：用户会选到没有任何已连接计算机能运行的 runtime。

### 输入区与目标定位

- `@` 建议只包含当前频道成员。选择绑定到 Member UUID，并插入服务器提供的
  带上下文 `reference`。
- `#` 建议只包含已授权、当前服务器、非 DM 的频道。频道绝不获得跨服务器
  限定。
- 键盘、指针/触摸、Escape、窄布局、滚动包含和中文 IME 组合使用共享的
  建议表面。
- 通知与"从消息创建任务"使用已持久化的 `mentions` Member UUID。它们绝不
  扫描正文子串、不使用仅 ASCII 的提及正则、不比较 displayName。

### 移除 Agent UI

- 只有所有者/管理员人类能看到该操作；DM、人类和未授权查看者不渲染它。
- 该操作无需悬停即可见，在确认对话框中同时点名 `@agent` 和当前频道，并
  声明它只移除频道成员关系（membership）。
- 共享的破坏性对话框负责 pending、可重试失败、失效（stale）404、成功、
  焦点以及进行中不可关闭状态，配双语文案。
- 成功后立即从面板移除该成员，因此也从 `@` 建议中移除，然后重新拉取权威的
  花名册（roster）。
- 一个频道作用域的移除屏障（barrier）过滤迟到/失效的花名册响应，使它们
  无法复活被移除的行。一次确认的本地或实时重新加入会清除该屏障。另一个
  频道中的同一 Member ID 不受影响。

### 管理员专属入口按角色隐藏，而不是按 403

- 服务器管理入口由 `canManageActiveServer(session)`
  （`frontend/lib/server-permissions.ts`）把守：**当前选中**服务器的
  **活跃**所有者/管理员成员关系。在其他服务器上的所有者角色绝不授予
  访问，且状态必须是 `active`。
- 未授权用户根本不得渲染该入口——隐藏它，绝不在点击后显示再以 403 失败
  （08-13 R3）。先渲染再拒绝会泄露该表面存在，并产生死胡同错误。
- 任何新增的管理员专属入口必须在同一次变更中带上门禁角色检查；无门禁的
  渲染是安全回归，不是样式后续。

## 4. 校验与错误矩阵

| 条件 | 必需的 UI 结果 |
| --- | --- |
| 名字语法/长度/保留后缀非法 | 本地化行内错误；禁用提交 |
| 名字可用性待定 | 显式 pending 状态；不做乐观的可用性断言 |
| 后端名字冲突 | 来自权威响应的可重试本地化错误 |
| Description 超过 200 个码点 | 本地化错误并禁用提交 |
| IME 组合进行中 | Enter 不提交建议也不发送 |
| 没有匹配的 `@` 或 `#` 建议 | 本地化空状态；仍可继续输入 |
| 移除请求 pending | 对话框保持打开且不可关闭 |
| 移除返回 403/404/网络错误 | 可见的可重试对话框失败；行保留 |
| 移除成功 | 行/建议立即消失；播报成功状态 |
| 成功移除后失效的 GET 才解析返回 | 被移除的行保持被过滤 |

## 5. 好 / 基线 / 坏案例

- 好：中文默认的 Agent 创建接受 `排障专家` 和可选的专长 Description，且
  不改变 runtime/provider 行为。
- 好：选择冲突成员时插入 `@ean-s7k2m`，同时选择状态记录其 UUID。
- 好：移除成功，一个先前在途的花名册 GET 返回旧行，移除屏障保持该行
  隐藏。
- 基线：无冲突；建议和消息使用紧凑的 `@ean`。
- 坏：把 Agent `displayName` 当作第二个可编辑或首选标签显示。
- 坏：解析 `/@[A-Za-z0-9_-]+/` 来决定通知或任务受理人。
- 坏：乐观移除后跟一个无防护的 `setMembers(response.members)`。

## 6. 必需测试

- 后端/前端 Unicode 名字校验的共享 fixture 一致性。
- 注册的 Sign Up/Sign In 字段分离、不可变预览、引导重试和安全的邀请
  `returnTo`。
- Members 与 Chat 入口共享 Agent 表单、双语 Description、计数器、响应式
  顺序、加载/禁用/错误状态。
- 输入区光标替换、带上下文的限定引用、Member UUID 提交、频道作用域、
  键盘/触摸/IME、空/错误状态。
- 通知与任务受理人测试证明只有已持久化的 Member ID 能定位成员，包括中文
  Agent 名字。
- 移除授权/来源契约、破坏性对话框状态、立即更新、失效花名册屏障、显式
  重新加入恢复。
- 浏览器证据使用 `./twd` 附精确 URL/DOM，且仅当可见 UI 变化时才附截图。

## 7. 错误 vs 正确

### 错误

```typescript
const mentioned = content.match(/@[A-Za-z0-9_-]+/g)
const agent = allMembers.find((item) => item.displayName === mentioned?.[0])
setMembers(await fetchRoster()) // may resurrect a just-removed Agent
```

### 正确

```typescript
const assignee = mentionedAgentHandle(message.mentions ?? [], members, allMembers)
markChannelMemberRemoved(removalBarrier.current, channelId, agentId)
setMembers((current) => current.filter((member) => member.id !== agentId))
setMembers(filterRemovedChannelMembers(removalBarrier.current, channelId, await fetchRoster()))
```
