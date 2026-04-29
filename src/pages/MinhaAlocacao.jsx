import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../hooks/useAuth";
import { brl } from "../utils/currency";
import { carregarSnapshotFirestore } from "../services/mercadoSnapshot";
import { pontuarAtivo } from "../services/scoringEngine";
import DonutChartModern from "../components/DonutChartModern";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
} from "recharts";
import {
  PERFIS, BUCKETS, BUCKET_KEYS, PERFIL_KEYS,
  calcularAlocacao, calcularDesvio,
} from "../constants/perfisInvestimento";
import "../styles/donut-chart.css";
import "../styles/minha-alocacao.css";

// ─── Constantes ───────────────────────────────────────────────────────────────
const CART_KEYS = [
  "posFixado","ipca","preFixado","acoes","fiis","multi",
  "prevVGBL","prevPGBL","globalEquities","globalTreasury",
  "globalFunds","globalBonds","global","outros",
];
const RV_KEYS = ["acoes","fiis","multi","globalEquities","globalFunds","globalBonds","prevVGBL","prevPGBL"];
const SCORE_CLASSE = { acoes:"acoesBR", fiis:"fiis", globalEquities:"acoesUS", globalFunds:"reits", multi:"acoesBR" };
const PERFIL_ABREV = { conservador:"C", moderado:"M", agressivo:"A" };

// Tolerância calibrada por perfil — Conservador exige mais disciplina; Agressivo aceita mais flutuação.
const TOLERANCIA_POR_PERFIL = { conservador: 3, moderado: 5, agressivo: 8 };

