# 部署环境契约

> 面向本地开发、本地生产形态测试以及当前腾讯云 Lighthouse 部署的 runtime、部署与验证契约（contract）。

## 场景（Scenario）：部署环境测试入口

### 1. 作用域（Scope）/ 触发

当工作改动或验证以下任一内容时，使用本 spec：

- 服务启动命令、环境变量接线、Docker 镜像、Caddy 路由或生产 compose；
- 依赖已部署前端/后端环境的认证/登录/注册流程；
- daemon 连接命令、Computer 注册、runtime WebSocket 路径或公共回调 URL；
- 「可用」「就绪」「已部署」「发布门禁通过」或「云端验证通过」的证据（evidence）。

Agent 必须在证据中写明目标环境。仅 localhost 的检查永远不能证明云端生产可用。

### 2. 签名

环境名：

- `local-dev`：快速开发者循环。
  - 后端 URL：`http://127.0.0.1:8000`
  - 前端 URL：`http://127.0.0.1:3000`
  - 宿主 PostgreSQL：默认 `127.0.0.1:5432`，由 `dev.sh` 的 `DATABASE_URL` 选定
  - 后端命令形态：`uv run python main.py`（无热重载；见 `dev.sh` 与 Real-Test 一节）
  - 前端命令形态：`npm run dev`（热重载生效）
- `local-prod`：本地生产形态门禁。
  - 命令形态：`docker compose -f docker-compose.prod.yml --env-file <local-prod-env> up -d`
  - 入口：Caddy、同源路由、生产 Docker 镜像、类生产环境。
- `cloud-prod`：已部署产品验证。
  - 当前基址 URL：`http://124.222.40.40`
  - 当前实例：腾讯云 Lighthouse `lhins-6gznhrts`，地域 `ap-shanghai`
  - 当前宿主用户/密钥：`ubuntu`、`/Users/lee/.ssh/tengxun-ssh-key.pem`

环境边界摘要：

| 环境 | 入口 | 数据库边界 | 证据作用域 |
| --- | --- | --- | --- |
| `local-dev` | `./dev.sh`（`3000`/`8000`） | 宿主 `DATABASE_URL`，默认端口 `5432` | 仅开发行为 |
| `local-prod` | 临时端口上的生产 Compose/Caddy | 隔离的 Compose 卷/数据库 | 生产形态的镜像与代理接线 |
| `cloud-prod` | 远端 Compose 加公共 URL | 持久云端数据库；仅应用更新 | 真实公共健康、制品与 WebSocket 冒烟（smoke） |

发布冒烟命令：

```bash
python3 scripts/post_deploy_smoke.py --base-url <base-url> --daemon-package-version <published-package-version> --allow-http --json
python3 scripts/initial_release_foundation_gate.py --base-url <base-url> --daemon-package-version <published-package-version> --allow-http --json
```

当前 Caddy 路由签名：

```text
/api, /api/*              -> backend:8000
/internal, /internal/*    -> backend:8000
/docs, /docs/*            -> backend:8000
/openapi.json             -> backend:8000
/downloads/smallkhoj-daemon, /downloads/smallkhoj-daemon/* -> backend:8000
/*                         -> frontend:3000
```

### 3. 契约

- `local-dev` 仅用于迭代。它能证明代码可以在本地启动，不能证明已部署的产品可用。
- 当启动、Docker、Caddy、认证环境、daemon URL 或反向代理行为发生变化时，云端部署之前必须先过 `local-prod`。
- 破坏性的已认证 E2E 仅满足 `E2E_DATABASE_SCOPE=disposable` 还不够：其实际 `DATABASE_URL` 与
  `BETTER_AUTH_DATABASE_URL` 必须都指向回环地址、包含明确的安全数据库名标记，并指向同一个
  数据库。缺少这一证明时，标准 E2E 命令会在浏览器启动之前失败。
- 文档直接记载的前端入口 `cd frontend && bun run e2e` 会在 Playwright 之前先调用
  `python3 ../scripts/validate_delivery_env.py e2e`；它不是绕过校验器的口子。CI 以 host 网络
  运行前端容器，并按变量名原样传入已经过校验的回环 `INTERNAL_API_BASE_URL` 与
  `BETTER_AUTH_DATABASE_URL` 值。在校验之后替换为 Docker 主机名、第二个数据库或仅容器内
  可用的 URL，都违反 E2E 安全契约。
- `cloud-prod` 是当前的用户/产品验收（acceptance）面，直到正式域名与 HTTPS 端点取代仅 IP 的 URL。
- `dev.sh` 只是 `local-dev` 的便利脚本。它不能用作发布证据，但必须保持本地认证环境一致，
  使开发期间浏览器注册/登录可用。
- 真实 runtime SOP 跟随选定的 `DATABASE_URL`；当前 `dev.sh` 默认是宿主端口 `5432`。`55432`
  不是固定的项目测试端口：它是为 ccs-claude worker 编排栈的 `smallkhoj-test-db` 容器保留的
  已发布宿主端口（`.agents/skills/smallkhoj-worker-orchestration`），其他栈绝不能自动选用它。
- `dev.sh` 必须以同一个 `AUTH_BRIDGE_SECRET` 启动后端与前端。后端密钥缺失时，Better Auth
  桥接调用会被以 `503 Auth bridge secret is not configured` 拒绝；前端提供的密钥不匹配时
  返回 `401 Invalid auth bridge secret`。
- `dev.sh` 从同一个 local-dev 源派生后端 `PUBLIC_API_KEY` 与前端 `NEXT_PUBLIC_API_KEY`：
  `${PUBLIC_API_KEY:-sk_public_local}`。脚本不支持单独的 `NEXT_PUBLIC_API_KEY` 覆盖。
