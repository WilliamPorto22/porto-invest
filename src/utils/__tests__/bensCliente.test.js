import { describe, it, expect } from "vitest";
import {
  totalImoveis,
  totalVeiculos,
  totalCarteiraCliente,
  patrimonioFinanceiro,
  patrimonioConsolidado,
} from "../bensCliente";

// As faixas seguem o padrão FAIXAS_IMOVEL / FAIXAS_VEICULO em bensCliente.js,
// que espelha as listas em ClienteFicha.jsx. Para testes, uso labels que sei
// que existem nas listas (primeiro intervalo de 100k em imóvel, 10k em veículo).
const IMOVEL_100K = "R$ 100.000,00"; // mid 100000
const IMOVEL_200K = "R$ 200.000,00"; // mid 200000
const IMOVEL_TOPO = "Acima de R$ 10M"; // mid 12000000
const VEICULO_10K = "R$ 10.000,00"; // mid 10000
const VEICULO_50K = "R$ 50.000,00"; // mid 50000
const VEICULO_TOPO = "Acima de R$ 1M"; // mid 1200000

describe("totalImoveis", () => {
  it("retorna 0 para cliente null/undefined/{}", () => {
    expect(totalImoveis(null)).toBe(0);
    expect(totalImoveis(undefined)).toBe(0);
    expect(totalImoveis({})).toBe(0);
  });

  it("retorna 0 quando imoveis não é array", () => {
    expect(totalImoveis({ imoveis: "qualquer" })).toBe(0);
    expect(totalImoveis({ imoveis: null })).toBe(0);
  });

  it("retorna 0 para array vazio", () => {
    expect(totalImoveis({ imoveis: [] })).toBe(0);
  });

  it("retorna 0 quando faixa é desconhecida", () => {
    expect(totalImoveis({ imoveis: [{ faixa: "INEXISTENTE" }] })).toBe(0);
    expect(totalImoveis({ imoveis: [{ faixa: null }] })).toBe(0);
  });

  it("soma 1 imóvel com faixa conhecida e quantidade 1", () => {
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_100K, quantidade: 1 }] })).toBe(100000);
  });

  it("trata quantidade ausente/inválida como 1", () => {
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_100K }] })).toBe(100000);
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_100K, quantidade: 0 }] })).toBe(100000);
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_100K, quantidade: null }] })).toBe(100000);
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_100K, quantidade: -5 }] })).toBe(100000);
  });

  it("multiplica pela quantidade", () => {
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_100K, quantidade: 3 }] })).toBe(300000);
  });

  it("soma vários imóveis de faixas diferentes", () => {
    const cliente = {
      imoveis: [
        { faixa: IMOVEL_100K, quantidade: 1 },
        { faixa: IMOVEL_200K, quantidade: 2 },
      ],
    };
    expect(totalImoveis(cliente)).toBe(100000 + 400000);
  });

  it("aceita faixa de topo (Acima de R$ 10M)", () => {
    expect(totalImoveis({ imoveis: [{ faixa: IMOVEL_TOPO }] })).toBe(12000000);
  });
});

describe("totalVeiculos", () => {
  it("retorna 0 para cliente vazio", () => {
    expect(totalVeiculos(null)).toBe(0);
    expect(totalVeiculos({})).toBe(0);
  });

  it("soma 1 veículo simples", () => {
    expect(totalVeiculos({ veiculos: [{ faixa: VEICULO_10K }] })).toBe(10000);
  });

  it("multiplica pela quantidade", () => {
    expect(totalVeiculos({ veiculos: [{ faixa: VEICULO_50K, quantidade: 2 }] })).toBe(100000);
  });

  it("soma campo legado veiculosManual (string em centavos)", () => {
    expect(totalVeiculos({ veiculosManual: "1000000" })).toBe(10000);
  });

  it("soma veículos + veiculosManual juntos", () => {
    const cliente = {
      veiculos: [{ faixa: VEICULO_10K }],
      veiculosManual: "500000",
    };
    expect(totalVeiculos(cliente)).toBe(10000 + 5000);
  });

  it("aceita faixa de topo (Acima de R$ 1M)", () => {
    expect(totalVeiculos({ veiculos: [{ faixa: VEICULO_TOPO }] })).toBe(1200000);
  });
});

