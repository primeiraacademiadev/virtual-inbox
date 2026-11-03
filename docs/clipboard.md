# Copy actions and user feedback

## Scope

Copy actions are implemented centrally in `web/src/components/clipboard/`:

- `clipboard.ts`: isolated Clipboard API adapter
- `CopyButton.tsx`: pending, successful, failed, and reset states; screen-reader live status
- `CopyMenu.tsx`: contextual groups of copyable values
- `clipboard.css`: self-contained styles

The app does not call `navigator.clipboard.writeText` directly.

## Where to copy

| Context | Available actions |
| --- | --- |
| Inbox header | Address, UUID, messages API endpoint |
| Collapsed inbox navigation | Address, UUID, messages API endpoint |
| Observer session header | Full observer GUID |
| Selected message | Message UUID, sender and original recipient |
| Connections / TLS | Host, HTTPS URL, SMTP and SMTPS host:port, settings field values, certificate SHA-256 fingerprint |

A successful write changes the button label to **✓ Copiado!** for 2.2 seconds; a rejection says **Falha ao copiar**. The result is announced through `aria-live`. The UI never shows success until the Clipboard API promise resolves. Values are never logged or saved.

Browser secure-context and clipboard permission rules apply; in unsupported contexts, the control reports failure instead of suggesting that copying succeeded. Private keys and administrator tokens are **never offered for copying**.

## Validation handoff

Verify both expanded and collapsed sidebar, keyboard and touch activation, blocked clipboard permissions, changing active inbox during success feedback, HTTPS and local HTTP browsers, small-screen menu positioning and assistive-technology announcements.
