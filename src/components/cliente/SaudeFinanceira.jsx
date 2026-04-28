import { brl } from "../../utils/currency";

/**
 * SaudeFinanceira — Card "Aporte necessário para seus objetivos"
 *
 * Layout: donut animado à esquerda + lista de métricas à direita.
 * Em mobile, donut centralizado em cima e lista abaixo.
 *
 * Faixas (cumprimento = aporteReal/aporteNecessario):
 *   ≥100% verde · 70-99% âmbar · <70% vermelho
 */
export default function SaudeFinanceira({
  rendaMensal,
  gastosMensais,
  aporteNecessario,
  aporteReal,
}) {
  const real = Math.max(0, Number(aporteReal) || 0);
  const necessario = Math.max(0, Number(aporteNecessario) || 0);
  const renda = Number(rendaMensal) || 0;
  const gastos = Number(gastosMensais) || 0;

  // Estado vazio: sem objetivos com aporte mensal cadastrado
  if (necessario <= 0) {
    return (
      <div className="saude-card saude-card-vazio">
        <div className="saude-eyebrow">
          <span className="saude-spark" />
          Aporte necessário para seus objetivos
        </div>
        <div className="saude-vazio-titulo">Defina seus objetivos.</div>
        <div className="saude-vazio-sub">
          <p>Cadastre objetivos com aporte mensal (aposentadoria, reserva, casa) para ver seu plano.</p>
          <p>Assim a gente calcula quanto você precisa guardar todo mês.</p>
        </div>
      </div>
    );
  }

  const pctCumprido = Math.min(100, (real / necessario) * 100);
  const gap = Math.max(0, necessario - real);
  const sobra = renda > 0 && gastos > 0 ? renda - gastos : null;

  const faixa = pctCumprido >= 100 ? "ok" : pctCumprido >= 70 ? "atencao" : "baixa";

  const cores = {
    ok: {
      txt: "#86efac",
      hero: "#a7f3d0",
      bg: "linear-gradient(135deg, rgba(0,204,102,0.10) 0%, rgba(13,19,33,0.55) 100%)",
      border: "rgba(0,204,102,0.30)",
      ring: "#00CC66",
      ringSoft: "rgba(0,204,102,0.55)",
      glow: "rgba(0,204,102,0.18)",
    },
    atencao: {
      txt: "#fcd34d",
      hero: "#fde68a",
      bg: "linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(13,19,33,0.55) 100%)",
      border: "rgba(245,158,11,0.32)",
      ring: "#f59e0b",
      ringSoft: "rgba(245,158,11,0.55)",
      glow: "rgba(245,158,11,0.18)",
    },
    baixa: {
      txt: "#fca5a5",
      hero: "#fecaca",
      bg: "linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(13,19,33,0.55) 100%)",
      border: "rgba(239,68,68,0.32)",
      ring: "#ef4444",
      ringSoft: "rgba(239,68,68,0.55)",
      glow: "rgba(239,68,68,0.18)",
    },
  };
  const c = cores[faixa];

  // Mensagens em frases curtas, uma por linha (sem travessão).
  let mensagem;
  if (real >= necessario) {
    mensagem = ["Você está no ritmo dos seus objetivos.", "Continue assim e a meta chega antes do prazo."];
  } else if (sobra != null && sobra >= gap) {
    mensagem = [
      `Faltam ${brl(gap)} por mês para bater a meta.`,
      "Você tem essa folga no orçamento.",
      "Basta direcionar o valor pro aporte.",
    ];
  } else if (sobra != null && sobra < gap && gastos > 0) {
    const cortePct = Math.min(100, Math.ceil(((gap - Math.max(0, sobra)) / gastos) * 100));
    mensagem = [
      `Faltam ${brl(gap)} por mês para bater a meta.`,
      `Reduza seus gastos em ~${cortePct}% para alcançar seus objetivos.`,
    ];
  } else {
    mensagem = [`Faltam ${brl(gap)} por mês para bater a meta dos objetivos.`];
  }

  // Donut: raio 42, circunferência ≈ 263.89
  const R = 42;
  const CIRC = 2 * Math.PI * R;
  const dash = (pctCumprido / 100) * CIRC;
  const gradId = `saudeGrad-${faixa}`;

  return (
    <div className="saude-card" style={{ background: c.bg, borderColor: c.border, boxShadow: `0 4px 24px ${c.glow}` }}>
      <div className="saude-glow" style={{ background: `radial-gradient(circle at 18% 50%, ${c.glow} 0%, transparent 60%)` }} />

      <div className="saude-eyebrow">
        <span className="saude-spark" style={{ background: c.ring }} />
        Aporte necessário para seus objetivos
      </div>

      <div className="saude-grid">
        {/* Donut */}
        <div className="saude-donut-wrap">
          <svg viewBox="0 0 100 100" className="saude-donut" aria-hidden="true">
            <defs>
              <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={c.ringSoft} />
                <stop offset="100%" stopColor={c.ring} />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRC}`}
              transform="rotate(-90 50 50)"
              className="saude-donut-progress"
            />
          </svg>
          <div className="saude-donut-center">
            <div className="saude-donut-pct" style={{ color: c.hero }}>
              {pctCumprido.toFixed(0)}<span>%</span>
            </div>
            <div className="saude-donut-label">cumprido</div>
          </div>
        </div>

        {/* Métricas */}
        <ul className="saude-lista">
          <li className="saude-lista-item saude-lista-hero">
            <span className="saude-lista-key">Necessário</span>
            <span className="saude-lista-val saude-lista-val-hero" style={{ color: c.hero }}>
              {brl(necessario)}<span className="saude-lista-suffix">/mês</span>
            </span>
          </li>
          <li className="saude-lista-item">
            <span className="saude-lista-key">Aportado este mês</span>
            <span className="saude-lista-val">
              {brl(real)}<span className="saude-lista-suffix">/mês</span>
            </span>
          </li>
          {renda > 0 && (
            <li className="saude-lista-item">
              <span className="saude-lista-key">Renda declarada</span>
              <span className="saude-lista-val">
                {brl(renda)}<span className="saude-lista-suffix">/mês</span>
              </span>
            </li>
          )}
          {gastos > 0 && (
            <li className="saude-lista-item">
              <span className="saude-lista-key">Gastos declarados</span>
              <span className="saude-lista-val">
                {brl(gastos)}<span className="saude-lista-suffix">/mês</span>
              </span>
            </li>
          )}
        </ul>
      </div>

      <div className="saude-alerta" style={{ color: c.txt, borderColor: c.border, background: `linear-gradient(180deg, ${c.glow} 0%, transparent 100%)` }}>
        {mensagem.map((linha, i) => (
          <p key={i} className="saude-alerta-linha">{linha}</p>
        ))}
      </div>
    </div>
  );
}
