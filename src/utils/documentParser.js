// pdfjs e tesseract são carregados sob demanda — economiza ~1.4MB no bundle inicial
// e evita baixar o OCR (tesseract) se o PDF já tiver texto extraível.
let _pdfjsLib = null;
async function getPdfjs() {
  if (_pdfjsLib) return _pdfjsLib;
  const [mod, workerUrl] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  mod.GlobalWorkerOptions.workerSrc = workerUrl.default;
  _pdfjsLib = mod;
  return mod;
}

// Logs de debug só em dev; em produção nunca vazam conteúdo do usuário.
const dbg = import.meta.env.DEV ? console.log.bind(console) : () => {};

// ── Tesseract worker reutilizável (evita recriar worker a cada página) ─
let _tesseractWorker = null;
let _TesseractMod = null;
async function getWorker(onLog) {
  if (_tesseractWorker) return _tesseractWorker;
  if (!_TesseractMod) _TesseractMod = (await import("tesseract.js")).default;
  _tesseractWorker = await _TesseractMod.createWorker(["por", "eng"], 1, {
    logger: onLog,
  });
  return _tesseractWorker;
}
async function terminateWorker() {
  if (_tesseractWorker) {
    try { await _tesseractWorker.terminate(); } catch { /* ignore */ }
    _tesseractWorker = null;
  }
}

// Libera canvas (importante em Safari/Firefox onde GC não coleta rápido)
function disposeCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

// ── Extração de texto com linhas preservadas ───────────────────

export async function extractText(file, onProgress) {
  const name = file.name?.toLowerCase() || "";
  const isPDF = file.type === "application/pdf" || name.endsWith(".pdf");
  try {
    if (isPDF) return await _fromPDF(file, onProgress);
    return await _fromImage(file, onProgress);
  } catch (err) {
    throw new Error(`Falha ao ler o arquivo: ${err?.message || String(err) || 'erro desconhecido'}`);
  } finally {
    // Libera worker após uso — evita vazamento de memória entre uploads
    await terminateWorker();
  }
}

async function _fromPDF(file, onProgress) {
  onProgress(5, "Carregando PDF...");
  const pdfjsLib = await getPdfjs();
  const buf = await file.arrayBuffer();
  const pdfTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await pdfTask.promise;
  try {
    const n = pdf.numPages;
    let text = "";
    let hasText = false;

    onProgress(10, `PDF com ${n} página${n > 1 ? "s" : ""} detectado...`);

    for (let i = 1; i <= n; i++) {
      onProgress(10 + Math.round((i / n) * 55), `Lendo página ${i} de ${n}...`);
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const items = content.items.filter(it => it.str && it.str.trim());
        if (items.length === 0) { text += "\n"; continue; }

        // Agrupa por Y (topo→base) preservando linhas reais
        const lineMap = new Map();
        for (const item of items) {
          const y = Math.round(item.transform[5]);
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y).push({ x: item.transform[4], str: item.str });
        }

        const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
        const merged = [];
        for (const y of sortedYs) {
          const prev = merged[merged.length - 1];
          if (prev && Math.abs(y - prev.y) < 8) {
            prev.items.push(...lineMap.get(y));
          } else {
            merged.push({ y, items: [...lineMap.get(y)] });
          }
        }

        const pageText = merged
          .map(({ items: its }) => {
            its.sort((a, b) => a.x - b.x);
            return its.map(it => it.str).join(" ").trim();
          })
          .filter(l => l.length > 0)
          .join("\n");

        if (pageText.trim().length > 20) hasText = true;
        text += pageText + "\n\n";
      } finally {
        // Libera recursos internos da página (pdf.js mantém cache por página)
        page.cleanup?.();
      }
    }

    if (!hasText) {
      text = "";
      onProgress(66, "PDF digitalizado — iniciando OCR...");
      const worker = await getWorker();
      for (let i = 1; i <= n; i++) {
        onProgress(66 + Math.round((i / n) * 24), `OCR página ${i} de ${n}...`);
        const page = await pdf.getPage(i);
        let canvas = null;
        try {
          const vp = page.getViewport({ scale: 2 });
          canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          const result = await worker.recognize(canvas);
          text += result.data.text + "\n\n";
        } finally {
          disposeCanvas(canvas);
          page.cleanup?.();
        }
      }
    }

    onProgress(92, "Analisando dados financeiros...");
    dbg("[WealthTrack] Texto extraído do PDF (primeiros 3000 chars):\n", text.slice(0, 3000));
    return text;
  } finally {
    // Destrói o documento pdf.js para liberar toda memória mantida
    try { await pdf.cleanup(); } catch { /* ignore */ }
    try { await pdf.destroy(); } catch { /* ignore */ }
  }
}

async function _fromImage(file, onProgress) {
  onProgress(5, "Iniciando OCR...");
  const worker = await getWorker(m => {
    if (m.status === "recognizing text")
      onProgress(5 + Math.round(m.progress * 85), `OCR: ${Math.round(m.progress * 100)}%`);
  });
  const result = await worker.recognize(file);
  onProgress(92, "Analisando dados financeiros...");
  return result.data.text;
}

// ── Helpers monetários ─────────────────────────────────────────

function parseBRL(str) {
  if (!str) return 0;
  const s = String(str).replace(/[R$\s]/g, "");
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s))
    return Math.round(parseFloat(s.replace(/\./g, "").replace(",", ".")) * 100);
  if (/^\d+,\d{2}$/.test(s))
    return Math.round(parseFloat(s.replace(",", ".")) * 100);
  if (/^\d+\.\d{2}$/.test(s))
    return Math.round(parseFloat(s) * 100);
  const n = parseInt(s.replace(/\D/g, ""));
  return n > 0 ? n * 100 : 0;
}

function largestAmountNear(text, pattern, window = 600) {
  let max = 0;
  const regex = new RegExp(pattern.source, "gi");
  let m;
  while ((m = regex.exec(text)) !== null) {
    const chunk = text.slice(m.index, Math.min(text.length, m.index + window));
    const vals = [...chunk.matchAll(/R?\$?\s?([\d]{1,3}(?:\.[\d]{3})*(?:,[\d]{2})?)/g)];
    for (const v of vals) {
      const c = parseBRL(v[0]);
      if (c > max) max = c;
    }
    if (regex.lastIndex === m.index) regex.lastIndex++;
  }
  return max;
}

// ── Normalização de texto (remove acentos para comparar) ───────

