// Plano del local: cada zona dibujada en SVG, con las mesas en su lugar, sus sillas y su estado en vivo.
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import type { TableSummaryDTO } from '../../../shared/types.ts';
import { money } from '../lib/format.ts';
import { STATE_LABEL, pad2, tableState } from './tableState.ts';

type Shape = 'round' | 'square' | 'rect';
interface Slot {
  x: number;
  y: number;
  shape: Shape;
  seats: number;
}

export interface Zone {
  id: string;
  /** Nombre del sector tal como se carga en cada mesa ("Salón", "Patio", "2do piso"). */
  label: string;
  floor: 'Planta baja' | 'Primer piso';
  slots: Slot[];
  Decor: () => React.ReactElement;
}

const W = 1000;
const H = 640;

// ---------- Elementos fijos de cada zona ----------

function Label({ x, y, children, anchor = 'middle' }: { x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="fp-label">
      {children}
    </text>
  );
}

function Plant({ x, y, r = 16 }: { x: number; y: number; r?: number }) {
  return (
    <g className="fp-plant">
      <circle cx={x} cy={y} r={r} />
      <circle cx={x - r * 0.3} cy={y - r * 0.25} r={r * 0.45} className="fp-plant__leaf" />
      <circle cx={x + r * 0.35} cy={y + r * 0.2} r={r * 0.4} className="fp-plant__leaf" />
    </g>
  );
}

function Stairs({ x, y, w, h, steps = 8, vertical = true }: { x: number; y: number; w: number; h: number; steps?: number; vertical?: boolean }) {
  return (
    <g className="fp-stairs">
      <rect x={x} y={y} width={w} height={h} rx={6} />
      {Array.from({ length: steps - 1 }, (_, i) =>
        vertical ? (
          <line key={i} x1={x} x2={x + w} y1={y + ((i + 1) * h) / steps} y2={y + ((i + 1) * h) / steps} />
        ) : (
          <line key={i} y1={y} y2={y + h} x1={x + ((i + 1) * w) / steps} x2={x + ((i + 1) * w) / steps} />
        ),
      )}
    </g>
  );
}

function SalonDecor() {
  return (
    <>
      <rect x={20} y={20} width={960} height={600} rx={20} className="fp-floor" />
      {/* Paredes, con la entrada abajo y la puerta al patio a la derecha */}
      <path d="M430 620 H40 Q20 620 20 600 V40 Q20 20 40 20 H960 Q980 20 980 40 V250 M980 370 V600 Q980 620 960 620 H570" className="fp-wall" />
      <path d="M26 190 V560 M36 190 V560" className="fp-window" />
      <text x={56} y={380} className="fp-label" textAnchor="middle" transform="rotate(-90 56 380)">
        Ventanal
      </text>
      {/* Barra con banquetas */}
      <rect x={60} y={48} width={360} height={58} rx={12} className="fp-fixture" />
      <Label x={240} y={84}>Barra</Label>
      {Array.from({ length: 7 }, (_, i) => (
        <circle key={i} cx={86 + i * 51} cy={130} r={11} className="fp-stool" />
      ))}
      {/* Cocina */}
      <rect x={700} y={40} width={260} height={130} rx={10} className="fp-kitchen" />
      <Label x={830} y={112}>Cocina</Label>
      <path d="M720 172 H940" className="fp-pass" />
      <Label x={830} y={194}>Pase</Label>
      {/* Escalera y baños */}
      <Stairs x={660} y={470} w={130} h={130} />
      <Label x={725} y={458}>↑ 2do piso</Label>
      <rect x={820} y={470} width={140} height={130} rx={10} className="fp-room" />
      <Label x={890} y={541}>Baños</Label>
      {/* Accesos */}
      <path d="M440 632 H560" className="fp-door" />
      <Label x={500} y={606}>Entrada</Label>
      <Label x={968} y={316} anchor="end">Patio →</Label>
      <Plant x={60} y={585} />
      <Plant x={400} y={585} r={13} />
      <Plant x={600} y={585} r={13} />
    </>
  );
}

function PatioDecor() {
  return (
    <>
      <defs>
        <pattern id="fp-deck" width="1000" height="28" patternUnits="userSpaceOnUse">
          <line x1="0" x2="1000" y1="27" y2="27" className="fp-deck-line" />
        </pattern>
      </defs>
      <rect x={20} y={20} width={960} height={600} rx={20} className="fp-floor fp-floor--out" />
      <rect x={20} y={20} width={960} height={600} rx={20} fill="url(#fp-deck)" />
      <rect x={20} y={20} width={960} height={600} rx={20} className="fp-fence" />
      {/* Pérgola */}
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={150 + i * 70} x2={150 + i * 70} y1={40} y2={110} className="fp-pergola" />
      ))}
      <path d="M140 75 H730" className="fp-pergola fp-pergola--beam" />
      <Label x={440} y={136}>Pérgola</Label>
      {/* Árboles y canteros */}
      <Plant x={80} y={90} r={44} />
      <Plant x={900} y={560} r={48} />
      <Plant x={900} y={90} r={30} />
      <rect x={40} y={570} width={200} height={34} rx={10} className="fp-planter" />
      <Label x={140} y={592}>Cantero</Label>
      {/* Fogonero */}
      <circle cx={820} cy={340} r={46} className="fp-fire" />
      <circle cx={820} cy={340} r={22} className="fp-fire__core" />
      <Label x={820} y={410}>Fogonero</Label>
      <path d="M20 270 V370" className="fp-door fp-door--v" />
      <Label x={40} y={325} anchor="start">← Salón</Label>
    </>
  );
}

