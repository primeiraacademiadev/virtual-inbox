/** HTTP transport helpers kept independent of server lifecycle and protocol adapters. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { Fault } from "../core.js";
import { config } from "../config.js";

const frontendRoot = resolve(process.cwd(), "web/dist");

export function serveFrontend(req: IncomingMessage, res: ServerResponse, pathParts: string[]) {
  if (!existsSync(join(frontendRoot, "index.html"))) return false;
  const candidate = resolve(frontendRoot, "." + sep + pathParts.join(sep));
  const safe = candidate === frontendRoot || candidate.startsWith(frontendRoot + sep);
  if (!safe) return false;
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate : join(frontendRoot, "index.html");
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".ico": "image/x-icon",
  };
  res.writeHead(200, {
    "Content-Type": mime[extname(file)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(readFileSync(file));
  return true;
}

export function errorCode(status: number, message: string): string {
  const text = message.toLowerCase();
  if (text.includes("inbox not found")) return "INBOX_NOT_FOUND";
  if (text.includes("message not found")) return "MESSAGE_NOT_FOUND";
  if (text.includes("ttl")) return "INVALID_TTL";
  if (text.includes("expired")) return "RECIPIENT_EXPIRED";
  if (text.includes("certificate") || text.includes("pem")) return "TLS_CERTIFICATE_INVALID";
  return ({ 413: "MESSAGE_TOO_LARGE", 403: "FORBIDDEN", 409: "CONFLICT",
    507: "CAPACITY_EXCEEDED", 404: "RESOURCE_NOT_FOUND", 400: "INVALID_REQUEST" } as Record<number, string>)[status]
    || "INTERNAL_ERROR";
}

export function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, (key, value) => key === "content" && Buffer.isBuffer(value) ? undefined : value));
}

export async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > config.httpBytes) throw new Fault(413, "Payload too large");
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Fault(400, "Invalid JSON"); }
}

export function sse(res: ServerResponse, event: string, data: unknown, id?: string) {
  if (res.writableEnded) return;
  res.write((id ? "id: " + id + "\n" : "") + "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
}
