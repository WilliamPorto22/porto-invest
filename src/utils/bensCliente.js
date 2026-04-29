// Utilidades para totalizar bens (imóveis e veículos) do cliente.
// As faixas refletem as definidas em ClienteFicha.jsx (FAIXAS_IMOVEL / FAIXAS_VEICULO).
// Mantenha sincronizado caso a ficha mude.

import { parseCentavos } from "./currency";

const FAIXAS_IMOVEL = [
  ...Array.from({ length: 50 }, (_, i) => {
    const v = (i + 1) * 100000;
    return { label: `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, mid: v };
  }),
  { label: "R$ 5.500.000,00", mid: 5500000 },
  { label: "R$ 6.000.000,00", mid: 6000000 },
  { label: "R$ 7.000.000,00", mid: 7000000 },
  { label: "R$ 8.000.000,00", mid: 8000000 },
  { label: "R$ 9.000.000,00", mid: 9000000 },
  { label: "R$ 10.000.000,00", mid: 10000000 },
  { label: "Acima de R$ 10M", mid: 12000000 },
];

const FAIXAS_VEICULO = [
  ...Array.from({ length: 50 }, (_, i) => {
    const v = (i + 1) * 10000;
    return { label: `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, mid: v };
  }),
  { label: "R$ 600.000,00", mid: 600000 },
  { label: "R$ 700.000,00", mid: 700000 },
  { label: "R$ 800.000,00", mid: 800000 },
  { label: "R$ 900.000,00", mid: 900000 },
  { label: "R$ 1.000.000,00", mid: 1000000 },
  { label: "Acima de R$ 1M", mid: 1200000 },
];

function midDaFaixa(tabela, faixaLabel) {
  if (!faixaLabel) return 0;
  const f = tabela.find((x) => x.label === faixaLabel);
  return f ? f.mid : 0;
}

export function totalImoveis(cliente) {
  const lista = Array.isArray(cliente?.imoveis) ? cliente.imoveis : [];
  return lista.reduce((acc, im) => {
    const mid = midDaFaixa(FAIXAS_IMOVEL, im?.faixa);
    const qt = Math.max(1, parseInt(im?.quantidade) || 1);
    return acc + mid * qt;
  }, 0);
}

export function totalVeiculos(cliente) {
  const lista = Array.isArray(cliente?.veiculos) ? cliente.veiculos : [];
  const arr = lista.reduce((acc, v) => {
    const mid = midDaFaixa(FAIXAS_VEICULO, v?.faixa);
    const qt = Math.max(1, parseInt(v?.quantidade) || 1);
    return acc + mid * qt;
  }, 0);
  // Suporta também o campo legado `veiculosManual` (string em centavos)
  const legado = parseCentavos(cliente?.veiculosManual) / 100;
  return arr + legado;
}

const CART_KEYS = [
  "posFixado", "ipca", "preFixado", "acoes", "fiis", "multi",
  "prevVGBL", "prevPGBL", "globalEquities", "globalTreasury",
  "globalFunds", "globalBonds", "global", "outros",
];

export function totalCarteiraCliente(cliente) {
  const carteira = cliente?.carteira || {};
  let total = 0;
  for (const k of CART_KEYS) {
    const ativos = carteira[k + "Ativos"];
    if (Array.isArray(ativos)) {
      total += ativos.reduce((a, at) => a + parseCentavos(at?.valor) / 100, 0);
    } else {
      total += parseCentavos(carteira[k]) / 100;
    }
  }
  return total;
}

export function patrimonioFinanceiro(cliente) {
  const carteira = totalCarteiraCliente(cliente);
  if (carteira > 0) return carteira;
  return parseCentavos(cliente?.patrimonio) / 100;
}

export function patrimonioConsolidado(cliente) {
  return patrimonioFinanceiro(cliente) + totalImoveis(cliente) + totalVeiculos(cliente);
}
