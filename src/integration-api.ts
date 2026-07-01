import type { IncomingMessage, ServerResponse } from "node:http";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { config } from "./config.js";
import { store } from "./store.js";
import type { Flag, Folder, IntegrationIdentity, IntegrationScope, Task } from "./types.js";

const API_PREFIX = "/api/integrations/v1";
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Corpo da requisição excede 64 KB.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new Error("Envie um corpo JSON válido.");
  }
}

function authenticate(req: IncomingMessage): IntegrationIdentity | null {
  const authorization = req.headers.authorization ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const token = match[1];
  if (token.startsWith("pgt_")) return store.authenticateIntegrationToken(token);
  if (!config.pugotilabAuthSecret) return null;
  try {
    const payload = jwt.verify(token, config.pugotilabAuthSecret, {
      algorithms: ["HS256"],
      issuer: "pugotilab-auth",
      audience: "pugotitasks-api"
    }) as JwtPayload & { scope?: string | string[]; token_use?: string };
    if (payload.token_use !== "access" || typeof payload.sub !== "string") return null;
    const rawScopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope ?? "").split(/\s+/);
    const scopes = rawScopes.filter((scope): scope is IntegrationScope => scope === "tasks:read" || scope === "tasks:write");
    if (!scopes.length) return null;
    return { tokenId: payload.jti ?? "oauth", userId: payload.sub.trim().toLowerCase(), scopes };
  } catch {
    return null;
  }
}

function requireScope(identity: IntegrationIdentity, scope: IntegrationScope, res: ServerResponse): boolean {
  if (identity.scopes.includes(scope)) return true;
  sendJson(res, 403, { error: "Token sem permissão para esta operação.", requiredScope: scope });
  return false;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function requestedDate(url: URL): string {
  const date = url.searchParams.get("date") ?? localDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    throw new Error("Data inválida. Use o formato YYYY-MM-DD.");
  }
  return date;
}

function taskDto(task: Task, folders: Folder[], flags: Flag[], referenceDate: string): Record<string, unknown> {
  const folder = folders.find((item) => item.id === task.folderId);
  const flag = flags.find((item) => item.id === task.flagId);
  const dueDate = task.dueAt?.slice(0, 10) ?? null;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    completed: task.completed,
    important: task.important,
    overdue: !task.completed && dueDate !== null && dueDate < referenceDate,
    folder: folder ? { id: folder.id, name: folder.name } : null,
    flag: flag ? { id: flag.id, name: flag.name, color: flag.color } : null,
    recurrence: {
      type: task.recurrenceType,
      interval: task.recurrenceInterval,
      endAt: task.recurrenceEndAt
    },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt
  };
}

function resolveFolderId(userId: string, folderId?: string, folderName?: string): string {
  const folders = store.listFolders(userId);
  const folder = folderId
    ? folders.find((item) => item.id === folderId)
    : folderName
      ? folders.find((item) => item.name.localeCompare(folderName, "pt-BR", { sensitivity: "base" }) === 0)
      : folders[0];
  if (!folder) throw new Error("Pasta não encontrada.");
  return folder.id;
}

function resolveFlagId(userId: string, flagId?: string | null, flagName?: string | null): string | null | undefined {
  if (flagId === null || flagName === null) return null;
  if (flagId === undefined && flagName === undefined) return undefined;
  const flags = store.listFlags(userId);
  const flag = flagId
    ? flags.find((item) => item.id === flagId)
    : flags.find((item) => item.name.localeCompare(String(flagName), "pt-BR", { sensitivity: "base" }) === 0);
  if (!flag) throw new Error("Flag não encontrada.");
  return flag.id;
}

