import { ArrowRight, BookOpenText, Receipt, SealQuestion, Wallet, type Icon } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { AvatarStack, Loader, Wordmark } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { load, save } from '../lib/storage.ts';
import { toPeople } from '../lib/tones.ts';
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

export const pad = (n: number) => String(n).padStart(2, '0');

export function DinerApp() {
  const { qrToken = '' } = useParams();
  const session = useDinerSession(qrToken);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);

  useEffect(() => {
    api<TableInfo>(`/api/public/tables/${qrToken}`).then(setTable, (e) => setTableError(errorMessage(e)));
  }, [qrToken]);

  useDocumentTitle(table ? `Mesa ${table.number} · ${table.venueName}` : 'Pedido Grupal');

  if (tableError) return <NightScreen icon={SealQuestion} title="Este QR no es de ninguna mesa" text={tableError} />;
  if (session.status === 'closed')
    return (
      <NightScreen
        title={<>Gracias por <em>venir</em>.</>}
        text={`El mozo cerró la mesa${table ? ` en ${table.venueName}` : ''}. Si siguen sentados, pueden volver a unirse.`}
        action={{ label: 'Volver a la mesa', onClick: session.leave }}
      />
    );
  if (session.status === 'join') return table ? <JoinScreen table={table} onJoin={session.join} /> : <Loader />;
  if (!session.snapshot || !session.auth) return <Loader label="Conectando con la mesa" />;
  return <SeatedApp session={session} qrToken={qrToken} />;
}

function NightScreen({
  icon: IconCmp,
  title,
  text,
  action,
}: {
  icon?: Icon;
  title: React.ReactNode;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="night">
      <div className="night__top">
        <Wordmark size={18} />
      </div>
      <div className="night__body">
        {IconCmp && <IconCmp size={40} weight="light" />}
        <h1 className="display night__title">{title}</h1>
        <p className="night__text">{text}</p>
        {action && (
          <button className="btn btn--accent btn--lg" onClick={action.onClick}>
            {action.label}
            <ArrowRight weight="bold" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function JoinScreen({ table, onJoin }: { table: TableInfo; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seated = useMemo(() => table.diners.map((n, i) => ({ id: `${i}`, name: n })), [table.diners]);
  const people = [...toPeople(seated.map((d) => ({ ...d, color: '', joinedAt: '' }))).values()];

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
    <div className="night join">
      <div className="night__top">
        <Wordmark size={18} />
        <span className="eyebrow eyebrow--night">{table.label || 'Salón'}</span>
      </div>
      <motion.div
        className="join__hero"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="eyebrow eyebrow--night">{table.venueName}</span>
        <h1 className="display join__title">
          Mesa <em>{pad(table.number)}</em>
        </h1>
        <p className="join__lead">Pidan desde el celular. Al final, cada uno paga lo suyo — sin calculadora.</p>
      </motion.div>

      <motion.form
        className="join__card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        {!table.active ? (
          <div className="form-error">Esta mesa no está habilitada. Avisale al mozo.</div>
        ) : (
          <>
            {people.length > 0 && (
              <div className="join__who">
                <AvatarStack people={people} />
                <span className="small muted">
                  Ya {people.length === 1 ? 'está' : 'están'} <strong>{formatNames(people.map((p) => p.name))}</strong>
                </span>
              </div>
            )}
            <label className="field">
              <span className="field__label">¿Cómo te llamás?</span>
              <input
                className="input input--lg"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre o apodo"
                maxLength={20}
                autoComplete="given-name"
                autoFocus
                required
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn--accent btn--lg btn--block btn--split" disabled={busy || !name.trim()}>
              {busy ? 'Entrando…' : 'Sentarme a la mesa'}
              <ArrowRight weight="bold" size={18} />
            </button>
            <p className="field__hint" style={{ textAlign: 'center' }}>
              Tu nombre aparece en la cuenta compartida.
            </p>
          </>
        )}
      </motion.form>
    </div>
  );
}

export function formatNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

const TABS: { id: Tab; label: string; icon: Icon }[] = [
  { id: 'menu', label: 'Carta', icon: BookOpenText },
  { id: 'table', label: 'Cuenta', icon: Receipt },
  { id: 'pay', label: 'Pagar', icon: Wallet },
];

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

  const people = useMemo(() => toPeople(snapshot.diners), [snapshot.diners]);
  const myPayment = snapshot.payments.find(
    (p) => p.dinerId === me && (p.status === 'RESERVED' || p.status === 'AWAITING_POSNET'),
  );
  const items = snapshot.items.filter((i) => i.status !== 'CANCELLED').length;
  const inCart = Object.values(cart).reduce((s, l) => s + l.quantity, 0);
  const badges: Record<Tab, string | null> = {
    menu: inCart > 0 ? String(inCart) : null,
    table: items > 0 ? String(items) : null,
    pay: myPayment ? '•' : null,
  };

  return (
    <div className="d-shell">
      <header className="d-top">
        <div className="d-top__id">
          <span className="d-top__table">
            <span className="display">Mesa</span>
            <span className="mono">{pad(snapshot.table.number)}</span>
          </span>
          <span className="eyebrow ellipsis">{session.venue?.name ?? ''}</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className={clsx('d-live', !session.connected && 'is-off')}>
            <span className={clsx('dot', session.connected && 'dot--live')} />
            {session.connected ? 'En vivo' : 'Sin conexión'}
          </span>
          <AvatarStack people={[...people.values()]} />
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {tab === 'menu' && <MenuTab session={session} cart={cart} setCart={setCart} onOrdered={() => setTab('table')} />}
          {tab === 'table' && <TableTab session={session} me={me} people={people} onPay={() => setTab('pay')} />}
          {tab === 'pay' && <PayTab session={session} me={me} people={people} onGoToMenu={() => setTab('menu')} />}
        </motion.div>
      </AnimatePresence>

      <nav className="d-nav" aria-label="Secciones">
        {TABS.map(({ id, label, icon: IconCmp }) => {
          const active = tab === id;
          return (
            <button key={id} className="d-nav__item" aria-current={active ? 'page' : undefined} onClick={() => setTab(id)}>
              {active && <motion.span layoutId="d-nav-pill" className="d-nav__pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="d-nav__icon">
                <IconCmp size={22} weight={active ? 'fill' : 'regular'} />
                {badges[id] && <span className="d-nav__badge">{badges[id]}</span>}
              </span>
              <span className="d-nav__label">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
