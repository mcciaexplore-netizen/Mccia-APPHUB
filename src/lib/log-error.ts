/**
 * What goes in the server logs when something fails: where it happened, the error's code (a database or network code such as 23505 or
 * ECONNREFUSED) and the first line of its message, cut short. Never the error object itself: a database error carries the query and its
 * parameters (names, emails, file contents) and a stack, and the logs are read by more people and kept longer than the data needs.
 */
export function errorSummary(e: unknown): string {
  const x = (e ?? {}) as { code?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = typeof x.code === "string" ? x.code : typeof x.cause?.code === "string" ? x.cause.code : null;
  // A query error from the database layer says "Failed query: <sql>" with the parameters below it; the driver's own message (its cause)
  // is the useful, value-free part, so prefer it.
  const raw = typeof x.cause?.message === "string" ? x.cause.message : e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
  const msg = raw.split("\n")[0].trim().slice(0, 160);
  return `${code ? `[${code}] ` : ""}${msg || "unknown error"}`;
}

/** Logs a failure as errorSummary describes, under a short label saying where it happened. */
export const logError = (where: string, e: unknown) => console.error(`${where}: ${errorSummary(e)}`);
