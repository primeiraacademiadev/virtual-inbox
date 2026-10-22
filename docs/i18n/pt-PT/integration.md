# Integrar o Virtual Inbox como mock

Este guia destina-se a quem pretende substituir temporariamente serviços de comunicação reais durante desenvolvimento, demonstrações e testes. O Virtual Inbox não é um relay SMTP público nem um fornecedor de SMS real.

## 1. Escolher o endereço do servidor

Por omissão, o servidor escuta em `127.0.0.1`. Se a aplicação em teste estiver noutro contentor ou máquina, **localhost aponta para essa máquina**, e não para o Virtual Inbox. Configura `HOST`, `SMTP_HOST` e `PUBLIC_HOST` e limita o acesso por rede. O nome utilizado pelo cliente deve constar dos SAN do certificado.

## 2. Integrar SMTP

| Transporte | Porta | Configuração |
| --- | --- | --- |
| SMTP | 2525 | Sem TLS apenas em ambiente de confiança |
| SMTP + STARTTLS | 2525 | Negociação TLS após EHLO |
| SMTPS | 2465 | TLS implícito |

Regista primeiro uma mailbox pelo endpoint de gestão e usa o seu campo `address` como destinatário. Para confiar nos certificados automáticos locais, instala **apenas a CA pública**, disponível em `GET /tls/ca.pem`. Não desatives a validação do certificado TLS.

## 3. Integrar SMS

O cliente HTTP envia para a **porta de demonstração 3001** (ou 3444 com HTTPS), e não para a porta de gestão 3000.

```sh
curl -X POST http://127.0.0.1:3001/sms/messages \
  -H 'Content-Type: application/json' \
  -d '{"from":"+351911111111","to":"+351900000001","body":"Código: 123456"}'
```

Antes do envio, regista o número com `POST /phone-numbers` na API de gestão.

## 4. Inspecionar mensagens e anexos

Usa `GET /mailboxes/:id/messages` ou `GET /phone-numbers/:id/messages`. O JSON devolve metadados dos anexos, incluindo `id`, `filename`, `contentType` e `size`, nunca bytes binários. Descarrega um anexo em `GET /mailboxes/:id/messages/:messageId/attachments/:attachmentId`.

## 5. Erros e diagnósticos

As respostas de erro preservam `error` para compatibilidade e acrescentam `errorCode` e `errorParams`. Usa os códigos, não a mensagem em inglês. O tipo de evento SSE e os identificadores continuam invariantes.

A API é maioritariamente anónima. Usa-a apenas numa rede controlada e sem dados pessoais de produção.

[Automatizar testes](sdk.md) · [Referência API](api.md) · [TLS](tls.md)
