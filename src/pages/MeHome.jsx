import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Sidebar } from "../components/Sidebar";
import { Navbar } from "../components/Navbar";
import PainelClienteShared from "../components/cliente/PainelClienteShared";
import { perfilCompleto } from "../utils/perfilCompleto";
import { garantirSnapshotMensalAuto, listarSnapshots } from "../services/snapshotsCarteira";

/**
 * MeHome — Página inicial dedicada do cliente final.
 *
 * Carrega o doc /clientes/{profile.clienteId} e renderiza o painel
 * compartilhado (HomeLiberdade + Patrimônio Consolidado + checklist).
 *
 * Para o assessor visualizando o painel do cliente, ver `ClientePainel`
 * (mesmo conteúdo, layout externo levemente diferente: botão "Voltar
 * aos clientes" no topo).
 */
export default function MeHome() {
  const { profile, role, loading: authLoading } = useAuth();
  const [cliente, setCliente] = useState(null);
  const [carregandoCliente, setCarregandoCliente] = useState(true);
  const [snapshots, setSnapshots] = useState([]);

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
      () => { /* silencia erros de permissão durante refresh */ }
    );
    return () => unsub();
  }, [clienteId]);

  // 3) Snapshot automático do mês corrente (uma vez por sessão/mês)
  useEffect(() => {
    if (!cliente || !clienteId) return;
    const ano = new Date().getFullYear();
    const mes = String(new Date().getMonth() + 1).padStart(2, "0");
    const mesRef = `${ano}-${mes}`;
    const guardKey = `porto_snap_auto_${clienteId}_${mesRef}`;
    try { if (localStorage.getItem(guardKey) === "1") return; }
    catch { /* localStorage indisponível */ }
    garantirSnapshotMensalAuto(clienteId, cliente)
      .then(() => { try { localStorage.setItem(guardKey, "1"); } catch { /* noop */ } })
      .catch(() => { /* silencia falha de permissão/offline */ });
  }, [cliente, clienteId]);

  // 4) Lista de snapshots para alimentar o gráfico de evolução mensal
  useEffect(() => {
    if (!clienteId) return;
    let alive = true;
    listarSnapshots(clienteId)
      .then((lista) => { if (alive) setSnapshots(lista || []); })
      .catch(() => { /* sem snapshots */ });
    return () => { alive = false; };
  }, [clienteId, cliente]);

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

  // Gating do Diagnóstico — persiste status p/ Sidebar (que não tem o doc).
  const status = perfilCompleto(cliente);
  try {
    localStorage.setItem(`porto_perfil_completo_${clienteId}`, status.completo ? "1" : "0");
  } catch { /* localStorage indisponível */ }

  // Snapshot mensal automático — uma vez por sessão por cliente, com guard
  // em localStorage pra não escrever a cada render. O guard usa o mesRef
  // atual: ao virar o mês, dispara de novo. Falhas são silenciosas (sem
  // permissão / offline) — o usuário ainda vê a Carteira normal.

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar mode="cliente" clienteId={clienteId} clienteNome={cliente?.nome} />
      <Navbar showLogout={true} />
      <div
        className="dashboard-content with-sidebar cliente-zoom"
        style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px" }}
      >
        <PainelClienteShared cliente={cliente} clienteId={clienteId} snapshots={snapshots} />
      </div>
    </div>
  );
}
