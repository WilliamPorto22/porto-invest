import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
// GSAP (~68KB) carregado sob demanda apenas para a animação de entrada dos cards.
// Reduz bundle inicial do Dashboard e não bloqueia o primeiro paint.
let _gsap = null;
const loadGsap = () => _gsap ?? (_gsap = import("gsap").then(m => m.default));
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { obterTodasAsCotacoes, mercadoAberto, INTERVALO_ATUALIZACAO, HORARIO_MERCADO } from "../services/cotacoesReais";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import HistoricoMensalChart from "../components/HistoricoMensalChart";
import { listarSnapshots } from "../services/snapshotsCarteira";
import { brl as brlUtil } from "../utils/currency";
import { useAuth } from "../hooks/useAuth";


// Cotações padrão (atualizadas a cada 2 horas durante horário de mercado)
const MERCADO_PADRAO=[
  {label:"Dólar",    valor:"R$ 5,08",  sub:"-1,0% hoje",  cor:"#ef4444"},
  {label:"Selic",    valor:"14,75%",   sub:"a.a.",         cor:"#6b7280"},
  {label:"IPCA",     valor:"4,14%",    sub:"12 meses",     cor:"#6b7280"},
  {label:"Ibovespa", valor:"197.000",  sub:"+21% no ano",  cor:"#22c55e"},
  {label:"S&P 500",  valor:"5.396",    sub:"+10% no ano",  cor:"#22c55e"},
];

const SEGS=["Digital","Ascensão","Exclusive","Private"];
const SEG_COLORS={
  "Digital":   {color:"#748CAB", bg:"rgba(116,140,171,0.10)", border:"rgba(116,140,171,0.25)"},
  "Ascensão":  {color:"#5B9BD5", bg:"rgba(91,155,213,0.10)",  border:"rgba(91,155,213,0.25)"},
  "Exclusive": {color:"#F0A202", bg:"rgba(240,162,2,0.10)",   border:"rgba(240,162,2,0.28)"},
  "Private":   {color:"#9E86C8", bg:"rgba(158,134,200,0.10)", border:"rgba(158,134,200,0.25)"},
};
// Removido: user-select para evitar cursor piscante não profissional
const BG="#0D1321", CARD="#1D2D44", BD="rgba(62,92,118,0.35)";

function segAuto(v){
  if(v<150000)return"Digital";
  if(v<500000)return"Ascensão";
  if(v<1000000)return"Exclusive";
  return"Private";
}
// Wrapper fino sobre utils/currency — preserva assinatura antiga desta tela.
function brlNum(n){ return brlUtil(n); }
const CART_KEYS=["posFixado","ipca","preFixado","acoes","fiis","multi","prevVGBL","prevPGBL","globalEquities","globalTreasury","globalFunds","globalBonds","global","outros"];
// Soma total do patrimônio financeiro. Carteira é fonte da verdade quando tem
// ativos; se estiver vazia, cai no patrimônio manual do cadastro (permite
// atualização direta pelo perfil do cliente mesmo após a carteira ter sido usada).
function getPatFin(c){
  const carteira=c.carteira||{};
  const t=CART_KEYS.reduce((s,k)=>{
    const ativos=carteira[k+"Ativos"];
    if(Array.isArray(ativos)){
      return s+ativos.reduce((a,at)=>a+parseInt(String(at.valor||"0").replace(/\D/g,""))/100,0);
    }
    return s+parseInt(String(carteira[k]||"0").replace(/\D/g,""))/100;
  },0);
  if(t>0)return t;
  return parseInt(String(c.patrimonio||"0").replace(/\D/g,""))/100;
}

// Calcula patrimônio financeiro total (usa mesma lógica dos cards individuais)
function calcularPatrimonioTotal(clientes){
  return clientes.reduce((total,c)=>total+getPatFin(c),0);
}


// ── Lógica CRM ───────────────────────────────────────────────

// Aporte: 3 estados — aportou / parcial / sem_aporte
function statusAporte(c){
  if(c.statusAporteMes==="nao_aportou")return"sem_aporte";
  if(c.statusAporteMes==="aportou"){
    const meta=parseInt(String(c.metaAporteMensal||"0").replace(/\D/g,""))/100;
    const reg=parseInt(String(c.aporteRegistradoMes||"0").replace(/\D/g,""))/100;
    if(meta>0&&reg>0&&reg<meta)return"parcial";
    return"aportou";
  }
  if(!c.lastAporteDate)return"sem_aporte";
  try{
    const d=c.lastAporteDate.toDate?c.lastAporteDate.toDate():new Date(c.lastAporteDate);
    const hoje=new Date();
    if(d.getMonth()===hoje.getMonth()&&d.getFullYear()===hoje.getFullYear())return"aportou";
  }catch{/* data inválida — cai no sem_aporte abaixo */}
  return"sem_aporte";
}

// Reserva de emergência
// Quando a carteira tem ativos individuais, só soma os explicitamente marcados
// com objetivo "Liquidez". Sem ativos → cai no legado (liquidezD1/posFixado).
function statusReserva(c){
  const gastos=parseInt(String(c.gastosMensaisManual||"0").replace(/\D/g,""))/100;
  const meta=gastos*6;
  if(!meta)return null;
  const carteira=c.carteira||{};
  const engaged=CART_KEYS.some(k=>Array.isArray(carteira[k+"Ativos"]));
  let liquidez;
  if(engaged){
    liquidez=CART_KEYS.reduce((acc,k)=>{
      const ativos=carteira[k+"Ativos"];
      if(Array.isArray(ativos)){
        return acc+ativos.reduce((a,at)=>a+((at.objetivo||"")==="Liquidez"?parseInt(String(at.valor||"0").replace(/\D/g,""))/100:0),0);
      }
      return acc;
    },0);
  }else{
    liquidez=parseInt(String(carteira.liquidezD1||"0").replace(/\D/g,""))/100
           ||parseInt(String(carteira.posFixado||"0").replace(/\D/g,""))/100;
  }
  if(liquidez<=0)return"sem";
  return liquidez>=meta?"ok":"sem";
}

// Revisão: obrigatória todo mês até dia 15
function statusRevisao(c){
  const hoje=new Date();
  if(!c.lastReviewDate)return"atrasada";
  try{
    const r=c.lastReviewDate.toDate?c.lastReviewDate.toDate():new Date(c.lastReviewDate);
    // Mesmo mês = ok
    if(r.getMonth()===hoje.getMonth()&&r.getFullYear()===hoje.getFullYear())return"ok";
    // Mês diferente — se já passou dia 15, atrasado
    return hoje.getDate()>15?"atrasada":"ok";
  }catch{return"atrasada";}
}

// Follow-up vencido: nextContactDate passou
function followUpVencido(c){
  if(!c.nextContactDate)return false;
  try{
    const d=new Date(c.nextContactDate);
    return d<new Date();
  }catch{return false;}
}

// Cliente "em reunião": tem reunião agendada nos próximos 7 dias (inclui hoje).
// Usa o mesmo campo nextContactDate que já alimenta follow-up.
function emReuniao(c){
  if(!c.nextContactDate)return false;
  try{
    const d=new Date(c.nextContactDate);
    const hoje=new Date();
    hoje.setHours(0,0,0,0);
    const limite=new Date(hoje);
    limite.setDate(limite.getDate()+7);
    return d>=hoje&&d<=limite;
  }catch{return false;}
}

