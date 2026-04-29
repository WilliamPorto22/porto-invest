import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "../firebase";
import HomeLiberdade from "../components/cliente/HomeLiberdade";
import { Sidebar } from "../components/Sidebar";
import { Navbar } from "../components/Navbar";
import { perfilCompleto } from "../utils/perfilCompleto";
import ChecklistOnboardingCliente from "../components/cliente/ChecklistOnboardingCliente";
import PatrimonioConsolidadoCliente from "../components/cliente/PatrimonioConsolidadoCliente";

/**
 * MeHome — Página inicial dedicada do cliente.
 *
 * Carrega o doc /clientes/{profile.clienteId} e renderiza HomeLiberdade
 * isolada, sem o peso do ClienteFicha. Bundle do cliente fica enxuto.
 *
 * Estratégia de dados:
 *   - Hidrata instantaneamente do cache (lerClienteComFallback)
 *   - Mantém em sync via onSnapshot (atualiza ao vivo)
 *
 * Assessor/Master que cair aqui é redirecionado pelo MeRedirect; mas
 * por garantia, esta página também checa role.
 */
export default function MeHome() {
  const { profile, role, loading: authLoading } = useAuth();
  const [cliente, setCliente] = useState(null);
  const [carregandoCliente, setCarregandoCliente] = useState(true);

  const clienteId = profile?.clienteId;

  // 1) Hidratação rápida via cache + fallback
  useEffect(() => {
    if (!clienteId) return;
    let alive = true;
    lerClienteComFallback(clienteId, { isAlive: () => alive })
      .then((data) => {
        if (!alive) return;
        if (data?.exists !== false) setCliente(data?.data || data);
        setCarregandoCliente(false);
      })
      .catch(() => {
        if (alive) setCarregandoCliente(false);
      });
    return () => { alive = false; };
  }, [clienteId]);

  // 2) Sync ao vivo
  useEffect(() => {
    if (!clienteId) return;
    const unsub = onSnapshot(
      doc(db, "clientes", clienteId),
      (snap) => {
        if (snap.exists()) setCliente({ id: snap.id, ...snap.data() });
      },
      () => { /* silencia erros de permissão temporários durante refresh */ }
    );
    return () => unsub();
  }, [clienteId]);

  if (authLoading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando sua área...</div>
      </div>
    );
  }

  if (role && role !== "cliente") {
    return <Navigate to="/dashboard" replace />;
  }

  if (!clienteId) {
    return <Navigate to="/" replace />;
  }

  if (carregandoCliente && !cliente) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Preparando sua jornada...</div>
      </div>
    );
  }

  // Gating do Diagnóstico: enquanto perfil incompleto, esconde do menu.
  // Persiste em localStorage para o Sidebar (que não tem o doc do cliente)
  // ler sem precisar de outro fetch.
  const status = perfilCompleto(cliente);
  try {
    localStorage.setItem(`porto_perfil_completo_${clienteId}`, status.completo ? "1" : "0");
  } catch { /* localStorage indisponível, segue */ }

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode="cliente" clienteId={clienteId} />
      <Navbar />
      {/* Container padronizado — mesma largura/padding usados em
          Carteira, Diagnóstico e ClienteFicha (cliente-zoom + maxWidth 1280)
          para que toda navegação do cliente tenha bordas consistentes. */}
      <div
        className="dashboard-content with-sidebar cliente-zoom"
        style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}
      >
        {!status.completo && (
          <ChecklistOnboardingCliente
            status={status}
            primeiroNome={(cliente?.nome || "").split(" ")[0] || ""}
          />
        )}
        <HomeLiberdade cliente={cliente} clienteId={clienteId} />
        <PatrimonioConsolidadoCliente cliente={cliente} />
      </div>
    </div>
  );
}
