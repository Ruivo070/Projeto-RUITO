"""Backend Flask do KanbanFlow: autenticação, sessões e arquivos estáticos."""

import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory, session
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = Path(__file__).resolve().parent
# Carrega configurações locais sem sobrescrever variáveis fornecidas pelo ambiente.
load_dotenv(BASE_DIR / ".env")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DATABASE_IS_POSTGRES = bool(DATABASE_URL)
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "users.db")).resolve()
APP_ENV = os.environ.get("APP_ENV", "development").lower()
FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}

if DATABASE_IS_POSTGRES:
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
    elif DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        URL.create("sqlite", database=str(DATABASE_PATH)),
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

app = Flask(__name__, static_folder=None)
secret_key = os.environ.get("SECRET_KEY")
if not secret_key and APP_ENV == "production":
    raise RuntimeError("Defina SECRET_KEY como uma variável de ambiente em produção.")

app.config.update(
    SECRET_KEY=secret_key or "kanbanflow-dev-only-change-this-secret",
    DEBUG=FLASK_DEBUG and APP_ENV != "production",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=APP_ENV == "production",
    MAX_CONTENT_LENGTH=16 * 1024,
)

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,20}$")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class DatabaseResult:
    """Adapta resultados SQLAlchemy ao acesso por nome usado pela aplicação."""

    def __init__(self, result):
        self.result = result

    def fetchone(self):
        return self.result.mappings().fetchone()

    def fetchall(self):
        return self.result.mappings().fetchall()

    @property
    def lastrowid(self):
        return self.result.lastrowid


class DatabaseConnection:
    """Mantém as consultas parametrizadas compatíveis com SQLite e PostgreSQL."""

    def __init__(self, connection):
        self.connection = connection

    def execute(self, query, parameters=()):
        parts = query.split("?")
        if len(parts) - 1 != len(parameters):
            raise ValueError("A quantidade de parâmetros não corresponde à consulta.")
        values = {}
        statement = parts[0]
        for index, value in enumerate(parameters):
            key = f"param_{index}"
            statement += f":{key}{parts[index + 1]}"
            values[key] = value
        result = self.connection.execute(text(statement), values)
        return DatabaseResult(result)


@contextmanager
def database():
    """Garante uma transação por requisição usando SQLAlchemy."""
    with engine.begin() as connection:
        yield DatabaseConnection(connection)


def insert_id(connection, query, parameters):
    """Insere uma linha e retorna a chave gerada nos dois dialetos."""
    if DATABASE_IS_POSTGRES:
        inserted = connection.execute(f"{query} RETURNING id", parameters).fetchone()
        return inserted["id"]
    return connection.execute(query, parameters).lastrowid


def initialize_database():
    """Cria as tabelas da aplicação sem substituir os dados existentes."""
    integer_primary_key = "SERIAL PRIMARY KEY" if DATABASE_IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with database() as connection:
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS users (
                id {integer_primary_key},
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
        )
        statements = [
            f"""
            CREATE TABLE IF NOT EXISTS boards (
                id {integer_primary_key},
                name TEXT NOT NULL,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS board_members (
                board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
                UNIQUE (board_id, user_id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS tasks (
                id {integer_primary_key},
                board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
                assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                due_date TEXT,
                priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
                labels TEXT NOT NULL DEFAULT '',
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS comments (
                id {integer_primary_key},
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                author_id INTEGER NOT NULL REFERENCES users(id),
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS checklist_items (
                id {integer_primary_key},
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
            );
            """,
        ]
        for statement in statements:
            connection.execute(statement)


def json_error(message, status):
    """Padroniza os erros das rotas JSON."""
    return jsonify({"message": message}), status


