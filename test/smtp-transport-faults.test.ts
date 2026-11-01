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
import { setTimeout as sleep } from "node:timers/promises";
import nodemailer from "nodemailer";

async function ports(): Promise<number[]> {
  const servers = [createServer(), createServer(), createServer()];
  try {
    for (const server of servers) { server.listen(0, "127.0.0.1"); await once(server, "listening"); }
    return servers.map((server) => {
      const a = server.address();
      if (!a || typeof a === "string") throw Error("No bound port");
      return a.port;
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((done) => server.close(() => done()))));
  }
}

test("transport simulation: MAIL delay, post-DATA drop and persistence without ACK", { timeout: 40_000 }, async () => {
  const root = resolve(import.meta.dirname, "..");
  const temp = mkdtempSync(join(tmpdir(), "vi-transport-"));
  const [httpPort, httpsPort, smtpPort] = await ports();
  const token = "test-" + randomUUID();
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1", SMTP_HOST: "127.0.0.1", PUBLIC_HOST: "localhost",
      PORT: String(httpPort), HTTPS_PORT: String(httpsPort), SMTP_PORT: String(smtpPort),
      POP3_PORT: "0", SMTPS_PORT: "0", DEMO_PORT: "0", DEMO_HTTPS_PORT: "0",
      TLS_MODE: "auto", TLS_SERVER_NAMES: "localhost,127.0.0.1",
      TLS_CERTIFICATES_DIR: join(temp, "certs"),
      NETWORK_SETTINGS_FILE: join(temp, "network.json"),
      TLS_MANAGED_IDENTITY_FILE: join(temp, "identity.json"),
      ADMIN_TOKEN: token, SMTP_AUTH_POLICY: "OPEN", SMTP_SIMULATION_MAX_DURATION_MS: "300",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (x) => { output += x.toString(); });
  child.stderr.on("data", (x) => { output += x.toString(); });
  try {
    let healthy = false;
    for (let retry = 0; retry < 100; retry++) {
      if (child.exitCode !== null) throw Error("Server exited: " + output);
      try { if ((await fetch("http://127.0.0.1:" + httpPort + "/api/health")).ok) { healthy = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(healthy, "Server startup failure: " + output);
    const ca = readFileSync(join(temp, "certs", "ca.pem"));
    const admin = (payload: unknown) => new Promise<any>((resolveResult, reject) => {
      const req = httpsRequest({
        hostname: "127.0.0.1", servername: "localhost", port: httpsPort,
        ca, method: "POST", path: "/api/admin/smtp/reply-rules",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      }, (res) => {
        const data: Buffer[] = [];
        res.on("data", (v) => data.push(Buffer.from(v)));
        res.on("end", () => {
          const obj = JSON.parse(Buffer.concat(data).toString());
          if (res.statusCode !== 201) reject(Error("Rule rejected: " + JSON.stringify(obj)));
          else resolveResult(obj);
        });
      });
      req.on("error", reject);
      req.end(JSON.stringify(payload));
    });
    const sender = "transport-test@example.test";
    const inboxResponse = await fetch("http://127.0.0.1:" + httpPort + "/api/mailboxes", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({address:"receiver@example.test"}),
    });
    assert.equal(inboxResponse.status,201);
    const inbox = await inboxResponse.json() as {id:string};
    const smtp = () => nodemailer.createTransport({
      host:"127.0.0.1",port:smtpPort,secure:false,ignoreTLS:true,
      connectionTimeout:3000,greetingTimeout:3000,socketTimeout:1500,
      disableFileAccess:true,disableUrlAccess:true,
    });
    const send = (subject:string) => {
      const client=smtp();
      return client.sendMail({from:sender,to:"receiver@example.test",subject,text:"delivery marker "+subject})
        .finally(() => client.close());
    };
    await admin({phase:"MAIL",action:"delay",durationMs:75,remaining:1,selectors:{sender}});
    const start=Date.now();
    await send("delay");
    assert.ok(Date.now()-start>=50);
    await admin({phase:"AFTER_DATA",action:"drop",remaining:1,selectors:{sender}});
    await assert.rejects(send("post-drop"));
    const response=await fetch("http://127.0.0.1:"+httpPort+"/api/mailboxes/"+inbox.id+"/messages");
    const messages=await response.json() as Array<{subject:string}>;
    assert.ok(messages.some((m)=>m.subject==="delay"));
    assert.ok(messages.some((m)=>m.subject==="post-drop"),"AFTER_DATA stores message before cutting ACK");
    await admin({phase:"DATA",action:"hang",durationMs:90,remaining:1,selectors:{sender}});
    await assert.rejects(send("pre-hang"));
    const again=await fetch("http://127.0.0.1:"+httpPort+"/api/mailboxes/"+inbox.id+"/messages");
    const later=await again.json() as Array<{subject:string}>;
    assert.ok(!later.some((m)=>m.subject==="pre-hang"),"DATA hang must not persist");
  } finally {
    if (child.exitCode===null) {
      child.kill("SIGTERM");
      await Promise.race([once(child,"exit").catch(()=>{}),sleep(2000)]);
      if (child.exitCode===null) child.kill("SIGKILL");
    }
    rmSync(temp,{recursive:true,force:true});
  }
});
