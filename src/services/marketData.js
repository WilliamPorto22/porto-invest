// src/services/marketData.js
// Camada de dados — só busca. Cache persistente é no Firestore (mercadoSnapshot.js).
//
// BR: brapi.dev (CORS OK, aceita lista de tickers)
// US: Stooq CSV (primário, direto sem CORS) + Yahoo via proxies (complemento)
//
// Timeouts curtos + grupos em paralelo + timeout global.
// Se uma fonte falhar, descarta e segue — nunca trava aguardando rede morta.

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
