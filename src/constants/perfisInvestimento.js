// src/constants/perfisInvestimento.js
// Perfis de alocação padrão da Porto Invest.
// Cada bucket mapeia para um conjunto de classes da carteira.

export const BUCKETS = {
  dolar:         { label: "Dólar / Global",   cor: "#a855f7", classes: ["globalEquities","globalTreasury","globalFunds","globalBonds","global"] },
  posFixado:     { label: "Pós-Fixado",        cor: "#2563eb", classes: ["posFixado"] },
  preFixado:     { label: "Pré-Fixado",        cor: "#60a5fa", classes: ["preFixado"] },
  ipca:          { label: "IPCA+",             cor: "#3b82f6", classes: ["ipca"] },
  rendaVariavel: { label: "Renda Variável",    cor: "#22c55e", classes: ["acoes","fiis","multi","prevVGBL","prevPGBL"] },
};

export const PERFIS = {
  conservador: {
    id: "conservador",
    label: "Conservador",
    cor: "#3b82f6",
    descricao: "Foco em proteção do capital com renda fixa diversificada.",
    alocacao: { dolar: 10, posFixado: 40, preFixado: 25, ipca: 25, rendaVariavel: 0 },
  },
  moderado: {
    id: "moderado",
    label: "Moderado",
    cor: "#F0A202",
    descricao: "Equilíbrio entre proteção e crescimento — foco principal da estratégia.",
    alocacao: { dolar: 15, posFixado: 25, preFixado: 25, ipca: 25, rendaVariavel: 10 },
  },
  agressivo: {
    id: "agressivo",
    label: "Agressivo",
    cor: "#22c55e",
    descricao: "Maximização de retorno com exposição significativa em renda variável.",
    alocacao: { dolar: 10, posFixado: 20, preFixado: 10, ipca: 15, rendaVariavel: 45 },
  },
};

export const PERFIL_LABELS = {
  conservador: "Conservador",
  moderado: "Moderado",
  agressivo: "Agressivo",
};

export const BUCKET_KEYS = Object.keys(BUCKETS);
export const PERFIL_KEYS = Object.keys(PERFIS);

/** Calcula a alocação real de um cliente por bucket (%). */
export function calcularAlocacao(carteira) {
  const cart = carteira || {};
  const CART_ALL = [
    "posFixado","ipca","preFixado","acoes","fiis","multi",
    "prevVGBL","prevPGBL","globalEquities","globalTreasury",
    "globalFunds","globalBonds","global","outros",
  ];

  const totais = {};
  for (const k of CART_ALL) {
    const ativos = cart[k + "Ativos"];
    if (Array.isArray(ativos)) {
      totais[k] = ativos.reduce((s, a) => s + parseInt(String(a.valor || "0").replace(/\D/g, "")) / 100, 0);
    } else {
      totais[k] = parseInt(String(cart[k] || "0").replace(/\D/g, "")) / 100;
    }
  }

  const total = Object.values(totais).reduce((s, v) => s + v, 0);
  if (!total) return { buckets: {}, total: 0 };

  const buckets = {};
  for (const [bk, bv] of Object.entries(BUCKETS)) {
    const soma = bv.classes.reduce((s, c) => s + (totais[c] || 0), 0);
    buckets[bk] = { valor: soma, pct: (soma / total) * 100 };
  }

  return { buckets, total };
}

/** Compara alocação real contra perfil alvo. Retorna desvios por bucket. */
export function calcularDesvio(carteira, perfilId, tolerancia = 5) {
  const perfil = PERFIS[perfilId];
  if (!perfil) return null;

  const { buckets, total } = calcularAlocacao(carteira);
  if (!total) return null;

  let maxDesvio = 0;
  const desvios = {};
  let desalinhado = false;

  for (const bk of BUCKET_KEYS) {
    const alvo = perfil.alocacao[bk] || 0;
    const real = buckets[bk]?.pct || 0;
    const delta = real - alvo;
    if (Math.abs(delta) > tolerancia && alvo > 0) desalinhado = true;
    // Considerar desalinhado mesmo quando alvo é 0 mas há alocação relevante
    if (Math.abs(delta) > tolerancia && alvo === 0 && real > tolerancia) desalinhado = true;
    if (Math.abs(delta) > maxDesvio) maxDesvio = Math.abs(delta);
    desvios[bk] = { alvo, real: parseFloat(real.toFixed(1)), delta: parseFloat(delta.toFixed(1)) };
  }

  return { desvios, maxDesvio: parseFloat(maxDesvio.toFixed(1)), desalinhado };
}
