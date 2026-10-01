import { useMemo, useState } from 'react';
import type { MenuItemDTO } from '../../../shared/types.ts';
import { Empty, Sheet, Spinner, Stepper, useAction } from '../components/ui.tsx';
import { money, plural } from '../lib/format.ts';
import type { DinerSession } from './useDinerSession.ts';

export type Cart = Record<string, { quantity: number; note: string }>;

const effectivePrice = (item: MenuItemDTO) => item.promoPrice ?? item.price;

export function MenuTab({
  session,
  cart,
  setCart,
  onOrdered,
}: {
  session: DinerSession;
  cart: Cart;
  setCart: (cart: Cart) => void;
  onOrdered: () => void;
}) {
  const { menu } = session;
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const itemsById = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);
  const sections = useMemo(
    () =>
      (menu?.categories ?? [])
        .map((c) => ({ category: c, items: (menu?.items ?? []).filter((i) => i.categoryId === c.id) }))
        .filter((s) => s.items.length > 0),
    [menu],
  );
  const promos = (menu?.items ?? []).filter((i) => i.promoPrice !== null && i.available);

  const lines = Object.entries(cart)
    .map(([id, line]) => ({ item: itemsById.get(id), ...line }))
    .filter((l): l is { item: MenuItemDTO; quantity: number; note: string } => !!l.item && l.item.available);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.quantity * effectivePrice(l.item), 0);

  const setQty = (id: string, quantity: number) => {
    const next = { ...cart };
    if (quantity <= 0) delete next[id];
    else next[id] = { quantity: Math.min(quantity, 20), note: cart[id]?.note ?? '' };
    setCart(next);
  };

  if (!menu) return <Spinner label="Cargando el menú…" />;

  const scrollTo = (id: string) => {
    setActiveCat(id);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className={`diner-main${count > 0 ? ' has-floating' : ''}`}>
      <div className="menu-cats">
        <div className="chips" role="tablist" aria-label="Categorías">
          {sections.map(({ category }) => (
            <button
              key={category.id}
              className={`chip${activeCat === category.id ? ' active' : ''}`}
              onClick={() => scrollTo(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {promos.length > 0 && (
        <div className="banner banner-warn">
          <span className="banner-icon" aria-hidden="true">
            🔥
          </span>
          <div>
            <h3>Promos de ahora</h3>
            <p className="small">
              {promos.map((p) => `${p.name} a ${money(p.promoPrice!)}${p.promoLabel ? ` (${p.promoLabel})` : ''}`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {sections.length === 0 && <Empty emoji="📭" title="El menú está vacío" />}

      {sections.map(({ category, items }) => (
        <section key={category.id} id={`cat-${category.id}`} className="menu-section">
          <h2>{category.name}</h2>
          <div className="card list">
            {items.map((item) => (
              <MenuItemRow key={item.id} item={item} quantity={cart[item.id]?.quantity ?? 0} onChange={(q) => setQty(item.id, q)} />
            ))}
          </div>
        </section>
      ))}

      {count > 0 && (
        <div className="floating-bar">
          <button className="cart-bar" onClick={() => setCartOpen(true)}>
            <span>
              Tu pedido · {plural(count, 'producto', 'productos')}
              <br />
              <span className="num">{money(total)}</span>
            </span>
            <span className="pill">Ver y enviar</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <CartSheet
          lines={lines}
          total={total}
          cart={cart}
          setCart={setCart}
          setQty={setQty}
          onClose={() => setCartOpen(false)}
          onSend={async (note) => {
            await session.act('/api/diner/orders', {
              items: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, note: l.note || undefined })),
              note: note || undefined,
            });
            setCart({});
            setCartOpen(false);
            onOrdered();
          }}
        />
      )}
    </main>
  );
}

function MenuItemRow({ item, quantity, onChange }: { item: MenuItemDTO; quantity: number; onChange: (q: number) => void }) {
  return (
    <div className={`menu-item${item.available ? '' : ' unavailable'}`}>
      <div className="grow stack-sm">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <h3>{item.name}</h3>
          {item.promoLabel && item.promoPrice !== null && <span className="badge badge-accent">{item.promoLabel}</span>}
          {!item.available && <span className="badge">Agotado</span>}
        </div>
        {item.description && <p className="small muted clamp-2">{item.description}</p>}
        <div className="row-between" style={{ marginTop: 4 }}>
          <div className="price-line num">
            <span>{money(item.promoPrice ?? item.price)}</span>
            {item.promoPrice !== null && <span className="small faint strike">{money(item.price)}</span>}
          </div>
          {item.available &&
            (quantity === 0 ? (
              <button className="btn btn-primary btn-sm" onClick={() => onChange(1)} aria-label={`Agregar ${item.name}`}>
                + Agregar
              </button>
            ) : (
              <Stepper value={quantity} min={0} max={20} onChange={onChange} label={`Cantidad de ${item.name}`} />
            ))}
        </div>
      </div>
      {item.imageUrl && <img className="menu-thumb" src={item.imageUrl} alt="" loading="lazy" />}
    </div>
  );
}

function CartSheet({
  lines,
  total,
  cart,
  setCart,
  setQty,
  onClose,
  onSend,
}: {
  lines: { item: MenuItemDTO; quantity: number; note: string }[];
  total: number;
  cart: Cart;
  setCart: (cart: Cart) => void;
  setQty: (id: string, q: number) => void;
  onClose: () => void;
  onSend: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const { run, busy } = useAction();

  return (
    <Sheet
      title="Tu pedido"
      onClose={onClose}
      footer={
        <div className="stack-sm">
          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={busy || lines.length === 0}
            onClick={() => run(() => onSend(note.trim()), '¡Pedido enviado a la cocina!')}
          >
            {busy ? 'Enviando…' : `Enviar pedido · ${money(total)}`}
          </button>
          <p className="tiny faint center">Va directo a la cocina y al mozo. Se suma a la cuenta de la mesa; quién paga qué lo eligen al final.</p>
        </div>
      }
    >
      <div className="stack">
        <div className="card list">
          {lines.map(({ item, quantity, note: itemNote }) => (
            <div key={item.id} className="list-item stack-sm">
              <div className="row-between">
                <div className="grow">
                  <strong>{item.name}</strong>
                  <div className="small muted num">
                    {money(item.promoPrice ?? item.price)} c/u · {money((item.promoPrice ?? item.price) * quantity)}
                  </div>
                </div>
                <Stepper value={quantity} min={0} max={20} onChange={(q) => setQty(item.id, q)} label={`Cantidad de ${item.name}`} />
              </div>
              {editing === item.id ? (
                <input
                  className="input"
                  autoFocus
                  maxLength={140}
                  placeholder="Ej.: sin cebolla, bien cocida…"
                  value={itemNote}
                  onChange={(e) => setCart({ ...cart, [item.id]: { quantity, note: e.target.value } })}
                  onBlur={() => setEditing(null)}
                />
              ) : (
                <button className="link-btn small" style={{ justifySelf: 'start' }} onClick={() => setEditing(item.id)}>
                  {itemNote ? `✏️ ${itemNote}` : '+ Agregar aclaración'}
                </button>
              )}
            </div>
          ))}
        </div>
        <label className="field">
          <span>Comentario para la cocina (opcional)</span>
          <textarea
            className="input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej.: traer todo junto, somos celíacos…"
          />
        </label>
      </div>
    </Sheet>
  );
}
