// Funcionalidades do quadro Kanban compartilhado.
(() => {
  const statuses = [
    { id: "todo", label: "A Fazer" },
    { id: "doing", label: "Em Andamento" },
    { id: "done", label: "Concluído" }
  ];
  const boardId = new URLSearchParams(window.location.search).get("id");
  const dialog = document.querySelector("#task-dialog");
  const form = document.querySelector("#task-form");
  const titleInput = document.querySelector("#task-title");
  const descriptionInput = document.querySelector("#task-description");
  const toast = document.querySelector("#toast");
  const boardMain = document.querySelector("main");
  const shareDialog = document.querySelector("#share-dialog");
  const shareForm = document.querySelector("#share-form");
  const shareFeedback = document.querySelector("#share-feedback");
  const memberList = document.querySelector("#member-list");
  let boardRole = null;
  let tasks = [];
  let toastTimer;
  boardMain.inert = true;

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { "Accept": "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      ...options
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("./index.html");
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    if (!response.ok) throw new Error(result.message || `A solicitação falhou (HTTP ${response.status}).`);
    return result;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function roleName(role) {
    return { OWNER: "Dono", EDITOR: "Editor", VIEWER: "Leitor" }[role] || "Membro";
  }

  function createDeleteIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  function createCard(task) {
    const card = makeElement("article", "task-card");
    const canEdit = boardRole !== "VIEWER";
    card.draggable = canEdit;
    card.dataset.taskId = task.id;

    const top = makeElement("div", "card-top");
    const heading = makeElement("h3", "task-title");
    const taskLink = makeElement("a", "task-detail-link", task.title);
    taskLink.href = `/tasks/${encodeURIComponent(task.id)}`;
    taskLink.target = "_blank";
    taskLink.rel = "noopener";
    heading.append(taskLink);
    top.append(heading);

    if (boardRole === "OWNER") {
      const deleteButton = makeElement("button", "icon-button");
      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", `Excluir tarefa: ${task.title}`);
      deleteButton.title = "Excluir tarefa";
      deleteButton.append(createDeleteIcon());
      deleteButton.addEventListener("click", async () => {
        deleteButton.disabled = true;
        try {
          await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
          tasks = tasks.filter(item => String(item.id) !== String(task.id));
          render();
        } catch (error) {
          console.error("Não foi possível excluir a tarefa.", error);
          showToast(error.message);
          deleteButton.disabled = false;
        }
      });
      top.append(deleteButton);
    }
    card.append(top);

    if (task.description) card.append(makeElement("p", "task-description", task.description));

    const metadata = makeElement("div", "task-meta");
    if (task.assignee_name) {
      metadata.append(makeElement("span", "task-meta-item", `Responsável: ${task.assignee_name}`));
    }
    const priority = { low: "Baixa", medium: "Média", high: "Alta" }[task.priority] || "Média";
    metadata.append(makeElement("span", `priority-badge priority-${task.priority || "medium"}`, priority));
    if (task.due_date) metadata.append(makeElement("span", "task-meta-item", `Prazo: ${task.due_date}`));
    if (task.checklist_total) {
      metadata.append(makeElement("span", "task-meta-item", `Checklist: ${task.checklist_done || 0}/${task.checklist_total}`));
    }
    if (typeof task.labels === "string" && task.labels.trim()) {
      task.labels.split(",").map(label => label.trim()).filter(Boolean).forEach(label => {
        metadata.append(makeElement("span", "label-badge", label));
      });
    }
    if (metadata.childElementCount) card.append(metadata);

    const footer = makeElement("div", "card-footer");
    const select = makeElement("select", "status-select");
    select.setAttribute("aria-label", `Mover "${task.title}" para`);
    select.disabled = !canEdit;
    statuses.forEach(status => {
      const option = makeElement("option", "", status.label);
      option.value = status.id;
      option.selected = task.status === status.id;
      select.append(option);
    });
    select.addEventListener("change", () => moveTask(task.id, select.value));
    footer.append(select);
    card.append(footer);

    if (canEdit) {
      card.addEventListener("dragstart", event => {
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(task.id));
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        document.querySelectorAll(".column.is-over").forEach(column => column.classList.remove("is-over"));
      });
    }
    return card;
  }

  function render() {
    statuses.forEach(status => {
      const list = document.querySelector(`[data-list="${status.id}"]`);
      const column = list.closest(".column");
      const columnTasks = tasks.filter(task => task.status === status.id);
      list.replaceChildren();
      column.querySelector(".count").textContent = String(columnTasks.length);
      column.querySelector(".count").setAttribute(
        "aria-label",
        `${columnTasks.length} ${columnTasks.length === 1 ? "tarefa" : "tarefas"}`
      );
      if (columnTasks.length === 0) {
        list.append(makeElement("div", "empty-state", "Nenhuma tarefa nesta etapa."));
      } else {
        columnTasks.forEach(task => list.append(createCard(task)));
      }
    });
  }

  async function moveTask(taskId, status) {
    if (!statuses.some(item => item.id === status)) return;
    const task = tasks.find(item => String(item.id) === String(taskId));
    if (!task || task.status === status) return;
    const previousStatus = task.status;
    task.status = status;
    render();
    try {
      const updated = await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      Object.assign(task, updated);
      render();
    } catch (error) {
      task.status = previousStatus;
      render();
      console.error("Não foi possível mover a tarefa.", error);
      showToast(error.message);
    }
  }

  document.querySelector("#open-modal").addEventListener("click", () => {
    form.reset();
    dialog.showModal();
    titleInput.focus();
  });
  function closeDialog() {
    dialog.close();
    form.reset();
  }
  document.querySelector("#close-modal").addEventListener("click", closeDialog);
  document.querySelector("#cancel-modal").addEventListener("click", closeDialog);
  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const task = await api(`/api/boards/${encodeURIComponent(boardId)}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, description: descriptionInput.value.trim() })
      });
      tasks.unshift(task);
      render();
      closeDialog();
    } catch (error) {
      console.error("Não foi possível criar a tarefa.", error);
      showToast(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll(".column").forEach(column => {
    column.addEventListener("dragover", event => {
      if (boardRole === "VIEWER") return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("is-over");
    });
    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("is-over");
    });
    column.addEventListener("drop", event => {
      if (boardRole === "VIEWER") return;
      event.preventDefault();
      column.classList.remove("is-over");
      moveTask(event.dataTransfer.getData("text/plain"), column.dataset.status);
    });
  });

  function renderMembers(members, ownerId) {
    memberList.replaceChildren();
    members.forEach(member => {
      const row = makeElement("li", "member-row");
      const identity = makeElement("div", "member-identity");
      identity.append(
        makeElement("strong", "", member.name),
        makeElement("span", "", member.email)
      );
      row.append(identity);
      if (String(member.id) === String(ownerId)) {
        row.append(makeElement("span", "role-badge", "Dono"));
      } else {
        const controls = makeElement("div", "member-controls");
        const select = makeElement("select", "member-role");
        select.setAttribute("aria-label", `Papel de ${member.name}`);
        [
          ["EDITOR", "Editor"],
          ["VIEWER", "Leitor"]
        ].forEach(([value, label]) => {
          const option = makeElement("option", "", label);
          option.value = value;
          option.selected = member.role === value;
          select.append(option);
        });
        select.addEventListener("change", async () => {
          select.disabled = true;
          try {
            await api(`/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(member.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ role: select.value })
            });
            await loadBoard();
            showShareFeedback("Papel atualizado.", false);
          } catch (error) {
            console.error("Não foi possível atualizar o papel.", error);
            showShareFeedback(error.message, true);
            select.disabled = false;
          }
        });
        const remove = makeElement("button", "remove-member", "Remover acesso");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await api(`/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(member.id)}`, {
              method: "DELETE"
            });
            await loadBoard();
            showShareFeedback("Acesso removido.", false);
          } catch (error) {
            console.error("Não foi possível remover o acesso.", error);
            showShareFeedback(error.message, true);
            remove.disabled = false;
          }
        });
        controls.append(select, remove);
        row.append(controls);
      }
      memberList.append(row);
    });
  }

  function showShareFeedback(message, isError) {
    shareFeedback.textContent = message;
    shareFeedback.classList.toggle("is-error", isError);
  }

  async function loadBoard() {
    const result = await api(`/api/boards/${encodeURIComponent(boardId)}`);
    document.querySelector("#page-title").textContent = result.name;
    document.querySelector("#board-role").textContent = roleName(result.role);
    boardRole = result.role;
    tasks = result.tasks;
    const canEdit = boardRole !== "VIEWER";
    document.querySelector("#open-modal").hidden = !canEdit;
    document.querySelector(".board-hint").hidden = !canEdit;
    document.querySelector("#share-board").hidden = boardRole !== "OWNER";
    render();
    if (boardRole === "OWNER") renderMembers(result.members, result.owner.id);
    boardMain.inert = false;
  }

  document.querySelector("#share-board").addEventListener("click", () => {
    showShareFeedback("", false);
    shareDialog.showModal();
  });
  function closeShareDialog() {
    shareDialog.close();
    shareForm.reset();
  }
  document.querySelector("#close-share").addEventListener("click", closeShareDialog);
  document.querySelector("#cancel-share").addEventListener("click", closeShareDialog);
  shareDialog.addEventListener("click", event => {
    if (event.target === shareDialog) closeShareDialog();
  });
  shareForm.addEventListener("submit", async event => {
    event.preventDefault();
    const email = document.querySelector("#invite-email").value.trim();
    const role = document.querySelector("#invite-role").value;
    const submit = shareForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api(`/api/boards/${encodeURIComponent(boardId)}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role })
      });
      shareForm.reset();
      await loadBoard();
      showShareFeedback("Convite enviado e acesso concedido.", false);
    } catch (error) {
      console.error("Não foi possível convidar o membro.", error);
      showShareFeedback(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#logout-button").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/logout", { method: "POST" });
      window.location.assign("./index.html");
    } catch (error) {
      console.error("Não foi possível encerrar a sessão.", error);
      showToast(error.message);
      button.disabled = false;
    }
  });

  let loadInProgress = false;
  async function refreshBoard() {
    if (!boardId || loadInProgress || document.visibilityState === "hidden") return;
    loadInProgress = true;
    try {
      await loadBoard();
    } catch (error) {
      console.error("Não foi possível atualizar o quadro.", error);
      showToast(error.message);
    } finally {
      loadInProgress = false;
    }
  }
  document.addEventListener("visibilitychange", refreshBoard);
  window.addEventListener("focus", refreshBoard);

  if (!boardId) {
    window.location.replace("./boards.html");
  } else {
    refreshBoard();
  }
})();
