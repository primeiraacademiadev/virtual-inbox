import test from "node:test";
import assert from "node:assert/strict";
import { VirtualInboxClient, type Inbox, type InboxMessage } from "../sdk/client.js";

const inbox: Inbox = {
  id: "test-inbox", channel: "email", address: "test@sandbox.test",
  createdAt: "2026-10-25T00:00:00Z", expiresAt: null,
};

test("SDK exposes decoded sender and preserves raw headers and SMTP envelope", async () => {
  const originalFetch = globalThis.fetch;
  const message: InboxMessage = {
    id: "msg-1", sequence: 7, channel: "email", destinationId: inbox.id,
    from: "bounce@example.test", originalRecipient: inbox.address,
    subject: "Hello", body: "", html: "<p>Verification</p>",
    headers: [{ key: "from", originalKey: "From", value: "=?UTF-8?Q?Primeira_Academia_=E2=80=94_Testes?= <sender@example.test>" }],
    decodedFrom: { name: "Primeira Academia — Testes", address: "sender@example.test" },
    envelope: { mailFrom: "bounce@example.test", rcptTo: [inbox.address, "blind@example.test"] },
    authUser: "communication", smtpSessionId: "smtp-session-1",
  };
  const requested: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = async (url, init) => {
    requested.push({
      url: String(url), method: init?.method || "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return Response.json(requested.at(-1)?.method === "POST" ? message : [message]);
  };
  try {
    const sdk = new VirtualInboxClient("http://127.0.0.1:3000");
    const listed = await sdk.messages(inbox);
    assert.deepEqual(listed[0].decodedFrom, message.decodedFrom);
    assert.deepEqual(listed[0].headers, message.headers);
    assert.deepEqual(listed[0].envelope?.rcptTo, [inbox.address, "blind@example.test"]);
    const found = await sdk.wait(inbox, {
      header: { name: "X-Message-ID", valueContains: "trace-123" },
      htmlContains: "<p>Verification", bodyContains: "Verification",
    }, 8000, 6);
    assert.deepEqual(found, message);
    assert.equal(requested[0].url, "http://127.0.0.1:3000/mailboxes/test-inbox/messages");
    const input = JSON.parse(requested[1].body || "{}");
    assert.deepEqual(input, {
      match: {
        header: { name: "X-Message-ID", valueContains: "trace-123" },
        htmlContains: "<p>Verification", bodyContains: "Verification",
      },
      timeoutMs: 8000, after: 6,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SDK wait handles HTTP 204; withInbox removes disposable inbox even on error", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push((init?.method || "GET") + " " + new URL(String(url)).pathname);
    if (String(url).includes("wait-for-message")) return new Response(null, { status: 204 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(inbox, { status: 201 });
  };
  try {
    const sdk = new VirtualInboxClient();
    assert.equal(await sdk.wait(inbox, {}, 1000), null);
    await assert.rejects(
      sdk.withInbox("email", async resource => {
        assert.equal(resource.id, inbox.id);
        throw new Error("test error");
      }),
      /test error/,
    );
    assert.deepEqual(calls, [
      "POST /mailboxes/test-inbox/wait-for-message",
      "POST /mailboxes",
      "DELETE /mailboxes/test-inbox",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SDK create, SMS path and attachment downloads use the current routes", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: string; method?: string }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (String(url).includes("/attachments/")) return new Response(new Uint8Array([0, 1, 255]));
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ ...inbox, channel: "sms", id: "phone-1", address: "+351900000001" });
  };
  try {
    const sdk = new VirtualInboxClient();
    const sms = await sdk.create("sms", "+351900000001", 100);
    assert.equal(sms.channel, "sms");
    assert.deepEqual(JSON.parse(requests[0].body || "{}"), {
      phoneNumber: "+351900000001", ttlSeconds: 100,
    });
    await sdk.messages(sms);
    assert.match(requests[1].url, /\/phone-numbers\/phone-1\/messages$/);
    const bytes = await sdk.download(sms, "message-1", "file-1");
    assert.deepEqual([...bytes], [0, 1, 255]);
    await sdk.delete(sms);
    assert.equal(requests.at(-1)?.method, "DELETE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("SDK scoped SMTP rules clean up and completed-attempt polling waits for a terminal outcome", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let polls = 0;
  const rule = { id:"rule-1",phase:"MAIL",action:"reply",code:451,remaining:1,
    scope:"SPECIFIC",priority:0,selectors:{sender:"sender@example.test"},createdAt:"2026-11-03T00:00:00Z" };
  globalThis.fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(url)).pathname;
    requests.push(method + " " + path);
    if (path.endsWith("/reply-rules") && method === "POST") return Response.json(rule, {status:201});
    if (path.endsWith("/rule-1") && method === "DELETE") return new Response(null,{status:204});
    if (path.endsWith("/attempts")) {
      polls++;
      return Response.json([{id:"attempt-1",smtpSessionId:"session-1",startedAt:"2026-11-03T00:00:00Z",
        updatedAt:"2026-11-03T00:00:00Z",recipients:[],messageIds:[],ruleIds:["rule-1"],
        outcome:polls===1?"in_progress":"rejected",phase:"MAIL",persisted:false,responseCode:451}]);
    }
    throw Error("Unexpected request: " + String(url));
  };
  try {
    const sdk = new VirtualInboxClient("http://127.0.0.1:3000",
      {adminUrl:"https://localhost:3443",adminToken:"test-token"});
    const input = {phase:"MAIL" as const,action:"reply" as const,code:451,remaining:1,
      ttlMs:5000,selectors:{sender:"sender@example.test"}};
    const attempt = await sdk.withSmtpRule(input, async created => {
      assert.equal(created.id,"rule-1");
      return sdk.waitForCompletedSmtpAttempt({ruleId:created.id},
        {attemptId:"attempt-1",timeoutMs:1000,pollIntervalMs:1});
    });
    assert.equal(attempt.outcome,"rejected");
    assert.equal(polls,2);
    await assert.rejects(sdk.withSmtpRule(input, async () => {
      throw Error("consumer test failed");
    }),/consumer test failed/);
    assert.deepEqual(requests.filter(x=>x==="DELETE /admin/smtp/reply-rules/rule-1").length,2);
  } finally { globalThis.fetch = originalFetch; }
});


test("SDK ingestSms calls only the common public ingestion endpoint", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: unknown; correlationId: string | null }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, method: init?.method ?? "GET",
      body: JSON.parse(String(init?.body)), correlationId: new Headers(init?.headers).get("X-VI-Correlation-ID") });
    return Response.json({ id: "captured", channel: "sms", destinationId: "inbox",
      sequence: 1, from: "tester", originalRecipient: "+351912345678", body: "Hello" },
      { status: 201 });
  };
  try {
    const sdk = new VirtualInboxClient("http://127.0.0.1:3000/api/");
    const input = { from: "tester", to: "+351912345678", body: "Hello" };
    const result = await sdk.ingestSms(input, { correlationId: "sdk-correlation-42" });
    assert.equal(result.id, "captured");
    assert.deepEqual(calls, [{ path: "/api/sms/ingestions", method: "POST", body: input, correlationId: "sdk-correlation-42" }]);
  } finally { globalThis.fetch = previous; }
});
