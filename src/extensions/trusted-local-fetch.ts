/**
 * TLS-verified transport for the bundled adapter's call to the same public HTTP
 * API as any other client. Does not disable certificate or host verification.
 *
 * The server connects to its own listening interface, not to a new/private API.
 * Trust material is provided on each request so certificate rotation is picked up.
 */
import { request as httpsRequest } from "node:https";

export type LocalTlsTrust = {
  ca: string | Buffer;
  /** Expected certificate DNS name, which can differ from the listening IP. */
  servername: string;
};

export function createVerifiedLocalFetch(
  origin: URL,
  trust: () => LocalTlsTrust,
): typeof globalThis.fetch {
  if (origin.protocol !== "https:") throw new TypeError("Expected an HTTPS public API origin");
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.origin !== origin.origin || url.protocol !== "https:") {
      throw new TypeError("Local HTTPS transport cannot access an unrelated origin");
    }
    const { ca, servername } = trust();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const payload = init?.body;
    if (payload !== undefined && typeof payload !== "string") {
      throw new TypeError("Only JSON text request bodies are supported");
    }
    return await new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(url, {
        method: init?.method ?? "GET", headers,
        ca, servername, rejectUnauthorized: true,
      }, response => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) {
            request.destroy(new Error("Public API response exceeds the local transport limit"));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 502;
          const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);
          const resultHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) resultHeaders.append(key, item);
            else if (value !== undefined) resultHeaders.set(key, String(value));
          }
          resolve(new Response(body, { status, headers: resultHeaders }));
        });
      });
      request.on("error", reject);
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) request.destroy(new Error("Local HTTPS request aborted"));
        else signal.addEventListener("abort",
          () => request.destroy(new Error("Local HTTPS request aborted")), { once: true });
      }
      request.end(payload);
    });
  };
}
