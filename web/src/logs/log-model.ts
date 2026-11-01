import type { EventEntry } from "../api";

export const LOG_DEPTHS = [500, 2000, 5000, 10000] as const;
export const LOG_FILTER_FIELDS = ["type","inboxId","messageId","smtpSessionId","attemptId","sender","recipient","ruleId"] as const;
export function appendLog(entries: EventEntry[], entry: EventEntry, depth: number): EventEntry[] {
  if (entries.some((x) => x.id === entry.id)) return entries;
  return [...entries.slice(-(depth - 1)), entry];
}
export function visibleLogs(entries: EventEntry[], query: string): EventEntry[] {
  const needle = query.toLowerCase();
  return entries.filter((entry) => entry.type === "log.gap" || JSON.stringify(entry).toLowerCase().includes(needle));
}
export function logStreamQuery(field: string, value: string): string {
  const v = value.trim();
  return v && (LOG_FILTER_FIELDS as readonly string[]).includes(field)
    ? "?" + new URLSearchParams({ [field]: v }).toString() : "";
}
export function gapRange(event: EventEntry): { from: number; to: number } | null {
  const from = event.data?.missingFrom, to = event.data?.missingTo;
  if (typeof from !== "number" || typeof to !== "number" ||
    !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 ||
    from > to || to - from > 10000) return null;
  return { from, to };
}
export function recoverableGapUrl(event: EventEntry, field: string, value: string): string | null {
  const range = gapRange(event);
  if (!range) return null;
  const params = new URLSearchParams({ from: String(range.from), to: String(range.to) });
  const v = value.trim();
  if (v && (LOG_FILTER_FIELDS as readonly string[]).includes(field)) params.set(field, v);
  return "/logs?" + params.toString();
}
export function mergeRecoveredLogs(entries: EventEntry[], gapId: string, recovered: EventEntry[], depth: number): EventEntry[] {
  const merged = [...entries.filter((entry) => entry.id !== gapId), ...recovered];
  return merged.filter((entry, i) => merged.findIndex((other) => other.id === entry.id) === i)
    .sort((a, b) => (a.log_id ?? 0) - (b.log_id ?? 0)).slice(-depth);
}
export function gapLabel(locale: string, missing: boolean, from: unknown, to: unknown): string {
  const terms = locale === "pt-PT" ? ["Entradas irrecuperáveis", "Entradas em falta"] :
    locale === "fr" ? ["Entrées irrécupérables", "Entrées manquantes"] :
    ["Unretrievable entries", "Missing entries"];
  return `${terms[missing ? 0 : 1]} (#${from}–#${to})`;
}
