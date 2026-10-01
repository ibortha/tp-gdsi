import { ArrowDown, ArrowUp, BookOpenText, ImageSquare, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import type { MenuCategoryDTO, MenuDTO, MenuItemDTO } from '../../../shared/types.ts';
import { Empty, Loader, Sheet, Switch, useAction, useConfirm } from '../components/ui.tsx';
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
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function MenuAdmin() {
  useDocumentTitle('Carta · Pedido Grupal');
  const { call } = useStaff();
  const { data: menu } = useStaffData<MenuDTO>('/api/public/menu');
  // El formulario se monta de nuevo en cada apertura, pero se mantiene durante la animación de cierre.
  const [sheet, setSheet] = useState<{ open: boolean; item: MenuItemDTO | null; key: number }>({ open: false, item: null, key: 0 });
  const openForm = (item: MenuItemDTO | null) => setSheet((s) => ({ open: true, item, key: s.key + 1 }));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  if (!menu) return <Loader />;

  const categories = menu.categories.slice().sort((a, b) => a.sort - b.sort);
  const total = menu.items.length;
  const out = menu.items.filter((i) => !i.available).length;

  const toggle = (item: MenuItemDTO, available: boolean) =>
    run(() => call(`/api/admin/items/${item.id}`, { method: 'PATCH', body: { available } }), available ? `${item.name} disponible` : `${item.name} agotado`);

  const remove = async (item: MenuItemDTO) => {
    if (await confirm({ title: `Eliminar ${item.name}`, message: 'Deja de aparecer en la carta. Los pedidos ya hechos no cambian.', confirmLabel: 'Eliminar', danger: true }))
      await run(() => call(`/api/admin/items/${item.id}`, { method: 'DELETE' }), 'Producto eliminado');
  };

  const move = (category: MenuCategoryDTO, delta: number) => {
    const index = categories.findIndex((c) => c.id === category.id);
    const other = categories[index + delta];
    if (!other) return;
    void run(async () => {
      await call(`/api/admin/categories/${category.id}`, { method: 'PATCH', body: { sort: other.sort } });
      await call(`/api/admin/categories/${other.id}`, { method: 'PATCH', body: { sort: category.sort } });
    });
  };

  const rename = (category: MenuCategoryDTO, name: string) => {
    setRenaming(null);
    if (name.trim() && name.trim() !== category.name)
      void run(() => call(`/api/admin/categories/${category.id}`, { method: 'PATCH', body: { name } }));
  };

  const removeCategory = async (category: MenuCategoryDTO) => {
    if (await confirm({ title: `Eliminar “${category.name}”`, confirmLabel: 'Eliminar', danger: true }))
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
      <header className="s-head">
        <div className="stack stack-2">
          <span className="eyebrow">
            {total} productos{out > 0 ? ` · ${out} agotados` : ''}
          </span>
          <h1 className="display s-title">Carta</h1>
          <p className="small muted">La misma para todas las mesas. Los cambios llegan al instante a los celulares.</p>
        </div>
        <button className="btn btn--ink" onClick={() => openForm(null)} disabled={categories.length === 0}>
          <Plus size={18} weight="bold" /> Nuevo producto
        </button>
      </header>

      {categories.length === 0 && <Empty icon={<BookOpenText size={24} />} title="Empezá con una categoría" />}

      {categories.map((category, index) => {
        const items = menu.items.filter((i) => i.categoryId === category.id);
        return (
          <section key={category.id} className="panel">
            <header className="panel__head">
              {renaming === category.id ? (
                <input
                  className="input"
                  style={{ maxWidth: 320, height: 40 }}
                  defaultValue={category.name}
                  autoFocus
                  onBlur={(e) => rename(category, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(category, e.currentTarget.value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <h2 className="display" style={{ fontSize: 30 }}>
                  {category.name}
                </h2>
              )}
              <div className="row" style={{ gap: 2 }}>
                <button className="btn btn--ghost btn--icon btn--sm" title="Subir" aria-label="Subir categoría" disabled={busy || index === 0} onClick={() => move(category, -1)}>
                  <ArrowUp size={16} />
                </button>
                <button className="btn btn--ghost btn--icon btn--sm" title="Bajar" aria-label="Bajar categoría" disabled={busy || index === categories.length - 1} onClick={() => move(category, 1)}>
                  <ArrowDown size={16} />
                </button>
                <button className="btn btn--ghost btn--icon btn--sm" title="Renombrar" aria-label="Renombrar categoría" onClick={() => setRenaming(category.id)}>
                  <PencilSimple size={16} />
                </button>
                {items.length === 0 && (
                  <button className="btn btn--ghost btn--icon btn--sm" title="Eliminar" aria-label="Eliminar categoría" onClick={() => removeCategory(category)}>
                    <Trash size={16} />
                  </button>
                )}
              </div>
            </header>
            <ul className="admin-list">
              {items.length === 0 && <li className="admin-row small muted">Sin productos</li>}
              {items.map((item) => (
                <li key={item.id} className="admin-row">
                  <span className="admin-row__thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <ImageSquare size={20} />}</span>
                  <div className="grow stack" style={{ gap: 2, minWidth: 180 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{item.name}</strong>
                      {item.promoPrice !== null && <span className="tag tag--accent">{item.promoLabel}</span>}
                    </div>
                    {item.description && <span className="small muted ellipsis">{item.description}</span>}
                  </div>
                  <span className="admin-row__price mono">
                    {item.promoPrice !== null ? (
                      <>
                        {money(item.promoPrice)}
                        <span className="strike faint tiny">{money(item.price)}</span>
                      </>
                    ) : (
                      money(item.price)
                    )}
                  </span>
                  <Switch checked={item.available} onChange={(v) => toggle(item, v)} label={item.available ? 'Disponible' : 'Agotado'} disabled={busy} />
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn btn--ghost btn--icon btn--sm" onClick={() => openForm(item)} aria-label={`Editar ${item.name}`} title="Editar">
                      <PencilSimple size={16} />
                    </button>
                    <button className="btn btn--ghost btn--icon btn--sm" onClick={() => remove(item)} aria-label={`Eliminar ${item.name}`} title="Eliminar">
                      <Trash size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <form className="inline-form" onSubmit={addCategory}>
        <input className="input" placeholder="Nueva categoría — por ejemplo, Tragos" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={60} />
        <button className="btn btn--outline" disabled={busy || !newCategory.trim()}>
          <Plus size={16} /> Agregar categoría
        </button>
      </form>

      <ItemForm key={sheet.key} item={sheet.item} open={sheet.open} categories={categories} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </>
  );
}

function ItemForm({ item, open, categories, onClose }: { item: MenuItemDTO | null; open: boolean; categories: MenuCategoryDTO[]; onClose: () => void }) {
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

  const uploaded = form.imageUrl.startsWith('data:');

  return (
    <Sheet
      side="right"
      open={open}
      onClose={onClose}
      eyebrow={item ? 'Editar producto' : 'Nuevo producto'}
      title={item ? item.name : 'Producto nuevo'}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--ink" form="item-form" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <form id="item-form" className="stack stack-4" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Nombre</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
        </label>
        <label className="field">
          <span className="field__label">Categoría</span>
          <select className="input" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Descripción e ingredientes</span>
          <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={400} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Precio</span>
            <div className="input-affix">
              <span>$</span>
              <input className="input mono" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} required placeholder="6200" />
            </div>
          </label>
          <label className="field">
            <span className="field__label">Precio promo</span>
            <div className="input-affix">
              <span>$</span>
              <input className="input mono" inputMode="decimal" value={form.promoPrice} onChange={(e) => set('promoPrice', e.target.value)} placeholder="Opcional" />
            </div>
          </label>
        </div>
        {form.promoPrice && (
          <label className="field">
            <span className="field__label">Etiqueta de la promo</span>
            <input className="input" value={form.promoLabel} onChange={(e) => set('promoLabel', e.target.value)} maxLength={30} placeholder="Happy hour" />
          </label>
        )}
        <div className="field">
          <span className="field__label">Foto</span>
          <div className="photo-field">
            <span className="photo-field__preview">{form.imageUrl ? <img src={form.imageUrl} alt="" /> : <ImageSquare size={28} />}</span>
            <div className="grow stack stack-2">
              <input
                className="input"
                placeholder="https://…"
                value={uploaded ? 'Foto subida desde este equipo' : form.imageUrl}
                onChange={(e) => set('imageUrl', e.target.value)}
                disabled={uploaded}
              />
              <div className="row">
                <label className="btn btn--outline btn--sm">
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
                  <button type="button" className="text-btn" onClick={() => set('imageUrl', '')}>
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
