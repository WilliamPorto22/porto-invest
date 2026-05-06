import { describe, it, expect } from "vitest";
import {
  CLASSES_CARTEIRA,
  TIPO_OBJETIVO_PARA_LABEL,
  LABEL_PARA_TIPO_OBJETIVO,
  OBJETIVO_LABELS,
  OBJETIVO_TIPOS,
  criarObjetivoStub,
  garantirObjetivosVinculados,
  listarAtivosCarteira,
  ativosDoObjetivo,
  atualizarVinculoAtivos,
  somaAtivosReais,
} from "../ativos";

describe("CLASSES_CARTEIRA — sanity", () => {
  it("tem exatamente 14 classes", () => {
    expect(CLASSES_CARTEIRA).toHaveLength(14);
  });

  it("cada classe tem { key, label, cor, liq }", () => {
    for (const c of CLASSES_CARTEIRA) {
      expect(c).toHaveProperty("key");
      expect(c).toHaveProperty("label");
      expect(c).toHaveProperty("cor");
      expect(c).toHaveProperty("liq");
    }
  });

  it("keys são únicas", () => {
    const keys = CLASSES_CARTEIRA.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("inclui as classes esperadas pelo modelo de dados", () => {
    const keys = CLASSES_CARTEIRA.map((c) => c.key);
    expect(keys).toContain("posFixado");
    expect(keys).toContain("ipca");
    expect(keys).toContain("acoes");
    expect(keys).toContain("fiis");
    expect(keys).toContain("globalEquities");
    expect(keys).toContain("outros");
  });
});

describe("TIPO_OBJETIVO_PARA_LABEL ↔ LABEL_PARA_TIPO_OBJETIVO — consistência", () => {
  it("LABEL_PARA_TIPO é o reverse map exato de TIPO_PARA_LABEL", () => {
    for (const [tipo, label] of Object.entries(TIPO_OBJETIVO_PARA_LABEL)) {
      expect(LABEL_PARA_TIPO_OBJETIVO[label]).toBe(tipo);
    }
  });

  it("OBJETIVO_TIPOS tem os mesmos ids das chaves de TIPO_OBJETIVO_PARA_LABEL", () => {
    const idsTipos = new Set(OBJETIVO_TIPOS.map((t) => t.id));
    const idsMapa = new Set(Object.keys(TIPO_OBJETIVO_PARA_LABEL));
    expect(idsTipos).toEqual(idsMapa);
  });

  it("OBJETIVO_LABELS contém apenas labels válidos do mapa", () => {
    for (const label of OBJETIVO_LABELS) {
      expect(LABEL_PARA_TIPO_OBJETIVO[label]).toBeDefined();
    }
  });
});

describe("criarObjetivoStub", () => {
  it("retorna null para label desconhecido", () => {
    expect(criarObjetivoStub("Inexistente")).toBeNull();
    expect(criarObjetivoStub("")).toBeNull();
    expect(criarObjetivoStub(null)).toBeNull();
    expect(criarObjetivoStub(undefined)).toBeNull();
  });

  it("retorna stub completo para label válido", () => {
    const stub = criarObjetivoStub("Aposentadoria");
    expect(stub).toMatchObject({
      tipo: "aposentadoria",
      label: "Aposentadoria e Liberdade Financeira",
      patrimSource: "ativos",
      ativosVinculados: [],
      _stub: true,
      criadoAutomaticamente: true,
    });
  });

  it("usa o label LONGO de OBJETIVO_TIPOS, não o label curto do select", () => {
    // Label de seleção: "Aquisição de Imóvel"
    // Label esperado no stub: "Aquisição de Imóvel" (mesmo neste caso)
    // Já um caso onde difere: "Sucessão" → "Sucessão Patrimonial"
    const stub = criarObjetivoStub("Sucessão");
    expect(stub.label).toBe("Sucessão Patrimonial");
  });
});

describe("garantirObjetivosVinculados", () => {
  it("retorna lista original quando carteira não tem ativos vinculados", () => {
    const lista = [{ tipo: "aposentadoria" }];
    const r = garantirObjetivosVinculados({}, lista);
    expect(r).toBe(lista); // mesma referência
  });

  it("não duplica quando o objetivo já existe na lista", () => {
    const lista = [{ tipo: "aposentadoria" }];
    const carteira = {
      acoesAtivos: [{ id: "a1", objetivo: "Aposentadoria" }],
    };
    const r = garantirObjetivosVinculados(carteira, lista);
    expect(r).toHaveLength(1);
  });

  it("adiciona stub quando ativo aponta pra objetivo inexistente", () => {
    const lista = [];
    const carteira = {
      fiisAtivos: [{ id: "f1", objetivo: "Liquidez" }],
    };
    const r = garantirObjetivosVinculados(carteira, lista);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "liquidez", _stub: true });
  });

  it("adiciona múltiplos stubs distintos", () => {
    const carteira = {
      acoesAtivos: [{ id: "a1", objetivo: "Aposentadoria" }],
      fiisAtivos: [{ id: "f1", objetivo: "Liquidez" }],
    };
    const r = garantirObjetivosVinculados(carteira, []);
    expect(r).toHaveLength(2);
  });

  it("aceita objetivosAtuais não-array (vira [])", () => {
    const carteira = { acoesAtivos: [{ id: "a1", objetivo: "Liquidez" }] };
    const r = garantirObjetivosVinculados(carteira, null);
    expect(r).toHaveLength(1);
  });

  it("ignora ativos com label de objetivo desconhecido", () => {
    const carteira = { acoesAtivos: [{ id: "a1", objetivo: "Inexistente" }] };
    const r = garantirObjetivosVinculados(carteira, []);
    expect(r).toEqual([]);
  });
});

