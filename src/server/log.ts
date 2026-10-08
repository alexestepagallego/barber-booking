import { findPgError } from "@/server/db/errors";

/**
 * A log-safe description of an error. Database errors from Drizzle carry
 * the failed query AND its parameters in their message (customer name,
 * email, phone…), which must never reach the logs: only the error class,
 * the SQLSTATE and the constraint name are kept.
 */
export function describeError(error: unknown): Record<string, string | undefined> {
  const pg = findPgError(error);
  if (pg) {
    return {
      name: "DatabaseError",
      code: pg.code,
      constraint: pg.constraint_name,
    };
  }
  if (error instanceof Error) {
    // Messages of non-database errors are ours or the email provider's and
    // contain no personal data.
    return { name: error.name, message: error.message.slice(0, 300) };
  }
  return { name: typeof error };
}
