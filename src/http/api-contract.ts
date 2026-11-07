export type ApiAudience = "management" | "demo";
export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";
type Schema = Record<string, unknown>;

export interface ApiOperation {
  id: string;
  method: ApiMethod;
  path: string;
  summary: string;
  audience: ApiAudience;
  tag: string;
  status: number;
  response?: string;
  request?: string;
  query?: string;
  admin?: boolean;
  mediaType?: string;
  noContent?: boolean;
}

const string: Schema = { type: "string" };
const uuid: Schema = { type: "string", format: "uuid" };
const integer: Schema = { type: "integer" };
const boolean: Schema = { type: "boolean" };
const reference = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema): Schema => ({ type: "array", items });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

export const schemas: Record<string, Schema> = {
  Error: object({ error: string, errorCode: string, errorParams: { type: "object" } }, [
    "error", "errorCode", "errorParams",
  ]),
  ExtensionMetrics: object({ count: integer, errors: integer, totalDurationMs: integer, lastStatus: integer },
    ["count", "errors", "totalDurationMs"]),
  ExtensionRoute: object({ method: string, audience: { enum: ["management", "demo"] },
    path: string, publicPaths: array(string) }, ["method", "audience", "path", "publicPaths"]),
  ExtensionRegistryEntry: object({
    id: string, displayName: string, version: string,
    state: { enum: ["active", "failed", "disabled"] },
    capabilities: array(string), documentation: string,
    routes: array(reference("ExtensionRoute")), metrics: reference("ExtensionMetrics"),
    diagnosticCode: string,
  }, ["id", "displayName", "version", "state", "capabilities", "routes", "metrics"]),
  ExtensionRegistry: array(reference("ExtensionRegistryEntry")),
  Health: object({ status: { const: "ok" }, runId: uuid }, ["status", "runId"]),
  Readiness: object({ ready: boolean, runId: uuid, listeners: array(object({ name: string, port: integer, host: string })) }, ["ready", "runId", "listeners"]),
  Capabilities: object({ version: string, schemaVersion: integer, protocols: { type: "object" }, smtpAuthPolicy: { enum: ["INBOX", "OPEN"] }, inbox: { type: "object" }, simulation: { type: "object" } }, ["version", "schemaVersion", "protocols", "smtpAuthPolicy", "inbox", "simulation"]),
  Inbox: object({
    id: uuid, channel: { enum: ["email", "sms"] }, address: string,
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: ["string", "null"], format: "date-time" }, system: boolean,
  }, ["id", "channel", "address", "createdAt", "expiresAt"]),
  Inboxes: array(reference("Inbox")),
  Attachment: object({ id: uuid, filename: string, contentType: string, size: integer }, [
    "id", "filename", "contentType", "size",
  ]),
  MailHeader: object({
    key: string, originalKey: string, value: string,
  }, ["key", "originalKey", "value"]),
  MailEnvelope: object({
    mailFrom: string, rcptTo: array(string),
  }, ["mailFrom", "rcptTo"]),
  DecodedMailbox: object({
    name: string, address: string,
  }, ["name", "address"]),
  Message: object({
    id: uuid, sequence: integer, channel: { enum: ["email", "sms"] }, destinationId: uuid,
    from: string, originalRecipient: string, subject: string, body: string, html: string,
    headers: array(reference("MailHeader")),
    decodedFrom: reference("DecodedMailbox"),
    envelope: reference("MailEnvelope"),
    authUser: { type: "string", description: "Accepted SMTP AUTH username only; never the password." },
    smtpSessionId: uuid,
    receivedAt: { type: "string", format: "date-time" },
    captureReason: { enum: ["UNKNOWN_RECIPIENT", "EXPIRED_RECIPIENT"] },
    attachments: array(reference("Attachment")),
  }, ["id", "sequence", "channel", "destinationId", "from", "originalRecipient", "body", "receivedAt"]),
  Messages: array(reference("Message")),
  Generation: object({
    locale: { enum: ["pt-PT", "en-US", "fr-FR"] }, strategy: string,
    includeCountryCode: boolean, safeTestData: boolean,
  }),
  CreateMailbox: object({
    address: string, ttlSeconds: { type: "integer", minimum: 1 }, observerId: uuid,
    generation: reference("Generation"), ifExists: { enum: ["error", "return"] },
  }),
  CreatePhone: object({
    phoneNumber: string, ttlSeconds: { type: "integer", minimum: 1 }, observerId: uuid,
    generation: reference("Generation"), ifExists: { enum: ["error", "return"] },
  }),
  ConnectionProbeWait: object({
    address: { type: "string", pattern: "^[a-fA-F0-9]{32}@virtual[.]inbox$", description: "Reserved nonce address. Request does not create an inbox." },
    after: { type: "integer", minimum: 0 },
    timeoutMs: { type: "integer", minimum: 1, maximum: 60000 },
  }, ["address"]),
  Wait: object({
    after: { type: "integer", minimum: 0, description: "Exclusive message sequence cursor." },
    timeoutMs: { type: "integer", minimum: 1, description: "Must not exceed MAX_WAIT_TIMEOUT_MS." },
    match: object({
      from: string,
      bodyContains: { type: "string", description: "Matches plain-text body or raw HTML." },
      htmlContains: { type: "string", description: "Matches raw HTML only." },
      subjectContains: string,
      header: object({
        name: { type: "string", description: "Case-insensitive MIME header name." },
        valueContains: { type: "string", description: "Case-sensitive substring of an unfolded header value." },
      }, ["name", "valueContains"]),
    }),
  }),
  SmtpClients: array(object({ id: uuid, remoteAddress: string, authUser: string, activeSessions: integer, totalSessions: integer })),
  SmtpSessions: array(object({ id: uuid, clientId: uuid, remoteAddress: string, connectedAt: string,
    lastActivityAt: string, disconnectedAt: string, connected: boolean, authenticated: boolean, secure: boolean,
    authUser: string, authAttempts: array(object({ id: uuid, at: string, method: string, authUser: string, accepted: boolean })),
    messageIds: array(string), errors: array(object({ at: string, responseCode: integer, code: string })) })),
  Pop3Connections: array(object({ id: uuid, remoteAddress: string, connectedAt: string,
    lastActivityAt: string, disconnectedAt: string, connected: boolean, authenticated: boolean,
    inbox: string, testSessionId: uuid })),
  ApplicationFootprint: object({
    runId: uuid, uptimeSeconds: integer, capturedAt: string,
    memory: object({ rss: integer, heapUsed: integer, heapTotal: integer, external: integer, arrayBuffers: integer }),
    resources: { type: "object", additionalProperties: integer },
    protocols: { type: "object" },
    cleanup: object({ lastAt: { type: ["string", "null"] } }),
  }),
  SmtpReplySelectors: object({ sender: string, recipient: string, clientId: uuid, smtpSessionId: uuid,
    origin: object({ ip: string }, ["ip"]), credentialsId: uuid,
    connection: object({ port: { type: "integer", minimum: 1, maximum: 65535 } }, ["port"]), ehloName: string }),
  SmtpResolveInput: object({
    credentials: object({ username: string, password: { type: "string", format: "password", writeOnly: true } }, ["username", "password"]),
    origin: object({ ip: string }, ["ip"]),
  }),
  SmtpResolveResult: object({
    credentials: object({ id: uuid, origins: array(reference("SmtpResolveOrigin")) }, ["id", "origins"]),
    origins: array(reference("SmtpResolveOrigin")),
  }),
  SmtpResolveOrigin: object({ id: uuid, ip: string, connections: array(object({
    id: uuid, credentialsIds: array(uuid), connected: boolean, connectedAt: string,
  }, ["id", "connected", "connectedAt"])) }, ["id", "ip", "connections"]),
  SmtpReplyRuleInput: object({
    phase: { enum: ["CONNECT", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "AFTER_DATA"] }, action: { enum: ["reply", "delay", "drop", "hang", "reset"] },
    code: { type: "integer", minimum: 400, maximum: 599 },
    message: string, durationMs: { type: "integer", minimum: 1 },
    ttlMs: { type: "integer", minimum: 1, maximum: 86400000 }, remaining: { type: "integer", minimum: 1, maximum: 10000 },
    priority: { type: "integer", minimum: -10000, maximum: 10000 }, selectors: reference("SmtpReplySelectors"),
  }, ["phase", "action", "remaining"]),
  SmtpReplyRule: object({
    id: uuid, phase: { enum: ["CONNECT", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "AFTER_DATA"] }, action: { enum: ["reply", "delay", "drop", "hang", "reset"] },
    code: integer, message: string, durationMs: integer,
    ttlMs: integer, expiresAt: { type: "string", format: "date-time" }, remaining: integer,
    priority: integer, scope: { enum: ["GLOBAL", "SPECIFIC"] },
    selectors: reference("SmtpReplySelectors"), createdAt: string,
  }, ["id", "phase", "action", "remaining", "priority", "scope", "selectors", "createdAt"]),
  SmtpReplyRules: array(reference("SmtpReplyRule")),
  SmtpAttempts: array(object({ id: uuid, smtpSessionId: uuid, sender: string, recipients: array(string), messageIds: array(string), ruleIds: array(string), phase: string, outcome: string, persisted: boolean, responseCode: integer })),
  TestSessionCredentials: object({ username: string, password: { type: "string", format: "password", writeOnly: true } }, ["username", "password"]),
  TestSessionId: object({ sessionId: uuid }, ["sessionId"]),
  TestSession: object({ sessionId: uuid, inbox: string }, ["sessionId", "inbox"]),
  TestSessionVerification: object({ matches: boolean }, ["matches"]),
  VerifySmtp: object({ username: string, password: { type: "string", format: "password", writeOnly: true }, attemptId: uuid }, ["username", "password"]),
  VerifySmtpResult: object({ sessionId: uuid, attemptId: uuid, usernameMatches: boolean, passwordMatches: boolean, matches: boolean }),
  Observer: object({ observerId: uuid, inboxes: reference("Inboxes") }, ["observerId", "inboxes"]),
  Watch: object({ inboxId: uuid }, ["inboxId"]),
  WatchResult: object({ recipient: reference("Inbox"), messages: reference("Messages") }, [
    "recipient", "messages",
  ]),
  Event: object({ id: string, log_id: integer, type: string, at: string, resourceId: uuid, inboxId: uuid, messageId: uuid, smtpSessionId: string, attemptId: string, data: { type: "object" } }, ["id", "log_id", "type", "at"]),
  Replay: object({ events: array(reference("Event")), gap: boolean, reset: boolean, runId: uuid, oldest: string, latest: string, missingFrom: integer, missingTo: integer }, ["events", "gap", "reset", "runId"]),
  LogPage: object({ events: array(reference("Event")), nextBefore: integer, hasMore: boolean,
    oldest: {type:["object","null"]}, latest: {type:["object","null"]}, runId: uuid },
    ["events","hasMore","oldest","latest","runId"]),
  LogResponse: { oneOf: [reference("Replay"),reference("LogPage")] },
  Identity: object({ source: { enum: ["automatic", "external", "uploaded"] }, subject: string,
    issuer: string, validTo: string, fingerprint256: string, subjectAltName: string }, [
    "source", "subject", "issuer", "validTo", "fingerprint256", "subjectAltName",
  ]),
  TlsStatus: object({ active: { anyOf: [reference("Identity"), { type: "null" }] } }, ["active"]),
  ImportIdentity: object({ cert: { type: "string", description: "PEM leaf followed by intermediate certificates." }, key: { type: "string", writeOnly: true, description: "Matching, unencrypted PEM private key. Never include in logs or examples." } }, ["cert", "key"]),
  ImportResult: object({ accepted: { const: true }, restartRequired: { const: false }, active: reference("Identity") }, ["accepted", "restartRequired", "active"]),
  TlsNames: object({ dns: array(string), ips: array(string) }, ["dns", "ips"]),
  NamesResult: object({ restartRequired: { const: false }, active: reference("Identity"), names: array(string) }, ["restartRequired", "active", "names"]),
  NetworkSettings: object(Object.fromEntries([
    "PUBLIC_HOST", "HOST", "SMTP_HOST", "PORT", "HTTPS_PORT", "SMTP_PORT", "SMTPS_PORT", "DEMO_PORT", "DEMO_HTTPS_PORT",
  ].map((name) => [name, string]))),
  NetworkResult: object({ restartRequired: { const: true }, settings: reference("NetworkSettings"), environmentControlledKeys: array(string) }, ["restartRequired", "settings"]),
  ConnectionInfo: object({ host: string, networkSettings: reference("NetworkSettings"), environmentControlledKeys: array(string), smsRouting: object({ defaultCountryCode: { type: ["string", "null"] } }, ["defaultCountryCode"]), http: { type: "object" }, smtp: { type: "object" }, certificate: { type: ["object", "null"] } }, ["host", "networkSettings", "http", "smtp", "certificate", "smsRouting"]),
  GenerationOptions: { type: "object", description: "Supported locales, strategies and configured generation defaults." },
  SmsInput: object({ from: string, to: string, body: string }, ["from", "to", "body"]),
  DemoEmail: object({ from: string, subject: string, body: string, attachments: array(object({ filename: string, contentType: string, contentBase64: { type: "string", contentEncoding: "base64" } }, ["filename", "contentBase64"])) }),
  Accepted: object({ accepted: { const: true } }, ["accepted"]),
  OpenApiDocument: { type: "object", description: "The generated OpenAPI 3.1.0 document." },
};