describe("listarAtivosCarteira", () => {
  it("retorna [] para carteira null/undefined/{}", () => {
    expect(listarAtivosCarteira(null)).toEqual([]);
    expect(listarAtivosCarteira(undefined)).toEqual([]);
    expect(listarAtivosCarteira({})).toEqual([]);
  });

  it("expande 1 ativo numa classe com metadados completos", () => {
    const carteira = {
      acoesAtivos: [{ id: "a1", nome: "PETR4", valor: "100000" }],
    };
    const r = listarAtivosCarteira(carteira);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: "a1",
      nome: "PETR4",
      classeKey: "acoes",
      classeLabel: "Ações",
      valorReais: 1000, // 100000 centavos
    });
    expect(r[0].classeCor).toBeDefined();
    expect(r[0].liq).toBeDefined();
  });

  it("concatena ativos de múltiplas classes na ordem de CLASSES_CARTEIRA", () => {
    const carteira = {
      fiisAtivos: [{ id: "f1", valor: "200000" }],
      acoesAtivos: [{ id: "a1", valor: "100000" }],
    };
    const r = listarAtivosCarteira(carteira);
    expect(r).toHaveLength(2);
    // CLASSES_CARTEIRA tem acoes ANTES de fiis
    expect(r[0].classeKey).toBe("acoes");
    expect(r[1].classeKey).toBe("fiis");
  });

  it("converte valor centavos→reais corretamente", () => {
    const carteira = { acoesAtivos: [{ valor: "12345" }] };
    expect(listarAtivosCarteira(carteira)[0].valorReais).toBe(123.45);
  });
});

describe("ativosDoObjetivo", () => {
  it("retorna [] para tipo desconhecido", () => {
    expect(ativosDoObjetivo({}, "INEXISTENTE")).toEqual([]);
    expect(ativosDoObjetivo({}, null)).toEqual([]);
  });

  it("retorna [] quando carteira não tem ativos do tipo", () => {
    const carteira = {
      acoesAtivos: [{ id: "a1", objetivo: "Liquidez" }],
    };
    expect(ativosDoObjetivo(carteira, "aposentadoria")).toEqual([]);
  });

  it("retorna apenas ativos cujo .objetivo bate com o label do tipo", () => {
    const carteira = {
      acoesAtivos: [
        { id: "a1", objetivo: "Aposentadoria", valor: "100000" },
        { id: "a2", objetivo: "Liquidez", valor: "200000" },
      ],
      fiisAtivos: [{ id: "f1", objetivo: "Aposentadoria", valor: "300000" }],
    };
    const r = ativosDoObjetivo(carteira, "aposentadoria");
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.id).sort()).toEqual(["a1", "f1"]);
  });

  it("ativo sem campo .objetivo é ignorado", () => {
    const carteira = {
      acoesAtivos: [
        { id: "a1", valor: "100000" }, // sem objetivo
        { id: "a2", objetivo: "", valor: "200000" }, // string vazia
      ],
    };
    expect(ativosDoObjetivo(carteira, "aposentadoria")).toEqual([]);
  });
});

describe("atualizarVinculoAtivos", () => {
  it("retorna a carteira inalterada para tipo desconhecido", () => {
    const c = { acoesAtivos: [{ id: "a1" }] };
    expect(atualizarVinculoAtivos(c, "INEXISTENTE", [])).toBe(c);
  });

  it("marca ativo selecionado com o label do tipo", () => {
    const c = { acoesAtivos: [{ id: "a1", valor: "100000" }] };
    const r = atualizarVinculoAtivos(c, "aposentadoria", [
      { classeKey: "acoes", ativoId: "a1" },
    ]);
    expect(r.acoesAtivos[0].objetivo).toBe("Aposentadoria");
  });

  it("desmarca ativo que tinha o label mas saiu da seleção", () => {
    const c = { acoesAtivos: [{ id: "a1", objetivo: "Aposentadoria" }] };
    const r = atualizarVinculoAtivos(c, "aposentadoria", []);
    expect(r.acoesAtivos[0].objetivo).toBe("");
  });

  it("não toca em ativo já marcado e ainda selecionado", () => {
    const original = { id: "a1", objetivo: "Aposentadoria", valor: "100000" };
    const c = { acoesAtivos: [original] };
    const r = atualizarVinculoAtivos(c, "aposentadoria", [
      { classeKey: "acoes", ativoId: "a1" },
    ]);
    expect(r.acoesAtivos[0]).toBe(original); // mesma referência
  });

  it("não desmarca ativo cujo objetivo é de OUTRO tipo", () => {
    const c = { acoesAtivos: [{ id: "a1", objetivo: "Liquidez" }] };
    const r = atualizarVinculoAtivos(c, "aposentadoria", []);
    expect(r.acoesAtivos[0].objetivo).toBe("Liquidez");
  });

  it("aceita carteira null e devolve novo objeto", () => {
    const r = atualizarVinculoAtivos(null, "aposentadoria", []);
    expect(r).toEqual({});
  });
});

describe("somaAtivosReais", () => {
  it("retorna 0 para array null/undefined/[]", () => {
    expect(somaAtivosReais(null)).toBe(0);
    expect(somaAtivosReais(undefined)).toBe(0);
    expect(somaAtivosReais([])).toBe(0);
  });

  it("soma valorReais de cada ativo", () => {
    expect(somaAtivosReais([
      { valorReais: 100 },
      { valorReais: 250.5 },
      { valorReais: 0 },
    ])).toBe(350.5);
  });

  it("ignora ativos sem valorReais (trata como 0)", () => {
    expect(somaAtivosReais([
      { valorReais: 100 },
      { nome: "X" },
      { valorReais: 50 },
    ])).toBe(150);
  });
});
