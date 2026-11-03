import { isIP } from "node:net";

/** Encode an IP SAN, including forms such as ::ffff:127.0.0.1. */
export function ipAddressBytes(value: string): Buffer {
  const family = isIP(value);
  if (family === 4) return Buffer.from(value.split(".").map(Number));
  if (family !== 6 || value.includes("%")) throw new Error("Invalid IP SAN");

  let normalized = value.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const suffix = normalized.slice(separator + 1);
    if (isIP(suffix) !== 4) throw new Error("Invalid embedded IPv4 SAN");
    const octets = suffix.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = normalized.slice(0, separator + 1) + high + ":" + low;
  }

  const [left, right] = normalized.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (right !== undefined && missing < 1) throw new Error("Invalid compressed IPv6 SAN");
  const segments = right === undefined ? head : [...head, ...Array(missing).fill("0"), ...tail];
  if (segments.length !== 8) throw new Error("Invalid IPv6 SAN");

  const bytes = Buffer.alloc(16);
  segments.forEach((segment, index) => {
    bytes.writeUInt16BE(Number.parseInt(segment, 16), index * 2);
  });
  return bytes;
}
