import { useState } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut as secondarySignOut,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { ROLES, MASTER_EMAIL } from "../constants/roles";
import { useAuth } from "../hooks/useAuth";
import { Navigate } from "react-router-dom";

/**
 * Página de seed/bootstrap da Fase 1 do plano de auth multi-nível.
 *
 * Decisão de design (deviação do plano original):
 * O plano previa um script Node em scripts/seedUsers.js. Troquei por uma
 * página React porque:
 *   - Não exige firebase-admin + service account JSON (zero dependência nova).
 *   - Master roda com 1 clique, sem mexer no Firebase Console.
 *   - Criação de Auth users via secondary app preserva a sessão do Master.
 *
 * Acesso: somente email MASTER_EMAIL (ver App.jsx).
 * Uso: rodar uma única vez para popular Firestore; operações são idempotentes.
 */

// Config do app secundário (igual ao principal; reaproveitamos o options do auth principal
// para não duplicar as chaves hardcoded em 2 lugares).
function getSecondaryApp() {
  const options = auth.app.options;
  return initializeApp(options, `secondary-${Date.now()}`);
}

const ASSESSOR_JOAO = {
  email: "assessor.joao@wealthtrack.test",
  nome: "João Victor",
};

function gerarSenhaAleatoria(len = 14) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const CLIENTES_TESTE = [
  {
    nome: "Maria Silva (teste do João)",
    uf: "SP",
    patrimonio: "25000000", // R$ 250.000,00 em centavos
    avatar: "mulher",
    assignTo: "joao", // vínculo lógico, substituído pelo uid real na hora do seed
  },
  {
    nome: "Pedro Souza (teste do Master)",
    uf: "RJ",
    patrimonio: "80000000", // R$ 800.000,00 em centavos
    avatar: "homem",
    assignTo: "master",
  },
];

const BG = "#0D1321";
const CARD = "#1D2D44";
const BD = "rgba(62,92,118,0.35)";
const GOLD = "#F0A202";
const TEXT = "#F0EBD8";
const MUTED = "#748CAB";

