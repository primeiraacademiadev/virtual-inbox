import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.VI_BASE_URL || "http://127.0.0.1:3000";
async function request(path, method = "GET", data) {
  const response = await fetch(new URL(path, baseUrl), {
    method, headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}
let inbox;
try {
  inbox = await request("/api/phone-numbers", "POST", { ttlSeconds: 180 });
  const marker = "sms-example-" + randomUUID();
  const waiting = request(`/api/phone-numbers/${inbox.id}/wait-for-message`, "POST", {
    timeoutMs: 10000, match: { bodyContains: marker },
  });
  const [message] = await Promise.all([
    waiting,
    request("/demo/sms/messages", "POST", { from: "example", to: inbox.address, body: marker }),
  ]);
  assert.ok(message, "No matching message before timeout");
  assert.equal(message.destinationId, inbox.id);
  assert.equal(message.body, marker);
  console.log(`PASS: simulated SMS captured as ${message.id}; no carrier was contacted.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (inbox) {
    try { await request(`/api/phone-numbers/${inbox.id}`, "DELETE"); }
    catch (error) { console.error("Cleanup failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
}
