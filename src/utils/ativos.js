// Definições compartilhadas de classes da carteira.
// Alinhado ao que Carteira.jsx já persiste no Firestore (snap[classKey+"Ativos"]).
import { parseCentavos } from "./currency";

export const CLASSES_CARTEIRA = [
  { key: "posFixado",      label: "Renda Fixa Pós-Fixada",   cor: "#2563eb", liq: "d+1" },
  { key: "ipca",           label: "Renda Fixa IPCA+",         cor: "#3b82f6", liq: "d+1" },
  { key: "preFixado",      label: "Renda Fixa Pré-Fixada",    cor: "#60a5fa", liq: "d+1" },
  { key: "acoes",          label: "Ações",                     cor: "#22c55e", liq: "d+2" },
  { key: "fiis",           label: "Fundos Imobiliários",        cor: "#F0A202", liq: "d+2" },
  { key: "multi",          label: "Multimercado",               cor: "#a07020", liq: "d+30" },
  { key: "prevVGBL",       label: "Previdência VGBL",           cor: "#f59e0b", liq: "—" },
  { key: "prevPGBL",       label: "Previdência PGBL",           cor: "#d97706", liq: "—" },
  { key: "globalEquities", label: "Global – Equities (R.V.)",   cor: "#a855f7", liq: "d+2" },
  { key: "globalTreasury", label: "Global – Treasury",          cor: "#c084fc", liq: "d+2" },
  { key: "globalFunds",    label: "Global – Mutual Funds",      cor: "#7c3aed", liq: "d+2" },
  { key: "globalBonds",    label: "Global – Bonds",             cor: "#9333ea", liq: "d+2" },
  { key: "global",         label: "Invest. Globais (Geral)",     cor: "#a855f7", liq: "d+2" },
  { key: "outros",         label: "Outros / Não Classificado",    cor: "#94a3b8", liq: "—" },
];

// Mapeia o `tipo` do objetivo para o valor armazenado em `ativo.objetivo`
// (os selects da Carteira.jsx usam estes rótulos).
// IMPORTANTE: estes labels são os MESMOS usados nos selects de objetivo do ativo.
// Mantenha sincronizado com OBJETIVO_TIPOS abaixo.
export const TIPO_OBJETIVO_PARA_LABEL = {
  aposentadoria:       "Aposentadoria",
  imovel:              "Aquisição de Imóvel",
  liquidez:            "Liquidez",
  carro:               "Compra de carro",
  oportunidade:        "Reserva de oportunidade",
  viagem:              "Viagem",
  educacao:            "Educação",
  saude:               "Saúde",
  sucessaoPatrimonial: "Sucessão",
  seguros:             "Seguros",
  planoSaude:          "Plano de Saúde",
  personalizado:       "Outros",
};

// Reverse map: label do select de ativo → tipo de objetivo
export const LABEL_PARA_TIPO_OBJETIVO = Object.fromEntries(
  Object.entries(TIPO_OBJETIVO_PARA_LABEL).map(([t, l]) => [l, t])
);

// Lista canônica de labels (ordem de exibição no select da Carteira)
export const OBJETIVO_LABELS = [
  "Liquidez",
  "Reserva de oportunidade",
  "Aposentadoria",
  "Aquisição de Imóvel",
  "Compra de carro",
  "Viagem",
  "Educação",
  "Saúde",
  "Sucessão",
  "Seguros",
  "Plano de Saúde",
  "Outros",
];

// Lista canônica de TIPOS de objetivo (com label "longo" usado nos cards de Objetivos.jsx).
// Espelha o que TIPOS define em src/pages/Objetivos.jsx.
export const OBJETIVO_TIPOS = [
  { id: "aposentadoria",       label: "Aposentadoria e Liberdade Financeira" },
  { id: "imovel",              label: "Aquisição de Imóvel" },
  { id: "liquidez",            label: "Liquidez / Reserva de Emergência" },
  { id: "carro",               label: "Comprar Veículo" },
  { id: "oportunidade",        label: "Reserva de Oportunidade" },
  { id: "viagem",              label: "Viagens e Experiências" },
  { id: "educacao",            label: "Educação dos Filhos" },
  { id: "saude",               label: "Saúde e Qualidade de Vida" },
  { id: "sucessaoPatrimonial", label: "Sucessão Patrimonial" },
  { id: "seguros",             label: "Seguro de Vida e de Veículos" },
  { id: "planoSaude",          label: "Plano de Saúde" },
  { id: "personalizado",       label: "Objetivo Personalizado" },
];

