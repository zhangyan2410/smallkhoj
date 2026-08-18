# 技术设计：产品 Runtime 写权限与双控制面验证

## 设计结论

这次不是一个“daemon 启动命令加 flag”的问题，而是两个相邻且可独立定位的合同缺口：

1. 后端向已连接 daemon 下发 Runtime 启动控制包时遗漏了写授权字段；
2. 本地 UI 生成的 npm 命令宣告了 `0.2.1` package，但本地静态目录没有该版本的 artifact。

前者是产品控制面回归，后者是本地真实验收的发布产物前置条件缺失。两者都必须在真实本地路径验证后，才进入云端验证。

## 边界与数据流

```text
本地 UI / 云端 UI
  └─ 生成一次性 connect ticket 与 aura 命令
       └─ npm 下载“该 Server 宣告版本”的 daemon package
            └─ daemon /daemon/connect（ticket 只使用一次）
                 └─ 本控制面写入 Computer + machine token + live lease
                      └─ 后端 start_runtime control envelope
                           └─ config.allowWrites=true（仅产品托管 Runtime）
                                └─ daemon Runtime env + .slock wrapper
                                     └─ 受控 slock message send
```

本地与云端各自完成整条链路；不得跨越数据库、ticket、Computer ID、machine identity 或 WebSocket。

## 代码合同

### 1. 后端控制包（唯一的产品默认开写点）

[`runtime_start_command()`](/Users/code/project/smallkhoj/backend/services/daemon_control.py:52) 构造 `config` 时加入：

```python
config["allowWrites"] = True
```

这是 Server 管理 Runtime 的产品策略。它不会改变：

- `runStart()` 对独立 CLI 的 `--allow-writes` 判断；
- daemon 在 `runtimeConfig.allowWrites` 和 daemon-level config 都为 false 时阻止写命令；
- 一次性 connect ticket、machine token 或 Computer lease 的权限模型。

### 2. daemon 合同无需扩大

daemon 已将 `start_runtime.config.allowWrites === true` 转化为 child Runtime 的 `SLOCK_ALLOW_WRITES=1`，也将它写入 `.slock/slock`、`aura`、`raft` wrappers。修复只补齐上游字段，并以动态 control 测试锁定这个跨进程合同。

### 3. 本地 package 前置条件

后端用 `daemon_release_version` 生成 package URL，FastAPI 将 `release-artifacts/smallkhoj-daemon` 挂载到 `/downloads/smallkhoj-daemon`。本地使用真实 UI 命令前，使用既有 [`scripts/build_daemon_distribution.py`](/Users/code/project/smallkhoj/scripts/build_daemon_distribution.py:389) 生成当前 `package.json` 版本的 ignored artifact；随后先检查 URL 为非空 `2xx`，再签发新的 ticket。

不以本机路径、`file:` npm URL 或手工 `node dist/...` 代替 UI 命令，因为那些做法会绕过产品分发合同。生产仍由现有 release pipeline 构建、上传并以 post-deploy smoke 验证 package；本次 cloud probe 已证明 `0.2.1` package 可达。

## 回归测试设计

| 层 | 失败前行为 | 预期保护 |
|---|---|---|
| Backend unit | control config 缺少字段 | 断言 `allowWrites is True`，并保留其它 runtime/provider 字段 |
| Daemon dynamic control integration | 后端样式 control payload 与 child env/wrapper 脱节 | 正向 payload 可发送、负向 payload 仍被拒绝 |
| Distribution/release | 路由存在但被宣告版本的 tarball 缺失 | 构建产物命名与 package version 的合同测试，以及本地真实 URL probe |
| Real local | 只看后台或 fake daemon | UI 命令 → isolated daemon → local Computer lease → start_runtime |
| Real cloud | 将本地成功误称为线上成功 | 测试 Computer 的 UI、daemon timeline、唯一 Agent ACK 同时存在 |

## 兼容性、发布与回滚

- daemon `0.2.1` 已支持 `allowWrites` config，所以云端修复只要求部署后端控制面；没有必要扩大到全局 daemon CLI 默认值。
- 如果后端部署需要回滚，回滚到当前后端会恢复 fail-closed 的产品 Runtime 行为；因此云端验证必须在实际部署版本上完成，不能由本地测试代替。
- 本地生成 artifact 是 ignored test setup。它可删后重建，不改变 Git 版本，也不会上传或覆盖云端 artifact。
- 云端开始一条 Runtime 前，先验证目标 Computer 当前 lease 与 package URL；若任何条件不满足，停止而不发模型 prompt。

## 不采用的方案

- **给 UI 命令追加 `--allow-writes`：** 会把直接 CLI Runtime 的安全策略一起放宽，且产品正常路径实际在 connect 后由 `start_runtime` 启动 Runtime。
- **只设置 shell 环境变量：** 不能覆盖后端已连接 daemon 的动态 control path。
- **让本地命令引用源码绝对路径：** 不可移植、泄露开发机路径，也绕过 npm artifact。
- **把本地 artifact 提交到仓库：** 生成物应由 release/test pipeline 构建并保持 ignored。
