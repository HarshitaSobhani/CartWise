# API reference

Base path `/api`. JSON in/out. Auth is an `HttpOnly` cookie (`cw_session`) set by login/register. Errors: `{ "error": string, "details"?: [{path,message}] }`. Unknown/foreign resource IDs return **404**.

## Auth
| Method & path | Body | Notes |
|---|---|---|
| `POST /auth/register` | `{email,name,password≥10}` | 201; first-time ADMIN if email in `ADMIN_EMAILS` |
| `POST /auth/login` | `{email,password}` | 401 on bad credentials |
| `POST /auth/logout` | – | 204 |
| `GET /auth/me`, `PATCH /auth/me` | `{name?,emailNotifs?,inAppNotifs?}` | role cannot be changed |

## Catalog (auth required)
- `GET /products?q&category&sourceId&sort=name|newest&page&pageSize≤60` → items with latest observation, `isDemo`, `freshness`, `otherCurrencies`.
- `GET /products/categories`
- `GET /products/:id` → product, `stats` (latest, change vs previous, lowest/highest *recorded*, freshness, currencies), `coverage` (per source+currency), caller’s `alerts` with target status.
- `GET /products/:id/history?days&currency&sourceId` → `{stats, points[]}` (stored observations only).
- `GET /products/compare?ids=a,b[,c,d]&currency=USD` → rows, `currencyMismatch`, `warning`, `cheapestProductId` (null unless ≥2 comparable prices).

## Private user data (`/me/*`, always scoped to the caller)
- Alerts: `GET/POST /me/alerts` `{productId,targetPrice,currency,notifyInApp,notifyEmail}`, `PATCH/DELETE /me/alerts/:id` (`status: ACTIVE|PAUSED`, `targetPrice`).
- Notifications: `GET /me/notifications`, `POST /me/notifications/:id/read`, `POST /me/notifications/read-all`.
- Wishlists: `GET/POST /me/wishlists`, `DELETE /me/wishlists/:id`, `POST /me/wishlists/:id/items {productId,priority1-5,note}`, `PATCH|DELETE /me/wishlists/:id/items/:itemId`.
- Budgets: `GET/POST /me/budgets {name,currency,limit}`, `PATCH|DELETE /me/budgets/:id`, `POST /me/budgets/:id/expenses {description,amount,spentAt?}`, `DELETE /me/budgets/:id/expenses/:expenseId`.

## Exports (`text/csv`, attachment, formula-injection-safe)
`GET /exports/wishlists.csv`, `/exports/alerts.csv`, `/exports/budgets.csv`, `/exports/price-history.csv?productId=` (rows carry `data_type` DEMO/CSV_IMPORT/EXTERNAL).
Cells starting with `= + - @ TAB CR` are prefixed with `'`.

## Admin (role ADMIN)
- `POST /admin/imports/preview {type: CSV_PRODUCTS|CSV_PRICES, filename, csv}` – dry run, returns counts, row errors (with line numbers) and first 20 rows. Writes nothing.
- `POST /admin/imports` same body → 202 `{import, jobId}`; processed by the queue.
- `GET /admin/imports`, `GET /admin/jobs?status=`, `POST /admin/jobs/:id/retry` (FAILED only), `GET /admin/sources`, `PATCH /admin/sources/:id {enabled}`, `POST /admin/sources/:id/refresh`, `GET /admin/data-quality`, `GET /admin/overview`.

### CSV formats
Products: `external_ref,name,category` required; optional `brand,description,image_url,gtin,sku`.
Prices: `external_ref,price,currency,observed_at` required; optional `source_url`. `price` ≤ 2 decimals, `currency` ISO-4217 code, `observed_at` ISO-8601 and not in the future. All rows must have the same number of columns as the header.
Limits: 2 MB, 5,000 rows. Row-level errors are kept (first 100) and shown in the Imports tab.
