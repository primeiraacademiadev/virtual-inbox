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
const { ProtocolConnections, filteredConnections } = await import(modulePath("protocols/ProtocolConnections"));
const { NavigationIcon } = await import(modulePath("NavigationIcon"));
const { FootprintView, FootprintSummary } = await import(modulePath("FootprintView"));

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
  assert.match(system, /Footprint/);
  assert.match(protocols, /<svg/);
  assert.doesNotMatch(system, /Simulated errors/);
});

test("protocol test console renders disabled credentials and mode-specific guidance", () => {
  const pop3 = render(ProtocolTesting, { mode: "pop3", adminToken: "" });
  assert.match(pop3, /POP3 test identities/);
  assert.match(pop3, /POP3 connection/);
  assert.match(pop3, /Resolve GUID/);
  assert.match(pop3, /disabled=""/);
  assert.doesNotMatch(pop3, /<h3>Simulated protocol errors<\/h3>/);
  assert.match(pop3, /Open Simulated errors/);
  assert.match(pop3, /POP3 connections/);
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

test("filtered protocol history and rendered footprint controls", () => {
  const items = [
    {id:"1", remoteAddress:"one", connectedAt:"2026-10-27T00:00:00Z",
      lastActivityAt:"2026-10-27T00:01:00Z", connected:false, authenticated:true, inbox:"alice@test.local"},
    {id:"2", remoteAddress:"two", connectedAt:"2026-10-27T00:00:00Z",
      lastActivityAt:"2026-10-27T00:03:00Z", connected:true, authenticated:true, inbox:"bob@test.local"},
  ];
  assert.deepEqual(filteredConnections(items,"ALI","all","activity",true).map((v:{id:string})=>v.id),["1"]);
  assert.deepEqual(filteredConnections(items,"","connected","inbox",false).map((v:{id:string})=>v.id),["2"]);
  assert.deepEqual(filteredConnections(items,"","all","activity",true).map((v:{id:string})=>v.id),["2","1"]);
  const html = render(ProtocolConnections,{protocol:"SMTP",records:items});
  assert.match(html,/SMTP connections/);
  assert.match(html,/Last activity/);
  assert.match(html,/Reverse sort/);
  assert.match(render(NavigationIcon,{name:"sms"}),/<svg/);
  assert.match(render(FootprintView,{adminToken:""}),/Application Footprint/);
});

test("footprint summary renders resource counts, retention and process memory", () => {
  const mib = 1024 * 1024;
  const snapshot = {
    runId: "test-run", capturedAt: "2026-10-27T00:00:00Z", uptimeSeconds: 120,
    memory: { rss: 100*mib, heapUsed: 40*mib, heapTotal: 60*mib,
      external: 5*mib, arrayBuffers: 2*mib },
    resources: { emailInboxes: 2, smsInboxes: 3, inboxLimit: 2000,
      messages: 5, messageLimit: 10000, attachments: 1,
      storedBytes: 2*mib, storedBytesLimit: 256*mib,
      observers: 1, observerLimit: 500, events: 8, eventLimit: 2000,
      logicalSessions: 2, simulationRules: 1 },
    protocols: {
      SMTP: { active: 1, retained: 7, limit: 500, retentionSeconds: 3600 },
      POP3: { active: 2, retained: 9, limit: 500, retentionSeconds: 3600 },
    },
    cleanup: { lastAt: "2026-10-27T00:00:00Z" },
  };
  const html = render(FootprintSummary, { value: snapshot });
  assert.match(html, /100.0 MiB/);
  assert.match(html, /Email inboxes/);
  assert.match(html, /Stored payload/);
  assert.match(html, /256.0 MiB/);
  assert.match(html, /Connection retention/);
  assert.match(html, /Last cleanup:/);
  assert.match(html, /POP3/);
});
