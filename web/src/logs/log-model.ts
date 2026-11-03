import type { EventEntry } from "../api.js";

export const LOG_DEPTHS = [500, 2000, 5000, 10000] as const;
export const LOG_FILTER_FIELDS = ["type","inboxId","messageId","smtpSessionId","attemptId","sender","recipient","ruleId"] as const;
export function appendLog(entries: EventEntry[], entry: EventEntry, depth: number): EventEntry[] {
  if (entries.some((x) => x.id === entry.id)) return entries;
  return [...entries.slice(-(depth - 1)), entry];
}
export const isLogAnomaly = (entry: EventEntry) => entry.type === "message.captured";
export function visibleLogs(entries: EventEntry[], query: string, includeAnomalies = true): EventEntry[] {
  const needle = query.toLowerCase();
  return entries.filter((entry) => entry.type === "log.gap" || (includeAnomalies && isLogAnomaly(entry)) || JSON.stringify(entry).toLowerCase().includes(needle));
}
export function logStreamQuery(field: string, value: string, includeAnomalies = true): string {
  const v = value.trim();
  const params = new URLSearchParams();
  if (v && (LOG_FILTER_FIELDS as readonly string[]).includes(field)) params.set(field, v);
  if (!includeAnomalies) params.set("includeAnomalies", "false");
  return params.size ? "?" + params.toString() : "";
}
export function gapRange(event: EventEntry): { from: number; to: number } | null {
  const from = event.data?.missingFrom, to = event.data?.missingTo;
  if (typeof from !== "number" || typeof to !== "number" ||
    !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 ||
    from > to || to - from > 10000) return null;
  return { from, to };
}
export function recoverableGapUrl(event: EventEntry, field: string, value: string, includeAnomalies = true): string | null {
  const range = gapRange(event);
  if (!range) return null;
  const params = new URLSearchParams({ from: String(range.from), to: String(range.to) });
  const v = value.trim();
  if (v && (LOG_FILTER_FIELDS as readonly string[]).includes(field)) params.set(field, v);
  if (!includeAnomalies) params.set("includeAnomalies", "false");
  return "/logs?" + params.toString();
}
export function mergeRecoveredLogs(entries: EventEntry[], gapId: string, recovered: EventEntry[], depth: number): EventEntry[] {
  const gap = entries.find(entry => entry.id === gapId);
  const range = gap && gapRange(gap);
  const valid = recovered.filter(entry => Number.isSafeInteger(entry.log_id) &&
    (!range || ((entry.log_id ?? 0) >= range.from && (entry.log_id ?? 0) <= range.to)));
  const missing: EventEntry[] = [];
  if (range && gap) {
    const found = [...new Set(valid.map(entry => entry.log_id!))].sort((a, b) => a - b);
    let start = range.from;
    for (const id of found) {
      if (id > start) {
        const marker = gapMarker(start, id - 1, gap.at);
        if (marker) missing.push(marker);
      }
      start = id + 1;
    }
    if (start <= range.to) {
      const marker = gapMarker(start, range.to, gap.at);
      if (marker) missing.push(marker);
    }
  }
  const merged = [...entries.filter(entry => entry.id !== gapId), ...valid, ...missing];
  return merged.filter((entry, i) => merged.findIndex(other => other.id === entry.id) === i)
    .sort((a, b) => (a.log_id ?? Number(a.data?.missingFrom) ?? 0) -
      (b.log_id ?? Number(b.data?.missingFrom) ?? 0)).slice(-depth);
}
export function gapLabel(locale: string, missing: boolean, from: unknown, to: unknown): string {
  const terms = locale === "pt-PT" ? ["Entradas irrecuperáveis", "Entradas em falta"] :
    locale === "fr" ? ["Entrées irrécupérables", "Entrées manquantes"] :
    ["Unretrievable entries", "Missing entries"];
  return `${terms[missing ? 0 : 1]} (#${from}–#${to})`;
}

export type LogPage = {
  events: EventEntry[];
  nextBefore?: number;
  hasMore: boolean;
  latest?: { log_id?: number; at: string } | null;
  runId?: string;
};
export function logPageUrl(field: string, value: string, before?: number, limit = 20, includeAnomalies = true): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set("before", String(before));
  const term = value.trim();
  if (term && (LOG_FILTER_FIELDS as readonly string[]).includes(field)) params.set(field, term);
  if (!includeAnomalies) params.set("includeAnomalies", "false");
  return "/logs?" + params.toString();
}
export function snapshotCursor(page: LogPage): string | null {
  const id = page.latest?.log_id;
  return page.runId && Number.isSafeInteger(id) && (id ?? 0) > 0
    ? page.runId + ":" + id : null;
}
export function logSseUrl(path: string, field: string, value: string, cursor: string | null, includeAnomalies = true): string {
  const query = logStreamQuery(field, value, includeAnomalies);
  return path + query + (cursor ? (query ? "&" : "?") + "after=" + encodeURIComponent(cursor) : "");
}
export function mergeOlderPage(entries: EventEntry[], page: LogPage, depth: number): EventEntry[] {
  const known = new Set(entries.map((event) => event.id));
  const older = page.events.filter((event) => !known.has(event.id));
  const combined = [...older, ...entries];
  // Keep newest entries as the cache is bounded. The server remains the source of history.
  return combined.sort((a, b) => (a.log_id ?? 0) - (b.log_id ?? 0)).slice(-depth);
}
export function pageSnapshot(page: LogPage, depth: number): EventEntry[] {
  return page.events.slice().sort((a, b) => (a.log_id ?? 0) - (b.log_id ?? 0)).slice(-depth);
}
export function gapMarker(missingFrom: number, missingTo: number, at: string): EventEntry | null {
  if (!Number.isSafeInteger(missingFrom) || !Number.isSafeInteger(missingTo) ||
    missingFrom < 1 || missingTo < missingFrom) return null;
  return {
    id: "gap:" + missingFrom + ":" + missingTo,
    at,
    type: "log.gap",
    data: { missingFrom, missingTo },
  };
}
export function appendGap(entries: EventEntry[], marker: EventEntry | null, depth: number): EventEntry[] {
  return marker ? appendLog(entries, marker, depth) : entries;
}
