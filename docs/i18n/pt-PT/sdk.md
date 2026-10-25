# Automatizar asserções

Usa inboxes e marcadores únicos por execução. Não uses sleeps arbitrários para adivinhar quando chega uma mensagem. Leituras e esperas não consomem mensagens; cada teste deve filtrar e limpar os próprios recursos.

## Sequência fiável

1. POST `/api/mailboxes` com `{"ttlSeconds":180}`; guarda `id` e `address`.
2. Inicia POST `/api/mailboxes/{id}/wait-for-message` com `{"timeoutMs":10000,"match":{"subjectContains":"marcador-unico"}}`.
3. Executa a operação real da aplicação testada, não o emissor da consola quando pretendes testar essa aplicação.
4. Verifica HTTP `200`, remetente, conteúdo e bytes dos anexos. `204` não tem JSON: significa timeout sem correspondência ou remoção da inbox.
5. Elimina `/api/mailboxes/{id}` num bloco `finally`.

`after` é um número de sequência de mensagem exclusivo, não o id de evento SSE. Os filtros `from`, `bodyContains`, `htmlContains`, `subjectContains` e `header` combinam-se por AND. O timeout não pode exceder `MAX_WAIT_TIMEOUT_MS`. `404` significa que a inbox já não existia; não o trates como resultado vazio bem-sucedido.

Os exemplos executáveis estão em `examples/smtp-roundtrip.mjs` e `examples/sms-roundtrip.mjs`. O SDK opcional está em `sdk/client.ts`; o contrato HTTP gerado é a referência dos payloads.

## Observadores e SSE

GET `/api/observers/events` abre o stream. O primeiro `session.initialized` anuncia `observerId` e inboxes observadas. POST `/api/observers/{observerId}/inboxes` com `{"inboxId":"UUID"}` regista interesse e devolve mensagens existentes. A religação usa `/api/observers/{observerId}/events`; `session.restored` anuncia a projeção no servidor. Regista de novo o que faltar.

Guarda o último id de `log` e envia-o em `Last-Event-ID` ou `after` para replay. `log.gap` exige reconciliar por REST; `log.reset` indica outra execução. Notificações contêm identificadores, não bytes de anexos. Sessões e inboxes expiram independentemente. Os streams atuais também incluem logs globais: as subscrições não são uma fronteira de autorização.

## Testar o próprio Virtual Inbox

```sh
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
npm test
npm run test:all
```

O harness gerido inicia uma instância isolada temporária. Não executes rotação TLS ou esgotamento de quotas numa instalação partilhada. Relatórios ficam em `testing/reports/` e não são código-fonte. O CI Docker faz um smoke test real de HTTP/SMTP; não equivale à suite completa de browser contra o contentor.

## Metadados MIME e filtros de pesquisa

O SDK TypeScript `sdk/client.ts` devolve `headers` originais (ordenados e com os valores MIME não descodificados), `envelope` (incluindo destinatários Bcc presentes apenas no envelope), `html`, `authUser`, `smtpSessionId` e `decodedFrom` (`name` e `address`). O nome em `decodedFrom` é descodificado segundo RFC 2047, preservando o header `From` original.

Usa `wait(inbox, { header: { name: "X-Message-ID", valueContains: marcador }, htmlContains: "code" })`. `bodyContains` pesquisa em texto e HTML; `htmlContains` apenas em HTML. Os filtros combinam-se por AND; HTTP `204` devolve `null`. `after` é a sequência da mensagem e não um ID SSE.

Os diagnósticos SMTP requerem HTTPS e `ADMIN_TOKEN`. Não registes tokens ou credenciais em logs. STARTTLS atualiza a sessão de transporte já existente para `secure: true`.
