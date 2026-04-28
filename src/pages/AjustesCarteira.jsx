import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { T } from "../theme";
import { parseCentavos, brl as moedaFull } from "../utils/currency";
import { useAuth } from "../hooks/useAuth";

const noEdit = { userSelect: "none", WebkitUserSelect: "none" };

const CLASSES_LABELS = {
  posFixado: "Pós-Fixado",
  ipca: "IPCA+",
  preFixado: "Pré-Fixado",
  acoes: "Ações",
  fiis: "FIIs",
  multi: "Multimercado",
  prevVGBL: "Prev. VGBL",
  prevPGBL: "Prev. PGBL",
  globalEquities: "Renda Var. Global",
  globalTreasury: "Tesouros Globais",
  globalFunds: "Fundos Globais",
  globalBonds: "Bonds Globais",
  global: "Internacional",
  outros: "Outros",
};

function getPatFin(c) {
  if (!c?.carteira) return 0;
  const cart = c.carteira;
  const keys = Object.keys(CLASSES_LABELS);
  let total = 0;
  for (const k of keys) {
    const ativos = cart[k + "Ativos"];
    if (Array.isArray(ativos) && ativos.length > 0) {
      total += ativos.reduce((s, a) => s + (parseCentavos(a.valor) / 100), 0);
    } else if (cart[k]) {
      total += parseCentavos(cart[k]) / 100;
    }
  }
  return total > 0 ? total : (parseCentavos(c.patrimonio) / 100);
}

function getAllocMap(c) {
  if (!c?.carteira) return {};
  const cart = c.carteira;
  const keys = Object.keys(CLASSES_LABELS);
  const map = {};
  for (const k of keys) {
    const ativos = cart[k + "Ativos"];
    if (Array.isArray(ativos) && ativos.length > 0) {
      map[k] = ativos.reduce((s, a) => s + (parseCentavos(a.valor) / 100), 0);
    } else if (cart[k]) {
      map[k] = parseCentavos(cart[k]) / 100;
    } else {
      map[k] = 0;
    }
  }
  return map;
}

