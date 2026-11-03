import { randomUUID } from "node:crypto";
import { Fault } from "./domain-types.js";

export type SmtpReplyPhase = "AUTH" | "MAIL" | "RCPT" | "DATA" | "AFTER_DATA";
export type SmtpFaultAction = "reply" | "delay" | "drop" | "hang";
export type SmtpReplySelectors = {
  sender?: string;
  recipient?: string;
  clientId?: string;
  smtpSessionId?: string;
  origin?: { ip: string };
  credentialsId?: string;
};
export type SmtpReplyRule = {
  id: string;
  phase: SmtpReplyPhase;
  action: SmtpFaultAction;
  code?: number;
  durationMs?: number;
  message: string;
  remaining: number;
  priority: number;
  scope: "GLOBAL" | "SPECIFIC";
  selectors: SmtpReplySelectors;
  createdAt: string;
};
export type SmtpReplyContext = {
  sender?: string;
  recipients?: readonly string[];
  clientId?: string;
  smtpSessionId?: string;
  originIp?: string;
  credentialsId?: string;
};

const PHASES = new Set(["AUTH", "MAIL", "RCPT", "DATA", "AFTER_DATA"]);
const ACTIONS = new Set(["reply", "delay", "drop", "hang"]);
const FIELDS = new Set(["phase", "action", "code", "message", "remaining", "selectors", "durationMs", "priority"]);
const SELECTORS = new Set(["sender", "recipient", "clientId", "smtpSessionId", "origin", "credentialsId"]);
const ADDRESS_FIELDS = new Set(["sender", "recipient"]);

function invalid(message: string): never {
  throw new Fault(400, message, "INVALID_SMTP_SIMULATION");
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseSmtpReplyRule(input: unknown, maxDurationMs = 10_000): Omit<SmtpReplyRule, "id" | "createdAt"> {
  if (!record(input) || Object.keys(input).some((key) => !FIELDS.has(key)))
    invalid("Unsupported SMTP simulation fields");
  if (typeof input.phase !== "string" || !PHASES.has(input.phase))
    invalid("Only AUTH, MAIL, RCPT, DATA and AFTER_DATA phases are supported");
  if (typeof input.action !== "string" || !ACTIONS.has(input.action))
    invalid("Unsupported SMTP simulation action");
  const action = input.action as SmtpFaultAction;
  const timed = action === "delay" || action === "hang";
  if (timed) {
    if (!Number.isSafeInteger(input.durationMs) || (input.durationMs as number) < 1 ||
        (input.durationMs as number) > maxDurationMs)
      invalid("durationMs must be a positive integer within the configured limit");
  } else if (input.durationMs !== undefined) {
    invalid("durationMs is only accepted for delay or hang");
  }
  if (action === "reply" && input.code === undefined)
    invalid("Reply action requires an SMTP error code");
  if ((action === "drop" || action === "hang") && input.code !== undefined)
    invalid("Drop and hang actions cannot specify an SMTP reply code");
  if (input.code !== undefined &&
      (!Number.isInteger(input.code) || (input.code as number) < 400 || (input.code as number) > 599))
    invalid("SMTP reply code must be an integer from 400 to 599");
  if (!Number.isSafeInteger(input.remaining) || (input.remaining as number) < 1 ||
      (input.remaining as number) > 10000)
    invalid("remaining must be an integer between 1 and 10000");
  if (input.message !== undefined && (typeof input.message !== "string" ||
      input.message.length > 200 || /[\r\n\x00-\x1f\x7f]/.test(input.message)))
    invalid("SMTP reply message must be a single line of at most 200 characters");
  if (input.selectors !== undefined &&
      (!record(input.selectors) || Object.keys(input.selectors).some((key) => !SELECTORS.has(key))))
    invalid("Unsupported SMTP selector");
  if (input.priority !== undefined && (!Number.isSafeInteger(input.priority) ||
      (input.priority as number) < -10000 || (input.priority as number) > 10000))
    invalid("priority must be an integer between -10000 and 10000");
  const selectors: SmtpReplySelectors = {};
  for (const [key, value] of Object.entries((input.selectors as Record<string, unknown>) || {})) {
    if (key === "origin") {
      if (!record(value) || Object.keys(value).length !== 1 || typeof value.ip !== "string" ||
          !value.ip.trim() || value.ip.length > 128 || value.ip === "*") invalid("Invalid SMTP origin selector");
      selectors.origin = { ip: value.ip.startsWith("::ffff:") ? value.ip.slice(7) : value.ip };
      continue;
    }
    if (typeof value !== "string" || !value.trim() || value.length > 320 ||
        (ADDRESS_FIELDS.has(key) && (!value.includes("@") || /\s/.test(value))))
      invalid("Invalid SMTP selector: " + key);
    if (key === "sender" || key === "recipient")
      selectors[key] = value.toLowerCase();
    else if (key === "clientId" || key === "smtpSessionId" || key === "credentialsId")
      selectors[key] = value;
  }
  if ((input.phase === "AUTH" &&
      (selectors.sender !== undefined || selectors.recipient !== undefined || selectors.clientId !== undefined)) ||
      (input.phase === "MAIL" && selectors.recipient !== undefined))
    invalid("SMTP selector is not available during this phase");
  return {
    phase: input.phase as SmtpReplyPhase,
    action,
    ...(input.code === undefined ? {} : { code: input.code as number }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs as number }),
    message: (input.message as string | undefined) || "Simulated SMTP failure",
    remaining: input.remaining as number,
    priority: (input.priority as number | undefined) ?? 0,
    scope: Object.keys(selectors).length ? "SPECIFIC" : "GLOBAL",
    selectors,
  };
}

