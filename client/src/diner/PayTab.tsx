import { ArrowRight, Check, CheckCircle, Hourglass, Lock, Plus, Receipt } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { Denominator, OrderItemDTO, PaymentDTO, PortionDTO, UnitDTO } from '../../../shared/types.ts';
import {
  Avatar,
  BigStepper,
  CountdownRing,
  Donut,
  Empty,
  Money,
  Segmented,
  Stepper,
  useAction,
} from '../components/ui.tsx';
import { METHOD_LABEL, clock, money, plural } from '../lib/format.ts';
import { useNow } from '../lib/hooks.ts';
import type { Person } from '../lib/tones.ts';
import { Checkout } from './Checkout.tsx';
import { BillMeter } from './TableTab.tsx';
import type { DinerSession } from './useDinerSession.ts';

type Mode = 'items' | 'split';

const inProgress = (p: PaymentDTO) => p.status === 'RESERVED' || p.status === 'AWAITING_POSNET';
const FRACTION: Record<Denominator, string> = { 1: 'Entero', 2: '½', 3: '⅓' };

export function PayTab({
  session,
  me,
  people,
  onGoToMenu,
}: {
  session: DinerSession;
  me: string;
  people: Map<string, Person>;
  onGoToMenu: () => void;
}) {
  const snapshot = session.snapshot!;
  const mine = snapshot.payments.filter((p) => p.dinerId === me);
  const current = mine.find(inProgress);
  const lastMine = mine[mine.length - 1];
  const expired = lastMine?.status === 'EXPIRED' && !lastMine.dismissed ? lastMine : undefined;

  const [mode, setMode] = useState<Mode>(() => (current?.kind === 'SPLIT' || snapshot.activeSplit ? 'split' : 'items'));
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [paidId, setPaidId] = useState<string | null>(null);

  useEffect(() => {
    if (current) setMode(current.kind === 'SPLIT' ? 'split' : 'items');
  }, [current?.id, current?.kind]);

  // Sigue el pago que está en el checkout (también cuando lo confirma el mozo con el Posnet).
  const watched = checkoutId ? snapshot.payments.find((p) => p.id === checkoutId) : undefined;
  useEffect(() => {
    if (!watched) return;
    if (watched.status === 'PAID') {
      setPaidId(watched.id);
      setCheckoutId(null);
    } else if (!inProgress(watched)) setCheckoutId(null);
  }, [watched?.id, watched?.status]);

  if (paidId) {
    const paid = snapshot.payments.find((p) => p.id === paidId);
    if (paid)
      return (
        <PaidScreen payment={paid} name={people.get(me)?.name ?? ''} outstanding={snapshot.bill.outstanding} onDone={() => setPaidId(null)} />
      );
  }

  if (current && (checkoutId === current.id || current.status === 'AWAITING_POSNET')) {
    return (
      <Checkout
        session={session}
        payment={current}
        onBack={() => setCheckoutId(null)}
        onPaid={(id) => {
          setPaidId(id);
          setCheckoutId(null);
        }}
      />
    );
  }

  const { bill } = snapshot;

  return (
    <main className={clsx('d-main', current && 'has-dock')}>
      <section className="page-head">
        <span className="eyebrow">Pagar</span>
        <h1 className="display page-title">
          ¿Qué <em>pagás</em> vos?
        </h1>
      </section>

      {expired && <ExpiredNotice session={session} payment={expired} onPaid={setPaidId} />}

      {bill.total === 0 ? (
        <Empty icon={<Receipt size={24} />} title="Todavía no hay cuenta">
          <button className="text-btn" onClick={onGoToMenu}>
            Ir a la carta
          </button>
        </Empty>
      ) : bill.outstanding === 0 ? (
        <div className="notice notice--ok">
          <span className="notice__icon">
            <CheckCircle size={22} weight="fill" />
          </span>
          <div className="stack stack-1">
            <h3>La mesa está saldada</h3>
            <p className="small muted">No queda nada por pagar. Si piden algo más, aparece acá.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card card--pad stack stack-4">
            <div className="between" style={{ alignItems: 'baseline' }}>
              <span className="eyebrow">Saldo pendiente</span>
              <strong className="display" style={{ fontSize: 30 }}>
                <Money cents={bill.outstanding} />
              </strong>
            </div>
            <BillMeter snapshot={snapshot} />
          </div>
          <Segmented<Mode>
            label="Cómo querés pagar"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'items', label: 'Por ítems' },
              { value: 'split', label: 'Dividir el total' },
            ]}
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, x: mode === 'items' ? -12 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {mode === 'items' ? (
                <ItemsMode session={session} me={me} people={people} current={current} />
              ) : (
                <SplitMode session={session} me={me} people={people} current={current} />
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      <AnimatePresence>
        {current && <SelectionDock key="dock" session={session} payment={current} onContinue={() => setCheckoutId(current.id)} />}
      </AnimatePresence>
    </main>
  );
}

// ---------- Dock con lo reservado y la cuenta regresiva ----------

function SelectionDock({ session, payment, onContinue }: { session: DinerSession; payment: PaymentDTO; onContinue: () => void }) {
  const now = useNow(250);
  const ttl = (session.venue?.reservationTtlSec ?? 60) * 1000;
  const remaining = payment.expiresAt
    ? Math.min(ttl, Date.parse(payment.expiresAt) - (now + (session.serverNow() - Date.now())))
    : null;
  const what =
    payment.kind === 'SPLIT' ? plural(payment.shareIndices.length, 'parte', 'partes') : plural(payment.claims.length, 'porción', 'porciones');
  return (
    <motion.div
      className="dock dock--select"
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
    >
      {remaining !== null && <CountdownRing remainingMs={remaining} totalMs={ttl} />}
      <div className="grow stack" style={{ gap: 0 }}>
        <span className="dock__label">Reservaste {what}</span>
        <Money cents={payment.amount} className="dock__amount" />
      </div>
      <button className="btn btn--accent" onClick={onContinue}>
        Pagar
        <ArrowRight size={18} weight="bold" />
      </button>
    </motion.div>
  );
}

function ExpiredNotice({ session, payment, onPaid }: { session: DinerSession; payment: PaymentDTO; onPaid: (id: string) => void }) {
  const { run, busy } = useAction();
  const declared = payment.method === 'MERCADO_PAGO' || payment.method === 'QR';
  return (
    <motion.div className="notice notice--warn" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <span className="notice__icon">
        <Hourglass size={20} weight="duotone" />
      </span>
      <div className="stack stack-2">
        <h3>Se venció tu reserva de {money(payment.amount)}</h3>
        <p className="small muted">
          {declared
            ? `Si ya pagaste con ${METHOD_LABEL[payment.method!]}, confirmalo: lo registramos si nadie tomó esas porciones.`
            : 'Lo liberamos para el resto de la mesa. Podés volver a elegir.'}
        </p>
        <div className="row wrap" style={{ marginTop: 4 }}>
          {declared && (
            <button
              className="btn btn--ink btn--sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await session.act(`/api/diner/payments/${payment.id}/confirm`);
                  onPaid(payment.id);
                })
              }
            >
              Ya pagué
            </button>
          )}
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => session.act(`/api/diner/payments/${payment.id}/cancel`))}>
            {declared ? 'No pagué' : 'Entendido'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ---------- Por ítems ----------

function ItemsMode({
  session,
  me,
  people,
  current,
}: {
  session: DinerSession;
  me: string;
  people: Map<string, Person>;
  current: PaymentDTO | undefined;
}) {
  const snapshot = session.snapshot!;
  const { run, busy } = useAction();
  const [showPaid, setShowPaid] = useState(false);
  const blocked = !!current && (current.kind !== 'ITEMS' || current.status === 'AWAITING_POSNET');

  const payments = useMemo(() => new Map(snapshot.payments.map((p) => [p.id, p])), [snapshot.payments]);
  const billable = snapshot.items.filter((i) => i.status !== 'CANCELLED');
  const isDone = (u: UnitDTO) => u.denominator !== null && u.portions.every((p) => p.state === 'PAID');
  const isFree = (u: UnitDTO) => u.denominator === null || u.portions.some((p) => p.state === 'AVAILABLE');
  const pending = billable.flatMap((item) => item.units.filter((u) => !isDone(u)).map((unit) => ({ item, unit })));
  const done = billable.flatMap((item) => item.units.filter(isDone).map((unit) => ({ item, unit })));
  const groupable = snapshot.diners.filter((d) => billable.some((i) => i.dinerId === d.id && i.units.some(isFree)));

  const claim = (item: OrderItemDTO, unit: UnitDTO, denominator: Denominator) =>
    run(() => session.act('/api/diner/claims', { orderItemId: item.id, unitIndex: unit.unitIndex, denominator }));
  const release = (item: OrderItemDTO, unit: UnitDTO, portion: PortionDTO) =>
    run(() => session.act('/api/diner/claims/release', { orderItemId: item.id, unitIndex: unit.unitIndex, portionIndex: portion.index }));

  return (
    <div className="stack stack-6">
      {blocked ? (
        <div className="notice notice--warn">
          <span className="notice__icon">
            <Lock size={20} />
          </span>
          <p className="small">
            {current!.status === 'AWAITING_POSNET'
              ? 'Estás esperando al mozo con el Posnet.'
              : 'Tenés partes de la división reservadas. Pagalas o soltalas para elegir ítems.'}
          </p>
        </div>
      ) : (
        <p className="hint">
          Tocá lo que pagás: entero, mitad o tercio. Lo que elegís queda reservado {session.venue?.reservationTtlSec ?? 60} s
          para vos.
        </p>
      )}

      {groupable.length > 0 && !blocked && (
        <div className="chips" aria-label="Atajos">
          {groupable.map((d) => {
            const p = people.get(d.id);
            return (
              <button key={d.id} className="chip" disabled={busy} onClick={() => run(() => session.act(`/api/diner/claims/of/${d.id}`))}>
                {p && <Avatar name={p.name} tone={p.tone} />}
                {d.id === me ? 'Todo lo mío' : `Lo de ${d.name}`}
              </button>
            );
          })}
        </div>
      )}

      {pending.length === 0 ? (
        <Empty icon={<CheckCircle size={24} />} title="Todo lo pedido está pago" />
      ) : (
        <ul className="units">
          {pending.map(({ item, unit }) => (
            <UnitRow
              key={`${item.id}-${unit.unitIndex}`}
              item={item}
              unit={unit}
              me={me}
              current={current}
              people={people}
              payments={payments}
              disabled={busy || blocked}
              onClaim={(d) => claim(item, unit, d)}
              onRelease={(p) => release(item, unit, p)}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="stack stack-2">
          <button className="text-btn" style={{ justifySelf: 'start' }} onClick={() => setShowPaid(!showPaid)}>
            {showPaid ? 'Ocultar' : 'Ver'} lo ya pagado ({done.length})
          </button>
          <AnimatePresence>
            {showPaid && (
              <motion.ul className="paid-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                {done.map(({ item, unit }) => (
                  <li key={`${item.id}-${unit.unitIndex}`} className="between">
                    <span className="small">
                      {item.name}
                      {item.quantity > 1 ? ` · ${unit.unitIndex + 1}/${item.quantity}` : ''}
                    </span>
                    <span className="tag tag--ok">
                      <Check size={12} weight="bold" />
                      {money(unit.price)}
                    </span>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function UnitRow({
  item,
  unit,
  me,
  current,
  people,
  payments,
  disabled,
  onClaim,
  onRelease,
}: {
  item: OrderItemDTO;
  unit: UnitDTO;
  me: string;
  current: PaymentDTO | undefined;
  people: Map<string, Person>;
  payments: Map<string, PaymentDTO>;
  disabled: boolean;
  onClaim: (d: Denominator) => void;
  onRelease: (p: PortionDTO) => void;
}) {
  const who = people.get(item.dinerId);
  const title = `${item.name}${item.quantity > 1 ? ` · ${unit.unitIndex + 1}/${item.quantity}` : ''}`;
  const mineCount = unit.portions.filter((p) => current && p.paymentId === current.id).length;
  return (
    <motion.li layout className={clsx('unit', mineCount > 0 && 'is-mine')}>
      <div className="unit__head">
        <div className="grow stack" style={{ gap: 2 }}>
          <h3 className="unit__name">{title}</h3>
          <span className="unit__meta">
            {who && <Avatar name={who.name} tone={who.tone} size="sm" />}
            {who ? (who.id === me ? 'Lo pediste vos' : `Pidió ${who.name}`) : ''}
          </span>
        </div>
        <span className="mono unit__price">{money(unit.price)}</span>
      </div>

      {unit.denominator === null ? (
        <div className="fractions">
          {([1, 2, 3] as const).map((d) => (
            <button key={d} className="fraction" disabled={disabled} onClick={() => onClaim(d)} aria-label={`Pagar ${FRACTION[d]} de ${title}`}>
              <span className="fraction__label">{FRACTION[d]}</span>
              <span className="fraction__price mono">{money(Math.ceil(unit.price / d))}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="slices">
          {unit.portions.map((p) => {
            const owner = p.dinerId ? people.get(p.dinerId) : undefined;
            const frac = FRACTION[unit.denominator!];
            if (p.state === 'AVAILABLE')
              return (
                <button key={p.index} className="slice slice--free" disabled={disabled} onClick={() => onClaim(unit.denominator!)} aria-label={`Tomar ${frac} de ${title}`}>
                  <span className="slice__frac">
                    {frac} · {money(p.amount)}
                  </span>
                  <span className="slice__who">
                    <Plus size={12} weight="bold" /> Tomar
                  </span>
                </button>
              );
            if (p.state === 'RESERVED' && current && p.paymentId === current.id)
              return (
                <button key={p.index} className="slice slice--mine" disabled={disabled || current.status !== 'RESERVED'} onClick={() => onRelease(p)} aria-label={`Soltar ${frac} de ${title}`}>
                  <span className="slice__frac">
                    {frac} · {money(p.amount)}
                  </span>
                  <span className="slice__who">
                    <Check size={12} weight="bold" /> Tuyo
                  </span>
                </button>
              );
            const label =
              p.state === 'PAID'
                ? owner
                  ? owner.id === me
                    ? 'Pagaste'
                    : `Pagó ${owner.name}`
                  : 'Pagado'
                : p.state === 'IN_SPLIT'
                  ? 'En la división'
                  : p.paymentId && payments.get(p.paymentId)?.status === 'AWAITING_POSNET'
                    ? `${owner?.name ?? 'Alguien'} · Posnet`
                    : owner?.id === me
                      ? 'Reservado por vos'
                      : `${owner?.name ?? 'Alguien'}`;
            const cls = p.state === 'PAID' ? 'slice--paid' : p.state === 'IN_SPLIT' ? 'slice--split' : 'slice--taken';
            return (
              <div key={p.index} className={clsx('slice', cls)}>
                <span className="slice__frac">
                  {frac} · {money(p.amount)}
                </span>
                <span className="slice__who">
                  {p.state === 'PAID' ? <Check size={12} weight="bold" /> : p.state === 'RESERVED' ? <Lock size={12} weight="bold" /> : null}
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </motion.li>
  );
}

// ---------- Dividir el total ----------

function SplitMode({
  session,
  me,
  people,
  current,
}: {
  session: DinerSession;
  me: string;
  people: Map<string, Person>;
  current: PaymentDTO | undefined;
}) {
  const snapshot = session.snapshot!;
  const split = snapshot.activeSplit;
  const { run, busy } = useAction();
  const [parts, setParts] = useState(() => Math.max(1, Math.min(snapshot.diners.length, 30)));
  const [take, setTake] = useState(1);
  const hasItems = current?.kind === 'ITEMS';

  if (split) {
    const myShares = current?.kind === 'SPLIT' ? current.shareIndices.length : 0;
    const free = split.shares.filter((s) => s.state === 'AVAILABLE').length;
    const paid = split.shares.filter((s) => s.state === 'PAID').length;
    const othersReserved = split.shares.some((s) => s.state === 'RESERVED' && s.dinerId !== me);
    const creator = people.get(split.createdBy);
    const outside = snapshot.bill.unclaimed - split.shares.filter((s) => s.state === 'AVAILABLE').reduce((s, x) => s + x.amount, 0);
    return (
      <div className="stack stack-6">
        <div className="card card--pad split-live">
          <Donut
            size={176}
            segments={split.shares.map((s) => {
              const isMine = s.state === 'RESERVED' && current?.id === s.paymentId;
              return {
                key: String(s.index),
                color: s.state === 'PAID' ? 'var(--ok)' : isMine ? 'var(--accent)' : 'var(--paper-3)',
                pattern: s.state === 'RESERVED' && !isMine ? ('hatch' as const) : undefined,
              };
            })}
          >
            <div className="stack" style={{ gap: 2, justifyItems: 'center' }}>
              <strong className="display" style={{ fontSize: 44, lineHeight: 0.9 }}>
                {paid}/{split.parts}
              </strong>
              <span className="eyebrow">pagadas</span>
            </div>
          </Donut>
          <div className="stack stack-1" style={{ textAlign: 'center' }}>
            <span className="small muted">
              {creator ? (creator.id === me ? 'Dividiste' : `${creator.name} dividió`) : 'Se dividió'} {money(split.total)} en {split.parts}
            </span>
            <strong className="display" style={{ fontSize: 30 }}>
              {money(split.shares[0]!.amount)} <span className="small muted" style={{ fontFamily: 'var(--font-ui)' }}>c/u</span>
            </strong>
          </div>
          <ul className="shares">
            {split.shares.map((s) => {
              const owner = s.dinerId ? people.get(s.dinerId) : undefined;
              const isMine = s.state === 'RESERVED' && current?.id === s.paymentId;
              return (
                <li key={s.index} className={clsx('share', isMine ? 'is-mine' : `is-${s.state.toLowerCase()}`)}>
                  <span className="mono tiny">{String(s.index + 1).padStart(2, '0')}</span>
                  <span className="grow">
                    {s.state === 'AVAILABLE' ? 'Libre' : isMine ? 'Tuya' : s.state === 'PAID' ? `Pagó ${owner ? (owner.id === me ? 'vos' : owner.name) : 'el mozo'}` : `${owner?.name ?? 'Alguien'} pagando`}
                  </span>
                  <span className="mono">{money(s.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {hasItems ? (
          <div className="notice notice--warn">
            <span className="notice__icon">
              <Lock size={20} />
            </span>
            <p className="small">Tenés ítems reservados. Pagalos o soltalos para tomar partes.</p>
          </div>
        ) : current?.status === 'AWAITING_POSNET' ? null : (
          <div className="between card card--pad">
            <div className="stack stack-1">
              <strong>¿Cuántas partes pagás?</strong>
              <span className="small muted">{free + myShares > 1 ? 'Si invitás a alguien, sumá su parte.' : free + myShares === 0 ? 'No quedan partes libres.' : 'Queda una parte libre.'}</span>
            </div>
            <Stepper
              tone="ink"
              label="Partes que pagás"
              value={myShares}
              min={0}
              max={myShares + free}
              disabled={busy}
              onChange={(count) => run(() => session.act('/api/diner/split/take', { count }))}
            />
          </div>
        )}

        {outside > 0 && <p className="hint">{money(outside)} se pidieron después de dividir: se pagan desde “Por ítems”.</p>}

        {paid === 0 && !othersReserved && (
          <button className="text-btn" style={{ justifySelf: 'center' }} disabled={busy} onClick={() => run(() => session.act('/api/diner/split/cancel'), 'División cancelada')}>
            Cancelar la división
          </button>
        )}
      </div>
    );
  }

  const available = snapshot.bill.unclaimed;
  if (available === 0)
    return (
      <Empty icon={<Hourglass size={24} />} title="No queda saldo libre">
        Lo que falta lo están pagando otras personas de la mesa.
      </Empty>
    );

  const each = Math.ceil(available / parts);
  const start = (p: number, t: number) => run(() => session.act('/api/diner/split', { parts: p, take: t }));
  return (
    <div className="card split-calc">
      <div className="split-calc__top">
        <span className="eyebrow">A dividir</span>
        <strong className="display split-calc__amount">
          <Money cents={available} />
        </strong>
      </div>
      <BigStepper
        label="Cantidad de personas"
        unit={parts === 1 ? 'persona' : 'personas'}
        value={parts}
        min={1}
        max={30}
        onChange={(n) => {
          setParts(n);
          setTake((t) => Math.min(t, n));
        }}
      />
      <div className="split-calc__result">
        <span className="eyebrow">Cada parte</span>
        <strong className="mono">
          <Money cents={each} />
        </strong>
      </div>
      {parts > 1 && (
        <div className="between">
          <span className="small muted">Yo pago</span>
          <div className="row">
            <Stepper label="Partes que pagás" value={take} min={1} max={parts} onChange={setTake} />
            <span className="small muted">{take === 1 ? 'parte' : 'partes'}</span>
          </div>
        </div>
      )}
      <button className="btn btn--accent btn--lg btn--block btn--split" disabled={busy || hasItems} onClick={() => start(parts, take)}>
        <span>{parts === 1 ? 'Pagar todo' : take === 1 ? 'Dividir y pagar mi parte' : `Dividir y pagar ${take} partes`}</span>
        <ArrowRight size={18} weight="bold" />
      </button>
      {parts > 1 && (
        <button className="text-btn" style={{ justifySelf: 'center' }} disabled={busy || hasItems} onClick={() => start(1, 1)}>
          Prefiero pagar todo ({money(available)})
        </button>
      )}
      <p className="hint" style={{ textAlign: 'center' }}>
        {hasItems ? 'Primero pagá o soltá los ítems que reservaste.' : 'Se reparte lo que falta pagar. Lo que alguien ya pagó no se cobra de nuevo.'}
      </p>
    </div>
  );
}

// ---------- Pago registrado ----------

function PaidScreen({ payment, name, outstanding, onDone }: { payment: PaymentDTO; name: string; outstanding: number; onDone: () => void }) {
  return (
    <main className="d-main">
      <section className="done">
        <motion.svg width="84" height="84" viewBox="0 0 84 84" className="done__mark" initial="hidden" animate="shown" aria-hidden="true">
          <motion.circle
            cx="42"
            cy="42"
            r="38"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            variants={{ hidden: { pathLength: 0 }, shown: { pathLength: 1, transition: { duration: 0.6, ease: 'easeOut' } } }}
          />
          <motion.path
            d="M27 43 l10 10 l21 -22"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            variants={{ hidden: { pathLength: 0 }, shown: { pathLength: 1, transition: { duration: 0.35, delay: 0.45, ease: 'easeOut' } } }}
          />
        </motion.svg>
        <motion.div className="stack stack-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <h1 className="display done__title">
            Listo, <em>{name}</em>.
          </h1>
          <p className="muted">Tu pago quedó registrado para toda la mesa.</p>
        </motion.div>

        <motion.div className="receipt-wrap" style={{ width: '100%' }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <div className="receipt stub">
            <dl className="totals">
              <div>
                <dt>Tu parte</dt>
                <dd className="mono">{money(payment.amount)}</dd>
              </div>
              {payment.tipAmount > 0 && (
                <div>
                  <dt>Propina ({payment.tipPercent}%)</dt>
                  <dd className="mono">{money(payment.tipAmount)}</dd>
                </div>
              )}
              <div className="faint">
                <dt>{payment.method ? METHOD_LABEL[payment.method] : 'Pago'}</dt>
                <dd className="mono">{clock(payment.paidAt ?? payment.createdAt)}</dd>
              </div>
              <div className="totals__strong">
                <dt>Pagaste</dt>
                <dd className="mono">{money(payment.amount + payment.tipAmount)}</dd>
              </div>
            </dl>
          </div>
        </motion.div>

        <div className={clsx('notice', outstanding === 0 ? 'notice--ok' : 'notice--split')} style={{ width: '100%' }}>
          <span className="notice__icon">{outstanding === 0 ? <CheckCircle size={20} weight="fill" /> : <Receipt size={20} />}</span>
          <p className="small" style={{ alignSelf: 'center' }}>
            {outstanding === 0 ? 'La mesa quedó saldada. ¡Gracias por venir!' : `En la mesa faltan ${money(outstanding)}.`}
          </p>
        </div>
        <button className="btn btn--ink btn--lg btn--block" onClick={onDone}>
          Volver
        </button>
      </section>
    </main>
  );
}
