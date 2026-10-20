# Deployment (manual, ordered)

Nothing here is automated or run for you.

1. Provision PostgreSQL ≥ 14 and Redis ≥ 6 (managed services recommended). Create a least-privilege DB user.
2. Generate secrets: `openssl rand -hex 32` → `JWT_SECRET`.
3. Set environment (see `.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN=https://<web origin>`, `COOKIE_SECURE=true`, `ADMIN_EMAILS=<your email>`; optional `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM`, `STALE_AFTER_HOURS`, `REFRESH_EVERY_MINUTES`.
4. Build: `npm run install:all && npm run build` (or build the Dockerfiles in `server/` and `web/`).
5. Migrate: `cd server && npx prisma migrate deploy` (never `migrate dev`/`reset` in production).
6. Start the API: `node dist/src/server.js` (behind TLS; `trust proxy` is set to 1).
7. Start ≥ 1 worker: `node dist/src/worker.js`.
8. Serve `web/dist` as static files, proxying `/api/*` to the API on the **same origin** (see `web/nginx.conf`). The `SameSite=Strict` cookie requires same-site hosting.
9. (Optional) Demo data: `npm run seed` – **skip in production** or delete demo users/products afterwards.
10. Register with the `ADMIN_EMAILS` address, then smoke-test: login, import `samples/products.csv` then `samples/prices.csv`, check Admin → Jobs.
11. Monitor `/api/health`, failed jobs, and the Data-quality tab.
