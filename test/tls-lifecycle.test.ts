import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { issueLocalCertificate } from "../src/tls/local-certificates.js";
import { ensureLocalTls } from "../src/tls/local-certificates.js";
import { CertificateManager, validateIdentity } from "../src/tls/certificate-manager.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "vi-tls-unit-"));
  const files = ensureLocalTls(dir, "localhost,127.0.0.1");
  return {
    dir,
    files,
    cert: readFileSync(files.cert),
    key: readFileSync(files.key),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("TLS rejects mismatched key and expired certificate", () => {
  const a = fixture(),
    b = fixture();
  try {
    assert.throws(() => validateIdentity(a.cert, b.key), /match/i);
    const expired = issueLocalCertificate({
      commonName: "localhost",
      notBefore: new Date("2020-01-01T00:00:00Z"),
      notAfter: new Date("2020-01-02T00:00:00Z"),
    });
    assert.throws(() => validateIdentity(expired.cert, expired.key), /valid/i);
  } finally {
    a.clean();
    b.clean();
  }
});

test("failed listener leaves active identity and source unchanged", () => {
  const a = fixture(),
    b = fixture();
  try {
    const manager = new CertificateManager(
      { cert: a.cert, key: a.key, minVersion: "TLSv1.2" },
      "automatic",
      join(a.dir, "import.json"),
    );
    const original = manager.info();
    let observed: string[] = [];
    manager.subscribe((next) => {
      observed.push(new X509Certificate(next.cert).fingerprint256);
    });
    manager.subscribe((next) => {
      if (new X509Certificate(next.cert).fingerprint256 !== original!.fingerprint256)
        throw Error("simulated listener failure");
    });
    assert.throws(() => manager.useGenerated(b.cert, b.key), /simulated listener failure/);
    assert.equal(manager.info()?.fingerprint256, original?.fingerprint256);
    assert.equal(manager.activeSource, "automatic");
    assert.equal(observed.at(-1), original?.fingerprint256);
  } finally {
    a.clean();
    b.clean();
  }
});

test("automatic certificate reuse survives restart and SAN changes renew the leaf", () => {
  const a = fixture();
  try {
    const before = new X509Certificate(readFileSync(a.files.cert)).fingerprint256;
    ensureLocalTls(a.dir, "127.0.0.1,localhost");
    assert.equal(new X509Certificate(readFileSync(a.files.cert)).fingerprint256, before);
    ensureLocalTls(a.dir, "localhost,127.0.0.1,rotation.example.test");
    const updated = new X509Certificate(readFileSync(a.files.cert));
    assert.notEqual(updated.fingerprint256, before);
    assert.ok(updated.subjectAltName, "Renewed certificate must include subjectAltName");
    assert.match(updated.subjectAltName, /rotation\.example\.test/);
  } finally {
    a.clean();
  }
});

test("automatic leaf renews when fewer than seven days remain", () => {
  const a = fixture();
  try {
    const nearlyExpired = issueLocalCertificate({
      commonName: "localhost",
      names: ["localhost", "127.0.0.1"],
      issuerName: "Virtual Inbox Local CA",
      issuerKey: readFileSync(join(a.dir, "ca-key.pem")),
      notAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).cert;
    writeFileSync(a.files.cert, nearlyExpired);
    ensureLocalTls(a.dir, "localhost,127.0.0.1");
    const renewed = new X509Certificate(readFileSync(a.files.cert));
    assert.notEqual(renewed.fingerprint256, new X509Certificate(nearlyExpired).fingerprint256);
    assert.ok(Date.parse(renewed.validTo) > Date.now() + 20 * 86400000);
  } finally {
    a.clean();
  }
});

test("Node-issued leaf has a valid signature chained to the local CA", () => {
  const a = fixture();
  try {
    const ca = new X509Certificate(readFileSync(a.files.ca));
    const leaf = new X509Certificate(a.cert);
    assert.equal(ca.ca, true);
    assert.equal(leaf.ca, false);
    assert.equal(ca.verify(ca.publicKey), true);
    assert.equal(leaf.checkIssued(ca), true);
    assert.equal(leaf.verify(ca.publicKey), true);
    assert.match(leaf.subjectAltName || "", /DNS:localhost/);
    assert.match(leaf.subjectAltName || "", /IP Address:127\.0\.0\.1/);
    assert.doesNotThrow(() => validateIdentity(a.cert, a.key));
  } finally {
    a.clean();
  }
});
