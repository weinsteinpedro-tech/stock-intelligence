<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Commands

- `npm run dev` — Turbopack dev server
- `npm run build` — Turbopack production build
- `npm run lint` — ESLint flat config (do NOT use `next lint`, removed in v16)
- `npx next typegen` — generate `PageProps`, `LayoutProps`, `RouteContext` helpers

No tests. No CI. Run lint + build after significant changes.

## Project

**Stock Intelligence** — web app to search stocks, build a watchlist, view historical data/indicators, and use Gemini for AI-powered analysis of factors affecting future performance.

### V1 Features

Dashboard, stock search, watchlist, stock detail page, historical chart, financial indicators, Gemini analysis, analysis history.

### Stack

Next.js 16 App Router, TypeScript, Tailwind CSS v4, Recharts, Zod, Supabase/PostgreSQL, Alpha Vantage API, Gemini API, Vercel.

### Architecture Rules

- API keys server-side only (route handlers / server actions). Never expose to client.
- Use a `MarketDataProvider` interface to decouple Alpha Vantage — enables swapping data sources.
- Financial calculations in TypeScript, deterministic — Gemini does NOT generate prices or metrics.
- Gemini analyzes risks, catalysts, news, scenarios. Never give direct buy/sell recommendations.
- Keep architecture simple, minimal dependencies.

### Next.js 16 Essentials

- **Async Request APIs**: `cookies()`, `headers()`, `params`, `searchParams` are async. Use `PageProps<'/path'>` / `LayoutProps<'/path'>`.
- **`middleware` → `proxy`**: rename file and export.
- **Turbopack default**: custom `webpack` configs need `--webpack` flag or will fail.
- **`serverRuntimeConfig`/`publicRuntimeConfig` removed**: use env vars + `NEXT_PUBLIC_` prefix.
- Path alias: `@/*` → project root.

### Conventions

- App directory: `app/` exclusively (no `pages/`)
- Tailwind v4: `@import "tailwindcss"` + `@theme inline` in CSS (no `tailwind.config.js`)
