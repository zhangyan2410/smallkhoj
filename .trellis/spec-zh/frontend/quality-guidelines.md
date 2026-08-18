# 质量指南

> 前端开发的代码质量标准。

---

## 概览

SmallKhoj 前端质量由三点衡量：

1. UI 遵循 `component-guidelines.md` 中的组件/样式分层。
2. 运行时/服务器行为在浏览器水合（hydration）、刷新与实时更新之后仍然正确。
3. 面向浏览器的变更有真实的可见证据（evidence），而不只是 API 或类型检查证据。

参考项目的经验：

- `agent-platform` 把设计系统规则做成一个带令牌（token）/组件引用的 skill，从而保持前端
  样式一致。
- `multica` 通过强制包边界与语义令牌保持 web/desktop 可维护。
- `clowder-ai` 用令牌审计、设计门禁与明确的 shell 归属减少视觉漂移（drift）。

SmallKhoj 应在本地借用同样的纪律：小型可复用原语、语义令牌、明确的 shell 归属与证据门禁。

---

## 禁止模式

- 页面或路由代码重复定义 `components/ui/` 或 `components/` 中已存在的视觉原语。
- 在路由内复制应用 shell 部件，例如图标侧栏（rail）、列表栏、调整分隔条或状态徽标
  （badge）映射。
- 在组件/页面中硬编码调色板颜色、内联 `oklch(...)`、`#hex` 或 Tailwind 调色板字面量。
- 在已有共享原子组件时，使用带一次性视觉类的裸 `<button>`、`<select>`、`<input>`、
  `<textarea>`。
- 手搓卡片/面板，例如 `rounded-md border bg-background p-3`。
- 把服务器数据持久化到浏览器存储。
- 在没有可见 `./twd` 断言或截图的情况下宣称浏览器 E2E 通过。
- 用宽泛的页面级裁剪修溢出，却不确认内部滚动区仍然可用。

---

## 必需模式

### 约定：页面代码做组合，组件管样式

**是什么**：`app/**` 路由代码负责获取/准备数据、定义 server action、选择页面组合并传递
props。样式属于第 0/1/2 层：令牌/工具类、原子组件与产品原语。

**为什么**：三分栏分支表明，页面在本地重建 shell、状态、卡片、表单与侧栏部件时会发生
样式漂移。

**示例**：
```tsx
// Correct: page composes ProductShell + product/ui atoms.
<ProductShell
  title={copy.title}
  description={copy.description}
  list={<TaskListPanel tasks={tasks} />}
  sidebar={<TaskRecoveryCockpit entries={entries} />}
>
  <TaskDndBoard tasks={tasks} />
</ProductShell>
```

**错误 vs 正确**：
```tsx
// Wrong: route-local shell and raw visual controls.
<div className="rounded-md border bg-background p-3">
  <button className="bg-emerald-500 text-white">Start</button>
</div>

// Correct: shared shell + atom/product primitive.
<Panel>
  <Button variant="default">Start</Button>
</Panel>
```

### 约定：ProductShell 拥有工作区外壳

**是什么**：图标侧栏由 `app/(app)/layout.tsx` 中的 `AppRail` 拥有；列表栏、主内容栏、
右侧栏与调整分隔条属于 `ProductShell` / `ProductShellBody`。聊天、任务、成员与
computers 应组合该 shell，而不是重建它。

**为什么**：重复的侧栏与列表/侧边结构会造成颜色、间距、滚动行为与调整行为不一致。

**正例/基准/反例**：
- 正例：列表-详情路由向 `ProductShell` 传 `list`、`listConfig`、`children` 与可选
  `sidebar`。
- 基准：某路由有自己的内部滚动面，但仍使用 `ProductShell` 并设置
  `mainScrollable={false}`。
- 反例：某路由复制图标侧栏标记、宽度常量或调整逻辑。

### 约定：Flex 溢出需要 `min-w-0` 与明确的滚动归属

**是什么**：任何包含长文本、markdown、代码、消息行或嵌套滚动区的 flex/grid 栏，都必须
设置正确的 `min-h-0`、`min-w-0`、`overflow-hidden` 以及内部 `overflow-y-auto` /
`overflow-x-hidden` 类。

**为什么**：否则聊天与 markdown 可能把整个 shell 撑得比视口更宽。这会在后期带来昂贵的
布局修复。

**示例**：
```tsx
<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
    <MessageList />
  </div>
</div>
```

