// Persistencia simple en un archivo JSON. Todo el estado vive en memoria y se guarda (con debounce) en cada cambio.
// Para el prototipo del TP alcanza; el dominio no depende de esto, así que se puede reemplazar por una base de datos.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DB } from './domain/model.ts';
import { buildSeedDB } from './seed-data.ts';

export class JsonStore {
  private readonly file: string;
  private db: DB | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(file: string) {
    this.file = file;
  }

  load(): { db: DB; seeded: boolean } {
    if (existsSync(this.file)) {
      this.db = JSON.parse(readFileSync(this.file, 'utf8')) as DB;
      return { db: this.db, seeded: false };
    }
    this.db = buildSeedDB();
    this.flush();
    return { db: this.db, seeded: true };
  }

  scheduleSave = () => {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 150);
  };

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.db) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db));
    renameSync(tmp, this.file);
  }
}

export function writeDB(file: string, db: DB) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(db));
}
