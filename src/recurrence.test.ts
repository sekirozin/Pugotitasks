import assert from "node:assert/strict";
import test from "node:test";
import { getNextRecurrenceDueAt } from "./recurrence.js";
import type { RecurrenceType } from "./types.js";

function task(type: RecurrenceType, dueAt: string, interval = 1, recurrenceEndAt: string | null = null) {
  return { dueAt, recurrenceType: type, recurrenceInterval: interval, recurrenceEndAt };
}

test("cria a ocorrência diária seguinte", () => {
  assert.equal(getNextRecurrenceDueAt(task("daily", "2026-07-01T10:00"), new Date(2026, 6, 1, 9)), "2026-07-02T10:00");
});

test("pula ocorrências diárias já atrasadas", () => {
  assert.equal(getNextRecurrenceDueAt(task("daily", "2026-07-01"), new Date(2026, 6, 3, 12)), "2026-07-04");
});

test("repete semanalmente", () => {
  assert.equal(getNextRecurrenceDueAt(task("weekly", "2026-07-01"), new Date(2026, 6, 1, 12)), "2026-07-08");
});

test("aceita período personalizado em dias", () => {
  assert.equal(getNextRecurrenceDueAt(task("custom", "2026-07-01", 3), new Date(2026, 6, 1, 12)), "2026-07-04");
});

test("encerra a série depois da data final", () => {
  assert.equal(getNextRecurrenceDueAt(task("weekly", "2026-07-01", 7, "2026-07-07"), new Date(2026, 6, 1, 12)), null);
});