const management = (operation: Omit<ApiOperation, "audience">): ApiOperation => ({
  ...operation, audience: "management",
});
const streams = ["logs/events", "observers/events", "observers/{observerId}/events"].map(
  (path, index) => management({ id: ["logEvents", "newObserverEvents", "observerEvents"][index],
    method: "GET", path: `/${path}`, tag: "Events", status: 200, query: "after,type,inboxId,messageId,smtpSessionId,attemptId,sender,recipient,ruleId,extensionId,includeAnomalies",
    summary: "Open an SSE stream; use Last-Event-ID or after for replay.", mediaType: "text/event-stream" }),
);

export const operations: readonly ApiOperation[] = [
  management({ id: "popConnections", method: "GET", path: "/admin/pop3/connections", tag: "POP3 diagnostics", status: 200,
    response: "Pop3Connections", admin: true, summary: "List active and recently closed POP3 connections (bounded retention)." }),
  management({ id: "applicationFootprint", method: "GET", path: "/admin/footprint", tag: "Administration", status: 200,
    response: "ApplicationFootprint", admin: true, summary: "Read process memory, resource counts and retention without secrets." }),
  management({ id: "protocolMetrics", method: "GET", path: "/admin/test/metrics", tag: "Test", status: 200, admin: true, summary: "Read protocol metrics." }),

  management({ id: "connectionProbeWait", method: "POST",
    path: "/connection-probes/wait-for-message", tag: "SMTP diagnostics", status: 200,
    request: "ConnectionProbeWait", response: "Message", noContent: true,
    summary: "Wait up to 60 seconds for an SMTP probe reply, even before its reserved inbox is created; never creates or renews a mailbox." }),
  management({ id: "smtpRuleResolve", method: "POST", path: "/admin/smtp/resolve", tag: "SMTP simulations",
    status: 200, admin: true, request: "SmtpResolveInput", response: "SmtpResolveResult",
    summary: "Resolve credentials and/or origin before SMTP AUTH; observed connections are never fabricated." }),
  management({ id: "smtpReplyRuleCreate", method: "POST", path: "/admin/smtp/reply-rules", tag: "SMTP simulations", status: 201, admin: true, request: "SmtpReplyRuleInput", response: "SmtpReplyRule", summary: "Create a scoped SMTP rule for CONNECT, EHLO, AUTH or mail phases. Missing selectors mean GLOBAL; present selectors use AND." }),
  management({ id: "smtpReplyRuleList", method: "GET", path: "/admin/smtp/reply-rules", tag: "SMTP simulations", status: 200, admin: true, response: "SmtpReplyRules", summary: "List SMTP reply rules." }),
  management({ id: "smtpReplyRuleDelete", method: "DELETE", path: "/admin/smtp/reply-rules/{ruleId}", tag: "SMTP simulations", status: 204, admin: true, summary: "Remove an SMTP reply rule." }),
  management({ id: "smtpConnectionSimulationCreate", method: "POST", path: "/admin/smtp/sessions/{sessionId}/simulations", tag: "SMTP diagnostics", status: 201, admin: true, summary: "Inject a DATA failure on an active SMTP connection." }),
  management({ id: "smtpConnectionSimulationList", method: "GET", path: "/admin/smtp/sessions/{sessionId}/simulations", tag: "SMTP diagnostics", status: 200, admin: true, summary: "List connection-scoped simulation rules." }),
  management({ id: "smtpConnectionSimulationDelete", method: "DELETE", path: "/admin/smtp/sessions/{sessionId}/simulations/{ruleId}", tag: "SMTP diagnostics", status: 204, admin: true, summary: "Delete a connection simulation." }),
  management({ id: "simulationDelete", method: "DELETE", path: "/admin/test/sessions/{sessionId}/simulations/{ruleId}", tag: "Test simulations", status: 204, admin: true, summary: "Delete configured fault." }),
  management({ id: "simulationCreate", method: "POST", path: "/admin/test/sessions/{sessionId}/simulations", tag: "Test", status: 201, admin: true, summary: "Create fault" }),
  management({ id: "simulationList", method: "GET", path: "/admin/test/sessions/{sessionId}/simulations", tag: "Test", status: 200, admin: true, summary: "List faults" }),
  management({ id: "testSessionCreate", method: "POST", path: "/admin/test/sessions", tag: "Test sessions", admin: true, status: 201, request: "TestSessionCredentials", response: "TestSessionId", summary: "Resolve or create a test session for an existing, unexpired inbox and password." }),
  management({ id: "testSessionGet", method: "GET", path: "/admin/test/sessions/{sessionId}", tag: "Test sessions", admin: true, status: 200, response: "TestSession", summary: "Resolve the inbox of a logical test session." }),
  management({ id: "testSessionVerify", method: "POST", path: "/admin/test/sessions/{sessionId}/verify", tag: "Test sessions", admin: true, status: 200, request: "TestSessionCredentials", response: "TestSessionVerification", summary: "Verify credentials against a shared SMTP/POP3 test session." }),
  management({ id: "smtpAttempts", method: "GET", path: "/admin/smtp/attempts", tag: "SMTP diagnostics", status: 200, response: "SmtpAttempts", summary: "Inspect bounded, filtered SMTP transaction attempts." }),
  management({ id: "smtpClients", method: "GET", path: "/admin/smtp/clients", tag: "SMTP diagnostics", status: 200, response: "SmtpClients", admin: true, summary: "List observed SMTP clients." }),
  management({ id: "smtpSessions", method: "GET", path: "/admin/smtp/sessions", tag: "SMTP diagnostics", status: 200, response: "SmtpSessions", query: "clientId", summary: "List SMTP sessions." }),
  management({ id: "smtpVerify", method: "POST", path: "/admin/smtp/sessions/{sessionId}/verify", tag: "SMTP diagnostics", status: 200, response: "VerifySmtpResult", request: "VerifySmtp", admin: true, summary: "Revalidate recorded SMTP credentials." }),
  management({ id: "capabilities", method: "GET", path: "/capabilities", tag: "Service", status: 200, response: "Capabilities", summary: "Read version, protocols, SMTP AUTH policy and simulation support." }),
  management({ id: "ready", method: "GET", path: "/ready", tag: "Service", status: 200, response: "Readiness", summary: "Ready only when all configured listeners are listening." }),
  management({ id: "health", method: "GET", path: "/health", tag: "Service", status: 200, response: "Health", summary: "Read service health and run identifier." }),
  management({ id: "openapi", method: "GET", path: "/openapi.json", tag: "Service", status: 200, response: "OpenApiDocument", summary: "Download the current management API contract." }),
  management({ id: "demoOpenapi", method: "GET", path: "/openapi-demo.json", tag: "Service", status: 200, response: "OpenApiDocument", summary: "Download the separate demo sender contract." }),
  management({ id: "generationOptions", method: "GET", path: "/identity-generation/options", tag: "Inboxes", status: 200, response: "GenerationOptions", summary: "Read supported identity strategies, locales and defaults." }),
  management({ id: "extensionRegistry", method: "GET", path: "/extensions", tag: "Extensions",
    status: 200, response: "ExtensionRegistry", summary: "Discover installed and failed extensions, their published endpoints and bounded metrics." }),
  management({ id: "connectionInfo", method: "GET", path: "/connection-info", tag: "Service", status: 200, response: "ConnectionInfo", summary: "Discover listener ports and public TLS metadata." }),
  management({ id: "tlsStatus", method: "GET", path: "/tls/status", tag: "TLS", status: 200, response: "TlsStatus", summary: "Read the active TLS identity; never returns private keys." }),
  management({ id: "tlsCa", method: "GET", path: "/tls/ca.pem", tag: "TLS", status: 200, mediaType: "application/x-pem-file", summary: "Download the local CA public certificate (auto mode only)." }),
  management({ id: "tlsCertificate", method: "GET", path: "/tls/certificate.pem", tag: "TLS", status: 200, mediaType: "application/x-pem-file", summary: "Download the active server certificate." }),
  management({ id: "networkSettings", method: "PUT", path: "/admin/network", tag: "Administration", admin: true, status: 202, request: "NetworkSettings", response: "NetworkResult", summary: "Persist network settings. Restart is required for listeners." }),
  management({ id: "importTls", method: "PUT", path: "/admin/tls", tag: "Administration", admin: true, status: 200, request: "ImportIdentity", response: "ImportResult", summary: "Validate, persist and activate a PEM identity without restarting." }),
  management({ id: "tlsNames", method: "PUT", path: "/admin/tls/names", tag: "Administration", admin: true, status: 200, request: "TlsNames", response: "NamesResult", summary: "Replace console-managed SAN additions and regenerate in auto mode." }),
  management({ id: "logs", method: "GET", path: "/logs", tag: "Events", status: 200, query: "after,limit,before,from,to,type,inboxId,messageId,smtpSessionId,attemptId,sender,recipient,ruleId,includeAnomalies", response: "LogResponse", summary: "Read retained events and replay gap/reset metadata." }),
  ...streams,
  management({ id: "observerSnapshot", method: "GET", path: "/observers/{observerId}", tag: "Events", status: 200, response: "Observer", summary: "Read subscriptions and renew the observer session." }),
  management({ id: "watchInbox", method: "POST", path: "/observers/{observerId}/inboxes", tag: "Events", status: 200, request: "Watch", response: "WatchResult", summary: "Subscribe an observer; returns the inbox and existing messages." }),
  management({ id: "unwatchInbox", method: "DELETE", path: "/observers/{observerId}/inboxes/{inboxId}", tag: "Events", status: 204, summary: "Remove a subscription without deleting the inbox." }),
  ...(["email", "sms"] as const).flatMap((channel) => {
    const collection = channel === "email" ? "mailboxes" : "phone-numbers";
    const path = `/${collection}`;
    const tag = "Inboxes";
    return [
      management({ id: `${channel}List`, method: "GET", path, tag, status: 200, response: "Inboxes", query: "address", summary: "List active inboxes, or look up an address (zero or one result)." }),
      management({ id: `${channel}Create`, method: "POST", path, tag, status: 201, request: channel === "email" ? "CreateMailbox" : "CreatePhone", response: "Inbox", summary: "Create an inbox with an explicit or generated address." }),
      management({ id: `${channel}Get`, method: "GET", path: `${path}/{inboxId}`, tag, status: 200, response: "Inbox", summary: "Read an active inbox." }),
      management({ id: `${channel}Delete`, method: "DELETE", path: `${path}/{inboxId}`, tag, status: 204, summary: "Delete an inbox and its messages. System inboxes cannot be deleted." }),
      management({ id: `${channel}Messages`, method: "GET", path: `${path}/{inboxId}/messages`, tag, status: 200, response: "Messages", query: "after,originalRecipient,from,captureReason,smtpSessionId,authUser", summary: "List and exactly filter messages without consuming them, including captures in system anomaly inboxes." }),
      management({ id: `${channel}Clear`, method: "DELETE", path: `${path}/{inboxId}/messages`, tag, status: 204, summary: "Delete every message currently in the inbox." }),
      management({ id: `${channel}Message`, method: "GET", path: `${path}/{inboxId}/messages/{messageId}`, tag, status: 200, response: "Message", summary: "Read a message and attachment metadata." }),
      management({ id: `${channel}DeleteMessage`, method: "DELETE", path: `${path}/{inboxId}/messages/{messageId}`, tag, status: 204, summary: "Delete one message." }),
      management({ id: `${channel}Attachment`, method: "GET", path: `${path}/{inboxId}/messages/{messageId}/attachments/{attachmentId}`, tag, status: 200, mediaType: "application/octet-stream", summary: "Download exact attachment bytes; response Content-Type is the stored MIME type." }),
      management({ id: `${channel}Wait`, method: "POST", path: `${path}/{inboxId}/wait-for-message`, tag, status: 200, request: "Wait", response: "Message", noContent: true, summary: "Return an existing or future matching message; 204 on timeout or inbox removal." }),
    ];
  }),
  { id: "sendDemoEmail", method: "POST", path: "/mailboxes/{inboxId}/demo-send", audience: "demo", tag: "Demo", status: 202, request: "DemoEmail", response: "Accepted", summary: "Send a test email through the application's SMTP listener." },
  management({ id: "ingestSms", method: "POST", path: "/sms/ingestions", tag: "SMS", status: 201, request: "SmsInput", response: "Message", summary: "Capture a simulated SMS through the common public functional API; available to every client including extensions." }),
  { id: "sendSms", method: "POST", path: "/sms/messages", audience: "demo", tag: "Demo", status: 201, request: "SmsInput", response: "Message", summary: "Capture a simulated SMS. No external carrier is contacted." },
];

