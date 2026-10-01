import { CookingPot, MapTrifold, SquaresFour, Users } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TableSummaryDTO } from '../../../shared/types.ts';
import { Empty, Loader, Money, Segmented } from '../components/ui.tsx';
import { money, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { load, save } from '../lib/storage.ts';
import { useStaffData } from './context.tsx';
import { FloorMap, ZONES, zoneFor } from './FloorMap.tsx';
import { STATE_LABEL, pad2, tableState, type TableState } from './tableState.ts';

export { STATE_LABEL, pad2, tableState, type TableState };

type View = 'mapa' | 'tabla';
const ALL = '__todas__';
const zoneOf = (t: TableSummaryDTO) => t.label || 'Salón';

const LEGEND: TableState[] = ['free', 'busy', 'paying', 'posnet', 'settled'];

export function TablesView() {
  useDocumentTitle('Salón · Pedido Grupal');
  const { data: tables } = useStaffData<TableSummaryDTO[]>('/api/staff/tables');
  const now = useNow(30000);
  const [view, setViewState] = useState<View>(() => load<View>('pg:salon-view', 'mapa'));
  const [zone, setZoneState] = useState<string>(() => load<string>('pg:salon-zone', 'Salón'));
  const setView = (v: View) => {
    setViewState(v);
    save('pg:salon-view', v);
  };
  const setZone = (z: string) => {
    setZoneState(z);
    save('pg:salon-zone', z);
  };
  if (!tables) return <Loader />;

  const visible = tables.filter((t) => t.active || t.session);
  const open = visible.filter((t) => t.session);
  const outstanding = open.reduce((s, t) => s + (t.session?.bill.outstanding ?? 0), 0);
  const kitchen = open.reduce((s, t) => s + (t.session?.pendingItems ?? 0), 0);

  // Sectores en el orden del plano (Salón, Patio, 2do piso) y después los que haya cargado el ADMIN.
  const labels = [...new Set(visible.map(zoneOf))];
  const known = ZONES.map((z) => labels.find((l) => zoneFor(l) === z)).filter((l): l is string => !!l);
  const sectors = [...known, ...labels.filter((l) => !known.includes(l))];
  const current = view === 'tabla' && zone === ALL ? ALL : sectors.includes(zone) ? zone : (sectors[0] ?? 'Salón');
  const inZone = (z: string) => visible.filter((t) => zoneOf(t) === z);
  const groups = current === ALL ? sectors : [current];

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
        <>
          <div className="salon-bar">
            <nav className="zones" aria-label="Sectores">
              {view === 'tabla' && (
                <ZoneTab active={current === ALL} onClick={() => setZone(ALL)} title="Todas" sub="Los dos pisos" busy={open.length} total={visible.length} />
              )}
              {sectors.map((s) => {
                const list = inZone(s);
                return (
                  <ZoneTab
                    key={s}
                    active={current === s}
                    onClick={() => setZone(s)}
                    title={s}
                    sub={zoneFor(s)?.floor ?? 'Sector'}
                    busy={list.filter((t) => t.session).length}
                    total={list.length}
                    alert={list.some((t) => tableState(t) === 'posnet')}
                  />
                );
              })}
            </nav>
            <div style={{ width: 210 }}>
              <Segmented<View>
                label="Cómo ver el salón"
                value={view}
                onChange={setView}
                options={[
                  { value: 'mapa', label: <><MapTrifold size={16} /> Mapa</> },
                  { value: 'tabla', label: <><SquaresFour size={16} /> Tabla</> },
                ]}
              />
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${view}-${current}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="stack stack-6"
            >
              {view === 'mapa' ? (
                <>
                  <FloorMap zone={zoneFor(current) ?? null} tables={inZone(current)} />
                  <p className="map-hint">Deslizá para ver todo el plano →</p>
                  <div className="map-legend">
                    {LEGEND.map((s) => (
                      <span key={s} className={clsx('map-legend__item', `is-${s}`)}>
                        <i />
                        {STATE_LABEL[s]}
                      </span>
                    ))}
                    <span className="map-legend__item is-chair">
                      <i />
                      Silla ocupada
                    </span>
                  </div>
                </>
              ) : (
                groups.map((group) => (
                  <section key={group} className="stack stack-4">
                    {current === ALL && (
                      <div className="section-rule">
                        <span className="eyebrow">
                          {group} · {zoneFor(group)?.floor ?? 'Sector'}
                        </span>
                      </div>
                    )}
                    <div className="floor">
                      {inZone(group).map((t, i) => (
                        <TableTile key={t.id} t={t} i={i} now={now} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </>
  );
}

function ZoneTab({
  active,
  onClick,
  title,
  sub,
  busy,
  total,
  alert,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  busy: number;
  total: number;
  alert?: boolean;
}) {
  return (
    <button className={clsx('zone-tab', active && 'is-active')} onClick={onClick} aria-pressed={active}>
      {active && <motion.span layoutId="zone-tab-bg" className="zone-tab__bg" transition={{ type: 'spring', stiffness: 500, damping: 42 }} />}
      <span className="zone-tab__text">
        <span className="zone-tab__title">
          {title}
          {alert && <span className="zone-tab__alert" aria-label="Hay un pedido de Posnet" />}
        </span>
        <span className="zone-tab__sub">
          {sub} · {busy}/{total}
        </span>
      </span>
    </button>
  );
}

function TableTile({ t, i, now }: { t: TableSummaryDTO; i: number; now: number }) {
  const state = tableState(t);
  const s = t.session;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }}>
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
}
