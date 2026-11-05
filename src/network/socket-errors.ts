import type { SMTPServer } from "smtp-server";

/**
 * SMTPServer accepts a raw TCP socket before SMTPConnection owns its lifecycle.
 * A peer RST in that handoff (or in implicit TLS negotiation) can arrive after
 * the library has removed its temporary error listener. Node treats an error
 * event without any handler as a process-level exception.
 *
 * Keep a passive handler for the lifetime of each accepted raw socket. This
 * does not close the socket or consume the library's own error notifications.
 * Pinned smtp-server internals are covered by real TCP reset tests.
 */
export function protectSmtpSocketErrors(server: SMTPServer): void {
  server.server.on("connection", (socket) => {
    socket.on("error", () => { /* Expected peer disconnect; SMTPServer handles session cleanup. */ });
  });
}
