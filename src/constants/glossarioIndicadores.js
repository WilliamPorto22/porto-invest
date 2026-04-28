// Glossário dos indicadores usados na análise de ativos.
// Cada entry: { nome, abrev, formula, interpretacao, faixaSaudavel, observacao, unidade }
// Clique no header abre GlossarioModal com este conteúdo.

export const GLOSSARIO = {
  // ═══ Valuation ═══
  pl: {
    nome: "Preço / Lucro (P/L)",
    abrev: "P/L",
    formula: "Preço da ação ÷ Lucro por ação (12 meses)",
    interpretacao: "Quantos anos de lucro atual o mercado está pagando pela ação. Quanto menor, mais barata é relativamente. Benjamin Graham usava P/L < 15 como filtro clássico.",
    faixaSaudavel: "Ações BR: 8-15 saudável · 15-22 neutro · >25 caro. Ações US: 12-20 saudável · >28 caro",
    observacao: "P/L distorce em empresas com lucro pequeno (numerador explode) ou cíclicas. Use junto com P/VP e ROE.",
    unidade: "x",
    melhorQuando: "menor",
  },
  pvp: {
    nome: "Preço / Valor Patrimonial (P/VP)",
    abrev: "P/VP",
    formula: "Preço da ação ÷ Valor patrimonial por ação",
    interpretacao: "Quanto o mercado paga pela empresa vs. o patrimônio líquido contábil. P/VP < 1 significa comprar abaixo do valor de livro — clássico de Graham.",
    faixaSaudavel: "Ações: <1,5 atrativo · 1,5-2,5 neutro · >3 caro. FIIs: <1,0 ideal · 1,0-1,1 justo · >1,1 sobrepago",
    observacao: "Empresas de serviços (tech, consultorias) naturalmente têm P/VP alto porque seu valor não está no patrimônio físico.",
    unidade: "x",
    melhorQuando: "menor",
  },
  evEbitda: {
    nome: "EV / EBITDA",
    abrev: "EV/EBITDA",
    formula: "(Market Cap + Dívida Líquida) ÷ EBITDA",
    interpretacao: "Quantos anos de geração de caixa operacional o mercado paga pela empresa. Neutraliza diferenças de estrutura de capital — melhor comparador entre empresas do mesmo setor.",
    faixaSaudavel: "Geralmente <7x barato · 7-12x neutro · >15x caro (varia muito por setor)",
    observacao: "EBITDA ignora depreciação — pode mascarar empresas que precisam reinvestir muito em ativos fixos.",
    unidade: "x",
    melhorQuando: "menor",
  },
  dy: {
    nome: "Dividend Yield (DY)",
    abrev: "DY",
    formula: "Dividendos pagos últimos 12 meses ÷ Preço atual da ação",
    interpretacao: "Rentabilidade anual em dividendos como % do preço. Décio Bazin exigia DY > 6% para comprar; Luiz Barsi busca 'ações vaca leiteira' com DY sustentável.",
    faixaSaudavel: "Ações: >6% forte · 4-6% atrativo · <2% baixo. FIIs: >9% forte · 7-9% normal · <7% baixo",
    observacao: "DY alto pode ser 'armadilha de dividendos' — empresa em crise pagando mais do que gera. Verifique payout e CAGR de dividendos.",
    unidade: "%",
    melhorQuando: "maior",
  },

  // ═══ Qualidade / Rentabilidade ═══
  roe: {
    nome: "Return on Equity (ROE)",
    abrev: "ROE",
    formula: "Lucro líquido ÷ Patrimônio líquido",
    interpretacao: "Rentabilidade sobre o capital dos acionistas. Buffett exigia ROE > 15% sustentado ao longo dos anos como sinal de vantagem competitiva duradoura.",
    faixaSaudavel: ">20% excelente · 15-20% saudável · 10-15% mediano · <10% baixo",
    observacao: "ROE pode ser inflado por alavancagem (dívida alta). Cruze com Dív.Líq/EBITDA e ROIC.",
    unidade: "%",
    melhorQuando: "maior",
  },
  roicAprox: {
    nome: "Return on Invested Capital (ROIC)",
    abrev: "ROIC",
    formula: "Lucro operacional após impostos ÷ Capital investido (dívida + patrimônio)",
    interpretacao: "Retorno sobre TODO o capital empregado, incluindo dívida. É o teste definitivo de qualidade — ROIC > custo de capital (WACC) significa que a empresa cria valor.",
    faixaSaudavel: ">15% excelente · 10-15% bom · <10% questionável",
    observacao: "Aproximação calculada via média de ROE e ROA (Yahoo não expõe ROIC direto). Para análise fina, consulte relatório de DRE.",
    unidade: "%",
    melhorQuando: "maior",
  },
  margemLiq: {
    nome: "Margem Líquida",
    abrev: "ML",
    formula: "Lucro líquido ÷ Receita líquida",
    interpretacao: "Quanto de cada R$1 de receita vira lucro. Empresas de commodity têm margem baixa (<10%); tech e software têm margem alta (>25%).",
    faixaSaudavel: "Varia por setor. Acima da média do setor é positivo.",
    observacao: "Margem isolada não diz nada — compare sempre com pares do setor. Tendência de crescimento de margem é mais relevante que valor absoluto.",
    unidade: "%",
    melhorQuando: "maior",
  },

  // ═══ Performance ═══
  variacaoAno: {
    nome: "Valorização em 12 meses",
    abrev: "VAL 12M",
    formula: "(Preço atual ÷ Preço de 1 ano atrás) − 1",
    interpretacao: "Quanto a ação valorizou (ou desvalorizou) nos últimos 12 meses. Indica momentum de mercado e força da tendência. Performance forte sustentada sinaliza convicção de capital institucional.",
    faixaSaudavel: ">25% bullish forte · 10-25% saudável · 0-10% lento · <0% em queda",
    observacao: "Valorização alta isolada pode estar 'puxada' ao limite e ter pouca margem. Valorização negativa pode ser oportunidade SE fundamentos seguem bons.",
    unidade: "%",
    melhorQuando: "maior",
  },

  // ═══ Crescimento ═══
  cagrReceita: {
    nome: "CAGR da Receita (3-4 anos)",
    abrev: "CAGR_REC",
    formula: "((Receita atual ÷ Receita de N anos atrás) ^ (1/N)) − 1",
    interpretacao: "Taxa composta de crescimento anual da receita. Peter Lynch buscava 'tenbaggers' com CAGR > 20% sustentado. Crescimento consistente é indicador forte de escalabilidade do negócio.",
    faixaSaudavel: ">15% crescimento forte · 5-15% saudável · <0 em declínio",
    observacao: "Empresas maduras naturalmente crescem menos. Compare com a inflação + PIB do setor.",
    unidade: "%",
    melhorQuando: "maior",
  },
  cagrLucro: {
    nome: "CAGR do Lucro (3-4 anos)",
    abrev: "CAGR_LUCRO",
    formula: "((Lucro atual ÷ Lucro de N anos atrás) ^ (1/N)) − 1",
    interpretacao: "Crescimento composto do lucro. Qualidade > quantidade: crescimento lento mas consistente (>10% sustentável) vale mais que picos explosivos seguidos de queda.",
    faixaSaudavel: ">20% excelente · 10-20% bom · <0 preocupante",
    observacao: "Pode oscilar em anos específicos (eventos não recorrentes). Tendência > valor pontual.",
    unidade: "%",
    melhorQuando: "maior",
  },

  // ═══ Solidez Financeira ═══
  divLiqEbitda: {
    nome: "Dívida Líquida / EBITDA",
    abrev: "DL_EBITDA",
    formula: "(Dívida Total − Caixa) ÷ EBITDA",
    interpretacao: "Quantos anos de geração de caixa são necessários para zerar toda a dívida. Menor = mais segura financeiramente.",
    faixaSaudavel: "<1,0 muito baixo (seguro) · 1-2 confortável · 2-3 alerta · >3,5 crítico",
    observacao: "Bancos e financeiras operam com alavancagem natural; não aplique essa faixa para eles.",
    unidade: "x",
    melhorQuando: "menor",
  },
  cobJuros: {
    nome: "Cobertura de Juros",
    abrev: "COB_JUROS",
    formula: "EBIT ÷ Despesa financeira",
    interpretacao: "Quantas vezes o lucro operacional cobre as despesas com juros. Empresas com cobertura alta suportam bem ciclos de juros elevados.",
    faixaSaudavel: ">5x muito confortável · 2,5-5x ok · <1,5 risco de default",
    observacao: "Queda da cobertura ao longo dos anos é red flag mesmo se ainda está acima de 1.",
    unidade: "x",
    melhorQuando: "maior",
  },

  // ═══ FIIs específicos ═══
  capRate: {
    nome: "Cap Rate",
    abrev: "CAP_RATE",
    formula: "Receita operacional anual ÷ Valor do patrimônio (imóveis)",
    interpretacao: "Retorno bruto dos imóveis do fundo (antes de custos de gestão e dívida). Permite comparar fundos de mesmo tipo.",
    faixaSaudavel: ">10% alto retorno · 7-10% médio · <6% comprimido (caro)",
    observacao: "Cap rate alto pode refletir risco maior (vacância, localização). Verifique também WAULT e inadimplência.",
    unidade: "%",
    melhorQuando: "maior",
  },
  vac: {
    nome: "Vacância",
    abrev: "VAC",
    formula: "Área vaga ÷ Área total locável",
    interpretacao: "Quanto do portfolio não está gerando aluguel. Vacância alta corrói distribuições; ideal é <5% em FIIs de lajes e logística.",
    faixaSaudavel: "<5% excelente · 5-12% razoável · >15% preocupante",
    observacao: "Vacância física ≠ financeira. Alguns fundos reportam só a física (imóveis desocupados) ignorando carências.",
    unidade: "%",
    melhorQuando: "menor",
  },
  wault: {
    nome: "WAULT (Prazo Médio Ponderado dos Contratos)",
    abrev: "WAULT",
    formula: "Média dos prazos restantes dos contratos ponderada pela receita",
    interpretacao: "Quantos anos, em média, faltam para os contratos atuais expirarem. WAULT longo = receita previsível; curto = risco de renegociação em mercado ruim.",
    faixaSaudavel: ">6 anos forte · 3-6 normal · <3 curto prazo",
    observacao: "Contratos atípicos (BTS, sale-leaseback) costumam ter WAULT >10 anos. Típicos seguem 5 anos padrão.",
    unidade: "anos",
    melhorQuando: "maior",
  },
  tipoContrato: {
    nome: "Tipo de Contrato",
    abrev: "TIPO_CONTRATO",
    formula: "Proporção típico (5 anos padrão) vs. atípico (BTS, saldo-revertido)",
    interpretacao: "Contratos atípicos têm reajuste e rescisão mais favoráveis ao fundo. Carteiras com % alto de atípicos têm receita mais protegida.",
    faixaSaudavel: ">50% atípico = perfil defensivo",
    observacao: "Yahoo não expõe esse dado; requer consulta ao informe trimestral do FII.",
    unidade: "%",
    melhorQuando: "maior",
  },
  alav: {
    nome: "Alavancagem Financeira",
    abrev: "ALAV",
    formula: "Dívida bruta do fundo ÷ Patrimônio líquido",
    interpretacao: "FIIs alavancados (via CRIs, Fiagro ou securitização) têm retorno maior em ciclos bons mas risco maior em ciclos ruins.",
    faixaSaudavel: "<20% conservador · 20-40% moderado · >50% agressivo",
    observacao: "Alavancagem é neutra — depende do custo da dívida vs. cap rate dos imóveis.",
    unidade: "%",
    melhorQuando: "menor",
  },
  inad: {
    nome: "Inadimplência",
    abrev: "INAD",
    formula: "Receita de aluguel em atraso ÷ Receita total esperada",
    interpretacao: "Quanto do aluguel previsto não foi recebido. Sinal direto de qualidade dos inquilinos.",
    faixaSaudavel: "<1% excelente · 1-3% normal · >5% risco",
    observacao: "Em ciclos de crise (ex: pandemia), inadimplência sobe sazonalmente.",
    unidade: "%",
    melhorQuando: "menor",
  },
  crescDiv: {
    nome: "Crescimento dos Dividendos (12m)",
    abrev: "CRESC_DIV",
    formula: "Dividendos 12m atuais ÷ Dividendos 12m anteriores − 1",
    interpretacao: "Se o fundo está aumentando ou reduzindo distribuição. Crescimento consistente é sinal de gestão ativa bem executada.",
    faixaSaudavel: ">5% positivo · 0-5% estável · <0 redução (preocupante)",
    observacao: "Distribuição pode ser afetada por eventos não-recorrentes (venda de imóvel, recompra de cotas).",
    unidade: "%",
    melhorQuando: "maior",
  },
  payoutRatio: {
    nome: "Payout",
    abrev: "PAYOUT",
    formula: "Dividendos distribuídos ÷ Lucro líquido (empresas) ou FFO (FIIs)",
    interpretacao: "Percentual do lucro devolvido aos acionistas. FIIs são obrigados a distribuir ≥95% do resultado semestral; empresas têm liberdade.",
    faixaSaudavel: "Empresas: 30-70% sustentável. FIIs: 95-100% obrigatório",
    observacao: "Payout > 100% significa distribuir mais do que gera — insustentável a longo prazo.",
    unidade: "%",
    melhorQuando: "neutro",
  },
};

