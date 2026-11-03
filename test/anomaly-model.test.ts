import test from "node:test";
import assert from "node:assert/strict";
import { filteredAnomalies, anomalyGroups } from "../web/src/anomalies/anomaly-model.js";
import type { Message } from "../web/src/api.js";
const msg = (id: string, to: string, from: string, reason: string): Message =>
  ({ id, sequence: Number(id), destinationId: "system", channel: "email", from, originalRecipient: to,
    receivedAt: "2026-11-01T00:00:00Z", body: "synthetic", captureReason: reason });
test("anomaly counts group by recipient and capture reason", () => {
  const messages = [msg("1","a@example.test","x@example.test","UNKNOWN_RECIPIENT"),
    msg("2","a@example.test","y@example.test","UNKNOWN_RECIPIENT"),
    msg("3","b@example.test","x@example.test","EXPIRED_RECIPIENT")];
  assert.deepEqual(anomalyGroups(messages).map(g => g.count), [2,1]);
  assert.equal(filteredAnomalies(messages,{recipient:" A@",sender:"",reason:""}).length,2);
  assert.equal(filteredAnomalies(messages,{recipient:"",sender:"X@",reason:""}).length,2);
  assert.equal(filteredAnomalies(messages,{recipient:"",sender:"",reason:"EXPIRED_RECIPIENT"}).length,1);
  assert.equal(filteredAnomalies(messages,{recipient:"a@",sender:"x@",reason:"EXPIRED_RECIPIENT"}).length,0);
});
