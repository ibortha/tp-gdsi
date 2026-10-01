// En la demo estática se navega con "#/ruta" para que funcione en cualquier hosting sin configurar redirecciones.
const DEMO = import.meta.env.MODE === 'demo';

/** href para un link "crudo" (<a>) a una ruta de la app. */
export const appHref = (path: string) => (DEMO ? `#${path}` : path);

/** URL completa que va dentro del QR de una mesa. */
export function tableUrl(publicUrl: string, qrToken: string): string {
  if (DEMO) return `${window.location.origin}${window.location.pathname}#/m/${qrToken}`;
  return `${publicUrl || window.location.origin}/m/${qrToken}`;
}
