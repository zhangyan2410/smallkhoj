---
name: aura-zcode-frontend-sop
description: SmallKhoj 前端开发测试 + 云端部署 SOP。在 SmallKhoj 项目里做前端改动、测试、调试、浏览器验证、部署到云端时自动触发。覆盖 kimi-webbridge 真实浏览器测试、dev server 管理、代码变更验证、回归排查、Tencent Lighthouse 云端部署的完整流程。当用户让你改前端、测试、复现 bug、部署、上传云端、同步云端，或提到 localhost:3000/聊天页面/agent/124.222.40.40 时加载。
---

# SmallKhoj 前端开发测试 SOP

基于实际踩坑总结的硬性规则。每条都来自真实教训，违反会导致大量返工。

## 1. 浏览器测试：用 kimi-webbridge，不用 iab/Playwright

**永远用 kimi-webbridge 连用户的真实浏览器（夸克浏览器）测试。** 不要用 ZCode 内置浏览器（iab）或 Playwright——它们和用户真实环境不同（视口、cookie、HMR 状态），测了也白测。

### 连接方式

```bash
# 确认 daemon 在线
curl -s -m 5 -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"list_tabs","args":{},"session":"smallkhoj-dev"}'
```

如果连接失败，启动 daemon：
```bash
~/.kimi-webbridge/bin/kimi-webbridge start
```

### 关键：复用同一个 session，不要开新分组

**永远用 `smallkhoj-dev` 这个 session 名。** 不要每次测试开新 session（smallkhoj-test1/test2/debug...），会在用户浏览器里创建大量 tab 分组，非常烦。

如果 session 的 tab 关了，用 `navigate` 重新建：
```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/wb-req.json
```

JSON body 写到临时文件再 POST（避免 shell 转义问题，尤其含中文/引号时）：
```bash
# 用 Write 工具写 JSON 到 /tmp/wb-req.json，然后：
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/wb-req.json
# 用完删掉
rm -f /tmp/wb-req.json
```

### 常用操作

| 操作 | action | 说明 |
|------|--------|------|
| 打开/导航页面 | `navigate` | `newTab:true` 第一次开，之后复用 |
| 读页面内容 | `snapshot` | 返回无障碍树（文本结构） |
| 执行 JS | `evaluate` | 只读测量用，不要用来触发交互 |
| 点击元素 | `click` | 用 CSS selector 或 @e ref |
| 填表单 | `fill` | 用 CSS selector 或 @e ref |
| 截图 | `screenshot` | 返回文件路径，用 Read 工具看 |

### hover 测试：用 focus，不要用 evaluate dispatchEvent

React 的 `onMouseEnter` 不响应 `element.dispatchEvent(new MouseEvent(...))`。要触发 hover 卡片：
```js
// 用 focus 触发（onFocus 也会打开 hover 卡）
document.querySelector('button[aria-label]').focus()
```

### evaluate 的限制

- `evaluate` 里不能做 `fetch`（跨域/认证问题，不代表页面真实行为）
- `evaluate` 里不能 mutate DOM/navigate（会被拒）
- 测 API 响应要用页面自己的 fetch 上下文，不要在 evaluate 里独立 fetch

## 2. 改完代码必须自己测试

**typecheck 通过 ≠ 功能正常。** 每次代码改动后：

1. `npx tsc --noEmit -p tsconfig.json` — 确认无类型错误
2. 去 kimi-webbridge 浏览器实测 — 确认功能正常
3. 如果改了后端：`python3 -m py_compile <file>` + `./dev.sh restart` + 等 3 秒再测

**不要只改完代码就告诉用户"完成了"。** 必须自己验证后报告结果。

## 3. dev server 管理

### HMR 坏了会误导排查

长时间运行的 dev server（多次热更新后）会产生坏缓存，导致：
- 页面卡在 loading 状态
- CSS 布局异常
- 功能不工作但代码是对的

**遇到诡异的"不工作"，先 `./dev.sh restart` 再测。** 大量 HMR 累积后这是第一步。

### 重启命令

```bash
./dev.sh restart   # 重启前后端
./dev.sh stop      # 停止
./dev.sh start     # 启动（复用已有进程）
```

重启后等 3-5 秒让服务就绪再测试。

### 后端端口

- 前端：localhost:3000（Next.js 16 + Turbopack）
- 后端：localhost:8000（FastAPI + uvicorn）
- dev.sh 同时管前后端

## 4. 排查 bug 的正确顺序

### 第一步：看代码和 git 历史，不要猜

```bash
# 查文件最近改动
git log -3 --format="%h %ad %s" --date=short -- <file>

# 查某个 commit 改了什么
git show <hash> -- <file>

# 对比重构前后
git show HEAD:"frontend/<file>" | grep "<pattern>"
```

**先确认是代码问题还是环境问题**，再动手改。不要凭猜测改代码。

### 第二步：在真实浏览器复现

用 kimi-webbridge 在用户的浏览器里复现。不要用 curl/iab——curl 拿不到登录态的页面，iab 不是用户的环境。

