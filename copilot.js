// Chat do Co-Pilot: a IA é acessada exclusivamente pelo backend da aplicação.
(() => {
  const boardId = Number(new URLSearchParams(window.location.search).get("id"));
  const panel = document.querySelector("#copilot-panel");
  const toggle = document.querySelector("#copilot-toggle");
  const closeButton = document.querySelector("#copilot-close");
  const messages = document.querySelector("#copilot-messages");
  const form = document.querySelector("#copilot-form");
  const questionInput = document.querySelector("#copilot-question");
  const sendButton = document.querySelector("#copilot-send");
  const promptButtons = [...document.querySelectorAll(".copilot-chip")];
  let isSending = false;

  function appendMessage(type, text) {
    const message = document.createElement("div");
    message.className = `copilot-message copilot-message--${type}`;
    const content = document.createElement("p");
    content.textContent = text;
    message.append(content);
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  appendMessage("assistant", "Pergunte sobre as tarefas, prazos, responsáveis ou bloqueios deste quadro.");

  function setOpen(isOpen) {
    panel.hidden = !isOpen;
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Fechar Co-Pilot" : "Abrir Co-Pilot");
    if (isOpen) questionInput.focus();
    else toggle.focus();
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      setOpen(false);
    }
  });

  function setBusy(busy) {
    isSending = busy;
    questionInput.disabled = busy;
    sendButton.disabled = busy;
    promptButtons.forEach(button => { button.disabled = busy; });
    messages.setAttribute("aria-busy", String(busy));
  }

  async function sendQuestion(value) {
    const question = value.trim();
    if (!question || isSending) return;
    if (!Number.isSafeInteger(boardId) || boardId < 1) {
      appendMessage("error", "Não foi possível identificar este quadro.");
      return;
    }

    appendMessage("user", question);
    questionInput.value = "";
    setBusy(true);
    const thinkingMessage = appendMessage("thinking", "Pensando...");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ board_id: boardId, question })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof result?.message === "string" && result.message.trim()
          ? result.message
          : `Não foi possível enviar a pergunta (HTTP ${response.status}).`;
        appendMessage("error", message);
      } else if (typeof result?.answer === "string" && result.answer.trim()) {
        appendMessage("assistant", result.answer);
      } else {
        appendMessage("error", "A IA não retornou uma resposta válida. Tente novamente.");
      }
    } catch {
      appendMessage("error", "Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      thinkingMessage.remove();
      setBusy(false);
      if (!panel.hidden) questionInput.focus();
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    sendQuestion(questionInput.value);
  });

  promptButtons.forEach(button => {
    button.addEventListener("click", () => sendQuestion(button.textContent));
  });
})();
