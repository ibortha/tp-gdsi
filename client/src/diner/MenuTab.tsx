import { ArrowRight, MagnifyingGlass, NotePencil, Plus, X } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItemDTO } from '../../../shared/types.ts';
import { Empty, Loader, Money, Sheet, Stepper, useAction } from '../components/ui.tsx';
import { money, plural } from '../lib/format.ts';
import { pad } from './DinerApp.tsx';
import type { DinerSession } from './useDinerSession.ts';

export type Cart = Record<string, { quantity: number; note: string }>;

const priceOf = (item: MenuItemDTO) => item.promoPrice ?? item.price;

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

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
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const itemsById = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);
  const sections = useMemo(() => {
    const q = normalize(query.trim());
    return (menu?.categories ?? [])
      .map((c) => ({
        category: c,
        items: (menu?.items ?? []).filter(
          (i) => i.categoryId === c.id && (!q || normalize(`${i.name} ${i.description}`).includes(q)),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [menu, query]);
  const promos = (menu?.items ?? []).filter((i) => i.promoPrice !== null && i.available);

  // La categoría resaltada sigue al scroll: la última sección que ya pasó debajo de las pestañas.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current: string | null = null;
        for (const [id, el] of sectionRefs.current) if (el.getBoundingClientRect().top <= 140) current = id;
        setActiveCat(current);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [sections]);

  const lines = Object.entries(cart)
    .map(([id, line]) => ({ item: itemsById.get(id), ...line }))
    .filter((l): l is { item: MenuItemDTO; quantity: number; note: string } => !!l.item && l.item.available);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.quantity * priceOf(l.item), 0);

  const setQty = (id: string, quantity: number) => {
    const next = { ...cart };
    if (quantity <= 0) delete next[id];
    else next[id] = { quantity: Math.min(quantity, 20), note: cart[id]?.note ?? '' };
    setCart(next);
  };

  if (!menu) return <Loader label="Cargando la carta" />;

  const jump = (id: string) => {
    setActiveCat(id);
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className={clsx('d-main', count > 0 && 'has-dock')}>
      <section className="page-head">
        <span className="eyebrow">La carta</span>
        <h1 className="display page-title">
          ¿Qué van a <em>pedir</em>?
        </h1>
        <div className="input-icon">
          <MagnifyingGlass size={18} />
          <input
            className="input"
            type="search"
            placeholder="Buscar en la carta"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar en la carta"
          />
        </div>
      </section>

      {promos.length > 0 && !query && (
        <section className="promos" aria-label="Promociones">
          {promos.map((p) => (
            <button key={p.id} className="promo" onClick={() => setQty(p.id, (cart[p.id]?.quantity ?? 0) + 1)}>
              <span className="tag tag--accent">{p.promoLabel ?? 'Promo'}</span>
              <strong className="promo__name">{p.name}</strong>
              <span className="promo__price">
                <span className="mono">{money(p.promoPrice!)}</span>
                <span className="mono strike faint">{money(p.price)}</span>
              </span>
              <span className="promo__add" aria-hidden="true">
                <Plus size={16} weight="bold" />
              </span>
            </button>
          ))}
        </section>
      )}

      {!query && (
        <nav className="cat-tabs" aria-label="Categorías">
          {sections.map(({ category }) => {
            const active = (activeCat ?? sections[0]?.category.id) === category.id;
            return (
              <button key={category.id} className={clsx('cat-tabs__item', active && 'is-active')} onClick={() => jump(category.id)}>
                {category.name}
                {active && <motion.span layoutId="cat-bar" className="cat-tabs__bar" transition={{ type: 'spring', stiffness: 500, damping: 42 }} />}
              </button>
            );
          })}
        </nav>
      )}

      {sections.length === 0 && (
        <Empty icon={<MagnifyingGlass size={24} />} title="Nada por acá">
          No encontramos “{query}” en la carta.
        </Empty>
      )}

      {sections.map(({ category, items }) => (
        <section
          key={category.id}
          className="menu-sec"
          data-cat={category.id}
          ref={(el) => {
            if (el) sectionRefs.current.set(category.id, el);
            else sectionRefs.current.delete(category.id);
          }}
        >
          <header className="menu-sec__head">
            <h2 className="display">{category.name}</h2>
            <span className="eyebrow">{pad(items.length)}</span>
          </header>
          <ul className="dishes">
            {items.map((item) => (
              <Dish key={item.id} item={item} quantity={cart[item.id]?.quantity ?? 0} onChange={(q) => setQty(item.id, q)} />
            ))}
          </ul>
        </section>
      ))}

      <AnimatePresence>
        {count > 0 && (
          <motion.button
            key="cart-dock"
            className="dock dock--cart"
            onClick={() => setCartOpen(true)}
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          >
            <span className="dock__count mono">{count}</span>
            <span className="grow" style={{ textAlign: 'left' }}>
              <span className="dock__label">Ver pedido</span>
            </span>
            <Money cents={total} className="dock__amount" />
            <ArrowRight size={18} weight="bold" />
          </motion.button>
        )}
      </AnimatePresence>

      <CartSheet
        open={cartOpen}
        lines={lines}
        total={total}
        tableNumber={session.snapshot!.table.number}
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
    </main>
  );
}

function Dish({ item, quantity, onChange }: { item: MenuItemDTO; quantity: number; onChange: (q: number) => void }) {
  const promo = item.promoPrice !== null;
  return (
    <li className={clsx('dish', !item.available && 'is-out', quantity > 0 && 'is-picked')}>
      <div className="dish__body">
        <div className="dish__line">
          <h3 className="dish__name">{item.name}</h3>
          <span className="dish__leader" aria-hidden="true" />
          <span className={clsx('dish__price mono', promo && 'is-promo')}>{money(priceOf(item))}</span>
        </div>
        {item.description && <p className="dish__desc">{item.description}</p>}
        <div className="dish__foot">
          <div className="row" style={{ gap: 8 }}>
            {promo && <span className="tag tag--accent">{item.promoLabel ?? 'Promo'}</span>}
            {promo && <span className="mono tiny faint strike">{money(item.price)}</span>}
            {!item.available && <span className="tag tag--line">Agotado</span>}
          </div>
          {item.available &&
            (quantity === 0 ? (
              <button className="dish__add" onClick={() => onChange(1)} aria-label={`Agregar ${item.name}`}>
                <Plus size={18} weight="bold" />
              </button>
            ) : (
              <Stepper tone="ink" value={quantity} min={0} max={20} onChange={onChange} label={`Cantidad de ${item.name}`} />
            ))}
        </div>
      </div>
      {item.imageUrl && <img className="dish__img" src={item.imageUrl} alt="" loading="lazy" />}
    </li>
  );
}

function CartSheet({
  open,
  lines,
  total,
  tableNumber,
  cart,
  setCart,
  setQty,
  onClose,
  onSend,
}: {
  open: boolean;
  lines: { item: MenuItemDTO; quantity: number; note: string }[];
  total: number;
  tableNumber: number;
  cart: Cart;
  setCart: (cart: Cart) => void;
  setQty: (id: string, q: number) => void;
  onClose: () => void;
  onSend: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const { run, busy } = useAction();
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={`Mesa ${pad(tableNumber)} · ${plural(count, 'producto', 'productos')}`}
      title="Tu pedido"
      footer={
        <div className="stack stack-2">
          <button
            className="btn btn--accent btn--lg btn--block btn--split"
            disabled={busy || lines.length === 0}
            onClick={() => run(() => onSend(note.trim()), 'Pedido enviado a la cocina')}
          >
            <span>{busy ? 'Enviando…' : 'Enviar a la cocina'}</span>
            <Money cents={total} />
          </button>
          <p className="field__hint" style={{ textAlign: 'center' }}>
            Va directo a la cocina y se suma a la cuenta de la mesa.
          </p>
        </div>
      }
    >
      <div className="stack stack-6">
        <ul className="cart-lines">
          {lines.map(({ item, quantity, note: itemNote }) => (
            <li key={item.id} className="cart-line">
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div className="grow stack stack-1">
                  <strong>{item.name}</strong>
                  <span className="mono tiny faint">
                    {quantity} × {money(priceOf(item))}
                  </span>
                </div>
                <Stepper value={quantity} min={0} max={20} onChange={(q) => setQty(item.id, q)} label={`Cantidad de ${item.name}`} />
              </div>
              {editing === item.id ? (
                <div className="input-icon">
                  <NotePencil size={18} />
                  <input
                    className="input"
                    autoFocus
                    maxLength={140}
                    placeholder="Sin cebolla, bien cocida…"
                    value={itemNote}
                    onChange={(e) => setCart({ ...cart, [item.id]: { quantity, note: e.target.value } })}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                  />
                </div>
              ) : itemNote ? (
                <button className="cart-line__note" onClick={() => setEditing(item.id)}>
                  <NotePencil size={15} />
                  <span className="grow ellipsis">{itemNote}</span>
                  <X
                    size={14}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCart({ ...cart, [item.id]: { quantity, note: '' } });
                    }}
                  />
                </button>
              ) : (
                <button className="text-btn" style={{ justifySelf: 'start' }} onClick={() => setEditing(item.id)}>
                  Agregar aclaración
                </button>
              )}
            </li>
          ))}
        </ul>
        <label className="field">
          <span className="field__label">Algo para la cocina</span>
          <textarea
            className="input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Traer todo junto, somos celíacos…"
          />
        </label>
      </div>
    </Sheet>
  );
}
