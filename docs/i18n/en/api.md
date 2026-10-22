# Management and observation API

Demo-only sending endpoints are excluded from this reference.

## Inboxes and messages

`POST /mailboxes`, `POST /phone-numbers`, `GET /mailboxes`, `GET /phone-numbers`, `GET /mailboxes/:id/messages`, `GET /phone-numbers/:id/messages`, `POST /mailboxes/:id/wait-for-message`, `DELETE /mailboxes/:id`.

## Sessions and configuration

`GET /observers/events`, `GET /observers/:guid`, `GET /logs/events`, `GET /connection-info`, `GET /tls/ca.pem`, `PUT /admin/network`, `PUT /admin/tls`. Administrative changes require HTTPS and ADMIN_TOKEN.

---

[Management API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
