# API — Gestão e observação

Esta referência **não inclui endpoints exclusivos de demonstração/envio**.

**Base:** `http://127.0.0.1:3000` ou `https://localhost:3443` (com TLS). Na consola compilada, os pedidos usam o prefixo `/api`.

## Destinatários e mensagens

| Método | Endpoint | Operação |
| --- | --- | --- |
| POST | `/mailboxes` | Criar mailbox: `{address?,ttlSeconds?,observerId?}` |
| POST | `/phone-numbers` | Criar número: `{phoneNumber?,ttlSeconds?,observerId?}` |
| GET | `/mailboxes`, `/phone-numbers` | Listar |
| GET / DELETE | `/mailboxes/:id`, `/phone-numbers/:id` | Consultar ou eliminar |
| GET / DELETE | `/:collection/:id/messages` | Listar ou limpar mensagens |
| GET / DELETE | `/:collection/:id/messages/:messageId` | Consultar ou eliminar mensagem |
| POST | `/:collection/:id/wait-for-message` | Esperar por mensagem |
| GET | `/mailboxes/:id/messages/:messageId/attachments/:attachmentId` | Descarregar anexo binário |

`collection` é `mailboxes` ou `phone-numbers`. Os pedidos de espera aceitam `{after,timeoutMs,match:{from?,subjectContains?,bodyContains?}}`. Resposta 200 com mensagem ou 204 por timeout. O JSON contém apenas metadados dos anexos, não os bytes.

## Observadores, SSE e logs

| Método | Endpoint | Operação |
| --- | --- | --- |
| GET | `/observers/events` | Criar sessão GUID por SSE |
| GET | `/observers/:guid/events` | Retomar SSE |
| GET | `/observers/:guid` | Consultar inboxes observadas |
| POST | `/observers/:guid/inboxes` | Associar inbox por `{inboxId}` |
| DELETE | `/observers/:guid/inboxes/:inboxId` | Remover subscrição |
| GET | `/logs` | Consultar buffer circular |
| GET | `/logs/events` | SSE global |

Os IDs SSE usam `runId:sequence`; `log.gap` exige reconciliação, e `log.reset` indica reinício.

## Configuração e certificados

| Método | Endpoint | Operação |
| --- | --- | --- |
| GET | `/health` | Estado |
| GET | `/connection-info` | Endereços, portas, certificado |
| GET | `/tls/certificate.pem` | Certificado público |
| GET | `/tls/ca.pem` | CA local pública (modo auto) |
| PUT | `/admin/tls` | Importar PEM (HTTPS e token) |
| PUT | `/admin/network` | Configurar endereços (HTTPS e token) |

**Atenção:** a API de gestão é anónima neste MVP, exceto operações administrativas TLS/rede. Usa uma rede de confiança.
