// Determina se o perfil do cliente está pronto para destravar o Diagnóstico.
// Critérios (todos obrigatórios):
//   1. Tem ao menos 1 objetivo cadastrado
//   2. Tem ao menos 1 lançamento de receita (ou salário declarado)
//   3. Tem ao menos 1 lançamento de despesa (ou gasto mensal declarado)
//   4. Tem ao menos 1 ativo na carteira (qualquer classe) ou patrimônio manual

import { parseCentavos } from "./currency";

const CART_KEYS = [
  "posFixado", "ipca", "preFixado", "acoes", "fiis", "multi",
  "prevVGBL", "prevPGBL", "globalEquities", "globalTreasury",
  "globalFunds", "globalBonds", "global", "outros",
];

function temAtivoNaCarteira(cliente) {
  const carteira = cliente?.carteira || {};
  for (const k of CART_KEYS) {
    const ativos = carteira[k + "Ativos"];
    if (Array.isArray(ativos) && ativos.length > 0) {
      const algumComValor = ativos.some(a => parseCentavos(a?.valor) > 0);
      if (algumComValor) return true;
    }
    if (parseCentavos(carteira[k]) > 0) return true;
  }
  return parseCentavos(cliente?.patrimonio) > 0;
}

function temReceita(cliente) {
  // Lançamentos do FluxoMensal: cliente.fluxoLancamentos[].tipo === "receita"
  const lan = cliente?.fluxoLancamentos;
  if (Array.isArray(lan) && lan.some(l => l?.tipo === "receita" && parseCentavos(l?.valor) > 0)) {
    return true;
  }
  // Fallback: salário mensal declarado no cadastro antigo
  return parseCentavos(cliente?.salarioMensal) > 0;
}

function temDespesa(cliente) {
  const lan = cliente?.fluxoLancamentos;
  if (Array.isArray(lan) && lan.some(l => l?.tipo === "despesa" && parseCentavos(l?.valor) > 0)) {
    return true;
  }
  return parseCentavos(cliente?.gastosMensaisManual) > 0;
}

function temObjetivo(cliente) {
  return Array.isArray(cliente?.objetivos) && cliente.objetivos.length > 0;
}

/**
 * @param {object} cliente - documento do cliente (snap completo)
 * @returns {{ completo: boolean, total: number, feitos: number, itens: Array<{key:string,label:string,feito:boolean,rota:string}> }}
 */
export function perfilCompleto(cliente) {
  const itens = [
    { key: "cadastro",  label: "Cadastro pessoal",      feito: !!(cliente?.nome && cliente?.email), rota: "/me/home?aba=cadastro" },
    { key: "objetivo",  label: "Pelo menos um sonho",   feito: temObjetivo(cliente),  rota: "/me/objetivos" },
    { key: "receita",   label: "Suas receitas do mês",  feito: temReceita(cliente),   rota: "/me/fluxo" },
    { key: "despesa",   label: "Seus gastos do mês",    feito: temDespesa(cliente),   rota: "/me/fluxo" },
    { key: "carteira",  label: "Sua carteira atual",    feito: temAtivoNaCarteira(cliente), rota: "/me/carteira" },
  ];
  const feitos = itens.filter(i => i.feito).length;
  return {
    completo: feitos === itens.length,
    total: itens.length,
    feitos,
    itens,
  };
}
