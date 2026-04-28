// Onboarding guiado de primeiro acesso ao Fluxo Mensal.
// Aparece uma unica vez por cliente. Salva flag em fluxo._onboarded.
import React, { useState } from "react";

const STEPS = [
  {
    icon: "👋",
    titulo: "Bem-vindo ao seu fluxo",
    texto:
      "Em poucos minutos voce tera uma visao completa do que entra e sai todo mes. Vamos juntos.",
  },
  {
    icon: "💰",
    titulo: "Comece pela sua renda",
    texto:
      "Salario, pro-labore, aluguel recebido, dividendos. Voce pode adicionar quantas fontes precisar.",
  },
  {
    icon: "📊",
    titulo: "Detalhe seus gastos",
    texto:
      "Preencha por categoria. Se quiser acelerar, importe a fatura ou extrato. A gente classifica pra voce.",
  },
  {
    icon: "🎯",
    titulo: "Acompanhe sua saude financeira",
    texto:
      "No topo voce ve um score de 0 a 100 com base na sua margem de poupanca. Bora.",
  },
];

export default function OnboardingWizard({ open, onClose }) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const atual = STEPS[step];
  const ultimo = step === STEPS.length - 1;

  function avancar() {
    if (ultimo) {
      onClose();
    } else {
      setStep(step + 1);
    }
  }

  return (
    <div className="pi-onb-backdrop" role="dialog" aria-modal="true" aria-labelledby="pi-onb-title">
      <div className="pi-onb-modal">
        <button
          type="button"
          className="pi-onb-skip"
          onClick={onClose}
          aria-label="Pular onboarding"
        >
          Pular
        </button>

        <div className="pi-onb-icon" aria-hidden>{atual.icon}</div>

        <div className="pi-onb-title" id="pi-onb-title">{atual.titulo}</div>

        <div className="pi-onb-text">{atual.texto}</div>

        <div className="pi-onb-dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={"pi-onb-dot" + (i === step ? " pi-onb-dot--ativo" : "")}
            />
          ))}
        </div>

        <button
          type="button"
          className="pi-onb-cta"
          onClick={avancar}
        >
          {ultimo ? "Comecar" : "Proximo"}
        </button>
      </div>
    </div>
  );
}
