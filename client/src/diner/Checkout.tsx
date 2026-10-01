import { ArrowLeft, ArrowUpRight, Check, CreditCard, QrCode as QrIcon, Wallet, type Icon } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { PaymentDTO, PaymentMethod } from '../../../shared/types.ts';
import { CopyButton, Money, QrCode, Segmented, useAction } from '../components/ui.tsx';
import { countdown, money } from '../lib/format.ts';
import { useNow } from '../lib/hooks.ts';
import type { DinerSession } from './useDinerSession.ts';

type DinerMethod = Exclude<PaymentMethod, 'CASH'>;

const METHODS: { id: DinerMethod; icon: Icon; title: string; hint: string }[] = [
  { id: 'MERCADO_PAGO', icon: Wallet, title: 'Mercado Pago', hint: 'Transferís desde la app' },
  { id: 'QR', icon: QrIcon, title: 'QR del local', hint: 'Lo escaneás con tu billetera' },
  { id: 'POSNET', icon: CreditCard, title: 'Posnet', hint: 'El mozo te acerca la terminal' },
];

export function Checkout({
  session,
  payment,
  onBack,
  onPaid,
}: {
  session: DinerSession;
  payment: PaymentDTO;
  onBack: () => void;
  onPaid: (paymentId: string) => void;
}) {
  const snapshot = session.snapshot!;
  const venue = session.venue;
  const { run, busy } = useAction();
  const reserved = payment.status === 'RESERVED';
  const now = useNow(250, reserved);
  const [tip, setTip] = useState(payment.tipPercent);
  const method = payment.method as DinerMethod | null;

  const ttl = (venue?.reservationTtlSec ?? 60) * 1000;
  const remaining = payment.expiresAt
    ? Math.min(ttl, Date.parse(payment.expiresAt) - (now + (session.serverNow() - Date.now())))
    : null;
  const tipAmount = Math.round((payment.amount * tip) / 100);
  const toPay = payment.amount + tipAmount;
  const split = snapshot.activeSplit;

  const choose = (next: DinerMethod, nextTip = tip) =>
    run(() => session.act('/api/diner/payment/method', { method: next, tipPercent: nextTip }));
  const confirm = () =>
    run(async () => {
      await session.act(`/api/diner/payments/${payment.id}/confirm`);
      onPaid(payment.id);
    });
  const cancel = () => run(() => session.act(`/api/diner/payments/${payment.id}/cancel`), 'Liberaste tu reserva');

  if (payment.status === 'AWAITING_POSNET') {
    return (
      <main className="d-main">
        <section className="posnet">
          <div className="posnet__pulse" aria-hidden="true">
            <span />
            <span />
            <span />
            <CreditCard size={34} weight="duotone" />
          </div>
          <span className="eyebrow">Posnet pedido</span>
          <h1 className="display posnet__title">
            El mozo <em>ya viene</em>.
          </h1>
          <p className="muted balance">
            Te acerca la terminal para cobrarte <strong className="mono">{money(toPay)}</strong>. Tu parte queda reservada
            hasta que confirme el cobro.
          </p>
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <button className="btn btn--outline" disabled={busy} onClick={() => choose('MERCADO_PAGO')}>
              Pagar de otra forma
            </button>
            <button className="btn btn--ghost" disabled={busy} onClick={cancel}>
              Cancelar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="d-main co">
      <button className="text-btn co__back" onClick={onBack}>
        <ArrowLeft size={16} />
        Cambiar lo que pago
      </button>

      <section className="co-hero">
        <span className="eyebrow">Vas a pagar</span>
        <div className="display co-hero__amount">
          <Money cents={toPay} />
        </div>
        <span className="mono small muted">
          {tipAmount > 0 ? `${money(payment.amount)} + ${money(tipAmount)} de propina` : 'Sin propina'}
        </span>
        {remaining !== null && (
          <div className={clsx('co-timer', remaining < 15000 && 'is-urgent')}>
            <div className="co-timer__track">
              <span style={{ transform: `scaleX(${Math.max(0, remaining / ttl)})` }} />
            </div>
            <span className="mono tiny">Reservado · {countdown(remaining)}</span>
          </div>
        )}
        <details className="co-detail">
          <summary>
            {payment.kind === 'SPLIT'
              ? `${payment.shareIndices.length} de ${split?.parts ?? '?'} partes de la división`
              : `${payment.claims.length} ${payment.claims.length === 1 ? 'porción' : 'porciones'} de la cuenta`}
          </summary>
          <ul>
            {payment.kind === 'SPLIT'
              ? payment.shareIndices.map((i) => (
                  <li key={i}>
                    <span>Parte {i + 1}</span>
                    <span className="mono">{money(split?.shares[i]?.amount ?? 0)}</span>
                  </li>
                ))
              : payment.claims.map((c) => (
                  <li key={`${c.orderItemId}-${c.unitIndex}-${c.portionIndex}`}>
                    <span>{c.label}</span>
                    <span className="mono">{money(c.amount)}</span>
                  </li>
                ))}
          </ul>
        </details>
      </section>

      {(venue?.tipOptions.length ?? 0) > 0 && (
        <section className="stack stack-2">
          <span className="eyebrow">Propina</span>
          <Segmented<string>
            label="Propina"
            value={String(tip)}
            onChange={(v) => {
              const t = Number(v);
              setTip(t);
              if (method) void choose(method, t);
            }}
            options={[0, ...(venue?.tipOptions ?? [])].map((t) => ({ value: String(t), label: t === 0 ? 'Sin propina' : `${t}%` }))}
          />
        </section>
      )}

      <section className="stack stack-2">
        <span className="eyebrow">Cómo pagás</span>
        <div className="methods">
          {METHODS.map(({ id, icon: IconCmp, title, hint }) => (
            <button key={id} className="method" aria-pressed={method === id} disabled={busy} onClick={() => choose(id)}>
              <span className="method__icon">
                <IconCmp size={22} weight={method === id ? 'fill' : 'regular'} />
              </span>
              <span className="grow stack" style={{ gap: 1 }}>
                <strong>{title}</strong>
                <span className="small muted">{hint}</span>
              </span>
              <span className="method__radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <AnimatePresence mode="wait">
        {method === 'MERCADO_PAGO' && (
          <motion.section key="mp" className="card card--pad stack stack-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ol className="steps">
              <li>
                <span className="steps__n mono">01</span>
                <div className="grow stack stack-2">
                  <strong>Abrí Mercado Pago</strong>
                  {venue?.mpLink && (
                    <a className="btn btn--outline btn--sm" style={{ justifySelf: 'start' }} href={venue.mpLink} target="_blank" rel="noopener noreferrer">
                      Abrir la app
                      <ArrowUpRight size={16} />
                    </a>
                  )}
                </div>
              </li>
              <li>
                <span className="steps__n mono">02</span>
                <div className="grow stack stack-2">
                  <strong>Transferí {money(toPay)}</strong>
                  {venue?.mpAlias && (
                    <div className="copy-field">
                      <span className="grow">
                        <span className="eyebrow">Alias</span>
                        <span className="mono ellipsis">{venue.mpAlias}</span>
                      </span>
                      <CopyButton text={venue.mpAlias} />
                    </div>
                  )}
                  <div className="copy-field">
                    <span className="grow">
                      <span className="eyebrow">Monto</span>
                      <span className="mono">{money(toPay)}</span>
                    </span>
                    <CopyButton text={(toPay / 100).toFixed(2).replace('.', ',')} />
                  </div>
                </div>
              </li>
              <li>
                <span className="steps__n mono">03</span>
                <div className="grow">
                  <strong>Volvé y confirmá</strong>
                </div>
              </li>
            </ol>
            <ConfirmButton busy={busy} onConfirm={confirm} />
          </motion.section>
        )}

        {method === 'QR' && (
          <motion.section key="qr" className="card card--pad stack stack-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {venue?.cobroQrData ? (
              <QrCode value={venue.cobroQrData} label="QR de cobro del local" />
            ) : (
              <p className="muted small">El local todavía no cargó su QR. Pedíselo al mozo.</p>
            )}
            <p className="small muted" style={{ textAlign: 'center' }}>
              Escanealo con tu billetera y pagá <strong className="mono">{money(toPay)}</strong>.
            </p>
            <ConfirmButton busy={busy} onConfirm={confirm} />
          </motion.section>
        )}
      </AnimatePresence>

      <button className="text-btn" style={{ justifySelf: 'center' }} disabled={busy} onClick={cancel}>
        Cancelar y liberar mi parte
      </button>
    </main>
  );
}

function ConfirmButton({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  return (
    <div className="stack stack-2">
      <button className="btn btn--accent btn--lg btn--block" disabled={busy} onClick={onConfirm}>
        <Check size={18} weight="bold" />
        Ya pagué
      </button>
      <p className="field__hint" style={{ textAlign: 'center' }}>
        Tu parte figura como pagada para toda la mesa. El mozo puede verificarlo.
      </p>
    </div>
  );
}
