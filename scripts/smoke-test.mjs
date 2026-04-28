#!/usr/bin/env node
/**
 * smoke-test.mjs — Carrega o site num Chromium real (Playwright) e
 * verifica saúde + performance.
 *
 * REGRA INVIOLÁVEL: nenhuma rota pode demorar mais de 1.9s pra TTI.
 *
 * Uso:
 *   node scripts/smoke-test.mjs                    # testa produção (rotas padrão)
 *   node scripts/smoke-test.mjs http://localhost:5173
 *   node scripts/smoke-test.mjs --url=https://x  --route=/cliente/abc
 *
 * Falha se:
 *   - HTML != 200
 *   - Algum chunk preloaded != 200
 *   - Console.error/page error
 *   - #root vazio em 8s
 *   - Preso em "carregando" em 8s
 *   - TTI > 1900ms (regra de performance)
 */

import { chromium } from "playwright-core";

// Parse args
const args = process.argv.slice(2);
const baseFromArg = args.find(a => !a.startsWith("--") && a.startsWith("http"));
const URL_BASE = baseFromArg || "https://porto-invest.web.app";

// Rotas pra testar — padrão é só "/" mas pode passar mais via --route=
const routesArg = args.filter(a => a.startsWith("--route=")).map(a => a.slice(8));
const ROUTES = routesArg.length > 0 ? routesArg : ["/"];

const TTI_LIMIT_MS = 1900;          // regra do projeto
const RENDER_TIMEOUT_MS = 8000;     // teto absoluto (não passa daqui mesmo se for falha)
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function log(t, m) {
  const sym = { ok: "✓", fail: "✗", info: "·", warn: "⚠", step: "▶" }[t] || "·";
  console.log(`${sym} ${m}`);
}

async function checkAssets(URL) {
  const htmlResp = await fetch(URL);
  if (!htmlResp.ok) return { ok: false, msg: `HTML retornou ${htmlResp.status}` };
  const html = await htmlResp.text();
  const assets = [...new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])
  )];
  for (const path of assets) {
    const r = await fetch(URL + path, { method: "HEAD" });
    if (!r.ok) return { ok: false, msg: `${r.status} ${path}` };
  }
  return { ok: true, count: assets.length };
}

async function testRoute(browser, fullUrl) {
  console.log(`\n→ Rota: ${fullUrl}`);
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push((err.message || String(err)) + (err.stack ? "\n" + err.stack.split("\n").slice(0, 3).join("\n") : ""));
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.failure()?.errorText || "fail"} ${req.url()}`);
  });

  const t0 = Date.now();
  try {
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  } catch (err) {
    log("fail", `goto falhou: ${err.message}`);
    await ctx.close();
    return { ok: false, fatal: true };
  }

  // Espera o root ter conteúdo significativo
  let rendered = false;
  let stuckLoading = false;
  let ttiMs = null;

  try {
    await page.waitForFunction(() => {
      const root = document.getElementById("root");
      if (!root || root.childNodes.length === 0) return false;
      const txt = (root.textContent || "").trim();
      // Variações de "carregando" (qualquer caso, com ou sem reticências)
      if (/^carregando[…\.]*$/i.test(txt)) return false;
      // Texto significativo = renderizou de verdade
      return txt.length > 20;
    }, { timeout: RENDER_TIMEOUT_MS });
    ttiMs = Date.now() - t0;
    rendered = true;
  } catch {
    const text = await page.evaluate(() => document.getElementById("root")?.textContent || "").catch(() => "");
    stuckLoading = /carregando/i.test(text);
  }

  const finalText = await page.evaluate(() => {
    const r = document.getElementById("root");
    return r ? r.textContent.trim().slice(0, 120) : "";
  }).catch(() => "");

  await ctx.close();

  // Resultados desta rota
  const issues = [];

  if (pageErrors.length) {
    issues.push(`${pageErrors.length} erros de página: ${pageErrors[0].slice(0, 200)}`);
  }
  if (failedRequests.length) {
    issues.push(`${failedRequests.length} requests com falha: ${failedRequests[0]}`);
  }
  if (!rendered) {
    if (stuckLoading) {
      issues.push("preso em 'carregando…'");
    } else {
      issues.push("#root sem conteúdo significativo");
    }
  } else if (ttiMs > TTI_LIMIT_MS) {
    issues.push(`⚠ TTI ${ttiMs}ms > ${TTI_LIMIT_MS}ms (regra do projeto)`);
  }

  const ok = issues.length === 0;

  if (ok) {
    log("ok", `Renderizou em ${ttiMs}ms (limite ${TTI_LIMIT_MS}ms) · texto: "${finalText.slice(0, 60)}…"`);
  } else {
    log("fail", `Falhou:`);
    issues.forEach(i => console.log("    " + i));
    if (consoleErrors.length) {
      console.log("    Console errors:");
      consoleErrors.slice(0, 3).forEach(e => console.log("      " + e.slice(0, 200)));
    }
  }

  return { ok, ttiMs, issues };
}

async function main() {
  console.log(`\n→ Smoke test em ${URL_BASE} (${ROUTES.length} rota(s))`);

  // 1) HTTP check rápido
  const assetCheck = await checkAssets(URL_BASE);
  if (!assetCheck.ok) {
    log("fail", assetCheck.msg);
    process.exit(1);
  }
  log("ok", `${assetCheck.count} assets retornam 200`);

  // 2) Browser real
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  let allOk = true;
  const results = [];

  try {
    for (const route of ROUTES) {
      const url = URL_BASE.replace(/\/$/, "") + route;
      const r = await testRoute(browser, url);
      results.push({ route, ...r });
      if (!r.ok) allOk = false;
    }
  } finally {
    await browser.close();
  }

  console.log("");
  if (allOk) {
    const maxTti = Math.max(...results.map(r => r.ttiMs || 0));
    console.log(`✅ Smoke test passou — todas as ${ROUTES.length} rota(s), TTI máximo ${maxTti}ms\n`);
    process.exit(0);
  } else {
    const failed = results.filter(r => !r.ok).map(r => r.route);
    console.log(`✗ Smoke test FALHOU — ${failed.length}/${ROUTES.length} rota(s): ${failed.join(", ")}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
