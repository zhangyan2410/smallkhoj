# Outcome

让 SmallKhoj 的 agent 成为「有内容的装配体」并具备自我复制入口：创建 agent = 装配 system prompt + Skill 集（+ 后续知识库/模板），装配对用户显性可见；群聊中的 agent 能按需 spawn 新 agent（带 prompt + skill 授权），子 agent 诞生事件进频道、有 lineage 和治理边界。

# Scope

三期推进（每期独立交付可用价值；本 change 默认含第一期+第二期，第三期后置另开）：

**第一期「agent 有内容、看得见 + 权限地基」**：
- 数据库：members + system_prompt + created_by；agent_skills（含 source/version/trust_level/created_by）、member_skills（装配）、skill_installs（server 安装记录）、skill_registry_cache（商城目录缓存，建表但可后置填充）；权限 policy map 扩展 manageAgents/installSkills/proposeAgents
- 后端：创建/编辑 API 接受职责与技能装配；成员查询返回装配；权限策略读写
- daemon：职责拼入 buildSlockSystemPrompt 注入（通道已验证存在）；技能清单落 AGENTS.md；capabilities 扩展同步
- 前端（外包）：表单加职责文本框+技能 chips；成员详情加职责展示+技能卡片
- 用户可见变化：创建 agent 时能写职责、选技能；详情页能看到这个 agent 是谁、会什么；admin 可给 agent 配管理权限

**第二期「agent 提议造人 + 助手 agent 代管」**：
- 后端：agent-api 提议协议（普通 agent 拟方案→确认卡片→人确认→backend 执行）+ 助手 agent 特权路径（manageAgents 直执，审计事件）；创建时指定目标频道；诞生事件（创建者/装配/频道）
- 治理：子 agent 默认频道作用域（私聊为创建时开关）；数量上限；频道归档回收；递归防护（授权只能来自 human admin）
- daemon：aura agent propose/create、aura skill create（草稿态）+ 各 runtime 指令文本更新
- 前端（外包）：提议确认卡片 + 诞生事件卡片 + lineage 标记 + 权限配置界面 + 审计流展示
- 用户可见变化：普通 agent 出方案卡片等人确认；助手 agent 可直接替你创建/装配/回收 agent（有审计）

**第三期（后置，另开 change）**：商城 registry 拉取与安装 UI、场景模板、技能自我演化、skill 脚本包与 trust 边界执行。

# Non-goals

- 不做云端托管模型 agent（SmallKhoj 的 agent 始终是本地 runtime 进程）
- 不做通用技能市场分发（先做实体与装配，市场后置）
- 不在本 change 里接入 zcode runtime（独立 TODO：docs/zcode-runtime-integration-todo.md）

# Acceptance examples

待范围确认后写。

# Constraints and invariants

- agent 创建与 runtime 启动链路（runtime_start_command + daemon_control_hub.push + 断线补投）复用现有机制，不新建旁路。
- agent spawn 必须有治理边界：权限 capability、父 lineage、computer 容量配额，防止无限递归复制。
- skill 装配必须落到 runtime 真实执行上下文（system prompt 注入 / skills 目录挂载），不是仅存 DB 的装饰字段。

# Decisions

- D0（用户已定，2026-09-11）：**前端实现委派给其他 agent 完成，用户自行安排接手方**。主会话（持 change 的 Builder）负责：Shape/契约冻结、数据库+backend+daemon 实现、前端交接包产出、集成与验收。前端 worker 只依据交接包实现 frontend/ 下改动，物理上与主会话改动（backend/、agent/daemon、docs/）不重叠。
  - 由此新增正式产物：**前端交接包**——第一期已产出：`frontend-handoff-phase1.md`（同目录，自包含：UI 形态规格 + 冻结契约 + 验收清单 + 边界）。第二期（提议卡片/诞生事件/权限配置/审计流）在 Shape 确认后产出 phase2。
- D1（用户已定，2026-09-11）：**spawn 交互 = 卡片确认式**（agent 拟方案 → 确认卡片 → 用户一键确认 → 后端原子创建）。不做 agent 自主直建。
- D2（用户方向，2026-09-11）：**创建时必须指定目标频道**（不是简单「自动加入当前频道」）。用户同时提出两个待设计关切：① 子 agent 可达性——仅在群聊可达，还是也能私聊？② 数量治理——spawn 会让 agent 越来越多、难管理。候选设计（Agent 推荐，待确认）：子 agent 默认频道作用域（只在所属频道活动/被 @），私聊作为创建时的可选开关；数量上限（每 server 或每父 agent）+ 频道归档时一键回收子 agent。
- D3（待确认）：本 change 分期方案（已重写为用户可读版本，见 Scope）。
- D4（用户提出，2026-09-11）：**权限体系是硬需求**——用户此前产品经验：给「助手 agent」特殊权限去管理其他 agent。即除卡片确认（普通 agent 的低权限提议路径）外，必须有特权 agent 管理路径。设计见「权限子系统」。
- D5（用户提出，2026-09-11）：**skill 获取与商城数据存储是后端核心问题**，需认真设计后端（来源分类、registry 数据源、安装/版本模型），不能一笔带过。设计见「Skill 后端子系统」。

