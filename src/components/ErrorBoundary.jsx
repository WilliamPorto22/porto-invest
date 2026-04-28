import { Component } from "react";

// Error boundary global — captura erros de render e evita tela branca.
// Renderiza fallback com CTA para recarregar. Em dev, mostra stack completa.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Em produção o console.error é preservado (drop-console só tira .log/.info/.debug).
    // Logs vão para Firebase Hosting logs via crashlytics/sentry se configurados no futuro.
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isDev = import.meta.env.DEV;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0D1321", color: "#e8f0f7", fontFamily: "system-ui, sans-serif",
        padding: "24px",
      }}>
        <div style={{
          maxWidth: 480, textAlign: "center",
          background: "#1D2D44", border: "1px solid rgba(62,92,118,0.35)",
          borderRadius: 16, padding: "32px 28px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Algo deu errado
          </h1>
          <p style={{ fontSize: 13, color: "#748CAB", lineHeight: 1.6, margin: "0 0 20px" }}>
            A aplicação encontrou um erro inesperado.
            Recarregue a página para continuar.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: "10px 24px", background: "#F0A202", border: "none",
              borderRadius: 8, color: "#0D1321", fontSize: 13, fontWeight: 600,
              cursor: "pointer", letterSpacing: "0.04em",
            }}
          >
            Recarregar
          </button>
          {isDev && this.state.error && (
            <pre style={{
              marginTop: 20, textAlign: "left", fontSize: 11,
              color: "#fca5a5", background: "rgba(0,0,0,0.3)",
              padding: "12px", borderRadius: 8, overflow: "auto", maxHeight: 200,
            }}>
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
