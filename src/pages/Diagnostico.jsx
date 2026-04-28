import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../hooks/useAuth";
import { T, C } from "../theme";
import { AvatarIcon } from "./Dashboard";
import { parseCentavos, brl as moedaFull, formatMi } from "../utils/currency";

// ── Helpers ──
function calcularIdade(nasc) {
  if(!nasc) return null;
  if(/^\d{1,3}$/.test(nasc)) return parseInt(nasc);
  const p = String(nasc).split("/");
  if(p.length<3) return null;
  const d = new Date(`${p[2]}-${p[1]}-${p[0]}`);
  if(isNaN(d)) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear()-d.getFullYear();
  const m = hoje.getMonth()-d.getMonth();
  if(m<0||(m===0&&hoje.getDate()<d.getDate())) idade--;
  return idade>0&&idade<120 ? idade : null;
}

// Ranges de faixa usadas no cadastro (para estimar valor de imóveis/veículos)
const FAIXAS_IMOVEL_MIDS = {};
[...Array.from({length:50},(_,i)=>(i+1)*100000),5500000,6000000,7000000,8000000,9000000,10000000,12000000].forEach(v=>{
  const label = v===12000000?"Acima de R$ 10M":`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  FAIXAS_IMOVEL_MIDS[label]=v;
});
const FAIXAS_VEICULO_MIDS = {};
[...Array.from({length:50},(_,i)=>(i+1)*10000),600000,700000,800000,900000,1000000,1200000].forEach(v=>{
  const label = v===1200000?"Acima de R$ 1M":`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  FAIXAS_VEICULO_MIDS[label]=v;
});

function totalImoveisCalc(imoveis) {
  return (imoveis||[]).reduce((acc,im)=>{
    const mid = FAIXAS_IMOVEL_MIDS[im.faixa]||0;
    const qtd = Math.max(parseInt(im.quantidade)||1,1);
    return acc+mid*qtd;
  },0);
}
function totalVeiculosCalc(veiculos) {
  return (veiculos||[]).reduce((acc,v)=>{
    const mid = FAIXAS_VEICULO_MIDS[v.faixa]||0;
    const qtd = Math.max(parseInt(v.quantidade)||1,1);
    return acc+mid*qtd;
  },0);
}

// Projeção financeira: patrimônio futuro com aporte mensal e rentabilidade real
// P_futuro = P*(1+r)^n + PMT*[((1+r)^n - 1)/r]  (mensal)
function projetarPatrimonio(inicial, aporteMensal, rentAnualPct, anos) {
  const r = rentAnualPct/100;
  const rMensal = Math.pow(1+r, 1/12)-1;
  const meses = anos*12;
  if(rMensal===0) return inicial + aporteMensal*meses;
  const fv = inicial*Math.pow(1+rMensal,meses) + aporteMensal*((Math.pow(1+rMensal,meses)-1)/rMensal);
  return fv;
}

// Quantos anos para atingir patrimônio-alvo (magic number)
function anosParaAtingir(inicial, aporteMensal, rentAnualPct, alvo) {
  if(alvo<=inicial) return 0;
  const r = rentAnualPct/100;
  const rMensal = Math.pow(1+r,1/12)-1;
  for(let mes=1; mes<=50*12; mes++) {
    const fv = rMensal===0
      ? inicial + aporteMensal*mes
      : inicial*Math.pow(1+rMensal,mes) + aporteMensal*((Math.pow(1+rMensal,mes)-1)/rMensal);
    if(fv>=alvo) return Math.round((mes/12)*10)/10;
  }
  return null;
}

const noEdit = {userSelect:"none",WebkitUserSelect:"none",cursor:"default"};

const NIVEIS = {
  alto:  {cor:"#ef4444",bg:"rgba(239,68,68,0.08)",borda:"rgba(239,68,68,0.28)",label:"ALTA PRIORIDADE"},
  medio: {cor:"#f59e0b",bg:"rgba(245,158,11,0.08)",borda:"rgba(245,158,11,0.28)",label:"ATENÇÃO"},
  baixo: {cor:"#22c55e",bg:"rgba(34,197,94,0.08)",borda:"rgba(34,197,94,0.28)",label:"OPORTUNIDADE"},
  info:  {cor:"#60a5fa",bg:"rgba(96,165,250,0.08)",borda:"rgba(96,165,250,0.28)",label:"INSIGHT"},
};

