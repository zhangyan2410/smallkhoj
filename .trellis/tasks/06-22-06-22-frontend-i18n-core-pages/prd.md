# Frontend i18n — Chinese Default, Core Pages

## Goal

Add `next-intl` internationalization with Chinese (zh-CN) as default locale, English (en) as opt-in. Cover the 4 pages most visible in the promo video: Chat, Members, Home, Login.

## Confirmed Decisions (design session 2026-06-22)

- Framework: `next-intl`
- Default locale: `zh-CN`
- Optional locale: `en`
- Scope: Chat (channel + DM), Members, Home/Dashboard, Login
- Computers/Daemon/Settings can stay English for now

## Requirements

### Setup

- Install `next-intl` (exact version, pin to latest stable)
- Create `messages/zh-CN.json` and `messages/en.json`
- Configure `next-intl` in `next.config.*` and create `i18n/request.ts`
- Add locale detection: use `Accept-Language` header, fall back to `zh-CN`
- Add language switcher component (simple dropdown, top-right of ProductShell header or settings page)

### Translation Keys — zh-CN

Cover all user-visible strings in the 4 target pages. Key namespaces:

- `common`: buttons (保存, 取消, 删除, 刷新, 发送), status labels, empty states
- `chat`: channel title, DM title, compose placeholder, tab labels (聊天/任务/文件/动态)
- `members`: page title, section headings (成员, 智能体, 人类), tab labels (档案/权限/工作区/活动), field labels
- `home`: greeting, panel titles (运行中的智能体, 近期消息, 待处理任务)
- `login`: form labels, button

### Components to update

- `ProductShell`: nav labels (聊天/任务/成员/电脑/动态)
- `channel-client.tsx`: all hardcoded strings in chat UI
- `members/page.tsx`: all hardcoded strings
- `app/page.tsx` (home dashboard)
- `app/login/page.tsx`

### Non-goals for this task

- Do NOT translate Computers, Daemon, Settings pages
- Do NOT translate error messages from the backend API (they stay as-is)

## Acceptance Criteria

- [ ] `next-intl` installed and configured; `npm run build` succeeds
- [ ] Default locale is `zh-CN`; Chat, Members, Home, Login render in Chinese with no English strings visible
- [ ] Switching to `en` renders all 4 pages in English
- [ ] Language switcher is accessible from the UI
- [ ] No TypeScript errors from missing translation keys
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`: Chinese text visible on chat and members pages

## Out of Scope

- Computers, Daemon, Settings pages
- Backend error message translation
- RTL support

## Dependencies

- `06-22-frontend-visual-redesign-theme` (home dashboard page exists before translating it)
- `06-22-frontend-home-dashboard`
- `06-22-frontend-members-page-redesign`
