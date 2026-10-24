import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { ApiClient } from "../../framework/api-client";
import { SmtpDriver, type Transport } from "../../drivers/smtp-driver";
for (const mode of ["plain", "starttls", "smtps"] as Transport[]) {
  test(`SMTP ${mode} delivers MIME and exact binary attachments`, async () => {
    const api = new ApiClient(),
      smtp = new SmtpDriver();
    try {
      const inbox = await api.create("email");
      const subject = "Harness-" + randomUUID();
      const binary = Buffer.from([0, 255, 1, 2, 3, 114, 110, 42, 0, 250]);
      const waiting = api.waitFor(inbox, subject);
      const receipt = await smtp.send(mode, {
        to: inbox.address,
        subject,
        text: "E2E binary test",
        attachments: [{ filename: "report.pdf", content: binary, contentType: "application/pdf" }],
      });
      expect(receipt.accepted).toContain(inbox.address);
      const message = await waiting;
      expect(message).not.toBeNull();
      expect(message?.subject).toBe(subject);
      expect(message?.body).toContain("E2E binary test");
      expect(message?.attachments?.[0]?.filename).toBe("report.pdf");
      const attachment = await api.fetch(
        "/mailboxes/" +
          inbox.id +
          "/messages/" +
          message!.id +
          "/attachments/" +
          message!.attachments![0].id,
      );
      const downloaded = Buffer.from(await attachment.arrayBuffer());
      expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
        createHash("sha256").update(binary).digest("hex"),
      );
    } finally {
      await api.dispose();
    }
  });
}
