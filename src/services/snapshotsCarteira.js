// ══════════════════════════════════════════════════════════════════════════
// snapshotsCarteira.js
//
// Gerencia os "snapshots mensais" da carteira de um cliente — uma foto
// congelada da posição no final de cada mês. São usados para:
//   • Rentabilidade dos últimos 12 meses (composta)
//   • Timeline de acompanhamento mês a mês
//   • Diff entre uploads consecutivos do mesmo mês → detecta compras/vendas
//   • Propagação automática da rent mensal pros objetivos
//
// Modelo no Firestore:
//   clientes/{id}/snapshotsCarteira/{YYYY-MM}  → {
//     mesRef: "2026-04",
//     dataRef: "2026-04-15",
//     patrimonioTotal: 684412.90,
//     rentMes: 2.42,
//     rentAno: 7.08,
//     rent12m: 12.34,
//     classes: { posFixado: 150000, ipca: 50000, ... },
//     ativos: [ { nome, classe, valor, rentMes, rentAno, vencimento } ],
//     resumoMes: { aportes, retiradas, dividendos, juros, amortizacao, taxas },
//     movimentacoes: [ { data, tipo, descricao, ativo, valor } ],
//     tabelaRentMensal: { "2026": [...12 valores...], "2025": [...] },
//     criadoEm, atualizadoEm, fonte: "pdf" | "imagem" | "manual"
//   }
// ══════════════════════════════════════════════════════════════════════════

import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../firebase";

// ── Sanitizador deep: remove TODO valor undefined recursivamente ─
// Firestore rejeita `undefined` em qualquer nível com o erro
// "Function setDoc() called with invalid data. Unsupported field value: undefined".
// Estratégia:
//  • em objetos: chaves com `undefined` são removidas; demais recursam.
//  • em arrays: posições com `undefined` viram `null` (preserva índice/length).
//  • valores `null` são preservados — Firestore aceita null.
// Comportamento histórico: o filter abaixo nunca remove nada porque
// `stripUndefined(undefined)` já retorna `null`. Mantemos para legibilidade.

export function stripUndefined(valor) {
  if (valor === undefined) return null;
  if (valor === null) return null;
  if (Array.isArray(valor)) {
    return valor.map((v) => stripUndefined(v));
  }
  // Preserva tipos especiais do Firestore (Timestamp etc.) — eles têm .toDate/.seconds
  if (typeof valor === "object") {
    // Data nativa ou Firestore Timestamp: deixa passar
    if (valor instanceof Date) return valor;
    if (typeof valor.toDate === "function") return valor;

    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v === undefined) continue; // remove chaves undefined
      out[k] = stripUndefined(v);
    }
    return out;
  }
  // número NaN também é inválido
  if (typeof valor === "number" && Number.isNaN(valor)) return null;
  return valor;
}

// ── Helpers de mês ───────────────────────────────────────────────

