import { useNavigate } from "react-router-dom";

/**
 * ChecklistOnboardingCliente — bloco de boas-vindas para perfil incompleto.
 *
 * Aparece no topo da MeHome enquanto o cliente não cumpre os 5 critérios
 * de perfilCompleto(). Cada item é clicável e leva pra rota de preenchimento.
 *
 * Quando todos os itens estão feitos, o componente não é renderizado
 * (controle fica em MeHome via status.completo).
 */
export default function ChecklistOnboardingCliente({ status, primeiroNome }) {
  const navigate = useNavigate();
  const pct = Math.round((status.feitos / status.total) * 100);

  return (
    <div style={{
      background: "linear-gradient(180deg, rgba(240,162,2,0.08) 0%, rgba(13,19,33,0.4) 100%)",
      border: "1px solid rgba(240,162,2,0.25)",
      borderRadius: 18,
      padding: "26px 28px",
      marginBottom: 28,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "#F0A202",
        marginBottom: 10,
        fontWeight: 600,
      }}>
        Bem-vindo{primeiroNome ? `, ${primeiroNome}` : ""}
      </div>

      <div style={{
        fontSize: 24,
        color: "#F0EBD8",
        fontWeight: 500,
        lineHeight: 1.25,
        marginBottom: 4,
        letterSpacing: "-0.01em",
      }}>
        Falta pouco pra sua visão completa.
      </div>
      <div style={{
        fontSize: 13,
        color: "#9EB8D0",
        marginBottom: 20,
        lineHeight: 1.5,
      }}>
        Quando você terminar essas {status.total} etapas, liberamos o seu Diagnóstico personalizado.
      </div>

      {/* Barra de progresso */}
      <div style={{
        height: 4,
        background: "rgba(255,255,255,0.06)",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 22,
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "linear-gradient(90deg, #F0A202 0%, #FFD37A 100%)",
          borderRadius: 4,
          transition: "width 0.5s ease-out",
        }} />
      </div>

      {/* Lista */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {status.itens.map(item => (
          <button
            key={item.key}
            onClick={() => !item.feito && navigate(item.rota)}
            disabled={item.feito}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 14px",
              background: item.feito ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${item.feito ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 12,
              cursor: item.feito ? "default" : "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              transition: "background 0.15s, border 0.15s",
              opacity: item.feito ? 0.7 : 1,
            }}
            onMouseEnter={e => {
              if (!item.feito) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={e => {
              if (!item.feito) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: item.feito ? "#22c55e" : "transparent",
              border: item.feito ? "none" : "1.5px solid rgba(255,255,255,0.18)",
              color: "#fff", fontSize: 12, flexShrink: 0,
            }}>
              {item.feito ? "✓" : ""}
            </span>
            <span style={{
              flex: 1,
              fontSize: 14,
              color: item.feito ? "#86efac" : "#F0EBD8",
              textDecoration: item.feito ? "line-through" : "none",
            }}>
              {item.label}
            </span>
            {!item.feito && (
              <span style={{ fontSize: 13, color: "#F0A202" }}>→</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
