import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { doc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { db, auth, functions } from "../firebase";
import { lerClienteComFallback, invalidarCacheCliente } from "../services/lerClienteFallback";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../hooks/useAuth";
import { T, C } from "../theme";
// documentParser traz pdfjs + tesseract (~450KB). Carregado sob demanda no upload.
import { OBJETIVO_LABELS, garantirObjetivosVinculados } from "../utils/ativos";
import { AvatarIcon } from "./Dashboard";
import DonutChartModern from "../components/DonutChartModern";
import HistoricoMensalChart from "../components/HistoricoMensalChart";
import { gerarRelatorioSnapshot } from "../utils/relatorioSnapshot";
import { parseCentavos, brl, brlCompact } from "../utils/currency";
import {
  salvarSnapshotMensal,
  obterSnapshot,
  listarSnapshots,
  diffSnapshots,
  normalizarDadosParaSnapshot,
  aplicarRentNosObjetivos,
  mesclarMovimentacoes,
  mesAnterior,
  formatarMesRef,
  stripUndefined,
  isAporteSuspeito,
} from "../services/snapshotsCarteira";
import { deleteDoc } from "firebase/firestore";

// ══════════════════════════════════════════════════════════════
// UTIL
// ══════════════════════════════════════════════════════════════
const pct = (v, d = 1) => (parseFloat(v) || 0).toFixed(d) + "%";
const newId = () => Date.now() + "_" + Math.random().toString(36).slice(2, 7);
const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};
const noSel = { userSelect: "none", WebkitUserSelect: "none" };
const hojeBr = () => new Date().toLocaleDateString("pt-BR");
const mesAtualStr = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

// ══════════════════════════════════════════════════════════════
// SCHEMA: classes, objetivos, segmentos
// (mantém compat com ativos.js e Objetivos.jsx)
// ══════════════════════════════════════════════════════════════
const GRUPOS = [
  {
    key: "nacional",
    label: "Renda Fixa e Variável Nacional",
    icon: "🇧🇷",
    cor: "#F0A202",
    classes: [
      { key: "posFixado",  label: "Renda Fixa Pós-Fixada", cor: "#2563eb", liq: "D+1" },
      { key: "ipca",       label: "Renda Fixa IPCA+",       cor: "#3b82f6", liq: "D+1" },
      { key: "preFixado",  label: "Renda Fixa Pré-Fixada",  cor: "#60a5fa", liq: "D+1" },
      { key: "acoes",      label: "Ações",                   cor: "#22c55e", liq: "D+2", temSegmento: true },
      { key: "fiis",       label: "Fundos Imobiliários",     cor: "#f59e0b", liq: "D+2", temSegmento: true },
      { key: "multi",      label: "Multimercado",            cor: "#a07020", liq: "D+30" },
    ],
  },
  {
    key: "previdencia",
    label: "Previdência Privada",
    icon: "🛡",
    cor: "#d97706",
    classes: [
      { key: "prevVGBL", label: "Previdência VGBL", cor: "#f59e0b", liq: "—" },
      { key: "prevPGBL", label: "Previdência PGBL", cor: "#d97706", liq: "—" },
    ],
  },
  {
    key: "global",
    label: "Investimentos Globais",
    icon: "🌎",
    cor: "#a855f7",
    classes: [
      { key: "globalEquities", label: "Global – Equities (R.V.)",    cor: "#a855f7", liq: "D+2" },
      { key: "globalTreasury", label: "Global – Treasury",           cor: "#c084fc", liq: "D+2" },
      { key: "globalFunds",    label: "Global – Mutual Funds",       cor: "#7c3aed", liq: "D+2" },
      { key: "globalBonds",    label: "Global – Bonds",              cor: "#9333ea", liq: "D+2" },
      { key: "global",         label: "Invest. Globais (Geral)",      cor: "#a855f7", liq: "D+2", legado: true },
    ],
  },
  {
    key: "outros",
    label: "Outros / Não Classificado",
    icon: "📦",
    cor: "#94a3b8",
    classes: [
      { key: "outros", label: "Outros / Não Classificado", cor: "#94a3b8", liq: "—" },
    ],
  },
];
const CLASSES = GRUPOS.flatMap((g) => g.classes);
const classByKey = Object.fromEntries(CLASSES.map((c) => [c.key, c]));

// Lista canônica vem de utils/ativos.js — mantém em sync com Objetivos.jsx
// e com a criação automática de stubs (garantirObjetivosVinculados).
const OBJETIVOS = OBJETIVO_LABELS;

const SEGMENTOS = {
  acoes: [
    "Setor Bancário", "Setor de Energia", "Setor de Consumo", "Setor de Mineração",
    "Setor de Agronegócio", "Setor de Tecnologia", "Setor de Saúde",
    "Setor de Saneamento", "Setor de Construção", "Setor Industrial", "ETF", "Outros",
  ],
  fiis: [
    "Galpão Logístico", "Laje Corporativa", "Shoppings", "Residencial",
    "Papéis (CRI/CRA)", "Fundo de Fundos", "Híbrido", "Hotel/Hotelaria", "Educacional", "Outros",
  ],
};

// ══════════════════════════════════════════════════════════════
// INPUTS (memoizados para não re-renderizar a cada tecla)
// ══════════════════════════════════════════════════════════════
const InputMoeda = memo(function InputMoeda({ initValue, onCommit, placeholder = "R$ 0,00", size = "md" }) {
  const [raw, setRaw] = useState(initValue || "");
  const fmt = (r) => {
    const n = parseInt(String(r || "0").replace(/\D/g, "")) || 0;
    if (!n) return "";
    return "R$ " + (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  };
  return (
    <input
      style={{
        ...C.input,
        fontSize: size === "sm" ? 12 : size === "lg" ? 16 : 13,
        padding: size === "sm" ? "10px 12px" : "12px 14px",
      }}
      placeholder={placeholder}
      value={fmt(raw)}
      onChange={(e) => {
        const novo = e.target.value.replace(/\D/g, "");
        setRaw(novo);
        onCommit(novo);
      }}
    />
  );
});

const InputTexto = memo(function InputTexto({ initValue, onCommit, placeholder = "", size = "md" }) {
  const [val, setVal] = useState(initValue || "");
  return (
    <input
      style={{
        ...C.input,
        fontSize: size === "sm" ? 12 : 13,
        padding: size === "sm" ? "10px 12px" : "12px 14px",
      }}
      placeholder={placeholder}
      value={val}
      onChange={(e) => { setVal(e.target.value); onCommit(e.target.value); }}
    />
  );
});

const InputPct = memo(function InputPct({ initValue, onCommit, placeholder = "0,00%" }) {
  const [val, setVal] = useState(initValue || "");
  return (
    <input
      style={{ ...C.input, fontSize: 12, padding: "10px 12px" }}
      placeholder={placeholder}
      value={val}
      onChange={(e) => { setVal(e.target.value); onCommit(e.target.value); }}
    />
  );
});

const InputDate = memo(function InputDate({ initValue, onCommit }) {
  const [val, setVal] = useState(initValue || "");
  return (
    <input
      type="date"
      style={{ ...C.input, fontSize: 12, padding: "10px 12px", colorScheme: "dark" }}
      value={val}
      onChange={(e) => { setVal(e.target.value); onCommit(e.target.value); }}
    />
  );
});

function Select({ value, onChange, options, placeholder = "—" }) {
  const optStyle = { background: T.bgCard, color: T.textPrimary };
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        background: "rgba(255,255,255,0.04)",
        border: `0.5px solid ${T.border}`,
        borderRadius: T.radiusSm,
        color: T.textPrimary,
        fontSize: 12,
        padding: "10px 12px",
        fontFamily: T.fontFamily,
        cursor: "pointer",
        outline: "none",
        appearance: "none",
        colorScheme: "dark",
      }}
    >
      <option value="" style={{ ...optStyle, color: T.textMuted }}>{placeholder}</option>
      {options.map((o) => (
        <option
          key={typeof o === "string" ? o : o.value}
          value={typeof o === "string" ? o : o.value}
          style={optStyle}
        >
          {typeof o === "string" ? o : o.label}
        </option>
      ))}
    </select>
  );
}

