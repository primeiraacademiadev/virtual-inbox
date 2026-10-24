import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ApiClient } from "../../framework/api-client";
import { baseUrl, requireManaged } from "../../framework/environment";

const post = async (path: string, data: unknown) =>
  fetch(baseUrl + "/api" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
const demoSms = async (to: string, body: string) =>
  fetch(baseUrl + "/demo/sms/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "resilience-test", to, body }),
  });

test("short-lived inbox expires and delivers subsequent messages to anomalies", async () => {
  requireManaged();
  const api = new ApiClient();
  const response = await post("/phone-numbers", { ttlSeconds: 1 });
  expect(response.status).toBe(201);
  const inbox = (await response.json()) as { id: string; address: string };
  api.created.push("/phone-numbers/" + inbox.id);
  await expect
    .poll(
      async () => {
        const r = await fetch(baseUrl + "/api/phone-numbers/" + inbox.id);
        return r.status;
      },
      { timeout: 5000, intervals: [150, 250, 500] },
    )
    .toBe(404);
  const sent = await demoSms(inbox.address, "expired-" + randomUUID());
  expect(sent.status).toBe(201);
  const anomalies = await api.json<Array<{ id: string; system?: boolean }>>("/phone-numbers");
  const system = anomalies.find((x) => x.system);
  expect(system).toBeTruthy();
  const messages = await api.json<Array<{ captureReason?: string }>>(
    "/phone-numbers/" + system!.id + "/messages",
  );
  expect(messages.some((x) => x.captureReason === "EXPIRED_RECIPIENT")).toBe(true);
  await api.dispose();
});

test("wait-for-message times out without consuming messages", async () => {
  requireManaged();
  const api = new ApiClient();
  try {
    const inbox = await api.create("email");
    const started = Date.now();
    const response = await post("/mailboxes/" + inbox.id + "/wait-for-message", {
      timeoutMs: 150,
      match: { subjectContains: "absent-" + randomUUID() },
    });
    expect(response.status).toBe(204);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(await api.messages(inbox)).toHaveLength(0);
  } finally {
    await api.dispose();
  }
});

test("concurrent SMS deliveries are all captured without duplicate IDs", async () => {
  requireManaged();
  const api = new ApiClient();
  try {
    const inbox = await api.create("sms");
    const prefix = "parallel-" + randomUUID() + "-";
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => demoSms(inbox.address, prefix + i)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const messages = await api.messages(inbox);
    const relevant = messages.filter((m) => m.body.startsWith(prefix));
    expect(relevant).toHaveLength(20);
    expect(new Set(relevant.map((m) => m.id)).size).toBe(20);
  } finally {
    await api.dispose();
  }
});

test("resource quota rejects excess inboxes and service remains healthy", async () => {
  requireManaged();
  const api = new ApiClient();
  try {
    for (let i = 0; i < 40; i++) await api.create("email");
    const rejected = await post("/mailboxes", { ttlSeconds: 60 });
    expect(rejected.status).toBe(507);
    const health = await fetch(baseUrl + "/health");
    expect(health.status).toBe(200);
  } finally {
    await api.dispose();
  }
});

test("SMS size boundary rejects oversized messages and keeps service responsive", async () => {
  requireManaged();
  const api = new ApiClient();
  try {
    const inbox = await api.create("sms");
    const result = await demoSms(inbox.address, "x".repeat(513));
    expect(result.status).toBe(413);
    const accepted = await demoSms(inbox.address, "ok");
    expect(accepted.status).toBe(201);
  } finally {
    await api.dispose();
  }
});
