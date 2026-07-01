import crypto from "node:crypto";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { getCookie, getProfile } from "./auth.js";
import { config } from "./config.js";
import { handleIntegrationApi } from "./integration-api.js";
import { store } from "./store.js";
import type { IntegrationScope, Note, Task } from "./types.js";
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
function routeId(pathname: string, resource: string): string | null {
  const match = pathname.match(new RegExp(`^/api/${resource}/([^/]+)$`));
  return match ? decodeURIComponent(match[1] ?? "") : null;
}
async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const profile = await getProfile(req);
  if (!profile) {
    sendJson(res, 401, { error: "Entre com sua conta Pugotilab.", loginUrl: config.pugotilabLoginUrl });
    return;
  }
  store.ensureDefaults(profile.username);
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/integrations/tokens" && req.method === "GET") {
    sendJson(res, 200, { integrations: store.listIntegrationTokens(profile.username) });
    return;
  }
  if (url.pathname === "/api/integrations/tokens" && req.method === "POST") {
    const body = await readJson<{
      name?: string;
      scopes?: IntegrationScope[];
      expiresInDays?: number | null;
    }>(req);
    const created = store.createIntegrationToken(profile.username, body);
    sendJson(res, 201, {
      ...created,
      notice: "Guarde o token agora. Ele não será exibido novamente."
    });
    return;
  }
  const integrationTokenMatch = url.pathname.match(/^\/api\/integrations\/tokens\/([^/]+)$/);
  if (integrationTokenMatch && req.method === "DELETE") {
    const revoked = store.revokeIntegrationToken(profile.username, decodeURIComponent(integrationTokenMatch[1]));
    sendJson(res, revoked ? 200 : 404, revoked ? { revoked: true } : { error: "Integração não encontrada ou já revogada." });
    return;
  }
  if (url.pathname === "/api/bootstrap" && req.method === "GET") {
    const noteFolders = store.listNoteFolders(profile.username);
    const lockedFolderIds = new Set(noteFolders.filter((f) => f.locked).map((f) => f.id));
    const notes = store.listAllNotes(profile.username).filter((n) => !lockedFolderIds.has(n.folderId));
    const token = req.headers["x-vault-token"] as string | undefined;
    const vaultUnlocked = !!token && verifyVaultToken(profile.username, token);
    if (vaultUnlocked) {
      notes.push(...store.listAllNotes(profile.username).filter((n) => lockedFolderIds.has(n.folderId)));
    }
    sendJson(res, 200, {
      profile,
      folders: store.listFolders(profile.username),
      flags: store.listFlags(profile.username),
      tasks: store.listTasks(profile.username),
      noteFolders,
      notes,
      vaultSettings: store.getVaultSettings(),
      vaultUnlocked
    });
    return;
  }
  if (url.pathname === "/api/folders" && req.method === "POST") {
    const body = await readJson<{ name?: string; icon?: string; color?: string }>(req);
    sendJson(res, 201, { folder: store.createFolder(profile.username, body.name ?? "", body.icon, body.color) });
    return;
  }
  const folderId = routeId(url.pathname, "folders");
  if (folderId && req.method === "PATCH") {
    const body = await readJson<{ name?: string; icon?: string; color?: string }>(req);
    const folder = store.updateFolder(profile.username, folderId, body);
    sendJson(res, folder ? 200 : 404, folder ? { folder } : { error: "Pasta não encontrada." });
    return;
  }
  if (folderId && req.method === "DELETE") {
    sendJson(res, store.deleteFolder(profile.username, folderId) ? 200 : 404, { deleted: true });
    return;
  }
  if (url.pathname === "/api/flags" && req.method === "POST") {
    const body = await readJson<{ name?: string; description?: string; color?: string }>(req);
    sendJson(res, 201, { flag: store.createFlag(profile.username, body.name ?? "", body.description ?? "", body.color ?? "") });
    return;
  }
  const flagId = routeId(url.pathname, "flags");
  if (flagId && req.method === "PATCH") {
    const body = await readJson<{ name?: string; description?: string; color?: string }>(req);
    const flag = store.updateFlag(profile.username, flagId, body);
    sendJson(res, flag ? 200 : 404, flag ? { flag } : { error: "Flag não encontrada." });
    return;
  }
  if (flagId && req.method === "DELETE") {
    sendJson(res, store.deleteFlag(profile.username, flagId) ? 200 : 404, { deleted: true });
    return;
  }
  if (url.pathname === "/api/tasks" && req.method === "POST") {
    const body = await readJson<Partial<Task>>(req);
    sendJson(res, 201, { task: store.createTask(profile.username, body) });
    return;
  }
  if (url.pathname === "/api/tasks/reorder" && req.method === "POST") {
    const body = await readJson<{ sourceId?: string; targetId?: string; orderedIds?: string[] }>(req);
    const tasks = Array.isArray(body.orderedIds)
      ? store.reorderTaskList(profile.username, body.orderedIds.map(String))
      : store.reorderTasks(profile.username, String(body.sourceId ?? ""), String(body.targetId ?? ""));
    sendJson(res, 200, { tasks });
    return;
  }
  const taskId = routeId(url.pathname, "tasks");
  if (taskId && req.method === "PATCH") {
    const body = await readJson<Partial<Task>>(req);
    const task = store.updateTask(profile.username, taskId, body);
    sendJson(res, task ? 200 : 404, task ? { task, tasks: store.listTasks(profile.username) } : { error: "Tarefa não encontrada." });
    return;
  }
  if (taskId && req.method === "DELETE") {
    sendJson(res, store.deleteTask(profile.username, taskId) ? 200 : 404, { deleted: true });
    return;
  }
  // ── Note Folders ──
  if (url.pathname === "/api/note_folders" && req.method === "POST") {
    const body = await readJson<{ name?: string; icon?: string; color?: string }>(req);
    sendJson(res, 201, { noteFolder: store.createNoteFolder(profile.username, body.name ?? "", body.icon, body.color) });
    return;
  }
  const noteFolderId = routeId(url.pathname, "note_folders");
  if (noteFolderId && req.method === "PATCH") {
    const body = await readJson<{ name?: string; icon?: string; color?: string }>(req);
    const folder = store.updateNoteFolder(profile.username, noteFolderId, body);
    sendJson(res, folder ? 200 : 404, folder ? { noteFolder: folder } : { error: "Pasta de notas não encontrada." });
    return;
  }
  if (noteFolderId && req.method === "DELETE") {
    sendJson(res, store.deleteNoteFolder(profile.username, noteFolderId) ? 200 : 404, { deleted: true });
    return;
  }

  // ── Notes ──
  if (url.pathname === "/api/notes" && req.method === "POST") {
    const body = await readJson<{ folderId?: string; title?: string; content?: string }>(req);
    sendJson(res, 201, { note: store.createNote(profile.username, body.folderId ?? "", body.title ?? "", body.content ?? "") });
    return;
  }
  const pinMatch = url.pathname.match(/^\/api\/notes\/([^/]+)\/pin$/);
  if (pinMatch && req.method === "PUT") {
    const note = store.togglePin(profile.username, decodeURIComponent(pinMatch[1]));
    sendJson(res, note ? 200 : 404, note ? { note } : { error: "Nota não encontrada." });
    return;
  }
  const noteId = routeId(url.pathname, "notes");
  if (noteId && req.method === "PATCH") {
    const body = await readJson<{ title?: string; content?: string }>(req);
    const note = store.updateNote(profile.username, noteId, body.title ?? "", body.content ?? "");
    sendJson(res, note ? 200 : 404, note ? { note } : { error: "Nota não encontrada." });
    return;
  }
  if (noteId && req.method === "DELETE") {
    sendJson(res, store.deleteNote(profile.username, noteId) ? 200 : 404, { deleted: true });
    return;
  }

  // ── Vault ──
  if (url.pathname === "/api/vault/unlock" && req.method === "POST") {
    if (profile.role !== "admin") {
      sendJson(res, 403, { error: "Apenas administradores podem acessar o cofre." });
      return;
    }
    const body = await readJson<{ password?: string }>(req);
    if (!body.password) { sendJson(res, 400, { error: "Informe a senha." }); return; }
    const ok = await verifyPugotilabPassword(profile.username, body.password);
    if (!ok) { sendJson(res, 400, { error: "Senha inválida." }); return; }
    const settings = store.getVaultSettings();
    const vaultToken = createVaultToken(profile.username, settings.vaultTimeoutMinutes);
    sendJson(res, 200, { vaultToken, vaultTimeoutMinutes: settings.vaultTimeoutMinutes });
    return;
  }
  if (url.pathname === "/api/vault/lock" && req.method === "POST") {
    sendJson(res, 200, { locked: true });
    return;
  }
  if (url.pathname === "/api/vault/notes" && req.method === "GET") {
    const token = req.headers["x-vault-token"] as string | undefined;
    if (!token || !verifyVaultToken(profile.username, token)) {
      sendJson(res, 403, { error: "Cofre bloqueado." });
      return;
    }
    const lockedFolders = store.listNoteFolders(profile.username).filter((f) => f.locked);
    const lockedIds = new Set(lockedFolders.map((f) => f.id));
    const notes = store.listAllNotes(profile.username).filter((n) => lockedIds.has(n.folderId));
    sendJson(res, 200, { notes });
    return;
  }
  if (url.pathname === "/api/vault/touch" && req.method === "POST") {
    const token = req.headers["x-vault-token"] as string | undefined;
    if (!token || !verifyVaultToken(profile.username, token)) {
      sendJson(res, 403, { error: "Cofre bloqueado." });
      return;
    }
    const settings = store.getVaultSettings();
    const vaultToken = createVaultToken(profile.username, settings.vaultTimeoutMinutes);
    sendJson(res, 200, { vaultToken, vaultTimeoutMinutes: settings.vaultTimeoutMinutes });
    return;
  }
  if (url.pathname === "/api/vault/settings" && req.method === "GET") {
    sendJson(res, 200, store.getVaultSettings());
    return;
  }
  if (url.pathname === "/api/vault/settings" && req.method === "PATCH") {
    const body = await readJson<{ vaultTimeoutMinutes?: number }>(req);
    const minutes = body.vaultTimeoutMinutes;
    if (minutes === undefined || !Number.isInteger(minutes) || minutes < 1) {
      sendJson(res, 400, { error: "O tempo deve ser um número inteiro maior que zero." });
      return;
    }
    store.setVaultTimeout(minutes);
    sendJson(res, 200, store.getVaultSettings());
    return;
  }

  sendJson(res, 404, { error: "Rota não encontrada." });
}
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.resolve(config.publicDir, requested);
  if (!filePath.startsWith(path.resolve(config.publicDir))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
        : ext === ".js" ? "text/javascript; charset=utf-8"
          : ext === ".svg" ? "image/svg+xml" : "application/octet-stream";
    const noCache = ext === ".html" || ext === ".css" || ext === ".js";
    res.writeHead(200, { "content-type": contentType, ...(noCache ? { "cache-control": "no-cache" } : {}) });
    res.end(data);
  } catch {
    const index = await fs.readFile(path.join(config.publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(index);
  }
}
function createVaultToken(userId: string, timeoutMinutes: number): string {
  const payload = `${userId}.${Date.now() + timeoutMinutes * 60 * 1000}`;
  const signature = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyVaultToken(userId: string, token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenUserId, expiresAt, signature] = parts;
  if (tokenUserId !== userId || !expiresAt || !signature || Number(expiresAt) < Date.now()) return false;
  const payload = `${tokenUserId}.${expiresAt}`;
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
async function verifyPugotilabPassword(username: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.pugotilabOrigin}/auth/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    return res.ok;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() });
      return;
    }
    if (req.url?.startsWith("/api/integrations/v1")) await handleIntegrationApi(req, res);
    else if (req.url?.startsWith("/api/")) await handleApi(req, res);
    else await serveStatic(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno.";
    sendJson(res, 400, { error: message });
  }
});
server.listen(config.port, () => {
  console.log(`Pugotitasks rodando em http://localhost:${config.port}`);
});
