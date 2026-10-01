import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuDTO, SessionSnapshot, VenuePublic } from '../../../shared/types.ts';
import { ApiError, api } from '../lib/api.ts';
import { connectSocket } from '../lib/socket.ts';
import { load, save } from '../lib/storage.ts';

export interface DinerAuth {
  token: string;
  dinerId: string;
}

export type SessionStatus = 'loading' | 'join' | 'ready' | 'closed';

/**
 * Estado de la sesión del comensal: token guardado en el celular, snapshot de la mesa en tiempo real,
 * menú y configuración del local.
 */
export function useDinerSession(qrToken: string) {
  const authKey = `pg:diner:${qrToken}`;
  const [auth, setAuthState] = useState<DinerAuth | null>(() => load<DinerAuth | null>(authKey, null));
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [status, setStatus] = useState<SessionStatus>(auth ? 'loading' : 'join');
  const [menu, setMenu] = useState<MenuDTO | null>(null);
  const [venue, setVenue] = useState<VenuePublic | null>(null);
  const [connected, setConnected] = useState(true);
  /** Diferencia entre el reloj del servidor y el del celular (para las cuentas regresivas). */
  const offset = useRef(0);
  const latest = useRef<string>('');

  const setAuth = useCallback(
    (value: DinerAuth | null) => {
      save(authKey, value);
      setAuthState(value);
    },
    [authKey],
  );

  const apply = useCallback((next: SessionSnapshot) => {
    // Las respuestas HTTP y los eventos del socket pueden llegar desordenados: se queda el más nuevo.
    if (next.serverTime < latest.current) return;
    latest.current = next.serverTime;
    offset.current = Date.parse(next.serverTime) - Date.now();
    setSnapshot(next);
  }, []);

  /** La mesa se cerró (410) o el token ya no vale (401): devuelve true si lo manejó. */
  const handleSessionError = useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof ApiError)) return false;
      if (error.status === 410) {
        setStatus('closed');
        return true;
      }
      if (error.status === 401) {
        setAuth(null);
        setStatus('join');
        return true;
      }
      return false;
    },
    [setAuth],
  );

  const loadMenu = useCallback(() => {
    api<MenuDTO>('/api/public/menu').then(setMenu, () => {});
    api<VenuePublic>('/api/public/config').then(setVenue, () => {});
  }, []);

  useEffect(loadMenu, [loadMenu]);

  // Recupera la sesión guardada y se suscribe a los cambios de la mesa.
  useEffect(() => {
    if (!auth) {
      setStatus((s) => (s === 'closed' ? s : 'join'));
      return;
    }
    let alive = true;
    api<{ snapshot: SessionSnapshot }>('/api/diner/me', { dinerToken: auth.token })
      .then((res) => {
        if (!alive) return;
        apply(res.snapshot);
        setStatus('ready');
      })
      .catch((error) => {
        // Sin conexión: se muestra la app y el socket trae el estado cuando vuelva la red.
        if (alive && !handleSessionError(error)) setStatus('ready');
      });

    const socket = connectSocket({ dinerToken: auth.token });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('session:state', apply);
    socket.on('session:closed', () => setStatus('closed'));
    socket.on('menu:changed', loadMenu);
    return () => {
      alive = false;
      socket.disconnect();
    };
  }, [auth, apply, handleSessionError, loadMenu]);

  const join = useCallback(
    async (name: string) => {
      const res = await api<{ token: string; dinerId: string; snapshot: SessionSnapshot }>(
        `/api/public/tables/${qrToken}/join`,
        { body: { name } },
      );
      latest.current = '';
      apply(res.snapshot);
      setAuth({ token: res.token, dinerId: res.dinerId });
      setStatus('ready');
    },
    [qrToken, apply, setAuth],
  );

  /** Llama a un endpoint del comensal que devuelve el snapshot actualizado. */
  const act = useCallback(
    async (path: string, body: unknown = {}) => {
      if (!auth) throw new ApiError('UNAUTHORIZED', 'Volvé a unirte a la mesa.', 401);
      try {
        apply(await api<SessionSnapshot>(path, { body, dinerToken: auth.token }));
      } catch (error) {
        handleSessionError(error);
        throw error;
      }
    },
    [auth, apply, handleSessionError],
  );

  const leave = useCallback(() => {
    setAuth(null);
    setSnapshot(null);
    latest.current = '';
    setStatus('join');
  }, [setAuth]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { auth, status, snapshot, menu, venue, connected, join, act, leave, serverNow };
}

export type DinerSession = ReturnType<typeof useDinerSession>;
