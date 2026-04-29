import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { doc, getDoc, setDoc, addDoc, deleteDoc, collection } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../hooks/useAuth";
import { T, C } from "../theme";
import { AvatarIcon } from "./Dashboard";
import HomeLiberdade from "../components/cliente/HomeLiberdade";
import NotificacoesBell from "../components/cliente/NotificacoesBell";
import DonutChartModern from "../components/DonutChartModern";
import { SilentBoundary } from "../components/SilentBoundary";
import "../styles/notif-bell.css";

import { parseCentavos, brl, formatMi } from "../utils/currency";
import { criarObjetivoStub, TIPO_OBJETIVO_PARA_LABEL } from "../utils/ativos";
import { MARCAS_VEICULOS_BR } from "../constants/veiculosBrasil";
import { obterTodasAsCotacoes, mercadoAberto, lerCacheCotacoes } from "../services/cotacoesReais";
import { stripUndefined } from "../services/snapshotsCarteira";

// Cotações de fallback — mesma tabela usada no Dashboard, para quando o
// cache local ainda não existir (cliente que entra direto na própria ficha).
const MERCADO_FALLBACK = [
  { label:"Dólar",    valor:"R$ 5,08",  sub:"-1,0% hoje",  cor:"#ef4444" },
  { label:"Selic",    valor:"14,75%",   sub:"a.a.",         cor:"#6b7280" },
  { label:"IPCA",     valor:"4,14%",    sub:"12 meses",     cor:"#6b7280" },
  { label:"Ibovespa", valor:"197.000",  sub:"+21% no ano",  cor:"#22c55e" },
  { label:"S&P 500",  valor:"5.396",    sub:"+10% no ano",  cor:"#22c55e" },
];

// Converte o payload bruto de obterTodasAsCotacoes() para o formato usado
// na faixa de indicadores (mesmo contrato do Dashboard).
function formatarCotacoesCliente(c) {
  if (!c) return MERCADO_FALLBACK;
  const dolarVar = c.dolar?.variacao ?? 0;
  const iboVar = c.ibovespa?.variacao ?? 0;
  const spVar = c.sp500?.variacao ?? 0;
  return [
    { label:"Dólar", valor:`R$ ${(c.dolar?.valor ?? 5.08).toFixed(2).replace(".",",")}`,
      sub: dolarVar ? `${dolarVar>=0?"+":""}${dolarVar.toFixed(2).replace(".",",")}% hoje` : (c.dolar?.tipo || "hoje"),
      cor: dolarVar>=0 ? "#22c55e" : "#ef4444" },
    { label:"Selic", valor:`${(c.selic?.valor ?? 14.75).toFixed(2).replace(".",",")}%`, sub:c.selic?.tipo || "a.a.", cor:"#6b7280" },
    { label:"IPCA",  valor:`${(c.ipca?.valor ?? 4.14).toFixed(2).replace(".",",")}%`,   sub:c.ipca?.tipo  || "12 meses", cor:"#6b7280" },
    { label:"Ibovespa", valor:`${Math.round(c.ibovespa?.valor ?? 197000).toLocaleString("pt-BR")}`,
      sub: iboVar ? `${iboVar>=0?"+":""}${iboVar.toFixed(2).replace(".",",")}% hoje` : (c.ibovespa?.tipo || "hoje"),
      cor: iboVar>=0 ? "#22c55e" : "#ef4444" },
    { label:"S&P 500", valor:`${Math.round(c.sp500?.valor ?? 5396).toLocaleString("pt-BR")}`,
      sub: spVar ? `${spVar>=0?"+":""}${spVar.toFixed(2).replace(".",",")}% hoje` : (c.sp500?.tipo || "hoje"),
      cor: spVar>=0 ? "#22c55e" : "#ef4444" },
  ];
}

// ── Helpers ────────────────────────────────────────────────────
// moeda local: centavos → string ou null (preserva comportamento legado).
function moeda(c) {
  const n = parseCentavos(c);
  if(!n) return null;
  return brl(n/100, { zeroAsDash: false });
}
// moedaFull: recebe reais, retorna "—" para zero. Equivalente a brl(v).
const moedaFull = brl;
function calcularIdade(nasc) {
  if(!nasc) return null;
  const p = nasc.split("/");
  if(p.length<3) return null;
  const d = new Date(`${p[2]}-${p[1]}-${p[0]}`);
  if(isNaN(d)) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear()-d.getFullYear();
  const m = hoje.getMonth()-d.getMonth();
  if(m<0||(m===0&&hoje.getDate()<d.getDate())) idade--;
  return idade>0&&idade<120 ? idade : null;
}
function segmentoAuto(patrimonio) {
  const v = parseCentavos(patrimonio)/100;
  if(v<=0) return null;
  if(v<150000) return "Digital";
  if(v<500000) return "Ascensão";
  if(v<1000000) return "Exclusive";
  return "Private";
}
function formatarData(ts) {
  if(!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
}
function proximoDia1() {
  const hoje = new Date();
  const p = new Date(hoje.getFullYear(), hoje.getMonth()+1, 1);
  return `${String(p.getDate()).padStart(2,"0")}/${String(p.getMonth()+1).padStart(2,"0")}/${p.getFullYear()}`;
}
function contatoVencido(dateStr) {
  if(!dateStr) return false;
  const p = dateStr.split("/");
  if(p.length<3) return false;
  return new Date(`${p[2]}-${p[1]}-${p[0]}`) < new Date();
}

// ── Constants ──────────────────────────────────────────────────
const ESTADOS_BRASIL = [
  "AC – Acre","AL – Alagoas","AP – Amapá","AM – Amazonas","BA – Bahia",
  "CE – Ceará","DF – Distrito Federal","ES – Espírito Santo","GO – Goiás",
  "MA – Maranhão","MT – Mato Grosso","MS – Mato Grosso do Sul","MG – Minas Gerais",
  "PA – Pará","PB – Paraíba","PR – Paraná","PE – Pernambuco","PI – Piauí",
  "RJ – Rio de Janeiro","RN – Rio Grande do Norte","RS – Rio Grande do Sul",
  "RO – Rondônia","RR – Roraima","SC – Santa Catarina","SP – São Paulo",
  "SE – Sergipe","TO – Tocantins"
];
const PROFISSOES = [
  "Médico(a)","Médico Especialista","Cirurgião(ã)","Dentista","Fisioterapeuta",
  "Enfermeiro(a)","Psicólogo(a)","Farmacêutico(a)","Nutricionista","Veterinário(a)",
  "Advogado(a)","Juiz(a) / Desembargador(a)","Promotor(a) de Justiça","Defensor(a) Público",
  "Tabelião / Notário",
  "Empresário(a)","Sócio-Proprietário","Diretor(a) Executivo","CEO / Fundador",
  "Gerente","Consultor(a)","Analista",
  "Engenheiro(a) Civil","Engenheiro(a) Elétrico","Engenheiro(a) Mecânico","Engenheiro(a) de Software",
  "Arquiteto(a)","Desenvolvedor(a) / TI","Cientista de Dados","Analista de TI",
  "Economista","Contador(a)","Auditor(a)","Actuário(a)",
  "Investidor(a)","Trader","Gestor(a) de Fundos","Gestor(a) de Patrimônio",
  "Corretor(a) de Imóveis","Corretor(a) de Seguros","Agente Financeiro",
  "Professor(a)","Coordenador(a) Pedagógico","Reitor(a)",
  "Funcionário Público Federal","Funcionário Público Estadual","Servidor(a) Municipal",
  "Militar – Oficial","Militar – Praça","Policial Civil","Policial Militar","Bombeiro(a)",
  "Autônomo(a)","Comerciante","Aposentado(a)","Pensionista",
  "Agropecuarista / Produtor Rural","Piloto(a)","Jornalista",
  "Designer","Marketing / Publicidade","Administrador(a)",
  "Influencer / Criador de Conteúdo","Artista / Músico(a)","Outros"
];
const HOBBIES = [
  "Viagens","Academia","Corrida","Golfe","Tênis","Futebol","Pescaria","Leitura",
  "Ciclismo","Games","Gastronomia","Fotografia","Arte","Vinho","Surf","Música","Yoga","Meditação"
];
const AVATAR_OPTS = [
  {key:"homem",label:"Homem"},{key:"mulher",label:"Mulher"},
  {key:"idoso_h",label:"Experiente"},{key:"idoso_m",label:"Experiente"},
  {key:"cachorro",label:"Companheiro"},{key:"gato",label:"Amigável"},
];
const TIPOS_IMOVEL = ["Casa","Apartamento","Cobertura","Terreno","Sítio / Fazenda","Imóvel Comercial","Galpão / Armazém"];
const TIPOS_VEICULO = ["Carro","SUV","Picape","Moto","Caminhão","Ônibus","Barco","Aeronave","Outros"];
const FAIXAS_IMOVEL = [
  ...Array.from({length:50},(_,i)=>{const v=(i+1)*100000;return{label:`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`,mid:v};}),
  {label:"R$ 5.500.000,00",mid:5500000},
  {label:"R$ 6.000.000,00",mid:6000000},
  {label:"R$ 7.000.000,00",mid:7000000},
  {label:"R$ 8.000.000,00",mid:8000000},
  {label:"R$ 9.000.000,00",mid:9000000},
  {label:"R$ 10.000.000,00",mid:10000000},
  {label:"Acima de R$ 10M",mid:12000000},
];
const FAIXAS_VEICULO = [
  ...Array.from({length:50},(_,i)=>{const v=(i+1)*10000;return{label:`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`,mid:v};}),
  {label:"R$ 600.000,00",mid:600000},
  {label:"R$ 700.000,00",mid:700000},
  {label:"R$ 800.000,00",mid:800000},
  {label:"R$ 900.000,00",mid:900000},
  {label:"R$ 1.000.000,00",mid:1000000},
  {label:"Acima de R$ 1M",mid:1200000},
];
const ESTADO_CIVIL = ["Solteiro(a)","Casado(a)","União Estável","Divorciado(a)","Viúvo(a)"];
const FOCOS_INVESTIMENTO = ["Dividendos / Renda","Valorização / Crescimento","Equilibrado (dividendos + valorização)"];
const MODELO_ATENDIMENTO = ["Fee Based","Comissionado (Commission Based)"];
const DIAS_MES = Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0"));
const VEICULOS_BRASIL = [
  "Fiat Strada","Volkswagen Polo","Chevrolet Onix","Hyundai HB20","Fiat Mobi",
  "Fiat Argo","Chevrolet Tracker","Volkswagen T-Cross","Toyota Corolla Cross","Fiat Pulse",
  "Hyundai Creta","Jeep Compass","Jeep Renegade","Honda HR-V","Volkswagen Nivus",
  "Nissan Kicks","Volkswagen Saveiro","Volkswagen Virtus","Renault Kwid","Toyota Corolla",
  "Chevrolet S10","Ford Ranger","Toyota Hilux","Volkswagen Amarok","Fiat Toro",
  "Jeep Commander","Volkswagen Taos","Honda Civic","Toyota Yaris","Honda City",
  "Chevrolet Spin","Chevrolet Montana","Renault Kardian","Renault Duster","Nissan Sentra",
  "Peugeot 208","Peugeot 2008","Citroën C3","Volkswagen Tiguan","Toyota SW4",
  "BMW X1","Mercedes-Benz GLA","Audi Q3","Volvo XC40","Porsche Macan",
  "Range Rover Evoque","Honda CR-V","Hyundai Tucson","Chevrolet Trailblazer","Mitsubishi L200",
  "Outros",
];
const OBJETIVOS_CADASTRO = [
  {id:"aposentadoria",label:"Aposentadoria e Liberdade Financeira",icon:"🌴"},
  {id:"imovel",label:"Aquisição de Imóvel",icon:"🏡"},
  {id:"liquidez",label:"Reserva de Emergência",icon:"🛟"},
  {id:"carro",label:"Comprar Veículo",icon:"🚗"},
  {id:"oportunidade",label:"Reserva de Oportunidade",icon:"💎"},
  {id:"viagem",label:"Viagens e Experiências",icon:"✈️"},
  {id:"educacao",label:"Educação dos Filhos",icon:"🎓"},
  {id:"saude",label:"Saúde e Qualidade de Vida",icon:"❤️"},
  {id:"sucessaoPatrimonial",label:"Sucessão Patrimonial",icon:"👨‍👩‍👧‍👦"},
  {id:"seguros",label:"Seguro de Vida e de Veículos",icon:"🛡️"},
  {id:"planoSaude",label:"Plano de Saúde",icon:"🏥"},
];
const CLASSES_CARTEIRA = [
  {key:"posFixado",      label:"Pós-Fixado",           cor:"#2563eb"},
  {key:"ipca",           label:"IPCA+",                cor:"#3b82f6"},
  {key:"preFixado",      label:"Pré-Fixado",           cor:"#60a5fa"},
  {key:"acoes",          label:"Ações",                cor:"#22c55e"},
  {key:"fiis",           label:"FIIs",                 cor:"#F0A202"},
  {key:"multi",          label:"Multimercado",          cor:"#a07020"},
  {key:"prevVGBL",       label:"Prev. VGBL",           cor:"#f59e0b"},
  {key:"prevPGBL",       label:"Prev. PGBL",           cor:"#d97706"},
  {key:"globalEquities", label:"Global – Equities",    cor:"#a855f7"},
  {key:"globalTreasury", label:"Global – Treasury",    cor:"#c084fc"},
  {key:"globalFunds",    label:"Global – Funds",       cor:"#7c3aed"},
  {key:"globalBonds",    label:"Global – Bonds",       cor:"#9333ea"},
  {key:"global",         label:"Global (Geral)",       cor:"#60a5fa"},
  {key:"outros",         label:"Outros / Não Classif.",cor:"#94a3b8"},
];

const noEdit = {userSelect:"none",WebkitUserSelect:"none",cursor:"default"};

// ── Hooks responsivos (antes em useResponsive.js) ──────────────

// Retorna true se a largura da janela estiver abaixo do breakpoint (padrão 640px).
// Reage a `resize`. Usa SSR-safe default (false) quando `window` não existe.
function useIsMobile(bp = 640) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}

