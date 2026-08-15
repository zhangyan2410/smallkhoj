# G3 验证记录：goose 1.46 session 命名调用不可复现

> 2026-08-15。方法：bridge 级 probe（/tmp 脚本，同 daemon env 栈），收集
> `message_usage` 逐笔通知与 `usage_update` 累计终值（累计器覆盖 session 内
> 全部 LLM 计费，含任何内部调用），对照 `GOOSE_DISABLE_SESSION_NAMING=1` /
> unset 两组，并复刻 driver 环境（工作区 AGENTS.md）。

## 实测矩阵（真 goose 1.46.0 + MiniMax-M3）

| 场景 | env | message_usage 笔数 | 累计 input | 命名调用 |
|---|---|---|---|---|
| 裸桥接，无 AGENTS.md | =1 | 1 | 4,765 | 无 |
| 裸桥接，无 AGENTS.md | unset | 1 | 4,765 | 无 |
| 工作区 AGENTS.md（=driver 环境） | =1 | 1 | 10,833 | 无 |
| driver 新建 session 后恢复（G1 验收） | =1 | 1 | 11,581（携带上下文） | 无 |

## 结论

- goose 1.46 + ACP：所有 daemon 代表性路径（新建 / loadSession 恢复 / 桥接）
  每 turn 恰好一笔 LLM 调用，累计器与单笔相等——**不存在隐藏的命名调用**。
- `GOOSE_DISABLE_SESSION_NAMING` 字符串存在于 1.46 二进制
  （crates/goose/src/session/session_naming.rs），保留 daemon 现有 env=1 设置。
- 原始「每 session 6,371 input 命名调用」证据来自 08-06 时期 daemon-prod
  用量 jsonl，今日不可复现；audit 401 日志中的 naming attempt
  （"Failed to generate session description"）发生在主回复失败后的错误处理
  路径 + 旧 catalog 会话恢复（Restoring evicted session），不是当前路径。
- 附带澄清：g1-verify turn-1 的 33.5k input 是模型按 slock 指令尝试
  `aura message send`（probe 服务器 127.0.0.1:9 不可达）引发的工具重试，
  与命名无关。

## 处置

G3/D 关闭为「实测无此问题」：无代码变更；`applyGooseProviderEnv` 的
env=1 保留（无害且二进制仍在读）。若未来 goose 升级后再次观察到
每 session 多出一笔全上下文调用，用本文件矩阵复测并查 session_naming.rs。
