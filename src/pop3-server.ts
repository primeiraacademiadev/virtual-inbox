import { createServer, type Server } from "node:net";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { Sandbox } from "./core.js";
import type { InboxCredentialStore } from "./inbox-credentials.js";

/** Test-only POP3 mailbox access, sharing the SMTP inbox/password identity. */
export function createPop3Server(sandbox: Sandbox, credentials: InboxCredentialStore): Server {
  return createServer((socket: Socket) => {
    const connectionId = randomUUID();
    let username = "";
    let sessionId = "";
    let buffer = "";
    let queue = Promise.resolve();
    const deleted = new Set<string>();
    const send = (line: string) => socket.write(line + "\r\n");
    const messages = () => sessionId ? sandbox.find("email", username)
      ? sandbox.listMessages(sandbox.find("email", username)!.id).filter(m => !deleted.has(m.id))
      : [] : [];
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
          if (command === "QUIT") { send("+OK goodbye"); socket.end(); return; }
          if (command === "CAPA") { send("+OK capabilities"); multiline(["USER", "UIDL", "TOP"]); return; }
          if (command === "USER" && !sessionId) { username = arg; send(username ? "+OK user accepted" : "-ERR user required"); return; }
          if (command === "PASS" && !sessionId) {
            if (!username) { send("-ERR send USER first"); return; }
            sessionId = await credentials.authenticate(username, arg);
            send("+OK authenticated");
            return;
          }
          if (!sessionId) { send("-ERR authenticate with USER and PASS"); return; }
          const all = messages();
          const index = Number(arg.split(/\s+/)[0]);
          const selected = Number.isInteger(index) && index > 0 ? all[index - 1] : undefined;
          const bytes = (m: (typeof all)[number]) => Buffer.byteLength(m.rawMime ? Buffer.from(m.rawMime, "base64") : Buffer.from(m.body), "utf8");
          if (command === "NOOP") { send("+OK"); return; }
          if (command === "RSET") { deleted.clear(); send("+OK reset"); return; }
          if (command === "STAT") { send("+OK " + all.length + " " + all.reduce((n,m)=>n+bytes(m),0)); return; }
          if (command === "LIST" || command === "UIDL") {
            if (arg) {
              if (!selected) { send("-ERR no such message"); return; }
              send("+OK " + index + " " + (command === "LIST" ? bytes(selected) : selected.id));
            } else {
              send("+OK list follows");
              multiline(all.map((m,i) => (i+1) + " " + (command === "LIST" ? bytes(m) : m.id)));
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
            multiline(command === "TOP" ? lines.slice(0, boundary + 1 + top) : lines);
            return;
          }
          if (command === "DELE") { if (!selected) send("-ERR no such message"); else { deleted.add(selected.id); send("+OK marked"); } return; }
          send("-ERR unsupported command");
        }).catch(() => send("-ERR command failed"));
      }
    });
    socket.on("end", () => {
      if (!sessionId) return;
      const inbox = sandbox.find("email", username);
      if (!inbox) return;
      for (const id of deleted) {
        try { sandbox.removeMessage(inbox.id, id); } catch { /* inbox may have expired */ }
      }
    });
    void connectionId;
  });
}
