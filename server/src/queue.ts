import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { backoffMs, createRefreshJob, executeJob, MAX_ATTEMPTS, refreshBucket } from './services/jobs.js';
import { smtpMailer } from './services/mail.js';
import { listAdapters } from './adapters/registry.js';

export const QUEUE_NAME = 'cartwise-jobs';

let queue: Queue | null = null;
export const redisConfigured = Boolean(config.REDIS_URL);

function connection() {
  return { url: config.REDIS_URL! };
}

export function getQueue(): Queue | null {
  if (!config.REDIS_URL) return null;
  queue ??= new Queue(QUEUE_NAME, { connection: connection() });
  return queue;
}

/**
 * Hand a BackgroundJob to the queue. With Redis it is a BullMQ job whose id is the
 * idempotency key (so duplicate enqueues collapse) with limited exponential-backoff
 * retries. Without Redis (dev convenience) it runs in-process, once.
 */
export async function enqueueJob(jobId: string, idempotencyKey: string): Promise<void> {
  const q = getQueue();
  if (!q) {
    setImmediate(() => {
      executeJob({ db: prisma, mailer: smtpMailer }, jobId).catch((e) => logger.warn({ jobId }, `inline job failed: ${(e as Error).message}`));
    });
    return;
  }
  await q.add('run', { jobId }, { jobId: `${idempotencyKey.replace(/:/g, '_')}_${Date.now()}`, attempts: MAX_ATTEMPTS, backoff: { type: 'cartwiseBackoff' }, removeOnComplete: 500, removeOnFail: 1000 });
}

export async function queueStats() {
  const q = getQueue();
  if (!q) return { mode: 'inline' as const, counts: null };
  const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  return { mode: 'redis' as const, counts };
}

export function startWorker(): Worker {
  if (!config.REDIS_URL) throw new Error('REDIS_URL is required to run the worker');
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ jobId: string }>) => {
      await executeJob({ db: prisma, mailer: smtpMailer }, job.data.jobId);
    },
    { connection: new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }), concurrency: 2, settings: { backoffStrategy: (attempt: number) => backoffMs(attempt) } },
  );
  worker.on('failed', (job, err) => logger.warn({ jobId: job?.data.jobId, attempt: job?.attemptsMade }, `queue job failed: ${err.message.slice(0, 200)}`));
  return worker;
}

/** Enqueue a refresh for every enabled, adapter-backed source. Safe to call repeatedly. */
export async function scheduleRefreshes(now = new Date()): Promise<number> {
  const slugs = listAdapters().map((a) => a.slug);
  const sources = await prisma.source.findMany({ where: { slug: { in: slugs }, enabled: true } });
  let n = 0;
  for (const s of sources) {
    const { job, created } = await createRefreshJob(prisma, s.id, refreshBucket(now, config.REFRESH_EVERY_MINUTES));
    if (created) {
      await enqueueJob(job.id, job.idempotencyKey);
      n++;
    }
  }
  return n;
}
