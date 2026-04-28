// services/cotacoesReais.js

export const HORARIO_MERCADO = { abertura: 10, fechamento: 17 };
export const INTERVALO_ATUALIZACAO = 1 * 60 * 60 * 1000; // 1 hora em ms
// TTL do cache local: não refetch enquanto estiver fresco (evita abrir 5 sockets
// em cada navegação entre páginas e esperar proxies CORS lentos).
export const COTACOES_CACHE_TTL = 10 * 60 * 1000; // 10 min
const CACHE_KEY = "wealthtrack_cotacoes";

export function lerCacheCotacoes() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?._atualizadoEm) return { data, stale: true };
    const stale = Date.now() - data._atualizadoEm > COTACOES_CACHE_TTL;
    return { data, stale };
  } catch {
    return null;
  }
}

export function salvarCacheCotacoes(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _atualizadoEm: Date.now() }));
  } catch { /* storage cheio */ }
}

// Token gratuito: cadastre em https://brapi.dev para obter o seu
const BRAPI_TOKEN = 'SEU_TOKEN_AQUI';

export function mercadoAberto() {
  const agora = new Date();
  const brasiliaOffset = -3 * 60;
  const utc = agora.getTime() + agora.getTimezoneOffset() * 60000;
  const brasilia = new Date(utc + brasiliaOffset * 60000);

  const hora = brasilia.getHours();
  const diaSemana = brasilia.getDay(); // 0=Dom, 6=Sáb

  if (diaSemana === 0 || diaSemana === 6) return false;
  return hora >= HORARIO_MERCADO.abertura && hora < HORARIO_MERCADO.fechamento;
}

export function proximoHorarioAtualizacao() {
  const agora = new Date();
  const brasiliaOffset = -3 * 60;
  const utc = agora.getTime() + agora.getTimezoneOffset() * 60000;
  const brasilia = new Date(utc + brasiliaOffset * 60000);

  const hora = brasilia.getHours();
  const minutos = brasilia.getMinutes();

  if (hora < HORARIO_MERCADO.abertura) {
    return `${HORARIO_MERCADO.abertura}h`;
  }
  if (hora >= HORARIO_MERCADO.fechamento) {
    return `amanhã às ${HORARIO_MERCADO.abertura}h`;
  }
  const proximaHora = hora + 1;
  return `${String(proximaHora).padStart(2, '0')}h${minutos > 0 ? String(minutos).padStart(2, '0') : ''}`;
}

async function buscarDolar() {
  try {
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const usd = data.USDBRL;
    const valor = parseFloat(usd.bid);
    const variacao = parseFloat(usd.pctChange);
    return {
      valor,
      variacao,
      tipo: variacao >= 0 ? `+${variacao.toFixed(2)}% hoje` : `${variacao.toFixed(2)}% hoje`
    };
  } catch (e) {
    console.warn('Dólar indisponível:', e.message);
    return null;
  }
}

