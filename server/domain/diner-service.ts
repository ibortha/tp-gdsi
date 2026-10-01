// Casos de uso del comensal: unirse a la mesa, pedir y pagar su parte.
import type { Denominator, MenuDTO, PaymentMethod, SessionSnapshot } from '../../shared/types.ts';
import type { Context } from './context.ts';
import { buildSnapshot, toMenuItemDTO } from './dto.ts';
import { AppError, notFound, unauthorized } from './errors.ts';
import { Ledger, isPaymentInProgress } from './ledger.ts';
import type { Claim, Diner, OrderItem, Payment } from './model.ts';
import { newId, newToken } from './security.ts';

const DINER_COLORS = [
  '#d1495b',
  '#2e86ab',
  '#7a5195',
  '#2a9d8f',
  '#c75000',
  '#5c6bc0',
  '#c2185b',
  '#4f7f2a',
  '#8d6e63',
  '#00838f',
];

const DENOMINATOR_PLURAL: Record<Denominator, string> = { 1: 'completo', 2: 'mitades', 3: 'tercios' };

export const MAX_NAME_LENGTH = 20;
export const MAX_SPLIT_PARTS = 30;

export interface OrderLineInput {
  menuItemId: string;
  quantity: number;
  note?: string;
}

/** Compara nombres sin distinguir mayúsculas, tildes ni espacios repetidos. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export class DinerService {
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private get db() {
    return this.ctx.db;
  }

  // ---------- Mesa y sesión ----------

  tableByQr(qrToken: string) {
    const table = this.db.tables.find((t) => t.qrToken === qrToken && !t.deleted);
    if (!table) throw new AppError('TABLE_NOT_FOUND', 'Este QR no corresponde a ninguna mesa del local.', 404);
    return table;
  }

  tableInfo(qrToken: string) {
    const table = this.tableByQr(qrToken);
    const session = this.ctx.openSessionOfTable(table.id);
    return {
      tableId: table.id,
      number: table.number,
      label: table.label,
      active: table.active,
      venueName: this.db.venue.name,
      diners: session ? this.db.diners.filter((d) => d.sessionId === session.id).map((d) => d.name) : [],
    };
  }

  /** US01: escanear el QR, ingresar un nombre y sumarse a la cuenta compartida de la mesa. */
  join(qrToken: string, rawName: string): { token: string; diner: Diner; sessionId: string } {
    const table = this.tableByQr(qrToken);
    if (!table.active) throw new AppError('TABLE_INACTIVE', 'Esta mesa no está habilitada. Avisale al mozo.', 409);
    const name = rawName.replace(/\s+/g, ' ').trim();
    if (name.length === 0) throw new AppError('NAME_REQUIRED', 'Ingresá tu nombre para unirte a la mesa.');
    if (name.length > MAX_NAME_LENGTH)
      throw new AppError('NAME_TOO_LONG', `El nombre puede tener hasta ${MAX_NAME_LENGTH} caracteres.`);

    const now = this.ctx.nowIso();
    let session = this.ctx.openSessionOfTable(table.id);
    if (!session) {
      session = {
        id: newId(),
        tableId: table.id,
        status: 'OPEN',
        openedAt: now,
        closedAt: null,
        firstPaymentAt: null,
        settledAt: null,
      };
      this.db.sessions.push(session);
    }
    const sessionId = session.id;
    const others = this.db.diners.filter((d) => d.sessionId === sessionId);
    if (others.some((d) => normalizeName(d.name) === normalizeName(name))) {
      throw new AppError(
        'NAME_TAKEN',
        `Ya hay alguien llamado "${name}" en esta mesa. Probá con tu apodo o agregá la inicial del apellido.`,
        409,
      );
    }
    const diner: Diner = {
      id: newId(),
      sessionId,
      name,
      token: newToken(),
      color: DINER_COLORS[others.length % DINER_COLORS.length]!,
      joinedAt: now,
    };
    this.db.diners.push(diner);
    this.ctx.commit({ sessions: [sessionId], tables: true });
    return { token: diner.token, diner, sessionId };
  }

  authenticate(token: string | undefined): Diner {
    if (!token) throw unauthorized('Escaneá el QR de tu mesa para unirte.');
    const diner = this.db.diners.find((d) => d.token === token);
    if (!diner) throw unauthorized('Tu sesión ya no es válida. Escaneá el QR de la mesa otra vez.');
    this.ctx.openSession(diner.sessionId);
    return diner;
  }

  snapshot(sessionId: string): SessionSnapshot {
    return buildSnapshot(this.db, sessionId, this.ctx.now());
  }

  /** US02: menú único del local (los ítems agotados se muestran pero no se pueden pedir). */
  menu(): MenuDTO {
    return {
      categories: this.db.categories.slice().sort((a, b) => a.sort - b.sort),
      items: this.db.menuItems
        .filter((m) => !m.deleted)
        .sort((a, b) => a.sort - b.sort)
        .map(toMenuItemDTO),
    };
  }

  // ---------- Pedidos ----------

  /** US03: el pedido va directo a cocina y al mozo, sin aprobación, y se suma a la cuenta de la mesa. */
  placeOrder(diner: Diner, lines: OrderLineInput[], note = ''): OrderItem[] {
    this.ctx.openSession(diner.sessionId);
    if (lines.length === 0) throw new AppError('EMPTY_ORDER', 'Agregá al menos un producto al pedido.');
    const now = this.ctx.nowIso();
    const orderId = newId();
    const created: OrderItem[] = lines.map((line) => {
      const menuItem = this.db.menuItems.find((m) => m.id === line.menuItemId && !m.deleted);
      if (!menuItem) throw new AppError('MENU_ITEM_NOT_FOUND', 'Uno de los productos ya no está en el menú.', 409);
      if (!menuItem.available)
        throw new AppError('MENU_ITEM_UNAVAILABLE', `"${menuItem.name}" está agotado en este momento.`, 409);
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20)
        throw new AppError('INVALID_QUANTITY', 'La cantidad tiene que estar entre 1 y 20.');
      return {
        id: newId(),
        orderId,
        sessionId: diner.sessionId,
        dinerId: diner.id,
        menuItemId: menuItem.id,
        name: menuItem.name,
        unitPrice: menuItem.promoPrice ?? menuItem.price,
        quantity: line.quantity,
        note: (line.note ?? '').trim(),
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        deliveredAt: null,
      };
    });
    this.db.orders.push({ id: orderId, sessionId: diner.sessionId, dinerId: diner.id, note: note.trim(), createdAt: now });
    this.db.orderItems.push(...created);
    this.ctx.reconcile(diner.sessionId);
    this.ctx.commit({ sessions: [diner.sessionId] });
    return created;
  }

  // ---------- Pago por ítems (US05, US06) ----------

  /** El pago en curso del comensal (reservado o esperando el Posnet). Hay a lo sumo uno. */
  currentPayment(diner: Diner): Payment | undefined {
    return this.db.payments.find((p) => p.dinerId === diner.id && isPaymentInProgress(p));
  }

  private itemsDraft(diner: Diner): Payment {
    const current = this.currentPayment(diner);
    if (current) {
      if (current.kind !== 'ITEMS')
        throw new AppError(
          'PAYMENT_IN_PROGRESS',
          'Ya tenés reservada una parte de la división. Pagala o cancelala antes de elegir ítems.',
          409,
        );
      if (current.status === 'AWAITING_POSNET')
        throw new AppError('AWAITING_POSNET', 'Estás esperando al mozo con el Posnet. Cancelá ese pedido para cambiar tu selección.', 409);
      return current;
    }
    return this.newPayment(diner, 'ITEMS');
  }

  private newPayment(diner: Diner, kind: Payment['kind']): Payment {
    const now = this.ctx.nowIso();
    const payment: Payment = {
      id: newId(),
      sessionId: diner.sessionId,
      dinerId: diner.id,
      kind,
      claims: [],
      splitId: null,
      shareIndices: [],
      method: null,
      status: 'RESERVED',
      tipPercent: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: this.ctx.reservationExpiry(),
      posnetRequestedAt: null,
      paidAt: null,
      confirmedBy: null,
      staffId: null,
      dismissed: false,
    };
    this.db.payments.push(payment);
    const session = this.ctx.session(diner.sessionId);
    session.firstPaymentAt ??= now;
    return payment;
  }

  /** Cada cambio en la selección reinicia el minuto de reserva. */
  private touch(payment: Payment) {
    payment.updatedAt = this.ctx.nowIso();
    if (payment.status === 'RESERVED') payment.expiresAt = this.ctx.reservationExpiry();
  }

  /**
   * Reserva una porción (completo / mitad / tercio) de una unidad de un ítem.
   * La primera porción que se toma define en cuántas partes queda dividida esa unidad.
   */
  claimPortion(diner: Diner, input: { orderItemId: string; unitIndex: number; denominator: Denominator }): Payment {
    this.ctx.expireDue();
    this.ctx.openSession(diner.sessionId);
    const ledger = new Ledger(this.db, diner.sessionId);
    const item = ledger.item(input.orderItemId);
    if (!item || item.status === 'CANCELLED') throw notFound('El ítem');
    if (!Number.isInteger(input.unitIndex) || input.unitIndex < 0 || input.unitIndex >= item.quantity)
      throw new AppError('INVALID_UNIT', 'Esa unidad del ítem no existe.');

    const unit = ledger.unit(item, input.unitIndex);
    if (unit.denominator !== null && unit.denominator !== input.denominator) {
      throw new AppError(
        'FRACTION_MISMATCH',
        `Este ítem ya se está pagando en ${DENOMINATOR_PLURAL[unit.denominator]}; elegí una de esas porciones.`,
        409,
      );
    }
    const portionIndex =
      unit.denominator === null ? 0 : unit.portions.find((p) => p.state === 'AVAILABLE')?.index;
    if (portionIndex === undefined)
      throw new AppError('PORTION_TAKEN', 'Ya no quedan porciones libres de este ítem.', 409);

    const payment = this.itemsDraft(diner);
    payment.claims.push({ orderItemId: item.id, unitIndex: input.unitIndex, denominator: input.denominator, portionIndex });
    this.touch(payment);
    this.ctx.commit({ sessions: [diner.sessionId] });
    return payment;
  }

  releasePortion(diner: Diner, input: { orderItemId: string; unitIndex: number; portionIndex: number }): Payment | null {
    this.ctx.expireDue();
    const payment = this.currentPayment(diner);
    if (!payment || payment.kind !== 'ITEMS' || payment.status !== 'RESERVED')
      throw new AppError('NO_SELECTION', 'No tenés una selección en curso.', 409);
    const index = payment.claims.findIndex(
      (c) =>
        c.orderItemId === input.orderItemId && c.unitIndex === input.unitIndex && c.portionIndex === input.portionIndex,
    );
    if (index === -1) throw new AppError('NOT_IN_SELECTION', 'Esa porción no está en tu selección.', 409);
    payment.claims.splice(index, 1);
    if (payment.claims.length === 0) {
      payment.status = 'CANCELLED';
      payment.updatedAt = this.ctx.nowIso();
      payment.expiresAt = null;
    } else {
      this.touch(payment);
    }
    this.ctx.commit({ sessions: [diner.sessionId] });
    return payment.status === 'CANCELLED' ? null : payment;
  }

  /** Atajo para "agrupar": toma todo lo que todavía está libre de lo que pidió una persona (o uno mismo). */
  claimItemsOf(diner: Diner, targetDinerId: string): Payment {
    this.ctx.expireDue();
    this.ctx.openSession(diner.sessionId);
    const target = this.ctx.diner(targetDinerId);
    if (!target || target.sessionId !== diner.sessionId) throw notFound('Ese comensal');
    const ledger = new Ledger(this.db, diner.sessionId);
    const claims = ledger.freeClaims((item) => item.dinerId === target.id);
    if (claims.length === 0) {
      const who = target.id === diner.id ? 'de lo que pediste' : `de lo que pidió ${target.name}`;
      throw new AppError('NOTHING_TO_CLAIM', `No queda nada libre ${who}.`, 409);
    }
    const payment = this.itemsDraft(diner);
    payment.claims.push(...claims);
    this.touch(payment);
    this.ctx.commit({ sessions: [diner.sessionId] });
    return payment;
  }

  // ---------- Dividir el total (US07) ----------

  /**
   * Divide en `parts` partes iguales todo lo que nadie tomó todavía (el saldo pendiente libre)
   * y reserva `take` partes para quien la inicia.
   */
  startSplit(diner: Diner, parts: number, take = 1): Payment {
    this.ctx.expireDue();
    this.ctx.openSession(diner.sessionId);
    if (!Number.isInteger(parts) || parts < 1 || parts > MAX_SPLIT_PARTS)
      throw new AppError('INVALID_PARTS', `La cantidad de personas tiene que estar entre 1 y ${MAX_SPLIT_PARTS}.`);
    if (!Number.isInteger(take) || take < 1 || take > parts)
      throw new AppError('INVALID_TAKE', 'La cantidad de partes que pagás tiene que estar entre 1 y el total de partes.');
    if (this.currentPayment(diner))
      throw new AppError('PAYMENT_IN_PROGRESS', 'Terminá o cancelá tu pago en curso antes de dividir el total.', 409);

    const ledger = new Ledger(this.db, diner.sessionId);
    if (ledger.activeSplit)
      throw new AppError('SPLIT_EXISTS', 'Ya hay una división en curso en la mesa: tomá una de sus partes.', 409);
    const claims = ledger.freeClaims();
    if (claims.length === 0)
      throw new AppError('NOTHING_TO_SPLIT', 'No queda saldo libre para dividir: todo está pago o reservado.', 409);

    const now = this.ctx.nowIso();
    const split = {
      id: newId(),
      sessionId: diner.sessionId,
      createdBy: diner.id,
      parts,
      claims,
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    };
    this.db.splits.push(split);
    const payment = this.newPayment(diner, 'SPLIT');
    payment.splitId = split.id;
    payment.shareIndices = Array.from({ length: take }, (_, i) => i);
    this.ctx.commit({ sessions: [diner.sessionId] });
    return payment;
  }

  /** Define cuántas partes de la división en curso paga este comensal (0 = soltar las que tenía). */
  takeShares(diner: Diner, count: number): Payment | null {
    this.ctx.expireDue();
    this.ctx.openSession(diner.sessionId);
    if (!Number.isInteger(count) || count < 0) throw new AppError('INVALID_TAKE', 'Cantidad de partes inválida.');
    const ledger = new Ledger(this.db, diner.sessionId);
    const split = ledger.activeSplit;
    if (!split) throw new AppError('NO_SPLIT', 'No hay una división en curso en la mesa.', 409);

    let payment = this.currentPayment(diner);
    if (payment && payment.kind !== 'SPLIT')
      throw new AppError('PAYMENT_IN_PROGRESS', 'Terminá o cancelá tu selección de ítems antes de tomar partes.', 409);
    if (payment?.status === 'AWAITING_POSNET')
      throw new AppError('AWAITING_POSNET', 'Estás esperando al mozo con el Posnet.', 409);

    const mine = payment?.shareIndices ?? [];
    if (count === mine.length) return payment ?? null;
    if (count < mine.length) {
      payment!.shareIndices = mine.slice(0, count);
      if (count === 0) {
        payment!.status = 'CANCELLED';
        payment!.expiresAt = null;
        payment!.updatedAt = this.ctx.nowIso();
      } else this.touch(payment!);
    } else {
      const free = ledger.freeShareIndices(split);
      const needed = count - mine.length;
      if (free.length < needed) {
        const left = free.length === 1 ? 'Queda 1 parte libre' : `Quedan ${free.length} partes libres`;
        throw new AppError('SHARES_TAKEN', `${left}.`, 409);
      }
      if (!payment) {
        payment = this.newPayment(diner, 'SPLIT');
        payment.splitId = split.id;
      }
      payment.shareIndices = [...mine, ...free.slice(0, needed)].sort((a, b) => a - b);
      this.touch(payment);
    }
    this.ctx.reconcile(diner.sessionId);
    this.ctx.commit({ sessions: [diner.sessionId] });
    return payment && payment.status !== 'CANCELLED' ? payment : null;
  }

  /** Cancela la división si nadie pagó todavía y nadie más tiene partes reservadas. */
  cancelSplit(diner: Diner) {
    this.ctx.expireDue();
    const ledger = new Ledger(this.db, diner.sessionId);
    const split = ledger.activeSplit;
    if (!split) throw new AppError('NO_SPLIT', 'No hay una división en curso en la mesa.', 409);
    const shares = ledger.shares(split);
    if (shares.some((s) => s.state === 'PAID'))
      throw new AppError('SPLIT_HAS_PAYMENTS', 'Ya hay partes abonadas: la división no se puede cancelar.', 409);
    if (shares.some((s) => s.payment && s.payment.dinerId !== diner.id))
      throw new AppError('SPLIT_IN_USE', 'Otra persona está pagando una parte; esperá a que termine.', 409);
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
    this.ctx.commit({ sessions: [diner.sessionId] });
  }

  // ---------- Medio de pago y confirmación (US08, US09) ----------

  chooseMethod(diner: Diner, method: PaymentMethod, tipPercent = 0): Payment {
    this.ctx.expireDue();
    this.ctx.openSession(diner.sessionId);
    if (method === 'CASH') throw new AppError('INVALID_METHOD', 'El cobro en efectivo lo registra el mozo.');
    if (tipPercent !== 0 && !this.db.venue.tipOptions.includes(tipPercent))
      throw new AppError('INVALID_TIP', 'Ese porcentaje de propina no está disponible.');
    const payment = this.currentPayment(diner);
    if (!payment) throw new AppError('NO_SELECTION', 'Tu reserva venció o no elegiste qué pagar.', 409);
    const ledger = new Ledger(this.db, diner.sessionId);
    if (ledger.paymentAmount(payment) <= 0) throw new AppError('NO_SELECTION', 'Elegí qué vas a pagar.', 409);

    const now = this.ctx.nowIso();
    payment.method = method;
    payment.tipPercent = tipPercent;
    payment.updatedAt = now;
    if (method === 'POSNET') {
      // El mozo tiene que acercarse con la terminal: la reserva queda retenida hasta que confirme o se cancele.
      payment.status = 'AWAITING_POSNET';
      payment.expiresAt = null;
      payment.posnetRequestedAt = now;
    } else {
      payment.status = 'RESERVED';
      payment.posnetRequestedAt = null;
      payment.expiresAt = this.ctx.reservationExpiry();
    }
    this.ctx.commit({ sessions: [diner.sessionId] });
    if (method === 'POSNET') {
      const table = this.ctx.table(this.ctx.session(diner.sessionId).tableId);
      this.ctx.events.posnetRequested?.({
        paymentId: payment.id,
        sessionId: diner.sessionId,
        tableId: table.id,
        tableNumber: table.number,
        dinerName: diner.name,
        amount: ledger.paymentAmount(payment),
        tipAmount: ledger.tipAmount(payment),
        requestedAt: now,
      });
    }
    return payment;
  }

  /**
   * El comensal declara que ya pagó por Mercado Pago o con el QR del local.
   * Si la reserva venció mientras transfería, se confirma igual siempre que nadie haya tomado esas porciones.
   */
  confirmPayment(diner: Diner, paymentId: string): Payment {
    this.ctx.expireDue();
    this.ctx.openSession(diner.sessionId);
    const payment = this.ownPayment(diner, paymentId);
    if (payment.status === 'PAID') return payment;
    if (payment.status === 'AWAITING_POSNET')
      throw new AppError('POSNET_CONFIRMS_STAFF', 'Los pagos con Posnet los confirma el mozo.', 409);
    if (payment.method !== 'MERCADO_PAGO' && payment.method !== 'QR')
      throw new AppError('METHOD_REQUIRED', 'Elegí primero cómo vas a pagar.', 409);
    if (payment.status === 'EXPIRED') this.reclaimExpired(payment);
    else if (payment.status !== 'RESERVED')
      throw new AppError('PAYMENT_NOT_CONFIRMABLE', 'Este pago ya no se puede confirmar.', 409);

    const now = this.ctx.nowIso();
    payment.status = 'PAID';
    payment.paidAt = now;
    payment.updatedAt = now;
    payment.expiresAt = null;
    payment.confirmedBy = 'DINER';
    this.ctx.reconcile(diner.sessionId);
    this.ctx.commit({ sessions: [diner.sessionId] });
    return payment;
  }

  private reclaimExpired(payment: Payment) {
    const ledger = new Ledger(this.db, payment.sessionId);
    const lost = new AppError(
      'RESERVATION_LOST',
      'Tu reserva venció y otra persona tomó parte de lo que habías elegido. Si ya transferiste, avisale al mozo.',
      409,
    );
    if (payment.kind === 'ITEMS') {
      if (!payment.claims.every((c: Claim) => ledger.isClaimFree(c))) throw lost;
      return;
    }
    const split = ledger.split(payment.splitId);
    if (!split) throw lost;
    if (split.status === 'ACTIVE') {
      const free = ledger.freeShareIndices(split);
      if (!payment.shareIndices.every((i) => free.includes(i))) throw lost;
      return;
    }
    if (split.status === 'DISSOLVED') {
      // La división se había disuelto al vencer la única reserva: se reactiva si su saldo sigue libre.
      if (ledger.activeSplit || !split.claims.every((c) => ledger.isClaimFree(c))) throw lost;
      split.status = 'ACTIVE';
      split.updatedAt = this.ctx.nowIso();
      return;
    }
    throw lost;
  }

  /** Cancela un pago en curso (o descarta el aviso de una reserva vencida). */
  cancelPayment(diner: Diner, paymentId: string) {
    this.ctx.expireDue();
    const payment = this.ownPayment(diner, paymentId);
    if (payment.status === 'EXPIRED') {
      payment.dismissed = true;
    } else if (isPaymentInProgress(payment)) {
      payment.status = 'CANCELLED';
      payment.expiresAt = null;
    } else {
      throw new AppError('PAYMENT_NOT_CANCELLABLE', 'Este pago ya no se puede cancelar.', 409);
    }
    payment.updatedAt = this.ctx.nowIso();
    this.ctx.reconcile(diner.sessionId);
    this.ctx.commit({ sessions: [diner.sessionId] });
  }

  private ownPayment(diner: Diner, paymentId: string): Payment {
    const payment = this.db.payments.find((p) => p.id === paymentId);
    if (!payment || payment.dinerId !== diner.id) throw notFound('El pago');
    return payment;
  }
}