// Retorna true se a largura da janela estiver acima do breakpoint (padrão 1100px).
function useIsWide(bp = 1100) {
  const [w, setW] = useState(() => typeof window !== "undefined" && window.innerWidth >= bp);
  useEffect(() => {
    const on = () => setW(window.innerWidth >= bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return w;
}


// ── Componentes de input (antes em ficha/inputs.jsx) ───────────

// Desabilita seleção/edição visual (usado em wrappers clicáveis).
// Input monetário com formatação automática em BRL.
// `initValue` é uma string de centavos (ex: "12345" → R$ 123,45).
const InputMoeda = memo(function InputMoeda({ initValue, onCommit, placeholder = "R$ 0,00" }) {
  const [raw, setRaw] = useState(initValue || "");
  function fmt(r) {
    if (!r) return placeholder;
    const n = parseInt(String(r).replace(/\D/g, "")) || 0;
    return (n / 100).toLocaleString("pt-BR", {
      style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function handleChange(e) {
    const v = e.target.value.replace(/\D/g, "");
    setRaw(v);
    onCommit(v);
  }
  return <input style={C.input} placeholder={placeholder} value={fmt(raw)} onChange={handleChange} />;
});

// Input de texto genérico com suporte a ref externa, handler de foco e indicação de erro.
const InputTexto = memo(function InputTexto({
  initValue, onCommit, placeholder = "", type = "text", hasError = false, inputRef = null, onFocus = null,
}) {
  const [val, setVal] = useState(initValue || "");
  function handleChange(e) { setVal(e.target.value); onCommit(e.target.value); }
  const errStyle = hasError
    ? { border: "1px solid #ef4444", background: "rgba(239,68,68,0.06)", boxShadow: "0 0 0 3px rgba(239,68,68,0.12)" }
    : null;
  return (
    <input
      ref={inputRef}
      onFocus={onFocus}
      style={{ ...C.input, ...(errStyle || {}) }}
      type={type}
      placeholder={placeholder}
      value={val}
      onChange={handleChange}
    />
  );
});

// Textarea com altura fixa e sem resize (usado em campos de observação).
const TextareaLocal = memo(function TextareaLocal({ initValue, onCommit, placeholder = "" }) {
  const [val, setVal] = useState(initValue || "");
  function handleChange(e) { setVal(e.target.value); onCommit(e.target.value); }
  return (
    <textarea
      style={{ ...C.input, height: 80, resize: "none", lineHeight: 1.6, paddingTop: 12 }}
      placeholder={placeholder}
      value={val}
      onChange={handleChange}
    />
  );
});

// Select customizado com dropdown (substitui o <select> nativo para estilização total).
function CustomSelect({ value, onChange, options, placeholder = "Selecione" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function click(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{ ...C.input, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", ...noEdit }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: value ? T.textPrimary : T.textMuted, fontSize: 14 }}>{value || placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#111827", border: `0.5px solid ${T.border}`, borderRadius: 10, zIndex: 300,
          overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 220, overflowY: "auto",
        }}>
          {options.map(opt => (
            <div
              key={opt}
              style={{
                padding: "11px 16px", fontSize: 13,
                color: value === opt ? "#F0A202" : T.textSecondary,
                background: value === opt ? "rgba(240,162,2,0.08)" : "transparent",
                cursor: "pointer", ...noEdit,
              }}
              onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false); }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Input de telefone com formatação automática (51) 99999-9999.
const InputTelefone = memo(function InputTelefone({ initValue, onCommit }) {
  const [val, setVal] = useState(initValue || "");
  function fmt(raw) {
    const d = String(raw || "").replace(/\D/g, "").slice(0, 11);
    if (!d) return "";
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  function handleChange(e) {
    const formatted = fmt(e.target.value);
    setVal(formatted);
    onCommit(formatted);
  }
  return <input style={C.input} placeholder="(51) 99999-9999" value={val} onChange={handleChange} inputMode="tel" />;
});

// Input que aceita idade (1-3 dígitos até 120) OU data DD/MM/AAAA (4+ dígitos).
const InputIdadeOuNasc = memo(function InputIdadeOuNasc({ initValue, onCommit }) {
  const [val, setVal] = useState(initValue || "");
  function fmt(raw) {
    const d = String(raw || "").replace(/\D/g, "").slice(0, 8);
    if (!d) return "";
    if (d.length <= 3) {
      const n = parseInt(d);
      if (n <= 120) return d;
      return d.slice(0, 2);
    }
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
  function handleChange(e) {
    const formatted = fmt(e.target.value);
    setVal(formatted);
    onCommit(formatted);
  }
  return <input style={C.input} placeholder="Idade ou DD/MM/AAAA" value={val} onChange={handleChange} inputMode="numeric" />;
});

// Multi-select com checkboxes em dropdown.
function MultiSelect({ values, onChange, options, placeholder = "Selecione" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const arr = Array.isArray(values) ? values : [];
  useEffect(() => {
    function click(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);
  function toggle(opt) {
    if (arr.includes(opt)) onChange(arr.filter(x => x !== opt));
    else onChange([...arr, opt]);
  }
  const display = arr.length === 0 ? placeholder : arr.length <= 2 ? arr.join(", ") : `${arr.length} selecionados`;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{ ...C.input, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", ...noEdit }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: arr.length > 0 ? T.textPrimary : T.textMuted, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#111827", border: `0.5px solid ${T.border}`, borderRadius: 10, zIndex: 300,
          overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 260, overflowY: "auto",
        }}>
          {options.map(opt => {
            const sel = arr.includes(opt);
            return (
              <div
                key={opt}
                style={{
                  padding: "11px 16px", fontSize: 13,
                  color: sel ? "#F0A202" : T.textSecondary,
                  background: sel ? "rgba(240,162,2,0.08)" : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 10, ...noEdit,
                }}
                onMouseDown={e => { e.preventDefault(); toggle(opt); }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: 4,
                  border: `1px solid ${sel ? "#F0A202" : T.textMuted}`,
                  background: sel ? "rgba(240,162,2,0.18)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {sel && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F0A202" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <span>{opt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pills de escolha única inline. Permite desmarcar clicando no selecionado se `allowDeselect=true`.
function PillChoice({ value, onChange, options, allowDeselect = true }) {
  const [hoverIdx, setHoverIdx] = useState(-1);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
      {options.map((opt, idx) => {
        const sel = value === opt;
        const hover = hoverIdx === idx && !sel;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(sel && allowDeselect ? "" : opt)}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(-1)}
            style={{
              padding: "10px 16px", borderRadius: 20, fontSize: 12.5,
              background: sel ? "rgba(240,162,2,0.16)" : hover ? "rgba(240,162,2,0.06)" : "rgba(255,255,255,0.03)",
              border: sel ? "0.5px solid rgba(240,162,2,0.55)" : hover ? "0.5px solid rgba(240,162,2,0.3)" : `0.5px solid ${T.border}`,
              color: sel ? "#F0A202" : hover ? "#F0EBD8" : T.textSecondary,
              fontFamily: "inherit", letterSpacing: "0.01em",
              transition: "all 0.16s", userSelect: "none", WebkitUserSelect: "none",
              cursor: "pointer",
              transform: hover ? "translateY(-1px)" : "none",
              boxShadow: sel ? "0 2px 8px rgba(240,162,2,0.12)" : "none",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}


// ── Veiculo picker (antes em ficha/VeiculoPicker.jsx) ──────────
// Picker premium: abre modal com fluxo marca → modelo para escolher veículo.
// Suporta "modelo custom" quando não está na lista.
// `value` = string "Marca Modelo" (legado) ou "" vazio.
// `onChange(full, { marca, modelo })` — chamado ao confirmar.
function VeiculoPicker({ value, onChange, placeholder = "Escolher marca e modelo" }) {
  const [open, setOpen] = useState(false);
  const [marcaSel, setMarcaSel] = useState(null);
  const [busca, setBusca] = useState("");
  const [modeloCustom, setModeloCustom] = useState("");

  useEffect(() => {
    if (!open) {
      setMarcaSel(null);
      setBusca("");
      setModeloCustom("");
    }
  }, [open]);

  const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const termo = norm(busca);
  const marcasFiltradas = termo
    ? MARCAS_VEICULOS_BR.filter(m => norm(m.marca).includes(termo))
    : MARCAS_VEICULOS_BR;
  const modelosFiltrados = marcaSel
    ? (termo
        ? marcaSel.modelos.filter(md => norm(md).includes(termo))
        : marcaSel.modelos)
    : [];

  function escolher(marca, modelo) {
    const full = `${marca} ${modelo}`.trim();
    onChange(full, { marca, modelo });
    setOpen(false);
  }

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        style={{
          ...C.input,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          ...noEdit,
        }}
      >
        <span style={{ color: value ? T.textPrimary : T.textMuted, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 700,
            background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: T.bgCard,
              border: `0.5px solid ${T.border}`,
              borderRadius: 18,
              width: 560,
              maxWidth: "100%",
              maxHeight: "88vh",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Header */}
            <div style={{ padding: "18px 22px 14px", borderBottom: `0.5px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              {marcaSel && (
                <button
                  onClick={() => { setMarcaSel(null); setBusca(""); }}
                  aria-label="Voltar para marcas"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `0.5px solid ${T.border}`,
                    borderRadius: 8,
                    width: 32, height: 32,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    color: T.textSecondary,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >←</button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: T.gold, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 3 }}>
                  {marcaSel ? "2 · Escolher modelo" : "1 · Escolher marca"}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: T.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {marcaSel ? marcaSel.marca : "Marcas vendidas no Brasil"}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `0.5px solid ${T.border}`,
                  borderRadius: 8,
                  width: 32, height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  color: T.textSecondary,
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >×</button>
            </div>

            {/* Search */}
            <div style={{ padding: "12px 18px 10px" }}>
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={marcaSel ? `Buscar modelo ${marcaSel.marca}...` : "Buscar marca..."}
                style={{ ...C.input, fontSize: 13 }}
              />
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px 16px" }}>
              {!marcaSel ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {marcasFiltradas.length === 0 && (
                    <div style={{ gridColumn: "1/-1", padding: "22px 14px", fontSize: 12, color: T.textMuted, textAlign: "center" }}>
                      Nenhuma marca encontrada.
                    </div>
                  )}
                  {marcasFiltradas.map(m => (
                    <button
                      key={m.marca}
                      onClick={() => { setMarcaSel(m); setBusca(""); }}
                      style={{
                        textAlign: "left",
                        padding: "12px 14px",
                        background: "rgba(255,255,255,0.03)",
                        border: `0.5px solid ${T.border}`,
                        borderRadius: 10,
                        cursor: "pointer",
                        color: T.textPrimary,
                        fontSize: 13,
                        fontFamily: "inherit",
                        fontWeight: 500,
                        transition: "all 0.15s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(240,162,2,0.08)";
                        e.currentTarget.style.borderColor = "rgba(240,162,2,0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.borderColor = T.border;
                      }}
                    >
                      <span>{m.marca}</span>
                      <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 400 }}>
                        {m.modelos.length}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {modelosFiltrados.length === 0 && (
                    <div style={{ padding: "22px 14px", fontSize: 12, color: T.textMuted, textAlign: "center" }}>
                      Nenhum modelo encontrado.
                    </div>
                  )}
                  {modelosFiltrados.map(md => (
                    <button
                      key={md}
                      onClick={() => escolher(marcaSel.marca, md)}
                      style={{
                        textAlign: "left",
                        padding: "11px 14px",
                        background: "rgba(255,255,255,0.02)",
                        border: `0.5px solid ${T.border}`,
                        borderRadius: 9,
                        cursor: "pointer",
                        color: T.textPrimary,
                        fontSize: 13,
                        fontFamily: "inherit",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(240,162,2,0.07)";
                        e.currentTarget.style.borderColor = "rgba(240,162,2,0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                        e.currentTarget.style.borderColor = T.border;
                      }}
                    >
                      {md}
                    </button>
                  ))}
                  {/* Permitir informar manualmente um modelo que não está na lista */}
                  <div style={{ marginTop: 10, padding: "12px 14px", background: "rgba(240,162,2,0.04)", border: "0.5px dashed rgba(240,162,2,0.3)", borderRadius: 9 }}>
                    <div style={{ fontSize: 10, color: "#F0A202", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                      Modelo não listado?
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={modeloCustom}
                        onChange={(e) => setModeloCustom(e.target.value)}
                        placeholder="Digite o modelo"
                        style={{ ...C.input, fontSize: 13, flex: 1 }}
                      />
                      <button
                        onClick={() => {
                          const v = modeloCustom.trim();
                          if (v) escolher(marcaSel.marca, v);
                        }}
                        disabled={!modeloCustom.trim()}
                        style={{
                          padding: "10px 16px",
                          background: modeloCustom.trim() ? "rgba(240,162,2,0.18)" : "rgba(255,255,255,0.03)",
                          border: modeloCustom.trim() ? "0.5px solid rgba(240,162,2,0.5)" : `0.5px solid ${T.border}`,
                          borderRadius: 9,
                          color: modeloCustom.trim() ? "#F0A202" : T.textMuted,
                          fontSize: 11,
                          cursor: modeloCustom.trim() ? "pointer" : "not-allowed",
                          fontFamily: "inherit",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >Usar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}




// Título de seção — numerado, alinhado à esquerda, visual limpo e premium.
function SectionTitle({children, subtitle, numero, total, icon}) {
  return (
    <div style={{marginTop:36,marginBottom:20,...noEdit}}>
      <div style={{height:"0.5px",background:"rgba(62,92,118,0.3)",marginBottom:24}}/>
      <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
        {numero && (
          <div style={{
            width:40, height:40, borderRadius:12,
            background:"linear-gradient(135deg,rgba(240,162,2,0.18),rgba(240,162,2,0.06))",
            border:"1px solid rgba(240,162,2,0.3)",
            display:"flex", alignItems:"center", justifyContent:"center",
            flexShrink:0, marginTop:2,
          }}>
            {icon
              ? <span style={{fontSize:18,lineHeight:1}}>{icon}</span>
              : <span style={{fontSize:15,fontWeight:700,color:"#F0A202",lineHeight:1}}>{numero}</span>
            }
          </div>
        )}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <h2 style={{fontSize:16,fontWeight:600,color:T.textPrimary,letterSpacing:"-0.01em",margin:0,lineHeight:1.3}}>{children}</h2>
            {total && (
              <span style={{fontSize:10,color:"#F0A202",fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",opacity:0.8}}>
                {numero}/{total}
              </span>
            )}
          </div>
          {subtitle && (
            <div style={{fontSize:12,color:T.textSecondary,lineHeight:1.6,marginTop:4}}>{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}


// SVG Donut Chart — anel fino, centro com duas linhas
// (Antigo DonutChart removido — agora usa DonutChartModern global em
// src/components/DonutChartModern.jsx, com hover 3D e animações.)

// Gráfico de barras verticais SVG (estilo Gráfico 3 das imagens)
function BarChartVertical({items}) {
  const active=items.filter(i=>i.v>0);
  if(!active.length) return null;
  const maxVal=Math.max(...active.map(i=>i.v));
  const rounded=Math.ceil(maxVal/100000)*100000||1;
  const H=100, barW=36, gap=56, leftPad=40, topPad=14, botPad=30;
  const totalW=leftPad+active.length*(barW+gap)-gap+16;
  const totalH=topPad+H+botPad;
  const ticks=[0,0.5,1].map(t=>rounded*t);
  function yPos(v){return topPad+H-Math.max((v/rounded)*H,0);}
  function lbl(v){
    if(v>=1000000) return `${(v/1000000).toFixed(v%1000000===0?0:1).replace(".",",")}Mi`;
    if(v>=1000) return `${Math.round(v/1000)}k`;
    return `${v}`;
  }
  function valLbl(v){
    if(v>=1000000) return `R$ ${(v/1000000).toFixed(2).replace(".",",")}Mi`;
    if(v>=1000) return `R$ ${Math.round(v/1000)}k`;
    return `R$ ${v}`;
  }
  return (
    <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",width:"100%"}}>
    <svg viewBox={`0 0 ${totalW} ${totalH}`} height={180} preserveAspectRatio="xMidYMid meet" style={{display:"block",maxWidth:"100%",overflow:"visible",...noEdit}}>
      {/* Grid + Y labels */}
      {ticks.map((t,i)=>(
        <g key={i}>
          <line x1={leftPad} y1={yPos(t)} x2={totalW-4} y2={yPos(t)} stroke="rgba(255,255,255,0.07)" strokeWidth={0.5}/>
          <text x={leftPad-6} y={yPos(t)+3.5} textAnchor="end" fontSize={10.5} fill={T.textMuted} fontFamily={T.fontFamily}>{lbl(t)}</text>
        </g>
      ))}
      {/* Bars */}
      {active.map((item,i)=>{
        const x=leftPad+i*(barW+gap);
        const bH=Math.max((item.v/rounded)*H,4);
        const y=yPos(item.v);
        return (
          <g key={item.label}>
            <rect x={x} y={y} width={barW} height={bH} fill={item.cor} rx={5} opacity={0.88}/>
            <text x={x+barW/2} y={y-6} textAnchor="middle" fontSize={10.5} fill={item.cor} fontFamily={T.fontFamily} fontWeight={600}>{valLbl(item.v)}</text>
            <text x={x+barW/2} y={topPad+H+18} textAnchor="middle" fontSize={10.5} fill={T.textMuted} fontFamily={T.fontFamily}>{item.label}</text>
          </g>
        );
      })}
      {/* Baseline */}
      <line x1={leftPad} y1={topPad+H} x2={totalW-4} y2={topPad+H} stroke="rgba(255,255,255,0.12)" strokeWidth={0.5}/>
    </svg>
    </div>
  );
}

// Legenda compacta reutilizável para ring charts
function LegendaRow({label, v, cor, total}) {
  const pct = total>0?((v/total)*100).toFixed(0):0;
  return (
    <div style={{marginBottom:8,...noEdit}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3,gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
          <div style={{width:8,height:8,borderRadius:2,background:cor,flexShrink:0}}/>
          <span style={{fontSize:11.5,color:"#b0bec5",lineHeight:1.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</span>
        </div>
        <span style={{fontSize:11.5,color:cor,fontWeight:600,flexShrink:0}}>{pct}%</span>
      </div>
      <div style={{height:2.5,background:"rgba(255,255,255,0.06)",borderRadius:1,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:cor,borderRadius:1}}/>
      </div>
      <div style={{fontSize:10.5,color:"#748CAB",marginTop:2}}>{moedaFull(v)}</div>
    </div>
  );
}

// Gráfico de anel premium — stroke-based, glow, futurista
function RingChart({data, total, size=180}) {
  if(!total||total<=0) return (
    <div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",...noEdit}}>
      <div style={{fontSize:11,color:T.textMuted}}>Sem dados</div>
    </div>
  );
  const cx=size/2, cy=size/2;
  const R=size*0.355;
  const SW=size*0.082;
  const C=2*Math.PI*R;
  const active=data.filter(d=>d.value>0);
  const gapDeg=active.length>1?3:0;
  let angle=-90;
  const segs=active.map(d=>{
    const pct=d.value/total;
    const sweep=pct*360;
    const dashLen=Math.max((sweep-gapDeg)/360*C,0.5);
    const rot=angle;
    angle+=sweep;
    return {...d,dashLen,rot,pct};
  });
  const circ=2*Math.PI*R;
  return(
    <svg width={size} height={size} style={noEdit}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW}/>
      {/* Segmentos sem glow */}
      {segs.map((s,i)=>(
        <circle
          key={i}
          cx={cx} cy={cy} r={R}
          fill="none"
          stroke={s.cor||s.color}
          strokeWidth={SW}
          strokeDasharray={`${s.dashLen} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(${s.rot},${cx},${cy})`}
          opacity={0.9}
        />
      ))}
      {/* Centro */}
      <text x={cx} y={cy-9} textAnchor="middle" fontSize={size*0.062} fill={T.textMuted} fontFamily={T.fontFamily} letterSpacing="0.08em">TOTAL</text>
      <text x={cx} y={cy+12} textAnchor="middle" fontSize={size*0.105} fill={T.textPrimary} fontFamily={T.fontFamily} fontWeight="200">{formatMi(total)}</text>
    </svg>
  );
}

// ── Rentabilidade da Carteira vs IPCA ──────────────────────────
// Gráfico de linha dupla (Carteira vs IPCA) com KPI lateral.
// `rentAnual` e `ipcaAnual` em pontos percentuais (ex: 9.5 = 9,5% a.a.).
// `patrimonio` em reais (base para computar o rendimento nominal).
// `meses` define a janela (default 12). Se rentAnual for null/undefined,
// renderiza um placeholder sóbrio — sem dados suficientes.
function calcRentabilidadeMeta({rentAnual, ipcaAnual=4.14, patrimonio=0, meses=12, metaExtra=6}) {
  const mesesLbl = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const hoje = new Date();
  const totalPts = meses + 1;
  const labels = Array.from({length: totalPts}, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - i), 1);
    return mesesLbl[d.getMonth()];
  });
  const taxaMensal = (anual) => Math.pow(1 + (anual||0)/100, 1/12) - 1;
  const rM = taxaMensal(rentAnual||0);
  const iM = taxaMensal(ipcaAnual||0);
  const metaAnual = (ipcaAnual||0) + metaExtra;
  const mM = taxaMensal(metaAnual);
  const serieCart = [0], serieIpca = [0], serieMeta = [0];
  for(let i=0;i<meses;i++){
    serieCart.push((Math.pow(1+rM, i+1) - 1) * 100);
    serieIpca.push((Math.pow(1+iM, i+1) - 1) * 100);
    serieMeta.push((Math.pow(1+mM, i+1) - 1) * 100);
  }
  const lastIdx = totalPts - 1;
  const rentPct = serieCart[lastIdx];
  const ipcaPct = serieIpca[lastIdx];
  const metaPct = serieMeta[lastIdx];
  return {
    labels, totalPts, lastIdx, metaAnual, metaExtra,
    serieCart, serieIpca, serieMeta,
    rentPct, ipcaPct, metaPct,
    deltaVsMeta: rentPct - metaPct,
    rendimento: patrimonio > 0 ? patrimonio * (rentPct/100) : 0,
    semDados: rentAnual==null || isNaN(rentAnual) || rentAnual===0,
  };
}

function RentabilidadeVsIPCA({rentAnual, ipcaAnual=4.14, meses=12, metaExtra=6}) {
  const semDados = rentAnual==null || isNaN(rentAnual) || rentAnual===0;

  const mesesLbl = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const hoje = new Date();

  // 13 pontos: base (Abr ano anterior = 0%) + 12 meses até Abr atual
  const totalPts = meses + 1;
  const labels = Array.from({length: totalPts}, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - i), 1);
    return mesesLbl[d.getMonth()];
  });

  const taxaMensal = (anual) => Math.pow(1 + (anual||0)/100, 1/12) - 1;
  const rM = taxaMensal(rentAnual||0);
  const iM = taxaMensal(ipcaAnual||0);
  const metaAnual = (ipcaAnual||0) + metaExtra;
  const mM = taxaMensal(metaAnual);

  const serieCart = [0];
  const serieIpca = [0];
  const serieMeta = [0];
  for(let i = 0; i < meses; i++){
    serieCart.push((Math.pow(1+rM, i+1) - 1) * 100);
    serieIpca.push((Math.pow(1+iM, i+1) - 1) * 100);
    serieMeta.push((Math.pow(1+mM, i+1) - 1) * 100);
  }

  const lastIdx     = totalPts - 1;
  const rentPct     = serieCart[lastIdx];
  const ipcaPct     = serieIpca[lastIdx];
  const metaPct     = serieMeta[lastIdx];
  const W = 540, H = 200, padL = 36, padR = 60, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const allVals = [...serieCart, ...serieIpca, ...serieMeta, 0];
  const maxY   = Math.max(...allVals);
  const minY   = Math.min(...allVals);
  const yRange = Math.max(maxY - minY, 0.01);
  const yTop   = maxY + yRange * 0.18;
  const yBot   = Math.min(minY, 0);

  const xFor = (i) => padL + (i / lastIdx) * innerW;
  const yFor = (v) => padT + innerH - ((v - yBot) / (yTop - yBot)) * innerH;

  const makePath = (arr) => arr.map((v,i) => `${i===0?"M":"L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`).join(" ");
  const pathCart = makePath(serieCart);
  const pathIpca = makePath(serieIpca);
  const pathMeta = makePath(serieMeta);

  const tickVals = Array.from({length:5}, (_,i) => yBot + ((yTop-yBot)*i)/4);
  const CORES = { cart:"#F0A202", ipca:"#60a5fa", meta:"#22c55e", pos:"#22c55e", neg:"#ef4444" };

  const xEnd = xFor(lastIdx);
  // Anti-overlap nos rótulos de ponta: ordena por y e garante gap mínimo
  const rotulos = [
    { key:"meta", y: yFor(metaPct), label: metaPct.toFixed(2).replace(".",",")+"%", fill: CORES.meta,  weight:600, opacity:1 },
    { key:"ipca", y: yFor(ipcaPct), label: ipcaPct.toFixed(2).replace(".",",")+"%", fill: CORES.ipca,  weight:400, opacity:0.8 },
    { key:"cart", y: yFor(rentPct), label: rentPct.toFixed(2).replace(".",",")+"%", fill: CORES.cart,  weight:600, opacity:1 },
  ].sort((a,b)=>a.y-b.y);
  const minGap = 12;
  for(let i=1;i<rotulos.length;i++){
    if(rotulos[i].y - rotulos[i-1].y < minGap){
      rotulos[i].y = rotulos[i-1].y + minGap;
    }
  }

  if(semDados){
    return (
      <div style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:14,padding:"28px 20px",textAlign:"center",...noEdit}}>
        <div style={{fontSize:11,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.12em",fontWeight:700,marginBottom:10}}>
          Rentabilidade vs Meta (IPCA + {metaExtra}% a.a.)
        </div>
        <div style={{fontSize:13,color:T.textSecondary,lineHeight:1.6,maxWidth:520,margin:"0 auto"}}>
          Informe a rentabilidade anual estimada da carteira no cadastro para exibir a comparação com a meta de IPCA + {metaExtra}% a.a.
        </div>
      </div>
    );
  }

  return (
    <div style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:14,padding:"18px 20px",height:"100%",boxSizing:"border-box",...noEdit}}>
      {/* Cabeçalho */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:12,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.12em",fontWeight:700,marginBottom:3}}>Rentabilidade da Carteira</div>
          <div style={{fontSize:12,color:T.textMuted}}>Últimos 12 meses · meta IPCA + {metaExtra}% a.a. ({metaAnual.toFixed(2).replace(".",",")}%)</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,fontSize:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:16,height:2,background:CORES.cart,borderRadius:2,display:"inline-block"}}/>
            <span style={{color:T.textSecondary}}>Carteira</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:16,height:2,background:CORES.meta,borderRadius:2,display:"inline-block"}}/>
            <span style={{color:T.textSecondary}}>Meta</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:14,height:1.5,background:CORES.ipca,borderRadius:2,display:"inline-block",opacity:0.6}}/>
            <span style={{color:T.textMuted,fontSize:11}}>IPCA</span>
          </div>
        </div>
      </div>

      {/* Gráfico SVG */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet" style={{display:"block",overflow:"visible",marginBottom:14}}>
        {tickVals.map((t,i)=>(
          <g key={i}>
            <line x1={padL} x2={W-padR} y1={yFor(t)} y2={yFor(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}/>
            <text x={padL-6} y={yFor(t)+3} textAnchor="end" fontSize={10} fill={T.textMuted} fontFamily={T.fontFamily}>{t.toFixed(1)}%</text>
          </g>
        ))}
        <path d={pathIpca} fill="none" stroke={CORES.ipca} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" opacity={0.55}/>
        <path d={pathMeta} fill="none" stroke={CORES.meta} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}/>
        <path
          d={`${pathCart} L ${xFor(lastIdx).toFixed(1)} ${yFor(yBot).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(yBot).toFixed(1)} Z`}
          fill={CORES.cart} opacity={0.08}
        />
        <path d={pathCart} fill="none" stroke={CORES.cart} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/>

        <circle cx={xEnd} cy={yFor(rentPct)} r={4}   fill={CORES.cart}/>
        <circle cx={xEnd} cy={yFor(rentPct)} r={8}   fill={CORES.cart} opacity={0.18}/>
        <circle cx={xEnd} cy={yFor(metaPct)} r={3.5} fill={CORES.meta} opacity={0.9}/>
        <circle cx={xEnd} cy={yFor(ipcaPct)} r={2.5} fill={CORES.ipca} opacity={0.6}/>

        {rotulos.map(r=>(
          <text key={r.key} x={xEnd+10} y={r.y+3.5} textAnchor="start" fontSize={10} fill={r.fill} opacity={r.opacity} fontWeight={r.weight} fontFamily={T.fontFamily}>{r.label}</text>
        ))}

        {labels.map((l,i)=>{
          const every = Math.max(1, Math.floor(lastIdx/4));
          if(i!==0 && i!==lastIdx && i%every!==0) return null;
          return (
            <text key={i} x={xFor(i)} y={H-8} textAnchor="middle" fontSize={10} fill={T.textMuted} fontFamily={T.fontFamily}>{l}</text>
          );
        })}
      </svg>

    </div>
  );
}

function RentabilidadeKPIs({rentAnual, ipcaAnual=4.14, patrimonio=0, meses=12, metaExtra=6}) {
  const m = calcRentabilidadeMeta({rentAnual, ipcaAnual, patrimonio, meses, metaExtra});
  if(m.semDados) return null;
  const CORES = { cart:"#F0A202", meta:"#22c55e", pos:"#22c55e", neg:"#ef4444" };
  const kpiBox = {
    background:"rgba(255,255,255,0.02)",
    border:`0.5px solid ${T.border}`,
    borderRadius:12,
    padding:"clamp(10px, 1.6vw, 14px) clamp(10px, 1.6vw, 16px)",
    boxSizing:"border-box",
    minWidth:0,
    overflow:"hidden",
  };
  const kpiLabel = {
    fontSize:"clamp(8.5px, 1.1vw, 10px)", color:"#748CAB", textTransform:"uppercase",
    letterSpacing:"0.06em", fontWeight:700, lineHeight:1.25, marginBottom:8,
  };
  const kpiValue = {
    fontSize:"clamp(12px, 1.9vw, 18px)", fontWeight:600, letterSpacing:"-0.01em",
    lineHeight:1.1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
  };
  return (
    <div className="cf-kpi-4col" style={{display:"grid",gap:"clamp(6px, 1vw, 10px)",marginBottom:14,...noEdit}}>
      <div style={kpiBox}>
        <div style={kpiLabel}>Rendimento R$ (12m)</div>
        <div style={{...kpiValue,color:CORES.pos}}>{m.rendimento>0 ? moedaFull(m.rendimento) : "—"}</div>
      </div>
      <div style={kpiBox}>
        <div style={kpiLabel}>Rentabilidade Carteira (12m)</div>
        <div style={{...kpiValue,color:CORES.cart}}>{m.rentPct.toFixed(2).replace(".",",")}%</div>
      </div>
      <div style={kpiBox}>
        <div style={kpiLabel}>Meta IPCA + {metaExtra}% a.a.</div>
        <div style={{...kpiValue,color:CORES.meta}}>{m.metaPct.toFixed(2).replace(".",",")}%</div>
      </div>
      <div style={kpiBox}>
        <div style={kpiLabel}>Comparação com a Meta (12m)</div>
        <div style={{...kpiValue,color:m.deltaVsMeta>=0?CORES.pos:CORES.neg}}>
          {m.deltaVsMeta>=0?"+":""}{m.deltaVsMeta.toFixed(2).replace(".",",")} p.p.
        </div>
      </div>
    </div>
  );
}

// Accordion Section — home do cliente. sectionId é usado como ancora (scroll-to-hash).
function AccordionSection({title,subtitle,icon,isOpen,onToggle,children,badge,badgeColor="#22c55e",sectionId}) {
  return (
    <div
      id={sectionId||undefined}
      className="cliente-accordion"
      style={{
        background:T.bgCard,
        border:`0.5px solid ${T.border}`,
        borderRadius:20,
        marginBottom:14,
        overflow:"hidden",
        boxShadow:"0 4px 20px -8px rgba(0,0,0,0.35)",
        scrollMarginTop:80,
      }}
    >
      <div
        className="ca-header"
        onClick={onToggle}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"22px 24px",cursor:"pointer",gap:14,...noEdit}}
        onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.015)";}}
        onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}
      >
        <div style={{display:"flex",alignItems:"center",gap:16,minWidth:0,flex:1}}>
          <div className="ca-icon" style={{width:46,height:46,borderRadius:12,background:"linear-gradient(135deg,rgba(240,162,2,0.14),rgba(240,162,2,0.04))",border:"0.5px solid rgba(240,162,2,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,boxShadow:"0 2px 10px -2px rgba(240,162,2,0.18)"}}>
            {icon}
          </div>
          <div className="ca-texts" style={{minWidth:0,flex:1}}>
            <div className="ca-title" style={{fontSize:17,fontWeight:500,color:T.textPrimary,lineHeight:1.25,letterSpacing:"-0.005em"}}>{title}</div>
            {subtitle&&<div className="ca-subtitle" style={{fontSize:13,color:T.textSecondary,marginTop:4,letterSpacing:"0.01em",lineHeight:1.4}}>{subtitle}</div>}
          </div>
          {badge&&<span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:`${badgeColor}18`,color:badgeColor,border:`0.5px solid ${badgeColor}40`,letterSpacing:"0.06em",fontWeight:600,whiteSpace:"nowrap",...noEdit}}>{badge}</span>}
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{transform:isOpen?"rotate(180deg)":"none",transition:"transform 0.3s",flexShrink:0}}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      {isOpen&&<div className="ca-body" style={{padding:"6px 24px 26px",borderTop:`0.5px solid ${T.border}`}}>{children}</div>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────
export default function ClienteFicha() {
  const {id} = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isCliente, isMaster, user: authUser, profile } = useAuth();
  const [modo,setModo] = useState(id==="novo"?"editar":"ver");

  // Cliente só pode ver a própria ficha — redireciona se URL for de outro id.
  useEffect(() => {
    if (isCliente && profile?.clienteId && id !== profile.clienteId) {
      navigate(`/cliente/${profile.clienteId}`, { replace: true });
    }
  }, [isCliente, profile?.clienteId, id, navigate]);

  // Lista de assessores — só o master usa pra escolher a quem vincular o cliente.
  const [assessores, setAssessores] = useState([]);
  const [advisorEscolhido, setAdvisorEscolhido] = useState("");
  // Quando o usuário vem do menu "Novo prospect" no dashboard, já chega
  // com ?prospect=1 — pré-seleciona o toggle.
  const [isProspect, setIsProspect] = useState(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get("prospect") === "1";
    } catch { return false; }
  });
  const [criandoLogin, setCriandoLogin] = useState(false);

  async function criarLoginAgora(){
    if(!id || id==="novo") return;
    if(!snap.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snap.email)){
      alert("Cliente precisa ter um email válido cadastrado. Edite a ficha, salve, e tente de novo.");
      return;
    }
    if(!confirm(`Criar login para ${snap.nome} com email ${snap.email}? Uma senha temporária será gerada (ele troca no 1º acesso).`)) return;
    setCriandoLogin(true);
    try{
      const { httpsCallable } = await import("firebase/functions");
      const { functions } = await import("../firebase");
      const callCriarLogin = httpsCallable(functions, "criarLoginParaCliente");
      const res = await callCriarLogin({ clienteId: id });
      const senhaGerada = res.data?.senha || res.data?.senhaInicial || '(ver admin)';
      // recarrega snap do doc atualizado
      const s = await getDoc(doc(db,"clientes",id));
      if(s.exists()){
        const data = s.data();
        formRef.current = { ...formRef.current, ...data };
        savedDataRef.current = { ...savedDataRef.current, ...data };
        setSnap(prev => ({ ...prev, ...data }));
      }
      setMsg(`✅ Login criado com sucesso. Email: ${snap.email} · senha temporária: ${senhaGerada}`);
    }catch(e){
      console.error("criarLoginParaCliente falhou:", e);
      setMsg(`⚠ Falha ao criar login: ${e.message || e.code}. Se o email estiver bloqueado, vá em /admin/usuarios e clique em "Liberar email".`);
    }finally{
      setCriandoLogin(false);
    }
  }

  useEffect(() => {
    if (!isMaster) return;
    (async () => {
      try {
        const { httpsCallable } = await import("firebase/functions");
        const { functions } = await import("../firebase");
        const res = await httpsCallable(functions, "listarUsuarios")();
        const arr = (res.data?.users || []).filter(u => u.role === "assessor" || u.role === "master");
        setAssessores(arr);
        // Default do select: cliente novo → master atual. Cliente existente só
        // é setado depois que o snap chega (abaixo, em outro effect).
        if (id === "novo" && authUser?.uid) setAdvisorEscolhido(authUser.uid);
      } catch (e) {
        console.warn("Falha ao listar assessores:", e.message);
      }
    })();
  }, [isMaster, id, authUser?.uid]);
  const isMobile = useIsMobile();
  const isWide = useIsWide(1100);

  // IPCA anual (% a.a.) — lê cache do localStorage populado pelo Dashboard.
  // Fallback para a média recente quando não há cache.
  const [ipcaAnual,setIpcaAnual] = useState(4.14);
  useEffect(()=>{
    try{
      const stored = localStorage.getItem("wealthtrack_cotacoes");
      if(stored){
        const data = JSON.parse(stored);
        const v = data?.ipca?.valor;
        if(typeof v==="number" && v>0 && v<50) setIpcaAnual(v);
      }
    }catch{/* cache inválido — mantém fallback */}
  },[]);

  // Faixa de cotações exibida no HUB PI do topo da ficha do cliente.
  // Lê o cache do Dashboard primeiro e, se vazio/antigo, dispara um fetch.
  const [mercado,setMercado] = useState(MERCADO_FALLBACK);
  const [statusMercado,setStatusMercado] = useState(()=>{ try{ return mercadoAberto(); }catch{ return false; } });
  const [ultimaAtualizacao,setUltimaAtualizacao] = useState(null);
  useEffect(()=>{
    let cancelado = false;
    const cache = lerCacheCotacoes();
    if (cache?.data) {
      setMercado(formatarCotacoesCliente(cache.data));
      if (cache.data._atualizadoEm) {
        const d = new Date(cache.data._atualizadoEm);
        if(!isNaN(d)) setUltimaAtualizacao(d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));
      }
    }
    try{ setStatusMercado(mercadoAberto()); }catch{/* ignora */}
    // Só dispara fetch em background se o cache estiver velho — evita 5 requests
    // externos em cada abertura da ficha.
    if (!cache || cache.stale) {
      (async ()=>{
        try{
          const c = await obterTodasAsCotacoes();
          if(cancelado || !c) return;
          setMercado(formatarCotacoesCliente(c));
          setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));
        }catch{/* offline — mantém cache */}
      })();
    }
    return ()=>{ cancelado = true; };
  },[]);

  const formRef = useRef({
    nome:"",codigo:"",email:"",cpf:"",telefone:"",uf:"",cidade:"",
    avatar:"homem",patrimonio:"",aporte:"",desde:"",
    nascimento:"",hobby:"",profissao:"",
    hobbies:[],
    estadoCivil:"",conjuge:"",temFilhos:"",filhos:[],
    temPet:"",pets:[],
    feeBased:false,modeloAtendimento:"",
    statusAporteMes:"",nextContactDate:"",notes:"",
    gastosMensaisManual:"",aporteRegistradoMes:"",
    salarioMensal:"",metaAporteMensal:"",aporteMedio:"",diaAporte:"",
    rentabilidadeAnual:"",focoInvestimento:"",
    liquidezDiaria:"",
    temSeguroVida:null,valorSeguroVida:"",
    temPlanoSucessorio:null,
    temPrevidencia:null,
    temPlanoSaude:null,valorPlanoSaude:"",
    proximaViagemPlanejada:"",
    imoveis:[],veiculos:[],veiculoValor:"",
    objetivosInteresse:[],
  });
  const savedDataRef = useRef({});

  const [snap,setSnap] = useState({...formRef.current});
  const [gastosSync,setGastosSync] = useState(0);
  const [ultimaRevisao,setUltimaRevisao] = useState(null);
  const [marcandoRevisao,setMarcandoRevisao] = useState(false);
  const [modalRevisao,setModalRevisao] = useState(false);
  const [modalExcluir,setModalExcluir] = useState(false);
  const [confirmExcluirInput,setConfirmExcluirInput] = useState("");
  const [excluindo,setExcluindo] = useState(false);
  const [dataRevisaoInput,setDataRevisaoInput] = useState("");
  const [salvando,setSalvando] = useState(false);
  const [msg,setMsg] = useState("");
  const [carregou,setCarregou] = useState(false);
  const carregouRef = useRef(false);
  useEffect(()=>{carregouRef.current=carregou;},[carregou]);
  // Refs pro refetch on focus (declarados antes dos useEffects que os usam)
  const carregarRef = useRef(null);
  const ultimoRefetchRef = useRef(0);
  const [erroCarregamento,setErroCarregamento] = useState(false);
  const [debugErro,setDebugErro] = useState(null); // mensagem de erro do getDoc pra diagnóstico
  const [carregouComDados,setCarregouComDados] = useState(false); // marca se renderizou com dados reais
  const [nomeError,setNomeError] = useState(false);
  const nomeFieldRef = useRef(null);

  const [modalAporte,setModalAporte] = useState(false);
  const [valorAporteInput,setValorAporteInput] = useState("");
  const [classeAporte,setClasseAporte] = useState("");
  const [ativoAporte,setAtivoAporte] = useState("");
  const [saldoAporte,setSaldoAporte] = useState("");
  const [dataAporteInput,setDataAporteInput] = useState(()=>new Date().toISOString().slice(0,10));
  const [modalNaoAportou,setModalNaoAportou] = useState(false);
  const [dataProximoContato,setDataProximoContato] = useState("");
  const [mesDetalhes,setMesDetalhes] = useState(null);

  const [sections,setSections] = useState({
    rendas:false, patrimonio:false, carteira:false, reserva:false, aportes:false, dados:false
  });
  function toggleSection(k){setSections(s=>({...s,[k]:!s[k]}));}
  function openAndScrollTo(k){
    setSections(s=>({...s,[k]:true}));
    setTimeout(()=>{
      const el=document.getElementById(`sec-${k}`);
      if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
    },60);
  }

  // Mapeia hash (#patrimonio, #carteira-home, #rendas, #aportes, #reserva, #dados)
  // → chave do accordion. Consumido pelo useEffect abaixo (busca da sidebar).
  const HASH_TO_SECTION = {
    "#patrimonio":"patrimonio",
    "#carteira-home":"carteira",
    "#rendas":"rendas",
    "#aportes":"aportes",
    "#reserva":"reserva",
    "#dados":"dados",
  };

  // Abre o accordion certo e rola até ele quando a URL muda (hash ou ?edit=1).
  // IDs dos elementos: "sec-patrimonio", "sec-carteira", etc. (vide AccordionSection).
  useEffect(()=>{
    if(id==="novo") return;
    const hash = location.hash || "";
    const search = new URLSearchParams(location.search||"");
    if(search.get("edit")==="1"){
      setModo("editar");
      navigate(`/cliente/${id}`,{replace:true});
      return;
    }
    const key = HASH_TO_SECTION[hash];
    if(!key) return;
    // Se estiver em modo editar, volta para ver antes de abrir o accordion.
    setModo("ver");
    setSections(s=>({...s,[key]:true}));
    // Aguarda render do conteúdo aberto antes de rolar.
    const t = setTimeout(()=>{
      const el = document.getElementById(`sec-${key}`);
      if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
    },220);
    return ()=>clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.hash,location.search,id]);

  useEffect(()=>{
    if(id==="novo"){setCarregou(true);return;}
    let cancelado = false;
    const cacheKey = `pi_cliente_${id}`;

    // Limpa qualquer flag de reload antigo de versão anterior (cleanup)
    try { sessionStorage.removeItem(`pi_reload_cliente_${id}`); } catch { /* segue */ }

    // Aplica os dados carregados (do cache OU do Firestore) no estado.
    function aplicarDados(data){
      const tiposExistentes = (data.objetivos||[]).map(o=>o.tipo).filter(Boolean);
      const interesses = data.objetivosInteresse||[];
      data.objetivosInteresse = [...new Set([...interesses, ...tiposExistentes])];

      formRef.current={...data};
      savedDataRef.current={...data};
      setSnap({...data});
      setIsProspect(!!data.isProspect);
      if(data.advisorId || data.assessorId){
        setAdvisorEscolhido(data.advisorId || data.assessorId);
      }
      setUltimaRevisao(data.lastReviewDate||data.ultimaRevisao||null);
      if(data.fluxo){
        const cats=["moradia","alimentacao","educacao","cartoes","carro","saude","lazer","assinaturas","seguros","outros"];
        const total=cats.reduce((acc,k)=>acc+(parseCentavos(data.fluxo[k])/100),0);
        setGastosSync(total);
      }
      setCarregou(true);
      // Marca que tem dados REAIS (nome existente é prova de doc do Firestore)
      if(data.nome) setCarregouComDados(true);
      // Limpa debug se chegou dado real
      setDebugErro(null);
    }

    // 1) Hidratação INSTANTÂNEA do cache localStorage (renderiza < 50ms se cache existe)
    try {
      const raw = localStorage.getItem(cacheKey);
      if(raw){
        const cached = JSON.parse(raw);
        if(cached?.data) aplicarDados(cached.data);
      }
    } catch { /* cache corrompido, ignora */ }

    // 2) Fetch do Firestore — getDoc one-shot. NÃO usa onSnapshot pra evitar
    //    sobrescrever edições em andamento quando o doc muda em outra tela.
    //    Refetch automático no focus/visibility (só quando NÃO está editando)
    //    pra propagar mudanças feitas em outras telas (ex: liquidez salva na
    //    Carteira → reflete em HomeLiberdade/JornadaTimeline ao voltar).
    async function carregar(){
      try {
        const s = await getDoc(doc(db,"clientes",id));
        if(cancelado) return;
        if(!s.exists()){
          if(!carregouRef.current) setCarregou(true);
          return;
        }
        const data={
          avatar:"homem",feeBased:false,modeloAtendimento:"",statusAporteMes:"",nextContactDate:"",notes:"",
          gastosMensaisManual:"",aporteRegistradoMes:"",
          salarioMensal:"",metaAporteMensal:"",aporteMedio:"",diaAporte:"",
          cidade:"",hobbies:[],estadoCivil:"",conjuge:"",temFilhos:"",filhos:[],temPet:"",pets:[],
          rentabilidadeAnual:"",focoInvestimento:"",
          imoveis:[],veiculos:[],veiculoValor:"",
          objetivosInteresse:[],
          ...s.data()
        };
        aplicarDados(data);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({data, ts: Date.now()}));
        } catch { /* localStorage cheio, segue */ }
      } catch(err) {
        console.error("[ClienteFicha] erro ao carregar cliente:", err);
        const errMsg = err?.code
          ? `${err.code}: ${err.message || ""}`
          : (err?.message || String(err));
        if(!cancelado){
          setDebugErro(errMsg);
          if(!carregouRef.current) setCarregou(true);
        }
      }
    }
    carregarRef.current = carregar;
    carregar();

    return ()=>{
      cancelado = true;
    };
  },[id]);

  // Refetch on focus / visibility — propaga mudanças feitas em outras telas.
  // Só roda quando NÃO está editando, pra não sobrescrever dados que o usuário
  // está digitando. Throttle de 2s pra não martelar Firestore se a aba alterna rápido.
  useEffect(()=>{
    if(id==="novo") return;
    function tentarRefetch(){
      if(modo!=="ver") return; // não sobrescreve edição em andamento
      const agora = Date.now();
      if(agora - ultimoRefetchRef.current < 2000) return;
      ultimoRefetchRef.current = agora;
      if(carregarRef.current) carregarRef.current();
    }
    const onFocus = () => tentarRefetch();
    const onVisibility = () => { if(!document.hidden) tentarRefetch(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return ()=>{
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  },[id, modo]);

  const setF = useCallback((k,v)=>{formRef.current={...formRef.current,[k]:v};},[]);
  const setFSnap = useCallback((k,v)=>{formRef.current={...formRef.current,[k]:v};setSnap(prev=>({...prev,[k]:v}));},[]);

  // Propaga gastosSync para gastosMensaisManual quando o usuário ainda não editou
  // manualmente. IMPORTANTE: fica abaixo da declaração de setFSnap para evitar
  // Temporal Dead Zone (TDZ) em StrictMode.
  useEffect(()=>{
    if(!snap.gastosMensaisManual&&gastosSync>0){
      const c=Math.round(gastosSync*100);
      setFSnap("gastosMensaisManual",String(c));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[gastosSync]);

  // ── Calculations ──────────────────────────────────────────────
  const hoje = new Date();
  const gastosMensaisEfetivo = (parseCentavos(snap.gastosMensaisManual)/100)||gastosSync;
  const aporteRegistradoVal = parseCentavos(snap.aporteRegistradoMes)/100;
  const rendaMensal = parseCentavos(snap.salarioMensal)/100||parseCentavos(snap.fluxo?.renda)/100||0;

  // Totais de patrimônio memoizados — só recalculam quando carteira/imóveis/veículos mudarem.
  // Antes eram calculados a cada render, o que disparava reduce/find em múltiplos arrays
  // sempre que qualquer campo do form alterasse (prejudicava muito o primeiro paint).
  const totalCarteira = useMemo(() => {
    const carteira = snap.carteira || {};
    return CLASSES_CARTEIRA.reduce((acc, c) => {
      const ativosKey = c.key + "Ativos";
      if (Array.isArray(carteira[ativosKey])) {
        return acc + carteira[ativosKey].reduce((a, x) => a + parseCentavos(x.valor)/100, 0);
      }
      return acc + parseCentavos(carteira[c.key])/100;
    }, 0);
  }, [snap.carteira]);

  const totalImoveis = useMemo(() => (
    (snap.imoveis||[]).reduce((acc, im) => {
      const f = FAIXAS_IMOVEL.find(x => x.label === im.faixa);
      const qtd = Math.max(parseInt(im.quantidade)||1, 1);
      return acc + (f ? f.mid*qtd : 0);
    }, 0)
  ), [snap.imoveis]);

  const totalVeiculosArray = useMemo(() => (
    (snap.veiculos||[]).reduce((acc, v) => {
      const f = FAIXAS_VEICULO.find(x => x.label === v.faixa);
      const qtd = Math.max(parseInt(v.quantidade)||1, 1);
      return acc + (f ? f.mid*qtd : 0);
    }, 0)
  ), [snap.veiculos]);

  const totalVeiculosLegacy = parseCentavos(snap.veiculoValor)/100;
  const totalVeiculos = totalVeiculosArray>0 ? totalVeiculosArray : totalVeiculosLegacy;

  // Total patrimônio
  const patrimonioCalculado = totalCarteira+totalImoveis+totalVeiculos;
  const patrimonioManual = parseCentavos(snap.patrimonio)/100;
  const patrimonioDisplay = patrimonioCalculado>0 ? patrimonioCalculado : patrimonioManual;
  const patrimonioFinanceiro = totalCarteira>0 ? totalCarteira : patrimonioManual;
  const segmento = segmentoAuto(String(Math.round(patrimonioFinanceiro*100)));

  // Emergency reserve
  const reservaMeta = gastosMensaisEfetivo*6;

  // Alerts
  const alertaContato = snap.nextContactDate&&contatoVencido(snap.nextContactDate);
  const alertaViradaMes = hoje.getDate()===1&&id!=="novo";
  const dataRevisao = formatarData(ultimaRevisao);
  // Datas de revisão memoizadas — só mudam quando a revisão muda de fato.
  const { revDate, hojeDia, revisaoAgendada, revisaoFeitaMes } = useMemo(() => {
    let rd = null;
    if (ultimaRevisao) {
      try {
        const r = ultimaRevisao.toDate ? ultimaRevisao.toDate() : new Date(ultimaRevisao);
        if (!isNaN(r)) { rd = new Date(r); rd.setHours(0,0,0,0); }
      } catch { rd = null; }
    }
    const hd = new Date(); hd.setHours(0,0,0,0);
    const agendada = !!rd && rd.getTime() > hd.getTime();
    let feita = false;
    if (rd && rd.getTime() <= hd.getTime()) {
      feita = rd.getMonth() === hd.getMonth() && rd.getFullYear() === hd.getFullYear();
    }
    return { revDate: rd, hojeDia: hd, revisaoAgendada: agendada, revisaoFeitaMes: feita };
  }, [ultimaRevisao]);
  function revisaoPendente(){
    if(!revDate) return true;
    if(revisaoAgendada) return false;
    if(revDate.getMonth()===hojeDia.getMonth()&&revDate.getFullYear()===hojeDia.getFullYear()) return false;
    return hojeDia.getDate()>15;
  }
  const pendente = id!=="novo"&&revisaoPendente();

  // Se a carteira tem ativos individuais, soma só os marcados com objetivo "Liquidez".
  // Sem ativos → cai no campo legado (liquidezD1/posFixado).
  // Memoizado: evita 2 níveis de reduce a cada render (disparava em cada keystroke).
  const liquidezReserva = useMemo(()=>{
    const carteira = snap.carteira || {};
    const engaged = CLASSES_CARTEIRA.some(c=>Array.isArray(carteira[c.key+"Ativos"]));
    if(engaged){
      return CLASSES_CARTEIRA.reduce((acc,c)=>{
        const ativos = carteira[c.key+"Ativos"];
        if(Array.isArray(ativos)){
          return acc+ativos.reduce((a,at)=>a+((at.objetivo||"")==="Liquidez"?parseCentavos(at.valor)/100:0),0);
        }
        return acc;
      },0);
    }
    return parseCentavos(carteira.liquidezD1)/100||parseCentavos(carteira.posFixado)/100;
  },[snap.carteira]);
  const reservaStatus = reservaMeta>0&&liquidezReserva>=reservaMeta
    ? {label:"✓ Reserva OK",cor:"#22c55e",bg:"rgba(34,197,94,0.1)",border:"0.5px solid rgba(34,197,94,0.3)",labelCor:"#86efac"}
    : reservaMeta>0&&liquidezReserva>=reservaMeta*0.6
    ? {label:"⚡ Em construção",cor:"#f59e0b",bg:"rgba(245,158,11,0.1)",border:"0.5px solid rgba(245,158,11,0.3)",labelCor:"#fcd34d"}
    : reservaMeta>0&&liquidezReserva>0
    ? {label:"⚠ Fortalecer",cor:"#ef4444",bg:"rgba(239,68,68,0.1)",border:"0.5px solid rgba(239,68,68,0.3)",labelCor:"#fca5a5"}
    : {label:"— Sem dados",cor:"#a855f7",bg:"rgba(168,85,247,0.07)",border:"0.5px solid rgba(168,85,247,0.2)",labelCor:"#c4b5fd"};

  const idade = calcularIdade(snap.nascimento);

  // ── Handlers ─────────────────────────────────────────────────
  function handleAportou(){setFSnap("statusAporteMes","aportou");setModalAporte(true);}

  async function confirmarAporte(){
    const reais=parseInt(valorAporteInput.replace(/\D/g,""))||0;
    const centavos=reais*100;
    if(centavos===0){setMsg("Informe um valor válido.");return;}

    // Data: usa o input (ISO aaaa-mm-dd) — se estiver vazio, hoje.
    const dISO=dataAporteInput||new Date().toISOString().slice(0,10);
    const [ay,am,ad]=dISO.split("-").map(Number);
    const dataAporte=new Date(ay,(am||1)-1,ad||1);
    const mesAtual=dataAporte.getMonth()+1;
    const anoAtual=dataAporte.getFullYear();

    const novoRegistroMes=parseCentavos(snap.aporteRegistradoMes)+centavos;
    setFSnap("aporteRegistradoMes",String(novoRegistroMes));
    const novoAporte=parseCentavos(snap.aporte)+centavos;
    setFSnap("aporte",String(novoAporte));

    const classeObj=CLASSES_CARTEIRA.find(c=>c.key===classeAporte);
    const saldoCentavos=(parseInt((saldoAporte||"").replace(/\D/g,""))||0)*100;

    // Histórico consolidado por mês (usado no mapa de aportes)
    const hist=[...(snap.carteiraHistorico||[])];
    const idx=hist.findIndex(m=>m.mes===mesAtual&&m.ano===anoAtual);
    const mov={mes:mesAtual,ano:anoAtual,tipo:"aporte",valor:String(novoRegistroMes),data:dataAporte.toLocaleDateString("pt-BR")};
    if(idx>=0)hist[idx]=mov; else hist.push(mov);
    setFSnap("carteiraHistorico",hist);

    // Histórico detalhado (Extrato): lista imutável de lançamentos
    const aportes=[...(snap.aportes||[])];
    aportes.push({
      valor:String(centavos),
      data:dataAporte.toISOString(),
      classe:classeAporte||"",
      classeLabel:classeObj?.label||"",
      classeCor:classeObj?.cor||"",
      ativo:(ativoAporte||"").trim(),
      saldoRemanescente:saldoCentavos>0?String(saldoCentavos):"",
      descricao:(ativoAporte||"").trim()
        ? `Aporte · ${classeObj?.label||"Carteira"} → ${ativoAporte.trim()}`
        : `Aporte · ${classeObj?.label||"Carteira"}`,
      origem:"Registrado no painel",
    });
    setFSnap("aportes",aportes);
    setFSnap("lastAporteDate",dataAporte.toISOString());

    try{
      // Patch incremental — preserva userId/advisorId e demais campos não tocados
      await setDoc(doc(db,"clientes",id), stripUndefined({
        aporteRegistradoMes:String(novoRegistroMes),
        aporte:String(novoAporte),
        carteiraHistorico:hist,
        aportes,
        lastAporteDate:dataAporte.toISOString(),
      }), { merge: true });
      setMsg("Aporte registrado com sucesso.");
    }catch(e){
      console.error("[ClienteFicha] Erro ao registrar aporte:", e?.code, e?.message);
      setMsg(e?.code === "permission-denied"
        ? "Sem permissão para salvar. Faça logout e entre novamente."
        : "Erro: " + (e?.message || "erro desconhecido"));
    }
    setModalAporte(false);
    setValorAporteInput("");setClasseAporte("");setAtivoAporte("");setSaldoAporte("");
    setDataAporteInput(new Date().toISOString().slice(0,10));
  }

  function handleNaoAportou(){setFSnap("statusAporteMes","nao_aportou");setDataProximoContato(proximoDia1());setModalNaoAportou(true);}
  function confirmarNaoAportou(){setFSnap("nextContactDate",dataProximoContato);setModalNaoAportou(false);setDataProximoContato("");}

  function adicionarFilho(){const n=[...(snap.filhos||[]),{nome:"",idade:""}];setFSnap("filhos",n);}
  function removerFilho(i){const n=(snap.filhos||[]).filter((_,idx)=>idx!==i);setFSnap("filhos",n);}
  function atualizarFilho(i,campo,valor){const n=(snap.filhos||[]).map((f,idx)=>idx===i?{...f,[campo]:valor}:f);setFSnap("filhos",n);}

  function adicionarPet(){const n=[...(snap.pets||[]),{nome:"",tipo:""}];setFSnap("pets",n);}
  function removerPet(i){const n=(snap.pets||[]).filter((_,idx)=>idx!==i);setFSnap("pets",n);}
  function atualizarPet(i,campo,valor){const n=(snap.pets||[]).map((p,idx)=>idx===i?{...p,[campo]:valor}:p);setFSnap("pets",n);}

  function toggleObjetivoInteresse(id){
    const arr = snap.objetivosInteresse||[];
    const objs = snap.objetivos||[];
    const objDef = OBJETIVOS_CADASTRO.find(o=>o.id===id);
    if(arr.includes(id)){
      setFSnap("objetivosInteresse", arr.filter(x=>x!==id));
      // Remove placeholder se ainda não foi preenchido
      setFSnap("objetivos", objs.filter(o=>!(o.tipo===id && o.rascunho)));
    } else {
      setFSnap("objetivosInteresse", [...arr, id]);
      // Cria placeholder se ainda não existe objetivo deste tipo
      if(!objs.some(o=>o.tipo===id) && objDef){
        setFSnap("objetivos", [...objs, {
          tipo: id, label: objDef.label,
          meta:"0", aporte:"0", prazo:10,
          patrimAtual:"0", ativosVinculados:[],
          rascunho: true,
        }]);
      }
    }
  }

  function adicionarImovel(){const n=[...(snap.imoveis||[]),{tipo:"Casa",nome:"",quantidade:1,faixa:"R$ 500.000,00"}];setFSnap("imoveis",n);}
  function removerImovel(i){const n=(snap.imoveis||[]).filter((_,idx)=>idx!==i);setFSnap("imoveis",n);}
  function atualizarImovel(i,campo,valor){const n=(snap.imoveis||[]).map((im,idx)=>idx===i?{...im,[campo]:valor}:im);setFSnap("imoveis",n);}

  function adicionarVeiculo(){const n=[...(snap.veiculos||[]),{tipo:"Carro",modelo:"",quantidade:1,faixa:"R$ 50.000,00",temSeguro:null,valorSeguro:""}];setFSnap("veiculos",n);}
  function removerVeiculo(i){const n=(snap.veiculos||[]).filter((_,idx)=>idx!==i);setFSnap("veiculos",n);}
  function atualizarVeiculo(i,campo,valor){const n=(snap.veiculos||[]).map((v,idx)=>idx===i?{...v,[campo]:valor}:v);setFSnap("veiculos",n);}

  async function salvar(){
    if(!formRef.current.nome||!formRef.current.nome.trim()){
      setNomeError(true);
      setMsg("⚠ Preencha o nome do cliente para continuar.");
      if(nomeFieldRef.current){
        nomeFieldRef.current.scrollIntoView({behavior:"smooth",block:"center"});
        setTimeout(()=>{
          const el = nomeFieldRef.current?.querySelector("input");
          if(el) el.focus();
        },500);
      }
      return;
    }
    setNomeError(false);
    setSalvando(true);
    try{
      // Patrimônio = SOMENTE financeiro. NÃO inclui imóveis/veículos (são patrimônio total, não financeiro).
      // Se a carteira tem ativos, sincroniza com a soma dela. Senão preserva o que o usuário digitou.
      const patFinal = totalCarteira>0 ? String(Math.round(totalCarteira*100)) : formRef.current.patrimonio;
      const seg=segmentoAuto(patFinal);
      const cpfNorm = String(formRef.current.cpf||"").replace(/\D/g,"");
      if(cpfNorm && cpfNorm.length!==11){
        setMsg("CPF deve ter 11 dígitos.");
        setSalvando(false);
        return;
      }
      const emailNorm = String(formRef.current.email||"").trim().toLowerCase();
      // Bloqueia duplicata (email/CPF) antes de salvar. Cloud Function usa admin
      // SDK, então roda mesmo para assessor cadastrando um cliente existente.
      if(emailNorm || cpfNorm){
        try{
          const { httpsCallable } = await import("firebase/functions");
          const { functions } = await import("../firebase");
          const callVerif = httpsCallable(functions, "verificarDuplicataCliente");
          const resV = await callVerif({
            email: emailNorm,
            cpf: cpfNorm,
            excluirId: id==="novo" ? null : id,
          });
          if(resV.data?.duplicado){
            const nomeExistente = resV.data.nomeExistente || "cliente";
            const campo = resV.data.campo || "dados";
            setMsg(`⚠ Este cliente já tem uma conta cadastrada (mesmo ${campo}: ${nomeExistente}). Fale com o administrador do site.`);
            setSalvando(false);
            return;
          }
        }catch(e){
          console.warn("verificarDuplicataCliente falhou — seguindo só com checagem server-side:", e.message || e.code);
        }
      }
      const data={...formRef.current,segmento:seg||"",patrimonio:patFinal,cpfNorm:cpfNorm||null};

      // Auto-cria stubs em data.objetivos para cada tipo selecionado em
      // objetivosInteresse que ainda não tem entrada correspondente.
      // Garante que checkboxes do cadastro (Liquidez, Aposentadoria, etc.)
      // apareçam na página /objetivos sem precisar criar manualmente.
      const interessesArr = Array.isArray(data.objetivosInteresse) ? data.objetivosInteresse : [];
      const objetivosBase = Array.isArray(data.objetivos) ? data.objetivos : [];
      const tiposExistentes = new Set(objetivosBase.map(o => o.tipo).filter(Boolean));
      const stubsNovos = [];
      for (const tipo of interessesArr) {
        if (tiposExistentes.has(tipo)) continue;
        const label = TIPO_OBJETIVO_PARA_LABEL[tipo];
        if (!label) continue;
        const stub = criarObjetivoStub(label);
        if (stub) stubsNovos.push(stub);
      }
      if (stubsNovos.length > 0) {
        data.objetivos = [...objetivosBase, ...stubsNovos];
      }

      if(id==="novo"){
        // Master pode vincular a qualquer assessor; assessor vincula a si mesmo.
        const advisorAlvo = isMaster && advisorEscolhido ? advisorEscolhido : (authUser?.uid || null);
        const dataComFlags = { ...data, isProspect: !!isProspect };
        const temEmail = !isProspect && !!(data.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email));
        if(temEmail){
          try{
            const { httpsCallable } = await import("firebase/functions");
            const { functions } = await import("../firebase");
            const callCriar = httpsCallable(functions, "criarCliente");
            const res = await callCriar({
              nome: data.nome,
              email: data.email,
              advisorId: advisorAlvo,
              dadosCliente: dataComFlags,
            });
            const newId = res.data?.clienteId;
            setMsg("Cliente salvo com login. Abrindo diagnóstico...");
            setTimeout(()=>navigate(`/cliente/${newId}/diagnostico`),900);
          }catch(e){
            console.error("criarCliente (Cloud Function) falhou:", e);
            // Já-existe: não cai no fallback de addDoc (evita criar terceiro doc duplicado).
            if(e.code === "functions/already-exists" || /already-exists/i.test(e.message||"")){
              setMsg(`⚠ ${e.message || "Este cliente já tem uma conta cadastrada."} Fale com o administrador do site.`);
              setSalvando(false);
              return;
            }
            await addDoc(collection(db,"clientes"),{
              ...dataComFlags,
              advisorId: advisorAlvo,
              assessorId: advisorAlvo,
            });
            setMsg(`⚠ Erro ao criar o login do cliente: ${e.message || e.code || "erro desconhecido"}. O cadastro foi salvo, mas o cliente NÃO aparecerá na lista de usuários até você recriar o login. Verifique se o email já não está em uso.`);
            setSalvando(false);
            return;
          }
        }else{
          const ref=await addDoc(collection(db,"clientes"),{
            ...dataComFlags,
            advisorId: advisorAlvo,
            assessorId: advisorAlvo,
          });
          setMsg(isProspect ? "Prospect salvo. Abrindo diagnóstico..." : "Cliente salvo. Abrindo diagnóstico...");
          setTimeout(()=>navigate(`/cliente/${ref.id}/diagnostico`),900);
        }
      }else{
        const dataUpdate = { ...data, isProspect: !!isProspect };
        // Master pode reatribuir o cliente a outro assessor na edição.
        // Assessor comum não pode mudar advisorId (rules impedem).
        if(isMaster && advisorEscolhido){
          dataUpdate.advisorId = advisorEscolhido;
          dataUpdate.assessorId = advisorEscolhido;
        }
        // merge:true + stripUndefined: preserva userId e demais top-level
        // não tocados, e evita rejeição do Firestore por campo undefined.
        const payload = stripUndefined(dataUpdate);
        const ref = doc(db,"clientes",id);
        try{
          await setDoc(ref, payload, { merge: true });
        }catch(eFirst){
          // Retry uma vez se for permission-denied — pode ser claim defasado
          // (usuário promovido/rebaixado e token ainda tem role antiga). Força
          // refresh do ID token e tenta de novo. Resolve o sintoma "funciona
          // pra alguns, falha pra outros" pós-mudança de role sem re-login.
          if(eFirst?.code === "permission-denied" && auth.currentUser){
            try { await auth.currentUser.getIdToken(true); } catch { /* segue */ }
            await setDoc(ref, payload, { merge: true });
          } else {
            throw eFirst;
          }
        }
        savedDataRef.current={...dataUpdate};
        setSnap({...dataUpdate});
        setMsg("Dados atualizados.");
        setModo("ver");
        // Avisa Diagnóstico/Carteira/Dashboard pra refazer fetch sem precisar
        // trocar de aba ou rota. Sem isso o usuário editava perfil, voltava
        // pro diagnóstico/dash e via dados velhos do estado em memória.
        try {
          window.dispatchEvent(new CustomEvent("wealthtrack:cliente-atualizado", { detail: { id } }));
        } catch { /* noop */ }
        // Redirect: admin/assessor edita pra voltar pro fluxo de onde veio
        // (Dashboard, lista, etc). Cliente fica na própria ficha em "ver".
        // Bug histórico: o path "novo" tinha navigate() mas o de edição não,
        // então admin "salvava e nada acontecia". `navigate(-1)` cobre os dois
        // casos comuns (veio do Dashboard ou de outra rota interna).
        if(!isCliente){
          setTimeout(()=>{
            try { navigate(-1); } catch { /* noop */ }
          }, 600);
        }
      }
    }catch(e){
      console.error("[ClienteFicha] Erro ao salvar:", e?.code, e?.message);
      setMsg(e?.code === "permission-denied"
        ? "Sem permissão para salvar. Sua sessão pode ter expirado — faça logout e entre novamente."
        : "Erro: " + (e?.message || "erro desconhecido"));
    }
    setSalvando(false);
  }

  async function excluirCliente(){
    if(!id||id==="novo") return;
    const nomeAtual=(snap.nome||"").trim();
    if(!nomeAtual) {setMsg("Erro: cliente sem nome identificável.");return;}
    if(confirmExcluirInput.trim().toLowerCase()!==nomeAtual.toLowerCase()){
      setMsg("O nome digitado não confere. Exclusão cancelada.");
      return;
    }
    setExcluindo(true);
    try{
      try {
        const { httpsCallable } = await import("firebase/functions");
        const { functions } = await import("../firebase");
        const callExcluir = httpsCallable(functions, "excluirCliente");
        await callExcluir({ clienteId: id });
      } catch(e) {
        console.warn("Cloud Function excluirCliente falhou, fallback para deleteDoc:", e);
        await deleteDoc(doc(db,"clientes",id));
      }
      setMsg("Cliente excluído (login liberado).");
      setModalExcluir(false);
      setTimeout(()=>navigate("/dashboard"),600);
    }catch(e){setMsg("Erro ao excluir: "+e.message);setExcluindo(false);}
  }

  function cancelarEdicao(){
    formRef.current={...savedDataRef.current};
    setSnap({...savedDataRef.current});
    setModo("ver");
  }

  async function marcarRevisao(dateStr){
    setMarcandoRevisao(true);
    try{
      let reviewDate;
      let reviewDateForState;
      if(dateStr){
        const [d,m,y]=dateStr.split("/");
        const dt=new Date(parseInt(y),parseInt(m)-1,parseInt(d));
        if(!isNaN(dt)){reviewDate=dt;reviewDateForState={toDate:()=>dt};}
      }
      if(!reviewDate){reviewDate=new Date();reviewDateForState={toDate:()=>new Date()};}
      // merge:true — não precisa ler antes, só escreve o campo afetado
      await setDoc(doc(db,"clientes",id),{lastReviewDate:reviewDate},{merge:true});
      setUltimaRevisao(reviewDateForState);
      setMsg("Revisão marcada.");
    }catch{setMsg("Erro ao marcar revisão.");}
    setMarcandoRevisao(false);
  }

  if(!carregou) return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:T.fontFamily}}>
      <div style={{fontSize:13,color:T.textMuted}}>Carregando...</div>
    </div>
  );

  // Banner de debug visível: aparece SÓ se houve erro no getDoc
  // E ainda não temos dados reais (nome). Mostra mensagem técnica
  // pra o Will conseguir diagnosticar exatamente o que falhou.
  const debugBanner = (debugErro && !carregouComDados) ? (
    <div style={{
      position:"fixed",top:0,left:0,right:0,zIndex:9999,
      background:"#7a1a1a",color:"#fff",fontSize:12,fontFamily:"monospace",
      padding:"10px 14px",borderBottom:"1px solid #ff4444",
      lineHeight:1.5,wordBreak:"break-all",
    }}>
      ⚠️ DEBUG ClienteFicha: {debugErro}
      <button
        onClick={()=>setDebugErro(null)}
        style={{marginLeft:12,background:"transparent",border:"1px solid rgba(255,255,255,0.4)",color:"#fff",padding:"3px 10px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:11}}
      >fechar</button>
    </div>
  ) : null;

  // ── Label helper ───────────────────────────────────────────────
  const Lbl=({children})=><label style={{...C.label,...noEdit}}>{children}</label>;
  const ValorTexto=({valor,cor})=>(
    <div style={{fontSize:14,color:cor||T.textSecondary,padding:"9px 0",borderBottom:`0.5px solid ${T.border}`,...noEdit}}>{valor||"—"}</div>
  );

  // ── MAIN RENDER ───────────────────────────────────────────────
  return (
    <>
    {debugBanner}
    <div className="dashboard-container has-sidebar" style={{minHeight:"100vh",background:T.bg,fontFamily:T.fontFamily}}>
      {/* Sidebar contextual do cliente */}
      {id !== "novo" && (
        <Sidebar mode="cliente" clienteId={id} clienteNome={snap?.nome || ""} />
      )}
      <Navbar
        showLogout={true}
        notificationsBell={isCliente && id !== "novo" ? (
          <SilentBoundary>
            <NotificacoesBell cliente={snap} clienteId={id} />
          </SilentBoundary>
        ) : null}
        actionButtons={[
          // "Voltar" só faz sentido para admin/assessor. Cliente real não sai
          // do próprio painel.
          ...(!isCliente ? [{
            icon:"←",
            label:"Voltar",
            variant:"secondary",
            onClick:()=>navigate("/dashboard"),
            title:"Voltar ao dashboard"
          }] : []),
          // Edição dos dados cadastrais é do assessor. Cliente enxerga só leitura.
          ...(!isCliente ? [{
            label:modo==="ver"?"Editar":"Salvar",
            variant:modo==="editar"?"primary":"secondary",
            onClick:()=>modo==="ver"?setModo("editar"):salvar(),
            disabled:salvando
          }] : []),
          ...(!isCliente && modo==="editar" && id!=="novo"
              ? [{label:"Cancelar",variant:"secondary",onClick:cancelarEdicao}]
              : [])
        ]}
      />

      {/* MODAL: Aporte */}
      {modalAporte&&(
        <div className="pi-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="pi-modal-sheet" style={{background:T.bgCard,border:`0.5px solid ${T.border}`,borderRadius:18,padding:"26px 22px",width:380,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{fontSize:16,fontWeight:300,color:T.textPrimary,marginBottom:4,...noEdit}}>Registrar aporte</div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:18,...noEdit}}>Data, valor e onde foi aportado. Fica gravado no histórico.</div>

            {/* Valor */}
            <div style={{fontSize:10,color:"#86efac",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6,...noEdit}}>Valor aportado</div>
            <div style={{fontSize:22,fontWeight:300,color:"#22c55e",marginBottom:8,textAlign:"center",...noEdit}}>
              {valorAporteInput?(parseInt(valorAporteInput.replace(/\D/g,""))||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2}):"R$ 0,00"}
            </div>
            <input style={{...C.input,textAlign:"center",fontSize:14,marginBottom:12}} placeholder="R$ 0,00" value={valorAporteInput} onChange={e=>setValorAporteInput(e.target.value)} autoFocus inputMode="numeric"/>

            {/* Data */}
            <div style={{fontSize:10,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6,...noEdit}}>Data</div>
            <input type="date" style={{...C.input,fontSize:13,marginBottom:12}} value={dataAporteInput} onChange={e=>setDataAporteInput(e.target.value)}/>

            {/* Classe */}
            <div style={{fontSize:10,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6,...noEdit}}>Onde foi aportado (classe)</div>
            <select style={{...C.input,fontSize:13,marginBottom:12}} value={classeAporte} onChange={e=>setClasseAporte(e.target.value)}>
              <option value="">— Selecione uma classe —</option>
              {CLASSES_CARTEIRA.map(c=>(
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>

            {/* Ativo */}
            <div style={{fontSize:10,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6,...noEdit}}>Ativo (opcional)</div>
            <input style={{...C.input,fontSize:13,marginBottom:12}} placeholder="Ex.: Tesouro IPCA+ 2035, HGLG11, ITSA4…" value={ativoAporte} onChange={e=>setAtivoAporte(e.target.value)}/>

            {/* Saldo remanescente */}
            <div style={{fontSize:10,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6,...noEdit}}>Sobrou em saldo / caixa? (opcional)</div>
            <input style={{...C.input,fontSize:13,marginBottom:6}} placeholder="R$ 0,00" value={saldoAporte?(parseInt(saldoAporte.replace(/\D/g,""))||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2}):""} onChange={e=>setSaldoAporte(e.target.value.replace(/\D/g,""))} inputMode="numeric"/>
            <div style={{fontSize:9,color:T.textMuted,marginBottom:16,lineHeight:1.5,...noEdit}}>Use este campo se parte do aporte ficou em caixa/saldo esperando nova aplicação.</div>

            <div style={{display:"flex",gap:10}}>
              <button style={{flex:1,padding:11,background:"none",border:`0.5px solid ${T.border}`,borderRadius:9,color:T.textMuted,fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={()=>{setModalAporte(false);setValorAporteInput("");setClasseAporte("");setAtivoAporte("");setSaldoAporte("");}}>Cancelar</button>
              <button style={{flex:1,padding:11,background:"rgba(34,197,94,0.1)",border:"0.5px solid rgba(34,197,94,0.4)",borderRadius:9,color:"#22c55e",fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={confirmarAporte}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Não aportou */}
      {modalNaoAportou&&(
        <div className="pi-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="pi-modal-sheet" style={{background:T.bgCard,border:`0.5px solid ${T.border}`,borderRadius:18,padding:"28px 24px",width:340,maxWidth:"100%"}}>
            <div style={{fontSize:16,fontWeight:300,color:T.textPrimary,marginBottom:4,...noEdit}}>Cliente sem aporte</div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:20,...noEdit}}>Quando será o próximo contato?</div>
            <div style={{background:"rgba(245,158,11,0.05)",border:"0.5px solid rgba(245,158,11,0.2)",borderRadius:10,padding:14,marginBottom:16}}>
              <div style={{fontSize:10,color:"#f59e0b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6,...noEdit}}>Próximo Contato</div>
              <div style={{fontSize:14,color:T.textPrimary}}>{dataProximoContato}</div>
            </div>
            <input style={{...C.input,marginBottom:16}} type="date"
              value={dataProximoContato.split("/").reverse().join("-")||""}
              onChange={e=>{if(e.target.value){const[a,m,d]=e.target.value.split("-");setDataProximoContato(`${d}/${m}/${a}`);}}}
            />
            <div style={{display:"flex",gap:10}}>
              <button style={{flex:1,padding:11,background:"none",border:`0.5px solid ${T.border}`,borderRadius:9,color:T.textMuted,fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={()=>{setModalNaoAportou(false);setDataProximoContato("");}}>Cancelar</button>
              <button style={{flex:1,padding:11,background:"rgba(245,158,11,0.1)",border:"0.5px solid rgba(245,158,11,0.4)",borderRadius:9,color:"#f59e0b",fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={confirmarNaoAportou}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Mês detalhes */}
      {mesDetalhes&&(
        <div className="pi-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="pi-modal-sheet" style={{background:T.bgCard,border:`0.5px solid ${T.border}`,borderRadius:18,padding:"28px 24px",width:320,maxWidth:"100%"}}>
            <div style={{fontSize:16,fontWeight:300,color:T.textPrimary,marginBottom:4,...noEdit}}>
              {["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"][mesDetalhes.mes]}
            </div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:20,...noEdit}}>Detalhes da movimentação</div>
            {mesDetalhes.movimento&&(
              <div style={{background:mesDetalhes.movimento.tipo==="aporte"?"rgba(34,197,94,0.08)":"rgba(239,68,68,0.08)",border:`0.5px solid ${mesDetalhes.movimento.tipo==="aporte"?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)"}`,borderRadius:12,padding:16,marginBottom:20}}>
                <div style={{fontSize:10,color:mesDetalhes.movimento.tipo==="aporte"?"#22c55e":"#ef4444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,...noEdit}}>
                  {mesDetalhes.movimento.tipo==="aporte"?"↑ Aporte":"↓ Resgate"}
                </div>
                <div style={{fontSize:22,fontWeight:300,color:T.textPrimary}}>{moeda(mesDetalhes.movimento.valor)||"—"}</div>
                {mesDetalhes.movimento.data&&<div style={{fontSize:11,color:T.textMuted,marginTop:8,...noEdit}}>{mesDetalhes.movimento.data}</div>}
              </div>
            )}
            <button style={{width:"100%",padding:11,background:"rgba(255,255,255,0.04)",border:`0.5px solid ${T.border}`,borderRadius:9,color:T.textSecondary,fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={()=>setMesDetalhes(null)}>Fechar</button>
          </div>
        </div>
      )}

      {/* MODAL: Marcar revisão */}
      {modalRevisao&&(
        <div className="pi-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="pi-modal-sheet" style={{background:T.bgCard,border:`0.5px solid ${T.border}`,borderRadius:18,padding:"28px 24px",width:320,maxWidth:"100%"}}>
            <div style={{fontSize:16,fontWeight:300,color:T.textPrimary,marginBottom:4,...noEdit}}>
              {revDate?(revisaoAgendada?"Editar agendamento":"Editar revisão"):"Marcar revisão"}
            </div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:20,...noEdit}}>
              {revDate?"Ajuste a data. Se for futura, ficará como agendada.":"Data passada ou de hoje: revisão feita. Data futura: agendada."}
            </div>
            <input style={{...C.input,marginBottom:16}} type="date"
              value={dataRevisaoInput}
              onChange={e=>setDataRevisaoInput(e.target.value)}
            />
            <div style={{display:"flex",gap:10}}>
              <button style={{flex:1,padding:11,background:"none",border:`0.5px solid ${T.border}`,borderRadius:9,color:T.textMuted,fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={()=>setModalRevisao(false)}>Cancelar</button>
              <button style={{flex:1,padding:11,background:"rgba(240,162,2,0.1)",border:"0.5px solid rgba(240,162,2,0.4)",borderRadius:9,color:"#F0A202",fontSize:11,cursor:"pointer",fontFamily:"inherit"}} onClick={()=>{
                if(dataRevisaoInput){
                  const[a,m,d]=dataRevisaoInput.split("-");
                  marcarRevisao(`${d}/${m}/${a}`);
                }else{
                  marcarRevisao(null);
                }
                setModalRevisao(false);
              }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Excluir cliente */}
      {modalExcluir&&(
        <div className="pi-modal-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="pi-modal-sheet" style={{background:T.bgCard,border:"0.5px solid rgba(239,68,68,0.35)",borderRadius:18,padding:"28px 24px",width:380,maxWidth:"100%"}}>
            <div style={{fontSize:17,fontWeight:500,color:"#ef4444",marginBottom:8,...noEdit,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:20}}>⚠️</span> Excluir cliente
            </div>
            <div style={{fontSize:13,color:T.textPrimary,marginBottom:6,lineHeight:1.5,...noEdit}}>
              Você tem certeza que quer apagar o cliente <strong style={{color:"#F0A202"}}>{snap.nome||"—"}</strong>?
            </div>
            <div style={{fontSize:12,color:T.textSecondary,marginBottom:16,lineHeight:1.5,...noEdit}}>
              Todos os dados do cadastro serão apagados permanentemente e não poderão ser recuperados.
            </div>
            <div style={{fontSize:11,color:T.textMuted,marginBottom:8,...noEdit}}>
              Para confirmar, digite o nome do cliente abaixo:
            </div>
            <input
              style={{...C.input,marginBottom:16}}
              type="text"
              value={confirmExcluirInput}
              onChange={e=>setConfirmExcluirInput(e.target.value)}
              placeholder={snap.nome||""}
              autoFocus
            />
            <div style={{display:"flex",gap:10}}>
              <button
                style={{flex:1,padding:11,background:"none",border:`0.5px solid ${T.border}`,borderRadius:9,color:T.textMuted,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}
                onClick={()=>{setModalExcluir(false);setConfirmExcluirInput("");}}
                disabled={excluindo}
              >Cancelar</button>
              <button
                style={{flex:1,padding:11,background:confirmExcluirInput.trim().toLowerCase()===(snap.nome||"").trim().toLowerCase()&&(snap.nome||"").trim()?"rgba(239,68,68,0.18)":"rgba(239,68,68,0.05)",border:"0.5px solid rgba(239,68,68,0.45)",borderRadius:9,color:"#ef4444",fontSize:11,cursor:excluindo?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:600,opacity:excluindo?0.5:1}}
                onClick={excluirCliente}
                disabled={excluindo||confirmExcluirInput.trim().toLowerCase()!==(snap.nome||"").trim().toLowerCase()||!(snap.nome||"").trim()}
              >{excluindo?"Excluindo...":"Excluir permanentemente"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Botão ← fixo lateral esquerda — só para admin/assessor */}
      {!isCliente && (
        <button
          onClick={()=>navigate("/dashboard")}
          className="floating-nav-btn is-left"
          aria-label="Voltar ao dashboard"
        >
          ←
        </button>
      )}

      <div
        className={id !== "novo" ? "cliente-zoom cliente-wrap" : ""}
        style={{
          maxWidth: id !== "novo" ? 1280 : 860,
          margin:"0 auto",
          padding:isMobile?"16px 12px calc(80px + env(safe-area-inset-bottom, 0px))":"24px 28px 80px",
          boxSizing:"border-box",
        }}
      >

        {/* HUB PI — mesmo banner do Dashboard, mas contextualizado na ficha do cliente */}
        {id !== "novo" && (
          <>
            {isCliente && <div className="hub-pi">
              <img
                src="/assets/logo/logo-icon.svg"
                alt=""
                aria-hidden="true"
                className="hub-pi-mark"
              />
              <div className="hub-pi-body">
                <span className="hub-pi-eyebrow">Hub PI</span>
                <span className="hub-pi-title">
                  {isCliente ? <>Bem-vindo, <b>{(snap.nome || "").split(" ")[0] || "cliente"}</b></> : <>Hub <b>Porto Invest</b></>}
                </span>
                <span className="hub-pi-sub">
                  {isCliente ? "Acompanhe sua carteira e seus objetivos" : `Painel do cliente · ${snap.nome || ""}`}
                </span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", justifyContent:"flex-end" }}>
                {/* Sino de notificações foi movido pra Navbar (canto superior direito) */}
                {isCliente ? (
                  <span
                    className="hub-pi-badge"
                    title={`Logado como ${authUser?.email || "cliente"}`}
                    style={{
                      background:"rgba(240,162,2,0.10)",
                      border:"1px solid rgba(240,162,2,0.28)",
                      color:"#FFB20F",
                      fontWeight:500,
                      fontSize:11,
                      letterSpacing:"0.04em",
                      textTransform:"none",
                      padding:"4px 10px",
                    }}
                  >
                    {isMobile ? moedaFull(patrimonioFinanceiro) : `Cliente · ${authUser?.email || snap.email || ""} · ${moedaFull(patrimonioFinanceiro)}`}
                  </span>
                ) : (
                  <span
                    className="hub-pi-badge"
                    title={`Logado como ${authUser?.email || "admin"}`}
                    style={{
                      background:"rgba(255,255,255,0.06)",
                      border:"1px solid rgba(255,255,255,0.12)",
                      color:"#c7d3e0",
                      fontWeight:500,
                      fontSize:11,
                      letterSpacing:"0.04em",
                      textTransform:"none",
                      padding:"4px 10px",
                    }}
                  >
                    {isMaster ? "Admin" : "Assessor"} · {(authUser?.email?.split("@")[0] || "")}
                  </span>
                )}
              </div>
            </div>}

            {/* NOVA HOME — Liberdade Financeira (visível para todos: cliente + assessor preview)
                Envolvido em SilentBoundary para que nenhuma falha aqui derrube a página inteira. */}
            {id !== "novo" && (
              <SilentBoundary>
                <HomeLiberdade cliente={snap} clienteId={id} />
              </SilentBoundary>
            )}

            {/* BARRA DE STATUS DO MERCADO.
                Só no modo visualização e só pro assessor.
                Cliente final não precisa acompanhar Dólar/Selic/IPCA na home. */}
            {modo === "ver" && !isCliente && (
              <>
                <div className="dashboard-status-bar" style={{
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  flexWrap:"wrap",
                  rowGap:6,
                  columnGap:10,
                  fontSize:12,
                  color:"#748CAB",
                  marginTop:16,
                  marginBottom:10,
                  letterSpacing:"0.06em",
                  fontWeight:500,
                  textTransform:"uppercase",
                  textAlign:"center",
                }}>
                  <span style={{ color:"#5a7a9a" }}>{new Date().toLocaleDateString("pt-BR")}</span>
                  <span style={{ color:"#3E5C76" }}>•</span>
                  <span style={{ color: statusMercado ? "#22c55e" : "#9EB8D0", fontWeight:600 }}>
                    {statusMercado ? "● MERCADO ABERTO" : "● MERCADO FECHADO"}
                  </span>
                  {ultimaAtualizacao && (
                    <>
                      <span style={{ color:"#3E5C76" }}>•</span>
                      <span style={{ color:"#5a7a9a", textTransform:"none", fontWeight:400 }}>
                        Última atualização: <strong style={{ color:"#748CAB" }}>{ultimaAtualizacao}</strong>
                      </span>
                    </>
                  )}
                </div>
                <div className="market-indicators market-indicators--compact" style={{ maxWidth:isMobile?"100%":"82%", margin:"0 auto 36px" }}>
                  {mercado.map(({label,valor,sub,cor})=>(
                    <div key={label} className="market-indicator">
                      <div className="market-label">{label}</div>
                      <div className="market-value">{valor}</div>
                      <div className="market-sub" style={{color:cor}}>{sub}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Alertas */}
        {alertaViradaMes&&(
          <div style={{background:"rgba(168,85,247,0.08)",border:"0.5px solid rgba(168,85,247,0.3)",borderRadius:10,padding:"12px 16px",fontSize:12,color:"#a855f7",marginBottom:10,lineHeight:1.6,...noEdit}}>
            📅 Início do mês. Entre em contato e confirme o aporte.
          </div>
        )}
        {alertaContato&&(
          <div style={{background:"rgba(245,158,11,0.08)",border:"0.5px solid rgba(245,158,11,0.3)",borderRadius:10,padding:"12px 16px",fontSize:12,color:"#f59e0b",marginBottom:10,lineHeight:1.6,...noEdit}}>
            ⚠ Contato vencido: <b>{snap.nextContactDate}</b>. Entre em contato agora!
          </div>
        )}

        {/* HERO CARD com navegação, acompanhamento e KPIs.
            Mostrado apenas para o assessor.
            Para o cliente, a HomeLiberdade já entrega meta, próximos passos e jornada,
            e a sidebar já dá acesso a todas as páginas. */}
        {!isCliente && (
        <div style={{
          position:"relative",
          background:"linear-gradient(150deg,rgba(36,55,83,0.92) 0%,rgba(20,31,51,0.96) 55%,rgba(13,19,33,0.98) 100%)",
          border:"0.5px solid rgba(240,162,2,0.18)",
          borderRadius:isMobile?18:22,
          padding:isMobile?"20px 14px":"28px 22px 24px",
          marginBottom:18,
          boxShadow:"0 20px 60px -20px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.04) inset",
          overflow:"hidden",
          display:"flex",
          flexDirection:"column",
        }}>
          {/* Ambient glows (decorative, non-interactive) */}
          <div style={{position:"absolute",top:-120,right:-120,width:340,height:340,background:"radial-gradient(circle,rgba(240,162,2,0.10) 0%,transparent 65%)",pointerEvents:"none",filter:"blur(10px)"}}/>
          <div style={{position:"absolute",bottom:-140,left:-100,width:360,height:360,background:"radial-gradient(circle,rgba(25,130,196,0.08) 0%,transparent 65%)",pointerEvents:"none",filter:"blur(10px)"}}/>

          {/* Header — Nome + Status */}
          <div style={{position:"relative",marginBottom:isMobile?12:14}}>

            {/* Info */}
            <div style={{minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                <div style={{fontSize:isMobile?19:24,fontWeight:300,color:T.textPrimary,letterSpacing:"-0.02em",lineHeight:1.2,...noEdit}}>
                  {snap.nome||"Novo cliente"}
                </div>
                {segmento&&(
                  <span style={{fontSize:9,padding:"4px 11px",borderRadius:20,background:"linear-gradient(135deg,rgba(240,162,2,0.22),rgba(240,162,2,0.08))",color:"#FFB20F",border:"0.5px solid rgba(240,162,2,0.5)",letterSpacing:"0.12em",fontWeight:600,whiteSpace:"nowrap",textTransform:"uppercase",boxShadow:"0 2px 12px rgba(240,162,2,0.2)",...noEdit}}>
                    {segmento}
                  </span>
                )}
              </div>
              <div style={{fontSize:13,color:T.textSecondary,lineHeight:1.5,letterSpacing:"0.01em",...noEdit}}>
                {[snap.profissao,snap.uf?snap.uf.split("–")[0].trim():null,idade?`${idade} anos`:null].filter(Boolean).join(" · ")}
              </div>
              {!isCliente && id!=="novo" && modo==="ver" && !snap.isProspect && snap.email && !snap.userId && (
                <div style={{marginTop:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.3)",borderRadius:10}}>
                  <span style={{fontSize:11,color:"#ef4444",letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:700}}>⚠ Sem login</span>
                  <span style={{fontSize:12,color:T.textSecondary,flex:1,minWidth:180}}>
                    Este cliente não consegue acessar a plataforma. Clique para criar o login agora.
                  </span>
                  <button
                    onClick={criarLoginAgora}
                    disabled={criandoLogin}
                    style={{padding:"8px 14px",background:"#F0A202",color:"#0A0E14",border:"none",borderRadius:8,fontWeight:700,fontSize:12,cursor:criandoLogin?"wait":"pointer",letterSpacing:"0.04em"}}
                  >
                    {criandoLogin ? "Criando…" : "🔑 Criar login"}
                  </button>
                </div>
              )}
              {!isCliente && id!=="novo" && modo==="ver" && !snap.isProspect && snap.userId && (
                <div style={{marginTop:8,fontSize:11,color:"#22c55e",letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:600}}>
                  ✓ Login ativo · {snap.email}
                </div>
              )}
            </div>
          </div>

          {/* ─── NAVEGAÇÃO + KPIs (compacto, sem scroll) ─────────────── */}
          <div style={{display:"flex",flexDirection:"column",gap:isMobile?12:14}}>
          {id!=="novo"&&(
            <div style={{position:"relative"}}>
              <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.22em",color:"#F0A202",fontWeight:700,marginBottom:10,...noEdit}}>Navegar</div>

              {/* Linha 1 — 5 botões iguais */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(5,1fr)",gap:10}}>
                {[
                  ["Objetivos","objetivos","Planejamento de metas"],
                  ["Gastos Mensais","fluxo","Fluxo de caixa"],
                  ["Carteira","carteira","Seus investimentos"],
                  ["Diagnóstico","diagnostico","Análise da carteira"],
                  ["Simulador","simulador","Projeções futuras"],
                ].map(([l,r,sub])=>(
                  <button
                    key={l}
                    onClick={()=>navigate(`/cliente/${id}/${r}`)}
                    style={{position:"relative",padding:isMobile?"16px 12px":"20px 16px",background:"linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)",border:"0.5px solid rgba(255,255,255,0.09)",borderRadius:12,color:"rgba(255,255,255,0.78)",fontFamily:"inherit",cursor:"pointer",textAlign:"left",transition:"all 0.35s cubic-bezier(0.16,1,0.3,1)",overflow:"hidden",...noEdit}}
                    onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(240,162,2,0.12) 0%,rgba(240,162,2,0.04) 100%)";e.currentTarget.style.borderColor="rgba(240,162,2,0.5)";e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 30px -10px rgba(240,162,2,0.35)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)";e.currentTarget.style.borderColor="rgba(255,255,255,0.09)";e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}
                  >
                    <div style={{fontSize:isMobile?15:17,fontWeight:600,color:"#FFFFFF",letterSpacing:"-0.01em",marginBottom:5,lineHeight:1.2}}>{l}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",letterSpacing:"0.015em",fontWeight:400,lineHeight:1.3}}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Linha 2 — Revisão | Ajustes | Meta Aporte */}
          {id!=="novo"&&(
            <div>
            <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.22em",color:"#F0A202",fontWeight:700,marginBottom:10,...noEdit}}>Acompanhamento</div>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,1fr)",gap:8}}>
              {(()=>{
                const abrirModal=()=>{
                  const iso=revDate?`${revDate.getFullYear()}-${String(revDate.getMonth()+1).padStart(2,"0")}-${String(revDate.getDate()).padStart(2,"0")}`:hoje.toISOString().split("T")[0];
                  setDataRevisaoInput(iso); setModalRevisao(true);
                };
                const diasPara=revDate?Math.round((revDate.getTime()-hojeDia.getTime())/86400000):null;
                let titulo,detalhe,dot;
                if(revisaoAgendada){titulo="Próxima Revisão";detalhe=diasPara>0?`${dataRevisao} · em ${diasPara}d`:dataRevisao;dot="#60a5fa";}
                else if(revisaoFeitaMes){titulo="Última Revisão";detalhe=dataRevisao||"—";dot="#22c55e";}
                else if(pendente){titulo="Revisão Pendente";detalhe="Agendar agora";dot="#f59e0b";}
                else{titulo="Marcar Revisão";detalhe="Clique para agendar";dot="rgba(255,255,255,0.25)";}
                return(
                  <button onClick={abrirModal} disabled={marcandoRevisao}
                    style={{padding:"14px 16px",background:"linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)",border:"0.5px solid rgba(255,255,255,0.09)",borderRadius:12,fontFamily:"inherit",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,transition:"all 0.35s cubic-bezier(0.16,1,0.3,1)",...noEdit}}
                    onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(240,162,2,0.12) 0%,rgba(240,162,2,0.04) 100%)";e.currentTarget.style.borderColor="rgba(240,162,2,0.5)";e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 30px -10px rgba(240,162,2,0.35)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)";e.currentTarget.style.borderColor="rgba(255,255,255,0.09)";e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}
                  >
                    <div style={{width:8,height:8,borderRadius:"50%",background:dot,flexShrink:0,boxShadow:dot.startsWith("rgba")?undefined:`0 0 8px ${dot}`}}/>
                    <div>
                      <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.14em",color:"rgba(255,255,255,0.5)",fontWeight:600,marginBottom:4}}>{titulo}</div>
                      <div style={{fontSize:14,fontWeight:600,color:"#FFFFFF",letterSpacing:"-0.005em"}}>{detalhe}</div>
                    </div>
                  </button>
                );
              })()}
              <button onClick={()=>navigate(`/cliente/${id}/ajustes`)}
                style={{padding:"14px 16px",background:"linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)",border:"0.5px solid rgba(255,255,255,0.09)",borderRadius:12,fontFamily:"inherit",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,transition:"all 0.35s cubic-bezier(0.16,1,0.3,1)",...noEdit}}
                onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(240,162,2,0.12) 0%,rgba(240,162,2,0.04) 100%)";e.currentTarget.style.borderColor="rgba(240,162,2,0.5)";e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 30px -10px rgba(240,162,2,0.35)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)";e.currentTarget.style.borderColor="rgba(255,255,255,0.09)";e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}
              >
                <div style={{width:8,height:8,borderRadius:"50%",background:"#F0A202",flexShrink:0,boxShadow:"0 0 8px rgba(240,162,2,0.6)"}}/>
                <div>
                  <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.14em",color:"rgba(255,255,255,0.5)",fontWeight:600,marginBottom:4}}>Recomendações</div>
                  <div style={{fontSize:14,fontWeight:600,color:"#FFFFFF",letterSpacing:"-0.005em"}}>Ajustes da Carteira</div>
                </div>
              </button>
              {(()=>{
                const aportou=snap.statusAporteMes==="aportou";
                const semAporte=snap.statusAporteMes==="nao_aportou";
                const metaReais=parseCentavos(snap.metaAporteMensal)/100;
                const pct=metaReais>0?Math.min((aporteRegistradoVal/metaReais)*100,100):(aportou?100:0);
                let titulo,detalhe,dot;
                if(metaReais>0&&aporteRegistradoVal>=metaReais){titulo="Meta Aporte";detalhe=`${moedaFull(aporteRegistradoVal)} · ✓`;dot="#22c55e";}
                else if(metaReais>0&&aporteRegistradoVal>0){titulo="Meta Aporte";detalhe=`${pct.toFixed(0)}% · ${moedaFull(aporteRegistradoVal)}`;dot="#f59e0b";}
                else if(semAporte){titulo="Aporte do Mês";detalhe="Não fez aporte";dot="#ef4444";}
                else if(aportou){titulo="Aporte do Mês";detalhe="✓ Registrado";dot="#22c55e";}
                else{titulo="Meta Aporte";detalhe=metaReais>0?`Meta: ${moedaFull(metaReais)}`:"Definir meta";dot="rgba(255,255,255,0.25)";}
                return(
                  <button onClick={()=>navigate(`/cliente/${id}/carteira`)}
                    style={{padding:"14px 16px",background:"linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)",border:"0.5px solid rgba(255,255,255,0.09)",borderRadius:12,fontFamily:"inherit",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,transition:"all 0.35s cubic-bezier(0.16,1,0.3,1)",...noEdit}}
                    onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(240,162,2,0.12) 0%,rgba(240,162,2,0.04) 100%)";e.currentTarget.style.borderColor="rgba(240,162,2,0.5)";e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 30px -10px rgba(240,162,2,0.35)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)";e.currentTarget.style.borderColor="rgba(255,255,255,0.09)";e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}
                  >
                    <div style={{width:8,height:8,borderRadius:"50%",background:dot,flexShrink:0,boxShadow:dot.startsWith("rgba")?undefined:`0 0 8px ${dot}`}}/>
                    <div>
                      <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.14em",color:"rgba(255,255,255,0.5)",fontWeight:600,marginBottom:4}}>{titulo}</div>
                      <div style={{fontSize:14,fontWeight:600,color:"#FFFFFF",letterSpacing:"-0.005em"}}>{detalhe}</div>
                    </div>
                  </button>
                );
              })()}
            </div>
            </div>
          )}

          {/* Linha 3 — Visão Geral (4 KPIs) */}
          {id!=="novo"&&(()=>{
            const abrirSecao=(key)=>{
              setSections(s=>({...s,[key]:true}));
              setTimeout(()=>{const el=document.getElementById(`sec-${key}`);if(el)el.scrollIntoView({behavior:"smooth",block:"start"});},120);
            };
            const btn={border:"none",textAlign:"left",fontFamily:"inherit",cursor:"pointer",width:"100%",display:"block",padding:isMobile?"12px 12px":"14px 14px",background:"linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)",borderRadius:12,outline:"0.5px solid rgba(255,255,255,0.09)",transition:"all 0.35s cubic-bezier(0.16,1,0.3,1)"};
            const hov=e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(240,162,2,0.10) 0%,rgba(240,162,2,0.03) 100%)";e.currentTarget.style.outline="0.5px solid rgba(240,162,2,0.45)";e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 30px -10px rgba(240,162,2,0.3)";};
            const lev=e=>{e.currentTarget.style.background="linear-gradient(160deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0.015) 100%)";e.currentTarget.style.outline="0.5px solid rgba(255,255,255,0.09)";e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";};
            const lbl={fontSize:10,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",letterSpacing:isMobile?"0.08em":"0.16em",fontWeight:600,marginBottom:8,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...noEdit};
            const val={fontSize:isMobile?17:20,fontWeight:600,color:"#FFFFFF",lineHeight:1.15,letterSpacing:"-0.02em",wordBreak:"break-word",...noEdit};
            const sub={fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:6,letterSpacing:"0.01em",fontWeight:400,...noEdit};
            return(
          <div>
          <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.22em",color:"#F0A202",fontWeight:700,marginBottom:10,...noEdit}}>Visão Geral</div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:8}}>
            <button onClick={()=>abrirSecao("patrimonio")} style={btn} onMouseEnter={hov} onMouseLeave={lev}>
              <div style={lbl}>Patrimônio Total</div>
              <div style={val}>{patrimonioDisplay>0?moedaFull(patrimonioDisplay):"—"}</div>
              <div style={sub}>{totalCarteira>0&&totalImoveis+totalVeiculos>0?"Inclui bens físicos":"Patrimônio consolidado"}</div>
            </button>
            <button onClick={()=>abrirSecao("carteira")} style={btn} onMouseEnter={hov} onMouseLeave={lev}>
              <div style={lbl}>Pat. Financeiro</div>
              <div style={val}>{patrimonioFinanceiro>0?moedaFull(patrimonioFinanceiro):"—"}</div>
              <div style={sub}>Total investido</div>
            </button>
            <button onClick={()=>abrirSecao("rendas")} style={btn} onMouseEnter={hov} onMouseLeave={lev}>
              <div style={lbl}>Renda Mensal</div>
              <div style={val}>{rendaMensal>0?moedaFull(rendaMensal):"—"}</div>
              <div style={sub}>{gastosMensaisEfetivo>0&&rendaMensal>0?`Gastos ${moedaFull(gastosMensaisEfetivo)}`:"Receitas mensais"}</div>
            </button>
            <button onClick={()=>abrirSecao("reserva")} style={btn} onMouseEnter={hov} onMouseLeave={lev}>
              <div style={lbl}>Reserva Emergência</div>
              <div style={{...val,fontSize:isMobile?14:16,color:reservaStatus.cor}}>{reservaStatus.label}</div>
              {reservaMeta>0&&<div style={sub}>Meta: {moedaFull(reservaMeta)}</div>}
              {reservaMeta>0&&liquidezReserva>0&&liquidezReserva<reservaMeta&&(
                <div style={{marginTop:8,height:2,background:"rgba(255,255,255,0.08)",borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(liquidezReserva/reservaMeta*100,100).toFixed(0)}%`,background:reservaStatus.cor,borderRadius:2}}/>
                </div>
              )}
            </button>
          </div>
          </div>
            );
          })()}
          </div>
        </div>
        )}

        {/* Feedback */}
        {msg&&(
          <div style={{background:msg.includes("Erro")?"rgba(239,68,68,0.08)":"rgba(34,197,94,0.08)",border:`0.5px solid ${msg.includes("Erro")?"rgba(239,68,68,0.25)":"rgba(34,197,94,0.25)"}`,borderRadius:10,padding:"11px 14px",fontSize:12,color:msg.includes("Erro")?T.danger:T.success,marginBottom:14,lineHeight:1.5,...noEdit}}>
            {msg}
          </div>
        )}

        {/* ─── EDIT MODE ──────────────────────────────────────────── */}
        {modo==="editar"&&(
          <div style={{background:T.bgCard,border:`0.5px solid ${T.border}`,borderRadius:isMobile?14:20,padding:isMobile?"16px 16px 32px":"28px 36px 44px",margin:"0 auto",textAlign:"left",maxWidth:820}}>

            {id==="novo"&&(
              <div style={{marginBottom:28,paddingBottom:28,borderBottom:`0.5px solid rgba(62,92,118,0.3)`}}>
                <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"4px 12px",background:"rgba(240,162,2,0.10)",border:"0.5px solid rgba(240,162,2,0.28)",borderRadius:20,fontSize:10,letterSpacing:"0.14em",textTransform:"uppercase",color:"#F0A202",fontWeight:600,marginBottom:14}}>
                  <span style={{width:5,height:5,borderRadius:"50%",background:"#F0A202"}}/>
                  Novo cadastro
                </div>
                <div style={{fontSize:isMobile?20:26,fontWeight:600,color:T.textPrimary,marginBottom:8,letterSpacing:"-0.02em",lineHeight:1.2}}>
                  Cadastro de cliente
                </div>
                <div style={{fontSize:13,color:T.textSecondary,lineHeight:1.7,maxWidth:560,marginBottom:16}}>
                  Preencha as seções abaixo. Campos marcados com <span style={{color:"#F0A202",fontWeight:600}}>*</span> são obrigatórios.
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {[{icon:"⏱",txt:"~10 min"},{icon:"🔒",txt:"Criptografado"},{icon:"✅",txt:"Editável depois"}].map(t=>(
                    <span key={t.txt} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 10px",background:"rgba(255,255,255,0.03)",border:`0.5px solid ${T.border}`,borderRadius:99,fontSize:11,color:T.textSecondary}}>
                      <span>{t.icon}</span><span>{t.txt}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ SEÇÃO 1: IDENTIFICAÇÃO ═══════════════════════════ */}
            <SectionTitle numero={1} total={8} icon="👤" subtitle="Comece com os dados básicos. Rápido — leva menos de 1 minuto.">Identificação</SectionTitle>

            {/* Avatar */}
            <div style={{marginBottom:28}}>
              <Lbl>Avatar</Lbl>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"flex-start",marginTop:8}}>
                {AVATAR_OPTS.map(opt=>(
                  <div
                    key={opt.key}
                    onClick={()=>setFSnap("avatar",opt.key)}
                    style={{
                      display:"flex",flexDirection:"column",alignItems:"center",gap:8,
                      cursor:"pointer",transition:"all 0.2s",...noEdit,
                      padding:"12px 10px",borderRadius:14,
                      background:snap.avatar===opt.key?"rgba(240,162,2,0.12)":"rgba(255,255,255,0.02)",
                      border:snap.avatar===opt.key?"1px solid rgba(240,162,2,0.5)":`1px solid ${T.border}`,
                      opacity:snap.avatar===opt.key?1:0.6,
                      minWidth:72,
                    }}
                  >
                    <AvatarIcon tipo={opt.key} size={52}/>
                    <span style={{fontSize:11,color:snap.avatar===opt.key?"#F0A202":T.textSecondary,fontWeight:snap.avatar===opt.key?600:400,letterSpacing:"0.02em"}}>{opt.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {(id==="novo" || !isCliente) && (
              <div className="clienteficha-novo-painel">
                <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:id!=="novo"?0:12}}>
                  <label style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",border:`1px solid ${!isProspect?"#F0A202":T.border}`,borderRadius:10,cursor:"pointer",background:!isProspect?"rgba(240,162,2,0.08)":"transparent",fontSize:13,color:!isProspect?"#F0A202":T.textSecondary,fontWeight:!isProspect?600:400}}>
                    <input
                      type="radio"
                      name="tipo-contato"
                      checked={!isProspect}
                      onChange={()=>setIsProspect(false)}
                      style={{accentColor:"#F0A202"}}
                    />
                    <span>Cliente (com login)</span>
                  </label>
                  <label style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",border:`1px solid ${isProspect?"#F0A202":T.border}`,borderRadius:10,cursor:"pointer",background:isProspect?"rgba(240,162,2,0.08)":"transparent",fontSize:13,color:isProspect?"#F0A202":T.textSecondary,fontWeight:isProspect?600:400}}>
                    <input
                      type="radio"
                      name="tipo-contato"
                      checked={isProspect}
                      onChange={()=>setIsProspect(true)}
                      style={{accentColor:"#F0A202"}}
                    />
                    <span>Prospect (sem login)</span>
                  </label>
                </div>
                <label className="clienteficha-novo-check" style={{display:"none"}}>
                  <input
                    type="checkbox"
                    checked={isProspect}
                    onChange={e=>setIsProspect(e.target.checked)}
                  />
                  <span>É um <strong>prospect</strong> (ainda não fechou contrato — sem login)</span>
                </label>
                {isMaster && assessores.length > 0 && (
                  <div className="clienteficha-novo-select">
                    <label>Vincular ao assessor</label>
                    <select
                      value={advisorEscolhido}
                      onChange={e=>setAdvisorEscolhido(e.target.value)}
                    >
                      {assessores.map(a => (
                        <option key={a.uid} value={a.uid}>
                          {a.nome || a.email || a.uid.slice(0,8)} {a.role === "master" ? "· (master)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:12,marginBottom:20}}>
              <div style={{gridColumn:"1/-1"}} ref={nomeFieldRef}>
                <Lbl>Nome completo <span style={{color:"#F0A202"}}>*</span></Lbl>
                <InputTexto
                  key={`nome-${id}`}
                  initValue={snap.nome}
                  onCommit={v=>{setFSnap("nome",v);if(v&&v.trim()&&nomeError)setNomeError(false);}}
                  onFocus={()=>{if(nomeError)setNomeError(false);}}
                  hasError={nomeError}
                  placeholder="Como você gostaria de ser chamado"
                />
                {nomeError&&(
                  <div style={{fontSize:11,color:"#ef4444",marginTop:6,display:"flex",alignItems:"center",gap:5}}>
                    <span style={{fontSize:13}}>⚠</span>
                    <span>Este campo é obrigatório para gerarmos o diagnóstico.</span>
                  </div>
                )}
              </div>
              <div>
                <Lbl>Idade ou data de nascimento</Lbl>
                <InputIdadeOuNasc key={`nasc-${id}`} initValue={snap.nascimento} onCommit={v=>setFSnap("nascimento",v)}/>
                <div style={{fontSize:9,color:T.textMuted,marginTop:5,...noEdit}}>Ex: 42 · ou · 15/08/1983</div>
              </div>
              <div>
                <Lbl>Telefone / WhatsApp</Lbl>
                <InputTelefone key={`tel-${id}`} initValue={snap.telefone} onCommit={v=>setF("telefone",v)}/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <Lbl>E-mail</Lbl>
                <InputTexto key={`email-${id}`} initValue={snap.email} onCommit={v=>setF("email",v)} type="email" placeholder="nome@email.com"/>
              </div>
              <div>
                <Lbl>CPF</Lbl>
                <InputTexto key={`cpf-${id}`} initValue={snap.cpf} onCommit={v=>setF("cpf",v)} placeholder="000.000.000-00"/>
                <div style={{fontSize:9,color:T.textMuted,marginTop:5,...noEdit}}>Usado para evitar cadastro duplicado.</div>
              </div>
              <div>
                <Lbl>Código interno (opcional)</Lbl>
                <InputTexto key={`cod-${id}`} initValue={snap.codigo} onCommit={v=>setF("codigo",v)} placeholder="Ex: CL-042"/>
              </div>
              <div>
                <Lbl>Cliente desde</Lbl>
                <InputTexto key={`desde-${id}`} initValue={snap.desde} onCommit={v=>setF("desde",v)} placeholder="jan/2023"/>
              </div>
            </div>

            {/* ═══ SEÇÃO 2: FAMÍLIA ═════════════════════════════════ */}
            <SectionTitle numero={2} total={8} icon="👨‍👩‍👧" subtitle="Cônjuge, filhos e pets. Ajuda a planejar sucessão, seguros e educação.">Família e Dependentes</SectionTitle>

            <div style={{marginBottom:28}}>
              <div style={{fontSize:13,color:T.textSecondary,marginBottom:14,textAlign:"center",...noEdit}}>Estado civil</div>
              <PillChoice value={snap.estadoCivil} onChange={v=>setFSnap("estadoCivil",v)} options={ESTADO_CIVIL}/>
            </div>

            {(snap.estadoCivil==="Casado(a)"||snap.estadoCivil==="União Estável")&&(
              <div style={{marginBottom:16}}>
                <Lbl>Nome do(a) cônjuge</Lbl>
                <InputTexto key={`conj-${id}`} initValue={snap.conjuge} onCommit={v=>setF("conjuge",v)} placeholder="Nome completo do(a) cônjuge"/>
              </div>
            )}

            <div style={{marginBottom:28}}>
              <div style={{fontSize:13,color:T.textSecondary,marginBottom:14,textAlign:"center",...noEdit}}>Tem filhos?</div>
              <PillChoice value={snap.temFilhos} onChange={v=>setFSnap("temFilhos",v)} options={["Sim","Não"]}/>
            </div>

            {snap.temFilhos==="Sim"&&(
              <div style={{marginBottom:12}}>
                {(snap.filhos||[]).map((f,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontSize:10,color:"#a78bfa",textTransform:"uppercase",letterSpacing:"0.1em",...noEdit}}>Filho(a) {i+1}</div>
                      <button onClick={()=>removerFilho(i)} style={{padding:"4px 10px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.2)",borderRadius:7,color:"#ef4444",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Remover</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10}}>
                      <div>
                        <Lbl>Nome</Lbl>
                        <InputTexto key={`fi-n-${i}`} initValue={f.nome||""} onCommit={v=>atualizarFilho(i,"nome",v)} placeholder="Nome do filho(a)"/>
                      </div>
                      <div>
                        <Lbl>Idade</Lbl>
                        <InputTexto key={`fi-i-${i}`} initValue={f.idade||""} onCommit={v=>atualizarFilho(i,"idade",v)} placeholder="Ex: 8"/>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={adicionarFilho} style={{padding:"10px 16px",background:"rgba(168,139,250,0.06)",border:"0.5px solid rgba(168,139,250,0.25)",borderRadius:9,color:"#a78bfa",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em"}}>
                  + Adicionar filho(a)
                </button>
              </div>
            )}

            {/* ═══ PETS ═════════════════════════════════════════════ */}
            <div style={{marginBottom:28}}>
              <div style={{fontSize:13,color:T.textSecondary,marginBottom:14,textAlign:"center",...noEdit}}>Tem animais de estimação? 🐾</div>
              <PillChoice value={snap.temPet} onChange={v=>setFSnap("temPet",v)} options={["Sim","Não"]}/>
            </div>

            {snap.temPet==="Sim"&&(
              <div style={{marginBottom:12}}>
                {(snap.pets||[]).map((p,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontSize:10,color:"#a78bfa",textTransform:"uppercase",letterSpacing:"0.1em",...noEdit}}>Pet {i+1}</div>
                      <button onClick={()=>removerPet(i)} style={{padding:"4px 10px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.2)",borderRadius:7,color:"#ef4444",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Remover</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10}}>
                      <div>
                        <Lbl>Nome do pet</Lbl>
                        <InputTexto key={`pt-n-${i}`} initValue={p.nome||""} onCommit={v=>atualizarPet(i,"nome",v)} placeholder="Ex: Thor, Luna..."/>
                      </div>
                      <div>
                        <Lbl>Tipo</Lbl>
                        <InputTexto key={`pt-t-${i}`} initValue={p.tipo||""} onCommit={v=>atualizarPet(i,"tipo",v)} placeholder="Ex: Cão, Gato..."/>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={adicionarPet} style={{padding:"10px 16px",background:"rgba(168,139,250,0.06)",border:"0.5px solid rgba(168,139,250,0.25)",borderRadius:9,color:"#a78bfa",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em"}}>
                  + Adicionar pet
                </button>
              </div>
            )}

            {/* ═══ SEÇÃO 3: LOCALIZAÇÃO & PERFIL ═════════════════════ */}
            <SectionTitle numero={3} total={8} icon="📍" subtitle="Onde você mora, sua profissão e seus hobbies.">Localização e Perfil</SectionTitle>

            <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:12,marginBottom:20}}>
              <div>
                <Lbl>Estado</Lbl>
                <CustomSelect value={snap.uf} onChange={v=>setFSnap("uf",v)} options={ESTADOS_BRASIL} placeholder="Selecione o estado"/>
              </div>
              <div>
                <Lbl>Cidade</Lbl>
                <InputTexto key={`cid-${id}`} initValue={snap.cidade} onCommit={v=>setF("cidade",v)} placeholder="Digite a cidade"/>
              </div>
              <div>
                <Lbl>Profissão</Lbl>
                <CustomSelect value={snap.profissao} onChange={v=>setFSnap("profissao",v)} options={PROFISSOES} placeholder="Selecione a profissão"/>
              </div>
              <div>
                <Lbl>Hobbies / Interesses <span style={{color:T.textMuted}}>(múltipla escolha)</span></Lbl>
                <MultiSelect values={snap.hobbies||[]} onChange={v=>setFSnap("hobbies",v)} options={HOBBIES} placeholder="Selecione um ou mais hobbies"/>
              </div>
            </div>

            {/* SEÇÕES 4–5 (Renda/Gastos/Aportes e Patrimônio Financeiro) removidas
                em 28/04/2026. Esses números agora vêm automaticamente:
                  - Renda/Gastos/Aporte → da página Fluxo Mensal (lançamentos reais)
                  - Patrimônio Financeiro → da Carteira (soma dos Ativos)
                  - Liquidez diária   → categoria específica em Carteira
                Cliente preenche onde o dado naturalmente vive, sem duplicar
                input. Os campos no Firestore continuam (não removidos),
                mantendo compatibilidade com Diagnóstico/Dashboard. */}

            {/* Cliente final só edita os dados cadastrais (seções 1–3 +
                Salvar/Trocar senha). Patrimônio imobiliário, veículos,
                proteção, modelo de atendimento e objetivos de interesse
                continuam sendo editáveis pelo assessor — para o cliente
                ficaria visualmente sobrecarregado e a maioria desses dados
                vem natural de outras telas (Carteira, Objetivos, Fluxo). */}
            {!isCliente && (
              <>
            {/* ═══ SEÇÃO 4: PATRIMÔNIO IMOBILIÁRIO ═════════════════════ */}
            <SectionTitle numero={4} total={8} icon="🏡" subtitle="Casa, apartamento, terreno, sítio ou imóvel comercial em seu nome.">Patrimônio Imobiliário</SectionTitle>

            {(snap.imoveis||[]).length===0&&(
              <div style={{fontSize:12,color:T.textMuted,marginBottom:10,padding:"10px 0",...noEdit}}>Nenhum imóvel cadastrado ainda.</div>
            )}
            {(snap.imoveis||[]).map((im,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:10,color:"#22c55e",textTransform:"uppercase",letterSpacing:"0.1em",...noEdit}}>Imóvel {i+1}</div>
                  <button onClick={()=>removerImovel(i)} style={{padding:"4px 10px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.2)",borderRadius:7,color:"#ef4444",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Remover</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:10}}>
                  <div>
                    <Lbl>Tipo de imóvel</Lbl>
                    <CustomSelect value={im.tipo} onChange={v=>atualizarImovel(i,"tipo",v)} options={TIPOS_IMOVEL}/>
                  </div>
                  <div>
                    <Lbl>Identificação (opcional)</Lbl>
                    <InputTexto key={`im-nome-${i}`} initValue={im.nome||""} onCommit={v=>atualizarImovel(i,"nome",v)} placeholder="Ex: Casa principal"/>
                  </div>
                  <div>
                    <Lbl>Quantidade</Lbl>
                    <input type="number" min="1" max="99" value={im.quantidade||1} onChange={e=>atualizarImovel(i,"quantidade",Math.max(1,parseInt(e.target.value)||1))} style={{...C.input,width:"100%"}}/>
                  </div>
                  <div>
                    <Lbl>Valor aproximado (R$)</Lbl>
                    <CustomSelect value={im.faixa} onChange={v=>atualizarImovel(i,"faixa",v)} options={FAIXAS_IMOVEL.map(f=>f.label)}/>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={adicionarImovel} style={{padding:"10px 16px",background:"rgba(34,197,94,0.06)",border:"0.5px solid rgba(34,197,94,0.25)",borderRadius:9,color:"#22c55e",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em"}}>
              + Adicionar imóvel
            </button>

            {/* ═══ SEÇÃO 7: VEÍCULOS ═════════════════════════════════ */}
            <SectionTitle numero={5} total={8} icon="🚗" subtitle="Carros, motos, caminhões, barcos. Toque no campo abaixo para escolher marca e modelo.">Veículos</SectionTitle>

            {(snap.veiculos||[]).length===0&&(
              <div style={{fontSize:12,color:T.textMuted,marginBottom:10,padding:"10px 0",...noEdit}}>Nenhum veículo cadastrado ainda.</div>
            )}
            {(snap.veiculos||[]).map((v,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:10,color:"#60a5fa",textTransform:"uppercase",letterSpacing:"0.1em",...noEdit}}>Veículo {i+1}</div>
                  <button onClick={()=>removerVeiculo(i)} style={{padding:"4px 10px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.2)",borderRadius:7,color:"#ef4444",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Remover</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:10,marginBottom:10}}>
                  <div>
                    <Lbl>Tipo</Lbl>
                    <CustomSelect value={v.tipo} onChange={val=>atualizarVeiculo(i,"tipo",val)} options={TIPOS_VEICULO}/>
                  </div>
                  <div>
                    <Lbl>Marca e modelo</Lbl>
                    <VeiculoPicker
                      value={v.modelo||v.nome||""}
                      onChange={(full, partes) => {
                        const atualizado = (snap.veiculos||[]).map((vv,idx) =>
                          idx===i
                            ? { ...vv, modelo: full, marca: partes?.marca || "", modeloNome: partes?.modelo || "" }
                            : vv
                        );
                        setFSnap("veiculos", atualizado);
                      }}
                      placeholder="Escolher marca e modelo"
                    />
                  </div>
                  <div>
                    <Lbl>Quantidade</Lbl>
                    <input type="number" min="1" max="99" value={v.quantidade||1} onChange={e=>atualizarVeiculo(i,"quantidade",Math.max(1,parseInt(e.target.value)||1))} style={{...C.input,width:"100%"}}/>
                  </div>
                  <div>
                    <Lbl>Valor de mercado (R$)</Lbl>
                    <CustomSelect value={v.faixa} onChange={val=>atualizarVeiculo(i,"faixa",val)} options={FAIXAS_VEICULO.map(f=>f.label)}/>
                  </div>
                </div>
                <div style={{marginBottom:10}}>
                  <Lbl>Tem seguro?</Lbl>
                  <PillChoice
                    value={v.temSeguro===true?"Sim":v.temSeguro===false?"Não":""}
                    allowDeselect={false}
                    onChange={val=>{
                      if(val==="Sim") atualizarVeiculo(i,"temSeguro",true);
                      else if(val==="Não"){const n=(snap.veiculos||[]).map((vv,idx)=>idx===i?{...vv,temSeguro:false,valorSeguro:""}:vv);setFSnap("veiculos",n);}
                    }}
                    options={["Sim","Não"]}
                  />
                </div>
                {v.temSeguro===true&&(
                  <div>
                    <Lbl>Valor do seguro anual</Lbl>
                    <InputMoeda key={`seg-${i}`} initValue={v.valorSeguro} onCommit={val=>atualizarVeiculo(i,"valorSeguro",val)}/>
                  </div>
                )}
              </div>
            ))}
            <button onClick={adicionarVeiculo} style={{padding:"10px 16px",background:"rgba(96,165,250,0.06)",border:"0.5px solid rgba(96,165,250,0.25)",borderRadius:9,color:"#60a5fa",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em"}}>
              + Adicionar veículo
            </button>

            {/* ═══ SEÇÃO 7.5: PROTEÇÃO, SUCESSÃO E PREVIDÊNCIA ═══════════ */}
            <SectionTitle numero={6} total={8} icon="🛡️" subtitle="Blindagem para imprevistos e plano para as próximas gerações.">Proteção, Sucessão e Previdência</SectionTitle>

            <div style={{marginBottom:28,paddingBottom:8}}>
              <Lbl>Possui seguro de vida?</Lbl>
              <div style={{marginTop:8}}/>
              <PillChoice
                value={snap.temSeguroVida===true?"Sim":snap.temSeguroVida===false?"Não":""}
                allowDeselect={false}
                onChange={val=>{
                  if(val==="Sim") setFSnap("temSeguroVida",true);
                  else if(val==="Não"){setFSnap("temSeguroVida",false);setFSnap("valorSeguroVida","");setFSnap("coberturaSeguroVida","");}
                }}
                options={["Sim","Não"]}
              />
            </div>
            {snap.temSeguroVida===true&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:12,marginBottom:16}}>
                <div>
                  <Lbl>Prêmio mensal (R$)</Lbl>
                  <InputMoeda key={`sv-${id}`} initValue={snap.valorSeguroVida} onCommit={v=>setFSnap("valorSeguroVida",v)}/>
                </div>
                <div>
                  <Lbl>Cobertura / Capital segurado (R$)</Lbl>
                  <InputMoeda key={`svc-${id}`} initValue={snap.coberturaSeguroVida} onCommit={v=>setFSnap("coberturaSeguroVida",v)}/>
                </div>
              </div>
            )}

            <div style={{marginBottom:28,paddingBottom:8}}>
              <Lbl>Já possui planejamento sucessório?</Lbl>
              <div style={{fontSize:11,color:T.textMuted,marginBottom:10,marginTop:2,...noEdit}}>VGBL, holding, testamento</div>
              <PillChoice
                value={snap.temPlanoSucessorio===true?"Sim":snap.temPlanoSucessorio===false?"Não":""}
                allowDeselect={false}
                onChange={val=>{
                  if(val==="Sim") setFSnap("temPlanoSucessorio",true);
                  else if(val==="Não") setFSnap("temPlanoSucessorio",false);
                }}
                options={["Sim","Não"]}
              />
            </div>

            <div style={{marginBottom:28,paddingBottom:8}}>
              <Lbl>Possui previdência privada?</Lbl>
              <div style={{fontSize:11,color:T.textMuted,marginBottom:10,marginTop:2,...noEdit}}>VGBL / PGBL</div>
              <PillChoice
                value={snap.temPrevidencia===true?"Sim":snap.temPrevidencia===false?"Não":""}
                allowDeselect={false}
                onChange={val=>{
                  if(val==="Sim") setFSnap("temPrevidencia",true);
                  else if(val==="Não") setFSnap("temPrevidencia",false);
                }}
                options={["Sim","Não"]}
              />
            </div>

            <div style={{marginBottom:28,paddingBottom:8}}>
              <Lbl>Possui plano de saúde?</Lbl>
              <div style={{fontSize:11,color:T.textMuted,marginBottom:10,marginTop:2,...noEdit}}>Cobertura para o titular e dependentes</div>
              <PillChoice
                value={snap.temPlanoSaude===true?"Sim":snap.temPlanoSaude===false?"Não":""}
                allowDeselect={false}
                onChange={val=>{
                  if(val==="Sim") setFSnap("temPlanoSaude",true);
                  else if(val==="Não"){setFSnap("temPlanoSaude",false);setFSnap("valorPlanoSaude","");}
                }}
                options={["Sim","Não"]}
              />
            </div>
            {snap.temPlanoSaude===true&&(
              <div style={{marginBottom:16}}>
                <Lbl>Mensalidade do plano (R$)</Lbl>
                <InputMoeda key={`ps-${id}`} initValue={snap.valorPlanoSaude} onCommit={v=>setFSnap("valorPlanoSaude",v)}/>
              </div>
            )}

            {(snap.objetivosInteresse||[]).includes("viagem")&&(
              <div style={{marginBottom:16}}>
                <Lbl>Próxima viagem já planejada? <span style={{color:T.textMuted,textTransform:"none",letterSpacing:0,fontSize:10}}>(destino e quando)</span></Lbl>
                <InputTexto key={`viag-${id}`} initValue={snap.proximaViagemPlanejada} onCommit={v=>setFSnap("proximaViagemPlanejada",v)} placeholder="Ex: Europa em dez/2026 · ~R$ 40k"/>
              </div>
            )}

            {/* ═══ SEÇÃO 8: MODELO DE ATENDIMENTO E CARTEIRA ════════════ */}
            <SectionTitle numero={7} total={8} icon="🎯" subtitle="Como você é atendido hoje e seu estilo de investidor.">Atendimento e Perfil de Investidor</SectionTitle>

            <div style={{marginBottom:24}}>
              <Lbl>Modelo de atendimento atual</Lbl>
              <div style={{marginTop:8}}/>
              <PillChoice value={snap.modeloAtendimento} onChange={v=>{setFSnap("modeloAtendimento",v);setFSnap("feeBased",v==="Fee Based");}} options={MODELO_ATENDIMENTO}/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:12,marginBottom:24}}>
              <div>
                <Lbl>Rentabilidade anual atual (%)</Lbl>
                <div style={{fontSize:11,color:T.textMuted,marginBottom:8,marginTop:2,...noEdit}}>Estimativa de retorno médio ao ano</div>
                <input type="text" inputMode="decimal" value={snap.rentabilidadeAnual||""} onChange={e=>{
                  const v=e.target.value.replace(/[^\d,.]/g,"").replace(",",".");
                  setFSnap("rentabilidadeAnual",v);
                  setFSnap("rentabilidade",v);
                }} style={{...C.input,fontSize:15}} placeholder="9,5"/>
              </div>
              <div>
                <Lbl>Foco principal dos investimentos</Lbl>
                <div style={{marginTop:10}}/>
                <PillChoice value={snap.focoInvestimento} onChange={v=>setFSnap("focoInvestimento",v)} options={FOCOS_INVESTIMENTO}/>
              </div>
            </div>

            {/* ═══ SEÇÃO 9: OBJETIVOS DE INTERESSE ════════════════════ */}
            <SectionTitle numero={8} total={8} icon="🌟" subtitle="Selecione os objetivos que fazem sentido. Detalhamos cada um na próxima etapa.">Seus Objetivos</SectionTitle>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(170px, 1fr))",gap:10,marginBottom:18}}>
              {OBJETIVOS_CADASTRO.map(obj=>{
                const sel = (snap.objetivosInteresse||[]).includes(obj.id);
                return (
                  <div key={obj.id} onClick={()=>toggleObjetivoInteresse(obj.id)}
                    style={{
                      padding:"14px 12px",borderRadius:12,cursor:"pointer",textAlign:"center",
                      background:sel?"rgba(240,162,2,0.10)":"rgba(255,255,255,0.02)",
                      border:sel?"0.5px solid rgba(240,162,2,0.5)":`0.5px solid ${T.border}`,
                      transition:"all 0.18s",...noEdit,
                    }}>
                    <div style={{fontSize:22,marginBottom:6}}>{obj.icon}</div>
                    <div style={{fontSize:11,color:sel?"#F0A202":T.textSecondary,lineHeight:1.3,fontWeight:sel?500:400}}>{obj.label}</div>
                  </div>
                );
              })}
            </div>
            {(snap.objetivosInteresse||[]).length>0&&id!=="novo"&&(
              <button onClick={()=>navigate(`/cliente/${id}/objetivos`)} style={{padding:"10px 16px",background:"rgba(240,162,2,0.08)",border:"0.5px solid rgba(240,162,2,0.3)",borderRadius:9,color:"#F0A202",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.08em",marginBottom:16}}>
                → Detalhar objetivos selecionados
              </button>
            )}
              </>
            )}

            <button onClick={salvar} disabled={salvando} style={{...C.btnPrimary,marginTop:20}}>
              {salvando?"Salvando...":(id==="novo"?"Cadastrar cliente e gerar diagnóstico":"Salvar alterações")}
            </button>

            {/* "Trocar minha senha" do cliente foi movido para o item 11 da
                sidebar — fica disponível em todas as páginas, não precisa
                duplicar dentro do formulário de Editar Perfil. */}

            {id!=="novo"&&!isCliente&&(
              <div style={{marginTop:40,paddingTop:24,borderTop:`0.5px solid ${T.border}`,textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <div style={{fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:10,fontWeight:600}}>Zona de risco</div>
                <div style={{fontSize:12,color:T.textSecondary,marginBottom:14,lineHeight:1.5,maxWidth:440}}>
                  Excluir este cliente apagará permanentemente todos os dados do cadastro. Esta ação não pode ser desfeita.
                </div>
                <button
                  onClick={()=>{setConfirmExcluirInput("");setModalExcluir(true);}}
                  style={{padding:"11px 22px",background:"rgba(239,68,68,0.08)",border:"0.5px solid rgba(239,68,68,0.4)",borderRadius:9,color:"#ef4444",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.04em",fontWeight:500}}
                >
                  🗑  Excluir cliente
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── VIEW MODE SECTIONS ─────────────────────────────────── */}
        {modo==="ver"&&id!=="novo"&&(
          <>
            {/* Tabs de navegação rápida — visíveis só no mobile (CSS controla) */}
            <div className="cf-sticky-tabs" aria-label="Seções da ficha">
              {[
                {k:"patrimonio", icon:"🏛", label:"Patrimônio"},
                {k:"carteira",   icon:"💼", label:"Carteira"},
                {k:"rendas",     icon:"💰", label:"Rendas"},
                {k:"aportes",    icon:"📅", label:"Aportes"},
                {k:"reserva",    icon:"🛡", label:"Reserva"},
                {k:"dados",      icon:"👤", label:"Dados"},
              ].map(({k,icon,label})=>(
                <button
                  key={k}
                  type="button"
                  className={`cf-sticky-tab${sections[k]?" active":""}`}
                  onClick={()=>openAndScrollTo(k)}
                >
                  <span className="cf-sticky-tab-icon">{icon}</span>
                  <span className="cf-sticky-tab-label">{label}</span>
                </button>
              ))}
            </div>

            {/* ── SEÇÃO: Patrimônio Consolidado ─────────────────────── */}
            <AccordionSection
              sectionId="sec-patrimonio"
              title="Patrimônio Consolidado"
              subtitle={patrimonioDisplay>0?`Visão patrimonial completa · ${moedaFull(patrimonioDisplay)}`:"Cadastre seus bens para visualizar"}
              icon="🏛️"
              isOpen={sections.patrimonio}
              onToggle={()=>toggleSection("patrimonio")}
            >
              <div style={{paddingTop:16}}>
                {(totalCarteira>0||totalImoveis>0||totalVeiculos>0||patrimonioManual>0)?(()=>{
                  const totalGlobal = ["globalEquities","globalTreasury","globalFunds","globalBonds","global"].reduce((acc,k)=>acc+parseCentavos(snap.carteira?.[k])/100,0);
                  const totalNacional = Math.max(totalCarteira - totalGlobal, 0);
                  // Se o cliente não tem carteira detalhada mas declarou um patrimônio
                  // financeiro no cadastro, usamos esse valor no gráfico como
                  // "Invest. (declarado)" para que os gráficos apareçam mesmo assim.
                  const usouDeclarado = totalCarteira===0 && patrimonioManual>0;

                  const cats=[
                    ...(totalNacional>0?[{label:"Invest. Nacional",v:totalNacional,cor:"#F0A202"}]:[]),
                    ...(totalGlobal>0?[{label:"Invest. Global",v:totalGlobal,cor:"#a78bfa"}]:[]),
                    ...(usouDeclarado?[{label:"Invest. (declarado)",v:patrimonioManual,cor:"#F0A202"}]:[]),
                    ...(totalCarteira>0&&totalNacional===0&&totalGlobal===0?[{label:"Investimentos",v:totalCarteira,cor:"#F0A202"}]:[]),
                    {label:"Imóveis",v:totalImoveis,cor:"#22c55e"},
                    {label:"Veículos",v:totalVeiculos,cor:"#60a5fa"},
                  ].filter(x=>x.v>0);

                  const classesAtivas = CLASSES_CARTEIRA.map(c=>({
                    ...c, value:parseCentavos(snap.carteira?.[c.key])/100
                  })).filter(c=>c.value>0);

                  const pizzaBrGlobal = [
                    {label:"🇧🇷 Brasil (R$)",value:totalNacional+totalImoveis+totalVeiculos,cor:"#F0A202"},
                    ...(totalGlobal>0?[{label:"🌎 Global (USD)",value:totalGlobal,cor:"#a78bfa"}]:[]),
                  ].filter(x=>x.value>0);

                  const liquidezD1 = parseCentavos(snap.carteira?.liquidezD1)/100;

                  const panelStyle={background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:14,padding:"16px 14px"};
                  const panelTitle={fontSize:11,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:12,...noEdit};

                  // Row 1 em wide: 3 colunas (Categoria pizza, Brasil vs Global, BarChart)
                  // Sem carteira detalhada: 2 colunas (Categoria pizza + BarChart)
                  const colsTop = totalCarteira>0 ? (isWide?3:(isMobile?1:2)) : (isMobile?1:2);
                  // Row 2 em wide: Rentabilidade (mais larga) + Classes (lateral).
                  // Em telas menores, empilha.
                  const temClasses = totalCarteira>0;
                  // Rentabilidade: PRIORIDADE = rent12m (do PDF, últimos 12 meses) >
                  //                rentAno (do PDF) > rentabilidadeCalculada (ponderada) > rentabilidadeAnual (manual).
                  const rent12mPdf = snap.carteira?.rent12m != null ? Number(snap.carteira.rent12m) : null;
                  const rentAnoPdf = snap.carteira?.rentAno != null ? Number(snap.carteira.rentAno) : null;
                  const rentCalc = parseFloat(String(snap.carteira?.rentabilidadeCalculada||"").replace(",","."));
                  const rentManual = parseFloat(String(snap.rentabilidadeAnual||"").replace(",","."));
                  const rentAnualFicha = rent12mPdf != null ? rent12mPdf
                    : rentAnoPdf != null ? rentAnoPdf
                    : (!isNaN(rentCalc)&&rentCalc>0) ? rentCalc
                    : (!isNaN(rentManual)&&rentManual>0 ? rentManual : null);
                  // Legendas em 2 colunas quando há muitas classes
                  const legendCols = classesAtivas.length>=5 ? 2 : 1;
                  return (
                    <>
                      {/* ── Linha 1: Categoria pizza + Brasil/Global + BarChart ── */}
                      <div style={{display:"grid",gridTemplateColumns:`repeat(${colsTop}, minmax(0, 1fr))`,gap:12,marginBottom:14,alignItems:"stretch"}}>
                        <div style={panelStyle}>
                          <div style={{...panelTitle,textAlign:"center"}}>Patrimônio por Categoria</div>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                            <RingChart data={cats.map(c=>({...c,value:c.v}))} total={patrimonioDisplay} size={160}/>
                            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:5}}>
                              {cats.map(c=><LegendaRow key={c.label} label={c.label} v={c.v} cor={c.cor} total={patrimonioDisplay}/>)}
                            </div>
                          </div>
                        </div>

                        {totalCarteira>0 && (
                          <div style={panelStyle}>
                            <div style={{...panelTitle,textAlign:"center"}}>Brasil vs Global</div>
                            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
                              <RingChart data={pizzaBrGlobal} total={pizzaBrGlobal.reduce((a,x)=>a+x.value,0)} size={160}/>
                              <div style={{width:"100%",display:"flex",flexDirection:"column",gap:5}}>
                                {pizzaBrGlobal.map(c=><LegendaRow key={c.label} label={c.label} v={c.value} cor={c.cor} total={pizzaBrGlobal.reduce((a,x)=>a+x.value,0)}/>)}
                                {totalGlobal===0&&<div style={{fontSize:10,color:T.textMuted,marginTop:4,textAlign:"center",...noEdit}}>Sem investimentos globais cadastrados</div>}
                              </div>
                            </div>
                          </div>
                        )}

                        <div style={panelStyle}>
                          <div style={{...panelTitle,textAlign:"center"}}>Distribuição em Reais</div>
                          <BarChartVertical items={cats}/>
                        </div>
                      </div>

                      {/* ── Linha 2: Rentabilidade vs IPCA + Classes (lado a lado no wide) ── */}
                      <div style={{display:"grid",gridTemplateColumns:(isWide && temClasses)?"minmax(0, 1.8fr) minmax(0, 1fr)":"1fr",gap:12,marginBottom:14,alignItems:"stretch"}}>
                        <RentabilidadeVsIPCA
                          rentAnual={rentAnualFicha}
                          ipcaAnual={ipcaAnual}
                          patrimonio={totalCarteira>0?totalCarteira:patrimonioManual}
                          meses={12}
                        />
                        {temClasses && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={()=>navigate(`/cliente/${id}/carteira`)}
                            onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();navigate(`/cliente/${id}/carteira`);}}}
                            style={{...panelStyle,cursor:"pointer",transition:"all 0.22s ease"}}
                            onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(240,162,2,0.35)";e.currentTarget.style.background="rgba(240,162,2,0.03)";}}
                            onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background="rgba(255,255,255,0.02)";}}
                            title="Abrir carteira de investimentos"
                          >
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                              <div style={{...panelTitle,marginBottom:0}}>Distribuição por Classes</div>
                              <div style={{fontSize:10,color:"#F0A202",letterSpacing:"0.08em",fontWeight:600,...noEdit}}>ABRIR →</div>
                            </div>
                            {classesAtivas.length>0?(
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
                                <RingChart data={classesAtivas} total={totalCarteira} size={150}/>
                                <div style={{width:"100%",display:"grid",gridTemplateColumns:`repeat(${legendCols}, minmax(0, 1fr))`,gap:"4px 10px"}}>
                                  {classesAtivas.map(c=><LegendaRow key={c.key} label={c.label} v={c.value} cor={c.cor} total={totalCarteira}/>)}
                                </div>
                              </div>
                            ):(
                              <div style={{fontSize:11,color:T.textMuted,padding:"8px 0",textAlign:"center",...noEdit}}>
                                Cadastre a carteira para ver as classes.
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ── KPIs da Rentabilidade (full-width, 4 colunas iguais) ── */}
                      <RentabilidadeKPIs
                        rentAnual={rentAnualFicha}
                        ipcaAnual={ipcaAnual}
                        patrimonio={totalCarteira>0?totalCarteira:patrimonioManual}
                        meses={12}
                      />

                      {/* ── Liquidez ── */}
                      {totalCarteira>0&&(
                        <div style={{...panelStyle,marginBottom:12}}>
                          <div style={panelTitle}>Liquidez da Carteira</div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:10}}>
                            <div style={{background:"rgba(34,197,94,0.05)",border:"0.5px solid rgba(34,197,94,0.18)",borderRadius:10,padding:"12px 14px",...noEdit}}>
                              <div style={{fontSize:9,color:"#86efac",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Disponível em 1 dia</div>
                              <div style={{fontSize:15,fontWeight:300,color:"#22c55e"}}>
                                {liquidezD1>0?moedaFull(liquidezD1):"—"}
                              </div>
                              {liquidezD1>0?(
                                <div style={{fontSize:9,color:"#748CAB",marginTop:3}}>{((liquidezD1/totalCarteira)*100).toFixed(0)}% da carteira</div>
                              ):(
                                <div style={{fontSize:9,color:"#748CAB",marginTop:3}}>Cadastre na seção Carteira</div>
                              )}
                            </div>
                            <div style={{background:"rgba(240,162,2,0.05)",border:"0.5px solid rgba(240,162,2,0.18)",borderRadius:10,padding:"12px 14px",...noEdit}}>
                              <div style={{fontSize:9,color:"#fcd34d",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Total Investido</div>
                              <div style={{fontSize:15,fontWeight:300,color:"#F0A202"}}>{moedaFull(totalCarteira)}</div>
                              <div style={{fontSize:9,color:"#748CAB",marginTop:3}}>Carteira completa</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Patrimônio Financeiro ── */}
                      {(()=>{
                        const patFin=totalCarteira>0?totalCarteira:patrimonioManual;
                        return patFin>0?(
                          <div style={{marginBottom:8}}>
                            <div style={{fontSize:9,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6,...noEdit}}>Patrimônio Financeiro</div>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"rgba(240,162,2,0.05)",border:"0.5px solid rgba(240,162,2,0.18)",borderRadius:10,marginBottom:6,...noEdit}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:36,height:36,borderRadius:9,background:"rgba(240,162,2,0.08)",border:"0.5px solid rgba(240,162,2,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>📊</div>
                                <div>
                                  <div style={{fontSize:13,color:"#e2e8f0",fontWeight:400}}>Carteira de Investimentos</div>
                                  <div style={{fontSize:10,color:"#748CAB",marginTop:2}}>{totalCarteira>0?"Declarado na carteira":"Informado no cadastro"}</div>
                                </div>
                              </div>
                              <span style={{fontSize:13,color:"#F0A202",fontWeight:400}}>{moedaFull(patFin)}</span>
                            </div>
                          </div>
                        ):null;
                      })()}

                      {/* ── Bens Cadastrados ── */}
                      {((snap.imoveis||[]).length>0||(snap.veiculos||[]).length>0||totalVeiculosLegacy>0)&&(
                        <div style={{fontSize:9,color:"#748CAB",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6,...noEdit}}>Bens Cadastrados</div>
                      )}

                      {/* Imóveis */}
                      {(snap.imoveis||[]).map((im,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"rgba(34,197,94,0.05)",border:"0.5px solid rgba(34,197,94,0.14)",borderRadius:10,marginBottom:6,...noEdit}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:36,height:36,borderRadius:9,background:"rgba(34,197,94,0.08)",border:"0.5px solid rgba(34,197,94,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🏠</div>
                            <div>
                              <div style={{fontSize:13,color:"#e2e8f0",fontWeight:400}}>{im.nome||im.tipo}</div>
                              <div style={{fontSize:10,color:"#748CAB",marginTop:2}}>{im.tipo}{parseInt(im.quantidade)>1?` · ${im.quantidade}x`:""} · Imóvel</div>
                            </div>
                          </div>
                          <span style={{fontSize:13,color:"#22c55e",fontWeight:400}}>{im.faixa}</span>
                        </div>
                      ))}

                      {/* Veículos (array) */}
                      {(snap.veiculos||[]).map((v,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"rgba(96,165,250,0.05)",border:"0.5px solid rgba(96,165,250,0.14)",borderRadius:10,marginBottom:6,...noEdit}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:36,height:36,borderRadius:9,background:"rgba(96,165,250,0.08)",border:"0.5px solid rgba(96,165,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🚗</div>
                            <div>
                              <div style={{fontSize:13,color:"#e2e8f0",fontWeight:400}}>{v.nome||v.tipo}</div>
                              <div style={{fontSize:10,color:"#748CAB",marginTop:2}}>{v.tipo}{parseInt(v.quantidade)>1?` · ${v.quantidade}x`:""} · Veículo</div>
                            </div>
                          </div>
                          <span style={{fontSize:13,color:"#60a5fa",fontWeight:400}}>{v.faixa}</span>
                        </div>
                      ))}

                      {/* Veículos legado (campo único antigo) */}
                      {totalVeiculosLegacy>0&&(snap.veiculos||[]).length===0&&(
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"rgba(96,165,250,0.05)",border:"0.5px solid rgba(96,165,250,0.14)",borderRadius:10,marginBottom:6,...noEdit}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:36,height:36,borderRadius:9,background:"rgba(96,165,250,0.08)",border:"0.5px solid rgba(96,165,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🚗</div>
                            <div>
                              <div style={{fontSize:13,color:"#e2e8f0",fontWeight:400}}>Veículos</div>
                              <div style={{fontSize:10,color:"#748CAB",marginTop:2}}>Frota declarada</div>
                            </div>
                          </div>
                          <span style={{fontSize:13,color:"#60a5fa",fontWeight:400}}>{formatMi(totalVeiculosLegacy)}</span>
                        </div>
                      )}
                    </>
                  );
                })():(
                  <div style={{fontSize:12,color:T.textMuted,padding:"12px 0 4px",...noEdit}}>
                    Nenhum dado patrimonial cadastrado ainda.{" "}
                    <span style={{color:"#F0A202",cursor:"pointer"}} onClick={()=>setModo("editar")}>Editar perfil →</span>
                  </div>
                )}
              </div>
            </AccordionSection>

            {/* ── SEÇÃO: Carteira de Investimentos ───────────────────
                Cliente final: já tem a página /cliente/:id/carteira na sidebar
                e o donut na própria home, então o accordion duplicado é só ruído.
                Mantemos pro assessor, que usa pra atendimento sem trocar de tela. */}
            {!isCliente && (
            <AccordionSection
              sectionId="sec-carteira"
              title="Carteira de Investimentos"
              subtitle={totalCarteira>0?`Total investido · ${formatMi(totalCarteira)}`:"Resumo da carteira (ir para carteira completa)"}
              icon="📈"
              isOpen={sections.carteira}
              onToggle={()=>toggleSection("carteira")}
            >
              <div style={{paddingTop:16}}>
                {totalCarteira>0?(()=>{
                  const classesAtivas=CLASSES_CARTEIRA.map(c=>({
                    ...c, value:parseCentavos(snap.carteira?.[c.key])/100
                  })).filter(c=>c.value>0);
                  return (
                    <>
                      {/* Título do gráfico */}
                      <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:14,...noEdit}}>
                        Distribuição em Percentual (%)
                      </div>

                      {/* Donut + Legenda lado a lado */}
                      <div style={{display:"flex",gap:18,alignItems:"center",marginBottom:20,flexWrap:"wrap"}}>
                        {/* Donut grande */}
                        <div style={{flexShrink:0}}>
                          <DonutChartModern
                            data={classesAtivas.map(c => ({
                              key: c.key,
                              label: c.label,
                              cor: c.cor,
                              valor: c.value,
                            }))}
                            total={totalCarteira}
                            size={200}
                            thickness={36}
                            labelCentro="INVESTIMENTO"
                            formatValor={formatMi}
                          />
                        </div>

                        {/* Legenda com barra de progresso por classe */}
                        <div style={{flex:1,minWidth:150}}>
                          {classesAtivas.map(c=>{
                            const pct=((c.value/totalCarteira)*100);
                            return (
                              <div key={c.key} style={{marginBottom:11,...noEdit}}>
                                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                                    <div style={{width:8,height:8,borderRadius:2,background:c.cor,flexShrink:0}}/>
                                    <span style={{fontSize:11,color:T.textSecondary}}>{c.label}</span>
                                  </div>
                                  <div style={{display:"flex",gap:6}}>
                                    <span style={{fontSize:10,fontWeight:500,color:c.cor}}>{pct.toFixed(0)}%</span>
                                  </div>
                                </div>
                                {/* Mini progress bar */}
                                <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
                                  <div style={{height:"100%",width:`${pct}%`,background:c.cor,borderRadius:2}}/>
                                </div>
                              </div>
                            );
                          })}
                          {snap.carteira?.atualizadoEm&&(
                            <div style={{fontSize:9,color:T.textMuted,marginTop:10,...noEdit}}>
                              Atualizado: {snap.carteira.atualizadoEm}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Tabela resumo das classes */}
                      <div style={{background:"rgba(255,255,255,0.02)",border:`0.5px solid ${T.border}`,borderRadius:12,overflow:"hidden",marginBottom:4}}>
                        {classesAtivas.map((c,i)=>(
                          <div key={c.key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 14px",borderBottom:i<classesAtivas.length-1?`0.5px solid ${T.border}`:"none",...noEdit}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <div style={{width:3,height:24,borderRadius:2,background:c.cor,flexShrink:0}}/>
                              <span style={{fontSize:12,color:T.textSecondary}}>{c.label}</span>
                            </div>
                            <div style={{display:"flex",gap:16,alignItems:"center"}}>
                              <span style={{fontSize:11,color:T.textMuted}}>{((c.value/totalCarteira)*100).toFixed(0)}%</span>
                              <span style={{fontSize:13,fontWeight:300,color:c.cor,minWidth:70,textAlign:"right"}}>{formatMi(c.value)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })():(
                  <div style={{fontSize:12,color:T.textMuted,padding:"12px 0",...noEdit}}>
                    Carteira não cadastrada ainda.{" "}
                    <span style={{color:"#F0A202",cursor:"pointer"}} onClick={()=>navigate(`/cliente/${id}/carteira`)}>Cadastrar →</span>
                  </div>
                )}
                <button onClick={()=>navigate(`/cliente/${id}/carteira`)} style={{width:"100%",marginTop:14,padding:"11px",background:"rgba(240,162,2,0.05)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:10,color:"#F0A202",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em",...noEdit}}>
                  Abrir carteira completa →
                </button>
              </div>
            </AccordionSection>
            )}

            {/* ── SEÇÃO: Rendas & Despesas ───────────────────────────
                Cliente final: tem a página /cliente/:id/fluxo dedicada na sidebar.
                O accordion repete o mesmo conteúdo, então escondemos pra ele. */}
            {!isCliente && (
            <AccordionSection
              sectionId="sec-rendas"
              title="Rendas e Despesas"
              subtitle="Fluxo de caixa mensal e anual"
              icon="💰"
              isOpen={sections.rendas}
              onToggle={()=>toggleSection("rendas")}
            >
              <div style={{paddingTop:16}}>
                {/* Cards Rendas / Despesas */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:10,marginBottom:16}}>
                  {/* RENDAS */}
                  <div style={{background:"rgba(34,197,94,0.05)",border:"0.5px solid rgba(34,197,94,0.22)",borderRadius:14,padding:"16px 14px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
                          <circle cx="12" cy="12" r="11" fill="rgba(34,197,94,0.15)"/>
                          <text x="8" y="16" fontSize="11" fill="#22c55e" fontFamily={T.fontFamily} fontWeight="600">$</text>
                          <path d="M17 7l-4 4m0 0l-4-4m4 4V3" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" transform="translate(2,3) scale(0.6)"/>
                        </svg>
                        <span style={{fontSize:11,fontWeight:700,color:"#22c55e",letterSpacing:"0.1em",...noEdit}}>RENDAS</span>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:8}}>
                      <div>
                        <div style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,...noEdit}}>Renda Mensal</div>
                        <div style={{fontSize:15,fontWeight:300,color:T.textPrimary,...noEdit}}>{rendaMensal>0?formatMi(rendaMensal):"—"}</div>
                      </div>
                      <div>
                        <div style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,...noEdit}}>Renda Anual</div>
                        <div style={{fontSize:15,fontWeight:300,color:T.textPrimary,...noEdit}}>{rendaMensal>0?formatMi(rendaMensal*12):"—"}</div>
                      </div>
                    </div>
                  </div>
                  {/* DESPESAS */}
                  <div style={{background:"rgba(239,68,68,0.05)",border:"0.5px solid rgba(239,68,68,0.22)",borderRadius:14,padding:"16px 14px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
                          <circle cx="12" cy="12" r="11" fill="rgba(239,68,68,0.15)"/>
                          <text x="8" y="16" fontSize="11" fill="#ef4444" fontFamily={T.fontFamily} fontWeight="600">$</text>
                          <path d="M7 17l4-4m0 0l4 4m-4-4v8" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" transform="translate(2,-2) scale(0.6)"/>
                        </svg>
                        <span style={{fontSize:11,fontWeight:700,color:"#ef4444",letterSpacing:"0.1em",...noEdit}}>DESPESAS</span>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:8}}>
                      <div>
                        <div style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,...noEdit}}>Desp. Mensal</div>
                        <div style={{fontSize:15,fontWeight:300,color:T.textPrimary,...noEdit}}>{gastosMensaisEfetivo>0?formatMi(gastosMensaisEfetivo):"—"}</div>
                      </div>
                      <div>
                        <div style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,...noEdit}}>Desp. Anual</div>
                        <div style={{fontSize:15,fontWeight:300,color:T.textPrimary,...noEdit}}>{gastosMensaisEfetivo>0?formatMi(gastosMensaisEfetivo*12):"—"}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sobra e meta */}
                {rendaMensal>0&&gastosMensaisEfetivo>0&&(
                  <div className="cf-grid-3col" style={{display:"grid",gap:8,marginBottom:16}}>
                    {[
                      {l:"Sobra mensal",v:rendaMensal-gastosMensaisEfetivo,cor:"#60a5fa"},
                      {l:"Meta de aporte/mês",v:parseCentavos(snap.metaAporteMensal)/100,cor:"#22c55e"},
                      {l:"Aportado este mês",v:aporteRegistradoVal,cor:aporteRegistradoVal>0?"#22c55e":"#f59e0b"},
                    ].map(k=>(
                      <div key={k.l} style={{background:"rgba(255,255,255,0.025)",borderRadius:10,padding:"12px",textAlign:"center",...noEdit}}>
                        <div style={{fontSize:8,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>{k.l}</div>
                        <div style={{fontSize:14,fontWeight:300,color:k.v>0?k.cor:T.textMuted}}>{k.v>0?formatMi(k.v):"—"}</div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={()=>navigate(`/cliente/${id}/fluxo`)} style={{width:"100%",padding:"11px",background:"rgba(240,162,2,0.05)",border:"0.5px solid rgba(240,162,2,0.2)",borderRadius:10,color:"#F0A202",fontSize:11,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em",...noEdit}}>
                  Ver detalhamento mensal completo →
                </button>
              </div>
            </AccordionSection>
            )}

            {/* ── SEÇÃO: Mapa de Aportes ────────────────────────────── */}
            <AccordionSection
              sectionId="sec-aportes"
              title="Mapa de Aportes"
              subtitle="Histórico de movimentações mensais"
              icon="📅"
              isOpen={sections.aportes}
              onToggle={()=>toggleSection("aportes")}
              badge={snap.statusAporteMes==="aportou"?"Aportou ✓":snap.statusAporteMes==="nao_aportou"?"Sem aporte":undefined}
              badgeColor={snap.statusAporteMes==="aportou"?"#22c55e":"#f59e0b"}
            >
              <div style={{paddingTop:16}}>
                {/* Calendar */}
                {(()=>{
                  const meses=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
                  const hist=snap.carteiraHistorico||[];
                  const metaCentavos=parseCentavos(snap.metaAporteMensal);
                  const mesAtual=hoje.getMonth();
                  return(
                    <>
                      <div className="cf-meses-6col" style={{display:"grid",gap:6,marginBottom:16}}>
                        {meses.map((mes,i)=>{
                          const mov=hist.find(m=>m.mes===i+1);
                          let bg="rgba(107,127,163,0.12)",cor=T.textMuted,tipo=null;
                          if(mov){
                            if(mov.tipo==="resgate"){bg="rgba(239,68,68,0.18)";cor="#ef4444";tipo="resgate";}
                            else if(mov.tipo==="aporte"){
                              const a=parseCentavos(mov.valor);
                              if(a>=metaCentavos&&metaCentavos>0){bg="rgba(34,197,94,0.18)";cor="#22c55e";tipo="aporte_ok";}
                              else{bg="rgba(245,158,11,0.18)";cor="#f59e0b";tipo="aporte_baixo";}
                            }
                          }
                          const isCurrent=i===mesAtual;
                          return(
                            <div key={mes} onClick={()=>mov&&setMesDetalhes({mes:i,movimento:mov})} style={{display:"flex",flexDirection:"column",alignItems:"center",cursor:mov?"pointer":"default",...noEdit}}>
                              <div style={{
                                width:"100%",aspectRatio:"1",borderRadius:10,
                                background:bg,
                                border:isCurrent?`1.5px solid ${cor}`:`0.5px solid ${cor}30`,
                                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                                gap:3,padding:"4px 2px",boxSizing:"border-box",
                                transition:"all 0.15s",
                              }}>
                                <span style={{fontSize:11,fontWeight:isCurrent?600:400,color:mov?cor:T.textMuted}}>{mes}</span>
                                {tipo==="aporte_ok"&&<span style={{fontSize:8,color:cor}}>↑</span>}
                                {tipo==="aporte_baixo"&&<span style={{fontSize:8,color:cor}}>↑</span>}
                                {tipo==="resgate"&&<span style={{fontSize:8,color:cor}}>↓</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Legend */}
                      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:18}}>
                        {[["#22c55e","Aporte OK"],["#f59e0b","Abaixo da meta"],["#ef4444","Resgate"],["rgba(107,127,163,0.5)","Sem movimento"]].map(([c,l])=>(
                          <div key={l} style={{display:"flex",alignItems:"center",gap:5,...noEdit}}>
                            <div style={{width:10,height:10,borderRadius:3,background:c}}/>
                            <span style={{fontSize:10,color:T.textSecondary}}>{l}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}

                {/* CRM Buttons. Apenas assessor: cliente não classifica próprio aporte. */}
                {!isCliente && (
                  <>
                <div style={{fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10,...noEdit}}>Status de aporte – {hoje.toLocaleString("pt-BR",{month:"long",year:"numeric"})}</div>
                <div style={{display:"flex",gap:8,marginBottom:16}}>
                  <button
                    onClick={handleAportou}
                    style={{
                      flex:1,padding:"12px 8px",
                      background:snap.statusAporteMes==="aportou"?"rgba(34,197,94,0.12)":"rgba(255,255,255,0.03)",
                      border:`0.5px solid ${snap.statusAporteMes==="aportou"?"rgba(34,197,94,0.5)":"rgba(255,255,255,0.08)"}`,
                      borderRadius:10,color:snap.statusAporteMes==="aportou"?"#22c55e":"#748CAB",
                      fontSize:13,cursor:"pointer",fontFamily:"inherit",
                    }}>
                    ✓ Aportou
                  </button>
                  <button
                    onClick={handleNaoAportou}
                    style={{
                      flex:1,padding:"12px 8px",
                      background:snap.statusAporteMes==="nao_aportou"?"rgba(239,68,68,0.12)":"rgba(255,255,255,0.03)",
                      border:`0.5px solid ${snap.statusAporteMes==="nao_aportou"?"rgba(239,68,68,0.5)":"rgba(255,255,255,0.08)"}`,
                      borderRadius:10,color:snap.statusAporteMes==="nao_aportou"?"#ef4444":"#748CAB",
                      fontSize:13,cursor:"pointer",fontFamily:"inherit",
                    }}>
                    ✗ Não aportou
                  </button>
                </div>

                {snap.statusAporteMes==="aportou"&&aporteRegistradoVal>0&&(
                  <div style={{background:"rgba(34,197,94,0.06)",border:"0.5px solid rgba(34,197,94,0.2)",borderRadius:10,padding:"11px 14px",fontSize:12,color:"#22c55e",marginBottom:14,...noEdit}}>
                    Aporte registrado: <b>{aporteRegistradoVal.toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2})}</b>
                  </div>
                )}
                  </>
                )}

                {/* Atalhos para o histórico completo de aportes (Extrato filtrado). */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:10,marginBottom:14}}>
                  <button
                    onClick={()=>navigate(`/cliente/${id}/extrato?tipo=aporte`)}
                    style={{padding:"12px",background:"linear-gradient(135deg,rgba(168,85,247,0.10),rgba(168,85,247,0.03))",border:"0.5px solid rgba(168,85,247,0.32)",borderRadius:10,color:"#a855f7",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.04em",fontWeight:600}}
                    onMouseEnter={e=>{e.currentTarget.style.filter="brightness(1.12)";}}
                    onMouseLeave={e=>{e.currentTarget.style.filter="brightness(1)";}}
                  >
                    📜 Histórico de aportes →
                  </button>
                  <button
                    onClick={()=>navigate(`/cliente/${id}/extrato?view=historico`)}
                    style={{padding:"12px",background:"linear-gradient(135deg,rgba(96,165,250,0.10),rgba(96,165,250,0.03))",border:"0.5px solid rgba(96,165,250,0.32)",borderRadius:10,color:"#60a5fa",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.04em",fontWeight:600}}
                    onMouseEnter={e=>{e.currentTarget.style.filter="brightness(1.12)";}}
                    onMouseLeave={e=>{e.currentTarget.style.filter="brightness(1)";}}
                  >
                    📆 Extrato completo →
                  </button>
                </div>

                {/* Próximo contato e Anotação. CRM do assessor: oculto para o cliente. */}
                {!isCliente && (
                  <>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,...noEdit}}>Próximo contato</div>
                  <div style={{display:"flex",alignItems:"center",height:44,background:"rgba(255,255,255,0.03)",border:`0.5px solid ${T.border}`,borderRadius:10,padding:"0 14px",boxSizing:"border-box"}}>
                    <input
                      type="text"
                      placeholder="DD/MM/AAAA"
                      value={snap.nextContactDate||""}
                      onChange={e=>setFSnap("nextContactDate",e.target.value)}
                      style={{background:"transparent",border:"none",outline:"none",color:T.textPrimary,fontSize:13,fontFamily:"inherit",width:"100%"}}
                    />
                  </div>
                </div>

                <div>
                  <div style={{fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,...noEdit}}>Anotação / Follow-up</div>
                  <TextareaLocal
                    key={`notes-${id}`}
                    initValue={snap.notes||""}
                    onCommit={v=>setF("notes",v)}
                    placeholder='Ex: "Cliente vai aportar dia 15. Confirmar na próxima semana."'
                  />
                  <button
                    onClick={async()=>{
                      try{
                        await setDoc(
                          doc(db,"clientes",id),
                          stripUndefined({
                            notes: formRef.current.notes,
                            nextContactDate: formRef.current.nextContactDate,
                          }),
                          { merge: true }
                        );
                        setMsg("Anotação salva.");
                      }catch(e){setMsg("Erro: "+e.message);}
                    }}
                    style={{marginTop:8,padding:"9px 16px",background:"rgba(255,255,255,0.04)",border:`0.5px solid ${T.border}`,borderRadius:9,color:T.textSecondary,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}
                  >
                    Salvar anotação
                  </button>
                </div>
                  </>
                )}
              </div>
            </AccordionSection>

            {/* ── SEÇÃO: Reserva de Emergência ──────────────────────── */}
            {(()=>{
              // Usa o mesmo cálculo do card superior: ativos com objetivo "Liquidez"
              // quando a carteira tem ativos individuais; senão, cai no legado.
              const liquidez = liquidezReserva;
              const pctAtingido = reservaMeta>0 ? Math.min((liquidez/reservaMeta)*100,100) : 0;
              const statusReserva = liquidez>=reservaMeta&&reservaMeta>0
                ? {label:"🏆 Reserva Completa",desc:"Sua reserva cobre os 6 meses necessários. Parabéns!",cor:"#22c55e",bg:"rgba(34,197,94,0.07)",border:"rgba(34,197,94,0.25)"}
                : liquidez>=reservaMeta*0.6&&reservaMeta>0
                ? {label:"⚡ Em Construção",desc:"Mais da metade conquistada. Continue aportando na reserva.",cor:"#f59e0b",bg:"rgba(245,158,11,0.07)",border:"rgba(245,158,11,0.25)"}
                : liquidez>0&&reservaMeta>0
                ? {label:"⚠ Fortalecer Reserva",desc:"Priorize aportes em renda fixa pós-fixada para formar a reserva.",cor:"#ef4444",bg:"rgba(239,68,68,0.07)",border:"rgba(239,68,68,0.25)"}
                : {label:"— Dados insuficientes",desc:"Preencha carteira e despesas mensais para calcular.",cor:T.textMuted,bg:"rgba(255,255,255,0.02)",border:T.border};
              return (
                <AccordionSection
                  sectionId="sec-reserva"
                  title="Reserva de Emergência"
                  subtitle={reservaMeta>0?`Meta: ${formatMi(reservaMeta)} · 6 meses de despesas`:"Preencha as despesas mensais"}
                  icon="🛡️"
                  isOpen={sections.reserva}
                  onToggle={()=>toggleSection("reserva")}
                  badge={reservaMeta>0?statusReserva.label.split(" ").slice(1).join(" "):undefined}
                  badgeColor={statusReserva.cor}
                >
                  <div style={{paddingTop:16}}>
                    {reservaMeta>0?(
                      <>
                        {/* Card de status principal */}
                        <div style={{background:statusReserva.bg,border:`0.5px solid ${statusReserva.border}`,borderRadius:14,padding:"18px 20px",marginBottom:16}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
                            <div>
                              <div style={{fontSize:16,fontWeight:500,color:statusReserva.cor,marginBottom:4,...noEdit}}>{statusReserva.label}</div>
                              <div style={{fontSize:11,color:T.textSecondary,lineHeight:1.5,maxWidth:340,...noEdit}}>{statusReserva.desc}</div>
                            </div>
                            <div style={{textAlign:"right",...noEdit}}>
                              <div style={{fontSize:10,color:T.textMuted,marginBottom:2}}>Meta</div>
                              <div style={{fontSize:20,fontWeight:300,color:T.textPrimary}}>{formatMi(reservaMeta)}</div>
                            </div>
                          </div>

                          {/* Barra de progresso */}
                          {liquidez>0&&(
                            <div style={{marginTop:14}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                                <span style={{fontSize:10,color:T.textMuted,...noEdit}}>Ativos com objetivo Liquidez</span>
                                <span style={{fontSize:10,color:statusReserva.cor,...noEdit}}>{pctAtingido.toFixed(0)}%</span>
                              </div>
                              <div style={{height:6,background:"rgba(255,255,255,0.07)",borderRadius:3,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${pctAtingido}%`,background:statusReserva.cor,borderRadius:3,transition:"width 0.6s ease"}}/>
                              </div>
                              <div style={{fontSize:10,color:T.textMuted,marginTop:4,...noEdit}}>
                                {formatMi(liquidez)} de {formatMi(reservaMeta)} formados
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Cards 1 / 3 / 6 meses */}
                        <div className="cf-reserva-3col" style={{display:"grid",gap:8,marginBottom:12}}>
                          {[1,3,6].map(m=>(
                            <div key={m} style={{background:"rgba(255,255,255,0.025)",borderRadius:10,padding:"12px",textAlign:"center",...noEdit}}>
                              <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>{m} {m===1?"mês":"meses"}</div>
                              <div style={{fontSize:13,fontWeight:300,color:m===6?"#a855f7":T.textSecondary}}>{formatMi(gastosMensaisEfetivo*m)}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{fontSize:11,color:T.textMuted,lineHeight:1.6,...noEdit}}>
                          💡 Mantenha essa reserva em investimentos que você saca no mesmo dia, com baixo risco.
                        </div>
                      </>
                    ):(
                      <div style={{fontSize:12,color:T.textMuted,padding:"12px 0",...noEdit}}>
                        Preencha as despesas no{" "}
                        <span style={{color:"#F0A202",cursor:"pointer"}} onClick={()=>navigate(`/cliente/${id}/fluxo`)}>Fluxo Mensal</span>{" "}
                        para calcular a reserva de emergência.
                      </div>
                    )}
                  </div>
                </AccordionSection>
              );
            })()}

            {/* ── SEÇÃO: Dados Pessoais ─────────────────────────────── */}
            <AccordionSection
              sectionId="sec-dados"
              title="Dados Pessoais"
              subtitle="Cadastro e informações do cliente"
              icon="👤"
              isOpen={sections.dados}
              onToggle={()=>toggleSection("dados")}
            >
              <div style={{paddingTop:16,display:"grid",gridTemplateColumns:"repeat(2, minmax(0, 1fr))",gap:12}}>
                {[
                  {l:"E-mail",v:snap.email},
                  {l:"Telefone",v:snap.telefone},
                  {l:"Estado",v:snap.uf},
                  {l:"Profissão",v:snap.profissao},
                  {l:"Nascimento",v:snap.nascimento?(snap.nascimento+(idade?` (${idade} anos)`:"")):null},
                  {l:"Hobby",v:snap.hobby},
                  {l:"Código do cliente",v:snap.codigo},
                  {l:"Cliente desde",v:snap.desde},
                ].map(f=>(
                  <div key={f.l}>
                    <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,...noEdit}}>{f.l}</div>
                    <div style={{fontSize:13,color:T.textSecondary,padding:"6px 0",borderBottom:`0.5px solid ${T.border}`,...noEdit}}>{f.v||"—"}</div>
                  </div>
                ))}
                <div style={{gridColumn:"1/-1",display:"flex",flexDirection:"column",alignItems:"center",paddingTop:8}}>
                  <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,...noEdit}}>Segmento</div>
                  <span style={{fontSize:13,color:"#F0A202",padding:"5px 20px",borderRadius:20,background:"rgba(240,162,2,0.08)",border:"0.5px solid rgba(240,162,2,0.2)",...noEdit}}>{segmento||"—"}</span>
                </div>
                {/* Botão Editar perfil — dentro da própria seção de Dados Pessoais. */}
                <div style={{gridColumn:"1/-1",marginTop:10}}>
                  <button
                    onClick={()=>setModo("editar")}
                    style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,rgba(240,162,2,0.12),rgba(240,162,2,0.04))",border:"0.5px solid rgba(240,162,2,0.38)",borderRadius:11,color:"#F0A202",fontSize:12,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.06em",fontWeight:600,textTransform:"uppercase"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="linear-gradient(135deg,rgba(240,162,2,0.2),rgba(240,162,2,0.06))";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="linear-gradient(135deg,rgba(240,162,2,0.12),rgba(240,162,2,0.04))";}}
                  >
                    ✏️ Editar perfil completo →
                  </button>
                </div>
              </div>
            </AccordionSection>
          </>
        )}
      </div>
    </div>
    </>
  );
}
