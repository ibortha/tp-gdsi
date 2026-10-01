import { ArrowRight, CaretRight, Check, CookingPot, Flame, ForkKnife, X } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import type { ItemStatus, OrderItemDTO, SessionSnapshot } from '../../../shared/types.ts';
import { Avatar, Donut, Empty, Money } from '../components/ui.tsx';
import { clock, money } from '../lib/format.ts';
import type { Person } from '../lib/tones.ts';
import { pad } from './DinerApp.tsx';
import type { DinerSession } from './useDinerSession.ts';

const STATUS: Record<ItemStatus, { label: string; icon: React.ReactNode; className: string }> = {
  PENDING: { label: 'En cocina', icon: <CookingPot size={14} />, className: 'is-pending' },
  PREPARING: { label: 'Preparando', icon: <Flame size={14} />, className: 'is-preparing' },
  DELIVERED: { label: 'Servido', icon: <Check size={14} weight="bold" />, className: 'is-done' },
  CANCELLED: { label: 'Cancelado', icon: <X size={14} />, className: 'is-void' },
};

export function StatusLabel({ status }: { status: ItemStatus }) {
  const s = STATUS[status];
  return (
    <span className={clsx('status', s.className)}>
      {s.icon}
      {s.label}
    </span>
  );
}

/** Barra fina con una marca por porción: verde pagado, pimentón reservado, azul en la división. */
export function SliceBar({ item }: { item: OrderItemDTO }) {
  const segments = item.units.flatMap((u) =>
    u.denominator === null
      ? [{ key: `${u.unitIndex}`, state: 'AVAILABLE', flex: 1 }]
      : u.portions.map((p) => ({ key: `${u.unitIndex}-${p.index}`, state: p.state, flex: 1 / u.denominator! })),
  );
  return (
    <div className="slicebar" aria-hidden="true">
      {segments.map((s) => (
        <span key={s.key} className={`sb-${s.state}`} style={{ flex: s.flex }} />
      ))}
    </div>
  );
}

export function BillMeter({ snapshot }: { snapshot: SessionSnapshot }) {
  const { bill } = snapshot;
  const rest = Math.max(bill.total - bill.paid - bill.reserved, 0);
  return (
    <div className="stack stack-2">
      <div className="meter" aria-hidden="true">
        <span className="meter__paid" style={{ flexGrow: bill.paid }} />
        <span className="meter__reserved" style={{ flexGrow: bill.reserved }} />
        <span className="meter__rest" style={{ flexGrow: bill.total === 0 ? 1 : rest }} />
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--ok)' }} />
          Pagado {money(bill.paid)}
        </span>
        {bill.reserved > 0 && (
          <span>
            <i style={{ background: 'var(--accent)' }} />
            Pagando {money(bill.reserved)}
          </span>
        )}
        <span>
          <i style={{ background: 'var(--paper-3)' }} />
          Total {money(bill.total)}
        </span>
      </div>
    </div>
  );
}

