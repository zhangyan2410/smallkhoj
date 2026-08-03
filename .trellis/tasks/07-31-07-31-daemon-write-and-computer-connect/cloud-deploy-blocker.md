# 云端部署阻塞：生产 PUBLIC_API_KEY 使用开发值（独立配置债）

## 发现时间
2026-07-31，尝试部署 allowWrites 修复到云端时发现。

## 现象
新 backend 镜像（基于 origin/main f54cf5c）在云端启动失败：
```
pydantic ValidationError: PUBLIC_API_KEY must not use the repository-known development value when DEBUG=false
```

## 根因（与 allowWrites 修复无关）
- commit `5749828`（2026-07-24, "fix(audit): 关键并发整改"）给 backend `config.py` 和 frontend `runtime-url.ts` 同时加了校验：生产环境（DEBUG=false / 非 local-dev）禁止使用仓库公开的开发值 `sk_public_local`。
- **云端生产 `.env.prod` 的 `PUBLIC_API_KEY` 与 `NEXT_PUBLIC_API_KEY` 一直是 `sk_public_local`**。
- 云端当前 backend 镜像（3 周前）构建于 5749828 之前，无此校验，所以一直能跑。
- frontend 镜像能跑是因为构建时 `NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev` 走了 `resolvePublicApiKey` 的 local-dev 分支绕过校验。
- 结论：**自 5749828 起，任何新 backend 镜像都无法在当前云端 env 启动**——7 天前埋下的雷。

## 影响面
- 阻塞所有 5749828 之后的 backend 部署（包括本次 allowWrites）。
- 生产 key 治理需要：生成真实生产 key → 重建 frontend（BuildKit secret 烧 key）→ 轮换所有已签发 connect ticket / machine token（key 变更使旧 token 失效）→ 影响所有在线 Computer/Agent。

## 校验合理性
合理。生产用仓库公开开发 key 是真实安全风险（任何人可用 `sk_public_local` 调 public API）。校验拒绝它是正确的安全加固，不应绕过。

## 本次处置
- allowWrites 修复**保留在 main**（已 push f54cf5c）：代码正确，本地真实 UI 双向回信验证充分。
- 云端 backend **已回滚**到旧镜像（`rollback-pre-allowwrites-20260731104911`）+ 旧 compose，`/api/health` 200，daemon WS 重连正常，生产稳定。
- 云端新增的 `PUBLIC_API_KEY` env 行、新 compose、新 backend 镜像均保留为回滚锚点，未删除。

## 建议后续独立任务
1. 生产 PUBLIC_API_KEY 治理：生成真实生产 key，更新云端 `.env.prod`（backend PUBLIC_API_KEY）。
2. 重建 frontend 镜像（BuildKit secret 烧入新 key，NEXT_PUBLIC_DEPLOYMENT_ENV=production）。
3. 评估 connect ticket / machine token 轮换影响（旧 key 签发的凭据失效）。
4. 部署 backend（含 allowWrites）+ 新 frontend，验证云端 Computer 收到 allowWrites:true control + Agent ACK。
5. 不要为了短期验证临时设 DEBUG=true 或绕过该校验。

## 关联
- allowWrites 任务：`07-31-07-31-daemon-write-and-computer-connect`
- 引入校验的 commit：`5749828`（backend `config.py:validate_public_api_key`、frontend `runtime-url.ts:resolvePublicApiKey`）
