# SmallKhoj 本地真实测试拓扑

## 已知边界

| Surface | 用途 | 是否可自动改动 |
| --- | --- | --- |
| worktree frontend `:3000` | 验证当前前端代码；必须证明启动目录/commit | 否 |
| native backend `:8000` | 仅当进程身份与隔离数据库都已证明时使用 | 否 |
| Docker `local-test` Caddy `:38190/:38191` | 自洽的 production-shape 栈 | 否 |
| Docker `local-test` frontend/backend/db | 默认仅容器网络可见；DB 未映射宿主端口 | 否 |
| host PostgreSQL `:5432` | 本机共享/旧 SmallKhoj 数据，可能含真实开发数据 | 禁止测试写入或迁移 |
| host `:55432` | 历史 SSH/worker/test 端口，所有权会变化 | 禁止自动选择 |

运行时观察可能变化；每次都以 collector 输出为准。上表定义的是安全边界，不是
“当前一定健康”的声明。

## 选择规则

1. **先看待测对象。** 当前 worktree 前端改动不能由旧 Docker frontend 验收；旧
   Docker backend 也只有在 API contract 与本次代码范围兼容时才能作为依赖。
2. **再证明候选身份。** URL 可访问不等于代码正确。记录 worktree/HEAD、进程或
   container image/build 来源。
3. **优先隔离，不修共享环境。** 没有合格候选时，新建一次性候选栈或明确报告
   blocker；不要停止已有 `:8000`、重用宿主数据库或修改共享数据。
4. **同源验证。** frontend、backend、auth session、Server/Agent/Channel 标识和
   Gate 结果必须来自同一候选。

## 典型错误场景

### `:3000` 健康，但 `/auth/me` 由 `:8000` 返回 500

这只证明 native backend/DB 链路坏了。不得据此：

- 把 backend 改接宿主 `:5432`；
- 修改 Alembic revision；
- 调整真实 Server 的 owner/admin；
- 用 Docker 页面截图冒充 worktree 前端证据。

应选择身份明确的隔离候选，或者输出 `BLOCKED_CANDIDATE_IDENTITY`。

### Docker `local-test` 健康，但已运行很久

它可以证明该 image 的 production-shape 健康，不能自动证明当前 worktree。只有
image/build 来源与待测 commit 对齐后，才可用于当前改动验收。

### 数据库 revision 不属于当前 Alembic tree

立即停止写入。只允许执行只读指纹和备份准备。禁止直接更新
`alembic_version`、`stamp head`，也禁止依据少数列/表猜测 revision 等价。

## 上下文交接契约

父 Agent 派发真实测试任务时，prompt 必须按此顺序包含：

1. collector 的完整 `<smallkhoj-real-test-context>` 输出；
2. 待测 worktree/commit 和改动范围；
3. 已选候选 URL 与候选身份依据；
4. 允许执行的验证命令；
5. 明确禁止的环境/数据库变更。

子 Agent 不负责重新选择数据库或修环境。缺少任一项时，它应返回准确 blocker，
而不是探索其他 Chrome profile、端口、数据库或迁移路径。
