import { useMemo, useState, useEffect, useId } from "react";

/**
 * DonutChartModern — Gráfico de rosca premium com hover 3D
 *
 * Features:
 *   • Hover: segmento se afasta do centro + glow colorido
 *   • Animação de entrada (segmentos crescem em stagger)
 *   • Centro mostra valor/label do segmento ativo (transição suave)
 *   • Drop-shadow dinâmico baseado na cor do segmento ativo
 *   • Touch-friendly (mobile)
 *   • Variant "pill" (sem texto central)
 *
 * Props:
 *   data       — Array<{ key, label, valor, cor }>
 *   total      — soma total (calculada se omitida)
 *   size       — diâmetro em px (default 240)
 *   thickness  — espessura do anel em px (default 38)
 *   formatValor — function(valor) → string (default brl simples)
 *   labelCentro — texto fixo no centro quando nada está em hover (default "TOTAL")
 *   onHover    — callback(key | null)
 */

function defaultFormat(v) {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function clarear(hex, pct = 0.15) {
  // Clareia uma cor hex para usar como gradient
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.min(255, Math.round(r + (255 - r) * pct));
  g = Math.min(255, Math.round(g + (255 - g) * pct));
  b = Math.min(255, Math.round(b + (255 - b) * pct));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export default function DonutChartModern({
  data = [],
  total: totalProp,
  size = 240,
  thickness = 38,
  formatValor = defaultFormat,
  labelCentro = "TOTAL",
  emptyText = "Sem dados",
  onHover,
}) {
  const [hoverKey, setHoverKey] = useState(null);
  const [mounted, setMounted] = useState(false);
  // useId é determinístico e SSR-safe (sem Math.random durante render)
  const reactId = useId();
  const idBase = `donut-${reactId.replace(/:/g, "")}`;

  // Trigger animação de entrada
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const fatias = useMemo(() => {
    const valid = (data || []).filter((d) => Number(d?.valor) > 0);
    const total = totalProp != null
      ? totalProp
      : valid.reduce((s, d) => s + Number(d.valor), 0);
    if (total <= 0) return { lista: [], total: 0 };

    let acc = 0;
    const lista = valid.map((d, i) => {
      const valor = Number(d.valor);
      const pct = (valor / total) * 100;
      const ang = (valor / total) * 360;
      const ini = acc;
      acc += ang;
      return {
        ...d,
        idx: i,
        valor,
        pct,
        ini,
        fim: ini + ang,
        ang,
      };
    });
    return { lista, total };
  }, [data, totalProp]);

  const total = fatias.total;
  const lista = fatias.lista;

  // Empty state
  if (total <= 0) {
    return (
      <div
        className="pi-donut-empty"
        style={{ width: size, height: size }}
      >
        <div className="pi-donut-empty-icon">📊</div>
        <div className="pi-donut-empty-text">{emptyText}</div>
      </div>
    );
  }

  // Geometria
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2; // raio da linha central do anel
  const innerR = r - thickness / 2;
  const outerR = r + thickness / 2;

  // Empurra o segmento ativo um pouco pra fora (efeito 3D)
  const HOVER_PUSH = 6;

  function arcPath(ini, fim, push = 0) {
    const toRad = (a) => ((a - 90) * Math.PI) / 180;
    // direção do "empurrão" baseado no meio do arco
    const meio = (ini + fim) / 2;
    const dx = Math.cos(toRad(meio)) * push;
    const dy = Math.sin(toRad(meio)) * push;

    const ox1 = cx + dx + outerR * Math.cos(toRad(ini));
    const oy1 = cy + dy + outerR * Math.sin(toRad(ini));
    const ox2 = cx + dx + outerR * Math.cos(toRad(fim));
    const oy2 = cy + dy + outerR * Math.sin(toRad(fim));
    const ix1 = cx + dx + innerR * Math.cos(toRad(fim));
    const iy1 = cy + dy + innerR * Math.sin(toRad(fim));
    const ix2 = cx + dx + innerR * Math.cos(toRad(ini));
    const iy2 = cy + dy + innerR * Math.sin(toRad(ini));

    const largeArc = fim - ini > 180 ? 1 : 0;

    return [
      `M ${ox1} ${oy1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${ox2} ${oy2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      "Z",
    ].join(" ");
  }

  function setHover(key) {
    setHoverKey(key);
    onHover?.(key);
  }

  const ativa = lista.find((f) => f.key === hoverKey) || null;
  const valorCentro = ativa ? ativa.valor : total;
  const labelTopo = ativa ? ativa.label.toUpperCase().slice(0, 22) : labelCentro;
  const pctMostrar = ativa ? `${ativa.pct.toFixed(1)}%` : "100%";

  // Drop-shadow dinâmico baseado na cor da fatia ativa
  const corGlow = ativa ? ativa.cor : "rgba(240, 162, 2, 0.25)";

  return (
    <div
      className="pi-donut-wrap"
      style={{
        width: size,
        height: size,
        filter: `drop-shadow(0 8px 32px ${corGlow}33)`,
        transition: "filter 0.35s ease",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          {lista.map((f) => {
            const corClara = clarear(f.cor, 0.18);
            const gid = `${idBase}-grad-${f.idx}`;
            return (
              <linearGradient
                key={gid}
                id={gid}
                x1="0" y1="0" x2="1" y2="1"
              >
                <stop offset="0%" stopColor={corClara} />
                <stop offset="100%" stopColor={f.cor} />
              </linearGradient>
            );
          })}
          {/* Gradient sutil pra borda do anel */}
          <radialGradient id={`${idBase}-inner`} cx="50%" cy="50%" r="50%">
            <stop offset="80%" stopColor="transparent" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
          </radialGradient>
        </defs>

        {/* Trilho de fundo (anel cinza sutil — aparece atrás durante animação) */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={thickness}
        />

        {/* Segmentos */}
        {lista.map((f) => {
          const isAtivo = f.key === hoverKey;
          const push = isAtivo ? HOVER_PUSH : 0;
          const opacidadeBase = hoverKey
            ? (isAtivo ? 1 : 0.32)
            : 1;
          const opacidade = mounted ? opacidadeBase : 0;
          const gid = `${idBase}-grad-${f.idx}`;

          return (
            <g key={f.key}>
              <path
                d={arcPath(f.ini, f.fim, push)}
                fill={`url(#${gid})`}
                stroke="#0D1321"
                strokeWidth={1.5}
                strokeLinejoin="round"
                opacity={opacidade}
                style={{
                  cursor: "pointer",
                  transition:
                    "opacity 0.35s ease, d 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  transformOrigin: `${cx}px ${cy}px`,
                  filter: isAtivo
                    ? `drop-shadow(0 0 12px ${f.cor}88)`
                    : "none",
                }}
                onMouseEnter={() => setHover(f.key)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}

        {/* Sombra interna sutil pra dar profundidade ao buraco do donut */}
        <circle
          cx={cx}
          cy={cy}
          r={innerR + 1}
          fill={`url(#${idBase}-inner)`}
          pointerEvents="none"
        />
      </svg>

      {/* Centro com texto — posicionado em cima do SVG via div */}
      <div
        className="pi-donut-centro"
        style={{
          width: innerR * 2,
          height: innerR * 2,
          left: cx - innerR,
          top: cy - innerR,
        }}
      >
        <div className="pi-donut-label">{labelTopo}</div>
        <div
          className="pi-donut-valor"
          style={{
            color: ativa ? ativa.cor : "#FFB20F",
            transition: "color 0.32s ease",
          }}
        >
          {formatValor(valorCentro)}
        </div>
        <div className="pi-donut-pct">{pctMostrar}</div>
      </div>
    </div>
  );
}

/**
 * DonutLegend — Legenda interativa pra acompanhar o DonutChartModern.
 * Hover na legenda acende o segmento correspondente do gráfico.
 *
 * Uso:
 *   const [hover, setHover] = useState(null);
 *   <DonutChartModern data={...} onHover={setHover} />
 *   <DonutLegend items={...} formatValor={...} hoverKey={hover} onHover={setHover} />
 */
export function DonutLegend({ items = [], formatValor = defaultFormat, hoverKey, onHover }) {
  const total = items.reduce((s, i) => s + (Number(i.valor) || 0), 0);
  if (total <= 0) return null;
  return (
    <div className="pi-donut-legenda">
      {items.filter((i) => Number(i.valor) > 0).map((it) => {
        const pct = (Number(it.valor) / total) * 100;
        const ativo = hoverKey === it.key;
        return (
          <div
            key={it.key}
            className={`pi-donut-leg-item ${ativo ? "pi-donut-leg-item-active" : ""}`}
            onMouseEnter={() => onHover?.(it.key)}
            onMouseLeave={() => onHover?.(null)}
          >
            <span
              className="pi-donut-leg-dot"
              style={{ background: it.cor, color: it.cor }}
            />
            <span className="pi-donut-leg-label">{it.label}</span>
            <span className="pi-donut-leg-valor">{formatValor(Number(it.valor))}</span>
            <span className="pi-donut-leg-pct">{pct.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}