**必需测试**：
- 用一个长不间断单词或代码块做浏览器检查。
- 确认 shell 宽度保持稳定且内部区域可滚动。

### 约定：新平台表面先查参考项目

**是什么**：在实现 MCP 可见性、skill 可见性、channel/runtime UI、自托管表面或 agent
工作区外壳之前，先查看 `../guides/reference-projects.md` 列出的参考项目。

**为什么**：`agent-platform`、`clowder-ai` 与 `multica-ai/multica` 已经为相邻的产品/平台
问题沉淀了解法。复用其经验可以避免发明更弱的本地约定。

**必需输出**：任务笔记或 PR 描述必须写明查看了哪个参考，以及 SmallKhoj 是复用、改造还是
拒绝了该模式。

### 约定：关键后端变更使用原生表单提交

**是什么**：对创建或修改后端状态的浏览器控件，优先使用绑定到原生 `<form action={...}>`
的 server action，除非工作流确实需要仅客户端状态。

**为什么**：仅客户端的 `onSubmit` 在水合未挂载时会静默退化为原生 `GET ?field=value`
表单提交。这会让 UI 看似可交互，实际却没有发出后端 `POST`。

**示例**：
```tsx
async function createThingAction(formData: FormData) {
  "use server"
  await fetch(`${API_BASE}/api/v1/things`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
    body: JSON.stringify({ name: formData.get("name") }),
  })
  revalidatePath("/things")
}

export function CreateThingForm() {
  return (
    <form action={createThingAction}>
      <input name="name" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

**错误 vs 正确**：
```tsx
// Wrong for critical backend writes: fails open to GET if hydration is not attached.
<form onSubmit={handleClientSubmit}>
  <input name="name" />
  <button type="submit">Create</button>
</form>

// Correct: native submission still reaches the server action.
<form action={createThingAction}>
  <input name="name" />
  <button type="submit">Create</button>
</form>
```

**必需测试**：
- 变更表单的浏览器冒烟（smoke）测试必须断言真的发生了 `POST`，而不只是页面发生了变化。
- 若返回凭据或令牌，断言它没有经由 URL 泄漏。

### 约定：有界请求包含响应体的消费

**是什么**：请求超时或调用方的 `AbortSignal` 必须保持活跃，直到完整响应体被消费完，而
不只是到 `fetch()` 返回响应头为止。

**为什么**：在 `try/finally` 内 `return response.json()` 时，`finally` 会在响应体 promise
落定之前执行。在那里清除计时器会让一个响应头成功但响应体停滞/截断的响应失去上界，并可
能让破坏性 UI 卡在提交状态。

**正确形态**：

```ts
const response = await Promise.race([fetch(url, init), abortPromise])
return await Promise.race([response.json(), abortPromise])
```

**必需测试**：
- 先发响应头随后 JSON 响应体停滞的成功响应会超时。
- 响应头之后、响应体完成之前的调用方中止会传播调用方的原因。
- 非成功响应的错误体解析也在同一上界覆盖之内。

### 约定：Daemon 接入（onboarding）使用平台互斥的三阶段

**是什么**：Computers 的接入与重连表面只暴露当前选中的平台，并有三个可观察阶段：

```text
Install（安装） → Setup（初始化） → Connect（连接） → Online
```

Windows 使用 PowerShell 独立 Aura 安装器与 `aura` 可执行文件；macOS/Linux 保留既有
npx/shell 路径。两个平台标签页互斥：未选中平台的命令文本与复制控件不得渲染进 DOM。
Install 与 Setup 是无票据（ticket）预览；只有显式 Connect/Reconnect 动作才返回
`sk_connect_` 命令与 `expiresAt`。

发布上线（rollout）期间，旧式 Unix `command` 字段仍保留在 API 响应中，但新 UI 代码读取
`platforms[platform].install/setup/connect`，并在元数据中保留 Server 标识符。

**为什么**：Windows 无法在干净主机上运行 Unix npx/curl 指令，而一张五分钟票据不应在用户
还在安装和初始化机器时就开始过期。可见阶段让失败可恢复，且不破坏既有 Unix 消费方。

**必需钩子**：

```tsx
<code data-testid="phase-command-install">{install}</code>
<code data-testid="phase-command-setup">{setup}</code>
<code data-testid="phase-command-connect">{connect}</code>
```

对话框（dialog）还暴露 `platform-tab-windows`、`platform-tab-unix`、
`generate-ticket-button`/`regenerate-ticket-button` 与 `connect-status-region`，供浏览器
证据使用。

租约（lease）预检（preflight）是共享接入响应的一部分。当 `connectPreflight.ok === false`
时，状态区必须渲染（render）本地化、可行动的 stop/wait/retry 警告。Server action 错误
处理必须同时接受旧式 FastAPI 形态 `{detail: string}` 与结构化形态
`{detail: {reasonCode: "DAEMON_LEASE_ACTIVE", message, leaseExpiresAt,
recoveryActions: ["stop", "wait", "retry"]}}`；绝不能把后者折叠成裸
`HTTP 409`，也不能暴露 daemon 令牌。

**必需测试**：
- 契约（contract）测试证明 preview/setup 请求不创建 ConnectTicket 并返回 `ticket: null`/
  无过期时间；Connect/Reconnect 响应创建新票据并保留旧式 Unix 命令。
- 前端测试断言中文是默认语言、只有所选平台的阶段命令可见/可复制，且过期票据可重新生成
  而无需重复 Setup。
- `./twd` 证据断言 Windows 标签页从不显示 curl/bash 或 npx，macOS/Linux 标签页从不显示
  PowerShell/irm；Online/失败状态在 `connect-status-region` 中可见，包括预览发现活跃
  租约时的恢复警告。

---

## 测试要求

### 场景（Scenario）：Next Dev 浏览器 E2E 源

#### 1. 作用域（Scope）/ 触发
- 触发：浏览器测试或手动脚本通过与 dev server 允许源不同的主机打开 Next dev server，
  例如 Next 报告 `localhost:3000` 时使用 `127.0.0.1:3000`。

#### 2. 签名
- `frontend/next.config.mjs`：`allowedDevOrigins: ['127.0.0.1']`
- E2E 环境变量键：`FRONTEND_BASE`、`API_BASE`、`E2E_DATABASE_URL`

#### 3. 契约
- 浏览器 e2e 可以直接使用 `FRONTEND_BASE=http://localhost:3000`，无需额外配置。
- 若 e2e 使用 `FRONTEND_BASE=http://127.0.0.1:3000`，`next.config.mjs` 必须允许
  `127.0.0.1`，且配置变更后必须重启 dev server。
