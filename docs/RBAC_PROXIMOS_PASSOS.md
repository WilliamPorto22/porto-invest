# RBAC — Próximos passos para ativar

O frontend está pronto (deploy feito em `https://porto-invest.web.app` — domínio antigo `william-porto.web.app` continua redirecionando).
Falta **3 ações** do lado do Firebase Console para ativar tudo.

---

## 1. Upgrade do projeto para Blaze (pay-as-you-go)

As Cloud Functions novas (`criarAssessor`, `criarCliente`, `excluirUsuario`, `listarUsuarios`)
exigem o plano Blaze. O tier gratuito cobre MUITO mais do que o uso esperado desse app.

1. Acesse https://console.firebase.google.com/project/william-porto/usage/details
2. Clique em **Modify plan** → **Blaze**
3. Cadastre um cartão. Sem cobrança enquanto estiver dentro dos limites gratuitos (2M invocações/mês).
4. Opcional mas recomendado: **Set budget alert** de US$ 1 pra ser avisado se algo fugir do normal.

Depois volte aqui pro passo 2.

---

## 2. Deploy das Cloud Functions novas

Do terminal (CMD), com `firebase-cli` logado:

```
cd /d C:\Users\User\Desktop\PortoInvest\wealthtrack-backup\wealthtrack
firebase deploy --only functions
```

Vai demorar uns 3–5 min na primeira vez (criando as APIs).

**Como testar que funcionou:**

1. Entre em `https://porto-invest.web.app` logado como master (william).
2. Clique em **Administrador** na sidebar (novo item).
3. Preencha nome + email e clique em **Criar assessor**.
4. Se aparecer "Assessor criado · senha inicial: assessorwilliamporto" → tudo certo.
5. Abra o novo email em aba anônima, faça login com a senha padrão.
6. Sistema deve redirecionar para `/reset-password` e forçar troca.
7. Depois da troca, assessor vai pro Dashboard e vê só os clientes dele (que hoje é 0).

---

## 3. Backfill: clientes existentes precisam de advisorId

Os clientes atuais não têm o campo `advisorId` preenchido. Sem ele:
- Master continua vendo tudo (não filtra).
- Assessor vê 0 clientes.

**Atalho pronto no projeto**: abra `https://porto-invest.web.app/dev/seed` logado como master
e clique em **"3. Migrar clientes existentes para o Master"** (usa writeBatch, atômico).

Depois, os clientes que você quiser passar pra um assessor específico podem ser reatribuídos
editando o campo `advisorId` no Firebase Console → Firestore → clientes → [doc] → advisorId.

(Futuramente dá pra construir uma UI em `/admin/usuarios` com botão "Transferir cliente pra assessor X".)

---

## 4. (Opcional, última etapa) Aplicar firestore.rules restritivas

Hoje as rules são permissivas: "qualquer usuário autenticado lê/escreve".
Só ative as rules restritivas DEPOIS de:

- ✅ Passos 1, 2, 3 feitos
- ✅ Seu doc master em `/users/{seu-uid}` existir com `role:"master"` (já existe — DevSeed criou)
- ✅ Todos os clientes terem `advisorId` (passo 3)
- ✅ Todos os clientes com login próprio terem `userId` no doc (próxima fase se quiser)

Quando tudo acima estiver pronto, restaure as rules fortes (versão original) e rode:

```
firebase deploy --only firestore:rules
```

Código pronto em: histórico do git (commit anterior ao permissivo) ou posso reescrever quando você pedir.

---

## Arquitetura RBAC final (após passos 1–4)

| Role | Onde cai ao logar | O que vê | O que pode criar |
|---|---|---|---|
| **master** | `/dashboard` (todos os clientes) | tudo | assessores, clientes |
| **assessor** | `/dashboard` (só próprios) | só seus clientes | só clientes próprios |
| **cliente** | `/cliente/{proprio-id}` | só própria ficha | nada |

**Login** (`/`):
- Senha certa + `mustResetPassword: true` → `/reset-password` (obrigatório)
- Senha certa + role `cliente` com `clienteId` → `/cliente/{clienteId}`
- Senha certa nos outros casos → `/dashboard`
- "Esqueci minha senha" envia email via Firebase Auth nativo.

**Criar assessor** (`/admin/usuarios`, master only):
- Input: nome + email.
- Senha inicial: `assessorwilliamporto`.
- Flag `mustResetPassword:true` força troca no primeiro login.

**Criar cliente** (ClienteFicha, master/assessor):
- Se email preenchido: Cloud Function cria Auth user + envia link de senha.
- Se sem email: cria só o doc em `/clientes` (mantém flow atual).
- Em ambos casos: `advisorId` = UID de quem criou.

**Excluir usuário** (`/admin/usuarios`, master only):
- Apaga Auth + doc `/users`. Preserva `/clientes` (histórico).
