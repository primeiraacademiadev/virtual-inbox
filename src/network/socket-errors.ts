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

type ImplicitTlsUpgrade = (socket: { destroyed: boolean; remoteAddress?: string },
  callback: (error: Error | null, tlsSocket?: unknown) => void) => void;

/**
 * smtp-server 3.21.1 starts the implicit TLS handshake one event-loop turn after
 * accepting the socket (setImmediate in _handleProxy). A client that resets or
 * closes in that turn leaves a destroyed socket, which _upgrade still wraps in a
 * TLSSocket; its error path then calls getProtocol() on a wrapper without native
 * SSL state, and Node terminates with an access violation (0xC0000005 / SIGSEGV).
 *
 * Refuse the upgrade of a socket that is already gone, with the same error the
 * library reports for a close during TLS initiation. Version-specific: the
 * adapter fails at startup if the internal method is missing.
 */
export function refuseUpgradeOfClosedSockets(server: SMTPServer): void {
  const internals = server as unknown as { _upgrade?: ImplicitTlsUpgrade };
  const upgrade = internals._upgrade;
  if (typeof upgrade !== "function") throw Error("smtp-server implicit TLS upgrade hook unavailable");
  internals._upgrade = function (socket, callback) {
    if (!socket.destroyed) return upgrade.call(this, socket, callback);
    callback(Object.assign(new Error("Socket closed while initiating TLS"), {
      code: "SocketError", responseCode: 500, report: false,
      meta: { protocol: "smtp", stage: "connect", remoteAddress: socket.remoteAddress },
    }));
  };
}
