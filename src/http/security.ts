import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

export function isAllowedHost(
  host: string | undefined,
  configuredHosts: readonly string[],
): boolean {
  if (!host || host.includes(",") || host.includes("/") || /[\\\s@?#]/.test(host)) return false;
  try {
    const parsed = new URL("https://" + host);
    if (parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isIP(hostname)) return true;
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(hostname)) return true;
    return configuredHosts.some(
      (x) =>
        x
          .trim()
          .replace(/^\[|\]$/g, "")
          .toLowerCase() === hostname,
    );
  } catch {
    return false;
  }
}
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  configuredOrigins: ReadonlySet<string>,
): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin)
      return false;
    return (
      parsed.host.toLowerCase() === String(host || "").toLowerCase() ||
      configuredOrigins.has(origin)
    );
  } catch {
    return false;
  }
}
export function applyCors(req: IncomingMessage, res: ServerResponse, origins: ReadonlySet<string>) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req.headers.host, origins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Last-Event-ID,Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  }
}
