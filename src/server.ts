import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { resolve, join, extname, sep, dirname } from "node:path";
import { TLSSocket } from "node:tls";
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import { SMTPServer } from "smtp-server";
import PostalMime from "postal-mime";
import { normalizeMimeAttachments, sanitizeDownloadName } from "./mime/attachments.js";
import nodemailer from "nodemailer";
import { Sandbox, Fault, classify, type Channel, type Event, type Attachment } from "./core.js";
import { config } from "./config.js";
import { isAllowedHost, isAllowedOrigin, applyCors } from "./http/security.js";
import { generationOptions } from "./identity-generation/generator.js";
import { ensureLocalTls } from "./tls/local-certificates.js";
import { CertificateManager } from "./tls/certificate-manager.js";

export const sandbox = new Sandbox(config.logs);
const networkSettingsFile = resolve(
  process.env.NETWORK_SETTINGS_FILE || "./data/network-settings.json",
);
const savedSettings: Record<string, string> = existsSync(networkSettingsFile)
  ? JSON.parse(readFileSync(networkSettingsFile, "utf8"))
  : {};
function setting(key: string, fallback: string) {
  return savedSettings[key] ?? process.env[key] ?? fallback;
}
function adminAllowed(req: IncomingMessage) {
  const token = process.env.ADMIN_TOKEN,
    supplied = String(req.headers.authorization || "").replace(/^Bearer /i, "");
  return (
    !!token &&
    !!supplied &&
    Buffer.byteLength(supplied) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token)) &&
    req.socket instanceof TLSSocket &&
    req.socket.encrypted
  );
}

const port = Number(setting("PORT", "3000")),
  smtpPort = Number(setting("SMTP_PORT", "2525"));
const httpsPort = Number(setting("HTTPS_PORT", "3443")),
  smtpsPort = Number(setting("SMTPS_PORT", "2465"));
const demoPort = Number(setting("DEMO_PORT", "3001")),
  demoHttpsPort = Number(setting("DEMO_HTTPS_PORT", "3444"));
const tlsMode = process.env.TLS_MODE || "auto";
const tlsDirectory = resolve(process.env.TLS_CERTIFICATES_DIR || "./data/certificates");
if (!["auto", "external", "off"].includes(tlsMode)) throw Error("Invalid TLS_MODE");
if (tlsMode === "auto") {
  const file = process.env.TLS_SERVER_NAMES_FILE;
  const fileNames = file
    ? (JSON.parse(readFileSync(resolve(file), "utf8")) as { dns?: string[]; ips?: string[] })
    : null;
  const managedNames = existsSync(
    resolve(process.env.TLS_MANAGED_NAMES_FILE || join(tlsDirectory, "names.json")),
  )
    ? (JSON.parse(
        readFileSync(
          resolve(process.env.TLS_MANAGED_NAMES_FILE || join(tlsDirectory, "names.json")),
          "utf8",
        ),
      ) as { dns?: string[]; ips?: string[] })
    : null;
  const names = [
    ...(process.env.TLS_SERVER_NAMES || "localhost,127.0.0.1").split(","),
    ...(fileNames?.dns || []),
    ...(fileNames?.ips || []),
    ...(managedNames?.dns || []),
    ...(managedNames?.ips || []),
    setting("PUBLIC_HOST", "localhost"),
  ]
    .map((x) => x.trim())
    .filter((x) => x && x !== "0.0.0.0");
  const identity = ensureLocalTls(tlsDirectory, [...new Set(names)].join(","));
  process.env.TLS_CERT_FILE = identity.cert;
  process.env.TLS_KEY_FILE = identity.key;
}
const tlsCertPath = tlsMode === "off" ? undefined : process.env.TLS_CERT_FILE,
  tlsKeyPath = tlsMode === "off" ? undefined : process.env.TLS_KEY_FILE;
if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath))
  throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must be configured together");
