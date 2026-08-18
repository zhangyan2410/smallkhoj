# 生产 API 密钥治理与云端部署验证

## Goal

治理生产环境 `PUBLIC_API_KEY` 配置（替换开发值、建立正式密钥的生成与保管方式），
然后在云端服务器完成一次真实的 reset/deploy/smoke，把 2026-07 已合入 main 的
daemon 写权限与 computer connect 修复真正发布上线。

## Background

- 来源：`archive/2026-08/07-31-07-31-daemon-write-and-computer-connect`（2026-08-18 用户拍板归档时派生）。
- 本地修复（`2faa691`，start_runtime allowWrites）与本地闭环验证已全部通过。
- 云端验证被配置债阻塞：`5749828` 引入的校验拒绝开发值 `PUBLIC_API_KEY`，云端已回滚旧镜像。
- 详细阻塞记录见归档任务内 `cloud-deploy-blocker.md`。

## Requirements

1. 生产 `PUBLIC_API_KEY` 的正式值生成/轮换方案（谁能生成、存在哪、如何注入云端，不含明文提交）。
2. 云端按现有部署链路执行 reset + deploy（腾讯灯塔 124.222.40.40）。
3. 部署后 smoke：daemon 注册、computer connect、runtime 写权限、DM 回复链路各验证一次。

## Acceptance Criteria

- [ ] 生产密钥治理方案有文档记录，密钥明文不出现在仓库
- [ ] 云端完成一次 reset/deploy，运行版本为当前 main 构建
- [ ] smoke 四项（daemon 注册 / connect / 写权限 / DM 回复）全部通过并留证据
- [ ] 归档时记录云端部署的 commit 与验证证据

## Notes

- 部署脚本链参考：`scripts/production_image_transfer.py`、`make_deployment_bundle.py`、`post_deploy_smoke.py`。
- 不要触发 GitHub CI 等待，按 local fast path 惯例执行。
