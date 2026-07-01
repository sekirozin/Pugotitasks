const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeText, spokenList } = require("./index");

test("normaliza títulos para conclusão por voz", () => {
  assert.equal(normalizeText("  Fazer Transferência  "), "fazer transferencia");
});

test("limita a leitura a cinco tarefas", () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({ title: `Tarefa ${index + 1}` }));
  const speech = spokenList(tasks, "pendentes");
  assert.match(speech, /Você tem 7 tarefas pendentes/);
  assert.match(speech, /E mais 2/);
  assert.doesNotMatch(speech, /Tarefa 6/);
});
