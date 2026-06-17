import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { Flag, Folder, Task } from "./types.js";

const allowedColors = new Set([
  "#22c55e", "#ef4444", "#3b82f6", "#f59e0b",
  "#a855f7", "#ec4899", "#14b8a6", "#64748b"
]);

export class Store {
  private db: Database.Database;

  constructor() {
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    this.db = new Database(config.dbFile);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'folder',
        position INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flags (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        folderId TEXT NOT NULL,
        flagId TEXT,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        dueAt TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        important INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(userId, position);
      CREATE INDEX IF NOT EXISTS idx_flags_user ON flags(userId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_folder ON tasks(userId, folderId, completed, position);
    `);
  }

  ensureDefaults(userId: string): void {
    const count = (this.db.prepare("SELECT COUNT(*) count FROM folders WHERE userId = ?").get(userId) as { count: number }).count;
    if (count > 0) return;

    const now = new Date().toISOString();
    const insertFolder = this.db.prepare("INSERT INTO folders (id, userId, name, icon, position, createdAt) VALUES (?, ?, ?, ?, ?, ?)");
    const insertFlag = this.db.prepare("INSERT INTO flags (id, userId, name, color, createdAt) VALUES (?, ?, ?, ?, ?)");
    this.db.transaction(() => {
      insertFolder.run(crypto.randomUUID(), userId, "Pessoal", "user", 0, now);
      insertFolder.run(crypto.randomUUID(), userId, "Trabalho", "file-text", 1, now);
      insertFlag.run(crypto.randomUUID(), userId, "Financeiro", "#22c55e", now);
      insertFlag.run(crypto.randomUUID(), userId, "Homelab", "#ef4444", now);
    })();
  }

  listFolders(userId: string): Folder[] {
    return this.db.prepare("SELECT * FROM folders WHERE userId = ? ORDER BY position, createdAt").all(userId) as Folder[];
  }

  createFolder(userId: string, name: string): Folder {
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Informe o nome da pasta.");
    const position = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 value FROM folders WHERE userId = ?").get(userId) as { value: number }).value;
    const folder: Folder = {
      id: crypto.randomUUID(), userId, name: clean, icon: "folder", position, createdAt: new Date().toISOString()
    };
    this.db.prepare("INSERT INTO folders (id, userId, name, icon, position, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(folder.id, userId, folder.name, folder.icon, folder.position, folder.createdAt);
    return folder;
  }

  updateFolder(userId: string, id: string, name: string): Folder | null {
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Informe o nome da pasta.");
    this.db.prepare("UPDATE folders SET name = ? WHERE id = ? AND userId = ?").run(clean, id, userId);
    return this.db.prepare("SELECT * FROM folders WHERE id = ? AND userId = ?").get(id, userId) as Folder | undefined ?? null;
  }

  deleteFolder(userId: string, id: string): boolean {
    const count = (this.db.prepare("SELECT COUNT(*) count FROM folders WHERE userId = ?").get(userId) as { count: number }).count;
    if (count <= 1) throw new Error("Mantenha pelo menos uma pasta.");
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM tasks WHERE folderId = ? AND userId = ?").run(id, userId);
      return this.db.prepare("DELETE FROM folders WHERE id = ? AND userId = ?").run(id, userId).changes > 0;
    })();
  }

  listFlags(userId: string): Flag[] {
    return this.db.prepare("SELECT * FROM flags WHERE userId = ? ORDER BY name").all(userId) as Flag[];
  }

  createFlag(userId: string, name: string, color: string): Flag {
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new Error("Informe o nome da flag.");
    const selectedColor = allowedColors.has(color) ? color : "#3b82f6";
    const flag: Flag = { id: crypto.randomUUID(), userId, name: clean, color: selectedColor, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO flags (id, userId, name, color, createdAt) VALUES (?, ?, ?, ?, ?)")
      .run(flag.id, userId, flag.name, flag.color, flag.createdAt);
    return flag;
  }

  deleteFlag(userId: string, id: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE tasks SET flagId = NULL WHERE flagId = ? AND userId = ?").run(id, userId);
      return this.db.prepare("DELETE FROM flags WHERE id = ? AND userId = ?").run(id, userId).changes > 0;
    })();
  }

  listTasks(userId: string): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE userId = ?
      ORDER BY completed, important DESC, position, createdAt DESC
    `).all(userId) as Array<Omit<Task, "completed" | "important"> & { completed: number; important: number }>;
    return rows.map((row) => ({ ...row, completed: Boolean(row.completed), important: Boolean(row.important) }));
  }

  createTask(userId: string, input: Partial<Task>): Task {
    const title = String(input.title ?? "").trim().slice(0, 180);
    const folderId = String(input.folderId ?? "");
    if (!title) throw new Error("Informe o título da tarefa.");
    if (!this.db.prepare("SELECT 1 FROM folders WHERE id = ? AND userId = ?").get(folderId, userId)) {
      throw new Error("Pasta inválida.");
    }
    const flagId = input.flagId && this.db.prepare("SELECT 1 FROM flags WHERE id = ? AND userId = ?").get(input.flagId, userId)
      ? input.flagId : null;
    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(), userId, folderId, flagId,
      title, notes: String(input.notes ?? "").trim().slice(0, 4000),
      dueAt: input.dueAt || null, completed: false, important: Boolean(input.important),
      position: 0, createdAt: now, updatedAt: now, completedAt: null
    };
    this.db.prepare(`
      INSERT INTO tasks (id, userId, folderId, flagId, title, notes, dueAt, completed, important, position, createdAt, updatedAt, completedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)
    `).run(task.id, userId, folderId, flagId, task.title, task.notes, task.dueAt, task.important ? 1 : 0, task.position, now, now);
    return task;
  }

