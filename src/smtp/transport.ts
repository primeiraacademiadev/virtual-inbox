/** SMTP and SMTPS adapters, protocol callbacks and deterministic fault delivery. */
import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { Fault, type Attachment } from "../core.js";
import { type SmtpReplyRule, type SmtpReplyPhase } from "../smtp-reply-rules.js";
import { normalizeMimeAttachments } from "../mime/attachments.js";
import { decodedSender } from "../mime/decoded-sender.js";
import PostalMime from "postal-mime";
import { recordSecuredConnection } from "../smtp-session-lifecycle.js";
import { isConnectionProbeAddress, validateConnectionProbeAddress,
  validateConnectionProbeMessage, deliverConnectionProbe } from "../connection-probe.js";
import { protectSmtpSocketErrors } from "../network/socket-errors.js";
import type { SmtpProtocolContext } from "../server.js";

export function createSmtpProtocol(ctx: SmtpProtocolContext) {
  const { sandbox, smtpAuthPolicy, smtpSessions, simulations, smtpAttempts, activeAttempts,
    smtpReplyRules, smtpRuleIdentities, smtpCredentialIds, protocolCounters,
    smtpSessionIds, tlsIdentity, smtpMessageLimit } = ctx;

function smtpFailure(error: unknown): Error & { responseCode: number } {
  const failure = error instanceof Error ? error : new Error(String(error));
  // Permanent message-size rejection must not trigger transport retries.
  const status = error instanceof Fault ? error.status : 500;
  const injected = error as { simulated?: boolean; responseCode?: number } | null;
  const responseCode = injected?.simulated && injected.responseCode ? injected.responseCode
    : error instanceof Fault && error.code === "SIMULATED_SMTP_FAILURE" ? status
    : status === 413 ? 552 : status === 507 ? 452 : status === 400 ? 554 : 451;
  return Object.assign(failure, { responseCode });
}
// smtp-server exposes its active connections, but not a public disconnect-by-session API.
// Keep this version-specific adapter isolated and verify it with an actual SMTP test.
type TransportConnection = {
  session?: { id?: string };
  _socket?: { destroyed?: boolean; destroy(): void; resetAndDestroy?(): void; once(event: "close", cb: () => void): void };
  close(): void;
  send?(code: number, message: string, command?: boolean | string): void;
  handler_EHLO?: (command: Buffer | string, callback: () => void) => void;
  handler_HELO?: (command: Buffer | string, callback: () => void) => void;
};
function transportFor(session: object): TransportConnection | undefined {
  for (const service of [smtp, smtps]) {
    const connections = (service as unknown as { connections?: Set<TransportConnection> } | null)?.connections;
    for (const connection of connections || []) if (connection.session === session) return connection;
  }
  return undefined;
}
function scheduleEarlyFault(connection: TransportConnection, milliseconds: number, action: () => void): void {
  const timer = setTimeout(() => {
    if (!connection._socket?.destroyed) action();
  }, milliseconds);
  connection._socket?.once("close", () => clearTimeout(timer));
}
function earlyFaultApplied(rule: SmtpReplyRule, session: {
  remoteAddress?: string; localPort?: number; remotePort?: number; id?: string;
}, phase: "CONNECT" | "EHLO", name?: string): void {
  const smtpSessionId = smtpSessionIds.get(session);
  const originIp = session.remoteAddress?.replace(/^::ffff:/, "");
  const outcome = rule.action === "reply" ? "rejected"
    : rule.action === "drop" ? "disconnected"
    : rule.action === "reset" ? "reset"
    : rule.action === "hang" ? "timeout-then-disconnect" : "delayed-response";
  sandbox.log("smtp.simulation.applied", undefined, undefined, {
    ruleId: rule.id, scope: rule.scope, priority: rule.priority, selectors: rule.selectors,
    phase, action: rule.action, responseCode: rule.code, durationMs: rule.durationMs,
    smtpSessionId, originIp, originId: originIp ? smtpRuleIdentities.originId(originIp) : undefined,
    localPort: session.localPort, remotePort: session.remotePort,
    ...(name ? { ehloName: name } : {}), outcome,
  });
  if (smtpSessionId) smtpSessions.recordError(smtpSessionId, rule.code ?? 0,
    "SIMULATED_SMTP_" + phase + "_" + rule.action.toUpperCase());
  protocolCounters.error("SMTP", true);
}
/** Version-specific hook: smtp-server does not expose an onEHLO callback. */
function installGreetingRules(session: object): void {
  const connection = transportFor(session);
  if (!connection || !connection.handler_EHLO || !connection.handler_HELO || !connection.send)
    throw new Error("SMTP greeting interception unavailable");
  for (const commandName of ["EHLO", "HELO"] as const) {
    const method = commandName === "EHLO" ? "handler_EHLO" : "handler_HELO";
    const original = connection[method]!.bind(connection);
    connection[method] = (command, callback) => {
      const value = command.toString().trim().split(/\s+/);
      const ehloName = value.length === 2 ? value[1].toLowerCase() : undefined;
      const info = session as { remoteAddress?: string; localPort?: number; remotePort?: number };
      const rule = smtpReplyRules.consume("EHLO", {
        smtpSessionId: smtpSessionIds.get(session),
        originIp: info.remoteAddress?.replace(/^::ffff:/, ""), localPort: info.localPort,
        ehloName,
      });
      if (!rule) return original(command, callback);
      earlyFaultApplied(rule, info, "EHLO", ehloName);
      if (rule.action === "drop") return connection._socket?.destroy();
      if (rule.action === "reset") return resetSmtpTransport(session);
      if (rule.action === "hang") {
        scheduleEarlyFault(connection, rule.durationMs!, () => connection._socket?.destroy());
        return;
      }
      const reply = () => {
        if (rule.code !== undefined) { connection.send!(rule.code, rule.message, false); callback(); }
        else original(command, callback);
      };
      if (rule.action === "delay") scheduleEarlyFault(connection, rule.durationMs!, reply);
      else reply();
    };
  }
}

function resetSmtpTransport(session: object): void {
  const socket = transportFor(session)?._socket;
  if (!socket || socket.destroyed || typeof socket.resetAndDestroy !== "function")
    throw new Fault(503, "TCP reset is not available on this SMTP transport", "SMTP_RESET_UNAVAILABLE");
  socket.resetAndDestroy();
}

function dropSmtpTransport(session: { id?: string }): void {
  for (const service of [smtp, smtps]) {
    const connections = (service as unknown as { connections?: Set<TransportConnection> } | null)?.connections;
    for (const connection of connections || []) {
      if (connection.session === session || connection.session?.id === session.id) {
        if (connection._socket && !connection._socket.destroyed) connection._socket.destroy();
        else connection.close();
        return;
      }
    }
  }
  throw new Fault(503, "SMTP transport is unavailable for fault simulation", "SMTP_TRANSPORT_UNAVAILABLE");
}

const pendingFaultWaits = new Map<string, Set<() => void>>();
function cancelFaultWaits(sessionId: string) {
  for (const cancel of pendingFaultWaits.get(sessionId) || []) cancel();
  pendingFaultWaits.delete(sessionId);
}
function waitForFault(sessionId: string, durationMs: number): Promise<boolean> {
  return new Promise((resolveWait) => {
    let finished = false;
    let callbacks = pendingFaultWaits.get(sessionId);
    if (!callbacks) { callbacks = new Set(); pendingFaultWaits.set(sessionId, callbacks); }
    const finish = (elapsed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      callbacks!.delete(cancel);
      if (!callbacks!.size) pendingFaultWaits.delete(sessionId);
      resolveWait(elapsed);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(() => finish(true), durationMs);
    callbacks.add(cancel);
  });
}
async function applySmtpFault(
  phase: Exclude<SmtpReplyPhase, "AUTH" | "CONNECT" | "EHLO">, session: any, sender?: string, recipients?: string[], persisted = false,
): Promise<boolean> {
  const smtpSessionId = smtpSessionIds.get(session);
  const current = smtpSessionId ? smtpSessions.getSession(smtpSessionId) : undefined;
  const clientId = current?.authenticated ? current.clientId : undefined;
  const seenCredentials = smtpSessionId ? smtpCredentialIds.get(smtpSessionId) : undefined;
  const credentialsId = seenCredentials?.at(-1);
  const originIp = current?.remoteAddress?.replace(/^::ffff:/, "");
  const rule = smtpReplyRules.consume(phase, { sender, recipients, smtpSessionId, clientId,
    originIp, credentialsId, localPort: session.localPort,
    ehloName: typeof session.hostNameAppearsAs === "string" ? session.hostNameAppearsAs : undefined });
  if (!rule) return false;
  const responseCode = rule.code;
  const attemptId=activeAttempts.get(session);
  if(attemptId)smtpAttempts.update(attemptId,{phase,ruleId:rule.id});
  const outcome = rule.action === "reply" ? "rejected"
    : rule.action === "delay" ? (responseCode ? "delayed-rejection" : "delayed-response")
    : rule.action === "drop" ? "disconnected"
    : rule.action === "reset" ? "reset" : "timeout-then-disconnect";
  sandbox.log("smtp.simulation.applied", undefined, undefined, {
    ruleId: rule.id, scope: rule.scope, priority: rule.priority, selectors: rule.selectors,
    phase, action: rule.action, responseCode, durationMs: rule.durationMs,
    originIp, originId: originIp ? smtpRuleIdentities.originId(originIp) : undefined,
    localPort: session.localPort, remotePort: session.remotePort,
    ehloName: session.hostNameAppearsAs, credentialsId,
    smtpSessionId, clientId, sender, recipients, persisted, outcome,
  });
  if (rule.action !== "delay" || responseCode !== undefined) {
    protocolCounters.error("SMTP", true);
    if (smtpSessionId) smtpSessions.recordError(smtpSessionId, responseCode ?? 0,
      "SIMULATED_SMTP_" + rule.action.toUpperCase());
  }
  if (rule.action === "drop" || rule.action === "reset") {
    if (rule.action === "reset") resetSmtpTransport(session);
    else dropSmtpTransport(session);
    return true; // Deliberately suppress the SMTP callback and any final acknowledgement.
  }
  if (rule.action === "hang" || rule.action === "delay") {
    if (!smtpSessionId) throw new Fault(404, "SMTP session unavailable", "SMTP_SESSION_NOT_FOUND");
    const elapsed = await waitForFault(smtpSessionId, rule.durationMs!);
    if (!elapsed) return true; // Client already disconnected; never reply later.
    if (rule.action === "hang") {
      dropSmtpTransport(session);
      return true;
    }
  }
  if (responseCode !== undefined) {
    throw Object.assign(new Error(rule.message), { responseCode, simulated: true });
  }
  return false;
}
const smtpOptions: SMTPServerOptions = {
  authOptional: true,
  onConnect(session, callback) {
    try {
      const id = smtpSessions.connect(session.remoteAddress || "unknown", !!session.secure);
      smtpSessionIds.set(session, id);
      protocolCounters.connect("SMTP");
      sandbox.log("smtp.session.connected", undefined, undefined, { sessionId: id });
      installGreetingRules(session);
      const rule = smtpReplyRules.consume("CONNECT", {
        smtpSessionId: id, originIp: session.remoteAddress?.replace(/^::ffff:/, ""),
        localPort: session.localPort,
      });
      if (!rule) return callback();
      earlyFaultApplied(rule, session, "CONNECT");
      if (rule.action === "drop") { dropSmtpTransport(session); return; }
      if (rule.action === "reset") { resetSmtpTransport(session); return; }
      if (rule.action === "hang") {
        const connection = transportFor(session);
        if (connection) scheduleEarlyFault(connection, rule.durationMs!, () => dropSmtpTransport(session));
        return;
      }
      const finish = () => callback(rule.code === undefined ? undefined :
        Object.assign(new Error(rule.message), { responseCode: rule.code }));
      if (rule.action === "delay") {
        const connection = transportFor(session);
        if (connection) scheduleEarlyFault(connection, rule.durationMs!, finish);
      } else finish();
    } catch (error) {
      callback(Object.assign(new Error(error instanceof Error ? error.message : "SMTP session unavailable"),
        { responseCode: 421 }));
    }
  },
  onClose(session) {
    const id = smtpSessionIds.get(session);
    if (id) {
      cancelFaultWaits(id);
      smtpAttempts.disconnect(id);
      for (const rule of simulations.listConnection(id)) simulations.delete(rule.id);
      smtpSessions.disconnect(id); protocolCounters.disconnect("SMTP");
      sandbox.log("smtp.session.disconnected", undefined, undefined, { sessionId: id });
    }
  },
  // Called after the TLS handshake (STARTTLS or implicit SMTPS).
  // Implicit SMTPS can invoke this before onConnect, which records session.secure.
  onSecure(_socket, session, callback) {
    recordSecuredConnection(session, smtpSessionIds, smtpSessions, id =>
      sandbox.log("smtp.session.secured", undefined, undefined, { sessionId: id }));
    callback();
  },
  // This is a disposable test sandbox, not a credentials validator or public SMTP relay.
  // Supporting AUTH on plaintext matches clients that always authenticate.
  allowInsecureAuth: true,
  authMethods: ["PLAIN", "LOGIN"],
  disabledCommands: tlsIdentity ? [] : ["STARTTLS"],
  size: smtpMessageLimit,
  rejectOversized: true,
  ...(tlsIdentity ? { key: tlsIdentity.key, cert: tlsIdentity.cert, minVersion: "TLSv1.2" as const } : {}),
  onAuth(auth, session, callback) {
    const id = smtpSessionIds.get(session);
    if (!id) return callback(Object.assign(new Error("Unknown SMTP session"), { responseCode: 454 }));
    const credentialsId = smtpRuleIdentities.credentialsId(auth.username || "", auth.password || "");
    const seenCredentials = smtpCredentialIds.get(id) || [];
    if (!seenCredentials.includes(credentialsId)) seenCredentials.push(credentialsId);
    if (seenCredentials.length > 10) seenCredentials.shift();
    smtpCredentialIds.set(id, seenCredentials);
    const current = smtpSessions.getSession(id);
    const originIp = current?.remoteAddress?.replace(/^::ffff:/, "");
    const rule = smtpReplyRules.consume("AUTH", { smtpSessionId: id, credentialsId, originIp,
      localPort: session.localPort,
      ehloName: typeof session.hostNameAppearsAs === "string" ? session.hostNameAppearsAs : undefined });
    if (rule) {
      const responseCode = rule.code!;
      sandbox.log("smtp.simulation.applied", undefined, undefined, {
        ruleId: rule.id, scope: rule.scope, priority: rule.priority, phase: "AUTH",
        action: rule.action, responseCode, smtpSessionId: id,
        originIp, originId: originIp ? smtpRuleIdentities.originId(originIp) : undefined,
        localPort: session.localPort, remotePort: session.remotePort,
        ehloName: session.hostNameAppearsAs, credentialsId, selectors: rule.selectors,
      });
      smtpSessions.recordError(id, responseCode, "SIMULATED_SMTP_AUTH");
      protocolCounters.error("SMTP", true);
      return callback(Object.assign(new Error(rule.message), { responseCode }));
    }
    if (smtpAuthPolicy === "INBOX") {
      let inboxAvailable = false;
      try { inboxAvailable = !!sandbox.find("email", auth.username || ""); } catch { /* expired inbox */ }
      if (!inboxAvailable)
        return callback(Object.assign(new Error("Test inbox unavailable"), { responseCode: 535 }));
    }
    void smtpSessions.authenticate(id, auth.username || "", auth.password || "", auth.method).then(() => {
      protocolCounters.auth("SMTP");
      sandbox.log("smtp.session.authenticated", undefined, undefined, { sessionId: id });
      callback(null, { user: auth.username || "" });
    }).catch(error => {
      const unavailable = error instanceof Fault && error.code === "TEST_INBOX_NOT_FOUND";
      callback(Object.assign(new Error(unavailable ? "Test inbox unavailable" : "Authentication temporarily unavailable"),
        { responseCode: unavailable ? 535 : 454 }));
    });
  },
  onMailFrom(address, session, callback) {
    const sessionId = smtpSessionIds.get(session);
    if (sessionId) activeAttempts.set(session, smtpAttempts.begin(sessionId,address.address).id);
    void applySmtpFault("MAIL", session, address.address)
      .then((stopped) => { if (!stopped) callback(); })
      .catch((error) => {
        const id=activeAttempts.get(session);
        if(id)smtpAttempts.update(id,{phase:"MAIL",outcome:"rejected",responseCode:smtpFailure(error).responseCode});
        callback(smtpFailure(error));
      });
  },
  onRcptTo(address, session, callback) {
    if (isConnectionProbeAddress(address.address)) return callback();
    const sender = session.envelope.mailFrom && typeof session.envelope.mailFrom !== "boolean"
      ? session.envelope.mailFrom.address : undefined;
    void applySmtpFault("RCPT", session, sender, [address.address])
      .then((stopped) => {
        const id=activeAttempts.get(session);
        if(id && !stopped)smtpAttempts.update(id,{phase:"RCPT",recipient:address.address});
        if(!stopped)callback();
      })
      .catch((error) => {
        const id=activeAttempts.get(session);
        if(id)smtpAttempts.update(id,{phase:"RCPT",responseCode:smtpFailure(error).responseCode});
        callback(smtpFailure(error));
      });
  },
  onData(stream: any, session: any, callback: any) {
    (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      let oversized = false;
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > smtpMessageLimit || stream.sizeExceeded) {
          // Drain DATA without retaining more bytes, so SMTP receives a final 552.
          oversized = true;
          continue;
        }
        chunks.push(buffer);
      }
      if (oversized || stream.sizeExceeded) throw new Fault(413, "MIME too large", "MESSAGE_TOO_LARGE");
      const sender = session.envelope.mailFrom && typeof session.envelope.mailFrom !== "boolean"
        ? session.envelope.mailFrom.address : "unknown@sandbox.test";
      const recipients: string[] = session.envelope.rcptTo.map((recipient: { address: string }) => recipient.address);
      const isProbe = recipients.some(isConnectionProbeAddress);
      if (isProbe) {
        // Probe requests are never captured as anomalies or passed to simulation rules.
        const parsed = await new PostalMime().parse(Buffer.concat(chunks));
        validateConnectionProbeMessage(recipients, parsed.headers.some((header) => header.key === "subject") ? "present" : undefined, parsed.text, parsed.html, parsed.attachments || []);
        validateConnectionProbeAddress(recipients[0]);
        const sessionId = smtpSessionIds.get(session);
        if (!sessionId) throw new Fault(404, "SMTP connection not found", "SMTP_SESSION_NOT_FOUND");
        deliverConnectionProbe(sandbox, smtpSessions, recipients[0], sessionId);
        protocolCounters.message("SMTP");
        callback(null, "Accepted");
        return;
      }
      const attemptId=activeAttempts.get(session);
      if(attemptId)smtpAttempts.update(attemptId,{phase:"DATA"});
      if (await applySmtpFault("DATA", session, sender, recipients)) return;
      const identity = smtpSessions.listSessions().find(record => record.id === smtpSessionIds.get(session));
      const rule = simulations.matchConnection(smtpSessionIds.get(session), "DATA")
        || simulations.match(identity?.testSessionId, "SMTP", "DATA");
      if (rule) throw new Fault(rule.code, rule.message, "SIMULATED_SMTP_FAILURE");
      const raw = Buffer.concat(chunks);
      const parsed = await new PostalMime().parse(raw);
      const attachments: Attachment[] = normalizeMimeAttachments(parsed.attachments || []);
      const metadata = {
        headers: parsed.headers.map((header) => ({
          key: header.key, originalKey: header.originalKey || header.key, value: header.value,
        })),
        // Parsed display names are RFC 2047-decoded; headers[] stays raw.
        decodedFrom: decodedSender(parsed.from),
        envelope: {
          mailFrom: sender,
          rcptTo: session.envelope.rcptTo.map((recipient: { address: string }) => recipient.address),
        },
        authUser: typeof session.user === "string" ? session.user : undefined,
        smtpSessionId: smtpSessionIds.get(session),
      };
      for (const recipient of session.envelope.rcptTo) {
        const message = sandbox.deliver("email", sender, recipient.address, parsed.text || "", parsed.subject,
          parsed.html || undefined, raw.toString("base64"), attachments, metadata);
        if (metadata.smtpSessionId) smtpSessions.recordMessage(metadata.smtpSessionId, message.id);
        if(attemptId)smtpAttempts.update(attemptId,{messageId:message.id,persisted:true});
        protocolCounters.message("SMTP");
      }
      if(attemptId)smtpAttempts.update(attemptId,{phase:"AFTER_DATA"});
      if (await applySmtpFault("AFTER_DATA", session, sender, recipients, true)) return;
      if(attemptId)smtpAttempts.update(attemptId,{outcome:"stored_and_acknowledged",responseCode:250});
      callback(null, "Accepted");
    })().catch((error) => {
      const failure = smtpFailure(error);
      const attemptId=activeAttempts.get(session);
      if(attemptId){
        const attempt=smtpAttempts.get(attemptId);
        smtpAttempts.update(attemptId,{outcome:attempt?.persisted?"stored_without_ack":"rejected",responseCode:failure.responseCode});
      }
      const id = smtpSessionIds.get(session);
      const wasSimulated = (error as { simulated?: boolean } | null)?.simulated === true;
      if (!wasSimulated) protocolCounters.error("SMTP", error instanceof Fault && error.code === "SIMULATED_SMTP_FAILURE");
      if (id) {
        if (!wasSimulated) smtpSessions.recordError(id, failure.responseCode,
          error instanceof Fault ? error.code || "SMTP_FAILURE" : "SMTP_FAILURE");
        sandbox.log("smtp.session.error", undefined, undefined,
          { sessionId: id, responseCode: failure.responseCode });
      }
      callback(failure);
    });
  },
};
const smtp = new SMTPServer(smtpOptions);
const smtps = tlsIdentity ? new SMTPServer({ ...smtpOptions, secure: true }) : null;
for (const listener of [smtp, smtps]) if (listener) protectSmtpSocketErrors(listener);
for (const listener of [smtp, smtps]) listener?.on("error", (error: Error) => {
  if ((error as Error & { code?: string }).code === "SocketError" &&
    error.message === "Socket closed while initiating TLS") return;
  console.warn("SMTP transport error:", error.message);
});
  return { smtp, smtps };
}
