import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { baseUrl, requireManaged } from "../../framework/environment";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");

test("runtime exposes separate management and demo OpenAPI contracts", async ({ request }) => {
  const response = await request.get(baseUrl + "/api/openapi.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const main = await response.json();
  expect(main.openapi).toBe("3.1.0");
  expect(main.paths["/health"].get.operationId).toBe("health");
  expect(main.paths["/mailboxes/{inboxId}/wait-for-message"].post.responses["204"]).toBeTruthy();
  expect(main.paths["/sms/messages"]).toBeUndefined();
  expect(main.paths["/admin/tls"].put.security).toEqual([{ adminToken: [] }]);
  const demo = await (await request.get(baseUrl + "/api/openapi-demo.json")).json();
  expect(demo.paths["/sms/messages"].post.operationId).toBe("sendSms");
  expect(demo.paths["/mailboxes/{inboxId}/demo-send"].post).toBeTruthy();
  expect((await request.post(baseUrl + "/api/health")).status()).toBe(404);
});

test("all console locales publish generated API guides and OpenAPI downloads", async ({ request }) => {
  for (const locale of ["pt-PT", "en", "fr"]) {
    const response = await request.get(baseUrl + `/wiki/${locale}/api.md`);
    expect(response.status()).toBe(200);
    const markdown = await response.text();
    expect(markdown).toContain("/api/openapi.json");
    expect(markdown).toContain("## GET /health");
    expect(markdown).toContain("## POST /mailboxes/{inboxId}/wait-for-message");
    expect(markdown).not.toContain("## POST /sms/messages");
    expect(markdown).toContain("session.initialized");
  }
});

for (const mode of ["plain", "starttls", "smtps"]) {
  test(`documented SMTP example completes a verified ${mode} round trip`, async () => {
    requireManaged();
    const args = [resolve(root, "examples/smtp-roundtrip.mjs"), mode];
    if (mode !== "plain") {
      if (!process.env.VI_TEST_CA_FILE) throw new Error("Managed CA is required");
      args.push(process.env.VI_TEST_CA_FILE);
    }
    const result = await execute(process.execPath, args, {
      cwd: root, env: { ...process.env, VI_BASE_URL: baseUrl }, timeout: 30000,
    });
    expect(result.stdout).toContain(`PASS: ${mode}`);
    expect(result.stdout).toContain("SHA-256 matches");
  });
}

test("documented SMS example captures and cleans up its own resources", async () => {
  requireManaged();
  const result = await execute(process.execPath, [resolve(root, "examples/sms-roundtrip.mjs")], {
    cwd: root, env: { ...process.env, VI_BASE_URL: baseUrl }, timeout: 30000,
  });
  expect(result.stdout).toContain("PASS: simulated SMS captured");
});
