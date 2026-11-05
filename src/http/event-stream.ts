/** Event-stream transport and replay without server lifecycle dependencies. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { matchesLog, parseLogFilters, type Event, type Sandbox } from "../core.js";
import { sse } from "./server-helpers.js";

export function observe(sandbox: Sandbox, req: IncomingMessage, res: ServerResponse, observerId?: string) {
  const snapshot = observerId ? sandbox.snapshot(observerId) : sandbox.newObserver();
  const url = new URL(req.url || "/", "https://localhost");
  const after = String(req.headers["last-event-id"] || url.searchParams.get("after") || "");
  const logFilters = parseLogFilters(url.searchParams);
  const active = () => !observerId || (sandbox.observers.get(observerId)?.expiresAt ?? 0) > Date.now();
  const relevant = (event: Event) => !observerId || !!(
    event.resourceId && sandbox.observers.get(observerId)?.inboxes.has(event.resourceId)
  );
  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    sandbox.emitter.off("event", callback);
    if (!res.writableEnded) res.end();
  };
  const buffered: Event[] = [];
  let replaying = true;
  const emit = (event: Event) => {
    if (closed) return;
    if (matchesLog(event, logFilters)) sse(res, "log", event, event.id);
    if (observerId && event.type.startsWith("message.") && relevant(event)) {
      sse(res, "inbox.notification", event);
    }
  };
  const callback = (event: Event) => {
    if (!active()) { stop(); return; }
    if (replaying) buffered.push(event);
    else emit(event);
  };
  sandbox.emitter.on("event", callback);
  sse(res, observerId ? "session.restored" : "session.initialized", snapshot);
  const replay = sandbox.replay(after, logFilters);
  if (replay.reset) sse(res, "log.reset", { runId: replay.runId });
  if (replay.gap) sse(res, "log.gap", { oldest: replay.oldest, latest: replay.latest, missingFrom: replay.missingFrom, missingTo: replay.missingTo });
  for (const event of replay.events) emit(event);
  replaying = false;
  const emitted = new Set(replay.events.map((event) => event.id));
  for (const event of buffered) if (!emitted.has(event.id)) callback(event);
  heartbeat = setInterval(() => {
    if (!active()) stop();
    else if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20000);
  res.on("close", stop);
}
