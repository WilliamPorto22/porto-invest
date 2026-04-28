import React from "react";

/**
 * Widget "Maiores Altas e Baixas" — layout da imagem de referência.
 * Sempre renderiza exatamente `rows` linhas de cada lado (pad com "—" se faltar).
 *
 * Props:
 *   titulo, subtitulo
 *   ancoras        : { esq: "10 MAIORES ALTAS", dir: "10 MAIORES BAIXAS" }
 *   altas, baixas  : arrays [{ ticker, variacao }]
 *   rows           : quantidade fixa de linhas (default 10)
 *   rodape, rodapeRight
 */
export default function MaioresAltasWidget({
  titulo,
  subtitulo,
  ancoras = { esq: "10 MAIORES ALTAS", dir: "10 MAIORES BAIXAS" },
  altas = [],
  baixas = [],
  rows = 10,
  rodape = "PORTO INVEST · Não constitui recomendação de investimento",
  rodapeRight,
}) {
  // Garante sempre `rows` linhas preenchendo com placeholder.
  const padLista = (lista) => {
    const out = [...lista];
    while (out.length < rows) out.push({ ticker: "—", variacao: null, _placeholder: true });
    return out.slice(0, rows);
  };
  const altasPad  = padLista(altas);
  const baixasPad = padLista(baixas);

  const maxAlta  = Math.max(1, ...altas.map((a) => Math.abs(a.variacao || 0)));
  const maxBaixa = Math.max(1, ...baixas.map((a) => Math.abs(a.variacao || 0)));

  const linha = (item, idx, lado) => {
    const valor = item.variacao;
    const placeholder = item._placeholder || valor == null;
    const max = lado === "alta" ? maxAlta : maxBaixa;
    const pct = placeholder ? 0 : Math.min(100, (Math.abs(valor) / max) * 100);
    const cor = lado === "alta" ? "#22c55e" : "#ef4444";
    const signo = !placeholder && valor > 0 ? "+" : "";
    const valorStr = placeholder ? "—" : `${signo}${valor.toFixed(2)}%`;
    const idxStr = String(idx + 1).padStart(2, "0");

    if (lado === "alta") {
      return (
        <div key={`alta-${idx}`} className={`altas-linha alta ${placeholder ? "placeholder" : ""}`}>
          <div className="altas-idx">{idxStr}</div>
          <div className="altas-ticker">{item.ticker}</div>
          <div className="altas-barra-wrap">
            <div className="altas-barra" style={{ width: `${pct}%`, background: cor }} />
          </div>
          <div className="altas-valor" style={{ color: placeholder ? "#3E5C76" : cor }}>
            {valorStr}
          </div>
        </div>
      );
    }
    return (
      <div key={`baixa-${idx}`} className={`altas-linha baixa ${placeholder ? "placeholder" : ""}`}>
        <div className="altas-valor" style={{ color: placeholder ? "#3E5C76" : cor, textAlign: "right" }}>
          {valorStr}
        </div>
        <div className="altas-barra-wrap reverse">
          <div className="altas-barra" style={{ width: `${pct}%`, background: cor }} />
        </div>
        <div className="altas-ticker right">{item.ticker}</div>
        <div className="altas-idx right">{idxStr}</div>
      </div>
    );
  };

  return (
    <div className="altas-widget">
      <div className="altas-header">
        <div className="altas-subtitulo">{subtitulo}</div>
        <div className="altas-titulo">
          {titulo?.split(" ").slice(0, -1).join(" ")}{" "}
          <span className="altas-titulo-destaque">{titulo?.split(" ").pop()}</span>
        </div>
      </div>

      <div className="altas-ancoras">
        <div className="altas-ancora esq">
          <span className="altas-dot alta" /> {ancoras.esq}
        </div>
        <div className="altas-ancora dir">
          {ancoras.dir} <span className="altas-dot baixa" />
        </div>
      </div>

      <div className="altas-grid">
        <div className="altas-col esq">
          {altasPad.map((a, i) => linha(a, i, "alta"))}
        </div>
        <div className="altas-col dir">
          {baixasPad.map((a, i) => linha(a, i, "baixa"))}
        </div>
      </div>

      <div className="altas-rodape">
        <span>{rodape}</span>
        {rodapeRight && <span>{rodapeRight}</span>}
      </div>
    </div>
  );
}
