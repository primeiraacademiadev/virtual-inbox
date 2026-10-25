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
  Health: object({ status: { const: "ok" }, runId: uuid }, ["status", "runId"]),
  Inbox: object({
    id: uuid, channel: { enum: ["email", "sms"] }, address: string,
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: ["string", "null"], format: "date-time" }, system: boolean,
  }, ["id", "channel", "address", "createdAt", "expiresAt"]),
  Inboxes: array(reference("Inbox")),
  Attachment: object({ id: uuid, filename: string, contentType: string, size: integer }, [
    "id", "filename", "contentType", "size",
  ]),
  Message: object({
    id: uuid, sequence: integer, channel: { enum: ["email", "sms"] }, destinationId: uuid,
    from: string, originalRecipient: string, subject: string, body: string, html: string,
    receivedAt: { type: "string", format: "date-time" },
    captureReason: { enum: ["UNKNOWN_RECIPIENT", "EXPIRED_RECIPIENT"] },
    attachments: array(reference("Attachment")),
    headers: { type: "object", additionalProperties: array(string) },
    envelope: object({ mailFrom: string, rcptTo: array(string) }), smtpSessionId: uuid,
  }, ["id", "sequence", "channel", "destinationId", "from", "originalRecipient", "body", "receivedAt"]),
  Messages: array(reference("Message")),
  Generation: object({
    locale: { enum: ["pt-PT", "en-US", "fr-FR"] }, strategy: string,
    includeCountryCode: boolean, safeTestData: boolean,
  }),
  CreateMailbox: object({
    address: string, ttlSeconds: { type: "integer", minimum: 1 }, observerId: uuid,
    generation: reference("Generation"),
  }),
  CreatePhone: object({
    phoneNumber: string, ttlSeconds: { type: "integer", minimum: 1 }, observerId: uuid,
    generation: reference("Generation"),
  }),
  Wait: object({
    after: { type: "integer", minimum: 0, description: "Exclusive message sequence cursor." },
    timeoutMs: { type: "integer", minimum: 1, description: "Must not exceed MAX_WAIT_TIMEOUT_MS." },
    match: object({ from: string, bodyContains: string, htmlContains: string, subjectContains: string,
      header: object({ name: string, contains: string }) }),
  }),
  SmtpClient: object({ id: uuid, remoteAddress: string, authUser: string, firstSeenAt: string,
    lastSeenAt: string, activeSessions: integer, totalSessions: integer, authenticatedSessions: integer }),
  SmtpClients: array(reference("SmtpClient")),
  SmtpAttempt: object({ id: uuid, at: string, method: string, authUser: string, accepted: boolean }),
  SmtpSession: object({ id: uuid, clientId: uuid, remoteAddress: string, connectedAt: string,
    disconnectedAt: string, connected: boolean, authenticated: boolean, secure: boolean,
    authUser: string, authAttempts: array(reference("SmtpAttempt")), messageIds: array(uuid),
    errors: array(object({ at: string, responseCode: integer, code: string })) }),
  SmtpSessions: array(reference("SmtpSession")),
  VerifySmtp: object({ username: string, password: { type: "string", format: "password", writeOnly: true }, attemptId: uuid }, ["username", "password"]),
  VerifySmtpResult: object({ sessionId: uuid, attemptId: uuid, usernameMatches: boolean,
    passwordMatches: boolean, matches: boolean }),
  Observer: object({ observerId: uuid, inboxes: reference("Inboxes") }, ["observerId", "inboxes"]),
  Watch: object({ inboxId: uuid }, ["inboxId"]),
  WatchResult: object({ recipient: reference("Inbox"), messages: reference("Messages") }, [
    "recipient", "messages",
  ]),
  Event: object({ id: string, type: string, at: string, resourceId: uuid, messageId: uuid, data: { type: "object" } }, ["id", "type", "at"]),
  Replay: object({ events: array(reference("Event")), gap: boolean, reset: boolean, runId: uuid, oldest: string, latest: string }, ["events", "gap", "reset", "runId"]),
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
  NetworkResult: object({ restartRequired: { const: true }, settings: reference("NetworkSettings") }, ["restartRequired", "settings"]),
  ConnectionInfo: object({ host: string, networkSettings: reference("NetworkSettings"), http: { type: "object" }, smtp: { type: "object" }, certificate: { type: ["object", "null"] } }, ["host", "networkSettings", "http", "smtp", "certificate"]),
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
    method: "GET", path: `/${path}`, tag: "Events", status: 200, query: "after",
    summary: "Open an SSE stream; use Last-Event-ID or after for replay.", mediaType: "text/event-stream" }),
);

