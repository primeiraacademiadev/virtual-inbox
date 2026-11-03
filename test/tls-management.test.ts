import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { ensureLocalTls } from "../src/tls/local-certificates.js";
import { CertificateManager, validateIdentity } from "../src/tls/certificate-manager.js";

test("local CA certificates include DNS/IP SAN and change when names change", () => {
  const dir = mkdtempSync(join(tmpdir(), "virtual-inbox-tls-"));
  try {
    let paths = ensureLocalTls(dir, "localhost,127.0.0.1");
    const first = new X509Certificate(readFileSync(paths.cert));
    assert.ok((first.subjectAltName || "").includes("localhost"));
    assert.ok((first.subjectAltName || "").includes("127.0.0.1"));
    paths = ensureLocalTls(dir, "localhost,127.0.0.1,demo.example.test");
    const second = new X509Certificate(readFileSync(paths.cert));
    assert.ok((second.subjectAltName || "").includes("demo.example.test"));
    assert.notEqual(second.fingerprint256, first.fingerprint256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("certificate manager switches contexts and rejects invalid upload without losing active identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "virtual-inbox-manager-"));
  try {
    const paths = ensureLocalTls(dir, "localhost,127.0.0.1");
    const initial = validateIdentity(readFileSync(paths.cert), readFileSync(paths.key));
    const manager = new CertificateManager(initial, "automatic", join(dir, "imported.json"));
    let applied = 0;
    manager.subscribe(() => {
      applied++;
    });
    const next = ensureLocalTls(dir, "localhost,127.0.0.1,test.example.test");
    manager.useGenerated(readFileSync(next.cert), readFileSync(next.key));
    assert.equal(applied, 1);
    assert.ok((manager.info()?.subjectAltName || "").includes("test.example.test"));
    const active = manager.info()?.fingerprint256;
    assert.throws(() => manager.activate("invalid", "invalid"));
    assert.equal(manager.info()?.fingerprint256, active);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