## 权限子系统（Shape 设计）

现状：`agent_permissions.py` 平铺 9 能力（sendMessage/createTask/claimTask/updateTask/createReminder/updateReminder/fileWrite/updateProfile/manageIntegration），创建时持久化完整 policy map，无隐式 allow；daemon per-agent proxy token + capabilities（固定 send,read,mentions,tasks,reactions,server,channels）。

设计：
1. 能力项扩展：`manageAgents`（创建/编辑/启停/归档其他 agent）、`installSkills`（技能装配，与 manageAgents 分立，对齐万有把「不用于安装 Skill」写成边界）、`proposeAgents`（低权限提议权，普通 agent 默认有）。
2. 三层角色：server admin（人，全权，现状 require_admin_role）→ **助手 agent**（被授予 manageAgents 的特权 agent，可代用户管理 agent；是否「执行前仍需人确认」做成其自身策略项；全部操作进审计事件）→ 普通 agent（仅 proposeAgents，走卡片确认，执行者记 admin/assistant）。
3. 递归防护：授权只能来自 human admin——manageAgents 不包含「授予他人 manageAgents」，权限不可自我繁殖。
4. 落地链路：DB policy map 加键 → agent-api 鉴权扩展 → daemon proxy capabilities 同步 → slock CLI 按能力开放子命令。

## Skill 后端子系统（Shape 设计）

skill = 多文件包（SKILL.md 指令 + 可选 scripts/resources），元数据进 DB，内容落盘。

来源四类与数据通路：
1. builtin：随版本发布的仓库内目录，打进 offline bundle（离线场景默认源）。
2. user 自建：UI 创建，DB 实体 + 内容落 server 级 skills 目录。
3. agent 生成：aura skill create 产出，created_by=agent，默认草稿态（对齐万有 skill-evolution 的 CREATE 分类），需审核转正。
4. 商城：**registry 抽象层**——内置静态目录（版本化 JSON 清单，随部署更新）为默认源 + 远程 registry URL 可配置叠加；远程条目拉取后进 skill_registry_cache 表。离线部署只走内置源。
- 安装模型：registry item → install record（server 装了哪个版本）→ member_skills 装配（哪个 agent 用哪个已安装 skill）。
- trust level：builtin=trusted / market=reviewed / agent-drafted=untrusted；第一版 skill 仅 markdown 指令包（无脚本），把脚本执行的安全边界后置。
- 生效链路：装配到 agent 时注入其 computer workspace（AGENTS.md 引用/skills 目录），runtime 重启生效；版本升级=重装包+生效版本记录。
- 数据模型从第一期就进 schema（source/version/trust/created_by/install 记录），商城拉取与 UI 后置。

# Open questions

- [blocking] Q1: 本 change 的分期落点（M1+M2 打底，还是直接做 M3 spawn 闭环？）
- [blocking] Q2: SmallKhoj 里 Skill 的第一形态（DB 实体+markdown 定义落 workspace？纯 SKILL.md 文件包？）——影响 daemon 挂载方式
- [blocking] Q3: spawn 交互默认值（实测后更新：推荐万有式「卡片确认」——agent 拟方案、用户确认、后端原子创建；备选 agent 自主直建+配额）
- [blocking] Q4: 群聊内 agent 出生形态（spawn 确认后自动加入当前频道？还是仅出现在 members 列表由人拉入？）

# Verification expectations

待范围确认后写。

# 调查事实（Shape 证据库）

## 仓库现状（2026-09-10，两个 Explore 只读调研）

- 数据模型是 Slack 式群聊原生：Channel(public/private/dm) + ChannelMember(M:N) + Member(kind=human|agent) + Message(sender_id/mentions/parent_id)，backend/models/slock.py:160-405。
- 事件层已按频道内 agent fan-out（targetAgentId），backend/services/daemon_control.py:412-465。
- agent 间已可互发 DM、可经 task 委派（agent_delegated），backend/routers/agent_api.py:2750-2819。
- agent 实体 = Member + AgentWorkspace(runtime/runtime_command/runtime_model/cwd/status) + Member.config JSONB；**没有 system prompt 字段，没有 skill 概念，没有 created_by/lineage**。
- 「agent 创建 agent」四处均无入口：agent_permissions.py 白名单（3-15 行）、agent-api 路由表、slock CLI、daemon JSON-RPC methods.ts。
- 创建 agent 走 admin-only public API：POST /api/v1/members/agents（public_api.py:5430-5581）。
- 前端：多 agent 频道消息展示/成员增删/@mention 已有；创建表单仅 name/description/computer/runtime/provider（create-agent-form.tsx:101-104）；无 prompt/skill 字段；频道 activity tab 仅 DM 可用。
- daemon 支持 5 种 runtime driver：claude_code/codex/goose/opencode/pi（daemon.ts:25-29）；zcode 未接入。
- main 工作区未提交的 public_api.py/agent_api.py 改动为文件上传 mimeType 修复，与本话题无关。

