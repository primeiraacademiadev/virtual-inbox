import test from "node:test";
import assert from "node:assert/strict";
import { generateDemoSample } from "../web/src/demo-samples.js";

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
