This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Daemon MVP API + WebSocket

This project includes a daemon protocol MVP with in-memory store and real-time WebSocket push.

### Startup Modes

| Command | HTTP | WebSocket | Notes |
|---|---|---|---|
| `npm run dev` | ✅ | ❌ | Standard Next.js dev server; **no WebSocket** |
| `npm run start` | ✅ | ❌ | Standard Next.js production server; **no WebSocket** |
| `npm run server:dev` | ✅ | ✅ | Custom server (Next.js + WS); use for **Phase 3 dev** |
| `npm run server` | ✅ | ✅ | Custom server (Next.js + WS); use for **Phase 3 production** |

> ⚠️ **Important**: Phase 3 WebSocket requires the custom server (`server.ts`). `npm run dev` / `npm run start` will NOT enable WebSocket connections because they use the standard Next.js server without the `ws` upgrade handler.

### Why a Custom Server?

The daemon MVP API routes (`/internal/agent-api/*`) share an in-memory store. WebSocket connections must be on the same HTTP server to access this store. A separate WS process cannot share memory with Next.js API routes, so `server.ts` integrates both on the same port.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