export function TableTab({
  session,
  me,
  people,
  onPay,
}: {
  session: DinerSession;
  me: string;
  people: Map<string, Person>;
  onPay: () => void;
}) {
  const snapshot = session.snapshot!;
  const { bill } = snapshot;
  const split = snapshot.activeSplit;
  const items = snapshot.items.slice().reverse();
  const now = new Date(snapshot.serverTime);

  return (
    <main className="d-main">
      <section className="bill-hero">
        <span className="eyebrow">Saldo de la mesa</span>
        <div className="display bill-hero__amount">
          <Money cents={bill.outstanding} />
        </div>
        <BillMeter snapshot={snapshot} />
        {bill.outstanding > 0 && (
          <button className="btn btn--accent btn--lg btn--block btn--split" onClick={onPay}>
            Pagar mi parte
            <ArrowRight size={18} weight="bold" />
          </button>
        )}
      </section>

      {split && (
        <button className="split-banner" onClick={onPay}>
          <Donut
            size={52}
            segments={split.shares.map((s) => ({
              key: String(s.index),
              color: s.state === 'PAID' ? 'var(--ok)' : s.state === 'RESERVED' ? 'var(--accent)' : 'var(--paper-3)',
            }))}
          />
          <span className="grow stack stack-1" style={{ textAlign: 'left' }}>
            <strong>Están dividiendo en {split.parts}</strong>
            <span className="small muted">
              {split.shares.filter((s) => s.state === 'PAID').length} de {split.parts} pagadas · {money(split.shares[0]!.amount)} cada parte
            </span>
          </span>
          <CaretRight size={18} />
        </button>
      )}

      <section className="receipt-wrap">
        <div className="receipt">
          <header className="receipt__head">
            <div className="stack stack-1">
              <span className="eyebrow">Cuenta compartida</span>
              <h2 className="display receipt__title">Mesa {pad(snapshot.table.number)}</h2>
            </div>
            <div className="receipt__stamp-info mono tiny faint">
              {session.venue?.name}
              <br />
              {now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} · {clock(snapshot.serverTime)}
            </div>
          </header>
          <hr className="rule" />
          {items.length === 0 ? (
            <Empty icon={<ForkKnife size={24} />} title="La mesa está vacía">
              Lo que pida cualquiera aparece acá, en vivo.
            </Empty>
          ) : (
            <ul className="rlines">
              <AnimatePresence initial={false}>
                {items.map((item) => {
                  const who = people.get(item.dinerId);
                  const paid = item.units.reduce((s, u) => s + u.paid, 0);
                  const total = item.unitPrice * item.quantity;
                  const cancelled = item.status === 'CANCELLED';
                  return (
                    <motion.li
                      key={item.id}
                      layout
                      className={clsx('rline', cancelled && 'is-void')}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="rline__main">
                        <span className="rline__qty mono">{item.quantity}×</span>
                        <span className="rline__name">{item.name}</span>
                        <span className="rline__price mono">{money(total)}</span>
                      </div>
                      <div className="rline__meta">
                        {who && <Avatar name={who.name} tone={who.tone} size="sm" />}
                        <span>{who ? (who.id === me ? 'Vos' : who.name) : '—'}</span>
                        <span className="faint">·</span>
                        <StatusLabel status={item.status} />
                        {paid > 0 && !cancelled && (
                          <span className="rline__paid">{paid >= total ? 'Pagado' : `${money(paid)} pagado`}</span>
                        )}
                      </div>
                      {item.note && <p className="rline__note">“{item.note}”</p>}
                      {!cancelled && <SliceBar item={item} />}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
          <hr className="rule" />
          <dl className="totals">
            <div>
              <dt>Total</dt>
              <dd className="mono">{money(bill.total)}</dd>
            </div>
            <div>
              <dt>Pagado</dt>
              <dd className="mono">− {money(bill.paid)}</dd>
            </div>
            {bill.tips > 0 && (
              <div className="faint">
                <dt>Propinas</dt>
                <dd className="mono">{money(bill.tips)}</dd>
              </div>
            )}
            <div className="totals__strong">
              <dt>Saldo</dt>
              <dd className="mono">{money(bill.outstanding)}</dd>
            </div>
          </dl>
          <AnimatePresence>
            {snapshot.settled && (
              <motion.div
                className="receipt__stamp"
                initial={{ scale: 1.6, opacity: 0, rotate: -14 }}
                animate={{ scale: 1, opacity: 1, rotate: -6 }}
                transition={{ type: 'spring', stiffness: 380, damping: 18 }}
              >
                <span className="stamp">
                  <Check size={14} weight="bold" /> Saldada
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="stack stack-2">
        <span className="eyebrow">En la mesa · {snapshot.diners.length}</span>
        <div className="people">
          {[...people.values()].map((p) => (
            <span key={p.id} className="person">
              <Avatar name={p.name} tone={p.tone} />
              {p.name}
              {p.id === me && <span className="faint">(vos)</span>}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
