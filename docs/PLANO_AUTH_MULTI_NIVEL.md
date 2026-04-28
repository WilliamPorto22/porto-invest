# Plano — Sistema de Autenticação Multi-nível (RBAC)

> **Como usar este documento:** abra um novo chat com Claude, cole o caminho deste arquivo (`docs/PLANO_AUTH_MULTI_NIVEL.md`) e peça "executar fase 1" (ou a fase que quiser). Cada fase é independente e testável.

---

## 🎯 Objetivo

Transformar o WealthTrack de "app autenticado flat" em **plataforma com 3 níveis de acesso**:

| Papel | O que vê | O que faz |
|---|---|---|
| **Master** (William) | Tudo: todos os assessores + todos os clientes. **Também tem base própria de clientes** (atua como assessor também). | Gerencia assessores, impersona, vê relatórios globais. *Assessor não sabe que existe este papel.* |
| **Assessor** (ex: João) | Só os clientes que ele cadastrou | Cadastra/edita clientes próprios, roda diagnósticos, simuladores |
| **Cliente** | Só a própria ficha/diagnóstico (somente leitura) | Visualiza relatórios que o assessor liberou |

**Fluxo de navegação do Master (decidido 2026-04-19):**
1. Clica pill `Administrador Geral` → vê **lista de assessores** (William Porto, João Victor, …).
2. Clica num assessor → **abre a base de clientes daquele assessor** (como se estivesse logado como ele, mas com banner indicando).
3. Clica num cliente → abre a ficha normal do cliente.

O próprio William aparece na lista como assessor "William Porto" — clicar nele mostra a base de clientes dele. Isso evita ter dois modos separados (Master vs Master-como-assessor): a hierarquia é sempre **Admin → Assessor → Cliente**.

**Navbar** ganha 3 pills logo abaixo do topo:
- `Administrador Geral` (visível só para Master)
- `Gerencial` (visível para Master + Assessor)
- `Clientes` (visível para todos — para cliente, abre direto a própria ficha)

---

## 📍 Estado atual (inventário feito)

**Auth:**
- Firebase Auth com `signInWithEmailAndPassword` em [src/pages/Login.jsx](../src/pages/Login.jsx)
- Hook [src/hooks/useAuth.js](../src/hooks/useAuth.js) (`{user, loading, error, isAuthenticated}`)
- [src/components/ProtectedRoute.jsx](../src/components/ProtectedRoute.jsx) — só checa se tem user, sem role

**Firestore:**
- Única collection existente: `clientes`
- Documento `cliente` NÃO tem `assessorId` / `ownerUid` / `role`
- Sem collection `users` / `assessores`

**Rotas protegidas hoje:** `/dashboard`, `/cliente/:id`, `/cliente/:id/{objetivos,carteira,fluxo,diagnostico,simulador}`, `/objetivo/:clienteId/:i`

**Navbar:** [src/components/Navbar.jsx](../src/components/Navbar.jsx) é 100% props-driven, sem lógica de papel.

**Firestore Rules:** *(verificar — provavelmente estão permissivas em dev; precisam ser blindadas antes de produção)*

---

## 🏗️ Arquitetura proposta

### Modelo de dados novo

```
firestore/
├── users/{uid}                      ← NOVO. Espelho do Firebase Auth + role
│   ├── email: string
│   ├── nome: string
│   ├── role: "master" | "assessor" | "cliente"
│   ├── assessorId?: string          ← só para role=cliente (aponta pro assessor dono)
│   ├── clienteDocId?: string        ← só para role=cliente (aponta pro doc em /clientes)
│   ├── createdAt, updatedAt
│   └── active: boolean
│
└── clientes/{id}                    ← JÁ EXISTE. Adicionar campos:
    ├── ...todos os campos atuais
    ├── assessorId: string           ← NOVO. uid do assessor dono
    ├── clienteUid?: string          ← NOVO. uid do usuário cliente (quando convidado)
    └── shareLevel?: "hidden"|"view" ← NOVO. controla se cliente logado pode ver
```

### Hook `useAuth` expandido

Retorna hoje: `{user, loading, isAuthenticated}`.
Passa a retornar: `{user, profile, role, loading, isAuthenticated, isMaster, isAssessor, isCliente}`

Onde `profile` é o doc de `/users/{uid}` e `role` é `profile.role`.

### ProtectedRoute com role

```
<ProtectedRoute roles={["master","assessor"]}>
  <Dashboard />
</ProtectedRoute>
```

