import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { lerClienteComFallback, invalidarCacheCliente } from "../services/lerClienteFallback";
import { stripUndefined } from "../services/snapshotsCarteira";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { T, C } from "../theme";
import { useCotacoesReais } from "../services/cotacoesReais";
import { listarAtivosCarteira, ativosDoObjetivo, atualizarVinculoAtivos, TIPO_OBJETIVO_PARA_LABEL } from "../utils/ativos";
import {
  TAXA_ANUAL,
  IPCA_ANUAL,
  encontrarAnosNecessarios,
  calcularProjecao,
  encontrarAporteNecessario,
  classificarStatus,
} from "../utils/objetivosCalc";
import { parseCentavos, moedaInput, brl as brlFromUtils } from "../utils/currency";

const TIPOS = [
  { id:"aposentadoria", label:"Aposentadoria e Liberdade Financeira" },
  { id:"imovel",        label:"Aquisição de Imóvel" },
  { id:"liquidez",      label:"Liquidez / Reserva de Emergência" },
  { id:"carro",         label:"Comprar Veículo" },
  { id:"oportunidade",  label:"Reserva de Oportunidade" },
  { id:"viagem",        label:"Viagens e Experiências" },
  { id:"educacao",      label:"Educação dos Filhos" },
  { id:"saude",         label:"Saúde e Qualidade de Vida" },
  { id:"sucessaoPatrimonial", label:"Sucessão Patrimonial" },
  { id:"seguros",       label:"Seguro de Vida e de Veículos" },
  { id:"planoSaude",    label:"Plano de Saúde" },
  { id:"personalizado", label:"Objetivo Personalizado" },
];

// Aliases locais para manter o restante do arquivo legível sem renomear call sites.
const encontrarAnos = encontrarAnosNecessarios;
const calcularTabela = calcularProjecao;
const calcularAporteNecessario = encontrarAporteNecessario;
const classificar = classificarStatus;
const moedaStr = moedaInput;
// brl local: arredonda pra inteiro antes de formatar (comportamento legado desta tela).
const brl = (v) => brlFromUtils(Math.round(Number(v) || 0), { zeroAsDash: false });

const corStatus = { viavel: "#22c55e", ajustavel: "#f59e0b", inviavel: "#ef4444" };
const labelStatus = { viavel: "Viável", ajustavel: "Ajustável", inviavel: "Inviável" };

// Aposentadoria, Liquidez, Carro, Viagem e Educação têm fluxo enxuto (3 etapas):
// — Aposentadoria: prazo + renda na Etapa 1.
// — Liquidez: gastos + meta na Etapa 1; prazo via chips na Etapa 2.
// — Carro: nome + valor + prazo na Etapa 1.
// — Viagem: destino + prazo + valor na Etapa 1.
// — Educação: nome do filho + curso + idade + prazo + valor na Etapa 1.
// Demais tipos seguem com 4 etapas. Mantemos a numeração interna 1..4 e
// "pulamos" a etapa 3 (prazo) quando esses tipos são selecionados.
// `saude` (fundo paralelo) é acumulação, então cabe aqui também.
const TIPOS_3_ETAPAS = new Set(["aposentadoria", "liquidez", "carro", "viagem", "educacao", "saude"]);

// Proteções recorrentes: NÃO são acumulação. Pular Etapa 2 (patrimônio + aporte)
// e Etapa 3 (prazo) — vai direto da Etapa 1 (configuração) para Etapa 4 (recomendação).
const TIPOS_PROTECAO = new Set(["seguros", "sucessaoPatrimonial", "planoSaude"]);
const isProtecao = (tipo) => TIPOS_PROTECAO.has(tipo);

// Cursos sugeridos no fluxo de Educação. `idadeIdeal` é a idade típica de início —
// usada para sugerir prazo automático com base na idade atual do filho.
const CURSOS_EDUCACAO = [
  { id: "ingles",      label: "Curso de Inglês",                     idadeIdeal: null },
  { id: "intercambio", label: "Intercâmbio (3-12 meses)",            idadeIdeal: null },
  { id: "tecnico",     label: "Curso Técnico / Profissionalizante",  idadeIdeal: 17 },
  { id: "graduacao",   label: "Graduação / Faculdade",                idadeIdeal: 18 },
  { id: "posGrad",     label: "Pós-Graduação",                        idadeIdeal: 22 },
  { id: "mestrado",    label: "Mestrado",                             idadeIdeal: 23 },
  { id: "mba",         label: "MBA",                                  idadeIdeal: 25 },
  { id: "doutorado",   label: "Doutorado",                            idadeIdeal: 26 },
  { id: "outro",       label: "Outro / Indefinido",                   idadeIdeal: null },
];

// Lista de instituições e cidades sugeridas no fluxo de Educação (autocomplete via <datalist>).
// Cliente pode digitar livremente — esta lista só facilita.
const INSTITUICOES_EDUCACAO = [
  // Universidades brasileiras
  "USP", "UNICAMP", "UFRJ", "UFMG", "UFRGS", "UFSC", "UFPR", "UFBA", "UFPE", "UnB",
  "UNESP", "UNIFESP", "UFSCar", "UFC", "UFG", "UFF",
  "PUC-Rio", "PUC-SP", "PUC-RS", "PUC-MG", "PUC-PR",
  "FGV-SP", "FGV-RJ", "Insper", "Mackenzie", "ESPM", "ITA", "IME", "ESALQ-USP",
  // Top internacionais
  "Harvard", "MIT", "Stanford", "Princeton", "Yale", "Columbia", "Berkeley", "UCLA",
  "Oxford", "Cambridge", "LSE", "London Business School", "Imperial College London",
  "INSEAD", "HEC Paris", "IESE", "IE Business School", "ESADE",
  "Wharton", "Booth (Chicago)", "Kellogg", "Sloan (MIT)", "Tuck", "Stern (NYU)",
  // Escolas de inglês / intercâmbio
  "EF Education First", "Kaplan International", "Embassy English", "ELS Language Centers", "Stafford House",
  // Cidades populares
  "Toronto", "Vancouver", "Montreal", "Boston", "Nova York", "San Francisco", "Los Angeles",
  "Londres", "Dublin", "Edimburgo", "Sydney", "Melbourne", "Berlim", "Madri", "Lisboa",
  "Paris", "Tóquio", "Cidade do Cabo", "Buenos Aires", "Barcelona",
];

// Calcula prazo sugerido em anos para Educação, dado idade do filho e curso.
// Retorna null se não for possível inferir (curso sem idade ideal).
function prazoSugeridoEducacao(idadeFilho, cursoId) {
  const curso = CURSOS_EDUCACAO.find(c => c.id === cursoId);
  if (!curso || !curso.idadeIdeal || !idadeFilho || idadeFilho < 0) return null;
  return Math.max(1, curso.idadeIdeal - idadeFilho);
}

// Faixas de imóvel/veículo — espelham as de ClienteFicha.jsx para que
// o cálculo de patrimônio total bata com a tela de cadastro.
const FAIXAS_IMOVEL_OBJ = [
  ...Array.from({length:50},(_,i)=>{const v=(i+1)*100000;return{label:`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`,mid:v};}),
  {label:"R$ 5.500.000,00",mid:5500000},
  {label:"R$ 6.000.000,00",mid:6000000},
  {label:"R$ 7.000.000,00",mid:7000000},
  {label:"R$ 8.000.000,00",mid:8000000},
  {label:"R$ 9.000.000,00",mid:9000000},
  {label:"R$ 10.000.000,00",mid:10000000},
  {label:"Acima de R$ 10M",mid:12000000},
];
const FAIXAS_VEICULO_OBJ = [
  ...Array.from({length:50},(_,i)=>{const v=(i+1)*10000;return{label:`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`,mid:v};}),
  {label:"R$ 600.000,00",mid:600000},
  {label:"R$ 700.000,00",mid:700000},
  {label:"R$ 800.000,00",mid:800000},
  {label:"R$ 900.000,00",mid:900000},
  {label:"R$ 1.000.000,00",mid:1000000},
  {label:"Acima de R$ 1M",mid:1200000},
];

// Patrimônio TOTAL do cliente = financeiro (carteira) + bens físicos (imóveis + veículos).
// Espelha a lógica de ClienteFicha.jsx (totalCarteira + totalImoveis + totalVeiculos)
// e mantém o fallback no campo manual `patrimonio` quando nada foi preenchido.
const CLASSES_KEYS_OBJ = ["posFixado","ipca","preFixado","acoes","fiis","multi","prevVGBL","prevPGBL","globalEquities","globalTreasury","globalFunds","globalBonds","global","outros"];
function calcTotalImoveisCliente(cliente) {
  return (cliente?.imoveis||[]).reduce((acc, im) => {
    const f = FAIXAS_IMOVEL_OBJ.find(x => x.label === im.faixa);
    const qtd = Math.max(parseInt(im.quantidade)||1, 1);
    return acc + (f ? f.mid*qtd : 0);
  }, 0);
}
function calcTotalVeiculosCliente(cliente) {
  if (!cliente) return 0;
  const totalVeicArr = (cliente.veiculos||[]).reduce((acc, v) => {
    const f = FAIXAS_VEICULO_OBJ.find(x => x.label === v.faixa);
    const qtd = Math.max(parseInt(v.quantidade)||1, 1);
    return acc + (f ? f.mid*qtd : 0);
  }, 0);
  if (totalVeicArr > 0) return totalVeicArr;
  return parseCentavos(cliente.veiculoValor)/100;
}
function calcPatrimonioTotal(cliente) {
  if (!cliente) return 0;
  const carteira = cliente.carteira || {};
  const totalCarteira = CLASSES_KEYS_OBJ.reduce((acc, k) => {
    const ativos = carteira[k + "Ativos"];
    if (Array.isArray(ativos)) {
      return acc + ativos.reduce((a, x) => a + parseCentavos(x.valor)/100, 0);
    }
    return acc + parseCentavos(carteira[k])/100;
  }, 0);
  const totalImoveis = calcTotalImoveisCliente(cliente);
  const totalVeiculos = calcTotalVeiculosCliente(cliente);
  const calc = totalCarteira + totalImoveis + totalVeiculos;
  if (calc > 0) return calc;
  return parseCentavos(cliente.patrimonio)/100;
}
const totalEtapasParaTipo = (tipo) => {
  if (isProtecao(tipo)) return 2;          // Configuração → Recomendação
  if (TIPOS_3_ETAPAS.has(tipo)) return 3;
  return 4;
};
const etapaVisualParaTipo = (etapa, tipo) => {
  if (isProtecao(tipo) && etapa === 4) return 2;
  if (TIPOS_3_ETAPAS.has(tipo) && etapa === 4) return 3;
  return etapa;
};

// Chips de prazo (em meses) — fluxo liquidez. Cliente escolhe sem digitar.
const PRAZOS_LIQUIDEZ = [
  { meses: 6,  label: "6 meses" },
  { meses: 9,  label: "9 meses" },
  { meses: 12, label: "1 ano" },
  { meses: 18, label: "1,5 ano" },
  { meses: 24, label: "2 anos" },
];

// Cores principais por tipo (paleta premium)
const coresPorTipo = {
  aposentadoria:       "#FFCA3A",
  imovel:              "#8AC926",
  liquidez:            "#4ADE80",
  carro:               "#FF6B35",
  oportunidade:        "#06B6D4",
  viagem:              "#5DD9C1",
  educacao:            "#2274A5",
  saude:               "#1982C4",
  sucessaoPatrimonial: "#6A4C93",
  seguros:             "#EF4444",
  planoSaude:          "#EC4899",
  personalizado:       "#00CC66",
};

// Gradientes sofisticados por tipo — Dark + Color tint
const gradientsPorTipo = {
  aposentadoria:       "linear-gradient(145deg, #2a1f00 0%, #3d2e00 60%, rgba(255,202,58,0.18) 100%)",
  imovel:              "linear-gradient(145deg, #0f2006 0%, #1a360a 60%, rgba(138,201,38,0.18) 100%)",
  liquidez:            "linear-gradient(145deg, #012218 0%, #023826 60%, rgba(74,222,128,0.18) 100%)",
  carro:               "linear-gradient(145deg, #2a0e00 0%, #3d1800 60%, rgba(255,107,53,0.18) 100%)",
  oportunidade:        "linear-gradient(145deg, #021e26 0%, #03313e 60%, rgba(6,182,212,0.18) 100%)",
  viagem:              "linear-gradient(145deg, #042522 0%, #0a3430 60%, rgba(93,217,193,0.18) 100%)",
  educacao:            "linear-gradient(145deg, #061c32 0%, #0d2a48 60%, rgba(34,116,165,0.18) 100%)",
  saude:               "linear-gradient(145deg, #041626 0%, #082238 60%, rgba(25,130,196,0.18) 100%)",
  sucessaoPatrimonial: "linear-gradient(145deg, #0c0820 0%, #160f30 60%, rgba(106,76,147,0.18) 100%)",
  seguros:             "linear-gradient(145deg, #2a0a0a 0%, #3d1010 60%, rgba(239,68,68,0.18) 100%)",
  planoSaude:          "linear-gradient(145deg, #2a0c1b 0%, #3d1026 60%, rgba(236,72,153,0.18) 100%)",
  personalizado:       "linear-gradient(145deg, #001f10 0%, #003218 60%, rgba(0,204,102,0.18) 100%)",
};

const emojisPorTipo = {
  aposentadoria: "🏖️",
  imovel: "🏠",
  liquidez: "🛟",
  carro: "🚗",
  oportunidade: "🎯",
  viagem: "✈️",
  educacao: "📚",
  saude: "💪",
  sucessaoPatrimonial: "👨‍👩‍👧‍👦",
  seguros: "🛡️",
  planoSaude: "❤️‍🩹",
  personalizado: "⭐"
};

