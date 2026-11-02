/**
 * Outcome of an operation that can fail in an expected way (bad input,
 * network error, unsupported site). Expected failures are returned, not thrown.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
