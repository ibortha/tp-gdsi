import { useEffect, useState, type FormEvent } from 'react';
import type { VenueSettings } from '../../../shared/types.ts';
import { Loader, QrCode, useAction } from '../components/ui.tsx';
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

  if (!form) return <Loader />;
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
    <form onSubmit={submit} className="stack stack-8">
      <header className="s-head">
        <div className="stack stack-2">
          <span className="eyebrow">Local</span>
          <h1 className="display s-title">Ajustes</h1>
        </div>
        <button className="btn btn--ink" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </header>

      <section className="settings">
        <div className="settings__intro">
          <h2>El local</h2>
          <p className="small muted">Cómo aparece en los celulares y adónde apuntan los QR de las mesas.</p>
        </div>
        <div className="settings__fields panel panel--pad stack stack-4">
          <label className="field">
            <span className="field__label">Nombre</span>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
          </label>
          <label className="field">
            <span className="field__label">Dirección pública para los QR</span>
            <input className="input mono" value={form.publicUrl} onChange={(e) => set('publicUrl', e.target.value)} placeholder={window.location.origin} />
            <span className="field__hint">Vacío: se usa la dirección con la que entrás al panel (por ejemplo, la IP del local en el Wi-Fi).</span>
          </label>
        </div>
      </section>

      <section className="settings">
        <div className="settings__intro">
          <h2>Cobros</h2>
          <p className="small muted">La app no procesa pagos: deriva a Mercado Pago, al QR del local o al Posnet.</p>
        </div>
        <div className="settings__fields panel panel--pad stack stack-4">
          <label className="field">
            <span className="field__label">Link de Mercado Pago</span>
            <input className="input mono" value={form.mpLink} onChange={(e) => set('mpLink', e.target.value)} placeholder="https://link.mercadopago.com.ar/tulocal" />
          </label>
          <label className="field">
            <span className="field__label">Alias para transferencias</span>
            <input className="input mono" value={form.mpAlias} onChange={(e) => set('mpAlias', e.target.value)} placeholder="tulocal.mp" />
          </label>
          <div className="qr-setting">
            <label className="field grow">
              <span className="field__label">Contenido del QR de cobro</span>
              <textarea className="input mono" value={form.cobroQrData} onChange={(e) => set('cobroQrData', e.target.value)} placeholder="Link o código del QR estático de Mercado Pago" />
              <span className="field__hint">Es lo que el comensal escanea al elegir “QR del local”.</span>
            </label>
            {form.cobroQrData && <QrCode value={form.cobroQrData} label="Vista previa del QR de cobro" className="qr-setting__preview" />}
          </div>
        </div>
      </section>

      <section className="settings">
        <div className="settings__intro">
          <h2>Reglas de pago</h2>
          <p className="small muted">Lo que alguien reserva para pagar se libera si no confirma a tiempo (salvo que haya pedido el Posnet).</p>
        </div>
        <div className="settings__fields panel panel--pad form-grid">
          <label className="field">
            <span className="field__label">Tiempo de reserva</span>
            <div className="input-affix input-affix--end">
              <input
                className="input mono"
                type="number"
                min={15}
                max={600}
                value={form.reservationTtlSec}
                onChange={(e) => set('reservationTtlSec', Number(e.target.value))}
              />
              <span>seg</span>
            </div>
          </label>
          <label className="field">
            <span className="field__label">Opciones de propina</span>
            <div className="input-affix input-affix--end">
              <input className="input mono" value={tips} onChange={(e) => setTips(e.target.value)} placeholder="10, 15" />
              <span>%</span>
            </div>
          </label>
        </div>
      </section>
    </form>
  );
}
