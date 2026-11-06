# Extensões

A consola do Virtual Inbox descobre extensões através do **registry público, apenas de leitura**, em `GET /api/extensions`.

Abre **Sistema → Extensões** para consultar módulos ativos, falhados ou desativados. Cada registo apresenta capacidades, endpoints HTTP publicados, número de pedidos, erros, duração acumulada e último código HTTP. A lista atualiza automaticamente a cada 15 segundos e pode ser atualizada manualmente. As métricas existem apenas em memória e são reiniciadas com o VI.

A opção **Ver logs desta extensão** abre o painel de logs com o filtro `extensionId` aplicado do lado do servidor. O filtro de anomalias é desativado para isolar os eventos da extensão. O log apresenta a rota lógica, o resultado, a duração e um identificador de correlação, sem guardar os payloads nem credenciais dos fornecedores.

A extensão nativa `sms-native` está ativa por omissão. É responsável pelas entradas demo `POST /demo/sms/messages` no listener principal e `POST /sms/messages` no listener dedicado. Invoca a API funcional pública `POST /api/sms/ingestions`. Para desativar apenas o emissor demo, define `VI_SMS_NATIVE_ENABLED=false` e reinicia; o registry indicará que está desativado.

As extensões ESM locais de confiança são configuradas em `VI_EXTENSIONS`. Uma extensão que falhe ao carregar aparece como `failed-N`, com diagnóstico sanitizado. A consola não instala módulos, não apresenta formulários específicos por fornecedor, não executa interfaces de terceiros e não modifica a configuração do servidor.

Consulta os guias de [integração](integration.md), [SDK](sdk.md) e [arquitetura](architecture.md). Uma extensão pode declarar a sua documentação local; a consola só apresenta ligações navegáveis para páginas que conhece, evitando apontar para URLs inexistentes.
