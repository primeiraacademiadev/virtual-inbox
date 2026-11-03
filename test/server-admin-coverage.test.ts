import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import nodemailer from "nodemailer";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

// Exercise the actual HTTPS administration routes with TLS verification. The
// child inherits NODE_V8_COVERAGE from c8, so server.ts is counted in Sonar.
async function reservePorts(): Promise<[number, number, number]> {
  const servers = [createServer(), createServer(), createServer()];
  try {
    await Promise.all(servers.map(async server => {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
    }));
    return servers.map(server => {
      const address = server.address();
      if (!address || typeof address === "string") throw Error("TCP address unavailable");
      return address.port;
    }) as [number, number, number];
  } finally {
    await Promise.all(servers.map(server => new Promise<void>(done => server.close(() => done()))));
  }
}

test("real HTTPS admin API isolates sessions, verifies credentials and manages protocol simulations", { timeout: 30_000 }, async () => {
  const root = resolve(import.meta.dirname, "..");
  const temp = mkdtempSync(join(tmpdir(), "vi-admin-coverage-"));
  const [port, httpsPort, smtpPort] = await reservePorts();
  const token = "test-only-" + randomUUID();
  const certs = join(temp, "certificates");
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HTTPS_PORT: String(httpsPort),
      SMTP_PORT: String(smtpPort),
      POP3_PORT: "0",
      SMTPS_PORT: "0",
      DEMO_PORT: "0",
      DEMO_HTTPS_PORT: "0",
      HOST: "127.0.0.1",
      SMTP_HOST: "127.0.0.1",
      PUBLIC_HOST: "localhost",
      TLS_MODE: "auto",
      TLS_SERVER_NAMES: "localhost,127.0.0.1",
      TLS_CERTIFICATES_DIR: certs,
      NETWORK_SETTINGS_FILE: join(temp, "network.json"),
      TLS_MANAGED_IDENTITY_FILE: join(temp, "imported.json"),
      ADMIN_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  child.on("error", error => { output += error.message; });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw Error("Admin test server terminated: " + output);
      }
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/health");
        if (response.ok) { ready = true; break; }
      } catch { /* listener not ready */ }
      await delay(150);
    }
    assert.ok(ready, "Admin test server failed to become healthy: " + output);
    const ca = readFileSync(join(certs, "ca.pem"));
    const api = (method: string, path: string, payload?: unknown, authorized = true) =>
      new Promise<{ status: number; data: any }>((resolveResponse, reject) => {
        const req = httpsRequest({
          hostname: "127.0.0.1", servername: "localhost", port: httpsPort,
          path: "/api" + path, method, ca, rejectUnauthorized: true,
          headers: {
            ...(authorized ? { Authorization: "Bearer " + token } : {}),
            ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
          },
        }, res => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", chunk => { raw += chunk; });
          res.on("end", () => {
            try {
              resolveResponse({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : undefined });
            } catch (error) { reject(error); }
          });
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end(payload === undefined ? undefined : JSON.stringify(payload));
      });

    // Exercise REST log filters and bounded range recovery through the real HTTP listener.
    const logBase = "http://127.0.0.1:" + port + "/api/logs";
    const initialLogsResponse = await fetch(logBase);
    assert.equal(initialLogsResponse.status, 200);
    const initialLogs = await initialLogsResponse.json() as { events: Array<{ id: string; log_id: number; type: string }> };
    assert.ok(initialLogs.events.every((event) => event.log_id > 0));
    const filteredLogsResponse = await fetch(logBase + "?type=does-not-exist");
    assert.equal(filteredLogsResponse.status, 200);
    const filteredLogs = await filteredLogsResponse.json() as { events: unknown[] };
    assert.deepEqual(filteredLogs.events, []);
    const rangedLogs = await fetch(logBase + "?from=1&to=10000");
    assert.equal(rangedLogs.status, 200);
    const ranged = await rangedLogs.json() as { events: Array<{ log_id: number }>; requestedFrom: number; requestedTo: number };
    assert.equal(ranged.requestedFrom, 1);
    assert.equal(ranged.requestedTo, 10000);
    assert.ok(ranged.events.every((event) => event.log_id >= 1 && event.log_id <= 10000));
    for (const query of ["?from=0&to=1", "?from=20&to=10", "?from=1", "?from=1&to=10002"]) {
      assert.equal((await fetch(logBase + query)).status, 400);
    }
    assert.equal((await fetch(logBase + "?type=a&type=b")).status, 400);
    const forbidden = await fetch("http://127.0.0.1:" + port + "/api/admin/test/metrics");
    assert.equal(forbidden.status, 403, "admin routes must require authenticated HTTPS");
    assert.equal((await api("GET", "/admin/test/metrics", undefined, false)).status, 403);
    assert.equal((await api("GET","/admin/pop3/connections",undefined,false)).status,403);
    assert.equal((await api("GET","/admin/footprint",undefined,false)).status,403);
    // ADR-0001: read-only SMTP observations are open on HTTP and HTTPS.
    const openSessionsHttp = await fetch("http://127.0.0.1:" + port + "/api/admin/smtp/sessions");
    assert.equal(openSessionsHttp.status, 200);
    assert.deepEqual(await openSessionsHttp.json(), []);
    assert.deepEqual((await api("GET", "/admin/smtp/sessions", undefined, false)).data, []);
    const openAttempts = await fetch("http://127.0.0.1:" + port +
      "/api/admin/smtp/attempts?sender=synthetic@example.test");
    assert.equal(openAttempts.status, 200);
    assert.deepEqual(await openAttempts.json(), []);
    assert.deepEqual((await api("GET", "/admin/smtp/attempts?sender=synthetic@example.test",
      undefined, false)).data, []);
    assert.equal((await fetch("http://127.0.0.1:" + port +
      "/api/admin/smtp/attempts")).status, 400, "a correlation filter is still required");
    assert.equal((await api("POST", "/admin/smtp/sessions/not-a-session/verify",
      {username:"synthetic",password:"synthetic"}, false)).status, 403);
    assert.equal((await api("POST", "/admin/smtp/reply-rules",
      {phase:"MAIL",action:"reply",remaining:1,selectors:{}}, false)).status, 403);

    const emptyPop3 = await api("GET","/admin/pop3/connections");
    assert.deepEqual(emptyPop3.data,[]);
    const footprint = await api("GET","/admin/footprint");
    assert.equal(footprint.status,200);
    assert.ok(footprint.data.memory.rss>0);
    assert.equal(footprint.data.resources.systemInboxes,2);
    const metrics = await api("GET", "/admin/test/metrics");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.data.POP3.connectionsActive, 0);

    // Real TCP transport checks: distinguish rejection before 220 from EHLO rejection after 220.
    const earlyRules = async (phase: "CONNECT" | "EHLO", action: "reply" | "drop" | "hang",
      selectors: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const response = await api("POST", "/admin/smtp/reply-rules", {
        phase, action, remaining: 1, selectors, ...(action === "reply" ? {code:421} : {}),
        ...(action === "hang" ? {durationMs:120} : {}), ...extra,
      });
      assert.equal(response.status,201,JSON.stringify(response.data));
      return response.data.id as string;
    };
    const observeSocket = (command?: string) => new Promise<{reply:string; closed:boolean; elapsed:number}>(
      (finish,reject) => {
        const socket = createConnection({host:"127.0.0.1",port:smtpPort});
        const start = Date.now();
        let reply = "";
        let sent = false;
        let completed = false;
        const timer = setTimeout(() => {
          if (!completed) { completed = true; socket.destroy(); reject(Error("SMTP socket timeout")); }
        },3000);
        socket.on("data", chunk => {
          reply += chunk.toString();
          if (command && !sent && reply.startsWith("220")) {
            sent = true;
            socket.write(command + "\\r\\n");
          }
        });
        socket.on("error", error => { if (!completed) { completed=true;clearTimeout(timer);reject(error); } });
        socket.on("close", () => {
          if (!completed) { completed=true;clearTimeout(timer);finish({reply,closed:true,elapsed:Date.now()-start}); }
        });
      });
    const connectReject = await earlyRules("CONNECT","reply",{origin:{ip:"127.0.0.1"}});
    const connectResult = await observeSocket();
    assert.match(connectResult.reply,/^421 /);
    assert.ok(!connectResult.reply.includes("220"),"CONNECT fails before SMTP banner");
    const ehloReject = await earlyRules("EHLO","reply",{ehloName:"failure.example.test"});
    const ehloResult = await observeSocket("EHLO failure.example.test");
    assert.match(ehloResult.reply,/^220 /);
    assert.match(ehloResult.reply,/421 /);
    const connectDrop = await earlyRules("CONNECT","drop",{connection:{port:smtpPort}});
    const dropResult = await observeSocket();
    assert.equal(dropResult.reply,"","transport drop must not send a SMTP code");
    const connectHang = await earlyRules("CONNECT","hang",{connection:{port:smtpPort}});
    const hangResult = await observeSocket();
    assert.equal(hangResult.reply,"","hang must not send a SMTP code");
    assert.ok(hangResult.elapsed >= 90,"hang waited before disconnect");
    const earlyLogResponse = await fetch("http://127.0.0.1:" + port +
      "/api/logs?type=smtp.simulation.applied");
    assert.equal(earlyLogResponse.status,200);
    const earlyLogs = await earlyLogResponse.json() as {events:Array<{data?:Record<string,unknown>}>};
    for (const id of [connectReject,ehloReject,connectDrop,connectHang]) {
      assert.ok(earlyLogs.events.some(e => e.data?.ruleId === id), "Missing simulation log " + id);
    }
    assert.equal((await api("POST","/admin/smtp/reply-rules", {
      phase:"CONNECT",action:"reply",code:421,remaining:1,selectors:{credentialsId:"not-allowed"},
    })).status,400);

    // SMTP AUTH must use a real inbox. Unlike the transport-only E2E suite,
    // this child server inherits NODE_V8_COVERAGE so the auth branches in
    // server.ts count towards the SonarCloud quality gate.
    const smtpAuth = async (username: string, password: string) => {
      const client = nodemailer.createTransport({
        host: "127.0.0.1",
        port: smtpPort,
        secure: false,
        ignoreTLS: true,
        auth: { user: username, pass: password },
        authMethod: "PLAIN",
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        await client.verify();
      } finally {
        client.close();
      }
    };
    // An unknown user must get a permanent SMTP authentication rejection.
    await assert.rejects(smtpAuth("unregistered@example.test", "secret"), (error: unknown) =>
      typeof error === "object" && error !== null &&
      "responseCode" in error && error.responseCode === 535);
    assert.equal((await api("POST", "/admin/test/sessions", { username: "", password: "secret" })).status, 400);

    const credentials = { username: "admin-test@example.test", password: "a-test-secret" };
    const unknown = await api("POST", "/admin/test/sessions", credentials);
    assert.equal(unknown.status, 404, "unknown username must not allocate logical sessions");
    assert.equal(unknown.data.errorCode, "TEST_INBOX_NOT_FOUND");
    const inboxResponse = await fetch("http://127.0.0.1:" + port + "/api/mailboxes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: credentials.username, ttlSeconds: 180 }),
    });
    assert.equal(inboxResponse.status, 201);
    const inbox = await inboxResponse.json() as { id: string };
    await smtpAuth(credentials.username, credentials.password);
    // Resolve credentials and IP before preparing an AUTH failure; no password in response.
    const resolved = await api("POST", "/admin/smtp/resolve", {
      credentials, origin: { ip: "127.0.0.1" },
    });
    assert.equal(resolved.status, 200);
    const credentialId = resolved.data.credentials.id as string;
    assert.ok(credentialId);
    assert.ok(resolved.data.credentials.origins[0].connections.length >= 1);
    assert.ok(!JSON.stringify(resolved.data).includes(credentials.password));
    assert.equal((await api("POST", "/admin/smtp/resolve", { credentials }, false)).status, 403);
    const globalAuth = await api("POST", "/admin/smtp/reply-rules", {
      phase: "AUTH", action: "reply", code: 535, remaining: 1, priority: 100,
    });
    const specificAuth = await api("POST", "/admin/smtp/reply-rules", {
      phase: "AUTH", action: "reply", code: 454, remaining: 1, priority: 1,
      selectors: { origin: { ip: "127.0.0.1" }, credentialsId: credentialId },
    });
    assert.equal(globalAuth.status, 201);
    assert.equal(globalAuth.data.scope, "GLOBAL");
    assert.equal(specificAuth.status, 201);
    assert.equal(specificAuth.data.scope, "SPECIFIC");
    await assert.rejects(smtpAuth(credentials.username, credentials.password),
      (error: unknown) => typeof error === "object" && error !== null &&
        "responseCode" in error && error.responseCode === 454);
    await assert.rejects(smtpAuth(credentials.username, credentials.password),
      (error: unknown) => typeof error === "object" && error !== null &&
        "responseCode" in error && error.responseCode === 535);
    await smtpAuth(credentials.username, credentials.password);
    const authRules = await api("GET", "/admin/smtp/reply-rules");
    assert.equal(authRules.data.find((r: {id:string}) => r.id === globalAuth.data.id)?.remaining, 0);
    assert.equal(authRules.data.find((r: {id:string}) => r.id === specificAuth.data.id)?.remaining, 0);
    const authLogs = await fetch("http://127.0.0.1:" + port +
      "/api/logs?type=smtp.simulation.applied");
    assert.equal(authLogs.status, 200);
    const authLogData = await authLogs.json() as {events: Array<{data?: Record<string,unknown>}>};
    assert.ok(authLogData.events.some(e => e.data?.ruleId === specificAuth.data.id &&
      e.data?.scope === "SPECIFIC" && e.data?.credentialsId === credentialId));
    assert.ok(!JSON.stringify(authLogData).includes(credentials.password));
    const smtpSessions = await api("GET", "/admin/smtp/sessions", undefined, false);
    assert.equal(smtpSessions.status, 200);
    assert.ok(!JSON.stringify(smtpSessions.data).includes(credentials.password));
    assert.ok(!JSON.stringify(smtpSessions.data).includes("digest"));
    assert.ok(smtpSessions.data.some((session: { authenticated: boolean; authUser?: string }) =>
      session.authenticated && session.authUser === credentials.username));
    assert.equal((await api("GET","/admin/footprint")).data.resources.emailInboxes,1);
    const created = await api("POST", "/admin/test/sessions", credentials);
    assert.equal(created.status, 201);
    const id = created.data.sessionId as string;
    assert.match(id, /^[a-f0-9-]{36}$/i);
    const fetched = await api("GET", "/admin/test/sessions/" + id);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.data.inbox, credentials.username);

    const good = await api("POST", "/admin/test/sessions/" + id + "/verify", credentials);
    assert.deepEqual(good.data, { matches: true });
    const bad = await api("POST", "/admin/test/sessions/" + id + "/verify",
      { ...credentials, password: "incorrect" });
    assert.deepEqual(bad.data, { matches: false });

    const endpoint = "/admin/test/sessions/" + id + "/simulations";
    const rule = await api("POST", endpoint, {
      protocol: "POP3", command: "RETR", code: 451, message: "Expected test failure", remaining: 2,
    });
    assert.equal(rule.status, 201);
    assert.equal(rule.data.sessionId, id);
    const listed = await api("GET", endpoint);
    assert.equal(listed.status, 200);
    assert.ok(listed.data.some((entry: { id: string }) => entry.id === rule.data.id));
    assert.equal((await api("DELETE", endpoint + "/" + rule.data.id)).status, 204);
    assert.deepEqual((await api("GET", endpoint)).data, []);
    assert.equal((await api("GET", "/admin/test/sessions/" + randomUUID())).status, 404);
    const retainedRule = await api("POST", endpoint, {
      protocol: "SMTP", command: "DATA", code: 451, remaining: 1,
    });
    assert.equal(retainedRule.status, 201);
    const deleted = await fetch("http://127.0.0.1:" + port + "/api/mailboxes/" + inbox.id, { method: "DELETE" });
    assert.equal(deleted.status, 204);
    assert.equal((await api("GET", "/admin/test/sessions/" + id)).status, 404);
    assert.deepEqual((await api("GET", endpoint)).data, [], "delete removes session simulation rules");
    assert.equal((await api("POST", "/admin/test/sessions", credentials)).status, 404);
    assert.equal((await api("GET","/admin/footprint")).data.resources.emailInboxes,0);
    // Deleting the inbox revokes access for subsequent SMTP connections.
    await assert.rejects(smtpAuth(credentials.username, credentials.password), (error: unknown) =>
      typeof error === "object" && error !== null &&
      "responseCode" in error && error.responseCode === 535);

    // An expired inbox must not allow a new identity even before the next cleanup tick.
    const ttlInboxResponse = await fetch("http://127.0.0.1:" + port + "/api/mailboxes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "short-lived@example.test", ttlSeconds: 1 }),
    });
    assert.equal(ttlInboxResponse.status, 201);
    const ttlInbox = await ttlInboxResponse.json() as { id: string };
    const ttlCredentials = { username: "short-lived@example.test", password: "short-password" };
    const ttlSession = await api("POST", "/admin/test/sessions", ttlCredentials);
    assert.equal(ttlSession.status, 201);
    await delay(1200);
    const expiredAuth = await api("POST", "/admin/test/sessions", ttlCredentials);
    assert.equal(expiredAuth.status, 404);
    assert.equal(expiredAuth.data.errorCode, "TEST_INBOX_NOT_FOUND");
    let expiredLookup = await api("GET", "/admin/test/sessions/" + ttlSession.data.sessionId);
    for (let retry = 0; retry < 10 && expiredLookup.status !== 404; retry++) {
      await delay(200);
      expiredLookup = await api("GET", "/admin/test/sessions/" + ttlSession.data.sessionId);
    }
    assert.equal(expiredLookup.status, 404, "TTL cleanup must revoke the existing GUID");
    assert.equal((await fetch("http://127.0.0.1:" + port + "/api/mailboxes/" + ttlInbox.id)).status, 404);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit").catch(() => {}), delay(2500)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(temp, { recursive: true, force: true });
  }
});
