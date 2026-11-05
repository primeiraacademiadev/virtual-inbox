# SMTP simulation scopes, selectors and protocol failures

> **Test sandbox only.** All addresses and credentials must be synthetic. The in-memory rule store is per Virtual Inbox process, without multi-tenant authorization. The administration endpoints for resolving credentials and creating rules require HTTPS + `ADMIN_TOKEN`.

## Scope is not a client identity

A connection (`smtpSessionId`) and an origin (remote IP) are known when SMTP accepts TCP. Credentials (username + password) are first available when the remote endpoint executes `AUTH`; an EHLO name, MAIL FROM address and recipient arrive in later separate phases. SMTP does **not** expose a canonical client ID. The historical `clientId` is retained for existing consumers; it is not the root of a hierarchy and is not available in pre-authentication AUTH rules.

There are **two independent rule collections**:
- **SPECIFIC:** `selectors` contains at least one key.
- **GLOBAL:** `selectors` is missing or `{}`.

The scope is **derived by the server**, returned as `scope`, and **not** a client-supplied field.

### Exact matching semantics

1. **All specified selectors are ANDed**. No hierarchy of credentials, origins or sessions is assumed.
2. **Omitted selector = no restriction**. Do not send `"*"`: wildcards are not a supported syntax.
3. First search **SPECIFIC** eligible rules for the command's phase. Only if **none** matches and has `remaining > 0`, search **GLOBAL** eligible rules.
4. Within each scope, the **largest explicit integer `priority` wins** (`-10000..10000`; default `0`). Equal priority: **earliest inserted wins**.
5. Consume **one** rule atomically per event: decrement its `remaining` before replying. If no rule applies, execute the normal SMTP behavior.
6. A selector requiring a value **not yet known at the chosen phase** is rejected at rule creation, not silently ignored.

**Absolute scope precedence:** a SPECIFIC AUTH rule with `priority: 1` takes precedence over a GLOBAL AUTH rule with `priority: 100`. Once the specific rule is exhausted, the next matching specific rule (if any) is considered; otherwise the global rule becomes eligible.

For a simple global AUTH reply:

```json
{
  "phase": "AUTH",
  "action": "reply",
  "code": 535,
  "remaining": 2,
  "priority": 100
}
```

For **any credentials** presented from a specific IP, **omit credentials**:

```json
{
  "phase": "AUTH",
  "selectors": { "origin": { "ip": "10.1.1.53" } },
  "action": "reply",
  "code": 454,
  "remaining": 3,
  "priority": 1
}
```

These two rules do not conflict: AUTH from `10.1.1.53` receives `454` three times; other AUTH attempts use the global `535` rule until it is exhausted. Only one response is sent per command. A rule matching both IP and credentials is **more constrained**, not automatically higher priority than another specific rule; the explicit `priority` controls their order.

### Available selectors

| Selector | Meaning | Eligible phases in this delivery |
| --- | --- | --- |
| `origin.ip` | Remote IP, IPv4 or IPv6, normalized from IPv4-mapped IPv6 | CONNECT, EHLO, AUTH, MAIL, RCPT, DATA, AFTER_DATA |
| `credentialsId` | Opaque ID for the exact synthetic username+password pair resolved via the API | AUTH, MAIL, RCPT, DATA, AFTER_DATA |
| `smtpSessionId` | Single observed SMTP connection | CONNECT, EHLO, AUTH, MAIL, RCPT, DATA, AFTER_DATA |
| `clientId` | Legacy observed client correlation ID, not a credential identity | MAIL, RCPT, DATA, AFTER_DATA |
| `connection.port` | Local listener/destination TCP port, **not** ephemeral remote port | CONNECT, EHLO, AUTH, MAIL, RCPT, DATA, AFTER_DATA |
| `ehloName` | Hostname declared by the peer in HELO/EHLO, **not authenticated** | EHLO, AUTH, MAIL, RCPT, DATA, AFTER_DATA |
| `sender` | MAIL FROM envelope address | MAIL, RCPT, DATA, AFTER_DATA |
| `recipient` | RCPT TO envelope address | RCPT, DATA, AFTER_DATA |

This release supports **CONNECT** and **EHLO/HELO** reply, delay, drop, reset and hang rules, alongside AUTH reply rules (SMTP codes 400–599) and existing MAIL/RCPT/DATA/AFTER_DATA actions. `connection.port` is the **local SMTP listener port**; `remotePort` is diagnostic only. Inbox/SMS selectors remain separate work in #76.

### Resolve before AUTH

Call the new administrative endpoint `POST /api/admin/smtp/resolve` over HTTPS with the admin bearer token, before starting the connection:

```json
{
  "credentials": {
    "username": "communication-test@example.test",
    "password": "synthetic-password"
  },
  "origin": { "ip": "127.0.0.1" }
}
```

The body accepts **credentials**, **origin**, or **both**; it does not accept an empty object. A sample response, before any connection exists:

```json
{
  "credentials": {
    "id": "e4acf028-8eb1-4b23-a194-93a7c12a944e",
    "origins": [
      { "id": "195ea0ee-1fd4-44df-94b4-4fbda34abf8e",
        "ip": "127.0.0.1", "connections": [] }
    ]
  }
}
```

When only `origin` is provided, the result has a top-level `origins` array instead. Existing matching connections are grouped under their observed origins; credentials and origins are **independent relational dimensions**, not parent-child identities. A connection UUID is generated only when SMTP actually accepts TCP. The password is never returned, logged or included in the rule; the resolver and AUTH use the same process-local HMAC strategy. IDs are stable during the lifetime of a running instance, not across restarts.

