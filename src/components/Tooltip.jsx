import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip — Ícone (?) com balão explicativo no hover/click.
 * Usado pra explicar termos técnicos em linguagem simples.
 *
 * Renderiza o balão via Portal pra escapar de containers com overflow:hidden.
 *
 * Props:
 *   text — texto da explicação
 *   side — "top" (default) | "bottom"  (apenas direção preferida)
 */
export default function Tooltip({ text, side = "top" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, side });
  const triggerRef = useRef(null);
  const closeTimer = useRef(null);

  const computePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bubbleW = 240;
    const bubbleH = 60; // estimativa
    const margin = 8;

    // Decide o lado dinamicamente (preferência: prop `side`)
    let chosen = side;
    if (side === "top" && r.top < bubbleH + margin) chosen = "bottom";
    if (side === "bottom" && (r.bottom + bubbleH + margin) > vh) chosen = "top";

    // Centraliza horizontalmente no trigger
    const triggerCenter = r.left + r.width / 2;
    let left = triggerCenter - bubbleW / 2;
    if (left < margin) left = margin;
    if (left + bubbleW > vw - margin) left = vw - bubbleW - margin;

    const top = chosen === "top"
      ? r.top - margin // bubble fica acima
      : r.bottom + margin;

    setPos({ top, left, side: chosen, triggerCenter, bubbleW });
  };

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    computePos();
    setOpen(true);
  };

  const scheduleHide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  };

  // Fecha ao rolar / redimensionar
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => setOpen(false);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <span className="pi-tooltip-root">
      <button
        ref={triggerRef}
        type="button"
        className="pi-tooltip-trigger"
        aria-label="Mais informações"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => {
            if (!o) computePos();
            return !o;
          });
        }}
      >
        ?
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <span
          className={`pi-tooltip-bubble pi-tooltip-${pos.side} pi-tooltip-portal`}
          style={{
            top: pos.top,
            left: pos.left,
            // Ajusta variável CSS pra posição da setinha relativa ao bubble
            "--pi-tip-arrow": `${(pos.triggerCenter || 0) - (pos.left || 0)}px`,
          }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
          role="tooltip"
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}
