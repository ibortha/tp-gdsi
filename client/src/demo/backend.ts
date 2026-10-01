// Backend de la demo estática: corre en el navegador las mismas reglas de negocio que el servidor
// (server/domain), con datos de prueba guardados en localStorage. Reemplaza a la API HTTP y a Socket.IO.
import type { Role, ServerToClientEvents } from '../../../shared/types.ts';
import { toStaffDTO } from '../../../server/domain/dto.ts';
import { AppError, forbidden } from '../../../server/domain/errors.ts';
import { createDomain } from '../../../server/domain/index.ts';
import type { DB, StaffUser } from '../../../server/domain/model.ts';
import { simulateHistory } from '../../../server/history.ts';
import { DEMO_USERS, buildSeedDB } from '../../../server/seed-data.ts';
import { ApiError, type RequestOptions } from '../lib/api.ts';

const STORAGE_KEY = 'pg:demo:db:v1';
export const SHOWCASE_TABLE = 4;

// ---------- Datos de prueba ----------

/** Arma un local "en pleno servicio": historial para métricas y varias mesas en distintos momentos. */
function buildScenario(): DB {
  const db = buildSeedDB();
  simulateHistory(db, 3);

  let clock = Date.now() - 56 * 60_000;
  const d = createDomain(db, { now: () => new Date(clock) });
  const minutes = (m: number) => {
    clock += m * 60_000;
  };
  const menu = (name: string) => {
    const item = db.menuItems.find((m) => m.name === name);
    if (!item) throw new Error(`Falta ${name} en el menú de prueba`);
    return item.id;
  };
  const qr = (n: number) => db.tables.find((t) => t.number === n)!.qrToken;
  const order = (diner: Parameters<typeof d.diners.placeOrder>[0], ...lines: [string, number?, string?][]) =>
    d.diners.placeOrder(
      diner,
      lines.map(([name, quantity = 1, note]) => ({ menuItemId: menu(name), quantity, note })),
    );
  const serve = (...items: { id: string }[]) => items.forEach((i) => d.staff.setItemStatus(i.id, 'DELIVERED'));

  // Mesa 7 · Patio: cuatro amigos dividiendo el total, dos ya pagaron su parte.
  const [nico, caro, lucho, agus] = ['Nico', 'Caro', 'Lucho', 'Agus'].map((n) => d.diners.join(qr(7), n).diner);
  const m7 = [
    ...order(nico!, ['Jarra IPA (1,5 L)', 2]),
    ...order(caro!, ['Tabla de picada']),
    ...order(lucho!, ['Muzzarella'], ['Fugazzeta']),
    ...order(agus!, ['Limonada de la casa']),
  ];
  minutes(14);
  serve(...m7);
  minutes(4);

  // Mesa 9: ya pagaron todo, falta que el mozo libere la mesa.
  const [pau, santi] = ['Pau', 'Santi'].map((n) => d.diners.join(qr(9), n).diner);
  const m9 = [...order(pau!, ['Clásica'], ['Pinta Stout']), ...order(santi!, ['Veggie'], ['Gaseosa línea Coca-Cola'])];
  minutes(6);

  // Mesa 4 · la mesa de la demo: Fede, Meli y Tomi.
  const [fede, meli, tomi] = ['Fede', 'Meli', 'Tomi'].map((n) => d.diners.join(qr(SHOWCASE_TABLE), n).diner);
  const m4 = [
    ...order(fede!, ['Pinta IPA', 2], ['Doble carne', 1, 'sin cebolla']),
    ...order(meli!, ['Papas cheddar y bacon'], ['Pinta Honey']),
  ];
  minutes(2);
  const [golden, nachos] = order(tomi!, ['Pinta Golden'], ['Nachos con guacamole']);
  minutes(5);
  serve(...m9);
  minutes(3);

  // Mesa 2: Juli pagó lo suyo y Sofi pidió el Posnet.
  const [sofi, juli] = ['Sofi', 'Juli'].map((n) => d.diners.join(qr(2), n).diner);
  const m2 = [...order(sofi!, ['Triple carne'], ['Pinta IPA']), ...order(juli!, ['Papas fritas'], ['Agua con o sin gas'])];
  minutes(8);
  serve(...m4, golden!);
  d.staff.setItemStatus(nachos!.id, 'PREPARING');
  minutes(3);
  serve(...m2);

  // Cobros de la mesa 7 (división en 4) y de la mesa 9 (pagaron todo).
  d.diners.startSplit(nico!, 4);
  d.diners.confirmPayment(nico!, d.diners.chooseMethod(nico!, 'QR').id);
  d.diners.takeShares(caro!, 1);
  d.diners.confirmPayment(caro!, d.diners.chooseMethod(caro!, 'MERCADO_PAGO', 10).id);
  d.diners.startSplit(pau!, 2);
  d.diners.confirmPayment(pau!, d.diners.chooseMethod(pau!, 'MERCADO_PAGO').id);
  d.diners.takeShares(santi!, 1);
  d.diners.confirmPayment(santi!, d.diners.chooseMethod(santi!, 'QR', 15).id);
  minutes(6);

  // Mesa 4: Meli ya pagó su pinta; Tomi pidió el postre.
  const honey = m4.find((i) => i.name === 'Pinta Honey')!;
  d.diners.claimPortion(meli!, { orderItemId: honey.id, unitIndex: 0, denominator: 1 });
  d.diners.confirmPayment(meli!, d.diners.chooseMethod(meli!, 'MERCADO_PAGO', 10).id);
  order(tomi!, ['Brownie con helado']);
  minutes(4);

  // Mesa 2: pagos en curso.
  d.diners.claimItemsOf(juli!, juli!.id);
  d.diners.confirmPayment(juli!, d.diners.chooseMethod(juli!, 'QR').id);
  d.diners.claimItemsOf(sofi!, sofi!.id);
  d.diners.chooseMethod(sofi!, 'POSNET', 10);
  minutes(1);

  // Mesa 5: recién se sentaron, todo en cocina.
  const [vale, lu] = ['Vale', 'Lu'].map((n) => d.diners.join(qr(5), n).diner);
  order(vale!, ['Pinta Golden', 2], ['Papas fritas']);
  order(lu!, ['Limonada de la casa'], ['Veggie', 1, 'sin tomate']);

  // Sesiones del staff ya iniciadas para el selector de vistas.
  d.staff.login(DEMO_USERS.mozo.email, DEMO_USERS.mozo.password);
  d.staff.login(DEMO_USERS.admin.email, DEMO_USERS.admin.password);
  return db;
}

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    // datos corruptos o sin localStorage: se arma de nuevo
  }
  const db = buildScenario();
  persist(db);
  return db;
}