def get_json_object():
    """Lê um corpo JSON e exige que a raiz seja um objeto."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None
    return data


def get_board_role(connection, board_id, user_id):
    """Retorna o papel do usuário no quadro ou None se não for membro."""
    membership = connection.execute(
        "SELECT role FROM board_members WHERE board_id = ? AND user_id = ?",
        (board_id, user_id),
    ).fetchone()
    return membership["role"] if membership else None


def authenticated_user_id():
    user_id = session.get("user_id")
    if not user_id:
        return None

    with database() as connection:
        user = connection.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        session.clear()
        return None
    return user["id"]


def permission_denied():
    return json_error("Você não tem permissão para editar este quadro.", 403)


def task_json(task):
    return {key: task[key] for key in task.keys()}


def validate_task_data(data, board_id, connection, creating=False):
    allowed_fields = {
        "title", "description", "status", "assignee_id",
        "due_date", "priority", "labels",
    }
    if set(data) - allowed_fields:
        return None, ("O pedido contém campos não reconhecidos.", 400)
    if creating and "title" not in data:
        return None, ("Informe o título da tarefa.", 400)

    fields = {}
    if "title" in data:
        title = data["title"]
        if not isinstance(title, str) or not title.strip():
            return None, ("Informe o título da tarefa.", 400)
        if len(title.strip()) > 100:
            return None, ("O título deve ter no máximo 100 caracteres.", 400)
        fields["title"] = title.strip()

    if "description" in data:
        description = data["description"]
        if not isinstance(description, str):
            return None, ("A descrição deve ser texto.", 400)
        if len(description) > 500:
            return None, ("A descrição deve ter no máximo 500 caracteres.", 400)
        fields["description"] = description

    if "status" in data:
        if data["status"] not in ("todo", "doing", "done"):
            return None, ("Status inválido.", 400)
        fields["status"] = data["status"]

    if "priority" in data:
        if data["priority"] not in ("low", "medium", "high"):
            return None, ("Prioridade inválida.", 400)
        fields["priority"] = data["priority"]

    if "labels" in data:
        labels = data["labels"]
        if not isinstance(labels, str) or len(labels) > 500:
            return None, ("Os rótulos devem ser texto com no máximo 500 caracteres.", 400)
        fields["labels"] = labels

    if "due_date" in data:
        due_date = data["due_date"]
        if due_date is not None and due_date != "":
            if not isinstance(due_date, str):
                return None, ("Informe um prazo válido.", 400)
            try:
                datetime.strptime(due_date, "%Y-%m-%d")
            except ValueError:
                return None, ("Informe um prazo válido.", 400)
            fields["due_date"] = due_date
        else:
            fields["due_date"] = None

    if "assignee_id" in data:
        assignee_id = data["assignee_id"]
        if assignee_id is not None and (isinstance(assignee_id, bool) or not isinstance(assignee_id, int)):
            return None, ("Responsável inválido.", 400)
        if assignee_id is not None and get_board_role(connection, board_id, assignee_id) is None:
            return None, ("O responsável deve ser membro deste quadro.", 400)
        fields["assignee_id"] = assignee_id

    return fields, None


@app.get("/")
def home():
    """Serve a tela de login na raiz do mesmo host da API."""
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/board.html")
def board():
    """Impede que visitantes sem sessão carreguem o quadro."""
    if not session.get("user_id"):
        return redirect("/")
    return send_from_directory(BASE_DIR, "board.html")


@app.get("/tasks/<int:task_id>")
def task_page(task_id):
    """Serve a tarefa a usuários autenticados e mostra acesso negado a não membros."""
    user_id = authenticated_user_id()
    if user_id is None:
        return redirect("/")

    with database() as connection:
        task = connection.execute(
            "SELECT board_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            return "Tarefa não encontrada.", 404
        if get_board_role(connection, task["board_id"], user_id) is None:
            return send_from_directory(BASE_DIR, "task.html"), 403
    return send_from_directory(BASE_DIR, "task.html")


@app.get("/boards.html")
def boards_page():
    """Serve a lista de quadros somente para uma sessão autenticada."""
    if not session.get("user_id"):
        return redirect("/")
    return send_from_directory(BASE_DIR, "boards.html")


@app.post("/api/register")
def register():
    data = get_json_object()
    if data is None:
        return json_error("Envie os dados de cadastro em formato JSON.", 400)

    name = data.get("name")
    username = data.get("username")
    email = data.get("email")
    password = data.get("password")

    if not isinstance(name, str) or not name.strip():
        return json_error("Informe seu nome.", 400)
    name = name.strip()
    if len(name) > 100:
        return json_error("O nome deve ter no máximo 100 caracteres.", 400)

    if not isinstance(username, str) or not USERNAME_PATTERN.fullmatch(username.strip()):
        return json_error("O nome de usuário deve ter de 3 a 20 caracteres: letras, números ou _.", 400)
    username = username.strip().lower()

    if not isinstance(email, str) or not EMAIL_PATTERN.fullmatch(email.strip()):
        return json_error("Informe um e-mail válido.", 400)
    email = email.strip().lower()
    if len(email) > 254:
        return json_error("O e-mail deve ter no máximo 254 caracteres.", 400)

    if not isinstance(password, str) or len(password) < 8:
        return json_error("A senha deve ter pelo menos 8 caracteres.", 400)

    try:
        with database() as connection:
            existing = connection.execute(
                "SELECT 1 FROM users WHERE email = ? OR username = ? LIMIT 1",
                (email, username),
            ).fetchone()
            if existing:
                return json_error("Este e-mail ou nome de usuário já está cadastrado.", 409)

            connection.execute(
                """
                INSERT INTO users (name, username, email, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    name,
                    username,
                    email,
                    generate_password_hash(password),
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                ),
            )
    except IntegrityError:
        # A restrição UNIQUE também protege contra cadastros simultâneos.
        return json_error("Este e-mail ou nome de usuário já está cadastrado.", 409)

    return jsonify({"message": "Conta criada com sucesso! Agora você já pode entrar."}), 201


