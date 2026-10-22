# Automatizar testes

Criar caixas efémeras, provocar o envio e esperar pela mensagem sem a consumir.

## Cliente TypeScript

O SDK está em `sdk/client.ts` e utiliza o `fetch` nativo. Cria uma `VirtualInboxClient`, usa `withInbox("email", async inbox => { ... })` e chama `api.wait(inbox, {subjectContains:"OTP"}, 15000)`. A caixa é eliminada no `finally`.

## Critérios de verificação

O endpoint de espera responde 200 com mensagem, ou 204 quando o tempo termina. O cursor `after` usa sequência de mensagens, não IDs de eventos SSE.

---

[API de gestão](api.md) · [TLS](tls.md) · [SDK](sdk.md)
