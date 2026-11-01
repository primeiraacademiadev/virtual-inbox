import type { EventEntry } from "../api.js";
import { logPageUrl, pageSnapshot, snapshotCursor, mergeOlderPage, recoverableGapUrl, mergeRecoveredLogs, type LogPage } from "./log-model.js";

type FetchJson = <T>(path: string) => Promise<T>;
export type HistoryResult = { entries: EventEntry[]; nextBefore?: number; hasMore: boolean; cursor: string | null };
export async function initialHistory(fetchJson: FetchJson, field: string, filter: string, depth: number): Promise<HistoryResult> {
  const page = await fetchJson<LogPage>(logPageUrl(field, filter));
  return {
    entries: pageSnapshot(page, depth),
    nextBefore: page.nextBefore,
    hasMore: page.hasMore,
    cursor: snapshotCursor(page),
  };
}
export async function olderHistory(fetchJson: FetchJson, field: string, filter: string, before: number,
  entries: EventEntry[], depth: number): Promise<HistoryResult> {
  const page = await fetchJson<LogPage>(logPageUrl(field, filter, before));
  return { entries: mergeOlderPage(entries, page, depth), nextBefore: page.nextBefore,
    hasMore: page.hasMore, cursor: null };
}
export async function recoverHistoryGap(fetchJson: FetchJson, field: string, filter: string,
  gap: EventEntry, entries: EventEntry[], depth: number): Promise<EventEntry[] | null> {
  const url = recoverableGapUrl(gap, field, filter);
  if (!url) return null;
  const result = await fetchJson<{events: EventEntry[]}>(url);
  return result.events.length ? mergeRecoveredLogs(entries, gap.id, result.events, depth) : null;
}