// ── Motor completo de análise ──
function analisar(cliente) {
  const salario = parseCentavos(cliente.salarioMensal)/100;
  const gastos = parseCentavos(cliente.gastosMensaisManual)/100;
  const aporteMedio = parseCentavos(cliente.aporteMedio)/100;
  const metaAporte = parseCentavos(cliente.metaAporteMensal)/100;
  const patrimonioManual = parseCentavos(cliente.patrimonio)/100;
  const liquidezDiaria = parseCentavos(cliente.liquidezDiaria)/100;
  const rentAnual = parseFloat(String(cliente.rentabilidadeAnual||"").replace(",","."))||0;

  const imoveis = cliente.imoveis||[];
  const veiculos = cliente.veiculos||[];
  const objetivos = cliente.objetivosInteresse||[];
  const filhos = cliente.filhos||[];
  const estadoCivil = cliente.estadoCivil;
  const foco = cliente.focoInvestimento;
  const modeloAtend = cliente.modeloAtendimento;
  const idade = calcularIdade(cliente.nascimento);

  const valorImoveis = totalImoveisCalc(imoveis);
  const valorVeiculos = totalVeiculosCalc(veiculos);
  const patrimonioFinanceiro = patrimonioManual;
  const patrimonioTotal = patrimonioFinanceiro + valorImoveis + valorVeiculos;

  // Sobra mensal
  const sobra = salario>0&&gastos>0?salario-gastos:0;
  const pctSobra = salario>0?(sobra/salario)*100:0;

  // Reserva ideal (6x gastos)
  const reservaIdeal = gastos*6;

  // Magic Number (regra dos 4% — Bengen/Trinity): gastos anuais × 25
  // Para Brasil, uso 5% ao ano real (conservador) → ×20
  const gastoAnual = (gastos||salario*0.7)*12;
  const magicNumber = gastoAnual*20; // regra 5% real
  const pctLiberdade = magicNumber>0?Math.min((patrimonioFinanceiro/magicNumber)*100,100):0;

  // Projeção aposentadoria
  const rentProj = rentAnual>0?rentAnual:10; // default 10% a.a.
  const rentReal = Math.max(rentProj-4, 2); // descontar inflação ~4%
  const aporteUsado = aporteMedio>0?aporteMedio:metaAporte>0?metaAporte:0;
  const idadeDesejadaAposentar = 60; // padrão
  const anosAte60 = idade?Math.max(idadeDesejadaAposentar-idade, 3):null;
  const patAos60 = anosAte60?projetarPatrimonio(patrimonioFinanceiro, aporteUsado, rentReal, anosAte60):0;
  const rendaPassivaAos60 = patAos60*0.05/12; // 5% a.a. real ÷ 12 = renda mensal
  const anosParaLiberdade = aporteUsado>0?anosParaAtingir(patrimonioFinanceiro, aporteUsado, rentReal, magicNumber):null;
  const idadeLiberdade = idade&&anosParaLiberdade?idade+anosParaLiberdade:null;

  // Distribuição patrimonial
  const distribuicao = [
    {label:"Financeiro",valor:patrimonioFinanceiro,cor:"#F0A202"},
    {label:"Imóveis",valor:valorImoveis,cor:"#22c55e"},
    {label:"Veículos",valor:valorVeiculos,cor:"#60a5fa"},
  ].filter(d=>d.valor>0);
  const pctImoveisTotal = patrimonioTotal>0?(valorImoveis/patrimonioTotal)*100:0;

  // Proteção — cálculo de cobertura
  const temSeguroCarro = veiculos.some(v=>v.temSeguro===true);
  const carrosSemSeguro = veiculos.filter(v=>v.temSeguro===false).length;
  const temFilhosDep = filhos.length>0;
  const temConjuge = estadoCivil==="Casado(a)"||estadoCivil==="União Estável";
  // Se o cliente informou liquidez diária, usamos ela como proxy de reserva; caso contrário, pat. financeiro
  const reservaAtual = liquidezDiaria>0?liquidezDiaria:patrimonioFinanceiro;
  const mesesCobertos = gastos>0?reservaAtual/gastos:0;
  // Dependentes → precisa de seguro e sucessão
  const temDependentes = temConjuge||temFilhosDep;
  const temSeguroVidaFlag = cliente.temSeguroVida===true;
  const temPlanoSucessorioFlag = cliente.temPlanoSucessorio===true;
  const temPrevidenciaFlag = cliente.temPrevidencia===true;
  const protecoes = {
    reserva: reservaAtual>=reservaIdeal&&reservaIdeal>0,
    seguroCarro: veiculos.length===0||temSeguroCarro,
    // Se não tem dependentes, seguro de vida é opcional; se tem, depende do que marcou
    seguroVida: !temDependentes ? true : temSeguroVidaFlag,
    previdencia: temPrevidenciaFlag,
    // Se não há dependentes E patrimônio pequeno → ok; caso contrário, depende do que marcou
    sucessao: (!temDependentes && patrimonioTotal<500000) || temPlanoSucessorioFlag,
  };

  // ═══ SCORE FINANCEIRO ═══ (0-100 com sub-notas)
  // 1. Fluxo (0-25): sobra saudável + capacidade
  let scoreFluxo = 0;
  if(pctSobra>=30) scoreFluxo=25;
  else if(pctSobra>=20) scoreFluxo=22;
  else if(pctSobra>=10) scoreFluxo=15;
  else if(pctSobra>0) scoreFluxo=8;
  else scoreFluxo=0;

  // 2. Reserva (0-20) — usa liquidez diária se informada
  let scoreReserva = 0;
  if(reservaIdeal>0) {
    const rPct = reservaAtual/reservaIdeal;
    scoreReserva = Math.min(rPct*20, 20);
  } else if(reservaAtual>0) scoreReserva = 10;

  // 3. Investimentos (0-25): rentabilidade + diversificação + patrimônio
  let scoreInvest = 0;
  if(rentAnual>=11) scoreInvest+=12;
  else if(rentAnual>=9) scoreInvest+=9;
  else if(rentAnual>=7) scoreInvest+=6;
  else if(rentAnual>0) scoreInvest+=3;
  if(patrimonioFinanceiro>=500000) scoreInvest+=8;
  else if(patrimonioFinanceiro>=100000) scoreInvest+=5;
  else if(patrimonioFinanceiro>0) scoreInvest+=2;
  if(foco) scoreInvest+=5;

  // 4. Proteção (0-15)
  let scoreProt = 0;
  if(protecoes.reserva) scoreProt+=4;
  if(protecoes.seguroCarro) scoreProt+=3;
  if(protecoes.seguroVida) scoreProt+=3;
  if(protecoes.sucessao) scoreProt+=3;
  if(protecoes.previdencia) scoreProt+=2;

  // 5. Objetivos e planejamento (0-15)
  let scorePlan = 0;
  if(objetivos.length>=4) scorePlan+=8;
  else if(objetivos.length>=2) scorePlan+=5;
  else if(objetivos.length>=1) scorePlan+=3;
  if(metaAporte>0) scorePlan+=4;
  if(modeloAtend==="Fee Based") scorePlan+=3;

  const scoreTotal = Math.round(scoreFluxo+scoreReserva+scoreInvest+scoreProt+scorePlan);
  const scores = [
    {label:"Organização de Fluxo",valor:Math.round(scoreFluxo),max:25,cor:"#F0A202",desc:"Sobra mensal vs renda"},
    {label:"Reserva de Emergência",valor:Math.round(scoreReserva),max:20,cor:"#22c55e",desc:"6x gastos em liquidez"},
    {label:"Investimentos",valor:Math.round(scoreInvest),max:25,cor:"#60a5fa",desc:"Rentabilidade + patrimônio + foco"},
    {label:"Proteção Patrimonial",valor:Math.round(scoreProt),max:15,cor:"#a78bfa",desc:"Seguros + sucessão + reserva"},
    {label:"Planejamento",valor:Math.round(scorePlan),max:15,cor:"#ec4899",desc:"Objetivos definidos + metas + modelo"},
  ];

  // ═══ INSIGHTS (ricos, com números) ═══
  const insights = [];

  if(salario>0&&gastos>0) {
    if(sobra<0) {
      insights.push({nivel:"alto",icon:"⚠️",titulo:"Você gasta mais do que ganha",
        texto:`Seus gastos (${moedaFull(gastos)}) são maiores que sua renda (${moedaFull(salario)}). Está faltando ${moedaFull(Math.abs(sobra))} por mês. Antes de investir, é preciso arrumar o orçamento. Quando olhamos com atenção, quase sempre dá pra economizar entre 15% e 25%.`,
        cta:"Reunião de reorganização de fluxo (45 min).",
      });
    } else if(pctSobra<10) {
      insights.push({nivel:"medio",icon:"📉",titulo:"Você está guardando pouco",
        texto:`Você guarda ${pctSobra.toFixed(1)}% da sua renda (${moedaFull(sobra)} por mês). O ideal é guardar entre 20% e 30%. Se conseguir guardar só 5% a mais, em 10 anos isso vira quase ${moedaFull(salario*0.05*12*10*1.5)} a mais no seu patrimônio.`,
        cta:"Revisão de gastos com metodologia 50/30/20.",
      });
    } else if(pctSobra>=20) {
      const patProj10 = projetarPatrimonio(patrimonioFinanceiro, sobra*0.9, rentReal, 10);
      insights.push({nivel:"baixo",icon:"💪",titulo:"Você consegue guardar bem",
        texto:`Você pode investir ${moedaFull(sobra)} por mês (${pctSobra.toFixed(0)}% da sua renda). Se mantiver 90% disso investido por 10 anos, rendendo ${rentReal.toFixed(1)}% ao ano acima da inflação, você chega a ${moedaFull(patProj10)}. É uma base excelente.`,
        cta:"Estruturar aporte automático e carteira otimizada.",
      });
    }
  }

  if(gastos>0&&reservaAtual<reservaIdeal&&reservaAtual>=0) {
    const falta = reservaIdeal-reservaAtual;
    const mesesParaReserva = sobra>0?Math.ceil(falta/sobra):null;
    const nivel = mesesCobertos<3?"alto":"medio";
    const corpo = liquidezDiaria>0
      ? `Hoje em liquidez D+0/D+1: ${moedaFull(liquidezDiaria)} (cobre ${mesesCobertos.toFixed(1)} mês${mesesCobertos>=2?"es":""} de gastos). Ideal são 6 meses = ${moedaFull(reservaIdeal)}. Faltam ${moedaFull(falta)}.`
      : `Reserva ideal (6x gastos): ${moedaFull(reservaIdeal)}. Faltam ${moedaFull(falta)} em liquidez imediata.`;
    insights.push({nivel,icon:"🛟",titulo:mesesCobertos<3?"Reserva de emergência muito baixa":"Falta reserva de emergência",
      texto:`${corpo}${mesesParaReserva?` Com o que você guarda hoje (${moedaFull(sobra)} por mês), completamos em ${mesesParaReserva} meses.`:""} Deixe esse dinheiro num investimento que você pode tirar no mesmo dia quando precisar.`,
      cta:"Plano para blindar a família em 6-12 meses.",
    });
  } else if(gastos>0&&reservaAtual>=reservaIdeal&&reservaIdeal>0) {
    insights.push({nivel:"baixo",icon:"🛡️",titulo:"Reserva de emergência completa",
      texto:`Você tem ${moedaFull(reservaAtual)} disponível para usar a qualquer hora. Isso cobre ${mesesCobertos.toFixed(1)} meses dos seus gastos. Essa segurança permite investir com tranquilidade, sem pânico em momentos de crise.`,
      cta:"Ótimo. Agora podemos focar em fazer o patrimônio crescer.",
    });
  }

  if(aporteMedio>0&&metaAporte>0&&aporteMedio<metaAporte) {
    const gap = metaAporte-aporteMedio;
    insights.push({nivel:gap/metaAporte>0.4?"alto":"medio",icon:"🎯",titulo:"Você está investindo menos do que deveria",
      texto:`A meta é guardar ${moedaFull(metaAporte)} por mês, mas você está guardando ${moedaFull(aporteMedio)}. Faltam ${moedaFull(gap)} (${((gap/metaAporte)*100).toFixed(0)}% a menos). Em 10 anos, essa diferença vira ${moedaFull(gap*12*10*1.4)} a menos no seu patrimônio.`,
      cta:"Ajustar meta ou automatizar aporte no dia do salário.",
    });
  }

  if(rentAnual>0&&rentAnual<12) {
    const deltaVs12 = projetarPatrimonio(patrimonioFinanceiro, aporteUsado, 12-4, 10) - projetarPatrimonio(patrimonioFinanceiro, aporteUsado, Math.max(rentAnual-4,1), 10);
    const anosRent = anosParaAtingir(patrimonioFinanceiro, aporteUsado, Math.max(rentAnual-4,1), magicNumber);
    const anos12 = anosParaAtingir(patrimonioFinanceiro, aporteUsado, 12-4, magicNumber);
    const atrasoEmAnos = anosRent&&anos12?(anosRent-anos12):null;
    insights.push({nivel:"alto",icon:"📉",titulo:`Seus investimentos estão rendendo pouco (${rentAnual.toFixed(1)}% ao ano)`,
      texto:`Uma carteira bem montada rende entre 12% e 14% por ano com risco controlado. No ritmo atual, você deixa de ganhar ${moedaFull(deltaVs12)} em 10 anos.${atrasoEmAnos&&atrasoEmAnos>0?` Além disso, você atinge sua liberdade financeira ${atrasoEmAnos.toFixed(1)} anos depois do que poderia.`:""}`,
      cta:"Ver sua carteira e reposicionar sem mudar perfil de risco.",
    });
  }

  if(modeloAtend==="Comissionado (Commission Based)") {
    const custoEstimado = patrimonioFinanceiro*0.015; // ~1,5% a.a. oculto em produtos
    insights.push({nivel:"medio",icon:"💼",titulo:"Cuidado com quem ganha comissão por produto",
      texto:`Quando o profissional ganha por produto vendido, você paga escondido entre 1% e 2% ao ano.${patrimonioFinanceiro>0?` Na sua carteira de ${formatMi(patrimonioFinanceiro)}, isso tira cerca de ${moedaFull(custoEstimado)} do seu rendimento todo ano.`:""} O modelo de taxa fixa (Fee Based) é transparente e deixa o profissional alinhado com você.`,
      cta:"Análise de custos ocultos vs modelo Fee Based.",
    });
  }

  if(imoveis.length===0) {
    insights.push({nivel:"info",icon:"🏡",titulo:"Você ainda não tem imóveis",
      texto:`Tem dois caminhos. 1) Comprar um imóvel à vista, usando entre ${moedaFull(magicNumber*0.15)} e ${moedaFull(magicNumber*0.25)} do seu planejamento. 2) Montar uma carteira de investimentos que paga seu aluguel para sempre. Em 20 anos, a opção 2 costuma render mais.`,
      cta:"Simulação imóvel próprio vs carteira geradora de renda.",
    });
  } else if(pctImoveisTotal>60) {
    insights.push({nivel:"medio",icon:"🏠",titulo:"Muito dinheiro preso em imóveis",
      texto:`${pctImoveisTotal.toFixed(0)}% do seu patrimônio está em imóveis (${moedaFull(valorImoveis)}). Imóvel é bom, mas demora pra virar dinheiro. Ter uma parte em investimentos que você pode sacar rápido dá mais liberdade em emergências e oportunidades.`,
      cta:"Plano de diversificação gradual sem vender imóveis.",
    });
  }

  if(carrosSemSeguro>0) {
    insights.push({nivel:"alto",icon:"🛡️",titulo:"Veículo sem seguro",
      texto:`${carrosSemSeguro} veículo(s) sem seguro. Se acontecer um acidente ou roubo, pode ser um prejuízo imediato de até ${moedaFull(valorVeiculos*0.8)}. Isso apaga meses ou anos de esforço guardando dinheiro.`,
      cta:"Cotação integrada ao planejamento financeiro.",
    });
  }

  if(objetivos.includes("aposentadoria")&&idade) {
    const gastosAposent = (gastos||salario*0.7);
    const gapRenda = gastosAposent - rendaPassivaAos60;
    if(rendaPassivaAos60<gastosAposent) {
      insights.push({nivel:"alto",icon:"🌴",titulo:"Aposentadoria: caminho precisa ser ajustado",
        texto:`Do jeito que está hoje (${moedaFull(patrimonioFinanceiro)} guardado + ${moedaFull(aporteUsado)} por mês rendendo ${rentReal.toFixed(1)}% ao ano acima da inflação), em ${anosAte60} anos você terá ${moedaFull(patAos60)}. Isso te dá ${moedaFull(rendaPassivaAos60)} por mês. Mas você gasta ${moedaFull(gastosAposent)} por mês hoje. Faltam ${moedaFull(gapRenda)} por mês.`,
        cta:"Ajustar aporte, rentabilidade-alvo ou idade de aposentadoria.",
      });
    } else {
      insights.push({nivel:"baixo",icon:"✅",titulo:"Aposentadoria no caminho certo",
        texto:`Aos ${idadeDesejadaAposentar} anos, você terá ${moedaFull(patAos60)} gerando ${moedaFull(rendaPassivaAos60)} por mês. Isso é mais do que você gasta hoje (${moedaFull(gastosAposent)}). Agora o foco é proteger esse plano contra imprevistos e pagar menos imposto legalmente.`,
        cta:"Blindagem do plano: seguros + previdência + diversificação.",
      });
    }
  }

  // Sucessão — só alertar se tem dependentes E não tem plano sucessório
  if(temDependentes&&!temPlanoSucessorioFlag&&patrimonioTotal>100000) {
    const custoInventario = patrimonioTotal*0.12; // estimativa média
    insights.push({nivel:patrimonioTotal>500000?"alto":"medio",icon:"👨‍👩‍👧",titulo:"Sua família não está protegida",
      texto:`Você tem ${temFilhosDep?`${filhos.length} filho(s) dependente(s)`:"cônjuge dependente"} e ${formatMi(patrimonioTotal)} de patrimônio, mas não tem um plano para passar isso adiante. Se algo acontecer hoje, sua família pode gastar cerca de ${moedaFull(custoInventario)} em impostos e advogados. E ainda ficar de 2 a 5 anos sem conseguir acessar o dinheiro.`,
      cta:"Estruturar VGBL + holding + seguro de vida (resolve em 30 dias).",
    });
  }

  // Seguro de vida — só alertar se tem dependentes E não tem seguro
  if(temDependentes&&!temSeguroVidaFlag) {
    const coberturaIdeal = Math.max(salario*12*10, 500000); // 10 anos de renda ou mínimo 500k
    insights.push({nivel:"alto",icon:"🛡️",titulo:"Sua família sem seguro de vida",
      texto:`Você tem ${temFilhosDep?`${filhos.length} filho(s)`:"cônjuge dependente"}${salario>0?` e recebe ${moedaFull(salario)} por mês`:""}. Um seguro de vida de ${moedaFull(coberturaIdeal)} de cobertura custa entre ${moedaFull(coberturaIdeal*0.0015/12)} e ${moedaFull(coberturaIdeal*0.003/12)} por mês. Sem ele, sua família fica sem renda e pode precisar vender bens com pressa (e por menos).`,
      cta:"Cotação de seguro de vida integrada ao plano.",
    });
  }

  // Previdência — oportunidade fiscal + aposentadoria
  if(!temPrevidenciaFlag&&salario>0&&idade&&idade>=30&&idade<=55) {
    insights.push({nivel:"info",icon:"📑",titulo:"Previdência privada: pague menos imposto",
      texto:`O PGBL permite abater até 12% da sua renda anual do imposto de renda. No seu caso, isso pode economizar cerca de ${moedaFull(salario*12*0.12*0.275)} por ano em impostos. E mais: esse dinheiro vai direto para sua família sem passar por inventário, e pode pagar só 10% de imposto se ficar parado por bastante tempo.`,
      cta:"Simular VGBL/PGBL com estratégia fiscal.",
    });
  }

  if(foco&&idade) {
    if(foco.includes("Dividendos")&&idade<40) {
      insights.push({nivel:"info",icon:"📈",titulo:"Você é jovem demais pra viver só de dividendos",
        texto:`Aos ${idade} anos, investir em empresas em crescimento (ações e fundos de imóveis que ainda vão valorizar) costuma render de 2% a 4% a mais por ano. E reinvestir os ganhos acelera muito o seu patrimônio. Dividendos são ótimos, mas como complemento, não como foco principal nessa idade.`,
        cta:"Balanço entre crescimento e renda para seu perfil.",
      });
    } else if(foco.includes("Valorização")&&idade>=55) {
      insights.push({nivel:"info",icon:"💰",titulo:"Comece a focar em renda estável",
        texto:`Próximo da aposentadoria, o ideal é migrar aos poucos para investimentos que pagam todo mês (dividendos, aluguéis, fundos de renda). Isso dá previsibilidade e te protege de ter que vender na baixa.`,
        cta:"Transição gradual da carteira para renda.",
      });
    }
  }

  if(objetivos.includes("planoSaude")||(idade&&idade>=50)) {
    insights.push({nivel:"info",icon:"🏥",titulo:"Plano de saúde fica caro depois dos 59",
      texto:`Após os 59 anos, o plano de saúde sobe entre 40% e 60% do valor. Duas saídas: separar uma reserva específica só para saúde, ou contratar um seguro internacional (com cobertura em dólar). Vale muito a pena se planejar antes.`,
      cta:"Reserva saúde vitalícia ou seguro internacional.",
    });
  }

  if(objetivos.includes("educacao")&&filhos.length>0) {
    const idadesFilhos = filhos.map(f=>parseInt(f.idade)||0).filter(x=>x>0);
    const maisNovo = idadesFilhos.length>0?Math.min(...idadesFilhos):0;
    const anosAteFaculdade = Math.max(18-maisNovo, 2);
    const custoFacu = 480000*filhos.length;
    insights.push({nivel:"medio",icon:"🎓",titulo:"Faculdade dos filhos",
      texto:`${filhos.length} filho(s) com faculdade em cerca de ${anosAteFaculdade} anos. 4 anos de faculdade particular hoje custam ${moedaFull(custoFacu)}. Começando a guardar agora (com rendimento de ${rentReal.toFixed(1)}% acima da inflação), bastam ${moedaFull((custoFacu/anosAteFaculdade/12)*0.7)} por mês. Se deixar para quando o filho tiver 10 anos, sobe para ${moedaFull(custoFacu/4/12)} por mês.`,
      cta:"Caixinha de educação por filho com VGBL.",
    });
  }

  if(objetivos.includes("viagem")) {
    const viagem = cliente.proximaViagemPlanejada||"";
    if(viagem) {
      insights.push({nivel:"baixo",icon:"✈️",titulo:"Sua próxima viagem",
        texto:`"${viagem}". Vamos separar um valor específico para essa viagem, em um investimento seguro que vence perto da data da viagem. Assim o dinheiro vai estar lá quando você precisar, sem susto.`,
        cta:"Estruturar caixinha de viagem com aporte automático.",
      });
    } else {
      insights.push({nivel:"info",icon:"✈️",titulo:"Planeje suas viagens",
        texto:`Separar uma caixinha específica para viagens protege seu plano principal. Cada viagem fica no investimento certo para sua data. Qual a próxima viagem dos seus sonhos?`,
        cta:"Definir destino, valor e data. A gente monta a caixinha.",
      });
    }
  }

  // ═══ PLANO DE AÇÃO 90 DIAS ═══
  const plano90 = [];
  plano90.push({prazo:"Semana 1",acao:"Cadastrar todos os seus investimentos atuais. É o ponto de partida."});
  if(sobra<0) plano90.push({prazo:"Semana 1-2",acao:"Mapear e cortar 15-20% de gastos para sair do vermelho"});
  if(reservaAtual<reservaIdeal&&reservaIdeal>0) plano90.push({prazo:"Mês 1",acao:`${mesesCobertos<3?"[URGENTE] ":""}Completar reserva de emergência (alvo: ${moedaFull(reservaIdeal)} em liquidez D+1)`});
  if(carrosSemSeguro>0) plano90.push({prazo:"Mês 1",acao:"Contratar seguro dos veículos expostos"});
  if(temDependentes&&!temSeguroVidaFlag) plano90.push({prazo:"Mês 1",acao:"Cotar seguro de vida (cobertura de 10x renda anual)"});
  if(modeloAtend==="Comissionado (Commission Based)") plano90.push({prazo:"Mês 1",acao:"Análise de custos ocultos da carteira atual"});
  if(rentAnual<12&&rentAnual>0) plano90.push({prazo:"Mês 2",acao:"Rebalancear carteira para rentabilidade-alvo de 12-14% a.a."});
  if(aporteMedio<metaAporte&&metaAporte>0) plano90.push({prazo:"Mês 2",acao:`Automatizar aporte mensal de ${moedaFull(metaAporte)} no dia ${cliente.diaAporte||"do salário"}`});
  if(temDependentes&&!temPlanoSucessorioFlag&&patrimonioTotal>300000) plano90.push({prazo:"Mês 2-3",acao:"Estruturar plano sucessório (VGBL + holding + seguro de vida)"});
  if(objetivos.length>0) plano90.push({prazo:"Mês 3",acao:"Detalhar e dar valores a cada objetivo selecionado (caixinhas)"});
  plano90.push({prazo:"Mês 3",acao:"Revisão trimestral do plano e ajuste de rota"});

  return {
    scores, scoreTotal, insights,
    magicNumber, pctLiberdade, anosParaLiberdade, idadeLiberdade,
    patAos60, rendaPassivaAos60, anosAte60, idadeDesejadaAposentar,
    distribuicao, patrimonioTotal, patrimonioFinanceiro, valorImoveis, valorVeiculos,
    reservaIdeal, reservaAtual, liquidezDiaria, mesesCobertos, sobra, pctSobra,
    protecoes, plano90,
    temDependentes, temFilhosDep, temConjuge, filhos, estadoCivil, objetivos,
    carrosSemSeguro, pctImoveisTotal, temPlanoSucessorioFlag, temSeguroVidaFlag, temPrevidenciaFlag,
    salario, gastos, aporteMedio, metaAporte, rentAnual, rentReal, idade,
  };
}

