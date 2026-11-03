import { config } from "./config.js";
import type { Sandbox } from "./core.js";
import type { SmtpSessionStore } from "./smtp-sessions.js";
import type { Pop3ConnectionStore } from "./pop3-connections.js";
import type { InboxCredentialStore } from "./inbox-credentials.js";
import type { SimulationStore } from "./simulation-store.js";

/** Read-only snapshot. Resource bytes represent logical payloads, not total RSS. */
export function applicationFootprint(
  sandbox: Sandbox, smtp: SmtpSessionStore, pop3: Pop3ConnectionStore,
  credentials: InboxCredentialStore, simulations: SimulationStore,
  lastCleanupAt: string | null,
) {
  const memory = process.memoryUsage();
  const resources = [...sandbox.resources.values()];
  const messages = [...sandbox.messages.values()];
  const smtpList = smtp.listSessions();
  let storedBytes = 0;
  let attachments = 0;
  for (const message of messages) {
    storedBytes += Buffer.byteLength(message.body) +
      (message.rawMime ? Buffer.byteLength(message.rawMime) : 0);
    for (const attachment of message.attachments ?? []) {
      attachments++;
      storedBytes += attachment.size;
    }
  }
  return {
    runId: sandbox.runId, uptimeSeconds: Math.floor(process.uptime()), capturedAt: new Date().toISOString(),
    memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal,
      external: memory.external, arrayBuffers: memory.arrayBuffers },
    resources: {
      emailInboxes: resources.filter(r => r.channel === "email" && !r.system).length,
      smsInboxes: resources.filter(r => r.channel === "sms" && !r.system).length,
      systemInboxes: resources.filter(r => r.system).length,
      inboxLimit: config.maxInboxes, messages: messages.length, messageLimit: config.messages,
      attachments, storedBytes, storedBytesLimit: config.storedBytes,
      observers: sandbox.observers.size, observerLimit: config.maxObservers,
      events: sandbox.events.length, eventLimit: sandbox.capacity,
      logicalSessions: credentials.list().length, simulationRules: simulations.list().length,
    },
    protocols: {
      SMTP: { active: smtpList.filter(x => x.connected).length, retained: smtpList.length,
        limit: 500, retentionSeconds: 3600 },
      POP3: { active: pop3.counts().active, retained: pop3.counts().retained,
        limit: pop3.counts().limit, retentionSeconds: pop3.counts().retentionMs / 1000 },
    },
    cleanup: { lastAt: lastCleanupAt },
  };
}
