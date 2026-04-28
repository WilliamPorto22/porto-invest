// Scoring para a tabela dinâmica de ativos.
// Cada indicador:
//  - Classifica em 'positivo' | 'neutro' | 'negativo'  → cor da célula
//  - Rende pontos (0 a 100) × peso específico            → score composto
// Score final agregado determina sinal: 🟢 Compra, 🟡 Neutro, 🔴 Venda.

// ═══ Pesos por indicador ═══
// Baseado em qualidade / robustez do sinal:
// - Valor (P/L, P/VP, EV/EBITDA): peso 10 cada
// - Qualidade (ROE, ROIC, Margem): peso 12 cada
// - Crescimento (CAGR): peso 10 cada
// - Solidez (Dív/EBITDA, Cob Juros): peso 12 cada
// - DY: peso 8
const PESOS_ACOES = {
  pl: 10, pvp: 10, evEbitda: 10,
  roe: 12, roicAprox: 12, margemLiq: 10,
  cagrReceita: 10, cagrLucro: 10,
  divLiqEbitda: 12, cobJuros: 8,
  dy: 8, variacaoAno: 8,
};
const PESOS_FIIS = {
  dy: 18, pvp: 15, capRate: 12, vac: 12, wault: 10,
  tipoContrato: 5, alav: 10, inad: 10, crescDiv: 10, payoutRatio: 3,
  variacaoAno: 6,
};

// REITs americanos têm dinâmica diferente do FII brasileiro:
// - DY típico é 3-5% (vs. 9-12% do FII brasileiro), porque a maior parte do
//   retorno vem de valorização da cota e do FFO crescente.
// - P/VP > 1 é o padrão (não é "caro" como em FII brasileiro).
// - Métricas como cap rate, vacância e WAULT não vêm do Yahoo.
// Pesos focam no que Yahoo expõe: dy, pvp, pl, divLiqEbitda, payoutRatio, variacaoAno.
const PESOS_REITS = {
  dy: 14, pvp: 12, pl: 12, divLiqEbitda: 14, payoutRatio: 8, variacaoAno: 10,
};

// ═══ Classificação por faixa (por indicador) ═══
// Retorna: { status: 'positivo'|'neutro'|'negativo'|'sem-dado', pontos: 0-100, comentario }
function classificarIndicador(valor, regras) {
  if (valor == null || !Number.isFinite(valor)) {
    return { status: "sem-dado", pontos: 50, comentario: "N/D" };
  }
  for (const r of regras) {
    if (valor >= r.min && valor <= r.max) {
      return { status: r.status, pontos: r.pontos, comentario: r.msg };
    }
  }
  return { status: "neutro", pontos: 50, comentario: "Fora da faixa calibrada" };
}