// Objetivos desalinhados: cliente tem pelo menos um objetivo com plano inviável
// OU objetivos cadastrados mas sem aporte/patrimônio registrado (desalinhado).
function objetivosDesalinhados(c){
  if(temInviavel(c))return true;
  const objs=c.objetivos||[];
  if(objs.length===0)return false;
  // Desalinhado: tem meta mas sem aporte ou sem patrimônio inicial registrado
  return objs.some(o=>{
    const meta=parseInt(String(o.meta||"0").replace(/\D/g,""))/100;
    const aporte=parseInt(String(o.aporte||"0").replace(/\D/g,""))/100;
    const inicial=parseInt(String(o.patrimAtual||"0").replace(/\D/g,""))/100;
    return meta>0&&aporte<=0&&inicial<=0;
  });
}

// Plano inviável
function temInviavel(c){
  return(c.objetivos||[]).some(o=>{
    const j=Math.pow(1+14/100,1/12)-1;
    const infl=Math.pow(1+3.81/100,1/12)-1;
    const meta=parseInt(String(o.meta||"0").replace(/\D/g,""))/100;
    const aporte=parseInt(String(o.aporte||"0").replace(/\D/g,""))/100;
    const inicial=parseInt(String(o.patrimAtual||"0").replace(/\D/g,""))/100;
    const prazo=parseInt(o.prazo)||0;
    if(!meta||!prazo)return false;
    let vt=inicial;
    for(let m=1;m<=prazo*12;m++){
      vt=vt*(1+j)+aporte;
      if(vt/Math.pow(1+infl,m)>=meta)return false;
    }
    return true;
  });
}

// ── Avatares ─────────────────────────────────────────────────
const SVG={
  homem:(c)=><svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  mulher:(c)=><svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><path d="M9 21h6M12 17v4"/></svg>,
  idoso_h:(c)=><svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="7" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><path d="M8 20l2-4"/></svg>,
  idoso_m:(c)=><svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="7" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><path d="M9 21h6M12 17v3"/></svg>,
  cachorro:(c)=><svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><path d="M10 5.5C10 4 11 3 12.5 3S15 4 15 5.5v1l3 1.5v3l-2 1v5a2 2 0 01-4 0v-2h-1v2a2 2 0 01-4 0v-5L5 10V8l3-1.5v-1z"/></svg>,
  gato:(c)=><svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><path d="M4 6l2 3c0 5 2 8 6 8s6-3 6-8l2-3-3 1-2-3-1 2h-4l-1-2-3 3z"/><path d="M10 15s.5 1 2 1 2-1 2-1"/></svg>,
};
const AV=[
  {key:"homem",   bg:"linear-gradient(135deg,#1a3560,#0d2040)",cor:"#60a5fa"},
  {key:"mulher",  bg:"linear-gradient(135deg,#3d1560,#20083d)",cor:"#c084fc"},
  {key:"idoso_h", bg:"linear-gradient(135deg,#1a3020,#0d2010)",cor:"#86efac"},
  {key:"idoso_m", bg:"linear-gradient(135deg,#3d1a30,#200d18)",cor:"#f9a8d4"},
  {key:"cachorro",bg:"linear-gradient(135deg,#2a1a0d,#150d06)",cor:"#fbbf24"},
  {key:"gato",    bg:"linear-gradient(135deg,#1a1a3d,#0d0d20)",cor:"#a5b4fc"},
];

export function AvatarIcon({tipo,size=32}){
  const o=AV.find(a=>a.key===tipo)||AV[0];
  const f=SVG[o.key]||SVG.homem;
  return(
    <div style={{width:size,height:size,borderRadius:Math.round(size*.25),background:o.bg,border:"1px solid rgba(240,162,2,.18)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
      {f(o.cor)}
    </div>
  );
}

// Card cliente (memoizado - não re-renderiza se props não mudarem)
const ClientCard=memo(function ClientCard({c,onClick,sAporte,sRevisao,inviavel,followUp,sReserva}){
  const bordaAtencao=sAporte==="sem_aporte"||sRevisao==="atrasada"||followUp;
  const patFin=getPatFin(c);

  let aporteLabel,aporteColor,aporteBg;
  if(sAporte==="aportou"){
    aporteLabel="Aporte Feito"; aporteColor="#4ade80"; aporteBg="rgba(74,222,128,0.10)";
  }else if(sAporte==="parcial"){
    aporteLabel="Aporte Parcial"; aporteColor="#fbbf24"; aporteBg="rgba(251,191,36,0.10)";
  }else{
    aporteLabel="Não Aportou"; aporteColor="#f87171"; aporteBg="rgba(248,113,113,0.10)";
  }

  return(
    <div
      className="client-card"
      data-attention={bordaAtencao ? "true" : undefined}
      onClick={onClick}>
      {/* Nome + UF + Fee Based */}
      <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
        <AvatarIcon tipo={c.avatar||"homem"} size={30}/>
        <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
          <div style={{fontSize:11,color:"#F0EBD8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.nome}</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
            <span style={{fontSize:10,color:"#3E5C76"}}>{c.uf||"—"}</span>
            {c.feeBased&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:20,background:"rgba(34,197,94,0.13)",color:"#22c55e",fontWeight:500,letterSpacing:"0.04em"}}>Fee Based</span>}
          </div>
        </div>
      </div>
      {/* Patrimônio Financeiro */}
      <div style={{fontSize:12,color:"#FFB20F",fontWeight:300,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{brlNum(patFin)}</div>
      {/* Badges */}
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        <span style={{fontSize:9,padding:"2px 7px",borderRadius:20,flexShrink:0,background:aporteBg,color:aporteColor}}>{aporteLabel}</span>
        {sReserva==="ok"&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:"rgba(74,222,128,0.09)",color:"#4ade80",flexShrink:0}}>Reserva OK</span>}
        {sReserva==="sem"&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:"rgba(248,113,113,0.09)",color:"#f87171",flexShrink:0}}>Sem Reserva</span>}
        {sRevisao==="atrasada"&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:"rgba(251,191,36,0.09)",color:"#fbbf24",flexShrink:0}}>Revisão</span>}
        {inviavel&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:"rgba(248,113,113,0.09)",color:"#f87171",flexShrink:0}}>Inviável</span>}
        {followUp&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:"rgba(167,139,250,0.09)",color:"#a78bfa",flexShrink:0}}>Follow-up</span>}
      </div>
    </div>
  );
});

// Rótulo curto no botão "Filtrar" — resume a seleção ativa para o usuário
// entender, num relance, o que está sendo exibido.
function filtroLabel(isMaster, assessores, filtroAssessor, filtroTipo, uid, nomeAtual){
  const partes=[];
  if(isMaster){
    if(!filtroAssessor||filtroAssessor==="todos") partes.push("todos");
    else if(filtroAssessor===uid) partes.push((nomeAtual||"eu").split(" ")[0]);
    else{
      const a=assessores.find(x=>x.uid===filtroAssessor);
      partes.push((a?.nome||"").split(" ")[0] || "assessor");
    }
  }
  if(filtroTipo==="clientes") partes.push("clientes");
  else if(filtroTipo==="prospects") partes.push("prospects");
  return partes.length?`: ${partes.join(" · ")}`:"";
}

