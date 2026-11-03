import type { SmtpSessionStore } from "./smtp-sessions.js";

/** Record a completed TLS handshake on the existing SMTP connection, never a new session. */
export function recordSecuredConnection(
  session: object,
  ids: WeakMap<object, string>,
  history: Pick<SmtpSessionStore, "updateTls">,
  onRecorded: (id: string) => void,
): void {
  const id = ids.get(session);
  // Implicit SMTPS may invoke onSecure before onConnect; onConnect marks it secure.
  if (!id) return;
  history.updateTls(id, true);
  onRecorded(id);
}
