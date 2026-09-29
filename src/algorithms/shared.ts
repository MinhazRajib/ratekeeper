/** Throws unless `value` is a finite number strictly greater than zero. */
export function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0, got ${String(value)}`);
  }
}

/** Throws unless `value` is a positive integer. */
export function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be an integer > 0, got ${String(value)}`);
  }
}

/** Aligns `now` to the start of its fixed window. */
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}
