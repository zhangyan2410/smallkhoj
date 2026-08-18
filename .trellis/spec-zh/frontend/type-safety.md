# 类型安全（type-safety）

> 前端的类型所有权与校验模式。

前端以 TypeScript 为先。在出现生成式/共享的 API 契约（contract）之前，共享的 API 类型放在 `frontend/lib/control-plane.ts`。路由文件可以定义局部视图模型，但不应发明与 `control-plane.ts` 漂移的重复 API 结构。

---

## 类型组织

| 类型种类 | 位置 | 示例 |
| --- | --- | --- |
| 跨页面复用的 API/资源结构 | `frontend/lib/control-plane.ts` | `Member`、`Computer`、`TaskRunTemplate` |
| 仅限路由的视图模型 | 路由文件或路由局部组件 | 任务页里的 `TaskEvidence` |
| 组件 props | 与组件同文件、靠近导出 | `ProductShellBody` 的 props |
| i18n 文案对象 | 带推断返回类型的路由辅助函数 | `type ComputersCopy = ReturnType<typeof makeComputersCopy>` |

不要在页面里创建 `Member`、`Computer`、runtime 状态或任务运行模板的第二份副本。

---

## API 响应规则

现有辅助函数返回带兜底默认值的类型化 JSON：

```ts
apiGet<{ members: Member[] }>("/api/v1/members", { members: [] })
```

在出现运行时 schema 之前，调用方必须：

- 为列表/详情端点提供安全兜底
- 对不保证存在的后端字段使用可选链
- 用默认视觉分桶处理未知枚举/状态字符串
- 不要把真假性的可选后端字段当作权威依据

如果 UI 决策涉及安全或破坏性操作，在渲染该操作前补上后端/API schema 或一个窄口径的运行时守卫。

---

## FormData 与搜索参数

server action 接收 `FormData`；在边界处规范化每个字段：

```ts
const memberId = String(formData.get("memberId") || "").trim()
if (!memberId) redirect("/members?error=Missing%20member")
```

搜索参数可能是 `string | string[] | undefined`；使用前先用辅助函数规范化一次。不要把原始 `searchParams.foo` 深传进组件。

---

## 禁止模式

- 对 API 响应、组件 props 或事件负载使用 `any`。
- 盲目断言，例如 `response.json() as Task[]`。
- 在多个页面里重复定义 API 类型。
- 用模板字符串从后端数据查 class/变体，例如 `` `sk-status-${status}` ``。应使用显式映射函数，如 `badgeClass()`、`dotClass()` 和 `statusLabel()`。
- 把整个翻译对象或函数密集的对象传过 server-to-client 边界。应传递纯字符串字段。

---

## 正确性检查清单（checklist）

- [ ] 复用时 API/资源类型从共享来源导入。
- [ ] 未知后端枚举/状态值渲染安全默认值。
- [ ] FormData 和 URL 参数在边界处规范化。
- [ ] 客户端组件 props 在跨 server-to-client 时可序列化。
- [ ] 没有 `any`、未检查的断言或重复的状态/颜色映射。
