# 容量实测执行计划（300/500/30）

## 目标

用 `scripts/local_capacity_probe.py` 的 formal-300-500-30-v1 profile 跑出**正式容量 acceptance 报告**，证明 SmallKhoj（`cd43fbe`）在目标环境规格（4 vCPU / 3.32 GiB / PG max_connections=100）下支持 300 稳定 SSE / 500 峰值 SSE / 30 活跃用户。

## 前置事实（已核实）

probe 是反作弊的严肃验证工具，formal acceptance 有 ~50 个失败码条件。硬性约束：
- 容器镜像 `org.opencontainers.image.revision` label 必须 == candidate head `cd43fbe`
- candidate git 状态必须 clean（dirty=False），跑测期间不能变
- backend/frontend 容器内 env 被 `docker exec` 读出，必须精确匹配 FORMAL 连接预算（pool_size=5/max_overflow=10/notify_publisher=2/better_auth=10/workers=1/max_conn=100/headroom=5）
- compose project name 用于容器发现，必须唯一且干净
- 数据库名必须含 disposable token（audit/ci/test 等）

## 执行步骤

### 第 1 步：清理旧 dirty 栈
停掉并删除上一个 agent 遗留的 `smallkhoj-audit-capacity-final-*` 容器栈（镜像 revision 是 `ac80a6a`，不匹配 HEAD，占着 project name 和内存）。
```bash
docker compose -p smallkhoj-audit-capacity-final -f docker-compose.prod.yml down -v --remove-orphans
# 残留 forward 容器单独删
docker rm -f smallkhoj-audit-capacity-db-forward smallkhoj-audit-capacity-api-forward 2>/dev/null
```
**不动** 55432（ssh 隧道）、55436。

### 第 2 步：构建 cd43fbe 的三个生产镜像
用当前 HEAD 构建，注入 revision label（probe 会校验 == cd43fbe）。
```bash
REV=$(git rev-parse HEAD)   # cd43fbe...

# backend / caddy：直接 --label
docker build --label org.opencontainers.image.revision=$REV \
  -t smallkhoj-backend:audit-cd43fbe -f backend/Dockerfile .

docker build --label org.opencontainers.image.revision=$REV \
  -t smallkhoj-caddy:audit-cd43fbe -f deploy/caddy/Dockerfile deploy/caddy

# frontend：需要 BuildKit secret（PUBLIC_API_KEY），prod 构建强制要求
docker build --label org.opencontainers.image.revision=$REV \
  --secret id=public_api_key,env=PUBLIC_API_KEY \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_ENV=production \
  -t smallkhoj-frontend:audit-cd43fbe -f frontend/Dockerfile frontend
```
用合成的一次性密钥（不是生产密钥），仅供本地容量测试，不落库。

### 第 3 步：准备一次性 prod env 文件
写到 `/tmp/smallkhoj-capacity.env`（mode 0600），含合成密钥 + 容量测试参数。关键变量：
- `POSTGRES_PASSWORD` / `PUBLIC_API_KEY` / `AUTH_BRIDGE_SECRET` / `BETTER_AUTH_SECRET`（合成值）
- `SMALLKHOJ_*_IMAGE=smallkhoj-*:audit-cd43fbe`
- `SMALLKHOJ_HTTP_PORT=38190`（避开 55432/55436，选空闲端口）
- 容量参数全部用 FORMAL 默认值（pool=5/overflow=10/notify=2/better_auth=10/workers=1/max_conn=100/headroom=5）

### 第 4 步：起完整 compose 栈
用唯一 project name，disposable 数据库。
```bash
docker compose -p smallkhoj-capacity-cd43fbe \
  --env-file /tmp/smallkhoj-capacity.env \
  -f docker-compose.prod.yml up -d db backend frontend caddy
```
验证：backend migration 自动跑完、health 通过、4 容器都 running。

### 第 5 步：先跑 smoke（流程验证）
用 smoke profile 跑一个短时诊断（绕过 300/500/30 硬阈值），验证：栈可达、probe 能连 DB、fixture（better-auth bridge）能建立、SSE 能订阅、读写负载能跑。
```bash
uv run --project backend --no-sync python3 scripts/local_capacity_probe.py \
  --profile smoke --steady-sse 10 --spike-total-sse 15 --active-users 3 \
  --duration-seconds 60 --output /tmp/capacity-smoke.json
```
smoke acceptance 必然含 `NON_FORMAL_CAPACITY_PROFILE`，重点是**确认没有链路错误**（fixture setup error、SSE 连接失败、DB 连接失败）。

### 第 6 步：跑 formal 容量测试（~30 分钟）
smoke 链路确认后，跑正式 profile。通过 socat forward 让 probe 连到容器内 PG（probe 要求 loopback + disposable db）。
```bash
uv run --project backend --no-sync python3 scripts/local_capacity_probe.py \
  --profile formal-300-500-30-v1 \
  --output /Users/lee/.local/state/smallkhoj/release-evidence/capacity-formal-cd43fbe.json
```
含：60s ramp → 1800s steady（30 active users 读写）→ 590s 时 spike ramp 到 500 SSE → hold 60s → cleanup 60s+。

### 第 7 步：校验 acceptance + 出报告
读 report 的 `acceptance.passed`。如果 passed=true → 正式容量结论达成。如果 failed → 逐条看 `acceptance.failures`，只修与容量直接相关的 P0/P1（如连接泄漏、OOM、p95 超标），不扩成新审计。修后重跑 formal。

报告写入 repo-external 证据目录：
```
/Users/lee/.local/state/smallkhoj/release-evidence/capacity-formal-cd43fbe.json
```

## 端口规划
- 55432/55436：**不动**（ssh 隧道）
- 55440：PG 冒烟用过的，已释放
- 38190：容量栈 caddy HTTP（空闲）
- DB forward：用 55444（空闲）或 compose 内部网络直连

## 约束遵守
- 不 SSH/SCP、不访问旧云、不枚举浏览器 tab
- 不动主工作区 `/Users/code/project/smallkhoj` 的 WIP
- 合成密钥仅供本地容量测试，不写进 git、不落库
- 容量报告写 repo-external 证据目录，不进 commit
- 一次性 PG/容器跑完即销毁

## 风险与应对
- **frontend 构建失败**（BuildKit secret / Next.js build）：退回先验证 smoke 能否用现有旧镜像跑通链路，确认是镜像问题还是栈问题
- **连接预算超标**（probe 检测 PG 连接逼近 100）：这正是要测的——如果是真泄漏，修代码后重跑
- **本机内存紧张**（3.32 GiB 跑完整栈 + 500 SSE）：如果 OOM，记录峰值，这是真实容量边界数据
- **smoke 就连不上**：先排查 better-auth bridge endpoint 和 DB 连通性，不贸然跑 formal

## 不做的事
- 不为容量测试削弱任何 FORMAL 参数（probe 会拒绝）
- 不把容量报告 commit 进仓库
- 不在容量测试期间改 compose/代码（会触发 CANDIDATE_CHANGED_DURING_RUN）
- 容量结论达成前不对用户承诺"几百人并发已验证"