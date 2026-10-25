import { test, expect } from "@playwright/test";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ApiClient } from "../../framework/api-client";
import { profile, requireManaged } from "../../framework/environment";

for (const { mode, authMethod } of [
  { mode: "plain", authMethod: "PLAIN" },
  { mode: "plain", authMethod: "LOGIN" },
  { mode: "starttls", authMethod: "PLAIN" },
  { mode: "smtps", authMethod: "LOGIN" },
] as const) {
  test(`Communication-compatible AUTH ${authMethod} on ${mode} preserves headers/envelope and HTML`, async () => {
    requireManaged();
    const api = new ApiClient();
    const tls = mode === "plain" ? undefined : {
      ca: readFileSync(process.env.VI_TEST_CA_FILE!),
      servername: process.env.VI_TLS_SERVERNAME || "localhost",
      rejectUnauthorized: true,
    };
    const client = nodemailer.createTransport({
      host: profile.host,
      port: mode === "smtps" ? profile.smtp.smtpsPort : profile.smtp.plainPort,
      secure: mode === "smtps",
      ignoreTLS: mode === "plain",
      requireTLS: mode === "starttls",
      auth: { user: "communication-gateway", pass: "dummy-password-never-store" },
      authMethod,
      tls,
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 12000,
    });
    try {
      const to = await api.create("email");
      const cc = await api.create("email");
      const bcc = await api.create("email");
      const marker = "communication-" + randomUUID();
      const waiting = api.fetch("/mailboxes/" + to.id + "/wait-for-message", {
        method: "POST",
        body: JSON.stringify({
          timeoutMs: 10000,
          match: {
            bodyContains: marker,
            header: { name: "X-Message-ID", valueContains: marker },
          },
        }),
      });
      const receipt = await client.sendMail({
        envelope: {
          from: "bounce@example.test",
          to: [to.address, cc.address, bcc.address],
        },
        from: { name: "Sender Display Name", address: "sender@example.test" },
        replyTo: "reply@example.test",
        to: to.address,
        cc: cc.address,
        bcc: bcc.address,
        subject: "Only HTML",
        html: "<html><body><strong>" + marker + "</strong></body></html>",
        headers: { "X-Message-ID": marker },
      });
      expect(receipt.accepted).toEqual(expect.arrayContaining([to.address, cc.address, bcc.address]));
      const response = await waiting;
      expect(response.status).toBe(200);
      const message = await response.json();
      expect(message.body).toBe("");
      expect(message.html).toContain(marker);
      expect(message.authUser).toBe("communication-gateway");
      expect(message.envelope).toEqual({
        mailFrom: "bounce@example.test",
        rcptTo: [to.address, cc.address, bcc.address],
      });
      expect(message.headers).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "x-message-id", value: marker }),
        expect.objectContaining({ key: "reply-to", value: expect.stringContaining("reply@example.test") }),
        expect.objectContaining({ key: "from", value: expect.stringContaining("Sender Display Name") }),
        expect.objectContaining({ key: "cc", value: expect.stringContaining(cc.address) }),
      ]));
      // Bcc is an SMTP envelope recipient even when no Bcc MIME header exists.
      expect(message.headers.some((header: { key: string }) => header.key === "bcc")).toBe(false);
      expect(JSON.stringify(message)).not.toContain("dummy-password-never-store");
      const htmlResponse = await api.fetch("/mailboxes/" + to.id + "/wait-for-message", {
        method: "POST",
        body: JSON.stringify({ timeoutMs: 1000, match: { htmlContains: marker } }),
      });
      expect(htmlResponse.status).toBe(200);
      expect((await htmlResponse.json()).id).toBe(message.id);
    } finally {
      client.close();
      await api.dispose();
    }
  });
}

test("oversized SMTP DATA is rejected permanently with 552 (not transient 450)", async () => {
  requireManaged();
  const api = new ApiClient();
  const client = nodemailer.createTransport({
    host: profile.host,
    port: profile.smtp.plainPort,
    secure: false,
    ignoreTLS: true,
    disableFileAccess: true,
    disableUrlAccess: true,
    socketTimeout: 15000,
  });
  try {
    const inbox = await api.create("email");
    await expect(client.sendMail({
      from: "sender@example.test",
      to: inbox.address,
      subject: "oversize",
      text: "X".repeat(70 * 1024),
    })).rejects.toMatchObject({ responseCode: 552 });
    expect(await api.messages(inbox)).toHaveLength(0);
  } finally {
    client.close();
    await api.dispose();
  }
});
