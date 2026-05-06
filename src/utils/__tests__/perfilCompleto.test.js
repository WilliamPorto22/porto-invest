import { describe, it, expect } from "vitest";
import { perfilCompleto } from "../perfilCompleto";

// Helper: monta um cliente com perfil COMPLETO via lançamentos do FluxoMensal
// e ativos na carteira. Toda regra ativa pelo caminho "novo" (sem fallback).
function clienteCompleto(overrides = {}) {
  return {
    nome: "João da Silva",
    email: "joao@exemplo.com",
    objetivos: [{ id: "obj-1", titulo: "Aposentadoria" }],
    fluxoLancamentos: [
      { tipo: "receita", valor: "500000" }, // R$ 5.000,00
      { tipo: "despesa", valor: "200000" }, // R$ 2.000,00
    ],
    carteira: {
      acoesAtivos: [{ ticker: "PETR4", valor: "1000000" }],
    },
    ...overrides,
  };
}

describe("perfilCompleto — shape do retorno", () => {
  it("retorna objeto com { completo, total, feitos, itens }", () => {
    const r = perfilCompleto(clienteCompleto());
    expect(r).toHaveProperty("completo");
    expect(r).toHaveProperty("total");
    expect(r).toHaveProperty("feitos");
    expect(r).toHaveProperty("itens");
  });

  it("total é sempre 5 (cadastro, objetivo, receita, despesa, carteira)", () => {
    expect(perfilCompleto({}).total).toBe(5);
    expect(perfilCompleto(clienteCompleto()).total).toBe(5);
    expect(perfilCompleto(null).total).toBe(5);
  });

  it("itens tem shape { key, label, feito, rota }", () => {
    const { itens } = perfilCompleto(clienteCompleto());
    expect(itens).toHaveLength(5);
    for (const it of itens) {
      expect(it).toHaveProperty("key");
      expect(it).toHaveProperty("label");
      expect(typeof it.feito).toBe("boolean");
      expect(typeof it.rota).toBe("string");
    }
  });

  it("feitos é a contagem de itens com feito=true", () => {
    const r = perfilCompleto(clienteCompleto());
    expect(r.feitos).toBe(r.itens.filter((i) => i.feito).length);
  });
});

describe("perfilCompleto — caminho feliz", () => {
  it("retorna completo=true quando todas as 5 regras passam", () => {
    const r = perfilCompleto(clienteCompleto());
    expect(r.completo).toBe(true);
    expect(r.feitos).toBe(5);
  });

  it("aceita fallbacks legacy: salarioMensal + gastosMensaisManual + patrimonio", () => {
    const cliente = {
      nome: "Maria",
      email: "maria@exemplo.com",
      objetivos: [{ id: "1" }],
      salarioMensal: "500000",
      gastosMensaisManual: "200000",
      patrimonio: "10000000",
    };
    const r = perfilCompleto(cliente);
    expect(r.completo).toBe(true);
  });
});

describe("perfilCompleto — entradas inválidas", () => {
  it("não quebra com cliente null", () => {
    const r = perfilCompleto(null);
    expect(r.completo).toBe(false);
    expect(r.feitos).toBe(0);
  });

  it("não quebra com cliente undefined", () => {
    const r = perfilCompleto(undefined);
    expect(r.completo).toBe(false);
    expect(r.feitos).toBe(0);
  });

  it("cliente vazio {} → tudo false", () => {
    const r = perfilCompleto({});
    expect(r.completo).toBe(false);
    expect(r.feitos).toBe(0);
  });
});

describe("perfilCompleto — regra de cadastro pessoal", () => {
  function buscar(itens) {
    return itens.find((i) => i.key === "cadastro");
  }

  it("exige nome E email", () => {
    expect(buscar(perfilCompleto({}).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ nome: "X" }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ email: "x@y.com" }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ nome: "X", email: "x@y.com" }).itens).feito).toBe(true);
  });

  it("nome ou email vazios contam como ausentes", () => {
    expect(buscar(perfilCompleto({ nome: "", email: "x@y.com" }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ nome: "X", email: "" }).itens).feito).toBe(false);
  });
});

describe("perfilCompleto — regra de objetivo", () => {
  function buscar(itens) {
    return itens.find((i) => i.key === "objetivo");
  }

  it("exige objetivos não vazio", () => {
    expect(buscar(perfilCompleto({}).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ objetivos: [] }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ objetivos: [{ id: "1" }] }).itens).feito).toBe(true);
  });

  it("objetivos não-array é tratado como ausente", () => {
    expect(buscar(perfilCompleto({ objetivos: null }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ objetivos: "alguma coisa" }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ objetivos: {} }).itens).feito).toBe(false);
  });
});

