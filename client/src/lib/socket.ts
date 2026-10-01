import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types.ts';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(auth: { dinerToken?: string; staffToken?: string }): AppSocket {
  return io({ auth, transports: ['websocket', 'polling'] });
}
