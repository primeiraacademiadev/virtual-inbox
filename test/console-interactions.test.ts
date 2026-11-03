import test from "node:test";
import assert from "node:assert/strict";
import { registerDismissListeners } from "../web/src/hooks/useDismissable.js";
import { removeInboxRecord, removeInboxAndReconcile } from "../web/src/inbox-removal.js";
import type { Recipient } from "../web/src/api.js";

test("floating control dismisses on outside pointer and Escape, but not inside", () => {
  const root = new EventTarget();
  const inside = {} as Node;
  const outside = {} as Node;
  const ref = { current: { contains: (target: Node) => target === inside } as HTMLElement };
  let dismissed = 0;
  const unsubscribe = registerDismissListeners(root as Document, ref, () => dismissed++);
  const fire = (name: string, target?: Node, key?: string) => {
    const event = new Event(name);
    if (target) Object.defineProperty(event, "target", { value: target });
    if (key) Object.defineProperty(event, "key", { value: key });
    root.dispatchEvent(event);
  };
  fire("pointerdown", inside);
  fire("keydown", undefined, "Enter");
  assert.equal(dismissed, 0);
  fire("pointerdown", outside);
  fire("keydown", undefined, "Escape");
  assert.equal(dismissed, 2);
  ref.current = null as unknown as HTMLElement;
  fire("pointerdown", outside);
  assert.equal(dismissed, 2);
  unsubscribe();
  fire("keydown", undefined, "Escape");
  fire("pointerdown", outside);
  assert.equal(dismissed, 2);
});

test("inbox deletion waits for confirmation and never deletes on cancellation", async () => {
  const removed: string[] = [];
  const resource: Recipient = { id: "inbox-1", address: "a@sandbox.test", channel: "email", createdAt: "", expiresAt: null };
  const actions = {
    confirmDelete: () => false,
    remove: async (path: string) => { removed.push(path); },
  };
  assert.equal(await removeInboxRecord(resource, "obs", actions), false);
  assert.deepEqual(removed, []);
  actions.confirmDelete = () => true;
  assert.equal(await removeInboxRecord(resource, "obs", actions), true);
  assert.deepEqual(removed, ["/mailboxes/inbox-1"]);
  const sms: Recipient = { ...resource, id: "phone-2", channel: "sms" };
  assert.equal(await removeInboxRecord(sms, "obs", actions), true);
  assert.equal(removed.at(-1), "/phone-numbers/phone-2");
});

test("system inbox is only unsubscribed from the observer", async () => {
  const removed: string[] = [];
  const system: Recipient = { id: "system-3", address: "errors@sandbox.test", channel: "email", system: true, createdAt: "", expiresAt: null };
  assert.equal(await removeInboxRecord(system, "observer-4", {
    confirmDelete: () => { throw new Error("System subscriptions must not request deletion"); },
    remove: async path => { removed.push(path); },
  }), true);
  assert.deepEqual(removed, ["/observers/observer-4/inboxes/system-3"]);
});

test("inbox removal reconciles the observer and clears only the current selection", async () => {
  const target: Recipient = { id: "inbox-1", address: "demo@sandbox.test", channel: "email", createdAt: "", expiresAt: null };
  const actions: string[] = [];
  const ops = {
    confirmDelete: () => true,
    remove: async (path: string) => { actions.push("remove:" + path); },
    syncObserver: async (id: string) => { actions.push("sync:" + id); },
    clearSelected: () => { actions.push("clear"); },
  };
  assert.equal(await removeInboxAndReconcile(target, "observer-1", "other-inbox", ops), true);
  assert.deepEqual(actions, ["remove:/mailboxes/inbox-1", "sync:observer-1"]);
  actions.length = 0;
  assert.equal(await removeInboxAndReconcile(target, "observer-1", "inbox-1", ops), true);
  assert.deepEqual(actions, ["remove:/mailboxes/inbox-1", "sync:observer-1", "clear"]);
  actions.length = 0;
  ops.confirmDelete = () => false;
  assert.equal(await removeInboxAndReconcile(target, "observer-1", "inbox-1", ops), false);
  assert.deepEqual(actions, []);
});
