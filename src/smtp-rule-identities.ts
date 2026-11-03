import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { Fault } from "./domain-types.js";

/** Ephemeral correlators, not authenticated client identities. No secret or raw password leaves this store. */
export class SmtpRuleIdentities {
  private readonly secret = randomBytes(32);
  /** Stable in this process, with no growing identity dictionary. */
  private idFor(kind: string, parts: string[]): string {
    const digest = createHmac("sha256", this.secret)
      .update(JSON.stringify([kind, ...parts]), "utf8").digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  credentialsId(username: string, password: string): string {
    if (typeof username !== "string" || typeof password !== "string")
      throw new Fault(400, "Invalid SMTP credentials", "INVALID_SMTP_CREDENTIALS");
    return this.idFor("credentials", [username, password]);
  }

  originId(ip: string): string {
    if (typeof ip !== "string" || !isIP(ip.startsWith("::ffff:") ? ip.slice(7) : ip))
      throw new Fault(400, "Invalid SMTP origin", "INVALID_SMTP_ORIGIN");
    const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    return this.idFor("origin", [normalized]);
  }

  resolve(input: unknown, sessions: ReadonlyArray<{
    id: string; remoteAddress: string; credentialsIds?: readonly string[];
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
      (credentialsId === undefined || s.credentialsIds?.includes(credentialsId) === true) &&
      (ip === undefined || (s.remoteAddress.startsWith("::ffff:") ?
        s.remoteAddress.slice(7) : s.remoteAddress) === ip));
    // A tree is a projection of independent dimensions, not their persisted ownership.
    const groups = new Map<string, { id: string; ip: string; connections: Array<{
      id: string; credentialsIds?: readonly string[]; connected: boolean; connectedAt: string;
    }> }>();
    for (const session of matched) {
      const address = session.remoteAddress.replace(/^::ffff:/, "");
      const id = this.originId(address);
      let group = groups.get(id);
      if (!group) { group = { id, ip: address, connections: [] }; groups.set(id, group); }
      group.connections.push({ id: session.id,
        ...(session.credentialsIds?.length ? { credentialsIds: [...session.credentialsIds] } : {}),
        connected: session.connected, connectedAt: session.connectedAt });
    }
    if (originId && ip && !groups.has(originId))
      groups.set(originId, { id: originId, ip, connections: [] });
    const origins = [...groups.values()];
    return credentialsId ? { credentials: { id: credentialsId, origins } } : { origins };
  }
}
