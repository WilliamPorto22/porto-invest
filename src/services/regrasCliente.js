/**
 * Engine único de regras do cliente.
 *
 * Centraliza toda a lógica de "o que está pendente?" e "o que já está OK?"
 * usado por:
 *   - NotificacoesBell  (sino com badge)
 *   - HomeLiberdade     (cards de Próximos Passos)
 *
 * Regras retornam objetos no formato:
 *   {
 *     id:        string  // estável, usado pra dedup e localStorage
 *     prio:      "urgente" | "atencao" | "ok"
 *     icone:     string  // emoji
 *     titulo:    string
 *     desc:      string
 *     cta:       string  // texto do botão
 *     acao:      "carteira" | "objetivos" | "criar-objetivo:<tipo>"
 *     completa:  boolean // a regra já foi cumprida?
 *     parabens?: string  // mensagem de celebração quando completa = true
 *   }
 *
 * O consumidor decide se mostra completas (HomeLiberdade mostra como "EM DIA",
 * Bell as filtra do badge mas mostra o parabéns como toast no momento da
 * transição).
 *
 * Premissas do William (assessor):
 *   - Todo cliente PRECISA ter plano de aposentadoria.
 *   - Reserva de emergência = 6× gastos mensais.
 *   - Se não tem casa (imoveis vazio) → criar plano de imóvel.
 *   - Se não tem carro (veiculos vazio) → criar plano de veículo.
 *   - Sem objetivo de viagem → sugerir (prioridade baixa).
 *   - Liquidez (reserva) é detectada por ativo.objetivo === "Liquidez".
 */

import { parseCentavos, brl } from "../utils/currency";
import {
  encontrarAnosNecessarios,
  classificarStatus,
} from "../utils/objetivosCalc";

const CART_KEYS = [
  "posFixado", "ipca", "preFixado", "acoes", "fiis", "multi",
  "prevVGBL", "prevPGBL", "globalEquities", "globalTreasury",
  "globalFunds", "globalBonds", "global", "outros",
];

// ── Helpers internos ──────────────────────────────────────────

function getReservaEmergencia(c) {
  const carteira = c?.carteira || {};
  const engaged = CART_KEYS.some(k => Array.isArray(carteira[k + "Ativos"]));
  if (!engaged) {
    return parseCentavos(carteira.liquidezD1) / 100
        || parseCentavos(carteira.posFixado) / 100;
  }
  return CART_KEYS.reduce((acc, k) => {
    const ativos = carteira[k + "Ativos"];
    if (!Array.isArray(ativos)) return acc;
    return acc + ativos.reduce((a, at) => {
      const isLiquidez = (at.objetivo || "").toLowerCase() === "liquidez";
      return a + (isLiquidez ? parseCentavos(at.valor) / 100 : 0);
    }, 0);
  }, 0);
}

// Soma valor alocado a um objetivo (matching pelo label do tipo)
function getValorAlocado(c, tipos) {
  const carteira = c?.carteira || {};
  const tiposLower = (Array.isArray(tipos) ? tipos : [tipos]).map(t => t.toLowerCase());
  let total = 0;
  for (const k of CART_KEYS) {
    const ativos = carteira[k + "Ativos"];
    if (!Array.isArray(ativos)) continue;
    for (const at of ativos) {
      const o = (at.objetivo || "").toLowerCase();
      if (tiposLower.some(t => o.includes(t))) {
        total += parseCentavos(at.valor) / 100;
      }
    }
  }
  return total;
}

function temObjetivoTipo(cliente, tipo) {
  return (cliente?.objetivos || []).some(o => o.tipo === tipo);
}

// ── Regras individuais ────────────────────────────────────────

function regraAposentadoria(cliente) {
  const apos = (cliente?.objetivos || []).find(o => o.tipo === "aposentadoria");
  if (!apos) {
    return {
      id: "aposentadoria-criar",
      prio: "urgente",
      icone: "🌴",
      titulo: "Defina sua liberdade financeira",
      desc: "Quanto você quer receber por mês quando se aposentar?",
      cta: "Configurar agora",
      acao: "criar-objetivo:aposentadoria",
      completa: false,
    };
  }
  // Avalia viabilidade
  const inicial = parseCentavos(apos.patrimAtual) / 100;
  const aporte = parseCentavos(apos.aporte) / 100;
  const meta = parseCentavos(apos.meta) / 100;
  const prazo = parseInt(apos.prazo) || 0;
  if (meta <= 0 || prazo <= 0) {
    return {
      id: "aposentadoria-incompleta",
      prio: "atencao",
      icone: "🌴",
      titulo: "Complete seu plano de aposentadoria",
      desc: "Falta definir meta ou prazo.",
      cta: "Completar",
      acao: "objetivos",
      completa: false,
    };
  }
  const anosNec = encontrarAnosNecessarios(inicial, aporte, meta);
  const status = classificarStatus(anosNec, prazo);
  if (status === "inviavel") {
    return {
      id: "aposentadoria-inviavel",
      prio: "urgente",
      icone: "⚠️",
      titulo: "Aposentadoria fora do prazo",
      desc: `No ritmo atual leva ${anosNec ? anosNec + " anos" : "50+ anos"} em vez de ${prazo}.`,
      cta: "Ajustar plano",
      acao: "objetivos",
      completa: false,
    };
  }
  if (status === "ajustavel") {
    return {
      id: "aposentadoria-ajustavel",
      prio: "atencao",
      icone: "⚖️",
      titulo: "Aposentadoria precisa de ajuste",
      desc: "Pequeno aumento no aporte mensal resolve.",
      cta: "Ver detalhes",
      acao: "objetivos",
      completa: false,
    };
  }
  // Viável
  return {
    id: "aposentadoria-ok",
    prio: "ok",
    icone: "🌴",
    titulo: "Aposentadoria no caminho",
    desc: `Mantendo o aporte, você atinge em ${prazo} anos.`,
    cta: "Ver plano",
    acao: "objetivos",
    completa: true,
    parabens: "🎉 Plano de aposentadoria está saudável!",
  };
}

