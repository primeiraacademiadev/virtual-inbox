import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { Fault } from "./domain-types.js";

type SaltedHash = { salt: Buffer; digest: Buffer };
type SecretAttempt = {
  id: string;
  at: string;
  method: string;
  authUser: string;
  accepted: boolean;
  username: SaltedHash;
  password: SaltedHash;
};
export type PublicSmtpAttempt = Pick<SecretAttempt, "id" | "at" | "method" | "authUser" | "accepted">;
export type PublicSmtpSession = {
  id: string;
  clientId: string;
  remoteAddress: string;
  connectedAt: string;
  disconnectedAt?: string;
  connected: boolean;
  authenticated: boolean;
  secure: boolean;
  authUser?: string;
  authAttempts: PublicSmtpAttempt[];
  messageIds: string[];
  errors: Array<{ at: string; responseCode: number; code: string }>;
};
export type PublicSmtpClient = {
  id: string;
  remoteAddress: string;
  authUser?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  activeSessions: number;
  totalSessions: number;
  authenticatedSessions: number;
};

type SmtpSessionRecord = Omit<PublicSmtpSession, "authAttempts"> & {
  authAttempts: SecretAttempt[];
};
const HASH_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const MAX_ATTEMPTS = 10;
const MAX_MESSAGE_IDS = 100;
const MAX_ERRORS = 20;

