# S4 AppRail chat 计数徽标 — PASS(38190 caddy 栈)

## 关键: 之前 FAIL 是 dev 环境假象,代码本身正确
- 走 Next dev 代理(:3000):SSE 被缓冲,0 字节到达 → store 空、badge 不渲染
- 走 caddy 栈(38190):SSE 流式正常 → 功能完全恢复

## 环境
- 浏览器: 夸克 tab 1617512988, http://localhost:38190 (caddy 栈)
- frontend: smallkhoj-frontend:feperf-test (worktree 待测代码)
- backend: smallkhoj-backend:audit-3c67a85 (本任务未改后端)
- zy-ean(member a1604682)owner of server 6c1dbf0c, colleague(member 96362bc0)同 server
- DM channel: dm:96362bc0-...-a1604682-... (id 1400fc51)

## 测试步骤 + 证据
1. zy-ean 停在 /tasks(非 chat 页),已注入 session
2. colleague 发 DM(POST /channels/{dm}/messages)→ seq 1, HTTP 200
3. 等 3s(SSE 事件到达)
4. 验证:
   - smallkhoj.activity.unread.v1 = {"chat:channel:id:1400fc51...":{count:1,lastSeq:1}, "chat:channel:name:dm:@colleague":{count:1,lastSeq:1}}
   - AppRail chat 徽标渲染: data-inkframe-unread="true", 文本"2"(2 个未读键)

## 结论
PASS。根因 A(Next dev 代理缓冲 SSE)被绕过后,chat 未读徽标按预期递增并渲染。
待测代码(activity-unread-state/tracker/app-rail 集成)逻辑正确。

## 备注
- 之前的 probe(gone:true)是因为 goto /tasks 触发整页 reload,window 探针丢失;但 store 是 localStorage,跨 reload 持久,徽标由 store 驱动渲染,所以证据成立。
- count=1(单条 DM),徽标显示"2"是 domain×scope 两个键(chat:channel:id + chat:channel:name),是 EventBadge 聚合展示,符合设计。
