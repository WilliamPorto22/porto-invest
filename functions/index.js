const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk').default;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const YahooFinance = require('yahoo-finance2').default;

// yahoo-finance2 v3+ é uma classe — precisa instanciar uma vez.
const yahooFinance = new YahooFinance();
// Suprime avisos verbosos em produção.
if (yahooFinance?.suppressNotices) {
  yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
}

admin.initializeApp();

// Secret Manager — declarado via params para qualquer função que precisar
// declarar no config: { secrets: [ANTHROPIC_API_KEY] }. Em runtime,
// process.env.ANTHROPIC_API_KEY ficará disponível só nessas funções.
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
// GEMINI_API_KEY (Google AI Studio) — gratuito até 1500 req/dia.
// Usado como provedor primário pra leitura de imagem/PDF de carteira,
// já que tem free tier generoso. Anthropic permanece como fallback opcional.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// IMPORTANTE: instanciamos clientes SOB DEMANDA dentro de cada função
// (não no topo do módulo). Em Functions v2, secrets só estão disponíveis
// no escopo de execução das funções que declaram `secrets:[...]`.
function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}
function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

const MASTER_EMAIL = 'williamporto0@gmail.com';

// =========================================================================
// Helpers de autenticação/RBAC
// =========================================================================

async function getCallerRole(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado');
  }
  const uid = request.auth.uid;
  // Primeiro tenta ler o custom claim (zero-cost, vem no token).
  // Fallback: lê /users/{uid} do Firestore (comportamento legado).
  const claimRole = request.auth.token.role || null;
  let role = claimRole;
  if (!role) {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    role = snap.exists ? snap.data().role : null;
  }
  const isBootstrapMaster =
    !role && (request.auth.token.email || '').toLowerCase() === MASTER_EMAIL;
  if (isBootstrapMaster) role = 'master';
  return { uid, role, email: request.auth.token.email || null };
}

async function requireRole(request, roles) {
  const info = await getCallerRole(request);
  if (!roles.includes(info.role)) {
    throw new HttpsError('permission-denied', 'Permissão insuficiente');
  }
  return info;
}

// Define/atualiza o custom claim `role` no token de autenticação do usuário.
// Mantém os demais claims intactos. O token só reflete a mudança após o
// usuário fazer novo login OU forçar refresh via `auth.currentUser.getIdToken(true)`.
async function setRoleClaim(uid, role) {
  try {
    const user = await admin.auth().getUser(uid);
    const existing = user.customClaims || {};
    await admin.auth().setCustomUserClaims(uid, { ...existing, role });
  } catch (e) {
    // Não-fatal: se falhar, o sistema continua funcionando via fallback Firestore.
    console.warn(`[setRoleClaim] falha ao setar role=${role} em uid=${uid}:`, e.message);
  }
}

function randomPassword(len = 14) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// =========================================================================
// processarUploadCarteira
//
// Analisa PDF ou imagem de relatório de investimentos (XP e similares) e
// devolve um JSON com TODOS os dados que a UI precisa para:
//   1. Preencher a carteira do mês
//   2. Calcular rentabilidade dos últimos 12 meses (composta)
//   3. Popular acompanhamento mensal dos objetivos
//   4. Registrar movimentações detalhadas no extrato (compra/venda/dividendo/juros)
//   5. Fazer diff com snapshot anterior (via lista de ativos com id estável)
//
// Prompt cache: o bloco de instruções (text) é fixo — marca com cache_control
// para reduzir custo em 90% nos uploads subsequentes.
// =========================================================================

function buildPromptCarteira(cotacaoDolar) {
  const taxaInfo = cotacaoDolar
    ? `\n\nCOTAÇÃO DO DÓLAR FORNECIDA: US$ 1 = R$ ${cotacaoDolar.toFixed(4)}\n\nSE O DOCUMENTO ESTIVER EM USD (dólares):\n- Multiplique cada valor em USD pela cotação acima e retorne TUDO EM REAIS (BRL).\n- Cada ativo individual também deve ser convertido (valor em R$).\n- O patrimonioTotal deve ser o valor total em USD × cotacao.\n- Mapeie as classes internacionais com GRANULARIDADE (não joga tudo em "global"):\n  * Equities / Renda Variável (ações como VOO, AAPL, DE, etc.) → globalEquities\n  * Treasury / Tesouro Americano (T-Bills, T-Notes, T-Bonds) → globalTreasury\n  * Mutual Funds / Fundos (PIMCO, JP Morgan, Morgan Stanley etc.) → globalFunds\n  * Bonds / Renda Fixa Internacional (corporate bonds, sovereign bonds) → globalBonds\n  * Cash / Saldo / Dinheiro disponível → global\n  * Structured Notes / Certificate of Deposit / outros → global\n- O nome do ativo deve preservar o ticker (ex.: "VOO", "PIMXZ") + descrição quando houver (ex.: "VOO – Vanguard S&P 500 ETF").\n- Para ativos globais, popule rentMes com a coluna "Rent. %" do extrato (rentabilidade desde compra, em %).`
    : "";

  return `Você é um extrator especialista em relatórios de investimentos brasileiros (XP Investimentos, BTG, Itaú, Inter, NuInvest etc.).\n\nAnalise o documento e retorne UM JSON ÚNICO no formato abaixo. Nunca invente valores — se um campo não existir no documento, use null (ou 0 para somatórios).${taxaInfo}

FONTE PRIORITÁRIA DOS PERCENTUAIS (XP):
  A página 2 tem uma tabela "Referências (%)" com a linha "Portfólio":
     Portfólio  Mês%  Ano%  12M%  24M%
  Use EXATAMENTE esses valores para rentMes, rentAno, rent12m.
  NÃO calcule composto — leia direto da linha Portfólio.
  O ganho em R$ dos períodos vem na tabela "Resumo de Informações da Carteira":
     MÊS  R$ xxx  ...   ANO  R$ xxx  ...   12M  R$ xxx  ...
  Use o valor em R$ correspondente para ganhoMes/ganhoAno/ganho12m.

{
  "dataReferencia": "YYYY-MM-DD",              // data de referência impressa no topo (1ª página)
  "mesReferencia": "YYYY-MM",                  // mês/ano derivado da dataReferencia
  "patrimonioTotal": <reais com 2 casas>,       // patrimônio total bruto
  "rentMes": <percentual número>,               // rentabilidade do mês (coluna Mês linha Portfólio da tabela Referências)
  "rentAno": <percentual número>,               // rentabilidade acumulada no ano (coluna Ano linha Portfólio)
  "rent12m": <percentual número>,               // rentabilidade 12 meses (coluna 12M linha Portfólio) — NÃO calcule, leia
  "ganhoMes": <reais>,                          // ganho R$ do mês (tabela Resumo)
  "ganhoAno": <reais>,                          // ganho R$ no ano (tabela Resumo)
  "ganho12m": <reais>,                          // ganho R$ em 12 meses (tabela Resumo)
  "classes": {
    "posFixado":       <total reais>,
    "preFixado":       <total reais>,
    "ipca":            <total reais>,
    "acoes":           <total reais>,
    "fiis":            <total reais>,
    "multi":           <total reais>,
    "prevVGBL":        <total reais>,
    "prevPGBL":        <total reais>,
    "globalEquities":  <total reais>,
    "globalTreasury":  <total reais>,
    "globalFunds":     <total reais>,
    "globalBonds":     <total reais>,
    "global":          <total reais>
  },
  "ativos": [                                    // lista de ativos individuais detectados
    {
      "nome": "CDB BANCO XYZ MAI/2028",
      "classe": "posFixado",                    // deve bater com uma das chaves de "classes"
      "valor": <reais>,
      "rentMes": <percentual número ou null>,
      "rentAno": <percentual número ou null>,
      "vencimento": "MAI/2028"                  // opcional — mês/ano
    }
  ],
  "tabelaRentMensal": {                          // matriz para cálculo de rent 12m composto
    "2026": [2.82, 2.37, -0.68, 2.42, null, null, null, null, null, null, null, null],
    "2025": [1.56, 1.32, 3.68, 3.02, 1.64, 1.34, -0.50, 4.21, 3.03, 1.73, 2.88, 1.90]
  },
  "movimentacoes": [                             // linhas da tabela "Movimentações da Conta"
    {
      "data": "YYYY-MM-DD",                     // data da liquidação/operação
      "tipo": "compra|venda|aporte|retirada|dividendo|rendimento|juros|amortizacao|taxa",
      "descricao": "texto bruto da linha",
      "ativo": "nome/ticker do ativo (ex.: XPAG11, BBDC3, CRA FS FLORESTAL)",
      "valor": <reais positivo — o sinal vem do tipo>
    }
  ],
  // IGNORE SEMPRE no array movimentacoes:
  //   - "APLICAÇÃO COMPROMISSADA XXX"    (tesouraria interna overnight)
  //   - "RECOMPRA COMPROMISSADA XXX"     (contrapartida da aplicação)
  //   - "IRRF RECOMPRA COMPROMISSADA"    (IR da tesouraria — valor ínfimo, ruído)
  //   - "Investback" (contra-entrada do TED do cashback — não é aporte)
  // RELEVANTES (mapeie sempre):
  //   - "RENDIMENTO FUNDO FECHADO BALCÃO <TICKER>" → tipo=rendimento, ativo=ticker
  //   - "RENDIMENTOS DE CLIENTES <TICKER> S/ <qtd>" → tipo=rendimento, ativo=ticker
  //   - "Pgto Juros <CÓDIGO> | <NOME>" → tipo=juros, ativo=nome
  //   - "Pgto Amortização <CÓDIGO> | <NOME>" → tipo=amortizacao, ativo=nome
  //   - "DIVIDENDOS DE CLIENTES <TICKER> S/ <qtd>" → tipo=dividendo, ativo=ticker
  //   - "JUROS S/ CAPITAL DE CLIENTES <TICKER> S/ <qtd>" → tipo=dividendo, ativo=ticker
  //   - "TED ... TED APLICAÇÃO FUNDOS" → tipo=aporte (dinheiro vindo DE FORA)
  //   - "TED ... RESGATE" → tipo=retirada
  // NUNCA confunda a coluna "S/ <quantidade>" (ex.: "S/ 5,030") com o valor em R$.
  // O valor financeiro SEMPRE vem precedido de "R$".
  //
  // 🚨 REGRAS CRÍTICAS PARA tipo="aporte" (siga à risca — erros aqui quebram o sistema):
  //   1. APORTE é EXCLUSIVAMENTE dinheiro NOVO entrando na conta do cliente vindo
  //      de FORA da corretora (TED/PIX/DOC de uma conta bancária externa).
  //   2. NÃO é aporte: COMPRA de ativo, RECOMPRA, VENDA, SUBSCRIÇÃO, EXERCÍCIO,
  //      conversão, desdobramento, bonificação, amortização, juros, dividendo,
  //      rebalanceamento interno entre fundos, migração de custódia.
  //   3. NÃO é aporte: a linha "TOTAL", "PATRIMÔNIO LÍQUIDO", "POSIÇÃO CONSOLIDADA",
  //      "SALDO", "DISPONÍVEL", "MARGEM" — esses valores NUNCA entram como movimentação.
  //   4. Se não houver uma linha de TED/PIX explícita vindo de fora, retorne
  //      "resumoMes.aportes": 0 e NÃO inclua nenhum item com tipo="aporte"
  //      no array movimentacoes. É MUITO MELHOR reportar 0 aportes do que
  //      classificar erroneamente uma compra como aporte.
  //   5. Valor de um aporte individual quase nunca ultrapassa 50% do patrimonioTotal.
  //      Se encontrar um candidato a aporte >= 50% do patrimonioTotal, verifique DUAS VEZES
  //      que a descrição começa literalmente com "TED" ou "PIX" — caso contrário, NÃO
  //      classifique como aporte.
  "resumoMes": {                                 // somatórios do mês de referência
    "aportes": <reais>,
    "retiradas": <reais>,                       // resgates, transferências enviadas
    "dividendos": <reais>,                      // dividendos + JCP
    "juros": <reais>,                           // juros de renda fixa, cupons
    "amortizacao": <reais>,
    "taxas": <reais>
  }
}

REGRAS DE CLASSIFICAÇÃO:
- posFixado: CDB, LCI, LCA, LCD, LFT, Tesouro Selic, pós-fixados %CDI
- ipca: Tesouro IPCA+, debêntures IPCA+, NTN-B, qualquer "IPCA +"
- preFixado: Tesouro Prefixado, CDB prefixado, NTN-F, LTN
- acoes: ações B3 (PETR4, VALE3...), ETFs de renda variável nacional
- fiis: Fundos Imobiliários (tickers terminados em 11), papéis imobiliários
- multi: Fundos multimercado, hedge funds, long-short
- prevVGBL / prevPGBL: planos de previdência (pelo nome do plano)
- globalEquities: ações internacionais e ETFs de ação (VOO, AAPL, MSFT, DE, BDRs, ADRs)
- globalTreasury: títulos do tesouro americano (T-Bills, T-Notes, T-Bonds)
- globalFunds: fundos mútuos internacionais (PIMCO, JP Morgan, Morgan Stanley, Goldman, etc.)
- globalBonds: renda fixa corporativa internacional (corporate bonds, high yield bonds)
- global: outros ativos internacionais não classificáveis acima (cash em USD, structured notes, CDs em USD, fundos cambiais brasileiros)

Responda APENAS com o JSON. Não inclua \`\`\`json, explicação ou qualquer texto fora do objeto.`;
}

