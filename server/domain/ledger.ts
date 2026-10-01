// Cálculo puro de la cuenta compartida de una mesa: quién tomó cada porción, cuánto se pagó y cuánto falta.
import type { BillSummary, Cents, Denominator, PortionState } from '../../shared/types.ts';
import type { Claim, DB, OrderItem, Payment, Split } from './model.ts';
import { distribute, percentOf } from './money.ts';

export type ClaimOwner = { kind: 'payment'; payment: Payment } | { kind: 'split'; split: Split };

export interface ActiveClaim {
  claim: Claim;
  owner: ClaimOwner;
}

export interface PortionView {
  index: number;
  amount: Cents;
  state: PortionState;
  owner: ClaimOwner | null;
}

export interface UnitView {
  item: OrderItem;
  unitIndex: number;
  denominator: Denominator | null;
  portions: PortionView[];
}

export interface ShareView {
  index: number;
  amount: Cents;
  state: 'AVAILABLE' | 'RESERVED' | 'PAID';
  payment: Payment | null;
}

export const isPaymentActive = (p: Payment) =>
  p.status === 'RESERVED' || p.status === 'AWAITING_POSNET' || p.status === 'PAID';

export const isPaymentInProgress = (p: Payment) => p.status === 'RESERVED' || p.status === 'AWAITING_POSNET';

export const isSplitActive = (s: Split) => s.status === 'ACTIVE' || s.status === 'COMPLETED';

export const unitKey = (orderItemId: string, unitIndex: number) => `${orderItemId}#${unitIndex}`;

export class Ledger {
  readonly items: OrderItem[];
  readonly payments: Payment[];
  readonly splits: Split[];
  private readonly itemsById: Map<string, OrderItem>;
  private readonly splitsById: Map<string, Split>;
  private readonly unitClaims = new Map<string, ActiveClaim[]>();

  constructor(db: DB, sessionId: string) {
    this.items = db.orderItems.filter((i) => i.sessionId === sessionId);
    this.payments = db.payments.filter((p) => p.sessionId === sessionId);
    this.splits = db.splits.filter((s) => s.sessionId === sessionId);
    this.itemsById = new Map(this.items.map((i) => [i.id, i]));
    this.splitsById = new Map(this.splits.map((s) => [s.id, s]));

    for (const payment of this.payments) {
      if (!isPaymentActive(payment)) continue;
      for (const claim of payment.claims) this.addClaim(claim, { kind: 'payment', payment });
    }
    for (const split of this.splits) {
      if (!isSplitActive(split)) continue;
      for (const claim of split.claims) this.addClaim(claim, { kind: 'split', split });
    }
  }

  private addClaim(claim: Claim, owner: ClaimOwner) {
    const key = unitKey(claim.orderItemId, claim.unitIndex);
    const list = this.unitClaims.get(key) ?? [];
    list.push({ claim, owner });
    this.unitClaims.set(key, list);
  }

  item(id: string): OrderItem | undefined {
    return this.itemsById.get(id);
  }

  split(id: string | null): Split | undefined {
    return id ? this.splitsById.get(id) : undefined;
  }

  get activeSplit(): Split | undefined {
    return this.splits.find((s) => s.status === 'ACTIVE');
  }

  billableItems(): OrderItem[] {
    return this.items.filter((i) => i.status !== 'CANCELLED');
  }

  claimsOnUnit(orderItemId: string, unitIndex: number): ActiveClaim[] {
    return this.unitClaims.get(unitKey(orderItemId, unitIndex)) ?? [];
  }

  /** ¿Hay algún pago o división activa tocando este ítem? */
  itemHasClaims(orderItemId: string): boolean {
    const item = this.item(orderItemId);
    if (!item) return false;
    for (let u = 0; u < item.quantity; u++) if (this.claimsOnUnit(orderItemId, u).length > 0) return true;
    return false;
  }

  claimAmount(claim: Claim): Cents {
    const item = this.item(claim.orderItemId);
    if (!item) return 0;
    return distribute(item.unitPrice, claim.denominator)[claim.portionIndex] ?? 0;
  }

  splitTotal(split: Split): Cents {
    return split.claims.reduce((sum, c) => sum + this.claimAmount(c), 0);
  }

  shareAmounts(split: Split): Cents[] {
    return distribute(this.splitTotal(split), split.parts);
  }

