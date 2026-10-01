// Métricas del Scope Canvas: tiempo de cierre de mesa, adopción de funciones, eficiencia del personal e incidentes.
import type { MetricsDTO, PaymentKind, PaymentMethod } from '../../shared/types.ts';
import { computeConsumption } from './consumption.ts';
import { Ledger } from './ledger.ts';
import type { DB } from './model.ts';

const seconds = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const pct = (part: number, total: number) => (total === 0 ? null : (part / total) * 100);

export function computeMetrics(db: DB): MetricsDTO {
  const ledgers = new Map(db.sessions.map((s) => [s.id, new Ledger(db, s.id)]));
  const closed = db.sessions.filter((s) => s.status === 'CLOSED');

  const closeTimes = db.sessions
    .filter((s) => s.firstPaymentAt && s.settledAt)
    .map((s) => seconds(s.firstPaymentAt!, s.settledAt!));
  const sessionMinutes = closed.filter((s) => s.closedAt).map((s) => seconds(s.openedAt, s.closedAt!) / 60);
  const tickets = closed.map((s) => ledgers.get(s.id)!.summary().paid).filter((paid) => paid > 0);

  const paid = db.payments.filter((p) => p.status === 'PAID');
  let revenue = 0;
  let tips = 0;
  for (const p of paid) {
    const ledger = ledgers.get(p.sessionId)!;
    revenue += ledger.paymentAmount(p);
    tips += ledger.tipAmount(p);
  }

  const paymentsByKind: Record<PaymentKind, number> = { ITEMS: 0, SPLIT: 0 };
  const paymentsByMethod: Record<PaymentMethod, number> = { MERCADO_PAGO: 0, QR: 0, POSNET: 0, CASH: 0 };
  for (const p of paid) {
    paymentsByKind[p.kind]++;
    if (p.method) paymentsByMethod[p.method]++;
  }
  const paidItemPayments = paid.filter((p) => p.kind === 'ITEMS' && p.dinerId);
  const fractional = paidItemPayments.filter((p) => p.claims.some((c) => c.denominator > 1)).length;

  const orderingDiners = new Set(db.orders.map((o) => o.dinerId));
  const delivered = db.orderItems.filter((i) => i.deliveredAt).map((i) => seconds(i.createdAt, i.deliveredAt!));
  const posnetResponses = paid
    .filter((p) => p.method === 'POSNET' && p.dinerId && p.posnetRequestedAt && p.paidAt)
    .map((p) => seconds(p.posnetRequestedAt!, p.paidAt!));

  const dinerPayments = db.payments.filter((p) => p.dinerId);
  const expiredReservations = dinerPayments.filter((p) => p.status === 'EXPIRED').length;
  const voidedPayments = db.payments.filter((p) => p.status === 'VOIDED').length;
  const cancelledItems = db.orderItems.filter((i) => i.status === 'CANCELLED').length;
  const incidents = expiredReservations + voidedPayments + cancelledItems;

  return {
    sessions: {
      total: db.sessions.length,
      closed: closed.length,
      open: db.sessions.length - closed.length,
      settled: db.sessions.filter((s) => s.settledAt).length,
    },
    avgCloseSeconds: mean(closeTimes),
    avgSessionMinutes: mean(sessionMinutes),
    avgTicket: tickets.length ? Math.round(mean(tickets)!) : null,
    revenue,
    tips,
    adoption: {
      dinersWhoOrderedPct: pct(db.diners.filter((d) => orderingDiners.has(d.id)).length, db.diners.length),
      paymentsByKind,
      paymentsByMethod,
      fractionalPct: pct(fractional, paidItemPayments.length),
    },
    staff: {
      avgDeliverySeconds: mean(delivered),
      avgPosnetResponseSeconds: mean(posnetResponses),
    },
    incidents: {
      expiredReservations,
      voidedPayments,
      cancelledItems,
      ratePer100Payments: dinerPayments.length ? (incidents / dinerPayments.length) * 100 : null,
    },
    consumption: computeConsumption(db, ledgers),
  };
}
