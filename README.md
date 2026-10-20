# CartWise

Shopping-intelligence platform: compare products, follow **stored** price history, set target-price alerts, manage wishlists and budgets, import/export CSV, and monitor background jobs.

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS 3, Recharts
- **Backend:** Node 22, Express 4, TypeScript, Zod, Prisma 6, PostgreSQL 16
- **Queue/cache:** Redis 7 + BullMQ (optional in dev: without `REDIS_URL` jobs run in-process)
- **Tests:** Vitest, Supertest (API, real Postgres test DB), React Testing Library

> **Data honesty.** The bundled catalog is **synthetic demo data** from a clearly labelled demo provider and is shown with a “Demo data” badge everywhere. CartWise never fabricates current prices or “all-time lows”: lowest/highest values are the lowest/highest *recorded* observations. No retailer scraping is performed, no CAPTCHAs/access controls are bypassed, and no retailer adapters ship because none has a supported API configured. See [docs/SOURCE_ADAPTERS.md](docs/SOURCE_ADAPTERS.md).

## Quick start (Docker Compose)

```bash
docker compose up --build
# web: http://localhost:8080   api: http://localhost:4000/api/health
```

The API container runs `prisma migrate deploy` on start. Seed the demo catalog from the host against the compose database:

```bash
cd server && npm ci
DATABASE_URL=postgresql://cartwise:cartwise@localhost:5432/cartwise npm run seed
```

Demo logins (password `CartWise-Demo-2026`, override with `SEED_PASSWORD` **before seeding**):
`admin@cartwise.local` (admin) and `demo@cartwise.local` (regular user). Change or delete them for anything beyond local use.

> Docker was not available in the environment where this project was authored; the compose/Dockerfile setup is written but **not executed there**. See “Verification status” below.

## Local development without Docker

Prerequisites: Node ≥ 22, PostgreSQL ≥ 14, (optional) Redis ≥ 6.

```bash
cp .env.example server/.env            # edit DATABASE_URL, JWT_SECRET
npm run install:all
cd server
npx prisma migrate deploy              # or: npm run migrate:dev
npm run seed                           # demo catalog + demo users
npm run dev                            # API on :4000
npm run worker                         # (needs REDIS_URL) queue worker + scheduler
cd ../web && npm run dev               # UI on :5173 (proxies /api to :4000)
```

## Features → where to find them

| Feature | UI | API |
|---|---|---|
| Landing, auth | `/`, `/login`, `/register` | `/api/auth/*` |
| Catalog, search, category filters, details | `/app/catalog`, `/app/products/:id` | `GET /api/products` |
| Comparison (≤4 products, one currency) | `/app/compare` | `GET /api/products/compare` |
| Price history chart (range, currency) | product page | `GET /api/products/:id/history` |
| Target alerts, inbox, preferences | product page, `/app/alerts`, `/app/notifications`, `/app/settings` | `/api/me/alerts`, `/api/me/notifications` |
| Wishlists + priority | `/app/wishlists` | `/api/me/wishlists` |
| Budgets + expenses | `/app/budgets` | `/api/me/budgets` |
| CSV import (preview → import), jobs, retries, data quality | `/app/admin` (admins) | `/api/admin/*` |
| Exports (wishlists, alerts, budgets, price history) | buttons on each page | `/api/exports/*.csv` |

Sample CSVs are in [`samples/`](samples). Import `products.csv` first, then `prices.csv`.
Admin access: register with an email listed in `ADMIN_EMAILS`, or use the seeded admin.

## Key design decisions

- **Money** is `NUMERIC(14,2)`/Prisma `Decimal` end to end; prices are parsed strictly (≤ 2 decimals, never silently rounded).
- **Observations** record product, source, price, currency, `observedAt`, origin (`DEMO` / `CSV_IMPORT` / `EXTERNAL`), optional source ref/URL, and import id. A SHA-256 `dedupeKey` (unique) makes ingestion idempotent.
- **Currencies are never mixed.** Stats, comparisons, wishlist totals and alert checks work within one currency; a mismatch is surfaced as a warning. No conversion is applied.
- **Alerts** fire only for an actual stored observation in the alert’s currency at/below target that was recorded *after* the alert was armed. `UNIQUE(alertId, observationId)` prevents duplicate events; alerts are one-shot and can be re-armed.
- **Freshness**: data older than `STALE_AFTER_HOURS` (default 48) is flagged “Stale”.
- **Security**: bcrypt (cost 12), JWT in an `HttpOnly`, `SameSite=Strict` cookie, Zod validation, Helmet, rate limits, ownership checks on every private resource (other users’ IDs return 404), CSV size/row caps, formula-injection-safe CSV export, error messages scrubbed of credentials. Catalog imports are **admin-only** because the catalog is shared.

## Commands

| Purpose | Command |
|---|---|
| Lint / type-check / test / build everything | `npm run verify` |
| Server tests | `cd server && npm test` |
| Web tests | `cd web && npm test` |

Server tests use a dedicated database (`TEST_DATABASE_URL`, default `cartwise_test`), apply migrations automatically, and **refuse to run unless the DB name contains “test”**. Create it once: `createdb cartwise_test`.

## More documentation

- [API reference](docs/API.md)
- [Source adapters](docs/SOURCE_ADAPTERS.md)
- [Queue worker & jobs](docs/QUEUE.md)
- [Deployment](docs/DEPLOYMENT.md)

## Known limitations

- No real retailer adapters (by design; see adapters doc). External-price features beyond CSV/demo require you to add an adapter for a source you are licensed to use.
- No currency conversion.
- Email is optional and only attempted when SMTP is configured; delivery is best-effort and not retried.
- Auth has no password reset / email verification flow.
- Imports are admin-only and held in memory/DB (≤ 2 MB, 5,000 rows).
