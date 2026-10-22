# TLS e configuração de clientes

## Estratégia

As três terminações TLS são efetuadas pelo próprio servidor Node.js:

- **HTTPS:** `HTTPS_PORT`, valor por omissão 3443
- **SMTP + STARTTLS:** `SMTP_PORT`, valor por omissão 2525
- **SMTPS (TLS implícito):** `SMTPS_PORT`, valor por omissão 2465

O HTTP local permanece configurável com `PORT` (omissão 3000). Por omissão, todos os listeners usam loopback.

## Ativar

A aplicação carrega a mesma identidade PEM para os três listeners. Define simultaneamente:

```sh
TLS_CERT_FILE=/secrets/server.crt
TLS_KEY_FILE=/secrets/server.key
PUBLIC_HOST=localhost
```

Para gerar uma identidade de desenvolvimento, com OpenSSL disponível:

```sh
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 -keyout server.key -out server.crt -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Coloca a chave privada num diretório com permissões restritas e **fora do controlo de versões**. Não instales nem descarregues a chave privada no computador do cliente; só o certificado público `GET /tls/certificate.pem` deve ser distribuído.

O certificado autoassinado só é confiável quando explicitamente instalado como âncora de confiança no cliente. Para exposição pública, prefere certificados emitidos por CA reconhecida.

## Importação administrativa pela consola

A interface apresenta os certificados atualmente configurados, mas **não aceita upload da chave privada enquanto não houver autenticação/autorização administrativa e HTTPS confiável**. Por enquanto, os ficheiros PEM são configurados no servidor e este é reiniciado. Isto impede que qualquer utilizador anónimo possa substituir a identidade TLS.

## Endpoints e isolamento

Os endpoints de demonstração continuam separados logicamente dos endpoints de gestão; o isolamento físico numa porta própria continua por implementar. Não exponhas estes endpoints publicamente sem controlo de acesso.
