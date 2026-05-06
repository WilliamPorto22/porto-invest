import { describe, it, expect } from "vitest";
import {
  calcularScoreFinanceiro,
  FAIXA_LABEL,
  FAIXA_COR,
} from "../scoreFinanceiro";

// Helper para gerar input completo com defaults sensíveis
function input(overrides = {}) {
  return {
    renda: 10000,
    gastos: 6000,
    sobra: 4000,
    totalCategorias: 10,
    categoriasPreenchidas: 7,
    ...overrides,
  };
}

describe("calcularScoreFinanceiro — sem renda", () => {
  it("renda 0 → score 0, faixa indefinido, componentes null", () => {
    const r = calcularScoreFinanceiro(input({ renda: 0 }));
    expect(r).toEqual({ score: 0, faixa: "indefinido", componentes: null });
  });

  it("renda undefined → indefinido", () => {
    const r = calcularScoreFinanceiro(input({ renda: undefined }));
    expect(r.faixa).toBe("indefinido");
  });

  it("renda negativa → indefinido", () => {
    const r = calcularScoreFinanceiro(input({ renda: -1000 }));
    expect(r.faixa).toBe("indefinido");
  });
});

describe("calcularScoreFinanceiro — componente Margem (sobra/renda)", () => {
  function pMargem(txSobra) {
    const renda = 10000;
    const sobra = renda * txSobra;
    return calcularScoreFinanceiro(
      input({ renda, sobra, gastos: 0, totalCategorias: 0, categoriasPreenchidas: 0 })
    ).componentes.margem;
  }

  it("sobra >= 30% → 50 pontos", () => {
    expect(pMargem(0.30)).toBe(50);
    expect(pMargem(0.50)).toBe(50);
  });

  it("sobra entre 20% e 30% → 40 pontos", () => {
    expect(pMargem(0.20)).toBe(40);
    expect(pMargem(0.25)).toBe(40);
  });

  it("sobra entre 10% e 20% → 28 pontos", () => {
    expect(pMargem(0.10)).toBe(28);
    expect(pMargem(0.15)).toBe(28);
  });

  it("sobra entre 5% e 10% → 18 pontos", () => {
    expect(pMargem(0.05)).toBe(18);
    expect(pMargem(0.07)).toBe(18);
  });

  it("sobra entre 0 e 5% → 10 pontos", () => {
    expect(pMargem(0)).toBe(10);
    expect(pMargem(0.04)).toBe(10);
  });

  it("sobra negativa → 0 pontos", () => {
    expect(pMargem(-0.10)).toBe(0);
  });
});

describe("calcularScoreFinanceiro — componente Comprometimento (gastos/renda)", () => {
  function pComp(txGasto) {
    const renda = 10000;
    const gastos = renda * txGasto;
    return calcularScoreFinanceiro(
      input({ renda, gastos, sobra: 0, totalCategorias: 0, categoriasPreenchidas: 0 })
    ).componentes.comprometimento;
  }

  it("gastos < 60% → 30 pontos", () => {
    expect(pComp(0.30)).toBe(30);
    expect(pComp(0.59)).toBe(30);
  });

  it("gastos entre 60% e 75% → 22 pontos", () => {
    expect(pComp(0.60)).toBe(22);
    expect(pComp(0.74)).toBe(22);
  });

  it("gastos entre 75% e 90% → 14 pontos", () => {
    expect(pComp(0.75)).toBe(14);
    expect(pComp(0.89)).toBe(14);
  });

  it("gastos entre 90% e 100% → 7 pontos", () => {
    expect(pComp(0.90)).toBe(7);
    expect(pComp(0.99)).toBe(7);
  });

  it("gastos >= 100% → 0 pontos", () => {
    expect(pComp(1.00)).toBe(0);
    expect(pComp(1.20)).toBe(0);
  });
});