function norm(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

// ── Detecção de tipo de documento ──────────────────────────────
// Usa padrões sem acento para ser resistente a PDFs com codificação customizada

function detectDocType(text) {
  const t = norm(text);

  // Fatura / extrato bancário
  if (
    /FATURA.*CARTAO|CARTAO.*FATURA/i.test(t) ||
    /LANCAMENTOS.*COMPRAS|COMPRAS.*LANCAMENTOS/i.test(t) ||
    /ENCARGOS\s+POR\s+ATRASO|JUROS\s+ROTATIVOS/i.test(t) ||
    /PAGAMENTO\s+(?:MINIMO|TOTAL)\s+DA\s+FATURA/i.test(t) ||
    /FATURA\s+DO\s+MES/i.test(t)
  ) {
    if (/\d{2}\/\d{2}\s+.+\s+[\d.]+,\d{2}/.test(text)) return "fatura";
  }
  if ((text.match(/^\d{2}\/\d{2}\s+.+\s+[\d.]+,\d{2}/gm) || []).length >= 3) return "fatura";

  // Relatório de investimentos — palavras sem acento
  if (
    /PATRIMONIO\s+TOTAL|PATRIM.{0,3}NIO\s+TOTAL/i.test(t) ||
    /EVOLUCAO\s+PATRIMONIAL|EVOLU.{0,3}O\s+PATRIMONIAL/i.test(t) ||
    /POSICAO\s+DETALHADA|POSI.{0,3}O\s+DETALHADA/i.test(t) ||
    /CARTEIRA\s+CONSOLIDADA/i.test(t) ||
    /COMPOSICAO|COMPOSI.{0,3}O/i.test(t) && /RENTABILIDADE/i.test(t) ||
    /POS\s+FIXADO|P.S\s+FIXADO/i.test(t) && /RENTABILIDADE/i.test(t)
  ) return "relatorio";

  return "generico";
}

// ── Classes de investimento — padrões resistentes a encoding ───

// Cada entrada tem: key do sistema, padrões para detectar no texto normalizado
const CLASS_DEFS = [
  { key: "posFixado",  pats: [/POS\s*FIXADO|P.S\s+FIXADO|RENDA\s+FIXA\s+POS/i] },
  { key: "preFixado",  pats: [/PRE\s*FIXADO|PR.\s+FIXADO|RENDA\s+FIXA\s+PRE/i] },
  { key: "ipca",       pats: [/INFLACAO|INFLA.{0,3}O\b|IPCA\s*\+|NTN.?B/i] },
  { key: "acoes",      pats: [/RENDA\s+VARI.VEL(?:\s+BRASIL)?|ACOES\b|A.OES\b/i] },
  { key: "multi",      pats: [/MULTIMERCADO/i] },
  { key: "fiis",       pats: [/FUNDOS?\s+LISTADOS|FUNDO\s+IMOBILI.{0,3}RIO|FII\b|ALTERNATIVO/i] },
  { key: "prevVGBL",   pats: [/VGBL/i] },
  { key: "prevPGBL",   pats: [/PGBL/i] },
  { key: "global",     pats: [/GLOBAL|INTERNACIONAL|EXTERIOR/i] },
];

function classNameToKey(name) {
  const n = norm(name);
  for (const { key, pats } of CLASS_DEFS) {
    for (const pat of pats) {
      if (pat.test(n)) return key;
    }
  }
  return null;
}

// ── Parser de relatório de investimentos ───────────────────────

function parseRelatorio(text) {
  // ── Normaliza ligaturas quebradas pelo pdfjs ──
  // Ex.: "In fl ação" → "Inflação", "Gra fi co" → "Grafico", "fi ns" → "fins"
  // PDFs com fonte que usa ligatures fi/fl/ff/ffi/ffl aparecem como espaços extras.
  text = text
    .replace(/([A-Za-zÀ-ÿ])\s(fi|fl|ffi|ffl|ff)\s([a-záéíóúãâêôç])/g, "$1$2$3")
    .replace(/\b(fi|fl|ffi|ffl|ff)\s([a-záéíóúãâêôç])/g, "$1$2");

  const result = {};
  const nt = norm(text); // texto normalizado (sem acentos)

  // ── KPIs do cabeçalho ──────────────────────────────────────
  // Aceita tanto "PATRIMÔNIO" quanto "PATRIMONIO" quanto "PATRIM NIO" (garbled)
  const patrimonioRE = [
    /PATRIM.{0,4}NIO\s+TOTAL\s+BRUTO\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /PATRIM.{0,4}NIO\s+(?:TOTAL|LIQUIDO|BRUTO)\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /SALDO\s+TOTAL\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /VALOR\s+TOTAL\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
  ];
  for (const re of patrimonioRE) {
    const m = nt.match(re);
    if (m) { result._patrimonioTotal = parseBRL(m[1]); break; }
  }

  const ganhoRE = [
    /GANHO\s+(?:DO\s+)?M.S\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /RESULTADO\s+(?:DO\s+)?M.S\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
  ];
  for (const re of ganhoRE) {
    const m = nt.match(re);
    if (m) { result._ganhoMes = parseBRL(m[1]); break; }
  }

  // ── Tabela "Referências (%)" XP — linha Portfólio ────────────────
  // Formato: "Portfólio 2,42% 7,08% 25,65% 42,90%" (Mês, Ano, 12M, 24M)
  // É a fonte oficial dos 3 percentuais — tem prioridade sobre qualquer
  // outro regex. Se bater aqui, já preenche rentMes/rentAno/rent12m/rent24m.
  //
  // Tolera: "Portfolio"/"Portfólio"/"Carteira"/"Estratégia" + 3-4 percentuais
  // em sequência (alguns PDFs omitem a coluna 24M).
  const refTableVariantes = [
    /(?:PORTF.LIO|CARTEIRA|ESTRAT.GIA)\s+(-?[\d,]+)%\s+(-?[\d,]+)%\s+(-?[\d,]+)%\s+(-?[\d,]+)%/i,
    /(?:PORTF.LIO|CARTEIRA|ESTRAT.GIA)\s+(-?[\d,]+)%\s+(-?[\d,]+)%\s+(-?[\d,]+)%/i,
  ];
  for (const re of refTableVariantes) {
    const refM = nt.match(re);
    if (refM) {
      result._rentMes = refM[1].replace(",", ".");
      result._rentAno = refM[2].replace(",", ".");
      result._rent12m = refM[3].replace(",", ".");
      if (refM[4]) result._rent24m = refM[4].replace(",", ".");
      result._rent12mFonte = "pdf-referencias";
      break;
    }
  }

  // Rentabilidade mês — fallback quando a tabela Referências não casou
  const rentMesRE = [
    /RENTABILIDADE\s+(?:DO\s+)?M.S\s*:?\s*(-?[-\d,]+)%/i,
    /RENT\.?\s*M.S\s*:?\s*(-?[-\d,]+)%/i,
  ];
  if (!result._rentMes) {
    for (const re of rentMesRE) {
      const m = nt.match(re);
      if (m) { result._rentMes = m[1].replace(",", "."); break; }
    }
  }

  // Rentabilidade anual — quando cabeçalho e valor estão na mesma linha
  const rentAnoRE = [
    /RENTABILIDADE\s+(?:DO\s+)?ANO\s*:?\s*(-?[-\d,]+)%/i,
    /RENT\.?\s*ANO\s*:?\s*(-?[-\d,]+)%/i,
    // Formato XP "Resumo": "ANO R$ 96.847,80 14,92%"
    /\bANO\s+R\$\s*-?[\d.]+,\d{2}\s+(-?[-\d,]+)%/i,
    // Rentabilidade histórica XP: "2026 (No ano: 14,92%)"
    /\(\s*NO\s+ANO[:\s]+(-?[-\d,]+)%\s*\)/i,
  ];
  if (!result._rentAno) {
    for (const re of rentAnoRE) {
      const m = nt.match(re);
      if (m) { result._rentAno = m[1].replace(",", "."); break; }
    }
  }

  // Rentabilidade 12M — fallback de rent12m no Resumo (linha "12M ...%")
  if (!result._rent12m) {
    const rent12mRE = [
      /\b12\s*M\s+R\$\s*-?[\d.]+,\d{2}\s+(-?[-\d,]+)%/i,
      /RENTABILIDADE\s*\(?\s*12\s*M\s*\)?\s*:?\s*(-?[-\d,]+)%/i,
    ];
    for (const re of rent12mRE) {
      const m = nt.match(re);
      if (m) { result._rent12m = m[1].replace(",", "."); result._rent12mFonte = "pdf-resumo"; break; }
    }
  }

  // ── Resumo: ganhos financeiros por período ─────────────────────
  // "MÊS R$ 25.060,37 2,42% 444,80% R$ 118,49"
  // "ANO R$ 66.614,83 7,08% 178,03% -R$ 70.886,77"
  // "12M R$ 195.456,10 25,65% 180,53% R$ 6.144,39"
  const ganhoAnoM = nt.match(/\bANO\s+R\$\s*(-?[\d.]+,\d{2})/i);
  if (ganhoAnoM) result._ganhoAno = parseBRL(ganhoAnoM[1]);
  const ganho12mM = nt.match(/\b12\s*M\s+R\$\s*(-?[\d.]+,\d{2})/i);
  if (ganho12mM) result._ganho12m = parseBRL(ganho12mM[1]);

  // ── Fallback KPIs — layout XP: cabeçalhos numa linha, valores na linha de baixo ─
  // Ex.: "PATRIMÔNIO TOTAL BRUTO: RENTABILIDADE MÊS: GANHO MÊS: RENTABILIDADE ANO: …\n
  //       R$ 684.412,90 1,06% R$ 6.238,08 5,32% R$ 36.411,00 …"
  // Sempre executado para capturar todos os KPIs possíveis
  const kpiIdx = nt.search(/PATRIM.{0,6}NIO\s+TOTAL/i);
  if (kpiIdx >= 0) {
    const kpiChunk = nt.slice(kpiIdx, Math.min(nt.length, kpiIdx + 600));
    const rVals = [...kpiChunk.matchAll(/R\$\s*([\d.]+,\d{2})/g)];
    const pVals = [...kpiChunk.matchAll(/([-\d]+,\d{1,2})%(?![,\d])/g)];
    // Se o cabeçalho XP lista "24M" em vez de "ANO", o 2º percentual NÃO é rent ano.
    const kpiIs24M = /24\s*M|.LTIMOS\s*24/i.test(kpiChunk);
    if (!result._patrimonioTotal && rVals[0]) result._patrimonioTotal = parseBRL(rVals[0][1]);
    if (!result._rentMes  && pVals[0]) result._rentMes  = pVals[0][1].replace(",", ".");
    if (!result._rentAno  && pVals[1] && !kpiIs24M) result._rentAno  = pVals[1][1].replace(",", ".");
    if (!result._ganhoMes && rVals[1]) result._ganhoMes = parseBRL(rVals[1][1]);
  }

  // ── Extração de classes — processa linha a linha ────────────
  // Pré-processa: une linhas que terminam com " -" ou com taxa "NN,NN% WORD"
  // (nomes longos que quebram no PDF quando excedem a coluna)
  const rawLines = text.split("\n");
  const lines = [];
  let carry = "";
  for (const line of rawLines) {
    const t = line.trim();
    if (!t) {
      if (carry) { lines.push(carry.trim()); carry = ""; }
      continue;
    }
    // Critérios de carry (linha incompleta que continua na próxima):
    //   1. Termina com " -"  (ex: "CDB BANCO SAFRA - MAI/2028 -")
    //   2. Termina com "NN,NN%" ou "NN,NN% PALAVRA" sem R$ (ex: "CDB BANCO - 101,00%")
    const isCarry =
      !/ R\$/.test(t) &&
      t.length > 8 &&
      (/\s-$/.test(t) || /\d[\d,]+%(?:\s+[A-Z]+)?$/.test(t));
    if (isCarry) {
      carry += t + " ";
    } else {
      lines.push((carry + t).trim());
      carry = "";
    }
  }
  if (carry) lines.push(carry.trim());

  // SKIP: linhas que claramente são cabeçalhos ou rodapés
  const SKIP_RE = /^(?:POSI.{0,4}O\s+DETALHADA|PRECIFICA|Estrat.{0,3}gia|M.S\s+ATUAL|Refer.{0,4}ncia|ANO\b|24\s*MESES|Relat.{0,4}rio|Data\s+de|Aviso|\*|Gerado|Este\s+material)/i;

  // SKIP tabelas que o parser de ativos confunde com ativos:
  //   Evolução Patrimonial mensal: "mar./26   R$ 759.164,44   R$ 20.000,00 ..."
  //   Movimentações: "27/03/2026   27/03/2026   Taxa de intermediação ..."
  //   Rentabilidade histórica: linhas "Portfólio 6,46% 5,91% ..." / "YYYY %CDI ..."
  const JUNK_RE = /^(?:[a-z]{3}\.?\/\d{2}\s+R\$|\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}|Portf.lio\s+[-\d,]+%|\d{4}\s+%CDI|CDI\s+[-\d,]+%|Ibovespa\s+[-\d,]+%|IPCA\s+[-\d,]+%|D.lar\s+[-\d,]+%|Benchmarks\b)/i;

  let currentClassKey = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t || SKIP_RE.test(t) || JUNK_RE.test(t)) continue;
    const nt_line = norm(t);

    // ── Detectar linha de composição: "ClassName (XX,XX%) R$ VALUE" ─
    // Funciona no texto normalizado (sem acentos).
    // Aceita prefixo "99,98% " que o pdfjs/pdfplumber inclui do gráfico "Total investido"
    const compM = nt_line.match(
      /^(?:\d{1,3}[\d,]*%\s+)?([A-Z][A-Z\s/\-.]{2,40}?)\s+\(?(\d[\d,]+)%\)?\s+R\$\s*([\d.]+,\d{2})/
    );
    if (compM) {
      const key = classNameToKey(compM[1]);
      if (key) {
        const val = parseBRL(compM[3]);
        // Acumula: ex. "Fundos Listados" + "Alternativo" ambos mapeiam para fiis
        if (val >= 100) {
          const existing = parseInt(result[key] || "0");
          result[key] = String(existing + val);
        }
        continue;
      }
    }

    // ── Detectar linha de classe na Posição Detalhada: "ClassName R$ VALUE -" ─
    // Aceita tanto "VALUE - 17%" quanto "VALUE -17%" (sem espaço após traço)
    const classHdrM = nt_line.match(
      /^([A-Z][A-Z\s/\-.]{2,40}?)\s+R\$\s*([\d.]+,\d{2})\s+[-–]/
    );
    if (classHdrM) {
      const key = classNameToKey(classHdrM[1]);
      if (key) {
        currentClassKey = key;
        const val = parseBRL(classHdrM[2]);
        if (val >= 100 && !result[key]) result[key] = String(val);
        continue;
      }
    }

    // ── Detectar nome de classe standalone (sem R$) ─────────────────
    // pdfjs às vezes separa o nome da classe do seu valor em linhas diferentes.
    // Ex.: linha "Inflação" sozinha → linha seguinte "R$ 50.000,00 - 12%"
    // Sem isso, currentClassKey ficaria como posFixado e os ativos IPCA+ iriam errado.
    if (!compM && !classHdrM && !/ R\$/.test(t) && t.length < 60) {
      const standaloneKey = classNameToKey(nt_line);
      if (standaloneKey) {
        currentClassKey = standaloneKey;
        continue;
      }
    }

    // ── Detectar ativo individual: "Nome R$ VALUE QTD %ALOC% RENT%" ─
    // QTD é um número (inteiro ou decimal) — diferencia de classe (que tem "-")
    if (!currentClassKey) continue;

    // Formato XP: Nome R$ VALOR [QTD] %ALOC RENT_MES% [CDI%] [RENT_ANO%]
    // QTD é opcional — alguns PDFs omitem a coluna de quantidade (especialmente Ações)
    // Lookahead negativo (?!\s*%) garante que QTD não seja confundido com percentual
    const assetM = t.match(
      /^(.+?)\s+R\$\s*([\d.]+,\d{2})(?:\s+([\d.,]+)(?!\s*%))?\s+([\d,]+)%\s+([-\d,]+)%(?:\s+([-\d,]+)%(?:\s+([-\d,]+)%)?)?/
    );

    // Fallback: ativo sem colunas de percentual — "Nome R$ Valor [Qty]"
    // Cobre tickers de ações em PDFs que não exibem rentabilidade por ativo
    const assetFallbackM = !assetM && (() => {
      const m = t.match(/^(.+?)\s+R\$\s*([\d.]+,\d{2})(?:\s+[\d.,]+)?\s*$/);
      if (!m) return null;
      if (classNameToKey(norm(m[1]))) return null; // É nome de classe, não de ativo
      return m;
    })();

    const matchToUse = assetM || assetFallbackM;
    if (matchToUse) {
      const nomeRaw = matchToUse[1].trim();
      const valor   = parseBRL(matchToUse[2]);
      // grupo 5 = RENT_MES, grupo 6 = CDI_MES (opcional), grupo 7 = RENT_ANO (opcional)
      const rentMes = assetM ? (assetM[5] || "") : "";
      const rentAno = assetM && assetM[7] ? assetM[7].replace(",", ".") : "";

      if (valor <= 0 || nomeRaw.length < 2) continue;
      if (/^(?:CAIXA|PROVENTOS|TOTAL)/i.test(nomeRaw)) continue;

      // Extrai vencimento do nome antes de limpar (ex: "NOV/2027", "MAI/28")
      const vencM = nomeRaw.match(/\b([A-Z]{3}\/\d{2,4})\b/i);
      const vencimento = vencM ? vencM[1].toUpperCase() : "";

      // Limpa o nome em 3 passos:
      // 1. Remove prefixo IPC-A/IPCA no início: "IPC-A + 10,50% CRI..."  → "CRI..."
      // 2. Remove sufixo de indexador no fim: "- IPC-A + 8,03%" ou "- 101,00% CDI"
      // 3. Remove " -" solto no final (carry residual)
      const nome = nomeRaw
        .replace(/^(?:IPC[-\s]*A|IPCA)\s*\+\s*[\d,]+%\s+/i, "")
        .replace(/\s*[-–]\s*(?:(?:IPC[-\s]*A|IPCA)\s*\+\s*)?[\d,]+%[\w\s%+-]*$/i, "")
        .replace(/\s*[-–]\s*$/, "")
        .trim();

      // Se o nome (antes de limpar) contém "IPC-A +" ou "IPCA+", forçar classe ipca
      // independentemente do currentClassKey (garante classificação correta mesmo se
      // o pdfjs não capturou o cabeçalho "Inflação" na linha certa)
      const isIpca = /(?:IPC[-\s]*A|IPCA)\s*\+/i.test(nomeRaw);
      const effectiveKey = isIpca ? "ipca" : currentClassKey;

      const ativosKey = effectiveKey + "Ativos";
      if (!result[ativosKey]) result[ativosKey] = [];

      // Evita duplicatas (compara nome limpo)
      if (!result[ativosKey].find(a => a.nome === nome)) {
        result[ativosKey].push({
          id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          nome,
          valor: String(valor),
          rentMes,
          rentAno,
          vencimento,
          objetivo: "",
          segmento: "",
        });
      }
    }
  }

  // ── Fallback: se ainda não encontrou classes, busca por padrão livre ─
  for (const { key, pats } of CLASS_DEFS) {
    if (result[key]) continue;
    for (const pat of pats) {
      const idx = nt.search(pat);
      if (idx < 0) continue;
      // Busca a primeira ocorrência de "R$ VALUE" nos próximos 400 chars
      const chunk = nt.slice(idx, Math.min(nt.length, idx + 400));
      const valM = chunk.match(/R\$\s*([\d.]+,\d{2})/);
      if (valM) {
        const val = parseBRL(valM[1]);
        if (val >= 10000 && val <= 10_000_000_000) {
          result[key] = String(val);
          break;
        }
      }
    }
  }

  // Rentabilidade anual é exibida no KPI principal da página Carteira
  if (result._rentAno) result.rentabilidade = result._rentAno;
  else if (result._rentMes) result.rentabilidade = result._rentMes;

  // ── Data de referência (primeira página) ───────────────────
  // Formatos aceitos: "Data de Referência 15/04/2026", "Ref. 15/04/2026", "em 15/04/2026"
  const dataRefRE = [
    /DATA\s+DE\s+REFER.{0,4}NCIA\s*:?\s*(\d{2})\/(\d{2})\/(\d{2,4})/i,
    /POSI.{0,4}O\s+EM\s*:?\s*(\d{2})\/(\d{2})\/(\d{2,4})/i,
    /REFER.{0,4}NCIA\s*:?\s*(\d{2})\/(\d{2})\/(\d{2,4})/i,
    /\bEM\s+(\d{2})\/(\d{2})\/(\d{4})\b/i,
  ];
  for (const re of dataRefRE) {
    const m = nt.match(re);
    if (m) {
      const dd = m[1], mm = m[2];
      let yyyy = m[3];
      if (yyyy.length === 2) yyyy = "20" + yyyy;
      result._dataReferencia = `${yyyy}-${mm}-${dd}`;
      result._mesReferencia = `${yyyy}-${mm}`;
      break;
    }
  }

  // ── Tabela "Rentabilidade dos últimos 12 meses" ─────────────
  // Formato XP típico:
  //   Referência  Jan  Fev  Mar  Abr  Mai  Jun  Jul  Ago  Set  Out  Nov  Dez  Ano
  //   2026        Portfólio  2,82% 2,37% -0,68% 2,42% -    -    -    -    -   -   -   -   7,08%
  //   2026        %CDI       …
  //   2025        Portfólio  1,56% 1,32% 3,68% 3,02% 1,64% 1,34% -0,50% 4,21% 3,03% 1,73% 2,88% 1,90%  28,97%
  //
  // Extrai matriz { [YYYY]: [jan%, fev%, ..., dez%] } com valores numéricos (null quando "-").
  const mesesMap = {};

  // 1ª tentativa: localiza bloco via cabeçalho "Referência ... Jan ... Fev ... Mar"
  let tabelaIdx = text.search(/Refer.{0,4}ncia[\s\S]{0,120}?Jan[\s\S]{0,80}?Fev[\s\S]{0,80}?Mar/i);
  // 2ª: cabeçalho alternativo "Rentabilidade ... (últim|histór) ... Jan Fev Mar"
  if (tabelaIdx < 0) tabelaIdx = text.search(/Rentabilidade[\s\S]{0,200}?(?:.ltim|hist.r)[\s\S]{0,200}?Jan[\s\S]{0,40}?Fev[\s\S]{0,40}?Mar/i);
  // 3ª: cabeçalho só com a sequência Jan Fev Mar Abr
  if (tabelaIdx < 0) tabelaIdx = text.search(/\bJan\b[\s\S]{0,40}?\bFev\b[\s\S]{0,40}?\bMar\b[\s\S]{0,40}?\bAbr\b/i);

  if (tabelaIdx >= 0) {
    const trecho = text.slice(tabelaIdx, Math.min(text.length, tabelaIdx + 4000));

    // A: "YYYY ... Portfólio/Carteira/Estratégia <12 valores> <total ano>"
    const ptfRe = /(20\d{2})[\s\S]{0,120}?(?:Portf.lio|Carteira|Estrat.gia)\s+((?:(?:-?\d[\d,]*%|-)\s+){12})\s*(-?\d[\d,]*%|-)?/gi;
    let m;
    while ((m = ptfRe.exec(trecho)) !== null) {
      const ano = m[1];
      const celulas = m[2].trim().split(/\s+/);
      const arr = celulas.map(c => {
        if (c === "-" || c === "—") return null;
        const num = parseFloat(c.replace("%", "").replace(",", "."));
        return isNaN(num) ? null : num;
      });
      if (arr.length === 12 && !mesesMap[ano]) mesesMap[ano] = arr;
    }

    // B (fallback): linhas que começam com YYYY seguidas de 4-13 percentuais.
    // Cobre casos em que a palavra "Portfólio" não foi capturada (PDF com
    // layout diferente, OCR quebrado, extrações com colunas deslocadas).
    if (Object.keys(mesesMap).length === 0) {
      const anoLinhaRe = /(?:^|\n)\s*(20\d{2})\b([^\n]*)/g;
      let lm;
      while ((lm = anoLinhaRe.exec(trecho)) !== null) {
        const ano = lm[1];
        if (mesesMap[ano]) continue;
        const resto = lm[2];
        // Extrai TODOS os percentuais e traços da linha, na ordem
        const tokens = resto.match(/-?\d[\d,]*%|(?<=\s|^)-(?=\s|$)/g) || [];
        if (tokens.length < 4) continue;
        // Descarta a última célula (total do ano) se tiver 13 tokens.
        // Se tiver <12, preenche com null até 12.
        let celulas = tokens.slice(0, 12);
        if (tokens.length >= 13) celulas = tokens.slice(0, 12); // ignora coluna "Ano"
        const arr = [];
        for (let i = 0; i < 12; i++) {
          const c = celulas[i];
          if (!c || c === "-" || c === "—") { arr.push(null); continue; }
          const num = parseFloat(c.replace("%", "").replace(",", "."));
          arr.push(isNaN(num) ? null : num);
        }
        // Só aceita se tem ao menos 3 valores numéricos reais
        const preenchidos = arr.filter(v => typeof v === "number").length;
        if (preenchidos >= 3) mesesMap[ano] = arr;
      }
    }
  }
  if (Object.keys(mesesMap).length > 0) {
    result._tabelaRentMensal = mesesMap;

    // Cálculo rent 12 meses compostos (a partir do mês de referência)
    if (result._mesReferencia) {
      const [yyyyStr, mmStr] = result._mesReferencia.split("-");
      const yy = parseInt(yyyyStr);
      const mm = parseInt(mmStr); // 1-12
      const seq = [];
      // Percorre os 12 meses anteriores ao mês de referência (inclusive)
      for (let k = 0; k < 12; k++) {
        let targetMonth = mm - k; // 1-indexado
        let targetYear = yy;
        while (targetMonth <= 0) { targetMonth += 12; targetYear -= 1; }
        const arr = mesesMap[String(targetYear)];
        if (arr && typeof arr[targetMonth - 1] === "number") {
          seq.push(arr[targetMonth - 1]);
        }
      }
      if (seq.length > 0) {
        const composto = seq.reduce((acc, r) => acc * (1 + r / 100), 1) - 1;
        // Só usa o cálculo composto como fallback: se o PDF já traz rent12m
        // explícito na tabela "Referências (%)" (linha Portfólio), preserva.
        if (!result._rent12m) {
          result._rent12m = (composto * 100).toFixed(2);
          result._rent12mFonte = "calculo-composto";
        }
        result._rent12mMesesUsados = seq.length;
      }
    }
  }

  // ── Movimentações detalhadas (com data) ────────────────────
  // Formato XP: "DD/MM/YYYY DD/MM/YYYY  TIPO  ATIVO  R$ VALOR  R$ SALDO"
  // ATENÇÃO: XP inclui uma infinidade de "APLICAÇÃO COMPROMISSADA" e
  // "RECOMPRA COMPROMISSADA" e "IRRF RECOMPRA COMPROMISSADA" — todas
  // são operações INTERNAS de tesouraria (aplicam overnight e recompram
  // no dia seguinte). Essas devem ser IGNORADAS no extrato do cliente.
  //
  // Relevantes (aparecem no extrato):
  //   • RENDIMENTO FUNDO FECHADO BALCÃO XXX   → rendimento
  //   • RENDIMENTOS DE CLIENTES XXX           → rendimento (FII/ETF)
  //   • Pgto Juros XXX                        → juros (CRI/CRA/DEB)
  //   • Pgto Amortização XXX                  → amortizacao (CRI/CRA)
  //   • DIVIDENDOS DE CLIENTES XXX            → dividendo (RV)
  //   • JUROS S/ CAPITAL DE CLIENTES XXX      → dividendo (JCP)
  //   • TED ... TED APLICAÇÃO FUNDOS XXX       → aporte
  //   • TED ... TED RESGATE FUNDOS XXX         → retirada
  //
  // Descartadas (ruído de tesouraria):
  //   • APLICAÇÃO COMPROMISSADA XXX
  //   • RECOMPRA COMPROMISSADA XXX
  //   • IRRF RECOMPRA COMPROMISSADA XXX
  //   • Investback (contra-entrada do TED do Investback)
  const movimentacoesDetalhadas = [];
  // R$ obrigatório no valor — evita casar com "quantidade" (ex.: "S/ 5,030")
  // que tem formato numérico parecido. Aceita "-R$" antes do número.
  const movLineRe = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\s*R\$\s*-?\s*[\d.]+,\d{2})/g;
  const textForMovs = text;
  let movMatch;
  const seen = new Set();

  while ((movMatch = movLineRe.exec(textForMovs)) !== null) {
    const [dd, mmN, yyyyN] = movMatch[2].split("/");
    const dataISO = `${yyyyN}-${mmN}-${dd}`;
    const descRaw = movMatch[3].trim();
    const valorStr = movMatch[4].replace(/R\$|\s/g, "");
    const negativo = valorStr.startsWith("-");
    const valor = parseBRL(valorStr.replace("-", ""));
    if (valor < 1) continue;
    const descNorm = norm(descRaw).toUpperCase();

    // ── IGNORAR tesouraria ────────────────────────────────
    if (/COMPROMISSADA/i.test(descNorm)) continue;
    if (/^IRRF\b/i.test(descNorm)) continue;

    // ── Classificar ───────────────────────────────────────
    let tipo = null;
    let ativo = "";

    // JCP / Dividendos
    if (/DIVIDENDOS?\s+DE\s+CLIENTES?/i.test(descNorm)) {
      tipo = "dividendo";
      const am = descRaw.match(/DIVIDENDOS?\s+DE\s+CLIENTES?\s+([A-Z0-9]{2,10})/i);
      if (am) ativo = am[1];
    } else if (/JUROS\s+S\/?\s*CAPITAL\s+DE\s+CLIENTES?|JCP|JSCP/i.test(descNorm)) {
      tipo = "dividendo";
      const am = descRaw.match(/JUROS\s+S\/?\s*CAPITAL\s+DE\s+CLIENTES?\s+([A-Z0-9]{2,10})/i);
      if (am) ativo = am[1];
    }
    // Juros sobre CRI/CRA/DEB
    else if (/PGTO\s+JUROS/i.test(descNorm)) {
      tipo = "juros";
      const am = descRaw.match(/\|\s*(.+?)(?:\s+R\$|$)/);
      if (am) ativo = am[1].trim().slice(0, 60);
    }
    // Amortização
    else if (/PGTO\s+AMORTIZA|AMORTIZA/i.test(descNorm)) {
      tipo = "amortizacao";
      const am = descRaw.match(/\|\s*(.+?)(?:\s+R\$|$)/);
      if (am) ativo = am[1].trim().slice(0, 60);
    }
    // Rendimento de fundo fechado (FII/FIP/FIAGRO)
    else if (/RENDIMENTO\s+FUNDO\s+FECHADO/i.test(descNorm)) {
      tipo = "rendimento";
      const am = descRaw.match(/BALC[AÃ]O\s+([A-Z0-9]{2,8})/i);
      if (am) ativo = am[1];
    }
    // Rendimento de clientes (FII/ETF)
    else if (/RENDIMENTOS?\s+DE\s+CLIENTES?/i.test(descNorm)) {
      tipo = "rendimento";
      const am = descRaw.match(/RENDIMENTOS?\s+DE\s+CLIENTES?\s+([A-Z0-9]{2,10})/i);
      if (am) ativo = am[1];
    }
    // ── Aporte real: TED / PIX / DOC de ENTRADA (dinheiro vindo de FORA da corretora)
    // A descrição precisa explicitar entrada/aplicação. "TED APLICAÇÃO FUNDOS" é o
    // padrão clássico XP. PIX entrada tb é aporte. Sozinho "APLICAÇÃO" pode ser
    // aplicação interna em fundo, então exigimos "TED" ou "PIX" antes.
    else if (/^(TED|PIX|DOC).*(APLICA|ENTRADA|RECEB)/i.test(descNorm)
             || /APLICA.{0,8}FUND/i.test(descNorm)) {
      tipo = "aporte";
    }
    // ── Vencimento de título: o ativo amadurece e o capital volta pro caixa,
    // SEM saída de dinheiro da corretora. NÃO é retirada nem aporte. Marca
    // como "vencimento" (categoria neutra) e o cliente vai realocar internamente.
    else if (/VENCIMENTO|VCTO\b|MATURITY/i.test(descNorm)) {
      tipo = "vencimento";
    }
    // ── Retirada real: TED/PIX/DOC saindo da corretora (dinheiro indo pra fora)
    // Exige indicador explícito de saída. Apenas "RESGATE" sem TED não conta —
    // pode ser resgate interno de cota/título (= vencimento).
    else if (/^(TED|PIX|DOC).*(RETIRADA|RESGATE|ENVIO|SAIDA)/i.test(descNorm)
             || /TRANSFER\w*\s+ENVI|SAQUE\s+(EM|DE|VIA)/i.test(descNorm)) {
      tipo = "retirada";
    }
    // ── Resgate interno (sem TED) = ativo voltou pra caixa internamente.
    // Tratamos como vencimento (não conta como retirada).
    else if (/^RESGATE\b/i.test(descNorm)) {
      tipo = "vencimento";
    }
    // Compra / Venda de ativo
    else if (/COMPRA\b|AQUISI/i.test(descNorm)) {
      tipo = "compra";
    } else if (/VENDA\b|ALIENA/i.test(descNorm)) {
      tipo = "venda";
    }
    // Taxas
    else if (/TAXA|IMPOSTO|IOF|EMOLUMENTO|CUSTO|CORRETAGEM/i.test(descNorm)) {
      tipo = "taxa";
    }

    if (!tipo) continue;

    // Dedup por data+tipo+ativo+valor
    const dedup = `${dataISO}|${tipo}|${ativo}|${Math.round(valor)}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    movimentacoesDetalhadas.push({
      data: dataISO,
      tipo,
      descricao: descRaw.slice(0, 120),
      ativo,
      valor,
      negativo,
    });
  }
  if (movimentacoesDetalhadas.length > 0) {
    result._movimentacoes = movimentacoesDetalhadas;
  }

  // ── Somatórios agregados (a partir das movimentações já filtradas) ─
  // Usa _movimentacoes (que já tirou tesouraria) em vez de re-parsear o texto.
  if (movimentacoesDetalhadas.length > 0) {
    let dividendos = 0, juros = 0, amort = 0, rendimentos = 0;
    let aportes = 0, retiradas = 0, taxas = 0, vencimentos = 0;
    for (const m of movimentacoesDetalhadas) {
      if (m.tipo === "dividendo")       dividendos += m.valor;
      else if (m.tipo === "juros")      juros += m.valor;
      else if (m.tipo === "amortizacao")amort += m.valor;
      else if (m.tipo === "rendimento") rendimentos += m.valor;
      else if (m.tipo === "aporte")     aportes += m.valor;
      else if (m.tipo === "retirada")   retiradas += m.valor;
      else if (m.tipo === "taxa")       taxas += m.valor;
      else if (m.tipo === "vencimento") vencimentos += m.valor;
    }
    // vencimentos NÃO entram no resumo (são neutros — capital volta internamente).
    // Apenas o tipo individual fica registrado nas movimentações pra timeline.
    void vencimentos;
    if (dividendos > 0)  result._dividendos = dividendos;
    if (juros > 0)       result._juros = juros;
    if (amort > 0)       result._amortizacao = amort;
    if (rendimentos > 0) result._rendimentosPassivos = rendimentos;
    if (aportes > 0)     result._aportes = aportes;
    if (retiradas > 0)   result._resgates = retiradas;
    if (taxas > 0)       result._taxas = taxas;
  }

  result._tipo = "relatorio";
  dbg("[WealthTrack] parseRelatorio resultado:", result);
  return result;
}

// ── Mapeamento de categorias de gastos (fatura) ───────────────

const CAT_RULES = [
  { key: "alimentacao", re: /ALIMENTA.{0,4}O|SUPERMERC|PADARIA|RESTAURANTE|LANCHONETE|A.OUGUE|HORTIFRUTI|MERCEARIA|EMP.RIO|CAFETERIA|SORVETERIA|CONFEITARIA/i },
  { key: "carro",       re: /VE.CULOS|COMBUST.VEL|GASOLINA|ETANOL|AUTO\s*PE.A|ESTACION|PED.GIO|OFICINA|MEC.NICA|LAVA\s*R.PIDO|LAVA\s*JATO|BORRACHARIA|FUNILARIA|LICENCIAMENTO/i },
  { key: "saude",       re: /SA.DE|FARM.CIA|DROGARIA|HOSPITAL|CL.NICA|LABORAT|.PTICA|HIGIENE|DENTISTA|FISIOTERAPIA|PSICOL|NUTRIC|ACADEMIA|PILATES|YOGA/i },
  { key: "educacao",    re: /EDUCA.{0,4}O|ESCOLA|COL.GIO|FACULDADE|UNIVERSIDADE|CURSO\b|IDIOMA|LIVROS|PAPELARIA|MENSALIDADE|MATR.CULA|CRECHE|BERC.RIO/i },
  { key: "lazer",       re: /TURISMO|ENTRETENIM|CINEMA|TEATRO|SHOW\b|HOTEL\b|POUSADA|DIVERS.O|LAZER|ESPORTE|AIRBNB|VIAGEM|PASSAGEM|RESORT|PARQUE|MUSEU/i },
  { key: "assinaturas", re: /STREAMING|ASSINATURA|TELEFONIA|TELECOMUNIC|INTERNET\b|BANDA\s*LARGA|TV\s*POR\s*ASSINATURA/i },
  { key: "moradia",     re: /CONDOM.NIO|ALUGUEL|SERV.*P.BLICOS|ENERGIA\s+EL.TRICA|SANEAMENTO|.GUA\b|G.S\b|IPTU|FINANCIAMENTO\s+IMOB/i },
  { key: "cartoes",     re: /VEST.{0,4}RIO|CAL.ADOS|MODA\b|ROUPAS|JOALHERIA|ELETR.NICO|PERFUMARIA|COSM.TICOS/i },
  { key: "seguros",     re: /SEGUROS|SEGURADORA|SEGURO\s+(?:DE\s+)?VIDA|SEGURO\s+(?:DE\s+)?AUTO|SEGURO\s+RESID/i },
  { key: "outros",      re: /OUTROS|DIVERSOS/i },
];

const MERCHANT_RULES = [
  // Alimentacao - supermercados
  { key: "alimentacao", re: /ZAFFARI|WALMART|CARREFOUR|ASSAI|ATACAD|EXTRA\b|BIG\b|HORTIFRUTI|SHIBATA|GBARBOSA|SAVEGNAGO|TOSANO|SONDA|MUFFATO|CONDOR|DIA\s*%|MAKRO|SAM.S\s*CLUB|PAO\s*DE\s*A.UCAR|MAMBO|HIRO|VERDEMAR|.SUPER|COVABRA|NATURAL\s*DA\s*TERRA|EMP.RIO/i },
  // Alimentacao - fast food / restaurantes
  { key: "alimentacao", re: /MCDONALDS|MC\s*DONALDS|BURGER\s*KING|SUBWAY|HABIB|GIRAFFAS|DOMINOS|PIZZA\s*HUT|KFC\b|OUTBACK|MADERO|BOB.S|SPOLETO|CHINA\s*IN\s*BOX|JERONIMO|BACIO\s*DI\s*LATTE|STARBUCKS|CACAU\s*SHOW|SUKIYA/i },
  // Alimentacao - delivery
  { key: "alimentacao", re: /IFOOD|RAPPI|UBER\s*EATS|JAMES\s*DELIVERY|AI\s*QUE\s*FOME|DAKI/i },
  // Alimentacao - padarias
  { key: "alimentacao", re: /PADARIA|CONFEITARIA|DELICATESSEN|BENJAMIN|RANI/i },

  // Carro - postos de combustivel
  { key: "carro",       re: /PETROBRAS|IPIRANGA|SHELL|BR\s*MANIA|RAIZEN|GRAAL|ALE\b|POSTO\b|VIBRA|TICKET\s*LOG/i },
  // Carro - mobilidade
  { key: "carro",       re: /\bUBER\b|99\s*(?:TAXI|DRIVER|POP|APP)|CABIFY|99POP|BLABLACAR|ZUL\s*DIGITAL|ESTAPAR|MULTIPARK|PARK\s*EXPRESS/i },
  // Carro - manutencao e financeiro
  { key: "carro",       re: /DETRAN|IPVA|DPVAT|LICENCIAMENTO|SEM\s*PARAR|CONECTCAR|VELOE|MOVE\s*MAIS|GREEN\s*PASS/i },
  // Carro - locadoras
  { key: "carro",       re: /LOCALIZA|MOVIDA|UNIDAS|HERTZ|RENT\s*A\s*CAR/i },

  // Saude - farmacias
  { key: "saude",       re: /DROGASIL|DROGA\s*RAIA|RAIADROGASIL|NISSEI|ULTRAFARMA|PAGUE\s*MENOS|PANVEL|PACHECO|VENANCIO|S.O\s*PAULO\s*FARMA|EXTRAFARMA|ARAUJO\s*FARM/i },
  // Saude - planos
  { key: "saude",       re: /UNIMED|AMIL|SULAMERICA|HAPVIDA|NOTREDAME|PREVENT\s*SENIOR|BRADESCO\s*SA.DE|PORTO\s*SE.?(?:URO)?\s*SA.DE|GOLDEN\s*CROSS|ALLIANZ\s*SA.DE|CASSI/i },
  // Saude - laboratorios e clinicas
  { key: "saude",       re: /FLEURY|DASA|HERMES\s*PARDINI|SABIN|DELBONI|DR\s*CONSULTA|EINSTEIN|S.RIO\s*LIBAN.S|HCOR/i },
  // Saude - academia / wellness
  { key: "saude",       re: /SMART\s*FIT|BIO\s*RITMO|BLUEFIT|TOTAL\s*PASS|GYMPASS|WELLHUB|BODYTECH/i },

  // Assinaturas - streaming
  { key: "assinaturas", re: /NETFLIX|SPOTIFY|AMAZON\s*PRIME|DISNEY\s*PLUS|DISNEY\+|GLOBOPLAY|YOUTUBE\s*PREM|DEEZER|MAX\b|HBO|PARAMOUNT|APPLE\s*TV|TIDAL|CRUNCHYROLL|DAZN/i },
  // Assinaturas - telefonia
  { key: "assinaturas", re: /\bTIM\b|\bCLARO\b|\bVIVO\b|\bOI\s*FIX|NEXTEL|ALGAR|SURF\s*TELE/i },
  // Assinaturas - software
  { key: "assinaturas", re: /MICROSOFT|ADOBE|DROPBOX|ICLOUD|OFFICE\s*365|GOOGLE\s*ONE|GOOGLE\s*WORKSPACE|NOTION|FIGMA|CHATGPT|OPENAI|ANTHROPIC|GITHUB|JETBRAINS/i },
  // Assinaturas - educacao continuada / news
  { key: "assinaturas", re: /AUDIBLE|SKILLSHARE|COURSERA|UDEMY|ALURA|ROCKETSEAT|FOLHA\s*DE\s*SP|ESTAD.O|VEJA\s*DIGITAL/i },

  // Lazer - cinemas
  { key: "lazer",       re: /CINESYSTEM|CINEMARK|UCI\s+CINEMA|KINOPLEX|MOVIECOM|CINEPOLIS|CINE\s*ARAUJO/i },
  // Lazer - viagem
  { key: "lazer",       re: /BOOKING|AIRBNB|DECOLAR|HURB|HOTEIS\.COM|EXPEDIA|TRIVAGO|LATAM|GOL\s*LINHAS|AZUL\s*LINHAS|SMILES|TUDOAZUL|123MILHAS|MAXMILHAS|CVC|TRIP\s*COM/i },
  // Lazer - eventos
  { key: "lazer",       re: /INGRESSO\s*COM|SYMPLA|ROCK\s*IN\s*RIO|TICKETMASTER|EVENTIM|TICKET360/i },

  // Moradia - saneamento
  { key: "moradia",     re: /SABESP|COPASA|SANEPAR|EMBASA|CASAN|CAESB|CAGECE|COMPESA|CESAN|CAERN|DAE\b/i },
  // Moradia - energia
  { key: "moradia",     re: /CEMIG|CPFL|\bENEL\b|\bLIGHT\b|COELBA|ENERGISA|ELEKTRO|EQUATORIAL|EDP\b|RGE\b|CELESC|COSERN|CELPE/i },
  // Moradia - gas
  { key: "moradia",     re: /COMGAS|GAS\s*NATURAL|NATURGY|CEG\b|BAHIAGAS|MSGAS|SCGAS/i },
  // Moradia - internet/banda larga (operadoras de internet residencial)
  { key: "moradia",     re: /NET\s*VIRTUA|VIVO\s*FIBRA|CLARO\s*NET|OI\s*FIBRA|SKY\b|DIRECTV|GIGA\s*FIBRA|AMERICANET|DESKTOP/i },
  // Moradia - condominio
  { key: "moradia",     re: /CONDOM.NIO|TAXA\s*CONDOMINIAL/i },

  // Educacao - escolas e cursos
  { key: "educacao",    re: /KUMON|WIZARD|CCAA|CULTURA\s*INGLESA|FISK|YAZIGI|CNA\b|BERLITZ/i },
  { key: "educacao",    re: /COL.GIO|ESCOLA\s+|FACULDADE|UNIVERSIDADE|FAAP|FGV|MACKENZIE|INSPER|PUC\b|USP\b|UNICAMP|UFRJ/i },

  // Cartoes / shopping
  { key: "cartoes",     re: /AMERICANAS|MAGAZINE\s*LUIZA|MAGALU|CASAS\s*BAHIA|PONTO\s*FRIO|FAST\s*SHOP|EFACIL|RIACHUELO|RENNER|C&A|MARISA|HERING|ZARA|H&M|FOREVER\s*21|MERCADO\s*LIVRE|SHOPEE|ALIEXPRESS|AMAZON\s*BR|NETSHOES|DAFITI|CENTAURO|DECATHLON/i },

  // Seguros
  { key: "seguros",     re: /PORTO\s*SE.?(?:URO)?(?!\s*SA.DE)|MAPFRE|BRADESCO\s*SEG|AZUL\s*SEG|ALLIANZ(?!\s*SA.DE)|TOKIO\s*MARINE|ZURICH|HDI\s*SEG|YOUSE|LIBERTY/i },
];

function mapCategory(nearbyText, merchantName) {
  const context = norm(nearbyText || "");
  const merchant = norm(merchantName || "");
  for (const { key, re } of CAT_RULES) {
    if (re.test(context)) return key;
  }
  for (const { key, re } of MERCHANT_RULES) {
    if (re.test(merchant)) return key;
  }
  for (const { key, re } of CAT_RULES) {
    if (re.test(merchant)) return key;
  }
  return "outros";
}

// API publica para classificar uma descricao isolada.
// Retorna a chave da categoria ou "outros" quando nao identifica.
export function classificarItem(descricao) {
  const txt = norm(descricao || "");
  if (!txt) return "outros";
  for (const { key, re } of MERCHANT_RULES) {
    if (re.test(txt)) return key;
  }
  for (const { key, re } of CAT_RULES) {
    if (re.test(txt)) return key;
  }
  return "outros";
}

// ── Parser genérico de fatura / extrato ───────────────────────
// Estratégia robusta:
//   1. Extrai o TOTAL DA FATURA declarado (para validação)
//   2. Detecta seções para evitar duplicação (compras nacionais vs internacionais,
//      saldo anterior, pagamentos recebidos, resumo vs lançamentos detalhados)
//   3. Parseia transações, trata estornos (CR) como negativos
//   4. Deduplica (mesma data+descrição+valor aparecem no resumo E no detalhe)
//   5. Valida a soma contra o total declarado e ajusta se divergente

function parseFatura(text) {
  const lines = text.split("\n");
  const result = {};

  // 1. ── EXTRAÇÃO DO TOTAL DECLARADO DA FATURA ─────────────────
  // Procura múltiplos formatos usados por diferentes bancos/operadoras
  const totalPatterns = [
    /TOTAL\s+DESTA\s+FATURA\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /TOTAL\s+DA\s+FATURA\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /VALOR\s+DESTA\s+FATURA\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /VALOR\s+(?:DA\s+)?FATURA\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /TOTAL\s+A\s+PAGAR\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /VALOR\s+A\s+PAGAR\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /NOVO\s+SALDO\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
    /SALDO\s+ATUAL\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i,
  ];
  let faturaTotal = 0;
  const nt = norm(text);
  for (const re of totalPatterns) {
    const m = nt.match(re);
    if (m) { faturaTotal = parseBRL(m[1]); break; }
  }

  // 2. ── REGEX DE TRANSAÇÃO E FILTROS ──────────────────────────
  const TRANS_RE = /^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+([\d.]+,\d{2})(?:\s+(CR|C|D))?$/;
  // Linhas de resumo/header — nunca são transações reais
  const SKIP_RE = /^(?:TOTAL|SUBTOTAL|VENCIMENTO|DATA\b|VALOR\b|SALDO|LIMITE|FATURA\b|PAGAMENTO\b|PAGAMENTOS\b|CAMBIO|C.MBIO|MULTA|TARIFA|ANUIDADE|\*{3}|-{3}|={3})/i;

  // Seções que DEVEM ser puladas para evitar soma errada:
  //   - Saldo anterior / fatura anterior (já pago, não é gasto novo)
  //   - Pagamentos recebidos (crédito, não gasto)
  //   - Compras internacionais em US$ (valor em dólar é mostrado junto com
  //     o convertido em R$; contar ambos duplica)
  //   - Resumo da fatura no início (as transações aparecem novamente no detalhe)
  const SECTION_SKIP_START = [
    /SALDO\s+ANTERIOR/i,
    /FATURA\s+ANTERIOR/i,
    /PAGAMENTO(?:S)?\s+(?:RECEBIDO|EFETUADO)/i,
    /CR.DITOS?\s+E\s+PAGAMENTOS?/i,
    /COMPRAS?\s+INTERNACIONAIS/i,
    /LAN.AMENTOS?\s+INTERNACIONAIS/i,
    /COMPRAS?\s+EM\s+US\$|EM\s+D.LAR/i,
    /RESUMO\s+(?:DA\s+)?FATURA/i,
    /RESUMO\s+DOS?\s+LAN.AMENTOS?/i,
    /TOTAIS\s+POR\s+CATEGORIA/i,
  ];
  const SECTION_SKIP_END = [
    /COMPRAS?\s+(?:NACIONAIS|DO\s+M.S|DO\s+PER.ODO)/i,
    /LAN.AMENTOS?\s+(?:NACIONAIS|DO\s+M.S|DO\s+PER.ODO|DETALHAD)/i,
    /GASTOS?\s+(?:DO\s+M.S|DO\s+PER.ODO)/i,
    /DETALHAMENTO/i,
  ];

  // 3. ── COLETA DE TRANSAÇÕES COM SECTION AWARENESS ────────────
  let skippingSection = false;
  const allTrans = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const normLine = norm(line);

    // Detecta início de seção para pular
    for (const re of SECTION_SKIP_START) {
      if (re.test(normLine)) { skippingSection = true; break; }
    }
    // Detecta fim de seção (entrando em área de compras normais)
    for (const re of SECTION_SKIP_END) {
      if (re.test(normLine)) { skippingSection = false; break; }
    }

    if (SKIP_RE.test(line)) continue;
    if (skippingSection) continue;

    const m = TRANS_RE.exec(line);
    if (!m) continue;

    const data = m[1].slice(0, 5);
    const nome = m[2].trim();
    const valor = parseBRL(m[3]);
    const suffix = (m[4] || "").toUpperCase();
    // CR = crédito/estorno. Também detecta palavras no nome
    const isCredit = suffix === "CR" || suffix === "C" ||
      /\b(ESTORNO|DEVOLU.{0,4}O|REEMBOLSO|CR.DITO|CANCELAMENTO)\b/i.test(norm(nome));

    if (valor <= 0 || valor > 20000000) continue;
    if (nome.length < 3) continue;
    // Filtra linhas que começam com código/ID puramente numérico
    if (/^\d{6,}$/.test(nome)) continue;

    allTrans.push({ data, nome, valor, isCredit, lineIdx: i });
  }

  // 4. ── DEDUPLICAÇÃO ─────────────────────────────────────────
  // Mesma data + valor + primeiras palavras do nome = mesma transação
  // (acontece quando o PDF lista resumo + detalhe, ou repete em páginas)
  const seen = new Map();
  const uniqTrans = [];
  for (const t of allTrans) {
    const nomeKey = norm(t.nome).replace(/\s+/g, " ").slice(0, 22);
    const key = `${t.data}|${nomeKey}|${t.valor}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    uniqTrans.push(t);
  }

  // 5. ── VALIDAÇÃO CONTRA TOTAL DA FATURA ─────────────────────
  const somaBruta = uniqTrans.reduce((s, t) => s + (t.isCredit ? -t.valor : t.valor), 0);
  let warning = null;
  let transacoes = uniqTrans;

  if (faturaTotal > 0 && somaBruta > 0) {
    const ratio = somaBruta / faturaTotal;
    dbg(`[WealthTrack] Fatura declarada: R$ ${(faturaTotal/100).toFixed(2)} | Soma extraída: R$ ${(somaBruta/100).toFixed(2)} | ratio: ${ratio.toFixed(2)}`);

    if (ratio > 1.4) {
      // Soma muito maior que o total → ainda há duplicação. Dedup mais agressivo:
      // considerar só data+valor (ignora variações no nome)
      const seen2 = new Map();
      const ded2 = [];
      for (const t of uniqTrans) {
        const key = `${t.data}|${t.valor}`;
        if (seen2.has(key)) continue;
        seen2.set(key, true);
        ded2.push(t);
      }
      const soma2 = ded2.reduce((s, t) => s + (t.isCredit ? -t.valor : t.valor), 0);
      if (soma2 <= faturaTotal * 1.2 && soma2 >= faturaTotal * 0.7) {
        transacoes = ded2;
        dbg(`[WealthTrack] Dedup agressivo: R$ ${(soma2/100).toFixed(2)}`);
      } else {
        warning = `Soma das transações (R$ ${(somaBruta/100).toFixed(2)}) maior que o total da fatura (R$ ${(faturaTotal/100).toFixed(2)}). Revise os lançamentos.`;
      }
    } else if (ratio < 0.6) {
      warning = `Soma das transações (R$ ${(somaBruta/100).toFixed(2)}) menor que o total da fatura (R$ ${(faturaTotal/100).toFixed(2)}). Algumas transações podem não ter sido lidas.`;
    }
  }

  // 6. ── CATEGORIZAÇÃO ─────────────────────────────────────────
  for (const t of transacoes) {
    let contexto = "";
    for (let j = t.lineIdx + 1; j <= Math.min(t.lineIdx + 2, lines.length - 1); j++) {
      const nl = lines[j].trim();
      if (!nl || TRANS_RE.test(nl)) break;
      contexto += " " + nl;
    }

    const catKey = mapCategory(contexto, t.nome);
    const signedValor = t.isCredit ? -t.valor : t.valor;

    if (!result[catKey]) result[catKey] = 0;
    result[catKey] += signedValor;
    if (result[catKey] < 0) result[catKey] = 0;

    const itemsKey = catKey + "_items";
    if (!result[itemsKey]) result[itemsKey] = [];
    result[itemsKey].push({
      nome: t.nome,
      valor: t.valor,
      data: t.data,
      ...(t.isCredit ? { credito: true } : {}),
    });
  }

  const output = {};
  for (const [key, val] of Object.entries(result)) {
    output[key] = key.endsWith("_items") ? val : String(val);
  }

  // Metadados de validação (usados pela UI)
  if (faturaTotal > 0) output._faturaTotal = String(faturaTotal);
  if (warning) output._warning = warning;
  output._transacoesExtraidas = String(transacoes.length);

  dbg("[WealthTrack] parseFatura:", {
    faturaTotal: faturaTotal/100,
    transacoes: transacoes.length,
    somaCategorias: Object.entries(result).filter(([k]) => !k.endsWith("_items")).reduce((s,[,v]) => s+v, 0) / 100,
  });

  return output;
}

