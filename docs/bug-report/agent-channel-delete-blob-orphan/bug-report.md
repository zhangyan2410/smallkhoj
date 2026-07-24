# Agent/channel deletion leaves local file blobs orphaned

### Bug 诊断胶囊：级联删除 FileEntry 后磁盘 blob 永久残留

| 栏位 | 内容 |
|------|------|
| **1. 现象** | 删除 Agent 或普通 Channel 后，相关 `files` 元数据被 PostgreSQL cascade/显式 DELETE 删除，但 `storage_path` 指向的本地 blob 仍留在 `UPLOAD_ROOT`。数据库无法再枚举或删除这些文件，磁盘占用只增不减。 |
| **2. 证据** | `FileEntry.uploaded_by` 使用 `ON DELETE CASCADE`；`_delete_channels_by_id()` 与 `_delete_messages_by_id()` 直接 DELETE `FileEntry`；`delete_member()` 和 `delete_channel()` 均未调用已有的 quarantine/restore/purge 文件补偿机制。 |
| **3. 问题假设或根因** | 根因已确认：成员/频道级 destructive-write 把 PostgreSQL 行删除误当成完整资源删除，遗漏数据库与本地文件系统之间的事务边界。相同 failure mode 存在于 Agent uploaded-by cascade、DM/channel 文件删除和消息附件删除。 |
| **4. 诊断策略** | 使用真实 disposable PostgreSQL 和真实临时 blob，通过认证 HTTP 路由删除 Agent/Channel；同时观察 `FileEntry`、原路径、quarantine 路径及强制 commit 失败后的回滚状态。 |
| **5. 超时策略** | 若批量文件补偿无法复用单文件 deletion contract，则停止扩大路由 patch，抽取一个共享的批量 quarantine transaction coordinator，再重新跑 RED。 |
| **6. 预警策略** | 任一方案若先提交 DB 再 best-effort unlink、吞掉 restore 失败、允许 unsafe path、或只修 Agent 而保留 Channel 同型漏洞，视为方向错误。 |
| **7. 用户可见交互修正** | 删除成功后相关 blob 不再占用服务端磁盘；若 post-commit purge 失败，响应明确报告 `storageCleanup=quarantined`，文件仍已移出可服务路径。 |
| **8. 验收** | 真实 PostgreSQL/HTTP：Agent 与 Channel 删除成功时元数据和原路径均消失；DB commit 失败时行和原 blob 一起恢复；批量中途 quarantine 失败不留下已移动的前序 blob；purge 失败只留下 `.deleted` 中的非服务文件并如实报告。 |

## 五件套

1. **报告人**：2026-07-23 审计整改 failure-mode sweep。
2. **复现步骤**：创建 Agent/Channel、FileEntry 和真实 `storage_path` 文件，调用对应 DELETE 路由；旧实现删除数据库行但原文件仍存在。
3. **根因分析**：破坏性写入跨越 PostgreSQL 与本地文件系统，但成员/频道删除路径没有采用单文件删除已经建立的补偿事务。
4. **修复方案**：增加共享的 parent-delete 文件枚举与批量补偿协调器。
   Agent 删除覆盖 `uploaded_by` cascade、DM Channel 和被删消息附件；Channel
   删除覆盖其全部 FileEntry。所有 blob 先原子移动到 `.deleted`，然后执行 DB
   删除/审计/commit；任何异常都 bounded rollback 并逆序恢复，commit 后逐个
   purge。相应 file SavedItem 同时显式删除。
5. **验证方式**：真实 disposable PostgreSQL、ASGI HTTP 与真实临时文件：原始
   RED 为 Agent/Channel 两条成功响应后 blob 仍存在，且强制 commit 回调看到原
   路径仍在；GREEN 为 `5 passed`，覆盖两种成功路径、commit rollback/restore、
   purge failure 的 `quarantined` 报告及批量第二项失败时恢复第一项。focused Ruff
   通过；既有 file-delete/authz/membership 回归 `103 passed`。
