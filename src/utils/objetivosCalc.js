/**
 * Utilitários de Cálculo para Objetivos Financeiros
 * Funções reutilizáveis para simulações e projeções.
 *
 * Todas as funções operam em REAIS (não centavos). A conversão
 * centavos ↔ reais fica nas páginas (ver utils/currency.js).
 */

export const TAXA_ANUAL = 14;
export const IPCA_ANUAL = 3.81;

// Converte taxa anual (%) para taxa mensal equivalente (capitalização composta).
function taxaMensal(taxaAnual) {
  return Math.pow(1 + taxaAnual / 100, 1 / 12) - 1;
}

/**
 * Calcula valor final com juros compostos e aportes mensais.
 * @param {number} inicial - Patrimônio inicial (em reais)
 * @param {number} aporteMensal - Aporte mensal (em reais)
 * @param {number} prazo - Prazo em anos
 * @param {number} taxaAnual - Taxa anual em % (default 14)
 * @returns {number} Valor final nominal (reais)
 */
export function calcularValorFinal(inicial, aporteMensal, prazo, taxaAnual = TAXA_ANUAL) {
  const j = taxaMensal(taxaAnual);
  const meses = Math.max(0, Math.round(prazo * 12));
  let valor = inicial;
  for (let m = 0; m < meses; m++) {
    valor = valor * (1 + j) + aporteMensal;
  }
  return valor;
}

/**
 * Encontra o aporte mensal necessário para atingir uma meta em determinado prazo.
 * Usa busca binária (100 iterações, converge em ~centavos).
 *
 * @param {number} inicial
 * @param {number} meta
 * @param {number} prazo - anos
 * @param {number} taxaAnual - %
 * @returns {number} Aporte mensal (reais, 2 casas decimais)
 */
export function encontrarAporteNecessario(inicial, meta, prazo, taxaAnual = TAXA_ANUAL) {
  if (prazo <= 0) return Math.max(0, meta - inicial);
  if (inicial >= meta) return 0;

  let min = 0;
  let max = meta; // upper bound seguro
  for (let iter = 0; iter < 100; iter++) {
    const mid = (min + max) / 2;
    const valor = calcularValorFinal(inicial, mid, prazo, taxaAnual);
    if (valor < meta) min = mid;
    else max = mid;
    if (max - min < 0.01) break;
  }
  return Math.ceil(((min + max) / 2) * 100) / 100;
}

/**
 * Encontra quantos anos são necessários para atingir a meta EM TERMOS REAIS
 * (descontada a inflação).
 *
 * @param {number} inicial
 * @param {number} aporteMensal
 * @param {number} meta
 * @param {object} [opts]
 * @param {number} [opts.maxAnos=50]
 * @param {number} [opts.taxaAnual=14]
 * @param {number} [opts.ipcaAnual=3.81]
 * @returns {number|null} Anos (1 casa decimal) ou null se não atingir dentro de maxAnos.
 *
 * Assinatura legada também aceita (inicial, aporte, meta, maxAnos, taxaAnual)
 * para compatibilidade com chamadas antigas.
 */
export function encontrarAnosNecessarios(inicial, aporteMensal, meta, optsOrMaxAnos = 50, legacyTaxa) {
  let maxAnos = 50;
  let taxaAnual = TAXA_ANUAL;
  let ipcaAnual = IPCA_ANUAL;

  if (typeof optsOrMaxAnos === "object" && optsOrMaxAnos !== null) {
    if (optsOrMaxAnos.maxAnos != null) maxAnos = optsOrMaxAnos.maxAnos;
    if (optsOrMaxAnos.taxaAnual != null) taxaAnual = optsOrMaxAnos.taxaAnual;
    if (optsOrMaxAnos.ipcaAnual != null) ipcaAnual = optsOrMaxAnos.ipcaAnual;
  } else {
    maxAnos = optsOrMaxAnos;
    if (legacyTaxa != null) taxaAnual = legacyTaxa;
  }

  const j = taxaMensal(taxaAnual);
  const inflMensal = taxaMensal(ipcaAnual);
  let vt = inicial;
  for (let mes = 1; mes <= maxAnos * 12; mes++) {
    vt = vt * (1 + j) + aporteMensal;
    const totalReal = vt / Math.pow(1 + inflMensal, mes);
    if (totalReal >= meta) {
      return Math.round((mes / 12) * 10) / 10;
    }
  }
  return null;
}

/**
 * Alias mais explícito para encontrarAnosNecessarios com objeto de opções.
 * Preferir este em código novo.
 */
export function calcularAnosParaMeta(inicial, aporte, meta, opts = {}) {
  return encontrarAnosNecessarios(inicial, aporte, meta, opts);
}

/**
 * Simula o impacto de aumentar o aporte.
 */
