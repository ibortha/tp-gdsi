import NumberFlow from '@number-flow/react';
import { CheckCircle, Copy, WarningCircle, X } from '@phosphor-icons/react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Toaster, toast as sonner } from 'sonner';
import { Drawer } from 'vaul';
import { errorMessage } from '../lib/api.ts';

// ---------- Toasts ----------

type ToastKind = 'info' | 'ok' | 'error';

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      offset={14}
      gap={8}
      icons={{ success: <CheckCircle size={20} weight="fill" />, error: <WarningCircle size={20} weight="fill" /> }}
      toastOptions={{ unstyled: true, classNames: { toast: 'toast', success: 'toast--ok', error: 'toast--error' } }}
    />
  );
}

export function useToast() {
  return useCallback((text: string, kind: ToastKind = 'info') => {
    if (kind === 'ok') sonner.success(text, { duration: 2600 });
    else if (kind === 'error') sonner.error(text, { duration: 5000 });
    else sonner(text, { duration: 3200 });
  }, []);
}

/** Ejecuta una acción async mostrando el error como toast; devuelve true si salió bien. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        if (success) toast(success, 'ok');
        return true;
      } catch (error) {
        toast(errorMessage(error), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---------- Confirmación ----------

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state && (
          <div className="dialog-layer" key="confirm">
            <motion.div
              className="dialog-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => close(false)}
            />
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-label={state.title}
              className="dialog stack stack-4"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <h2 className="dialog__title">{state.title}</h2>
              {state.message && <div className="muted">{state.message}</div>}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn btn--ghost" onClick={() => close(false)}>
                  {state.cancelLabel ?? 'Cancelar'}
                </button>
                <button className={clsx('btn', state.danger ? 'btn--accent' : 'btn--ink')} onClick={() => close(true)} autoFocus>
                  {state.confirmLabel ?? 'Confirmar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------- Hoja inferior (celular) / panel lateral (panel del local) ----------

export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  side = 'bottom',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'bottom' | 'right';
}) {
  return (
    <Drawer.Root open={open} onOpenChange={(next) => !next && onClose()} direction={side} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-overlay" />
        <Drawer.Content
          className={clsx('sheet', `sheet--${side}`)}
          aria-describedby={undefined}
          style={side === 'right' ? ({ '--initial-transform': 'calc(100% + 10px)' } as React.CSSProperties) : undefined}
        >
          {side === 'bottom' && <div className="sheet__handle" aria-hidden="true" />}
          <div className="sheet__head">
            <div className="stack stack-2">
              {eyebrow && <span className="eyebrow">{eyebrow}</span>}
              <Drawer.Title className="sheet__title">{title}</Drawer.Title>
            </div>
            <button className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Cerrar">
              <X size={20} />
            </button>
          </div>
          <div className="sheet__body">{children}</div>
          {footer && <div className="sheet__foot">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ---------- Montos ----------

/** Monto en pesos que anima sus dígitos cuando cambia (la cuenta se actualiza en vivo). */
export function Money({ cents, className }: { cents: number; className?: string }) {
  const decimals = cents % 100 === 0 ? 0 : 2;
  return (
    <NumberFlow
      className={clsx('num', className)}
      value={cents / 100}
      locales="es-AR"
      format={{ style: 'currency', currency: 'ARS', minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
    />
  );
}

// ---------- Piezas chicas ----------

export function Avatar({ name, tone, size }: { name: string; tone: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={clsx('avatar', size && `avatar--${size}`)} style={{ background: tone }} title={name} aria-hidden="true">
      {name.trim().charAt(0)}
    </span>
  );
}

export function AvatarStack({ people, max = 4 }: { people: { id: string; name: string; tone: string }[]; max?: number }) {
  return (
    <div className="avatars" aria-label={`En la mesa: ${people.map((p) => p.name).join(', ')}`}>
      <AnimatePresence initial={false}>
        {people.slice(0, max).map((p) => (
          <motion.span key={p.id} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
            <Avatar name={p.name} tone={p.tone} />
          </motion.span>
        ))}
      </AnimatePresence>
      {people.length > max && <span className="avatars__more">+{people.length - max}</span>}
    </div>
  );
}

export function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  label,
  disabled,
  tone,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
  tone?: 'ink';
}) {
  return (
    <div className={clsx('stepper', tone && `stepper--${tone}`)} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={disabled || value <= min} aria-label="Menos">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <span className="stepper__value" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={disabled || value >= max} aria-label="Más">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function BigStepper({
  value,
  min,
  max,
  onChange,
  label,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  unit: string;
}) {
  return (
    <div className="big-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Menos">
        <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <div className="big-stepper__value">
        <strong aria-live="polite">
          <NumberFlow value={value} />
        </strong>
        <span className="eyebrow">{unit}</span>
      </div>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Más">
        <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  const id = useId();
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="seg__thumb" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />
          )}
          <span className="seg__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="switch__track" />
      <span>{label}</span>
    </label>
  );
}

