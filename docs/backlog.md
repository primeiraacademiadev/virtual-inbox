# Supported scope and limitations

This page describes product boundaries, not an execution checklist. Current usage instructions are in the localized guides linked from README.

Messages, inboxes, observers and logs are memory-only. Configuration and TLS material persist. SMTP/STARTTLS/SMTPS receive email; SMS is simulated over HTTP. Message APIs are deliberately unauthenticated and require a trusted network. Observer subscriptions do not enforce tenant isolation.

TLS leaf renewal checks run at startup and SAN management, not periodically during a long-running process. A local CA needs explicit client trust and lifecycle planning. Configuration of hosts/ports requires listener restart. External certificate files are watched approximately every ten seconds while selected.

OpenAPI covers HTTP operations, including SSE content type and event descriptions. It does not describe SMTP as HTTP and does not automatically validate every runtime JSON body. The shared catalogue and build checks prevent missing route metadata; behavioral contracts remain tested separately.

Docker smoke and managed process E2E are separate checks. No throughput benchmark, multi-node deployment or persistent message-store guarantee is implied by the test suite.
