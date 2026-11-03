import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LogPanel } from "../web/src/components/LogPanel.js";
const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const { createElement } = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server");
const noop = () => {};
const props = {
  logs: [{ id: "r:1", log_id: 1, at: "2026-11-01T12:00:00Z", type: "message.received", resourceId: "abcdef012345" }],
  depth: 2000, onDepth: noop, field: "type", onField: noop,
  serverFilter: "", onServerFilter: noop, includeAnomalies: true, onIncludeAnomalies: noop, onClear: noop, onMinimize: noop,
  onOlder: noop, onRecover: noop, hasOlder: true, loadingOlder: false,
  unretrievableGaps: [], loadingGaps: [], locale: "en", formatDate: (date: string) => date,
  labels: { logs: "Logs", minimize: "Minimize", filter: "Search logs", clear: "Clear" },
};
const render = (values: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(LogPanel, { ...props, ...values }));
test("log panel renders history depth, filtering controls and load-more action", () => {
  const html = render();
  assert.match(html, /Search logs/);
  assert.match(html, /Log history depth/);
  assert.match(html, /Server log filter value/);
  assert.match(html, /Load older events/);
  assert.match(html, /abcdef01/);
  assert.match(html, /message/);
});
test("log panel renders loading and localized gaps without message disclosure", () => {
  const gap = { id: "gap:2:3", at: "2026-11-01T12:00:00Z", type: "log.gap",
    data: { missingFrom: 2, missingTo: 3 } };
  const html = render({ logs: [gap], locale: "pt-PT", loadingOlder: true, loadingGaps: [gap.id] });
  assert.match(html, /Entradas em falta/);
  assert.match(html, /Loading/);
  assert.match(html, /disabled/);
  assert.match(render({ logs: [gap], unretrievableGaps: [gap.id] }), /Unretrievable/);
  assert.doesNotMatch(render({ logs: [], hasOlder: false }), /Load older events/);
});

test("anomalies remain visible by default and focused mode can remove them", () => {
  const anomaly = { id: "anomaly:1", at: "2026-11-01T12:00:00Z", type: "message.captured", resourceId: "elsewhere" };
  assert.match(render({ logs: [anomaly] }), /Include anomalies/);
  assert.match(render({ logs: [anomaly] }), /checked/);
  assert.doesNotMatch(render({ logs: [anomaly], includeAnomalies: false }), /checked/);
});