function persist(db: DB) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // sin persistencia (modo privado): la demo funciona igual mientras la pestaña siga abierta
  }
}

const db = loadDB();

// ---------- Tiempo real simulado ----------

type Events = ServerToClientEvents & { connect: () => void; disconnect: () => void };

export interface DemoSocket {
  auth: { dinerToken?: string; staffToken?: string };
  fire<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void;
  sessionId?: string;
  staff?: boolean;
}

const sockets = new Set<DemoSocket>();
const pending = new Set<string>();
let flushScheduled = false;

const domain = createDomain(db, {
  persist: () => persist(db),
  events: {
    sessionChanged(sessionId) {
      pending.add(sessionId);
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(flush, 0);
      }
    },
    sessionClosed(sessionId) {
      pending.delete(sessionId);
      for (const s of sockets) {
        if (s.sessionId === sessionId) {
          s.fire('session:closed', { sessionId });
          sockets.delete(s);
        }
        if (s.staff) s.fire('staff:changed', { sessionId });
      }
    },
    menuChanged() {
      for (const s of sockets) s.fire('menu:changed');
    },
    tablesChanged() {
      for (const s of sockets) if (s.staff) s.fire('staff:changed', { sessionId: null });
    },
    posnetRequested(alert) {
      for (const s of sockets) if (s.staff) s.fire('staff:posnet', alert);
    },
  },
});

