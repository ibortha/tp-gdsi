import {
  ArrowRight,
  BookOpenText,
  ChartLineUp,
  CookingPot,
  CreditCard,
  GearSix,
  QrCode,
  SignOut,
  SquaresFour,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { PosnetAlertDTO, StaffUserDTO } from '../../../shared/types.ts';
import { Loader, LogoMark, Wordmark, useAction, useToast } from '../components/ui.tsx';
import { ApiError, api, errorMessage, type RequestOptions } from '../lib/api.ts';
import { money, timeAgo } from '../lib/format.ts';
import { useDocumentTitle, useNow } from '../lib/hooks.ts';
import { connectSocket } from '../lib/socket.ts';
import { load, save } from '../lib/storage.ts';
import { StaffContext, useStaff, useStaffData, type StaffContextValue } from './context.tsx';
import { KitchenView } from './KitchenView.tsx';
import { MenuAdmin } from './MenuAdmin.tsx';
import { MetricsView } from './MetricsView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { StaffAdmin } from './StaffAdmin.tsx';
import { TableDetail } from './TableDetail.tsx';
import { TablesAdmin } from './TablesAdmin.tsx';
import { TablesView } from './TablesView.tsx';

const TOKEN_KEY = 'pg:staff';

export function StaffApp() {
  const [token, setToken] = useState<string | null>(() => load<string | null>(TOKEN_KEY, null));
  const [user, setUser] = useState<StaffUserDTO | null>(null);
  const [checking, setChecking] = useState(!!token);

  const logout = useCallback(() => {
    if (token) void api('/api/staff/logout', { method: 'POST', staffToken: token }).catch(() => {});
    save(TOKEN_KEY, null);
    setToken(null);
    setUser(null);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api<StaffUserDTO>('/api/staff/me', { staffToken: token })
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          save(TOKEN_KEY, null);
          setToken(null);
        }
      })
      .finally(() => setChecking(false));
  }, [token]);

  if (checking) return <Loader />;
  if (!token || !user)
    return (
      <Login
        onLogin={(t, u) => {
          save(TOKEN_KEY, t);
          setToken(t);
          setUser(u);
        }}
      />
    );
  return <StaffShell token={token} user={user} logout={logout} />;
}

function Login({ onLogin }: { onLogin: (token: string, user: StaffUserDTO) => void }) {
  useDocumentTitle('Ingresar · Pedido Grupal');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    api('/api/public/demo').then(
      () => setDemo(true),
      () => setDemo(false),
    );
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: StaffUserDTO }>('/api/staff/login', { body: { email, password } });
      onLogin(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login__brand">
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Wordmark size={20} />
        </Link>
        <div className="stack stack-4">
          <span className="eyebrow eyebrow--night">Panel del local</span>
          <h1 className="display login__title">
            El salón, <em>en vivo</em>.
          </h1>
          <p className="login__lead">Mesas, comandas y cobros en una sola pantalla. Los pedidos llegan solos desde los celulares.</p>
        </div>
        <span className="eyebrow eyebrow--night">Para mozos y administradores</span>
      </aside>
      <main className="login__main">
        <form className="login__form stack stack-6" onSubmit={submit}>
          <div className="stack stack-2">
            <span className="eyebrow">Ingresar</span>
            <h2 className="display" style={{ fontSize: 40 }}>
              Hola de nuevo.
            </h2>
          </div>
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">Contraseña</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn--ink btn--lg btn--block btn--split" disabled={busy}>
            {busy ? 'Ingresando…' : 'Ingresar'}
            <ArrowRight size={18} weight="bold" />
          </button>
          {demo && (
            <div className="login__demo">
              <span className="eyebrow">Demo</span>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  setEmail('admin@pedidogrupal.test');
                  setPassword('admin1234');
                }}
              >
                ADMIN
              </button>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => {
                  setEmail('mozo@pedidogrupal.test');
                  setPassword('mozo1234');
                }}
              >
                Mozo
              </button>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}

