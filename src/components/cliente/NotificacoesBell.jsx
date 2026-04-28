import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { gerarRegrasCliente, regrasPendentes } from "../../services/regrasCliente";

/**
 * NotificacoesBell — Sino com badge de notificações pro cliente.
 *
 * Consome o engine único `regrasCliente.js`. Comportamento:
 *   - Badge mostra contagem de regras NÃO-COMPLETAS e NÃO-LIDAS
 *   - Click no sino abre painel dropdown com lista
 *   - Cada notificação tem CTA que navega pra ação
 *   - Quando uma regra "completa" aparece pela 1ª vez (transição
 *     pendente→completa), dispara toast "🎉 parabéns" e depois
 *     ela some do badge.
 *   - Persiste "lidas" e "celebradas" em localStorage por cliente.
 */

const STORE_LIDAS = (id) => `pi_notif_lidas_${id}`;
const STORE_CELEBRADAS = (id) => `pi_notif_celebradas_${id}`;

function lerSet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignora */ }
  return new Set();
}

function salvarSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch { /* ignora */ }
}

// ── Toast simples (efêmero, 4s) ─────────────────────────────
function Toast({ msg, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return createPortal(
    <div
      className="pi-bell-toast"
      style={{
        position: "fixed",
        top: 80,
        right: 20,
        zIndex: 9999,
        background: "linear-gradient(135deg,#00CC66 0%,#00a352 100%)",
        color: "#fff",
        padding: "14px 20px",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,204,102,0.35)",
        fontWeight: 600,
        maxWidth: 380,
        animation: "piBellToastIn 0.3s ease-out",
      }}
      onClick={onClose}
    >
      {msg}
    </div>,
    document.body
  );
}

export default function NotificacoesBell({ cliente, clienteId }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 16 });
  const [lidas, setLidas] = useState(() => clienteId ? lerSet(STORE_LIDAS(clienteId)) : new Set());
  const celebradasRef = useRef(clienteId ? lerSet(STORE_CELEBRADAS(clienteId)) : new Set());
  const [toast, setToast] = useState(null);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Computa todas as regras (pra detectar transições) e só pendentes (pro badge)
  const todasRegras = useMemo(() => gerarRegrasCliente(cliente), [cliente]);
  const pendentes = useMemo(() => regrasPendentes(cliente), [cliente]);

  // Detecta transição pendente→completa: dispara toast de parabéns
  useEffect(() => {
    if (!clienteId) return;
    const completas = todasRegras.filter(r => r.completa && r.parabens);
    const novas = completas.filter(r => !celebradasRef.current.has(r.id));
    if (novas.length > 0) {
      setToast(novas[0].parabens);
      // marca todas como celebradas
      for (const r of novas) celebradasRef.current.add(r.id);
      salvarSet(STORE_CELEBRADAS(clienteId), celebradasRef.current);
    }
  }, [todasRegras, clienteId]);

  // Calcula posição do painel relativa ao trigger (portal usa fixed)
  function recomputePos() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const PANEL_W = 360;
    const margin = 12;
    const right = Math.max(margin, window.innerWidth - r.right);
    const top = r.bottom + 10;
    const adjustedRight = right + PANEL_W > window.innerWidth - margin
      ? Math.max(margin, window.innerWidth - r.right)
      : right;
    setPos({ top, right: adjustedRight });
  }

  function toggleOpen() {
    setOpen(o => {
      const next = !o;
      if (next) recomputePos();
      return next;
    });
  }

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      const inTrigger = wrapperRef.current && wrapperRef.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inTrigger && !inPanel) setOpen(false);
    }
    function onResizeOrScroll() { recomputePos(); }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open]);

  // Badge: não-completas E não-lidas
  const naoLidas = pendentes.filter(n => !lidas.has(n.id));
  const count = naoLidas.length;

  function marcarTodasLidas() {
    const todasIds = pendentes.map(n => n.id);
    const novoSet = new Set([...lidas, ...todasIds]);
    setLidas(novoSet);
    salvarSet(STORE_LIDAS(clienteId), novoSet);
  }

  function navegar(item) {
    setOpen(false);
    // Marca como lida ao clicar
    const novoSet = new Set([...lidas, item.id]);
    setLidas(novoSet);
    salvarSet(STORE_LIDAS(clienteId), novoSet);

    const acao = item.acao || "";
    if (acao === "carteira")        navigate(`/cliente/${clienteId}/carteira`);
    else if (acao === "objetivos")  navigate(`/cliente/${clienteId}/objetivos`);
    else if (acao === "fluxo")      navigate(`/cliente/${clienteId}/fluxo`);
    else if (acao.startsWith("criar-objetivo:")) {
      const tipo = acao.split(":")[1];
      // Roteia pra Objetivos com query param que sinaliza criar novo do tipo
      navigate(`/cliente/${clienteId}/objetivos?criar=${tipo}`);
    } else {
      navigate(`/cliente/${clienteId}`);
    }
  }

  // Não mostra sino se não há pendências (estado "tudo OK")
  if (pendentes.length === 0) {
    return toast ? <Toast msg={toast} onClose={() => setToast(null)} /> : null;
  }

  const panel = open && typeof document !== "undefined" && createPortal(
    <div
      ref={panelRef}
      className="pi-bell-panel pi-bell-panel-portal"
      style={{ top: pos.top, right: pos.right }}
    >
      <div className="pi-bell-header">
        <span>Notificações</span>
        {count > 0 && (
          <button className="pi-bell-mark-all" onClick={marcarTodasLidas}>
            Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="pi-bell-list">
        {pendentes.map(n => {
          const lida = lidas.has(n.id);
          const corClass = `pi-bell-item-${n.prio}`;
          return (
            <div
              key={n.id}
              className={`pi-bell-item ${corClass} ${lida ? "pi-bell-item-lida" : ""}`}
              onClick={() => navegar(n)}
            >
              <div className="pi-bell-item-icone">{n.icone}</div>
              <div className="pi-bell-item-body">
                <div className="pi-bell-item-titulo">{n.titulo}</div>
                <div className="pi-bell-item-desc">{n.desc}</div>
              </div>
              {!lida && <div className="pi-bell-item-dot" />}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );

  return (
    <div className="pi-bell-wrap" ref={wrapperRef}>
      <button
        ref={triggerRef}
        className="pi-bell-trigger"
        onClick={toggleOpen}
        aria-label={`Notificações (${count} não lidas)`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className="pi-bell-badge">{count > 9 ? "9+" : count}</span>
        )}
      </button>
      {panel}
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