@app.post("/api/login")
def login():
    data = get_json_object()
    if data is None:
        return json_error("Envie as credenciais em formato JSON.", 400)

    identifier = data.get("identifier")
    password = data.get("password")
    if not isinstance(identifier, str) or not identifier.strip():
        return json_error("Informe seu e-mail ou usuário.", 400)
    if not isinstance(password, str) or not password:
        return json_error("Informe sua senha.", 400)

    identifier = identifier.strip().lower()
    with database() as connection:
        user = connection.execute(
            "SELECT id, email, username, password_hash FROM users WHERE email = ? OR username = ? LIMIT 1",
            (identifier, identifier),
        ).fetchone()

    if user is None or not check_password_hash(user["password_hash"], password):
        return json_error("E-mail, usuário ou senha incorretos.", 401)

    # Descarta qualquer dado anterior antes de estabelecer a sessão autenticada.
    session.clear()
    session["user_id"] = user["id"]
    return jsonify({"message": "Login realizado com sucesso."}), 200


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"message": "Sessão encerrada."}), 200


@app.get("/api/me")
def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return json_error("Autenticação necessária.", 401)

    with database() as connection:
        user = connection.execute(
            "SELECT name, username FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if user is None:
        session.clear()
        return json_error("Autenticação necessária.", 401)
    return jsonify({"name": user["name"], "username": user["username"]}), 200


@app.get("/api/boards")
def list_boards():
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)

    owned = []
    shared = []
    with database() as connection:
        memberships = connection.execute(
            """
            SELECT b.id, b.name, b.owner_id, owner.name AS owner_name
            FROM board_members AS bm
            JOIN boards AS b ON b.id = bm.board_id
            JOIN users AS owner ON owner.id = b.owner_id
            WHERE bm.user_id = ?
            ORDER BY b.created_at DESC, b.id DESC
            """,
            (user_id,),
        ).fetchall()
        for board_row in memberships:
            role = get_board_role(connection, board_row["id"], user_id)
            item = {
                "id": board_row["id"],
                "name": board_row["name"],
                "role": role,
                "owner": {
                    "id": board_row["owner_id"],
                    "name": board_row["owner_name"],
                },
            }
            (owned if role == "OWNER" else shared).append(item)

    return jsonify({"owned": owned, "shared": shared}), 200


@app.post("/api/boards")
def create_board():
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None:
        return json_error("Envie os dados do quadro em formato JSON.", 400)
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        return json_error("Informe o nome do quadro.", 400)
    name = name.strip()
    if len(name) > 100:
        return json_error("O nome do quadro deve ter no máximo 100 caracteres.", 400)

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with database() as connection:
        board_id = insert_id(
            connection,
            "INSERT INTO boards (name, owner_id, created_at) VALUES (?, ?, ?)",
            (name, user_id, created_at),
        )
        connection.execute(
            "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'OWNER')",
            (board_id, user_id),
        )
    return jsonify({
        "id": board_id,
        "name": name,
        "role": "OWNER",
        "owner": {"id": user_id},
        "created_at": created_at,
    }), 201


