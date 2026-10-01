import type { MetricsDTO } from '../../../shared/types.ts';
import { Spinner } from '../components/ui.tsx';
import { METHOD_LABEL, duration, money } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaffData } from './context.tsx';

const percent = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

/** Barras horizontales de un solo color (comparan magnitudes); el valor va en la punta, en color de texto. */
function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit: [string, string] }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list" role="table" aria-label="Distribución">
      {rows.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <div key={r.label} className="bar-row" role="row" title={`${r.label}: ${r.value} ${r.value === 1 ? unit[0] : unit[1]} (${share}%)`}>
            <span role="cell" className="ellipsis">
              {r.label}
            </span>
            <div className="bar-track" role="cell" aria-hidden="true">
              <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            <span role="cell" className="num small muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {r.value} · {share}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function MetricsView() {
  useDocumentTitle('Métricas · Pedido Grupal');
  const { data: m } = useStaffData<MetricsDTO>('/api/admin/metrics');
  if (!m) return <Spinner />;
  const empty = m.sessions.total === 0;
  const paidCount = Object.values(m.adoption.paymentsByKind).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Métricas</h1>
          <span className="small muted">Los indicadores del Scope Canvas, calculados con el uso real de la app.</span>
        </div>
      </div>

      {empty && (
        <div className="banner banner-split">
          <span className="banner-icon">📊</span>
          <p className="small">
            Todavía no hay mesas atendidas. Para ver el tablero con datos de ejemplo, corré <code>npm run seed:demo</code> y
            reiniciá el servidor.
          </p>
        </div>
      )}

      <div className="card hero-metric">
        <span className="kpi-label">Tiempo de cierre de mesa</span>
        <span className="hero-metric-value">{duration(m.avgCloseSeconds)}</span>
        <span className="small muted">
          Promedio desde que alguien empieza a pagar hasta que la mesa queda en $0 · {m.sessions.settled} mesas saldadas
        </span>
      </div>

      <section className="stack-sm">
        <h2>Negocio</h2>
        <div className="kpis">
          <Kpi label="Mesas atendidas" value={String(m.sessions.total)} hint={`${m.sessions.open} abiertas ahora`} />
          <Kpi label="Facturación" value={money(m.revenue)} hint={`+ ${money(m.tips)} de propinas`} />
          <Kpi label="Ticket promedio por mesa" value={m.avgTicket === null ? '—' : money(m.avgTicket)} />
          <Kpi label="Duración de una mesa" value={m.avgSessionMinutes === null ? '—' : duration(m.avgSessionMinutes * 60)} hint="Desde que se sienta el primero hasta que se cierra" />
        </div>
      </section>

      <section className="stack-sm">
        <h2>Adopción de funciones clave</h2>
        <div className="kpis">
          <Kpi label="Comensales que pidieron desde su celular" value={percent(m.adoption.dinersWhoOrderedPct)} />
          <Kpi label="Pagos por ítems con ½ o ⅓" value={percent(m.adoption.fractionalPct)} hint="Fraccionamiento de ítems compartidos" />
          <Kpi label="Pagos registrados" value={String(paidCount)} />
        </div>
        <div className="staff-cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="card card-pad stack">
            <h3>Pagos por modo</h3>
            <Bars
              unit={['pago', 'pagos']}
              rows={[
                { label: 'Elegir ítems', value: m.adoption.paymentsByKind.ITEMS },
                { label: 'Dividir el total', value: m.adoption.paymentsByKind.SPLIT },
              ]}
            />
          </div>
          <div className="card card-pad stack">
            <h3>Pagos por medio</h3>
            <Bars
              unit={['pago', 'pagos']}
              rows={(Object.keys(m.adoption.paymentsByMethod) as (keyof typeof m.adoption.paymentsByMethod)[]).map((k) => ({
                label: METHOD_LABEL[k],
                value: m.adoption.paymentsByMethod[k],
              }))}
            />
          </div>
        </div>
      </section>

      <section className="stack-sm">
        <h2>Eficiencia del personal</h2>
        <div className="kpis">
          <Kpi label="Tiempo de entrega" value={duration(m.staff.avgDeliverySeconds)} hint="Desde que se pide hasta que se entrega" />
          <Kpi label="Respuesta a pedidos de Posnet" value={duration(m.staff.avgPosnetResponseSeconds)} hint="Desde el aviso hasta el cobro" />
        </div>
      </section>

      <section className="stack-sm">
        <h2>Incidentes y errores</h2>
        <div className="kpis">
          <Kpi
            label="Tasa de incidentes"
            value={m.incidents.ratePer100Payments === null ? '—' : m.incidents.ratePer100Payments.toFixed(1)}
            hint="Cada 100 pagos iniciados por comensales"
          />
          <Kpi label="Reservas vencidas" value={String(m.incidents.expiredReservations)} hint="Se liberaron sin confirmar en 1 minuto" />
          <Kpi label="Pagos anulados" value={String(m.incidents.voidedPayments)} hint="Transferencias declaradas que no llegaron" />
          <Kpi label="Ítems cancelados" value={String(m.incidents.cancelledItems)} />
        </div>
      </section>
    </>
  );
}
