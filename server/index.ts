import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDomain } from './domain/index.ts';
import { createHttpApp } from './http/app.ts';
import { attachRealtime } from './realtime.ts';
import { DEMO_USERS } from './seed-data.ts';
import { JsonStore } from './store.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dataFile = resolve(root, process.env.DATA_FILE ?? 'data/db.json');
const demo = process.env.DEMO_MODE !== 'false';

const store = new JsonStore(dataFile);
const { db, seeded } = store.load();
const domain = createDomain(db, { persist: store.scheduleSave });

const app = createHttpApp(domain, { demo, clientDir: production ? resolve(root, 'dist/client') : undefined });
const httpServer = createServer(app);
attachRealtime(httpServer, domain);

// Libera las reservas vencidas aunque nadie esté interactuando con la mesa.
const sweeper = setInterval(() => domain.ctx.expireDue(), 1000);

httpServer.listen(port, host, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);
  const clientPort = production ? port : 5173;
  console.log(`\n🍻 Pedido Grupal — API escuchando en http://localhost:${port}`);
  console.log(`   App: http://localhost:${clientPort}${lan.map((ip) => `  ·  http://${ip}:${clientPort}`).join('')}`);
  console.log(`   Datos: ${dataFile}${seeded ? ' (creado con datos de ejemplo)' : ''}`);
  if (seeded) {
    console.log(`   ADMIN: ${DEMO_USERS.admin.email} / ${DEMO_USERS.admin.password}`);
    console.log(`   Mozo:  ${DEMO_USERS.mozo.email} / ${DEMO_USERS.mozo.password}`);
  }
});

const shutdown = () => {
  clearInterval(sweeper);
  store.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
