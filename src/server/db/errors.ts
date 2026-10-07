/** SQLSTATE codes we react to. https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const PG_ERROR = {
  uniqueViolation: "23505",
  exclusionViolation: "23P01",
} as const;

type PgError = { code: string; constraint_name?: string };

function isPgError(value: unknown): value is PgError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

/**
 * Finds the underlying Postgres error. Drizzle wraps driver errors in its own
 * error type with the original one in `cause`, so we walk the cause chain.
 */
export function findPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (isPgError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isConstraintViolation(
  error: unknown,
  code: (typeof PG_ERROR)[keyof typeof PG_ERROR],
  constraint?: string,
): boolean {
  const pgError = findPgError(error);
  if (!pgError || pgError.code !== code) return false;
  return constraint === undefined || pgError.constraint_name === constraint;
}
