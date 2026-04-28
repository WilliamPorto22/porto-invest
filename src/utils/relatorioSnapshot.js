// Gera um relatório mensal HTML imprimível a partir de um snapshot da carteira.
// Abre numa nova janela já com o diálogo de impressão pronto — o usuário salva
// como PDF (atalho Ctrl+P → "Salvar como PDF") ou imprime/manda por WhatsApp.
//
// Sem dependência externa (jsPDF/html2canvas) — apenas window.open + HTML estático.
// Vantagem: zero peso adicional no bundle, fontes do navegador, suporte universal.

import { brl } from "./currency";
import { formatarMesRef } from "../services/snapshotsCarteira";

const CLASS_LABELS = {
  posFixado: "Renda Fixa Pós-Fixada",
  preFixado: "Renda Fixa Pré-Fixada",
  ipca: "Renda Fixa IPCA+",
  acoes: "Ações",
  fiis: "Fundos Imobiliários",
  multi: "Multimercado",
  prevVGBL: "Previdência VGBL",
  prevPGBL: "Previdência PGBL",
  globalEquities: "Global · Equities",
  globalTreasury: "Global · Treasury",
  globalFunds: "Global · Mutual Funds",
  globalBonds: "Global · Bonds",
  global: "Investimentos Globais",
  outros: "Outros",
};

