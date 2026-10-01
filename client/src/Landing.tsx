import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './lib/api.ts';
import { useDocumentTitle } from './lib/hooks.ts';

interface DemoInfo {
  venueName: string;
  tables: { number: number; label: string; qrToken: string; diners: number }[];
}

export function Landing() {
  useDocumentTitle('Pedido Grupal');
  const [demo, setDemo] = useState<DemoInfo | null>(null);

  useEffect(() => {
    api<DemoInfo>('/api/public/demo').then(setDemo, () => setDemo(null));
  }, []);

  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="row">
          <span style={{ fontSize: '2.2rem' }} aria-hidden="true">
            🍻
          </span>
          <h1>Pedido Grupal</h1>
        </div>
        <p>
          Cada mesa tiene su QR. Los comensales piden desde su celular, ven en vivo la cuenta compartida y, al final,
          cada uno elige qué paga —entero, la mitad o un tercio— o dividen el saldo en partes iguales. Sin calculadoras
          ni discusiones con el mozo.
        </p>
        <div className="row wrap">
          <Link className="btn btn-primary" to="/staff">
            Entrar como mozo / ADMIN
          </Link>
        </div>
      </section>

      {demo && (
        <section className="stack">
          <div className="section-title">
            <h2>Probar como comensal</h2>
            <span className="small muted">{demo.venueName}</span>
          </div>
          <p className="muted small">
            En el local esto se hace escaneando el QR de la mesa. Para probar, abrí una mesa acá (podés abrir la misma mesa
            en varias pestañas o celulares para simular a varios amigos).
          </p>
          <div className="demo-grid">
            {demo.tables.map((t) => (
              <Link key={t.qrToken} className="demo-table" to={`/m/${t.qrToken}`}>
                <strong style={{ fontSize: '1.3rem' }}>Mesa {t.number}</strong>
                <span className="small muted">
                  {t.label || 'Salón'} · {t.diners > 0 ? `${t.diners} en la mesa` : 'libre'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
