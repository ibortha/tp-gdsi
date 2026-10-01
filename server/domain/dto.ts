// Conversión del modelo interno a los DTO que consume el cliente.
import type {
  ClaimDTO,
  DinerDTO,
  MenuItemDTO,
  OrderItemDTO,
  PaymentDTO,
  SessionSnapshot,
  SplitDTO,
  StaffUserDTO,
} from '../../shared/types.ts';
import { DENOMINATOR_LABEL, Ledger } from './ledger.ts';
import type { Claim, DB, Diner, MenuItem, Payment, Split, StaffUser } from './model.ts';

export function claimLabel(ledger: Ledger, claim: Claim): string {
  const item = ledger.item(claim.orderItemId);
  if (!item) return 'Ítem';
  const unit = item.quantity > 1 ? ` (${claim.unitIndex + 1} de ${item.quantity})` : '';
  return `${item.name}${unit} · ${DENOMINATOR_LABEL[claim.denominator]}`;
}

export function toClaimDTO(ledger: Ledger, claim: Claim): ClaimDTO {
  return { ...claim, amount: ledger.claimAmount(claim), label: claimLabel(ledger, claim) };
}

export function toPaymentDTO(db: DB, ledger: Ledger, p: Payment): PaymentDTO {
  const staff = p.staffId ? db.staff.find((s) => s.id === p.staffId) : undefined;
  return {
    id: p.id,
    dinerId: p.dinerId,
    kind: p.kind,
    method: p.method,
    status: p.status,
    amount: ledger.paymentAmount(p),
    tipPercent: p.tipPercent,
    tipAmount: ledger.tipAmount(p),
    claims: p.claims.map((c) => toClaimDTO(ledger, c)),
    splitId: p.splitId,
    shareIndices: [...p.shareIndices],
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    posnetRequestedAt: p.posnetRequestedAt,
    paidAt: p.paidAt,
    confirmedBy: p.confirmedBy,
    staffName: staff?.name ?? null,
    dismissed: p.dismissed,
  };
}

export function toSplitDTO(ledger: Ledger, split: Split): SplitDTO {
  return {
    id: split.id,
    createdBy: split.createdBy,
    parts: split.parts,
    total: ledger.splitTotal(split),
    status: split.status,
    createdAt: split.createdAt,
    shares: ledger.shares(split).map((s) => ({
      index: s.index,
      amount: s.amount,
      state: s.state,
      dinerId: s.payment?.dinerId ?? null,
      paymentId: s.payment?.id ?? null,
    })),
  };
}

export function toDinerDTO(d: Diner): DinerDTO {
  return { id: d.id, name: d.name, color: d.color, joinedAt: d.joinedAt };
}

export function toMenuItemDTO(m: MenuItem): MenuItemDTO {
  return {
    id: m.id,
    categoryId: m.categoryId,
    name: m.name,
    description: m.description,
    price: m.price,
    promoPrice: m.promoPrice,
    promoLabel: m.promoLabel,
    imageUrl: m.imageUrl,
    available: m.available,
    sort: m.sort,
  };
}

export function toStaffDTO(s: StaffUser): StaffUserDTO {
  return { id: s.id, name: s.name, email: s.email, role: s.role, active: s.active, createdAt: s.createdAt };
}

export function buildSnapshot(db: DB, sessionId: string, now: Date): SessionSnapshot {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Sesión inexistente: ${sessionId}`);
  const table = db.tables.find((t) => t.id === session.tableId)!;
  const ledger = new Ledger(db, sessionId);
  const bill = ledger.summary();

  const items: OrderItemDTO[] = ledger.items
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => ({
      id: item.id,
      orderId: item.orderId,
      menuItemId: item.menuItemId,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      note: item.note,
      status: item.status,
      dinerId: item.dinerId,
      createdAt: item.createdAt,
      units:
        item.status === 'CANCELLED'
          ? []
          : Array.from({ length: item.quantity }, (_, u) => {
              const unit = ledger.unit(item, u);
              return {
                unitIndex: u,
                price: item.unitPrice,
                denominator: unit.denominator,
                paid: unit.portions.filter((p) => p.state === 'PAID').reduce((s, p) => s + p.amount, 0),
                portions: unit.portions.map((p) => ({
                  index: p.index,
                  amount: p.amount,
                  state: p.state,
                  dinerId: p.owner?.kind === 'payment' ? p.owner.payment.dinerId : null,
                  paymentId: p.owner?.kind === 'payment' ? p.owner.payment.id : null,
                  splitId: p.owner?.kind === 'split' ? p.owner.split.id : null,
                })),
              };
            }),
    }));

  const activeSplit = ledger.activeSplit;
  return {
    sessionId,
    table: { id: table.id, number: table.number, label: table.label },
    status: session.status,
    settled: bill.total > 0 && bill.outstanding === 0,
    openedAt: session.openedAt,
    diners: db.diners.filter((d) => d.sessionId === sessionId).map(toDinerDTO),
    items,
    payments: ledger.payments
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => toPaymentDTO(db, ledger, p)),
    activeSplit: activeSplit ? toSplitDTO(ledger, activeSplit) : null,
    bill,
    serverTime: now.toISOString(),
  };
}
