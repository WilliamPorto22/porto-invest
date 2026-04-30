import HomeLiberdade from "./HomeLiberdade";
import ChecklistOnboardingCliente from "./ChecklistOnboardingCliente";
import ResumoPatrimonialCliente from "./ResumoPatrimonialCliente";
import { perfilCompleto } from "../../utils/perfilCompleto";

/**
 * PainelClienteShared — conteúdo da home do cliente, reutilizado em duas páginas:
 *   1. /me/home          → cliente vendo o próprio painel (MeHome)
 *   2. /cliente/:id/painel → assessor/master vendo o painel do cliente
 *
 * Garante que cliente e assessor enxergam EXATAMENTE a mesma visão da
 * jornada do cliente (HomeLiberdade + Patrimônio Consolidado + checklist
 * de onboarding quando aplicável). A diferença entre os dois fluxos fica
 * fora deste componente — Sidebar/Navbar (botão "Voltar aos clientes" no
 * caso do assessor) e gating de role.
 *
 * Este componente NÃO renderiza Sidebar/Navbar — quem chama é responsável
 * pelo layout externo.
 */
export default function PainelClienteShared({ cliente, clienteId, snapshots = [] }) {
  if (!cliente || !clienteId) return null;

  const status = perfilCompleto(cliente);
  const primeiroNome = (cliente?.nome || "").split(" ")[0] || "";

  return (
    <>
      {!status.completo && (
        <ChecklistOnboardingCliente
          status={status}
          primeiroNome={primeiroNome}
        />
      )}
      <HomeLiberdade cliente={cliente} clienteId={clienteId} snapshots={snapshots} />
      <div style={{ marginTop: 28 }}>
        <ResumoPatrimonialCliente cliente={cliente} snapshots={snapshots} />
      </div>
    </>
  );
}
