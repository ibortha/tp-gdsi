// API HTTP. Valida la entrada con zod y delega todo en los servicios de dominio.
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ApiErrorBody, Role, VenuePublic } from '../../shared/types.ts';
import { toStaffDTO } from '../domain/dto.ts';
import { AppError, forbidden } from '../domain/errors.ts';
import type { Domain } from '../domain/index.ts';
import type { StaffUser } from '../domain/model.ts';

export interface HttpOptions {
  /** Carpeta con el cliente compilado (producción). */
  clientDir?: string;
  /** Expone el listado de mesas en la portada para probar sin imprimir QRs. */
  demo: boolean;
}

const id = z.string().min(1).max(100);
const cents = z.number().int().min(0).max(1_000_000_000);
const denominator = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const schemas = {
  join: z.object({ name: z.string().max(100) }),
  order: z.object({
    items: z
      .array(z.object({ menuItemId: id, quantity: z.number().int(), note: z.string().max(140).optional() }))
      .min(1)
      .max(30),
    note: z.string().max(200).optional(),
  }),
  claim: z.object({ orderItemId: id, unitIndex: z.number().int(), denominator }),
  release: z.object({ orderItemId: id, unitIndex: z.number().int(), portionIndex: z.number().int() }),
  split: z.object({ parts: z.number().int(), take: z.number().int().optional() }),
  take: z.object({ count: z.number().int() }),
  method: z.object({ method: z.enum(['MERCADO_PAGO', 'QR', 'POSNET']), tipPercent: z.number().int().min(0).max(100).optional() }),
  login: z.object({ email: z.string().max(200), password: z.string().max(200) }),
  itemStatus: z.object({ status: z.enum(['PENDING', 'PREPARING', 'DELIVERED', 'CANCELLED']) }),
  charge: z.object({ method: z.enum(['POSNET', 'CASH']) }),
  close: z.object({ force: z.boolean().optional() }),
  category: z.object({ name: z.string().max(60), sort: z.number().int().optional() }),
  menuItem: z.object({
    categoryId: id,
    name: z.string().max(80),
    description: z.string().max(400),
    price: cents,
    promoPrice: cents.nullable(),
    promoLabel: z.string().max(30).nullable(),
    // Admite URL o una foto chica subida como data URL.
    imageUrl: z.string().max(700_000).nullable(),
    available: z.boolean(),
    sort: z.number().int().optional(),
  }),
  table: z.object({ number: z.number().int(), label: z.string().max(40).optional(), active: z.boolean().optional() }),
  staff: z.object({
    name: z.string().max(60),
    email: z.email().max(200),
    role: z.enum(['ADMIN', 'MOZO']),
    password: z.string().max(200).optional(),
    active: z.boolean().optional(),
  }),
  venue: z.object({
    name: z.string().max(80),
    mpLink: z.string().max(500),
    mpAlias: z.string().max(100),
    cobroQrData: z.string().max(1000),
    reservationTtlSec: z.number().int(),
    tipOptions: z.array(z.number().int()).max(4),
    publicUrl: z.string().max(300),
  }),
};

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    throw new AppError('INVALID_INPUT', `Datos inválidos${where}: ${issue?.message ?? 'revisá el formulario'}.`);
  }
  return result.data;
}

const bearer = (req: Request) => req.header('authorization')?.replace(/^Bearer\s+/i, '') || undefined;

