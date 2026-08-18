# 认证接入契约

> 针对 Better Auth 注册、登录、邮箱验证与早期发布账号策略的前端认证（auth）契约（contract）。

## 场景（scenario）：注册邮箱验证策略

### 1. 作用域（scope）/ 触发条件

只要改动涉及注册、登录、账号创建、团队/Server 邀请（invite）流程、Better Auth 配置或生产认证部署所需的环境变量，就适用本 spec。

这是跨层改动：产品策略、Better Auth 服务端配置、前端 UX、数据库状态和外部邮件提供商必须保持一致。

### 2. 签名

当前认证配置文件：

```text
frontend/lib/auth.ts
```

当前 Better Auth 配置结构：

```ts
export const authOptions = {
  database: betterAuthPool,
  secret: betterAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
} satisfies BetterAuthOptions
```

当前生产环境必需的环境变量：

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_DATABASE_URL
BETTER_AUTH_DATABASE_POOL_SIZE
AUTH_BRIDGE_SECRET
```

邮箱验证需要同时添加：

```ts
emailVerification: {
  sendOnSignUp: true,
  sendVerificationEmail: async ({ user, url, token }, request) => {
    // call the configured mail provider here
  },
}
```

并且，当必须先完成验证才能登录时：

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
}
```

### 3. 契约

- 当前注册并不能证明邮箱所有权。`emailAndPassword.enabled: true` 启用的是邮箱/密码注册和登录，它本身不会发送验证邮件。
- 在 `sendVerificationEmail` 和提供商环境变量配置好之前，不要展示或测试任何暗示邮箱验证已生效的产品文案。
- Better Auth 的邮箱验证通过项目提供的邮件函数发送带令牌的验证 URL。SmallKhoj 必须自行提供邮件提供商集成。
- 注册时发送验证邮件需要 `emailVerification.sendOnSignUp: true`。没有它，注册不会自动发送验证邮件。
- 数字“验证码”或 OTP 式注册与 Better Auth 默认的验证链接流程是两种不同的 UX。如果产品要求验证码，必须显式实现或选择支持 OTP 的提供商/插件。
- 登录前强制验证是另一个独立的策略开关。没有可用的 `sendVerificationEmail` 路径，就不要启用 `requireEmailVerification: true`。
- 邮件投递需要 SMTP 或邮件 API 提供商。提供商凭据、发件域名、模板和回调 URL 属于部署环境变量/密钥，不是仓库里的常量。
- 如果界面不面向公开/不可信用户，早期内部测试可以使用未验证的测试账号或管理员创建的账号。
- 公开 beta、外部团队邀请或不可信注册必须从以下方式中选择一种：
  - 已配置的邮箱验证提供商；
  - 仅限邀请/管理员创建的账号；
  - GitHub 登录；
  - 微信扫码登录；
  - 其他显式指定的身份提供商。
- 如果使用 Tencent SES，要预期域名/发件人验证和按用量计费。不要以为大规模发邮件是免费的。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| `sendVerificationEmail` 缺失 | 注册可以创建/登录账号，但邮箱所有权未验证。 |
| `sendVerificationEmail` 存在但 `sendOnSignUp` 为 false/缺失 | 注册不会自动发送验证邮件。 |
| 设置了 `requireEmailVerification: true` 却没有提供商 | 注册/登录流程不可用；拦截该改动。 |
| 生产环境缺少验证提供商环境变量 | 应用启动或注册验证测试必须在发布前失败。 |
| 要求验证时用户未验证就尝试登录 | UI 处理 403/错误状态并提示需要验证。 |
| 注册文案声称“验证码已发送”但没有配置邮件提供商 | 产品 bug；必须改文案或实现提供商。 |
| 公开 beta 允许无验证、无邀请管控的密码注册 | 发布风险；需要用户/产品方明确批准。 |

### 5. 好/基线/坏案例

- 好：内部测试账号被明确当作未验证的测试数据对待。
- 好：添加验证时一并包含提供商环境变量、发件域名配置说明、UI 状态和测试。
- 基线：为受控的本地/云端测试启用邮箱/密码注册，且没有验证相关文案。
- 坏：以为启用了邮箱/密码认证，Better Auth 就会自动发邮件。
- 坏：承诺数字邮箱验证码，实际只实现了验证链接邮件。
- 坏：未实现 `sendVerificationEmail` 就启用 `requireEmailVerification`。
- 坏：把 API key、SMTP 密码、发件密钥或回调 URL 硬编码进被版本跟踪的源码。

### 6. 必需测试

针对认证环境变量/部署改动：

- 使用 `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`BETTER_AUTH_DATABASE_URL`、显式为正数的 `BETTER_AUTH_DATABASE_POOL_SIZE` 和 `AUTH_BRIDGE_SECRET` 完成前端构建。
- 在目标环境上做浏览器注册/登录冒烟测试。
- 确认产品文案与生效策略一致：邮件没有真正发出，就不出现验证相关文案。

针对邮箱验证实现：

- 单元/集成测试：`sendVerificationEmail` 以预期的用户邮箱和回调 URL 被调用。
- 对提供商适配器做测试，密钥用 mock。
- 覆盖未验证账号状态的注册测试。
- 登录测试：`requireEmailVerification` 为 true 时未验证用户被拒绝。
- UI 测试：“请查收邮件”、重发、令牌过期/无效、验证成功等状态。

### 7. 错误 vs 正确

#### 错误

```text
emailAndPassword.enabled is true, so signup sends a verification code and the email is trusted.
```

#### 正确

```text
emailAndPassword.enabled only enables password auth. Email ownership is unverified until sendVerificationEmail plus provider env and verification policy are implemented.
```

## 场景：Server 邀请加入链接

### 1. 作用域/触发条件

只要改动涉及 Server 邀请、邀请接受、成员接入（onboarding）、登录返回路径或登录后的 Server 切换行为，就适用本 spec。

### 2. 契约

- 在配置真正的邮件提供商之前，Server 邀请以链接为先。UI 文案必须说明用户应复制链接并手动发送；不得声称已发送邮件、验证码或通知。
- 创建邀请是针对活跃 Server 的 owner/admin 操作。只有当前账号的活跃 `server_memberships` 角色为 `owner` 或 `admin` 时，成员页的邀请控件才应可见；后端仍必须强制执行同一条规则。
- 打开 `/join/<token>` 可以免登录预览，但接受邀请必须有已登录账号。
- 接受邀请不得要求接受方账号已经是被邀请 Server 的成员。接受动作应直接调用邀请接受端点，然后用返回的 Server id 设置活跃 Server cookie。
- 接受之后，加入的 Server 必须出现在 `/api/v1/auth/me.memberships`；Server 切换器不应需要一套单独的邀请专用状态模型。
- 如果未登录用户打开邀请链接，登录/注册必须保留一条安全的同源 `returnTo` 路径，回到 `/join/<token>`。

### 3. 必需测试

- 后端测试：邀请创建授权、仅存哈希的令牌存储、有效接受、格式错误/过期/撤销/已消费的拒绝，以及同一账号的幂等重复接受。
- 前端/源码测试：证明接受邀请会激活返回的 Server id，且邀请 UI 不暗示邮件已投递。
- 双账号浏览器证据：账号 A 创建链接，账号 B 接受，账号 B 在成员列表/切换器中看到账号 A 的 Server。
- 浏览器证据：非管理员成员在共享 Server 中看不到创建邀请的操作，而 owner/admin 能生成可复制的邀请链接。
