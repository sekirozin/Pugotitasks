import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { getProfile } from "./auth.js";
import { config } from "./config.js";
import { store } from "./store.js";
import type { Task } from "./types.js";

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

  if (url.pathname === "/api/bootstrap" && req.method === "GET") {
    sendJson(res, 200, {
      profile,
      folders: store.listFolders(profile.username),
      flags: store.listFlags(profile.username),
      tasks: store.listTasks(profile.username)
    });
    return;
  }

  if (url.pathname === "/api/folders" && req.method === "POST") {
    const body = await readJson<{ name?: string }>(req);
    sendJson(res, 201, { folder: store.createFolder(profile.username, body.name ?? "") });
    return;
  }
  const folderId = routeId(url.pathname, "folders");
  if (folderId && req.method === "PATCH") {
    const body = await readJson<{ name?: string }>(req);
    const folder = store.updateFolder(profile.username, folderId, body.name ?? "");
    sendJson(res, folder ? 200 : 404, folder ? { folder } : { error: "Pasta não encontrada." });
    return;
  }
  if (folderId && req.method === "DELETE") {
    sendJson(res, store.deleteFolder(profile.username, folderId) ? 200 : 404, { deleted: true });
    return;
  }

  if (url.pathname === "/api/flags" && req.method === "POST") {
    const body = await readJson<{ name?: string; color?: string }>(req);
    sendJson(res, 201, { flag: store.createFlag(profile.username, body.name ?? "", body.color ?? "") });
    return;
  }
  const flagId = routeId(url.pathname, "flags");
  if (flagId && req.method === "DELETE") {
    sendJson(res, store.deleteFlag(profile.username, flagId) ? 200 : 404, { deleted: true });
    return;
  }

  if (url.pathname === "/api/tasks" && req.method === "POST") {
    const body = await readJson<Partial<Task>>(req);
    sendJson(res, 201, { task: store.createTask(profile.username, body) });
    return;
  }
  const taskId = routeId(url.pathname, "tasks");
  if (taskId && req.method === "PATCH") {
    const body = await readJson<Partial<Task>>(req);
    const task = store.updateTask(profile.username, taskId, body);
    sendJson(res, task ? 200 : 404, task ? { task } : { error: "Tarefa não encontrada." });
    return;
  }
  if (taskId && req.method === "DELETE") {
    sendJson(res, store.deleteTask(profile.username, taskId) ? 200 : 404, { deleted: true });
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
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    const index = await fs.readFile(path.join(config.publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(index);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() });
      return;
    }
    if (req.url?.startsWith("/api/")) await handleApi(req, res);
    else await serveStatic(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno.";
    sendJson(res, 400, { error: message });
  }
});

server.listen(config.port, () => {
  console.log(`Pugotitasks rodando em http://localhost:${config.port}`);
});
