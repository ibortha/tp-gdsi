import type { Cents, Denominator, ItemStatus, PaymentMethod, PaymentStatus } from '../../../shared/types.ts';

const arsWhole = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const arsCents = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });

/** $ 6.200 — muestra centavos solo cuando los hay ($ 2.066,67). */
export function money(cents: Cents): string {
  return (cents % 100 === 0 ? arsWhole : arsCents).format(cents / 100);
}

export function pesosToCents(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function centsToPesosInput(cents: Cents | null): string {
  if (cents === null) return '';
  const pesos = cents / 100;
  return Number.isInteger(pesos) ? String(pesos) : pesos.toFixed(2).replace('.', ',');
}

export const FRACTION_LABEL: Record<Denominator, string> = { 1: 'Entero', 2: '½', 3: '⅓' };

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  PENDING: 'En cocina',
  PREPARING: 'Preparando',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  MERCADO_PAGO: 'Mercado Pago',
  QR: 'QR de cobro',
  POSNET: 'Posnet',
  CASH: 'Efectivo',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  RESERVED: 'Reservado',
  AWAITING_POSNET: 'Esperando Posnet',
  PAID: 'Abonado',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
  VOIDED: 'Anulado',
};

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'recién';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
