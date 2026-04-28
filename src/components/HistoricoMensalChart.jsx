// ══════════════════════════════════════════════════════════════
// HistoricoMensalChart
// Gráfico de evolução mês a mês (estilo Itaú): linha curva com
// cor por segmento (verde sobe / vermelho cai), área dourada,
// cards clicáveis abaixo. Componente genérico, recebe items.
//
// items = [{ mesRef: "2026-04", valor: 197575.81, rentMes: 1.13, meta: any }, ...]
//   - mesRef:  YYYY-MM (chave do mês)
//   - valor:   número exibido no card e usado pra plotar a linha
//   - rentMes: opcional, mostrado no card como pct (verde/vermelho)
//   - meta:    qualquer payload extra; passado de volta no onSelect
//
// items pode vir em qualquer ordem; o componente reordena cronológica.
// ══════════════════════════════════════════════════════════════

import { T } from "../theme";
import { brl, brlCompact } from "../utils/currency";
import { formatarMesRef } from "../services/snapshotsCarteira";

const noSel = { userSelect: "none", WebkitUserSelect: "none" };

export default function HistoricoMensalChart({
  items,
  onSelect,
  legenda,
  descricao = 'Cada importação de PDF mensal vira uma "foto" da carteira. Clique em um mês para abrir o detalhe completo.',
  formatValor = brlCompact,
  formatValorTooltip = brl,
  destacarUltimo = true,
}) {
  if (!Array.isArray(items) || items.length === 0) return null;

  // Ordena cronologicamente (mais antigo → mais recente)
  const itens = [...items].sort((a, b) => String(a.mesRef).localeCompare(String(b.mesRef)));

  const valores = itens.map((i) => Number(i.valor) || 0);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Se a variação for muito pequena, força um range mínimo pra linha não ficar plana
  const range = (max - min) || Math.max(1, Math.abs(max) * 0.05);

  // Layout
  const cardW = 140;
  const totalW = Math.max(itens.length * cardW, 360);
  const chartH = 96;
  const padY = 18;
  const padX = cardW / 2;

  // Posicionamento de cada ponto
  const pontos = itens.map((it, i) => ({
    x: i * cardW + padX,
    y: padY + (1 - (valores[i] - min) / range) * (chartH - padY * 2),
    valor: valores[i],
    item: it,
  }));

  // Caminho fechado pra área embaixo da curva (usado pelo gradiente)
  let pathBase = `M ${pontos[0].x},${pontos[0].y}`;
  for (let i = 1; i < pontos.length; i++) {
    const p0 = pontos[i - 1];
    const p1 = pontos[i];
    const cx = p0.x + (p1.x - p0.x) / 2;
    pathBase += ` C ${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`;
  }
  const pathArea = `${pathBase} L ${pontos[pontos.length - 1].x},${chartH} L ${pontos[0].x},${chartH} Z`;

  const idxAtual = pontos.length - 1;
  const corSegmento = (a, b) => (b >= a ? "#22c55e" : "#ef4444");

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: `0.5px solid ${T.border}`,
      borderRadius: T.radiusLg,
      padding: "20px 18px 18px",
      marginBottom: 22,
    }}>
      {descricao && (
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14, lineHeight: 1.6, ...noSel }}>
          {descricao}
        </div>
      )}

      <div className="pi-scroll-x" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 4 }}>
        <div style={{ position: "relative", width: totalW, height: chartH + 110 }}>

          {/* Header: nome do mês */}
          <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: totalW, height: 30 }}>
            {itens.map((it, i) => {
              const isUltimo = destacarUltimo && i === idxAtual;
              const label = formatarMesRef(it.mesRef);
              const [mes, ano] = label.split("/");
              return (
                <div key={it.mesRef} style={{
                  width: cardW, textAlign: "center",
                  fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                  color: isUltimo ? T.gold : T.textMuted,
                  fontWeight: isUltimo ? 600 : 400,
                  ...noSel,
                }}>
                  {mes}
                  <span style={{ opacity: 0.6, marginLeft: 4 }}>{ano}</span>
                </div>
              );
            })}
          </div>

          {/* SVG: linha + área */}
          <svg
            width={totalW}
            height={chartH}
            style={{ position: "absolute", top: 32, left: 0, overflow: "visible" }}
          >
            <defs>
              <linearGradient id="histAreaGold" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#F0A202" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#F0A202" stopOpacity="0" />
              </linearGradient>
            </defs>

            <path d={pathArea} fill="url(#histAreaGold)" />

            {pontos.slice(1).map((p, i) => {
              const prev = pontos[i];
              const cor = corSegmento(prev.valor, p.valor);
              const cx = prev.x + (p.x - prev.x) / 2;
              const seg = `M ${prev.x},${prev.y} C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
              return (
                <path
                  key={i}
                  d={seg}
                  fill="none"
                  stroke={cor}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              );
            })}

            {pontos.map((p, i) => {
              const isUltimo = destacarUltimo && i === idxAtual;
              const cor = isUltimo
                ? T.gold
                : (i > 0 ? corSegmento(pontos[i - 1].valor, p.valor) : "#22c55e");
              return (
                <g key={i}>
                  {isUltimo && <circle cx={p.x} cy={p.y} r="9" fill={cor} opacity="0.18" />}
                  <circle
                    cx={p.x} cy={p.y}
                    r={isUltimo ? 6 : 5}
                    fill={isUltimo ? "#0f1620" : cor}
                    stroke={cor}
                    strokeWidth={isUltimo ? 2.5 : 2}
                  />
                  <title>{formatValorTooltip(p.valor)}</title>
                </g>
              );
            })}
          </svg>

          {/* Cards clicáveis embaixo */}
          <div style={{ display: "flex", position: "absolute", top: chartH + 36, left: 0, width: totalW, gap: 0 }}>
            {itens.map((it, i) => {
              const isUltimo = destacarUltimo && i === idxAtual;
              const rentN = Number(it.rentMes);
              const temRent = !isNaN(rentN) && it.rentMes != null;
              const corRent = !temRent ? T.textMuted : (rentN > 0 ? "#22c55e" : rentN < 0 ? "#ef4444" : T.textMuted);
              const valor = valores[i];
              const valorPrev = i > 0 ? valores[i - 1] : null;
              const variacao = valorPrev != null ? ((valor - valorPrev) / Math.max(1, Math.abs(valorPrev))) * 100 : null;

              return (
                <button
                  key={it.mesRef}
                  onClick={() => onSelect && onSelect(it)}
                  className={isUltimo ? "pi-hist-card-atual" : "pi-hist-card-passado"}
                  style={{
                    width: cardW - 8,
                    margin: "0 4px",
                    border: `0.5px solid ${isUltimo ? T.goldBorder : T.border}`,
                    borderRadius: T.radiusMd,
                    padding: "10px 10px 12px",
                    cursor: onSelect ? "pointer" : "default",
                    fontFamily: T.fontFamily,
                    textAlign: "center",
                    transition: "border-color 0.15s, background 0.15s, transform 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!onSelect) return;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    if (!onSelect) return;
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div style={{
                    fontSize: 14, color: isUltimo ? T.gold : T.textPrimary,
                    fontWeight: 500, fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.01em", marginBottom: 4,
                  }}>
                    {formatValor(valor)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                    {temRent && (
                      <span style={{ fontSize: 10, color: corRent, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                        {rentN > 0 ? "+" : ""}{rentN.toFixed(2)}%
                      </span>
                    )}
                    {variacao != null && Math.abs(variacao) >= 0.01 && (
                      <span style={{
                        fontSize: 9,
                        color: variacao >= 0 ? "#22c55e" : "#ef4444",
                        opacity: 0.7,
                        ...noSel,
                      }}>
                        {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {/* Badges secundários — aporte (roxo) e rendimentos (verde) */}
                  {(it.aporte != null && Number(it.aporte) > 0) || (it.rendimentos != null && Number(it.rendimentos) > 0) ? (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                      {it.aporte != null && Number(it.aporte) > 0 && (
                        <div style={{
                          fontSize: 9,
                          color: "#c084fc",
                          background: "rgba(168,85,247,0.10)",
                          border: "0.5px solid rgba(168,85,247,0.30)",
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontVariantNumeric: "tabular-nums",
                          ...noSel,
                        }}>
                          ＋ {brlCompact(Number(it.aporte))} aportado
                        </div>
                      )}
                      {it.rendimentos != null && Number(it.rendimentos) > 0 && (
                        <div style={{
                          fontSize: 9,
                          color: "#16a34a",
                          background: "rgba(34,197,94,0.10)",
                          border: "0.5px solid rgba(34,197,94,0.30)",
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontVariantNumeric: "tabular-nums",
                          ...noSel,
                        }}>
                          ＋ {brlCompact(Number(it.rendimentos))} em rendimentos
                        </div>
                      )}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* Legenda */}
      <div style={{
        marginTop: 14, paddingTop: 12,
        borderTop: `0.5px solid ${T.border}`,
        display: "flex", gap: 16, flexWrap: "wrap",
        fontSize: 10, color: T.textMuted, ...noSel,
      }}>
        {legenda || (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 2, background: "#22c55e", borderRadius: 1 }} /> alta vs. mês anterior
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 2, background: "#ef4444", borderRadius: 1 }} /> queda
            </span>
            {destacarUltimo && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.gold }} /> mês atual
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
