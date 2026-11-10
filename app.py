"""Backend Flask do KanbanFlow: autenticação, sessões e arquivos estáticos."""

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "users.db")).resolve()
APP_ENV = os.environ.get("APP_ENV", "development").lower()

app = Flask(__name__, static_folder=None)
secret_key = os.environ.get("SECRET_KEY")
if not secret_key and APP_ENV == "production":
    raise RuntimeError("Defina SECRET_KEY como uma variável de ambiente em produção.")

app.config.update(
    SECRET_KEY=secret_key or "kanbanflow-dev-only-change-this-secret",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=APP_ENV == "production",
    MAX_CONTENT_LENGTH=16 * 1024,
)

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,20}$")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def connect_db():
    """Abre uma conexão SQLite com suporte a linhas por nome de coluna."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def database():
    """Garante que cada conexão seja fechada após a transação."""
    connection = connect_db()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    """Cria o banco e a tabela de usuários quando ainda não existem."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def json_error(message, status):
    """Padroniza os erros das rotas JSON."""
    return jsonify({"message": message}), status


def get_json_object():
    """Lê um corpo JSON e exige que a raiz seja um objeto."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None
    return data


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
    except sqlite3.IntegrityError:
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
        debug=APP_ENV == "development",
    )
