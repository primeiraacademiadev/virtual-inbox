# Gerador de identidades sintéticas

## Contrato

O servidor é o único responsável pela geração, pela verificação de colisões e pela criação atómica de inboxes. O campo `id` é um UUID independente do `address`. O pedido explícito `address` / `phoneNumber` continua a ter precedência; sem identificador, `generation` é opcional e o servidor usa as variáveis `IDENTITY_DEFAULT_*`.

```json
{"ttlSeconds":1800,"generation":{"locale":"fr-FR","strategy":"LAST_FIRST","safeTestData":false}}
```

`GET /identity-generation/options` anuncia locales, estratégias e defaults de ambiente. As preferências do diálogo React (bandeira, estratégia, SAFE e indicativo) persistem em `sessionStorage`, exceto o identificador manual. Uma alteração do idioma da consola atualiza o locale sugerido.

Estratégias de email: `FIRST_LAST`, `LAST_FIRST`, `FIRST_MIDDLE_LAST`, `FIRST_LAST_SUFFIX`, `RANDOM`. Nomes e apelidos são normalizados para ASCII. Domínio por omissão: `sandbox.test`.

Estratégia telefónica `NATIONAL_FORMAT`: perfis `pt-PT` (+351, 9 dígitos), `en-US` (+1, 10 dígitos) e `fr-FR` (+33, números nacionais de 10 dígitos com tronco 0). O sufixo é `401`, incluindo no formato internacional. O indicativo é opcional. A geração utiliza aleatoriedade de `node:crypto`, verifica a unicidade dos números nacionais e internacionais e repete até `IDENTITY_DEFAULT_GENERATION_MAX_ATTEMPTS`. A API devolve `IDENTITY_GENERATION_EXHAUSTED` quando esgota as tentativas.

`safeTestData=true` usa endereços do domínio `sandbox.test` e números sintéticos com prefixo +999 (ou 000...401 sem indicativo). Este modo pode ser rejeitado por validações telefónicas nacionais. **Com o modo desativado os números podem pertencer a pessoas reais; a aplicação nunca deve enviar SMS de teste por uma operadora real.** Não afirmamos que +999 substitui uma política oficial de numeração reservada.

## Proveniência dos catálogos

Cada catálogo é um subconjunto editorial e representativo de nomes próprios e apelidos, não uma cópia integral de dados oficiais nem um extrato de pessoas reais:

- `pt-PT`: seleção ilustrativa de nomes portugueses baseada em nomes frequentes divulgados pelo Instituto dos Registos e do Notariado (IRN). Apelidos portugueses comuns selecionados editorialmente. Fonte para manutenção: https://irn.justica.gov.pt
- `en-US`: nomes próprios comuns dos EUA; fonte de referência oficial para expansão: https://www.ssa.gov/oact/babynames/ . Apelidos comuns; fonte de referência para revisão: https://www.census.gov/topics/population/genealogy/data.html
- `fr-FR`: nomes próprios franceses; fonte aberta oficial para expansão: https://www.insee.fr/fr/statistiques/8595130 . Apelidos franceses comuns selecionados editorialmente.

Não existe distribuição de bases de dados de cidadãos, nem garantia de que uma combinação inventada não coincida com o nome de uma pessoa real. Antes de substituir estes subconjuntos por datasets completos, rever licenças e preservação de proveniência. Os perfis telefónicos são perfis de demonstração, **não um validador exaustivo dos planos de numeração nacionais**.

## Defaults

```dotenv
IDENTITY_DEFAULT_LOCALE=pt-PT
IDENTITY_DEFAULT_EMAIL_STRATEGY=FIRST_LAST
IDENTITY_DEFAULT_PHONE_STRATEGY=NATIONAL_FORMAT
IDENTITY_DEFAULT_PHONE_INCLUDE_COUNTRY_CODE=true
IDENTITY_DEFAULT_SAFE_TEST_DATA=false
IDENTITY_DEFAULT_GENERATION_MAX_ATTEMPTS=100
IDENTITY_DEFAULT_EMAIL_DOMAIN=sandbox.test
```

A lógica encontra-se segregada em `src/identity-generation/`, com catálogos JSON independentes da API e do domínio. O catálogo deve evoluir com novos locales sem alterar a identidade técnica das inboxes.
