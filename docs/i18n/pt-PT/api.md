# API de gestão e observação

Os endpoints de demonstração estão excluídos desta referência.

## Caixas e mensagens

`POST /mailboxes`, `POST /phone-numbers`, `GET /mailboxes`, `GET /phone-numbers`, `GET /mailboxes/:id/messages`, `GET /phone-numbers/:id/messages`, `POST /mailboxes/:id/wait-for-message`, `DELETE /mailboxes/:id`.

## Sessões e configuração

`GET /observers/events`, `GET /observers/:guid`, `GET /logs/events`, `GET /connection-info`, `GET /tls/ca.pem`, `PUT /admin/network` e `PUT /admin/tls`. As alterações administrativas exigem HTTPS e ADMIN_TOKEN.

---

[API de gestão](api.md) · [TLS](tls.md) · [SDK](sdk.md)
