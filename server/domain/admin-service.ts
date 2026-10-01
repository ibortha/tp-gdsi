// Casos de uso exclusivos del rol ADMIN: menú (US12), mesas y QR, personal y configuración del local.
import type { Cents, MenuItemDTO, Role, StaffUserDTO, VenueSettings } from '../../shared/types.ts';
import type { Context } from './context.ts';
import { toMenuItemDTO, toStaffDTO } from './dto.ts';
import { AppError, notFound } from './errors.ts';
import type { Category, MenuItem, StaffUser, Table } from './model.ts';
import { hashPassword, newId, newQrToken } from './security.ts';

export interface MenuItemInput {
  categoryId: string;
  name: string;
  description: string;
  price: Cents;
  promoPrice: Cents | null;
  promoLabel: string | null;
  imageUrl: string | null;
  available: boolean;
}

export interface StaffInput {
  name: string;
  email: string;
  role: Role;
  password?: string;
  active?: boolean;
}

export class AdminService {
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private get db() {
    return this.ctx.db;
  }

  // ---------- Categorías ----------

  createCategory(name: string): Category {
    const category: Category = { id: newId(), name: this.requiredText(name, 'El nombre de la categoría'), sort: this.nextSort(this.db.categories) };
    this.db.categories.push(category);
    this.ctx.commit({ menu: true });
    return category;
  }

  updateCategory(id: string, input: { name?: string; sort?: number }): Category {
    const category = this.category(id);
    if (input.name !== undefined) category.name = this.requiredText(input.name, 'El nombre de la categoría');
    if (input.sort !== undefined) category.sort = input.sort;
    this.ctx.commit({ menu: true });
    return category;
  }

  deleteCategory(id: string) {
    this.category(id);
    if (this.db.menuItems.some((m) => m.categoryId === id && !m.deleted))
      throw new AppError('CATEGORY_NOT_EMPTY', 'La categoría tiene productos: movelos o eliminalos primero.', 409);
    this.db.categories = this.db.categories.filter((c) => c.id !== id);
    this.ctx.commit({ menu: true });
  }

  private category(id: string): Category {
    const category = this.db.categories.find((c) => c.id === id);
    if (!category) throw notFound('La categoría');
    return category;
  }

  // ---------- Productos (US12) ----------

  createMenuItem(input: MenuItemInput): MenuItemDTO {
    const item: MenuItem = { id: newId(), sort: this.nextSort(this.db.menuItems), deleted: false, ...this.validItem(input) };
    this.db.menuItems.push(item);
    this.ctx.commit({ menu: true });
    return toMenuItemDTO(item);
  }

  /** Los cambios de precio aplican a lo que se pida desde ahora; lo ya pedido conserva su precio. */
  updateMenuItem(id: string, input: Partial<MenuItemInput> & { sort?: number }): MenuItemDTO {
    const item = this.menuItem(id);
    const { sort, ...rest } = input;
    Object.assign(item, this.validItem({ ...toMenuItemDTO(item), ...rest }));
    if (sort !== undefined) item.sort = sort;
    this.ctx.commit({ menu: true });
    return toMenuItemDTO(item);
  }

  deleteMenuItem(id: string) {
    this.menuItem(id).deleted = true;
    this.ctx.commit({ menu: true });
  }

  private menuItem(id: string): MenuItem {
    const item = this.db.menuItems.find((m) => m.id === id && !m.deleted);
    if (!item) throw notFound('El producto');
    return item;
  }

  private validItem(input: MenuItemInput): MenuItemInput {
    this.category(input.categoryId);
    if (!Number.isInteger(input.price) || input.price <= 0)
      throw new AppError('INVALID_PRICE', 'El precio tiene que ser mayor a $0.');
    if (input.promoPrice !== null && (!Number.isInteger(input.promoPrice) || input.promoPrice <= 0 || input.promoPrice >= input.price))
      throw new AppError('INVALID_PROMO', 'El precio promocional tiene que ser mayor a $0 y menor al precio normal.');
    return {
      categoryId: input.categoryId,
      name: this.requiredText(input.name, 'El nombre del producto'),
      description: input.description.trim(),
      price: input.price,
      promoPrice: input.promoPrice,
      promoLabel: input.promoPrice !== null ? input.promoLabel?.trim() || 'Promo' : null,
      imageUrl: input.imageUrl?.trim() || null,
      available: input.available,
    };
  }

  // ---------- Mesas y QR ----------

  createTable(input: { number: number; label?: string }): Table {
    this.assertTableNumberFree(input.number);
    const table: Table = {
      id: newId(),
      number: input.number,
      label: input.label?.trim() ?? '',
      qrToken: newQrToken(),
      active: true,
      deleted: false,
    };
    this.db.tables.push(table);
    this.ctx.commit({ tables: true });
    return table;
  }

  updateTable(id: string, input: { number?: number; label?: string; active?: boolean }): Table {
    const table = this.ctx.table(id);
    if (input.number !== undefined && input.number !== table.number) {
      this.assertTableNumberFree(input.number);
      table.number = input.number;
    }
    if (input.label !== undefined) table.label = input.label.trim();
    if (input.active !== undefined) table.active = input.active;
    this.ctx.commit({ tables: true });
    return table;
  }

