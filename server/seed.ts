// Reinicia los datos: `npm run seed` (menú, mesas y usuarios de ejemplo)
// o `npm run seed:demo` (además simula unas noches de uso para tener métricas que mostrar).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateHistory } from './history.ts';
import { DEMO_USERS, buildSeedDB } from './seed-data.ts';
import { writeDB } from './store.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = resolve(root, process.env.DATA_FILE ?? 'data/db.json');

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const db = buildSeedDB();
  const history = process.argv.includes('--history');
  if (history) simulateHistory(db);
  writeDB(dataFile, db);
  console.log(`Datos reiniciados en ${dataFile}${history ? ' (con historial de demo)' : ''}.`);
  console.log(`ADMIN: ${DEMO_USERS.admin.email} / ${DEMO_USERS.admin.password}`);
  console.log(`Mozo:  ${DEMO_USERS.mozo.email} / ${DEMO_USERS.mozo.password}`);
}
