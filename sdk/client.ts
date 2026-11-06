/** Node.js 24+ client for the Virtual Inbox test sandbox. No runtime dependencies. */
export type Channel = "email" | "sms";
export type Inbox = {
  id: string;
  channel: Channel;
  address: string;
  createdAt: string;
  expiresAt: string | null;
  system?: boolean;
};
export type AttachmentInfo = { id: string; filename: string; contentType: string; size: number };
export type MailHeader = { key: string; originalKey: string; value: string };
export type MailEnvelope = { mailFrom: string; rcptTo: string[] };
export type DecodedMailbox = { name: string; address: string };
export type InboxMessage = {
  id: string;
  sequence: number;
  channel: Channel;
  destinationId: string;
  from: string;
  originalRecipient: string;
  subject?: string;
  body: string;
  html?: string;
  headers?: MailHeader[];
  decodedFrom?: DecodedMailbox;
  envelope?: MailEnvelope;
  authUser?: string;
  smtpSessionId?: string;
  attachments?: AttachmentInfo[];
  receivedAt?: string;
  captureReason?: "UNKNOWN_RECIPIENT" | "EXPIRED_RECIPIENT";
};
/** Common public SMS ingestion contract, shared by external clients and extensions. */
export type SmsIngestion = { from: string; to: string; body: string };
export type MessageMatch = {
  from?: string;
  subjectContains?: string;
  bodyContains?: string;
  htmlContains?: string;
  header?: { name: string; valueContains: string };
};
export type WaitDiagnostic = {
  inboxId: string;
  channel: Channel;
  address: string;
  after: number;
  timeoutMs: number;
  match: MessageMatch;
  observation: "not_observed_within_window";
  /** Only the requested inbox; never unrelated anomaly inboxes or global logs. */
  recent: Array<{ id: string; sequence: number; from: string; subject?: string; receivedAt?: string }>;
  messageCount?: number;
  diagnosticErrorCode?: string;
};
export type ClientOptions = {
  /** Administrative requests only: HTTPS base URL, never plaintext HTTP. */
  adminUrl?: string;
  /** Required for every administrative operation. Never included in error diagnostics. */
  adminToken?: string;
  /** Optional transport injection, e.g. for a local HTTPS client with a pinned test CA. */
  fetch?: typeof globalThis.fetch;
};
export type SmtpSession = {
  id: string;
  clientId: string;
  connected: boolean;
  authenticated: boolean;
  connectedAt: string;
  disconnectedAt?: string;
  remoteAddress?: string;
  authUser?: string;
  testSessionId?: string;
  messageIds?: string[];
};
export type SmtpReplySelectors = {
  sender?: string;
  recipient?: string;
  clientId?: string;
  smtpSessionId?: string;
  origin?: { ip: string };
  connection?: { port: number };
  ehloName?: string;
  credentialsId?: string;
};
export type SmtpRuleInput = {
  phase: "CONNECT" | "EHLO" | "AUTH" | "MAIL" | "RCPT" | "DATA" | "AFTER_DATA";
  action: "reply" | "delay" | "drop" | "hang" | "reset";
  remaining: number;
  selectors?: SmtpReplySelectors;
  priority?: number;
  code?: number;
  durationMs?: number;
  ttlMs?: number;
  message?: string;
};
export type SmtpRule = SmtpRuleInput & { id: string; createdAt: string; expiresAt?: string; scope: "GLOBAL" | "SPECIFIC"; priority: number; selectors: SmtpReplySelectors };
export type SmtpAttemptFilter = {smtpSessionId?:string; sender?:string; recipient?:string; messageId?:string; ruleId?:string};
export type SmtpAttempt = {id:string; smtpSessionId:string; startedAt:string; updatedAt:string;
  sender?:string; recipients:string[]; messageIds:string[]; ruleIds:string[];
  outcome:string; phase:string; persisted:boolean; responseCode?:number};
