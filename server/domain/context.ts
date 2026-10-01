// Contexto compartido por los servicios: acceso al estado, reloj, persistencia y eventos de tiempo real.
import type { PosnetAlertDTO } from '../../shared/types.ts';
import { AppError, notFound } from './errors.ts';
import { Ledger } from './ledger.ts';
import type { DB, Diner, Payment, Table, TableSession } from './model.ts';

export interface DomainEvents {
  sessionChanged?(sessionId: string): void;
  sessionClosed?(sessionId: string): void;
  menuChanged?(): void;
  tablesChanged?(): void;
  posnetRequested?(alert: PosnetAlertDTO): void;
}

export interface ContextOptions {
  now?: () => Date;
  persist?: () => void;
  events?: DomainEvents;
}

export interface CommitScope {
  sessions?: Iterable<string>;
  closed?: Iterable<string>;
  menu?: boolean;
  tables?: boolean;
}

export class Context {
  readonly db: DB;
  private readonly clock: () => Date;
  private readonly persistFn: () => void;
  events: DomainEvents;

  constructor(db: DB, options: ContextOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => new Date());
    this.persistFn = options.persist ?? (() => {});
    this.events = options.events ?? {};
  }

  now(): Date {
    return this.clock();
  }

  nowIso(): string {
    return this.clock().toISOString();
  }

  reservationExpiry(): string {
    return new Date(this.clock().getTime() + this.db.venue.reservationTtlSec * 1000).toISOString();
  }

  /** Persiste y avisa a los clientes conectados lo que cambió. */
  commit(scope: CommitScope) {
    this.persistFn();
    const sessions = new Set(scope.sessions ?? []);
    const closed = new Set(scope.closed ?? []);
    for (const id of sessions) if (!closed.has(id)) this.events.sessionChanged?.(id);
    for (const id of closed) this.events.sessionClosed?.(id);
    if (scope.menu) this.events.menuChanged?.();
    if (scope.tables) this.events.tablesChanged?.();
  }

  table(id: string): Table {
    const table = this.db.tables.find((t) => t.id === id && !t.deleted);
    if (!table) throw notFound('La mesa');
    return table;
  }

  session(id: string): TableSession {
    const session = this.db.sessions.find((s) => s.id === id);
    if (!session) throw notFound('La sesión de mesa');
    return session;
  }

  openSession(id: string): TableSession {
    const session = this.session(id);
    if (session.status !== 'OPEN') throw new AppError('SESSION_CLOSED', 'La mesa ya fue cerrada.', 410);
    return session;
  }

  openSessionOfTable(tableId: string): TableSession | undefined {
    return this.db.sessions.find((s) => s.tableId === tableId && s.status === 'OPEN');
  }

  payment(id: string): Payment {
    const payment = this.db.payments.find((p) => p.id === id);
    if (!payment) throw notFound('El pago');
    return payment;
  }

  diner(id: string): Diner | undefined {
    return this.db.diners.find((d) => d.id === id);
  }

  /**
   * Reglas que se re-evalúan después de cualquier cambio en los pagos de una mesa:
   * - una división con todas sus partes abonadas queda COMPLETED (y vuelve a ACTIVE si se anula una parte);
   * - una división sin partes abonadas ni reservadas se disuelve y sus porciones vuelven a estar libres;
   * - la mesa queda "saldada" cuando el saldo pendiente llega a $0.
   */
  reconcile(sessionId: string) {
    const ledger = new Ledger(this.db, sessionId);
    for (const split of ledger.splits) {
      if (split.status === 'DISSOLVED') continue;
      const shares = ledger.shares(split);
      const paid = shares.filter((s) => s.state === 'PAID').length;
      const reserved = shares.filter((s) => s.state === 'RESERVED').length;
      const before = split.status;
      if (split.status === 'ACTIVE' && paid === split.parts) split.status = 'COMPLETED';
      else if (split.status === 'COMPLETED' && paid < split.parts) split.status = 'ACTIVE';
      if (split.status === 'ACTIVE' && paid === 0 && reserved === 0) split.status = 'DISSOLVED';
      if (split.status !== before) split.updatedAt = this.nowIso();
    }
    const session = this.session(sessionId);
    const bill = new Ledger(this.db, sessionId).summary();
    const settled = bill.total > 0 && bill.outstanding === 0;
    session.settledAt = settled ? (session.settledAt ?? this.nowIso()) : null;
  }

  /** Libera las reservas que pasaron el tiempo límite sin confirmarse. Devuelve las mesas afectadas. */
  expireDue(): string[] {
    const now = this.now().getTime();
    const affected = new Set<string>();
    for (const p of this.db.payments) {
      if (p.status === 'RESERVED' && p.expiresAt && Date.parse(p.expiresAt) <= now) {
        p.status = 'EXPIRED';
        p.updatedAt = this.nowIso();
        affected.add(p.sessionId);
      }
    }
    for (const sessionId of affected) this.reconcile(sessionId);
    if (affected.size > 0) this.commit({ sessions: affected });
    return [...affected];
  }
}
