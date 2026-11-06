/** Embedded Extension Host. Trusted local ESM only; no IPC, network listeners or privileged APIs. */
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Audience, HttpMethod, ExtensionApp, ExtensionRequest, ExtensionResponse, RouteDescriptor } from "../extension-sdk/src/index.js";
import { operations } from "./http/api-contract.js";

interface ModuleDefinition {
  id: string;
  version: string;
  app: ExtensionApp;
}
interface HostedExtension extends ModuleDefinition {
  routes: readonly RouteDescriptor[];
}
export interface ExtensionDiagnostic {
  source: string;
  id?: string;
  error: string;
}
export interface ExtensionDispatchResult {
  extensionId: string;
  response: ExtensionResponse;
}
const SEGMENT = /^\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_REQUEST_MS = 10_000;

function portions(path: string): string[] {
  return path.split("/").filter(Boolean);
}
function overlaps(a: string, b: string): boolean {
  const aa = portions(a), bb = portions(b);
  return aa.length === bb.length &&
    aa.every((segment, i) => SEGMENT.test(segment) || SEGMENT.test(bb[i]!) || segment === bb[i]);
}
function validRoute(route: RouteDescriptor): void {
  if (!["demo", "management"].includes(route.audience) ||
      !["GET", "POST", "PUT", "DELETE"].includes(route.method) ||
      typeof route.handlerId !== "string" || !route.handlerId ||
      typeof route.path !== "string" || !route.path.startsWith("/") ||
      route.path.startsWith("//") || (route.path.length > 1 && route.path.endsWith("/")) ||
      route.path.includes("//") || route.path.includes("?") || route.path.includes("#") ||
      route.path.includes("%") || route.path.includes("\\") ||
      portions(route.path).some((part) => part.includes("*") || part.includes("{") && !SEGMENT.test(part))) {
    throw new Error("Invalid extension route declaration");
  }
  // No catch-all or interference with VI's reserved root namespaces.
  if (route.path === "/" || /^\/(?:api|demo|admin)(?:\/|$)/.test(route.path)) {
    throw new Error("Reserved VI route namespace");
  }
}
function matchesPattern(pattern: string, path: string): boolean {
  const patternParts = portions(pattern), actual = portions(path);
  return patternParts.length === actual.length &&
    patternParts.every((part, i) => SEGMENT.test(part) || part === actual[i]);
}
function normalizeRequestPath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("#")) return null;
  const pathname = path.split("?", 1)[0]!;
  if (pathname.includes("//") || (pathname.length > 1 && pathname.endsWith("/"))) return null;
  let parts: string[];
  try {
    parts = portions(pathname).map((part) => decodeURIComponent(part));
  } catch { return null; }
  if (parts.some((part) => !part || part.includes("/") || part.includes("\\") ||
      part === "." || part === "..")) return null;
  return "/" + parts.join("/");
}
function safeResponse(response: ExtensionResponse): ExtensionResponse {
  if (!response || !Number.isInteger(response.status) ||
      response.status < 200 || response.status > 599 || response.status === 205) {
    throw new Error("Invalid extension response status");
  }
  const headers: Record<string,string> = {};
  for (const [rawKey, rawValue] of Object.entries(response.headers ?? {})) {
    const key = rawKey.toLowerCase();
    // Limit output header surface: no transfer-encoding, cookies, content-length or control headers.
    if (!/^x-[a-z0-9-]{1,70}$/.test(key) && key !== "cache-control") {
      throw new Error("Unsupported extension response header");
    }
    if (typeof rawValue !== "string" || rawValue.length > 2048 || /[\r\n]/.test(rawValue)) {
      throw new Error("Invalid extension response header");
    }
    headers[key] = rawValue;
  }
  if (response.body !== undefined) {
    const encoded = JSON.stringify(response.body);
    if (encoded === undefined || Buffer.byteLength(encoded) > 1024 * 1024) {
      throw new Error("Invalid extension response body");
    }
  }
  return { status: response.status, headers, ...(response.body === undefined ? {} : { body: response.body }) };
}

