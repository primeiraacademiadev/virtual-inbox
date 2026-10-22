# Try Virtual Inbox — guided walkthrough

**Audience:** someone experimenting with the product, without integrating a separate application.

## Before you start

Install Node.js 24+ and OpenSSL, follow the [README startup steps](../README.md), and open the console. If using generated local HTTPS, trust the **public CA certificate** before opening the HTTPS site; use the Vite HTTP development console if you prefer to avoid this initial browser trust step in local development.

## Walkthrough A: email

1. Choose **Inboxes**, expand **Inboxes — Email**, and press **+**. With the identifier empty, the app creates a random mailbox. The ⏱ control sets its TTL.
2. Click the mailbox in the sidebar. Press the floating **+** inside the inbox to compose.
3. Enter a sender and subject. Optionally select one or more attachments, then press **Enviar**.
4. This does not inject directly into storage: the browser calls the **demo API** on port 3001/3444, whose Nodemailer client sends to the sandbox SMTP receiver on port 2525.
5. Select the received message to inspect it. Download attached files through their links. Review events in **Live Logs**.

## Walkthrough B: SMS

1. Add a random SMS number in **Inboxes — SMS**, or enter an E.164 number such as `+351900000001`.
2. Use the floating **+** to send to the selected recipient.
3. The browser calls the **demo SMS API**, not a mobile carrier. The received message appears in that inbox.

## Existing recipients and unexpected traffic

Entering an **existing** identifier attaches it to your current observer session without changing TTL. If the identifier is missing, the console asks whether to create it. Unknown/expired destinations are diverted into system anomaly inboxes, which cannot be deleted.

## Navigation

- Inboxes and Live Logs have independent scrolling; selecting an inbox enlarges it, clicking it again returns to the split view.
- The composer overlays the workspace, with its own scroll, rather than pushing Live Logs downward.
- The collapsed sidebar exposes contextual tools via hover or keyboard focus. Touch behavior still needs acceptance testing.
- A GUID observer session persists across SSE reconnections within the current browser tab; creating a different tab creates an independent session.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Can't open HTTPS console | OpenSSL generated a local CA; import its **public** certificate into a trust store, or use Vite HTTP locally |
| SMTP message not received | Server is running, recipient is registered, destination host/port are correct |
| Email demo send fails | Demo listener reachable on 3001/3444, SMTP listener available on 2525 |
| No SMS appears | The mock expects HTTP POST to demo listener; SMS is not sent via telephone network |
| Inbox disappeared | TTL elapsed or server restarted; all state is ephemeral |

See [Integration](integration.md) if you want to connect a real application instead of sending from the demo console.
