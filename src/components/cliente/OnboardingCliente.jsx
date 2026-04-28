import { useEffect, useState } from "react";

/**
 * OnboardingCliente — Boas-vindas em 4 telas pra cliente que está
 * acessando o Porto Invest pela primeira vez.
 *
 * Persistência: localStorage chave `pi_onboarded_${clienteId}`.
 * Pode ser pulado a qualquer momento via "Pular".
 *
 * Mount-safe: só dispara se a flag está false. Se a app crashar aqui,
 * o SilentBoundary do HomeLiberdade pega.
 */

const TELAS = [
  {
    icone: "👋",
    eyebrow: "Bem-vindo",
    titulo: (nome) => nome ? `Olá, ${nome}!` : "Olá!",
    desc: "Esta é sua plataforma de planejamento financeiro pessoal. Em 4 cards você entende tudo. Vamos lá?",
  },
  {
    icone: "🌴",
    eyebrow: "Sua liberdade",
    titulo: () => "Sua meta principal",
    desc: "No topo da tela você vê quanto precisa juntar pra ter liberdade financeira, quanto já tem hoje, e em que ano você chega lá no ritmo atual.",
  },
  {
    icone: "🎯",
    eyebrow: "Próximos passos",
    titulo: () => "Cards com ações concretas",
    desc: "Cada semana você verá até 3 ações priorizadas pra acelerar seus objetivos: o que fazer primeiro, depois o que fazer em seguida.",
  },
  {
    icone: "💬",
    eyebrow: "Sempre por perto",
    titulo: () => "Fale com seu assessor",
    desc: "No canto inferior direito tem um botão de WhatsApp. Clicou, fala comigo na hora — qualquer dúvida sobre seu plano.",
  },
];

export default function OnboardingCliente({ clienteId, primeiroNome }) {
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);

  // Decide se mostra: só na primeira vez por cliente
  useEffect(() => {
    if (!clienteId) return;
    if (typeof window === "undefined") return;
    try {
      const visto = localStorage.getItem(`pi_onboarded_${clienteId}`);
      if (!visto) {
        // Pequeno delay pra app pintar primeiro
        const t = setTimeout(() => setShow(true), 350);
        return () => clearTimeout(t);
      }
    } catch { /* ignora */ }
  }, [clienteId]);

  function fechar() {
    setClosing(true);
    try {
      localStorage.setItem(`pi_onboarded_${clienteId}`, "1");
    } catch { /* ignora */ }
    setTimeout(() => {
      setShow(false);
      setClosing(false);
      setStep(0);
    }, 280);
  }

  function avancar() {
    if (step < TELAS.length - 1) setStep(step + 1);
    else fechar();
  }

  function voltar() {
    if (step > 0) setStep(step - 1);
  }

  if (!show) return null;

  const tela = TELAS[step];
  const ehUltima = step === TELAS.length - 1;

  return (
    <div
      className={`pi-onb-overlay${closing ? " pi-onb-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pi-onb-titulo"
    >
      <div className="pi-onb-card" key={step}>
        {/* Pular (canto superior direito) */}
        <button className="pi-onb-skip" onClick={fechar} aria-label="Pular boas-vindas">
          Pular
        </button>

        <div className="pi-onb-icone" aria-hidden="true">{tela.icone}</div>
        <div className="pi-onb-eyebrow">{tela.eyebrow}</div>
        <div id="pi-onb-titulo" className="pi-onb-titulo">
          {tela.titulo(primeiroNome)}
        </div>
        <div className="pi-onb-desc">{tela.desc}</div>

        {/* Dots de progresso */}
        <div className="pi-onb-dots">
          {TELAS.map((_, i) => (
            <span
              key={i}
              className={`pi-onb-dot${i === step ? " pi-onb-dot-active" : ""}`}
              onClick={() => setStep(i)}
              role="button"
              tabIndex={0}
              aria-label={`Ir para tela ${i + 1} de ${TELAS.length}`}
            />
          ))}
        </div>

        {/* Botões */}
        <div className="pi-onb-actions">
          {step > 0 ? (
            <button className="pi-onb-btn pi-onb-btn-ghost" onClick={voltar}>
              ← Voltar
            </button>
          ) : (
            <span className="pi-onb-spacer" />
          )}
          <button className="pi-onb-btn pi-onb-btn-primary" onClick={avancar}>
            {ehUltima ? "Começar" : "Próximo →"}
          </button>
        </div>
      </div>
    </div>
  );
}
