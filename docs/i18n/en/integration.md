# Integrate as a mock

Redirect your application's outbound email and SMS clients to Virtual Inbox.

## SMTP connection

SMTP with STARTTLS uses port 2525; implicit SMTPS uses port 2465. For local development certificates, trust the public CA from `/tls/ca.pem`. Keep certificate hostname validation enabled.

## Mock SMS

POST to `http://localhost:3001/sms/messages` with `{"from":"+351911111111","to":"+351900000001","body":"Code 1234"}`. Register the destination using `/phone-numbers` first. Remember that localhost inside a container refers to that container.

---

[Management API](api.md) · [TLS](tls.md) · [SDK](sdk.md)