  paymentAmount(payment: Payment): Cents {
    if (payment.kind === 'ITEMS') return payment.claims.reduce((sum, c) => sum + this.claimAmount(c), 0);
    const split = this.split(payment.splitId);
    if (!split) return 0;
    const amounts = this.shareAmounts(split);
    return payment.shareIndices.reduce((sum, i) => sum + (amounts[i] ?? 0), 0);
  }

  tipAmount(payment: Payment): Cents {
    return percentOf(this.paymentAmount(payment), payment.tipPercent);
  }

  unit(item: OrderItem, unitIndex: number): UnitView {
    const claims = this.claimsOnUnit(item.id, unitIndex);
    if (claims.length === 0) return { item, unitIndex, denominator: null, portions: [] };
    const denominator = claims[0]!.claim.denominator;
    const amounts = distribute(item.unitPrice, denominator);
    const portions = amounts.map((amount, index): PortionView => {
      const active = claims.find((c) => c.claim.portionIndex === index);
      if (!active) return { index, amount, state: 'AVAILABLE', owner: null };
      const { owner } = active;
      let state: PortionState;
      if (owner.kind === 'payment') state = owner.payment.status === 'PAID' ? 'PAID' : 'RESERVED';
      else state = owner.split.status === 'COMPLETED' ? 'PAID' : 'IN_SPLIT';
      return { index, amount, state, owner };
    });
    return { item, unitIndex, denominator, portions };
  }

  units(): UnitView[] {
    return this.billableItems().flatMap((item) =>
      Array.from({ length: item.quantity }, (_, u) => this.unit(item, u)),
    );
  }

  /** Una porción concreta se puede tomar si la unidad no está dividida de otra forma y nadie tiene esa parte. */
  isClaimFree(claim: Claim): boolean {
    const item = this.item(claim.orderItemId);
    if (!item || item.status === 'CANCELLED') return false;
    if (claim.unitIndex < 0 || claim.unitIndex >= item.quantity) return false;
    if (claim.portionIndex < 0 || claim.portionIndex >= claim.denominator) return false;
    const claims = this.claimsOnUnit(claim.orderItemId, claim.unitIndex);
    if (claims.length === 0) return true;
    if (claims[0]!.claim.denominator !== claim.denominator) return false;
    return !claims.some((c) => c.claim.portionIndex === claim.portionIndex);
  }

  /** Todo lo que nadie tomó todavía: unidades enteras libres + porciones libres de unidades ya divididas. */
  freeClaims(filter?: (item: OrderItem) => boolean): Claim[] {
    const result: Claim[] = [];
    for (const item of this.billableItems()) {
      if (filter && !filter(item)) continue;
      for (let unitIndex = 0; unitIndex < item.quantity; unitIndex++) {
        const unit = this.unit(item, unitIndex);
        if (unit.denominator === null) {
          result.push({ orderItemId: item.id, unitIndex, denominator: 1, portionIndex: 0 });
        } else {
          for (const p of unit.portions) {
            if (p.state === 'AVAILABLE') {
              result.push({ orderItemId: item.id, unitIndex, denominator: unit.denominator, portionIndex: p.index });
            }
          }
        }
      }
    }
    return result;
  }

  shares(split: Split): ShareView[] {
    const amounts = this.shareAmounts(split);
    return amounts.map((amount, index) => {
      const payment =
        this.payments.find(
          (p) => p.kind === 'SPLIT' && p.splitId === split.id && isPaymentActive(p) && p.shareIndices.includes(index),
        ) ?? null;
      const state = !payment ? 'AVAILABLE' : payment.status === 'PAID' ? 'PAID' : 'RESERVED';
      return { index, amount, state, payment };
    });
  }

  freeShareIndices(split: Split): number[] {
    return this.shares(split)
      .filter((s) => s.state === 'AVAILABLE')
      .map((s) => s.index);
  }

  summary(): BillSummary {
    const total = this.billableItems().reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    let paid = 0;
    let reserved = 0;
    let tips = 0;
    for (const p of this.payments) {
      if (p.status === 'PAID') {
        paid += this.paymentAmount(p);
        tips += this.tipAmount(p);
      } else if (isPaymentInProgress(p)) {
        reserved += this.paymentAmount(p);
      }
    }
    const outstanding = total - paid;
    // Lo no reservado ni pagado: porciones libres + partes libres de una división en curso.
    return { total, paid, reserved, outstanding, unclaimed: outstanding - reserved, tips };
  }
}

export const DENOMINATOR_LABEL: Record<Denominator, string> = { 1: 'completo', 2: '½', 3: '⅓' };
