# Skill Alexa do Pugotitasks

## Serviços

- API de tarefas: `https://task.pugotilab.com/api/integrations/v1`
- OAuth Authorization URI: `https://pugotilab.com/auth/oauth/authorize`
- OAuth Access Token URI: `https://pugotilab.com/auth/oauth/token`
- Endpoint da Skill sugerido: `https://alexa-task.pugotilab.com/alexa`
- Porta local da Skill: `3011`

O domínio da Skill deve ser criado manualmente no Cloudflare apontando para `http://172.17.0.1:3011`.

## Criação no Alexa Developer Console

1. Crie uma Custom Skill chamada `Pugotitasks`, idioma `Português (BR)` e modelo `Custom`.
2. Em **Endpoint**, selecione `HTTPS` e informe `https://alexa-task.pugotilab.com/alexa`.
3. Escolha o certificado correspondente a domínio com certificado confiável.
4. Copie o Skill ID para `ALEXA_SKILL_ID` no serviço `pugotitasks-alexa`.
5. Em **Interaction Model > JSON Editor**, cole `alexa-skill/interaction-models/pt-BR.json` e clique em Build.
6. Em **Account Linking**, habilite Authorization Code Grant com PKCE.

Configuração do Account Linking:

| Campo | Valor |
| --- | --- |
| Authorization URI | `https://pugotilab.com/auth/oauth/authorize` |
| Access Token URI | `https://pugotilab.com/auth/oauth/token` |
| Client ID | Valor de `ALEXA_OAUTH_CLIENT_ID` no PugotiProfile |
| Client Secret | Valor de `ALEXA_OAUTH_CLIENT_SECRET` no PugotiProfile |
| Authentication Scheme | HTTP Basic |
| Scope | `tasks:read` e `tasks:write` |
| PKCE | Habilitado, método `S256` |
| Default token expiration | `3600` segundos |

Depois de salvar, copie todas as **Alexa Redirect URLs** mostradas pelo console para a variável
`ALEXA_REDIRECT_URIS` do PugotiProfile, separadas por vírgula. Reinicie o serviço de autenticação.

## Comandos disponíveis

- “Alexa, abra Pugoti tarefas.”
- “Alexa, peça ao Pugoti tarefas minhas tarefas de hoje.”
- “Alexa, peça ao Pugoti tarefas minhas tarefas atrasadas.”
- “Alexa, peça ao Pugoti tarefas para adicionar comprar ração.”
- “Alexa, peça ao Pugoti tarefas para adicionar para hoje pagar a conta.”
- “Alexa, peça ao Pugoti tarefas para concluir comprar ração.”

As respostas leem no máximo cinco títulos por vez para não produzir falas excessivamente longas.

## Segurança

- O backend valida assinatura e timestamp das requisições usando o SDK oficial da Amazon.
- O Skill ID pode ser fixado com `ALEXA_SKILL_ID`.
- Authorization Codes duram 10 minutos e só podem ser utilizados uma vez.
- PKCE `S256` é obrigatório.
- Access tokens duram uma hora; refresh tokens duram um ano.
- Códigos e refresh tokens são persistidos somente como SHA-256.