  updateTask(userId: string, id: string, input: Partial<Task>): Task | null {
    const current = this.db.prepare("SELECT * FROM tasks WHERE id = ? AND userId = ?").get(id, userId) as Record<string, unknown> | undefined;
    if (!current) return null;

    const folderId = input.folderId === undefined ? String(current.folderId) : String(input.folderId);
    if (!this.db.prepare("SELECT 1 FROM folders WHERE id = ? AND userId = ?").get(folderId, userId)) {
      throw new Error("Pasta inválida.");
    }
    const completed = input.completed === undefined ? Boolean(current.completed) : Boolean(input.completed);
    const flagId = input.flagId === undefined
      ? current.flagId as string | null
      : input.flagId && this.db.prepare("SELECT 1 FROM flags WHERE id = ? AND userId = ?").get(input.flagId, userId)
        ? input.flagId : null;
    const title = input.title === undefined ? String(current.title) : String(input.title).trim().slice(0, 180);
    if (!title) throw new Error("Informe o título da tarefa.");
    const now = new Date().toISOString();
    const completedAt = completed ? String(current.completedAt || now) : null;

    this.db.prepare(`
      UPDATE tasks SET folderId = ?, flagId = ?, title = ?, notes = ?, dueAt = ?,
        completed = ?, important = ?, updatedAt = ?, completedAt = ?
      WHERE id = ? AND userId = ?
    `).run(
      folderId, flagId, title,
      input.notes === undefined ? current.notes : String(input.notes).trim().slice(0, 4000),
      input.dueAt === undefined ? current.dueAt : input.dueAt || null,
      completed ? 1 : 0,
      input.important === undefined ? current.important : input.important ? 1 : 0,
      now, completedAt, id, userId
    );
    return this.listTasks(userId).find((task) => task.id === id) ?? null;
  }

  deleteTask(userId: string, id: string): boolean {
    return this.db.prepare("DELETE FROM tasks WHERE id = ? AND userId = ?").run(id, userId).changes > 0;
  }
}

export const store = new Store();
