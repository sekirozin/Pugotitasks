import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { Flag, Folder, Note, NoteFolder, Task, VaultSettings } from "./types.js";
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
        color TEXT NOT NULL DEFAULT '#64748b',
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
      CREATE TABLE IF NOT EXISTS note_folders (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'note',
        color TEXT NOT NULL DEFAULT '#f59e0b',
        position INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        folderId TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_folders_user ON note_folders(userId, position);
      CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(userId, folderId, createdAt);
    `);
    this.migrate();
  }
  private migrate(): void {
    let cols = this.db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "color")) {
      this.db.exec("ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT '#64748b'");
    }
    cols = this.db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "title")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT ''");
    }
    if (!cols.some((c) => c.name === "pinnedAt")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN pinnedAt TEXT");
    }
    cols = this.db.prepare("PRAGMA table_info(note_folders)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "locked")) {
      this.db.exec("ALTER TABLE note_folders ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
  ensureDefaults(userId: string): void {
    const count = (this.db.prepare("SELECT COUNT(*) count FROM folders WHERE userId = ?").get(userId) as { count: number }).count;
    const now = new Date().toISOString();
    if (count === 0) {
      const insertFolder = this.db.prepare("INSERT INTO folders (id, userId, name, icon, color, position, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertFlag = this.db.prepare("INSERT INTO flags (id, userId, name, color, createdAt) VALUES (?, ?, ?, ?, ?)");
      this.db.transaction(() => {
        insertFolder.run(crypto.randomUUID(), userId, "Pessoal", "user", "#22c55e", 0, now);
        insertFolder.run(crypto.randomUUID(), userId, "Trabalho", "file-text", "#3b82f6", 1, now);
        insertFlag.run(crypto.randomUUID(), userId, "Financeiro", "#22c55e", now);
        insertFlag.run(crypto.randomUUID(), userId, "Homelab", "#ef4444", now);
      })();
      const nfCount = (this.db.prepare("SELECT COUNT(*) count FROM note_folders WHERE userId = ?").get(userId) as { count: number }).count;
      if (nfCount === 0) {
        this.db.prepare("INSERT INTO note_folders (id, userId, name, icon, color, position, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), userId, "Links", "link", "#a855f7", 0, now);
      }
    }
    const vaultFolder = this.db.prepare("SELECT id FROM note_folders WHERE userId = ? AND locked = 1").get(userId) as { id: string } | undefined;
    if (!vaultFolder) {
      const maxPos = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 value FROM note_folders WHERE userId = ?").get(userId) as { value: number }).value;
      this.db.prepare("INSERT INTO note_folders (id, userId, name, icon, color, position, createdAt, locked) VALUES (?, ?, ?, ?, ?, ?, ?, 1)")
        .run(crypto.randomUUID(), userId, "Cofre", "lock", "#64748b", maxPos, now);
    }
  }
  listFolders(userId: string): Folder[] {
    return this.db.prepare("SELECT * FROM folders WHERE userId = ? ORDER BY position, createdAt").all(userId) as Folder[];
  }
  createFolder(userId: string, name: string, icon?: string, color?: string): Folder {
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Informe o nome da pasta.");
    const position = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 value FROM folders WHERE userId = ?").get(userId) as { value: number }).value;
    const folder: Folder = {
      id: crypto.randomUUID(), userId, name: clean,
      icon: icon || "folder", color: color && allowedColors.has(color) ? color : "#64748b",
      position, createdAt: new Date().toISOString()
    };
    this.db.prepare("INSERT INTO folders (id, userId, name, icon, color, position, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(folder.id, userId, folder.name, folder.icon, folder.color, folder.position, folder.createdAt);
    return folder;
  }
  updateFolder(userId: string, id: string, updates: { name?: string; icon?: string; color?: string }): Folder | null {
    const current = this.db.prepare("SELECT * FROM folders WHERE id = ? AND userId = ?").get(id, userId) as Record<string, unknown> | undefined;
    if (!current) return null;
    const name = updates.name !== undefined ? updates.name.trim().slice(0, 60) : String(current.name);
    if (!name) throw new Error("Informe o nome da pasta.");
    const icon = updates.icon || String(current.icon);
    const color = updates.color && allowedColors.has(updates.color) ? updates.color : String(current.color);
    this.db.prepare("UPDATE folders SET name = ?, icon = ?, color = ? WHERE id = ? AND userId = ?")
      .run(name, icon, color, id, userId);
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
      ORDER BY completed, position, createdAt DESC
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
    const position = (this.db.prepare("SELECT COALESCE(MIN(position), 0) - 1 value FROM tasks WHERE userId = ? AND completed = 0").get(userId) as { value: number }).value;
    const task: Task = {
      id: crypto.randomUUID(), userId, folderId, flagId,
      title, notes: String(input.notes ?? "").trim().slice(0, 4000),
      dueAt: input.dueAt || null, completed: false, important: Boolean(input.important),
      position, createdAt: now, updatedAt: now, completedAt: null
    };
    this.db.prepare(`
      INSERT INTO tasks (id, userId, folderId, flagId, title, notes, dueAt, completed, important, position, createdAt, updatedAt, completedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL)
    `).run(task.id, userId, folderId, flagId, task.title, task.notes, task.dueAt, task.important ? 1 : 0, position, now, now);
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

  reorderTasks(userId: string, sourceId: string, targetId: string): Task[] {
    if (sourceId === targetId) return this.listTasks(userId);
    return this.db.transaction(() => {
      const openRows = this.db.prepare(`
        SELECT id FROM tasks WHERE userId = ? AND completed = 0
        ORDER BY position, createdAt DESC
      `).all(userId) as Array<{ id: string }>;
      const ids = openRows.map((row) => row.id);
      if (!ids.includes(sourceId) || !ids.includes(targetId)) {
        throw new Error("Selecione duas tarefas em aberto.");
      }
      const updatePosition = this.db.prepare("UPDATE tasks SET position = ?, updatedAt = ? WHERE id = ? AND userId = ?");
      const now = new Date().toISOString();
      ids.forEach((id, index) => updatePosition.run(index, now, id, userId));
      const sourceIndex = ids.indexOf(sourceId);
      const targetIndex = ids.indexOf(targetId);
      updatePosition.run(targetIndex, now, sourceId, userId);
      updatePosition.run(sourceIndex, now, targetId, userId);
      return this.listTasks(userId);
    })();
  }

  // ── Server Settings ──
  getServerSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM server_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  setServerSetting(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)").run(key, value);
  }
  getVaultSettings(): VaultSettings {
    const raw = this.getServerSetting("vaultTimeoutMinutes");
    return { vaultTimeoutMinutes: raw ? Number(raw) : 5 };
  }
  setVaultTimeout(minutes: number): void {
    this.setServerSetting("vaultTimeoutMinutes", String(minutes));
  }

  // ── Note Folders ──
  listNoteFolders(userId: string): NoteFolder[] {
    const rows = this.db.prepare("SELECT * FROM note_folders WHERE userId = ? ORDER BY position, createdAt").all(userId) as Array<Omit<NoteFolder, "locked"> & { locked: number }>;
    return rows.map((row) => ({ ...row, locked: Boolean(row.locked) }));
  }
  createNoteFolder(userId: string, name: string, icon?: string, color?: string): NoteFolder {
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error("Informe o nome da pasta de notas.");
    const position = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 value FROM note_folders WHERE userId = ?").get(userId) as { value: number }).value;
    const folder: NoteFolder = {
      id: crypto.randomUUID(), userId, name: clean,
      icon: icon || "note", color: color && allowedColors.has(color) ? color : "#f59e0b",
      position, createdAt: new Date().toISOString(), locked: false
    };
    this.db.prepare("INSERT INTO note_folders (id, userId, name, icon, color, position, createdAt, locked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(folder.id, userId, folder.name, folder.icon, folder.color, folder.position, folder.createdAt, 0);
    return folder;
  }
  updateNoteFolder(userId: string, id: string, updates: { name?: string; icon?: string; color?: string }): NoteFolder | null {
    const current = this.db.prepare("SELECT * FROM note_folders WHERE id = ? AND userId = ?").get(id, userId) as NoteFolder | undefined;
    if (!current) return null;
    const name = updates.name !== undefined ? updates.name.trim().slice(0, 60) : current.name;
    if (!name) throw new Error("Informe o nome da pasta de notas.");
    const icon = updates.icon || current.icon;
    const color = updates.color && allowedColors.has(updates.color) ? updates.color : current.color;
    this.db.prepare("UPDATE note_folders SET name = ?, icon = ?, color = ? WHERE id = ? AND userId = ?")
      .run(name, icon, color, id, userId);
    return this.listNoteFolders(userId).find((f) => f.id === id) ?? null;
  }
  deleteNoteFolder(userId: string, id: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM notes WHERE folderId = ? AND userId = ?").run(id, userId);
      return this.db.prepare("DELETE FROM note_folders WHERE id = ? AND userId = ?").run(id, userId).changes > 0;
    })();
  }

  // ── Notes ──
  listNotes(userId: string, folderId: string): Note[] {
    return this.db.prepare("SELECT * FROM notes WHERE userId = ? AND folderId = ? ORDER BY pinnedAt DESC NULLS LAST, createdAt DESC")
      .all(userId, folderId) as Note[];
  }
  listAllNotes(userId: string): Note[] {
    return this.db.prepare("SELECT * FROM notes WHERE userId = ? ORDER BY pinnedAt DESC NULLS LAST, createdAt DESC").all(userId) as Note[];
  }
  createNote(userId: string, folderId: string, title: string, content: string): Note {
    const titleClean = title.trim().slice(0, 120);
    const contentClean = content.trim().slice(0, 5000);
    if (!this.db.prepare("SELECT 1 FROM note_folders WHERE id = ? AND userId = ?").get(folderId, userId)) {
      throw new Error("Pasta de notas inválida.");
    }
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomUUID(), userId, folderId,
      title: titleClean, content: contentClean, createdAt: now, updatedAt: now, pinnedAt: null
    };
    this.db.prepare("INSERT INTO notes (id, userId, folderId, title, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(note.id, userId, folderId, note.title, note.content, now, now);
    return note;
  }
  updateNote(userId: string, id: string, title: string, content: string): Note | null {
    const current = this.db.prepare("SELECT * FROM notes WHERE id = ? AND userId = ?").get(id, userId) as Note | undefined;
    if (!current) return null;
    const now = new Date().toISOString();
    const titleClean = title.trim().slice(0, 120);
    const contentClean = content.trim().slice(0, 5000);
    this.db.prepare("UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ? AND userId = ?")
      .run(titleClean, contentClean, now, id, userId);
    return this.db.prepare("SELECT * FROM notes WHERE id = ? AND userId = ?").get(id, userId) as Note ?? null;
  }
  deleteNote(userId: string, id: string): boolean {
    return this.db.prepare("DELETE FROM notes WHERE id = ? AND userId = ?").run(id, userId).changes > 0;
  }
  togglePin(userId: string, id: string): Note | null {
    const current = this.db.prepare("SELECT * FROM notes WHERE id = ? AND userId = ?").get(id, userId) as Note | undefined;
    if (!current) return null;
    if (current.pinnedAt) {
      this.db.prepare("UPDATE notes SET pinnedAt = NULL WHERE id = ? AND userId = ?").run(id, userId);
    } else {
      this.db.prepare("UPDATE notes SET pinnedAt = ? WHERE id = ? AND userId = ?").run(new Date().toISOString(), id, userId);
    }
    return this.db.prepare("SELECT * FROM notes WHERE id = ? AND userId = ?").get(id, userId) as Note ?? null;
  }
}
export const store = new Store();