const managedNamesFile = resolve(
  process.env.TLS_MANAGED_NAMES_FILE || join(tlsDirectory, "names.json"),
);
const managedIdentityFile = resolve(
  process.env.TLS_MANAGED_IDENTITY_FILE || join(tlsDirectory, "imported-identity.json"),
);
const importedIdentity =
  tlsMode !== "off" && existsSync(managedIdentityFile)
    ? (JSON.parse(readFileSync(managedIdentityFile, "utf8")) as { cert: string; key: string })
    : null;
const initialTlsIdentity = importedIdentity
  ? {
      cert: Buffer.from(importedIdentity.cert),
      key: Buffer.from(importedIdentity.key),
      minVersion: "TLSv1.2" as const,
    }
  : tlsCertPath && tlsKeyPath
    ? {
        cert: readFileSync(tlsCertPath),
        key: readFileSync(tlsKeyPath),
        minVersion: "TLSv1.2" as const,
      }
    : null;
const certificateManager = new CertificateManager(
  initialTlsIdentity,
  importedIdentity ? "uploaded" : tlsMode === "auto" ? "automatic" : "external",
  managedIdentityFile,
);
let tlsIdentity = certificateManager.identity;
if (tlsIdentity) {
  const cert = new X509Certificate(tlsIdentity.cert);
  const privateKey = createPrivateKey(tlsIdentity.key);
  if (!createPublicKey(privateKey).equals(cert.publicKey))
    throw new Error("TLS certificate and private key do not match");
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
  const file =
    safe && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(frontendRoot, "index.html");
  const extension = extname(file);
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  res.writeHead(200, {
    "Content-Type": mime[extension] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(readFileSync(file));
  return true;
}

function errorCode(status: number, message: string): string {
  const m = message.toLowerCase();
  if (m.includes("inbox not found")) return "INBOX_NOT_FOUND";
  if (m.includes("message not found")) return "MESSAGE_NOT_FOUND";
  if (m.includes("ttl")) return "INVALID_TTL";
  if (m.includes("expired")) return "RECIPIENT_EXPIRED";
  if (m.includes("certificate") || m.includes("pem")) return "TLS_CERTIFICATE_INVALID";
  if (status === 413) return "MESSAGE_TOO_LARGE";
  if (status === 403) return "FORBIDDEN";
  if (status === 409) return "CONFLICT";
  if (status === 507) return "CAPACITY_EXCEEDED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 400) return "INVALID_REQUEST";
  return "INTERNAL_ERROR";
}
const trustedHosts = [addressHost, apiHost, "localhost", "127.0.0.1", "::1"];
const allowedOrigins = new Set(
  [
    ...trustedHosts.flatMap((host) => [
      "http://" + host + ":" + port,
      "https://" + host + ":" + httpsPort,
      "http://" + host + ":" + demoPort,
      "https://" + host + ":" + demoHttpsPort,
    ]),
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://127.0.0.1:5174",
    "https://localhost:5174",
    ...(process.env.HTTP_ALLOWED_ORIGINS || "").split(","),
  ]
    .map((x) => x.trim())
    .filter(Boolean),
);
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify(data, (_key, value) =>
      _key === "content" && Buffer.isBuffer(value) ? undefined : value,
    ),
  );
}
async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > config.httpBytes) throw new Fault(413, "Payload too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Fault(400, "Invalid JSON");
  }
}
const channels: { [k: string]: Channel } = { mailboxes: "email", "phone-numbers": "sms" };
function publicMessage(m: import("./core.js").Message) {
  const { attachments = [], rawMime: _rawMime, ...other } = m;
  return {
    ...other,
    attachments: attachments.map(({ id, filename, contentType, size }) => ({
      id,
      filename,
      contentType,
      size,
    })),
  };
}
function sse(res: ServerResponse, event: string, data: unknown, id?: string) {
  if (res.writableEnded) return;
  res.write(
    (id ? "id: " + id + "\n" : "") +
      "event: " +
      event +
      "\n" +
      "data: " +
      JSON.stringify(data) +
      "\n\n",
  );
}
function observe(req: IncomingMessage, res: ServerResponse, observerId?: string) {
  const o = observerId ? sandbox.snapshot(observerId) : sandbox.newObserver();
  const url = new URL(req.url || "/", "http://localhost");
  const after = String(req.headers["last-event-id"] || url.searchParams.get("after") || "");
  const active = () =>
    !observerId || (sandbox.observers.get(observerId)?.expiresAt ?? 0) > Date.now();
  const relevant = (e: Event) =>
    !observerId || !!(e.resourceId && sandbox.observers.get(observerId)?.inboxes.has(e.resourceId));
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
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
  const emit = (e: Event) => {
    if (closed) return;
    sse(res, "log", e, e.id);
    if (observerId && e.type.startsWith("message.") && relevant(e))
      sse(res, "inbox.notification", e);
  };
  const callback = (e: Event) => {
    if (!active()) {
      stop();
      return;
    }
    if (replaying) buffered.push(e);
    else emit(e);
  };
  sandbox.emitter.on("event", callback);
  sse(res, observerId ? "session.restored" : "session.initialized", o);
  const replay = sandbox.replay(after);
  if (replay.reset) sse(res, "log.reset", { runId: replay.runId });
  if (replay.gap) sse(res, "log.gap", { oldest: replay.oldest, latest: replay.latest });
  for (const e of replay.events) emit(e);
  replaying = false;
  const emitted = new Set(replay.events.map((x) => x.id));
  for (const e of buffered) if (!emitted.has(e.id)) callback(e);
  heartbeat = setInterval(() => {
    if (!active()) stop();
    else if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20000);
  res.on("close", stop);
}
async function handleRequest(req: IncomingMessage, res: ServerResponse, demoOnly = false) {
  try {
    if (
      !isAllowedHost(req.headers.host, [
        setting("PUBLIC_HOST", "localhost"),
        setting("HOST", "127.0.0.1"),
        "localhost",
        "127.0.0.1",
        "::1",
        ...(process.env.HTTP_ALLOWED_HOSTS || "").split(","),
        ...(
          (certificateManager.info()?.subjectAltName || "").match(/(?:DNS|IP Address):[^,]+/g) || []
        ).map((x) => x.slice(x.indexOf(":") + 1).trim()),
      ])
    )
      throw new Fault(421, "Unrecognized Host");
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowedOrigins))
      throw new Fault(403, "Origin not allowed");
    applyCors(req, res, allowedOrigins);
    const rawPath = new URL(req.url || "/", "http://localhost").pathname.split("/").filter(Boolean),
      method = req.method || "GET";
    const sameOriginDemo = !demoOnly && rawPath[0] === "demo";
    const path = !demoOnly && ["api", "demo"].includes(rawPath[0]) ? rawPath.slice(1) : rawPath;
    if (method === "OPTIONS") return json(res, 204, {});
    const demoEndpoint =
      (path[0] === "mailboxes" && !!path[1] && path[2] === "demo-send") ||
      (path[0] === "sms" && path[1] === "messages");
    if (demoEndpoint !== (demoOnly || sameOriginDemo)) {
      if (
        !demoOnly &&
        method === "GET" &&
        rawPath[0] !== "api" &&
        rawPath[0] !== "demo" &&
        serveFrontend(req, res, rawPath)
      )
        return;
      throw new Fault(404, "Route not available on this listener");
    }
    if (path[0] === "health") return json(res, 200, { status: "ok", runId: sandbox.runId });
    if (path[0] === "identity-generation" && path[1] === "options" && method === "GET")
      return json(res, 200, generationOptions());
    if (path[0] === "admin" && path[1] === "network" && method === "PUT") {
      if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
      const values = await body(req);
      const allowed = [
        "PUBLIC_HOST",
        "HOST",
        "SMTP_HOST",
        "PORT",
        "HTTPS_PORT",
        "SMTP_PORT",
        "SMTPS_PORT",
        "DEMO_PORT",
        "DEMO_HTTPS_PORT",
      ];
      if (
        !values ||
        typeof values !== "object" ||
        Array.isArray(values) ||
        Object.keys(values).some((k) => !allowed.includes(k))
      )
        throw new Fault(400, "Unsupported setting");
      for (const [key, value] of Object.entries(values)) {
        if (typeof value !== "string" || !value || value.length > 255)
          throw new Fault(400, "Invalid setting");
        if (key.endsWith("_PORT") || key === "PORT") {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Fault(400, "Invalid port");
        } else if (!/^[a-zA-Z0-9.:-]+$/.test(value)) throw new Fault(400, "Invalid host");
      }
      const data = { ...savedSettings, ...values };
      mkdirSync(dirname(networkSettingsFile), { recursive: true, mode: 0o700 });
      const tmp = networkSettingsFile + "." + randomUUID() + ".tmp";
      writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
      renameSync(tmp, networkSettingsFile);
      sandbox.log("network.settings.updated", undefined, undefined, { keys: Object.keys(values) });
      return json(res, 202, { restartRequired: true, settings: data });
    }
    if (path.length === 2 && path[0] === "admin" && path[1] === "tls" && method === "PUT") {
      const token = process.env.ADMIN_TOKEN;
      const supplied = String(req.headers.authorization || "").replace(/^Bearer /i, "");
      if (
        !token ||
        !supplied ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new Fault(403, "Administrative authorization required");
      if (!(req.socket instanceof TLSSocket) || !req.socket.encrypted)
        throw new Fault(403, "Certificate import requires HTTPS");
      if (!tlsIdentity) throw new Fault(409, "Enable TLS before certificate import");
      const payload = await body(req);
      if (typeof payload.cert !== "string" || typeof payload.key !== "string")
        throw new Fault(400, "PEM certificate and key required");
      try {
        const details = certificateManager.activate(payload.cert, payload.key);
        tlsIdentity = certificateManager.identity;
        sandbox.log("tls.identity.activated", undefined, undefined, {
          subject: details?.subject,
          validTo: details?.validTo,
        });
        return json(res, 200, { accepted: true, restartRequired: false, active: details });
      } catch (error) {
        throw new Fault(
          400,
          error instanceof Error ? error.message : "Invalid certificate",
          "TLS_CERTIFICATE_INVALID",
        );
      }
    }

    if (path[0] === "admin" && path[1] === "tls" && path[2] === "names" && method === "PUT") {
      if (!adminAllowed(req)) throw new Fault(403, "Administrative HTTPS token required");
      if (tlsMode !== "auto") throw new Fault(409, "SAN regeneration requires TLS_MODE=auto");
      const payload = await body(req);
      if (!payload || !Array.isArray(payload.dns) || !Array.isArray(payload.ips))
        throw new Fault(400, "Invalid SAN names");
      const names = [...payload.dns, ...payload.ips];
      if (
        names.length > 50 ||
        names.some((name: unknown) => typeof name !== "string" || !/^[a-zA-Z0-9.:-]+$/.test(name))
      )
        throw new Fault(400, "Invalid SAN names");
      const base = [
        ...(process.env.TLS_SERVER_NAMES || "localhost,127.0.0.1").split(","),
        setting("PUBLIC_HOST", "localhost"),
      ];
      const identity = ensureLocalTls(tlsDirectory, [...new Set([...base, ...names])].join(","));
      const active = certificateManager.useGenerated(
        readFileSync(identity.cert),
        readFileSync(identity.key),
      );
      if (existsSync(managedIdentityFile)) {
        copyFileSync(managedIdentityFile, managedIdentityFile + ".previous");
        rmSync(managedIdentityFile, { force: true });
      }
      tlsIdentity = certificateManager.identity;
      mkdirSync(dirname(managedNamesFile), { recursive: true, mode: 0o700 });
      const temp = managedNamesFile + "." + randomUUID() + ".tmp";
      writeFileSync(temp, JSON.stringify({ dns: payload.dns, ips: payload.ips }, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temp, managedNamesFile);
      sandbox.log("tls.names.updated", undefined, undefined, { names });
      return json(res, 200, { restartRequired: false, active, names });
    }
    if (path[0] === "tls" && path[1] === "status" && method === "GET")
      return json(res, 200, { active: certificateManager.info() });
    if (path[0] === "connection-info" && method === "GET") {
      return json(res, 200, {
        host: addressHost,
        networkSettings: {
          PUBLIC_HOST: addressHost,
          HOST: apiHost,
          SMTP_HOST: smtpHost,
          PORT: String(port),
          HTTPS_PORT: String(httpsPort),
          SMTP_PORT: String(smtpPort),
          SMTPS_PORT: String(smtpsPort),
          DEMO_PORT: String(demoPort),
          DEMO_HTTPS_PORT: String(demoHttpsPort),
        },
        http: {
          port,
          httpsPort: tlsIdentity ? httpsPort : null,
          demoPort,
          demoHttpsPort: tlsIdentity ? demoHttpsPort : null,
        },
        smtp: {
          plainPort: smtpPort,
          starttls: !!tlsIdentity,
          implicitTlsPort: tlsIdentity ? smtpsPort : null,
          serverName: addressHost,
        },
        certificate: tlsIdentity
          ? {
              ...certificateManager.info(),
              download: "/tls/certificate.pem",
              caDownload: tlsMode === "auto" ? "/tls/ca.pem" : null,
            }
          : null,
      });
    }
    if (path[0] === "tls" && path[1] === "ca.pem" && method === "GET") {
      if (tlsMode !== "auto") throw new Fault(404, "Local CA not configured");
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": "attachment; filename=virtual-inbox-ca.pem",
      });
      return res.end(readFileSync(join(tlsDirectory, "ca.pem")));
    }
    if (path[0] === "tls" && path[1] === "certificate.pem" && method === "GET") {
      if (!tlsIdentity) throw new Fault(404, "TLS is not configured");
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": "attachment; filename=virtual-inbox-server.pem",
      });
      return res.end(tlsIdentity.cert);
    }
    if (path[0] === "sms" && path[1] === "messages" && method === "POST") {
      const b = await body(req);
      return json(res, 201, publicMessage(sandbox.deliver("sms", b.from, b.to, b.body)));
    }
    if (path[0] === "logs" && path[1] === "events" && method === "GET") return observe(req, res);
    if (path[0] === "logs" && method === "GET") {
      const u = new URL(req.url || "/", "http://localhost");
      return json(res, 200, sandbox.replay(u.searchParams.get("after") || undefined));
    }
    if (path[0] === "observers") {
      if (path[1] === "events" && method === "GET") return observe(req, res);
      const oid = path[1];
      if (!oid) throw new Fault(404, "Unknown observer route");
      if (path[2] === "events" && method === "GET") return observe(req, res, oid);
      if (path[2] === "inboxes" && method === "POST") {
        const b = await body(req);
        {
          const result = sandbox.watch(oid, b.inboxId);
          return json(res, 200, {
            recipient: result.recipient,
            messages: result.messages.map(publicMessage),
          });
        }
      }
      if (path[2] === "inboxes" && path[3] && method === "DELETE") {
        sandbox.unwatch(oid, path[3]);
        return json(res, 204, {});
      }
      if (path.length === 2 && method === "GET") return json(res, 200, sandbox.snapshot(oid));
    }
    if (path[0] === "mailboxes" && path[1] && path[2] === "demo-send" && method === "POST") {
      const recipient = sandbox.resource(path[1]);
      if (recipient.channel !== "email") throw new Fault(400, "Not an email inbox");
      const b = await body(req);
      const client = nodemailer.createTransport({
        host: "127.0.0.1",
        port: smtpPort,
        secure: false,
        ignoreTLS: true,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const attachments = (Array.isArray(b.attachments) ? b.attachments : []).map((a: any) => {
        if (
          typeof a.filename !== "string" ||
          typeof a.contentBase64 !== "string" ||
          !/^[a-zA-Z0-9+/]*={0,2}$/.test(a.contentBase64)
        )
          throw new Fault(400, "Invalid attachment");
        const bytes = Buffer.from(a.contentBase64, "base64");
        if (bytes.length > config.attachmentBytes) throw new Fault(413, "Attachment too large");
        return {
          filename: a.filename,
          content: bytes,
          contentType: a.contentType || "application/octet-stream",
        };
      });
      await client.sendMail({
        from: b.from || "demo@sandbox.test",
        to: recipient.address,
        subject: b.subject || "Demo",
        text: b.body || "",
        attachments,
      });
      return json(res, 202, { accepted: true });
    }
    const channel = channels[path[0]];
    if (channel) {
      const id = path[1];
      if (!id) {
        if (method === "GET") {
          const address = new URL(req.url || "/", "http://localhost").searchParams.get("address");
          if (address) {
            let match;
            try {
              match = sandbox.find(channel, address);
            } catch {}
            return json(res, 200, match ? [match] : []);
          }
          return json(res, 200, sandbox.list(channel));
        }
        if (method === "POST") {
          const b = await body(req);
          return json(
            res,
            201,
            sandbox.create(
              channel,
              channel === "email" ? b.address : b.phoneNumber,
              b.ttlSeconds,
              b.observerId,
              b.generation,
            ),
          );
        }
      }
      if (id && path.length === 2) {
        if (method === "GET") return json(res, 200, sandbox.resource(id));
        if (method === "DELETE") {
          sandbox.deleteResource(id);
          return json(res, 204, {});
        }
      }
      if (id && path[2] === "messages") {
        if (path[3] && path[4] === "attachments" && path[5] && method === "GET") {
          const m = sandbox.listMessages(id).find((x) => x.id === path[3]);
          const attachment = m?.attachments?.find((a) => a.id === path[5]);
          if (!attachment) throw new Fault(404, "Attachment not found");
          res.writeHead(200, {
            "Content-Type": attachment.contentType,
            "Content-Length": attachment.size,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `attachment; filename*=UTF-8\'\'${encodeURIComponent(sanitizeDownloadName(attachment.filename))}`,
          });
          return res.end(attachment.content);
        }
        if (path[3] && method === "GET") {
          const m = sandbox.listMessages(id).find((m) => m.id === path[3]);
          if (!m) throw new Fault(404, "Message not found");
          return json(res, 200, publicMessage(m));
        }
        if (path[3] && method === "DELETE") {
          sandbox.removeMessage(id, path[3]);
          return json(res, 204, {});
        }
        if (method === "GET") return json(res, 200, sandbox.listMessages(id).map(publicMessage));
        if (method === "DELETE") {
          sandbox.clearMessages(id);
          return json(res, 204, {});
        }
      }
      if (id && path[2] === "wait-for-message" && method === "POST") {
        const b = await body(req),
          controller = new AbortController();
        req.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const m = await sandbox.wait(id, b, controller.signal);
        return json(res, m ? 200 : 204, m ? publicMessage(m) : {});
      }
    }
    if (!demoOnly && method === "GET" && rawPath[0] !== "api" && serveFrontend(req, res, rawPath))
      return;
    throw new Fault(404, "Route not found");
  } catch (e) {
    const fault =
      e instanceof Fault ? e : new Fault(500, e instanceof Error ? e.message : "Server error");
    if (!res.headersSent)
      json(res, fault.status, {
        error: fault.message,
        errorCode: fault.code || errorCode(fault.status, fault.message),
        errorParams: {},
      });
  }
}
const http = createServer((req, res) => {
  void handleRequest(req, res);
});
const demo = createServer((req, res) => {
  void handleRequest(req, res, true);
});
http.maxConnections = config.maxConnections;
demo.maxConnections = config.maxConnections;
const smtpOptions = {
  authOptional: true,
  disabledCommands: tlsIdentity ? [] : ["STARTTLS"],
  size: smtpMessageLimit,
  ...(tlsIdentity
    ? { key: tlsIdentity.key, cert: tlsIdentity.cert, minVersion: "TLSv1.2" as const }
    : {}),
  onRcptTo(_address: unknown, _session: unknown, cb: (error?: Error | null) => void) {
    cb();
  },
  onData(stream: any, session: any, callback: any) {
    (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > smtpMessageLimit) throw new Fault(413, "MIME too large");
        chunks.push(buf);
      }
      const raw = Buffer.concat(chunks);
      const parsed = await new PostalMime().parse(raw);
      const sender =
        session.envelope.mailFrom && typeof session.envelope.mailFrom !== "boolean"
          ? session.envelope.mailFrom.address
          : "unknown@sandbox.test";
      const attachments: Attachment[] = normalizeMimeAttachments(parsed.attachments || []);
      for (const recipient of session.envelope.rcptTo)
        sandbox.deliver(
          "email",
          sender,
          recipient.address,
          parsed.text || "",
          parsed.subject,
          parsed.html || undefined,
          raw.toString("base64"),
          attachments,
        );
      callback(null, "Accepted");
    })().catch((e) => callback(e instanceof Error ? e : new Error(String(e))));
  },
};
const smtp = new SMTPServer(smtpOptions);
const smtps = tlsIdentity ? new SMTPServer({ ...smtpOptions, secure: true }) : null;
// SMTP clients can terminate during STARTTLS; smtp-server emits those
// transport errors on the server EventEmitter. Never crash the process.
for (const listener of [smtp, smtps])
  listener?.on("error", (error: Error) => {
    if (
      (error as Error & { code?: string }).code === "SocketError" &&
      error.message === "Socket closed while initiating TLS"
    )
      return;
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
      if (typeof service.updateSecureContext !== "function")
        throw Error("SMTP live TLS update unavailable");
      service.updateSecureContext({ key: next.key, cert: next.cert });
    };
    refresh(smtp);
    if (smtps) refresh(smtps);
  });
}
if (tlsMode === "external" && tlsCertPath && tlsKeyPath) {
  let previousFingerprint = certificateManager.identity
    ? createHash("sha256")
        .update(certificateManager.identity.cert)
        .update(certificateManager.identity.key)
        .digest("hex")
    : undefined;
  const externalRefresh = setInterval(() => {
    if (certificateManager.activeSource !== "external") return;
    try {
      const cert = readFileSync(tlsCertPath),
        key = readFileSync(tlsKeyPath);
      const fingerprint = createHash("sha256").update(cert).update(key).digest("hex");
      if (fingerprint === previousFingerprint) return;
      certificateManager.useExternal(cert, key);
      tlsIdentity = certificateManager.identity;
      previousFingerprint = fingerprint;
      sandbox.log("tls.external.refreshed");
    } catch (error) {
      console.error("External TLS certificate refresh rejected:", error);
    }
  }, 10000);
  externalRefresh.unref();
}
const clean = setInterval(() => sandbox.cleanup(), 1000);
clean.unref();
http.listen(port, apiHost, () => console.log("REST listening on " + port));
const https = tlsIdentity
  ? createHttpsServer(tlsIdentity, (req, res) => {
      void handleRequest(req, res);
    })
  : null;
const demoHttps = tlsIdentity
  ? createHttpsServer(tlsIdentity, (req, res) => {
      void handleRequest(req, res, true);
    })
  : null;
if (https) https.maxConnections = config.maxConnections;
if (demoHttps) demoHttps.maxConnections = config.maxConnections;
https?.listen(httpsPort, apiHost, () =>
  console.log("HTTPS and web console listening on " + httpsPort),
);
demoHttps?.listen(demoHttpsPort, apiHost, () =>
  console.log("HTTPS demo API listening on " + demoHttpsPort),
);
demo.listen(demoPort, apiHost, () => console.log("Demo API listening on " + demoPort));
smtp.listen(smtpPort, smtpHost, () => console.log("SMTP listening on " + smtpPort));
smtps?.listen(smtpsPort, smtpHost, () => console.log("SMTPS listening on " + smtpsPort));
process.on("SIGINT", () => {
  http.close();
  https?.close();
  demoHttps?.close();
  demo.close();
  smtp.close();
  smtps?.close();
  process.exit(0);
});
