/**
 * Structured logging.
 *
 * Railway shows one line per log entry and gives you full-text search over them.
 * That only helps if the lines are greppable, so every entry is a single JSON
 * object with a stable `event` name. Events that need a human are prefixed
 * `ACTION_REQUIRED.` — that one string is the alert filter to configure.
 *
 * Never pass a token, a key or a raw customer phone number in `fields`.
 */
type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
  /** Something a person has to fix. Alert on the `ACTION_REQUIRED.` prefix. */
  actionRequired: (event: string, fields?: Fields) => emit("error", `ACTION_REQUIRED.${event}`, fields),
};

/** Error messages are logged, so they must never carry a secret or a full payload. */
export function errorMessage(error: unknown, fallback = "unknown_error"): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 300);
}
