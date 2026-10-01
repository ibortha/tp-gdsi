import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { DinerDTO } from '../../../shared/types.ts';
import { Avatar, Spinner } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { load, save } from '../lib/storage.ts';
import { MenuTab, type Cart } from './MenuTab.tsx';
import { PayTab } from './PayTab.tsx';
import { TableTab } from './TableTab.tsx';
import { useDinerSession, type DinerSession } from './useDinerSession.ts';

type Tab = 'menu' | 'table' | 'pay';

interface TableInfo {
  number: number;
  label: string;
  active: boolean;
  venueName: string;
  diners: string[];
}

export function DinerApp() {
  const { qrToken = '' } = useParams();
  const session = useDinerSession(qrToken);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);

  useEffect(() => {
    api<TableInfo>(`/api/public/tables/${qrToken}`).then(setTable, (e) => setTableError(errorMessage(e)));
  }, [qrToken]);

  useDocumentTitle(table ? `Mesa ${table.number} · ${table.venueName}` : 'Pedido Grupal');

  if (tableError)
    return (
      <div className="diner-shell">
        <div className="hero">
          <div className="hero-emoji">🤔</div>
          <h1>QR inválido</h1>
          <p className="muted">{tableError}</p>
        </div>
      </div>
    );
  if (session.status === 'closed') return <ClosedScreen onRejoin={session.leave} venueName={table?.venueName} />;
  if (session.status === 'join') return table ? <JoinScreen table={table} onJoin={session.join} /> : <Spinner />;
  if (!session.snapshot || !session.auth) return <Spinner label="Conectando con la mesa…" />;
  return <SeatedApp session={session} qrToken={qrToken} />;
}

function JoinScreen({ table, onJoin }: { table: TableInfo; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onJoin(name);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="diner-shell">
      <form className="hero" onSubmit={submit} style={{ paddingTop: 56 }}>
        <span className="table-tag">Mesa {table.number}</span>
        <div className="hero-emoji" aria-hidden="true">
          🍻
        </div>
        <div className="stack-sm">
          <h1>{table.venueName}</h1>
          <p className="muted">Pedí desde tu celular y dividan la cuenta sin hacer cuentas.</p>
        </div>
        {!table.active ? (
          <div className="form-error">Esta mesa no está habilitada en este momento. Avisale al mozo.</div>
        ) : (
          <div className="card card-pad stack" style={{ width: '100%', textAlign: 'left' }}>
            <label className="field">
              <span>¿Cómo te llamás?</span>
              <input
                className="input input-lg"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre o apodo"
                maxLength={20}
                autoComplete="given-name"
                autoFocus
                required
              />
            </label>
            <p className="small faint">Así te van a ver tus amigos de la mesa y el mozo.</p>
            {table.diners.length > 0 && (
              <p className="small muted">
                Ya están en la mesa: <strong>{table.diners.join(', ')}</strong>
              </p>
            )}
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || !name.trim()}>
              {busy ? 'Entrando…' : 'Unirme a la mesa'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function ClosedScreen({ onRejoin, venueName }: { onRejoin: () => void; venueName?: string }) {
  return (
    <div className="diner-shell">
      <div className="hero" style={{ paddingTop: 72 }}>
        <div className="hero-emoji">👋</div>
        <h1>¡Gracias por venir!</h1>
        <p className="muted">
          El mozo cerró la mesa{venueName ? ` en ${venueName}` : ''}. Si siguen en la mesa, pueden volver a unirse.
        </p>
        <button className="btn btn-secondary" onClick={onRejoin}>
          Volver a unirme
        </button>
      </div>
    </div>
  );
}

function SeatedApp({ session, qrToken }: { session: DinerSession; qrToken: string }) {
  const snapshot = session.snapshot!;
  const me = session.auth!.dinerId;
  const tabKey = `pg:tab:${qrToken}`;
  const cartKey = `pg:cart:${qrToken}`;
  const [tab, setTabState] = useState<Tab>(() => load<Tab>(tabKey, 'menu'));
  const [cart, setCartState] = useState<Cart>(() => load<Cart>(cartKey, {}));

  const setTab = (next: Tab) => {
    setTabState(next);
    save(tabKey, next);
    window.scrollTo({ top: 0 });
  };
  const setCart = (next: Cart) => {
    setCartState(next);
    save(cartKey, next);
  };

  const diners = useMemo(() => new Map<string, DinerDTO>(snapshot.diners.map((d) => [d.id, d])), [snapshot.diners]);
  const myPayment = snapshot.payments.find(
    (p) => p.dinerId === me && (p.status === 'RESERVED' || p.status === 'AWAITING_POSNET'),
  );
  const activeItems = snapshot.items.filter((i) => i.status !== 'CANCELLED').length;
  const meDiner = diners.get(me);

  return (
    <div className="diner-shell">
      <header className="diner-top">
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="table-tag">Mesa {snapshot.table.number}</span>
            {!session.connected && <span className="badge badge-warn">Reconectando…</span>}
          </div>
          <span className="small muted ellipsis">{session.venue?.name ?? ''}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="avatar-stack" aria-label={`En la mesa: ${snapshot.diners.map((d) => d.name).join(', ')}`}>
            {snapshot.diners.slice(0, 5).map((d) => (
              <Avatar key={d.id} name={d.name} color={d.color} />
            ))}
          </div>
          {snapshot.diners.length > 5 && <span className="small muted">+{snapshot.diners.length - 5}</span>}
        </div>
      </header>

      {meDiner && tab === 'menu' && (
        <p className="small muted" style={{ padding: '12px 16px 0' }}>
          Hola, <strong>{meDiner.name}</strong> 👋 Lo que pidas se suma a la cuenta de la mesa.
        </p>
      )}

      {tab === 'menu' && <MenuTab session={session} cart={cart} setCart={setCart} onOrdered={() => setTab('table')} />}
      {tab === 'table' && <TableTab snapshot={snapshot} me={me} diners={diners} onPay={() => setTab('pay')} />}
      {tab === 'pay' && <PayTab session={session} me={me} diners={diners} onGoToMenu={() => setTab('menu')} />}

      <nav className="bottom-nav" aria-label="Secciones">
        <div className="bottom-nav-inner">
          <button aria-current={tab === 'menu' ? 'page' : undefined} onClick={() => setTab('menu')}>
            <span className="nav-icon" aria-hidden="true">
              📖
            </span>
            Menú
            {Object.keys(cart).length > 0 && <span className="nav-badge">{Object.values(cart).reduce((s, l) => s + l.quantity, 0)}</span>}
          </button>
          <button aria-current={tab === 'table' ? 'page' : undefined} onClick={() => setTab('table')}>
            <span className="nav-icon" aria-hidden="true">
              🧾
            </span>
            Cuenta
            {activeItems > 0 && <span className="nav-badge">{activeItems}</span>}
          </button>
          <button aria-current={tab === 'pay' ? 'page' : undefined} onClick={() => setTab('pay')}>
            <span className="nav-icon" aria-hidden="true">
              💳
            </span>
            Pagar
            {myPayment && <span className="nav-badge">!</span>}
          </button>
        </div>
      </nav>
    </div>
  );
}
