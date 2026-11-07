import test from "node:test";
import assert from "node:assert/strict";
import { Sandbox } from "../src/core.js";
import { parseSmsDefaultCountryCode } from "../src/config.js";
import {
  generateAddress,
  canonicalAddress,
  generationOptions,
  locales,
} from "../src/identity-generation/generator.js";

test("localised name strategies use first/last and surname/first", () => {
  for (const locale of locales) {
    const a = generateAddress("email", { locale, strategy: "FIRST_LAST" });
    const b = generateAddress("email", { locale, strategy: "LAST_FIRST" });
    assert.match(a, /^[a-z0-9]+\.[a-z0-9]+@sandbox\.test$/);
    assert.match(b, /^[a-z0-9]+\.[a-z0-9]+@sandbox\.test$/);
    assert.notEqual(a, "");
  }
});
test("mobile national format ends in 401, supports country-code toggle", () => {
  const expected = {
    "pt-PT": [/^\+351\d{9}$/, /^\d{9}$/],
    "en-US": [/^\+1\d{10}$/, /^\d{10}$/],
    "fr-FR": [/^\+33[67]\d{8}$/, /^0[67]\d{8}$/],
  };
  for (const locale of locales) {
    const international = generateAddress("sms", { locale, includeCountryCode: true });
    const national = generateAddress("sms", { locale, includeCountryCode: false });
    assert.match(international, expected[locale][0]);
    assert.match(national, expected[locale][1]);
    assert.ok(international.endsWith("401"));
    assert.ok(national.endsWith("401"));
  }
});
test("national and international aliases refer to same inbox", () => {
  const sandbox = new Sandbox();
  const r = sandbox.create("sms", "912345401", 120, undefined, { locale: "pt-PT" });
  assert.throws(() => sandbox.create("sms", "+351912345401"), /already exists/);
  assert.equal(sandbox.find("sms", "+351912345401")?.id, r.id);
  sandbox.deliver("sms", "unit", "+351912345401", "hello");
  assert.equal(sandbox.listMessages(r.id).length, 1);
});
test("manual identifier bypasses generator and defaults remain discoverable", () => {
  const sandbox = new Sandbox(),
    r = sandbox.create("email", "manual@example.test", 60);
  assert.equal(r.address, "manual@example.test");
  assert.equal(generationOptions().defaults.locale, process.env.IDENTITY_DEFAULT_LOCALE || "pt-PT");
});

test("generated collision is retried and new identifier is reserved atomically", () => {
  let attempts = 0;
  const sandbox = new Sandbox(10, () =>
    ++attempts < 3 ? "same.person@sandbox.test" : "second.person@sandbox.test",
  );
  const first = sandbox.create("email");
  const second = sandbox.create("email");
  assert.equal(first.address, "same.person@sandbox.test");
  assert.equal(second.address, "second.person@sandbox.test");
  assert.equal(attempts, 3);
});
test("exhausted collision retries return a stable error code", () => {
  const sandbox = new Sandbox(10, () => "always.same@sandbox.test");
  sandbox.create("email");
  assert.throws(
    () => sandbox.create("email"),
    (error: unknown) =>
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "IDENTITY_GENERATION_EXHAUSTED",
  );
});

test("optional operational country code preserves legacy aliases when absent", () => {
  const legacy = new Sandbox(200, undefined, undefined);
  const phone = legacy.create("sms", "912345678");
  assert.equal(legacy.find("sms", "+351912345678")?.id, phone.id);
  assert.equal(legacy.smsDefaultCountryCode, undefined);
  const us = legacy.create("sms", "2025551234");
  assert.equal(legacy.find("sms", "+12025551234")?.id, us.id);
});

test("configured +351 routing treats national and international recipient as one identity", () => {
  const sandbox = new Sandbox(200, undefined, "+351");
  const intl = sandbox.create("sms", "+351912345678");
  assert.equal(sandbox.find("sms", "912345678")?.id, intl.id);
  assert.throws(() => sandbox.create("sms", "912345678"), /already exists/);
  const first = sandbox.deliver("sms", "SUBSCRIBER", "912345678", "national");
  const second = sandbox.deliver("sms", "SUBSCRIBER", "+351912345678", "international");
  assert.equal(first.destinationId, intl.id);
  assert.equal(second.destinationId, intl.id);
  assert.equal(first.from, "SUBSCRIBER");
  assert.equal(first.originalRecipient, "912345678");
  assert.equal(second.originalRecipient, "+351912345678");
  assert.equal(sandbox.listMessages(intl.id).length, 2);
  assert.equal(sandbox.find("sms", "2025551234"), undefined,
    "A Portuguese operational prefix must not guess the USA plan");
  const foreign = sandbox.create("sms", "+12025551234");
  assert.equal(sandbox.find("sms", "+12025551234")?.id, foreign.id);
  assert.equal(sandbox.find("sms", "2025551234"), undefined);
  const anomaly = sandbox.deliver("sms", "MYAPP", "999999999", "unknown");
  assert.equal(anomaly.captureReason, "UNKNOWN_RECIPIENT");
  assert.equal(anomaly.originalRecipient, "999999999");
});

test("configured operational profile applies to existing national inbox and expiry", () => {
  const sandbox = new Sandbox(200, undefined, "+351");
  const national = sandbox.create("sms", "912345679");
  assert.equal(sandbox.find("sms", "+351912345679")?.id, national.id);
  sandbox.deleteResource(national.id);
  const removed = sandbox.deliver("sms", "provider", "+351912345679", "after deletion");
  assert.equal(removed.captureReason, "UNKNOWN_RECIPIENT");
  assert.equal(removed.originalRecipient, "+351912345679");
});

test("operational country code configuration rejects ambiguous and unsupported values", () => {
  assert.equal(parseSmsDefaultCountryCode(undefined), undefined);
  for (const code of ["+351", "+1", "+33"]) assert.equal(parseSmsDefaultCountryCode(code), code);
  for (const bad of ["", "351", "00", "00351", "+0", "+999", "+351 ", "abc", "+1234"]) {
    assert.throws(() => parseSmsDefaultCountryCode(bad), /Invalid SMS_DEFAULT_COUNTRY_CODE/);
  }
  const french = new Sandbox(200, undefined, "+33");
  const international = french.create("sms", "+33612345678");
  assert.equal(french.find("sms", "0612345678")?.id, international.id);
});
