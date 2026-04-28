import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "./LogoutButton";
import { Logo } from "./Logo";
import { useAuth } from "../hooks/useAuth";
import "../styles/navbar.css";

/**
 * Navbar padronizada para todas as páginas
 * - Logo
 * - Busca com dropdown global (quando searchSuggestions é passado)
 * - Botões de ação (mesma altura/largura via CSS)
 * - Logout
 *
 * Props:
 *   searchSuggestions = [{ group: "Clientes", items: [{label, sublabel, onClick, icon}] }]
 */
export function Navbar({
  showSearch = false,
  searchValue = "",
  onSearchChange = null,
  searchSuggestions = null,
  actionButtons = [],
  // eslint-disable-next-line no-unused-vars
  title = null,
  showLogout = false,
  userBadge = null, // chip opcional (ex.: "Admin · William · R$ 1.2M") exibido ao lado das ações
  notificationsBell = null, // componente do sino de notificações (canto direito)
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isCliente } = useAuth();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const searchBoxRef = useRef(null);

  const openMobileMenu = (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("porto:open-menu"));
  };

  // Se a rota atual é de cliente, o logo deve ir para a "home do cliente"
  // (/cliente/:id), e não para /dashboard — nem admin, nem cliente devem
  // ser jogados fora do contexto do cliente só por clicar no logo.
  const clienteMatch = location.pathname.match(/^\/cliente\/([^/]+)/);
  const isClienteRoute = !!clienteMatch && clienteMatch[1] !== "novo";
  const clienteRoot = isClienteRoute ? `/cliente/${clienteMatch[1]}` : null;

  const goHome = () => {
    if (isClienteRoute && clienteRoot) {
      if (location.pathname === clienteRoot && !location.hash && !location.search) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        navigate(clienteRoot);
        setTimeout(() => window.scrollTo({ top: 0, behavior: "auto" }), 50);
      }
      return;
    }
    // Cliente logado em rota não-cliente: não deve ser jogado para /dashboard.
    if (isCliente) return;
    const onDashboard = location.pathname === "/dashboard";
    if (onDashboard) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (location.hash || location.search) {
        navigate("/dashboard", { replace: true });
      }
    } else {
      navigate("/dashboard");
      setTimeout(() => window.scrollTo({ top: 0, behavior: "auto" }), 50);
    }
  };

  // Fecha sugestões ao clicar fora
  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (e) => {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target)) setSuggestOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setSuggestOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [suggestOpen]);

  const hasSuggestions =
    !!searchSuggestions &&
    searchSuggestions.some((g) => g.items && g.items.length > 0);

  const totalItems = hasSuggestions
    ? searchSuggestions.reduce((acc, g) => acc + (g.items?.length || 0), 0)
    : 0;

  return (
    <nav className="navbar navbar-container">
      {/* Botão Menu (mobile) */}
      <button
        type="button"
        className="navbar-menu-btn"
        onClick={openMobileMenu}
        aria-label="Abrir menu de navegação"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span className="navbar-menu-btn-label">Menu</span>
      </button>

      {/* Logo */}
      <div className="navbar-brand" onClick={goHome}>
        <Logo variant="navbar" />
      </div>

      {/* Centro — busca */}
      <div className="navbar-center">
        {showSearch && onSearchChange && (
          <div className="navbar-search" ref={searchBoxRef}>
            <input
              type="text"
              className="navbar-search-input"
              placeholder="Pesquisar"
              value={searchValue}
              onChange={(e) => { onSearchChange(e.target.value); setSuggestOpen(true); }}
              onFocus={() => setSuggestOpen(true)}
            />
            <svg
              className="navbar-search-icon"
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>

            {suggestOpen && searchValue.trim() && hasSuggestions && (
              <div className="navbar-search-dropdown" role="listbox">
                {searchSuggestions.map((g, gi) =>
                  g.items && g.items.length > 0 ? (
                    <div key={gi} className="navbar-search-group">
                      <div className="navbar-search-group-title">{g.group}</div>
                      {g.items.map((it, ii) => (
                        <button
                          key={ii}
                          type="button"
                          className="navbar-search-item"
                          onClick={() => { it.onClick?.(); setSuggestOpen(false); }}
                        >
                          {it.icon && <span className="navbar-search-item-icon">{it.icon}</span>}
                          <span className="navbar-search-item-texts">
                            <span className="navbar-search-item-label">{it.label}</span>
                            {it.sublabel && <span className="navbar-search-item-sub">{it.sublabel}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null
                )}
              </div>
            )}

            {suggestOpen && searchValue.trim() && !hasSuggestions && totalItems === 0 && (
              <div className="navbar-search-dropdown">
                <div className="navbar-search-empty">Nenhum resultado para "{searchValue}"</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ações à direita */}
      <div className="navbar-actions">
        {userBadge && (
          <span
            className="navbar-user-badge"
            title={userBadge.title || ""}
          >
            {userBadge.label}
          </span>
        )}

        {actionButtons.map((btn, idx) => (
          <button
            key={idx}
            className={`navbar-action-btn ${btn.variant || ""}`}
            onClick={btn.onClick}
            disabled={btn.disabled}
            title={btn.title}
          >
            {btn.icon && <span className="navbar-btn-icon">{btn.icon}</span>}
            {btn.label && <span className="navbar-btn-label">{btn.label}</span>}
          </button>
        ))}

        {notificationsBell}
        {showLogout && !isCliente && (
          <button
            className="navbar-action-btn"
            onClick={() => navigate("/reset-password")}
            title="Trocar minha senha"
          >
            <span className="navbar-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                <circle cx="12" cy="15.5" r="1" />
              </svg>
            </span>
            <span className="navbar-btn-label">Trocar senha</span>
          </button>
        )}
        {showLogout && <LogoutButton />}
      </div>
    </nav>
  );
}