// ── Helpers de leitura de JSON do output da IA ─────────────────────────
function extrairJSON(texto) {
  const limpo = String(texto || '').replace(/```json|```/g, '').trim();
  const first = limpo.indexOf('{');
  const last = limpo.lastIndexOf('}');
  const core = first >= 0 && last > first ? limpo.slice(first, last + 1) : limpo;
  return JSON.parse(core);
}

// ── Provedor 1: Gemini (gratuito, primário) ────────────────────────────
async function lerCarteiraComGemini(prompt, base64, fileType) {
  const ai = getGeminiClient();
  if (!ai) throw new Error('GEMINI_API_KEY não configurada');
  // Gemini 2.0 Flash: free tier 15 RPM / 1500 RPD, suporta imagem e PDF.
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: fileType, data: base64 } },
  ]);
  const texto = result.response.text();
  return { extraido: extrairJSON(texto), provedor: 'gemini-2.0-flash' };
}

// ── Provedor 2: Anthropic (pago, fallback) ─────────────────────────────
async function lerCarteiraComAnthropic(prompt, base64, fileType, isPDF) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const message = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: isPDF ? 'document' : 'image', source: { type: 'base64', media_type: fileType, data: base64 } },
        { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
      ],
    }],
  });
  const texto = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return {
    extraido: extrairJSON(texto),
    provedor: 'claude-sonnet-4-5',
    cache: {
      created: message.usage?.cache_creation_input_tokens || 0,
      read: message.usage?.cache_read_input_tokens || 0,
    },
  };
}

exports.processarUploadCarteira = onCall(
  { region: 'southamerica-east1', timeoutSeconds: 120, secrets: [ANTHROPIC_API_KEY, GEMINI_API_KEY] },
  async (request) => {
  const info = await getCallerRole(request);

  const { base64, fileType, clienteId, cotacaoDolar } = request.data;

  if (!base64 || !fileType || !clienteId) {
    throw new HttpsError(
      'invalid-argument',
      'Parâmetros inválidos: base64, fileType e clienteId são obrigatórios'
    );
  }

  // RBAC: master vê tudo · assessor só seus próprios · cliente só o próprio doc.
  // Mesma lógica do lerCliente — não restrito ao master.
  const cliSnap = await admin.firestore().doc(`clientes/${clienteId}`).get();
  if (!cliSnap.exists) {
    throw new HttpsError('not-found', 'Cliente não encontrado');
  }
  const cliData = cliSnap.data() || {};
  const isMaster       = info.role === 'master';
  const isAssessorDono = info.role === 'assessor' && (cliData.advisorId === info.uid || cliData.assessorId === info.uid);
  const isClienteDono  = info.role === 'cliente'  && cliData.userId === info.uid;
  if (!isMaster && !isAssessorDono && !isClienteDono) {
    throw new HttpsError('permission-denied', 'Sem permissão para processar a carteira desse cliente');
  }

  try {
    const isPDF = fileType === 'application/pdf';
    const isImage = fileType.startsWith('image/');

    if (!isPDF && !isImage) {
      throw new Error('Tipo de arquivo não suportado. Use PDF ou imagem.');
    }

    const prompt = buildPromptCarteira(cotacaoDolar ? Number(cotacaoDolar) : null);

    // ── Estratégia: Gemini primeiro (gratuito), Anthropic como fallback ──
    // Cada cliente tem ativos/quantidades diferentes — a IA é chamada
    // sob demanda pra cada upload, então sempre extrai dados específicos
    // do documento enviado.
    let resultado = null;
    const erros = [];

    if (process.env.GEMINI_API_KEY) {
      try {
        resultado = await lerCarteiraComGemini(prompt, base64, fileType);
      } catch (e) {
        console.warn('[processarUpload] Gemini falhou:', e?.message);
        erros.push('Gemini: ' + (e?.message || 'erro'));
      }
    }
    if (!resultado && process.env.ANTHROPIC_API_KEY) {
      try {
        resultado = await lerCarteiraComAnthropic(prompt, base64, fileType, isPDF);
      } catch (e) {
        console.warn('[processarUpload] Anthropic falhou:', e?.message);
        erros.push('Anthropic: ' + (e?.message || 'erro'));
      }
    }
    if (!resultado) {
      throw new HttpsError(
        'failed-precondition',
        erros.length
          ? 'Nenhum provedor de IA disponível. Detalhes: ' + erros.join(' | ')
          : 'Nenhum provedor de IA configurado. Configure GEMINI_API_KEY (gratuito) ou ANTHROPIC_API_KEY no Secret Manager.'
      );
    }

    const extraido = resultado.extraido;

    // Heurística: PDF protegido por senha / scan ilegível / página em branco
    // chega aqui como JSON com tudo zerado/null.
    const semPatrimonio = !extraido?.patrimonioTotal || Number(extraido.patrimonioTotal) === 0;
    const semClasses = !extraido?.classes || Object.values(extraido.classes || {}).every((v) => !v);
    const semAtivos = !Array.isArray(extraido?.ativos) || extraido.ativos.length === 0;
    if (semPatrimonio && semClasses && semAtivos) {
      throw new HttpsError(
        'invalid-argument',
        'Não foi possível ler dados do arquivo. Possíveis causas: PDF protegido por senha, ' +
        'scan de baixa qualidade, ou documento sem dados de investimentos. ' +
        'Tente exportar o relatório novamente sem senha ou enviar uma imagem mais nítida.'
      );
    }

    return {
      success: true,
      dados: extraido,
      provedor: resultado.provedor,
      timestamp: new Date().toISOString(),
      cache: resultado.cache || null,
    };
  } catch (error) {
    console.error('Erro ao processar upload:', error);
    throw new HttpsError('internal', 'Erro ao processar arquivo: ' + error.message);
  }
});

// =========================================================================
// salvarSnapshotECliente
// Salva snapshot mensal da carteira E patch do doc do cliente em UMA chamada,
// via Admin SDK. Usado como fallback quando o write direto via Firestore
// rules falha (ex.: master sem custom claim, assessor com cliente sem
// advisorId definido). Auth check usa a mesma lógica do processarUploadCarteira.
// Importante: NÃO permite trocar advisorId/userId via patch (preserva vínculo).
// =========================================================================
exports.salvarSnapshotECliente = onCall(
  { region: 'southamerica-east1', timeoutSeconds: 30 },
  async (request) => {
    const info = await getCallerRole(request);
    const { clienteId, mesRef, snapshotPayload, clientePatch, opcoes } = request.data || {};

    if (!clienteId || !mesRef || !snapshotPayload || !clientePatch) {
      throw new HttpsError('invalid-argument',
        'Parâmetros obrigatórios: clienteId, mesRef, snapshotPayload, clientePatch');
    }
    if (!/^\d{4}-\d{2}$/.test(mesRef)) {
      throw new HttpsError('invalid-argument', 'mesRef deve estar no formato YYYY-MM');
    }

    // Auth check — mesma lógica do processarUploadCarteira:
    // master vê tudo; assessor só os próprios; cliente só o próprio doc.
    const cliRef = admin.firestore().doc(`clientes/${clienteId}`);
    const cliSnap = await cliRef.get();
    if (!cliSnap.exists) {
      throw new HttpsError('not-found', 'Cliente não encontrado');
    }
    const cliData = cliSnap.data() || {};
    const isMaster       = info.role === 'master';
    const isAssessorDono = info.role === 'assessor' && (cliData.advisorId === info.uid || cliData.assessorId === info.uid);
    const isClienteDono  = info.role === 'cliente'  && cliData.userId === info.uid;
    if (!isMaster && !isAssessorDono && !isClienteDono) {
      throw new HttpsError('permission-denied', 'Sem permissão para salvar este cliente');
    }

    // Sanitização defensiva: cliente NUNCA pode trocar advisorId/userId.
    // Mesmo se mandar no patch, removemos antes de gravar.
    const safePatch = { ...clientePatch };
    delete safePatch.advisorId;
    delete safePatch.userId;
    delete safePatch.assessorId; // legado — também protegemos
    delete safePatch.role;
    delete safePatch.createdAt;
    delete safePatch.createdBy;

    try {
      // 1) Salva snapshot mensal (subcollection)
      const snapRef = admin.firestore().doc(`clientes/${clienteId}/snapshotsCarteira/${mesRef}`);
      const existingSnap = await snapRef.get();
      const agora = new Date().toISOString();
      const snapshotFinal = {
        mesRef,
        ...snapshotPayload,
        atualizadoEm: agora,
        ...(existingSnap.exists ? {} : { criadoEm: agora }),
        ...(opcoes?.fonte ? { fonte: opcoes.fonte } : {}),
        ...(opcoes?.arquivoNome ? { arquivoNome: opcoes.arquivoNome } : {}),
      };
      await snapRef.set(snapshotFinal, { merge: true });

      // 2) Atualiza doc do cliente (top-level) com merge
      safePatch.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();
      await cliRef.set(safePatch, { merge: true });

      return {
        success: true,
        clienteId,
        mesRef,
        timestamp: agora,
        viaFunction: true,
      };
    } catch (err) {
      console.error('[salvarSnapshotECliente] erro ao gravar:', err);
      throw new HttpsError('internal', 'Erro ao salvar: ' + err.message);
    }
  }
);

