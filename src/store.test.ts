import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pugotitasks-recurrence-"));
process.env.DB_FILE = path.join(temporaryDirectory, "tasks.db");
const { Store } = await import("./store.js");

test("concluir tarefa recorrente cria uma única próxima ocorrência", () => {
  const store = new Store();
  store.ensureDefaults("test-user");
  const folder = store.listFolders("test-user")[0];
  const original = store.createTask("test-user", {
    folderId: folder.id,
    title: "Rotina diária",
    dueAt: "2099-07-01T10:00",
    recurrenceType: "daily"
  });

  store.updateTask("test-user", original.id, { completed: true });
  store.updateTask("test-user", original.id, { completed: true });

  const tasks = store.listTasks("test-user");
  assert.equal(tasks.length, 2);
  assert.equal(tasks.filter((item) => !item.completed).length, 1);
  assert.equal(tasks.find((item) => !item.completed)?.dueAt, "2099-07-02T10:00");
  assert.equal(tasks.find((item) => !item.completed)?.recurrenceParentId, original.id);
});

test("token de integração autentica apenas até ser revogado", () => {
  const store = new Store();
  const created = store.createIntegrationToken("test-user", {
    name: "Alexa",
    scopes: ["tasks:read", "tasks:write"],
    expiresInDays: 30
  });

  assert.match(created.token, /^pgt_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(store.authenticateIntegrationToken(created.token), {
    tokenId: created.integration.id,
    userId: "test-user",
    scopes: ["tasks:read", "tasks:write"]
  });
  assert.equal(store.listIntegrationTokens("test-user")[0]?.lastUsedAt !== null, true);
  assert.equal(store.revokeIntegrationToken("test-user", created.integration.id), true);
  assert.equal(store.authenticateIntegrationToken(created.token), null);
});

test("token de integração não pode ser revogado por outro usuário", () => {
  const store = new Store();
  const created = store.createIntegrationToken("owner", { name: "Alexa", scopes: ["tasks:read"] });

  assert.equal(store.revokeIntegrationToken("other-user", created.integration.id), false);
  assert.equal(store.authenticateIntegrationToken(created.token)?.userId, "owner");
});