// ── Componentes visuais ──

// Divide um texto em frases (quebra em "." ou "!" ou "?" seguido de espaço e letra maiúscula).
// Cada frase volta sem espaços laterais e com o sinal de pontuação preservado.
function splitFrases(texto) {
  if (!texto) return [];
  return String(texto)
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÀÇ])/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Renderiza texto longo como uma lista de bullets, uma frase por linha.
// Se tiver só uma frase, mostra como parágrafo normal (sem bullet).
function FrasesLista({ texto, cor = "#748CAB", tamanho = 12 }) {
  const frases = splitFrases(texto);
  if (frases.length <= 1) {
    return (
      <div style={{ fontSize: tamanho, color: T.textSecondary, lineHeight: 1.65, letterSpacing: "0.01em" }}>
        {texto}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {frases.map((frase, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: tamanho,
            color: T.textSecondary,
            lineHeight: 1.65,
            letterSpacing: "0.01em",
          }}
        >
          <span
            style={{
              color: cor,
              opacity: 0.55,
              flexShrink: 0,
              marginTop: 3,
              fontSize: tamanho + 4,
              lineHeight: 1,
              fontWeight: 700,
            }}
          >
            •
          </span>
          <span style={{ flex: 1 }}>{frase}</span>
        </div>
      ))}
    </div>
  );
}

function MiniKPI({label,valor,cor}) {
  return (
    <div style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12,padding:"12px 14px",flex:1,minWidth:140,...noEdit}}>
      <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,fontWeight:500}}>{label}</div>
      <div style={{fontSize:16,fontWeight:400,color:cor||T.textPrimary,letterSpacing:"-0.01em"}}>{valor}</div>
    </div>
  );
}

// Score circular
function ScoreCircle({score,size=140}) {
  const r = size*0.40;
  const c = 2*Math.PI*r;
  const pct = Math.max(0,Math.min(score/100,1));
  const cor = score>=80?"#22c55e":score>=60?"#F0A202":score>=40?"#f59e0b":"#ef4444";
  const label = score>=80?"Excelente":score>=60?"Bom":score>=40?"Em construção":"Frágil";
  const svgH = size+22;
  return (
    <div style={{flexShrink:0,...noEdit}}>
      <svg width={size} height={svgH}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={size*0.065}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cor} strokeWidth={size*0.065}
          strokeDasharray={`${c*pct} ${c}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}/>
        <text x={size/2} y={size/2+size*0.10} textAnchor="middle" fontSize={size*0.26} fill={T.textPrimary} fontFamily={T.fontFamily} fontWeight="300">{score}</text>
        <text x={size/2} y={size/2+size*0.22} textAnchor="middle" fontSize={size*0.072} fill={T.textMuted} fontFamily={T.fontFamily} letterSpacing="0.1em">/ 100</text>
        <text x={size/2} y={size+16} textAnchor="middle" fontSize={12} fill={cor} fontFamily={T.fontFamily} fontWeight="500" letterSpacing="0.04em">{label}</text>
      </svg>
    </div>
  );
}

function ScoreBar({label,valor,max,cor,desc}) {
  const pct = max>0?(valor/max)*100:0;
  return (
    <div style={{marginBottom:12,...noEdit}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div>
          <div style={{fontSize:12,color:T.textPrimary,fontWeight:500,letterSpacing:"0.01em"}}>{label}</div>
          <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>{desc}</div>
        </div>
        <div style={{fontSize:13,color:cor,fontWeight:500}}>{valor}<span style={{fontSize:10,color:T.textMuted,marginLeft:3}}>/ {max}</span></div>
      </div>
      <div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${cor},${cor}cc)`,borderRadius:3,boxShadow:`0 0 8px ${cor}55`,transition:"width 0.8s ease"}}/>
      </div>
    </div>
  );
}

