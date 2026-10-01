import { AdminService } from './admin-service.ts';
import { Context, type ContextOptions } from './context.ts';
import { DinerService } from './diner-service.ts';
import { computeMetrics } from './metrics.ts';
import type { DB } from './model.ts';
import { StaffService } from './staff-service.ts';

export function createDomain(db: DB, options: ContextOptions = {}) {
  const ctx = new Context(db, options);
  return {
    ctx,
    diners: new DinerService(ctx),
    staff: new StaffService(ctx),
    admin: new AdminService(ctx),
    metrics: () => computeMetrics(ctx.db),
  };
}

export type Domain = ReturnType<typeof createDomain>;
