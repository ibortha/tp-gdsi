import { ArrowLeft, ArrowUpRight, CreditCard, ForkKnife, Money as MoneyIcon, QrCode, Wallet, X, type Icon } from '@phosphor-icons/react';
import clsx from 'clsx';
import { Link, useParams } from 'react-router-dom';
import type { ItemStatus, PaymentDTO, PaymentMethod, SessionSnapshot, TableSummaryDTO } from '../../../shared/types.ts';
import { Avatar, Donut, Empty, Loader, Money, useAction, useConfirm } from '../components/ui.tsx';
import { SliceBar, StatusLabel } from '../diner/TableTab.tsx';
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, clock, money, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { toPeople } from '../lib/tones.ts';
import { appHref } from '../lib/links.ts';
import { useStaff, useStaffData } from './context.tsx';
import { STATE_LABEL, pad2, tableState } from './TablesView.tsx';

const NEXT_STATUS: Partial<Record<ItemStatus, { status: ItemStatus; label: string }>> = {
  PENDING: { status: 'PREPARING', label: 'Preparar' },
  PREPARING: { status: 'DELIVERED', label: 'Servir' },
};

const METHOD_ICON: Record<PaymentMethod, Icon> = {
  MERCADO_PAGO: Wallet,
  QR: QrCode,
  POSNET: CreditCard,
  CASH: MoneyIcon,
};

const PAYMENT_TAG: Record<PaymentDTO['status'], string> = {
  RESERVED: 'tag--warn',
  AWAITING_POSNET: 'tag--accent',
  PAID: 'tag--ok',
  EXPIRED: '',
  CANCELLED: '',
  VOIDED: 'tag--accent',
};

export function TableDetail() {
  const { tableId = '' } = useParams();
  const { data, error } = useStaffData<{ table: TableSummaryDTO; snapshot: SessionSnapshot | null }>(`/api/staff/tables/${tableId}`);
  useDocumentTitle(data ? `Mesa ${data.table.number} · Pedido Grupal` : 'Mesa');
  if (error)
    return (
      <Empty icon={<X size={24} />} title="No encontramos la mesa">
        {error}
      </Empty>
    );
  if (!data) return <Loader />;
  const { table, snapshot } = data;
  const state = tableState(table);

  return (
    <>
      <header className="s-head">
        <div className="stack stack-2">
          <Link to="/staff/mesas" className="text-btn" style={{ textDecoration: 'none' }}>
            <ArrowLeft size={16} /> Salón
          </Link>
          <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
            <h1 className="display s-title">Mesa {pad2(table.number)}</h1>
            <span className={clsx('tag', `tag--state-${state}`)}>{STATE_LABEL[state]}</span>
          </div>
          <span className="small muted">
            {table.label || 'Salón'}
            {snapshot ? ` · abierta ${timeAgo(snapshot.openedAt)}` : ''}
          </span>
        </div>
        {snapshot && <SessionActions snapshot={snapshot} />}
      </header>

      {!snapshot ? (
        <div className="card">
          <Empty icon={<ForkKnife size={24} />} title="Mesa libre">
            Cuando alguien escanee el QR, sus pedidos aparecen acá en vivo.
            <div style={{ marginTop: 12 }}>
              <a className="btn btn--outline btn--sm" href={appHref(`/m/${table.qrToken}`)} target="_blank" rel="noreferrer">
                Abrir como comensal <ArrowUpRight size={16} />
              </a>
            </div>
          </Empty>
        </div>
      ) : (
        <SessionView snapshot={snapshot} />
      )}
    </>
  );
}

function SessionActions({ snapshot }: { snapshot: SessionSnapshot }) {
  const { call } = useStaff();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const { bill } = snapshot;

  const charge = async (method: 'POSNET' | 'CASH') => {
    const ok = await confirm({
      title: `Cobrar ${money(bill.unclaimed)} ${method === 'CASH' ? 'en efectivo' : 'con Posnet'}`,
      message: 'Se registra como pagado todo lo que nadie tomó todavía, incluidas las partes libres de la división.',
      confirmLabel: 'Registrar cobro',
    });
    if (ok) await run(() => call(`/api/staff/sessions/${snapshot.sessionId}/charge`, { body: { method } }), 'Cobro registrado');
  };

  const close = async () => {
    const pending = bill.outstanding > 0;
    const ok = await confirm({
      title: `Cerrar la mesa ${pad2(snapshot.table.number)}`,
      message: pending
        ? `Todavía debe ${money(bill.outstanding)}. Si la cerrás, ese saldo queda sin cobrar.`
        : 'Queda libre para el próximo grupo y los celulares de la mesa se desconectan.',
      confirmLabel: pending ? 'Cerrar igual' : 'Cerrar mesa',
      danger: pending,
    });
    if (ok) await run(() => call(`/api/staff/sessions/${snapshot.sessionId}/close`, { body: { force: pending } }), 'Mesa cerrada');
  };

  return (
    <div className="row wrap">
      {bill.unclaimed > 0 && (
        <>
          <button className="btn btn--outline" disabled={busy} onClick={() => charge('POSNET')}>
            <CreditCard size={18} /> Cobrar con Posnet
          </button>
          <button className="btn btn--outline" disabled={busy} onClick={() => charge('CASH')}>
            <MoneyIcon size={18} /> Efectivo
          </button>
        </>
      )}
      <button className={clsx('btn', bill.outstanding === 0 ? 'btn--ink' : 'btn--ghost')} disabled={busy} onClick={close}>
        Cerrar mesa
      </button>
    </div>
  );
}

