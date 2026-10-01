import { CookingPot, Users } from '@phosphor-icons/react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { TableSummaryDTO } from '../../../shared/types.ts';
import { Empty, Loader, Money } from '../components/ui.tsx';
import { money, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { useStaffData } from './context.tsx';

export type TableState = 'free' | 'busy' | 'paying' | 'posnet' | 'settled';

export function tableState(t: TableSummaryDTO): TableState {
  if (!t.session) return 'free';
  if (t.session.posnetRequests > 0) return 'posnet';
  if (t.session.settled) return 'settled';
  if (t.session.paymentsInProgress > 0 || t.session.bill.paid > 0) return 'paying';
  return 'busy';
}

export const STATE_LABEL: Record<TableState, string> = {
  free: 'Libre',
  busy: 'Ocupada',
  paying: 'Pagando',
  posnet: 'Pide Posnet',
  settled: 'Saldada',
};

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function TablesView() {
  useDocumentTitle('Salón · Pedido Grupal');
  const { data: tables } = useStaffData<TableSummaryDTO[]>('/api/staff/tables');
  const now = useNow(30000);
  if (!tables) return <Loader />;
  const visible = tables.filter((t) => t.active || t.session);
  const open = visible.filter((t) => t.session);
  const outstanding = open.reduce((s, t) => s + (t.session?.bill.outstanding ?? 0), 0);
  const kitchen = open.reduce((s, t) => s + (t.session?.pendingItems ?? 0), 0);
  const groups = [...new Set(visible.map((t) => t.label || 'Salón'))];

  return (
    <>
      <header className="s-head">
        <div className="stack stack-2">
          <span className="eyebrow">{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1 className="display s-title">Salón</h1>
        </div>
        <div className="figures">
          <div className="figure">
            <span className="eyebrow">Ocupadas</span>
            <strong className="display">
              {open.length}
              <span className="figure__of">/{visible.length}</span>
            </strong>
          </div>
          <div className="figure">
            <span className="eyebrow">Por cobrar</span>
            <strong className="display">
              <Money cents={outstanding} />
            </strong>
          </div>
          <div className="figure">
            <span className="eyebrow">En cocina</span>
            <strong className="display">{kitchen}</strong>
          </div>
        </div>
      </header>

      {visible.length === 0 ? (
        <Empty icon={<Users size={24} />} title="No hay mesas">
          Creá las mesas desde “Mesas y QR”.
        </Empty>
      ) : (
        groups.map((group) => (
          <section key={group} className="stack stack-4">
            <div className="section-rule">
              <span className="eyebrow">{group}</span>
            </div>
            <div className="floor">
              {visible
                .filter((t) => (t.label || 'Salón') === group)
                .map((t, i) => {
                  const state = tableState(t);
                  const s = t.session;
                  return (
                    <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }}>
                      <Link to={`/staff/mesas/${t.id}`} className={clsx('tile', `tile--${state}`)}>
                        <div className="tile__top">
                          <span className="tile__num display">{pad2(t.number)}</span>
                          <span className="tile__state">
                            <span className="dot" />
                            {STATE_LABEL[state]}
                          </span>
                        </div>
                        {s ? (
                          <div className="tile__body">
                            <strong className="tile__amount mono">{money(s.bill.outstanding > 0 ? s.bill.outstanding : s.bill.total)}</strong>
                            <span className="tile__meta">
                              <span className="row" style={{ gap: 4 }}>
                                <Users size={14} /> {s.diners}
                              </span>
                              {s.pendingItems > 0 && (
                                <span className="row" style={{ gap: 4 }}>
                                  <CookingPot size={14} /> {s.pendingItems}
                                </span>
                              )}
                              <span>{timeAgo(s.openedAt, now)}</span>
                            </span>
                          </div>
                        ) : (
                          <span className="tile__meta">Sin comensales</span>
                        )}
                      </Link>
                    </motion.div>
                  );
                })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
