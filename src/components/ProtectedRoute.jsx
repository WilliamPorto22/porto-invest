import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Protege rotas por autenticação e (opcionalmente) por role.
 *
 * Uso:
 *   <ProtectedRoute>                      // só requer estar logado
 *   <ProtectedRoute roles={["master"]}>   // exige role específica
 *   <ProtectedRoute roles={["master","assessor"]}>
 *
 * Se o usuário estiver logado mas não tiver a role necessária, é redirecionado
 * para /dashboard (não devolve ao /login para não entrar em loop).
 * Se não estiver logado, preserva a URL atual em state.from para o Login
 * poder redirecionar de volta após autenticação.
 *
 * Também cobra mustResetPassword: se o profile marcar que precisa trocar a
 * senha, qualquer rota protegida (exceto /reset-password) força ida pra lá.
 * Antes essa checagem só existia em Login.jsx, então clicar voltar do
 * /reset-password deixava o usuário entrar sem trocar a senha.
 */
export function ProtectedRoute({ children, roles }) {
  const { user, role, loading, profile } = useAuth();
  const location = useLocation();

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
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
