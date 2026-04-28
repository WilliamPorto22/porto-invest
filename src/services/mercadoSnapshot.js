// src/services/mercadoSnapshot.js
// Lê/escreve o snapshot da análise de mercado em Firestore.
// Rota: /mercado/snapshot (ver firestore.rules — só master escreve).
//
// Estrutura do documento:
// {
//   atualizadoEm : Timestamp (serverTimestamp)
//   atualizadoPor: { uid, email }
//   br           : Array<AtivoBR>   // brapi
//   us           : Array<AtivoUS>   // stooq/yahoo
// }

import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../firebase";

const SNAPSHOT_DOC = () => doc(db, "mercado", "snapshot");

/** Lê snapshot atual. Retorna null se ainda não existe. */
export async function carregarSnapshotFirestore() {
  try {
    const snap = await getDoc(SNAPSHOT_DOC());
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      br: data.br || [],
      us: data.us || [],
      atualizadoEm: data.atualizadoEm?.toDate ? data.atualizadoEm.toDate() : new Date(data.atualizadoEm || Date.now()),
      atualizadoPor: data.atualizadoPor || null,
    };
  } catch (e) {
    console.warn("Falha ao ler snapshot Firestore:", e.message);
    return null;
  }
}

/** Salva snapshot. Requer usuário master. */
export async function salvarSnapshotFirestore({ br, us }) {
  const user = auth.currentUser;
  await setDoc(SNAPSHOT_DOC(), {
    br: br || [],
    us: us || [],
    atualizadoEm: serverTimestamp(),
    atualizadoPor: user ? { uid: user.uid, email: user.email } : null,
  });
}
