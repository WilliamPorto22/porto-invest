import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

/**
 * ChecklistOnboardingCliente — bloco de boas-vindas para perfil incompleto.
 *
 * Aparece no topo da MeHome (cliente final) ou do ClientePainel (assessor
 * vendo o cliente) enquanto o perfil não cumpre os 5 critérios de
 * perfilCompleto(). Cada item é clicável e leva pra rota de preenchimento
 * — e a rota muda conforme o contexto:
 *
 *   • Cliente final (logado como `cliente`)  → /me/objetivos, /me/fluxo, /me/carteira
 *   • Assessor/master vendo o cliente        → /cliente/:id/objetivos etc.
 *
 * O bug anterior usava sempre /me/*, e o MeRedirect chuta o assessor pra
 * /dashboard quando role !== "cliente" — o resultado era o assessor sair
 * da tela do cliente sem motivo. O cadastro pessoal sempre vai pra ficha
 * em edit mode (`/cliente/:id?edit=1`), funciona pros dois.
 *
 * Quando todos os itens estão feitos, o componente não é renderizado
 * (controle fica em PainelClienteShared via status.completo).
 */
function rotaParaItem(itemKey, { clienteId, isCliente }) {
  // Cadastro pessoal: ficha em modo edição funciona pros dois contextos.
  if (itemKey === "cadastro") return `/cliente/${clienteId}?edit=1`;

  if (isCliente) {
    switch (itemKey) {
      case "objetivo": return "/me/objetivos";
      case "receita":  return "/me/fluxo";
      case "despesa":  return "/me/fluxo";
      case "carteira": return "/me/carteira";
      default:         return "/me/home";
    }
  }

  // Assessor / master vendo o cliente — sempre rotas absolutas com :id.
  switch (itemKey) {
    case "objetivo": return `/cliente/${clienteId}/objetivos`;
    case "receita":  return `/cliente/${clienteId}/fluxo`;
    case "despesa":  return `/cliente/${clienteId}/fluxo`;
    case "carteira": return `/cliente/${clienteId}/carteira`;
    default:         return `/cliente/${clienteId}/painel`;
  }
}

export default function ChecklistOnboardingCliente({ status, primeiroNome, clienteId }) {
  const navigate = useNavigate();
  const { isCliente } = useAuth();
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
            onClick={() => {
              if (item.feito) return;
              const rota = rotaParaItem(item.key, { clienteId, isCliente });
              navigate(rota);
            }}
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