export function simularNovoAporte(inicial, meta, prazoAtual, novoAporte) {
  const anosNecessarios = encontrarAnosNecessarios(inicial, novoAporte, meta);
  const anosAtual = prazoAtual || 50;
  return {
    prazoAtual: anosAtual,
    prazoNovo: anosNecessarios,
    economia: anosAtual - (anosNecessarios || 50),
    viavel: anosNecessarios !== null,
  };
}

/**
 * Simula o impacto de uma nova taxa de rentabilidade.
 */
export function simularNovaTaxa(inicial, aporteMensal, meta, prazoAtual, novaTaxaAnual) {
  const anosNecessarios = encontrarAnosNecessarios(inicial, aporteMensal, meta, {
    taxaAnual: novaTaxaAnual,
  });
  const anosAtual = prazoAtual || 50;
  return {
    prazoAtual: anosAtual,
    prazoNovo: anosNecessarios,
    economia: anosAtual - (anosNecessarios || 50),
    viavel: anosNecessarios !== null,
    taxaNova: novaTaxaAnual,
  };
}

/**
 * Simula o impacto de estender o prazo.
 */
export function simularNovoPrazo(inicial, aporteMensal, meta, novoPrazo) {
  const aporteNecessario = encontrarAporteNecessario(inicial, meta, novoPrazo);
  const reducao = aporteMensal > 0 ? ((aporteMensal - aporteNecessario) / aporteMensal) * 100 : 0;
  return {
    aporteAtual: aporteMensal,
    aporteNecessario,
    reducao,
    viavel: aporteNecessario <= aporteMensal,
  };
}

/**
 * Calcula tabela de projeção ano a ano descontando inflação.
 *
 * @param {number} inicial
 * @param {number} aporteMensal
 * @param {number} anos
 * @param {number|object} [taxaOrOpts=14]  taxa anual OU { taxaAnual, ipcaAnual }
 * @returns {Array<{ano,totalNominal,totalReal,rendaMensalReal,mes}>}
 */
export function calcularProjecao(inicial, aporteMensal, anos, taxaOrOpts = TAXA_ANUAL) {
  let taxaAnual = TAXA_ANUAL;
  let ipcaAnual = IPCA_ANUAL;
  if (typeof taxaOrOpts === "object" && taxaOrOpts !== null) {
    if (taxaOrOpts.taxaAnual != null) taxaAnual = taxaOrOpts.taxaAnual;
    if (taxaOrOpts.ipcaAnual != null) ipcaAnual = taxaOrOpts.ipcaAnual;
  } else {
    taxaAnual = taxaOrOpts;
  }

  const j = taxaMensal(taxaAnual);
  const inflMensal = taxaMensal(ipcaAnual);

  let vt = inicial;
  const tabela = [];
  const totalMeses = Math.max(0, Math.round(anos * 12));

  for (let mes = 1; mes <= totalMeses; mes++) {
    vt = vt * (1 + j) + aporteMensal;
    if (mes % 12 === 0) {
      const totalReal = vt / Math.pow(1 + inflMensal, mes);
      tabela.push({
        ano: mes / 12,
        totalNominal: Math.round(vt),
        totalReal: Math.round(totalReal),
        rendaMensalReal: Math.round(totalReal * j),
        mes,
      });
    }
  }
  return tabela;
}

/**
 * Classifica o status de um plano.
 * @returns {"viavel"|"ajustavel"|"inviavel"}
 */
export function classificarStatus(anosNecessarios, prazoDesejado) {
  if (anosNecessarios == null || !Number.isFinite(anosNecessarios)) return "inviavel";
  const p = Number(prazoDesejado) || 0;
  const diff = anosNecessarios - p;
  if (diff <= 0) return "viavel";
  if (diff <= 2) return "ajustavel";
  return "inviavel";
}

/**
 * Calcula se o cliente atingiu a meta de aporte no mês.
 */
export function avaliarAporteMensal(aporteRealizado, aporteMetaMensal) {
  if (!aporteMetaMensal) return { atingiu: true, percentual: 100, diferenca: 0 };
  const percentual = (aporteRealizado / aporteMetaMensal) * 100;
  return {
    atingiu: aporteRealizado >= aporteMetaMensal,
    percentual: Math.round(percentual),
    diferenca: aporteRealizado - aporteMetaMensal,
  };
}

/**
 * Patrimônio esperado após N meses (nominal).
 */
export function patrimonioEsperadoAteOMes(inicial, aporteMensal, mesAtual, taxaAnual = TAXA_ANUAL) {
  const j = taxaMensal(taxaAnual);
  let valor = inicial;
  for (let m = 0; m < mesAtual; m++) {
    valor = valor * (1 + j) + aporteMensal;
  }
  return valor;
}

// ─── Aliases de compatibilidade com código legado em Objetivos.jsx ───
export const encontrarAnos = encontrarAnosNecessarios;
export const calcularTabela = calcularProjecao;
export const calcularAporteNecessario = encontrarAporteNecessario;
export const classificar = classificarStatus;