function regraReservaEmergencia(cliente) {
  const gastos = parseCentavos(cliente?.gastosMensaisManual) / 100;
  if (gastos <= 0) {
    return {
      id: "reserva-sem-gastos",
      prio: "atencao",
      icone: "📊",
      titulo: "Cadastre seus gastos mensais",
      desc: "Sem isso não dá pra calcular reserva nem aposentadoria.",
      cta: "Cadastrar fluxo",
      acao: "fluxo",
      completa: false,
    };
  }
  const reservaAtual = getReservaEmergencia(cliente);
  const reservaIdeal = gastos * 6;
  if (reservaAtual >= reservaIdeal) {
    return {
      id: "reserva-ok",
      prio: "ok",
      icone: "🛟",
      titulo: "Reserva de emergência completa",
      desc: `${brl(reservaAtual)} = ${(reservaAtual / gastos).toFixed(1)} meses de gastos.`,
      cta: "Ver carteira",
      acao: "carteira",
      completa: true,
      parabens: "🎉 Parabéns! Sua reserva de emergência está completa.",
    };
  }
  if (reservaAtual <= 0) {
    return {
      id: "reserva-zero",
      prio: "urgente",
      icone: "🛟",
      titulo: "Crie sua reserva de emergência",
      desc: `Ideal: ${brl(reservaIdeal)} (6 meses). Antes de qualquer outro investimento.`,
      cta: "Como construir",
      acao: "carteira",
      completa: false,
    };
  }
  const falta = reservaIdeal - reservaAtual;
  return {
    id: "reserva-baixa",
    prio: "atencao",
    icone: "🛟",
    titulo: "Reforce sua reserva",
    desc: `Faltam ${brl(falta)} pra 6 meses de gastos.`,
    cta: "Aportar",
    acao: "carteira",
    completa: false,
  };
}

function regraImovel(cliente) {
  const imoveis = cliente?.imoveis || [];
  const temObjImovel = temObjetivoTipo(cliente, "imovel");
  if (imoveis.length > 0) {
    return null; // já tem casa: não gera alerta
  }
  if (!temObjImovel) {
    return {
      id: "imovel-sem-plano",
      prio: "atencao",
      icone: "🏠",
      titulo: "Você ainda não tem um imóvel",
      desc: "Crie um plano de aquisição de imóvel pra organizar a meta.",
      cta: "Criar plano de imóvel",
      acao: "criar-objetivo:imovel",
      completa: false,
    };
  }
  // tem objetivo de imóvel: avalia status
  const obj = cliente.objetivos.find(o => o.tipo === "imovel");
  return avaliarObjetivo(obj, "🏠", "imovel");
}

function regraCarro(cliente) {
  const veiculos = cliente?.veiculos || [];
  const temObjCarro = temObjetivoTipo(cliente, "carro");
  if (veiculos.length > 0) {
    return null; // já tem carro
  }
  if (!temObjCarro) {
    return {
      id: "carro-sem-plano",
      prio: "atencao",
      icone: "🚗",
      titulo: "Você ainda não tem um veículo",
      desc: "Crie um plano de veículo pra evitar comprometer a reserva.",
      cta: "Criar plano de veículo",
      acao: "criar-objetivo:carro",
      completa: false,
    };
  }
  const obj = cliente.objetivos.find(o => o.tipo === "carro");
  return avaliarObjetivo(obj, "🚗", "carro");
}

function regraViagem(cliente) {
  if (temObjetivoTipo(cliente, "viagem")) {
    const obj = cliente.objetivos.find(o => o.tipo === "viagem");
    return avaliarObjetivo(obj, "✈️", "viagem");
  }
  return {
    id: "viagem-sem-plano",
    prio: "ok", // baixa prioridade, sugestivo
    icone: "✈️",
    titulo: "Que tal planejar uma viagem?",
    desc: "Defina destino, prazo e aporte mensal pra realizar sem culpa.",
    cta: "Criar plano de viagem",
    acao: "criar-objetivo:viagem",
    completa: false,
  };
}

