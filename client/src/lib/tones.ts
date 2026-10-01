import type { DinerDTO } from '../../../shared/types.ts';

/** Paleta de comensales: tonos terrosos, distinguibles entre sí y legibles con texto claro. */
const TONES = ['#c4553a', '#3f5f8a', '#6e7f3a', '#a8742a', '#7a4a6e', '#2f7a74', '#9c4a2c', '#4e6b4f', '#2d3e66', '#a85173'];

export interface Person {
  id: string;
  name: string;
  tone: string;
}

/** El color se asigna por orden de llegada a la mesa, así es estable para todos los celulares. */
export function toPeople(diners: DinerDTO[]): Map<string, Person> {
  return new Map(diners.map((d, i) => [d.id, { id: d.id, name: d.name, tone: TONES[i % TONES.length]! }]));
}