function ProgressoMagic({pct,cor}) {
  return (
    <div style={{height:10,background:"rgba(255,255,255,0.05)",borderRadius:5,overflow:"hidden",marginTop:10,...noEdit}}>
      <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${cor},${cor}99)`,borderRadius:5,boxShadow:`0 0 12px ${cor}66`,transition:"width 0.8s ease"}}/>
    </div>
  );
}

// Distribuição patrimonial — barra horizontal
function DistBar({items,total}) {
  if(!items.length||total<=0) return null;
  return (
    <div style={{...noEdit}}>
      <div style={{display:"flex",height:24,borderRadius:8,overflow:"hidden",marginBottom:12,border:`0.5px solid ${T.border}`}}>
        {items.map(it=>{
          const pct = (it.valor/total)*100;
          return <div key={it.label} style={{width:`${pct}%`,background:it.cor,transition:"width 0.8s ease"}}/>;
        })}
      </div>
      {items.map(it=>{
        const pct = (it.valor/total)*100;
        return (
          <div key={it.label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`0.5px solid ${T.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:10,height:10,borderRadius:3,background:it.cor}}/>
              <span style={{fontSize:12,color:T.textSecondary}}>{it.label}</span>
            </div>
            <div style={{display:"flex",gap:12,alignItems:"baseline"}}>
              <span style={{fontSize:12,color:T.textPrimary,fontWeight:500}}>{formatMi(it.valor)}</span>
              <span style={{fontSize:11,color:it.cor,fontWeight:500,minWidth:38,textAlign:"right"}}>{pct.toFixed(0)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProtecaoItem({label,ok,desc}) {
  const cor = ok?"#22c55e":"#ef4444";
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`0.5px solid ${T.border}`,...noEdit}}>
      <div style={{width:22,height:22,borderRadius:"50%",background:`${cor}18`,border:`1px solid ${cor}60`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {ok?<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>:<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,color:T.textPrimary,fontWeight:500}}>{label}</div>
        <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>{desc}</div>
      </div>
      <span style={{fontSize:9,color:cor,fontWeight:600,letterSpacing:"0.1em"}}>{ok?"OK":"GAP"}</span>
    </div>
  );
}

function SectionCard({icon,titulo,subtitulo,children,accent="#F0A202"}) {
  return (
    <div style={{background:T.bgCard,border:`0.5px solid ${T.border}`,borderRadius:18,padding:"22px 22px",marginBottom:14,boxShadow:T.shadowSm}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:18}}>
        <div style={{width:3,height:28,borderRadius:2,background:`linear-gradient(180deg,${accent},${accent}33)`,flexShrink:0,marginTop:2}}/>
        {icon&&<div style={{fontSize:22,lineHeight:1,flexShrink:0}}>{icon}</div>}
        <div>
          <div style={{fontSize:17,fontWeight:500,color:T.textPrimary,letterSpacing:"-0.01em",lineHeight:1.2}}>{titulo}</div>
          {subtitulo&&<div style={{fontSize:11,color:T.textSecondary,marginTop:4,letterSpacing:"0.01em"}}>{subtitulo}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Ícones inline (sem emoji) ──
const IconArrow = ({cor="#F0A202",size=18}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{...noEdit}}>
    <path d="M5 12h14M13 5l7 7-7 7"/>
  </svg>
);
const IconCheck = ({cor="#22c55e",size=12}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5"/>
  </svg>
);

// ── Diagnóstico humano por pilar (frase que explica a nota) ──
function diagnosticoPilar(label, a) {
  if(label==="Organização de Fluxo") {
    if(a.pctSobra>=30) return `Excelente: você guarda ${a.pctSobra.toFixed(0)}% da renda (${moedaFull(a.sobra)}/mês). Bem acima dos 20% recomendados.`;
    if(a.pctSobra>=20) return `Boa margem: você guarda ${a.pctSobra.toFixed(0)}% da renda (${moedaFull(a.sobra)}/mês). Dá pra acelerar aportes.`;
    if(a.pctSobra>=10) return `Sobra apertada: guarda ${a.pctSobra.toFixed(0)}% da renda. Meta recomendada: pelo menos 20% (${moedaFull(a.salario*0.2)}/mês).`;
    if(a.pctSobra>0)   return `Margem crítica: só ${a.pctSobra.toFixed(0)}% de sobra (${moedaFull(a.sobra)}). Revisar gastos é prioridade.`;
    if(a.salario>0)    return `Você está gastando tudo o que ganha. Impossível construir patrimônio sem gerar sobra mensal.`;
    return `Cadastre renda e gastos mensais para calcular sua sobra.`;
  }
  if(label==="Reserva de Emergência") {
    if(a.gastos<=0) return `Cadastre os gastos mensais para calcular a reserva ideal (6 meses de despesas em liquidez).`;
    if(a.mesesCobertos>=6) return `Protegido: ${a.mesesCobertos.toFixed(1)} meses de gastos em liquidez (${moedaFull(a.reservaAtual)}). Meta atingida.`;
    if(a.mesesCobertos>=3) return `Parcial: ${a.mesesCobertos.toFixed(1)} meses cobertos. Faltam ${moedaFull(Math.max(a.reservaIdeal-a.reservaAtual,0))} para 6 meses (${moedaFull(a.reservaIdeal)}).`;
    if(a.mesesCobertos>=1) return `Baixa: apenas ${a.mesesCobertos.toFixed(1)} mês coberto. Qualquer imprevisto vira dívida. Ideal: ${moedaFull(a.reservaIdeal)}.`;
    return `Sem reserva de emergência. Prioridade zero: construir ${moedaFull(a.reservaIdeal)} em liquidez antes de qualquer outro plano.`;
  }
  if(label==="Investimentos") {
    if(a.rentAnual<=0) return `Sem dados de rentabilidade. Cadastre a carteira para avaliar se está batendo a meta de IPCA + 6% ao ano.`;
    if(a.rentAnual>=12) return `Rentabilidade de ${a.rentAnual.toFixed(1)}% a.a. supera a meta (IPCA + 6% ≈ 10%). Continue monitorando o risco da carteira.`;
    if(a.rentAnual>=10) return `Rentabilidade de ${a.rentAnual.toFixed(1)}% a.a. no alvo (IPCA + 6%). Patrimônio de ${formatMi(a.patrimonioFinanceiro)} crescendo de forma sustentável.`;
    if(a.rentAnual>=7)  return `Rentabilidade de ${a.rentAnual.toFixed(1)}% a.a. abaixo da meta. Carteira precisa de revisão. IPCA + 6% ao ano é o alvo para sustentar a liberdade.`;
    return `Rentabilidade de ${a.rentAnual.toFixed(1)}% a.a. muito baixa. Você está perdendo para a inflação no longo prazo.`;
  }
  if(label==="Proteção Patrimonial") {
    const gaps = [];
    if(!a.protecoes.reserva) gaps.push("reserva");
    if(!a.protecoes.seguroCarro) gaps.push("seguro de veículo");
    if(!a.protecoes.seguroVida && a.temDependentes) gaps.push("seguro de vida");
    if(!a.protecoes.sucessao && a.temDependentes) gaps.push("sucessão");
    if(!a.protecoes.previdencia) gaps.push("previdência");
    if(gaps.length===0) return `Todas as camadas de proteção estão ativas. Revisão anual mantém a blindagem em dia.`;
    if(gaps.length>=4)  return `Família desprotegida. ${gaps.length} camadas ausentes (${gaps.join(", ")}). Qualquer imprevisto vira tragédia financeira.`;
    return `Faltam ${gaps.length} camada(s) de proteção: ${gaps.join(", ")}. Resolver antes de priorizar novos aportes.`;
  }
  if(label==="Planejamento") {
    const partes = [];
    if(a.objetivos.length===0) partes.push("objetivos não mapeados");
    else if(a.objetivos.length<2) partes.push(`só ${a.objetivos.length} objetivo definido`);
    if(a.metaAporte<=0) partes.push("meta de aporte não definida");
    if(partes.length===0) return `Planejamento estruturado: ${a.objetivos.length} objetivos mapeados + meta de aporte de ${moedaFull(a.metaAporte)}/mês.`;
    return `Complete o planejamento. ${partes.join("; ")}. Sem metas claras, aportes viram só poupança, não construção patrimonial.`;
  }
  return "";
}

// ── Alvo de navegação por pilar ──
function alvoPilar(label, id, navigate) {
  const rotas = {
    "Investimentos": () => navigate(`/cliente/${id}/carteira`),
    "Planejamento":  () => navigate(`/cliente/${id}/objetivos`),
    "Proteção Patrimonial": () => document.getElementById("sec-blindagem")?.scrollIntoView({behavior:"smooth",block:"start"}),
    "Organização de Fluxo": () => navigate(`/cliente/${id}/fluxo`),
    "Reserva de Emergência": () => document.getElementById("sec-blindagem")?.scrollIntoView({behavior:"smooth",block:"start"}),
  };
  return rotas[label];
}

// ── Pilar expandido (com frase diagnóstica) ──
function PilarDetalhado({pilar, onClick}) {
  const frases = splitFrases(pilar.diag);
  const clicavel = typeof onClick === "function";
  return (
    <div onClick={onClick} style={{padding:"13px 15px",background:"rgba(255,255,255,0.015)",border:`0.5px solid ${T.border}`,borderRadius:12,marginBottom:8,cursor:clicavel?"pointer":"default",transition:"border-color 0.15s, background 0.15s",...noEdit}}
      onMouseEnter={e=>{if(clicavel){e.currentTarget.style.borderColor=`${pilar.cor}66`;e.currentTarget.style.background="rgba(255,255,255,0.03)"}}}
      onMouseLeave={e=>{if(clicavel){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="rgba(255,255,255,0.015)"}}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:9,gap:12}}>
        <div style={{fontSize:13,color:T.textPrimary,fontWeight:500,letterSpacing:"0.005em",display:"flex",alignItems:"center",gap:6}}>
          {pilar.label}
          {clicavel && <span style={{fontSize:11,color:pilar.cor,opacity:0.6}}>›</span>}
        </div>
        <div style={{fontSize:13,fontWeight:500,color:pilar.cor,whiteSpace:"nowrap"}}>
          {pilar.valor}<span style={{fontSize:10,color:T.textMuted,marginLeft:4,fontWeight:400}}>de {pilar.max}</span>
        </div>
      </div>
      <div style={{height:4,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden",marginBottom:10}}>
        <div style={{height:"100%",width:`${pilar.pct*100}%`,background:`linear-gradient(90deg,${pilar.cor},${pilar.cor}aa)`,borderRadius:2,boxShadow:`0 0 8px ${pilar.cor}55`,transition:"width 0.8s ease"}}/>
      </div>
      <div style={{fontSize:11.5,color:T.textSecondary,lineHeight:1.6,letterSpacing:"0.005em",display:"flex",flexDirection:"column",gap:5}}>
        {frases.length>0 ? frases.map((f,i)=><div key={i}>{f}</div>) : <div>{pilar.diag}</div>}
      </div>
    </div>
  );
}

// ── Pilar compacto (para os fortes — não exige ação) ──
function PilarCompacto({pilar, onClick}) {
  const clicavel = typeof onClick === "function";
  return (
    <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"rgba(34,197,94,0.04)",border:"0.5px solid rgba(34,197,94,0.18)",borderRadius:10,marginBottom:6,cursor:clicavel?"pointer":"default",transition:"border-color 0.15s",...noEdit}}
      onMouseEnter={e=>{if(clicavel)e.currentTarget.style.borderColor="rgba(34,197,94,0.4)"}}
      onMouseLeave={e=>{if(clicavel)e.currentTarget.style.borderColor="rgba(34,197,94,0.18)"}}>
      <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(34,197,94,0.14)",border:"0.5px solid rgba(34,197,94,0.35)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <IconCheck cor="#22c55e" size={11}/>
      </div>
      <div style={{flex:1,fontSize:12.5,color:T.textPrimary,fontWeight:500}}>{pilar.label}</div>
      <div style={{fontSize:11.5,color:"#22c55e",fontWeight:500}}>
        {pilar.valor}<span style={{color:T.textMuted,fontWeight:400,marginLeft:3}}>/{pilar.max}</span>
      </div>
      {clicavel && <span style={{fontSize:12,color:"#22c55e",opacity:0.6,marginLeft:4}}>›</span>}
    </div>
  );
}

