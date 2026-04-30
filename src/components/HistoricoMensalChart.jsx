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

  // Detecta o "mês atual sem dado real" (valor=0 com mês anterior > 0).
  // Em vez de mostrar -100% e "—" assustadores, marca como "aguardando".
  const itensSeguros = itens.map((it, i) => {
    const v = Number(it.valor) || 0;
    const prev = i > 0 ? Number(itens[i - 1].valor) || 0 : 0;
    const aguardando = v <= 0 && prev > 0;
    return { ...it, _aguardando: aguardando };
  });

  const valores = itensSeguros.map((i) => Number(i.valor) || 0);
  // Para o range, ignora pontos "aguardando" pra não esmagar a linha pra zero.
  const valoresPlot = itensSeguros.map((it, i) =>
    it._aguardando && i > 0 ? valores[i - 1] : valores[i]
  );
  const min = Math.min(...valoresPlot);
  const max = Math.max(...valoresPlot);
  const range = (max - min) || Math.max(1, Math.abs(max) * 0.05);

  // Layout responsivo: cards flexíveis preenchendo a largura.
  // Quando há muitos itens (>8), cai pra largura fixa com scroll-x; até 8,
  // os cards se distribuem em flex:1 e o SVG escala via viewBox.
  const useResponsive = itens.length <= 8;
  const cardW = 140; // largura virtual usada no viewBox + fallback de scroll
  const totalW = itens.length * cardW;
  const chartH = 96;
  const padY = 18;
  const padX = cardW / 2;

  // Posicionamento de cada ponto (coords no viewBox)
  const pontos = itensSeguros.map((it, i) => ({
    x: i * cardW + padX,
    y: padY + (1 - (valoresPlot[i] - min) / range) * (chartH - padY * 2),
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

      <div
        className={useResponsive ? "" : "pi-scroll-x"}
        style={{
          overflowX: useResponsive ? "visible" : "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: 4,
        }}
      >
        <div style={{
          position: "relative",
          width: useResponsive ? "100%" : totalW,
          height: chartH + 130,
        }}>

          {/* Header: nome do mês */}
          <div style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 30,
          }}>
            {itensSeguros.map((it, i) => {
              const isUltimo = destacarUltimo && i === idxAtual;
              const label = formatarMesRef(it.mesRef);
              const [mes, ano] = label.split("/");
              return (
                <div key={it.mesRef} style={{
                  flex: useResponsive ? 1 : `0 0 ${cardW}px`,
                  width: useResponsive ? "auto" : cardW,
                  textAlign: "center",
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

          {/* SVG: somente linha + área (esticada via preserveAspectRatio=none).
              Os círculos vão como overlay HTML pra evitar esmagamento em elipse. */}
          <svg
            width={useResponsive ? "100%" : totalW}
            height={chartH}
            viewBox={`0 0 ${totalW} ${chartH}`}
            preserveAspectRatio="none"
            style={{ position: "absolute", top: 32, left: 0, overflow: "visible", pointerEvents: "none" }}
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
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {/* Bolinhas como overlay HTML — posicionadas em % pra ficarem perfeitamente
              redondas independente do quanto o SVG estica horizontalmente. */}
          <div style={{
            position: "absolute",
            top: 32,
            left: 0,
            width: "100%",
            height: chartH,
            pointerEvents: "none",
          }}>
            {pontos.map((p, i) => {
              const isUltimo = destacarUltimo && i === idxAtual;
              const aguardando = p.item._aguardando;
              const cor = isUltimo
                ? T.gold
                : (i > 0 ? corSegmento(pontos[i - 1].valor, p.valor) : "#22c55e");
              const xPct = (p.x / totalW) * 100;
              const yPct = (p.y / chartH) * 100;
              const dotSize = isUltimo ? 12 : 10;
              const haloSize = 22;
              return (
                <div key={i}>
                  {isUltimo && !aguardando && (
                    <div style={{
                      position: "absolute",
                      left: `${xPct}%`,
                      top: `${yPct}%`,
                      width: haloSize,
                      height: haloSize,
                      marginLeft: -haloSize / 2,
                      marginTop: -haloSize / 2,
                      borderRadius: "50%",
                      background: cor,
                      opacity: 0.18,
                    }} />
                  )}
                  <div
                    title={aguardando ? "Aguardando importação" : formatValorTooltip(p.valor)}
                    style={{
                      position: "absolute",
                      left: `${xPct}%`,
                      top: `${yPct}%`,
                      width: dotSize,
                      height: dotSize,
                      marginLeft: -dotSize / 2,
                      marginTop: -dotSize / 2,
                      borderRadius: "50%",
                      background: (isUltimo || aguardando) ? "#0f1620" : cor,
                      border: `${isUltimo ? 2.5 : 2}px solid ${cor}`,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Cards clicáveis embaixo */}
          <div style={{
            display: "flex",
            position: "absolute",
            top: chartH + 36,
            left: 0,
            width: "100%",
            gap: 8,
            alignItems: "stretch",
          }}>
            {itensSeguros.map((it, i) => {
              const isUltimo = destacarUltimo && i === idxAtual;
              const aguardando = it._aguardando;
              const rentN = Number(it.rentMes);
              const temRent = !isNaN(rentN) && it.rentMes != null && !aguardando;
              const corRent = !temRent ? T.textMuted : (rentN > 0 ? "#22c55e" : rentN < 0 ? "#ef4444" : T.textMuted);
              const valor = valores[i];
              const valorPrev = i > 0 ? valores[i - 1] : null;
              const variacao = (!aguardando && valorPrev != null && valorPrev > 0)
                ? ((valor - valorPrev) / Math.abs(valorPrev)) * 100
                : null;

              return (
                <button
                  key={it.mesRef}
                  onClick={() => onSelect && onSelect(it)}
                  className={isUltimo ? "pi-hist-card-atual" : "pi-hist-card-passado"}
                  style={{
                    flex: useResponsive ? 1 : `0 0 ${cardW - 8}px`,
                    width: useResponsive ? "auto" : cardW - 8,
                    minHeight: 96,
                    border: `0.5px solid ${isUltimo ? T.goldBorder : T.border}`,
                    borderRadius: T.radiusMd,
                    padding: "12px 10px 14px",
                    cursor: onSelect ? "pointer" : "default",
                    fontFamily: T.fontFamily,
                    textAlign: "center",
                    transition: "border-color 0.15s, background 0.15s, transform 0.15s",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 4,
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
                    letterSpacing: "-0.01em",
                  }}>
                    {aguardando ? "—" : formatValor(valor)}
                  </div>
                  {aguardando ? (
                    <div style={{
                      fontSize: 9,
                      color: T.textMuted,
                      opacity: 0.85,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      ...noSel,
                    }}>
                      aguardando importação
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, minHeight: 14 }}>
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
                  )}
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
