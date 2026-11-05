import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sandbox } from "../src/core.js";
import { SmtpReplyRuleStore } from "../src/smtp-reply-rules.js";
import { handleRequest } from "../src/http/request-router.js";
import type { RequestContext } from "../src/server.js";

type Fixture = {
  sandbox: Sandbox;
  rules: SmtpReplyRuleStore;
  base: string;
  context: RequestContext;
  request: (path: string, method?: string, value?: unknown, headers?: Record<string, string>) => Promise<Response>;
  close: () => Promise<void>;
};

async function fixture(): Promise<Fixture> {
  const sandbox = new Sandbox(100);
  const rules = new SmtpReplyRuleStore();
  const directory = mkdtempSync(join(tmpdir(), "vi-router-contract-"));
  const sessions = new Map<string, unknown>();
  const context = {
    sandbox, smtpAuthPolicy: "OPEN", smtpReplyRules: rules,
    credentialStore: {
      createInbox() {},
      resolve: (id: string) => sessions.get(id),
      authenticate: async () => "test-session",
      verify: async () => true,
    },
    inboxAddresses: new Map(), smtpCredentialIds: new Map(),
    smtpSessions: {
      listSessions: () => [], listClients: () => [], getSession: () => undefined,
      verifyCredentials: async () => ({ matches: false }),
    },
    smtpRuleIdentities: { resolve: () => ({ origins: [] }) },
    simulations: {
      create: (value: unknown) => ({ id: "simulation-1", ...value as object }),
      delete: () => true, list: () => [], listConnection: () => [],
    },
    smtpAttempts: { list: () => [] },
    protocolCounters: { snapshot: () => ({ SMTP: 0 }) },
    pop3Connections: { list: () => [] },
    lastCleanupAt: null,
    networkSettingsFile: join(directory, "network.json"),
    savedSettings: {},
    setting: (_key: string, fallback: string) => fallback,
    networkKeys: ["PUBLIC_HOST", "PORT"],
    adminAllowed: () => true,
    port: 3000, httpsPort: 3443, smtpPort: 2525, smtpsPort: 2465,
    pop3Port: 2110, demoPort: 3001, demoHttpsPort: 3444,
    tlsMode: "off", tlsDirectory: directory,
    managedNamesFile: join(directory, "names.json"),
    managedIdentityFile: join(directory, "managed.json"),
    effectiveTlsNames: () => [],
    certificateManager: { info: () => null, activate: () => null },
    tlsIdentity: null,
    addressHost: "localhost", apiHost: "127.0.0.1", smtpHost: "127.0.0.1",
    allowedOrigins: new Set<string>(), allowedHosts: ["127.0.0.1"],
    listenersReady: true, startedListeners: [{ name: "HTTP", port: 3000, host: "127.0.0.1" }],
  } as unknown as RequestContext;
  const server: Server = createServer((req, res) => {
    void handleRequest(req, res, context).catch(error => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const base = "http://127.0.0.1:" + addr.port;
  return {
    sandbox, rules, base, context,
    request: (path, method = "GET", value?, headers = {}) => fetch(base + path, {
      method,
      headers: { ...(value === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("router exposes health, readiness, capabilities and network discovery", async () => {
  const f = await fixture();
  try {
    const health = await f.request("/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).runId, f.sandbox.runId);
    const ready = await f.request("/api/ready");
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);
    (f.context as any).listenersReady = false;
    const notReady = await f.request("/api/ready");
    assert.equal(notReady.status, 503);
    (f.context as any).listenersReady = true;
    const cap = await f.request("/api/capabilities");
    assert.deepEqual((await cap.json()).simulation.actions, ["reply", "delay", "drop", "hang", "reset"]);
    const info = await f.request("/api/connection-info");
    assert.equal((await info.json()).smtp.plainPort, 2525);
    const tlsStatus = await f.request("/api/tls/status");
    assert.deepEqual(await tlsStatus.json(), { active: null });
    assert.equal((await f.request("/api/tls/ca.pem")).status, 404);
    assert.equal((await f.request("/api/tls/certificate.pem")).status, 404);
    assert.equal((await f.request("/api/identity-generation/options")).status, 200);
    assert.equal((await f.request("/api/openapi.json")).status, 200);
    assert.equal((await f.request("/api/openapi-demo.json")).status, 200);
  } finally { await f.close(); }
});

test("router exercises email and SMS inbox lifecycle and input validation", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/api/mailboxes", "POST",
      { address: "probe@virtual.inbox" })).status, 400);
    assert.equal((await f.request("/api/mailboxes", "POST",
      { address: "a@example.test", ifExists: "invalid" })).status, 400);
    const created = await f.request("/api/mailboxes", "POST", { address: "a@example.test" });
    assert.equal(created.status, 201);
    const inbox = await created.json();
    const returned = await f.request("/api/mailboxes", "POST",
      { address: "a@example.test", ifExists: "return" });
    assert.equal(returned.status, 200);
    assert.equal((await returned.json()).id, inbox.id);
    assert.equal((await f.request("/api/mailboxes?address=a@example.test")).status, 200);
    assert.deepEqual(await (await f.request("/api/mailboxes?address=absent@example.test")).json(), []);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id)).status, 200);
    assert.deepEqual(await (await f.request("/api/mailboxes/" + inbox.id + "/messages")).json(), []);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id + "/messages?after=oops")).status, 400);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id + "/messages?from=a&from=b")).status, 400);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id + "/messages/missing")).status, 404);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id +
      "/messages/missing/attachments/missing")).status, 404);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id + "/messages", "DELETE")).status, 204);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id, "DELETE")).status, 204);
    assert.equal((await f.request("/api/mailboxes/" + inbox.id)).status, 404);

    const sms = await f.request("/api/phone-numbers", "POST", { phoneNumber: "+351910000000" });
    assert.equal(sms.status, 201);
    const phone = await sms.json();
    assert.equal((await f.request("/api/phone-numbers/" + phone.id)).status, 200);
    assert.equal((await f.request("/api/phone-numbers/" + phone.id + "/messages")).status, 200);
    assert.equal((await f.request("/api/phone-numbers/" + phone.id, "DELETE")).status, 204);
  } finally { await f.close(); }
});

