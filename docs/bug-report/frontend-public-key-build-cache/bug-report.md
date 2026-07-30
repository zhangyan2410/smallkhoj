# Frontend image can retain a stale public API key from BuildKit cache

## Bug 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| **1. 现象** | local-prod 真实注册返回 `Invalid API key`，即使 Compose 中 backend/frontend runtime 使用同一 `PUBLIC_API_KEY`。期望每次 production frontend image 都编译当前 deployment 的 public client key。 |
| **2. 证据** | 当前 frontend Docker build 通过 BuildKit secret 在 `bun run build` 时注入 `NEXT_PUBLIC_API_KEY`；同源码再次构建时该 RUN 层显示 `CACHED`，新镜像 ID 与旧镜像相同。真实浏览器注册失败，backend 返回 public-key rejection。 |
| **3. 问题假设或根因** | 根因已确认：BuildKit 有意不把 secret 内容计入 cache key。public key 虽通过 secret 安全传输，却会被 Next 编译到静态 bundle；调用方没有禁用该层缓存，因此换 deployment key 时可能复用旧 bundle。 |
| **4. 诊断策略** | 反向追踪真实注册请求到 backend key verifier；对照 compose env、image ID 和 build log 的 `CACHED`；锁定所有受支持 frontend image build 入口，要求 secret-dependent production build 不复用缓存。 |
| **5. 超时策略** | 若无法用标准 Docker 选项稳定失效缓存，不设计自定义缓存协议；production frontend build 直接使用 `--no-cache`，接受较慢构建。 |
| **6. 预警策略** | 不得把 public key 值或可逆替代值放进 build arg、日志、image history；真实 secret 不能写入测试 fixture/evidence。 |
| **7. 用户可见交互修正** | 新部署的登录/注册/API/SSE 会使用与 backend 一致的 public client key，不再因旧镜像层产生 `Invalid API key`。 |
| **8. 验收** | Makefile 与 registry-free transfer 两个正式入口的契约测试先 RED；加入 cache invalidation 后 GREEN；以当前 local key 无缓存重建 image，真实 `./twd` 注册、active Server 与 authenticated SSE 通过。 |

## 1. 报告人

2026-07-23，local-prod `./twd` 真实注册验收时由 Codex 发现。

## 2. 复现步骤

1. 用 deployment A 的 `PUBLIC_API_KEY` 构建 production frontend image。
2. 源码不变，切换到 deployment B key，以同一 Dockerfile 再构建。
3. BuildKit 将读取 secret 并执行 Next build 的 RUN 层判为 `CACHED`。
4. 用 B key 启动 backend 与 runtime frontend env。
5. 浏览器注册经 frontend bundle 发出 A key，backend 返回 `Invalid API key`。

本次实测页面为：

```text
/login?returnTo=%2Ftasks&error=Invalid+API+key
```

## 3. 根因分析

BuildKit secret mount 解决的是“值不进入 build command/history”，不是“secret 变化自动失效缓存”。
SmallKhoj 又必须在 Next production build 时把 public client key编译进浏览器 bundle，因此该 RUN
层属于 secret-dependent output，不能跨 key 复用。现有 Makefile 和 image-transfer build 入口均未声明
cache invalidation。

## 4. 修复方案

- `make frontend-image-build` 的 production Docker build 增加 `--no-cache`；
- `scripts/production_image_transfer.py` 生成的 frontend build step 增加 `--no-cache`；
- 保持 BuildKit secret 传值，不改为泄漏值的 build arg；
- 同步发布文档中的手工 production frontend build 命令；
- backend/Caddy build 保持正常缓存，性能成本只限于 frontend release image。

## 5. 验证方式

- RED/GREEN：`scripts.tests.test_frontend_dockerfile_auth` 与
  `scripts.tests.test_production_image_transfer`；
- rebuild log 中 `bun run build` 层不得为 `CACHED`；
- 新 frontend image ID 与旧缓存镜像不同；
- `./twd` 新账号真实注册成功，DOM 出现 active Server marker；
- 浏览器内 `/api/v1/auth/me` 为 200，SSE 为单一 200 transport。
