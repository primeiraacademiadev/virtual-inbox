// Diagnostic only: does a bare smtp-server implicit TLS listener (no Virtual Inbox code)
// survive TCP resets before the handshake, and is plain SMTP in the same process still
// usable afterwards? Run with --guarded to apply the Virtual Inbox adapter.
// usage: node --import tsx testing/scripts/smtps-reset-control.mjs [--guarded]
import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

const guarded = process.argv.includes("--guarded");
if (process.argv.includes("--child")) {
  const { SMTPServer } = await import("smtp-server");
  const [smtpPort, smtpsPort] = process.argv.slice(-2).map(Number);
  const plain = new SMTPServer({ logger: false, authOptional: true });
  const implicit = new SMTPServer({ secure: true, logger: false, authOptional: true });
  for (const server of [plain, implicit]) {
    server.server.on("connection", socket => socket.on("error", () => {}));
    server.on("error", () => {});
  }
  if (guarded) (await import("../../src/network/socket-errors.ts")).refuseUpgradeOfClosedSockets(implicit);
  plain.listen(smtpPort, "127.0.0.1");
  implicit.listen(smtpsPort, "127.0.0.1", () => console.log("READY"));
} else {
  const ports = [];
  for (let i = 0; i < 2; i++) {
    const reserve = createServer().listen(0, "127.0.0.1");
    await once(reserve, "listening");
    ports.push(reserve.address().port);
    await new Promise(done => reserve.close(done));
  }
  const child = spawn(process.execPath, ["--import", "tsx", import.meta.filename, "--child",
    ...(guarded ? ["--guarded"] : []), ...ports.map(String)], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", x => output += String(x));
  child.stderr.on("data", x => output += String(x));
  try {
    for (let i = 0; i < 200 && !output.includes("READY"); i++) await sleep(25);
    for (let i = 0; i < 6; i++) {
      const socket = connect(ports[1], "127.0.0.1");
      socket.on("error", () => {});
      const closed = once(socket, "close");
      socket.once("connect", () => socket.resetAndDestroy());
      await closed;
    }
    const greeting = await new Promise(done => {
      const socket = connect(ports[0], "127.0.0.1");
      socket.once("data", data => { socket.destroy(); done(String(data).slice(0, 4).trim()); });
      socket.once("error", error => done(error.code));
    });
    await Promise.race([once(child, "exit"), sleep(500)]);
    const exit = child.exitCode === null ? null : "0x" + (child.exitCode >>> 0).toString(16).toUpperCase();
    console.log("SMTPS_RESET_CONTROL", JSON.stringify({ node: process.version, platform: process.platform, guarded, plainSmtpGreeting: greeting, exit }));
    if (exit !== null) process.exitCode = 1;
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
