import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const newId = () => randomUUID();

/** Token opaco para sesiones de comensales y del staff. */
export const newToken = () => randomBytes(24).toString('base64url');

/** Token corto que va dentro del QR de cada mesa. */
export const newQrToken = () => randomBytes(9).toString('base64url');

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}
