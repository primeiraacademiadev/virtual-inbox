import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { serveFrontend, errorCode, json, body } from "./http/server-helpers.js";
import { observe } from "./http/event-stream.js";
import { protectSmtpSocketErrors } from "./network/socket-errors.js";
import { createServer as createHttpsServer } from "node:https";
import {
  readFileSync, existsSync, statSync, writeFileSync, renameSync, mkdirSync,
  copyFileSync, rmSync,
} from "node:fs";
import { resolve, join, extname, sep, dirname } from "node:path";
import { TLSSocket } from "node:tls";
import {
  X509Certificate, createPrivateKey, createPublicKey, timingSafeEqual, randomUUID, createHash,
} from "node:crypto";
import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { SmtpSessionStore } from "./smtp-sessions.js";
import { InboxCredentialStore } from "./inbox-credentials.js";
import { createPop3Server } from "./pop3-server.js";
import { Pop3ConnectionStore } from "./pop3-connections.js";
import { applicationFootprint } from "./footprint.js";
import { SimulationStore } from "./simulation-store.js";
import { resolveNetworkSetting, shadowedNetworkKeys, environmentControlledKeys, assertWritableNetworkSettings } from "./network-settings.js";
import { SmtpAttemptStore } from "./smtp-attempts.js";
import { startFixedListeners, type ListenerSpec } from "./listener-readiness.js";
import { SmtpReplyRuleStore, type SmtpReplyPhase, type SmtpReplyRule } from "./smtp-reply-rules.js";
import { SmtpRuleIdentities } from "./smtp-rule-identities.js";
import { isConnectionProbeAddress, validateConnectionProbeAddress, validateConnectionProbeMessage, deliverConnectionProbe, waitForConnectionProbeMessage } from "./connection-probe.js";
import { ProtocolCounters } from "./protocol-metrics.js";
import { recordSecuredConnection } from "./smtp-session-lifecycle.js";
import { decodedSender } from "./mime/decoded-sender.js";
import PostalMime from "postal-mime";
import nodemailer from "nodemailer";
import { normalizeMimeAttachments, sanitizeDownloadName } from "./mime/attachments.js";
import { Sandbox, Fault, matchesLog, parseLogFilters, type Channel, type Event, type Attachment } from "./core.js";
import { config } from "./config.js";
import { isAllowedHost, isAllowedOrigin, applyCors } from "./http/security.js";
import { createOpenApiDocument, matchApiOperation } from "./http/api-contract.js";
import { generationOptions } from "./identity-generation/generator.js";
import { ensureLocalTls } from "./tls/local-certificates.js";
import { CertificateManager } from "./tls/certificate-manager.js";
import {
  parseTlsNameSet, readTlsNameSet, resolveTlsServerNames, type TlsNameSet,
} from "./tls/server-names.js";

export const sandbox = new Sandbox(config.logs);
const credentialStore = new InboxCredentialStore();
const inboxAddresses = new Map<string, string>();
const smtpAuthPolicy = process.env.SMTP_AUTH_POLICY || "INBOX";
if (!["INBOX", "OPEN"].includes(smtpAuthPolicy)) throw Error("Invalid SMTP_AUTH_POLICY");
const smtpSessions = new SmtpSessionStore(500, credentialStore, smtpAuthPolicy as "INBOX" | "OPEN", config.smtpSessionHistoryHours);
const simulations = new SimulationStore();
const smtpAttempts = new SmtpAttemptStore();
const activeAttempts = new WeakMap<object,string>();
const smtpReplyRules = new SmtpReplyRuleStore(1000, config.smtpSimulationMaxDurationMs);
const smtpRuleIdentities = new SmtpRuleIdentities();
const smtpCredentialIds = new Map<string, string[]>();
const protocolCounters = new ProtocolCounters();
const pop3Connections = new Pop3ConnectionStore();
let lastCleanupAt: string | null = null;
sandbox.emitter.on("resource.removed", (id: string) => {
  const address = inboxAddresses.get(id);
  if (address) {
    for (const session of credentialStore.list(address)) simulations.deleteSession(session.id);
    credentialStore.deleteInbox(address);
  }
  inboxAddresses.delete(id);
});
const pop3 = createPop3Server(sandbox, credentialStore, simulations, protocolCounters, pop3Connections);
const smtpSessionIds = new WeakMap<object, string>();
const networkSettingsFile = resolve(
  process.env.NETWORK_SETTINGS_FILE || "./data/network-settings.json",
);
const savedSettings: Record<string, string> = existsSync(networkSettingsFile)
  ? JSON.parse(readFileSync(networkSettingsFile, "utf8"))
  : {};
