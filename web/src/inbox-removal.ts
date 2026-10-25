import type { Recipient } from "./api.js";

/**
 * Resource deletion is distinct from merely unsubscribing a system inbox.
 * Declining the confirmation must never trigger either operation.
 */
export async function removeInboxRecord(
  target: Recipient,
  observerId: string,
  actions: {
    confirmDelete: () => boolean;
    remove: (path: string) => Promise<unknown>;
  },
): Promise<boolean> {
  if (!target.system && !actions.confirmDelete()) return false;
  const resource = target.channel === "email" ? "/mailboxes" : "/phone-numbers";
  const path = target.system
    ? "/observers/" + observerId + "/inboxes/" + target.id
    : resource + "/" + target.id;
  await actions.remove(path);
  return true;
}

/** Coordinates the removal, observer refresh and currently selected inbox state. */
export async function removeInboxAndReconcile(
  target: Recipient,
  observerId: string,
  selectedId: string | null,
  actions: {
    confirmDelete: () => boolean;
    remove: (path: string) => Promise<unknown>;
    syncObserver: (id: string) => Promise<unknown>;
    clearSelected: () => void;
  },
): Promise<boolean> {
  const removed = await removeInboxRecord(target, observerId, actions);
  if (!removed) return false;
  await actions.syncObserver(observerId);
  if (selectedId === target.id) actions.clearSelected();
  return true;
}
