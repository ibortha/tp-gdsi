import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types.ts';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Auth = { dinerToken?: string; staffToken?: string };

export function connectSocket(auth: Auth): AppSocket {
  if (import.meta.env.MODE === 'demo') return demoSocket(auth);
  return io({ auth, transports: ['websocket', 'polling'] });
}

/** En la demo estática los eventos los emite el backend simulado del navegador. */
function demoSocket(auth: Auth): AppSocket {
  type Fn = (...args: unknown[]) => void;
  const handlers = new Map<string, Set<Fn>>();
  let closed = false;
  let detach: (() => void) | null = null;
  const socket = {
    auth,
    on(event: string, fn: Fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return socket;
    },
    off(event: string, fn: Fn) {
      handlers.get(event)?.delete(fn);
      return socket;
    },
    once(event: string, fn: Fn) {
      const wrapped: Fn = (...args) => {
        socket.off(event, wrapped);
        fn(...args);
      };
      return socket.on(event, wrapped);
    },
    fire(event: string, ...args: unknown[]) {
      if (!closed) handlers.get(event)?.forEach((fn) => fn(...args));
    },
    disconnect() {
      closed = true;
      detach?.();
      return socket;
    },
  };
  void import('../demo/backend.ts').then((backend) => {
    if (closed) return;
    backend.connectDemo(socket as never);
    detach = () => backend.disconnectDemo(socket as never);
  });
  return socket as unknown as AppSocket;
}
