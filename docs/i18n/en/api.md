# API reference

The console's endpoint reference is generated during build from `src/http/api-contract.ts`, the catalogue used by the HTTP router. Run `npm run build:openapi` to write `docs/openapi.json` and `docs/openapi-demo.json` in your checkout, or download `/api/openapi.json` from a running instance. See [OpenAPI maintenance](../../openapi.md) for the source/output relationship.

Management routes use `/api`. Demo sender routes use `/demo` on the main listener, or unprefixed paths on the separate demo listener; they have their own OpenAPI contract. SMTP/STARTTLS/SMTPS are described in the [integration guide](integration.md), not as HTTP routes.

The runtime-generated API page includes methods, parameters, schemas, status codes, SSE events and security requirements. Admin writes require HTTPS and a bearer `ADMIN_TOKEN`. `204` has no JSON body. Messages are non-consuming, ephemeral and subject to quotas.
