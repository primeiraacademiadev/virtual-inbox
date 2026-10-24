import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { ipAddressBytes } from "../src/tls/ip-address.js";
import { issueLocalCertificate } from "../src/tls/local-certificates.js";
import { parseTlsNameSet, resolveTlsServerNames } from "../src/tls/server-names.js";
import { Sandbox } from "../src/core.js";

test("IPv4-mapped and compatible IPv6 SANs have the correct sixteen bytes", () => {
  assert.equal(ipAddressBytes("127.0.0.1").toString("hex"), "7f000001");
  assert.equal(ipAddressBytes("::1").toString("hex"), "00000000000000000000000000000001");
  assert.equal(ipAddressBytes("::ffff:127.0.0.1").toString("hex"), "00000000000000000000ffff7f000001");
  assert.equal(ipAddressBytes("::127.0.0.1").toString("hex"), "0000000000000000000000007f000001");
  assert.deepEqual(ipAddressBytes("::ffff:127.0.0.1"), ipAddressBytes("0:0:0:0:0:ffff:7f00:1"));
  assert.throws(() => ipAddressBytes("::ffff:999.0.0.1"));
  assert.throws(() => ipAddressBytes("fe80::1%eth0"));
});

test("OpenSSL reads and matches the embedded IPv4 SAN issued by the application", () => {
  const identity = issueLocalCertificate({ commonName: "localhost", names: ["localhost", "::ffff:127.0.0.1"] });
  const certificate = new X509Certificate(identity.cert);
  assert.ok(certificate.checkIP("::ffff:127.0.0.1"));
  assert.equal(certificate.checkIP("::ffff:127.0.0.2"), undefined);
});

test("startup and updates resolve all TLS name sources without dropping file entries", () => {
  const sources = {
    environment: "localhost,127.0.0.1,0.0.0.0,::",
    publicHost: "virtual-inbox",
    file: { dns: ["from-file.example.test"], ips: ["::1"] },
    managed: { dns: ["console.example.test"], ips: ["::ffff:127.0.0.1"] },
  };
  const names = resolveTlsServerNames(sources);
  for (const name of ["localhost", "127.0.0.1", "virtual-inbox", "from-file.example.test", "::1", "console.example.test", "::ffff:127.0.0.1"]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(!names.includes("0.0.0.0"));
  assert.ok(!names.includes("::"));
  const changed = resolveTlsServerNames({ ...sources, managed: { dns: ["new.example.test"], ips: [] } });
  assert.ok(changed.includes("from-file.example.test"));
  assert.ok(changed.includes("new.example.test"));
  assert.ok(!changed.includes("console.example.test"));
  assert.throws(() => parseTlsNameSet({ dns: [], ips: ["not-an-ip"] }));
});

test("national and international aliases remain classified as expired after cleanup", () => {
  const sandbox = new Sandbox();
  const recipient = sandbox.create("sms", "912345678", 60, undefined, { locale: "pt-PT" });
  recipient.expiresAt = new Date(Date.now() - 1).toISOString();
  sandbox.cleanup();
  for (const address of ["912345678", "+351912345678"]) {
    const message = sandbox.deliver("sms", "test", address, "after expiry");
    assert.equal(message.destinationId, sandbox.defaults.sms);
    assert.equal(message.captureReason, "EXPIRED_RECIPIENT");
  }
  assert.equal(sandbox.deliver("sms", "test", "+351913333333", "unknown").captureReason, "UNKNOWN_RECIPIENT");
  const recreated = sandbox.create("sms", "912345678", 60, undefined, { locale: "pt-PT" });
  assert.equal(sandbox.deliver("sms", "test", "+351912345678", "active again").destinationId, recreated.id);
});