- 已渲染的页面不足以证明水合：客户端处理器可能已失效，而服务器 HTML 看起来仍然正确。

#### 4. 验证与错误矩阵
- 浏览器控制台显示来自 `127.0.0.1` 的 `/_next/webpack-hmr` WebSocket 握手失败 ->
  检查 `allowedDevOrigins` 或改用 `localhost`。
- Next dev 日志出现 "Blocked cross-origin request to Next.js dev resource" -> 更新配置
  并重启 dev server。
- UI 已渲染但按钮 `onClick` 不发网络请求 -> 在调试 API 之前，先按可能的水合/dev 源失败
  处理。

#### 5. 正例/基准/反例
- 正例：e2e 使用 `localhost:3000` 或已配置的允许 dev 源，并断言预期的 `POST`。
- 基准：API 冒烟测试通过但浏览器 e2e 失败；先检查浏览器控制台与 Next dev 日志，再改
  后端代码。
- 反例：客户端包未水合导致浏览器根本没发出请求，却断定 API 坏了。

#### 6. 必需测试
- 变更 e2e 应断言结果 UI 状态，并在可行时观察该变更的 `POST` 响应。
- e2e 运行后，断言临时行已被清理，或已与本地评审数据库隔离。

#### 7. 错误 vs 正确
##### 错误
对 `http://127.0.0.1:3000` 运行 e2e 且未配置 `allowedDevOrigins`，然后把客户端事件缺失
当作后端失败去调试。

##### 正确
本地浏览器 e2e 使用 `http://localhost:3000`，或配置
`allowedDevOrigins: ['127.0.0.1']` 并重启 dev server。

### 场景：生产 Standalone 前端镜像

#### 1. 作用域 / 触发
- 触发：修改 `frontend/Dockerfile`、`frontend/next.config.mjs`、生产 compose、部署
  runbook 或前端构建产物。

#### 2. 签名
- `frontend/next.config.mjs`：`output: "standalone"`
- `frontend/Dockerfile`：把 `/app/.next/standalone` 复制进 runner 镜像并启动
  `server.js`。

#### 3. 契约
- `bun run build` 必须在 Docker runner 阶段复制构建产物之前生成
  `.next/standalone/server.js`。
