import { useMemo } from "react";
import DonutChartModern from "../DonutChartModern";
import { brl } from "../../utils/currency";
import {
  patrimonioFinanceiro,
  totalImoveis,
  totalVeiculos,
  patrimonioConsolidado,
} from "../../utils/bensCliente";

/**
 * PatrimonioConsolidadoCliente — Bloco premium na home do cliente.
 *
 * Mostra a visão patrimonial completa em 3 categorias:
 *   - Investimentos (carteira financeira)
 *   - Imóveis (lista de bens)
 *   - Veículos (lista de bens)
 *
 * Donut + cards categoria + lista enxuta dos bens.
 *
 * Pensado pra ser leve (sem dependências de RingChart interno do ClienteFicha).
 */
export default function PatrimonioConsolidadoCliente({ cliente }) {
  const dados = useMemo(() => {
    const fin = patrimonioFinanceiro(cliente);
    const im = totalImoveis(cliente);
    const ve = totalVeiculos(cliente);
    const total = fin + im + ve;
    return {
      total,
      cats: [
        { key: "fin", label: "Investimentos", valor: fin, cor: "#F0A202" },
        { key: "imv", label: "Imóveis",       valor: im,  cor: "#22c55e" },
        { key: "vei", label: "Veículos",      valor: ve,  cor: "#60a5fa" },
      ].filter((c) => c.valor > 0),
    };
  }, [cliente]);

  if (dados.total <= 0) return null;

  const imoveis  = Array.isArray(cliente?.imoveis)  ? cliente.imoveis  : [];
  const veiculos = Array.isArray(cliente?.veiculos) ? cliente.veiculos : [];

  return (
    <section style={{
      marginTop: 28,
      marginBottom: 28,
      background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(13,19,33,0.4) 100%)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 18,
      padding: "26px 28px",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 22,
        flexWrap: "wrap",
        gap: 8,
      }}>
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#748CAB",
            marginBottom: 6,
            fontWeight: 600,
          }}>
            Patrimônio consolidado
          </div>
          <div style={{
            fontSize: 30,
            color: "#F0EBD8",
            fontWeight: 300,
            letterSpacing: "-0.01em",
          }}>
            {brl(dados.total)}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#9EB8D0" }}>
          Investimentos + Imóveis + Veículos
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 280px) 1fr",
        gap: 28,
        alignItems: "center",
      }}
      className="pcc-grid"
      >
        {/* Donut */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <DonutChartModern
            data={dados.cats}
            total={dados.total}
            size={220}
            thickness={28}
            labelCentro="TOTAL"
          />
        </div>

        {/* Cards de categoria */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {dados.cats.map((c) => {
            const pct = Math.round((c.valor / dados.total) * 100);
            return (
              <div key={c.key} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${c.cor}33`,
                borderRadius: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 3,
                    background: c.cor, flexShrink: 0,
                  }} />
                  <div>
                    <div style={{ fontSize: 14, color: "#F0EBD8", fontWeight: 500 }}>
                      {c.label}
                    </div>
                    <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2 }}>
                      {pct}% do patrimônio
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 16, color: c.cor, fontWeight: 400 }}>
                  {brl(c.valor)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista de bens (imóveis + veículos) */}
      {(imoveis.length > 0 || veiculos.length > 0) && (
        <>
          <div style={{
            marginTop: 24,
            marginBottom: 12,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#748CAB",
            fontWeight: 600,
          }}>
            Seus bens
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {imoveis.map((im, i) => (
              <div key={`im-${i}`} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                background: "rgba(34,197,94,0.05)",
                border: "1px solid rgba(34,197,94,0.18)",
                borderRadius: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9,
                    background: "rgba(34,197,94,0.10)",
                    border: "1px solid rgba(34,197,94,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, flexShrink: 0,
                  }}>🏠</div>
                  <div>
                    <div style={{ fontSize: 14, color: "#F0EBD8", fontWeight: 500 }}>
                      {im.nome || im.tipo || "Imóvel"}
                    </div>
                    <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2 }}>
                      {im.tipo}
                      {parseInt(im.quantidade) > 1 ? ` · ${im.quantidade}x` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#22c55e", fontWeight: 400 }}>
                  {im.faixa}
                </div>
              </div>
            ))}
            {veiculos.map((v, i) => (
              <div key={`ve-${i}`} style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                background: "rgba(96,165,250,0.05)",
                border: "1px solid rgba(96,165,250,0.18)",
                borderRadius: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9,
                    background: "rgba(96,165,250,0.10)",
                    border: "1px solid rgba(96,165,250,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, flexShrink: 0,
                  }}>🚗</div>
                  <div>
                    <div style={{ fontSize: 14, color: "#F0EBD8", fontWeight: 500 }}>
                      {v.nome || v.tipo || "Veículo"}
                    </div>
                    <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2 }}>
                      {v.tipo}
                      {parseInt(v.quantidade) > 1 ? ` · ${v.quantidade}x` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#60a5fa", fontWeight: 400 }}>
                  {v.faixa}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <style>{`
        @media (max-width: 720px) {
          .pcc-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
