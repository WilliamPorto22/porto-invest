import React, { useEffect, useRef } from "react";

/**
 * Embed do TradingView (widget Advanced Chart).
 * Carrega o script uma vez e injeta no container.
 *
 * Props:
 *   symbol    : ex "BMFBOVESPA:PETR4", "NASDAQ:AAPL"
 *   altura    : px (default 420)
 *   interval  : "D" | "W" | "60" etc (default "D")
 */
export default function TradingViewWidget({ symbol, altura = 420, interval = "D" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      symbol,
      interval,
      timezone: "America/Sao_Paulo",
      theme: "dark",
      style: "1",
      locale: "br",
      toolbar_bg: "#0D1321",
      withdateranges: true,
      allow_symbol_change: true,
      save_image: false,
      hide_side_toolbar: false,
      details: true,
      hotlist: false,
      calendar: false,
      studies: ["RSI@tv-basicstudies", "MAExp@tv-basicstudies"],
      container_id: `tv-${symbol?.replace(/[^A-Z0-9]/gi, "_")}`,
      width: "100%",
      height: altura,
    });

    containerRef.current.appendChild(script);
  }, [symbol, altura, interval]);

  return (
    <div className="tv-wrapper" style={{ height: altura }}>
      <div className="tradingview-widget-container" ref={containerRef} style={{ height: "100%" }}>
        <div className="tradingview-widget-container__widget" style={{ height: "100%" }} />
      </div>
    </div>
  );
}