function flush() {
  flushScheduled = false;
  const ids = [...pending];
  pending.clear();
  for (const sessionId of ids) {
    const snapshot = domain.diners.snapshot(sessionId);
    for (const s of sockets) {
      if (s.sessionId === sessionId) s.fire('session:state', structuredClone(snapshot));
      if (s.staff) s.fire('staff:changed', { sessionId });
    }
  }
}

export function connectDemo(socket: DemoSocket) {
  try {
    if (socket.auth.staffToken) {
      domain.staff.authenticate(socket.auth.staffToken);
      socket.staff = true;
    } else if (socket.auth.dinerToken) {
      socket.sessionId = domain.diners.authenticate(socket.auth.dinerToken).sessionId;
    } else throw new Error('sin credenciales');
  } catch {
    setTimeout(() => socket.fire('disconnect'), 0);
    return;
  }
  sockets.add(socket);
  setTimeout(() => {
    socket.fire('connect');
    if (socket.sessionId) socket.fire('session:state', structuredClone(domain.diners.snapshot(socket.sessionId)));
  }, 0);
}

export function disconnectDemo(socket: DemoSocket) {
  sockets.delete(socket);
}

// Las reservas vencen solas, como en el servidor.
setInterval(() => domain.ctx.expireDue(), 1000);

// Otra pestaña cambió los datos (por ejemplo, Meli en una pestaña y Fede en otra): se recargan y se avisa a las vistas.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  const next = JSON.parse(e.newValue) as DB;
  for (const key of Object.keys(next) as (keyof DB)[]) (db as unknown as Record<string, unknown>)[key] = next[key];
  for (const s of sockets) {
    if (s.staff) s.fire('staff:changed', { sessionId: null });
    else if (s.sessionId) {
      const session = db.sessions.find((x) => x.id === s.sessionId);
      if (session?.status === 'OPEN') s.fire('session:state', structuredClone(domain.diners.snapshot(s.sessionId)));
      else {
        s.fire('session:closed', { sessionId: s.sessionId });
        sockets.delete(s);
      }
    }
  }
});

// ---------- API simulada ----------

type Handler = (params: string[], body: Record<string, unknown>, opts: RequestOptions) => unknown;

