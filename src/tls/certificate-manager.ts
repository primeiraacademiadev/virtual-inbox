import { X509Certificate, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { createSecureContext } from "node:tls";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";

export type ServerIdentity = { cert: Buffer; key: Buffer; minVersion: "TLSv1.2" };
export type IdentityInfo = {
  source: "automatic" | "external" | "uploaded";
  subject: string;
  issuer: string;
  validTo: string;
  fingerprint256: string;
  subjectAltName: string;
};
export function validateIdentity(cert: string | Buffer, key: string | Buffer): ServerIdentity {
  const leaf = new X509Certificate(cert);
  const privateKey = createPrivateKey(key);
  if (!createPublicKey(privateKey).equals(leaf.publicKey))
    throw Error("Certificate and key do not match");
  if (Date.parse(leaf.validTo) <= Date.now() || Date.parse(leaf.validFrom) > Date.now())
    throw Error("Certificate is not currently valid");
  createSecureContext({ cert, key, minVersion: "TLSv1.2" });
  return { cert: Buffer.from(cert), key: Buffer.from(key), minVersion: "TLSv1.2" };
}
export class CertificateManager {
  private active: ServerIdentity | null;
  private source: "automatic" | "external" | "uploaded";
  private listeners = new Set<(identity: ServerIdentity) => void>();
  constructor(
    initial: ServerIdentity | null,
    source: "automatic" | "external" | "uploaded",
    private readonly uploadPath: string,
  ) {
    this.active = initial ? validateIdentity(initial.cert, initial.key) : null;
    this.source = source;
  }
  get identity() {
    return this.active;
  }
  get activeSource() {
    return this.source;
  }
  info(): IdentityInfo | null {
    if (!this.active) return null;
    const cert = new X509Certificate(this.active.cert);
    return {
      source: this.source,
      subject: cert.subject,
      issuer: cert.issuer,
      validTo: cert.validTo,
      fingerprint256: cert.fingerprint256,
      subjectAltName: cert.subjectAltName || "",
    };
  }
  subscribe(listener: (identity: ServerIdentity) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private apply(next: ServerIdentity, source: "automatic" | "external" | "uploaded") {
    const old = this.active;
    try {
      for (const listener of this.listeners) listener(next);
    } catch (error) {
      if (old)
        for (const listener of this.listeners) {
          try {
            listener(old);
          } catch {}
        }
      throw error;
    }
    this.active = next;
    this.source = source;
    return this.info();
  }
  useGenerated(cert: string | Buffer, key: string | Buffer) {
    return this.apply(validateIdentity(cert, key), "automatic");
  }
  useExternal(cert: string | Buffer, key: string | Buffer) {
    return this.apply(validateIdentity(cert, key), "external");
  }
  activate(cert: string, key: string) {
    const next = validateIdentity(cert, key);
    mkdirSync(dirname(this.uploadPath), { recursive: true, mode: 0o700 });
    const temporary = this.uploadPath + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, JSON.stringify({ cert, key }), { mode: 0o600, flag: "wx" });
    const previous = this.active,
      previousSource = this.source;
    let applied = false;
    try {
      const info = this.apply(next, "uploaded");
      applied = true;
      if (existsSync(this.uploadPath)) copyFileSync(this.uploadPath, this.uploadPath + ".previous");
      renameSync(temporary, this.uploadPath);
      return info;
    } catch (error) {
      if (applied && previous)
        try {
          this.apply(previous, previousSource);
        } catch {}
      try {
        rmSync(temporary, { force: true });
      } catch {}
      throw error;
    }
  }
}