function setting(key: string, fallback: string) {
  return resolveNetworkSetting(process.env, savedSettings, key, fallback);
}
const networkKeys = ["PUBLIC_HOST", "HOST", "SMTP_HOST", "PORT", "HTTPS_PORT",
  "SMTP_PORT", "SMTPS_PORT", "POP3_PORT", "DEMO_PORT", "DEMO_HTTPS_PORT"] as const;
const overriddenKeys = shadowedNetworkKeys(process.env, savedSettings);
if (overriddenKeys.length) {
  console.warn("Environment variables override persisted network settings:", overriddenKeys.join(", "));
}
function adminAllowed(req: IncomingMessage) {
  const token = process.env.ADMIN_TOKEN;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer /i, "");
  return !!token && !!supplied &&
    Buffer.byteLength(supplied) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token)) &&
    req.socket instanceof TLSSocket && req.socket.encrypted;
}

const port = Number(setting("PORT", "3000"));
const smtpPort = Number(setting("SMTP_PORT", "2525"));
const pop3Port = Number(setting("POP3_PORT", "2110"));
const httpsPort = Number(setting("HTTPS_PORT", "3443"));
const smtpsPort = Number(setting("SMTPS_PORT", "2465"));
const demoPort = Number(setting("DEMO_PORT", "3001"));
const demoHttpsPort = Number(setting("DEMO_HTTPS_PORT", "3444"));
const tlsMode = process.env.TLS_MODE || "auto";
const tlsDirectory = resolve(process.env.TLS_CERTIFICATES_DIR || "./data/certificates");
const managedNamesFile = resolve(
  process.env.TLS_MANAGED_NAMES_FILE || join(tlsDirectory, "names.json"),
);
const managedIdentityFile = resolve(
  process.env.TLS_MANAGED_IDENTITY_FILE || join(tlsDirectory, "imported-identity.json"),
);
if (!["auto", "external", "off"].includes(tlsMode)) throw Error("Invalid TLS_MODE");

function effectiveTlsNames(managed?: TlsNameSet) {
  const namesFile = process.env.TLS_SERVER_NAMES_FILE;
  return resolveTlsServerNames({
    environment: process.env.TLS_SERVER_NAMES,
    publicHost: setting("PUBLIC_HOST", "localhost"),
    file: namesFile ? readTlsNameSet(resolve(namesFile)) : undefined,
    managed: managed ?? (existsSync(managedNamesFile) ? readTlsNameSet(managedNamesFile) : undefined),
  });
}
if (tlsMode === "auto") {
  const identity = ensureLocalTls(tlsDirectory, effectiveTlsNames().join(","));
  process.env.TLS_CERT_FILE = identity.cert;
  process.env.TLS_KEY_FILE = identity.key;
}
const tlsCertPath = tlsMode === "off" ? undefined : process.env.TLS_CERT_FILE;
const tlsKeyPath = tlsMode === "off" ? undefined : process.env.TLS_KEY_FILE;
if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
  throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be configured together");
}
const importedIdentity = tlsMode !== "off" && existsSync(managedIdentityFile)
  ? JSON.parse(readFileSync(managedIdentityFile, "utf8")) as { cert: string; key: string }
  : null;
const initialTlsIdentity = importedIdentity
  ? { cert: Buffer.from(importedIdentity.cert), key: Buffer.from(importedIdentity.key), minVersion: "TLSv1.2" as const }
  : tlsCertPath && tlsKeyPath
    ? { cert: readFileSync(tlsCertPath), key: readFileSync(tlsKeyPath), minVersion: "TLSv1.2" as const }
    : null;