function SecondFloorDecor() {
  return (
    <>
      <rect x={20} y={20} width={960} height={600} rx={20} className="fp-floor" />
      {/* Terraza con baranda */}
      <rect x={20} y={20} width={960} height={110} rx={20} className="fp-floor fp-floor--out" />
      <path d="M20 130 H980" className="fp-rail" />
      <Label x={500} y={86}>Terraza</Label>
      <Plant x={70} y={72} r={22} />
      <Plant x={930} y={72} r={22} />
      <path d="M40 620 Q20 620 20 600 V130 M980 130 V600 Q980 620 960 620 H40" className="fp-wall" />
      {/* Escalera desde planta baja */}
      <Stairs x={40} y={440} w={130} h={160} />
      <Label x={105} y={428}>↓ Planta baja</Label>
      {/* Barra chica */}
      <rect x={880} y={180} width={70} height={240} rx={12} className="fp-fixture" />
      <text x={915} y={300} className="fp-label" textAnchor="middle" transform="rotate(-90 915 300)">
        Barra
      </text>
      {/* Lounge */}
      <rect x={770} y={500} width={180} height={34} rx={12} className="fp-sofa" />
      <rect x={770} y={560} width={180} height={34} rx={12} className="fp-sofa" />
      <rect x={815} y={540} width={90} height={16} rx={6} className="fp-fixture" />
      <Label x={860} y={488}>Lounge</Label>
    </>
  );
}

export const ZONES: Zone[] = [
  {
    id: 'salon',
    label: 'Salón',
    floor: 'Planta baja',
    Decor: SalonDecor,
    slots: [
      { x: 150, y: 270, shape: 'round', seats: 4 },
      { x: 330, y: 270, shape: 'round', seats: 4 },
      { x: 510, y: 280, shape: 'square', seats: 4 },
      { x: 230, y: 470, shape: 'rect', seats: 6 },
      { x: 480, y: 470, shape: 'rect', seats: 6 },
      { x: 680, y: 290, shape: 'round', seats: 2 },
    ],
  },
  {
    id: 'patio',
    label: 'Patio',
    floor: 'Planta baja',
    Decor: PatioDecor,
    slots: [
      { x: 330, y: 230, shape: 'rect', seats: 8 },
      { x: 620, y: 240, shape: 'round', seats: 4 },
      { x: 300, y: 450, shape: 'round', seats: 4 },
      { x: 560, y: 460, shape: 'square', seats: 2 },
    ],
  },
  {
    id: 'piso2',
    label: '2do piso',
    floor: 'Primer piso',
    Decor: SecondFloorDecor,
    slots: [
      { x: 210, y: 250, shape: 'round', seats: 2 },
      { x: 450, y: 250, shape: 'rect', seats: 8 },
      { x: 720, y: 250, shape: 'rect', seats: 6 },
      { x: 330, y: 470, shape: 'round', seats: 4 },
      { x: 510, y: 470, shape: 'round', seats: 4 },
      { x: 680, y: 470, shape: 'square', seats: 4 },
    ],
  },
];

/** Para sectores sin plano dibujado (o con más mesas que lugares): una grilla prolija. */
function autoSlots(count: number): Slot[] {
  const cols = Math.min(4, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => ({
    x: ((i % cols) + 0.5) * (W / cols),
    y: 80 + (Math.floor(i / cols) + 0.5) * ((H - 120) / Math.max(rows, 1)),
    shape: 'round' as const,
    seats: 4,
  }));
}

// ---------- Mesa ----------

