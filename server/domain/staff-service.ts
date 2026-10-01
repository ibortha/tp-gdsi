// Casos de uso del mozo / ADMIN en el salón: mesas, comandas y cobros.
import type {
  ItemStatus,
  KitchenTicketDTO,
  PosnetAlertDTO,
  SessionSnapshot,
  TableSummaryDTO,
} from '../../shared/types.ts';
import type { Context } from './context.ts';
import { buildSnapshot } from './dto.ts';
import { AppError, notFound, unauthorized } from './errors.ts';
import { Ledger, isPaymentInProgress } from './ledger.ts';
import type { Payment, StaffUser } from './model.ts';
import { newId, newToken, verifyPassword } from './security.ts';

const formatArs = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100);

export class StaffService {
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private get db() {
    return this.ctx.db;
  }

  // ---------- Autenticación ----------

  login(email: string, password: string): { token: string; user: StaffUser } {
    const user = this.db.staff.find((s) => s.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash))
      throw new AppError('INVALID_CREDENTIALS', 'Email o contraseña incorrectos.', 401);
    if (!user.active) throw new AppError('USER_INACTIVE', 'Tu usuario está desactivado. Hablá con el administrador.', 403);
    const token = newToken();
    this.db.staffSessions.push({ token, staffId: user.id, createdAt: this.ctx.nowIso() });
    this.ctx.commit({});
    return { token, user };
  }

  logout(token: string) {
    this.db.staffSessions = this.db.staffSessions.filter((s) => s.token !== token);
    this.ctx.commit({});
  }

  authenticate(token: string | undefined): StaffUser {
    if (!token) throw unauthorized();
    const session = this.db.staffSessions.find((s) => s.token === token);
    const user = session && this.db.staff.find((s) => s.id === session.staffId);
    if (!user || !user.active) throw unauthorized('Tu sesión venció. Volvé a iniciar sesión.');
    return user;
  }

  // ---------- Mesas (US10) ----------

  tables(): TableSummaryDTO[] {
    return this.db.tables
      .filter((t) => !t.deleted)
      .sort((a, b) => a.number - b.number)
      .map((table) => {
        const session = this.ctx.openSessionOfTable(table.id);
        if (!session) return { id: table.id, number: table.number, label: table.label, active: table.active, qrToken: table.qrToken, session: null };
        const ledger = new Ledger(this.db, session.id);
        const bill = ledger.summary();
        return {
          id: table.id,
          number: table.number,
          label: table.label,
          active: table.active,
          qrToken: table.qrToken,
          session: {
            id: session.id,
            openedAt: session.openedAt,
            diners: this.db.diners.filter((d) => d.sessionId === session.id).length,
            bill,
            pendingItems: ledger.items.filter((i) => i.status === 'PENDING' || i.status === 'PREPARING').length,
            paymentsInProgress: ledger.payments.filter(isPaymentInProgress).length,
            posnetRequests: ledger.payments.filter((p) => p.status === 'AWAITING_POSNET').length,
            settled: bill.total > 0 && bill.outstanding === 0,
          },
        };
      });
  }

  tableDetail(tableId: string): { table: TableSummaryDTO; snapshot: SessionSnapshot | null } {
    const table = this.tables().find((t) => t.id === tableId);
    if (!table) throw notFound('La mesa');
    const snapshot = table.session ? buildSnapshot(this.db, table.session.id, this.ctx.now()) : null;
    return { table, snapshot };
  }

  /** Comandas: lo que cocina y el mozo tienen que preparar / llevar, de la más vieja a la más nueva. */
  kitchen(): { active: KitchenTicketDTO[]; recent: KitchenTicketDTO[] } {
    const openSessions = new Map(this.db.sessions.filter((s) => s.status === 'OPEN').map((s) => [s.id, s]));
    const tickets: KitchenTicketDTO[] = [];
    for (const order of this.db.orders) {
      const session = openSessions.get(order.sessionId);
      if (!session) continue;
      const table = this.db.tables.find((t) => t.id === session.tableId);
      const items = this.db.orderItems.filter((i) => i.orderId === order.id);
      tickets.push({
        orderId: order.id,
        sessionId: order.sessionId,
        tableId: session.tableId,
        tableNumber: table?.number ?? 0,
        dinerName: this.ctx.diner(order.dinerId)?.name ?? '—',
        createdAt: order.createdAt,
        note: order.note,
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          note: i.note,
          status: i.status,
          updatedAt: i.updatedAt,
        })),
      });
    }
    const isActive = (t: KitchenTicketDTO) => t.items.some((i) => i.status === 'PENDING' || i.status === 'PREPARING');
    const active = tickets.filter(isActive).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lastUpdate = (t: KitchenTicketDTO) => t.items.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), '');
    const recent = tickets
      .filter((t) => !isActive(t))
      .sort((a, b) => lastUpdate(b).localeCompare(lastUpdate(a)))
      .slice(0, 12);
    return { active, recent };
  }

  posnetAlerts(): PosnetAlertDTO[] {
    return this.db.payments
      .filter((p) => p.status === 'AWAITING_POSNET')
      .map((p) => this.toAlert(p))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  private toAlert(p: Payment): PosnetAlertDTO {
    const session = this.ctx.session(p.sessionId);
    const table = this.db.tables.find((t) => t.id === session.tableId);
    const ledger = new Ledger(this.db, p.sessionId);
    return {
      paymentId: p.id,
      sessionId: p.sessionId,
      tableId: session.tableId,
      tableNumber: table?.number ?? 0,
      dinerName: (p.dinerId && this.ctx.diner(p.dinerId)?.name) || '—',
      amount: ledger.paymentAmount(p),
      tipAmount: ledger.tipAmount(p),
      requestedAt: p.posnetRequestedAt ?? p.updatedAt,
    };
  }

  // ---------- Comandas ----------

  setItemStatus(orderItemId: string, status: ItemStatus) {
    const item = this.db.orderItems.find((i) => i.id === orderItemId);
    if (!item) throw notFound('El ítem');
    this.ctx.openSession(item.sessionId);
    if (item.status === 'CANCELLED') throw new AppError('ITEM_CANCELLED', 'El ítem ya fue cancelado.', 409);
    if (status === 'CANCELLED' && new Ledger(this.db, item.sessionId).itemHasClaims(item.id))
      throw new AppError(
        'ITEM_HAS_PAYMENTS',
        'No se puede cancelar: alguien ya reservó o pagó parte de este ítem (o está incluido en una división).',
        409,
      );
    const now = this.ctx.nowIso();
    item.status = status;
    item.updatedAt = now;
    item.deliveredAt = status === 'DELIVERED' ? (item.deliveredAt ?? now) : null;
    this.ctx.reconcile(item.sessionId);
    this.ctx.commit({ sessions: [item.sessionId] });
  }

  // ---------- Cobros (US11) ----------

  /** El mozo cobró con el Posnet físico: es el único que puede confirmar este tipo de pago. */
  confirmPosnet(staff: StaffUser, paymentId: string) {
    const payment = this.ctx.payment(paymentId);
    if (payment.status !== 'AWAITING_POSNET')
      throw new AppError('NOT_AWAITING_POSNET', 'Este pago no está esperando el Posnet.', 409);
    const now = this.ctx.nowIso();
    payment.status = 'PAID';
    payment.paidAt = now;
    payment.updatedAt = now;
    payment.confirmedBy = 'STAFF';
    payment.staffId = staff.id;
    this.ctx.reconcile(payment.sessionId);
    this.ctx.commit({ sessions: [payment.sessionId] });
  }

  rejectPosnet(paymentId: string) {
    const payment = this.ctx.payment(paymentId);
    if (payment.status !== 'AWAITING_POSNET')
      throw new AppError('NOT_AWAITING_POSNET', 'Este pago no está esperando el Posnet.', 409);
    payment.status = 'CANCELLED';
    payment.updatedAt = this.ctx.nowIso();
    this.ctx.reconcile(payment.sessionId);
    this.ctx.commit({ sessions: [payment.sessionId] });
  }

  /** Mitigación del riesgo de pago declarado: si la transferencia no llegó, el mozo anula el pago y lo cubierto vuelve a estar libre. */
  voidPayment(staff: StaffUser, paymentId: string) {
    const payment = this.ctx.payment(paymentId);
    this.ctx.openSession(payment.sessionId);
    if (payment.status !== 'PAID') throw new AppError('NOT_PAID', 'Solo se pueden anular pagos abonados.', 409);
    payment.status = 'VOIDED';
    payment.updatedAt = this.ctx.nowIso();
    payment.staffId ??= staff.id;
    this.ctx.reconcile(payment.sessionId);
    this.ctx.commit({ sessions: [payment.sessionId] });
  }

  /** Cobra en la mesa (Posnet o efectivo) todo lo que nadie tomó: porciones libres y partes libres de la división. */
  chargeRemaining(staff: StaffUser, sessionId: string, method: 'POSNET' | 'CASH'): Payment[] {
    this.ctx.expireDue();
    const session = this.ctx.openSession(sessionId);
    const ledger = new Ledger(this.db, sessionId);
    const now = this.ctx.nowIso();
    const base = {
      sessionId,
      dinerId: null,
      method,
      status: 'PAID' as const,
      tipPercent: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      posnetRequestedAt: null,
      paidAt: now,
      confirmedBy: 'STAFF' as const,
      staffId: staff.id,
      dismissed: false,
    };
    const created: Payment[] = [];
    const claims = ledger.freeClaims();
    if (claims.length > 0) created.push({ ...base, id: newId(), kind: 'ITEMS', claims, splitId: null, shareIndices: [] });
    const split = ledger.activeSplit;
    const shares = split ? ledger.freeShareIndices(split) : [];
    if (split && shares.length > 0)
      created.push({ ...base, id: newId(), kind: 'SPLIT', claims: [], splitId: split.id, shareIndices: shares });
    if (created.length === 0) {
      const reserved = ledger.summary().reserved;
      throw new AppError(
        'NOTHING_TO_CHARGE',
        reserved > 0
          ? `No hay saldo libre: ${formatArs(reserved)} están en pagos en curso de los comensales.`
          : 'La mesa no tiene saldo pendiente.',
        409,
      );
    }
    this.db.payments.push(...created);
    session.firstPaymentAt ??= now;
    this.ctx.reconcile(sessionId);
    this.ctx.commit({ sessions: [sessionId] });
    return created;
  }

  dissolveSplit(splitId: string) {
    const split = this.db.splits.find((s) => s.id === splitId);
    if (!split || split.status !== 'ACTIVE') throw new AppError('NO_SPLIT', 'No hay una división en curso.', 409);
    const ledger = new Ledger(this.db, split.sessionId);
    const shares = ledger.shares(split);
    if (shares.some((s) => s.state === 'PAID'))
      throw new AppError('SPLIT_HAS_PAYMENTS', 'Ya hay partes abonadas: anulá esos pagos primero.', 409);
    const now = this.ctx.nowIso();
    for (const s of shares) {
      if (s.payment) {
        s.payment.status = 'CANCELLED';
        s.payment.expiresAt = null;
        s.payment.updatedAt = now;
      }
    }
    split.status = 'DISSOLVED';
    split.updatedAt = now;
    this.ctx.reconcile(split.sessionId);
    this.ctx.commit({ sessions: [split.sessionId] });
  }

  /** Libera la mesa para el próximo grupo. Con saldo pendiente solo se puede forzando. */
  closeSession(sessionId: string, force = false) {
    const session = this.ctx.openSession(sessionId);
    const bill = new Ledger(this.db, sessionId).summary();
    if (bill.outstanding > 0 && !force)
      throw new AppError(
        'HAS_OUTSTANDING',
        `La mesa todavía tiene un saldo pendiente de ${formatArs(bill.outstanding)}.`,
        409,
      );
    const now = this.ctx.nowIso();
    for (const p of this.db.payments) {
      if (p.sessionId === sessionId && isPaymentInProgress(p)) {
        p.status = 'CANCELLED';
        p.expiresAt = null;
        p.updatedAt = now;
      }
    }
    session.status = 'CLOSED';
    session.closedAt = now;
    this.ctx.commit({ closed: [sessionId], tables: true });
  }
}