function fmtPct(v) {
  if (v == null || isNaN(Number(v))) return "—";
  return `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
}

function corPct(v) {
  if (v == null || isNaN(Number(v))) return "#666";
  return Number(v) > 0 ? "#16a34a" : Number(v) < 0 ? "#dc2626" : "#666";
}

export function gerarRelatorioSnapshot({ snapshot, clienteNome, diffEntrouSaiu = [] }) {
  if (!snapshot) return;
  const ativos = Array.isArray(snapshot.ativos) ? snapshot.ativos : [];
  const resumo = snapshot.resumoMes || {};

  // Agrupa ativos por classe
  const porClasse = {};
  ativos.forEach((a) => {
    const k = a.classe || "outros";
    if (!porClasse[k]) porClasse[k] = [];
    porClasse[k].push(a);
  });

  // Diff: entradas/saídas/reforços
  const entradas = diffEntrouSaiu.filter((d) => d.tipo === "compra");
  const saidas = diffEntrouSaiu.filter((d) => d.tipo === "venda");
  const reforcos = diffEntrouSaiu.filter((d) => d.tipo === "reforco");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Relatório ${formatarMesRef(snapshot.mesRef)} — ${clienteNome || "Cliente"}</title>
  <style>
    @page { size: A4; margin: 1.5cm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
      color: #0f1620;
      margin: 0; padding: 24px;
      background: #fff;
      max-width: 780px;
    }
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 2px solid #F0A202; padding-bottom: 16px; margin-bottom: 20px;
    }
    .brand { font-size: 11px; color: #F0A202; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700; }
    .titulo { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .subtitulo { font-size: 13px; color: #666; margin-top: 4px; }
    .mes-pill {
      display: inline-block; padding: 6px 14px; border-radius: 999px;
      background: rgba(240,162,2,0.12); color: #b87902; font-size: 11px;
      font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
    }
    h2 {
      font-size: 11px; color: #888; letter-spacing: 0.14em; text-transform: uppercase;
      margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #eee;
    }
    .kpis {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    }
    .kpi {
      background: #f8f9fb; border: 1px solid #e8e9eb; border-radius: 10px;
      padding: 14px 16px;
    }
    .kpi-label { font-size: 10px; color: #888; letter-spacing: 0.12em; text-transform: uppercase; }
    .kpi-value { font-size: 20px; font-weight: 600; margin-top: 6px; }
    .kpi-sub { font-size: 11px; color: #666; margin-top: 4px; }
    .resumo-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
      background: #fff; border: 1px solid #e8e9eb; border-radius: 10px; padding: 14px;
    }
    .resumo-cell { font-size: 12px; }
    .resumo-cell .lbl { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
    .resumo-cell .val { font-weight: 600; margin-top: 3px; }
    .pos { color: #16a34a; }
    .neg { color: #dc2626; }
    .gold { color: #b87902; }
    table {
      width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px;
    }
    th, td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; }
    th { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #888; font-weight: 500; }
    td.r, th.r { text-align: right; }
    .classe-row { background: #f8f9fb; font-weight: 600; }
    .ativo-row td { padding-left: 24px; color: #444; }
    .diff {
      padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; font-size: 12px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .diff-in { background: rgba(22,163,74,0.06); border: 1px solid rgba(22,163,74,0.25); color: #15803d; }
    .diff-out { background: rgba(220,38,38,0.06); border: 1px solid rgba(220,38,38,0.25); color: #b91c1c; }
    .diff-up { background: rgba(96,165,250,0.06); border: 1px solid rgba(96,165,250,0.25); color: #1d4ed8; }
    .footer {
      margin-top: 32px; padding-top: 14px; border-top: 1px solid #eee;
      font-size: 10px; color: #aaa; display: flex; justify-content: space-between;
    }
    .actions {
      position: fixed; top: 16px; right: 16px;
      background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
      padding: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      display: flex; gap: 4px;
    }
    .actions button {
      background: #F0A202; color: white; border: none; padding: 8px 14px;
      border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;
    }
    .actions button.secondary { background: #f0f0f0; color: #333; }
    @media print {
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">📄 Salvar PDF / Imprimir</button>
    <button class="secondary" onclick="window.close()">Fechar</button>
  </div>

  <div class="header">
    <div>
      <div class="brand">Porto Invest · Relatório Mensal</div>
      <div class="titulo">${clienteNome || "Cliente"}</div>
      <div class="subtitulo">Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</div>
    </div>
    <div class="mes-pill">${formatarMesRef(snapshot.mesRef)}</div>
  </div>

  <h2>Posição & Performance</h2>
  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Patrimônio total</div>
      <div class="kpi-value gold">${brl(Number(snapshot.patrimonioTotal) || 0)}</div>
      <div class="kpi-sub">Data de referência: ${snapshot.dataRef || "—"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Rentabilidade</div>
      <div style="display:flex; gap:14px; margin-top:6px;">
        <div>
          <div style="font-size:9px; color:#aaa; letter-spacing:0.1em; text-transform:uppercase;">Mês</div>
          <div style="font-weight:600; color:${corPct(snapshot.rentMes)}; font-size:14px;">${fmtPct(snapshot.rentMes)}</div>
        </div>
        <div>
          <div style="font-size:9px; color:#aaa; letter-spacing:0.1em; text-transform:uppercase;">Ano</div>
          <div style="font-weight:600; color:${corPct(snapshot.rentAno)}; font-size:14px;">${fmtPct(snapshot.rentAno)}</div>
        </div>
        <div>
          <div style="font-size:9px; color:#aaa; letter-spacing:0.1em; text-transform:uppercase;">12 meses</div>
          <div style="font-weight:600; color:${corPct(snapshot.rent12m)}; font-size:14px;">${fmtPct(snapshot.rent12m)}</div>
        </div>
      </div>
    </div>
  </div>

  ${(resumo.aportes || resumo.retiradas || resumo.dividendos || resumo.juros) ? `
  <h2>Resumo do mês</h2>
  <div class="resumo-row">
    ${resumo.aportes > 0 ? `<div class="resumo-cell"><div class="lbl">Aportes</div><div class="val pos">+ ${brl(resumo.aportes)}</div></div>` : ""}
    ${resumo.retiradas > 0 ? `<div class="resumo-cell"><div class="lbl">Retiradas</div><div class="val neg">− ${brl(resumo.retiradas)}</div></div>` : ""}
    ${resumo.dividendos > 0 ? `<div class="resumo-cell"><div class="lbl">Dividendos</div><div class="val gold">${brl(resumo.dividendos)}</div></div>` : ""}
    ${resumo.juros > 0 ? `<div class="resumo-cell"><div class="lbl">Juros</div><div class="val gold">${brl(resumo.juros)}</div></div>` : ""}
  </div>
  ` : ""}

  ${(entradas.length + saidas.length + reforcos.length) > 0 ? `
  <h2>Movimentação de carteira (vs. mês anterior)</h2>
  ${entradas.map((d) => `
    <div class="diff diff-in">
      <span><b>＋ Comprou</b> ${d.ativo || "(ativo)"} <span style="opacity:0.7; font-size:11px; margin-left:6px;">${CLASS_LABELS[d.classe] || d.classe || ""}</span></span>
      <b>+ ${brl(Number(d.deltaValor) || 0)}</b>
    </div>
  `).join("")}
  ${saidas.map((d) => `
    <div class="diff diff-out">
      <span><b>− Vendeu</b> ${d.ativo || "(ativo)"} <span style="opacity:0.7; font-size:11px; margin-left:6px;">${CLASS_LABELS[d.classe] || d.classe || ""}</span></span>
      <b>− ${brl(Number(d.deltaValor) || 0)}</b>
    </div>
  `).join("")}
  ${reforcos.map((d) => `
    <div class="diff diff-up">
      <span><b>↗ Reforçou</b> ${d.ativo || "(ativo)"} <span style="opacity:0.7; font-size:11px; margin-left:6px;">${CLASS_LABELS[d.classe] || d.classe || ""}</span></span>
      <b>+ ${brl(Number(d.deltaValor) || 0)}</b>
    </div>
  `).join("")}
  ` : ""}

  ${Object.keys(porClasse).length > 0 ? `
  <h2>Ativos por classe (${ativos.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Ativo</th>
        <th class="r">Vencimento</th>
        <th class="r">Valor</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(porClasse).map(([classe, lista]) => {
        const totalClasse = lista.reduce((s, a) => s + (Number(a.valor) || 0), 0);
        return `
          <tr class="classe-row">
            <td colspan="2">${CLASS_LABELS[classe] || classe} <span style="opacity:0.6; font-weight:400; margin-left:6px; font-size:11px;">${lista.length} ativo${lista.length !== 1 ? "s" : ""}</span></td>
            <td class="r">${brl(totalClasse)}</td>
          </tr>
          ${lista.map((a) => `
            <tr class="ativo-row">
              <td>${a.nome || "(sem nome)"}</td>
              <td class="r" style="color:#888;">${a.vencimento || "—"}</td>
              <td class="r">${brl(Number(a.valor) || 0)}</td>
            </tr>
          `).join("")}
        `;
      }).join("")}
    </tbody>
  </table>
  ` : ""}

  <div class="footer">
    <span>Porto Invest — Relatório gerado automaticamente</span>
    <span>${new Date().toLocaleString("pt-BR")}</span>
  </div>
</body>
</html>`;

  // Abre nova janela com o relatório
  const win = window.open("", "_blank");
  if (!win) {
    alert("Bloqueador de popup ativo. Permita popups deste site para gerar o relatório.");
    return;
  }
  win.document.write(html);
  win.document.close();
  // Foca a janela (alguns navegadores não auto-focam)
  win.focus();
}
