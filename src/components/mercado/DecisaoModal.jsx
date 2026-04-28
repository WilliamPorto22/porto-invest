import React, { useEffect } from "react";
import { GLOSSARIO } from "../../constants/glossarioIndicadores";

/**
 * Modal de explicação da decisão (compra/venda). Mostra:
 *   - Justificativa consolidada
 *   - Pontos fortes (indicadores positivos)
 *   - Pontos de atenção (indicadores negativos)
 *   - Riscos macroeconômicos relevantes
 *
 * Props:
 *   ativo
 *   analise : resultado de analisarAtivo() — { score, faixa, sinal, indicadores, alerta }
 *   classe
 *   onClose
 */
export default function DecisaoModal({ ativo, analise, classe, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!ativo || !analise) return null;

  const ehCompra = analise.sinal === "compra";
  const ehVenda = analise.sinal === "venda";

  const positivos = Object.entries(analise.indicadores).filter(([, v]) => v.status === "positivo");
  const negativos = Object.entries(analise.indicadores).filter(([, v]) => v.status === "negativo");
  const neutros   = Object.entries(analise.indicadores).filter(([, v]) => v.status === "neutro");
  const semDado   = Object.entries(analise.indicadores).filter(([, v]) => v.status === "sem-dado");

  const riscosMacro = gerarRiscosMacro(ativo, classe);

  return (
    <div className="dm-overlay" onClick={onClose}>
      <div className="dm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="dm-header">
          <div className="dm-head-left">
            <h2 className="dm-ticker">{ativo.ticker}</h2>
            <div className="dm-nome">{ativo.nomeLongo || ativo.nome} · {ativo.setor}</div>
          </div>
          <div className={`dm-sinal ${ehCompra ? "sinal-compra" : ehVenda ? "sinal-venda" : "sinal-neutro"}`}>
            {ehCompra ? "🟢 COMPRA" : ehVenda ? "🔴 VENDA" : "🟡 NEUTRO"}
            <span className="dm-score">Score {analise.score}/100 · {analise.faixa}</span>
          </div>
          <button className="dm-close" onClick={onClose} aria-label="Fechar">✕</button>
        </header>

        <div className="dm-body">
          {/* Justificativa */}
          <div className="dm-secao">
            <div className="dm-titulo-secao">Justificativa</div>
            <div className="dm-justif">
              {ehCompra
                ? `${ativo.ticker} apresenta score ${analise.score}/100 baseado em ${positivos.length} indicadores positivos e apenas ${negativos.length} negativos. A combinação de valuation, qualidade e dividendos oferece margem de segurança acima da média do mercado.`
                : ehVenda
                ? `${ativo.ticker} apresenta score ${analise.score}/100 com ${negativos.length} indicadores negativos vs. ${positivos.length} positivos. Múltiplas dimensões fracas simultâneas (valor, qualidade ou momentum) sinalizam deterioração estrutural ou sobrevalorização.`
                : `${ativo.ticker} apresenta score ${analise.score}/100 — sem destaque nem preocupação forte. Posição neutra, monitorar evolução dos indicadores antes de agir.`}
            </div>
          </div>

          {/* Alerta de inconsistência */}
          {analise.alerta && (
            <div className="dm-alerta">
              ⚠ <strong>Inconsistência:</strong> {analise.alerta}
            </div>
          )}

          {/* Pontos fortes */}
          {positivos.length > 0 && (
            <div className="dm-secao dm-secao-fortes">
              <div className="dm-titulo-secao">✓ Pontos fortes ({positivos.length})</div>
              <ul className="dm-lista">
                {positivos.map(([key, v]) => (
                  <li key={key}>
                    <span className="dm-key">{GLOSSARIO[key]?.abrev || key}</span>
                    <span className="dm-valor">{formatarValor(key, v.valor)}</span>
                    <span className="dm-coment">{v.comentario}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pontos de atenção */}
          {negativos.length > 0 && (
            <div className="dm-secao dm-secao-fracos">
              <div className="dm-titulo-secao">⚠ Pontos de atenção ({negativos.length})</div>
              <ul className="dm-lista">
                {negativos.map(([key, v]) => (
                  <li key={key}>
                    <span className="dm-key">{GLOSSARIO[key]?.abrev || key}</span>
                    <span className="dm-valor">{formatarValor(key, v.valor)}</span>
                    <span className="dm-coment">{v.comentario}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Neutros */}
          {neutros.length > 0 && (
            <div className="dm-secao dm-secao-neutros">
              <div className="dm-titulo-secao">◆ Indicadores neutros ({neutros.length})</div>
              <ul className="dm-lista">
                {neutros.map(([key, v]) => (
                  <li key={key}>
                    <span className="dm-key">{GLOSSARIO[key]?.abrev || key}</span>
                    <span className="dm-valor">{formatarValor(key, v.valor)}</span>
                    <span className="dm-coment">{v.comentario}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sem dado */}
          {semDado.length > 0 && (
            <div className="dm-secao dm-secao-ndado">
              <div className="dm-titulo-secao">○ Sem dado disponível ({semDado.length})</div>
              <div className="dm-ndado-list">
                {semDado.map(([key]) => GLOSSARIO[key]?.abrev || key).join(" · ")}
              </div>
              <div className="dm-ndado-obs">
                Esses indicadores não foram retornados pelas fontes automáticas. Para análise completa, consulte o relatório trimestral do ativo no site de RI.
              </div>
            </div>
          )}

          {/* Riscos macro */}
          <div className="dm-secao dm-secao-macro">
            <div className="dm-titulo-secao">🌎 Riscos macroeconômicos relevantes</div>
            <ul className="dm-lista dm-lista-macro">
              {riscosMacro.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>

        <footer className="dm-footer">
          Recomendação gerada automaticamente a partir de indicadores públicos. Consistência &gt; indicador isolado — valide
          sempre com sua tese de investimento e contexto setorial. <strong>Não constitui recomendação CVM nº 20/2021.</strong>
        </footer>
      </div>
    </div>
  );
}

function formatarValor(key, valor) {
  if (valor == null || !Number.isFinite(valor)) return "N/D";
  const unidade = GLOSSARIO[key]?.unidade || "";
  if (unidade === "%") return `${valor.toFixed(1)}%`;
  if (unidade === "x" || unidade === "anos") return valor.toFixed(2);
  return valor.toFixed(2);
}

// Gera riscos macro contextuais dependendo do ativo/classe.
function gerarRiscosMacro(ativo, classe) {
  const riscos = [];
  const ehBR = classe === "acoesBR" || classe === "fiis";
  const ehFii = classe === "fiis" || classe === "reits";
  const setor = (ativo.setor || "").toLowerCase();

  if (ehBR) {
    riscos.push("Selic elevada impacta múltiplos de ações brasileiras e pressiona FIIs (renda fixa concorrente).");
    riscos.push("Câmbio BRL/USD — empresas exportadoras se beneficiam; importadoras sofrem pressão de margem.");
  } else {
    riscos.push("Política do FED sobre juros — ações de crescimento são mais sensíveis a mudanças nas taxas longas.");
    riscos.push("Risco Brasil e câmbio BRL/USD afetam rentabilidade em R$ para investidor brasileiro.");
  }

  if (ehFii) {
    riscos.push("Ciclo imobiliário e vacância setorial — logística segue forte; lajes corporativas enfrentam excesso de oferta.");
    riscos.push("Alavancagem via CRI — em ciclos de juros altos, o custo da dívida pode superar o cap rate dos imóveis.");
  }

  if (setor.includes("petr") || setor.includes("óleo") || setor.includes("oil")) {
    riscos.push("Preço do petróleo — volatilidade global afeta margens. Monitorar Brent e spreads.");
  }
  if (setor.includes("banc")) {
    riscos.push("Inadimplência e spread bancário — ciclos de crédito determinam lucratividade.");
  }
  if (setor.includes("tech") || setor.includes("software")) {
    riscos.push("Múltiplos elevados são sensíveis à taxa longa — correções pontuais em anúncios do FED.");
  }
  if (setor.includes("varejo") || setor.includes("retail") || setor.includes("consumo")) {
    riscos.push("Confiança do consumidor e emprego — ciclo de consumo direto vs. recessão.");
  }

  if (ativo.variacaoAno != null && ativo.variacaoAno < -15) {
    riscos.push(`Ativo já caiu ${ativo.variacaoAno.toFixed(0)}% em 12 meses — verificar se é oportunidade de recuperação ou continuidade da tendência.`);
  }

  return riscos.slice(0, 6);
}
