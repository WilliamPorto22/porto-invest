import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../hooks/useAuth";
import { brl } from "../utils/currency";
import { carregarSnapshotFirestore } from "../services/mercadoSnapshot";
import { pontuarAtivo } from "../services/scoringEngine";
import DonutChartModern from "../components/DonutChartModern";
import {
  PERFIS, BUCKETS, BUCKET_KEYS, PERFIL_KEYS,
  calcularAlocacao, calcularDesvio,
} from "../constants/perfisInvestimento";
import "../styles/donut-chart.css";
import "../styles/carteiras-desalinhadas.css";

// ─── Constantes ───────────────────────────────────────────────────────────────
const CART_KEYS = ["posFixado","ipca","preFixado","acoes","fiis","multi","prevVGBL","prevPGBL","globalEquities","globalTreasury","globalFunds","globalBonds","global","outros"];
const SCORE_CLASSE = { acoes:"acoesBR", fiis:"fiis", globalEquities:"acoesUS", globalFunds:"reits", multi:"acoesBR" };
const RV_KEYS = ["acoes","fiis","multi","globalEquities","globalFunds","globalBonds","prevVGBL","prevPGBL"];
const PERFIL_ABREV = { conservador:"C", moderado:"M", agressivo:"A" };
const DIAS_SNAPSHOT_ALERTA = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getPatFin(c) {
  const carteira = c.carteira || {};
  const t = CART_KEYS.reduce((s, k) => {
    const ativos = carteira[k + "Ativos"];
    if (Array.isArray(ativos)) return s + ativos.reduce((a, at) => a + parseInt(String(at.valor || "0").replace(/\D/g,"")) / 100, 0);
    return s + parseInt(String(carteira[k] || "0").replace(/\D/g,"")) / 100;
  }, 0);
  if (t > 0) return t;
  return parseInt(String(c.patrimonio || "0").replace(/\D/g,"")) / 100;
}