export class ExtensionHost {
  private active: readonly HostedExtension[] = [];
  readonly errors: ExtensionDiagnostic[] = [];

  list(): ReadonlyArray<{ id: string; version: string; routes: readonly RouteDescriptor[] }> {
    return this.active.map(({ id, version, routes }) => ({ id, version, routes }));
  }
  register(definition: ModuleDefinition): void {
    if (!definition || !ID.test(definition.id) || typeof definition.version !== "string" ||
        !definition.version || !definition.app ||
        typeof definition.app.routes !== "function" || typeof definition.app.dispatch !== "function") {
      throw new Error("Invalid extension module export");
    }
    const routes = definition.app.routes();
    if (!Array.isArray(routes) || routes.length === 0) throw new Error("Extension must publish at least one route");
    if (this.active.some((extension) => extension.id === definition.id)) {
      throw new Error("Duplicate extension ID: " + definition.id);
    }
    for (const [index, route] of routes.entries()) {
      validRoute(route);
      // Explicit one-time ownership transfer of the existing demo sender route.
      // Its OpenAPI catalogue entry stays published, while the built-in
      // extension becomes the only runtime handler. Third-party extensions
      // never receive this exemption.
      const nativeSmsTransfer = definition.id === "sms-native" &&
        route.audience === "demo" && route.method === "POST" &&
        route.path === "/sms/messages";
      const conflicting = [
        ...operations.filter((r) => r.audience === route.audience && r.method === route.method &&
          !(nativeSmsTransfer && r.id === "sendSms")),
        ...this.active.flatMap((ext) => ext.routes).filter((r) =>
          r.audience === route.audience && r.method === route.method),
        ...routes.slice(0, index).filter((r) =>
          r.audience === route.audience && r.method === route.method),
      ].find((existing) => overlaps(existing.path, route.path));
      if (conflicting) throw new Error(`Extension route conflict: ${route.method} ${route.path} with ${conflicting.path}`);
    }
    // The public route table is changed only after *all* route checks succeed.
    this.active = [...this.active, { ...definition, routes: routes.map((route) => ({ ...route })) }];
  }
  async loadFiles(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      try {
        if (typeof path !== "string" || !path || ![".js", ".mjs"].includes(extname(path))) {
          throw new Error("Expected local .js or .mjs extension module");
        }
        const file = resolve(path);
        const module = await import(pathToFileURL(file).href) as { default?: ModuleDefinition };
        this.register(module.default!);
      } catch (error) {
        this.errors.push({ source: String(path), error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  hasRoute(audience: Audience, method: HttpMethod, path: string): boolean {
    const pathname = normalizeRequestPath(path);
    return pathname !== null && this.active.some((ext) => ext.routes.some((route) =>
      route.audience === audience && route.method === method && matchesPattern(route.path, pathname)));
  }
  async dispatch(request: ExtensionRequest): Promise<ExtensionDispatchResult | null> {
    const pathname = normalizeRequestPath(request.path);
    if (pathname === null) return null;
    const found = this.active.find((ext) => ext.routes.some((route) =>
      route.audience === request.audience && route.method === request.method &&
      matchesPattern(route.path, pathname)));
    if (!found) return null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        found.app.dispatch(request),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Extension request timeout")), MAX_REQUEST_MS);
          timeout.unref();
        }),
      ]);
      if (!response) throw new Error("Registered extension did not dispatch the request");
      return { extensionId: found.id, response: safeResponse(response) };
    } finally { if (timeout) clearTimeout(timeout); }
  }
}

export function configuredExtensionFiles(value: string | undefined): string[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("VI_EXTENSIONS must be a JSON array of local JavaScript module paths"); }
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string" || !v)) {
    throw new Error("VI_EXTENSIONS must be a JSON array of local JavaScript module paths");
  }
  return parsed;
}