// Helper: agrupa indicadores por tipo de ativo.
// IMPORTANTE: cada lista mostra apenas indicadores que TÊM fonte de dados.
// Indicadores sem fonte (ex: CAP_RATE, WAULT, TIPO_CONTRATO, INAD, CRESC_DIV
// para FIIs) ficam no GLOSSARIO para fins educacionais mas não na tabela —
// caso contrário o usuário vê apenas N/D em todas as linhas.
export const INDICADORES_ACOES = [
  "pl", "pvp", "evEbitda", "roe", "roicAprox", "margemLiq",
  "cagrReceita", "cagrLucro", "divLiqEbitda", "cobJuros", "dy", "variacaoAno",
];

// FIIs BR: campos efetivamente preenchidos por Yahoo + scrapers (StatusInvest,
// FundsExplorer). capRate/wault/tipoContrato/inad/crescDiv não têm fonte hoje.
export const INDICADORES_FIIS = [
  "dy", "pvp", "vac", "alav", "payoutRatio", "variacaoAno",
];

// REITs (mercado americano): Yahoo expõe os múltiplos típicos de equity. Métricas
// específicas de FII brasileiro (cap rate, vacância em %, WAULT) não vêm.
export const INDICADORES_REITS = [
  "dy", "pvp", "pl", "payoutRatio", "divLiqEbitda", "variacaoAno",
];
