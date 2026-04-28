import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { logError } from "../utils/errorHandler";

/**
 * Botão de logout reutilizável — padronizado junto com os navbar-action-btn.
 */
export function LogoutButton({ className = "" }) {
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await signOut(auth);
      navigate("/", { replace: true });
    } catch (error) {
      logError("Logout", error);
      console.error("Erro ao fazer logout:", error);
    }
  }

  return (
    <button
      className={`navbar-action-btn danger ${className}`.trim()}
      onClick={handleLogout}
      title="Sair da plataforma"
    >
      <span className="navbar-btn-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <path d="M10 17l-5-5 5-5" />
          <path d="M15 12H5" />
        </svg>
      </span>
      <span className="navbar-btn-label">Logout</span>
    </button>
  );
}
