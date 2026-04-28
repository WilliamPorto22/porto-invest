import { describe, it, expect } from "vitest";
import {
  TAXA_ANUAL,
  IPCA_ANUAL,
  calcularValorFinal,
  encontrarAporteNecessario,
  encontrarAnosNecessarios,
  calcularAnosParaMeta,
  simularNovoAporte,
  simularNovaTaxa,
  simularNovoPrazo,
  calcularProjecao,
  classificarStatus,
  avaliarAporteMensal,
  patrimonioEsperadoAteOMes,
} from "../objetivosCalc";

describe("calcularValorFinal", () => {
  it("sem aporte cresce somente por juros compostos", () => {
    // 12% a.a. é ~0,9489% a.m. — em 1 ano: valor * 1.12
    const v = calcularValorFinal(1000, 0, 1, 12);
    expect(v).toBeCloseTo(1120, 0);
  });

  it("sem capital inicial, só aporte mensal (anuidade)", () => {
    const v = calcularValorFinal(0, 100, 1, 0); // taxa 0 → soma 12 aportes
    expect(v).toBeCloseTo(1200, 5);
  });

  it("prazo zero retorna o valor inicial", () => {
    expect(calcularValorFinal(5000, 100, 0)).toBe(5000);
  });

  it("cresce monotonicamente com o prazo", () => {
    const p1 = calcularValorFinal(1000, 100, 1);
    const p2 = calcularValorFinal(1000, 100, 2);
    expect(p2).toBeGreaterThan(p1);
  });
});

describe("encontrarAporteNecessario", () => {
  it("round-trip: aporte encontrado produz o valor da meta", () => {
    const meta = 500_000;
    const inicial = 10_000;
    const prazo = 10;
    const aporte = encontrarAporteNecessario(inicial, meta, prazo);
    const valor = calcularValorFinal(inicial, aporte, prazo);
    // tolerância de 1% — busca binária arredonda pra cima
    expect(valor).toBeGreaterThanOrEqual(meta);
    expect(valor).toBeLessThan(meta * 1.01);
  });

  it("retorna 0 se inicial já atinge a meta", () => {
    expect(encontrarAporteNecessario(1000, 500, 5)).toBe(0);
  });

  it("prazo zero exige o delta imediato", () => {
    expect(encontrarAporteNecessario(1000, 5000, 0)).toBe(4000);
  });

  it("taxa maior reduz aporte necessário", () => {
    const aA = encontrarAporteNecessario(0, 1_000_000, 20, 8);
    const aB = encontrarAporteNecessario(0, 1_000_000, 20, 14);
    expect(aB).toBeLessThan(aA);
  });
});

describe("encontrarAnosNecessarios", () => {
  it("retorna null quando meta é inalcançável no período", () => {
    // aporte 1/mês não leva a 1 milhão real em 50 anos
    expect(encontrarAnosNecessarios(0, 1, 1_000_000)).toBe(null);
  });

  it("retorna anos positivos para cenário viável", () => {
    const anos = encontrarAnosNecessarios(10_000, 1_000, 100_000);
    expect(anos).toBeGreaterThan(0);
    expect(anos).toBeLessThan(50);
  });

  it("aceita objeto de opções { taxaAnual, ipcaAnual, maxAnos }", () => {
    // Usa meta modesta para ambos os cenários serem alcançáveis
    const anosBaixa = encontrarAnosNecessarios(0, 1000, 100_000, {
      taxaAnual: 5,
      ipcaAnual: 4,
    });
    const anosAlta = encontrarAnosNecessarios(0, 1000, 100_000, {
      taxaAnual: 20,
      ipcaAnual: 4,
    });
    expect(anosBaixa).toBeGreaterThan(0);
    expect(anosAlta).toBeGreaterThan(0);
    expect(anosAlta).toBeLessThan(anosBaixa);
  });

  it("retorna null consistentemente para metas inalcançáveis", () => {
    const r = encontrarAnosNecessarios(0, 1000, 1_000_000, {
      taxaAnual: 5,
      ipcaAnual: 4,
    });
    expect(r).toBeNull();
  });

  it("aceita assinatura legada (inicial, aporte, meta, maxAnos, taxa)", () => {
    const anos = encontrarAnosNecessarios(10_000, 1_000, 50_000, 50, 14);
    expect(anos).toBeGreaterThan(0);
  });

  it("calcularAnosParaMeta é alias funcional", () => {
    const a = encontrarAnosNecessarios(10_000, 1000, 100_000, { taxaAnual: 10 });
    const b = calcularAnosParaMeta(10_000, 1000, 100_000, { taxaAnual: 10 });
    expect(a).toBe(b);
  });
});

