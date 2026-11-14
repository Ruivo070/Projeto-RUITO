(() => {
  const ownedList = document.querySelector("#owned-boards");
  const sharedList = document.querySelector("#shared-boards");
  const ownedEmpty = document.querySelector("#owned-empty");
  const sharedEmpty = document.querySelector("#shared-empty");
  const dialog = document.querySelector("#new-board-dialog");
  const form = document.querySelector("#new-board-form");
  const nameInput = document.querySelector("#board-name");
  const feedback = document.querySelector("#form-feedback");
  const toast = document.querySelector("#toast");
  let toastTimer;

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

  function roleName(role) {
    return { OWNER: "Dono", EDITOR: "Editor", VIEWER: "Leitor" }[role] || "Membro";
  }

  function createCard(board, isOwned) {
    const card = document.createElement("a");
    card.className = "board-card";
    card.href = `./board.html?id=${encodeURIComponent(board.id)}`;

    const details = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = board.name;
    details.append(name);
    if (!isOwned) {
      const owner = document.createElement("p");
      owner.textContent = `Dono: ${board.owner.name}`;
      details.append(owner);
    }

    const meta = document.createElement("div");
    meta.className = "board-card-meta";
    const role = document.createElement("span");
    role.className = "role-badge";
    role.textContent = roleName(board.role);
    meta.append(role);
    card.append(details, meta);
    return card;
  }

  function renderBoards(result) {
    ownedList.replaceChildren(...result.owned.map(board => createCard(board, true)));
    sharedList.replaceChildren(...result.shared.map(board => createCard(board, false)));
    ownedEmpty.hidden = result.owned.length !== 0;
    sharedEmpty.hidden = result.shared.length !== 0;
  }

  document.querySelector("#new-board").addEventListener("click", () => {
    feedback.textContent = "";
    form.reset();
    dialog.showModal();
    nameInput.focus();
  });
  document.querySelector("#close-new-board").addEventListener("click", () => dialog.close());
  document.querySelector("#cancel-new-board").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    feedback.textContent = "";
    try {
      const board = await api("/api/boards", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      window.location.assign(`./board.html?id=${encodeURIComponent(board.id)}`);
    } catch (error) {
      console.error("Não foi possível criar o quadro.", error);
      feedback.textContent = error.message;
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

  async function initialize() {
    try {
      renderBoards(await api("/api/boards"));
    } catch (error) {
      console.error("Não foi possível carregar os quadros.", error);
      if (!window.location.pathname.endsWith("index.html")) showToast(error.message);
    }
  }

  initialize();
})();
