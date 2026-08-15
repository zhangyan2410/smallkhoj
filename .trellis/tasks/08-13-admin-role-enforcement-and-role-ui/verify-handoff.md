# 验证交接（给测试 agent）

任务：`.trellis/tasks/08-13-admin-role-enforcement-and-role-ui`（admin 权限校验 + 角色化 UI）。
代码改动已完成且通过组件级/单测验证；以下真实链路验证**未执行**，交由测试 agent。

## 待验证项

1. **member 建频道被拒（后端 403）**：普通 member 在他人/官方 server 下调 `POST /api/v1/channels` → 403 `Server owner/admin role required`；owner/admin → 200。
2. **member 视角 UI 隐藏**：以 member 身份登录并切到官方 server（s8pz9）：
   - 聊天侧栏「频道」区无「创建频道」+ 按钮；「私信」区无「创建智能体」+ 按钮；
   - 电脑页无「添加电脑」按钮；
   - 工作台首页 quick-start 无「新建频道」表单；/daemon 控制页无 Channel 表单。
3. **owner 视角回归**：同一批入口对 owner/admin 照常显示且可用。
4. **server 上下文标识**：rail switcher 图标显示当前 server 首字母，tooltip 为「名称 · 角色」；下拉当前 server 行对 home server 标「我的」；聊天侧栏 brand 行副标题显示「server 名 · 角色（· 我的）」。

## 环境前置（重要）

- **后端必须重启**：`POST /channels` 的 403 是新代码，dev backend（:8000）无热重载，需 `./dev.sh restart` 后才生效（按 real-test 规约需用户授权）。
- 前端（:3000）`npm run dev` 有热更新，无需重启。
- 需要两个账号：一个 owner（如官方账号 AuarServer），一个普通 member（auto-join s8pz9 的账号即可；测试账号注册即自动加入官方 server）。
- `backend/.env` 现为 `OFFICIAL_SERVER_HANDLE=s8pz9`（官方 server = AuarServer 的 home server）。
- 环境选择前先跑 `.agents/skills/smallkhoj-real-test/scripts/collect-context.sh`；浏览器操作走 `./twd` 入口。

## 已通过的验证（勿重复扩大解释）

- 后端 109 条 postgres/HTTP 测试绿，含新测试 `backend/tests/test_channel_create_role_postgres_http.py`（member 403 / owner 200 / admin 200）。
- 前端 `bun test` 276/278（2 个失败为 HEAD 预存：members 页 `MemberNameTag` 结构断言，已核实与本次无关）；`tsc --noEmit`、eslint 绿。
- 新增源断言测试：`frontend/test/visible-destructive-actions-integration.test.ts` 的「admin-only creation entries are hidden for plain members」「current server context is visible in switcher and chat sidebar」。

## 本任务未覆盖（防误报）

- 官方 server 接 daemon + 官方 agent + @mention 触发：见 `08-12` 任务 `testing-findings.md` 末节，需单独立项。
- 遗留观察（PRD AC2 已记录，未改）：`POST /api-keys` member 可铸 admin 类型 key；`task-run-templates` 写操作无角色校验。
