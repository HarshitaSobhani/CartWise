import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { ValidationError } from './lib/money.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res, next).catch(next);
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
}
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const COOKIE = 'cw_session';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
}

export const requireAuth: RequestHandler = asyncH(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Authentication required');
  let sub: string;
  try {
    sub = (jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string }).sub;
  } catch {
    throw new HttpError(401, 'Invalid or expired session');
  }
  const user = await prisma.user.findUnique({ where: { id: sub }, select: { id: true, email: true, name: true, role: true } });
  if (!user) throw new HttpError(401, 'Invalid or expired session');
  req.user = user;
  next();
});

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') return next(new HttpError(403, 'Administrator access required'));
  next();
};

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues });
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  const e = err as { type?: string; status?: number };
  if (e.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (e.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
};

export const idParam = z.string().min(1).max(40);