export function createHttpApp(domain: Domain, options: HttpOptions) {
  const { diners, staff, admin } = domain;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const diner = (req: Request) => diners.authenticate(req.header('x-diner-token') ?? undefined);
  const staffUser = (req: Request, roles: Role[] = ['ADMIN', 'MOZO']): StaffUser => {
    const user = staff.authenticate(bearer(req));
    if (!roles.includes(user.role)) throw forbidden('Esta sección es solo para el ADMIN.');
    return user;
  };
  const isAdmin = (req: Request) => staffUser(req, ['ADMIN']);
  const snapshotOf = (sessionId: string) => diners.snapshot(sessionId);

  // ---------- Público ----------

  app.get('/api/public/config', (_req, res) => {
    const { publicUrl: _ignored, ...venue } = admin.venue();
    res.json(venue satisfies VenuePublic);
  });

  app.get('/api/public/menu', (_req, res) => {
    res.json(diners.menu());
  });

  app.get('/api/public/tables/:qr', (req, res) => {
    res.json(diners.tableInfo(req.params.qr));
  });

  app.post('/api/public/tables/:qr/join', (req, res) => {
    const { name } = parse(schemas.join, req.body);
    const { token, diner: d, sessionId } = diners.join(req.params.qr, name);
    res.status(201).json({ token, dinerId: d.id, sessionId, snapshot: snapshotOf(sessionId) });
  });

  app.get('/api/public/demo', (_req, res) => {
    if (!options.demo) throw new AppError('NOT_FOUND', 'No disponible.', 404);
    res.json({
      venueName: admin.venue().name,
      tables: staff.tables().filter((t) => t.active).map((t) => ({ number: t.number, label: t.label, qrToken: t.qrToken, diners: t.session?.diners ?? 0 })),
    });
  });

  // ---------- Comensal ----------

  app.get('/api/diner/me', (req, res) => {
    const d = diner(req);
    res.json({ dinerId: d.id, sessionId: d.sessionId, snapshot: snapshotOf(d.sessionId) });
  });

  app.post('/api/diner/orders', (req, res) => {
    const d = diner(req);
    const body = parse(schemas.order, req.body);
    diners.placeOrder(d, body.items, body.note);
    res.status(201).json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/claims', (req, res) => {
    const d = diner(req);
    diners.claimPortion(d, parse(schemas.claim, req.body));
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/claims/release', (req, res) => {
    const d = diner(req);
    diners.releasePortion(d, parse(schemas.release, req.body));
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/claims/of/:dinerId', (req, res) => {
    const d = diner(req);
    diners.claimItemsOf(d, req.params.dinerId);
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/split', (req, res) => {
    const d = diner(req);
    const { parts, take } = parse(schemas.split, req.body);
    diners.startSplit(d, parts, take ?? 1);
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/split/take', (req, res) => {
    const d = diner(req);
    diners.takeShares(d, parse(schemas.take, req.body).count);
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/split/cancel', (req, res) => {
    const d = diner(req);
    diners.cancelSplit(d);
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/payment/method', (req, res) => {
    const d = diner(req);
    const { method, tipPercent } = parse(schemas.method, req.body);
    diners.chooseMethod(d, method, tipPercent ?? 0);
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/payments/:id/confirm', (req, res) => {
    const d = diner(req);
    diners.confirmPayment(d, req.params.id);
    res.json(snapshotOf(d.sessionId));
  });

  app.post('/api/diner/payments/:id/cancel', (req, res) => {
    const d = diner(req);
    diners.cancelPayment(d, req.params.id);
    res.json(snapshotOf(d.sessionId));
  });

  // ---------- Staff (mozo y ADMIN) ----------

  app.post('/api/staff/login', (req, res) => {
    const { email, password } = parse(schemas.login, req.body);
    const { token, user } = staff.login(email, password);
    res.json({ token, user: toStaffDTO(user) });
  });

  app.post('/api/staff/logout', (req, res) => {
    const token = bearer(req);
    if (token) staff.logout(token);
    res.status(204).end();
  });

  app.get('/api/staff/me', (req, res) => {
    res.json(toStaffDTO(staffUser(req)));
  });

  app.get('/api/staff/tables', (req, res) => {
    staffUser(req);
    res.json(staff.tables());
  });

  app.get('/api/staff/tables/:id', (req, res) => {
    staffUser(req);
    res.json(staff.tableDetail(req.params.id));
  });

  app.get('/api/staff/kitchen', (req, res) => {
    staffUser(req);
    res.json(staff.kitchen());
  });

  app.get('/api/staff/posnet', (req, res) => {
    staffUser(req);
    res.json(staff.posnetAlerts());
  });

  app.post('/api/staff/items/:id/status', (req, res) => {
    staffUser(req);
    staff.setItemStatus(req.params.id, parse(schemas.itemStatus, req.body).status);
    res.status(204).end();
  });

  app.post('/api/staff/payments/:id/confirm-posnet', (req, res) => {
    staff.confirmPosnet(staffUser(req), req.params.id);
    res.status(204).end();
  });

  app.post('/api/staff/payments/:id/reject-posnet', (req, res) => {
    staffUser(req);
    staff.rejectPosnet(req.params.id);
    res.status(204).end();
  });

  app.post('/api/staff/payments/:id/void', (req, res) => {
    staff.voidPayment(staffUser(req), req.params.id);
    res.status(204).end();
  });

  app.post('/api/staff/sessions/:id/charge', (req, res) => {
    staff.chargeRemaining(staffUser(req), req.params.id, parse(schemas.charge, req.body).method);
    res.status(204).end();
  });

  app.post('/api/staff/sessions/:id/close', (req, res) => {
    staffUser(req);
    staff.closeSession(req.params.id, parse(schemas.close, req.body).force ?? false);
    res.status(204).end();
  });

  app.post('/api/staff/splits/:id/dissolve', (req, res) => {
    staffUser(req);
    staff.dissolveSplit(req.params.id);
    res.status(204).end();
  });

  // ---------- ADMIN ----------

  app.post('/api/admin/categories', (req, res) => {
    isAdmin(req);
    res.status(201).json(admin.createCategory(parse(schemas.category, req.body).name));
  });

  app.patch('/api/admin/categories/:id', (req, res) => {
    isAdmin(req);
    res.json(admin.updateCategory(req.params.id, parse(schemas.category.partial(), req.body)));
  });

  app.delete('/api/admin/categories/:id', (req, res) => {
    isAdmin(req);
    admin.deleteCategory(req.params.id);
    res.status(204).end();
  });

  app.post('/api/admin/items', (req, res) => {
    isAdmin(req);
    res.status(201).json(admin.createMenuItem(parse(schemas.menuItem, req.body)));
  });

  app.patch('/api/admin/items/:id', (req, res) => {
    isAdmin(req);
    res.json(admin.updateMenuItem(req.params.id, parse(schemas.menuItem.partial(), req.body)));
  });

  app.delete('/api/admin/items/:id', (req, res) => {
    isAdmin(req);
    admin.deleteMenuItem(req.params.id);
    res.status(204).end();
  });

  app.post('/api/admin/tables', (req, res) => {
    isAdmin(req);
    res.status(201).json(admin.createTable(parse(schemas.table, req.body)));
  });

  app.patch('/api/admin/tables/:id', (req, res) => {
    isAdmin(req);
    res.json(admin.updateTable(req.params.id, parse(schemas.table.partial(), req.body)));
  });

  app.post('/api/admin/tables/:id/regenerate-qr', (req, res) => {
    isAdmin(req);
    res.json(admin.regenerateQr(req.params.id));
  });

  app.delete('/api/admin/tables/:id', (req, res) => {
    isAdmin(req);
    admin.deleteTable(req.params.id);
    res.status(204).end();
  });

  app.get('/api/admin/staff', (req, res) => {
    isAdmin(req);
    res.json(admin.listStaff());
  });

  app.post('/api/admin/staff', (req, res) => {
    isAdmin(req);
    res.status(201).json(admin.createStaff(parse(schemas.staff, req.body)));
  });

  app.patch('/api/admin/staff/:id', (req, res) => {
    const actor = isAdmin(req);
    res.json(admin.updateStaff(actor, req.params.id, parse(schemas.staff.partial(), req.body)));
  });

  app.delete('/api/admin/staff/:id', (req, res) => {
    const actor = isAdmin(req);
    admin.deleteStaff(actor, req.params.id);
    res.status(204).end();
  });

  app.get('/api/admin/venue', (req, res) => {
    isAdmin(req);
    res.json(admin.venue());
  });

  app.put('/api/admin/venue', (req, res) => {
    isAdmin(req);
    res.json(admin.updateVenue(parse(schemas.venue, req.body)));
  });

  app.get('/api/admin/metrics', (req, res) => {
    isAdmin(req);
    res.json(domain.metrics());
  });

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Ruta inexistente.', 404)));

  // ---------- Cliente compilado (producción) ----------

  if (options.clientDir && existsSync(options.clientDir)) {
    const clientDir = options.clientDir;
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(clientDir, 'index.html')));
  }

  app.use((error: unknown, _req: Request, res: Response<ApiErrorBody>, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido.' } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Probá de nuevo.' } });
  });

  return app;
}
