import { vi } from 'vitest';
import { createDomain } from '../domain/index.ts';
import { Ledger } from '../domain/ledger.ts';
import type { DB } from '../domain/model.ts';
import { buildSeedDB } from '../seed-data.ts';

let cachedSeed: string | null = null;

/** El seed hashea contraseñas (lento): se arma una vez y se clona para cada test. */
function freshDB(): DB {
  cachedSeed ??= JSON.stringify(buildSeedDB());
  return JSON.parse(cachedSeed) as DB;
}

export function setup() {
  let now = Date.parse('2026-10-02T23:30:00.000Z');
  const db = freshDB();
  const events = {
    sessionChanged: vi.fn(),
    sessionClosed: vi.fn(),
    menuChanged: vi.fn(),
    tablesChanged: vi.fn(),
    posnetRequested: vi.fn(),
  };
  const domain = createDomain(db, { now: () => new Date(now), events });
  const table = db.tables[0]!;
  const menuItem = (name: string) => {
    const item = db.menuItems.find((m) => m.name === name);
    if (!item) throw new Error(`No existe ${name}`);
    return item;
  };
  const advance = (seconds: number) => {
    now += seconds * 1000;
  };
  const join = (name: string, qr = table.qrToken) => domain.diners.join(qr, name).diner;
  const order = (diner: ReturnType<typeof join>, ...lines: [name: string, quantity?: number][]) =>
    domain.diners.placeOrder(
      diner,
      lines.map(([name, quantity = 1]) => ({ menuItemId: menuItem(name).id, quantity })),
    );
  const bill = (sessionId: string) => new Ledger(db, sessionId).summary();
  const admin = db.staff.find((s) => s.role === 'ADMIN')!;
  return { db, domain, events, table, menuItem, advance, join, order, bill, admin };
}

/** Invariante contable: cada centavo pedido está libre, reservado, pagado o en una parte libre de la división. */
export function assertLedgerInvariant(db: DB, sessionId: string) {
  const ledger = new Ledger(db, sessionId);
  const summary = ledger.summary();
  const free = ledger.freeClaims().reduce((s, c) => s + ledger.claimAmount(c), 0);
  const split = ledger.activeSplit;
  const freeShares = split
    ? ledger
        .shares(split)
        .filter((s) => s.state === 'AVAILABLE')
        .reduce((s, x) => s + x.amount, 0)
    : 0;
  if (summary.total !== summary.paid + summary.reserved + free + freeShares) {
    throw new Error(`Invariante rota: ${JSON.stringify({ summary, free, freeShares })}`);
  }
  if (summary.unclaimed !== free + freeShares) {
    throw new Error(`unclaimed inconsistente: ${JSON.stringify({ summary, free, freeShares })}`);
  }
  // Ninguna porción puede estar tomada dos veces.
  for (const item of ledger.billableItems()) {
    for (let u = 0; u < item.quantity; u++) {
      const claims = ledger.claimsOnUnit(item.id, u);
      const denominators = new Set(claims.map((c) => c.claim.denominator));
      const indexes = new Set(claims.map((c) => c.claim.portionIndex));
      if (denominators.size > 1 || indexes.size !== claims.length) {
        throw new Error(`Porción duplicada en ${item.name} #${u}`);
      }
    }
  }
}
