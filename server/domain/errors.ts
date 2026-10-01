export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} no existe.`, 404);
export const forbidden = (message = 'No tenés permisos para hacer esto.') => new AppError('FORBIDDEN', message, 403);
export const unauthorized = (message = 'Tenés que iniciar sesión.') => new AppError('UNAUTHORIZED', message, 401);
