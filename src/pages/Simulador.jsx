import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { doc, setDoc } from "firebase/firestore";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { db } from "../firebase";
import { lerClienteComFallback, invalidarCacheCliente } from "../services/lerClienteFallback";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { T, C } from "../theme";
import {
  TAXA_ANUAL,
  IPCA_ANUAL,
  calcularProjecao,
  encontrarAnosNecessarios,
  encontrarAporteNecessario,
  classificarStatus,
} from "../utils/objetivosCalc";
import {
  parseCentavos,
  centavosToReais,
  reaisToCentavos,
  brl,
  formatMi,
  moedaInput,
} from "../utils/currency";
import { stripUndefined } from "../services/snapshotsCarteira";

const TIPOS = [
  { id: "aposentadoria", label: "Aposentadoria", emoji: "🏖️" },
  { id: "imovel",        label: "Aquisição de Imóvel", emoji: "🏠" },
  { id: "liquidez",      label: "Reserva de Emergência", emoji: "🛟" },
  { id: "carro",         label: "Veículo", emoji: "🚗" },
  { id: "oportunidade",  label: "Reserva de Oportunidade", emoji: "🎯" },
  { id: "viagem",        label: "Viagem", emoji: "✈️" },
  { id: "educacao",      label: "Educação", emoji: "📚" },
  { id: "saude",         label: "Saúde", emoji: "💪" },
  { id: "personalizado", label: "Personalizado", emoji: "⭐" },
];

const CORES_STATUS = {
  viavel: T.success,
  ajustavel: T.warning,
  inviavel: T.danger,
};
const LABEL_STATUS = {
  viavel: "Plano Viável",
  ajustavel: "Plano Ajustável",
  inviavel: "Plano Inviável",
};

// ── Estado inicial ────────────────────────────────────────────
function estadoInicial() {
  return {
    tipo: "aposentadoria",
    nomeCustom: "",
    meta: 0,              // reais
    patrimAtual: 0,       // reais
    aporte: 0,            // reais/mês
    prazo: 10,            // anos
    taxaAnual: TAXA_ANUAL,
    ipcaAnual: IPCA_ANUAL,
  };
}

// ── Hook: debounce genérico ───────────────────────────────────
function useDebounced(value, delay = 250) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setOut(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return out;
}

// ── Hint embaixo das labels (explicação curta) ───────────────
const HINT_STYLE = {
  fontSize: 13,
  color: T.textSecondary,
  marginTop: -2,
  marginBottom: 10,
  lineHeight: 1.45,
  textTransform: "none",
  letterSpacing: 0,
  fontWeight: 400,
};

// ── Input de moeda controlado (em reais) ──────────────────────
function InputMoeda({ label, hint, valor, onChange, placeholder = "R$ 0,00" }) {
  const centavos = reaisToCentavos(valor);
  return (
    <div>
      <label style={C.label}>{label}</label>
      {hint && <div style={HINT_STYLE}>{hint}</div>}
      <input
        style={{ ...C.input, fontSize: 18, padding: "14px 18px" }}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={centavos ? moedaInput(centavos) : ""}
        onChange={(e) => {
          const c = parseCentavos(e.target.value);
          onChange(centavosToReais(c));
        }}
      />
    </div>
  );
}

