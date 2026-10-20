/** An expected failure: printed as "error: <message>" with exit code 1. */
export class CliError extends Error {
  override name = 'CliError';
}

/** Runs node:util parseArgs and turns its errors into CliErrors. */
export function cliArgs<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    throw new CliError(err instanceof Error ? err.message : String(err));
  }
}

export function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new CliError(`${flag} is required`);
  return value;
}

export function intArg(value: string, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new CliError(`${flag} must be a whole number from ${min} to ${max}`);
  }
  return n;
}