- `dev.sh` 启动前端时必须设置本地 Better Auth 环境变量：
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_DATABASE_URL`
  - `BETTER_AUTH_DATABASE_POOL_SIZE=10`
  - `AUTH_BRIDGE_SECRET`
  - `INTERNAL_API_BASE_URL`
- 生产浏览器流量应使用同源路由。除非浏览器必须调用拆分出的公共主机，否则以下前端
  构建/运行时值保持为空：
  - `NEXT_PUBLIC_API_BASE_URL=`
  - `NEXT_PUBLIC_WS_BASE_URL=`
- 生产前端环境必须包含：
  - `INTERNAL_API_BASE_URL=http://backend:8000`
  - `NEXT_PUBLIC_DEPLOYMENT_ENV=production`
  - `NEXT_PUBLIC_API_KEY`，由 Compose 从规范部署 `PUBLIC_API_KEY` 桥接
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_DATABASE_URL`
  - `BETTER_AUTH_DATABASE_POOL_SIZE=10`
  - `AUTH_BRIDGE_SECRET`
- 前端 Docker 构建在 `bun run build` 之前还必须提供构建期 Better Auth 占位值，因为 Next
  生产构建在收集页面数据时会加载 `/api/auth/[...all]`。这些构建期值不得是真实生产密钥；
  真实值由运行时 compose 环境提供。
- 生产后端环境必须包含：
  - `DATABASE_URL`
  - `PUBLIC_API_KEY`；`DEBUG=false` 时，缺失值与已知的 `sk_public_local` 开发值都是启动错误
  - `AUTH_BRIDGE_SECRET`
  - `BACKEND_CORS_ORIGINS`（使用域名或拆分源时）
  - `MINIMUM_DAEMON_VERSION`，作为生产显式声明的兼容下限
  - `DAEMON_RELEASE_VERSION`，供接入（onboarding）与重连命令广播的自托管 Daemon 包版本
- 本地后端 checkout 只能从 `release-artifacts/smallkhoj-daemon/` 下实际存在的那一个已生成
  发布清单/tgz 发现 `DAEMON_RELEASE_VERSION`。绝不能把源码 `package.json.version` 单独变成
  可下载 URL；生产仍通过 `.env.prod` 显式提供已发布版本。
- Daemon 接入命令按平台与阶段组织：
  - Windows 使用独立的 PowerShell `install.ps1`、`aura setup` 与显式 Connect 命令；发布物
    携带真实 PE `aura.exe` 与私有 `node.exe`，因此宿主机不需要 Node/npm/npx。
  - macOS/Linux 使用托管的 Aura Ensure 安装器与稳定的 `aura` 启动器；旧式自托管 npx tgz
    命令仍作为兼容回退保留。
  - `platforms[platform].install/setup/connect` 携带 shell 标签与阶段名。UI 只渲染被选中的
    平台。
  - `--server-url` 必须来自公共浏览器源或已配置的公共 API base，绝不来自内部 Docker/后端
    URL。`--api-key` 是首次连接用的一次性 `sk_connect_...` 票据（ticket），或重连用的
    `sk_machine_...` 令牌。
  - 预览/setup 元数据不带票据。显式 Connect/Reconnect 会创建新票据并返回 `expiresAt`；
    存在活跃租约（lease）时，会在创建票据之前以 `DAEMON_LEASE_ACTIVE` 与
    `stop`/`wait`/`retry` 动作拒绝。
  - 旧包名与 `aura` bin 保持可用以兼容 npx；独立安装器绝不能静默回退到源码路径。
- 密钥与提供商凭据必须放在仓库之外，通常放在 `docker compose --env-file` 所用的服务器端
  环境文件中。
- 已部署的公共客户端凭据只有一个操作员输入：`PUBLIC_API_KEY`。后端运行时直接读取它；前端
  生产构建只通过 `--secret id=public_api_key,env=PUBLIC_API_KEY` 接收它；Compose 把它桥接为
  前端容器的 `NEXT_PUBLIC_API_KEY`。不要把它放进构建参数、CLI 计划 JSON、URL、日志、截图
  或错误详情。
- `NEXT_PUBLIC_*` 值会被编译进浏览器包。因此轮换 `PUBLIC_API_KEY` 需要重建前端镜像，并以
  相同值重启后端/前端；只改容器运行时环境会留下旧的浏览器包。
- 客户端可达的模块必须通过显式静态属性读取来适配环境值，例如
  `process.env.NEXT_PUBLIC_API_KEY`。不支持把完整 `process.env` 对象传给解析器：Next.js
  不保证在客户端 chunk 中做动态属性发现/内联。保持公共适配器与服务器适配器分离，使
  `INTERNAL_API_BASE_URL` 永远不会被加进公共适配器。
- 公共客户端凭据在编译后对浏览器可见，且不是账号/会话身份。HTTP 与 SSE 使用
  `X-Public-Key`；聊天 WebSocket 使用请求的 `smallkhoj.public-key.<base64url>` 子协议，且
  只协商 `smallkhoj.chat.v1`。Better Auth 会话、服务器间认证桥接密钥与 agent/machine
  令牌仍是彼此独立的主体与传输。
- 当前中国大陆云实例可用于仅 IP 的 HTTP 冒烟测试。在大陆实例上使用自定义公共域名，需要
  在正常公开发布之前完成 ICP 备案。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 证据声称「已部署可用」但只测了 `localhost:3000` | 证据无效；改在 `local-prod` 或 `cloud-prod` 上重跑。 |
| E2E 作用域声明 disposable，但任一实际数据库 URL 是远端、无标记或指向另一个数据库 | 在运行破坏性集成流程之前失败关闭（fail-closed）。 |
| `GET <cloud-base>/api/health` 失败 | 部署阻断项。不得声称云端就绪。 |
| `GET <cloud-base>/docs` 失败 | 后端/Caddy 路由阻断项。 |
| `GET <cloud-base>/downloads/smallkhoj-daemon/<daemon-package>.tgz` 失败 | Daemon 接入部署阻断项。 |
| 冒烟缺少显式包版本、`DAEMON_RELEASE_VERSION` 或唯一生成的制品 | 以包版本配置错误失败关闭；绝不探测历史硬编码 URL。 |
| `GET <cloud-base>/login` 失败或未渲染（render）出已部署的登录页 | 前端/Caddy 路由阻断项。 |
| `WS /internal/agent-api/ws` 无法经 Caddy 访问 | Daemon/runtime 部署阻断项。 |
| 前端因缺少 Better Auth 环境变量而构建或启动失败 | 环境契约失败；先修环境，再测 UI 行为。 |
| 前端 Docker 构建以 `BETTER_AUTH_SECRET is required in production` 失败 | Dockerfile 构建阶段环境契约失败；添加构建期占位值，真实密钥留在运行时环境。 |
| `dev.sh status` 与手动启动的会话进程不一致 | 就该项证据而言视 `dev.sh` 为失效（stale）；检查真实端口/进程/日志。 |
| `localhost:3000` 上登录/注册显示 `Auth bridge secret is not configured` | 后端启动时未带 `AUTH_BRIDGE_SECRET`；以一致的后端/前端认证环境重启 local-dev。 |
| `localhost:3000` 上登录/注册显示 `Invalid auth bridge secret` | 后端与前端 `AUTH_BRIDGE_SECRET` 值不匹配。 |
| 生产镜像中 `NEXT_PUBLIC_API_BASE_URL` 指向 localhost | 生产镜像无效；以同源空值或真实公共主机重建。 |
| 生产前端构建没有 `PUBLIC_API_KEY` BuildKit secret | 构建在产出镜像之前失败，且不回显凭据。 |
| 尽管 Next 进程持有 local/public 环境变量，浏览器仍抛出生产 public-key 错误 | 检查客户端适配器是否在动态传递 `process.env`；恢复显式 `process.env.NEXT_PUBLIC_*` 读取，且不削弱失败关闭校验。 |
| 生产前端构建只通过 build arg 得到 `NEXT_PUBLIC_API_KEY` | 无效的生产调用；build arg 仅在显式 `local-dev` 下可接受。 |
| 聊天 WebSocket URL 含 `api_key` 或其他可复用凭据 | 认证契约违规；拒绝该 URL 路径，使用经评审的子协议传输。 |
| Windows UI 显示 Unix curl/bash 或 npx 指引 | 产品缺陷；只显示所选 Windows PowerShell 的独立阶段。 |
| 所选平台隐藏其 Install/Setup/Connect 阶段，或渲染另一平台的可复制命令 | 产品缺陷；保持标签页互斥，并渲染所选平台的全部三个阶段。 |
| 预览/setup 创建票据或显示过期倒计时 | 契约违规；在 Connect/Reconnect 之前返回 `ticket: null` 且无过期时间。 |
| 预览或命令生成期间发现活跃租约 | 返回/显示 `DAEMON_LEASE_ACTIVE` 与 stop/wait/retry 指引，且不创建票据。 |
| 生成的独立命令以源码 checkout 路径开头 | 产品缺陷；该命令无法用于生产安装。 |
| npm 发布之前旧式 npx 回退就指向 `@smallkhoj/smallkhoj-daemon@latest` | 发布阻断项；保持 registry 覆盖为空，让兼容路径使用自托管 tgz URL。 |
| `DAEMON_NPX_PACKAGE` 被设为 registry 包且 `npm view <package>` 返回 404 | 该覆盖的发布阻断项；取消该环境变量或发布该包。 |
| `GET <base>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-<version>.tgz` 失败 | 发布阻断项；重新生成/上传 daemon 制品。 |
| `npm pack --dry-run --json` 包含 `.slock`、`.slock-runtimes`、`test/`、本地 workspace 或源码 checkout 制品 | 发布阻断项；发布前修复 daemon 包的 `files` 白名单。 |
| `npx -y ./<daemon-package>.tgz --version` 无法确定可执行文件 | 包/bin 命名缺陷；让包的非作用域名称与 `smallkhoj-daemon` bin 对齐。 |

### 5. 正例/基准/反例

- 正例：「在 `http://124.222.40.40` 验证了 `cloud-prod`：`/api/health`、`/docs`、`/login` 与冒烟命令均通过。」
- 正例：「修改 Caddy/认证环境后，用 `docker-compose.prod.yml` 验证了 `local-prod`。」
- 基准：「仅就前端布局（layout）验证了 `local-dev`；云端验证仍待完成。」
- 反例：「打开了 `http://localhost:3000/login`，所以生产部署已就绪。」
- 反例：「修改了 daemon WebSocket 路由却跳过 Caddy/云端冒烟。」
- 反例：「以 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` 构建前端并上传到云端。」

### 6. 必需测试

对于部署/代理/认证变更：

- 以必需的 Better Auth 环境值运行前端 lint 与构建。
- 运行交付环境校验器测试，证明 E2E 会拒绝远端、无标记或后端/Better Auth 不匹配的数据库目标。
- 运行 runtime URL 契约测试，该测试拒绝动态 `resolve*(process.env)` 客户端调用并要求显式
  公共环境属性读取；仅 `next build` 成功不是浏览器运行时证明。
- 对实际目标基址 URL 运行 `scripts/post_deploy_smoke.py`。
- 运行 `scripts/initial_release_foundation_gate.py` 做发布级门禁。
- 在所选环境上验证 `/api/health`、`/docs`、`/login` 与 daemon WebSocket 路由。
- 验证仓库 UI 行为时，用 `./twd` 获取面向浏览器的产品证据，而不是裸 Playwright。
- 对于 daemon 接入变更：
  - 后端命令生成测试断言平台/阶段结构、预览无票据、显式 Connect/Reconnect 创建票据、
    租约预检（preflight）以及旧式 Unix 回退；
  - daemon CLI 测试证明 `--server-url` + `--api-key` 能连接/注册，并在不持久化凭据的情况下
    暴露结构化租约冲突；
  - 安装器测试证明托管制品/启动器与回滚（rollback）契约；
  - 当 npx 回退已发布时，`npm pack --dry-run --json` 与托管 tgz 检查仍是兼容性覆盖；
  - 执行 UI 生成的命令必须给出所选平台 install/connect 路径、daemon 注册、WebSocket 接受
    与关闭/断开的后端证据；
  - `./twd` 证据证明 DOM 中只有所选平台的阶段命令，且 `connect-status-region` 中可见活跃
    租约指引。

对于云端部署证据：

- 记录目标环境、基址 URL、主机、镜像标签、归档路径，以及本次运行是否使用了 VPN 代理。
- 记录确切的冒烟命令与健康输出。
- 若测试的是仅 IP 的 HTTP，需明确说明这不是 HTTPS/域名/ICP 验证。

### 7. 错误 vs 正确

#### 错误

```text
I started backend and frontend locally, opened http://localhost:3000/login, so the release deployment is ready.
```

#### 正确

```text
I validated local-dev only. For release readiness, next run local-prod or cloud-prod smoke against http://124.222.40.40 and record the target environment.
```

#### 错误

```text
Render PowerShell, curl/bash, and npx commands together, create a ticket while
the dialog is opening, and return only HTTP 409 when a daemon lease is active.
```

#### 正确

```text
Render the selected platform's Install -> Setup -> Connect phases, keep preview
ticket-free, and return DAEMON_LEASE_ACTIVE with stop/wait/retry guidance before
creating a new ticket. Keep npx as an explicit compatibility fallback only.
```

## 场景：自包含的 CI 安全扫描

### 1. 作用域 / 触发

当 GitHub Actions 作业扫描构建制品或服务日志以查找凭据、令牌或其他发布阻断模式时，使用本契约。

### 2. 签名

基线（baseline）Ubuntu runner 扫描命令：

```bash
grep -Fq -- "$literal_value" "${files[@]}"
grep -Eq -- "$extended_regex" "${files[@]}"
```

### 3. 契约

- 安全扫描使用的每个可执行文件，要么属于该作业声明的基线 shell 环境，要么在使用前于该
  作业中显式装备。
- 字面量凭据使用固定字符串匹配；令牌族使用经显式评审的扩展正则表达式。
- 扫描器退出状态是失败关闭的：`0` 表示命中违禁内容，`1` 表示未命中，其他所有状态都表示
  扫描本身失败。
- 所有输入日志必须在扫描前证明可读。缺失日志是门禁失败，不是空日志成功。
- 工作流契约测试必须拒绝未装备的扫描器依赖；不得只断言目标 runner 上不可用命令的文本。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 字面量或令牌模式命中某条服务日志 | 令作业失败并指明凭据类别，但不打印其值。 |
| 扫描器对每个必需检查都返回 `1` | 凭据日志扫描通过。 |
| 扫描器可执行文件缺失 | 契约失败；合并前装备它或改用基线命令。 |
| 扫描器返回大于 `1` 的状态 | 带标签与状态令作业失败；不得当作未命中。 |
| 某条必需日志缺失或不可读 | 在扫描之前失败。 |

### 5. 正例/基准/反例

- 正例：使用自带的 GNU grep，以 `-Fq` 匹配字面量密钥、以 `-Eq` 匹配经评审的令牌模式，
  同时保留全部三类退出状态。
- 基准：在同一作业中显式安装并锁定版本地装备非基线扫描器，然后在工作流契约中断言该装备。
- 反例：因为开发者机器碰巧有 `rg` 这类便利的本地工具，就不加安装直接调用。

### 6. 必需测试

- 交付工作流契约断言确切的固定字符串与 ERE 扫描形态。
- 该契约拒绝已知的未装备 `rg --quiet` 形式。
- 已认证的一次性集合作业在后端与前端日志都捕获之后，于 GitHub 的目标 runner 上运行扫描。
- 命中凭据、未命中状态、不可读日志与扫描器错误必须保持各自不同的失败/通过行为。

### 7. 错误 vs 正确

#### 错误

```bash
# The job never installs ripgrep.
rg --quiet --fixed-strings -- "$AUTH_BRIDGE_SECRET" "$service_log"
```

#### 正确

```bash
grep -Fq -- "$AUTH_BRIDGE_SECRET" "$service_log"
scan_status=$?
# 0 = leak, 1 = clean, >1 = scanner failure
```

## 场景：兼容的 Daemon 包发布上线（rollout）

### 1. 作用域 / 触发

当 Daemon 包的可执行文件、打包内容或版本发生变化，而云端服务器上可能仍有已连接客户端在
运行较早的兼容版本时，使用本契约。

### 2. 签名

```text
Candidate source:
  agent/daemon/aaa-daemon/package.json.version = <package-version>