// Regras por indicador (ações)
const REGRAS_ACOES = {
  pl: [
    { min: 0,   max: 8,   status: "positivo", pontos: 100, msg: "P/L muito baixo (Graham)" },
    { min: 8,   max: 12,  status: "positivo", pontos: 85,  msg: "P/L atrativo" },
    { min: 12,  max: 18,  status: "neutro",   pontos: 55,  msg: "P/L neutro" },
    { min: 18,  max: 25,  status: "neutro",   pontos: 35,  msg: "P/L esticado" },
    { min: 25,  max: 999, status: "negativo", pontos: 15,  msg: "P/L caro" },
  ],
  pvp: [
    { min: 0,   max: 1,   status: "positivo", pontos: 100, msg: "P/VP < 1 (Graham)" },
    { min: 1,   max: 1.5, status: "positivo", pontos: 80,  msg: "P/VP saudável" },
    { min: 1.5, max: 2.5, status: "neutro",   pontos: 50,  msg: "P/VP neutro" },
    { min: 2.5, max: 4,   status: "negativo", pontos: 25,  msg: "P/VP elevado" },
    { min: 4,   max: 99,  status: "negativo", pontos: 10,  msg: "P/VP muito caro" },
  ],
  evEbitda: [
    { min: 0,   max: 7,   status: "positivo", pontos: 100, msg: "EV/EBITDA baixo" },
    { min: 7,   max: 12,  status: "neutro",   pontos: 60,  msg: "EV/EBITDA normal" },
    { min: 12,  max: 20,  status: "negativo", pontos: 30,  msg: "EV/EBITDA alto" },
    { min: 20,  max: 999, status: "negativo", pontos: 10,  msg: "EV/EBITDA muito alto" },
  ],
  dy: [
    { min: 6,   max: 99,  status: "positivo", pontos: 100, msg: "DY > 6% (Bazin)" },
    { min: 4,   max: 6,   status: "positivo", pontos: 80,  msg: "DY atrativo" },
    { min: 2,   max: 4,   status: "neutro",   pontos: 50,  msg: "DY mediano" },
    { min: 0,   max: 2,   status: "negativo", pontos: 25,  msg: "DY baixo" },
  ],
  roe: [
    { min: 20,  max: 999, status: "positivo", pontos: 100, msg: "ROE > 20% (Buffett)" },
    { min: 15,  max: 20,  status: "positivo", pontos: 85,  msg: "ROE saudável" },
    { min: 10,  max: 15,  status: "neutro",   pontos: 55,  msg: "ROE mediano" },
    { min: 0,   max: 10,  status: "negativo", pontos: 25,  msg: "ROE baixo" },
    { min: -999, max: 0,  status: "negativo", pontos: 5,   msg: "ROE negativo — prejuízo" },
  ],
  roicAprox: [
    { min: 15,  max: 999, status: "positivo", pontos: 100, msg: "ROIC excelente" },
    { min: 10,  max: 15,  status: "positivo", pontos: 75,  msg: "ROIC bom" },
    { min: 5,   max: 10,  status: "neutro",   pontos: 45,  msg: "ROIC fraco" },
    { min: -999, max: 5,  status: "negativo", pontos: 15,  msg: "ROIC muito baixo" },
  ],
  margemLiq: [
    { min: 20,  max: 999, status: "positivo", pontos: 100, msg: "Margem líquida alta" },
    { min: 10,  max: 20,  status: "positivo", pontos: 75,  msg: "Margem saudável" },
    { min: 5,   max: 10,  status: "neutro",   pontos: 50,  msg: "Margem mediana" },
    { min: 0,   max: 5,   status: "negativo", pontos: 25,  msg: "Margem baixa" },
    { min: -999, max: 0,  status: "negativo", pontos: 5,   msg: "Prejuízo" },
  ],
  cagrReceita: [
    { min: 15,  max: 999, status: "positivo", pontos: 100, msg: "Crescimento forte" },
    { min: 5,   max: 15,  status: "positivo", pontos: 70,  msg: "Crescimento saudável" },
    { min: 0,   max: 5,   status: "neutro",   pontos: 45,  msg: "Crescimento lento" },
    { min: -999, max: 0,  status: "negativo", pontos: 20,  msg: "Receita em queda" },
  ],
  cagrLucro: [
    { min: 20,  max: 999, status: "positivo", pontos: 100, msg: "CAGR de lucro excelente" },
    { min: 10,  max: 20,  status: "positivo", pontos: 80,  msg: "CAGR de lucro bom" },
    { min: 0,   max: 10,  status: "neutro",   pontos: 50,  msg: "CAGR de lucro lento" },
    { min: -999, max: 0,  status: "negativo", pontos: 15,  msg: "Lucro em queda" },
  ],
  divLiqEbitda: [
    { min: -999, max: 1,  status: "positivo", pontos: 100, msg: "Dívida muito baixa" },
    { min: 1,   max: 2,   status: "positivo", pontos: 80,  msg: "Dívida confortável" },
    { min: 2,   max: 3,   status: "neutro",   pontos: 45,  msg: "Alavancagem moderada" },
    { min: 3,   max: 4,   status: "negativo", pontos: 20,  msg: "Alavancagem alta" },
    { min: 4,   max: 999, status: "negativo", pontos: 5,   msg: "Endividamento crítico" },
  ],
  cobJuros: [
    { min: 5,   max: 999, status: "positivo", pontos: 100, msg: "Cobertura muito confortável" },
    { min: 2.5, max: 5,   status: "positivo", pontos: 70,  msg: "Cobertura adequada" },
    { min: 1.5, max: 2.5, status: "neutro",   pontos: 40,  msg: "Cobertura apertada" },
    { min: -999, max: 1.5, status: "negativo", pontos: 10, msg: "Risco de default" },
  ],
  variacaoAno: [
    { min: 25,    max: 999, status: "positivo", pontos: 100, msg: "Valorização forte (>25%)" },
    { min: 10,    max: 25,  status: "positivo", pontos: 75,  msg: "Valorização saudável" },
    { min: 0,     max: 10,  status: "neutro",   pontos: 50,  msg: "Estável" },
    { min: -10,   max: 0,   status: "neutro",   pontos: 35,  msg: "Em correção leve" },
    { min: -25,   max: -10, status: "negativo", pontos: 20,  msg: "Tendência baixista" },
    { min: -999,  max: -25, status: "negativo", pontos: 5,   msg: "Queda forte (>-25%)" },
  ],
};

