# PostgreSQL deployment-wide connection budget

### Bug 诊断胶囊：部署连接预算遗漏 frontend 与 worker

| 栏位 | 内容 |
|------|------|
| **1. 现象** | Backend 启动校验只计算 SQLAlchemy 请求池、NOTIFY publisher/listener 与 backend worker 数，遗漏 Better Auth `pg.Pool` 和可选 Feishu worker 的独立 SQLAlchemy engine。校验可能通过，但实际部署仍可能耗尽 PostgreSQL `max_connections=100`。 |
| **2. 证据** | `backend/config.py` 的旧公式为 `(5 + 10 + 2 + 1) * BACKEND_WORKERS + 5`；`frontend/lib/auth.ts` 创建未指定 `max` 的 `pg.Pool`（库默认 10）；`feishu_worker_cli` 通过 `models.async_session` 拥有另一个默认 `5 + 10` SQLAlchemy 池。Next 的 login SSR 与 auth route 构建入口还可能分别实例化该模块，因此必须先建立进程级 singleton 才能把 frontend 上界证明为 10。 |
| **3. 问题假设或根因** | 已确认根因是预算边界停在 backend 进程，没有把共享 PostgreSQL 的其他服务视为同一 deployment-wide 资源；frontend 也没有显式、唯一的池所有者。 |
| **4. 诊断策略** | 逆向追踪所有 `create_async_engine` / `new Pool` 所有者，核对 Compose service/env，先用配置与 source-contract 测试证明旧公式及 frontend 所有权缺口。 |
| **5. 超时策略** | 若 Next 运行时不能证明同一进程共享 `globalThis`，将 frontend 预算按实际可并存模块实例数上调并阻断发布，不用 PostgreSQL headroom 掩盖未知池。 |
| **6. 预警策略** | 任一服务出现未纳入公式的连接池、池上限仍由第三方默认值决定、或三次复验仍发现新池所有者时，停止局部补丁并升级为部署资源所有权设计问题。 |
| **7. 用户可见交互修正** | 无 UI 变化；错误配置会在进程启动前以包含各服务预算的稳定诊断失败，而不是上线后以随机连接超时暴露。 |
| **8. 验收** | Backend 配置测试证明 3 backend workers 的总预算为 `54 + 10 + 15 + 5 = 84` 且 83 被拒绝；frontend 测试证明显式正整数 `max=10` 与进程级 singleton；Compose、env template、runbook 和 spec 使用同一组变量与公式。 |

## 修复边界

默认预算有意为一个 frontend 进程和一个可选 Feishu worker 预留连接，即使当前 Compose profile 未启动 worker。Feishu worker 与 backend 显式使用同一组 `DATABASE_POOL_SIZE` / `DATABASE_MAX_OVERFLOW` 上限，避免“预算值”和真实 engine 值漂移。这样以后启用现有 profile 不会绕过已经通过的 backend 启动预算。若部署扩容 frontend 或 worker 副本，必须先扩展并重新验证相应实例数预算，不能把 `POSTGRES_CONNECTION_HEADROOM` 当作服务池额度。

正式容量报告现使用 schema v5 绑定同一公式。报告会从 backend 容器定向读取
worker、DB pool、overflow、NOTIFY pool、Better Auth pool、PostgreSQL capacity 与
headroom，从 frontend 容器单独读取 Better Auth pool，并把运行时值与
`SHOW max_connections=100`、完整预算对象和逐样本 listener 所有权交叉校验。
正式 v1 profile 要求没有运行中的 Feishu worker；`15` 是未启用 worker 的保守
预留，不是 worker 负载证据。任何 frontend/worker 扩容都必须引入实例倍数和新
profile，不能沿用当前 `48` 的结论。
