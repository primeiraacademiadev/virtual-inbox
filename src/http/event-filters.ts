import type { Event } from "./core.js";

/** Observers only receive events bound to inboxes in their own watch set. */
export function isObserverEventVisible(event: Event, watchedInboxIds: ReadonlySet<string>): boolean {
  return !!event.resourceId && watchedInboxIds.has(event.resourceId);
}

/** Shared predicate for filtered replay and live event emission; conjunctive selectors. */
export type EventFilter = {
  eventType?: string;
  inboxId?: string;
  messageId?: string;
  smtpSessionId?: string;
  ruleId?: string;
};
export function eventMatchesFilter(event: Event, filter: EventFilter): boolean {
  const data = event.data || {};
  return (!filter.eventType || event.type === filter.eventType) &&
    (!filter.inboxId || event.resourceId === filter.inboxId) &&
    (!filter.messageId || event.messageId === filter.messageId) &&
    (!filter.smtpSessionId || data.smtpSessionId === filter.smtpSessionId) &&
    (!filter.ruleId || data.ruleId === filter.ruleId);
}
export function parseEventFilter(params: URLSearchParams): EventFilter {
  const allowed = new Set(["after", "eventType", "inboxId", "messageId", "smtpSessionId", "ruleId"]);
  const filter: EventFilter = {};
  for (const [key, value] of params) {
    if (!allowed.has(key) || value.length > 320 || (key !== "after" && !value.trim()))
      throw new Error("Invalid log filter");
    if (key !== "after") filter[key as keyof EventFilter] = value;
  }
  return filter;
}
