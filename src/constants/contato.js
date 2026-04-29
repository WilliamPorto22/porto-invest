// Contatos públicos para CTAs de venda (Login, landing, footers).
//
// IMPORTANTE: atualize WHATSAPP_VENDA com o número real do William.
// Formato: "55" + DDD + número, sem espaços ou pontuação.
// Ex: "5511999998888" (Brasil + DDD 11 + 99999-8888)
export const WHATSAPP_VENDA = "5511999998888"; // ⚠️ TROCAR PELO NÚMERO REAL

export const EMAIL_VENDA = "williamporto0@gmail.com";

// Mensagem default que abre pré-preenchida quando o lead clica no CTA do Login.
export const MENSAGEM_VENDA_DEFAULT =
  "Olá William, vi sua plataforma e quero entender como funciona a assinatura.";

// URL completa wa.me com mensagem pré-preenchida
export function whatsappUrl(numero = WHATSAPP_VENDA, mensagem = MENSAGEM_VENDA_DEFAULT) {
  const limpo = String(numero || "").replace(/\D/g, "");
  return `https://wa.me/${limpo}?text=${encodeURIComponent(mensagem)}`;
}
