# Generated OpenAPI and documentation

## Source and outputs

`src/http/api-contract.ts` is the versioned catalogue of HTTP method/path pairs, operation identifiers, security declarations, parameters and JSON schemas. `src/server.ts` resolves requests through that catalogue before dispatching the operation. This avoids maintaining a separate, disconnected route list solely for documentation.

Run `npm run build:openapi` to generate:

- `docs/openapi.json`: management REST/SSE contract, OpenAPI 3.1.0.
- `docs/openapi-demo.json`: the separate HTTP demo sender contract.
- `web/public/openapi.json` and `web/public/openapi-demo.json`: distribution files.
- `web/public/wiki/{pt-PT,en,fr}/api.md`: localized endpoint references.

These generated files are build artifacts, not hand-edited specifications. The versioned source stays in this repository; a source checkout produces the JSON locally. Both contracts are also available directly from a running service at `/api/openapi.json` and `/api/openapi-demo.json`, independent of whether the frontend was built. The console exposes downloads in its documentation.

`npm run build` invokes generation before compilation. The console prebuild also regenerates the reference before building its search index. Docker builds run the same process.

## Change procedure

Add or change an operation in the catalogue, implement its handler in the server switch, update request/response schemas and examples, and add contract/integration tests. The generator checks duplicate identifiers, unresolved local schema references, and the equality of declared operation IDs and server handler IDs. It fails the build on divergence. This protects the route inventory; it is not a substitute for behavioral tests or full JSON Schema validation at runtime.

Path parameters use stable UUIDs. JSON property names, error codes and operation IDs are never translated. The OpenAPI document is written in English; the console's surrounding reference text is localized. SSE uses `text/event-stream`, with event names documented in an extension and the guides. SMTP/STARTTLS/SMTPS are not part of OpenAPI.

## Importing into clients

Start the service, download `/api/openapi.json` and import the JSON into an OpenAPI-capable client. Its server URL `/api` is relative to the service origin; set the full base URL in tools that cannot resolve relative servers. Administrative operations additionally require a trusted HTTPS endpoint and an `ADMIN_TOKEN` bearer value. Do not enable an insecure certificate bypass.

For simulated inbound SMS use the demo contract and `/demo` on the main origin, or use `/sms/messages` on the separate demo listener. The console API page deliberately does not mix these operations with management routes.
