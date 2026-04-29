import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Sidebar } from "../components/Sidebar";
import { Navbar } from "../components/Navbar";
import ResumoPatrimonialCliente from "../components/cliente/ResumoPatrimonialCliente";
import {
  listarSnapshots,
  garantirSnapshotMensalAuto,
} from "../services/snapshotsCarteira";

/**
 * MeResumo
 *
 * Página dedicada ao "Resumo Patrimonial" — visão completa estilo das
 * prints solicitadas em 29/04/2026 (donut por categoria, Brasil×Global,
 * distribuição em R$, classes da carteira, liquidez, bens, evolução
 * mensal). Atende dois fluxos:
 *
 *   • cliente final → entra via `/me/resumo` (sem :id na URL)
 *   • assessor/master visualizando o cliente → `/cliente/:id/resumo`
 *
 * O resolver decide a partir de useParams + profile.clienteId.
 */
export default function MeResumo() {
  const { id: paramId } = useParams();
  const navigate = useNavigate();
  const { profile, isCliente, role, loading: authLoading } = useAuth();

  // Cliente final usa /me/resumo (sem :id) — pega do profile.
  // Assessor/master usa /cliente/:id/resumo.
  const clienteId = paramId || profile?.clienteId || null;
  const isAdminVendoCliente = !!paramId && !isCliente;

  const [cliente, setCliente] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!clienteId) return;
    let alive = true;
    lerClienteComFallback(clienteId, { isAlive: () => alive })
      .then((data) => {
        if (!alive) return;
        if (data?.exists !== false) setCliente(data?.data || data);
        setCarregando(false);
      })
      .catch(() => { if (alive) setCarregando(false); });
    return () => { alive = false; };
  }, [clienteId]);

  useEffect(() => {
    if (!clienteId) return;
    const unsub = onSnapshot(
      doc(db, "clientes", clienteId),
      (snap) => { if (snap.exists()) setCliente({ id: snap.id, ...snap.data() }); },
      () => { /* silencia */ }
    );
    return () => unsub();
  }, [clienteId]);

  // Snapshot automático + listagem
  useEffect(() => {
    if (!cliente || !clienteId) return;
    let alive = true;
    (async () => {
      try { await garantirSnapshotMensalAuto(clienteId, cliente); }
      catch { /* segue */ }
      try {
        const lista = await listarSnapshots(clienteId);
        if (alive) setSnapshots(lista || []);
      } catch { /* sem snapshots */ }
    })();
    return () => { alive = false; };
  }, [cliente, clienteId]);

  if (authLoading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando resumo patrimonial...</div>
      </div>
    );
  }

  if (!clienteId) return <Navigate to="/" replace />;
  if (!paramId && role && role !== "cliente") {
    return <Navigate to="/dashboard" replace />;
  }
  if (carregando && !cliente) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando dados...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode="cliente" clienteId={clienteId} clienteNome={cliente?.nome} />
      <Navbar
        showLogout={true}
        actionButtons={isAdminVendoCliente ? [
          {
            icon: "←",
            label: "Voltar aos clientes",
            variant: "secondary",
            onClick: () => navigate("/dashboard"),
            title: "Voltar à lista de clientes",
          },
        ] : []}
      />
      <div
        className="dashboard-content with-sidebar cliente-zoom"
        style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}
      >
        <ResumoPatrimonialCliente cliente={cliente} snapshots={snapshots} />
      </div>
    </div>
  );
}
