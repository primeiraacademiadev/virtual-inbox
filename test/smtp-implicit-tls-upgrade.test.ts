import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { SMTPServer } from "smtp-server";
import { refuseUpgradeOfClosedSockets } from "../src/network/socket-errors.js";

type Upgrade = (socket: Socket, callback: (error: Error | null, tlsSocket?: TLSSocket) => void) => void;
const upgradeOf = (server: SMTPServer) => (server as unknown as { _upgrade: Upgrade })._upgrade.bind(server);

async function destroyedSocket(): Promise<Socket> {
  const socket = new Socket();
  socket.destroy();
  await once(socket, "close");
  return socket;
}

test("implicit TLS upgrade of a socket the client already closed is refused, not wrapped", async () => {
  const server = new SMTPServer({ secure: true, logger: false });
  refuseUpgradeOfClosedSockets(server);
  const [error, tlsSocket] = await new Promise<[Error | null, TLSSocket | undefined]>(done =>
    destroyedSocket().then(socket => upgradeOf(server)(socket, (e, t) => done([e, t]))));
  // The error the Virtual Inbox already treats as a client leaving during TLS initiation.
  assert.equal(error?.message, "Socket closed while initiating TLS");
  assert.equal((error as Error & { code?: string }).code, "SocketError");
  assert.equal(tlsSocket, undefined);
});

test("implicit TLS upgrade of an open socket still goes to smtp-server", () => {
  const server = new SMTPServer({ secure: true, logger: false });
  const calls: Socket[] = [];
  (server as unknown as { _upgrade: Upgrade })._upgrade = socket => { calls.push(socket); };
  refuseUpgradeOfClosedSockets(server);
  const socket = new Socket();
  upgradeOf(server)(socket, () => assert.fail("the original upgrade owns the callback"));
  assert.deepEqual(calls, [socket]);
  socket.destroy();
});

test("the adapter fails loudly when the pinned smtp-server internal is missing", () => {
  const server = new SMTPServer({ secure: true, logger: false });
  (server as unknown as { _upgrade?: Upgrade })._upgrade = undefined;
  assert.throws(() => refuseUpgradeOfClosedSockets(server), /implicit TLS upgrade hook unavailable/);
});
