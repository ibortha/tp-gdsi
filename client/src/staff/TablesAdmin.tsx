import { useState, type FormEvent } from 'react';
import type { TableSummaryDTO, VenueSettings } from '../../../shared/types.ts';
import { CopyButton, QrCode, Spinner, Switch, useAction, useConfirm } from '../components/ui.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';

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
  if (!tables || !venue) return <Spinner />;

  const base = venue.publicUrl || window.location.origin;
  const urlOf = (t: TableSummaryDTO) => `${base}/m/${t.qrToken}`;
  const suggested = tables.reduce((m, t) => Math.max(m, t.number), 0) + 1;

  const print = (tableId: string | null) => {
    setPrintOnly(tableId);
    window.setTimeout(() => window.print(), 50);
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
      title: `Regenerar el QR de la mesa ${t.number}`,
      message: 'El QR impreso actual deja de funcionar: vas a tener que imprimir y pegar el nuevo.',
      confirmLabel: 'Regenerar',
      danger: true,
    });
    if (ok) await run(() => call(`/api/admin/tables/${t.id}/regenerate-qr`, { method: 'POST' }), 'QR regenerado');
  };

  const remove = async (t: TableSummaryDTO) => {
    if (await confirm({ title: `Eliminar la mesa ${t.number}`, confirmLabel: 'Eliminar', danger: true }))
      await run(() => call(`/api/admin/tables/${t.id}`, { method: 'DELETE' }), 'Mesa eliminada');
  };

  return (
    <>
      <div className="page-head no-print">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Mesas y QR</h1>
          <span className="small muted">
            Cada mesa tiene su propio QR. Todas comparten el mismo menú. Los QR apuntan a <strong>{base}</strong>
            {venue.publicUrl ? '' : ' (podés cambiarlo en Ajustes)'}.
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => print(null)}>
          🖨️ Imprimir todos
        </button>
      </div>

      <form className="card card-pad row wrap no-print" onSubmit={add}>
        <label className="field" style={{ width: 120 }}>
          <span>Número</span>
          <input className="input num" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} placeholder={String(suggested)} />
        </label>
        <label className="field grow" style={{ minWidth: 160 }}>
          <span>Sector (opcional)</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Salón, Patio, Barra…" maxLength={40} />
        </label>
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-end' }} disabled={busy}>
          + Agregar mesa
        </button>
      </form>

      <div className="qr-cards">
        {tables.map((t) => (
          <article key={t.id} className={`card qr-card${printOnly && printOnly !== t.id ? ' not-selected' : ''}`}>
            <div className="row-between">
              <h2>Mesa {t.number}</h2>
              {t.label && <span className="badge">{t.label}</span>}
            </div>
            <QrCode value={urlOf(t)} label={`QR de la mesa ${t.number}`} />
            <p className="print-only" style={{ fontWeight: 700 }}>
              Escaneá para pedir y dividir la cuenta · {venue.name}
            </p>
            <div className="no-print stack-sm">
              <div className="copy-row">
                <span className="tiny ellipsis grow">{urlOf(t)}</span>
                <CopyButton text={urlOf(t)} />
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <a className="btn btn-secondary btn-sm" href={`/m/${t.qrToken}`} target="_blank" rel="noreferrer">
                  Abrir ↗
                </a>
                <button className="btn btn-secondary btn-sm" onClick={() => print(t.id)}>
                  Imprimir
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => regenerate(t)}>
                  Regenerar
                </button>
                {!t.session && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(t)}>
                    Eliminar
                  </button>
                )}
              </div>
              <Switch
                checked={t.active}
                disabled={busy}
                label={t.active ? 'Habilitada' : 'Deshabilitada'}
                onChange={(active) => run(() => call(`/api/admin/tables/${t.id}`, { method: 'PATCH', body: { active } }))}
              />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
