import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * MeRedirect — namespace `/me/*` é a porta de entrada do cliente.
 *
 * Cada rota `/me/X` resolve dinamicamente para `/cliente/{profile.clienteId}/X`
 * (ou `/cliente/{profile.clienteId}` quando `subpath` for vazio).
 *
 * Por que essa camada existe:
 *   - Cliente nunca digita id na URL — entra em `/me/home` e o app resolve.
 *   - Assessor/Master que cair em `/me/*` por engano vai pro `/dashboard`.
 *   - Prepara terreno para as Fases 4–6 substituírem cada redirect por uma
 *     página leve dedicada, mantendo a URL pública `/me/*`.
 *
 * Uso (em App.jsx):
 *   <Route path="/me/home"      element={<MeRedirect />} />
 *   <Route path="/me/objetivos" element={<MeRedirect subpath="objetivos" />} />
 */
export default function MeRedirect({ subpath = "" }) {
  const { profile, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando...</div>
      </div>
    );
  }

  // Assessor/Master que veio parar aqui por algum motivo: manda pro dashboard.
  if (role && role !== "cliente") {
    return <Navigate to="/dashboard" replace />;
  }

  // Cliente sem clienteId no profile: estado inválido, devolve pro login.
  const clienteId = profile?.clienteId;
  if (!clienteId) {
    return <Navigate to="/" replace />;
  }

  // Gating do Diagnóstico — perfil precisa estar completo.
  // Status é populado em MeHome via perfilCompleto(). Se cliente digitar
  // /me/diagnostico direto sem completar, manda pra /me/home com flag.
  if (subpath === "diagnostico") {
    let perfilOk = false;
    try { perfilOk = localStorage.getItem(`porto_perfil_completo_${clienteId}`) === "1"; }
    catch { /* localStorage indisponível, considera incompleto */ }
    if (!perfilOk) {
      return <Navigate to="/me/home?perfilIncompleto=1" replace />;
    }
  }

  const destino = subpath
    ? `/cliente/${clienteId}/${subpath}`
    : `/cliente/${clienteId}`;

  return <Navigate to={destino} replace />;
}