Authenticated CI candidate environment:
  DAEMON_RELEASE_VERSION=<package-version>
  E2E_DAEMON_VERSION=<package-version>

Production release environment:
  MINIMUM_DAEMON_VERSION=<compatibility-floor>
  DAEMON_RELEASE_VERSION=<published-package-version>

npx -y --package <base>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-<published-package-version>.tgz aura --server-url <base> --api-key <token>
```

### 3. 契约

- `agent/daemon/aaa-daemon/package.json.version` 是唯一手工维护的当前 Daemon 候选（candidate）
  版本。生成的 lockfile 元数据可以镜像它，但手写的工作流、测试与当前版本文档不得成为
  相互竞争的权威来源。
- checkout 之后，已认证 CI 必须解析并校验该包字段，然后通过 `GITHUB_ENV` 把相同值导出到
  `DAEMON_RELEASE_VERSION` 与 `E2E_DAEMON_VERSION`。缺失、非字符串或非语义化版本值会在
  候选安装或 E2E 之前失败。
- CI 不得把语义化版本字面量直接赋给任一发布变量。因此一次包版本提升只改一个手工维护的值。
- `MINIMUM_DAEMON_VERSION` 是 Daemon 连接、注册与心跳（heartbeat）请求的准入门禁；它不是
  包 URL 版本。
- `DAEMON_RELEASE_VERSION` 为接入与重连命令选择生成的自托管包 URL。
- 生产不会自动跟随未发布的源码候选：操作员显式选择 `DAEMON_RELEASE_VERSION`，且该选择
  必须与实际打入后端镜像并托管在生成 URL 上的 tgz 一致。
- `DAEMON_RELEASE_VERSION` 对应的发布包必须从匹配源码重新生成，并复制进后端镜像的
  `release-artifacts/smallkhoj-daemon/` 目录。
- 包清单必须暴露 `aura` bin。既有的 `smallkhoj-daemon` bin 可以为命令兼容而保留。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| CI 把语义化版本字面量赋给任一发布变量 | 交付契约失败；改为从 `package.json.version` 派生两个值。 |
| 候选包版本缺失、非字符串或非语义化版本 | 已认证 CI 在安装/E2E 之前失败关闭。 |
| 源码候选比当前已发布的生产包新 | 有效的预发布状态：CI 测试候选，生产继续选择最后托管的包。暂不要在生产中广播该候选。 |
| `DAEMON_RELEASE_VERSION` 比 `MINIMUM_DAEMON_VERSION` 新 | 新的接入命令使用新包，同时兼容的旧客户端继续注册与心跳。 |
| 后端广播 `aura`，但其打入的 tgz 没有 `aura` bin | 发布阻断项；构建后端镜像前重新生成该包。 |
| 仅为广播新包而抬高 `MINIMUM_DAEMON_VERSION` | 兼容性回退；恢复门禁原值并单独配置 `DAEMON_RELEASE_VERSION`。 |
| 部署后 `DAEMON_RELEASE_VERSION` 对应的托管 tgz 缺失 | Daemon 接入阻断项；不得声称发布就绪。 |

### 5. 正例/基准/反例

- 正例：只提升 `package.json.version`；CI 派生两个候选变量，然后发布该已测试包，并在生产
  中显式选择同一托管版本。
- 基准：发布待定期间，CI 测试较新的源码候选，生产继续广播上一个已验证的托管包。
- 基准：仅当新包要求不兼容的协议变更且已沟通升级窗口时，才同时有意抬高两个值。
- 反例：把当前包版本复制进工作流 YAML、在同一 URL 覆盖更早的制品，或仅为改变命令别名而
  抬高最低版本。

### 6. 必需测试

- 交付工作流契约要求从包派生的 `GITHUB_ENV` 导出，并拒绝向任一 CI 变量赋语义化版本字面量。
- 后端命令生成测试断言：比最低版本新的发布版本会生成新的托管 tgz URL。
- 后端默认命令测试与 Daemon 注册/连接测试从包元数据派生当前版本期望；独立的覆盖值与兼容
  值仍是显式测试数据。
- Daemon 包测试断言包元数据与注册/连接载荷（payload）使用已发布版本并暴露 `aura`。
- 部署后，冒烟测试从 `/downloads/smallkhoj-daemon/` 请求确切的已发布 tgz。

### 7. 错误 vs 正确

#### 错误

```text
CI workflow:
  DAEMON_RELEASE_VERSION=<copied-current-version>
  E2E_DAEMON_VERSION=<copied-current-version>

