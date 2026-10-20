import type { PrismaClient } from '@prisma/client';
import { Decimal, type DecimalValue } from '../lib/money.js';
import { logger, safeErrorMessage } from '../logger.js';
import type { Mailer } from './mail.js';

export type TargetStatus = 'no-data' | 'currency-mismatch' | 'above-target' | 'met';

/** Pure: is the target met by the latest observation in the alert's currency? */
export function targetStatus(target: DecimalValue, currency: string, observations: { price: DecimalValue; currency: string; observedAt: Date }[]) {
  const sameCur = observations.filter((o) => o.currency === currency).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  if (!sameCur.length) return { status: (observations.length ? 'currency-mismatch' : 'no-data') as TargetStatus, latestPrice: null as string | null, gap: null as string | null };
  const latest = new Decimal(sameCur[0].price);
  const t = new Decimal(target);
  return { status: (latest.lte(t) ? 'met' : 'above-target') as TargetStatus, latestPrice: latest.toFixed(2), gap: latest.minus(t).toFixed(2) };
}

/**
 * Evaluate ACTIVE alerts against stored observations. An alert fires only for a
 * real observation (a) in the alert's currency, (b) at or below the target and
 * (c) recorded after the alert was armed. The unique (alertId, observationId)
 * constraint guarantees one notification per event even under concurrent runs.
 * Alerts are one-shot: after firing they become TRIGGERED until re-armed.
 */
export async function evaluateAlerts(db: PrismaClient, opts: { productIds?: string[]; mailer?: Mailer | null } = {}) {
  const alerts = await db.targetAlert.findMany({
    where: { status: 'ACTIVE', ...(opts.productIds ? { productId: { in: opts.productIds } } : {}) },
    include: { user: true, product: { select: { name: true } } },
  });
  let created = 0;
  for (const alert of alerts) {
    const hit = await db.priceObservation.findFirst({
      where: { productId: alert.productId, currency: alert.currency, price: { lte: alert.targetPrice }, createdAt: { gte: alert.armedAt } },
      orderBy: [{ price: 'asc' }, { observedAt: 'desc' }],
      include: { source: { select: { name: true, isDemo: true } } },
    });
    if (!hit) continue;
    const label = hit.source.isDemo || hit.origin === 'DEMO' ? ' (demo data)' : '';
    let eventId: string;
    try {
      const ev = await db.$transaction(async (tx) => {
        const e = await tx.notificationEvent.create({
          data: {
            userId: alert.userId,
            alertId: alert.id,
            observationId: hit.id,
            inApp: alert.notifyInApp && alert.user.inAppNotifs,
            title: `Target reached: ${alert.product.name}`,
            body: `${hit.currency} ${new Decimal(hit.price).toFixed(2)} observed ${hit.observedAt.toISOString()} via ${hit.source.name}${label}; your target was ${alert.currency} ${new Decimal(alert.targetPrice).toFixed(2)}.`,
          },
        });
        await tx.targetAlert.update({ where: { id: alert.id }, data: { status: 'TRIGGERED' } });
        return e;
      });
      eventId = ev.id;
      created++;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue; // already notified for this event
      throw e;
    }
    if (opts.mailer && alert.notifyEmail && alert.user.emailNotifs) {
      try {
        const ev = await db.notificationEvent.findUniqueOrThrow({ where: { id: eventId } });
        await opts.mailer(alert.user.email, ev.title, ev.body);
        await db.notificationEvent.update({ where: { id: eventId }, data: { emailedAt: new Date() } });
      } catch (e) {
        logger.warn({ err: safeErrorMessage(e), alertId: alert.id }, 'email notification failed');
      }
    }
  }
  return { evaluated: alerts.length, created };
}
