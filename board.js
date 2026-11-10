// Funcionalidades do quadro Kanban.
(() => {
      const statuses = [
        { id: "todo", label: "A Fazer" },
        { id: "doing", label: "Em Andamento" },
        { id: "done", label: "Concluído" }
      ];
      const dialog = document.querySelector("#task-dialog");
      const form = document.querySelector("#task-form");
      const titleInput = document.querySelector("#task-title");
      const descriptionInput = document.querySelector("#task-description");
      const toast = document.querySelector("#toast");
      const logoutButton = document.querySelector("#logout-button");
      const boardMain = document.querySelector("main");
      let tasks = [];
      let storageKey = null;
      let draggedTaskId = null;
      let toastTimer;
      boardMain.inert = true;

      // A sessão deve ser mantida pelo backend em cookie HttpOnly, nunca como senha no navegador.
      logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;
        let serverLogoutFailed = false;
        try {
          const response = await fetch("/api/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
          });
          if (!response.ok) {
            serverLogoutFailed = true;
            console.error(`O servidor não encerrou a sessão (HTTP ${response.status}).`);
          }
        } catch (error) {
          serverLogoutFailed = true;
          console.error("Não foi possível confirmar o encerramento da sessão no servidor.", error);
        } finally {
          try {
            window.sessionStorage.clear();
          } catch (error) {
            console.error("Não foi possível limpar os dados temporários da sessão.", error);
          }
          window.location.assign(serverLogoutFailed ? "./index.html?logout=server-error" : "./index.html");
        }
      });

      function showToast(message) {
        toast.textContent = message;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
      }

      function saveTasks() {
        try {
          if (!storageKey) throw new Error("O quadro ainda não foi associado a uma conta.");
          window.localStorage.setItem(storageKey, JSON.stringify(tasks));
          return true;
        } catch (error) {
          console.error("Não foi possível salvar as tarefas no armazenamento local.", error);
          showToast("Não foi possível salvar as alterações neste navegador.");
          return false;
        }
      }

      function loadTasks() {
        try {
          if (!storageKey) throw new Error("O quadro ainda não foi associado a uma conta.");
          const stored = window.localStorage.getItem(storageKey);
          if (stored === null) return [];
          const parsed = JSON.parse(stored);
          if (!Array.isArray(parsed)) throw new TypeError("O formato das tarefas salvas é inválido.");
          return parsed.filter(task =>
            task && typeof task.id === "string" &&
            typeof task.title === "string" &&
            typeof task.description === "string" &&
            statuses.some(status => status.id === task.status)
          );
        } catch (error) {
          console.error("Não foi possível carregar as tarefas salvas.", error);
          showToast("Não foi possível carregar as tarefas salvas. Um quadro vazio foi aberto.");
          return [];
        }
      }

      function makeElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      }

      function createCard(task) {
        const card = makeElement("article", "task-card");
        card.draggable = true;
        card.dataset.taskId = task.id;

        const top = makeElement("div", "card-top");
        top.append(makeElement("h3", "task-title", task.title));

        const deleteButton = makeElement("button", "icon-button");
        deleteButton.type = "button";
        deleteButton.setAttribute("aria-label", `Excluir tarefa: ${task.title}`);
        deleteButton.title = "Excluir tarefa";
        deleteButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        deleteButton.addEventListener("click", () => {
          tasks = tasks.filter(item => item.id !== task.id);
          saveTasks();
          render();
        });
        top.append(deleteButton);
        card.append(top);

        if (task.description) {
          card.append(makeElement("p", "task-description", task.description));
        }

        const footer = makeElement("div", "card-footer");
        const select = makeElement("select", "status-select");
        select.setAttribute("aria-label", `Mover "${task.title}" para`);
        statuses.forEach(status => {
          const option = makeElement("option", "", status.label);
          option.value = status.id;
          option.selected = task.status === status.id;
          select.append(option);
        });
        select.addEventListener("change", () => moveTask(task.id, select.value));
        footer.append(select);
        card.append(footer);

        card.addEventListener("dragstart", event => {
          draggedTaskId = task.id;
          card.classList.add("is-dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
        });
        card.addEventListener("dragend", () => {
          draggedTaskId = null;
          card.classList.remove("is-dragging");
          document.querySelectorAll(".column.is-over").forEach(column => column.classList.remove("is-over"));
        });
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
            list.append(makeElement("div", "empty-state", "Solte uma tarefa aqui ou adicione uma nova."));
          } else {
            columnTasks.forEach(task => list.append(createCard(task)));
          }
        });
      }

      function moveTask(taskId, status) {
        if (!statuses.some(item => item.id === status)) return;
        const task = tasks.find(item => item.id === taskId);
        if (!task || task.status === status) return;
        task.status = status;
        saveTasks();
        render();
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

      form.addEventListener("submit", event => {
        event.preventDefault();
        const title = titleInput.value.trim();
        if (!title) {
          titleInput.focus();
          return;
        }
        tasks.unshift({
          id: window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title,
          description: descriptionInput.value.trim(),
          status: "todo"
        });
        saveTasks();
        render();
        closeDialog();
      });

      document.querySelectorAll(".column").forEach(column => {
        column.addEventListener("dragover", event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          column.classList.add("is-over");
        });
        column.addEventListener("dragleave", event => {
          if (!column.contains(event.relatedTarget)) column.classList.remove("is-over");
        });
        column.addEventListener("drop", event => {
          event.preventDefault();
          column.classList.remove("is-over");
          const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
          moveTask(taskId, column.dataset.status);
        });
      });

      // Carrega apenas o quadro do usuário autenticado nesta sessão.
      async function initializeBoard() {
        try {
          const response = await fetch("/api/me", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
          });
          if (response.status === 401) {
            window.location.replace("./index.html");
            return;
          }
          if (!response.ok) {
            throw new Error(`Não foi possível validar a sessão (HTTP ${response.status}).`);
          }

          const user = await response.json();
          if (!user || typeof user.username !== "string" || !user.username) {
            throw new Error("A resposta do servidor não contém um usuário válido.");
          }

          storageKey = `tasks:${user.username.toLowerCase()}`;
          tasks = loadTasks();
          render();
          boardMain.inert = false;
        } catch (error) {
          console.error("Não foi possível carregar o quadro autenticado.", error);
          showToast("Não foi possível validar sua sessão. Atualize a página ou entre novamente.");
        }
      }

      initializeBoard();
    })();
