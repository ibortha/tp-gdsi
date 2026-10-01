import { ChartBar } from '@phosphor-icons/react';
import clsx from 'clsx';
import { useState } from 'react';
import type { ConsumptionDTO } from '../../../shared/types.ts';
import { Empty } from '../components/ui.tsx';
import { METHOD_LABEL, money as moneyExact } from '../lib/format.ts';
import { pad2 } from './TablesView.tsx';

/** En las métricas no importan los centavos. */
const money = (cents: number) => moneyExact(Math.round(cents / 100) * 100);

const decimal = (v: number | null, digits = 1) =>
  v === null ? '—' : v.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** El día del local arranca a las 6: así la cena que pasa la medianoche queda junta. */
const DAY_ORDER = [...Array.from({ length: 18 }, (_, i) => i + 6), 0, 1, 2, 3, 4, 5];

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}

/** Columnas de un solo tono con tooltip al pasar el mouse; solo se rotula el pico. */
function Columns({
  data,
  format,
  tooltip,
  label,
  labelAll = false,
}: {
  data: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  tooltip: (i: number) => string;
  label: string;
  labelAll?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.findIndex((d) => d.value === max);
  return (
    <div className="cols" role="img" aria-label={label}>
      <div className="cols__plot">
        {[0.5, 1].map((g) => (
          <span key={g} className="cols__grid" style={{ bottom: `${g * 100}%` }} aria-hidden="true" />
        ))}
        {data.map((d, i) => (
          <div
            key={d.key}
            className={clsx('cols__col', hover === i && 'is-hover')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            aria-label={tooltip(i)}
          >
            {(labelAll || i === peak) && d.value > 0 && hover === null && (
              <span className="cols__value mono" style={{ bottom: `calc(${(d.value / max) * 100}% + 4px)` }}>
                {format(d.value)}
              </span>
            )}
            <span className="cols__bar" style={{ height: `${(d.value / max) * 100}%` }} />
            {hover === i && <span className="cols__tip">{tooltip(i)}</span>}
          </div>
        ))}
      </div>
      <div className="cols__axis" aria-hidden="true">
        {data.map((d) => (
          <span key={d.key} className="mono">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranking con barras horizontales: el largo es la cantidad; los valores van en texto. */
function Ranking({ rows }: { rows: { key: string; name: string; sub: string; value: number; valueLabel: string; extra: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="rank">
      {rows.map((r, i) => (
        <li key={r.key} className="rank__row" title={`${r.name} · ${r.sub}: ${r.valueLabel}${r.extra}`}>
          <span className="rank__n mono">{pad2(i + 1)}</span>
          <span className="rank__name">
            <strong>{r.name}</strong>
            <span className="tiny faint">{r.sub}</span>
          </span>
          <span className="rank__track" aria-hidden="true">
            <span className="rank__fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="rank__value mono">
            {r.valueLabel}
            <span className="faint">{r.extra}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ConsumptionView({ c, sessions }: { c: ConsumptionDTO; sessions: number }) {
  const units = c.topItems.reduce((s, i) => s + i.quantity, 0);
  if (sessions === 0 || units === 0)
    return (
      <Empty icon={<ChartBar size={24} />} title="Todavía no hay consumo">
        Cuando las mesas empiecen a pedir, acá vas a ver qué se pide, a qué hora y cómo se paga.
      </Empty>
    );

  const hours = DAY_ORDER.map((h) => c.byHour[h]!);
  const first = hours.findIndex((h) => h.items > 0);
  const last = hours.length - 1 - [...hours].reverse().findIndex((h) => h.items > 0);
  const shown = hours.slice(first, last + 1);
  const peak = shown.reduce((a, b) => (b.items > a.items ? b : a), shown[0]!);
  const totalMethods = c.methods.reduce((s, m) => s + m.amount, 0);
  const topMethod = c.methods[0];
  const totalCategory = c.byCategory.reduce((s, x) => s + x.revenue, 0);
  const mostCommonSize = c.partySize.distribution.reduce((a, b) => (b.tables > a.tables ? b : a));

  return (
    <>
      <div className="stats">
        <StatTile label="Personas por mesa" value={decimal(c.partySize.avg)} hint={`Lo más común: mesas de ${mostCommonSize.size}`} />
        <StatTile label="Gasto por persona" value={c.perPerson.avgSpend === null ? '—' : money(c.perPerson.avgSpend)} hint="Lo pedido, sin propina" />
        <StatTile label="Ítems por persona" value={decimal(c.perPerson.avgItems)} />
        <StatTile label="Hora pico" value={`${pad2(peak.hour)} h`} hint={`${peak.items} unidades pedidas a esa hora`} />
      </div>

      <section className="metric-sec">
        <header>
          <span className="eyebrow">01</span>
          <h2 className="display">Lo más pedido</h2>
        </header>
        <div className="bars-grid bars-grid--wide">
          <div className="panel panel--pad">
            <h3>Productos · por unidades</h3>
            <Ranking
              rows={c.topItems.slice(0, 8).map((i) => ({
                key: i.name,
                name: i.name,
                sub: i.category,
                value: i.quantity,
                valueLabel: `${i.quantity} u`,
                extra: ` · ${money(i.revenue)}`,
              }))}
            />
          </div>
          <div className="panel panel--pad">
            <h3>Por categoría · facturado</h3>
            <Ranking
              rows={c.byCategory.map((x) => ({
                key: x.name,
                name: x.name,
                sub: `${x.quantity} unidades`,
                value: x.revenue,
                valueLabel: money(x.revenue),
                extra: ` · ${Math.round((x.revenue / Math.max(totalCategory, 1)) * 100)}%`,
              }))}
            />
          </div>
        </div>
      </section>

      <section className="metric-sec">
        <header>
          <span className="eyebrow">02</span>
          <h2 className="display">Por horario</h2>
          <span className="small muted metric-sec__note">Unidades pedidas por hora (hora de Argentina)</span>
        </header>
        <div className="panel panel--pad">
          <Columns
            label="Unidades pedidas por hora del día"
            data={shown.map((h) => ({ key: String(h.hour), label: pad2(h.hour), value: h.items }))}
            format={(v) => String(v)}
            tooltip={(i) => `${pad2(shown[i]!.hour)}:00 a ${pad2((shown[i]!.hour + 1) % 24)}:00 · ${shown[i]!.items} unidades · ${shown[i]!.orders} pedidos`}
          />
        </div>
      </section>

      <div className="metric-duo">
        <section className="metric-sec">
          <header>
            <span className="eyebrow">03</span>
            <h2 className="display">Medios de pago</h2>
          </header>
          <div className="panel panel--pad stack stack-4">
            {topMethod && (
              <p className="small muted">
                <strong style={{ color: 'var(--ink)' }}>{METHOD_LABEL[topMethod.method]}</strong> se lleva el{' '}
                {Math.round((topMethod.amount / Math.max(totalMethods, 1)) * 100)}% de lo cobrado.
              </p>
            )}
            <Ranking
              rows={c.methods.map((m) => ({
                key: m.method,
                name: METHOD_LABEL[m.method],
                sub: `${m.payments} ${m.payments === 1 ? 'pago' : 'pagos'}`,
                value: m.amount,
                valueLabel: money(m.amount),
                extra: ` · ${Math.round((m.amount / Math.max(totalMethods, 1)) * 100)}%`,
              }))}
            />
          </div>
        </section>

        <section className="metric-sec">
          <header>
            <span className="eyebrow">04</span>
            <h2 className="display">Personas por mesa</h2>
          </header>
          <div className="panel panel--pad stack stack-4">
            <p className="small muted">
              En promedio se sientan <strong style={{ color: 'var(--ink)' }}>{decimal(c.partySize.avg)} personas</strong> por mesa.
            </p>
            <Columns
              label="Cantidad de mesas según cuántas personas se sentaron"
              labelAll
              data={c.partySize.distribution.map((d) => ({ key: d.size, label: d.size, value: d.tables }))}
              format={(v) => String(v)}
              tooltip={(i) => {
                const d = c.partySize.distribution[i]!;
                return `${d.tables} ${d.tables === 1 ? 'mesa' : 'mesas'} de ${d.size} ${d.size === '1' ? 'persona' : 'personas'}`;
              }}
            />
          </div>
        </section>
      </div>

      <section className="metric-sec">
        <header>
          <span className="eyebrow">05</span>
          <h2 className="display">Por mesa</h2>
        </header>
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mesa</th>
                <th>Visitas</th>
                <th>Personas prom.</th>
                <th>Ticket prom.</th>
                <th>Lo más pedido</th>
                <th className="num-col">Facturado</th>
              </tr>
            </thead>
            <tbody>
              {c.perTable.map((t) => (
                <tr key={t.tableId}>
                  <td>
                    <strong className="display" style={{ fontSize: 22 }}>
                      {pad2(t.number)}
                    </strong>{' '}
                    <span className="tiny faint">{t.label || 'Salón'}</span>
                  </td>
                  <td className="mono">{t.visits}</td>
                  <td className="mono">{decimal(t.avgDiners)}</td>
                  <td className="mono">{t.avgTicket === null ? '—' : money(t.avgTicket)}</td>
                  <td>{t.topItem ?? '—'}</td>
                  <td className="mono num-col">{money(t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
