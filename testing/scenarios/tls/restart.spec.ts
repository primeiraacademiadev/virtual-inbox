import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { connect } from "node:tls";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { profile, requireManaged } from "../../framework/environment";

test("new process recovers the same persisted automatic TLS identity", async () => {
  requireManaged();
  const directory = process.env.TLS_CERTIFICATES_DIR;
  const caPath = process.env.VI_TEST_CA_FILE;
  if (!directory || !caPath) throw Error("Managed certificate directory and CA are required");
  const secondaryPort = Number(process.env.VI_HTTPS_PORT || 13443) + 100;
  const fingerprint = async (port: number) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(
        {
          host: profile.host,
          port,
          servername: "localhost",
          ca: readFileSync(caPath),
          rejectUnauthorized: true,
        },
        () => {
          const value = socket.getPeerCertificate().fingerprint256;
          socket.end();
          resolve(value);
        },
      );
      socket.once("error", reject);
    });
  const original = await fingerprint(Number(process.env.VI_HTTPS_PORT || 13443));
  const env = {
    ...process.env,
    PORT: String(secondaryPort + 1),
    HTTPS_PORT: String(secondaryPort),
    SMTP_PORT: String(secondaryPort + 2),
    SMTPS_PORT: String(secondaryPort + 3),
    DEMO_PORT: String(secondaryPort + 4),
    DEMO_HTTPS_PORT: String(secondaryPort + 5),
    TLS_CERTIFICATES_DIR: directory,
  };
  const child = spawn(process.execPath, [resolve(process.cwd(), "../dist/src/server.js")], {
    cwd: resolve(process.cwd(), ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  try {
    let recovered: string | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) throw Error("Secondary server exited: " + output);
      try {
        recovered = await fingerprint(secondaryPort);
        break;
      } catch {
        await delay(200);
      }
    }
    expect(recovered, output).toBe(original);
  } finally {
    child.kill();
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(2500),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
