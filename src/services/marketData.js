// src/services/marketData.js
// Camada de dados — só busca. Cache persistente é no Firestore (mercadoSnapshot.js).
//
// BR: brapi.dev (CORS OK, aceita lista de tickers)
// US: Stooq CSV (primário, direto sem CORS) + Yahoo via proxies (complemento)
//
// Timeouts curtos + grupos em paralelo + timeout global.
// Se uma fonte falhar, descarta e segue — nunca trava aguardando rede morta.

const BRAPI_TOKEN = ""; // opcional

const PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quote=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

// Timeouts: curtos para falhar rápido. Se rede ou API está ruim,
// preferimos dado parcial em 20s do que espera eterna de 14min.
const REQ_TIMEOUT_MS = 8000;        // por request individual
const PROXY_TIMEOUT_MS = 6000;       // por proxy (3 proxies em cascata = 18s pior caso)
const GROUP_SIZE = 20;               // tickers por batch
const MAX_PARALLEL = 4;              // requests simultâneas

// ═════════════════════════════════════════════════════════
// HTTP helpers
// ═════════════════════════════════════════════════════════
async function fetchJson(url, { timeout = REQ_TIMEOUT_MS } = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchText(url, { timeout = REQ_TIMEOUT_MS } = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
async function fetchViaProxy(url, parser = "json") {
  let ultErro;
  for (const wrap of PROXIES) {
    try {
      return parser === "json"
        ? await fetchJson(wrap(url), { timeout: PROXY_TIMEOUT_MS })
        : await fetchText(wrap(url), { timeout: PROXY_TIMEOUT_MS });
    } catch (e) { ultErro = e; }
  }
  throw ultErro || new Error("Todos proxies falharam");
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Executa N promises em paralelo com limite de concorrência.
// Usa allSettled — falhas em uma não derrubam as outras.
async function paralelizar(tasks, limite = MAX_PARALLEL) {
  const resultados = [];
  const executando = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(task).catch(() => null);
    resultados.push(p);
    executando.add(p);
    p.finally(() => executando.delete(p));
    if (executando.size >= limite) {
      await Promise.race(executando);
    }
  }
  return Promise.all(resultados);
}

// ═════════════════════════════════════════════════════════
// BR — via Cloud Function (Yahoo Finance com tickers .SA)
// ═════════════════════════════════════════════════════════
// brapi.dev virou API paga em 2025 (HTTP 401 sem token). Para evitar dependência
// de API externa paga, usamos Yahoo Finance via Cloud Function server-side
// (Yahoo aceita tickers BR com sufixo .SA: PETR4.SA, VALE3.SA, HGLG11.SA...).
export async function buscarAtivosBR(tickers) {
  try {
    const { httpsCallable } = await import("firebase/functions");
    const { functions } = await import("../firebase");
    const callBuscar = httpsCallable(functions, "buscarMercadoBR", { timeout: 110000 });
    const { data } = await callBuscar({ tickers });
    // Preserva todos os campos do servidor (roe, divLiqEbitda, cobJuros, margens, CAGRs etc).
    // Só preenche os campos que o Yahoo NÃO retorna na chamada `quote()` direta.
    return (data?.ativos || []).map((r) => ({
      variacaoSemana: null,
      variacaoMes: null,
      logo: null,
      ...r,  // ← spread por último: dados do servidor sobrescrevem null
    }));
  } catch (e) {
    console.warn("[marketData] buscarMercadoBR Cloud Function falhou:", e.message);
    return [];
  }
}

// ═════════════════════════════════════════════════════════
// US — via Cloud Function (sem CORS, sem proxies públicos instáveis)
// ═════════════════════════════════════════════════════════
// Os proxies CORS gratuitos (corsproxy.io, codetabs, allorigins) ficaram
// indisponíveis/pagos em 2025 — por isso a busca de dados US foi movida
// para uma Cloud Function que roda server-side.
export async function buscarAtivosUS(tickers) {
  try {
    const { httpsCallable } = await import("firebase/functions");
    const { functions } = await import("../firebase");
    const callBuscar = httpsCallable(functions, "buscarMercadoUS", { timeout: 110000 });
    const { data } = await callBuscar({ tickers });
    const stooq = (data?.stooq || []).map(enriquecerStooq);
    const yahoo = (data?.yahoo || []).map(enriquecerYahoo);
    // Merge: Yahoo tem fundamentals (P/E, P/B, yield) e Stooq tem preço/variação.
    // Na união, valores não-null ganham — então Yahoo completa o Stooq.
    return mergePorTicker([...stooq, ...yahoo]);
  } catch (e) {
    console.warn("[marketData] buscarMercadoUS Cloud Function falhou:", e.message);
    return [];
  }
}

// Stooq retorna só preço/variação. Demais campos vêm null do Stooq mas
// podem ser preenchidos pelo Yahoo no merge (mergePorTicker prefere não-null).
function enriquecerStooq(r) {
  return {
    variacaoSemana: null,
    variacaoMes: null,
    variacaoAno: null,
    max52: null, min52: null,
    marketCap: null,
    pl: null, pvp: null, dy: null, roe: null, divLiqEbitda: null,
    logo: null,
    ...r,  // ← spread por último para preservar dados que o Stooq trouxer
  };
}
// Yahoo já vem com todos os indicadores enriquecidos; só preenche os realmente ausentes.
function enriquecerYahoo(r) {
  return {
    variacaoSemana: null,
    variacaoMes: null,
    logo: null,
    ...r,  // ← spread por último para preservar roe, divLiqEbitda, etc.
  };
}

// Se o mesmo ticker aparece em 2 fontes, une os campos (preferindo não-null).
function mergePorTicker(lista) {
  const mapa = new Map();
  for (const r of lista) {
    const k = (r.ticker || "").toUpperCase();
    if (!k) continue;
    const existente = mapa.get(k) || {};
    mapa.set(k, {
      ...existente,
      ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)),
    });
  }
  return [...mapa.values()];
}

