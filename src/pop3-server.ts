import { createServer, type Server } from "node:net";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { Sandbox } from "./core.js";
import type { InboxCredentialStore } from "./inbox-credentials.js";
import type { SimulationStore } from "./simulation-store.js";
import type { ProtocolCounters } from "./protocol-metrics.js";

/** Test-only POP3 mailbox access, sharing the SMTP inbox/password identity. */
export function createPop3Server(sandbox: Sandbox, credentials: InboxCredentialStore, simulations: SimulationStore, counters: ProtocolCounters): Server {
  return createServer((socket: Socket) => {
    const connectionId = randomUUID();
    counters.connect("POP3");
    let username = "";
    let sessionId = "";
    let buffer = "";
    let queue = Promise.resolve();
    const deleted = new Set<string>();
    let snapshot: ReturnType<Sandbox["listMessages"]> = [];
    const send = (line: string) => socket.write(line + "\r\n");
    const messages = () => snapshot.map((message, i) => ({ number: i + 1, message }))
      .filter(entry => !deleted.has(entry.message.id));
    const multiline = (lines: string[]) => { for (const line of lines) send(line.startsWith(".") ? "." + line : line); send("."); };
    send("+OK Virtual Inbox POP3 ready");
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 65536) { send("-ERR command too long"); socket.destroy(); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        queue = queue.then(async () => {
          const space = line.indexOf(" ");
          const command = (space < 0 ? line : line.slice(0, space)).toUpperCase();
          const arg = space < 0 ? "" : line.slice(space + 1).trim();
          counters.command("POP3");
          if (command === "QUIT") {
            if (sessionId) {
              const inbox = sandbox.find("email", username);
              if (inbox) for (const id of deleted) {
                try { sandbox.removeMessage(inbox.id, id); } catch { /* expired or already deleted */ }
              }
            }
            send("+OK goodbye"); socket.end(); return;
          }
          if (command === "CAPA") { send("+OK capabilities"); multiline(["USER", "UIDL", "TOP"]); return; }
          if (command === "USER" && !sessionId) { username = arg; send(username ? "+OK user accepted" : "-ERR user required"); return; }
          if (command === "PASS" && !sessionId) {
            if (!username) { send("-ERR send USER first"); return; }
            let inbox;
            try { inbox = sandbox.find("email", username); } catch { /* expired inbox */ }
            if (!inbox) { send("-ERR test inbox unavailable"); return; }
            sessionId = await credentials.authenticate(username, arg);
            snapshot = sandbox.listMessages(inbox.id);
            counters.auth("POP3");
            send("+OK authenticated");
            return;
          }
          if (!sessionId) { send("-ERR authenticate with USER and PASS"); return; }
          const rule = simulations.match(sessionId, "POP3", command);
          if (rule) { counters.error("POP3", true); send("-ERR " + rule.message); return; }
          const all = messages();
          const index = Number(arg.split(/\s+/)[0]);
          const selected = Number.isInteger(index) && index > 0 && !deleted.has(snapshot[index - 1]?.id)
            ? snapshot[index - 1] : undefined;
          const bytes = (m: (typeof snapshot)[number]) => m.rawMime ? Buffer.from(m.rawMime, "base64").length : Buffer.byteLength(m.body);
          if (command === "NOOP") { send("+OK"); return; }
          if (command === "RSET") { deleted.clear(); send("+OK reset"); return; }
          if (command === "STAT") { send("+OK " + all.length + " " + all.reduce((n, entry)=>n+bytes(entry.message),0)); return; }
          if (command === "LIST" || command === "UIDL") {
            if (arg) {
              if (!selected) { send("-ERR no such message"); return; }
              send("+OK " + index + " " + (command === "LIST" ? bytes(selected) : selected.id));
            } else {
              send("+OK list follows");
              multiline(all.map(entry => entry.number + " " + (command === "LIST" ? bytes(entry.message) : entry.message.id)));
            }
            return;
          }
          if (command === "RETR" || command === "TOP") {
            if (!selected) { send("-ERR no such message"); return; }
            const raw = selected.rawMime ? Buffer.from(selected.rawMime,"base64").toString("utf8")
              : "From: " + selected.from + "\r\nTo: " + selected.originalRecipient + "\r\nSubject: " + (selected.subject || "") + "\r\n\r\n" + selected.body;
            const lines = raw.replace(/\r\n/g, "\n").split("\n");
            const top = command === "TOP" ? Math.max(0, Number(arg.split(/\s+/)[1]) || 0) : Infinity;
            const boundary = lines.indexOf("");
            send("+OK message follows");
            if (command === "RETR") counters.message("POP3");
            multiline(command === "TOP" ? lines.slice(0, boundary + 1 + top) : lines);
            return;
          }
          if (command === "DELE") { if (!selected) send("-ERR no such message"); else { deleted.add(selected.id); send("+OK marked"); } return; }
          counters.error("POP3"); send("-ERR unsupported command");
        }).catch(() => { send("-ERR command failed"); });
      }
    });
    socket.on("close", () => { counters.disconnect("POP3"); });
    void connectionId;
  });
}