// ── Cabeçalho de grupo (Crítico / Atenção / Forte) ──
function GrupoCabecalho({titulo, cor}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,marginTop:14,...noEdit}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:cor,boxShadow:`0 0 8px ${cor}80`,flexShrink:0}}/>
      <div style={{fontSize:9.5,color:cor,textTransform:"uppercase",letterSpacing:"0.18em",fontWeight:600}}>{titulo}</div>
      <div style={{flex:1,height:"0.5px",background:`linear-gradient(90deg,${cor}40,transparent)`}}/>
    </div>
  );
}

// ── Hero do Score: círculo grande + resumo + pilares agrupados por urgência ──
function ScoreHero({a, compact=false, clienteId, navigate}) {
  const score = a.scoreTotal;
  const fazAlvo = (label) => alvoPilar(label, clienteId, navigate);
  const tier = score>=80 ? {label:"Excelente", cor:"#22c55e", desc:"Saúde financeira sólida em todas as áreas."}
             : score>=60 ? {label:"Bom", cor:"#F0A202", desc:"Bases estão firmes. Há pontos específicos para melhorar."}
             : score>=40 ? {label:"Em construção", cor:"#f59e0b", desc:"Estrutura em formação. Algumas áreas exigem atenção imediata."}
                         : {label:"Frágil", cor:"#ef4444", desc:"Riscos estruturais presentes. Plano de ação urgente recomendado."};

  const classificados = a.scores.map(s => {
    const pct = s.max>0 ? s.valor/s.max : 0;
    const nivel = pct<0.4 ? "critico" : pct<0.7 ? "atencao" : "forte";
    return {...s, pct, nivel, diag: diagnosticoPilar(s.label, a)};
  });
  const criticos = classificados.filter(s=>s.nivel==="critico");
  const atencao  = classificados.filter(s=>s.nivel==="atencao");
  const fortes   = classificados.filter(s=>s.nivel==="forte");

  return (
    <div>
      {/* Header com círculo + resumo — oculto no modo compact */}
      {!compact && (
        <div style={{display:"flex",gap:22,alignItems:"center",flexWrap:"wrap",paddingBottom:18,marginBottom:6,borderBottom:`0.5px solid ${T.border}`}}>
          <ScoreCircle score={score} size={124}/>
          <div style={{flex:1,minWidth:220,...noEdit}}>
            <div style={{fontSize:9.5,color:tier.cor,textTransform:"uppercase",letterSpacing:"0.2em",fontWeight:600,marginBottom:10}}>
              {tier.label}
            </div>
            <div style={{fontSize:16,color:T.textPrimary,fontWeight:400,lineHeight:1.45,letterSpacing:"-0.003em",marginBottom:10}}>
              {tier.desc}
            </div>
            <div style={{fontSize:11.5,color:T.textSecondary,lineHeight:1.65,letterSpacing:"0.005em"}}>
              Nota composta por <b style={{color:T.textPrimary,fontWeight:500}}>5 áreas</b> da vida financeira: fluxo, reserva, investimentos, proteção e planejamento. Cada área tem um peso. O diagnóstico abaixo diz exatamente o que cada nota significa.
            </div>
          </div>
        </div>
      )}

      {/* Grupo Crítico */}
      {criticos.length>0 && (
        <div id="diag-critico">
          <GrupoCabecalho titulo="Crítico: resolva primeiro" cor="#ef4444"/>
          {criticos.map(p=><PilarDetalhado key={p.label} pilar={p} onClick={fazAlvo(p.label)}/>)}
        </div>
      )}

      {/* Grupo Atenção */}
      {atencao.length>0 && (
        <div id="diag-atencao">
          <GrupoCabecalho titulo="Atenção: próximo passo" cor="#f59e0b"/>
          {atencao.map(p=><PilarDetalhado key={p.label} pilar={p} onClick={fazAlvo(p.label)}/>)}
        </div>
      )}

      {/* Grupo Forte */}
      {fortes.length>0 && (
        <div id="diag-forte">
          <GrupoCabecalho titulo="Forte: continue assim" cor="#22c55e"/>
          {fortes.map(p=><PilarCompacto key={p.label} pilar={p} onClick={fazAlvo(p.label)}/>)}
        </div>
      )}
    </div>
  );
}

