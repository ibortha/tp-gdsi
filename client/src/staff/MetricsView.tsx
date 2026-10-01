import { ChartLineUp } from '@phosphor-icons/react';
import type { MetricsDTO } from '../../../shared/types.ts';
import { Loader } from '../components/ui.tsx';
import { METHOD_LABEL, duration, money } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaffData } from './context.tsx';

const percent = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}

/** Barras horizontales de un solo tono (comparan magnitudes); el valor va en la punta, en color de texto. */
function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit: [string, string] }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars" role="table" aria-label="Distribución">
      {rows.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <div key={r.label} className="bars__row" role="row" title={`${r.label}: ${r.value} ${r.value === 1 ? unit[0] : unit[1]} (${share}%)`}>
            <span role="cell" className="bars__label">
              {r.label}
            </span>
            <span role="cell" className="bars__track" aria-hidden="true">
              <span className="bars__fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span role="cell" className="bars__value mono">
              {r.value}
              <span className="faint"> · {share}%</span>
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
  if (!m) return <Loader />;
  const empty = m.sessions.total === 0;
  const paidCount = Object.values(m.adoption.paymentsByKind).reduce((a, b) => a + b, 0);

  return (
    <>
      <header className="s-head">
        <div className="stack stack-2">
          <span className="eyebrow">Indicadores del Scope Canvas</span>
          <h1 className="display s-title">Métricas</h1>
        </div>
      </header>

      {empty && (
        <div className="notice notice--split">
          <span className="notice__icon">
            <ChartLineUp size={20} />
          </span>
          <p className="small" style={{ alignSelf: 'center' }}>
            Todavía no hay mesas atendidas. Para ver el tablero con datos de ejemplo corré <code className="mono">npm run seed:demo</code> y
            reiniciá el servidor.
          </p>
        </div>
      )}

      <section className="metric-hero">
        <div className="stack stack-2">
          <span className="eyebrow eyebrow--night">Tiempo de cierre de mesa</span>
          <strong className="display metric-hero__value">{duration(m.avgCloseSeconds)}</strong>
          <span className="metric-hero__hint">
            Promedio desde que alguien empieza a pagar hasta que la mesa queda en $0 · {m.sessions.settled} mesas saldadas
          </span>
        </div>
        <div className="metric-hero__side">
          <Stat label="Facturación" value={money(m.revenue)} hint={`+ ${money(m.tips)} de propinas`} />
          <Stat label="Ticket promedio" value={m.avgTicket === null ? '—' : money(m.avgTicket)} hint={`${m.sessions.total} mesas atendidas`} />
        </div>
      </section>

      <section className="metric-sec">
        <header>
          <span className="eyebrow">01</span>
          <h2 className="display">Adopción de funciones clave</h2>
        </header>
        <div className="stats">
          <Stat label="Pidieron desde su celular" value={percent(m.adoption.dinersWhoOrderedPct)} hint="De los comensales que se sentaron" />
          <Stat label="Pagos con ½ o ⅓" value={percent(m.adoption.fractionalPct)} hint="De los pagos por ítems" />
          <Stat label="Pagos registrados" value={String(paidCount)} />
        </div>
        <div className="bars-grid">
          <div className="panel panel--pad">
            <h3>Por modo</h3>
            <Bars
              unit={['pago', 'pagos']}
              rows={[
                { label: 'Por ítems', value: m.adoption.paymentsByKind.ITEMS },
                { label: 'Dividir el total', value: m.adoption.paymentsByKind.SPLIT },
              ]}
            />
          </div>
          <div className="panel panel--pad">
            <h3>Por medio</h3>
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

      <section className="metric-sec">
        <header>
          <span className="eyebrow">02</span>
          <h2 className="display">Eficiencia del personal</h2>
        </header>
        <div className="stats">
          <Stat label="Del pedido a la mesa" value={duration(m.staff.avgDeliverySeconds)} hint="Promedio por ítem" />
          <Stat label="Respuesta al Posnet" value={duration(m.staff.avgPosnetResponseSeconds)} hint="Desde el aviso hasta el cobro" />
          <Stat label="Duración de una mesa" value={m.avgSessionMinutes === null ? '—' : duration(m.avgSessionMinutes * 60)} hint="Del primer comensal al cierre" />
        </div>
      </section>

      <section className="metric-sec">
        <header>
          <span className="eyebrow">03</span>
          <h2 className="display">Incidentes y errores</h2>
        </header>
        <div className="stats">
          <Stat
            label="Tasa de incidentes"
            value={m.incidents.ratePer100Payments === null ? '—' : m.incidents.ratePer100Payments.toFixed(1)}
            hint="Cada 100 pagos iniciados"
          />
          <Stat label="Reservas vencidas" value={String(m.incidents.expiredReservations)} hint="Sin confirmar en 1 minuto" />
          <Stat label="Pagos anulados" value={String(m.incidents.voidedPayments)} hint="Transferencias que no llegaron" />
          <Stat label="Ítems cancelados" value={String(m.incidents.cancelledItems)} />
        </div>
      </section>
    </>
  );
}
