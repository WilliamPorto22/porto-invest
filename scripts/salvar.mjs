#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// salvar.mjs — fluxo único: build → commit → push GitHub → deploy Firebase.
//
// Uso:
//   npm run salvar                        → mensagem padrão "atualizacao YYYY-MM-DD"
//   npm run salvar -- "minha mensagem"    → mensagem custom
//   npm run salvar -- --no-deploy         → só commita+pusha, não faz deploy
//   npm run salvar -- --no-build          → pula build (útil quando só mudou doc)
//
// Falha cedo se algum passo der erro. Mostra o que aconteceu em português.
// ══════════════════════════════════════════════════════════════════════════

import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const skipDeploy = args.includes("--no-deploy");
const skipBuild = args.includes("--no-build");
const mensagemCustom = args.find((a) => !a.startsWith("--"));

const hoje = new Date().toISOString().slice(0, 10);
const mensagem = mensagemCustom || `atualizacao ${hoje}`;

const cor = {
  azul: (s) => `\x1b[36m${s}\x1b[0m`,
  verde: (s) => `\x1b[32m${s}\x1b[0m`,
  amarelo: (s) => `\x1b[33m${s}\x1b[0m`,
  vermelho: (s) => `\x1b[31m${s}\x1b[0m`,
  negrito: (s) => `\x1b[1m${s}\x1b[0m`,
};

function passo(numero, total, titulo) {
  console.log("");
  console.log(cor.azul(cor.negrito(`━━━ [${numero}/${total}] ${titulo} ━━━`)));
}

function rodar(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
  } catch (err) {
    console.error(cor.vermelho(`\n✖ Falhou: ${cmd}`));
    process.exit(err.status || 1);
  }
}

function rodarSilencioso(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const totalPassos = 1 + (skipBuild ? 0 : 1) + 1 + (skipDeploy ? 0 : 1);
let n = 0;

// ── 1) Verifica se há algo a commitar ─────────────────────────────────────
n++;
passo(n, totalPassos, "Verificando mudanças no projeto");
const status = rodarSilencioso("git status --porcelain");
if (!status) {
  console.log(cor.amarelo("  Nenhuma mudança no código desde o último commit."));
} else {
  console.log("  Arquivos com mudança:");
  console.log(status.split("\n").map((l) => `    ${l}`).join("\n"));
}

// ── 2) Build (se não foi pulado) ──────────────────────────────────────────
if (!skipBuild) {
  n++;
  passo(n, totalPassos, "Buildando o projeto (Vite)");
  rodar("npm run build");
  console.log(cor.verde("  ✓ Build OK em dist/"));
}

// ── 3) Commit + push pro GitHub ────────────────────────────────────────────
n++;
passo(n, totalPassos, `Salvando no GitHub: "${mensagem}"`);
rodar("git add -A");

const aindaTemMudanca = rodarSilencioso("git diff --cached --name-only");
if (!aindaTemMudanca) {
  console.log(cor.amarelo("  Nenhuma mudança pra commitar (working tree limpo)."));
} else {
  rodar(`git commit -m "${mensagem.replace(/"/g, '\\"')}"`);
  console.log(cor.verde("  ✓ Commit criado."));
}

const remote = rodarSilencioso("git remote get-url origin");
if (!remote) {
  console.log(cor.amarelo("  Sem remote 'origin' configurado — pulando push."));
} else {
  rodar("git push");
  console.log(cor.verde(`  ✓ Push para ${remote}`));
}

// ── 4) Deploy Firebase (se não foi pulado) ─────────────────────────────────
if (!skipDeploy) {
  n++;
  passo(n, totalPassos, "Subindo para o Firebase Hosting");
  rodar("firebase deploy --only hosting");
  console.log(cor.verde("  ✓ Site no ar: https://porto-invest-login.web.app"));
}

// ── Fim ────────────────────────────────────────────────────────────────────
console.log("");
console.log(cor.verde(cor.negrito("━━━ TUDO SALVO ━━━")));
if (!skipDeploy) console.log(cor.verde("  🌐 Site:    https://porto-invest-login.web.app"));
if (remote)      console.log(cor.verde(`  📦 GitHub: ${remote}`));
console.log("");