// =========================================================================
// salvarFluxoMensal
// Salva snapshot mensal de fluxo de gastos E patch do doc do cliente.
// Mesmo padrão da salvarSnapshotECliente — fallback quando rules direto falham.
// =========================================================================
exports.salvarFluxoMensal = onCall(
  { region: 'southamerica-east1', timeoutSeconds: 30 },
  async (request) => {
    const info = await getCallerRole(request);
    const { clienteId, mesRef, fluxoSnapshot, clientePatch } = request.data || {};

    if (!clienteId || !mesRef || !fluxoSnapshot || !clientePatch) {
      throw new HttpsError('invalid-argument',
        'Parâmetros obrigatórios: clienteId, mesRef, fluxoSnapshot, clientePatch');
    }
    if (!/^\d{4}-\d{2}$/.test(mesRef)) {
      throw new HttpsError('invalid-argument', 'mesRef deve estar no formato YYYY-MM');
    }

    const cliRef = admin.firestore().doc(`clientes/${clienteId}`);
    const cliSnap = await cliRef.get();
    if (!cliSnap.exists) {
      throw new HttpsError('not-found', 'Cliente não encontrado');
    }
    const cliData = cliSnap.data() || {};
    const isMaster       = info.role === 'master';
    const isAssessorDono = info.role === 'assessor' && (cliData.advisorId === info.uid || cliData.assessorId === info.uid);
    const isClienteDono  = info.role === 'cliente'  && cliData.userId === info.uid;
    if (!isMaster && !isAssessorDono && !isClienteDono) {
      throw new HttpsError('permission-denied', 'Sem permissão para salvar este cliente');
    }

    const safePatch = { ...clientePatch };
    delete safePatch.advisorId;
    delete safePatch.userId;
    delete safePatch.assessorId;
    delete safePatch.role;
    delete safePatch.createdAt;
    delete safePatch.createdBy;

    try {
      // Snapshot fluxo
      await admin.firestore()
        .doc(`clientes/${clienteId}/snapshotsFluxo/${mesRef}`)
        .set({ ...fluxoSnapshot, mesRef, atualizadoEm: new Date().toISOString() }, { merge: true });
      // Doc cliente
      safePatch.atualizadoEm = admin.firestore.FieldValue.serverTimestamp();
      await cliRef.set(safePatch, { merge: true });
      return { success: true, viaFunction: true };
    } catch (err) {
      console.error('[salvarFluxoMensal] erro:', err);
      throw new HttpsError('internal', 'Erro ao salvar fluxo: ' + err.message);
    }
  }
);

// =========================================================================
// criarAssessor — master only
// =========================================================================
exports.criarAssessor = onCall({ region: 'southamerica-east1' }, async (request) => {
  const caller = await requireRole(request, ['master']);
  const email = (request.data?.email || '').trim().toLowerCase();
  const nome = (request.data?.nome || '').trim();

  if (!email || !nome) {
    throw new HttpsError('invalid-argument', 'Nome e email são obrigatórios');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email inválido');
  }

  const senhaTemp = randomPassword();

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password: senhaTemp,
      displayName: nome,
      emailVerified: false,
    });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Email já cadastrado no Auth');
    }
    throw new HttpsError('internal', 'Erro ao criar Auth: ' + e.message);
  }

  await admin.firestore().doc(`users/${userRecord.uid}`).set({
    nome,
    email,
    role: 'assessor',
    active: true,
    mustResetPassword: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: caller.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Custom claim no token: evita 1 leitura Firestore por request em toda sessão futura.
  await setRoleClaim(userRecord.uid, 'assessor');

  let resetLink = null;
  try {
    resetLink = await admin.auth().generatePasswordResetLink(email);
  } catch (e) {
    console.warn('Falha ao gerar link de reset:', e.message);
  }

  return {
    success: true,
    uid: userRecord.uid,
    senhaInicial: senhaTemp,
    resetLink,
    aviso:
      'Assessor criado. Repasse a senha temporária OU o link de reset — no primeiro login ele será forçado a trocar a senha.',
  };
});

// =========================================================================
// Helper de normalização e checagem de duplicata por email/CPF.
// Motivo: um assessor criou um cliente e a UI gerou doc duplicado; clicando
// no "excluir" do duplicado, o Auth compartilhado sumia e o assessor perdia
// acesso. Duplicata tem que ser bloqueada no cadastro, não detectada depois.
// =========================================================================
function normalizarCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

async function localizarClienteDuplicado({ email, cpfNorm, excluirId }) {
  const col = admin.firestore().collection('clientes');
  if (email) {
    const snap = await col.where('email', '==', email).limit(5).get();
    for (const d of snap.docs) {
      if (d.id !== excluirId) return { id: d.id, campo: 'email', valor: email, data: d.data() };
    }
  }
  if (cpfNorm) {
    const snap = await col.where('cpfNorm', '==', cpfNorm).limit(5).get();
    for (const d of snap.docs) {
      if (d.id !== excluirId) return { id: d.id, campo: 'CPF', valor: cpfNorm, data: d.data() };
    }
  }
  return null;
}

// =========================================================================
// verificarDuplicataCliente — callable leve usada pelo form antes do salvar.
// Retorna { duplicado: bool, campo, nomeExistente, advisorIdExistente }.
// Assessores podem chamar; a query ignora as rules porque roda com admin SDK.
// =========================================================================
exports.verificarDuplicataCliente = onCall({ region: 'southamerica-east1' }, async (request) => {
  await requireRole(request, ['master', 'assessor']);
  const email = (request.data?.email || '').trim().toLowerCase();
  const cpfNorm = normalizarCpf(request.data?.cpf);
  const excluirId = (request.data?.excluirId || '').trim() || null;
  if (!email && !cpfNorm) return { duplicado: false };
  const dup = await localizarClienteDuplicado({ email, cpfNorm, excluirId });
  if (!dup) return { duplicado: false };
  return {
    duplicado: true,
    campo: dup.campo,
    valor: dup.valor,
    nomeExistente: dup.data?.nome || null,
    advisorIdExistente: dup.data?.advisorId || dup.data?.assessorId || null,
    clienteIdExistente: dup.id,
  };
});

// =========================================================================
// criarCliente — master ou assessor
// =========================================================================
exports.criarCliente = onCall({ region: 'southamerica-east1' }, async (request) => {
  const caller = await requireRole(request, ['master', 'assessor']);
  const email = (request.data?.email || '').trim().toLowerCase();
  const nome = (request.data?.nome || '').trim();
  const dadosCliente = request.data?.dadosCliente || {};
  const advisorIdExplicito = request.data?.advisorId || null;

  if (!email || !nome) {
    throw new HttpsError('invalid-argument', 'Nome e email são obrigatórios');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email inválido');
  }

  const cpfNorm = normalizarCpf(dadosCliente.cpf);
  if (cpfNorm && cpfNorm.length !== 11) {
    throw new HttpsError('invalid-argument', 'CPF deve ter 11 dígitos.');
  }

  const dup = await localizarClienteDuplicado({ email, cpfNorm });
  if (dup) {
    throw new HttpsError(
      'already-exists',
      `Este cliente já tem uma conta cadastrada (${dup.campo}${dup.data?.nome ? `: ${dup.data.nome}` : ''}). Fale com o administrador do site.`
    );
  }

  const advisorId =
    caller.role === 'master' && advisorIdExplicito ? advisorIdExplicito : caller.uid;

  const senhaTemp = 'PortoInvest$$';

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password: senhaTemp,
      displayName: nome,
      emailVerified: false,
    });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists',
        'Este email já tem uma conta cadastrada. Fale com o administrador do site.');
    }
    throw new HttpsError('internal', 'Erro ao criar Auth: ' + e.message);
  }

  const batch = admin.firestore().batch();
  const userRef = admin.firestore().doc(`users/${userRecord.uid}`);
  const clienteRef = admin.firestore().collection('clientes').doc();

  batch.set(userRef, {
    nome,
    email,
    role: 'cliente',
    active: true,
    advisorId,
    clienteId: clienteRef.id,
    // Cliente recém-criado pelo cadastro recebe a senha padrão
    // (PortoInvest$$) e PRECISA trocar no primeiro login.
    // Sem esta flag o Login.jsx não redirecionava pro /reset-password
    // e o cliente seguia logando com a senha padrão indefinidamente.
    mustResetPassword: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: caller.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.set(clienteRef, {
    ...dadosCliente,
    nome,
    email,
    cpfNorm: cpfNorm || null,
    userId: userRecord.uid,
    advisorId,
    assessorId: advisorId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: caller.uid,
  });

  await batch.commit();

  // Custom claim role=cliente — sem isso o token do novo cliente entra nas
  // rules sem role e cai no fallback /users/{uid}. Funciona, mas é mais lento
  // (extra read em cada write) e diverge de criarAssessor/criarLoginParaCliente
  // que já chamam setRoleClaim. Mantém a paridade entre todos os fluxos de criação.
  await setRoleClaim(userRecord.uid, 'cliente');

  let resetLink = null;
  try {
    resetLink = await admin.auth().generatePasswordResetLink(email);
  } catch (e) {
    console.warn('Falha ao gerar link de reset:', e.message);
  }

  return {
    success: true,
    uid: userRecord.uid,
    clienteId: clienteRef.id,
    advisorId,
    resetLink,
  };
});

// =========================================================================
// excluirUsuario — master only. Exige confirmação explícita por nome OU email
// para evitar deleção acidental por clique errado na UI.
// =========================================================================
exports.excluirUsuario = onCall({ region: 'southamerica-east1' }, async (request) => {
  const caller = await requireRole(request, ['master']);
  const uid = (request.data?.uid || '').trim();
  const confirmacao = (request.data?.confirmacao || '').trim().toLowerCase();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'UID é obrigatório');
  }
  if (uid === caller.uid) {
    throw new HttpsError('permission-denied', 'Você não pode excluir a própria conta master.');
  }
  const alvoSnap = await admin.firestore().doc(`users/${uid}`).get();
  if (!alvoSnap.exists) {
    throw new HttpsError('not-found', 'Usuário não encontrado');
  }
  const alvo = alvoSnap.data();
  if (alvo.role === 'master') {
    throw new HttpsError('permission-denied', 'Não é permitido excluir outro master por esta rota.');
  }
  const nomeNorm = (alvo.nome || '').trim().toLowerCase();
  const emailNorm = (alvo.email || '').trim().toLowerCase();
  if (!confirmacao || (confirmacao !== nomeNorm && confirmacao !== emailNorm)) {
    throw new HttpsError('failed-precondition',
      'Confirmação não confere. Digite o nome ou email exato do usuário para excluir.');
  }
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    console.warn('Auth user já removido ou não encontrado:', e.message);
  }
  await admin.firestore().doc(`users/${uid}`).delete();
  return { success: true, nome: alvo.nome, email: alvo.email, role: alvo.role };
});