/** Pitido corto con WebAudio para avisar un pedido de Posnet. */
function beep() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    [0, 0.18].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = i === 0 ? 880 : 1175;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.35);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.4);
    });
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // sin audio
  }
}

function StaffShell({ token, user, logout }: { token: string; user: StaffUserDTO; logout: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(true);
  const bumpTimer = useRef<number | null>(null);

  const call = useCallback(
    async <T,>(path: string, options: Omit<RequestOptions, 'staffToken'> = {}) => {
      try {
        return await api<T>(path, { ...options, staffToken: token });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) logout();
        throw error;
      }
    },
    [token, logout],
  );

  useEffect(() => {
    const socket = connectSocket({ staffToken: token });
    const bump = () => {
      if (bumpTimer.current) return;
      bumpTimer.current = window.setTimeout(() => {
        bumpTimer.current = null;
        setVersion((v) => v + 1);
      }, 120);
    };
    socket.on('connect', () => {
      setConnected(true);
      bump();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('staff:changed', bump);
    socket.on('menu:changed', bump);
    socket.on('staff:posnet', (alert) => {
      beep();
      toast(`Mesa ${alert.tableNumber} pide el Posnet · ${money(alert.amount + alert.tipAmount)}`);
      bump();
    });
    return () => {
      socket.disconnect();
    };
  }, [token, toast]);

  const ctx: StaffContextValue = useMemo(() => ({ token, user, version, call, logout }), [token, user, version, call, logout]);
  const isAdmin = user.role === 'ADMIN';

  return (
    <StaffContext.Provider value={ctx}>
      <div className="s-shell">
        <Sidebar isAdmin={isAdmin} user={user} connected={connected} onLogout={logout} />
        <main className="s-main">
          <PosnetAlerts />
          <Routes>
            <Route index element={<Navigate to="mesas" replace />} />
            <Route path="mesas" element={<TablesView />} />
            <Route path="mesas/:tableId" element={<TableDetail />} />
            <Route path="comandas" element={<KitchenView />} />
            {isAdmin && (
              <>
                <Route path="menu" element={<MenuAdmin />} />
                <Route path="qr" element={<TablesAdmin />} />
                <Route path="personal" element={<StaffAdmin />} />
                <Route path="metricas" element={<MetricsView />} />
                <Route path="ajustes" element={<SettingsView />} />
              </>
            )}
            <Route path="*" element={<Navigate to="mesas" replace />} />
          </Routes>
        </main>
      </div>
    </StaffContext.Provider>
  );
}

const LINKS: { to: string; label: string; icon: Icon; admin?: boolean; group: 'salon' | 'admin' }[] = [
  { to: '/staff/mesas', label: 'Salón', icon: SquaresFour, group: 'salon' },
  { to: '/staff/comandas', label: 'Comandas', icon: CookingPot, group: 'salon' },
  { to: '/staff/menu', label: 'Carta', icon: BookOpenText, admin: true, group: 'admin' },
  { to: '/staff/qr', label: 'Mesas y QR', icon: QrCode, admin: true, group: 'admin' },
  { to: '/staff/personal', label: 'Personal', icon: UsersThree, admin: true, group: 'admin' },
  { to: '/staff/metricas', label: 'Métricas', icon: ChartLineUp, admin: true, group: 'admin' },
  { to: '/staff/ajustes', label: 'Ajustes', icon: GearSix, admin: true, group: 'admin' },
];

function Sidebar({ isAdmin, user, connected, onLogout }: { isAdmin: boolean; user: StaffUserDTO; connected: boolean; onLogout: () => void }) {
  const { data: kitchen } = useStaffData<{ active: { items: { status: string }[] }[] }>('/api/staff/kitchen');
  const pending = kitchen?.active.reduce((s, t) => s + t.items.filter((i) => i.status === 'PENDING' || i.status === 'PREPARING').length, 0) ?? 0;
  const counts: Record<string, number> = { '/staff/comandas': pending };
  const links = LINKS.filter((l) => !l.admin || isAdmin);

  const renderLink = (l: (typeof LINKS)[number]) => (
    <NavLink key={l.to} to={l.to} className={({ isActive }) => clsx('s-link', isActive && 'is-active')}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="s-link-bg" className="s-link__bg" transition={{ type: 'spring', stiffness: 500, damping: 42 }} />}
          <l.icon size={20} weight={isActive ? 'fill' : 'regular'} />
          <span className="s-link__label">{l.label}</span>
          {!!counts[l.to] && <span className="s-link__count mono">{counts[l.to]}</span>}
        </>
      )}
    </NavLink>
  );

  return (
    <aside className="s-side">
      <Link to="/staff/mesas" className="s-brand" aria-label="Pedido Grupal">
        <LogoMark size={26} />
        <span className="s-brand__name">
          pedido <em>grupal</em>
        </span>
      </Link>
      <nav className="s-nav" aria-label="Secciones del panel">
        <span className="s-nav__group eyebrow eyebrow--night">Salón</span>
        {links.filter((l) => l.group === 'salon').map(renderLink)}
        {isAdmin && <span className="s-nav__group eyebrow eyebrow--night">Administración</span>}
        {links.filter((l) => l.group === 'admin').map(renderLink)}
      </nav>
      <div className="s-user">
        <span className="s-user__avatar mono">{user.name.charAt(0)}</span>
        <span className="grow stack" style={{ gap: 0 }}>
          <span className="s-user__name ellipsis">{user.name}</span>
          <span className="s-user__role">
            <span className={clsx('dot', connected && 'dot--live')} style={connected ? undefined : { background: 'var(--accent)' }} />
            {connected ? user.role : 'Reconectando'}
          </span>
        </span>
        <button className="s-user__out" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión">
          <SignOut size={18} />
        </button>
      </div>
    </aside>
  );
}

