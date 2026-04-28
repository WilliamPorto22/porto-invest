// =====================================================================
// lerClienteFallback — leitura robusta de clientes/{id} com cache em
// 3 camadas + fallback Cloud Function.
//
// Estratégia (otimizada pra TTI < 1.9s e navegação instantânea):
//   0a) Cache em memória (5min TTL) — navegação entre páginas é instantânea
//   0b) Cache em localStorage (5min TTL) — render instantâneo após refresh
//       da aba, e populado em background pelo prefetch do useAuth
//   0c) Dedupe de requests inflight — duas páginas montando juntas só
//       disparam 1 leitura
//   1) Se a sessão já marcou "direct-blocked" (cliente sem role claim),
//      pula direto pra Cloud Function — economiza ~500ms de getDoc + refresh
//   2) Senão, getDoc direto (rápido, usa cache do Firestore)
//   3) Se permission-denied: marca a sessão e cai direto pra Cloud Function
//      (token refresh em background, sem bloquear)
//   4) Se erro de rede: cai direto pra Cloud Function (mais rápido que retry)
//
// Pages que escrevem em clientes/{id} devem chamar `invalidarCacheCliente(id)`
// depois do save pra forçar releitura imediata (limpa memória + localStorage).
// =====================================================================
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, auth, functions } from "../firebase";

// ---- Cache em memória: clienteId → { data, exists, ts }
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5min — saves invalidam explicitamente

// ---- Dedupe de requests em andamento
const _inflight = new Map();

// ---- localStorage: chave compatível com prefetch do useAuth
const _lsKey = (id) => `pi_cliente_${id}`;

function _lsRead(clienteId) {
  try {
    const raw = localStorage.getItem(_lsKey(clienteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.ts) return null;
    return parsed;
  } catch { return null; }
}
function _lsWrite(clienteId, data, exists) {
  try {
    localStorage.setItem(_lsKey(clienteId), JSON.stringify({ data, exists, ts: Date.now() }));
  } catch { /* localStorage cheio, ignora */ }
}
function _lsDelete(clienteId) {
  try { localStorage.removeItem(_lsKey(clienteId)); } catch { /* ignore */ }
}

export function invalidarCacheCliente(clienteId) {
  if (clienteId) {
    _cache.delete(clienteId);
    _lsDelete(clienteId);
  } else {
    _cache.clear();
    // Não limpa todos os pi_cliente_* do localStorage — outros uids podem coexistir
  }
}

// ---- Flag por sessão: se já descobrimos que getDoc é bloqueado pra esse uid,
//      pula direto pra CF nas próximas chamadas (economiza ~500ms cada)
function _directBlockedKey() {
  const uid = auth.currentUser?.uid || "anon";
  return `lerCliente:directBlocked:${uid}`;
}
function _isDirectBlocked() {
  try { return sessionStorage.getItem(_directBlockedKey()) === "1"; } catch { return false; }
}
function _markDirectBlocked() {
  try { sessionStorage.setItem(_directBlockedKey(), "1"); } catch { /* ignore */ }
  // Refresh em background — não bloqueia a request atual
  if (auth.currentUser) {
    auth.currentUser.getIdToken(true).catch(() => {});
  }
}

async function _viaCloudFunction(clienteId) {
  const callLer = httpsCallable(functions, "lerCliente", { timeout: 12000 });
  const res = await callLer({ clienteId });
  const r = res.data || {};
  return { exists: !!r.exists, data: r.data || null, source: "cloud-function" };
}

async function _viaGetDoc(clienteId) {
  const ref = doc(db, "clientes", clienteId);
  const s = await getDoc(ref);
  return { exists: s.exists(), data: s.exists() ? s.data() : null, source: "direct" };
}

async function _ler(clienteId) {
  // Atalho: cliente sem permissão direta → vai direto pra CF
  if (_isDirectBlocked()) {
    return await _viaCloudFunction(clienteId);
  }
  try {
    return await _viaGetDoc(clienteId);
  } catch (e1) {
    const isAuth = e1?.code === "permission-denied" || e1?.code === "unauthenticated";
    if (isAuth) _markDirectBlocked();
    try {
      return await _viaCloudFunction(clienteId);
    } catch (e2) {
      throw e2 || e1;
    }
  }
}

export async function lerClienteComFallback(clienteId, { isAlive = () => true, force = false } = {}) {
  // Cache hit em memória (skip se force=true)
  if (!force) {
    const cached = _cache.get(clienteId);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      if (!isAlive()) throw new Error("aborted");
      return { exists: cached.exists, data: cached.data, source: "cache" };
    }
    // Cache hit em localStorage — sobrevive a reload da aba
    const ls = _lsRead(clienteId);
    if (ls && (Date.now() - ls.ts) < CACHE_TTL) {
      _cache.set(clienteId, { data: ls.data, exists: ls.exists !== false, ts: ls.ts });
      if (!isAlive()) throw new Error("aborted");
      return { exists: ls.exists !== false, data: ls.data, source: "localStorage" };
    }
  }

  // Dedupe: se já tem uma leitura em andamento pra esse clienteId, junta
  let promise = _inflight.get(clienteId);
  if (!promise) {
    promise = _ler(clienteId)
      .then((r) => {
        const ts = Date.now();
        _cache.set(clienteId, { data: r.data, exists: r.exists, ts });
        if (r.exists && r.data) _lsWrite(clienteId, r.data, true);
        return r;
      })
      .finally(() => _inflight.delete(clienteId));
    _inflight.set(clienteId, promise);
  }

  const result = await promise;
  if (!isAlive()) throw new Error("aborted");
  return result;
}