// ── Parsers genéricos por palavras-chave (fallback) ────────────

const CART_PATTERNS = {
  posFixado: [/CDB\b/i,/LCI\b/i,/LCA\b/i,/LCD\b/i,/LFT\b/i,/TESOURO\s+SELIC/i,/POS.FIXAD/i,/CDI\b/i],
  ipca:      [/IPCA\s*\+/i,/NTN.?B/i,/TESOURO\s+IPCA/i,/INFLACAO|INFLA.{0,3}O\b/i],
  preFixado: [/PRE.FIXAD/i,/TESOURO\s+PREFIXADO/i,/NTN.?F/i,/LTN\b/i],
  acoes:     [/ACOES|A.OES?\b/i,/RENDA\s+VARI.VEL/i,/BOLSA\b/i],
  fiis:      [/FUNDO\s+IMOBILI/i,/FII\b/i,/[A-Z]{4}11\b/i],
  multi:     [/MULTIMERCADO/i,/HEDGE\s*FUND/i],
  prevVGBL:  [/VGBL/i],
  prevPGBL:  [/PGBL/i],
  globalEquities: [/EQUIT(?:IES|Y)\b/i,/BDR\b/i,/ADR\b/i,/RENDA\s+VARI.VEL\b.*GLOBAL/i],
  globalTreasury: [/TREASURY/i,/TESOURO\s+AMERICANO/i,/T-BILL|T-NOTE|T-BOND/i],
  globalFunds:    [/MUTUAL\s+FUNDS?/i,/FUNDOS?\s+INTERNACIONAIS?/i,/FUNDOS?\s+GLOBAIS?/i],
  globalBonds:    [/BONDS?\b/i,/CORPORATE\s+BONDS?/i],
  global:         [/GLOBAL\b/i,/INTERNACIONAL\b/i,/EXTERIOR\b/i,/DOLAR|D.LAR\b/i,/USD\b/i,/CASH\s+SALDO/i],
};

