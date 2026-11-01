import { Fault, type Sandbox } from "./core.js";
import type { SmtpSessionStore } from "./smtp-sessions.js";

export const CONNECTION_PROBE_DOMAIN = "virtual.inbox";
export const CONNECTION_PROBE_TTL_SECONDS = 60;

/** A random 128-bit token prevents another test from guessing an ephemeral probe inbox. */
export function isConnectionProbeAddress(address: string): boolean {
  return address.toLowerCase().endsWith("@" + CONNECTION_PROBE_DOMAIN);
}

export function validateConnectionProbeAddress(address: string): void {
  if (!/^[a-f0-9]{32}@virtual\.inbox$/i.test(address))
    throw new Fault(400, "Connection probe address must have a 32-character hexadecimal nonce", "INVALID_CONNECTION_PROBE");
}

/** The request is an empty SMTP message. Headers other than Subject are permitted. */
export function validateConnectionProbeMessage(
  recipients: string[], subject: string | undefined, text: string | undefined,
  html: string | undefined, attachments: readonly unknown[],
): void {
  if (recipients.length !== 1 || !isConnectionProbeAddress(recipients[0]))
    throw new Fault(400, "Connection probes require one dedicated SMTP recipient", "INVALID_CONNECTION_PROBE");
  if (subject !== undefined || !!text?.trim() || !!html?.trim() || attachments.length > 0)
    throw new Fault(400, "Connection probe requests must have no subject, body, HTML or attachments", "INVALID_CONNECTION_PROBE");
}

/** Create once and never renew the TTL on a subsequent request to the same address. */
export function deliverConnectionProbe(
  sandbox: Sandbox, smtpSessions: SmtpSessionStore, address: string, smtpSessionId: string,
): string {
  validateConnectionProbeAddress(address);
  sandbox.cleanup();
  let inbox = sandbox.find("email", address);
  if (!inbox) inbox = sandbox.create("email", address, CONNECTION_PROBE_TTL_SECONDS);
  const session = smtpSessions.getSession(smtpSessionId);
  if (!session) throw new Fault(404, "SMTP connection not found", "SMTP_SESSION_NOT_FOUND");
  const response = {
    protocol: "SMTP",
    clientId: session.authenticated ? session.clientId : null,
    smtpSessionId,
    authenticated: session.authenticated,
    secure: session.secure,
    sessions: (session.authenticated
      ? smtpSessions.listSessions(session.clientId)
      : [session]).map((entry) => ({
        smtpSessionId: entry.id,
        connectedAt: entry.connectedAt,
        disconnectedAt: entry.disconnectedAt ?? null,
        connected: entry.connected,
        current: entry.id === smtpSessionId,
      })),
  };
  const message = sandbox.deliver("email", "connection@virtual.inbox", address,
    JSON.stringify(response), undefined, undefined, undefined, [], { smtpSessionId });
  smtpSessions.recordMessage(smtpSessionId, message.id);
  return message.id;
}