## 万有无界（work.wanuai.cn，阿里云企业多 Agent 协作平台）产品形态

来源：官方介绍页 qianwenai.com/agents/wanyou、知乎公测文、CSDN 第三方解析（非官方推演）、**2026-09-10 夸克浏览器真实界面实测**（用户账号已登录态，实测了小万的 Agent 详情/技能列表/编辑表单/对话行为）。

- **创建即装配**：场景模板起步（调研/内容/法务/金融），五要素可调：提示词、Skill、知识库、业务规则、模型策略。
- **Skill 显性化**：平台导航有独立 Skills 入口（hub/skills，技能市场）；AI 商城三类资源：智能体、技能、连接器。
- **内置双主角**：小万（个人总助理，归属用户）+ 小有（PMO Agent，归属项目，按 SOP 模板动态规划任务、分配给人与 Agent 成员）。
- **群聊即协作界面**：会话分单聊/群聊；群聊围绕同一任务接力推进，产出沉淀资产库；项目结束流程自动沉淀为模板。
- **本地 Agent 接入**：Claude Code、Codex、OpenClaw 或自建；FAQ 提及 A2A 协议（官方页未强调）。
- **治理**：企业后台可「审计成员自建智能体」；组织资产归属企业账户。
- 第三方推演强调：结构化任务状态机、记忆四层分层、最小权限、审核 Agent；反对纯自然语言群聊式协作。

### 浏览器实测（2026-09-10，用户登录态）

**Agent 详情面板（小万）**：工作职责（persona 文本）+「技能· 13」计数入口 + 成长档案 + 定时任务·0 + IM 渠道（飞书）+ 在线状态/重启按钮。

**技能列表（13 张卡片，名称+版本+触发描述）**，格式为 Claude Agent Skills 风格（description 写明 Use-when 触发条件）：
- `资产上传` v1.0.11：任务产物上传到房间资产空间并返回 file-array。
- `网页搜索` v1.0.2：**明确写「through the maas-search MCP service」——skill 是 MCP 服务的包装**。
- `skill-evolution-trigger` v1.0.0：元技能，「**BEFORE replying to ANY user message, MUST run this self-check**」，从对话信号检测技能升级机会，分类 OPTIMIZE/EXTEND/CREATE/DEPRECATE，行动前 ask-question 确认。
- `project-creation` v1.0.6：澄清→查询匹配 SOP 模板→「**只在用户确认后输出严格格式的创建项目卡片；不直接调用项目创建命令**」。
- `定时任务`、`wy-memory-skill`（跨会话长期记忆）、`wy-room-context-skill`（群画像/群摘要/单聊主线）、`万有技能管理`、`万有房间管理`。
- **`万有Agent管理-小万` v1.0.0：「当小万的主人需要查找、招募或创建数字员工，或者修改名下已有 Agent 的名称与职责时使用。创建成功后由 Admin 原子加入联系人并消耗个人 Agent 额度。不用于管理群成员、安装 Skill、修改知识库或其他 Agent 配置。」**
- 底部有「添加技能」按钮；每个技能有「更多操作」菜单。

**编辑 Agent 弹窗**：只有两个字段——Agent名称 + 工作职责（多行文本）。技能/知识库/模型都不在此弹窗（技能走技能 tab；模型在聊天输入框切换 qwen3.8-max）。

**小万对话行为（真实会话）**：
- 主动查询「你名下的员工和数字员工市场」，区分「已有的（竞品调研专家）」「市场可招募的（教研专家）」「暂无现成的」三类。
- 对缺失能力主动提出「定制一个信息检索专家：我可以按你的具体用途自定义创建一个」——**即 agent 创建 agent 的交互入口是对话式提议，不是表单**。
- 清楚平台边界：「镜导不参与协作群聊——协作群是给多专业数字员工组队用的」；视频类走专属 agent 单聊。
- 消息交互：/ 引用资产、引用回复、点赞点踩、编辑（agent 消息可编辑）。

### 关键推断：万有的「agent 创建 agent」= 技能 + 卡片确认，不是 API 直调

证据链：`万有Agent管理` skill（触发与边界）+ `project-creation` 的「只在用户确认后输出严格格式的创建卡片；不直接调用创建命令」+ 「创建成功后由 Admin 原子加入联系人并消耗个人 Agent 额度」。

