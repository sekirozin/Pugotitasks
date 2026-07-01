import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { getNextRecurrenceDueAt, normalizeRecurrenceInterval, normalizeRecurrenceType } from "./recurrence.js";
import type { Flag, Folder, IntegrationIdentity, IntegrationScope, IntegrationToken, Note, NoteFolder, Task, VaultSettings } from "./types.js";
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
        description TEXT NOT NULL DEFAULT '',
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
        completedAt TEXT,
        recurrenceType TEXT NOT NULL DEFAULT 'none',
        recurrenceInterval INTEGER NOT NULL DEFAULT 1,
        recurrenceEndAt TEXT,
        recurrenceSeriesId TEXT,
        recurrenceParentId TEXT
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
      CREATE TABLE IF NOT EXISTS integration_tokens (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT,
        expiresAt TEXT,
        revokedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_integration_tokens_user ON integration_tokens(userId, createdAt);
    `);
    this.migrate();
  }
  private migrate(): void {
    let cols = this.db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "color")) {
      this.db.exec("ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT '#64748b'");
    }
    cols = this.db.prepare("PRAGMA table_info(flags)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "description")) {
      this.db.exec("ALTER TABLE flags ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec(`
      UPDATE flags SET description = CASE lower(name)
        WHEN 'financeiro' THEN 'Contas, pagamentos e organização financeira.'
        WHEN 'homelab' THEN 'Servidor, rede e manutenção do laboratório.'
        ELSE description
      END
      WHERE description = ''
    `);
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
    cols = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "recurrenceType")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN recurrenceType TEXT NOT NULL DEFAULT 'none'");
    }
    if (!cols.some((c) => c.name === "recurrenceInterval")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN recurrenceInterval INTEGER NOT NULL DEFAULT 1");
    }
    if (!cols.some((c) => c.name === "recurrenceEndAt")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN recurrenceEndAt TEXT");
    }
    if (!cols.some((c) => c.name === "recurrenceSeriesId")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN recurrenceSeriesId TEXT");
    }
    if (!cols.some((c) => c.name === "recurrenceParentId")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN recurrenceParentId TEXT");
    }
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrenceParentId) WHERE recurrenceParentId IS NOT NULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS integration_tokens (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT,
        expiresAt TEXT,
        revokedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_integration_tokens_user ON integration_tokens(userId, createdAt);
    `);
  }
  ensureDefaults(userId: string): void {
    const count = (this.db.prepare("SELECT COUNT(*) count FROM folders WHERE userId = ?").get(userId) as { count: number }).count;
    const now = new Date().toISOString();
    if (count === 0) {
      const insertFolder = this.db.prepare("INSERT INTO folders (id, userId, name, icon, color, position, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertFlag = this.db.prepare("INSERT INTO flags (id, userId, name, description, color, createdAt) VALUES (?, ?, ?, ?, ?, ?)");
      this.db.transaction(() => {
        insertFolder.run(crypto.randomUUID(), userId, "Pessoal", "user", "#22c55e", 0, now);
        insertFolder.run(crypto.randomUUID(), userId, "Trabalho", "file-text", "#3b82f6", 1, now);
        insertFlag.run(crypto.randomUUID(), userId, "Financeiro", "Contas, pagamentos e organização financeira.", "#22c55e", now);
        insertFlag.run(crypto.randomUUID(), userId, "Homelab", "Servidor, rede e manutenção do laboratório.", "#ef4444", now);
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
  createFlag(userId: string, name: string, description: string, color: string): Flag {
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new Error("Informe o nome da flag.");
    const cleanDescription = description.trim().slice(0, 240);
    const selectedColor = allowedColors.has(color) ? color : "#3b82f6";
    const flag: Flag = { id: crypto.randomUUID(), userId, name: clean, description: cleanDescription, color: selectedColor, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO flags (id, userId, name, description, color, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(flag.id, userId, flag.name, flag.description, flag.color, flag.createdAt);
    return flag;
  }
  updateFlag(userId: string, id: string, updates: { name?: string; description?: string; color?: string }): Flag | null {
    const current = this.db.prepare("SELECT * FROM flags WHERE id = ? AND userId = ?").get(id, userId) as Flag | undefined;
    if (!current) return null;
    const name = updates.name === undefined ? current.name : updates.name.trim().slice(0, 40);
    if (!name) throw new Error("Informe o nome da flag.");
    const description = updates.description === undefined ? current.description : updates.description.trim().slice(0, 240);
    const color = updates.color && allowedColors.has(updates.color) ? updates.color : current.color;
    this.db.prepare("UPDATE flags SET name = ?, description = ?, color = ? WHERE id = ? AND userId = ?")
      .run(name, description, color, id, userId);
    return this.db.prepare("SELECT * FROM flags WHERE id = ? AND userId = ?").get(id, userId) as Flag | undefined ?? null;
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
    return rows.map((row) => ({
      ...row,
      completed: Boolean(row.completed),
      important: Boolean(row.important),
      recurrenceType: normalizeRecurrenceType(row.recurrenceType),
      recurrenceInterval: Number(row.recurrenceInterval || 1),
      recurrenceEndAt: row.recurrenceEndAt || null,
      recurrenceSeriesId: row.recurrenceSeriesId || null,
      recurrenceParentId: row.recurrenceParentId || null
    }));
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
    const dueAt = input.dueAt ? String(input.dueAt).slice(0, 16) : null;
    const recurrenceType = normalizeRecurrenceType(input.recurrenceType);
    const recurrenceInterval = normalizeRecurrenceInterval(recurrenceType, input.recurrenceInterval);
    const recurrenceEndAt = recurrenceType !== "none" && input.recurrenceEndAt
      ? String(input.recurrenceEndAt).slice(0, 10) : null;
    if (recurrenceType !== "none" && !dueAt) throw new Error("Defina o vencimento da tarefa recorrente.");
    if (recurrenceEndAt && recurrenceEndAt < dueAt!.slice(0, 10)) {
      throw new Error("A data final da recorrência deve ser posterior ao primeiro vencimento.");
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const position = (this.db.prepare("SELECT COALESCE(MIN(position), 0) - 1 value FROM tasks WHERE userId = ? AND completed = 0").get(userId) as { value: number }).value;
    const task: Task = {
      id, userId, folderId, flagId,
      title, notes: String(input.notes ?? "").trim().slice(0, 4000),
      dueAt, completed: false, important: Boolean(input.important),
      position, createdAt: now, updatedAt: now, completedAt: null,
      recurrenceType, recurrenceInterval, recurrenceEndAt,
      recurrenceSeriesId: recurrenceType === "none" ? null : id,
      recurrenceParentId: null
    };
    this.db.prepare(`
      INSERT INTO tasks (id, userId, folderId, flagId, title, notes, dueAt, completed, important, position,
        createdAt, updatedAt, completedAt, recurrenceType, recurrenceInterval, recurrenceEndAt, recurrenceSeriesId, recurrenceParentId)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
    `).run(task.id, userId, folderId, flagId, task.title, task.notes, task.dueAt, task.important ? 1 : 0,
      position, now, now, recurrenceType, recurrenceInterval, recurrenceEndAt, task.recurrenceSeriesId);
    return task;
  }
  updateTask(userId: string, id: string, input: Partial<Task>): Task | null {
    return this.db.transaction(() => {
      const raw = this.db.prepare("SELECT * FROM tasks WHERE id = ? AND userId = ?").get(id, userId) as Record<string, unknown> | undefined;
      if (!raw) return null;
      const current = this.listTasks(userId).find((task) => task.id === id)!;
      const folderId = input.folderId === undefined ? current.folderId : String(input.folderId);
      if (!this.db.prepare("SELECT 1 FROM folders WHERE id = ? AND userId = ?").get(folderId, userId)) {
        throw new Error("Pasta inválida.");
      }
      const completed = input.completed === undefined ? current.completed : Boolean(input.completed);
      const flagId = input.flagId === undefined
        ? current.flagId
        : input.flagId && this.db.prepare("SELECT 1 FROM flags WHERE id = ? AND userId = ?").get(input.flagId, userId)
          ? input.flagId : null;
      const title = input.title === undefined ? current.title : String(input.title).trim().slice(0, 180);
      if (!title) throw new Error("Informe o título da tarefa.");
      const dueAt = input.dueAt === undefined ? current.dueAt : input.dueAt ? String(input.dueAt).slice(0, 16) : null;
      const recurrenceType = input.recurrenceType === undefined
        ? current.recurrenceType : normalizeRecurrenceType(input.recurrenceType);
      const recurrenceInterval = normalizeRecurrenceInterval(
        recurrenceType,
        input.recurrenceInterval === undefined ? current.recurrenceInterval : input.recurrenceInterval
      );
      const recurrenceEndAt = recurrenceType === "none" ? null : input.recurrenceEndAt === undefined
        ? current.recurrenceEndAt : input.recurrenceEndAt ? String(input.recurrenceEndAt).slice(0, 10) : null;
      if (recurrenceType !== "none" && !dueAt) throw new Error("Defina o vencimento da tarefa recorrente.");
      if (recurrenceEndAt && recurrenceEndAt < dueAt!.slice(0, 10)) {
        throw new Error("A data final da recorrência deve ser posterior ao vencimento.");
      }

      const now = new Date().toISOString();
      const completedAt = completed ? current.completedAt || now : null;
      const recurrenceSeriesId = recurrenceType === "none" ? null : current.recurrenceSeriesId || current.id;
      this.db.prepare(`
        UPDATE tasks SET folderId = ?, flagId = ?, title = ?, notes = ?, dueAt = ?,
          completed = ?, important = ?, updatedAt = ?, completedAt = ?, recurrenceType = ?,
          recurrenceInterval = ?, recurrenceEndAt = ?, recurrenceSeriesId = ?
        WHERE id = ? AND userId = ?
      `).run(
        folderId, flagId, title,
        input.notes === undefined ? current.notes : String(input.notes).trim().slice(0, 4000),
        dueAt, completed ? 1 : 0,
        input.important === undefined ? current.important ? 1 : 0 : input.important ? 1 : 0,
        now, completedAt, recurrenceType, recurrenceInterval, recurrenceEndAt, recurrenceSeriesId, id, userId
      );

      const updated = this.listTasks(userId).find((task) => task.id === id)!;
      if (!current.completed && completed && recurrenceType !== "none") {
        const nextDueAt = getNextRecurrenceDueAt(updated, new Date(completedAt!));
        const existing = this.db.prepare("SELECT 1 FROM tasks WHERE recurrenceParentId = ?").get(id);
        if (nextDueAt && !existing) {
          const nextId = crypto.randomUUID();
          const position = (this.db.prepare("SELECT COALESCE(MIN(position), 0) - 1 value FROM tasks WHERE userId = ? AND completed = 0").get(userId) as { value: number }).value;
          this.db.prepare(`
            INSERT INTO tasks (id, userId, folderId, flagId, title, notes, dueAt, completed, important, position,
              createdAt, updatedAt, completedAt, recurrenceType, recurrenceInterval, recurrenceEndAt,
              recurrenceSeriesId, recurrenceParentId)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
          `).run(nextId, userId, folderId, flagId, title, updated.notes, nextDueAt,
            updated.important ? 1 : 0, position, now, now, recurrenceType, recurrenceInterval,
            recurrenceEndAt, recurrenceSeriesId, id);
        }
      }
      return this.listTasks(userId).find((task) => task.id === id) ?? null;
    })();
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

  reorderTaskList(userId: string, orderedIds: string[]): Task[] {
    return this.db.transaction(() => {
      const openRows = this.db.prepare(`
        SELECT id FROM tasks WHERE userId = ? AND completed = 0
        ORDER BY position, createdAt DESC
      `).all(userId) as Array<{ id: string }>;
      const openIds = openRows.map((row) => row.id);
      const openSet = new Set(openIds);
      const cleanIds = orderedIds.filter((id, index, list) => openSet.has(id) && list.indexOf(id) === index);
      if (cleanIds.length < 2) throw new Error("Envie pelo menos duas tarefas em aberto.");
      const finalIds = [...cleanIds, ...openIds.filter((id) => !cleanIds.includes(id))];
      const updatePosition = this.db.prepare("UPDATE tasks SET position = ?, updatedAt = ? WHERE id = ? AND userId = ?");
      const now = new Date().toISOString();
      finalIds.forEach((id, index) => updatePosition.run(index, now, id, userId));
      return this.listTasks(userId);
    })();
  }

  createIntegrationToken(
    userId: string,
    input: { name?: string; scopes?: IntegrationScope[]; expiresInDays?: number | null }
  ): { token: string; integration: IntegrationToken } {
    const name = String(input.name ?? "Integração").trim().slice(0, 80);
    if (!name) throw new Error("Informe o nome da integração.");
    const supported = new Set<IntegrationScope>(["tasks:read", "tasks:write"]);
    const requested: IntegrationScope[] = input.scopes?.length ? input.scopes : ["tasks:read", "tasks:write"];
    const scopes = [...new Set(requested)].filter((scope): scope is IntegrationScope => supported.has(scope));
    if (!scopes.length || scopes.length !== new Set(requested).size) throw new Error("Escopo de integração inválido.");

    const expiresInDays = input.expiresInDays === undefined ? 365 : input.expiresInDays;
    if (expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650)) {
      throw new Error("A validade deve estar entre 1 e 3650 dias, ou ser nula.");
    }
    const now = new Date();
    const token = `pgt_${crypto.randomBytes(32).toString("base64url")}`;
    const integration: IntegrationToken = {
      id: crypto.randomUUID(),
      userId,
      name,
      scopes,
      createdAt: now.toISOString(),
      lastUsedAt: null,
      expiresAt: expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * 86_400_000).toISOString(),
      revokedAt: null
    };
    this.db.prepare(`
      INSERT INTO integration_tokens (id, userId, name, tokenHash, scopes, createdAt, lastUsedAt, expiresAt, revokedAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)
    `).run(integration.id, userId, name, this.hashIntegrationToken(token), JSON.stringify(scopes), integration.createdAt, integration.expiresAt);
    return { token, integration };
  }

  listIntegrationTokens(userId: string): IntegrationToken[] {
    const rows = this.db.prepare(`
      SELECT id, userId, name, scopes, createdAt, lastUsedAt, expiresAt, revokedAt
      FROM integration_tokens WHERE userId = ? ORDER BY createdAt DESC
    `).all(userId) as Array<Omit<IntegrationToken, "scopes"> & { scopes: string }>;
    return rows.map((row) => ({ ...row, scopes: this.parseIntegrationScopes(row.scopes) }));
  }

  authenticateIntegrationToken(token: string): IntegrationIdentity | null {
    if (!token.startsWith("pgt_") || token.length < 40 || token.length > 100) return null;
    const row = this.db.prepare(`
      SELECT id, userId, scopes, expiresAt, revokedAt FROM integration_tokens WHERE tokenHash = ?
    `).get(this.hashIntegrationToken(token)) as {
      id: string; userId: string; scopes: string; expiresAt: string | null; revokedAt: string | null;
    } | undefined;
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date().toISOString())) return null;
    this.db.prepare("UPDATE integration_tokens SET lastUsedAt = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { tokenId: row.id, userId: row.userId, scopes: this.parseIntegrationScopes(row.scopes) };
  }

  revokeIntegrationToken(userId: string, id: string): boolean {
    return this.db.prepare(`
      UPDATE integration_tokens SET revokedAt = ? WHERE id = ? AND userId = ? AND revokedAt IS NULL
    `).run(new Date().toISOString(), id, userId).changes > 0;
  }

  private hashIntegrationToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private parseIntegrationScopes(raw: string): IntegrationScope[] {
    try {
      const scopes = JSON.parse(raw) as unknown;
      if (!Array.isArray(scopes)) return [];
      return scopes.filter((scope): scope is IntegrationScope => scope === "tasks:read" || scope === "tasks:write");
    } catch {
      return [];
    }
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
