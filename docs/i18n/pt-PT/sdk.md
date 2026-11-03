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

As leituras de sessoes e tentativas SMTP sao abertas em HTTP e HTTPS, sem token, conforme o ADR-0001. As escritas administrativas e a verificacao de credenciais continuam protegidas por HTTPS e `ADMIN_TOKEN`. Não registes tokens ou credenciais em logs. STARTTLS atualiza a sessão de transporte já existente para `secure: true`.

## SDK distribuível e erros tipados

O SDK `@virtual-inbox/client` é um pacote ESM compilado a partir de `sdk/client.ts`. A versão publicada no npm é 0.2.1; este branch prepara a versão 0.3.0 com regras AUTH e resolve, **ainda não publicada**. Para criar um pacote local: `npm run build --prefix sdk` e `cd sdk && npm pack --dry-run`; o ficheiro `.tgz` pode ser instalado noutro repositório sem checkout do Virtual Inbox. O SDK foi publicado no npm; versoes futuras seguem o workflow de release. O cliente inclui `VirtualInboxError` (`status`, `errorCode`, `errorParams`, `cause`) e `waitOrThrow()` que distingue ausência de observação de rejeição SMTP. Em timeout, recolhe apenas metadados das últimas cinco mensagens da inbox pretendida; não consulta anomalias nem logs globais de outras suites. O método `wait()` continua a devolver `null` em HTTP 204. Métodos adicionais: `findInbox`, `clearMessages`, `connectionInfo`, `waitForConnectionProbe`, sessões SMTP e configuração das regras. As escritas administrativas exigem `adminUrl` HTTPS e `adminToken` explícitos: `new VirtualInboxClient('http://127.0.0.1:3000', {adminUrl:'https://localhost:3443',adminToken:token})`. Não registar tokens em logs de teste.

## Asserções negativas e tentativas SMTP (#39)

`messages(inbox, after)` devolve apenas mensagens com `sequence > after`. `expectNoMessage(inbox, {after, forMs, match?})` aguarda a janela especificada: se aparecer uma mensagem correspondente, lança `VirtualInboxError` com `UNEXPECTED_MESSAGE`; caso contrário, termina sem erro. **Ausência de observação não equivale a rejeição SMTP.** Para correlacionar uma tentativa sem token, consultar `smtpAttempts({smtpSessionId, sender, recipient, messageId, ruleId})`. Pelo menos um filtro é obrigatório; os filtros combinam-se por AND. Os resultados têm `outcome` (`in_progress`, `rejected`, `stored_and_acknowledged`, `stored_without_ack`), fase, IDs de mensagens/regras e `persisted`, sem conteúdo ou passwords. A relação de estado corresponde ao ponto de vista do servidor, não prova que o cliente recebeu o ACK. A API devolve no máximo 200 resultados por pedido e conserva até 2000 tentativas em memória. O esquema alargado de eventos/SSE será tratado no #44.

## Provisionamento idempotente e capacidades (#41)

Por omissão, criar novamente o mesmo endereço continua a devolver `409`. Para reutilizar explicitamente uma inbox existente, enviar `ifExists: "return"` em `POST /api/mailboxes` ou `POST /api/phone-numbers`. A resposta é `201` na criação e `200` na reutilização; o `id` e o TTL não mudam. Endereços expirados são recriados e recebem novo ID; o domínio reservado `@virtual.inbox` nunca é reutilizável por esta via. O SDK aceita `create(channel, address, ttlSeconds, "return")`. `GET /api/capabilities` apresenta `version`, `schemaVersion`, protocolos, `smtpAuthPolicy`, operações de idempotência e ações/fases SMTP. Usar `client.capabilities()` para descobrir funcionalidades sem aceder ao checkout do servidor.

## Retenção e sequência de logs (incremento #44)

`MAX_LOG_BUFFER_BYTES` limita a memória ocupada pelo histórico circular (10485760 bytes = 10 MiB por omissão; inteiro positivo). Eventos maiores do que o limite não são retidos, mas são emitidos em direto. Cada evento inclui `log_id` crescente por execução e preserva `id=runId:sequence` para compatibilidade. `log.gap` indica `missingFrom` e `missingTo` quando o cursor refere eventos já descartados; `log.reset` assinala mudança de execução. A consola permite selecionar 500, 2000, 5000 ou 10000 entradas nesta sessão de navegador; não há persistência após fecho. O número efetivo de eventos no buffer depende do tamanho serializado de cada evento. Apenas dados sintéticos devem ser utilizados. Os endpoints REST `/api/logs` e SSE `/api/logs/events` (incluindo observadores) aceitam `type`, `inboxId`, `messageId`, `smtpSessionId`, `attemptId`, `sender`, `recipient` e `ruleId`; correspondência exata, conjunção de critérios. `recipient` corresponde a qualquer membro de um array. Eventos fora do filtro não representam lacunas.

## Simulação de AUTH e âmbitos das regras SMTP (v0.3)

Antes da ligação, `resolveSmtp({credentials:{username,password}, origin:{ip}})` resolve um ou ambos os critérios e devolve IDs opacos e uma árvore das ligações **efetivamente observadas**, sem devolver a password. Com `createSmtpRule`, uma regra AUTH específica de IP não precisa de indicar credenciais:

```ts
await sdk.createSmtpRule({phase:"AUTH",action:"reply",code:454,remaining:3,
  priority:1,selectors:{origin:{ip:"10.1.1.53"}}});
```

As regras **GLOBAL** não têm `selectors` (ou usam `{}`); as **SPECIFIC** têm pelo menos um. Todos os seletores presentes são combinados por **AND**. Se não estiverem presentes, não restringem; **não existe wildcard `"*"`**. Primeiro procura-se uma regra SPECIFIC elegível, depois GLOBAL; dentro de cada âmbito decide a maior `priority` e, em empate, a regra inserida primeiro. Consome-se apenas uma regra por evento. AUTH aceita respostas 400–599; CONNECT/EHLO e inbox/SMS ficam para outras evoluções. O resolve e a configuração exigem HTTPS e token administrativo; passwords nunca entram nos logs. [Especificação completa](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/smtp-rule-scopes.md).

## Simulação de CONNECT e EHLO (código SDK v0.4.0)

As regras CONNECT são avaliadas **após aceitar a ligação TCP, antes da saudação SMTP 220**. As regras EHLO são avaliadas quando o cliente envia HELO/EHLO. As ações são `reply` (4xx/5xx), `drop` (corte sem resposta), `hang` (espera limitada e corte) e `delay` (atraso limitado de resposta ou continuação normal).

```ts
await sdk.createSmtpRule({
  phase:"CONNECT",action:"drop",remaining:1,
  selectors:{connection:{port:2525},origin:{ip:"127.0.0.1"}}
});
await sdk.createSmtpRule({
  phase:"EHLO",action:"reply",code:421,remaining:1,
  selectors:{ehloName:"communication-test.example"}
});
```

`connection.port` é a **porta local do listener**; `remotePort` é metadado efémero. O nome EHLO é **declarado pelo cliente**, sem autenticação, e não é conhecido em CONNECT; as credenciais não são conhecidas nem em CONNECT nem em EHLO. Seletores presentes usam AND; ausentes não restringem. Regras SPECIFIC elegíveis têm precedência sobre GLOBAL, independentemente da prioridade numérica. `drop` após accept não equivale a recusa da ligação TCP. O código do SDK 0.4.0 está preparado, **ainda sem publicação**; npm 0.3.0 é a última versão cuja publicação foi confirmada.