const certificateManager = new CertificateManager(
  initialTlsIdentity,
  importedIdentity ? "uploaded" : tlsMode === "auto" ? "automatic" : "external",
  managedIdentityFile,
);
let tlsIdentity = certificateManager.identity;
if (tlsIdentity) {
  const cert = new X509Certificate(tlsIdentity.cert);
  if (!createPublicKey(createPrivateKey(tlsIdentity.key)).equals(cert.publicKey)) {
    throw new Error("TLS certificate and private key do not match");
  }
}
const addressHost = setting("PUBLIC_HOST", "localhost");
const apiHost = setting("HOST", "127.0.0.1");
const smtpHost = setting("SMTP_HOST", "127.0.0.1");
const smtpMessageLimit = config.smtpBytes;

const trustedHosts = [addressHost, apiHost, "localhost", "127.0.0.1", "::1"];
const allowedOrigins = new Set([
  ...trustedHosts.flatMap((host) => [
    "http://" + host + ":" + port, "https://" + host + ":" + httpsPort,
    "http://" + host + ":" + demoPort, "https://" + host + ":" + demoHttpsPort,
  ]),
  "http://127.0.0.1:5173", "http://localhost:5173",
  "https://127.0.0.1:5174", "https://localhost:5174",
  ...(process.env.HTTP_ALLOWED_ORIGINS || "").split(","),
].map((value) => value.trim()).filter(Boolean));
function allowedHostsForCertificate(cert?: Buffer) {
  const san = cert ? new X509Certificate(cert).subjectAltName || "" : "";
  return [
    ...trustedHosts, ...(process.env.HTTP_ALLOWED_HOSTS || "").split(","),
    ...(san.match(/(?:DNS|IP Address):[^,]+/g) || []).map((name) => name.slice(name.indexOf(":") + 1).trim()),
  ];
}
let allowedHosts = allowedHostsForCertificate(tlsIdentity?.cert);

