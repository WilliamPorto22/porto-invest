// FluxoMensal — Tela moderna de gastos e ganhos do cliente (PortoInvest)
// Fintech-style: hero card animado, chips de categoria, bottom sheet de detalhamento,
// múltiplas fontes de renda, upload com revisão pós-OCR.
//
// Retrocompatibilidade: mantém leitura/escrita de form[key], form[key+"_detail"],
// form[key+"_items"], form.renda, form._totalManual. Adiciona form._rendas para
// múltiplas fontes (sem quebrar leitura de docs antigos).

import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { collection, doc, getDoc, getDocs, setDoc, query, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { lerClienteComFallback, invalidarCacheCliente } from "../services/lerClienteFallback";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import DonutChartModern from "../components/DonutChartModern";
import HistoricoMensalChart from "../components/HistoricoMensalChart";
import HeroFluxoCard from "../components/fluxo/HeroFluxoCard";
import CategoryChip, { CategoryRow } from "../components/fluxo/CategoryChip";
import CategorySheet from "../components/fluxo/CategorySheet";
import RendasCard from "../components/fluxo/RendasCard";
import UploadReviewModal from "../components/fluxo/UploadReviewModal";
import OnboardingWizard from "../components/fluxo/OnboardingWizard";
import { T } from "../theme";
import { parseCentavos, brl as brlUtil, formatMi as formatMiUtil } from "../utils/currency";
import { stripUndefined } from "../services/snapshotsCarteira";

const fmtFull = brlUtil;
const fmtMi = formatMiUtil;
const noEdit = { userSelect: "none", WebkitUserSelect: "none", cursor: "default" };
const font = T.fontFamily || "-apple-system,'SF Pro Display',sans-serif";
const BG = "#0D1321";

// ── Categorias de gastos ───────────────────────────────────────
const CATS = [
  { label: "Moradia",                key: "moradia",      cor: "#2563eb",
    desc: "Aluguel, condomínio, financiamento, água, luz, gás, internet" },
  { label: "Alimentação",            key: "alimentacao",  cor: "#3b82f6",
    desc: "Supermercado, restaurantes, delivery, padaria" },
  { label: "Carro / Transporte",     key: "carro",        cor: "#a07020",
    desc: "Combustível, IPVA, seguro, prestação, Uber" },
  { label: "Saúde",                  key: "saude",        cor: "#ef4444",
    desc: "Plano de saúde, farmácia, consultas, exames" },
  { label: "Educação",               key: "educacao",     cor: "#22c55e",
    desc: "Escola, faculdade, cursos, material escolar" },
  { label: "Lazer / Entretenimento", key: "lazer",        cor: "#8b5cf6",
    desc: "Cinema, viagens, hobbies, shows, restaurantes" },
  { label: "Assinaturas",            key: "assinaturas",  cor: "#06b6d4",
    desc: "Netflix, Spotify, apps, clubes, serviços mensais" },
  { label: "Cartões / Consumo",      key: "cartoes",      cor: "#F0A202",
    desc: "Faturas de cartão de crédito e compras diversas" },
  { label: "Seguros",                key: "seguros",      cor: "#64748b",
    desc: "Seguro de vida, residência, outros seguros" },
  { label: "Outros",                 key: "outros",       cor: "#6b7280",
    desc: "Despesas diversas não categorizadas" },
];

// Sub-itens pré-definidos por categoria (15 cada)
const CAT_ITEMS = {
  moradia:      ["Aluguel","Parcela do imóvel","Luz","Água","Gás","Internet","Condomínio","IPTU","Limpeza / Diarista","Manutenção","Jardim / Piscina","Porteiro / Segurança","TV a cabo","Mobília / Decoração","Outros"],
  alimentacao:  ["Supermercado","Hortifruti","Padaria","Açougue","Restaurantes","Delivery / iFood","Lanchonetes","Cafeteria","Bebidas","Congelados","Refeição no trabalho","Feira livre","Marmitas","Emergências (madrugada)","Outros"],
  carro:        ["Combustível","IPVA","Seguro auto","Licenciamento","Prestação do veículo","Manutenção / Revisão","Lavagem","Estacionamento","Pedágio","Uber / 99","Ônibus / Metrô","Multas","Troca de pneus","Óleo e filtros","Outros"],
  saude:        ["Plano de saúde","Farmácia","Consultas médicas","Exames","Dentista","Fisioterapia","Psicólogo / Terapia","Suplementos","Academia / Pilates","Nutricionista","Cirurgias / Procedimentos","Óculos / Lentes","Pediatra","Vacinas","Outros"],
  educacao:     ["Escola / Mensalidade","Faculdade / Pós","Cursos online","Idiomas","Material escolar","Livros","Reforço / Tutor","Formaturas","Uniforme","Atividades extras","Transporte escolar","Lanche escolar","Certificações","Eventos / Excursões","Outros"],
  lazer:        ["Cinema / Teatro","Shows / Eventos","Viagens","Hospedagem","Passagens aéreas","Restaurantes (lazer)","Bares / Baladas","Hobbies","Jogos / Games","Esportes / Clube","Parques / Passeios","Presentes","Livros / Cultura","Experiências","Outros"],
  assinaturas:  ["Netflix","Spotify","Amazon Prime","Disney+","HBO Max","YouTube Premium","Apple One / iCloud","Google One","ChatGPT / IAs","Clube do livro","Revistas / Jornais","Apps de produtividade","Academia digital","Cursos por assinatura","Outros"],
  cartoes:      ["Cartão principal","Cartão secundário","Cartão empresarial","Anuidade","Juros de fatura","Compras parceladas","Compras à vista","Saques no crédito","Estornos","Tarifas","IOF","Seguros do cartão","Milhas / Programas","Assinaturas no cartão","Outros"],
  seguros:      ["Seguro de vida","Seguro residencial","Seguro patrimonial","Seguro viagem","Seguro celular","Seguro empresarial","Seguro de renda","Seguro dental","Seguro saúde complementar","Seguro pet","Seguro fiança","Seguro de invalidez","Seguro contra roubo","Seguro auto (extra)","Outros"],
  outros:       ["Presentes","Doações / Dízimo","Pet","Filhos (mesada)","Cabeleireiro / Estética","Vestuário","Calçados","Acessórios","Eletrônicos","Imprevistos","Impostos (IR/outros)","Tarifas bancárias","Empréstimos / Juros","Pensão","Diversos"],
};

// ── Overlay de progresso do upload ─────────────────────────────
function UploadOverlay({ progress, onClose }) {
  if (!progress) return null;
  const done = progress.pct >= 100 && !progress.error;
  const error = progress.error;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#111927", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "28px 24px", width: 360, maxWidth: "100%" }}>
        <div style={{ fontSize: 15, fontWeight: 400, color: done ? "#22c55e" : error ? "#ef4444" : T.textPrimary, marginBottom: 6, ...noEdit }}>
          {done ? "✓ Importação finalizada" : error ? "✗ Erro na importação" : "Processando arquivo..."}
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16, lineHeight: 1.6, ...noEdit }}>{progress.message}</div>
        {!done && !error && (
          <>
            <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ height: "100%", width: `${progress.pct}%`, background: "#F0A202", borderRadius: 3, transition: "width 0.4s ease" }} />
            </div>
            <div style={{ fontSize: 11, color: "#F0A202", textAlign: "right", ...noEdit }}>{Math.round(progress.pct)}%</div>
          </>
        )}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "10px 12px", marginBottom: 16, ...noEdit }}>
            <div style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.6 }}>{progress.errorDetail}</div>
          </div>
        )}
        {(done || error) && (
          <button onClick={onClose} style={{ width: "100%", padding: 10, background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 9, color: T.textSecondary, fontSize: 12, cursor: "pointer", fontFamily: font }}>
            Fechar
          </button>
        )}
      </div>
    </div>
  );
}