function tableGeometry(slot: Slot) {
  if (slot.shape === 'round') {
    const r = slot.seats <= 2 ? 36 : slot.seats <= 4 ? 46 : 56;
    const chairs = Array.from({ length: slot.seats }, (_, i) => {
      const a = (i / slot.seats) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(a) * (r + 17), y: Math.sin(a) * (r + 17), rot: (a * 180) / Math.PI + 90 };
    });
    return { w: r * 2, h: r * 2, r, chairs };
  }
  if (slot.shape === 'square') {
    const s = slot.seats <= 2 ? 70 : 88;
    const sides = slot.seats <= 2 ? [0, 180] : [0, 90, 180, 270];
    const chairs = sides.map((deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return { x: Math.cos(a) * (s / 2 + 17), y: Math.sin(a) * (s / 2 + 17), rot: deg };
    });
    return { w: s, h: s, r: 12, chairs };
  }
  const perSide = Math.ceil(slot.seats / 2);
  const w = 60 + perSide * 44;
  const h = 84;
  const chairs: { x: number; y: number; rot: number }[] = [];
  for (let i = 0; i < perSide; i++) chairs.push({ x: -w / 2 + (w / perSide) * (i + 0.5), y: -h / 2 - 17, rot: 0 });
  for (let i = 0; i < slot.seats - perSide; i++) chairs.push({ x: -w / 2 + (w / perSide) * (i + 0.5), y: h / 2 + 17, rot: 180 });
  return { w, h, r: 14, chairs };
}

function FloorTable({ table, slot, onOpen }: { table: TableSummaryDTO; slot: Slot; onOpen: () => void }) {
  const state = tableState(table);
  const s = table.session;
  const g = tableGeometry(slot);
  const occupied = s?.diners ?? 0;
  const extra = Math.max(0, occupied - slot.seats);
  const caption = s ? `${money(s.bill.outstanding > 0 ? s.bill.outstanding : s.bill.total)} · ${s.diners} ${s.diners === 1 ? 'persona' : 'personas'}` : 'Libre';
  const title = `Mesa ${pad2(table.number)} · ${STATE_LABEL[state]}${s ? ` · ${caption}` : ''}`;
  // El texto va debajo de la última fila de sillas (si hay) para no taparlas.
  const bottom = Math.max(g.h / 2, ...g.chairs.map((c) => c.y + 11)) + 20;

  return (
    <g
      className={clsx('ft', `ft--${state}`)}
      transform={`translate(${slot.x} ${slot.y})`}
      role="link"
      tabIndex={0}
      aria-label={title}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
    >
      <title>{title}</title>
      {state === 'posnet' && (
        slot.shape === 'round' ? <circle r={g.r + 8} className="ft__pulse" /> : <rect x={-g.w / 2 - 8} y={-g.h / 2 - 8} width={g.w + 16} height={g.h + 16} rx={g.r + 8} className="ft__pulse" />
      )}
      {g.chairs.map((c, i) => (
        <rect
          key={i}
          x={-11}
          y={-8}
          width={22}
          height={16}
          rx={6}
          transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`}
          className={clsx('ft__chair', i < occupied && 'is-taken')}
        />
      ))}
      {slot.shape === 'round' ? (
        <circle r={g.r} className="ft__top" />
      ) : (
        <rect x={-g.w / 2} y={-g.h / 2} width={g.w} height={g.h} rx={g.r} className="ft__top" />
      )}
      <text className="ft__num" y={g.h > 80 ? -2 : 4} textAnchor="middle" dominantBaseline="middle">
        {pad2(table.number)}
      </text>
      {g.h > 80 && s && (
        <text className="ft__mini" y={26} textAnchor="middle">
          {state === 'posnet' ? 'Posnet' : STATE_LABEL[state]}
        </text>
      )}
      <text className="ft__caption" y={bottom} textAnchor="middle">
        {caption}
      </text>
      {extra > 0 && (
        <g transform={`translate(${g.w / 2 + 6} ${-g.h / 2 - 6})`}>
          <circle r={14} className="ft__extra" />
          <text className="ft__extra-text" textAnchor="middle" dominantBaseline="central">
            +{extra}
          </text>
        </g>
      )}
    </g>
  );
}

export function FloorMap({ zone, tables }: { zone: Zone | null; tables: TableSummaryDTO[] }) {
  const navigate = useNavigate();
  const sorted = tables.slice().sort((a, b) => a.number - b.number);
  const drawn = zone && sorted.length <= zone.slots.length;
  const slots = drawn ? zone.slots : autoSlots(sorted.length);
  const Decor = drawn ? zone.Decor : null;

  return (
    <div className="floor-map">
      <svg viewBox={`0 0 ${W} ${H + 20}`} role="group" aria-label={`Plano: ${zone?.label ?? 'sector'}`}>
        {Decor ? <Decor /> : <rect x={20} y={20} width={960} height={600} rx={20} className="fp-floor" />}
        {!Decor && <path d="M40 620 Q20 620 20 600 V40 Q20 20 40 20 H960 Q980 20 980 40 V600 Q980 620 960 620 Z" className="fp-wall" />}
        {sorted.map((t, i) => (
          <FloorTable key={t.id} table={t} slot={slots[i]!} onOpen={() => navigate(`/staff/mesas/${t.id}`)} />
        ))}
      </svg>
    </div>
  );
}

export function zoneFor(label: string): Zone | undefined {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return ZONES.find((z) => norm(z.label) === norm(label || 'Salón'));
}
