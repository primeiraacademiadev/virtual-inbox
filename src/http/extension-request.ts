/** Adapt a bounded HTTP request to the Extension Host's JSON-compatible logical contract. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Audience, HttpMethod, JsonValue } from "../../extension-sdk/src/index.js";
import { ExtensionHost } from "../extension-host.js";
import { body } from "./server-helpers.js";

function publicHeaders(source: IncomingMessage["headers"]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || !value) continue;
    // Do not pass cookies or credentials into unrelated extension middleware by default.
    if (name === "authorization" || name === "cookie" || name === "proxy-authorization") continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

/**
 * Returns false when the request does not match an extension route.
 * Caller must have run existing Host/Origin/CORS and OPTIONS handling first.
 * Throws ordinary errors for the existing HTTP error boundary to translate.
 */
export async function tryExtensionRequest(
  req: IncomingMessage, res: ServerResponse, host: ExtensionHost,
  audience: Audience, logicalPath: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return false;
  if (!host.hasRoute(audience, method as HttpMethod, logicalPath)) return false;
  // Parse only after route resolution, to preserve empty/non-extension paths and body semantics.
  const payload = method === "GET" ? undefined : await body(req) as JsonValue;
  const request = {
    method: method as HttpMethod,
    audience,
    path: logicalPath,
    headers: publicHeaders(req.headers),
    ...(payload === undefined ? {} : { body: payload }),
    correlationId: randomUUID(),
  };
  let result;
  try { result = await host.dispatch(request); }
  catch (error) {
    const message = error instanceof Error && error.message === "Extension request timeout"
      ? "Extension request timeout" : "Extension request failed";
    const code = message === "Extension request timeout" ? "EXTENSION_TIMEOUT" : "EXTENSION_FAILED";
    res.writeHead(message === "Extension request timeout" ? 504 : 502,
      { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message, errorCode: code, errorParams: {} }));
    return true;
  }
  if (!result) return false;
  const { status, headers, body: data } = result.response;
  if (status === 204 || status === 304) {
    res.writeHead(status, headers);
    res.end();
  } else {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(data === undefined ? "" : JSON.stringify(data));
  }
  return true;
}