export type SmtpResolveInput = { credentials?: { username: string; password: string }; origin?: { ip: string } };
export type SmtpResolveOrigin = { id: string; ip: string; connections: Array<{ id: string; credentialsIds?: string[]; connected: boolean; connectedAt: string }> };
export type SmtpResolveResult = { credentials?: { id: string; origins: SmtpResolveOrigin[] }; origins?: SmtpResolveOrigin[] };
export type LegacySimulationInput = {
  protocol: "SMTP" | "POP3";
  command: string;
  code: number;
  remaining: number;
  message?: string;
};
export type ConnectionDataSimulationInput = {
  command: "DATA";
  code: number;
  remaining: number;
  message?: string;
};
export type TestSession = { sessionId: string; inbox: string };
export type SmtpClient = { id: string; remoteAddress?: string; authUser?: string; activeSessions: number; totalSessions: number };
export type ConnectionInfo = Record<string, unknown>;
export type Readiness = { ready: boolean; runId: string; listeners: Array<{name:string; port:number; host:string}> };
export type LogEvent = { id:string; log_id:number; type:string; at:string; resourceId?:string; inboxId?:string; messageId?:string; smtpSessionId?:string; attemptId?:string; data?:Record<string,unknown> };
export type LogReplay = {events:LogEvent[];gap:boolean;reset:boolean;runId:string;oldest?:string;latest?:string;missingFrom?:number;missingTo?:number};
export type LogBaseFilters = {type?:string; inboxId?:string; messageId?:string; smtpSessionId?:string; attemptId?:string; sender?:string; recipient?:string; ruleId?:string; includeAnomalies?:boolean};
/** Replay after an SSE event ID, e.g. runId:log_id; not a message sequence or numeric cursor. */
export type LogReplayFilters = LogBaseFilters & {after?:string; from?:number; to?:number; limit?:never; before?:never};
/** Descending, bounded page; not compatible with replay/range cursors. */
export type LogPageFilters = LogBaseFilters & {limit?:number; before?:number; after?:never; from?:never; to?:never};
export type LogPage = {events:LogEvent[];nextBefore?:number;hasMore:boolean;oldest:{log_id:number;at:string}|null;latest:{log_id:number;at:string}|null;runId:string};
/** @deprecated Prefer LogReplayFilters or LogPageFilters; modes cannot be mixed. */
export type LogFilters = LogReplayFilters | LogPageFilters;

/** HTTP failures retain the structured server error and the original cause. */
export class VirtualInboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string,
    readonly errorParams: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VirtualInboxError";
  }
}

/** An absent message is not proof of SMTP rejection or non-delivery. */
export class VirtualInboxNoMessageError extends VirtualInboxError {
  constructor(readonly diagnostic: WaitDiagnostic) {
    super("No matching message observed during the wait window", 204, "NO_MESSAGE_OBSERVED");
    this.name = "VirtualInboxNoMessageError";
  }
}

function structuredError(body: string): { error?: string; errorCode?: string; errorParams?: Record<string, unknown> } {
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const data = value as Record<string, unknown>;
    return {
      error: typeof data.error === "string" ? data.error : undefined,
      errorCode: typeof data.errorCode === "string" ? data.errorCode : undefined,
      errorParams: data.errorParams && typeof data.errorParams === "object" && !Array.isArray(data.errorParams)
        ? data.errorParams as Record<string, unknown> : undefined,
    };
  } catch { return {}; }
}

/** API operations do not require a checkout or compilation of the server repository. */
export class VirtualInboxClient {
  constructor(
    readonly baseUrl = "http://127.0.0.1:3000",
    readonly options: ClientOptions = {},
  ) {}

  private administrativeUrl(): string {
    const url = this.options.adminUrl ?? (new URL(this.baseUrl).protocol === "https:" ? this.baseUrl : undefined);
    if (!url || new URL(url).protocol !== "https:" || !this.options.adminToken)
      throw new VirtualInboxError(
        "Administrative operations require an explicit HTTPS URL and admin token",
        0, "ADMIN_CONFIGURATION_REQUIRED",
      );
    return url;
  }

  private async responseError(res: Response): Promise<never> {
    const body = await res.text();
    const parsed = structuredError(body);
    throw new VirtualInboxError(
      parsed.error ?? "Virtual Inbox HTTP " + res.status,
      res.status,
      parsed.errorCode ?? "HTTP_ERROR",
      parsed.errorParams ?? {},
    );
  }

