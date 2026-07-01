import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pugotitasks-api-"));
process.env.DB_FILE = path.join(temporaryDirectory, "tasks.db");

const { store } = await import("./store.js");
const { handleIntegrationApi } = await import("./integration-api.js");

const server = http.createServer((req, res) => {
  handleIntegrationApi(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Erro interno.";
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Servidor de teste indisponível.");
const baseUrl = `http://127.0.0.1:${address.port}/api/integrations/v1`;

after(() => {
  server.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("API rejeita requisição sem Bearer Token", async () => {
  const response = await fetch(`${baseUrl}/tasks`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /^Bearer/);
});

test("escopo somente leitura não permite criar tarefa", async () => {
  store.ensureDefaults("reader");
  const { token } = store.createIntegrationToken("reader", { name: "Leitura", scopes: ["tasks:read"] });
  const response = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Não deve ser criada" })
  });
  assert.equal(response.status, 403);
  assert.equal(store.listTasks("reader").length, 0);
});

test("API cria, consulta e conclui tarefa", async () => {
  store.ensureDefaults("alexa-user");
  const folder = store.listFolders("alexa-user")[0];
  const { token } = store.createIntegrationToken("alexa-user", {
    name: "Alexa",
    scopes: ["tasks:read", "tasks:write"]
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const createdResponse = await fetch(`${baseUrl}/tasks?date=2099-07-01`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Comprar ração", folderName: folder.name, dueAt: "2099-07-01T18:00" })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { task: { id: string; folder: { name: string } } };
  assert.equal(created.task.folder.name, folder.name);

  const todayResponse = await fetch(`${baseUrl}/tasks?filter=today&date=2099-07-01`, { headers });
  assert.equal(todayResponse.status, 200);
  const today = await todayResponse.json() as { count: number; tasks: Array<{ title: string }> };
  assert.equal(today.count, 1);
  assert.equal(today.tasks[0]?.title, "Comprar ração");

  const completedResponse = await fetch(`${baseUrl}/tasks/${created.task.id}/complete?date=2099-07-01`, {
    method: "POST",
    headers
  });
  assert.equal(completedResponse.status, 200);

  const summaryResponse = await fetch(`${baseUrl}/summary?date=2099-07-01`, { headers });
  const summary = await summaryResponse.json() as { counts: { today: number; completed: number } };
  assert.deepEqual(summary.counts, { today: 0, overdue: 0, pending: 0, completed: 1 });
});