function gerarRecomendacoes(snap) {
  const recs = [];
  const patFin = getPatFin(snap);
  const alloc = getAllocMap(snap);
  const total = Object.values(alloc).reduce((s, v) => s + v, 0) || 1;

  const pct = (k) => (alloc[k] || 0) / total * 100;
  const gastos = parseCentavos(snap.gastosMensaisManual) / 100 || 0;
  const renda = parseCentavos(snap.salarioMensal) / 100 || 0;

  // ── Reserva de Emergência ──
  const reservaMeta = gastos * 6;
  const liquidez = (alloc.posFixado || 0) + (alloc.outros || 0);
  if (gastos > 0 && liquidez < reservaMeta) {
    const falta = reservaMeta - liquidez;
    recs.push({
      prioridade: "alta",
      titulo: "Reforçar Reserva de Emergência",
      descricao: `A reserva ideal é de 6x os gastos mensais (${moedaFull(reservaMeta)}). Atualmente há aproximadamente ${moedaFull(liquidez)} em ativos líquidos — faltam ${moedaFull(falta)}.`,
      acao: `Direcionar os próximos aportes para Pós-Fixado (CDB, LCA, LCI 100% CDI) até completar a reserva.`,
      cor: "#ef4444",
      bg: "linear-gradient(135deg,rgba(239,68,68,0.10),rgba(239,68,68,0.02))",
      br: "rgba(239,68,68,0.28)",
    });
  }

  // ── Concentração excessiva em Pós-Fixado ──
  const pPosFixado = pct("posFixado");
  if (pPosFixado > 60 && patFin > 200000) {
    recs.push({
      prioridade: "media",
      titulo: "Reduzir Concentração em Pós-Fixado",
      descricao: `${pPosFixado.toFixed(0)}% do patrimônio está em Pós-Fixado. Acima de 60% limita o potencial de crescimento real no longo prazo.`,
      acao: "Migrar parte do excedente (acima de 40%) para IPCA+ de longo prazo e/ou renda variável conforme o perfil de risco.",
      cor: "#f59e0b",
      bg: "linear-gradient(135deg,rgba(245,158,11,0.10),rgba(245,158,11,0.02))",
      br: "rgba(245,158,11,0.28)",
    });
  }

  // ── Ausência de IPCA+ ──
  if (pct("ipca") < 5 && patFin > 100000) {
    recs.push({
      prioridade: "media",
      titulo: "Incluir Proteção Contra Inflação (IPCA+)",
      descricao: "A carteira não possui alocação relevante em títulos IPCA+. Eles garantem rentabilidade real acima da inflação no longo prazo.",
      acao: "Alocar entre 15-25% em NTN-B (Tesouro IPCA+) ou debêntures incentivadas IPCA+ com prazo alinhado aos objetivos.",
      cor: "#F0A202",
      bg: "linear-gradient(135deg,rgba(240,162,2,0.10),rgba(240,162,2,0.02))",
      br: "rgba(240,162,2,0.28)",
    });
  }

  // ── Ausência de Renda Variável ──
  const pRendaVar = pct("acoes") + pct("fiis") + pct("multi");
  if (pRendaVar < 10 && patFin > 300000) {
    recs.push({
      prioridade: "media",
      titulo: "Ampliar Exposição à Renda Variável",
      descricao: `Apenas ${pRendaVar.toFixed(0)}% em renda variável (ações, FIIs, multimercado). Para horizontes acima de 5 anos, a renda variável é fundamental para superar a inflação.`,
      acao: "Avaliar inclusão gradual de fundos de ações ou ETFs (BOVA11, IVVB11) e FIIs de papel/tijolo conforme tolerância ao risco.",
      cor: "#a855f7",
      bg: "linear-gradient(135deg,rgba(168,85,247,0.10),rgba(168,85,247,0.02))",
      br: "rgba(168,85,247,0.28)",
    });
  }

  // ── Ausência de Diversificação Global ──
  const pGlobal = pct("globalEquities") + pct("globalTreasury") + pct("globalFunds") + pct("globalBonds") + pct("global");
  if (pGlobal < 5 && patFin > 500000) {
    recs.push({
      prioridade: "baixa",
      titulo: "Diversificação Internacional",
      descricao: `Sem exposição relevante ao exterior (${pGlobal.toFixed(0)}%). Patrimônios acima de R$500k se beneficiam de diversificação cambial e acesso aos maiores mercados globais.`,
      acao: "Considerar ETFs internacionais (IVVB11, BDRs) ou fundos com exposição a S&P 500 e treasuries americanos entre 5-15% da carteira.",
      cor: "#60a5fa",
      bg: "linear-gradient(135deg,rgba(96,165,250,0.10),rgba(96,165,250,0.02))",
      br: "rgba(96,165,250,0.28)",
    });
  }

  // ── Previdência ──
  const pPrev = pct("prevVGBL") + pct("prevPGBL");
  if (pPrev < 10 && renda > 0) {
    recs.push({
      prioridade: "baixa",
      titulo: "Avaliar Previdência Privada",
      descricao: "Baixa alocação em previdência privada. Para quem tem renda mensal relevante, VGBL e PGBL oferecem vantagens fiscais e sucessórias significativas.",
      acao: snap.declaraIR === "completo"
        ? "Contribuição ao PGBL pode deduzir até 12% da renda bruta no IR. Avaliar PGBL + VGBL progressivo."
        : "Avaliar VGBL com tabela regressiva para acúmulo de longo prazo com isenção no inventário.",
      cor: "#22c55e",
      bg: "linear-gradient(135deg,rgba(34,197,94,0.10),rgba(34,197,94,0.02))",
      br: "rgba(34,197,94,0.28)",
    });
  }

  // ── Aporte irregular ──
  if (snap.statusAporteMes === "nao_aportou") {
    recs.push({
      prioridade: "alta",
      titulo: "Regularizar Aporte Mensal",
      descricao: "O aporte deste mês ainda não foi registrado. A disciplina no aporte é o fator mais importante para o crescimento patrimonial no longo prazo.",
      acao: "Verificar com o cliente se o aporte foi realizado e registrar. Considerar débito automático mensal.",
      cor: "#ef4444",
      bg: "linear-gradient(135deg,rgba(239,68,68,0.10),rgba(239,68,68,0.02))",
      br: "rgba(239,68,68,0.28)",
    });
  }

  if (recs.length === 0) {
    recs.push({
      prioridade: "ok",
      titulo: "Carteira bem estruturada",
      descricao: "Não foram identificados ajustes urgentes. A carteira apresenta boa diversificação e liquidez adequada.",
      acao: "Continue monitorando a evolução e revise a alocação anualmente ou após grandes variações de mercado.",
      cor: "#22c55e",
      bg: "linear-gradient(135deg,rgba(34,197,94,0.10),rgba(34,197,94,0.02))",
      br: "rgba(34,197,94,0.28)",
    });
  }

  return recs;
}

