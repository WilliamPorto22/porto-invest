import React, { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../hooks/useAuth";

import MaioresAltasWidget from "../components/mercado/MaioresAltasWidget";
import TabelaAtivos from "../components/mercado/TabelaAtivos";
import PontosAtencao from "../components/mercado/PontosAtencao";
import AtivoModal from "../components/mercado/AtivoModal";
import TradingViewWidget from "../components/mercado/TradingViewWidget";
import ResumoDoDia from "../components/mercado/ResumoDoDia";
import MarketBar from "../components/MarketBar";

import { ACOES_BR, FIIS, ACOES_US, REITS } from "../constants/mercadoUniverso";
import { buscarAtivosBR, buscarAtivosUS, rankear } from "../services/marketData";
import { rankearPorScore } from "../services/scoringEngine";
import { carregarSnapshotFirestore, salvarSnapshotFirestore } from "../services/mercadoSnapshot";
import { parseCentavos } from "../utils/currency";

import "../styles/mercado.css";

const CLASSES_TABS = [
  { id: "acoesBR", label: "Ações BR", badge: "B3",     moeda: "BRL", universo: ACOES_BR },
  { id: "fiis",    label: "FIIs",     badge: "B3",     moeda: "BRL", universo: FIIS },
  { id: "acoesUS", label: "Ações US", badge: "NASDAQ", moeda: "USD", universo: ACOES_US },
  { id: "reits",   label: "REITs",    badge: "NYSE",   moeda: "USD", universo: REITS },
];

export default function Mercado() {
  const { isMaster, isCliente, profile } = useAuth();

  const [loading, setLoading]           = useState(true);
  const [atualizando, setAtualizando]   = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const [atualizadoPor, setAtualizadoPor] = useState(null);
  const [erro, setErro]                 = useState(null);

  const [brutos, setBrutos] = useState({ br: [], us: [] });
  const [modal, setModal]   = useState(null);
  const [tab, setTab]       = useState("acoesBR");

  // Map<ticker, { valorReais }> dos ativos da carteira do cliente.
  // Alimenta ResumoDoDia: prioriza sinais de venda dos ativos que ele JÁ tem,
  // e gera a mini-tabela "Sua carteira hoje" com peso e veredito.
  const [tickersCliente, setTickersCliente] = useState(null);

  useEffect(() => {
    if (!isCliente || !profile?.clienteId) { setTickersCliente(null); return; }
    let vivo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "clientes", profile.clienteId));
        if (!vivo || !snap.exists()) return;
        const carteira = snap.data().carteira || {};
        const map = new Map();
        for (const key of Object.keys(carteira)) {
          if (!key.endsWith("Ativos")) continue;
          const arr = Array.isArray(carteira[key]) ? carteira[key] : [];
          for (const a of arr) {
            if (!a?.ticker) continue;
            const t = String(a.ticker).toUpperCase();
            const valorReais = parseCentavos(a.valor) / 100;
            const prev = map.get(t);
            map.set(t, { valorReais: (prev?.valorReais || 0) + valorReais });
          }
        }
        setTickersCliente(map);
      } catch (e) { console.warn("[Mercado] carteira do cliente:", e.message); }
    })();
    return () => { vivo = false; };
  }, [isCliente, profile?.clienteId]);

  // === Mount: lê snapshot do Firestore ===
  useEffect(() => {
    (async () => {
      try {
        const snap = await carregarSnapshotFirestore();
        if (snap) {
          setBrutos({ br: snap.br, us: snap.us });
          setAtualizadoEm(snap.atualizadoEm);
          setAtualizadoPor(snap.atualizadoPor);
        }
      } catch (e) {
        setErro("Não foi possível ler o último snapshot.");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // === Atualização manual (só master) ===
  const atualizar = useCallback(async () => {
    if (!isMaster) return;
    setAtualizando(true);
    setErro(null);

    const GLOBAL_TIMEOUT_MS = 100000;
    const timeoutPromise = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("Timeout global de 100s atingido")), GLOBAL_TIMEOUT_MS)
    );

    try {
      const tickersBR = [...ACOES_BR.map((x) => x.ticker), ...FIIS.map((x) => x.ticker)];
      const tickersUS = [...ACOES_US.map((x) => x.ticker), ...REITS.map((x) => x.ticker)];

      const fetchAll = Promise.allSettled([
        buscarAtivosBR(tickersBR),
        buscarAtivosUS(tickersUS),
      ]);

      const results = await Promise.race([fetchAll, timeoutPromise]);
      const br = results[0]?.status === "fulfilled" ? results[0].value : [];
      const us = results[1]?.status === "fulfilled" ? results[1].value : [];

      if (br.length === 0 && us.length === 0) {
        setErro("Nenhuma fonte de dados respondeu. As APIs públicas (Yahoo/Stooq) podem estar fora do ar. Tente novamente em alguns minutos.");
        return;
      }

      await salvarSnapshotFirestore({ br, us });
      setBrutos({ br, us });
      setAtualizadoEm(new Date());
      if (br.length < 10 || us.length < 10) {
        setErro(`Atualização parcial: ${br.length} ativos BR e ${us.length} ativos US. Algumas fontes podem estar instáveis — os dados disponíveis foram salvos.`);
      }
    } catch (e) {
      console.error(e);
      const isTimeout = e.message?.includes("Timeout");
      setErro(isTimeout
        ? "A atualização passou de 100 segundos e foi cancelada. Tente novamente."
        : "Erro ao atualizar dados. Tente novamente em alguns minutos.");
    } finally {
      setAtualizando(false);
    }
  }, [isMaster]);

  // === Merge universo + snapshot ===
  const construirClasse = (universo, fonteDados) => {
    const mapa = {};
    fonteDados.forEach((d) => { mapa[d.ticker] = d; });
    return universo.map((u) => {
      const d = mapa[u.ticker] || {};
      return {
        ...d,
        ticker: u.ticker,
        nome: u.nome,
        nomeLongo: d.nomeLongo || u.nome,
        setor: u.setor,
      };
    });
  };

  const porClasse = useMemo(() => ({
    acoesBR: construirClasse(ACOES_BR, brutos.br),
    fiis:    construirClasse(FIIS,     brutos.br),
    acoesUS: construirClasse(ACOES_US, brutos.us),
    reits:   construirClasse(REITS,    brutos.us),
  }), [brutos]);

  const top = useMemo(() => ({
    acoesBR: rankearPorScore(porClasse.acoesBR, "acoesBR", { top: 15 }),
    fiis:    rankearPorScore(porClasse.fiis,    "fiis",    { top: 15 }),
    acoesUS: rankearPorScore(porClasse.acoesUS, "acoesUS", { top: 15 }),
    reits:   rankearPorScore(porClasse.reits,   "reits",   { top: 15 }),
  }), [porClasse]);

  // === Rankings altas/baixas ===
  const rankingBR = useMemo(() => {
    const r = rankear(porClasse.acoesBR, { campo: "variacaoDia", top: 10 });
    return {
      altas:  r.altas.map((a) => ({ ticker: a.ticker, variacao: a.variacaoDia })),
      baixas: r.baixas.map((a) => ({ ticker: a.ticker, variacao: a.variacaoDia })),
    };
  }, [porClasse.acoesBR]);

  const rankingUS = useMemo(() => {
    const r = rankear(porClasse.acoesUS, { campo: "variacaoDia", top: 10 });
    return {
      altas:  r.altas.map((a) => ({ ticker: a.ticker, variacao: a.variacaoDia })),
      baixas: r.baixas.map((a) => ({ ticker: a.ticker, variacao: a.variacaoDia })),
    };
  }, [porClasse.acoesUS]);

  // === Análise completa (inclui ativos fora do top 15 para alertas de venda) ===
  const analiseCompleta = useMemo(() => ({
    acoesBR: rankearPorScore(porClasse.acoesBR, "acoesBR", { top: 999 }),
    fiis:    rankearPorScore(porClasse.fiis,    "fiis",    { top: 999 }),
    acoesUS: rankearPorScore(porClasse.acoesUS, "acoesUS", { top: 999 }),
    reits:   rankearPorScore(porClasse.reits,   "reits",   { top: 999 }),
  }), [porClasse]);

  // === Alertas consolidados — inclui compra (top 15) + venda (universo todo) ===
  const alertas = useMemo(() => {
    const out = [];
    [["acoesBR", top.acoesBR], ["fiis", top.fiis], ["acoesUS", top.acoesUS], ["reits", top.reits]].forEach(([id, lista]) => {
      lista.forEach((a) => {
        (a.analise?.alertas || []).forEach((al) =>
          out.push({ ticker: a.ticker, classe: id, tipo: al.tipo, msg: al.msg, ativo: a })
        );
        if (a.analise?.momentoCompra) {
          out.push({ ticker: a.ticker, classe: id, tipo: "info", msg: "Momento de compra identificado", ativo: a });
        }
      });
    });
    [["acoesBR", analiseCompleta.acoesBR], ["fiis", analiseCompleta.fiis],
     ["acoesUS", analiseCompleta.acoesUS], ["reits", analiseCompleta.reits]].forEach(([id, lista]) => {
      lista.forEach((a) => {
        if (a.analise?.sinalVenda) {
          const primeiraRazao = a.analise.criticasVenda?.[0] || "Score abaixo do mínimo aceitável";
          out.push({ ticker: a.ticker, classe: id, tipo: "venda", msg: primeiraRazao, ativo: a });
        }
      });
    });
    return out;
  }, [top, analiseCompleta]);

  const abrirAtivo = (classe) => (ativo) => setModal({ ativo, classe });
  const abrirResumo = (ativo, classe) => setModal({ ativo, classe });

  const horaStr = atualizadoEm?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dataStr = atualizadoEm?.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  const listaAtiva = top[tab] || [];
  const moedaAtiva = CLASSES_TABS.find((c) => c.id === tab)?.moeda || "BRL";
  const temDados = brutos.br.length > 0 || brutos.us.length > 0;

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar
        mode={isCliente ? "cliente" : "admin"}
        clienteId={isCliente ? profile?.clienteId : null}
        clienteNome={isCliente ? profile?.nome : null}
      />
      <Navbar showLogout={true} />

      <div className="dashboard-content with-sidebar mercado-wrapper">

        {/* ─── Top bar admin: timestamp + botão atualizar (só master) ─── */}
        <div className="m-admin-bar">
          <div className="m-admin-bar-inner">
            <div className="m-admin-bar-info">
              {atualizadoEm ? (
                <>
                  <span className="ts-dot" />
                  <span>Análise atualizada em <b>{horaStr}</b> · {dataStr}</span>
                  {atualizadoPor?.email && <span className="m-admin-by"> · por {atualizadoPor.email}</span>}
                </>
              ) : loading ? (
                <span>Carregando snapshot…</span>
              ) : (
                <span>Nenhum snapshot disponível</span>
              )}
            </div>
            {isMaster && (
              <button
                className="btn-atualizar small"
                onClick={atualizar}
                disabled={atualizando}
                title="Buscar dados das APIs e salvar no banco"
              >
                {atualizando
                  ? (<><span className="btn-spinner" /> Atualizando…</>)
                  : (<>↻ Atualizar dados</>)}
              </button>
            )}
          </div>
          {erro && <div className="m-admin-bar-erro">{erro}</div>}
          {!temDados && !loading && !isMaster && (
            <div className="m-admin-bar-erro">
              O administrador ainda não publicou uma análise. Peça para o master clicar em "Atualizar dados".
            </div>
          )}
        </div>

        {/* Faixa de cotações (Dólar, Selic, IPCA, Ibov, S&P 500) */}
        <div style={{ maxWidth: 1280, margin: "8px auto 0", padding: "0 20px", width: "100%" }}>
          <MarketBar compact />
        </div>

        {/* ═════ SECTION 1 — RESUMO DO DIA (briefing executivo) ═════ */}
        <ResumoDoDia
          analiseCompleta={analiseCompleta}
          tickersCliente={tickersCliente}
          onAbrir={abrirResumo}
          atualizadoEm={atualizadoEm}
          loading={loading}
        />

        {/* ═════ SECTION 2 — ALTAS / BAIXAS BR + US ═════ */}
        <section className="m-section m-altas">
          <div className="m-section-head">
            <div className="m-section-eyebrow">RANKING DIÁRIO · PERFORMANCE</div>
            <h2 className="m-section-titulo">Maiores movimentos do mercado</h2>
            <p className="m-section-sub">
              Top 10 altas e baixas em ações brasileiras (IBOV) e americanas (S&amp;P 500 · NYSE / NASDAQ), variação do último pregão.
            </p>
          </div>

          <div className="m-altas-grid">
            <MaioresAltasWidget
              subtitulo="ANÁLISE DE MERCADO · IBOVESPA · B3"
              titulo="MAIORES ALTAS E BAIXAS (IBOV) DIA"
              ancoras={{ esq: "10 MAIORES ALTAS", dir: "10 MAIORES BAIXAS" }}
              altas={rankingBR.altas}
              baixas={rankingBR.baixas}
              rodape="PORTO INVEST · Não constitui recomendação de investimento (CVM 20)"
              rodapeRight="IBOVESPA · B3"
            />
            <MaioresAltasWidget
              subtitulo="MARKET ANALYSIS · S&P 500 · NYSE/NASDAQ"
              titulo="MAIORES ALTAS E BAIXAS (USA) DIA"
              ancoras={{ esq: "10 TOP GAINERS", dir: "10 TOP LOSERS" }}
              altas={rankingUS.altas}
              baixas={rankingUS.baixas}
              rodape="PORTO INVEST · Not an investment recommendation"
              rodapeRight="USA · NYSE / NASDAQ"
            />
          </div>
        </section>

        {/* ═════ SECTION 3 — S&P 500 ETF (SPY) ═════ */}
        <section className="m-section m-spx">
          <div className="m-section-head">
            <div className="m-section-eyebrow">ETF S&amp;P 500 · SPY · TRADINGVIEW</div>
            <h2 className="m-section-titulo">Análise técnica ao vivo</h2>
            <p className="m-section-sub">
              Gráfico profissional com RSI, médias móveis e ferramentas de desenho.
            </p>
          </div>
          <div className="m-spx-card">
            <TradingViewWidget symbol="AMEX:SPY" altura={680} />
          </div>
        </section>

        {/* ═════ SECTION 4 — 4 RANQUEAMENTOS EM TABS ═════ */}
        <section className="m-section m-blocos">
          <div className="m-section-head">
            <div className="m-section-eyebrow">RANKING MULTI-GURU · TOP 15</div>
            <h2 className="m-section-titulo">Oportunidades por classe de ativo</h2>
            <p className="m-section-sub">
              Graham, Buffett, Lynch, Bazin, Barsi, Greenblatt e Bastter traduzidos em pontos: valor, qualidade,
              dividendos, crescimento e momentum.
            </p>
          </div>

          <div className="m-blocos-col">
            <div className="m-tabs">
              {CLASSES_TABS.map((c) => (
                <button
                  key={c.id}
                  className={`m-tab ${tab === c.id ? "active" : ""}`}
                  onClick={() => setTab(c.id)}
                >
                  <span className="m-tab-label">{c.label}</span>
                  <span className="m-tab-badge">{c.badge}</span>
                </button>
              ))}
            </div>

            {loading ? (
              <div className="bloco-skeleton">
                <div className="sk-bar short" />
                <div className="sk-bar wide" />
                <div className="sk-bar mid" />
                <div className="sk-bar wide" />
                <div className="sk-bar mid" />
                <div className="sk-bar wide" />
              </div>
            ) : (
              <TabelaAtivos
                titulo={`Top 15 — ${CLASSES_TABS.find((c) => c.id === tab)?.label}`}
                moeda={moedaAtiva}
                ativos={listaAtiva}
                classe={tab}
                onAbrir={abrirAtivo(tab)}
              />
            )}
          </div>
        </section>

        {/* ═════ SECTION 5 — PONTOS DE ATENÇÃO ═════ */}
        <section className="m-section m-alertas-section">
          <div className="m-section-head">
            <div className="m-section-eyebrow">ALERTAS CRÍTICOS · RISCOS · SINAIS</div>
            <h2 className="m-section-titulo">Pontos de Atenção</h2>
            <p className="m-section-sub">
              Alertas agregados da análise quantitativa de todas as 60 posições monitoradas.
            </p>
          </div>

          <div className="m-alertas-wrapper">
            <PontosAtencao
              alertas={alertas}
              onAbrir={(ativo) => ativo && setModal({ ativo, classe: detectarClasse(ativo, top) })}
            />
          </div>
        </section>

        {/* ═════ SECTION 6 — DISCLAIMER ═════ */}
        <footer className="m-disclaimer-section">
          <div className="m-disclaimer">
            <strong>Disclaimer CVM 20/2021.</strong> Esta página apresenta análise automatizada elaborada a partir de dados
            públicos (brapi.dev, Stooq, Yahoo Finance, TradingView). Os scores refletem critérios quantitativos e
            <b> não constituem recomendação de investimento</b>, oferta, sugestão ou aconselhamento.
            Rentabilidade passada não garante rentabilidade futura. Investimentos envolvem riscos e podem resultar em
            perdas. Consulte seu assessor antes de operar.
          </div>
        </footer>
      </div>

      {modal && (
        <AtivoModal ativo={modal.ativo} classe={modal.classe} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function detectarClasse(ativo, top) {
  for (const classe of ["acoesBR", "fiis", "acoesUS", "reits"]) {
    if (top[classe].some((a) => a.ticker === ativo.ticker)) return classe;
  }
  return "acoesBR";
}
