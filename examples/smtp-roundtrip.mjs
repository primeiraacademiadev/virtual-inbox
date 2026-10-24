import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

const mode = process.argv[2] || "plain";
if (!["plain", "starttls", "smtps"].includes(mode)) {
  throw new Error("Usage: node examples/smtp-roundtrip.mjs plain|starttls|smtps [ca-file]");
}
const baseUrl = process.env.VI_BASE_URL || "http://127.0.0.1:3000";
const apiUrl = new URL("/api/", baseUrl);
const controller = new AbortController();
const tls = mode === "plain" ? undefined : {
  ca: readFileSync(process.argv[3] || process.env.VI_TEST_CA_FILE || "data/certificates/ca.pem"),
  rejectUnauthorized: true,
  servername: process.env.VI_TLS_SERVERNAME || "localhost",
};
const client = nodemailer.createTransport({
  host: process.env.VI_SMTP_HOST || "127.0.0.1",
  port: Number(mode === "smtps" ? process.env.VI_SMTPS_PORT || 2465 : process.env.VI_SMTP_PORT || 2525),
  secure: mode === "smtps", ignoreTLS: mode === "plain", requireTLS: mode === "starttls",
  tls, disableFileAccess: true, disableUrlAccess: true,
  connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 12000,
});
async function api(path, method = "GET", data, signal) {
  const response = await fetch(new URL(path, apiUrl), {
    method, headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: signal || AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response;
}
let inbox;
try {
  inbox = await (await api("mailboxes", "POST", { ttlSeconds: 180 })).json();
  const subject = "roundtrip-" + randomUUID();
  const bytes = Buffer.from([0, 255, 1, 2, 3, 114, 110, 42]);
  const waiting = api(`mailboxes/${inbox.id}/wait-for-message`, "POST", {
    timeoutMs: 10000, match: { subjectContains: subject },
  }, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
  const [response, receipt] = await Promise.all([
    waiting,
    client.sendMail({ from: "example@sandbox.test", to: inbox.address, subject,
      text: "Virtual Inbox round-trip example", attachments: [
        { filename: "report.bin", content: bytes, contentType: "application/octet-stream" },
      ] }),
  ]);
  assert.ok(receipt.accepted.includes(inbox.address));
  assert.equal(response.status, 200, "No matching message before timeout");
  const message = await response.json();
  assert.equal(message.subject, subject);
  const attachment = message.attachments[0];
  assert.equal(attachment.filename, "report.bin");
  const downloaded = Buffer.from(await (await api(
    `mailboxes/${inbox.id}/messages/${message.id}/attachments/${attachment.id}`,
  )).arrayBuffer());
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(downloaded), digest(bytes));
  console.log(`PASS: ${mode} captured message ${message.id}; attachment SHA-256 matches.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  controller.abort();
  client.close();
  if (inbox) {
    try { await api(`mailboxes/${inbox.id}`, "DELETE"); }
    catch (error) { console.error("Cleanup failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
}
