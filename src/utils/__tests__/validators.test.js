import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidCPF,
  isValidDate,
  isValidPhone,
  isValidAmount,
  isValidName,
  getValidationError,
} from "../validators";

describe("isValidEmail", () => {
  it("aceita emails válidos comuns", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("william.porto+test@gmail.com")).toBe(true);
  });

  it("rejeita emails sem @", () => {
    expect(isValidEmail("user.example.com")).toBe(false);
  });

  it("rejeita emails sem TLD", () => {
    expect(isValidEmail("user@example")).toBe(false);
  });

  it("rejeita emails com espaço", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
    expect(isValidEmail("user@ example.com")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isValidEmail("")).toBe(false);
  });
});

describe("isValidCPF", () => {
  it("aceita CPF com exatos 11 dígitos", () => {
    expect(isValidCPF("12345678901")).toBe(true);
  });

  it("aceita CPF com formatação (limpa pontuação)", () => {
    expect(isValidCPF("123.456.789-01")).toBe(true);
  });

  it("rejeita CPF curto", () => {
    expect(isValidCPF("123")).toBe(false);
    expect(isValidCPF("1234567890")).toBe(false);
  });

  it("rejeita CPF longo", () => {
    expect(isValidCPF("123456789012")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isValidCPF("")).toBe(false);
  });

  it("aceita 11 dígitos mesmo que sejam todos repetidos (não valida dígito verificador)", () => {
    // Documenta limitação: validação é só de comprimento.
    expect(isValidCPF("11111111111")).toBe(true);
  });
});

describe("isValidDate", () => {
  it("aceita data válida em DD/MM/AAAA", () => {
    expect(isValidDate("15/01/2026")).toBe(true);
    expect(isValidDate("01/12/1990")).toBe(true);
  });

  it("rejeita formato errado de comprimento", () => {
    expect(isValidDate("15/01/26")).toBe(false);
    expect(isValidDate("1/1/2026")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });

  it("rejeita mês fora de 1-12", () => {
    expect(isValidDate("15/00/2026")).toBe(false);
    expect(isValidDate("15/13/2026")).toBe(false);
  });

  it("rejeita dia fora de 1-31", () => {
    expect(isValidDate("00/01/2026")).toBe(false);
    expect(isValidDate("32/01/2026")).toBe(false);
  });

  it("rejeita ano fora do intervalo 1900-2100", () => {
    expect(isValidDate("01/01/1899")).toBe(false);
    expect(isValidDate("01/01/2101")).toBe(false);
  });

  it("rejeita null/undefined sem crashar", () => {
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
});

describe("isValidPhone", () => {
  it("aceita 10 dígitos (fixo BR)", () => {
    expect(isValidPhone("1133224455")).toBe(true);
    expect(isValidPhone("(11) 3322-4455")).toBe(true);
  });

  it("aceita 11 dígitos (celular BR com 9)", () => {
    expect(isValidPhone("11933224455")).toBe(true);
    expect(isValidPhone("(11) 93322-4455")).toBe(true);
  });

  it("rejeita curto demais", () => {
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("133224455")).toBe(false); // 9 dígitos
  });

  it("rejeita longo demais", () => {
    expect(isValidPhone("119332244550")).toBe(false); // 12 dígitos
  });
});

describe("isValidAmount", () => {
  it("aceita valor positivo em número", () => {
    expect(isValidAmount(100)).toBe(true);
    expect(isValidAmount("100")).toBe(true);
  });

  it("aceita string formatada com R$", () => {
    expect(isValidAmount("R$ 100,00")).toBe(true);
  });

  it("rejeita zero", () => {
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount("0")).toBe(false);
  });

  it("rejeita null/undefined/vazio", () => {
    expect(isValidAmount(null)).toBe(false);
    expect(isValidAmount(undefined)).toBe(false);
    expect(isValidAmount("")).toBe(false);
  });

  it("rejeita string sem dígitos", () => {
    expect(isValidAmount("abc")).toBe(false);
  });
});

describe("isValidName", () => {
  it("aceita nome com 3+ caracteres", () => {
    expect(isValidName("Ana")).toBe(true);
    expect(isValidName("William Porto")).toBe(true);
  });

  it("rejeita nome curto", () => {
    expect(isValidName("Jo")).toBe(false);
    expect(isValidName("AB")).toBe(false);
  });

  it("trata só espaços como vazio", () => {
    expect(isValidName("   ")).toBe(false);
  });

  it("rejeita null/undefined/vazio sem crashar", () => {
    expect(isValidName(null)).toBeFalsy();
    expect(isValidName(undefined)).toBeFalsy();
    expect(isValidName("")).toBeFalsy();
  });
});

describe("getValidationError", () => {
  it("email: retorna null se válido, mensagem se inválido", () => {
    expect(getValidationError("Email", "user@x.com", "email")).toBeNull();
    expect(getValidationError("Email", "invalido", "email")).toBe("E-mail inválido");
  });

  it("cpf: mensagem com 11 dígitos", () => {
    expect(getValidationError("CPF", "12345678901", "cpf")).toBeNull();
    expect(getValidationError("CPF", "123", "cpf")).toBe("CPF deve ter 11 dígitos");
  });

  it("date: mensagem instrui DD/MM/AAAA", () => {
    expect(getValidationError("Data", "15/01/2026", "date")).toBeNull();
    expect(getValidationError("Data", "abc", "date")).toBe("Data inválida (use DD/MM/AAAA)");
  });

  it("phone: mensagem padrão", () => {
    expect(getValidationError("Tel", "11933224455", "phone")).toBeNull();
    expect(getValidationError("Tel", "1", "phone")).toBe("Telefone inválido");
  });

  it("amount: mensagem padrão", () => {
    expect(getValidationError("Valor", "R$ 100,00", "amount")).toBeNull();
    expect(getValidationError("Valor", "0", "amount")).toBe("Valor inválido");
  });

  it("name: mensagem com mínimo de caracteres", () => {
    expect(getValidationError("Nome", "Ana", "name")).toBeNull();
    expect(getValidationError("Nome", "Jo", "name")).toBe("Nome deve ter no mínimo 3 caracteres");
  });

  it("required: monta mensagem usando o nome do campo", () => {
    expect(getValidationError("Email", "qualquer", "required")).toBeNull();
    expect(getValidationError("Email", "", "required")).toBe("Email é obrigatório");
    expect(getValidationError("Email", "   ", "required")).toBe("Email é obrigatório");
    expect(getValidationError("Email", null, "required")).toBe("Email é obrigatório");
  });

  it("type desconhecido retorna null", () => {
    expect(getValidationError("X", "qualquer", "tipoQueNaoExiste")).toBeNull();
  });
});
