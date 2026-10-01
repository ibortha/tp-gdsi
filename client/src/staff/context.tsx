import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { StaffUserDTO } from '../../../shared/types.ts';
import { api, type RequestOptions } from '../lib/api.ts';

export interface StaffContextValue {
  token: string;
  user: StaffUserDTO;
  /** Se incrementa cada vez que el servidor avisa que cambió algo: las vistas vuelven a pedir sus datos. */
  version: number;
  call: <T>(path: string, options?: Omit<RequestOptions, 'staffToken'>) => Promise<T>;
  logout: () => void;
}

export const StaffContext = createContext<StaffContextValue | null>(null);

export function useStaff(): StaffContextValue {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error('useStaff fuera del panel');
  return ctx;
}

/** Pide `path` al montar y cada vez que llega un aviso de cambio por el socket. */
export function useStaffData<T>(path: string | null) {
  const { call, version } = useStaff();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const current = useRef(path);
  current.current = path;

  useEffect(() => {
    if (!path) return;
    let alive = true;
    call<T>(path).then(
      (value) => {
        if (alive && current.current === path) {
          setData(value);
          setError(null);
        }
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [path, version, reloadKey, call]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { data, error, reload };
}