// Converte cotações da API para o formato do dashboard
function formatarCotacoes(cotacoes) {
  if (!cotacoes) return MERCADO_PADRAO;

  return [
    {
      label: "Dólar",
      valor: `R$ ${cotacoes.dolar?.valor?.toFixed(2)?.replace(".", ",") || "5,08"}`,
      sub: cotacoes.dolar?.tipo || "Histórico diário",
      cor: (cotacoes.dolar?.variacao ?? 0) >= 0 ? "#22c55e" : "#ef4444"
    },
    {
      label: "Selic",
      valor: `${cotacoes.selic?.valor?.toFixed(2)?.replace(".", ",") || "14,75"}%`,
      sub: cotacoes.selic?.tipo || "a.a.",
      cor: "#6b7280"
    },
    {
      label: "IPCA",
      valor: `${cotacoes.ipca?.valor?.toFixed(2)?.replace(".", ",") || "4,14"}%`,
      sub: cotacoes.ipca?.tipo || "12 meses",
      cor: "#6b7280"
    },
    {
      label: "Ibovespa",
      valor: `${Math.round(cotacoes.ibovespa?.valor || 197000).toLocaleString("pt-BR")}`,
      sub: cotacoes.ibovespa?.tipo || "Histórico do dia",
      cor: (cotacoes.ibovespa?.variacao ?? 0) >= 0 ? "#22c55e" : "#ef4444"
    },
    {
      label: "S&P 500",
      valor: `${Math.round(cotacoes.sp500?.valor || 5396).toLocaleString("pt-BR")}`,
      sub: cotacoes.sp500?.tipo || "Histórico do dia",
      cor: (cotacoes.sp500?.variacao ?? 0) >= 0 ? "#22c55e" : "#ef4444"
    }
  ];
}

