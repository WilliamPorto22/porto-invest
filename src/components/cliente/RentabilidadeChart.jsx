// Rentabilidade vs IPCA + meta (IPCA + 6% a.a.) — extraído de ClienteFicha.jsx
// para reuso no painel do cliente (/cliente/:id/painel e /me/home).
import { T } from "../../theme";

const noSel = { userSelect: "none", WebkitUserSelect: "none" };

export function RentabilidadeVsIPCA({ rentAnual, ipcaAnual = 4.14, meses = 12, metaExtra = 6 }) {
  const semDados = rentAnual == null || isNaN(rentAnual) || rentAnual === 0;

  const mesesLbl = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const hoje = new Date();
  const totalPts = meses + 1;
  const labels = Array.from({ length: totalPts }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - i), 1);
    return mesesLbl[d.getMonth()];
  });

  const taxaMensal = (anual) => Math.pow(1 + (anual || 0) / 100, 1 / 12) - 1;
  const rM = taxaMensal(rentAnual || 0);
  const iM = taxaMensal(ipcaAnual || 0);
  const metaAnual = (ipcaAnual || 0) + metaExtra;
  const mM = taxaMensal(metaAnual);

  const serieCart = [0], serieIpca = [0], serieMeta = [0];
  for (let i = 0; i < meses; i++) {
    serieCart.push((Math.pow(1 + rM, i + 1) - 1) * 100);
    serieIpca.push((Math.pow(1 + iM, i + 1) - 1) * 100);
    serieMeta.push((Math.pow(1 + mM, i + 1) - 1) * 100);
  }

  const lastIdx = totalPts - 1;
  const rentPct = serieCart[lastIdx];
  const ipcaPct = serieIpca[lastIdx];
  const metaPct = serieMeta[lastIdx];
  const W = 540, H = 200, padL = 36, padR = 60, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const allVals = [...serieCart, ...serieIpca, ...serieMeta, 0];
  const maxY = Math.max(...allVals);
  const minY = Math.min(...allVals);
  const yRange = Math.max(maxY - minY, 0.01);
  const yTop = maxY + yRange * 0.18;
  const yBot = Math.min(minY, 0);

  const xFor = (i) => padL + (i / lastIdx) * innerW;
  const yFor = (v) => padT + innerH - ((v - yBot) / (yTop - yBot)) * innerH;

  const makePath = (arr) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`).join(" ");
  const pathCart = makePath(serieCart);
  const pathIpca = makePath(serieIpca);
  const pathMeta = makePath(serieMeta);

  const tickVals = Array.from({ length: 5 }, (_, i) => yBot + ((yTop - yBot) * i) / 4);
  const CORES = { cart: "#F0A202", ipca: "#60a5fa", meta: "#22c55e" };

  const xEnd = xFor(lastIdx);
  const rotulos = [
    { key: "meta", y: yFor(metaPct), label: metaPct.toFixed(2).replace(".", ",") + "%", fill: CORES.meta, weight: 600, opacity: 1 },
    { key: "ipca", y: yFor(ipcaPct), label: ipcaPct.toFixed(2).replace(".", ",") + "%", fill: CORES.ipca, weight: 400, opacity: 0.8 },
    { key: "cart", y: yFor(rentPct), label: rentPct.toFixed(2).replace(".", ",") + "%", fill: CORES.cart, weight: 600, opacity: 1 },
  ].sort((a, b) => a.y - b.y);
  const minGap = 12;
  for (let i = 1; i < rotulos.length; i++) {
    if (rotulos[i].y - rotulos[i - 1].y < minGap) {
      rotulos[i].y = rotulos[i - 1].y + minGap;
    }
  }

  if (semDados) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: `0.5px solid ${T.border}`,
        borderRadius: 14,
        padding: "28px 20px",
        textAlign: "center",
        ...noSel,
      }}>
        <div style={{ fontSize: 11, color: "#748CAB", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 10 }}>
          Rentabilidade vs Meta (IPCA + {metaExtra}% a.a.)
        </div>
        <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6, maxWidth: 520, margin: "0 auto" }}>
          Informe a rentabilidade anual estimada da carteira no cadastro para exibir a comparação com a meta de IPCA + {metaExtra}% a.a.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: `0.5px solid ${T.border}`,
      borderRadius: 14,
      padding: "18px 20px",
      height: "100%",
      boxSizing: "border-box",
      ...noSel,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "#748CAB", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 3 }}>Rentabilidade da Carteira</div>
          <div style={{ fontSize: 12, color: T.textMuted }}>Últimos 12 meses · meta IPCA + {metaExtra}% a.a. ({metaAnual.toFixed(2).replace(".", ",")}%)</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 16, height: 2, background: CORES.cart, borderRadius: 2, display: "inline-block" }} />
            <span style={{ color: T.textSecondary }}>Carteira</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 16, height: 2, background: CORES.meta, borderRadius: 2, display: "inline-block" }} />
            <span style={{ color: T.textSecondary }}>Meta</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 1.5, background: CORES.ipca, borderRadius: 2, display: "inline-block", opacity: 0.6 }} />
            <span style={{ color: T.textMuted, fontSize: 11 }}>IPCA</span>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet" style={{ display: "block", overflow: "visible", marginBottom: 14 }}>
        {tickVals.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yFor(t)} y2={yFor(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
            <text x={padL - 6} y={yFor(t) + 3} textAnchor="end" fontSize={10} fill={T.textMuted} fontFamily={T.fontFamily}>{t.toFixed(1)}%</text>
          </g>
        ))}
        <path d={pathIpca} fill="none" stroke={CORES.ipca} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" opacity={0.55} />
        <path d={pathMeta} fill="none" stroke={CORES.meta} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
        <path
          d={`${pathCart} L ${xFor(lastIdx).toFixed(1)} ${yFor(yBot).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(yBot).toFixed(1)} Z`}
          fill={CORES.cart} opacity={0.08}
        />
        <path d={pathCart} fill="none" stroke={CORES.cart} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />

        <circle cx={xEnd} cy={yFor(rentPct)} r={4} fill={CORES.cart} />
        <circle cx={xEnd} cy={yFor(rentPct)} r={8} fill={CORES.cart} opacity={0.18} />
        <circle cx={xEnd} cy={yFor(metaPct)} r={3.5} fill={CORES.meta} opacity={0.9} />
        <circle cx={xEnd} cy={yFor(ipcaPct)} r={2.5} fill={CORES.ipca} opacity={0.6} />

        {rotulos.map(r => (
          <text key={r.key} x={xEnd + 10} y={r.y + 3.5} textAnchor="start" fontSize={10} fill={r.fill} opacity={r.opacity} fontWeight={r.weight} fontFamily={T.fontFamily}>{r.label}</text>
        ))}

        {labels.map((l, i) => {
          const every = Math.max(1, Math.floor(lastIdx / 4));
          if (i !== 0 && i !== lastIdx && i % every !== 0) return null;
          return (
            <text key={i} x={xFor(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={T.textMuted} fontFamily={T.fontFamily}>{l}</text>
          );
        })}
      </svg>
    </div>
  );
}
