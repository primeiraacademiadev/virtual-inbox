import test from "node:test";
import assert from "node:assert/strict";
import { appendLog, visibleLogs, logStreamQuery, gapRange, recoverableGapUrl, mergeRecoveredLogs, gapLabel } from "../web/src/logs/log-model.js";
import type { EventEntry } from "../web/src/api.js";

const event = (n: number, type = "smtp.received"): EventEntry => ({ id: "run:" + n, log_id: n, at: "2026-11-01T00:00:00Z", type });
const gap: EventEntry = { id: "gap:2:3", type: "log.gap", at: "2026-11-01T00:00:00Z", data: { missingFrom: 2, missingTo: 3 } };

test("appendLog limits history and deduplicates by cursor", () => {
  const a = event(1), b = event(2), c = event(3);
  assert.deepEqual(appendLog([a, b], a, 2), [a, b]);
  assert.deepEqual(appendLog([a, b], c, 2), [b, c]);
});
test("local text filtering always retains gap markers", () => {
  assert.deepEqual(visibleLogs([event(1), event(2, "mail.sent"), gap], "mail.sent"), [event(2, "mail.sent"), gap]);
  assert.equal(visibleLogs([event(1)], "NO MATCH").length, 0);
});
test("server log filters accept only known fields and exact escaped values", () => {
  assert.equal(logStreamQuery("sender", " a+b@example.test "), "?sender=a%2Bb%40example.test");
  assert.equal(logStreamQuery("anything", "value"), "");
  assert.equal(logStreamQuery("sender", " "), "");
});
test("gap ranges reject invalid and excessively large intervals", () => {
  assert.deepEqual(gapRange(gap), { from: 2, to: 3 });
  assert.equal(gapRange({ ...gap, data: { missingFrom: "2", missingTo: 3 } }), null);
  assert.equal(gapRange({ ...gap, data: { missingFrom: 10, missingTo: 2 } }), null);
  assert.equal(gapRange({ ...gap, data: { missingFrom: 1, missingTo: 20000 } }), null);
});
test("recovery builds REST query with filters", () => {
  assert.equal(recoverableGapUrl(gap, "sender", "one@example.test"), "/logs?from=2&to=3&sender=one%40example.test");
  assert.equal(recoverableGapUrl(gap, "unknown", "value"), "/logs?from=2&to=3");
  assert.equal(recoverableGapUrl(event(2), "type", "smtp.received"), null);
});
test("recovered entries replace gap, sort and deduplicate", () => {
  assert.deepEqual(mergeRecoveredLogs([event(1), gap, event(4)], gap.id, [event(2), event(3), event(4)], 10), [event(1), event(2), event(3), event(4)]);
  assert.deepEqual(mergeRecoveredLogs([event(1), gap, event(4)], gap.id, [event(2), event(3)], 2), [event(3), event(4)]);
});
test("unretrievable and missing gap labels are localized", () => {
  assert.match(gapLabel("pt-PT", true, 2, 3), /irrecuperáveis/);
  assert.match(gapLabel("fr", false, 2, 3), /manquantes/);
  assert.match(gapLabel("en", true, 2, 3), /Unretrievable/);
});
