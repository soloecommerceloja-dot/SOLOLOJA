// Calendário de Conteúdo — servidor (Cloudflare Worker)
// Login com usuário e senha, posts no banco D1, imagens e vídeos no R2.

const COOKIE = "cal_sess";
const SESSAO_DIAS = 30;
const MAX_UPLOAD = 95 * 1024 * 1024; // ~95 MB (limite do plano gratuito é 100 MB por envio)

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
// comparação em tempo constante
async function iguais(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function lerCookie(req, nome) {
  const c = req.headers.get("Cookie") || "";
  for (const p of c.split(/;\s*/)) { const i = p.indexOf("="); if (p.slice(0, i) === nome) return p.slice(i + 1); }
  return null;
}
async function criarSessao(env) {
  const exp = Date.now() + SESSAO_DIAS * 864e5;
  return exp + "." + (await hmac(env.SESSION_SECRET, String(exp)));
}
async function sessaoValida(req, env) {
  const v = lerCookie(req, COOKIE); if (!v) return false;
  const [exp, sig] = v.split("."); if (!exp || !sig || Number(exp) < Date.now()) return false;
  return iguais(sig, await hmac(env.SESSION_SECRET, exp));
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

let tabelaPronta = false;
async function garantirTabela(env) {
  if (tabelaPronta) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, data TEXT NOT NULL, atualizado INTEGER NOT NULL)").run();
  tabelaPronta = true;
}
const idsMidia = (p) => (Array.isArray(p?.midias) ? p.midias.map((m) => m && m.id).filter(Boolean) : []);
const idValido = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(s);

function paginaLogin(erro = "") {
  return new Response(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar · Calendário</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@800&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f3f2f5;font:16px/1.5 Inter,system-ui,sans-serif;padding:20px}
form{width:min(380px,100%);background:#121115;border:1px solid #2a2930;border-radius:18px;padding:32px 28px}
h1{font:800 30px/1.05 Archivo,sans-serif;margin:0 0 6px}p{margin:0 0 24px;color:#9e9ba6}
label{display:block;font-size:13px;font-weight:600;color:#9e9ba6;margin:14px 0 4px}
input{width:100%;height:48px;border-radius:10px;border:1px solid #2a2930;background:#18171c;color:inherit;padding:0 14px;font-size:16px}
input:focus{outline:3px solid #ffd23f;outline-offset:1px}
button{width:100%;height:48px;margin-top:22px;border:0;border-radius:24px;background:#e8432f;color:#fff;font-weight:600;font-size:16px;cursor:pointer}
.e{color:#ff6a55;font-size:14px;margin-top:14px;min-height:1em}</style></head><body>
<form method="post" action="/login"><h1>Calendário de conteúdo</h1><p>Entre para ver e editar seus posts.</p>
<label for="u">Usuário</label><input id="u" name="usuario" autocomplete="username" required autofocus>
<label for="s">Senha</label><input id="s" name="senha" type="password" autocomplete="current-password" required>
<button>Entrar</button><div class="e">${erro}</div></form></body></html>`, { status: erro ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!env.USUARIO || !env.SENHA || !env.SESSION_SECRET) {
      return new Response("Configuração incompleta: cadastre USUARIO, SENHA e SESSION_SECRET nas variáveis secretas do Worker.", { status: 500 });
    }

    // ---- login / logout ----
    if (path === "/login") {
      if (req.method === "POST") {
        const f = await req.formData();
        const okU = await iguais(String(f.get("usuario") || ""), env.USUARIO);
        const okS = await iguais(String(f.get("senha") || ""), env.SENHA);
        if (!(okU && okS)) { await new Promise((r) => setTimeout(r, 800)); return paginaLogin("Usuário ou senha incorretos."); }
        const v = await criarSessao(env);
        return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSAO_DIAS * 86400}` } });
      }
      return paginaLogin();
    }
    if (path === "/logout") {
      return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
    }

    // ---- tudo abaixo exige estar logado ----
    if (!(await sessaoValida(req, env))) {
      if (path.startsWith("/api/") || path.startsWith("/media/")) return json({ erro: "não autenticado" }, 401);
      return Response.redirect(url.origin + "/login", 303);
    }

    try {
      // ---- posts ----
      if (path === "/api/posts" && req.method === "GET") {
        await garantirTabela(env);
        const { results } = await env.DB.prepare("SELECT id, data FROM posts").all();
        return json(results.map((r) => ({ ...JSON.parse(r.data), id: r.id })));
      }
      const mPost = path.match(/^\/api\/posts\/([^/]+)$/);
      if (mPost) {
        const id = decodeURIComponent(mPost[1]);
        if (!idValido(id)) return json({ erro: "id inválido" }, 400);
        await garantirTabela(env);
        const antigo = await env.DB.prepare("SELECT data FROM posts WHERE id = ?").bind(id).first();
        const antigoObj = antigo ? JSON.parse(antigo.data) : null;
        if (req.method === "PUT") {
          const body = await req.json();
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ erro: "dados inválidos" }, 400);
          delete body.id;
          const txt = JSON.stringify(body);
          if (txt.length > 200000) return json({ erro: "post grande demais" }, 413);
          await env.DB.prepare("INSERT INTO posts (id, data, atualizado) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, atualizado = excluded.atualizado").bind(id, txt, Date.now()).run();
          // apaga do R2 as mídias que foram removidas do post
          const novos = new Set(idsMidia(body));
          const removidas = idsMidia(antigoObj).filter((k) => !novos.has(k));
          if (removidas.length) await env.MIDIAS.delete(removidas);
          return json({ ok: true, id });
        }
        if (req.method === "DELETE") {
          await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
          const ks = idsMidia(antigoObj); if (ks.length) await env.MIDIAS.delete(ks);
          return json({ ok: true });
        }
      }

      // ---- upload de mídia ----
      if (path === "/api/media" && req.method === "POST") {
        const tipo = req.headers.get("Content-Type") || "";
        if (!/^(image|video)\//.test(tipo)) return json({ erro: "envie uma imagem ou um vídeo" }, 415);
        const tam = Number(req.headers.get("Content-Length") || 0);
        if (tam > MAX_UPLOAD) return json({ erro: "arquivo grande demais" }, 413);
        const ext = (decodeURIComponent(req.headers.get("X-Filename") || "").match(/\.([A-Za-z0-9]{1,5})$/) || [, ""])[1].toLowerCase();
        const key = crypto.randomUUID().replace(/-/g, "") + (ext ? "." + ext : "");
        await env.MIDIAS.put(key, req.body, { httpMetadata: { contentType: tipo } });
        return json({ id: key, type: tipo.startsWith("video") ? "video" : "image" });
      }

      // ---- servir mídia (com suporte a avançar/voltar no vídeo) ----
      const mMed = path.match(/^\/media\/([A-Za-z0-9_.-]+)$/);
      if (mMed && (req.method === "GET" || req.method === "HEAD")) {
        const obj = await env.MIDIAS.get(mMed[1], { range: req.headers, onlyIf: req.headers });
        if (!obj) return new Response("Não encontrado", { status: 404 });
        const h = new Headers();
        obj.writeHttpMetadata(h);
        h.set("ETag", obj.httpEtag);
        h.set("Accept-Ranges", "bytes");
        h.set("Cache-Control", "private, max-age=31536000, immutable");
        if (!("body" in obj)) return new Response(null, { status: 304, headers: h });
        let status = 200;
        if (obj.range && req.headers.has("Range")) {
          const off = obj.range.offset ?? (obj.range.suffix != null ? obj.size - obj.range.suffix : 0);
          const len = obj.range.length ?? obj.size - off;
          h.set("Content-Range", `bytes ${off}-${off + len - 1}/${obj.size}`);
          h.set("Content-Length", String(len));
          status = 206;
        } else h.set("Content-Length", String(obj.size));
        return new Response(req.method === "HEAD" ? null : obj.body, { status, headers: h });
      }

      if (path.startsWith("/api/")) return json({ erro: "rota não encontrada" }, 404);

      // ---- página do calendário ----
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "no-store");
      return out;
    } catch (e) {
      return json({ erro: "erro no servidor", detalhe: String(e && e.message || e) }, 500);
    }
  },
};
