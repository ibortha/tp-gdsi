import { useEffect, useMemo, useState } from 'react';
import type { Denominator, DinerDTO, OrderItemDTO, PaymentDTO, PortionDTO, UnitDTO } from '../../../shared/types.ts';
import { Avatar, Empty, Stepper, useAction } from '../components/ui.tsx';
import { FRACTION_LABEL, METHOD_LABEL, countdown, money, plural } from '../lib/format.ts';
import { useNow } from '../lib/hooks.ts';
import { Checkout } from './Checkout.tsx';
import { BillSummaryCard } from './TableTab.tsx';
import type { DinerSession } from './useDinerSession.ts';

type Mode = 'items' | 'split';

const inProgress = (p: PaymentDTO) => p.status === 'RESERVED' || p.status === 'AWAITING_POSNET';

export function PayTab({
  session,
  me,
  diners,
  onGoToMenu,
}: {
  session: DinerSession;
  me: string;
  diners: Map<string, DinerDTO>;
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

  // Seguimiento del pago que está en la pantalla de checkout (también cuando lo confirma el mozo con el Posnet).
  const watched = checkoutId ? snapshot.payments.find((p) => p.id === checkoutId) : undefined;
  useEffect(() => {
    if (!watched) return;
    if (watched.status === 'PAID') {
      setPaidId(watched.id);
      setCheckoutId(null);
    } else if (!inProgress(watched)) {
      setCheckoutId(null);
    }
  }, [watched?.id, watched?.status]);

  if (paidId) {
    const paid = snapshot.payments.find((p) => p.id === paidId);
    if (paid) return <PaidScreen payment={paid} name={diners.get(me)?.name ?? ''} outstanding={snapshot.bill.outstanding} onDone={() => setPaidId(null)} />;
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

  const nothingToPay = snapshot.bill.total === 0;

  return (
    <main className={`diner-main${current ? ' has-floating' : ''}`}>
      {expired && <ExpiredBanner session={session} payment={expired} onPaid={setPaidId} />}

      <BillSummaryCard snapshot={snapshot} />

      {nothingToPay ? (
        <div className="card">
          <Empty emoji="🍺" title="Todavía no hay nada para pagar">
            <button className="link-btn" onClick={onGoToMenu}>
              Ir al menú
            </button>
          </Empty>
        </div>
      ) : snapshot.bill.outstanding === 0 ? (
        <div className="banner banner-ok">
          <span className="banner-icon">🎉</span>
          <div>
            <h3>¡No queda nada por pagar!</h3>
            <p className="small">La mesa está saldada.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="seg" role="group" aria-label="Cómo querés pagar">
            <button aria-pressed={mode === 'items'} onClick={() => setMode('items')}>
              Elegir ítems
            </button>
            <button aria-pressed={mode === 'split'} onClick={() => setMode('split')}>
              Dividir el total
            </button>
          </div>
          {mode === 'items' ? (
            <ItemsMode session={session} me={me} diners={diners} current={current} />
          ) : (
            <SplitMode session={session} me={me} diners={diners} current={current} />
          )}
        </>
      )}

      {current && <SelectionBar session={session} payment={current} onContinue={() => setCheckoutId(current.id)} />}
    </main>
  );
}

// ---------- Barra con la selección en curso y la cuenta regresiva ----------

function SelectionBar({ session, payment, onContinue }: { session: DinerSession; payment: PaymentDTO; onContinue: () => void }) {
  const now = useNow(250);
  const ttl = (session.venue?.reservationTtlSec ?? 60) * 1000;
  const remaining = payment.expiresAt
    ? Math.min(ttl, Date.parse(payment.expiresAt) - (now + (session.serverNow() - Date.now())))
    : null;
  const what =
    payment.kind === 'SPLIT'
      ? plural(payment.shareIndices.length, 'parte', 'partes')
      : plural(payment.claims.length, 'porción', 'porciones');
  return (
    <div className="floating-bar">
      <div className="selection-bar">
        <div className="grow stack-sm" style={{ gap: 2 }}>
          <span className="small" style={{ opacity: 0.75 }}>
            Reservaste {what}
          </span>
          <strong className="num" style={{ fontSize: '1.15rem' }}>
            {money(payment.amount)}
          </strong>
        </div>
        {remaining !== null && (
          <span className={`timer${remaining < 15000 ? ' urgent' : ''}`} aria-label="Tiempo de reserva">
            ⏱ {countdown(remaining)}
          </span>
        )}
        <button className="btn btn-primary" onClick={onContinue}>
          Pagar →
        </button>
      </div>
    </div>
  );
}

function ExpiredBanner({ session, payment, onPaid }: { session: DinerSession; payment: PaymentDTO; onPaid: (id: string) => void }) {
  const { run, busy } = useAction();
  const declared = payment.method === 'MERCADO_PAGO' || payment.method === 'QR';
  return (
    <div className="banner banner-warn">
      <span className="banner-icon">⌛</span>
      <div className="grow stack-sm">
        <h3>Tu reserva de {money(payment.amount)} venció</h3>
        <p className="small">
          {declared
            ? `Pasó el tiempo sin que confirmes el pago con ${METHOD_LABEL[payment.method!]}. Si ya pagaste, tocá "Ya pagué": lo registramos si nadie más tomó esas porciones.`
            : 'Se liberó para que otra persona de la mesa pueda tomarla. Podés volver a elegir.'}
        </p>
        <div className="row wrap">
          {declared && (
            <button
              className="btn btn-primary btn-sm"
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
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => session.act(`/api/diner/payments/${payment.id}/cancel`))}>
            {declared ? 'No pagué, descartar' : 'Entendido'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Modo "Elegir ítems" ----------

function ItemsMode({
  session,
  me,
  diners,
  current,
}: {
  session: DinerSession;
  me: string;
  diners: Map<string, DinerDTO>;
  current: PaymentDTO | undefined;
}) {
  const snapshot = session.snapshot!;
  const { run, busy } = useAction();
  const [showPaid, setShowPaid] = useState(false);
  const blocked = current && (current.kind !== 'ITEMS' || current.status === 'AWAITING_POSNET');

  const payments = useMemo(() => new Map(snapshot.payments.map((p) => [p.id, p])), [snapshot.payments]);
  const billable = snapshot.items.filter((i) => i.status !== 'CANCELLED');
  const unitIsDone = (u: UnitDTO) => u.denominator !== null && u.portions.every((p) => p.state === 'PAID');
  const unitIsFree = (u: UnitDTO) => u.denominator === null || u.portions.some((p) => p.state === 'AVAILABLE');
  const pendingItems = billable.filter((i) => i.units.some((u) => !unitIsDone(u)));
  const paidUnits = billable.flatMap((i) => i.units.filter(unitIsDone).map((u) => ({ item: i, unit: u })));

  // Atajos para "agrupar": tomar todo lo libre de lo que pidió cada persona.
  const groupable = snapshot.diners.filter((d) => billable.some((i) => i.dinerId === d.id && i.units.some(unitIsFree)));
  const claimOf = (dinerId: string) => run(() => session.act(`/api/diner/claims/of/${dinerId}`));

  const claim = (item: OrderItemDTO, unit: UnitDTO, denominator: Denominator) =>
    run(() => session.act('/api/diner/claims', { orderItemId: item.id, unitIndex: unit.unitIndex, denominator }));
  const release = (item: OrderItemDTO, unit: UnitDTO, portion: PortionDTO) =>
    run(() => session.act('/api/diner/claims/release', { orderItemId: item.id, unitIndex: unit.unitIndex, portionIndex: portion.index }));

  return (
    <div className="stack">
      {blocked ? (
        <div className="banner banner-warn">
          <span className="banner-icon">✋</span>
          <p className="small">
            {current!.status === 'AWAITING_POSNET'
              ? 'Estás esperando al mozo con el Posnet.'
              : 'Tenés partes de la división reservadas. Pagalas o soltalas para elegir ítems.'}
          </p>
        </div>
      ) : (
        <p className="small muted">
          Tocá lo que vas a pagar: el ítem entero, la mitad o un tercio. Lo que elegís se reserva para vos y deja de estar
          disponible para el resto por {session.venue?.reservationTtlSec ?? 60} segundos.
        </p>
      )}

      {groupable.length > 0 && !blocked && (
        <div className="stack-sm">
          <span className="small muted" style={{ fontWeight: 650 }}>
            Atajos
          </span>
          <div className="chips">
            {groupable.map((d) => (
              <button key={d.id} className="chip" disabled={busy} onClick={() => claimOf(d.id)}>
                <Avatar name={d.name} color={d.color} size="sm" />
                {d.id === me ? 'Todo lo que pedí yo' : `Lo de ${d.name}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingItems.length === 0 ? (
        <div className="card">
          <Empty emoji="✅" title="Todo lo pedido ya está pago" />
        </div>
      ) : (
        <div className="card list">
          {pendingItems.flatMap((item) =>
            item.units
              .filter((u) => !unitIsDone(u))
              .map((unit) => (
                <UnitRow
                  key={`${item.id}-${unit.unitIndex}`}
                  item={item}
                  unit={unit}
                  me={me}
                  current={current}
                  diners={diners}
                  payments={payments}
                  disabled={busy || !!blocked}
                  onClaim={(d) => claim(item, unit, d)}
                  onRelease={(p) => release(item, unit, p)}
                />
              )),
          )}
        </div>
      )}

      {paidUnits.length > 0 && (
        <div className="stack-sm">
          <button className="link-btn small" style={{ justifySelf: 'start' }} onClick={() => setShowPaid(!showPaid)}>
            {showPaid ? 'Ocultar' : 'Ver'} lo ya pagado ({paidUnits.length})
          </button>
          {showPaid && (
            <div className="card list">
              {paidUnits.map(({ item, unit }) => (
                <div key={`${item.id}-${unit.unitIndex}`} className="list-item row-between small">
                  <span>
                    {item.name}
                    {item.quantity > 1 ? ` (${unit.unitIndex + 1} de ${item.quantity})` : ''}
                  </span>
                  <span className="badge badge-ok">Pagado {money(unit.price)}</span>
                </div>
              ))}
            </div>
          )}
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
  diners,
  payments,
  disabled,
  onClaim,
  onRelease,
}: {
  item: OrderItemDTO;
  unit: UnitDTO;
  me: string;
  current: PaymentDTO | undefined;
  diners: Map<string, DinerDTO>;
  payments: Map<string, PaymentDTO>;
  disabled: boolean;
  onClaim: (d: Denominator) => void;
  onRelease: (p: PortionDTO) => void;
}) {
  const who = diners.get(item.dinerId);
  const title = `${item.name}${item.quantity > 1 ? ` (${unit.unitIndex + 1} de ${item.quantity})` : ''}`;
  return (
    <div className="unit-row">
      <div className="row-between">
        <div className="grow">
          <strong>{title}</strong>
          <div className="tiny faint">{who ? (who.id === me ? 'Lo pediste vos' : `Pidió ${who.name}`) : ''}</div>
        </div>
        <strong className="num">{money(unit.price)}</strong>
      </div>
      {unit.denominator === null ? (
        <div className="fraction-options">
          {([1, 2, 3] as const).map((d) => (
            <button key={d} className="fraction-btn" disabled={disabled} onClick={() => onClaim(d)} aria-label={`Pagar ${FRACTION_LABEL[d]} de ${title}`}>
              <span>{FRACTION_LABEL[d]}</span>
              <small className="num">{money(Math.ceil(unit.price / d))}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="portions" style={{ ['--cols' as string]: unit.denominator }}>
          {unit.portions.map((p) => {
            const owner = p.dinerId ? diners.get(p.dinerId) : undefined;
            const fraction = FRACTION_LABEL[unit.denominator!];
            if (p.state === 'AVAILABLE')
              return (
                <button key={p.index} className="portion p-AVAILABLE" disabled={disabled} onClick={() => onClaim(unit.denominator!)}>
                  <span className="num">
                    {fraction} · {money(p.amount)}
                  </span>
                  <small className="faint">Tomar</small>
                </button>
              );
            if (p.state === 'RESERVED' && current && p.paymentId === current.id)
              return (
                <button key={p.index} className="portion p-MINE" disabled={disabled || current.status !== 'RESERVED'} onClick={() => onRelease(p)}>
                  <span className="num">
                    {fraction} · {money(p.amount)} ✓
                  </span>
                  <small>Tuyo · tocá para soltar</small>
                </button>
              );
            const label =
              p.state === 'PAID'
                ? owner
                  ? `Pagó ${owner.id === me ? 'vos' : owner.name}`
                  : 'Pagado'
                : p.state === 'IN_SPLIT'
                  ? 'En la división'
                  : p.paymentId && payments.get(p.paymentId)?.status === 'AWAITING_POSNET'
                    ? `${owner?.name ?? 'Alguien'} · Posnet`
                    : `🔒 Reservado por ${owner?.id === me ? 'vos' : (owner?.name ?? 'alguien')}`;
            return (
              <div key={p.index} className={`portion p-${p.state}`}>
                <span className="num">
                  {fraction} · {money(p.amount)}
                </span>
                <small>{label}</small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Modo "Dividir el total" ----------

function SplitMode({
  session,
  me,
  diners,
  current,
}: {
  session: DinerSession;
  me: string;
  diners: Map<string, DinerDTO>;
  current: PaymentDTO | undefined;
}) {
  const snapshot = session.snapshot!;
  const split = snapshot.activeSplit;
  const { run, busy } = useAction();
  const [parts, setParts] = useState(() => Math.max(1, Math.min(snapshot.diners.length, 30)));
  const [take, setTake] = useState(1);
  const hasItemsSelection = current?.kind === 'ITEMS';

  if (split) {
    const myShares = current?.kind === 'SPLIT' ? current.shareIndices.length : 0;
    const free = split.shares.filter((s) => s.state === 'AVAILABLE').length;
    const paid = split.shares.filter((s) => s.state === 'PAID').length;
    const othersReserved = split.shares.some((s) => s.state === 'RESERVED' && s.dinerId !== me);
    const creator = diners.get(split.createdBy);
    const outside = snapshot.bill.unclaimed - split.shares.filter((s) => s.state === 'AVAILABLE').reduce((s, x) => s + x.amount, 0);
    return (
      <div className="stack">
        <div className="card card-pad stack">
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="small muted">
              {creator ? `${creator.id === me ? 'Dividiste' : `${creator.name} dividió`}` : 'Se dividió'} el saldo en {split.parts}
            </span>
            <h2 className="num">
              {money(split.total)} → {money(split.shares[0]!.amount)} cada parte
            </h2>
            <span className="small muted">
              {paid} de {split.parts} {split.parts === 1 ? 'parte abonada' : 'partes abonadas'}
            </span>
          </div>
          <div className="share-grid">
            {split.shares.map((s) => {
              const owner = s.dinerId ? diners.get(s.dinerId) : undefined;
              const isMine = s.state === 'RESERVED' && current?.id === s.paymentId;
              const label =
                s.state === 'AVAILABLE'
                  ? 'Libre'
                  : isMine
                    ? 'Tuya'
                    : s.state === 'PAID'
                      ? owner
                        ? `Pagó ${owner.id === me ? 'vos' : owner.name}`
                        : 'Cobrada'
                      : `${owner?.name ?? 'Alguien'} pagando`;
              return (
                <div key={s.index} className={`share s-${isMine ? 'MINE' : s.state}`}>
                  <span>Parte {s.index + 1}</span>
                  <strong className="num">{money(s.amount)}</strong>
                  <span className="tiny">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {hasItemsSelection ? (
          <div className="banner banner-warn">
            <span className="banner-icon">✋</span>
            <p className="small">Tenés una selección de ítems en curso. Pagala o soltala para tomar partes de la división.</p>
          </div>
        ) : current?.status === 'AWAITING_POSNET' ? null : (
          <div className="card card-pad stack" style={{ justifyItems: 'center', textAlign: 'center' }}>
            <h3>¿Cuántas partes pagás?</h3>
            <Stepper
              large
              label="Partes que pagás"
              value={myShares}
              min={0}
              max={myShares + free}
              disabled={busy}
              onChange={(count) => run(() => session.act('/api/diner/split/take', { count }))}
            />
            <p className="small muted">
              {free === 0 && myShares === 0
                ? 'No quedan partes libres.'
                : 'Si invitás a alguien, sumá su parte. Las partes que tomás se reservan para vos.'}
            </p>
          </div>
        )}

        {outside > 0 && (
          <p className="small muted">
            Hay {money(outside)} pedidos después de dividir: no están en la división, se pagan desde “Elegir ítems”.
          </p>
        )}

        {paid === 0 && !othersReserved && (
          <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'center' }} disabled={busy} onClick={() => run(() => session.act('/api/diner/split/cancel'), 'División cancelada')}>
            Cancelar la división
          </button>
        )}
      </div>
    );
  }

  const available = snapshot.bill.unclaimed;
  if (available === 0)
    return (
      <div className="card">
        <Empty emoji="⏳" title="No queda saldo libre para dividir">
          Lo que falta está siendo pagado por otras personas de la mesa.
        </Empty>
      </div>
    );

  const each = Math.ceil(available / parts);
  const start = (p: number, t: number) => run(() => session.act('/api/diner/split', { parts: p, take: t }));
  return (
    <div className="stack">
      <div className="card card-pad stack" style={{ justifyItems: 'center', textAlign: 'center' }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="small muted">Saldo pendiente a dividir</span>
          <span className="hero-amount">{money(available)}</span>
        </div>
        <h3>¿Entre cuántas personas?</h3>
        <Stepper
          large
          label="Cantidad de personas"
          value={parts}
          min={1}
          max={30}
          onChange={(n) => {
            setParts(n);
            setTake((t) => Math.min(t, n));
          }}
        />
        <p className="num" style={{ fontWeight: 750 }}>
          ≈ {money(each)} cada una
        </p>
        {parts > 1 && (
          <div className="row" style={{ justifyContent: 'center' }}>
            <span className="small muted">Pago</span>
            <Stepper label="Partes que pagás" value={take} min={1} max={parts} onChange={setTake} />
            <span className="small muted">{take === 1 ? 'parte' : 'partes'}</span>
          </div>
        )}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || hasItemsSelection} onClick={() => start(parts, take)}>
          {parts === 1 ? `Pagar todo · ${money(available)}` : `Dividir y pagar ${take === 1 ? 'mi parte' : `${take} partes`}`}
        </button>
        {parts > 1 && (
          <button className="btn btn-ghost btn-sm" disabled={busy || hasItemsSelection} onClick={() => start(1, 1)}>
            Prefiero pagar todo lo que queda ({money(available)})
          </button>
        )}
        <p className="tiny faint">
          Se reparte el saldo pendiente actual: lo que alguien ya pagó por ítems no se vuelve a cobrar. El resto de la mesa
          toma sus partes desde su celular.
        </p>
        {hasItemsSelection && <p className="small" style={{ color: 'var(--warn)' }}>Tenés una selección de ítems en curso: pagala o soltala primero.</p>}
      </div>
    </div>
  );
}

// ---------- Confirmación ----------

function PaidScreen({ payment, name, outstanding, onDone }: { payment: PaymentDTO; name: string; outstanding: number; onDone: () => void }) {
  return (
    <main className="diner-main">
      <div className="card card-pad stack" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div className="success-mark" aria-hidden="true">
          ✓
        </div>
        <h1>¡Listo, {name}!</h1>
        <p className="muted">
          Registramos tu pago de <strong className="num">{money(payment.amount + payment.tipAmount)}</strong>
          {payment.method ? ` con ${METHOD_LABEL[payment.method]}` : ''}
          {payment.tipAmount > 0 ? ` (incluye ${money(payment.tipAmount)} de propina)` : ''}.
        </p>
        <div className={`banner ${outstanding === 0 ? 'banner-ok' : 'banner-split'}`} style={{ textAlign: 'left' }}>
          <span className="banner-icon">{outstanding === 0 ? '🎉' : '🧾'}</span>
          <p className="small">
            {outstanding === 0 ? '¡La mesa quedó saldada! Gracias por venir.' : `En la mesa todavía quedan ${money(outstanding)} por pagar.`}
          </p>
        </div>
        <button className="btn btn-primary btn-block" onClick={onDone}>
          Volver
        </button>
      </div>
    </main>
  );
}
