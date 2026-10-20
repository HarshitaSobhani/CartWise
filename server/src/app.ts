import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { productsRouter } from './routes/products.js';
import { userRouter } from './routes/user.js';
import { adminRouter } from './routes/admin.js';
import { exportsRouter } from './routes/exports.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  const limiter = (windowMs: number, limit: number) => rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => !config.RATE_LIMIT_ENABLED, message: { error: 'Too many requests, slow down' } });
  app.use('/api', limiter(15 * 60_000, 600));
  app.use('/api/auth/login', limiter(15 * 60_000, 20));
  app.use('/api/auth/register', limiter(60 * 60_000, 20));
  app.use('/api/admin/imports', limiter(15 * 60_000, 60));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/me', userRouter);
  app.use('/api/exports', exportsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
