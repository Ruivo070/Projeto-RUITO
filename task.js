// Carrega e edita os detalhes persistidos da tarefa.
(() => {
  const taskId = window.location.pathname.split("/").filter(Boolean).pop();
  const content = document.querySelector("#task-content");
  const accessState = document.querySelector("#access-state");
  const feedback = document.querySelector("#task-feedback");
  const checklist = document.querySelector("#checklist");
  const commentsList = document.querySelector("#comments-list");
  const toast = document.querySelector("#toast");
  let task = null;
  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function showFeedback(message, isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      ...options
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("/");
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    if (!response.ok) {
      const error = new Error(result.message || `A solicitação falhou (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
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

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function renderChecklist(items) {
    checklist.replaceChildren();
    const canEdit = task.role !== "VIEWER";
    if (items.length === 0) checklist.append(makeElement("li", "checklist-empty", "Nenhuma subtarefa adicionada."));
    let completed = 0;
    items.forEach(item => {
      if (item.done) completed += 1;
      const row = makeElement("li", "checklist-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(item.done);
      checkbox.disabled = !canEdit;
      checkbox.setAttribute("aria-label", `Concluída: ${item.text}`);
      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try {
          const updated = await api(`/api/checklist-items/${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ done: checkbox.checked })
          });
          Object.assign(item, updated);
          renderChecklist(task.checklist);
        } catch (error) {
          console.error("Não foi possível atualizar a subtarefa.", error);
          showToast(error.message);
          checkbox.checked = Boolean(item.done);
          checkbox.disabled = false;
        }
      });

      const text = makeElement("span", `checklist-text${item.done ? " is-done" : ""}`, item.text);
      row.append(checkbox, text);
      if (canEdit) {
        const remove = makeElement("button", "", "Excluir");
        remove.type = "button";
        remove.setAttribute("aria-label", `Excluir subtarefa: ${item.text}`);
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await api(`/api/checklist-items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
            task.checklist = task.checklist.filter(value => String(value.id) !== String(item.id));
            renderChecklist(task.checklist);
          } catch (error) {
            console.error("Não foi possível excluir a subtarefa.", error);
            showToast(error.message);
            remove.disabled = false;
          }
        });
        row.append(remove);
      }
      checklist.append(row);
    });
    const total = items.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    document.querySelector("#checklist-progress").textContent = `${completed}/${total} concluídas`;
    document.querySelector("#progress-bar").style.width = `${percentage}%`;
    document.querySelector(".progress-track").setAttribute("aria-valuenow", String(percentage));
  }

  function renderComments(items) {
    commentsList.replaceChildren();
    if (items.length === 0) {
      commentsList.append(makeElement("li", "comments-empty", "Ainda não há comentários."));
      return;
    }
    items.forEach(comment => {
      const item = makeElement("li", "comment-item");
      const meta = makeElement("div", "comment-meta");
      meta.append(makeElement("strong", "", comment.author_name));
      const time = makeElement("time", "", formatDate(comment.created_at));
      time.dateTime = comment.created_at;
      meta.append(time);
      item.append(meta, makeElement("p", "comment-body", comment.text));
      commentsList.append(item);
    });
  }

  function populateFields(data) {
    document.querySelector("#page-title").textContent = data.title;
    document.querySelector("#board-name").textContent = `Quadro: ${data.board_name}`;
    document.querySelector("#task-role").textContent = roleName(data.role);
    document.querySelector("#task-role").hidden = false;
    document.querySelector("#back-to-board").href = `/board.html?id=${encodeURIComponent(data.board_id)}`;
    document.querySelector("#task-title").value = data.title;
    document.querySelector("#task-description").value = data.description || "";
    document.querySelector("#task-status").value = data.status;
    document.querySelector("#task-due-date").value = data.due_date || "";
    document.querySelector("#task-priority").value = data.priority;
    document.querySelector("#task-labels").value = data.labels || "";
    document.querySelector("#created-note").textContent = `Criada em ${formatDate(data.created_at)}`;

    const assignee = document.querySelector("#task-assignee");
    assignee.replaceChildren(makeElement("option", "", "Sem responsável"));
    assignee.options[0].value = "";
    data.members.forEach(member => {
      const option = makeElement("option", "", member.name);
      option.value = String(member.id);
      assignee.append(option);
    });
    assignee.value = data.assignee_id === null ? "" : String(data.assignee_id);

    const canEdit = data.role !== "VIEWER";
    document.querySelector("#save-task").hidden = !canEdit;
    document.querySelector("#task-title").readOnly = !canEdit;
    document.querySelector("#task-description").readOnly = !canEdit;
    document.querySelector("#task-labels").readOnly = !canEdit;
    document.querySelector("#task-status").disabled = !canEdit;
    document.querySelector("#task-assignee").disabled = !canEdit;
    document.querySelector("#task-due-date").disabled = !canEdit;
    document.querySelector("#task-priority").disabled = !canEdit;
    document.querySelector("#checklist-form").hidden = !canEdit;
    document.querySelector("#comment-form").hidden = !canEdit;
    renderChecklist(data.checklist);
    renderComments(data.comments);
    content.hidden = false;
    accessState.hidden = true;
  }

  async function loadTask() {
    try {
      task = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
      populateFields(task);
    } catch (error) {
      console.error("Não foi possível carregar a tarefa.", error);
      if (error.status === 404 || error.status === 403) {
        content.hidden = true;
        accessState.hidden = false;
      } else {
        showToast(error.message);
      }
    }
  }

  document.querySelector("#save-task").addEventListener("click", async event => {
    if (!task || task.role === "VIEWER") return;
    const button = event.currentTarget;
    button.disabled = true;
    showFeedback("");
    const assigneeValue = document.querySelector("#task-assignee").value;
    const payload = {
      title: document.querySelector("#task-title").value.trim(),
      description: document.querySelector("#task-description").value,
      status: document.querySelector("#task-status").value,
      assignee_id: assigneeValue ? Number(assigneeValue) : null,
      due_date: document.querySelector("#task-due-date").value || null,
      priority: document.querySelector("#task-priority").value,
      labels: document.querySelector("#task-labels").value
    };
    try {
      task = { ...task, ...await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }) };
      document.querySelector("#page-title").textContent = task.title;
      document.title = `KanbanFlow — ${task.title}`;
      showFeedback("Alterações salvas.");
    } catch (error) {
      console.error("Não foi possível salvar a tarefa.", error);
      showFeedback(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#checklist-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!task || task.role === "VIEWER") return;
    const input = document.querySelector("#checklist-text");
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const item = await api(`/api/tasks/${encodeURIComponent(taskId)}/checklist`, {
        method: "POST",
        body: JSON.stringify({ text })
      });
      task.checklist.push(item);
      input.value = "";
      renderChecklist(task.checklist);
    } catch (error) {
      console.error("Não foi possível adicionar a subtarefa.", error);
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#comment-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!task || task.role === "VIEWER") return;
    const input = document.querySelector("#comment-text");
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const comment = await api(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: "POST",
        body: JSON.stringify({ text })
      });
      task.comments.push(comment);
      input.value = "";
      renderComments(task.comments);
    } catch (error) {
      console.error("Não foi possível publicar o comentário.", error);
      showToast(error.message);
    } finally {
      button.disabled = false;
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

  loadTask();
})();