describe("calcularScoreFinanceiro — componente Detalhamento (categorias)", () => {
  function pDet(preenchidas, total) {
    return calcularScoreFinanceiro(
      input({
        totalCategorias: total,
        categoriasPreenchidas: preenchidas,
        sobra: 0,
        gastos: 0,
      })
    ).componentes.detalhamento;
  }

  it("ratio >= 70% → 20 pontos", () => {
    expect(pDet(7, 10)).toBe(20);
    expect(pDet(10, 10)).toBe(20);
  });

  it("ratio entre 50% e 70% → 14 pontos", () => {
    expect(pDet(5, 10)).toBe(14);
    expect(pDet(6, 10)).toBe(14);
  });

  it("ratio entre 30% e 50% → 8 pontos", () => {
    expect(pDet(3, 10)).toBe(8);
    expect(pDet(4, 10)).toBe(8);
  });

  it("ratio > 0 e < 30% → 4 pontos", () => {
    expect(pDet(1, 10)).toBe(4);
    expect(pDet(2, 10)).toBe(4);
  });

  it("ratio = 0 → 0 pontos", () => {
    expect(pDet(0, 10)).toBe(0);
  });

  it("totalCategorias = 0 → ratio 0, 0 pontos (sem div por zero)", () => {
    expect(pDet(5, 0)).toBe(0);
  });
});

describe("calcularScoreFinanceiro — score final e faixa", () => {
  it("perfeito: sobra 50% + gastos 50% + det 100% → 100 excelente", () => {
    const r = calcularScoreFinanceiro({
      renda: 10000, sobra: 5000, gastos: 5000,
      totalCategorias: 10, categoriasPreenchidas: 10,
    });
    expect(r.score).toBe(100);
    expect(r.faixa).toBe("excelente");
  });

  it("score >= 80 → excelente", () => {
    // 50 (sobra 30%) + 22 (gastos 70%) + 14 (det 50%) = 86
    const r = calcularScoreFinanceiro({
      renda: 10000, sobra: 3000, gastos: 7000,
      totalCategorias: 10, categoriasPreenchidas: 5,
    });
    expect(r.score).toBe(86);
    expect(r.faixa).toBe("excelente");
  });

  it("score >= 60 e < 80 → boa", () => {
    // 28 (sobra 10%) + 22 (gastos 70%) + 14 (det 50%) = 64
    const r = calcularScoreFinanceiro({
      renda: 10000, sobra: 1000, gastos: 7000,
      totalCategorias: 10, categoriasPreenchidas: 5,
    });
    expect(r.score).toBe(64);
    expect(r.faixa).toBe("boa");
  });

  it("score >= 40 e < 60 → atencao", () => {
    // 18 (sobra 5%) + 22 (gastos 70%) + 4 (det 10%) = 44
    const r = calcularScoreFinanceiro({
      renda: 10000, sobra: 500, gastos: 7000,
      totalCategorias: 10, categoriasPreenchidas: 1,
    });
    expect(r.score).toBe(44);
    expect(r.faixa).toBe("atencao");
  });

  it("score < 40 → critica", () => {
    // 0 (sobra negativa) + 0 (gastos >100%) + 0 (det 0) = 0
    const r = calcularScoreFinanceiro({
      renda: 10000, sobra: -1000, gastos: 11000,
      totalCategorias: 10, categoriasPreenchidas: 0,
    });
    expect(r.score).toBe(0);
    expect(r.faixa).toBe("critica");
  });

  it("retorna shape { score, faixa, componentes: { margem, comprometimento, detalhamento } }", () => {
    const r = calcularScoreFinanceiro(input());
    expect(r.componentes).toHaveProperty("margem");
    expect(r.componentes).toHaveProperty("comprometimento");
    expect(r.componentes).toHaveProperty("detalhamento");
    expect(r.componentes.margem + r.componentes.comprometimento + r.componentes.detalhamento)
      .toBe(r.score);
  });
});

describe("FAIXA_LABEL e FAIXA_COR", () => {
  it("FAIXA_LABEL tem todas as 5 faixas possíveis", () => {
    expect(FAIXA_LABEL.excelente).toBeDefined();
    expect(FAIXA_LABEL.boa).toBeDefined();
    expect(FAIXA_LABEL.atencao).toBeDefined();
    expect(FAIXA_LABEL.critica).toBeDefined();
    expect(FAIXA_LABEL.indefinido).toBeDefined();
  });

  it("FAIXA_COR tem todas as 5 faixas em formato hex", () => {
    for (const k of ["excelente", "boa", "atencao", "critica", "indefinido"]) {
      expect(FAIXA_COR[k]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