function matches(rule: SmtpReplyRule, context: SmtpReplyContext): boolean {
  const s = rule.selectors;
  return (s.sender === undefined || s.sender === context.sender?.toLowerCase()) &&
    (s.recipient === undefined || context.recipients?.some(
      (recipient) => recipient.toLowerCase() === s.recipient) === true) &&
    (s.clientId === undefined || s.clientId === context.clientId) &&
    (s.smtpSessionId === undefined || s.smtpSessionId === context.smtpSessionId) &&
    (s.credentialsId === undefined || s.credentialsId === context.credentialsId) &&
    (s.origin === undefined || s.origin.ip === context.originIp);
}


/**
 * In-memory SMTP reply rules. A match consumes remaining synchronously, before
 * the SMTP callback, so concurrent connections cannot both claim the last use.
 * Equal-priority rules retain insertion order.
 */
export class SmtpReplyRuleStore {
  private readonly specificRules = new Map<string, SmtpReplyRule>();
  private readonly globalRules = new Map<string, SmtpReplyRule>();
  constructor(private readonly maxRules = 1000, private readonly maxDurationMs = 10_000) {}

  create(input: unknown): SmtpReplyRule {
    const parsed = parseSmtpReplyRule(input, this.maxDurationMs);
    if (this.specificRules.size + this.globalRules.size >= this.maxRules)
      throw new Fault(507, "SMTP simulation rule capacity reached", "CAPACITY_EXCEEDED");
    const rule = { ...parsed, id: randomUUID(), createdAt: new Date().toISOString() };
    (rule.scope === "GLOBAL" ? this.globalRules : this.specificRules).set(rule.id, rule);
    return { ...rule, selectors: { ...rule.selectors } };
  }

  list(): SmtpReplyRule[] {
    return [...this.specificRules.values(), ...this.globalRules.values()]
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt))
      .map((rule) => ({ ...rule, selectors: { ...rule.selectors } }));
  }

  delete(id: string): boolean {
    return this.specificRules.delete(id) || this.globalRules.delete(id);
  }

  consume(phase: SmtpReplyPhase, context: SmtpReplyContext): SmtpReplyRule | undefined {
    // A matching specific rule always wins over a global rule, regardless of numeric priority.
    for (const collection of [this.specificRules, this.globalRules]) {
      let selected: SmtpReplyRule | undefined;
      for (const rule of collection.values()) {
        if (rule.phase !== phase || rule.remaining === 0 || !matches(rule, context)) continue;
        if (!selected || rule.priority > selected.priority) selected = rule;
      }
      if (selected) {
        selected.remaining -= 1; // synchronous: only one connection consumes the final use
        return { ...selected, selectors: { ...selected.selectors } };
      }
    }
    return undefined;
  }
}
