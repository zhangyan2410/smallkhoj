# 发布流水线（Release Pipeline）

> 从本地验证、经 squash 合并、到免镜像仓库（registry-free）的腾讯云 Lighthouse 部署的端到端有序流水线，外加感知 schema 的回滚（rollback）契约（contract）。本文是**入口总览**；每个阶段链接到其详细契约 spec。当被问到"我们如何验证 / 合并 / 部署"时先读本文，再深入链接的 spec 查看精确断言。

## 场景（Scenario）：验证 -> 合并 -> 部署 -> 回滚流水线

### 1. 作用域（Scope）/ 触发条件

当工作需要走有序发布流水线时使用本 spec：

- 回答"本项目如何验证 / 测试 / 合并 / 部署 / 发布"；
- 规划发布候选、squash 合并或云端部署；
- 诊断某个变更当前处于流水线的哪个阶段；或
- 判断部署失败后是否允许镜像回滚。

本文是导航总览。权威契约存放在被链接的兄弟 spec 以及 `Makefile`、`.github/workflows/ci.yml` 与 `scripts/` 中。当本总览与被链接来源不一致时，以被链接来源为准。

### 2. 签名

流水线阶段（按顺序）：

```text
0. Local candidate      clean worktree + make ci green
1. Deployment gate      one of: formal capacity report (--capacity-report),
                        Trellis task scope (--task-scoped --task-id),
                        or user authorization (--authorized)
2. Squash merge         gh pr merge --squash --match-head-commit <SHA>
3. Tree equality        origin/main^{tree} == candidate tree
4. Image build/transfer production_image_transfer.py (non-dry-run, registry-free)
5. App-only deploy      docker compose up -d ... backend frontend caddy
6. Post-deploy smoke    OPTIONAL — only when the user explicitly requests it
7. Health window        OPTIONAL — only when the user explicitly requests it
   Rollback             schema-aware: allowed only when Alembic revision unchanged
```

权威命令：

```bash
# Phase 0 — deterministic local gate (Makefile: `ci` aggregate target)
make ci                       # = scripts-test backend-ci frontend-ci compose-check diff-check

# Phase 0 — per-stack full chains
# backend: uv lock --check -> uv sync --dev --locked -> alembic upgrade head &&
#          alembic check -> ruff check . -> pytest -q
# frontend: bun install --frozen-lockfile -> bun run test -> bun run lint ->
#           tsc --noEmit (+e2e) -> bun run build (asserts .next/standalone/server.js)
make backend-ci
make frontend-ci

# Phase 0 — committed deterministic E2E (NOT UI acceptance; starts services externally)
make e2e-authenticated        # = verify-e2e-env; cd frontend && bun run e2e

# Phase 0 — UI acceptance (project WebDriver wrapper; do NOT call twd.py directly,
#           do NOT substitute Playwright for repo UI verification)
./twd --compact tabs
./twd goto --url-match 127.0.0.1:<port> http://127.0.0.1:<port>/
./twd --compact scan --text --url-match 127.0.0.1:<port>

# Phase 2 — squash merge (no --delete-branch: avoid delete failure aborting a successful merge)
gh pr merge <PR> --squash --match-head-commit <candidate-SHA>

# Phase 4 — registry-free image build + transfer (requires clean HEAD == SHA)
# Formal release/capacity claim:
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 \
  --capacity-report <accepted-formal-report.json> \
  --use-vpn-proxy

# Functional deployment for one active Trellis task (capacityClaim=not-asserted):
# Add --skip-daemon-build when release-artifacts/smallkhoj-daemon was prepared
# from externally procured win32-x64 PE inputs on this same clean candidate.
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 \
  --task-scoped --task-id <task-id> --skip-daemon-build \
  --use-vpn-proxy

# User-authorized deployment (no capacity report, no Trellis task required):
# Same image build + transfer checks as a formal release, but gated by explicit
# user authorization instead of a capacity report. Records capacityClaim=
# "user-authorized" in release evidence. Use when the user says "deploy this".
# Requires PUBLIC_API_KEY in the caller environment (see note below).
export PUBLIC_API_KEY=<value-from-cloud-env.prod>  # see PUBLIC_API_KEY section below
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 \
  --authorized --skip-daemon-build \
  --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar \
  --use-vpn-proxy

# Phase 5 — app-only deploy (NEVER include `db` in the deploy command)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
  --force-recreate --no-deps --no-build --pull never backend frontend caddy

# Phase 6 — post-deploy smoke (OPTIONAL: only run when the user explicitly asks)
# Health route is /api/health, NOT /health.
python3 scripts/post_deploy_smoke.py --base-url http://124.222.40.40 --daemon-package-version <published-package-version> --allow-http --json
```

