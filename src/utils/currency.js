/**
 * Currency & money helpers — única fonte de verdade do projeto.
 *
 * Convenção interna:
 * - "centavos" = inteiro (int). Fonte de armazenamento no Firestore (como string).
 * - "reais"    = número em R$ (pode ter decimais).
 *
 * Toda a lógica financeira deve operar em reais (number). A conversão
 * para/de centavos acontece nas bordas (input do usuário / persistência).
 */

/**
 * Converte string com máscara (ex: "R$ 1.234,56") para centavos (int).
 * Aceita null/undefined/number como entrada.
 *
 * @param {string|number|null|undefined} input
 * @returns {number} centavos como inteiro (>= 0)
 */
export function parseCentavos(input) {
  if (input == null) return 0;
  const only = String(input).replace(/\D/g, "");
  const n = parseInt(only, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Converte centavos (int) para reais (number).
 * @param {number} centavos
 * @returns {number}
 */
export function centavosToReais(centavos) {
  const n = Number(centavos) || 0;
  return n / 100;
}

/**
 * Converte reais (number) para centavos (int).
 * @param {number} reais
 * @returns {number}
 */
export function reaisToCentavos(reais) {
  const n = Number(reais) || 0;
  return Math.round(n * 100);
}

/**
 * Formata um valor em reais como moeda brasileira padrão.
 * Retorna "—" para zero/null/NaN.
 *
 * @param {number|string|null} valor  valor em reais (não centavos)
 * @param {object} [opts]
 * @param {boolean} [opts.zeroAsDash=true]  se true, zero vira "—"
 * @param {number}  [opts.minFraction=2]
 * @param {number}  [opts.maxFraction=2]
 * @returns {string}
 */
export function brl(valor, opts = {}) {
  const { zeroAsDash = true, minFraction = 2, maxFraction = 2 } = opts;
  const n = Number(valor);
  if (!Number.isFinite(n)) return zeroAsDash ? "—" : "R$ 0,00";
  if (!n && zeroAsDash) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
  });
}

/**
 * Formata valor em reais com abreviação (Mi / k).
 * Ex: 1.500.000 -> "R$ 1,50Mi"; 500.000 -> "R$ 500k"; 999 -> "R$ 999,00".
 *
 * @param {number} valor
 * @returns {string}
 */
export function formatMi(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || !n) return "—";
  if (n >= 1_000_000) {
    return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}Mi`;
  }
  if (n >= 1_000) {
    return `R$ ${(n / 1_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}k`;
  }
  return brl(n);
}

/**
 * Variante com "M" em vez de "Mi" (usada no Carteira.jsx).
 * @param {number} valor
 * @returns {string}
 */
export function brlCompact(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || !n) return "—";
  if (n >= 1_000_000) {
    return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}M`;
  }
  if (n >= 1_000) {
    return `R$ ${(n / 1_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}k`;
  }
  return brl(n);
}

/**
 * Formata centavos diretamente como string de moeda para exibição em inputs.
 * Retorna "" para zero (em vez de "—"), compatível com comportamento atual dos inputs.
 *
 * @param {number|string} centavos
 * @returns {string}
 */
export function moedaInput(centavos) {
  const n = parseCentavos(centavos);
  if (!n) return "";
  return (n / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formata centavos como moeda completa (usado em ClienteFicha/Diagnostico/FluxoMensal).
 * Retorna "—" para zero.
 *
 * @param {number|string} centavos
 * @returns {string}
 */
export function moedaFull(centavos) {
  const n = parseCentavos(centavos);
  return brl(n / 100);
}

/**
 * Alias legado usado em ObjetivoDetalhes/ClienteFicha: recebe centavos, retorna string.
 * @param {number|string} centavos
 * @returns {string}
 */
export function moeda(centavos) {
  const n = parseCentavos(centavos);
  if (!n) return "R$ 0,00";
  return brl(n / 100, { zeroAsDash: false });
}
