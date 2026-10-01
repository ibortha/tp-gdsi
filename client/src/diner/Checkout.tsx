import { useState } from 'react';
import type { PaymentDTO, PaymentMethod } from '../../../shared/types.ts';
import { CopyButton, QrCode, useAction } from '../components/ui.tsx';
import { countdown, money } from '../lib/format.ts';
import { useNow } from '../lib/hooks.ts';
import type { DinerSession } from './useDinerSession.ts';

type DinerMethod = Exclude<PaymentMethod, 'CASH'>;

const METHODS: { id: DinerMethod; icon: string; title: string; hint: string }[] = [
  { id: 'MERCADO_PAGO', icon: '📱', title: 'Mercado Pago', hint: 'Abrís la app y transferís al local' },
  { id: 'QR', icon: '🔳', title: 'QR de cobro', hint: 'Escaneás el QR del local con tu billetera' },
  { id: 'POSNET', icon: '💳', title: 'Pedir el Posnet', hint: 'El mozo te acerca la terminal (débito o crédito)' },
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
  const now = useNow(250, payment.status === 'RESERVED');
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

  const awaitingPosnet = payment.status === 'AWAITING_POSNET';

  return (
    <main className="diner-main">
      <div className="card card-pad stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="small muted">Vas a pagar</span>
            <span className="hero-amount">{money(toPay)}</span>
            {tipAmount > 0 && (
              <span className="small muted num">
                {money(payment.amount)} + {money(tipAmount)} de propina
              </span>
            )}
          </div>
          {remaining !== null && (
            <span className={`timer${remaining < 15000 ? ' urgent' : ''}`}>⏱ {countdown(remaining)}</span>
          )}
        </div>
        {remaining !== null && (
          <div className={`timer-bar${remaining < 15000 ? ' urgent' : ''}`} aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, (remaining / ttl) * 100))}%` }} />
          </div>
        )}
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            {payment.kind === 'SPLIT'
              ? `${payment.shareIndices.length} de ${split?.parts ?? '?'} partes de la división`
              : `${payment.claims.length} ${payment.claims.length === 1 ? 'porción' : 'porciones'} de la cuenta`}
          </summary>
          <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {payment.kind === 'SPLIT'
              ? payment.shareIndices.map((i) => (
                  <li key={i} className="num">
                    Parte {i + 1} · {money(split?.shares[i]?.amount ?? 0)}
                  </li>
                ))
              : payment.claims.map((c) => (
                  <li key={`${c.orderItemId}-${c.unitIndex}-${c.portionIndex}`} className="num">
                    {c.label} · {money(c.amount)}
                  </li>
                ))}
          </ul>
        </details>
        {!awaitingPosnet && (
          <p className="tiny faint">
            Tu parte queda reservada mientras pagás. Si en {venue?.reservationTtlSec ?? 60} segundos no confirmás, se libera
            para el resto de la mesa.
          </p>
        )}
      </div>

      {awaitingPosnet ? (
        <div className="card card-pad stack" style={{ textAlign: 'center' }}>
          <div className="hero-emoji" aria-hidden="true">
            🔔
          </div>
          <h2>Le avisamos al mozo</h2>
          <p className="muted">
            En un momento se acerca con el Posnet para cobrarte <strong className="num">{money(toPay)}</strong>. Tu parte
            queda reservada mientras tanto; cuando el mozo confirme el cobro, figura como abonada.
          </p>
          <div className="spinner" style={{ margin: '0 auto' }} aria-label="Esperando al mozo" />
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => choose('MERCADO_PAGO')}>
              Mejor pago de otra forma
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          {(venue?.tipOptions.length ?? 0) > 0 && (
            <div className="stack-sm">
              <h3>¿Dejás propina?</h3>
              <div className="chips">
                {[0, ...(venue?.tipOptions ?? [])].map((t) => (
                  <button
                    key={t}
                    className="chip"
                    aria-pressed={tip === t}
                    onClick={() => {
                      setTip(t);
                      if (method) void choose(method, t);
                    }}
                  >
                    {t === 0 ? 'Sin propina' : `${t}% · ${money(Math.round((payment.amount * t) / 100))}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="stack-sm">
            <h3>¿Cómo pagás?</h3>
            {METHODS.map((m) => (
              <button key={m.id} className="method" aria-pressed={method === m.id} disabled={busy} onClick={() => choose(m.id)}>
                <span className="method-icon" aria-hidden="true">
                  {m.icon}
                </span>
                <span className="grow">
                  <strong>{m.title}</strong>
                  <br />
                  <span className="small muted">{m.hint}</span>
                </span>
              </button>
            ))}
          </div>

          {method === 'MERCADO_PAGO' && (
            <div className="card card-pad stack">
              <h3>Pagá con Mercado Pago</h3>
              {venue?.mpLink && (
                <a className="btn btn-secondary btn-block" href={venue.mpLink} target="_blank" rel="noopener noreferrer">
                  1. Abrir Mercado Pago ↗
                </a>
              )}
              {venue?.mpAlias && (
                <div className="copy-row">
                  <span className="grow">
                    <span className="tiny muted">2. Transferí al alias</span>
                    <br />
                    <strong className="ellipsis">{venue.mpAlias}</strong>
                  </span>
                  <CopyButton text={venue.mpAlias} />
                </div>
              )}
              <div className="copy-row">
                <span className="grow">
                  <span className="tiny muted">Monto exacto</span>
                  <br />
                  <strong className="num">{money(toPay)}</strong>
                </span>
                <CopyButton text={(toPay / 100).toFixed(2).replace('.', ',')} />
              </div>
              <ConfirmButton busy={busy} onConfirm={confirm} />
            </div>
          )}

          {method === 'QR' && (
            <div className="card card-pad stack">
              <h3>Escaneá el QR del local</h3>
              {venue?.cobroQrData ? (
                <QrCode value={venue.cobroQrData} label="QR de cobro del local" />
              ) : (
                <p className="muted small">El local todavía no cargó su QR de cobro. Pedile al mozo que te lo muestre.</p>
              )}
              <p className="small muted center">
                Pagá <strong className="num">{money(toPay)}</strong> desde Mercado Pago u otra billetera.
              </p>
              <ConfirmButton busy={busy} onConfirm={confirm} />
            </div>
          )}

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              ← Cambiar lo que pago
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>
              Cancelar y liberar
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function ConfirmButton({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  return (
    <div className="stack-sm">
      <button className="btn btn-ok btn-lg btn-block" disabled={busy} onClick={onConfirm}>
        ✓ Ya pagué
      </button>
      <p className="tiny faint center">Al confirmar, tu parte figura como abonada para toda la mesa. El mozo puede verificar la transferencia.</p>
    </div>
  );
}
