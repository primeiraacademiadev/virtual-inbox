import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  X509Certificate,
  randomBytes,
  createHash,
  generateKeyPairSync,
  sign,
  createPrivateKey,
} from "node:crypto";
import { isIP } from "node:net";
import { ipAddressBytes } from "./ip-address.js";

// Minimal X.509 DER encoder for certificates issued by the local test CA.
// Uses Node/OpenSSL for RSA key generation and SHA256withRSA signing.
const length = (n: number): Buffer =>
  n < 128
    ? Buffer.from([n])
    : (() => {
        const bytes = [];
        while (n) {
          bytes.unshift(n & 255);
          n = Math.floor(n / 256);
        }
        return Buffer.from([128 | bytes.length, ...bytes]);
      })();
const tlv = (tag: number, bytes: Buffer) =>
  Buffer.concat([Buffer.from([tag]), length(bytes.length), bytes]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const integer = (bytes: Buffer) =>
  tlv(2, bytes[0] & 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const oid = (parts: string) => {
  const values = parts.split(".").map(Number);
  const out = [40 * values[0] + values[1]];
  for (const v of values.slice(2)) {
    const stack = [v & 127];
    let n = Math.floor(v / 128);
    while (n) {
      stack.unshift((n & 127) | 128);
      n = Math.floor(n / 128);
    }
    out.push(...stack);
  }
  return tlv(6, Buffer.from(out));
};
const utf8 = (s: string) => tlv(12, Buffer.from(s));
const octet = (b: Buffer) => tlv(4, b);
const bitString = (b: Buffer, unused = 0) => tlv(3, Buffer.concat([Buffer.from([unused]), b]));
const bool = (value: boolean) => tlv(1, Buffer.from([value ? 255 : 0]));
const nullValue = Buffer.from([5, 0]);
const alg = seq(oid("1.2.840.113549.1.1.11"), nullValue);
const name = (cn: string) => seq(set(seq(oid("2.5.4.3"), utf8(cn))));
const time = (d: Date) => {
  const v = d.toISOString().replace(/[-:T]/g, "").replace(/\.\d{3}Z$/, "Z");
  return tlv(
    d.getUTCFullYear() < 2050 ? 23 : 24,
    Buffer.from(d.getUTCFullYear() < 2050 ? v.slice(2) : v, "ascii"),
  );
};
const extension = (id: string, inner: Buffer, critical = false) =>
  seq(oid(id), ...(critical ? [bool(true)] : []), octet(inner));

export function issueLocalCertificate(options: {
  commonName: string;
  names?: string[];
  issuerName?: string;
  issuerKey?: string | Buffer;
  days?: number;
  notBefore?: Date;
  notAfter?: Date;
  ca?: boolean;
}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicExponent: 65537,
  });
  const key = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const now = Date.now();
  const notBefore = options.notBefore || new Date(now - 60_000);
  const notAfter = options.notAfter || new Date(now + (options.days || 30) * 86_400_000);
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  serial[0] |= 1;
  const extensions = [
    extension("2.5.29.19", options.ca ? seq(bool(true)) : seq(), true),
    extension("2.5.29.15", bitString(Buffer.from([options.ca ? 0x06 : 0xa0]), options.ca ? 1 : 5), true),
  ];
  if (!options.ca) {
    extensions.push(extension("2.5.29.37", seq(oid("1.3.6.1.5.5.7.3.1"))));
    extensions.push(
      extension(
        "2.5.29.17",
        seq(...(options.names || []).map((value) =>
          isIP(value) ? tlv(0x87, ipAddressBytes(value)) : tlv(0x82, Buffer.from(value, "ascii")),
        )),
      ),
    );
  }
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))), integer(serial), alg,
    name(options.issuerName || options.commonName), seq(time(notBefore), time(notAfter)),
    name(options.commonName), publicKey.export({ format: "der", type: "spki" }) as Buffer,
    tlv(0xa3, seq(...extensions)),
  );
  const signer = options.issuerKey ? createPrivateKey(options.issuerKey) : privateKey;
  const certDer = seq(tbs, alg, bitString(sign("RSA-SHA256", tbs, signer)));
  const base64 = certDer.toString("base64").match(/.{1,64}/g)!.join("\n");
  return { key, cert: "-----BEGIN CERTIFICATE-----\n" + base64 + "\n-----END CERTIFICATE-----\n" };
}

function save(path: string, value: string, mode: number) {
  writeFileSync(path, value, { mode });
  chmodSync(path, mode);
}

/** Generate a local CA and server certificate using Node's crypto primitives. */
export function ensureLocalTls(directory: string, namesText: string) {
  const names = namesText.split(",").map((value) => value.trim()).filter(Boolean);
  if (!names.length || names.some((value) => !/^[a-zA-Z0-9.:-]+$/.test(value))) {
    throw Error("Invalid TLS_SERVER_NAMES");
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const caKey = join(directory, "ca-key.pem");
  const caCert = join(directory, "ca.pem");
  const serverKey = join(directory, "server-key.pem");
  const serverCert = join(directory, "server.pem");
  if (!existsSync(caKey) || !existsSync(caCert)) {
    const ca = issueLocalCertificate({ commonName: "Virtual Inbox Local CA", days: 365, ca: true });
    save(caKey, ca.key, 0o600);
    save(caCert, ca.cert, 0o644);
  }
  const fingerprintFile = join(directory, "server-names.sha256");
  const namesHash = createHash("sha256")
    .update([...new Set(names)].sort((a, b) => a.localeCompare(b)).join(","))
    .digest("hex");
  const renew =
    !existsSync(serverKey) || !existsSync(serverCert) || !existsSync(fingerprintFile) ||
    readFileSync(fingerprintFile, "utf8") !== namesHash ||
    Date.parse(new X509Certificate(readFileSync(serverCert)).validTo) < Date.now() + 7 * 86_400_000;
  if (renew) {
    const leaf = issueLocalCertificate({
      commonName: names[0], names, issuerName: "Virtual Inbox Local CA",
      issuerKey: readFileSync(caKey), days: 30,
    });
    save(serverKey, leaf.key, 0o600);
    save(serverCert, leaf.cert, 0o644);
    save(fingerprintFile, namesHash, 0o600);
  }
  return { cert: serverCert, key: serverKey, ca: caCert };
}
