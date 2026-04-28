/**
 * LoadingScreen — tela de loading premium full-screen.
 * Usada como fallback do Suspense (App.jsx) e em rotas que precisam
 * esperar dados antes de renderizar.
 *
 * Estilo: dark background com glow dourado pulsante + dots animados.
 * Pure CSS, < 1KB, sem dependências.
 */
export default function LoadingScreen({ texto = "Carregando" }) {
  return (
    <div className="pi-loading-screen">
      <div className="pi-loading-glow" />
      <div className="pi-loading-content">
        <div className="pi-loading-logo">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle
              cx="32"
              cy="32"
              r="28"
              stroke="url(#pi-loading-grad)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="40 200"
              fill="none"
            />
            <text
              x="32"
              y="40"
              textAnchor="middle"
              fontSize="22"
              fontWeight="300"
              fill="#FFB20F"
              fontFamily="-apple-system, 'SF Pro Display', sans-serif"
              letterSpacing="-0.02em"
            >
              Pi
            </text>
            <defs>
              <linearGradient id="pi-loading-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#F0A202" />
                <stop offset="100%" stopColor="#FFB20F" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="pi-loading-text">
          {texto}
          <span className="pi-loading-dot">.</span>
          <span className="pi-loading-dot">.</span>
          <span className="pi-loading-dot">.</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton — placeholder com shimmer animado pra blocos de conteúdo
 * que estão chegando do Firestore.
 *
 * Uso:
 *   <Skeleton width="100%" height={20} />
 *   <Skeleton width={120} height={40} radius={10} />
 */
export function Skeleton({ width = "100%", height = 16, radius = 8, style }) {
  return (
    <span
      className="pi-skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
      aria-busy="true"
      aria-label="Carregando"
    />
  );
}