// ── Card do fluxo Gastos → Patrimônio → Renda ──
function FluxoCard({titulo, valor, sub, cor, corAccent, destaque}) {
  return (
    <div style={{
      padding:"16px 18px",
      background:destaque?"rgba(240,162,2,0.07)":"rgba(255,255,255,0.02)",
      border:`0.5px solid ${destaque?"rgba(240,162,2,0.32)":T.border}`,
      borderRadius:14,
      boxShadow:destaque?"0 0 28px -10px rgba(240,162,2,0.35)":"none",
      ...noEdit,
    }}>
      <div style={{fontSize:9,color:corAccent,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:10,fontWeight:600}}>{titulo}</div>
      <div style={{fontSize:destaque?24:20,fontWeight:400,color:cor,letterSpacing:"-0.015em",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{valor}</div>
      <div style={{fontSize:10.5,color:T.textMuted,marginTop:6,letterSpacing:"0.01em"}}>{sub}</div>
    </div>
  );
}

// ── Timeline da jornada para liberdade ──
function JornadaLinha({a}) {
  const pct = Math.max(0,Math.min(a.pctLiberdade/100,1));
  const idadeHoje = a.idade;
  const idadeLib  = a.idadeLiberdade;
  const anosFalta = a.anosParaLiberdade;
  return (
    <div style={{position:"relative",padding:"10px 0 0",...noEdit}}>
      {/* Linha da jornada */}
      <div style={{position:"relative",height:8,background:"rgba(255,255,255,0.05)",borderRadius:4,marginBottom:18}}>
        <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${pct*100}%`,background:"linear-gradient(90deg,#F0A202,#fcd34d)",borderRadius:4,boxShadow:"0 0 14px rgba(240,162,2,0.5)",transition:"width 0.8s ease"}}/>
        {/* Ponto "hoje" */}
        <div style={{position:"absolute",left:`${pct*100}%`,top:"50%",transform:"translate(-50%,-50%)",width:16,height:16,borderRadius:"50%",background:"#F0A202",border:"2px solid #0D1321",boxShadow:"0 0 18px rgba(240,162,2,0.85)"}}/>
        {/* Ponto "destino" */}
        <div style={{position:"absolute",right:0,top:"50%",transform:"translate(50%,-50%)",width:10,height:10,borderRadius:"50%",background:"rgba(240,162,2,0.3)",border:"1px solid rgba(240,162,2,0.6)"}}/>
      </div>

      {/* Legendas das extremidades */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div>
          <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:5,fontWeight:500}}>
            Hoje{idadeHoje?` · ${idadeHoje} anos`:""}
          </div>
          <div style={{fontSize:15,color:T.textPrimary,fontWeight:400,letterSpacing:"-0.01em"}}>{moedaFull(a.patrimonioFinanceiro)}</div>
          <div style={{fontSize:10.5,color:"#F0A202",fontWeight:500,marginTop:3,letterSpacing:"0.01em"}}>{a.pctLiberdade.toFixed(1)}% do caminho</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:5,fontWeight:500}}>
            Liberdade{idadeLib?` · ${idadeLib.toFixed(0)} anos`:""}
          </div>
          <div style={{fontSize:15,color:"#F0A202",fontWeight:500,letterSpacing:"-0.01em"}}>{moedaFull(a.magicNumber)}</div>
          {anosFalta!=null && <div style={{fontSize:10.5,color:T.textSecondary,fontWeight:400,marginTop:3,letterSpacing:"0.01em"}}>em {anosFalta.toFixed(1)} anos no ritmo atual</div>}
        </div>
      </div>
    </div>
  );
}

// ── Hero da Independência Financeira ──
function LiberdadeHero({a}) {
  const temRent = a.rentAnual>0;
  const rentRealCarteira = temRent ? (a.rentAnual-4) : 0; // desconta inflação ~4%
  const bateuMeta = temRent && rentRealCarteira>=5;
  const gastoMensal = a.gastos>0 ? a.gastos : a.salario*0.7;
  const rendaMensalVitalicia = (a.magicNumber*0.05)/12;

  return (
    <div style={{...noEdit}}>
      {/* Explicação didática */}
      <div style={{padding:"16px 18px",background:"rgba(240,162,2,0.04)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:14,marginBottom:20}}>
        <div style={{fontSize:9.5,color:"#F0A202",textTransform:"uppercase",letterSpacing:"0.2em",fontWeight:600,marginBottom:10}}>Como funciona</div>
        <div style={{fontSize:13,color:T.textPrimary,lineHeight:1.7,letterSpacing:"0.005em",display:"flex",flexDirection:"column",gap:8}}>
          <div>Para viver de renda para sempre, seu patrimônio precisa render acima de <b style={{color:"#F0A202",fontWeight:500}}>IPCA + 6% ao ano</b>.</div>
          <div>Quando você acumula <b style={{color:"#F0A202",fontWeight:500}}>20 vezes seus gastos anuais</b> investidos nessa rentabilidade, a renda gerada paga suas contas.</div>
          <div>Seu poder de compra é preservado mesmo em crises, e o patrimônio permanece intacto até o fim da vida.</div>
        </div>
      </div>

      {/* Fluxo visual: Gastos → Patrimônio → Renda */}
      <div className="fluxo-liberdade" style={{marginBottom:22}}>
        <FluxoCard titulo="Seus gastos" valor={moedaFull(gastoMensal)} sub="por mês" cor={T.textPrimary} corAccent={T.textSecondary}/>
        <div className="fluxo-arrow"><IconArrow cor="#F0A202" size={20}/></div>
        <FluxoCard titulo="Patrimônio-alvo" valor={moedaFull(a.magicNumber)} sub="gastos anuais × 20" cor="#F0A202" corAccent="#fcd34d" destaque/>
        <div className="fluxo-arrow"><IconArrow cor="#F0A202" size={20}/></div>
        <FluxoCard titulo="Renda vitalícia" valor={moedaFull(rendaMensalVitalicia)} sub="todo mês, para sempre" cor="#22c55e" corAccent="#86efac"/>
      </div>

      {/* Rentabilidade-alvo */}
      <div style={{padding:"16px 18px",background:bateuMeta?"rgba(34,197,94,0.05)":"rgba(255,255,255,0.02)",border:`0.5px solid ${bateuMeta?"rgba(34,197,94,0.28)":T.border}`,borderRadius:14,marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:20,flexWrap:"wrap"}}>
          <div style={{minWidth:200,flex:1}}>
            <div style={{fontSize:9.5,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.18em",fontWeight:600,marginBottom:8}}>Rentabilidade-alvo</div>
            <div style={{fontSize:22,color:T.textPrimary,fontWeight:400,letterSpacing:"-0.01em"}}>
              IPCA + 5<span style={{fontSize:14,color:T.textMuted,marginLeft:2}}>% a.a.</span>
            </div>
            <div style={{fontSize:11,color:T.textSecondary,marginTop:6,lineHeight:1.55,letterSpacing:"0.005em"}}>
              É a rentabilidade que preserva seu poder de compra e mantém o patrimônio intacto, mesmo em crises.
            </div>
          </div>
          {temRent && (
            <div style={{textAlign:"right",minWidth:160}}>
              <div style={{fontSize:9.5,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.18em",fontWeight:600,marginBottom:8}}>Sua carteira hoje</div>
              <div style={{fontSize:18,color:bateuMeta?"#22c55e":"#f59e0b",fontWeight:500,letterSpacing:"-0.01em"}}>
                {rentRealCarteira>=0?"+":""}{rentRealCarteira.toFixed(1)}<span style={{fontSize:12,color:T.textMuted,marginLeft:2}}>% real a.a.</span>
              </div>
              <div style={{fontSize:10.5,color:bateuMeta?"#86efac":"#fcd34d",marginTop:5,fontWeight:500,letterSpacing:"0.01em"}}>
                {bateuMeta?"Acima da meta. Liberdade sustentável.":"Abaixo da meta. Ajuste necessário."}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Jornada */}
      <div style={{padding:"20px 20px 22px",background:"rgba(0,0,0,0.18)",border:`0.5px solid ${T.border}`,borderRadius:14}}>
        <div style={{fontSize:9.5,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.18em",fontWeight:600,marginBottom:14}}>Sua jornada</div>
        <JornadaLinha a={a}/>
      </div>

      {/* Nota de rodapé */}
      <div style={{fontSize:10.5,color:T.textMuted,marginTop:14,lineHeight:1.65,letterSpacing:"0.01em"}}>
        Baseado na <b style={{color:T.textSecondary,fontWeight:500}}>Regra dos 4% (Trinity Study, 1998)</b> adaptada ao Brasil. No longo prazo, um patrimônio que rende 5% reais ao ano sustenta saques anuais equivalentes a 5% do capital inicial corrigido pela inflação, preservando o principal e o poder de compra.
      </div>
    </div>
  );
}

export default function Diagnostico() {
  const {id} = useParams();
  const navigate = useNavigate();
  const { isCliente, profile } = useAuth();
  const [cliente,setCliente] = useState(null);
  const [carregou,setCarregou] = useState(false);

  // Cliente só pode ver o próprio diagnóstico — redireciona se URL for de outro id.
  useEffect(() => {
    if (isCliente && profile?.clienteId && id !== profile.clienteId) {
      navigate(`/cliente/${profile.clienteId}/diagnostico`, { replace: true });
    }
  }, [isCliente, profile?.clienteId, id, navigate]);

  const [erroLoad,setErroLoad] = useState(null);
  useEffect(()=>{
    let vivo = true;
    async function carregar() {
      try {
        const r = await lerClienteComFallback(id, { isAlive: () => vivo });
        if(!vivo) return;
        if(r.exists && r.data) setCliente({id, ...r.data});
        setErroLoad(null);
      } catch (e) {
        if(!vivo) return;
        console.error("Diagnostico: falha ao ler cliente", e);
        setErroLoad(e?.message || "Erro ao carregar cliente");
      } finally {
        if(vivo) setCarregou(true);
      }
    }
    carregar();
    const onFocus = () => { carregar(); };
    const onVisibility = () => { if(!document.hidden) carregar(); };
    // CustomEvent disparado por ClienteFicha após salvar perfil. Sem isso o
    // diagnóstico só atualizava em focus/visibility — usuário editava perfil,
    // voltava pro diagnóstico e via dados velhos até trocar de aba.
    const onClienteAtualizado = (e) => {
      if(!e?.detail?.id || e.detail.id === id) carregar();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("wealthtrack:cliente-atualizado", onClienteAtualizado);
    return () => {
      vivo = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("wealthtrack:cliente-atualizado", onClienteAtualizado);
    };
  },[id]);

  const a = useMemo(()=>{
    if(!cliente) return null;
    try { return analisar(cliente); }
    catch(e) { console.error("Diagnostico: analisar() falhou", e); return null; }
  }, [cliente]);
  const insightsAltos = useMemo(()=>a?a.insights.filter(i=>i.nivel==="alto"):[], [a]);
  const medios = useMemo(()=>a?a.insights.filter(i=>i.nivel==="medio").length:0, [a]);
  const top3Riscos = useMemo(()=>insightsAltos.slice(0,3), [insightsAltos]);

  if(!carregou) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:T.fontFamily}}>
      <div style={{fontSize:13,color:T.textMuted}}>Analisando perfil...</div>
    </div>
  );

  if(!cliente||!a) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,fontFamily:T.fontFamily}}>
      <div style={{fontSize:13,color:T.textMuted}}>
        {erroLoad ? `Erro: ${erroLoad}` : !cliente ? "Cliente não encontrado." : "Falha ao calcular diagnóstico."}
      </div>
      <button onClick={()=>navigate(`/cliente/${id}`)} style={{padding:"8px 16px",background:T.brand,color:"#000",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
        ← Voltar ao cliente
      </button>
    </div>
  );

  const altos = insightsAltos.length;
  const carteiraCadastrada = a.patrimonioFinanceiro>0;
  const fluxoCadastrado = a.gastos>0&&a.salario>0;

  return (
    <div className="dashboard-container has-sidebar" style={{minHeight:"100vh",background:T.bg,fontFamily:T.fontFamily}}>
      <Sidebar mode="cliente" clienteId={id} clienteNome={cliente?.nome || ""} />
      <Navbar
        showLogout={true}
        actionButtons={[
          {icon:"←",label:"Voltar",variant:"secondary",onClick:()=>navigate(`/cliente/${id}`),title:"Voltar ao cliente"},
          ...(!isCliente ? [{label:"Editar",variant:"secondary",onClick:()=>navigate(`/cliente/${id}`)}] : []),
        ]}
      />

      <button
        onClick={()=>navigate(`/cliente/${id}`)}
        className="floating-nav-btn is-left"
        aria-label="Voltar ao cliente"
      >
        ←
      </button>

      <div className="dashboard-content with-sidebar cliente-zoom pi-diag-page" style={{maxWidth:1280,margin:"0 auto",padding:"28px 28px 60px"}}>

        {/* Grid principal: Hero (esq) + Diagnóstico (dir) */}
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:18,marginBottom:18,alignItems:"start"}}>

        {/* HERO — Identidade + KPIs + contador */}
        <div style={{
          background:"linear-gradient(135deg,rgba(36,55,83,0.92) 0%,rgba(20,31,51,0.96) 55%,rgba(13,19,33,0.98) 100%)",
          border:"0.5px solid rgba(240,162,2,0.25)",
          borderRadius:22,padding:"28px 26px 24px",
          boxShadow:"0 20px 60px -20px rgba(0,0,0,0.7)",
          position:"relative",overflow:"hidden",
        }}>
          <div style={{position:"absolute",top:-120,right:-120,width:340,height:340,background:"radial-gradient(circle,rgba(240,162,2,0.12) 0%,transparent 65%)",pointerEvents:"none",filter:"blur(10px)"}}/>
          <div style={{position:"absolute",bottom:-140,left:-100,width:360,height:360,background:"radial-gradient(circle,rgba(25,130,196,0.08) 0%,transparent 65%)",pointerEvents:"none",filter:"blur(10px)"}}/>

          <div style={{position:"relative",display:"flex",alignItems:"flex-start",gap:18,marginBottom:18,flexWrap:"wrap"}}>
            <div style={{position:"relative",flexShrink:0}}>
              <div style={{position:"absolute",inset:-4,borderRadius:18,background:"linear-gradient(135deg,rgba(240,162,2,0.35),rgba(240,162,2,0.02))",filter:"blur(12px)",opacity:0.55,pointerEvents:"none"}}/>
              <AvatarIcon tipo={cliente.avatar} size={72}/>
            </div>
            <div style={{flex:1,minWidth:240}}>
              <div style={{fontSize:10,color:"#F0A202",textTransform:"uppercase",letterSpacing:"0.2em",marginBottom:6,fontWeight:500,...noEdit}}>Diagnóstico Financeiro</div>
              <div style={{fontSize:24,fontWeight:300,color:T.textPrimary,letterSpacing:"-0.02em",lineHeight:1.15,marginBottom:6}}>
                {cliente.nome||"Cliente"}
              </div>
              <div style={{fontSize:12,color:T.textSecondary,letterSpacing:"0.01em",lineHeight:1.6}}>
                {[a.idade?`${a.idade} anos`:null,cliente.profissao,cliente.cidade&&cliente.uf?`${cliente.cidade} · ${cliente.uf.split("–")[0].trim()}`:cliente.uf].filter(Boolean).join(" · ")}
              </div>
            </div>
            {/* Score circular */}
            <div style={{flexShrink:0}}>
              <ScoreCircle score={a.scoreTotal}/>
            </div>
          </div>

          {/* Explicação do score — o que significa a nota */}
          {(()=>{
            const s = a.scoreTotal;
            const tier = s>=80 ? {label:"Excelente", cor:"#22c55e", desc:"Saúde financeira sólida em todas as áreas."}
                       : s>=60 ? {label:"Bom", cor:"#F0A202", desc:"Bases firmes. Há pontos específicos para melhorar."}
                       : s>=40 ? {label:"Em construção", cor:"#f59e0b", desc:"Estrutura em formação. Áreas exigem atenção imediata."}
                               : {label:"Frágil", cor:"#ef4444", desc:"Riscos estruturais. Plano de ação urgente."};
            return (
              <div style={{position:"relative",padding:"12px 16px",marginBottom:16,background:"rgba(255,255,255,0.02)",border:`0.5px solid ${tier.cor}40`,borderRadius:12,...noEdit}}>
                <div style={{fontSize:9,color:tier.cor,textTransform:"uppercase",letterSpacing:"0.15em",fontWeight:600,marginBottom:4}}>O que significa a nota {s}/100</div>
                <div style={{fontSize:12.5,color:T.textPrimary,lineHeight:1.55,fontWeight:400}}>{tier.desc}</div>
                <div style={{fontSize:10.5,color:T.textMuted,marginTop:5,lineHeight:1.5}}>Média ponderada de 5 áreas: fluxo, reserva, investimentos, proteção e planejamento.</div>
              </div>
            );
          })()}

          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
            <MiniKPI label="Renda/mês" valor={a.salario>0?moedaFull(a.salario):"—"}/>
            <MiniKPI label="Gastos/mês" valor={a.gastos>0?moedaFull(a.gastos):"—"} cor={a.gastos>a.salario&&a.salario>0?"#ef4444":T.textPrimary}/>
            <MiniKPI label="Aporte médio" valor={a.aporteMedio>0?moedaFull(a.aporteMedio):"—"} cor="#22c55e"/>
            <MiniKPI label="Patrimônio total" valor={a.patrimonioTotal>0?moedaFull(a.patrimonioTotal):"—"} cor="#F0A202"/>
          </div>

          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button onClick={()=>document.getElementById("diag-critico")?.scrollIntoView({behavior:"smooth",block:"nearest"})} style={{flex:1,minWidth:130,padding:"10px 14px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.28)",borderRadius:12,cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"border-color 0.15s,box-shadow 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(239,68,68,0.6)";e.currentTarget.style.boxShadow="0 0 12px rgba(239,68,68,0.2)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(239,68,68,0.28)";e.currentTarget.style.boxShadow="none"}}>
              <div style={{fontSize:9,color:"#fca5a5",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,fontWeight:500,...noEdit}}>Alta prioridade</div>
              <div style={{fontSize:20,fontWeight:400,color:"#ef4444"}}>{altos}</div>
            </button>
            <button onClick={()=>document.getElementById("diag-atencao")?.scrollIntoView({behavior:"smooth",block:"nearest"})} style={{flex:1,minWidth:130,padding:"10px 14px",background:"rgba(245,158,11,0.08)",border:"0.5px solid rgba(245,158,11,0.28)",borderRadius:12,cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"border-color 0.15s,box-shadow 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(245,158,11,0.6)";e.currentTarget.style.boxShadow="0 0 12px rgba(245,158,11,0.2)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(245,158,11,0.28)";e.currentTarget.style.boxShadow="none"}}>
              <div style={{fontSize:9,color:"#fcd34d",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,fontWeight:500,...noEdit}}>Atenção</div>
              <div style={{fontSize:20,fontWeight:400,color:"#f59e0b"}}>{medios}</div>
            </button>
            <button onClick={()=>document.getElementById("diag-forte")?.scrollIntoView({behavior:"smooth",block:"nearest"})} style={{flex:1,minWidth:130,padding:"10px 14px",background:"rgba(34,197,94,0.08)",border:"0.5px solid rgba(34,197,94,0.28)",borderRadius:12,cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"border-color 0.15s,box-shadow 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(34,197,94,0.6)";e.currentTarget.style.boxShadow="0 0 12px rgba(34,197,94,0.2)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(34,197,94,0.28)";e.currentTarget.style.boxShadow="none"}}>
              <div style={{fontSize:9,color:"#86efac",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,fontWeight:500,...noEdit}}>Oportunidades</div>
              <div style={{fontSize:20,fontWeight:400,color:"#22c55e"}}>{a.insights.length-altos-medios}</div>
            </button>
          </div>

          {top3Riscos.length>0&&(
            <div style={{position:"relative",marginTop:18,padding:"16px 18px",background:"rgba(239,68,68,0.06)",border:"0.5px solid rgba(239,68,68,0.28)",borderRadius:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"#ef4444",boxShadow:"0 0 8px #ef4444"}}/>
                <div style={{fontSize:10,color:"#fca5a5",textTransform:"uppercase",letterSpacing:"0.15em",fontWeight:600,...noEdit}}>Pontos que precisam de ação imediata</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {top3Riscos.map((r,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:T.textPrimary,lineHeight:1.4}}>
                    <span style={{fontSize:15,flexShrink:0}}>{r.icon}</span>
                    <span style={{flex:1,fontWeight:400}}>{r.titulo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>{/* end hero */}

          {/* COLUNA DIREITA: Diagnóstico detalhado (todos os pilares) */}
          <div id="col-diagnostico" style={{position:"sticky",top:80,maxHeight:"calc(100vh - 100px)",overflowY:"auto",borderRadius:18}}>
            <SectionCard titulo="Check-up da sua Saúde Financeira" subtitulo="Diagnóstico de 5 áreas da vida financeira. Nota final de 0 a 100. Clique em cada pilar para ver detalhes." accent="#F0A202">
              <ScoreHero a={a} compact clienteId={id} navigate={navigate}/>
            </SectionCard>
          </div>
        </div>{/* end grid */}

        {/* ═══ SLIDE 2: CTA GRANDE — PRÓXIMO PASSO É A CARTEIRA ═══ */}
        {!carteiraCadastrada&&(
          <div style={{
            position:"relative",overflow:"hidden",
            background:"linear-gradient(135deg,rgba(240,162,2,0.14) 0%,rgba(240,162,2,0.04) 70%)",
            border:"0.5px solid rgba(240,162,2,0.45)",
            borderRadius:22,padding:"28px 26px",marginBottom:18,
            boxShadow:"0 20px 50px -20px rgba(240,162,2,0.25)",
          }}>
            <div style={{position:"absolute",top:-80,right:-80,width:260,height:260,background:"radial-gradient(circle,rgba(240,162,2,0.22) 0%,transparent 60%)",pointerEvents:"none",filter:"blur(10px)"}}/>
            <div style={{position:"relative"}}>
              <div style={{fontSize:10,color:"#F0A202",textTransform:"uppercase",letterSpacing:"0.2em",marginBottom:10,fontWeight:600,...noEdit}}>Próximo passo · o mais importante</div>
              <div style={{fontSize:22,fontWeight:300,color:T.textPrimary,letterSpacing:"-0.01em",lineHeight:1.25,marginBottom:10}}>
                Vamos ver sua carteira de investimentos
              </div>
              <div style={{fontSize:13,color:T.textSecondary,lineHeight:1.7,marginBottom:18,maxWidth:620}}>
                Saber exatamente onde está cada real do seu dinheiro é o ponto de partida. Cada investimento tem seu risco e seu rendimento. Juntos vamos ver <b style={{color:"#F0A202"}}>o que ajustar para você chegar na liberdade financeira mais rápido e com menos risco</b>.
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:10,marginBottom:20}}>
                <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:10}}>
                  <div style={{fontSize:16,marginBottom:4}}>📊</div>
                  <div style={{fontSize:11,color:T.textPrimary,fontWeight:500,lineHeight:1.3}}>Análise de diversificação</div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>Evitar concentração em um único ativo</div>
                </div>
                <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:10}}>
                  <div style={{fontSize:16,marginBottom:4}}>⚖️</div>
                  <div style={{fontSize:11,color:T.textPrimary,fontWeight:500,lineHeight:1.3}}>Grau de risco dos ativos</div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>O que pode perder tudo vs. segurança</div>
                </div>
                <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:10}}>
                  <div style={{fontSize:16,marginBottom:4}}>🎯</div>
                  <div style={{fontSize:11,color:T.textPrimary,fontWeight:500,lineHeight:1.3}}>Alinhamento com objetivos</div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>Se vai te levar onde quer chegar</div>
                </div>
                <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:10}}>
                  <div style={{fontSize:16,marginBottom:4}}>💸</div>
                  <div style={{fontSize:11,color:T.textPrimary,fontWeight:500,lineHeight:1.3}}>Custos ocultos</div>
                  <div style={{fontSize:10,color:T.textMuted,marginTop:2}}>Taxas que estão drenando seu retorno</div>
                </div>
              </div>
              <button
                onClick={()=>navigate(`/cliente/${id}/carteira`)}
                style={{
                  padding:"15px 28px",background:"linear-gradient(135deg,#F0A202,#c88502)",
                  border:"0.5px solid rgba(240,162,2,0.6)",borderRadius:12,
                  color:"#0D1321",fontSize:12,fontWeight:600,letterSpacing:"0.12em",
                  textTransform:"uppercase",cursor:"pointer",fontFamily:"inherit",
                  boxShadow:"0 8px 24px rgba(240,162,2,0.35)",
                }}>
                Cadastrar carteira agora →
              </button>
            </div>
          </div>
        )}

        {/* ═══ INDEPENDÊNCIA FINANCEIRA ═══ */}
        {a.magicNumber>0&&(
          <SectionCard titulo="Sua Independência Financeira" subtitulo="O patrimônio que permite viver de renda para sempre. Regra dos 4% (Trinity Study)." accent="#F0A202">
            <LiberdadeHero a={a}/>
          </SectionCard>
        )}

        {/* ═══ PLANO 90 DIAS (destaque) ═══ */}
        {a.plano90.length>0&&(
          <SectionCard icon="📋" titulo="O que fazer nos próximos 90 dias" subtitulo="Passos priorizados para começar já" accent="#ec4899">
            {a.plano90.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:14,padding:"12px 0",borderBottom:i<a.plano90.length-1?`0.5px solid ${T.border}`:"none"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:"rgba(236,72,153,0.1)",border:"0.5px solid rgba(236,72,153,0.35)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#ec4899",fontWeight:500,flexShrink:0,...noEdit}}>{i+1}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:9,color:"#f9a8d4",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:3,fontWeight:500,...noEdit}}>{p.prazo}</div>
                  <div style={{fontSize:13,color:T.textPrimary,lineHeight:1.5,letterSpacing:"0.01em",display:"flex",flexDirection:"column",gap:4}}>
                    {splitFrases(p.acao).map((f,k)=><div key={k}>{f}</div>)}
                  </div>
                </div>
              </div>
            ))}
          </SectionCard>
        )}

        {/* ═══ PROTEÇÃO PATRIMONIAL (movida para destaque) ═══ */}
        <div id="sec-blindagem" style={{scrollMarginTop:80}}/>
        <SectionCard icon="🛡️" titulo="Blindagem Patrimonial" subtitulo="As 5 camadas de proteção do seu patrimônio e família" accent="#a78bfa">
          <ProtecaoItem label="Reserva de emergência" ok={a.protecoes.reserva} desc={a.liquidezDiaria>0?`${moedaFull(a.liquidezDiaria)} . ${a.mesesCobertos.toFixed(1)} meses cobertos (ideal: 6)`:`Ideal: ${moedaFull(a.reservaIdeal)} em liquidez`}/>
          <ProtecaoItem label="Seguro de veículos" ok={a.protecoes.seguroCarro} desc={a.carrosSemSeguro>0?`${a.carrosSemSeguro} veículo(s) sem seguro`:"Proteção contra sinistros"}/>
          <ProtecaoItem label="Seguro de vida" ok={a.protecoes.seguroVida} desc={a.temDependentes?a.temSeguroVidaFlag?"Cobertura contratada":"Família exposta em caso de imprevistos":"Sem dependentes financeiros"}/>
          <ProtecaoItem label="Previdência privada" ok={a.protecoes.previdencia} desc={a.temPrevidenciaFlag?"VGBL/PGBL ativo":"Oportunidade fiscal + sucessão"}/>
          <ProtecaoItem label="Planejamento sucessório" ok={a.protecoes.sucessao} desc={a.temDependentes?a.temPlanoSucessorioFlag?"Estruturado":"Evita ITCMD + inventário (4-20% do patrimônio)":"Sem dependentes"}/>
        </SectionCard>

        {/* ═══ PROJEÇÃO DE APOSENTADORIA ═══ */}
        {a.idade&&a.anosAte60>0&&(
          <SectionCard icon="🌴" titulo={`Projeção aos ${a.idadeDesejadaAposentar} anos`} subtitulo={`Patrimônio + aporte + rentabilidade real em ${a.anosAte60} anos (${a.rentReal.toFixed(1)}% a.a. real)`} accent="#22c55e">
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))",gap:14}}>
              <div style={{padding:"14px 16px",background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12}}>
                <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,fontWeight:500}}>Patrimônio Hoje</div>
                <div style={{fontSize:18,fontWeight:400,color:T.textPrimary}}>{formatMi(a.patrimonioFinanceiro)}</div>
              </div>
              <div style={{padding:"14px 16px",background:"rgba(34,197,94,0.06)",border:"0.5px solid rgba(34,197,94,0.22)",borderRadius:12}}>
                <div style={{fontSize:9,color:"#86efac",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,fontWeight:500}}>Patrimônio aos {a.idadeDesejadaAposentar}</div>
                <div style={{fontSize:18,fontWeight:400,color:"#22c55e"}}>{formatMi(a.patAos60)}</div>
              </div>
              <div style={{padding:"14px 16px",background:"rgba(240,162,2,0.06)",border:"0.5px solid rgba(240,162,2,0.22)",borderRadius:12}}>
                <div style={{fontSize:9,color:"#fcd34d",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,fontWeight:500}}>Renda Passiva Estimada</div>
                <div style={{fontSize:18,fontWeight:400,color:"#F0A202"}}>{moedaFull(a.rendaPassivaAos60)}/mês</div>
              </div>
            </div>
            {a.gastos>0&&(
              <div style={{marginTop:14,padding:"12px 14px",background:a.rendaPassivaAos60>=a.gastos?"rgba(34,197,94,0.06)":"rgba(239,68,68,0.06)",border:`0.5px solid ${a.rendaPassivaAos60>=a.gastos?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)"}`,borderRadius:10}}>
                <div style={{fontSize:11,color:a.rendaPassivaAos60>=a.gastos?"#86efac":"#fca5a5",lineHeight:1.6,letterSpacing:"0.01em"}}>
                  {a.rendaPassivaAos60>=a.gastos
                    ? `✅ Renda passiva (${moedaFull(a.rendaPassivaAos60)}) supera gastos atuais (${moedaFull(a.gastos)}). Rota segura.`
                    : `⚠ Gap mensal: ${moedaFull(a.gastos-a.rendaPassivaAos60)}. Precisamos ajustar: aportar mais, render mais ou postergar aposentadoria.`}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ═══ DISTRIBUIÇÃO PATRIMONIAL ═══ */}
        {a.distribuicao.length>0&&(
          <SectionCard icon="🏛️" titulo="Como seu patrimônio está dividido" subtitulo={`Total de ${formatMi(a.patrimonioTotal)}. Veja quanto você tem em cada tipo de bem.`} accent="#60a5fa">
            <DistBar items={a.distribuicao} total={a.patrimonioTotal}/>
          </SectionCard>
        )}

        {/* ═══ FAMÍLIA — só aparece quando tem dependentes ═══ */}
        {a.temDependentes&&(
          <SectionCard icon="👨‍👩‍👧" titulo="Sua Família" subtitulo="Planejamento para quem depende de você" accent="#ec4899">
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:12}}>
              {a.temConjuge&&(
                <div style={{padding:"14px 16px",background:"rgba(236,72,153,0.06)",border:"0.5px solid rgba(236,72,153,0.22)",borderRadius:12}}>
                  <div style={{fontSize:18,marginBottom:6}}>💍</div>
                  <div style={{fontSize:13,color:T.textPrimary,fontWeight:500,marginBottom:4}}>{a.estadoCivil}</div>
                  <div style={{fontSize:11,color:T.textMuted,lineHeight:1.5}}>Regime de bens e sucessão precisam estar alinhados. VGBL nominado ao cônjuge acelera transmissão.</div>
                </div>
              )}
              {a.filhos.length>0&&(
                <div style={{padding:"14px 16px",background:"rgba(96,165,250,0.06)",border:"0.5px solid rgba(96,165,250,0.22)",borderRadius:12}}>
                  <div style={{fontSize:18,marginBottom:6}}>🎓</div>
                  <div style={{fontSize:13,color:T.textPrimary,fontWeight:500,marginBottom:4}}>{a.filhos.length} filho(s)</div>
                  <div style={{fontSize:11,color:T.textMuted,lineHeight:1.5}}>{a.objetivos.includes("educacao")?"Educação marcada como objetivo. Vamos dimensionar caixinha por filho.":"Educação (faculdade) pode custar R$ 400k+ por filho. Caixinha dedicada."}</div>
                </div>
              )}
              <div style={{padding:"14px 16px",background:"rgba(167,139,250,0.06)",border:"0.5px solid rgba(167,139,250,0.22)",borderRadius:12}}>
                <div style={{fontSize:18,marginBottom:6}}>🏛️</div>
                <div style={{fontSize:13,color:T.textPrimary,fontWeight:500,marginBottom:4}}>Sucessão patrimonial</div>
                <div style={{fontSize:11,color:T.textMuted,lineHeight:1.5}}>{a.temPlanoSucessorioFlag?"Estrutura já montada. Revisão periódica garante alinhamento.":"Sem plano, inventário pode levar 2-5 anos e custar 4-20% do patrimônio."}</div>
              </div>
              {a.objetivos.includes("viagem")&&(
                <div style={{padding:"14px 16px",background:"rgba(34,197,94,0.06)",border:"0.5px solid rgba(34,197,94,0.22)",borderRadius:12}}>
                  <div style={{fontSize:18,marginBottom:6}}>✈️</div>
                  <div style={{fontSize:13,color:T.textPrimary,fontWeight:500,marginBottom:4}}>{cliente.proximaViagemPlanejada?cliente.proximaViagemPlanejada:"Próxima viagem"}</div>
                  <div style={{fontSize:11,color:T.textMuted,lineHeight:1.5}}>{cliente.proximaViagemPlanejada?"Caixinha com vencimento alinhado à data da viagem.":"Qual seria sua próxima viagem em família? Vamos planejar sem tirar do capital principal."}</div>
                </div>
              )}
              {a.objetivos.includes("imovel")&&(
                <div style={{padding:"14px 16px",background:"rgba(240,162,2,0.06)",border:"0.5px solid rgba(240,162,2,0.22)",borderRadius:12}}>
                  <div style={{fontSize:18,marginBottom:6}}>🏡</div>
                  <div style={{fontSize:13,color:T.textPrimary,fontWeight:500,marginBottom:4}}>Casa dos sonhos</div>
                  <div style={{fontSize:11,color:T.textMuted,lineHeight:1.5}}>Comprar à vista ou montar uma carteira que paga o aluguel pra sempre. Em 20 anos a carteira costuma render mais, mas qualidade de vida também conta.</div>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* ═══ CTA FLUXO MENSAL — "Onde você gasta" ═══ */}
        {!fluxoCadastrado&&(
          <div style={{
            position:"relative",overflow:"hidden",
            background:"linear-gradient(135deg,rgba(34,197,94,0.10) 0%,rgba(34,197,94,0.02) 70%)",
            border:"0.5px solid rgba(34,197,94,0.35)",
            borderRadius:22,padding:"24px 24px",marginBottom:18,
          }}>
            <div style={{position:"absolute",bottom:-80,right:-80,width:240,height:240,background:"radial-gradient(circle,rgba(34,197,94,0.18) 0%,transparent 60%)",pointerEvents:"none",filter:"blur(10px)"}}/>
            <div style={{position:"relative"}}>
              <div style={{fontSize:10,color:"#86efac",textTransform:"uppercase",letterSpacing:"0.2em",marginBottom:10,fontWeight:600,...noEdit}}>Próximo capítulo</div>
              <div style={{fontSize:20,fontWeight:300,color:T.textPrimary,letterSpacing:"-0.01em",lineHeight:1.25,marginBottom:10}}>
                Descobrir onde seu dinheiro realmente vai
              </div>
              <div style={{fontSize:13,color:T.textSecondary,lineHeight:1.7,marginBottom:16,maxWidth:620}}>
                Quase toda família encontra <b style={{color:"#86efac"}}>entre 15% e 25% de gastos que não fazem diferença</b> quando mapeia o mês todo. Esse dinheiro, investido, pode te dar a liberdade financeira anos antes.
              </div>
              <button
                onClick={()=>navigate(`/cliente/${id}/fluxo`)}
                style={{
                  padding:"13px 24px",background:"rgba(34,197,94,0.15)",
                  border:"0.5px solid rgba(34,197,94,0.45)",borderRadius:11,
                  color:"#22c55e",fontSize:11,fontWeight:600,letterSpacing:"0.12em",
                  textTransform:"uppercase",cursor:"pointer",fontFamily:"inherit",
                }}>
                Abrir fluxo mensal detalhado →
              </button>
            </div>
          </div>
        )}

        {/* ═══ INSIGHTS ═══ */}
        {a.insights.length>0&&(
          <>
            <div style={{fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.18em",marginTop:24,marginBottom:14,fontWeight:500,...noEdit}}>
              Insights Personalizados ({a.insights.length})
            </div>
            {a.insights.map((ins,i)=>{
              const n = NIVEIS[ins.nivel];
              return (
                <div key={i} style={{background:n.bg,border:`0.5px solid ${n.borda}`,borderRadius:16,padding:"18px 20px",marginBottom:12,position:"relative",overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                    <div style={{fontSize:28,flexShrink:0,lineHeight:1}}>{ins.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:8,padding:"3px 8px",borderRadius:20,background:`${n.cor}22`,color:n.cor,letterSpacing:"0.1em",fontWeight:600,...noEdit}}>{n.label}</span>
                      </div>
                      <div style={{fontSize:15,fontWeight:500,color:T.textPrimary,marginBottom:10,letterSpacing:"-0.01em",lineHeight:1.3}}>{ins.titulo}</div>
                      <div style={{marginBottom:12}}>
                        <FrasesLista texto={ins.texto} cor={n.cor} tamanho={12} />
                      </div>
                      <div style={{fontSize:11,color:n.cor,fontWeight:500,letterSpacing:"0.01em",lineHeight:1.5,borderLeft:`2px solid ${n.cor}`,paddingLeft:10}}>
                        → {ins.cta}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ═══ CTA FINAL ═══ */}
        <div style={{
          marginTop:24,background:"linear-gradient(135deg,rgba(240,162,2,0.12),rgba(240,162,2,0.02))",
          border:"0.5px solid rgba(240,162,2,0.35)",borderRadius:18,padding:"26px 22px",textAlign:"center",
        }}>
          <div style={{fontSize:20,fontWeight:500,color:T.textPrimary,marginBottom:8,letterSpacing:"-0.01em"}}>
            Gostou do diagnóstico? Vamos fundo.
          </div>
          <div style={{fontSize:12,color:T.textSecondary,marginBottom:20,lineHeight:1.65,letterSpacing:"0.01em",maxWidth:540,margin:"0 auto 20px"}}>
            O próximo passo é <b style={{color:"#F0A202"}}>mapear seus investimentos</b> em detalhe. Depois, se quiser, a gente cadastra os <b style={{color:"#60a5fa"}}>ganhos e gastos mensais da família</b>. Aí sim montamos um planejamento completo, por objetivo.
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={()=>navigate(`/cliente/${id}/carteira`)} style={{padding:"13px 24px",background:"rgba(240,162,2,0.15)",border:"0.5px solid rgba(240,162,2,0.45)",borderRadius:10,color:"#F0A202",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.1em",fontWeight:500,textTransform:"uppercase"}}>
              1 · Cadastrar carteira
            </button>
            <button onClick={()=>navigate(`/cliente/${id}/fluxo`)} style={{padding:"13px 24px",background:"rgba(96,165,250,0.10)",border:"0.5px solid rgba(96,165,250,0.35)",borderRadius:10,color:"#60a5fa",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.1em",fontWeight:500,textTransform:"uppercase"}}>
              2 · Fluxo mensal
            </button>
            <button onClick={()=>navigate(`/cliente/${id}/objetivos`)} style={{padding:"13px 24px",background:"rgba(34,197,94,0.10)",border:"0.5px solid rgba(34,197,94,0.35)",borderRadius:10,color:"#22c55e",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.1em",fontWeight:500,textTransform:"uppercase"}}>
              3 · Montar objetivos
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
