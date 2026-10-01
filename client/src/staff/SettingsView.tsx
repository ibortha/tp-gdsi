import { useEffect, useState, type FormEvent } from 'react';
import type { VenueSettings } from '../../../shared/types.ts';
import { QrCode, Spinner, useAction } from '../components/ui.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';

export function SettingsView() {
  useDocumentTitle('Ajustes · Pedido Grupal');
  const { call } = useStaff();
  const { data } = useStaffData<VenueSettings>('/api/admin/venue');
  const [form, setForm] = useState<VenueSettings | null>(null);
  const [tips, setTips] = useState('');
  const { run, busy } = useAction();

  useEffect(() => {
    if (data && !form) {
      setForm(data);
      setTips(data.tipOptions.join(', '));
    }
  }, [data, form]);

  if (!form) return <Spinner />;
  const set = <K extends keyof VenueSettings>(key: K, value: VenueSettings[K]) => setForm({ ...form, [key]: value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const tipOptions = tips
      .split(/[,\s]+/)
      .map((t) => Number(t.replace('%', '')))
      .filter((t) => Number.isInteger(t) && t > 0);
    void run(async () => {
      const saved = await call<VenueSettings>('/api/admin/venue', { method: 'PUT', body: { ...form, tipOptions } });
      setForm(saved);
      setTips(saved.tipOptions.join(', '));
    }, 'Ajustes guardados');
  };

  return (
    <form className="stack-lg" onSubmit={submit} style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Ajustes del local</h1>
          <span className="small muted">La app no procesa pagos: deriva a Mercado Pago, al QR de cobro del local o al Posnet.</span>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <section className="card card-pad stack">
        <h2>Local</h2>
        <label className="field">
          <span>Nombre</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
        </label>
        <label className="field">
          <span>URL pública para los QR de las mesas</span>
          <input
            className="input"
            value={form.publicUrl}
            onChange={(e) => set('publicUrl', e.target.value)}
            placeholder={window.location.origin}
          />
          <span className="tiny faint">Dejalo vacío para usar la dirección con la que entrás al panel (por ejemplo, la IP del local en la red Wi-Fi).</span>
        </label>
      </section>

      <section className="card card-pad stack">
        <h2>Cobros</h2>
        <label className="field">
          <span>Link de Mercado Pago (botón “Abrir Mercado Pago”)</span>
          <input className="input" value={form.mpLink} onChange={(e) => set('mpLink', e.target.value)} placeholder="https://link.mercadopago.com.ar/tulocal" />
        </label>
        <label className="field">
          <span>Alias para transferencias</span>
          <input className="input" value={form.mpAlias} onChange={(e) => set('mpAlias', e.target.value)} placeholder="tulocal.mp" />
        </label>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <label className="field grow" style={{ minWidth: 240 }}>
            <span>Contenido del QR de cobro</span>
            <textarea className="input" value={form.cobroQrData} onChange={(e) => set('cobroQrData', e.target.value)} placeholder="Link o código del QR estático de Mercado Pago" />
            <span className="tiny faint">Es lo que el comensal escanea con su billetera al elegir “QR de cobro”.</span>
          </label>
          {form.cobroQrData && (
            <div style={{ width: 160 }}>
              <QrCode value={form.cobroQrData} label="Vista previa del QR de cobro" />
            </div>
          )}
        </div>
        <div className="row wrap">
          <label className="field" style={{ width: 220 }}>
            <span>Tiempo de reserva (segundos)</span>
            <input
              className="input num"
              type="number"
              min={15}
              max={600}
              value={form.reservationTtlSec}
              onChange={(e) => set('reservationTtlSec', Number(e.target.value))}
            />
          </label>
          <label className="field grow" style={{ minWidth: 200 }}>
            <span>Opciones de propina (%)</span>
            <input className="input" value={tips} onChange={(e) => setTips(e.target.value)} placeholder="10, 15" />
          </label>
        </div>
        <p className="tiny faint">
          Si un comensal reserva algo para pagar y no confirma en ese tiempo, se libera para el resto de la mesa (salvo que haya pedido el
          Posnet, que espera al mozo).
        </p>
      </section>
    </form>
  );
}