### Firestore Security Rules (crítico — não pode faltar)

```
match /clientes/{id} {
  allow read:  if isMaster() 
                || (isAssessor() && resource.data.assessorId == request.auth.uid)
                || (isCliente()  && resource.data.clienteUid  == request.auth.uid);
  allow write: if isMaster() 
                || (isAssessor() && resource.data.assessorId == request.auth.uid);
}
match /users/{uid} {
  allow read:  if request.auth.uid == uid || isMaster();
  allow write: if isMaster();  // só Master cria/edita users
}
```

Helpers `isMaster()`, `isAssessor()`, `isCliente()` checam `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role`.

---

## 🧭 Navbar com pills de navegação

Logo abaixo do topo atual, uma linha com pills horizontais:

```
┌────────────────────────────────────────────────────────┐
│  [Logo WT]           [busca]            [sair]         │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │
│  ( Administrador Geral )  ( Gerencial )  ( Clientes )  │  ← visível conforme role
└────────────────────────────────────────────────────────┘
```

**Regras de visibilidade:**
- Master: vê as 3
- Assessor: vê só `Gerencial` + `Clientes` (não sabe que `Administrador Geral` existe)
- Cliente: nenhuma pill (ou só "Meu Painel")

**Rotas que cada pill abre:**
- `Administrador Geral` → `/admin` (dashboard global: lista de assessores, métricas agregadas)
- `Gerencial` → `/dashboard` (o que existe hoje, filtrado por `assessorId == uid`)
- `Clientes` → `/clientes` (lista de clientes do assessor; master vê todos)

---

## 📦 Fases de implementação

### Fase 1 — Fundação de dados e contexto (~2–3h)
1. Adicionar collection `users` com schema acima.
2. Criar script de seed em [scripts/seedUsers.js](../scripts/seedUsers.js):
   - Master: `williamporto0@gmail.com` (usa uid já existente no Auth)
   - Assessor teste: `assessor.joao@wealthtrack.test` + senha temporária
   - 2–3 clientes de exemplo vinculados ao João via `assessorId`
3. Popular campo `assessorId` nos clientes existentes (migração): rodar script que atribui todos ao Master por padrão.
4. Expandir [src/hooks/useAuth.js](../src/hooks/useAuth.js) para carregar `profile` de `users/{uid}` e expor `role`, `isMaster`, `isAssessor`, `isCliente`.

**Entrega:** logado como Master, `useAuth()` retorna `role: "master"`. Logado como João, retorna `role: "assessor"`.

### Fase 2 — Guards de rota e filtragem server-side (~2h)
1. Atualizar [ProtectedRoute.jsx](../src/components/ProtectedRoute.jsx) para aceitar `roles={[]}` e redirecionar quem não tem permissão.
2. Alterar `/dashboard` para filtrar `clientes` por `where("assessorId", "==", uid)` — exceto se `isMaster` (sem filtro).
3. Bloquear rotas `/cliente/:id/*` se o cliente não pertence ao usuário (checagem client-side + rules no servidor).
4. Escrever e publicar **Firestore Rules** do modelo acima.

**Entrega:** João só vê os clientes dele. Master vê todos. Se João digitar URL de cliente de outro assessor, é redirecionado.

### Fase 3 — Navbar com pills + rota /admin (~2h)
1. Adicionar linha de pills em [Navbar.jsx](../src/components/Navbar.jsx) (conditional por role).
2. Criar página `/admin` (`src/pages/AdminGeral.jsx`) — lista de assessores, métricas globais (total clientes, patrimônio agregado, assessores ativos).
3. Criar página `/clientes` (`src/pages/ListaClientes.jsx`) ou reaproveitar Dashboard com visão de tabela.
4. Estilo: manter identidade dourada `#F0A202`, pills com underline animado quando ativa.

**Entrega:** 3 pills aparecem conforme role, cada uma leva pra sua rota, Master consegue navegar entre todas.

### Fase 4 — Painel do cliente final + cadastro público (~3–4h)
1. Criar página `/meu-painel` (`src/pages/PainelCliente.jsx`) — versão **read-only** da ficha do cliente, com:
   - Diagnóstico (reaproveita `Diagnostico.jsx` em modo readOnly)
   - Objetivos
   - Portfólio (sem edição)
