// Card hero do topo do Fluxo Mensal.
// Exibe Ganha, Gasta, Sobra com gradiente animado, barra de saude
// e ring com score 0 a 100.
import React, { useEffect, useRef } from "react";
import { brl as brlUtil } from "../../utils/currency";
import { calcularScoreFinanceiro, FAIXA_LABEL, FAIXA_COR } from "../../utils/scoreFinanceiro";

// Anima um numero de start ate end em duration ms.
function useAnimatedNumber(value, duration = 600) {
  const ref = useRef(null);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    if (start === end || !ref.current) return;
    const t0 = performance.now();
    let raf;
    function tick(now) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = start + (end - start) * eased;
      if (ref.current) ref.current.textContent = brlUtil(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = end;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return ref;
}

// Anima um numero inteiro simples.
function useAnimatedInt(value, duration = 600) {
  const ref = useRef(null);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    if (start === end || !ref.current) return;
    const t0 = performance.now();
    let raf;
    function tick(now) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = Math.round(start + (end - start) * eased);
      if (ref.current) ref.current.textContent = String(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = end;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return ref;
}

function ScoreRing({ score, faixa }) {
  const refNum = useAnimatedInt(score);
  const cor = FAIXA_COR[faixa] || FAIXA_COR.indefinido;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.max(0, Math.min(100, score)) / 100) * circ;
  return (
    <div className="pi-hero-score__ring" aria-label={`Score ${score} de 100`}>
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} stroke="rgba(255,255,255,0.08)" />
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke={cor}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        />
      </svg>
      <div className="pi-hero-score__num" style={{ color: cor }} ref={refNum}>
        {score}
      </div>
    </div>
  );
}

function hintForFaixa(faixa, txPoupanca) {
  switch (faixa) {
    case "excelente":
      return "Otima margem de poupanca. Bora investir.";
    case "boa":
      return `Voce guarda ${txPoupanca}% da renda. Caminho certo.`;
    case "atencao":
      return "Margem apertada. Veja onde cortar.";
    case "critica":
      return "Gastos comprometendo a renda. Revise as categorias.";
    default:
      return "Informe sua renda pra calcular o score.";
  }
}

export default function HeroFluxoCard({
  renda,
  gastos,
  sobra,
  txPoupanca,
  totalCategorias = 0,
  categoriasPreenchidas = 0,
}) {
  const refRenda = useAnimatedNumber(renda);
  const refGastos = useAnimatedNumber(gastos);
  const refSobra = useAnimatedNumber(sobra);

  const pctGasto = renda > 0 ? Math.min(100, Math.round((gastos / renda) * 100)) : 0;
  const sobraPositiva = sobra >= 0;
  const corSobra = sobraPositiva ? "#34d399" : "#f59e0b";

  const corBarra =
    pctGasto < 60 ? "#34d399" : pctGasto < 80 ? "#fbbf24" : "#ef4444";

  const { score, faixa } = calcularScoreFinanceiro({
    renda,
    gastos,
    sobra,
    totalCategorias,
    categoriasPreenchidas,
  });

  return (
    <div className="pi-hero-card">
      <div className="pi-hero-glow" aria-hidden />

      <div className="pi-hero-grid">
        <div className="pi-hero-cell">
          <div className="pi-hero-label" style={{ color: "rgba(52,211,153,0.85)" }}>
            <span className="pi-dot" style={{ background: "#34d399" }} /> Ganha
          </div>
          <div className="pi-hero-value" style={{ color: "#34d399" }} ref={refRenda}>
            {brlUtil(renda)}
          </div>
        </div>

        <div className="pi-hero-divider" aria-hidden />

        <div className="pi-hero-cell">
          <div className="pi-hero-label" style={{ color: "rgba(248,113,113,0.85)" }}>
            <span className="pi-dot" style={{ background: "#f87171" }} /> Gasta
          </div>
          <div className="pi-hero-value" style={{ color: "#f87171" }} ref={refGastos}>
            {brlUtil(gastos)}
          </div>
        </div>

        <div className="pi-hero-divider" aria-hidden />

        <div className="pi-hero-cell">
          <div className="pi-hero-label" style={{ color: `${corSobra}d9` }}>
            <span className="pi-dot" style={{ background: corSobra }} /> Sobra
          </div>
          <div className="pi-hero-value" style={{ color: corSobra }} ref={refSobra}>
            {brlUtil(sobra)}
          </div>
          {renda > 0 && (
            <div className="pi-hero-sub" style={{ color: corSobra, opacity: 0.7 }}>
              {txPoupanca}% guardado
            </div>
          )}
        </div>
      </div>

      {renda > 0 && (
        <div className="pi-hero-bar-wrap">
          <div className="pi-hero-bar-track">
            <div
              className="pi-hero-bar-fill"
              style={{
                width: `${pctGasto}%`,
                background: `linear-gradient(90deg, ${corBarra}66, ${corBarra})`,
              }}
            />
          </div>
          <div className="pi-hero-bar-cap">
            {pctGasto}% da renda comprometida
          </div>
        </div>
      )}

      {renda > 0 && (
        <div className="pi-hero-score">
          <ScoreRing score={score} faixa={faixa} />
          <div className="pi-hero-score__txt">
            <div className="pi-hero-score__label">Sua saude financeira</div>
            <div className="pi-hero-score__faixa" style={{ color: FAIXA_COR[faixa] }}>
              {FAIXA_LABEL[faixa]}
            </div>
            <div className="pi-hero-score__hint">{hintForFaixa(faixa, txPoupanca)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
