import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { evaluateAlerts, targetStatus } from '../src/services/alerts.js';
import { addObs, makeProduct, makeSource, register, resetDb } from './helpers.js';

beforeEach(resetDb);

async function setup() {
  const s = await makeSource();
  const p = await makeProduct(s.id, 'p1', 'Test Gadget');
  const { agent, user } = await register('a@example.com');
  return { s, p, agent, user };
}

describe('target status (pure)', () => {
  const d = (price: string, currency = 'USD') => ({ price, currency, observedAt: new Date('2026-01-01') });
  it('classifies', () => {
    expect(targetStatus('50', 'USD', []).status).toBe('no-data');
    expect(targetStatus('50', 'USD', [d('40', 'EUR')]).status).toBe('currency-mismatch');
    expect(targetStatus('50', 'USD', [d('60')]).status).toBe('above-target');
    expect(targetStatus('50', 'USD', [d('50')]).status).toBe('met');
  });
});

describe('alert evaluation', () => {
  it('does not fire without a qualifying observation', async () => {
    const { s, p, agent } = await setup();
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD' }).expect(201);
    await addObs(p.id, s.id, '60', '2026-01-01T00:00:00Z');
    expect((await evaluateAlerts(prisma)).created).toBe(0);
    expect(await prisma.notificationEvent.count()).toBe(0);
  });

  it('does not fire for a different currency even if the number is lower', async () => {
    const { s, p, agent } = await setup();
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD' }).expect(201);
    await addObs(p.id, s.id, '10', '2026-01-01T00:00:00Z', 'EUR');
    expect((await evaluateAlerts(prisma)).created).toBe(0);
  });

  it('does not fire from an observation recorded before the alert was armed', async () => {
    const { s, p, agent } = await setup();
    await addObs(p.id, s.id, '40', '2026-01-01T00:00:00Z');
    await new Promise((r) => setTimeout(r, 15));
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD' }).expect(201);
    expect((await evaluateAlerts(prisma)).created).toBe(0);
    const list = await agent.get('/api/me/alerts');
    expect(list.body.alerts[0].target.status).toBe('met'); // visible as status, but no notification
  });

  it('fires once for a real qualifying observation and never duplicates', async () => {
    const { s, p, agent } = await setup();
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD' }).expect(201);
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '45.50', '2026-01-02T00:00:00Z');
    const [a, b] = await Promise.all([evaluateAlerts(prisma), evaluateAlerts(prisma)]);
    expect(a.created + b.created).toBe(1);
    expect(await prisma.notificationEvent.count()).toBe(1);
    expect((await evaluateAlerts(prisma)).created).toBe(0);
    const inbox = await agent.get('/api/me/notifications');
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.notifications[0].body).toContain('45.50');
    expect(inbox.body.notifications[0].body).toContain('demo data');
    const alert = await prisma.targetAlert.findFirstOrThrow();
    expect(alert.status).toBe('TRIGGERED');
  });

  it('a re-armed alert only reacts to newer observations', async () => {
    const { s, p, agent } = await setup();
    const created = await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD' });
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '45', '2026-01-02T00:00:00Z');
    await evaluateAlerts(prisma);
    await new Promise((r) => setTimeout(r, 15));
    await agent.patch(`/api/me/alerts/${created.body.alert.id}`).send({ status: 'ACTIVE' }).expect(200);
    expect((await evaluateAlerts(prisma)).created).toBe(0);
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '44', '2026-01-03T00:00:00Z');
    expect((await evaluateAlerts(prisma)).created).toBe(1);
    expect(await prisma.notificationEvent.count()).toBe(2);
  });

  it('respects notification preferences: hides in-app event when disabled', async () => {
    const { s, p, agent } = await setup();
    await agent.patch('/api/auth/me').send({ inAppNotifs: false }).expect(200);
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD' });
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '45', '2026-01-02T00:00:00Z');
    await evaluateAlerts(prisma);
    expect((await agent.get('/api/me/notifications')).body.notifications).toHaveLength(0);
  });

  it('emails only when user and alert opt in and a mailer is configured', async () => {
    const { s, p, agent } = await setup();
    await agent.patch('/api/auth/me').send({ emailNotifs: true });
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD', notifyEmail: true });
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '45', '2026-01-02T00:00:00Z');
    const mailer = vi.fn().mockResolvedValue(undefined);
    await evaluateAlerts(prisma, { mailer });
    expect(mailer).toHaveBeenCalledOnce();
    expect(mailer.mock.calls[0][0]).toBe('a@example.com');
    expect((await prisma.notificationEvent.findFirstOrThrow()).emailedAt).not.toBeNull();
  });

  it('does not email without a mailer, and a failing mailer does not break the alert', async () => {
    const { s, p, agent } = await setup();
    await agent.patch('/api/auth/me').send({ emailNotifs: true });
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '50', currency: 'USD', notifyEmail: true });
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '45', '2026-01-02T00:00:00Z');
    const res = await evaluateAlerts(prisma, { mailer: vi.fn().mockRejectedValue(new Error('smtp down')) });
    expect(res.created).toBe(1);
    expect((await prisma.notificationEvent.findFirstOrThrow()).emailedAt).toBeNull();
  });
});
