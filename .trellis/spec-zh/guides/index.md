# 思考指南

> **目的**：拓展思路，发现你可能没想到的东西。

---

## 为什么需要思考指南？

**大多数 bug 和技术债都来自“没想到”**，而不是能力不足：

- 没想过层边界会发生什么 → 跨层 bug
- 没注意代码模式在重复 → 到处是重复代码
- 没考虑边界情况 → 运行时错误
- 没替未来的维护者着想 → 代码难以阅读

这些指南（guide）帮助你在**编码之前问对问题**。

---

## 可用指南

| 指南 | 目的 | 使用时机 |
|-------|---------|-------------|
| [代码复用思考指南](./code-reuse-thinking-guide.md) | 识别模式、减少重复 | 发现重复模式时 |
| [跨层思考指南](./cross-layer-thinking-guide.md) | 想清楚跨层数据流 | 功能横跨多层时 |
| [参考项目指南](./reference-projects.md) | 在自创 MCP、skill、channel 或平台界面之前先查阅本地/参考仓库 | MCP/skill 可见性、agent 平台、channel/runtime、自托管工作 |
| [Runtime 调试 SOP（操作规程）](./runtime-debugging-sop.md) | 诊断 runtime/daemon/提供商卡住的状态 | agent/runtime 投递问题 |

---

## 速查：思考触发点

### 何时思考跨层问题

- [ ] 功能涉及 3 层以上（API、Service、Component、Database）
- [ ] 数据格式在层间发生变化
- [ ] 多个消费方需要同一份数据
- [ ] 你不确定某段逻辑该放哪里
- [ ] 某个后端事件、活动或 runtime 状态可能被多个界面消费

→ 阅读[跨层思考指南](./cross-layer-thinking-guide.md)

### 何时思考 Runtime/事件投递

- [ ] 你在改 `ActivityLog`、`EventRecord`、daemon 的 WS/SSE/轮询或事件别名
- [ ] 一个新事件可能到达 agent runtime
- [ ] 某个 runtime 可能收到自己发出的活动/消息
- [ ] token 用量可能增长，因为遥测以提示词文本形式投递

→ 阅读[Runtime 调试 SOP](./runtime-debugging-sop.md)和 `.trellis/spec/backend/event-delivery-contracts.md`

### 何时思考代码复用

- [ ] 你正在写与已有代码相似的东西
- [ ] 你看到同一模式重复出现 3 次以上
- [ ] 你正在往多个地方加同一个新字段
- [ ] **你正在修改任何常量或配置**
- [ ] **你正在创建新的工具/辅助函数** ← 先搜索！

→ 阅读[代码复用思考指南](./code-reuse-thinking-guide.md)

### 何时查阅参考项目

- [ ] 你在设计 MCP server/工具/资源可见性
- [ ] 你在设计 skill 可见性、skill 来源模型或 skill 注册表行为
- [ ] 你在改 agent 平台、channel/runtime、daemon、自托管或面向 supervisor 的界面
- [ ] 你想新造一套约定，而它可能已经存在于邻近仓库

→ 阅读[参考项目指南](./reference-projects.md)

### 何时验证部署或认证（auth）接入（onboarding）

- [ ] 你启动了服务并声称“能用了”“就绪”或“已部署”
- [ ] 你在改 Docker、Caddy、环境变量、daemon 连接 URL 或生产启动
- [ ] 你在改注册、登录、Better Auth 配置或账号邀请（invite）行为
- [ ] 你不确定该测 local-dev、local-prod 还是 cloud-prod

→ 阅读 `.trellis/spec/backend/deployment-environment-contracts.md` 和 `.trellis/spec/frontend/auth-onboarding-contracts.md`

### 何时遵循发布流水线

- [ ] 有人问你“这个项目怎么验证/测试/合并/部署/发布”
- [ ] 你在规划候选版本、squash 合并或云端部署
- [ ] 你需要按序执行的各阶段（capacity gate -> squash merge -> tree equality -> image transfer -> app-only deploy -> smoke -> rollback）
- [ ] 你在判断部署失败后是否允许镜像回滚

→ 阅读 `.trellis/spec/backend/release-pipeline.md`（总览），再深入 `deployment-environment-contracts.md` 查看各阶段断言

---

## 修改前规则（关键）

> **改任何值之前，永远先搜索！**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

这一个习惯就能避免大多数“忘了更新 X”的 bug。

---

## 如何使用本目录

1. **编码前**：浏览相关的思考指南
2. **编码中**：如果感觉重复或复杂，查阅指南
3. **出 bug 后**：把新的经验补进相关指南（从错误中学习）

---

## 参与贡献

又遇到“没想到”的时刻？把它加进相关指南。

---

**核心原则**：30 分钟思考能省下 3 小时调试。