Production:
  MINIMUM_DAEMON_VERSION=<new-package-version>  # raised only to advertise it
```

#### 正确

```text
CI:
  package.json.version
    -> GITHUB_ENV
    -> DAEMON_RELEASE_VERSION + E2E_DAEMON_VERSION

Production:
  MINIMUM_DAEMON_VERSION=<compatibility-floor>
  DAEMON_RELEASE_VERSION=<actually-hosted-package-version>
```

## 场景：仅 Daemon 的载体（carrier）刷新

### 1. 作用域 / 触发

仅当一次发布改变了 Daemon 包载荷（payload），而后端/前端/Caddy 源码、迁移与生产环境接线
都保持不变时，才使用本路径。

### 2. 签名

```text
Daemon artifact -> Backend carrier image -> docker save/SCP/load
  -> app-only backend recreate -> public package/health/WS smoke
```

所选包版本必须来自显式的 `DAEMON_RELEASE_VERSION`、`--daemon-package-version` 或正在测试的
唯一生成制品清单。任何脚本都不得内嵌当前语义化版本字面量。

### 3. 契约

- 即使 Python 源码未变也要重建后端载体：镜像包含
  `release-artifacts/smallkhoj-daemon/`，它对外提供公共 npm tgz。
- 既有生产数据库不在更新集合之内。唯一的更新命令是：

  ```bash
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
    --force-recreate --no-deps --no-build --pull never backend
  ```

- 仅 Daemon 刷新时不要重建 frontend、caddy 或 db。
- 在声称刷新健康之前，记录新旧制品 SHA-256、源码修订、清单、镜像源修订、Alembic 前后
  head、`/api/health`、包 GET 与 WS 认证拒绝。
- 常规制品规则是不可变的带版本 URL。同版本替换 tgz 是受控例外：保留旧制品/校验和，记录
  两个哈希与公共 GET 结果，并为可能已缓存旧载荷的客户端写明 npm/npx 缓存失效。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| Daemon 载荷已变但后端载体未重建 | 阻断；运行中的镜像可能仍在提供旧 tgz。 |
| 仅应用刷新命令包含 `db`、`frontend` 或 `caddy` | 契约违规；停下并使用仅后端命令。 |
| 同版本替换缺少新旧 SHA 或回滚副本 | 阻断发布证据；恢复带版本制品或补齐缺失的台账。 |
| 没有字面量回退就无法解析包版本 | 失败关闭并要求显式的已发布版本。 |

### 5. 正例/基准/反例

- 正例：重建载体、只加载后端镜像、重建 backend 容器，并证明托管包 SHA 按预期变化、
  Alembic 保持一致。
- 基准：仅在受控事件且有完整哈希/缓存/回滚记录时使用同版本替换。
- 反例：覆盖 tgz 后仅重启 daemon，或在既有生产更新命令中包含 `db`。

### 6. 必需测试

- Daemon 聚焦测试与制品清单/校验和校验。
- 带确切源码修订标签的后端载体构建。
- 仅应用 Compose 计划检查，以及用显式已发布包版本做云端 `/api/health`、包与 WS 冒烟。

### 7. 错误 vs 正确

#### 错误

```text
Replace a same-named tgz, run `docker compose up -d db backend`, and infer that
the new Daemon is deployed from the version string alone.
```

#### 正确

```text
Record the artifact identity, rebuild/load the Backend carrier, recreate only
backend, and verify the served bytes plus health/WS evidence.
```

## 场景：直接镜像归档的云端部署

### 1. 作用域 / 触发

在没有容器 registry 或 CI 镜像推送的情况下部署到首台腾讯云 Lighthouse 主机时使用。这是
当前的云端部署路径。

### 2. 签名

脚本：

```bash
python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar \
  --platform linux/amd64 \
  --capacity-report /absolute/path/to/formal-capacity-report.json \
  --release-evidence /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.release-evidence.json \
  --use-vpn-proxy
