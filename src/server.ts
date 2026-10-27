import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
import { ProtocolCounters } from "./protocol-metrics.js";
import { recordSecuredConnection } from "./smtp-session-lifecycle.js";
import { decodedSender } from "./mime/decoded-sender.js";
import PostalMime from "postal-mime";
import nodemailer from "nodemailer";
import { normalizeMimeAttachments, sanitizeDownloadName } from "./mime/attachments.js";
import { Sandbox, Fault, type Channel, type Event, type Attachment } from "./core.js";
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
const smtpSessions = new SmtpSessionStore(500, credentialStore);
const simulations = new SimulationStore();
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
  return savedSettings[key] ?? process.env[key] ?? fallback;
}
const overriddenKeys = Object.keys(savedSettings).filter(
  (key) => process.env[key] !== undefined && savedSettings[key] !== process.env[key],
);
if (overriddenKeys.length) {
  console.warn("Persisted network settings override environment variables:", overriddenKeys.join(", "));
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
const frontendRoot = resolve(process.cwd(), "web/dist");

function serveFrontend(req: IncomingMessage, res: ServerResponse, pathParts: string[]) {
  if (!existsSync(join(frontendRoot, "index.html"))) return false;
  const candidate = resolve(frontendRoot, "." + sep + pathParts.join(sep));
  const safe = candidate === frontendRoot || candidate.startsWith(frontendRoot + sep);
  if (!safe) return false;
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate : join(frontendRoot, "index.html");
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".ico": "image/x-icon",
  };
  res.writeHead(200, {
    "Content-Type": mime[extname(file)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(readFileSync(file));
  return true;
}

function errorCode(status: number, message: string): string {
  const text = message.toLowerCase();
  if (text.includes("inbox not found")) return "INBOX_NOT_FOUND";
  if (text.includes("message not found")) return "MESSAGE_NOT_FOUND";
  if (text.includes("ttl")) return "INVALID_TTL";
  if (text.includes("expired")) return "RECIPIENT_EXPIRED";
  if (text.includes("certificate") || text.includes("pem")) return "TLS_CERTIFICATE_INVALID";
  return ({ 413: "MESSAGE_TOO_LARGE", 403: "FORBIDDEN", 409: "CONFLICT",
    507: "CAPACITY_EXCEEDED", 404: "RESOURCE_NOT_FOUND", 400: "INVALID_REQUEST" } as Record<number, string>)[status]
    || "INTERNAL_ERROR";
}
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

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, (key, value) => key === "content" && Buffer.isBuffer(value) ? undefined : value));
}
async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > config.httpBytes) throw new Fault(413, "Payload too large");
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Fault(400, "Invalid JSON"); }
}
const channels: Record<string, Channel> = { mailboxes: "email", "phone-numbers": "sms" };
function publicMessage(message: import("./core.js").Message) {
  const { attachments = [], rawMime: _rawMime, ...other } = message;
  return { ...other, attachments: attachments.map(({ id, filename, contentType, size }) => ({
    id, filename, contentType, size,
  })) };
}
function sse(res: ServerResponse, event: string, data: unknown, id?: string) {
  if (res.writableEnded) return;
  res.write((id ? "id: " + id + "\n" : "") + "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
}
function observe(req: IncomingMessage, res: ServerResponse, observerId?: string) {
  const snapshot = observerId ? sandbox.snapshot(observerId) : sandbox.newObserver();
  const url = new URL(req.url || "/", "https://localhost");
  const after = String(req.headers["last-event-id"] || url.searchParams.get("after") || "");
  const active = () => !observerId || (sandbox.observers.get(observerId)?.expiresAt ?? 0) > Date.now();
  const relevant = (event: Event) => !observerId || !!(
    event.resourceId && sandbox.observers.get(observerId)?.inboxes.has(event.resourceId)
  );
  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    sandbox.emitter.off("event", callback);
    if (!res.writableEnded) res.end();
  };
  const buffered: Event[] = [];
  let replaying = true;
  const emit = (event: Event) => {
    if (closed) return;
    sse(res, "log", event, event.id);
    if (observerId && event.type.startsWith("message.") && relevant(event)) {
      sse(res, "inbox.notification", event);
    }
  };
  const callback = (event: Event) => {
    if (!active()) { stop(); return; }
    if (replaying) buffered.push(event);
    else emit(event);
  };
  sandbox.emitter.on("event", callback);
  sse(res, observerId ? "session.restored" : "session.initialized", snapshot);
  const replay = sandbox.replay(after);
  if (replay.reset) sse(res, "log.reset", { runId: replay.runId });
  if (replay.gap) sse(res, "log.gap", { oldest: replay.oldest, latest: replay.latest });
  for (const event of replay.events) emit(event);
  replaying = false;
  const emitted = new Set(replay.events.map((event) => event.id));
  for (const event of buffered) if (!emitted.has(event.id)) callback(event);
  heartbeat = setInterval(() => {
    if (!active()) stop();
    else if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20000);
  res.on("close", stop);
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
      case "smtpClients":
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, smtpSessions.listClients());
      case "smtpSessions":
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        return json(res, 200, smtpSessions.listSessions(url.searchParams.get("clientId") || undefined));
      case "smtpVerify": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const input = await body(req);
        return json(res, 200, await smtpSessions.verifyCredentials(params.sessionId, input.username, input.password, input.attemptId));
      }
      case "health":
        return json(res, 200, { status: "ok", runId: sandbox.runId });
      case "openapi":
        return json(res, 200, createOpenApiDocument());
      case "demoOpenapi":
        return json(res, 200, createOpenApiDocument("demo"));
      case "generationOptions":
        return json(res, 200, generationOptions());
      case "networkSettings": {
        if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
        const values = await body(req);
        const allowed = ["PUBLIC_HOST", "HOST", "SMTP_HOST", "PORT", "HTTPS_PORT",
          "SMTP_PORT", "SMTPS_PORT", "DEMO_PORT", "DEMO_HTTPS_PORT"];
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
        const data = { ...savedSettings, ...values };
        mkdirSync(dirname(networkSettingsFile), { recursive: true, mode: 0o700 });
        const temporary = networkSettingsFile + "." + randomUUID() + ".tmp";
        writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
        renameSync(temporary, networkSettingsFile);
        sandbox.log("network.settings.updated", undefined, undefined, { keys: Object.keys(values) });
        return json(res, 202, { restartRequired: true, settings: data });
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
            SMTPS_PORT: String(smtpsPort), DEMO_PORT: String(demoPort), DEMO_HTTPS_PORT: String(demoHttpsPort) },
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
      case "logs":
        return json(res, 200, sandbox.replay(url.searchParams.get("after") || undefined));
      case "logEvents":
      case "newObserverEvents":
        return observe(req, res);
      case "observerEvents":
        return observe(req, res, params.observerId);
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
        const created = sandbox.create(channel,
          channel === "email" ? input.address : input.phoneNumber,
          input.ttlSeconds, input.observerId, input.generation);
        if (created.channel === "email") {
          credentialStore.createInbox(created.address);
          inboxAddresses.set(created.id, created.address);
        }
        return json(res, 201, created);
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
        return json(res, 200, sandbox.listMessages(inboxId).map(publicMessage));
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
      error: fault.message, errorCode: fault.code || errorCode(fault.status, fault.message), errorParams: {},
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
  const responseCode = error instanceof Fault && error.code === "SIMULATED_SMTP_FAILURE" ? status : status === 413 ? 552 : status === 507 ? 452 : status === 400 ? 554 : 451;
  return Object.assign(failure, { responseCode });
}
const smtpOptions: SMTPServerOptions = {
  authOptional: true,
  onConnect(session, callback) {
    try {
      const id = smtpSessions.connect(session.remoteAddress || "unknown", !!session.secure);
      smtpSessionIds.set(session, id);
      protocolCounters.connect("SMTP");
      sandbox.log("smtp.session.connected", undefined, undefined, { sessionId: id });
      callback();
    } catch {
      callback(Object.assign(new Error("SMTP session capacity reached"), { responseCode: 421 }));
    }
  },
  onClose(session) {
    const id = smtpSessionIds.get(session);
    if (id) { smtpSessions.disconnect(id); protocolCounters.disconnect("SMTP"); sandbox.log("smtp.session.disconnected", undefined, undefined, { sessionId: id }); }
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
    let inboxAvailable = false;
    try { inboxAvailable = !!sandbox.find("email", auth.username || ""); } catch { /* expired inbox */ }
    if (!inboxAvailable)
      return callback(Object.assign(new Error("Test inbox unavailable"), { responseCode: 535 }));
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
  onRcptTo(_address: unknown, _session: unknown, callback: (error?: Error | null) => void) { callback(); },
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
      const identity = smtpSessions.listSessions().find(record => record.id === smtpSessionIds.get(session));
      const rule = simulations.match(identity?.testSessionId, "SMTP", "DATA");
      if (rule) throw new Fault(rule.code, rule.message, "SIMULATED_SMTP_FAILURE");
      const raw = Buffer.concat(chunks);
      const parsed = await new PostalMime().parse(raw);
      const sender = session.envelope.mailFrom && typeof session.envelope.mailFrom !== "boolean"
        ? session.envelope.mailFrom.address : "unknown@sandbox.test";
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
        protocolCounters.message("SMTP");
      }
      callback(null, "Accepted");
    })().catch((error) => {
      const failure = smtpFailure(error);
      const id = smtpSessionIds.get(session);
      protocolCounters.error("SMTP", error instanceof Fault && error.code === "SIMULATED_SMTP_FAILURE");
      if (id) { smtpSessions.recordError(id, failure.responseCode, error instanceof Fault ? error.code || "SMTP_FAILURE" : "SMTP_FAILURE");
        sandbox.log("smtp.session.error", undefined, undefined, { sessionId: id, responseCode: failure.responseCode }); }
      callback(failure);
    });
  },
};
const smtp = new SMTPServer(smtpOptions);
const smtps = tlsIdentity ? new SMTPServer({ ...smtpOptions, secure: true }) : null;
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
http.listen(port, apiHost, () => console.log("REST listening on " + port));
const https = tlsIdentity ? createHttpsServer(tlsIdentity, (req, res) => { void handleRequest(req, res); }) : null;
const demoHttps = tlsIdentity ? createHttpsServer(tlsIdentity, (req, res) => { void handleRequest(req, res, true); }) : null;
if (https) https.maxConnections = config.maxConnections;
if (demoHttps) demoHttps.maxConnections = config.maxConnections;
https?.listen(httpsPort, apiHost, () => console.log("HTTPS and web console listening on " + httpsPort));
demoHttps?.listen(demoHttpsPort, apiHost, () => console.log("HTTPS demo API listening on " + demoHttpsPort));
demo.listen(demoPort, apiHost, () => console.log("Demo API listening on " + demoPort));
smtp.listen(smtpPort, smtpHost, () => console.log("SMTP listening on " + smtpPort));
pop3.listen(pop3Port, smtpHost, () => console.log("POP3 listening on " + pop3Port));
smtps?.listen(smtpsPort, smtpHost, () => console.log("SMTPS listening on " + smtpsPort));
function stop() {
  http.close(); https?.close(); demoHttps?.close(); demo.close(); smtp.close(); smtps?.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