- 启用 standalone 输出时，同源 `/api` rewrites 与 next-intl 插件包裹必须保持生效。
- 标称 4 vCPU / 4 GB 的发布主机（3.32 GiB 客户机可见内存）必须拉取预构建前端镜像；它
  不是安装 Next.js 依赖或运行生产构建的受支持场所。

#### 4. 验证与错误矩阵
- 构建后 `.next/standalone/server.js` 缺失 -> `next.config.mjs` 丢了
  `output: "standalone"` 或 Next 构建配置发生了变化。
- Docker 构建在 `COPY --from=builder /app/.next/standalone ./` 处失败 -> standalone
  输出契约被破坏。
- 容器启动但 `/login` 不返回 HTTP 200 -> runner 命令或复制的产物布局有问题。

#### 5. 正例/基准/反例
- 正例：配置测试断言 `nextConfig.output === "standalone"`，`bun run build` 生成
  `.next/standalone/server.js`，Docker 构建成功，且冒烟容器能提供 `/login`。
- 基准：本地构建通过，但仅因 Docker daemon 不可用而跳过 Docker 构建；显式记录该跳过的
  门禁。
- 反例：在 Dockerfile 依赖 `.next/standalone` 时，仅以 `next build` 当作生产镜像证明。

#### 6. 必需测试
- `bunx tsx --test test/next-production-config.test.ts test/runtime-url.test.ts`
- `bun run build`
- `test -f .next/standalone/server.js`
- Docker 可用时执行 `docker build -t smallkhoj-frontend:standalone-smoke ./frontend`。
- 可选容器冒烟：运行构建出的镜像并检查 `GET /login`。

#### 7. 错误 vs 正确
##### 错误
因为 `next build` 在本地仍成功就移除或省略 `output: "standalone"`。

##### 正确
保持 standalone 输出启用，因为生产 Docker runner 阶段会复制 `.next/standalone` 并启动
其 `server.js`。

### 变更冒烟测试

对写入后端 API 的表单，至少包含一个使用 `project-webdriver-cli` skill 与 `./twd` 的项目
WebDriver 浏览器冒烟测试，它要：

- 填写并提交可见表单。
- 验证预期结果出现在 UI 中。
- 验证临时测试数据已被清理或隔离。
- 当此前的缺陷涉及错误 HTTP 方法时，观察网络事件。

### 约定：next-intl 文案契约（06-22-i18n）

**是什么**：所有用户可见的前端文案都放在 `frontend/messages/{zh-CN,en}.json`，并通过
`next-intl`（`useTranslations` / `getTranslations`）渲染。语言环境解析在
`i18n/request.ts`：cookie `smallkhoj_locale`（`LOCALE_COOKIE`，由 `LanguageSwitcher` 经
`setLocaleAction` 写入）→ `defaultLocale = "zh-CN"`（`i18n/config.ts`）。语言环境不进
路由——既有 URL 继续可用。

**为什么**：文案目录是唯一可以审计并保持双语的场所；中文是主要受众的默认值。
`Accept-Language` 协商在发布上线时试过并被有意移除——确定性规则是 cookie 或 zh-CN，因此
截图与证据可复现。

**规则**：
- 组件/页面新增用户可见字符串 → 在同一次变更中同时把键加进 `zh-CN.json` 与 `en.json`；
  `<html lang>` 跟随解析出的语言环境。
- 后端 API 错误文案不在客户端翻译：原样渲染权威的后端消息（`detail`/`reasonCode`）。
  i18n 目录只管产品文案，绝不管后端诊断。
- 错误：在 JSX 中硬编码中英文字面量（"确定"/"Submit"），或每路由一个小型消息对象；
  正确：`const t = useTranslations("members")` + 目录键。

### 约定：API/WS 基址 URL 派生，绝不硬编码主机

**是什么**：所有基址 URL 解析都经过 `frontend/lib/runtime-url.ts`（`resolveApiBase`、
`resolvePublicApiBase`、`resolveWebSocketBase`）；任何组件或路由都不得硬编码
`localhost`、`127.0.0.1` 或源字符串。

**规则**（生产 URL 契约）：
- 浏览器运行时：默认同源——基址为空，请求打到页面源，由 Next `rewrites` 把 `/api`
  代理到后端（`next.config.mjs`）。
