const app = document.querySelector("#app");
const icon = (name, className = "icon") => `<svg class="${className}" aria-hidden="true"><use href="/phosphor-sprite.svg#ph-${name}"></use></svg>`;

const state = {
  profile: null,
  folders: [],
  flags: [],
  tasks: [],
  view: "today",
  activeFolderId: null,
  activeFlagId: null,
  search: "",
  profileOpen: false,
  modal: null,
  theme: normalizeTheme(localStorage.getItem("pugotitasks-theme")),
  toast: ""
};

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function applyTheme() {
  state.theme = normalizeTheme(state.theme);
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
}

applyTheme();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Não foi possível concluir a operação.");
    error.status = response.status;
    error.loginUrl = body.loginUrl;
    throw error;
  }
  return body;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function profileName() {
  return state.profile?.nickname || state.profile?.displayName || state.profile?.username || "";
}

function avatar(profile, className = "avatar-button") {
  const name = profileName();
  return profile?.avatarUrl
    ? `<span class="${className}"><img src="${escapeHtml(profile.avatarUrl)}" alt=""></span>`
    : `<span class="${className}">${escapeHtml(name.charAt(0).toUpperCase() || "P")}</span>`;
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function taskCount(predicate) {
  return state.tasks.filter(predicate).length;
}

function currentTitle() {
  if (state.activeFolderId) return state.folders.find((folder) => folder.id === state.activeFolderId)?.name || "Lista";
  if (state.activeFlagId) return state.flags.find((flag) => flag.id === state.activeFlagId)?.name || "Flag";
  return { today: "Meu dia", important: "Importantes", all: "Todas as tarefas", completed: "Concluídas" }[state.view] || "Tarefas";
}

function visibleTasks() {
  const search = state.search.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (search && !`${task.title} ${task.notes}`.toLowerCase().includes(search)) return false;
    if (state.activeFolderId) return task.folderId === state.activeFolderId;
    if (state.activeFlagId) return task.flagId === state.activeFlagId;
    if (state.view === "today") return !task.completed && task.dueAt?.slice(0, 10) === todayKey();
    if (state.view === "important") return !task.completed && task.important;
    if (state.view === "completed") return task.completed;
    return true;
  }).sort((a, b) => Number(a.completed) - Number(b.completed));
}

function renderSidebar() {
  const nav = [
    ["today", "sun", "Meu dia", taskCount((t) => !t.completed && t.dueAt?.slice(0, 10) === todayKey())],
    ["important", "star", "Importantes", taskCount((t) => !t.completed && t.important)],
    ["all", "list", "Todas", taskCount((t) => !t.completed)],
    ["completed", "seal-check", "Concluídas", taskCount((t) => t.completed)]
  ];
  return `
    <aside class="sidebar">
      <nav class="nav-list">
        ${nav.map(([view, glyph, label, count]) => `
          <button type="button" class="nav-item ${!state.activeFolderId && !state.activeFlagId && state.view === view ? "active" : ""}" data-view="${view}">
            ${icon(glyph)}<span>${label}</span><span class="count">${count}</span>
          </button>
        `).join("")}
      </nav>
      <div class="sidebar-section"><span>Pastas</span><button type="button" class="icon-button" data-modal="folder" title="Nova pasta">${icon("plus")}</button></div>
      <div class="nav-list">
        ${state.folders.map((folder) => `
          <div class="folder-row">
            <button type="button" class="nav-item ${state.activeFolderId === folder.id ? "active" : ""}" data-folder="${folder.id}">
              ${icon(folder.icon === "user" ? "user" : folder.icon === "file-text" ? "file-text" : "playlist")}
              <span>${escapeHtml(folder.name)}</span>
              <span class="count">${taskCount((task) => !task.completed && task.folderId === folder.id)}</span>
            </button>
            <button type="button" class="icon-button folder-actions" data-folder-menu="${folder.id}" title="Editar pasta">${icon("dots-three-vertical")}</button>
          </div>
        `).join("")}
      </div>
      <div class="sidebar-section"><span>Flags</span><button type="button" class="icon-button" data-modal="flag" title="Nova flag">${icon("plus")}</button></div>
      <div class="flags-cloud">
        ${state.flags.map((flag) => `
          <button type="button" class="flag-chip" style="--flag:${flag.color}" data-flag="${flag.id}">
            <span class="flag-dot"></span>${escapeHtml(flag.name)}
          </button>
        `).join("")}
      </div>
    </aside>
  `;
}

