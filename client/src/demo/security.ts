// Reemplazo de server/domain/security.ts para la demo en el navegador (sin node:crypto).
// Las contraseñas no se hashean: son datos de prueba que viven en el localStorage del navegador.

const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const base64url = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** UUID v4 armado a mano: crypto.randomUUID solo existe en contextos seguros (https). */
export function newId(): string {
  const b = bytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const newToken = () => base64url(bytes(24));
export const newQrToken = () => base64url(bytes(9));
export const hashPassword = (password: string) => `demo:${password}`;
export const verifyPassword = (password: string, stored: string) => stored === `demo:${password}`;