部署目标：

```text
Host:     124.222.40.40  (Tencent Lighthouse lhins-6gznhrts, ap-shanghai)
User:     ubuntu
Base URL: http://124.222.40.40   (HTTP:80 today; HTTPS/domain/ICP not yet established)
Remote:   /home/ubuntu/smallkhoj-deploy (current image archive + bundle parent)
          /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy (Compose bundle)
Secrets:  /Volumes/ORICO/smallkhoj-secrets/release-worker.env (external drive; never committed)
```

#### PUBLIC_API_KEY — 如何获取与使用

`PUBLIC_API_KEY` 是前端与后端共享的生产 API key：前端在 Docker 构建时通过 `--secret id=public_api_key, env=PUBLIC_API_KEY` 打进浏览器产物，后端是 `.env.prod` 中的运行时环境变量。它**不**提交进仓库，不在 `release-worker.env` 中，也不会被任何脚本自动读取。调用方必须在运行 `production_image_transfer.py` 之前导出它。

**当前值所在位置：** 云端服务器的 `/home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod` 内。通过 SSH 取回，不要把值打印到聊天/日志：

```bash
ssh -i /Users/lee/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'grep "^PUBLIC_API_KEY=" /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod' \
  > /tmp/.deploy-pubkey
export $(cat /tmp/.deploy-pubkey)
rm -f /tmp/.deploy-pubkey
```

**规则：**
- 绝不在生产环境使用开发默认值 `sk_public_local`。
- 绝不在聊天、命令输出或 URL 中打印该值。
- 前端镜像与服务器 `.env.prod` 中必须存在同一个值；不匹配会让每个认证请求返回 401。
- 只在首次部署或密钥轮换时生成新值；随后更新服务器 `.env.prod` 并同时重建前端与后端。

服务器上加载的运行时镜像标签：

```text
smallkhoj-backend:local-release
smallkhoj-frontend:local-release
smallkhoj-caddy:local-release
```

### 3. 契约

#### 阶段 0 — 本地验证

- `make ci` 是确定性的静态/构建矩阵。它不会启动运行时服务；CI 和本地发布脚本会在 `make e2e-authenticated` 之前启动隔离的候选环境。
- `make e2e-authenticated` 不会启动运行时，也不会绑定 Docker；其主体是 `verify-e2e-env; cd frontend && bun run e2e`。
- E2E 要求 `E2E_DATABASE_SCOPE=disposable`，且 `DATABASE_URL` 与 `BETTER_AUTH_DATABASE_URL` 都指向回环地址并带有明确的安全数据库名标记，并指向同一个数据库。缺少这一证明时，在浏览器启动之前即失败。
- UI 验收证据必须来自 `./twd`，带 `REAL_<task-slug>_<timestamp>` 标记并记录在 `.trellis/tasks/<task>/evidence/` 下。已提交的 Playwright 流程（`make e2e-authenticated`）是确定性的跨层 CI 覆盖，不是 UI 验收，不得替代可见的 `./twd` 证据。
- `dev.sh` 仅是 `local-dev` 便利工具，不得用作发布证据。见 `deployment-environment-contracts.md`。

#### 阶段 1 — 部署门禁

- 正式发布或容量声明要求在候选树上有一份被接受的 `formal-300-500-30-v1` 报告：300 稳态 SSE / 500 峰值 SSE / 30 活跃用户 / 1800s 活跃 / 60s 峰值 / 60s 清理。见 `deployment-environment-contracts.md` 中的 `formal-capacity` 场景。
- 短时 `smoke` 运行仅用于诊断；`acceptance.passed=true` 只保留给正式 profile。不做重算而信任一个可变的通过摘要，是会阻塞发布的校验 bug。
- 当操作者要做发布就绪或容量声明时适用此正式门禁。任务作用域的功能性部署可以改走 `production_image_transfer.py --task-scoped --task-id <task-id>`；其发布证据必须写明 `capacityClaim=not-asserted`，且不得作为正式容量或首次发布证据呈现。

#### 阶段 2 — Squash 合并

