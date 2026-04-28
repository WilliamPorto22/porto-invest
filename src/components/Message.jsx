import { useEffect, useState } from "react";

/**
 * Componente reutilizável para exibir mensagens
 * Tipos: success, error, warning, info
 */
export function Message({ text, type = "info", duration = 4000, onClose }) {
  // Visibilidade derivada diretamente do prop + um flag local para auto-hide após `duration`.
  // Evita o anti-pattern de setState síncrono dentro de useEffect.
  const [dismissed, setDismissed] = useState(false);

  // Reseta o dismiss sempre que o texto muda (nova mensagem = mostrar de novo)
  useEffect(() => {
    setDismissed(false);
  }, [text]);

  // Timer de auto-hide
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => {
      setDismissed(true);
      onClose?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [text, duration, onClose]);

  const isVisible = !!text && !dismissed;
  if (!isVisible) return null;

  const bgColors = {
    success: "rgba(34, 197, 94, 0.08)",
    error: "rgba(239, 68, 68, 0.08)",
    warning: "rgba(245, 158, 11, 0.08)",
    info: "rgba(96, 165, 250, 0.08)",
  };

  const borderColors = {
    success: "rgba(34, 197, 94, 0.2)",
    error: "rgba(239, 68, 68, 0.2)",
    warning: "rgba(245, 158, 11, 0.2)",
    info: "rgba(96, 165, 250, 0.2)",
  };

  const textColors = {
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#60a5fa",
  };

  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <div
      style={{
        background: bgColors[type],
        border: `0.5px solid ${borderColors[type]}`,
        borderRadius: 8,
        padding: "11px 14px",
        fontSize: 12,
        color: textColors[type],
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 10,
        lineHeight: 1.5,
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <span style={{ fontSize: 14 }}>{icons[type]}</span>
      <span style={{ flex: 1 }}>{text}</span>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          fontSize: 16,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
