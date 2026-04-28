import React, { useEffect } from "react";
import TradingViewWidget from "./TradingViewWidget";
import { buildTvSymbol } from "../../constants/exchangeMap";

/**
 * Modal de detalhe do ativo — score breakdown + gráfico TradingView + justificativas + alertas.
 *
 * Props:
 *   ativo   : objeto de marketData enriquecido com .analise
 *   classe  : id da classe ("acoesBR" | "fiis" | "acoesUS" | "reits")
 *   onClose : () => void
 */
export default function AtivoModal({ ativo, classe, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!ativo) return null;

  const isBR = classe === "acoesBR" || classe === "fiis";
  // Descoberta de exchange por ticker: HD, JPM etc. são NYSE (não NASDAQ).
  const tvSymbol = buildTvSymbol(ativo.ticker, classe);

  const analise = ativo.analise || {};
  const dims = analise.dimensoes || {};
  const alertas = analise.alertas || [];
  const pontosFortes = analise.pontosFortes || [];
  const criticasVenda = analise.criticasVenda || [];

  // Preço-alvo — média dos múltiplos válidos.
  // Princípios:
  //  - P/L só vale se a empresa dá lucro (P/L > 0 e razoável).
  //  - P/VP só vale se a empresa tem ROE positivo (caso contrário, paga-se prêmio
  //    sobre patrimônio que está sendo destruído — não há base para upside).
  //  - P/VP-alvo é AJUSTADO ao ROE: empresas asset-light (bancos, seguros)
  //    têm P/VP alto por estrutura. Forçar P/VP=1,5 dá alvos absurdos para
  //    empresas como BBSE3 (ROE 90%, P/VP 6). Heurística: P/VP justo ≈ ROE/10,
  //    com mínimo 1,5 e máximo 4 para evitar extrapolação selvagem.
  //  - Quando ambos múltiplos são válidos, usamos a média (não o mínimo) para
  //    não tornar o resultado refém do múltiplo mais penalizado.
  const roePctRaw = ativo.roe == null ? null : (ativo.roe > 1 ? ativo.roe : ativo.roe * 100);
  const alvos = [];
  const plTargetMultiple = isBR ? 10 : 15;
  if (ativo.pl != null && ativo.pl > 0 && ativo.pl < 60 && ativo.preco) {
    alvos.push((ativo.preco / ativo.pl) * plTargetMultiple);
  }
  if (
    ativo.pvp != null && ativo.pvp > 0 && ativo.preco &&
    roePctRaw != null && roePctRaw > 0
  ) {
    const pvpAlvo = Math.max(1.5, Math.min(4, roePctRaw / 10));
    alvos.push((ativo.preco / ativo.pvp) * pvpAlvo);
  }
  const precoAlvo = alvos.length > 0 ? alvos.reduce((s, v) => s + v, 0) / alvos.length : null;
  const upside = precoAlvo != null && ativo.preco ? ((precoAlvo - ativo.preco) / ativo.preco) * 100 : null;

  const ehVenda = analise.sinalVenda && !analise.momentoCompra;

  return (
    <div className="ativo-modal-overlay" onClick={onClose}>
      <div className="ativo-modal" onClick={(e) => e.stopPropagation()}>
        <header className="am-header">
          <div className="am-head-left">
            <div className="am-ticker-row">
              <h2 className="am-ticker">{ativo.ticker}</h2>
              {analise.momentoCompra && <span className="badge-compra am-badge-compra">MOMENTO DE COMPRA</span>}
              {ehVenda && <span className="badge-venda am-badge-compra">SINAL DE VENDA</span>}
            </div>
            <div className="am-nome">{ativo.nomeLongo} · {ativo.setor}</div>
          </div>
          <button className="am-close" onClick={onClose} aria-label="Fechar">✕</button>
        </header>

        <div className="am-grid">
          {/* Coluna principal — gráfico + métricas */}
          <div className="am-principal">
            <div className="am-metricas">
              <Metric label="Preço"      valor={fmtMoeda(ativo.preco, ativo.moeda)} />
              <Metric label="Dia"        valor={fmtPct(ativo.variacaoDia)}    cor={corPct(ativo.variacaoDia)} />
              <Metric label="12 meses"   valor={fmtPct(ativo.variacaoAno)}    cor={corPct(ativo.variacaoAno)} />
              <Metric label="Preço-alvo" valor={fmtMoeda(precoAlvo, ativo.moeda)} destaque />
              <Metric label="Upside"     valor={fmtPct(upside)} cor={corPct(upside)} destaque />
              <Metric label={isBR ? "P/L" : "P/E"} valor={fmtNum(ativo.pl)} />
              <Metric label={isBR ? "P/VP" : "P/B"} valor={fmtNum(ativo.pvp)} />
              <Metric label={isBR ? "DY" : "Yield"} valor={ativo.dy != null ? `${fmtNum(ativo.dy)}%` : "—"} />
              <Metric label="ROE"        valor={ativo.roe != null ? `${fmtNum(ativo.roe > 1 ? ativo.roe : ativo.roe * 100)}%` : "—"} />
              <Metric label="Mín 52s"    valor={fmtMoeda(ativo.min52, ativo.moeda)} />
              <Metric label="Máx 52s"    valor={fmtMoeda(ativo.max52, ativo.moeda)} />
              <Metric label="Vol. médio" valor={ativo.volume != null ? formatarVolume(ativo.volume) : "—"} />
            </div>

            <div className="am-chart">
              <TradingViewWidget symbol={tvSymbol} altura={440} />
            </div>
          </div>

          {/* Coluna lateral — score breakdown + justificativas + alertas */}
          <aside className="am-lateral">
            <div className="am-score-box">
              <div className="am-score-titulo">Score de Qualidade</div>
              <div className="am-score-num">{analise.score ?? "—"}<span>/100</span></div>
              <div className={`am-score-faixa faixa-${(analise.faixa || "neutra").toLowerCase()}`}>
                {analise.faixa || "—"}
              </div>
            </div>

            <div className="am-dims">
              <DimBar label="Valor"       nota={dims.valor} />
              <DimBar label="Qualidade"   nota={dims.qualidade} />
              <DimBar label="Dividendos"  nota={dims.dividendos} />
              <DimBar label="Crescimento" nota={dims.crescimento} />
              <DimBar label="Momentum"    nota={dims.momentum} />
            </div>

            {alertas.length > 0 && (
              <div className="am-alertas">
                <div className="am-lateral-titulo">Alertas</div>
                {alertas.map((al, i) => (
                  <div key={i} className={`am-alerta tipo-${al.tipo}`}>
                    <span className="am-alerta-dot" /> {al.msg}
                  </div>
                ))}
              </div>
            )}

            <div className="am-justificativas">
              <div className="am-lateral-titulo">Detalhes dos critérios</div>
              <ul>
                {(analise.justificativas || []).map((j, i) => (
                  <li key={i}>{j}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        {/* Razões full-width: POR QUE COMPRAR (pontos fortes) OU POR QUE SAIR (críticas).
            Posicionado fora do grid principal para ocupar toda a largura do modal,
            dando espaço para o cliente ler as justificativas detalhadas com calma. */}
        {(ehVenda && criticasVenda.length > 0) || (!ehVenda && pontosFortes.length > 0) ? (
          <div className="am-razoes-full">
            {ehVenda && criticasVenda.length > 0 && (
              <div className="am-razoes am-razoes-venda">
                <div className="am-razoes-titulo">🔻 Por que considerar sair</div>
                <ul>
                  {criticasVenda.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {!ehVenda && pontosFortes.length > 0 && (
              <div className="am-razoes am-razoes-compra">
                <div className="am-razoes-titulo">✓ Pontos fortes identificados</div>
                <ul>
                  {pontosFortes.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        <footer className="am-footer">
          Análise automatizada com base em fundamentos e preços públicos.
          Preço-alvo é referência didática — média entre P/L-alvo (10 BR / 15 US) e P/VP-alvo
          ajustado pelo ROE (P/VP justo ≈ ROE/10, mín 1,5 e máx 4); descartado quando a empresa
          está sem lucro ou com ROE negativo.
          Não constitui recomendação de investimento (CVM nº 20/2021).
        </footer>
      </div>
    </div>
  );
}

function formatarVolume(v) {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(v);
}

function Metric({ label, valor, cor, destaque }) {
  return (
    <div className={`am-metric ${destaque ? "am-metric-destaque" : ""}`}>
      <div className="am-metric-label">{label}</div>
      <div className="am-metric-val" style={cor ? { color: cor } : {}}>{valor}</div>
    </div>
  );
}

function DimBar({ label, nota = 0 }) {
  const pct = Math.min(100, (nota / 20) * 100);
  const cor = nota >= 16 ? "#22c55e" : nota >= 10 ? "#F0A202" : "#ef4444";
  return (
    <div className="am-dim">
      <div className="am-dim-label">
        <span>{label}</span>
        <span className="am-dim-nota">{nota}/20</span>
      </div>
      <div className="am-dim-track">
        <div className="am-dim-fill" style={{ width: `${pct}%`, background: cor }} />
      </div>
    </div>
  );
}

function fmtMoeda(v, moeda = "BRL") {
  if (v == null) return "—";
  return moeda === "BRL"
    ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(v) { return v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fmtNum(v) { return v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }
function corPct(v) { return v == null ? "#748CAB" : v >= 0 ? "#22c55e" : "#ef4444"; }