function _parseCarteiraGenerico(text) {
  const res = {};
  for (const [key, pats] of Object.entries(CART_PATTERNS)) {
    let max = 0;
    for (const pat of pats) {
      const v = largestAmountNear(text, pat);
      if (v > max) max = v;
    }
    if (max > 0) res[key] = String(max);
  }
  return res;
}

// ── Parser de ativos individuais (screenshots de app mobile) ───
// Fallback final: se nada estruturado foi identificado, varre o texto
// procurando padrão "NOME ... R$ VALOR ... %rent" e classifica cada ativo.
// Ativos que não casam com nenhuma classe conhecida vão para "outros".
function classifyAtivo(name, contextBefore) {
  const nUp = norm(name);
  const ctx = norm(contextBefore || "");
  // 1) Pelo nome do ativo
  for (const [key, pats] of Object.entries(CART_PATTERNS)) {
    for (const p of pats) if (p.test(nUp)) return key;
  }
  // 2) Ticker B3: XXXX11 = FII, XXXX3/4 = ações
  if (/\b[A-Z]{4}11\b/.test(nUp)) return "fiis";
  if (/\b[A-Z]{4}[34]\b/.test(nUp)) return "acoes";
  // 3) Pelo contexto nas linhas anteriores (cabeçalho "Ações", "Renda Fixa", etc.)
  if (/\bA.OES|RENDA\s+VARI.VEL|BOLSA\b/.test(ctx)) return "acoes";
  if (/\bFII\b|FUNDO\s+IMOBILI|FUNDOS\s+LISTADOS|ALTERNATIVO/.test(ctx)) return "fiis";
  if (/IPCA|INFLACAO|INFLA.{0,3}O\b|NTN.?B/.test(ctx)) return "ipca";
  if (/\bPRE.FIXAD|NTN.?F|LTN\b/.test(ctx)) return "preFixado";
  if (/POS.FIXAD|\bCDB\b|\bLCI\b|\bLCA\b|\bCDI\b|TESOURO\s+SELIC|RENDA\s+FIXA/.test(ctx)) return "posFixado";
  if (/MULTIMERCADO|HEDGE/.test(ctx)) return "multi";
  if (/\bVGBL\b/.test(ctx)) return "prevVGBL";
  if (/\bPGBL\b/.test(ctx)) return "prevPGBL";
  if (/MUTUAL\s+FUNDS?|FUNDOS?\s+(INTERNACIONAIS?|GLOBAIS?)/.test(ctx)) return "globalFunds";
  if (/EQUIT(?:IES|Y)|BDR|ADR/.test(ctx)) return "globalEquities";
  if (/TREASURY|TESOURO\s+AMERICANO|T-BILL|T-NOTE|T-BOND/.test(ctx)) return "globalTreasury";
  if (/BONDS?\b|CORPORATE\s+BONDS?/.test(ctx)) return "globalBonds";
  if (/GLOBAL|INTERNACIONAL|EXTERIOR|D.LAR|\bUSD\b|CASH\s+SALDO/.test(ctx)) return "global";
  return "outros";
}

