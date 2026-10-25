# Integrar uma aplicação

Cria uma inbox com `POST /api/mailboxes` ou `POST /api/phone-numbers`. Um objeto JSON vazio usa os defaults do servidor. Guarda `id` (UUID REST) e `address` (destinatário). Configura a aplicação a testar, executa a sua operação normal e consulta ou espera pela mensagem capturada.

## Transportes de email

| Transporte | Porta | Opções Nodemailer |
| --- | --- | --- |
| SMTP plain | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS obrigatório | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

Em TLS fornece a CA confiável e um `servername` presente nos SAN. Nunca uses `rejectUnauthorized:false`. SMTP AUTH é opcional e aceita credenciais fictícias. Em Compose o hostname é o nome do serviço; fora de Docker usa a porta publicada. Inclui esse hostname nos SAN quando utilizares TLS.

Com o servidor iniciado, na raiz do repositório:

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls
node examples/smtp-roundtrip.mjs smtps
```

Cada exemplo cria inbox, envia MIME com anexo binário, espera pela captura, compara SHA-256 e limpa os recursos. Em Docker copia primeiro apenas a CA pública: `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Para usar uma CA fora da localização predefinida, define `VI_TEST_CA_FILE` no ambiente e executa o exemplo sem argumento adicional: no Windows CMD, `set VI_TEST_CA_FILE=vi-ca.pem` seguido de `node examples/smtp-roundtrip.mjs starttls`; em Linux/macOS, `VI_TEST_CA_FILE=./vi-ca.pem node examples/smtp-roundtrip.mjs starttls`. Nunca copies a chave da CA para o cliente.

## SMS

Não existe transporte de telecomunicações real. Envia JSON `{"from":"test-app","to":"+351912345678","body":"Mensagem de teste"}` para `/demo/sms/messages` na origem principal, ou `/sms/messages` no listener demo (3001/3444). O destino deve corresponder à inbox criada; aliases nacionais/internacionais suportados chegam à mesma inbox. `node examples/sms-roundtrip.mjs` executa o percurso completo.

O [contrato OpenAPI demo](/api/openapi-demo.json) descreve estes endpoints auxiliares, separados da referência principal. Enviar email demo devolve `202`; capturar SMS devolve `201`.

## Fronteiras e diagnóstico

A aceitação SMTP deve ser acompanhada por uma asserção REST da captura. Destinos desconhecidos/expirados vão para anomalias. As respostas JSON só incluem metadados de anexos; descarrega os bytes em `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}`. O limite SMTP inclui todo o MIME e o overhead de codificação. As quotas podem rejeitar mensagens.

CORS controla origens do browser, não clientes Node/SMTP. `421` indica Host recusado; `403` pode indicar Origin ou administração. Configura os hosts/origins necessários sem abrir uma exceção wildcard. Continua em [Testes automáticos](sdk.md).

## Compatibilidade com Communication e autenticação SMTP

O Virtual Inbox é um **sandbox de testes**: anuncia SMTP AUTH `PLAIN` e `LOGIN` e aceita qualquer par de utilizador/password. Guarda apenas `authUser` com cada mensagem; **não guarda nem regista a password**. Continua a aceitar envios sem autenticação. Isto **não autentica nem autoriza** utilizadores: não exponhas o listener SMTP à Internet ou a uma rede não confiável. AUTH também funciona em SMTP sem TLS exclusivamente para testes; em cenários com dados sensíveis usa STARTTLS/SMTPS.

O Communication exige utilizador e password SMTP; configura-os com valores fictícios e aponta-o para o Virtual Inbox. O erro anterior `535 Authentication not implemented` deixa de ocorrer. Num cliente Node que use STARTTLS/SMTPS, fornece a CA pública do Virtual Inbox **antes de iniciar o processo** através de `NODE_EXTRA_CA_CERTS` (por exemplo `NODE_EXTRA_CA_CERTS=/caminho/vi-ca.pem` no ambiente do processo Communication). Em Docker monta o ficheiro CA no contentor e aponta a variável para o caminho *dentro* dele. O hostname usado na ligação tem de existir no SAN do certificado. Nunca uses `rejectUnauthorized:false`.

A resposta de `GET /api/mailboxes/{id}/messages` e da espera agora inclui `headers` (lista ordenada, preservando repetições, `key` em minúsculas, `originalKey` e `value`), `envelope: {mailFrom,rcptTo}` e `authUser` quando há autenticação. Os headers incluem `From` (nome de apresentação), `Reply-To`, `Cc` e `X-Message-ID` quando presentes no MIME. **Bcc pode não constar dos headers**: procura o destinatário em `envelope.rcptTo`. O `from` anterior continua a ser o remetente de envelope.

Para esperar por conteúdo HTML e header personalizado:

```json
{"timeoutMs":10000,"match":{"bodyContains":"codigo-123","header":{"name":"X-Message-ID","valueContains":"trace-abc"}}}
```

`bodyContains` procura no corpo texto **ou** no HTML original; `htmlContains` restringe a pesquisa ao HTML. O nome do header não distingue maiúsculas/minúsculas e `valueContains` distingue. Todos os filtros continuam combinados por AND. Emails só HTML podem ter `body` vazio.

Limites de dimensão MIME/attachments devolvem SMTP **552** (permanente), não 450; falta de capacidade global pode devolver **452** (temporário). Distingue-os no tratamento de retries e da DLQ. Os testes integrados cobrem AUTH PLAIN/LOGIN, SMTP/STARTTLS/SMTPS, headers, envelope e 552.
