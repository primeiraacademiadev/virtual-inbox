# Integrar uma aplicação

Cria uma inbox com `POST /api/mailboxes` ou `POST /api/phone-numbers`. Um objeto JSON vazio usa os defaults do servidor. Guarda `id` (UUID REST) e `address` (destinatário). Configura a aplicação a testar, executa a sua operação normal e consulta ou espera pela mensagem capturada.

## Transportes de email

| Transporte | Porta | Opções Nodemailer |
| --- | --- | --- |
| SMTP plain | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS obrigatório | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

Em TLS fornece a CA confiável e um `servername` presente nos SAN. Nunca uses `rejectUnauthorized:false`. Não é exigida autenticação SMTP. Em Compose o hostname é o nome do serviço; fora de Docker usa a porta publicada. Inclui esse hostname nos SAN quando utilizares TLS.

Com o servidor iniciado, na raiz do repositório:

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls data/certificates/ca.pem
node examples/smtp-roundtrip.mjs smtps data/certificates/ca.pem
```

Cada exemplo cria inbox, envia MIME com anexo binário, espera pela captura, compara SHA-256 e limpa os recursos. Em Docker copia primeiro apenas a CA pública: `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Passa `vi-ca.pem` como último argumento. Nunca copies a chave da CA para o cliente.

## SMS

Não existe transporte de telecomunicações real. Envia JSON `{"from":"test-app","to":"+351912345678","body":"Mensagem de teste"}` para `/demo/sms/messages` na origem principal, ou `/sms/messages` no listener demo (3001/3444). O destino deve corresponder à inbox criada; aliases nacionais/internacionais suportados chegam à mesma inbox. `node examples/sms-roundtrip.mjs` executa o percurso completo.

O [contrato OpenAPI demo](/api/openapi-demo.json) descreve estes endpoints auxiliares, separados da referência principal. Enviar email demo devolve `202`; capturar SMS devolve `201`.

## Fronteiras e diagnóstico

A aceitação SMTP deve ser acompanhada por uma asserção REST da captura. Destinos desconhecidos/expirados vão para anomalias. As respostas JSON só incluem metadados de anexos; descarrega os bytes em `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}`. O limite SMTP inclui todo o MIME e o overhead de codificação. As quotas podem rejeitar mensagens.

CORS controla origens do browser, não clientes Node/SMTP. `421` indica Host recusado; `403` pode indicar Origin ou administração. Configura os hosts/origins necessários sem abrir uma exceção wildcard. Continua em [Testes automáticos](sdk.md).