function _parseAtivosGenerico(text) {
  const result = {};
  // Normaliza quebras e remove caracteres OCR lixo comuns.
  // Junta "Rent. mês atual\n0,28%" (label e valor em linhas separadas — OCR por coluna)
  // em uma única linha antes de processar.
  const clean = text
    .replace(/\r/g, "")
    .replace(/[«»"·¬]/g, "")
    .replace(
      /(rent(?:abilidade|\.)?\s*(?:no\s+)?m[êeé]s(?:\s+atual)?)\s*\n\s*(-?[\d,]+\s*%)/gi,
      "$1 $2"
    )
    .replace(
      /(rent(?:abilidade|\.)?\s*(?:no\s+)?ano)\s*\n\s*(-?[\d,]+\s*%)/gi,
      "$1 $2"
    );
  const rawLines = clean.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return result;

  // Regex que casa qualquer "R$ X,XX" com tolerância a artefatos OCR
  // (RS, R S, espaços extras antes do dígito)
  const VAL_RE = /R\s*[$S5]\s*([\d]{1,3}(?:\.\d{3})*,\d{2})/;
  // Labels fortes que indicam o valor do ativo
  const VALOR_LABEL_RE = /(?:saldo\s+bruto|saldo\s+atual|saldo\s+l[ií]quido|valor(?:\s+investido)?|aplicado|posi[çc][ãa]o|total\s+investido|patrim[oôó]nio|valor\s+bruto)/i;
  // Lixo que nunca pode ser nome
  const NAO_NOME_RE = /^(?:saldo|rent\.?|rentabilidade|resgate|mais\s+detalhes|comprar|vender|rendeu|nenhum|aplica[çc][ãa]o|total|vencimento|data|categoria|objetivo|classe|segmento|movimenta|dividendo|tesouro\s+direto)\b/i;
  // Cabeçalhos/seções de classe (não são ativo, mas são contexto)
  const SECAO_RE = /^(?:a[çc][õo]es?|renda\s+fixa(?:\s+[\wçãéíóú+-]+)?|fundos?\s+imobili[áa]rios?|fii[s]?|multimercado|previd[êe]ncia|vgbl|pgbl|invest[\s.]*globais?|internacional|exterior|tesouro\s+direto|bolsa|etf[s]?)\s*$/i;

  // Pré-filtra linhas válidas e marca as com R$ como "âncoras"
  const lines = rawLines.map(l => ({ t: l, hasVal: VAL_RE.test(l), isSec: SECAO_RE.test(l) }));

  const seen = new Set();
  let secaoCtx = ""; // último cabeçalho de seção encontrado

  for (let i = 0; i < lines.length; i++) {
    const { t, hasVal, isSec } = lines[i];
    if (isSec) { secaoCtx = t; continue; }
    if (!hasVal) continue;

    // Só aceita valor se estiver rotulado OU for a única linha de valor do "bloco"
    const m = t.match(VAL_RE);
    if (!m) continue;
    const valor = parseBRL(m[1]);
    if (valor < 100) continue;
    // Prefere linhas com label conhecido; se não tem label e não é valor "isolado",
    // só aceita se a linha começa com R$ (ex: "R$ 712,80")
    const hasLabel = VALOR_LABEL_RE.test(t);
    const isStandalone = /^R?\s*[$S5]?\s*[\d]{1,3}(?:\.\d{3})*,\d{2}\s*$/.test(t);
    if (!hasLabel && !isStandalone) continue;
    // Se tem label "saldo líquido" e logo antes já vimos "saldo bruto" com mesmo bloco, pula (evita duplicar)
    // Detecta isso checando se alguma linha anterior (até 4) tem label bruto/atual
    if (/saldo\s+l[ií]quido/i.test(t)) {
      let temBruto = false;
      for (let k = Math.max(0, i - 4); k < i; k++) {
        if (/saldo\s+(?:bruto|atual)/i.test(lines[k].t)) { temBruto = true; break; }
      }
      if (temBruto) continue;
    }

    // Busca o nome: percorre para trás até achar uma linha "substantiva"
    let nome = null;
    let contextoAnterior = [];
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const { t: lj, hasVal: hv, isSec: sec } = lines[j];
      contextoAnterior.push(lj);
      if (hv) continue;
      if (sec) { if (!secaoCtx) secaoCtx = lj; continue; }
      if (NAO_NOME_RE.test(lj)) continue;
      if (/^[(\d↑↓+\-*]/.test(lj)) continue;
      if (lj.length < 3 || lj.length > 120) continue;
      // linha do tipo "D+0", "%"
      if (/^\s*[\d,.-]+\s*%?\s*$/.test(lj)) continue;
      nome = lj;
      break;
    }
    if (!nome) continue;

    // Limpa sufixos "- Renda Fixa" do nome (mantém ticker se houver)
    const nomeLimpo = nome.replace(/\s+[-–]\s+(renda\s+fixa|a[çc][õo]es|fii|fundo.*|multimercado).*/i, "").trim();

    // Rentabilidade: busca "X,XX%" ou "rent. mês X,XX%" nas próximas 10 linhas
    // Inclui tolerância para OCR que separa label e valor em linhas diferentes.
    let rentMes = "";
    let rentAno = "";
    const RENT_MES_RE = /rent(?:abilidade|\.)?\s*(?:no\s+)?m[êeé]s(?:\s+atual)?\s*:?\s*(-?[\d,]+)\s*%/i;
    const RENT_ANO_RE = /rent(?:abilidade|\.)?\s*(?:no\s+)?ano\s*:?\s*(-?[\d,]+)\s*%/i;
    for (let j = i; j < Math.min(lines.length, i + 10); j++) {
      const lj = lines[j].t;
      const rm = lj.match(RENT_MES_RE);
      if (rm && !rentMes) { rentMes = rm[1].replace(",", "."); }
      else if (!rentMes && /rent(?:abilidade|\.)?\s*(?:no\s+)?m[êeé]s(?:\s+atual)?/i.test(lj)) {
        // Label sem valor na mesma linha — tenta a próxima linha
        const nextPct = lines[j + 1]?.t?.match(/^\s*(-?[\d,]+)\s*%\s*$/);
        if (nextPct) rentMes = nextPct[1].replace(",", ".");
      }
      const ra = lj.match(RENT_ANO_RE);
      if (ra && !rentAno) { rentAno = ra[1].replace(",", "."); }
      else if (!rentAno && /rent(?:abilidade|\.)?\s*(?:no\s+)?ano/i.test(lj)) {
        const nextPct = lines[j + 1]?.t?.match(/^\s*(-?[\d,]+)\s*%\s*$/);
        if (nextPct) rentAno = nextPct[1].replace(",", ".");
      }
      // "rendeu ↑ R$ X (Y,YY%)" → interpreta como rent do período
      const rd = lj.match(/rendeu.*?\(\s*(-?[\d,]+)\s*%\s*\)/i);
      if (rd && !rentMes) rentMes = rd[1].replace(",", ".");
    }

    // Busca para trás: OCR coluna-por-coluna coloca "Rent. mês atual" na coluna
    // esquerda (antes do R$ âncora). Procura entre as linhas anteriores sem R$.
    if (!rentMes) {
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const lj = lines[j].t;
        if (lines[j].hasVal) break; // encontrou outro R$ — já é outro ativo
        const rm = lj.match(RENT_MES_RE);
        if (rm) { rentMes = rm[1].replace(",", "."); break; }
        if (/rent(?:abilidade|\.)?\s*(?:no\s+)?m[êeé]s(?:\s+atual)?/i.test(lj)) {
          // label sem % — o valor está provavelmente depois do i (direita)
          for (let k = i + 1; k < Math.min(lines.length, i + 5); k++) {
            const nk = lines[k].t.match(/^\s*(-?[\d,]+)\s*%\s*$/);
            if (nk) { rentMes = nk[1].replace(",", "."); break; }
          }
          break;
        }
      }
    }
    if (!rentAno) {
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const lj = lines[j].t;
        if (lines[j].hasVal) break;
        const ra = lj.match(RENT_ANO_RE);
        if (ra) { rentAno = ra[1].replace(",", "."); break; }
      }
    }

    const dedupeKey = nomeLimpo.toUpperCase() + "|" + valor;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const classKey = classifyAtivo(nomeLimpo, contextoAnterior.join(" ") + " " + secaoCtx);
    const ativosKey = classKey + "Ativos";
    if (!result[ativosKey]) result[ativosKey] = [];
    result[ativosKey].push({
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      nome: nomeLimpo,
      valor: String(valor),
      rentMes,
      rentAno,
      vencimento: "",
      objetivo: "",
      segmento: "",
    });
  }

  // Sincroniza totais por classe (soma dos valores dos ativos)
  for (const key of Object.keys(result)) {
    if (!key.endsWith("Ativos")) continue;
    const classKey = key.replace(/Ativos$/, "");
    const tot = result[key].reduce((acc, a) => acc + parseInt(a.valor || "0"), 0);
    if (tot > 0) result[classKey] = String(tot);
  }

  return result;
}