function LogEntry({ type, msg }) {
  const color =
    type === "ok" ? "#4ade80" : type === "err" ? "#f87171" : type === "warn" ? "#fbbf24" : MUTED;
  const prefix =
    type === "ok" ? "✓" : type === "err" ? "✗" : type === "warn" ? "⚠" : "·";
  return (
    <div style={{ color, fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", lineHeight: 1.6 }}>
      {prefix} {msg}
    </div>
  );
}

export default function DevSeed() {
  const { user, isMaster, loading } = useAuth();
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [joaoUid, setJoaoUid] = useState(null);
  const [joaoSenha, setJoaoSenha] = useState(null);

  const add = (type, msg) => setLog((prev) => [...prev, { type, msg }]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: BG, color: TEXT, display: "flex", alignItems: "center", justifyContent: "center" }}>
        Carregando...
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (!isMaster) {
    return (
      <div style={{ minHeight: "100vh", background: BG, color: TEXT, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        Acesso negado. Esta página é restrita ao Master.
      </div>
    );
  }

  // 1) Cria o doc /users/{uid} para o Master logado.
  async function seedMasterProfile() {
    setBusy(true);
    try {
      const ref = doc(db, "users", user.uid);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        add("warn", `Profile Master já existe (${user.email}). Atualizando campos não-destrutivos.`);
        await setDoc(
          ref,
          { email: user.email, role: ROLES.MASTER, active: true, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } else {
        await setDoc(ref, {
          email: user.email,
          nome: "William Porto",
          role: ROLES.MASTER,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        add("ok", `Profile Master criado: users/${user.uid}`);
      }
    } catch (e) {
      add("err", `Erro ao criar profile Master: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // 2) Cria assessor João no Auth (via app secundário, preservando sessão do Master)
  //    + doc em /users/{uid} com role "assessor".
  async function seedAssessorJoao() {
    setBusy(true);
    let secondaryApp = null;
    try {
      secondaryApp = getSecondaryApp();
      const secondaryAuth = getAuth(secondaryApp);
      const senhaGerada = gerarSenhaAleatoria();
      let joaoUser;
      try {
        const cred = await createUserWithEmailAndPassword(
          secondaryAuth,
          ASSESSOR_JOAO.email,
          senhaGerada
        );
        joaoUser = cred.user;
        setJoaoSenha(senhaGerada);
        add("ok", `Auth criado: ${ASSESSOR_JOAO.email} (uid ${joaoUser.uid})`);
      } catch (e) {
        if (e.code === "auth/email-already-in-use") {
          add("warn", `Auth de ${ASSESSOR_JOAO.email} já existe. Tentando apenas criar o profile.`);
          // Sem admin SDK não dá para buscar uid a partir do email. Pedimos ao usuário.
          const uid = prompt(
            `O Auth de ${ASSESSOR_JOAO.email} já existe, mas não consigo descobrir o UID pelo SDK cliente.\n\n` +
              `Vá no Firebase Console → Authentication, copie o UID do João e cole aqui:`
          );
          if (!uid) {
            add("warn", "UID não fornecido. Pulei.");
            return;
          }
          joaoUser = { uid };
        } else {
          throw e;
        }
      }

      await setDoc(doc(db, "users", joaoUser.uid), {
        email: ASSESSOR_JOAO.email,
        nome: ASSESSOR_JOAO.nome,
        role: ROLES.ASSESSOR,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      add("ok", `Profile Assessor criado: users/${joaoUser.uid} (${ASSESSOR_JOAO.nome})`);
      setJoaoUid(joaoUser.uid);
      return joaoUser.uid;
    } catch (e) {
      add("err", `Erro ao criar assessor João: ${e.message}`);
      return null;
    } finally {
      if (secondaryApp) {
        try { await secondarySignOut(getAuth(secondaryApp)); } catch { /* ignore */ }
        try { await deleteApp(secondaryApp); } catch { /* ignore */ }
      }
      setBusy(false);
    }
  }

  // 3) Migra clientes existentes: adiciona assessorId = uid do Master em quem não tem.
  async function migrarClientesExistentes() {
    setBusy(true);
    try {
      const snap = await getDocs(collection(db, "clientes"));
      const semAssessor = snap.docs.filter((d) => !d.data().assessorId);
      if (semAssessor.length === 0) {
        add("warn", "Nenhum cliente sem assessorId encontrado. Migração já aplicada.");
        return;
      }
      const batch = writeBatch(db);
      semAssessor.forEach((d) => {
        batch.update(d.ref, { assessorId: user.uid, migratedAt: serverTimestamp() });
      });
      await batch.commit();
      add("ok", `${semAssessor.length} cliente(s) migrado(s) para o Master (${user.email}).`);
    } catch (e) {
      add("err", `Erro na migração: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // 4) Cria 2 clientes de teste (1 do João, 1 do Master).
  // joaoUidOverride: permite passar o uid diretamente quando seedTudo roda em
  // sequência (setJoaoUid do passo 2 ainda não refletiu no state dentro do mesmo tick).
  async function seedClientesTeste(joaoUidOverride) {
    let joaoId = joaoUidOverride || joaoUid;
    if (!joaoId) {
      const manual = prompt(
        "Preciso do UID do assessor João para vincular o cliente de teste.\n\n" +
          "Se você acabou de clicar em 'Seed Assessor João' e deu ok, eu já tenho.\n" +
          "Caso contrário, cole o UID aqui (pegue no Firebase Console → Authentication):"
      );
      if (!manual) {
        add("warn", "UID do João não fornecido. Pulei.");
        return;
      }
      joaoId = manual;
      setJoaoUid(manual);
    }
    setBusy(true);
    try {
      for (const c of CLIENTES_TESTE) {
        const assessorId = c.assignTo === "master" ? user.uid : joaoId;
        if (!assessorId) {
          add("err", `Cliente "${c.nome}" sem assessorId — pulado.`);
          continue;
        }
        const ref = doc(collection(db, "clientes"));
        await setDoc(ref, {
          nome: c.nome,
          uf: c.uf,
          patrimonio: c.patrimonio,
          avatar: c.avatar,
          assessorId,
          createdAt: serverTimestamp(),
          seedMarker: true,
        });
        add("ok", `Cliente teste criado: ${c.nome} → assessor ${assessorId.slice(0, 8)}…`);
      }
    } catch (e) {
      add("err", `Erro ao criar clientes teste: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Roda tudo em ordem. Passamos o uid do João diretamente para seedClientesTeste
  // porque o setJoaoUid do passo 2 ainda não refletiu no closure no mesmo tick.
  async function seedTudo() {
    await seedMasterProfile();
    const joaoUidCriado = await seedAssessorJoao();
    await migrarClientesExistentes();
    await seedClientesTeste(joaoUidCriado);
    add("ok", "Seed completo.");
  }

  const btn = {
    padding: "10px 16px",
    background: CARD,
    border: `0.5px solid ${BD}`,
    borderRadius: 8,
    color: TEXT,
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "inherit",
    textAlign: "left",
  };
  const btnPrimary = { ...btn, background: "rgba(240,162,2,0.12)", borderColor: GOLD, color: GOLD };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, padding: "48px 24px", fontFamily: "-apple-system, 'SF Pro Display', sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ fontSize: 11, color: GOLD, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
          Fase 1 · Dev only
        </div>
        <h1 style={{ fontSize: 24, margin: 0, fontWeight: 500 }}>Seed de usuários e clientes</h1>
        <p style={{ color: MUTED, fontSize: 13, lineHeight: 1.6, maxWidth: 560 }}>
          Página de bootstrap para a collection <code>users</code> e migração dos
          clientes existentes. Operações são idempotentes — pode rodar várias
          vezes sem duplicar. Após terminar tudo e validar, essa rota deve ser
          removida (ou transformada em painel Master oculto).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          <button disabled={busy} style={btnPrimary} onClick={seedTudo}>
            ▶ Rodar tudo em ordem
          </button>
          <div style={{ fontSize: 11, color: MUTED, margin: "8px 0 2px" }}>— ou, passo a passo —</div>
          <button disabled={busy} style={btn} onClick={seedMasterProfile}>
            1. Criar profile Master ({user.email})
          </button>
          <button disabled={busy} style={btn} onClick={seedAssessorJoao}>
            2. Criar Auth + profile Assessor João ({ASSESSOR_JOAO.email})
          </button>
          <button disabled={busy} style={btn} onClick={migrarClientesExistentes}>
            3. Migrar clientes existentes para o Master
          </button>
          <button disabled={busy} style={btn} onClick={seedClientesTeste}>
            4. Criar 2 clientes de teste
          </button>
        </div>

        <div style={{ marginTop: 32, background: CARD, border: `0.5px solid ${BD}`, borderRadius: 10, padding: 16, minHeight: 140 }}>
          <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Log
          </div>
          {log.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 12, fontStyle: "italic" }}>Sem atividade ainda.</div>
          ) : (
            log.map((l, i) => <LogEntry key={i} type={l.type} msg={l.msg} />)
          )}
        </div>

        {joaoSenha && (
          <div style={{ marginTop: 24, fontSize: 11, color: MUTED, lineHeight: 1.7, background: "#0D1321", border: "0.5px solid #F0A20266", borderRadius: 8, padding: "10px 14px" }}>
            <strong style={{ color: "#F0A202" }}>Credenciais geradas neste seed:</strong>
            <br />· Assessor João: <code>{ASSESSOR_JOAO.email}</code> / <code>{joaoSenha}</code>
            <br />· Anote a senha agora — ela não será exibida novamente.
          </div>
        )}
      </div>
    </div>
  );
}
