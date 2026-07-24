# 2026-07-22 rtk test 子命令误用清理 + 真实 PG 冒烟计划

> 执行入口。本文取代旧 HANDOFF §5 与原 plan-freeze 路线。
> 工作目录：`/Users/code/project/smallkhoj-audit-remediation`
> 分支：`feat/2026-07-audit-remediation`，HEAD `8c1e7d6`，未 push。

## 0. 背景与实测真相（必读）

上一稿文档把 `rtk test ! -e <path>` 定性为“rtk 工具假绿”，经 2026-07-22
实测，这是**误诊**。实测结论（合成路径）：

```text
rtk test <args>   “运行测试套件命令，只显示失败”。参数是要跑的测试命令，
                   例如 rtk test cargo test。它不是 shell test/[ 的代理。
                   退出码：总是返回 0（实测 rtk test false 也返回 0）。
rtk run  <args>   sh -c raw 执行。退出码也总是 0（不透传）。
rtk proxy <args>  透传执行。如实透传退出码。
rtk zsh -c '<expr>'   zsh 内部 set -e / [[ ]] 语义正常，退出码可靠。
```

plan 001 把 `rtk test` 误当成文件检测，69 处全部错误。**rtk 本身没坏。**
本次只清理“误用 `rtk test` 做文件断言”这一类，不重冻结、不重算哈希、
不为它阻塞 PR。详见《关键并发整改接手文档》§7。

## 1. 目标

1. 清除 plan 001 中全部 69 处 `rtk test` 误用，改成可靠断言；
2. 用**原生 shell**自验替换后的断言语法正确（不依赖 rtk）；
3. 跑一次真实 PostgreSQL 冒烟，验证 4 个 Alembic 迁移可从空库 upgrade；
4. 把文档修正 + plan 001 清理 + 冒烟结果一起 amend 进当前提交，push → PR。

容量测试（300/500/30）不在本轮，留作合并后快速跟进，不阻塞 push。

## 2. 受影响范围（已核对）

- `plans/001-release-critical-bugs-and-hundreds-concurrency.md`：69 处
  `rtk test`，分 4 种语义形态（见 §3）。
- `docs/audits/2026-07-24-关键并发整改接手文档.md` §7：误诊已修正（本计划
  前置步骤已完成）。
- `zy-think/articles/*.md` 2 处 `rtk test cargo test` 是**正确用法**，不动。
- `rtk run` 在 plan 001 中**0 处**，无暗坑。

## 3. 替换规则（4 种形态，机械可重复）

所有断言统一改为 `rtk zsh -c '[[ ... ]]'`：zsh 内 `[[ ]]` 语义可靠，
`set -euo pipefail` 已在每段开头，断言失败即非零退出，且 rtk 对 zsh -c
透传退出码。引号语义保持单引号包路径占位符不变。

| # | 原形态 | 语义 | 替换为 |
|---|---|---|---|
| A | `rtk test ! -e 'PATH'` | 文件不存在才放行 | `rtk zsh -c "[[ ! -e 'PATH' ]]"` |
| B | `rtk test -s 'PATH'` | 文件存在且非空才放行 | `rtk zsh -c "[[ -s 'PATH' ]]"` |
| C | `rtk test ! -s 'PATH'` | 文件不存在或为空才放行 | `rtk zsh -c "[[ ! -s 'PATH' ]]"` |
| D | `rtk test -f 'PATH'` | 文件存在且是普通文件 | `rtk zsh -c "[[ -f 'PATH' ]]"` |

> 形态 C/D 在 plan 001 中各仅几处；绝大多数是 A(41)/B(16+3)。
> 对内嵌在长 `rtk zsh -c '...; rtk test -s "$x"; ...'` 链里的 3 处 B
> （production-public-key-sha256 三段），因为外层已是 zsh -c，直接把
> `rtk test -s "$x"` 换成 `[[ -s "$key_evidence" ]]`，去掉冗余的 rtk 前缀。

## 4. 自验（不依赖 rtk）

替换完成后，对每种形态各取一个合成路径，用**原生 zsh**直接跑断言，
确认语义与原意一致（present/missing 两种情况都测）：

```bash
# 形态 A：! -e
test ! -e /tmp/sentinel-missing && echo A_missing_OK
test ! -e /tmp/sentinel-missing-here && { : > /tmp/sentinel-missing-here; }
test ! -e /tmp/sentinel-missing-here && echo "SHOULD_NOT_HAPPEN" || echo A_present_rejects_OK
```

自验通过的判据：present 情况返回非零、missing 情况返回 0，与原 `! -e`
意图一致。B/C/D 同理。自验**不经过 rtk**，证明替换后的断言语义本身正确。

## 5. 真实 PostgreSQL 冒烟

目标：证明 4 个 Alembic 迁移能从空库 `upgrade head`，排除“迁移脚本有
bug，合并到 main 后 prod 起不来”这档最高风险。**分钟级，不是容量压测。**

约束（来自接手文档 §8/§9）：

- 不用端口 55432（属用户 ssh，禁止触碰）；
- 用一次性本地 PG，绑空闲端口（如 55440），冒烟完即销毁；
- 不访问旧云、不 SSH/SCP、不枚举浏览器 tab。

步骤：

```bash
# 1. 起一次性 PG（docker postgres:16-alpine，目标生产同大版本系）
docker run -d --name smallkhoj-pg-smoke \
  -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke \
  -p 55440:5432 postgres:16-alpine

# 2. 等待就绪
until docker exec smallkhoj-pg-smoke pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done

# 3. 跑迁移（DATABASE_URL 指向一次性 PG）
DATABASE_URL="postgresql+asyncpg://postgres:smoke@127.0.0.1:55440/smoke" \
  uv run --project backend alembic upgrade head

# 4. 校验：表已建、版本表 = head
docker exec smallkhoj-pg-smoke psql -U postgres -d smoke -c '\dt' | head
docker exec smallkhoj-pg-smoke psql -U postgres -d smoke -c 'select version_num from alembic_version;'

# 5. 销毁
docker rm -f smallkhoj-pg-smoke
```

通过判据：`upgrade head` 退出 0；`\dt` 列出全部业务表；
`alembic_version.version_num` = 最新 revision（0004）。

如失败：记录迁移报错，定位是某个 revision 的 SQL 问题，最小修复后重跑。
这是本轮唯一允许的代码改动触发点（迁移脚本本身）。

## 6. 收口

1. 把以下三处改动 amend 进 `8c1e7d6`（未 push，可安全 amend）：
   - 接手文档 §7 修正；
   - plan 001 的 69 处 `rtk test` 清理；
   - 本计划文档新增。
2. 冒烟结果记为本地证据，**不**写进提交（避免把一次性 PG 信息固化进库）。
3. 重跑受影响的最小静态门禁：`git diff --check`、plan 001 的 markdown
   无残留 `rtk test`。
4. push `feat/2026-07-audit-remediation` → 建 PR。
5. 容量测试作为 PR 合并后的快速跟进，不在本轮。

## 7. 不做的事

- 不重冻结 plan、不重算 SHA、不新建/不覆盖 release ledger；
- 不为 `rtk test` 阻塞产品修复 PR；
- 不碰主工作区 `/Users/code/project/smallkhoj` 的 MEMORY.md / session-observer
  等他人 WIP；
- 不动 55432、不 SSH 旧云、不跑完整容量压测。
