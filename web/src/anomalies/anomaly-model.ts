import type { Message } from "../api.js";

export type AnomalyFilter = { recipient: string; sender: string; reason: string };
export function filteredAnomalies(messages: readonly Message[], filter: AnomalyFilter): Message[] {
  return messages.filter(message => !!message.captureReason &&
    (!filter.recipient || message.originalRecipient.toLowerCase().includes(filter.recipient.trim().toLowerCase())) &&
    (!filter.sender || message.from.toLowerCase().includes(filter.sender.trim().toLowerCase())) &&
    (!filter.reason || message.captureReason === filter.reason));
}
export function anomalyGroups(messages: readonly Message[]) {
  const groups = new Map<string, { recipient: string; reason: string; count: number }>();
  for (const message of messages) {
    if (!message.captureReason) continue;
    const key = JSON.stringify([message.originalRecipient, message.captureReason]);
    const previous = groups.get(key);
    if (previous) previous.count++;
    else groups.set(key, { recipient: message.originalRecipient, reason: message.captureReason, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.recipient.localeCompare(b.recipient));
}