- 服务器/SSR 运行时：`INTERNAL_API_BASE_URL`（compose/部署值 `http://backend:8000`；
  开发回退 `http://localhost:8000` 只存在于 `runtime-url.ts` 内部）。
- WebSocket：从页面协议派生——`https:` → `wss:`、`http:` → `ws:`
  （`resolveWebSocketBase`）；显式 `NEXT_PUBLIC_WS_BASE_URL` 可覆盖。
- 设置了显式 `NEXT_PUBLIC_API_BASE_URL`/`NEXT_PUBLIC_WS_BASE_URL` 时以显式值为准；
  `resolvePublicApiKey` 会让仍携带开发密钥的生产构建失败。
- 源码契约测试 `frontend/test/runtime-url.test.ts` 断言环境接线（`control-plane.ts` 中
  的 `INTERNAL_API_BASE_URL: process.env...`）——不要在别处内联 process.env 读取。

**错误**：组件里 `fetch("http://localhost:8000/api/v1/...")` 或
`new WebSocket("ws://localhost:8000")`。
**正确**：`joinUrlPath(resolveApiBase(), "/api/v1/...")` / `resolveChatWebSocketUrl()`。

### 约定：Shell 布局（layout）的移动可达性（07-06 tasks）

**是什么**：窄视口用户必须能到达每个列表/详情功能，而不只是看到主栏。

**规则**：
- `ProductShell` 列表栏在 `sm` 以下隐藏（`components/product-shell-body.tsx` 中的
  `hidden sm:flex`）——这必须搭配一个显式抽屉（drawer）：切换按钮
  `data-inkframe-mobile-role="sidebar-drawer-toggle"`（`sm:hidden`、
  `aria-controls`/`aria-expanded`），以及 `sidebar-drawer` 区域上的
  `data-inkframe-state="open" | "collapsed"`。隐藏后无法重新打开的列表栏是可达性缺陷。
- 全屏对话框（dialog）按 `svh` 而不是 `vh` 计算尺寸（移动浏览器 chrome 会压缩 `vh`）：
  如 `components/task-detail-dialog.tsx` 中的 `max-h-[calc(100svh-1rem)]`——且对话框主体
  拥有垂直滚动（`overflow-y-auto`），而不是页面。
- 右栏详情表面需要 URL 驱动的对话框回退，使窄布局与直达链接到达同一内容：
  `/tasks?task=<id>` 渲染 `TaskDetailDialog`（页面是读取 `?task=` 的服务器组件）。只以
  无名桌面侧边栏存在的详情在移动端不可达。

**必需测试**：在窄视口用 `./twd`（或 `twd-inkframe-proof` 的 mobile 组）断言抽屉可开合、
详情对话框能从其 URL 渲染。

### 真实浏览器测试 SOP

对面向浏览器的产品工作，添加任务本地的真实测试证据文件。仓库浏览器/UI 验证使用
`project-webdriver-cli` skill 与项目 WebDriver CLI 包装器，而不是 Playwright。

从 `docs/real-test-sop-template.md` 起草新任务证据，再针对被验证功能细化步骤。

必需证据：

- 形如 `REAL_<task-slug>_<timestamp>` 的唯一标记。
- 对运行中本地应用执行 `./twd` 导航/动作命令。
- 通过 `scan --text` 或 `eval` 做可见 DOM 断言。
- 截图保存到 `{TASK_DIR}/evidence/` 之下。
- 当 UI 创建或修改后端状态时做 API 或数据库交叉检查。
- 当 daemon/runtime 投递属于工作流一部分时做 `smallkhoj-trace` 交叉检查。

若真实浏览器行为与自动化测试不一致，将该任务视为失败并继续修复。

墨框（Inkframe）表面验收门禁：墨框表面（产品路由上的 `data-inkframe-*` 选择器词汇表）
的规范证明运行器是 `tools/twd-guard/twd-inkframe-proof`——它驱动已连接的 `./twd` 桥，
按路由/选择器组（`product-shell`、`chat-desktop`、`chat-mobile`、`chat-unread`、
`task-desktop`、`task-mobile`、`material-state`）运行。不得用 Playwright、自行启动的
Chrome 或手搓的路由扫描器替代该门禁。

关于双浏览器轨道的裁定：`kimi-webbridge`（127.0.0.1:10086）仅用于探索性交互——摸索
流程、复现缺陷——不产生验收证据。唯一的验收门禁仍是 `./twd` / `tools/twd-guard/*`；
证据文件必须引用 twd 命令，而不是 webbridge 会话（这解决了与 `aura` 前端 SOP skill 的
重叠）。

