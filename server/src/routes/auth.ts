import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { asyncH, COOKIE, HttpError, parse, requireAuth, signToken } from '../http.js';

export const authRouter = Router();

const cookieOpts = { httpOnly: true, sameSite: 'strict' as const, secure: config.COOKIE_SECURE, maxAge: 7 * 86_400_000, path: '/' };

const publicUser = (u: { id: string; email: string; name: string; role: string; emailNotifs: boolean; inAppNotifs: boolean }) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, emailNotifs: u.emailNotifs, inAppNotifs: u.inAppNotifs,
});

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

authRouter.post('/register', asyncH(async (req, res) => {
  const body = parse(registerSchema, req.body);
  const isAdmin = config.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(body.email);
  try {
    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 12), role: isAdmin ? 'ADMIN' : 'USER', wishlists: { create: { name: 'My wishlist' } } },
    });
    res.cookie(COOKIE, signToken(user.id), cookieOpts).status(201).json({ user: publicUser(user) });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'An account with this email already exists');
    throw e;
  }
}));

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

authRouter.post('/login', asyncH(async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH); // constant-ish time
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
  res.cookie(COOKIE, signToken(user.id), cookieOpts).json({ user: publicUser(user) });
}));

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined }).status(204).end();
});

authRouter.get('/me', requireAuth, asyncH(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: publicUser(user) });
}));

authRouter.patch('/me', requireAuth, asyncH(async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1).max(100).optional(), emailNotifs: z.boolean().optional(), inAppNotifs: z.boolean().optional() }).strict(), req.body);
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
  res.json({ user: publicUser(user) });
}));