test("router validates bounded log paging, range, replay, and conflicting cursors", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 8; i++) f.sandbox.log("test.event", undefined, undefined, { i });
    const replay = await (await f.request("/api/logs")).json();
    assert.equal(replay.events.length, 8);
    const page = await (await f.request("/api/logs?limit=3")).json();
    assert.equal(page.events.length, 3);
    assert.equal(page.hasMore, true);
    const older = await (await f.request("/api/logs?before=" + page.nextBefore + "&limit=2")).json();
    assert.equal(older.events.length, 2);
    const range = await (await f.request("/api/logs?from=2&to=4")).json();
    assert.equal(range.events.length, 3);
    assert.equal(range.requestedFrom, 2);
    for (const path of [
      "/api/logs?limit=3&after=1", "/api/logs?before=3&from=1&to=2",
      "/api/logs?from=2", "/api/logs?from=5&to=4",
      "/api/logs?from=0&to=4", "/api/logs?from=1&to=10005",
      "/api/logs?limit=0", "/api/logs?type=a&type=b",
    ]) {
      const response = await f.request(path);
      assert.equal(response.status, 400, path);
    }
  } finally { await f.close(); }
});

test("router validates administrative simulation rules, permissions and errors", async () => {
  const f = await fixture();
  try {
    (f.context as any).adminAllowed = () => false;
    for (const [method, path] of [
      ["GET", "/api/admin/pop3/connections"],
      ["GET", "/api/admin/test/metrics"],
      ["GET", "/api/admin/smtp/reply-rules"],
      ["POST", "/api/admin/smtp/reply-rules"],
      ["GET", "/api/admin/smtp/clients"],
      ["GET", "/api/admin/footprint"],
      ["PUT", "/api/admin/tls"],
      ["PUT", "/api/admin/network"],
    ]) assert.equal((await f.request(path, method)).status, 403, path);
    (f.context as any).adminAllowed = () => true;
    assert.equal((await f.request("/api/admin/pop3/connections")).status, 200);
    assert.equal((await f.request("/api/admin/test/metrics")).status, 200);
    const created = await f.request("/api/admin/smtp/reply-rules", "POST",
      { phase: "MAIL", action: "reply", code: 451, remaining: 1 });
    assert.equal(created.status, 201);
    const rule = await created.json();
    assert.equal((await (await f.request("/api/admin/smtp/reply-rules")).json()).length, 1);
    assert.equal((await f.request("/api/admin/smtp/reply-rules/" + rule.id, "DELETE")).status, 204);
    assert.equal((await f.request("/api/admin/smtp/reply-rules/" + rule.id, "DELETE")).status, 404);
    assert.equal((await f.request("/api/admin/smtp/clients")).status, 200);
    assert.equal((await f.request("/api/admin/smtp/sessions")).status, 200);
    assert.equal((await f.request("/api/admin/smtp/attempts?limit=2")).status, 200);
    assert.equal((await f.request("/api/admin/test/sessions", "POST", { username: "" })).status, 400);
    assert.equal((await f.request("/api/admin/test/sessions", "POST",
      { username: "missing@example.test", password: "synthetic" })).status, 404);
    assert.equal((await f.request("/api/admin/test/sessions/missing")).status, 404);
    assert.equal((await f.request("/api/admin/smtp/sessions/missing/simulations", "POST",
      { command: "DATA" })).status, 404);
    assert.equal((await f.request("/api/admin/test/sessions/missing/simulations", "POST",
      { protocol: "SMTP", command: "DATA", code: 451 })).status, 404);
    assert.equal((await f.request("/api/admin/smtp/sessions/missing/simulations/missing", "DELETE")).status, 404);
    assert.equal((await f.request("/api/admin/tls", "PUT", { cert: "x", key: "y" })).status, 409);
    assert.equal((await f.request("/api/admin/tls/names", "PUT", { dns: [], ips: [] })).status, 409);
  } finally { await f.close(); }
});

test("router handles observer subscriptions, invalid hosts, CORS and unsupported methods", async () => {
  const f = await fixture();
  try {
    const observerId = f.sandbox.newObserver().observerId;
    const recipient = f.sandbox.create("email", "observer@example.test");
    assert.equal((await f.request("/api/observers/" + observerId)).status, 200);
    const watch = await f.request("/api/observers/" + observerId + "/inboxes", "POST",
      { inboxId: recipient.id });
    assert.equal(watch.status, 200);
    assert.equal((await watch.json()).recipient.id, recipient.id);
    assert.equal((await f.request("/api/observers/" + observerId + "/inboxes/" +
      recipient.id, "DELETE")).status, 204);
    assert.equal((await f.request("/api/observers/missing")).status, 404);
    assert.equal((await f.request("/api/not-a-route")).status, 404);
    assert.equal((await f.request("/api/health", "OPTIONS")).status, 204);
    assert.equal((await f.request("/api/health", "GET", undefined,
      { "Origin": "https://untrusted.example.test" })).status, 403);
    assert.equal((await f.request("/api/health", "GET", undefined,
      { "Host": "not-allowed.example.test" })).status, 421);
  } finally { await f.close(); }
});
