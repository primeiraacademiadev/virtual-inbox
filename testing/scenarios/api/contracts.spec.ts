import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ApiClient } from "../../framework/api-client";
import { baseUrl } from "../../framework/environment";
test("mailbox CRUD and same-origin demo transport", async () => {
  const api = new ApiClient();
  try {
    const mailbox = await api.create("email", { locale: "fr-FR", strategy: "LAST_FIRST" });
    expect(mailbox.address).toMatch(/^[a-z]+\.[a-z]+@sandbox\.test$/);
    const topic = "demo-" + randomUUID();
    const response = await fetch(baseUrl + "/demo/mailboxes/" + mailbox.id + "/demo-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: topic,
        body: "same-origin E2E",
        from: "harness@example.test",
      }),
    });
    expect(response.status).toBe(202);
    const message = await api.waitFor(mailbox, topic);
    expect(message?.subject).toBe(topic);
    await api.fetch("/mailboxes/" + mailbox.id + "/messages/" + message!.id, { method: "DELETE" });
    const remaining = await api.messages(mailbox);
    expect(remaining.some((m) => m.id === message!.id)).toBeFalsy();
  } finally {
    await api.dispose();
  }
});
test("generation metadata exposes all supported locales", async () => {
  const api = new ApiClient();
  const options = await api.json<{ locales: string[]; strategies: { email: string[] } }>(
    "/identity-generation/options",
  );
  expect(options.locales).toEqual(expect.arrayContaining(["pt-PT", "en-US", "fr-FR"]));
  expect(options.strategies.email).toContain("LAST_FIRST");
});
