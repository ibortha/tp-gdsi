import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ItemStatus, KitchenTicketDTO } from '../../../shared/types.ts';
import { Empty, Spinner, useAction } from '../components/ui.tsx';
import { ITEM_STATUS_LABEL, clock, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';

export function KitchenView() {
  useDocumentTitle('Comandas · Pedido Grupal');
  const { call } = useStaff();
  const { data } = useStaffData<{ active: KitchenTicketDTO[]; recent: KitchenTicketDTO[] }>('/api/staff/kitchen');
  const [tab, setTab] = useState<'active' | 'recent'>('active');
  const { run, busy } = useAction();
  const now = useNow(15000);
  if (!data) return <Spinner />;

  const setStatus = (ids: string[], status: ItemStatus) =>
    run(async () => {
      for (const id of ids) await call(`/api/staff/items/${id}/status`, { body: { status } });
    });

  const tickets = tab === 'active' ? data.active : data.recent;
  return (
    <>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Comandas</h1>
          <span className="small muted">Los pedidos llegan directo desde los celulares, sin pasar por el mozo.</span>
        </div>
        <div className="seg" style={{ minWidth: 280 }}>
          <button aria-pressed={tab === 'active'} onClick={() => setTab('active')}>
            Por entregar ({data.active.length})
          </button>
          <button aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}>
            Entregadas
          </button>
        </div>
      </div>

      {tickets.length === 0 ? (
        <Empty emoji={tab === 'active' ? '😌' : '🗒️'} title={tab === 'active' ? 'No hay comandas pendientes' : 'Todavía no se entregó nada'} />
      ) : (
        <div className="tickets">
          {tickets.map((t) => {
            const minutes = (now - Date.parse(t.createdAt)) / 60000;
            const open = t.items.filter((i) => i.status === 'PENDING' || i.status === 'PREPARING');
            const late = tab === 'active' ? (minutes > 20 ? ' very-late' : minutes > 10 ? ' late' : '') : '';
            return (
              <article key={t.orderId} className={`ticket${late}`}>
                <div className="row-between">
                  <Link to={`/staff/mesas/${t.tableId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <h2>Mesa {t.tableNumber}</h2>
                  </Link>
                  <span className="small muted">
                    {clock(t.createdAt)} · {timeAgo(t.createdAt, now)}
                  </span>
                </div>
                <span className="small muted">Pidió {t.dinerName}</span>
                {t.note && (
                  <div className="banner banner-warn" style={{ padding: '8px 12px' }}>
                    <span className="small">📝 {t.note}</span>
                  </div>
                )}
                <div className="stack-sm">
                  {t.items.map((i) => (
                    <div key={i.id} className="ticket-item" style={i.status === 'CANCELLED' ? { opacity: 0.45 } : undefined}>
                      <span className="ticket-qty num">{i.quantity}×</span>
                      <div className="grow">
                        <strong className={i.status === 'CANCELLED' ? 'strike' : undefined}>{i.name}</strong>
                        {i.note && <div className="small" style={{ color: 'var(--warn)' }}>“{i.note}”</div>}
                      </div>
                      {i.status === 'PENDING' && tab === 'active' ? (
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setStatus([i.id], 'PREPARING')}>
                          Preparar
                        </button>
                      ) : i.status === 'PREPARING' && tab === 'active' ? (
                        <button className="btn btn-ok btn-sm" disabled={busy} onClick={() => setStatus([i.id], 'DELIVERED')}>
                          Entregar
                        </button>
                      ) : (
                        <span className={`badge ${i.status === 'DELIVERED' ? 'badge-ok' : ''}`}>{ITEM_STATUS_LABEL[i.status]}</span>
                      )}
                    </div>
                  ))}
                </div>
                {open.length > 1 && tab === 'active' && (
                  <button className="btn btn-primary btn-sm btn-block" disabled={busy} onClick={() => setStatus(open.map((i) => i.id), 'DELIVERED')}>
                    Entregar todo
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