// Cria um objetivo stub a partir do label do select de ativo
// (usado quando o cliente vincula um ativo a um objetivo que ainda não existe)
export function criarObjetivoStub(labelDoAtivo) {
  const tipo = LABEL_PARA_TIPO_OBJETIVO[labelDoAtivo];
  if (!tipo) return null;
  const tipoMeta = OBJETIVO_TIPOS.find(t => t.id === tipo);
  if (!tipoMeta) return null;
  return {
    tipo,
    label: tipoMeta.label,
    patrimSource: "ativos",
    ativosVinculados: [],
    patrimAtual: "",
    aporte: "",
    meta: "",
    prazo: "",
    _stub: true,
    criadoAutomaticamente: true,
  };
}

// Garante que todo `ativo.objetivo` referenciado pela carteira tenha um
// objetivo correspondente na lista de objetivos do cliente. Cria stubs
// para os faltantes. Retorna a nova lista (ou a original se nada mudou).
export function garantirObjetivosVinculados(carteira, objetivosAtuais) {
  const lista = Array.isArray(objetivosAtuais) ? objetivosAtuais : [];
  const labelsExistentes = new Set(
    lista.map(o => TIPO_OBJETIVO_PARA_LABEL[o.tipo]).filter(Boolean)
  );
  const labelsVinculados = new Set();
  for (const classe of CLASSES_CARTEIRA) {
    const ativos = carteira?.[classe.key + "Ativos"] || [];
    for (const a of ativos) {
      if (a.objetivo) labelsVinculados.add(a.objetivo);
    }
  }
  const novos = [];
  for (const label of labelsVinculados) {
    if (labelsExistentes.has(label)) continue;
    const stub = criarObjetivoStub(label);
    if (stub) novos.push(stub);
  }
  return novos.length > 0 ? [...lista, ...novos] : lista;
}

// Retorna lista plana de todos os ativos do cliente com metadados de classe.
export function listarAtivosCarteira(carteira) {
  const c = carteira || {};
  const out = [];
  for (const classe of CLASSES_CARTEIRA) {
    const lista = c[classe.key + "Ativos"] || [];
    for (const a of lista) {
      out.push({
        ...a,
        classeKey: classe.key,
        classeLabel: classe.label,
        classeCor: classe.cor,
        liq: classe.liq,
        valorReais: parseCentavos(a.valor) / 100,
      });
    }
  }
  return out;
}

// Filtra ativos da carteira cujo campo `objetivo` coincide com o tipo
// do objetivo em análise.
export function ativosDoObjetivo(carteira, tipo) {
  const label = TIPO_OBJETIVO_PARA_LABEL[tipo];
  if (!label) return [];
  return listarAtivosCarteira(carteira).filter(a => (a.objetivo || "") === label);
}

// Atualiza a carteira marcando uma seleção de ativos com o rótulo do objetivo,
// e limpando a marcação de ativos que haviam sido ligados mas agora foram removidos.
// `selecionados` é um array de { classeKey, ativoId }.
export function atualizarVinculoAtivos(carteira, tipo, selecionadosIds) {
  const label = TIPO_OBJETIVO_PARA_LABEL[tipo];
  if (!label) return carteira;
  const nova = { ...(carteira || {}) };
  const selected = new Set(selecionadosIds.map(s => `${s.classeKey}::${s.ativoId}`));

  for (const classe of CLASSES_CARTEIRA) {
    const arr = nova[classe.key + "Ativos"];
    if (!arr || arr.length === 0) continue;
    const novoArr = arr.map(a => {
      const key = `${classe.key}::${a.id}`;
      const estaNaSelecao = selected.has(key);
      const estavaMarcado = (a.objetivo || "") === label;
      if (estaNaSelecao && !estavaMarcado) return { ...a, objetivo: label };
      if (!estaNaSelecao && estavaMarcado) return { ...a, objetivo: "" };
      return a;
    });
    nova[classe.key + "Ativos"] = novoArr;
  }
  return nova;
}

export function somaAtivosReais(ativos) {
  return (ativos || []).reduce((acc, a) => acc + (a.valorReais || 0), 0);
}