  private async fetchResponse(path: string, init?: RequestInit, admin = false): Promise<Response> {
    const root = admin ? this.administrativeUrl() : this.baseUrl;
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined) headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    if (admin) headers.set("Authorization", "Bearer " + this.options.adminToken);
    try {
      return await (this.options.fetch ?? fetch)(new URL(path, root), { ...init, headers });
    } catch (cause) {
      throw new VirtualInboxError("Virtual Inbox is unreachable", 0, "NETWORK_ERROR", {}, { cause });
    }
  }

  private async request<T>(path: string, init?: RequestInit, admin = false): Promise<T> {
    const response = await this.fetchResponse(path, init, admin);
    if (response.status === 204) return null as T;
    if (!response.ok) await this.responseError(response);
    try {
      return await response.json() as T;
    } catch (cause) {
      throw new VirtualInboxError("Invalid Virtual Inbox JSON response", response.status,
        "INVALID_RESPONSE", {}, { cause });
    }
  }

  private path(inbox: Inbox): string {
    return (inbox.channel === "email" ? "/mailboxes/" : "/phone-numbers/") +
      encodeURIComponent(inbox.id);
  }

  create(channel: Channel, address?: string, ttlSeconds = 1800, ifExists: "error" | "return" = "error"): Promise<Inbox> {
    return this.request(channel === "email" ? "/mailboxes" : "/phone-numbers", {
      method: "POST",
      body: JSON.stringify({
        [channel === "email" ? "address" : "phoneNumber"]: address,
        ttlSeconds, ...(ifExists === "return" ? { ifExists } : {}),
      }),
    });
  }

  /** Capture a synthetic SMS via the same public functional API as every other client.
   *  This is not a provider-facing/demo endpoint; extensions may invoke it without recursion.
   */
  ingestSms(input: SmsIngestion, options: { correlationId?: string } = {}): Promise<InboxMessage> {
    return this.request("/api/sms/ingestions", {
      method: "POST", body: JSON.stringify(input),
      ...(options.correlationId === undefined ? {} : { headers: { "X-VI-Correlation-ID": options.correlationId } }),
    });
  }

  /** A 503 response is returned as readiness=false, not confused with transport failure. */
  async ready(): Promise<Readiness> {
    const response = await this.fetchResponse("/ready");
    if (response.status !== 200 && response.status !== 503) await this.responseError(response);
    try {
      return await response.json() as Readiness;
    } catch (cause) {
      throw new VirtualInboxError("Invalid readiness response", response.status,
        "INVALID_RESPONSE", {}, {cause});
    }
  }

  capabilities(): Promise<{ version: string; schemaVersion: number; protocols: Record<string, boolean>; smtpAuthPolicy: "INBOX" | "OPEN"; inbox: {idempotentCreate:boolean; ifExists:string[]; reservedDomain:string}; simulation: {phases:string[]; actions:string[]} }> {
    return this.request("/capabilities");
  }

  async findInbox(channel: Channel, address: string): Promise<Inbox | null> {
    const collection = channel === "email" ? "/mailboxes" : "/phone-numbers";
    const found = await this.request<Inbox[]>(collection + "?address=" + encodeURIComponent(address));
    return found[0] ?? null;
  }

  getMessage(inbox: Inbox, messageId: string): Promise<InboxMessage> {
    return this.request(this.path(inbox) + "/messages/" + encodeURIComponent(messageId));
  }

  deleteMessage(inbox: Inbox, messageId: string): Promise<void> {
    return this.request(this.path(inbox) + "/messages/" + encodeURIComponent(messageId),
      {method:"DELETE"});
  }

  /** Replay uses a run-scoped SSE event ID; page mode uses limit/before. */
  logs(filters?: LogReplayFilters): Promise<LogReplay>;
  logs(filters: LogPageFilters & ({limit:number}|{before:number})): Promise<LogPage>;
  logs(filters: LogFilters = {}): Promise<LogReplay | LogPage> {
    const query = new URLSearchParams();
    const f = filters as Record<string, string | number | boolean | undefined>;
    const paged = f.limit !== undefined || f.before !== undefined;
    if (paged && (f.after !== undefined || f.from !== undefined || f.to !== undefined))
      throw new VirtualInboxError("Cannot mix log page and replay cursors", 0, "INVALID_LOG_FILTER");
    if ((f.from === undefined) !== (f.to === undefined) ||
        (f.from !== undefined && f.after !== undefined))
      throw new VirtualInboxError("Invalid log range combination", 0, "INVALID_LOG_FILTER");
    if (f.after !== undefined &&
        (typeof f.after !== "string" || !/^.+:[0-9]+$/.test(f.after)))
      throw new VirtualInboxError("Log replay cursor must be runId:log_id", 0, "INVALID_LOG_FILTER");
    for (const [key,value] of Object.entries(f)) {
      if (value === undefined) continue;
      if (typeof value === "number" && (!Number.isSafeInteger(value) ||
          value < (key === "limit" || key === "before" || key === "from" || key === "to" ? 1 : 0)))
        throw new VirtualInboxError("Invalid log cursor or limit", 0, "INVALID_LOG_FILTER");
      query.set(key,String(value));
    }
    return this.request("/logs" + (query.size ? "?" + query : ""));
  }

  messages(inbox: Inbox, after = 0): Promise<InboxMessage[]> {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new VirtualInboxError("Invalid message cursor", 0, "INVALID_CURSOR");
    return this.request(this.path(inbox) + "/messages" + (after ? "?after=" + after : ""));
  }

  /** Asserts absence of a matching message in the exclusive sequence window. */
  async expectNoMessage(inbox: Inbox, options: { after: number; forMs: number; match?: MessageMatch }): Promise<void> {
    if (!Number.isSafeInteger(options.after) || options.after < 0 ||
        !Number.isSafeInteger(options.forMs) || options.forMs < 1)
      throw new VirtualInboxError("Invalid negative assertion window", 0, "INVALID_WAIT_WINDOW");
    const found = await this.wait(inbox, options.match ?? {}, options.forMs, options.after);
    if (found) throw new VirtualInboxError(
      "Unexpected matching message was observed",
      0, "UNEXPECTED_MESSAGE",
      { messageId: found.id, sequence: found.sequence, inboxId: inbox.id },
    );
  }

  /** Public, filtered SMTP correlation data. No unscoped global history. */
  smtpAttempts(filter: SmtpAttemptFilter, limit = 100): Promise<SmtpAttempt[]> {
    if (!Object.values(filter).some(Boolean))
      throw new VirtualInboxError("SMTP attempt filter required", 0, "ATTEMPT_FILTER_REQUIRED");
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
    params.set("limit", String(limit));
    return this.request("/admin/smtp/attempts?" + params);
  }

  /** Wait for a completed SMTP attempt, optionally scoped by ID or start time. */
  async waitForCompletedSmtpAttempt(
    filter: SmtpAttemptFilter,
    options: { attemptId?: string; startedAfter?: string; timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<SmtpAttempt> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollIntervalMs = options.pollIntervalMs ?? 50;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
        !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 10_000)
      throw new VirtualInboxError("Invalid SMTP attempt wait window", 0, "INVALID_WAIT_WINDOW");
    if (options.startedAfter !== undefined && !Number.isFinite(Date.parse(options.startedAfter)))
      throw new VirtualInboxError("Invalid SMTP attempt start time", 0, "INVALID_WAIT_WINDOW");
    const startedAt = Date.now();
    do {
      const attempts = await this.smtpAttempts(filter, 200);
      const matching = attempts.filter(attempt =>
        (!options.attemptId || attempt.id === options.attemptId) &&
        (!options.startedAfter || Date.parse(attempt.startedAt) >= Date.parse(options.startedAfter)));
      const completed = matching.reverse().find(attempt => attempt.outcome !== "in_progress");
      if (completed) return completed;
      const left = timeoutMs - (Date.now() - startedAt);
      if (left <= 0) break;
      await new Promise<void>(done => setTimeout(done, Math.min(pollIntervalMs, left)));
    } while (true);
    throw new VirtualInboxError("SMTP attempt did not complete within the configured window",
      0, "SMTP_ATTEMPT_TIMEOUT", {filter, attemptId: options.attemptId});
  }

  clearMessages(inbox: Inbox): Promise<void> {
    return this.request(this.path(inbox) + "/messages", { method: "DELETE" });
  }

  /** HTTP 204 (timeout or removal) maps to null, never an invented rejection. */
  wait(inbox: Inbox, match: MessageMatch, timeoutMs = 10000, after = 0): Promise<InboxMessage | null> {
    return this.request(this.path(inbox) + "/wait-for-message", {
      method: "POST",
      body: JSON.stringify({ match, timeoutMs, after }),
    });
  }

  async waitOrThrow(inbox: Inbox, match: MessageMatch, timeoutMs = 10000, after = 0): Promise<InboxMessage> {
    const message = await this.wait(inbox, match, timeoutMs, after);
    if (message) return message;
    const diagnostic: WaitDiagnostic = {
      inboxId: inbox.id, channel: inbox.channel, address: inbox.address,
      match, after, timeoutMs, observation: "not_observed_within_window", recent: [],
    };
    try {
      const messages = await this.messages(inbox);
      diagnostic.messageCount = messages.length;
      diagnostic.recent = messages.slice(-5).map((item) => ({
        id: item.id, sequence: item.sequence, from: item.from,
        subject: item.subject, receivedAt: item.receivedAt,
      }));
    } catch (error) {
      diagnostic.diagnosticErrorCode = error instanceof VirtualInboxError ? error.errorCode : "DIAGNOSTIC_UNAVAILABLE";
    }
    throw new VirtualInboxNoMessageError(diagnostic);
  }

  /** Wait for the SMTP discovery reply without provisioning a reserved mailbox. */
  waitForConnectionProbe(address: string, timeoutMs = 60000, after = 0): Promise<InboxMessage | null> {
    return this.request("/connection-probes/wait-for-message", {
      method: "POST",
      body: JSON.stringify({ address, timeoutMs, after }),
    });
  }

  connectionInfo(): Promise<ConnectionInfo> {
    return this.request("/connection-info");
  }

  async download(inbox: Inbox, messageId: string, attachmentId: string): Promise<Uint8Array> {
    const path = this.path(inbox) + "/messages/" + encodeURIComponent(messageId) +
      "/attachments/" + encodeURIComponent(attachmentId);
    const response = await this.fetchResponse(path);
    if (!response.ok) await this.responseError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  delete(inbox: Inbox): Promise<void> {
    return this.request(this.path(inbox), { method: "DELETE" });
  }

  smtpSessions(clientId?: string): Promise<SmtpSession[]> {
    return this.request("/admin/smtp/sessions" +
      (clientId ? "?clientId=" + encodeURIComponent(clientId) : ""));
  }

  smtpClients(): Promise<SmtpClient[]> {
    return this.request("/admin/smtp/clients", undefined, true);
  }

  resolveSmtp(input: SmtpResolveInput): Promise<SmtpResolveResult> {
    return this.request("/admin/smtp/resolve", { method: "POST", body: JSON.stringify(input) }, true);
  }

  createSmtpRule(input: SmtpRuleInput): Promise<SmtpRule> {
    return this.request("/admin/smtp/reply-rules",
      { method: "POST", body: JSON.stringify(input) }, true);
  }

  smtpRules(): Promise<SmtpRule[]> {
    return this.request("/admin/smtp/reply-rules", undefined, true);
  }

  deleteSmtpRule(ruleId: string): Promise<void> {
    return this.request("/admin/smtp/reply-rules/" + encodeURIComponent(ruleId),
      { method: "DELETE" }, true);
  }

  /** Register a disposable rule and always attempt cleanup, including callback failures. */
  async withSmtpRule<T>(input: SmtpRuleInput, run: (rule: SmtpRule) => Promise<T>): Promise<T> {
    const rule = await this.createSmtpRule(input);
    try { return await run(rule); }
    finally { await this.deleteSmtpRule(rule.id); }
  }

  createTestSession(username: string, password: string): Promise<{ sessionId: string }> {
    return this.request("/admin/test/sessions",
      { method: "POST", body: JSON.stringify({ username, password }) }, true);
  }

  testSession(sessionId: string): Promise<TestSession> {
    return this.request("/admin/test/sessions/" + encodeURIComponent(sessionId), undefined, true);
  }

  verifyTestSession(sessionId: string, username: string, password: string): Promise<{ matches: boolean }> {
    return this.request("/admin/test/sessions/" + encodeURIComponent(sessionId) + "/verify",
      { method: "POST", body: JSON.stringify({ username, password }) }, true);
  }

  createTestSessionSimulation(sessionId: string, input: LegacySimulationInput): Promise<{ id: string }> {
    return this.request("/admin/test/sessions/" + encodeURIComponent(sessionId) + "/simulations",
      { method: "POST", body: JSON.stringify(input) }, true);
  }

  createConnectionSimulation(smtpSessionId: string, input: ConnectionDataSimulationInput): Promise<{ id: string }> {
    return this.request("/admin/smtp/sessions/" + encodeURIComponent(smtpSessionId) + "/simulations",
      { method: "POST", body: JSON.stringify(input) }, true);
  }

  async withInbox<T>(
    channel: Channel, fn: (inbox: Inbox) => Promise<T>, address?: string, ttlSeconds = 1800,
  ): Promise<T> {
    const inbox = await this.create(channel, address, ttlSeconds);
    try { return await fn(inbox); }
    finally { await this.delete(inbox); }
  }
}
