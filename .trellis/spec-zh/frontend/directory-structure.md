# 前端目录结构

> 前端代码如何组织。与 `component-guidelines.md` 中的三层组件模型直接对应。两份文档请一起阅读。

---

## 概览

前端是位于 `frontend/` 的 Next.js App Router 应用。目录布局强制执行组件分层：**文件放在哪里，决定了它能 import 什么、能样式化什么。**

```
frontend/
├── app/                          # Layer 3 — Pages & routes (App Router)
│   ├── layout.tsx                #   root layout (html/body/intl/theme) — public, no auth
│   ├── (app)/                    #   route group (URL-less) — authenticated app shell
│   │   ├── layout.tsx            #     mounts chrome ONCE: rail + AppDeskBackground +
│   │   │                          #     InkMaterialRuntimeScript + requireCurrentAccount()
│   │   ├── page.tsx              #   Home / search dashboard
│   │   ├── tasks/                #   Tasks route (three-column)
│   │   ├── members/              #   Members route
│   │   ├── computers/            #   Computers route
│   │   ├── chat/                 #   Chat route (channel-client + sidebar)
│   │   ├── control/              #   Control plane / observability
│   │   ├── settings/, daemon/, dm/
│   ├── login/, join/[token]/     #   public routes — OUTSIDE (app), no shell, no auth gate
│   └── globals.css               #   Layer 0 — tokens & utilities (THE source of truth)
│
├── components/                   # Layer 2 — Product primitives (compose atoms + product semantics)
│   ├── app-rail.tsx              #   icon rail (client): active from usePathname(), ServerSwitcher
│   ├── product-shell.tsx         #   body-only shell: header + three-column body (P2 slimmed)
│   ├── product-shell-body.tsx    #   client body: resizable list column + main + sidebar
│   ├── product-ui.tsx            #   StatusPill, RuntimeChip, Toolbar, EmptyState, ProductRow
│   ├── task-board.tsx            #   task board/list (composes Card, StatusPill)
│   ├── task-list-panel.tsx       #   three-column Col 1 list
│   ├── task-form-dialogs.tsx     #   create/update dialogs (composes Dialog, Select)
│   ├── message-frame.tsx         #   chat message row
│   ├── realtime-refresh.tsx      #   SSE-driven router refresh
│   ├── language-switcher.tsx
│   ├── ...
│   │
│   └── ui/                       # Layer 1 — Atoms (NO product knowledge, own base styling)
│       ├── button.tsx            #   <Button> + buttonVariants cva
│       ├── card.tsx              #   <Card> + CardHeader/Title/Content/Footer
│       ├── input.tsx             #   <Input>
│       ├── form.tsx              #   <FieldLabel>, <Select>, <Textarea>
│       ├── panel.tsx             #   <Panel>, <PanelTitle> (borderless-density block)
│       ├── dialog.tsx            #   <Dialog> + parts
│       ├── avatar.tsx            #   <Avatar>
│       └── scroll-area.tsx
│
├── hooks/                        # Reusable client hooks
│   └── use-resizable-panel.ts    #   pointer/keyboard resize + localStorage
│
├── lib/                          # Framework-agnostic logic & single-source helpers
│   ├── control-plane.ts          #   API client + types + statusKind()/badgeClass()/dotClass()
│   ├── server-auth.ts            #   server-side session
│   ├── realtime-events.ts        #   SSE connection
│   ├── agent-color.ts            #   agent identity color from id
│   ├── smallkhoj-agent-avatar.ts #   Croodles-style avatar SVG generator
│   └── utils.ts                  #   cn() and misc
│
├── messages/                     # i18n strings (en.json etc.)
└── public/                       # static assets
    └── rail-water-texture.png    #   LEGACY: unreferenced since the rail became a
                                  #   paper binding spine (see product-ui-style.md);
                                  #   safe to delete in a cleanup pass
```

---

## 导入规则（由分层强制执行）

| 层 | 可以导入 | 不可以导入 |
|---|---|---|
| **Layer 0**（globals.css token） | 什么都不能导入（它本身就是来源） | — |
| **Layer 1**（`components/ui/*`） | token（通过 CSS 变量）、`lib/utils` | 任何 `components/*`（非 ui）、`lib/control-plane`、app 代码 |
| **Layer 2**（`components/*`） | Layer 1 原子组件、token、`lib/*` | `app/*` 页面内部实现 |
| **Layer 3**（`app/*`） | Layer 1 + 2、`lib/*`、`hooks/*` | 在本地重复定义样式/组件 |

一个 Layer 1 原子组件如果需要 `badgeClass()`，就是危险信号——产品语义正在向下泄漏。要么把概念上提，要么把解析好的 class 作为 prop 传入。

---

## 新代码放哪里

| 你在添加…… | 它应该放进…… |
|---|---|
| 新的 token / 工具类 | `app/globals.css`（Layer 0） |
| 通用样式元素（无产品语义） | `components/ui/`（Layer 1） |
| 带产品语义的组合组件（用到 status/runtime/task 概念） | `components/`（Layer 2） |
| 可复用的客户端行为（缩放、防抖、请求） | `hooks/` |
| 纯辅助函数 / 类型 / API 映射 | `lib/` |
| 只被一个路由使用的东西 | 内联在该路由的页面里；如果膨胀了，放 `components/<feature>/` |
| 新的需登录路由 | 放在 `app/(app)/` 下，以继承共享 shell + 认证（auth）门禁 |
| 新的公开路由（无需登录，例如落地页/邀请页） | 直接放在 `app/` 下（不要放进 `(app)/`） |

### `(app)` 路由组

`app/(app)/layout.tsx` 是**需登录的应用外壳**。Next 的路由组不出现在 URL 中，因此把路由移入 `(app)/` 不会改变它的 URL——只会让它继承这个 layout，后者在整个会话（session）中**只挂载一次**工作台外壳（图标栏 + `AppDeskBackground` + `InkMaterialRuntimeScript`）并调用 `requireCurrentAccount()`。这就是切换页面不再重建外壳的原因。公开页面（`/login`、`/join/[token]`）必须留在 `(app)/` 之外，否则会突然要求认证，还多出一条本不该有的侧栏。

---

## 命名约定

- **文件**：组件用 `kebab-case.tsx`（`task-list-panel.tsx`）；库/hook 用 `kebab-case.ts`。
- **组件**：`PascalCase`（`StatusPill`、`ProductShell`）。
- **hook**：`use-thing.ts` 导出 `useThing`。
- **token**：`--kebab-case` CSS 变量（`--sand-deep`、`--success-fg`）。
- **工具类**：手工系统类用 `sk-*` 前缀（`sk-panel`、`sk-status-success`）。

---

## `globals.css` 契约（contract）

`app/globals.css` 持有**全部**设计 token 和手工工具类。它是唯一一个把颜色/圆角/阴影定义为具体值的文件，其他一切都引用它们。

globals.css 内部结构：
1. `@theme inline` — Tailwind 主题映射（字体、断点）。
2. `:root` — 亮色主题 token（background、primary、ink、sand*、success* 等）。
3. `.dark` — 暗色主题覆盖（同名 token）。
4. `@layer utilities` — 手工类（`sk-*`、`bg-sand-*`、`bg-success` 等）。
5. `@layer components` — `.sk-rail*`（纸质书脊式侧栏；水材质质感已退役，`public/rail-water-texture.png` 是无引用的遗留资产）、调整手柄、基础样式。

除非确实是全应用通用的工具，否则**不要**在这里添加组件特定样式。组件样式应写在组件里（用 Tailwind 类），确有必要时才用同目录的 CSS module。
