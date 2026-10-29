# Try the console

Start the application using [Start here](overview.md), then open `http://127.0.0.1:3000`. The hamburger menu opens Workspace, Connections and TLS, Documentation and API. Change language using the language selector; technical identifiers remain unchanged.

## Create or attach an inbox

Use the add control in the email or SMS sidebar group. Leave the identifier empty to generate an address. Enter an address to attach an existing inbox; if none exists, confirm creation. Format selects email/SMS automatically. The flag changes the identity locale, the strategy selects the email pattern, the country-code toggle controls telephone prefixes and SAFE selects synthetic data. The clock reveals TTL in seconds. Choices persist per browser tab, except the identifier.

The identifier used by REST is the returned UUID, not the email/telephone address. Copy controls provide feedback. Removing an observer subscription does not necessarily delete the underlying inbox; confirm the deletion action when requested.

## Send and inspect

Select an inbox and open the compose control. Send to that same inbox. Email goes through the local SMTP listener; SMS is captured through the demo HTTP route. No external carrier is used. Inspect message details and attachment metadata; downloads preserve the original bytes. Read/unread badges belong to the console view, not a consuming API queue.

The log panel can be minimized, shown below the inbox or expanded. The sidebar also collapses. Open Documentation for procedures and API for the generated endpoint catalogue. If no message arrives, inspect the logs and system inbox `anomalies@sandbox.test` (email) or `+999000000000` (SMS). Sending to an unregistered inbox **does not create it or fail for that reason**: it is accepted into anomalies, subject to quotas. Inspect `originalRecipient` and `captureReason` (`UNKNOWN_RECIPIENT` / `EXPIRED_RECIPIENT`). See [Integration](integration.md) for REST lookup by UUID.

## Expected errors

`404`: inbox/session expired or absent. `409`: address already exists. `413`: message or attachment too large. `507`: global capacity exhausted. Delete test data or increase the relevant limit deliberately. A page reload can reattach to an existing observer; after server restart, create a new session and inbox because message data is not persisted.
