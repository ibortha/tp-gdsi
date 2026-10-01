import { describe, expect, it } from 'vitest';
import { DEMO_USERS } from '../seed-data.ts';
import { assertLedgerInvariant, setup } from './helpers.ts';

describe('panel del mozo (US10, US11)', () => {
  it('login con email y contraseña', () => {
    const { domain } = setup();
    const { token, user } = domain.staff.login(DEMO_USERS.mozo.email.toUpperCase(), DEMO_USERS.mozo.password);
    expect(user.role).toBe('MOZO');
    expect(domain.staff.authenticate(token).id).toBe(user.id);
    expect(() => domain.staff.login(DEMO_USERS.mozo.email, 'mal')).toThrowError(/incorrectos/);
    domain.staff.logout(token);
    expect(() => domain.staff.authenticate(token)).toThrowError(/venció/);
  });

  it('el listado de mesas refleja comensales, saldo y pedidos de Posnet', () => {
    const { domain, join, order, table } = setup();
    expect(domain.staff.tables().find((t) => t.id === table.id)!.session).toBeNull();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne'], ['Pinta IPA']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    domain.diners.chooseMethod(fede, 'POSNET');
    const summary = domain.staff.tables().find((t) => t.id === table.id)!.session!;
    expect(summary).toMatchObject({ diners: 1, pendingItems: 2, paymentsInProgress: 1, posnetRequests: 1, settled: false });
    expect(summary.bill.outstanding).toBe(1390000 + 620000);
  });

  it('comandas: avanzan de pendiente a entregado y se registra el tiempo de entrega', () => {
    const { domain, join, order, advance, db } = setup();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne']);
    expect(domain.staff.kitchen().active).toHaveLength(1);
    domain.staff.setItemStatus(burger!.id, 'PREPARING');
    advance(300);
    domain.staff.setItemStatus(burger!.id, 'DELIVERED');
    expect(domain.staff.kitchen().active).toHaveLength(0);
    expect(domain.staff.kitchen().recent).toHaveLength(1);
    expect(db.orderItems[0]!.deliveredAt).not.toBeNull();
    expect(domain.metrics().staff.avgDeliverySeconds).toBe(300);
  });

  it('no se puede cancelar un ítem que alguien ya está pagando', () => {
    const { domain, join, order, bill } = setup();
    const fede = join('Fede');
    const [burger, ipa] = order(fede, ['Doble carne'], ['Pinta IPA']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 3 });
    expect(() => domain.staff.setItemStatus(burger!.id, 'CANCELLED')).toThrowError(/No se puede cancelar/);
    domain.staff.setItemStatus(ipa!.id, 'CANCELLED');
    expect(bill(fede.sessionId).total).toBe(1390000);
  });

  it('anular un pago declarado devuelve lo cubierto a la cuenta', () => {
    const { domain, join, order, admin, bill, db } = setup();
    const [fede, meli] = [join('Fede'), join('Meli')];
    order(fede, ['Pinta IPA', 2]);
    domain.diners.startSplit(fede, 2);
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'MERCADO_PAGO').id);
    domain.diners.takeShares(meli, 1);
    const meliPayment = domain.diners.chooseMethod(meli, 'QR');
    domain.diners.confirmPayment(meli, meliPayment.id);
    expect(db.splits[0]!.status).toBe('COMPLETED');
    expect(bill(fede.sessionId).outstanding).toBe(0);

    domain.staff.voidPayment(admin, meliPayment.id);
    expect(meliPayment.status).toBe('VOIDED');
    expect(db.splits[0]!.status).toBe('ACTIVE');
    expect(bill(fede.sessionId).outstanding).toBe(620000);
    expect(db.sessions[0]!.settledAt).toBeNull();
    assertLedgerInvariant(db, fede.sessionId);
  });

  it('cobrar el saldo restante cubre porciones libres y partes libres de la división', () => {
    const { domain, join, order, admin, bill, db } = setup();
    const [fede, meli] = [join('Fede'), join('Meli')];
    const [ipa] = order(fede, ['Pinta IPA', 3]);
    domain.diners.claimPortion(meli, { orderItemId: ipa!.id, unitIndex: 0, denominator: 2 });
    domain.diners.confirmPayment(meli, domain.diners.chooseMethod(meli, 'QR').id);
    domain.diners.startSplit(fede, 3);
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'QR').id);
    const created = domain.staff.chargeRemaining(admin, fede.sessionId, 'CASH');
    expect(created.map((p) => p.kind)).toEqual(['SPLIT']);
    expect(bill(fede.sessionId).outstanding).toBe(0);
    expect(() => domain.staff.chargeRemaining(admin, fede.sessionId, 'CASH')).toThrowError(/no tiene saldo/);
    assertLedgerInvariant(db, fede.sessionId);
  });

  it('cerrar la mesa: pide confirmación si hay saldo y libera la mesa para el próximo grupo', () => {
    const { domain, join, order, table, events } = setup();
    const fede = join('Fede');
    order(fede, ['Pinta IPA']);
    expect(() => domain.staff.closeSession(fede.sessionId)).toThrowError(/saldo pendiente/);
    domain.staff.closeSession(fede.sessionId, true);
    expect(events.sessionClosed).toHaveBeenCalledWith(fede.sessionId);
    expect(() => domain.diners.authenticate(fede.token)).toThrowError(/cerrada/);
    const next = domain.diners.join(table.qrToken, 'Fede');
    expect(next.sessionId).not.toBe(fede.sessionId);
  });
});