const FLUXO_PATTERNS = {
  renda:       [/SALARIO|SAL.RIO/i,/PROL.BORE/i,/HONOR.RIOS/i,/REMUNERA/i,/DIVIDENDOS/i,/RECEITA\b/i],
  moradia:     [/ALUGUEL/i,/CONDOMINIO|CONDOM.NIO/i,/IPTU/i,/.GUA\b/i,/ENERGIA\s+EL.TRICA/i,/INTERNET\b/i],
  alimentacao: [/SUPERMERCADO/i,/ATACAD.O/i,/CARREFOUR/i,/RESTAURANTE/i,/IFOOD/i],
  educacao:    [/ESCOLA\b/i,/FACULDADE/i,/CURSO\b/i,/EDUCACAO|EDUCA.{0,4}O/i],
  lazer:       [/CINEMA/i,/VIAGEM\b/i,/HOTEL\b/i,/ENTRETENIMENTO/i,/NETFLIX/i,/SPOTIFY/i],
  assinaturas: [/ASSINATURA\b/i,/STREAMING\b/i,/MICROSOFT/i,/ICLOUD/i],
  cartoes:     [/FATURA\b/i,/CARTAO.*CREDITO|CART.O.*CR.DITO/i],
  carro:       [/COMBUSTIVEL|COMBUST.VEL/i,/GASOLINA/i,/POSTO\b/i,/IPVA/i,/PEDAGIO|PED.GIO/i],
  saude:       [/PLANO\s+DE\s+SA.DE/i,/FARMACIA|FARM.CIA/i,/HOSPITAL/i,/EXAME\b/i],
  seguros:     [/SEGURO\s+DE\s+VIDA/i,/SEGURADORA/i],
  outros:      [/OUTROS\b/i,/DIVERSOS/i],
};

