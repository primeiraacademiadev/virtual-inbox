import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ApiClient } from "../../framework/api-client";
import { baseUrl } from "../../framework/environment";

test("SSE emits event after a new inbound SMS", async () => {
  const api = new ApiClient();
  const inbox = await api.create("sms");
  const controller = new AbortController();
  try {
    const response = await fetch(baseUrl + "/api/logs/events", {
      signal: controller.signal,
      headers: { accept: "text/event-stream" },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const message = "SSE-" + randomUUID();
    const sent = await fetch(baseUrl + "/demo/sms/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "harness", to: inbox.address, body: message }),
    });
    expect(sent.ok).toBeTruthy();
    const until = Date.now() + 8000;
    let stream = "";
    while (Date.now() < until && !stream.includes("message.received")) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE timeout")), 8000)),
      ]);
      if (next.done) break;
      stream += new TextDecoder().decode(next.value);
    }
    expect(stream).toContain("message.received");
  } finally {
    controller.abort();
    await api.dispose();
  }
});