### 第三步：测量，不要推断

用 `evaluate` 读取实际 DOM 状态：
```js
// 测量元素尺寸/可见性（不触发副作用）
const el = document.querySelector('[data-region=xxx]')
const r = el.getBoundingClientRect()
const style = getComputedStyle(el)
return JSON.stringify({ w: r.width, h: r.height, display: style.display, pointerEvents: style.pointerEvents })
```

如果元素尺寸是 0×0 或 `display:none`，说明它没渲染——查渲染路径，不要查 CSS 内容。

## 5. 代码改动注意事项

### 改前端代码后

- import 了新组件？确认 import 路径对（`@/components/...`、`@/lib/...`）
- 改了 server component 里的内联函数？确认没有遗漏的引用
- 改了共享组件？确认所有使用点都兼容

### 改后端代码后

- `python3 -m py_compile <file>` 先查语法
- `./dev.sh restart` 让改动生效（后端无热重载）
- 改了 API 返回结构？确认前端类型定义也更新了

### 重构时

- 先读完所有相关代码，再动手
- 用 `git diff HEAD` 确认改动范围
- 重构后必须测原有功能不回归（尤其是重构涉及的每个路径）

## 6. 整页加载 vs SPA 导航

SmallKhoj 前端的 `window.location.href`（整页加载）和 `router.push`（SPA 软导航）行为不同：

- 整页加载：走完整 SSR + CSS 注入流程，可能遇到首帧渲染时序问题
- SPA 导航：复用已加载的 CSS/JS，更快但不触发 SSR

**创建 agent/channel 后用 `window.location.href` 跳转是产品设计**（为了让新数据出现在 SSR 的 sidebar 里），不要改成 `router.push`。

## 7. 已知的架构约束

- **SSE 是单条共享连接**（`RealtimeProvider`），`useRealtimeSubscription` 只注册回调不建新连接
- **ChatDataProvider 是 SSR 快照**，client 端要用 `router.refresh()` 刷新，不要自己 fetch（不带 token 会 401）
- **loading.tsx 在根路由组**，会绕过 `(app)/layout.tsx` 的外壳——取数慢时显示居中骨架屏
- **响应式布局依赖 `sm:` 媒体查询**（min-width: 40rem = 640px），给 html/body/main 加 `w-full` 确保首帧宽度正确

## 8. 部署到云端（Tencent Lighthouse）

当用户说"部署"、"上传云端"、"同步云端"、"上线"时，走以下流程。

### 前置检查

```bash
# 1. worktree 干净
git status --short

# 2. 已推到 origin/main
git rev-parse HEAD && git rev-parse origin/main  # 两个必须一致

# 3. SSH key 存在
ls /Users/lee/.ssh/tengxun-ssh-key.pem

# 4. ORICO 外置盘挂载（用于存镜像 archive）
ls /Volumes/ORICO/  # 如果没挂载，提醒用户插上
```

### 获取 PUBLIC_API_KEY

`PUBLIC_API_KEY` 不在仓库、不在 release-worker.env。从云端 `.env.prod` 读取（不打印到聊天）：

```bash
ssh -i /Users/lee/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'grep "^PUBLIC_API_KEY=" /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod' \
  > /tmp/.deploy-pubkey
export $(cat /tmp/.deploy-pubkey)
rm -f /tmp/.deploy-pubkey
```

**绝不能**：打印密钥值、用 dev 默认值 `sk_public_local`、把密钥贴到聊天/URL。

### 镜像构建 + 传输（--authorized 模式）

用户授权后用 `--authorized`（不需要容量报告、不需要 Trellis task）：

```bash
cd /Users/code/project/smallkhoj
export $(cat /tmp/.deploy-pubkey)
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 \
  --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 \
  --authorized \
  --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar \
  --use-vpn-proxy
```

**常见报错**：
- `ConnectionClosed downloading tarball` → bun install 偶发断线，直接重跑
- `failed to connect to the docker API ... colima ... daemon is running` → colima 没起。用代理环境启动（VM 内 host 网关是 192.168.5.2）：`colima start --env HTTP_PROXY=http://192.168.5.2:7897 --env HTTPS_PROXY=http://192.168.5.2:7897 --env NO_PROXY=localhost,127.0.0.1`
- 基础镜像元数据超时（`auth.docker.io ... i/o timeout`）→ buildkit 解析元数据不走 `--use-vpn-proxy` 的 build-args，但 `docker pull` 走 daemon 代理。先手动预拉全部基础镜像再重跑：`docker pull --platform linux/amd64 python:3.12-slim oven/bun:1.3.14 caddy:2`
- Turbopack 构建期 `Error while requesting resource ... fonts.gstatic.com` → next/font 下载 Google 字体偶发被墙，直接重跑一次（0.2.7 发布时第二次即过）
- `daemon artifact source revision does not match` → 已修复，`--skip-daemon-build` 才校验已有 artifact
- `daemon release artifacts are missing required platforms` → 产物目录缺平台 manifest，是防"单平台发布"的 fail-closed 闸口。走全量 daemon 构建（需要 `aura-build-runtime/` 里有 node.exe + aura.exe），或用 `--skip-daemon-build` 复用已含双平台的预构建产物
- `Trellis task metadata not found` → 用 `--authorized` 而非 `--task-scoped`

