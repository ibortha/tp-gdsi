import type { ApiErrorBody } from '../../../shared/types.ts';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  dinerToken?: string | null;
  staffToken?: string | null;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.dinerToken) headers['x-diner-token'] = options.dinerToken;
  if (options.staffToken) headers.authorization = `Bearer ${options.staffToken}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('NETWORK', 'No hay conexión con el servidor. Revisá tu internet.', 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(error?.code ?? 'HTTP_ERROR', error?.message ?? `Error ${res.status}`, res.status);
  }
  return data as T;
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
