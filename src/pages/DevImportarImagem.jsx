// ══════════════════════════════════════════════════════════════════════════
// DevImportarImagem
//
// Página dev-only (master) para importar carteiras transcritas manualmente
// pelo Claude (multimodal) — usado quando os créditos da Anthropic API
// acabaram e o fluxo via CF processarUploadCarteira está bloqueado.
//
// O Claude lê a imagem aqui no chat e transcreve os dados num bloco
// estruturado abaixo. O master abre essa página, ajusta cliente/mês se
// necessário, clica em salvar — chama a CF salvarSnapshotECliente que
// já existe e usa Admin SDK (não consome créditos da Anthropic).
//
// Cada bloco corresponde a uma imagem que o Claude já leu.
// ══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useAuth } from "../hooks/useAuth";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { T, C } from "../theme";
import { brl } from "../utils/currency";

// ── Cotação USD/BRL atual (ajuste quando rodar) ───────────────────────
// Lê do cache do hub se disponível (mesma fonte do Dashboard).
function lerCotacaoDolar() {
  try {
    const cached = localStorage.getItem("wealthtrack_cotacoes");
    if (cached) {
      const parsed = JSON.parse(cached);
      const v = parseFloat(parsed?.dolar?.valor);
      const tipo = String(parsed?.dolar?.tipo || "");
      if (v > 0 && tipo !== "Fallback") return v;
    }
  } catch { /* ignore */ }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// PAYLOADS — Dados transcritos pelo Claude a partir das imagens enviadas
// ══════════════════════════════════════════════════════════════════════════

const PAYLOADS = [
  {
    id: "marcos-vinicius-global-2026-04",
    titulo: "Marcos Vinicius — Carteira Global (Avenue/XP US) — abr/2026",
    clienteId: "VJUPwSzORi7o3qa9vW2s",
    mesRef: "2026-04",
    fonte: "imagem",
    arquivoNome: "carteira-global-marcos-202604.png",
    // Valores em USD — convertidos pra BRL no momento do save usando a cotação real do hub.
    ativosUSD: [
      { nome: "Cash Saldo",                                      classe: "global",         valorUSD: 30.40,    rentMes: null  },
      { nome: "VOO – Vanguard S&P 500 ETF",                      classe: "globalEquities", valorUSD: 6220.76,  rentMes: 3.06  },
      { nome: "DE – Deere & Company",                            classe: "globalEquities", valorUSD: 7855.11,  rentMes: 51.32 },
      { nome: "PIMXZ – PIMCO GIS Income",                        classe: "globalFunds",    valorUSD: 4988.80,  rentMes: -0.22 },
      { nome: "JEUIZ – JP Morgan Global High Yield Bond",        classe: "globalFunds",    valorUSD: 5045.49,  rentMes: 0.91  },
      { nome: "MRAHZ – Morgan Stanley INVF Global Asset Backed", classe: "globalFunds",    valorUSD: 21762.51, rentMes: 1.09  },
    ],
    patrimonioTotalUSD: 45903.07,
    rentMesPortfolio: null, // não detectado na imagem
    rentAnoPortfolio: null,
    rent12mPortfolio: null,
    dataReferencia: "2026-04-30",
  },
];

// ── Conversor: USD → BRL com cotação real ──────────────────────────────
function montarSnapshot(payload, cotacaoDolar) {
  const taxa = Number(cotacaoDolar);
  if (!(taxa > 0)) throw new Error("Cotação USD inválida");

  const classes = {};
  const ativos = [];
  let patrimonioBRL = 0;

  payload.ativosUSD.forEach((a) => {
    const valorBRL = Number((a.valorUSD * taxa).toFixed(2));
    if (valorBRL <= 0) return;
    patrimonioBRL += valorBRL;
    classes[a.classe] = Number(((classes[a.classe] || 0) + valorBRL).toFixed(2));
    ativos.push({
      nome: a.nome,
      classe: a.classe,
      valor: valorBRL,
      valorUSD: a.valorUSD,
      rentMes: a.rentMes,
      rentAno: null,
      vencimento: "",
    });
  });

  return {
    mesRef: payload.mesRef,
    dataRef: payload.dataReferencia,
    patrimonioTotal: Number(patrimonioBRL.toFixed(2)),
    patrimonioTotalUSD: payload.patrimonioTotalUSD,
    cotacaoUsadaUSD: taxa,
    rentMes: payload.rentMesPortfolio,
    rentAno: payload.rentAnoPortfolio,
    rent12m: payload.rent12mPortfolio,
    ganhoMes: 0,
    ganhoAno: 0,
    ganho12m: 0,
    classes,
    ativos,
    movimentacoes: [],
    resumoMes: {},
    tabelaRentMensal: null,
  };
}

// ── Patch do doc do cliente — popula <classe>Ativos pra carteira viva ──
function montarClientePatch(payload, snapshot) {
  const ativosPorClasse = {};
  snapshot.ativos.forEach((a) => {
    const k = a.classe || "outros";
    if (!ativosPorClasse[k]) ativosPorClasse[k] = [];
    ativosPorClasse[k].push({
      id: `dev-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nome: a.nome,
      valor: String(Math.round(a.valor * 100)), // centavos
      rentMes: a.rentMes != null ? String(a.rentMes) : "",
      rentAno: "",
      vencimento: "",
      objetivo: "",
      segmento: "",
    });
  });

  const carteiraPatch = {
    atualizadoEm: new Date().toLocaleDateString("pt-BR"),
    ultimoSnapshot: payload.mesRef,
    ultimaDataReferencia: snapshot.dataRef,
    rent12m: snapshot.rent12m,
    rentAno: snapshot.rentAno,
    rentMes: snapshot.rentMes,
  };
  Object.entries(ativosPorClasse).forEach(([classKey, lista]) => {
    carteiraPatch[classKey + "Ativos"] = lista;
    const total = lista.reduce((acc, a) => acc + parseInt(a.valor || "0"), 0);
    carteiraPatch[classKey] = String(total);
  });

  return { carteira: carteiraPatch };
}

// ══════════════════════════════════════════════════════════════════════════
// COMPONENTE
// ══════════════════════════════════════════════════════════════════════════

export default function DevImportarImagem() {
  const { isMaster } = useAuth();
  const [resultado, setResultado] = useState({}); // {[id]: {status, msg}}
  const [salvando, setSalvando] = useState(null); // id em progresso
  const cotacao = lerCotacaoDolar();

  if (!isMaster) {
    return (
      <div style={{ ...C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: T.textPrimary }}>Acesso restrito ao master.</div>
      </div>
    );
  }

  async function importar(payload) {
    setSalvando(payload.id);
    setResultado((r) => ({ ...r, [payload.id]: { status: "salvando", msg: "Salvando..." } }));
    try {
      if (!cotacao) throw new Error("Cotação USD não disponível. Abra /dashboard antes pra atualizar o cache.");

      const snapshot = montarSnapshot(payload, cotacao);
      const clientePatch = montarClientePatch(payload, snapshot);

      const callSalvar = httpsCallable(functions, "salvarSnapshotECliente", { timeout: 30000 });
      const r = await callSalvar({
        clienteId: payload.clienteId,
        mesRef: payload.mesRef,
        snapshotPayload: snapshot,
        clientePatch,
        opcoes: { fonte: payload.fonte, arquivoNome: payload.arquivoNome },
      });

      setResultado((rs) => ({
        ...rs,
        [payload.id]: {
          status: "ok",
          msg: `✓ Salvo. Patrimônio: ${brl(snapshot.patrimonioTotal)} (US$ ${payload.patrimonioTotalUSD.toFixed(2)} × ${cotacao.toFixed(4)})`,
          data: r.data,
        },
      }));
    } catch (err) {
      console.error("[DevImportarImagem] erro:", err);
      setResultado((rs) => ({
        ...rs,
        [payload.id]: { status: "erro", msg: "Erro: " + (err?.message || "desconhecido") },
      }));
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="dashboard-container has-sidebar" style={{ ...C.bg, minHeight: "100vh", paddingBottom: 80 }}>
      <Sidebar mode="admin" />
      <Navbar showLogout={true} />
      <div className="dashboard-content with-sidebar" style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ color: T.textPrimary, fontWeight: 300, marginBottom: 8 }}>
          Importação manual de imagens (dev)
        </h1>
        <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
          Carteiras transcritas pelo Claude diretamente da imagem do chat. Use quando os créditos
          da Anthropic API estiverem zerados. A cotação USD vem do mesmo cache do Dashboard.
        </div>

        <div style={{
          ...C.card, padding: "14px 18px", marginBottom: 24,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 4 }}>
              Cotação USD/BRL atual
            </div>
            <div style={{ fontSize: 22, color: T.textPrimary, fontWeight: 300 }}>
              {cotacao ? `R$ ${cotacao.toFixed(4)}` : "—"}
            </div>
          </div>
          {!cotacao && (
            <a href="/dashboard" style={{ color: T.gold, fontSize: 12, textDecoration: "underline" }}>
              Atualizar (abrir dashboard)
            </a>
          )}
        </div>

        {PAYLOADS.map((p) => {
          const r = resultado[p.id];
          const totalBRL = cotacao ? p.patrimonioTotalUSD * cotacao : null;
          return (
            <div key={p.id} style={{ ...C.card, padding: "20px 22px", marginBottom: 16 }}>
              <div style={{ fontSize: 16, color: T.textPrimary, fontWeight: 500, marginBottom: 6 }}>
                {p.titulo}
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>
                Cliente: <code>{p.clienteId}</code> · Mês: {p.mesRef} · {p.ativosUSD.length} ativos
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 14 }}>
                <thead>
                  <tr style={{ color: T.textMuted, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Ativo</th>
                    <th style={{ padding: "6px 8px" }}>Classe</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>USD</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>BRL</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Rent.%</th>
                  </tr>
                </thead>
                <tbody>
                  {p.ativosUSD.map((a, i) => (
                    <tr key={i} style={{ borderTop: `0.5px solid ${T.border}`, color: T.textSecondary }}>
                      <td style={{ padding: "6px 8px" }}>{a.nome}</td>
                      <td style={{ padding: "6px 8px", color: T.textMuted }}>{a.classe}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>${a.valorUSD.toFixed(2)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: T.textPrimary }}>
                        {cotacao ? brl(a.valorUSD * cotacao) : "—"}
                      </td>
                      <td style={{
                        padding: "6px 8px", textAlign: "right",
                        color: a.rentMes == null ? T.textMuted : a.rentMes >= 0 ? T.success : T.danger,
                      }}>
                        {a.rentMes == null ? "—" : `${a.rentMes >= 0 ? "+" : ""}${a.rentMes.toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${T.goldBorder}`, color: T.gold, fontWeight: 600 }}>
                    <td colSpan={2} style={{ padding: "8px" }}>TOTAL</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>${p.patrimonioTotalUSD.toFixed(2)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{totalBRL ? brl(totalBRL) : "—"}</td>
                    <td />
                  </tr>
                </tbody>
              </table>

              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={() => importar(p)}
                  disabled={!cotacao || salvando === p.id || r?.status === "ok"}
                  style={{
                    ...C.btnPrimary,
                    opacity: !cotacao || salvando === p.id || r?.status === "ok" ? 0.5 : 1,
                    cursor: !cotacao || salvando === p.id || r?.status === "ok" ? "not-allowed" : "pointer",
                  }}
                >
                  {salvando === p.id ? "Salvando..." : r?.status === "ok" ? "✓ Já salvo" : "Salvar e vincular ao mês"}
                </button>
                {r && (
                  <span style={{
                    fontSize: 12,
                    color: r.status === "erro" ? T.danger : r.status === "ok" ? T.success : T.textMuted,
                  }}>
                    {r.msg}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
