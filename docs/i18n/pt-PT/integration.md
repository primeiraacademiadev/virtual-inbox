# Integrar uma aplicação

Cria uma inbox com `POST /api/mailboxes` ou `POST /api/phone-numbers`. Um objeto JSON vazio usa os defaults do servidor. Guarda `id` (UUID REST) e `address` (destinatário). Configura a aplicação a testar, executa a sua operação normal e consulta ou espera pela mensagem capturada.

## Transportes de email

| Transporte | Porta | Opções Nodemailer |
| --- | --- | --- |
| SMTP plain | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS obrigatório | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

Em TLS fornece a CA confiável e um `servername` presente nos SAN. Nunca uses `rejectUnauthorized:false`. SMTP AUTH é opcional; quando usado, o utilizador deve ser o endereço de uma inbox de email ativa e a password pode ser fictícia. Em Compose o hostname é o nome do serviço; fora de Docker usa a porta publicada. Inclui esse hostname nos SAN quando utilizares TLS.

Com o servidor iniciado, na raiz do repositório:

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls
node examples/smtp-roundtrip.mjs smtps
```

Cada exemplo cria inbox, envia MIME com anexo binário, espera pela captura, compara SHA-256 e limpa os recursos. Em Docker copia primeiro apenas a CA pública: `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Para usar uma CA fora da localização predefinida, define `VI_TEST_CA_FILE` no ambiente e executa o exemplo sem argumento adicional: no Windows CMD, `set VI_TEST_CA_FILE=vi-ca.pem` seguido de `node examples/smtp-roundtrip.mjs starttls`; em Linux/macOS, `VI_TEST_CA_FILE=./vi-ca.pem node examples/smtp-roundtrip.mjs starttls`. Nunca copies a chave da CA para o cliente.

## SMS

Não existe transporte de telecomunicações real. Envia JSON `{"from":"test-app","to":"+351912345678","body":"Mensagem de teste"}` para `/demo/sms/messages` na origem principal, ou `/sms/messages` no listener demo (3001/3444). Para entrega normal, o destino deve corresponder à inbox criada; aliases nacionais/internacionais suportados chegam à mesma inbox. Destinos desconhecidos ou expirados são aceites e capturados em anomalias, como descrito abaixo. `node examples/sms-roundtrip.mjs` executa o percurso completo.

A **API pública funcional de ingestão SMS** é `POST /api/sms/ingestions` no listener HTTP(S) principal, com o mesmo corpo JSON e resposta `201` com a mensagem capturada. Está disponível a qualquer cliente de testes, incluindo extensões, e aplica a mesma captura, encaminhamento, TTL e anomalias do emissor demo. É uma operação funcional separada para evitar que uma extensão invoque recursivamente o seu próprio endpoint de provider. O cliente tipado `@virtual-inbox/client` disponibiliza `ingestSms({ from, to, body })`. Não há transporte real, nem semântica de campanhas ou autenticação de fornecedores. O header opcional `X-VI-Correlation-ID` (1–128 caracteres ASCII seguros) é devolvido na resposta para facilitar a correlação do pedido, sem servir de identidade autenticada. Ainda não é persistido nos metadados da mensagem nem no log. A operação consta de `/api/openapi.json`; os endpoints demo existentes permanecem inalterados.

O [contrato OpenAPI demo](/api/openapi-demo.json) descreve estes endpoints auxiliares, separados da referência principal. Enviar email demo devolve `202`; capturar SMS devolve `201`.


## Destinatários desconhecidos ou expirados

**Enviar uma mensagem não cria automaticamente uma inbox.** Por omissão, o Virtual Inbox aceita mensagens destinadas a endereços/números não registados ou a inboxes expiradas e guarda-as na inbox de anomalias do respetivo canal, sem as perder silenciosamente.

| Destinatário | Email (SMTP/STARTTLS/SMTPS) | SMS (API demo) |
| --- | --- | --- |
| Inbox ativa | Entrega normal; após `DATA`, resposta `250 Accepted` | Captura normal; HTTP `201 Created` |
| Não registado | `RCPT TO` é aceite; após `DATA`, `250 Accepted`; captura com `UNKNOWN_RECIPIENT` | HTTP `201 Created`; captura com `UNKNOWN_RECIPIENT` |
| Expirado | Aceite e capturado com `EXPIRED_RECIPIENT` | HTTP `201 Created`; captura com `EXPIRED_RECIPIENT` |
| Limites/erros | A aceitação não é garantida: p. ex., `552` por tamanho, `452` por capacidade, ou falha simulada | Pode devolver `413`, `507` ou falhar por outras validações |

As inboxes de sistema são criadas automaticamente: `anomalies@sandbox.test` (email) e `+999000000000` (SMS). Para consultar as mensagens:

