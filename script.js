(() => {
      const STORAGE_KEY = "fluxo-kanban-tasks-v1";
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
      let tasks = [];
      let draggedTaskId = null;
      let toastTimer;

      function showToast(message) {
        toast.textContent = message;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
      }

      function saveTasks() {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
          return true;
        } catch (error) {
          console.error("Não foi possível salvar as tarefas no armazenamento local.", error);
          showToast("Não foi possível salvar as alterações neste navegador.");
          return false;
        }
      }

      function loadTasks() {
        try {
          const stored = window.localStorage.getItem(STORAGE_KEY);
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

      tasks = loadTasks();
      render();
    })();
