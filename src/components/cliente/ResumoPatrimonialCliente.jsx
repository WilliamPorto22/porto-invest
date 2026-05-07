import { useMemo } from "react";
import DonutChartModern from "../DonutChartModern";
import { RentabilidadeVsIPCA } from "./RentabilidadeChart";
import { brl, brlCompact } from "../../utils/currency";
import { CLASSES_CARTEIRA } from "../../utils/ativos";
import {
  patrimonioFinanceiro,
  totalImoveis,
  totalVeiculos,
  totalCarteiraCliente,
} from "../../utils/bensCliente";

/**
 * ResumoPatrimonialCliente
 *
 * Visão patrimonial completa do cliente, no estilo das telas premium
 * (referência das prints fornecidas em 29/04/2026): donut por categoria,
 * Brasil×Global, distribuição por classes da carteira, liquidez D+1,
 * lista de bens cadastrados e histórico mensal de patrimônio.
 *
 * Recebe `cliente` (doc do Firestore) e opcionalmente `snapshots` (array
 * de snapshots mensais já carregados pela página chamadora).
 */

const NACIONAL_KEYS = ["posFixado", "ipca", "preFixado", "acoes", "fiis", "multi"];
const GLOBAL_KEYS = ["globalEquities", "globalTreasury", "globalFunds", "globalBonds", "global"];
const PREVIDENCIA_KEYS = ["prevVGBL", "prevPGBL"];
const LIQUIDEZ_D1_KEYS = ["posFixado", "ipca", "preFixado"];

function somaClasse(carteira, key) {
  const lista = carteira?.[key + "Ativos"];
  if (Array.isArray(lista) && lista.length > 0) {
    return lista.reduce((acc, at) => {
      const v = Number(String(at?.valor || "0").replace(/\D/g, "")) / 100;
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
  }
  const agg = carteira?.[key];
  const v = Number(String(agg || "0").replace(/\D/g, "")) / 100;
  return Number.isFinite(v) ? v : 0;
}

const CARD = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(13,19,33,0.4))",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 16,
  padding: "22px 24px",
};
const TITULO = {
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#748CAB",
  fontWeight: 600,
  marginBottom: 14,
};

