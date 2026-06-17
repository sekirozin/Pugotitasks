const app = document.querySelector("#app");
const icon = (name, className = "icon") => `<svg class="${className}" aria-hidden="true"><use href="/phosphor-sprite.svg#ph-${name}"></use></svg>`;
const state = {
  profile: null,
  folders: [],
  flags: [],
  tasks: [],
  noteFolders: [],
  notes: [],
  view: "today",
  activeFolderId: null,
  activeFlagId: null,
  activeNoteFolderId: null,
  search: "",
  profileOpen: false,
  duePickerOpen: false,
  modal: null,
  vaultUnlocked: false,
  vaultVisible: false,
  vaultToken: "",
  vaultTimeoutMinutes: 5,
  vaultSettingsDraft: "5",
  vaultError: "",
  vaultSettingsError: "",
  vaultSettingsMessage: "",
  theme: normalizeTheme(localStorage.getItem("pugotitasks-theme")),
  reorderTaskId: null,
  toast: ""
};
const folderIconList = ["book", "books", "bookmark-simple", "calendar", "chart-bar", "file-text", "gear", "house", "list", "lock", "lock-open", "play-circle", "playlist", "squares-four", "star", "user", "users", "fast-forward", "gauge", "seal-check", "arrows-left-right", "arrows-out-line-horizontal", "stack", "corners-out", "book-open", "tag", "rows", "pencil"];
const folderColors = ["#22c55e", "#ef4444", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#64748b"];
const flagColors = folderColors;
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
function safeFolderIcon(iconName) {
  return folderIconList.includes(iconName) ? iconName : "list";
}
function currentTitle() {
  if (state.activeNoteFolderId) return state.noteFolders.find((nf) => nf.id === state.activeNoteFolderId)?.name || "Notas";
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
              <span style="color:${escapeHtml(folder.color || "#64748b")}">${icon(safeFolderIcon(folder.icon))}</span>
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
          <div class="flag-row">
            <button type="button" class="flag-chip" style="--flag:${flag.color}" data-flag="${flag.id}">
              <span class="flag-dot"></span>${escapeHtml(flag.name)}
            </button>
            <button type="button" class="flag-remove" data-delete-flag="${flag.id}" title="Excluir flag">${icon("x")}</button>
          </div>
        `).join("")}
      </div>
      <div class="sidebar-section"><span>Notas</span><button type="button" class="icon-button" data-modal="note-folder" title="Nova pasta de notas">${icon("plus")}</button></div>
      <div class="nav-list">
        ${[...state.noteFolders].filter((nf) => !nf.locked || state.vaultVisible).sort((a, b) => (a.locked ? 1 : 0) - (b.locked ? 1 : 0)).map((nf) => `
          <div class="folder-row">
            <button type="button" class="nav-item ${state.activeNoteFolderId === nf.id ? "active" : ""}" data-note-folder="${nf.id}">
              <span style="color:${escapeHtml(nf.color || "#f59e0b")}">${icon(nf.locked ? (state.vaultUnlocked ? "lock-open" : "lock") : safeFolderIcon(nf.icon))}</span>
              <span>${escapeHtml(nf.name)}</span>
              <span class="count">${state.notes.filter((n) => n.folderId === nf.id).length}</span>
            </button>
            <button type="button" class="icon-button folder-actions" data-note-folder-menu="${nf.id}" title="Editar pasta de notas">${icon("dots-three-vertical")}</button>
          </div>
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
      <article class="task-card ${task.completed ? "completed" : ""} ${state.reorderTaskId === task.id ? "selected" : ""}" data-task-card="${task.id}">
        <button type="button" class="task-check ${task.completed ? "done" : ""}" data-complete="${task.id}" title="${task.completed ? "Reabrir" : "Concluir"}">
          ${task.completed ? '<svg viewBox="0 0 256 256" class="icon"><polyline points="216 72 88 200 40 152" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}
        </button>
        <div class="task-body" title="${task.completed ? "" : "Clique para selecionar e trocar com outra tarefa"}">
          <div class="task-title">${renderFormattedText(task.title)}</div>
          <div class="task-meta">
            ${folder ? `<span style="color:${escapeHtml(folder.color || "#64748b")}">${icon(safeFolderIcon(folder.icon))} ${escapeHtml(folder.name)}</span>` : ""}
            ${due ? `<span>${due}</span>` : ""}
            ${flag ? `<button type="button" class="task-flag" style="--flag:${flag.color}" data-task-flag="${flag.id}"><span class="flag-dot"></span>${escapeHtml(flag.name)}</button>` : ""}
          </div>
        </div>
        <button type="button" class="icon-button" data-important="${task.id}" title="Importante">${icon(task.important ? "star-fill" : "star")}</button>
        <button type="button" class="icon-button card-delete" data-delete-task-card="${task.id}" title="Excluir tarefa">${icon("trash")}</button>
      </article>
    `;
  }).join("") : `<div class="empty-state">${state.search ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa nesta lista."}</div>`;
}
function renderFormattedText(text) {
  return escapeHtml(text)
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/\/(.*?)\//g, '<em>$1</em>')
    .replace(/_(.*?)_/g, '<u>$1</u>')
    .replace(/\n/g, '<br>');
}
function renderNoteContent(text) {
  return renderFormattedText(text)
    .replace(/\$(.*?)\$/g, '<span class="text-upper">$1</span>')
    .replace(/~(.*?)~/g, '<span class="text-lower">$1</span>');
}

function renderNotes() {
  const notes = state.notes.filter((n) => n.folderId === state.activeNoteFolderId);
  if (!notes.length) return '<div class="empty-state">Nenhuma nota nesta pasta.</div>';
  return notes.map((note) => {
    const preview = note.content.length > 280 ? note.content.slice(0, 280) + "…" : note.content;
    const pinIcon = note.pinnedAt ? "bookmark-simple-fill" : "bookmark-simple";
    return `
      <article class="note-card" data-note-id="${note.id}">
        <div class="note-header">
          <div class="ns"></div>
          <div class="note-ct-header">
            <span class="note-title-inner">${renderFormattedText(note.title)}</span>
          </div>
          <div class="ns"></div>
        </div>
        <div class="note-body">
          <div class="ns"></div>
          <div class="note-ct-body">
            <div class="note-body-inner">${renderNoteContent(preview)}</div>
          </div>
          <div class="ns"></div>
        </div>
        <div class="note-bottom">
          <div class="ns"></div>
          <div class="note-ct-bottom">
            <span class="note-date">
              <span class="note-date-short">${new Date(note.updatedAt).toLocaleDateString("pt-BR")}</span>
              <span class="note-date-full">${new Date(note.updatedAt).toLocaleString("pt-BR")}</span>
            </span>
            <div class="note-actions">
              <button type="button" class="icon-button note-pin" data-pin-note="${note.id}" title="${note.pinnedAt ? "Desafixar" : "Fixar nota"}">${icon(pinIcon)}</button>
              <button type="button" class="icon-button note-delete" data-delete-note="${note.id}" title="Excluir nota">${icon("trash")}</button>
            </div>
          </div>
          <div class="ns"></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal.type === "note-folder-edit") {
    const nf = state.noteFolders.find((item) => item.id === state.modal.id);
    const iconVal = state.modal.icon || nf?.icon || "note";
    const colorVal = state.modal.color || nf?.color || "#f59e0b";
    return '<div class="modal-backdrop"><form class="modal" id="note-folder-edit-form"><h2>Editar pasta de notas</h2><div class="field"><span>Nome</span><input name="name" maxlength="60" value="' + escapeHtml(nf?.name || "") + '" required autofocus></div><div class="field"><span>Ícone</span><div class="icon-picker">' + folderIconList.map((name) => '<button type="button" class="icon-choice ' + (iconVal === name ? "selected" : "") + '" data-folder-icon="' + name + '" title="' + name + '">' + icon(name) + '</button>').join("") + '</div></div><div class="field"><span>Cor</span><div class="color-picker">' + folderColors.map((c) => '<button type="button" class="color-choice ' + (colorVal === c ? "selected" : "") + '" style="--color:' + c + '" data-folder-color="' + c + '" title="' + c + '"></button>').join("") + '</div></div><div class="modal-actions"><button type="button" class="danger-button" data-delete-note-folder="' + (nf?.id || "") + '">Excluir pasta</button><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Salvar</button></div></form></div>';
  }
  if (state.modal.type === "folder-edit") {
    const folder = state.folders.find((item) => item.id === state.modal.id);
    const iconVal = state.modal.icon || folder?.icon || "list";
    const colorVal = state.modal.color || folder?.color || "#64748b";
    return `<div class="modal-backdrop"><form class="modal" id="folder-edit-form"><h2>Editar pasta</h2><div class="field"><span>Nome</span><input name="name" maxlength="60" value="${escapeHtml(folder?.name || "")}" required autofocus></div><div class="field"><span>Ícone</span><div class="icon-picker">${folderIconList.map((name) => `<button type="button" class="icon-choice ${iconVal === name ? "selected" : ""}" data-folder-icon="${name}" title="${name}">${icon(name)}</button>`).join("")}</div></div><div class="field"><span>Cor</span><div class="color-picker">${folderColors.map((c) => `<button type="button" class="color-choice ${colorVal === c ? "selected" : ""}" style="--color:${c}" data-folder-color="${c}" title="${c}"></button>`).join("")}</div></div><div class="modal-actions"><button type="button" class="danger-button" data-delete-folder="${folder?.id}">Excluir</button><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Salvar</button></div></form></div>`;
  }
  if (state.modal.type === "folder") {
    const iconVal = state.modal.icon || "list";
    const colorVal = state.modal.color || "#64748b";
    return `<div class="modal-backdrop"><form class="modal" id="folder-form"><h2>Nova pasta</h2><div class="field"><span>Nome</span><input name="name" maxlength="60" placeholder="Ex.: Casa, Trabalho, Jogos" required autofocus></div><div class="field"><span>Ícone</span><div class="icon-picker">${folderIconList.map((name) => `<button type="button" class="icon-choice ${iconVal === name ? "selected" : ""}" data-folder-icon="${name}" title="${name}">${icon(name)}</button>`).join("")}</div></div><div class="field"><span>Cor</span><div class="color-picker">${folderColors.map((c) => `<button type="button" class="color-choice ${colorVal === c ? "selected" : ""}" style="--color:${c}" data-folder-color="${c}" title="${c}"></button>`).join("")}</div></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Criar pasta</button></div></form></div>`;
  }
  if (state.modal.type === "note-write") {
    return '<div class="modal-backdrop"><div class="modal note-write-editor"><h2>Nova nota</h2><div class="note-format-toolbar"><button type="button" class="fmt-btn" data-fmt="bold" title="Negrito"><strong>B</strong></button><button type="button" class="fmt-btn" data-fmt="italic" title="Itálico"><em>I</em></button><button type="button" class="fmt-btn" data-fmt="underline" title="Sublinhado"><u>U</u></button><button type="button" class="fmt-btn" data-fmt="upper" title="MAIÚSCULO"><span class="text-upper">A</span></button><button type="button" class="fmt-btn" data-fmt="lower" title="minúsculo"><span class="text-lower">a</span></button></div><input type="text" id="note-editor-title" maxlength="120" placeholder="Título da nota" autofocus style="width:100%;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);padding:10px 12px;outline:0;font-family:inherit;font-size:.95rem;margin-bottom:10px;box-sizing:border-box"><textarea id="note-editor-textarea" maxlength="5000" rows="8" placeholder="Escreva sua nota...\n\n*negrito* /itálico/ _sublinhado_\n$MAIÚSCULO$ ~minúsculo~" autofocus></textarea><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="button" class="primary-button" id="note-save-btn">Salvar</button></div></div></div>';
  }
  if (state.modal.type === "vault-unlock") {
    return '<div class="modal-backdrop"><div class="modal vault-unlock-modal"><h2>Desbloquear cofre</h2><p class="vault-lead">Digite sua senha do Pugotilab para acessar as pastas protegidas.</p><form id="vault-unlock-form"><input type="password" name="password" id="vault-password-input" placeholder="Senha do Pugotilab" autocomplete="current-password" required autofocus>' + (state.vaultError ? '<p class="error vault-error">' + escapeHtml(state.vaultError) + '</p>' : '') + '<div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Desbloquear</button></div></form></div></div>';
  }
  if (state.modal.type === "note-edit") {
    const note = state.notes.find((item) => item.id === state.modal.id);
    if (!note) return "";
    return '<div class="modal-backdrop"><div class="modal note-write-editor"><h2>Editar nota</h2><div class="note-format-toolbar"><button type="button" class="fmt-btn" data-fmt="bold" title="Negrito"><strong>B</strong></button><button type="button" class="fmt-btn" data-fmt="italic" title="Itálico"><em>I</em></button><button type="button" class="fmt-btn" data-fmt="underline" title="Sublinhado"><u>U</u></button><button type="button" class="fmt-btn" data-fmt="upper" title="MAIÚSCULO"><span class="text-upper">A</span></button><button type="button" class="fmt-btn" data-fmt="lower" title="minúsculo"><span class="text-lower">a</span></button></div><input type="text" id="note-edit-title" maxlength="120" placeholder="Título da nota" autofocus style="width:100%;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);padding:10px 12px;outline:0;font-family:inherit;font-size:.95rem;margin-bottom:10px;box-sizing:border-box" value="' + escapeHtml(note.title) + '"><textarea id="note-edit-textarea" maxlength="5000" rows="8" placeholder="Escreva sua nota...\n\n*negrito* /itálico/ _sublinhado_\n$MAIÚSCULO$ ~minúsculo~">' + escapeHtml(note.content) + '</textarea><div class="modal-actions"><button type="button" class="danger-button" data-delete-note-modal="' + note.id + '">Excluir nota</button><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="button" class="primary-button" id="note-edit-save-btn">Salvar</button></div></div></div>';
  }
  if (state.modal.type === "note-folder") {
    const iconVal = state.modal.icon || "note";
    const colorVal = state.modal.color || "#f59e0b";
    return '<div class="modal-backdrop"><form class="modal" id="note-folder-form"><h2>Nova pasta de notas</h2><div class="field"><span>Nome</span><input name="name" maxlength="60" placeholder="Ex.: Links, Ideias" required autofocus></div><div class="field"><span>Ícone</span><div class="icon-picker">' + folderIconList.map((name) => '<button type="button" class="icon-choice ' + (iconVal === name ? "selected" : "") + '" data-folder-icon="' + name + '" title="' + name + '">' + icon(name) + '</button>').join("") + '</div></div><div class="field"><span>Cor</span><div class="color-picker">' + folderColors.map((c) => '<button type="button" class="color-choice ' + (colorVal === c ? "selected" : "") + '" style="--color:' + c + '" data-folder-color="' + c + '" title="' + c + '"></button>').join("") + '</div></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Criar pasta</button></div></form></div>';
  }
  if (state.modal.type === "task") {
    const task = state.tasks.find((item) => item.id === state.modal.id);
    if (!task) return "";
    return `<div class="modal-backdrop"><form class="modal" id="task-edit-form"><h2>Editar tarefa</h2><div class="field"><span>Título</span><input name="title" maxlength="180" value="${escapeHtml(task.title)}" required autofocus></div><div class="field"><span>Notas</span><textarea name="notes" maxlength="4000" rows="3">${escapeHtml(task.notes)}</textarea></div><div class="field"><span>Vencimento</span><input name="dueAt" type="datetime-local" value="${task.dueAt ? (task.dueAt.includes("T") ? task.dueAt.slice(0, 16) : task.dueAt.slice(0, 10) + "T00:00") : ""}"></div><div class="field"><span>Flag</span><div class="flag-selector"><input type="hidden" name="flagId" value="${task.flagId || ""}"><button type="button" class="flag-chip${!task.flagId ? " selected" : ""}" data-flag-select=""><span class="flag-dot"></span>Sem flag</button>${state.flags.map((flag) => `<button type="button" class="flag-chip${task.flagId === flag.id ? " selected" : ""}" data-flag-select="${flag.id}" style="--flag:${flag.color}"><span class="flag-dot"></span>${escapeHtml(flag.name)}</button>`).join("")}</div></div><div class="modal-actions"><button type="button" class="danger-button" data-delete-task="${task.id}">Excluir tarefa</button><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Salvar</button></div></form></div>`;
  }
  return `<div class="modal-backdrop"><form class="modal" id="flag-form"><h2>Nova flag</h2><label class="field"><span>Nome</span><input name="name" maxlength="40" placeholder="Ex.: Financeiro" required autofocus></label><input type="hidden" name="color" value="${state.modal.color || flagColors[0]}"><div class="color-picker">${flagColors.map((color) => `<button type="button" class="color-choice ${state.modal.color === color || (!state.modal.color && color === flagColors[0]) ? "selected" : ""}" style="--color:${color}" data-color="${color}" title="${color}"></button>`).join("")}</div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Criar flag</button></div></form></div>`;
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
            ${state.profileOpen ? `<div class="profile-menu"><div class="profile-summary">${avatar(state.profile, "profile-avatar")}<div><strong>${escapeHtml(profileName())}</strong><span>@${escapeHtml(state.profile.username)}</span></div></div>${state.profile.biography ? `<p>${escapeHtml(state.profile.biography)}</p>` : ""}${state.profile.location ? `<p>${escapeHtml(state.profile.location)}</p>` : ""}${state.profile.role === "admin" ? `<form class="vault-settings-form" id="vault-settings-form"><label class="vault-settings-row"><span>Cofre: tempo sem atividade (min)</span><input name="vaultTimeoutMinutes" type="number" min="1" step="1" value="${escapeHtml(state.vaultSettingsDraft)}" required></label>${state.vaultSettingsError ? `<p class="error">${escapeHtml(state.vaultSettingsError)}</p>` : ""}${state.vaultSettingsMessage ? `<p class="scan-message">${escapeHtml(state.vaultSettingsMessage)}</p>` : ""}<button type="submit" class="button">Salvar</button></form>` : ""}<p>Perfil compartilhado Pugotilab</p></div>` : ""}
          </div>
        </div>
      </header>
      <div class="workspace">
        ${renderSidebar()}
        <main class="main-content">
          <div class="content-header"><div><h1>${escapeHtml(currentTitle())}</h1><p>${visibleTasks().length} tarefa(s)</p></div>${state.vaultUnlocked ? '<button type="button" class="icon-button vault-lock-button" id="lock-vault-button" title="Bloquear cofre">' + icon("lock") + '</button>' : ''}</div>
          ${state.activeNoteFolderId ? `
          <button type="button" class="primary-button note-add-btn" id="note-add-btn">${icon("plus")} Adicionar nota</button>
          <section class="note-grid">${renderNotes()}</section>
          ` : `
          <form class="task-composer" id="task-form"><input name="title" maxlength="180" placeholder="Adicionar uma tarefa" autocomplete="off" required><button type="button" class="icon-button" id="due-picker-toggle" title="Data de vencimento">${icon("calendar")}</button><button type="submit" class="primary-button">${icon("plus")} Adicionar</button>${state.duePickerOpen ? '<div class="due-picker"><input type="datetime-local" name="dueAt" id="due-input"><button type="button" class="secondary-button" id="due-clear">Limpar</button></div>' : ""}</form>
          <section class="task-list">${renderTasks()}</section>
          `}
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
  const data = await api("/api/bootstrap", { headers: state.vaultToken ? { "x-vault-token": state.vaultToken } : {} });
  if (!data.vaultUnlocked) { state.vaultUnlocked = false; state.vaultToken = ""; }
  if (data.vaultSettings) { state.vaultTimeoutMinutes = data.vaultSettings.vaultTimeoutMinutes; state.vaultSettingsDraft = String(data.vaultSettings.vaultTimeoutMinutes); }
  Object.assign(state, data);
  if (!state.activeFolderId && state.view === "all" && state.folders.length) state.activeFolderId = state.folders[0].id;
  render();
}
async function patchTask(id, changes) {
  const { task } = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) });
  state.tasks = state.tasks.map((item) => item.id === id ? task : item);
  if (task.completed && state.reorderTaskId === id) state.reorderTaskId = null;
  render();
}

async function reorderTasks(sourceId, targetId) {
  const { tasks } = await api("/api/tasks/reorder", { method: "POST", body: JSON.stringify({ sourceId, targetId }) });
  state.tasks = tasks;
  state.reorderTaskId = null;
  render();
}
let vaultInactivityTimer = null;
let lastVaultTouchAt = 0;
let vaultTouchInFlight = false;

async function lockVault() {
  await api("/api/vault/lock", { method: "POST" }).catch(() => undefined);
  clearVaultInactivityTimer();
  state.vaultUnlocked = false;
  state.vaultVisible = false;
  state.vaultToken = "";
  state.vaultError = "";
  lastVaultTouchAt = 0;
  state.activeNoteFolderId = null;
  state.activeFolderId = state.folders[0]?.id || null;
  state.activeFlagId = null;
  render();
}

function clearVaultInactivityTimer() {
  if (vaultInactivityTimer) {
    clearTimeout(vaultInactivityTimer);
    vaultInactivityTimer = null;
  }
}

function startVaultInactivityTimer() {
  clearVaultInactivityTimer();
  if (!state.vaultUnlocked) return;
  vaultInactivityTimer = setTimeout(() => { void lockVault(); }, state.vaultTimeoutMinutes * 60 * 1000);
}

function registerVaultActivity() {
  if (state.vaultUnlocked) {
    startVaultInactivityTimer();
    void touchVault();
  }
}

async function touchVault() {
  if (!state.vaultUnlocked || vaultTouchInFlight) return;
  const minTouchIntervalMs = Math.max(30000, Math.min(60000, state.vaultTimeoutMinutes * 30000));
  if (Date.now() - lastVaultTouchAt < minTouchIntervalMs) return;
  vaultTouchInFlight = true;
  try {
    const payload = await api("/api/vault/touch", { method: "POST", headers: { "x-vault-token": state.vaultToken } });
    state.vaultToken = payload.vaultToken;
    state.vaultTimeoutMinutes = payload.vaultTimeoutMinutes;
    state.vaultSettingsDraft = String(payload.vaultTimeoutMinutes);
    lastVaultTouchAt = Date.now();
  } catch { await lockVault(); }
  finally { vaultTouchInFlight = false; }
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
  document.querySelectorAll("[data-note-folder]").forEach((el) => el.addEventListener("click", () => {
    const folder = state.noteFolders.find((f) => f.id === el.dataset.noteFolder);
    if (folder?.locked && !state.vaultUnlocked) {
      state.modal = { type: "vault-unlock" }; render(); return;
    }
    state.activeNoteFolderId = el.dataset.noteFolder; state.activeFolderId = null; state.activeFlagId = null; render();
  }));
  document.querySelector("#note-add-btn")?.addEventListener("click", () => {
    state.modal = { type: "note-write", folderId: state.activeNoteFolderId }; render();
  });
  document.querySelectorAll(".note-card").forEach((el) => el.addEventListener("click", () => {
    const id = el.dataset.noteId;
    if (id) { state.modal = { type: "note-edit", id }; render(); }
  }));
  document.querySelectorAll("[data-delete-note]").forEach((el) => el.addEventListener("click", async (event) => {
    event.stopPropagation();
    const id = event.currentTarget.dataset.deleteNote;
    if (!confirm("Excluir esta nota?")) return;
    await api("/api/notes/" + id, { method: "DELETE" });
    state.notes = state.notes.filter((n) => n.id !== id); render();
  }));
  // note format toolbar
  document.querySelectorAll(".fmt-btn").forEach((btn) => btn.addEventListener("click", () => {
    const ta = btn.closest(".modal")?.querySelector("textarea");
    if (!ta) return;
    const maps = { bold: "*", italic: "/", underline: "_", upper: "$", lower: "~" };
    const m = maps[btn.dataset.fmt];
    if (!m) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const text = ta.value, before = text.slice(0, start), sel = text.slice(start, end), after = text.slice(end);
    ta.value = before + m + sel + m + after;
    ta.selectionStart = start + m.length;
    ta.selectionEnd = end + m.length;
    ta.focus();
  }));
  document.querySelector("#note-save-btn")?.addEventListener("click", async () => {
    const ta = document.querySelector("#note-editor-textarea");
    if (!ta || !ta.value.trim()) return;
    const titleVal = (document.querySelector("#note-editor-title")?.value || "").trim();
    const { note } = await api("/api/notes", { method: "POST", body: JSON.stringify({ folderId: state.activeNoteFolderId, title: titleVal, content: ta.value.trim() }) });
    state.notes.unshift(note); state.modal = null; render();
  });
  document.querySelector("#note-edit-save-btn")?.addEventListener("click", async () => {
    const id = state.modal.id;
    const titleVal = (document.querySelector("#note-edit-title")?.value || "").trim();
    const contentVal = (document.querySelector("#note-edit-textarea")?.value || "").trim();
    if (!contentVal) return;
    state.modal = null;
    const { note } = await api("/api/notes/" + id, { method: "PATCH", body: JSON.stringify({ title: titleVal, content: contentVal }) });
    state.notes = state.notes.map((n) => n.id === id ? note : n); render();
  });
  document.querySelector("#lock-vault-button")?.addEventListener("click", () => { void lockVault(); });
  document.querySelector("#vault-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const raw = String(data.get("vaultTimeoutMinutes") ?? "").trim();
    const minutes = Number(raw);
    state.vaultSettingsDraft = raw;
    if (!Number.isInteger(minutes) || minutes < 1) {
      state.vaultSettingsError = "Informe um número inteiro maior que zero.";
      state.vaultSettingsMessage = ""; render(); return;
    }
    try {
      const { vaultTimeoutMinutes } = await api("/api/vault/settings", { method: "PATCH", body: JSON.stringify({ vaultTimeoutMinutes: minutes }) });
      state.vaultTimeoutMinutes = vaultTimeoutMinutes;
      state.vaultSettingsDraft = String(vaultTimeoutMinutes);
      state.vaultSettingsError = "";
      state.vaultSettingsMessage = "Configuração salva.";
      if (state.vaultUnlocked) { lastVaultTouchAt = 0; startVaultInactivityTimer(); void touchVault(); }
      render();
    } catch (error) {
      state.vaultSettingsError = error instanceof Error ? error.message : "Erro ao salvar.";
      state.vaultSettingsMessage = ""; render();
    }
  });
  document.querySelector("[data-profile-toggle]")?.addEventListener("click", () => { state.profileOpen = !state.profileOpen; render(); });
  document.querySelector("#due-picker-toggle")?.addEventListener("click", () => { state.duePickerOpen = !state.duePickerOpen; render(); });
  document.querySelector("#due-clear")?.addEventListener("click", () => { const inp = document.querySelector("#due-input"); if (inp) inp.value = ""; state.duePickerOpen = false; render(); });
  document.querySelectorAll("[data-view]").forEach((element) => element.addEventListener("click", () => {
    state.view = element.dataset.view; state.activeFolderId = null; state.activeFlagId = null; state.activeNoteFolderId = null; render();
  }));
  document.querySelectorAll("[data-folder]").forEach((element) => element.addEventListener("click", () => {
    state.activeFolderId = element.dataset.folder; state.activeFlagId = null; state.activeNoteFolderId = null; render();
  }));
  document.querySelectorAll("[data-flag]").forEach((element) => element.addEventListener("click", () => {
    state.activeFlagId = element.dataset.flag; state.activeFolderId = null; state.activeNoteFolderId = null; render();
  }));
  document.querySelectorAll("[data-note-folder-menu]").forEach((element) => element.addEventListener("click", () => {
    const nf = state.noteFolders.find((f) => f.id === element.dataset.noteFolderMenu);
    state.modal = { type: "note-folder-edit", id: element.dataset.noteFolderMenu, icon: nf?.icon || "note", color: nf?.color || "#f59e0b" }; render();
  }));
  document.querySelectorAll("[data-folder-menu]").forEach((element) => element.addEventListener("click", () => {
    const folder = state.folders.find((f) => f.id === element.dataset.folderMenu);
    state.modal = { type: "folder-edit", id: element.dataset.folderMenu, icon: folder?.icon || "list", color: folder?.color || "#64748b" }; render();
  }));
  document.querySelectorAll("[data-modal]").forEach((element) => element.addEventListener("click", () => {
    state.modal = { type: element.dataset.modal, icon: "list", color: "#64748b" }; render();
  }));
  document.querySelectorAll("[data-close-modal]").forEach((element) => element.addEventListener("click", () => { state.modal = null; render(); }));
  document.querySelectorAll("[data-color]").forEach((element) => element.addEventListener("click", () => { state.modal.color = element.dataset.color; render(); }));
  document.querySelectorAll("[data-folder-icon]").forEach((element) => element.addEventListener("click", () => { state.modal.icon = element.dataset.folderIcon; render(); }));
  document.querySelectorAll("[data-folder-color]").forEach((element) => element.addEventListener("click", () => { state.modal.color = element.dataset.folderColor; render(); }));
  document.querySelector("#task-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const folderId = state.activeFolderId || state.folders[0]?.id;
    if (!folderId) return;
    const dueInput = document.querySelector("#due-input");
    const dueValue = dueInput?.value || null;
    const { task } = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: data.get("title"), folderId, flagId: state.activeFlagId, dueAt: dueValue || (state.view === "today" ? todayKey() : null), important: state.view === "important" }) });
    state.tasks.unshift(task); state.duePickerOpen = false; render();
  });
  document.querySelector("#folder-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const { folder } = await api("/api/folders", { method: "POST", body: JSON.stringify({ name: data.get("name"), icon: state.modal.icon, color: state.modal.color }) });
    state.folders.push(folder); state.modal = null; state.activeFolderId = folder.id; render();
  });
  document.querySelector("#folder-edit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const id = state.modal.id;
    const { folder } = await api(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name: data.get("name"), icon: state.modal.icon, color: state.modal.color }) });
    state.folders = state.folders.map((item) => item.id === id ? folder : item); state.modal = null; render();
  });
  document.querySelector("#flag-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const { flag } = await api("/api/flags", { method: "POST", body: JSON.stringify({ name: data.get("name"), color: data.get("color") }) });
    state.flags.push(flag); state.modal = null; state.activeFlagId = flag.id; state.activeFolderId = null; render();
  });
  document.querySelector("[data-modal='note-folder']")?.addEventListener("click", () => {
    state.modal = { type: "note-folder", icon: "note", color: "#f59e0b" }; render();
  });
  document.querySelector("[data-delete-note-modal]")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.dataset.deleteNoteModal;
    if (!confirm("Excluir esta nota?")) return;
    await api("/api/notes/" + id, { method: "DELETE" });
    state.notes = state.notes.filter((n) => n.id !== id); state.modal = null; render();
  });
  document.querySelector("#vault-password-input")?.focus();
  document.querySelector("#vault-unlock-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    state.vaultError = "";
    try {
      const payload = await api("/api/vault/unlock", { method: "POST", body: JSON.stringify({ password }) });
      state.vaultToken = payload.vaultToken;
      state.vaultTimeoutMinutes = payload.vaultTimeoutMinutes;
      state.vaultSettingsDraft = String(payload.vaultTimeoutMinutes);
      state.vaultUnlocked = true;
      state.vaultVisible = true;
      const notesData = await api("/api/vault/notes", { headers: { "x-vault-token": state.vaultToken } });
      state.notes = state.notes.concat(notesData.notes);
      state.modal = null;
      state.activeNoteFolderId = state.noteFolders.find((f) => f.locked)?.id || null;
      lastVaultTouchAt = Date.now();
      startVaultInactivityTimer();
      render();
    } catch (error) {
      state.vaultError = error instanceof Error ? error.message : "Senha inválida.";
      render();
    }
  });
  document.querySelector("#note-folder-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const { noteFolder } = await api("/api/note_folders", { method: "POST", body: JSON.stringify({ name: data.get("name"), icon: state.modal.icon, color: state.modal.color }) });
    state.noteFolders.push(noteFolder); state.modal = null; state.activeNoteFolderId = noteFolder.id; render();
  });
  document.querySelector("#note-folder-edit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const id = state.modal.id;
    const { noteFolder } = await api("/api/note_folders/" + id, { method: "PATCH", body: JSON.stringify({ name: data.get("name"), icon: state.modal.icon, color: state.modal.color }) });
    state.noteFolders = state.noteFolders.map((nf) => nf.id === id ? noteFolder : nf); state.modal = null; render();
  });
  document.querySelector("[data-delete-note-folder]")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.dataset.deleteNoteFolder;
    if (!confirm("Excluir pasta de notas e todas as notas dela?")) return;
    await api("/api/note_folders/" + id, { method: "DELETE" });
    state.noteFolders = state.noteFolders.filter((nf) => nf.id !== id);
    state.notes = state.notes.filter((n) => n.folderId !== id);
    state.modal = null; state.activeNoteFolderId = null; render();
  });
  document.querySelectorAll("[data-complete], [data-toggle-complete]").forEach((element) => element.addEventListener("click", async () => {
    const id = element.dataset.complete || element.dataset.toggleComplete; const task = state.tasks.find((item) => item.id === id);
    if (task) await patchTask(id, { completed: !task.completed });
  }));
  document.querySelectorAll("[data-task-card]").forEach((element) => element.addEventListener("click", async (event) => {
    if (event.target.closest("button")) return;
    const id = element.dataset.taskCard;
    const task = state.tasks.find((item) => item.id === id);
    if (!task || task.completed) return;
    if (!state.reorderTaskId) { state.reorderTaskId = id; render(); return; }
    if (state.reorderTaskId === id) { state.reorderTaskId = null; render(); return; }
    await reorderTasks(state.reorderTaskId, id);
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
  document.querySelectorAll(".task-body").forEach((element) => element.addEventListener("click", (event) => {
    const card = event.currentTarget.closest("[data-task-card]");
    if (card) {
      state.modal = { type: "task", id: card.dataset.taskCard };
      render();
    }
  }));
  document.querySelectorAll("[data-flag-select]").forEach((element) => element.addEventListener("click", () => {
    const flagId = element.dataset.flagSelect;
    const input = document.querySelector("[name='flagId']");
    if (!input) return;
    input.value = flagId;
    document.querySelectorAll("[data-flag-select]").forEach((btn) => btn.classList.remove("selected"));
    element.classList.add("selected");
  }));
  document.querySelector("#task-edit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = state.modal.id;
    state.modal = null;
    await patchTask(id, {
      title: data.get("title"),
      notes: data.get("notes"),
      dueAt: data.get("dueAt") || null,
      flagId: data.get("flagId") || null
    });
  });
  document.querySelectorAll("[data-delete-flag]").forEach((element) => element.addEventListener("click", async (event) => {
    event.stopPropagation();
    const id = event.currentTarget.dataset.deleteFlag;
    if (!confirm("Excluir esta flag?")) return;
    await api(`/api/flags/${id}`, { method: "DELETE" });
    state.flags = state.flags.filter((f) => f.id !== id);
    if (state.activeFlagId === id) state.activeFlagId = null;
    render();
  }));
  document.querySelectorAll("[data-delete-task-card]").forEach((element) => element.addEventListener("click", async (event) => {
    event.stopPropagation();
    const id = event.currentTarget.dataset.deleteTaskCard;
    if (!confirm("Excluir esta tarefa?")) return;
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    state.tasks = state.tasks.filter((t) => t.id !== id);
    render();
  }));
  document.querySelectorAll("[data-task-flag]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    state.activeFlagId = element.dataset.taskFlag;
    state.activeFolderId = null;
    state.activeNoteFolderId = null;
    render();
  }));
  document.querySelectorAll("[data-pin-note]").forEach((el) => el.addEventListener("click", async (event) => {
    event.stopPropagation();
    const id = event.currentTarget.dataset.pinNote;
    const { note } = await api("/api/notes/" + id + "/pin", { method: "PUT" });
    state.notes = state.notes.map((n) => n.id === id ? note : n);
    render();
  }));
  document.querySelectorAll(".note-card").forEach((card) => {
    const ctHeader = card.querySelector(".note-ct-header");
    if (ctHeader) {
      const inner = ctHeader.querySelector(".note-title-inner");
      if (inner && inner.scrollWidth > inner.clientWidth) {
        ctHeader.classList.add("overflow");
        const scrollAmt = -(inner.scrollWidth - inner.clientWidth) + "px";
        ctHeader.style.setProperty("--title-scroll", scrollAmt);
        ctHeader.addEventListener("mouseenter", () => {
          inner.style.overflow = "visible";
          inner.style.textOverflow = "clip";
          const cycle = () => {
            if (!ctHeader.matches(":hover")) return;
            inner.style.transition = "transform 3s ease";
            inner.style.transform = "translateX(" + scrollAmt + ")";
            ctHeader._returnTimer = setTimeout(() => {
              if (!ctHeader.matches(":hover")) return;
              inner.style.transition = "transform 3s ease";
              inner.style.transform = "translateX(0)";
              ctHeader._returnTimer = setTimeout(cycle, 2000);
            }, 3000);
          };
          cycle();
        });
        ctHeader.addEventListener("mouseleave", () => {
          clearTimeout(ctHeader._returnTimer);
          inner.style.overflow = "hidden";
          inner.style.textOverflow = "ellipsis";
          inner.style.transition = "transform 0.4s ease";
          inner.style.transform = "translateX(0)";
        });
      }
    }
    const ctBody = card.querySelector(".note-ct-body");
    if (ctBody) {
      const inner = ctBody.querySelector(".note-body-inner");
      if (inner && inner.scrollHeight > ctBody.clientHeight) {
        ctBody.classList.add("overflow");
        const scrollAmt = -(inner.scrollHeight - ctBody.clientHeight) + "px";
        ctBody.style.setProperty("--scroll", scrollAmt);
        ctBody.addEventListener("mouseenter", () => {
          const cycle = () => {
            if (!ctBody.matches(":hover")) return;
            inner.style.transition = "transform 3s ease";
            inner.style.transform = "translateY(" + scrollAmt + ")";
            ctBody._returnTimer = setTimeout(() => {
              if (!ctBody.matches(":hover")) return;
              inner.style.transition = "transform 3s ease";
              inner.style.transform = "translateY(0)";
              ctBody._returnTimer = setTimeout(cycle, 2000);
            }, 3000);
          };
          cycle();
        });
        ctBody.addEventListener("mouseleave", () => {
          clearTimeout(ctBody._returnTimer);
          inner.style.transition = "transform 0.4s ease";
          inner.style.transform = "translateY(0)";
        });
      }
    }
  });
}
// vault activity tracking
["click", "keydown", "pointermove", "scroll"].forEach((eventName) => {
  document.addEventListener(eventName, registerVaultActivity, { passive: true });
});

// vault keyboard shortcuts
document.addEventListener("keydown", (event) => {
  if (state.profile?.role === "admin" && event.ctrlKey && event.shiftKey && event.code === "Period") {
    event.preventDefault();
    if (!state.vaultUnlocked) { state.modal = { type: "vault-unlock" }; render(); }
    else if (state.vaultVisible) { void lockVault(); }
    else { state.vaultVisible = true; render(); }
    return;
  }
});

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
      app.innerHTML = `<div class="login-card"><h1>Pugotitasks</h1><p>Use sua conta Pugotilab para acessar suas tarefas.</p><a class="primary-button" href="${escapeHtml(error.loginUrl || "https://pugotilab.com/auth/login")}?return=${returnUrl}">Entrar com Pugotilab</a></div>`;
      return;
    }
    app.textContent = error.message;
  }
}
void boot();
