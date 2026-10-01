import { ArrowClockwise, ArrowUpRight, Plus, Printer, Trash } from '@phosphor-icons/react';
import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import type { TableSummaryDTO, VenueSettings } from '../../../shared/types.ts';
import { CopyButton, Loader, LogoMark, QrCode, Switch, useAction, useConfirm } from '../components/ui.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { appHref, tableUrl } from '../lib/links.ts';
import { useStaff, useStaffData } from './context.tsx';
import { pad2 } from './TablesView.tsx';

/** Hablador de mesa: lo que se imprime y se apoya en cada mesa. */
export function TableTent({ number, url, venueName, label }: { number: number; url: string; venueName: string; label: string }) {
  return (
    <div className="tent">
      <div className="tent__top">
        <LogoMark size={22} />
        <span className="eyebrow">{label || 'Salón'}</span>
      </div>
      <div className="tent__title display">
        Mesa <em>{pad2(number)}</em>
      </div>
      <QrCode value={url} label={`QR de la mesa ${number}`} className="tent__qr" />
      <p className="tent__copy">Escaneá, pedí desde tu celular y dividan la cuenta.</p>
      <span className="tent__venue mono">{venueName}</span>
    </div>
  );
}

export function TablesAdmin() {
  useDocumentTitle('Mesas y QR · Pedido Grupal');
  const { call } = useStaff();
  const { data: tables } = useStaffData<TableSummaryDTO[]>('/api/staff/tables');
  const { data: venue } = useStaffData<VenueSettings>('/api/admin/venue');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [printOnly, setPrintOnly] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [label, setLabel] = useState('');
  if (!tables || !venue) return <Loader />;

  const base = tableUrl(venue.publicUrl, '').replace(/\/(#\/)?m\/$/, '');
  const urlOf = (t: TableSummaryDTO) => tableUrl(venue.publicUrl, t.qrToken);
  const suggested = tables.reduce((m, t) => Math.max(m, t.number), 0) + 1;

  const print = (tableId: string | null) => {
    setPrintOnly(tableId);
    window.setTimeout(() => window.print(), 60);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await call('/api/admin/tables', { body: { number: Number(number || suggested), label } });
      setNumber('');
      setLabel('');
    }, 'Mesa creada');
  };

  const regenerate = async (t: TableSummaryDTO) => {
    const ok = await confirm({
      title: `Nuevo QR para la mesa ${pad2(t.number)}`,
      message: 'El QR impreso actual deja de funcionar: vas a tener que imprimir el nuevo.',
      confirmLabel: 'Generar nuevo QR',
      danger: true,
    });
    if (ok) await run(() => call(`/api/admin/tables/${t.id}/regenerate-qr`, { method: 'POST' }), 'QR regenerado');
  };

  const remove = async (t: TableSummaryDTO) => {
    if (await confirm({ title: `Eliminar la mesa ${pad2(t.number)}`, confirmLabel: 'Eliminar', danger: true }))
      await run(() => call(`/api/admin/tables/${t.id}`, { method: 'DELETE' }), 'Mesa eliminada');
  };

  return (
    <>
      <header className="s-head no-print">
        <div className="stack stack-2">
          <span className="eyebrow">{tables.length} mesas · un QR por mesa</span>
          <h1 className="display s-title">Mesas y QR</h1>
          <p className="small muted">
            Los QR apuntan a <span className="mono">{base}</span>
            {venue.publicUrl ? '' : ' — se puede cambiar en Ajustes'}.
          </p>
        </div>
        <button className="btn btn--ink" onClick={() => print(null)}>
          <Printer size={18} /> Imprimir todos
        </button>
      </header>

      <form className="inline-form no-print" onSubmit={add}>
        <input
          className="input mono"
          style={{ flex: 'none', width: 120 }}
          inputMode="numeric"
          aria-label="Número de mesa"
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
          placeholder={`N.º ${suggested}`}
        />
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sector — Salón, Patio, 2do piso…" maxLength={40} aria-label="Sector" />
        <button className="btn btn--outline" disabled={busy}>
          <Plus size={16} /> Agregar mesa
        </button>
      </form>

      <div className="tents">
        {tables.map((t) => (
          <article key={t.id} className={clsx('tent-card', printOnly && printOnly !== t.id && 'not-printed', !t.active && 'is-off')}>
            <TableTent number={t.number} url={urlOf(t)} venueName={venue.name} label={t.label} />
            <div className="tent-card__tools no-print">
              <div className="copy-field">
                <span className="grow mono tiny ellipsis">{urlOf(t).replace(/^https?:\/\//, '')}</span>
                <CopyButton text={urlOf(t)} />
              </div>
              <div className="between">
                <Switch
                  checked={t.active}
                  disabled={busy}
                  label={t.active ? 'Habilitada' : 'Deshabilitada'}
                  onChange={(active) => run(() => call(`/api/admin/tables/${t.id}`, { method: 'PATCH', body: { active } }))}
                />
                <div className="row" style={{ gap: 2 }}>
                  <a className="btn btn--ghost btn--icon btn--sm" href={appHref(`/m/${t.qrToken}`)} target="_blank" rel="noreferrer" title="Abrir como comensal" aria-label="Abrir como comensal">
                    <ArrowUpRight size={16} />
                  </a>
                  <button className="btn btn--ghost btn--icon btn--sm" onClick={() => print(t.id)} title="Imprimir" aria-label="Imprimir">
                    <Printer size={16} />
                  </button>
                  <button className="btn btn--ghost btn--icon btn--sm" disabled={busy} onClick={() => regenerate(t)} title="Regenerar QR" aria-label="Regenerar QR">
                    <ArrowClockwise size={16} />
                  </button>
                  {!t.session && (
                    <button className="btn btn--ghost btn--icon btn--sm" disabled={busy} onClick={() => remove(t)} title="Eliminar" aria-label="Eliminar mesa">
                      <Trash size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