```

服务器上加载的默认镜像标签：

```text
smallkhoj-backend:local-release
smallkhoj-frontend:local-release
smallkhoj-caddy:local-release
```

未覆盖时的默认本地归档路径：

```text
/tmp/smallkhoj-production-images.tar
```

### 3. 契约

- 当前云端部署是无 registry 的镜像归档传输：本地构建 -> `docker save` -> SSH/SCP 上传 ->
  远端 `docker load` -> 远端 `docker compose`。
- 大型本地归档优先放在 ORICO 路径，避免系统盘压力。
- 按实际服务器架构选择 `--platform`。除非新的主机探测另有结论，当前 Lighthouse Docker
  镜像目标已验证为 `linux/amd64`。
- `--use-vpn-proxy` 为 `http://host.docker.internal:7897` 传入 Docker 构建代理参数。
- `--skip-daemon-build` 复用预构建的 daemon 制品目录（例如由官方 PE 输入组装的 win32-x64
  ZIP），但仍构建后端、前端与 Caddy 载体镜像。它不得与 `--skip-build` 组合使用。
- 服务器环境文件与密钥绝不打入镜像归档，也绝不提交。
- 真实运行 `production_image_transfer.py` 构建之前，在调用方环境中导出 `PUBLIC_API_KEY`，
  并把相同值放进服务器端 `.env.prod`。前端步骤使用
  `--secret id=public_api_key,env=PUBLIC_API_KEY`；dry-run/JSON 命令计划只含该引用，绝不
  含值。
- 生产镜像构建上下文必须是干净的 Git 候选：已暂存、未暂存与未跟踪文件都是发布阻断项。
  写入 `org.opencontainers.image.revision` 的修订必须等于 checkout 的 `HEAD`；操作员提供的
  修订是校验输入，不是给另一个文件系统快照（snapshot）改标签的许可。
- `--skip-build` 只有在后端、前端与 Caddy 镜像标签经本地检查且全部等于同一干净候选
  `HEAD` 之后，才可保存既有镜像。标签缺失或不匹配是发布阻断项。