To target that synthetic credential pair, place the returned ID into the rule's `selectors.credentialsId`. To affect all credentials from an IP, **do not** put `credentialsId` in the rule.

### Observability and diagnostics

A rule application emits a structured `smtp.simulation.applied` log record with `ruleId`, `scope`, `priority`, `phase`, `responseCode`, `smtpSessionId`, origin IP/ID, credential ID when known, and the matched selectors. Never log passwords, salts or raw credential digests. Use the ordinary log query/SSE filters for correlation. `remaining` is visible in the existing authenticated rule list endpoint.

### Important separation

- **AUTH** knows the presented credentials even if authentication will fail. The simulated error is checked **before normal credential validation**, so it is suitable for repeatable consumer retry tests.
- **CONNECT** cannot know a username/password, EHLO or recipient. **EHLO** knows a claimed hostname but not credentials. Rules specifying information unavailable in their phase are rejected with HTTP 400.
- **Inbox email** becomes available during RCPT; **SMS** has a distinct HTTP processing model. Those selectors belong to #76.
- An IP is not a verified logical client identity; multiple test processes may share it. **CONNECT** rules using origin/port cannot distinguish concurrent suites behind that address: use a dedicated VI instance. **EHLO** rules can distinguish a configured, synthetic `ehloName`; otherwise use a dedicated VI instance. Later phases can use credentials, sender or recipient when available.

## Connection reset and optional rule expiry

The `reset` action requests a **TCP RST** using the accepted raw socket, unlike `drop`, which destroys the connection without explicitly requesting a RST (the observed FIN/RST for `drop` can depend on the operating system). Neither action returns an SMTP status code, and both are distinct from `reply`. `reset` requires TCP transport support; if it is unavailable at the selected protocol phase, the fault cannot be applied. Transport-level reset behavior should be tested using real SMTP clients.

Rules optionally accept `ttlMs` between **1 and 86,400,000** milliseconds. The server returns an `expiresAt` timestamp for such rules; expired rules are excluded from selection and deleted lazily during rule creation, listing or selection. A rule with no TTL persists until deletion, exhaustion or process restart. TTL and `remaining` are independent: time expiry can happen before the last use, and an exhausted rule remains visible until deleted or expired. Use `withSmtpRule()` in the SDK for cleanup in a test's `finally` path.

## CONNECT and EHLO/HELO — real transport failure semantics

A **CONNECT** rule is evaluated after the TCP listener accepts a socket, **before the SMTP 220 banner**. This is not a SYN refusal: the TCP connection already exists. To provoke a genuine TCP connection refusal (`ECONNREFUSED`), stop the listener or use an unused port; no SMTP callback can send a response before TCP accept.

| Phase | Action | Observable behavior |
| --- | --- | --- |
| CONNECT | `reply` (`400..599`) | SMTP reply **before** 220, then connection rejected |
| CONNECT | `drop` | Socket destroyed without SMTP greeting (typically EOF/reset; OS and client dependent) |
| CONNECT | `hang` (`durationMs`) | No greeting until bounded timeout, then socket destroyed |
| CONNECT | `delay` (`durationMs`, optional code) | Defer 220 greeting or defer rejection; code sends error before greeting |
| EHLO / HELO | `reply` (`400..599`) | Normal 220 greeting, then error reply to EHLO/HELO |
| EHLO / HELO | `drop` | Destroy socket during negotiation |
| EHLO / HELO | `hang` (`durationMs`) | No EHLO reply until timeout, then disconnect |
| EHLO / HELO | `delay` (`durationMs`, optional code) | Delay EHLO response; with code, reject after delay |

The actual Nodemailer error classification varies by SMTP phase, client and server reply. A `421` EHLO reply terminates the SMTP session; for other 4xx/5xx codes Nodemailer may retry with HELO. This simulator applies EHLO rules to **both** greeting commands, subject to the rule's `remaining`.

Example: refuse the next two connections to the SMTP listener on port 2525:

```json
{
  "phase": "CONNECT",
  "action": "reply",
  "code": 421,
  "remaining": 2,
  "selectors": { "connection": { "port": 2525 } }
}
```

Example: reject the EHLO greeting **only** when the client declares a given hostname, from the given origin:

```json
{
  "phase": "EHLO",
  "action": "reply",
  "code": 421,
  "remaining": 1,
  "selectors": {
    "origin": { "ip": "10.1.1.53" },
    "ehloName": "communication-test.example"
  }
}
```

**Precedence remains unchanged:** an eligible SPECIFIC rule is selected before any GLOBAL rule, even if the GLOBAL priority is higher. Within a scope, sort by numeric priority descending and earliest insertion. All selectors present are ANDed; omitted selectors are unrestricted, and `"*"` is not a valid wildcard.

**Observability:** `smtp.simulation.applied` includes `ruleId`, `scope`, `priority`, `phase`, `action`, `smtpSessionId`, `originIp`, `originId`, local/remote ports and `ehloName` if known, without credentials. Bounded delays are cancelled when the socket closes. The `smtp-server` package exposes no public EHLO callback; the Virtual Inbox keeps its version-specific greeting handler adapter isolated and tests it with real SMTP sockets, including TLS regression tests.

**Phase restrictions:** `credentialsId` cannot select CONNECT or EHLO (credentials are unknown); `ehloName` cannot select CONNECT. The destination inbox remains unavailable at either stage.
