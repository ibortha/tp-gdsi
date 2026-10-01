// Tipos compartidos entre el servidor y el cliente (contratos de la API y del tiempo real).
// Todos los importes se manejan en centavos (enteros) para evitar errores de redondeo.

export type Cents = number;

export type Role = 'ADMIN' | 'MOZO';

/** Estado del ítem en cocina / salón. */
export type ItemStatus = 'PENDING' | 'PREPARING' | 'DELIVERED' | 'CANCELLED';

/** Fracciones fijas permitidas para pagar un ítem: completo, mitad o tercio. */
export type Denominator = 1 | 2 | 3;

export type PaymentMethod = 'MERCADO_PAGO' | 'QR' | 'POSNET' | 'CASH';

/**
 * Ciclo de vida de un pago (y por lo tanto de las porciones que cubre):
 * RESERVED -> PAID | EXPIRED | CANCELLED, RESERVED -> AWAITING_POSNET -> PAID | CANCELLED,
 * PAID -> VOIDED (el mozo anula un pago declarado que no se recibió).
 */
export type PaymentStatus = 'RESERVED' | 'AWAITING_POSNET' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'VOIDED';

/** ITEMS: el comensal eligió porciones de ítems. SPLIT: tomó partes de una división del saldo. */
export type PaymentKind = 'ITEMS' | 'SPLIT';

/** Estado de una porción de un ítem, tal como la ve la mesa. */
export type PortionState = 'AVAILABLE' | 'RESERVED' | 'PAID' | 'IN_SPLIT';

export type SplitStatus = 'ACTIVE' | 'COMPLETED' | 'DISSOLVED';

export interface VenuePublic {
  name: string;
  /** Link que abre la app de Mercado Pago (link de pago o perfil del local). */
  mpLink: string;
  /** Alias para transferir desde Mercado Pago u otra billetera. */
  mpAlias: string;
  /** Contenido del QR estático de cobro del local. */
  cobroQrData: string;
  /** Segundos que dura una reserva sin confirmar antes de liberarse. */
  reservationTtlSec: number;
  /** Porcentajes de propina ofrecidos al pagar (0 siempre está disponible). */
  tipOptions: number[];
}

export interface VenueSettings extends VenuePublic {
  /** URL pública con la que se arman los QR de las mesas (vacío = la del navegador). */
  publicUrl: string;
}

export interface MenuCategoryDTO {
  id: string;
  name: string;
  sort: number;
}

export interface MenuItemDTO {
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
}

export interface MenuDTO {
  categories: MenuCategoryDTO[];
  items: MenuItemDTO[];
}

export interface DinerDTO {
  id: string;
  name: string;
  color: string;
  joinedAt: string;
}

export interface PortionDTO {
  index: number;
  amount: Cents;
  state: PortionState;
  /** Quién la reservó o la pagó (null si está disponible, en división o la cobró el mozo). */
  dinerId: string | null;
  paymentId: string | null;
  splitId: string | null;
}

/** Una unidad de un ítem pedido (un ítem con cantidad 3 tiene 3 unidades pagables por separado). */
export interface UnitDTO {
  unitIndex: number;
  price: Cents;
  /** En cuántas porciones quedó dividida la unidad; null si nadie la tomó todavía. */
  denominator: Denominator | null;
  portions: PortionDTO[];
  paid: Cents;
}

export interface OrderItemDTO {
  id: string;
  orderId: string;
  menuItemId: string;
  name: string;
  unitPrice: Cents;
  quantity: number;
  note: string;
  status: ItemStatus;
  dinerId: string;
  createdAt: string;
  units: UnitDTO[];
}

export interface ClaimDTO {
  orderItemId: string;
  unitIndex: number;
  denominator: Denominator;
  portionIndex: number;
  amount: Cents;
  label: string;
}

export interface PaymentDTO {
  id: string;
  dinerId: string | null;
  kind: PaymentKind;
  method: PaymentMethod | null;
  status: PaymentStatus;
  amount: Cents;
  tipPercent: number;
  tipAmount: Cents;
  claims: ClaimDTO[];
  splitId: string | null;
  shareIndices: number[];
  createdAt: string;
  expiresAt: string | null;
  posnetRequestedAt: string | null;
  paidAt: string | null;
  confirmedBy: 'DINER' | 'STAFF' | null;
  staffName: string | null;
  dismissed: boolean;
}

