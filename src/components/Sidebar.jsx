import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "../styles/sidebar.css";

// Só o master abre o monitor online — manter fora do bundle principal da sidebar.
const MonitorOnline = lazy(() => import("./MonitorOnline").then(m => ({ default: m.MonitorOnline })));

/**
 * Sidebar lateral esquerda — estilo Hub XP / fintech premium
 *
 * Props:
 *   mode        : "admin" (default) ou "cliente"
 *   clienteId   : quando mode === "cliente", id do cliente para rotas
 *   clienteNome : nome do cliente (mostrado no topo quando expandida)
 *
 * Comportamento:
 *   - Colapsada por padrão (58px). Passa o mouse → expande suavemente (246px).
 *   - Há um delay na entrada (150ms) para evitar abrir por acidente.
 *   - Há um delay na saída (220ms) para não fechar ao atravessar submenu.
 *   - Glassmorphism sutil, transição cubic-bezier refinada, sem "travar".
 *   - Barra de busca contextual: digita → filtra atalhos → enter / clique navega.
 */

const ICONS = {
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M17 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  goal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M3 7l3-3h10l3 3" />
      <circle cx="17" cy="13" r="1.2" />
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M17 6H9.5A2.5 2.5 0 0 0 7 8.5c0 1.4 1.1 2.5 2.5 2.5h5c1.4 0 2.5 1.1 2.5 2.5S15.9 16 14.5 16H6" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  ),
  trending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M17 7h4v4" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18h.01" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h11a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z" />
      <path d="M4 16a4 4 0 0 1 4-4h11" />
    </svg>
  ),
  extrato: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v5h5" />
      <path d="M9 13h6M9 17h4M9 9h3" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  ),
  compass: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-4 6-2-2 4-6 2 2z" />
    </svg>
  ),
  simulate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 12h8M12 8v8" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1" />
    </svg>
  ),
  arrowLeft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M2 12C4.5 6 8 3 12 3s7.5 3 10 9c-2.5 6-6 9-10 9S4.5 18 2 12z" />
    </svg>
  ),
};

/* ── Bottom Tab Bar (mobile) ──────────────────────────────────────
   5 tabs fixos no fundo da tela. "Mais" abre o drawer existente.
   ──────────────────────────────────────────────────────────────── */
const BOTTOM_TABS_ADMIN = [
  { id: "home",      icon: "home",     label: "Início",   path: "/dashboard" },
  { id: "clientes",  icon: "users",    label: "Clientes", path: "/dashboard?filtro=todos" },
  { id: "novo",      icon: "plus",     label: "Novo",     path: "/cliente/novo", highlight: true },
  { id: "mercado",   icon: "trending", label: "Mercado",  path: "/mercado" },
  { id: "menu",      icon: "menu",     label: "Mais",     path: null },
];

function buildBottomTabsCliente(id) {
  return [
    { id: "visao",     icon: "home",    label: "Início",   path: `/cliente/${id}` },
    { id: "carteira",  icon: "wallet",  label: "Carteira", path: `/cliente/${id}/carteira` },
    { id: "objetivos", icon: "goal",    label: "Objetivos",path: `/cliente/${id}/objetivos` },
    { id: "fluxo",     icon: "dollar",  label: "Fluxo",    path: `/cliente/${id}/fluxo` },
    { id: "menu",      icon: "menu",    label: "Mais",     path: null },
  ];
}