export default function ResumoPatrimonialCliente({ cliente, snapshots = [], ocultarLiquidez = false }) {
  const dados = useMemo(() => {
    if (!cliente) return null;
    const carteira = cliente.carteira || {};

    let totalNacional = 0, totalGlobal = 0, totalPrevidencia = 0;
    NACIONAL_KEYS.forEach((k) => { totalNacional += somaClasse(carteira, k); });
    GLOBAL_KEYS.forEach((k) => { totalGlobal += somaClasse(carteira, k); });
    PREVIDENCIA_KEYS.forEach((k) => { totalPrevidencia += somaClasse(carteira, k); });

    const carteiraTotal = totalCarteiraCliente(cliente);
    const fin = patrimonioFinanceiro(cliente);
    const im = totalImoveis(cliente);
    const ve = totalVeiculos(cliente);
    const totalConsolidado = fin + im + ve;

    let liquidezD1 = 0;
    LIQUIDEZ_D1_KEYS.forEach((k) => { liquidezD1 += somaClasse(carteira, k); });

    const classesCarteira = CLASSES_CARTEIRA
      .map((c) => ({ ...c, valor: somaClasse(carteira, c.key) }))
      .filter((c) => c.valor > 0);

    // Rentabilidade anual — mesma prioridade do ClienteFicha:
    // rent12m (PDF) > rentAno (PDF) > rentabilidadeCalculada (ponderada) > rentabilidadeAnual (manual)
    const rent12mPdf = carteira?.rent12m != null ? Number(carteira.rent12m) : null;
    const rentAnoPdf = carteira?.rentAno != null ? Number(carteira.rentAno) : null;
    const rentCalc = parseFloat(String(carteira?.rentabilidadeCalculada || "").replace(",", "."));
    const rentManual = parseFloat(String(cliente?.rentabilidadeAnual || "").replace(",", "."));
    const rentAnual = rent12mPdf != null ? rent12mPdf
      : rentAnoPdf != null ? rentAnoPdf
      : (!isNaN(rentCalc) && rentCalc > 0) ? rentCalc
      : (!isNaN(rentManual) && rentManual > 0 ? rentManual : null);

    return {
      rentAnual,
      totalConsolidado,
      categorias: [
        { key: "fin", label: "Investimentos", valor: fin, cor: "#F0A202" },
        { key: "imv", label: "Imóveis",       valor: im,  cor: "#22c55e" },
        { key: "vei", label: "Veículos",      valor: ve,  cor: "#60a5fa" },
      ].filter((c) => c.valor > 0),
      brasilGlobal: [
        { key: "br", label: "Brasil (R$)",   valor: totalNacional + totalPrevidencia, cor: "#F0A202" },
        { key: "gl", label: "Global (USD)",  valor: totalGlobal,                       cor: "#a855f7" },
      ].filter((c) => c.valor > 0),
      classesCarteira,
      carteiraTotal,
      liquidezD1,
      totalNacional,
      totalGlobal,
      totalPrevidencia,
    };
  }, [cliente]);

  if (!dados || dados.totalConsolidado <= 0) return null;

  const imoveis = Array.isArray(cliente?.imoveis) ? cliente.imoveis : [];
  const veiculos = Array.isArray(cliente?.veiculos) ? cliente.veiculos : [];

  const distribuicaoEmReais = [
    { label: "Invest. Nacional", valor: dados.totalNacional, cor: "#F0A202" },
    { label: "Invest. Global",   valor: dados.totalGlobal,   cor: "#a855f7" },
    { label: "Imóveis",          valor: totalImoveis(cliente),  cor: "#22c55e" },
    { label: "Veículos",         valor: totalVeiculos(cliente), cor: "#60a5fa" },
  ].filter((c) => c.valor > 0);
  const maxBarra = Math.max(...distribuicaoEmReais.map((c) => c.valor), 1);

  return (
    <div className="resumo-patrimonial">
      {/* ── HERO: Patrimônio Consolidado ────────────────────────── */}
      <header style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 18,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: "linear-gradient(135deg, rgba(240,162,2,0.18), rgba(240,162,2,0.04))",
          border: "1px solid rgba(240,162,2,0.30)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22,
        }}>🏛️</div>
        <div>
          <div style={{ fontSize: 18, color: "#F0EBD8", fontWeight: 500 }}>
            Patrimônio Consolidado
          </div>
          <div style={{ fontSize: 12, color: "#9EB8D0", marginTop: 2 }}>
            Visão patrimonial completa · {brl(dados.totalConsolidado)}
          </div>
        </div>
      </header>

      {/* ── LINHA 1: 3 cards (Categorias / Brasil×Global / Distribuição em R$) ── */}
      <div className="resumo-grid-3" style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 14,
        marginBottom: 14,
      }}>
        {/* Patrimônio por Categoria */}
        <div style={CARD}>
          <div style={TITULO}>Patrimônio por Categoria</div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <DonutChartModern
              data={dados.categorias}
              total={dados.totalConsolidado}
              size={170}
              thickness={22}
              labelCentro="TOTAL"
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dados.categorias.map((c) => {
              const pct = Math.round((c.valor / dados.totalConsolidado) * 100);
              return (
                <div key={c.key}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#F0EBD8" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: c.cor }} />
                      {c.label}
                    </span>
                    <span style={{ color: c.cor, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                      {pct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2, marginLeft: 16, fontVariantNumeric: "tabular-nums" }}>
                    {brl(c.valor)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Brasil vs Global */}
        <div style={CARD}>
          <div style={TITULO}>Brasil vs Global</div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            {dados.brasilGlobal.length > 0 ? (
              <DonutChartModern
                data={dados.brasilGlobal}
                total={dados.brasilGlobal.reduce((a, c) => a + c.valor, 0)}
                size={170}
                thickness={22}
                labelCentro="TOTAL"
              />
            ) : (
              <div style={{ fontSize: 12, color: "#748CAB", padding: 30 }}>
                Sem investimentos cadastrados
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dados.brasilGlobal.map((c) => {
              const tot = dados.brasilGlobal.reduce((a, x) => a + x.valor, 0) || 1;
              const pct = Math.round((c.valor / tot) * 100);
              return (
                <div key={c.key}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#F0EBD8" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.cor }} />
                      {c.key === "br" ? "🇧🇷 " : "🌎 "}{c.label}
                    </span>
                    <span style={{ color: c.cor, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                      {pct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2, marginLeft: 16, fontVariantNumeric: "tabular-nums" }}>
                    {brl(c.valor)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Distribuição em Reais (barras) */}
        <div style={CARD}>
          <div style={TITULO}>Distribuição em Reais</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 6 }}>
            {distribuicaoEmReais.map((c) => (
              <div key={c.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: "#F0EBD8" }}>{c.label}</span>
                  <span style={{ color: c.cor, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    {brlCompact(c.valor)}
                  </span>
                </div>
                <div style={{ height: 8, background: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.max(4, (c.valor / maxBarra) * 100)}%`,
                    background: `linear-gradient(90deg, ${c.cor}cc, ${c.cor})`,
                    transition: "width 0.4s",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── LINHA RENTABILIDADE + CLASSES ───────────────────────── */}
      {(dados.rentAnual != null || dados.classesCarteira.length > 0) && (
        <div className="resumo-rent-classes" style={{
          display: "grid",
          gridTemplateColumns: dados.classesCarteira.length > 0 ? "minmax(0, 1.8fr) minmax(0, 1fr)" : "1fr",
          gap: 14,
          marginBottom: 14,
          alignItems: "stretch",
        }}>
          {dados.rentAnual != null && (
            <RentabilidadeVsIPCA rentAnual={dados.rentAnual} ipcaAnual={4.14} meses={12} metaExtra={6} />
          )}
          {dados.classesCarteira.length > 0 && (
            <div style={{ ...CARD, padding: "20px 22px" }}>
              <div style={{ ...TITULO, marginBottom: 10 }}>Distribuição por Classes</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <DonutChartModern
                  data={dados.classesCarteira.map((c) => ({
                    key: c.key, label: c.label, valor: c.valor, cor: c.cor,
                  }))}
                  total={dados.carteiraTotal}
                  size={150}
                  thickness={20}
                  labelCentro="TOTAL"
                />
                <div style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: dados.classesCarteira.length >= 5 ? "repeat(2, minmax(0, 1fr))" : "1fr",
                  gap: "4px 10px",
                }}>
                  {dados.classesCarteira.map((c) => {
                    const pct = dados.carteiraTotal > 0
                      ? Math.round((c.valor / dados.carteiraTotal) * 100)
                      : 0;
                    return (
                      <div key={c.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#F0EBD8", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: c.cor, flexShrink: 0 }} />
                          {c.label}
                        </span>
                        <span style={{ color: c.cor, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LINHA 3: Liquidez ───────────────────────────────────── */}
      {/* No painel principal (HomeLiberdade) já existe um par de
          mini-cards de Liquidez/Total no topo — escondemos esta linha
          via `ocultarLiquidez` para não duplicar a informação. A página
          dedicada `/me/resumo` continua mostrando o bloco completo. */}
      {!ocultarLiquidez && (
      <div style={{ ...CARD, marginBottom: 14 }}>
        <div style={TITULO}>Liquidez da Carteira</div>
        <div className="resumo-liquidez-grid" style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}>
          <div style={{
            padding: "16px 18px",
            background: "rgba(34,197,94,0.05)",
            border: "1px solid rgba(34,197,94,0.20)",
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 10, color: "#9EB8D0", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8 }}>
              Disponível em 1 dia
            </div>
            <div style={{ fontSize: 22, color: "#22c55e", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
              {brl(dados.liquidezD1)}
            </div>
            <div style={{ fontSize: 11, color: "#748CAB", marginTop: 4 }}>
              {dados.carteiraTotal > 0
                ? `${Math.round((dados.liquidezD1 / dados.carteiraTotal) * 100)}% da carteira`
                : "—"}
            </div>
          </div>
          <div style={{
            padding: "16px 18px",
            background: "rgba(240,162,2,0.05)",
            border: "1px solid rgba(240,162,2,0.20)",
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 10, color: "#9EB8D0", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8 }}>
              Total Investido
            </div>
            <div style={{ fontSize: 22, color: "#F0A202", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
              {brl(dados.carteiraTotal)}
            </div>
            <div style={{ fontSize: 11, color: "#748CAB", marginTop: 4 }}>
              Carteira completa
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── LINHA 4: Patrimônio Financeiro + Bens Cadastrados ──── */}
      <div style={{ ...CARD }}>
        <div style={TITULO}>Patrimônio Financeiro</div>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          background: "rgba(240,162,2,0.05)",
          border: "1px solid rgba(240,162,2,0.20)",
          borderRadius: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: "rgba(240,162,2,0.10)",
              border: "1px solid rgba(240,162,2,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
            }}>📊</div>
            <div>
              <div style={{ fontSize: 14, color: "#F0EBD8", fontWeight: 500 }}>
                Carteira de Investimentos
              </div>
              <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2 }}>
                Declarado na carteira
              </div>
            </div>
          </div>
          <div style={{ fontSize: 14, color: "#F0A202", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            {brl(dados.carteiraTotal)}
          </div>
        </div>

        {(imoveis.length > 0 || veiculos.length > 0) && (
          <>
            <div style={{ ...TITULO, marginTop: 22 }}>Bens Cadastrados</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {imoveis.map((im, i) => (
                <div key={`im-${i}`} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
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
                      fontSize: 16,
                    }}>🏠</div>
                    <div>
                      <div style={{ fontSize: 14, color: "#F0EBD8", fontWeight: 500 }}>
                        {im.nome || im.tipo || "Imóvel"}
                      </div>
                      <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2 }}>
                        {im.tipo}{parseInt(im.quantidade) > 1 ? ` · ${im.quantidade}x` : ""} · Imóvel
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#22c55e", fontWeight: 400 }}>{im.faixa}</div>
                </div>
              ))}
              {veiculos.map((v, i) => (
                <div key={`ve-${i}`} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
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
                      fontSize: 16,
                    }}>🚗</div>
                    <div>
                      <div style={{ fontSize: 14, color: "#F0EBD8", fontWeight: 500 }}>
                        {v.nome || v.tipo || "Veículo"}
                      </div>
                      <div style={{ fontSize: 11, color: "#748CAB", marginTop: 2 }}>
                        {v.tipo}{parseInt(v.quantidade) > 1 ? ` · ${v.quantidade}x` : ""} · Veículo
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#60a5fa", fontWeight: 400 }}>{v.faixa}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .resumo-grid-3 { grid-template-columns: 1fr !important; }
          .resumo-rent-classes { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 560px) {
          .resumo-liquidez-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
