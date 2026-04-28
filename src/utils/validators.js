/**
 * Utilitários de validação para formulários
 */

/**
 * Valida email
 */
export function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Valida CPF (básico - apenas formato)
 */
export function isValidCPF(cpf) {
  const cleaned = cpf.replace(/\D/g, "");
  return cleaned.length === 11;
}

/**
 * Valida data no formato DD/MM/AAAA
 */
export function isValidDate(dateStr) {
  if (!dateStr || dateStr.length !== 10) return false;
  const [day, month, year] = dateStr.split("/").map(Number);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;

  const date = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  return date instanceof Date && !isNaN(date);
}

/**
 * Valida telefone (básico)
 */
export function isValidPhone(phone) {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.length >= 10 && cleaned.length <= 11;
}

/**
 * Valida valor em centavos
 */
export function isValidAmount(amount) {
  const parsed = parseInt(String(amount || "0").replace(/\D/g, ""));
  return parsed > 0;
}

/**
 * Valida nome (mínimo 3 caracteres)
 */
export function isValidName(name) {
  return name && name.trim().length >= 3;
}

/**
 * Retorna mensagem de erro baseada no tipo de validação
 */
export function getValidationError(field, value, type) {
  switch (type) {
    case "email":
      return !isValidEmail(value) ? "E-mail inválido" : null;
    case "cpf":
      return !isValidCPF(value) ? "CPF deve ter 11 dígitos" : null;
    case "date":
      return !isValidDate(value) ? "Data inválida (use DD/MM/AAAA)" : null;
    case "phone":
      return !isValidPhone(value) ? "Telefone inválido" : null;
    case "amount":
      return !isValidAmount(value) ? "Valor inválido" : null;
    case "name":
      return !isValidName(value) ? "Nome deve ter no mínimo 3 caracteres" : null;
    case "required":
      return !value || (typeof value === "string" && !value.trim()) ? `${field} é obrigatório` : null;
    default:
      return null;
  }
}