describe("perfilCompleto — regra de receita", () => {
  function buscar(itens) {
    return itens.find((i) => i.key === "receita");
  }

  it("aceita lançamento receita com valor positivo", () => {
    const cliente = {
      fluxoLancamentos: [{ tipo: "receita", valor: "100" }],
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(true);
  });

  it("ignora lançamento de outro tipo", () => {
    const cliente = {
      fluxoLancamentos: [{ tipo: "despesa", valor: "100000" }],
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(false);
  });

  it("ignora receita com valor zero", () => {
    const cliente = {
      fluxoLancamentos: [{ tipo: "receita", valor: "0" }],
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(false);
  });

  it("usa fallback salarioMensal quando não há lançamentos", () => {
    expect(buscar(perfilCompleto({ salarioMensal: "100" }).itens).feito).toBe(true);
    expect(buscar(perfilCompleto({ salarioMensal: "0" }).itens).feito).toBe(false);
    expect(buscar(perfilCompleto({ salarioMensal: null }).itens).feito).toBe(false);
  });

  it("lançamento receita > 0 vence sobre salarioMensal=0", () => {
    const cliente = {
      fluxoLancamentos: [{ tipo: "receita", valor: "100" }],
      salarioMensal: "0",
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(true);
  });
});

describe("perfilCompleto — regra de despesa", () => {
  function buscar(itens) {
    return itens.find((i) => i.key === "despesa");
  }

  it("aceita lançamento despesa com valor positivo", () => {
    const cliente = {
      fluxoLancamentos: [{ tipo: "despesa", valor: "100" }],
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(true);
  });

  it("ignora despesa zero", () => {
    const cliente = {
      fluxoLancamentos: [{ tipo: "despesa", valor: "0" }],
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(false);
  });

  it("usa fallback gastosMensaisManual", () => {
    expect(buscar(perfilCompleto({ gastosMensaisManual: "100" }).itens).feito).toBe(true);
    expect(buscar(perfilCompleto({ gastosMensaisManual: "0" }).itens).feito).toBe(false);
  });
});

describe("perfilCompleto — regra de carteira", () => {
  function buscar(itens) {
    return itens.find((i) => i.key === "carteira");
  }

  it("aceita ativo com valor positivo em qualquer das 14 classes", () => {
    const classes = [
      "posFixado", "ipca", "preFixado", "acoes", "fiis", "multi",
      "prevVGBL", "prevPGBL", "globalEquities", "globalTreasury",
      "globalFunds", "globalBonds", "global", "outros",
    ];
    for (const k of classes) {
      const cliente = { carteira: { [k + "Ativos"]: [{ valor: "100" }] } };
      expect(buscar(perfilCompleto(cliente).itens).feito).toBe(true);
    }
  });

  it("ignora classes com array vazio", () => {
    const cliente = { carteira: { acoesAtivos: [] } };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(false);
  });

  it("ignora ativo com valor zero", () => {
    const cliente = { carteira: { acoesAtivos: [{ valor: "0" }] } };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(false);
  });

  it("aceita fallback agregado legacy: carteira[classe] string em centavos", () => {
    const cliente = { carteira: { posFixado: "100" } };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(true);
  });

  it("aceita último fallback: cliente.patrimonio", () => {
    expect(buscar(perfilCompleto({ patrimonio: "100" }).itens).feito).toBe(true);
    expect(buscar(perfilCompleto({ patrimonio: "0" }).itens).feito).toBe(false);
  });

  it("um ativo com valor positivo entre vários zero ainda completa", () => {
    const cliente = {
      carteira: {
        acoesAtivos: [
          { valor: "0" },
          { valor: "0" },
          { valor: "100" },
        ],
      },
    };
    expect(buscar(perfilCompleto(cliente).itens).feito).toBe(true);
  });
});

describe("perfilCompleto — combinações parciais", () => {
  it("falta só carteira → completo=false, feitos=4", () => {
    const cliente = {
      nome: "X",
      email: "x@y.com",
      objetivos: [{ id: "1" }],
      salarioMensal: "100",
      gastosMensaisManual: "50",
    };
    const r = perfilCompleto(cliente);
    expect(r.completo).toBe(false);
    expect(r.feitos).toBe(4);
  });

  it("falta receita e despesa → feitos=3", () => {
    const cliente = {
      nome: "X",
      email: "x@y.com",
      objetivos: [{ id: "1" }],
      patrimonio: "10000000",
    };
    const r = perfilCompleto(cliente);
    expect(r.completo).toBe(false);
    expect(r.feitos).toBe(3);
  });
});
