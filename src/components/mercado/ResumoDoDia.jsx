import React, { useEffect, useMemo, useState } from "react";
import { lerCacheCotacoes, obterTodasAsCotacoes, mercadoAberto } from "../../services/cotacoesReais";

/**
 * ResumoDoDia — briefing executivo no topo do /mercado.
 *
 * O cliente abre a página e em 30 segundos sabe:
 *   1. Macro do dia (Ibov, S&P 500, Dólar) + leitura ("dia favorável a risco / cautela")
 *   2. Comprar hoje — top oportunidades com momentoCompra=true (todas as classes)
 *   3. Vender / reduzir hoje — sinais de venda, **priorizando ativos que ele já tem**
 *   4. Sua carteira hoje — semáforo (manter / monitorar / sair) só dos ativos do cliente
 *
 * Props:
 *   analiseCompleta : { acoesBR, fiis, acoesUS, reits } — universo todo já scoreado
 *   tickersCliente  : Map<ticker, { valorReais }> | null — null se não-cliente
 *   onAbrir         : (ativo, classe) => void
 *   atualizadoEm    : Date | null
 *   loading         : bool
 */
export default function ResumoDoDia({ analiseCompleta, tickersCliente, onAbrir, atualizadoEm, loading }) {
  const [macro, setMacro] = useState(() => {
    try { return lerCacheCotacoes()?.data || null; } catch { return null; }
  });

  useEffect(() => {
    let cancel = false;
    obterTodasAsCotacoes().then((c) => { if (!cancel && c) setMacro(c); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  // === COMPRAR HOJE: ativos com momentoCompra=true em todas as 4 classes ===
  const paraComprar = useMemo(() => {
    if (!analiseCompleta) return [];
    const todas = [];
    for (const classe of ["acoesBR", "fiis", "acoesUS", "reits"]) {
      (analiseCompleta[classe] || []).forEach((a) => {
        if (a.analise?.momentoCompra) todas.push({ ...a, _classe: classe });
      });
    }
    return todas
      .sort((a, b) => (b.analise?.score || 0) - (a.analise?.score || 0))
      .slice(0, 6);
  }, [analiseCompleta]);

  // === VENDER HOJE: sinalVenda — prioriza ativos que o cliente possui ===
  const paraVender = useMemo(() => {
    if (!analiseCompleta) return [];
    const todas = [];
    for (const classe of ["acoesBR", "fiis", "acoesUS", "reits"]) {
      (analiseCompleta[classe] || []).forEach((a) => {
        if (!a.analise?.sinalVenda) return;
        const tem = tickersCliente?.has(a.ticker);
        todas.push({ ...a, _classe: classe, _temNaCarteira: !!tem });
      });
    }
    // ordena: 1º os que estão na carteira do cliente, 2º por menor score (pior primeiro)
    return todas
      .sort((a, b) => {
        if (a._temNaCarteira !== b._temNaCarteira) return a._temNaCarteira ? -1 : 1;
        return (a.analise?.score || 0) - (b.analise?.score || 0);
      })
      .slice(0, 6);
  }, [analiseCompleta, tickersCliente]);

  // === Sua carteira hoje: status de cada ativo do cliente ===
  const minhaCarteira = useMemo(() => {
    if (!tickersCliente || tickersCliente.size === 0 || !analiseCompleta) return [];
    const lookup = {};
    for (const classe of ["acoesBR", "fiis", "acoesUS", "reits"]) {
      (analiseCompleta[classe] || []).forEach((a) => {
        if (a.ticker) lookup[a.ticker.toUpperCase()] = { ...a, _classe: classe };
      });
    }
    const out = [];
    for (const [ticker, meta] of tickersCliente.entries()) {
      const tickerUp = String(ticker).toUpperCase();
      const ativo = lookup[tickerUp];
      const score = ativo?.analise?.score ?? null;
      let status = "neutro";
      let statusLabel = "Sem dados";
      if (score != null) {
        if (ativo.analise.sinalVenda) {
          status = "sair";
          statusLabel = "Avaliar saída";
        } else if (score >= 65) {
          status = "manter";
          statusLabel = "Manter";
        } else {
          status = "monitorar";
          statusLabel = "Monitorar";
        }
      }
      out.push({
        ticker: tickerUp,
        valorReais: meta?.valorReais || 0,
        score,
        ativo,
        status,
        statusLabel,
      });
    }
    // ordena: sair primeiro, depois monitorar, depois manter, e por valor desc
    const ord = { sair: 0, monitorar: 1, manter: 2, neutro: 3 };
    return out.sort((a, b) => {
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return (b.valorReais || 0) - (a.valorReais || 0);
    });
  }, [tickersCliente, analiseCompleta]);

  const totalCarteira = useMemo(
    () => minhaCarteira.reduce((acc, x) => acc + (x.valorReais || 0), 0),
    [minhaCarteira]
  );

  // === Leitura macro (1 frase) ===
  const macroLeitura = useMemo(() => buildMacroLeitura(macro), [macro]);

  const dataHoje = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });
  const horaUpd = atualizadoEm?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const aberto = (() => { try { return mercadoAberto(); } catch { return false; } })();

  return (
    <section className="m-section m-resumo">
      <div className="m-resumo-inner">

        {/* ─── Cabeçalho ─── */}
        <header className="resumo-head">
          <div className="resumo-head-left">
            <div className="resumo-eyebrow">BRIEFING DO DIA · PORTO INVEST</div>
            <h1 className="resumo-titulo">
              O que <span className="destaque">comprar</span> e o que <span className="destaque danger">vender</span> hoje
            </h1>
            <div className="resumo-data">
              <span className="resumo-data-dia">{dataHoje}</span>
              <span className="resumo-data-sep">•</span>
              <span className={`resumo-status ${aberto ? "on" : "off"}`}>
                <span className="resumo-status-dot" />
                {aberto ? "Mercado aberto" : "Mercado fechado"}
              </span>
              {horaUpd && (
                <>
                  <span className="resumo-data-sep">•</span>
                  <span className="resumo-data-upd">Análise atualizada às {horaUpd}</span>
                </>
              )}
            </div>
          </div>
          {macroLeitura && (
            <div className={`resumo-macro-card ${macroLeitura.tom}`}>
              <div className="macro-card-eyebrow">LEITURA MACRO</div>
              <div className="macro-card-frase">{macroLeitura.frase}</div>
              <div className="macro-card-mini">
                {macroLeitura.indicadores.map((i) => (
                  <span key={i.label} className={`macro-mini ${i.dir}`}>
                    <span className="macro-mini-label">{i.label}</span>
                    <span className="macro-mini-valor">{i.valor}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </header>

        {/* ─── 2 colunas: Comprar / Vender ─── */}
        <div className="resumo-acoes">
          <CardAcao
            tipo="comprar"
            titulo="Para comprar hoje"
            sub="Ativos com 'momento de compra' confirmado pelos 7 critérios (Graham, Buffett, Lynch, Bazin, Barsi, Greenblatt, Bastter)."
            ativos={paraComprar}
            vazio={loading ? "Carregando análise…" : "Nenhum 'momento de compra' confirmado agora. Aguarde nova janela de oportunidade."}
            onAbrir={onAbrir}
            tickersCliente={tickersCliente}
          />
          <CardAcao
            tipo="vender"
            titulo="Para vender / reduzir hoje"
            sub={tickersCliente
              ? "Ativos com sinal de saída — sua carteira aparece primeiro, depois oportunidades para evitar."
              : "Ativos com sinal de saída no universo monitorado. Score abaixo de 50 (faixa Fraca/Evitar)."}
            ativos={paraVender}
            vazio={loading ? "Carregando análise…" : "Nenhum sinal de venda ativo agora. Carteira saudável neste momento."}
            onAbrir={onAbrir}
            tickersCliente={tickersCliente}
          />
        </div>

        {/* ─── Mini-tabela: Sua carteira hoje ─── */}
        {tickersCliente && minhaCarteira.length > 0 && (
          <div className="resumo-carteira">
            <div className="resumo-carteira-head">
              <div>
                <div className="resumo-eyebrow">SUA CARTEIRA · {minhaCarteira.length} ATIVOS RASTREADOS</div>
                <h2 className="resumo-carteira-titulo">Como está sua carteira hoje</h2>
              </div>
              <div className="resumo-carteira-totais">
                <Resumo
                  sair={minhaCarteira.filter((x) => x.status === "sair").length}
                  monitorar={minhaCarteira.filter((x) => x.status === "monitorar").length}
                  manter={minhaCarteira.filter((x) => x.status === "manter").length}
                />
              </div>
            </div>

            <div className="resumo-carteira-tabela">
              <div className="rct-header">
                <span>Ativo</span>
                <span>Posição</span>
                <span>Peso</span>
                <span>Score</span>
                <span className="rct-acao">Veredito</span>
              </div>
              {minhaCarteira.slice(0, 12).map((row) => {
                const peso = totalCarteira > 0 ? (row.valorReais / totalCarteira) * 100 : 0;
                return (
                  <button
                    key={row.ticker}
                    className={`rct-row status-${row.status}`}
                    onClick={() => row.ativo && onAbrir?.(row.ativo, row.ativo._classe)}
                    disabled={!row.ativo}
                    title={row.ativo ? "Ver análise completa" : "Sem dados de mercado para este ticker"}
                  >
                    <span className="rct-ticker">
                      <strong>{row.ticker}</strong>
                      {row.ativo?.nome && <em>{row.ativo.nome}</em>}
                    </span>
                    <span className="rct-valor">{formatBRL(row.valorReais)}</span>
                    <span className="rct-peso">
                      <span className="rct-peso-bar">
                        <span className="rct-peso-fill" style={{ width: `${Math.min(100, peso).toFixed(1)}%` }} />
                      </span>
                      <span className="rct-peso-num">{peso.toFixed(1)}%</span>
                    </span>
                    <span className="rct-score">
                      {row.score != null ? (
                        <span className={`score-pill score-${faixaScore(row.score)}`}>{row.score}</span>
                      ) : <em className="rct-sem">—</em>}
                    </span>
                    <span className={`rct-veredito v-${row.status}`}>
                      <span className="v-dot" />
                      {row.statusLabel}
                    </span>
                  </button>
                );
              })}
            </div>

            {minhaCarteira.length > 12 && (
              <div className="rct-mais">+ {minhaCarteira.length - 12} ativos — role para ver os ranqueamentos completos abaixo</div>
            )}
          </div>
        )}

        {/* ─── Disclaimer compacto ─── */}
        <div className="resumo-disclaimer">
          Análise quantitativa automatizada — não constitui recomendação de investimento (CVM 20). Consulte seu assessor antes de operar.
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════
// Subcomponentes
// ════════════════════════════════════════════════════════

function CardAcao({ tipo, titulo, sub, ativos, vazio, onAbrir, tickersCliente }) {
  const icone = tipo === "comprar" ? "↗" : "↘";
  return (
    <div className={`card-acao card-${tipo}`}>
      <div className="card-acao-head">
        <span className="card-acao-icone">{icone}</span>
        <div>
          <div className="card-acao-titulo">{titulo}</div>
          <div className="card-acao-sub">{sub}</div>
        </div>
        <span className="card-acao-count">{ativos.length}</span>
      </div>

      {ativos.length === 0 ? (
        <div className="card-acao-vazio">{vazio}</div>
      ) : (
        <div className="card-acao-lista">
          {ativos.map((a, i) => (
            <button
              key={`${a.ticker}-${i}`}
              className="acao-row"
              onClick={() => onAbrir?.(a, a._classe)}
              title="Clique para ver análise completa"
            >
              <span className="acao-num">{i + 1}</span>
              <div className="acao-info">
                <div className="acao-linha-1">
                  <strong className="acao-ticker">{a.ticker}</strong>
                  <span className="acao-classe">{labelClasse(a._classe)}</span>
                  {tipo === "vender" && a._temNaCarteira && (
                    <span className="acao-tag tag-tem">VOCÊ TEM</span>
                  )}
                  {tipo === "comprar" && tickersCliente?.has(a.ticker) && (
                    <span className="acao-tag tag-tem">JÁ EM CARTEIRA</span>
                  )}
                </div>
                <div className="acao-tese">{teseUmaLinha(a, tipo)}</div>
              </div>
              <div className="acao-num-direita">
                <div className="acao-preco">{formatPreco(a)}</div>
                <div className={`acao-score score-${faixaScore(a.analise?.score)}`}>
                  {a.analise?.score ?? "—"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Resumo({ sair, monitorar, manter }) {
  return (
    <div className="resumo-pills">
      <span className="resumo-pill p-sair"><span className="p-dot" />{sair} sair</span>
      <span className="resumo-pill p-monitorar"><span className="p-dot" />{monitorar} monitorar</span>
      <span className="resumo-pill p-manter"><span className="p-dot" />{manter} manter</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════

function labelClasse(c) {
  return ({ acoesBR: "Ação BR", fiis: "FII", acoesUS: "Ação US", reits: "REIT" })[c] || "";
}

function faixaScore(s) {
  if (s == null) return "vazio";
  if (s >= 80) return "excelente";
  if (s >= 65) return "boa";
  if (s >= 50) return "neutra";
  if (s >= 35) return "fraca";
  return "evitar";
}

function formatPreco(a) {
  if (a.preco == null) return "—";
  const moeda = (a._classe === "acoesUS" || a._classe === "reits") ? "$" : "R$";
  return `${moeda} ${Number(a.preco).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBRL(v) {
  if (!v || !isFinite(v)) return "R$ 0";
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(1)}k`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

function teseUmaLinha(a, tipo) {
  if (tipo === "vender") {
    const c = a.analise?.criticasVenda?.[0];
    if (c) return c;
    return `Score ${a.analise?.score}/100 — abaixo do mínimo aceitável para manter posição.`;
  }
  // comprar — extrai a melhor justificativa
  const partes = [];
  if (a.dy != null && a.dy >= 5) partes.push(`DY ${a.dy.toFixed(1)}%`);
  if (a.pl != null && a.pl > 0 && a.pl < 12) partes.push(`P/L ${a.pl.toFixed(1)}`);
  if (a.pvp != null && a.pvp < 1.3) partes.push(`P/VP ${a.pvp.toFixed(2)}`);
  if (a.roe != null && a.roe >= 15) partes.push(`ROE ${a.roe.toFixed(0)}%`);
  if (partes.length > 0) return `${partes.slice(0, 3).join(" · ")} — score ${a.analise?.score}/100 (${a.analise?.faixa}).`;
  return `Score ${a.analise?.score}/100 — momento de entrada confirmado pelos critérios de valor + qualidade.`;
}

// Constrói leitura macro de 1 frase + 3 mini-indicadores.
function buildMacroLeitura(c) {
  if (!c) return null;
  const ibov = c.ibovespa?.variacao ?? null;
  const sp   = c.sp500?.variacao ?? null;
  const usd  = c.dolar?.variacao ?? null;

  // Tom geral
  const positivos = [ibov, sp].filter((x) => x != null && x > 0.2).length;
  const negativos = [ibov, sp].filter((x) => x != null && x < -0.2).length;
  let tom = "neutro";
  let frase;
  if (positivos === 2) {
    tom = "alta";
    frase = `Bolsas globais em alta — dia favorável a tomada de risco. ${usd != null && usd < 0 ? "Dólar em queda reforça apetite por bolsa BR." : "Acompanhe o dólar para confirmar fluxo."}`;
  } else if (negativos === 2) {
    tom = "baixa";
    frase = `Bolsas em queda — dia de aversão a risco. ${usd != null && usd > 0 ? "Dólar em alta confirma fuga para proteção." : "Cautela em compras novas; espere virada técnica."}`;
  } else if (ibov != null && sp != null && ((ibov > 0.2 && sp < -0.2) || (ibov < -0.2 && sp > 0.2))) {
    tom = "misto";
    frase = `Descolamento BR vs. EUA — ${ibov > 0 ? "Brasil sobe contra fluxo externo, atenção a fatores locais (juros/política)" : "EUA sobem mas Brasil patina — checar emergentes e commodities"}.`;
  } else {
    tom = "neutro";
    frase = "Mercado de lado — sem direção clara. Ative apenas trades com forte tese fundamentalista.";
  }

  const fmt = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`;
  const dirOf = (v) => v == null ? "neutro" : v > 0 ? "alta" : v < 0 ? "baixa" : "neutro";
  const indicadores = [
    { label: "Ibov", valor: fmt(ibov), dir: dirOf(ibov) },
    { label: "S&P", valor: fmt(sp), dir: dirOf(sp) },
    { label: "Dólar", valor: fmt(usd), dir: dirOf(usd === null ? null : -usd) }, // dólar caindo = bom
  ];

  return { tom, frase, indicadores };
}
