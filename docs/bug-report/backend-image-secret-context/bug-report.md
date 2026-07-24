# Backend image build context may include local env secrets

## Bug 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| **1. 现象** | backend Dockerfile 从仓库根构建并执行 `COPY backend/ ./`，但生效的根 `.dockerignore` 未排除 `backend/.env` 或其他嵌套 `.env.*`。开发机存在本地 env 时，值会进入镜像层。 |
| **2. 证据** | `backend/Dockerfile` 同时需要根级 `backend/` 与 `release-artifacts/`，所以 `backend/.dockerignore` 不参与该 build；根 `.dockerignore` 当前无 `.env` 规则。当前整改 worktree 不存在根/后端 env，已构建镜像没有确认的现实泄漏。 |
| **3. 问题假设或根因** | 根因已确认：frontend 有自己的 context/ignore 契约，但 backend 后来改为根 context 以打包 Daemon release artifacts，没有把 secret exclusion 同步到根 `.dockerignore`。 |
| **4. 诊断策略** | 对照 Dockerfile 的真实 context 与两个 `.dockerignore`；增加 delivery contract，明确根 context 必须忽略任意层级 `.env`/`.env.*`，仅允许无秘密的 `.env.example`。 |
| **5. 超时策略** | 若 Docker ignore 语义需要复杂模拟，不在此轮实现解析器；采用明确的递归 pattern，并通过真实候选镜像内容扫描补强。 |
| **6. 预警策略** | 不允许把真实 secret sentinel 写入仓库或命令输出；若需要真实 env 才能验证，停止并改用临时 build context。 |
| **7. 用户可见交互修正** | 无 UI 变化。后续本地/CI backend 镜像构建不会复制开发 env 文件。 |
| **8. 验收** | delivery contract 先因根 ignore 规则缺失而 RED；加入最小递归 ignore 后 GREEN；重建候选 image，并扫描 image filesystem 不含 `.env` 文件或本地 secret 值。 |

## 1. 报告人

2026-07-23，本地生产形态重建时由 Codex/并行审查发现。

## 2. 复现步骤

1. 注意正式命令从仓库根运行 `docker build -f backend/Dockerfile .`。
2. `backend/Dockerfile` 执行 `COPY backend/ ./`。
3. 根 `.dockerignore` 没有 `.env` 排除，而 `backend/.env` 通常只被 Git ignore。
4. 因而该文件会属于 COPY 输入并进入镜像层。

## 3. 根因分析

Daemon 下载产物要求 Docker build context 上移到仓库根；安全排除规则仍只存在于 frontend
自己的 context，backend root-context contract 未一起更新。

## 4. 修复方案

- 根 `.dockerignore` 排除任意目录深度的 `.env` 与 `.env.*`；
- 显式允许 `.env.example` 这类无秘密模板；
- 在 delivery contract 中锁定 Dockerfile root-context 与 ignore pattern 的组合；
- 不改 Dockerfile context、不把 release artifacts 搬进源码目录。

## 5. 验证方式

- `python -m unittest scripts.tests.test_delivery_contract` RED/GREEN；
- 当前 backend image 重建；
- 镜像 filesystem 文件名扫描及临时 secret exact-value 扫描；
- 最终 scripts 全量门禁。
