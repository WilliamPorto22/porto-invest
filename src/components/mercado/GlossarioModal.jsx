import React, { useEffect } from "react";
import { GLOSSARIO } from "../../constants/glossarioIndicadores";

/**
 * Modal explicativo de um indicador. Mostra:
 *   - Nome completo
 *   - Fórmula
 *   - Interpretação prática
 *   - Faixa saudável
 *   - Observação contextual (quando pode enganar)
 *
 * Props:
 *   indicadorKey : chave no objeto GLOSSARIO (ex: "pl", "pvp", "roe")
 *   onClose      : () => void
 */
export default function GlossarioModal({ indicadorKey, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!indicadorKey) return null;
  const g = GLOSSARIO[indicadorKey];
  if (!g) return null;

  return (
    <div className="gl-overlay" onClick={onClose}>
      <div className="gl-modal" onClick={(e) => e.stopPropagation()}>
        <header className="gl-header">
          <div>
            <div className="gl-abrev">{g.abrev}</div>
            <h2 className="gl-nome">{g.nome}</h2>
          </div>
          <button className="gl-close" onClick={onClose} aria-label="Fechar">✕</button>
        </header>

        <div className="gl-body">
          <div className="gl-secao">
            <div className="gl-label">Fórmula</div>
            <div className="gl-formula">{g.formula}</div>
          </div>

          <div className="gl-secao">
            <div className="gl-label">O que significa na prática</div>
            <div className="gl-texto">{g.interpretacao}</div>
          </div>

          <div className="gl-secao">
            <div className="gl-label">Faixa saudável</div>
            <div className="gl-texto gl-faixa">{g.faixaSaudavel}</div>
          </div>

          <div className="gl-secao gl-observacao">
            <div className="gl-label">⚠ Quando pode enganar</div>
            <div className="gl-texto">{g.observacao}</div>
          </div>
        </div>

        <footer className="gl-footer">
          Abrange ações brasileiras, americanas e FIIs. Para análise aprofundada, consulte balanços completos no site de RI da empresa.
        </footer>
      </div>
    </div>
  );
}
