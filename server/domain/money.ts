import type { Cents } from '../../shared/types.ts';

/**
 * Reparte `amount` centavos en `parts` partes enteras que suman exactamente `amount`.
 * Los centavos sobrantes van a las primeras partes: distribute(1000, 3) = [334, 333, 333].
 */
export function distribute(amount: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error(`parts inválido: ${parts}`);
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function percentOf(amount: Cents, percent: number): Cents {
  return Math.round((amount * percent) / 100);
}
