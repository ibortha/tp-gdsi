import { Link } from 'react-router-dom';
import type { TableSummaryDTO } from '../../../shared/types.ts';
import { Empty, Spinner } from '../components/ui.tsx';
import { money, plural, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { useStaffData } from './context.tsx';

type TableState = 'free' | 'busy' | 'paying' | 'posnet' | 'settled';

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

const STATE_BADGE: Record<TableState, string> = {
  free: '',
  busy: 'badge-accent',
  paying: 'badge-warn',
  posnet: 'badge-danger',
  settled: 'badge-ok',
};

export function TablesView() {
  useDocumentTitle('Mesas · Pedido Grupal');
  const { data: tables } = useStaffData<TableSummaryDTO[]>('/api/staff/tables');
  const now = useNow(30000);
  if (!tables) return <Spinner />;
  const visible = tables.filter((t) => t.active || t.session);
  const open = visible.filter((t) => t.session);
  const outstanding = open.reduce((s, t) => s + (t.session?.bill.outstanding ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Mesas</h1>
          <span className="muted small">
            {plural(open.length, 'mesa ocupada', 'mesas ocupadas')} de {visible.length} · {money(outstanding)} pendientes de cobro
          </span>
        </div>
        <div className="legend">
          {(Object.keys(STATE_LABEL) as TableState[]).map((s) => (
            <span key={s} className={`badge ${STATE_BADGE[s]}`}>
              {STATE_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty emoji="🪑" title="No hay mesas cargadas">
          Creá las mesas del local desde “Mesas y QR”.
        </Empty>
      ) : (
        <div className="tables-grid">
          {visible.map((t) => {
            const state = tableState(t);
            const s = t.session;
            return (
              <Link key={t.id} to={`/staff/mesas/${t.id}`} className={`table-card st-${state}`}>
                <div className="row-between">
                  <span className="table-number">{t.number}</span>
                  <span className={`badge ${STATE_BADGE[state]}`}>{STATE_LABEL[state]}</span>
                </div>
                <span className="tiny faint">{t.label || 'Mesa'}</span>
                {s ? (
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <strong className="num">{s.bill.outstanding > 0 ? `${money(s.bill.outstanding)} pendiente` : money(s.bill.total)}</strong>
                    <span className="small muted">
                      👥 {s.diners} · {timeAgo(s.openedAt, now)}
                    </span>
                    {s.pendingItems > 0 && <span className="small" style={{ color: 'var(--warn)' }}>🍳 {plural(s.pendingItems, 'ítem por entregar', 'ítems por entregar')}</span>}
                  </div>
                ) : (
                  <span className="small">Sin comensales</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