// ── Input numérico simples (anos, taxas) ──────────────────────
function InputNumero({ label, hint, valor, onChange, min = 0, max = 100, step = 1, sufixo }) {
  return (
    <div>
      <label style={C.label}>{label}</label>
      {hint && <div style={HINT_STYLE}>{hint}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          style={{ ...C.input, fontSize: 18, padding: "14px 18px", flex: 1 }}
          type="number"
          min={min}
          max={max}
          step={step}
          value={valor}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        {sufixo && (
          <span style={{ fontSize: 13, color: T.textSecondary, width: 44 }}>{sufixo}</span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={valor}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", marginTop: 8, accentColor: T.gold }}
      />
    </div>
  );
}

// ── Card de Cenário salvo ─────────────────────────────────────
function CardCenario({ cenario, onRemover, onCarregar, ativo }) {
  const { nome, estado, diagnostico } = cenario;
  const cor = CORES_STATUS[diagnostico.status];
  return (
    <div
      style={{
        background: ativo ? T.bgHover : T.bgCard,
        border: `0.5px solid ${ativo ? T.goldBorder : T.border}`,
        borderRadius: T.radiusMd,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: T.shadowSm,
        minWidth: 180,
        flex: 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, color: T.textPrimary, fontWeight: 500 }}>{nome}</div>
        <button
          onClick={onRemover}
          style={{
            background: "none", border: "none", color: T.textMuted,
            fontSize: 14, cursor: "pointer", padding: 0,
          }}
          title="Remover cenário"
        >×</button>
      </div>
      <div style={{ fontSize: 10, color: T.textMuted }}>
        Meta {formatMi(estado.meta)} · Aporte {formatMi(estado.aporte)}/mês · {estado.prazo} anos
      </div>
      <div style={{ fontSize: 10, color: T.textMuted }}>
        Taxa {estado.taxaAnual.toFixed(1)}% · IPCA {estado.ipcaAnual.toFixed(2)}%
      </div>
      <span style={{ ...C.pill(cor), alignSelf: "flex-start" }}>
        {LABEL_STATUS[diagnostico.status]}
        {diagnostico.anosNec != null ? ` · ${diagnostico.anosNec} anos` : " · 50+ anos"}
      </span>
      <button
        onClick={onCarregar}
        style={{
          ...C.btnSecondary,
          padding: "8px 12px",
          fontSize: 10,
          marginTop: 4,
        }}
      >
        Carregar no form
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PÁGINA
// ══════════════════════════════════════════════════════════════
export default function Simulador() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isCliente, profile } = useAuth();

  // Cliente só pode acessar o próprio simulador
  useEffect(() => {
    if (isCliente && profile?.clienteId && id !== profile.clienteId) {
      navigate(`/cliente/${profile.clienteId}/simulador`, { replace: true });
    }
  }, [isCliente, profile?.clienteId, id, navigate]);

  const [cliente, setCliente] = useState(null);
  const [estado, setEstado] = useState(estadoInicial);
  const [cenarios, setCenarios] = useState([]); // sessão, não persiste
  const [salvando, setSalvando] = useState(false);
  const [mostrarTabela, setMostrarTabela] = useState(false);
  const [mensagem, setMensagem] = useState(null); // { tipo: 'sucesso'|'erro', texto }

  // Carrega cliente + IPCA cache (se houver)
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await lerClienteComFallback(id, { isAlive: () => ativo });
        if (!ativo || !r.exists || !r.data) return;
        setCliente({ id, ...r.data });
      } catch (e) {
        console.error("Simulador: falha ao ler cliente", e);
        return;
      }
      // Usa IPCA em cache (mesmo mecanismo do Objetivos)
      try {
        const cache = JSON.parse(localStorage.getItem("wealthtrack_ipca") || "null");
        if (cache?.valor) {
          setEstado((s) => ({ ...s, ipcaAnual: parseFloat(cache.valor) }));
        }
      } catch { /* ignora */ }
    })();
    return () => { ativo = false; };
  }, [id]);

  // Debounce: recalcula gráfico só quando o usuário para de mexer
  const estadoDebounced = useDebounced(estado, 200);

  // ── Diagnóstico derivado ──
  const diagnostico = useMemo(() => {
    const { meta, patrimAtual, aporte, prazo, taxaAnual, ipcaAnual } = estadoDebounced;
    if (meta <= 0) {
      return { status: "inviavel", anosNec: null, valorFinal: 0, valorFinalReal: 0 };
    }
    const anosNec = encontrarAnosNecessarios(patrimAtual, aporte, meta, {
      taxaAnual, ipcaAnual,
    });
    const status = classificarStatus(anosNec, prazo);
    const tabela = calcularProjecao(patrimAtual, aporte, Math.max(prazo, 1), {
      taxaAnual, ipcaAnual,
    });
    const ultimo = tabela[tabela.length - 1];
    return {
      status,
      anosNec,
      valorFinal: ultimo?.totalNominal || patrimAtual,
      valorFinalReal: ultimo?.totalReal || patrimAtual,
      rendaMensalReal: ultimo?.rendaMensalReal || 0,
    };
  }, [estadoDebounced]);

  // ── Dados do gráfico (ano a ano) ──
  const dadosGrafico = useMemo(() => {
    const { patrimAtual, aporte, prazo, taxaAnual, ipcaAnual } = estadoDebounced;
    const tabela = calcularProjecao(patrimAtual, aporte, Math.max(prazo, 1), {
      taxaAnual, ipcaAnual,
    });
    return [
      { ano: 0, nominal: Math.round(patrimAtual), real: Math.round(patrimAtual) },
      ...tabela.map((t) => ({ ano: t.ano, nominal: t.totalNominal, real: t.totalReal })),
    ];
  }, [estadoDebounced]);

  // ── Aporte necessário (sugestão se inviável/ajustável) ──
  const aporteSugerido = useMemo(() => {
    const { meta, patrimAtual, prazo, taxaAnual } = estadoDebounced;
    if (meta <= 0 || prazo <= 0) return null;
    if (patrimAtual >= meta) return 0;
    return encontrarAporteNecessario(patrimAtual, meta, prazo, taxaAnual);
  }, [estadoDebounced]);

  // ── Ações ──
  const atualizar = useCallback((patch) => {
    setEstado((s) => ({ ...s, ...patch }));
  }, []);

  const resetar = () => setEstado(estadoInicial());

  const salvarCenario = () => {
    if (cenarios.length >= 3) return;
    const nome = `Cenário ${cenarios.length + 1}`;
    setCenarios((cs) => [
      ...cs,
      { nome, estado: { ...estado }, diagnostico: { ...diagnostico } },
    ]);
  };

  const removerCenario = (idx) => {
    setCenarios((cs) => cs.filter((_, i) => i !== idx));
  };

  const carregarCenario = (idx) => {
    const c = cenarios[idx];
    if (c) setEstado(c.estado);
  };

  const carregarObjetivoExistente = (idxObj) => {
    if (!cliente?.objetivos || idxObj === "") return;
    const obj = cliente.objetivos[idxObj];
    if (!obj) return;
    setEstado((s) => ({
      ...s,
      tipo: obj.tipo || "personalizado",
      nomeCustom: obj.nomeCustom || "",
      meta: centavosToReais(parseCentavos(obj.meta)),
      patrimAtual: centavosToReais(parseCentavos(obj.patrimAtual)),
      aporte: centavosToReais(parseCentavos(obj.aporte)),
      prazo: parseInt(obj.prazo) || 10,
    }));
  };

  const salvarComoObjetivo = async () => {
    if (!cliente) return;
    if (estado.meta <= 0 || estado.aporte <= 0) {
      setMensagem({ tipo: "erro", texto: "Informe meta e aporte maiores que zero." });
      return;
    }
    setSalvando(true);
    try {
      const tipoDef = TIPOS.find((t) => t.id === estado.tipo) || TIPOS[TIPOS.length - 1];
      const novoObjetivo = {
        tipo: estado.tipo,
        label: tipoDef.label,
        nomeCustom: estado.nomeCustom || "",
        meta: String(reaisToCentavos(estado.meta)),
        patrimAtual: String(reaisToCentavos(estado.patrimAtual)),
        aporte: String(reaisToCentavos(estado.aporte)),
        prazo: estado.prazo,
        patrimSource: "manual",
        ativosVinculados: [],
        origemSimulador: true,
        criadoEm: new Date().toISOString(),
      };
      const atual = cliente.objetivos || [];
      await setDoc(doc(db, "clientes", id), stripUndefined({
        objetivos: [...atual, novoObjetivo],
      }), { merge: true });
      invalidarCacheCliente(id);
      setMensagem({ tipo: "sucesso", texto: "Objetivo criado com sucesso." });
      setTimeout(() => navigate(`/cliente/${id}/objetivos`), 900);
    } catch (e) {
      console.error("[Simulador] Erro ao criar objetivo:", e?.code, e?.message);
      setMensagem({ tipo: "erro", texto: e?.code === "permission-denied"
        ? "Sem permissão. Faça logout e entre novamente."
        : "Erro ao salvar. Tente novamente." });
    } finally {
      setSalvando(false);
    }
  };

  // ── Render ──
  const corStatus = CORES_STATUS[diagnostico.status];

  return (
    <div className="dashboard-container has-sidebar" style={{ minHeight: "100vh", background: C.bg.background }}>
      <Sidebar mode="cliente" clienteId={id} clienteNome={cliente?.nome || ""} />
      <Navbar
        actionButtons={[
          { icon: "←", label: "Voltar", variant: "secondary", onClick: () => navigate(`/cliente/${id}`), title: "Voltar ao cliente" },
          { label: "Objetivos", variant: "secondary", onClick: () => navigate(`/cliente/${id}/objetivos`) },
        ]}
      />

      <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>
      <div className="simulador-container" style={{ ...C.containerWide, maxWidth: "100%", padding: 0 }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: T.textMuted, marginBottom: 6 }}>
            Planejamento
          </div>
          <h1 style={C.pageTitle}>Simulador de Objetivos</h1>
          <div style={C.pageSub}>
            {cliente ? (
              <>Cliente: <strong style={{ color: T.textPrimary }}>{cliente.nome || "—"}</strong>. Mexa nos controles abaixo e veja o resultado na hora.</>
            ) : (
              "Carregando cliente..."
            )}
          </div>
        </div>

        {/* Mensagem flutuante */}
        {mensagem && (
          <div style={{
            background: mensagem.tipo === "sucesso" ? T.successDim : T.dangerDim,
            border: `0.5px solid ${mensagem.tipo === "sucesso" ? T.success : T.danger}`,
            color: mensagem.tipo === "sucesso" ? T.success : T.danger,
            padding: "12px 16px",
            borderRadius: T.radiusMd,
            marginBottom: 20,
            fontSize: 13,
          }}>
            {mensagem.texto}
          </div>
        )}

        {/* Grid principal: form (esq) + diagnóstico/gráfico (dir).
            Em telas < 960px vira coluna única (empilha) para não cortar conteúdo no mobile. */}
        <div className="simulador-grid" style={{ alignItems: "start" }}>
          {/* ── Coluna esquerda: formulário ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Tipo de objetivo */}
            <div style={C.card}>
              <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>
                Tipo de objetivo
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {TIPOS.map((t) => {
                  const ativo = estado.tipo === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => atualizar({ tipo: t.id })}
                      style={{
                        padding: "10px 16px",
                        background: ativo ? T.goldDim : "rgba(255,255,255,0.03)",
                        border: `0.5px solid ${ativo ? T.goldBorder : T.border}`,
                        borderRadius: T.radiusSm,
                        color: ativo ? T.gold : T.textSecondary,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: T.fontFamily,
                        transition: "all 0.2s",
                      }}
                    >
                      <span style={{ marginRight: 6, fontSize: 15 }}>{t.emoji}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
              {estado.tipo === "personalizado" && (
                <div style={{ marginTop: 14 }}>
                  <label style={C.label}>Nome do objetivo</label>
                  <input
                    style={C.input}
                    value={estado.nomeCustom}
                    onChange={(e) => atualizar({ nomeCustom: e.target.value })}
                    placeholder="Ex: Viagem para o Canadá"
                  />
                </div>
              )}
            </div>

            {/* Valores */}
            <div style={{ ...C.card, display: "flex", flexDirection: "column", gap: 16 }}>
              <InputMoeda
                label="Meta de patrimônio financeiro"
                hint="valor total que você quer atingir"
                valor={estado.meta}
                onChange={(v) => atualizar({ meta: v })}
              />
              <InputMoeda
                label="Quanto você já tem"
                hint="patrimônio já guardado para este objetivo"
                valor={estado.patrimAtual}
                onChange={(v) => atualizar({ patrimAtual: v })}
              />
              <InputMoeda
                label="Quanto guarda por mês"
                hint="aporte mensal que você faz"
                valor={estado.aporte}
                onChange={(v) => atualizar({ aporte: v })}
              />
              <InputNumero
                label="Em quantos anos"
                hint="prazo que você tem para atingir a meta"
                valor={estado.prazo}
                onChange={(v) => atualizar({ prazo: Math.max(0, Math.round(v)) })}
                min={1}
                max={50}
                step={1}
                sufixo="anos"
              />
              <InputNumero
                label="Rendimento ao ano"
                hint="quanto o dinheiro rende por ano (CDI ≈ 14%)"
                valor={estado.taxaAnual}
                onChange={(v) => atualizar({ taxaAnual: v })}
                min={0}
                max={30}
                step={0.25}
                sufixo="% a.a."
              />
              <InputNumero
                label="Inflação ao ano"
                hint="perda de poder de compra (IPCA ≈ 4%)"
                valor={estado.ipcaAnual}
                onChange={(v) => atualizar({ ipcaAnual: v })}
                min={0}
                max={20}
                step={0.05}
                sufixo="% a.a."
              />
            </div>

            {/* Atalhos */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={{ ...C.btnSecondary, flex: 1 }} onClick={resetar}>
                Zerar
              </button>
              {cliente?.objetivos?.length > 0 && (
                <select
                  style={{ ...C.select, flex: 2, cursor: "pointer" }}
                  defaultValue=""
                  onChange={(e) => {
                    carregarObjetivoExistente(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">Carregar objetivo existente...</option>
                  {cliente.objetivos.map((o, i) => (
                    <option key={i} value={i}>
                      {o.nomeCustom || o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* ── Coluna direita: diagnóstico + gráfico ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Status grande */}
            <div style={{
              ...C.card,
              borderLeft: `3px solid ${corStatus}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: T.textMuted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
                    Diagnóstico
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 300, color: corStatus, letterSpacing: "-0.01em" }}>
                    {LABEL_STATUS[diagnostico.status]}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>Prazo real</div>
                  <div style={{ fontSize: 24, color: T.textPrimary, fontWeight: 300 }}>
                    {diagnostico.anosNec != null ? `${diagnostico.anosNec} anos` : "50+ anos"}
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                    desejado: {estado.prazo} anos
                  </div>
                </div>
              </div>

              {aporteSugerido != null && diagnostico.status !== "viavel" && estado.aporte < aporteSugerido && (
                <div style={{
                  marginTop: 16,
                  padding: "14px 18px",
                  background: T.warningDim,
                  border: `0.5px solid ${T.warning}44`,
                  borderRadius: T.radiusSm,
                  fontSize: 15,
                  color: T.warning,
                  lineHeight: 1.6,
                }}>
                  Para atingir no prazo, aporte necessário: <strong>{brl(aporteSugerido)}/mês</strong>
                  {" "}(atual: {brl(estado.aporte, { zeroAsDash: false })}/mês).
                </div>
              )}
            </div>

            {/* KPIs */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
            }}>
              <KPI
                label="Quanto você terá"
                hint="total acumulado no prazo"
                valor={brl(diagnostico.valorFinal)}
              />
              <KPI
                label="Poder de compra"
                hint="em reais de hoje (sem inflação)"
                valor={brl(diagnostico.valorFinalReal)}
              />
              <KPI
                label="Renda mensal possível"
                hint="vivendo só dos juros"
                valor={`${brl(diagnostico.rendaMensalReal)}/mês`}
              />
            </div>

            {/* Gráfico */}
            <div style={C.card}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}>
                <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  Evolução do patrimônio
                </div>
                <div style={{ fontSize: 12, color: T.textMuted }}>
                  taxa {estado.taxaAnual.toFixed(2)}% · ipca {estado.ipcaAnual.toFixed(2)}%
                </div>
              </div>
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <AreaChart data={dadosGrafico} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grNominal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={T.gold} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={T.gold} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grReal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={T.blue} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={T.blue} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="ano"
                      tick={{ fill: T.textSecondary, fontSize: 13 }}
                      tickFormatter={(a) => (a === 0 ? "hoje" : `${a}a`)}
                    />
                    <YAxis
                      tick={{ fill: T.textSecondary, fontSize: 13 }}
                      tickFormatter={(v) => formatMi(v)}
                      width={90}
                    />
                    <Tooltip
                      contentStyle={{
                        background: T.bgCard,
                        border: `0.5px solid ${T.border}`,
                        borderRadius: T.radiusSm,
                        color: T.textPrimary,
                        fontSize: 14,
                      }}
                      labelStyle={{ color: T.textMuted }}
                      formatter={(v) => brl(v)}
                      labelFormatter={(a) => (a === 0 ? "Hoje" : `Ano ${a}`)}
                    />
                    <Legend wrapperStyle={{ fontSize: 13, color: T.textSecondary }} />
                    <ReferenceLine
                      y={estado.meta}
                      stroke={T.gold}
                      strokeDasharray="4 4"
                      label={{
                        value: `Meta: ${formatMi(estado.meta)}`,
                        fill: T.gold,
                        fontSize: 13,
                        position: "insideTopRight",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="nominal"
                      name="Nominal"
                      stroke={T.gold}
                      strokeWidth={2.5}
                      fill="url(#grNominal)"
                    />
                    <Area
                      type="monotone"
                      dataKey="real"
                      name="Real (ajustado p/ inflação)"
                      stroke={T.blue}
                      strokeWidth={2.5}
                      fill="url(#grReal)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tabela (colapsável) */}
            <div>
              <button
                onClick={() => setMostrarTabela((v) => !v)}
                style={{
                  ...C.btnSecondary,
                  width: "100%",
                  textAlign: "center",
                }}
              >
                {mostrarTabela ? "Ocultar" : "Mostrar"} tabela anual
              </button>
              {mostrarTabela && (
                <div style={{ marginTop: 12, ...C.card, padding: "18px 20px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: `0.5px solid ${T.border}` }}>
                        {["Ano", "Nominal", "Real", "Renda real"].map((h) => (
                          <th key={h} style={{
                            textAlign: "left",
                            padding: "12px 8px",
                            color: T.textMuted,
                            fontSize: 12,
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calcularProjecao(
                        estadoDebounced.patrimAtual,
                        estadoDebounced.aporte,
                        Math.max(estadoDebounced.prazo, 1),
                        { taxaAnual: estadoDebounced.taxaAnual, ipcaAnual: estadoDebounced.ipcaAnual }
                      ).map((t) => (
                        <tr key={t.ano} style={{ borderBottom: `0.5px solid ${T.border}` }}>
                          <td style={{ padding: "10px 8px", color: T.textSecondary }}>{t.ano}</td>
                          <td style={{ padding: "10px 8px", color: T.textPrimary }}>{brl(t.totalNominal)}</td>
                          <td style={{ padding: "10px 8px", color: T.textPrimary }}>{brl(t.totalReal)}</td>
                          <td style={{ padding: "10px 8px", color: T.textSecondary }}>{brl(t.rendaMensalReal)}/mês</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Cenários (linha horizontal) */}
        <div style={{ marginTop: 32 }}>
          <div style={{ ...C.sectionHeader, marginTop: 0 }}>
            <span>Cenários</span>
            <div style={C.divider} />
            <span style={{ color: T.textMuted, fontSize: 10 }}>
              {cenarios.length}/3 · apenas nesta sessão
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {cenarios.map((c, i) => (
              <CardCenario
                key={i}
                cenario={c}
                ativo={false}
                onRemover={() => removerCenario(i)}
                onCarregar={() => carregarCenario(i)}
              />
            ))}
            {cenarios.length < 3 && (
              <button
                onClick={salvarCenario}
                style={{
                  ...C.btnSecondary,
                  padding: "14px 18px",
                  minWidth: 180,
                  flex: 1,
                  border: `0.5px dashed ${T.border}`,
                  color: T.textSecondary,
                }}
              >
                + Salvar cenário atual
              </button>
            )}
          </div>
        </div>

        {/* Ações finais */}
        <div style={{
          marginTop: 36,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}>
          <button
            style={C.btnSecondary}
            onClick={() => navigate(`/cliente/${id}/objetivos`)}
          >
            Cancelar
          </button>
          <button
            style={{
              ...C.btnPrimary,
              width: "auto",
              padding: "14px 28px",
              opacity: salvando ? 0.6 : 1,
              cursor: salvando ? "wait" : "pointer",
            }}
            onClick={salvarComoObjetivo}
            disabled={salvando || estado.meta <= 0}
          >
            {salvando ? "Salvando..." : "Salvar como Objetivo"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function KPI({ label, hint, valor }) {
  return (
    <div
      style={{
        ...C.kpiCard,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 110,
        gap: 10,
        padding: "18px 20px",
      }}
    >
      <div>
        <div style={{ ...C.kpiLabel, fontSize: 12 }}>{label}</div>
        {hint && (
          <div
            style={{
              fontSize: 12,
              color: T.textMuted,
              marginTop: 6,
              lineHeight: 1.45,
              textTransform: "none",
              letterSpacing: 0,
              fontWeight: 400,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ ...C.kpiValue, fontSize: 24 }}>{valor}</div>
    </div>
  );
}
