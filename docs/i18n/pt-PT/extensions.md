# Extensões

A consola do Virtual Inbox descobre extensões através do **registry público, apenas de leitura**, em `GET /api/extensions`.

Abre **Sistema → Extensões** para consultar módulos ativos, falhados ou desativados. Cada registo apresenta capacidades, endpoints HTTP publicados, número de pedidos, erros, duração acumulada e último código HTTP. A lista atualiza automaticamente a cada 15 segundos e pode ser atualizada manualmente. As métricas existem apenas em memória e são reiniciadas com o VI.

A opção **Ver logs desta extensão** abre o painel de logs com o filtro `extensionId` aplicado do lado do servidor. O filtro de anomalias é desativado para isolar os eventos da extensão. O log apresenta a rota lógica, o resultado, a duração e um identificador de correlação, sem guardar os payloads nem credenciais dos fornecedores.

A extensão nativa `sms-native` está ativa por omissão. É responsável pelas entradas demo `POST /demo/sms/messages` no listener principal e `POST /sms/messages` no listener dedicado. Invoca a API funcional pública `POST /api/sms/ingestions`. Para desativar apenas o emissor demo, define `VI_SMS_NATIVE_ENABLED=false` e reinicia; o registry indicará que está desativado.

As extensões ESM locais de confiança são configuradas em `VI_EXTENSIONS`. Uma extensão que falhe ao carregar aparece como `failed-N`, com diagnóstico sanitizado. A consola não instala módulos, não apresenta formulários específicos por fornecedor, não executa interfaces de terceiros e não modifica a configuração do servidor.

Consulta os guias de [integração](integration.md), [SDK](sdk.md) e [arquitetura](architecture.md). Uma extensão pode declarar a sua documentação local; a consola só apresenta ligações navegáveis para páginas que conhece, evitando apontar para URLs inexistentes.


## Criar uma extensão HTTP (V1)

O SDK de extensões (`extension-sdk/src/index.ts`) cria handlers HTTP e middleware; o cliente **funcional** `sdk/client.ts` consome a mesma API pública do VI que os clientes externos. São responsabilidades distintas. O runtime inicial carrega **ESM de confiança** no processo Node do VI. Não é Express nem um sandbox e não abre portos adicionais.

Compila o repositório antes de carregar o exemplo executável:

```sh
npm ci
npm run build:server
VI_EXTENSIONS='["./examples/extensions/ping.mjs"]' npm start
```

O exemplo regista `GET /extensions/ping` na audiência `management` e `GET /ping` na `demo`. No listener principal, consulta `GET /api/extensions/ping?name=test` e `GET /demo/ping`; o listener demo dedicado expõe `GET /ping`. A raiz do listener principal **ainda não suporta** publicações arbitrárias como `/WebAPI`.

Padrão mínimo (num módulo ESM compilado, com o SDK local compatível):

```js
const app = createApp();
app.use(async (ctx, next) => {
  await next();
  ctx.response.headers["x-test"] = "ok";
});
app.post("/provider/send", async ctx => {
  ctx.response.status = 202;
  ctx.response.body = { accepted: true };
});
export default { id: "provider-test", version: "1.0.0", app };
```

Importa `createApp` do SDK compilado, como em `examples/extensions/ping.mjs`; o pacote separado **ainda é privado e não está publicado**. A audiência por omissão é `demo`; com `{ audience: "management" }` a rota é publicada sob `/api`. O middleware pode interromper o fluxo ou substituir a resposta depois de `await next()`. Todas as rotas são validadas atomicamente antes de ficarem ativas.

Para capturar SMS, usa `VirtualInboxClient.ingestSms({from,to,body})` ou `POST /api/sms/ingestions`, **não** a rota de publicação `/demo/sms/messages` nem funções privadas do core. Um erro simulado do fornecedor **após a captura** não desfaz a mensagem; os testes de retry têm de considerar essa diferença. `X-VI-Correlation-ID` é opcional na ingestão pública, é devolvido na resposta e ainda não é persistido na mensagem.

O [guia completo de autoria](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/extension-author-guide.md), a [ADR-0002](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/adr/0002-http-extensions.md) e o [contrato de routing](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/extension-routing-contract.md) documentam manifesto, instalação, ciclo de vida, TLS, limites, erros, observabilidade e OpenAPI. O registry é apenas de leitura; IPC, hot reload, UI específica de fornecedores e publicação automática de OpenAPI de extensões não existem nesta versão.