export async function handleIntegrationApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(API_PREFIX)) {
    sendJson(res, 404, { error: "Rota não encontrada." });
    return;
  }

  const identity = authenticate(req);
  if (!identity) {
    sendJson(res, 401, { error: "Bearer Token ausente, inválido, expirado ou revogado." }, {
      "www-authenticate": 'Bearer realm="Pugotitasks API"'
    });
    return;
  }

  store.ensureDefaults(identity.userId);
  const date = requestedDate(url);
  const folders = store.listFolders(identity.userId);
  const flags = store.listFlags(identity.userId);

  if (url.pathname === `${API_PREFIX}/me` && req.method === "GET") {
    if (!requireScope(identity, "tasks:read", res)) return;
    sendJson(res, 200, { user: { username: identity.userId }, scopes: identity.scopes });
    return;
  }

  if (url.pathname === `${API_PREFIX}/folders` && req.method === "GET") {
    if (!requireScope(identity, "tasks:read", res)) return;
    sendJson(res, 200, { folders: folders.map(({ id, name, icon, color }) => ({ id, name, icon, color })) });
    return;
  }

  if (url.pathname === `${API_PREFIX}/flags` && req.method === "GET") {
    if (!requireScope(identity, "tasks:read", res)) return;
    sendJson(res, 200, { flags: flags.map(({ id, name, description, color }) => ({ id, name, description, color })) });
    return;
  }

  if (url.pathname === `${API_PREFIX}/summary` && req.method === "GET") {
    if (!requireScope(identity, "tasks:read", res)) return;
    const tasks = store.listTasks(identity.userId);
    const open = tasks.filter((task) => !task.completed);
    sendJson(res, 200, {
      date,
      counts: {
        today: open.filter((task) => task.dueAt?.slice(0, 10) === date).length,
        overdue: open.filter((task) => task.dueAt && task.dueAt.slice(0, 10) < date).length,
        pending: open.length,
        completed: tasks.filter((task) => task.completed).length
      }
    });
    return;
  }

  if (url.pathname === `${API_PREFIX}/tasks` && req.method === "GET") {
    if (!requireScope(identity, "tasks:read", res)) return;
    const filter = url.searchParams.get("filter") ?? "pending";
    if (!new Set(["today", "overdue", "pending", "completed", "all"]).has(filter)) {
      throw new Error("Filtro inválido. Use today, overdue, pending, completed ou all.");
    }
    const folderId = url.searchParams.get("folderId");
    const limitRaw = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
    let tasks = store.listTasks(identity.userId);
    if (folderId) tasks = tasks.filter((task) => task.folderId === folderId);
    tasks = tasks.filter((task) => {
      const dueDate = task.dueAt?.slice(0, 10);
      if (filter === "today") return !task.completed && dueDate === date;
      if (filter === "overdue") return !task.completed && dueDate !== undefined && dueDate < date;
      if (filter === "pending") return !task.completed;
      if (filter === "completed") return task.completed;
      return true;
    }).slice(0, limit);
    sendJson(res, 200, { date, filter, count: tasks.length, tasks: tasks.map((task) => taskDto(task, folders, flags, date)) });
    return;
  }

  if (url.pathname === `${API_PREFIX}/tasks` && req.method === "POST") {
    if (!requireScope(identity, "tasks:write", res)) return;
    const body = await readJson<Partial<Task> & { folderName?: string; flagName?: string | null }>(req);
    const task = store.createTask(identity.userId, {
      ...body,
      folderId: resolveFolderId(identity.userId, body.folderId, body.folderName),
      flagId: resolveFlagId(identity.userId, body.flagId, body.flagName)
    });
    sendJson(res, 201, { task: taskDto(task, folders, flags, date) });
    return;
  }

  const taskMatch = url.pathname.match(new RegExp(`^${API_PREFIX}/tasks/([^/]+)$`));
  if (taskMatch && req.method === "GET") {
    if (!requireScope(identity, "tasks:read", res)) return;
    const task = store.listTasks(identity.userId).find((item) => item.id === decodeURIComponent(taskMatch[1]));
    sendJson(res, task ? 200 : 404, task ? { task: taskDto(task, folders, flags, date) } : { error: "Tarefa não encontrada." });
    return;
  }

  if (taskMatch && req.method === "PATCH") {
    if (!requireScope(identity, "tasks:write", res)) return;
    const body = await readJson<Partial<Task> & { folderName?: string; flagName?: string | null }>(req);
    const updates: Partial<Task> = { ...body };
    if (body.folderId !== undefined || body.folderName !== undefined) {
      updates.folderId = resolveFolderId(identity.userId, body.folderId, body.folderName);
    }
    if (body.flagId !== undefined || body.flagName !== undefined) {
      updates.flagId = resolveFlagId(identity.userId, body.flagId, body.flagName) ?? null;
    }
    const task = store.updateTask(identity.userId, decodeURIComponent(taskMatch[1]), updates);
    sendJson(res, task ? 200 : 404, task ? { task: taskDto(task, folders, flags, date) } : { error: "Tarefa não encontrada." });
    return;
  }

  const completeMatch = url.pathname.match(new RegExp(`^${API_PREFIX}/tasks/([^/]+)/complete$`));
  if (completeMatch && req.method === "POST") {
    if (!requireScope(identity, "tasks:write", res)) return;
    const task = store.updateTask(identity.userId, decodeURIComponent(completeMatch[1]), { completed: true });
    sendJson(res, task ? 200 : 404, task ? { task: taskDto(task, folders, flags, date) } : { error: "Tarefa não encontrada." });
    return;
  }

  sendJson(res, 404, { error: "Rota de integração não encontrada." });
}
