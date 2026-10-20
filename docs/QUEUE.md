# Queue, worker and jobs

- `BackgroundJob` rows are the source of truth (status, attempts, last error, result). BullMQ (queue `cartwise-jobs`) only delivers them.
- **Idempotency:** each job has a unique `idempotencyKey` (`import:<id>`, `refresh:<sourceId>:<interval bucket>`). A SUCCEEDED job is never re-run; observations deduplicate on `dedupeKey`; alerts dedupe on `(alertId, observationId)`.
- **Retries:** at most 3 attempts with exponential backoff (5 s, 10 s, 20 s … capped at 5 min). Permanent errors (malformed file, disabled source, missing adapter) fail immediately without retry. After exhaustion the job and its import are `FAILED` and visible in **Admin → Jobs & queue** / **Imports**, where an admin can **Retry**.
- **Failure logging:** `lastError` holds a truncated message with URLs/credentials redacted; pino also redacts secret-bearing fields.
- **Scheduler:** the worker enqueues a refresh for every enabled adapter-backed source at start and then every `min(REFRESH_EVERY_MINUTES, 60)` minutes; the job key is bucketed by `REFRESH_EVERY_MINUTES`, so extra ticks/duplicate workers do nothing.

## Running
```bash
cd server
REDIS_URL=redis://localhost:6379 npm run worker        # dev
npm run build && npm run start:worker                  # production (dist/src/worker.js)
```
Run one or more worker processes; the API must have the same `REDIS_URL` to enqueue. Without `REDIS_URL` the API runs jobs in-process (no retries across restarts, single node) – development only. Queue counts (`waiting/active/delayed/completed/failed`) appear in Admin → Jobs & queue.
