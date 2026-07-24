# Legacy schema definition preflight

### Bug 诊断胶囊：legacy schema 只按对象名称放行

| 栏位 | 内容 |
|------|------|
| **1. 现象** | 未受 Alembic 管理的旧数据库只要保留预期 table/column/index/constraint 名称，就可能被报告为兼容；对象类型、nullable、unique、外键目标/删除规则、check/index 定义即使已经漂移也可能被 operator stamp 为 baseline。第一轮结构化 fingerprint 后仍有两个 P2 绕过：默认值中的 `'open'` 可改为大小写敏感且语义不同的 `'OPEN'`，同名 `IN` check 可改成 `(同一检查) = FALSE`，两者仍被报告兼容。期望是任何影响后续 migration 正确性的定义漂移都 fail closed，且预检保持只读。 |
| **2. 证据** | 初始实现把 catalog 查询压缩为名称集合；结构化 fingerprint 的 `_normalize_sql()` 随后对包含字符串字面量的整段 SQL 调用 `.lower()`，而 `_actual_check_signature()` 只搜索任意位置是否出现 `IN`/`= ANY` 并收集字符串集合。真实 disposable PostgreSQL 分别改写 `memory_proposals.status` 默认值和 `ck_server_memberships_role` 布尔语义后，两条 focused 测试均得到 `LegacyPreflightReport(compatible=True, issues=())`。 |
| **3. 问题假设或根因** | 已确认有三层根因：初始 preflight 把“对象存在”误当成“历史 0001 schema 等价”；第一轮 SQL 规范化没有区分可忽略的 SQL 代码格式与不可改写的引号 token；check 比较没有验证 membership 谓词是否占据完整顶层表达式。于是字符串大小写语义和外层布尔运算分别在规范化、签名压缩时丢失。 |
| **4. 诊断策略** | 从 Alembic `0001_baseline` 与当前 metadata 的历史排除规则建立期望 fingerprint；分别漂移列、索引、外键/check/unique 定义，观察 preflight；对照 PostgreSQL catalog 中可稳定规范化的定义字段。P2 补充使用两个独立 disposable database：仅改变引号字面量大小写，或仅在同值集合 check 外包 `= FALSE`，要求报告精确的 default/check mismatch。 |
| **5. 超时策略** | 若无法跨受支持 PostgreSQL 版本稳定规范化完整 DDL，则缩小到 migration 安全所需的结构字段（类型、nullable、列序、unique、谓词、约束类型/列/引用/删除动作）并对未知定义 fail closed，不用脆弱的整段 `pg_dump` 文本哈希。 |
| **6. 预警策略** | 规范化触碰单引号字符串内容或大小写敏感的双引号标识符、check 识别使用“包含某个 token”而非完整形状匹配、测试只覆盖对象缺失、或修复仍允许同名错误对象通过，说明方案方向错误；第三次同型遗漏则停止代码补丁并建立版本化 schema fingerprint 生成机制。 |
| **7. 用户可见交互修正** | 无产品 UI 变化；旧库升级前会得到精确 definition mismatch，operator 必须先审核/修复 drift，避免错误 stamp 后在迁移或运行期损坏数据。 |
| **8. 验收** | disposable PostgreSQL RED 证明同名多类定义漂移、大小写不同的引号默认值和布尔反转 check 被旧实现放行；GREEN 覆盖列 type/nullability/default、unexpected post-baseline column、索引列序/unique/method/predicate、PK/unique/check/FK 结构，并精确拒绝 `'OPEN'` 与 `(...)=FALSE`。报告只读、不创建 `alembic_version`，兼容真实 baseline 仍通过，随后 baseline stamp→head 仍成功。 |

## 五件套

1. **报告人**：独立 delivery re-audit，2026-07-23。
2. **复现步骤**：在 disposable PostgreSQL 升到 0001，删除 `alembic_version`，保留对象名称但改变定义，再运行 `inspect_legacy_schema()`。
3. **根因分析**：旧实现只收集 `column_name`、`indexname` 和 `conname`。它不比较列类型/nullability/default，不比较 index key 顺序/unique/access method/predicate，也完全忽略未命名 PK/FK/unique 的语义。第一轮结构化修复又把整段 SQL 小写化，并把 check 压缩为“列 + 任意位置出现的字符串集合”，分别丢掉字面量大小写和顶层布尔语义。因此同名错误对象仍有窄绕过；这不是 Alembic 或 PostgreSQL 版本问题。
4. **修复方案**：继续保持单连接、只读 catalog 查询，但将 baseline fingerprint 提升为结构化定义：从受版本排除规则约束的 SQLAlchemy metadata 派生列/索引/约束期望，从 `pg_attribute` / `pg_index` / `pg_constraint` 读取实际定义并规范化比较。规范化先保护单引号字符串和有语义的双引号标识符，只对外部 SQL 代码消除大小写、空白、限定符、无害括号和 text cast 噪声。简单 membership check 必须完整匹配顶层 `IN (...)` 或 PostgreSQL 的 `= ANY (ARRAY[...])`，再比较列和值；任何额外布尔包装均拒绝。外键比较本地列、目标表列和 delete action，并显式拒绝 post-baseline 对象。没有采用 `pg_dump` 文本哈希，因为跨 PostgreSQL 小版本的格式噪声会制造假阴性；也没有在 preflight 中创建临时 schema，因为只读是硬契约。
5. **验证方式**：真实本机 ephemeral PostgreSQL（新数据目录、随机 loopback 端口、每例独立 disposable database）先得到两个目标 RED：大小写默认值与布尔反转 check 均被旧实现错误放行；修复后 focused P2 为 `2 passed`，完整 legacy focused gate 为 `5 passed`，完整 migration 测试文件为 `10 passed`。兼容 baseline、缺表 drift、保留名称的多定义 drift、引号字面量、顶层 check 语义和其余真实 Alembic 转换均符合预期，且每个拒绝路径再次确认 `alembic_version` 不存在。