// Helper: soma total da renda a partir de _rendas[] OU form.renda legacy
function totalRendaFromForm(form) {
  const rendas = form?._rendas || [];
  if (rendas.length > 0) {
    return rendas.reduce((s, r) => s + parseCentavos(r.valor), 0) / 100;
  }
  return parseCentavos(form?.renda) / 100;
}

// ── Main ───────────────────────────────────────────────────────
export default function FluxoMensal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isCliente, profile } = useAuth();

  useEffect(() => {
    if (isCliente && profile?.clienteId && id !== profile.clienteId) {
      navigate(`/cliente/${profile.clienteId}/fluxo`, { replace: true });
    }
  }, [isCliente, profile?.clienteId, id, navigate]);

  const [form, setForm] = useState({});
  const [clienteNome, setClienteNome] = useState("");
  const [modo, setModo] = useState("ver");
  const [salvando, setSalvando] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [sheetCat, setSheetCat] = useState(null); // categoria com sheet aberto
  const [reviewData, setReviewData] = useState(null); // dados parseados aguardando revisão
  const [uploadCatTarget, setUploadCatTarget] = useState(null); // se o upload veio de uma categoria específica
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [snapshotsFluxo, setSnapshotsFluxo] = useState([]);
  const fileInputRef = useRef(null);

  const modoRef = useRef(modo);
  useEffect(() => { modoRef.current = modo; }, [modo]);

  useEffect(() => {
    let vivo = true;
    async function carregar() {
      let data;
      try {
        const r = await lerClienteComFallback(id, { isAlive: () => vivo });
        if (!vivo || !r.exists || !r.data) return;
        data = r.data;
      } catch (e) {
        console.error("FluxoMensal: falha ao ler cliente", e);
        return;
      }
      setClienteNome(data.nome || "");
      const fluxoExistente = data.fluxo || {};
      const temFluxo = Object.keys(fluxoExistente).some((k) => !k.startsWith("_") && parseCentavos(fluxoExistente[k]) > 0);

      // Migração transparente: se tem form.renda legacy mas não tem _rendas, cria
      // _rendas[{key:"salario", valor:form.renda}]
      let novoForm = { ...fluxoExistente };
      if (!novoForm._rendas && parseCentavos(novoForm.renda) > 0) {
        novoForm._rendas = [{ key: "salario", valor: novoForm.renda }];
      }

      // Fallback: se nunca preencheu fluxo mas tem gastosMensaisManual no cadastro
      if (!temFluxo && parseCentavos(data.gastosMensaisManual) > 0) {
        novoForm._totalManual = data.gastosMensaisManual;
        novoForm._fromCadastro = "1";
      }

      // Se _rendas vazio mas tem salário no cadastro, sugere
      if ((!novoForm._rendas || novoForm._rendas.length === 0) && parseCentavos(data.salarioMensal) > 0) {
        novoForm._rendas = [{ key: "salario", valor: data.salarioMensal }];
      }

      setForm(novoForm);

      // Onboarding: mostra apenas na primeira visita com fluxo vazio.
      const temAlgumValor = temFluxo || (novoForm._rendas && novoForm._rendas.length > 0);
      if (novoForm._onboarded !== "1" && !temAlgumValor) {
        setOnboardingOpen(true);
      }

      // Carrega snapshots de fluxo pra alimentar o gráfico de evolução
      try {
        const snapsRef = query(collection(db, "clientes", id, "snapshotsFluxo"), orderBy("mesRef", "desc"));
        const snapsDocs = await getDocs(snapsRef);
        if (vivo) setSnapshotsFluxo(snapsDocs.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        // permission-denied silencioso (cliente sem permissão na subcollection ainda)
        if (e?.code !== "permission-denied") console.warn("[FluxoMensal] Falha ao listar snapshotsFluxo:", e?.code);
      }
    }
    carregar();
    const onFocus = () => { if (modoRef.current === "ver") carregar(); };
    const onVisibility = () => { if (!document.hidden && modoRef.current === "ver") carregar(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      vivo = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id]);

  // ── Mutadores ────────────────────────────────────────────────
  function setRendas(rendas) {
    setForm((f) => ({
      ...f,
      _rendas: rendas,
      // Sincroniza form.renda legacy com a primeira fonte (compat)
      renda: rendas?.[0]?.valor || "",
    }));
  }

  function setDetail(catKey, nome, valor) {
    setForm((f) => {
      const list = [...(f[catKey + "_detail"] || [])];
      const idx = list.findIndex((i) => i.nome === nome);
      if (valor == null) {
        if (idx >= 0) list.splice(idx, 1);
      } else if (idx >= 0) {
        list[idx] = { nome, valor };
      } else {
        list.push({ nome, valor });
      }
      const soma = list.reduce((a, b) => a + parseCentavos(b.valor), 0);
      return { ...f, [catKey + "_detail"]: list, [catKey]: String(soma) };
    });
  }

  function setTotalCategoria(catKey, valor) {
    setForm((f) => {
      // Se digitou total, limpa o detail (são exclusivos)
      const next = { ...f, [catKey]: valor };
      // Mantém detail intacto para o usuário poder voltar; mas no save, prevalece o detalhe
      // se houver. No sheet, tab "total" só é usável se detail estiver vazio.
      return next;
    });
  }

  function clearDetail(catKey) {
    setForm((f) => ({ ...f, [catKey + "_detail"]: [], [catKey]: "" }));
  }

  // ── Salvar ───────────────────────────────────────────────────
  async function salvar() {
    setSalvando(true);
    try {
      const snap = await getDoc(doc(db, "clientes", id));
      const data = snap.data() || {};

      const totalGastosDetalhado = CATS.reduce((acc, { key }) => acc + (parseCentavos(form[key]) / 100), 0);
      const totalParaSalvar = totalGastosDetalhado > 0
        ? Math.round(totalGastosDetalhado * 100)
        : parseCentavos(form._totalManual);

      // Renda primária para salarioMensal (legacy compat) — primeira fonte ou form.renda
      const rendaPrincipal = form._rendas?.[0]?.valor || form.renda || "";

      const patch = stripUndefined({
        fluxo: form,
        ...(totalParaSalvar > 0 ? { gastosMensaisManual: String(totalParaSalvar) } : {}),
        ...(parseCentavos(rendaPrincipal) > 0 && !data.salarioMensal ? { salarioMensal: rendaPrincipal } : {}),
      });
      // Try direct write; fallback CF se rules falharem (master sem claim, etc.)
      try {
        await setDoc(doc(db, "clientes", id), patch, { merge: true });
      } catch (errSet) {
        if (errSet?.code === "permission-denied") {
          console.warn("[FluxoMensal] setDoc cliente permission-denied — fallback CF");
          const { httpsCallable } = await import("firebase/functions");
          const { functions: fbFunctions } = await import("../firebase");
          const hoje = new Date();
          const mesRef = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
          const callSalvar = httpsCallable(fbFunctions, "salvarFluxoMensal", { timeout: 30000 });
          await callSalvar({
            clienteId: id,
            mesRef,
            fluxoSnapshot: { renda: 0, gastos: 0 }, // será sobrescrito abaixo
            clientePatch: patch,
          });
        } else {
          throw errSet;
        }
      }

      // Snapshot mensal: salva foto do mês corrente em clientes/{id}/snapshotsFluxo/{YYYY-MM}.
      // Ao salvar de novo no mesmo mês, sobrescreve (merge:true). Quando o mês virar,
      // novo snapshot vira automaticamente. Permite chart de evolução mês a mês.
      const hoje = new Date();
      const mesRef = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
      const totGastosReais = totalGastosCats > 0 ? totalGastosCats : (parseCentavos(form._totalManual) / 100);
      const rendaTotalReais = rendaTotal;
      const sobraReais = rendaTotalReais - totGastosReais;
      const txPoup = rendaTotalReais > 0 ? Math.round((sobraReais / rendaTotalReais) * 100) : 0;
      const gastosPorCategoria = {};
      CATS.forEach((c) => {
        const v = parseCentavos(form[c.key]) / 100;
        if (v > 0) gastosPorCategoria[c.key] = v;
      });
      const fluxoSnapshot = stripUndefined({
        mesRef,
        renda: rendaTotalReais,
        gastos: totGastosReais,
        sobra: sobraReais,
        txPoupanca: txPoup,
        gastosPorCategoria,
        atualizadoEm: new Date().toISOString(),
      });
      try {
        await setDoc(doc(db, "clientes", id, "snapshotsFluxo", mesRef), fluxoSnapshot, { merge: true });
      } catch (errSnap) {
        if (errSnap?.code === "permission-denied") {
          console.warn("[FluxoMensal] snapshot permission-denied — fallback CF");
          const { httpsCallable } = await import("firebase/functions");
          const { functions: fbFunctions } = await import("../firebase");
          const callSalvar = httpsCallable(fbFunctions, "salvarFluxoMensal", { timeout: 30000 });
          await callSalvar({
            clienteId: id,
            mesRef,
            fluxoSnapshot,
            clientePatch: patch,
          });
        } else {
          throw errSnap;
        }
      }
      // Recarrega a lista pra refletir o novo snapshot no chart
      try {
        const snapsRef = query(collection(db, "clientes", id, "snapshotsFluxo"), orderBy("mesRef", "desc"));
        const snapsDocs = await getDocs(snapsRef);
        setSnapshotsFluxo(snapsDocs.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) { console.warn("Falha ao recarregar snapshotsFluxo:", e?.code); }

      invalidarCacheCliente(id);
      setModo("ver");
    } catch (e) {
      console.error("[FluxoMensal] Erro ao salvar:", e);
      const msgErro = e?.code === "permission-denied"
        ? "Sem permissão para salvar. Faça logout e entre novamente."
        : e?.code === "unavailable"
        ? "Sem conexão com o servidor. Tente novamente em alguns segundos."
        : "Erro ao salvar: " + (e?.message || "erro desconhecido");
      alert(msgErro);
    } finally {
      setSalvando(false);
    }
  }

  // ── Upload ───────────────────────────────────────────────────
  function abrirUpload(catKey = null) {
    setUploadCatTarget(catKey);
    fileInputRef.current?.click();
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const setP = (pct, message, extra = {}) => setUploadProgress({ pct, message, ...extra });
    setP(0, "Carregando processador de documentos...");
    try {
      const { extractText, parseFluxoFromText } = await import("../utils/documentParser");
      setP(3, "Iniciando leitura do arquivo...");
      const text = await extractText(file, (pct, message) => setP(pct, message));
      const dados = parseFluxoFromText(text);
      const catKeys = Object.keys(dados).filter((k) => !k.endsWith("_items") && !k.startsWith("_"));

      if (catKeys.length === 0) {
        setP(100, "Nenhum dado reconhecido. Verifique o arquivo ou preencha manualmente.", {
          error: true,
          errorDetail: "O arquivo não contém dados financeiros legíveis no formato esperado. Tente outro arquivo ou preencha manualmente os campos abaixo.",
        });
        setModo("editar");
      } else {
        // Se upload veio de uma categoria específica, força tudo para aquela categoria
        if (uploadCatTarget) {
          const dadosForcados = {};
          // Mantém apenas _items reorganizados sob a categoria target
          const itensTotal = [];
          let totalCat = 0;
          Object.entries(dados).forEach(([k, v]) => {
            if (k.endsWith("_items")) itensTotal.push(...v);
            else if (k.startsWith("_")) dadosForcados[k] = v;
            else totalCat += parseCentavos(v);
          });
          if (itensTotal.length > 0) dadosForcados[uploadCatTarget + "_items"] = itensTotal;
          if (totalCat > 0) dadosForcados[uploadCatTarget] = String(totalCat);
          setP(100, `${itensTotal.length} ${itensTotal.length === 1 ? "transação importada" : "transações importadas"} para ${CATS.find((c) => c.key === uploadCatTarget)?.label || ""}.`);
          setReviewData(dadosForcados);
        } else {
          // Abre modal de revisão para reclassificar
          setUploadProgress(null); // fecha o overlay simples
          setReviewData(dados);
        }
        setModo("editar");
      }
    } catch (err) {
      setP(0, "", { error: true, pct: 0, message: "Erro ao processar arquivo", errorDetail: err.message });
    } finally {
      setUploadCatTarget(null);
      e.target.value = "";
    }
  }

  function aplicarRevisao(dadosFinais) {
    setForm((f) => {
      const novo = { ...f };
      // Limpa _items antigos das categorias afetadas
      CATS.forEach((c) => { delete novo[c.key + "_items"]; });
      // Aplica novos
      Object.entries(dadosFinais).forEach(([k, v]) => {
        novo[k] = v;
      });
      return novo;
    });
    setReviewData(null);
  }

  // ── Cálculos ─────────────────────────────────────────────────
  const rendaTotal = useMemo(() => totalRendaFromForm(form), [form]);
  const totalGastosCats = useMemo(
    () => CATS.reduce((acc, { key }) => acc + (parseCentavos(form[key]) / 100), 0),
    [form]
  );
  const totalGastos = totalGastosCats > 0 ? totalGastosCats : parseCentavos(form._totalManual) / 100;
  const sobra = rendaTotal - totalGastos;
  const txPoupanca = rendaTotal > 0 ? Math.round((sobra / rendaTotal) * 100) : 0;

  const sheetCategoria = sheetCat ? CATS.find((c) => c.key === sheetCat) : null;

  return (
    <div className="dashboard-container has-sidebar" style={{ minHeight: "100vh", background: BG, fontFamily: font }}>
      <Sidebar mode="cliente" clienteId={id} clienteNome={clienteNome || ""} />
      <Navbar
        showLogout={true}
        actionButtons={[
          { icon: "←", label: "Voltar", variant: "secondary", onClick: () => navigate(`/cliente/${id}`), title: "Voltar ao cliente" },
          { icon: "↑", label: "Importar", onClick: () => abrirUpload(), variant: "secondary" },
          { label: modo === "ver" ? "Editar" : "Salvar", variant: modo === "editar" ? "primary" : "secondary",
            onClick: () => modo === "ver" ? setModo("editar") : salvar(), disabled: salvando },
          ...(modo === "editar" ? [{ label: "Cancelar", variant: "secondary", onClick: () => setModo("ver") }] : []),
        ]}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        style={{ display: "none" }}
        onChange={handleUpload}
      />
      <UploadOverlay progress={uploadProgress} onClose={() => setUploadProgress(null)} />

      {/* Modal de revisão pós-upload */}
      <UploadReviewModal
        open={!!reviewData}
        cats={CATS}
        parsedData={reviewData}
        onConfirm={aplicarRevisao}
        onCancel={() => setReviewData(null)}
      />

      {/* Onboarding de primeiro acesso */}
      <OnboardingWizard
        open={onboardingOpen}
        onClose={async () => {
          setOnboardingOpen(false);
          setForm((f) => ({ ...f, _onboarded: "1" }));
          try {
            await setDoc(
              doc(db, "clientes", id),
              { fluxo: { _onboarded: "1" } },
              { merge: true }
            );
            invalidarCacheCliente(id);
          } catch (e) {
            console.error("Falha ao salvar flag onboarding", e);
          }
        }}
      />

      {/* Bottom sheet de categoria */}
      <CategorySheet
        open={!!sheetCat}
        onClose={() => setSheetCat(null)}
        category={sheetCategoria}
        items={sheetCat ? CAT_ITEMS[sheetCat] : []}
        detail={sheetCat ? form[sheetCat + "_detail"] : []}
        totalManual={sheetCat ? form[sheetCat] : ""}
        importedItems={sheetCat ? form[sheetCat + "_items"] : []}
        onChangeDetail={setDetail}
        onChangeTotal={setTotalCategoria}
        onClearDetail={clearDetail}
        onUpload={modo === "editar" ? () => abrirUpload(sheetCat) : null}
      />

      {/* Botão flutuante voltar */}
      <button
        onClick={() => navigate(`/cliente/${id}`)}
        className="floating-nav-btn is-left"
        aria-label="Voltar ao cliente"
      >←</button>

      <div
        className="dashboard-content with-sidebar cliente-zoom pi-fluxo-page"
        style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 22px 80px" }}
      >
        {/* Header */}
        <div style={{ marginBottom: 18, ...noEdit }}>
          <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: 6 }}>
            Entradas e Saídas do Mês
          </div>
          <div style={{ fontSize: 24, fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.01em" }}>
            {clienteNome || "Cliente"}
          </div>
        </div>

        {/* Hero card */}
        <HeroFluxoCard
          renda={rendaTotal}
          gastos={totalGastos}
          sobra={sobra}
          txPoupanca={txPoupanca}
          totalCategorias={CATS.length}
          categoriasPreenchidas={CATS.filter((c) => parseCentavos(form[c.key]) > 0).length}
        />

        {/* Evolução de gastos mensais — só aparece quando há ≥2 meses salvos */}
        {snapshotsFluxo.length >= 2 && (
          <div style={{ marginTop: 14 }}>
            <HistoricoMensalChart
              items={snapshotsFluxo.map((s) => ({
                mesRef: s.mesRef,
                valor: Number(s.gastos) || 0,
                rentMes: null,
                meta: s,
              }))}
              descricao="Evolução dos gastos mês a mês — verde quando você gastou MENOS que no mês anterior, vermelho quando gastou mais. Cada vez que você salva o fluxo, vira uma foto do mês."
              legenda={
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 2, background: "#22c55e", borderRadius: 1 }} /> gastou menos vs. mês anterior
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 2, background: "#ef4444", borderRadius: 1 }} /> gastou mais
                  </span>
                </>
              }
            />
          </div>
        )}

        {/* Banner: fluxo vazio mas tem gastosMensaisManual no cadastro */}
        {form._fromCadastro === "1" && totalGastosCats === 0 && parseCentavos(form._totalManual) > 0 && modo === "ver" && (
          <div style={{ background: "rgba(240,162,2,0.06)", border: "0.5px solid rgba(240,162,2,0.3)", borderRadius: 14, padding: "14px 16px", marginBottom: 14, ...noEdit }}>
            <div style={{ fontSize: 11, color: "#F0A202", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
              Gastos estimados do cadastro
            </div>
            <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.55, marginBottom: 10 }}>
              Este cliente ainda não detalhou os gastos por categoria. Mostrando o total informado no cadastro:{" "}
              <b style={{ color: "#F0A202" }}>{fmtFull(parseCentavos(form._totalManual) / 100)}</b>.
            </div>
            <button
              onClick={() => setModo("editar")}
              className="pi-action-btn pi-action-btn--gold"
              style={{ padding: "8px 14px" }}
            >
              Detalhar categorias →
            </button>
          </div>
        )}

        {/* Alerta poupança baixa */}
        {txPoupanca < 20 && rendaTotal > 0 && (
          <div style={{ background: "rgba(245,158,11,0.07)", border: "0.5px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: "11px 14px", fontSize: 12, color: "#fbbf24", marginBottom: 14, lineHeight: 1.55, ...noEdit }}>
            ⚠ Você está guardando <b>{txPoupanca}%</b> da sua renda. O ideal é guardar pelo menos <b>20%</b> para construir patrimônio consistente.
          </div>
        )}

        {/* Botões de ação rápida */}
        <div className="pi-fluxo-actions">
          <button
            type="button"
            className="pi-action-btn pi-action-btn--gold"
            onClick={() => abrirUpload()}
          >
            ↑ Importar arquivo
          </button>
          {modo === "ver" && (
            <button
              type="button"
              className="pi-action-btn"
              onClick={() => setModo("editar")}
            >
              ✎ Editar
            </button>
          )}
        </div>

        {/* Renda */}
        <RendasCard
          rendas={form._rendas || []}
          onChange={setRendas}
          modo={modo}
          totalRenda={rendaTotal}
        />

        {/* ── Modo VER: Donut + categorias ── */}
        {modo === "ver" && totalGastos > 0 && (
          <>
            <div className="pi-section-card">
              <div className="pi-section-title">
                <span className="pi-section-title__text">Distribuição de Gastos</span>
              </div>
              <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flexShrink: 0 }}>
                  <DonutChartModern
                    data={CATS.map((c) => ({
                      key: c.key,
                      label: c.label,
                      cor: c.cor,
                      valor: parseCentavos(form[c.key]) / 100,
                    }))}
                    total={totalGastos}
                    size={200}
                    thickness={36}
                    labelCentro="GASTOS"
                    formatValor={fmtMi}
                    emptyText="Sem gastos cadastrados"
                  />
                </div>
                <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
                  {CATS.filter((c) => parseCentavos(form[c.key]) > 0).map((c) => {
                    const v = parseCentavos(form[c.key]) / 100;
                    const pct = totalGastos > 0 ? Math.round((v / totalGastos) * 100) : 0;
                    return (
                      <CategoryRow
                        key={c.key}
                        catKey={c.key}
                        label={c.label}
                        cor={c.cor}
                        valor={v}
                        pctTotal={pct}
                        detail={form[c.key + "_detail"]}
                        items={form[c.key + "_items"]}
                        onClick={() => setSheetCat(c.key)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Modo EDITAR: grid de chips ── */}
        {modo === "editar" && (
          <div className="pi-section-card">
            <div className="pi-section-title">
              <span className="pi-section-title__text">Categorias de Gasto</span>
              <span style={{ fontSize: 11, color: T.textSecondary, ...noEdit }}>
                Clique em uma categoria para detalhar
              </span>
            </div>
            <div className="pi-cat-grid">
              {CATS.map((c) => {
                const v = parseCentavos(form[c.key]) / 100;
                const pct = totalGastos > 0 ? Math.round((v / totalGastos) * 100) : 0;
                return (
                  <CategoryChip
                    key={c.key}
                    catKey={c.key}
                    label={c.label}
                    cor={c.cor}
                    desc={c.desc}
                    valor={v}
                    detail={form[c.key + "_detail"]}
                    items={form[c.key + "_items"]}
                    pctTotal={pct}
                    onClick={() => setSheetCat(c.key)}
                  />
                );
              })}
            </div>

            {/* Total geral (sem detalhamento) — opcional */}
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 11, color: T.textSecondary, cursor: "pointer", letterSpacing: "0.04em", padding: "8px 0", ...noEdit }}>
                Ou informe apenas o total geral (sem detalhar por categoria)
              </summary>
              <div style={{ marginTop: 10, padding: "12px 14px", background: "rgba(255,255,255,0.025)", border: `0.5px solid ${T.border}`, borderRadius: 12 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  className="pi-money-input"
                  placeholder="R$ total geral de gastos"
                  value={(() => {
                    const n = parseCentavos(form._totalManual);
                    if (!n) return "";
                    return "R$ " + (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  })()}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm((f) => ({ ...f, _totalManual: v }));
                  }}
                />
                <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 6, ...noEdit }}>
                  Se preenchido, prevalece sobre os totais das categorias acima.
                </div>
              </div>
            </details>
          </div>
        )}

        {/* Total rodapé */}
        {totalGastos > 0 && (
          <div style={{ maxWidth: 720, margin: "0 auto 14px", ...noEdit }}>
            <div style={{
              background: T.bgCard,
              border: `0.5px solid rgba(239,68,68,0.22)`,
              borderRadius: 14,
              padding: "14px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxShadow: T.shadowSm,
            }}>
              <div>
                <div style={{ fontSize: 9.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 4 }}>
                  Total de gastos no mês
                </div>
                {rendaTotal > 0 && (
                  <div style={{ fontSize: 10, color: T.textSecondary }}>
                    {Math.round((totalGastos / rendaTotal) * 100)}% da renda mensal
                  </div>
                )}
              </div>
              <div style={{ fontSize: 22, color: "#ef4444", fontWeight: 300, letterSpacing: "-0.01em" }}>
                {fmtFull(totalGastos)}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {totalGastos === 0 && modo === "ver" && (
          <div className="pi-fluxo-empty">
            <div className="pi-fluxo-empty__icon">💸</div>
            <div className="pi-fluxo-empty__title">Nenhum gasto cadastrado</div>
            <div className="pi-fluxo-empty__sub">
              Clique em editar para adicionar suas categorias, ou importe uma fatura/extrato em PDF.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => setModo("editar")} className="pi-fluxo-empty__btn">
                ✎ Editar fluxo
              </button>
              <button onClick={() => abrirUpload()} className="pi-fluxo-empty__btn">
                ↑ Importar arquivo
              </button>
            </div>
          </div>
        )}

        {/* Total manual sem categorias — aviso no VER */}
        {totalGastosCats === 0 && parseCentavos(form._totalManual) > 0 && modo === "ver" && (
          <div style={{
            maxWidth: 720,
            margin: "0 auto 8px",
            background: "rgba(240,162,2,0.06)",
            border: "0.5px solid rgba(240,162,2,0.25)",
            borderRadius: 12,
            padding: "12px 16px",
            fontSize: 11.5,
            color: "#fbbf24",
            ...noEdit,
          }}>
            Total informado sem detalhamento.{" "}
            <button
              onClick={() => setModo("editar")}
              style={{ background: "none", border: "none", padding: 0, color: "#F0A202", fontSize: 11.5, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}
            >
              Detalhar por categoria
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