// Regras por indicador (FIIs) — quando dado disponível
const REGRAS_FIIS = {
  dy: [
    { min: 12, max: 99, status: "positivo", pontos: 100, msg: "DY > 12% (excepcional)" },
    { min: 9,  max: 12, status: "positivo", pontos: 80,  msg: "DY forte" },
    { min: 7,  max: 9,  status: "neutro",   pontos: 55,  msg: "DY na média" },
    { min: 0,  max: 7,  status: "negativo", pontos: 25,  msg: "DY abaixo da média" },
  ],
  pvp: [
    { min: 0,    max: 0.85, status: "positivo", pontos: 100, msg: "P/VP < 0,85 (desconto)" },
    { min: 0.85, max: 1,    status: "positivo", pontos: 80,  msg: "P/VP abaixo do VP" },
    { min: 1,    max: 1.1,  status: "neutro",   pontos: 55,  msg: "P/VP justo" },
    { min: 1.1,  max: 999,  status: "negativo", pontos: 25,  msg: "P/VP acima do VP" },
  ],
  capRate: [
    { min: 10, max: 99, status: "positivo", pontos: 100, msg: "Cap rate alto" },
    { min: 7,  max: 10, status: "neutro",   pontos: 55,  msg: "Cap rate médio" },
    { min: 0,  max: 7,  status: "negativo", pontos: 25,  msg: "Cap rate comprimido" },
  ],
  vac: [
    { min: 0,  max: 5,  status: "positivo", pontos: 100, msg: "Vacância muito baixa" },
    { min: 5,  max: 12, status: "neutro",   pontos: 50,  msg: "Vacância razoável" },
    { min: 12, max: 99, status: "negativo", pontos: 20,  msg: "Vacância alta" },
  ],
  wault: [
    { min: 6,  max: 999, status: "positivo", pontos: 100, msg: "WAULT longo" },
    { min: 3,  max: 6,   status: "neutro",   pontos: 55,  msg: "WAULT normal" },
    { min: 0,  max: 3,   status: "negativo", pontos: 25,  msg: "WAULT curto" },
  ],
  alav: [
    { min: 0,  max: 20, status: "positivo", pontos: 100, msg: "Sem alavancagem" },
    { min: 20, max: 40, status: "neutro",   pontos: 55,  msg: "Alavancagem moderada" },
    { min: 40, max: 99, status: "negativo", pontos: 25,  msg: "Alavancagem agressiva" },
  ],
  inad: [
    { min: 0, max: 1,  status: "positivo", pontos: 100, msg: "Inadimplência baixa" },
    { min: 1, max: 3,  status: "neutro",   pontos: 50,  msg: "Inadimplência normal" },
    { min: 3, max: 99, status: "negativo", pontos: 20,  msg: "Inadimplência alta" },
  ],
  crescDiv: [
    { min: 5,    max: 99,  status: "positivo", pontos: 100, msg: "Dividendos crescendo" },
    { min: 0,    max: 5,   status: "neutro",   pontos: 55,  msg: "Dividendos estáveis" },
    { min: -999, max: 0,   status: "negativo", pontos: 20,  msg: "Dividendos em queda" },
  ],
  payoutRatio: [
    { min: 0,   max: 100, status: "neutro", pontos: 55, msg: "Dentro da norma" },
    { min: 100, max: 999, status: "negativo", pontos: 25, msg: "Payout acima de 100%" },
  ],
  variacaoAno: [
    { min: 15,    max: 999, status: "positivo", pontos: 100, msg: "Valorização forte" },
    { min: 5,     max: 15,  status: "positivo", pontos: 75,  msg: "Valorização saudável" },
    { min: 0,     max: 5,   status: "neutro",   pontos: 50,  msg: "Estável" },
    { min: -10,   max: 0,   status: "neutro",   pontos: 35,  msg: "Correção leve" },
    { min: -999,  max: -10, status: "negativo", pontos: 20,  msg: "Em queda" },
  ],
};

