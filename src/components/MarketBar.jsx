import { useEffect, useState } from "react";
import {
  obterTodasAsCotacoes,
  mercadoAberto,
  lerCacheCotacoes,
} from "../services/cotacoesReais";

/**
 * MarketBar — faixa horizontal com Dólar / Selic / IPCA / Ibovespa / S&P 500.
 *
 * Local-first: hidrata do cache localStorage ("wealthtrack_cotacoes")
 * imediatamente, depois atualiza em background.
 *
 * Reusa as classes .market-indicators existentes em components.css
 * pra ficar visualmente idêntico ao Dashboard.
 *
 * Props:
 *   compact (bool)  — variante compacta (mesmo estilo da ficha do cliente).
 *   className (str) — classe adicional opcional pro container externo.
 */

const FALLBACK = [
  { label: "Dólar",    valor: "R$ 5,08", sub: "hoje",     cor: "#9EB8D0" },
  { label: "Selic",    valor: "14,75%",  sub: "a.a.",     cor: "#9EB8D0" },
  { label: "IPCA",     valor: "4,14%",   sub: "12 meses", cor: "#9EB8D0" },
  { label: "Ibovespa", valor: "197.000", sub: "hoje",     cor: "#9EB8D0" },
  { label: "S&P 500",  valor: "5.396",   sub: "hoje",     cor: "#9EB8D0" },
];

function formatar(c) {
  if (!c) return FALLBACK;
  const dolarVar = c.dolar?.variacao ?? 0;
  const iboVar   = c.ibovespa?.variacao ?? 0;
  const spVar    = c.sp500?.variacao ?? 0;
  return [
    {
      label: "Dólar",
      valor: `R$ ${(c.dolar?.valor ?? 5.08).toFixed(2).replace(".", ",")}`,
      sub: dolarVar
        ? `${dolarVar >= 0 ? "+" : ""}${dolarVar.toFixed(2).replace(".", ",")}% hoje`
        : (c.dolar?.tipo || "hoje"),
      cor: dolarVar >= 0 ? "#22c55e" : "#ef4444",
    },
    {
      label: "Selic",
      valor: `${(c.selic?.valor ?? 14.75).toFixed(2).replace(".", ",")}%`,
      sub: c.selic?.tipo || "a.a.",
      cor: "#9EB8D0",
    },
    {
      label: "IPCA",
      valor: `${(c.ipca?.valor ?? 4.14).toFixed(2).replace(".", ",")}%`,
      sub: c.ipca?.tipo || "12 meses",
      cor: "#9EB8D0",
    },
    {
      label: "Ibovespa",
      valor: `${Math.round(c.ibovespa?.valor ?? 197000).toLocaleString("pt-BR")}`,
      sub: iboVar
        ? `${iboVar >= 0 ? "+" : ""}${iboVar.toFixed(2).replace(".", ",")}% hoje`
        : (c.ibovespa?.tipo || "hoje"),
      cor: iboVar >= 0 ? "#22c55e" : "#ef4444",
    },
    {
      label: "S&P 500",
      valor: `${Math.round(c.sp500?.valor ?? 5396).toLocaleString("pt-BR")}`,
      sub: spVar
        ? `${spVar >= 0 ? "+" : ""}${spVar.toFixed(2).replace(".", ",")}% hoje`
        : (c.sp500?.tipo || "hoje"),
      cor: spVar >= 0 ? "#22c55e" : "#ef4444",
    },
  ];
}

export default function MarketBar({ compact = false, className = "" }) {
  const [mercado, setMercado] = useState(() => {
    try {
      const c = lerCacheCotacoes?.();
      if (c?.data) return formatar(c.data);
    } catch { /* ignora */ }
    return FALLBACK;
  });
  const [aberto, setAberto] = useState(() => {
    try { return mercadoAberto(); } catch { return false; }
  });
  const [ultima, setUltima] = useState(null);

  useEffect(() => {
    let cancel = false;
    obterTodasAsCotacoes()
      .then((c) => {
        if (cancel) return;
        if (c) {
          setMercado(formatar(c));
          setUltima(new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit", minute: "2-digit",
          }));
        }
      })
      .catch(() => { /* mantém fallback */ });
    setAberto(mercadoAberto());
    return () => { cancel = true; };
  }, []);

  return (
    <div className={`market-bar-wrap ${className}`}>
      <div
        className="market-bar-status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          rowGap: 6,
          columnGap: 10,
          fontSize: 12,
          color: "#748CAB",
          marginBottom: 12,
          letterSpacing: "0.06em",
          fontWeight: 500,
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        <span style={{ color: "#5a7a9a" }}>
          {new Date().toLocaleDateString("pt-BR")}
        </span>
        <span style={{ color: "#3E5C76" }}>•</span>
        <span style={{ color: aberto ? "#22c55e" : "#9EB8D0", fontWeight: 600 }}>
          {aberto ? "● MERCADO ABERTO" : "● MERCADO FECHADO"}
        </span>
        {ultima && (
          <>
            <span style={{ color: "#3E5C76" }}>•</span>
            <span style={{ color: "#5a7a9a", textTransform: "none", fontWeight: 400 }}>
              Atualizado às <strong style={{ color: "#748CAB" }}>{ultima}</strong>
            </span>
          </>
        )}
      </div>
      <div className={`market-indicators ${compact ? "market-indicators--compact" : ""}`}>
        {mercado.map(({ label, valor, sub, cor }) => (
          <div key={label} className="market-indicator">
            <div className="market-label">{label}</div>
            <div className="market-value">{valor}</div>
            <div className="market-sub" style={{ color: cor }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
