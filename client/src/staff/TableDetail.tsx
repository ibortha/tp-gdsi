import { Link, useParams } from 'react-router-dom';
import type { DinerDTO, ItemStatus, PaymentDTO, SessionSnapshot, TableSummaryDTO } from '../../../shared/types.ts';
import { Avatar, Empty, Spinner, useAction, useConfirm } from '../components/ui.tsx';
import { UnitBar } from '../diner/TableTab.tsx';
import { ITEM_STATUS_LABEL, METHOD_LABEL, PAYMENT_STATUS_LABEL, clock, money, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';
import { STATE_LABEL, tableState } from './TablesView.tsx';

const NEXT_STATUS: Partial<Record<ItemStatus, { status: ItemStatus; label: string }>> = {
  PENDING: { status: 'PREPARING', label: 'Preparando' },
  PREPARING: { status: 'DELIVERED', label: 'Entregado' },
};

const PAYMENT_BADGE: Record<PaymentDTO['status'], string> = {
  RESERVED: 'badge-warn',
  AWAITING_POSNET: 'badge-danger',
  PAID: 'badge-ok',
  EXPIRED: '',
  CANCELLED: '',
  VOIDED: 'badge-danger',
};

export function TableDetail() {
  const { tableId = '' } = useParams();
  const { data, error } = useStaffData<{ table: TableSummaryDTO; snapshot: SessionSnapshot | null }>(`/api/staff/tables/${tableId}`);
  useDocumentTitle(data ? `Mesa ${data.table.number} · Pedido Grupal` : 'Mesa');
  if (error) return <Empty emoji="🤷" title="No encontramos la mesa">{error}</Empty>;
  if (!data) return <Spinner />;
  const { table, snapshot } = data;

  return (
    <>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 4 }}>
          <Link to="/staff/mesas" className="small">
            ← Todas las mesas
          </Link>
          <div className="row">
            <h1>Mesa {table.number}</h1>
            <span className="badge">{STATE_LABEL[tableState(table)]}</span>
          </div>
          {table.label && <span className="small muted">{table.label}</span>}
        </div>
        {snapshot && <SessionActions snapshot={snapshot} />}
      </div>

      {!snapshot ? (
        <div className="card">
          <Empty emoji="🪑" title="Mesa libre">
            Cuando alguien escanee el QR de la mesa, sus pedidos aparecen acá en vivo.
            <div style={{ marginTop: 10 }}>
              <a href={`/m/${table.qrToken}`} target="_blank" rel="noreferrer">
                Abrir como comensal ↗
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
      message: 'Se registra como abonado todo lo que ningún comensal tomó todavía (incluye las partes libres de la división).',
      confirmLabel: 'Registrar cobro',
    });
    if (ok) await run(() => call(`/api/staff/sessions/${snapshot.sessionId}/charge`, { body: { method } }), 'Cobro registrado');
  };

  const close = async () => {
    const pending = bill.outstanding > 0;
    const ok = await confirm({
      title: `Cerrar la mesa ${snapshot.table.number}`,
      message: pending
        ? `⚠️ La mesa todavía debe ${money(bill.outstanding)}. Si la cerrás, ese saldo queda sin cobrar.`
        : 'La mesa queda libre para el próximo grupo y los celulares de esta mesa se desconectan.',
      confirmLabel: pending ? 'Cerrar igual' : 'Cerrar mesa',
      danger: pending,
    });
    if (ok)
      await run(() => call(`/api/staff/sessions/${snapshot.sessionId}/close`, { body: { force: pending } }), 'Mesa cerrada');
  };

  return (
    <div className="row wrap">
      {bill.unclaimed > 0 && (
        <>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => charge('POSNET')}>
            💳 Cobrar saldo libre
          </button>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => charge('CASH')}>
            💵 Efectivo
          </button>
        </>
      )}
      <button className={`btn btn-sm ${bill.outstanding === 0 ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={close}>
        Cerrar mesa
      </button>
    </div>
  );
}

function SessionView({ snapshot }: { snapshot: SessionSnapshot }) {
  const { call } = useStaff();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const now = useNow(15000);
  const diners = new Map<string, DinerDTO>(snapshot.diners.map((d) => [d.id, d]));
  const { bill } = snapshot;
  const payments = snapshot.payments.filter((p) => p.status !== 'CANCELLED').reverse();
  const split = snapshot.activeSplit;

  const setStatus = (id: string, status: ItemStatus) =>
    run(() => call(`/api/staff/items/${id}/status`, { body: { status } }));

  const cancelItem = async (id: string, name: string) => {
    if (await confirm({ title: `Cancelar ${name}`, message: 'Se descuenta de la cuenta de la mesa.', confirmLabel: 'Cancelar ítem', danger: true }))
      await setStatus(id, 'CANCELLED');
  };

  const voidPayment = async (p: PaymentDTO) => {
    const ok = await confirm({
      title: `Anular pago de ${money(p.amount)}`,
      message: 'Usalo si la transferencia no llegó o fue un error. Lo que cubría ese pago vuelve a quedar pendiente en la mesa.',
      confirmLabel: 'Anular pago',
      danger: true,
    });
    if (ok) await run(() => call(`/api/staff/payments/${p.id}/void`, { method: 'POST' }), 'Pago anulado');
  };

  return (
    <div className="staff-cols">
      <div className="stack">
        <div className="kpis">
          <div className="kpi">
            <span className="kpi-label">Saldo pendiente</span>
            <span className="kpi-value">{money(bill.outstanding)}</span>
            <span className="kpi-hint">{snapshot.settled ? 'Mesa saldada ✓' : `de ${money(bill.total)}`}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Abonado</span>
            <span className="kpi-value" style={{ color: 'var(--ok)' }}>
              {money(bill.paid)}
            </span>
            <span className="kpi-hint">+ {money(bill.tips)} de propinas</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Pagando ahora</span>
            <span className="kpi-value" style={{ color: 'var(--warn)' }}>
              {money(bill.reserved)}
            </span>
            <span className="kpi-hint">Libre: {money(bill.unclaimed)}</span>
          </div>
        </div>

        <div className="section-title">
          <h2>Pedidos</h2>
          <span className="small muted">Abierta {timeAgo(snapshot.openedAt, now)}</span>
        </div>
        {snapshot.items.length === 0 ? (
          <div className="card">
            <Empty emoji="🍽️" title="Todavía no pidieron nada" />
          </div>
        ) : (
          <div className="card list">
            {snapshot.items
              .slice()
              .reverse()
              .map((item) => {
                const who = diners.get(item.dinerId);
                const next = NEXT_STATUS[item.status];
                const hasClaims = item.units.some((u) => u.denominator !== null);
                return (
                  <div key={item.id} className="bill-item" style={item.status === 'CANCELLED' ? { opacity: 0.5 } : undefined}>
                    <div className="row-between" style={{ alignItems: 'flex-start' }}>
                      <div className="grow stack-sm" style={{ gap: 2 }}>
                        <strong className={item.status === 'CANCELLED' ? 'strike' : undefined}>
                          {item.quantity} × {item.name}
                        </strong>
                        {item.note && <span className="small" style={{ color: 'var(--warn)' }}>“{item.note}”</span>}
                        <span className="row small muted" style={{ gap: 6 }}>
                          {who && <Avatar name={who.name} color={who.color} size="sm" />}
                          {who?.name} · {clock(item.createdAt)}
                        </span>
                      </div>
                      <div className="stack-sm" style={{ justifyItems: 'end', gap: 4 }}>
                        <strong className="num">{money(item.unitPrice * item.quantity)}</strong>
                        <span className="badge">{ITEM_STATUS_LABEL[item.status]}</span>
                      </div>
                    </div>
                    {item.status !== 'CANCELLED' && (
                      <>
                        <UnitBar item={item} />
                        <div className="row wrap" style={{ gap: 6 }}>
                          {next && (
                            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setStatus(item.id, next.status)}>
                              → {next.label}
                            </button>
                          )}
                          {item.status !== 'DELIVERED' && next?.status !== 'DELIVERED' && (
                            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus(item.id, 'DELIVERED')}>
                              Entregado
                            </button>
                          )}
                          {!hasClaims && (
                            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => cancelItem(item.id, item.name)}>
                              Cancelar
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="stack">
        <div className="section-title">
          <h2>En la mesa</h2>
        </div>
        <div className="card card-pad row wrap" style={{ gap: 12 }}>
          {snapshot.diners.map((d) => (
            <span key={d.id} className="row" style={{ gap: 6 }}>
              <Avatar name={d.name} color={d.color} />
              <span className="small">{d.name}</span>
            </span>
          ))}
        </div>

        {split && (
          <>
            <div className="section-title">
              <h2>División en curso</h2>
            </div>
            <div className="card card-pad stack">
              <span className="small muted num">
                {money(split.total)} en {split.parts} partes · iniciada por {diners.get(split.createdBy)?.name ?? '—'}
              </span>
              <div className="share-grid">
                {split.shares.map((s) => (
                  <div key={s.index} className={`share s-${s.state}`}>
                    <span>Parte {s.index + 1}</span>
                    <strong className="num">{money(s.amount)}</strong>
                    <span className="tiny">
                      {s.state === 'AVAILABLE' ? 'Libre' : `${s.state === 'PAID' ? 'Pagó' : 'Pagando'} ${(s.dinerId && diners.get(s.dinerId)?.name) || 'mozo'}`}
                    </span>
                  </div>
                ))}
              </div>
              {split.shares.every((s) => s.state !== 'PAID') && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => run(() => call(`/api/staff/splits/${split.id}/dissolve`, { method: 'POST' }), 'División cancelada')}
                >
                  Cancelar división
                </button>
              )}
            </div>
          </>
        )}

        <div className="section-title">
          <h2>Pagos</h2>
        </div>
        {payments.length === 0 ? (
          <div className="card">
            <Empty emoji="💸" title="Sin pagos todavía" />
          </div>
        ) : (
          <div className="card list">
            {payments.map((p) => {
              const who = p.dinerId ? diners.get(p.dinerId) : undefined;
              return (
                <div key={p.id} className="list-item stack-sm">
                  <div className="row-between">
                    <span className="row" style={{ gap: 8 }}>
                      {who ? <Avatar name={who.name} color={who.color} size="sm" /> : <span aria-hidden="true">🧑‍🍳</span>}
                      <strong>{who?.name ?? p.staffName ?? 'Mozo'}</strong>
                    </span>
                    <span className={`badge ${PAYMENT_BADGE[p.status]}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                  </div>
                  <div className="row-between small">
                    <span className="muted">
                      {p.kind === 'SPLIT' ? `${p.shareIndices.length} parte(s) de la división` : `${p.claims.length} porción(es)`}
                      {p.method ? ` · ${METHOD_LABEL[p.method]}` : ''}
                      {p.confirmedBy === 'DINER' ? ' · declarado por el comensal' : p.confirmedBy === 'STAFF' ? ` · confirmó ${p.staffName ?? 'el mozo'}` : ''}
                    </span>
                    <strong className="num">
                      {money(p.amount)}
                      {p.tipAmount > 0 ? ` + ${money(p.tipAmount)}` : ''}
                    </strong>
                  </div>
                  {p.kind === 'ITEMS' && p.claims.length > 0 && (
                    <span className="tiny faint">{p.claims.map((c) => c.label).join(' · ')}</span>
                  )}
                  <div className="row-between">
                    <span className="tiny faint">{clock(p.paidAt ?? p.createdAt)}</span>
                    {p.status === 'PAID' && (
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => voidPayment(p)}>
                        Anular
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