function derive(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(value, salt, 32, HASH_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
async function hash(value: string): Promise<SaltedHash> {
  const salt = randomBytes(16);
  return { salt, digest: await derive(value, salt) };
}
async function verifies(value: string, encoded: SaltedHash): Promise<boolean> {
  const actual = await derive(value, encoded.salt);
  return timingSafeEqual(actual, encoded.digest);
}

/**
 * Ephemeral, bounded SMTP diagnostic history. Passwords only exist in the
 * onAuth call and during hashing/comparison; neither hashes nor salts escape.
 * Client grouping is observational (remote IP + SMTP username), not a verified
 * application identity.
 */
export class SmtpSessionStore {
  private readonly sessions = new Map<string, SmtpSessionRecord>();
  private readonly clientIds = new Map<string, string>();

  constructor(private readonly maxSessions = 500) {}

  private clientKey(address: string, username?: string) {
    return address + "\0" + (username ?? "");
  }
  private clientId(address: string, username?: string) {
    const key = this.clientKey(address, username);
    let id = this.clientIds.get(key);
    if (!id) {
      id = randomUUID();
      this.clientIds.set(key, id);
    }
    return id;
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Fault(404, "SMTP session not found", "SMTP_SESSION_NOT_FOUND");
    return session;
  }
  connect(remoteAddress: string, secure = false) {
    this.cleanup();
    if (this.sessions.size >= this.maxSessions) {
      for (const [id, session] of this.sessions) {
        if (!session.connected) { this.sessions.delete(id); break; }
      }
    }
    if (this.sessions.size >= this.maxSessions)
      throw new Fault(503, "SMTP session capacity reached", "SMTP_SESSION_CAPACITY");
    const id = randomUUID();
    const session: SmtpSessionRecord = {
      id, clientId: this.clientId(remoteAddress), remoteAddress,
      connectedAt: new Date().toISOString(), connected: true,
      authenticated: false, secure, authAttempts: [], messageIds: [], errors: [],
    };
    this.sessions.set(id, session);
    return id;
  }
  updateTls(id: string, secure: boolean) {
    if (secure) this.session(id).secure = true;
  }
  async authenticate(id: string, username: string, password: string, method = "UNKNOWN") {
    if (typeof username !== "string" || typeof password !== "string")
      throw new Fault(400, "Invalid SMTP credentials", "INVALID_SMTP_CREDENTIALS");
    const session = this.session(id);
    // Keep bounded history, including the password verification material.
    const [userHash, passwordHash] = await Promise.all([hash(username), hash(password)]);
    const attempt: SecretAttempt = {
      id: randomUUID(), at: new Date().toISOString(), method,
      authUser: username, accepted: true, username: userHash, password: passwordHash,
    };
    session.authAttempts.push(attempt);
    if (session.authAttempts.length > MAX_ATTEMPTS) session.authAttempts.shift();
    session.authUser = username;
    session.clientId = this.clientId(session.remoteAddress, username);
    session.authenticated = true;
    return { id: attempt.id, clientId: session.clientId };
  }
  disconnect(id: string) {
    const session = this.sessions.get(id);
    if (!session || !session.connected) return;
    session.connected = false;
    session.disconnectedAt = new Date().toISOString();
  }
  recordMessage(id: string, messageId: string) {
    const session = this.session(id);
    session.messageIds.push(messageId);
    if (session.messageIds.length > MAX_MESSAGE_IDS) session.messageIds.shift();
  }
  recordError(id: string, responseCode: number, code: string) {
    const session = this.session(id);
    session.errors.push({ at: new Date().toISOString(), responseCode, code });
    if (session.errors.length > MAX_ERRORS) session.errors.shift();
  }
  listSessions(clientId?: string): PublicSmtpSession[] {
    return [...this.sessions.values()]
      .filter((s) => !clientId || s.clientId === clientId)
      .map((s) => ({
        id: s.id, clientId: s.clientId, remoteAddress: s.remoteAddress,
        connectedAt: s.connectedAt, disconnectedAt: s.disconnectedAt,
        connected: s.connected, authenticated: s.authenticated, secure: s.secure,
        authUser: s.authUser, messageIds: [...s.messageIds],
        authAttempts: s.authAttempts.map(({ id, at, method, authUser, accepted }) =>
          ({ id, at, method, authUser, accepted })),
        errors: s.errors.map((error) => ({ ...error })),
      }))
      .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
  }
  listClients(): PublicSmtpClient[] {
    const clients = new Map<string, PublicSmtpClient>();
    for (const session of this.sessions.values()) {
      let client = clients.get(session.clientId);
      if (!client) {
        client = {
          id: session.clientId, remoteAddress: session.remoteAddress,
          authUser: session.authUser, firstSeenAt: session.connectedAt,
          lastSeenAt: session.disconnectedAt || session.connectedAt,
          activeSessions: 0, totalSessions: 0, authenticatedSessions: 0,
        };
        clients.set(session.clientId, client);
      }
      if (session.connectedAt < client.firstSeenAt) client.firstSeenAt = session.connectedAt;
      const last = session.disconnectedAt || session.connectedAt;
      if (last > client.lastSeenAt) client.lastSeenAt = last;
      client.activeSessions += Number(session.connected);
      client.totalSessions++;
      client.authenticatedSessions += Number(session.authenticated);
    }
    return [...clients.values()].sort((a, b) =>
      b.activeSessions - a.activeSessions || b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
  async verifyCredentials(sessionId: string, username: string, password: string, attemptId?: string) {
    if (typeof username !== "string" || typeof password !== "string" ||
      (attemptId !== undefined && typeof attemptId !== "string"))
      throw new Fault(400, "Invalid credential verification request", "INVALID_REQUEST");
    const session = this.session(sessionId);
    const attempt = attemptId
      ? session.authAttempts.find((value) => value.id === attemptId)
      : session.authAttempts.at(-1);
    if (!attempt) throw new Fault(404, "SMTP authentication attempt not found", "SMTP_AUTH_NOT_FOUND");
    // Always compute both matches, avoiding early exit on a wrong username.
    const [usernameMatches, passwordMatches] = await Promise.all([
      verifies(username, attempt.username), verifies(password, attempt.password),
    ]);
    return {
      sessionId, attemptId: attempt.id, usernameMatches, passwordMatches,
      matches: usernameMatches && passwordMatches,
    };
  }
  cleanup(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (!session.connected && Date.parse(session.disconnectedAt || session.connectedAt) < now - 3600000)
        this.sessions.delete(id);
    }
    if (this.sessions.size > this.maxSessions) {
      for (const [id, session] of this.sessions) {
        if (!session.connected) this.sessions.delete(id);
        if (this.sessions.size <= this.maxSessions) break;
      }
    }
    const activeClientIds = new Set([...this.sessions.values()].map((s) => s.clientId));
    for (const [key, id] of this.clientIds) if (!activeClientIds.has(id)) this.clientIds.delete(key);
  }
}
