import { Fault, type Sandbox, type Message } from "./core.js";
import { config } from "./config.js";
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
  if (!inbox) inbox = sandbox.createConnectionProbe(address);
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

/** Pending probe waits never provision mailboxes and cannot extend their lifetime. */
const pendingProbeWaits = new WeakMap<Sandbox, number>();

export function waitForConnectionProbeMessage(
  sandbox: Sandbox,
  address: string,
  input: { timeoutMs?: number; after?: number },
  signal?: AbortSignal,
): Promise<Message | null> {
  validateConnectionProbeAddress(address);
  const timeoutMs = input.timeoutMs ?? CONNECTION_PROBE_TTL_SECONDS * 1000;
  const after = input.after ?? 0;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > CONNECTION_PROBE_TTL_SECONDS * 1000)
    throw new Fault(400, "Probe wait timeout must be between 1 and 60000 ms", "INVALID_PROBE_WAIT");
  if (!Number.isSafeInteger(after) || after < 0)
    throw new Fault(400, "Invalid message sequence cursor", "INVALID_PROBE_WAIT");
  if (signal?.aborted) return Promise.resolve(null);
  const normalizedAddress = address.toLowerCase();

  const currentInbox = () => {
    try { return sandbox.find("email", address); }
    catch { return undefined; }
  };
  const existing = currentInbox();
  const available = existing && sandbox.listMessages(existing.id).find((message) => message.sequence > after);
  if (available) return Promise.resolve(available);

  const count = pendingProbeWaits.get(sandbox) ?? 0;
  if (count >= config.maxObservers)
    throw new Fault(507, "Too many pending probe wait requests", "CAPACITY_EXCEEDED");
  pendingProbeWaits.set(sandbox, count + 1);
  // The caller gets at most 60 s from its request, never an extended TTL.
  const deadline = Math.min(Date.now() + timeoutMs,
    existing?.expiresAt ? Date.parse(existing.expiresAt) : Number.POSITIVE_INFINITY);
  return new Promise((resolveWait) => {
    let done = false;
    const finish = (message: Message | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sandbox.emitter.off("message", onMessage);
      sandbox.emitter.off("resource.removed", onRemove);
      sandbox.emitter.off("event", onEvent);
      signal?.removeEventListener("abort", onAbort);
      const remaining = (pendingProbeWaits.get(sandbox) ?? 1) - 1;
      if (remaining) pendingProbeWaits.set(sandbox, remaining);
      else pendingProbeWaits.delete(sandbox);
      resolveWait(message);
    };
    const onMessage = (message: Message) => {
      if (message.channel !== "email" || message.sequence <= after ||
          message.originalRecipient.toLowerCase() !== normalizedAddress) return;
      const inbox = currentInbox();
      if (inbox && message.destinationId === inbox.id) finish(message);
    };
    const onRemove = (id: string) => {
      if (existing && id === existing.id) finish(null);
    };
    const onEvent = (event: { type: string; resourceId?: string }) => {
      if (existing && event.type === "recipient.expired" && event.resourceId === existing.id)
        finish(null);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), Math.max(0, deadline - Date.now()));
    sandbox.emitter.on("message", onMessage);
    sandbox.emitter.on("resource.removed", onRemove);
    sandbox.emitter.on("event", onEvent);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) finish(null);
    // Recheck after subscribing to close the creation/delivery race.
    const inbox = currentInbox();
    const raced = inbox && sandbox.listMessages(inbox.id).find((message) => message.sequence > after);
    if (raced) finish(raced);
  });
}