// =========================================================================
// excluirCliente — exclui cliente completo (doc + /users + Auth)
// Permite master ou o assessor dono do cliente.
// =========================================================================
exports.excluirCliente = onCall({ region: 'southamerica-east1' }, async (request) => {
  const caller = await requireRole(request, ['master', 'assessor']);
  const clienteId = (request.data?.clienteId || '').trim();
  if (!clienteId) {
    throw new HttpsError('invalid-argument', 'clienteId é obrigatório');
  }

  const cliRef = admin.firestore().doc(`clientes/${clienteId}`);
  const cliSnap = await cliRef.get();
  if (!cliSnap.exists) {
    throw new HttpsError('not-found', 'Cliente não encontrado');
  }
  const cli = cliSnap.data();

  if (caller.role === 'assessor') {
    const dono = cli.advisorId === caller.uid || cli.assessorId === caller.uid;
    if (!dono) {
      throw new HttpsError('permission-denied', 'Este cliente não está vinculado a você');
    }
  }

  // CRÍTICO: recusa apagar um cliente cujo userId == uid do próprio assessor
  // (acontecia se um cliente foi cadastrado com o mesmo email do assessor).
  // Antes: apagar esse doc derrubava o login do assessor por arrasto.
  if (cli.userId && cli.userId === caller.uid && caller.role !== 'master') {
    throw new HttpsError('failed-precondition',
      'Este cliente está vinculado à sua própria conta de login. Não posso apagar ' +
      'sem risco de derrubar seu acesso. Fale com o administrador do site para ' +
      'desvincular antes.');
  }
  if (cli.email && caller.email &&
      String(cli.email).trim().toLowerCase() === String(caller.email).trim().toLowerCase() &&
      caller.role !== 'master') {
    throw new HttpsError('failed-precondition',
      'Este cliente tem o mesmo email da sua conta de assessor. Apagar por aqui ' +
      'pode derrubar seu login. Peça ao administrador para corrigir o email antes.');
  }

  const userId = cli.userId || null;
  const email = (cli.email || '').trim().toLowerCase();

  // CRÍTICO: só apaga Auth+users se o doc em /users confirmar que é role 'cliente'.
  // Antes deste guard, um cliente com mesmo email de um assessor apagava o assessor.
  async function apagarAuthSeForCliente(uidAlvo) {
    if (!uidAlvo) return;
    try {
      const userDoc = await admin.firestore().doc(`users/${uidAlvo}`).get();
      if (userDoc.exists) {
        const role = userDoc.data().role;
        if (role && role !== 'cliente') {
          console.warn(`Proteção: ${uidAlvo} tem role "${role}" — não deletando Auth/users nesta operação.`);
          return;
        }
      }
      try { await admin.auth().deleteUser(uidAlvo); }
      catch (e) { console.warn('Auth já removido:', e.message); }
      try { await admin.firestore().doc(`users/${uidAlvo}`).delete(); }
      catch (e) { console.warn('/users já removido:', e.message); }
    } catch (e) {
      console.warn('Falha ao verificar role antes de apagar Auth:', e.message);
    }
  }

  if (userId) {
    await apagarAuthSeForCliente(userId);
  } else if (email) {
    try {
      const u = await admin.auth().getUserByEmail(email);
      if (u?.uid) await apagarAuthSeForCliente(u.uid);
    } catch (_) { /* sem Auth para esse email — tudo bem */ }
  }

  await cliRef.delete();
  return { success: true };
});

// =========================================================================
// deduplicarClientes — master only. Scan de toda a coleção `clientes` e, para
// cada grupo de duplicatas por email ou CPF, mantém 1 doc (o que parece mais
// "completo" — tem userId, createdAt antigo, carteira preenchida) e apaga o
// resto. Só apaga Auth/users do descartado se o /users for role 'cliente'
// (mesmo guard do excluirCliente).
// =========================================================================
exports.deduplicarClientes = onCall({ region: 'southamerica-east1' }, async (request) => {
  await requireRole(request, ['master']);
  const dryRun = !!request.data?.dryRun;

  const snap = await admin.firestore().collection('clientes').get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));

  // Agrupa por email e por cpfNorm
  const grupos = {};
  for (const d of docs) {
    const email = (d.data.email || '').trim().toLowerCase();
    const cpf = normalizarCpf(d.data.cpf || d.data.cpfNorm);
    if (email) {
      const k = `email:${email}`;
      (grupos[k] = grupos[k] || []).push(d);
    }
    if (cpf) {
      const k = `cpf:${cpf}`;
      (grupos[k] = grupos[k] || []).push(d);
    }
  }

  const score = (d) => {
    let s = 0;
    if (d.data.userId) s += 1_000_000;
    if (d.data.createdAt) s += 100_000;
    if (d.data.carteira && Object.keys(d.data.carteira).length > 0) s += 50_000;
    if (d.data.patrimonio) s += 10_000;
    s += Object.keys(d.data).length * 10;
    // empate: id mais antigo (ordem lexical estável)
    return s;
  };

  const jaProcessados = new Set();
  const removidos = [];
  const mantidos = [];
  const grupoDetectados = [];

  for (const [k, grupo] of Object.entries(grupos)) {
    const unicos = [...new Map(grupo.map((d) => [d.id, d])).values()];
    if (unicos.length < 2) continue;
    const restantes = unicos.filter((d) => !jaProcessados.has(d.id));
    if (restantes.length < 2) continue;

    restantes.sort((a, b) => {
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });
    const [keep, ...toRemove] = restantes;
    jaProcessados.add(keep.id);
    mantidos.push({
      id: keep.id,
      nome: keep.data.nome || null,
      email: keep.data.email || null,
      chave: k,
    });
    grupoDetectados.push({
      chave: k,
      mantido: keep.id,
      descartados: toRemove.map((r) => r.id),
    });

    for (const r of toRemove) {
      if (jaProcessados.has(r.id)) continue;
      jaProcessados.add(r.id);
      removidos.push({
        id: r.id,
        nome: r.data.nome || null,
        email: r.data.email || null,
        chave: k,
      });

      if (dryRun) continue;

      const userId = r.data.userId || null;
      if (userId) {
        try {
          const uDoc = await admin.firestore().doc(`users/${userId}`).get();
          const role = uDoc.exists ? uDoc.data().role : null;
          if (role === 'cliente') {
            try { await admin.auth().deleteUser(userId); } catch (e) {
              console.warn('Auth já removido:', e.message);
            }
            try { await admin.firestore().doc(`users/${userId}`).delete(); } catch (_) {}
          } else if (role) {
            console.warn(`Preservando Auth/users de ${userId} (role ${role}) ao apagar duplicata ${r.id}`);
          }
        } catch (e) {
          console.warn('Falha lendo /users antes de apagar:', e.message);
        }
      }
      try {
        await admin.firestore().doc(`clientes/${r.id}`).delete();
      } catch (e) {
        console.warn('Falha ao apagar doc cliente duplicado:', e.message);
      }
    }
  }

  return { dryRun, totalDocs: docs.length, grupos: grupoDetectados, removidos, mantidos };
});

// =========================================================================
// criarLoginParaCliente — cria Auth + /users para um cliente existente sem login
// Permite master ou assessor dono.
// =========================================================================
exports.criarLoginParaCliente = onCall({ region: 'southamerica-east1' }, async (request) => {
  const caller = await requireRole(request, ['master', 'assessor']);
  const clienteId = (request.data?.clienteId || '').trim();
  if (!clienteId) throw new HttpsError('invalid-argument', 'clienteId é obrigatório');

  const cliRef = admin.firestore().doc(`clientes/${clienteId}`);
  const cliSnap = await cliRef.get();
  if (!cliSnap.exists) throw new HttpsError('not-found', 'Cliente não encontrado');
  const cli = cliSnap.data();

  if (caller.role === 'assessor') {
    const dono = cli.advisorId === caller.uid || cli.assessorId === caller.uid;
    if (!dono) throw new HttpsError('permission-denied', 'Cliente não vinculado a você');
  }

  const email = (cli.email || '').trim().toLowerCase();
  const nome = (cli.nome || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Cliente não tem email válido cadastrado');
  }
  if (!nome) throw new HttpsError('invalid-argument', 'Cliente não tem nome');
  if (cli.userId) {
    try {
      await admin.auth().getUser(cli.userId);
      throw new HttpsError('already-exists', 'Cliente já tem login ativo');
    } catch (e) {
      if (e.code !== 'auth/user-not-found') {
        // já existe Auth — sinaliza
        if (e instanceof HttpsError) throw e;
      }
    }
  }

  const advisorId = cli.advisorId || cli.assessorId || caller.uid;
  const senhaTemp = randomPassword();

  let userRecord;
  try {
    // Se já existe Auth pelo email (órfão), reaproveita em vez de falhar
    try {
      userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(userRecord.uid, { password: senhaTemp, displayName: nome });
    } catch (_) {
      userRecord = await admin.auth().createUser({
        email,
        password: senhaTemp,
        displayName: nome,
        emailVerified: false,
      });
    }
  } catch (e) {
    throw new HttpsError('internal', 'Erro Auth: ' + e.message);
  }

  await admin.firestore().doc(`users/${userRecord.uid}`).set({
    nome,
    email,
    role: 'cliente',
    active: true,
    advisorId,
    clienteId,
    mustResetPassword: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: caller.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Custom claim: cliente — permite regras Firestore lerem direto do token.
  await setRoleClaim(userRecord.uid, 'cliente');

  await cliRef.set({ userId: userRecord.uid, advisorId, assessorId: advisorId }, { merge: true });

  let resetLink = null;
  try { resetLink = await admin.auth().generatePasswordResetLink(email); } catch (_) {}

  return { success: true, uid: userRecord.uid, senha: senhaTemp, resetLink };
});

// =========================================================================
// resetarSenhaPadrao — master only — redefine senha para `PortoInvest$$`
// =========================================================================
exports.resetarSenhaPadrao = onCall({ region: 'southamerica-east1' }, async (request) => {
  await requireRole(request, ['master']);
  const uid = (request.data?.uid || '').trim();
  const email = (request.data?.email || '').trim().toLowerCase();
  if (!uid && !email) {
    throw new HttpsError('invalid-argument', 'uid ou email é obrigatório');
  }
  let target = null;
  try {
    if (uid) target = await admin.auth().getUser(uid);
    else target = await admin.auth().getUserByEmail(email);
  } catch (e) {
    throw new HttpsError('not-found', 'Usuário não encontrado no Auth: ' + e.message);
  }
  try {
    await admin.auth().updateUser(target.uid, { password: 'PortoInvest$$' });
  } catch (e) {
    throw new HttpsError('internal', 'Erro ao atualizar senha: ' + e.message);
  }
  try {
    await admin.firestore().doc(`users/${target.uid}`).set(
      { mustResetPassword: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    console.warn('Falha ao marcar mustResetPassword:', e.message);
  }
  return { success: true, uid: target.uid, email: target.email, senha: 'PortoInvest$$' };
});

// =========================================================================
// limparEmailAuth — master only — remove conta Auth órfã por email
// Uso: quando um cadastro falhou e deixou um Auth pendurado bloqueando o reuso do email.
// =========================================================================
exports.limparEmailAuth = onCall({ region: 'southamerica-east1' }, async (request) => {
  await requireRole(request, ['master']);
  const email = (request.data?.email || '').trim().toLowerCase();
  const force = !!request.data?.force;
  if (!email) {
    throw new HttpsError('invalid-argument', 'email é obrigatório');
  }
  try {
    const u = await admin.auth().getUserByEmail(email);
    if (!u) return { success: true, removed: false, reason: 'nenhuma conta encontrada' };
    // CRÍTICO: se esse Auth corresponde a um assessor/master ativo, bloqueia
    // a menos que o caller passe force:true. Antes, "Liberar email bloqueado"
    // apagava silenciosamente qualquer conta — assessor inteiro sumia por engano.
    try {
      const docSnap = await admin.firestore().doc(`users/${u.uid}`).get();
      if (docSnap.exists) {
        const role = docSnap.data().role;
        if ((role === 'assessor' || role === 'master') && !force) {
          throw new HttpsError('failed-precondition',
            `Este email pertence a um ${role} ativo (uid ${u.uid}). ` +
            'Se realmente quer apagar, use "Excluir" na lista de usuários (com confirmação por nome). ' +
            'Para forçar mesmo assim, reenvie com force:true.');
        }
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      // erro lendo /users — segue o fluxo legado para não bloquear o caso original
      // (email órfão sem /users)
    }
    await admin.auth().deleteUser(u.uid);
    try { await admin.firestore().doc(`users/${u.uid}`).delete(); } catch (_) {}
    return { success: true, removed: true, uid: u.uid };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e.code === 'auth/user-not-found') {
      return { success: true, removed: false, reason: 'nenhuma conta encontrada' };
    }
    throw new HttpsError('internal', 'Erro: ' + e.message);
  }
});

// =========================================================================
// restaurarAssessor — master only. Recria /users/{uid} para um assessor
// cujo doc sumiu (ex.: foi apagado por acidente). Se o Auth ainda existe,
// reusa; se não, cria com a senha padrão.
// =========================================================================
exports.restaurarAssessor = onCall({ region: 'southamerica-east1' }, async (request) => {
  const caller = await requireRole(request, ['master']);
  const email = (request.data?.email || '').trim().toLowerCase();
  const nome = (request.data?.nome || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email inválido');
  }
  if (!nome) {
    throw new HttpsError('invalid-argument', 'Nome é obrigatório');
  }
  const senhaTemp = randomPassword();
  let userRecord;
  let authExistia = false;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
    authExistia = true;
    await admin.auth().updateUser(userRecord.uid, { password: senhaTemp, displayName: nome });
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      userRecord = await admin.auth().createUser({
        email, password: senhaTemp, displayName: nome, emailVerified: false,
      });
    } else {
      throw new HttpsError('internal', 'Erro Auth: ' + e.message);
    }
  }
  // Reabilita /users/{uid} como assessor (merge pra não sobrescrever
  // campos extras que possam existir).
  await admin.firestore().doc(`users/${userRecord.uid}`).set({
    nome, email, role: 'assessor', active: true, mustResetPassword: true,
    restauradoEm: admin.firestore.FieldValue.serverTimestamp(),
    restauradoPor: caller.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  let resetLink = null;
  try { resetLink = await admin.auth().generatePasswordResetLink(email); } catch (_) {}

  return {
    success: true,
    uid: userRecord.uid,
    authExistia,
    senhaInicial: senhaTemp,
    resetLink,
    aviso: authExistia
      ? 'Assessor restaurado: o doc /users foi recriado e a senha resetada para a padrão.'
      : 'Assessor criado: o Auth não existia, criei do zero com senha padrão.',
  };
});

// =========================================================================
// listarUsuarios — master only
// =========================================================================
exports.listarUsuarios = onCall({ region: 'southamerica-east1' }, async (request) => {
  await requireRole(request, ['master']);
  const snap = await admin.firestore().collection('users').get();
  const users = snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: d.id,
      nome: x.nome || null,
      email: x.email || null,
      role: x.role || null,
      active: x.active !== false,
      mustResetPassword: !!x.mustResetPassword,
      advisorId: x.advisorId || null,
      createdAt: x.createdAt?.toDate?.().toISOString?.() || null,
    };
  });
  users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { users };
});

// =========================================================================
// withTimeout — padrão único para qualquer fetch externo: se a promise não
// resolver até `ms`, devolve `fallback` (default null). Nunca rejeita, então
// pode ser usado direto dentro de Promise.all sem quebrar o conjunto.
// Centraliza o comportamento "se travar, segue" usado em fontes best-effort.
// =========================================================================
function withTimeout(promise, ms, fallback = null) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch(() => { clearTimeout(timer); resolve(fallback); });
  });
}

