import React, { useMemo, useState } from "react";

/**
 * Painel "Pontos de Atenção" — grade compacta de cards clicáveis com filtro BR/US.
 *
 * Props:
 *   alertas: [{ ticker, classe, tipo: 'critico'|'venda'|'atencao'|'info', msg, ativo }]
 *   onAbrir: (ativo) => void
 */
export default function PontosAtencao({ alertas = [], onAbrir }) {
  const [filtroMercado, setFiltroMercado] = useState("todos"); // 'todos' | 'br' | 'us'

  const mercadoDe = (classe) => (classe === "acoesBR" || classe === "fiis" ? "br" : "us");

  const filtrados = useMemo(() => {
    if (filtroMercado === "todos") return alertas;
    return alertas.filter((a) => mercadoDe(a.classe) === filtroMercado);
  }, [alertas, filtroMercado]);

  const criticos = filtrados.filter((a) => a.tipo === "critico");
  const venda    = filtrados.filter((a) => a.tipo === "venda");
  const atencao  = filtrados.filter((a) => a.tipo === "atencao");
  const info     = filtrados.filter((a) => a.tipo === "info");

  const contagem = {
    todos: alertas.length,
    br: alertas.filter((a) => mercadoDe(a.classe) === "br").length,
    us: alertas.filter((a) => mercadoDe(a.classe) === "us").length,
  };

  const bandeira = (classe) => {
    if (classe === "acoesBR" || classe === "fiis") return "🇧🇷";
    return "🇺🇸";
  };
  const classeLabel = (classe) => ({
    acoesBR: "Ação BR",
    fiis: "FII",
    acoesUS: "Ação US",
    reits: "REIT",
  }[classe] || "");

  const renderGrupo = (lista, titulo, cor, icone) => (
    lista.length > 0 && (
      <div className="pa-grupo">
        <div className="pa-grupo-titulo" style={{ color: cor }}>
          <span className="pa-grupo-dot" style={{ background: cor }} />
          <span>{icone} {titulo}</span>
          <span className="pa-grupo-count">{lista.length}</span>
        </div>
        <div className="pa-cards-grid">
          {lista.map((a, i) => (
            <button
              key={`${a.ticker}-${i}`}
              className="pa-card"
              onClick={() => onAbrir?.(a.ativo)}
              title="Clique para ver análise completa"
            >
              <div className="pa-card-head">
                <span className="pa-card-ticker">{a.ticker}</span>
                <span className="pa-card-badge">{bandeira(a.classe)} {classeLabel(a.classe)}</span>
              </div>
              <div className="pa-card-msg">{a.msg}</div>
              <div className="pa-card-cta">ver análise →</div>
            </button>
          ))}
        </div>
      </div>
    )
  );

  return (
    <aside className="pontos-atencao">
      <div className="pa-header">
        <span className="pa-badge">⚠️</span>
        <div className="pa-header-text">
          <div className="pa-titulo">Pontos de Atenção</div>
          <div className="pa-sub">Sinais relevantes — clique em qualquer card para abrir a análise completa</div>
        </div>
        <div className="pa-filtros">
          <button
            className={`pa-filtro ${filtroMercado === "todos" ? "active" : ""}`}
            onClick={() => setFiltroMercado("todos")}
          >
            Todos <span>{contagem.todos}</span>
          </button>
          <button
            className={`pa-filtro ${filtroMercado === "br" ? "active" : ""}`}
            onClick={() => setFiltroMercado("br")}
          >
            🇧🇷 BR <span>{contagem.br}</span>
          </button>
          <button
            className={`pa-filtro ${filtroMercado === "us" ? "active" : ""}`}
            onClick={() => setFiltroMercado("us")}
          >
            🇺🇸 US <span>{contagem.us}</span>
          </button>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="pa-vazio">
          {alertas.length === 0
            ? "Nenhum alerta no momento. Todos os ativos rastreados passaram nos filtros críticos."
            : "Nenhum alerta neste mercado."}
        </div>
      ) : (
        <div className="pa-grupos-lista">
          {renderGrupo(criticos, "Crítico",       "#ef4444", "🔴")}
          {renderGrupo(venda,    "Sinais de Venda", "#ef4444", "🔻")}
          {renderGrupo(atencao,  "Atenção",       "#f59e0b", "🟡")}
          {renderGrupo(info,     "Oportunidades", "#22c55e", "🟢")}
        </div>
      )}

      <div className="pa-disclaimer">
        Análise automatizada com base em fundamentos públicos. Não constitui recomendação de investimento (CVM 20).
      </div>
    </aside>
  );
}
