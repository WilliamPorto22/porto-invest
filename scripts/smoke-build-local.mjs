#!/usr/bin/env node
/**
 * smoke-build-local.mjs — Pipeline completo:
 *   1. vite build
 *   2. vite preview (background)
 *   3. smoke-test contra localhost
 *   4. mata o preview
 *
 * Falha se qualquer etapa falhar. Use ANTES de cada deploy.
 */

import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileP = promisify(execFile);

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}`;

function log(t, m) {
  const sym = { ok: "✓", fail: "✗", info: "▸", step: "▶" }[t] || "·";
  console.log(`${sym} ${m}`);
}

async function main() {
  // 1) Build
  log("step", "Build");
  await execFileP("node", ["node_modules/vite/bin/vite.js", "build"], {
    cwd: process.cwd(),
  }).catch(err => {
    log("fail", "Build falhou");
    console.error(err.stdout || err.stderr || err.message);
    process.exit(1);
  });
  log("ok", "Build OK");

  // 2) Sobe vite preview em background
  log("step", "Subindo preview server na porta " + PORT);
  const preview = spawn(
    "node",
    ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--host", "127.0.0.1"],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
  );

  let previewReady = false;
  preview.stdout.on("data", (d) => {
    if (d.toString().includes("Local:")) previewReady = true;
  });
  preview.stderr.on("data", () => {});

  // Espera servidor estar pronto
  const start = Date.now();
  while (!previewReady && Date.now() - start < 10000) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!previewReady) {
    log("fail", "Preview não subiu em 10s");
    preview.kill();
    process.exit(1);
  }
  log("ok", "Preview pronto");

  // 3) Smoke test em rotas críticas: Login + Dashboard + Cliente
  log("step", "Smoke test contra " + URL);
  let smokeFailed = false;
  try {
    const { stdout, stderr } = await execFileP("node", [
      "scripts/smoke-test.mjs",
      URL,
      "--route=/",                            // Login
      "--route=/dashboard",                   // Admin/Assessor (sem auth → redirect)
      "--route=/cliente/AHXx4mVNzPpbn9PszKO", // Cliente (sem auth → redirect)
    ], { cwd: process.cwd() });
    console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (err) {
    smokeFailed = true;
    console.log(err.stdout || "");
    console.log(err.stderr || "");
  }

  // 4) Limpa preview
  preview.kill();
  await new Promise(r => setTimeout(r, 200));

  if (smokeFailed) {
    log("fail", "Smoke test FALHOU — deploy NÃO autorizado");
    process.exit(1);
  }
  log("ok", "Smoke test passou — deploy seguro");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
