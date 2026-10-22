# TLS e configuração de clientes

## Estratégia

As três terminações TLS são efetuadas pelo próprio servidor Node.js:

- **HTTPS:** `HTTPS_PORT`, valor por omissão 3443
- **SMTP + STARTTLS:** `SMTP_PORT`, valor por omissão 2525
- **SMTPS (TLS implícito):** `SMTPS_PORT`, valor por omissão 2465

A consola compilada em `web/dist` é servida diretamente pelo HTTPS do Node.js; executar `npm run build:console` antes de iniciar o backend. O HTTP local permanece configurável com `PORT` (omissão 3000). A API de demonstração fica num listener distinto: HTTP `DEMO_PORT` (3001) e HTTPS `DEMO_HTTPS_PORT` (3444). Por omissão, todos os listeners usam loopback.

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

A consola permite importar ficheiros PEM quando o operador fornece um token administrativo. Configura `ADMIN_TOKEN` com um segredo forte no ambiente do processo e configura previamente `TLS_CERT_FILE` e `TLS_KEY_FILE`. A API `PUT /api/admin/tls` aceita `cert` e `key` (PEM) **apenas através de HTTPS**, valida que a chave corresponde ao certificado e escreve os ficheiros com permissões restritas. A identidade importada torna-se ativa após reiniciar o processo. A chave privada nunca pode ser descarregada pela API ou pela consola. O token não é persistido no browser.

## Endpoints e isolamento

Os endpoints de demonstração continuam separados logicamente dos endpoints de gestão; o isolamento físico numa porta própria continua por implementar. Não exponhas estes endpoints publicamente sem controlo de acesso.

## Endereços e gestão

O nome público anunciado aos clientes é `PUBLIC_HOST` (omissão `localhost`); as interfaces de escuta são `HOST` e `SMTP_HOST` (omissão `127.0.0.1`). Os nomes SAN do certificado têm de corresponder ao host efetivamente utilizado. Estes valores são atualmente configurados por ambiente e visualizados, mas não editados, na consola. A alteração por interface web requer autenticação administrativa e gestão segura de reinício.

Para desenvolvimento da consola, o Vite usa as portas locais 3000 (`/api`) e 3001 (`/demo`). Na versão compilada e servida pelo Node, os endpoints da API usam `/api`, enquanto o envio de demonstração é dirigido ao listener HTTPS próprio na porta 3444.

**Nota de segurança:** a atualização de dois ficheiros PEM não constitui uma transação de filesystem atómica entre ambos; mantém uma cópia de recuperação antes da rotação. É necessário validar reinício e recuperação operacional antes de usar em ambientes públicos.

## Automatic local CA

The default `TLS_MODE=auto` generates a local development CA and a server certificate with SAN entries drawn from `TLS_SERVER_NAMES` (default `localhost,127.0.0.1`). The implementation invokes OpenSSL at first start, so **OpenSSL must be installed and in PATH**. The certificates are generated under `TLS_CERTIFICATES_DIR` (default `./data/certificates`), and are excluded from version control. Server certificates are regenerated near expiration. The local CA private key must be treated as a secret.

The public CA may be downloaded from the console under **Ligações e TLS**, or by `GET /tls/ca.pem`. Clients should trust only that CA certificate explicitly; never disable certificate verification by default.

## Changing addresses through the console

Network host and port fields can be edited in **Ligações e TLS** after setting `ADMIN_TOKEN`. `PUT /admin/network` writes a restricted-permission JSON file configured through `NETWORK_SETTINGS_FILE` (default `./data/network-settings.json`). Values are applied after restarting the Node process. A changed public hostname must also be present in the certificate SANs, otherwise TLS verification will fail.

No self-service PKCS#12 parser has been implemented: external identities are PEM certificate/key pairs. TLS off mode is available with `TLS_MODE=off` only for trusted local testing.

## Atomic managed identity rotation

Certificate import writes a single JSON PEM identity at `TLS_MANAGED_IDENTITY_FILE` (default `./data/certificates/imported-identity.json`), with mode 0600, a temporary file and an atomic rename. The previous identity is copied to `.previous` for local manual recovery. On restart the managed identity takes precedence over auto-generated or external PEM files. Do not expose or commit either JSON file: each contains the **private** server key. The import endpoint does not return the key. Rotations are not applied to open sockets until restart.
