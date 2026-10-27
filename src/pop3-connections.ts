import { randomUUID } from "node:crypto";

export type Pop3Connection = {
  id: string; remoteAddress: string; connectedAt: string; lastActivityAt: string;
  disconnectedAt?: string; connected: boolean; authenticated: boolean;
  inbox?: string; testSessionId?: string;
};

/** Bounded diagnostic history; never stores credentials or message contents. */
export class Pop3ConnectionStore {
  private readonly connections = new Map<string, Pop3Connection>();
  constructor(private readonly maximum = 500, private readonly retentionMs = 3_600_000) {}
  connect(remoteAddress: string): string {
    this.cleanup();
    if (this.connections.size >= this.maximum) {
      const inactive = [...this.connections.values()].find(item => !item.connected);
      if (inactive) this.connections.delete(inactive.id);
    }
    if (this.connections.size >= this.maximum) throw Error("POP3 connection capacity reached");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connections.set(id, { id, remoteAddress, connectedAt: now, lastActivityAt: now,
      connected: true, authenticated: false });
    return id;
  }
  activity(id: string) {
    const value = this.connections.get(id);
    if (value?.connected) value.lastActivityAt = new Date().toISOString();
  }
  authenticate(id: string, inbox: string, testSessionId: string) {
    const value = this.connections.get(id);
    if (value?.connected) {
      value.authenticated = true;
      value.inbox = inbox.trim().toLowerCase();
      value.testSessionId = testSessionId;
      this.activity(id);
    }
  }
  disconnect(id: string) {
    const value = this.connections.get(id);
    if (!value || !value.connected) return;
    value.connected = false;
    value.disconnectedAt = new Date().toISOString();
    value.lastActivityAt = value.disconnectedAt;
  }
  list(): Pop3Connection[] {
    return [...this.connections.values()].map(value => ({ ...value }))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }
  counts() {
    return { retained: this.connections.size,
      active: [...this.connections.values()].filter(value => value.connected).length,
      limit: this.maximum, retentionMs: this.retentionMs };
  }
  cleanup(now = Date.now()) {
    for (const [id, item] of this.connections)
      if (!item.connected && Date.parse(item.disconnectedAt ?? item.lastActivityAt) <= now - this.retentionMs)
        this.connections.delete(id);
  }
}