// Regras calibradas para REITs americanos (faixas diferentes do FII brasileiro).
// Reusa nomes dos campos pra continuar compatível com o Yahoo + glossário.
const REGRAS_REITS = {
  dy: [
    { min: 6,   max: 99,  status: "positivo", pontos: 100, msg: "DY > 6% (forte para REIT)" },
    { min: 4,   max: 6,   status: "positivo", pontos: 80,  msg: "DY saudável" },
    { min: 2.5, max: 4,   status: "neutro",   pontos: 55,  msg: "DY na média" },
    { min: 0,   max: 2.5, status: "negativo", pontos: 25,  msg: "DY baixo para REIT" },
  ],
  pvp: [
    { min: 0,   max: 1,   status: "positivo", pontos: 100, msg: "P/VP < 1 (desconto raro)" },
    { min: 1,   max: 1.5, status: "positivo", pontos: 75,  msg: "P/VP dentro do normal" },
    { min: 1.5, max: 2.5, status: "neutro",   pontos: 50,  msg: "P/VP elevado" },
    { min: 2.5, max: 99,  status: "negativo", pontos: 25,  msg: "P/VP caro" },
  ],
  pl: [
    // REITs reportam earnings com depreciação alta — P/L elevado é normal.
    // Foque em FFO; aqui o P/L só serve como proxy.
    { min: 0,   max: 18,  status: "positivo", pontos: 90,  msg: "P/L baixo para REIT" },
    { min: 18,  max: 35,  status: "neutro",   pontos: 60,  msg: "P/L típico de REIT" },
    { min: 35,  max: 60,  status: "neutro",   pontos: 40,  msg: "P/L esticado" },
    { min: 60,  max: 999, status: "negativo", pontos: 20,  msg: "P/L muito alto" },
  ],
  divLiqEbitda: [
    { min: -999, max: 4,  status: "positivo", pontos: 100, msg: "Endividamento baixo" },
    { min: 4,   max: 6,   status: "positivo", pontos: 75,  msg: "Endividamento normal de REIT" },
    { min: 6,   max: 8,   status: "neutro",   pontos: 45,  msg: "Endividamento alto" },
    { min: 8,   max: 999, status: "negativo", pontos: 15,  msg: "Endividamento crítico" },
  ],
  payoutRatio: [
    // REIT americano é obrigado por lei (90%+); 100-200% é o padrão por causa
    // da depreciação contábil. Acima de 200% começa a sinalizar fragilidade.
    { min: 0,    max: 100, status: "positivo", pontos: 80,  msg: "Payout conservador" },
    { min: 100,  max: 200, status: "neutro",   pontos: 60,  msg: "Payout típico de REIT" },
    { min: 200,  max: 300, status: "neutro",   pontos: 35,  msg: "Payout elevado" },
    { min: 300,  max: 999, status: "negativo", pontos: 15,  msg: "Payout insustentável" },
  ],
  variacaoAno: [
    { min: 20,   max: 999, status: "positivo", pontos: 100, msg: "Valorização forte" },
    { min: 5,    max: 20,  status: "positivo", pontos: 75,  msg: "Valorização saudável" },
    { min: -5,   max: 5,   status: "neutro",   pontos: 55,  msg: "Estável" },
    { min: -20,  max: -5,  status: "neutro",   pontos: 35,  msg: "Correção moderada" },
    { min: -999, max: -20, status: "negativo", pontos: 15,  msg: "Em queda forte" },
  ],
};

// ═══ Gera análise completa de um ativo ═══
export function analisarAtivo(ativo, classe) {
  let pesos, regras;
  if (classe === "reits") {
    pesos = PESOS_REITS;
    regras = REGRAS_REITS;
  } else if (classe === "fiis") {
    pesos = PESOS_FIIS;
    regras = REGRAS_FIIS;
  } else {
    pesos = PESOS_ACOES;
    regras = REGRAS_ACOES;
  }

  const indicadores = {};
  let somaPond = 0;
  let somaPesos = 0;

  for (const [key, peso] of Object.entries(pesos)) {
    if (!regras[key]) {
      indicadores[key] = { status: "sem-dado", pontos: 50, valor: ativo[key] ?? null, comentario: "Sem regra" };
      continue;
    }
    const cls = classificarIndicador(ativo[key], regras[key]);
    indicadores[key] = { ...cls, valor: ativo[key] ?? null };
    if (cls.status !== "sem-dado") {
      somaPond += cls.pontos * peso;
      somaPesos += peso;
    }
  }

  const score = somaPesos > 0 ? Math.round(somaPond / somaPesos) : 50;
  const faixa = score >= 75 ? "Excelente" : score >= 60 ? "Boa" : score >= 45 ? "Neutra" : score >= 30 ? "Fraca" : "Evitar";

  // Sinal final
  // Threshold de venda alinhado com scoringEngine.js: só recomenda saída
  // se score < 50 (faixa Fraca ou Evitar). Entre 50 e 69 fica neutro.
  let sinal;
  if (score >= 70) sinal = "compra";
  else if (score >= 50) sinal = "neutro";
  else sinal = "venda";

  // Conta indicadores em cada categoria (para detectar inconsistência)
  const positivos = Object.values(indicadores).filter(i => i.status === "positivo").length;
  const negativos = Object.values(indicadores).filter(i => i.status === "negativo").length;

  // Inconsistência: score alto mas muitos negativos, ou score baixo mas muitos positivos
  let alerta = null;
  if (score >= 60 && negativos >= 4) {
    alerta = "Score bom mas várias dimensões negativas — revisar manualmente";
  } else if (score < 40 && positivos >= 4) {
    alerta = "Score baixo apesar de pontos positivos — considerar contexto setorial";
  }

  return {
    score,
    faixa,
    sinal,                  // 'compra' | 'neutro' | 'venda'
    indicadores,            // { pl: { status, pontos, valor, comentario }, ... }
    positivos,
    negativos,
    alerta,
  };
}