export interface SplitShareDTO {
  index: number;
  amount: Cents;
  state: 'AVAILABLE' | 'RESERVED' | 'PAID';
  dinerId: string | null;
  paymentId: string | null;
}

export interface SplitDTO {
  id: string;
  createdBy: string;
  parts: number;
  total: Cents;
  status: SplitStatus;
  shares: SplitShareDTO[];
  createdAt: string;
}

export interface BillSummary {
  /** Suma de todo lo pedido (sin ítems cancelados). */
  total: Cents;
  /** Lo ya abonado. */
  paid: Cents;
  /** Lo que está reservado en pagos en curso. */
  reserved: Cents;
  /** Saldo pendiente = total - abonado. */
  outstanding: Cents;
  /** Lo que todavía nadie tomó: se puede elegir por ítems o dividir. */
  unclaimed: Cents;
  /** Propinas declaradas en pagos abonados (no forman parte del saldo). */
  tips: Cents;
}

export interface SessionSnapshot {
  sessionId: string;
  table: { id: string; number: number; label: string };
  status: 'OPEN' | 'CLOSED';
  settled: boolean;
  openedAt: string;
  diners: DinerDTO[];
  items: OrderItemDTO[];
  payments: PaymentDTO[];
  activeSplit: SplitDTO | null;
  bill: BillSummary;
  serverTime: string;
}

export interface TableSummaryDTO {
  id: string;
  number: number;
  label: string;
  active: boolean;
  qrToken: string;
  session: null | {
    id: string;
    openedAt: string;
    diners: number;
    bill: BillSummary;
    pendingItems: number;
    paymentsInProgress: number;
    posnetRequests: number;
    settled: boolean;
  };
}

export interface KitchenTicketDTO {
  orderId: string;
  sessionId: string;
  tableId: string;
  tableNumber: number;
  dinerName: string;
  createdAt: string;
  note: string;
  items: { id: string; name: string; quantity: number; note: string; status: ItemStatus; updatedAt: string }[];
}

export interface PosnetAlertDTO {
  paymentId: string;
  sessionId: string;
  tableId: string;
  tableNumber: number;
  dinerName: string;
  amount: Cents;
  tipAmount: Cents;
  requestedAt: string;
}

export interface StaffUserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface MetricsDTO {
  sessions: { total: number; closed: number; open: number; settled: number };
  /** Tiempo de cierre de mesa: desde el primer pago iniciado hasta saldo $0 (segundos). */
  avgCloseSeconds: number | null;
  avgSessionMinutes: number | null;
  avgTicket: Cents | null;
  revenue: Cents;
  tips: Cents;
  adoption: {
    /** % de comensales que hicieron al menos un pedido desde su celular. */
    dinersWhoOrderedPct: number | null;
    paymentsByKind: Record<PaymentKind, number>;
    paymentsByMethod: Record<PaymentMethod, number>;
    /** % de pagos por ítems que incluyeron mitades o tercios. */
    fractionalPct: number | null;
  };
  staff: {
    /** Tiempo promedio desde que se pide un ítem hasta que se entrega (segundos). */
    avgDeliverySeconds: number | null;
    /** Tiempo promedio de respuesta a un pedido de Posnet (segundos). */
    avgPosnetResponseSeconds: number | null;
  };
  incidents: {
    expiredReservations: number;
    voidedPayments: number;
    cancelledItems: number;
    /** Incidentes cada 100 pagos iniciados. */
    ratePer100Payments: number | null;
  };
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---- Eventos de Socket.IO ----

export interface ServerToClientEvents {
  'session:state': (snapshot: SessionSnapshot) => void;
  'session:closed': (payload: { sessionId: string }) => void;
  'menu:changed': () => void;
  /** Aviso al staff de que cambió algo en una mesa (el panel vuelve a pedir lo que muestra). */
  'staff:changed': (payload: { sessionId: string | null }) => void;
  'staff:posnet': (alert: PosnetAlertDTO) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
}