- squash 合并之后执行的云端发布构建必须使用已接受的正式容量报告，并要求当前合并提交树
  等于被测候选树。镜像修订标签仍是合并提交 SHA；在发布证据中保留「被测树 -> 合并 SHA」
  的映射。
- 正式发布传输（包括 `--skip-build`）需要已接受的 `--capacity-report`，且仍受正式 profile
  检查约束。任务作用域的功能传输可改用显式组合 `--task-scoped --task-id <task-id>`；它不
  记录容量声明，也不能满足初始发布或正式容量门禁。诊断冒烟仍是有用的运行时证据，但绝
  不能改标签冒充正式验收。
- 发布消费方必须从完整原始报告重算 schema-v5 容量失败项，并要求存储的 `acceptance` 对象
  与该结果完全一致。不做重估就信任可变的 `acceptance.passed=true` 摘要，是阻断发布的
  校验缺陷。
- 成功的传输必须原子化持久化并输出带 schema 版本的 JSON 发布证据。它绑定被测候选
  HEAD/树、当前合并 HEAD/树、正式 profile 加容量报告路径/哈希、经检查的镜像
  tag/ID/revision/platform，以及保存的归档路径/哈希。默认证据路径是
  `<output-archive>.release-evidence.json`；其中不得含任何密钥值。
- 加载镜像之后，服务器 compose 环境必须引用已加载的 `local-release` 标签或显式 registry
  标签。
- 上传/加载成功并不足够。始终针对公共基址 URL 运行部署后冒烟。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 在 Apple Silicon 上构建本地归档且未指定 `--platform`，而服务器是 x86_64 | 无效部署制品；为 `linux/amd64` 重建。 |
| 归档创建在 `/tmp` 下且担心系统盘压力 | 使用 `--output-archive /Volumes/ORICO/...`。 |
| `docker load` 成功但 compose 仍使用旧镜像标签 | 启动服务前修正 `.env.prod` 的镜像标签值。 |
| `docker compose up -d` 成功但冒烟失败 | 视为部署失败；检查 Caddy/后端/前端日志。 |
| 构建时代理/网络下载超时 | 带 `--use-vpn-proxy` 或显式代理参数重跑。 |
| 正式路径收到冒烟、失败/伪造或失效的容量报告 | 在构建/上传之前阻断；不得把诊断或旧证据重新解释为发布验收。 |
| 任务作用域路径省略 `--task-id`、使用不安全/缺失的 Trellis 任务，或同时提供 `--capacity-report` | 在构建/上传之前阻断；选择一个显式部署门禁。 |
| 任务作用域传输后来被当作正式容量或初始发布证据 | 拒绝该主张；其发布证据明确写着 `capacityClaim=not-asserted`。 |
| 被测候选 SHA 与 squash 合并 SHA 不同但两个 Git 树一致 | 接受该映射，用合并 SHA 标注镜像，并在发布证据中记录两个身份。 |
| 传输后无法持久化发布证据 | 视为不完整的发布证据，不声称发布完成。 |

### 5. 正例/基准/反例

- 正例：dry-run 传输计划，构建/上传/加载镜像，启动 compose，然后运行云端冒烟。
- 正例：把本地 Docker 归档存放在 `/Volumes/ORICO/...`，用于大型发布制品。
- 基准：仅当本地已存在确切的所需镜像标签时才使用 `--skip-build`。
- 反例：在本地构建 `linux/arm64` 镜像并加载到 x86_64 的 Lighthouse 主机。
- 反例：把腾讯云凭据、SSH 私钥或环境密钥粘贴进被跟踪的文件。

### 6. 必需测试

- 新部署形态之前，运行 `python3 scripts/production_image_transfer.py ... --capacity-report <accepted-formal-report.json> --dry-run`。
- 真实传输成功后保留并校验 `<output-archive>.release-evidence.json`；其中的报告/归档哈希、
  镜像身份与「被测树 -> 合并 SHA」映射是机器可读的发布溯源。
- 本地或远端 `docker image ls` 确认预期标签。
- 启动后在远端运行 `docker compose --env-file .env.prod -f docker-compose.prod.yml ps`。
- `python3 scripts/post_deploy_smoke.py --base-url <cloud-url>
  --daemon-package-version <published-package-version> --allow-http --json`。
- 发布级：`python3 scripts/initial_release_foundation_gate.py --base-url <cloud-url>
  --daemon-package-version <published-package-version> --allow-http --json`。

### 7. 错误 vs 正确

#### 错误

```text
scp repo to the server, run ad hoc build commands there, and call it deployment evidence.
```

#### 正确

```text
Use production_image_transfer.py to produce explicit image tags, upload/load the archive, run docker-compose.prod.yml, and smoke the public base URL.
```

## 场景：正式本地容量证据

### 1. 作用域 / 触发

当一份报告被呈现为「发布候选在当前标称 4 vCPU / 4 GB 部署形态上支持数百连接用户」的证明
时，使用本契约。简短的 harness 冒烟是有用的诊断证据，但不是正式容量验收。

### 2. 签名

正式 profile 标识符：

```text
formal-300-500-30-v1
```

正式报告 schema：

```text
schemaVersion=5
```

诊断 profile 标识符：

```text
smoke
```

候选身份标签：

```text
org.opencontainers.image.revision=<40-character-clean-candidate-HEAD>
```

### 3. 契约

- `acceptance.passed=true` 仅保留给 `formal-300-500-30-v1`。`smoke` 报告必须携带显式的
  非正式失败/处置说明，且绝不能被描述为正式容量验收。
- 正式 profile 不可降级。它要求至少 300 个稳态 SSE 连接、500 个峰值 SSE 连接、30 个活跃
  用户、1,800 秒活跃工作负载、峰值爬坡前 590 秒、峰值保持 60 秒，以及 60 秒清理观察。
  活跃周期与资源采样不慢于五秒；稳态爬坡不超过 60 秒，峰值爬坡不超过 10 秒。
- 正式延迟上限不得弱于 2,000 ms SSE 就绪 p95、500 ms 读 p95、1,000 ms 写 p95 与 2,000 ms
  事件（event）送达 p95。PostgreSQL 余量至少五个连接，清理差值至多两个连接。