describe("classificarStatus", () => {
  it("viavel quando anosNec <= prazoDesejado", () => {
    expect(classificarStatus(5, 10)).toBe("viavel");
    expect(classificarStatus(10, 10)).toBe("viavel");
  });

  it("ajustavel quando desvio <= 2 anos", () => {
    expect(classificarStatus(11, 10)).toBe("ajustavel");
    expect(classificarStatus(12, 10)).toBe("ajustavel");
  });

  it("inviavel quando desvio > 2 anos ou null", () => {
    expect(classificarStatus(13, 10)).toBe("inviavel");
    expect(classificarStatus(null, 10)).toBe("inviavel");
    expect(classificarStatus(undefined, 10)).toBe("inviavel");
  });
});

describe("calcularProjecao", () => {
  it("retorna uma entrada por ano", () => {
    const tabela = calcularProjecao(1000, 100, 5);
    expect(tabela).toHaveLength(5);
    expect(tabela[0].ano).toBe(1);
    expect(tabela[4].ano).toBe(5);
  });

  it("totalReal é menor que totalNominal por causa da inflação", () => {
    const [t1] = calcularProjecao(10_000, 500, 1, { taxaAnual: 14, ipcaAnual: 5 });
    expect(t1.totalReal).toBeLessThan(t1.totalNominal);
  });

  it("valores crescem ano a ano", () => {
    const tabela = calcularProjecao(1000, 100, 10);
    for (let i = 1; i < tabela.length; i++) {
      expect(tabela[i].totalNominal).toBeGreaterThan(tabela[i - 1].totalNominal);
    }
  });

  it("aceita taxa como número (assinatura legada)", () => {
    const a = calcularProjecao(1000, 100, 3, 14);
    const b = calcularProjecao(1000, 100, 3, { taxaAnual: 14 });
    expect(a[2].totalNominal).toBe(b[2].totalNominal);
  });

  it("prazo 0 retorna tabela vazia", () => {
    expect(calcularProjecao(1000, 100, 0)).toEqual([]);
  });
});

describe("simularNovoAporte / simularNovaTaxa / simularNovoPrazo", () => {
  it("aumentar aporte reduz prazo necessário", () => {
    const s = simularNovoAporte(0, 500_000, 20, 3000);
    expect(s.viavel).toBe(true);
    expect(s.prazoNovo).toBeLessThanOrEqual(20);
  });

  it("taxa maior reduz prazo", () => {
    const s = simularNovaTaxa(0, 1000, 100_000, 20, 20);
    expect(s.viavel).toBe(true);
    expect(s.taxaNova).toBe(20);
  });

  it("estender prazo reduz aporte necessário", () => {
    const s = simularNovoPrazo(0, 2000, 200_000, 30);
    expect(s.aporteNecessario).toBeLessThan(2000);
    expect(s.reducao).toBeGreaterThan(0);
    expect(s.viavel).toBe(true);
  });
});

describe("avaliarAporteMensal", () => {
  it("100% quando realizado === meta", () => {
    const r = avaliarAporteMensal(100_000, 100_000);
    expect(r.atingiu).toBe(true);
    expect(r.percentual).toBe(100);
    expect(r.diferenca).toBe(0);
  });

  it("detecta não-atingimento e retorna diferença negativa", () => {
    const r = avaliarAporteMensal(50_000, 100_000);
    expect(r.atingiu).toBe(false);
    expect(r.percentual).toBe(50);
    expect(r.diferenca).toBe(-50_000);
  });

  it("meta zero = sempre atingiu", () => {
    const r = avaliarAporteMensal(0, 0);
    expect(r.atingiu).toBe(true);
    expect(r.percentual).toBe(100);
  });
});

describe("patrimonioEsperadoAteOMes", () => {
  it("cresce com o número de meses", () => {
    const a = patrimonioEsperadoAteOMes(1000, 100, 1);
    const b = patrimonioEsperadoAteOMes(1000, 100, 12);
    expect(b).toBeGreaterThan(a);
  });

  it("mes 0 retorna o inicial", () => {
    expect(patrimonioEsperadoAteOMes(5000, 100, 0)).toBe(5000);
  });
});

describe("constantes exportadas", () => {
  it("TAXA_ANUAL e IPCA_ANUAL são números positivos", () => {
    expect(typeof TAXA_ANUAL).toBe("number");
    expect(typeof IPCA_ANUAL).toBe("number");
    expect(TAXA_ANUAL).toBeGreaterThan(0);
    expect(IPCA_ANUAL).toBeGreaterThan(0);
  });
});
