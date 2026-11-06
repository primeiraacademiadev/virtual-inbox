# Extensions

The Virtual Inbox console discovers extensions using the **read-only public registry** at `GET /api/extensions`.

Open **System → Extensions** to inspect loaded, failed and disabled modules. Each entry shows its capabilities, active HTTP route mappings, invocation counts, error counts, cumulative duration and last response status. The list refreshes every 15 seconds and can be refreshed manually. These are in-memory metrics; restarting VI resets them.

Select **View this extension's logs** to open the main log console with an `extensionId` server-side filter. To isolate matching extension requests, the anomaly filter is turned off. The log shows the route template, status, duration and a correlation ID but never provider request bodies or secrets.

The bundled `sms-native` extension is enabled by default. It owns the two existing demo entry points: `POST /demo/sms/messages` on the main listener and `POST /sms/messages` on the dedicated demo listener. It invokes the shared functional `POST /api/sms/ingestions` public API. To disable only the sender, set `VI_SMS_NATIVE_ENABLED=false` and restart; the registry then shows it as disabled.

Other trusted ESM extensions may be listed via `VI_EXTENSIONS`. A failed module appears as `failed-N` with a sanitized diagnostic. The console does not install modules, display provider-specific forms, load third-party scripts, or modify server configuration.

See the [integration guide](integration.md), [SDK documentation](sdk.md), and [architecture](architecture.md) for further information. Extensions can reference a local guide in their manifest; only documentation known to exist in the console can be opened as a navigation link. Unknown paths appear as text instead of broken links.
