import React, { useMemo, useState, useEffect } from "react";
import { GLOSSARIO, INDICADORES_ACOES, INDICADORES_FIIS, INDICADORES_REITS } from "../../constants/glossarioIndicadores";
import { analisarAtivo } from "../../services/scoringTabela";
import GlossarioModal from "./GlossarioModal";
import DecisaoModal from "./DecisaoModal";

/**
 * Tabela dinâmica de análise de ativos — header clicável (glossário),
 * linhas clicáveis (modal de recomendação), ordenação, busca, cores por valor.
 *
 * Props:
 *   titulo  : string
 *   moeda   : 'BRL' | 'USD'
 *   ativos  : lista enriquecida (com indicadores detalhados)
 *   classe  : 'acoesBR' | 'fiis' | 'acoesUS' | 'reits'
 *   onAbrir : (ativo) => void  — abre modal geral do ativo (gráfico + breakdown)
 */
export default function TabelaAtivos({ titulo, moeda = "BRL", ativos = [], classe, onAbrir }) {
  const [filtroSetor, setFiltroSetor] = useState("todos");
  const [busca, setBusca] = useState("");
  const [sort, setSort] = useState({ campo: "score", dir: "desc" });
  const [glossarioAberto, setGlossarioAberto] = useState(null);
  const [decisaoAberta, setDecisaoAberta] = useState(null);

  const indicadoresMostrar =
    classe === "reits" ? INDICADORES_REITS :
    classe === "fiis"  ? INDICADORES_FIIS  :
    INDICADORES_ACOES;

  // Enriquecimento: anexa analise (scoring + classificações) a cada ativo
  const analisados = useMemo(
    () => ativos.map(a => ({ ...a, _analise: analisarAtivo(a, classe) })),
    [ativos, classe],
  );

  // Setores únicos para filtro
  const setores = useMemo(() => {
    const s = new Set(analisados.map(a => a.setor).filter(Boolean));
    return ["todos", ...[...s].sort()];
  }, [analisados]);

  // Reset de filtro inválido ao trocar de aba
  useEffect(() => {
    if (filtroSetor !== "todos" && !setores.includes(filtroSetor)) {
      setFiltroSetor("todos");
    }
  }, [setores, filtroSetor]);

  // Aplica filtro + busca + sort
  const linhas = useMemo(() => {
    let out = analisados;
    if (filtroSetor !== "todos") out = out.filter(a => a.setor === filtroSetor);
    const termo = busca.trim().toLowerCase();
    if (termo) {
      out = out.filter(a =>
        a.ticker?.toLowerCase().includes(termo) ||
        (a.nome || a.nomeLongo || "").toLowerCase().includes(termo)
      );
    }
    // Sort
    const dir = sort.dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      let va, vb;
      if (sort.campo === "score") { va = a._analise.score; vb = b._analise.score; }
      else if (sort.campo === "ticker") { va = a.ticker || ""; vb = b.ticker || ""; }
      else if (sort.campo === "preco") { va = a.preco ?? 0; vb = b.preco ?? 0; }
      else { va = a[sort.campo] ?? -Infinity; vb = b[sort.campo] ?? -Infinity; }
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
    return out;
  }, [analisados, filtroSetor, busca, sort]);

  const toggleSort = (campo) => {
    if (sort.campo === campo) setSort({ campo, dir: sort.dir === "asc" ? "desc" : "asc" });
    else setSort({ campo, dir: "desc" });
  };

  const fmtMoeda = (v) => {
    if (v == null) return "—";
    return moeda === "BRL"
      ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtIndicador = (key, valor) => {
    if (valor == null || !Number.isFinite(valor)) return "N/D";
    const unidade = GLOSSARIO[key]?.unidade || "";
    if (unidade === "%") return `${valor.toFixed(1)}%`;
    if (unidade === "x" || unidade === "anos") return valor.toFixed(2);
    return valor.toFixed(2);
  };

  return (
    <section className="ta-wrapper">
      {/* Header: título + busca + filtro setor */}
      <header className="ta-header">
        <div className="ta-header-left">
          <h3 className="ta-titulo">{titulo}</h3>
          <div className="ta-sub">
            {linhas.length} ativo{linhas.length === 1 ? "" : "s"} · scoring multi-guru · clique no cabeçalho para ver fórmula
          </div>
        </div>
        <div className="ta-header-right">
          <input
            type="search"
            placeholder="Buscar ticker ou nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="ta-busca"
          />
          <select
            value={filtroSetor}
            onChange={(e) => setFiltroSetor(e.target.value)}
            className="ta-filtro"
          >
            {setores.map(s => (
              <option key={s} value={s}>{s === "todos" ? "Todos setores" : s}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Tabela */}
      <div className="ta-scroll">
        <table className="ta-tabela">
          {/* Larguras fixas por coluna — garantem que todas as classes (BR/FII/US/REIT)
              renderizem com o mesmo padrão visual em qualquer tela. Em telas estreitas
              o container .ta-scroll ativa rolagem horizontal sem quebrar nada. */}
          <colgroup>
            <col className="col-ticker" />
            <col className="col-preco" />
            {indicadoresMostrar.map((key) => (
              <col key={key} className="col-ind" />
            ))}
            <col className="col-score" />
            <col className="col-sinal" />
          </colgroup>
          <thead>
            <tr>
              <th className="ta-th-sticky ta-th-ticker" onClick={() => toggleSort("ticker")}>
                <div className="ta-th-inner">Ativo {sortIcon(sort, "ticker")}</div>
              </th>
              <th className="ta-th-num" onClick={() => toggleSort("preco")}>
                <div className="ta-th-inner">Preço {sortIcon(sort, "preco")}</div>
              </th>
              {indicadoresMostrar.map(key => {
                const g = GLOSSARIO[key];
                if (!g) return null;
                return (
                  <th key={key} className="ta-th-num ta-th-click" onClick={(e) => {
                    // Se segurar shift: ordena. Senão: abre glossário.
                    if (e.shiftKey) { toggleSort(key); return; }
                    setGlossarioAberto(key);
                  }}
                    title={`${g.nome} — clique para ver fórmula. Shift+clique para ordenar.`}
                  >
                    <div className="ta-th-inner">
                      <span className="ta-th-abrev">{g.abrev}</span>
                      <span className="ta-th-info">ⓘ</span>
                      {sort.campo === key && <span>{sortIcon(sort, key)}</span>}
                    </div>
                  </th>
                );
              })}
              <th className="ta-th-num" onClick={() => toggleSort("score")}>
                <div className="ta-th-inner">Score {sortIcon(sort, "score")}</div>
              </th>
              <th className="ta-th-sinal">Sinal</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((a, i) => {
              const an = a._analise;
              return (
                <tr key={a.ticker} className={`ta-linha ta-sinal-${an.sinal}`}>
                  {/* Coluna fixa: ticker + nome + bolinha do sinal.
                      O wrapper interno garante que o <td> respeite a largura
                      do <col className="col-ticker"> (table-layout: fixed). */}
                  <td className="ta-td-sticky ta-td-ticker" onClick={() => onAbrir?.(a)}>
                    <div className="ta-ticker-cell">
                      <span className={`ta-sinal-dot sinal-${an.sinal}`} title={sinalLabel(an.sinal)} />
                      <div className="ta-ticker-info">
                        <div className="ta-ticker-nome">{a.ticker}</div>
                        <div className="ta-ticker-sub">{a.nome || a.nomeLongo}</div>
                      </div>
                    </div>
                  </td>

                  {/* Preço */}
                  <td className="ta-td-num" onClick={() => onAbrir?.(a)}>
                    {fmtMoeda(a.preco)}
                    <div className="ta-td-sub" style={{ color: (a.variacaoDia ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                      {a.variacaoDia != null ? `${a.variacaoDia > 0 ? "+" : ""}${a.variacaoDia.toFixed(2)}%` : "—"}
                    </div>
                  </td>

                  {/* Indicadores */}
                  {indicadoresMostrar.map(key => {
                    const ind = an.indicadores[key];
                    const valor = a[key];
                    const status = ind?.status || "sem-dado";
                    return (
                      <td
                        key={key}
                        className={`ta-td-num ta-td-ind status-${status}`}
                        title={ind?.comentario || ""}
                        onClick={() => onAbrir?.(a)}
                      >
                        {fmtIndicador(key, valor)}
                      </td>
                    );
                  })}

                  {/* Score */}
                  <td className="ta-td-num ta-td-score" onClick={() => onAbrir?.(a)}>
                    <span className={`ta-score-pill score-${faixaClasse(an.faixa)}`}>
                      {an.score}
                    </span>
                  </td>

                  {/* Sinal: botão só se compra/venda. Neutro só a bolinha na 1ª coluna. */}
                  <td className="ta-td-sinal">
                    {an.sinal === "compra" && (
                      <button
                        className="ta-sinal-btn ta-sinal-btn-compra"
                        onClick={(e) => { e.stopPropagation(); setDecisaoAberta({ ativo: a, analise: an }); }}
                      >
                        🟢 COMPRA
                      </button>
                    )}
                    {an.sinal === "venda" && (
                      <button
                        className="ta-sinal-btn ta-sinal-btn-venda"
                        onClick={(e) => { e.stopPropagation(); setDecisaoAberta({ ativo: a, analise: an }); }}
                      >
                        🔴 VENDA
                      </button>
                    )}
                    {an.sinal === "neutro" && null}
                  </td>
                </tr>
              );
            })}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={indicadoresMostrar.length + 4} className="ta-vazio">
                  Nenhum ativo encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div className="ta-legenda">
        <span><span className="ta-dot sinal-compra" /> Compra</span>
        <span><span className="ta-dot sinal-neutro" /> Neutro</span>
        <span><span className="ta-dot sinal-venda" /> Venda</span>
        <span className="ta-legenda-sep">·</span>
        <span>🟢 valor positivo · 🟡 neutro · 🔴 valor negativo · N/D = sem dado da fonte</span>
      </div>

      {/* Modais */}
      {glossarioAberto && (
        <GlossarioModal indicadorKey={glossarioAberto} onClose={() => setGlossarioAberto(null)} />
      )}
      {decisaoAberta && (
        <DecisaoModal
          ativo={decisaoAberta.ativo}
          analise={decisaoAberta.analise}
          classe={classe}
          onClose={() => setDecisaoAberta(null)}
        />
      )}
    </section>
  );
}

function sortIcon(sort, campo) {
  if (sort.campo !== campo) return <span className="ta-sort-inactive">↕</span>;
  return <span className="ta-sort-active">{sort.dir === "asc" ? "↑" : "↓"}</span>;
}
function sinalLabel(s) { return s === "compra" ? "Compra" : s === "venda" ? "Venda" : "Neutro"; }
function faixaClasse(faixa) {
  if (!faixa) return "neutra";
  const map = { "Excelente": "excelente", "Boa": "boa", "Neutra": "neutra", "Fraca": "fraca", "Evitar": "evitar" };
  return map[faixa] || "neutra";
}
