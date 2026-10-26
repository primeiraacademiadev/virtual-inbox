import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { Fault } from "./domain-types.js";

const OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(secret, salt, 32, OPTIONS,
    (error, key) => error ? reject(error) : resolve(key)));
}
type Entry = { id: string; digest: Buffer; createdAt: string };
type InboxRecord = { salt: Buffer; sessions: Map<string, Entry> };

/** Disposable sandbox identity: one stable salt per inbox; password distinguishes sessions. */
export class InboxCredentialStore {
  private readonly inboxes = new Map<string, InboxRecord>();
  private readonly byId = new Map<string, { inbox: string; entry: Entry }>();
  private normalize(inbox: string) {
    if (typeof inbox !== "string" || !inbox.trim()) throw new Fault(400, "Inbox required", "INVALID_INBOX");
    return inbox.trim().toLowerCase();
  }
  createInbox(inbox: string): void {
    const name = this.normalize(inbox);
    if (!this.inboxes.has(name)) this.inboxes.set(name, { salt: randomBytes(16), sessions: new Map() });
  }
  async authenticate(inbox: string, password: string): Promise<string> {
    if (typeof password !== "string") throw new Fault(400, "Password required", "INVALID_CREDENTIALS");
    const name = this.normalize(inbox);
    this.createInbox(name);
    const record = this.inboxes.get(name)!;
    const digest = await derive(password, record.salt);
    const key = digest.toString("hex");
    let entry = record.sessions.get(key);
    if (!entry) {
      entry = { id: randomUUID(), digest, createdAt: new Date().toISOString() };
      record.sessions.set(key, entry);
      this.byId.set(entry.id, { inbox: name, entry });
    }
    return entry.id;
  }
  async verify(inbox: string, password: string, sessionId: string): Promise<boolean> {
    if (typeof password !== "string") return false;
    const name = this.normalize(inbox);
    const record = this.inboxes.get(name);
    const association = this.byId.get(sessionId);
    if (!record || !association || association.inbox !== name) return false;
    return timingSafeEqual(await derive(password, record.salt), association.entry.digest);
  }
  resolve(sessionId: string): { inbox: string; sessionId: string } | undefined {
    const association = this.byId.get(sessionId);
    return association ? { inbox: association.inbox, sessionId } : undefined;
  }
  revoke(sessionId: string): void {
    const association = this.byId.get(sessionId);
    if (!association) return;
    this.inboxes.get(association.inbox)?.sessions.delete(association.entry.digest.toString("hex"));
    this.byId.delete(sessionId);
  }
  deleteInbox(inbox: string): void {
    const name = this.normalize(inbox);
    const record = this.inboxes.get(name);
    if (!record) return;
    for (const entry of record.sessions.values()) this.byId.delete(entry.id);
    this.inboxes.delete(name);
  }
  list(inbox?: string) {
    return [...this.byId.values()].filter(value => !inbox || value.inbox === this.normalize(inbox))
      .map(value => ({ id: value.entry.id, inbox: value.inbox, createdAt: value.entry.createdAt }));
  }
}
