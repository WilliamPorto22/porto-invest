// src/services/scoringEngine.js
// Motor de pontuação multi-guru (Graham, Buffett, Lynch, Bazin, Barsi, Greenblatt, Bastter).
// Recebe um ativo normalizado (ver marketData.js) + classe, devolve:
//   { score, faixa, dimensoes, justificativas, alertas, momentoCompra }
//
// Filosofia:
//  - Cada dimensão (Valor, Qualidade, Crescimento, Dividendos, Momentum) rende 0-20.
//  - Score final 0-100.
//  - "MOMENTO DE COMPRA" exige 5 critérios simultâneos.
//  - Alertas eliminam ativos quando críticos.

// Setores capital-intensivos: alavancagem estrutural alta é normal e saudável
// (concessões longas, utilities reguladas, telecom com capex de 5G, infra etc.).
// Para esses, o threshold de "endividamento crítico" é mais permissivo.
const SETORES_CAPITAL_INTENSIVO = new Set([
  "Saneamento", "Utilities", "Telecom", "Concessões",
  "Petróleo e Gás", "Mineração", "Siderurgia",
  "Logística", "Construção", "Industrial",
]);

// ═════════════════════════════════════════════════════════
// Scoring por faixa (helpers)
// ═════════════════════════════════════════════════════════
function pontuarFaixa(valor, faixas) {
  if (valor == null || !isFinite(valor)) return { nota: 0, comentario: "Sem dado" };
  for (const f of faixas) {
    if (valor >= f.min && valor <= f.max) return { nota: f.nota, comentario: f.msg };
  }
  return { nota: 0, comentario: "Fora da faixa" };
}

// ═════════════════════════════════════════════════════════
// Faixas por classe de ativo (valores aproximados / didáticos)
// ═════════════════════════════════════════════════════════
const FAIXAS = {
  acoesBR: {
    pl:  [ { min: 0, max: 8, nota: 20, msg: "P/L muito baixo (Graham)" },
           { min: 8, max: 12, nota: 16, msg: "P/L atraente" },
           { min: 12, max: 18, nota: 10, msg: "P/L neutro" },
           { min: 18, max: 25, nota: 5, msg: "P/L esticado" },
           { min: 25, max: 999, nota: 0, msg: "P/L caro" } ],
    pvp: [ { min: 0, max: 1, nota: 20, msg: "P/VP < 1 (Graham)" },
           { min: 1, max: 1.5, nota: 15, msg: "P/VP saudável" },
           { min: 1.5, max: 2.5, nota: 8, msg: "P/VP neutro" },
           { min: 2.5, max: 999, nota: 0, msg: "P/VP elevado" } ],
    dy:  [ { min: 6, max: 99, nota: 20, msg: "DY > 6% (Bazin/Barsi)" },
           { min: 4, max: 6, nota: 15, msg: "DY atrativo" },
           { min: 2, max: 4, nota: 8, msg: "DY mediano" },
           { min: 0, max: 2, nota: 3, msg: "DY baixo" } ],
    roe: [ { min: 20, max: 999, nota: 20, msg: "ROE > 20% (Buffett)" },
           { min: 15, max: 20, nota: 15, msg: "ROE saudável" },
           { min: 10, max: 15, nota: 8, msg: "ROE mediano" },
           { min: 0, max: 10, nota: 3, msg: "ROE baixo" } ],
  },
  fiis: {
    pvp: [ { min: 0, max: 0.85, nota: 20, msg: "P/VP < 0,85 (comprando desconto)" },
           { min: 0.85, max: 1, nota: 16, msg: "P/VP abaixo do VP" },
           { min: 1, max: 1.1, nota: 10, msg: "P/VP justo" },
           { min: 1.1, max: 999, nota: 3, msg: "P/VP pago acima do VP" } ],
    dy:  [ { min: 12, max: 99, nota: 20, msg: "DY > 12% (excepcional)" },
           { min: 9, max: 12, nota: 16, msg: "DY forte" },
           { min: 7, max: 9, nota: 10, msg: "DY na média" },
           { min: 0, max: 7, nota: 4, msg: "DY abaixo da média" } ],
  },
  acoesUS: {
    pl:  [ { min: 0, max: 10, nota: 20, msg: "P/E muito baixo" },
           { min: 10, max: 15, nota: 16, msg: "P/E atraente" },
           { min: 15, max: 22, nota: 10, msg: "P/E neutro" },
           { min: 22, max: 30, nota: 5, msg: "P/E esticado" },
           { min: 30, max: 999, nota: 0, msg: "P/E caro" } ],
    pvp: [ { min: 0, max: 1.5, nota: 20, msg: "P/B baixo" },
           { min: 1.5, max: 3, nota: 14, msg: "P/B saudável" },
           { min: 3, max: 5, nota: 7, msg: "P/B neutro" },
           { min: 5, max: 999, nota: 0, msg: "P/B caro" } ],
    dy:  [ { min: 3, max: 99, nota: 15, msg: "Dividend yield forte" },
           { min: 1.5, max: 3, nota: 10, msg: "Dividend yield OK" },
           { min: 0, max: 1.5, nota: 4, msg: "Dividend yield baixo" } ],
  },
  reits: {
    dy:  [ { min: 6, max: 99, nota: 20, msg: "DY > 6%" },
           { min: 4, max: 6, nota: 14, msg: "DY saudável" },
           { min: 2, max: 4, nota: 7, msg: "DY mediano" },
           { min: 0, max: 2, nota: 2, msg: "DY baixo" } ],
    pvp: [ { min: 0, max: 1.2, nota: 18, msg: "P/NAV razoável" },
           { min: 1.2, max: 2, nota: 10, msg: "P/NAV neutro" },
           { min: 2, max: 999, nota: 3, msg: "P/NAV elevado" } ],
  },
};

