# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # Production build → dist/
npm run lint         # ESLint (flat config)
npm run test         # Vitest watch mode
npm run test:run     # Vitest single run
npm run test:ui      # Vitest UI
npx vitest run src/utils/__tests__/currency.test.js   # single test file
firebase deploy --only hosting     # deploy dist/ → site único: porto-invest-login (https://porto-invest-login.web.app)
firebase deploy --only functions   # deploy Cloud Functions (region: southamerica-east1)
```

After UI changes, the expected workflow is: `npm run build && firebase deploy --only hosting` and return the hosting URL.

## Architecture

### Stack
React 18 + Vite 8, react-router-dom v6, Firebase (Auth, Firestore, Functions), GSAP, recharts. No TypeScript. Language for UI and comments is Portuguese (pt-BR).

### Auth model (3 levels)
RBAC with three roles defined in [src/constants/roles.js](src/constants/roles.js): `master`, `assessor`, `cliente`. The authoritative source is the doc `/users/{uid}` in Firestore (field `role`). [src/hooks/useAuth.js](src/hooks/useAuth.js) subscribes with `onSnapshot` and exposes `{user, profile, role, isMaster, isAssessor, isCliente, ...}`.

**Bootstrap edge case**: if the Firestore doc does not exist yet but the Firebase Auth email matches `MASTER_EMAIL`, the user is treated as master *only* to unlock `/dev/seed` — the single chicken-and-egg escape hatch. Once the master doc is written, role always comes from Firestore. See [docs/PLANO_AUTH_MULTI_NIVEL.md](docs/PLANO_AUTH_MULTI_NIVEL.md) for the full hierarchy plan.

[src/components/ProtectedRoute.jsx](src/components/ProtectedRoute.jsx) supports three guards: `roles=[…]` (allowlist), `ownerOnly` (cliente só vê o próprio `:id` da URL), and the default authenticated check. Quando o guard bloqueia, a função interna `rotaInicialPorPapel(role, profile)` redireciona para a porta certa: `/dashboard` para master/assessor, `/me/home` para cliente.

### Routing
All routes live in [src/App.jsx](src/App.jsx). `Login` and `Dashboard` are eager; every other page is `lazy()` to keep the initial bundle small.

**Cliente final usa o namespace `/me/*`** — porta de entrada introduzida em 28/04/2026 para que o cliente nunca digite `id` na URL e seu bundle fique enxuto:

- `/me`, `/me/home` → [MeHome.jsx](src/pages/MeHome.jsx) carrega o doc `/clientes/{profile.clienteId}` e renderiza `<HomeLiberdade>` isolada (sem o peso do `ClienteFicha` de 3.9k linhas).
- `/me/objetivos`, `/me/carteira`, `/me/fluxo`, `/me/extrato`, `/me/simulador` → [MeRedirect.jsx](src/components/MeRedirect.jsx) resolve dinamicamente para `/cliente/{profile.clienteId}/...`. Fases futuras substituirão cada redirect por uma página dedicada mantendo a URL `/me/*`.
- `/me/diagnostico` → mesmo redirect, mas com **gating**: só passa quando `localStorage["porto_perfil_completo_{clienteId}"] === "1"` (escrito por `MeHome` via [perfilCompleto](src/utils/perfilCompleto.js)). Se incompleto, manda pra `/me/home?perfilIncompleto=1`.

Login redireciona o cliente diretamente para `/me/home`; dashboard e ficha completa continuam em `/cliente/:id/*` para assessor e master.

Navigation conventions the Dashboard and Sidebar rely on:

- `/dashboard?filtro=<id>` — activates a KPI filter and scrolls to the clients section (`#clientes`). Valid ids: `todos`, `semAporte`, `semRevisao`, `inviavel`, `followUp`, `emReuniao`, `objetivosDesalinhados`, `feeBased`.
- `/dashboard#clientes` — same scroll-to-clients behavior (hash and query-param paths both react, via `useLocation()` + `useSearchParams()` effects in Dashboard).
- `/dashboard#cadastro` — scrolls to the cadastro banner.
- Placeholder routes (`/vencimentos`, `/carteiras-desalinhadas`) render `EmDesenvolvimento` until those pages exist.

### Onboarding e gating do Diagnóstico
[src/utils/perfilCompleto.js](src/utils/perfilCompleto.js) encapsula a regra de "perfil pronto": ≥1 objetivo, ≥1 receita, ≥1 despesa, ≥1 ativo na carteira, dados pessoais (nome+email). `MeHome` calcula esse status a cada render, persiste em `localStorage["porto_perfil_completo_{clienteId}"]` e renderiza [ChecklistOnboardingCliente](src/components/cliente/ChecklistOnboardingCliente.jsx) no topo enquanto incompleto. O Sidebar (em modo cliente final) lê esse mesmo localStorage e oculta o item "Diagnóstico" até completar. **Não duplique a regra** — sempre use `perfilCompleto(cliente)`.

### Cadastro do cliente — campos removidos da UI
Em 28/04/2026, os blocos "Renda, Gastos e Aportes" (seção 4) e "Patrimônio Financeiro" (seção 5) foram removidos do formulário de cadastro em [ClienteFicha.jsx](src/pages/ClienteFicha.jsx). A ficha hoje tem 8 seções (era 10). Os campos `salarioMensal`, `gastosMensaisManual`, `aporteMedio`, `metaAporteMensal`, `diaAporte`, `patrimonio`, `liquidezDiaria` **continuam existindo no Firestore** e são lidos por Diagnóstico/Dashboard/HomeLiberdade — apenas a edição via formulário do cadastro foi removida. Esses números agora vêm naturalmente: renda/gastos/aporte do `FluxoMensal` (lançamentos reais), patrimônio financeiro da `Carteira` (soma dos `Ativos`).

### Data model (`clientes` collection)
Each cliente document holds both profile fields and an embedded `carteira` object. For every class key in [src/utils/ativos.js](src/utils/ativos.js) `CLASSES_CARTEIRA` (`posFixado`, `ipca`, `preFixado`, `acoes`, `fiis`, `multi`, `prevVGBL`, `prevPGBL`, `globalEquities`, `globalTreasury`, `globalFunds`, `globalBonds`, `global`, `outros`), the carteira may contain:
- `carteira[key]` — legacy aggregate string in centavos
- `carteira[key + "Ativos"]` — array of `{valor, ...}` items (preferred)

**Fonte-da-verdade for patrimônio financeiro**: `getPatFin(c)` in [src/pages/Dashboard.jsx](src/pages/Dashboard.jsx) sums all `Ativos` arrays if present; only if every class is empty does it fall back to `c.patrimonio` (the manual cadastro field). Any new calculation that needs "patrimônio financeiro" must follow the same rule so Dashboard, ClienteFicha, and Carteira stay consistent. Values are stored as centavos-in-string; `parseCentavos` in [src/utils/currency.js](src/utils/currency.js) is the canonical parser.

### Cotações (market quotes)
[src/services/cotacoesReais.js](src/services/cotacoesReais.js) aggregates Dólar (awesomeapi), Selic/IPCA (BCB), Ibovespa (brapi / Yahoo fallback) and S&P 500 (Yahoo via allorigins) with `Promise.allSettled` + per-source fallbacks. Consumers call `obterTodasAsCotacoes()`. The Dashboard caches the last successful payload in `localStorage["wealthtrack_cotacoes"]` and re-polls every `INTERVALO_ATUALIZACAO` (1h) while `mercadoAberto()` is true. `BRAPI_TOKEN` in that file is a placeholder (`'SEU_TOKEN_AQUI'`); the Yahoo fallback keeps Ibov working without it.

### Cloud Functions
[functions/index.js](functions/index.js) runs on `nodejs22` in `southamerica-east1`. `processarUploadCarteira` is a callable that forwards a PDF/image to Anthropic Claude Vision (via `@anthropic-ai/sdk`) to extract carteira data. Requires `ANTHROPIC_API_KEY` secret. Client PDF parsing path uses `pdfjs-dist` + `tesseract.js` fallback via [src/utils/documentParser.js](src/utils/documentParser.js).

### Shared layout
`Sidebar` + `Navbar` are composed directly inside each page (no top-level layout component). Pages that want the left rail render `<div className="dashboard-container has-sidebar">` with `<Sidebar />` + `<Navbar />` + content in `.dashboard-content.with-sidebar`. The `has-sidebar` class hides Navbar's brand on desktop to avoid duplicating the logo the Sidebar already shows.

Sidebar behavior (see [src/components/Sidebar.jsx](src/components/Sidebar.jsx)):
- Desktop (≥901px): collapsed rail, expands on hover with 150ms in / 220ms out timers.
- Mobile (≤900px): hamburger in Navbar dispatches `porto:open-menu` CustomEvent; Sidebar opens as drawer.
- Route changes auto-close the expanded state.
- `MENU_ADMIN` / `buildMenuCliente(id)` switch based on the `mode` prop.

### Snapshot mensal automático e Resumo Patrimonial (29/04/2026)

- **Snapshot mensal automático**: [`garantirSnapshotMensalAuto(clienteId, cliente)`](src/services/snapshotsCarteira.js) gera/atualiza o snapshot do mês corrente a partir da carteira viva do cliente — sem depender de upload de PDF. Plugado em [MeHome.jsx](src/pages/MeHome.jsx) e [ClientePainel.jsx](src/pages/ClientePainel.jsx) com guard em `localStorage["porto_snap_auto_{clienteId}_{YYYY-MM}"]` para escrever no máximo uma vez por sessão por mês. Idempotente (suprime write quando patrimônio/aporte não mudou). Não sobrescreve snapshot vindo de PDF: salva com `fonte: "auto"` e o merge em [`salvarSnapshotMensal`](src/services/snapshotsCarteira.js) preserva os campos ricos. Aporte do mês é extraído de `cliente.aportesHistorico` filtrando por `mes`/`ano` ou por `data` ISO. Com isso, o `HistoricoMensalChart` em [Carteira.jsx:1770](src/pages/Carteira.jsx:1770) passa a aparecer mesmo para cliente que nunca importou PDF.
- **Página /me/resumo (e /cliente/:id/resumo)**: [MeResumo.jsx](src/pages/MeResumo.jsx) renderiza [ResumoPatrimonialCliente.jsx](src/components/cliente/ResumoPatrimonialCliente.jsx) — visão patrimonial completa estilo Itaú: Patrimônio por Categoria (donut %), Brasil vs Global, Distribuição em Reais (barras), Distribuição por Classes da carteira, Liquidez D+1, Patrimônio Financeiro, Bens Cadastrados, e o `HistoricoMensalChart` quando há snapshots. Reuso de [`bensCliente.js`](src/utils/bensCliente.js) e [`CLASSES_CARTEIRA`](src/utils/ativos.js) para evitar duplicar regra. Liquidez D+1 = soma de `posFixado + ipca + preFixado` (mesma heurística da Carteira). Item "Resumo patrimonial" foi adicionado no Sidebar — em `buildMenuClienteFinal` (cliente final) e `buildMenuCliente` (assessor visitando) em [Sidebar.jsx](src/components/Sidebar.jsx), logo após "Início". A mesma página atende os dois fluxos: sem `:id` na URL ela usa `profile.clienteId`; com `:id`, usa `paramId` e exibe botão "Voltar aos clientes" para o assessor.

### Performance notes
- Dashboard does a single initial fetch via a ref-stable `atualizarCotacoesServidor()` that parallelizes cotações + clientes; do **not** reintroduce a separate `carregarClientes()` in the mount effect (it caused double Firestore reads).
- Big sections (hero, cadastro, clients) use `min-height: calc(100vh - 64px)` to behave like full-screen "slides". `scroll-margin-top: 64px` on `#clientes` and `#cadastro` accounts for the sticky navbar.
- `.card-xp` uses `contain: layout style` and a narrow `transition` list; avoid `transition: all` on any hot element.
- GSAP enter animations fire only on first mount (`primeiraCargaRef`). Subsequent refetches are silent.

## Conventions

- Currency in UI: use `brl` from [src/utils/currency.js](src/utils/currency.js) or the `brlNum` wrapper in Dashboard. Always parse stored strings through `parseCentavos`, never `parseFloat` directly.
- Styles are plain CSS under [src/styles/](src/styles/) (`globals.css`, `components.css`, `navbar.css`, `sidebar.css`, `responsive.css`) plus some scoped inline style objects. No CSS-in-JS library.
- Firestore config is hard-coded in [src/firebase.js](src/firebase.js) — there is no `.env`. The Firebase project é `william-porto` (ID interno do GCP, não muda). **Hosting setup (atualizado em 2026-05-06):** o site canônico do app é **`https://porto-invest-login.web.app`** (servido de `dist/`, configurado em `firebase.json`). A landing page de vendas em **`https://portoinvest.web.app`** é gerenciada por outro projeto/repo (Next.js) — este repo NÃO faz deploy nela. Os antigos `porto-invest.web.app` e `william-porto.web.app` foram desativados em 2026-05-06 (migração após Tarefa A da auditoria). `authDomain` no SDK fica como `william-porto.firebaseapp.com` por ser o domínio fixo do Firebase Auth do projeto — não confundir com hosting site.
- ESLint rule `no-unused-vars` allows unused identifiers that start with uppercase or `_` (useful for imports kept for JSX re-exports). The repo currently has ~45 warnings; don't treat every lint message as blocking.
