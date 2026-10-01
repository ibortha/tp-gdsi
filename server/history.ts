// Historial simulado: mesas ya atendidas y cerradas, para que el tablero de métricas tenga datos.
// No depende de Node, así que también lo usa la demo estática que corre en el navegador.
import { createDomain } from './domain/index.ts';
import type { DB } from './domain/model.ts';

const NAMES = ['Fede', 'Meli', 'Tomi', 'Sofi', 'Juli', 'Nico', 'Caro', 'Lucho', 'Agus', 'Pau', 'Santi', 'Vale', 'Lu', 'Mati'];

/** Qué se pide más en cada servicio (peso relativo; lo que no figura pesa 1). */
const POPULARITY: Record<'almuerzo' | 'cena', Record<string, number>> = {
  almuerzo: {
    Clásica: 6,
    Veggie: 4,
    'Doble carne': 4,
    Muzzarella: 3,
    'Limonada de la casa': 6,
    'Gaseosa línea Coca-Cola': 6,
    'Agua con o sin gas': 5,
    'Papas fritas': 3,
    'Brownie con helado': 2,
    'Pinta Golden': 2,
  },
  cena: {
    'Pinta IPA': 9,
    'Pinta Golden': 7,
    'Pinta Honey': 4,
    'Pinta Stout': 3,
    'Jarra IPA (1,5 L)': 3,
    'Papas cheddar y bacon': 6,
    'Papas fritas': 5,
    'Nachos con guacamole': 4,
    'Doble carne': 5,
    'Triple carne': 3,
    Fugazzeta: 3,
    'Tabla de picada': 2,
  },
};

/** Tamaño del grupo: más parejas y grupos de 4 que mesas de 1 o de 6. */
const PARTY_SIZES = [1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6];

/**
 * Simula `days` días de servicio (almuerzo y cena) con las mismas reglas de negocio de la app y un reloj ficticio.
 * Los horarios están en hora de Argentina (UTC−3): almuerzo desde las 12:30 y cena desde las 20:00.
 */
export function simulateHistory(db: DB, days = 7) {
  let clock = 0;
  const domain = createDomain(db, { now: () => new Date(clock) });
  const staff = db.staff.find((s) => s.role === 'MOZO') ?? db.staff[0]!;
  const menu = db.menuItems.filter((m) => m.available && !m.deleted);
  let seed = 2026;
  const rand = (n: number) => {
    seed = (seed * 16807) % 2147483647;
    return seed % n;
  };
  const pick = <T,>(list: T[]) => list[rand(list.length)]!;
  const weighted = (service: 'almuerzo' | 'cena') => {
    const weights = menu.map((m) => POPULARITY[service][m.name] ?? 1);
    let r = rand(weights.reduce((a, b) => a + b, 0));
    for (const [i, w] of weights.entries()) {
      if (r < w) return menu[i]!;
      r -= w;
    }
    return menu[0]!;
  };
  const minutes = (m: number) => {
    clock += m * 60 * 1000;
  };
  const today = new Date();
  const utcMidnight = (daysAgo: number) =>
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo);

  const services = [
    { name: 'almuerzo' as const, startUtcHour: 15.5, tables: 4, spreadMin: 70, rounds: 1 },
    { name: 'cena' as const, startUtcHour: 23, tables: 11, spreadMin: 200, rounds: 3 },
  ];

  for (let day = days; day >= 1; day--) {
    for (const service of services) {
      // Un subconjunto de mesas distinto en cada servicio (el 2do piso se usa menos al mediodía).
      const pool = db.tables.filter((t) => t.active && (service.name === 'cena' || t.label !== '2do piso'));
      const tables = pool
        .map((t) => ({ t, k: rand(1000) }))
        .sort((a, b) => a.k - b.k)
        .slice(0, service.tables + rand(4))
        .map((x) => x.t);
      for (const table of tables) {
        // Cada mesa llega en un momento distinto del servicio (las mesas se atienden en paralelo).
        clock = utcMidnight(day) + service.startUtcHour * 3600_000 + rand(service.spreadMin) * 60_000;
        const people = pick(PARTY_SIZES);
        const first = rand(NAMES.length - people);
        const diners = NAMES.slice(first, first + people).map((name) => domain.diners.join(table.qrToken, name).diner);
        const items = [];
        for (let round = 0; round < service.rounds + rand(2); round++) {
          for (const diner of diners) {
            if (round > 0 && rand(3) === 0) continue;
            const lines = Array.from({ length: 1 + rand(2) }, () => ({ menuItemId: weighted(service.name).id, quantity: 1 + (rand(5) === 0 ? 1 : 0) }));
            items.push(...domain.diners.placeOrder(diner, lines));
          }
          minutes(4 + rand(8));
          for (const item of items.filter((i) => i.status === 'PENDING')) {
            domain.staff.setItemStatus(item.id, rand(25) === 0 ? 'CANCELLED' : 'DELIVERED');
          }
          minutes(service.name === 'cena' ? 25 + rand(25) : 15 + rand(15));
        }

        // Al pagar: algunos pagan lo suyo (a veces compartiendo mitades), el resto divide el saldo.
        const sessionId = diners[0]!.sessionId;
        for (const diner of diners.slice(0, rand(diners.length + 1))) {
          const mine = items.filter((i) => i.dinerId === diner.id && i.status !== 'CANCELLED');
          try {
            if (mine.length === 0) continue;
            if (rand(3) === 0) domain.diners.claimPortion(diner, { orderItemId: mine[0]!.id, unitIndex: 0, denominator: 2 });
            else domain.diners.claimItemsOf(diner, diner.id);
            minutes(0.5);
            if (rand(7) === 0) {
              minutes(1.5); // no confirmó a tiempo: la reserva vence (incidente)
              domain.ctx.expireDue();
              continue;
            }
            const method = pick(['MERCADO_PAGO', 'MERCADO_PAGO', 'MERCADO_PAGO', 'QR', 'QR', 'POSNET'] as const);
            const payment = domain.diners.chooseMethod(diner, method, pick([0, 0, 10, 10, 15]));
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
            domain.staff.chargeRemaining(staff, sessionId, rand(3) ? 'POSNET' : 'CASH');
          } catch {
            // lo que falta está en pagos en curso: se cierra igual más abajo
          }
        }
        if (rand(12) === 0) {
          const paid = db.payments.find((p) => p.sessionId === sessionId && p.status === 'PAID' && p.confirmedBy === 'DINER');
          if (paid) {
            domain.staff.voidPayment(staff, paid.id); // la transferencia no llegó
            try {
              domain.staff.chargeRemaining(staff, sessionId, 'CASH');
            } catch {
              // nada libre para cobrar
            }
          }
        }
        minutes(5);
        domain.staff.closeSession(sessionId, true);
      }
    }
  }
}
