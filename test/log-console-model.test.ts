import test from "node:test";
import assert from "node:assert/strict";
import { appendLog, visibleLogs, logStreamQuery, gapRange, recoverableGapUrl, mergeRecoveredLogs, gapLabel, logPageUrl, snapshotCursor, logSseUrl, mergeOlderPage, pageSnapshot, gapMarker, appendGap } from "../web/src/logs/log-model.js";
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

test("paged log URLs use validated exact filters and exclusive cursors", () => {
  assert.equal(logPageUrl("sender", " a+b@example.test ", 42), "/logs?limit=20&before=42&sender=a%2Bb%40example.test");
  assert.equal(logPageUrl("unknown", "anything"), "/logs?limit=20");
  assert.equal(logPageUrl("type", " ", undefined, 5), "/logs?limit=5");
});
test("snapshot cursors use the globally latest event, not the filtered page tail", () => {
  const page = { events: [event(8), event(6)], latest: { log_id: 10, at: event(10).at }, runId: "run-A", hasMore: true };
  assert.equal(snapshotCursor(page), "run-A:10");
  assert.equal(snapshotCursor({ ...page, latest: null }), null);
  assert.equal(snapshotCursor({ ...page, runId: undefined }), null);
  assert.equal(snapshotCursor({ ...page, latest: { log_id: 0, at: "" } }), null);
});
test("SSE URLs resume after the REST snapshot and escape cursors", () => {
  assert.equal(logSseUrl("/api/logs/events", "sender", "joe@example.test", "run:12"),
    "/api/logs/events?sender=joe%40example.test&after=run%3A12");
  assert.equal(logSseUrl("/api/logs/events", "bogus", "value", null), "/api/logs/events");
  assert.equal(logSseUrl("/api/logs/events", "bogus", "value", "run:1"),
    "/api/logs/events?after=run%3A1");
});
test("page snapshots sort oldest-to-newest and cap local retention", () => {
  const page = { events: [event(4), event(3), event(2), event(1)], hasMore: false };
  assert.deepEqual(pageSnapshot(page, 3).map((x) => x.log_id), [2, 3, 4]);
  assert.deepEqual(pageSnapshot({ events: [], hasMore: false }, 3), []);
});
test("old history merges without duplicates and cannot evict newer live events", () => {
  const page = { events: [event(3), event(2), event(1)], hasMore: true };
  assert.deepEqual(mergeOlderPage([event(3), event(4), event(5)], page, 5).map((x) => x.log_id), [1, 2, 3, 4, 5]);
  assert.deepEqual(mergeOlderPage([event(4), event(5)], page, 2).map((x) => x.log_id), [4, 5]);
  assert.deepEqual(mergeOlderPage([], { events: [], hasMore: false }, 2), []);
});
test("gaps become unique system markers and reject invalid ranges", () => {
  const marker = gapMarker(2, 4, "2026-11-01T00:00:00Z");
  assert.equal(marker?.id, "gap:2:4");
  assert.deepEqual(marker?.data, { missingFrom: 2, missingTo: 4 });
  assert.equal(gapMarker(0, 2, ""), null);
  assert.equal(gapMarker(5, 2, ""), null);
  assert.equal(gapMarker(1.5, 2, ""), null);
  assert.deepEqual(appendGap([event(1)], marker, 5).map((x) => x.id), ["run:1", "gap:2:4"]);
  assert.deepEqual(appendGap([event(1)], null, 5), [event(1)]);
  assert.equal(appendGap([marker!], marker, 5).length, 1);
});

test("anomaly visibility propagates to REST, SSE and local filters", () => {
  const anomaly = event(7, "message.captured");
  const regular = event(8, "other");
  assert.deepEqual(visibleLogs([anomaly, regular], "other").map(x => x.id), [anomaly.id, regular.id]);
  assert.deepEqual(visibleLogs([anomaly, regular], "other", false).map(x => x.id), [regular.id]);
  assert.equal(logStreamQuery("inboxId", "alpha", false), "?inboxId=alpha&includeAnomalies=false");
  assert.equal(logPageUrl("inboxId", "alpha", undefined, 20, false), "/logs?limit=20&inboxId=alpha&includeAnomalies=false");
  assert.equal(logSseUrl("/api/logs/events", "inboxId", "alpha", "run:4", false),
    "/api/logs/events?inboxId=alpha&includeAnomalies=false&after=run%3A4");
});