// =========================================================================
// brapi.dev — API JSON brasileira. Em 2025 virou paga (HTTP 401 sem token).
// Pulamos completamente quando BRAPI_TOKEN não está configurado, pra não
// pagar latência de TCP+TLS+401 em todos os 110 tickers BR.
// =========================================================================
async function fetchBrapi(ticker) {
  const token = process.env.BRAPI_TOKEN || '';
  if (!token) return null;  // sem token, brapi sempre 401 — não desperdiça tempo
  const tickerSimples = ticker.replace(/\.SA$/i, '');
  const url = `https://brapi.dev/api/quote/${tickerSimples}?fundamental=true&token=${token}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PortoInvest/1.0)',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    const item = data?.results?.[0];
    if (!item) return null;
    return {
      pl: item.priceEarnings ?? null,
      pvp: item.priceToBookRatio ?? null,
      dy: item.dividendYield ?? null,
      roe: item.returnOnEquity ?? null,
      evEbitda: item.enterpriseToEbitda ?? null,
      margemLiq: item.profitMargins != null ? item.profitMargins * 100 : null,
      _fonteBrapi: true,
    };
  } catch {
    return null;
  }
}

// =========================================================================
// Funds Explorer — site público especializado em FIIs brasileiros.
// Tentamos extrair cap rate, vacância, alavancagem, WAULT da página HTML.
// =========================================================================
async function fetchFundsExplorer(ticker) {
  const tickerSimples = ticker.replace(/\.SA$/i, '').toUpperCase();
  const url = `https://www.fundsexplorer.com.br/funds/${tickerSimples}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 9000);
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const html = await r.text();
    return parseFundsExplorer(html);
  } catch {
    return null;
  }
}

function parseFundsExplorer(html) {
  if (!html) return null;
  const out = {};
  const parseBR = (s) => {
    if (!s) return null;
    const limpo = String(s).replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return Number.isFinite(n) ? n : null;
  };
  // Funds Explorer estrutura: <div class="indicators__item"><span>LABEL</span><b>VALOR</b></div>
  const blocos = html.matchAll(/<(?:span|p)[^>]*>([^<]{2,40})<\/(?:span|p)>[\s\S]{0,200}?<(?:b|strong|span)[^>]*class="[^"]*(?:value|indicators__value)[^"]*"[^>]*>([\s\S]{0,80}?)<\/(?:b|strong|span)>/gi);
  const mapa = {};
  for (const m of blocos) {
    const titulo = m[1].toLowerCase().trim();
    const val = parseBR(m[2]);
    if (val != null && !(titulo in mapa)) mapa[titulo] = val;
  }
  out.dy   = mapa['dividend yield'] || mapa['dy'];
  out.pvp  = mapa['p/vp'];
  out.vac  = mapa['vacância física'] || mapa['vacância'] || mapa['vacancia'];
  out.alav = mapa['alavancagem'];
  out.payoutRatio = mapa['payout'];
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return Object.keys(out).length > 0 ? out : null;
}

// =========================================================================
// Status Invest scraper — fonte secundária para indicadores BR (ações + FIIs).
// Busca a página HTML pública do ativo e extrai indicadores via regex nos
// data-attributes que o site usa para renderizar os números.
//
// IMPORTANTE: Status Invest pode bloquear requisições por user-agent ou IP.
// Cada falha é silenciada — se falhar, a Cloud Function só usa o que veio
// do Yahoo. Sem dependência crítica.
// =========================================================================
async function fetchStatusInvest(ticker, tipo = 'acoes') {
  const tickerLower = ticker.toLowerCase().replace('.sa', '');
  const url = `https://statusinvest.com.br/${tipo}/${tickerLower}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 9000);
    const r = await fetch(url, {
      signal: ac.signal,
      // Headers que mimetizam um browser real, com Referer e Sec-Fetch.
      // Status Invest geralmente bloqueia 403 mas tentamos best-effort.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const html = await r.text();
    return parseStatusInvest(html, tipo);
  } catch {
    return null;
  }
}

// Parser: Status Invest usa atributos `data-asset-key` e títulos visuais para
// expor os números. Procura padrões como `<strong title="..." class="value">12,34</strong>`.
function parseStatusInvest(html, tipo) {
  if (!html || typeof html !== 'string') return null;
  const out = {};

  // Helper: extrai número de uma seção HTML matched
  const extrairNumero = (texto) => {
    if (!texto) return null;
    // Status Invest formata "12,34", "1.234,56", "1.000,00", "-15,67"
    const limpo = texto.replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return Number.isFinite(n) ? n : null;
  };

  // Padrão genérico: encontra blocos {title="X"... <strong class="...value...">Y</strong>}
  // e mapeia title → valor numérico.
  const blocos = html.matchAll(/title="([^"]+?)"[^<>]*?>[\s\S]{0,400}?<strong[^>]*class="[^"]*value[^"]*"[^>]*>([^<]+)<\/strong>/gi);
  const mapa = {};
  for (const m of blocos) {
    const titulo = m[1].toLowerCase().trim();
    const val = extrairNumero(m[2]);
    if (val == null) continue;
    if (!(titulo in mapa)) mapa[titulo] = val;
  }

  // Mapeamento de títulos do Status Invest → nossos campos
  // (ações)
  if (tipo === 'acoes') {
    out.pl           = mapa['p/l'] || mapa['preço/lucro'];
    out.pvp          = mapa['p/vp'] || mapa['preço/valor patrimonial'];
    out.evEbitda     = mapa['ev/ebitda'];
    out.dy           = mapa['dy'] || mapa['dividend yield'];
    out.roe          = mapa['roe'] || mapa['retorno sobre patrimônio'];
    out.roicAprox    = mapa['roic'];
    out.margemLiq    = mapa['margem líquida'] || mapa['m. líquida'] || mapa['margem liquida'];
    out.margemBruta  = mapa['margem bruta'] || mapa['m. bruta'];
    out.divLiqEbitda = mapa['dívida líquida/ebitda'] || mapa['dl/ebitda'];
    out.cobJuros     = mapa['cobertura de juros'] || mapa['ebit/dívida'];
    out.payoutRatio  = mapa['payout'];
  } else if (tipo === 'fundos-imobiliarios') {
    out.dy        = mapa['dy'] || mapa['dividend yield'];
    out.pvp       = mapa['p/vp'];
    out.vac       = mapa['vacância física'] || mapa['vacancia'] || mapa['vacância'];
    out.alav      = mapa['alavancagem'];
    out.payoutRatio = mapa['payout'];
    // Liquidez / patrimônio podem ser parseados se necessário no futuro
  }
  // Remove campos null pra não sobrescrever Yahoo
  for (const k of Object.keys(out)) {
    if (out[k] == null) delete out[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

// =========================================================================
// Investidor10 scraper — segunda fonte para validação cruzada.
// =========================================================================
let _i10Debugged = false;
async function fetchInvestidor10(ticker, tipo = 'acoes') {
  const tickerLower = ticker.toLowerCase().replace('.sa', '');
  const path = tipo === 'fundos-imobiliarios' ? 'fiis' : 'acoes';
  const url = `https://investidor10.com.br/${path}/${tickerLower}/`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 9000);
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const html = await r.text();
    return parseInvestidor10(html, tipo);
  } catch (e) {
    if (!_i10Debugged) { _i10Debugged = true; console.warn(`[Investidor10 debug] ${ticker} erro:`, e.message); }
    return null;
  }
}

