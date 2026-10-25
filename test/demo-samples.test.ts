import test from "node:test";
import assert from "node:assert/strict";
import { generateDemoSample, applyDemoSample, beginDemoCompose, refreshDemoOnLocaleChange } from "../web/src/demo-samples.js";

test("demo titles and messages are local, varied, and available in every UI locale", () => {
  for (const locale of ["pt-PT", "en", "fr"] as const) {
    const first = generateDemoSample(locale);
    assert.ok(first.subject.trim().length > 4);
    assert.ok(first.body.trim().length > 20);
    const next = generateDemoSample(locale, first.subject);
    assert.notEqual(next.subject, first.subject);
    assert.notEqual(next.body, first.body);
  }
});

test("local demo composer changes both fields, resets files and opens the composer", () => {
  const calls: string[] = [];
  const update = {
    setSubject: (s: string) => { calls.push("subject:" + s); },
    setBody: (b: string) => { calls.push("body:" + b); },
    clearAttachments: () => { calls.push("attachments"); },
    showComposer: () => { calls.push("open"); },
  };
  const current = generateDemoSample("pt-PT");
  const next = applyDemoSample("pt-PT", current.subject, update);
  assert.notEqual(next.subject, current.subject);
  assert.equal(calls[0], "subject:" + next.subject);
  assert.equal(calls[1], "body:" + next.body);
  calls.length = 0;
  beginDemoCompose("fr", undefined, update);
  assert.ok(calls[0].startsWith("subject:"));
  assert.ok(calls[1].startsWith("body:"));
  assert.deepEqual(calls.slice(2), ["attachments", "open"]);
});

test("locale refresh preserves an actively edited draft", () => {
  const updates: string[] = [];
  const callbacks = {
    setSubject: (s: string) => { updates.push(s); },
    setBody: (s: string) => { updates.push(s); },
  };
  assert.equal(refreshDemoOnLocaleChange("en", true, callbacks), false);
  assert.equal(updates.length, 0);
  assert.equal(refreshDemoOnLocaleChange("en", false, callbacks), true);
  assert.equal(updates.length, 2);
});
