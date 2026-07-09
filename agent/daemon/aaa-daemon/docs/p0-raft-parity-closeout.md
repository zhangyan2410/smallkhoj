# P0 Raft Parity 收口文档

## 背景

aaa-daemon 的 `slock` CLI 原本是架构验证原型：手写参数解析、raw JSON 输出、JSON blob 错误、无 `--help`/`--version`。@zy-ean 要求将其改造为真正的产品级 CLI，目标是**贴近真实 Raft agent-facing CLI 体验**——不只是命令名补齐，而是输入、输出、错误、权限、边界和使用手感全面对齐。

本次 P0 批次完成了：
1. 全部 46 条原有命令的 commander 化迁移（canonical 输出 + 三段式错误 + credential 脱敏 + 写安全门）
2. 6 条 Raft 缺失命令的补齐
3. 2 条已有命令的 Raft 语义对齐

---

## 最终基线

- **分支**: `feat/slock-cli-productization`
- **最终 commit**: `5505701` — `fix(cli): harden Raft parity UX`
- **前置 commits**:
  - `fe4443b` — `feat(cli): add P0 Raft parity commands`（P0 实现）
  - `b8e2775` — `docs: quote #channel target in thread read example (shell safety)`
- **测试**: 265 pass, 0 fail（含 78 golden tests）

---

## P0 实现清单

### 新增命令（6 条）

| 命令 | 说明 | 行为 |
|------|------|------|
| `auth whoami` | 认证自省/运行上下文诊断 | 本地诊断，不打 server；显示 agent ID/proxy URL/token 状态；支持 `--format json` |
| `inbox check` | 收件箱摘要 | 只看 pending target 摘要，不 drain message body |
| `manual get` | 获取操作手册 | 支持 `--reason` 校验（<12 字符本地拒绝 `knowledge_reason_invalid`）|
| `manual search` | 搜索手册主题 | numbered results 输出（`Manual search results:` / `1. topic — summary`）|
| `channel mute` | 静音频道 | write-gated；只允许 regular channel；DM/thread 本地 `INVALID_TARGET` |
| `channel unmute` | 取消静音 | 同 mute |

### 语义对齐（2 条）

| 命令 | 原行为 | 对齐后行为 |
|------|--------|-----------|
| `channel members <target>` | 只支持 `--channel/--target/-c` | 支持 positional target（channel/DM/thread）；旧 alias 保留兼容；help 显示 `Usage: raft channel members [options] <target>` |
| `attachment view <id> --output <path>` | `view` 返回 metadata 卡片 | Raft 语义：`view --output` 下载文件，输出 `Downloaded to: <path>`；裸 `view <id>` 本地 `INVALID_ARG`；`download` 保留为兼容 alias |

### Help / 命令身份

- `--help` 和迁移的 subcommand help 现在 clean exit 0，显示 `raft ...` 形态
- 不再落到 legacy JSON usage / exit 2
- 不需要 proxy env 即可查看 help

---

## Phase 2 真实测验证证

### 第一轮发现的问题

@能哥 用真实 Raft 对照 + fake backend 测试，发现 5 个阻塞项：

1. `--help` exit code 和格式与 Raft 不一致（legacy JSON / exit 2）
2. `attachment view` 裸调用仍返回 metadata（应要求 `--output`）
3. `manual get --reason` 缺校验，`manual search` 输出不够贴近 Raft
4. `channel members` canonical text 是 bare rows（应有 headers/grouping）
5. prompt/docs 示例中裸 `#channel` 会被 shell 当注释吞掉

### Follow-up 修复（commit `5505701`）

| 问题 | 修复 |
|------|------|
| help exit/format | `--help` 和 subcommand help clean exit 0，Commander `raft` 格式 |
| attachment view 裸调用 | 裸 `view <id>` → 本地 `INVALID_ARG`；help 不再宣传 metadata |
| manual reason/search | `--reason <12` 字符 → `knowledge_reason_invalid`；search numbered output + snippets |
| channel members text | `## Channel Members` + `Agents:` / `Humans:` 分组 |
| shell quoting | README/docs 所有 `#channel` 示例加引号 |

### 第二轮复测结果

@能哥 对 `5505701` 做完整复测矩阵，结论 **PASS**：

| 测试项 | 结果 |
|--------|------|
| help/exit（global + subcommand） | PASS |
| auth whoami | PASS |
| inbox check | PASS |
| manual get/search（含 reason 校验） | PASS |
| channel members（positional/DM/thread/conflict） | PASS |
| channel mute/unmute（write-gate/allowlist/target boundary） | PASS |
| attachment view --output（字节写入 + 裸 view 拒绝） | PASS |
| docs/prompt shell safety | PASS |

---

## 验证证据

- `npm run build` PASS
- `node --test test/slock-cli-golden.test.mjs` PASS, 78/78
- `node --test test/slock-cli.test.mjs test/slock-cli-coverage.test.mjs` PASS, 87/87
- full `npm test` PASS, 265/265
- @能哥 真实 Raft 对照复测 PASS（task #6）

---

## 最终结论

本批 P0 Raft parity 达到 **usable / reliable / productized**。

- 所有 P0 命令行为对齐真实 Raft agent-facing CLI 体验
- 输入/输出/错误/权限/边界经过真实测试验证
- 两个非阻塞 residual 不影响 P0 验收

---

## 非阻塞 Residual

1. **`attachment download` 兼容 alias**: 仍存在，裸调用走 legacy 路径可 stream bytes。Raft-facing prompt/docs 主路径只教 `attachment view <id> --output <path>`。后续可选删除或保留兼容。

2. **`slock` wrapper 命名**: runtime prompt 部分地方仍用 `slock` wrapper 名称。daemon 目前仍生成/兼容 slock wrapper，不挡 P0 行为验收。后续品牌统一时单独做 naming/prompt cleanup。

---

## 后续建议

1. **P1 批次**: `channel create/update/add-member/remove-member`、`server update`、`integration env/invoke`、`mention`。按独立批次推进，保持每批产品可用状态。
2. **P2 批次**: `attachment comments`、`action prepare`、`integration app`。
3. **smallkhoj-only 扩展**（memory/task summary/promote/thread summary）: 继续后置，暂不进 prompt。等产品确定 memory/summary 体系是正式主路径后再纳入。
4. **命名统一**: 后续将 runtime prompt 和 wrapper 中的 `slock` 统一为 `raft`。
5. **Codex ACP env 注入**: 修复 Codex ACP runtime 的 tool shell env 注入（记录在 `docs/followup-improvements.md`）。
