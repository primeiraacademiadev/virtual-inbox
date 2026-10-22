# Integrar como mock

Substitui os destinos SMTP e SMS da aplicação em desenvolvimento pelo Virtual Inbox.

## Ligação SMTP

SMTP com STARTTLS: host configurado, porta 2525. SMTPS: porta 2465. Para certificados locais, confia na CA pública disponibilizada em `/tls/ca.pem`. Não desatives a validação TLS.

## Simular SMS

Configura o adaptador SMS para `POST http://localhost:3001/sms/messages`, com JSON `{"from":"+351911111111","to":"+351900000001","body":"Código 1234"}`. Regista previamente o destinatário em `/phone-numbers`. Num contentor, `localhost` é o próprio contentor.

---

[API de gestão](api.md) · [TLS](tls.md) · [SDK](sdk.md)