2. **Dois caminhos de entrada para cliente virar usuário:**

   **A. Convite manual (assessor convida cliente existente):**
   - Master/assessor clica "Convidar" na ficha do cliente → gera link `/cadastro?token=XXX` com token → cliente define senha → `users/{uid}` criado com `role: "cliente"` + `clienteDocId` apontando pro doc existente em `/clientes`.

   **B. Cadastro público (prospect vindo da landing page / Instagram / anúncios):**
   - Rota pública `/cadastro` (sem token) — formulário simples: nome, email, telefone, senha.
   - Ao submeter: cria doc novo em `/clientes` + user em `/users` com `role: "cliente"` e `assessorId = <uid do Master>` por padrão (William pega todos os prospects e depois reatribui pro João se quiser).
   - Link público: `https://<dominio>/cadastro` — é esse link que vai na landing page, no Instagram, nos anúncios.
   - Após cadastro, cliente cai direto no `/meu-painel` dele (que começa com ficha vazia — o Master/assessor preenche o planejamento depois).

3. Login detecta role; se `cliente`, redireciona direto para `/meu-painel`.

**Entrega:**
- Cliente convidado (caminho A) loga e vê só a própria ficha já preenchida pelo assessor.
- Prospect do Instagram (caminho B) se auto-cadastra, entra no painel vazio, aparece automaticamente na base do Master pra ser atendido.
- Nenhum dos dois acessa `/dashboard` nem `/admin`.

### Fase 5 — Gestão de assessores (só Master) (~2h)
1. Em `/admin`, botão "Cadastrar Assessor" → modal com nome/email/senha-inicial.
2. Master pode ativar/desativar assessor (`active: false` = login bloqueado).
3. Master pode **impersonar** um assessor (flag de sessão que faz a query filtrar como se fosse o assessor, com banner "vendo como João").

**Entrega:** Master cria/bloqueia assessores sem precisar entrar no console do Firebase.

### Fase 6 — Hardening + testes (~2h)
1. Auditoria das rules (checar cada rota do app).
2. Logs de acesso (collection `audit_logs` com quem acessou o quê).
3. Testes E2E dos 3 papéis: criar 1 teste por persona passando pelos fluxos principais.
4. Documentar em `docs/SEGURANCA.md`.

---

## 🧪 Usuários de seed para desenvolvimento

| Role | Email | Senha inicial | Observação |
|---|---|---|---|
| Master | `williamporto0@gmail.com` | *(já existe)* | Usuário real — **trocar senha após plano executado** |
| Assessor | `assessor.joao@wealthtrack.test` | `Teste@123` | Criado pelo script de seed da Fase 1 |
| Cliente | `cliente.maria@wealthtrack.test` | `Teste@123` | Vinculado ao João via `assessorId` |
| Cliente | `cliente.pedro@wealthtrack.test` | `Teste@123` | Vinculado ao Master direto |

---

## ⚠️ Riscos e decisões (resolvidas 2026-04-19)

1. **Senha do Master exposta:** senha real foi vazada no chat. **Trocar antes de executar este plano.** 🔐
2. **Migração de clientes existentes:** ✅ atribuir todos ao Master por padrão (o próprio William figurará como assessor "William Porto", então a base original fica dele).
3. **Cliente pode editar seu perfil?** ✅ **read-only** na Fase 4. Edição de dados pessoais fica para fase futura se/quando necessário.
4. **Convite por email:** ✅ **dois caminhos**, ambos sem dependência externa:
   - **Convite manual** (assessor → cliente já na base): link copiável tipo `/cadastro?token=XXX` que o assessor manda pelo WhatsApp/email pessoal.
   - **Cadastro público** (prospect novo da landing page / Instagram / anúncios): rota pública `/cadastro` linkada a partir do site de apresentação que o William está desenvolvendo em paralelo. Prospects que se cadastram caem automaticamente na base do Master (William) e podem ser reatribuídos depois.
5. **Rate limit de login:** Firebase Auth já tem — suficiente por ora.

---

## 📋 Checklist rápido antes de começar

- [x] Trocar senha `williamporto0@gmail.com` no Firebase Auth *(feito 2026-04-19)*
- [ ] Confirmar que tem acesso ao Firebase Console do projeto
- [ ] Backup do Firestore atual (export) — não é grande, dá pra baixar pelo console
- [x] ~~Decidir itens da seção de decisões~~ — resolvidos 2026-04-19
- [ ] Abrir novo chat com Claude e colar: *"execute a Fase 1 de docs/PLANO_AUTH_MULTI_NIVEL.md"*

---

*Plano gerado em 2026-04-19. Adaptável — ajustar fases conforme feedback do Master.*
