# Calendário de Conteúdo — versão Cloudflare (gratuita)

Seu calendário de posts com **usuário e senha próprios**, acessível de qualquer navegador.
- Página e login: Cloudflare Workers (grátis)
- Posts: banco de dados D1 (grátis)
- Imagens e vídeos: R2 (grátis até 10 GB, até ~95 MB por arquivo)

---

## Passo a passo (cerca de 20 minutos, sem precisar de terminal)

### 1. Criar a conta na Cloudflare
Acesse **dash.cloudflare.com** e crie uma conta gratuita (confirme o e-mail).

### 2. Criar o banco de dados (D1)
1. No menu lateral: **Storage & Databases → D1 SQL Database → Create**.
2. Nome: `calendário-db` → **Create**.
3. Na página do banco, copie o **Database ID** (um código tipo `a1b2c3d4-...`). Guarde, vai usar no passo 4.

### 3. Criar o armazenamento de mídias (R2)
1. Menu lateral: **R2 Object Storage → Create bucket**.
2. Nome: `calendario-midias` → **Create bucket**.

> Na primeira vez, a Cloudflare pode pedir um cartão só para verificação. Dentro do limite gratuito (10 GB) não há cobrança.

### 4. Colocar o projeto no GitHub
1. No GitHub, crie um repositório novo chamado `calendario-conteudo` (pode ser **Private**).
2. Clique em **uploading an existing file** e arraste **todo o conteúdo** desta pasta (as pastas `public` e `src` e os arquivos soltos) → **Commit changes**.
3. Abra o arquivo `wrangler.jsonc` no GitHub, clique no lápis (editar) e troque `COLE-AQUI-O-ID-DO-BANCO` pelo **Database ID** do passo 2 → **Commit changes**.

### 5. Publicar na Cloudflare
1. Menu lateral: **Workers & Pages → Create → Import a repository**.
2. Conecte sua conta do GitHub e escolha o repositório `calendario-conteudo`.
3. Deixe o comando de deploy como `npx wrangler deploy` → **Deploy**.
4. Aguarde terminar (1–2 minutos).

### 6. Definir seu usuário e senha
1. Abra o Worker `calendario-conteudo` → **Settings → Variables and Secrets → Add**.
2. Adicione 3 itens, todos do tipo **Secret**:

| Nome | Valor |
|---|---|
| `USUARIO` | o usuário que você quer usar para entrar |
| `SENHA` | sua senha (use uma senha forte) |
| `SESSION_SECRET` | uma frase longa e aleatória qualquer (ex.: `banana-azul-cozinha-inox-9182-solo`) — não precisa decorar |

3. Clique em **Deploy** / **Save**.

> Use sempre o tipo **Secret** (e não "Text"), senão eles podem ser apagados na próxima atualização.

### 7. Trazer o post que já estava no Claude
1. Vá em **D1 → calendario-db → Console**.
2. Abra o arquivo `importar-posts.sql`, copie tudo, cole no console e clique em **Execute**.
3. A imagem do post "Semana Black Solo" precisa ser enviada de novo pela ficha do post.

### 8. Pronto! 🎉
Seu endereço fica em **Settings → Domains & Routes**, algo como:
`https://calendario-conteudo.SEU-NOME.workers.dev`

Abra em qualquer navegador, entre com seu usuário e senha. O login fica salvo por 30 dias em cada aparelho. Para sair, clique em **Sair** no topo.

---

## Dúvidas comuns
- **Mudar a senha:** Settings → Variables and Secrets → edite `SENHA`.
- **Deslogar todos os aparelhos:** troque o `SESSION_SECRET`.
- **Atualizar o calendário no futuro:** qualquer alteração enviada ao GitHub é publicada sozinha.
- **Mensagem "Configuração incompleta":** faltou cadastrar algum dos 3 secrets do passo 6.
- **Vídeos acima de 95 MB:** suba no Drive ou YouTube e cole o link no campo **Link** do post.