// Investidor10: usa regex sobre texto livre da página (descrição em pt-BR).
function parseInvestidor10(html, tipo) {
  if (!html || typeof html !== 'string') return null;
  const out = {};

  const parseBR = (s) => {
    if (!s) return null;
    const limpo = String(s).replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return Number.isFinite(n) ? n : null;
  };

  // Investidor10 usa frases descritivas ("P/L de 27,58", "Dividend Yield de 6,38%")
  // que são razoavelmente estáveis. Captura cada métrica via regex.
  const captura = (regex) => {
    const m = html.match(regex);
    return m ? parseBR(m[1]) : null;
  };

  if (tipo === 'acoes') {
    out.pl  = captura(/P\/L de ([\d.,\-]+)/i);
    out.pvp = captura(/P\/VP de ([\d.,\-]+)/i);
    out.dy  = captura(/Dividend Yield de ([\d.,\-]+)/i);
    out.roe = captura(/ROE de ([\d.,\-]+)/i);
    out.roicAprox = captura(/ROIC de ([\d.,\-]+)/i);
    out.evEbitda  = captura(/EV\/EBITDA de ([\d.,\-]+)/i);
    out.margemLiq = captura(/Margem L[ií]quida de ([\d.,\-]+)/i);
    out.divLiqEbitda = captura(/D[ií]vida L[ií]quida\s*\/\s*EBITDA de ([\d.,\-]+)/i);
    out.variacaoAno  = captura(/varia[cç][aã]o de ([\d.,\-]+)\s*%?[^.]{0,30}[uú]ltimo ano/i);
  } else if (tipo === 'fundos-imobiliarios') {
    out.dy  = captura(/Dividend Yield de ([\d.,\-]+)/i);
    out.pvp = captura(/P\/VP de ([\d.,\-]+)/i);
    // VAC do Investidor10 desativada — regex frágil pega outros números.
    // Vacância vem do quote do Yahoo se disponível, senão N/D.
    out.variacaoAno = captura(/varia[cç][aã]o de ([\d.,\-]+)\s*%?[^.]{0,30}[uú]ltimo ano/i);
  }

  for (const k of Object.keys(out)) {
    if (out[k] == null) delete out[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Mescla dados de Yahoo + StatusInvest + Investidor10. Yahoo é base; outros
// preenchem só os campos faltantes (não sobrescrevem dados Yahoo).
function mesclarFontes(base, ...adicionais) {
  const out = { ...base };
  for (const fonte of adicionais) {
    if (!fonte) continue;
    for (const k of Object.keys(fonte)) {
      const valBase = out[k];
      if (valBase == null || !Number.isFinite(valBase)) {
        out[k] = fonte[k];
      }
    }
  }
  return out;
}

// Debug: retorna dados brutos do Yahoo para 1 ticker (master only).
exports.debugYahoo = onCall({ region: 'southamerica-east1', timeoutSeconds: 30 }, async (request) => {
  await requireRole(request, ['master']);
  const ticker = (request.data?.ticker || 'PETR4.SA').trim();
  const out = { ticker, errors: {} };
  try {
    out.summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'],
    }, { validateResult: false });
  } catch (e) { out.errors.summary = e.message; }
  try {
    out.financials = await yahooFinance.fundamentalsTimeSeries(ticker, {
      period1: new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000),
      type: 'annual',
      module: 'financials',
    }, { validateResult: false });
  } catch (e) { out.errors.financials = e.message; }
  try {
    out.balance = await yahooFinance.fundamentalsTimeSeries(ticker, {
      period1: new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000),
      type: 'annual',
      module: 'balance-sheet',
    }, { validateResult: false });
  } catch (e) { out.errors.balance = e.message; }
  return out;
});

// =========================================================================
// migrarClaims — master only — popula os custom claims `role` em todos os
// usuários existentes no Firestore. Idempotente: pode ser rodado várias vezes.
// Usuários precisam fazer novo login para o token refletir o claim.
// Migração é opcional: as rules têm fallback para /users/{uid} via get().
// =========================================================================
exports.migrarClaims = onCall({ region: 'southamerica-east1' }, async (request) => {
  await requireRole(request, ['master']);
  const snap = await admin.firestore().collection('users').get();
  const resultado = { total: snap.size, atualizados: 0, pulados: 0, erros: 0, detalhes: [] };

  for (const doc of snap.docs) {
    const uid = doc.id;
    const role = doc.data().role;
    if (!role) { resultado.pulados++; continue; }
    try {
      const user = await admin.auth().getUser(uid);
      const existingRole = user.customClaims?.role;
      if (existingRole === role) { resultado.pulados++; continue; }
      const existing = user.customClaims || {};
      await admin.auth().setCustomUserClaims(uid, { ...existing, role });
      resultado.atualizados++;
      resultado.detalhes.push({ uid, role, antes: existingRole || null });
    } catch (e) {
      resultado.erros++;
      resultado.detalhes.push({ uid, erro: e.message });
    }
  }
  return resultado;
});

// =========================================================================
// Yahoo Finance via package yahoo-finance2 — mantido ativamente, gerencia
// automaticamente o fluxo de crumb/cookie que a Yahoo mudou em 2024+.
// Retorna array de quotes brutos no formato Yahoo.
// =========================================================================
async function fetchYahooQuote(tickersArr) {
  try {
    const results = await yahooFinance.quote(tickersArr, {}, { validateResult: false });
    return Array.isArray(results) ? results : [results].filter(Boolean);
  } catch (e) {
    console.warn('[fetchYahooQuote] falhou:', e.message);
    return [];
  }
}

// Busca indicadores fundamentalistas via quoteSummary + fundamentalsTimeSeries.
//
// IMPORTANTE: Em Nov/2024, Yahoo deprecou os submódulos antigos
// (incomeStatementHistory, balanceSheetHistory, cashflowStatementHistory) que
// passaram a retornar quase nada. A nova API é fundamentalsTimeSeries.
//
// quoteSummary mantém funcionando para: financialData, defaultKeyStatistics,
// summaryDetail, assetProfile.
async function fetchYahooSummary(ticker) {
  try {
    // 1. Indicadores instantâneos (ratios)
    const summaryPromise = yahooFinance.quoteSummary(ticker, {
      modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'],
    }, { validateResult: false }).catch((e) => {
      console.warn(`[summary] ${ticker}: ${e.message}`);
      return null;
    });

    // 2. Séries temporais — em v3, type aceita só 'annual'|'quarterly'|'all',
    //    e module define qual demonstrativo. 'financials' já cobre receita/lucro/ebit/ebitda.
    const seriesPromise = yahooFinance.fundamentalsTimeSeries(ticker, {
      period1: new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000),
      type: 'annual',
      module: 'financials',
    }, { validateResult: false }).catch((e) => {
      console.warn(`[fetchYahooSummary] timeSeries ${ticker} falhou: ${e.message}`);
      return null;
    });
    // 3. Balance sheet separado (debt, cash, equity, assets)
    const bsPromise = yahooFinance.fundamentalsTimeSeries(ticker, {
      period1: new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000),
      type: 'annual',
      module: 'balance-sheet',
    }, { validateResult: false }).catch(() => null);

    const [summary, series, balance] = await Promise.all([summaryPromise, seriesPromise, bsPromise]);
    if (!summary && !series && !balance) return null;
    const seriesUnida = unirSeries(series, balance);
    return { summary, series: seriesUnida };
  } catch (e) {
    console.warn(`[fetchYahooSummary] ${ticker} falhou: ${e.message}`);
    return null;
  }
}

// Calcula CAGR de uma série temporal de valores (mais recente primeiro).
function calcularCAGR(serie) {
  const vals = serie
    .map(v => typeof v === 'object' && v !== null ? (v.raw ?? Number(v)) : Number(v))
    .filter(v => Number.isFinite(v) && v > 0);
  if (vals.length < 2) return null;
  const inicial = vals[vals.length - 1];
  const final = vals[0];
  const anos = vals.length - 1;
  const cagr = (Math.pow(final / inicial, 1 / anos) - 1) * 100;
  return Number.isFinite(cagr) ? cagr : null;
}

// Helpers para extrair raw de campos Yahoo (podem vir como número direto ou { raw, fmt })
function valNum(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'object' && x !== null) {
    if ('raw' in x && Number.isFinite(x.raw)) return x.raw;
    if ('value' in x && Number.isFinite(x.value)) return x.value;
  }
  return null;
}

