// Métricas de consumo: qué se pide, a qué hora, cómo se paga y cuántas personas se sientan por mesa.
import type { Cents, ConsumptionDTO, PaymentMethod } from '../../shared/types.ts';
import type { Ledger } from './ledger.ts';
import type { DB } from './model.ts';

export const LOCAL_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const hourFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: LOCAL_TIME_ZONE });

/** Hora del día (0–23) en el horario del local, sin depender de la zona horaria del servidor o del navegador. */
export function localHour(iso: string): number {
  const part = hourFormat.formatToParts(new Date(iso)).find((p) => p.type === 'hour');
  return Number(part?.value ?? 0) % 24;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function computeConsumption(db: DB, ledgers: Map<string, Ledger>): ConsumptionDTO {
  const items = db.orderItems.filter((i) => i.status !== 'CANCELLED');
  const menu = new Map(db.menuItems.map((m) => [m.id, m]));
  const categories = new Map(db.categories.map((c) => [c.id, c.name]));
  const sessionTable = new Map(db.sessions.map((s) => [s.id, s.tableId]));
  const categoryOf = (menuItemId: string) => categories.get(menu.get(menuItemId)?.categoryId ?? '') ?? 'Sin categoría';

  // Lo más pedido (por unidades) y por categoría.
  const byItem = new Map<string, { name: string; category: string; quantity: number; revenue: Cents; tables: Set<string> }>();
  const byCategory = new Map<string, { name: string; quantity: number; revenue: Cents }>();
  for (const item of items) {
    const key = item.menuItemId;
    const entry = byItem.get(key) ?? { name: item.name, category: categoryOf(key), quantity: 0, revenue: 0, tables: new Set<string>() };
    entry.quantity += item.quantity;
    entry.revenue += item.unitPrice * item.quantity;
    entry.tables.add(item.sessionId);
    byItem.set(key, entry);
    const cat = categoryOf(key);
    const c = byCategory.get(cat) ?? { name: cat, quantity: 0, revenue: 0 };
    c.quantity += item.quantity;
    c.revenue += item.unitPrice * item.quantity;
    byCategory.set(cat, c);
  }

  // Por horario: unidades pedidas y cantidad de pedidos por hora del día.
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, items: 0, orders: 0 }));
  for (const item of items) byHour[localHour(item.createdAt)]!.items += item.quantity;
  const ordersWithItems = new Set(items.map((i) => i.orderId));
  for (const order of db.orders) if (ordersWithItems.has(order.id)) byHour[localHour(order.createdAt)]!.orders++;

  // Medios de pago: cantidad de pagos y monto cobrado.
  const methods = new Map<PaymentMethod, { payments: number; amount: Cents }>();
  for (const p of db.payments) {
    if (p.status !== 'PAID' || !p.method) continue;
    const m = methods.get(p.method) ?? { payments: 0, amount: 0 };
    m.payments++;
    m.amount += ledgers.get(p.sessionId)?.paymentAmount(p) ?? 0;
    methods.set(p.method, m);
  }

  // Personas por mesa: solo cuentan las visitas en las que se sentó alguien.
  const dinersBySession = new Map<string, number>();
  for (const d of db.diners) dinersBySession.set(d.sessionId, (dinersBySession.get(d.sessionId) ?? 0) + 1);
  const visits = db.sessions.filter((s) => (dinersBySession.get(s.id) ?? 0) > 0);
  const sizes = visits.map((s) => dinersBySession.get(s.id)!);
  const buckets = ['1', '2', '3', '4', '5', '6+'];
  const distribution = buckets.map((size, i) => ({
    size,
    tables: sizes.filter((n) => (i === buckets.length - 1 ? n >= 6 : n === i + 1)).length,
  }));

  const orderedBySession = new Map<string, Cents>();
  for (const item of items) orderedBySession.set(item.sessionId, (orderedBySession.get(item.sessionId) ?? 0) + item.unitPrice * item.quantity);
  const totalOrdered = [...orderedBySession.values()].reduce((a, b) => a + b, 0);
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const totalDiners = sizes.reduce((a, b) => a + b, 0);

  // Por mesa física: visitas, personas, ticket y lo más pedido en esa mesa.
  const perTable = db.tables
    .filter((t) => !t.deleted)
    .sort((a, b) => a.number - b.number)
    .map((table) => {
      const tableVisits = visits.filter((s) => s.tableId === table.id);
      const tickets = tableVisits.map((s) => orderedBySession.get(s.id) ?? 0).filter((v) => v > 0);
      const counts = new Map<string, number>();
      for (const item of items) {
        if (sessionTable.get(item.sessionId) !== table.id) continue;
        counts.set(item.name, (counts.get(item.name) ?? 0) + item.quantity);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const avgTicket = mean(tickets);
      return {
        tableId: table.id,
        number: table.number,
        label: table.label,
        visits: tableVisits.length,
        avgDiners: mean(tableVisits.map((s) => dinersBySession.get(s.id)!)),
        avgTicket: avgTicket === null ? null : Math.round(avgTicket),
        topItem: top?.[0] ?? null,
        revenue: tickets.reduce((a, b) => a + b, 0),
      };
    });

  return {
    timeZone: LOCAL_TIME_ZONE,
    topItems: [...byItem.values()]
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
      .slice(0, 10)
      .map(({ tables, ...rest }) => ({ ...rest, tables: tables.size })),
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
    byHour,
    methods: [...methods.entries()].map(([method, m]) => ({ method, ...m })).sort((a, b) => b.amount - a.amount),
    partySize: { avg: mean(sizes), distribution },
    perPerson: {
      avgSpend: totalDiners ? Math.round(totalOrdered / totalDiners) : null,
      avgItems: totalDiners ? totalUnits / totalDiners : null,
    },
    perTable,
  };
}
