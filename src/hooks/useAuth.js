import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { ROLES, MASTER_EMAIL } from "../constants/roles";
import { lerClienteComFallback } from "../services/lerClienteFallback";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // profileReady: false até o PRIMEIRO snapshot de /users/{uid} chegar.
  // Evita a janela onde loading=false mas role=null — que fazia a rota
  // protegida redirecionar errado e a página interna re-montar.
  const [profileReady, setProfileReady] = useState(false);
  const [error, setError] = useState(null);

  const profileRef = useRef(profile);
  profileRef.current = profile;

  // 1) Escuta mudanças de auth
  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
        if (!currentUser) {
          setProfile(null);
          setProfileReady(true); // sem user não tem profile pra esperar
        } else {
          setProfileReady(false); // novo login → aguarda snapshot
        }
      },
      (err) => {
        setError(err.message);
        setAuthLoading(false);
        setProfileReady(true);
      }
    );
    return () => unsub();
  }, []);

  // 2) Escuta mudanças no doc /users/{uid} do usuário atual.
  //    Estratégia local-first: hidrata do cache imediatamente, atualiza em
  //    background. Failsafe 1.99s pra cumprir SLA do projeto.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const ref = doc(db, "users", user.uid);
    const cacheKey = `pi_profile_${user.uid}`;

    // 1) Hidratação instantânea do cache (renderização < 50ms)
    let temCache = false;
    let cachedProfile = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.data) {
          temCache = true;
          cachedProfile = cached.data;
          setProfile(cached.data);
          setProfileReady(true);
        }
      }
    } catch { /* cache corrompido, ignora */ }

    // 2) Failsafe 1.99s — só relevante se sem cache (primeiro login)
    let failsafe = null;
    if (!temCache) {
      failsafe = setTimeout(() => {
        if (alive) {
          // eslint-disable-next-line no-console
          console.warn("[useAuth] failsafe 1.99s — liberando profileReady");
          setProfileReady(true);
        }
      }, 1990);
    }

    // 3) PREFETCH paralelo: assim que auth resolve e profile chega,
    //    se for cliente, já dispara fetch do doc /clientes/{clienteId}
    //    pra que ClienteFicha encontre o cache pronto quando montar.
    //    Roda em paralelo com o resto, não bloqueia.
    const triedPrefetchRef = { current: false };
    function tentarPrefetchCliente(profileData){
      if (triedPrefetchRef.current) return;
      const clienteId = profileData?.clienteId;
      if (!clienteId) return;
      triedPrefetchRef.current = true;
      // Usa o helper (lida com cliente sem role claim via Cloud Function).
      // Helper já popula o cache em memória + localStorage internamente.
      lerClienteComFallback(clienteId).catch(() => { /* silencia */ });
    }

    // Se já tinha profile em cache com clienteId, dispara prefetch já
    if (cachedProfile) tentarPrefetchCliente(cachedProfile);

    // 4) Background fetch — atualiza estado E cache
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!alive) return;
        if (failsafe) clearTimeout(failsafe);
        const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        setProfile(data);
        setProfileReady(true);
        // Atualiza cache pra próxima visita
        try {
          if (data) localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
          else localStorage.removeItem(cacheKey);
        } catch { /* segue */ }
        // Prefetch cliente data em paralelo (se for cliente)
        if (data) tentarPrefetchCliente(data);
      },
      (err) => {
        if (!alive) return;
        if (failsafe) clearTimeout(failsafe);
        setError(err.message);
        // Mantém cache; só limpa profile se não tinha cache
        if (!temCache) {
          setProfile(null);
          setProfileReady(true);
        }
      }
    );
    return () => {
      alive = false;
      if (failsafe) clearTimeout(failsafe);
      unsub();
    };
  }, [user]);

  // 3) Presence tracking — mantém /presence/{uid} atualizado enquanto logado.
  //    Heartbeat a cada 4 min (antes 2min); pausa quando aba escondida para
  //    reduzir writes em Firestore. Janela de "online" no UI é 5 min.
  useEffect(() => {
    if (!user) return;

    const presenceRef = doc(db, "presence", user.uid);

    const writePresence = () => {
      const p = profileRef.current;
      setDoc(presenceRef, {
        uid: user.uid,
        nome: p?.nome || user.displayName || user.email?.split("@")[0] || "Usuário",
        role: p?.role || null,
        email: user.email,
        isOnline: true,
        lastSeen: serverTimestamp(),
      }, { merge: true }).catch(() => {});
    };

    const markOffline = () => {
      setDoc(presenceRef, { isOnline: false, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
    };

    writePresence();

    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(writePresence, 4 * 60 * 1000);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.hidden) { stop(); markOffline(); }
      else { writePresence(); start(); }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", markOffline);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", markOffline);
      markOffline();
    };
  }, [user]);

  // Atualiza nome/role na presence SÓ quando esses campos mudam — antes
  // escrevia no Firestore a cada snapshot do profile, causando loop de writes.
  const lastPresenceRef = useRef({ nome: null, role: null });
  useEffect(() => {
    if (!user || !profile) return;
    const nome = profile.nome || user.email?.split("@")[0] || "Usuário";
    const role = profile.role ?? null;
    if (lastPresenceRef.current.nome === nome && lastPresenceRef.current.role === role) return;
    lastPresenceRef.current = { nome, role };
    const presenceRef = doc(db, "presence", user.uid);
    setDoc(presenceRef, { nome, role }, { merge: true }).catch(() => {});
  }, [user, profile]);

  const roleFromProfile = profile?.role ?? null;

  const isBootstrapMaster =
    !roleFromProfile && user?.email?.toLowerCase() === MASTER_EMAIL.toLowerCase();

  const role = roleFromProfile || (isBootstrapMaster ? ROLES.MASTER : null);

  // Preview override — permite visualizar a UI como cliente sem precisar
  // deslogar do master/assessor. Ativar no console do browser:
  //   localStorage.setItem("__previewAsCliente","1"); location.reload();
  // Desativar:
  //   localStorage.removeItem("__previewAsCliente"); location.reload();
  // NÃO afeta permissões reais do Firestore (rules continuam usando o token
  // verdadeiro). Serve só pra testar visualmente o que o cliente vê.
  const previewAsCliente =
    typeof window !== "undefined" &&
    window.localStorage?.getItem("__previewAsCliente") === "1";

  return {
    user,
    profile,
    role: previewAsCliente ? ROLES.CLIENTE : role,
    loading: authLoading || (!!user && !profileReady),
    error,
    isAuthenticated: !!user,
    isMaster: previewAsCliente ? false : role === ROLES.MASTER,
    isAssessor: previewAsCliente ? false : role === ROLES.ASSESSOR,
    isCliente: previewAsCliente ? true : role === ROLES.CLIENTE,
    isBootstrapMaster,
  };
}