/** Pedidos de Posnet pendientes: visibles en todas las pantallas del panel. */
export function PosnetAlerts() {
  const { call } = useStaff();
  const { data } = useStaffData<PosnetAlertDTO[]>('/api/staff/posnet');
  const { run, busy } = useAction();
  const now = useNow(15000);
  const alerts = data ?? [];
  return (
    <AnimatePresence initial={false}>
      {alerts.length > 0 && (
        <motion.section
          className="alerts"
          aria-label="Pedidos de Posnet"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          {alerts.map((a) => (
            <motion.div key={a.paymentId} layout className="alert" role="alert" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
              <span className="alert__icon">
                <CreditCard size={22} weight="fill" />
              </span>
              <div className="grow stack" style={{ gap: 2 }}>
                <strong>
                  Mesa {String(a.tableNumber).padStart(2, '0')} · {a.dinerName} pide el Posnet
                </strong>
                <span className="small muted">
                  {timeAgo(a.requestedAt, now)}
                  {a.tipAmount > 0 ? ` · incluye ${money(a.tipAmount)} de propina` : ''}
                </span>
              </div>
              <div className="row wrap">
                <Link className="btn btn--ghost btn--sm" to={`/staff/mesas/${a.tableId}`}>
                  Ver mesa
                </Link>
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => run(() => call(`/api/staff/payments/${a.paymentId}/reject-posnet`, { method: 'POST' }), 'Pedido de Posnet rechazado')}
                >
                  Rechazar
                </button>
                <button
                  className="btn btn--accent btn--sm"
                  disabled={busy}
                  onClick={() => run(() => call(`/api/staff/payments/${a.paymentId}/confirm-posnet`, { method: 'POST' }), 'Cobro confirmado')}
                >
                  Cobré {money(a.amount + a.tipAmount)}
                </button>
              </div>
            </motion.div>
          ))}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