// Une duas séries fundamentais (financials + balance-sheet) num array por data.
// Ambas vêm como [{ date, [campo]: valor }, ...] — combina por data.
function unirSeries(s1, s2) {
  const mapa = new Map();
  for (const arr of [s1, s2]) {
    if (!Array.isArray(arr)) continue;
    for (const linha of arr) {
      const chave = String(linha?.date || '');
      if (!chave) continue;
      const acc = mapa.get(chave) || { date: linha.date };
      mapa.set(chave, { ...acc, ...linha });
    }
  }
  // Ordena pela data (asc) — mais antigo primeiro, mais recente último
  return [...mapa.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Helpers para fundamentalsTimeSeries: pega valor mais recente e série completa por nome.
// Yahoo retorna campos com nomes específicos (ex: EBITDA, EBIT, totalRevenue).
// `campos` aceita string ou array — usa o primeiro com valor finito.
function ftsLatest(series, campos) {
  if (!Array.isArray(series)) return null;
  const lista = Array.isArray(campos) ? campos : [campos];
  for (let i = series.length - 1; i >= 0; i--) {
    const linha = series[i];
    if (!linha) continue;
    for (const c of lista) {
      const v = linha[c];
      if (v != null && Number.isFinite(v)) return v;
    }
  }
  return null;
}
function ftsSerieAnos(series, campos, anos = 4) {
  if (!Array.isArray(series)) return [];
  const lista = Array.isArray(campos) ? campos : [campos];
  const valores = [];
  for (let i = series.length - 1; i >= 0 && valores.length < anos; i--) {
    const linha = series[i];
    if (!linha) continue;
    for (const c of lista) {
      const v = linha[c];
      if (v != null && Number.isFinite(v)) { valores.push(v); break; }
    }
  }
  return valores; // mais recente primeiro
}

// Extrai indicadores adicionais do summary + fundamentalsTimeSeries.
// Com cálculos derivados quando o campo direto não vem do Yahoo.
function extrairIndicadoresExtra(payload, quote = {}) {
  if (!payload) return {};
  const summary = payload.summary || {};
  const series  = payload.series || [];
  const fd = summary.financialData || {};
  const ks = summary.defaultKeyStatistics || {};
  const sd = summary.summaryDetail || {};
  const v = valNum;

  // Sanitiza % vindos como decimal (0.123 → 12.3) ou como já-pct (12.3)
  const pct = (x) => {
    const n = v(x);
    if (n == null) return null;
    return Math.abs(n) < 5 ? n * 100 : n; // se < 5, é fração; senão já é %
  };

  // ── Aliases dos campos do Yahoo fundamentalsTimeSeries (nomes reais) ──
  // Yahoo agora retorna nomes diretos (não com prefixo annual): "EBITDA", "EBIT",
  // "totalRevenue", "netIncomeIncludingNoncontrollingInterests", "operatingIncome", etc.
  const FIELD_RECEITA = ['totalRevenue', 'OperatingRevenue'];
  const FIELD_LUCRO   = ['netIncome', 'netIncomeIncludingNoncontrollingInterests', 'netIncomeContinuousOperations'];
  const FIELD_EBIT    = ['EBIT', 'operatingIncome', 'totalOperatingIncomeAsReported'];
  const FIELD_EBITDA  = ['EBITDA', 'normalizedEBITDA'];
  const FIELD_JUROS   = ['interestExpense', 'interestExpenseNonOperating', 'netInterestIncome'];
  const FIELD_GROSS   = ['grossProfit'];
  const FIELD_DEBT    = ['totalDebt', 'longTermDebt', 'totalNonCurrentLiabilitiesNetMinorityInterest', 'longTermDebtAndCapitalLeaseObligation'];
  const FIELD_CASH    = ['cashAndCashEquivalents', 'cashCashEquivalentsAndShortTermInvestments', 'cashFinancial', 'cash'];
  const FIELD_EQUITY  = ['stockholdersEquity', 'commonStockEquity', 'totalEquityGrossMinorityInterest'];
  const FIELD_ATIVOS  = ['totalAssets'];

  // ── CAGR Receita/Lucro ──
  const receitas = ftsSerieAnos(series, FIELD_RECEITA, 4).filter(x => x > 0);
  const lucros   = ftsSerieAnos(series, FIELD_LUCRO, 4);
  const cagrRec  = calcularCAGR(receitas);
  const cagrLuc  = lucros.length >= 2 && lucros.every(x => x > 0) ? calcularCAGR(lucros) : null;

  // ── EBITDA / Dívida Líquida ──
  let ebitda = v(fd.ebitda) || ftsLatest(series, FIELD_EBITDA);
  let totalDebt = v(fd.totalDebt) || ftsLatest(series, FIELD_DEBT);
  let totalCash = v(fd.totalCash) || ftsLatest(series, FIELD_CASH);
  const dividaLiq = totalDebt != null ? totalDebt - (totalCash || 0) : null;
  const dlEbitda = dividaLiq != null && ebitda && ebitda > 0 ? dividaLiq / ebitda : null;

  // ── Cobertura de juros: EBIT / |Juros| ──
  let cobJuros = null;
  const ebit = ftsLatest(series, FIELD_EBIT);
  const juros = ftsLatest(series, FIELD_JUROS);
  if (ebit != null && juros != null && juros !== 0) cobJuros = Math.abs(ebit / juros);

  // ── Margens (% direta de financialData OU calculada de séries) ──
  let margemLiq = pct(fd.profitMargins);
  if (margemLiq == null) {
    const lucro = ftsLatest(series, FIELD_LUCRO);
    const receita = ftsLatest(series, FIELD_RECEITA);
    if (lucro != null && receita && receita > 0) margemLiq = (lucro / receita) * 100;
  }
  let margemBruta = pct(fd.grossMargins);
  if (margemBruta == null) {
    const gp = ftsLatest(series, FIELD_GROSS);
    const receita = ftsLatest(series, FIELD_RECEITA);
    if (gp != null && receita && receita > 0) margemBruta = (gp / receita) * 100;
  }
  let margemOp = pct(fd.operatingMargins);
  if (margemOp == null) {
    const op = ftsLatest(series, FIELD_EBIT);
    const receita = ftsLatest(series, FIELD_RECEITA);
    if (op != null && receita && receita > 0) margemOp = (op / receita) * 100;
  }

  // ── ROE: financialData OU lucro/patrimônio ──
  let roe = pct(fd.returnOnEquity);
  if (roe == null) {
    const lucro = ftsLatest(series, FIELD_LUCRO);
    const patr = ftsLatest(series, FIELD_EQUITY);
    if (lucro != null && patr && patr > 0) roe = (lucro / patr) * 100;
  }

  // ── ROA: financialData OU lucro/ativos ──
  let roa = pct(fd.returnOnAssets);
  if (roa == null) {
    const lucro = ftsLatest(series, FIELD_LUCRO);
    const ativos = ftsLatest(series, FIELD_ATIVOS);
    if (lucro != null && ativos && ativos > 0) roa = (lucro / ativos) * 100;
  }

  // ── ROIC aproximado: média ROA + ROE (proxy razoável) ──
  let roicAprox = null;
  if (roa != null && roe != null) roicAprox = (roa + roe) / 2;
  else if (roa != null) roicAprox = roa;
  else if (roe != null) roicAprox = roe * 0.7; // ROIC tipicamente < ROE pela alavancagem

  // ── EV/EBITDA: direto ou calculado ──
  let evEbitda = v(ks.enterpriseToEbitda);
  if (evEbitda == null && ebitda && ebitda > 0) {
    const ev = v(ks.enterpriseValue);
    if (ev) evEbitda = ev / ebitda;
  }

  // ── Crescimento de receita/lucro (12 meses) ──
  const crescReceita = pct(fd.revenueGrowth);
  const crescLucro   = pct(fd.earningsGrowth);

  return {
    evEbitda:      evEbitda,
    forwardPE:     v(ks.forwardPE),
    pegRatio:      v(ks.pegRatio),
    payoutRatio:   pct(sd.payoutRatio),
    dy5anosAvg:    v(sd.fiveYearAvgDividendYield),
    roa,
    roe:           roe ?? quote.roe ?? null,
    margemLiq,
    margemBruta,
    margemOp,
    crescReceita,
    crescLucro,
    cagrReceita:   cagrRec ?? crescReceita,
    cagrLucro:     cagrLuc ?? crescLucro,
    dividaPatr:    v(fd.debtToEquity),
    currentRatio:  v(fd.currentRatio),
    divLiqEbitda:  dlEbitda,
    cobJuros,
    roicAprox,
  };
}

// =========================================================================
// buscarMercadoBR — proxy server-side para Yahoo Finance com tickers BR.
//
// Estratégia "Yahoo-first + enriquecimento best-effort em paralelo":
//   FASE 1 (obrigatória, ~6-15s): Yahoo quote() em batch — preço, variação,
//          múltiplos básicos. Garante o "produto mínimo viável" da página.
//   FASE 2 (paralela à 3, ~30-70s): Yahoo quoteSummary + fundamentalsTimeSeries.
//   FASE 3 (paralela à 2, ~25s hard cap): scrapers BR (brapi/i10/si/fe).
//
// As fases 2 e 3 rodam em paralelo. Cada uma tem timeout duro; se travar,
// retornamos o que já temos. Função NUNCA retorna [] se a fase 1 funcionou.
//
// Antes essas três fases eram sequenciais com soma > 60s — o cliente abortava
// e perdia tudo, inclusive o que o Yahoo já tinha trazido.
// =========================================================================
const PHASE2_TIMEOUT_MS = 70000;  // Yahoo summary completo
const PHASE3_TIMEOUT_MS = 25000;  // Scrapers BR (best-effort)
const PER_REQUEST_TIMEOUT_MS = 9000;

exports.buscarMercadoBR = onCall({ region: 'southamerica-east1', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  await requireRole(request, ['master']);
  const tickers = Array.isArray(request.data?.tickers) ? request.data.tickers : [];
  if (tickers.length === 0) throw new HttpsError('invalid-argument', 'tickers é obrigatório');
  if (tickers.length > 200) throw new HttpsError('invalid-argument', 'máximo 200 tickers por chamada');

  const t0 = Date.now();
  const tickersYahoo = tickers.map((t) => t.includes('.') ? t : `${t}.SA`);
  const batchSize = 20;
  const quotesMap = new Map();

  // ──────────── FASE 1: Yahoo quote (obrigatória) ────────────
  for (let i = 0; i < tickersYahoo.length; i += batchSize) {
    const grupo = tickersYahoo.slice(i, i + batchSize);
    const results = await fetchYahooQuote(grupo);
    for (const q of results) if (q.symbol) quotesMap.set(q.symbol, q);
  }
  const t1 = Date.now();
  const entries = [...quotesMap.keys()];
  console.log(`[buscarMercadoBR] fase1 yahooQuote: ${entries.length}/${tickers.length} em ${t1 - t0}ms`);

  if (entries.length === 0) {
    // Yahoo morreu completamente — não tem como entregar nada útil.
    return { ativos: [], total: 0, _aviso: 'Yahoo não respondeu — sem dados básicos.' };
  }

  // ──────────── FASE 2 (paralela): Yahoo summary detalhado ────────────
  const fase2 = withTimeout((async () => {
    const summaries = {};
    const limit = 6;
    for (let i = 0; i < entries.length; i += limit) {
      const slice = entries.slice(i, i + limit);
      const results = await Promise.all(
        slice.map((t) => withTimeout(fetchYahooSummary(t), PER_REQUEST_TIMEOUT_MS, null).then((s) => [t, s]))
      );
      for (const [t, s] of results) summaries[t] = s;
    }
    return summaries;
  })(), PHASE2_TIMEOUT_MS, {});

  // ──────────── FASE 3 (paralela): scrapers BR best-effort ────────────
  const tipoFonte = (sym) => /11\.SA$/i.test(sym) ? 'fundos-imobiliarios' : 'acoes';
  const fase3 = withTimeout((async () => {
    const fontesBR = {};
    const limitFontes = 5;
    for (let i = 0; i < entries.length; i += limitFontes) {
      const slice = entries.slice(i, i + limitFontes);
      const results = await Promise.all(slice.map(async (t) => {
        const tipo = tipoFonte(t);
        const tickerSimples = t.replace(/\.SA$/i, '');
        const ehFii = tipo === 'fundos-imobiliarios';
        // Cada fonte com seu próprio timeout — uma travada não atrasa as outras.
        const promises = [
          withTimeout(fetchBrapi(t), PER_REQUEST_TIMEOUT_MS, null),
          withTimeout(fetchInvestidor10(tickerSimples, tipo), PER_REQUEST_TIMEOUT_MS, null),
          withTimeout(fetchStatusInvest(tickerSimples, tipo), PER_REQUEST_TIMEOUT_MS, null),
        ];
        if (ehFii) promises.push(withTimeout(fetchFundsExplorer(tickerSimples), PER_REQUEST_TIMEOUT_MS, null));
        const [brapi, i10, si, fe] = await Promise.all(promises);
        return [t, { brapi, i10, si, fe }];
      }));
      for (const [t, f] of results) fontesBR[t] = f;
    }
    return fontesBR;
  })(), PHASE3_TIMEOUT_MS, {});

  // Espera as duas fases (qualquer travamento já está coberto pelo withTimeout).
  const [summaries, fontesBR] = await Promise.all([fase2, fase3]);
  const t2 = Date.now();

  const stats = {
    summary: Object.values(summaries).filter(Boolean).length,
    brapi:   Object.values(fontesBR).filter((f) => f && f.brapi).length,
    i10:     Object.values(fontesBR).filter((f) => f && f.i10).length,
    si:      Object.values(fontesBR).filter((f) => f && f.si).length,
    fe:      Object.values(fontesBR).filter((f) => f && f.fe).length,
  };
  console.log(`[buscarMercadoBR] fase2+3 paralelas em ${t2 - t1}ms — summary:${stats.summary}/${entries.length} brapi:${stats.brapi} i10:${stats.i10} si:${stats.si} fe:${stats.fe}`);

  // ──────────── Consolida (mesmo formato anterior) ────────────
  const out = [];
  for (const [symbol, q] of quotesMap.entries()) {
    const extra = extrairIndicadoresExtra(summaries[symbol], q);
    const fontes = fontesBR[symbol] || {};
    const dados = mesclarFontes(extra, fontes.brapi, fontes.i10, fontes.si, fontes.fe);
    out.push({
      ticker: symbol.replace(/\.SA$/i, ''),
      moeda: q.currency || 'BRL',
      preco: q.regularMarketPrice ?? null,
      variacaoDia: q.regularMarketChangePercent ?? null,
      variacaoAno: q.fiftyTwoWeekChangePercent ?? null,
      max52: q.fiftyTwoWeekHigh ?? null,
      min52: q.fiftyTwoWeekLow ?? null,
      volume: q.regularMarketVolume ?? null,
      marketCap: q.marketCap ?? null,
      pl: q.trailingPE ?? null,
      pvp: q.priceToBook ?? null,
      dy: q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : null,
      roe: q.returnOnEquity != null ? (q.returnOnEquity > 1 ? q.returnOnEquity : q.returnOnEquity * 100) : null,
      nomeLongo: q.longName || q.shortName || symbol.replace(/\.SA$/i, ''),
      _fonte: [
        'yahoo',
        fontes.brapi && 'brapi',
        fontes.i10 && 'i10',
        fontes.si && 'si',
        fontes.fe && 'fe',
      ].filter(Boolean).join('+'),
      ...dados,
    });
  }

  console.log(`[buscarMercadoBR] total ${Date.now() - t0}ms — devolvendo ${out.length} ativos`);
  return { ativos: out, total: out.length };
});

// =========================================================================
// buscarMercadoUS — faz proxy server-side para Stooq (primário) e Yahoo
// (complemento). Evita dependência de proxies CORS públicos que ficaram
// pagos/instáveis. Roda no Cloud Functions (sem CORS). Só master autenticado.
// Retorna { stooq: [...], yahoo: [...] } — o cliente faz o merge.
// =========================================================================
exports.buscarMercadoUS = onCall({ region: 'southamerica-east1', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  await requireRole(request, ['master']);
  const tickers = Array.isArray(request.data?.tickers) ? request.data.tickers : [];
  if (tickers.length === 0) throw new HttpsError('invalid-argument', 'tickers é obrigatório');
  if (tickers.length > 200) throw new HttpsError('invalid-argument', 'máximo 200 tickers por chamada');

  const TIMEOUT_MS = 12000;

  // Stooq: CSV em batch (1 request só)
  async function fetchStooq() {
    const query = tickers.map((t) => `${t.toLowerCase()}.us`).join(',');
    const url = `https://stooq.com/q/l/?s=${query}&f=sd2t2ohlcv&h&e=csv`;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      const r = await fetch(url, { signal: ac.signal });
      clearTimeout(timer);
      if (!r.ok) return [];
      return parseStooqCSV(await r.text());
    } catch (e) {
      console.warn('[buscarMercadoUS] Stooq falhou:', e.message);
      return [];
    }
  }

  // Yahoo v7 (com crumb handling) + quoteSummary para indicadores detalhados.
  async function fetchYahoo() {
    const quotesMap = new Map();
    const batchSize = 20;

    for (let i = 0; i < tickers.length; i += batchSize) {
      const grupo = tickers.slice(i, i + batchSize);
      const results = await fetchYahooQuote(grupo);
      for (const q of results) {
        if (q.symbol) quotesMap.set(q.symbol, q);
      }
    }

    // quoteSummary em paralelo com concurrency limit
    const summaries = {};
    const limit = 6;
    const entries = [...quotesMap.keys()];
    for (let i = 0; i < entries.length; i += limit) {
      const slice = entries.slice(i, i + limit);
      const results = await Promise.all(slice.map(t => fetchYahooSummary(t).then(s => [t, s])));
      for (const [t, s] of results) summaries[t] = s;
    }

    const out = [];
    for (const [symbol, q] of quotesMap.entries()) {
      const extra = extrairIndicadoresExtra(summaries[symbol], q);
      out.push({
        ticker: q.symbol,
        moeda: q.currency || 'USD',
        preco: q.regularMarketPrice ?? null,
        variacaoDia: q.regularMarketChangePercent ?? null,
        variacaoAno: q.fiftyTwoWeekChangePercent ?? null,
        max52: q.fiftyTwoWeekHigh ?? null,
        min52: q.fiftyTwoWeekLow ?? null,
        volume: q.regularMarketVolume ?? null,
        marketCap: q.marketCap ?? null,
        pl: q.trailingPE ?? null,
        pvp: q.priceToBook ?? null,
        dy: q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : null,
        roe: q.returnOnEquity != null ? (q.returnOnEquity > 1 ? q.returnOnEquity : q.returnOnEquity * 100) : null,
        nomeLongo: q.longName || q.shortName || q.symbol,
        _fonte: 'yahoo',
        ...extra,
      });
    }
    return out;
  }

  // Ambos em paralelo, devolve o que conseguir (Promise.allSettled nunca rejeita)
  const [stooqRes, yahooRes] = await Promise.allSettled([fetchStooq(), fetchYahoo()]);
  const stooq = stooqRes.status === 'fulfilled' ? stooqRes.value : [];
  const yahoo = yahooRes.status === 'fulfilled' ? yahooRes.value : [];

  return { stooq, yahoo, totalStooq: stooq.length, totalYahoo: yahoo.length };
});

function parseStooqCSV(csv) {
  const linhas = csv.trim().split('\n');
  if (linhas.length < 2) return [];
  const head = linhas[0].split(',').map((s) => s.trim().toLowerCase());
  const idx = (k) => head.indexOf(k);
  const out = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(',');
    const sym = (cols[idx('symbol')] || '').trim();
    if (!sym || sym === 'N/D') continue;
    const close = parseFloat(cols[idx('close')]);
    const open = parseFloat(cols[idx('open')]);
    if (!Number.isFinite(close)) continue;
    const diaPct = Number.isFinite(open) && open > 0 ? ((close - open) / open) * 100 : null;
    out.push({
      ticker: sym.replace(/\.us$/i, '').toUpperCase(),
      moeda: 'USD',
      preco: close,
      variacaoDia: diaPct,
      volume: parseFloat(cols[idx('volume')]) || null,
      nomeLongo: sym,
      _fonte: 'stooq',
    });
  }
  return out;
}

