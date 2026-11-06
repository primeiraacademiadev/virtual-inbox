import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, connect, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Long enough for a native crash triggered by the last reset to reach the parent as
// 'exit'. child.exitCode alone is read before that event and reports a dying process
// as alive (the Windows CI failure "SMTP greeting after resets failed; server exit=null").
const EXIT_SETTLE_MS = 500;

async function freePorts(count: number): Promise<number[]> {
  const listeners = Array.from({ length: count }, () => createServer());
  for (const listener of listeners) {
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
  }
  const ports = listeners.map(listener => {
    const address = listener.address();
    if (!address || typeof address === "string") throw Error("No bound TCP port");
    return address.port;
  });
  await Promise.all(listeners.map(listener =>
    new Promise<void>(done => listener.close(() => done()))));
  return ports;
}

async function abruptReset(port: number): Promise<void> {
  await new Promise<void>((done, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    // A local TCP RST is expected to surface ECONNRESET on Windows. The test
    // verifies the child server survives it, not that this client reads EOF.
    socket.on("error", error => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
    socket.once("connect", () => socket.resetAndDestroy());
    socket.once("close", () => done());
    socket.setTimeout(3000, () => { socket.destroy(); reject(Error("Reset did not finish")); });
  });
}

async function orderlyClose(port: number): Promise<void> {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => { /* Peer may discard bytes after FIN. */ });
  const closed = once(socket, "close");
  socket.once("connect", () => socket.end());
  await closed;
}

type Server = {
  ports: { smtp: number; smtps: number; pop3: number };
  ca: () => Buffer;
  /** Fails, with the settled exit code and output, if the process ended. */
  assertAlive(stage: string): Promise<void>;
  /** Diagnostic for a failed client operation: exit code after the settle window. */
  describe(stage: string): Promise<string>;
};

async function withServer(run: (server: Server) => Promise<void>): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), "vi-reset-" + randomUUID().slice(0, 8)));
  const [httpPort, httpsPort, smtpPort, smtpsPort, pop3Port, demoPort, demoHttpsPort] = await freePorts(7);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env, TLS_MODE: "auto", SMTP_AUTH_POLICY: "OPEN",
      TLS_SERVER_NAMES: "localhost,127.0.0.1",
      TLS_CERTIFICATES_DIR: join(temp, "certs"),
      TLS_MANAGED_IDENTITY_FILE: join(temp, "managed.json"),
      TLS_MANAGED_NAMES_FILE: join(temp, "names.json"),
      NETWORK_SETTINGS_FILE: join(temp, "network.json"),
      HOST: "127.0.0.1", SMTP_HOST: "127.0.0.1", PUBLIC_HOST: "localhost",
      PORT: String(httpPort), HTTPS_PORT: String(httpsPort),
      SMTP_PORT: String(smtpPort), SMTPS_PORT: String(smtpsPort),
      POP3_PORT: String(pop3Port), DEMO_PORT: String(demoPort),
      DEMO_HTTPS_PORT: String(demoHttpsPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  const exited = once(child, "exit").catch(() => {});
  const settledExit = async () => {
    await Promise.race([exited, sleep(EXIT_SETTLE_MS)]);
    const code = child.exitCode;
    return code === null ? (child.signalCode ? "signal " + child.signalCode : "running")
      : code + " (0x" + (code >>> 0).toString(16).toUpperCase() + ")";
  };
  const healthUrl = "http://127.0.0.1:" + httpPort + "/api/health";
  const server: Server = {
    ports: { smtp: smtpPort, smtps: smtpsPort, pop3: pop3Port },
    ca: () => readFileSync(join(temp, "certs", "ca.pem")),
    async describe(stage) {
      return stage + "; server exit=" + await settledExit() + "; output=" + output;
    },
    async assertAlive(stage) {
      const state = await settledExit();
      assert.equal(state, "running", "Server terminated after " + stage + ": exit=" + state + "; output=" + output);
      const response = await fetch(healthUrl).catch(async cause => {
        throw new Error("Health failed after " + stage + "; exit=" + await settledExit() + "; output=" + output, { cause });
      });
      assert.equal(response.status, 200, "Unexpected health status after " + stage);
    },
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error("Server died during startup: " + output);
      try { if ((await fetch(healthUrl)).ok) { ready = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(ready, "Server did not become healthy: " + output);
    await run(server);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, sleep(2000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(temp, { recursive: true, force: true });
  }
}

async function firstLine(socket: Socket, server: Server, stage: string): Promise<string> {
  try {
    const [data] = await once(socket, "data");
    return String(data);
  } catch (cause) {
    throw new Error(await server.describe(stage + " failed"), { cause });
  } finally { socket.destroy(); }
}

async function smtpGreeting(server: Server, stage: string) {
  assert.match(await firstLine(connect(server.ports.smtp, "127.0.0.1"), server, "SMTP greeting " + stage), /^220 /);
}
async function pop3Greeting(server: Server, stage: string) {
  assert.match(await firstLine(connect(server.ports.pop3, "127.0.0.1"), server, "POP3 greeting " + stage), /^\+OK /);
}
async function smtpsGreeting(server: Server, stage: string) {
  const socket = connectTls({ port: server.ports.smtps, host: "127.0.0.1", servername: "localhost", ca: server.ca() });
  await once(socket, "secureConnect").catch(async cause => {
    socket.destroy();
    throw new Error(await server.describe("SMTPS handshake " + stage + " failed"), { cause });
  });
  assert.match(await firstLine(socket, server, "SMTPS greeting " + stage), /^220 /);
}

async function resets(server: Server, name: string, port: number, count = 6) {
  for (let i = 0; i < count; i++) {
    try { await abruptReset(port); }
    catch (error) { throw new Error(name + " reset attempt " + (i + 1) + " failed", { cause: error }); }
  }
  await server.assertAlive(count + " resets on " + name);
}

test("POP3 survives repeated raw TCP resets and still greets", { timeout: 60_000 }, () => withServer(async server => {
  await resets(server, "POP3", server.ports.pop3);
  await pop3Greeting(server, "after POP3 resets");
}));

test("SMTP survives repeated raw TCP resets and still greets", { timeout: 60_000 }, () => withServer(async server => {
  await resets(server, "SMTP", server.ports.smtp);
  await smtpGreeting(server, "after SMTP resets");
}));

// Resets before the deferred implicit TLS upgrade used to take the whole process
// down natively; plain SMTP and POP3 then failed with ECONNRESET/ECONNREFUSED.
test("SMTPS survives repeated raw TCP resets; SMTP, POP3 and SMTPS stay usable", { timeout: 60_000 }, () => withServer(async server => {
  await resets(server, "SMTPS", server.ports.smtps);
  await smtpGreeting(server, "after SMTPS resets");
  await pop3Greeting(server, "after SMTPS resets");
  await smtpsGreeting(server, "after SMTPS resets");
}));

test("SMTPS survives an orderly close before the TLS handshake", { timeout: 60_000 }, () => withServer(async server => {
  for (let i = 0; i < 6; i++) await orderlyClose(server.ports.smtps);
  await server.assertAlive("6 early FINs on SMTPS");
  await smtpsGreeting(server, "after early FINs");
}));

test("all listeners survive resets in sequence and remain usable", { timeout: 60_000 }, () => withServer(async server => {
  await resets(server, "POP3", server.ports.pop3);
  await resets(server, "SMTP", server.ports.smtp);
  await resets(server, "SMTPS", server.ports.smtps);
  await smtpGreeting(server, "after all resets");
  await pop3Greeting(server, "after all resets");
  await smtpsGreeting(server, "after all resets");
  await server.assertAlive("all greetings");
}));