// Faixa de momentum (posição do preço vs min/max 52 semanas — Lynch)
function pontuarMomentum(ativo) {
  const { preco, min52, max52, variacaoSemana } = ativo;
  if (!preco || !min52 || !max52) return { nota: 10, comentario: "Momentum N/D" };
  const range = max52 - min52;
  if (range <= 0) return { nota: 10, comentario: "Momentum N/D" };
  const pos = (preco - min52) / range; // 0 = fundo, 1 = topo

  let nota, msg;
  if (pos < 0.25) { nota = 20; msg = "Próximo do mínimo de 52 semanas (fundo)"; }
  else if (pos < 0.5) { nota = 16; msg = "Abaixo da média do intervalo anual"; }
  else if (pos < 0.75) { nota = 10; msg = "Na média do intervalo anual"; }
  else if (pos < 0.9) { nota = 5; msg = "Próximo do topo de 52 semanas"; }
  else { nota = 0; msg = "Comprando topo (risco elevado)"; }

  // Penalidade leve se variação semanal for muito positiva (topo quente)
  if (variacaoSemana != null && variacaoSemana > 8) nota = Math.max(0, nota - 3);

  return { nota, comentario: msg, posicao: pos };
}

// ═════════════════════════════════════════════════════════
// Pontuação principal
// ═════════════════════════════════════════════════════════
export function pontuarAtivo(ativo, classe) {
  const faixas = FAIXAS[classe] || {};
  const justificativas = [];
  const alertas = [];

  // === Valor (0-20) ===
  let notaValor = 0, contadorValor = 0;
  if (faixas.pl && ativo.pl != null) {
    const p = pontuarFaixa(ativo.pl, faixas.pl);
    justificativas.push(`P/L ${fmtNum(ativo.pl)}: ${p.comentario}`);
    notaValor += p.nota; contadorValor++;
  }
  if (faixas.pvp && ativo.pvp != null) {
    const p = pontuarFaixa(ativo.pvp, faixas.pvp);
    justificativas.push(`P/VP ${fmtNum(ativo.pvp)}: ${p.comentario}`);
    notaValor += p.nota; contadorValor++;
  }
  const valor = contadorValor ? notaValor / contadorValor : 10;

  // === Qualidade (0-20) ===
  let qualidade = 10;
  if (faixas.roe && ativo.roe != null) {
    const roePct = ativo.roe > 1 ? ativo.roe : ativo.roe * 100; // brapi às vezes devolve em decimal
    const p = pontuarFaixa(roePct, faixas.roe);
    justificativas.push(`ROE ${fmtNum(roePct)}%: ${p.comentario}`);
    qualidade = p.nota;
  }
  // (alerta de Dív.Líq/EBITDA é avaliado pós-score — ver bloco abaixo após calcular `score`)

  // === Dividendos (0-20) ===
  let dividendos = 10;
  if (faixas.dy && ativo.dy != null) {
    const p = pontuarFaixa(ativo.dy, faixas.dy);
    justificativas.push(`DY ${fmtNum(ativo.dy)}%: ${p.comentario}`);
    dividendos = p.nota;
  }

  // === Crescimento (0-20) — variação 12 meses ===
  let crescimento = 10;
  if (ativo.variacaoAno != null) {
    const v = ativo.variacaoAno;
    if (v > 25) { crescimento = 18; justificativas.push(`+${fmtNum(v)}% em 12 meses — momentum forte`); }
    else if (v > 10) { crescimento = 14; justificativas.push(`+${fmtNum(v)}% em 12 meses — saudável`); }
    else if (v > 0) { crescimento = 10; justificativas.push(`+${fmtNum(v)}% em 12 meses`); }
    else if (v > -15) { crescimento = 6; justificativas.push(`${fmtNum(v)}% em 12 meses — em queda`); }
    else { crescimento = 2; justificativas.push(`${fmtNum(v)}% em 12 meses — queda forte`); alertas.push({ tipo: "atencao", msg: "Ação em queda > 15% em 12 meses" }); }
  }

  // === Momentum (0-20) — posição no range 52 semanas ===
  const mom = pontuarMomentum(ativo);
  justificativas.push(mom.comentario);

  // === Score final ===
  const score = Math.round(valor + qualidade + dividendos + crescimento + mom.nota);
  const faixa = score >= 80 ? "Excelente" : score >= 65 ? "Boa" : score >= 50 ? "Neutra" : score >= 35 ? "Fraca" : "Evitar";

  // === Endividamento (avaliado pós-score para ponderar contexto) ===
  // Threshold setorial: setores capital-intensivos (concessões, utilities, telecom etc.)
  // convivem bem com Dív/EBITDA estrutural mais alto. Para virar "crítico" exigimos
  // alavancagem realmente alta E score já fraco (<60) — evita marcar empresas
  // de qualidade como críticas só por carregarem dívida estruturada.
  if (ativo.divLiqEbitda != null) {
    const ehCapIntensivo = SETORES_CAPITAL_INTENSIVO.has(ativo.setor || "");
    const limiteCritico = ehCapIntensivo ? 5.5 : 4;
    const dle = ativo.divLiqEbitda;
    if (dle > limiteCritico && score < 60) {
      alertas.push({ tipo: "critico", msg: `Dív.Líq/EBITDA ${fmtNum(dle)} + score ${score}/100 — endividamento alto em empresa fraca` });
    } else if (dle > 2) {
      alertas.push({ tipo: "atencao", msg: `Dív.Líq/EBITDA ${fmtNum(dle)} — monitorar alavancagem` });
    }
  }

  // === MOMENTO DE COMPRA — 5 critérios ===
  const criticos = alertas.filter((a) => a.tipo === "critico").length;
  const precoAbaixoValorJusto = (ativo.pvp != null && ativo.pvp < 1.3) || (ativo.pl != null && ativo.pl < 12);
  const valuationBaixo = (ativo.pl != null && ativo.pl < 15) || (ativo.pvp != null && ativo.pvp < 1.5) || (ativo.dy != null && ativo.dy > 5);
  const naoCompraTopo = mom.posicao == null || mom.posicao < 0.85;

  const momentoCompra = score >= 70 && precoAbaixoValorJusto && valuationBaixo && criticos === 0 && naoCompraTopo;

  // === SINAL DE VENDA / SAIR ===
  // Regra única: só marca venda se score < 50 (faixa Fraca ou Evitar).
  // Empresas com score >= 50 podem ter pontos negativos isolados, mas no agregado
  // o ativo ainda não justifica recomendação de saída — fica como neutro.
  const valuationAlto =
    (ativo.pl != null && ativo.pl > 25) ||
    (ativo.pvp != null && ativo.pvp > 3) ||
    (ativo.dy != null && ativo.dy < 1.5);
  const compraTopo = mom.posicao != null && mom.posicao > 0.9;
  const quedaForte = ativo.variacaoAno != null && ativo.variacaoAno < -15;
  const sinalVenda = score < 50;

  // === Críticas / razões específicas de venda ===
  // Lista detalhada — cada item traz o dado + interpretação + consequência.
  // Simétrica ao "pontosFortes" para dar base de decisão comparativa.
  const criticasVenda = [];

  // Contexto sempre presente quando há sinal de venda: resumo das dimensões fracas
  if (sinalVenda) {
    const dimsFracas = [];
    if (valor < 10) dimsFracas.push(`Valor ${Math.round(valor)}/20`);
    if (qualidade < 10) dimsFracas.push(`Qualidade ${Math.round(qualidade)}/20`);
    if (dividendos < 10) dimsFracas.push(`Dividendos ${Math.round(dividendos)}/20`);
    if (crescimento < 10) dimsFracas.push(`Crescimento ${Math.round(crescimento)}/20`);
    if (mom.nota < 10) dimsFracas.push(`Momentum ${Math.round(mom.nota)}/20`);
    if (dimsFracas.length >= 3) {
      criticasVenda.push(`Dimensões abaixo da média: ${dimsFracas.join(", ")}. Múltiplas áreas fracas simultâneas é sinal clássico de deterioração estrutural.`);
    }

    // Liquidez/volume baixo
    if (ativo.volume != null && ativo.volume < 100000) {
      criticasVenda.push(`Volume diário baixo (${formatarVolume(ativo.volume)}) — baixa liquidez dificulta saída em momentos de estresse. Sair pode exigir aceitar desconto no preço.`);
    }

    // Distância do máximo 52 semanas (para momentum)
    if (ativo.preco && ativo.max52) {
      const gap = ((ativo.max52 - ativo.preco) / ativo.max52) * 100;
      if (gap > 25) {
        criticasVenda.push(`Preço está ${gap.toFixed(0)}% abaixo do máximo de 52 semanas (R$ ${ativo.max52.toFixed(2)}). Recuperação exige reversão fundamental; manter posição é apostar em turnaround.`);
      }
    }
    // Valuation caro
    if (ativo.pl != null && ativo.pl > 30) {
      criticasVenda.push(`P/L ${fmtNum(ativo.pl)} muito elevado — mercado paga mais de 30 anos de lucro. Requer crescimento excepcional para justificar; margem de segurança baixíssima.`);
    } else if (ativo.pl != null && ativo.pl > 22) {
      criticasVenda.push(`P/L ${fmtNum(ativo.pl)} esticado — acima da média histórica do mercado. Qualquer desaceleração de lucro tende a derrubar o preço.`);
    }
    if (ativo.pvp != null && ativo.pvp > 4) {
      criticasVenda.push(`P/VP ${fmtNum(ativo.pvp)} — paga-se mais de 4× o patrimônio líquido. Só faz sentido se ROE for excepcional (>25%) e sustentado.`);
    } else if (ativo.pvp != null && ativo.pvp > 3) {
      criticasVenda.push(`P/VP ${fmtNum(ativo.pvp)} — valuation estressado vs. patrimônio. Bazin/Graham evitariam.`);
    }

    // Dividendos fracos
    if (ativo.dy != null && ativo.dy < 1) {
      criticasVenda.push(`DY ${fmtNum(ativo.dy)}% — quase zero. A empresa não devolve caixa ao acionista; dependência total de valorização de preço para retorno.`);
    } else if (ativo.dy != null && ativo.dy < 2) {
      criticasVenda.push(`DY ${fmtNum(ativo.dy)}% — dividendo baixo. Para Barsi/Bazin, ação não passa no filtro de renda (mínimo 6%).`);
    }

    // Momentum / topo
    if (compraTopo) {
      const pctTopo = ((mom.posicao || 0) * 100).toFixed(0);
      criticasVenda.push(`Preço no topo de 52 semanas (${pctTopo}% do range Mín–Máx). Risco elevado de correção técnica; compradores de Lynch evitariam entrada aqui.`);
    } else if (mom.posicao != null && mom.posicao > 0.75) {
      const pctTopo = (mom.posicao * 100).toFixed(0);
      criticasVenda.push(`Preço próximo ao topo (${pctTopo}% do range 52s). Ganhos adicionais exigem continuação da alta; risco/retorno desfavorável para entrada nova.`);
    }

    // Queda forte / tendência bearish
    if (quedaForte) {
      criticasVenda.push(`${fmtNum(ativo.variacaoAno)}% em 12 meses — tendência bearish confirmada. Quedas >15% sustentadas geralmente refletem deterioração de fundamentos ou setor em crise.`);
    } else if (ativo.variacaoAno != null && ativo.variacaoAno < -8) {
      criticasVenda.push(`${fmtNum(ativo.variacaoAno)}% em 12 meses — underperformance vs. IBOV/S&P 500. Verificar se é momento de setor ou problema específico da empresa.`);
    }

    // Endividamento
    if (ativo.divLiqEbitda != null && ativo.divLiqEbitda > 4) {
      criticasVenda.push(`Dív.Líq/EBITDA ${fmtNum(ativo.divLiqEbitda)} — endividamento muito alto. Empresa gasta 4+ anos de geração de caixa só para zerar dívida; risco de refinanciamento em ciclos de juros altos.`);
    } else if (ativo.divLiqEbitda != null && ativo.divLiqEbitda > 2.5) {
      criticasVenda.push(`Dív.Líq/EBITDA ${fmtNum(ativo.divLiqEbitda)} — alavancagem acima do confortável. Monitorar geração de caixa operacional.`);
    }

    // ROE baixo
    if (ativo.roe != null) {
      const roePct = ativo.roe > 1 ? ativo.roe : ativo.roe * 100;
      if (roePct < 8 && roePct > 0) {
        criticasVenda.push(`ROE ${fmtNum(roePct)}% baixo — rentabilidade sobre patrimônio abaixo da Selic. Dinheiro em renda fixa renderia mais sem risco de ação.`);
      }
    }

    // Alertas críticos agregados
    if (criticos > 0) {
      criticasVenda.push(`${criticos} alerta${criticos > 1 ? "s" : ""} crítico${criticos > 1 ? "s" : ""} ativo${criticos > 1 ? "s" : ""} — ver seção "Alertas" ao lado. Requer análise profunda antes de manter posição.`);
    }

    // Score geral
    if (score < 35) {
      criticasVenda.push(`Score global ${score}/100 (faixa Evitar) — combinação de múltiplos fracos em Valor, Qualidade e Momentum simultaneamente. Desfavorecido em todas dimensões.`);
    } else if (score < 50) {
      criticasVenda.push(`Score global ${score}/100 (faixa Fraca) — não atinge threshold mínimo para posição de qualidade. Melhor alocar capital em ativos com score ≥ 65.`);
    } else if (score < 60) {
      criticasVenda.push(`Score global ${score}/100 (faixa Neutra baixa) — ativo não se destaca em nenhuma dimensão crítica. Capital produziria melhor retorno em ativos melhor avaliados.`);
    }

    // Recomendação tática (sempre presente como orientação final)
    criticasVenda.push(
      `Recomendação tática: reduzir/rotacionar posição para ativos com P/L menor, DY maior ou ambos — ` +
      `consulte a aba "Oportunidades por classe de ativo" em /mercado para alternativas com score ≥ 65 no mesmo setor.`
    );

    // Fallback se chegou aqui sem nenhuma crítica (não deve acontecer)
    if (criticasVenda.length === 0) {
      criticasVenda.push(`Score ${score}/100 abaixo do mínimo aceitável para manter posição. Analisar fundamentos específicos e contexto setorial antes de decidir.`);
    }
  }

  // === Pontos fortes — razões para comprar ===
  // Cada ponto trás: dado concreto + interpretação com referência a um guru.
  const pontosFortes = [];

  // Valor (Graham / Buffett)
  if (ativo.pl != null && ativo.pl > 0) {
    if (ativo.pl < 8) {
      pontosFortes.push(`P/L ${fmtNum(ativo.pl)} — múltiplo muito baixo (Graham). Mercado paga menos de 8 anos de lucro, margem de segurança ampla.`);
    } else if (ativo.pl < 12) {
      pontosFortes.push(`P/L ${fmtNum(ativo.pl)} — valuation atrativo. Comprando barato em termos de lucro atual.`);
    }
  }
  if (ativo.pvp != null) {
    if (ativo.pvp < 1) {
      pontosFortes.push(`P/VP ${fmtNum(ativo.pvp)} — abaixo de 1, critério clássico de Graham. Paga-se menos que o patrimônio líquido contábil da empresa.`);
    } else if (ativo.pvp < 1.5) {
      pontosFortes.push(`P/VP ${fmtNum(ativo.pvp)} — comprando próximo ao patrimônio, dentro do limite conservador de Bazin.`);
    }
  }

  // Qualidade (Buffett)
  if (ativo.roe != null) {
    const roePct = ativo.roe > 1 ? ativo.roe : ativo.roe * 100;
    if (roePct > 20) {
      pontosFortes.push(`ROE ${fmtNum(roePct)}% — excelente (Buffett exigia >15%). Empresa reinveste capital gerando retorno muito acima do custo de capital.`);
    } else if (roePct > 15) {
      pontosFortes.push(`ROE ${fmtNum(roePct)}% — rentabilidade sobre patrimônio acima da média. Gestão eficiente em gerar valor.`);
    }
  }
  if (ativo.divLiqEbitda != null && ativo.divLiqEbitda < 1) {
    pontosFortes.push(`Dív.Líq/EBITDA ${fmtNum(ativo.divLiqEbitda)} — balanço sólido, dívida pequena relativa à geração de caixa.`);
  }

  // Dividendos (Bazin / Barsi)
  if (ativo.dy != null) {
    if (ativo.dy > 8) {
      pontosFortes.push(`DY ${fmtNum(ativo.dy)}% — dividendo excepcional. Decio Bazin compraria com DY > 6%; aqui já paga o valor de volta em ~12 anos.`);
    } else if (ativo.dy > 5) {
      pontosFortes.push(`DY ${fmtNum(ativo.dy)}% — dividendo forte, ação "caixa preta" de Barsi. Bom para renda passiva.`);
    }
  }

  // Momentum (Lynch)
  if (mom.posicao != null) {
    if (mom.posicao < 0.25) {
      pontosFortes.push(`Preço a ${(mom.posicao * 100).toFixed(0)}% do range de 52s (perto do mínimo) — Peter Lynch chamava de "bottom fishing" quando fundamentos estão OK.`);
    } else if (mom.posicao < 0.4) {
      pontosFortes.push(`Preço na metade inferior do range de 52s — entrada sem pagar prêmio de topo histórico.`);
    }
  }
  if (ativo.variacaoAno != null && ativo.variacaoAno > 25) {
    pontosFortes.push(`+${fmtNum(ativo.variacaoAno)}% em 12 meses — tendência bullish forte, capital institucional provavelmente posicionado.`);
  }

  // Crescimento + Momentum combinados
  if (ativo.variacaoAno != null && ativo.variacaoAno > 10 && mom.posicao != null && mom.posicao < 0.6) {
    pontosFortes.push(`Tendência positiva (+${fmtNum(ativo.variacaoAno)}% em 12m) SEM estar no topo — combinação favorável de valorização + margem ainda disponível.`);
  }

  return {
    score,
    faixa,
    dimensoes: {
      valor: Math.round(valor),
      qualidade: Math.round(qualidade),
      dividendos: Math.round(dividendos),
      crescimento: Math.round(crescimento),
      momentum: Math.round(mom.nota),
    },
    justificativas,
    alertas,
    momentoCompra,
    sinalVenda,
    criticasVenda,
    pontosFortes,
  };
}

// ═════════════════════════════════════════════════════════
// Ranking + enriquecimento
// ═════════════════════════════════════════════════════════
/**
 * Rankeia por score. Sempre retorna `top` itens se o universo tiver esse tanto —
 * itens com dados parciais ainda entram, só com score menor.
 */
export function rankearPorScore(ativos, classe, { top = 15 } = {}) {
  const enriquecidos = ativos.map((a) => ({ ...a, analise: pontuarAtivo(a, classe) }));
  // ordena: primeiro por presença de preço (com preço antes), depois por score desc
  enriquecidos.sort((a, b) => {
    const aHasPrice = a.preco != null ? 1 : 0;
    const bHasPrice = b.preco != null ? 1 : 0;
    if (aHasPrice !== bHasPrice) return bHasPrice - aHasPrice;
    return (b.analise?.score || 0) - (a.analise?.score || 0);
  });
  return enriquecidos.slice(0, top);
}

function fmtNum(v) {
  if (v == null || !isFinite(v)) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatarVolume(v) {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(v);
}
