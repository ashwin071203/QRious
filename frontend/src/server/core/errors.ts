/** Client-facing failure with a stable machine-readable code (RFC 9457 ProblemDetails). */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errors?: Record<string, string[]>,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (message = "Not found.", code = "not_found") => new AppError(404, code, message);
export const forbidden = (message: string, code = "forbidden") => new AppError(403, code, message);
export const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) => new AppError(409, code, message, undefined, extra);
export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = "Create your QRious profile to use this feature.", code = "profile_required") => new AppError(401, code, message);

/** Accumulates field errors and throws a single validation_failed error. */
export class FieldErrors {
  private map: Record<string, string[]> = {};
  add(field: string, message: string) {
    (this.map[field] ??= []).push(message);
  }
  has(field: string) {
    return !!this.map[field];
  }
  get any() {
    return Object.keys(this.map).length > 0;
  }
  throwIfAny() {
    if (this.any) throw new AppError(400, "validation_failed", "One or more fields are invalid.", this.map);
  }
}

export function validation(field: string, message: string): AppError {
  return new AppError(400, "validation_failed", "One or more fields are invalid.", { [field]: [message] });
}

/** Finds the underlying PostgreSQL error (drizzle may wrap it). */
export function pgError(e: unknown): { code?: string; constraint?: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = cur as { code?: string; constraint?: string; cause?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

export const isUniqueViolation = (e: unknown, constraint?: string) => {
  const p = pgError(e);
  return p?.code === "23505" && (!constraint || p.constraint === constraint);
};
