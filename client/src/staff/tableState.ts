import type { TableSummaryDTO } from '../../../shared/types.ts';

export type TableState = 'free' | 'busy' | 'paying' | 'posnet' | 'settled';

export function tableState(t: TableSummaryDTO): TableState {
  if (!t.session) return 'free';
  if (t.session.posnetRequests > 0) return 'posnet';
  if (t.session.settled) return 'settled';
  if (t.session.paymentsInProgress > 0 || t.session.bill.paid > 0) return 'paying';
  return 'busy';
}

export const STATE_LABEL: Record<TableState, string> = {
  free: 'Libre',
  busy: 'Ocupada',
  paying: 'Pagando',
  posnet: 'Pide Posnet',
  settled: 'Saldada',
};

export const pad2 = (n: number) => String(n).padStart(2, '0');
