import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { handleRequest as handleHttpRequest } from "./http/request-router.js";
import { ExtensionHost, configuredExtensionFiles } from "./extension-host.js";
import { createNativeSmsExtension } from "./extensions/sms-native.js";
import { createSmtpProtocol } from "./smtp/transport.js";
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
const extensionHost = new ExtensionHost();
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

function requestState() {
  return {
    sandbox, extensionHost, credentialStore, inboxAddresses, smtpAuthPolicy, smtpSessions, simulations, smtpAttempts, smtpReplyRules, smtpRuleIdentities, smtpCredentialIds, protocolCounters, pop3Connections, lastCleanupAt, networkSettingsFile, savedSettings, setting, networkKeys, adminAllowed, port, smtpPort, pop3Port, httpsPort, smtpsPort, demoPort, demoHttpsPort, tlsMode, tlsDirectory, managedNamesFile, managedIdentityFile, effectiveTlsNames, certificateManager, addressHost, apiHost, smtpHost, allowedOrigins, allowedHosts, listenersReady, startedListeners,
    get tlsIdentity() { return tlsIdentity; },
    set tlsIdentity(value: typeof tlsIdentity) { tlsIdentity = value; },
  };
}
export type RequestContext = ReturnType<typeof requestState>;
const handleRequest = (req: IncomingMessage, res: ServerResponse, demoOnly = false) =>
  handleHttpRequest(req, res, requestState(), demoOnly);
const http = createServer((req, res) => { void handleRequest(req, res); });
const demo = createServer((req, res) => { void handleRequest(req, res, true); });
http.maxConnections = config.maxConnections;
demo.maxConnections = config.maxConnections;
function smtpContext() {
  return { sandbox, smtpAuthPolicy, smtpSessions, simulations, smtpAttempts, activeAttempts,
    smtpReplyRules, smtpRuleIdentities, smtpCredentialIds, protocolCounters,
    smtpSessionIds, tlsIdentity, smtpMessageLimit };
}
export type SmtpProtocolContext = ReturnType<typeof smtpContext>;
const { smtp, smtps } = createSmtpProtocol(smtpContext());

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
    if (process.env.VI_SMS_NATIVE_ENABLED !== "false") {
      // The existing demo sender always uses the ordinary public HTTP ingestion
      // endpoint. Loading before optional modules reserves its exact route.
      const localHost = apiHost === "0.0.0.0" ? "127.0.0.1"
        : apiHost === "::" || apiHost === "[::]" ? "[::1]" : apiHost;
      extensionHost.register(createNativeSmsExtension(
        "http://" + (localHost.includes(":") && !localHost.startsWith("[")
          ? "[" + localHost + "]" : localHost) + ":" + port + "/",
      ));
    }
    await extensionHost.loadFiles(configuredExtensionFiles(process.env.VI_EXTENSIONS));
    for (const diagnostic of extensionHost.errors) console.warn("VI extension unavailable:", diagnostic);
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