### 约定：前端归属迁移后长存分支的对账

**是什么**：当分支跨越路由组迁移、shell 归属迁移或 UI 抽取时，要解决语义归属契约，而
不是接受一个文本上无冲突的合并。源码契约测试必须跟随当前归属者与当前路由路径。

**为什么**：一个在 `(app)` 常驻 shell 迁移之前创建的分支对 Git 而言合并得足够干净，却
把三个互不兼容的世代留在一起：测试读 `app/tasks/page.tsx`，任务 UI 在
`components/task-route-projection.tsx`，而 `RealtimeProvider` 没有已挂载的归属者。单元
测试、类型检查与生产构建在不同阶段暴露了漂移。

**必需检查**：

- 把读取源码的测试从已迁移路径（如 `app/tasks/page.tsx`）更新为
  `app/(app)/tasks/page.tsx`。
- 当路由 UI 被抽取时，同时读取路由与被抽取组件，而不是削弱断言或把 UI 复制回路由。
- 保持每个共享 provider 恰好挂载一次。对于常驻 shell，`app/(app)/layout.tsx` 拥有
  `RealtimeProvider`；仅 body 的 `ProductShell` 实例不得再创建另一个传输。
- 对账后运行完整前端序列：`bun test`、`bun run lint`、`bun run typecheck`、
  `bun run typecheck:e2e`，以及一次生产 `bun run build`。
- 在对账后的 worktree 上用 `./twd` 验证受影响路由，因为源码契约测试无法证明组合后的
  页面能渲染。

**错误 vs 正确**：

```tsx
// Wrong: keep both pre-migration and post-migration page trees after a merge.
<ProductShell>{/* old inline task UI */}
  <ProductShell>{/* new TaskRouteWorkspace */}</ProductShell>
</ProductShell>

// Correct: keep one current owner tree.
<TaskProjectionProvider>
  <ProductShell>
    <TaskRouteWorkspace />
  </ProductShell>
</TaskProjectionProvider>
```

**必需测试**：

- 源码契约测试断言当前 `(app)` 路径与被抽取组件的归属者。
- 实时归属测试断言只有一个物理传输创建者与一个常驻 shell provider 挂载。
- 类型检查与生产构建必须在最终冲突解决之后通过，而不只是在 rebase 之前。

#### 场景：精确标签页的已认证 WebDriver 守卫

##### 1. 作用域 / 触发

- 触发：浏览器验收流程已持有操作员批准的标签页 ID，或者枚举无关标签页可能暴露任务本地
  目标之外的 URL/标题元数据。

##### 2. 签名

- 精确已认证导航：
  `./tools/twd-guard/twd-open --tab <exact-tab-id> <path-or-url>`
- 后续裸断言/动作：
  `./twd --compact <command> --tab <exact-tab-id> ...`

##### 3. 契约

- 精确路径在启动 WebDriver 桥之前校验非空标签页 ID。
- Cookie 注入、导航、登录重定向重试与最终页面探测都传递同一个 `--tab <exact-tab-id>`
  参数对。
- 精确路径绝不调用标签页发现、`selectLocalTab()` 或 `--url-match`；失败后也不回退到这些
  机制。
- 每个 WebDriver 载荷（payload）都必须返回请求的 `tabId`。ID 缺失或不同，则在接受结果
  之前失败。
- `./twd` 执行超时、无 ACK、有 ACK 无结果与页面重载都是失败，带 `ok=false` 与非零退出；
  来自旧常驻 master 的诊断映射绝不能被重新包装成 `ok=true`。
- 没有显式 `--port` / `TWD_PORT` 时，精确标签页与 URL 选择会搜索每个已配置的桥。多个
  持有桥时失败关闭（fail-closed）；`tabs` 聚合存活桥并包含每个标签页的源端口。
- 导航证据在同一精确标签页上经过有界轮询后比较 origin、pathname、search 与 hash。期望
  的 query/hash 为空时，仍会拒绝意外的实际值。
- 真实 Chrome 的导航赋值可能以布尔 `true` 或确切的请求 URL 字符串确认 `goto`。任何其他
  字符串、映射、超时诊断或被中断的结果都失败关闭。
- `--compact` 是对成功与已处理失败都适用的全命令级单行 JSON 契约，包括写文件命令如
  `scan --out`、`snapshot --out` 与 `screenshot`。
