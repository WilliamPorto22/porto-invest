import { useMemo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseCentavos, brl } from "../../utils/currency";
import {
  TAXA_ANUAL,
  IPCA_ANUAL,
  encontrarAnosNecessarios,
} from "../../utils/objetivosCalc";
import { regrasParaProximosPassos } from "../../services/regrasCliente";
import { getStatusAporteMes } from "../../services/aportes";
import { registrarPushCliente, ouvirMensagensForeground } from "../../services/pushNotifications";
import SliderAcelerar from "./SliderAcelerar";
import SaudeFinanceira from "./SaudeFinanceira";
import Confetti from "./Confetti";
import OnboardingCliente from "./OnboardingCliente";
import HistoricoPatrimonio from "./HistoricoPatrimonio";
import CardAporteCliente from "./CardAporteCliente";
import Tooltip from "../Tooltip";
import "../../styles/liberdade.css";
import "../../styles/onboarding.css";

/**
 * HomeLiberdade — Tela inicial do cliente final
 *
 * Três blocos:
 *   1. Hero "Número da Liberdade" — meta de aposentadoria + progresso unificado
 *   2. Próximos Passos — até 3 ações concretas geradas por regras
 *   3. Jornada — timeline horizontal com todos os objetivos
 *
 * Premissas:
 *   - cliente é o doc completo (snap em ClienteFicha)
 *   - patrimônio é calculado pela mesma regra do Dashboard (getPatFin)
 */

const CART_KEYS = [
  "posFixado", "ipca", "preFixado", "acoes", "fiis", "multi",
  "prevVGBL", "prevPGBL", "globalEquities", "globalTreasury",
  "globalFunds", "globalBonds", "global", "outros",
];

// ── Replica getPatFin do Dashboard ─────────────────────────────
function getPatFin(c) {
  const carteira = c?.carteira || {};
  const t = CART_KEYS.reduce((s, k) => {
    const ativos = carteira[k + "Ativos"];
    if (Array.isArray(ativos)) {
      return s + ativos.reduce((a, at) => a + parseCentavos(at.valor) / 100, 0);
    }
    return s + parseCentavos(carteira[k]) / 100;
  }, 0);
  if (t > 0) return t;
  return parseCentavos(c?.patrimonio) / 100;
}

