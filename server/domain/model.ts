// Modelo persistido. Es el "estado" completo de la aplicación que se guarda en disco.
import type {
  Cents,
  Denominator,
  ItemStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Role,
  SplitStatus,
  VenueSettings,
} from '../../shared/types.ts';

export type Venue = VenueSettings;

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: Cents;
  promoPrice: Cents | null;
  promoLabel: string | null;
  imageUrl: string | null;
  available: boolean;
  sort: number;
  /** Baja lógica: los pedidos viejos lo siguen referenciando. */
  deleted: boolean;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface StaffSession {
  token: string;
  staffId: string;
  createdAt: string;
}

/** Mesa física del local, identificada por un QR único. */
export interface Table {
  id: string;
  number: number;
  label: string;
  qrToken: string;
  active: boolean;
  deleted: boolean;
}

/** Una "visita" a la mesa: desde que se sienta el primer comensal hasta que el mozo la cierra. */
export interface TableSession {
  id: string;
  tableId: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  /** Primer momento en que alguien empezó a pagar (métrica de tiempo de cierre). */
  firstPaymentAt: string | null;
  /** Momento en que el saldo llegó a $0 (se limpia si después se piden más cosas). */
  settledAt: string | null;
}

export interface Diner {
  id: string;
  sessionId: string;
  name: string;
  token: string;
  color: string;
  joinedAt: string;
}

export interface Order {
  id: string;
  sessionId: string;
  dinerId: string;
  note: string;
  createdAt: string;
}

/** Ítem pedido: pertenece a la cuenta de la mesa, no a una persona. */
export interface OrderItem {
  id: string;
  orderId: string;
  sessionId: string;
  dinerId: string;
  menuItemId: string;
  name: string;
  /** Precio unitario congelado al momento de pedir. */
  unitPrice: Cents;
  quantity: number;
  note: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

/** Porción de una unidad de un ítem: unidad `unitIndex` dividida en `denominator` partes, parte `portionIndex`. */
export interface Claim {
  orderItemId: string;
  unitIndex: number;
  denominator: Denominator;
  portionIndex: number;
}

export interface Payment {
  id: string;
  sessionId: string;
  /** null cuando lo registra el mozo (cobro del saldo restante). */
  dinerId: string | null;
  kind: PaymentKind;
  claims: Claim[];
  splitId: string | null;
  shareIndices: number[];
  method: PaymentMethod | null;
  status: PaymentStatus;
  tipPercent: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  posnetRequestedAt: string | null;
  paidAt: string | null;
  confirmedBy: 'DINER' | 'STAFF' | null;
  staffId: string | null;
  /** El comensal descartó el aviso de "tu reserva venció". */
  dismissed: boolean;
}

/** "Dividir el total": reparte en partes iguales todo lo que nadie había tomado al momento de crearla. */
export interface Split {
  id: string;
  sessionId: string;
  createdBy: string;
  parts: number;
  claims: Claim[];
  status: SplitStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DB {
  version: 1;
  venue: Venue;
  categories: Category[];
  menuItems: MenuItem[];
  staff: StaffUser[];
  staffSessions: StaffSession[];
  tables: Table[];
  sessions: TableSession[];
  diners: Diner[];
  orders: Order[];
  orderItems: OrderItem[];
  payments: Payment[];
  splits: Split[];
}

export function emptyDB(): DB {
  return {
    version: 1,
    venue: {
      name: 'Mi local',
      mpLink: '',
      mpAlias: '',
      cobroQrData: '',
      reservationTtlSec: 60,
      tipOptions: [10, 15],
      publicUrl: '',
    },
    categories: [],
    menuItems: [],
    staff: [],
    staffSessions: [],
    tables: [],
    sessions: [],
    diners: [],
    orders: [],
    orderItems: [],
    payments: [],
    splits: [],
  };
}