async function buscarIbovespa() {
  try {
    const r = await fetch('https://mfinance.com.br/api/v1/stocks/IBOV', {
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const variacao = data.change ?? 0;
    return {
      valor: data.lastPrice,
      variacao,
      tipo: variacao >= 0 ? `+${variacao.toFixed(2)}% hoje` : `${variacao.toFixed(2)}% hoje`
    };
  } catch (e) {
    console.warn('Ibovespa indisponível:', e.message);
    return null;
  }
}

async function buscarSP500() {
  // Tentativa 1: Yahoo Finance via proxy CORS (sem token, dados idênticos ao Google Finance)
  try {
    const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d';
    const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error('Sem dados');
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose || meta.previousClose;
    const variacao = prev ? ((price - prev) / prev) * 100 : 0;
    return {
      valor: price,
      variacao,
      tipo: variacao >= 0 ? `+${variacao.toFixed(2)}% hoje` : `${variacao.toFixed(2)}% hoje`
    };
  } catch (e) {
    console.warn('S&P 500 Yahoo (proxy):', e.message);
  }

  // Tentativa 2: brapi.dev com token (se configurado)
  if (BRAPI_TOKEN && BRAPI_TOKEN !== 'SEU_TOKEN_AQUI') {
    try {
      const r = await fetch(`https://brapi.dev/api/quote/%5EGSPC?token=${BRAPI_TOKEN}`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const quote = data.results?.[0];
      if (!quote?.regularMarketPrice) throw new Error('Sem dados');
      const variacao = quote.regularMarketChangePercent ?? 0;
      return {
        valor: quote.regularMarketPrice,
        variacao,
        tipo: variacao >= 0 ? `+${variacao.toFixed(2)}% hoje` : `${variacao.toFixed(2)}% hoje`
      };
    } catch (e) {
      console.warn('S&P 500 brapi (token):', e.message);
    }
  }

  // Tentativa 3: brapi.dev sem token
  try {
    const r = await fetch('https://brapi.dev/api/quote/%5EGSPC', {
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const quote = data.results?.[0];
    if (!quote?.regularMarketPrice) throw new Error('Sem dados');
    const variacao = quote.regularMarketChangePercent ?? 0;
    return {
      valor: quote.regularMarketPrice,
      variacao,
      tipo: variacao >= 0 ? `+${variacao.toFixed(2)}% hoje` : `${variacao.toFixed(2)}% hoje`
    };
  } catch (e) {
    console.warn('S&P 500 brapi (sem token):', e.message);
  }

  // Fallback localStorage (ignora valor 0 ou desatualizado)
  try {
    const stored = localStorage.getItem('wealthtrack_cotacoes');
    if (stored) {
      const data = JSON.parse(stored);
      if (data.sp500?.valor > 0) return data.sp500;
    }
  } catch {/* cache inválido */}

  return null;
}

async function buscarSelic() {
  try {
    const res = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json');
    const json = await res.json();
    if (json?.[0]?.valor) {
      const anual = parseFloat(json[0].valor.replace(',', '.'));
      return { valor: anual, variacao: null, tipo: 'a.a.' };
    }
  } catch (e) {
    console.error('Erro Selic:', e);
  }
  return { valor: 14.75, variacao: null, tipo: 'a.a.' };
}

async function buscarIPCA() {
  try {
    const res = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json');
    const json = await res.json();
    if (json?.[0]?.valor) {
      return { valor: parseFloat(json[0].valor.replace(',', '.')), variacao: null, tipo: '12 meses' };
    }
  } catch (e) {
    console.error('Erro IPCA:', e);
  }
  return { valor: 4.14, variacao: null, tipo: '12 meses' };
}

export async function obterTodasAsCotacoes({ force = false } = {}) {
  // Se tem cache fresco e não é forçado, devolve do cache — economiza 5 requests
  // externos (alguns via proxy CORS com timeout de 10s) em toda navegação.
  if (!force) {
    const c = lerCacheCotacoes();
    if (c && !c.stale) {
      const { _atualizadoEm, ...rest } = c.data;
      return rest;
    }
  }
  const [dolar, ibovespa, sp500, selic, ipca] = await Promise.allSettled([
    buscarDolar(),
    buscarIbovespa(),
    buscarSP500(),
    buscarSelic(),
    buscarIPCA(),
  ]);

  const resultado = {
    dolar:    dolar.status    === 'fulfilled' && dolar.value    ? dolar.value    : { valor: 5.08,   variacao: 0, tipo: 'Fallback' },
    ibovespa: ibovespa.status === 'fulfilled' && ibovespa.value ? ibovespa.value : { valor: 197000, variacao: 0, tipo: 'Fallback' },
    sp500:    sp500.status    === 'fulfilled' && sp500.value    ? sp500.value    : { valor: 7000,   variacao: 0, tipo: 'Fallback' },
    selic:    selic.status    === 'fulfilled' ? selic.value     : { valor: 14.75, variacao: null, tipo: 'a.a.' },
    ipca:     ipca.status     === 'fulfilled' ? ipca.value      : { valor: 4.14,  variacao: null, tipo: '12 meses' },
  };
  salvarCacheCotacoes(resultado);
  return resultado;
}

export function useCotacoesReais() {
  return {
    obterIPCA: buscarIPCA,
    obterTodasAsCotacoes,
    mercadoAberto,
  };
}
