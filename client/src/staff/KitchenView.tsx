import { Check, CookingPot, Timer } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ItemStatus, KitchenTicketDTO } from '../../../shared/types.ts';
import { Empty, Loader, Segmented, useAction } from '../components/ui.tsx';
import { clock } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';
import { pad2 } from './TablesView.tsx';

export function KitchenView() {
  useDocumentTitle('Comandas · Pedido Grupal');
  const { call } = useStaff();
  const { data } = useStaffData<{ active: KitchenTicketDTO[]; recent: KitchenTicketDTO[] }>('/api/staff/kitchen');
  const [tab, setTab] = useState<'active' | 'recent'>('active');
  const { run, busy } = useAction();
  const now = useNow(15000);
  if (!data) return <Loader />;

  const setStatus = (ids: string[], status: ItemStatus) =>
    run(async () => {
      for (const id of ids) await call(`/api/staff/items/${id}/status`, { body: { status } });
    });

  const tickets = tab === 'active' ? data.active : data.recent;
  return (
    <>
      <header className="s-head">
        <div className="stack stack-2">
          <span className="eyebrow">Llegan directo desde los celulares</span>
          <h1 className="display s-title">Comandas</h1>
        </div>
        <div style={{ width: 300 }}>
          <Segmented
            label="Comandas"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'active', label: `Por servir · ${data.active.length}` },
              { value: 'recent', label: 'Servidas' },
            ]}
          />
        </div>
      </header>

      {tickets.length === 0 ? (
        <Empty icon={<CookingPot size={24} />} title={tab === 'active' ? 'Cocina al día' : 'Todavía no se sirvió nada'}>
          {tab === 'active' ? 'Cuando alguien pida, la comanda aparece acá.' : undefined}
        </Empty>
      ) : (
        <div className="tickets">
          <AnimatePresence initial={false}>
            {tickets.map((t) => {
              const minutes = Math.floor((now - Date.parse(t.createdAt)) / 60000);
              const open = t.items.filter((i) => i.status === 'PENDING' || i.status === 'PREPARING');
              const late = tab === 'active' ? (minutes >= 20 ? 'is-late' : minutes >= 10 ? 'is-slow' : '') : '';
              return (
                <motion.article
                  key={t.orderId}
                  layout
                  className="ticket-wrap"
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                >
                  <div className={clsx('receipt ticket', late)}>
                    <header className="ticket__head">
                      <Link to={`/staff/mesas/${t.tableId}`} className="ticket__table display">
                        Mesa {pad2(t.tableNumber)}
                      </Link>
                      {tab === 'active' && (
                        <span className="ticket__age mono">
                          <Timer size={14} />
                          {minutes < 1 ? 'recién' : `${minutes} min`}
                        </span>
                      )}
                    </header>
                    <div className="ticket__sub mono">
                      <span>{t.dinerName}</span>
                      <span>{clock(t.createdAt)}</span>
                    </div>
                    <hr className="rule" />
                    {t.note && <p className="ticket__note">{t.note}</p>}
                    <ul className="ticket__items">
                      {t.items.map((i) => (
                        <li key={i.id} className={clsx('ticket__item', i.status === 'CANCELLED' && 'is-void', i.status === 'DELIVERED' && 'is-done')}>
                          <span className="ticket__qty mono">{i.quantity}</span>
                          <div className="grow">
                            <strong>{i.name}</strong>
                            {i.note && <div className="ticket__inote">{i.note}</div>}
                          </div>
                          {tab === 'active' && i.status === 'PENDING' && (
                            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setStatus([i.id], 'PREPARING')}>
                              Preparar
                            </button>
                          )}
                          {tab === 'active' && i.status === 'PREPARING' && (
                            <button className="btn btn--ink btn--sm" disabled={busy} onClick={() => setStatus([i.id], 'DELIVERED')}>
                              Servir
                            </button>
                          )}
                          {i.status === 'DELIVERED' && <Check size={18} weight="bold" className="ticket__check" />}
                        </li>
                      ))}
                    </ul>
                    {open.length > 1 && tab === 'active' && (
                      <>
                        <hr className="rule" />
                        <button className="btn btn--accent btn--block" disabled={busy} onClick={() => setStatus(open.map((i) => i.id), 'DELIVERED')}>
                          Servir todo
                        </button>
                      </>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