const PRIORIDADE_LABEL = { alta: "Prioridade Alta", media: "Prioridade Média", baixa: "Prioridade Baixa", ok: "Tudo certo" };
const PRIORIDADE_ORDER = { alta: 0, media: 1, baixa: 2, ok: 3 };

export default function AjustesCarteira() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isMaster, isAssessor } = useAuth();
  const isInterno = isMaster || isAssessor;

  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!id || id === "novo") { setLoading(false); return; }
    let vivo = true;
    lerClienteComFallback(id, { isAlive: () => vivo }).then((r) => {
      if (!vivo) return;
      if (r.exists && r.data) setSnap(r.data);
      setLoading(false);
    }).catch(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [id]);

  const recs = snap ? gerarRecomendacoes(snap) : [];
  const patFin = snap ? getPatFin(snap) : 0;
  const alloc = snap ? getAllocMap(snap) : {};
  const totalAlloc = Object.values(alloc).reduce((s, v) => s + v, 0) || 1;

  const altasCount = recs.filter(r => r.prioridade === "alta").length;
  const mediasCount = recs.filter(r => r.prioridade === "media").length;

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode={isInterno ? "admin" : "cliente"} clienteId={id} />
      <div className="dashboard-content with-sidebar pi-page-cliente">
        <Navbar showLogout={true} />
        <div style={{ maxWidth: 900, margin: "0 auto", padding: isMobile ? "20px 14px 60px" : "36px 28px 80px", boxSizing: "border-box" }}>

          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <button
              onClick={() => navigate(`/cliente/${id}`)}
              style={{ background: "none", border: "none", color: T.textSecondary, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "0 0 16px", display: "flex", alignItems: "center", gap: 6, ...noEdit }}
              onMouseEnter={e => { e.currentTarget.style.color = T.textPrimary; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSecondary; }}
            >
              ← Voltar ao painel
            </button>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "#f87171", fontWeight: 700, marginBottom: 6, ...noEdit }}>Recomendações</div>
                <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.02em", marginBottom: 6, ...noEdit }}>
                  Ajustes da Carteira
                </div>
                {snap && (
                  <div style={{ fontSize: 13, color: T.textSecondary, ...noEdit }}>
                    {snap.nome} · {moedaFull(patFin)} patrimônio financeiro
                  </div>
                )}
              </div>
              {/* Score badges */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {altasCount > 0 && (
                  <div style={{ padding: "6px 14px", background: "rgba(239,68,68,0.12)", border: "0.5px solid rgba(239,68,68,0.35)", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#f87171", ...noEdit }}>
                    {altasCount} alta{altasCount > 1 ? "s" : ""}
                  </div>
                )}
                {mediasCount > 0 && (
                  <div style={{ padding: "6px 14px", background: "rgba(245,158,11,0.10)", border: "0.5px solid rgba(245,158,11,0.32)", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#f59e0b", ...noEdit }}>
                    {mediasCount} média{mediasCount > 1 ? "s" : ""}
                  </div>
                )}
              </div>
            </div>
          </div>

          {loading && (
            <div style={{ textAlign: "center", padding: "60px 0", color: T.textSecondary, fontSize: 14, ...noEdit }}>Carregando dados do cliente…</div>
          )}

          {!loading && !snap && (
            <div style={{ textAlign: "center", padding: "60px 0", color: T.textSecondary, fontSize: 14, ...noEdit }}>Cliente não encontrado.</div>
          )}

          {!loading && snap && (
            <>
              {/* Alocação atual */}
              <div style={{ background: "linear-gradient(150deg,rgba(36,55,83,0.92),rgba(13,19,33,0.98))", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: isMobile ? "18px 16px" : "22px 24px", marginBottom: 16 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", fontWeight: 700, marginBottom: 16, ...noEdit }}>Alocação Atual</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 8 }}>
                  {Object.entries(alloc)
                    .filter(([, v]) => v > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([k, v]) => {
                      const p = (v / totalAlloc * 100);
                      return (
                        <div key={k} style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 14px", ...noEdit }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{CLASSES_LABELS[k] || k}</div>
                          <div style={{ fontSize: 16, fontWeight: 600, color: T.textPrimary, marginBottom: 4 }}>{p.toFixed(1)}%</div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{moedaFull(v)}</div>
                          <div style={{ marginTop: 8, height: 2, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(p, 100)}%`, background: "linear-gradient(90deg,#F0A202,#fbbf24)", borderRadius: 2 }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Recomendações */}
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.25)", fontWeight: 700, marginBottom: 12, ...noEdit }}>
                Sugestões de Ajuste ({recs.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...recs].sort((a, b) => PRIORIDADE_ORDER[a.prioridade] - PRIORIDADE_ORDER[b.prioridade]).map((rec, i) => (
                  <div
                    key={i}
                    style={{ background: rec.bg, border: `0.5px solid ${rec.br}`, borderRadius: 16, padding: isMobile ? "18px 16px" : "22px 24px", position: "relative", overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", top: -40, right: -40, width: 120, height: 120, background: `radial-gradient(circle,${rec.cor}18 0%,transparent 70%)`, pointerEvents: "none" }} />
                    <div style={{ position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, background: `${rec.cor}22`, color: rec.cor, border: `0.5px solid ${rec.cor}50`, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, ...noEdit }}>
                          {PRIORIDADE_LABEL[rec.prioridade]}
                        </span>
                      </div>
                      <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 600, color: rec.cor, marginBottom: 10, letterSpacing: "-0.01em", ...noEdit }}>{rec.titulo}</div>
                      <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6, marginBottom: 14, ...noEdit }}>{rec.descricao}</div>
                      <div style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 700, marginBottom: 6, ...noEdit }}>Ação recomendada</div>
                        <div style={{ fontSize: 13, color: T.textPrimary, lineHeight: 1.6, ...noEdit }}>{rec.acao}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Botão abrir carteira */}
              <button
                onClick={() => navigate(`/cliente/${id}/carteira`)}
                style={{ marginTop: 24, width: "100%", padding: "16px 22px", background: "linear-gradient(135deg,rgba(240,162,2,0.10),rgba(240,162,2,0.02))", border: "0.5px solid rgba(240,162,2,0.3)", borderRadius: 14, color: "#F0A202", fontFamily: "inherit", cursor: "pointer", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)", ...noEdit }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 32px -8px rgba(240,162,2,0.25)"; e.currentTarget.style.borderColor = "rgba(240,162,2,0.55)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "rgba(240,162,2,0.3)"; }}
              >
                Abrir Carteira para Editar →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
