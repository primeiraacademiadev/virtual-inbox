import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
// Keep UI modules out of the server TypeScript build, while loading the actual
// TSX source during the Node tests for meaningful c8 coverage.
const modulePath = (name: string) => "../web/src/components/" + name + ".js";
const { ContextSidebar } = await import(modulePath("ContextSidebar"));
const { ProtocolTesting } = await import(modulePath("protocols/ProtocolTesting"));
const { ProtocolMetricsView } = await import(modulePath("protocols/ProtocolMetricsView"));
const { MarkdownView } = await import(modulePath("documentation/MarkdownView"));

// Render the real React components with the console's installed React runtime.
// This tests accessible markup without requiring a browser or live admin API.
const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const { createElement } = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server");
const render = (component: unknown, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(component as never, props));

test("context navigation renders the appropriate links and documentation headings", () => {
  const handlers = { onPage: () => {}, onDocument: () => {} };
  const props = { ...handlers, docPage: "overview", docText: "# Overview\n## First steps\n### SMTP" };
  const documentation = render(ContextSidebar, { ...props, page: "documentation" });
  assert.match(documentation, /Documentation navigation/);
  assert.match(documentation, /API reference/);
  assert.match(documentation, /Introduction/);
  assert.match(documentation, /First steps/);
  assert.match(documentation, /tocIndented/);
  const api = render(ContextSidebar, { ...props, page: "api" });
  assert.match(api, /API reference/);
  assert.doesNotMatch(api, /On this page/);
  const protocols = render(ContextSidebar, { ...props, page: "pop3" });
  assert.match(protocols, /Protocols navigation/);
  assert.match(protocols, /Simulated errors/);
  assert.match(protocols, /aria-current="page"/);
  const system = render(ContextSidebar, { ...props, page: "connections" });
  assert.match(system, /System navigation/);
  assert.match(system, /Connections and TLS/);
  assert.doesNotMatch(system, /Simulated errors/);
});

test("protocol test console renders disabled credentials and mode-specific guidance", () => {
  const pop3 = render(ProtocolTesting, { mode: "pop3", adminToken: "" });
  assert.match(pop3, /POP3 test identities/);
  assert.match(pop3, /POP3 connection/);
  assert.match(pop3, /Resolve GUID/);
  assert.match(pop3, /disabled=""/);
  assert.match(pop3, /Simulated protocol errors/);
  assert.match(pop3, /Protocol counters/);
  const simulation = render(ProtocolTesting, { mode: "simulations", adminToken: "test-token" });
  assert.match(simulation, /Simulation rules/);
  assert.doesNotMatch(simulation, /POP3 connection/);
  assert.match(simulation, /value="451"/);
  assert.match(simulation, /Add rule/);
});

test("protocol metrics render a usable initial state without credentials", () => {
  const html = render(ProtocolMetricsView, { adminToken: "" });
  assert.match(html, /Protocol counters/);
  assert.match(html, /Refresh counters/);
  assert.doesNotMatch(html, /<table/);
});

test("markdown renders headings, internal navigation, external links, and permitted downloads", () => {
  const markdown = [
    "# Overview",
    "## API",
    "[Guide](integration.md)",
    "[OpenAPI](/api/openapi.json)",
    "[Website](https://example.test/docs)",
    "[Missing document](unknown.txt)",
  ].join("\n\n");
  const html = render(MarkdownView, { markdown, onDocument: () => {} });
  assert.match(html, /id="doc-heading-1"/);
  assert.match(html, /id="doc-heading-2"/);
  assert.match(html, /href="integration.md"/);
  assert.match(html, /download="virtual-inbox-openapi.json"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /href="unknown.txt"/);
});
