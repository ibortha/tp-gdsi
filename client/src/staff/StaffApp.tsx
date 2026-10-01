import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { PosnetAlertDTO, StaffUserDTO } from '../../../shared/types.ts';
import { Spinner, useAction, useToast } from '../components/ui.tsx';
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

  if (checking) return <Spinner />;
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
    api('/api/public/demo').then(() => setDemo(true), () => setDemo(false));
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
    <main className="diner-shell" style={{ paddingBottom: 24 }}>
      <form className="hero" onSubmit={submit} style={{ paddingTop: 56 }}>
        <div className="hero-emoji" aria-hidden="true">
          🧑‍🍳
        </div>
        <div className="stack-sm">
          <h1>Panel del local</h1>
          <p className="muted">Para mozos y administradores.</p>
        </div>
        <div className="card card-pad stack" style={{ width: '100%', textAlign: 'left' }}>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Contraseña</span>
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
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
          {demo && (
            <div className="stack-sm">
              <span className="tiny faint">Usuarios de demostración:</span>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEmail('admin@pedidogrupal.test');
                    setPassword('admin1234');
                  }}
                >
                  ADMIN
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEmail('mozo@pedidogrupal.test');
                    setPassword('mozo1234');
                  }}
                >
                  Mozo
                </button>
              </div>
            </div>
          )}
        </div>
        <Link to="/" className="small">
          ← Volver al inicio
        </Link>
      </form>
    </main>
  );
}

/** Pitido corto con WebAudio para avisar un pedido de Posnet (no requiere archivos de audio). */
function beep() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
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
      toast(`Mesa ${alert.tableNumber}: ${alert.dinerName} pidió el Posnet (${money(alert.amount + alert.tipAmount)})`, 'error');
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
      <div className="staff-shell">
        <header className="staff-top no-print">
          <div className="staff-top-inner">
            <Link to="/staff/mesas" className="staff-brand" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span aria-hidden="true">🍻</span> Pedido Grupal
            </Link>
            {!connected && <span className="badge badge-warn">Reconectando…</span>}
            <span className="grow" />
            <span className="small ellipsis" style={{ opacity: 0.8 }}>
              {user.name} · {user.role}
            </span>
            <button className="btn btn-sm" style={{ background: 'rgb(255 255 255 / 12%)', color: 'inherit' }} onClick={logout}>
              Salir
            </button>
          </div>
          <StaffNav isAdmin={isAdmin} />
        </header>
        <main className="staff-main">
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

function StaffNav({ isAdmin }: { isAdmin: boolean }) {
  const { data: kitchen } = useStaffData<{ active: { items: { status: string }[] }[] }>('/api/staff/kitchen');
  const pending = kitchen?.active.reduce((s, t) => s + t.items.filter((i) => i.status === 'PENDING' || i.status === 'PREPARING').length, 0) ?? 0;
  const links: { to: string; label: string; count?: number; admin?: boolean }[] = [
    { to: '/staff/mesas', label: 'Mesas' },
    { to: '/staff/comandas', label: 'Comandas', count: pending },
    { to: '/staff/menu', label: 'Menú', admin: true },
    { to: '/staff/qr', label: 'Mesas y QR', admin: true },
    { to: '/staff/personal', label: 'Personal', admin: true },
    { to: '/staff/metricas', label: 'Métricas', admin: true },
    { to: '/staff/ajustes', label: 'Ajustes', admin: true },
  ];
  return (
    <nav className="staff-nav" aria-label="Secciones del panel">
      {links
        .filter((l) => !l.admin || isAdmin)
        .map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {l.label}
            {!!l.count && <span className="nav-count">{l.count}</span>}
          </NavLink>
        ))}
    </nav>
  );
}

/** Pedidos de Posnet pendientes: visibles en todas las pantallas del panel. */
export function PosnetAlerts({ tableId }: { tableId?: string }) {
  const { call } = useStaff();
  const { data } = useStaffData<PosnetAlertDTO[]>('/api/staff/posnet');
  const { run, busy } = useAction();
  const now = useNow(15000);
  const alerts = (data ?? []).filter((a) => !tableId || a.tableId === tableId);
  if (alerts.length === 0) return null;
  return (
    <section className="posnet-alerts no-print" aria-label="Pedidos de Posnet">
      {alerts.map((a) => (
        <div key={a.paymentId} className="posnet-alert" role="alert">
          <span style={{ fontSize: '1.5rem' }} aria-hidden="true">
            💳
          </span>
          <div className="grow">
            <strong>
              Mesa {a.tableNumber} · {a.dinerName} pidió el Posnet
            </strong>
            <div className="small muted num">
              Cobrar {money(a.amount + a.tipAmount)}
              {a.tipAmount > 0 ? ` (incluye ${money(a.tipAmount)} de propina)` : ''} · {timeAgo(a.requestedAt, now)}
            </div>
          </div>
          <div className="row">
            {!tableId && (
              <Link className="btn btn-secondary btn-sm" to={`/staff/mesas/${a.tableId}`}>
                Ver mesa
              </Link>
            )}
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => run(() => call(`/api/staff/payments/${a.paymentId}/reject-posnet`, { method: 'POST' }), 'Pedido de Posnet rechazado')}
            >
              Rechazar
            </button>
            <button
              className="btn btn-ok btn-sm"
              disabled={busy}
              onClick={() => run(() => call(`/api/staff/payments/${a.paymentId}/confirm-posnet`, { method: 'POST' }), 'Cobro confirmado')}
            >
              ✓ Cobré {money(a.amount + a.tipAmount)}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
