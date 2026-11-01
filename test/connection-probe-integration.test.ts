import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import nodemailer from "nodemailer";

// The child inherits NODE_V8_COVERAGE from c8: this also covers server.ts,
// including SMTP AUTH OPEN, the special DATA handler and admin simulation routes.
async function freePorts(): Promise<[number, number, number]> {
  const listeners = Array.from({ length: 3 }, () => createServer());
  try {
    await Promise.all(listeners.map(async (listener) => {
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
    }));
    return listeners.map((listener) => {
      const addr = listener.address();
      if (!addr || typeof addr === "string") throw Error("Port unavailable");
      return addr.port;
    }) as [number, number, number];
  } finally {
    await Promise.all(listeners.map((listener) =>
      new Promise<void>((done) => listener.close(() => done()))));
  }
}

test("real SMTP OPEN discovery identifies the client across connections and injects a DATA fault", { timeout: 45_000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "vi-probe-"));
  const [port, httpsPort, smtpPort] = await freePorts();
  const token = "admin-" + randomUUID();
  const certs = join(temp, "certs");
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      HOST: "127.0.0.1", SMTP_HOST: "127.0.0.1", PUBLIC_HOST: "localhost",
      PORT: String(port), HTTPS_PORT: String(httpsPort), SMTP_PORT: String(smtpPort),
      POP3_PORT: "0", SMTPS_PORT: "0", DEMO_PORT: "0", DEMO_HTTPS_PORT: "0",
      TLS_MODE: "auto", TLS_SERVER_NAMES: "localhost,127.0.0.1",
      TLS_CERTIFICATES_DIR: certs,
      NETWORK_SETTINGS_FILE: join(temp, "network.json"),
      TLS_MANAGED_IDENTITY_FILE: join(temp, "identity.json"),
      ADMIN_TOKEN: token, SMTP_AUTH_POLICY: "OPEN", SMTP_SESSION_HISTORY_HOURS: "24",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  const transports: Array<ReturnType<typeof nodemailer.createTransport>> = [];
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error("SMTP OPEN server terminated: " + serverOutput);
      try {
        if ((await fetch("http://127.0.0.1:" + port + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch { /* startup still in progress */ }
      await delay(100);
    }
    assert.ok(ready, "SMTP OPEN server not healthy: " + serverOutput);
    const ca = readFileSync(join(certs, "ca.pem"));
    const admin = (method: string, path: string, value?: unknown, authorized = true) =>
      new Promise<{ status: number; data: any }>((resolveResponse, reject) => {
        const req = httpsRequest({
          hostname: "127.0.0.1", servername: "localhost", port: httpsPort,
          path: "/api" + path, method, ca, rejectUnauthorized: true,
          headers: {
            ...(authorized ? { Authorization: "Bearer " + token } : {}),
            ...(value === undefined ? {} : { "Content-Type": "application/json" }),
          },
        }, (res) => {
          let result = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { result += chunk; });
          res.on("end", () => {
            try { resolveResponse({ status: res.statusCode || 0, data: result ? JSON.parse(result) : undefined }); }
            catch (error) { reject(error); }
          });
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end(value === undefined ? undefined : JSON.stringify(value));
      });
    const transport = () => {
      const client = nodemailer.createTransport({
        host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true,
        pool: true, maxConnections: 1, maxMessages: 100,
        auth: { user: "communication-test", pass: "reused-password" },
        connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 7000,
        disableFileAccess: true, disableUrlAccess: true,
      });
      transports.push(client);
      return client;
    };
    const sender = "sender@example.test";
    const probe = async (client: ReturnType<typeof nodemailer.createTransport>) => {
      const address = randomUUID().replaceAll("-", "") + "@virtual.inbox";
      await client.sendMail({
        envelope: { from: sender, to: [address] },
        raw: "From: sender@example.test\r\nTo: " + address + "\r\n\r\n",
      });
      const inboxes = await fetch("http://127.0.0.1:" + port + "/api/mailboxes?address=" + address);
      assert.equal(inboxes.status, 200);
      const listed = await inboxes.json() as Array<{ id: string; expiresAt: string; createdAt: string }>;
      assert.equal(listed.length, 1);
      const ttlMs = Date.parse(listed[0].expiresAt) - Date.parse(listed[0].createdAt);
      assert.ok(ttlMs >= 60_000 && ttlMs <= 66_000,
        `Probe inbox must expire after 60-66 seconds; got ${ttlMs} ms`);
      const messages = await fetch("http://127.0.0.1:" + port + "/api/mailboxes/" + listed[0].id + "/messages");
      const items = await messages.json() as Array<{ body: string }>;
      assert.equal(items.length, 1);
      return JSON.parse(items[0].body) as {
        clientId: string; smtpSessionId: string;
        sessions: Array<{ smtpSessionId: string; connectedAt: string; current: boolean; connected: boolean; disconnectedAt: string | null }>;
      };
    };
    const first = transport();
    const firstProbe = await probe(first);
    assert.match(firstProbe.clientId, /^[a-f0-9-]{36}$/i);
    assert.equal(firstProbe.sessions.length, 1);
    assert.equal(firstProbe.sessions[0].current, true);
    assert.equal(firstProbe.smtpSessionId, firstProbe.sessions[0].smtpSessionId);
    assert.equal((await admin("GET", "/admin/smtp/sessions?clientId=" + firstProbe.clientId)).data.length, 1);

    const simulationPath = "/admin/smtp/sessions/" + firstProbe.smtpSessionId + "/simulations";
    assert.equal((await admin("POST", simulationPath, { command: "DATA", code: 451, remaining: 1 }, false)).status, 403);
    assert.equal((await admin("POST", simulationPath, { command: "RCPT", code: 451, remaining: 1 })).status, 400);
    const created = await admin("POST", simulationPath, {
      command: "DATA", code: 451, message: "Injected test failure", remaining: 1,
    });
    assert.equal(created.status, 201);
    const rules = await admin("GET", simulationPath);
    assert.equal(rules.status, 200);
    assert.equal(rules.data.length, 1);
    await assert.rejects(first.sendMail({
      from: sender, to: "nobody@example.test", subject: "should fail", text: "body",
    }), (error: any) => error?.responseCode === 451);
    assert.equal((await admin("DELETE", simulationPath + "/" + created.data.id)).status, 204);
    assert.equal((await admin("GET", simulationPath)).data.length, 0);

    first.close();
    // A fresh transport opens a different SMTP connection but retains the client identity.
    const second = transport();
    const secondProbe = await probe(second);
    assert.equal(secondProbe.clientId, firstProbe.clientId);
    assert.notEqual(secondProbe.smtpSessionId, firstProbe.smtpSessionId);
    assert.equal(secondProbe.sessions.length, 2);
    const previous = secondProbe.sessions.find((s) => s.smtpSessionId === firstProbe.smtpSessionId);
    assert.equal(previous?.connected, false);
    assert.ok(previous?.disconnectedAt);
    assert.equal(secondProbe.sessions.find((s) => s.current)?.smtpSessionId, secondProbe.smtpSessionId);

    const badAddress = randomUUID().replaceAll("-", "") + "@virtual.inbox";
    await assert.rejects(second.sendMail({
      envelope: { from: sender, to: [badAddress] },
      raw: "From: sender@example.test\r\nTo: " + badAddress + "\r\nSubject: forbidden\r\n\r\n",
    }), (error: any) => error?.responseCode === 554);
    const notCreated = await fetch("http://127.0.0.1:" + port + "/api/mailboxes?address=" + badAddress);
    assert.deepEqual(await notCreated.json(), []);

    // Explicit administrative mailbox provisioning must not bypass reserved-domain rules.
    const manual = await fetch("http://127.0.0.1:" + port + "/api/mailboxes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: badAddress }),
    });
    assert.equal(manual.status, 400);
  } finally {
    for (const client of transports) client.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit").catch(() => {}), delay(2500)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(temp, { recursive: true, force: true });
  }
});