- `main` 是稳定主线。非平凡工作使用兄弟 worktree 加 `feat/*` 分支；在 worktree 中验证；通过 PR + squash 合并。
- 使用 `gh pr merge <PR> --squash --match-head-commit <candidate-SHA>`，不带 `--delete-branch`。去掉 `--delete-branch` 可避免分支删除失败中止一次已经成功的合并。
- 术语阶梯（严格区分）：candidate verified != merged != released != healthy。在对应阶段真正成功之前，不得声称 `complete`/`merged`/`released`/`deployed`/`cloud healthy`。

#### 阶段 3 — 树相等

- squash 合并后，要求 `origin/main^{tree} == candidate tree`。squash 必须保持候选树不变。镜像 revision 标签使用合并提交 SHA；在发布证据中保留"被测树 -> 合并 SHA"的映射。
- squash 后的树与正式测试过的候选树不一致时，阻塞镜像传输；重建/重测正确的候选。

#### 阶段 4 — 免镜像仓库的镜像传输

- 当前云端部署是免镜像仓库的：本地构建 -> `docker save` -> SSH/SCP 上传 -> 远端 `docker load` -> 远端 `docker compose`。没有容器 registry，没有 CI 镜像推送，没有 `git push` 即部署。
- 前置条件：`git status --porcelain` 完全为空，且提供的 `--source-revision` == 当前 `HEAD`。正式传输额外要求容量报告的候选树等于 `current HEAD^{tree}`；任务作用域传输要求存在匹配的 Trellis 任务，且不做容量声明。
- 构建上下文必须是干净的 Git 候选。暂存/未暂存/未跟踪文件都是发布阻塞项。`org.opencontainers.image.revision` 标签必须等于所检出的 `HEAD`。
- 前端生产构建通过 BuildKit secret（`--secret id=public_api_key,env=PUBLIC_API_KEY`）注入 `PUBLIC_API_KEY`，绝不通过构建参数。BuildKit 刻意不把 secret 内容纳入缓存键，因此同源/不同 key 的重建可能显示 `CACHED`；部署前请将生产公钥的 SHA-256 与运行中后端的 key 做哈希比对。
- 每次真实传输（包括 `--skip-build`）都要求恰好一个显式部署门禁：正式发布用被接受的 `--capacity-report`，功能性任务部署用 `--task-scoped --task-id <task-id>`。失效（stale）/失败/伪造的正式报告、缺失的任务或候选树不匹配都是阻塞项。
- `--skip-daemon-build` 是单机 Windows 载体路径：它复用预构建且经校验和验证的 daemon 产物目录，同时仍构建 backend/frontend/Caddy 镜像。它不得与 `--skip-build` 组合使用。
- 成功后，原子化持久化带 schema 版本的 JSON 发布证据（`<output-archive>.release-evidence.json`）：绑定被测候选的 HEAD/树、合并 HEAD/树、部署作用域（适用时还有正式 profile + 报告路径/哈希）、镜像 tag/ID/revision/平台，以及归档路径/哈希。不含任何 secret 值。

### 场景：Docker save 归档格式兼容性

#### 1. 作用域 / 触发条件

本节适用于所有会校验 `docker save` 所生成归档的免镜像仓库镜像传输，包括 Apple Silicon/Colima 构建机和远端 `docker load` 目标。

#### 2. 签名

- 输入：`/tmp/smallkhoj-production-images.tar`（或配置的 `--output-archive`），含 Docker `manifest.json` 条目。
- 校验器：`validate_saved_image_archive(archive_path, expected_identities)`。

#### 3. 契约

- 校验器必须把每个候选 tag 绑定到确切的已检查镜像 ID。
- 它必须同时接受 Docker 旧式配置形式 `<digest>.json` 与 OCI/containerd 形式 `blobs/sha256/<digest>`。
- OCI 配置路径必须匹配 `^blobs/sha256/[0-9a-f]{64}$`；畸形或无关路径失败关闭（fail-closed）。
- 归档身份校验发生在 SCP/上传与发布证据持久化之前。

#### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 旧式 `<digest>.json` 配置与已检查 ID 匹配 | 接受 |
| OCI `blobs/sha256/<digest>` 配置与已检查 ID 匹配 | 接受 |
| 配置路径畸形、重复或指向意外的 ID | 以归档身份错误失败 |

#### 5. 好/基准/坏案例

- 好：校验当前 Docker/Colima 运行时生成的归档，然后原样上传。
- 基准：为较旧的 Docker 引擎保留旧格式覆盖。
- 坏：假设每个 `Config` 成员都以 `.json` 结尾；这会在传输前拒绝合法的 OCI 归档。