function fmt(n)  { return `${n.toFixed(1)}%`; }
function pct(n)  { return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`; }
function brlK(v) {
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(0)}k`;
  return brl(v);
}
function brlM(v) {
  if (v >= 1e9) return `R$ ${(v / 1e9).toFixed(1)}Bi`;
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(0)}k`;
  return brl(v);
}

function snapshotIdade(snap) {
  if (!snap?.atualizadoEm) return null;
  const diff = Date.now() - new Date(snap.atualizadoEm).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ─── Perfil Donut Card ────────────────────────────────────────────────────────
function PerfilDonutCard({ perfil, ativo, onClick }) {
  const [hoverKey, setHoverKey] = useState(null);

  const donutData = useMemo(() =>
    BUCKET_KEYS.filter(bk => (perfil.alocacao[bk] || 0) > 0).map(bk => ({
      key: bk, label: BUCKETS[bk].label, valor: perfil.alocacao[bk], cor: BUCKETS[bk].cor,
    })), [perfil]);

  const hoverItem = donutData.find(d => d.key === hoverKey) || null;

  return (
    <div
      className={`cd-perfil-card ${ativo ? "cd-perfil-ativo" : ""}`}
      style={{ "--perfil-cor": perfil.cor }}
      onClick={onClick}
    >
      <div className="cd-perfil-topbar">
        <div className="cd-perfil-titulo-wrap">
          <span className="cd-perfil-abrev" style={{ background: perfil.cor + "22", color: perfil.cor, borderColor: perfil.cor + "44" }}>
            {PERFIL_ABREV[perfil.id]}
          </span>
          <span className="cd-perfil-nome" style={{ color: perfil.cor }}>{perfil.label}</span>
        </div>
        {ativo && <span className="cd-perfil-badge">● Ativo</span>}
      </div>
      <p className="cd-perfil-desc">{perfil.descricao}</p>

      <div className="cd-perfil-corpo">
        <div className="cd-perfil-donut-wrap">
          <DonutChartModern
            data={donutData} total={100} size={190} thickness={36}
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
          {donutData.map(item => (
            <div
              key={item.key}
              className={`cd-legenda-item ${hoverKey === item.key ? "cd-legenda-ativo" : ""}`}
              onMouseEnter={() => setHoverKey(item.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <span className="cd-legenda-dot" style={{ background: item.cor, boxShadow: `0 0 6px ${item.cor}` }} />
              <span className="cd-legenda-txt">{item.label}</span>
              <span className="cd-legenda-pct" style={{ color: hoverKey === item.key ? item.cor : "var(--text-primary)" }}>
                {item.valor}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Seletor de perfil inline ─────────────────────────────────────────────────
function PerfilSelector({ clienteId, perfilAtual, onSave }) {
  const [salvando, setSalvando] = useState(false);

  async function handle(pk, e) {
    e.stopPropagation();
    if (pk === perfilAtual) return;
    setSalvando(true);
    await onSave(clienteId, pk);
    setSalvando(false);
  }

  return (
    <div className="cd-perfil-sel" onClick={e => e.stopPropagation()}>
      {PERFIL_KEYS.map(pk => (
        <button
          key={pk}
          className={`cd-perfil-pill ${perfilAtual === pk ? "ativo" : ""}`}
          style={{ "--pill-cor": PERFIS[pk].cor }}
          onClick={e => handle(pk, e)}
          disabled={salvando}
          title={PERFIS[pk].label}
        >
          {PERFIL_ABREV[pk]}
        </button>
      ))}
      {!perfilAtual && <span className="cd-perfil-sem">Sem perfil</span>}
    </div>
  );
}

// ─── Cliente Row ──────────────────────────────────────────────────────────────
function ClienteRow({ cliente, perfilId, tolerancia, snapshotMap, onSalvarPerfil, nav }) {
  const desvioData = useMemo(
    () => perfilId ? calcularDesvio(cliente.carteira, perfilId, tolerancia) : null,
    [cliente.carteira, perfilId, tolerancia]
  );

  const alertasVenda = useMemo(() => {
    if (!snapshotMap?.size) return [];
    const carteira = cliente.carteira || {};
    const res = [];
    for (const key of RV_KEYS) {
      const ativos = carteira[key + "Ativos"];
      if (!Array.isArray(ativos)) continue;
      const classe = SCORE_CLASSE[key] || "acoesBR";
      for (const a of ativos) {
        if (!a.ticker) continue;
        const tick = String(a.ticker).toUpperCase();
        const mkt = snapshotMap.get(tick);
        if (!mkt) continue;
        if (pontuarAtivo(mkt, classe).sinalVenda)
          res.push({ ticker: tick, nome: a.nome || tick });
      }
    }
    return res;
  }, [cliente.carteira, snapshotMap]);

  const patFin = getPatFin(cliente);

  // sem perfil em modo individual
  if (!perfilId) {
    return (
      <div className="cd-cliente-row cd-sem-perfil" onClick={() => nav(`/cliente/${cliente.id}`)}>
        <div className="cd-row-left">
          <div className="cd-row-nome">{cliente.nome || "Cliente sem nome"}</div>
          <div className="cd-row-pat">{brlK(patFin)}</div>
          <PerfilSelector clienteId={cliente.id} perfilAtual={cliente.perfilInvestimento} onSave={onSalvarPerfil} />
        </div>
        <div className="cd-row-sem-perfil-msg">Perfil não atribuído — defina ao lado para comparar</div>
        <div className="cd-row-right" />
      </div>
    );
  }

  if (!desvioData) return null;
  const { desvios, maxDesvio, desalinhado } = desvioData;

  return (
    <div
      className={`cd-cliente-row ${desalinhado ? "cd-desalinhado" : "cd-alinhado"}`}
      onClick={() => nav(`/cliente/${cliente.id}`)}
    >
      <div className="cd-row-left">
        <div className="cd-row-nome">
          {cliente.nome || "Cliente sem nome"}
          {alertasVenda.length > 0 && (
            <span className="cd-badge-venda" title={alertasVenda.map(a => a.ticker).join(", ")}>
              ⚠ {alertasVenda.length} alerta{alertasVenda.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="cd-row-pat">{brlK(patFin)}</div>
        <PerfilSelector clienteId={cliente.id} perfilAtual={cliente.perfilInvestimento} onSave={onSalvarPerfil} />
      </div>

      <div className="cd-row-buckets">
        {BUCKET_KEYS.map(bk => {
          const d = desvios[bk];
          const fora = Math.abs(d.delta) > tolerancia && (d.alvo > 0 || d.real > tolerancia);
          return (
            <div key={bk} className={`cd-bucket-cell ${fora ? "cd-bucket-fora" : ""}`}>
              <div className="cd-bucket-label">{BUCKETS[bk].label}</div>
              <div className="cd-bucket-real" style={{ color: BUCKETS[bk].cor }}>{fmt(d.real)}</div>
              <div className="cd-bucket-alvo">alvo {fmt(d.alvo)}</div>
              {fora && <div className="cd-bucket-delta">{pct(d.delta)}</div>}
            </div>
          );
        })}
      </div>

      <div className="cd-row-right">
        <span className="cd-gauge" style={{ color: maxDesvio < 5 ? "#22c55e" : maxDesvio < 15 ? "#F0A202" : "#ef4444" }}>
          {maxDesvio.toFixed(0)}%
        </span>
        <div className="cd-row-status">{desalinhado ? "Desalinhado" : "Alinhado"}</div>
        {desalinhado && (
          <button
            className="cd-btn-rebalancear"
            onClick={e => { e.stopPropagation(); nav(`/cliente/${cliente.id}/ajustes`); }}
          >
            Rebalancear →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CarteirasDesalinhadas() {
  const { user, isAssessor } = useAuth();
  const nav = useNavigate();

  const [clientes, setClientes]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [erro, setErro]                   = useState(null);
  const [snapshot, setSnapshot]           = useState(null);
  const [snapshotLoading, setSnapLoading] = useState(true);

  const [perfilFiltro, setPerfilFiltro]   = useState("moderado");
  const [tolerancia, setTolerancia]       = useState(5);
  const [busca, setBusca]                 = useState("");
  const [apenasDesalinhados, setApenas]   = useState(false);
  const [tabMercado, setTabMercado]       = useState("venda");
  const [mostrarSemCarteira, setMostrarSemCarteira] = useState(false);

  // ── Load clientes ───────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const col = collection(db, "clientes");
        const q = isAssessor && user?.uid ? query(col, where("advisorId", "==", user.uid)) : col;
        let docs = [];
        try {
          const s = await getDocs(q);
          docs = s.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch {
          if (isAssessor && user?.uid) {
            const s2 = await getDocs(query(col, where("assessorId", "==", user.uid)));
            docs = s2.docs.map(d => ({ id: d.id, ...d.data() }));
          }
        }
        if (vivo) setClientes(docs);
      } catch (e) {
        if (vivo) setErro("Erro ao carregar clientes: " + e.message);
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [isAssessor, user?.uid]);

  // ── Load snapshot ───────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const snap = await carregarSnapshotFirestore();
        if (vivo) setSnapshot(snap);
      } catch { /* opcional */ }
      finally { if (vivo) setSnapLoading(false); }
    })();
    return () => { vivo = false; };
  }, []);

  // ── Snapshot map ────────────────────────────────────────────────────────────
  const snapshotMap = useMemo(() => {
    if (!snapshot) return new Map();
    const m = new Map();
    for (const a of [...(snapshot.br || []), ...(snapshot.us || [])])
      if (a.ticker) m.set(String(a.ticker).toUpperCase(), a);
    return m;
  }, [snapshot]);

  // ── Snapshot desatualizado ──────────────────────────────────────────────────
  const diasSnapshot = useMemo(() => snapshotIdade(snapshot), [snapshot]);
  const snapDesatualizado = diasSnapshot !== null && diasSnapshot >= DIAS_SNAPSHOT_ALERTA;

  // ── Salvar perfil do cliente ────────────────────────────────────────────────
  const salvarPerfil = useCallback(async (clienteId, novoPerfil) => {
    try {
      await updateDoc(doc(db, "clientes", clienteId), { perfilInvestimento: novoPerfil });
      setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, perfilInvestimento: novoPerfil } : c));
    } catch (e) { console.error("Erro ao salvar perfil:", e.message); }
  }, []);

  // ── Separar clientes sem carteira ───────────────────────────────────────────
  const { comCarteira, semCarteira } = useMemo(() => ({
    comCarteira: clientes.filter(c => getPatFin(c) > 0),
    semCarteira: clientes.filter(c => getPatFin(c) === 0),
  }), [clientes]);

  // ── Resolve perfil efetivo de cada cliente ─────────────────────────────────
  function perfilEfetivo(cliente) {
    if (perfilFiltro === "individual") return cliente.perfilInvestimento || null;
    return perfilFiltro;
  }

  // ── Filtrar clientes ────────────────────────────────────────────────────────
  const clientesFiltrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return comCarteira.filter(c => {
      if (b && !(c.nome || "").toLowerCase().includes(b)) return false;
      if (apenasDesalinhados) {
        const pid = perfilEfetivo(c);
        if (!pid) return false;
        const d = calcularDesvio(c.carteira, pid, tolerancia);
        if (!d?.desalinhado) return false;
      }
      return true;
    });
  }, [comCarteira, busca, perfilFiltro, tolerancia, apenasDesalinhados]);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let desalinhados = 0, volumeDesalinhado = 0, alertasVenda = 0, oportunidades = 0;
    const tickersSV = new Set();

    for (const c of comCarteira) {
      const pid = perfilEfetivo(c);
      if (pid) {
        const d = calcularDesvio(c.carteira, pid, tolerancia);
        if (d?.desalinhado) { desalinhados++; volumeDesalinhado += getPatFin(c); }
      }
    }

    if (snapshotMap.size) {
      for (const c of comCarteira) {
        const carteira = c.carteira || {};
        for (const key of RV_KEYS) {
          const ativos = carteira[key + "Ativos"];
          if (!Array.isArray(ativos)) continue;
          const classe = SCORE_CLASSE[key] || "acoesBR";
          for (const a of ativos) {
            if (!a.ticker) continue;
            const tick = String(a.ticker).toUpperCase();
            if (tickersSV.has(tick)) continue;
            const mkt = snapshotMap.get(tick);
            if (!mkt) continue;
            if (pontuarAtivo(mkt, classe).sinalVenda) { tickersSV.add(tick); alertasVenda++; }
          }
        }
      }
      for (const [, a] of snapshotMap) {
        const classe = a.moeda === "USD" ? "acoesUS" : "acoesBR";
        if (pontuarAtivo(a, classe).momentoCompra) oportunidades++;
      }
    }

    return { total: comCarteira.length, desalinhados, volumeDesalinhado, alertasVenda, oportunidades };
  }, [comCarteira, perfilFiltro, tolerancia, snapshotMap]);

  // ── Alertas agrupados (venda) ───────────────────────────────────────────────
  const alertasAgrupados = useMemo(() => {
    if (!snapshotMap.size) return [];
    const mapa = new Map();
    for (const c of comCarteira) {
      const carteira = c.carteira || {};
      for (const key of RV_KEYS) {
        const ativos = carteira[key + "Ativos"];
        if (!Array.isArray(ativos)) continue;
        const classe = SCORE_CLASSE[key] || "acoesBR";
        for (const a of ativos) {
          if (!a.ticker) continue;
          const tick = String(a.ticker).toUpperCase();
          const mkt = snapshotMap.get(tick);
          if (!mkt) continue;
          if (!mapa.has(tick)) {
            const analise = pontuarAtivo(mkt, classe);
            if (!analise.sinalVenda) continue;
            mapa.set(tick, { ticker: tick, nome: mkt.nomeLongo || tick, score: analise.score, faixa: analise.faixa, criticas: analise.criticasVenda?.slice(0, 2) || [], clientes: [] });
          }
          mapa.get(tick)?.clientes.push({ id: c.id, nome: c.nome || "Sem nome" });
        }
      }
    }
    return Array.from(mapa.values()).sort((a, b) => a.score - b.score);
  }, [comCarteira, snapshotMap]);

  // ── Oportunidades de compra ─────────────────────────────────────────────────
  const oportunidadesCompra = useMemo(() => {
    if (!snapshotMap.size) return [];
    const res = [];
    for (const [, a] of snapshotMap) {
      const classe = a.moeda === "USD" ? "acoesUS" : "acoesBR";
      const analise = pontuarAtivo(a, classe);
      if (analise.momentoCompra)
        res.push({ ticker: a.ticker, nome: a.nomeLongo || a.ticker, score: analise.score, faixa: analise.faixa, pontos: analise.pontosFortes?.slice(0, 1) || [], preco: a.preco, dy: a.dy, pl: a.pl, moeda: a.moeda });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, 20);
  }, [snapshotMap]);

  // ── Loading / Erro ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="dashboard-layout"><Sidebar />
      <div className="dashboard-main"><Navbar />
        <div className="dashboard-content with-sidebar"><div className="cd-loading">Carregando análise de carteiras…</div></div>
      </div>
    </div>
  );

  if (erro) return (
    <div className="dashboard-layout"><Sidebar />
      <div className="dashboard-main"><Navbar />
        <div className="dashboard-content with-sidebar"><div className="cd-erro">{erro}</div></div>
      </div>
    </div>
  );

  const perfilLabel = perfilFiltro === "individual" ? "Individual" : PERFIS[perfilFiltro]?.label;

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar />
      <Navbar showLogout={true} />
      <div className="dashboard-content with-sidebar">

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="cd-header">
            <div>
              <h1 className="cd-title">⚖️ Carteiras Desalinhadas</h1>
              <p className="cd-subtitle">Identifica desvios em relação aos perfis padrão e cruza com a análise de mercado do dia.</p>
            </div>
          </div>

          {/* ── Banner: snapshot desatualizado ──────────────────────────────── */}
          {snapDesatualizado && (
            <div className="cd-banner-warn">
              ⚠ Snapshot de mercado com {diasSnapshot} dia{diasSnapshot > 1 ? "s" : ""} — alertas de venda e oportunidades podem estar desatualizados.{" "}
              <button className="cd-banner-link" onClick={() => nav("/mercado")}>Atualizar em /mercado →</button>
            </div>
          )}
          {!snapshot && !snapshotLoading && (
            <div className="cd-banner-warn">
              ⚠ Nenhum snapshot de mercado encontrado. A inteligência de mercado não estará disponível até você atualizar em{" "}
              <button className="cd-banner-link" onClick={() => nav("/mercado")}>/mercado →</button>
            </div>
          )}

          {/* ── KPIs ────────────────────────────────────────────────────────── */}
          <div className="cd-kpis">
            <div className="cd-kpi">
              <div className="cd-kpi-val">{kpis.total}</div>
              <div className="cd-kpi-label">Clientes com carteira</div>
            </div>
            <div className="cd-kpi cd-kpi-warn">
              <div className="cd-kpi-val">{kpis.desalinhados}</div>
              <div className="cd-kpi-label">Desalinhados ({perfilLabel})</div>
              {kpis.desalinhados > 0 && kpis.volumeDesalinhado > 0 && (
                <div className="cd-kpi-sub">{brlM(kpis.volumeDesalinhado)} em risco</div>
              )}
            </div>
            <div className="cd-kpi cd-kpi-danger">
              <div className="cd-kpi-val">{kpis.alertasVenda}</div>
              <div className="cd-kpi-label">Ativos com alerta de venda</div>
            </div>
            <div className="cd-kpi cd-kpi-success">
              <div className="cd-kpi-val">{kpis.oportunidades}</div>
              <div className="cd-kpi-label">Oportunidades de compra</div>
            </div>
          </div>

          {/* ── Perfis Padrão ───────────────────────────────────────────────── */}
          <section className="cd-section">
            <h2 className="cd-section-title">Perfis Padrão de Alocação</h2>
            <div className="cd-perfis-grid">
              {PERFIL_KEYS.map(pk => (
                <PerfilDonutCard
                  key={pk}
                  perfil={PERFIS[pk]}
                  ativo={pk === perfilFiltro}
                  onClick={() => setPerfilFiltro(pk)}
                />
              ))}
            </div>
          </section>

          {/* ── Filtros ─────────────────────────────────────────────────────── */}
          <section className="cd-section">
            <div className="cd-filtros">
              <div className="cd-filtro-group">
                <label className="cd-filtro-label">Comparar contra</label>
                <div className="cd-perfil-tabs">
                  {PERFIL_KEYS.map(pk => (
                    <button
                      key={pk}
                      className={`cd-perfil-tab ${perfilFiltro === pk ? "ativo" : ""}`}
                      style={{ "--tab-cor": PERFIS[pk].cor }}
                      onClick={() => setPerfilFiltro(pk)}
                    >
                      {PERFIS[pk].label}
                    </button>
                  ))}
                  <button
                    className={`cd-perfil-tab ${perfilFiltro === "individual" ? "ativo" : ""}`}
                    style={{ "--tab-cor": "#F0A202" }}
                    onClick={() => setPerfilFiltro("individual")}
                    title="Compara cada cliente contra o perfil atribuído individualmente"
                  >
                    ★ Individual
                  </button>
                </div>
              </div>
              <div className="cd-filtro-group">
                <label className="cd-filtro-label">Tolerância: <strong>{tolerancia}%</strong></label>
                <input type="range" min={2} max={20} step={1} value={tolerancia}
                  onChange={e => setTolerancia(Number(e.target.value))} className="cd-slider" />
              </div>
              <div className="cd-filtro-group">
                <label className="cd-filtro-label">Buscar</label>
                <input type="text" placeholder="Nome do cliente…" value={busca}
                  onChange={e => setBusca(e.target.value)} className="cd-input-busca" />
              </div>
              <div className="cd-filtro-group cd-filtro-toggle">
                <label className="cd-toggle-label">
                  <input type="checkbox" checked={apenasDesalinhados} onChange={e => setApenas(e.target.checked)} />
                  <span>Apenas desalinhados</span>
                </label>
              </div>
            </div>
          </section>

          {/* ── Lista de Clientes ───────────────────────────────────────────── */}
          <section className="cd-section">
            <div className="cd-section-header">
              <h2 className="cd-section-title" style={{ marginBottom: 0 }}>
                Clientes vs Perfil {perfilLabel}
                <span className="cd-count">{clientesFiltrados.length}</span>
              </h2>
            </div>

            <div className="cd-table-head">
              <div className="cd-th-left">Cliente / Patrimônio / Perfil</div>
              <div className="cd-th-buckets">
                {BUCKET_KEYS.map(bk => <div key={bk} className="cd-th-bucket">{BUCKETS[bk].label}</div>)}
              </div>
              <div className="cd-th-right">Desvio / Ação</div>
            </div>

            {clientesFiltrados.length === 0 ? (
              <div className="cd-empty">
                {apenasDesalinhados ? "Nenhum cliente desalinhado com os filtros selecionados." : "Nenhum cliente encontrado."}
              </div>
            ) : (
              clientesFiltrados.map(c => (
                <ClienteRow
                  key={c.id}
                  cliente={c}
                  perfilId={perfilEfetivo(c)}
                  tolerancia={tolerancia}
                  snapshotMap={snapshotMap}
                  onSalvarPerfil={salvarPerfil}
                  nav={nav}
                />
              ))
            )}

            {/* Clientes sem carteira */}
            {semCarteira.length > 0 && (
              <div className="cd-sem-carteira-wrap">
                <button className="cd-sem-carteira-toggle" onClick={() => setMostrarSemCarteira(v => !v)}>
                  {mostrarSemCarteira ? "▲" : "▼"} {semCarteira.length} cliente{semCarteira.length > 1 ? "s" : ""} sem carteira cadastrada
                </button>
                {mostrarSemCarteira && (
                  <div className="cd-sem-carteira-lista">
                    {semCarteira.map(c => (
                      <button key={c.id} className="cd-cliente-chip" onClick={() => nav(`/cliente/${c.id}`)}>
                        {c.nome || "Sem nome"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Inteligência de Mercado ──────────────────────────────────────── */}
          <section className="cd-section">
            <h2 className="cd-section-title">Inteligência de Mercado</h2>
            <p className="cd-section-sub">
              Cruzamento da análise de mercado com os ativos dos clientes.
              {snapshot && (
                <span className="cd-snapshot-ts">
                  {" "}Snapshot: {new Date(snapshot.atualizadoEm).toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
                  {diasSnapshot !== null && diasSnapshot > 0 && ` (${diasSnapshot}d atrás)`}
                </span>
              )}
            </p>

            <div className="cd-mercado-tabs">
              <button className={`cd-mercado-tab ${tabMercado === "venda" ? "ativo" : ""}`} onClick={() => setTabMercado("venda")}>
                ⚠ Alertas de Venda
                {alertasAgrupados.length > 0 && <span className="cd-tab-badge danger">{alertasAgrupados.length}</span>}
              </button>
              <button className={`cd-mercado-tab ${tabMercado === "compra" ? "ativo" : ""}`} onClick={() => setTabMercado("compra")}>
                ✦ Oportunidades de Compra
                {oportunidadesCompra.length > 0 && <span className="cd-tab-badge success">{oportunidadesCompra.length}</span>}
              </button>
            </div>

            {tabMercado === "venda" && (
              <div className="cd-mercado-body">
                {snapshotLoading && <div className="cd-loading-small">Carregando análise…</div>}
                {!snapshotLoading && alertasAgrupados.length === 0 && (
                  <div className="cd-empty">
                    {!snapshotMap.size ? "Snapshot indisponível — atualize em /mercado." : "Nenhum ativo em carteira com sinal de venda no momento."}
                  </div>
                )}
                {alertasAgrupados.map(item => (
                  <div key={item.ticker} className="cd-alerta-card">
                    <div className="cd-alerta-top">
                      <div className="cd-alerta-ticker">
                        <span className="cd-ticker-badge">{item.ticker}</span>
                        <span className="cd-alerta-nome">{item.nome}</span>
                      </div>
                      <div className="cd-alerta-score">
                        <span className="cd-score-num danger">{item.score}/100</span>
                        <span className="cd-score-faixa">{item.faixa}</span>
                      </div>
                    </div>
                    {item.criticas.map((cr, i) => <p key={i} className="cd-alerta-critica">• {cr}</p>)}
                    <div className="cd-alerta-clientes">
                      <span className="cd-alerta-clientes-label">Clientes:</span>
                      {item.clientes.slice(0, 8).map(cl => (
                        <button key={cl.id} className="cd-cliente-chip" onClick={e => { e.stopPropagation(); nav(`/cliente/${cl.id}`); }}>
                          {cl.nome}
                        </button>
                      ))}
                      {item.clientes.length > 8 && <span className="cd-mais">+{item.clientes.length - 8}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tabMercado === "compra" && (
              <div className="cd-mercado-body">
                {snapshotLoading && <div className="cd-loading-small">Carregando análise…</div>}
                {!snapshotLoading && oportunidadesCompra.length === 0 && (
                  <div className="cd-empty">
                    {!snapshotMap.size ? "Snapshot indisponível — atualize em /mercado." : "Nenhum ativo com todos os critérios de compra favoráveis."}
                  </div>
                )}
                <div className="cd-oport-grid">
                  {oportunidadesCompra.map(item => (
                    <div key={item.ticker} className="cd-oport-card">
                      <div className="cd-oport-top">
                        <span className="cd-ticker-badge success">{item.ticker}</span>
                        <span className="cd-score-num success">{item.score}/100</span>
                      </div>
                      <div className="cd-oport-nome">{item.nome}</div>
                      <div className="cd-oport-metricas">
                        {item.preco && <span>R$ {item.preco.toFixed(2)}</span>}
                        {item.pl    && <span>P/L {item.pl.toFixed(1)}</span>}
                        {item.dy    && <span>DY {item.dy.toFixed(1)}%</span>}
                        {item.moeda === "USD" && <span className="cd-moeda-badge">USD</span>}
                      </div>
                      {item.pontos[0] && <p className="cd-oport-ponto">✦ {item.pontos[0]}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

        </div>
    </div>
  );
}
