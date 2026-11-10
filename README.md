# KanbanFlow

Interface front-end de autenticação e quadro Kanban feita com HTML, CSS e JavaScript puro. Não há backend incluído.

## Arquivos

- `index.html`, `style.css` e `script.js`: login e cadastro.
- `board.html`, `board.css` e `board.js`: quadro e botão para sair.

Os arquivos da interface usam caminhos relativos, então podem ser publicados na raiz de um site ou em uma pasta de projeto.

## Executar localmente

1. Abra a pasta do projeto no VS Code.
2. Inicie um servidor estático local, por exemplo com a extensão Live Server.
3. Acesse a URL fornecida pelo servidor.
4. Configure uma API que atenda aos endpoints descritos abaixo; sem ela, login e cadastro mostrarão uma mensagem de conexão.

Evite abrir as páginas diretamente como `file://`: chamadas `fetch` e cookies de sessão devem ser testados por HTTP(S).

## Contrato esperado da API

- `POST /api/login`, JSON `{ "identifier": "email ou usuário", "password": "..." }`.
- `POST /api/register`, JSON `{ "name": "...", "email": "...", "password": "..." }`.
- `POST /api/logout` para invalidar a sessão no servidor.

Respostas de falha devem usar status HTTP apropriados (por exemplo, `401` para acesso inválido) e, opcionalmente, JSON `{ "message": "..." }`. Em login bem-sucedido, a API deve criar uma sessão e retornar `2xx`; a interface então abre `board.html`.

Para produção, publique o front-end e a API sob a mesma origem HTTPS. A API deve guardar a sessão em cookie `HttpOnly`, `Secure` e `SameSite` apropriado, limpar/inutilizar esse cookie em `/api/logout` e armazenar senhas apenas com hash forte (por exemplo, Argon2id ou bcrypt). O JavaScript não grava senha nem token de sessão no `localStorage` ou `sessionStorage`. O backend também deve proteger `board.html` e suas APIs: uma página estática não consegue impor autenticação por conta própria.

O botão de sair chama a API, limpa o `sessionStorage` local e retorna ao login mesmo quando a API está indisponível; se o servidor não confirmar o logout, a tela informa esse resultado. O quadro continua usando `localStorage` para tarefas, preservando o comportamento já existente.

## Publicar

### GitHub Pages

1. Envie os arquivos do projeto para um repositório GitHub.
2. Em **Settings → Pages**, selecione a branch e a pasta publicadas.
3. Acesse a URL indicada pelo GitHub.
4. GitHub Pages publica arquivos estáticos e não executa `/api/login`, `/api/register` ou `/api/logout`; configure a API em outro serviço e encaminhe os endpoints para ela antes de habilitar o login em produção.

### Netlify

1. Importe o repositório no Netlify.
2. Para este site estático, deixe o diretório de publicação como a raiz do projeto e não configure comando de build.
3. Publique o site.
4. Hospede a API separadamente ou configure funções e roteamento/proxy para os endpoints `/api/*`; mantenha a API na mesma origem HTTPS do site.

### Vercel

1. Importe o repositório no Vercel.
2. Escolha **Other** como framework e mantenha a raiz do projeto como diretório.
3. Publique o site estático.
4. Hospede a API separadamente ou configure funções e roteamento para `/api/*`, preservando cookies de sessão e HTTPS.

Não publique credenciais de teste, segredos da API ou dados pessoais no repositório.
