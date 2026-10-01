import { describe, expect, it } from 'vitest';
import { distribute } from '../domain/money.ts';
import { assertLedgerInvariant, setup } from './helpers.ts';

describe('distribute', () => {
  it('reparte centavos sin perder ni sumar', () => {
    expect(distribute(1000, 3)).toEqual([334, 333, 333]);
    expect(distribute(620000, 3)).toEqual([206667, 206667, 206666]);
    expect(distribute(5, 1)).toEqual([5]);
    for (const [amount, parts] of [[1, 3], [999_999, 7], [0, 4]] as const) {
      expect(distribute(amount, parts).reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });
});

describe('unirse a la mesa (US01)', () => {
  it('el primer comensal abre la sesión y los siguientes se suman a la misma', () => {
    const { domain, table } = setup();
    const fede = domain.diners.join(table.qrToken, '  Fede ');
    const meli = domain.diners.join(table.qrToken, 'Meli');
    expect(fede.diner.name).toBe('Fede');
    expect(meli.sessionId).toBe(fede.sessionId);
    expect(fede.token).not.toBe(meli.token);
    expect(domain.diners.authenticate(meli.token).id).toBe(meli.diner.id);
  });

  it('no permite nombres repetidos en la misma mesa (sin importar mayúsculas ni tildes)', () => {
    const { join } = setup();
    join('Martín');
    expect(() => join('martin')).toThrowError(/Ya hay alguien llamado/);
    expect(() => join('   ')).toThrowError(/Ingresá tu nombre/);
  });

  it('un QR inexistente no abre ninguna mesa', () => {
    const { domain } = setup();
    expect(() => domain.diners.join('no-existe', 'Fede')).toThrowError(/no corresponde a ninguna mesa/);
  });
});

describe('pedidos (US03, US04)', () => {
  it('el pedido entra directo como pendiente, con el precio promocional congelado', () => {
    const { join, order, bill, menuItem, domain, events } = setup();
    const fede = join('Fede');
    const [golden, papas] = order(fede, ['Pinta Golden', 2], ['Papas fritas']);
    expect(golden!.status).toBe('PENDING');
    expect(golden!.unitPrice).toBe(menuItem('Pinta Golden').promoPrice);
    expect(bill(fede.sessionId).total).toBe(2 * 420000 + 890000);
    expect(events.sessionChanged).toHaveBeenCalledWith(fede.sessionId);

    // Cambiar el precio después no altera lo ya pedido.
    domain.admin.updateMenuItem(menuItem('Papas fritas').id, { price: 999900 });
    expect(papas!.unitPrice).toBe(890000);
  });

  it('rechaza productos agotados', () => {
    const { join, order } = setup();
    expect(() => order(join('Fede'), ['Rabas'])).toThrowError(/agotado/);
  });

  it('los ítems pertenecen a la mesa: todos ven la cuenta completa', () => {
    const { join, order, domain } = setup();
    const fede = join('Fede');
    const meli = join('Meli');
    order(fede, ['Doble carne']);
    order(meli, ['Pinta IPA']);
    const snapshot = domain.diners.snapshot(meli.sessionId);
    expect(snapshot.items.map((i) => i.name)).toEqual(['Doble carne', 'Pinta IPA']);
    expect(snapshot.diners).toHaveLength(2);
    expect(snapshot.bill.outstanding).toBe(1390000 + 620000);
  });
});

describe('pagar por ítems: completo, mitad o tercio (US05)', () => {
  it('una porción reservada desaparece para el resto de la mesa', () => {
    const { join, order, domain, db } = setup();
    const fede = join('Fede');
    const meli = join('Meli');
    const [burger] = order(fede, ['Doble carne']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    expect(() => domain.diners.claimPortion(meli, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 })).toThrowError(
      /no quedan porciones/,
    );
    expect(() => domain.diners.claimPortion(meli, { orderItemId: burger!.id, unitIndex: 0, denominator: 2 })).toThrowError(
      /se está pagando en completo/,
    );
    assertLedgerInvariant(db, fede.sessionId);
  });

  it('la primera porción define la fracción de la unidad', () => {
    const { join, order, domain, db, bill } = setup();
    const [a, b, c] = [join('Ana'), join('Beto'), join('Caro')];
    const [papas] = order(a, ['Papas fritas']);
    const ref = { orderItemId: papas!.id, unitIndex: 0 };
    domain.diners.claimPortion(a, { ...ref, denominator: 2 });
    expect(() => domain.diners.claimPortion(b, { ...ref, denominator: 3 })).toThrowError(/mitades/);
    domain.diners.claimPortion(b, { ...ref, denominator: 2 });
    expect(() => domain.diners.claimPortion(c, { ...ref, denominator: 2 })).toThrowError(/no quedan porciones/);
    expect(bill(a.sessionId).reserved).toBe(890000);
    const unit = domain.diners.snapshot(a.sessionId).items[0]!.units[0]!;
    expect(unit.denominator).toBe(2);
    expect(unit.portions.map((p) => [p.state, p.dinerId])).toEqual([
      ['RESERVED', a.id],
      ['RESERVED', b.id],
    ]);
    assertLedgerInvariant(db, a.sessionId);
  });

  it('cada unidad de un ítem con cantidad se paga por separado y los tercios suman el precio exacto', () => {
    const { join, order, domain, bill } = setup();
    const [a, b] = [join('Ana'), join('Beto')];
    const [ipas] = order(a, ['Pinta IPA', 3]);
    domain.diners.claimPortion(a, { orderItemId: ipas!.id, unitIndex: 0, denominator: 1 });
    domain.diners.claimPortion(b, { orderItemId: ipas!.id, unitIndex: 1, denominator: 3 });
    domain.diners.claimPortion(b, { orderItemId: ipas!.id, unitIndex: 1, denominator: 3 });
    const pay = domain.diners.claimPortion(a, { orderItemId: ipas!.id, unitIndex: 1, denominator: 3 });
    expect(pay.claims).toHaveLength(2);
    expect(bill(a.sessionId).reserved).toBe(620000 * 2);
    expect(bill(a.sessionId).unclaimed).toBe(620000);
  });

  it('soltar la última porción cancela la selección', () => {
    const { join, order, domain, bill } = setup();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 2 });
    const left = domain.diners.releasePortion(fede, { orderItemId: burger!.id, unitIndex: 0, portionIndex: 0 });
    expect(left).toBeNull();
    expect(domain.diners.currentPayment(fede)).toBeUndefined();
    expect(bill(fede.sessionId).unclaimed).toBe(1390000);
  });

  it('"agrupar": toma todo lo libre de lo que pidió otra persona', () => {
    const { join, order, domain, bill } = setup();
    const fede = join('Fede');
    const meli = join('Meli');
    order(fede, ['Doble carne'], ['Pinta IPA']);
    order(meli, ['Veggie'], ['Pinta Honey', 2]);
    const own = domain.diners.claimItemsOf(fede, fede.id);
    expect(own.claims).toHaveLength(2);
    const both = domain.diners.claimItemsOf(fede, meli.id);
    expect(both.id).toBe(own.id);
    expect(both.claims).toHaveLength(5);
    expect(bill(fede.sessionId).reserved).toBe(bill(fede.sessionId).total);
    expect(() => domain.diners.claimItemsOf(meli, meli.id)).toThrowError(/No queda nada libre/);
  });
});

