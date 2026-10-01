// Datos iniciales de ejemplo: una cervecería con su menú, 10 mesas y dos usuarios del staff.
import { emptyDB, type DB, type MenuItem } from './domain/model.ts';
import { hashPassword, newId, newQrToken } from './domain/security.ts';

export const DEMO_USERS = {
  admin: { email: 'admin@pedidogrupal.test', password: 'admin1234' },
  mozo: { email: 'mozo@pedidogrupal.test', password: 'mozo1234' },
};

const ars = (pesos: number) => Math.round(pesos * 100);

type SeedItem = Omit<MenuItem, 'id' | 'categoryId' | 'sort' | 'deleted' | 'promoPrice' | 'promoLabel' | 'imageUrl' | 'available'> &
  Partial<Pick<MenuItem, 'promoPrice' | 'promoLabel' | 'available'>>;

const MENU: { category: string; items: SeedItem[] }[] = [
  {
    category: 'Cervezas tiradas',
    items: [
      { name: 'Pinta IPA', description: 'Lupulada y amarga, 6,5% ABV. 473 ml.', price: ars(6200) },
      { name: 'Pinta Golden', description: 'Rubia liviana y refrescante, 4,8% ABV. 473 ml.', price: ars(5600), promoPrice: ars(4200), promoLabel: 'Happy hour' },
      { name: 'Pinta Honey', description: 'Con miel de la zona, 5,5% ABV. 473 ml.', price: ars(5800) },
      { name: 'Pinta Stout', description: 'Negra, notas a café y chocolate, 6% ABV. 473 ml.', price: ars(6200) },
      { name: 'Jarra IPA (1,5 L)', description: 'Para compartir entre 3 o 4.', price: ars(17500) },
    ],
  },
  {
    category: 'Para compartir',
    items: [
      { name: 'Papas fritas', description: 'Porción grande con dip de alioli.', price: ars(8900) },
      { name: 'Papas cheddar y bacon', description: 'Con cheddar fundido, bacon crocante y verdeo.', price: ars(11500) },
      { name: 'Nachos con guacamole', description: 'Totopos, guacamole, pico de gallo y crema ácida.', price: ars(10800) },
      { name: 'Rabas', description: 'Porción de rabas con limón y alioli.', price: ars(15900), available: false },
      { name: 'Tabla de picada', description: 'Fiambres, quesos, aceitunas y pan de campo para 3-4.', price: ars(21000) },
    ],
  },
  {
    category: 'Hamburguesas',
    items: [
      { name: 'Doble carne', description: 'Doble medallón, cheddar, cebolla caramelizada. Con papas.', price: ars(13900) },
      { name: 'Triple carne', description: 'Triple medallón, triple cheddar y bacon. Con papas.', price: ars(16400) },
      { name: 'Clásica', description: 'Medallón, lechuga, tomate y queso tybo. Con papas.', price: ars(11200) },
      { name: 'Veggie', description: 'Medallón de lentejas y quinoa, rúcula y tomate confitado.', price: ars(12300) },
    ],
  },
  {
    category: 'Pizzas',
    items: [
      { name: 'Muzzarella', description: 'Salsa de tomate, muzzarella y orégano. 8 porciones.', price: ars(12500) },
      { name: 'Fugazzeta', description: 'Rellena de muzzarella con cebolla. 8 porciones.', price: ars(14800) },
    ],
  },
  {
    category: 'Sin alcohol',
    items: [
      { name: 'Gaseosa línea Coca-Cola', description: 'Lata 354 ml.', price: ars(2900) },
      { name: 'Agua con o sin gas', description: 'Botella 500 ml.', price: ars(2500) },
      { name: 'Limonada de la casa', description: 'Con menta y jengibre. Jarra 1 L.', price: ars(7200) },
    ],
  },
  {
    category: 'Postres',
    items: [{ name: 'Brownie con helado', description: 'Brownie tibio con bocha de helado de crema americana.', price: ars(7600) }],
  },
];

export function buildSeedDB(): DB {
  const db = emptyDB();
  const now = new Date().toISOString();
  db.venue = {
    name: 'Cervecería El Fondo',
    mpLink: 'https://link.mercadopago.com.ar/cerveceriaelfondo',
    mpAlias: 'cerveceria.elfondo.mp',
    cobroQrData: 'https://link.mercadopago.com.ar/cerveceriaelfondo',
    reservationTtlSec: 60,
    tipOptions: [10, 15],
    publicUrl: '',
  };
  let itemSort = 0;
  MENU.forEach((section, index) => {
    const categoryId = newId();
    db.categories.push({ id: categoryId, name: section.category, sort: index + 1 });
    for (const item of section.items) {
      db.menuItems.push({
        id: newId(),
        categoryId,
        sort: ++itemSort,
        deleted: false,
        imageUrl: null,
        promoPrice: null,
        promoLabel: null,
        available: true,
        ...item,
      });
    }
  });
  for (let number = 1; number <= 10; number++) {
    db.tables.push({
      id: newId(),
      number,
      label: number <= 6 ? 'Salón' : 'Patio',
      qrToken: newQrToken(),
      active: true,
      deleted: false,
    });
  }
  db.staff.push(
    {
      id: newId(),
      name: 'Admin',
      email: DEMO_USERS.admin.email,
      passwordHash: hashPassword(DEMO_USERS.admin.password),
      role: 'ADMIN',
      active: true,
      createdAt: now,
    },
    {
      id: newId(),
      name: 'Juan (mozo)',
      email: DEMO_USERS.mozo.email,
      passwordHash: hashPassword(DEMO_USERS.mozo.password),
      role: 'MOZO',
      active: true,
      createdAt: now,
    },
  );
  return db;
}
