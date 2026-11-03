# Running independent Virtual Inbox instances

Virtual Inbox **recommends one shared instance** for ordinary suites, but multiple processes on the same host are fully supported when each instance owns its listeners and persistent configuration. They have **independent process memory**: no shared inboxes, messages, logs, SMTP sessions, fault rules, observers, or counters. This is process-level isolation, not an authorization or tenant model (see [ADR-0001](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/adr/0001-test-sandbox-observability.md)). Use synthetic data on a trusted test network.

This example runs **two instances with TLS enabled** on Windows PowerShell, CMD or a POSIX shell. It does not require Docker, a dedicated multi-instance mode, or a new service.

## 1. Build once

From the repository root:

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm run build
```

Create two *local* files in the repository root, `.env.instance-a` and `.env.instance-b`. Both match the syntax accepted by Node's `--env-file` option. The repository ignores `.env.*`; never commit credentials or certificates.

**.env.instance-a**

```dotenv
HOST=127.0.0.1
SMTP_HOST=127.0.0.1
PUBLIC_HOST=localhost
PORT=3000
HTTPS_PORT=3443
SMTP_PORT=2525
SMTPS_PORT=2465
POP3_PORT=2110
DEMO_PORT=3001
DEMO_HTTPS_PORT=3444
TLS_MODE=auto
TLS_SERVER_NAMES=localhost,127.0.0.1
TLS_CERTIFICATES_DIR=./data/instances/a/certificates
TLS_MANAGED_NAMES_FILE=./data/instances/a/certificates/names.json
TLS_MANAGED_IDENTITY_FILE=./data/instances/a/certificates/imported-identity.json
NETWORK_SETTINGS_FILE=./data/instances/a/network-settings.json
```

**.env.instance-b**

```dotenv
HOST=127.0.0.1
SMTP_HOST=127.0.0.1
PUBLIC_HOST=localhost
PORT=3100
HTTPS_PORT=3543
SMTP_PORT=2625
SMTPS_PORT=2565
POP3_PORT=2210
DEMO_PORT=3101
DEMO_HTTPS_PORT=3544
TLS_MODE=auto
TLS_SERVER_NAMES=localhost,127.0.0.1
TLS_CERTIFICATES_DIR=./data/instances/b/certificates
TLS_MANAGED_NAMES_FILE=./data/instances/b/certificates/names.json
TLS_MANAGED_IDENTITY_FILE=./data/instances/b/certificates/imported-identity.json
NETWORK_SETTINGS_FILE=./data/instances/b/network-settings.json
```

All seven listener ports, including POP3 and demo ports, must be different on a shared bind address. They are example ports: change them when occupied. Explicit environment values override old persisted network settings. Default SANs work for `localhost` and `127.0.0.1`; for DNS aliases, update `PUBLIC_HOST`, `TLS_SERVER_NAMES` and any `HTTP_ALLOWED_HOSTS` entries. Do **not** include wildcard bind addresses such as `0.0.0.0` as certificate SANs.

## 2. Start each process in a separate terminal

From the repository root, in terminal A:

```sh
node --env-file=.env.instance-a dist/src/server.js
```

In terminal B:

```sh
node --env-file=.env.instance-b dist/src/server.js
```

Each process prints its listener addresses and a JSON `ready` event when all configured listeners are bound. Keep both terminals running. Unlike `npm start`, these commands explicitly select one configuration file each; do not load the same root `.env` into both processes.

## 3. Verify both instances

From any terminal (PowerShell, CMD or POSIX shell with Node 24+):

```sh
node -e "Promise.all([3000,3100].map(async p=>{const base='http://127.0.0.1:'+p+'/api';const [r,c]=await Promise.all([fetch(base+'/ready'),fetch(base+'/capabilities')]);const ready=await r.json();const cap=await c.json();console.log(p,r.status,ready.runId,cap.version,cap.protocols);if(r.status!==200)process.exitCode=1;})).catch(e=>{console.error(e);process.exitCode=1;})"
```

Expect HTTP 200 twice and **different `runId` values**. Discover actual ports with `GET /api/connection-info` on each address. Check both TLS identities by reading their public certificates through `GET /api/tls/status` (no private key is returned); certificate fingerprints should differ because each directory stores an independent locally generated CA and server identity. Each newly generated local CA has a distinct subject; TLS *clients* may trust both instance-specific `ca.pem` files in the same CA bundle, without disabling certificate verification. Older CAs generated before this improvement can share a subject: back them up and regenerate them deliberately if coexistence fails (this also requires renewing client trust).

For a quick isolation check, run this from the repository root (or any directory with Node.js 24+):

```sh
node -e "async function check(){const name='parallel-a@sandbox.test';const a='http://127.0.0.1:3000/api/mailboxes';const b='http://127.0.0.1:3100/api/mailboxes';const c=await fetch(a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:name})});if(c.status!==201)throw Error('Create on A: '+c.status);const r=await fetch(b);if(!r.ok)throw Error('Read B: '+r.status);const boxes=await r.json();if(boxes.some(x=>x.address===name))throw Error('Isolation failed');console.log('Isolated: inbox exists only on A');}check().catch(e=>{console.error(e);process.exitCode=1})"
```

Run with a fresh instance A so the address has not already been created. Shared process limits (CPU/RAM) and host networking remain common resources.

## 4. Stop and clean up

Press **Ctrl+C** in **both** terminals. Runtime messages, sessions, logs and fault rules disappear on process shutdown. Once both processes have stopped, remove `.env.instance-a`, `.env.instance-b` and `data/instances/a`, `data/instances/b` if no longer needed. These directories contain locally generated **private keys** and persisted configuration: never commit or share them.

## Isolation checklist and operational notes

| Item | Must differ between A and B? | Why |
| --- | --- | --- |
| `PORT`, `HTTPS_PORT`, `SMTP_PORT`, `SMTPS_PORT`, `POP3_PORT`, `DEMO_PORT`, `DEMO_HTTPS_PORT` | **Yes**, with identical bind hosts | Avoid TCP collisions |
| `NETWORK_SETTINGS_FILE` | **Yes** | Prevent one console changing the other's persisted network values |
| `TLS_CERTIFICATES_DIR` | **Yes** | Generate separate CA, server certificates and private keys |
| `TLS_MANAGED_IDENTITY_FILE`, `TLS_MANAGED_NAMES_FILE` | **Yes** | Isolate uploaded identity and console-managed SANs |
| `TLS_SERVER_NAMES_FILE` | If used, distinct when instances manage different SANs | Avoid accidental shared configuration |
| `TLS_CERT_FILE` and `TLS_KEY_FILE` (external mode) | Recommended distinct | External identities may be intentionally shared only by explicit policy |
| `PUBLIC_HOST`, `TLS_SERVER_NAMES` | May be equal for localhost | SANs reflect hostnames, **not ports** |
| `ADMIN_TOKEN` | Recommended distinct if set | Protect administrative writes independently; never log tokens |
| Captured data, logs, attempts, sessions, simulations | Automatically independent | In-memory per process, not persisted or shared |

For three or four instances, repeat the same pattern with unique fixed listener ports and paths. **Port `0`** is used by certain managed test harnesses to allocate ephemeral listeners. It is **not** the example for normal standalone use: configure explicit fixed ports, check `/api/ready`, and terminate the subprocess on completion. Do not use this guide to place a synthetic-data sandbox on a public network.