// Frases rotativas — variam por semana do ano para soar fresco a cada visita.
const MARATHON_QUOTES = [
  { quote: "Investimentos não são uma corrida de 100 metros — são uma maratona.", author: "" },
  { quote: "O mercado é um mecanismo que transfere dinheiro dos impacientes para os pacientes.", author: "Warren Buffett" },
  { quote: "Tempo dentro do mercado vale mais que tentar acertar o tempo do mercado.", author: "" },
  { quote: "A grande riqueza vem dos juros compostos — não das jogadas geniais.", author: "" },
  { quote: "Comprar boas empresas e segurar — esse é o segredo. O resto é ruído.", author: "Luiz Barsi" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCv(v) {
  return parseInt(String(v || "0").replace(/\D/g, "")) / 100;
}

function brlFmt(v) {
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(0)}k`;
  return brl(v);
}

function getPatFin(c) {
  const carteira = c?.carteira || {};
  return CART_KEYS.reduce((s, k) => {
    const ativos = carteira[k + "Ativos"];
    if (Array.isArray(ativos)) return s + ativos.reduce((a, at) => a + parseCv(at.valor), 0);
    return s + parseCv(carteira[k]);
  }, 0);
}

function quoteDaSemana() {
  const semana = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7));
  return MARATHON_QUOTES[semana % MARATHON_QUOTES.length];
}

// ─── Tooltip customizado do BarChart ──────────────────────────────────────────
function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ma-bar-tooltip">
      <div className="ma-bar-tooltip-label">{label}</div>
      <div className="ma-bar-tooltip-val">{brlFmt(payload[0].value)}</div>
    </div>
  );
}

// ─── PerfilCard ───────────────────────────────────────────────────────────────
function PerfilCard({ perfil, ativo }) {
  const [hoverKey, setHoverKey] = useState(null);

  const donutData = useMemo(() =>
    BUCKET_KEYS
      .filter(bk => (perfil.alocacao[bk] || 0) > 0)
      .map(bk => ({ key: bk, label: BUCKETS[bk].label, valor: perfil.alocacao[bk], cor: BUCKETS[bk].cor })),
    [perfil]
  );

  const hoverItem = donutData.find(d => d.key === hoverKey) || null;

  return (
    <div
      className={`cd-perfil-card ${ativo ? "cd-perfil-ativo" : ""}`}
      style={{ "--perfil-cor": perfil.cor }}
    >
      <div className="cd-perfil-topbar">
        <div className="cd-perfil-titulo-wrap">
          <span
            className="cd-perfil-abrev"
            style={{ background: perfil.cor + "22", color: perfil.cor, borderColor: perfil.cor + "44" }}
          >
            {PERFIL_ABREV[perfil.id]}
          </span>
          <span className="cd-perfil-nome" style={{ color: perfil.cor }}>{perfil.label}</span>
        </div>
        {ativo && <span className="cd-perfil-badge" style={{ borderColor: perfil.cor + "44", color: perfil.cor }}>Seu perfil</span>}
      </div>
      <p className="cd-perfil-desc">{perfil.descricao}</p>

      <div className="cd-perfil-corpo">
        <div className="cd-perfil-donut-wrap">
          <DonutChartModern
            data={donutData} total={100} size={180} thickness={34}
            formatValor={v => `${Math.round(v)}%`}
            labelCentro="" emptyText="—" onHover={setHoverKey}
          />
          <div className="cd-donut-centro-custom">
            {hoverItem ? (
              <>
                <span className="cd-dc-pct" style={{ color: hoverItem.cor }}>{hoverItem.valor}%</span>
                <span className="cd-dc-label">{hoverItem.label}</span>
              </>
            ) : (
              <span className="cd-dc-idle" style={{ color: perfil.cor }}>{perfil.label}</span>
            )}
          </div>
        </div>
        <div className="cd-perfil-legenda">
          {donutData.map(d => (
            <div key={d.key} className="cd-leg-item">
              <span className="cd-leg-dot" style={{ background: d.cor }} />
              <span className="cd-leg-label">{d.label}</span>
              <span className="cd-leg-val" style={{ color: hoverKey === d.key ? d.cor : undefined }}>
                {d.valor}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function MinhaAlocacao() {
  const { profile, isCliente } = useAuth();

  const [cliente, setCliente]   = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [assessor, setAssessor] = useState(null);
  const [loading, setLoading]   = useState(true);

  // Carrega dados do cliente logado + snapshot de mercado + assessor vinculado
  useEffect(() => {
    const clienteId = profile?.clienteId;
    if (!clienteId) { setLoading(false); return; }

    let vivo = true;
    Promise.all([
      getDoc(doc(db, "clientes", clienteId)),
      carregarSnapshotFirestore(),
    ]).then(async ([clienteSnap, snap]) => {
      if (!vivo) return;
      let clienteData = null;
      if (clienteSnap.exists()) {
        clienteData = { id: clienteSnap.id, ...clienteSnap.data() };
        setCliente(clienteData);
      }
      setSnapshot(snap);

      // Carrega o assessor vinculado a esse cliente
      const advisorId = clienteData?.advisorId || clienteData?.assessorId;
      if (advisorId) {
        try {
          const userSnap = await getDoc(doc(db, "users", advisorId));
          if (vivo && userSnap.exists()) setAssessor(userSnap.data());
        } catch { /* silencia */ }
      }
      if (vivo) setLoading(false);
    }).catch(() => { if (vivo) setLoading(false); });

    return () => { vivo = false; };
  }, [profile?.clienteId]);

  // Resolve link do WhatsApp dinamicamente baseado no assessor cadastrado
  function whatsAppLink(mensagem) {
    if (!assessor?.telefone) return null;
    const tel = String(assessor.telefone).replace(/\D/g, "");
    if (!tel) return null;
    const nomeAssessor = String(assessor.nome || "").split(" ")[0] || "";
    const nomeCliente  = String(cliente?.nome || profile?.nome || "").split(" ")[0] || "seu cliente";
    const txt = `Olá ${nomeAssessor}, aqui é ${nomeCliente}. ${mensagem}`;
    return `https://wa.me/${tel}?text=${encodeURIComponent(txt)}`;
  }
  const primeiroNomeAssessor = String(assessor?.nome || "").split(" ")[0] || "seu assessor";
  const temWhats = !!assessor?.telefone;

  // Alocação atual e perfil
  const alocacao = useMemo(() => {
    if (!cliente?.carteira) return null;
    return calcularAlocacao(cliente.carteira);
  }, [cliente]);

  const perfilId   = cliente?.perfilInvestimento || "moderado";
  const perfil     = PERFIS[perfilId] || PERFIS.moderado;
  const tolerancia = TOLERANCIA_POR_PERFIL[perfilId] || 5;

  // Reserva de emergência — prioridade #1 antes de qualquer rebalanceamento
  const reserva = useMemo(() => {
    if (!cliente?.carteira) return null;
    const meta = parseCv(cliente.carteira.reservaMeta);
    if (meta <= 0) return null;

    let liquidezObj = 0;
    let liquidezFallback = 0;
    CART_KEYS.forEach(k => {
      const ativos = cliente.carteira[k + "Ativos"];
      if (Array.isArray(ativos)) {
        ativos.forEach(a => {
          if (String(a.objetivo || "").toLowerCase() === "liquidez") liquidezObj += parseCv(a.valor);
        });
      }
    });
    ["posFixado", "ipca", "preFixado"].forEach(k => {
      const ativos = cliente.carteira[k + "Ativos"];
      if (Array.isArray(ativos)) liquidezFallback += ativos.reduce((s, a) => s + parseCv(a.valor), 0);
      else liquidezFallback += parseCv(cliente.carteira[k]);
    });
    const atual = liquidezObj > 0 ? liquidezObj : liquidezFallback;
    const pctCobertura = meta > 0 ? (atual / meta) * 100 : 0;

    return {
      meta, atual,
      falta: Math.max(0, meta - atual),
      pctCobertura,
      ok: atual >= meta,
      critico: atual < meta * 0.5,
    };
  }, [cliente]);

  // Desvios em relação ao perfil (com tolerância calibrada)
  const desvio = useMemo(() => {
    if (!cliente?.carteira) return null;
    return calcularDesvio(cliente.carteira, perfilId, tolerancia);
  }, [cliente, perfilId, tolerancia]);

  // Mapa ticker → ativo do snapshot
  const snapshotMap = useMemo(() => {
    if (!snapshot) return new Map();
    const map = new Map();
    [...(snapshot.br || []), ...(snapshot.us || [])].forEach(item => {
      if (item.ticker) map.set(String(item.ticker).toUpperCase(), item);
    });
    return map;
  }, [snapshot]);

  const patFin = useMemo(() => cliente ? getPatFin(cliente) : 0, [cliente]);

  // Sinais com contexto: peso na carteira, indicadores fundamentalistas, alternativas
  const sinais = useMemo(() => {
    const venda = [], compra = [];
    if (!snapshotMap.size || !cliente?.carteira) return { venda, compra };

    const alternativasPorClasse = new Map();
    for (const [, item] of snapshotMap) {
      const classe = item.moeda === "USD" ? "acoesUS" : "acoesBR";
      const analise = pontuarAtivo(item, classe);
      if (!analise.momentoCompra) continue;
      const lista = alternativasPorClasse.get(classe) || [];
      lista.push({ ticker: item.ticker, nome: item.nomeLongo || item.ticker, score: analise.score, dy: item.dy, pl: item.pl });
      alternativasPorClasse.set(classe, lista);
    }
    for (const [, lista] of alternativasPorClasse) lista.sort((a, b) => b.score - a.score);

    const tickersJaProcessados = new Set();

    for (const k of RV_KEYS) {
      const ativos = cliente.carteira[k + "Ativos"];
      if (!Array.isArray(ativos)) continue;
      const classe = SCORE_CLASSE[k] || "acoesBR";

      const valorPorTicker = new Map();
      for (const a of ativos) {
        if (!a.ticker) continue;
        const t = String(a.ticker).toUpperCase();
        valorPorTicker.set(t, (valorPorTicker.get(t) || 0) + parseCv(a.valor));
      }

      for (const [tick, valorTotal] of valorPorTicker) {
        if (tickersJaProcessados.has(tick)) continue;
        const mkt = snapshotMap.get(tick);
        if (!mkt) continue;
        tickersJaProcessados.add(tick);

        const analise = pontuarAtivo(mkt, classe);
        const peso = patFin > 0 ? (valorTotal / patFin) * 100 : 0;

        const indicadores = [];
        if (mkt.pl)  indicadores.push({ label: "P/L", valor: Number(mkt.pl).toFixed(1) });
        if (mkt.pvp) indicadores.push({ label: "P/VP", valor: Number(mkt.pvp).toFixed(1) });
        if (mkt.dy)  indicadores.push({ label: "DY", valor: `${Number(mkt.dy).toFixed(1)}%` });
        if (mkt.roe) indicadores.push({ label: "ROE", valor: `${Number(mkt.roe).toFixed(1)}%` });

        if (analise.sinalVenda) {
          const alternativas = (alternativasPorClasse.get(classe) || [])
            .filter(a => a.ticker !== tick)
            .slice(0, 2);

          venda.push({
            ticker: tick,
            nome: mkt.nomeLongo || tick,
            score: analise.score,
            faixa: analise.faixa,
            critica: analise.criticasVenda?.[0] || "",
            valor: valorTotal,
            peso,
            indicadores,
            alternativas,
          });
        } else if (analise.momentoCompra) {
          compra.push({
            ticker: tick,
            nome: mkt.nomeLongo || tick,
            score: analise.score,
            faixa: analise.faixa,
            ponto: analise.pontosFortes?.[0] || "",
            valor: valorTotal,
            peso,
            indicadores,
          });
        }
      }
    }
    return { venda: venda.slice(0, 6), compra: compra.slice(0, 6) };
  }, [cliente, snapshotMap, patFin]);

  // Dados do gráfico de pizza (donut)
  const donutData = useMemo(() => {
    if (!alocacao) return [];
    return BUCKET_KEYS
      .filter(bk => (alocacao.buckets[bk]?.valor || 0) > 0)
      .map(bk => ({
        key: bk, label: BUCKETS[bk].label,
        valor: alocacao.buckets[bk].valor,
        cor: BUCKETS[bk].cor,
      }));
  }, [alocacao]);

  // Dados do gráfico de barras
  const barData = useMemo(() => {
    if (!alocacao) return [];
    return BUCKET_KEYS
      .filter(bk => (alocacao.buckets[bk]?.valor || 0) > 0)
      .map(bk => ({
        name: BUCKETS[bk].label,
        valor: Math.round(alocacao.buckets[bk].valor),
        cor: BUCKETS[bk].cor,
        pct: alocacao.buckets[bk].pct,
      }));
  }, [alocacao]);

  // Objetivos vinculados a cada bucket
  const objetivosPorBucket = useMemo(() => {
    const map = new Map();
    if (!cliente?.carteira) return map;
    BUCKET_KEYS.forEach(bk => {
      const set = new Set();
      BUCKETS[bk].classes.forEach(k => {
        const ativos = cliente.carteira[k + "Ativos"];
        if (Array.isArray(ativos)) {
          ativos.forEach(a => {
            const obj = (a.objetivo || "").trim();
            if (obj) set.add(obj);
          });
        }
      });
      map.set(bk, [...set]);
    });
    return map;
  }, [cliente]);

  // Prioridades de ajuste
  const prioridades = useMemo(() => {
    if (!desvio?.desvios || !alocacao) return [];
    return Object.entries(desvio.desvios)
      .filter(([, d]) => Math.abs(d.delta) >= tolerancia)
      .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
      .map(([bk, d]) => {
        const valorReal = alocacao.buckets[bk]?.valor || 0;
        const valorAlvo = (alocacao.total * d.alvo) / 100;
        const ajusteRs  = valorAlvo - valorReal;
        return {
          bk,
          label: BUCKETS[bk].label,
          cor:   BUCKETS[bk].cor,
          ...d,
          ajusteRs,
          objetivos: objetivosPorBucket.get(bk) || [],
        };
      });
  }, [desvio, alocacao, objetivosPorBucket, tolerancia]);

  const [hoverDonut, setHoverDonut] = useState(null);
  const hoverItem = donutData.find(d => d.key === hoverDonut) || null;

  const quoteAtual = useMemo(() => quoteDaSemana(), []);

  if (loading) {
    return (
      <div className="dashboard-container has-sidebar">
        <Sidebar mode="cliente" clienteId={profile?.clienteId} />
        <Navbar showLogout={true} />
        <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>
          <div className="ma-loading">Carregando sua estratégia de alocação…</div>
        </div>
      </div>
    );
  }

  if (!isCliente && !profile?.clienteId) {
    return (
      <div className="dashboard-container has-sidebar">
        <Sidebar />
        <Navbar showLogout={true} />
        <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>
          <div className="ma-empty">Esta página é destinada ao cliente final. Acesse pelo painel do assessor para visualizar a carteira de um cliente.</div>
        </div>
      </div>
    );
  }

  // Botão de WhatsApp reutilizável — só renderiza se houver telefone do assessor
  const BotaoWhats = ({ mensagem, classe = "primary", children }) => {
    const url = whatsAppLink(mensagem);
    if (!url) return null;
    return (
      <a className={`ma-acao-btn ${classe}`} href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode="cliente" clienteId={profile?.clienteId} clienteNome={cliente?.nome} />
      <Navbar showLogout={true} />
      <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="ma-header">
          <h1 className="ma-title">Estratégia de Alocação</h1>
          <p className="ma-subtitle">
            Entenda como sua carteira está organizada e o caminho para o alinhamento perfeito com seus objetivos.
          </p>
          {perfil && (
            <div className="ma-perfil-badge" style={{ background: perfil.cor + "18", borderColor: perfil.cor + "40", color: perfil.cor }}>
              Seu perfil: {perfil.label} · tolerância {tolerancia}%
            </div>
          )}
        </div>

        {/* ── Alerta Reserva de Emergência (prioridade #1) ─────────── */}
        {reserva && !reserva.ok && (
          <div className={`ma-reserva-alerta ${reserva.critico ? "critico" : "atencao"}`}>
            <div className="ma-reserva-conteudo">
              <div className="ma-reserva-titulo">
                {reserva.critico ? "Reserva de emergência crítica" : "Reserva de emergência abaixo do ideal"}
              </div>
              <div className="ma-reserva-texto">
                Você tem <strong>{brlFmt(reserva.atual)}</strong> em liquidez para uma meta de <strong>{brlFmt(reserva.meta)}</strong> ({reserva.pctCobertura.toFixed(0)}% coberto).
                Faltam <strong>{brlFmt(reserva.falta)}</strong> para você ter tranquilidade total. Antes de qualquer rebalanceamento de renda variável, precisamos cuidar disso.
              </div>
              <div className="ma-reserva-bar">
                <div className="ma-reserva-bar-fill" style={{ width: `${Math.min(100, reserva.pctCobertura)}%` }} />
              </div>
              <BotaoWhats mensagem="Quero conversar sobre a minha reserva de emergência. Vamos montar um plano para fechá-la?">
                Falar com {primeiroNomeAssessor} sobre a reserva
              </BotaoWhats>
            </div>
          </div>
        )}
        {reserva && reserva.ok && (
          <div className="ma-reserva-ok">
            Reserva de emergência completa: {brlFmt(reserva.atual)} — você está protegido para imprevistos.
          </div>
        )}

        {/* ── Perfis padrão ────────────────────────────────────────── */}
        <section className="ma-section">
          <h2 className="ma-section-title">Perfis Padrão de Alocação</h2>
          <div className="ma-perfis-grid">
            {PERFIL_KEYS.map(pk => (
              <PerfilCard key={pk} perfil={PERFIS[pk]} ativo={pk === perfilId} />
            ))}
          </div>
        </section>

        {/* ── Minha Carteira Hoje ───────────────────────────────────── */}
        <section className="ma-section">
          <h2 className="ma-section-title">Minha Carteira Hoje</h2>

          {(!alocacao || alocacao.total === 0) ? (
            <div className="ma-empty">
              Nenhum ativo registrado na sua carteira ainda. Fale com seu assessor para registrar seus investimentos.
            </div>
          ) : (
            <div className="ma-carteira-card">
              <div className="ma-carteira-grid">

                {/* Gráfico Pizza */}
                <div className="ma-donut-col">
                  <span className="ma-donut-title">Distribuição por classe</span>
                  <div style={{ position: "relative" }}>
                    <DonutChartModern
                      data={donutData}
                      total={alocacao.total}
                      size={220}
                      thickness={40}
                      formatValor={v => brlFmt(v)}
                      labelCentro=""
                      emptyText="—"
                      onHover={setHoverDonut}
                    />
                    <div className="cd-donut-centro-custom" style={{ pointerEvents: "none" }}>
                      {hoverItem ? (
                        <>
                          <span className="cd-dc-pct" style={{ color: hoverItem.cor }}>
                            {alocacao.buckets[hoverItem.key]?.pct?.toFixed(1) ?? "0"}%
                          </span>
                          <span className="cd-dc-label">{hoverItem.label}</span>
                        </>
                      ) : (
                        <>
                          <span className="cd-dc-pct" style={{ color: perfil.cor }}>{brlFmt(alocacao.total)}</span>
                          <span className="cd-dc-label">Total</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="cd-perfil-legenda" style={{ width: "100%" }}>
                    {donutData.map(d => (
                      <div key={d.key} className="cd-leg-item">
                        <span className="cd-leg-dot" style={{ background: d.cor }} />
                        <span className="cd-leg-label">{d.label}</span>
                        <span className="cd-leg-val" style={{ color: hoverDonut === d.key ? d.cor : undefined }}>
                          {alocacao.buckets[d.key]?.pct?.toFixed(1) ?? "0"}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gráfico de Barras */}
                <div className="ma-bar-col">
                  <span className="ma-bar-title">Distribuição em reais</span>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={barData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }}>
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis
                        tick={{ fill: "#94a3b8", fontSize: 10 }}
                        tickFormatter={v => brlFmt(v)}
                        width={64}
                      />
                      <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={52}>
                        {barData.map((entry, i) => (
                          <Cell key={i} fill={entry.cor} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Maratona — frase rotativa por semana */}
              <div className="ma-marathon-box">
                <p className="ma-marathon-quote">"{quoteAtual.quote}"</p>
                {quoteAtual.author && <p className="ma-marathon-author">— {quoteAtual.author}</p>}
                <p className="ma-marathon-text">
                  Vamos construir sua jornada financeira com consistência, aproveitando as melhores
                  oportunidades de cada momento de mercado. Mês a mês ajustamos sua carteira sem pressa
                  — sempre alinhados com seus objetivos.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Ajustes Prioritários ─────────────────────────────────── */}
        {alocacao && alocacao.total > 0 && (
          <section className="ma-section">
            <h2 className="ma-section-title">Próximos Ajustes da Carteira</h2>

            {prioridades.length === 0 ? (
              <div className="ma-alinhado-box">
                <div>
                  <div className="ma-alinhado-text">Carteira alinhada ao seu perfil</div>
                  <div className="ma-alinhado-sub">
                    Todos os buckets estão dentro da tolerância de {tolerancia}% do perfil {perfil.label}.
                    Vamos manter assim aproveitando boas oportunidades nos próximos aportes.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="ma-secao-intro">
                  São os ajustes que vamos trabalhando juntos ao longo dos próximos meses, sempre
                  aproveitando as melhores oportunidades que o mercado apresentar.
                </p>
                <div className="ma-prioridades-list">
                  {prioridades.map(p => {
                    const over = p.delta > 0;
                    const valorAjuste = Math.abs(p.ajusteRs);
                    return (
                      <div key={p.bk} className="ma-prioridade-card" style={{ borderLeftColor: p.cor }}>
                        <div className="ma-prio-header">
                          <div className="ma-prio-titulo-grupo">
                            <span className="ma-prio-dot" style={{ background: p.cor }} />
                            <span className="ma-prio-titulo">{p.label}</span>
                          </div>
                          <span className={`ma-prio-delta ${over ? "over" : "under"}`}>
                            {over ? "+" : ""}{p.delta.toFixed(1)}%
                          </span>
                        </div>

                        <div className="ma-prio-comparativo">
                          <div className="ma-prio-num">
                            <span className="ma-prio-num-label">Hoje</span>
                            <span className="ma-prio-num-val">{p.real.toFixed(1)}%</span>
                          </div>
                          <div className="ma-prio-arrow">→</div>
                          <div className="ma-prio-num">
                            <span className="ma-prio-num-label">Alvo</span>
                            <span className="ma-prio-num-val" style={{ color: p.cor }}>{p.alvo.toFixed(1)}%</span>
                          </div>
                          <div className="ma-prio-num ma-prio-num-rs">
                            <span className="ma-prio-num-label">Ajuste</span>
                            <span className="ma-prio-num-val">
                              {over ? "−" : "+"}{brlFmt(valorAjuste)}
                            </span>
                          </div>
                        </div>

                        <p className="ma-prio-acao">
                          <strong>Plano:</strong>{" "}
                          {over
                            ? `Direcionar os próximos aportes para outras classes até reduzir essa exposição. Sem vender no momento — só esperar a carteira crescer no resto.`
                            : `Direcionar os próximos aportes para ${p.label} quando aparecerem boas oportunidades neste segmento.`
                          }
                        </p>

                        {p.objetivos.length > 0 && (
                          <div className="ma-prio-objetivos">
                            <span className="ma-prio-obj-label">Objetivos vinculados:</span>
                            {p.objetivos.map(o => (
                              <span key={o} className="ma-prio-obj-chip">{o}</span>
                            ))}
                          </div>
                        )}

                        <div className="ma-prio-acoes">
                          <BotaoWhats
                            mensagem={`Quero conversar sobre o ajuste de ${p.label} na minha carteira (estou ${over ? "acima" : "abaixo"} do alvo em ${Math.abs(p.delta).toFixed(1)}%).`}
                          >
                            Conversar com {primeiroNomeAssessor}
                          </BotaoWhats>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Recomendações para sua Carteira ──────────────────────── */}
        {(sinais.venda.length > 0 || sinais.compra.length > 0) && (
          <section className="ma-section">
            <h2 className="ma-section-title">Recomendações para sua Carteira</h2>
            <p className="ma-secao-intro">
              Análise dos indicadores fundamentalistas dos ativos que você já possui. <strong>Não são ordens de compra ou venda</strong> —
              são pontos de discussão para a próxima reunião com seu assessor.
            </p>

            <div className="ma-sinais-grid">
              {/* Coluna Venda */}
              <div>
                <div className="ma-sinais-col-title venda">Atenção do assessor</div>
                {sinais.venda.length === 0 ? (
                  <p className="ma-sem-sinais">Nenhum ativo da sua carteira em zona de atenção no momento.</p>
                ) : (
                  sinais.venda.map(s => (
                    <div key={s.ticker} className="ma-sinal-card">
                      <div className="ma-sinal-top">
                        <span className="ma-sinal-ticker">{s.ticker}</span>
                        <span className="ma-sinal-score venda">Score {s.score}/100 · {s.faixa}</span>
                      </div>
                      <div className="ma-sinal-peso">
                        Peso na carteira: <strong>{s.peso.toFixed(1)}%</strong> ({brlFmt(s.valor)})
                      </div>
                      <p className="ma-sinal-msg">{s.critica || "Indicadores abaixo do ideal para manutenção."}</p>
                      {s.indicadores.length > 0 && (
                        <div className="ma-sinal-indicadores">
                          {s.indicadores.map(ind => (
                            <span key={ind.label} className="ma-sinal-ind">
                              <span className="ma-sinal-ind-label">{ind.label}</span>
                              <span className="ma-sinal-ind-val">{ind.valor}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {s.alternativas.length > 0 && (
                        <div className="ma-sinal-alts">
                          <span className="ma-sinal-alts-label">Alternativas com bons fundamentos:</span>
                          {s.alternativas.map(a => (
                            <span key={a.ticker} className="ma-sinal-alt-chip" title={a.nome}>
                              {a.ticker} · score {a.score}
                            </span>
                          ))}
                        </div>
                      )}
                      <BotaoWhats
                        classe="ghost"
                        mensagem={`Vi que ${s.ticker} está com score ${s.score}/100 na análise. Pode me explicar o que está acontecendo e se devemos avaliar uma realocação?`}
                      >
                        Conversar sobre {s.ticker}
                      </BotaoWhats>
                    </div>
                  ))
                )}
              </div>

              {/* Coluna Compra */}
              <div>
                <div className="ma-sinais-col-title compra">Oportunidade de aporte</div>
                {sinais.compra.length === 0 ? (
                  <p className="ma-sem-sinais">Nenhum ativo da sua carteira em momento de compra identificado.</p>
                ) : (
                  sinais.compra.map(s => (
                    <div key={s.ticker} className="ma-sinal-card">
                      <div className="ma-sinal-top">
                        <span className="ma-sinal-ticker">{s.ticker}</span>
                        <span className="ma-sinal-score compra">Score {s.score}/100 · {s.faixa}</span>
                      </div>
                      <div className="ma-sinal-peso">
                        Peso na carteira: <strong>{s.peso.toFixed(1)}%</strong> ({brlFmt(s.valor)})
                      </div>
                      <p className="ma-sinal-msg">{s.ponto || "Fundamentos sólidos com preço em nível favorável."}</p>
                      {s.indicadores.length > 0 && (
                        <div className="ma-sinal-indicadores">
                          {s.indicadores.map(ind => (
                            <span key={ind.label} className="ma-sinal-ind">
                              <span className="ma-sinal-ind-label">{ind.label}</span>
                              <span className="ma-sinal-ind-val">{ind.valor}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <BotaoWhats
                        classe="ghost"
                        mensagem={`${s.ticker} está com score ${s.score}/100 na análise. Faz sentido reforçar essa posição no próximo aporte?`}
                      >
                        Conversar sobre {s.ticker}
                      </BotaoWhats>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── CTA final ────────────────────────────────────────────── */}
        {alocacao && alocacao.total > 0 && temWhats && (
          <section className="ma-cta-final">
            <h3>Vamos ajustar juntos?</h3>
            <p>Toda decisão de alocação deve passar por uma conversa. {primeiroNomeAssessor} está disponível.</p>
            <BotaoWhats
              classe="primary large"
              mensagem="Acabei de revisar minha alocação na plataforma. Podemos marcar uma conversa para alinhar os próximos passos?"
            >
              Marcar conversa com {primeiroNomeAssessor}
            </BotaoWhats>
          </section>
        )}

        {/* ── Aviso quando não há WhatsApp do assessor ─────────────── */}
        {alocacao && alocacao.total > 0 && !temWhats && (
          <section className="ma-cta-final ma-cta-sem-whats">
            <h3>Conte com seu assessor</h3>
            <p>O canal direto de WhatsApp ainda não foi configurado. Em breve seu assessor cadastrará o contato e você poderá falar com ele a partir desta tela.</p>
          </section>
        )}

      </div>
    </div>
  );
}