- 正式环境绑定的是整个部署范围的 PostgreSQL 连接预算，而不只是后端 worker 与 NOTIFY
  发布者连接：
  - `DATABASE_POOL_SIZE=5`；
  - `DATABASE_MAX_OVERFLOW=10`；
  - `NOTIFY_PUBLISHER_POOL_SIZE=2`，外加每个后端 worker 恰好一个监听器连接；
  - `BACKEND_WORKERS=1`，产出 `18` 个后端连接；
  - `BETTER_AUTH_DATABASE_POOL_SIZE=10`，用于进程单例的前端连接池；
  - 为使用相同 `5 + 10` 连接池的一个飞书（Feishu）worker 预留 `15` 个连接；
  - `POSTGRES_CONNECTION_HEADROOM=5`；
  - 所需总预算 `18 + 10 + 15 + 5 = 48`，位于 PostgreSQL `max_connections=100` 之内。
- schema-v5 报告必须记录每个基础与派生的连接预算字段。评估器独立重算
  `backendPerProcess`、`backendTotal`、飞书预留与 `required`，然后要求与上述正式值完全
  一致。它必须拒绝在保持总数不变的同时把容量在连接池、溢出、前端或余量之间挪动的同步
  替换。
- 定向运行时证据必须从后端容器读取六个预算输入加 `POSTGRES_MAX_CONNECTIONS`，并从前端
  容器读取 Better Auth 连接池大小。后端环境容量、前端环境容量、`SHOW max_connections`、
  报告配置与原始监听器历史必须在正式验收之前一致。
- v1 正式拓扑恰好有一个前端容器/进程，`feishu-worker` 容器为零。`15` 连接的飞书项是未
  实际运行的保守预留，不是测试过 worker 负载或 worker CPU/内存的证据。只要作用域内存
  在任何飞书 worker 容器，探针就会在装配 fixtures 之前失败。启用或扩缩该服务、增加前端
  副本或使用 Node cluster/workers，都需要显式的实例倍数、资源采样以及新的/经评审的容量
  profile；进程本地的 `globalThis` 单例不会跨越这些边界。
- 正式证据仅限本地，不能改标签为云端证据。它必须保留 `mode=local-only`、回环 API 目标、
  明确一次性且回环的数据库名/作用域、作用域内的 Compose 项目、必需服务列表，以及规范的
  限制清单。云端健康在新部署版本经过测试之前仍属待定。
- 目标资源信封（envelope）固定为四个 vCPU 与 3,564,584,960 个客户机可见字节。在
  db/backend/frontend/Caddy 之间，每个原始采样都必须保持在聚合内存 2,673,438,720 字节
  与聚合 CPU 百分点 320 点及以下。这有意为宿主机留下余量，且不给 swap 计入任何容量。
- 候选溯源在运行前后各采样一次，必须相同且干净，并包含提交 SHA 与 Git 树 SHA。后端、
  前端与 Caddy 的 OCI 修订标签必须全部等于该候选 `HEAD`。
- 从基线到清理，每个有效原始资源采样必须观察到每个后端 worker 恰好一个
  `smallkhoj-notify-listener` 归属者。历史峰值不是连续性证据。发布者连接可以变化，但绝
  不能超过 `workers * NOTIFY_PUBLISHER_POOL_SIZE`。
- 原始 PostgreSQL/数据库/容器历史是权威：累计数据库计数器单调，基线零死锁、零容器重启，
  容器 identity/image/restart/OOM/running 状态对每个采样都有效，阶段/时间覆盖完整，且
  所有摘要都能从原始采样精确重算。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 一次 5/8/3 短运行被标注为正式或报告 acceptance 通过 | 以 `FORMAL_CAPACITY_PROFILE_INVALID` 或 `NON_FORMAL_CAPACITY_PROFILE` 拒绝。 |
| 正式报告缺少阈值证据或放宽了 p95/余量上限 | 以 `FORMAL_CAPACITY_PROFILE_INVALID` 拒绝。 |
| 正式报告期望 PostgreSQL 最大连接数不是 100 | 以 `FORMAL_CAPACITY_PROFILE_INVALID` 拒绝。 |
| 连接预算证据缺失、算术不一致、不完全等于经评审的 48 连接分配，或与后端/前端运行时环境不一致 | 以 `POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID` 拒绝；正式值替换同时使正式 profile 无效。 |
| 作用域内的正式项目包含任何飞书 worker 容器，或缺少零 worker 拓扑证据 | 在加载之前拒绝，或以 `DEPLOYMENT_SHAPE_EVIDENCE_INVALID` 拒绝；v1 报告不覆盖 worker 运行时负载。 |
| 基线看到了监听器，但之后任何原始阶段采样丢失它 | 以 `POSTGRES_NOTIFY_LISTENER_OWNERS_UNEXPECTED` 拒绝。 |
| 任何原始采样超出 4 vCPU / 3.32 GiB 目标资源预算 | 以 `TARGET_RESOURCE_ENVELOPE_EXCEEDED` 拒绝。 |
| 本地报告被改标签为云端/生产，或其限制清单被移除 | 以 `LOCAL_EVIDENCE_BOUNDARY_INVALID` 拒绝。 |
| 干净候选 SHA 与任何应用镜像修订标签不一致 | 以 `CONTAINER_IMAGE_REVISION_MISMATCH` 拒绝。 |
| 候选在运行期间发生变化 | 以 `CANDIDATE_CHANGED_DURING_RUN` 拒绝。 |
| squash 合并后的树与正式测试的候选树不同 | 阻断镜像传输，重建/重测正确的候选。 |
| 存储的报告主张通过，但重算发现失败项，或其存储的失败列表与重算不同 | 以重算的失败码加 `ACCEPTANCE_SUMMARY_MISMATCH` 拒绝；生产镜像传输不得继续。 |
| 原始历史与派生摘要不一致 | 拒绝受影响的摘要与报告。 |

### 5. 正例/基准/反例

- 正例：干净候选完整运行 30 分钟的 300/500/30 profile，且每个原始不变量（invariant）加
  阈值都通过。
- 基准：清晰标注的 5/8/3 冒烟验证 Docker/查询/报告接线，同时保持
  `acceptance.passed=false`；正式容量仍待定。
- 反例：调低所有内部相关计数、重算摘要，然后声称这份自洽的短报告证明了发布容量目标。

### 6. 必需测试

- 回归测试把通过的报告篡改为自洽的 1/2/1 profile 并要求拒绝。
- 回归测试在基线之后移除监听器归属者、重算 PostgreSQL 摘要，并要求拒绝。
- 回归测试移除或削弱阈值/profile/PostgreSQL 证据并要求拒绝。
- 回归测试篡改每个派生连接预算字段、使用非整数监听器证据、同步 `5/10 -> 4/11` 连接池
  拆分、同步 `Better Auth 10 / headroom 5 -> 9 / 6` 拆分，并同步
  `max_connections=100 -> 101`；每份被改标为正式的报告都必须保持被拒绝。
