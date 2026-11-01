import { useCallback, useEffect, useRef, useState } from "react";
import { request, type EventEntry, type Observer } from "../api.js";
import { initialHistory, olderHistory, recoverHistoryGap } from "./log-history-service.js";
import { appendLog, recoverableGapUrl, logSseUrl, gapMarker, appendGap } from "./log-model.js";

const validObserver = (value: string) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) ? value : "";

export function useLogHistory(
  observer: string,
  callbacks: {
    onSession: (session: Observer) => void;
    onMessage: (entry: EventEntry) => void;
    onMissingObserver: () => void;
    onGap: () => void;
  },
) {
  const latestCallbacks = useRef(callbacks);
  latestCallbacks.current = callbacks;
  const [logs, setLogs] = useState<EventEntry[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | undefined>();
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const [logDepth, setLogDepth] = useState(2000);
  const [logField, setLogField] = useState("type");
  const [serverLogFilter, setServerLogFilter] = useState("");
  const [includeAnomalies, setIncludeAnomalies] = useState(true);
  const [unretrievableGaps, setUnretrievableGaps] = useState<string[]>([]);
  const [loadingGaps, setLoadingGaps] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => { setLogs(entries => entries.slice(-logDepth)); }, [logDepth]);

  const loadOlder = useCallback(async () => {
    if (!hasOlder || loadingRef.current || olderCursor === undefined) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const result = await olderHistory(request, logField, serverLogFilter, olderCursor, logs, logDepth, includeAnomalies);
      setLogs(result.entries);
      setOlderCursor(result.nextBefore);
      setHasOlder(result.hasMore);
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasOlder, olderCursor, logField, serverLogFilter, logs, logDepth, includeAnomalies]);

  const recoverGap = useCallback(async (gap: EventEntry) => {
    if (!recoverableGapUrl(gap, logField, serverLogFilter)) return;
    setLoadingGaps(old => [...old, gap.id]);
    try {
      const result = await recoverHistoryGap(request, logField, serverLogFilter, gap, logs, logDepth, includeAnomalies);
      if (!result) setUnretrievableGaps(old => [...old, gap.id]);
      else setLogs(result);
    } catch {
      setUnretrievableGaps(old => [...old, gap.id]);
    } finally {
      setLoadingGaps(old => old.filter(id => id !== gap.id));
    }
  }, [logField, serverLogFilter, logs, logDepth, includeAnomalies]);

  useEffect(() => {
    let stream: EventSource | null = null;
    let closed = false;
    const observerId = validObserver(observer);
    const path = observerId ? "/api/observers/" + observerId + "/events" : "/api/observers/events";
    const boot = async () => {
      let cursor: string | null = null;
      try {
        const snapshot = await initialHistory(request, logField, serverLogFilter, logDepth, includeAnomalies);
        if (closed) return;
        setLogs(snapshot.entries);
        setOlderCursor(snapshot.nextBefore);
        setHasOlder(snapshot.hasMore);
        cursor = snapshot.cursor;
      } catch { /* Stream still works if the history endpoint is unavailable. */ }
      if (closed) return;
      stream = new EventSource(logSseUrl(path, logField, serverLogFilter, cursor, includeAnomalies));
      setConnected(false);
      const handleSession = (event: MessageEvent) => {
        if (!closed) latestCallbacks.current.onSession(JSON.parse(event.data) as Observer);
      };
      const handleLog = (event: MessageEvent) => {
        const entry = JSON.parse(event.data) as EventEntry;
        setLogs(previous => appendLog(previous, entry, logDepth));
        latestCallbacks.current.onMessage(entry);
      };
      stream.addEventListener("session.initialized", handleSession);
      stream.addEventListener("session.restored", handleSession);
      stream.addEventListener("log", handleLog);
      stream.addEventListener("inbox.notification", handleLog);
      stream.addEventListener("log.gap", (event: MessageEvent) => {
        const gap = JSON.parse(event.data) as { missingFrom?: number; missingTo?: number };
        if (gap.missingFrom !== undefined && gap.missingTo !== undefined)
          setLogs(previous => appendGap(previous,
            gapMarker(gap.missingFrom!, gap.missingTo!, new Date().toISOString()), logDepth));
        latestCallbacks.current.onGap();
      });
      stream.addEventListener("log.reset", () => {
        setLogs([]);
        latestCallbacks.current.onGap();
      });
      stream.onopen = () => setConnected(true);
      stream.onerror = () => {
        setConnected(false);
        if (observer) void request<Observer>("/observers/" + observer).catch((error: Error & { status?: number }) => {
          if (error.status === 404) latestCallbacks.current.onMissingObserver();
        });
      };
    };
    void boot();
    return () => { closed = true; stream?.close(); };
  }, [observer, logField, serverLogFilter, logDepth, includeAnomalies]);

  return { logs, setLogs, logDepth, setLogDepth, logField, setLogField,
    serverLogFilter, setServerLogFilter, includeAnomalies, setIncludeAnomalies, hasOlder, loadingOlder, loadOlder, recoverGap,
    unretrievableGaps, loadingGaps, connected };
}
