import type { DinerDTO, ItemStatus, OrderItemDTO, SessionSnapshot } from '../../../shared/types.ts';
import { Avatar, Empty } from '../components/ui.tsx';
import { ITEM_STATUS_LABEL, clock, money, plural } from '../lib/format.ts';

const STATUS_BADGE: Record<ItemStatus, string> = {
  PENDING: 'badge-warn',
  PREPARING: 'badge-accent',
  DELIVERED: 'badge-ok',
  CANCELLED: '',
};

export function BillSummaryCard({ snapshot }: { snapshot: SessionSnapshot }) {
  const { bill } = snapshot;
  const pct = (v: number) => (bill.total > 0 ? `${(v / bill.total) * 100}%` : '0%');
  return (
    <div className="card card-pad stack">
      <div className="row-between" style={{ alignItems: 'flex-end' }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="small muted">Saldo pendiente de la mesa</span>
          <span className="hero-amount">{money(bill.outstanding)}</span>
        </div>
        {snapshot.settled && <span className="badge badge-ok">Mesa saldada ✓</span>}
      </div>
      <div className="progress" aria-hidden="true">
        <span className="p-paid" style={{ width: pct(bill.paid) }} />
        <span className="p-reserved" style={{ width: pct(bill.reserved) }} />
      </div>
      <div className="legend num">
        <span>
          <span className="dot" style={{ background: 'var(--ok)' }} />
          Abonado {money(bill.paid)}
        </span>
        <span>
          <span className="dot" style={{ background: 'var(--accent)' }} />
          Pagando ahora {money(bill.reserved)}
        </span>
        <span>
          <span className="dot" style={{ background: 'var(--surface-3)' }} />
          Total {money(bill.total)}
        </span>
      </div>
    </div>
  );
}

export function UnitBar({ item }: { item: OrderItemDTO }) {
  // Una barrita por porción de cada unidad, coloreada según su estado.
  const segments = item.units.flatMap((u) =>
    u.denominator === null ? [{ key: `${u.unitIndex}`, state: 'AVAILABLE', flex: 1 }] : u.portions.map((p) => ({ key: `${u.unitIndex}-${p.index}`, state: p.state, flex: 1 / u.denominator! })),
  );
  return (
    <div className="unit-bar" aria-hidden="true">
      {segments.map((s) => (
        <span key={s.key} className={`s-${s.state}`} style={{ flex: s.flex }} />
      ))}
    </div>
  );
}

export function TableTab({
  snapshot,
  me,
  diners,
  onPay,
}: {
  snapshot: SessionSnapshot;
  me: string;
  diners: Map<string, DinerDTO>;
  onPay: () => void;
}) {
  const items = snapshot.items.slice().reverse();
  const split = snapshot.activeSplit;
  return (
    <main className="diner-main">
      {snapshot.settled && (
        <div className="banner banner-ok">
          <span className="banner-icon">🎉</span>
          <div>
            <h3>¡La mesa está saldada!</h3>
            <p className="small">No queda nada por pagar. Si piden algo más, se suma acá.</p>
          </div>
        </div>
      )}

      <BillSummaryCard snapshot={snapshot} />

      {split && (
        <button className="banner banner-split" style={{ border: 'none', textAlign: 'left' }} onClick={onPay}>
          <span className="banner-icon">➗</span>
          <div className="grow">
            <h3>Están dividiendo el saldo en {split.parts}</h3>
            <p className="small">
              {split.shares.filter((s) => s.state === 'PAID').length} de {split.parts} partes abonadas ·{' '}
              {money(split.shares[split.shares.length - 1]!.amount)} cada una. Tocá para tomar tu parte.
            </p>
          </div>
        </button>
      )}

      {snapshot.bill.outstanding > 0 && (
        <button className="btn btn-primary btn-lg btn-block" onClick={onPay}>
          Pagar mi parte
        </button>
      )}

      <div className="section-title">
        <h2>Lo que pidió la mesa</h2>
        <span className="small muted">{plural(snapshot.items.filter((i) => i.status !== 'CANCELLED').length, 'ítem', 'ítems')}</span>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <Empty emoji="🍽️" title="Todavía no pidieron nada">
            Lo que pida cualquiera de la mesa aparece acá en vivo.
          </Empty>
        </div>
      ) : (
        <div className="card list">
          {items.map((item) => {
            const who = diners.get(item.dinerId);
            const paid = item.units.reduce((s, u) => s + u.paid, 0);
            const total = item.unitPrice * item.quantity;
            return (
              <div key={item.id} className="bill-item" style={item.status === 'CANCELLED' ? { opacity: 0.5 } : undefined}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow stack-sm" style={{ gap: 2 }}>
                    <strong className={item.status === 'CANCELLED' ? 'strike' : undefined}>
                      {item.quantity > 1 && <span className="num">{item.quantity} × </span>}
                      {item.name}
                    </strong>
                    {item.note && <span className="small muted">“{item.note}”</span>}
                    <span className="row small muted" style={{ gap: 6 }}>
                      {who && <Avatar name={who.name} color={who.color} size="sm" />}
                      {who ? (who.id === me ? 'Lo pediste vos' : `Pidió ${who.name}`) : ''} · {clock(item.createdAt)}
                    </span>
                  </div>
                  <div className="stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                    <strong className="num">{money(total)}</strong>
                    <span className={`badge ${STATUS_BADGE[item.status]}`}>{ITEM_STATUS_LABEL[item.status]}</span>
                  </div>
                </div>
                {item.status !== 'CANCELLED' && (
                  <div className="stack-sm" style={{ gap: 4 }}>
                    <UnitBar item={item} />
                    {paid > 0 && (
                      <span className="tiny" style={{ color: 'var(--ok)' }}>
                        {paid >= total ? 'Pagado ✓' : `Pagado ${money(paid)} de ${money(total)}`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="section-title">
        <h2>En la mesa</h2>
      </div>
      <div className="card card-pad row wrap" style={{ gap: 14 }}>
        {snapshot.diners.map((d) => (
          <span key={d.id} className="row" style={{ gap: 6 }}>
            <Avatar name={d.name} color={d.color} />
            <span className="small">
              {d.name}
              {d.id === me ? ' (vos)' : ''}
            </span>
          </span>
        ))}
      </div>
    </main>
  );
}
