/**
 * Application SDK for trusted Virtual Inbox HTTP extensions.
 *
 * No sockets or privileged VI core functions are exposed here. The Extension Host
 * owns publication; dispatch() executes one matched route in-process for V1.
 * Request/response data must remain JSON-compatible for a future IPC transport.
 */
export type Audience = "management" | "demo";
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ExtensionRequest {
  method: HttpMethod;
  path: string;
  audience: Audience;
  headers?: Record<string, string>;
  body?: JsonValue;
  correlationId?: string;
}
export interface ExtensionResponse {
  status: number;
  headers: Record<string, string>;
  body?: JsonValue;
}
export interface RequestContext {
  request: ExtensionRequest & { path: string; headers: Record<string, string> };
  params: Record<string, string>;
  query: Record<string, string>;
  response: ExtensionResponse;
  /** Per-request scratch state. Not serialized into the response. */
  state: Record<string, unknown>;
}
export type Next = () => Promise<void>;
export type Middleware = (context: RequestContext, next: Next) => void | Promise<void>;
export type Handler = (context: RequestContext) => void | Promise<void>;
export interface RouteDescriptor {
  method: HttpMethod;
  audience: Audience;
  path: string;
  handlerId: string;
}
export interface RouteOptions { audience?: Audience }
export interface ExtensionApp {
  use(middleware: Middleware): ExtensionApp;
  use(prefix: string, middleware: Middleware): ExtensionApp;
  get(path: string, handler: Handler, options?: RouteOptions): ExtensionApp;
  post(path: string, handler: Handler, options?: RouteOptions): ExtensionApp;
  put(path: string, handler: Handler, options?: RouteOptions): ExtensionApp;
  delete(path: string, handler: Handler, options?: RouteOptions): ExtensionApp;
  routes(): readonly RouteDescriptor[];
  /** Null denotes a route miss: the Host decides whether to serve the console or 404. */
  dispatch(request: ExtensionRequest): Promise<ExtensionResponse | null>;
}

interface RegisteredRoute extends RouteDescriptor {
  segments: readonly string[];
  handler: Handler;
}
interface RegisteredMiddleware {
  prefix: string;
  middleware: Middleware;
}
const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "DELETE"];

function assertAudience(value: Audience): void {
  if (value !== "demo" && value !== "management") throw new TypeError("Invalid extension audience");
}

function segments(path: string, registration: boolean): string[] {
  if (typeof path !== "string" || !path.startsWith("/") ||
      (path.length > 1 && path.endsWith("/")) || path.includes("//") ||
      path.includes("?") || path.includes("#") || path.includes("\\")) {
    throw new TypeError("Extension paths must be canonical absolute paths");
  }
  if (path === "/") return [];
  const parts = path.slice(1).split("/");
  return parts.map((part) => {
    if (!part) throw new TypeError("Empty path segment");
    if (registration) {
      if (/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(part)) return part;
      if (/[{}*%]/.test(part)) throw new TypeError("Unsupported route segment");
      return part;
    }
    let decoded: string;
    try { decoded = decodeURIComponent(part); }
    catch { throw new TypeError("Invalid URL encoding"); }
    if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
      throw new TypeError("Invalid request path segment");
    }
    return decoded;
  });
}

function match(route: readonly string[], actual: readonly string[]): Record<string, string> | null {
  if (route.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < route.length; i++) {
    const part = route[i]!;
    if (part.startsWith("{")) params[part.slice(1, -1)] = actual[i]!;
    else if (part !== actual[i]) return null;
  }
  return params;
}

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, i) =>
    part.startsWith("{") || b[i]!.startsWith("{") || part === b[i]);
}

function prefixMatches(prefix: string, path: string): boolean {
  return prefix === "/" || path === prefix || path.startsWith(prefix + "/");
}

function parsePath(path: string): { pathname: string; query: Record<string, string> } {
  // A relative path is mandatory; a full URL must never influence routing.
  if (!path.startsWith("/") || path.startsWith("//")) throw new TypeError("Invalid request path");
  const url = new URL(path, "http://extension.invalid");
  if (url.origin !== "http://extension.invalid") throw new TypeError("Invalid request origin");
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  return { pathname: url.pathname, query };
}

export function createApp(): ExtensionApp {
  const routes: RegisteredRoute[] = [];
  const middleware: RegisteredMiddleware[] = [];
  let sequence = 0;

  function addRoute(method: HttpMethod, path: string, handler: Handler, options: RouteOptions = {}): ExtensionApp {
    if (typeof handler !== "function") throw new TypeError("Route handler must be a function");
    const audience = options.audience ?? "demo";
    assertAudience(audience);
    const parts = segments(path, true);
    if (routes.some((existing) => existing.audience === audience && existing.method === method &&
        overlaps(existing.segments, parts))) {
      throw new Error(`Ambiguous extension route: ${audience} ${method} ${path}`);
    }
    routes.push({ method, audience, path, handler, segments: parts, handlerId: `handler-${++sequence}` });
    return app;
  }

  const app: ExtensionApp = {
    use(first: string | Middleware, second?: Middleware): ExtensionApp {
      const prefix = typeof first === "string" ? first : "/";
      const fn = typeof first === "string" ? second : first;
      if (typeof fn !== "function") throw new TypeError("Middleware must be a function");
      segments(prefix, true);
      if (prefix.includes("{")) throw new TypeError("Middleware prefix cannot contain route parameters");
      middleware.push({ prefix, middleware: fn });
      return app;
    },
    get: (p, h, o) => addRoute("GET", p, h, o),
    post: (p, h, o) => addRoute("POST", p, h, o),
    put: (p, h, o) => addRoute("PUT", p, h, o),
    delete: (p, h, o) => addRoute("DELETE", p, h, o),
    routes: () => routes.map(({ method, audience, path, handlerId }) =>
      Object.freeze({ method, audience, path, handlerId })),
    async dispatch(request: ExtensionRequest): Promise<ExtensionResponse | null> {
      if (!METHODS.includes(request.method)) throw new TypeError("Unsupported HTTP method");
      assertAudience(request.audience);
      const { pathname, query } = parsePath(request.path);
      const requestParts = segments(pathname, false);
      let selected: RegisteredRoute | undefined;
      let params: Record<string, string> | null = null;
      for (const route of routes) {
        if (route.method !== request.method || route.audience !== request.audience) continue;
        const found = match(route.segments, requestParts);
        if (found !== null) { selected = route; params = found; break; }
      }
      if (!selected || params === null) return null;
      const context: RequestContext = {
        request: { ...request, path: pathname, headers: { ...(request.headers ?? {}) } },
        params, query, response: { status: 204, headers: {} }, state: {},
      };
      const handler = selected.handler;
      const pipeline: Middleware[] = [
        ...middleware.filter((m) => prefixMatches(m.prefix, pathname)).map((m) => m.middleware),
        async (ctx) => handler(ctx),
      ];
      let index = -1;
      const invoke = async (i: number): Promise<void> => {
        if (i <= index) throw new Error("next() called more than once");
        index = i;
        const fn = pipeline[i];
        if (fn) await fn(context, () => invoke(i + 1));
      };
      await invoke(0);
      const { status, headers, body } = context.response;
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new TypeError("Invalid extension response status");
      }
      return { status, headers: { ...headers }, ...(body === undefined ? {} : { body }) };
    },
  };
  return app;
}
