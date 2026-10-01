// Historial simulado: mesas ya atendidas y cerradas, para que el tablero de métricas tenga datos.
// No depende de Node, así que también lo usa la demo estática que corre en el navegador.
import { createDomain } from './domain/index.ts';
import type { DB } from './domain/model.ts';

const NAMES = ['Fede', 'Meli', 'Tomi', 'Sofi', 'Juli', 'Nico', 'Caro', 'Lucho', 'Agus', 'Pau', 'Santi', 'Vale'];

/** Simula mesas ya cerradas usando las mismas reglas de negocio de la app, con un reloj ficticio. */
export function simulateHistory(db: DB, nights = 3) {
  let clock = Date.now() - nights * 24 * 3600 * 1000;
  const domain = createDomain(db, { now: () => new Date(clock) });
  const staff = db.staff.find((s) => s.role === 'MOZO') ?? db.staff[0]!;
  const menu = db.menuItems.filter((m) => m.available && !m.deleted);
  let seed = 2026;
  const rand = (n: number) => {
    seed = (seed * 16807) % 2147483647;
    return seed % n;
  };
  const pick = <T,>(list: T[]) => list[rand(list.length)]!;
  const minutes = (m: number) => {
    clock += m * 60 * 1000;
  };

  for (let night = 0; night < nights; night++) {
    const tables = db.tables.filter((t) => t.active).slice(0, 8);
    for (const table of tables) {
      const people = 2 + rand(5);
      const first = rand(4);
      const diners = NAMES.slice(first, first + people).map((name) => domain.diners.join(table.qrToken, name).diner);
      const items = [];
      for (let round = 0; round < 2 + rand(2); round++) {
        for (const diner of diners) {
          if (rand(4) === 0) continue;
          items.push(...domain.diners.placeOrder(diner, [{ menuItemId: pick(menu).id, quantity: 1 + rand(2) }]));
        }
        minutes(4 + rand(6));
        for (const item of items.filter((i) => i.status === 'PENDING')) {
          domain.staff.setItemStatus(item.id, rand(15) === 0 ? 'CANCELLED' : 'DELIVERED');
        }
        minutes(20 + rand(20));
      }

      // Al pagar: algunos pagan lo suyo (a veces compartiendo mitades), el resto divide el saldo.
      const sessionId = diners[0]!.sessionId;
      for (const diner of diners.slice(0, rand(diners.length))) {
        const mine = items.filter((i) => i.dinerId === diner.id && i.status !== 'CANCELLED');
        try {
          if (mine.length === 0) continue;
          if (rand(3) === 0) domain.diners.claimPortion(diner, { orderItemId: mine[0]!.id, unitIndex: 0, denominator: 2 });
          else domain.diners.claimItemsOf(diner, diner.id);
          minutes(0.5);
          if (rand(6) === 0) {
            minutes(1.5); // no confirmó a tiempo: la reserva vence (incidente)
            domain.ctx.expireDue();
            continue;
          }
          const method = pick(['MERCADO_PAGO', 'QR', 'POSNET'] as const);
          const payment = domain.diners.chooseMethod(diner, method, pick([0, 0, 10, 15]));
          minutes(method === 'POSNET' ? 2 + rand(3) : 0.5);
          if (method === 'POSNET') domain.staff.confirmPosnet(staff, payment.id);
          else domain.diners.confirmPayment(diner, payment.id);
        } catch {
          // combinaciones que la app rechaza (por ejemplo, porciones ya tomadas): se ignoran
        }
      }
      const rest = diners.filter(() => rand(2) === 0);
      if (rest.length > 0) {
        try {
          domain.diners.startSplit(rest[0]!, rest.length);
          for (const [i, diner] of rest.entries()) {
            if (i > 0) domain.diners.takeShares(diner, 1);
            minutes(0.5);
            domain.diners.confirmPayment(diner, domain.diners.chooseMethod(diner, pick(['MERCADO_PAGO', 'QR'] as const)).id);
          }
        } catch {
          // no quedaba saldo libre
        }
      }
      const pending = domain.staff.tables().find((t) => t.id === table.id)?.session?.bill.outstanding ?? 0;
      if (pending > 0) {
        minutes(3);
        try {
          domain.staff.chargeRemaining(staff, sessionId, rand(2) ? 'POSNET' : 'CASH');
        } catch {
          // lo que falta está en pagos en curso: se cierra igual más abajo
        }
      }
      if (rand(10) === 0) {
        const paid = db.payments.find((p) => p.sessionId === sessionId && p.status === 'PAID' && p.confirmedBy === 'DINER');
        if (paid) {
          domain.staff.voidPayment(staff, paid.id); // la transferencia no llegó
          domain.staff.chargeRemaining(staff, sessionId, 'CASH');
        }
      }
      minutes(5);
      domain.staff.closeSession(sessionId, true);
      minutes(10 + rand(30));
    }
    clock += 18 * 3600 * 1000;
  }
}