function normalizarYahoo(r) {
  return {
    ticker: r.symbol,
    moeda: r.currency || "USD",
    preco: r.regularMarketPrice ?? null,
    variacaoDia: r.regularMarketChangePercent ?? null,
    variacaoSemana: null,
    variacaoMes: null,
    variacaoAno: r.fiftyTwoWeekChangePercent ?? null,
    max52: r.fiftyTwoWeekHigh ?? null,
    min52: r.fiftyTwoWeekLow ?? null,
    volume: r.regularMarketVolume ?? null,
    marketCap: r.marketCap ?? null,
    pl: r.trailingPE ?? null,
    pvp: r.priceToBook ?? null,
    dy: r.trailingAnnualDividendYield != null ? r.trailingAnnualDividendYield * 100 : null,
    roe: null,
    divLiqEbitda: null,
    logo: null,
    nomeLongo: r.longName || r.shortName || r.symbol,
    _fonte: "yahoo",
  };
}

async function buscarStooqBatch(tickers) {
  const query = tickers.map((t) => `${t.toLowerCase().replace(/-/g, "-")}.us`).join(",");
  const url = `https://stooq.com/q/l/?s=${query}&f=sd2t2ohlcv&h&e=csv`;
  let csv;
  try {
    csv = await fetchText(url);
  } catch {
    csv = await fetchViaProxy(url, "text");
  }
  const linhas = csv.trim().split("\n");
  if (linhas.length < 2) return [];
  const head = linhas[0].split(",").map((s) => s.trim().toLowerCase());
  const idx = (k) => head.indexOf(k);
  const out = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(",");
    const sym = (cols[idx("symbol")] || "").trim();
    if (!sym || sym === "N/D") continue;
    const close = parseFloat(cols[idx("close")]);
    const open = parseFloat(cols[idx("open")]);
    if (!isFinite(close)) continue;
    const diaPct = isFinite(open) && open > 0 ? ((close - open) / open) * 100 : null;
    out.push({
      ticker: sym.replace(/\.us$/i, "").toUpperCase(),
      moeda: "USD",
      preco: close,
      variacaoDia: diaPct,
      variacaoSemana: null,
      variacaoMes: null,
      variacaoAno: null,
      max52: null, min52: null,
      volume: parseFloat(cols[idx("volume")]) || null,
      marketCap: null,
      pl: null, pvp: null, dy: null, roe: null, divLiqEbitda: null,
      logo: null,
      nomeLongo: sym,
      _fonte: "stooq",
    });
  }
  return out;
}

// ═════════════════════════════════════════════════════════
// Rankings
// ═════════════════════════════════════════════════════════
export function rankear(ativos, { campo = "variacaoDia", top = 10 } = {}) {
  const validos = ativos.filter((a) => a[campo] != null && isFinite(a[campo]));
  const ordenados = [...validos].sort((a, b) => b[campo] - a[campo]);
  return {
    altas: ordenados.slice(0, top),
    baixas: ordenados.slice(-top).reverse(),
  };
}