1. Chama `GET /api/mailboxes` (email) ou `GET /api/phone-numbers` (SMS) e identifica a inbox de sistema (`system: true` e o endereço indicado).
2. Usa o respetivo `id` (UUID) em `GET /api/mailboxes/{id}/messages` ou `GET /api/phone-numbers/{id}/messages`.
3. Consulta `originalRecipient` para saber qual era o destinatário e `captureReason` (`UNKNOWN_RECIPIENT` ou `EXPIRED_RECIPIENT`) para perceber o motivo. O evento emitido é `message.captured`, não `message.received`.

Exemplo dos campos relevantes de uma mensagem capturada:

```json
{"originalRecipient":"nao-registado@example.test","captureReason":"UNKNOWN_RECIPIENT"}
```

**Não confundas receção com autenticação:** `RCPT TO` aceita destinatários desconhecidos, mas `SMTP AUTH` exige que o *username* corresponda a uma inbox de email ativa; caso contrário, devolve `535`. A consulta REST de uma inbox inexistente por UUID pode devolver `404`, o que não significa que um envio para esse endereço seja recusado. Todos os dados são voláteis e sujeitos a quotas.

## Fronteiras e diagnóstico

A aceitação SMTP deve ser acompanhada por uma asserção REST da captura (na inbox normal ou na inbox de anomalias). As respostas JSON só incluem metadados de anexos; descarrega os bytes em `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}`. O limite SMTP inclui todo o MIME e o overhead de codificação. As quotas podem rejeitar mensagens.

CORS controla origens do browser, não clientes Node/SMTP. `421` indica Host recusado; `403` pode indicar Origin ou administração. Configura os hosts/origins necessários sem abrir uma exceção wildcard. Continua em [Testes automáticos](sdk.md).

## Compatibilidade com Communication e autenticação SMTP

O Virtual Inbox é um **sandbox de testes**: anuncia SMTP AUTH `PLAIN` e `LOGIN`. Cria primeiro uma inbox de email e utiliza o seu endereço como username; uma password fictícia identifica uma sessão lógica (o mesmo par inbox/password corresponde ao mesmo GUID enquanto a inbox existir). Um username desconhecido ou expirado é recusado com `535`. A password não é guardada em claro nem registada em logs; são usados hashes com salt em memória, e só `authUser` é associado às mensagens. Continua a aceitar envios sem autenticação. Isto **não é controlo de acesso seguro**: não exponhas o listener SMTP à Internet ou a redes não confiáveis. AUTH também funciona em SMTP sem TLS exclusivamente para testes; em cenários com dados sensíveis usa STARTTLS/SMTPS.

O Communication exige utilizador e password SMTP; usa como utilizador uma inbox de email previamente criada e uma password fictícia. O antigo erro `535 Authentication not implemented` foi corrigido, mas usernames sem inbox continuam a devolver `535`. Num cliente Node que use STARTTLS/SMTPS, fornece a CA pública do Virtual Inbox **antes de iniciar o processo** através de `NODE_EXTRA_CA_CERTS` (por exemplo `NODE_EXTRA_CA_CERTS=/caminho/vi-ca.pem` no ambiente do processo Communication). Em Docker monta o ficheiro CA no contentor e aponta a variável para o caminho *dentro* dele. O hostname usado na ligação tem de existir no SAN do certificado. Nunca uses `rejectUnauthorized:false`.

A resposta de `GET /api/mailboxes/{id}/messages` e da espera agora inclui `headers` (lista ordenada, preservando repetições, `key` em minúsculas, `originalKey` e `value`), `envelope: {mailFrom,rcptTo}` e `authUser` quando há autenticação. Os headers incluem `From` (nome de apresentação), `Reply-To`, `Cc` e `X-Message-ID` quando presentes no MIME. **Bcc pode não constar dos headers**: procura o destinatário em `envelope.rcptTo`. O `from` anterior continua a ser o remetente de envelope.

Para esperar por conteúdo HTML e header personalizado:

```json
{"timeoutMs":10000,"match":{"bodyContains":"codigo-123","header":{"name":"X-Message-ID","valueContains":"trace-abc"}}}
```

`bodyContains` procura no corpo texto **ou** no HTML original; `htmlContains` restringe a pesquisa ao HTML. O nome do header não distingue maiúsculas/minúsculas e `valueContains` distingue. Todos os filtros continuam combinados por AND. Emails só HTML podem ter `body` vazio.

Limites de dimensão MIME/attachments devolvem SMTP **552** (permanente), não 450; falta de capacidade global pode devolver **452** (temporário). Distingue-os no tratamento de retries e da DLQ. Os testes integrados cobrem AUTH PLAIN/LOGIN, SMTP/STARTTLS/SMTPS, headers, envelope e 552.