- 守卫认证必须用可信认证桥返回的 Server 替换回环标签页的活跃 Server cookie。Cookie 按
  主机跨端口共享，因此保留较早的 localhost Server 选择可能让本地候选静默读取另一个
  环境的租户数据。
- 在请求或注入可复用会话令牌之前，守卫必须用无令牌的精确标签页探测确认已配置的前端
  源。若发现 `chrome-error://` 页面或其他源，先在同一标签页导航到已配置的回环
  `/login`；只有在该源被证明之后才获取令牌。
- Cookie 注入的 eval 脚本包含可复用会话令牌。该边界上的任何命令失败都必须替换为固定的
  安全错误；原始 argv、输出、载荷与错误不得被插值，也不得保留为异常 `cause`。
- 受守卫的 cookie 注入、业务 eval 与最终探测载荷各自校验返回的精确 `tabId`；只检查最初
  的选择不足以确立精确标签页证据。
- 已处理的 `act` 失败保留底层稳定命令码，如 `EXECUTION_TIMEOUT`；清理失败使用
  `CLEANUP_FAILED`。调用方不得解析人类可读的错误文本来区分这些路径。
- 只有调用方有意省略 `--tab` 时，旧式发现才可用；当任务边界禁止读取其他标签页时，它不
  是替代品。

##### 4. 验证与错误矩阵

- `--tab` 值为空/缺失 -> 在桥启动之前拒绝。
- 重复的 `--tab` 选项 -> 拒绝 CLI 输入。
- Cookie/goto/探测载荷返回了另一个标签页 ID -> 带期望与实际 ID 失败关闭；不得经发现
  重试。
- 无令牌源探测报告了非前端源 -> 先把该精确标签页导航到已配置的 `/login`，再获取会话
  令牌。
- Cookie 注入 eval 非零退出或返回 `ok=false` -> 以固定的 cookie 注入命令错误失败，其中
  不含会话令牌或原始 WebDriver 诊断。
- 精确目标重定向到 `/login` -> 重新认证并在同一精确标签页导航一次，但仅当 `/login`
  位于已配置的前端源时；绝不枚举标签页。
- 最终 origin/pathname/search/hash 与请求目标不一致 -> 拒绝浏览器证据。

##### 5. 正例/基准/反例

- 正例：创建一个获批的回环标签页，记录其 ID，使用精确的受守卫认证，然后为该场景使用
  精确的裸 `./twd --tab` 命令。
- 基准：仅当读取已连接标签页元数据明确位于任务边界内且没有获批 ID 时，才使用发现辅助。
- 反例：先调用发现再比较返回的标签页 ID；无关元数据的读取已经发生。

##### 6. 必需测试

- Mock runner 单元测试覆盖成功的精确导航与 `/login` 重试，并断言每个命令都包含请求的
  `--tab` 参数对。
- 同一测试拒绝任何 `tabs` 命令或 `--url-match` 参数。
- 单元测试覆盖空/重复 CLI 选项与不匹配的返回标签页 ID。
- Core/CLI 测试覆盖无 ACK 与有 ACK 无结果超时、旧 master 诊断兼容、源端口聚合与感知
  目标的多桥选择。
- CLI 测试覆盖真实导航确认形态与写文件命令的 compact 成功输出；守卫测试覆盖同主机候选
  间的活跃 Server cookie 替换、令牌前源恢复，以及每个返回载荷的精确标签页校验。
- `act` 测试断言动作与清理失败的稳定错误码。
- Mock runner 必须把敏感 eval argv 回显在其抛出的错误中，并证明守卫会替换它，且不在
  `message` 或 `cause` 中保留会话令牌。
- `make scripts-test` 必须执行精确标签页守卫套件，使本地 `make ci` 与源码契约 CI 作业
  都保护该边界。

##### 7. 错误 vs 正确

###### 错误

```bash
./tools/twd-guard/twd-open /tasks
# Comparing its returned ID later does not undo discovery of every tab.
```

###### 正确

```bash
./tools/twd-guard/twd-open --tab "$APPROVED_LOCAL_TAB_ID" /tasks
./twd --compact eval --tab "$APPROVED_LOCAL_TAB_ID" \
  'return { origin: location.origin, path: location.pathname }'
```

###### 错误

```js
// The eval argv contains sessionToken; propagating this error leaks it.
return runTwd(["--compact", "eval", "--tab", tabId, sensitiveScript])
```

