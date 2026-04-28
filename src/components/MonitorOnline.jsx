import { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy, limit, where } from "firebase/firestore";
import { db } from "../firebase";

const BG = "#0D1321";
const CARD = "#1D2D44";
const BD = "rgba(62,92,118,0.35)";
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fmtDateTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function dayKey(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return "—"; }
}

function isOnlineNow(p) {
  if (!p.isOnline) return false;
  if (!p.lastSeen) return false;
  try {
    const d = p.lastSeen.toDate ? p.lastSeen.toDate() : new Date(p.lastSeen);
    return Date.now() - d.getTime() < ONLINE_THRESHOLD_MS;
  } catch { return false; }
}

const ROLE_LABEL = { master: "Admin", assessor: "Assessor", cliente: "Cliente" };
const ROLE_COLOR = { master: "#f0a202", assessor: "#5B9BD5", cliente: "#22c55e" };

function RoleBadge({ role }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
      textTransform: "uppercase", padding: "2px 7px", borderRadius: 99,
      background: `${ROLE_COLOR[role] || "#748CAB"}22`,
      color: ROLE_COLOR[role] || "#748CAB",
      border: `1px solid ${ROLE_COLOR[role] || "#748CAB"}44`,
    }}>
      {ROLE_LABEL[role] || role || "—"}
    </span>
  );
}

function OnlineDot({ online }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: online ? "#22c55e" : "#3E5C76",
      boxShadow: online ? "0 0 6px #22c55e88" : "none",
      flexShrink: 0,
    }} />
  );
}

export function MonitorOnline({ onClose }) {
  const [presence, setPresence] = useState([]);
  const [activity, setActivity] = useState([]);
  const [tab, setTab] = useState("online");
  const [loadingPresence, setLoadingPresence] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);

  // Presença em tempo real
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "presence"), (snap) => {
      setPresence(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingPresence(false);
    }, () => setLoadingPresence(false));
    return unsub;
  }, []);

  // Histórico de logins (últimos 300)
  useEffect(() => {
    const q = query(
      collection(db, "activity"),
      where("type", "==", "login"),
      orderBy("timestamp", "desc"),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingActivity(false);
    }, () => setLoadingActivity(false));
    return unsub;
  }, []);

  const online = presence.filter(isOnlineNow);
  const offline = presence.filter(p => !isOnlineNow(p));

  // Agrupa histórico por dia
  const byDay = activity.reduce((acc, a) => {
    const key = dayKey(a.timestamp);
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});
  const days = Object.keys(byDay);

  const tabStyle = (active) => ({
    flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 600,
    letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer",
    border: "none", background: active ? "rgba(91,155,213,0.15)" : "transparent",
    color: active ? "#5B9BD5" : "#748CAB",
    borderBottom: active ? "2px solid #5B9BD5" : "2px solid transparent",
    transition: "all 0.15s",
  });

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
    >
      <div style={{
        background: BG, border: `1px solid ${BD}`,
        borderRadius: 16, width: "100%", maxWidth: 560,
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px 14px", borderBottom: `1px solid ${BD}`,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>👁</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e8f0f7" }}>
                Monitor de Usuários
              </div>
              <div style={{ fontSize: 11, color: "#748CAB", marginTop: 1 }}>
                {online.length} online agora · {presence.length} cadastrados
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.06)", border: `1px solid ${BD}`,
              borderRadius: 8, color: "#748CAB", cursor: "pointer",
              width: 32, height: 32, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 18, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${BD}`, flexShrink: 0 }}>
          <button style={tabStyle(tab === "online")} onClick={() => setTab("online")}>
            Online ({online.length})
          </button>
          <button style={tabStyle(tab === "historico")} onClick={() => setTab("historico")}>
            Histórico ({activity.length})
          </button>
        </div>

        {/* Content */}
        <div style={{ overflowY: "auto", flex: 1, padding: "12px 16px" }}>

          {/* ABA: ONLINE */}
          {tab === "online" && (
            <>
              {loadingPresence ? (
                <div style={{ textAlign: "center", color: "#748CAB", padding: "32px 0", fontSize: 13 }}>
                  Carregando...
                </div>
              ) : presence.length === 0 ? (
                <div style={{ textAlign: "center", color: "#748CAB", padding: "32px 0", fontSize: 13 }}>
                  Nenhum usuário registrado ainda
                </div>
              ) : (
                <>
                  {/* Online agora */}
                  {online.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#22c55e", textTransform: "uppercase", marginBottom: 8, marginTop: 4 }}>
                        ● Online agora
                      </div>
                      {online.map(p => (
                        <UserRow key={p.id} p={p} online />
                      ))}
                    </>
                  )}

                  {/* Offline recente */}
                  {offline.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#748CAB", textTransform: "uppercase", marginBottom: 8, marginTop: online.length > 0 ? 16 : 4 }}>
                        ○ Offline
                      </div>
                      {offline.sort((a, b) => {
                        const ta = a.lastSeen?.toDate ? a.lastSeen.toDate() : new Date(0);
                        const tb = b.lastSeen?.toDate ? b.lastSeen.toDate() : new Date(0);
                        return tb - ta;
                      }).map(p => (
                        <UserRow key={p.id} p={p} online={false} />
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ABA: HISTÓRICO */}
          {tab === "historico" && (
            <>
              {loadingActivity ? (
                <div style={{ textAlign: "center", color: "#748CAB", padding: "32px 0", fontSize: 13 }}>
                  Carregando...
                </div>
              ) : days.length === 0 ? (
                <div style={{ textAlign: "center", color: "#748CAB", padding: "32px 0", fontSize: 13 }}>
                  Nenhum login registrado ainda
                </div>
              ) : days.map(day => (
                <div key={day} style={{ marginBottom: 20 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
                    textTransform: "uppercase", color: "#5B9BD5",
                    marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ flex: 1, height: 1, background: BD }} />
                    <span>{day}</span>
                    <span style={{ color: "#748CAB", fontWeight: 500, fontSize: 10 }}>
                      {byDay[day].length} login{byDay[day].length !== 1 ? "s" : ""}
                    </span>
                    <span style={{ flex: 1, height: 1, background: BD }} />
                  </div>
                  {byDay[day].map(a => (
                    <div key={a.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 8, marginBottom: 4,
                      background: CARD, border: `1px solid ${BD}`,
                    }}>
                      <span style={{ fontSize: 14, color: "#748CAB", fontVariantNumeric: "tabular-nums", minWidth: 42 }}>
                        {fmtTime(a.timestamp)}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: "#c7d3e0", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.nome || a.email || "—"}
                      </span>
                      <RoleBadge role={a.role} />
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 20px", borderTop: `1px solid ${BD}`,
          fontSize: 10, color: "#3E5C76", textAlign: "center", flexShrink: 0,
        }}>
          Atualiza em tempo real · Online = ativo nos últimos 5 min
        </div>
      </div>
    </div>
  );
}

function UserRow({ p, online }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 12px", borderRadius: 10, marginBottom: 4,
      background: CARD, border: `1px solid ${online ? "rgba(34,197,94,0.2)" : BD}`,
    }}>
      <OnlineDot online={online} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e8f0f7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.nome || p.email || "—"}
        </div>
        <div style={{ fontSize: 11, color: "#748CAB", marginTop: 1 }}>
          {p.email || "—"} · visto {fmtDateTime(p.lastSeen)}
        </div>
      </div>
      <RoleBadge role={p.role} />
    </div>
  );
}