export function Loader({ label = 'Cargando' }: { label?: string }) {
  return (
    <div className="loader" role="status">
      <div className="loader__bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn--outline btn--sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copiado', 'ok');
        } catch {
          toast('No se pudo copiar: mantené apretado el texto.', 'error');
        }
      }}
    >
      <Copy size={16} />
      {label}
    </button>
  );
}

// ---------- QR dibujado a medida (módulos redondeados) ----------

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, cells } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const isFinder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    const list: [number, number][] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (qr.modules.data[y * n + x] && !isFinder(x, y)) list.push([x, y]);
    return { size: n, cells: list };
  }, [value]);
  const m = 2; // margen en módulos
  const finders = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  return (
    <div className={clsx('qr', className)}>
      <svg viewBox={`${-m} ${-m} ${size + m * 2} ${size + m * 2}`} role="img" aria-label={label}>
        {cells.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.43} fill="currentColor" />
        ))}
        {finders.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect x={x! + 0.5} y={y! + 0.5} width={6} height={6} rx={1.9} fill="none" stroke="currentColor" strokeWidth={1} />
            <rect x={x! + 2} y={y! + 2} width={3} height={3} rx={0.9} fill="currentColor" />
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------- Anillo de cuenta regresiva ----------

export function CountdownRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return (
    <div className={clsx('ring', seconds <= 15 && 'ring--urgent')} role="timer" aria-label={`Quedan ${seconds} segundos de reserva`}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="ring__track" cx="22" cy="22" r={r} />
        <circle className="ring__value" cx="22" cy="22" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} />
      </svg>
      <span className="ring__text">{seconds}</span>
    </div>
  );
}

// ---------- Donut de la división ----------

export function Donut({
  segments,
  size = 168,
  children,
}: {
  segments: { key: string; color: string; pattern?: 'hatch' }[];
  size?: number;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const n = Math.max(segments.length, 1);
  const gap = n > 1 ? 3 : 0;
  const len = c / n - gap;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <defs>
          <pattern id={`hatch-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--paper-2)" />
            <rect width="3" height="6" fill="var(--paper-3)" />
          </pattern>
        </defs>
        {segments.map((s, i) => (
          <motion.circle
            key={s.key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.pattern ? `url(#hatch-${id})` : s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-(i * (len + gap))}
            initial={false}
            animate={{ stroke: s.pattern ? `url(#hatch-${id})` : s.color }}
          />
        ))}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

// ---------- Marca ----------

/** Isotipo: un círculo dividido en tercios, con una porción tomada. */
export function LogoMark({ size = 28, tone = 'currentColor' }: { size?: number; tone?: string }) {
  const cx = 16;
  const cy = 16;
  const r = 13;
  const wedge = (a0: number, a1: number, dx = 0, dy = 0) => {
    const p = (a: number) => [cx + dx + r * Math.cos((a * Math.PI) / 180), cy + dy + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${cx + dx} ${cy + dy} L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d={wedge(-90 + 3, 30 - 3)} fill={tone} />
      <path d={wedge(150 + 3, 270 - 3)} fill={tone} />
      <path d={wedge(30 + 3, 150 - 3, 0.9, 1.6)} fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <LogoMark size={Math.round(size * 1.15)} />
      <span>
        pedido <em>grupal</em>
      </span>
    </span>
  );
}