describe('liberación automática a 1 minuto (US06)', () => {
  it('una reserva sin confirmar vuelve a estar disponible', () => {
    const { join, order, domain, advance, bill } = setup();
    const fede = join('Fede');
    const meli = join('Meli');
    const [burger] = order(fede, ['Doble carne']);
    const payment = domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    advance(59);
    domain.ctx.expireDue();
    expect(payment.status).toBe('RESERVED');
    advance(2);
    domain.ctx.expireDue();
    expect(payment.status).toBe('EXPIRED');
    expect(bill(fede.sessionId).reserved).toBe(0);
    // Ahora otro puede tomarla.
    domain.diners.claimPortion(meli, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
  });

  it('cada cambio en la selección reinicia el minuto', () => {
    const { join, order, domain, advance } = setup();
    const fede = join('Fede');
    const [burger, ipa] = order(fede, ['Doble carne'], ['Pinta IPA']);
    const payment = domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    advance(50);
    domain.diners.claimPortion(fede, { orderItemId: ipa!.id, unitIndex: 0, denominator: 1 });
    advance(50);
    domain.ctx.expireDue();
    expect(payment.status).toBe('RESERVED');
    advance(11);
    domain.ctx.expireDue();
    expect(payment.status).toBe('EXPIRED');
  });

  it('si venció mientras transfería, "Ya pagué" se acepta si nadie tomó esas porciones', () => {
    const { join, order, domain, advance, bill } = setup();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne']);
    const payment = domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    domain.diners.chooseMethod(fede, 'MERCADO_PAGO');
    advance(120);
    domain.ctx.expireDue();
    expect(payment.status).toBe('EXPIRED');
    domain.diners.confirmPayment(fede, payment.id);
    expect(payment.status).toBe('PAID');
    expect(bill(fede.sessionId).outstanding).toBe(0);
  });

  it('...y se rechaza si otra persona ya las tomó', () => {
    const { join, order, domain, advance } = setup();
    const fede = join('Fede');
    const meli = join('Meli');
    const [burger] = order(fede, ['Doble carne']);
    const payment = domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    domain.diners.chooseMethod(fede, 'QR');
    advance(61);
    domain.diners.claimPortion(meli, { orderItemId: burger!.id, unitIndex: 0, denominator: 2 });
    expect(() => domain.diners.confirmPayment(fede, payment.id)).toThrowError(/otra persona tomó/);
  });
});

describe('medios de pago (US08, US09, US11)', () => {
  it('Mercado Pago / QR: el comensal confirma y la porción pasa a Abonada', () => {
    const { join, order, domain, bill } = setup();
    const fede = join('Fede');
    const [burger, ipa] = order(fede, ['Doble carne'], ['Pinta IPA']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    const payment = domain.diners.chooseMethod(fede, 'MERCADO_PAGO', 10);
    domain.diners.confirmPayment(fede, payment.id);
    expect(payment.status).toBe('PAID');
    expect(payment.confirmedBy).toBe('DINER');
    const summary = bill(fede.sessionId);
    expect(summary.paid).toBe(1390000);
    expect(summary.tips).toBe(139000);
    expect(summary.outstanding).toBe(ipa!.unitPrice);
    const portion = domain.diners.snapshot(fede.sessionId).items[0]!.units[0]!.portions[0]!;
    expect(portion.state).toBe('PAID');
  });

  it('no se puede confirmar sin elegir medio, ni con propina inválida', () => {
    const { join, order, domain } = setup();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne']);
    const payment = domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    expect(() => domain.diners.confirmPayment(fede, payment.id)).toThrowError(/Elegí primero/);
    expect(() => domain.diners.chooseMethod(fede, 'QR', 7)).toThrowError(/propina/);
  });

  it('Posnet: avisa al mozo, retiene la reserva y solo el mozo confirma', () => {
    const { join, order, domain, advance, events, admin, bill } = setup();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    const payment = domain.diners.chooseMethod(fede, 'POSNET');
    expect(payment.status).toBe('AWAITING_POSNET');
    expect(events.posnetRequested).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: payment.id, tableNumber: 1, amount: 1390000, dinerName: 'Fede' }),
    );
    expect(domain.staff.posnetAlerts()).toHaveLength(1);
    advance(600);
    domain.ctx.expireDue();
    expect(payment.status).toBe('AWAITING_POSNET');
    expect(() => domain.diners.confirmPayment(fede, payment.id)).toThrowError(/los confirma el mozo/);
    domain.staff.confirmPosnet(admin, payment.id);
    expect(payment.status).toBe('PAID');
    expect(payment.confirmedBy).toBe('STAFF');
    expect(bill(fede.sessionId).outstanding).toBe(0);
    expect(domain.staff.posnetAlerts()).toHaveLength(0);
  });

  it('el mozo puede rechazar un pedido de Posnet y la porción se libera', () => {
    const { join, order, domain, bill } = setup();
    const fede = join('Fede');
    const [burger] = order(fede, ['Doble carne']);
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    const payment = domain.diners.chooseMethod(fede, 'POSNET');
    domain.staff.rejectPosnet(payment.id);
    expect(payment.status).toBe('CANCELLED');
    expect(bill(fede.sessionId).unclaimed).toBe(1390000);
  });
});

