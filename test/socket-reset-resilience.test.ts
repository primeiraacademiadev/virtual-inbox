import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, connect } from "node:net";
import { connect as connectTls } from "node:tls";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
    socket.on("error", () => { /* A local RST may produce an error on some systems. */ });
    socket.once("connect", () => socket.resetAndDestroy());
    socket.once("close", () => done());
    socket.setTimeout(3000, () => { socket.destroy(); reject(Error("Reset did not finish")); });
  });
}

test("SMTP, SMTPS and POP3 survive repeated raw TCP resets and remain usable", { timeout: 60_000 }, async () => {
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
  const readyUrl = "http://127.0.0.1:" + httpPort + "/api/health";
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error("Server died during startup: " + output);
      try { if ((await fetch(readyUrl)).ok) { ready = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(ready, "Server did not become healthy: " + output);
    for (const port of [smtpPort, smtpsPort, pop3Port]) {
      for (let i = 0; i < 6; i++) {
        await abruptReset(port);
        assert.equal(child.exitCode, null, "Server terminated after reset on " + port + ": " + output);
      }
      assert.equal((await fetch(readyUrl)).status, 200);
    }
    const smtp = connect(smtpPort, "127.0.0.1");
    try {
      const [data] = await once(smtp, "data");
      assert.match(String(data), /^220 /);
    } finally { smtp.destroy(); }
    const pop3 = connect(pop3Port, "127.0.0.1");
    try {
      const [data] = await once(pop3, "data");
      assert.match(String(data), /^\\+OK /);
    } finally { pop3.destroy(); }
    const smtps = connectTls({
      port: smtpsPort, host: "127.0.0.1", servername: "localhost",
      ca: readFileSync(join(temp, "certs", "ca.pem")),
    });
    try {
      await once(smtps, "secureConnect");
      const [data] = await once(smtps, "data");
      assert.match(String(data), /^220 /);
    } finally { smtps.destroy(); }
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit").catch(() => {}), sleep(2000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    rmSync(temp, { recursive: true, force: true });
  }
});