const diner = (opts: RequestOptions) => domain.diners.authenticate(opts.dinerToken ?? undefined);
const staff = (opts: RequestOptions, roles: Role[] = ['ADMIN', 'MOZO']): StaffUser => {
  const user = domain.staff.authenticate(opts.staffToken ?? undefined);
  if (!roles.includes(user.role)) throw forbidden('Esta sección es solo para el ADMIN.');
  return user;
};
const admin = (opts: RequestOptions) => staff(opts, ['ADMIN']);
const snap = (sessionId: string) => domain.diners.snapshot(sessionId);
type Any = any;

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/public\/config$/, () => {
    const { publicUrl: _ignored, ...venue } = domain.admin.venue();
    return venue;
  }],
  ['GET', /^\/api\/public\/menu$/, () => domain.diners.menu()],
  ['GET', /^\/api\/public\/tables\/([^/]+)$/, ([qr]) => domain.diners.tableInfo(qr!)],
  ['POST', /^\/api\/public\/tables\/([^/]+)\/join$/, ([qr], body) => {
    const { token, diner: d, sessionId } = domain.diners.join(qr!, String(body.name ?? ''));
    return { token, dinerId: d.id, sessionId, snapshot: snap(sessionId) };
  }],
  ['GET', /^\/api\/public\/demo$/, () => ({
    venueName: domain.admin.venue().name,
    tables: domain.staff
      .tables()
      .filter((t) => t.active)
      .map((t) => ({ number: t.number, label: t.label, qrToken: t.qrToken, diners: t.session?.diners ?? 0 })),
  })],

  ['GET', /^\/api\/diner\/me$/, (_p, _b, o) => {
    const d = diner(o);
    return { dinerId: d.id, sessionId: d.sessionId, snapshot: snap(d.sessionId) };
  }],
  ['POST', /^\/api\/diner\/orders$/, (_p, b, o) => {
    const d = diner(o);
    domain.diners.placeOrder(d, (b.items as Any[]) ?? [], (b.note as string) ?? '');
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/claims$/, (_p, b, o) => {
    const d = diner(o);
    domain.diners.claimPortion(d, b as Any);
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/claims\/release$/, (_p, b, o) => {
    const d = diner(o);
    domain.diners.releasePortion(d, b as Any);
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/claims\/of\/([^/]+)$/, ([id], _b, o) => {
    const d = diner(o);
    domain.diners.claimItemsOf(d, id!);
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/split$/, (_p, b, o) => {
    const d = diner(o);
    domain.diners.startSplit(d, Number(b.parts), Number(b.take ?? 1));
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/split\/take$/, (_p, b, o) => {
    const d = diner(o);
    domain.diners.takeShares(d, Number(b.count));
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/split\/cancel$/, (_p, _b, o) => {
    const d = diner(o);
    domain.diners.cancelSplit(d);
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/payment\/method$/, (_p, b, o) => {
    const d = diner(o);
    domain.diners.chooseMethod(d, b.method as Any, Number(b.tipPercent ?? 0));
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/payments\/([^/]+)\/confirm$/, ([id], _b, o) => {
    const d = diner(o);
    domain.diners.confirmPayment(d, id!);
    return snap(d.sessionId);
  }],
  ['POST', /^\/api\/diner\/payments\/([^/]+)\/cancel$/, ([id], _b, o) => {
    const d = diner(o);
    domain.diners.cancelPayment(d, id!);
    return snap(d.sessionId);
  }],

  ['POST', /^\/api\/staff\/login$/, (_p, b) => {
    const { token, user } = domain.staff.login(String(b.email ?? ''), String(b.password ?? ''));
    return { token, user: toStaffDTO(user) };
  }],
  ['POST', /^\/api\/staff\/logout$/, (_p, _b, o) => {
    if (o.staffToken) domain.staff.logout(o.staffToken);
  }],
  ['GET', /^\/api\/staff\/me$/, (_p, _b, o) => toStaffDTO(staff(o))],
  ['GET', /^\/api\/staff\/tables$/, (_p, _b, o) => (staff(o), domain.staff.tables())],
  ['GET', /^\/api\/staff\/tables\/([^/]+)$/, ([id], _b, o) => (staff(o), domain.staff.tableDetail(id!))],
  ['GET', /^\/api\/staff\/kitchen$/, (_p, _b, o) => (staff(o), domain.staff.kitchen())],
  ['GET', /^\/api\/staff\/posnet$/, (_p, _b, o) => (staff(o), domain.staff.posnetAlerts())],
  ['POST', /^\/api\/staff\/items\/([^/]+)\/status$/, ([id], b, o) => {
    staff(o);
    domain.staff.setItemStatus(id!, b.status as Any);
  }],
  ['POST', /^\/api\/staff\/payments\/([^/]+)\/confirm-posnet$/, ([id], _b, o) => domain.staff.confirmPosnet(staff(o), id!)],
  ['POST', /^\/api\/staff\/payments\/([^/]+)\/reject-posnet$/, ([id], _b, o) => {
    staff(o);
    domain.staff.rejectPosnet(id!);
  }],
  ['POST', /^\/api\/staff\/payments\/([^/]+)\/void$/, ([id], _b, o) => domain.staff.voidPayment(staff(o), id!)],
  ['POST', /^\/api\/staff\/sessions\/([^/]+)\/charge$/, ([id], b, o) => {
    domain.staff.chargeRemaining(staff(o), id!, b.method as Any);
  }],
  ['POST', /^\/api\/staff\/sessions\/([^/]+)\/close$/, ([id], b, o) => {
    staff(o);
    domain.staff.closeSession(id!, Boolean(b.force));
  }],
  ['POST', /^\/api\/staff\/splits\/([^/]+)\/dissolve$/, ([id], _b, o) => {
    staff(o);
    domain.staff.dissolveSplit(id!);
  }],

  ['POST', /^\/api\/admin\/categories$/, (_p, b, o) => (admin(o), domain.admin.createCategory(String(b.name ?? '')))],
  ['PATCH', /^\/api\/admin\/categories\/([^/]+)$/, ([id], b, o) => (admin(o), domain.admin.updateCategory(id!, b as Any))],
  ['DELETE', /^\/api\/admin\/categories\/([^/]+)$/, ([id], _b, o) => {
    admin(o);
    domain.admin.deleteCategory(id!);
  }],
  ['POST', /^\/api\/admin\/items$/, (_p, b, o) => (admin(o), domain.admin.createMenuItem(b as Any))],
  ['PATCH', /^\/api\/admin\/items\/([^/]+)$/, ([id], b, o) => (admin(o), domain.admin.updateMenuItem(id!, b as Any))],
  ['DELETE', /^\/api\/admin\/items\/([^/]+)$/, ([id], _b, o) => {
    admin(o);
    domain.admin.deleteMenuItem(id!);
  }],
  ['POST', /^\/api\/admin\/tables$/, (_p, b, o) => (admin(o), domain.admin.createTable(b as Any))],
  ['PATCH', /^\/api\/admin\/tables\/([^/]+)$/, ([id], b, o) => (admin(o), domain.admin.updateTable(id!, b as Any))],
  ['POST', /^\/api\/admin\/tables\/([^/]+)\/regenerate-qr$/, ([id], _b, o) => (admin(o), domain.admin.regenerateQr(id!))],
  ['DELETE', /^\/api\/admin\/tables\/([^/]+)$/, ([id], _b, o) => {
    admin(o);
    domain.admin.deleteTable(id!);
  }],
  ['GET', /^\/api\/admin\/staff$/, (_p, _b, o) => (admin(o), domain.admin.listStaff())],
  ['POST', /^\/api\/admin\/staff$/, (_p, b, o) => (admin(o), domain.admin.createStaff(b as Any))],
  ['PATCH', /^\/api\/admin\/staff\/([^/]+)$/, ([id], b, o) => domain.admin.updateStaff(admin(o), id!, b as Any)],
  ['DELETE', /^\/api\/admin\/staff\/([^/]+)$/, ([id], _b, o) => domain.admin.deleteStaff(admin(o), id!)],
  ['GET', /^\/api\/admin\/venue$/, (_p, _b, o) => (admin(o), domain.admin.venue())],
  ['PUT', /^\/api\/admin\/venue$/, (_p, b, o) => (admin(o), domain.admin.updateVenue(b as Any))],
  ['GET', /^\/api\/admin\/metrics$/, (_p, _b, o) => (admin(o), domain.metrics())],
];

/** Reemplazo de fetch(): mismas rutas, mismas respuestas y mismos errores que la API real. */
export async function demoFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 60)); // una latencia mínima, como en la red
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const url = path.split('?')[0]!;
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const match = pattern.exec(url);
    if (!match) continue;
    try {
      const result = handler(match.slice(1).map(decodeURIComponent), (options.body ?? {}) as Record<string, unknown>, options);
      return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
    } catch (error) {
      if (error instanceof AppError) throw new ApiError(error.code, error.message, error.status);
      console.error(error);
      throw new ApiError('INTERNAL', 'Ocurrió un error inesperado en la demo.', 500);
    }
  }
  throw new ApiError('NOT_FOUND', 'Ruta inexistente.', 404);
}

// ---------- Selector de vistas ----------

export interface Persona {
  value: string;
  label: string;
  group: string;
  apply: () => void;
}

const go = (hash: string) => {
  window.location.hash = hash;
  window.location.reload();
};

const tokenOf = (role: Role) => {
  const user = db.staff.find((s) => s.role === role && s.active);
  if (!user) return null;
  const session = db.staffSessions.find((s) => s.staffId === user.id);
  if (session) return session.token;
  const creds = role === 'ADMIN' ? DEMO_USERS.admin : DEMO_USERS.mozo;
  try {
    return domain.staff.login(user.email, creds.password).token;
  } catch {
    return null;
  }
};

/** Las personas que se pueden "ser" en la demo: comensales de la mesa 4, uno nuevo, el mozo y el ADMIN. */
export function personas(): Persona[] {
  const list: Persona[] = [{ value: 'landing', label: 'Portada', group: 'General', apply: () => go('#/') }];
  const showcase = db.tables.find((t) => t.number === SHOWCASE_TABLE && !t.deleted);
  const session = showcase && db.sessions.find((s) => s.tableId === showcase.id && s.status === 'OPEN');
  if (showcase && session) {
    for (const d of db.diners.filter((x) => x.sessionId === session.id)) {
      list.push({
        value: `diner:${d.id}`,
        label: `${d.name} · comensal`,
        group: `Mesa ${String(SHOWCASE_TABLE).padStart(2, '0')}`,
        apply: () => {
          localStorage.setItem(`pg:diner:${showcase.qrToken}`, JSON.stringify({ token: d.token, dinerId: d.id }));
          go(`#/m/${showcase.qrToken}`);
        },
      });
    }
  }
  const free = db.tables
    .filter((t) => t.active && !t.deleted && !db.sessions.some((s) => s.tableId === t.id && s.status === 'OPEN'))
    .sort((a, b) => a.number - b.number)[0];
  if (free) {
    list.push({
      value: `join:${free.qrToken}`,
      label: `Sentarme en la mesa ${String(free.number).padStart(2, '0')} (libre)`,
      group: 'Comensal nuevo',
      apply: () => {
        localStorage.removeItem(`pg:diner:${free.qrToken}`);
        go(`#/m/${free.qrToken}`);
      },
    });
  }
  const staffViews: [Role, string, string][] = [
    ['MOZO', 'mesas', 'Mozo · Salón'],
    ['MOZO', 'comandas', 'Mozo · Comandas'],
    ['ADMIN', 'mesas', 'ADMIN · Salón'],
    ['ADMIN', 'menu', 'ADMIN · Carta'],
    ['ADMIN', 'qr', 'ADMIN · Mesas y QR'],
    ['ADMIN', 'metricas', 'ADMIN · Métricas'],
  ];
  for (const [role, page, label] of staffViews) {
    list.push({
      value: `staff:${role}:${page}`,
      label,
      group: 'Panel del local',
      apply: () => {
        const token = tokenOf(role);
        if (token) localStorage.setItem('pg:staff', JSON.stringify(token));
        go(`#/staff/${page}`);
      },
    });
  }
  return list;
}

/** Qué persona se está viendo ahora, para mostrarla en el selector. */
export function currentPersona(): string {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const diner = /^\/m\/([^/?]+)/.exec(hash);
  if (diner) {
    try {
      const auth = JSON.parse(localStorage.getItem(`pg:diner:${diner[1]}`) ?? 'null') as { dinerId: string } | null;
      return auth ? `diner:${auth.dinerId}` : `join:${diner[1]}`;
    } catch {
      return `join:${diner[1]}`;
    }
  }
  const staffPage = /^\/staff\/?([^/?]*)/.exec(hash);
  if (staffPage) {
    try {
      const token = JSON.parse(localStorage.getItem('pg:staff') ?? 'null') as string | null;
      const user = token ? domain.staff.authenticate(token) : null;
      return user ? `staff:${user.role}:${staffPage[1] || 'mesas'}` : 'login';
    } catch {
      return 'login';
    }
  }
  return 'landing';
}

/** Vuelve a los datos de prueba originales (borra todo lo que se hizo en la demo). */
export function resetDemo() {
  for (const key of Object.keys(localStorage)) if (key.startsWith('pg:')) localStorage.removeItem(key);
  go('#/');
}

