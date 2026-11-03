import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { AnomalyOverview } from "../web/src/components/AnomalyOverview.js";
const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const { createElement } = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server");
const message = (id: string, recipient: string, reason: string) => ({
  id, destinationId: "system", sequence: Number(id), channel: "email",
  originalRecipient: recipient, from: "sender@example.test", body: "synthetic",
  receivedAt: "2026-11-01T00:00:00Z", captureReason: reason,
});
test("anomaly panel renders grouped counts and accessible filters in Portuguese", () => {
  const html = renderToStaticMarkup(createElement(AnomalyOverview, {
    messages: [message("1", "missing@example.test", "UNKNOWN_RECIPIENT"),
      message("2", "missing@example.test", "UNKNOWN_RECIPIENT"),
      message("3", "expired@example.test", "EXPIRED_RECIPIENT")],
    locale: "pt-PT", onSelect: () => {},
  }));
  assert.match(html, /Destinatário original/);
  assert.match(html, /Remetente/);
  assert.match(html, /3 mensagens/);
  assert.match(html, /missing@example.test/);
  assert.match(html, /\(2\)/);
});
test("anomaly panel handles empty message history", () => {
  const html = renderToStaticMarkup(createElement(AnomalyOverview, { messages: [], locale: "en", onSelect: () => {} }));
  assert.match(html, /0 messages/);
  assert.match(html, /All reasons/);
});