function renderTasks() {
  const tasks = visibleTasks();
  return tasks.length ? tasks.map((task) => {
    const folder = state.folders.find((item) => item.id === task.folderId);
    const flag = state.flags.find((item) => item.id === task.flagId);
    const due = task.dueAt ? new Date(`${task.dueAt.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "";
    return `
      <article class="task-card ${task.completed ? "completed" : ""}" data-task-card="${task.id}">
        <button type="button" class="task-check ${task.completed ? "done" : ""}" data-complete="${task.id}" title="${task.completed ? "Reabrir" : "Concluir"}">
          ${task.completed ? icon("seal-check") : ""}
        </button>
        <div class="task-body">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            ${folder ? `<span>${escapeHtml(folder.name)}</span>` : ""}
            ${due ? `<span>${icon("calendar")} ${due}</span>` : ""}
            ${flag ? `<span class="task-flag" style="--flag:${flag.color}"><span class="flag-dot"></span>${escapeHtml(flag.name)}</span>` : ""}
          </div>
        </div>
        <button type="button" class="icon-button" data-important="${task.id}" title="Importante">${icon(task.important ? "star-fill" : "star")}</button>
      </article>
    `;
  }).join("") : `<div class="empty-state">${state.search ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa nesta lista."}</div>`;
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal.type === "folder-edit") {
    const folder = state.folders.find((item) => item.id === state.modal.id);
    return `<div class="modal-backdrop"><form class="modal" id="folder-edit-form"><h2>Editar pasta</h2><label class="field"><span>Nome</span><input name="name" maxlength="60" value="${escapeHtml(folder?.name || "")}" required autofocus></label><div class="modal-actions"><button type="button" class="danger-button" data-delete-folder="${folder?.id}">Excluir</button><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Salvar</button></div></form></div>`;
  }
  if (state.modal.type === "folder") {
    return `<div class="modal-backdrop"><form class="modal" id="folder-form"><h2>Nova pasta</h2><label class="field"><span>Nome</span><input name="name" maxlength="60" placeholder="Ex.: Casa, Trabalho, Jogos" required autofocus></label><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Criar pasta</button></div></form></div>`;
  }
  const colors = ["#22c55e", "#ef4444", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#64748b"];
  return `<div class="modal-backdrop"><form class="modal" id="flag-form"><h2>Nova flag</h2><label class="field"><span>Nome</span><input name="name" maxlength="40" placeholder="Ex.: Financeiro" required autofocus></label><input type="hidden" name="color" value="${state.modal.color || colors[0]}"><div class="color-picker">${colors.map((color) => `<button type="button" class="color-choice ${state.modal.color === color || (!state.modal.color && color === colors[0]) ? "selected" : ""}" style="--color:${color}" data-color="${color}" title="${color}"></button>`).join("")}</div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Criar flag</button></div></form></div>`;
}

function render() {
  if (!state.profile) return;
  app.className = "";
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><span class="brand-badge">${icon("seal-check")}</span><span>Pugotitasks</span></div>
        <div class="topbar-actions">
          <label class="search-box">${icon("magnifying-glass")}<input id="search" placeholder="Pesquisar tarefas" value="${escapeHtml(state.search)}"></label>
          <button type="button" id="theme-toggle" class="icon-button" title="Alternar tema">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
          <div class="profile-shell">
            <button type="button" data-profile-toggle title="${escapeHtml(profileName())}" style="all:unset;cursor:pointer">${avatar(state.profile)}</button>
            ${state.profileOpen ? `<div class="profile-menu"><div class="profile-summary">${avatar(state.profile, "profile-avatar")}<div><strong>${escapeHtml(profileName())}</strong><span>@${escapeHtml(state.profile.username)}</span></div></div>${state.profile.biography ? `<p>${escapeHtml(state.profile.biography)}</p>` : ""}${state.profile.location ? `<p>${escapeHtml(state.profile.location)}</p>` : ""}<p>Perfil compartilhado Pugotilab</p></div>` : ""}
          </div>
        </div>
      </header>
      <div class="workspace">
        ${renderSidebar()}
        <main class="main-content">
          <div class="content-header"><div><h1>${escapeHtml(currentTitle())}</h1><p>${visibleTasks().length} tarefa(s)</p></div></div>
          <form class="task-composer" id="task-form"><input name="title" maxlength="180" placeholder="Adicionar uma tarefa" autocomplete="off" required><button type="submit" class="primary-button">${icon("plus")} Adicionar</button></form>
          <section class="task-list">${renderTasks()}</section>
        </main>
      </div>
    </div>
    ${renderModal()}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
  bindEvents();
}

function setToast(message) {
  state.toast = message;
  render();
  setTimeout(() => { if (state.toast === message) { state.toast = ""; render(); } }, 2500);
}

async function reload() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  if (!state.activeFolderId && state.view === "all" && state.folders.length) state.activeFolderId = state.folders[0].id;
  render();
}

async function patchTask(id, changes) {
  const { task } = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) });
  state.tasks = state.tasks.map((item) => item.id === id ? task : item);
  render();
}

