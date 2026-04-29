import { useParams } from "react-router-dom";
import MinhaAlocacao from "./MinhaAlocacao";

/**
 * Visão do assessor para "Comparação de carteira" do cliente.
 *
 * É exatamente a mesma página que o cliente vê em /minha-alocacao
 * (perfis padrão + donut/bar da carteira atual + próximos ajustes +
 *  recomendações por ativo), só que:
 *   - lê o clienteId do parâmetro :id da URL em vez de profile.clienteId;
 *   - mostra um botão "Voltar ao painel" na navbar.
 *
 * Sidebar e Navbar ficam idênticas ao resto da plataforma — antes essa
 * página tinha um layout próprio que quebrava a consistência.
 */
export default function AjustesCarteira() {
  const { id } = useParams();
  return <MinhaAlocacao clienteIdOverride={id} mostrarVoltar />;
}
