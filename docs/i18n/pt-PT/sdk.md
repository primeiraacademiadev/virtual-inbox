# Automatizar testes com o SDK TypeScript

O cliente está em `sdk/client.ts` e utiliza o `fetch` nativo do Node.js 24+. Ainda não é um pacote npm publicado.

## Teste de envio de email

```ts
import {VirtualInboxClient} from "../sdk/client.js";
const api = new VirtualInboxClient("http://127.0.0.1:3000");
await api.withInbox("email", async inbox => {
  // Configura a aplicação em teste para enviar para inbox.address.
  // Executa a ação na aplicação que provoca o envio SMTP.
  const message = await api.wait(inbox,{subjectContains:"OTP"},15000);
  if(!message)throw Error("OTP não recebido");
  if(!message.body.includes("123456"))throw Error("Código incorreto");
});
```

O `withInbox` elimina a caixa em `finally`, incluindo quando uma asserção falha. A espera não consome mensagens.

## Teste SMS

Usa `withInbox("sms",...)`; configura o fornecedor SMS da aplicação para enviar para `http://127.0.0.1:3001/sms/messages`, desencadeia a ação e verifica com `wait`.

## Cursores, tempos e isolamento

O argumento `after` corresponde a uma sequência numérica de mensagens. Não é um ID SSE. `wait` devolve uma mensagem ou `null` quando a API responde 204. Usa destinatários aleatórios ou exclusivos por teste para evitar interferência. A memória e as sessões desaparecem após reinício.

## Anexos

Os dados JSON incluem metadados dos anexos. Usa `api.download(inbox,message.id,attachment.id)` para obter os bytes e comparar hashes ou conteúdos. Verifica limites SMTP e quotas no ambiente de aceitação.

[Integrar como mock](integration.md) · [API](api.md)
