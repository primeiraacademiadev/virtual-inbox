import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Fault } from "./domain-types.js";

/** Ephemeral correlators, not authenticated client identities. No secret or raw password leaves this store. */
export class SmtpRuleIdentities {
  private readonly secret = randomBytes(32);
  private readonly credentials = new Map<string, string>();
  private readonly origins = new Map<string, string>();

  credentialsId(username: string, password: string): string {
    if (typeof username !== "string" || typeof password !== "string")
      throw new Fault(400, "Invalid SMTP credentials", "INVALID_SMTP_CREDENTIALS");
    const key = createHmac("sha256", this.secret)
      .update(JSON.stringify([username, password]), "utf8").digest("hex");
    let id = this.credentials.get(key);
    if (!id) { id = randomUUID(); this.credentials.set(key, id); }
    return id;
  }

  originId(ip: string): string {
    if (typeof ip !== "string" || !isIP(ip.startsWith("::ffff:") ? ip.slice(7) : ip))
      throw new Fault(400, "Invalid SMTP origin", "INVALID_SMTP_ORIGIN");
    const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    let id = this.origins.get(normalized);
    if (!id) { id = randomUUID(); this.origins.set(normalized, id); }
    return id;
  }

  resolve(input: unknown, sessions: ReadonlyArray<{
    id: string; remoteAddress: string; credentialsId?: string;
    connected: boolean; connectedAt: string;
  }>) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Fault(400, "Invalid SMTP resolve input", "INVALID_REQUEST");
    const data = input as Record<string, unknown>;
    if (Object.keys(data).some(k => k !== "credentials" && k !== "origin"))
      throw new Fault(400, "Unsupported SMTP resolve field", "INVALID_REQUEST");
    if (data.credentials === undefined && data.origin === undefined)
      throw new Fault(400, "Specify credentials and/or origin", "INVALID_REQUEST");
    let credentialsId: string | undefined;
    if (data.credentials !== undefined) {
      const c = data.credentials;
      if (!c || typeof c !== "object" || Array.isArray(c))
        throw new Fault(400, "Invalid SMTP credentials", "INVALID_REQUEST");
      const v = c as Record<string, unknown>;
      if (Object.keys(v).some(k => k !== "username" && k !== "password"))
        throw new Fault(400, "Unsupported credentials field", "INVALID_REQUEST");
      credentialsId = this.credentialsId(v.username as string, v.password as string);
    }
    let originId: string | undefined;
    let ip: string | undefined;
    if (data.origin !== undefined) {
      const o = data.origin;
      if (!o || typeof o !== "object" || Array.isArray(o))
        throw new Fault(400, "Invalid SMTP origin", "INVALID_REQUEST");
      const v = o as Record<string, unknown>;
      if (Object.keys(v).some(k => k !== "ip"))
        throw new Fault(400, "Unsupported origin field", "INVALID_REQUEST");
      ip = v.ip as string;
      originId = this.originId(ip);
      ip = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    }
    const matched = sessions.filter(s =>
      (credentialsId === undefined || s.credentialsId === credentialsId) &&
      (ip === undefined || (s.remoteAddress.startsWith("::ffff:") ?
        s.remoteAddress.slice(7) : s.remoteAddress) === ip));
    // A tree is a projection of independent dimensions, not their persisted ownership.
    const groups = new Map<string, { id: string; ip: string; connections: Array<{
      id: string; credentialsId?: string; connected: boolean; connectedAt: string;
    }> }>();
    for (const session of matched) {
      const address = session.remoteAddress.replace(/^::ffff:/, "");
      const id = this.originId(address);
      let group = groups.get(id);
      if (!group) { group = { id, ip: address, connections: [] }; groups.set(id, group); }
      group.connections.push({ id: session.id,
        ...(session.credentialsId ? { credentialsId: session.credentialsId } : {}),
        connected: session.connected, connectedAt: session.connectedAt });
    }
    if (originId && ip && !groups.has(originId))
      groups.set(originId, { id: originId, ip, connections: [] });
    const origins = [...groups.values()];
    return credentialsId ? { credentials: { id: credentialsId, origins } } : { origins };
  }
}