function bindEvents() {
  document.querySelector("#search")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
    document.querySelector("#search")?.focus();
  });
  document.querySelector("#theme-toggle")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    state.theme = state.theme === "light" ? "dark" : "light";
    localStorage.setItem("pugotitasks-theme", state.theme);
    applyTheme();
    render();
  });
  document.querySelector("[data-profile-toggle]")?.addEventListener("click", () => { state.profileOpen = !state.profileOpen; render(); });
  document.querySelectorAll("[data-view]").forEach((element) => element.addEventListener("click", () => {
    state.view = element.dataset.view; state.activeFolderId = null; state.activeFlagId = null; render();
  }));
  document.querySelectorAll("[data-folder]").forEach((element) => element.addEventListener("click", () => {
    state.activeFolderId = element.dataset.folder; state.activeFlagId = null; render();
  }));
  document.querySelectorAll("[data-flag]").forEach((element) => element.addEventListener("click", () => {
    state.activeFlagId = element.dataset.flag; state.activeFolderId = null; render();
  }));
  document.querySelectorAll("[data-folder-menu]").forEach((element) => element.addEventListener("click", () => {
    state.modal = { type: "folder-edit", id: element.dataset.folderMenu }; render();
  }));
  document.querySelectorAll("[data-modal]").forEach((element) => element.addEventListener("click", () => { state.modal = { type: element.dataset.modal }; render(); }));
  document.querySelectorAll("[data-close-modal]").forEach((element) => element.addEventListener("click", () => { state.modal = null; render(); }));
  document.querySelectorAll("[data-color]").forEach((element) => element.addEventListener("click", () => { state.modal.color = element.dataset.color; render(); }));
  document.querySelector("#task-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const folderId = state.activeFolderId || state.folders[0]?.id;
    if (!folderId) return;
    const { task } = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: data.get("title"), folderId, flagId: state.activeFlagId, dueAt: state.view === "today" ? todayKey() : null, important: state.view === "important" }) });
    state.tasks.unshift(task); render();
  });
  document.querySelector("#folder-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const { folder } = await api("/api/folders", { method: "POST", body: JSON.stringify({ name: data.get("name") }) });
    state.folders.push(folder); state.modal = null; state.activeFolderId = folder.id; render();
  });
  document.querySelector("#folder-edit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const id = state.modal.id;
    const { folder } = await api(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name: data.get("name") }) });
    state.folders = state.folders.map((item) => item.id === id ? folder : item); state.modal = null; render();
  });
  document.querySelector("#flag-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const { flag } = await api("/api/flags", { method: "POST", body: JSON.stringify({ name: data.get("name"), color: data.get("color") }) });
    state.flags.push(flag); state.modal = null; state.activeFlagId = flag.id; state.activeFolderId = null; render();
  });
  document.querySelectorAll("[data-complete], [data-toggle-complete]").forEach((element) => element.addEventListener("click", async () => {
    const id = element.dataset.complete || element.dataset.toggleComplete; const task = state.tasks.find((item) => item.id === id);
    if (task) await patchTask(id, { completed: !task.completed });
  }));
  document.querySelectorAll("[data-important]").forEach((element) => element.addEventListener("click", async () => {
    const task = state.tasks.find((item) => item.id === element.dataset.important);
    if (task) await patchTask(task.id, { important: !task.important });
  }));
  document.querySelector("[data-delete-task]")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.dataset.deleteTask;
    if (!confirm("Excluir esta tarefa?")) return;
    await api(`/api/tasks/${id}`, { method: "DELETE" }); state.tasks = state.tasks.filter((task) => task.id !== id); render();
  });
  document.querySelector("[data-delete-folder]")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.dataset.deleteFolder;
    if (!confirm("Excluir a pasta e todas as tarefas dela?")) return;
    await api(`/api/folders/${id}`, { method: "DELETE" }); state.folders = state.folders.filter((folder) => folder.id !== id); state.tasks = state.tasks.filter((task) => task.folderId !== id); state.modal = null; state.activeFolderId = state.folders[0]?.id || null; render();
  });
}

async function boot() {
  try {
    const data = await api("/api/bootstrap");
    Object.assign(state, data);
    state.activeFolderId = state.folders[0]?.id || null;
    render();
  } catch (error) {
    if (error.status === 401) {
      app.className = "login-screen";
      const returnUrl = encodeURIComponent(window.location.href);
      app.innerHTML = `<div class="login-card"><h1>Pugotitasks</h1><p>Use sua conta Pugotilab para acessar suas tarefas.</p><a class="primary-button" href="${escapeHtml(error.loginUrl || "https://pugotilab.com/auth")}?return=${returnUrl}">Entrar com Pugotilab</a></div>`;
      return;
    }
    app.textContent = error.message;
  }
}

void boot();