## Descoberta de ligações SMTP com @virtual.inbox

O domínio reservado `@virtual.inbox` cria automaticamente uma inbox temporária quando recebe por SMTP um pedido válido, enviado para um endereço com um identificador hexadecimal aleatório de 32 caracteres (128 bits), por exemplo `d44eaf765b72401cae559febf14f2378@virtual.inbox`. O pedido deve ter **um único destinatário, sem cabeçalho Subject, corpo de texto, HTML ou anexos**; pedidos inválidos são rejeitados. A inbox é criada no primeiro pedido válido, expira **60 segundos** depois e os reenvios não prolongam o prazo. A mensagem de pedido não é guardada; em seu lugar, o Virtual Inbox cria uma resposta JSON com `protocol`, `smtpSessionId`, `authenticated` e `secure`.

Consultar `GET /api/mailboxes?address=<endereço>` para obter a inbox e `POST /api/mailboxes/{inboxId}/wait-for-message` para ler a resposta. A ligação SMTP deve permanecer aberta para que o `smtpSessionId` possa ser usado. A consulta dos detalhes e a configuração de falhas `DATA` na ligação usam `/api/admin/smtp/sessions/{smtpSessionId}/simulations`, obrigatoriamente sobre HTTPS com `ADMIN_TOKEN`. O GUID não é uma credencial. Use `SMTP_AUTH_POLICY=OPEN` para autenticação SMTP sem inbox; por omissão, `INBOX` preserva a compatibilidade. Ligações sem AUTH são permitidas em ambos os modos. O POP3 mantém a autenticação associada à inbox. Estes endpoints devem ser usados apenas em redes de teste de confiança.

### Identidade SMTP e histórico

Após SMTP AUTH, o servidor associa um GUID `clientId` a um HMAC-SHA-256 interno de username, password e IP remoto, com salt secreto gerado no arranque. O mesmo trio mantém o GUID enquanto durar o processo; mudanças no trio ou reinício geram outra identidade. SMTP anónimo não é agrupado por IP. A resposta `@virtual.inbox` inclui `clientId` (nulo se anónimo) e `sessions`, com `smtpSessionId`, `connectedAt`, `disconnectedAt`, `connected` e `current` (ligação de origem). `SMTP_SESSION_HISTORY_HOURS` define a retenção de ligações fechadas (24 horas por omissão), sujeita à capacidade de memória. A inbox especial mantém TTL independente de 60 segundos.

### Esperar pela descoberta sem criar inbox

O domínio `@virtual.inbox` é reservado: a API normal de criação de inboxes não permite endereços desse domínio. Só um pedido SMTP válido com nonce hexadecimal aleatório de 32 caracteres cria a inbox temporária (TTL 60 segundos). O reenvio não renova a validade.

Para iniciar a escuta **antes de a inbox existir**, utilizar `POST /api/connection-probes/wait-for-message` com `{"address":"<32-hex>@virtual.inbox","timeoutMs":60000}`. O campo `after` (sequência de mensagem) é opcional. O servidor espera no máximo 60 segundos desde o pedido e, se a inbox já existir, nunca além da expiração dela. HTTP 200 devolve a mensagem; 204 indica timeout, expiração ou cancelamento; 400 indica endereço ou parâmetros inválidos. A espera não cria inbox nem prolonga o TTL. O endpoint convencional por `inboxId` continua a exigir uma inbox existente. O número de esperas simultâneas é limitado por `MAX_OBSERVER_COUNT`.

### Visibilidade de anomalias nos logs

Ao filtrar por inbox, remetente ou outro contexto, eventos `message.captured` continuam visíveis por omissão, mesmo quando não correspondem ao filtro. Defina `includeAnomalies=false` nas consultas REST `/api/logs` e streams SSE `/api/logs/events` (incluindo streams de observadores) para entrar em modo focado. A consola apresenta a opção «Include anomalies» ligada por omissão. A filtragem não é autorização nem altera a captura; os dados devem ser sintéticos.

### Pesquisa de mensagens capturadas

As inboxes de sistema continuam partilhadas. `GET /api/mailboxes/{inboxId}/messages` e o equivalente SMS aceitam filtros exatos combináveis `originalRecipient`, `from` (remetente do envelope SMTP quando disponível), `captureReason`, `smtpSessionId`, `authUser`, e cursor numérico `after`. A consola das inboxes de sistema mostra contagens agrupadas por destinatário original e motivo, com filtros por destinatário, remetente e motivo. Não altera o armazenamento nem a autorização: utilizar exclusivamente dados sintéticos.
