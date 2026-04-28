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
firebase deploy --only hosting     # deploy dist/ to william-porto.web.app
firebase deploy --only functions   # deploy Cloud Functions (region: southamerica-east1)
```

After UI changes, the expected workflow is: `npm run build && firebase deploy --only hosting` and return the hosting URL.

## Architecture

### Stack
React 18 + Vite 8, react-router-dom v6, Firebase (Auth, Firestore, Functions), GSAP, recharts. No TypeScript. Language for UI and comments is Portuguese (pt-BR).

### Auth model (3 levels)
RBAC with three roles defined in [src/constants/roles.js](src/constants/roles.js): `master`, `assessor`, `cliente`. The authoritative source is the doc `/users/{uid}` in Firestore (field `role`). [src/hooks/useAuth.js](src/hooks/useAuth.js) subscribes with `onSnapshot` and exposes `{user, profile, role, isMaster, isAssessor, isCliente, ...}`.

**Bootstrap edge case**: if the Firestore doc does not exist yet but the Firebase Auth email matches `MASTER_EMAIL`, the user is treated as master *only* to unlock `/dev/seed` — the single chicken-and-egg escape hatch. Once the master doc is written, role always comes from Firestore. See [docs/PLANO_AUTH_MULTI_NIVEL.md](docs/PLANO_AUTH_MULTI_NIVEL.md) for the full hierarchy plan.

[src/components/ProtectedRoute.jsx](src/components/ProtectedRoute.jsx) currently only checks `user != null`, not role.

### Routing
All routes live in [src/App.jsx](src/App.jsx). `Login` and `Dashboard` are eager; every other page is `lazy()` to keep the initial bundle small. Navigation conventions the Dashboard and Sidebar rely on:

- `/dashboard?filtro=<id>` — activates a KPI filter and scrolls to the clients section (`#clientes`). Valid ids: `todos`, `semAporte`, `semRevisao`, `inviavel`, `followUp`, `emReuniao`, `objetivosDesalinhados`, `feeBased`.
- `/dashboard#clientes` — same scroll-to-clients behavior (hash and query-param paths both react, via `useLocation()` + `useSearchParams()` effects in Dashboard).
- `/dashboard#cadastro` — scrolls to the cadastro banner.
- Placeholder routes (`/vencimentos`, `/mercado`, `/carteiras-desalinhadas`) render `EmDesenvolvimento` until those pages exist.

### Data model (`clientes` collection)
Each cliente document holds both profile fields and an embedded `carteira` object. For every class key in [src/utils/ativos.js](src/utils/ativos.js) `CLASSES_CARTEIRA` (`posFixado`, `ipca`, `preFixado`, `acoes`, `fiis`, `multi`, `prevVGBL`, `prevPGBL`, `globalEquities`, `globalTreasury`, `globalFunds`, `globalBonds`, `global`, `outros`), the carteira may contain:
- `carteira[key]` — legacy aggregate string in centavos
- `carteira[key + "Ativos"]` — array of `{valor, ...}` items (preferred)

**Fonte-da-verdade for patrimônio financeiro**: `getPatFin(c)` in [src/pages/Dashboard.jsx](src/pages/Dashboard.jsx) sums all `Ativos` arrays if present; only if every class is empty does it fall back to `c.patrimonio` (the manual cadastro field). Any new calculation that needs "patrimônio financeiro" must follow the same rule so Dashboard, ClienteFicha, and Carteira stay consistent. Values are stored as centavos-in-string; `parseCentavos` in [src/utils/currency.js](src/utils/currency.js) is the canonical parser.

### Cotações (market quotes)
[src/services/cotacoesReais.js](src/services/cotacoesReais.js) aggregates Dólar (awesomeapi), Selic/IPCA (BCB), Ibovespa (brapi / Yahoo fallback) and S&P 500 (Yahoo via allorigins) with `Promise.allSettled` + per-source fallbacks. Consumers call `obterTodasAsCotacoes()`. The Dashboard caches the last successful payload in `localStorage["wealthtrack_cotacoes"]` and re-polls every `INTERVALO_ATUALIZACAO` (1h) while `mercadoAberto()` is true. `BRAPI_TOKEN` in that file is a placeholder (`'SEU_TOKEN_AQUI'`); the Yahoo fallback keeps Ibov working without it.

### Cloud Functions
[functions/index.js](functions/index.js) runs on `nodejs20` in `southamerica-east1`. `processarUploadCarteira` is a callable that forwards a PDF/image to Anthropic Claude Vision (via `@anthropic-ai/sdk`) to extract carteira data. Requires `ANTHROPIC_API_KEY` secret. Client PDF parsing path uses `pdfjs-dist` + `tesseract.js` fallback via [src/utils/documentParser.js](src/utils/documentParser.js).

### Shared layout
`Sidebar` + `Navbar` are composed directly inside each page (no top-level layout component). Pages that want the left rail render `<div className="dashboard-container has-sidebar">` with `<Sidebar />` + `<Navbar />` + content in `.dashboard-content.with-sidebar`. The `has-sidebar` class hides Navbar's brand on desktop to avoid duplicating the logo the Sidebar already shows.

Sidebar behavior (see [src/components/Sidebar.jsx](src/components/Sidebar.jsx)):
- Desktop (≥901px): collapsed rail, expands on hover with 150ms in / 220ms out timers.
- Mobile (≤900px): hamburger in Navbar dispatches `porto:open-menu` CustomEvent; Sidebar opens as drawer.
- Route changes auto-close the expanded state.
- `MENU_ADMIN` / `buildMenuCliente(id)` switch based on the `mode` prop.

### Performance notes
- Dashboard does a single initial fetch via a ref-stable `atualizarCotacoesServidor()` that parallelizes cotações + clientes; do **not** reintroduce a separate `carregarClientes()` in the mount effect (it caused double Firestore reads).
- Big sections (hero, cadastro, clients) use `min-height: calc(100vh - 64px)` to behave like full-screen "slides". `scroll-margin-top: 64px` on `#clientes` and `#cadastro` accounts for the sticky navbar.
- `.card-xp` uses `contain: layout style` and a narrow `transition` list; avoid `transition: all` on any hot element.
- GSAP enter animations fire only on first mount (`primeiraCargaRef`). Subsequent refetches are silent.

## Conventions

- Currency in UI: use `brl` from [src/utils/currency.js](src/utils/currency.js) or the `brlNum` wrapper in Dashboard. Always parse stored strings through `parseCentavos`, never `parseFloat` directly.
- Styles are plain CSS under [src/styles/](src/styles/) (`globals.css`, `components.css`, `navbar.css`, `sidebar.css`, `responsive.css`) plus some scoped inline style objects. No CSS-in-JS library.
- Firestore config is hard-coded in [src/firebase.js](src/firebase.js) — there is no `.env`. The Firebase project is `william-porto`; deployed site is `https://william-porto.web.app`.
- ESLint rule `no-unused-vars` allows unused identifiers that start with uppercase or `_` (useful for imports kept for JSX re-exports). The repo currently has ~45 warnings; don't treat every lint message as blocking.
