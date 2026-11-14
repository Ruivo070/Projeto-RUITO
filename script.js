(() => {
  const loginTab = document.querySelector("#login-tab");
  const registerTab = document.querySelector("#register-tab");
  const loginForm = document.querySelector("#login-panel");
  const registerForm = document.querySelector("#register-panel");
  const title = document.querySelector("#form-title");
  const subtitle = document.querySelector("#form-subtitle");
  const eyebrow = document.querySelector("#form-eyebrow");

  // Exibe erros junto aos campos e aplica o estado visual correspondente.
  function setFieldState(input, message = "", valid = false) {
    const error = document.querySelector(`#${input.id}-error`);
    input.classList.toggle("is-invalid", Boolean(message));
    input.classList.toggle("is-valid", valid && !message);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (error) error.textContent = message;
  }

  function clearFormFeedback(form) {
    form.querySelectorAll("input").forEach(input => setFieldState(input));
    const message = form.querySelector(".form-message");
    message.hidden = true;
    message.textContent = "";
    message.className = "form-message";
  }

  function setFormMessage(form, message, type) {
    const element = form.querySelector(".form-message");
    element.textContent = message;
    element.className = `form-message is-${type}`;
    element.hidden = false;
  }

  // Alterna as abas sem recarregar e mantém os formulários acessíveis.
  function showPanel(panel) {
    const isLogin = panel === "login";
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    loginTab.classList.toggle("is-active", isLogin);
    registerTab.classList.toggle("is-active", !isLogin);
    loginTab.setAttribute("aria-selected", String(isLogin));
    registerTab.setAttribute("aria-selected", String(!isLogin));
    title.textContent = isLogin ? "Acesse sua conta" : "Crie sua conta";
    subtitle.textContent = isLogin
      ? "Entre para continuar organizando seu fluxo."
      : "Comece a organizar seus projetos com clareza.";
    eyebrow.textContent = isLogin ? "BEM-VINDO DE VOLTA" : "SEU FLUXO COMEÇA AQUI";
    clearFormFeedback(loginForm);
    clearFormFeedback(registerForm);
  }

  loginTab.addEventListener("click", () => showPanel("login"));
  registerTab.addEventListener("click", () => showPanel("register"));
  document.querySelectorAll("[data-switch]").forEach(button => {
    button.addEventListener("click", () => showPanel(button.dataset.switch));
  });

  // Permite conferir a senha sem alterar seu valor.
  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const showing = input.type === "password";
      input.type = showing ? "text" : "password";
      button.setAttribute("aria-label", showing ? "Ocultar senha" : "Mostrar senha");
      button.setAttribute("aria-pressed", String(showing));
    });
  });

  function validateEmail(input) {
    if (!input.value.trim()) return "Informe seu e-mail.";
    if (!input.validity.valid) return "Digite um e-mail válido.";
    return "";
  }

  function validateLogin() {
    const identifier = document.querySelector("#login-identifier");
    const password = document.querySelector("#login-password");
    const identifierValue = identifier.value.trim();
    const identifierError = !identifierValue
      ? "Informe seu e-mail ou usuário."
      : identifierValue.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifierValue)
        ? "Digite um e-mail válido ou informe seu usuário."
        : "";
    const passwordError = password.value.trim() ? "" : "Informe sua senha.";
    setFieldState(identifier, identifierError, !identifierError);
    setFieldState(password, passwordError, !passwordError);
    return !identifierError && !passwordError;
  }

  function validateRegister() {
    const name = document.querySelector("#register-name");
    const username = document.querySelector("#register-username");
    const email = document.querySelector("#register-email");
    const password = document.querySelector("#register-password");
    const confirmation = document.querySelector("#register-confirm-password");
    const nameError = name.value.trim() ? "" : "Informe seu nome.";
    const usernameValue = username.value.trim();
    const usernameError = !usernameValue
      ? "Informe seu nome de usuário."
      : !/^[A-Za-z0-9_]{3,20}$/.test(usernameValue)
        ? "Use de 3 a 20 caracteres: letras, números ou _."
        : "";
    const emailError = validateEmail(email);
    let passwordError = "";
    let confirmationError = "";

    if (password.value.length < 8) passwordError = "A senha deve ter pelo menos 8 caracteres.";
    if (!confirmation.value) confirmationError = "Confirme sua senha.";
    else if (password.value !== confirmation.value) confirmationError = "As senhas não conferem.";

    setFieldState(name, nameError, !nameError);
    setFieldState(username, usernameError, !usernameError);
    setFieldState(email, emailError, !emailError);
    setFieldState(password, passwordError, !passwordError);
    setFieldState(confirmation, confirmationError, !confirmationError);
    return !nameError && !usernameError && !emailError && !passwordError && !confirmationError;
  }

  // Envia credenciais em JSON e apresenta erros do servidor sem simular autenticação.
  async function sendForm(form, endpoint, payload, submitLabel, onSuccess) {
    const button = form.querySelector(".submit-button");
    const label = button.querySelector(".button-label");
    button.disabled = true;
    button.classList.add("is-loading");
    label.textContent = "Aguarde...";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let result = {};
      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch (error) {
          if (response.ok) throw new Error("O servidor retornou uma resposta inválida.");
        }
      }

      if (!response.ok) {
        let message;
        if (response.status === 404 || response.status === 405) {
          message = "Servidor não encontrado. Inicie o backend e acesse pelo endereço do Flask.";
        } else if (response.status >= 500) {
          message = "Erro no servidor. Tente novamente mais tarde.";
        } else if (response.status === 401 || response.status === 403) {
          message = "E-mail, usuário ou senha incorretos.";
        } else {
          message = (typeof result.message === "string" && result.message) ||
            (typeof result.error === "string" && result.error) ||
            (response.status === 409 ? "Este e-mail ou usuário já está cadastrado." : "Não foi possível concluir. Confira os dados e tente novamente.");
        }
        setFormMessage(form, message, "error");
        return;
      }

      onSuccess(result);
    } catch (error) {
      console.error(`Falha ao enviar solicitação para ${endpoint}.`, error);
      setFormMessage(form, "Não foi possível conectar ao servidor. Tente novamente em instantes.", "error");
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
      label.textContent = submitLabel;
    }
  }

  loginForm.addEventListener("submit", event => {
    event.preventDefault();
    clearFormFeedback(loginForm);
    if (!validateLogin()) return;

    sendForm(
      loginForm,
      "/api/login",
      {
        identifier: document.querySelector("#login-identifier").value.trim(),
        password: document.querySelector("#login-password").value
      },
      "Entrar",
      () => window.location.assign("./boards.html")
    );
  });

  registerForm.addEventListener("submit", event => {
    event.preventDefault();
    clearFormFeedback(registerForm);
    if (!validateRegister()) return;

    sendForm(
      registerForm,
      "/api/register",
      {
        name: document.querySelector("#register-name").value.trim(),
        username: document.querySelector("#register-username").value.trim(),
        email: document.querySelector("#register-email").value.trim(),
        password: document.querySelector("#register-password").value
      },
      "Criar conta",
      result => {
        const successMessage = typeof result.message === "string" && result.message
          ? result.message
          : "Conta criada com sucesso! Agora você já pode entrar.";
        const registeredEmail = document.querySelector("#register-email").value.trim();
        registerForm.reset();
        registerForm.querySelectorAll("input").forEach(input => setFieldState(input));
        showPanel("login");
        document.querySelector("#login-identifier").value = registeredEmail;
        setFormMessage(loginForm, successMessage, "success");
        document.querySelector("#login-identifier").focus();
      }
    );
  });

  // Mantém a ação de recuperação explícita até o backend oferecer esse endpoint.
  document.querySelector("#forgot-password").addEventListener("click", event => {
    event.preventDefault();
    setFormMessage(loginForm, "A recuperação de senha estará disponível quando o serviço de autenticação estiver configurado.", "error");
  });

  // Valida novamente os campos já preenchidos enquanto a pessoa corrige os dados.
  document.querySelectorAll(".auth-form input").forEach(input => {
    input.addEventListener("input", () => {
      if (input.classList.contains("is-invalid") || input.classList.contains("is-valid")) {
        const form = input.closest("form");
        if (form.id === "login-panel") validateLogin();
        else validateRegister();
      }
    });
  });

  if (new URLSearchParams(window.location.search).get("logout") === "server-error") {
    setFormMessage(
      loginForm,
      "A sessão local foi encerrada, mas o servidor não confirmou o logout. Tente novamente ou feche todas as sessões ativas.",
      "error"
    );
  }

  // Mantém a submissão pelo teclado e o fluxo de abas sem armazenar credenciais.
})();
