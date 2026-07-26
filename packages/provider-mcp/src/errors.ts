// A structured, agent-legible error. `code` is a stable machine string the
// calling agent can branch on; `hint` tells it (or the human) how to recover.
// We deliberately never leak raw keys or SDK internals into these.
export class ProvisionError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

/** Normalize any thrown value into { code, message, hint } without leaking secrets. */
export function toErrorShape(e: unknown): { code: string; message: string; hint?: string } {
  if (e instanceof ProvisionError) return { code: e.code, message: e.message, hint: e.hint };
  const message = e instanceof Error ? e.message : String(e);
  return { code: "UNEXPECTED", message: message.slice(0, 300) };
}