@app.delete("/api/boards/<int:board_id>")
def delete_board(board_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    with database() as connection:
        role = get_board_role(connection, board_id, user_id)
        if role is None:
            return json_error("Quadro não encontrado.", 404)
        if role != "OWNER":
            return permission_denied()
        connection.execute("DELETE FROM boards WHERE id = ?", (board_id,))
    return jsonify({"message": "Quadro excluído."}), 200


@app.get("/api/boards/<int:board_id>")
def get_board(board_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    with database() as connection:
        role = get_board_role(connection, board_id, user_id)
        if role is None:
            return json_error("Quadro não encontrado.", 404)

        board_row = connection.execute(
            """
            SELECT b.id, b.name, b.owner_id, owner.name AS owner_name
            FROM boards AS b
            JOIN users AS owner ON owner.id = b.owner_id
            WHERE b.id = ?
            """,
            (board_id,),
        ).fetchone()
        tasks = connection.execute(
            """
            SELECT t.*, assignee.name AS assignee_name,
                   (SELECT COUNT(*) FROM checklist_items AS ci WHERE ci.task_id = t.id) AS checklist_total,
                   (SELECT COUNT(*) FROM checklist_items AS ci WHERE ci.task_id = t.id AND ci.done = 1) AS checklist_done
            FROM tasks AS t
            LEFT JOIN users AS assignee ON assignee.id = t.assignee_id
            WHERE t.board_id = ?
            ORDER BY t.created_at, t.id
            """,
            (board_id,),
        ).fetchall()
        members = connection.execute(
            """
            SELECT u.id, u.name, u.email, bm.role
            FROM board_members AS bm
            JOIN users AS u ON u.id = bm.user_id
            WHERE bm.board_id = ?
            ORDER BY CASE bm.role WHEN 'OWNER' THEN 0 WHEN 'EDITOR' THEN 1 ELSE 2 END, u.name
            """,
            (board_id,),
        ).fetchall()

    return jsonify({
        "id": board_row["id"],
        "name": board_row["name"],
        "owner": {"id": board_row["owner_id"], "name": board_row["owner_name"]},
        "role": role,
        "tasks": [task_json(task) for task in tasks],
        "members": [{key: member[key] for key in member.keys()} for member in members],
    }), 200


@app.post("/api/boards/<int:board_id>/members")
def invite_board_member(board_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None:
        return json_error("Envie os dados do convite em formato JSON.", 400)
    email = data.get("email")
    role_value = data.get("role")
    if not isinstance(email, str) or not EMAIL_PATTERN.fullmatch(email.strip()):
        return json_error("Informe um e-mail válido.", 400)
    email = email.strip().lower()
    if role_value not in ("EDITOR", "VIEWER"):
        return json_error("O papel deve ser EDITOR ou VIEWER.", 400)

    with database() as connection:
        role = get_board_role(connection, board_id, user_id)
        if role is None:
            return json_error("Quadro não encontrado.", 404)
        if role != "OWNER":
            return permission_denied()
        invited_user = connection.execute(
            "SELECT id, name, email FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if invited_user is None:
            return json_error("Não existe uma conta cadastrada com esse e-mail.", 404)
        if get_board_role(connection, board_id, invited_user["id"]) is not None:
            return json_error("Este usuário já é membro do quadro.", 409)
        connection.execute(
            "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)",
            (board_id, invited_user["id"], role_value),
        )

    return jsonify({
        "id": invited_user["id"],
        "name": invited_user["name"],
        "email": invited_user["email"],
        "role": role_value,
    }), 201


@app.patch("/api/boards/<int:board_id>/members/<int:member_user_id>")
def update_board_member(board_id, member_user_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None:
        return json_error("Envie o papel em formato JSON.", 400)
    new_role = data.get("role")
    if new_role not in ("OWNER", "EDITOR", "VIEWER"):
        return json_error("Papel inválido. Use OWNER, EDITOR ou VIEWER.", 400)

    with database() as connection:
        role = get_board_role(connection, board_id, user_id)
        if role is None:
            return json_error("Quadro não encontrado.", 404)
        if role != "OWNER":
            return permission_denied()
        target_role = get_board_role(connection, board_id, member_user_id)
        if target_role is None:
            return json_error("Membro não encontrado.", 404)
        board_row = connection.execute(
            "SELECT owner_id FROM boards WHERE id = ?", (board_id,)
        ).fetchone()
        if member_user_id == board_row["owner_id"] and new_role != "OWNER":
            return json_error("Transfira a propriedade antes de alterar o papel do dono.", 400)

        if new_role == "OWNER":
            connection.execute(
                "UPDATE board_members SET role = 'EDITOR' WHERE board_id = ? AND user_id = ?",
                (board_id, board_row["owner_id"]),
            )
            connection.execute(
                "UPDATE boards SET owner_id = ? WHERE id = ?",
                (member_user_id, board_id),
            )
        connection.execute(
            "UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?",
            (new_role, board_id, member_user_id),
        )

    return jsonify({"message": "Papel do membro atualizado.", "role": new_role}), 200


@app.delete("/api/boards/<int:board_id>/members/<int:member_user_id>")
def remove_board_member(board_id, member_user_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    with database() as connection:
        role = get_board_role(connection, board_id, user_id)
        if role is None:
            return json_error("Quadro não encontrado.", 404)
        if role != "OWNER":
            return permission_denied()
        board_row = connection.execute(
            "SELECT owner_id FROM boards WHERE id = ?", (board_id,)
        ).fetchone()
        if get_board_role(connection, board_id, member_user_id) is None:
            return json_error("Membro não encontrado.", 404)
        if member_user_id == board_row["owner_id"]:
            return json_error("O dono do quadro não pode remover o próprio acesso.", 400)
        connection.execute(
            "DELETE FROM board_members WHERE board_id = ? AND user_id = ?",
            (board_id, member_user_id),
        )
    return jsonify({"message": "Acesso removido."}), 200


@app.post("/api/boards/<int:board_id>/tasks")
def create_task(board_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None:
        return json_error("Envie os dados da tarefa em formato JSON.", 400)
    with database() as connection:
        role = get_board_role(connection, board_id, user_id)
        if role is None:
            return json_error("Quadro não encontrado.", 404)
        if role == "VIEWER":
            return permission_denied()
        fields, error = validate_task_data(data, board_id, connection, creating=True)
        if error:
            return json_error(*error)

        fields.setdefault("description", "")
        fields.setdefault("status", "todo")
        fields.setdefault("assignee_id", None)
        fields.setdefault("due_date", None)
        fields.setdefault("priority", "medium")
        fields.setdefault("labels", "")
        fields["board_id"] = board_id
        fields["created_by"] = user_id
        fields["created_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        columns = ", ".join(fields)
        placeholders = ", ".join("?" for _ in fields)
        task_id = insert_id(
            connection,
            f"INSERT INTO tasks ({columns}) VALUES ({placeholders})",
            tuple(fields.values()),
        )
        task = connection.execute(
            """
            SELECT t.*, assignee.name AS assignee_name
            FROM tasks AS t
            LEFT JOIN users AS assignee ON assignee.id = t.assignee_id
            WHERE t.id = ?
            """,
            (task_id,),
        ).fetchone()
    return jsonify(task_json(task)), 201


@app.patch("/api/tasks/<int:task_id>")
def update_task(task_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None:
        return json_error("Envie as alterações em formato JSON.", 400)
    with database() as connection:
        task = connection.execute(
            "SELECT id, board_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            return json_error("Tarefa não encontrada.", 404)
        role = get_board_role(connection, task["board_id"], user_id)
        if role is None:
            return json_error("Tarefa não encontrada.", 404)
        if role == "VIEWER":
            return permission_denied()
        fields, error = validate_task_data(data, task["board_id"], connection)
        if error:
            return json_error(*error)
        if not fields:
            return json_error("Informe ao menos um campo para atualizar.", 400)
        assignments = ", ".join(f"{column} = ?" for column in fields)
        connection.execute(
            f"UPDATE tasks SET {assignments} WHERE id = ?",
            (*fields.values(), task_id),
        )
        updated_task = connection.execute(
            """
            SELECT t.*, assignee.name AS assignee_name
            FROM tasks AS t
            LEFT JOIN users AS assignee ON assignee.id = t.assignee_id
            WHERE t.id = ?
            """,
            (task_id,),
        ).fetchone()
    return jsonify(task_json(updated_task)), 200


@app.delete("/api/tasks/<int:task_id>")
def delete_task(task_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    with database() as connection:
        task = connection.execute(
            "SELECT id, board_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            return json_error("Tarefa não encontrada.", 404)
        role = get_board_role(connection, task["board_id"], user_id)
        if role is None:
            return json_error("Tarefa não encontrada.", 404)
        if role != "OWNER":
            return permission_denied()
        connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return jsonify({"message": "Tarefa excluída."}), 200


@app.get("/api/tasks/<int:task_id>")
def get_task(task_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    with database() as connection:
        task = connection.execute(
            """
            SELECT t.*, assignee.name AS assignee_name, b.name AS board_name
            FROM tasks AS t
            JOIN boards AS b ON b.id = t.board_id
            LEFT JOIN users AS assignee ON assignee.id = t.assignee_id
            WHERE t.id = ?
            """,
            (task_id,),
        ).fetchone()
        if task is None or get_board_role(connection, task["board_id"], user_id) is None:
            return json_error("Tarefa não encontrada.", 404)

        comments = connection.execute(
            """
            SELECT c.id, c.author_id, u.name AS author_name, c.text, c.created_at
            FROM comments AS c
            JOIN users AS u ON u.id = c.author_id
            WHERE c.task_id = ?
            ORDER BY c.created_at, c.id
            """,
            (task_id,),
        ).fetchall()
        checklist = connection.execute(
            "SELECT id, text, done FROM checklist_items WHERE task_id = ? ORDER BY id",
            (task_id,),
        ).fetchall()
        members = connection.execute(
            """
            SELECT u.id, u.name, u.email, bm.role
            FROM board_members AS bm
            JOIN users AS u ON u.id = bm.user_id
            WHERE bm.board_id = ?
            ORDER BY u.name
            """,
            (task["board_id"],),
        ).fetchall()
        role = get_board_role(connection, task["board_id"], user_id)

    response = task_json(task)
    response["role"] = role
    response["members"] = [{key: member[key] for key in member.keys()} for member in members]
    response["comments"] = [{key: comment[key] for key in comment.keys()} for comment in comments]
    response["checklist"] = [{key: item[key] for key in item.keys()} for item in checklist]
    return jsonify(response), 200


@app.post("/api/tasks/<int:task_id>/comments")
def create_comment(task_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None or set(data) != {"text"}:
        return json_error("Envie o texto do comentário em formato JSON.", 400)
    text = data["text"]
    if not isinstance(text, str) or not text.strip():
        return json_error("O comentário não pode ficar vazio.", 400)
    text = text.strip()
    if len(text) > 1000:
        return json_error("O comentário deve ter no máximo 1000 caracteres.", 400)

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with database() as connection:
        task = connection.execute(
            "SELECT board_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            return json_error("Tarefa não encontrada.", 404)
        role = get_board_role(connection, task["board_id"], user_id)
        if role is None:
            return json_error("Tarefa não encontrada.", 404)
        if role == "VIEWER":
            return permission_denied()
        comment_id = insert_id(
            connection,
            """
            INSERT INTO comments (task_id, author_id, text, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (task_id, user_id, text, created_at),
        )
        author = connection.execute(
            "SELECT name FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return jsonify({
        "id": comment_id,
        "author_id": user_id,
        "author_name": author["name"],
        "text": text,
        "created_at": created_at,
    }), 201


@app.post("/api/tasks/<int:task_id>/checklist")
def create_checklist_item(task_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None or set(data) != {"text"}:
        return json_error("Envie o texto da subtarefa em formato JSON.", 400)
    text = data["text"]
    if not isinstance(text, str) or not text.strip():
        return json_error("Informe o texto da subtarefa.", 400)
    text = text.strip()
    if len(text) > 200:
        return json_error("A subtarefa deve ter no máximo 200 caracteres.", 400)

    with database() as connection:
        task = connection.execute(
            "SELECT board_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if task is None:
            return json_error("Tarefa não encontrada.", 404)
        role = get_board_role(connection, task["board_id"], user_id)
        if role is None:
            return json_error("Tarefa não encontrada.", 404)
        if role == "VIEWER":
            return permission_denied()
        item_id = insert_id(
            connection,
            "INSERT INTO checklist_items (task_id, text, done) VALUES (?, ?, 0)",
            (task_id, text),
        )
    return jsonify({"id": item_id, "task_id": task_id, "text": text, "done": 0}), 201


@app.patch("/api/checklist-items/<int:item_id>")
def update_checklist_item(item_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    data = get_json_object()
    if data is None or not data or set(data) - {"text", "done"}:
        return json_error("Informe o texto ou estado da subtarefa.", 400)
    fields = {}
    if "text" in data:
        text = data["text"]
        if not isinstance(text, str) or not text.strip():
            return json_error("Informe o texto da subtarefa.", 400)
        if len(text.strip()) > 200:
            return json_error("A subtarefa deve ter no máximo 200 caracteres.", 400)
        fields["text"] = text.strip()
    if "done" in data:
        if not isinstance(data["done"], bool):
            return json_error("O estado da subtarefa deve ser verdadeiro ou falso.", 400)
        fields["done"] = int(data["done"])

    with database() as connection:
        item = connection.execute(
            """
            SELECT ci.id, ci.task_id, t.board_id
            FROM checklist_items AS ci
            JOIN tasks AS t ON t.id = ci.task_id
            WHERE ci.id = ?
            """,
            (item_id,),
        ).fetchone()
        if item is None:
            return json_error("Subtarefa não encontrada.", 404)
        role = get_board_role(connection, item["board_id"], user_id)
        if role is None:
            return json_error("Subtarefa não encontrada.", 404)
        if role == "VIEWER":
            return permission_denied()
        assignments = ", ".join(f"{key} = ?" for key in fields)
        connection.execute(
            f"UPDATE checklist_items SET {assignments} WHERE id = ?",
            (*fields.values(), item_id),
        )
        updated = connection.execute(
            "SELECT id, task_id, text, done FROM checklist_items WHERE id = ?",
            (item_id,),
        ).fetchone()
    return jsonify({key: updated[key] for key in updated.keys()}), 200


@app.delete("/api/checklist-items/<int:item_id>")
def delete_checklist_item(item_id):
    user_id = authenticated_user_id()
    if user_id is None:
        return json_error("Autenticação necessária.", 401)
    with database() as connection:
        item = connection.execute(
            """
            SELECT ci.id, t.board_id
            FROM checklist_items AS ci
            JOIN tasks AS t ON t.id = ci.task_id
            WHERE ci.id = ?
            """,
            (item_id,),
        ).fetchone()
        if item is None:
            return json_error("Subtarefa não encontrada.", 404)
        role = get_board_role(connection, item["board_id"], user_id)
        if role is None:
            return json_error("Subtarefa não encontrada.", 404)
        if role == "VIEWER":
            return permission_denied()
        connection.execute("DELETE FROM checklist_items WHERE id = ?", (item_id,))
    return jsonify({"message": "Subtarefa excluída."}), 200


@app.get("/<path:filename>")
def static_files(filename):
    """Serve apenas recursos do projeto e nunca expõe código, banco ou arquivos ocultos."""
    path = Path(filename)
    blocked_suffixes = {".py", ".db", ".sqlite", ".sqlite3"}
    if path.is_absolute() or any(part.startswith(".") for part in path.parts):
        return "Not Found", 404
    if any(Path(part).suffix.lower() in blocked_suffixes for part in path.parts):
        return "Not Found", 404

    try:
        return send_from_directory(BASE_DIR, filename)
    except (OSError, ValueError):
        return "Not Found", 404


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return json_error("Rota não encontrada.", 404)
    return "Not Found", 404


@app.errorhandler(405)
def method_not_allowed(_error):
    if request.path.startswith("/api/"):
        return json_error("Método não permitido.", 405)
    return "Method Not Allowed", 405


initialize_database()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1" if APP_ENV == "development" else "0.0.0.0",
        port=int(os.environ.get("PORT", "5000")),
        debug=app.config["DEBUG"],
    )
