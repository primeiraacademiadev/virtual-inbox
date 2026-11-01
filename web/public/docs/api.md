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

## Retenção dos logs (incremento #44)

`MAX_LOG_BUFFER_BYTES=10485760` define a capacidade por bytes do buffer circular do servidor. O `log_id` aumenta sequencialmente por execução. O identificador SSE original `runId:sequence` continua válido para `after` / `Last-Event-ID`. O sinal `log.gap` inclui `missingFrom`/`missingTo` quando os eventos anteriores foram descartados; `log.reset` assinala reinício. A consola permite limitar o histórico local a 500, 2000, 5000 ou 10000 entradas (armazenado na sessão do browser). O número de eventos retidos no servidor depende da dimensão serializada. Filtros REST/SSE: `type`, `inboxId`, `messageId`, `smtpSessionId`, `attemptId`, `sender`, `recipient`, `ruleId`; correspondência exata e conjunção. Eventos excluídos por filtro não constituem lacunas.

### Recuperação de intervalos

`GET /api/logs?from=1201&to=1249` devolve os eventos ainda retidos nesse intervalo inclusivo (máximo 10001 IDs por pedido), com os mesmos filtros opcionais do REST/SSE. A consola permite clicar numa linha `log.gap` para recuperar as entradas; caso não existam, apresenta a indicação localizada de entradas irrecuperáveis. Saltos causados apenas pelos filtros não devem ser tratados como perda de retenção. A recuperação parcial e a reconciliação da sequência continuam sujeitas a testes E2E.

### Paginação inversa (#57)

`GET /api/logs?limit=20` devolve os 20 eventos mais recentes em ordem decrescente. `GET /api/logs?limit=20&before=1234` recupera os anteriores ao `log_id=1234`, sem offset. A resposta contém `nextBefore`, `hasMore`, `oldest` e `latest` com `log_id` e `at`, além de `runId`. O limite permitido é de 1 a 100. A consola usa a primeira página REST para iniciar um SSE com cursor `after=runId:latest.log_id`, evitando perder eventos entre snapshot e subscrição. O scroll permite consultar páginas anteriores.
