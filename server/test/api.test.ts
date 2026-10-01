// Prueba de integración: levanta la API real en un puerto efímero y la usa como lo harían dos celulares y el mozo.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../../shared/types.ts';
import { createDomain } from '../domain/index.ts';
import type { DB } from '../domain/model.ts';
import { createHttpApp } from '../http/app.ts';
import { attachRealtime } from '../realtime.ts';
import { DEMO_USERS, buildSeedDB } from '../seed-data.ts';

let server: Server;
let base: string;
let db: DB;
const sockets: Socket[] = [];

beforeAll(async () => {
  db = buildSeedDB();
  const domain = createDomain(db);
  server = createServer(createHttpApp(domain, { demo: true }));
  attachRealtime(server, domain);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

function nextState(socket: Socket, predicate: (s: SessionSnapshot) => boolean) {
  return new Promise<SessionSnapshot>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No llegó el snapshot esperado')), 3000);
    const handler = (s: SessionSnapshot) => {
      if (!predicate(s)) return;
      clearTimeout(timer);
      socket.off('session:state', handler);
      resolve(s);
    };
    socket.on('session:state', handler);
  });
}

describe('API + tiempo real', () => {
  it('flujo completo: unirse, pedir, ver en vivo, pagar por ítems, Posnet y cierre', async () => {
    const qr = db.tables[2]!.qrToken;
    const info = await call<{ number: number }>('GET', `/api/public/tables/${qr}`);
    expect(info.body.number).toBe(3);

    const fede = await call<{ token: string; dinerId: string }>('POST', `/api/public/tables/${qr}/join`, { name: 'Fede' });
    const meli = await call<{ token: string; dinerId: string }>('POST', `/api/public/tables/${qr}/join`, { name: 'Meli' });
    expect(fede.status).toBe(201);
    const dupe = await call<{ error: { code: string } }>('POST', `/api/public/tables/${qr}/join`, { name: 'fede' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('NAME_TAKEN');

    const meliSocket = connect(base, { auth: { dinerToken: meli.body.token }, transports: ['websocket'] });
    sockets.push(meliSocket);
    await nextState(meliSocket, () => true);

    const fedeH = { 'x-diner-token': fede.body.token };
    const meliH = { 'x-diner-token': meli.body.token };
    const menu = await call<{ items: { id: string; name: string }[] }>('GET', '/api/public/menu');
    const ipa = menu.body.items.find((i) => i.name === 'Pinta IPA')!;
    const burger = menu.body.items.find((i) => i.name === 'Doble carne')!;

    // Meli ve en vivo el pedido de Fede.
    const seen = nextState(meliSocket, (s) => s.items.length === 2);
    const ordered = await call<SessionSnapshot>('POST', '/api/diner/orders', { items: [{ menuItemId: ipa.id, quantity: 2 }, { menuItemId: burger.id, quantity: 1, note: 'sin cebolla' }] }, fedeH);
    expect(ordered.status).toBe(201);
    const live = await seen;
    expect(live.items.find((i) => i.name === 'Doble carne')!.note).toBe('sin cebolla');

    // Fede reserva la hamburguesa: a Meli le aparece como reservada.
    const burgerItem = live.items.find((i) => i.name === 'Doble carne')!;
    const reservedSeen = nextState(meliSocket, (s) => s.items.some((i) => i.units[0]?.portions[0]?.state === 'RESERVED'));
    await call('POST', '/api/diner/claims', { orderItemId: burgerItem.id, unitIndex: 0, denominator: 1 }, fedeH);
    await reservedSeen;
    const taken = await call<{ error: { code: string } }>('POST', '/api/diner/claims', { orderItemId: burgerItem.id, unitIndex: 0, denominator: 1 }, meliH);
    expect(taken.body.error.code).toBe('PORTION_TAKEN');

    // Fede paga con Mercado Pago.
    const withMethod = await call<SessionSnapshot>('POST', '/api/diner/payment/method', { method: 'MERCADO_PAGO', tipPercent: 10 }, fedeH);
    const fedePayment = withMethod.body.payments.find((p) => p.dinerId === fede.body.dinerId)!;
    const afterPay = await call<SessionSnapshot>('POST', `/api/diner/payments/${fedePayment.id}/confirm`, {}, fedeH);
    expect(afterPay.body.bill.paid).toBe(1390000);

    // Meli divide lo que queda y pide Posnet; el mozo lo confirma.
    await call('POST', '/api/diner/split', { parts: 1 }, meliH);
    await call('POST', '/api/diner/payment/method', { method: 'POSNET' }, meliH);

    const login = await call<{ token: string }>('POST', '/api/staff/login', DEMO_USERS.mozo);
    const staffH = { authorization: `Bearer ${login.body.token}` };
    const alerts = await call<{ paymentId: string; tableNumber: number; amount: number }[]>('GET', '/api/staff/posnet', undefined, staffH);
    expect(alerts.body).toEqual([expect.objectContaining({ tableNumber: 3, amount: 2 * 620000 })]);
    const settledSeen = nextState(meliSocket, (s) => s.settled);
    expect((await call('POST', `/api/staff/payments/${alerts.body[0]!.paymentId}/confirm-posnet`, {}, staffH)).status).toBe(204);
    expect((await settledSeen).bill.outstanding).toBe(0);

    // El mozo no puede entrar a la parte de ADMIN.
    const forbidden = await call('GET', '/api/admin/metrics', undefined, staffH);
    expect(forbidden.status).toBe(403);

    // Al cerrar la mesa los celulares se enteran.
    const closed = new Promise((resolve) => meliSocket.once('session:closed', resolve));
    await call('POST', `/api/staff/sessions/${ordered.body.sessionId}/close`, {}, staffH);
    await closed;
    const gone = await call<{ error: { code: string } }>('GET', '/api/diner/me', undefined, meliH);
    expect(gone.status).toBe(410);
  });

  it('valida la entrada y responde errores legibles', async () => {
    const bad = await call<{ error: { code: string; message: string } }>('POST', '/api/staff/login', { email: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_INPUT');
    const noAuth = await call('GET', '/api/staff/tables');
    expect(noAuth.status).toBe(401);
    const missing = await call('GET', '/api/nada');
    expect(missing.status).toBe(404);
  });
});
