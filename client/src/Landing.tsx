import { ArrowRight, ArrowUpRight, Check, Lock, Users } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { useDocumentTitle } from './lib/hooks.ts';

interface DemoInfo {
  venueName: string;
  tables: { number: number; label: string; qrToken: string; diners: number }[];
}

const pad = (n: number) => String(n).padStart(2, '0');

const STEPS = [
  { n: '01', title: 'Escaneás el QR', text: 'Cada mesa tiene el suyo. Ponés tu nombre y ya estás adentro, sin descargar nada.' },
  { n: '02', title: 'Piden desde el celular', text: 'Los pedidos van directo a la cocina y todos ven la cuenta de la mesa en vivo.' },
  { n: '03', title: 'Cada uno paga lo suyo', text: 'Entero, la mitad o un tercio de cada cosa, o dividen lo que falta en partes iguales.' },
];

/** Ilustración del producto: el ticket compartido, con porciones tomadas por cada uno. */
function HeroReceipt() {
  const rows = [
    { qty: 2, name: 'Pinta IPA', price: '$ 12.400', slices: ['paid', 'paid'], who: 'Fede' },
    { qty: 1, name: 'Papas cheddar', price: '$ 11.500', slices: ['paid', 'mine', 'taken'], who: 'Meli' },
    { qty: 1, name: 'Doble carne', price: '$ 13.900', slices: ['mine'], who: 'Tomi' },
  ];
  return (
    <motion.div
      className="l-receipt receipt-wrap"
      initial={{ opacity: 0, y: 30, rotate: 0 }}
      animate={{ opacity: 1, y: 0, rotate: -3 }}
      transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="receipt">
        <div className="between" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="eyebrow">Cuenta compartida</span>
            <strong className="display" style={{ fontSize: 30 }}>
              Mesa 04
            </strong>
          </div>
          <span className="l-live mono">
            <span className="dot dot--live" /> en vivo
          </span>
        </div>
        <hr className="rule" />
        <ul className="l-receipt__rows">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="between">
                <span>
                  <span className="mono faint">{r.qty}× </span>
                  <strong>{r.name}</strong>
                </span>
                <span className="mono">{r.price}</span>
              </div>
              <div className="l-slices">
                {r.slices.map((s, i) => (
                  <span key={i} className={`l-slice l-slice--${s}`}>
                    {s === 'paid' && <Check size={11} weight="bold" />}
                    {s === 'taken' && <Lock size={11} weight="bold" />}
                    {s === 'mine' && 'vos'}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <hr className="rule" />
        <div className="between" style={{ marginTop: 14 }}>
          <span className="eyebrow">Saldo</span>
          <strong className="display" style={{ fontSize: 34 }}>
            $ 18.825
          </strong>
        </div>
      </div>
    </motion.div>
  );
}

export function Landing() {
  useDocumentTitle('Pedido Grupal — pedir y dividir la cuenta en la mesa');
  const [demo, setDemo] = useState<DemoInfo | null>(null);

  useEffect(() => {
    api<DemoInfo>('/api/public/demo').then(setDemo, () => setDemo(null));
  }, []);

  return (
    <div className="l-page">
      <section className="l-hero">
        <nav className="l-nav">
          <Wordmark size={21} />
          <Link to="/staff" className="btn btn--sm l-nav__cta">
            Panel del local <ArrowUpRight size={16} />
          </Link>
        </nav>
        <div className="l-hero__grid">
          <motion.div
            className="stack stack-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="eyebrow eyebrow--night">Para bares y restaurantes</span>
            <h1 className="display l-title">
              Pidan juntos.
              <br />
              <em>Paguen</em> lo suyo.
            </h1>
            <p className="l-lead">
              Un QR por mesa, la cuenta compartida en vivo y cada comensal elige qué paga — entero, la mitad o un tercio. Sin
              calculadoras, sin el mozo esperando al costado.
            </p>
            <div className="row wrap" style={{ gap: 12 }}>
              <a href="#probar" className="btn btn--accent btn--lg">
                Probar como comensal <ArrowRight size={18} weight="bold" />
              </a>
              <Link to="/staff" className="btn btn--lg l-btn-ghost">
                Entrar al panel
              </Link>
            </div>
          </motion.div>
          <HeroReceipt />
        </div>
      </section>

      <section className="l-steps">
        {STEPS.map((s, i) => (
          <motion.article
            key={s.n}
            className="l-step"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: i * 0.08, duration: 0.6 }}
          >
            <span className="mono l-step__n">{s.n}</span>
            <h2 className="display">{s.title}</h2>
            <p className="muted">{s.text}</p>
          </motion.article>
        ))}
      </section>

      {demo && (
        <section className="l-demo" id="probar">
          <header className="l-demo__head">
            <div className="stack stack-2">
              <span className="eyebrow">{demo.venueName} · demo</span>
              <h2 className="display">Elegí una mesa</h2>
            </div>
            <p className="muted small" style={{ maxWidth: '38ch' }}>
              En el local esto se hace escaneando el QR. Abrí la misma mesa en varias pestañas o celulares para simular a varios amigos.
            </p>
          </header>
          <div className="l-tables">
            {demo.tables.map((t) => (
              <Link key={t.qrToken} className="l-table" to={`/m/${t.qrToken}`}>
                <span className="eyebrow">{t.label || 'Salón'}</span>
                <span className="display l-table__num">{pad(t.number)}</span>
                <span className="l-table__meta">
                  {t.diners > 0 ? (
                    <>
                      <Users size={14} /> {t.diners} en la mesa
                    </>
                  ) : (
                    'Libre'
                  )}
                  <ArrowRight size={14} className="l-table__arrow" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="l-foot">
        <Wordmark size={16} />
        <span className="mono tiny faint">TP GDSI · 2026</span>
      </footer>
    </div>
  );
}
