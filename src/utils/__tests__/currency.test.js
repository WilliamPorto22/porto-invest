import { describe, it, expect } from "vitest";
import {
  parseCentavos,
  centavosToReais,
  reaisToCentavos,
  brl,
  formatMi,
  brlCompact,
  moedaInput,
  moedaFull,
  moeda,
} from "../currency";

describe("parseCentavos", () => {
  it("extrai dígitos de string formatada em BRL", () => {
    expect(parseCentavos("R$ 1.234,56")).toBe(123456);
  });

  it("aceita string com espaços e símbolos variados", () => {
    expect(parseCentavos("  R$  1.000,00  ")).toBe(100000);
    expect(parseCentavos("1.000,00")).toBe(100000);
  });

  it("retorna 0 para null, undefined, vazio", () => {
    expect(parseCentavos(null)).toBe(0);
    expect(parseCentavos(undefined)).toBe(0);
    expect(parseCentavos("")).toBe(0);
    expect(parseCentavos("R$ ")).toBe(0);
  });

  it("aceita número e string numérica", () => {
    expect(parseCentavos(123)).toBe(123);
    expect(parseCentavos("12345")).toBe(12345);
  });

  it("ignora caracteres não numéricos", () => {
    expect(parseCentavos("abc123def456")).toBe(123456);
  });
});

describe("centavosToReais / reaisToCentavos", () => {
  it("converte centavos para reais", () => {
    expect(centavosToReais(123456)).toBe(1234.56);
    expect(centavosToReais(0)).toBe(0);
  });

  it("converte reais para centavos", () => {
    expect(reaisToCentavos(1234.56)).toBe(123456);
    expect(reaisToCentavos(0.01)).toBe(1);
  });

  it("round-trip preserva valor inteiro", () => {
    for (const v of [0, 100, 12345, 999_999_99]) {
      expect(reaisToCentavos(centavosToReais(v))).toBe(v);
    }
  });

  it("trata entradas inválidas como zero", () => {
    expect(centavosToReais(null)).toBe(0);
    expect(reaisToCentavos(null)).toBe(0);
    expect(centavosToReais(NaN)).toBe(0);
  });
});

describe("brl", () => {
  it("formata valores positivos com 2 casas", () => {
    // toLocaleString usa NBSP (\u00A0) entre R$ e o número
    expect(brl(1234.56)).toMatch(/R\$[\s\u00a0]?1\.234,56/);
  });

  it("retorna '—' para zero por padrão", () => {
    expect(brl(0)).toBe("—");
    expect(brl(null)).toBe("—");
    expect(brl(NaN)).toBe("—");
  });

  it("retorna 'R$ 0,00' se zeroAsDash = false", () => {
    expect(brl(0, { zeroAsDash: false })).toMatch(/R\$[\s\u00a0]?0,00/);
  });

  it("respeita minFraction/maxFraction", () => {
    expect(brl(1234, { minFraction: 0, maxFraction: 0 })).toMatch(
      /R\$[\s\u00a0]?1\.234/
    );
  });
});

describe("formatMi", () => {
  it("formata milhões com 'Mi'", () => {
    expect(formatMi(1_500_000)).toBe("R$ 1,50Mi");
    expect(formatMi(2_750_000)).toBe("R$ 2,75Mi");
  });

  it("formata milhares com 'k'", () => {
    expect(formatMi(500_000)).toBe("R$ 500k");
    expect(formatMi(1_234)).toBe("R$ 1k");
  });

  it("usa formato BRL para valores < 1k", () => {
    expect(formatMi(999)).toMatch(/R\$[\s\u00a0]?999,00/);
  });

  it("retorna '—' para zero/null/inválido", () => {
    expect(formatMi(0)).toBe("—");
    expect(formatMi(null)).toBe("—");
    expect(formatMi(NaN)).toBe("—");
  });
});

describe("brlCompact", () => {
  it("usa 'M' (não 'Mi') para milhões", () => {
    expect(brlCompact(1_500_000)).toBe("R$ 1,50M");
  });

  it("usa 'k' com 1 casa decimal", () => {
    expect(brlCompact(5_500)).toBe("R$ 5,5k");
  });
});

describe("moedaInput", () => {
  it("formata centavos para string de input", () => {
    expect(moedaInput(123456)).toMatch(/R\$[\s\u00a0]?1\.234,56/);
  });

  it("retorna string vazia para zero (não '—')", () => {
    expect(moedaInput(0)).toBe("");
    expect(moedaInput(null)).toBe("");
    expect(moedaInput("")).toBe("");
  });
});

describe("moedaFull / moeda", () => {
  it("moedaFull converte centavos e formata", () => {
    expect(moedaFull(123456)).toMatch(/R\$[\s\u00a0]?1\.234,56/);
    expect(moedaFull(0)).toBe("—");
  });

  it("moeda retorna 'R$ 0,00' (não '—') para zero", () => {
    expect(moeda(0)).toBe("R$ 0,00");
    expect(moeda(null)).toBe("R$ 0,00");
  });
});