#### 6. 必需测试

- `scripts/tests/test_production_image_transfer.py` 必须覆盖旧式与 OCI 配置路径、精确的 tag/ID 绑定以及畸形 OCI 拒绝。
- 真实传输必须在任何 SCP 副作用之前通过归档校验器。

#### 7. 错误 vs 正确

错误：因为缺少 `.json` 而拒绝 `Config: "blobs/sha256/<digest>"`。

正确：把两种受支持的配置表示都归一化为 `sha256:<digest>`，再与已检查的镜像身份比较。

#### 阶段 5 — 仅应用部署

- 唯一的部署命令是 `docker compose ... up -d --force-recreate --no-deps --no-build --pull never backend frontend caddy`。
- 绝不把 `db` 包含进部署命令。先前的辅助脚本（`lighthouse --compose-up --use-loaded-images`）已被否决，因为它会执行 `docker compose pull db` / `docker compose up db`；不要重新引入。
- 远端 bundle 命名：`__REMOTE_ROOT__` 下的 `smallkhoj-deploy-__B_SHORT__`，其中 `__B_SHORT__` 为 `git rev-parse --short=12 HEAD`。

#### 阶段 6 — 部署后冒烟与健康（可选）

**冒烟与健康窗口不是默认部署流程的一部分。** 仅在用户明确要求部署后冒烟测试或健康检查时运行。不要自动运行，也不要默认它们是必需的。

当用户确实要求时：
- 健康端点是 `/api/health`，不是 `/health`。`deploy/caddy/Caddyfile` 把 `/api` 与 `/api/*` 路由到后端；`/health` 路由到前端，不是有效的后端健康证据。`scripts/post_deploy_smoke.py` 探测 `/api/health`。
- 阶段 7 健康窗口（如被要求）：10 分钟窗口每 60 秒采样一次（十个样本，no-clobber），连接预算配比 `48 / 100`，对应 PostgreSQL `max_connections=100`。

#### 回滚（schema 感知，失败关闭）

- 部署在前后各记录一次 Alembic revision。
- revision 未变 -> `IMAGE_ROLLBACK_ALLOWED=schema-unchanged`：允许机械地把镜像回滚到先前 tag。
- revision 已变或未知 -> `IMAGE_ROLLBACK_FORBIDDEN=schema-changed-or-unknown`：停止 caddy/frontend/backend，保持 `db` 运行，保护数据库与日志，并请求维护者决策。绝不启动旧应用镜像，绝不自动恢复/删除/覆盖生产数据库。
- 部署前，创建外部回滚锚点（OLD/NEW bundle 之外的目录，权限 `0700`，no-clobber）：`.env.prod.old`（0600）、`docker-compose.prod.yml.old`（0600）、三个 `smallkhoj-<service>:rollback-pre-__B_SHORT__-__UTC__` tag、先前应用镜像的 `docker save` 归档、部署前 Alembic revision、数据库转储以及 SHA-256 台账。同名 tag 必须停止部署；禁止覆盖。
- **部分服务回滚必须保持跨服务凭证一致。** `NEXT_PUBLIC_API_KEY` 在构建时编译进前端浏览器产物（见 `deployment-environment-contracts.md`），而后端 `PUBLIC_API_KEY` 是运行时环境变量。在后端 `.env.prod` 已切换到新 key 的情况下，仅把前端镜像回滚到打包了旧 key 的构建，会让每个认证请求返回 401 `Invalid API key`，并卡住 server-component 路由切换（`requireCurrentAccount` 重试/重定向）。只有当回滚镜像内打包的 key 等于当前后端 `PUBLIC_API_KEY` 时，部分回滚才安全；否则必须把后端环境与前端镜像一起回滚到同一 key 世代。在 `compose up` 之前验证 key 匹配，而不是等用户报告卡住。

#### daemon 分发（并行轨道）