###### 正确

```js
try {
  return runTwd(["--compact", "eval", "--tab", tabId, sensitiveScript])
} catch {
  // Do not retain the original error as cause.
  throw new Error("Session cookie injection command failed")
}
```

#### 场景：`./twd` 无标签页门禁分类

##### 1. 作用域 / 触发
- 触发：任何以 `./twd --compact tabs` 作为第一道证据门禁的浏览器任务，尤其是可复用的
  证明运行器或脚本。

##### 2. 签名
- 命令：`./twd --compact tabs`
- 无标签页载荷：

```json
{"ok": true, "tabs": [], "count": 0}
```

##### 3. 契约
- 已连接标签页的证明只有在解析后的载荷至少包含一个标签页时才能继续。
- 无标签页载荷必须被分类为 `blocked_no_tab` 或等价的待定/阻断状态。
- 无标签页状态不得被分类为浏览器验收；若载荷本身有效，也不得被折叠成通用 WebDriver
  失败。
- 自动化可以为阻断/无标签页使用一个独立的非零退出码，但证据文件必须保留解析后的载荷，
  并声明不主张任何浏览器/移动验收。

##### 4. 验证与错误矩阵
- `tabs.length === 0` 或 `count === 0` -> 阻断/无标签页；写证据并停止浏览器验收。
- `ok === false` 且 `code: "NO_TAB"` -> 阻断/无标签页；写证据并停止浏览器验收。
- 命令非零退出但 stdout 含上述有效无标签页 JSON -> 先解析 stdout 并分类为阻断/无
  标签页。
- stdout/stderr 不含可解析 JSON -> WebDriver/工具执行失败。

##### 5. 正例/基准/反例
- 正例：证明运行器写出状态为 `blocked_no_tab` 的 JSON/Markdown 证据，并以有文档记录的
  非零码（如 `2`）退出。
- 基准：操作员把确切的 `./twd --compact tabs` 输出记录进任务证据，浏览器/移动证明保持
  待定。
- 反例：脚本在解析 JSON 载荷之前把任何非零退出当作通用工具失败，或在无标签页输出后凭
  静态测试宣称 UI 验收。

##### 6. 必需测试
- 单元测试：无标签页载荷 -> 阻断/无标签页分类。
- 单元测试：命令非零结果但 stdout 为有效无标签页载荷 -> 阻断/无标签页。
- 证据测试或断言：阻断/无标签页模式下不写入任何浏览器/移动验收主张。

##### 7. 错误 vs 正确
###### 错误

```js
if (result.status !== 0) throw new Error("twd failed")
```

###### 正确

```js
const payload = parseLastJson(result.stdout)
if (payload.ok === true && (payload.count === 0 || payload.tabs?.length === 0)) {
  return { status: "blocked_no_tab", tabsResult: payload }
}
if (result.status !== 0) return { status: "failed_twd" }
```

### 事件（event）/Activity UI 令牌安全门禁

当前端工作涉及 Activity、Events、agent 时间线、daemon 状态、runtime 状态或 trace/debug
视图时：

- 把 Activity 时间线行当作可观测性 UI，而不是 runtime 工作项。
- 验证 UI 标签能区分遥测状态与可行动的消息/任务。
- 交叉核对 `.trellis/spec/backend/event-delivery-contracts.md` 中的后端契约。
- 当 UI 声称某个事件到达特定 agent/runtime 时，使用基于标记的浏览器检查。
- 不接受把自身产生的 runtime 活动做得像新入站消息的 UI。

---

## 代码评审清单

- [ ] 页面组合既有原子/产品原语，而不是手搓卡片、控件、徽标、侧栏或外壳。
- [ ] 新增或修改的颜色使用令牌；令牌文件之外没有裸 Tailwind 调色板颜色、内联
      `oklch(...)` 或十六进制字面量。
- [ ] 列表/详情路由使用 `ProductShell` 归属，除非任务明确记录了不这么做的理由。
- [ ] 滚动区有稳定的 `min-h-0` / `min-w-0` 归属，且已检查长文本行为。
- [ ] 当水合失败会导致动作丢失时，服务器变更使用 server action/原生表单。
- [ ] 复用的 API/资源类型来自共享源。
- [ ] 面向浏览器的变更包含 `./twd` 可见证据。
- [ ] MCP/skill/channel/平台表面已核对参考项目指南。
