import { useMemo, useState } from "react";
import { brl, parseCentavos } from "../../utils/currency";
import { getStatusAporteMes, registrarAporteCliente } from "../../services/aportes";

/**
 * CardAporteCliente — card pra o cliente confirmar/lançar o aporte do mês.
 *
 * Estados visuais (vide service):
 *   - nao_combinado : oculto (não polui se assessor ainda não combinou data)
 *   - em_dia        : verde, "✓ Aporte de novembro confirmado"
 *   - parcial       : ambar, "Você registrou R$ X de R$ Y. Falta R$ Z"
 *   - pendente      : neutro, "Lembrete: dia X é seu dia de aporte"
 *   - atrasado      : vermelho, "Aporte de novembro pendente há N dias"
 *
 * Não duplica o fluxo do assessor (que pede classe/ativo/saldo): aqui o
 * cliente só confirma valor. Se quiser detalhar onde alocou, o assessor faz.
 *
 * Props:
 *   cliente, clienteId, onRegistrado(callback opcional, recebe valorReais)
 */
export default function CardAporteCliente({ cliente, clienteId, onRegistrado }) {
  const status = useMemo(() => getStatusAporteMes(cliente), [cliente]);

  // Valor sugerido: meta mensal > soma dos aportes dos objetivos > nada
  const valorSugerido = useMemo(() => {
    const meta = parseCentavos(cliente?.metaAporteMensal) / 100;
    if (meta > 0) return Math.round(meta);
    const objs = Array.isArray(cliente?.objetivos) ? cliente.objetivos : [];
    const soma = objs.reduce((s, o) => s + parseCentavos(o?.aporte) / 100, 0);
    return soma > 0 ? Math.round(soma) : 0;
  }, [cliente]);

  const [editando, setEditando] = useState(false);
  const [valorInput, setValorInput] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  // Cliente sem dia combinado: assessor ainda não configurou. Não polui a tela.
  if (status.status === "nao_combinado") return null;

  const cor = corPorStatus(status.status);
  const titulo = tituloPorStatus(status);
  const subtitulo = subtituloPorStatus(status);

  async function confirmar(valorReais) {
    if (!valorReais || valorReais <= 0) {
      setErro("Informe um valor válido.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const r = await registrarAporteCliente(clienteId, cliente, valorReais);
    setSalvando(false);
    if (!r.ok) { setErro(r.error); return; }
    setEditando(false);
    setValorInput("");
    onRegistrado?.(valorReais);
  }

  return (
    <section className="liberdade-section" aria-label="Aporte do mês">
      <div className="liberdade-section-header">
        <span style={{ color: cor.label }}>Aporte do mês</span>
        <div className="liberdade-section-divider" />
        <span className="liberdade-section-count">
          {status.mesLabel}/{String(status.mesAno.ano).slice(-2)}
        </span>
      </div>

      <div
        className="aporte-card"
        style={{
          background: cor.bg,
          border: `1px solid ${cor.border}`,
          borderRadius: 16,
          padding: "18px 20px",
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: cor.iconBg, color: cor.iconColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, flexShrink: 0,
          }}>
            {cor.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: "#F0EBD8", fontWeight: 600, marginBottom: 4 }}>
              {titulo}
            </div>
            <div style={{ fontSize: 12, color: "#9EB8D0", lineHeight: 1.5 }}>
              {subtitulo}
            </div>
          </div>
        </div>

        {/* Cliente já em dia: só badge e link discreto pra adicionar mais */}
        {status.status === "em_dia" && !editando && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            style={btnLinkStyle}
          >
            Lançar aporte adicional
          </button>
        )}

        {/* Pendente / Atrasado / Parcial: ação principal */}
        {(status.status === "pendente" || status.status === "atrasado" || status.status === "parcial") && !editando && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {valorSugerido > 0 && (
              <button
                type="button"
                disabled={salvando}
                onClick={() => confirmar(valorSugerido)}
                style={btnPrimaryStyle(cor)}
              >
                {salvando ? "Salvando..." : `Confirmar aporte de ${brl(valorSugerido)}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditando(true)}
              style={btnSecondaryStyle}
            >
              {valorSugerido > 0 ? "Foi outro valor" : "Registrar aporte"}
            </button>
          </div>
        )}

        {/* Modo edição: input livre */}
        {editando && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#748CAB" }}>R$</span>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              placeholder="0"
              value={valorInput}
              onChange={(e) => setValorInput(e.target.value.replace(/\D/g, ""))}
              style={{
                flex: 1, minWidth: 120,
                padding: "10px 14px",
                background: "rgba(13,19,33,0.6)",
                border: "1px solid rgba(62,92,118,0.5)",
                borderRadius: 10,
                color: "#F0EBD8",
                fontSize: 15,
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              disabled={salvando || !valorInput}
              onClick={() => confirmar(parseInt(valorInput || "0", 10))}
              style={btnPrimaryStyle(cor)}
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => { setEditando(false); setValorInput(""); setErro(null); }}
              style={btnLinkStyle}
            >
              Cancelar
            </button>
          </div>
        )}

        {erro && (
          <div style={{
            fontSize: 12, color: "#ef4444",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            padding: "8px 12px",
            borderRadius: 8,
          }}>
            {erro}
          </div>
        )}
      </div>
    </section>
  );
}

// ── helpers visuais ─────────────────────────────────────────────
function corPorStatus(s) {
  if (s === "em_dia") return {
    bg: "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.04))",
    border: "rgba(34,197,94,0.32)",
    label: "#22c55e",
    iconBg: "rgba(34,197,94,0.15)",
    iconColor: "#22c55e",
    icon: "✓",
    primary: "#22c55e",
  };
  if (s === "atrasado") return {
    bg: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))",
    border: "rgba(239,68,68,0.40)",
    label: "#ef4444",
    iconBg: "rgba(239,68,68,0.18)",
    iconColor: "#ef4444",
    icon: "⚠",
    primary: "#ef4444",
  };
  if (s === "parcial") return {
    bg: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.04))",
    border: "rgba(245,158,11,0.34)",
    label: "#f59e0b",
    iconBg: "rgba(245,158,11,0.16)",
    iconColor: "#f59e0b",
    icon: "◐",
    primary: "#f59e0b",
  };
  // pendente
  return {
    bg: "linear-gradient(135deg, rgba(240,162,2,0.08), rgba(240,162,2,0.02))",
    border: "rgba(240,162,2,0.28)",
    label: "#F0A202",
    iconBg: "rgba(240,162,2,0.14)",
    iconColor: "#F0A202",
    icon: "◷",
    primary: "#F0A202",
  };
}

function tituloPorStatus(st) {
  if (st.status === "em_dia") return `Aporte de ${st.mesLabel} confirmado.`;
  if (st.status === "parcial") return `Aporte parcial de ${st.mesLabel}.`;
  if (st.status === "atrasado") return `Aporte de ${st.mesLabel} atrasado.`;
  return `Lembrete: aporte de ${st.mesLabel}.`;
}

function subtituloPorStatus(st) {
  if (st.status === "em_dia") {
    return `Você já registrou ${brl(st.valorRegistrado)} este mês. Continue assim.`;
  }
  if (st.status === "parcial") {
    const falta = Math.max(0, st.valorMetaMes - st.valorRegistrado);
    return `Registrado: ${brl(st.valorRegistrado)} de ${brl(st.valorMetaMes)}. Falta ${brl(falta)}.`;
  }
  if (st.status === "atrasado") {
    return st.diasAtraso === 1
      ? `Você combinou aportar dia ${st.diaCombinado}. Estamos 1 dia atrás.`
      : `Você combinou aportar dia ${st.diaCombinado}. Estamos ${st.diasAtraso} dias atrás.`;
  }
  // pendente
  if (st.diasParaVencer === 0) return `É hoje. Combinado: dia ${st.diaCombinado}.`;
  return st.diasParaVencer === 1
    ? `Combinado: dia ${st.diaCombinado}. Falta 1 dia.`
    : `Combinado: dia ${st.diaCombinado}. Faltam ${st.diasParaVencer} dias.`;
}

const btnPrimaryStyle = (cor) => ({
  padding: "11px 18px",
  background: `linear-gradient(135deg, ${cor.primary}, ${cor.primary}dd)`,
  border: "none",
  borderRadius: 10,
  color: "#0d1321",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
});

const btnSecondaryStyle = {
  padding: "11px 18px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: "#F0EBD8",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnLinkStyle = {
  padding: "8px 4px",
  background: "transparent",
  border: "none",
  color: "#9EB8D0",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "underline",
  textUnderlineOffset: 3,
  alignSelf: "flex-start",
};