function SectionLabel({ children, count, cor = T.textMuted }) {
  return (
    <div style={{
      fontSize: 9, color: cor, letterSpacing: "0.16em", textTransform: "uppercase",
      marginBottom: 10, marginTop: 4, fontWeight: 600,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span>{children}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{count}</span>
      <div style={{ flex: 1, height: "0.5px", background: T.border }} />
    </div>
  );
}

// ── Componente: Seletor de ativos para vincular ao objetivo ──
function AtivosPicker({ carteira, tipoObjetivo, selecionados, setSelecionados, totalCalculado, onIrCarteira }) {
  const todos = listarAtivosCarteira(carteira);
  const label = TIPO_OBJETIVO_PARA_LABEL[tipoObjetivo];
  const [confirmTransfer, setConfirmTransfer] = useState(null);

  if (todos.length === 0) {
    return (
      <div style={{
        background: "rgba(240,162,2,0.05)",
        border: `0.5px solid ${T.goldBorder}`,
        borderRadius: T.radiusMd,
        padding: "16px 18px",
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, color: T.gold, marginBottom: 6, fontWeight: 500 }}>
          Nenhum ativo cadastrado na carteira
        </div>
        <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.7, marginBottom: 12 }}>
          Cadastre seus investimentos em "Carteira" para poder vincular ativos específicos a este objetivo.
          Ou use o modo "Valor manual" acima.
        </div>
        {onIrCarteira && (
          <button
            onClick={onIrCarteira}
            style={{ padding: "9px 16px", background: T.goldDim, border: `1px solid ${T.goldBorder}`, borderRadius: T.radiusSm, color: T.gold, fontSize: 11, cursor: "pointer", fontFamily: T.fontFamily, letterSpacing: "0.06em" }}
          >
            Ir para Carteira →
          </button>
        )}
      </div>
    );
  }

  // Três grupos: livres > vinculados a este objetivo > vinculados a outro
  const livres = todos.filter(a => !a.objetivo);
  const sugeridos = todos.filter(a => (a.objetivo || "") === label);
  const outroObjetivo = todos.filter(a => a.objetivo && a.objetivo !== label);

  function toggle(a) {
    const k = `${a.classeKey}::${a.id}`;
    const n = new Set(selecionados);
    if (n.has(k)) n.delete(k); else n.add(k);
    setSelecionados(n);
  }

  const LinhaAtivo = ({ a, isOutro = false }) => {
    const k = `${a.classeKey}::${a.id}`;
    const marcado = selecionados.has(k);
    const onClickItem = () => {
      if (isOutro && !marcado) setConfirmTransfer(a);
      else toggle(a);
    };
    return (
      <div
        onClick={onClickItem}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 14px",
          background: marcado ? "rgba(240,162,2,0.08)" : "rgba(255,255,255,0.02)",
          border: marcado ? `0.5px solid ${T.goldBorder}` : `0.5px solid ${T.border}`,
          borderRadius: T.radiusSm,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          background: marcado ? T.gold : "transparent",
          border: marcado ? `1px solid ${T.gold}` : `1px solid ${T.textMuted}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          color: T.bg, fontSize: 12, fontWeight: 700,
        }}>
          {marcado ? "✓" : ""}
        </div>
        <div style={{ width: 4, height: 24, borderRadius: 2, background: a.classeCor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: T.textPrimary, fontWeight: 500, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {a.nome || "Ativo sem nome"}
          </div>
          <div style={{ fontSize: 10, color: T.textMuted, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>{a.classeLabel}</span>
            {isOutro && (
              <span style={{ color: "#f59e0b" }}>· vinculado a "{a.objetivo}"</span>
            )}
          </div>
        </div>
        {isOutro && !marcado ? (
          <div style={{
            fontSize: 10, color: "#f59e0b", fontWeight: 600, flexShrink: 0,
            border: "0.5px solid rgba(245,158,11,0.4)", borderRadius: 6,
            padding: "4px 10px", letterSpacing: "0.04em", whiteSpace: "nowrap",
          }}>Editar objetivo</div>
        ) : (
          <div style={{ fontSize: 13, color: marcado ? T.gold : T.textSecondary, fontWeight: 600, flexShrink: 0 }}>
            {a.valorReais.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}
      </div>
    );
  };



  return (
    <div style={{ marginBottom: 20 }}>
      {/* Header com total */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(240,162,2,0.05)",
        border: `0.5px solid ${T.goldBorder}`,
        borderRadius: T.radiusMd,
        padding: "12px 16px",
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 9, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
            {selecionados.size} {selecionados.size === 1 ? "ativo vinculado" : "ativos vinculados"}
          </div>
          <div style={{ fontSize: 18, color: T.gold, fontWeight: 600 }}>
            {totalCalculado.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, textAlign: "right", lineHeight: 1.5 }}>
          Patrimônio<br />
          somado dos ativos
        </div>
      </div>

      {livres.length > 0 && (
        <>
          <SectionLabel count={livres.length}>Sem objetivo vinculado</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {livres.map(a => <LinhaAtivo key={`${a.classeKey}-${a.id}`} a={a} />)}
          </div>
        </>
      )}

      {sugeridos.length > 0 && (
        <>
          <SectionLabel count={sugeridos.length} cor={T.gold}>Vinculados a este objetivo</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {sugeridos.map(a => <LinhaAtivo key={`${a.classeKey}-${a.id}`} a={a} />)}
          </div>
        </>
      )}

      {outroObjetivo.length > 0 && (
        <>
          <SectionLabel count={outroObjetivo.length} cor="#f59e0b">Vinculados a outro objetivo</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {outroObjetivo.map(a => <LinhaAtivo key={`${a.classeKey}-${a.id}`} a={a} isOutro />)}
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 14, lineHeight: 1.6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>Os ativos selecionados serão marcados na sua carteira com o objetivo "{label}" e contabilizados como patrimônio deste plano.</span>
        {onIrCarteira && (
          <button
            onClick={onIrCarteira}
            style={{ padding: "7px 12px", background: "rgba(255,255,255,0.04)", border: `0.5px solid ${T.border}`, borderRadius: T.radiusSm, color: T.textSecondary, fontSize: 10, cursor: "pointer", fontFamily: T.fontFamily, letterSpacing: "0.06em", whiteSpace: "nowrap" }}
          >
            Abrir Carteira →
          </button>
        )}
      </div>

      {/* Modal de confirmação para transferir ativo de outro objetivo */}
      {confirmTransfer && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onClick={() => setConfirmTransfer(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: T.bgCard, border: `0.5px solid ${T.border}`, borderRadius: T.radiusLg,
              width: 440, maxWidth: "96vw", padding: "26px 28px 22px", boxShadow: T.shadowLg,
            }}
          >
            <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 8 }}>
              Confirmar alteração
            </div>
            <div style={{ fontSize: 17, color: T.textPrimary, fontWeight: 400, marginBottom: 14, letterSpacing: "-0.01em" }}>
              Redirecionar este ativo?
            </div>
            <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.7, marginBottom: 22 }}>
              <strong style={{ color: T.textPrimary }}>{confirmTransfer.nome || "Ativo sem nome"}</strong><br />
              Atualmente vinculado a{" "}
              <strong style={{ color: "#f59e0b" }}>"{confirmTransfer.objetivo}"</strong>.<br />
              Deseja transferir para{" "}
              <strong style={{ color: T.gold }}>"{label}"</strong>?
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmTransfer(null)}
                style={{ padding: "11px 20px", background: "transparent", border: `0.5px solid ${T.border}`, borderRadius: T.radiusMd, color: T.textSecondary, fontSize: 11, cursor: "pointer", fontFamily: T.fontFamily, letterSpacing: "0.14em", textTransform: "uppercase" }}
              >Não</button>
              <button
                onClick={() => { toggle(confirmTransfer); setConfirmTransfer(null); }}
                style={{ padding: "11px 22px", background: T.goldDim, border: `1px solid ${T.goldBorder}`, borderRadius: T.radiusMd, color: T.gold, fontSize: 11, cursor: "pointer", fontFamily: T.fontFamily, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}
              >Sim, transferir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Objetivos() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isCliente, profile } = useAuth();

  // Cliente só pode acessar os próprios objetivos
  useEffect(() => {
    if (isCliente && profile?.clienteId && id !== profile.clienteId) {
      navigate(`/cliente/${profile.clienteId}/objetivos`, { replace: true });
    }
  }, [isCliente, profile?.clienteId, id, navigate]);
  const { obterIPCA } = useCotacoesReais();
  const [objetivos, setObjetivos] = useState([]);
  const [carteira, setCarteira] = useState({});
  const [clienteNome, setClienteNome] = useState("");
  const [selecionado, setSelecionado] = useState(null);
  const [etapa, setEtapa] = useState(0);
  const [form, setForm] = useState({});
  const [editarIdx, setEditarIdx] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [recalibrar, setRecalibrar] = useState(null);
  const [ipca, setIpca] = useState(3.81);
  // modo de preenchimento do patrimônio: 'manual' | 'ativos'
  const [patrimSource, setPatrimSource] = useState("manual");
  // ativos selecionados para este objetivo: Set de "classeKey::ativoId"
  const [ativosSelecionados, setAtivosSelecionados] = useState(new Set());
  // modal de confirmação ao clicar no X do card — guarda o índice do objetivo
  const [confirmAcao, setConfirmAcao] = useState(null);
  // Mensagem de erro da última tentativa de salvar (aparece no formulário)
  const [erroSalvar, setErroSalvar] = useState("");
  // Gastos mensais já cadastrados pelo cliente (para puxar no fluxo de Liquidez)
  const [gastosCadastrados, setGastosCadastrados] = useState(0);
  // Sugestões automáticas baseadas em lacunas de proteção do cadastro:
  // se o cliente respondeu "Não" para seguro de vida / plano sucessório / plano de saúde
  // e ainda não criou esse objetivo, mostramos um card de "Recomendado".
  const [sugestoes, setSugestoes] = useState([]);
  // Snapshot do cadastro para puxar contexto nos fluxos (renda, filhos, etc.)
  const [cliente, setCliente] = useState(null);

  const carregarCliente = useCallback(async () => {
    try {
      const r = await lerClienteComFallback(id);
      if (r.exists && r.data) {
        const objs = r.data.objetivos || [];
        setObjetivos(objs);
        setCarteira(r.data.carteira || {});
        setClienteNome(r.data.nome || "");
        setCliente(r.data);
        setGastosCadastrados(parseCentavos(r.data.gastosMensaisManual || "0"));

        // Detecta proteções faltantes a partir do cadastro
        const tiposExistentes = new Set(objs.map(o => o.tipo));
        const protecoesFaltantes = [
          {
            tipo: "seguros",
            label: "Seguro de Vida e de Veículos",
            ativo: r.data.temSeguroVida === false,
            motivo: "Você indicou no cadastro que ainda não tem seguro de vida — proteja a renda da família contra imprevistos.",
            acao: "Configurar agora",
          },
          {
            tipo: "sucessaoPatrimonial",
            label: "Sucessão Patrimonial",
            ativo: r.data.temPlanoSucessorio === false,
            motivo: "Sem planejamento sucessório, o inventário pode travar a família por meses ou anos. Vale resolver enquanto está tranquilo.",
            acao: "Estruturar plano",
          },
          {
            tipo: "planoSaude",
            label: "Plano de Saúde",
            ativo: r.data.temPlanoSaude === false,
            motivo: "Você indicou que ainda não tem plano de saúde — um único evento sério pode comprometer anos de patrimônio acumulado.",
            acao: "Planejar cobertura",
          },
        ].filter(s => s.ativo && !tiposExistentes.has(s.tipo));

        setSugestoes(protecoesFaltantes);
      }
    } catch (e) {
      console.error("[Objetivos] falha ao carregar cliente:", e);
    }
  }, [id]);

  // Carregar cliente no mount e ao voltar para a aba (sincroniza com outras páginas)
  useEffect(() => {
    carregarCliente();
    const onFocus = () => carregarCliente();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [carregarCliente]);

  // Sempre que o tipo do objetivo mudar, pré-seleciona ativos já marcados
  useEffect(() => {
    if (!form.tipo || !carteira) return;
    const existentes = ativosDoObjetivo(carteira, form.tipo);
    setAtivosSelecionados(new Set(existentes.map(a => `${a.classeKey}::${a.id}`)));
  }, [form.tipo, carteira]);

  // Para planoSaude, calcula a meta total a partir da mensalidade × prazo × 12
  // (a UI não pede meta manual; o card e o salvamento dependem dela).
  useEffect(() => {
    if (form.tipo !== "planoSaude") return;
    const mensCent = parseCentavos(form.aporte || "0");
    const anos = parseInt(form.prazo) || 0;
    if (mensCent <= 0 || anos <= 0) return;
    const totalCent = String(mensCent * 12 * anos);
    if (form.meta !== totalCent) {
      setForm(f => ({ ...f, meta: totalCent }));
    }
  }, [form.tipo, form.aporte, form.prazo, form.meta]);

  // Recalcula patrimAtual automaticamente quando em modo "ativos"
  useEffect(() => {
    if (patrimSource !== "ativos") return;
    const todos = listarAtivosCarteira(carteira);
    const soma = todos.reduce((acc, a) => {
      const k = `${a.classeKey}::${a.id}`;
      return acc + (ativosSelecionados.has(k) ? a.valorReais : 0);
    }, 0);
    setForm(f => ({ ...f, patrimAtual: String(Math.round(soma * 100)) }));
  }, [ativosSelecionados, patrimSource, carteira]);

  // Obter IPCA dinâmico — cache em localStorage por 24h para não bater no BCB a cada load
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const cache = JSON.parse(localStorage.getItem("wealthtrack_ipca") || "null");
        const umDia = 24 * 60 * 60 * 1000;
        if (cache && Date.now() - cache.ts < umDia && cache.valor) {
          if (!cancelado) setIpca(parseFloat(cache.valor));
          return;
        }
        const dados = await obterIPCA();
        if (dados?.valor && !cancelado) {
          setIpca(parseFloat(dados.valor));
          localStorage.setItem("wealthtrack_ipca", JSON.stringify({ valor: dados.valor, ts: Date.now() }));
        }
      } catch (erro) {
        console.error("Erro ao obter IPCA:", erro);
      }
    })();
    return () => { cancelado = true; };
  }, [obterIPCA]);

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function iniciarObj(tipo) {
    setSelecionado(tipo);
    setForm({ tipo: tipo.id, label: tipo.label });
    setEtapa(1);
  }

  // Deep-link: ?criar=tipo abre o fluxo de criar objetivo direto no tipo
  // (acionado pelas notificações de "casa", "carro", "viagem", "aposentadoria").
  useEffect(() => {
    const tipoCriar = searchParams.get("criar");
    if (!tipoCriar || etapa !== 0) return;
    const tipo = TIPOS.find(t => t.id === tipoCriar);
    if (tipo) {
      // ?editar=N indica que estamos preenchendo um objetivo já existente no índice N,
      // não criando um novo. salvar() vai atualizar no lugar em vez de fazer push.
      const editar = searchParams.get("editar");
      setEditarIdx(editar !== null ? parseInt(editar, 10) : null);
      iniciarObj(tipo);
      // Limpa os params da URL pra não reabrir ao voltar
      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function salvar() {
    setSalvando(true);
    setErroSalvar("");
    try {
      // Usa o state local (carteira já carregada). Para cliente, getDoc direto
      // é bloqueado pelas rules — mas o helper já populou `carteira` via CF.
      const dados = { carteira };
      const selecaoList = [...ativosSelecionados].map(k => {
        const [classeKey, ativoId] = k.split("::");
        return { classeKey, ativoId };
      });
      // Limpa qualquer campo undefined do form (Firestore rejeita undefined).
      // Preserva strings vazias e null, que são válidos.
      const formLimpo = Object.fromEntries(
        Object.entries(form || {}).filter(([, v]) => v !== undefined)
      );
      const objComVinculos = {
        tipo: formLimpo.tipo || "",
        label: formLimpo.label || "",
        ...formLimpo,
        patrimSource,
        ativosVinculados: patrimSource === "ativos" ? selecaoList : [],
      };
      // Se ?editar=N foi passado, atualiza o objetivo existente no índice N
      // em vez de criar um novo (evita duplicatas ao preencher objetivo vazio).
      const lista = editarIdx !== null
        ? objetivos.map((o, i) => i === editarIdx ? objComVinculos : o)
        : [...objetivos, objComVinculos];
      const novaCarteira = patrimSource === "ativos"
        ? atualizarVinculoAtivos(dados.carteira || {}, form.tipo, selecaoList)
        : null;
      // Patch mínimo + merge:true: NÃO sobrescreve userId/advisorId que a regra
      // do Firestore exige imutáveis pra cliente final. Sem merge, o cliente
      // perde acesso ao próprio doc na hora.
      const patch = stripUndefined({
        objetivos: lista,
        ...(novaCarteira ? { carteira: novaCarteira } : {}),
      });
      await setDoc(doc(db, "clientes", id), patch, { merge: true });
      invalidarCacheCliente(id);
      setObjetivos(lista);
      if (novaCarteira) setCarteira(novaCarteira);
      setSelecionado(null);
      setEtapa(0);
      setForm({});
      setEditarIdx(null);
      setPatrimSource("manual");
      setAtivosSelecionados(new Set());
    } catch (e) {
      console.error("Erro ao salvar objetivo:", e);
      setErroSalvar(
        e?.code === "permission-denied"
          ? "Sem permissão para salvar. Verifique se você está logado."
          : e?.code === "unavailable"
          ? "Sem conexão. Verifique sua internet e tente novamente."
          : `Erro ao salvar: ${e?.message || "Tente novamente."}`
      );
    } finally {
      setSalvando(false);
    }
  }

  async function deletar(i) {
    const lista = objetivos.filter((_, idx) => idx !== i);
    await setDoc(
      doc(db, "clientes", id),
      stripUndefined({ objetivos: lista }),
      { merge: true }
    );
    invalidarCacheCliente(id);
    setObjetivos(lista);
    if (recalibrar === i) setRecalibrar(null);
  }

  function diagnostico(obj) {
    const inicial = parseCentavos(obj.patrimAtual) / 100;
    const aporte = parseCentavos(obj.aporte) / 100;
    const meta = parseCentavos(obj.meta) / 100;
    const prazo = parseInt(obj.prazo) || 0;
    const anosNec = encontrarAnos(inicial, aporte, meta);
    const status = prazo > 0 ? classificar(anosNec, prazo) : (anosNec ? "viavel" : "inviavel");
    const tabela = calcularTabela(inicial, aporte, prazo || Math.ceil(anosNec || 30) + 2);
    const ultimo = tabela[tabela.length - 1];
    return { anosNec, status, ultimo, inicial, aporte, meta, prazo };
  }

  // ── BOTÃO FLUTUANTE VOLTAR ──
  const BotoesNavegacao = () => {
    const handleVoltar = () => {
      if (etapa === 0) {
        navigate(`/cliente/${id}`);
      } else if (isProtecao(form.tipo) && etapa === 4) {
        // Proteções: voltar de 4 (recomendação) vai pra 1 (configuração)
        setEtapa(1);
      } else if (TIPOS_3_ETAPAS.has(form.tipo) && etapa === 4) {
        // Tipos com 3 etapas pulam a etapa 3 (prazo) — voltar de 4 vai pra 2
        setEtapa(2);
      } else {
        setEtapa(etapa - 1);
      }
    };

    const handleProximo = () => {
      if (etapa > 0 && etapa < 4) {
        // Proteções: pula direto da 1 (configuração) para a 4 (recomendação)
        if (isProtecao(form.tipo) && etapa === 1) {
          setEtapa(4);
        } else if (TIPOS_3_ETAPAS.has(form.tipo) && etapa === 2) {
          // Tipos com 3 etapas: pula direto da 2 para a 4 (diagnóstico)
          setEtapa(4);
        } else {
          setEtapa(etapa + 1);
        }
      }
    };

    return (
      <>
        {/* Voltar — sempre visível */}
        <button
          onClick={handleVoltar}
          className="floating-nav-btn is-left"
          aria-label="Voltar"
        >
          ←
        </button>

        {/* Próximo — só visível dentro do formulário (etapas 1-3) */}
        {etapa > 0 && etapa < 4 && (
          <button
            onClick={handleProximo}
            className="floating-nav-btn is-right"
            aria-label="Próximo"
          >
            →
          </button>
        )}
      </>
    );
  };

  // ── TELA 0 — Lista de objetivos + cards de seleção ──
  if (etapa === 0 && !selecionado) return (
    <div className="dashboard-container has-sidebar" style={{ minHeight:"100vh", background:T.bg, fontFamily:T.fontFamily }}>
      <Sidebar mode="cliente" clienteId={id} clienteNome={clienteNome || ""} />
      <Navbar
        showLogout={true}
        actionButtons={[
          {
            icon: "←",
            label: "Voltar",
            variant: "secondary",
            onClick: () => navigate(`/cliente/${id}`),
            title: "Voltar ao cliente",
          },
          {
            label: "Simulador",
            variant: "secondary",
            onClick: () => navigate(`/cliente/${id}/simulador`),
            title: "Abrir simulador de objetivos",
          },
        ]}
      />
      <div className="dashboard-content with-sidebar cliente-zoom pi-page-cliente" style={{ maxWidth:1280, margin:"0 auto", padding:"28px 28px 60px" }}>

        <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:4 }}>Meus Objetivos</div>
        <div style={{ fontSize:12, color:T.textSecondary, marginBottom:28, lineHeight:1.6 }}>
          Defina o que você quer conquistar. O sistema calcula quanto guardar por mês.
        </div>

        {/* Objetivos configurados */}
        {objetivos.length > 0 && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
              <span style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:T.textMuted }}>Configurados</span>
              <div style={{ flex:1, height:"0.5px", background:T.border }}/>
            </div>

            <div className="objetivos-grid-2col" style={{ display:"grid", gap:16, marginBottom:28, alignItems:"stretch" }}>
            {objetivos.map((obj, i) => {
              const { anosNec, status, inicial, aporte, meta, prazo } = diagnostico(obj);
              const pct = Math.min(100, Math.round((parseCentavos(obj.patrimAtual) / 100) / (meta || 1) * 100));

              const gradient = gradientsPorTipo[obj.tipo] || gradientsPorTipo.personalizado;
              const emoji = emojisPorTipo[obj.tipo] || "⭐";

              return (
                <div key={i} style={{ display:"flex", flexDirection:"column" }}>
                  {/* Card do objetivo — NUBANK STYLE */}
                  <div style={{
                    background: gradient,
                    borderRadius: 16,
                    padding: "20px 18px",
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    transform: "translateY(0)"
                  }}
                  onClick={() => navigate(`/objetivo/${id}/${i}`)}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.boxShadow = "0 12px 32px rgba(0,0,0,0.4)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
                  }}>
                    {/* Emoji grande no topo */}
                    <div style={{ fontSize:40, marginBottom:10, lineHeight:1 }}>{emoji}</div>

                    {/* Título e meta */}
                    <div>
                      <div style={{ fontSize:15, fontWeight:400, color:"#fff", marginBottom:4, lineHeight:1.2 }}>
                        {obj.nomeCustom || obj.label}
                      </div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.9)", marginBottom:2 }}>
                        Meta: {brl(meta)}
                      </div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.7)", marginBottom:12 }}>
                        até {prazo} {prazo === 1 ? "ano" : "anos"}
                      </div>

                      {/* Barra de progresso maior */}
                      <div style={{ height:5, background:"rgba(255,255,255,0.2)", borderRadius:3, overflow:"hidden", marginBottom:10 }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:"rgba(255,255,255,0.9)", borderRadius:3, transition:"width 0.4s" }}/>
                      </div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.8)" }}>
                        {pct}% atingido
                      </div>
                    </div>

                    {/* Info + Status */}
                    <div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.85)", marginBottom:12, lineHeight:1.6 }}>
                        Aporte: R$ {Math.round(aporte).toLocaleString("pt-BR")}/mês<br/>
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.7)" }}>
                          📊 Renda: 1,16% a.m. | 📈 Infl: {ipca.toFixed(2)}%
                        </span><br/>
                        Necessário: {anosNec ? anosNec + " anos" : "50+ anos"}
                      </div>

                      {/* Pills de status */}
                      <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"space-between" }}>
                        <span style={{
                          fontSize:11,
                          padding:"5px 12px",
                          borderRadius:20,
                          background:"rgba(255,255,255,0.25)",
                          color:"#fff",
                          fontWeight:500,
                          whiteSpace:"nowrap"
                        }}>
                          {status === "viavel" ? "✓" : status === "ajustavel" ? "⚠" : "✕"} {labelStatus[status]}
                        </span>
                        <button
                          style={{
                            background:"none",
                            border:"none",
                            color:"rgba(255,255,255,0.6)",
                            fontSize:18,
                            cursor:"pointer",
                            lineHeight:1,
                            padding:0
                          }}
                          onClick={(e) => { e.stopPropagation(); setConfirmAcao(i); }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Painel Recalibrar */}
                  {recalibrar === i && (() => {
                    const aporteNec = calcularAporteNecessario(inicial, meta, prazo);
                    const novoPrazo = encontrarAnos(inicial, aporte, meta, 80);
                    return (
                      <div style={{ background:"rgba(37,99,235,0.04)", border:"0.5px solid rgba(37,99,235,0.15)", borderRadius:T.radiusMd, padding:"20px 18px", marginTop:4 }}>
                        <div style={{ fontSize:13, fontWeight:400, color:T.textPrimary, marginBottom:10, lineHeight:1.4 }}>
                          Seu plano precisa de ajustes
                        </div>
                        <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.7, marginBottom:16 }}>
                          Com o que você guarda hoje, você não chega aos <b style={{ color:T.goldLight }}>{brl(meta)}</b> em
                          <b style={{ color:T.goldLight }}> {prazo} anos</b>.
                        </div>

                        <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:T.radiusMd, padding:"14px 16px", fontSize:12, color:T.textSecondary, lineHeight:1.7, marginBottom:14 }}>
                          Para chegar no prazo, você precisa guardar&nbsp;
                          <b style={{ color:"#22c55e" }}>{brl(aporteNec)} por mês</b> em vez de&nbsp;
                          <b style={{ color:"#ef4444" }}>{brl(aporte)}</b>.
                        </div>

                        {[
                          { n:"01", titulo:"Guardar mais por mês", desc:`Guardando ${brl(aporteNec)} por mês, você atinge o objetivo em ${prazo} anos.` },
                          { n:"02", titulo:"Aumentar o prazo",  desc:`Continuando com ${brl(aporte)} por mês, você leva cerca de ${novoPrazo ? novoPrazo + " anos" : "mais de 50 anos"} para chegar lá.` },
                          { n:"03", titulo:"Investir melhor", desc:"Trocar os investimentos por outros que rendem mais pode acelerar o crescimento." },
                          { n:"04", titulo:"Reorganizar o patrimônio", desc:"Em alguns casos, vender ou trocar bens liberam dinheiro para o objetivo." },
                        ].map(a => (
                          <div key={a.n} style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:10 }}>
                            <span style={{ fontSize:18, fontWeight:300, color:"rgba(240,162,2,0.3)", flexShrink:0, lineHeight:1, marginTop:2 }}>{a.n}</span>
                            <div>
                              <div style={{ fontSize:12, color:T.textPrimary, marginBottom:3 }}>{a.titulo}</div>
                              <div style={{ fontSize:12, color:T.textMuted, lineHeight:1.6 }}>{a.desc}</div>
                            </div>
                          </div>
                        ))}

                        <div style={{ fontSize:12, color:T.gold, fontStyle:"italic", lineHeight:1.6, paddingTop:12, borderTop:`0.5px solid rgba(240,162,2,0.12)`, marginTop:4 }}>
                          Escolha um dos caminhos acima para ajustar o plano.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            </div>
          </>
        )}

        {/* Recomendações com base no cadastro: proteções faltantes */}
        {sugestoes.length > 0 && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, marginTop: objetivos.length > 0 ? 32 : 0 }}>
              <div style={{ width:6, height:6, borderRadius:3, background:T.gold, boxShadow:`0 0 8px ${T.goldBorder}` }} />
              <span style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:T.gold, fontWeight:600 }}>Recomendado pra você</span>
              <div style={{ flex:1, height:"0.5px", background:T.border }}/>
            </div>
            <div style={{ fontSize:12, color:T.textSecondary, marginBottom:18, lineHeight:1.7, maxWidth:680 }}>
              Identificamos no seu cadastro algumas proteções que ainda não estão estruturadas. Não são objetivos opcionais —
              são fundações do seu plano financeiro. Configure quando estiver pronto.
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:14, marginBottom:32 }}>
              {sugestoes.map(s => {
                const tipoMeta = TIPOS.find(t => t.id === s.tipo);
                const cor = coresPorTipo[s.tipo] || T.gold;
                const emoji = emojisPorTipo[s.tipo] || "🛡️";
                return (
                  <div
                    key={s.tipo}
                    onClick={() => iniciarObj(tipoMeta || { id: s.tipo, label: s.label })}
                    style={{
                      background:"linear-gradient(145deg, rgba(240,162,2,0.08) 0%, rgba(240,162,2,0.02) 100%)",
                      border:`0.5px dashed ${T.goldBorder}`,
                      borderLeft:`3px solid ${T.gold}`,
                      borderRadius:T.radiusLg,
                      padding:"18px 20px",
                      cursor:"pointer",
                      transition:"all 0.25s ease",
                      display:"flex",
                      flexDirection:"column",
                      gap:12,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "linear-gradient(145deg, rgba(240,162,2,0.14) 0%, rgba(240,162,2,0.04) 100%)";
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "linear-gradient(145deg, rgba(240,162,2,0.08) 0%, rgba(240,162,2,0.02) 100%)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                        <div style={{ fontSize:28, lineHeight:1, flexShrink:0 }}>{emoji}</div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:9, color:T.gold, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>
                            Ação recomendada
                          </div>
                          <div style={{ fontSize:15, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                            {s.label}
                          </div>
                        </div>
                      </div>
                      <span style={{
                        fontSize:9, color:T.gold, letterSpacing:"0.12em", textTransform:"uppercase",
                        background:T.goldDim, padding:"4px 10px", borderRadius:20, fontWeight:600,
                        whiteSpace:"nowrap", border:`0.5px solid ${T.goldBorder}`,
                      }}>
                        Pendente
                      </span>
                    </div>
                    <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.7 }}>
                      {s.motivo}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, color:cor, fontSize:11, fontWeight:500, letterSpacing:"0.06em", marginTop:"auto" }}>
                      <span>→</span>
                      <span>{s.acao}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Adicionar objetivo */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20, marginTop: (objetivos.length > 0 || sugestoes.length > 0) ? 32 : 0 }}>
          <span style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:T.textMuted }}>Adicionar objetivo</span>
          <div style={{ flex:1, height:"0.5px", background:T.border }}/>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:14 }}>
          {TIPOS.map(t => {
            const cor = coresPorTipo[t.id] || "#F0A202";
            const [r,g,b] = cor.slice(1).match(/.{2}/g).map(h=>parseInt(h,16));
            const rgb = `${r},${g},${b}`;
            return (
              <div
                key={t.id}
                style={{
                  background: `rgba(${rgb}, 0.07)`,
                  border: `0.5px solid rgba(${rgb}, 0.22)`,
                  borderRadius: 18,
                  padding: "22px 16px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 10,
                  transition: "all 0.3s ease",
                  transform: "translateY(0)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)"
                }}
                onClick={() => iniciarObj(t)}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `rgba(${rgb}, 0.16)`;
                  e.currentTarget.style.border = `0.5px solid rgba(${rgb}, 0.45)`;
                  e.currentTarget.style.boxShadow = `0 8px 24px rgba(${rgb}, 0.2)`;
                  e.currentTarget.style.transform = "translateY(-3px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = `rgba(${rgb}, 0.07)`;
                  e.currentTarget.style.border = `0.5px solid rgba(${rgb}, 0.22)`;
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <span style={{ fontSize:34, lineHeight:1 }}>{emojisPorTipo[t.id] || "⭐"}</span>
                <span style={{ fontSize:11, color:T.textPrimary, lineHeight:1.4, fontWeight:400 }}>
                  {t.label}
                </span>
                <span style={{ fontSize:13, color:cor, fontWeight:500 }}>→</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal confirmação editar/excluir objetivo */}
      {confirmAcao !== null && (() => {
        const obj = objetivos[confirmAcao];
        if (!obj) return null;
        const nome = obj.nomeCustom || obj.label;
        const emoji = emojisPorTipo[obj.tipo] || "⭐";
        return (
          <div
            onClick={() => setConfirmAcao(null)}
            style={{
              position:"fixed", inset:0, zIndex:100,
              background:"rgba(0,0,0,0.75)",
              backdropFilter:"blur(4px)",
              display:"flex", alignItems:"center", justifyContent:"center",
              padding:20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background:T.cardBg || "#111",
                border:`0.5px solid ${T.border}`,
                borderRadius:T.radiusLg || 16,
                padding:"28px 24px",
                maxWidth:400, width:"100%",
                boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ fontSize:40, textAlign:"center", marginBottom:12, lineHeight:1 }}>{emoji}</div>
              <div style={{ fontSize:16, fontWeight:400, color:T.textPrimary, textAlign:"center", marginBottom:6, lineHeight:1.3 }}>
                {nome}
              </div>
              <div style={{ fontSize:12, color:T.textSecondary, textAlign:"center", marginBottom:24, lineHeight:1.6 }}>
                O que você deseja fazer com este objetivo?
              </div>

              <button
                onClick={() => { const i = confirmAcao; setConfirmAcao(null); navigate(`/objetivo/${id}/${i}`); }}
                style={{
                  width:"100%", padding:"13px 16px", marginBottom:10,
                  background:T.goldDim, border:`1px solid ${T.goldBorder}`,
                  borderRadius:T.radiusMd, color:T.gold,
                  fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase",
                  cursor:"pointer", fontFamily:T.fontFamily,
                }}
              >
                Editar objetivo
              </button>

              <button
                onClick={() => { const i = confirmAcao; setConfirmAcao(null); deletar(i); }}
                style={{
                  width:"100%", padding:"13px 16px", marginBottom:10,
                  background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.35)",
                  borderRadius:T.radiusMd, color:"#ef4444",
                  fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase",
                  cursor:"pointer", fontFamily:T.fontFamily,
                }}
              >
                Excluir objetivo
              </button>

              <button
                onClick={() => setConfirmAcao(null)}
                style={{
                  width:"100%", padding:"12px 16px",
                  background:"transparent", border:`0.5px solid ${T.border}`,
                  borderRadius:T.radiusMd, color:T.textMuted,
                  fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase",
                  cursor:"pointer", fontFamily:T.fontFamily,
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      <BotoesNavegacao />
    </div>
  );

  // ── FORMULÁRIO — Etapas 1 a 4 ──
  const meta = parseCentavos(form.meta) / 100;
  const inicial = parseCentavos(form.patrimAtual) / 100;
  const aporte = parseCentavos(form.aporte) / 100;
  // Liquidez e Viagem aceitam prazos fracionários (ex.: 0.5 = 6 meses). Demais tipos usam anos inteiros.
  const prazo = ((form.tipo === "liquidez" || form.tipo === "viagem") ? parseFloat(form.prazo) : parseInt(form.prazo)) || 0;
  const fmtPrazo = (p) => {
    if (!p || p <= 0) return "—";
    if (p < 1) return `${Math.round(p * 12)} meses`;
    if (p === Math.floor(p)) return `${p} ${p === 1 ? "ano" : "anos"}`;
    // valores como 1.5 → "1,5 ano"
    return `${p.toString().replace(".", ",")} ${p === 1 ? "ano" : "anos"}`;
  };

  return (
    <div className="dashboard-container has-sidebar" style={{ minHeight:"100vh", background:T.bg, fontFamily:T.fontFamily }}>
      <Sidebar mode="cliente" clienteId={id} clienteNome={clienteNome || ""} />
      <Navbar
        showLogout={true}
        actionButtons={[
          {
            icon: "←",
            label: "Voltar",
            variant: "secondary",
            onClick: () => {
              if (etapa === 0) navigate(`/cliente/${id}`);
              else setEtapa(etapa - 1);
            },
            title: etapa === 0 ? "Voltar ao cliente" : "Etapa anterior"
          },
          {
            label: "+ Novo",
            variant: "primary",
            onClick: ()=>navigate(`/cliente/${id}/objetivo/novo`)
          }
        ]}
      />
      <div className="dashboard-content with-sidebar cliente-zoom" style={{ maxWidth:680, margin:"0 auto", padding:"28px 24px 80px" }}>

        {/* Header da etapa — editorial, com emoji do tipo */}
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18 }}>
          <div style={{
            fontSize:30, lineHeight:1, flexShrink:0,
            width:54, height:54, borderRadius:14,
            background:gradientsPorTipo[selecionado?.id] || gradientsPorTipo.personalizado,
            display:"flex", alignItems:"center", justifyContent:"center",
            border:`0.5px solid ${T.border}`,
          }}>
            {emojisPorTipo[selecionado?.id] || "⭐"}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:9, color:T.textMuted, letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:4 }}>
              Etapa {etapaVisualParaTipo(etapa, form.tipo)} de {totalEtapasParaTipo(form.tipo)}
            </div>
            <div style={{ fontSize:17, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.01em", lineHeight:1.25 }}>
              {selecionado?.label}
            </div>
          </div>
        </div>

        {/* Barra de progresso */}
        <div style={{ height:2, background:"rgba(255,255,255,0.05)", borderRadius:2, overflow:"hidden", marginBottom:36 }}>
          <div style={{
            height:"100%",
            width:`${(etapaVisualParaTipo(etapa, form.tipo) / totalEtapasParaTipo(form.tipo)) * 100}%`,
            background:`linear-gradient(90deg, ${T.goldDim}, ${T.gold})`,
            borderRadius:2,
            transition:"width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow:`0 0 12px ${T.goldBorder}`,
          }}/>
        </div>

        {/* ETAPA 1 */}
        {etapa === 1 && (
          <div>
            {form.tipo === "aposentadoria" ? (
              <>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Vamos desenhar a sua liberdade financeira.
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:32, lineHeight:1.75, maxWidth:560 }}>
                  Em quantos anos você quer parar de depender do trabalho — e qual renda mensal te dá tranquilidade
                  para viver com conforto. A partir disso, calculamos o patrimônio necessário.
                </div>

                {/* Grid de duas perguntas lado a lado em telas largas, empilhado em mobile */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:14, marginBottom:18 }}>
                  <div>
                    <label style={{ ...C.label, display:"block", marginBottom:8 }}>Em quantos anos</label>
                    <div style={{ position:"relative" }}>
                      <input
                        style={{ ...C.input, fontSize:18, padding:"15px 60px 15px 16px", width:"100%", boxSizing:"border-box" }}
                        type="number"
                        min="1"
                        max="80"
                        placeholder="Ex: 20"
                        value={form.prazo || ""}
                        onChange={e => setF("prazo", e.target.value)}
                      />
                      <span style={{ position:"absolute", right:16, top:"50%", transform:"translateY(-50%)", fontSize:11, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", pointerEvents:"none" }}>
                        {(parseInt(form.prazo) || 0) === 1 ? "ano" : "anos"}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label style={{ ...C.label, display:"block", marginBottom:8 }}>Renda mensal desejada</label>
                    <input style={{ ...C.input, fontSize:18, padding:"15px 16px", width:"100%", boxSizing:"border-box" }}
                      placeholder="R$ 0"
                      type="text"
                      inputMode="numeric"
                      value={form.rendaMensal ? (parseCentavos(form.rendaMensal)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                      onChange={e => {
                        const centavos = parseCentavos(e.target.value);
                        setF("rendaMensal", String(centavos));
                        if (centavos > 0) {
                          const rendaReais = centavos / 100;
                          const patrimonioNecessario = Math.round((rendaReais * 12) / (TAXA_ANUAL / 100));
                          setF("meta", String(patrimonioNecessario * 100));
                        }
                      }}
                    />
                  </div>
                </div>

                {parseCentavos(form.rendaMensal) > 0 && (
                  <div style={{
                    background:"linear-gradient(145deg, rgba(240,162,2,0.06) 0%, rgba(240,162,2,0.02) 100%)",
                    border:`0.5px solid ${T.goldBorder}`,
                    borderRadius:T.radiusLg,
                    padding:"22px 22px 24px",
                    marginTop:8,
                    boxShadow:T.shadowGold,
                  }}>
                    <div style={{ fontSize:9, color:T.gold, letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:10, fontWeight:600 }}>
                      Patrimônio-alvo calculado
                    </div>
                    <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.7, marginBottom:14 }}>
                      Para gerar <span style={{ color:T.goldLight, fontWeight:500 }}>{moedaStr(form.rendaMensal)}/mês</span> de renda passiva
                      {(parseInt(form.prazo) || 0) > 0 && <> em <span style={{ color:T.goldLight, fontWeight:500 }}>{form.prazo} {(parseInt(form.prazo) || 0) === 1 ? "ano" : "anos"}</span></>},
                      você precisa acumular:
                    </div>
                    <div style={{ fontSize:32, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.02em", lineHeight:1.1 }}>
                      {moedaStr(form.meta)}
                    </div>
                    <div style={{ fontSize:11, color:T.textMuted, marginTop:10, lineHeight:1.6 }}>
                      Cálculo baseado em uma taxa de retorno real de {(TAXA_ANUAL).toFixed(2)}% ao ano,
                      respeitando a regra dos 4% para preservação de capital.
                    </div>
                  </div>
                )}
              </>
            ) : form.tipo === "liquidez" ? (
              <>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Sua segurança em momentos difíceis.
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                  A regra é clara: <strong style={{ color:T.textPrimary, fontWeight:500 }}>ter pelo menos 6 meses dos seus
                  gastos mensais</strong> em liquidez diária. Esse colchão é o alicerce de qualquer plano financeiro —
                  sem ele, qualquer imprevisto vira retrocesso.
                </div>

                {/* Pergunta 1: gastos mensais com botão "puxar dos meus dados" */}
                <div style={{ marginBottom:18 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, flexWrap:"wrap", gap:8 }}>
                    <label style={{ ...C.label, margin:0 }}>Seus gastos médios mensais</label>
                    {gastosCadastrados > 0 && parseCentavos(form.gastosMensais || "0") !== gastosCadastrados && (
                      <button
                        type="button"
                        onClick={() => {
                          setF("gastosMensais", String(gastosCadastrados));
                          // Pré-calcula meta = 6× gastos se ainda vazia
                          if (!form.meta || parseCentavos(form.meta) === 0) {
                            setF("meta", String(gastosCadastrados * 6));
                          }
                        }}
                        style={{
                          fontSize:10, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase",
                          background:T.goldDim, border:`0.5px solid ${T.goldBorder}`, borderRadius:20,
                          padding:"5px 12px", cursor:"pointer", fontFamily:T.fontFamily, fontWeight:600,
                        }}
                      >
                        ↓ Puxar dos meus dados
                      </button>
                    )}
                  </div>
                  <input style={{ ...C.input, fontSize:18, padding:"15px 16px", width:"100%", boxSizing:"border-box" }}
                    placeholder="R$ 0"
                    type="text"
                    inputMode="numeric"
                    value={form.gastosMensais ? (parseCentavos(form.gastosMensais)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                    onChange={e => {
                      const centavos = parseCentavos(e.target.value);
                      setF("gastosMensais", String(centavos));
                      // Atualiza a meta sugerida automaticamente quando o cliente
                      // ainda não personalizou ou está alinhada com o cálculo padrão.
                      const metaAtual = parseCentavos(form.meta || "0");
                      const metaSugeridaAnterior = parseCentavos(form.gastosMensais || "0") * 6;
                      if (metaAtual === 0 || metaAtual === metaSugeridaAnterior) {
                        setF("meta", String(centavos * 6));
                      }
                    }}
                  />
                  {gastosCadastrados > 0 && parseCentavos(form.gastosMensais || "0") === gastosCadastrados && (
                    <div style={{ fontSize:11, color:T.gold, marginTop:8, lineHeight:1.6, display:"flex", alignItems:"center", gap:6 }}>
                      <span>✓</span> Valor puxado do seu cadastro de gastos.
                    </div>
                  )}
                </div>

                {/* Pergunta 2: meta da reserva (sugerida = 6× gastos, editável) */}
                <div style={{ marginBottom:8 }}>
                  <label style={{ ...C.label, display:"block", marginBottom:8 }}>
                    Quanto você acha que precisa ter em momentos difíceis
                  </label>
                  <input style={{ ...C.input, fontSize:18, padding:"15px 16px", width:"100%", boxSizing:"border-box" }}
                    placeholder="R$ 0"
                    type="text"
                    inputMode="numeric"
                    value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                    onChange={e => {
                      const centavos = parseCentavos(e.target.value);
                      setF("meta", String(centavos));
                    }}
                  />
                  {parseCentavos(form.gastosMensais) > 0 && (() => {
                    const gastos = parseCentavos(form.gastosMensais) / 100;
                    const metaAtual = parseCentavos(form.meta) / 100;
                    const meses = gastos > 0 ? Math.round((metaAtual / gastos) * 10) / 10 : 0;
                    const corMeses = meses < 6 ? "#ef4444" : meses < 9 ? T.gold : "#22c55e";
                    return (
                      <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                        Equivale a <span style={{ color:corMeses, fontWeight:600 }}>{meses} {meses === 1 ? "mês" : "meses"}</span> dos seus gastos.
                        {meses < 6 && " Recomendamos pelo menos 6 meses."}
                        {meses >= 6 && meses < 9 && " Bom — você está dentro da margem mínima."}
                        {meses >= 9 && " Excelente — colchão robusto, principalmente para autônomos ou renda variável."}
                      </div>
                    );
                  })()}
                </div>

                {parseCentavos(form.gastosMensais) > 0 && parseCentavos(form.meta) > 0 && (
                  <div style={{
                    background:"linear-gradient(145deg, rgba(74,222,128,0.06) 0%, rgba(74,222,128,0.02) 100%)",
                    border:`0.5px solid rgba(74,222,128,0.25)`,
                    borderRadius:T.radiusLg,
                    padding:"18px 20px",
                    marginTop:18,
                    display:"flex", alignItems:"center", gap:14,
                  }}>
                    <div style={{ fontSize:24, lineHeight:1 }}>🛟</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:9, color:"#4ADE80", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                        Sua meta de reserva
                      </div>
                      <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.02em", lineHeight:1.1 }}>
                        {moedaStr(form.meta)}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : form.tipo === "carro" ? (
              <>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Qual é o carro dos seus sonhos?
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                  Defina o veículo, o valor e em quanto tempo você quer estar dirigindo. Quanto mais concreto o objetivo,
                  mais fácil é se manter no plano.
                </div>

                {/* Pergunta 1: nome do veículo */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Nome do veículo</label>
                  <input
                    style={{ ...C.input, fontSize:16, padding:"14px 16px" }}
                    placeholder="Ex: Toyota Corolla XEi 2026"
                    value={form.nomeCustom || ""}
                    onChange={e => setF("nomeCustom", e.target.value)}
                  />
                </div>

                {/* Pergunta 2: valor do veículo */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Valor do veículo</label>
                  <input
                    style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                    placeholder="R$ 0"
                    type="text"
                    inputMode="numeric"
                    value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                    onChange={e => {
                      const centavos = parseCentavos(e.target.value);
                      setF("meta", String(centavos));
                    }}
                  />
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                    Use o valor de tabela (FIPE) ou o valor de mercado do veículo na configuração desejada.
                  </div>
                </div>

                {/* Pergunta 3: prazo em anos */}
                <div style={{ marginBottom:8 }}>
                  <label style={C.label}>Em quantos anos você quer comprar</label>
                  <input
                    style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                    type="number"
                    min="0"
                    placeholder="Ex: 3"
                    value={form.prazo || ""}
                    onChange={e => setF("prazo", e.target.value)}
                  />
                </div>

                {parseCentavos(form.meta) > 0 && (parseInt(form.prazo) || 0) > 0 && (
                  <div style={{
                    background:"linear-gradient(145deg, rgba(255,107,53,0.08) 0%, rgba(255,107,53,0.02) 100%)",
                    border:`0.5px solid rgba(255,107,53,0.28)`,
                    borderRadius:T.radiusLg,
                    padding:"18px 20px",
                    marginTop:18,
                    display:"flex", alignItems:"center", gap:14,
                  }}>
                    <div style={{ fontSize:24, lineHeight:1 }}>🚗</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:9, color:"#FF6B35", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                        Seu objetivo
                      </div>
                      <div style={{ fontSize:16, color:T.textPrimary, fontWeight:400, lineHeight:1.4, marginBottom:6 }}>
                        {form.nomeCustom ? form.nomeCustom : "Veículo escolhido"}
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.6 }}>
                        <span style={{ color:T.textPrimary, fontWeight:500 }}>{moedaStr(form.meta)}</span>
                        {" "}em{" "}
                        <span style={{ color:T.textPrimary, fontWeight:500 }}>
                          {form.prazo} {(parseInt(form.prazo) || 0) === 1 ? "ano" : "anos"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : form.tipo === "viagem" ? (
              <>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Onde você quer estar?
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                  Toda viagem grande começa com um destino concreto. Defina o lugar, o tempo e o orçamento — e
                  transforme o sonho num plano que cabe no seu mês.
                </div>

                {/* Pergunta 1: destino */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Para onde deseja viajar ou morar</label>
                  <input
                    style={{ ...C.input, fontSize:16, padding:"14px 16px" }}
                    placeholder="Ex: Lisboa, Patagônia, Japão por 30 dias..."
                    value={form.nomeCustom || ""}
                    onChange={e => setF("nomeCustom", e.target.value)}
                  />
                </div>

                {/* Pergunta 2: prazo */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Em quanto tempo deseja realizar</label>
                  <input
                    style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                    type="number"
                    min="0"
                    placeholder="Ex: 2"
                    value={form.prazo || ""}
                    onChange={e => setF("prazo", e.target.value)}
                  />
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                    Em anos. Para viagens curtas (menos de 1 ano), use frações como 0.5 = 6 meses.
                  </div>
                </div>

                {/* Pergunta 3: valor da viagem */}
                <div style={{ marginBottom:8 }}>
                  <label style={C.label}>Quanto pretende gastar na viagem</label>
                  <input
                    style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                    placeholder="R$ 0"
                    type="text"
                    inputMode="numeric"
                    value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                    onChange={e => {
                      const centavos = parseCentavos(e.target.value);
                      setF("meta", String(centavos));
                    }}
                  />
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                    Some passagens, hospedagem, alimentação, deslocamento e uma reserva de 10% para imprevistos.
                  </div>
                </div>

                {/* Card de confirmação contextualizado */}
                {form.nomeCustom && parseCentavos(form.meta) > 0 && (parseFloat(form.prazo) || 0) > 0 && (() => {
                  const prazoNum = parseFloat(form.prazo) || 0;
                  const meses = prazoNum * 12;
                  const valorMeta = parseCentavos(form.meta) / 100;
                  const aporteIdeal = Math.ceil(valorMeta / Math.max(1, meses));
                  const prazoLabel = prazoNum < 1
                    ? `${Math.round(prazoNum * 12)} meses`
                    : prazoNum === Math.floor(prazoNum)
                      ? `${prazoNum} ${prazoNum === 1 ? "ano" : "anos"}`
                      : `${prazoNum.toString().replace(".", ",")} anos`;
                  return (
                    <div style={{
                      background:"linear-gradient(145deg, rgba(93,217,193,0.10) 0%, rgba(93,217,193,0.02) 100%)",
                      border:`0.5px solid rgba(93,217,193,0.30)`,
                      borderRadius:T.radiusLg,
                      padding:"20px 22px",
                      marginTop:18,
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                        <div style={{ fontSize:28, lineHeight:1 }}>✈️</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:9, color:"#5DD9C1", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                            Sua próxima viagem
                          </div>
                          <div style={{ fontSize:18, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                            Viagem para <span style={{ color:"#5DD9C1", fontWeight:500 }}>{form.nomeCustom}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, paddingLeft:42 }}>
                        Em <span style={{ color:T.textPrimary, fontWeight:500 }}>{prazoLabel}</span> você pode estar em <span style={{ color:T.textPrimary, fontWeight:500 }}>{form.nomeCustom}</span> com <span style={{ color:T.textPrimary, fontWeight:500 }}>{moedaStr(form.meta)}</span> no bolso.
                        Guardando cerca de <span style={{ color:"#5DD9C1", fontWeight:500 }}>{brl(aporteIdeal)}/mês</span>, você chega lá sem comprometer outras prioridades.
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : form.tipo === "educacao" ? (
              <>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  O futuro de quem você ama começa hoje.
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                  Educação é o investimento de maior retorno. Quanto mais cedo você começa, mais
                  o tempo trabalha a favor — e menos pesa no orçamento mensal.
                </div>

                {/* Pergunta 1: nome do filho */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Nome do filho ou filha</label>
                  <input
                    style={{ ...C.input, fontSize:16, padding:"14px 16px" }}
                    placeholder="Ex: Sofia"
                    value={form.nomeCustom || ""}
                    onChange={e => setF("nomeCustom", e.target.value)}
                  />
                </div>

                {/* Pergunta 2: tipo de curso (select) */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Qual curso você imagina para ele(a)</label>
                  <select
                    style={{ ...C.select, fontSize:15, padding:"14px 16px" }}
                    value={form.cursoTipo || ""}
                    onChange={e => {
                      const novoCurso = e.target.value;
                      setF("cursoTipo", novoCurso);
                      // Se o cliente ainda não definiu prazo, sugere automaticamente.
                      const idade = parseInt(form.idadeFilho) || 0;
                      const sugestao = prazoSugeridoEducacao(idade, novoCurso);
                      if (sugestao && (!form.prazo || parseInt(form.prazo) === 0)) {
                        setF("prazo", String(sugestao));
                      }
                    }}
                  >
                    <option value="">Selecione um curso</option>
                    {CURSOS_EDUCACAO.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* Pergunta 3: instituição (autocomplete via datalist, opcional) */}
                <div style={{ marginBottom:18 }}>
                  <label style={C.label}>Instituição ou cidade desejada <span style={{ textTransform:"none", letterSpacing:0, color:T.textMuted, fontWeight:400 }}>(opcional)</span></label>
                  <input
                    style={{ ...C.input, fontSize:15, padding:"14px 16px" }}
                    placeholder="Comece a digitar — ex: USP, Harvard, Toronto..."
                    list="lista-instituicoes-educacao"
                    value={form.instituicao || ""}
                    onChange={e => setF("instituicao", e.target.value)}
                  />
                  <datalist id="lista-instituicoes-educacao">
                    {INSTITUICOES_EDUCACAO.map(i => <option key={i} value={i} />)}
                  </datalist>
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                    Se ainda não decidiu, pode pular este campo. Sugerimos universidades, escolas de inglês e cidades populares conforme você digita.
                  </div>
                </div>

                {/* Pergunta 4 + 5: idade hoje + prazo (lado a lado) */}
                <div style={{ marginBottom:18 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:14 }}>
                    <div>
                      <label style={C.label}>Idade hoje</label>
                      <input
                        style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                        type="number"
                        min="0"
                        max="100"
                        placeholder="Ex: 8"
                        value={form.idadeFilho || ""}
                        onChange={e => {
                          const novaIdade = e.target.value;
                          setF("idadeFilho", novaIdade);
                          // Auto-sugere prazo se ainda não preenchido.
                          const idadeNum = parseInt(novaIdade) || 0;
                          const sugestao = prazoSugeridoEducacao(idadeNum, form.cursoTipo);
                          if (sugestao && (!form.prazo || parseInt(form.prazo) === 0)) {
                            setF("prazo", String(sugestao));
                          }
                        }}
                      />
                      <div style={{ fontSize:10, color:T.textMuted, marginTop:6, lineHeight:1.5, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                        Em anos
                      </div>
                    </div>
                    <div>
                      <label style={C.label}>Em quantos anos quer alcançar</label>
                      <input
                        style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                        type="number"
                        min="0"
                        placeholder="Ex: 10"
                        value={form.prazo || ""}
                        onChange={e => setF("prazo", e.target.value)}
                      />
                      {(() => {
                        const idade = parseInt(form.idadeFilho) || 0;
                        const sugestao = prazoSugeridoEducacao(idade, form.cursoTipo);
                        const curso = CURSOS_EDUCACAO.find(c => c.id === form.cursoTipo);
                        if (!sugestao || !curso) return (
                          <div style={{ fontSize:10, color:T.textMuted, marginTop:6, lineHeight:1.5, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                            Em anos
                          </div>
                        );
                        const prazoAtual = parseInt(form.prazo) || 0;
                        const diferente = prazoAtual !== sugestao;
                        return (
                          <div style={{ fontSize:10, color: diferente ? T.gold : T.textMuted, marginTop:6, lineHeight:1.5, display:"flex", alignItems:"center", gap:6 }}>
                            <span>↳ Sugestão automática: {sugestao} {sugestao === 1 ? "ano" : "anos"}</span>
                            {diferente && (
                              <button
                                type="button"
                                onClick={() => setF("prazo", String(sugestao))}
                                style={{
                                  background:T.goldDim, border:`0.5px solid ${T.goldBorder}`,
                                  color:T.gold, fontSize:9, padding:"3px 8px", borderRadius:12,
                                  cursor:"pointer", fontFamily:T.fontFamily, letterSpacing:"0.08em",
                                  textTransform:"uppercase", fontWeight:600,
                                }}
                              >
                                Aplicar
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {(() => {
                    const idade = parseInt(form.idadeFilho) || 0;
                    const curso = CURSOS_EDUCACAO.find(c => c.id === form.cursoTipo);
                    if (!idade || !curso || !curso.idadeIdeal) return null;
                    const idadeIdeal = curso.idadeIdeal;
                    const anosAteLa = Math.max(0, idadeIdeal - idade);
                    return (
                      <div style={{ fontSize:11, color:T.textSecondary, marginTop:12, padding:"10px 14px", background:"rgba(34,116,165,0.06)", border:"0.5px solid rgba(34,116,165,0.2)", borderRadius:T.radiusSm, lineHeight:1.6 }}>
                        <span style={{ color:"#2274A5", fontWeight:600 }}>📊 Lógica:</span>{" "}
                        {form.nomeCustom || "Seu filho(a)"} tem <strong style={{ color:T.textPrimary }}>{idade} {idade === 1 ? "ano" : "anos"}</strong> hoje
                        {anosAteLa > 0
                          ? <> e {curso.label.toLowerCase()} costuma começar aos <strong style={{ color:T.textPrimary }}>{idadeIdeal} anos</strong> — faltam <strong style={{ color:T.gold }}>{anosAteLa} {anosAteLa === 1 ? "ano" : "anos"}</strong> para começar a usar o capital.</>
                          : <> e já está em idade ({idadeIdeal} anos) de {curso.label.toLowerCase()} — o uso é imediato.</>
                        }
                      </div>
                    );
                  })()}
                </div>

                {/* Pergunta 6: valor da educação */}
                <div style={{ marginBottom:8 }}>
                  <label style={C.label}>Valor a ser investido no futuro do(a) {form.nomeCustom || "seu filho(a)"}</label>
                  <input
                    style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                    placeholder="R$ 0"
                    type="text"
                    inputMode="numeric"
                    value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                    onChange={e => {
                      const centavos = parseCentavos(e.target.value);
                      setF("meta", String(centavos));
                    }}
                  />
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                    Considere mensalidade, material, moradia (se for fora) e custo de vida. Para faculdade particular no Brasil, R$ 100k a R$ 250k é uma referência. Universidade no exterior pode chegar a R$ 1M+.
                  </div>
                </div>

                {/* Card contextualizado */}
                {form.nomeCustom && parseCentavos(form.meta) > 0 && (parseInt(form.prazo) || 0) > 0 && (() => {
                  const prazoNum = parseInt(form.prazo) || 0;
                  const valorMeta = parseCentavos(form.meta) / 100;
                  const aporteIdeal = Math.ceil(valorMeta / Math.max(1, prazoNum * 12));
                  const curso = CURSOS_EDUCACAO.find(c => c.id === form.cursoTipo);
                  const cursoLabel = curso ? curso.label : "estudo";
                  const local = form.instituicao ? ` — ${form.instituicao}` : "";
                  return (
                    <div style={{
                      background:"linear-gradient(145deg, rgba(34,116,165,0.10) 0%, rgba(34,116,165,0.02) 100%)",
                      border:`0.5px solid rgba(34,116,165,0.30)`,
                      borderRadius:T.radiusLg,
                      padding:"20px 22px",
                      marginTop:18,
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                        <div style={{ fontSize:28, lineHeight:1 }}>🎓</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:9, color:"#2274A5", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                            Educação que transforma vidas
                          </div>
                          <div style={{ fontSize:18, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                            O futuro de <span style={{ color:"#2274A5", fontWeight:500 }}>{form.nomeCustom}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, paddingLeft:42 }}>
                        Em <span style={{ color:T.textPrimary, fontWeight:500 }}>{prazoNum} {prazoNum === 1 ? "ano" : "anos"}</span>, {form.nomeCustom} pode começar {cursoLabel.toLowerCase()}{local} com <span style={{ color:T.textPrimary, fontWeight:500 }}>{moedaStr(form.meta)}</span> garantidos.
                        Guardando cerca de <span style={{ color:"#2274A5", fontWeight:500 }}>{brl(aporteIdeal)}/mês</span>, você abre uma porta que nenhum dinheiro recompra depois — o tempo certo para investir no preparo dele(a).
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : form.tipo === "seguros" ? (
              <>
                {(() => {
                  const rendaMensal = parseCentavos(cliente?.salarioMensal || cliente?.fluxo?.renda || "0") / 100;
                  const rendaAnual = rendaMensal * 12;
                  const sugestaoRenda = Math.round(rendaAnual * 10);
                  const patrimonioTotal = calcPatrimonioTotal(cliente);
                  const totalImoveis = calcTotalImoveisCliente(cliente);
                  const totalVeiculos = calcTotalVeiculosCliente(cliente);
                  const opcoesSeguro = [
                    { id:"vida", label:"Vida" },
                    { id:"veiculo", label:"Veículo" },
                    { id:"residencial", label:"Residencial" },
                    { id:"multiplo", label:"Múltiplos" },
                  ];
                  const tipoSel = form.tipoSeguro || "";
                  const capital = parseCentavos(form.meta || "0") / 100;
                  const premioMensal = parseCentavos(form.aporte || "0") / 100;

                  // Lista de sugestões por tipo de seguro — copy claro pra cliente final.
                  const sugestoes = (() => {
                    if (tipoSel === "vida") {
                      const arr = [];
                      if (rendaAnual > 0) arr.push({
                        valor: sugestaoRenda,
                        titulo: "Renda da família por 10 anos",
                        explicacao: <>Garante que sua família receba o equivalente à <strong>sua renda atual</strong> por 10 anos sem precisar voltar a trabalhar.</>,
                      });
                      if (patrimonioTotal > 0) arr.push({
                        valor: patrimonioTotal,
                        titulo: "Preservar o patrimônio da família",
                        explicacao: <>Sua família <strong>não precisa vender nenhum bem</strong> (imóveis, carros, investimentos) pra manter o padrão de vida.</>,
                      });
                      return arr;
                    }
                    if (tipoSel === "veiculo" && totalVeiculos > 0) return [{
                      valor: totalVeiculos,
                      titulo: "Valor total dos seus veículos",
                      explicacao: <>Cobre o valor cheio dos veículos que você cadastrou — em caso de roubo ou perda total, você recupera tudo.</>,
                    }];
                    if (tipoSel === "residencial" && totalImoveis > 0) return [{
                      valor: totalImoveis,
                      titulo: "Valor total dos seus imóveis",
                      explicacao: <>Cobre o valor de reposição dos imóveis cadastrados — incêndio, desabamento, danos elétricos.</>,
                    }];
                    if (tipoSel === "multiplo" && patrimonioTotal > 0) return [{
                      valor: patrimonioTotal,
                      titulo: "Cobertura do patrimônio total",
                      explicacao: <>Cobre todo seu patrimônio (financeiro + imóveis + veículos) num pacote integrado.</>,
                    }];
                    return [];
                  })();

                  // Estado de cobertura — verde quando capital ≥ menor sugestão.
                  const menorSugestao = sugestoes.length > 0 ? Math.min(...sugestoes.map(s => s.valor)) : 0;
                  const okCobertura = menorSugestao > 0 && capital >= menorSugestao * 0.95;
                  const abaixoCobertura = menorSugestao > 0 && capital > 0 && capital < menorSugestao * 0.95;

                  // Cores principais — azul (proteção) em vez de vermelho.
                  const C_AZUL = T.blue;            // #1982C4
                  const C_AZUL_BG = "rgba(25,130,196,0.12)";
                  const C_AZUL_BORDER = "rgba(25,130,196,0.40)";
                  const C_VERDE = "#22c55e";
                  const C_VERDE_BG = "rgba(34,197,94,0.10)";
                  const C_VERDE_BORDER = "rgba(34,197,94,0.35)";
                  const C_OURO_BORDER = "rgba(240,162,2,0.35)";

                  return (
                    <>
                      <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                        Proteja quem você ama, mesmo no pior cenário.
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                        Seguro não é gasto — é a tranquilidade de saber que sua família continua de pé se algo acontecer com você ou com seus bens.
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Tipo de seguro</label>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          {opcoesSeguro.map(o => {
                            const ativo = tipoSel === o.id;
                            return (
                              <button key={o.id} type="button"
                                onClick={() => setF("tipoSeguro", o.id)}
                                style={{
                                  padding:"10px 18px",
                                  background: ativo ? C_AZUL_BG : "rgba(255,255,255,0.03)",
                                  border: `1px solid ${ativo ? C_AZUL_BORDER : T.border}`,
                                  borderRadius: T.radiusMd,
                                  color: ativo ? C_AZUL : T.textSecondary,
                                  fontSize:13, cursor:"pointer", fontFamily:T.fontFamily,
                                  letterSpacing:"0.04em", fontWeight: ativo ? 500 : 400,
                                  transition:"all 0.2s",
                                }}>{o.label}</button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sugestões pré-input — cards explicativos com botão "Usar este valor" */}
                      {tipoSel && sugestoes.length > 0 && (
                        <div style={{ marginBottom:14 }}>
                          <label style={C.label}>Sugestões para você</label>
                          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                            {sugestoes.map((s, idx) => {
                              const aplicado = Math.abs(capital - s.valor) < 1;
                              return (
                                <div key={idx} style={{
                                  background: aplicado ? C_VERDE_BG : "rgba(255,255,255,0.025)",
                                  border: `0.5px solid ${aplicado ? C_VERDE_BORDER : T.border}`,
                                  borderLeft: `3px solid ${aplicado ? C_VERDE : C_AZUL}`,
                                  borderRadius: T.radiusMd,
                                  padding: "14px 16px",
                                  display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap",
                                  transition:"all 0.2s",
                                }}>
                                  <div style={{ flex:"1 1 280px", minWidth:0 }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                                      <span style={{ fontSize:13, color:T.textPrimary, fontWeight:500 }}>{s.titulo}</span>
                                      <span style={{ fontSize:14, color: aplicado ? C_VERDE : C_AZUL, fontWeight:600 }}>{brl(s.valor)}</span>
                                      {aplicado && <span style={{ fontSize:9, color:C_VERDE, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:600 }}>✓ aplicado</span>}
                                    </div>
                                    <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.65 }}>{s.explicacao}</div>
                                  </div>
                                  {!aplicado && (
                                    <button type="button"
                                      onClick={() => setF("meta", String(Math.round(s.valor * 100)))}
                                      style={{
                                        background: C_AZUL_BG, border:`0.5px solid ${C_AZUL_BORDER}`, color:C_AZUL,
                                        fontSize:11, padding:"8px 14px", borderRadius:T.radiusSm, cursor:"pointer",
                                        fontFamily:T.fontFamily, letterSpacing:"0.06em", fontWeight:500, whiteSpace:"nowrap",
                                        flexShrink:0,
                                      }}>
                                      Usar este valor
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Quanto sua família/seu bem deve receber em caso de sinistro?</label>
                        <input
                          style={{
                            ...C.input, fontSize:18, padding:"15px 16px",
                            borderColor: okCobertura ? C_VERDE_BORDER : abaixoCobertura ? C_OURO_BORDER : C.input.border,
                            background: okCobertura ? C_VERDE_BG : C.input.background,
                          }}
                          placeholder="R$ 0"
                          type="text"
                          inputMode="numeric"
                          value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                          onChange={e => setF("meta", String(parseCentavos(e.target.value)))}
                        />
                        {okCobertura && (
                          <div style={{ fontSize:11, color:C_VERDE, marginTop:8, lineHeight:1.6, fontWeight:500 }}>
                            ✓ Cobertura adequada — esse valor está alinhado com nossa sugestão.
                          </div>
                        )}
                        {abaixoCobertura && (
                          <div style={{ fontSize:11, color:T.gold, marginTop:8, lineHeight:1.6 }}>
                            ⚠ Cobertura abaixo do recomendado — considere usar uma das sugestões acima.
                          </div>
                        )}
                      </div>

                      <div style={{ marginBottom:8 }}>
                        <label style={C.label}>Quanto pretende pagar de mensalidade?</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          placeholder="R$ 0"
                          type="text"
                          inputMode="numeric"
                          value={form.aporte ? (parseCentavos(form.aporte)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                          onChange={e => setF("aporte", String(parseCentavos(e.target.value)))}
                        />
                        <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                          Referência de mercado: seguro de vida custa entre 0,3% e 1% do capital ao ano. Seguro de veículo, entre 3% e 6% do valor do bem.
                        </div>
                      </div>

                      {tipoSel && capital > 0 && (
                        <div style={{
                          background: okCobertura
                            ? `linear-gradient(145deg, ${C_VERDE_BG} 0%, rgba(34,197,94,0.02) 100%)`
                            : `linear-gradient(145deg, ${C_AZUL_BG} 0%, rgba(25,130,196,0.02) 100%)`,
                          border: `0.5px solid ${okCobertura ? C_VERDE_BORDER : C_AZUL_BORDER}`,
                          borderRadius:T.radiusLg,
                          padding:"20px 22px",
                          marginTop:18,
                        }}>
                          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                            <div style={{ fontSize:28, lineHeight:1 }}>🛡️</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:9, color: okCobertura ? C_VERDE : C_AZUL, letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                                {okCobertura ? "Proteção bem dimensionada" : "Proteção em construção"}
                              </div>
                              <div style={{ fontSize:18, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                                {opcoesSeguro.find(o => o.id === tipoSel)?.label}: <span style={{ color: okCobertura ? C_VERDE : C_AZUL, fontWeight:500 }}>{brl(capital)}</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, paddingLeft:42 }}>
                            {tipoSel === "vida"
                              ? <>Se faltar você, sua família recebe <span style={{ color:T.textPrimary, fontWeight:500 }}>{brl(capital)}</span> {rendaMensal > 0 && <>— o equivalente a viver <span style={{ color:T.textPrimary, fontWeight:500 }}>{Math.round(capital / rendaMensal)} meses</span> com a renda atual</>}. Tempo de sobra pra reorganizar a vida sem desespero.</>
                              : tipoSel === "veiculo"
                              ? <>Em caso de roubo, colisão grave ou perda total, você recupera <span style={{ color:T.textPrimary, fontWeight:500 }}>{brl(capital)}</span> sem precisar tirar dinheiro dos investimentos.</>
                              : tipoSel === "residencial"
                              ? <>Em caso de incêndio, desabamento ou roubo, sua casa é recolocada de pé com <span style={{ color:T.textPrimary, fontWeight:500 }}>{brl(capital)}</span> de cobertura.</>
                              : <>Pacote integrado de <span style={{ color:T.textPrimary, fontWeight:500 }}>{brl(capital)}</span> protegendo o que você construiu até aqui.</>
                            }
                            {premioMensal > 0 && <> Custo: cerca de <span style={{ color:T.textPrimary, fontWeight:500 }}>{brl(premioMensal)}/mês</span>.</>}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            ) : form.tipo === "sucessaoPatrimonial" ? (
              <>
                {(() => {
                  const filhosCount = (cliente?.filhos || []).length;
                  const temConjuge = !!(cliente?.conjuge && String(cliente.conjuge).trim());
                  const beneficiariosAuto = filhosCount + (temConjuge ? 1 : 0);
                  const patrimonioCadastro = parseCentavos(cliente?.patrimonio || "0") / 100;
                  const opcoesEstrut = [
                    { id:"holding", label:"Holding familiar" },
                    { id:"doacao", label:"Doação em vida" },
                    { id:"testamento", label:"Testamento" },
                    { id:"estudar", label:"Estudar opções" },
                  ];
                  const estSel = form.estrutura || "";
                  const patrim = parseCentavos(form.meta || "0") / 100;
                  return (
                    <>
                      <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                        Sua família, protegida quando mais importar.
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                        Sem planejamento, um inventário pode travar o patrimônio por anos e custar 10–20% em impostos e honorários. Resolver em vida é o maior presente que você deixa.
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Patrimônio total a proteger</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          placeholder="R$ 0"
                          type="text"
                          inputMode="numeric"
                          value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                          onChange={e => setF("meta", String(parseCentavos(e.target.value)))}
                        />
                        {patrimonioCadastro > 0 && Math.abs(patrim - patrimonioCadastro) > 1 && (
                          <div style={{ fontSize:11, color:"#6A4C93", marginTop:8, lineHeight:1.6, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                            <span>↳ Cadastro: <strong>{brl(patrimonioCadastro)}</strong></span>
                            <button type="button"
                              onClick={() => setF("meta", String(Math.round(patrimonioCadastro * 100)))}
                              style={{ background:"rgba(106,76,147,0.15)", border:"0.5px solid rgba(106,76,147,0.4)", color:"#6A4C93", fontSize:9, padding:"3px 8px", borderRadius:12, cursor:"pointer", fontFamily:T.fontFamily, letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>
                              Aplicar
                            </button>
                          </div>
                        )}
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Estrutura desejada</label>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          {opcoesEstrut.map(o => {
                            const ativo = estSel === o.id;
                            return (
                              <button key={o.id} type="button"
                                onClick={() => setF("estrutura", o.id)}
                                style={{
                                  padding:"10px 18px",
                                  background: ativo ? "rgba(106,76,147,0.18)" : "rgba(255,255,255,0.03)",
                                  border: `1px solid ${ativo ? "rgba(106,76,147,0.5)" : T.border}`,
                                  borderRadius: T.radiusMd,
                                  color: ativo ? "#a78bfa" : T.textSecondary,
                                  fontSize:13, cursor:"pointer", fontFamily:T.fontFamily,
                                  letterSpacing:"0.04em", fontWeight: ativo ? 500 : 400,
                                  transition:"all 0.2s",
                                }}>{o.label}</button>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ marginBottom:8 }}>
                        <label style={C.label}>Beneficiários</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          type="number"
                          min="0"
                          placeholder={beneficiariosAuto > 0 ? String(beneficiariosAuto) : "Ex: 3"}
                          value={form.beneficiarios ?? (beneficiariosAuto > 0 ? String(beneficiariosAuto) : "")}
                          onChange={e => setF("beneficiarios", e.target.value)}
                        />
                        {beneficiariosAuto > 0 && (
                          <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                            Detectado no cadastro: {temConjuge ? "cônjuge" : ""}{temConjuge && filhosCount > 0 ? " + " : ""}{filhosCount > 0 ? `${filhosCount} filho${filhosCount > 1 ? "s" : ""}` : ""}.
                          </div>
                        )}
                      </div>

                      {patrim > 0 && estSel && (
                        <div style={{
                          background:"linear-gradient(145deg, rgba(106,76,147,0.12) 0%, rgba(106,76,147,0.02) 100%)",
                          border:`0.5px solid rgba(106,76,147,0.32)`,
                          borderRadius:T.radiusLg,
                          padding:"20px 22px",
                          marginTop:18,
                        }}>
                          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                            <div style={{ fontSize:28, lineHeight:1 }}>👨‍👩‍👧‍👦</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:9, color:"#a78bfa", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                                Legado organizado, transição tranquila
                              </div>
                              <div style={{ fontSize:18, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                                <span style={{ color:"#a78bfa", fontWeight:500 }}>{brl(patrim)}</span> protegidos para a família
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, paddingLeft:42 }}>
                            Estruturando via <span style={{ color:T.textPrimary, fontWeight:500 }}>{opcoesEstrut.find(o => o.id === estSel)?.label.toLowerCase()}</span>, você pode economizar até <span style={{ color:"#a78bfa", fontWeight:500 }}>{brl(patrim * 0.15)}</span> em ITCMD/honorários e evitar disputas. Vamos detalhar o melhor caminho com um especialista.
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            ) : form.tipo === "saude" ? (
              <>
                {(() => {
                  const opcoesFundo = [
                    { id:"cirurgia", label:"Cirurgias e tratamentos" },
                    { id:"dentista", label:"Odontologia" },
                    { id:"bemestar", label:"Bem-estar (terapia, academia)" },
                    { id:"geral", label:"Fundo geral" },
                  ];
                  const fundoSel = form.tipoFundo || "";
                  const valor = parseCentavos(form.meta || "0") / 100;
                  const prazoNum = parseInt(form.prazo) || 0;
                  return (
                    <>
                      <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                        Saúde é o ativo mais importante da carteira.
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                        Um fundo paralelo ao plano de saúde cobre o que o convênio não cobre — cirurgia particular, tratamento prolongado, dentista, terapia. É o que separa "passar pelo problema" de "passar bem pelo problema".
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Para quê esse fundo?</label>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          {opcoesFundo.map(o => {
                            const ativo = fundoSel === o.id;
                            return (
                              <button key={o.id} type="button"
                                onClick={() => setF("tipoFundo", o.id)}
                                style={{
                                  padding:"10px 18px",
                                  background: ativo ? "rgba(25,130,196,0.16)" : "rgba(255,255,255,0.03)",
                                  border: `1px solid ${ativo ? "rgba(25,130,196,0.5)" : T.border}`,
                                  borderRadius: T.radiusMd,
                                  color: ativo ? "#1982C4" : T.textSecondary,
                                  fontSize:13, cursor:"pointer", fontFamily:T.fontFamily,
                                  letterSpacing:"0.04em", fontWeight: ativo ? 500 : 400,
                                  transition:"all 0.2s",
                                }}>{o.label}</button>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Valor total do fundo</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          placeholder="R$ 0"
                          type="text"
                          inputMode="numeric"
                          value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                          onChange={e => setF("meta", String(parseCentavos(e.target.value)))}
                        />
                      </div>

                      <div style={{ marginBottom:8 }}>
                        <label style={C.label}>Em quantos anos quer acumular</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          type="number"
                          min="0"
                          placeholder="Ex: 5"
                          value={form.prazo || ""}
                          onChange={e => setF("prazo", e.target.value)}
                        />
                      </div>

                      {valor > 0 && prazoNum > 0 && (
                        <div style={{
                          background:"linear-gradient(145deg, rgba(25,130,196,0.10) 0%, rgba(25,130,196,0.02) 100%)",
                          border:`0.5px solid rgba(25,130,196,0.30)`,
                          borderRadius:T.radiusLg,
                          padding:"20px 22px",
                          marginTop:18,
                        }}>
                          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                            <div style={{ fontSize:28, lineHeight:1 }}>💪</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:9, color:"#1982C4", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                                Saúde sem comprometer o patrimônio
                              </div>
                              <div style={{ fontSize:18, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                                Reserva de <span style={{ color:"#1982C4", fontWeight:500 }}>{brl(valor)}</span> em {prazoNum} {prazoNum === 1 ? "ano" : "anos"}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, paddingLeft:42 }}>
                            Guardando cerca de <span style={{ color:"#1982C4", fontWeight:500 }}>{brl(Math.ceil(valor / Math.max(1, prazoNum * 12)))}/mês</span>, você cria um colchão dedicado que evita resgatar investimentos de longo prazo num momento ruim.
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            ) : form.tipo === "planoSaude" ? (
              <>
                {(() => {
                  const filhosCount = (cliente?.filhos || []).length;
                  const temConjuge = !!(cliente?.conjuge && String(cliente.conjuge).trim());
                  const vidasAuto = 1 + (temConjuge ? 1 : 0) + filhosCount;
                  const opcoesPlano = [
                    { id:"basico", label:"Básico", faixa:"R$ 300–600/vida" },
                    { id:"intermediario", label:"Intermediário", faixa:"R$ 600–1.200/vida" },
                    { id:"premium", label:"Premium", faixa:"R$ 1.200–2.500/vida" },
                    { id:"internacional", label:"Internacional", faixa:"R$ 2.500+/vida" },
                  ];
                  const planoSel = form.tipoPlano || "";
                  const mensalidade = parseCentavos(form.aporte || "0") / 100;
                  const prazoNum = parseInt(form.prazo) || 0;
                  return (
                    <>
                      <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                        Cobertura adequada faz toda diferença num imprevisto.
                      </div>
                      <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.75, maxWidth:580 }}>
                        Plano de saúde é o seguro silencioso que protege patrimônio. Uma cirurgia particular pode custar R$ 80k–R$ 500k — o plano transforma esse risco em uma mensalidade previsível.
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Quantas vidas a cobrir</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          type="number"
                          min="1"
                          placeholder={vidasAuto > 0 ? String(vidasAuto) : "Ex: 4"}
                          value={form.vidas ?? (vidasAuto > 0 ? String(vidasAuto) : "")}
                          onChange={e => setF("vidas", e.target.value)}
                        />
                        {vidasAuto > 0 && (
                          <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                            Detectado: titular{temConjuge ? " + cônjuge" : ""}{filhosCount > 0 ? ` + ${filhosCount} filho${filhosCount > 1 ? "s" : ""}` : ""}.
                          </div>
                        )}
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Tipo de plano desejado</label>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          {opcoesPlano.map(o => {
                            const ativo = planoSel === o.id;
                            return (
                              <button key={o.id} type="button"
                                onClick={() => setF("tipoPlano", o.id)}
                                style={{
                                  padding:"10px 16px",
                                  background: ativo ? "rgba(236,72,153,0.16)" : "rgba(255,255,255,0.03)",
                                  border: `1px solid ${ativo ? "rgba(236,72,153,0.5)" : T.border}`,
                                  borderRadius: T.radiusMd,
                                  color: ativo ? "#EC4899" : T.textSecondary,
                                  fontSize:13, cursor:"pointer", fontFamily:T.fontFamily,
                                  letterSpacing:"0.04em", fontWeight: ativo ? 500 : 400,
                                  transition:"all 0.2s",
                                  display:"flex", flexDirection:"column", alignItems:"flex-start", gap:2,
                                }}>
                                <span>{o.label}</span>
                                <span style={{ fontSize:9, color: ativo ? "#EC4899" : T.textMuted, letterSpacing:"0.06em", opacity:0.85 }}>{o.faixa}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ marginBottom:18 }}>
                        <label style={C.label}>Mensalidade estimada total</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          placeholder="R$ 0"
                          type="text"
                          inputMode="numeric"
                          value={form.aporte ? (parseCentavos(form.aporte)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                          onChange={e => setF("aporte", String(parseCentavos(e.target.value)))}
                        />
                      </div>

                      <div style={{ marginBottom:8 }}>
                        <label style={C.label}>Anos de cobertura planejados</label>
                        <input
                          style={{ ...C.input, fontSize:18, padding:"15px 16px" }}
                          type="number"
                          min="0"
                          placeholder="Ex: 30"
                          value={form.prazo || ""}
                          onChange={e => setF("prazo", e.target.value)}
                        />
                        <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                          Usamos esse prazo para calcular o valor total destinado ao plano e refletir no patrimônio comprometido.
                        </div>
                      </div>

                      {planoSel && mensalidade > 0 && prazoNum > 0 && (() => {
                        const totalAcumulado = mensalidade * 12 * prazoNum;
                        // grava a meta total como o custo total ao longo do prazo
                        if (form.meta !== String(Math.round(totalAcumulado * 100))) {
                          // setF não pode rodar dentro de render — apenas calcula para exibir
                        }
                        return (
                          <div style={{
                            background:"linear-gradient(145deg, rgba(236,72,153,0.10) 0%, rgba(236,72,153,0.02) 100%)",
                            border:`0.5px solid rgba(236,72,153,0.30)`,
                            borderRadius:T.radiusLg,
                            padding:"20px 22px",
                            marginTop:18,
                          }}>
                            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                              <div style={{ fontSize:28, lineHeight:1 }}>❤️‍🩹</div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:9, color:"#EC4899", letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4, fontWeight:600 }}>
                                  {opcoesPlano.find(o => o.id === planoSel)?.label} · {form.vidas || vidasAuto} vida{(parseInt(form.vidas) || vidasAuto) > 1 ? "s" : ""}
                                </div>
                                <div style={{ fontSize:18, color:T.textPrimary, fontWeight:400, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                                  <span style={{ color:"#EC4899", fontWeight:500 }}>{brl(mensalidade)}/mês</span> de tranquilidade
                                </div>
                              </div>
                            </div>
                            <div style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, paddingLeft:42 }}>
                              Em <span style={{ color:T.textPrimary, fontWeight:500 }}>{prazoNum} {prazoNum === 1 ? "ano" : "anos"}</span>, você terá comprometido cerca de <span style={{ color:"#EC4899", fontWeight:500 }}>{brl(totalAcumulado)}</span> em mensalidades. Em troca, evita um único evento que poderia destruir muito mais do que isso.
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <div style={{ fontSize:20, fontWeight:300, color:T.textPrimary, marginBottom:8, lineHeight:1.3 }}>
                  Quanto custa esse objetivo?
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:28, lineHeight:1.7 }}>
                  Coloque o valor total que você precisa juntar para realizar.
                </div>
                {form.tipo === "personalizado" && (
                  <div style={{ marginBottom:16 }}>
                    <label style={C.label}>Nome do objetivo</label>
                    <input style={C.input} placeholder="Ex: Viagem para o Canadá" value={form.nomeCustom||""} onChange={e=>setF("nomeCustom",e.target.value)} />
                  </div>
                )}
                <div style={{ marginBottom:20 }}>
                  <label style={C.label}>Valor total do objetivo</label>
                  <input style={{ ...C.input, fontSize:18, padding:"16px 18px" }}
                    placeholder="R$ 0"
                    type="text"
                    inputMode="numeric"
                    value={form.meta ? (parseCentavos(form.meta)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                    onChange={e => {
                      const centavos = parseCentavos(e.target.value);
                      setF("meta", String(centavos));
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* ETAPA 2 */}
        {etapa === 2 && (
          <div>
            <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:10, lineHeight:1.25, letterSpacing:"-0.015em" }}>
              {form.tipo === "aposentadoria" ? "Onde você está agora." : "Como você está hoje?"}
            </div>
            <div style={{ fontSize:13, color:T.textSecondary, marginBottom:28, lineHeight:1.75, maxWidth:560 }}>
              {form.tipo === "aposentadoria"
                ? "Quanto do seu patrimônio já está dedicado a esse objetivo e quanto você consegue aportar todo mês. Se preferir, vincule ativos da sua carteira diretamente."
                : "Quanto você já tem guardado e quanto consegue guardar por mês. Se os números forem exatos, o resultado fica mais certo."}
            </div>

            <label style={C.label}>Patrimônio já acumulado para este objetivo</label>
            {/* Toggle Manual / Ativos Financeiros */}
            <div style={{ display:"flex", gap:0, background:"rgba(255,255,255,0.03)", border:`0.5px solid ${T.border}`, borderRadius:T.radiusMd, padding:3, marginBottom:14 }}>
              {[
                { key:"manual", label:"Valor manual" },
                { key:"ativos", label:"Ativos financeiros" },
              ].map(opt => {
                const ativo = patrimSource === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setPatrimSource(opt.key);
                      if (opt.key === "manual") {
                        setAtivosSelecionados(new Set());
                      }
                    }}
                    style={{
                      flex:1,
                      padding:"10px 12px",
                      background: ativo ? T.goldDim : "transparent",
                      border: ativo ? `1px solid ${T.goldBorder}` : "1px solid transparent",
                      borderRadius:T.radiusSm,
                      color: ativo ? T.gold : T.textSecondary,
                      fontSize:11,
                      letterSpacing:"0.08em",
                      textTransform:"uppercase",
                      cursor:"pointer",
                      fontFamily:T.fontFamily,
                      transition:"all 0.2s",
                      fontWeight: ativo ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {patrimSource === "manual" ? (
              <div style={{ marginBottom:20 }}>
                <input style={{ ...C.input, fontSize:16, padding:"14px 16px" }} placeholder="R$ 0" type="text" inputMode="numeric"
                  value={form.patrimAtual ? (parseCentavos(form.patrimAtual)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                  onChange={e => {
                    const centavos = parseCentavos(e.target.value);
                    setF("patrimAtual", String(centavos));
                  }} />
                <div style={{ fontSize:11, color:T.textMuted, marginTop:8, lineHeight:1.6 }}>
                  Preencha o valor que você já reservou para este objetivo. Se ainda não tem ativos dedicados, use este campo.
                </div>
              </div>
            ) : (
              <AtivosPicker
                carteira={carteira}
                tipoObjetivo={form.tipo}
                selecionados={ativosSelecionados}
                setSelecionados={setAtivosSelecionados}
                totalCalculado={inicial}
                onIrCarteira={() => navigate(`/cliente/${id}/carteira`)}
              />
            )}

            <div style={{ marginBottom:16 }}>
              <label style={C.label}>Aporte mensal destinado a este objetivo</label>
              <input style={{ ...C.input, fontSize:16, padding:"14px 16px" }} placeholder="R$ 0" type="text" inputMode="numeric"
                value={form.aporte ? (parseCentavos(form.aporte)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2}) : ""}
                onChange={e => {
                  const centavos = parseCentavos(e.target.value);
                  setF("aporte", String(centavos));
                }} />
            </div>

            {/* Prazo via chips — exclusivo do fluxo Liquidez */}
            {form.tipo === "liquidez" && (
              <div style={{ marginTop:24, paddingTop:24, borderTop:`0.5px solid ${T.border}` }}>
                <div style={{ fontSize:18, fontWeight:300, color:T.textPrimary, marginBottom:6, lineHeight:1.3, letterSpacing:"-0.01em" }}>
                  Em quanto tempo você quer formar essa reserva?
                </div>
                <div style={{ fontSize:12, color:T.textSecondary, marginBottom:18, lineHeight:1.7 }}>
                  Reservas de emergência costumam ser construídas em meses, não em anos. Escolha um horizonte realista.
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                  {PRAZOS_LIQUIDEZ.map(p => {
                    const valorAnos = p.meses / 12;
                    const ativo = Math.abs(parseFloat(form.prazo || "0") - valorAnos) < 0.001;
                    return (
                      <button
                        key={p.meses}
                        type="button"
                        onClick={() => setF("prazo", String(valorAnos))}
                        style={{
                          padding: "12px 20px",
                          minWidth: 110,
                          background: ativo ? T.goldDim : "rgba(255,255,255,0.03)",
                          border: ativo ? `1px solid ${T.goldBorder}` : `0.5px solid ${T.border}`,
                          borderRadius: T.radiusMd,
                          color: ativo ? T.gold : T.textSecondary,
                          fontSize: 13,
                          fontWeight: ativo ? 600 : 400,
                          letterSpacing: "0.04em",
                          cursor: "pointer",
                          fontFamily: T.fontFamily,
                          transition: "all 0.2s",
                          boxShadow: ativo ? `0 4px 14px ${T.goldBorder}` : "none",
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ETAPA 3 */}
        {etapa === 3 && (
          <div>
            <div style={{ fontSize:20, fontWeight:300, color:T.textPrimary, marginBottom:8, lineHeight:1.3 }}>
              Em quanto tempo você quer chegar lá?
            </div>
            <div style={{ fontSize:13, color:T.textSecondary, marginBottom:28, lineHeight:1.7 }}>
              Quantos anos você tem para atingir esse objetivo.
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={C.label}>Prazo em anos</label>
              <input style={{ ...C.input, fontSize:18, padding:"16px 18px" }} type="number" placeholder="Ex: 10"
                value={form.prazo||""} onChange={e=>setF("prazo",e.target.value)} />
            </div>

            {prazo > 0 && aporte > 0 && meta > 0 && (() => {
              const anosNec = encontrarAnos(inicial, aporte, meta);
              const status = classificar(anosNec, prazo);
              const cor = corStatus[status];
              const tabela = calcularTabela(inicial, aporte, prazo);
              const ultimo = tabela[tabela.length - 1];
              return (
                <div style={{ background:"rgba(255,255,255,0.03)", border:`0.5px solid ${T.border}`, borderRadius:T.radiusLg, padding:"18px 20px" }}>
                  <div style={{ fontSize:9, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:14 }}>
                    Projeção em {prazo} anos
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:10 }}>
                    {[
                      ["Patrimônio real acumulado", brl(ultimo?.totalReal||0)],
                      ["Renda mensal real",         `${brl(ultimo?.rendaMensalReal||0)}/mês`],
                      ["Tempo necessário",          anosNec?anosNec+" anos":"50+ anos"],
                      ["Status do plano",           labelStatus[status]],
                    ].map(([l,v],i)=>(
                      <div key={l} style={{ background:"rgba(255,255,255,0.03)", borderRadius:T.radiusMd, padding:"12px 14px" }}>
                        <div style={{ fontSize:10, color:T.textMuted, marginBottom:5, lineHeight:1.4 }}>{l}</div>
                        <div style={{ fontSize:14, color: i===3?cor:T.textPrimary }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ETAPA 4 — Recomendação (Proteções: seguros, sucessão, plano de saúde) */}
        {etapa === 4 && isProtecao(form.tipo) && (() => {
          const tipo = form.tipo;
          const capital = parseCentavos(form.meta || "0") / 100;
          const mensal = parseCentavos(form.aporte || "0") / 100;

          // ────────────────────────── SEGUROS ──────────────────────────
          if (tipo === "seguros") {
            const tipoSeg = form.tipoSeguro || "vida";
            const labelTipo = { vida:"Seguro de Vida", veiculo:"Seguro de Veículo", residencial:"Seguro Residencial", multiplo:"Seguros Múltiplos" }[tipoSeg] || "Seguro";
            const rendaMensal = parseCentavos(cliente?.salarioMensal || cliente?.fluxo?.renda || "0") / 100;
            const mesesProtegidos = rendaMensal > 0 && capital > 0 ? Math.round(capital / rendaMensal) : 0;
            const patrimonioTotal = calcPatrimonioTotal(cliente);
            const coberturaPatrim = patrimonioTotal > 0 && capital > 0 ? Math.round((capital / patrimonioTotal) * 100) : 0;
            // Cobertura considerada "ok" quando atinge ≥95% da menor sugestão.
            const sugestaoMin = tipoSeg === "vida"
              ? Math.min(...[rendaMensal*12*10, patrimonioTotal].filter(v => v > 0))
              : tipoSeg === "veiculo" ? calcTotalVeiculosCliente(cliente)
              : tipoSeg === "residencial" ? calcTotalImoveisCliente(cliente)
              : tipoSeg === "multiplo" ? patrimonioTotal : 0;
            const coberturaOk = sugestaoMin > 0 && capital >= sugestaoMin * 0.95;

            // Cores de status — sempre azul como acento principal (proteção = confiança)
            // e verde quando a cobertura está adequada. Sem vermelho.
            const C_AZUL = T.blue;
            const C_VERDE = "#22c55e";
            const corAcento = coberturaOk ? C_VERDE : C_AZUL;
            const corBg = coberturaOk ? "rgba(34,197,94,0.10)" : "rgba(25,130,196,0.10)";
            const corBorder = coberturaOk ? "rgba(34,197,94,0.30)" : "rgba(25,130,196,0.30)";

            // Recomendações por tipo de seguro — paleta calmante (azul/dourado/teal),
            // sem vermelho de alarme.
            const recomendacoes = tipoSeg === "vida" ? [
              {
                n:"01", cor:C_AZUL,
                titulo:"Prudential — referência em vida",
                tag:"Recomendado",
                resumo:"Trabalhamos com a Prudential do Brasil para Seguro de Vida. Apólice individual, capital indexado ao IPCA (não perde valor pra inflação), cobertura por morte, invalidez total/parcial e antecipação por doença grave. Prêmio nivelado — não sobe com a idade depois que a apólice é fechada.",
              },
              {
                n:"02", cor:T.gold,
                titulo:"Adicionar coberturas extras",
                tag:"Personalização",
                resumo:"Vale a pena avaliar coberturas adicionais como Doenças Graves, Diária por Internação e Pensão para Cônjuge/Filhos. O custo a mais costuma ser pequeno e o impacto no orçamento da família, enorme.",
              },
              {
                n:"03", cor:"#14b8a6",
                titulo:"Resgatável ou tradicional?",
                tag:"Decisão técnica",
                resumo:"Vida tradicional tem mensalidade mais barata. Vida resgatável acumula uma reserva que, no futuro, pode virar uma previdência. Vamos decidir juntos qual faz mais sentido pro seu momento.",
              },
            ] : tipoSeg === "veiculo" ? [
              {
                n:"01", cor:C_AZUL,
                titulo:"Cotação em 3 seguradoras",
                tag:"Padrão de mercado",
                resumo:"Para veículo, sempre cotamos em 3 seguradoras (Porto, Bradesco, Allianz/Mapfre). O mesmo perfil pode variar 30 a 60% de preço entre operadoras — só comparando pra saber qual vale mais a pena.",
              },
              {
                n:"02", cor:T.gold,
                titulo:"Franquia × mensalidade",
                tag:"Equilíbrio",
                resumo:"Franquia mais alta reduz a mensalidade, mas só faz sentido se você tem dinheiro guardado pra cobrir um sinistro sem mexer em investimentos. Quem não tem reserva, escolhe franquia menor.",
              },
              {
                n:"03", cor:"#14b8a6",
                titulo:"Coberturas adicionais",
                tag:"Proteção total",
                resumo:"APP (Acidentes Pessoais), Carro Reserva e Vidros custam pouco a mais e evitam dor de cabeça grande no sinistro. Cobertura mínima para terceiros: R$ 200 mil em danos materiais + R$ 200 mil em danos corporais.",
              },
            ] : [
              {
                n:"01", cor:C_AZUL,
                titulo:"Cotação personalizada",
                tag:"Prioridade",
                resumo:"Vamos cotar o produto mais adequado ao seu perfil em parceria com as principais seguradoras do mercado.",
              },
              {
                n:"02", cor:T.gold,
                titulo:"Revisão anual",
                tag:"Boa prática",
                resumo:"Patrimônio e família mudam ao longo do tempo — a apólice precisa acompanhar. Revisamos toda apólice ao menos uma vez por ano.",
              },
            ];

            return (
              <div>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:6, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Recomendação de proteção
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.7 }}>
                  Veja como sua proteção fica configurada e os caminhos que recomendamos para fechar com segurança.
                </div>

                <div style={{ marginBottom:22, paddingBottom:20, borderBottom:`0.5px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ fontSize:16, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.01em" }}>
                    🛡️ {labelTipo}
                  </div>
                  <span style={{ fontSize:10, padding:"6px 14px", borderRadius:20, background:corBg, color:corAcento, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:600, border:`0.5px solid ${corBorder}` }}>
                    {coberturaOk ? "✓ Cobertura adequada" : "Proteção configurada"}
                  </span>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:10, marginBottom:18 }}>
                  {[
                    ["Capital segurado", capital > 0 ? brl(capital) : "—"],
                    ["Prêmio mensal estimado", mensal > 0 ? `${brl(mensal)}/mês` : "—"],
                    ["Cobertura anual", mensal > 0 ? `${brl(mensal * 12)}/ano` : "—"],
                    [tipoSeg === "vida" ? "Meses de renda protegidos" : "Custo / capital", tipoSeg === "vida" ? (mesesProtegidos > 0 ? `${mesesProtegidos} meses` : "—") : (capital > 0 && mensal > 0 ? `${((mensal * 12 / capital) * 100).toFixed(2)}% a.a.` : "—")],
                  ].map(([l,v]) => (
                    <div key={l} style={{ background:"rgba(255,255,255,0.025)", border:`0.5px solid ${T.border}`, borderRadius:T.radiusMd, padding:"14px" }}>
                      <div style={{ fontSize:9, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:6 }}>{l}</div>
                      <div style={{ fontSize:15, color:T.textPrimary, fontWeight:400 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {tipoSeg === "vida" && patrimonioTotal > 0 && (
                  <div style={{ background: coberturaPatrim >= 100 ? "rgba(34,197,94,0.08)" : "rgba(25,130,196,0.08)", border:`0.5px solid ${coberturaPatrim >= 100 ? "rgba(34,197,94,0.25)" : "rgba(25,130,196,0.25)"}`, borderRadius:T.radiusMd, padding:"14px 18px", marginBottom:18, fontSize:12, color:T.textSecondary, lineHeight:1.7 }}>
                    Hoje seu patrimônio total é <strong style={{ color:T.textPrimary }}>{brl(patrimonioTotal)}</strong> (somando investimentos, imóveis e veículos). O capital escolhido cobre <strong style={{ color: coberturaPatrim >= 100 ? "#22c55e" : T.gold }}>{coberturaPatrim}%</strong> {coberturaPatrim >= 100 ? "— sua família mantém todo o patrimônio sem precisar vender nada." : "do patrimônio. Quanto mais perto de 100%, menos sua família precisa abrir mão de bens."}
                  </div>
                )}

                <div style={{ borderRadius:T.radiusMd, padding:"15px 18px", fontSize:12, lineHeight:1.75, background:corBg, border:`0.5px solid ${corBorder}`, color:corAcento, marginBottom:24 }}>
                  {coberturaOk
                    ? (tipoSeg === "vida" ? "Excelente — sua família tem cobertura adequada. O próximo passo é cotar a apólice com a Prudential."
                      : tipoSeg === "veiculo" ? "Excelente — o capital cobre o valor do seu veículo. Vamos cotar nas 3 maiores seguradoras."
                      : tipoSeg === "residencial" ? "Excelente — o capital cobre o valor de reposição do imóvel. Vamos cotar nas principais seguradoras."
                      : "Excelente — o pacote de proteção está dimensionado pra cobrir todo seu patrimônio.")
                    : (tipoSeg === "vida" ? "Seguro de vida é a ponte que mantém o padrão da família se faltar a renda principal. Vamos cotar a apólice diretamente com a Prudential."
                      : tipoSeg === "veiculo" ? "Veículo financiado precisa ter seguro. Veículo quitado, vale comparar o custo do seguro anual com a reserva que você tem pra cobrir uma perda total."
                      : "A proteção certa transforma um imprevisto grave em só um inconveniente — não em colapso financeiro.")}
                </div>

                <div style={{ marginTop:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                    <div style={{ width:6, height:6, borderRadius:3, background:C_AZUL, boxShadow:`0 0 8px rgba(25,130,196,0.5)` }} />
                    <div style={{ fontSize:9, color:C_AZUL, letterSpacing:"0.22em", textTransform:"uppercase", fontWeight:600 }}>
                      Próximos passos
                    </div>
                  </div>
                  <div style={{ fontSize:18, fontWeight:300, color:T.textPrimary, marginBottom:18, lineHeight:1.3, letterSpacing:"-0.015em" }}>
                    Como vamos fechar essa proteção juntos
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {recomendacoes.map(r => (
                      <div key={r.n} style={{
                        background:"rgba(255,255,255,0.025)",
                        border:`0.5px solid ${T.border}`,
                        borderLeft:`3px solid ${r.cor}`,
                        borderRadius:T.radiusMd,
                        padding:"16px 18px",
                      }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:8, flexWrap:"wrap" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                            <span style={{ fontSize:11, fontWeight:600, color:r.cor, letterSpacing:"0.12em" }}>{r.n}</span>
                            <div style={{ width:3, height:14, background:r.cor, opacity:0.4, borderRadius:2 }} />
                            <div style={{ fontSize:14, color:T.textPrimary, fontWeight:400, lineHeight:1.3 }}>{r.titulo}</div>
                          </div>
                          <span style={{ fontSize:9, color:r.cor, letterSpacing:"0.12em", textTransform:"uppercase", background:`${r.cor}15`, padding:"4px 10px", borderRadius:20, fontWeight:600, whiteSpace:"nowrap", border:`0.5px solid ${r.cor}30` }}>{r.tag}</span>
                        </div>
                        <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.75, paddingLeft:25 }}>{r.resumo}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:18, lineHeight:1.7, fontStyle:"italic" }}>
                    Após salvar, seu assessor vai te chamar com a cotação detalhada e a apólice pronta pra assinar.
                  </div>
                </div>
              </div>
            );
          }

          // ────────────────────── SUCESSÃO PATRIMONIAL ──────────────────────
          if (tipo === "sucessaoPatrimonial") {
            const estrutura = form.estrutura || "estudar";
            const labelEst = { holding:"Holding Familiar", doacao:"Doação em Vida", testamento:"Testamento", estudar:"Estudo de Estrutura" }[estrutura] || "Estrutura";
            const beneficiarios = parseInt(form.beneficiarios) || 0;
            const economiaEstimada = capital * 0.15; // ITCMD + honorários ~15%

            const recomendacoes = estrutura === "holding" ? [
              {
                n:"01", cor:"#6A4C93",
                titulo:"Estrutura societária da holding",
                tag:"Etapa 1",
                resumo:"Constituição da pessoa jurídica (LTDA ou S/A familiar), integralização do patrimônio relevante (imóveis, participações, investimentos) com avaliação a custo histórico para minimizar ganho de capital na entrada.",
              },
              {
                n:"02", cor:"#F0A202",
                titulo:"Doação de quotas com cláusulas",
                tag:"Etapa 2",
                resumo:"Doação das quotas aos herdeiros com cláusulas de reserva de usufruto (você mantém controle e renda), incomunicabilidade, impenhorabilidade e reversão. ITCMD pago uma vez sobre a base reduzida.",
              },
              {
                n:"03", cor:"#3b82f6",
                titulo:"Acordo de sócios + governança",
                tag:"Etapa 3",
                resumo:"Acordo de sócios definindo regras de venda, entrada de cônjuges, distribuição de lucros e sucessão de gestão. Reuniões anuais formais. É o que evita briga de família virar disputa judicial.",
              },
            ] : estrutura === "doacao" ? [
              {
                n:"01", cor:"#6A4C93",
                titulo:"Doação com reserva de usufruto",
                tag:"Mais comum",
                resumo:"Você doa a nua-propriedade dos bens aos herdeiros mas mantém o usufruto vitalício — continua usando, alugando, recebendo dividendos. ITCMD pago hoje sobre a parte da nua-propriedade.",
              },
              {
                n:"02", cor:"#F0A202",
                titulo:"Cláusulas restritivas",
                tag:"Proteção",
                resumo:"Inclua incomunicabilidade (não entra em divórcio), impenhorabilidade (não responde por dívidas) e reversão (volta pra você se o herdeiro falecer antes). Triplica a proteção sem aumentar custo.",
              },
              {
                n:"03", cor:"#3b82f6",
                titulo:"Antecipação parcelada",
                tag:"Otimização tributária",
                resumo:"Em alguns estados, doar em parcelas anuais respeitando o limite de isenção (varia por UF) reduz drasticamente o ITCMD. Vale calcular caso a caso.",
              },
            ] : estrutura === "testamento" ? [
              {
                n:"01", cor:"#6A4C93",
                titulo:"Testamento público em cartório",
                tag:"Validade jurídica",
                resumo:"Lavrado em cartório com 2 testemunhas, é o formato mais sólido e impossível de contestar por vício de forma. Define quem fica com a parte disponível (50% do patrimônio se houver herdeiros necessários).",
              },
              {
                n:"02", cor:"#F0A202",
                titulo:"Combinação com PGBL/VGBL",
                tag:"Escape do inventário",
                resumo:"Recursos em previdência VGBL/PGBL não entram em inventário e vão direto pros beneficiários nomeados. Vale alocar parte do patrimônio aí pra dar liquidez imediata enquanto o testamento se executa.",
              },
              {
                n:"03", cor:"#3b82f6",
                titulo:"Atualização periódica",
                tag:"Manutenção",
                resumo:"Casamento, divórcio, novos filhos ou patrimônio relevante → revisar testamento. Custa uma fração do que custa um inventário com cláusulas desatualizadas.",
              },
            ] : [
              {
                n:"01", cor:"#6A4C93",
                titulo:"Diagnóstico patrimonial e familiar",
                tag:"Ponto de partida",
                resumo:"Antes de escolher estrutura, mapeamos: composição do patrimônio (imóveis, empresas, investimentos), regime de bens do casamento, herdeiros existentes/futuros e UF de domicílio (afeta ITCMD).",
              },
              {
                n:"02", cor:"#F0A202",
                titulo:"Comparação Holding × Doação × Testamento",
                tag:"Análise comparativa",
                resumo:"Cada estrutura tem custo de implementação, custo recorrente, complexidade e benefícios diferentes. Trazemos uma planilha lado a lado pro seu caso específico.",
              },
              {
                n:"03", cor:"#3b82f6",
                titulo:"Reunião com advogado tributarista",
                tag:"Implementação",
                resumo:"Definida a estrutura, conectamos você com escritório especializado em sucessão pra implementação. Acompanhamos o processo até as cláusulas estarem assinadas.",
              },
            ];

            return (
              <div>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:6, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Plano sucessório
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.7 }}>
                  Estruturar sucessão em vida custa muito menos do que deixar a família resolver via inventário.
                </div>

                <div style={{ marginBottom:22, paddingBottom:20, borderBottom:`0.5px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ fontSize:16, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.01em" }}>
                    👨‍👩‍👧‍👦 {labelEst}
                  </div>
                  <span style={{ fontSize:10, padding:"6px 14px", borderRadius:20, background:"rgba(106,76,147,0.20)", color:"#a78bfa", letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:600, border:"0.5px solid rgba(106,76,147,0.45)" }}>
                    Estrutura escolhida
                  </span>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:10, marginBottom:18 }}>
                  {[
                    ["Patrimônio a proteger", capital > 0 ? brl(capital) : "—"],
                    ["Beneficiários", beneficiarios > 0 ? `${beneficiarios} pessoa${beneficiarios > 1 ? "s" : ""}` : "—"],
                    ["Economia tributária estimada", capital > 0 ? `~${brl(economiaEstimada)}` : "—"],
                    ["Tempo médio de inventário evitado", "12–36 meses"],
                  ].map(([l,v]) => (
                    <div key={l} style={{ background:"rgba(255,255,255,0.025)", border:`0.5px solid ${T.border}`, borderRadius:T.radiusMd, padding:"14px" }}>
                      <div style={{ fontSize:9, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:6 }}>{l}</div>
                      <div style={{ fontSize:15, color:T.textPrimary, fontWeight:400 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderRadius:T.radiusMd, padding:"15px 18px", fontSize:12, lineHeight:1.75, background:"rgba(106,76,147,0.10)", border:"0.5px solid rgba(106,76,147,0.32)", color:"#a78bfa", marginBottom:24 }}>
                  Inventário típico custa 4% (advogado) + 2% a 8% (ITCMD por estado) + cartório, totalizando 10% a 20% do patrimônio. Em vida, esses números caem pela metade — ou somem completamente em estruturas bem planejadas.
                </div>

                <div style={{ marginTop:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                    <div style={{ width:6, height:6, borderRadius:3, background:"#a78bfa", boxShadow:"0 0 8px rgba(167,139,250,0.5)" }} />
                    <div style={{ fontSize:9, color:"#a78bfa", letterSpacing:"0.22em", textTransform:"uppercase", fontWeight:600 }}>
                      Caminho de implementação
                    </div>
                  </div>
                  <div style={{ fontSize:18, fontWeight:300, color:T.textPrimary, marginBottom:18, lineHeight:1.3, letterSpacing:"-0.015em" }}>
                    Etapas para estruturar a sucessão
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {recomendacoes.map(r => (
                      <div key={r.n} style={{
                        background:"rgba(255,255,255,0.025)",
                        border:`0.5px solid ${T.border}`,
                        borderLeft:`3px solid ${r.cor}`,
                        borderRadius:T.radiusMd,
                        padding:"16px 18px",
                      }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:8, flexWrap:"wrap" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                            <span style={{ fontSize:11, fontWeight:600, color:r.cor, letterSpacing:"0.12em" }}>{r.n}</span>
                            <div style={{ width:3, height:14, background:r.cor, opacity:0.4, borderRadius:2 }} />
                            <div style={{ fontSize:14, color:T.textPrimary, fontWeight:400, lineHeight:1.3 }}>{r.titulo}</div>
                          </div>
                          <span style={{ fontSize:9, color:r.cor, letterSpacing:"0.12em", textTransform:"uppercase", background:`${r.cor}15`, padding:"4px 10px", borderRadius:20, fontWeight:600, whiteSpace:"nowrap", border:`0.5px solid ${r.cor}30` }}>{r.tag}</span>
                        </div>
                        <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.75, paddingLeft:25 }}>{r.resumo}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:18, lineHeight:1.7, fontStyle:"italic" }}>
                    Sucessão envolve direito de família e tributário — sempre recomendamos validação com advogado especializado antes da implementação.
                  </div>
                </div>
              </div>
            );
          }

          // ─────────────────────── PLANO DE SAÚDE ───────────────────────
          if (tipo === "planoSaude") {
            const planoTipo = form.tipoPlano || "intermediario";
            const labelPlano = { basico:"Básico", intermediario:"Intermediário", premium:"Premium", internacional:"Internacional" }[planoTipo] || "Plano";
            const vidas = parseInt(form.vidas) || 1;
            const prazoNum = parseInt(form.prazo) || 0;
            const totalAcumulado = mensal * 12 * prazoNum;

            const recomendacoes = [
              {
                n:"01", cor:"#EC4899",
                titulo: planoTipo === "internacional" ? "Plano com cobertura internacional"
                  : planoTipo === "premium" ? "Operadoras Premium (rede ampla)"
                  : planoTipo === "intermediario" ? "Operadoras Intermediárias (rede regional)"
                  : "Plano Básico (atende emergências)",
                tag:"Cobertura",
                resumo: planoTipo === "internacional"
                  ? "Cigna, GeoBlue ou Allianz Care: atendimento em qualquer país, ideal pra famílias que viajam ou moram fora parte do ano. Custo elevado mas único formato com proteção global real."
                  : planoTipo === "premium"
                  ? "Bradesco Saúde Top Premium, SulAmérica Especial, Amil One: rede com Albert Einstein, Sírio-Libanês, HCor, Oswaldo Cruz. Reembolso amplo. Prêmio mais alto, tranquilidade máxima."
                  : planoTipo === "intermediario"
                  ? "SulAmérica Exato, Bradesco Saúde Nacional Plus, Amil 400/500: boa rede em capitais, rede credenciada robusta, reembolso parcial. Equilíbrio custo × cobertura."
                  : "Hapvida, NotreDame Intermédica, Amil S40: rede própria, atendimento na rede credenciada da região. Cobre emergências e o essencial — vale como ponto de partida ou pra dependentes mais jovens.",
              },
              {
                n:"02", cor:"#F0A202",
                titulo:"Coparticipação × pré-pago",
                tag:"Estrutura de custo",
                resumo:"Plano com coparticipação reduz a mensalidade em 20–30% mas cobra por uso (consulta, exame). Faz sentido pra famílias com baixa frequência de uso. Para idoso ou crianças pequenas, pré-pago tradicional sai mais barato no fim do ano.",
              },
              {
                n:"03", cor:"#3b82f6",
                titulo:"Reajustes anuais e VCMH",
                tag:"O que ninguém te conta",
                resumo:"Planos individuais sobem livre (ANS define teto coletivo, mas individual segue VCMH = inflação médica, ~13%/ano). Para famílias jovens, vale considerar plano coletivo por adesão (associações de classe) — reajuste mais previsível.",
              },
              {
                n:"04", cor:"#a855f7",
                titulo:"Fundo paralelo de saúde",
                tag:"Proteção dupla",
                resumo:"Plano cobre o essencial, mas exames específicos, dentista, fisioterapia particular e tratamentos de bem-estar ficam fora. Combine plano + fundo de saúde dedicado pra ter cobertura realmente completa.",
              },
            ];

            return (
              <div>
                <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:6, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                  Recomendação de cobertura
                </div>
                <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.7 }}>
                  Plano de saúde é o seguro silencioso que mais protege patrimônio. Veja como o seu fica configurado.
                </div>

                <div style={{ marginBottom:22, paddingBottom:20, borderBottom:`0.5px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  <div style={{ fontSize:16, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.01em" }}>
                    ❤️‍🩹 Plano {labelPlano} · {vidas} vida{vidas > 1 ? "s" : ""}
                  </div>
                  <span style={{ fontSize:10, padding:"6px 14px", borderRadius:20, background:"rgba(236,72,153,0.18)", color:"#EC4899", letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:600, border:"0.5px solid rgba(236,72,153,0.45)" }}>
                    Cobertura configurada
                  </span>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:10, marginBottom:18 }}>
                  {[
                    ["Mensalidade total", mensal > 0 ? `${brl(mensal)}/mês` : "—"],
                    ["Custo por vida", mensal > 0 && vidas > 0 ? `${brl(mensal / vidas)}/mês` : "—"],
                    ["Anos de cobertura", prazoNum > 0 ? `${prazoNum} ${prazoNum === 1 ? "ano" : "anos"}` : "—"],
                    ["Comprometimento total", totalAcumulado > 0 ? brl(totalAcumulado) : "—"],
                  ].map(([l,v]) => (
                    <div key={l} style={{ background:"rgba(255,255,255,0.025)", border:`0.5px solid ${T.border}`, borderRadius:T.radiusMd, padding:"14px" }}>
                      <div style={{ fontSize:9, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:6 }}>{l}</div>
                      <div style={{ fontSize:15, color:T.textPrimary, fontWeight:400 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ borderRadius:T.radiusMd, padding:"15px 18px", fontSize:12, lineHeight:1.75, background:"rgba(236,72,153,0.08)", border:"0.5px solid rgba(236,72,153,0.28)", color:"#EC4899", marginBottom:24 }}>
                  Uma cirurgia particular custa entre R$ 80k e R$ 500k. Em {prazoNum || 30} anos de plano, você comprometeu {brl(totalAcumulado || mensal * 12 * 30)} — mas evitou exposições que poderiam custar muito mais.
                </div>

                <div style={{ marginTop:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                    <div style={{ width:6, height:6, borderRadius:3, background:"#EC4899", boxShadow:"0 0 8px rgba(236,72,153,0.5)" }} />
                    <div style={{ fontSize:9, color:"#EC4899", letterSpacing:"0.22em", textTransform:"uppercase", fontWeight:600 }}>
                      Recomendações do especialista
                    </div>
                  </div>
                  <div style={{ fontSize:18, fontWeight:300, color:T.textPrimary, marginBottom:18, lineHeight:1.3, letterSpacing:"-0.015em" }}>
                    O que avaliar antes de fechar
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {recomendacoes.map(r => (
                      <div key={r.n} style={{
                        background:"rgba(255,255,255,0.025)",
                        border:`0.5px solid ${T.border}`,
                        borderLeft:`3px solid ${r.cor}`,
                        borderRadius:T.radiusMd,
                        padding:"16px 18px",
                      }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:8, flexWrap:"wrap" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                            <span style={{ fontSize:11, fontWeight:600, color:r.cor, letterSpacing:"0.12em" }}>{r.n}</span>
                            <div style={{ width:3, height:14, background:r.cor, opacity:0.4, borderRadius:2 }} />
                            <div style={{ fontSize:14, color:T.textPrimary, fontWeight:400, lineHeight:1.3 }}>{r.titulo}</div>
                          </div>
                          <span style={{ fontSize:9, color:r.cor, letterSpacing:"0.12em", textTransform:"uppercase", background:`${r.cor}15`, padding:"4px 10px", borderRadius:20, fontWeight:600, whiteSpace:"nowrap", border:`0.5px solid ${r.cor}30` }}>{r.tag}</span>
                        </div>
                        <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.75, paddingLeft:25 }}>{r.resumo}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })()}

        {/* ETAPA 4 — Diagnóstico (acumulação: aposentadoria, liquidez, carro, viagem, educação, saúde) */}
        {etapa === 4 && !isProtecao(form.tipo) && (() => {
          const anosNec = encontrarAnos(inicial, aporte, meta);
          const status = classificar(anosNec, prazo);
          const cor = corStatus[status];
          const tabela = calcularTabela(inicial, aporte, prazo || 30);
          const ultimo = tabela[tabela.length - 1];
          const msg = status === "viavel"
            ? "Tudo certo. Se continuar guardando esse valor, você atinge o objetivo no prazo."
            : status === "ajustavel"
            ? "Está quase lá. Um pequeno aumento no valor guardado por mês, ou um prazo 1 a 2 anos maior, resolve."
            : `Com o que você guarda hoje, o objetivo levaria ${anosNec ? fmtPrazo(anosNec) : "mais de 50 anos"} em vez de ${fmtPrazo(prazo)}. Aumente o valor mensal ou estenda o prazo.`;

          const ehAposentadoria = form.tipo === "aposentadoria";
          const ehLiquidez = form.tipo === "liquidez";
          const ehCarro = form.tipo === "carro";
          const ehImovel = form.tipo === "imovel";

          // Estimativas de consórcio/financiamento para o caminho de antecipação
          // (mesma fórmula usada em ObjetivoDetalhes.case "carro")
          const entradaCarro = meta * 0.2;
          const creditoConsorcioCarro = meta - entradaCarro;
          const prazoConsorcioCarro = Math.min(prazo || 5, 5);
          const taxaAdmCarroAA = 0.02; // média 1-3% a.a.
          const parcelaConsorcioCarro = (creditoConsorcioCarro * (1 + taxaAdmCarroAA * prazoConsorcioCarro)) / (prazoConsorcioCarro * 12);

          // Estimativas de consórcio/financiamento imobiliário
          // (espelham ObjetivoDetalhes.case "imovel")
          const entradaIm = meta * 0.2;
          const mesesParaEntradaIm = (aporte > 0 && entradaIm > inicial)
            ? Math.max(1, Math.ceil((entradaIm - inicial) / aporte))
            : null;
          // Consórcio: referência de mercado ~R$ 2.500-3.000 por R$ 1M de crédito
          // (produto ~30 anos com redutor de meia parcela, taxa admin 1-2% a.a.)
          const parcelaConsorcioIm = meta > 0 ? meta * 0.00275 : 0;
          // Financiamento: ~12% a.a. + seguros (MIP/DFI). Taxa efetiva ~1,25%/mês.
          const creditoFinIm = meta - entradaIm;
          const taxaFinMensalIm = 0.0125;
          const parcelaFinIm = creditoFinIm > 0
            ? creditoFinIm * (taxaFinMensalIm * Math.pow(1 + taxaFinMensalIm, 360)) / (Math.pow(1 + taxaFinMensalIm, 360) - 1)
            : 0;
          const mesesParaEntrada = (aporte > 0 && entradaCarro > 0)
            ? Math.max(1, Math.ceil((entradaCarro - inicial) / aporte))
            : null;

          // Cálculos para os 4 caminhos
          const calcAporteNec = () => {
            if (!prazo || prazo <= 0 || !meta) return aporte * 2;
            const j = Math.pow(1 + TAXA_ANUAL / 100, 1 / 12) - 1;
            const inflMensal = Math.pow(1 + IPCA_ANUAL / 100, 1 / 12) - 1;
            let aporteMin = 0, aporteMax = meta * 2;
            for (let iter = 0; iter < 60; iter++) {
              const aporteTeste = (aporteMin + aporteMax) / 2;
              let vt = inicial;
              let atingiu = false;
              const totalMeses = Math.max(1, Math.round(prazo * 12));
              for (let mes = 1; mes <= totalMeses; mes++) {
                vt = vt * (1 + j) + aporteTeste;
                if (vt / Math.pow(1 + inflMensal, mes) >= meta) { atingiu = true; break; }
              }
              if (!atingiu) aporteMin = aporteTeste; else aporteMax = aporteTeste;
            }
            return Math.ceil((aporteMin + aporteMax) / 2);
          };
          const aporteNec = calcAporteNec();
          const incrementoAporte = Math.max(0, aporteNec - aporte);

          // Para liquidez: a "meta" é múltiplo dos gastos mensais. Reduzir gastos
          // diminui a meta com efeito multiplicado (~6×).
          const gastosLiq = parseCentavos(form.gastosMensais || "0") / 100;
          const mesesEquiv = gastosLiq > 0 ? meta / gastosLiq : 0;
          const reducaoSugerida = gastosLiq > 0 ? Math.max(50, Math.round(gastosLiq * 0.1 / 50) * 50) : 200;
          const economiaTotal = reducaoSugerida * (mesesEquiv || 6);

          // 4 caminhos do plano — formato resumido (versão completa fica em Estratégias)
          const caminhos = [
            {
              n: "01",
              cor: "#22c55e",
              titulo: "Aumentar o aporte mensal",
              resumo: status === "viavel"
                ? `Você já está no caminho. Manter o aporte de ${brl(aporte)}/mês conduz ao objetivo no prazo.`
                : incrementoAporte > 0
                  ? `Aporte ${brl(aporteNec)}/mês — um incremento de ${brl(incrementoAporte)} sobre o atual — e você chega à meta em ${fmtPrazo(prazo)}.`
                  : "Mantenha consistência. Direcione 13º, bônus e PLR ao objetivo.",
              tag: "Rota direta",
            },
            {
              n: "02",
              cor: "#3b82f6",
              titulo: ehLiquidez ? "Estender o horizonte da reserva" : "Estender um pouco o prazo",
              resumo: anosNec
                ? `Mantendo ${brl(aporte)}/mês, sem mudar nada, você chega à meta em ${fmtPrazo(anosNec)} (${anosNec > prazo ? `+${fmtPrazo(Math.max(1/12, anosNec - prazo))} além do planejado` : "antes do planejado"}).`
                : "Com o aporte atual o prazo fica longo demais. Combine extensão com aumento de aporte.",
              tag: "Rota alternativa",
            },
            ...(ehAposentadoria ? [{
              n: "03",
              cor: T.gold,
              titulo: "Alavancagem patrimonial via consórcio",
              resumo: "Use o consórcio como capital barato para acelerar o patrimônio: cartas contempladas, imóveis com aluguel, ganho de capital ou troca de dívida cara.",
              tag: "Estratégia avançada",
            }] : []),
            ...(ehLiquidez ? [{
              n: "03",
              cor: T.gold,
              titulo: "Reduzir custos fixos",
              resumo: gastosLiq > 0
                ? `Cada ${brl(reducaoSugerida)} cortado dos seus gastos mensais reduz a sua reserva-alvo em cerca de ${brl(economiaTotal)} (${Math.round(mesesEquiv) || 6}× o gasto). É a única alavanca que ataca os dois lados — aporta mais e precisa de menos.`
                : "Reduzir gastos fixos é a única alavanca que ataca os dois lados: você sobra mais para aportar e precisa de uma reserva menor (cada R$ a menos no mês equivale a 6× a menos na meta).",
              tag: "Efeito multiplicador",
            }] : []),
            ...(ehCarro ? [{
              n: "03",
              cor: T.gold,
              titulo: "Antecipar com consórcio ou financiamento",
              resumo: meta > 0
                ? `Em vez de juntar ${brl(meta)} à vista, você junta ${brl(entradaCarro)} (20% de entrada${mesesParaEntrada ? ` — em ~${mesesParaEntrada} ${mesesParaEntrada === 1 ? "mês" : "meses"} no aporte atual` : ""}) e usa como lance no consórcio. Parcela estimada: ${brl(parcelaConsorcioCarro)}/mês com taxa de admin média de 2% a.a. (faixa de 1% a 3%).`
                : "Com 20% de entrada como lance, o consórcio costuma contemplar nos primeiros meses. Taxa de administração entre 1% e 3% a.a. — bem mais barato que o CDC tradicional.",
              tag: "Compra antecipada",
            }] : []),
            ...(ehImovel ? [
              {
                n: "03",
                cor: "#8AC926",
                titulo: "Consórcio Imobiliário",
                resumo: meta > 0
                  ? `Sem juros. Taxa de administração de 1% a 2% ao ano. Você acumula ${brl(entradaIm)} de entrada (20%)${mesesParaEntradaIm ? `. Em ~${mesesParaEntradaIm} ${mesesParaEntradaIm === 1 ? "mês" : "meses"} no aporte atual você chega à entrada` : ""}. Usa como lance para contemplação antecipada. Parcela estimada: ${brl(parcelaConsorcioIm)}/mês com redutor de meia parcela. FGTS pode ser usado como lance adicional.`
                  : "Menor custo total para aquisição a prazo. Sem juros, apenas taxa de admin de 1% a 2% ao ano. Produto com redutor de meia parcela. FGTS pode ser usado como lance para antecipar a contemplação.",
                tag: "Menor custo total",
              },
              {
                n: "04",
                cor: "#1982C4",
                titulo: "Financiamento Imobiliário",
                resumo: meta > 0
                  ? `Aquisição imediata com entrada de ${brl(entradaIm)} (20%). Parcelas estimadas de ~${brl(parcelaFinIm)}/mês em 360x (juros de 10% a 13% ao ano mais seguros obrigatórios). FGTS pode ser usado na entrada e em amortizações anuais. Compare o CET entre Caixa, bancos privados e cooperativas.`
                  : "Aquisição imediata com 20% de entrada. Taxa de juros de 10% a 13% ao ano hoje. Parcela inclui seguros obrigatórios (MIP e DFI). Use FGTS como entrada e em amortizações. Tabela SAC é mais barata que Price no longo prazo.",
                tag: "Compra imediata",
              },
            ] : []),
            {
              n: (ehAposentadoria || ehLiquidez || ehCarro || ehImovel) ? (ehImovel ? "05" : "04") : "03",
              cor: "#a855f7",
              titulo: ehLiquidez ? "Otimizar o rendimento da reserva" : "Aumentar a rentabilidade da carteira",
              resumo: ehLiquidez
                ? "Em reservas, segurança e liquidez vêm primeiro. Mas vale buscar pós-fixados isentos (LCI/LCA), CDBs de alta liquidez ou Tesouro Selic com rentabilidade acima do CDI — sem abrir mão do D+0 ou D+1."
                : "Otimize a alocação para buscar retornos maiores. Pode acelerar o objetivo, mas exige mais tolerância a oscilações de curto prazo.",
              tag: ehLiquidez ? "Sem abrir mão da liquidez" : "Mais retorno · mais risco",
            },
          ];

          return (
            <div>
              <div style={{ fontSize:22, fontWeight:300, color:T.textPrimary, marginBottom:6, lineHeight:1.25, letterSpacing:"-0.015em" }}>
                Diagnóstico do plano
              </div>
              <div style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.7 }}>
                Veja se o caminho que você desenhou leva você ao objetivo no prazo planejado.
              </div>

              <div style={{ marginBottom:22, paddingBottom:20, borderBottom:`0.5px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div style={{ fontSize:16, fontWeight:300, color:T.textPrimary, letterSpacing:"-0.01em" }}>
                  {form.nomeCustom || selecionado?.label}
                </div>
                <span style={{ fontSize:10, padding:"6px 14px", borderRadius:20, background:`${cor}18`, color:cor, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:600, border:`0.5px solid ${cor}40` }}>
                  {status === "viavel" ? "✓ Plano Viável" : status === "ajustavel" ? "⚠ Plano Ajustável" : "✕ Plano Inviável"}
                </span>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:10, marginBottom:18 }}>
                {[
                  ["Meta financeira",         brl(meta)],
                  ["Patrimônio dedicado hoje", brl(inicial)],
                  ["Aporte mensal",            `${brl(aporte)}/mês`],
                  ["Prazo planejado",          fmtPrazo(prazo)],
                  ["Prazo realista",           anosNec ? fmtPrazo(anosNec) : "50+ anos"],
                  [ehLiquidez ? "Reserva acumulada no prazo" : `Renda mensal em ${prazo}a`,
                                                ehLiquidez ? brl(ultimo?.totalReal||0) : `${brl(ultimo?.rendaMensalReal||0)}/mês`],
                ].map(([l,v],i)=>(
                  <div key={l} style={{
                    background:"rgba(255,255,255,0.025)",
                    border:`0.5px solid ${T.border}`,
                    borderRadius:T.radiusMd,
                    padding:"14px 14px",
                  }}>
                    <div style={{ fontSize:9, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:6 }}>{l}</div>
                    <div style={{ fontSize:15, color: i===4?cor:T.textPrimary, fontWeight:400 }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ borderRadius:T.radiusMd, padding:"15px 18px", fontSize:12, lineHeight:1.75, background:`${cor}0d`, border:`0.5px solid ${cor}33`, color:cor }}>
                {msg.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÀÇ])/).map((f, i, arr) => (
                  <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom: i < arr.length - 1 ? 6 : 0 }}>
                    {arr.length > 1 && (
                      <span style={{ color:cor, opacity:0.55, flexShrink:0, marginTop:3, fontSize:16, lineHeight:1, fontWeight:700 }}>•</span>
                    )}
                    <span style={{ flex:1 }}>{f.trim()}</span>
                  </div>
                ))}
              </div>

              {/* ── CAMINHOS PARA AJUSTAR O PLANO ── */}
              <div style={{ marginTop:36 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <div style={{ width:6, height:6, borderRadius:3, background:T.gold, boxShadow:`0 0 8px ${T.goldBorder}` }} />
                  <div style={{ fontSize:9, color:T.gold, letterSpacing:"0.22em", textTransform:"uppercase", fontWeight:600 }}>
                    Recomendações do especialista
                  </div>
                </div>
                <div style={{ fontSize:18, fontWeight:300, color:T.textPrimary, marginBottom:8, lineHeight:1.3, letterSpacing:"-0.015em" }}>
                  Caminhos para ajustar o seu plano
                </div>
                <div style={{ fontSize:12, color:T.textSecondary, marginBottom:18, lineHeight:1.75, maxWidth:580 }}>
                  Existe sempre mais de um caminho. Escolha o que faz mais sentido pra você — ou combine vários.
                  Após salvar, abra o objetivo na aba <strong style={{ color:T.textPrimary, fontWeight:500 }}>Estratégias</strong> para ver os números detalhados de cada um.
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {caminhos.map(c => (
                    <div key={c.n} style={{
                      background:"rgba(255,255,255,0.025)",
                      border:`0.5px solid ${T.border}`,
                      borderLeft:`3px solid ${c.cor}`,
                      borderRadius:T.radiusMd,
                      padding:"16px 18px",
                      transition:"all 0.2s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:8, flexWrap:"wrap" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                          <span style={{ fontSize:11, fontWeight:600, color:c.cor, letterSpacing:"0.12em" }}>
                            {c.n}
                          </span>
                          <div style={{ width:3, height:14, background:c.cor, opacity:0.4, borderRadius:2 }} />
                          <div style={{ fontSize:14, color:T.textPrimary, fontWeight:400, lineHeight:1.3 }}>
                            {c.titulo}
                          </div>
                        </div>
                        <span style={{
                          fontSize:9, color:c.cor, letterSpacing:"0.12em", textTransform:"uppercase",
                          background:`${c.cor}15`, padding:"4px 10px", borderRadius:20, fontWeight:600, whiteSpace:"nowrap",
                          border:`0.5px solid ${c.cor}30`,
                        }}>{c.tag}</span>
                      </div>
                      <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.75, paddingLeft:25 }}>
                        {c.resumo}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize:11, color:T.textMuted, marginTop:18, lineHeight:1.7, fontStyle:"italic" }}>
                  As recomendações são baseadas nas melhores práticas de planejamento financeiro. A escolha ideal
                  considera seu perfil de risco, liquidez e momento de vida — fale com seu assessor.
                </div>
              </div>
            </div>
          );
        })()}

        {/* Mensagem de erro ao salvar */}
        {erroSalvar && (
          <div style={{
            marginTop: 20,
            padding: "12px 16px",
            background: "rgba(239,68,68,0.08)",
            border: "0.5px solid rgba(239,68,68,0.28)",
            borderRadius: T.radiusMd,
            color: "#ef4444",
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            {erroSalvar}
          </div>
        )}

        {/* Botões de navegação — alinhados à direita, tamanho editorial */}
        <div style={{ display:"flex", gap:12, marginTop:32, justifyContent:"flex-end", alignItems:"center", flexWrap:"wrap" }}>
          {etapa > 1 && (
            <button style={{ padding:"13px 24px", background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.radiusMd, color:T.textMuted, cursor:"pointer", fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:T.fontFamily, transition:"all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.color = T.textSecondary; e.currentTarget.style.borderColor = T.textMuted; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
              onClick={() => {
                if (isProtecao(form.tipo) && etapa === 4) setEtapa(1);
                else if (TIPOS_3_ETAPAS.has(form.tipo) && etapa === 4) setEtapa(2);
                else setEtapa(e => e - 1);
              }}>
              ← Voltar
            </button>
          )}
          {etapa < 4 && (() => {
            // planoSaude define meta a partir de aporte × prazo (mensalidades acumuladas), não exige meta manual
            const isPlanoSaude = form.tipo === "planoSaude";
            const metaVazia = !isPlanoSaude && parseCentavos(form.meta) <= 0;
            const nomeVazio = (form.tipo === "personalizado" || form.tipo === "carro" || form.tipo === "viagem" || form.tipo === "educacao") && !String(form.nomeCustom || "").trim();
            const rendaVazia = form.tipo === "aposentadoria" && parseCentavos(form.rendaMensal) <= 0;
            const prazoVazioApos = form.tipo === "aposentadoria" && (parseInt(form.prazo) || 0) <= 0;
            const prazoVazioCarro = form.tipo === "carro" && (parseInt(form.prazo) || 0) <= 0;
            const prazoVazioViagem = form.tipo === "viagem" && (parseFloat(form.prazo) || 0) <= 0;
            const prazoVazioEduc = form.tipo === "educacao" && (parseInt(form.prazo) || 0) <= 0;
            const cursoVazioEduc = form.tipo === "educacao" && !form.cursoTipo;
            const gastosVazioLiq = form.tipo === "liquidez" && parseCentavos(form.gastosMensais || "0") <= 0;
            // Proteções
            const tipoSeguroVazio = form.tipo === "seguros" && !form.tipoSeguro;
            const estruturaVazia = form.tipo === "sucessaoPatrimonial" && !form.estrutura;
            const tipoFundoVazio = form.tipo === "saude" && !form.tipoFundo;
            const prazoVazioSaude = form.tipo === "saude" && (parseInt(form.prazo) || 0) <= 0;
            const tipoPlanoVazio = form.tipo === "planoSaude" && !form.tipoPlano;
            const aporteVazioPlanoSaude = form.tipo === "planoSaude" && parseCentavos(form.aporte || "0") <= 0;
            const prazoVazioPlanoSaude = form.tipo === "planoSaude" && (parseInt(form.prazo) || 0) <= 0;
            const bloqueadoEtapa1 = etapa === 1 && (metaVazia || nomeVazio || rendaVazia || prazoVazioApos || prazoVazioCarro || prazoVazioViagem || prazoVazioEduc || cursoVazioEduc || gastosVazioLiq || tipoSeguroVazio || estruturaVazia || tipoFundoVazio || prazoVazioSaude || tipoPlanoVazio || aporteVazioPlanoSaude || prazoVazioPlanoSaude);
            const semPatrim = parseCentavos(form.patrimAtual) <= 0;
            const semAtivos = ativosSelecionados.size === 0;
            const semAporte = parseCentavos(form.aporte) <= 0;
            const semPrazoLiq = form.tipo === "liquidez" && (parseFloat(form.prazo) || 0) <= 0;
            const bloqueadoEtapa2 = etapa === 2 && (
              (patrimSource === "manual" ? semPatrim : semAtivos) || semAporte || semPrazoLiq
            );
            const bloqueadoEtapa3 = etapa === 3 && (parseInt(form.prazo) || 0) <= 0;
            const bloqueado = bloqueadoEtapa1 || bloqueadoEtapa2 || bloqueadoEtapa3;
            const isUltimaAntesDiag = (isProtecao(form.tipo) && etapa === 1)
              || (TIPOS_3_ETAPAS.has(form.tipo) && etapa === 2)
              || (!TIPOS_3_ETAPAS.has(form.tipo) && !isProtecao(form.tipo) && etapa === 3);
            return (
              <button
                style={{
                  padding:"14px 36px",
                  minWidth: 220,
                  background: bloqueado ? "rgba(255,255,255,0.03)" : T.goldDim,
                  border: bloqueado ? `1px solid ${T.border}` : `1px solid ${T.goldBorder}`,
                  borderRadius:T.radiusMd,
                  color: bloqueado ? T.textMuted : T.gold,
                  cursor: bloqueado ? "not-allowed" : "pointer",
                  fontSize:11, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:T.fontFamily,
                  fontWeight:600,
                  transition:"all 0.2s",
                  boxShadow: bloqueado ? "none" : `0 4px 14px ${T.goldBorder}`,
                }}
                onClick={() => {
                  if (bloqueado) return;
                  if (isProtecao(form.tipo) && etapa === 1) setEtapa(4);
                  else if (TIPOS_3_ETAPAS.has(form.tipo) && etapa === 2) setEtapa(4);
                  else setEtapa(e => e + 1);
                }}
                disabled={bloqueado}
                title={
                  bloqueadoEtapa1 && prazoVazioApos
                    ? "Informe em quantos anos quer alcançar a liberdade financeira"
                    : bloqueadoEtapa1 && rendaVazia
                    ? "Informe a renda mensal desejada"
                    : bloqueadoEtapa1 && nomeVazio
                    ? "Informe o nome do objetivo"
                    : bloqueadoEtapa1 && tipoSeguroVazio
                    ? "Selecione o tipo de seguro"
                    : bloqueadoEtapa1 && estruturaVazia
                    ? "Selecione a estrutura sucessória desejada"
                    : bloqueadoEtapa1 && tipoFundoVazio
                    ? "Escolha para qual finalidade é o fundo de saúde"
                    : bloqueadoEtapa1 && prazoVazioSaude
                    ? "Informe em quantos anos quer acumular o fundo"
                    : bloqueadoEtapa1 && tipoPlanoVazio
                    ? "Selecione o tipo de plano de saúde"
                    : bloqueadoEtapa1 && aporteVazioPlanoSaude
                    ? "Informe a mensalidade estimada do plano"
                    : bloqueadoEtapa1 && prazoVazioPlanoSaude
                    ? "Informe os anos de cobertura planejados"
                    : bloqueadoEtapa1
                    ? "Informe a meta financeira"
                    : bloqueadoEtapa2 && semAporte && (patrimSource === "manual" ? !semPatrim : !semAtivos)
                    ? "Informe o aporte mensal"
                    : bloqueadoEtapa2 && patrimSource === "ativos"
                    ? "Selecione pelo menos um ativo ou troque para valor manual"
                    : bloqueadoEtapa2
                    ? "Informe o patrimônio já acumulado ou vincule ativos financeiros"
                    : bloqueadoEtapa3
                    ? "Informe o prazo desejado em anos"
                    : undefined
                }
              >
                {isUltimaAntesDiag ? (isProtecao(form.tipo) ? "Ver recomendação →" : "Ver diagnóstico →") : "Próximo →"}
              </button>
            );
          })()}
          {etapa === 4 && (
            <button style={{
                padding:"14px 36px",
                minWidth: 220,
                background:T.goldDim,
                border:`1px solid ${T.goldBorder}`,
                borderRadius:T.radiusMd,
                color:T.gold,
                cursor:salvando ? "wait" : "pointer",
                fontSize:11, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:T.fontFamily,
                fontWeight:600,
                boxShadow:`0 4px 14px ${T.goldBorder}`,
              }}
              onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar objetivo →"}
            </button>
          )}
        </div>
      </div>
      <BotoesNavegacao />
    </div>
  );
}