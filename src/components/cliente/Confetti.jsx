import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Confetti — Celebração quando o cliente bate marcos da meta.
 *
 * Marcos: 25%, 50%, 75%, 100%.
 * Cada marco celebra UMA vez por cliente (persiste em localStorage).
 *
 * Props:
 *   pct        — % atual da meta (0-100)
 *   clienteId  — id do cliente (chave do localStorage)
 */

const MARCOS = [25, 50, 75, 100];
const MENSAGENS = {
  25:  "1/4 do caminho! Continue firme.",
  50:  "Metade do caminho! 🚀",
  75:  "Quase lá! Falta pouco.",
  100: "Meta atingida! Liberdade conquistada.",
};

const CORES = ["#F0A202", "#FFB20F", "#1982C4", "#00CC66", "#F0EBD8", "#ef4444"];

export default function Confetti({ pct, clienteId }) {
  const [show, setShow] = useState(false);
  const [marco, setMarco] = useState(null);
  const ja = useRef(false);

  useEffect(() => {
    if (!clienteId || pct == null || ja.current) return;
    if (typeof window === "undefined") return;

    const chave = `pi_marcos_${clienteId}`;
    let celebrados = [];
    try {
      celebrados = JSON.parse(localStorage.getItem(chave) || "[]");
    } catch { /* ignora */ }

    // Maior marco já atingido pelo pct atual e ainda não celebrado
    const candidato = [...MARCOS].reverse().find(
      m => pct >= m && !celebrados.includes(m)
    );
    if (!candidato) return;

    ja.current = true;
    setMarco(candidato);
    setShow(true);

    // Persiste pra não repetir
    try {
      localStorage.setItem(chave, JSON.stringify([...celebrados, candidato]));
    } catch { /* ignora */ }

    // Esconde após 5s
    const t = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(t);
  }, [pct, clienteId]);

  // Gera 60 partículas com posições e delays aleatórios — calculado uma vez
  // quando entra em modo visível (geração não-determinística é intencional aqui:
  // confetti decorativo precisa parecer aleatório).
  /* eslint-disable react-hooks/purity */
  const particulas = useMemo(() => {
    if (!show) return [];
    return Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      dur: 2.4 + Math.random() * 1.4,
      cor: CORES[i % CORES.length],
      size: 6 + Math.random() * 6,
      rot: Math.random() * 360,
    }));
  }, [show]);
  /* eslint-enable react-hooks/purity */

  if (!show || marco == null) return null;

  return (
    <div className="pi-confetti-wrap" role="status" aria-live="polite">
      {particulas.map((p, i) => (
        <span
          key={i}
          className="pi-confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.cor,
            width: `${p.size}px`,
            height: `${p.size * 1.6}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}

      <div className="pi-confetti-toast">
        <div className="pi-confetti-emoji">🎉</div>
        <div className="pi-confetti-texts">
          <div className="pi-confetti-titulo">{marco}% da sua liberdade</div>
          <div className="pi-confetti-msg">{MENSAGENS[marco]}</div>
        </div>
        <button
          className="pi-confetti-close"
          onClick={() => setShow(false)}
          aria-label="Fechar"
        >×</button>
      </div>
    </div>
  );
}
