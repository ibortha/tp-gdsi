import { useState, type FormEvent } from 'react';
import type { MenuCategoryDTO, MenuDTO, MenuItemDTO } from '../../../shared/types.ts';
import { Empty, Sheet, Spinner, Switch, useAction, useConfirm } from '../components/ui.tsx';
import { errorMessage } from '../lib/api.ts';
import { centsToPesosInput, money, pesosToCents } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';

/** Achica la foto en el navegador para no subir imágenes de varios MB. */
async function resizeImage(file: File, max = 640): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function MenuAdmin() {
  useDocumentTitle('Menú · Pedido Grupal');
  const { call } = useStaff();
  const { data: menu } = useStaffData<MenuDTO>('/api/public/menu');
  const [editing, setEditing] = useState<MenuItemDTO | 'new' | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  if (!menu) return <Spinner />;

  const categories = menu.categories.slice().sort((a, b) => a.sort - b.sort);

  const toggle = (item: MenuItemDTO, available: boolean) =>
    run(() => call(`/api/admin/items/${item.id}`, { method: 'PATCH', body: { available } }), available ? `${item.name} disponible` : `${item.name} marcado como agotado`);

  const remove = async (item: MenuItemDTO) => {
    if (await confirm({ title: `Eliminar ${item.name}`, message: 'Deja de aparecer en el menú. Los pedidos ya hechos no cambian.', confirmLabel: 'Eliminar', danger: true }))
      await run(() => call(`/api/admin/items/${item.id}`, { method: 'DELETE' }), 'Producto eliminado');
  };

  const move = (category: MenuCategoryDTO, delta: number) => {
    const index = categories.findIndex((c) => c.id === category.id);
    const other = categories[index + delta];
    if (!other) return;
    return run(async () => {
      await call(`/api/admin/categories/${category.id}`, { method: 'PATCH', body: { sort: other.sort } });
      await call(`/api/admin/categories/${other.id}`, { method: 'PATCH', body: { sort: category.sort } });
    });
  };

  const rename = async (category: MenuCategoryDTO) => {
    const name = window.prompt('Nuevo nombre de la categoría', category.name);
    if (name && name.trim() !== category.name)
      await run(() => call(`/api/admin/categories/${category.id}`, { method: 'PATCH', body: { name } }));
  };

  const removeCategory = async (category: MenuCategoryDTO) => {
    if (await confirm({ title: `Eliminar la categoría ${category.name}`, confirmLabel: 'Eliminar', danger: true }))
      await run(() => call(`/api/admin/categories/${category.id}`, { method: 'DELETE' }), 'Categoría eliminada');
  };

  const addCategory = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await call('/api/admin/categories', { body: { name: newCategory } });
      setNewCategory('');
    }, 'Categoría creada');
  };

  return (
    <>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Menú del local</h1>
          <span className="small muted">Es el mismo para todas las mesas. Los cambios se ven al instante en todos los celulares.</span>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={categories.length === 0}>
          + Nuevo producto
        </button>
      </div>

      {categories.map((category, index) => {
        const items = menu.items.filter((i) => i.categoryId === category.id);
        return (
          <section key={category.id} className="stack-sm">
            <div className="row-between">
              <h2>{category.name}</h2>
              <div className="row" style={{ gap: 4 }}>
                <button className="icon-btn" aria-label="Subir categoría" disabled={busy || index === 0} onClick={() => move(category, -1)}>
                  ↑
                </button>
                <button className="icon-btn" aria-label="Bajar categoría" disabled={busy || index === categories.length - 1} onClick={() => move(category, 1)}>
                  ↓
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => rename(category)}>
                  Renombrar
                </button>
                {items.length === 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => removeCategory(category)}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>
            <div className="card list">
              {items.length === 0 && <div className="list-item small muted">Sin productos</div>}
              {items.map((item) => (
                <div key={item.id} className="list-item row wrap" style={{ gap: 12 }}>
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="menu-thumb" style={{ width: 52, height: 52 }} />}
                  <div className="grow" style={{ minWidth: 180 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{item.name}</strong>
                      {item.promoPrice !== null && <span className="badge badge-accent">{item.promoLabel}</span>}
                    </div>
                    <div className="small muted num">
                      {item.promoPrice !== null ? (
                        <>
                          {money(item.promoPrice)} <span className="strike">{money(item.price)}</span>
                        </>
                      ) : (
                        money(item.price)
                      )}
                      {item.description ? ` · ${item.description}` : ''}
                    </div>
                  </div>
                  <Switch checked={item.available} onChange={(v) => toggle(item, v)} label={item.available ? 'Disponible' : 'Agotado'} disabled={busy} />
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(item)}>
                    Editar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(item)}>
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {categories.length === 0 && <Empty emoji="📖" title="Empezá creando una categoría" />}

      <form className="card card-pad row wrap" onSubmit={addCategory}>
        <input
          className="input grow"
          style={{ minWidth: 200 }}
          placeholder="Nueva categoría (ej.: Tragos)"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          maxLength={60}
        />
        <button className="btn btn-secondary" disabled={busy || !newCategory.trim()}>
          Agregar categoría
        </button>
      </form>

      {editing && <ItemForm item={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
    </>
  );
}

function ItemForm({ item, categories, onClose }: { item: MenuItemDTO | null; categories: MenuCategoryDTO[]; onClose: () => void }) {
  const { call } = useStaff();
  const { run, busy } = useAction();
  const [form, setForm] = useState({
    name: item?.name ?? '',
    categoryId: item?.categoryId ?? categories[0]?.id ?? '',
    description: item?.description ?? '',
    price: centsToPesosInput(item?.price ?? null),
    promoPrice: centsToPesosInput(item?.promoPrice ?? null),
    promoLabel: item?.promoLabel ?? '',
    imageUrl: item?.imageUrl ?? '',
    available: item?.available ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const price = pesosToCents(form.price);
    const promoPrice = pesosToCents(form.promoPrice);
    if (price === null) return setError('Ingresá un precio válido.');
    setError(null);
    const body = {
      name: form.name,
      categoryId: form.categoryId,
      description: form.description,
      price,
      promoPrice,
      promoLabel: promoPrice !== null ? form.promoLabel || null : null,
      imageUrl: form.imageUrl || null,
      available: form.available,
    };
    void run(async () => {
      if (item) await call(`/api/admin/items/${item.id}`, { method: 'PATCH', body });
      else await call('/api/admin/items', { body });
      onClose();
    }, item ? 'Producto actualizado' : 'Producto creado');
  };

  return (
    <Sheet
      title={item ? `Editar ${item.name}` : 'Nuevo producto'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="item-form" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      }
    >
      <form id="item-form" className="stack" onSubmit={submit}>
        <label className="field">
          <span>Nombre</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
        </label>
        <label className="field">
          <span>Categoría</span>
          <select className="input" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Descripción / ingredientes</span>
          <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={400} />
        </label>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <label className="field grow">
            <span>Precio ($)</span>
            <input className="input num" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} required placeholder="6200" />
          </label>
          <label className="field grow">
            <span>Precio promo ($, opcional)</span>
            <input className="input num" inputMode="decimal" value={form.promoPrice} onChange={(e) => set('promoPrice', e.target.value)} placeholder="—" />
          </label>
        </div>
        {form.promoPrice && (
          <label className="field">
            <span>Etiqueta de la promo</span>
            <input className="input" value={form.promoLabel} onChange={(e) => set('promoLabel', e.target.value)} maxLength={30} placeholder="Happy hour" />
          </label>
        )}
        <div className="field">
          <span>Foto (opcional)</span>
          <div className="row wrap">
            {form.imageUrl && <img src={form.imageUrl} alt="" className="menu-thumb" />}
            <div className="stack-sm grow">
              <input
                className="input"
                placeholder="https://… o subí una foto"
                value={form.imageUrl.startsWith('data:') ? '(foto subida)' : form.imageUrl}
                onChange={(e) => set('imageUrl', e.target.value)}
                disabled={form.imageUrl.startsWith('data:')}
              />
              <div className="row">
                <label className="btn btn-secondary btn-sm">
                  Subir foto
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        set('imageUrl', await resizeImage(file));
                      } catch (err) {
                        setError(`No se pudo leer la imagen: ${errorMessage(err)}`);
                      }
                    }}
                  />
                </label>
                {form.imageUrl && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('imageUrl', '')}>
                    Quitar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <Switch checked={form.available} onChange={(v) => set('available', v)} label={form.available ? 'Disponible' : 'Agotado'} />
        {error && <div className="form-error">{error}</div>}
      </form>
    </Sheet>
  );
}