**daemon 版本变更时的额外步骤**（daemon `package.json` 版本号变了才需要）：

```bash
# 1. 提交版本 bump 后，本地构建双平台产物（darwin 用 --clean-output-dir，win32 复用 npm 包）
HEAD_SHA=$(git rev-parse HEAD)
python3 scripts/build_daemon_distribution.py --root . --output-dir release-artifacts/smallkhoj-daemon \
  --platform darwin-arm64 --source-revision $HEAD_SHA --minimum-daemon-version 0.2.6 --clean-output-dir --json
python3 scripts/build_daemon_distribution.py --root . --output-dir release-artifacts/smallkhoj-daemon \
  --platform win32-x64 --windows-runtime-dir aura-build-runtime --reuse-npm-package \
  --source-revision $HEAD_SHA --minimum-daemon-version 0.2.6 --json

# 2. 传输时加 --skip-daemon-build 复用上面构建好的产物
# 3. Phase 5 之前，云端 .env.prod 同步 DAEMON_RELEASE_VERSION=<新版本>（MINIMUM_DAEMON_VERSION 是兼容下限，一般不动）
```

### Phase 5: app-only deploy

**永远不包含 `db`**。

**关键：先确认 `.env.prod` 的 image tag 指向 `local-release`。** 如果指向旧 commit tag（如 `5cadf11`），compose 会用旧镜像而非新上传的 `local-release`，导致部署"看起来成功"但代码没更新：

```bash
# 检查+修复 image tag（先备份再改）
ssh -i ~/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'cd /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy && \
   cp .env.prod .env.prod.bak.$(date +%s) && \
   sed -i "s|SMALLKHOJ_BACKEND_IMAGE=.*|SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release|" .env.prod && \
   sed -i "s|SMALLKHOJ_FRONTEND_IMAGE=.*|SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release|" .env.prod && \
   sed -i "s|SMALLKHOJ_CADDY_IMAGE=.*|SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release|" .env.prod'

# 确认 tag 正确
ssh -i ~/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'grep IMAGE /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod'
```

然后 deploy：

```bash
ssh -i /Users/lee/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'cd /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy && \
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
   --force-recreate --no-deps --no-build --pull never backend frontend caddy'
```

### 确认部署成功

```bash
# 容器状态
ssh -i /Users/lee/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'docker compose --env-file /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod \
   -f /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/docker-compose.prod.yml ps \
   --format "{{.Name}} {{.Status}}"'

# 健康检查（endpoint 是 /api/health，不是 /health）
curl -s -m 10 -o /dev/null -w "HTTP %{http_code}\n" http://124.222.40.40/api/health
```

### Smoke 测试

**默认不做。** 只在用户主动要求时才跑 `post_deploy_smoke.py`。

### 部署目标信息

```
Host:     124.222.40.40 (Tencent Lighthouse lhins-6gznhrts, ap-shanghai)
User:     ubuntu
Base URL: http://124.222.40.40
Key:      /Users/lee/.ssh/tengxun-ssh-key.pem
Remote:   /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy
Secrets:  云端 .env.prod（含 PUBLIC_API_KEY 等）
Images:   smallkhoj-{backend,frontend,caddy}:local-release
```

### 完整部署命令（复制即用）

```bash
# 1. 获取密钥
ssh -i ~/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'grep "^PUBLIC_API_KEY=" /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod' > /tmp/.deploy-pubkey
export $(cat /tmp/.deploy-pubkey) && rm -f /tmp/.deploy-pubkey

# 2. 构建+传输
cd /Users/code/project/smallkhoj
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file ~/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 --authorized \
  --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar \
  --use-vpn-proxy

# 3. 修复 .env.prod image tag 指向 local-release（关键！不做这步会部署旧镜像）
ssh -i ~/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'cd /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy && \
   cp .env.prod .env.prod.bak.$(date +%s) && \
   sed -i "s|SMALLKHOJ_BACKEND_IMAGE=.*|SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release|" .env.prod && \
   sed -i "s|SMALLKHOJ_FRONTEND_IMAGE=.*|SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release|" .env.prod && \
   sed -i "s|SMALLKHOJ_CADDY_IMAGE=.*|SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release|" .env.prod'

# 4. 部署
ssh -i ~/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'cd /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy && \
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
   --force-recreate --no-deps --no-build --pull never backend frontend caddy'

# 5. 确认（必须看到 local-release tag，不是旧 commit tag）
ssh -i ~/.ssh/tengxun-ssh-key.pem ubuntu@124.222.40.40 \
  'docker compose --env-file /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/.env.prod \
   -f /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/docker-compose.prod.yml ps \
   --format "{{.Name}} {{.Image}} {{.Status}}"'
curl -s -o /dev/null -w "%{http_code}" http://124.222.40.40/api/health
```

