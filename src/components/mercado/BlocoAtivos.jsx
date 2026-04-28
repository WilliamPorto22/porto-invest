import React, { useEffect, useMemo, useState } from "react";

/**
 * Tabela de Top 15 por classe. Filtro único: setor.
 * Exibe: Preço, Dia, 12m, P/L, P/VP, DY, ROE, Score, Sinal — mais indicadores
 * visíveis para dar base de decisão direta na tela sem precisar abrir modal.
 */
export default function BlocoAtivos({ titulo, moeda = "BRL", ativos = [], onAbrir }) {
  const [filtroSetor, setFiltroSetor] = useState("todos");

  const setores = useMemo(() => {
    const s = new Set(ativos.map((a) => a.setor).filter(Boolean));
    return ["todos", ...Array.from(s).sort()];
  }, [ativos]);

  // Reseta o filtro para "todos" quando mudar de classe/aba e o setor atual
  // não existir mais. Antes mantinha "Bancos" ao trocar BR→US e ficava vazio.
  useEffect(() => {
    if (filtroSetor !== "todos" && !setores.includes(filtroSetor)) {
      setFiltroSetor("todos");
    }
  }, [setores, filtroSetor]);

  const filtrados = useMemo(() => {
    if (filtroSetor === "todos") return ativos;
    return ativos.filter((a) => a.setor === filtroSetor);
  }, [ativos, filtroSetor]);

  const fmtMoeda = (v) => {
    if (v == null) return "—";
    return moeda === "BRL"
      ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
  const corPct = (v) => (v == null ? "#748CAB" : v >= 0 ? "#22c55e" : "#ef4444");

  return (
    <section className="bloco-ativos">
      <header className="bloco-header">
        <div>
          <h3 className="bloco-titulo">{titulo}</h3>
          <div className="bloco-sub">
            {filtrados.length} ativo{filtrados.length === 1 ? "" : "s"} • ordenados por score de qualidade
          </div>
        </div>
        <div className="bloco-filtros">
          <select
            value={filtroSetor}
            onChange={(e) => setFiltroSetor(e.target.value)}
            className="bloco-filtro-select"
            aria-label="Filtrar por setor"
          >
            {setores.map((s) => (
              <option key={s} value={s}>{s === "todos" ? "Todos setores" : s}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="bloco-tabela-wrap">
        <table className="bloco-tabela">
          <thead>
            <tr>
              <th>#</th>
              <th>Ativo</th>
              <th>Setor</th>
              <th className="num">Preço</th>
              <th className="num">Dia</th>
              <th className="num">12m</th>
              <th className="num">P/L</th>
              <th className="num">P/VP</th>
              <th className="num">DY</th>
              <th className="num">ROE</th>
              <th className="num">Preço-alvo</th>
              <th className="num">Upside</th>
              <th className="num">Score</th>
              <th>Sinal</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((a, i) => {
              const alvo = calcularPrecoAlvo(a);
              const upside = alvo != null && a.preco ? ((alvo - a.preco) / a.preco) * 100 : null;
              return (
                <tr key={a.ticker} className="bloco-linha" onClick={() => onAbrir?.(a)}>
                  <td className="bloco-idx">{String(i + 1).padStart(2, "0")}</td>
                  <td>
                    <div className="bloco-ticker">{a.ticker}</div>
                    <div className="bloco-nome">{a.nome || a.nomeLongo}</div>
                  </td>
                  <td className="bloco-setor">{a.setor || "—"}</td>
                  <td className="num">{fmtMoeda(a.preco)}</td>
                  <td className="num" style={{ color: corPct(a.variacaoDia) }}>{fmtPct(a.variacaoDia)}</td>
                  <td className="num" style={{ color: corPct(a.variacaoAno) }}>{fmtPct(a.variacaoAno)}</td>
                  <td className="num">{a.pl != null ? a.pl.toFixed(1) : "—"}</td>
                  <td className="num">{a.pvp != null ? a.pvp.toFixed(2) : "—"}</td>
                  <td className="num">{a.dy != null ? `${a.dy.toFixed(1)}%` : "—"}</td>
                  <td className="num">{formatarROE(a.roe)}</td>
                  <td className="num">{fmtMoeda(alvo)}</td>
                  <td className="num" style={{ color: corPct(upside) }}>{fmtPct(upside)}</td>
                  <td className="num bloco-score-cell">
                    <span className={`bloco-score score-${faixaClasse(a.analise?.faixa)}`}>
                      {a.analise?.score ?? "—"}
                    </span>
                  </td>
                  <td>
                    {a.analise?.momentoCompra ? (
                      <span className="badge-compra">MOMENTO DE COMPRA</span>
                    ) : a.analise?.faixa === "Evitar" || a.analise?.faixa === "Fraca" ? (
                      <span className="badge-venda">SINAL DE VENDA</span>
                    ) : (
                      <span className="badge-neutro">{a.analise?.faixa || "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan="14" className="bloco-vazio">Nenhum ativo neste setor.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Preço-alvo simples: se P/L atual > 0 e DY/ROE permitem, sugere preço que
// levaria P/L a 10 (ação BR) ou 15 (US), OU P/VP a 1.5 (o menor dos dois).
// Objetivo: dar uma referência didática, não uma recomendação formal.
function calcularPrecoAlvo(a) {
  if (!a.preco || !isFinite(a.preco)) return null;
  const alvos = [];
  if (a.pl != null && a.pl > 0) {
    const plAlvo = (a.moeda || "BRL") === "BRL" ? 10 : 15;
    alvos.push((a.preco / a.pl) * plAlvo);
  }
  if (a.pvp != null && a.pvp > 0) {
    const pvpAlvo = 1.5;
    alvos.push((a.preco / a.pvp) * pvpAlvo);
  }
  if (alvos.length === 0) return null;
  // Pega o MENOR alvo (mais conservador)
  return Math.min(...alvos);
}

function formatarROE(roe) {
  if (roe == null) return "—";
  const pct = roe > 1 ? roe : roe * 100;
  return `${pct.toFixed(1)}%`;
}

function faixaClasse(faixa) {
  if (!faixa) return "neutra";
  const map = { "Excelente": "excelente", "Boa": "boa", "Neutra": "neutra", "Fraca": "fraca", "Evitar": "evitar" };
  return map[faixa] || "neutra";
}
