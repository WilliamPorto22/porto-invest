import { Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ROLES } from "../constants/roles";

/**
 * Protege rotas por autenticação, role e (opcionalmente) ownership.
 *
 * Props:
 *   roles      — lista de roles permitidas. Se vazia/ausente, qualquer logado entra.
 *   ownerOnly  — se true E o usuário for cliente, só permite quando :id da URL
 *                bater com profile.clienteId. Master/assessor passam direto.
 *
 * Uso:
 *   <ProtectedRoute>                              // só requer login
 *   <ProtectedRoute roles={["master"]}>           // role específica
 *   <ProtectedRoute roles={["master","assessor"]}>
 *   <ProtectedRoute ownerOnly>                    // cliente só vê o próprio :id
 *
 * Quando bloqueia, redireciona pra rota apropriada ao papel:
 *   - master/assessor → /dashboard
 *   - cliente         → /cliente/{clienteId}  (futuramente /me/home na Fase 2)
 *   - sem role/clienteId → / (login)
 */
function rotaInicialPorPapel(role, profile) {
  if (role === ROLES.MASTER || role === ROLES.ASSESSOR) return "/dashboard";
  if (role === ROLES.CLIENTE && profile?.clienteId) return `/cliente/${profile.clienteId}`;
  return "/";
}

export function ProtectedRoute({ children, roles, ownerOnly = false }) {
  const { user, role, loading, profile } = useAuth();
  const location = useLocation();
  const params = useParams();

  if (loading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (profile?.mustResetPassword && location.pathname !== "/reset-password") {
    return <Navigate to="/reset-password" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(role)) {
    return <Navigate to={rotaInicialPorPapel(role, profile)} replace />;
  }

  // Ownership: cliente só pode acessar o próprio :id da URL.
  // Master e assessor passam direto. Cliente sem clienteId no profile cai pro login.
  if (ownerOnly && role === ROLES.CLIENTE) {
    const idDaUrl = params.id || params.clienteId;
    if (!profile?.clienteId) {
      return <Navigate to="/" replace />;
    }
    if (idDaUrl && idDaUrl !== profile.clienteId) {
      return <Navigate to={`/cliente/${profile.clienteId}`} replace />;
    }
  }

  return children;
}
