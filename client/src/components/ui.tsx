import QRCode from 'qrcode';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '../lib/api.ts';

// ---------- Toasts ----------

type ToastKind = 'info' | 'ok' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

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
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Sheet title={state.title} onClose={() => close(false)}>
          <div className="stack">
            {state.message && <div className="muted">{state.message}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => close(false)}>
                {state.cancelLabel ?? 'Cancelar'}
              </button>
              <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
                {state.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------- Hoja inferior / modal ----------

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Piezas chicas ----------

export function Avatar({ name, color, size }: { name: string; color: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`avatar${size ? ` avatar-${size}` : ''}`} style={{ background: color }} title={name} aria-hidden="true">
      {name.trim().charAt(0)}
    </span>
  );
}

export function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  large,
  label,
  disabled,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  large?: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className={`stepper${large ? ' stepper-lg' : ''}`} role="group" aria-label={label}>
      <button className="icon-btn" onClick={() => onChange(value - 1)} disabled={disabled || value <= min} aria-label="Menos">
        −
      </button>
      <span className="stepper-value" aria-live="polite">
        {value}
      </span>
      <button className="icon-btn" onClick={() => onChange(value + 1)} disabled={disabled || value >= max} aria-label="Más">
        +
      </button>
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
      <span className="switch-track" />
      <span>{label}</span>
    </label>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="page-center">
      <div className="stack" style={{ placeItems: 'center' }}>
        <div className="spinner" />
        <span className="muted small">{label}</span>
      </div>
    </div>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji" aria-hidden="true">
        {emoji}
      </div>
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: 480, errorCorrectionLevel: 'M', color: { dark: '#1c1712', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return <div className="qr-box">{src ? <img src={src} alt={label} /> : <div className="spinner" />}</div>;
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copiado', 'ok');
        } catch {
          toast('No se pudo copiar: mantené apretado el texto para copiarlo.', 'error');
        }
      }}
    >
      {label}
    </button>
  );
}