export const operations: readonly ApiOperation[] = [
  management({ id: "smtpClients", method: "GET", path: "/admin/smtp/clients", tag: "SMTP diagnostics",
    status: 200, response: "SmtpClients", admin: true, summary: "List observed SMTP clients." }),
  management({ id: "smtpSessions", method: "GET", path: "/admin/smtp/sessions", tag: "SMTP diagnostics",
    status: 200, response: "SmtpSessions", admin: true, query: "clientId", summary: "List SMTP sessions and authentication attempts." }),
  management({ id: "smtpVerify", method: "POST", path: "/admin/smtp/sessions/{sessionId}/verify", tag: "SMTP diagnostics",
    status: 200, response: "VerifySmtpResult", request: "VerifySmtp", admin: true,
    summary: "Compare supplied credentials with one recorded authentication attempt." }),
  management({ id: "health", method: "GET", path: "/health", tag: "Service", status: 200, response: "Health", summary: "Read service health and run identifier." }),
  management({ id: "openapi", method: "GET", path: "/openapi.json", tag: "Service", status: 200, response: "OpenApiDocument", summary: "Download the current management API contract." }),
  management({ id: "demoOpenapi", method: "GET", path: "/openapi-demo.json", tag: "Service", status: 200, response: "OpenApiDocument", summary: "Download the separate demo sender contract." }),
  management({ id: "generationOptions", method: "GET", path: "/identity-generation/options", tag: "Inboxes", status: 200, response: "GenerationOptions", summary: "Read supported identity strategies, locales and defaults." }),
  management({ id: "connectionInfo", method: "GET", path: "/connection-info", tag: "Service", status: 200, response: "ConnectionInfo", summary: "Discover listener ports and public TLS metadata." }),
  management({ id: "tlsStatus", method: "GET", path: "/tls/status", tag: "TLS", status: 200, response: "TlsStatus", summary: "Read the active TLS identity; never returns private keys." }),
  management({ id: "tlsCa", method: "GET", path: "/tls/ca.pem", tag: "TLS", status: 200, mediaType: "application/x-pem-file", summary: "Download the local CA public certificate (auto mode only)." }),
  management({ id: "tlsCertificate", method: "GET", path: "/tls/certificate.pem", tag: "TLS", status: 200, mediaType: "application/x-pem-file", summary: "Download the active server certificate." }),
  management({ id: "networkSettings", method: "PUT", path: "/admin/network", tag: "Administration", admin: true, status: 202, request: "NetworkSettings", response: "NetworkResult", summary: "Persist network settings. Restart is required for listeners." }),
  management({ id: "importTls", method: "PUT", path: "/admin/tls", tag: "Administration", admin: true, status: 200, request: "ImportIdentity", response: "ImportResult", summary: "Validate, persist and activate a PEM identity without restarting." }),
  management({ id: "tlsNames", method: "PUT", path: "/admin/tls/names", tag: "Administration", admin: true, status: 200, request: "TlsNames", response: "NamesResult", summary: "Replace console-managed SAN additions and regenerate in auto mode." }),
  management({ id: "logs", method: "GET", path: "/logs", tag: "Events", status: 200, query: "after", response: "Replay", summary: "Read retained events and replay gap/reset metadata." }),
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
      management({ id: `${channel}Messages`, method: "GET", path: `${path}/{inboxId}/messages`, tag, status: 200, response: "Messages", summary: "List messages in sequence order without consuming them." }),
      management({ id: `${channel}Clear`, method: "DELETE", path: `${path}/{inboxId}/messages`, tag, status: 204, summary: "Delete every message currently in the inbox." }),
      management({ id: `${channel}Message`, method: "GET", path: `${path}/{inboxId}/messages/{messageId}`, tag, status: 200, response: "Message", summary: "Read a message and attachment metadata." }),
      management({ id: `${channel}DeleteMessage`, method: "DELETE", path: `${path}/{inboxId}/messages/{messageId}`, tag, status: 204, summary: "Delete one message." }),
      management({ id: `${channel}Attachment`, method: "GET", path: `${path}/{inboxId}/messages/{messageId}/attachments/{attachmentId}`, tag, status: 200, mediaType: "application/octet-stream", summary: "Download exact attachment bytes; response Content-Type is the stored MIME type." }),
      management({ id: `${channel}Wait`, method: "POST", path: `${path}/{inboxId}/wait-for-message`, tag, status: 200, request: "Wait", response: "Message", noContent: true, summary: "Return an existing or future matching message; 204 on timeout or inbox removal." }),
    ];
  }),
  { id: "sendDemoEmail", method: "POST", path: "/mailboxes/{inboxId}/demo-send", audience: "demo", tag: "Demo", status: 202, request: "DemoEmail", response: "Accepted", summary: "Send a test email through the application's SMTP listener." },
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
    if (operation.query) parameters.push({ name: operation.query, in: "query", schema: string });
    if (operation.mediaType === "text/event-stream") parameters.push({ name: "Last-Event-ID", in: "header", schema: string });
    const success: Record<string, unknown> = { description: operation.status === 204 ? "No content." : "Success." };
    if (operation.status !== 204) success.content = {
      [operation.mediaType || "application/json"]: { schema: operation.response ? reference(operation.response) : { type: "string", ...(operation.mediaType === "application/octet-stream" ? { format: "binary" } : {}) } },
    };
    const responses: Record<string, unknown> = { [operation.status]: success };
    if (operation.noContent) responses[204] = { description: "No matching message before timeout, or the inbox was removed." };
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
    info: { title: audience === "management" ? "Virtual Inbox API" : "Virtual Inbox Demo Sender API", version: "1.0.0", description: "Generated from the HTTP route catalogue. SMTP, STARTTLS and SMTPS are documented separately; they are not HTTP operations. Message data is ephemeral. No authentication is required except for administrative writes." },
    servers: [{ url: audience === "management" ? "/api" : "/demo", description: "Same origin as the console; configurable HTTP or HTTPS listener." }],
    paths,
    components: { schemas, securitySchemes: { adminToken: { type: "http", scheme: "bearer", description: "ADMIN_TOKEN over HTTPS only; not a JWT." } } },
  };
}
