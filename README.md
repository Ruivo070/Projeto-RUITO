# KanbanFlow

Aplicação de quadros Kanban compartilhados, com login e cadastro, interface HTML/CSS/JavaScript e API Flask. Quadros, tarefas, membros, comentários e checklists são persistidos no banco de dados.

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

Abra **http://127.0.0.1:5000**. Sem `DATABASE_URL`, o aplicativo usa SQLite no arquivo `users.db`; as tabelas são criadas automaticamente e dados existentes em `users` são mantidos. Para usar outro caminho local, configure `DATABASE_PATH`. O `.env` local é carregado sem substituir variáveis já configuradas no ambiente.

Se a política do PowerShell impedir a ativação do ambiente virtual, execute:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

O arquivo `.env` não deve ser compartilhado nem enviado ao Git. O `.env.example` contém apenas valores de exemplo.

## PostgreSQL no Render

1. No painel do Render, crie um banco **PostgreSQL** e aguarde ficar disponível.
2. Crie um **Web Service** conectado ao repositório do projeto, usando o ambiente Python.
3. Configure o comando de build:

   ```text
   pip install -r requirements.txt
   ```

4. No banco PostgreSQL do Render, copie a **Internal Database URL**. No Web Service, adicione a variável `DATABASE_URL` com esse endereço (ou vincule a variável correspondente oferecida pelo Render).
5. Configure as variáveis de ambiente do Web Service:

   ```text
   APP_ENV=production
   FLASK_DEBUG=false
   SECRET_KEY=<segredo aleatório longo>
   DATABASE_URL=<Internal Database URL do PostgreSQL>
   ```

   Gere o segredo fora do repositório, por exemplo com `python -c "import secrets; print(secrets.token_urlsafe(48))"`, e salve-o como variável secreta no Render. Não use o valor literal de exemplo.

6. Configure o comando de início:

   ```text
   gunicorn app:app
   ```

7. Faça o deploy e abra o endereço HTTPS do Web Service.

Quando `DATABASE_URL` está configurada, o app usa PostgreSQL com SQLAlchemy e psycopg2; sem ela, usa SQLite local. Em um PostgreSQL novo, o app cria as tabelas, mas não migra automaticamente usuários de um arquivo SQLite local. `SECRET_KEY` precisa permanecer estável entre deploys para preservar as sessões existentes. `APP_ENV=production` ativa cookies de sessão seguros; `FLASK_DEBUG=false` mantém o modo de depuração desativado em produção.

## Recursos e acesso

- Cadastro e autenticação por sessão Flask; senhas armazenadas como hash Werkzeug.
- Quadros e tarefas compartilhados com papéis de proprietário, editor e leitor, validados também nas rotas do backend.
- Comentários com autoria/data e checklist de subtarefas persistidos no banco.
- Páginas de tarefa em `/tasks/<id>`; o acesso exige sessão e participação no quadro.
- O frontend e a API devem ser servidos pelo mesmo host Flask para manter sessão e chamadas autenticadas.

## Segurança e operação

Nunca versione `.env`, chaves secretas, senhas ou arquivos de banco. O `.gitignore` exclui arquivos de ambiente, bancos SQLite, caches e backups. O Git não aplica regras retroativamente a arquivos que já foram enviados: se um segredo tiver sido publicado, remova-o do histórico e troque a credencial imediatamente.
