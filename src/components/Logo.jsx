/**
 * Componente Logo reutilizável — Porto Invest
 *
 * Variantes:
 *   - navbar      : ícone PI + wordmark "PORTO INVEST" (cabeçalho)
 *   - login       : ícone + wordmark empilhados (página de login)
 *   - icon-only   : só o monograma PI
 *   - name-only   : só o wordmark "PORTO INVEST"
 */
export function Logo({ variant = "navbar", className = "", height }) {
  if (variant === "icon-only") {
    return (
      <img
        src="/assets/logo/logo-icon.svg"
        alt="Porto Invest"
        className={`logo logo-icon ${className}`}
        style={{ height: height || 32, width: "auto", display: "block" }}
      />
    );
  }

  if (variant === "name-only") {
    return (
      <img
        src="/assets/logo/logo-name.svg"
        alt="Porto Invest"
        className={`logo logo-name ${className}`}
        style={{ height: height || 18, width: "auto", display: "block" }}
      />
    );
  }

  if (variant === "login") {
    return (
      <div className={`logo logo-login ${className}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <img src="/assets/logo/logo-icon.svg" alt="" style={{ height: height || 72, width: "auto", display: "block" }} />
        <div
          aria-label="Porto Invest"
          style={{
            fontFamily: "'SF Pro Display','Helvetica Neue',Arial,sans-serif",
            fontSize: 28,
            color: "#F0EBD8",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontWeight: 800, letterSpacing: "-0.6px" }}>PORTO</span>
          <span style={{ fontWeight: 400, letterSpacing: "0.5px", marginLeft: 10 }}>INVEST</span>
        </div>
      </div>
    );
  }

  // navbar (default) — ícone + wordmark lado a lado
  return (
    <div className={`logo logo-navbar ${className}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img
        src="/assets/logo/logo-icon.svg"
        alt=""
        aria-hidden="true"
        style={{ height: height || 30, width: "auto", display: "block" }}
      />
      <img
        src="/assets/logo/logo-name.svg"
        alt="Porto Invest"
        style={{ height: 16, width: "auto", display: "block" }}
      />
    </div>
  );
}
