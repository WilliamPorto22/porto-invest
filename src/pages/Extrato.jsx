import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { lerClienteComFallback, invalidarCacheCliente } from "../services/lerClienteFallback";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import HistoricoMensalChart from "../components/HistoricoMensalChart";
import { brl } from "../utils/currency";
import { stripUndefined, listarSnapshots } from "../services/snapshotsCarteira";

/**
 * Extrato do cliente — movimentações financeiras por mês
 *
 * Fontes:
 *  - cliente.movimentacoesExtrato (novo) — populado pelo fluxo de snapshot mensal
 *    (aportes, retiradas, dividendos, juros, amortização, compras, vendas, reforços, taxas)
 *  - Aportes legados (c.aportes / c.aporteRegistradoMes / lastAporteDate)
 *  - Retiradas / dividendos legados (c.retiradas / c.dividendos)
 *
 * Layout inspirado em extratos bancários premium: resumo + timeline por mês.
 */

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function mesLabel(date) {
  return `${MESES_PT[date.getMonth()]} / ${date.getFullYear()}`;
}

function parseData(v) {
  if (!v) return null;
  try {
    if (v.toDate) return v.toDate();
    if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) {
      const [y, m] = v.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  } catch {/* data inválida */}
  return null;
}

function parseCentavos(v) {
  if (typeof v === "number") {
    // heurística: valor em reais vira centavos; valor já em centavos fica como está
    // Mantemos comportamento original: assumimos que number é reais
    return v;
  }
  return parseInt(String(v || "0").replace(/\D/g, "")) / 100;
}