// (Antigo GraficoPizza removido — substituído por DonutChartModern em
// src/components/DonutChartModern.jsx, com hover 3D e animações.)

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
export default function Carteira() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isCliente, profile, user } = useAuth();

  // Cliente só pode ver a própria carteira — redireciona se URL for de outro id.
  useEffect(() => {
    if (isCliente && profile?.clienteId && id !== profile.clienteId) {
      navigate(`/cliente/${profile.clienteId}/carteira`, { replace: true });
    }
  }, [isCliente, profile?.clienteId, id, navigate]);

  const [clienteNome, setClienteNome] = useState("");
  const [clienteAvatar, setClienteAvatar] = useState("homem");
  const [reservaMeta, setReservaMeta] = useState(0);

  const formRef = useRef({});
  const [snap, setSnap] = useState({});
  const [carregou, setCarregou] = useState(false);
  const [erroCarregar, setErroCarregar] = useState(null); // código do erro Firestore
  const [retryKey, setRetryKey] = useState(0); // incrementar força nova tentativa
  const [salvando, setSalvando] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState(null);
  const [xpSummary, setXpSummary] = useState(null);
  // Extração finalizou — aguarda usuário confirmar mês antes de salvar
  const [importPend, setImportPend] = useState(null); // { dados, extractedAt, fonte, arquivoNome }
  const [importSalvando, setImportSalvando] = useState(false);

  // drill-down e editor
  const [classeAberta, setClasseAberta] = useState(null); // classKey
  const [ativoEditando, setAtivoEditando] = useState(null); // { classKey, idx } | "new-{classKey}"
  const [hoverFatia, setHoverFatia] = useState(null);

  // aporte rápido
  const [aporteModal, setAporteModal] = useState(false);

  // limpar carteira (apaga todos os ativos + zera totais)
  const [limparModal, setLimparModal] = useState(false);
  const [limparInput, setLimparInput] = useState("");
  const [limpando, setLimpando] = useState(false);

  // histórico mensal de snapshots
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotAberto, setSnapshotAberto] = useState(null); // {snapshot, mesRef}
  const [recarregarSnaps, setRecarregarSnaps] = useState(0);

  const fileInputRef = useRef(null);

  // ─── Carregar ───────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setCarregou(false);
    setErroCarregar(null);
    const cacheKey = `pi_carteira_${id}`;
    const tStart = performance.now();

    // 1) Hidratação INSTANTÂNEA do cache localStorage — render < 50ms se cache existe.
    //    Resolve a percepção de "demora um caralho pra carregar". O fetch real
    //    continua em paralelo abaixo e atualiza quando chegar.
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.data) {
          setClienteNome(cached.nome || "");
          setClienteAvatar(cached.avatar || "homem");
          setReservaMeta(cached.reservaMeta || 0);
          formRef.current = { ...cached.data };
          setSnap({ ...cached.data });
          setCarregou(true); // já mostra a UI; fetch fresh atualiza por baixo
          console.log(`[Carteira] hidratado do cache em ${(performance.now() - tStart).toFixed(0)}ms`);
        }
      }
    } catch { /* cache corrompido, segue fetch normal */ }

    // Failsafe: se em 12s a carteira não terminou de carregar, mostra erro
    // para o usuário não ficar olhando spinner pra sempre.
    const timeoutId = setTimeout(() => {
      if (!alive) return;
      console.error("[Carteira] Timeout 12s — abortando load");
      // Só mostra erro se ainda não temos cache renderizado
      if (!formRef.current || Object.keys(formRef.current).length === 0) {
        setErroCarregar("timeout");
      }
      setCarregou(true);
    }, 12000);

    async function carregar() {
      try {
        const result = await lerClienteComFallback(id, { isAlive: () => alive });
        if (!alive) return;
        if (!result.exists) { setCarregou(true); return; }
        if (result.source !== "direct") {
          console.info(`[Carteira] Dados carregados via ${result.source}`);
        }
        const data = result.data;
        setClienteNome(data.nome || "");
        setClienteAvatar(data.avatar || "homem");
        const cats = ["moradia","alimentacao","educacao","cartoes","carro","saude","lazer","assinaturas","seguros","outros"];
        const gastosFluxo = cats.reduce((acc, k) => acc + parseCentavos(data.fluxo?.[k]) / 100, 0);
        const gastosManual = parseCentavos(data.gastosMensaisManual) / 100;
        const gastos = gastosManual || gastosFluxo;
        setReservaMeta(gastos * 6);
        const carteira = data.carteira || {};

        // Renderiza imediatamente com os dados do cliente — snapshots buscados em paralelo
        formRef.current = { ...carteira };
        setSnap({ ...carteira });
        setCarregou(true);
        console.log(`[Carteira] fetch fresh OK em ${(performance.now() - tStart).toFixed(0)}ms via ${result.source}`);

        // Persiste no cache pra hidratação instantânea da próxima vez
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            data: carteira,
            nome: data.nome || "",
            avatar: data.avatar || "homem",
            reservaMeta: gastos * 6,
            ts: Date.now(),
          }));
        } catch { /* localStorage cheio, segue */ }

        // FALLBACK assíncrono (não bloqueia o render): se faltam rentMes/rentAno/rent12m
        // busca no último snapshot e persiste no doc do cliente.
        const faltaPercentuais = carteira.rentMes == null && carteira.rentAno == null && carteira.rent12m == null;
        if (faltaPercentuais) {
          (async () => {
            try {
              // Tenta direto; se falhar permission-denied, usa Cloud Function
              let snaps = [];
              try {
                snaps = await listarSnapshots(id, { limite: 1 });
              } catch (errSnap) {
                if (errSnap?.code === "permission-denied" || errSnap?.code === "unauthenticated") {
                  const callListar = httpsCallable(functions, "listarSnapshotsCliente", { timeout: 15000 });
                  const r = await callListar({ clienteId: id, limite: 1 });
                  snaps = r.data?.snapshots || [];
                } else {
                  throw errSnap;
                }
              }
              if (!alive || !snaps || snaps.length === 0) return;
              const ult = snaps[0];
              const patchCarteira = {};
              if (ult.rentMes != null)  patchCarteira.rentMes  = ult.rentMes;
              if (ult.rentAno != null)  patchCarteira.rentAno  = ult.rentAno;
              if (ult.rent12m != null)  patchCarteira.rent12m  = ult.rent12m;
              if (ult.ganhoMes != null) patchCarteira.ganhoMes = ult.ganhoMes;
              if (ult.ganhoAno != null) patchCarteira.ganhoAno = ult.ganhoAno;
              if (ult.ganho12m != null) patchCarteira.ganho12m = ult.ganho12m;
              if (Object.keys(patchCarteira).length > 0) {
                const carteiraAtualizada = { ...carteira, ...patchCarteira };
                formRef.current = { ...formRef.current, ...patchCarteira };
                setSnap(s => ({ ...s, ...patchCarteira }));
                // Persiste no doc do cliente (fire-and-forget)
                setDoc(
                  doc(db, "clientes", id),
                  stripUndefined({ carteira: carteiraAtualizada }),
                  { merge: true }
                ).then(() => invalidarCacheCliente(id))
                 .catch((e) => console.warn("Falha ao persistir fallback:", e));
              }
            } catch (e) {
              console.warn("Fallback de snapshot falhou:", e);
            }
          })();
        }
      } catch (e) {
        if (!alive) return;
        if (e?.message === "aborted") return;
        console.error("[Carteira] Falha ao carregar (todos os fallbacks):", e?.code, e?.message, e);
        setErroCarregar(e?.code || "unknown");
        setCarregou(true);
      }
    }
    carregar().finally(() => clearTimeout(timeoutId));
    return () => { alive = false; clearTimeout(timeoutId); };
  }, [id, retryKey]);

  // ─── Carregar histórico mensal (snapshots) ───────────────────
  // Busca em paralelo, sem bloquear o render principal. Falha silenciosa
  // (a seção simplesmente não aparece se der permission-denied etc.).
  useEffect(() => {
    let alive = true;
    listarSnapshots(id)
      .then((lista) => { if (alive) setSnapshots(lista || []); })
      .catch((e) => console.warn("[Carteira] Falha ao listar snapshots:", e?.code));
    return () => { alive = false; };
  }, [id, retryKey, recarregarSnaps]);

  // Apaga snapshot específico (com confirmação) — usado quando o usuário
  // importou o mês errado ou quer reimportar do zero.
  async function apagarSnapshot(mesRef) {
    if (!mesRef) return;
    if (!window.confirm(`Apagar o snapshot de ${formatarMesRef(mesRef)}? Os ativos da carteira atual NÃO são afetados — só a foto mensal será removida.`)) return;
    try {
      await deleteDoc(doc(db, "clientes", id, "snapshotsCarteira", mesRef));
      setSnapshotAberto(null);
      setRecarregarSnaps((k) => k + 1);
      setMsg(`✓ Snapshot de ${formatarMesRef(mesRef)} apagado.`);
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setMsg("Erro ao apagar snapshot: " + (e?.message || "tente novamente"));
    }
  }

  const setFSnap = useCallback((k, v) => {
    formRef.current = { ...formRef.current, [k]: v };
    setSnap((p) => ({ ...p, [k]: v }));
  }, []);

  // ─── Gestão de ativos ───────────────────────────────────────
  const getAtivos = (classKey) => snap[classKey + "Ativos"] || [];
  const getClassTotal = (classKey) => {
    const ativosKey = classKey + "Ativos";
    // Se o array de ativos existe (mesmo vazio), ele é a fonte da verdade.
    // Só cai no total legado quando o cliente nunca usou ativos individuais.
    if (Array.isArray(snap[ativosKey])) {
      return snap[ativosKey].reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
    }
    return parseCentavos(snap[classKey]) / 100;
  };

  function upsertAtivo(classKey, idx, dadosNovos) {
    const ativos = [...(snap[classKey + "Ativos"] || [])];
    if (idx === undefined || idx === null) {
      ativos.push({ id: newId(), nome: "", valor: "", objetivo: "", vencimento: "", rentMes: "", rentAno: "", segmento: "", ...dadosNovos });
    } else {
      ativos[idx] = { ...ativos[idx], ...dadosNovos };
    }
    setFSnap(classKey + "Ativos", ativos);
    setIsEditing(true);
  }

  function removeAtivo(classKey, idx) {
    const ativos = [...(snap[classKey + "Ativos"] || [])];
    ativos.splice(idx, 1);
    setFSnap(classKey + "Ativos", ativos);
    setIsEditing(true);
  }

  // Zera tudo de uma única classe: array de ativos vira [] e o legado vira "0".
  // Necessário porque dados antigos podem ter o legado preenchido sem o array,
  // e nesse caso não há ativo individual pra remover.
  function limparClasse(classKey) {
    const novo = {
      ...formRef.current,
      [classKey + "Ativos"]: [],
      [classKey]: "0",
    };
    formRef.current = novo;
    setSnap(novo);
    setIsEditing(true);
  }

  // move ativo entre classes (preserva id/dados) — usa formRef (sync) pra evitar race
  function moverAtivo(classKeyOrigem, idx, classKeyDestino, segmentoDestino) {
    if (classKeyOrigem === classKeyDestino) return;
    const fonte = formRef.current;
    const origem = [...(fonte[classKeyOrigem + "Ativos"] || [])];
    const ativo = origem[idx];
    if (!ativo) return;
    origem.splice(idx, 1);
    const destino = [...(fonte[classKeyDestino + "Ativos"] || [])];
    destino.push({ ...ativo, segmento: segmentoDestino !== undefined ? segmentoDestino : ativo.segmento });
    const novo = {
      ...fonte,
      [classKeyOrigem + "Ativos"]: origem,
      [classKeyDestino + "Ativos"]: destino,
    };
    formRef.current = novo;
    setSnap(novo);
    setIsEditing(true);
  }

  // ─── Cálculos agregados ─────────────────────────────────────
  const {
    total, totalNacional, totalPrevidencia, totalGlobal,
    liquidezD1, liquidezObj,
    classesAtivas, rentCalculada, rentExibir,
    aportesHistorico, aporteMesAtual, aporteMedio, aporteTotal,
    vinculoObjetivos,
  } = useMemo(() => {
    const totais = {};
    CLASSES.forEach((c) => { totais[c.key] = getClassTotal(c.key); });
    const total = CLASSES.reduce((acc, c) => acc + totais[c.key], 0);
    const totalNacional = GRUPOS[0].classes.reduce((a, c) => a + totais[c.key], 0);
    const totalPrevidencia = GRUPOS[1].classes.reduce((a, c) => a + totais[c.key], 0);
    const totalGlobal = GRUPOS[2].classes.reduce((a, c) => a + totais[c.key], 0);

    // Liquidez: se houver ativos com objetivo=Liquidez, usa; senão, Pós+IPCA+Pré
    const liquidezObj = CLASSES.reduce((acc, c) => {
      const ativos = snap[c.key + "Ativos"] || [];
      if (ativos.length > 0) {
        return acc + ativos.reduce((a, av) => a + ((av.objetivo || "") === "Liquidez" ? parseCentavos(av.valor) / 100 : 0), 0);
      }
      if ((snap[c.key + "Obj"] || "") === "Liquidez") return acc + totais[c.key];
      return acc;
    }, 0);
    const liquidezFallback = ["posFixado", "ipca", "preFixado"].reduce((acc, k) => acc + totais[k], 0);
    const liquidezD1 = liquidezObj > 0 ? liquidezObj : liquidezFallback;

    // Lista ordenada por valor — pré-calcula rentabilidade ponderada e objetivo dominante
    // por classe (antes esses reduces rodavam dentro do render .map() a cada paint,
    // produzindo O(classes × ativos) de trabalho síncrono em cada render).
    const classesAtivas = CLASSES
      .filter((c) => totais[c.key] > 0)
      .map((c) => {
        const ativosDaClasse = snap[c.key + "Ativos"] || [];
        const comRentAno = ativosDaClasse.filter((a) => parseFloat(String(a.rentAno).replace(",", ".")) && parseCentavos(a.valor) > 0);
        const somaAno = comRentAno.reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
        const rentAnoC = somaAno > 0 ? comRentAno.reduce((acc, a) => acc + parseFloat(String(a.rentAno).replace(",", ".")) * parseCentavos(a.valor) / 100, 0) / somaAno : null;
        const comRentMes = ativosDaClasse.filter((a) => parseFloat(String(a.rentMes).replace(",", ".")) && parseCentavos(a.valor) > 0);
        const somaMes = comRentMes.reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
        const rentMesC = somaMes > 0 ? comRentMes.reduce((acc, a) => acc + parseFloat(String(a.rentMes).replace(",", ".")) * parseCentavos(a.valor) / 100, 0) / somaMes : null;
        const objMap = {};
        ativosDaClasse.forEach((a) => {
          if (!a.objetivo) return;
          objMap[a.objetivo] = (objMap[a.objetivo] || 0) + parseCentavos(a.valor) / 100;
        });
        const objOrdenados = Object.entries(objMap).sort((a, b) => b[1] - a[1]);
        return {
          ...c,
          valor: totais[c.key],
          grupo: GRUPOS.find(g => g.classes.includes(c))?.key,
          ativosCount: ativosDaClasse.length,
          rentAnoC,
          rentMesC,
          objPrincipal: objOrdenados[0]?.[0] || null,
          nObj: objOrdenados.length,
        };
      })
      .sort((a, b) => b.valor - a.valor);

    // Todos os ativos (flat) para stats
    const todosAtivos = CLASSES.flatMap((c) =>
      (snap[c.key + "Ativos"] || []).map((a) => ({ ...a, classeKey: c.key, classeLabel: c.label, classeCor: c.cor, valorReais: parseCentavos(a.valor) / 100 }))
    );

    // Rentabilidade calculada (média ponderada dos rentAno preenchidos)
    const ponderados = todosAtivos.filter((a) => parseFloat(String(a.rentAno).replace(",", ".")) && a.valorReais > 0);
    const somaPond = ponderados.reduce((acc, a) => acc + a.valorReais, 0);
    const rentCalculada = somaPond > 0
      ? ponderados.reduce((acc, a) => acc + parseFloat(String(a.rentAno).replace(",", ".")) * a.valorReais, 0) / somaPond
      : null;
    const rentManual = parseFloat(snap.rentabilidade) || 0;
    const rentExibir = rentCalculada !== null ? rentCalculada : rentManual;

    // Aportes
    const aportesHistorico = Array.isArray(snap.aportesHistorico) ? snap.aportesHistorico : [];
    const mes = mesAtualStr();
    const aporteMesAtual = aportesHistorico
      .filter((a) => {
        if (!a.data) return false;
        const d = new Date(a.data);
        return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` === mes;
      })
      .reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
    const aporteTotal = aportesHistorico.reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
    const aporteMedio = aportesHistorico.length > 0 ? aporteTotal / aportesHistorico.length : 0;

    // Vínculo com objetivos (agrupa ativos por objetivo)
    const vinculoObjetivos = {};
    todosAtivos.forEach((a) => {
      if (!a.objetivo) return;
      if (!vinculoObjetivos[a.objetivo]) vinculoObjetivos[a.objetivo] = { label: a.objetivo, total: 0, qtd: 0, ativos: [] };
      vinculoObjetivos[a.objetivo].total += a.valorReais;
      vinculoObjetivos[a.objetivo].qtd += 1;
      vinculoObjetivos[a.objetivo].ativos.push(a);
    });

    return {
      total, totalNacional, totalPrevidencia, totalGlobal,
      liquidezD1, liquidezObj,
      classesAtivas, todosAtivos, rentCalculada, rentExibir,
      aportesHistorico, aporteMesAtual, aporteMedio, aporteTotal,
      vinculoObjetivos,
    };
  }, [snap]);

  const liquidezOk = reservaMeta > 0 && liquidezD1 >= reservaMeta;

  // ─── Salvar ─────────────────────────────────────────────────
  async function salvar() {
    setSalvando(true);
    try {
      const r = await lerClienteComFallback(id, { force: true });
      const dados = r.data || {};
      const novoForm = { ...formRef.current };

      // Sincroniza total da classe com soma dos ativos.
      // Se o array de ativos existe (mesmo vazio), ele manda — zera o legado
      // quando todos os ativos foram removidos.
      CLASSES.forEach((c) => {
        const ativosKey = c.key + "Ativos";
        if (Array.isArray(novoForm[ativosKey])) {
          const tot = novoForm[ativosKey].reduce((acc, a) => acc + parseCentavos(a.valor), 0);
          novoForm[c.key] = String(tot);
        }
      });

      // Liquidez sincronizada
      const liqD1Centavos = Math.round(liquidezD1 * 100);

      const novaCarteira = {
        ...novoForm,
        liquidezD1: String(liqD1Centavos),
        rentabilidadeCalculada: rentCalculada !== null ? rentCalculada.toFixed(2) : "",
        atualizadoEm: hojeBr(),
      };

      // Auto-cria objetivos-stub para qualquer ativo vinculado a um objetivo
      // (ex: Liquidez, Reserva de oportunidade) que ainda não existe na lista.
      // Esses stubs aparecem em /objetivos para o assessor configurar o plano.
      const objetivosAtuais = Array.isArray(dados.objetivos) ? dados.objetivos : [];
      const objetivosFinal = garantirObjetivosVinculados(novaCarteira, objetivosAtuais);
      const stubsCriados = objetivosFinal.length - objetivosAtuais.length;

      // Atualiza aporteRegistradoMes no root do cliente (compat dashboard)
      // e sincroniza patrimônio root-level com o total financeiro consolidado
      // (inclui imóveis/veículos já presentes em dados, mais o novo total da carteira).
      const totalCarteiraNovo = CLASSES.reduce((acc, c) => {
        const ativosKey = c.key + "Ativos";
        if (Array.isArray(novoForm[ativosKey])) {
          return acc + novoForm[ativosKey].reduce((s, a) => s + parseCentavos(a.valor), 0);
        }
        return acc + parseCentavos(novoForm[c.key]);
      }, 0);
      // Patch incremental — não espalha `dados` para não dropar userId/advisorId
      // quando ausentes/undefined no doc atual (rules do cliente exigem que
      // esses campos não mudem).
      const patch = stripUndefined({
        carteira: novaCarteira,
        objetivos: objetivosFinal,
        patrimonio: String(totalCarteiraNovo),
      });
      if (aporteMesAtual > 0) {
        patch.aporteRegistradoMes = String(Math.round(aporteMesAtual * 100));
        patch.aporteRegistradoMesEm = mesAtualStr();
        patch.lastAporteDate = hojeBr();
      }

      await setDoc(doc(db, "clientes", id), patch, { merge: true });
      invalidarCacheCliente(id);
      formRef.current = { ...novaCarteira };
      setSnap({ ...novaCarteira });
      setIsEditing(false);
      const msgBase = "✓ Carteira salva.";
      setMsg(stubsCriados > 0
        ? `${msgBase} Foram criados ${stubsCriados} novo${stubsCriados > 1 ? "s" : ""} objetivo${stubsCriados > 1 ? "s" : ""} automaticamente. Vá em Objetivos para configurar.`
        : msgBase);
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      console.error("[Carteira] Erro ao salvar:", e?.code, e?.message, e);
      const msgErro = e?.code === "permission-denied"
        ? "Sem permissão para salvar. Sua sessão pode ter expirado — faça logout e entre novamente."
        : e?.code === "unavailable"
        ? "Sem conexão com o servidor. Tente novamente em alguns segundos."
        : "Erro ao salvar: " + (e?.message || "erro desconhecido");
      setMsg(msgErro);
      setTimeout(() => setMsg(""), 6000);
    }
    setSalvando(false);
  }

  // auto-save para mudanças pontuais (aporte, etc)
  async function salvarSilencioso(snapLocal) {
    const r = await lerClienteComFallback(id, { force: true });
    const dados = r.data || {};
    const novaCarteira = { ...snapLocal, atualizadoEm: hojeBr() };
    const aportes = Array.isArray(novaCarteira.aportesHistorico) ? novaCarteira.aportesHistorico : [];
    const mes = mesAtualStr();
    const aporteMes = aportes.filter((a) => {
      if (!a.data) return false;
      const d = new Date(a.data);
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` === mes;
    }).reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);

    // Garante que objetivos referenciados em ativos existam (cria stubs).
    const objetivosAtuais = Array.isArray(dados.objetivos) ? dados.objetivos : [];
    const objetivosFinal = garantirObjetivosVinculados(novaCarteira, objetivosAtuais);

    const patch = stripUndefined({ carteira: novaCarteira, objetivos: objetivosFinal });
    if (aporteMes > 0) {
      patch.aporteRegistradoMes = String(Math.round(aporteMes * 100));
      patch.aporteRegistradoMesEm = mes;
      patch.lastAporteDate = hojeBr();
    }
    await setDoc(doc(db, "clientes", id), patch, { merge: true });
    invalidarCacheCliente(id);
  }

  // ─── Aporte ─────────────────────────────────────────────────
  async function registrarAporte({ valor, data, observacao }) {
    const centavos = parseCentavos(valor);
    if (centavos <= 0) return;
    const novo = { id: newId(), valor: String(centavos), data: data || new Date().toISOString().slice(0, 10), observacao: observacao || "" };
    const lista = [novo, ...(snap.aportesHistorico || [])];
    const novoForm = { ...formRef.current, aportesHistorico: lista };
    formRef.current = novoForm;
    setSnap(novoForm);
    await salvarSilencioso(novoForm);
    setMsg("✓ Aporte registrado e refletido no dashboard.");
    setTimeout(() => setMsg(""), 3500);
    setAporteModal(false);
  }

  async function removerAporte(aporteId) {
    const lista = (snap.aportesHistorico || []).filter((a) => a.id !== aporteId);
    const novoForm = { ...formRef.current, aportesHistorico: lista };
    formRef.current = novoForm;
    setSnap(novoForm);
    await salvarSilencioso(novoForm);
  }

  // ─── Limpar carteira (apaga todos os ativos + zera totais) ──
  async function limparCarteira() {
    setLimpando(true);
    try {
      // Não precisa ler antes — com merge:true só sobrescreve `carteira` e
      // `patrimonio`; os demais campos do doc permanecem intactos.

      // Zera todos os totais legados e limpa todos os ativos individuais
      const novaCarteira = { ...(formRef.current || {}) };
      CLASSES.forEach((c) => {
        novaCarteira[c.key] = "0";
        novaCarteira[c.key + "Ativos"] = [];
      });
      novaCarteira.liquidezD1 = "0";
      novaCarteira.rentabilidadeCalculada = "";
      novaCarteira.atualizadoEm = hojeBr();

      // Zera também o campo de patrimônio manual no root do cliente
      // para que o patrimônio financeiro total vá a zero imediatamente.
      const patch = stripUndefined({ carteira: novaCarteira, patrimonio: "0" });
      await setDoc(doc(db, "clientes", id), patch, { merge: true });
      invalidarCacheCliente(id);

      formRef.current = { ...novaCarteira };
      setSnap({ ...novaCarteira });
      setIsEditing(false);
      setLimparModal(false);
      setLimparInput("");
      setMsg("✓ Carteira apagada. Patrimônio financeiro zerado.");
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setMsg("Erro ao limpar: " + e.message);
    }
    setLimpando(false);
  }

  // ─── Upload PDF/Imagem ──────────────────────────────────────
  // Fluxo em duas etapas:
  //   1) extrai dados do arquivo
  //   2) mostra modal "qual mês vincular?" com a data de referência do PDF
  //      como sugestão; só depois de confirmar é que populamos o form e
  //      gravamos o snapshot mensal + propagamos pros objetivos/extrato.
  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const setP = (pct, message, extra = {}) => setUploadProgress({ pct, message, ...extra });
    // Validações up-front: evita perder tempo (e cota da CF) com arquivo
    // inviável. Limite de 8MB cobre PDFs grandes de XP/BTG; acima disso
    // o Cloud Functions retorna timeout/erro e o usuário fica sem feedback.
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setP(0, "", { error: true, pct: 0, message: "Arquivo muito grande", errorDetail: `O arquivo tem ${(file.size/1024/1024).toFixed(1)}MB. Máximo aceito: 8MB. Reduza/divida o PDF e tente novamente.` });
      e.target.value = "";
      return;
    }
    const tiposOk = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    const extOk = /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!tiposOk.includes(file.type) && !extOk) {
      setP(0, "", { error: true, pct: 0, message: "Formato não suportado", errorDetail: "Aceitos: PDF, PNG, JPG, JPEG, WEBP." });
      e.target.value = "";
      return;
    }
    setP(0, "Iniciando leitura do arquivo...");
    try {
      const isImage = file.type.startsWith("image/");
      let dados;

      if (isImage) {
        // Imagens: usa Cloud Function (Claude Vision) — mais preciso e suporta carteiras em USD
        setP(8, "Buscando cotação do dólar...");
        let cotacaoDolar = 5.75;
        try {
          // Timeout de 5s: se a API externa demorar, cai no fallback (5.75)
          // em vez de travar o upload aguardando indefinidamente.
          const fx = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", {
            signal: AbortSignal.timeout(5000),
          });
          const fxJson = await fx.json();
          const bid = parseFloat(fxJson?.USDBRL?.bid);
          if (bid > 0) cotacaoDolar = bid;
        } catch { /* usa fallback */ }

        setP(20, "Processando imagem com IA...");
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result.split(",")[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });

        const { httpsCallable } = await import("firebase/functions");
        const { functions: fbFunctions } = await import("../firebase");
        const callProcessar = httpsCallable(fbFunctions, "processarUploadCarteira", { timeout: 120000 });
        const result = await callProcessar({ base64, fileType: file.type, clienteId: id, cotacaoDolar });
        if (!result.data?.success) throw new Error("Falha ao processar imagem via IA.");
        // Cloud Function retorna formato {classes, ativos, patrimonioTotal...} — passa direto
        dados = result.data.dados;
      } else {
        const { extractText, parseCarteiraFromText } = await import("../utils/documentParser");
        const text = await extractText(file, (pct, message) => setP(pct, message));
        dados = parseCarteiraFromText(text);
      }

      const carteiraFields = Object.fromEntries(Object.entries(dados).filter(([k]) => !k.startsWith("_")));
      const camposPreenchidos = Object.keys(carteiraFields).length;

      if (camposPreenchidos === 0 && !dados._movimentacoes && !dados._tabelaRentMensal && !dados.classes && !dados.ativos) {
        setP(100, "Nenhum dado reconhecido.", { error: true, errorDetail: "O arquivo não contém dados financeiros legíveis. Tente outro arquivo ou preencha manualmente." });
      } else {
        setP(100, "✓ Extração concluída. Confirme o mês para salvar.");
        setImportPend({
          dados,
          fonte: file.type === "application/pdf" ? "pdf" : "imagem",
          arquivoNome: file.name,
        });
      }
    } catch (err) {
      setP(0, "", { error: true, pct: 0, message: "Erro ao processar arquivo", errorDetail: err?.message || String(err) || "Erro desconhecido" });
    }
    e.target.value = "";
  }

  // Confirmação do mês → aplica dados + salva snapshot + propaga
  async function confirmarImportacao(mesRef) {
    if (!importPend) return;
    setImportSalvando(true);
    try {
      const { dados, fonte, arquivoNome } = importPend;

      // 1) Popula o form da carteira com classes e ativos detectados.
      //    ANTES de sobrescrever, copia objetivo/segmento dos ativos antigos
      //    pra novos com o mesmo nome — assim a flag de objetivo persiste
      //    de mês a mês até o ativo sair da carteira.
      const carteiraFields = Object.fromEntries(Object.entries(dados).filter(([k]) => !k.startsWith("_")));
      CLASSES.forEach((c) => {
        const ativosKey = c.key + "Ativos";
        const novosAtivos = carteiraFields[ativosKey];
        const antigosAtivos = formRef.current[ativosKey];
        if (Array.isArray(novosAtivos) && Array.isArray(antigosAtivos) && antigosAtivos.length > 0) {
          const normNome = (s) => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
          const oldByNome = new Map();
          antigosAtivos.forEach((a) => {
            const k = normNome(a.nome);
            if (k) oldByNome.set(k, a);
          });
          carteiraFields[ativosKey] = novosAtivos.map((a) => {
            const k = normNome(a.nome);
            const old = k ? oldByNome.get(k) : null;
            if (!old) return a;
            const merged = { ...a };
            if (!merged.objetivo && old.objetivo) merged.objetivo = old.objetivo;
            if (!merged.segmento && old.segmento) merged.segmento = old.segmento;
            return merged;
          });
        }
      });
      const novoForm = { ...formRef.current };
      Object.entries(carteiraFields).forEach(([k, v]) => { novoForm[k] = v; });
      formRef.current = novoForm;
      setSnap(novoForm);
      setIsEditing(true);

      // 2) Normaliza para formato de snapshot e grava a foto mensal
      const snapshot = normalizarDadosParaSnapshot(dados, novoForm, mesRef);
      if (!snapshot.mesRef) snapshot.mesRef = mesRef;

      // Diff com o snapshot anterior (mês anterior) para detectar compras/vendas
      const mesAnt = mesAnterior(mesRef);
      const snapAnt = mesAnt ? await obterSnapshot(id, mesAnt) : null;
      // Também compara com o próprio mês (em caso de re-upload) pra ver o que mudou
      const snapMesmoMes = await obterSnapshot(id, mesRef);
      const movDiff = [
        ...diffSnapshots(snapAnt, snapshot),
        ...(snapMesmoMes ? diffSnapshots(snapMesmoMes, snapshot).map((m) => ({ ...m, origem: "reupload" })) : []),
      ];

      // ── Try direct write; on permission-denied fall back to Cloud Function ──
      // O fallback é defensivo: se o usuário tem custom claim ausente ou
      // advisorId do cliente está vazio/desatualizado, o setDoc direto pode
      // falhar mesmo com permissão real. A CF roda com Admin SDK e checa
      // role server-side, garantindo que master/assessor dono/cliente dono
      // sempre conseguem salvar.
      let usarFallbackCF = false;
      try {
        await salvarSnapshotMensal(id, mesRef, snapshot, { fonte, arquivoNome });
      } catch (errSnap) {
        if (errSnap?.code === "permission-denied") {
          console.warn("[Carteira] salvarSnapshotMensal permission-denied — usando fallback CF");
          usarFallbackCF = true;
        } else {
          throw errSnap;
        }
      }

      // 3) Propaga rent do mês para o acompanhamento dos objetivos + salva
      //    movimentações consolidadas no doc do cliente
      const r = await lerClienteComFallback(id, { force: true });
      const dadosCli = r.data || {};
      const objetivosAtuais = Array.isArray(dadosCli.objetivos) ? dadosCli.objetivos : [];
      const objsComRent = aplicarRentNosObjetivos(objetivosAtuais, snapshot);

      // Sanity check de aportes: a IA (Vision) e o parser local às vezes
      // classificam "saldo total", "patrimônio", "compra de ativo" ou
      // "recompra compromissada" como tipo=aporte. Filtra antes de gravar
      // em qualquer lugar (aportesHistorico E movimentacoesExtrato).
      const patTot = Number(snapshot.patrimonioTotal) || 0;
      const aportesRejeitados = [];
      const movsValidadas = (snapshot.movimentacoes || []).filter((m) => {
        if (isAporteSuspeito(m, patTot)) {
          aportesRejeitados.push(m);
          return false;
        }
        return true;
      });
      if (aportesRejeitados.length > 0) {
        console.warn("[Carteira] Aportes rejeitados pela validação:", aportesRejeitados);
      }
      let aportesPdf = movsValidadas.filter((m) => String(m.tipo || "").toLowerCase() === "aporte" && Number(m.valor) > 0);

      // ── Heurística "ativo novo sem compra = aporte externo (TVM/TED)" ──
      // Se aparece um ativo NOVO no snapshot (detectado por diffSnapshots como
      // "compra"), mas NÃO existe linha de "compra" desse ativo nas movimentações
      // do mês atual nem do anterior, é provável que veio de fora (transferência
      // de outra corretora, aporte direto). Marca como aporte inferido.
      // Threshold: só aplica se delta >= R$ 1.000 (evita ruído de fundos/cotas).
      const compraMovsConhecidas = new Set(
        (snapshot.movimentacoes || [])
          .concat((snapAnt?.movimentacoes) || [])
          .filter((m) => String(m.tipo || "").toLowerCase() === "compra")
          .map((m) => String(m.ativo || "").toUpperCase().trim())
          .filter(Boolean)
      );
      const aportesInferidos = movDiff
        .filter((d) => d.tipo === "compra" && Number(d.deltaValor) >= 1000)
        .filter((d) => !compraMovsConhecidas.has(String(d.ativo || "").toUpperCase().trim()))
        .map((d) => ({
          tipo: "aporte",
          data: d.data,
          ativo: d.ativo,
          classe: d.classe,
          valor: Number(d.deltaValor) || 0,
          descricao: `Aporte externo · ${d.ativo || ""}`.trim(),
          origem: "diff-inferido",
          inferido: true,
        }));
      if (aportesInferidos.length > 0) {
        console.info("[Carteira] Aportes externos inferidos (ativo novo sem compra registrada):", aportesInferidos);
        aportesPdf = aportesPdf.concat(aportesInferidos);
      }

      // Converte movimentações do snapshot + diff + aportes inferidos em entradas do extrato
      // (garante nenhum campo undefined — Firestore rejeita)
      const novasMovimentacoes = [
        ...movsValidadas.map((m) => ({
          data: m.data || snapshot.dataRef || `${mesRef}-15`,
          tipo: m.tipo || "outro",
          descricao: m.descricao || "Movimentação",
          ativo: m.ativo || "",
          valor: Number(m.valor) || 0,
          origem: "pdf",
        })),
        ...movDiff.map((m) => ({
          data: m.data || snapshot.dataRef || `${mesRef}-15`,
          tipo: m.tipo || "outro",
          descricao: `${m.tipo === "compra" ? "Compra" : m.tipo === "venda" ? "Venda" : m.tipo === "reforco" ? "Reforço" : "Movimento"} · ${m.ativo || ""}`,
          ativo: m.ativo || "",
          classe: m.classe || "",
          valor: Number(m.deltaValor) || 0,
          origem: m.origem || "diff",
        })),
        ...aportesInferidos.map((m) => ({
          data: m.data,
          tipo: "aporte",
          descricao: m.descricao,
          ativo: m.ativo || "",
          classe: m.classe || "",
          valor: Number(m.valor) || 0,
          origem: "diff-inferido",
        })),
      ];

      const movFinais = mesclarMovimentacoes(dadosCli.movimentacoesExtrato, novasMovimentacoes, mesRef);
      let aportesHistNovos = Array.isArray(novoForm.aportesHistorico) ? [...novoForm.aportesHistorico] : [];
      let maiorAporteDoMes = 0;
      if (aportesPdf.length > 0) {
        aportesPdf.forEach((m, idx) => {
          const data = m.data || snapshot.dataRef || `${mesRef}-15`;
          const valor = Number(m.valor);
          const chaveDedupe = `${data}-${Math.round(valor * 100)}`;
          const jaExiste = aportesHistNovos.some((a) => {
            const aData = a.data || "";
            const aValor = typeof a.valor === "number" ? a.valor : parseInt(String(a.valor || "0").replace(/\D/g, "")) / 100;
            return `${aData}-${Math.round(aValor * 100)}` === chaveDedupe;
          });
          if (!jaExiste) {
            aportesHistNovos.push({
              id: `pdf-${mesRef}-${idx}-${Date.now()}`,
              data,
              valor: String(Math.round(valor * 100)), // centavos (padrão do formulário)
              origem: "PDF XP",
              descricao: m.descricao || "Aporte",
              ativo: m.ativo || "",
              classe: m.classe || "",
            });
          }
          if (data.startsWith(mesRef) && valor > maiorAporteDoMes) {
            maiorAporteDoMes = valor;
          }
        });
        // Atualiza o formulário in-memory (reflete imediatamente na UI)
        novoForm.aportesHistorico = aportesHistNovos;
        formRef.current = novoForm;
        setSnap(novoForm);
      }

      // 4) Persiste rent12m + dataRef + movimentos no doc do cliente
      const rent12mFinal = snapshot.rent12m != null ? snapshot.rent12m
        : (dadosCli.carteira?.rent12m != null ? dadosCli.carteira.rent12m : null);
      const rentAnoFinal = snapshot.rentAno != null ? snapshot.rentAno
        : (dadosCli.carteira?.rentAno != null ? dadosCli.carteira.rentAno : null);
      const rentMesFinal = snapshot.rentMes != null ? snapshot.rentMes
        : (dadosCli.carteira?.rentMes != null ? dadosCli.carteira.rentMes : null);

      // Patch incremental — não espalha `dadosCli` no top-level (preserva
      // userId/advisorId via merge:true). O sub-objeto `carteira` continua
      // sendo escrito por completo, pois é o que muda na importação.
      const patch = stripUndefined({
        carteira: {
          ...(dadosCli.carteira || {}),
          ...novoForm,
          atualizadoEm: hojeBr(),
          rent12m: rent12mFinal,
          rentAno: rentAnoFinal,
          rentMes: rentMesFinal,
          ganhoMes: snapshot.ganhoMes != null ? snapshot.ganhoMes : (dadosCli.carteira?.ganhoMes ?? null),
          ganhoAno: snapshot.ganhoAno != null ? snapshot.ganhoAno : (dadosCli.carteira?.ganhoAno ?? null),
          ganho12m: snapshot.ganho12m != null ? snapshot.ganho12m : (dadosCli.carteira?.ganho12m ?? null),
          ultimoSnapshot: mesRef,
          ultimaDataReferencia: snapshot.dataRef || null,
        },
        objetivos: objsComRent,
        movimentacoesExtrato: movFinais,
      });

      // Se o snapshot direct falhou OU agora tentamos direct e falhar,
      // grava tudo via Cloud Function (Admin SDK bypassa rules).
      if (usarFallbackCF) {
        const callSalvar = httpsCallable(functions, "salvarSnapshotECliente", { timeout: 30000 });
        await callSalvar({
          clienteId: id,
          mesRef,
          snapshotPayload: snapshot,
          clientePatch: patch,
          opcoes: { fonte, arquivoNome },
        });
      } else {
        try {
          await setDoc(doc(db, "clientes", id), patch, { merge: true });
        } catch (errSet) {
          if (errSet?.code === "permission-denied") {
            console.warn("[Carteira] setDoc cliente permission-denied — usando fallback CF");
            const callSalvar = httpsCallable(functions, "salvarSnapshotECliente", { timeout: 30000 });
            await callSalvar({
              clienteId: id,
              mesRef,
              snapshotPayload: snapshot,
              clientePatch: patch,
              opcoes: { fonte, arquivoNome },
            });
          } else {
            throw errSet;
          }
        }
      }
      invalidarCacheCliente(id);

      // 4.5) Atualiza o estado local (snap) com os campos do PDF, para que os KPIs
      //      (Rent. mês / Rent. ano / Rent. 12m / Ganho ano / Ganho 12m) apareçam
      //      IMEDIATAMENTE após o Salvar — sem precisar recarregar a página.
      const carteiraAtualizada = { ...novoForm, ...patch.carteira };
      formRef.current = carteiraAtualizada;
      setSnap(carteiraAtualizada);

      // 5) Mostra resumo pro usuário
      setXpSummary({
        _tipo: "relatorio",
        _mesRef: mesRef,
        _dataRef: snapshot.dataRef,
        _patrimonioTotal: Math.round((snapshot.patrimonioTotal || 0) * 100),
        _rentMes: snapshot.rentMes != null ? String(snapshot.rentMes) : null,
        _rentAno: snapshot.rentAno != null ? String(snapshot.rentAno) : null,
        _rent12m: snapshot.rent12m != null ? String(snapshot.rent12m) : null,
        _ganhoMes: Math.round((snapshot.ganhoMes || 0) * 100),
        _rendimentosPassivos: Math.round(((snapshot.resumoMes?.dividendos || 0) + (snapshot.resumoMes?.juros || 0) + (snapshot.resumoMes?.amortizacao || 0)) * 100),
        // Usa a soma dos aportes VALIDADOS (depois da sanity check) em vez do
        // resumoMes.aportes bruto — evita exibir valores inflados quando o LLM
        // classificou erroneamente uma compra ou o patrimônio total como aporte.
        _aportes: Math.round(aportesPdf.reduce((a, m) => a + (Number(m.valor) || 0), 0) * 100),
        _movDiff: movDiff.length,
        _movExtraidas: (snapshot.movimentacoes || []).length,
      });
      setImportPend(null);
      setMsg(`✓ ${formatarMesRef(mesRef)} salvo. ${movDiff.length} movimento${movDiff.length === 1 ? "" : "s"} detectado${movDiff.length === 1 ? "" : "s"}.`);
      setTimeout(() => setMsg(""), 6000);
    } catch (err) {
      // Diagnóstico expandido: log ctx completo pra debug em campo.
      // O catch do importação cobre erros de salvarSnapshotMensal,
      // lerClienteComFallback, ou setDoc(cliente). Dump de tudo que
      // pode ter relevância pra rules (auth uid, email, advisorId).
      console.error("[Carteira] Erro ao salvar importação:", {
        code: err?.code,
        message: err?.message,
        clienteId: id,
        authUid: auth.currentUser?.uid,
        authEmail: auth.currentUser?.email,
        // Stack pode dar dica de qual etapa falhou (salvarSnapshotMensal, setDoc, etc.)
        stack: err?.stack?.split("\n").slice(0, 4).join(" | "),
        err,
      });
      const msgErro = err?.code === "permission-denied"
        ? "Sem permissão para salvar este cliente. Causa provável: sessão expirada (faça logout/login) ou advisorId do cliente não bate com sua conta. Veja o console (F12) pra detalhes."
        : "Erro ao salvar: " + (err?.message || "erro desconhecido");
      setMsg(msgErro);
    } finally {
      setImportSalvando(false);
    }
  }

  if (!carregou) {
    return (
      <div style={{ ...C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          border: "3px solid rgba(240,162,2,0.2)",
          borderTopColor: "#F0A202",
          animation: "spin 0.8s linear infinite",
        }} />
        <div style={{ color: T.textPrimary, fontSize: 14, letterSpacing: "0.1em", fontWeight: 500 }}>
          Carregando carteira...
        </div>
        <div style={{ color: T.textMuted, fontSize: 11 }}>
          Cliente: {id?.slice(0, 8)}…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (erroCarregar) {
    const isPermission = erroCarregar === "permission-denied" || erroCarregar === "unauthenticated";
    return (
      <div style={{ ...C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
          <div style={{ color: T.textPrimary, fontWeight: 600, marginBottom: 8, fontSize: 16 }}>
            {isPermission ? "Sem permissão de acesso" : "Erro ao carregar a carteira"}
          </div>
          <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 4 }}>
            {isPermission
              ? "Sua sessão pode ter expirado ou este cliente não está vinculado à sua conta."
              : "Não foi possível carregar os dados. Isso pode ser uma instabilidade de conexão."}
          </div>
          {user?.email && (
            <div style={{ color: T.textMuted, fontSize: 12, marginBottom: 4 }}>
              Logado como: <span style={{ color: T.textPrimary }}>{user.email}</span>
              {profile?.role && <span style={{ color: T.accent, marginLeft: 6 }}>({profile.role})</span>}
            </div>
          )}
          <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 24, opacity: 0.5 }}>
            Código: {erroCarregar}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              style={{ ...C.btnPrimary }}
              onClick={() => { setErroCarregar(null); setCarregou(false); setRetryKey(k => k + 1); }}
            >
              Tentar novamente
            </button>
            {isPermission && (
              <button
                style={{ ...C.btnSecondary }}
                onClick={() => signOut(auth).then(() => navigate("/", { replace: true }))}
              >
                Trocar conta
              </button>
            )}
            <button
              style={{ ...C.btnSecondary }}
              onClick={() => navigate(-1)}
            >
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="dashboard-container has-sidebar" style={{ ...C.bg, minHeight: "100vh", paddingBottom: 80 }}>
      <Sidebar mode="cliente" clienteId={id} clienteNome={clienteNome || ""} />
      <Navbar
        showLogout={true}
        actionButtons={[
          { icon: "←", label: "Voltar", variant: "secondary", onClick: () => (window.history.length > 1 ? navigate(-1) : navigate(`/cliente/${id}`)), title: "Voltar" },
          { icon: "↑", label: "Importar", onClick: () => fileInputRef.current?.click(), disabled: !!uploadProgress && !uploadProgress.error && uploadProgress.pct < 100 },
          { icon: "＋", label: "Aporte", variant: "secondary", onClick: () => setAporteModal(true) },
          isEditing
            ? { icon: "💾", label: salvando ? "Salvando..." : "Salvar", variant: "primary", onClick: salvar, disabled: salvando }
            : { icon: "✎", label: "Editar", variant: "primary", onClick: () => setIsEditing(true) },
        ]}
      />
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: "none" }} onChange={handleUpload} />

      {/* Botão voltar flutuante */}
      <BackFab onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/cliente/${id}`))} />

      {/* Modais */}
      {importPend && (
        <MesVinculoModal
          dados={importPend.dados}
          salvando={importSalvando}
          onConfirm={confirmarImportacao}
          onCancel={() => { setImportPend(null); setUploadProgress(null); }}
        />
      )}
      {xpSummary && <RelatorioModal meta={xpSummary} onClose={() => setXpSummary(null)} />}
      {uploadProgress && !importPend && <UploadOverlay progress={uploadProgress} onClose={() => setUploadProgress(null)} />}
      {aporteModal && <AporteModal onClose={() => setAporteModal(false)} onSave={registrarAporte} />}
      {snapshotAberto && (
        <SnapshotViewerModal
          snapshot={snapshotAberto}
          clienteId={id}
          clienteNome={clienteNome}
          onClose={() => setSnapshotAberto(null)}
          onApagar={() => apagarSnapshot(snapshotAberto.mesRef)}
        />
      )}
      {limparModal && (
        <LimparCarteiraModal
          nomeCliente={clienteNome}
          total={total}
          input={limparInput}
          setInput={setLimparInput}
          limpando={limpando}
          onClose={() => { setLimparModal(false); setLimparInput(""); }}
          onConfirm={limparCarteira}
        />
      )}
      {classeAberta && (
        <ClasseDrilldown
          classe={classByKey[classeAberta]}
          ativos={getAtivos(classeAberta)}
          total={getClassTotal(classeAberta)}
          totalCarteira={total}
          onClose={() => setClasseAberta(null)}
          onAddAtivo={() => {
            upsertAtivo(classeAberta);
            setAtivoEditando({ classKey: classeAberta, idx: (getAtivos(classeAberta) || []).length });
          }}
          onEditAtivo={(idx) => setAtivoEditando({ classKey: classeAberta, idx })}
          onRemoveAtivo={(idx) => removeAtivo(classeAberta, idx)}
          onLimparClasse={() => limparClasse(classeAberta)}
        />
      )}
      {ativoEditando && (
        <AtivoEditor
          ctx={ativoEditando}
          snap={snap}
          onClose={() => setAtivoEditando(null)}
          onUpdate={(dados) => upsertAtivo(ativoEditando.classKey, ativoEditando.idx, dados)}
          onMove={(destKey, seg) => {
            moverAtivo(ativoEditando.classKey, ativoEditando.idx, destKey, seg);
            setAtivoEditando(null);
            setClasseAberta(destKey);
          }}
        />
      )}

      <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}>
        {/* ── HERO ── */}
        <div style={{
          background: `linear-gradient(135deg, rgba(240,162,2,0.05), rgba(240,162,2,0.02) 50%, transparent)`,
          border: `0.5px solid rgba(240,162,2,0.15)`,
          borderRadius: T.radiusXl,
          padding: "28px 32px",
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
          boxShadow: T.shadowGold,
        }}>
          <div style={{
            position: "absolute", top: -40, right: -40, width: 200, height: 200,
            background: `radial-gradient(circle, rgba(240,162,2,0.08) 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18, position: "relative" }}>
            <AvatarIcon tipo={clienteAvatar} size={56} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 4, ...noSel }}>
                Carteira de Investimentos
              </div>
              <div style={{ fontSize: "clamp(15px, 4vw, 26px)", fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {clienteNome || "Cliente"}
              </div>
            </div>
            {snap.atualizadoEm && (
              <div style={{ textAlign: "right", ...noSel }}>
                <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em" }}>Última atualização</div>
                <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4 }}>{snap.atualizadoEm}</div>
              </div>
            )}
          </div>

          {/* KPIs dentro do hero — 3 cards PADRONIZADOS (mesmo fundo/borda/altura/fonte),
              cor aplicada APENAS ao valor principal. Estilo alinhado aos cards do resto do site. */}
          {(() => {
            const rentMesPdf = snap?.rentMes;
            const rentAnoPdf = snap?.rentAno;
            const rent12mPdf = snap?.rent12m;
            const ganhoAnoPdf = snap?.ganhoAno;
            const ganho12mPdf = snap?.ganho12m;
            const rentAnoFinal = rentAnoPdf != null ? Number(rentAnoPdf) : rentExibir;
            const fmtPct = (v) => v == null || isNaN(Number(v)) ? null : (Number(v) > 0 ? `+${pct(Number(v), 2)}` : pct(Number(v), 2));
            const corPct = (v) => v == null || isNaN(Number(v)) ? T.textMuted : (Number(v) > 0 ? T.success : Number(v) < 0 ? T.danger : T.textMuted);

            // Métrica principal de performance: prioriza 12m > ano > mês
            const perfPrimaryValor = rent12mPdf != null ? Number(rent12mPdf) : (rentAnoFinal != null ? Number(rentAnoFinal) : null);
            const perfPrimaryLabel = rent12mPdf != null ? "12 meses" : (rentAnoFinal != null ? "no ano" : "—");
            const perfPrimaryGanho = rent12mPdf != null ? ganho12mPdf : ganhoAnoPdf;

            // Estilo base IGUAL para os 3 cards
            const cardBase = {
              background: "rgba(255,255,255,0.02)",
              border: `0.5px solid ${T.border}`,
              borderRadius: T.radiusMd,
              padding: "14px 16px",
              minWidth: 0,
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            };
            const labelStyle = { fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 500, ...noSel };
            const valorMain = {
              fontSize: 20,
              fontWeight: 400,
              letterSpacing: "-0.01em",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.15,
            };
            const subLine = { fontSize: 11, color: T.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
            const subValor = { fontVariantNumeric: "tabular-nums", fontWeight: 500, color: T.textSecondary };

            return (
              <div className="carteira-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, position: "relative" }}>

                {/* ── CARD 1: PATRIMÔNIO ── */}
                <div style={cardBase}>
                  <div style={labelStyle}>Patrimônio total</div>
                  <div style={{ ...valorMain, color: T.gold }}>{brl(total)}</div>
                  <div style={subLine}>
                    <span>Disponível D+1</span>
                    <span style={subValor}>{brl(liquidezD1)}</span>
                  </div>
                </div>

                {/* ── CARD 2: PERFORMANCE ── */}
                <div style={cardBase}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={labelStyle}>Performance</div>
                    <div style={{ fontSize: 9, color: T.textMuted, letterSpacing: "0.06em" }}>{perfPrimaryLabel}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ ...valorMain, color: corPct(perfPrimaryValor) }}>
                      {fmtPct(perfPrimaryValor) || "—"}
                    </div>
                    {perfPrimaryGanho != null && (
                      <div style={{
                        fontSize: 12,
                        color: Number(perfPrimaryGanho) >= 0 ? T.success : T.danger,
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.85,
                      }}>
                        {Number(perfPrimaryGanho) >= 0 ? "+" : ""}{brl(Number(perfPrimaryGanho))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 2 }}>
                    <div>
                      <div style={{ fontSize: 8.5, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Mês</div>
                      <div style={{ fontSize: 12, color: corPct(rentMesPdf), fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                        {fmtPct(rentMesPdf) || "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 8.5, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Ano</div>
                      <div style={{ fontSize: 12, color: corPct(rentAnoFinal), fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                        {fmtPct(rentAnoFinal) || "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 8.5, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Ganho ano</div>
                      <div style={{
                        fontSize: 12,
                        color: ganhoAnoPdf != null ? (Number(ganhoAnoPdf) >= 0 ? T.success : T.danger) : T.textMuted,
                        fontVariantNumeric: "tabular-nums", fontWeight: 500,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {ganhoAnoPdf != null ? brl(Number(ganhoAnoPdf)) : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card "Aporte" removido — info agora aparece direto no card do
                    mês atual da seção "Evolução da Carteira" (em roxo, "+R$ X aportado") */}

              </div>
            );
          })()}
        </div>

        {/* Feedback */}
        {msg && (
          <div style={{
            padding: "12px 16px", borderRadius: T.radiusMd, marginBottom: 14, fontSize: 12,
            background: msg.includes("Erro") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
            border: `0.5px solid ${msg.includes("Erro") ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
            color: msg.includes("Erro") ? T.danger : "#4ade80",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            {msg}
            <button onClick={() => setMsg("")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        )}

        {/* ── COMPOSIÇÃO (pizza + tabela) ── */}
        <SectionTitle>Composição da Carteira</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
          {/* Pizza */}
          <div style={{
            ...C.card,
            padding: "24px 20px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
            flexBasis: 300, flexShrink: 0, minWidth: 0, maxWidth: "100%",
          }}>
            <DonutChartModern
              data={classesAtivas}
              total={total}
              size={240}
              thickness={42}
              labelCentro="PATRIMÔNIO"
              formatValor={brlCompact}
              onHover={setHoverFatia}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxHeight: 180, overflowY: "auto" }}>
              {classesAtivas.map((c) => {
                const p = total > 0 ? Math.round((c.valor / total) * 100) : 0;
                return (
                  <div
                    key={c.key}
                    onMouseEnter={() => setHoverFatia(c.key)}
                    onMouseLeave={() => setHoverFatia(null)}
                    onClick={() => setClasseAberta(c.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8,
                      cursor: "pointer",
                      background: hoverFatia === c.key ? `rgba(${hexToRgb(c.cor)},0.08)` : "transparent",
                      transition: "background 0.15s",
                    }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.cor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: T.textSecondary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                    <span style={{ fontSize: 11, color: c.cor, fontWeight: 500 }}>{p}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabela — apenas desktop (≥721px) */}
          <div className="pi-carteira-table pi-carteira-table-desktop pi-scroll-x" style={{ ...C.card, padding: 0, overflowX: "auto", overflowY: "hidden", flex: 1, minWidth: 0, WebkitOverflowScrolling: "touch" }}>
            <div style={{ minWidth: 480 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1.4fr 1fr 60px 80px 80px 1.1fr 28px",
              padding: "16px 18px", borderBottom: `0.5px solid ${T.border}`,
              fontSize: 11, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.1em",
              fontWeight: 500, ...noSel,
            }}>
              <div>Classe</div>
              <div style={{ textAlign: "right" }}>Valor</div>
              <div style={{ textAlign: "right" }}>%</div>
              <div style={{ textAlign: "right" }}>Rent Mês</div>
              <div style={{ textAlign: "right" }}>Rent Ano</div>
              <div style={{ paddingLeft: 14 }}>Objetivo</div>
              <div />
            </div>
            {classesAtivas.length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: T.textMuted, fontSize: 12, ...noSel }}>
                Nenhuma classe com valor. Importe um relatório ou adicione ativos manualmente.
              </div>
            )}
            {classesAtivas.map((c) => {
              const p = total > 0 ? Math.round((c.valor / total) * 100) : 0;
              // Valores pré-calculados no useMemo (rentAnoC, rentMesC, objPrincipal, nObj, ativosCount)
              const { rentAnoC, rentMesC, objPrincipal, nObj, ativosCount } = c;
              return (
                <div
                  key={c.key}
                  onClick={() => setClasseAberta(c.key)}
                  onMouseEnter={() => setHoverFatia(c.key)}
                  onMouseLeave={() => setHoverFatia(null)}
                  style={{
                    display: "grid", gridTemplateColumns: "1.4fr 1fr 60px 80px 80px 1.1fr 28px",
                    padding: "16px 18px", borderBottom: `0.5px solid ${T.border}`,
                    cursor: "pointer", alignItems: "center",
                    background: hoverFatia === c.key ? `rgba(${hexToRgb(c.cor)},0.05)` : "transparent",
                    transition: "background 0.15s",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div style={{ width: 3, height: 24, borderRadius: 2, background: c.cor, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: T.textPrimary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                        {ativosCount > 0 ? `${ativosCount} ativo${ativosCount > 1 ? "s" : ""} · liq ${c.liq}` : `valor da classe · liq ${c.liq}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, color: T.textPrimary, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{brl(c.valor)}</div>
                  <div style={{ fontSize: 13, color: c.cor, textAlign: "right", fontWeight: 600 }}>{p}%</div>
                  <div style={{ fontSize: 12, textAlign: "right", color: rentMesC !== null ? (rentMesC > 0 ? T.success : T.danger) : T.textMuted, fontVariantNumeric: "tabular-nums" }}>
                    {rentMesC !== null ? `${rentMesC > 0 ? "+" : ""}${rentMesC.toFixed(2)}%` : "—"}
                  </div>
                  <div style={{ fontSize: 12, textAlign: "right", color: rentAnoC !== null ? (rentAnoC > 0 ? T.success : T.danger) : T.textMuted, fontVariantNumeric: "tabular-nums" }}>
                    {rentAnoC !== null ? `${rentAnoC > 0 ? "+" : ""}${rentAnoC.toFixed(2)}%` : "—"}
                  </div>
                  <div style={{ paddingLeft: 14, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {objPrincipal ? (
                      <>
                        <span style={{
                          fontSize: 11, color: T.gold, background: "rgba(240,162,2,0.08)",
                          border: "0.5px solid rgba(240,162,2,0.3)", borderRadius: 4,
                          padding: "3px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }}>{objPrincipal}</span>
                        {nObj > 1 && (
                          <span style={{ fontSize: 10, color: T.textMuted }}>+{nObj - 1}</span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>definir →</span>
                    )}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 16, textAlign: "right" }}>›</div>
                  {/* barra progresso */}
                  <div style={{ gridColumn: "1 / -1", height: 2, background: "rgba(255,255,255,0.04)", borderRadius: 1, overflow: "hidden", marginTop: 10 }}>
                    <div style={{ height: "100%", width: `${p}%`, background: c.cor, opacity: 0.7 }} />
                  </div>
                </div>
              );
            })}
            {/* Footer total */}
            {classesAtivas.length > 0 && (
              <div style={{
                padding: "16px 18px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "rgba(240,162,2,0.04)",
                ...noSel,
              }}>
                <span style={{ fontSize: 12, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500 }}>Total</span>
                <span style={{ fontSize: 17, color: T.gold, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{brl(total)}</span>
              </div>
            )}
            </div>{/* end minWidth wrapper */}
          </div>

          {/* Cards mobile — escondido em desktop, mostra em ≤720px */}
          <div className="pi-carteira-cards-mobile" style={{ flex: 1, minWidth: 0, display: "none", flexDirection: "column", gap: 8 }}>
            {classesAtivas.length === 0 ? (
              <div style={{ ...C.card, padding: "32px 20px", textAlign: "center", color: T.textMuted, fontSize: 12, ...noSel }}>
                Nenhuma classe com valor. Importe um relatório ou adicione ativos manualmente.
              </div>
            ) : (
              <>
                {classesAtivas.map((c) => {
                  const p = total > 0 ? Math.round((c.valor / total) * 100) : 0;
                  const { rentAnoC, rentMesC, objPrincipal, nObj, ativosCount } = c;
                  return (
                    <div
                      key={c.key}
                      onClick={() => setClasseAberta(c.key)}
                      style={{
                        ...C.card,
                        padding: "14px 16px",
                        cursor: "pointer",
                        position: "relative",
                        borderLeft: `3px solid ${c.cor}`,
                      }}
                    >
                      {/* Linha 1: classe + valor */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, color: T.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</div>
                          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                            {ativosCount > 0 ? `${ativosCount} ativo${ativosCount > 1 ? "s" : ""} · liq ${c.liq}` : `liq ${c.liq}`}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 14, color: T.textPrimary, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{brl(c.valor)}</div>
                          <div style={{ fontSize: 12, color: c.cor, fontWeight: 600, marginTop: 2 }}>{p}%</div>
                        </div>
                      </div>

                      {/* Linha 2: rentabilidade + objetivo */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <div style={{ display: "flex", gap: 12, color: T.textMuted }}>
                          <span>
                            Mês:{" "}
                            <span style={{ color: rentMesC !== null ? (rentMesC > 0 ? T.success : T.danger) : T.textMuted, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                              {rentMesC !== null ? `${rentMesC > 0 ? "+" : ""}${rentMesC.toFixed(2)}%` : "—"}
                            </span>
                          </span>
                          <span>
                            Ano:{" "}
                            <span style={{ color: rentAnoC !== null ? (rentAnoC > 0 ? T.success : T.danger) : T.textMuted, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                              {rentAnoC !== null ? `${rentAnoC > 0 ? "+" : ""}${rentAnoC.toFixed(2)}%` : "—"}
                            </span>
                          </span>
                        </div>
                        {objPrincipal ? (
                          <span style={{
                            fontSize: 10, color: T.gold, background: "rgba(240,162,2,0.10)",
                            border: "0.5px solid rgba(240,162,2,0.32)", borderRadius: 999,
                            padding: "3px 8px", whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            🎯 {objPrincipal}{nObj > 1 ? ` +${nObj - 1}` : ""}
                          </span>
                        ) : null}
                      </div>

                      {/* Barra de progresso */}
                      <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${p}%`, background: c.cor, opacity: 0.8 }} />
                      </div>
                    </div>
                  );
                })}
                {/* Footer total */}
                <div style={{
                  ...C.card,
                  padding: "14px 16px",
                  background: "rgba(240,162,2,0.06)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  ...noSel,
                }}>
                  <span style={{ fontSize: 11, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 500 }}>Total</span>
                  <span style={{ fontSize: 16, color: T.gold, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{brl(total)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── HISTÓRICO MENSAL DE SNAPSHOTS ── */}
        {snapshots.length > 0 && (
          <>
            <SectionTitle>Evolução da Carteira</SectionTitle>
            <HistoricoMensalChart
              items={snapshots.map((s) => {
                // Aporte do mês: prioriza resumoMes.aportes (do snapshot do PDF);
                // se não tiver, soma aportesHistorico[] daquele mesRef.
                let aporteMes = Number(s.resumoMes?.aportes) || 0;
                if (!aporteMes && Array.isArray(aportesHistorico)) {
                  aporteMes = aportesHistorico.reduce((acc, a) => {
                    if (!a.data) return acc;
                    const mes = String(a.data).slice(0, 7);
                    return mes === s.mesRef ? acc + parseCentavos(a.valor) / 100 : acc;
                  }, 0);
                }
                return {
                  mesRef: s.mesRef,
                  valor: Number(s.patrimonioTotal) || 0,
                  rentMes: s.rentMes,
                  aporte: aporteMes,
                  meta: s,
                };
              })}
              onSelect={(it) => setSnapshotAberto(it.meta)}
              descricao='Cada importação de PDF mensal vira uma "foto" da carteira. Aportes do mês aparecem em roxo. Clique em um mês para ver como ela estava naquele período.'
            />
          </>
        )}

        {/* ── BALANÇO NACIONAL/GLOBAL/PREVIDÊNCIA ── */}
        {(totalNacional > 0 || totalGlobal > 0 || totalPrevidencia > 0) && (
          <>
            <SectionTitle>Balanço por Região</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${[totalNacional, totalGlobal, totalPrevidencia].filter(v => v > 0).length}, minmax(0, 1fr))`, gap: 14, marginBottom: 22 }}>
              {[
                { label: "Brasil", icon: "🇧🇷", v: totalNacional, cor: "#F0A202" },
                { label: "Global (USD)", icon: "🌎", v: totalGlobal, cor: "#a855f7" },
                { label: "Previdência", icon: "🛡", v: totalPrevidencia, cor: "#f59e0b" },
              ].filter(x => x.v > 0).map(({ label, icon, v, cor }) => (
                <div key={label} style={{
                  ...C.card,
                  background: `linear-gradient(135deg, rgba(${hexToRgb(cor)},0.06), rgba(${hexToRgb(cor)},0.02))`,
                  border: `0.5px solid rgba(${hexToRgb(cor)},0.2)`,
                  padding: "18px 20px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{icon}</span>
                      <span style={{ fontSize: 10, color: cor, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</span>
                    </div>
                    <span style={{ fontSize: 10, color: T.textMuted }}>{total > 0 ? Math.round((v / total) * 100) : 0}%</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 300, color: cor, letterSpacing: "-0.01em" }}>{brl(v)}</div>
                  <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden", marginTop: 12 }}>
                    <div style={{ height: "100%", width: `${total > 0 ? (v / total) * 100 : 0}%`, background: cor }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── RESERVA DE EMERGÊNCIA ── */}
        <SectionTitle>Reserva de Emergência</SectionTitle>
        <div className="pi-card-reserva" style={{ ...C.card, padding: "20px 22px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 14 }}>
            <div style={{ display: "flex", gap: 14, flex: 1, minWidth: 0 }}>
              {/* Ícone escudo — reforça "isto é proteção" */}
              <div style={{
                flexShrink: 0,
                width: 44, height: 44,
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(96,165,250,0.06))",
                border: "0.5px solid rgba(96,165,250,0.35)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22,
              }}>🛡️</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>
                  Liquidez disponível D+1
                  {liquidezObj > 0 && <span style={{ marginLeft: 8, fontSize: 8, background: "rgba(34,197,94,0.12)", border: "0.5px solid rgba(34,197,94,0.3)", borderRadius: 4, padding: "2px 6px", color: T.success }}>via ativos</span>}
                </div>
                <div style={{ fontSize: 26, fontWeight: 300, color: "#60a5fa", letterSpacing: "-0.01em" }}>{brl(liquidezD1)}</div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{total > 0 ? Math.round((liquidezD1 / total) * 100) : 0}% do patrimônio total</div>
              </div>
            </div>
            {reservaMeta > 0 && (
              <div style={{ textAlign: "right", ...noSel }}>
                <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>Meta (6 meses)</div>
                <div style={{ fontSize: 14, color: T.textSecondary }}>{brl(reservaMeta)}</div>
                <div style={{
                  marginTop: 8, display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 500,
                  background: liquidezOk ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.1)",
                  color: liquidezOk ? T.success : T.danger,
                  border: `0.5px solid ${liquidezOk ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                }}>
                  {liquidezOk ? "✓ Meta atingida" : "✗ Abaixo da meta"}
                </div>
              </div>
            )}
          </div>
          {reservaMeta > 0 && (
            <>
              <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (liquidezD1 / reservaMeta) * 100)}%`,
                  background: liquidezOk
                    ? "linear-gradient(90deg, rgba(34,197,94,0.6), rgba(34,197,94,0.9))"
                    : "linear-gradient(90deg, rgba(96,165,250,0.6), rgba(96,165,250,0.9))",
                  transition: "width 0.4s",
                }} />
              </div>
              {!liquidezOk && liquidezD1 >= 0 && (
                <div style={{ fontSize: 10, color: "#f87171", marginTop: 8, ...noSel }}>
                  Faltam {brl(reservaMeta - liquidezD1)} para a reserva completa
                </div>
              )}
            </>
          )}
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 12, lineHeight: 1.6, ...noSel }}>
            {liquidezObj > 0
              ? 'Calculado a partir dos ativos com objetivo "Liquidez" definido.'
              : "Calculado pela soma de Renda Fixa Pós, IPCA+ e Pré. Marque ativos como \"Liquidez\" para personalizar."}
          </div>
        </div>

        {/* ── VÍNCULO COM OBJETIVOS ── */}
        {Object.keys(vinculoObjetivos).length > 0 && (
          <>
            <SectionTitle action={<button onClick={() => navigate(`/cliente/${id}/objetivos`)} style={linkBtnStyle}>ir para objetivos →</button>}>
              Ativos Vinculados a Objetivos
            </SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12, marginBottom: 22 }}>
              {Object.values(vinculoObjetivos).map((obj) => {
                const p = total > 0 ? Math.round((obj.total / total) * 100) : 0;
                return (
                  <div key={obj.label} className="pi-card-objetivo" style={{
                    ...C.card,
                    padding: "14px 16px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 12 }}>🎯</span>
                      <div style={{ fontSize: 10, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.12em", ...noSel }}>
                        {obj.label}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: T.textPrimary }}>{brl(obj.total)}</div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4, ...noSel }}>
                      {obj.qtd} ativo{obj.qtd > 1 ? "s" : ""} · {p}% do patrimônio
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── APORTES ── */}
        <SectionTitle>Histórico de Aportes</SectionTitle>
        <div style={{ ...C.card, padding: 0, overflow: "hidden", marginBottom: 22 }}>
          {/* Stats row + ação principal */}
          <div style={{
            padding: "20px 24px",
            borderBottom: `0.5px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 20, flex: 1, minWidth: 0 }}>
              <div>
                <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>Total aportado</div>
                <div style={{ fontSize: 18, color: "#a855f7", fontWeight: 500, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{brl(aporteTotal)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>Média por aporte</div>
                <div style={{ fontSize: 18, color: "#c084fc", fontWeight: 500, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{brl(aporteMedio)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>Aporte {mesAtualStr()}</div>
                <div style={{ fontSize: 18, color: aporteMesAtual > 0 ? T.gold : T.textMuted, fontWeight: 500, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
                  {aporteMesAtual > 0 ? brl(aporteMesAtual) : "—"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setAporteModal(true)}
              style={{
                padding: "12px 20px",
                background: "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(168,85,247,0.1))",
                border: "0.5px solid rgba(168,85,247,0.45)",
                borderRadius: T.radiusMd,
                color: "#c084fc", fontSize: 12, cursor: "pointer",
                fontFamily: T.fontFamily, letterSpacing: "0.1em", textTransform: "uppercase",
                fontWeight: 600,
                display: "flex", alignItems: "center", gap: 8,
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(168,85,247,0.3), rgba(168,85,247,0.18))"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(168,85,247,0.1))"; }}
            >
              <span style={{ fontSize: 16, fontWeight: 400 }}>+</span>
              Aporte {mesAtualStr()}
            </button>
          </div>

          {aportesHistorico.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", color: T.textMuted, fontSize: 13, ...noSel }}>
              Nenhum aporte registrado. Use o botão <strong style={{ color: "#c084fc" }}>+ Aporte {mesAtualStr()}</strong> acima para começar.
            </div>
          ) : (
            <>
              <div className="pi-scroll-x" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <div style={{ minWidth: 340 }}>
              <div style={{
                display: "grid", gridTemplateColumns: "110px 1fr 140px 40px",
                padding: "12px 24px", borderBottom: `0.5px solid ${T.border}`,
                fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", ...noSel,
                background: "rgba(255,255,255,0.015)",
              }}>
                <div>Data</div>
                <div>Observação</div>
                <div style={{ textAlign: "right" }}>Valor</div>
                <div />
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {aportesHistorico.slice(0, 20).map((a) => {
                  const d = a.data ? new Date(a.data) : null;
                  return (
                    <div key={a.id} style={{
                      display: "grid", gridTemplateColumns: "110px 1fr 140px 40px",
                      padding: "14px 24px", borderBottom: `0.5px solid ${T.border}`,
                      alignItems: "center", gap: 12,
                    }}>
                      <div style={{ fontSize: 12, color: T.textSecondary, fontVariantNumeric: "tabular-nums" }}>
                        {d ? d.toLocaleDateString("pt-BR") : "—"}
                      </div>
                      <div style={{ fontSize: 12, color: T.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.observacao || <span style={{ color: T.textMuted, fontStyle: "italic" }}>sem observação</span>}
                      </div>
                      <div style={{ fontSize: 14, color: T.gold, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        + {brl(parseCentavos(a.valor) / 100)}
                      </div>
                      <button
                        onClick={() => removerAporte(a.id)}
                        style={{
                          background: "none", border: "none", color: T.textMuted, cursor: "pointer",
                          fontSize: 16, padding: 4, borderRadius: 4,
                        }}
                        title="Remover aporte"
                        onMouseEnter={(e) => { e.currentTarget.style.color = T.danger; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.background = "none"; }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
              </div>{/* end minWidth wrapper */}
              </div>{/* end overflowX wrapper */}
            </>
          )}
        </div>

        {/* ── AÇÃO FINAL ── */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            onClick={isEditing ? salvar : () => setIsEditing(true)}
            disabled={salvando}
            style={{
              flex: 1,
              padding: 16,
              background: "linear-gradient(135deg, rgba(240,162,2,0.15), rgba(240,162,2,0.08))",
              border: "0.5px solid rgba(240,162,2,0.4)",
              borderRadius: T.radiusMd,
              color: T.gold,
              fontSize: 12,
              cursor: salvando ? "wait" : "pointer",
              fontFamily: T.fontFamily,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {salvando ? "Salvando..." : isEditing ? "💾 Salvar & Sincronizar" : "✎ Editar Carteira"}
          </button>
          <button
            onClick={() => { setLimparInput(""); setLimparModal(true); }}
            disabled={salvando || limpando}
            title="Apaga todos os ativos e zera o patrimônio financeiro"
            style={{
              padding: "16px 22px",
              background: "rgba(239,68,68,0.06)",
              border: "0.5px solid rgba(239,68,68,0.35)",
              borderRadius: T.radiusMd,
              color: "#ef4444",
              fontSize: 12,
              cursor: (salvando || limpando) ? "not-allowed" : "pointer",
              fontFamily: T.fontFamily,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            🗑 Apagar Ativos
          </button>
        </div>

        <div style={{ fontSize: 10, color: T.textMuted, textAlign: "center", marginTop: 18, ...noSel }}>
          {isEditing
            ? "Os valores são propagados automaticamente para Dashboard, Objetivos e Ficha do Cliente ao salvar."
            : "Clique em Editar para modificar a carteira. Alterações são propagadas ao salvar."}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-COMPONENTES
// ══════════════════════════════════════════════════════════════
const linkBtnStyle = {
  background: "none",
  border: "none",
  color: T.gold,
  fontSize: 10,
  cursor: "pointer",
  fontFamily: T.fontFamily,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

function SectionTitle({ children, action }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginTop: 12, marginBottom: 16,
    }}>
      <div style={{
        fontSize: 14, color: T.textSecondary, textTransform: "uppercase", letterSpacing: "0.14em",
        fontWeight: 500,
        display: "flex", alignItems: "center", gap: 12, ...noSel,
      }}>
        <div style={{ width: 32, height: 2, background: T.gold, opacity: 0.8, borderRadius: 1 }} />
        {children}
      </div>
      {action}
    </div>
  );
}

function KPI({ label, value, color = T.textPrimary, large, size = "md", flex }) {
  // Ajuste automático de fonte: quanto mais longo o texto, menor a fonte,
  // para garantir que o valor sempre caiba dentro do card sem truncar.
  const valStr = String(value || "");
  const len = valStr.length;
  // tamanho base por "size": xl=destaque, md=padrão, sm=compacto
  const sizeMap = { xl: 18, md: 15, sm: 13 };
  const baseSize = large ? 18 : (sizeMap[size] || 15);
  const auto = len > 13 ? baseSize - 3
             : len > 10 ? baseSize - 1
             : baseSize;
  const padX = size === "sm" ? 10 : 13;
  const padY = 11;
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: `0.5px solid ${T.border}`,
      borderRadius: T.radiusMd,
      padding: `${padY}px ${padX}px`,
      position: "relative",
      minWidth: 0,
      overflow: "hidden",
      flex: flex || undefined,
    }}>
      <div style={{ fontSize: 8.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5, ...noSel }}>{label}</div>
      <div style={{
        fontSize: auto,
        fontWeight: 400,
        color,
        letterSpacing: "-0.01em",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>{value}</div>
    </div>
  );
}

function Mini({ label, value, cor }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>{label}</div>
      <div style={{ fontSize: 14, color: cor, fontWeight: 400 }}>{value}</div>
    </div>
  );
}

function BackFab({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="floating-nav-btn is-left"
      aria-label="Voltar"
    >←</button>
  );
}

// ══════════════════════════════════════════════════════════════
// DRILL-DOWN DE CLASSE (painel lateral full-height — paleta refinada)
// ══════════════════════════════════════════════════════════════
function ClasseDrilldown({ classe, ativos, total, totalCarteira, onClose, onAddAtivo, onEditAtivo, onRemoveAtivo, onLimparClasse }) {
  const [confirmLimpar, setConfirmLimpar] = useState(false);
  const p = totalCarteira > 0 ? Math.round((total / totalCarteira) * 100) : 0;
  const ativosComRent = ativos.filter((a) => parseFloat(String(a.rentAno).replace(",", ".")));
  const somaRent = ativosComRent.reduce((acc, a) => acc + parseCentavos(a.valor) / 100, 0);
  const rentMedia = somaRent > 0
    ? ativosComRent.reduce((acc, a) => acc + parseFloat(String(a.rentAno).replace(",", ".")) * parseCentavos(a.valor) / 100, 0) / somaRent
    : null;

  // Mantém o índice original (necessário p/ editar/remover) ao agrupar
  const indexed = ativos.map((a, idx) => ({ a, idx }));
  const semObjetivo = indexed.filter(({ a }) => !a.objetivo);
  const comObjetivo = indexed.filter(({ a }) => !!a.objetivo);

  // Cartão neutro de ativo, para reduzir ruído visual
  const renderAtivo = ({ a, idx }) => {
    const valor = parseCentavos(a.valor) / 100;
    const pAtivo = total > 0 ? (valor / total) * 100 : 0;
    const temObjetivo = !!a.objetivo;
    return (
      <div key={a.id || idx} style={{
        background: T.bgSecondary,
        border: `0.5px solid ${T.border}`,
        borderRadius: T.radiusMd,
        padding: "16px 18px",
        transition: "border-color 0.2s, background 0.2s",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.goldBorder; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: T.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "0.01em" }}>
              {a.nome || <span style={{ color: T.textMuted, fontStyle: "italic" }}>Ativo sem nome</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
              {temObjetivo ? (
                <NeutralChip>🎯 {a.objetivo}</NeutralChip>
              ) : (
                <span
                  onClick={() => onEditAtivo(idx)}
                  style={{
                    fontSize: 10, color: T.gold, background: "transparent",
                    border: `0.5px dashed ${T.goldBorder}`, borderRadius: 6,
                    padding: "3px 9px", letterSpacing: "0.04em", cursor: "pointer", ...noSel,
                  }}
                >+ definir objetivo</span>
              )}
              {a.segmento && <NeutralChip>{a.segmento}</NeutralChip>}
              {a.vencimento && <NeutralChip muted>venc {a.vencimento}</NeutralChip>}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 15, color: T.textPrimary, fontWeight: 500, fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" }}>{brl(valor)}</div>
            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3, letterSpacing: "0.04em" }}>{pAtivo.toFixed(1)}% da classe</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${T.border}`, alignItems: "center" }}>
          {a.rentMes && (
            <div>
              <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Rent. mês</div>
              <div style={{ fontSize: 12, color: parseFloat(String(a.rentMes).replace(",", ".")) >= 0 ? T.success : T.danger, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{a.rentMes}%</div>
            </div>
          )}
          {a.rentAno && (
            <div>
              <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Rent. ano</div>
              <div style={{ fontSize: 12, color: parseFloat(String(a.rentAno).replace(",", ".")) >= 0 ? T.success : T.danger, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{a.rentAno}%</div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => onEditAtivo(idx)}
            style={{
              fontSize: 10, color: T.gold, background: T.goldDim,
              border: `0.5px solid ${T.goldBorder}`,
              borderRadius: T.radiusSm, padding: "6px 14px", cursor: "pointer",
              letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: T.fontFamily,
              fontWeight: 500,
            }}
          >Editar</button>
          <button
            onClick={() => onRemoveAtivo(idx)}
            style={{
              fontSize: 10, color: T.textMuted, background: "transparent",
              border: `0.5px solid ${T.border}`,
              borderRadius: T.radiusSm, padding: "6px 12px", cursor: "pointer",
              letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: T.fontFamily,
              transition: "color 0.2s, border-color 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = T.danger; e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
          >Remover</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 600,
      display: "flex", justifyContent: "flex-end",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600, maxWidth: "96vw", height: "100%",
          background: T.bg,
          borderLeft: `0.5px solid ${T.border}`,
          display: "flex", flexDirection: "column",
          animation: "slideIn 0.25s ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header — limpo, com apenas um traço fino na cor da classe */}
        <div style={{
          padding: "26px 30px",
          background: T.bg,
          borderBottom: `0.5px solid ${T.border}`,
          flexShrink: 0,
          position: "relative",
        }}>
          <div style={{
            position: "absolute", left: 0, top: 26, bottom: 26, width: 3,
            background: classe.cor, borderRadius: "0 2px 2px 0",
          }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 6, ...noSel }}>Classe de ativo</div>
              <div style={{ fontSize: 24, fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.01em" }}>{classe.label}</div>
            </div>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`,
              borderRadius: "50%", width: 34, height: 34, color: T.textSecondary,
              cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: T.fontFamily,
            }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 6, ...noSel }}>Total</div>
              <div style={{ fontSize: 17, color: T.gold, fontWeight: 400, letterSpacing: "0.01em" }}>{brl(total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 6, ...noSel }}>% da carteira</div>
              <div style={{ fontSize: 17, color: T.textPrimary, fontWeight: 300 }}>{p}%</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 6, ...noSel }}>Rent. média a.a.</div>
              <div style={{ fontSize: 17, color: rentMedia !== null ? (rentMedia > 0 ? T.success : T.danger) : T.textMuted, fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
                {rentMedia !== null ? `${rentMedia > 0 ? "+" : ""}${rentMedia.toFixed(2)}%` : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Lista de ativos — agrupada: sem objetivo primeiro, depois com objetivo */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 26px" }}>
          {ativos.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: T.textMuted, fontSize: 13, ...noSel }}>
              Nenhum ativo cadastrado nesta classe.
            </div>
          )}

          {semObjetivo.length > 0 && (
            <div style={{ marginBottom: comObjetivo.length > 0 ? 24 : 0 }}>
              <div style={{
                fontSize: 9, color: T.textMuted, textTransform: "uppercase",
                letterSpacing: "0.16em", marginBottom: 12, fontWeight: 500,
                display: "flex", alignItems: "center", gap: 10, ...noSel,
              }}>
                <span>Sem objetivo vinculado</span>
                <span style={{ color: T.textMuted, opacity: 0.6 }}>·</span>
                <span style={{ color: T.gold }}>{semObjetivo.length}</span>
                <div style={{ flex: 1, height: "0.5px", background: T.border }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {semObjetivo.map(renderAtivo)}
              </div>
            </div>
          )}

          {comObjetivo.length > 0 && (
            <div>
              <div style={{
                fontSize: 9, color: T.textMuted, textTransform: "uppercase",
                letterSpacing: "0.16em", marginBottom: 12, fontWeight: 500,
                display: "flex", alignItems: "center", gap: 10, ...noSel,
              }}>
                <span>Com objetivo vinculado</span>
                <span style={{ color: T.textMuted, opacity: 0.6 }}>·</span>
                <span style={{ color: T.gold }}>{comObjetivo.length}</span>
                <div style={{ flex: 1, height: "0.5px", background: T.border }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {comObjetivo.map(renderAtivo)}
              </div>
            </div>
          )}

          <button
            onClick={onAddAtivo}
            style={{
              width: "100%", marginTop: 18, padding: 16,
              background: T.goldDim,
              border: `1px dashed ${T.goldBorder}`,
              borderRadius: T.radiusMd,
              color: T.gold, fontSize: 12, cursor: "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.14em",
              textTransform: "uppercase", fontWeight: 500,
            }}
          >+ Adicionar ativo a {classe.label}</button>

          {total > 0 && onLimparClasse && (
            <button
              onClick={() => setConfirmLimpar(true)}
              style={{
                width: "100%", marginTop: 10, padding: 14,
                background: "rgba(239,68,68,0.05)",
                border: `0.5px solid rgba(239,68,68,0.3)`,
                borderRadius: T.radiusMd,
                color: "#ef4444", fontSize: 11, cursor: "pointer",
                fontFamily: T.fontFamily, letterSpacing: "0.14em",
                textTransform: "uppercase", fontWeight: 500,
              }}
            >🗑 Limpar classe {classe.label}</button>
          )}
        </div>

        {confirmLimpar && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 800,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          }} onClick={() => setConfirmLimpar(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: T.bgCard, border: `0.5px solid ${T.border}`,
              borderRadius: T.radiusXl, padding: "28px 30px", width: 440, maxWidth: "94vw",
            }}>
              <div style={{ fontSize: 9, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 8 }}>Confirmar</div>
              <div style={{ fontSize: 18, color: T.textPrimary, fontWeight: 300, marginBottom: 12 }}>Limpar classe {classe.label}?</div>
              <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.6, marginBottom: 22 }}>
                Todos os ativos desta classe ({brl(total)}) serão removidos. A alteração só será gravada após clicar em <strong style={{ color: T.gold }}>Salvar</strong> na carteira.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirmLimpar(false)} style={{
                  padding: "10px 18px", background: "transparent", border: `0.5px solid ${T.border}`,
                  borderRadius: T.radiusSm, color: T.textSecondary, fontSize: 11, cursor: "pointer",
                  fontFamily: T.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase",
                }}>Cancelar</button>
                <button onClick={() => { onLimparClasse(); setConfirmLimpar(false); onClose(); }} style={{
                  padding: "10px 18px", background: "rgba(239,68,68,0.1)", border: `0.5px solid rgba(239,68,68,0.4)`,
                  borderRadius: T.radiusSm, color: "#ef4444", fontSize: 11, cursor: "pointer",
                  fontFamily: T.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500,
                }}>Limpar classe</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

// Chip neutro — usado dentro do drilldown para tags (objetivo, segmento, vencimento)
function NeutralChip({ children, muted }) {
  return (
    <span style={{
      fontSize: 10,
      color: muted ? T.textMuted : T.textSecondary,
      background: "rgba(255,255,255,0.03)",
      border: `0.5px solid ${T.border}`,
      borderRadius: 6,
      padding: "3px 9px",
      letterSpacing: "0.04em",
      ...noSel,
    }}>{children}</span>
  );
}

function Tag({ cor, children }) {
  return (
    <span style={{
      fontSize: 9, color: cor, background: `rgba(${hexToRgb(cor)},0.1)`,
      border: `0.5px solid rgba(${hexToRgb(cor)},0.25)`,
      borderRadius: 4, padding: "2px 7px", letterSpacing: "0.03em",
      ...noSel,
    }}>{children}</span>
  );
}

// ══════════════════════════════════════════════════════════════
// EDITOR DE ATIVO (modal grande e refinado: classe, objetivo, segmento)
// ══════════════════════════════════════════════════════════════
function AtivoEditor({ ctx, snap, onClose, onUpdate, onMove }) {
  const { classKey, idx } = ctx;
  const ativo = (snap[classKey + "Ativos"] || [])[idx] || {};
  const classe = classByKey[classKey];
  const [form, setForm] = useState({
    nome: ativo.nome || "",
    valor: ativo.valor || "",
    objetivo: ativo.objetivo || "",
    vencimento: ativo.vencimento || "",
    rentMes: ativo.rentMes || "",
    rentAno: ativo.rentAno || "",
    segmento: ativo.segmento || "",
    novaClasse: classKey,
  });
  const [confirmObjetivo, setConfirmObjetivo] = useState(null); // { from, to }
  const objetivoOriginal = ativo.objetivo || "";

  const classesOptions = CLASSES.filter((c) => !c.legado).map((c) => ({ value: c.key, label: c.label }));
  const segOpts = form.novaClasse === "acoes" ? SEGMENTOS.acoes : form.novaClasse === "fiis" ? SEGMENTOS.fiis : null;

  function setF(k, v) { setForm((p) => ({ ...p, [k]: v })); }

  function handleObjetivoChange(novoValor) {
    // Se já existe um objetivo previamente cadastrado e o usuário escolheu outro diferente,
    // pedir confirmação antes de aplicar a troca.
    if (objetivoOriginal && novoValor && novoValor !== objetivoOriginal && novoValor !== form.objetivo) {
      setConfirmObjetivo({ from: objetivoOriginal, to: novoValor });
      return;
    }
    // Se está limpando um objetivo previamente cadastrado, também confirmar
    if (objetivoOriginal && !novoValor) {
      setConfirmObjetivo({ from: objetivoOriginal, to: "" });
      return;
    }
    setF("objetivo", novoValor);
  }

  function confirmarTrocaObjetivo() {
    setF("objetivo", confirmObjetivo.to);
    setConfirmObjetivo(null);
  }

  function handleSave() {
    if (form.novaClasse !== classKey) {
      onUpdate({ nome: form.nome, valor: form.valor, objetivo: form.objetivo, vencimento: form.vencimento, rentMes: form.rentMes, rentAno: form.rentAno, segmento: form.segmento });
      setTimeout(() => onMove(form.novaClasse, form.segmento), 50);
    } else {
      onUpdate({ nome: form.nome, valor: form.valor, objetivo: form.objetivo, vencimento: form.vencimento, rentMes: form.rentMes, rentAno: form.rentAno, segmento: form.segmento });
      onClose();
    }
  }

  // Ordenação dos objetivos no select: lista padrão
  const objetivosOrdenados = OBJETIVOS;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bgCard,
          border: `0.5px solid ${T.border}`,
          borderRadius: T.radiusXl,
          width: 760, maxWidth: "96vw",
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: T.shadowLg,
          animation: "editorIn 0.22s ease-out",
        }}>
        {/* Header com traço fino na cor da classe */}
        <div style={{
          padding: "26px 32px 22px",
          borderBottom: `0.5px solid ${T.border}`,
          position: "relative",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
        }}>
          <div style={{
            position: "absolute", left: 0, top: 26, bottom: 22, width: 3,
            background: classe.cor, borderRadius: "0 2px 2px 0",
          }} />
          <div>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 6, ...noSel }}>
              {idx === undefined ? "Novo ativo" : "Editar ativo"}
            </div>
            <div style={{ fontSize: 24, fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.01em" }}>
              {form.nome || classe.label}
            </div>
            {form.nome && (
              <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 4, letterSpacing: "0.02em" }}>
                {classe.label}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`,
            borderRadius: "50%", width: 36, height: 36, color: T.textSecondary,
            cursor: "pointer", fontSize: 18, fontFamily: T.fontFamily,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>×</button>
        </div>

        <div style={{ padding: "26px 32px 28px", display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Bloco 1: identificação */}
          <div>
            <SectionHeader>Identificação</SectionHeader>
            <div>
              <div style={{ ...C.label, fontSize: 11 }}>Nome do ativo</div>
              <InputTexto initValue={form.nome} onCommit={(v) => setF("nome", v)} placeholder="Ex: CDB Itaú IPCA+ 2030" size="lg" />
            </div>
          </div>

          {/* Bloco 2: valor & datas */}
          <div>
            <SectionHeader>Valor & prazo</SectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Valor investido</div>
                <InputMoeda initValue={form.valor} onCommit={(v) => setF("valor", v)} size="lg" />
              </div>
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Vencimento (opcional)</div>
                <InputTexto initValue={form.vencimento} onCommit={(v) => setF("vencimento", v)} placeholder="DD/MM/AAAA" size="lg" />
              </div>
            </div>
          </div>

          {/* Bloco 3: rentabilidade */}
          <div>
            <SectionHeader>Rentabilidade</SectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Rentabilidade no mês (%)</div>
                <InputPctLg initValue={form.rentMes} onCommit={(v) => setF("rentMes", v)} placeholder="0,85" />
              </div>
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Rentabilidade no ano (%)</div>
                <InputPctLg initValue={form.rentAno} onCommit={(v) => setF("rentAno", v)} placeholder="12,5" />
              </div>
            </div>
          </div>

          {/* Bloco 4: classificação */}
          <div style={{
            padding: "20px 22px",
            background: T.bgSecondary,
            border: `0.5px solid ${T.border}`,
            borderRadius: T.radiusLg,
          }}>
            <SectionHeader>Classificação & vínculo com objetivo</SectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: segOpts ? 14 : 0 }}>
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Classe do ativo</div>
                <SelectLg value={form.novaClasse} onChange={(v) => setF("novaClasse", v)} options={classesOptions} />
                {form.novaClasse !== classKey && (
                  <div style={{
                    fontSize: 11, color: T.gold, marginTop: 8, ...noSel,
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 10px", background: T.goldDim,
                    border: `0.5px solid ${T.goldBorder}`, borderRadius: T.radiusSm,
                  }}>
                    <span>⚠</span>
                    <span>Ativo será movido para {classByKey[form.novaClasse]?.label}</span>
                  </div>
                )}
              </div>
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Objetivo (liga ao planejamento)</div>
                <SelectLg value={form.objetivo} onChange={handleObjetivoChange} options={objetivosOrdenados} placeholder="sem objetivo" />
                {objetivoOriginal && form.objetivo === objetivoOriginal && (
                  <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6, ...noSel }}>
                    Vinculado a <span style={{ color: T.gold }}>{objetivoOriginal}</span>
                  </div>
                )}
              </div>
            </div>
            {segOpts && (
              <div>
                <div style={{ ...C.label, fontSize: 11 }}>Segmento</div>
                <SelectLg value={form.segmento} onChange={(v) => setF("segmento", v)} options={segOpts} placeholder="sem segmento" />
              </div>
            )}
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 14, lineHeight: 1.6, ...noSel, letterSpacing: "0.01em" }}>
              Ao definir o objetivo, o ativo é automaticamente vinculado ao planejamento financeiro do cliente.
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <button onClick={onClose} style={{
              flex: 1, padding: "14px 16px", background: "rgba(255,255,255,0.04)",
              border: `0.5px solid ${T.border}`, borderRadius: T.radiusMd,
              color: T.textSecondary, fontSize: 12, cursor: "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.16em", textTransform: "uppercase",
            }}>Cancelar</button>
            <button onClick={handleSave} style={{
              flex: 1.6, padding: "14px 16px",
              background: T.goldDim,
              border: `1px solid ${T.goldBorder}`,
              borderRadius: T.radiusMd,
              color: T.gold, fontSize: 12, cursor: "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.16em", textTransform: "uppercase",
              fontWeight: 500,
            }}>Salvar alterações</button>
          </div>
        </div>
      </div>

      {/* Confirmação de troca de objetivo */}
      {confirmObjetivo && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onClick={() => setConfirmObjetivo(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: T.bgCard, border: `0.5px solid ${T.border}`, borderRadius: T.radiusLg,
              width: 460, maxWidth: "96vw", padding: "26px 28px 22px",
              boxShadow: T.shadowLg,
            }}
          >
            <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 8, ...noSel }}>
              Confirmar alteração
            </div>
            <div style={{ fontSize: 18, color: T.textPrimary, fontWeight: 400, marginBottom: 14, letterSpacing: "-0.01em" }}>
              {confirmObjetivo.to ? "Redirecionar este ativo?" : "Remover vínculo do ativo?"}
            </div>
            <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.7, marginBottom: 22 }}>
              <strong style={{ color: T.textPrimary }}>{form.nome || "Este ativo"}</strong> está atualmente vinculado a{" "}
              <strong style={{ color: T.gold }}>"{confirmObjetivo.from}"</strong>.
              {confirmObjetivo.to ? (
                <> Deseja redirecioná-lo para <strong style={{ color: T.gold }}>"{confirmObjetivo.to}"</strong>?</>
              ) : (
                <> Deseja remover o vínculo com este objetivo?</>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmObjetivo(null)} style={{
                padding: "11px 20px", background: "transparent", border: `0.5px solid ${T.border}`,
                borderRadius: T.radiusMd, color: T.textSecondary, fontSize: 11, cursor: "pointer",
                fontFamily: T.fontFamily, letterSpacing: "0.14em", textTransform: "uppercase",
              }}>Não</button>
              <button onClick={confirmarTrocaObjetivo} style={{
                padding: "11px 22px", background: T.goldDim, border: `1px solid ${T.goldBorder}`,
                borderRadius: T.radiusMd, color: T.gold, fontSize: 11, cursor: "pointer",
                fontFamily: T.fontFamily, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600,
              }}>Sim, confirmar</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes editorIn { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>
  );
}

// Helpers visuais p/ AtivoEditor (legibilidade)
function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.18em",
      marginBottom: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 10, ...noSel,
    }}>
      <div style={{ width: 18, height: 1, background: T.goldBorder }} />
      {children}
    </div>
  );
}

function SelectLg({ value, onChange, options, placeholder = "—" }) {
  const optStyle = { background: T.bgCard, color: T.textPrimary };
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        background: "rgba(255,255,255,0.04)",
        border: `0.5px solid ${T.border}`,
        borderRadius: T.radiusMd,
        color: T.textPrimary,
        fontSize: 14,
        padding: "13px 16px",
        fontFamily: T.fontFamily,
        cursor: "pointer",
        outline: "none",
        appearance: "none",
        letterSpacing: "0.01em",
        colorScheme: "dark",
      }}
    >
      <option value="" style={{ ...optStyle, color: T.textMuted }}>{placeholder}</option>
      {options.map((o) => (
        <option
          key={typeof o === "string" ? o : o.value}
          value={typeof o === "string" ? o : o.value}
          style={optStyle}
        >
          {typeof o === "string" ? o : o.label}
        </option>
      ))}
    </select>
  );
}

const InputPctLg = memo(function InputPctLg({ initValue, onCommit, placeholder = "0,00%" }) {
  const [val, setVal] = useState(initValue || "");
  return (
    <input
      style={{ ...C.input, fontSize: 14, padding: "13px 16px" }}
      placeholder={placeholder}
      value={val}
      onChange={(e) => { setVal(e.target.value); onCommit(e.target.value); }}
    />
  );
});

// ══════════════════════════════════════════════════════════════
// MODAL DE APORTE
// ══════════════════════════════════════════════════════════════
function LimparCarteiraModal({ nomeCliente, total, input, setInput, limpando, onClose, onConfirm }) {
  const nomeAlvo = (nomeCliente || "").trim();
  const primeiroNome = nomeAlvo.split(/\s+/)[0] || "";
  const tx = input.trim().toLowerCase();
  const confirmado = (primeiroNome.length > 0 && tx === primeiroNome.toLowerCase()) || tx === "22";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 800,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    }} onClick={limpando ? undefined : onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bgCard, border: "0.5px solid rgba(239,68,68,0.35)",
          borderRadius: T.radiusLg, padding: 24, width: 460, maxWidth: "95vw",
          boxShadow: T.shadowLg,
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ fontSize: 16, fontWeight: 500, color: "#ef4444" }}>Apagar todos os ativos da carteira</div>
        </div>
        <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.65, marginBottom: 14 }}>
          Esta ação irá remover <strong style={{ color: "#ef4444" }}>todos os ativos</strong> da carteira de{" "}
          <strong style={{ color: T.gold }}>{nomeAlvo || "—"}</strong>, zerar os totais de cada classe e
          atualizar o <strong>patrimônio financeiro para R$ 0,00</strong> na hora.
        </div>
        {total > 0 && (
          <div style={{
            padding: "10px 12px", background: "rgba(239,68,68,0.06)",
            border: "0.5px solid rgba(239,68,68,0.25)", borderRadius: T.radiusSm,
            fontSize: 11, color: "#fca5a5", marginBottom: 14,
          }}>
            Valor atual da carteira: <strong>{brl(total)}</strong>. Tudo será zerado.
          </div>
        )}
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>
          Para confirmar, digite <strong style={{ color: T.textSecondary }}>{primeiroNome || "—"}</strong> ou <strong style={{ color: T.textSecondary }}>22</strong>:
        </div>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={limpando}
          placeholder={primeiroNome || "22"}
          style={{
            width: "100%", padding: "10px 12px",
            background: "rgba(255,255,255,0.03)",
            border: `0.5px solid ${T.border}`,
            borderRadius: T.radiusSm,
            color: T.textPrimary, fontSize: 12, fontFamily: T.fontFamily,
            outline: "none", marginBottom: 16,
          }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={limpando}
            style={{
              flex: 1, padding: 11,
              background: "rgba(255,255,255,0.04)",
              border: `0.5px solid ${T.border}`,
              borderRadius: 9, color: T.textSecondary,
              fontSize: 11, cursor: limpando ? "not-allowed" : "pointer",
              fontFamily: T.fontFamily,
            }}
          >Cancelar</button>
          <button
            onClick={onConfirm}
            disabled={limpando || !confirmado}
            style={{
              flex: 1, padding: 11,
              background: confirmado ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.05)",
              border: "0.5px solid rgba(239,68,68,0.45)",
              borderRadius: 9, color: "#ef4444",
              fontSize: 11, cursor: (limpando || !confirmado) ? "not-allowed" : "pointer",
              fontFamily: T.fontFamily, fontWeight: 600,
              opacity: limpando ? 0.5 : 1,
            }}
          >{limpando ? "Apagando..." : "Apagar permanentemente"}</button>
        </div>
      </div>
    </div>
  );
}

function AporteModal({ onClose, onSave }) {
  const [valor, setValor] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [observacao, setObservacao] = useState("");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bgCard, border: `0.5px solid rgba(168,85,247,0.3)`,
          borderRadius: T.radiusLg, padding: 24, width: 440, maxWidth: "95vw",
          boxShadow: T.shadowLg,
        }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: "#a855f7", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 4 }}>+ Aporte</div>
            <div style={{ fontSize: 17, fontWeight: 400, color: T.textPrimary }}>Registrar aporte mensal</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`,
            borderRadius: "50%", width: 30, height: 30, color: T.textSecondary,
            cursor: "pointer", fontSize: 14,
          }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ ...C.label }}>Valor do aporte</div>
            <InputMoeda initValue={valor} onCommit={setValor} size="lg" />
          </div>
          <div>
            <div style={{ ...C.label }}>Data</div>
            <InputDate initValue={data} onCommit={setData} />
          </div>
          <div>
            <div style={{ ...C.label }}>Observação (opcional)</div>
            <InputTexto initValue={observacao} onCommit={setObservacao} placeholder="Ex: salário, 13º, venda de imóvel..." />
          </div>

          <div style={{
            padding: "10px 12px", background: "rgba(168,85,247,0.06)",
            border: "0.5px solid rgba(168,85,247,0.2)", borderRadius: T.radiusSm,
            fontSize: 10, color: "#c084fc", lineHeight: 1.6, ...noSel,
          }}>
            💡 O aporte será registrado no histórico e automaticamente refletido no dashboard do cliente.
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onClose} style={{
              flex: 1, padding: 12, background: "rgba(255,255,255,0.04)",
              border: `0.5px solid ${T.border}`, borderRadius: T.radiusMd,
              color: T.textSecondary, fontSize: 11, cursor: "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase",
            }}>Cancelar</button>
            <button onClick={() => onSave({ valor, data, observacao })} style={{
              flex: 1.5, padding: 12,
              background: "rgba(168,85,247,0.15)",
              border: "0.5px solid rgba(168,85,247,0.4)",
              borderRadius: T.radiusMd,
              color: "#c084fc", fontSize: 11, cursor: "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase",
              fontWeight: 500,
            }}>Registrar aporte</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// RESUMO DE RELATÓRIO IMPORTADO (XP/similar)
// ══════════════════════════════════════════════════════════════
function RelatorioModal({ meta, onClose }) {
  // Formata o mês de referência (ex.: "2026-04" → "Abril / 2026")
  let mesLabel = "";
  if (meta._mesRef) {
    const labels = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const [yyyy, mm] = meta._mesRef.split("-");
    mesLabel = `${labels[parseInt(mm) - 1] || mm} / ${yyyy}`;
  }
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 610,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: T.bgCard, border: "0.5px solid rgba(240,162,2,0.25)",
        borderRadius: T.radiusLg, padding: "24px 22px", width: 440, maxWidth: "100%",
      }}>
        <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 4, ...noSel }}>Relatório salvo</div>
        <div style={{ fontSize: 17, fontWeight: 300, color: T.textPrimary, marginBottom: 4, ...noSel }}>Carteira de Investimentos</div>
        {mesLabel && (
          <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16, ...noSel }}>
            Vinculado a <strong style={{ color: T.gold }}>{mesLabel}</strong>
            {meta._dataRef && <span style={{ opacity: 0.6 }}> · Data de Referência {meta._dataRef}</span>}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {meta._patrimonioTotal > 0 && <MetaRow label="Patrimônio Total Bruto" val={brl(meta._patrimonioTotal / 100)} cor={T.gold} />}
          {meta._rentMes && <MetaRow label="Rentabilidade no mês" val={`${meta._rentMes}%`} cor={T.success} />}
          {meta._rentAno && <MetaRow label="Rentabilidade no ano" val={`${meta._rentAno}%`} cor={T.success} />}
          {meta._rent12m && <MetaRow label="Rentabilidade 12 meses (composta)" val={`${meta._rent12m}%`} cor="#4ade80" />}
          {meta._ganhoMes > 0 && <MetaRow label="Ganho no mês" val={brl(meta._ganhoMes / 100)} cor="#4ade80" />}
          {meta._rendimentosPassivos > 0 && <MetaRow label="Renda Passiva (div/juros/amort.)" val={brl(meta._rendimentosPassivos / 100)} cor="#60a5fa" />}
          {meta._aportes > 0 && <MetaRow label="Aportes recebidos" val={brl(meta._aportes / 100)} cor="#a855f7" />}
          {meta._movExtraidas > 0 && <MetaRow label="Movimentações extraídas" val={`${meta._movExtraidas}`} cor="#94a3b8" />}
          {meta._movDiff > 0 && <MetaRow label="Compras/vendas detectadas" val={`${meta._movDiff}`} cor="#f59e0b" />}
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 14, lineHeight: 1.6, ...noSel }}>
          Snapshot salvo · Acompanhamento dos objetivos atualizado · Movimentações consolidadas no Extrato.
        </div>
        <button onClick={onClose} style={{
          width: "100%", padding: 11, background: "rgba(240,162,2,0.1)",
          border: "0.5px solid rgba(240,162,2,0.35)", borderRadius: T.radiusSm,
          color: T.gold, fontSize: 11, cursor: "pointer", fontFamily: T.fontFamily,
          letterSpacing: "0.12em", textTransform: "uppercase",
        }}>Entendi, vou revisar a carteira</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL: Qual mês vincular?
// Mostrado ANTES de salvar — sugere o mês da data de referência do PDF
// e deixa o usuário ajustar se necessário.
// ══════════════════════════════════════════════════════════════
function MesVinculoModal({ dados, salvando, onConfirm, onCancel }) {
  // Mês sugerido: data de referência do PDF > mês atual
  const sugerido = dados?._mesReferencia || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const [mesEscolhido, setMesEscolhido] = useState(sugerido);
  const dataRef = dados?._dataReferencia;
  const patrim = dados?._patrimonioTotal;
  const rentMes = dados?._rentMes;
  const rentAno = dados?._rentAno;
  const rent12m = dados?._rent12m;
  const qtdAtivos = Object.keys(dados || {})
    .filter((k) => k.endsWith("Ativos"))
    .reduce((acc, k) => acc + (dados[k]?.length || 0), 0);
  const qtdMovs = dados?._movimentacoes?.length || 0;

  const labels = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const fmtMes = (mesRef) => {
    if (!mesRef) return "";
    const [yyyy, mm] = mesRef.split("-");
    return `${labels[parseInt(mm) - 1] || mm} de ${yyyy}`;
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 620,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: T.bgCard, border: "0.5px solid rgba(240,162,2,0.35)",
        borderRadius: T.radiusLg, padding: "26px 24px", width: 480, maxWidth: "100%",
      }}>
        <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 6, ...noSel }}>
          Extração concluída
        </div>
        <div style={{ fontSize: 18, fontWeight: 300, color: T.textPrimary, marginBottom: 4, ...noSel }}>
          A qual mês vincular este relatório?
        </div>
        <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.6, marginBottom: 18, ...noSel }}>
          {dataRef
            ? <>Detectamos <strong style={{ color: T.gold }}>Data de Referência {dataRef}</strong> na primeira página. Confirme ou ajuste o mês antes de salvar.</>
            : "Escolha o mês que este relatório representa."}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", display: "block", marginBottom: 8, ...noSel }}>
            Mês vinculado
          </label>
          <input
            type="month"
            value={mesEscolhido}
            onChange={(e) => setMesEscolhido(e.target.value)}
            style={{
              width: "100%", ...C.input, fontSize: 14, padding: "12px 14px", colorScheme: "dark",
            }}
          />
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6, ...noSel }}>
            Será salvo como snapshot de <strong style={{ color: T.textSecondary }}>{fmtMes(mesEscolhido)}</strong>.
          </div>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.03)", border: `0.5px solid ${T.border}`,
          borderRadius: 10, padding: "12px 14px", marginBottom: 18,
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, ...noSel }}>Resumo detectado</div>
          {patrim > 0 && <ResumoLinha label="Patrimônio" val={brl(patrim / 100)} />}
          {rentMes && <ResumoLinha label="Rentab. mês" val={`${rentMes}%`} />}
          {rentAno && <ResumoLinha label="Rentab. ano" val={`${rentAno}%`} />}
          {rent12m && <ResumoLinha label="Rentab. 12 meses" val={`${rent12m}%`} cor="#4ade80" />}
          {qtdAtivos > 0 && <ResumoLinha label="Ativos" val={`${qtdAtivos}`} />}
          {qtdMovs > 0 && <ResumoLinha label="Movimentações" val={`${qtdMovs}`} />}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={salvando}
            style={{
              flex: 1, padding: 12, background: "rgba(255,255,255,0.04)",
              border: `0.5px solid ${T.border}`, borderRadius: T.radiusSm,
              color: T.textSecondary, fontSize: 11, cursor: salvando ? "not-allowed" : "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.1em", textTransform: "uppercase",
              opacity: salvando ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(mesEscolhido)}
            disabled={salvando || !mesEscolhido}
            style={{
              flex: 2, padding: 12, background: "rgba(240,162,2,0.18)",
              border: "0.5px solid rgba(240,162,2,0.45)", borderRadius: T.radiusSm,
              color: T.gold, fontSize: 12, cursor: salvando ? "wait" : "pointer",
              fontFamily: T.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500,
              opacity: salvando ? 0.7 : 1,
            }}
          >
            {salvando ? "Salvando..." : "Salvar e vincular ao mês"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResumoLinha({ label, val, cor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, ...noSel }}>
      <span style={{ color: T.textMuted }}>{label}</span>
      <span style={{ color: cor || T.textPrimary, fontWeight: 500 }}>{val}</span>
    </div>
  );
}

function MetaRow({ label, val, cor }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "9px 12px",
      background: `rgba(${hexToRgb(cor)},0.06)`,
      border: `0.5px solid rgba(${hexToRgb(cor)},0.18)`,
      borderRadius: 8, ...noSel,
    }}>
      <span style={{ fontSize: 11, color: T.textSecondary }}>{label}</span>
      <span style={{ fontSize: 12, color: cor, fontWeight: 500 }}>{val}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// UPLOAD OVERLAY
// ══════════════════════════════════════════════════════════════
function UploadOverlay({ progress, onClose }) {
  const done = progress.pct >= 100 && !progress.error;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: T.bgCard, border: `0.5px solid ${T.border}`,
        borderRadius: T.radiusLg, padding: "28px 24px", width: 380, maxWidth: "100%",
      }}>
        <div style={{
          fontSize: 15, fontWeight: 400,
          color: done ? T.success : progress.error ? T.danger : T.textPrimary,
          marginBottom: 8, ...noSel,
        }}>
          {done ? "✓ Importação concluída" : progress.error ? "✗ Erro na importação" : "Processando arquivo..."}
        </div>
        <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16, lineHeight: 1.6, ...noSel }}>{progress.message}</div>
        {!progress.error && progress.pct < 100 && (
          <>
            <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ height: "100%", width: `${progress.pct}%`, background: T.gold, borderRadius: 3, transition: "width 0.4s" }} />
            </div>
            <div style={{ fontSize: 11, color: T.gold, textAlign: "right", ...noSel }}>{Math.round(progress.pct)}%</div>
          </>
        )}
        {progress.error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "10px 12px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, color: T.danger, lineHeight: 1.6 }}>{progress.errorDetail}</div>
          </div>
        )}
        {(progress.pct >= 100 || progress.error) && (
          <button onClick={onClose} style={{
            width: "100%", padding: 10,
            background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`,
            borderRadius: T.radiusSm, color: T.textSecondary, fontSize: 11,
            cursor: "pointer", fontFamily: T.fontFamily, letterSpacing: "0.1em", textTransform: "uppercase",
          }}>Fechar</button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SNAPSHOT VIEWER — visualização somente-leitura de um mês passado
// ══════════════════════════════════════════════════════════════
function SnapshotViewerModal({ snapshot, clienteId, clienteNome, onClose, onApagar }) {
  const ativos = Array.isArray(snapshot.ativos) ? snapshot.ativos : [];
  const movs = Array.isArray(snapshot.movimentacoes) ? snapshot.movimentacoes : [];
  const resumo = snapshot.resumoMes || {};

  // Carrega snapshot do mês anterior pra calcular entrou/saiu/reforço.
  // Falha silenciosa se não houver mês anterior salvo.
  const [diffEntrouSaiu, setDiffEntrouSaiu] = useState(null); // null = loading, [] = sem diff
  useEffect(() => {
    let alive = true;
    const mesAnt = mesAnterior(snapshot.mesRef);
    if (!mesAnt || !clienteId) { setDiffEntrouSaiu([]); return; }
    obterSnapshot(clienteId, mesAnt)
      .then((snapAnt) => {
        if (!alive) return;
        const diff = snapAnt ? diffSnapshots(snapAnt, snapshot) : [];
        setDiffEntrouSaiu(diff);
      })
      .catch(() => alive && setDiffEntrouSaiu([]));
    return () => { alive = false; };
  }, [snapshot, clienteId]);

  const entradas = (diffEntrouSaiu || []).filter((d) => d.tipo === "compra");
  const saidas = (diffEntrouSaiu || []).filter((d) => d.tipo === "venda");
  const reforcos = (diffEntrouSaiu || []).filter((d) => d.tipo === "reforco");

  // Agrupa ativos por classe para visualização
  const ativosPorClasse = {};
  ativos.forEach((a) => {
    const k = a.classe || "outros";
    if (!ativosPorClasse[k]) ativosPorClasse[k] = [];
    ativosPorClasse[k].push(a);
  });

  const labelClasse = (k) => classByKey[k]?.label || k;
  const corClasse = (k) => classByKey[k]?.cor || T.textMuted;

  const fmtPct = (v) => v == null || isNaN(Number(v)) ? "—" : (Number(v) > 0 ? `+${Number(v).toFixed(2)}%` : `${Number(v).toFixed(2)}%`);
  const corPct = (v) => v == null || isNaN(Number(v)) ? T.textMuted : (Number(v) > 0 ? T.success : Number(v) < 0 ? T.danger : T.textMuted);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 700,
        display: "flex", alignItems: "stretch", justifyContent: "flex-end",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100vw)",
          background: T.bgCard,
          borderLeft: `0.5px solid ${T.goldBorder}`,
          overflowY: "auto",
          padding: "28px 32px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 9, color: T.gold, textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: 6, ...noSel }}>
              Foto da carteira
            </div>
            <div style={{ fontSize: 22, fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.01em" }}>
              {formatarMesRef(snapshot.mesRef)}
            </div>
            {snapshot.dataRef && (
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                Data de referência: {snapshot.dataRef}
                {snapshot.fonte && ` · via ${snapshot.fonte}`}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`,
            borderRadius: "50%", width: 32, height: 32, color: T.textSecondary,
            cursor: "pointer", fontSize: 16,
          }}>×</button>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <div style={{
            background: "rgba(255,255,255,0.02)", border: `0.5px solid ${T.border}`,
            borderRadius: T.radiusMd, padding: "12px 14px",
          }}>
            <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>Patrimônio</div>
            <div style={{ fontSize: 18, color: T.gold, fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
              {brl(Number(snapshot.patrimonioTotal) || 0)}
            </div>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.02)", border: `0.5px solid ${T.border}`,
            borderRadius: T.radiusMd, padding: "12px 14px",
          }}>
            <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6, ...noSel }}>Performance</div>
            <div style={{ display: "flex", gap: 12, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 8.5, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Mês</div>
                <div style={{ color: corPct(snapshot.rentMes), fontWeight: 500, marginTop: 2 }}>{fmtPct(snapshot.rentMes)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8.5, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Ano</div>
                <div style={{ color: corPct(snapshot.rentAno), fontWeight: 500, marginTop: 2 }}>{fmtPct(snapshot.rentAno)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8.5, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>12m</div>
                <div style={{ color: corPct(snapshot.rent12m), fontWeight: 500, marginTop: 2 }}>{fmtPct(snapshot.rent12m)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Resumo do mês */}
        {(resumo.aportes || resumo.retiradas || resumo.dividendos || resumo.juros) && (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8, ...noSel }}>
              Resumo do mês
            </div>
            <div style={{
              background: "rgba(255,255,255,0.02)", border: `0.5px solid ${T.border}`,
              borderRadius: T.radiusMd, padding: "12px 14px", marginBottom: 18,
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10,
              fontSize: 11,
            }}>
              {resumo.aportes > 0 && (
                <div>
                  <div style={{ color: T.textMuted, marginBottom: 3 }}>Aportes</div>
                  <div style={{ color: T.success, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>+ {brl(resumo.aportes)}</div>
                </div>
              )}
              {resumo.retiradas > 0 && (
                <div>
                  <div style={{ color: T.textMuted, marginBottom: 3 }}>Retiradas</div>
                  <div style={{ color: T.danger, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>- {brl(resumo.retiradas)}</div>
                </div>
              )}
              {resumo.dividendos > 0 && (
                <div>
                  <div style={{ color: T.textMuted, marginBottom: 3 }}>Dividendos</div>
                  <div style={{ color: T.gold, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{brl(resumo.dividendos)}</div>
                </div>
              )}
              {resumo.juros > 0 && (
                <div>
                  <div style={{ color: T.textMuted, marginBottom: 3 }}>Juros</div>
                  <div style={{ color: T.gold, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{brl(resumo.juros)}</div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Entrou / Saiu / Reforço — comparação com mês anterior */}
        {diffEntrouSaiu === null ? (
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 18, ...noSel }}>
            Carregando comparação com mês anterior…
          </div>
        ) : (entradas.length + saidas.length + reforcos.length) > 0 && (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8, ...noSel }}>
              Movimentação de carteira (vs. {formatarMesRef(mesAnterior(snapshot.mesRef))})
            </div>
            <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {entradas.map((d, i) => (
                <div key={`in-${i}`} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px",
                  background: "rgba(34,197,94,0.06)",
                  border: "0.5px solid rgba(34,197,94,0.25)",
                  borderRadius: T.radiusSm,
                  fontSize: 12,
                }}>
                  <span style={{ color: T.success, fontSize: 14, fontWeight: 600 }}>＋</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: T.success, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Comprou {d.ativo || "(ativo)"}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                      {classByKey[d.classe]?.label || d.classe || "—"} · primeiro mês com este ativo
                    </div>
                  </div>
                  <div style={{ color: T.success, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    + {brl(Number(d.deltaValor) || 0)}
                  </div>
                </div>
              ))}
              {saidas.map((d, i) => (
                <div key={`out-${i}`} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px",
                  background: "rgba(239,68,68,0.06)",
                  border: "0.5px solid rgba(239,68,68,0.25)",
                  borderRadius: T.radiusSm,
                  fontSize: 12,
                }}>
                  <span style={{ color: T.danger, fontSize: 14, fontWeight: 600 }}>−</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: T.danger, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Vendeu {d.ativo || "(ativo)"}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                      {classByKey[d.classe]?.label || d.classe || "—"} · saiu da carteira
                    </div>
                  </div>
                  <div style={{ color: T.danger, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    − {brl(Number(d.deltaValor) || 0)}
                  </div>
                </div>
              ))}
              {reforcos.map((d, i) => (
                <div key={`up-${i}`} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px",
                  background: "rgba(96,165,250,0.06)",
                  border: "0.5px solid rgba(96,165,250,0.25)",
                  borderRadius: T.radiusSm,
                  fontSize: 12,
                }}>
                  <span style={{ color: "#60a5fa", fontSize: 14, fontWeight: 600 }}>↗</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#60a5fa", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Reforçou {d.ativo || "(ativo)"}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                      {classByKey[d.classe]?.label || d.classe || "—"} · aumento de posição
                    </div>
                  </div>
                  <div style={{ color: "#60a5fa", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    + {brl(Number(d.deltaValor) || 0)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Ativos por classe */}
        {Object.keys(ativosPorClasse).length > 0 && (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8, ...noSel }}>
              Ativos por classe ({ativos.length})
            </div>
            <div style={{ marginBottom: 18 }}>
              {Object.entries(ativosPorClasse).map(([classe, lista]) => {
                const totalClasse = lista.reduce((s, a) => s + (Number(a.valor) || 0), 0);
                return (
                  <div key={classe} style={{
                    background: "rgba(255,255,255,0.02)", border: `0.5px solid ${T.border}`,
                    borderRadius: T.radiusMd, padding: "10px 14px", marginBottom: 8,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 3, height: 18, borderRadius: 2, background: corClasse(classe) }} />
                        <span style={{ fontSize: 12, color: T.textPrimary, fontWeight: 500 }}>{labelClasse(classe)}</span>
                        <span style={{ fontSize: 10, color: T.textMuted }}>· {lista.length} ativo{lista.length !== 1 ? "s" : ""}</span>
                      </div>
                      <span style={{ fontSize: 12, color: corClasse(classe), fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                        {brl(totalClasse)}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {lista.map((a, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, paddingLeft: 11 }}>
                          <span style={{ color: T.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
                            {a.nome || "(sem nome)"}
                            {a.vencimento && <span style={{ color: T.textMuted, marginLeft: 6 }}>· {a.vencimento}</span>}
                          </span>
                          <span style={{ color: T.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                            {brl(Number(a.valor) || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Movimentações */}
        {movs.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8, ...noSel }}>
              Movimentações detectadas ({movs.length})
            </div>
            <div style={{
              background: "rgba(255,255,255,0.02)", border: `0.5px solid ${T.border}`,
              borderRadius: T.radiusMd, marginBottom: 18, maxHeight: 240, overflowY: "auto",
            }}>
              {movs.map((m, i) => (
                <div key={i} style={{
                  padding: "10px 14px",
                  borderBottom: i < movs.length - 1 ? `0.5px solid ${T.border}` : "none",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  fontSize: 11,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: T.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.descricao || m.ativo || "Movimentação"}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10, marginTop: 2 }}>
                      {m.data} · {m.tipo}
                    </div>
                  </div>
                  <div style={{ color: T.textPrimary, fontVariantNumeric: "tabular-nums", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {brl(Number(m.valor) || 0)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Ações primárias */}
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button
            onClick={() => gerarRelatorioSnapshot({
              snapshot,
              clienteNome,
              diffEntrouSaiu: diffEntrouSaiu || [],
            })}
            style={{
              flex: 1, padding: 12,
              background: "linear-gradient(135deg, rgba(240,162,2,0.18), rgba(240,162,2,0.06))",
              border: "0.5px solid rgba(240,162,2,0.45)",
              borderRadius: T.radiusMd, color: T.gold, fontSize: 11,
              cursor: "pointer", fontFamily: T.fontFamily, letterSpacing: "0.12em",
              textTransform: "uppercase", fontWeight: 600,
            }}
            title="Abre versão imprimível em uma nova aba (salve como PDF para enviar ao cliente)"
          >📄 Gerar relatório</button>
          <button onClick={onClose} style={{
            flex: 1, padding: 12,
            background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`,
            borderRadius: T.radiusMd, color: T.textSecondary, fontSize: 11,
            cursor: "pointer", fontFamily: T.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase",
          }}>Fechar</button>
        </div>

        {/* Ação destrutiva — discreta, longe do Fechar */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `0.5px dashed ${T.border}`, textAlign: "center" }}>
          <button
            onClick={onApagar}
            style={{
              background: "transparent", border: "none",
              color: T.textMuted, fontSize: 10,
              cursor: "pointer", fontFamily: T.fontFamily,
              letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "6px 10px", borderRadius: 4,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = T.textMuted; }}
            title="Apaga somente o snapshot deste mês — não afeta a carteira atual"
          >
            🗑 apagar snapshot deste mês
          </button>
        </div>
      </div>
    </div>
  );
}
