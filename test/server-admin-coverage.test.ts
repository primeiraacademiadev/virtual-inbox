import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

// Exercise the actual HTTPS administration routes with TLS verification. The
// child inherits NODE_V8_COVERAGE from c8, so server.ts is counted in Sonar.
async function reservePorts(): Promise<[number, number]> {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(servers.map(async server => {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
    }));
    return servers.map(server => {
      const address = server.address();
      if (!address || typeof address === "string") throw Error("TCP address unavailable");
      return address.port;
    }) as [number, number];
  } finally {
    await Promise.all(servers.map(server => new Promise<void>(done => server.close(() => done()))));
  }
}

test("real HTTPS admin API isolates sessions, verifies credentials and manages protocol simulations", { timeout: 30_000 }, async () => {
  const root = resolve(import.meta.dirname, "..");
  const temp = mkdtempSync(join(tmpdir(), "vi-admin-coverage-"));
  const [port, httpsPort] = await reservePorts();
  const token = "test-only-" + randomUUID();
  const certs = join(temp, "certificates");
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HTTPS_PORT: String(httpsPort),
      SMTP_PORT: "0",
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

    const forbidden = await fetch("http://127.0.0.1:" + port + "/api/admin/test/metrics");
    assert.equal(forbidden.status, 403, "admin routes must require authenticated HTTPS");
    assert.equal((await api("GET", "/admin/test/metrics", undefined, false)).status, 403);
    const metrics = await api("GET", "/admin/test/metrics");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.data.POP3.connectionsActive, 0);

    const credentials = { username: "admin-test@example.test", password: "a-test-secret" };
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
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit").catch(() => {}), delay(2500)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(temp, { recursive: true, force: true });
  }
});
