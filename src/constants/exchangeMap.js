// Mapa de ticker → exchange para gráficos do TradingView.
// TradingView exige "NYSE:HD", "NASDAQ:AAPL" — usar prefixo errado mostra "Esse símbolo não existe".
// Usamos um mapa só para as ações US/REITs que estão em NASDAQ. Default = NYSE.

// NASDAQ (famosas / top tech + grandes). O resto cai em NYSE por default.
const NASDAQ = new Set([
  "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "NVDA", "TSLA",
  "AMD", "AVGO", "ADBE", "NFLX", "COST", "PEP", "CMCSA", "INTC",
  "CSCO", "QCOM", "TXN", "PYPL", "SBUX", "INTU", "MDLZ", "GILD",
  "BIIB", "REGN", "VRTX", "AMGN", "ADP", "ISRG", "BKNG", "KLAC",
  "LRCX", "MRVL", "ASML", "CDNS", "SNPS", "PDD", "JD", "BIDU",
  "NTES", "BABA", "MU", "MELI", "MRNA", "ILMN", "DOCU", "ZM",
  "DDOG", "CRWD", "SNOW", "PANW", "FTNT", "TEAM", "NOW",
]);

// TradingView busca por ticker se não tiver prefixo, mas retorna "não existe" em muitos.
// Portanto preservamos o prefixo explícito usando as regras abaixo.
export function descobrirExchange(ticker, classe) {
  if (!ticker) return "NYSE";
  const up = ticker.toUpperCase();

  // Brasil
  if (classe === "acoesBR" || classe === "fiis") return "BMFBOVESPA";

  // US / REITs
  if (NASDAQ.has(up)) return "NASDAQ";
  return "NYSE";
}

// Constrói símbolo completo para o widget do TradingView.
export function buildTvSymbol(ticker, classe) {
  const exchange = descobrirExchange(ticker, classe);
  return `${exchange}:${ticker}`;
}
