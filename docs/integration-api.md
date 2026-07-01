# API de integrações do Pugotitasks

Base URL: `https://task.pugotilab.com/api/integrations/v1`

## Autenticação

Os endpoints externos exigem um Bearer Token. O token é armazenado no servidor apenas como
hash SHA-256, aparece uma única vez na criação e pode ser revogado sem alterar a senha da conta.

Com uma sessão Pugotilab já autenticada no navegador, crie o token pelo console da página:

```js
const response = await fetch("/api/integrations/tokens", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Alexa",
    scopes: ["tasks:read", "tasks:write"],
    expiresInDays: 365
  })
});
console.log(await response.json());
```

Use o valor `token` retornado como `Authorization: Bearer pgt_...`.

Os escopos disponíveis são:

- `tasks:read`: consultar usuário, resumo, tarefas, pastas e flags.
- `tasks:write`: criar, editar e concluir tarefas.

Gerenciamento pela sessão web:

| Método | Rota | Operação |
| --- | --- | --- |
| `GET` | `/api/integrations/tokens` | Lista integrações sem revelar os tokens. |
| `POST` | `/api/integrations/tokens` | Cria e revela um token uma única vez. |
| `DELETE` | `/api/integrations/tokens/:id` | Revoga uma integração. |

`expiresInDays` aceita de 1 a 3650 dias. Use `null` apenas quando a integração realmente não
puder rotacionar credenciais.

## Endpoints externos

| Método | Rota | Escopo | Operação |
| --- | --- | --- | --- |
| `GET` | `/me` | `tasks:read` | Confirma a conta associada ao token. |
| `GET` | `/summary?date=YYYY-MM-DD` | `tasks:read` | Totais de hoje, atrasadas, pendentes e concluídas. |
| `GET` | `/folders` | `tasks:read` | Lista as pastas disponíveis. |
| `GET` | `/flags` | `tasks:read` | Lista as flags disponíveis. |
| `GET` | `/tasks` | `tasks:read` | Lista tarefas com filtros. |
| `GET` | `/tasks/:id` | `tasks:read` | Consulta uma tarefa. |
| `POST` | `/tasks` | `tasks:write` | Cria uma tarefa. |
| `PATCH` | `/tasks/:id` | `tasks:write` | Edita uma tarefa. |
| `POST` | `/tasks/:id/complete` | `tasks:write` | Conclui uma tarefa. |

### Consulta de tarefas

`GET /tasks` aceita:

- `filter`: `today`, `overdue`, `pending`, `completed` ou `all`. Padrão: `pending`.
- `date`: data de referência no formato `YYYY-MM-DD`. Padrão: data local do servidor.
- `folderId`: restringe a uma pasta.
- `limit`: entre 1 e 200. Padrão: 100.

```bash
curl -H "Authorization: Bearer $PUGOTITASKS_TOKEN" \
  "https://task.pugotilab.com/api/integrations/v1/tasks?filter=today"
```

### Criação de tarefa

`folderId` é opcional e usa a primeira pasta da conta. Também é possível informar `folderName`
e `flagName`, facilitando comandos de voz.

```bash
curl -X POST \
  -H "Authorization: Bearer $PUGOTITASKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Comprar ração","folderName":"Casa","dueAt":"2026-07-01T18:00"}' \
  "https://task.pugotilab.com/api/integrations/v1/tasks"
```

### Respostas de erro

- `400`: entrada ou filtro inválido.
- `401`: token ausente, inválido, expirado ou revogado.
- `403`: token sem o escopo necessário.
- `404`: recurso não encontrado.

## Integração com Alexa

Esta API é o recurso protegido que a skill consumirá. O fluxo de Account Linking da Alexa ainda
deverá ser implementado no PugotiProfile com OAuth 2.0 Authorization Code; ele emitirá credenciais
aceitas por esta camada ou trocará o código por um token de integração equivalente.
