---
name: smallkhoj-real-test
description: "Load and enforce SmallKhoj's real-test runtime context before browser, runtime, or core-flow verification. Use when Codex, ZCode, or another agent must select or start a local test stack, diagnose ports 3000/8000/38190/38191, authenticate ./twd, run Integration Gate, verify Server/Agent/Channel/Chat/Task, or consider using any local PostgreSQL database."
---

# SmallKhoj 真实测试

把测试环境选择变成固定输入，禁止每个 Agent 重新猜端口、数据库和登录方式。

## 第一步：加载上下文

在选择环境或运行测试前执行：

```bash
rtk bash .agents/skills/smallkhoj-real-test/scripts/collect-context.sh
```

完整读取输出。若要派发子 Agent，把整个
`<smallkhoj-real-test-context>` 块原样放在任务 prompt 开头。不得只写“自己找怎么测试”。

涉及启动、复用或切换测试栈时，完整读取
`references/runtime-topology.md`。浏览器验证同时加载 `project-webdriver-cli`。

## 硬边界

- collector 只读，不证明任何候选栈包含待测代码。
- 宿主 `127.0.0.1:5432` 是受保护的共享/旧数据边界；测试流程不得迁移、stamp、
  清空、删除或修改其业务数据。
- `55432` 是历史上被 SSH/worker 占用的非可信端口；不得仅因它监听就自动使用。
- Docker `local-test` 的 DB 在容器网络内；它与宿主 `:5432` 不是同一个数据库。
- 不得为了测试运行 `./dev.sh stop`、kill 已有进程、`docker compose down`、修改
  `alembic_version`、调整 owner/admin，或迁移共享数据库。
- `./dev.sh start` 会停止它认为已有的服务，并按端口猜数据库；没有明确隔离的
  `DATABASE_URL`、`BETTER_AUTH_DATABASE_URL` 和候选身份时，不得把它当测试入口。

需要以上任何环境变更时，先给出准确目标和影响；只有用户明确授权后才能执行。

## 候选身份门禁

先证明页面和 API 来自本次待测 worktree/commit：

1. 记录 worktree、branch、HEAD 和改动范围。
2. 记录 frontend/backend 的 URL、监听进程或容器 image。
3. Docker 容器比当前改动更早或无法证明 image 来源时，只能证明旧镜像，不得验收
   当前前端代码。
4. `:3000` 页面健康但指向坏的 `:8000`，不得修共享库凑出健康状态；改用已证明的
   隔离候选，或把本 worktree frontend 显式接到同一隔离候选 backend。

候选身份不明时输出 `BLOCKED_CANDIDATE_IDENTITY`，不要继续做截图或业务断言。

## 最小真实验证顺序

1. 运行 collector，选择一个身份明确且健康的候选。
2. 先跑 Integration Gate 合同测试：

   ```bash
   rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs
   ```

3. 用候选自己的 `FRONTEND_BASE`、`API_BASE`、测试账号和显式 Server 执行 auth/基础
   检查；不得沿用另一个栈的 cookie 或数据库。
4. 浏览器操作只用项目入口：

   ```bash
   FRONTEND_BASE=<candidate-frontend> API_BASE=<candidate-api> \
     ./tools/twd-guard/twd-auth <test-account>
   FRONTEND_BASE=<candidate-frontend> \
     ./tools/twd-guard/twd-open <route>
   ```

5. 涉及核心产品链路时，从最小 mode 开始；Server、Agent、Channel、Chat、Task 和
   runtime 标识必须来自同一候选：

   ```bash
   rtk node tools/integration-gate/run.mjs \
     --mode foundation-only \
     --api-base <candidate-api> \
     --frontend-base <candidate-frontend> \
     --server-id <candidate-server-id> \
     --result-out <task-evidence-path>
   ```

6. 页面改动必须有 exact-tab URL/DOM 和截图；状态写入必须有 API 或只读 DB 对账；
   runtime 回复必须有 `./smallkhoj-trace` 或 live Gate 对账。
7. 只有同一 marker、同一候选和同一身份贯穿浏览器/API/trace/Gate，才能写 PASS。

## 结束输出

只报告以下五项：候选身份、使用的 URL、执行的验证、证据路径、PASS 或准确 blocker。
截图、旧 Docker 镜像、共享数据库修补或未运行的 Gate 都不能扩大解释。
