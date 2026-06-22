# Real Test Evidence — i18n (next-intl, zh-CN default)

> Task: `06-22-06-22-frontend-i18n-core-pages`
> Date: 2026-06-22 (system clock)

## Changes

- Installed `next-intl@4.13.0`.
- `next.config.mjs`: wrapped with `createNextIntlPlugin("./i18n/request.ts")`.
- `i18n/config.ts`: client-safe locale constants (`locales`, `Locale`,
  `defaultLocale`, `LOCALE_COOKIE`).
- `i18n/request.ts`: server-only `getRequestConfig` — locale resolved per
  request from `smallkhoj_locale` cookie → `Accept-Language` → zh-CN default.
  Splitting constants into `config.ts` was required because the client
  `LanguageSwitcher` imports them; `next/headers` is server-only.
- `app/layout.tsx`: `NextIntlClientProvider` wraps children; `<html lang>`
  driven by detected locale.
- `messages/zh-CN.json` + `messages/en.json`: full key sets for
  `common` / `nav` / `home` / `chat` / `members` / `login` / `language`.
- `app/actions.ts`: `setLocaleAction` server action persists the cookie +
  revalidates + reloads.
- `components/language-switcher.tsx`: dropdown in `ProductShell` header.
- `components/product-shell.tsx`: now async; nav labels via `getTranslations("nav")`.
- Translated the 4 target pages: `app/login/page.tsx`, `app/page.tsx` (home),
  `app/members/page.tsx` (+ `AgentControls`, `create-agent-card.tsx`), and the
  chat sidebar headings in `app/chat/[channel]/channel-client.tsx`.

## Browser verification (`./twd`)

### Default zh-CN (home)

```
htmlLang         : "zh-CN"
greeting         : "你好，zy-ean 👋"
recentMsgTitle   : "近期消息"
activeAgentsTitle: "运行中的智能体"
```

### Switched to en (home)

```
htmlLang       : "en"
greeting       : "Hello, zy-ean 👋"
recentMsgTitle : "Recent Messages"
```

### Members + Chat in English (after en switch)

```
/members : title "Members", headings ["Agents","Humans","Member Groups"]
/chat    : sidebar headings ["Channels","DMs","Members Online",...]
```

### Members + Chat in Chinese (after zh-CN switch)

```
/members : headings ["智能体","人类","成员分组"]
/chat    : sidebar headings ["...","私信","在线成员",...]   (Channels/DMs/Members Online)
```

### Language switcher

- `#locale-select` present on every ProductShell surface (home/members/chat
  use ProductShell; chat builds its own shell so the switcher is reachable
  via the home/members header — confirmed working).
- Changing the select fires `requestSubmit()` → `setLocaleAction` → cookie
  set → `redirect("/")` → all pages re-render in the new locale.

### Screenshots

- `evidence/01-members-zh-CN.png` — Members page in Chinese
- `evidence/02-chat-zh-CN.png` — Chat sidebar in Chinese
- `evidence/03-home-en.png` — Home dashboard in English

## Quality gates

- `npm run lint` — clean
- `npx tsc --noEmit` — clean
- `npm run build` — succeeds (all 11 routes compiled); the server-only
  `next/headers` import in `i18n/request.ts` no longer leaks into client
  bundles after the config split.

## Out of scope (per PRD)

- Computers / Daemon / Settings pages left in English.
- Backend error messages not translated.
- No `[locale]` route segment — locale is request-scoped (cookie + header),
  so existing routes are unchanged.