// ── Dashboard ─────────────────────────────────────────────────
export default function Dashboard(){
  const [clientes,setClientes]=useState([]);
  const [erroFetch,setErroFetch]=useState(null);
  // Patrimônio sob gestão agregado por mês — carregado em background depois
  // que clientes chegarem. Cada item: { mesRef, valor, clientesContando }.
  const [patrimonioHistorico, setPatrimonioHistorico] = useState([]);
  const [busca,setBusca]=useState("");
  const [filtroAtivo,setFiltroAtivo]=useState(null);
  const [mercado,setMercado]=useState(MERCADO_PADRAO);
  const [atualizando,setAtualizando]=useState(false);
  const [ultimaAtualizacao,setUltimaAtualizacao]=useState(null);
  const [statusMercado,setStatusMercado]=useState(mercadoAberto());
  // Filtro de visão — master pode escolher qualquer assessor ou "todos".
  // Assessor é fixado no próprio uid; só alterna tipo (clientes/prospects).
  // Default do master ao abrir: o próprio uid, pra não expor todos ao abrir
  // em frente a outro assessor.
  const [assessores,setAssessores]=useState([]);
  const [filtroAssessor,setFiltroAssessor]=useState(null);
  // Default: "clientes" para admin abrir já filtrado como no perfil de assessor.
  const [filtroTipo,setFiltroTipo]=useState("clientes"); // todos | clientes | prospects
  const [menuFiltroOpen,setMenuFiltroOpen]=useState(false);
  const [menuFiltroStep,setMenuFiltroStep]=useState("assessor"); // assessor | tipo
  const [assessorTmp,setAssessorTmp]=useState(null); // selecionado no passo 1 antes do tipo
  const [menuCadOpen,setMenuCadOpen]=useState(false);
  const nav=useNavigate();
  const { user, profile, isMaster, isAssessor, isCliente } = useAuth();
  const clientesRef=useRef(null);
  const intervaloRef=useRef(null);
  const filtroRef=useRef(null);
  const cadRef=useRef(null);
  const location=useLocation();

  // Cliente não vê o Dashboard — vai direto pra própria ficha.
  useEffect(()=>{
    if(!isCliente) return;
    if(profile?.clienteId){
      nav(`/cliente/${profile.clienteId}`, { replace: true });
    }
  },[isCliente, profile?.clienteId, nav]);

  // ── Patrimônio sob gestão agregado por mês ──────────────────────
  // Pra cada cliente, busca snapshotsCarteira (limite 12) em paralelo e
  // soma patrimonioTotal por mesRef. Roda em background — não bloqueia
  // o render principal do dashboard. Falha silenciosa em permission-denied.
  useEffect(() => {
    if (!Array.isArray(clientes) || clientes.length === 0) return;
    let alive = true;
    (async () => {
      try {
        // Limita o concurrency a 8 em paralelo pra não estourar quota Firestore
        const results = [];
        for (let i = 0; i < clientes.length; i += 8) {
          const batch = clientes.slice(i, i + 8);
          const settled = await Promise.allSettled(batch.map((c) => listarSnapshots(c.id, { limite: 12 })));
          settled.forEach((s) => results.push(s.status === "fulfilled" ? s.value : []));
          if (!alive) return;
        }
        // Agrega por mesRef
        const agregadoPorMes = new Map();
        results.forEach((snaps) => {
          (snaps || []).forEach((s) => {
            const valor = Number(s.patrimonioTotal) || 0;
            if (!s.mesRef || valor <= 0) return;
            const cur = agregadoPorMes.get(s.mesRef) || { mesRef: s.mesRef, valor: 0, clientes: 0 };
            cur.valor += valor;
            cur.clientes += 1;
            agregadoPorMes.set(s.mesRef, cur);
          });
        });
        // Mantém só meses com pelo menos 1 cliente
        const lista = Array.from(agregadoPorMes.values()).sort((a, b) => String(b.mesRef).localeCompare(String(a.mesRef)));
        if (alive) setPatrimonioHistorico(lista);
      } catch (e) {
        if (e?.code !== "permission-denied") console.warn("[Dashboard] Falha agregando snapshots:", e?.code);
      }
    })();
    return () => { alive = false; };
  }, [clientes]);

  // Carregar clientes (com reload on window focus + visibility para sincronizar com outras páginas).
  // Só anima na primeira carga — re-carregamentos silenciosos não disparam GSAP.
  const primeiraCargaRef=useRef(true);
  // Local-first: hidrata clientes do cache imediatamente; atualiza em background.
  const carregarClientes=useCallback(async()=>{
    const cacheKey = `pi_clientes_${user?.uid || "anon"}_${isMaster ? "M" : "A"}`;
    try{
      setErroFetch(null);
      // Master lê tudo (filtra em memória); assessor lê só os próprios via where.
      const col = collection(db, "clientes");
      const q = isAssessor && user?.uid
        ? query(col, where("advisorId", "==", user.uid))
        : col;
      // Tenta query principal — se falhar (permission-denied/erro de índice/rede),
      // assessor com docs legados (só `assessorId`) ainda recupera via fallback.
      // Antes: o fallback só rodava se a primeira query retornasse vazio (length === 0),
      // mas erro de permissão joga exceção e era engolido pelo catch externo →
      // assessor recém-criado via tentativa de "advisorId" via, sem clientes legados,
      // ficava com "Nenhum cliente visível" mesmo tendo docs com `assessorId`.
      let clientesData = [];
      let primeiroErro = null;
      try {
        const s = await getDocs(q);
        clientesData = s.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (eq) {
        primeiroErro = eq;
        if (!(isAssessor && user?.uid)) throw eq; // master/cliente: sem fallback aplicável
      }
      if (isAssessor && user?.uid && clientesData.length === 0) {
        try {
          const s2 = await getDocs(query(col, where("assessorId", "==", user.uid)));
          clientesData = s2.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (eq2) {
          // Se ambas falharam, propaga o primeiro erro pra UI mostrar mensagem.
          if (primeiroErro) throw primeiroErro;
          throw eq2;
        }
      }
      if (isMaster) {
        const vistos = new Set(clientesData.map(c => c.id));
        void vistos;
      }
      setClientes(clientesData);
      // Atualiza cache pra próxima visita
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          list: clientesData,
          ts: Date.now(),
        }));
      } catch { /* localStorage cheio */ }
      if(primeiraCargaRef.current){
        primeiraCargaRef.current=false;
        loadGsap().then(gsap=>{
          setTimeout(()=>{
            gsap.fromTo(".client-card",
              {opacity:0,y:14},
              {opacity:1,y:0,duration:0.45,stagger:0.06,ease:"power2.out",clearProps:"transform"}
            );
            gsap.fromTo(".dashboard-segment-header",
              {opacity:0,x:-10},
              {opacity:1,x:0,duration:0.35,stagger:0.08,ease:"power2.out"}
            );
          },50);
        });
      }
    }catch(e){
      console.error("Erro ao carregar clientes:",e);
      setErroFetch(`${e?.code||"erro"}: ${e?.message||String(e)}`);
    }
  },[isAssessor, isMaster, user?.uid]);

  // Hidratação INSTANTÂNEA do cache de clientes ao montar.
  // Renderiza < 100ms mesmo antes do Firestore responder.
  useEffect(()=>{
    if(!user?.uid) return;
    const cacheKey = `pi_clientes_${user.uid}_${isMaster ? "M" : "A"}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if(raw){
        const cached = JSON.parse(raw);
        if(cached?.list && Array.isArray(cached.list) && cached.list.length > 0){
          setClientes(cached.list);
          // Não dispara primeiraCargaRef — animação só roda na 1ª carga real
        }
      }
    } catch { /* ignora */ }
     
  },[user?.uid, isMaster]);

  // Procura o UID do assessor "William" (role=assessor) na lista carregada.
  // O admin logado é master, mas o próprio usuário também tem conta de assessor
  // — o painel administrativo deve abrir já filtrado por essa conta.
  const williamAssessorUid = useMemo(()=>{
    if(!isMaster) return null;
    const w = assessores.find(a =>
      a.role === "assessor" && (
        (a.nome||"").toLowerCase().includes("william") ||
        (a.email||"").toLowerCase().includes("william")
      )
    );
    return w?.uid || null;
  },[isMaster, assessores]);

  // Default do master ao montar: filtra pelo assessor "William" (conta de
  // assessor do próprio admin). Só aplica DEPOIS que a lista de assessores
  // chega. Se NÃO encontrar a conta-assessor William, NÃO grava user.uid do
  // master como fallback (clientes têm advisorId = uid_assessor_william, não
  // uid_master) — deixa filtroAssessor=null pra cair em "todos" via efetivo.
  useEffect(()=>{
    if(!isMaster) return;
    if(filtroAssessor!==null) return;
    if(!assessores.length) return; // espera carregar
    if(williamAssessorUid) setFiltroAssessor(williamAssessorUid);
    // Se não achar William assessor, não força filtro — deixa null e o
    // filtroAssessorEfetivo cai em "todos" mostrando a base inteira.
  },[isMaster, filtroAssessor, williamAssessorUid, assessores.length]);

  // Carrega lista de assessores (só master) via Cloud Function com Admin SDK.
  // Usa cache em localStorage pra renderização instantânea no segundo+ login.
  // Cold start da Cloud Function é 1-3s — sem cache, o filtro do William
  // nunca ativava em tempo, mostrando "todos" ou nada por vários segundos.
  useEffect(()=>{
    if(!isMaster) return;
    let alive=true;

    // 1) Hidrata do cache imediatamente (se houver)
    try {
      const cache = JSON.parse(localStorage.getItem("pi_assessores_cache") || "null");
      if (cache?.list && Array.isArray(cache.list) && cache.list.length > 0) {
        setAssessores(cache.list);
      }
    } catch { /* ignora */ }

    // 2) Refresh em background — atualiza cache pra próxima visita
    (async()=>{
      try{
        const res=await httpsCallable(functions,"listarUsuarios")();
        if(!alive) return;
        const arr=(res.data?.users||[])
          .filter(u=>u.role==="assessor"||u.role==="master")
          .sort((a,b)=>(a.nome||"").localeCompare(b.nome||"","pt-BR"));
        setAssessores(arr);
        try {
          localStorage.setItem("pi_assessores_cache", JSON.stringify({
            list: arr,
            ts: Date.now(),
          }));
        } catch { /* localStorage cheio, ignora */ }
      }catch(e){
        console.warn("Falha ao listar assessores:",e?.message||e);
      }
    })();
    return()=>{alive=false;};
  },[isMaster]);

  // Fecha os menus ao clicar fora.
  useEffect(()=>{
    function onDoc(e){
      if(filtroRef.current && !filtroRef.current.contains(e.target)) setMenuFiltroOpen(false);
      if(cadRef.current && !cadRef.current.contains(e.target)) setMenuCadOpen(false);
    }
    document.addEventListener("mousedown",onDoc);
    return()=>document.removeEventListener("mousedown",onDoc);
  },[]);

  // Atualizar cotações do servidor E recarregar clientes (em paralelo).
  // O botão "Atualizar" força refetch (ignora cache). Chamadas automáticas
  // (boot, polling) respeitam o cache fresco e só vão à rede se necessário.
  const atualizarCotacoesServidor=useCallback(async({ force = false } = {})=>{
    setAtualizando(true);
    const tarefaCotacoes=(async()=>{
      try{
        const cotacoes=await obterTodasAsCotacoes({ force });
        const formatted=formatarCotacoes(cotacoes);
        setMercado(formatted);
        setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      }catch(e){
        console.error("Erro ao atualizar cotações:",e);
      }
    })();
    const tarefaClientes=carregarClientes();
    await Promise.allSettled([tarefaCotacoes,tarefaClientes]);
    setAtualizando(false);
  },[carregarClientes]);

  useEffect(()=>{
    // Debounce focus+visibility — os dois disparam quase juntos ao voltar pra
    // aba, e sem coalescer gerávamos 2× getDocs de todos os clientes.
    let timer=null;
    let ultimoRefetch=Date.now();
    const agendar=()=>{
      if(timer) return;
      timer=setTimeout(()=>{
        timer=null;
        if(Date.now()-ultimoRefetch<15000) return; // throttle 15s
        ultimoRefetch=Date.now();
        carregarClientes();
      },250);
    };
    const onFocus=()=>agendar();
    const onVisibility=()=>{if(document.visibilityState==="visible")agendar();};
    // CustomEvent disparado por ClienteFicha após salvar — força refetch
    // imediato (respeitando o throttle de 15s) sem precisar trocar de aba.
    const onClienteAtualizado=()=>agendar();
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisibility);
    window.addEventListener("wealthtrack:cliente-atualizado",onClienteAtualizado);
    return()=>{
      if(timer) clearTimeout(timer);
      window.removeEventListener("focus",onFocus);
      document.removeEventListener("visibilitychange",onVisibility);
      window.removeEventListener("wealthtrack:cliente-atualizado",onClienteAtualizado);
    };
  },[carregarClientes]);

  // Atualização inicial + polling com ref estável (evita recriar interval e chamadas duplicadas).
  // Não dependemos de statusMercado no deps: o listener interno sincroniza via setState.
  const atualizarRef=useRef(atualizarCotacoesServidor);
  useEffect(()=>{atualizarRef.current=atualizarCotacoesServidor;},[atualizarCotacoesServidor]);

  useEffect(()=>{
    atualizarRef.current(); // fetch inicial único (clientes + cotações em paralelo)
    // Poll curto (60s) que checa o mercado e só dispara cotações respeitando
    // o intervalo real (INTERVALO_ATUALIZACAO). Um único interval para ambos os casos.
    let ultimoFetch=Date.now();
    const tick=()=>{
      const aberto=mercadoAberto();
      setStatusMercado(prev=>prev!==aberto?aberto:prev);
      const agora=Date.now();
      if(aberto && agora-ultimoFetch>=INTERVALO_ATUALIZACAO){
        ultimoFetch=agora;
        atualizarRef.current();
      }
    };
    intervaloRef.current=setInterval(tick,60000);
    return()=>{
      if(intervaloRef.current){
        clearInterval(intervaloRef.current);
        intervaloRef.current=null;
      }
    };
  },[]);

  // Calcular status de cada cliente (memoizado)
  const clientesComStatus=useMemo(()=>clientes.map(c=>({
    ...c,
    _sAporte: statusAporte(c),
    _sRevisao: statusRevisao(c),
    _inviavel: temInviavel(c),
    _followUp: followUpVencido(c),
    _sReserva: statusReserva(c),
    _emReuniao: emReuniao(c),
    _objDesalinhados: objetivosDesalinhados(c),
    _feeBased: c.feeBased===true,
  })),[clientes]);

  // Filtro efetivo: enquanto o useEffect de default não roda, master já filtra
  // pelo assessor William. Se williamAssessorUid ainda não chegou (cold start
  // da Cloud Function listarUsuarios), mostra TODOS — nunca cair no uid do
  // master, que não é advisorId de nenhum cliente e zeraria a lista.
  const filtroAssessorEfetivo = isMaster
    ? (filtroAssessor ?? williamAssessorUid ?? "todos")
    : filtroAssessor;

  // Lista visível após aplicar filtro de assessor (master) e tipo cliente/prospect.
  // É a base de TODOS os derivados (KPIs, alertas, segmentação, custódia).
  const clientesVisiveis=useMemo(()=>{
    let list=clientesComStatus;
    if(isMaster && filtroAssessorEfetivo && filtroAssessorEfetivo!=="todos"){
      list=list.filter(c=>(c.advisorId||c.assessorId)===filtroAssessorEfetivo);
    }
    if(filtroTipo==="clientes") list=list.filter(c=>!c.isProspect);
    else if(filtroTipo==="prospects") list=list.filter(c=>!!c.isProspect);
    return list;
  },[clientesComStatus,isMaster,filtroAssessorEfetivo,filtroTipo]);

  // Alertas e agrupamentos derivados (memoizados para não recalcular a cada keystroke)
  const {semAporte,semRevisao,comInviavel,comFollowUp,objDesalinhadosList,feeBasedList,porSeg,patrimonioTotal}=useMemo(()=>{
    const semAporte  =clientesVisiveis.filter(c=>c._sAporte==="sem_aporte");
    const semRevisao =clientesVisiveis.filter(c=>c._sRevisao==="atrasada");
    const comInviavel=clientesVisiveis.filter(c=>c._inviavel);
    const comFollowUp=clientesVisiveis.filter(c=>c._followUp);
    const objDesalinhadosList=clientesVisiveis.filter(c=>c._objDesalinhados);
    const feeBasedList=clientesVisiveis.filter(c=>c._feeBased);
    const porSeg={};
    SEGS.forEach(s=>{porSeg[s]=[];});
    clientesVisiveis.forEach(c=>{
      const s=segAuto(getPatFin(c));
      if(porSeg[s])porSeg[s].push(c);
    });
    return{
      semAporte,semRevisao,comInviavel,comFollowUp,objDesalinhadosList,feeBasedList,porSeg,
      patrimonioTotal:calcularPatrimonioTotal(clientesVisiveis),
    };
  },[clientesVisiveis]);

  // Sincroniza filtro com ?filtro= da URL (usado pela Sidebar)
  const [searchParams,setSearchParams]=useSearchParams();
  const filtroFromUrl=searchParams.get("filtro");
  useEffect(()=>{
    if(filtroFromUrl&&filtroFromUrl!==filtroAtivo){
      setFiltroAtivo(filtroFromUrl);
      setTimeout(()=>{
        clientesRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
      },150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[filtroFromUrl]);

  // Reage a hash na URL (ex.: /dashboard#clientes)
  useEffect(()=>{
    const h=location.hash;
    if(h==="#clientes"){
      setFiltroAtivo("todos");
      setTimeout(()=>clientesRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),150);
    }
     
  },[location.hash]);

  // Filtro inteligente — NUNCA chamar setSearchParams dentro do updater de state
  const aplicarFiltro=useCallback((tipo)=>{
    const novo=filtroAtivo===tipo?null:tipo;
    setFiltroAtivo(novo);
    if(novo){
      setSearchParams({filtro:novo},{replace:true});
    }else{
      setSearchParams({},{replace:true});
    }
    setTimeout(()=>{
      clientesRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
    },100);
  },[filtroAtivo,setSearchParams]);

  // Helper: extrai todos os nomes/tickers de ativos de um cliente.
  const ativosDoCliente=useCallback((c)=>{
    const carteira=c.carteira||{};
    const nomes=[];
    for(const k of Object.keys(carteira)){
      if(!k.endsWith("Ativos"))continue;
      const arr=carteira[k];
      if(!Array.isArray(arr))continue;
      for(const a of arr){
        if(a?.nome)nomes.push(String(a.nome));
      }
    }
    return nomes;
  },[]);

  const normalize=(s)=>(s||"").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");

  // Clientes filtrados — busca agora casa em nome, código, email, cidade, UF e ativos.
  const clientesFiltrados=useMemo(()=>{
    const termo=normalize(busca.trim());
    let lista=clientesVisiveis;
    if(termo){
      lista=lista.filter(c=>{
        const hay=[
          c.nome,c.codigo,c.email,c.telefone,c.cidade,c.uf,c.segmento,
          ...ativosDoCliente(c),
        ].map(normalize).join(" ");
        return hay.includes(termo);
      });
    }
    if(filtroAtivo==="semAporte") lista=lista.filter(c=>c._sAporte==="sem_aporte");
    if(filtroAtivo==="semRevisao")lista=lista.filter(c=>c._sRevisao==="atrasada");
    if(filtroAtivo==="inviavel")  lista=lista.filter(c=>c._inviavel);
    if(filtroAtivo==="followUp")  lista=lista.filter(c=>c._followUp);
    if(filtroAtivo==="emReuniao") lista=lista.filter(c=>c._emReuniao);
    if(filtroAtivo==="objetivosDesalinhados") lista=lista.filter(c=>c._objDesalinhados);
    if(filtroAtivo==="feeBased")  lista=lista.filter(c=>c._feeBased);
    return lista;
  },[clientesComStatus,busca,filtroAtivo]);

  const mostrarLista=busca||filtroAtivo;

  // Sugestões globais da navbar: agrupa por Clientes, Cidades/UF e Ativos.
  const searchSuggestions=useMemo(()=>{
    const termo=normalize(busca.trim());
    if(!termo)return null;
    const MAX_PER_GROUP=5;
    // Clientes
    const clientesHit=[];
    const cidadesMap=new Map(); // chave = "cidade/uf" normalizado
    const ativosMap=new Map();  // chave = nome normalizado → {label, clientes:Set}
    for(const c of clientesVisiveis){
      const nomeN=normalize(c.nome);
      const codigoN=normalize(c.codigo);
      const emailN=normalize(c.email);
      const cidadeN=normalize(c.cidade);
      const ufN=normalize(c.uf);
      const ativos=ativosDoCliente(c);
      if(nomeN.includes(termo)||codigoN.includes(termo)||emailN.includes(termo)){
        if(clientesHit.length<MAX_PER_GROUP){
          clientesHit.push({
            label:c.nome||"(sem nome)",
            sublabel:[c.codigo,c.cidade&&c.uf?`${c.cidade}/${c.uf}`:c.uf||c.cidade].filter(Boolean).join(" · "),
            onClick:()=>nav(`/cliente/${c.id}/painel`),
          });
        }
      }
      // Cidade/UF
      if((cidadeN&&cidadeN.includes(termo))||(ufN&&ufN.includes(termo))){
        const key=`${c.cidade||""}|${c.uf||""}`;
        if(!cidadesMap.has(key))cidadesMap.set(key,{cidade:c.cidade,uf:c.uf,count:0});
        cidadesMap.get(key).count++;
      }
      // Ativos
      for(const nome of ativos){
        const n=normalize(nome);
        if(!n.includes(termo))continue;
        if(!ativosMap.has(n))ativosMap.set(n,{label:nome,clientes:new Set()});
        ativosMap.get(n).clientes.add(c.id);
      }
    }
    const cidadesHit=[...cidadesMap.values()]
      .sort((a,b)=>b.count-a.count)
      .slice(0,MAX_PER_GROUP)
      .map(x=>{
        const label=x.cidade&&x.uf?`${x.cidade}/${x.uf}`:(x.cidade||x.uf||"—");
        return{
          label,
          sublabel:`${x.count} cliente${x.count!==1?"s":""}`,
          onClick:()=>{
            setBusca(label);
            setTimeout(()=>clientesRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),120);
          },
        };
      });
    const ativosHit=[...ativosMap.values()]
      .sort((a,b)=>b.clientes.size-a.clientes.size)
      .slice(0,MAX_PER_GROUP)
      .map(x=>({
        label:x.label,
        sublabel:`${x.clientes.size} cliente${x.clientes.size!==1?"s":""} com este ativo`,
        onClick:()=>{
          setBusca(x.label);
          setTimeout(()=>clientesRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),120);
        },
      }));
    return[
      {group:"Clientes",items:clientesHit},
      {group:"Localização",items:cidadesHit},
      {group:"Ativos",items:ativosHit},
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[busca,clientesVisiveis]);

  return(
    <div className="dashboard-container has-sidebar">

      {/* SIDEBAR LATERAL - expande no hover */}
      <Sidebar />

      {/* NAVBAR - Nova com padronização premium.
          O badge de usuário (ADM/Assessor · nome · patrimônio) foi movido pra cá
          (era o bloco "HUB PI" acima — removido por pedido, pra dar mais respiro ao topo). */}
      <Navbar
        showSearch={true}
        searchValue={busca}
        onSearchChange={setBusca}
        searchSuggestions={searchSuggestions}
        showLogout={true}
        userBadge={null}
        actionButtons={[
          {
            icon: atualizando ? "⟳" : "↻",
            label: "Atualizar",
            onClick: () => atualizarCotacoesServidor({ force: true }),
            disabled: atualizando,
            title: statusMercado ? "Atualizar cotações" : "Mercado fechado · Atualizar manualmente",
            variant: "secondary"
          }
        ]}
      />

      <div className="dashboard-content with-sidebar">

        {/* SEÇÃO INICIAL — mercado + 8 cards + alertas */}
        <section className="dashboard-hero-section" style={{ paddingTop: 8 }}>

        {/* HUB PI — banner de boas-vindas para admin/assessor */}
        {(isMaster || isAssessor) && (
          <div className="hub-pi" style={{ marginBottom: 14 }}>
            <img
              src="/assets/logo/logo-icon.svg"
              alt=""
              aria-hidden="true"
              className="hub-pi-mark"
            />
            <div className="hub-pi-body">
              <span className="hub-pi-eyebrow">Hub PI</span>
              <span className="hub-pi-title">
                Hub <b>Porto Invest</b>
              </span>
              <span className="hub-pi-sub">
                {isMaster ? "Painel administrativo" : "Painel do assessor"}
              </span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
              <span
                className="hub-pi-badge"
                title={`Logado como ${profile?.nome || user?.email || "admin"}`}
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
                {isMaster ? "Admin" : "Assessor"} · {(profile?.nome || user?.displayName || user?.email?.split("@")[0] || "").split(" ")[0]} · {brlNum(patrimonioTotal)}
              </span>
            </div>
          </div>
        )}

        {/* BARRA DE STATUS DO MERCADO */}
        <div className="dashboard-status-bar">
          <span className="ds-date">{new Date().toLocaleDateString("pt-BR")}</span>
          <span className="ds-sep">•</span>
          <span className={statusMercado ? "ds-mkt-open" : "ds-mkt-closed"}>
            {statusMercado ? "● MERCADO ABERTO" : "● MERCADO FECHADO"}
          </span>
          {ultimaAtualizacao && (
            <>
              <span className="ds-sep">•</span>
              <span className="ds-update">
                Última atualização: <strong>{ultimaAtualizacao}</strong>
              </span>
            </>
          )}
        </div>

        {/* INDICADORES DE MERCADO */}
        <div className="market-indicators">
          {mercado.map(({label,valor,sub,cor})=>(
            <div key={label} className="market-indicator">
              <div className="market-label">{label}</div>
              <div className="market-value">{valor}</div>
              <div className="market-sub" style={{color:cor}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* CARDS KPI — 8 cards em 2 linhas de 4 (desktop) / 2 colunas (mobile) */}
        <div className="dashboard-cards-xp grid-8">

          {/* 1 — Custódia total (destaque, filtro por segmento) */}
          <div
            className="card-xp card-xp-primary clickable"
            onClick={()=>{aplicarFiltro("todos");}}
            title="Ver todos os clientes"
          >
            <div className="card-xp-label">Custódia Total</div>
            <div className="card-xp-value">{brlNum(patrimonioTotal)}</div>
            <div className="card-xp-subtitle">{clientesVisiveis.length} cliente{clientesVisiveis.length!==1?"s":""}</div>
          </div>

          {/* 2 — Sem aporte no mês */}
          <div
            className={`card-xp clickable ${filtroAtivo==="semAporte"?"card-xp-primary":""}`}
            onClick={()=>aplicarFiltro("semAporte")}
            title="Clientes que não aportaram no mês ou na data combinada"
          >
            <div className="card-xp-label">Sem Aporte</div>
            <div className="card-xp-value">{semAporte.length}</div>
            <div className="card-xp-subtitle">Sem aporte no mês</div>
          </div>

          {/* 3 — Sem reuniões (revisão em atraso) */}
          <div
            className={`card-xp clickable ${filtroAtivo==="semRevisao"?"card-xp-primary":""}`}
            onClick={()=>aplicarFiltro("semRevisao")}
            title="Clientes com revisão mensal em atraso"
          >
            <div className="card-xp-label">Sem Reuniões</div>
            <div className="card-xp-value">{semRevisao.length}</div>
            <div className="card-xp-subtitle">Revisões em atraso</div>
          </div>

          {/* 4 — Objetivos desalinhados */}
          <div
            className={`card-xp clickable ${filtroAtivo==="objetivosDesalinhados"?"card-xp-primary":""}`}
            onClick={()=>aplicarFiltro("objetivosDesalinhados")}
            title="Clientes com objetivos sem plano viável ou sem aporte/patrimônio registrado"
          >
            <div className="card-xp-label">Objetivos Desalinhados</div>
            <div className="card-xp-value">{objDesalinhadosList.length}</div>
            <div className="card-xp-subtitle">Precisam de ajuste</div>
          </div>

          {/* 5 — Fee Based */}
          <div
            className={`card-xp clickable ${filtroAtivo==="feeBased"?"card-xp-primary":""}`}
            onClick={()=>aplicarFiltro("feeBased")}
            title="Clientes no modelo de atendimento Fee Based"
          >
            <div className="card-xp-label">Fee Based</div>
            <div className="card-xp-value">{feeBasedList.length}</div>
            <div className="card-xp-subtitle">Modelo Fee Based ativo</div>
          </div>

          {/* 6 — Vencimentos (página nova) */}
          <div
            className="card-xp clickable"
            onClick={()=>nav("/vencimentos")}
            title="Ver ativos que vão vencer e clientes vinculados"
          >
            <div className="card-xp-label">Vencimentos</div>
            <div className="card-xp-value">—</div>
            <div className="card-xp-subtitle">Ativos a vencer</div>
            <span className="card-xp-chip muted">abrir página</span>
          </div>

          {/* 7 — Atualização de Mercado (página nova) */}
          <div
            className="card-xp clickable"
            onClick={()=>nav("/mercado")}
            title="Resumo diário de mercado, notícias e maiores altas"
          >
            <div className="card-xp-label">Atualização de Mercado</div>
            <div className="card-xp-value">Resumo</div>
            <div className="card-xp-subtitle">Notícias e destaques do dia</div>
            <span className="card-xp-chip">abrir página</span>
          </div>

          {/* 8 — Carteiras desalinhadas (página nova) */}
          <div
            className="card-xp clickable"
            onClick={()=>nav("/carteiras-desalinhadas")}
            title="Carteiras com alertas de risco ou classes excessivas"
          >
            <div className="card-xp-label">Carteiras Desalinhadas</div>
            <div className="card-xp-value">—</div>
            <div className="card-xp-subtitle">Risco ou classe excessiva</div>
            <span className="card-xp-chip muted">abrir página</span>
          </div>

        </div>

        {/* ALERTAS CRM */}
        {(semAporte.length>0||semRevisao.length>0||comInviavel.length>0||comFollowUp.length>0)&&(
          <div className="dashboard-alerts-section">
            <div className="grid-alerts">
              {[
                {lista:semAporte,  cor:"#ef4444", titulo:"Sem aporte",       filtro:"semAporte",  msg:"cliente(s) sem aporte no mês"},
                {lista:semRevisao, cor:"#f59e0b", titulo:"Sem revisão",      filtro:"semRevisao", msg:"cliente(s) sem revisão no mês"},
                {lista:comInviavel,cor:"#ef4444", titulo:"Plano inviável",   filtro:"inviavel",   msg:"cliente(s) com objetivo inviável"},
                {lista:comFollowUp,cor:"#a855f7", titulo:"Follow-up vencido",filtro:"followUp",   msg:"cliente(s) com retorno atrasado"},
              ].filter(a=>a.lista.length>0).map((a)=>(
                <div key={a.filtro}
                  onClick={()=>aplicarFiltro(a.filtro)}
                  className="alert-card"
                  data-severity={a.cor === "#ef4444" ? "danger" : a.cor === "#f59e0b" ? "warning" : "info"}
                  style={{
                    background:filtroAtivo===a.filtro?`${a.cor}12`:`${a.cor}08`,
                    borderColor:filtroAtivo===a.filtro?a.cor:a.cor+"30",
                  }}>
                  <div className="alert-title" style={{color:a.cor}}>{a.titulo}</div>
                  <div className="alert-count">{a.lista.length} {a.msg}</div>
                  <div className="alert-names">
                    {a.lista.slice(0,3).map(c=>c.nome?.split(" ")[0]).join(", ")}
                    {a.lista.length>3?` +${a.lista.length-3}`:""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        </section>
        {/* ── fim da SEÇÃO INICIAL ── */}

        {/* ── EVOLUÇÃO DO PATRIMÔNIO SOB GESTÃO ── */}
        <div style={{ padding: "0 24px", marginTop: 32 }}>
          <div style={{
            fontSize: 13, color: "#94A7BF", textTransform: "uppercase",
            letterSpacing: "0.14em", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ width: 32, height: 2, background: "#F0A202", opacity: 0.8, borderRadius: 1 }} />
            Evolução do patrimônio sob gestão
          </div>
          {patrimonioHistorico.length >= 1 ? (
            <HistoricoMensalChart
              items={patrimonioHistorico}
              descricao="Soma do patrimônio de todos os clientes mês a mês — agregado a partir dos snapshots mensais salvos. Mostra crescimento da carteira sob gestão."
            />
          ) : (
            <div style={{
              border: "0.5px solid rgba(62,92,118,0.35)",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 18,
              padding: "32px 22px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.55 }}>📈</div>
              <div style={{ fontSize: 13, color: "#F0EBD8", fontWeight: 500, marginBottom: 6 }}>
                Nenhum snapshot mensal agregado ainda
              </div>
              <div style={{ fontSize: 11, color: "#94A7BF", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
                Cada cliente que tiver pelo menos um PDF importado contribui para este gráfico. Importe extratos nas carteiras dos clientes para começar a ver a custódia evoluir mês a mês.
              </div>
            </div>
          )}
        </div>

        {/* Respiro entre a seção inicial (mercado/cards) e a seção de clientes abaixo */}
        <div style={{ height: 48 }} aria-hidden="true" />

        {/* SEÇÃO CLIENTES — com id para scroll; vira full-screen quando filtro ativo */}
        <div ref={clientesRef} id="clientes" className={`dashboard-clients-wrapper${(filtroAtivo||busca)?" is-filter-active":""}`}>
          <div className="dashboard-clients-header">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div className="page-title">Meus Clientes</div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {/* BOTÃO FILTRAR — master escolhe assessor + tipo; assessor só tipo. */}
                <div ref={filtroRef} style={{position:"relative"}}>
                  <button
                    className="btn-small"
                    onClick={()=>{
                      setMenuFiltroOpen(o=>!o);
                      setMenuCadOpen(false);
                      setMenuFiltroStep(isMaster?"assessor":"tipo");
                      setAssessorTmp(filtroAssessorEfetivo);
                    }}
                    title="Filtrar por assessor e tipo"
                  >
                    ▾ Filtrar{filtroLabel(isMaster,assessores,filtroAssessorEfetivo,filtroTipo,user?.uid,profile?.nome)}
                  </button>
                  {menuFiltroOpen&&(
                    <div className="dashboard-filter-menu">
                      {menuFiltroStep==="assessor"&&isMaster&&(
                        <>
                          <div className="dashboard-filter-menu-title">Escolha o assessor</div>
                          <button
                            className={`dashboard-filter-menu-item${filtroAssessorEfetivo==="todos"?" active":""}`}
                            onClick={()=>{setAssessorTmp("todos");setMenuFiltroStep("tipo");}}
                          >
                            Todos os assessores
                          </button>
                          {assessores.map(a=>(
                            <button
                              key={a.uid}
                              className={`dashboard-filter-menu-item${filtroAssessorEfetivo===a.uid?" active":""}`}
                              onClick={()=>{setAssessorTmp(a.uid);setMenuFiltroStep("tipo");}}
                            >
                              {a.nome||a.email||a.uid}
                              {a.uid===user?.uid&&<span className="dashboard-filter-menu-hint"> (você)</span>}
                            </button>
                          ))}
                        </>
                      )}
                      {menuFiltroStep==="tipo"&&(
                        <>
                          <div className="dashboard-filter-menu-title">
                            {isMaster?"O que exibir?":"Tipo"}
                            {isMaster&&(
                              <button className="dashboard-filter-menu-back" onClick={()=>setMenuFiltroStep("assessor")}>← voltar</button>
                            )}
                          </div>
                          {["todos","clientes","prospects"].map(t=>(
                            <button
                              key={t}
                              className={`dashboard-filter-menu-item${filtroTipo===t&&(isMaster?filtroAssessorEfetivo:true)?" active":""}`}
                              onClick={()=>{
                                if(isMaster)setFiltroAssessor(assessorTmp||filtroAssessorEfetivo);
                                setFiltroTipo(t);
                                setMenuFiltroOpen(false);
                              }}
                            >
                              {t==="todos"?"Clientes e prospects":t==="clientes"?"Só clientes":"Só prospects"}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* BOTÃO CADASTRAR — menu discreto com cliente/prospect. */}
                {(isMaster||isAssessor)&&(
                  <div ref={cadRef} style={{position:"relative"}}>
                    <button
                      className="btn-small"
                      onClick={()=>{setMenuCadOpen(o=>!o);setMenuFiltroOpen(false);}}
                      title="Cadastrar cliente ou prospect"
                    >
                      + Cadastrar
                    </button>
                    {menuCadOpen&&(
                      <div className="dashboard-filter-menu">
                        <button
                          className="dashboard-filter-menu-item"
                          onClick={()=>{setMenuCadOpen(false);nav("/cliente/novo");}}
                        >
                          Novo cliente
                        </button>
                        <button
                          className="dashboard-filter-menu-item"
                          onClick={()=>{setMenuCadOpen(false);nav("/cliente/novo?prospect=1");}}
                        >
                          Novo prospect
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {filtroAtivo&&(
                  <button
                    className="btn-small"
                    onClick={()=>{setFiltroAtivo(null);setSearchParams({},{replace:true});}}>
                    × limpar filtro
                  </button>
                )}
              </div>
            </div>
            {filtroAtivo&&(
              <div className="dashboard-filter-info">
                Exibindo: <span style={{color:"#F0EBD8"}}>
                  {{
                    todos:"Todos os clientes",
                    semAporte:"Sem aporte no mês",
                    semRevisao:"Sem reuniões",
                    inviavel:"Plano inviável",
                    followUp:"Follow-up vencido",
                    emReuniao:"Em reunião (próx. 7 dias)",
                    objetivosDesalinhados:"Objetivos desalinhados",
                    feeBased:"Fee Based",
                  }[filtroAtivo] || filtroAtivo}
                </span>
                {" "}· {clientesFiltrados.length} cliente{clientesFiltrados.length!==1?"s":""}
              </div>
            )}
          </div>

          {/* DIAGNÓSTICO — mostra contagem em cada estágio do pipeline e
              expõe erro de fetch. Some quando há cliente visível. */}
          {(isMaster||isAssessor) && clientesVisiveis.length===0 && (
            <div style={{
              margin:"16px 0",
              padding:"14px 18px",
              background:"rgba(239,68,68,0.08)",
              border:"1px solid rgba(239,68,68,0.35)",
              borderRadius:10,
              color:"#fda4af",
              fontSize:13,
              lineHeight:1.6,
              fontFamily:"monospace",
            }}>
              <div style={{fontWeight:700,marginBottom:6,color:"#fff"}}>⚠ Nenhum cliente visível — diagnóstico</div>
              <div>fetched: <b style={{color:"#fff"}}>{clientes.length}</b> cliente(s) do Firestore</div>
              <div>após filtro de assessor ({String(filtroAssessorEfetivo)}): <b style={{color:"#fff"}}>{
                isMaster && filtroAssessorEfetivo && filtroAssessorEfetivo!=="todos"
                  ? clientes.filter(c=>(c.advisorId||c.assessorId)===filtroAssessorEfetivo).length
                  : clientes.length
              }</b></div>
              <div>após filtro de tipo ({filtroTipo}): <b style={{color:"#fff"}}>{clientesVisiveis.length}</b></div>
              <div>role: <b style={{color:"#fff"}}>{isMaster?"master":isAssessor?"assessor":"—"}</b> · uid: <b style={{color:"#fff"}}>{user?.uid?.slice(0,8)}</b> · williamAssessorUid: <b style={{color:"#fff"}}>{williamAssessorUid?williamAssessorUid.slice(0,8):"null"}</b></div>
              {erroFetch && <div style={{marginTop:6,color:"#ef4444"}}>erro fetch: <b>{erroFetch}</b></div>}
            </div>
          )}

          {/* LISTA FILTRADA */}
          {mostrarLista&&(
            <div className="grid-clients">
              {clientesFiltrados.length===0
                ?<div className="dashboard-no-results">Nenhum cliente encontrado.</div>
                :clientesFiltrados.map(c=>(
                  <ClientCard key={c.id} c={c} onClick={()=>nav(`/cliente/${c.id}/painel`)}
                    sAporte={c._sAporte} sRevisao={c._sRevisao}
                    inviavel={c._inviavel} followUp={c._followUp} sReserva={c._sReserva}/>
                ))
              }
            </div>
          )}

          {/* GRADE POR SEGMENTO */}
          {!mostrarLista&&(
            <div className="grid-clients">
              {SEGS.map(seg=>(
                <div key={seg} className="dashboard-segment">
                  <div className="dashboard-segment-header">
                    <span className="dashboard-segment-title" style={{color:SEG_COLORS[seg].color}}>{seg}</span>
                    <span className="dashboard-segment-count" style={{color:SEG_COLORS[seg].color,background:SEG_COLORS[seg].bg,border:`0.5px solid ${SEG_COLORS[seg].border}`}}>{porSeg[seg].length}</span>
                  </div>
                  <div className="dashboard-segment-clients">
                    {porSeg[seg].length===0?(
                      <div className="dashboard-segment-empty">
                        <span>Sem clientes</span>
                      </div>
                    ):(
                      porSeg[seg].map(c=>(
                        <ClientCard key={c.id} c={c} onClick={()=>nav(`/cliente/${c.id}/painel`)}
                          sAporte={c._sAporte} sRevisao={c._sRevisao}
                          inviavel={c._inviavel} followUp={c._followUp} sReserva={c._sReserva}/>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}