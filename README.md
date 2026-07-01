# Pugotitasks

Gerenciador pessoal de tarefas integrado à conta Pugotilab.

## Recursos

- Pastas de listas
- Flags coloridas
- Tarefas com notas, prazo, importância e conclusão
- Pesquisa e visões Hoje, Importantes e Concluídas
- Tema claro e escuro
- Pugotiprofile compartilhado
- Persistência SQLite isolada por usuário
- API externa versionada para integrações

## Desenvolvimento

```bash
npm install
npm run dev
```

## Serviço

```bash
docker compose up -d --build
```

## API de integrações

A API externa usa Bearer Tokens revogáveis e nunca expõe notas ou o cofre. Consulte
[`docs/integration-api.md`](docs/integration-api.md) para criar um token e usar os endpoints.
