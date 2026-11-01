import test from "node:test";
import assert from "node:assert/strict";
import { initialHistory, olderHistory, recoverHistoryGap } from "../web/src/logs/log-history-service.js";
import type { EventEntry } from "../web/src/api.js";

const event = (n: number): EventEntry => ({ id: "run:" + n, log_id: n, type: "test.event", at: "2026-11-01T00:00:00Z" });
test("initial history requests newest page and exposes cursor", async () => {
  let requested = "";
  const fetchJson = async <T>(path: string): Promise<T> => {
    requested = path;
    return { events: [event(3), event(2)], latest: { log_id: 3, at: event(3).at },
      nextBefore: 2, hasMore: true, runId: "run" } as T;
  };
  const result = await initialHistory(fetchJson, "sender", "test@example.org", 5);
  assert.equal(requested, "/logs?limit=20&sender=test%40example.org");
  assert.deepEqual(result.entries.map(x => x.log_id), [2, 3]);
  assert.equal(result.cursor, "run:3");
  assert.equal(result.nextBefore, 2);
  assert.equal(result.hasMore, true);
});
test("older history merges deduplicated pages and respects depth", async () => {
  const result = await olderHistory(async <T>(path: string) => {
    assert.equal(path, "/logs?limit=20&before=3");
    return { events: [event(2), event(1)], hasMore: false, nextBefore: 1 } as T;
  }, "type", "", 3, [event(3), event(4)], 3);
  assert.deepEqual(result.entries.map(x => x.log_id), [2, 3, 4]);
  assert.equal(result.hasMore, false);
});
test("gap recovery merges available entries and distinguishes unretrievable gaps", async () => {
  const gap: EventEntry = { id: "gap:2:3", type: "log.gap", at: event(1).at, data: { missingFrom: 2, missingTo: 3 } };
  const fetchJson = async <T>(path: string) => {
    assert.equal(path, "/logs?from=2&to=3");
    return { events: [event(2), event(3)] } as T;
  };
  const result = await recoverHistoryGap(fetchJson, "type", "", gap, [event(1), gap, event(4)], 20);
  assert.deepEqual(result?.map(x => x.log_id), [1, 2, 3, 4]);
  assert.equal(await recoverHistoryGap(async <T>() => ({ events: [] }) as T, "type", "", gap, [], 20), null);
  assert.equal(await recoverHistoryGap(async <T>() => { throw Error("unexpected fetch"); }, "type", "", event(2), [], 20), null);
});
