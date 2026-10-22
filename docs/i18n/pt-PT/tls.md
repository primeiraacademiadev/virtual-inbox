# Ligações e TLS

O Node.js termina HTTPS, STARTTLS e SMTPS, sem proxy TLS obrigatório.

## Portas e modos

HTTPS 3443, SMTP/STARTTLS 2525, SMTPS 2465; API HTTP 3000 e demonstração 3001/3444. `TLS_MODE=auto` gera CA local com OpenSSL; `external` carrega PEM; `off` desativa TLS.

## Certificados e segurança

Instala apenas o certificado público da CA nos clientes, nunca a chave privada. O hostname deve existir nos SAN do certificado. A consola permite importar PEM e configurar endereços, com reinício necessário.

---

[API de gestão](api.md) · [TLS](tls.md) · [SDK](sdk.md)