  /** Invalida el QR impreso anterior (por ejemplo, si alguien se lo llevó). */
  regenerateQr(id: string): Table {
    const table = this.ctx.table(id);
    table.qrToken = newQrToken();
    this.ctx.commit({ tables: true });
    return table;
  }

  deleteTable(id: string) {
    const table = this.ctx.table(id);
    if (this.ctx.openSessionOfTable(id))
      throw new AppError('TABLE_IN_USE', 'La mesa tiene comensales: cerrala antes de eliminarla.', 409);
    table.deleted = true;
    this.ctx.commit({ tables: true });
  }

  private assertTableNumberFree(number: number) {
    if (!Number.isInteger(number) || number < 1) throw new AppError('INVALID_TABLE_NUMBER', 'El número de mesa tiene que ser positivo.');
    if (this.db.tables.some((t) => !t.deleted && t.number === number))
      throw new AppError('TABLE_NUMBER_TAKEN', `Ya existe la mesa ${number}.`, 409);
  }

  // ---------- Personal ----------

  listStaff(): StaffUserDTO[] {
    return this.db.staff.map(toStaffDTO);
  }

  createStaff(input: StaffInput): StaffUserDTO {
    const email = input.email.trim().toLowerCase();
    if (this.db.staff.some((s) => s.email === email))
      throw new AppError('EMAIL_TAKEN', 'Ya hay un usuario con ese email.', 409);
    if (!input.password || input.password.length < 6)
      throw new AppError('WEAK_PASSWORD', 'La contraseña tiene que tener al menos 6 caracteres.');
    const user: StaffUser = {
      id: newId(),
      name: this.requiredText(input.name, 'El nombre'),
      email,
      passwordHash: hashPassword(input.password),
      role: input.role,
      active: input.active ?? true,
      createdAt: this.ctx.nowIso(),
    };
    this.db.staff.push(user);
    this.ctx.commit({});
    return toStaffDTO(user);
  }

  updateStaff(actor: StaffUser, id: string, input: Partial<StaffInput>): StaffUserDTO {
    const user = this.staffUser(id);
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (this.db.staff.some((s) => s.email === email && s.id !== id))
        throw new AppError('EMAIL_TAKEN', 'Ya hay un usuario con ese email.', 409);
      user.email = email;
    }
    if (input.name !== undefined) user.name = this.requiredText(input.name, 'El nombre');
    if (input.password) {
      if (input.password.length < 6) throw new AppError('WEAK_PASSWORD', 'La contraseña tiene que tener al menos 6 caracteres.');
      user.passwordHash = hashPassword(input.password);
    }
    const nextRole = input.role ?? user.role;
    const nextActive = input.active ?? user.active;
    if (user.role === 'ADMIN' && (nextRole !== 'ADMIN' || !nextActive)) this.assertAnotherAdmin(user.id);
    if (actor.id === user.id && !nextActive) throw new AppError('SELF_DEACTIVATE', 'No podés desactivar tu propio usuario.', 409);
    user.role = nextRole;
    user.active = nextActive;
    if (!user.active) this.db.staffSessions = this.db.staffSessions.filter((s) => s.staffId !== user.id);
    this.ctx.commit({});
    return toStaffDTO(user);
  }

  deleteStaff(actor: StaffUser, id: string) {
    const user = this.staffUser(id);
    if (actor.id === id) throw new AppError('SELF_DELETE', 'No podés eliminar tu propio usuario.', 409);
    if (user.role === 'ADMIN') this.assertAnotherAdmin(id);
    this.db.staff = this.db.staff.filter((s) => s.id !== id);
    this.db.staffSessions = this.db.staffSessions.filter((s) => s.staffId !== id);
    this.ctx.commit({});
  }

  private staffUser(id: string): StaffUser {
    const user = this.db.staff.find((s) => s.id === id);
    if (!user) throw notFound('El usuario');
    return user;
  }

  private assertAnotherAdmin(exceptId: string) {
    if (!this.db.staff.some((s) => s.id !== exceptId && s.role === 'ADMIN' && s.active))
      throw new AppError('LAST_ADMIN', 'Tiene que quedar al menos un ADMIN activo.', 409);
  }

  // ---------- Local ----------

  venue(): VenueSettings {
    return { ...this.db.venue, tipOptions: [...this.db.venue.tipOptions] };
  }

  updateVenue(input: Partial<VenueSettings>): VenueSettings {
    const next = { ...this.db.venue, ...input };
    next.name = this.requiredText(next.name, 'El nombre del local');
    if (!Number.isInteger(next.reservationTtlSec) || next.reservationTtlSec < 15 || next.reservationTtlSec > 600)
      throw new AppError('INVALID_TTL', 'El tiempo de reserva tiene que estar entre 15 y 600 segundos.');
    next.tipOptions = [...new Set(next.tipOptions)].filter((t) => Number.isInteger(t) && t > 0 && t <= 50).sort((a, b) => a - b);
    next.publicUrl = next.publicUrl.trim().replace(/\/+$/, '');
    this.db.venue = next;
    this.ctx.commit({ menu: true });
    return this.venue();
  }

  // ---------- Utilidades ----------

  private requiredText(value: string, what: string): string {
    const text = value.trim();
    if (!text) throw new AppError('REQUIRED', `${what} es obligatorio.`);
    return text;
  }

  private nextSort(list: { sort: number }[]): number {
    return list.reduce((max, x) => Math.max(max, x.sort), 0) + 1;
  }
}
