# 方案：成员详情完整复用（members 页 + chat 侧栏共享所有 tab）

## 目标
chat 侧栏点击头像的成员详情，和 members 页的成员详情**完全一样**——包含所有 tab（profile/permissions/dms/reminders/workspace/apps/activity），共享同一套组件。

## 核心矛盾
- members 页 tab：server component + server actions（`<form action={...}>`）+ URL-based TabBar（`<Link href="/members?member=...&tab=...">`）
- chat 侧栏：client component + useState tab 切换
- 需要让同一套 tab 组件在两个 host 里都能工作

## 重构步骤

### 步骤 1：server actions 集中到 `members/actions.ts`

把 `page.tsx` 里的 8 个 `"use server"` 函数移到 `app/(app)/members/actions.ts`（已存在，已有 `controlMemberLifecycleAction`）：
- `updateAgentDescriptionAction` / `updateHumanAvatarUrlAction`（ProfileTab）
- `updatePermissionsAction` / `addPermissionEntryAction` / `removePermissionEntryAction` / `togglePermissionEntryAction`（PermissionsTab + AddPermissionForm）
- `deleteMemberAction`（MemberDetail header）

改动：去掉硬编码的 `redirect("/members?...")`，改为 `revalidateTag("member-detail")` 或保留 `revalidatePath("/members")`。chat 侧栏用 client fetch 刷新，members 页用 revalidate。

### 步骤 2：tab 元数据抽到 `lib/member-tabs.ts`

```ts
export type TabKey = "profile" | "permissions" | "dms" | "reminders" | "workspace" | "apps" | "activity"
export const TAB_KEYS: TabKey[] = [...]
export const TAB_LABEL_KEYS: Record<TabKey, string> = {...}  // i18n key
```

members 页和 chat 侧栏都 import。

### 步骤 3：6 个内联 tab 抽成共享 client 组件

新建 `components/member-tabs/` 目录，每个 tab 一个文件：
- `profile-tab.tsx`（含编辑表单，import actions from members/actions）
- `permissions-tab.tsx`（含 AddPermissionForm）
- `dm-tab.tsx`（纯展示）
- `reminders-tab.tsx`（纯展示）
- `workspace-tab.tsx`（纯展示，需 computers）
- `apps-tab.tsx`（纯展示）
- `activity-tab.tsx`（已有，从 members/activity-tab.tsx 移过来或 re-export）

每个 tab 统一用 `useTranslations("members")`（不用 `t` prop），参照 ActivityTab 模式。
ProfileTab 里用 `<MemberProfileCard>`（已建好）+ 编辑表单。

props 统一：`{ member: Member; computers?: Computer[]; canManageMembers?: boolean }`

### 步骤 4：共享 tab 内容容器 `components/member-detail-content.tsx`

```tsx
export function MemberDetailContent({ member, computers, canManageMembers, activeTab }) {
  return (
    <>
      {activeTab === "profile" && <ProfileTab member={member} computers={computers} canManageMembers={canManageMembers} />}
      {activeTab === "permissions" && <PermissionsTab member={member} />}
      ...
    </>
  )
}
```

members 页和 chat 侧栏都用这个。

### 步骤 5：两个 host 各自的 TabBar

- members 页：保持现有 URL-based TabBar（`<Link>`），不动
- chat 侧栏：新建 client TabBar（`useState<TabKey>` + button onClick）

### 步骤 6：MemberDetailPanel（chat 侧栏）改为完整 tab

```tsx
export function MemberDetailPanel({ member, onClose }) {
  const [activeTab, setActiveTab] = useState<TabKey>("profile")
  const [computers, setComputers] = useState<Computer[]>([])
  // fetch computers (已有)
  return (
    <aside ...>
      <ClientTabBar activeTab={activeTab} onChange={setActiveTab} />
      <MemberDetailContent member={member} computers={computers} activeTab={activeTab} />
    </aside>
  )
}
```

### 步骤 7：members 页 page.tsx 改用共享组件

`MemberDetail` 改成 import 共享的 `MemberDetailContent` + tab 组件，删掉内联的 tab 函数。TabBar 保持 URL-based 不变。

## 改动清单
| 文件 | 类型 | 说明 |
|---|---|---|
| `app/(app)/members/actions.ts` | 改 | 移入 8 个 server actions，去掉 redirect |
| `lib/member-tabs.ts` | 新建 | TabKey/TAB_KEYS/TAB_LABEL_KEYS |
| `components/member-tabs/profile-tab.tsx` | 新建 | client，含编辑表单 |
| `components/member-tabs/permissions-tab.tsx` | 新建 | client，含 AddPermissionForm |
| `components/member-tabs/dm-tab.tsx` | 新建 | client，纯展示 |
| `components/member-tabs/reminders-tab.tsx` | 新建 | client，纯展示 |
| `components/member-tabs/workspace-tab.tsx` | 新建 | client，需 computers |
| `components/member-tabs/apps-tab.tsx` | 新建 | client，纯展示 |
| `components/member-tabs/index.ts` | 新建 | re-export 所有 tab + ClientTabBar |
| `components/member-detail-content.tsx` | 新建 | 共享 tab 内容容器 |
| `components/member-detail-panel.tsx` | 改 | 加 tab 系统 + 用 MemberDetailContent |
| `app/(app)/members/page.tsx` | 改 | 删内联 tab，改用共享组件 + 共享 actions |
| `app/(app)/members/activity-tab.tsx` | 移动 | 移到 member-tabs/ 或 re-export |

## 约束
- server actions 可以在 client component 里通过 `<form action={importedAction}>` 调用（Next.js 支持），不需要额外的 API endpoint
- ProfileTab 的 `redirect("/members")` 要去掉——chat 侧栏不能跳走；用 `revalidatePath` + client 刷新代替
- PermissionsTab 的 `AddPermissionForm` 一起迁移（它依赖 3 个 action）
- members 页的 TabBar 保持 URL-based（不影响）；chat 侧栏新建 client TabBar
- `canManageMembers`：members 页从 session 计算；chat 侧栏从 channel-client 传入（channel-client 已有 `canManageServer`/`canManageChannelMembers`）
