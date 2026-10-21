# Manual QA and demonstration

## User interface

The left navigation can collapse to an icon rail. It contains two independently collapsible groups, **Inboxes — Email** and **Inboxes — SMS**, each with a **+** create/attach button and unread badges. At the bottom is **Live Logs**.

Selecting a mailbox or phone number maximizes its pane; clicking that same entry again returns to split view (inbox over logs). Clicking **Live Logs** maximizes logs; clicking again returns to split view. Collapsing the navigation preserves panel state.

The circular **+** inside a selected inbox opens a contextual composer. Its destination is fixed to that inbox, and the composer can be collapsed. Email accepts From, Subject and Body; SMS accepts From and Body.

## Create or observe an inbox

Click **+** in either group. A single identifier input automatically detects an email address or an international-format SMS number; it rejects invalid input. Leave blank to generate a random recipient of the group from which you opened the dialog.

If the identifier exists, it is attached to the current GUID observer session, without touching its TTL. If absent, the console asks for confirmation before creating it. The round **⏱** control reveals TTL in seconds; default 1800, accepted range 1..604800. TTL only applies when *creating*, not when observing.

Each console's observation session is identified by a GUID issued by the server over SSE and retained within the browser tab (sessionStorage). The backend maintains the inbox list associated with that GUID; reconnections announce monitored inboxes and resume notifications.

## Self-send

For email, the backend demo endpoint uses SMTP to deliver back to the selected inbox. For SMS, the console calls the sandbox's HTTP gateway. This deliberately exercises the protocol adapters.

## Failure and anomaly demonstration

Send an SMS to an unregistered phone number:

```sh
curl -X POST http://127.0.0.1:3000/sms/messages -H 'content-type: application/json' -d '{"from":"+351911111111","to":"+351922222222","body":"Unexpected SMS"}'
```

The SMS system inbox `+999000000000` receives the message, recording `captureReason=UNKNOWN_RECIPIENT`. An expired inbox produces `EXPIRED_RECIPIENT`, provided the resource has not yet been swept from the store; see documented limitation.
