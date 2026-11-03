import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ApiClient } from "../../framework/api-client";
test("national and E.164 SMS route to the same inbox", async () => {
  const api = new ApiClient();
  try {
    const national = "91" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
    const inbox = await api.json<{ id: string; address: string }>("/phone-numbers", {
      method: "POST",
      body: JSON.stringify({
        phoneNumber: national,
        ttlSeconds: 120,
        generation: { locale: "pt-PT" },
      }),
    });
    api.created.push("/phone-numbers/" + inbox.id);
    const text = "SMS-" + randomUUID();
    await api.json("/phone-numbers/" + inbox.id);
    await api.json("/phone-numbers?address=" + encodeURIComponent("+351" + national));
    const response = await fetch(
      (process.env.VI_BASE_URL || "https://127.0.0.1:3443") + "/demo/sms/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "harness", to: "+351" + national, body: text }),
      },
    );
    expect(response.ok).toBeTruthy();
    const msgs = await api.messages({ id: inbox.id, address: national, channel: "sms" });
    expect(msgs.some((m) => m.body === text)).toBeTruthy();
  } finally {
    await api.dispose();
  }
});