// =========================================================================
// lerCliente — fallback robusto para leitura de /clientes/{id}
//
// Usa Admin SDK (bypassa Firestore rules), implementa o mesmo modelo de
// autorização das rules MAS com uma garantia extra: como rola server-side,
// não depende de custom claims sincronizados no token do cliente. Isso resolve
// o caso clássico em que o Firestore retorna permission-denied porque o token
// ainda não tem o claim `role` ou o doc /users/{uid} ainda não foi lido.
//
// Auth: master vê tudo; assessor vê só clientes vinculados (advisorId/assessorId);
// cliente vê só o próprio (userId == uid).
// =========================================================================
exports.lerCliente = onCall({ region: 'southamerica-east1' }, async (request) => {
  const info = await getCallerRole(request);
  const clienteId = request.data?.clienteId;
  if (!clienteId || typeof clienteId !== 'string') {
    throw new HttpsError('invalid-argument', 'clienteId obrigatório');
  }

  const ref = admin.firestore().doc(`clientes/${clienteId}`);
  const snap = await ref.get();
  if (!snap.exists) return { exists: false };

  const data = snap.data() || {};
  const isMaster = info.role === 'master';
  const isAssessorDono = info.role === 'assessor'
    && (data.advisorId === info.uid || data.assessorId === info.uid);
  const isClienteDono = info.role === 'cliente' && data.userId === info.uid;

  if (!isMaster && !isAssessorDono && !isClienteDono) {
    throw new HttpsError(
      'permission-denied',
      `Sem permissão. role=${info.role || 'null'} uid=${info.uid} advisorId=${data.advisorId || '∅'} userId=${data.userId || '∅'}`
    );
  }

  return { exists: true, id: snap.id, data };
});

// =========================================================================
// listarSnapshotsCliente — fallback para /clientes/{id}/snapshotsCarteira
// Mesmas regras de autorização do lerCliente.
// =========================================================================
exports.listarSnapshotsCliente = onCall({ region: 'southamerica-east1' }, async (request) => {
  const info = await getCallerRole(request);
  const clienteId = request.data?.clienteId;
  const limite = Math.min(Math.max(Number(request.data?.limite) || 1, 1), 50);
  if (!clienteId || typeof clienteId !== 'string') {
    throw new HttpsError('invalid-argument', 'clienteId obrigatório');
  }

  // Reusa autorização do lerCliente
  const cliRef = admin.firestore().doc(`clientes/${clienteId}`);
  const cliSnap = await cliRef.get();
  if (!cliSnap.exists) return { snapshots: [] };
  const data = cliSnap.data() || {};
  const isMaster = info.role === 'master';
  const isAssessorDono = info.role === 'assessor'
    && (data.advisorId === info.uid || data.assessorId === info.uid);
  const isClienteDono = info.role === 'cliente' && data.userId === info.uid;
  if (!isMaster && !isAssessorDono && !isClienteDono) {
    throw new HttpsError('permission-denied', 'Sem permissão para esse cliente');
  }

  const snaps = await cliRef.collection('snapshotsCarteira')
    .orderBy('mesRef', 'desc').limit(limite).get();
  return { snapshots: snaps.docs.map(d => ({ id: d.id, ...d.data() })) };
});

// =========================================================================
// PUSH NOTIFICATIONS — Aporte atrasado
// Roda todo dia às 09:00 (America/Sao_Paulo).
// Envia FCM push para clientes com fcmToken salvo e aporte em atraso.
// =========================================================================
exports.notificarAportesAtrasados = onSchedule(
  {
    schedule: 'every day 09:00',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
  },
  async () => {
    const hoje = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    );
    const diaHoje = hoje.getDate();
    const mes     = hoje.getMonth() + 1;
    const ano     = hoje.getFullYear();

    const clientesSnap = await admin.firestore().collection('clientes').get();
    const promises = [];

    for (const docSnap of clientesSnap.docs) {
      const c = docSnap.data();
      const token = c.fcmToken;
      if (!token) continue;

      const diaAporte = parseInt(c.diaAporte || '0', 10);
      if (!diaAporte || diaAporte >= diaHoje) continue; // ainda não venceu

      // Verifica se já há aporte no mês corrente
      const hist = Array.isArray(c.aportesHistorico) ? c.aportesHistorico : [];
      const pagouMes = hist.some(
        (a) => Number(a?.mes) === mes && Number(a?.ano) === ano && Number(a?.valor) > 0
      );
      if (pagouMes) continue;

      const diasAtraso = diaHoje - diaAporte;
      const primeiroNome = (c.nome || 'Cliente').split(' ')[0];

      promises.push(
        admin.messaging().send({
          token,
          notification: {
            title: `${primeiroNome}, seu aporte está atrasado`,
            body: diasAtraso === 1
              ? `Você combinou aportar no dia ${diaAporte}. Estamos 1 dia depois. Registre agora.`
              : `Você combinou aportar no dia ${diaAporte}. Já se passaram ${diasAtraso} dias. Registre agora.`,
          },
          webpush: {
            fcmOptions: { link: '/' },
            notification: {
              icon:  'https://porto-invest-login.web.app/pwa-192.png',
              badge: 'https://porto-invest-login.web.app/favicon-32.png',
              requireInteraction: false,
              vibrate: [200, 100, 200],
            },
          },
        }).catch((e) =>
          console.warn(`[FCM] falha para ${docSnap.id}:`, e.message)
        )
      );
    }

    await Promise.allSettled(promises);
    console.log(
      `[notificarAportesAtrasados] ${clientesSnap.size} clientes verificados, ${promises.length} notificações enviadas`
    );
  }
);
