# Endpoints do Virtual Inbox

Esta página contém **apenas a API de utilização e observação**. Os endpoints de demonstração não estão incluídos.

## Estado e configuração

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/health` | Estado do servidor |
| GET | `/connection-info` | Endereços, portas e estado de TLS |
| GET | `/tls/certificate.pem` | Download do certificado público, se configurado |

## Inboxes de email

| Método | Endpoint | Descrição |
| --- | --- | --- |
| POST | `/mailboxes` | Criar mailbox |
| GET | `/mailboxes` | Listar mailboxes |
| GET | `/mailboxes/:id` | Consultar mailbox |
| DELETE | `/mailboxes/:id` | Eliminar mailbox |
| GET | `/mailboxes/:id/messages` | Listar mensagens |
| GET | `/mailboxes/:id/messages/:messageId` | Consultar mensagem |
| DELETE | `/mailboxes/:id/messages/:messageId` | Eliminar mensagem |
| DELETE | `/mailboxes/:id/messages` | Limpar mensagens |
| POST | `/mailboxes/:id/wait-for-message` | Esperar por mensagem |

## Números SMS

Os endpoints equivalentes aos de mailboxes estão disponíveis em `/phone-numbers`, incluindo operações sobre mensagens e espera.

## Observadores

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/observers/events` | Iniciar sessão SSE |
| GET | `/observers/:guid/events` | Retomar sessão SSE |
| GET | `/observers/:guid` | Obter projeção |
| POST | `/observers/:guid/inboxes` | Observar inbox |
| DELETE | `/observers/:guid/inboxes/:inboxId` | Deixar de observar |

## Eventos

| Método | Endpoint | Descrição |
| --- | --- | --- |
| GET | `/logs` | Consultar eventos circulares |
| GET | `/logs/events` | Subscrever SSE global |

**Nota de segurança:** a API não possui autenticação no MVP; usar apenas numa rede protegida.

## Received email attachments

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/mailboxes/:id/messages/:messageId/attachments/:attachmentId` | Download attachment bytes |

Message JSON contains attachment metadata (ID, name, MIME type, size) without file bytes.

## TLS and administrative operations

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/tls/ca.pem` | Download public local CA certificate (auto mode only) |
| PUT | `/admin/tls` | Admin HTTPS import of PEM certificate/key |
| PUT | `/admin/network` | Admin HTTPS settings for hostnames and ports (restart needed) |

All administrative modifications require `Authorization: Bearer <ADMIN_TOKEN>` over HTTPS. The private key is never downloadable.