- daemon 源码：`agent/daemon/aaa-daemon/`；其 `package.json.version` 是唯一手动维护的当前候选版本。GitHub Actions 在 checkout 后读取该字段，并为已认证候选流程导出到 `DAEMON_RELEASE_VERSION` 与 `E2E_DAEMON_VERSION` 两个变量。工作流不得把当前语义版本硬拷贝进任一变量。
- 后端 `MINIMUM_DAEMON_VERSION` 是独立的兼容性策略；更低的 daemon 版本会得到 `426`。它不得仅为宣传更新的候选而从当前包版本推导，生产 Compose 必须从 `.env.prod` 显式接收它。
- 生产 `DAEMON_RELEASE_VERSION` 始终是对已发布产物的显式选择。在包等待发布期间它可以暂时不同于源码候选，但在 onboarding 发布之前，它必须等于实际打包并托管的 tgz 中的版本。
- `scripts/build_daemon_distribution.py` 产出 `smallkhoj-daemon-v<version>-<platform>.tar.gz` + `.sha256` + `.manifest.json` + `install.sh`；`--source-revision` 必须是 40 位 SHA == 当前 HEAD。
- 产物上传到 `/downloads/smallkhoj-daemon/`；客户端通过 `curl ... | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=<base> bash` 安装到 `~/.smallkhoj/daemon/versions/v<ver>-<plat>/`。
- daemon 回滚：重新发布/保留上一个产物目录，重跑其 `install.sh`，重启 daemon。在发布被接受之前，至少保留上一个已知良好产物与校验和。
- 打包的 daemon tgz 必须暴露 `aura` bin；`smallkhoj-daemon` 是兼容别名。见 `deployment-environment-contracts.md` 中的 "Compatible Daemon Package Rollout" 场景。

#### 仅 daemon 载体刷新

- 仅涉及 daemon 载荷（payload）的变更仍然需要新的后端载体镜像，因为后端镜像托管 `release-artifacts/smallkhoj-daemon/`。
- 对已存在的生产数据库，仅用 `--force-recreate --no-deps --no-build --pull never` 加载/重建 `backend`；保持 `frontend`、`caddy` 与 `db` 运行。
- 冒烟命令必须通过 `--daemon-package-version`、`DAEMON_RELEASE_VERSION` 或一个明确的本地生成产物获得实际已发布的包版本。没有硬编码的兜底版本。
- 后端本地配置遵循同一边界：源 `package.json.version` 仅为候选，除非对应的生成 npm tarball 存在，否则不对外宣传。生产 Compose 仍从 `.env.prod` 显式配置。
- 记录新旧包 SHA-256、源 revision、载体镜像 revision、Alembic 前后值、健康、包 GET 与 WebSocket 认证拒绝。同版本替换是一个例外，需要回滚副本和 npm/npx 缓存说明；仅版本相等不等于产物身份。

#### `rtk` 不是项目构建工具

- `rtk`（Rust Token Killer，`rtk-ai/rtk`）是用户全局的第三方令牌（token）优化 CLI 代理，用于压缩喂给 LLM 的终端输出。"给 shell 命令加 `rtk` 前缀"的约定是记录在 `~/.codex/RTK.md` 中的开发者便利做法；Makefile、CI 或任何发布脚本都不引用它。
- CI/Makefile/scripts 使用原始工具（`uv run`、`bun run`、`docker`、`make`）。不要把 `rtk` 注入被记录为发布证据的命令。
- 陷阱：`rtk test <args>` 总是返回 0（即使 `rtk test false`）；它运行的是测试套件命令，不是 shell 的 `test`/`[` 内建，不得用于文件/值断言。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 仅做过 localhost 检查就被问"是否已部署/发布" | 证据无效；针对 `local-prod` 或 `cloud-prod` 重跑。localhost 检查永远不能证明云端生产可用。 |
| `make ci` 通过但没有正式容量报告 | 尚不具备正式发布/容量声明条件；功能性任务作用域部署只有在带 `--task-scoped --task-id <task-id>` 时才可继续，且必须保留 `capacityClaim=not-asserted`。 |
| 把短时 `smoke` 运行标记为正式容量 | 拒绝；`acceptance.passed=true` 只保留给正式 profile。 |
| squash 合并成功但 `origin/main^{tree} != candidate tree` | 阻塞镜像传输；重建/重测正确的候选。 |
| `gh pr merge` 带 `--delete-branch` 使用 | 风险：分支删除失败会中止一次成功的合并；去掉该标志。 |
| 在 Apple Silicon 上构建镜像但未加 `--platform linux/amd64` | 对 x86_64 Lighthouse 主机是无效部署产物；加 `--platform` 重建。 |
| `production_image_transfer.py` 在脏树或 SHA != HEAD 下运行 | 发布阻塞项；清理工作树并提供精确的 HEAD SHA。 |
| `docker compose up -d` 包含 `db` | 违反契约；仅部署应用（`backend frontend caddy`），绝不含 `db`。 |
| 健康探测打到 `/health` 并返回前端 | 端点错误；后端健康是 `/api/health`（Caddy 把 `/health` 路由到前端）。 |
| 部署后与部署前 Alembic revision 不同，随后尝试回滚 | `IMAGE_ROLLBACK_FORBIDDEN`；保持数据库运行，保护数据，请求维护者决策。 |
| 同名回滚 tag 已存在 | 停止部署；绝不覆盖已存在的回滚锚点。 |
| 托管的 daemon tgz 版本 != `DAEMON_RELEASE_VERSION` | daemon onboarding 阻塞项；重新生成/上传匹配产物。 |
| 用 `rtk test` 断言文件/值条件 | 断言无效；`rtk test` 总是返回 0。改用 shell `test`/`[` 或原始工具。 |
| 在阶段成功之前声称 `complete`/`released`/`cloud healthy` | 违反术语阶梯；使用严格阶梯 candidate != merged != released != healthy。 |