describe('administración (US12)', () => {
  it('ABM de productos con validación de promociones', () => {
    const { domain, db, events } = setup();
    const categoryId = db.categories[0]!.id;
    const created = domain.admin.createMenuItem({
      categoryId,
      name: 'Pinta APA',
      description: '',
      price: 600000,
      promoPrice: null,
      promoLabel: 'ignorado',
      imageUrl: null,
      available: true,
    });
    expect(created.promoLabel).toBeNull();
    expect(events.menuChanged).toHaveBeenCalled();
    expect(() => domain.admin.updateMenuItem(created.id, { promoPrice: 700000 })).toThrowError(/menor al precio/);
    const promo = domain.admin.updateMenuItem(created.id, { promoPrice: 450000, promoLabel: '' });
    expect(promo.promoLabel).toBe('Promo');
    domain.admin.deleteMenuItem(created.id);
    expect(domain.diners.menu().items.some((i) => i.id === created.id)).toBe(false);
    expect(() => domain.admin.deleteCategory(categoryId)).toThrowError(/tiene productos/);
  });

  it('mesas: números únicos y QR regenerable', () => {
    const { domain, table } = setup();
    expect(() => domain.admin.createTable({ number: 1 })).toThrowError(/Ya existe la mesa 1/);
    const created = domain.admin.createTable({ number: 21, label: 'Barra' });
    const before = created.qrToken;
    domain.admin.regenerateQr(created.id);
    expect(created.qrToken).not.toBe(before);
    domain.diners.join(table.qrToken, 'Fede');
    expect(() => domain.admin.deleteTable(table.id)).toThrowError(/tiene comensales/);
  });

  it('personal: siempre queda un ADMIN activo', () => {
    const { domain, admin } = setup();
    expect(() => domain.admin.updateStaff(admin, admin.id, { role: 'MOZO' })).toThrowError(/al menos un ADMIN/);
    const other = domain.admin.createStaff({ name: 'Sofi', email: 'sofi@x.test', role: 'ADMIN', password: 'secreta' });
    domain.admin.updateStaff(admin, admin.id, { role: 'MOZO' });
    expect(() => domain.admin.deleteStaff(admin, admin.id)).toThrowError(/tu propio usuario/);
    expect(domain.staff.login('sofi@x.test', 'secreta').user.id).toBe(other.id);
  });

  it('métricas del Scope Canvas', () => {
    const { domain, join, order, advance, admin } = setup();
    const [fede, meli] = [join('Fede'), join('Meli')];
    const [burger] = order(fede, ['Doble carne']);
    order(fede, ['Pinta IPA']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 2 });
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'MERCADO_PAGO', 10).id);
    advance(90);
    domain.diners.startSplit(meli, 1);
    domain.diners.chooseMethod(meli, 'POSNET');
    advance(30);
    domain.staff.confirmPosnet(admin, domain.staff.posnetAlerts()[0]!.paymentId);
    domain.staff.closeSession(fede.sessionId);

    const m = domain.metrics();
    expect(m.sessions).toMatchObject({ total: 1, closed: 1, settled: 1 });
    expect(m.avgCloseSeconds).toBe(120);
    expect(m.revenue).toBe(1390000 + 620000);
    expect(m.tips).toBe(69500);
    expect(m.adoption.paymentsByKind).toEqual({ ITEMS: 1, SPLIT: 1 });
    expect(m.adoption.paymentsByMethod).toMatchObject({ MERCADO_PAGO: 1, POSNET: 1 });
    expect(m.adoption.fractionalPct).toBe(100);
    expect(m.adoption.dinersWhoOrderedPct).toBe(50);
    expect(m.staff.avgPosnetResponseSeconds).toBe(30);
  });
});

describe('métricas de consumo', () => {
  it('qué se pide, a qué hora, cómo se paga y cuántos se sientan por mesa', () => {
    const { domain, join, order, admin, db } = setup();
    const [fede, meli, tomi] = [join('Fede'), join('Meli'), join('Tomi')];
    order(fede, ['Pinta IPA', 2]);
    order(meli, ['Pinta IPA'], ['Papas fritas']);
    order(tomi, ['Papas fritas']);
    domain.diners.startSplit(fede, 1);
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'MERCADO_PAGO').id);
    domain.staff.closeSession(fede.sessionId);
    const other = domain.diners.join(db.tables[1]!.qrToken, 'Sofi').diner;
    order(other, ['Doble carne']);
    domain.diners.startSplit(other, 1);
    domain.diners.chooseMethod(other, 'POSNET');
    domain.staff.confirmPosnet(admin, domain.staff.posnetAlerts()[0]!.paymentId);

    const c = domain.metrics().consumption;
    expect(c.topItems[0]).toMatchObject({ name: 'Pinta IPA', quantity: 3, tables: 1, category: 'Cervezas tiradas' });
    expect(c.topItems[1]).toMatchObject({ name: 'Papas fritas', quantity: 2 });
    // El reloj de los tests está a las 23:30 UTC = 20:30 en Argentina.
    expect(c.byHour[20]).toEqual({ hour: 20, items: 6, orders: 4 });
    expect(c.methods.map((m) => m.method)).toEqual(['MERCADO_PAGO', 'POSNET']);
    expect(c.methods[0]!.amount).toBe(3 * 620000 + 2 * 890000);
    expect(c.partySize.avg).toBe(2);
    expect(c.partySize.distribution.find((d) => d.size === '3')!.tables).toBe(1);
    expect(c.perPerson.avgItems).toBe(6 / 4);
    const mesa1 = c.perTable.find((t) => t.number === 1)!;
    expect(mesa1).toMatchObject({ visits: 1, avgDiners: 3, topItem: 'Pinta IPA', revenue: 3 * 620000 + 2 * 890000 });
  });
});
