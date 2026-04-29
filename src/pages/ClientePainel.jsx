import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Sidebar } from "../components/Sidebar";
import { Navbar } from "../components/Navbar";
import PainelClienteShared from "../components/cliente/PainelClienteShared";
import { perfilCompleto } from "../utils/perfilCompleto";

/**
 * ClientePainel — Painel premium do cliente, visto pelo assessor/master.
 *
 * Mesmo conteúdo do `/me/home` (HomeLiberdade + Patrimônio Consolidado +
 * checklist), com **botão "Voltar aos clientes"** no topo. Garante que
 * cliente e assessor enxergam EXATAMENTE a mesma visão da jornada.
 *
 * Para edição da ficha cadastral completa do cliente, o assessor clica
 * em "Editar Perfil" no menu lateral, que leva para `/cliente/:id/editar`
 * (ou `/cliente/:id?edit=1`, alias do `ClienteFicha` em modo edição).
 *
 * Cliente final que cair aqui é redirecionado para `/me/home`.
 */
export default function ClientePainel() {
  const { id: clienteId } = useParams();
  const navigate = useNavigate();
  const { isCliente, loading: authLoading } = useAuth();
  const [cliente, setCliente] = useState(null);
  const [carregando, setCarregando] = useState(true);

  // 1) Hidratação rápida via cache + fallback
  useEffect(() => {
    if (!clienteId) return;
    let alive = true;
    lerClienteComFallback(clienteId, { isAlive: () => alive })
      .then((data) => {
        if (!alive) return;
        if (data?.exists !== false) setCliente(data?.data || data);
        setCarregando(false);
      })
      .catch(() => {
        if (alive) setCarregando(false);
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
      () => { /* silencia */ }
    );
    return () => unsub();
  }, [clienteId]);

  if (authLoading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando painel do cliente...</div>
      </div>
    );
  }

  // Cliente final nunca deveria abrir essa rota — manda pra /me/home.
  if (isCliente) {
    return <Navigate to="/me/home" replace />;
  }

  if (carregando && !cliente) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando dados do cliente...</div>
      </div>
    );
  }

  // Espelha o gating do Diagnóstico: se assessor abrir o painel sem o
  // perfil completo, mantemos a flag em localStorage (caso ele clique
  // em /me/diagnostico via menu) coerente com o estado real do cliente.
  const status = perfilCompleto(cliente);
  try {
    localStorage.setItem(`porto_perfil_completo_${clienteId}`, status.completo ? "1" : "0");
  } catch { /* segue */ }

  const primeiroNome = (cliente?.nome || "").split(" ")[0] || "este cliente";

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode="cliente" clienteId={clienteId} clienteNome={cliente?.nome} />
      <Navbar
        showLogout={true}
        actionButtons={[
          {
            icon: "←",
            label: "Voltar aos clientes",
            variant: "secondary",
            onClick: () => navigate("/dashboard"),
            title: "Voltar à lista de clientes",
          },
          {
            label: "Editar perfil",
            variant: "primary",
            onClick: () => navigate(`/cliente/${clienteId}?edit=1`),
            title: "Abrir ficha de cadastro completa",
          },
        ]}
      />
      <div
        className="dashboard-content with-sidebar cliente-zoom"
        style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}
      >
        {/* Faixa contextual — assessor sabe qual cliente está vendo */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          padding: "10px 14px",
          background: "rgba(240,162,2,0.06)",
          border: "1px solid rgba(240,162,2,0.18)",
          borderRadius: 10,
          flexWrap: "wrap",
          gap: 8,
        }}>
          <div style={{ fontSize: 12, color: "#fcd34d", letterSpacing: "0.04em" }}>
            <span style={{ opacity: 0.7 }}>Você está vendo o painel de</span>
            {" "}
            <strong style={{ color: "#F0EBD8" }}>{primeiroNome}</strong>
            {" "}
            <span style={{ opacity: 0.6, fontSize: 11 }}>
              · visão idêntica à do cliente
            </span>
          </div>
        </div>

        <PainelClienteShared cliente={cliente} clienteId={clienteId} />
      </div>
    </div>
  );
}