- 运行时检查测试证明后端命令只读取七个经评审的整数预算/容量变量，前端命令只读取
  `BETTER_AUTH_DATABASE_POOL_SIZE`；两种检查都不得转储容器环境。
- 部署形态测试要求作用域内飞书 worker 容器为零，并拒绝缺失、非整数或非零的可选服务
  证据。
- 回归测试把本地证据改标为云端证据并超出目标资源信封，然后要求拒绝。
- 生产传输测试要求 squash 之后被接受报告的树相等，并拒绝不同的合并树。它们还必须证明
  传输校验器会重算完整报告，而不是信任伪造的通过摘要。
- 在提交的正式运行之前，一次简短的新鲜 local-prod 冒烟验证真实 Docker 检查与定向运行时
  证据。
- 最终正式运行使用全新一次性卷，并在作用域内 `docker compose down -v --remove-orphans`
  清理之前保留机器可读报告。

### 7. 错误 vs 正确

#### 错误

```text
The clean 5/8/3 smoke passed, therefore the 300/500 release capacity gate passed.
```

#### 正确

```text
The 5/8/3 smoke validated the harness only. Formal capacity remains pending until the
clean candidate completes formal-300-500-30-v1.
```

---

## 场景：真实测试的候选身份门禁

### 1. 作用域 / 触发

- 触发：为浏览器/runtime/核心流程验证选择或启动本地栈，为真实测试选择端口/进程/容器/
  数据库，或决定一个健康的 URL 是否可用作验收证据。
- 来源：`.agents/skills/smallkhoj-real-test`（SKILL + `references/runtime-topology.md`）；
  在选择任何环境之前运行其只读收集器（`rtk bash .agents/skills/smallkhoj-real-test/scripts/collect-context.sh`），
  并在任何委托测试提示词的顶部嵌入完整 `<smallkhoj-real-test-context>` 块。

### 2. 签名

```text
rtk bash .agents/skills/smallkhoj-real-test/scripts/collect-context.sh   # read-only context
./dev.sh start            # reuses already-running processes by default (may be an old build)
./dev.sh restart | SMALLKHOJ_DEV_FORCE_RESTART=1 ./dev.sh start          # force current worktree code
uv run python main.py     # backend: NO hot reload — backend changes require restart
npm run dev               # frontend: hot reload active
Docker local-test Caddy :38190/:38191                                    # self-contained production-shape stack
BLOCKED_CANDIDATE_IDENTITY                                               # blocker verdict
```

### 3. 契约

- 做任何断言之前，先证明页面与 API 来自被测 worktree/提交：记录 worktree、分支、HEAD 与
  变更作用域；确认每个前端/后端进程来源。`dev.sh` 启动的进程只有在按照下面规则重启之后
  才对应本 worktree 的代码；Docker 容器只有在镜像被证明构建自被测提交时才是当前的。
- `./dev.sh start` 默认复用已在运行的进程，而那可能是旧构建。要保证当前 worktree 的代码，
  使用 `./dev.sh restart` 或 `SMALLKHOJ_DEV_FORCE_RESTART=1 ./dev.sh start`。后端
  （`uv run python main.py`）没有热重载——后端变更后必须重启；前端（`npm run dev`）会热重载。
- Docker `local-test`（Caddy `:38190`/`:38191`）是自包含的生产形态栈，其前端/后端/数据库
  都留在容器网络内部（其数据库不发布宿主端口）。长期运行的 local-test 实例只能证明该
  镜像的健康，永远不能证明当前 worktree；只有在证明镜像/构建溯源与被测提交一致之后，
  才能用它做当前变更的验收。Docker local-test 数据库与宿主 `:5432` 是不同的数据库。
- 当候选身份不明确时（URL 健康但溯源未证明），停下并输出 `BLOCKED_CANDIDATE_IDENTITY`——
  不要继续截图或业务断言。健康的 `:3000` 指向损坏的 `:8000`，意味着要修配置使两端属于
  同一个候选；绝不跨栈混合数据，也不借用其他栈的 cookie/数据库。
- 同源验证：前端、后端、认证会话、Server/Agent/Channel/Task 身份、Gate 结果与浏览器标记，
  必须在写 PASS 之前全部来自同一个候选。

### 4. 验证与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 候选 URL 健康但进程/镜像溯源未证明 | `BLOCKED_CANDIDATE_IDENTITY`；不截图、不做业务断言。 |
| 后端代码已变，`./dev.sh start` 复用了旧进程 | 失效候选；测试前运行 `./dev.sh restart`（或强制重启环境变量）。 |
| `:3000` 健康但 `:8000` 损坏 | 修配置使两端成为同一个候选；不要把后端指向共享宿主数据库，也不要改 `alembic_version` 来让它凑合可用。 |
| Docker local-test 连续运行数天后健康 | 只对该镜像有效的证据；不是当前 worktree 的验收。 |
| 测试需要数据库 | 遵循收集器的 DATABASE_URL 解析（`dev.sh` 默认宿主 `5432`）；绝不自动选用 `55432`（worker 栈保留）。 |
| 杀死他人拥有的进程/栈 | 没有用户明确授权则禁止；改为创建隔离的一次性候选。 |

### 5. 正例/基准/反例

- 正例：收集器输出加记录的 HEAD 证明 `:3000`/`:8000` 这对进程在 `./dev.sh restart` 之后
  运行本 worktree；标记、API、数据库与 Gate 证据都引用同一候选。
- 基准：不存在合格候选——拉起一个隔离的一次性栈，或报告确切的阻断项。
- 反例：把失效的 Docker 前端截图当作当前 worktree 变更的证据。
- 反例：复用其他栈的 cookie、数据库或 Server/Agent id 来「让测试通过」。

### 6. 必需测试

- 本门禁是流程性的，不可单元测试：其证据要求本身就是测试。验证报告必须写明候选身份
  （worktree/HEAD/进程或镜像来源）、使用的 URL、执行的命令、证据路径，以及 PASS 或确切
  的阻断项。
- 截图、旧 Docker 镜像或未执行的 Gate 永远不能外推结论。

### 7. 错误 vs 正确

#### 错误

```text
http://localhost:3000 loaded and the Docker local-test stack is green,
so the current worktree's frontend fix is verified.
```

#### 正确

```text
Collector + HEAD <sha> recorded; ./dev.sh restart brought both processes to this
worktree; ./twd marker evidence and API/DB checks ran against that candidate;
Docker local-test was not used as current-change evidence.
```