describe('dividir el total (US07)', () => {
  it('reparte el saldo pendiente actual, no el total original', () => {
    const { join, order, domain, bill, db } = setup();
    const [fede, meli, tomi] = [join('Fede'), join('Meli'), join('Tomi')];
    const [burger] = order(fede, ['Triple carne']);
    order(meli, ['Pinta IPA', 3], ['Papas fritas']);
    // Fede paga su hamburguesa aparte.
    domain.diners.claimPortion(fede, { orderItemId: burger!.id, unitIndex: 0, denominator: 1 });
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'QR').id);

    const pending = bill(fede.sessionId).outstanding;
    expect(pending).toBe(3 * 620000 + 890000);
    const first = domain.diners.startSplit(meli, 3);
    const split = domain.diners.snapshot(meli.sessionId).activeSplit!;
    expect(split.total).toBe(pending);
    expect(split.shares.map((s) => s.amount).reduce((a, b) => a + b, 0)).toBe(pending);
    expect(first.shareIndices).toEqual([0]);
    assertLedgerInvariant(db, fede.sessionId);

    // Mientras hay división, lo cubierto no se puede elegir por ítems.
    expect(() => domain.diners.claimItemsOf(tomi, meli.id)).toThrowError(/No queda nada libre/);
    expect(() => domain.diners.startSplit(tomi, 2)).toThrowError(/Ya hay una división/);

    domain.diners.takeShares(tomi, 2);
    domain.diners.confirmPayment(meli, domain.diners.chooseMethod(meli, 'MERCADO_PAGO').id);
    domain.diners.confirmPayment(tomi, domain.diners.chooseMethod(tomi, 'QR').id);
    const done = domain.diners.snapshot(fede.sessionId);
    expect(done.bill.outstanding).toBe(0);
    expect(done.settled).toBe(true);
    expect(done.activeSplit).toBeNull();
    expect(db.splits[0]!.status).toBe('COMPLETED');
    expect(db.sessions[0]!.settledAt).not.toBeNull();
    assertLedgerInvariant(db, fede.sessionId);
  });

  it('lo que se pide después de dividir queda afuera de la división', () => {
    const { join, order, domain, bill } = setup();
    const [fede, meli] = [join('Fede'), join('Meli')];
    order(fede, ['Pinta IPA', 2]);
    domain.diners.startSplit(fede, 2);
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'QR').id);
    const [postre] = order(meli, ['Brownie con helado']);
    const snapshot = domain.diners.snapshot(fede.sessionId);
    expect(snapshot.activeSplit!.total).toBe(2 * 620000);
    expect(snapshot.bill.outstanding).toBe(620000 + postre!.unitPrice);
    // El postre se puede pagar por ítem aunque la división siga abierta.
    domain.diners.claimPortion(meli, { orderItemId: postre!.id, unitIndex: 0, denominator: 1 });
    expect(bill(fede.sessionId).reserved).toBe(postre!.unitPrice);
  });

  it('una división que nadie pagó se disuelve cuando vence su única reserva, y "Ya pagué" la reactiva', () => {
    const { join, order, domain, advance, db, bill } = setup();
    const fede = join('Fede');
    order(fede, ['Pinta IPA', 4]);
    const payment = domain.diners.startSplit(fede, 4);
    domain.diners.chooseMethod(fede, 'MERCADO_PAGO');
    advance(61);
    domain.ctx.expireDue();
    expect(db.splits[0]!.status).toBe('DISSOLVED');
    expect(bill(fede.sessionId).unclaimed).toBe(4 * 620000);

    domain.diners.confirmPayment(fede, payment.id);
    expect(db.splits[0]!.status).toBe('ACTIVE');
    expect(bill(fede.sessionId).outstanding).toBe(3 * 620000);
    assertLedgerInvariant(db, fede.sessionId);
  });

  it('se puede cancelar mientras nadie pagó una parte', () => {
    const { join, order, domain, db } = setup();
    const [fede, meli] = [join('Fede'), join('Meli')];
    order(fede, ['Pinta IPA', 2]);
    domain.diners.startSplit(fede, 2);
    domain.diners.takeShares(meli, 1);
    expect(() => domain.diners.cancelSplit(fede)).toThrowError(/Otra persona/);
    domain.diners.takeShares(meli, 0);
    domain.diners.cancelSplit(fede);
    expect(db.splits[0]!.status).toBe('DISSOLVED');
    expect(domain.diners.currentPayment(fede)).toBeUndefined();
  });

  it('"pagar todo" es dividir entre 1', () => {
    const { join, order, domain, bill } = setup();
    const fede = join('Fede');
    order(fede, ['Pinta IPA', 2], ['Papas cheddar y bacon']);
    const payment = domain.diners.startSplit(fede, 1);
    domain.diners.confirmPayment(fede, domain.diners.chooseMethod(fede, 'QR').id);
    expect(payment.status).toBe('PAID');
    expect(bill(fede.sessionId).outstanding).toBe(0);
  });

  it('un comensal tiene un solo pago en curso por vez', () => {
    const { join, order, domain } = setup();
    const fede = join('Fede');
    const [ipa] = order(fede, ['Pinta IPA', 2]);
    domain.diners.claimPortion(fede, { orderItemId: ipa!.id, unitIndex: 0, denominator: 1 });
    expect(() => domain.diners.startSplit(fede, 2)).toThrowError(/pago en curso/);
  });
});