export function mesRefAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatarMesRef(mesRef) {
  if (!mesRef) return "";
  const [yyyy, mm] = mesRef.split("-");
  const labels = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${labels[parseInt(mm) - 1] || mm}/${yyyy}`;
}

// mesRef anterior (YYYY-MM → YYYY-MM)
export function mesAnterior(mesRef) {
  if (!mesRef) return null;
  const [yyyy, mm] = mesRef.split("-").map((n) => parseInt(n));
  let y = yyyy, m = mm - 1;
  if (m <= 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Calcula o rent 12m composto a partir da tabela mensal do PDF.
// tabela = { "2026": [jan,fev,...,dez], "2025": [...] } (valores em %, null quando "-")
// mesRefStr = "YYYY-MM" (mês de referência = mais recente da janela)
export function calcularRent12m(tabela, mesRefStr) {
  if (!tabela || !mesRefStr) return { rent12m: null, mesesUsados: 0 };
  const [yyyyStr, mmStr] = mesRefStr.split("-");
  const yy = parseInt(yyyyStr);
  const mm = parseInt(mmStr);
  const seq = [];
  for (let k = 0; k < 12; k++) {
    let targetMonth = mm - k;
    let targetYear = yy;
    while (targetMonth <= 0) { targetMonth += 12; targetYear -= 1; }
    const arr = tabela[String(targetYear)];
    if (arr && typeof arr[targetMonth - 1] === "number") {
      seq.push(arr[targetMonth - 1]);
    }
  }
  if (seq.length === 0) return { rent12m: null, mesesUsados: 0 };
  const composto = seq.reduce((acc, r) => acc * (1 + r / 100), 1) - 1;
  return { rent12m: +(composto * 100).toFixed(2), mesesUsados: seq.length };
}

// ── Fingerprint de ativo — usado pelo diff ───────────────────────
// Se o PDF mencionar o mesmo ativo em meses diferentes, o nome (normalizado)
// é a chave estável. Ticker, se presente, entra como segundo componente.
export function fingerprintAtivo(ativo) {
  if (!ativo) return "";
  const nome = String(ativo.nome || "").toUpperCase().replace(/\s+/g, " ").trim();
  const venc = String(ativo.vencimento || "").toUpperCase().trim();
  return venc ? `${nome}|${venc}` : nome;
}

// ── Salvar snapshot ──────────────────────────────────────────────
// dados = objeto devolvido por parseCarteiraFromText OU pela cloud function
//         (normalizado por normalizarDadosParaSnapshot abaixo)

export async function salvarSnapshotMensal(clienteId, mesRef, payload, opcoes = {}) {
  if (!clienteId) throw new Error("clienteId obrigatório");
  if (!mesRef || !/^\d{4}-\d{2}$/.test(mesRef)) {
    throw new Error("mesRef deve estar no formato YYYY-MM");
  }

  const ref = doc(db, "clientes", clienteId, "snapshotsCarteira", mesRef);
  const existente = await getDoc(ref);
  const agora = new Date().toISOString();
  const dadosAntigos = existente.exists() ? existente.data() : null;

  // Preservação de campos "ricos" no re-upload: se o cliente já tinha um
  // snapshot completo (vindo de um PDF da XP/BTG) e re-faz upload de uma
  // foto cropada que só tem patrimonioTotal, não queremos zerar a
  // tabelaRentMensal/ativos/movimentacoes que o PDF original trouxe.
  // Regra: se o payload novo NÃO tem o campo (null/undefined/array vazio),
  // mantém o valor antigo. Se tem, sobrescreve normalmente.
  const preservarSeFalta = (campo, ehArray = false) => {
    const novo = payload?.[campo];
    const temNovo = ehArray
      ? Array.isArray(novo) && novo.length > 0
      : novo != null && (typeof novo !== "object" || Object.keys(novo).length > 0);
    if (temNovo) return novo;
    return dadosAntigos?.[campo] ?? (ehArray ? [] : null);
  };

  const payloadMesclado = dadosAntigos
    ? {
        ...payload,
        tabelaRentMensal: preservarSeFalta("tabelaRentMensal"),
        ativos: preservarSeFalta("ativos", true),
        movimentacoes: preservarSeFalta("movimentacoes", true),
        resumoMes: preservarSeFalta("resumoMes"),
      }
    : payload;

  const snapshotData = stripUndefined({
    mesRef,
    ...payloadMesclado,
    atualizadoEm: agora,
    ...(existente.exists() ? {} : { criadoEm: agora }),
    ...(opcoes.fonte ? { fonte: opcoes.fonte } : {}),
    ...(opcoes.arquivoNome ? { arquivoNome: opcoes.arquivoNome } : {}),
  });

  await setDoc(ref, snapshotData, { merge: true });
  return snapshotData;
}

// ── Listar snapshots do cliente ──────────────────────────────────

export async function listarSnapshots(clienteId, opts = {}) {
  if (!clienteId) return [];
  const col = collection(db, "clientes", clienteId, "snapshotsCarteira");
  const q = opts.limite
    ? query(col, orderBy("mesRef", "desc"), limit(opts.limite))
    : query(col, orderBy("mesRef", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obterSnapshot(clienteId, mesRef) {
  if (!clienteId || !mesRef) return null;
  const ref = doc(db, "clientes", clienteId, "snapshotsCarteira", mesRef);
  const s = await getDoc(ref);
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// ── Diff entre dois snapshots ────────────────────────────────────
// Retorna lista de movimentações detectadas comparando os ativos:
//   • compra    → ativo novo ou aumento de valor (sem aporte registrado)
//   • venda     → ativo sumiu ou reduziu valor
//   • reforço   → aumento expressivo (>15%) — trata como compra adicional
//
// Saída: [ { tipo, ativo, classe, deltaValor, data, origem: "diff" } ]

export function diffSnapshots(snapshotAnterior, snapshotNovo) {
  if (!snapshotNovo || !snapshotNovo.ativos) return [];
  const anterior = snapshotAnterior?.ativos || [];
  const novo = snapshotNovo.ativos || [];

  const mapAnt = new Map();
  anterior.forEach((a) => mapAnt.set(fingerprintAtivo(a), a));
  const mapNovo = new Map();
  novo.forEach((a) => mapNovo.set(fingerprintAtivo(a), a));

  const dataRef = snapshotNovo.dataRef || `${snapshotNovo.mesRef}-15`;
  const movimentos = [];

  // Ativos do novo snapshot — compara contra o anterior
  for (const [fp, atNovo] of mapNovo.entries()) {
    const atAnt = mapAnt.get(fp);
    const valorNovo = Number(atNovo.valor) || 0;
    const valorAnt = atAnt ? Number(atAnt.valor) || 0 : 0;

    if (!atAnt) {
      // Ativo novo → compra
      if (valorNovo >= 100) {
        movimentos.push({
          tipo: "compra",
          ativo: atNovo.nome,
          classe: atNovo.classe,
          deltaValor: valorNovo,
          data: dataRef,
          origem: "diff",
        });
      }
      continue;
    }

    const delta = valorNovo - valorAnt;
    // Ignora variações < 5% pra não confundir com oscilação de mercado
    if (Math.abs(delta) < valorAnt * 0.05 && Math.abs(delta) < 500) continue;

    if (delta > 0) {
      movimentos.push({
        tipo: "reforco",
        ativo: atNovo.nome,
        classe: atNovo.classe,
        deltaValor: delta,
        data: dataRef,
        origem: "diff",
      });
    } else {
      movimentos.push({
        tipo: "venda",
        ativo: atNovo.nome,
        classe: atNovo.classe,
        deltaValor: Math.abs(delta),
        data: dataRef,
        origem: "diff",
      });
    }
  }

  // Ativos que sumiram → venda total
  for (const [fp, atAnt] of mapAnt.entries()) {
    if (mapNovo.has(fp)) continue;
    const valor = Number(atAnt.valor) || 0;
    if (valor < 100) continue;
    movimentos.push({
      tipo: "venda",
      ativo: atAnt.nome,
      classe: atAnt.classe,
      deltaValor: valor,
      data: dataRef,
      origem: "diff",
    });
  }

  return movimentos;
}

// ── Normalização: converte saída do parser local (com _camelCase) para
// o formato do snapshot (sem prefixo _). Também aceita saída da cloud
// function que já vem no formato final.
// ─────────────────────────────────────────────────────────────────

export function normalizarDadosParaSnapshot(dados, carteiraAtual, mesRef) {
  if (!dados) return null;

  // Saída do cloud function já vem normalizada (tem campo "classes" ou "ativos").
  // Saída do parser local vem com _camelCase e centavos em strings.
  const vemDaCloud = dados.classes || dados.mesReferencia;

  if (vemDaCloud) {
    return {
      mesRef: mesRef || dados.mesReferencia,
      dataRef: dados.dataReferencia || null,
      patrimonioTotal: Number(dados.patrimonioTotal) || 0,
      rentMes: isFinite(dados.rentMes) ? Number(dados.rentMes) : null,
      rentAno: isFinite(dados.rentAno) ? Number(dados.rentAno) : null,
      rent12m: isFinite(dados.rent12m) ? Number(dados.rent12m) : null,
      ganhoMes: Number(dados.ganhoMes) || 0,
      ganhoAno: Number(dados.ganhoAno) || 0,
      ganho12m: Number(dados.ganho12m) || 0,
      classes: dados.classes || {},
      ativos: Array.isArray(dados.ativos) ? dados.ativos : [],
      tabelaRentMensal: dados.tabelaRentMensal || null,
      resumoMes: dados.resumoMes || {},
      movimentacoes: Array.isArray(dados.movimentacoes) ? dados.movimentacoes : [],
    };
  }

  // Parser local: _patrimonioTotal/_rentMes vêm em centavos (para valores),
  // e percentuais vêm como string "2.42". Classes vêm em campos top-level
  // posFixado, ipca, ... em string de centavos. Ativos em <classe>Ativos.

  const classes = {};
  ["posFixado", "preFixado", "ipca", "acoes", "fiis", "multi", "prevVGBL", "prevPGBL", "global"].forEach((k) => {
    const v = dados[k] || carteiraAtual?.[k] || "0";
    const reais = Number(String(v).replace(/\D/g, "")) / 100;
    if (reais > 0) classes[k] = reais;
  });

  const ativos = [];
  for (const k of Object.keys(classes)) {
    const lista = dados[k + "Ativos"] || carteiraAtual?.[k + "Ativos"] || [];
    for (const a of lista) {
      const valor = Number(String(a.valor || "0").replace(/\D/g, "")) / 100;
      if (valor < 100) continue;
      ativos.push({
        nome: a.nome || "",
        classe: k,
        valor,
        rentMes: a.rentMes ? Number(String(a.rentMes).replace(",", ".")) : null,
        rentAno: a.rentAno ? Number(String(a.rentAno).replace(",", ".")) : null,
        vencimento: a.vencimento || "",
      });
    }
  }

  const resumoMes = {};
  if (dados._aportes) resumoMes.aportes = dados._aportes / 100;
  if (dados._resgates) resumoMes.retiradas = dados._resgates / 100;
  if (dados._dividendos) resumoMes.dividendos = dados._dividendos / 100;
  if (dados._juros) resumoMes.juros = dados._juros / 100;
  if (dados._amortizacao) resumoMes.amortizacao = dados._amortizacao / 100;
  if (dados._rendimentosPassivos && !resumoMes.dividendos && !resumoMes.juros) {
    resumoMes.rendimentosPassivos = dados._rendimentosPassivos / 100;
  }

  return {
    mesRef: mesRef || dados._mesReferencia,
    dataRef: dados._dataReferencia || null,
    patrimonioTotal: dados._patrimonioTotal ? dados._patrimonioTotal / 100 : 0,
    rentMes: dados._rentMes ? parseFloat(dados._rentMes) : null,
    rentAno: dados._rentAno ? parseFloat(dados._rentAno) : null,
    rent12m: dados._rent12m ? parseFloat(dados._rent12m) : null,
    rent12mFonte: dados._rent12mFonte || null,
    ganhoMes: dados._ganhoMes ? dados._ganhoMes / 100 : 0,
    ganhoAno: dados._ganhoAno ? dados._ganhoAno / 100 : 0,
    ganho12m: dados._ganho12m ? dados._ganho12m / 100 : 0,
    classes,
    ativos,
    tabelaRentMensal: dados._tabelaRentMensal || null,
    resumoMes,
    movimentacoes: Array.isArray(dados._movimentacoes) ? dados._movimentacoes : [],
  };
}

// ── Propagar rent do mês pros objetivos do cliente ─────────────────
// Lê historicoAcompanhamento de cada objetivo e adiciona/atualiza a
// entrada do mesRef com { rentabilidadeCarteira: snapshot.rentMes, ... }.
// Também faz backfill usando a tabelaRentMensal quando existir.

export function aplicarRentNosObjetivos(objetivos, snapshot) {
  if (!Array.isArray(objetivos) || !snapshot) return objetivos || [];
  const tabela = snapshot.tabelaRentMensal || null;

  return objetivos.map((obj) => {
    const hist = Array.isArray(obj.historicoAcompanhamento)
      ? [...obj.historicoAcompanhamento]
      : [];

    // Atualiza a entrada do mesRef — garante que nada fica undefined
    const idx = hist.findIndex((h) => h.mesAno === snapshot.mesRef);
    const rentExistente = idx >= 0 ? hist[idx].rentabilidadeCarteira : null;
    const valorExistente = idx >= 0 ? hist[idx].valorCarteira : null;
    const entrada = {
      mesAno: snapshot.mesRef,
      rentabilidadeCarteira:
        snapshot.rentMes != null ? snapshot.rentMes :
        rentExistente != null ? rentExistente : null,
      valorCarteira:
        snapshot.patrimonioTotal != null ? snapshot.patrimonioTotal :
        valorExistente != null ? valorExistente : null,
      atualizadoEm: new Date().toISOString(),
      origem: "snapshot",
    };
    if (idx >= 0) hist[idx] = { ...hist[idx], ...entrada };
    else hist.push(entrada);

    // Backfill dos últimos 12 meses a partir da tabela mensal do PDF (se existir)
    if (tabela && snapshot.mesRef) {
      const [yyyy, mm] = snapshot.mesRef.split("-").map((n) => parseInt(n));
      for (let k = 1; k <= 12; k++) {
        let y = yyyy, m = mm - k;
        while (m <= 0) { m += 12; y -= 1; }
        const mesStr = `${y}-${String(m).padStart(2, "0")}`;
        const arr = tabela[String(y)];
        const val = arr?.[m - 1];
        if (typeof val !== "number") continue;
        const i = hist.findIndex((h) => h.mesAno === mesStr);
        if (i >= 0) {
          // Só sobrescreve se a entrada atual não tem valor
          if (hist[i].rentabilidadeCarteira == null) {
            hist[i] = { ...hist[i], rentabilidadeCarteira: val, origem: "backfill-tabela" };
          }
        } else {
          hist.push({
            mesAno: mesStr,
            rentabilidadeCarteira: val,
            origem: "backfill-tabela",
            atualizadoEm: new Date().toISOString(),
          });
        }
      }
    }

    // Ordena por mesAno descendente (mais recente primeiro)
    hist.sort((a, b) => String(b.mesAno).localeCompare(String(a.mesAno)));

    return { ...obj, historicoAcompanhamento: hist };
  });
}

// ── Consolida movimentações num campo top-level do cliente ─────────
// Usado pelo Extrato.jsx. Dedup por {mesRef+tipo+ativo+valor} — usar
// o mês (e não a data exata) evita empilhar quando re-importamos o
// PDF do mesmo mês e a IA devolve a mesma movimentação com data
// levemente diferente (ex.: data do trade vs data de liquidação).

function chaveDedup(m, mesRefFallback) {
  const mes = m.mesRef || (typeof m.data === "string" ? m.data.slice(0, 7) : "") || mesRefFallback || "";
  const tipo = String(m.tipo || "").toLowerCase();
  const ativo = String(m.ativo || "").toUpperCase().replace(/\s+/g, " ").trim().slice(0, 30);
  const valorCent = Math.round((Number(m.valor) || Number(m.deltaValor) || 0) * 100);
  return `${mes}|${tipo}|${ativo}|${valorCent}`;
}

export function mesclarMovimentacoes(movimentacoesAtuais, novasMov, mesRef) {
  const atual = Array.isArray(movimentacoesAtuais) ? [...movimentacoesAtuais] : [];
  const existentes = new Set(atual.map((m) => chaveDedup(m)));

  for (const m of novasMov || []) {
    const enriched = { ...m, mesRef: m.mesRef || mesRef };
    const chave = chaveDedup(enriched, mesRef);
    if (existentes.has(chave)) continue;
    existentes.add(chave);
    atual.push(enriched);
  }

  // Ordena por data descendente
  atual.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
  return atual;
}

// ── Sanity check: aportes obviamente errados (compra confundida com aporte,
// total do patrimônio etc.). Mesma regra usada na Carteira.jsx ao decidir
// o que vai pra aportesHistorico — agora também filtra antes de gravar
// em movimentacoesExtrato.
const PADROES_NAO_APORTE = /\b(compra|venda|recompra|resgate|aplica[çc][ãa]o\s+compromissada|dividendo|rendimento|juros|amortiza[çc][ãa]o|taxa|irrf|saldo|patrim[ôo]nio|posi[çc][ãa]o)\b/i;

export function isAporteSuspeito(m, patrimonioTotal) {
  if (String(m.tipo || "").toLowerCase() !== "aporte") return false;
  const v = Number(m.valor) || Number(m.deltaValor) || 0;
  if (!(v > 0)) return true;
  const desc = String(m.descricao || "");
  if (PADROES_NAO_APORTE.test(desc)) return true;
  const pat = Number(patrimonioTotal) || 0;
  if (pat > 0 && v >= pat * 0.8) return true;
  if (pat > 0 && Math.abs(v - pat) < 1) return true;
  return false;
}
