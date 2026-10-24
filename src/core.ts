import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { Fault, type Channel } from "./domain-types.js";
import {
  generateAddress,
  canonicalAddress,
  generationDefaults,
  locales,
  type Generation,
  type IdentityLocale,
} from "./identity-generation/generator.js";

export type { Channel } from "./domain-types.js";
export type Recipient = {
  id: string;
  channel: Channel;
  address: string;
  createdAt: string;
  expiresAt: string | null;
  system?: boolean;
};
export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
};
export type Message = {
  id: string;
  sequence: number;
  channel: Channel;
  destinationId: string;
  from: string;
  originalRecipient: string;
  subject?: string;
  body: string;
  html?: string;
  rawMime?: string;
  attachments?: Attachment[];
  receivedAt: string;
  captureReason?: string;
};
export type Event = {
  id: string;
  type: string;
  at: string;
  resourceId?: string;
  messageId?: string;
  data?: Record<string, unknown>;
};
export function classifyAddress(s: string): "email" | "sms" | null {
  if (s.length === 0 || s.length > 320) return null;
  const at = s.indexOf("@");
  if (at > 0 && at === s.lastIndexOf("@") && at < s.length - 1) {
    const domain = s.slice(at + 1);
    const dot = domain.indexOf(".");
    if (
      dot > 0 &&
      dot < domain.length - 1 &&
      !Array.from(s).some((c) =>
        c === "@"
          ? false
          : c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f" || c === "\v",
      )
    )
      return "email";
  }
  const digits = s.startsWith("+") ? s.slice(1) : s;
  if (digits.length > 0 && Array.from(digits).every((c) => c >= "0" && c <= "9")) {
    if (s.startsWith("+"))
      return digits[0] !== "0" && digits.length >= 7 && digits.length <= 15 ? "sms" : null;
    return digits.length >= 9 && digits.length <= 15 ? "sms" : null;
  }
  return null;
}
export const classify = classifyAddress;
export { Fault } from "./domain-types.js";
export class Sandbox {
  readonly runId = randomUUID();
  readonly emitter = new EventEmitter();
  readonly resources = new Map<string, Recipient>();
  readonly messages = new Map<string, Message>();
  readonly observers = new Map<string, { id: string; expiresAt: number; inboxes: Set<string> }>();
  readonly events: Event[] = [];
  private seq = 0;
  private expired = new Map<string, number>();
  private msgSeq = 0;
  private addressIds = new Map<string, string>();
  private resourceAliases = new Map<string, string[]>();
  readonly defaults: Record<Channel, string>;
  constructor(
    readonly capacity = config.logs,
    private readonly generateIdentity: (
      channel: Channel,
      params?: Generation,
    ) => string = generateAddress,
  ) {
    this.emitter.setMaxListeners(0);
    this.defaults = {
      email: this.addSystem("email", "anomalies@sandbox.test"),
      sms: this.addSystem("sms", "+999000000000"),
    };
  }
  private key(c: Channel, a: string) {
    return c + ":" + (c === "email" ? a.toLowerCase() : a);
  }
  private aliases(c: Channel, a: string, locale: IdentityLocale = generationDefaults.locale) {
    const keys = [this.key(c, a)];
    if (c === "sms") {
      keys.push(this.key(c, canonicalAddress(c, a, locale)));
      for (const candidate of locales) keys.push(this.key(c, canonicalAddress(c, a, candidate)));
    }
    return [...new Set(keys)];
  }
  private lookup(c: Channel, a: string) {
    for (const key of this.aliases(c, a)) {
      const id = this.addressIds.get(key);
      if (id) return id;
    }
    return undefined;
  }
  private addSystem(channel: Channel, address: string) {
    const id = randomUUID();
    this.resources.set(id, {
      id,
      channel,
      address,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      system: true,
    });
    this.addressIds.set(this.key(channel, address), id);
    this.resourceAliases.set(id, [this.key(channel, address)]);
    return id;
  }
  log(type: string, resourceId?: string, messageId?: string, data?: Record<string, unknown>) {
    const id = this.runId + ":" + ++this.seq;
    const event: Event = { id, type, at: new Date().toISOString(), resourceId, messageId, data };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    this.emitter.emit("event", event);
    return event;
  }
  resource(id: string) {
    const recipient = this.resources.get(id);
    if (!recipient || (recipient.expiresAt && Date.parse(recipient.expiresAt) <= Date.now()))
      throw new Fault(404, "Inbox not found", "INBOX_NOT_FOUND");
    return recipient;
  }
  list(channel?: Channel) {
    return [...this.resources.values()].filter(
      (recipient) => (!channel || recipient.channel === channel) &&
        (!recipient.expiresAt || Date.parse(recipient.expiresAt) > Date.now()),
    );
  }
  find(channel: Channel, address: string) {
    const id = this.lookup(channel, address);
    return id ? this.resource(id) : undefined;
  }
  create(
    channel: Channel,
    address?: string,
    ttlSeconds = config.defaultTtl,
    observerId?: string,
    generation?: Generation,
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > config.maxTtl)
      throw new Fault(400, "Invalid TTL", "INVALID_TTL");
    if (this.resources.size >= config.maxInboxes + 2)
      throw new Fault(507, "Inbox capacity reached", "CAPACITY_EXCEEDED");
    const observer = observerId ? this.observer(observerId) : null;
    const manual = !!address?.trim();
    const locale = generation?.locale ?? generationDefaults.locale;
    let generatedAddress = "";
    let aliases: string[] = [];
    for (let attempt = 0; attempt < (manual ? 1 : generationDefaults.maxAttempts); attempt++) {
      generatedAddress = manual ? address!.trim() : this.generateIdentity(channel, generation);
      if (classify(generatedAddress) !== channel) throw new Fault(400, "Invalid identifier", "INVALID_REQUEST");
      aliases = this.aliases(channel, generatedAddress, locale);
      if (aliases.every((key) => !this.addressIds.has(key))) break;
      if (manual) throw new Fault(409, "Identifier already exists", "CONFLICT");
      aliases = [];
    }
    if (!aliases.length)
      throw new Fault(409, "Generation attempts exhausted", "IDENTITY_GENERATION_EXHAUSTED");
    const recipient: Recipient = {
      id: randomUUID(), channel, address: generatedAddress,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
    this.resources.set(recipient.id, recipient);
    for (const alias of aliases) this.addressIds.set(alias, recipient.id);
    this.resourceAliases.set(recipient.id, aliases);
    observer?.inboxes.add(recipient.id);
    this.log("recipient.created", recipient.id, undefined, { channel, address: generatedAddress });
    return recipient;
  }
  deleteResource(id: string) {
    const recipient = this.resource(id);
    if (recipient.system) throw new Fault(403, "System inbox cannot be deleted");
    this.resources.delete(id);
    for (const alias of this.resourceAliases.get(id) || [this.key(recipient.channel, recipient.address)])
      this.addressIds.delete(alias);
    this.resourceAliases.delete(id);
    for (const message of this.messages.values()) if (message.destinationId === id) this.messages.delete(message.id);
    for (const observer of this.observers.values()) observer.inboxes.delete(id);
    this.emitter.emit("resource.removed", id);
    this.log("recipient.deleted", id);
  }
  deliver(
    channel: Channel, from: string, to: string, body: string,
    subject?: string, html?: string, rawMime?: string, attachments: Attachment[] = [],
  ) {
    if (!from || !to || typeof body !== "string") throw new Fault(400, "From, to and body required");
    if (body.length > config.bodyChars || (rawMime && Buffer.from(rawMime, "base64").length > config.smtpBytes))
      throw new Fault(413, "Payload too large", "MESSAGE_TOO_LARGE");
    if (channel === "sms" && Buffer.byteLength(body) > config.smsBytes) throw new Fault(413, "SMS exceeds maximum size");
    if (attachments.length > config.maxAttachments) throw new Fault(413, "Too many attachments");
    if (attachments.some((attachment) => attachment.size > config.attachmentBytes)) throw new Fault(413, "Attachment too large");
    if (this.messages.size >= config.messages) throw new Fault(507, "Message capacity reached", "CAPACITY_EXCEEDED");
    const storedBytes = [...this.messages.values()].reduce(
      (total, message) => total + Buffer.byteLength(message.body) +
        (message.rawMime ? Buffer.byteLength(message.rawMime) : 0) +
        (message.attachments || []).reduce((sum, attachment) => sum + attachment.size, 0), 0,
    );
    if (storedBytes + Buffer.byteLength(body) + (rawMime ? Buffer.byteLength(rawMime) : 0) +
      attachments.reduce((sum, attachment) => sum + attachment.size, 0) > config.storedBytes) {
      throw new Fault(507, "In-memory storage capacity reached", "CAPACITY_EXCEEDED");
    }
    const id = this.lookup(channel, to);
    const recipient = id ? this.resources.get(id) : null;
    const knownExpired = this.aliases(channel, to).some((alias) => this.expired.has(alias));
    const reason = !recipient
      ? knownExpired ? "EXPIRED_RECIPIENT" : "UNKNOWN_RECIPIENT"
      : recipient.expiresAt && Date.parse(recipient.expiresAt) <= Date.now()
        ? "EXPIRED_RECIPIENT" : undefined;
    const destinationId = reason ? this.defaults[channel] : recipient!.id;
    const message: Message = {
      id: randomUUID(), sequence: ++this.msgSeq, channel, destinationId, from,
      originalRecipient: to, body, subject, html, rawMime, attachments,
      receivedAt: new Date().toISOString(), captureReason: reason,
    };
    this.messages.set(message.id, message);
    this.log(reason ? "message.captured" : "message.received", destinationId, message.id, { reason });
    this.emitter.emit("message", message);
    return message;
  }
  listMessages(id: string) {
    this.resource(id);
    return [...this.messages.values()].filter((message) => message.destinationId === id)
      .sort((left, right) => left.sequence - right.sequence);
  }
  removeMessage(id: string, messageId: string) {
    this.resource(id);
    const message = this.messages.get(messageId);
    if (!message || message.destinationId !== id) throw new Fault(404, "Message not found", "MESSAGE_NOT_FOUND");
    this.messages.delete(messageId);
    this.log("message.deleted", id, messageId);
  }
  clearMessages(id: string) {
    for (const message of this.listMessages(id)) this.removeMessage(id, message.id);
  }
  newObserver() {
    if (this.observers.size >= config.maxObservers) throw new Fault(507, "Observer capacity reached", "CAPACITY_EXCEEDED");
    const id = randomUUID();
    this.observers.set(id, { id, expiresAt: Date.now() + config.observerTtl * 1000, inboxes: new Set() });
    return this.snapshot(id);
  }
  observer(id: string) {
    const observer = this.observers.get(id);
    if (!observer || observer.expiresAt <= Date.now()) throw new Fault(404, "Observer not found");
    observer.expiresAt = Date.now() + config.observerTtl * 1000;
    return observer;
  }
  snapshot(id: string) {
    const observer = this.observer(id);
    return { observerId: id, inboxes: [...observer.inboxes].flatMap((inboxId) => {
      try { return [this.resource(inboxId)]; } catch { return []; }
    }) };
  }
  watch(id: string, resourceId: string) {
    const observer = this.observer(id);
    const recipient = this.resource(resourceId);
    observer.inboxes.add(recipient.id);
    return { recipient, messages: this.listMessages(recipient.id) };
  }
  unwatch(id: string, resourceId: string) {
    this.observer(id).inboxes.delete(resourceId);
  }
  replay(after?: string) {
    let events = this.events;
    let gap = false;
    let reset = false;
    if (after) {
      const [run, number] = after.split(":");
      if (run !== this.runId) reset = true;
      else {
        const sequence = Number(number);
        gap = !!events.length && sequence < Number(events[0].id.split(":")[1]) - 1;
        events = events.filter((event) => Number(event.id.split(":")[1]) > sequence);
      }
    }
    return { events, gap, reset, runId: this.runId, oldest: this.events[0]?.id, latest: this.events.at(-1)?.id };
  }
  wait(
    id: string,
    { after = 0, timeoutMs = 10000, match = {} }: {
      after?: number;
      timeoutMs?: number;
      match?: { from?: string; bodyContains?: string; subjectContains?: string };
    },
    signal?: AbortSignal,
  ): Promise<Message | null> {
    this.resource(id);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > config.waitMs) throw new Fault(400, "Invalid timeout");
    const fits = (message: Message) => message.destinationId === id && message.sequence > after &&
      (!match.from || message.from === match.from) &&
      (!match.bodyContains || message.body.includes(match.bodyContains)) &&
      (!match.subjectContains || (message.subject || "").includes(match.subjectContains));
    const found = this.listMessages(id).find(fits);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      let done = false;
      const finish = (message: Message | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.emitter.off("message", onMessage);
        this.emitter.off("resource.removed", onRemove);
        signal?.removeEventListener("abort", onAbort);
        resolve(message);
      };
      const onMessage = (message: Message) => { if (fits(message)) finish(message); };
      const onRemove = (removedId: string) => { if (removedId === id) finish(null); };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.emitter.on("message", onMessage);
      this.emitter.on("resource.removed", onRemove);
      signal?.addEventListener("abort", onAbort, { once: true });
      const raced = this.listMessages(id).find(fits);
      if (raced) finish(raced);
    });
  }
  cleanup() {
    for (const recipient of [...this.resources.values()]) {
      if (!recipient.expiresAt || Date.parse(recipient.expiresAt) > Date.now()) continue;
      this.resources.delete(recipient.id);
      const aliases = this.resourceAliases.get(recipient.id) || [this.key(recipient.channel, recipient.address)];
      const expiredAt = Date.now();
      for (const alias of aliases) {
        this.addressIds.delete(alias);
        this.expired.set(alias, expiredAt);
      }
      this.resourceAliases.delete(recipient.id);
      for (const message of this.messages.values()) {
        if (message.destinationId === recipient.id) this.messages.delete(message.id);
      }
      for (const observer of this.observers.values()) observer.inboxes.delete(recipient.id);
      this.emitter.emit("resource.removed", recipient.id);
      this.log("recipient.expired", recipient.id);
    }
    for (const [id, observer] of this.observers) if (observer.expiresAt <= Date.now()) this.observers.delete(id);
    for (const [key, at] of this.expired) if (at < Date.now() - config.maxTtl * 1000) this.expired.delete(key);
  }
}