// Avaliador genérico de objetivo existente (status viável/ajustável/inviável)
function avaliarObjetivo(obj, icone, tipo) {
  if (!obj) return null;
  const inicial = parseCentavos(obj.patrimAtual) / 100;
  const aporte = parseCentavos(obj.aporte) / 100;
  const meta = parseCentavos(obj.meta) / 100;
  const prazo = parseInt(obj.prazo) || 0;
  const nome = obj.nomeCustom || obj.label || tipo;
  if (meta <= 0 || prazo <= 0) {
    return {
      id: `${tipo}-incompleto`,
      prio: "atencao",
      icone,
      titulo: `${nome} incompleto`,
      desc: "Falta definir meta ou prazo.",
      cta: "Completar",
      acao: "objetivos",
      completa: false,
    };
  }
  const anosNec = encontrarAnosNecessarios(inicial, aporte, meta);
  const status = classificarStatus(anosNec, prazo);
  if (status === "inviavel") {
    return {
      id: `${tipo}-inviavel`,
      prio: "urgente",
      icone: "⚠️",
      titulo: `${nome} fora do prazo`,
      desc: `Levaria ${anosNec ? anosNec + " anos" : "50+ anos"} em vez de ${prazo}.`,
      cta: "Ajustar plano",
      acao: "objetivos",
      completa: false,
    };
  }
  if (status === "ajustavel") {
    return {
      id: `${tipo}-ajustavel`,
      prio: "atencao",
      icone: "⚖️",
      titulo: `${nome} precisa de ajuste`,
      desc: "Pequeno aumento no aporte resolve.",
      cta: "Ver detalhes",
      acao: "objetivos",
      completa: false,
    };
  }
  return {
    id: `${tipo}-ok`,
    prio: "ok",
    icone,
    titulo: `${nome} no caminho`,
    desc: `Atinge em ${prazo} anos no ritmo atual.`,
    cta: "Ver plano",
    acao: "objetivos",
    completa: true,
    parabens: `🎉 ${nome} está saudável!`,
  };
}

// ── API pública ───────────────────────────────────────────────

/**
 * Gera todas as regras aplicáveis ao cliente.
 * @param {object} cliente - doc completo do cliente (snap.data())
 * @returns {Array<Regra>} ordenadas por prioridade (urgente → atencao → ok)
 */
export function gerarRegrasCliente(cliente) {
  if (!cliente) return [];
  const regras = [];

  // Aposentadoria sempre (toda regra de William)
  const r1 = regraAposentadoria(cliente);
  if (r1) regras.push(r1);

  // Reserva sempre que houver gastos cadastrados
  const r2 = regraReservaEmergencia(cliente);
  if (r2) regras.push(r2);

  // Imóvel se cliente não tem casa
  const r3 = regraImovel(cliente);
  if (r3) regras.push(r3);

  // Carro se cliente não tem veículo
  const r4 = regraCarro(cliente);
  if (r4) regras.push(r4);

  // Viagem (sugestivo)
  const r5 = regraViagem(cliente);
  if (r5) regras.push(r5);

  // Demais objetivos do cliente que não foram cobertos acima
  const cobertos = new Set(["aposentadoria", "imovel", "carro", "viagem", "liquidez"]);
  for (const obj of cliente.objetivos || []) {
    if (cobertos.has(obj.tipo)) continue;
    const icone = obj.tipo === "educacao" ? "📚"
                : obj.tipo === "saude" ? "💪"
                : "🎯";
    const r = avaliarObjetivo(obj, icone, obj.tipo || "personalizado");
    if (r) regras.push(r);
  }

  // Ordena por prioridade
  const ordem = { urgente: 0, atencao: 1, ok: 2 };
  regras.sort((a, b) => ordem[a.prio] - ordem[b.prio]);
  return regras;
}

/**
 * Filtra apenas regras pendentes (não-completas) — pra uso no Bell
 * onde só queremos mostrar o que ainda precisa de ação.
 */
export function regrasPendentes(cliente) {
  return gerarRegrasCliente(cliente).filter(r => !r.completa);
}

/**
 * Retorna até `limite` itens, priorizando pendentes mas incluindo
 * 1 "ok" se houver espaço — pra Próximos Passos mostrar progresso.
 */
export function regrasParaProximosPassos(cliente, limite = 3) {
  const todas = gerarRegrasCliente(cliente);
  const pendentes = todas.filter(r => !r.completa);
  const completas = todas.filter(r => r.completa);
  if (pendentes.length >= limite) return pendentes.slice(0, limite);
  // Inclui completas até completar o limite (pra mostrar o que está em dia)
  return [...pendentes, ...completas].slice(0, limite);
}

// Exporta helpers usados em outras telas (mantém DRY)
export { getReservaEmergencia, getValorAlocado };