describe("totalCarteiraCliente", () => {
  it("retorna 0 para cliente sem carteira", () => {
    expect(totalCarteiraCliente(null)).toBe(0);
    expect(totalCarteiraCliente({})).toBe(0);
    expect(totalCarteiraCliente({ carteira: {} })).toBe(0);
  });

  it("soma valores em uma classe via array Ativos (centavos -> reais)", () => {
    const cliente = { carteira: { acoesAtivos: [{ valor: "100000" }] } };
    expect(totalCarteiraCliente(cliente)).toBe(1000); // 100000 centavos = R$ 1.000
  });

  it("soma múltiplos ativos numa mesma classe", () => {
    const cliente = {
      carteira: {
        acoesAtivos: [
          { valor: "100000" }, // R$ 1.000
          { valor: "250000" }, // R$ 2.500
        ],
      },
    };
    expect(totalCarteiraCliente(cliente)).toBe(3500);
  });

  it("soma várias classes diferentes", () => {
    const cliente = {
      carteira: {
        acoesAtivos: [{ valor: "100000" }],
        fiisAtivos: [{ valor: "200000" }],
        posFixadoAtivos: [{ valor: "500000" }],
      },
    };
    expect(totalCarteiraCliente(cliente)).toBe(1000 + 2000 + 5000);
  });

  it("usa agregado legacy quando não há array Ativos", () => {
    const cliente = { carteira: { acoes: "150000" } };
    expect(totalCarteiraCliente(cliente)).toBe(1500);
  });

  it("array Ativos VAZIO ignora agregado legacy (quirk documentado)", () => {
    // Quando carteira[k+"Ativos"] existe e é array vazio, o agregado legacy NÃO
    // é usado de fallback — diferente de perfilCompleto.temAtivoNaCarteira.
    const cliente = { carteira: { acoesAtivos: [], acoes: "100000" } };
    expect(totalCarteiraCliente(cliente)).toBe(0);
  });

  it("cobre todas as 14 classes via array Ativos", () => {
    const classes = [
      "posFixado", "ipca", "preFixado", "acoes", "fiis", "multi",
      "prevVGBL", "prevPGBL", "globalEquities", "globalTreasury",
      "globalFunds", "globalBonds", "global", "outros",
    ];
    for (const k of classes) {
      const cliente = { carteira: { [k + "Ativos"]: [{ valor: "100000" }] } };
      expect(totalCarteiraCliente(cliente)).toBe(1000);
    }
  });
});

describe("patrimonioFinanceiro", () => {
  it("retorna 0 para cliente vazio", () => {
    expect(patrimonioFinanceiro(null)).toBe(0);
    expect(patrimonioFinanceiro({})).toBe(0);
  });

  it("retorna soma da carteira quando há ativos", () => {
    const cliente = { carteira: { acoesAtivos: [{ valor: "100000" }] } };
    expect(patrimonioFinanceiro(cliente)).toBe(1000);
  });

  it("usa fallback patrimonio quando carteira é zero", () => {
    expect(patrimonioFinanceiro({ patrimonio: "100000" })).toBe(1000);
  });

  it("prefere carteira > 0 e ignora patrimonio quando ambos existem", () => {
    const cliente = {
      carteira: { acoesAtivos: [{ valor: "100000" }] },
      patrimonio: "999999999",
    };
    expect(patrimonioFinanceiro(cliente)).toBe(1000);
  });
});

describe("patrimonioConsolidado", () => {
  it("retorna 0 para cliente vazio", () => {
    expect(patrimonioConsolidado(null)).toBe(0);
    expect(patrimonioConsolidado({})).toBe(0);
  });

  it("soma financeiro + imóveis + veículos", () => {
    const cliente = {
      carteira: { acoesAtivos: [{ valor: "100000" }] }, // R$ 1.000
      imoveis: [{ faixa: IMOVEL_100K }],                // R$ 100.000
      veiculos: [{ faixa: VEICULO_10K }],               // R$ 10.000
    };
    expect(patrimonioConsolidado(cliente)).toBe(1000 + 100000 + 10000);
  });

  it("soma corretamente com fallback de patrimonio (sem carteira)", () => {
    const cliente = {
      patrimonio: "5000000", // R$ 50.000
      imoveis: [{ faixa: IMOVEL_100K }], // R$ 100.000
    };
    expect(patrimonioConsolidado(cliente)).toBe(50000 + 100000);
  });
});
