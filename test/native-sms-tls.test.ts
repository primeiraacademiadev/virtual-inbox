import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLocalTls } from "../src/tls/local-certificates.js";
import { createNativeSmsExtension } from "../src/extensions/sms-native.js";
import { createVerifiedLocalFetch } from "../src/extensions/trusted-local-fetch.js";
import { ExtensionHost } from "../src/extension-host.js";

test("native SMS sender calls the public HTTPS API with certificate validation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vi-sms-native-https-"));
  let server: ReturnType<typeof createHttpsServer> | undefined;
  try {
    const identity = ensureLocalTls(directory, "localhost,127.0.0.1");
    const ca = readFileSync(identity.ca);
    server = createHttpsServer({
      key: readFileSync(identity.key), cert: readFileSync(identity.cert),
    }, (req, res) => {
      assert.equal(req.url, "/api/sms/ingestions");
      assert.equal(req.method, "POST");
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as
          { from: string; to: string; body: string };
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...input, id: "verified", sequence: 1, channel: "sms",
          destinationId: "test", originalRecipient: input.to }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = new URL("https://127.0.0.1:" + address.port + "/");
    const trust = () => ({ ca, servername: "localhost" });
    const host = new ExtensionHost();
    host.registerNativeSms(createNativeSmsExtension(origin.href,
      { fetch: createVerifiedLocalFetch(origin, trust) }));
    const result = await host.dispatch({
      audience: "demo", method: "POST", path: "/sms/messages",
      body: { from: "native-test", to: "+351912345678", body: "hello" },
    });
    assert.equal(result?.response.status, 201);
    assert.equal((result?.response.body as { id: string }).id, "verified");
    const untrusted = createVerifiedLocalFetch(origin, () =>
      ({ ca: "not a trusted CA", servername: "localhost" }));
    await assert.rejects(untrusted(new URL("/api/sms/ingestions", origin)),
      /certificate|PEM|ca|issuer|self.signed|unable to verify|invalid/i);
    await assert.rejects(createVerifiedLocalFetch(origin, trust)(
      new URL("https://example.invalid/api/sms/ingestions")),
      /unrelated origin/);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server!.close(err => err ? reject(err) : resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
