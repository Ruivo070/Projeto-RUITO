# KanbanFlow

Aplicação de quadro Kanban com telas de login/cadastro, API em Flask e banco local SQLite. O Flask serve HTML, CSS, JavaScript e API sob a mesma origem.

## Executar localmente

No PowerShell, na pasta do projeto:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -c "import secrets; from pathlib import Path; p=Path('.env'); s=p.read_text(encoding='utf-8'); p.write_text(s.replace('gere-uma-chave-aleatoria-antes-de-usar', secrets.token_urlsafe(48)), encoding='utf-8')"
python app.py
```

Abra **http://127.0.0.1:5000**. O banco `users.db` e a tabela `users` serão criados automaticamente no primeiro início. Para sair do ambiente virtual, execute `deactivate`.

O arquivo `.env` contém uma chave aleatória para desenvolvimento e está excluído do Git. Não o envie nem compartilhe. O `.env.example` é apenas um modelo, sem segredos.

Se a política do PowerShell impedir a ativação do ambiente, execute o Python e o pip diretamente:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

O Flask carrega `.env` localmente sem sobrescrever variáveis já configuradas no ambiente. Ele cria e usa cookies de sessão `HttpOnly` e `SameSite=Lax`. Em produção, configure `SECRET_KEY` como variável secreta no serviço de hospedagem e `APP_ENV=production` para exigir a chave e ativar o cookie `Secure`; não publique o `.env`.

## API

- `POST /api/register`: recebe `name`, `username`, `email` e `password`; grava a senha somente como hash Werkzeug.
- `POST /api/login`: recebe `identifier` (e-mail ou usuário) e `password`; inicia a sessão.
- `POST /api/logout`: encerra a sessão.
- `GET /api/me`: retorna o nome e o usuário autenticados.

O quadro é servido somente para uma sessão autenticada. As tarefas são mantidas no navegador em uma chave de `localStorage` separada para cada usuário; senhas e cookies de sessão não são gravados no armazenamento web.

## Publicar com HTTPS no Render

GitHub Pages e Netlify como hospedagem estática não executam o backend Flask. Para manter frontend, endpoints `/api/...`, sessões e páginas protegidas na mesma origem, publique o projeto completo em um serviço que execute Python, como o Render.

1. Envie o projeto para um repositório Git, sem incluir `.venv`, `.env` ou `users.db` (já ignorados pelo `.gitignore`).
2. No Render, crie um **Web Service** conectado ao repositório.
3. Use o ambiente **Python** e a pasta raiz do projeto.
4. Configure o comando de build como `pip install -r requirements.txt`.
5. Configure o comando de início como `gunicorn app:app`.
6. Configure `APP_ENV=production` e gere um valor longo e aleatório para `SECRET_KEY` nas variáveis de ambiente do serviço.
7. Publique e abra o endereço HTTPS fornecido pelo Render.

O Render fornece HTTPS para o serviço. Para persistir o banco SQLite após reinicializações e novas implantações, associe um disco persistente e configure `DATABASE_PATH` para um caminho dentro do disco. Sem disco persistente, o banco local pode ser substituído quando a instância for recriada.

Nunca compartilhe nem versione a chave secreta, senhas ou o banco de usuários. O `.gitignore` exclui `.env`, bancos SQLite, arquivos de ambiente, caches e arquivos compactados/backups. O Git não aplica regras retroativamente a arquivos que já estejam versionados: se algum segredo já foi enviado a um repositório, remova-o do histórico e troque a credencial imediatamente.