function parseValorReais(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Mapeia os tipos vindos do snapshot/diff para os tipos visuais do extrato
const TIPO_MAP = {
  aporte: "aporte",
  retirada: "retirada",
  // "resgate" sozinho não vira retirada — pode ser vencimento de título
  resgate: "vencimento",
  vencimento: "vencimento",
  dividendo: "dividendo",
  rendimento: "dividendo",
  juros: "juros",
  amortizacao: "amortizacao",
  compra: "compra",
  venda: "venda",
  reforco: "reforco",
  taxa: "taxa",
};

const CATEGORIA_DE = {
  aporte: "entrada",
  retirada: "saida",
  dividendo: "rendimento",
  juros: "rendimento",
  amortizacao: "rendimento",
  compra: "movimento",
  venda: "movimento",
  reforco: "movimento",
  taxa: "saida",
  vencimento: "movimento", // neutro — capital volta internamente, não é saída
};

function rotuloTipo(tipo) {
  return {
    aporte: "Aporte",
    retirada: "Retirada",
    dividendo: "Dividendo",
    juros: "Juros",
    amortizacao: "Amortização",
    compra: "Compra",
    venda: "Venda",
    reforco: "Reforço",
    taxa: "Taxa",
    vencimento: "Vencimento",
  }[tipo] || tipo;
}

/**
 * Monta lista de movimentações a partir do que já temos no cliente.
 * Quando não houver dados, gera 0 movimentações (tela com estado vazio amigável).
 */
function extrairMovimentacoes(cliente) {
  if (!cliente) return [];
  const movs = [];
  const chavesExtrato = new Set();

  // Fonte PRINCIPAL: movimentacoesExtrato[] populado pelo snapshot mensal
  if (Array.isArray(cliente.movimentacoesExtrato)) {
    cliente.movimentacoesExtrato.forEach((m, i) => {
      const tipoRaw = String(m.tipo || "").toLowerCase();
      const tipo = TIPO_MAP[tipoRaw] || null;
      if (!tipo) return;
      const d = parseData(m.data) || parseData(m.mesRef);
      const valor = Math.abs(parseValorReais(m.valor));
      if (!d || valor === 0) return;
      const descricao = m.descricao
        || m.ativo
        || (m.classe ? `${rotuloTipo(tipo)} · ${m.classe}` : rotuloTipo(tipo));
      const origemTxt = m.origem || (m.mesRef ? `Snapshot ${m.mesRef}` : "Extrato XP");
      const chave = `${tipo}-${d.toISOString().slice(0, 10)}-${descricao}-${valor.toFixed(2)}`;
      chavesExtrato.add(chave);
      movs.push({
        id: `ext-${i}-${chave}`,
        tipo,
        data: d,
        valor,
        descricao,
        origem: origemTxt,
        classeCor: m.classeCor,
        ativo: m.ativo,
        fonte: "movimentacoesExtrato",
        indiceOriginal: i,
      });
    });
  }

  // Aporte do mês atual — só se o detalhado (aportes[]) não cobrir este lançamento.
  // Legacy: clientes antigos que só tem aporteRegistradoMes (sem push em aportes[]).
  const valorAporteMes = parseCentavos(cliente.aporteRegistradoMes);
  const dataAporte = parseData(cliente.lastAporteDate);
  const jaTemNoDetalhado = Array.isArray(cliente.aportes)
    && cliente.aportes.some(a => parseCentavos(a.valor) > 0);
  if (valorAporteMes > 0 && dataAporte && !jaTemNoDetalhado) {
    const chave = `aporte-${dataAporte.toISOString().slice(0, 10)}-Aporte mensal-${valorAporteMes.toFixed(2)}`;
    if (!chavesExtrato.has(chave)) {
      movs.push({
        id: `aporte-${dataAporte.getTime()}`,
        tipo: "aporte",
        data: dataAporte,
        valor: valorAporteMes,
        descricao: "Aporte mensal",
        origem: "Registrado no painel",
        fonte: "aporteRegistradoMes",
      });
    }
  }

  // Histórico em cliente.aportes[] (se existir)
  if (Array.isArray(cliente.aportes)) {
    cliente.aportes.forEach((a, i) => {
      const d = parseData(a.data);
      const v = parseCentavos(a.valor);
      if (v > 0 && d) {
        const partes = [];
        if (a.classeLabel) partes.push(a.classeLabel);
        if (a.ativo) partes.push(a.ativo);
        const desc = partes.length
          ? `Aporte · ${partes.join(" → ")}`
          : (a.descricao || "Aporte");
        const saldo = parseCentavos(a.saldoRemanescente);
        const origem = saldo > 0
          ? `${a.origem || "Painel"} · R$ ${saldo.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})} em caixa`
          : (a.origem || "Histórico");
        movs.push({
          id: `aporte-hist-${i}-${d.getTime()}`,
          tipo: "aporte",
          data: d,
          valor: v,
          descricao: desc,
          origem,
          classeCor: a.classeCor,
          fonte: "aportes",
          indiceOriginal: i,
        });
      }
    });
  }

  // Retiradas (se registradas)
  if (Array.isArray(cliente.retiradas)) {
    cliente.retiradas.forEach((r, i) => {
      const d = parseData(r.data);
      const v = parseCentavos(r.valor);
      if (v > 0 && d) {
        movs.push({
          id: `ret-${i}-${d.getTime()}`,
          tipo: "retirada",
          data: d,
          valor: v,
          descricao: r.descricao || "Retirada",
          origem: r.origem || "Histórico",
          fonte: "retiradas",
          indiceOriginal: i,
        });
      }
    });
  }

  // Dividendos (podem vir do PDF mensal; por ora lemos cliente.dividendos[])
  if (Array.isArray(cliente.dividendos)) {
    cliente.dividendos.forEach((dv, i) => {
      const d = parseData(dv.data);
      const v = parseCentavos(dv.valor);
      if (v > 0 && d) {
        movs.push({
          id: `div-${i}-${d.getTime()}`,
          tipo: "dividendo",
          data: d,
          valor: v,
          descricao: dv.ativo || dv.descricao || "Dividendo",
          origem: dv.origem || "Extrato XP",
          fonte: "dividendos",
          indiceOriginal: i,
        });
      }
    });
  }

  movs.sort((a, b) => b.data - a.data);
  return movs;
}

function agruparPorMes(movs) {
  const map = new Map();
  movs.forEach((m) => {
    const key = `${m.data.getFullYear()}-${String(m.data.getMonth()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, { key, date: m.data, movs: [] });
    map.get(key).movs.push(m);
  });
  return Array.from(map.values()).sort((a, b) => b.date - a.date);
}

const ICO = {
  aporte: "↑",
  retirada: "↓",
  dividendo: "◈",
  juros: "◆",
  amortizacao: "⇢",
  compra: "＋",
  venda: "－",
  reforco: "↗",
  taxa: "⊗",
  vencimento: "◐",
};

export default function Extrato() {
  const { id } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  // aporte | retirada | dividendo | juros | amortizacao | compra | venda | reforco | taxa | rendimento (agrupa dividendo+juros+amortizacao) | movimento (compra+venda+reforco)
  const tipoFiltro = searchParams.get("tipo");
  const viewHistorico = searchParams.get("view") === "historico";

  const [cliente, setCliente] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [mesSelecionado, setMesSelecionado] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null); // { titulo, descricao, onConfirm }
  const [snapshotsCarteira, setSnapshotsCarteira] = useState([]);

  useEffect(() => {
    let vivo = true;
    async function carregar() {
      try {
        const r = await lerClienteComFallback(id, { isAlive: () => vivo });
        if (vivo && r.exists && r.data) setCliente({ id, ...r.data });
      } catch (e) {
        console.error("Erro ao carregar cliente:", e);
      } finally {
        if (vivo) setCarregando(false);
      }
    }
    carregar();
    // Carrega snapshots da carteira (fonte LIMPA pra patrimônio mês a mês,
    // diferente de movimentacoesExtrato que tem dados parseados sujos).
    listarSnapshots(id)
      .then((lista) => { if (vivo) setSnapshotsCarteira(lista || []); })
      .catch((e) => console.warn("[Extrato] Falha ao listar snapshots:", e?.code));
    return () => { vivo = false; };
  }, [id]);

  const movimentacoes = useMemo(() => extrairMovimentacoes(cliente), [cliente]);
  const grupos = useMemo(() => agruparPorMes(movimentacoes), [movimentacoes]);

  // Série mensal pro chart de evolução — usa SNAPSHOTS (dados limpos do PDF
  // mensal salvo) ao invés das movimentacoes (que podem vir sujas do parser).
  // Mostra patrimônio total oscilando + rendimentos do mês como badge.
  const serieMensal = useMemo(() => {
    if (!Array.isArray(snapshotsCarteira) || snapshotsCarteira.length === 0) return [];
    return snapshotsCarteira.map((s) => {
      const r = s.resumoMes || {};
      const rendimentos =
        (Number(r.juros) || 0) +
        (Number(r.dividendos) || 0) +
        (Number(r.amortizacao) || 0);
      return {
        mesRef: s.mesRef,
        valor: Number(s.patrimonioTotal) || 0,
        rentMes: s.rentMes,
        aporte: Number(r.aportes) || 0,
        rendimentos,
        meta: { snapshot: s, groupKey: s.mesRef },
      };
    });
  }, [snapshotsCarteira]);

  // Persiste alterações em movimentacoesExtrato/aportes/retiradas/dividendos.
  // Usa cliente atual como base e aplica patch — sem refetch (otimista).
  async function persistirCliente(patchParcial) {
    if (!cliente?.id) return;
    setSalvando(true);
    try {
      await setDoc(doc(db, "clientes", cliente.id), stripUndefined(patchParcial), { merge: true });
      invalidarCacheCliente(cliente.id);
      setCliente((c) => ({ ...c, ...patchParcial }));
    } catch (e) {
      console.error("Erro ao salvar:", e);
      alert("Erro ao salvar: " + (e?.message || "tente novamente"));
    } finally {
      setSalvando(false);
    }
  }

  // Remove uma única movimentação do array correto baseado em fonte+índice.
  function removerMovimentacao(mov) {
    const fonte = mov.fonte;
    const idx = mov.indiceOriginal;
    if (fonte === "movimentacoesExtrato") {
      const arr = Array.isArray(cliente?.movimentacoesExtrato) ? [...cliente.movimentacoesExtrato] : [];
      arr.splice(idx, 1);
      return persistirCliente({ movimentacoesExtrato: arr });
    }
    if (fonte === "aportes") {
      const arr = Array.isArray(cliente?.aportes) ? [...cliente.aportes] : [];
      arr.splice(idx, 1);
      return persistirCliente({ aportes: arr });
    }
    if (fonte === "retiradas") {
      const arr = Array.isArray(cliente?.retiradas) ? [...cliente.retiradas] : [];
      arr.splice(idx, 1);
      return persistirCliente({ retiradas: arr });
    }
    if (fonte === "dividendos") {
      const arr = Array.isArray(cliente?.dividendos) ? [...cliente.dividendos] : [];
      arr.splice(idx, 1);
      return persistirCliente({ dividendos: arr });
    }
    if (fonte === "aporteRegistradoMes") {
      return persistirCliente({ aporteRegistradoMes: "0", lastAporteDate: null });
    }
  }

  // Limpa TODAS as movimentações do mês indicado (YYYY-MM) das 4 fontes.
  // Útil quando re-importar empilhou dados duplicados/errados.
  function limparMes(mesKey) {
    if (!cliente) return;
    const [yStr, mStr] = mesKey.split("-");
    const ano = parseInt(yStr);
    const mes = parseInt(mStr); // mes é 0-based no key (vem de getMonth())
    const noMes = (m) => {
      const d = parseData(m.data) || parseData(m.mesRef);
      if (!d) return false;
      return d.getFullYear() === ano && d.getMonth() === mes;
    };
    const patch = {};
    if (Array.isArray(cliente.movimentacoesExtrato)) {
      patch.movimentacoesExtrato = cliente.movimentacoesExtrato.filter((m) => !noMes(m));
    }
    if (Array.isArray(cliente.aportes)) {
      patch.aportes = cliente.aportes.filter((m) => !noMes(m));
    }
    if (Array.isArray(cliente.retiradas)) {
      patch.retiradas = cliente.retiradas.filter((m) => !noMes(m));
    }
    if (Array.isArray(cliente.dividendos)) {
      patch.dividendos = cliente.dividendos.filter((m) => !noMes(m));
    }
    return persistirCliente(patch);
  }

  // Limpa todo o histórico — usado quando o usuário quer reimportar do zero.
  function limparTudo() {
    return persistirCliente({
      movimentacoesExtrato: [],
      aportes: [],
      retiradas: [],
      dividendos: [],
      aporteRegistradoMes: "0",
      lastAporteDate: null,
    });
  }

  // Pré-seleciona o primeiro mês disponível
  useEffect(() => {
    if (!mesSelecionado && grupos.length > 0) {
      setMesSelecionado(grupos[0].key);
    }
  }, [grupos, mesSelecionado]);

  // Mês atual forçado caso nenhum grupo exista
  const mesAtual = useMemo(() => {
    const d = new Date();
    return { date: d, label: mesLabel(d), key: `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}` };
  }, []);

  const grupoAtivo = grupos.find((g) => g.key === mesSelecionado) || null;

  // Filtra pelas querystrings (suporta filtros agrupados: rendimento / movimento)
  const movimentacoesVisiveis = useMemo(() => {
    let lista = viewHistorico ? movimentacoes : (grupoAtivo?.movs || []);
    if (tipoFiltro) {
      lista = lista.filter((m) => {
        if (tipoFiltro === "rendimento") return CATEGORIA_DE[m.tipo] === "rendimento";
        if (tipoFiltro === "movimento") return CATEGORIA_DE[m.tipo] === "movimento";
        return m.tipo === tipoFiltro;
      });
    }
    return lista;
  }, [movimentacoes, grupoAtivo, viewHistorico, tipoFiltro]);

  // Resumo (do conjunto visível — mês corrente ou histórico)
  const resumo = useMemo(() => {
    const base = viewHistorico ? movimentacoes : (grupoAtivo?.movs || []);
    const soma = (tipo) => base.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.valor, 0);
    const aportes = soma("aporte");
    const retiradas = soma("retirada");
    const dividendos = soma("dividendo");
    const juros = soma("juros");
    const amortizacao = soma("amortizacao");
    const compras = soma("compra");
    const vendas = soma("venda");
    const reforcos = soma("reforco");
    const taxas = soma("taxa");
    const rendimentos = dividendos + juros + amortizacao;
    return {
      aportes,
      retiradas,
      dividendos,
      juros,
      amortizacao,
      rendimentos,
      compras,
      vendas,
      reforcos,
      taxas,
      // saldo líquido: o que entrou - o que saiu (sem considerar compra/venda internas que não mudam patrimônio)
      liquido: aportes - retiradas + rendimentos - taxas,
    };
  }, [grupoAtivo, movimentacoes, viewHistorico]);

  if (carregando) {
    return (
      <div className="dashboard-container has-sidebar">
        <Sidebar mode="cliente" clienteId={id} clienteNome="" />
        <Navbar showLogout={true} />
        <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>
          <div style={{ padding: 40, color: "#94A7BF", textAlign: "center" }}>
            Carregando extrato…
          </div>
        </div>
      </div>
    );
  }

  const tituloFiltro =
    tipoFiltro === "aporte" ? " · Apenas aportes" :
    tipoFiltro === "retirada" ? " · Apenas retiradas" :
    tipoFiltro === "dividendo" ? " · Apenas dividendos" :
    tipoFiltro === "juros" ? " · Apenas juros" :
    tipoFiltro === "amortizacao" ? " · Apenas amortização" :
    tipoFiltro === "rendimento" ? " · Apenas rendimentos" :
    tipoFiltro === "compra" ? " · Apenas compras" :
    tipoFiltro === "venda" ? " · Apenas vendas" :
    tipoFiltro === "reforco" ? " · Apenas reforços" :
    tipoFiltro === "movimento" ? " · Apenas movimentações de carteira" :
    tipoFiltro === "taxa" ? " · Apenas taxas" : "";

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode="cliente" clienteId={id} clienteNome={cliente?.nome || ""} />
      <Navbar
        showLogout={true}
        actionButtons={[
          {
            icon: "←",
            label: "Voltar",
            variant: "secondary",
            onClick: () => nav(`/cliente/${id}`),
            title: "Voltar para a ficha",
          },
        ]}
      />

      <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>
        <div className="extrato-page">

          {/* HERO */}
          <div className="extrato-hero">
            <div className="extrato-hero-label">Extrato · {cliente?.nome || "Cliente"}</div>
            <div className="extrato-hero-title">
              {viewHistorico ? "Histórico Completo" : (grupoAtivo?.date ? mesLabel(grupoAtivo.date) : mesAtual.label)}
              {tituloFiltro}
            </div>
            <div className="extrato-hero-sub">
              Movimentações consolidadas — aportes, retiradas e dividendos recebidos.
            </div>

            <div className="extrato-actions">
              <button
                className="extrato-btn"
                onClick={() => nav(`/cliente/${id}/carteira?importar=1`)}
                title="Importar extrato mensal em PDF pela Carteira"
              >
                ⬆ Importar PDF do mês
              </button>
              <button
                className="extrato-btn secondary"
                onClick={() => nav(`/cliente/${id}/extrato?view=historico`)}
              >
                Histórico completo
              </button>
              <button
                className="extrato-btn secondary"
                onClick={() => nav(`/cliente/${id}/carteira`)}
              >
                Ver carteira
              </button>
              {viewHistorico && movimentacoes.length > 0 && (
                <button
                  className="extrato-btn secondary"
                  style={{ borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }}
                  disabled={salvando}
                  onClick={() => setConfirmacao({
                    titulo: "Limpar TODO o histórico do extrato?",
                    descricao: `Apaga ${movimentacoes.length} movimentações de todas as fontes (extrato XP, aportes, retiradas, dividendos). Os snapshots da Carteira NÃO são afetados — você pode re-importar os PDFs depois.`,
                    onConfirm: limparTudo,
                  })}
                >
                  🗑 Limpar histórico
                </button>
              )}
            </div>
          </div>

          {/* RESUMO */}
          <div className="extrato-resumo">
            <div className="extrato-resumo-card">
              <div className="extrato-resumo-label">Aportes</div>
              <div className="extrato-resumo-value pos">{brl(resumo.aportes)}</div>
            </div>
            <div className="extrato-resumo-card">
              <div className="extrato-resumo-label">Retiradas</div>
              <div className="extrato-resumo-value neg">{brl(resumo.retiradas)}</div>
            </div>
            <div className="extrato-resumo-card">
              <div className="extrato-resumo-label">Rendimentos</div>
              <div className="extrato-resumo-value gold">{brl(resumo.rendimentos)}</div>
              {(resumo.juros > 0 || resumo.amortizacao > 0) && (
                <div style={{ fontSize: 10, color: "#94A7BF", marginTop: 4, lineHeight: 1.4 }}>
                  {resumo.dividendos > 0 && <>Div. {brl(resumo.dividendos)}<br/></>}
                  {resumo.juros > 0 && <>Juros {brl(resumo.juros)}<br/></>}
                  {resumo.amortizacao > 0 && <>Amort. {brl(resumo.amortizacao)}</>}
                </div>
              )}
            </div>
            <div className="extrato-resumo-card">
              <div className="extrato-resumo-label">Saldo líquido</div>
              <div className={`extrato-resumo-value ${resumo.liquido >= 0 ? "pos" : "neg"}`}>
                {brl(resumo.liquido)}
              </div>
            </div>
            {(resumo.compras > 0 || resumo.vendas > 0 || resumo.reforcos > 0) && (
              <div className="extrato-resumo-card">
                <div className="extrato-resumo-label">Movimentação de carteira</div>
                <div style={{ fontSize: 12, color: "#F0EBD8", lineHeight: 1.5, marginTop: 4 }}>
                  {resumo.compras > 0 && <>Compras {brl(resumo.compras)}<br/></>}
                  {resumo.vendas > 0 && <>Vendas {brl(resumo.vendas)}<br/></>}
                  {resumo.reforcos > 0 && <>Reforços {brl(resumo.reforcos)}</>}
                </div>
              </div>
            )}
          </div>

          {/* GRÁFICO DE EVOLUÇÃO MENSAL — patrimônio total + rendimentos */}
          {serieMensal.length >= 2 && (
            <HistoricoMensalChart
              items={serieMensal}
              onSelect={(it) => {
                // mesRef do snapshot está em formato YYYY-MM; o groupKey usado
                // pelas tabs do Extrato é YYYY-MM (com mês 0-based no getMonth())
                const [y, m] = String(it.mesRef).split("-");
                const groupKey = `${y}-${String(parseInt(m) - 1).padStart(2, "0")}`;
                if (viewHistorico) {
                  setMesSelecionado(groupKey);
                  nav(`/cliente/${id}/extrato`);
                } else {
                  setMesSelecionado(groupKey);
                  document.querySelector(".extrato-timeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
              descricao="Patrimônio total mês a mês — fonte: snapshots da Carteira (dados limpos do PDF mensal). Pílula verde = rendimentos do mês (juros + dividendos + amortização). Roxa = aporte do mês."
              destacarUltimo={!viewHistorico}
            />
          )}

          {/* TABS DE MÊS (só quando não está em modo histórico) */}
          {!viewHistorico && grupos.length > 0 && (
            <div className="extrato-mes-tabs" style={{ alignItems: "center" }}>
              {grupos.map((g) => (
                <button
                  key={g.key}
                  className={`extrato-mes-tab ${g.key === mesSelecionado ? "active" : ""}`}
                  onClick={() => setMesSelecionado(g.key)}
                >
                  {mesLabel(g.date)}
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>· {g.movs.length}</span>
                </button>
              ))}
              {grupoAtivo && grupoAtivo.movs.length > 0 && (
                <button
                  className="extrato-mes-tab"
                  disabled={salvando}
                  style={{
                    marginLeft: 8,
                    background: "rgba(239,68,68,0.06)",
                    border: "0.5px solid rgba(239,68,68,0.35)",
                    color: "#fca5a5",
                  }}
                  title={`Apaga as ${grupoAtivo.movs.length} movimentações de ${mesLabel(grupoAtivo.date)} (4 fontes)`}
                  onClick={() => setConfirmacao({
                    titulo: `Limpar movimentações de ${mesLabel(grupoAtivo.date)}?`,
                    descricao: `Apaga ${grupoAtivo.movs.length} lançamentos do mês (extrato XP, aportes, retiradas, dividendos). O snapshot da Carteira deste mês NÃO é afetado.`,
                    onConfirm: () => limparMes(grupoAtivo.key),
                  })}
                >
                  🗑 Limpar mês
                </button>
              )}
            </div>
          )}

          {/* TIMELINE */}
          {movimentacoesVisiveis.length === 0 ? (
            <div className="extrato-empty">
              <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.6 }}>📄</div>
              <div style={{ fontSize: 14, color: "#F0EBD8", marginBottom: 6 }}>
                Sem movimentações registradas {viewHistorico ? "no histórico" : "neste mês"}
              </div>
              <div style={{ fontSize: 12, color: "#94A7BF", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
                Assim que você importar o PDF mensal ou registrar aportes no painel do cliente,
                as movimentações aparecerão aqui — separadas por mês, por tipo e com o saldo líquido do período.
              </div>
            </div>
          ) : (
            <div className="extrato-timeline">
              {movimentacoesVisiveis.map((m) => {
                const categoria = CATEGORIA_DE[m.tipo];
                const sinal = categoria === "saida" || m.tipo === "venda"
                  ? "- "
                  : categoria === "movimento"
                    ? ""
                    : "+ ";
                return (
                  <div key={m.id} className={`extrato-row ${m.tipo}`} style={{ position: "relative" }}>
                    <div className="extrato-row-ico">{ICO[m.tipo] || "•"}</div>
                    <div>
                      <div className="extrato-row-label">
                        {m.descricao}
                        <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(244,195,101,0.12)", color: "#F4C365", letterSpacing: 0.5, textTransform: "uppercase" }}>
                          {rotuloTipo(m.tipo)}
                        </span>
                      </div>
                      <div className="extrato-row-sub">
                        {m.data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                        {" · "}{m.origem}
                      </div>
                    </div>
                    <div className="extrato-row-value" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span>{sinal}{brl(m.valor)}</span>
                      <button
                        disabled={salvando}
                        title="Excluir esta movimentação"
                        onClick={() => setConfirmacao({
                          titulo: "Excluir esta movimentação?",
                          descricao: `${rotuloTipo(m.tipo)} · ${m.descricao} · ${brl(m.valor)} (${m.data.toLocaleDateString("pt-BR")})`,
                          onConfirm: () => removerMovimentacao(m),
                        })}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#94A7BF",
                          cursor: salvando ? "wait" : "pointer",
                          fontSize: 18,
                          padding: "2px 8px",
                          borderRadius: 4,
                          lineHeight: 1,
                          opacity: 0.55,
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#94A7BF"; e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.background = "transparent"; }}
                      >×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {confirmacao && (
        <div
          onClick={() => !salvando && setConfirmacao(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#0f1620",
              border: "0.5px solid rgba(239,68,68,0.4)",
              borderRadius: 12,
              padding: "24px 28px",
              maxWidth: 460, width: "100%",
              boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontSize: 16, color: "#F0EBD8", fontWeight: 500, marginBottom: 10 }}>
              {confirmacao.titulo}
            </div>
            <div style={{ fontSize: 13, color: "#94A7BF", lineHeight: 1.6, marginBottom: 22 }}>
              {confirmacao.descricao}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                disabled={salvando}
                onClick={() => setConfirmacao(null)}
                style={{
                  padding: "10px 18px", background: "transparent",
                  border: "0.5px solid rgba(255,255,255,0.15)", borderRadius: 8,
                  color: "#94A7BF", fontSize: 12, cursor: salvando ? "wait" : "pointer",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                }}
              >Cancelar</button>
              <button
                disabled={salvando}
                onClick={async () => {
                  const fn = confirmacao.onConfirm;
                  setConfirmacao(null);
                  await fn();
                }}
                style={{
                  padding: "10px 18px", background: "rgba(239,68,68,0.15)",
                  border: "0.5px solid rgba(239,68,68,0.5)", borderRadius: 8,
                  color: "#ef4444", fontSize: 12, cursor: salvando ? "wait" : "pointer",
                  letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
                }}
              >{salvando ? "Apagando..." : "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
