// Tiempo real con Socket.IO: cada mesa es una sala; el staff comparte la sala "staff".
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.ts';
import type { Domain } from './domain/index.ts';

const sessionRoom = (sessionId: string) => `session:${sessionId}`;
const STAFF_ROOM = 'staff';

export function attachRealtime(httpServer: HttpServer, domain: Domain) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
    cors: { origin: true },
  });

  io.on('connection', (socket) => {
    const { dinerToken, staffToken } = socket.handshake.auth as { dinerToken?: string; staffToken?: string };
    try {
      if (staffToken) {
        domain.staff.authenticate(staffToken);
        void socket.join(STAFF_ROOM);
        return;
      }
      if (dinerToken) {
        const diner = domain.diners.authenticate(dinerToken);
        void socket.join(sessionRoom(diner.sessionId));
        socket.emit('session:state', domain.diners.snapshot(diner.sessionId));
        return;
      }
    } catch {
      // Token vencido o mesa cerrada: el cliente se entera por la API y vuelve a la pantalla de ingreso.
    }
    socket.disconnect(true);
  });

  // Varias operaciones pueden tocar la misma mesa en el mismo tick (p. ej. vencer reservas y luego reservar):
  // se agrupan para mandar un único snapshot por mesa.
  const pending = new Set<string>();
  let flushScheduled = false;
  const flush = () => {
    flushScheduled = false;
    const sessions = [...pending];
    pending.clear();
    for (const sessionId of sessions) {
      io.to(sessionRoom(sessionId)).emit('session:state', domain.diners.snapshot(sessionId));
      io.to(STAFF_ROOM).emit('staff:changed', { sessionId });
    }
  };

  domain.ctx.events = {
    sessionChanged(sessionId) {
      pending.add(sessionId);
      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(flush);
      }
    },
    sessionClosed(sessionId) {
      pending.delete(sessionId);
      io.to(sessionRoom(sessionId)).emit('session:closed', { sessionId });
      io.in(sessionRoom(sessionId)).disconnectSockets(true);
      io.to(STAFF_ROOM).emit('staff:changed', { sessionId });
    },
    menuChanged() {
      io.emit('menu:changed');
    },
    tablesChanged() {
      io.to(STAFF_ROOM).emit('staff:changed', { sessionId: null });
    },
    posnetRequested(alert) {
      io.to(STAFF_ROOM).emit('staff:posnet', alert);
    },
  };

  return io;
}
