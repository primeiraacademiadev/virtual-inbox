# Intégrer comme simulateur

Redirigez l'envoi d'e-mails et de SMS de votre application vers Virtual Inbox.

## Connexion SMTP

SMTP avec STARTTLS : port 2525. SMTPS implicite : port 2465. Pour les certificats locaux, approuvez l'autorité publique disponible sur `/tls/ca.pem`. Maintenez la vérification du nom d'hôte.

## SMS simulé

Envoyez `POST http://localhost:3001/sms/messages` avec `{"from":"+351911111111","to":"+351900000001","body":"Code 1234"}`. Enregistrez d'abord le destinataire avec `/phone-numbers`. Dans Docker, localhost désigne le conteneur lui-même.

---

[API de gestion](api.md) · [TLS](tls.md) · [SDK](sdk.md)
