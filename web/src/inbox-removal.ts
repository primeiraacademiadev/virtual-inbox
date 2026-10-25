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
