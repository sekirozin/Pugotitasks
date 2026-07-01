import type { RecurrenceType, Task } from "./types.js";

const recurrenceTypes = new Set<RecurrenceType>(["none", "daily", "weekly", "custom"]);

export function normalizeRecurrenceType(value: unknown): RecurrenceType {
  return recurrenceTypes.has(value as RecurrenceType) ? value as RecurrenceType : "none";
}

export function normalizeRecurrenceInterval(type: RecurrenceType, value: unknown): number {
  if (type === "daily") return 1;
  if (type === "weekly") return 7;
  if (type === "none") return 1;
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new Error("O intervalo personalizado deve ter entre 1 e 365 dias.");
  }
  return interval;
}

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    0,
    0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDate(date: Date, includeTime: boolean): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  if (!includeTime) return datePart;
  return `${datePart}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function getNextRecurrenceDueAt(
  task: Pick<Task, "dueAt" | "recurrenceType" | "recurrenceInterval" | "recurrenceEndAt">,
  completedAt = new Date()
): string | null {
  if (!task.dueAt || task.recurrenceType === "none") return null;
  const due = parseLocalDate(task.dueAt);
  if (!due) return null;

  const interval = normalizeRecurrenceInterval(task.recurrenceType, task.recurrenceInterval);
  const next = new Date(due);
  do {
    next.setDate(next.getDate() + interval);
  } while (next <= completedAt);

  if (task.recurrenceEndAt) {
    const end = parseLocalDate(task.recurrenceEndAt);
    if (end) {
      end.setHours(23, 59, 59, 999);
      if (next > end) return null;
    }
  }

  return formatLocalDate(next, task.dueAt.includes("T"));
}
