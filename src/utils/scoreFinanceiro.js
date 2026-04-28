// Score de saude financeira 0 a 100.
// Baseado em 3 dimensoes objetivas: margem, comprometimento e detalhamento.

export function calcularScoreFinanceiro({ renda, gastos, sobra, totalCategorias, categoriasPreenchidas }) {
  // Sem renda nao da pra calcular nada.
  if (!renda || renda <= 0) {
    return { score: 0, faixa: "indefinido", componentes: null };
  }

  const txSobra = sobra / renda;
  const txGasto = gastos / renda;

  // 1. Margem (50 pontos): quanto sobra da renda.
  let pMargem;
  if (txSobra >= 0.30) pMargem = 50;
  else if (txSobra >= 0.20) pMargem = 40;
  else if (txSobra >= 0.10) pMargem = 28;
  else if (txSobra >= 0.05) pMargem = 18;
  else if (txSobra >= 0) pMargem = 10;
  else pMargem = 0;

  // 2. Comprometimento (30 pontos): gastos sobre renda.
  let pComp;
  if (txGasto < 0.60) pComp = 30;
  else if (txGasto < 0.75) pComp = 22;
  else if (txGasto < 0.90) pComp = 14;
  else if (txGasto < 1.00) pComp = 7;
  else pComp = 0;

  // 3. Detalhamento (20 pontos): quantas categorias estao preenchidas.
  const ratio = totalCategorias > 0 ? categoriasPreenchidas / totalCategorias : 0;
  let pDet;
  if (ratio >= 0.7) pDet = 20;
  else if (ratio >= 0.5) pDet = 14;
  else if (ratio >= 0.3) pDet = 8;
  else if (ratio > 0) pDet = 4;
  else pDet = 0;

  const score = Math.round(pMargem + pComp + pDet);

  let faixa;
  if (score >= 80) faixa = "excelente";
  else if (score >= 60) faixa = "boa";
  else if (score >= 40) faixa = "atencao";
  else faixa = "critica";

  return {
    score,
    faixa,
    componentes: { margem: pMargem, comprometimento: pComp, detalhamento: pDet },
  };
}

export const FAIXA_LABEL = {
  excelente: "Excelente",
  boa: "Boa",
  atencao: "Atencao",
  critica: "Critica",
  indefinido: "Informe sua renda",
};

export const FAIXA_COR = {
  excelente: "#34d399",
  boa: "#a3e635",
  atencao: "#fbbf24",
  critica: "#ef4444",
  indefinido: "#64748b",
};