即：**agent 拟装配方案（职责+技能）→ 输出结构化卡片 → 用户确认 → 平台 Admin 原子执行（入联系人+扣额度）**。权限治理被转化为确认交互 + 平台侧原子执行，而不是给 agent 一个自由的 spawn API。

## 设计判断（Agent 思考，实测后修订）

1. 万有启示的优先级不是「spawn API」，而是 **agent 得先有内容**：没有 system prompt 字段的 agent 是空壳，装配无从谈起。万有编辑表单只有名称+职责两个字段——验证了「轻 persona + 外置技能」是最小可行装配形态。M1（system_prompt 字段落库+注入）是地基，daemon 侧注入通道已存在（buildSlockSystemPrompt → --append-system-prompt-file，claude-runtime.ts:359-420），工作量很小。
2. **「agent 创建 agent」的正确形态是卡片确认式，不是 API 直调**（本次实测的最大修正）：agent 在对话中提议「我需要一个会 X 的 agent，拟职责如下，建议装配技能 A/B」→ 渲染为确认卡片 → 用户一键确认 → 后端原子创建 + 诞生事件进频道。治理边界（额度、权限继承、防递归）嵌入交互流程而非仅靠 capability 白名单。SmallKhoj 已有 task 的 agent_delegated 模式可类比：agent 发起 + 结构化确认 + 平台执行。
3. **Skill 的本体是「带触发描述的能力包」，description 就是路由层**：万有技能描述全部是 Use-when 句式（LLM 按描述自选）。SmallKhoj 的 skill 第一版应映射到 runtime 真实可注入物——slock CLI 子命令（aura message/task/memory/reminder）+ persona 段落 + workspace 文件（AGENTS.md），不要先造云端 MCP 市场。已有对应物：资产上传↔file upload、定时任务↔reminder、wy-memory↔aura memory。
4. **显性化三层**：配置时（详情页技能卡片+职责）、运行时（消息流）、治理时（额度/审计/lineage）。SmallKhoj 前端对应：成员详情 workspace-tab 已有基础，补「职责+技能」区；频道消息流补诞生卡片。
5. **skill-evolution-trigger 是万有的隐藏亮点**（技能自我进化），SmallKhoj 后置；但说明 skill 体系应从第一天就带版本号和 created_by，为演化留字段。
6. **SmallKhoj 差异化**：agent 是本地 runtime 进程，skill 必须落到真实执行上下文（prompt 注入/AGENTS.md/skills 目录），不能只存 DB 当装饰——这也是与万有（云端 MCP 包装）最大的实现分歧点。

## 修改面盘点（Shape 层）

### 数据库（alembic 迁移）
- `members`：+ `system_prompt`（职责/persona）、+ `created_by`（FK members，lineage）
- 新表 `agent_skills`：server_id/name/version/description/definition(markdown)/source(user|agent|builtin)/created_by
- 新表 `member_skills`：member_id+skill_id 装配关系（+granted_by）
- 可选后置：`agent_templates`（场景模板）

### backend
- public API：POST /members/agents 接受 systemPrompt+skillIds；GET/PATCH member 返回与更新装配
- agent-api：spawn 提议协议——agent 提交方案（name/职责/技能清单/理由）→ 生成确认卡片事件 → 用户确认后复用既有创建链路（runtime_start_command + daemon_control_hub.push）
- 事件：member.created 扩展（职责摘要+技能清单）；新增 spawn 提议/确认卡片事件
- 权限：agent_permissions 白名单加 `proposeAgent`（卡片式）；自主 spawn（createAgent）可作为后续开放项

### daemon
- persona 拼入 buildSlockSystemPrompt 输出（config 透传 runtimePersona）——注入通道已存在
- slock CLI：`aura agent propose`、`aura skill list`
- 5 个 runtime driver 指令文本：教 agent 何时提议创建、怎么写职责、怎么选技能
- skill 落地第一版：persona 注入 + 技能清单写入 AGENTS.md/skills 目录

### 前端
- 创建/编辑 agent 表单：+职责多行文本 +技能多选 chips（对齐万有两字段最小形态）
- 成员详情：职责展示 + 技能 tab（卡片：名称/版本/触发描述）
- 频道消息流：spawn 提议卡片（确认/拒绝）+ 诞生事件卡片
- lineage 展示：成员列表/详情标「由 X 创建」

### 环境事实（本次调查附带发现）
- kimi-webbridge daemon 在跑但浏览器扩展未安装，"no extension connected"；浏览器里装的是废弃路线的 TMWD Slock Bridge(28765)。本次实测改用 computer-use AX 树读取，效果良好。
- daemon 支持 5 runtime（claude_code/codex/goose/opencode/pi）；zcode 未接入（独立 TODO）。