function BottomTabBar({ mode, clienteId, onOpenMenu }) {
  const nav   = useNavigate();
  const loc   = useLocation();
  const tabs  = mode === "cliente" && clienteId
    ? buildBottomTabsCliente(clienteId)
    : BOTTOM_TABS_ADMIN;

  const isActive = (tab) => {
    if (!tab.path) return false;
    const tabPath   = tab.path.split("?")[0].split("#")[0];
    const tabSearch = tab.path.includes("?") ? "?" + tab.path.split("?")[1] : "";
    if (tabSearch) return loc.pathname === tabPath && loc.search === tabSearch;
    if (tab.path === "/dashboard") return loc.pathname === "/dashboard" && !loc.search;
    return loc.pathname === tabPath || loc.pathname.startsWith(tabPath + "/");
  };

  return (
    <nav className="bottom-tab-bar" aria-label="Navegação principal">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`bottom-tab${isActive(tab) ? " active" : ""}${tab.highlight ? " highlight" : ""}`}
          onClick={() => tab.path ? nav(tab.path) : onOpenMenu()}
          aria-label={tab.label}
          aria-current={isActive(tab) ? "page" : undefined}
        >
          <span className="bottom-tab-icon">{ICONS[tab.icon]}</span>
          <span className="bottom-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

const MENU_ADMIN = [
  {
    id: "home",
    label: "Início",
    icon: "home",
    path: "/dashboard",
    children: [
      { label: "Visão geral", path: "/dashboard" },
      { label: "Meus clientes", path: "/dashboard?filtro=todos" },
      { label: "Cadastrar cliente", path: "/cliente/novo" },
    ],
  },
  {
    id: "clientes",
    label: "Clientes",
    icon: "users",
    path: "/dashboard?filtro=todos",
    children: [
      { label: "Todos os clientes", path: "/dashboard?filtro=todos" },
      { label: "Sem aporte no mês", path: "/dashboard?filtro=semAporte" },
      { label: "Em reunião", path: "/dashboard?filtro=emReuniao" },
      { label: "Fee Based", path: "/dashboard?filtro=feeBased" },
    ],
  },
  {
    id: "objetivos",
    label: "Objetivos",
    icon: "goal",
    path: "/dashboard?filtro=objetivosDesalinhados",
    children: [
      { label: "Objetivos desalinhados", path: "/dashboard?filtro=objetivosDesalinhados" },
      { label: "Plano inviável", path: "/dashboard?filtro=inviavel" },
    ],
  },
  {
    id: "carteiras",
    label: "Carteiras",
    icon: "wallet",
    path: "/carteiras-desalinhadas",
    children: [
      { label: "Carteiras desalinhadas", path: "/carteiras-desalinhadas" },
      { label: "Vencimentos", path: "/vencimentos" },
    ],
  },
  {
    id: "mercado",
    label: "Mercado",
    icon: "trending",
    path: "/mercado",
    children: [
      { label: "Atualização de Mercado", path: "/mercado" },
      { label: "Vencimentos", path: "/vencimentos" },
    ],
  },
  { id: "vencimentos", label: "Vencimentos", icon: "calendar", path: "/vencimentos" },
  { id: "alertas", label: "Alertas", icon: "alert", path: "/dashboard?filtro=alertas" },
  { id: "estudos", label: "Estudos", icon: "book", path: "/mercado" },
  { id: "cadastrar", label: "Cadastrar Cliente", icon: "plus", path: "/cliente/novo" },
];

/** Menu reduzido para o CLIENTE FINAL (role === "cliente").
 *  Apenas as 5 páginas principais + Editar Perfil. As seções da home
 *  (Patrimônio, Rendas, Reserva, Dados) já aparecem como accordions
 *  na própria Visão Geral, então não duplicamos elas no menu.
 */
function buildMenuClienteFinal(id) {
  // Menu enxuto do cliente final — 5 itens principais.
  // Diagnóstico só aparece quando perfil está completo (gating na Fase 5).
  // Itens secundários ("Mercado", "Editar perfil", "Trocar senha") ficam ao final.
  return [
    { id: "visao",     label: "Início",            icon: "home",     path: `/me/home` },
    { id: "objetivos", label: "Meus sonhos",       icon: "goal",     path: `/me/objetivos` },
    { id: "carteira",  label: "Minha carteira",    icon: "wallet",   path: `/me/carteira` },
    { id: "fluxo",     label: "Receitas e gastos", icon: "dollar",   path: `/me/fluxo` },
    { id: "extrato",   label: "Extrato",           icon: "extrato",  path: `/me/extrato` },
    { id: "diag",      label: "Diagnóstico",       icon: "compass",  path: `/me/diagnostico` },
    { id: "mercado",   label: "Resumo de mercado", icon: "trending", path: "/mercado" },
    { id: "editar",    label: "Editar perfil",     icon: "simulate", path: `/cliente/${id}?edit=1` },
    { id: "senha",     label: "Trocar senha",      icon: "lock",     path: "/reset-password" },
  ];
}

/** Menu completo (assessor/master vendo um cliente).
 *  Inclui atalhos com hash (#patrimonio, #carteira-home, etc.) que o
 *  ClienteFicha consome para abrir o accordion certo e rolar até ele.
 */
function buildMenuCliente(id) {
  return [
    {
      id: "visao",
      label: "Visão Geral",
      icon: "home",
      path: `/cliente/${id}`,
    },
    {
      id: "patrimonio",
      label: "Patrimônio Consolidado",
      icon: "chart",
      path: `/cliente/${id}#patrimonio`,
    },
    {
      id: "carteira",
      label: "Carteira",
      icon: "wallet",
      path: `/cliente/${id}/carteira`,
      children: [
        { label: "Carteira completa", path: `/cliente/${id}/carteira` },
        { label: "Resumo da carteira (home)", path: `/cliente/${id}#carteira-home` },
      ],
    },
    {
      id: "extrato",
      label: "Extrato",
      icon: "extrato",
      path: `/cliente/${id}/extrato`,
      children: [
        { label: "Este mês", path: `/cliente/${id}/extrato` },
        { label: "Histórico completo", path: `/cliente/${id}/extrato?view=historico` },
        { label: "Dividendos recebidos", path: `/cliente/${id}/extrato?tipo=dividendo` },
        { label: "Aportes", path: `/cliente/${id}/extrato?tipo=aporte` },
        { label: "Retiradas", path: `/cliente/${id}/extrato?tipo=retirada` },
      ],
    },
    {
      id: "rendas",
      label: "Rendas e Despesas",
      icon: "dollar",
      path: `/cliente/${id}#rendas`,
      children: [
        { label: "Resumo (home)", path: `/cliente/${id}#rendas` },
        { label: "Detalhamento mensal", path: `/cliente/${id}/fluxo` },
        { label: "Mapa de aportes", path: `/cliente/${id}#aportes` },
      ],
    },
    {
      id: "dados",
      label: "Dados Cadastrais",
      icon: "users",
      path: `/cliente/${id}#dados`,
    },
    {
      id: "reserva",
      label: "Reserva de Emergência",
      icon: "alert",
      path: `/cliente/${id}#reserva`,
    },
    {
      id: "editar",
      label: "Editar Perfil",
      icon: "simulate",
      path: `/cliente/${id}?edit=1`,
    },
    {
      id: "objetivos",
      label: "Objetivos",
      icon: "goal",
      path: `/cliente/${id}/objetivos`,
    },
    {
      id: "diag",
      label: "Diagnóstico",
      icon: "compass",
      path: `/cliente/${id}/diagnostico`,
    },
    {
      id: "simul",
      label: "Simulador",
      icon: "simulate",
      path: `/cliente/${id}/simulador`,
    },
    {
      id: "voltar",
      label: "Voltar aos clientes",
      icon: "arrowLeft",
      path: "/dashboard",
    },
  ];
}

// Ícone do botão de abrir/fechar (hamburger / ×)
const MENU_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function Sidebar({ mode = "admin", clienteId = null, clienteNome = null }) {
  const nav = useNavigate();
  const location = useLocation();
  const { isCliente, isMaster, isAssessor } = useAuth();

  // Badge de aporte: lê localStorage que HomeLiberdade atualiza
  const aporteAlert = useMemo(() => {
    if (mode !== "cliente" || !clienteId) return null;
    try { return localStorage.getItem(`porto_aporte_alert_${clienteId}`) || null; }
    catch { return null; }
  }, [mode, clienteId, location.pathname]);
  const [monitorAberto, setMonitorAberto] = useState(false);

  // Quando o usuário logado é um CLIENTE (role === "cliente"), ele não deve
  // ter acesso a "Voltar aos clientes" nem ao dashboard do assessor.

  // Desktop: expande por HOVER com pequeno delay (150ms entrar / 220ms sair)
  // para não abrir por acidente e permitir atravessar submenu.
  // Mobile: expande via navbar (drawer) e o botão "Fechar" interno.
  const [expanded, setExpanded] = useState(false);
  const [openItem, setOpenItem] = useState(null);
  const asideRef = useRef(null);
  const hoverTimerRef = useRef(null);

  // Desktop vs. mobile (sidebar vira drawer)
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 900 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Limpa timers de hover ao desmontar (evita setState em componente já removido)
  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  // Ao mudar de rota, fecha o menu sozinho
  useEffect(() => { setExpanded(false); }, [location.pathname, location.search]);

  // Hover handlers (só desktop) — expandir/recolher com delays
  const handleMouseEnter = () => {
    if (isMobile) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setExpanded(true), 150);
  };
  const handleMouseLeave = () => {
    if (isMobile) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setExpanded(false);
      setOpenItem(null);
    }, 220);
  };

  // Evento global (disparado pela Navbar) para abrir o menu
  useEffect(() => {
    const handler = () => setExpanded(true);
    window.addEventListener("porto:open-menu", handler);
    return () => window.removeEventListener("porto:open-menu", handler);
  }, []);

  // Fecha ao clicar fora / ESC quando aberto
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    const onDown = (e) => {
      const el = asideRef.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      // ignora cliques no botão Menu da navbar (que foi quem abriu)
      if (e.target.closest?.(".navbar-menu-btn")) return;
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [expanded]);

  const menu = useMemo(() => {
    if (mode === "cliente" && clienteId) {
      // Cliente final → menu enxuto (5 páginas + Editar Perfil).
      // Assessor/master visitando o cliente → menu completo com atalhos
      // de #anchor para os accordions, útil pra atendimento.
      if (isCliente) return buildMenuClienteFinal(clienteId);
      return buildMenuCliente(clienteId);
    }
    // Master vê tudo + item de Administrador (usuários) + Monitor Online;
    // Assessor vê tudo exceto esses itens.
    const base = MENU_ADMIN;
    if (isMaster) {
      return [
        ...base,
        { id: "admin", label: "Administrador", icon: "users", path: "/admin/usuarios" },
        { id: "monitor", label: "Monitor Online", icon: "monitor", path: null },
      ];
    }
    if (isAssessor) return base;
    return base;
  }, [mode, clienteId, isCliente, isMaster, isAssessor]);

  // Ao recolher, limpa submenu aberto (depois da transição)
  useEffect(() => {
    if (!expanded && openItem) {
      const t = setTimeout(() => { setOpenItem(null); }, 260);
      return () => clearTimeout(t);
    }
  }, [expanded, openItem]);

  const go = (path) => {
    if (!path) return;
    // Caso especial: clicar "Início"/"/dashboard" estando já no dashboard
    // deve rolar pro topo (e limpar filtro/hash), não fazer nada.
    const isDashboardRoot = path === "/dashboard";
    const alreadyThere =
      location.pathname === "/dashboard" &&
      !location.search &&
      !location.hash;
    if (isDashboardRoot) {
      if (alreadyThere) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        nav("/dashboard", { replace: false });
        setTimeout(() => window.scrollTo({ top: 0, behavior: "auto" }), 50);
      }
      setExpanded(false);
      return;
    }
    // Caso especial: modo cliente — clicar na "Visão Geral"/logo do cliente
    // estando já em /cliente/:id deve rolar pro topo (sem recarregar). Se
    // estamos em uma sub-rota do cliente, navega para a raiz e rola pro topo.
    const clienteRoot = mode === "cliente" && clienteId ? `/cliente/${clienteId}` : null;
    if (clienteRoot && path === clienteRoot) {
      const alreadyOnRoot =
        location.pathname === clienteRoot && !location.hash && !location.search;
      if (alreadyOnRoot) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        nav(clienteRoot);
        setTimeout(() => window.scrollTo({ top: 0, behavior: "auto" }), 50);
      }
      setExpanded(false);
      return;
    }
    nav(path);
    setExpanded(false);
  };

  // Determina "o mais específico" como ativo — evita 3 itens acesos ao mesmo tempo.
  const activeId = useMemo(() => {
    const path = location.pathname;
    const query = location.search || "";
    const hash = location.hash || "";
    const full = path + query + hash;
    let bestId = null;
    let bestScore = -1;
    for (const item of menu) {
      const ip = item.path || "";
      if (!ip) continue;
      const ipPath = ip.split("?")[0].split("#")[0];
      let score = 0;
      if (ipPath === path) score += 2;
      else if (path.startsWith(ipPath) && ipPath !== "/dashboard") score += 1;
      // peso extra quando query/hash combinam
      if (ip.includes("?") || ip.includes("#")) {
        if (full.includes(ip.replace(/^[^?#]*/, ""))) score += 3;
      }
      if (score > bestScore) { bestScore = score; bestId = item.id; }
    }
    // fallback no modo admin: se o usuário está no /dashboard puro, "home" é ativo
    if (bestScore <= 0 && mode !== "cliente" && path === "/dashboard") bestId = "home";
    return bestId;
  }, [menu, location, mode]);

  const isActive = (item) => item.id === activeId;

  // Clique em item: quando expandida, abre submenu (se houver); senão, navega.
  // Item "monitor" abre o modal em vez de navegar.
  const onItemClick = (item) => {
    if (item.id === "monitor") {
      setMonitorAberto(true);
      setExpanded(false);
      return;
    }
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    if (expanded && hasChildren) {
      setOpenItem((prev) => (prev === item.id ? null : item.id));
    } else {
      go(item.path);
    }
  };

  const sidebarContent = (
    <div className="sidebar-inner">
      {/* Topo — logo Porto Invest */}
      <div className="sidebar-logo" onClick={() => { go(mode === "cliente" ? (isCliente ? "/me/home" : `/cliente/${clienteId}`) : "/dashboard"); }}>
        <img
          src="/assets/logo/logo-icon.svg"
          alt=""
          aria-hidden="true"
          className="sidebar-logo-mark-img"
        />
        <div className="sidebar-logo-text">
          {mode === "cliente" ? (
            <>
              <span className="sidebar-logo-title">{clienteNome?.split(" ")[0] || "Cliente"}</span>
              {/* Sem indicador de assessor/admin aqui: o cliente não deve perceber
                  que existe uma visão gerencial. */}
              <span className="sidebar-logo-sub">Painel do cliente</span>
            </>
          ) : (
            <img
              src="/assets/logo/logo-name.svg"
              alt="Porto Invest"
              className="sidebar-logo-name-img"
            />
          )}
        </div>
      </div>

      {/* Botão "Fechar" — visível apenas no drawer mobile.
          No desktop a expansão é por hover, então o botão fica oculto via CSS. */}
      <button
        type="button"
        className={`sidebar-toggle ${expanded ? "is-open" : ""}`}
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        aria-label={expanded ? "Fechar menu" : "Abrir menu"}
        aria-expanded={expanded}
        title={expanded ? "Fechar menu" : "Abrir menu"}
      >
        <span className="sidebar-icon">{expanded ? CLOSE_ICON : MENU_ICON}</span>
        <span className="sidebar-label">{expanded ? "Fechar" : "Menu"}</span>
      </button>

      {/* Menu lateral */}
      <nav className="sidebar-nav">
          {menu.map((item) => {
            const active = isActive(item);
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            const itemOpen = expanded && openItem === item.id;
            return (
              <div
                key={item.id}
                className={`sidebar-item ${active ? "active" : ""} ${itemOpen ? "open" : ""}`}
              >
                <button
                  type="button"
                  className="sidebar-item-head"
                  onClick={() => onItemClick(item)}
                  title={item.label}
                >
                  <span className="sidebar-icon">{ICONS[item.icon]}</span>
                  <span className="sidebar-label">{item.label}</span>
                  {item.id === "visao" && aporteAlert && (
                    <span
                      className="sidebar-badge-dot"
                      aria-label="Aporte pendente"
                      style={{ background: aporteAlert === "atrasado" ? "#ef4444" : "#f59e0b" }}
                    />
                  )}
                  {active && <span className="sidebar-active-dot" aria-hidden="true" />}
                  {hasChildren && <span className="sidebar-caret">›</span>}
                </button>

                {hasChildren && (
                  <div className="sidebar-sub">
                    {item.children.map((ch, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="sidebar-sub-item"
                        onClick={(e) => { e.stopPropagation(); go(ch.path); }}
                      >
                        {ch.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

      {/* Rodapé */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-dot" />
        <span className="sidebar-footer-text">
          {mode === "cliente" ? "Plano ativo" : "Online"}
        </span>
      </div>
    </div>
  );

  // ───────── MOBILE: drawer + bottom tab bar ─────────
  if (isMobile) {
    return (
      <>
        {expanded && (
          <div
            className="sidebar-mobile-backdrop"
            onClick={() => setExpanded(false)}
            aria-hidden="true"
          />
        )}
        <aside
          ref={asideRef}
          className={`sidebar sidebar-mobile ${expanded ? "expanded" : ""} ${mode === "cliente" ? "sidebar-cliente" : ""}`}
          aria-hidden={!expanded}
        >
          {sidebarContent}
        </aside>
        <BottomTabBar
          mode={mode}
          clienteId={clienteId}
          onOpenMenu={() => setExpanded(true)}
        />
        {monitorAberto && (
          <Suspense fallback={null}>
            <MonitorOnline onClose={() => setMonitorAberto(false)} />
          </Suspense>
        )}
      </>
    );
  }

  // ───────── DESKTOP: rail fixa + expansão por HOVER ─────────
  return (
    <>
      <aside
        ref={asideRef}
        className={`sidebar ${expanded ? "expanded" : ""} ${mode === "cliente" ? "sidebar-cliente" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {sidebarContent}
      </aside>
      {monitorAberto && <MonitorOnline onClose={() => setMonitorAberto(false)} />}
    </>
  );
}
