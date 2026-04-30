import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import EmDesenvolvimento from "./pages/EmDesenvolvimento";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import MeRedirect from "./components/MeRedirect";
import { ROLES } from "./constants/roles";
import WhatsAppButton from "./components/WhatsAppButton";
import AssessorOnboardingModal from "./components/AssessorOnboardingModal";
// Login é a primeira tela que todos veem — carregado de forma eager
// para evitar o spinner de "carregando…" antes do formulário aparecer.
import Login from "./pages/Login";

// Demais páginas carregadas sob demanda para reduzir o bundle inicial.
const Dashboard         = lazy(() => import("./pages/Dashboard"));
const ClienteFicha      = lazy(() => import("./pages/ClienteFicha"));
const Objetivos         = lazy(() => import("./pages/Objetivos"));
const ObjetivoDetalhes  = lazy(() => import("./pages/ObjetivoDetalhes"));
const Carteira          = lazy(() => import("./pages/Carteira"));
const FluxoMensal       = lazy(() => import("./pages/FluxoMensal"));
const Diagnostico       = lazy(() => import("./pages/Diagnostico"));
const Simulador         = lazy(() => import("./pages/Simulador"));
const DevSeed           = lazy(() => import("./pages/DevSeed"));
const DevImportarImagem = lazy(() => import("./pages/DevImportarImagem"));
const Extrato           = lazy(() => import("./pages/Extrato"));
const AjustesCarteira   = lazy(() => import("./pages/AjustesCarteira"));
const AdminUsuarios     = lazy(() => import("./pages/AdminUsuarios"));
const ResetPassword     = lazy(() => import("./pages/ResetPassword"));
const Mercado                = lazy(() => import("./pages/Mercado"));
const CarteirasDesalinhadas  = lazy(() => import("./pages/CarteirasDesalinhadas"));
const MinhaAlocacao          = lazy(() => import("./pages/MinhaAlocacao"));
const MeHome                 = lazy(() => import("./pages/MeHome"));
const ClientePainel          = lazy(() => import("./pages/ClientePainel"));
const MeResumo               = lazy(() => import("./pages/MeResumo"));

const LoadingPage = () => (
  <div className="page-loading"><span>carregando…</span></div>
);

// Rotas "só assessor interno" (master + assessor)
const INTERNO = [ROLES.MASTER, ROLES.ASSESSOR];

// Wrapper enxuto — reduz duplicação do <ProtectedRoute>…</ProtectedRoute>
// `ownerOnly`: cliente só acessa o próprio :id da URL (assessor/master passam).
const Guard = ({ element, roles, ownerOnly }) => (
  <ProtectedRoute roles={roles} ownerOnly={ownerOnly}>{element}</ProtectedRoute>
);

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<LoadingPage />}>
        <Routes>
          <Route path="/" element={<Login />} />

          {/* Namespace /me/* — porta de entrada do cliente.
              Cada rota resolve para /cliente/{profile.clienteId}/...
              Fases 4–6 substituirão cada redirect por página dedicada. */}
          <Route path="/me"            element={<Guard element={<MeRedirect />} />} />
          <Route path="/me/home"       element={<Guard element={<MeHome />} />} />
          <Route path="/me/resumo"     element={<Guard element={<MeResumo />} />} />
          <Route path="/me/objetivos"  element={<Guard element={<MeRedirect subpath="objetivos" />} />} />
          <Route path="/me/carteira"   element={<Guard element={<MeRedirect subpath="carteira" />} />} />
          <Route path="/me/fluxo"      element={<Guard element={<MeRedirect subpath="fluxo" />} />} />
          <Route path="/me/extrato"    element={<Guard element={<MeRedirect subpath="extrato" />} />} />
          <Route path="/me/diagnostico" element={<Guard element={<MeRedirect subpath="diagnostico" />} />} />
          <Route path="/me/simulador"  element={<Guard element={<MeRedirect subpath="simulador" />} />} />

          <Route path="/dashboard" element={<Guard roles={INTERNO} element={<Dashboard />} />} />

          {/* Painel premium do cliente visto pelo assessor — mesma visão da
              /me/home + botão Voltar/Editar. Para edição da ficha, o
              assessor abre /cliente/:id?edit=1 (ClienteFicha em modo edit). */}
          <Route path="/cliente/:id/painel" element={<Guard roles={INTERNO} element={<ClientePainel />} />} />
          <Route path="/cliente/:id/resumo" element={<Guard ownerOnly element={<MeResumo />} />} />

          <Route path="/cliente/:id" element={<Guard ownerOnly element={<ClienteFicha />} />} />
          <Route path="/cliente/:id/objetivos" element={<Guard ownerOnly element={<Objetivos />} />} />
          <Route path="/objetivo/:clienteId/:objetivoIndex" element={<Guard ownerOnly element={<ObjetivoDetalhes />} />} />
          <Route path="/cliente/:id/carteira" element={<Guard ownerOnly element={<Carteira />} />} />
          <Route path="/cliente/:id/fluxo" element={<Guard ownerOnly element={<FluxoMensal />} />} />
          <Route path="/cliente/:id/diagnostico" element={<Guard ownerOnly element={<Diagnostico />} />} />
          <Route path="/cliente/:id/simulador" element={<Guard ownerOnly element={<Simulador />} />} />
          <Route path="/cliente/:id/extrato" element={<Guard ownerOnly element={<Extrato />} />} />
          <Route path="/cliente/:id/ajustes" element={<Guard ownerOnly element={<AjustesCarteira />} />} />

          <Route
            path="/vencimentos"
            element={<Guard roles={INTERNO} element={<EmDesenvolvimento titulo="Vencimentos" icone="📅" descricao="Vamos listar todos os ativos da sua carteira que estão prestes a vencer, com os clientes vinculados a cada um — para que você possa avisá-los no dia certo." />} />}
          />
          <Route path="/mercado" element={<Guard element={<Mercado />} />} />
          <Route path="/carteiras-desalinhadas" element={<Guard roles={INTERNO} element={<CarteirasDesalinhadas />} />} />
          <Route path="/minha-alocacao" element={<Guard element={<MinhaAlocacao />} />} />

          <Route path="/admin/usuarios" element={<Guard roles={[ROLES.MASTER]} element={<AdminUsuarios />} />} />
          <Route path="/reset-password" element={<Guard element={<ResetPassword />} />} />

          {/* Gating do Master fica dentro do próprio DevSeed (useAuth.isMaster). */}
          <Route path="/dev/seed" element={<Guard roles={[ROLES.MASTER]} element={<DevSeed />} />} />
          <Route path="/dev/importar-imagem" element={<Guard roles={[ROLES.MASTER]} element={<DevImportarImagem />} />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <WhatsAppButton />
        <AssessorOnboardingModal />
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