// ── Hero: Número da Liberdade ──────────────────────────────────
function HeroLiberdade({ patrimonio, metaLiberdade, anosFalta, primeiroNome }) {
  const pct = metaLiberdade > 0
    ? Math.min(100, Math.round((patrimonio / metaLiberdade) * 100))
    : 0;
  const falta = Math.max(0, metaLiberdade - patrimonio);

  return (
    <div className="liberdade-hero">
      {/* Camadas de luz/glow */}
      <div className="liberdade-hero-glow" />
      <div className="liberdade-hero-grid" />

      <div className="liberdade-hero-inner">
        {/* Eyebrow */}
        <div className="liberdade-eyebrow">
          <span className="liberdade-spark" />
          Sua liberdade financeira
        </div>

        {/* Saudação compacta */}
        {primeiroNome && (
          <div className="liberdade-saudacao">
            Olá, <b>{primeiroNome}</b>. Aqui está sua jornada.
          </div>
        )}

        {/* Número grande da meta */}
        <div className="liberdade-meta-row">
          <div className="liberdade-meta-block">
            <div className="liberdade-meta-label">Meta de patrimônio</div>
            <div className="liberdade-meta-valor">
              {metaLiberdade > 0 ? brl(metaLiberdade) : "Defina sua meta"}
            </div>
          </div>

          <div className="liberdade-meta-block right">
            <div className="liberdade-meta-label">Você tem hoje</div>
            <div className="liberdade-atual-valor">{brl(patrimonio)}</div>
          </div>
        </div>

        {/* Barra de progresso premium */}
        <div className="liberdade-progress-wrap">
          <div className="liberdade-progress-track">
            <div
              className="liberdade-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="liberdade-progress-meta">
            <span>{pct}% do caminho</span>
            <span>{metaLiberdade > 0 ? `100%` : "—"}</span>
          </div>
        </div>

        {/* Stats inferiores */}
        <div className="liberdade-stats-row">
          <div className="liberdade-stat">
            <div className="liberdade-stat-label">
              Faltam
              <Tooltip text="Quanto ainda falta para você atingir a meta de patrimônio que te dá liberdade financeira." />
            </div>
            <div className="liberdade-stat-valor">
              {metaLiberdade > 0 ? brl(falta) : "—"}
            </div>
          </div>
          <div className="liberdade-stat-divider" />
          <div className="liberdade-stat">
            <div className="liberdade-stat-label">
              No ritmo atual
              <Tooltip text="Tempo que você levaria para chegar à liberdade mantendo o aporte mensal de hoje. Aumentar o aporte reduz esse prazo." />
            </div>
            <div className="liberdade-stat-valor">
              {anosFalta != null
                ? `${anosFalta} ${anosFalta === 1 ? "ano" : "anos"}`
                : "—"}
            </div>
          </div>
          <div className="liberdade-stat-divider" />
          <div className="liberdade-stat">
            <div className="liberdade-stat-label">
              Liberdade em
              <Tooltip text="Ano em que, mantendo o ritmo atual, seu patrimônio te permite parar de trabalhar e viver da renda dos investimentos." />
            </div>
            <div className="liberdade-stat-valor liberdade-stat-gold">
              {anosFalta != null
                ? new Date().getFullYear() + anosFalta
                : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProximosPassos({ passos, clienteId }) {
  const navigate = useNavigate();

  const corPorPrio = {
    urgente: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)", text: "#fca5a5", chip: "#ef4444" },
    atencao: { bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)", text: "#fcd34d", chip: "#f59e0b" },
    ok:      { bg: "rgba(0,204,102,0.10)",  border: "rgba(0,204,102,0.28)",  text: "#86efac", chip: "#00CC66" },
  };

  const labelPrio = { urgente: "URGENTE", atencao: "ATENÇÃO", ok: "EM DIA" };

  function navegar(acao) {
    const a = acao || "";
    if (a === "carteira") navigate(`/cliente/${clienteId}/carteira`);
    else if (a === "objetivos") navigate(`/cliente/${clienteId}/objetivos`);
    else if (a === "fluxo") navigate(`/cliente/${clienteId}/fluxo`);
    else if (a.startsWith("criar-objetivo:")) {
      const tipo = a.split(":")[1];
      navigate(`/cliente/${clienteId}/objetivos?criar=${tipo}`);
    }
  }

  return (
    <div className="liberdade-section">
      <div className="liberdade-section-header">
        <span>Próximos passos</span>
        <div className="liberdade-section-divider" />
        <span className="liberdade-section-count">{passos.length}</span>
      </div>

      <div className="liberdade-passos-grid">
        {passos.map((p, i) => {
          const c = corPorPrio[p.prio];
          return (
            <div
              key={i}
              className="liberdade-passo-card"
              style={{
                background: `linear-gradient(160deg, ${c.bg} 0%, rgba(13,19,33,0.4) 100%)`,
                borderColor: c.border,
              }}
            >
              <div
                className="liberdade-passo-chip"
                style={{ background: c.chip }}
              />
              <div className="liberdade-passo-prio" style={{ color: c.chip }}>
                {labelPrio[p.prio]}
              </div>
              <div className="liberdade-passo-icone">{p.icone}</div>
              <div className="liberdade-passo-titulo">{p.titulo}</div>
              <div className="liberdade-passo-desc">{p.desc}</div>
              <button
                className="liberdade-passo-cta"
                onClick={() => navegar(p.acao)}
                style={{
                  color: c.text,
                  borderColor: c.border,
                }}
              >
                {p.cta} →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Jornada / Timeline ────────────────────────────────────────
function JornadaTimeline({ objetivos, clienteId }) {
  const navigate = useNavigate();
  if (!objetivos.length) return null;

  const anoAtual = new Date().getFullYear();

  // Ordena por ano-alvo ascendente
  const items = objetivos
    .map((obj, i) => {
      const inicial = parseCentavos(obj.patrimAtual) / 100;
      const aporte = parseCentavos(obj.aporte) / 100;
      const meta = parseCentavos(obj.meta) / 100;
      const prazo = parseInt(obj.prazo) || 0;
      const pct = meta > 0 ? Math.min(100, Math.round((inicial / meta) * 100)) : 0;
      const anoAlvo = anoAtual + (prazo || 0);
      const emoji = obj.tipo === "aposentadoria" ? "🌴"
                  : obj.tipo === "imovel" ? "🏠"
                  : obj.tipo === "liquidez" ? "🛟"
                  : obj.tipo === "carro" ? "🚗"
                  : obj.tipo === "viagem" ? "✈️"
                  : obj.tipo === "educacao" ? "📚"
                  : "🎯";
      return { idx: i, obj, pct, anoAlvo, emoji, prazo, inicial, meta, aporte };
    })
    .sort((a, b) => a.anoAlvo - b.anoAlvo);

  return (
    <div className="liberdade-section">
      <div className="liberdade-section-header">
        <span>Sua jornada</span>
        <div className="liberdade-section-divider" />
        <span className="liberdade-section-count">{items.length}</span>
      </div>

      <div className="liberdade-jornada-card">
        <div className="liberdade-jornada-rail">
          <div className="liberdade-jornada-line" />
          <div className="liberdade-jornada-nodes">
            {items.map(it => (
              <div
                key={it.idx}
                className="liberdade-jornada-node"
                onClick={() => navigate(`/objetivo/${clienteId}/${it.idx}`)}
              >
                <div className="liberdade-node-dot">
                  <span>{it.emoji}</span>
                </div>
                <div className="liberdade-node-info">
                  <div className="liberdade-node-titulo">
                    {it.obj.nomeCustom || it.obj.label}
                  </div>
                  <div className="liberdade-node-ano">{it.anoAlvo}</div>
                  <div className="liberdade-node-bar">
                    <div
                      className="liberdade-node-bar-fill"
                      style={{ width: `${it.pct}%` }}
                    />
                  </div>
                  <div className="liberdade-node-pct">{it.pct}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Toast de notificação foreground ───────────────────────────
function ToastPush({ msg, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
      zIndex: 9600, maxWidth: "92vw", width: 340,
      background: "linear-gradient(135deg, rgba(13,19,33,0.97) 0%, rgba(29,45,68,0.97) 100%)",
      border: "1px solid rgba(240,162,2,0.35)",
      borderRadius: 14, padding: "14px 18px",
      boxShadow: "0 16px 50px rgba(0,0,0,0.6), 0 0 20px rgba(240,162,2,0.2)",
      display: "flex", gap: 12, alignItems: "flex-start",
      animation: "liberdade-fade-in 0.3s ease-out",
    }}>
      <span style={{ fontSize: 22, lineHeight: 1 }}>🔔</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#F0EBD8", marginBottom: 3 }}>{msg.title}</div>
        <div style={{ fontSize: 12, color: "#9EB8D0", lineHeight: 1.45 }}>{msg.body}</div>
      </div>
      <button onClick={onClose} style={{
        background: "transparent", border: "none", color: "#748CAB",
        fontSize: 16, cursor: "pointer", padding: 2, lineHeight: 1,
      }}>×</button>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────
export default function HomeLiberdade({ cliente, clienteId }) {
  const objetivos = useMemo(() => cliente?.objetivos || [], [cliente]);

  // Calcula meta de liberdade financeira:
  // Prioridade: objetivo "aposentadoria" salvo > derivado de gastos × 12 / taxa
  const metaLiberdade = useMemo(() => {
    const apos = objetivos.find(o => o.tipo === "aposentadoria");
    if (apos) {
      const m = parseCentavos(apos.meta) / 100;
      if (m > 0) return m;
    }
    // Fallback: gastos atuais × 12 / 4% (regra dos 4%)
    const gastos = parseCentavos(cliente?.gastosMensaisManual) / 100;
    if (gastos > 0) return Math.round((gastos * 12) / 0.04);
    return 0;
  }, [objetivos, cliente]);

  const patrimonio = useMemo(() => getPatFin(cliente), [cliente]);

  // Aporte total mensal (soma de todos os objetivos)
  const aporteTotalMensal = useMemo(() => {
    return objetivos.reduce(
      (s, o) => s + parseCentavos(o.aporte) / 100, 0
    );
  }, [objetivos]);

  // Anos para chegar à liberdade no ritmo atual
  const anosFalta = useMemo(() => {
    if (metaLiberdade <= 0 || patrimonio >= metaLiberdade) return null;
    const anos = encontrarAnosNecessarios(
      patrimonio, aporteTotalMensal, metaLiberdade,
      { taxaAnual: TAXA_ANUAL, ipcaAnual: IPCA_ANUAL, maxAnos: 80 }
    );
    return anos != null ? Math.ceil(anos) : null;
  }, [patrimonio, aporteTotalMensal, metaLiberdade]);

  const passos = useMemo(() => regrasParaProximosPassos(cliente, 3), [cliente]);
  const primeiroNome = (cliente?.nome || "").split(" ")[0] || "";

  // Push notifications: registra token e ouve mensagens foreground
  const [toastMsg, setToastMsg] = useState(null);
  useEffect(() => {
    if (!clienteId) return;
    registrarPushCliente(clienteId);
    const unsub = ouvirMensagensForeground((msg) => setToastMsg(msg));
    return unsub;
  }, [clienteId]);

  // Escreve status do aporte no localStorage para o badge da sidebar
  useEffect(() => {
    if (!clienteId) return;
    const st = getStatusAporteMes(cliente);
    const key = `porto_aporte_alert_${clienteId}`;
    if (st.status === "atrasado" || st.status === "parcial") {
      localStorage.setItem(key, st.status);
    } else {
      localStorage.removeItem(key);
    }
  }, [cliente, clienteId]);

  // Renda mensal pra Taxa de Poupança (vem do cadastro)
  const rendaMensal = useMemo(
    () => parseCentavos(cliente?.salarioMensal) / 100,
    [cliente]
  );

  // Gastos mensais declarados (consolidado do FluxoMensal)
  const gastosMensais = useMemo(
    () => parseCentavos(cliente?.gastosMensaisManual) / 100,
    [cliente]
  );

  // Aporte real do mês atual (a partir do aportesHistorico do cliente)
  const aporteRealMes = useMemo(() => {
    const hist = Array.isArray(cliente?.aportesHistorico) ? cliente.aportesHistorico : [];
    if (!hist.length) return 0;
    const hoje = new Date();
    const mesRef = `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
    return hist
      .filter((a) => {
        if (!a?.data) return false;
        const d = new Date(a.data);
        if (Number.isNaN(d.getTime())) return false;
        return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` === mesRef;
      })
      .reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
  }, [cliente]);

  // % atingido (pra Confetti) — só conta quando há meta definida
  const pctMeta = useMemo(() => {
    if (metaLiberdade <= 0) return 0;
    return Math.min(100, (patrimonio / metaLiberdade) * 100);
  }, [patrimonio, metaLiberdade]);

  return (
    <div className="liberdade-wrap">
      <ToastPush msg={toastMsg} onClose={() => setToastMsg(null)} />
      <OnboardingCliente clienteId={clienteId} primeiroNome={primeiroNome} />
      <Confetti pct={pctMeta} clienteId={clienteId} />

      <HeroLiberdade
        patrimonio={patrimonio}
        metaLiberdade={metaLiberdade}
        anosFalta={anosFalta}
        primeiroNome={primeiroNome}
      />

      <SaudeFinanceira
        rendaMensal={rendaMensal}
        gastosMensais={gastosMensais}
        aporteNecessario={aporteTotalMensal}
        aporteReal={aporteRealMes}
      />

      {/* Card de aporte do mês — só aparece quando o assessor já configurou
          o diaAporte do cliente (caso contrário retorna null). */}
      <CardAporteCliente cliente={cliente} clienteId={clienteId} />

      <HistoricoPatrimonio clienteId={clienteId} />

      <ProximosPassos passos={passos} clienteId={clienteId} />

      <SliderAcelerar
        patrimonio={patrimonio}
        metaLiberdade={metaLiberdade}
        aporteAtual={aporteTotalMensal}
        anosAtuais={anosFalta}
      />

      <JornadaTimeline objetivos={objetivos} clienteId={clienteId} />
    </div>
  );
}