function SessionView({ snapshot }: { snapshot: SessionSnapshot }) {
  const { call } = useStaff();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  useNow(15000);
  const people = toPeople(snapshot.diners);
  const { bill } = snapshot;
  const payments = snapshot.payments.filter((p) => p.status !== 'CANCELLED').reverse();
  const split = snapshot.activeSplit;

  const setStatus = (id: string, status: ItemStatus) => run(() => call(`/api/staff/items/${id}/status`, { body: { status } }));

  const cancelItem = async (id: string, name: string) => {
    if (await confirm({ title: `Cancelar ${name}`, message: 'Se descuenta de la cuenta de la mesa.', confirmLabel: 'Cancelar ítem', danger: true }))
      await setStatus(id, 'CANCELLED');
  };

  const voidPayment = async (p: PaymentDTO) => {
    const ok = await confirm({
      title: `Anular ${money(p.amount)}`,
      message: 'Si la transferencia no llegó o fue un error, lo que cubría vuelve a quedar pendiente en la mesa.',
      confirmLabel: 'Anular pago',
      danger: true,
    });
    if (ok) await run(() => call(`/api/staff/payments/${p.id}/void`, { method: 'POST' }), 'Pago anulado');
  };

  return (
    <div className="s-cols">
      <div className="stack stack-6">
        <div className="figures figures--cards">
          <div className="figure">
            <span className="eyebrow">Saldo</span>
            <strong className="display">
              <Money cents={bill.outstanding} />
            </strong>
            <span className="tiny faint">de {money(bill.total)}</span>
          </div>
          <div className="figure">
            <span className="eyebrow">Pagado</span>
            <strong className="display" style={{ color: 'var(--ok)' }}>
              <Money cents={bill.paid} />
            </strong>
            <span className="tiny faint">+ {money(bill.tips)} propinas</span>
          </div>
          <div className="figure">
            <span className="eyebrow">Pagando</span>
            <strong className="display" style={{ color: 'var(--accent-text)' }}>
              <Money cents={bill.reserved} />
            </strong>
            <span className="tiny faint">Libre {money(bill.unclaimed)}</span>
          </div>
        </div>

        <section className="panel">
          <header className="panel__head">
            <h2>Pedidos</h2>
            <span className="eyebrow">{snapshot.items.filter((i) => i.status !== 'CANCELLED').length} ítems</span>
          </header>
          {snapshot.items.length === 0 ? (
            <Empty icon={<ForkKnife size={24} />} title="Todavía no pidieron" />
          ) : (
            <ul className="orders">
              {snapshot.items
                .slice()
                .reverse()
                .map((item) => {
                  const who = people.get(item.dinerId);
                  const next = NEXT_STATUS[item.status];
                  const hasClaims = item.units.some((u) => u.denominator !== null);
                  const cancelled = item.status === 'CANCELLED';
                  return (
                    <li key={item.id} className={clsx('order', cancelled && 'is-void')}>
                      <span className="order__qty mono">{item.quantity}×</span>
                      <div className="grow stack" style={{ gap: 6 }}>
                        <div className="between" style={{ alignItems: 'baseline' }}>
                          <strong className="order__name">{item.name}</strong>
                          <span className="mono">{money(item.unitPrice * item.quantity)}</span>
                        </div>
                        {item.note && <span className="order__note">“{item.note}”</span>}
                        <div className="order__meta">
                          {who && <Avatar name={who.name} tone={who.tone} size="sm" />}
                          <span>{who?.name}</span>
                          <span className="faint">· {clock(item.createdAt)} ·</span>
                          <StatusLabel status={item.status} />
                        </div>
                        {!cancelled && <SliceBar item={item} />}
                      </div>
                      {!cancelled && (
                        <div className="order__actions">
                          {next && (
                            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setStatus(item.id, next.status)}>
                              {next.label}
                            </button>
                          )}
                          {item.status === 'PENDING' && (
                            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setStatus(item.id, 'DELIVERED')}>
                              Servido
                            </button>
                          )}
                          {!hasClaims && (
                            <button className="btn btn--ghost btn--icon btn--sm" disabled={busy} onClick={() => cancelItem(item.id, item.name)} aria-label={`Cancelar ${item.name}`} title="Cancelar">
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      </div>

      <div className="stack stack-6">
        <section className="panel">
          <header className="panel__head">
            <h2>En la mesa</h2>
            <span className="eyebrow">{snapshot.diners.length}</span>
          </header>
          <div className="people" style={{ padding: '4px 20px 20px' }}>
            {[...people.values()].map((p) => (
              <span key={p.id} className="person">
                <Avatar name={p.name} tone={p.tone} />
                {p.name}
              </span>
            ))}
          </div>
        </section>

        {split && (
          <section className="panel">
            <header className="panel__head">
              <h2>División</h2>
              <span className="eyebrow">{split.parts} partes</span>
            </header>
            <div className="row" style={{ padding: '0 20px 20px', gap: 18 }}>
              <Donut
                size={96}
                segments={split.shares.map((s) => ({
                  key: String(s.index),
                  color: s.state === 'PAID' ? 'var(--ok)' : s.state === 'RESERVED' ? 'var(--accent)' : 'var(--paper-3)',
                }))}
              >
                <span className="mono small">
                  {split.shares.filter((s) => s.state === 'PAID').length}/{split.parts}
                </span>
              </Donut>
              <div className="grow stack stack-2">
                <span className="small muted">
                  {money(split.total)} · inició {people.get(split.createdBy)?.name ?? '—'}
                </span>
                <ul className="shares">
                  {split.shares.map((s) => (
                    <li key={s.index} className={clsx('share', `is-${s.state.toLowerCase()}`)}>
                      <span className="mono tiny">{pad2(s.index + 1)}</span>
                      <span className="grow">
                        {s.state === 'AVAILABLE' ? 'Libre' : `${s.state === 'PAID' ? 'Pagó' : 'Pagando'} ${(s.dinerId && people.get(s.dinerId)?.name) || 'el mozo'}`}
                      </span>
                      <span className="mono">{money(s.amount)}</span>
                    </li>
                  ))}
                </ul>
                {split.shares.every((s) => s.state !== 'PAID') && (
                  <button className="text-btn" disabled={busy} onClick={() => run(() => call(`/api/staff/splits/${split.id}/dissolve`, { method: 'POST' }), 'División cancelada')}>
                    Cancelar división
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="panel">
          <header className="panel__head">
            <h2>Pagos</h2>
            <span className="eyebrow">{payments.length}</span>
          </header>
          {payments.length === 0 ? (
            <Empty icon={<Wallet size={24} />} title="Sin pagos todavía" />
          ) : (
            <ol className="timeline">
              {payments.map((p) => {
                const who = p.dinerId ? people.get(p.dinerId) : undefined;
                const MethodIcon = p.method ? METHOD_ICON[p.method] : Wallet;
                return (
                  <li key={p.id} className={clsx('tl', `tl--${p.status.toLowerCase()}`)}>
                    <span className="tl__icon">
                      <MethodIcon size={16} />
                    </span>
                    <div className="grow stack" style={{ gap: 4 }}>
                      <div className="between">
                        <strong>{who?.name ?? p.staffName ?? 'Mozo'}</strong>
                        <span className="mono">
                          {money(p.amount)}
                          {p.tipAmount > 0 && <span className="faint"> +{money(p.tipAmount)}</span>}
                        </span>
                      </div>
                      <div className="between">
                        <span className="tiny muted">
                          {p.kind === 'SPLIT' ? `${p.shareIndices.length} parte(s)` : `${p.claims.length} porción(es)`}
                          {p.method ? ` · ${METHOD_LABEL[p.method]}` : ''}
                          {p.confirmedBy === 'DINER' ? ' · declarado' : p.confirmedBy === 'STAFF' ? ` · ${p.staffName ?? 'mozo'}` : ''} · {clock(p.paidAt ?? p.createdAt)}
                        </span>
                        <span className={clsx('tag', PAYMENT_TAG[p.status])}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                      </div>
                      {p.status === 'PAID' && (
                        <button className="text-btn tiny" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => voidPayment(p)}>
                          Anular
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