describe('invariantes con operaciones aleatorias', () => {
  it.each([42, 7, 1234, 98765, 31337])('ningún centavo se pierde ni se duplica (semilla %i)', (initialSeed) => {
    const { join, order, domain, advance, db, admin } = setup();
    // mulberry32: PRNG determinístico para que el test sea reproducible.
    let seed = initialSeed;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * n | 0;
    };
    const diners = ['Ana', 'Beto', 'Caro', 'Dani'].map((n) => join(n));
    const names = ['Pinta IPA', 'Papas fritas', 'Doble carne', 'Muzzarella', 'Agua con o sin gas'];
    const sessionId = diners[0]!.sessionId;
    for (let step = 0; step < 600; step++) {
      const diner = diners[rand(diners.length)]!;
      const items = db.orderItems.filter((i) => i.sessionId === sessionId && i.status !== 'CANCELLED');
      try {
        switch (rand(10)) {
          case 0:
            order(diner, [names[rand(names.length)]!, 1 + rand(3)]);
            break;
          case 1:
          case 2: {
            const item = items[rand(Math.max(items.length, 1))];
            if (item)
              domain.diners.claimPortion(diner, {
                orderItemId: item.id,
                unitIndex: rand(item.quantity),
                denominator: (1 + rand(3)) as 1 | 2 | 3,
              });
            break;
          }
          case 3:
            domain.diners.startSplit(diner, 1 + rand(4));
            break;
          case 4:
            domain.diners.takeShares(diner, rand(3));
            break;
          case 5:
            domain.diners.chooseMethod(diner, (['MERCADO_PAGO', 'QR', 'POSNET'] as const)[rand(3)]!);
            break;
          case 6: {
            const p = domain.diners.currentPayment(diner);
            if (p) domain.diners.confirmPayment(diner, p.id);
            break;
          }
          case 7:
            advance(rand(90));
            domain.ctx.expireDue();
            break;
          case 8: {
            const alert = domain.staff.posnetAlerts()[0];
            if (alert) domain.staff.confirmPosnet(admin, alert.paymentId);
            break;
          }
          case 9: {
            const paid = db.payments.filter((p) => p.status === 'PAID');
            const victim = paid[rand(Math.max(paid.length, 1))];
            if (victim && rand(4) === 0) domain.staff.voidPayment(admin, victim.id);
            break;
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error)) throw error;
      }
      assertLedgerInvariant(db, sessionId);
    }
    expect(db.payments.length).toBeGreaterThan(20);
  });
});
