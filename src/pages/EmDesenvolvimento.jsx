import { useNavigate } from "react-router-dom";
import { Navbar } from "../components/Navbar";
import { Sidebar } from "../components/Sidebar";
import { Button } from "../components/ui";

export default function EmDesenvolvimento({
  titulo = "Em Desenvolvimento",
  descricao = "Esta área está sendo construída.",
  icone = "🚧",
}) {
  const nav = useNavigate();

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar />
      <Navbar showLogout={true} />

      <div className="dashboard-content with-sidebar">
        <div className="em-dev-wrapper">
          <div className="em-dev-icon">{icone}</div>
          <h1 className="em-dev-title">{titulo}</h1>
          <p className="em-dev-desc">{descricao}</p>

          <div className="em-dev-badge">
            <span className="em-dev-dot" />
            Em desenvolvimento
          </div>

          <p className="em-dev-hint">
            Em breve esta página estará completa.
            Por enquanto, você pode voltar ao painel principal e continuar acompanhando seus clientes.
          </p>

          <Button
            variant="secondary"
            size="md"
            onClick={() => nav("/dashboard")}
            leftIcon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
            }
          >
            Voltar ao painel
          </Button>
        </div>
      </div>
    </div>
  );
}