const channels: Record<string, Channel> = { mailboxes: "email", "phone-numbers": "sms" };
function publicMessage(message: import("./core.js").Message) {
  const { attachments = [], rawMime: _rawMime, ...other } = message;
  return { ...other, attachments: attachments.map(({ id, filename, contentType, size }) => ({
    id, filename, contentType, size,
  })) };
}
async function handleRequest(req: IncomingMessage, res: ServerResponse, demoOnly = false) {
  try {
    if (!isAllowedHost(req.headers.host, allowedHosts)) throw new Fault(421, "Unrecognized Host");
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowedOrigins)) {
      throw new Fault(403, "Origin not allowed");
    }
    applyCors(req, res, allowedOrigins);
    const url = new URL(req.url || "/", "https://localhost");
    const rawPath = url.pathname.split("/").filter(Boolean);
    const method = req.method || "GET";
    const sameOriginDemo = !demoOnly && rawPath[0] === "demo";
    const path = !demoOnly && ["api", "demo"].includes(rawPath[0]) ? rawPath.slice(1) : rawPath;
    if (method === "OPTIONS") return json(res, 204, {});
    const match = matchApiOperation(method, path, demoOnly || sameOriginDemo ? "demo" : "management");
    if (!match) {
      if (!demoOnly && method === "GET" && !["api", "demo"].includes(rawPath[0]) &&
        serveFrontend(req, res, rawPath)) return;
      throw new Fault(404, "Route not available on this listener");
    }
    const { operation, params } = match;
    const channel = channels[path[0]];
    const inboxId = params.inboxId;

    switch (operation.id) {
      case "popConnections": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, pop3Connections.list());
      }
      case "applicationFootprint": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, applicationFootprint(sandbox, smtpSessions, pop3Connections,
          credentialStore, simulations, lastCleanupAt));
      }
      case "protocolMetrics": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, protocolCounters.snapshot());
      }
      case "smtpRuleResolve": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const retained = new Set(smtpSessions.listSessions().map(s => s.id));
        for (const id of smtpCredentialIds.keys()) if (!retained.has(id)) smtpCredentialIds.delete(id);
        const sessions = smtpSessions.listSessions().map(s => ({
          id: s.id, remoteAddress: s.remoteAddress, connected: s.connected,
          connectedAt: s.connectedAt, credentialsIds: smtpCredentialIds.get(s.id),
        }));
        return json(res, 200, smtpRuleIdentities.resolve(await body(req), sessions));
      }
      case "smtpReplyRuleCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 201, smtpReplyRules.create(await body(req)));
      }
      case "smtpReplyRuleList": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, smtpReplyRules.list());
      }
      case "smtpReplyRuleDelete": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        if (!smtpReplyRules.delete(params.ruleId)) throw new Fault(404, "SMTP rule not found", "SMTP_RULE_NOT_FOUND");
        return json(res, 204, {});
      }
      case "smtpConnectionSimulationCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const connection = smtpSessions.getSession(params.sessionId);
        if (!connection?.connected) throw new Fault(404, "Active SMTP connection not found", "SMTP_SESSION_NOT_FOUND");
        const input = await body(req);
        if (input.command !== "DATA") throw new Fault(400, "Connection simulations currently support DATA only", "INVALID_SIMULATION");
        return json(res, 201, simulations.create({ smtpSessionId: params.sessionId,
          protocol: "SMTP", command: input.command, code: input.code,
          message: input.message || "Simulated failure", remaining: input.remaining || 1 }));
      }
      case "smtpConnectionSimulationList": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, simulations.listConnection(params.sessionId));
      }
      case "smtpConnectionSimulationDelete": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const rule = simulations.listConnection(params.sessionId).find(value => value.id === params.ruleId);
        if (!rule) throw new Fault(404, "SMTP connection simulation not found");
        simulations.delete(rule.id);
        return json(res, 204, {});
      }
      case "simulationCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        if (!credentialStore.resolve(params.sessionId)) throw new Fault(404, "Unknown test session");
        return json(res, 201, simulations.create({ sessionId: params.sessionId, protocol: input.protocol, command: input.command, code: input.code, message: input.message || "Simulated failure", remaining: input.remaining || 1 }));
      }
      case "simulationList": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, simulations.list(params.sessionId));
      }
      case "simulationDelete": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        simulations.delete(params.ruleId);
        return json(res, 204, {});
      }
      case "testSessionCreate": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        if (typeof input.username !== "string" || !input.username.trim())
          throw new Fault(400, "Inbox required", "INVALID_INBOX");
        let available = false;
        try { available = !!sandbox.find("email", input.username); } catch { /* expired inbox */ }
        if (!available)
          throw new Fault(404, "Test inbox does not exist", "TEST_INBOX_NOT_FOUND");
        return json(res, 201, { sessionId: await credentialStore.authenticate(input.username, input.password) });
      }
      case "testSessionGet": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const found = credentialStore.resolve(params.sessionId);
        if (!found) throw new Fault(404, "Test session not found", "TEST_SESSION_NOT_FOUND");
        return json(res, 200, found);
      }
      case "testSessionVerify": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        return json(res, 200, { matches: await credentialStore.verify(input.username, input.password, params.sessionId) });
      }
      case "smtpAttempts": {
        return json(res, 200, smtpAttempts.list({
          smtpSessionId:url.searchParams.get("smtpSessionId")||undefined,
          sender:url.searchParams.get("sender")||undefined,
          recipient:url.searchParams.get("recipient")||undefined,
          messageId:url.searchParams.get("messageId")||undefined,
          ruleId:url.searchParams.get("ruleId")||undefined,
        }, Number(url.searchParams.get("limit")||100)));
      }
      case "smtpClients":
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, smtpSessions.listClients());
      case "smtpSessions":
        return json(res, 200, smtpSessions.listSessions(url.searchParams.get("clientId") || undefined));
      case "smtpVerify": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        return json(res, 200, await smtpSessions.verifyCredentials(params.sessionId, input.username, input.password, input.attemptId));
      }
      case "health":
        return json(res, 200, { status: "ok", runId: sandbox.runId });
      case "ready":
        return json(res, listenersReady ? 200 : 503, { ready: listenersReady, runId: sandbox.runId, listeners: startedListeners });
      case "capabilities":
        return json(res, 200, {
          version: "0.2.0", schemaVersion: 1, protocols: { smtp: true, starttls: !!tlsIdentity,
            smtps: !!tlsIdentity, pop3: true, sms: true },
          smtpAuthPolicy, inbox: { idempotentCreate: true, ifExists: ["error", "return"],
            reservedDomain: "virtual.inbox" },
          simulation: { phases: ["CONNECT", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "AFTER_DATA"],
            actions: ["reply", "delay", "drop", "hang", "reset"] },
        });
      case "openapi":
        return json(res, 200, createOpenApiDocument());
      case "demoOpenapi":
        return json(res, 200, createOpenApiDocument("demo"));
      case "generationOptions":
        return json(res, 200, generationOptions());
      case "networkSettings": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const values = await body(req);
        const allowed: readonly string[] = networkKeys;
        if (!values || typeof values !== "object" || Array.isArray(values) ||
          Object.keys(values).some((key) => !allowed.includes(key))) {
          throw new Fault(400, "Unsupported setting");
        }
        for (const [key, value] of Object.entries(values)) {
          if (typeof value !== "string" || !value || value.length > 255) throw new Fault(400, "Invalid setting");
          if (key.endsWith("_PORT") || key === "PORT") {
            const number = Number(value);
            if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Fault(400, "Invalid port");
          } else if (!/^[a-zA-Z0-9.:-]+$/.test(value)) throw new Fault(400, "Invalid host");
        }
        assertWritableNetworkSettings(values, process.env);
        const data = { ...savedSettings, ...values };
        mkdirSync(dirname(networkSettingsFile), { recursive: true, mode: 0o700 });
        const temporary = networkSettingsFile + "." + randomUUID() + ".tmp";
        writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
        renameSync(temporary, networkSettingsFile);
        Object.assign(savedSettings, data);
        sandbox.log("network.settings.updated", undefined, undefined, { keys: Object.keys(values) });
        return json(res, 202, { restartRequired: true, settings: data,
          environmentControlledKeys: environmentControlledKeys(process.env, networkKeys) });
      }
      case "importTls": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        if (!tlsIdentity) throw new Fault(409, "Enable TLS before certificate import");
        const payload = await body(req);
        if (typeof payload.cert !== "string" || typeof payload.key !== "string") {
          throw new Fault(400, "PEM certificate and key required");
        }
        try {
          const active = certificateManager.activate(payload.cert, payload.key);
          tlsIdentity = certificateManager.identity;
          sandbox.log("tls.identity.activated", undefined, undefined, { subject: active?.subject, validTo: active?.validTo });
          return json(res, 200, { accepted: true, restartRequired: false, active });
        } catch (error) {
          throw new Fault(400, error instanceof Error ? error.message : "Invalid certificate", "TLS_CERTIFICATE_INVALID");
        }
      }
      case "tlsNames": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        if (tlsMode !== "auto") throw new Fault(409, "SAN regeneration requires TLS_MODE=auto");
        const payload = await body(req);
        if (!payload || !Array.isArray(payload.dns) || !Array.isArray(payload.ips) ||
          payload.dns.length + payload.ips.length > 50) throw new Fault(400, "Invalid SAN names");
        let managed: TlsNameSet;
        let names: string[];
        try {
          managed = parseTlsNameSet(payload);
          names = effectiveTlsNames(managed);
        } catch (error) {
          throw new Fault(400, error instanceof Error ? error.message : "Invalid SAN names", "INVALID_REQUEST");
        }
        const identity = ensureLocalTls(tlsDirectory, names.join(","));
        const active = certificateManager.useGenerated(readFileSync(identity.cert), readFileSync(identity.key));
        if (existsSync(managedIdentityFile)) {
          copyFileSync(managedIdentityFile, managedIdentityFile + ".previous");
          rmSync(managedIdentityFile, { force: true });
        }
        tlsIdentity = certificateManager.identity;
        mkdirSync(dirname(managedNamesFile), { recursive: true, mode: 0o700 });
        const temporary = managedNamesFile + "." + randomUUID() + ".tmp";
        writeFileSync(temporary, JSON.stringify(managed, null, 2), { mode: 0o600, flag: "wx" });
        renameSync(temporary, managedNamesFile);
        sandbox.log("tls.names.updated", undefined, undefined, { names });
        return json(res, 200, { restartRequired: false, active, names });
      }
      case "tlsStatus":
        return json(res, 200, { active: certificateManager.info() });
      case "connectionInfo":
        return json(res, 200, {
          host: addressHost,
          networkSettings: { PUBLIC_HOST: addressHost, HOST: apiHost, SMTP_HOST: smtpHost,
            PORT: String(port), HTTPS_PORT: String(httpsPort), SMTP_PORT: String(smtpPort),
            SMTPS_PORT: String(smtpsPort), POP3_PORT: String(pop3Port),
            DEMO_PORT: String(demoPort), DEMO_HTTPS_PORT: String(demoHttpsPort) },
          environmentControlledKeys: environmentControlledKeys(process.env, networkKeys),
          http: { port, httpsPort: tlsIdentity ? httpsPort : null, demoPort,
            demoHttpsPort: tlsIdentity ? demoHttpsPort : null },
          smtp: { plainPort: smtpPort, starttls: !!tlsIdentity,
            implicitTlsPort: tlsIdentity ? smtpsPort : null, serverName: addressHost },
          certificate: tlsIdentity ? { ...certificateManager.info(), download: "/tls/certificate.pem",
            caDownload: tlsMode === "auto" ? "/tls/ca.pem" : null } : null,
        });
      case "tlsCa":
        if (tlsMode !== "auto") throw new Fault(404, "Local CA not configured");
        res.writeHead(200, { "Content-Type": "application/x-pem-file",
          "Content-Disposition": "attachment; filename=virtual-inbox-ca.pem" });
        return res.end(readFileSync(join(tlsDirectory, "ca.pem")));
      case "tlsCertificate":
        if (!tlsIdentity) throw new Fault(404, "TLS is not configured");
        res.writeHead(200, { "Content-Type": "application/x-pem-file",
          "Content-Disposition": "attachment; filename=virtual-inbox-server.pem" });
        return res.end(tlsIdentity.cert);
      case "sendSms": {
        const input = await body(req);
        return json(res, 201, publicMessage(sandbox.deliver("sms", input.from, input.to, input.body)));
      }
      case "logs": {
        const filters = parseLogFilters(url.searchParams);
        const limitParam = url.searchParams.get("limit"), beforeParam = url.searchParams.get("before");
        if (limitParam !== null || beforeParam !== null) {
          if (url.searchParams.has("after") || url.searchParams.has("from") || url.searchParams.has("to"))
            throw new Fault(400, "Conflicting log cursors", "INVALID_LOG_CURSOR");
          const limit = limitParam === null ? 20 : Number(limitParam);
          const before = beforeParam === null ? undefined : Number(beforeParam);
          return json(res, 200, sandbox.pageLogs({ limit, before, filters }));
        }
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (from !== null || to !== null) {
          const lower = Number(from), upper = Number(to);
          if (from === null || to === null || !Number.isSafeInteger(lower) || !Number.isSafeInteger(upper)
            || lower < 1 || upper < lower || upper - lower > 10000)
            throw new Fault(400, "Invalid log range", "INVALID_LOG_RANGE");
          const current = sandbox.replay(undefined, filters);
          return json(res, 200, {
            ...current,
            events: current.events.filter((event) => event.log_id !== undefined
              && event.log_id >= lower && event.log_id <= upper),
            requestedFrom: lower, requestedTo: upper,
          });
        }
        return json(res, 200, sandbox.replay(url.searchParams.get("after") || undefined, filters));
      }
      case "logEvents":
      case "newObserverEvents":
        return observe(sandbox, req, res);
      case "observerEvents":
        return observe(sandbox, req, res, params.observerId);
      case "observerSnapshot":
        return json(res, 200, sandbox.snapshot(params.observerId));
      case "watchInbox": {
        const input = await body(req);
        const result = sandbox.watch(params.observerId, input.inboxId);
        return json(res, 200, { recipient: result.recipient, messages: result.messages.map(publicMessage) });
      }
      case "unwatchInbox":
        sandbox.unwatch(params.observerId, inboxId);
        return json(res, 204, {});
      case "sendDemoEmail": {
        const recipient = sandbox.resource(inboxId);
        if (recipient.channel !== "email") throw new Fault(400, "Not an email inbox");
        const input = await body(req);
        const client = nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort,
          secure: false, ignoreTLS: true, disableFileAccess: true, disableUrlAccess: true });
        const attachments = (Array.isArray(input.attachments) ? input.attachments : []).map((item: any) => {
          if (typeof item.filename !== "string" || typeof item.contentBase64 !== "string" ||
            !/^[a-zA-Z0-9+/]*={0,2}$/.test(item.contentBase64)) throw new Fault(400, "Invalid attachment");
          const content = Buffer.from(item.contentBase64, "base64");
          if (content.length > config.attachmentBytes) throw new Fault(413, "Attachment too large");
          return { filename: item.filename, content, contentType: item.contentType || "application/octet-stream" };
        });
        await client.sendMail({ from: input.from || "demo@sandbox.test", to: recipient.address,
          subject: input.subject || "Demo", text: input.body || "", attachments });
        return json(res, 202, { accepted: true });
      }
      case "connectionProbeWait": {
        const input = await body(req);
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        const message = await waitForConnectionProbeMessage(sandbox, input.address, input, controller.signal);
        return json(res, message ? 200 : 204, message ? publicMessage(message) : {});
      }
      case "emailList":
      case "smsList": {
        const address = url.searchParams.get("address");
        if (!address) return json(res, 200, sandbox.list(channel));
        let found;
        try { found = sandbox.find(channel, address); } catch {}
        return json(res, 200, found ? [found] : []);
      }
      case "emailCreate":
      case "smsCreate": {
        const input = await body(req);
        if (channel === "email" && typeof input.address === "string" &&
          isConnectionProbeAddress(input.address))
          throw new Fault(400, "Connection probe inboxes are created by SMTP only", "INVALID_CONNECTION_PROBE");
        if (input.ifExists !== undefined && !["return", "error"].includes(input.ifExists))
          throw new Fault(400, "Invalid ifExists mode", "INVALID_IF_EXISTS");
        const requestedAddress = channel === "email" ? input.address : input.phoneNumber;
        const existing = typeof requestedAddress === "string" && requestedAddress.trim()
          ? (() => { try { return sandbox.find(channel, requestedAddress); } catch { return undefined; } })() : undefined;
        const created = sandbox.create(channel, requestedAddress,
          input.ttlSeconds, input.observerId, input.generation, input.ifExists ?? "error");
        if (created.channel === "email" && (!existing || existing.id !== created.id)) {
          credentialStore.createInbox(created.address);
          inboxAddresses.set(created.id, created.address);
        }
        return json(res, existing && existing.id === created.id ? 200 : 201, created);
      }
      case "emailGet":
      case "smsGet":
        return json(res, 200, sandbox.resource(inboxId));
      case "emailDelete":
      case "smsDelete":
        sandbox.deleteResource(inboxId);
        return json(res, 204, {});
      case "emailMessages":
      case "smsMessages":
        {
          const allowed = ["after", "originalRecipient", "from", "captureReason", "smtpSessionId", "authUser"];
          const values: Record<string, string> = {};
          for (const key of allowed) {
            const all = url.searchParams.getAll(key);
            if (all.length > 1 || all.some(value => !value || value.length > 320))
              throw new Fault(400, "Invalid message filter", "INVALID_MESSAGE_FILTER");
            if (all.length) values[key] = all[0];
          }
          const after = values.after === undefined ? 0 : Number(values.after);
          if (!Number.isSafeInteger(after) || after < 0)
            throw new Fault(400, "Invalid message cursor", "INVALID_MESSAGE_FILTER");
          return json(res, 200, sandbox.listMessages(inboxId, {
            after, originalRecipient: values.originalRecipient, from: values.from,
            captureReason: values.captureReason, smtpSessionId: values.smtpSessionId,
            authUser: values.authUser,
          }).map(publicMessage));
        }
      case "emailClear":
      case "smsClear":
        sandbox.clearMessages(inboxId);
        return json(res, 204, {});
      case "emailMessage":
      case "smsMessage": {
        const message = sandbox.listMessages(inboxId).find((item) => item.id === params.messageId);
        if (!message) throw new Fault(404, "Message not found");
        return json(res, 200, publicMessage(message));
      }
      case "emailDeleteMessage":
      case "smsDeleteMessage":
        sandbox.removeMessage(inboxId, params.messageId);
        return json(res, 204, {});
      case "emailAttachment":
      case "smsAttachment": {
        const message = sandbox.listMessages(inboxId).find((item) => item.id === params.messageId);
        const attachment = message?.attachments?.find((item) => item.id === params.attachmentId);
        if (!attachment) throw new Fault(404, "Attachment not found");
        res.writeHead(200, { "Content-Type": attachment.contentType, "Content-Length": attachment.size,
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(attachment.filename))}` });
        return res.end(attachment.content);
      }
      case "emailWait":
      case "smsWait": {
        const input = await body(req);
        const controller = new AbortController();
        req.on("close", () => { if (!res.writableEnded) controller.abort(); });
        const message = await sandbox.wait(inboxId, input, controller.signal);
        return json(res, message ? 200 : 204, message ? publicMessage(message) : {});
      }
      default:
        throw new Fault(500, "HTTP operation has no implementation");
    }
  } catch (error) {
    const fault = error instanceof Fault
      ? error : new Fault(500, error instanceof Error ? error.message : "Server error");
    if (!res.headersSent) json(res, fault.status, {
      error: fault.message, errorCode: fault.code || errorCode(fault.status, fault.message), errorParams: fault.params,
    });
  }
}

const http = createServer((req, res) => { void handleRequest(req, res); });
const demo = createServer((req, res) => { void handleRequest(req, res, true); });
http.maxConnections = config.maxConnections;
demo.maxConnections = config.maxConnections;
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
if (tlsIdentity) {
  certificateManager.subscribe((next) => {
    https?.setSecureContext(next);
    demoHttps?.setSecureContext(next);
    const refresh = (server: SMTPServer) => {
      const service = server as SMTPServer & {
        updateSecureContext?: (options: { key: Buffer; cert: Buffer }) => void;
      };
      if (typeof service.updateSecureContext !== "function") throw Error("SMTP live TLS update unavailable");
      service.updateSecureContext({ key: next.key, cert: next.cert });
    };
    refresh(smtp);
    if (smtps) refresh(smtps);
    allowedHosts = allowedHostsForCertificate(next.cert);
  });
}
if (tlsMode === "external" && tlsCertPath && tlsKeyPath) {
  let previousFingerprint = certificateManager.identity
    ? createHash("sha256").update(certificateManager.identity.cert)
      .update(certificateManager.identity.key).digest("hex") : undefined;
  const externalRefresh = setInterval(() => {
    if (certificateManager.activeSource !== "external") return;
    try {
      const cert = readFileSync(tlsCertPath);
      const key = readFileSync(tlsKeyPath);
      const fingerprint = createHash("sha256").update(cert).update(key).digest("hex");
      if (fingerprint === previousFingerprint) return;
      certificateManager.useExternal(cert, key);
      tlsIdentity = certificateManager.identity;
      previousFingerprint = fingerprint;
      sandbox.log("tls.external.refreshed");
    } catch (error) { console.error("External TLS certificate refresh rejected:", error); }
  }, 10000);
  externalRefresh.unref();
}
const clean = setInterval(() => {
  sandbox.cleanup(); smtpSessions.cleanup(); pop3Connections.cleanup();
  lastCleanupAt = new Date().toISOString();
}, 1000);
clean.unref();
const https = tlsIdentity ? createHttpsServer(tlsIdentity, (req, res) => { void handleRequest(req, res); }) : null;
const demoHttps = tlsIdentity ? createHttpsServer(tlsIdentity, (req, res) => { void handleRequest(req, res, true); }) : null;
if (https) https.maxConnections = config.maxConnections;
if (demoHttps) demoHttps.maxConnections = config.maxConnections;
let listenersReady = false;
const startedListeners: Array<{ name: string; port: number; host: string }> = [];
const listenerSpecs: ListenerSpec[] = [
  { name: "HTTP", server: http, port, host: apiHost },
  ...(https ? [{ name: "HTTPS", server: https, port: httpsPort, host: apiHost }] : []),
  { name: "DEMO_HTTP", server: demo, port: demoPort, host: apiHost },
  ...(demoHttps ? [{ name: "DEMO_HTTPS", server: demoHttps, port: demoHttpsPort, host: apiHost }] : []),
  { name: "SMTP", server: smtp, port: smtpPort, host: smtpHost },
  { name: "POP3", server: pop3, port: pop3Port, host: smtpHost },
  ...(smtps ? [{ name: "SMTPS", server: smtps, port: smtpsPort, host: smtpHost }] : []),
];
async function startListeners() {
  try {
    await startFixedListeners(listenerSpecs, (endpoint) => {
      startedListeners.push(endpoint);
      console.log(endpoint.name + " listening on " + endpoint.port);
    });
    listenersReady = true;
    console.log(JSON.stringify({ event: "ready", runId: sandbox.runId, listeners: startedListeners }));
  } catch (error) {
    listenersReady = false;
    console.error("Virtual Inbox startup failed:", error);
    process.exit(1);
  }
}
void startListeners();
function stop() {
  listenersReady = false;
  http.close(); https?.close(); demoHttps?.close(); demo.close(); smtp.close(); smtps?.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