export function matchApiOperation(method: string, path: readonly string[], audience: ApiAudience) {
  for (const operation of operations) {
    if (operation.method !== method || operation.audience !== audience) continue;
    const segments = operation.path.slice(1).split("/");
    if (segments.length !== path.length) continue;
    const params: Record<string, string> = {};
    const matches = segments.every((segment, index) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        params[segment.slice(1, -1)] = path[index];
        return path[index].length > 0;
      }
      return segment === path[index];
    });
    if (matches) return { operation, params };
  }
  return null;
}

export function createOpenApiDocument(audience: ApiAudience = "management") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations.filter((item) => item.audience === audience)) {
    const parameters: Record<string, unknown>[] = [];
    for (const segment of operation.path.split("/")) {
      if (segment.startsWith("{")) parameters.push({ name: segment.slice(1, -1), in: "path", required: true, schema: uuid });
    }
    if (operation.query) for (const name of operation.query.split(","))
      parameters.push({ name, in: "query", schema: string });
    if (operation.mediaType === "text/event-stream") parameters.push({ name: "Last-Event-ID", in: "header", schema: string });
    if (operation.id === "ingestSms") parameters.push({ name: "X-VI-Correlation-ID", in: "header", required: false, description: "Optional untrusted diagnostic token (1-128 safe ASCII characters); echoed on successful ingestion.", schema: string });
    const success: Record<string, unknown> = { description: operation.status === 204 ? "No content." : "Success." };
    if (operation.status !== 204) success.content = {
      [operation.mediaType || "application/json"]: { schema: operation.response ? reference(operation.response) : { type: "string", ...(operation.mediaType === "application/octet-stream" ? { format: "binary" } : {}) } },
    };
    const responses: Record<string, unknown> = { [operation.status]: success };
    if (operation.noContent) responses[204] = { description: "No matching message before timeout, or the inbox was removed." };
    if (operation.id === "ready") responses[503] = { description: "Listeners not yet ready.",
      content: { "application/json": { schema: reference("Readiness") } } };
    for (const status of [400, 403, 404, 409, 413, 421, 500, 507]) responses[status] = { description: `Request failed (${status}); inspect errorCode.`, content: { "application/json": { schema: reference("Error") } } };
    const value: Record<string, unknown> = {
      operationId: operation.id, summary: operation.summary, tags: [operation.tag], parameters,
      security: operation.admin ? [{ adminToken: [] }] : [], responses,
    };
    if (operation.admin) value.description = "Requires a TLS connection and Authorization: Bearer <ADMIN_TOKEN>. HTTP is rejected even with a valid token.";
    if (operation.request) value.requestBody = { required: true, content: { "application/json": { schema: reference(operation.request) } } };
    if (operation.mediaType === "text/event-stream") value["x-sse-events"] = ["session.initialized", "session.restored", "log", "log.gap", "log.reset", "inbox.notification"];
    (paths[operation.path] ||= {})[operation.method.toLowerCase()] = value;
  }
  return {
    openapi: "3.1.0",
    info: { title: audience === "management" ? "Virtual Inbox API" : "Virtual Inbox Demo Sender API", version: "1.0.0", description: "Generated from the HTTP route catalogue. SMTP, STARTTLS and SMTPS are documented separately; they are not HTTP operations. Message data is ephemeral. Test-data reads are open; some administrative diagnostic reads, credential verification, and administrative mutations require HTTPS plus ADMIN_TOKEN." },
    servers: [{ url: audience === "management" ? "/api" : "/demo", description: "Same origin as the console; configurable HTTP or HTTPS listener." }],
    paths,
    components: { schemas, securitySchemes: { adminToken: { type: "http", scheme: "bearer", description: "ADMIN_TOKEN over HTTPS only; not a JWT." } } },
  };
}