### 5. 好/基准/坏案例

- 好：干净候选 -> `make ci` 通过 -> `formal-300-500-30-v1` 通过 -> 保持树的 squash 合并 -> 带容量报告的传输 -> 仅应用部署；记录回滚锚点。（冒烟/健康仅在明确要求时。）
- 好：把大型 Docker 归档存放在 `/Volumes/ORICO/...` 用于发布。
- 基准：一次带标签的 `smoke` 运行验证 Docker/查询/报告接线，同时 `acceptance.passed=false`；正式容量仍未完成。
- 坏：打开了 `localhost:3000/login`，于是"发布部署已就绪"。
- 坏：`docker compose up -d db backend frontend caddy`（部署命令含 db）。
- 坏：探测 `/health`，看到 200，就宣称后端健康。
- 坏：在发生 schema 变更的迁移之后，未经维护者决策就回滚镜像。
- 坏：把带 `rtk` 前缀的发布命令写成文档，好像它是必需的项目工具。

### 6. 必需测试

对任何触及流水线的变更：

- 本地门禁：`make ci`（聚合）或按栈的 `make backend-ci` / `make frontend-ci` 链。
- Compose 语法：`make compose-check`（`docker compose -f docker-compose.prod.yml config --no-interpolate --quiet`）。
- 工作流契约测试：`make scripts-test`（`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`），包括 `test_delivery_contract.py`、`test_production_image_transfer.py`、`test_validate_delivery_env.py`、`test_build_daemon_distribution.py`。
- UI 相关变更：带 `REAL_` 标记的可见 `./twd` 证据；已提交的 Playwright 流程是跨层 CI，不是 UI 验收。
- 发布级：`python3 scripts/initial_release_foundation_gate.py --base-url <url> --daemon-package-version <published-package-version> --allow-http --json`。
- 部署后（可选——仅在用户明确要求时）：`python3 scripts/post_deploy_smoke.py --base-url <url> --daemon-package-version <published-package-version> --allow-http --json`，外加 `/api/health`、`/docs`、`/login` 与 daemon WS。
- 镜像传输变更：先用 `--capacity-report` 干跑；真实传输后，校验 `<output-archive>.release-evidence.json` 哈希、镜像身份以及"被测树 -> 合并 SHA"映射。

### 7. 错误 vs 正确

#### 错误

```text
make ci passed and I opened localhost:3000/login, so the cloud release is ready.
```

#### 正确

```text
make ci is the local static/build gate only. Release still needs formal capacity
on the candidate tree, squash merge with tree equality, registry-free image
transfer with capacity report, and app-only deploy against
http://124.222.40.40. (Smoke/health checks only if explicitly requested.)
```

#### 错误

```text
docker compose up -d db backend frontend caddy   # bring everything up
```

#### 正确

```text
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
  --force-recreate --no-deps --no-build --pull never backend frontend caddy
# db is never in the deploy command
```

#### 错误

```text
curl http://124.222.40.40/health   # 200, backend is healthy
```

#### 正确

```text
curl http://124.222.40.40/api/health   # backend health route
# /health is routed to frontend by Caddy and is not backend-health evidence
```

#### 错误

```text
The deploy failed, so I rolled back the frontend image to the previous tag.
```

#### 正确

```text
The deploy failed. I compared pre/post Alembic revisions. They differ, so
IMAGE_ROLLBACK_FORBIDDEN: I stopped app services, kept db running, preserved
the DB and logs, and asked the maintainer for a decision.
```