function _parseFluxoGenerico(text) {
  const res = {};
  for (const [key, pats] of Object.entries(FLUXO_PATTERNS)) {
    let max = 0;
    for (const pat of pats) {
      const v = largestAmountNear(text, pat, 300);
      if (v > max) max = v;
    }
    if (max > 0) res[key] = String(max);
  }
  return res;
}

// ── API pública ────────────────────────────────────────────────

export function parseCarteiraFromText(text) {
  const tipo = detectDocType(text);
  dbg("[WealthTrack] detectDocType:", tipo);
  if (tipo === "relatorio") {
    const res = parseRelatorio(text);
    const classes = Object.keys(res).filter(k => !k.startsWith("_") && k !== "rentabilidade" && !k.endsWith("Ativos"));
    if (classes.length > 0) return res;
    dbg("[WealthTrack] Sem classes no parseRelatorio, tentando ativos individuais");
  }
  // Fallback 1: parser de ativos individuais (screenshots de app mobile)
  const ativosRes = _parseAtivosGenerico(text);
  const classesAtivos = Object.keys(ativosRes).filter(k => !k.endsWith("Ativos") && !k.startsWith("_"));
  if (classesAtivos.length > 0) {
    dbg("[WealthTrack] parseAtivosGenerico encontrou:", classesAtivos);
    return ativosRes;
  }
  // Fallback 2: parser genérico por palavras-chave
  const genericoRes = _parseCarteiraGenerico(text);
  if (Object.keys(genericoRes).length > 0) return genericoRes;
  // Fallback 3: pegou pelo menos algum R$ no texto? cria um ativo em "outros"
  const valM = text.match(/R\s*[$S5]\s*([\d]{1,3}(?:\.\d{3})*,\d{2})/);
  if (valM) {
    const valor = parseBRL(valM[1]);
    if (valor >= 100) {
      return {
        outros: String(valor),
        outrosAtivos: [{
          id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          nome: "Ativo importado (revisar nome)",
          valor: String(valor),
          rentMes: "", rentAno: "", vencimento: "", objetivo: "", segmento: "",
        }],
      };
    }
  }
  return {};
}

export function parseFluxoFromText(text) {
  const tipo = detectDocType(text);
  if (tipo === "fatura") {
    const res = parseFatura(text);
    const cats = Object.keys(res).filter(k => !k.endsWith("_items"));
    if (cats.length === 0) return _parseFluxoGenerico(text);
    return res;
  }
  return _parseFluxoGenerico(text);
}
