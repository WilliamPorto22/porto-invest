// ═════════════════════════════════════════════════════════
// RESPONSIVE BREAKPOINTS
// ═════════════════════════════════════════════════════════
export const BREAKPOINTS = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
};

export const T = {
  // Cores base — Paleta Principal
  bg:        "#0D1321",
  bgCard:    "#1D2D44",
  bgSecondary: "#162234",
  bgHover:   "#243756",
  border:    "rgba(62,92,118,0.35)",
  borderFocus:"rgba(240,162,2,0.5)",

  // Texto
  textPrimary:   "#F0EBD8",
  textSecondary: "#748CAB",
  textMuted:     "#3E5C76",

  // Dourado Premium
  gold:      "#F0A202",
  goldLight: "#FFB20F",
  goldBright:"#F1C40F",
  goldDim:   "rgba(240,162,2,0.12)",
  goldBorder:"rgba(240,162,2,0.28)",

  // Suporte
  blue:      "#1982C4",
  blueDim:   "rgba(25,130,196,0.12)",
  success:   "#00CC66",
  successDim:"rgba(0,204,102,0.12)",
  warning:   "#FFB20F",
  warningDim:"rgba(255,178,15,0.12)",
  danger:    "#ef4444",
  dangerDim: "rgba(239,68,68,0.12)",
  purple:    "#6A4C93",
  purpleDim: "rgba(106,76,147,0.15)",

  // Tipografia
  fontFamily: "-apple-system,'SF Pro Display','Helvetica Neue',sans-serif",

  // Raios — Modernizado
  radiusSm:  10,
  radiusMd:  14,
  radiusLg:  18,
  radiusXl:  24,

  // Sombras — Profundidade Realista
  cardShadow: "0 4px 16px rgba(0,0,0,0.4)",
  shadowSm:   "0 2px 8px rgba(0,0,0,0.3)",
  shadowMd:   "0 4px 16px rgba(0,0,0,0.4)",
  shadowLg:   "0 8px 32px rgba(0,0,0,0.5)",
  shadowGold: "0 4px 20px rgba(240,162,2,0.15)",
};

// Componentes reutilizáveis
export const C = {
  bg: {
    minHeight: "100vh",
    background: T.bg,
    padding: "0",
    fontFamily: T.fontFamily,
    color: T.textPrimary,
  },

  container: {
    width: "100%",
    maxWidth: "100%",
    padding: "28px 16px 60px",
    margin: "0 auto",
    boxSizing: "border-box",
  },

  containerNarrow: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "28px 20px 60px",
  },

  containerWide: {
    maxWidth: 1280,
    margin: "0 auto",
    padding: "28px 48px 60px",
  },

  // Navbar topo — Glassmorphism
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: `0.5px solid rgba(62,92,118,0.4)`,
    background: "rgba(13,19,33,0.85)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },

  // Card padrão
  card: {
    background: T.bgCard,
    border: `0.5px solid ${T.border}`,
    borderRadius: T.radiusLg,
    padding: "20px",
    boxShadow: T.shadowSm,
  },

  // Card clicável
  cardClickable: {
    background: T.bgCard,
    border: `0.5px solid ${T.border}`,
    borderRadius: T.radiusLg,
    padding: "20px",
    cursor: "pointer",
    transition: "border-color 0.25s, box-shadow 0.25s, transform 0.25s",
    boxShadow: T.shadowSm,
  },

  // Input padrão
  input: {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: `0.5px solid rgba(62,92,118,0.4)`,
    borderRadius: T.radiusMd,
    padding: "13px 16px",
    fontSize: 15,
    color: T.textPrimary,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: T.fontFamily,
    letterSpacing: "0.01em",
  },

  // Select
  select: {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: `0.5px solid rgba(62,92,118,0.4)`,
    borderRadius: T.radiusMd,
    padding: "13px 16px",
    fontSize: 15,
    color: T.textPrimary,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: T.fontFamily,
    appearance: "none",
  },

  // Label
  label: {
    fontSize: 10.5,
    color: "#b8c7d9",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    display: "block",
    marginBottom: 8,
    fontWeight: 600,
  },

  // Botão primário (dourado)
  btnPrimary: {
    width: "100%",
    padding: "15px",
    background: T.goldDim,
    border: `1px solid ${T.goldBorder}`,
    borderRadius: T.radiusMd,
    fontSize: 11,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: T.gold,
    cursor: "pointer",
    fontFamily: T.fontFamily,
    fontWeight: 500,
    transition: "all 0.25s ease",
  },

  // Botão secundário (ghost)
  btnSecondary: {
    padding: "13px 20px",
    background: "none",
    border: `0.5px solid ${T.border}`,
    borderRadius: T.radiusMd,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: T.textSecondary,
    cursor: "pointer",
    fontFamily: T.fontFamily,
    transition: "all 0.25s ease",
  },

  // Botão danger
  btnDanger: {
    padding: "8px 14px",
    background: "rgba(239,68,68,0.08)",
    border: "0.5px solid rgba(239,68,68,0.2)",
    borderRadius: T.radiusSm,
    fontSize: 11,
    color: T.danger,
    cursor: "pointer",
    fontFamily: T.fontFamily,
    transition: "all 0.25s ease",
  },

  // Título de página
  pageTitle: {
    fontSize: 26,
    fontWeight: 300,
    color: T.textPrimary,
    letterSpacing: "-0.01em",
    marginBottom: 6,
    lineHeight: 1.2,
  },

  // Subtítulo
  pageSub: {
    fontSize: 13,
    color: T.textSecondary,
    marginBottom: 32,
    lineHeight: 1.7,
    letterSpacing: "0.01em",
  },

  // Seção header
  sectionHeader: {
    fontSize: 9,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: T.textMuted,
    marginBottom: 14,
    marginTop: 28,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },

  // Divider
  divider: {
    height: "0.5px",
    background: T.border,
    flex: 1,
  },

  // Progress bar wrapper
  progressBar: {
    height: 1,
    background: "rgba(255,255,255,0.04)",
    borderRadius: 1,
    overflow: "hidden",
    marginBottom: 36,
  },

  // Back button
  backBtn: {
    background: "none",
    border: "none",
    color: T.textMuted,
    fontSize: 11,
    cursor: "pointer",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "0",
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 28,
    fontFamily: T.fontFamily,
    transition: "color 0.2s",
  },

  // Avatar
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 11,
    background: `linear-gradient(135deg,#1a2d4a,#0d1e38)`,
    border: `1px solid ${T.goldBorder}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  avatarText: {
    fontSize: 13,
    color: T.gold,
    fontWeight: 400,
    letterSpacing: "0.06em",
  },

  // Pill de status
  pill: (cor) => ({
    fontSize: 10,
    padding: "4px 12px",
    borderRadius: 20,
    background: `${cor}18`,
    color: cor,
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
    fontWeight: 500,
  }),

  // KPI card
  kpiCard: {
    background: T.bgCard,
    border: `0.5px solid ${T.border}`,
    borderRadius: T.radiusMd,
    padding: "14px 16px",
    boxShadow: T.shadowSm,
  },

  kpiLabel: {
    fontSize: 9,
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: 8,
  },

  kpiValue: {
    fontSize: 22,
    fontWeight: 300,
    color: T.textPrimary,
    letterSpacing: "-0.01em",
  },

  // Alert box
  alertRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: T.bgCard,
    border: `0.5px solid ${T.border}`,
    borderRadius: T.radiusMd,
    padding: "12px 16px",
    marginBottom: 6,
  },

  alertDot: (cor) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: cor,
    flexShrink: 0,
  }),
};
