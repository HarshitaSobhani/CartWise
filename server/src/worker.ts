import { startWorker, scheduleRefreshes } from './queue.js';
import { config } from './config.js';
import { logger } from './logger.js';

const worker = startWorker();
const tick = () => scheduleRefreshes().then((n) => logger.info(`scheduled ${n} refresh job(s)`)).catch((e) => logger.error(`schedule failed: ${(e as Error).message}`));
void tick();
const timer = setInterval(tick, Math.min(config.REFRESH_EVERY_MINUTES, 60) * 60_000);
logger.info('CartWise worker started');

const stop = async () => { clearInterval(timer); await worker.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
