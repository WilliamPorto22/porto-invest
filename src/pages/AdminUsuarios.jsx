import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs } from "firebase/firestore";
import { functions, db } from "../firebase";
import { useAuth } from "../hooks/useAuth";
import { Sidebar } from "../components/Sidebar";
import { Navbar } from "../components/Navbar";

const callListar = httpsCallable(functions, "listarUsuarios");
const callCriarAssessor = httpsCallable(functions, "criarAssessor");
const callExcluir = httpsCallable(functions, "excluirUsuario");
const callLimparEmail = httpsCallable(functions, "limparEmailAuth");
const callResetSenha = httpsCallable(functions, "resetarSenhaPadrao");
const callRestaurarAssessor = httpsCallable(functions, "restaurarAssessor");
const callDeduplicar = httpsCallable(functions, "deduplicarClientes");

function parsePatrimonio(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\D/g, "");
  if (!s) return 0;
  return Number(s) / 100;
}

function fmtBRL(n) {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export default function AdminUsuarios() {
  const { user, isMaster, loading } = useAuth();
  const [users, setUsers] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [form, setForm] = useState({ nome: "", email: "" });
  const [filtro, setFiltro] = useState("todos");
  const [ordem, setOrdem] = useState("valor-desc");
  const [emailLimpar, setEmailLimpar] = useState("");
  const [restaurarForm, setRestaurarForm] = useState({ nome: "", email: "" });

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const [resU, snapC] = await Promise.all([
        callListar(),
        getDocs(collection(db, "clientes")),
      ]);
      setUsers(resU.data?.users || []);
      setClientes(
        snapC.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    } catch (e) {
      setErro(e.message || "Falha ao listar usuários");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (isMaster) carregar();
  }, [isMaster]);

  async function criarAssessor(e) {
    e.preventDefault();
    if (!form.nome.trim() || !form.email.trim()) {
      setErro("Preencha nome e email");
      return;
    }
    setBusy(true);
    setErro("");
    setFeedback(null);
    try {
      const res = await callCriarAssessor({ nome: form.nome.trim(), email: form.email.trim() });
      const link = res.data?.resetLink;
      const senhaGerada = res.data?.senhaInicial || res.data?.senha;
      setFeedback({
        tipo: "ok",
        titulo: "Assessor criado",
        msg: `${form.nome} · senha temporária: ${senhaGerada}${link ? ` · link de reset: ${link}` : ""} — ele será forçado a trocar no primeiro login.`,
      });
      setForm({ nome: "", email: "" });
      await carregar();
    } catch (e) {
      setErro(e.message || "Falha ao criar assessor");
    } finally {
      setBusy(false);
    }
  }

  async function resetarSenha(uid, nome) {
    if (!confirm(`Redefinir a senha de "${nome}" para "PortoInvest$$"? Ele será forçado a trocar no próximo login.`)) return;
    setBusy(true);
    setErro("");
    setFeedback(null);
    try {
      await callResetSenha({ uid });
      setFeedback({ tipo: "ok", titulo: "Senha redefinida", msg: `${nome} · nova senha: PortoInvest$$ — ele será forçado a trocar no próximo login.` });
      await carregar();
    } catch (e) {
      setErro(e.message || "Falha ao resetar senha");
    } finally {
      setBusy(false);
    }
  }

  async function limparEmail(e) {
    e.preventDefault();
    const email = emailLimpar.trim().toLowerCase();
    if (!email) {
      setErro("Informe o email para liberar");
      return;
    }
    if (!confirm(`Liberar o email "${email}" removendo qualquer conta Firebase Auth vinculada a ele? Use isso quando um cadastro falhou e o email ficou bloqueado.`)) return;
    setBusy(true);
    setErro("");
    setFeedback(null);
    try {
      const res = await callLimparEmail({ email });
      if (res.data?.removed) {
        setFeedback({ tipo: "ok", titulo: "Email liberado", msg: `${email} foi removido do Firebase Auth. Você já pode recadastrar.` });
      } else {
        setFeedback({ tipo: "ok", titulo: "Nada a fazer", msg: `${email} não tem nenhuma conta no Auth.` });
      }
      setEmailLimpar("");
      await carregar();
    } catch (e) {
      setErro(e.message || "Falha ao limpar email");
    } finally {
      setBusy(false);
    }
  }

  async function excluir(uid, nome, email, role) {
    const rotulo = nome || email || uid;
    const confirmacao = prompt(
      `ATENÇÃO: esta ação apaga o login (Auth) e o doc em /users de "${rotulo}" (${role || "sem role"}).\n\n` +
      `Clientes vinculados são PRESERVADOS no Firestore, mas ficam sem assessor.\n\n` +
      `Para confirmar, digite o NOME completo OU o EMAIL exato do usuário:`
    );
    if (!confirmacao) return; // cancelou
    setBusy(true);
    setErro("");
    try {
      await callExcluir({ uid, confirmacao: confirmacao.trim() });
      setFeedback({ tipo: "ok", titulo: "Usuário excluído", msg: rotulo });
      await carregar();
    } catch (e) {
      setErro(e.message || "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }

  async function deduplicarClientes(dryRun) {
    const tituloAcao = dryRun ? "pré-visualizar duplicatas" : "APAGAR duplicatas";
    const aviso = dryRun
      ? "Rodar pré-visualização? Nenhum doc será apagado, só lista o que seria removido."
      : "Apagar permanentemente clientes duplicados (mesmo email ou CPF)?\n\n" +
        "Mantém 1 doc por grupo (o mais completo). Auth e /users do duplicado descartado também são apagados, mas SÓ se role=cliente — assessores e masters estão protegidos.";
    if (!confirm(aviso)) return;
    setBusy(true);
    setErro("");
    setFeedback(null);
    try {
      const res = await callDeduplicar({ dryRun: !!dryRun });
      const removidos = res.data?.removidos || [];
      const mantidos = res.data?.mantidos || [];
      const resumo = dryRun
        ? `Simulação: ${removidos.length} docs seriam apagados em ${mantidos.length} grupos.`
        : `${removidos.length} docs apagados em ${mantidos.length} grupos.`;
      const detalhes = removidos
        .slice(0, 30)
        .map((r) => `• ${r.nome || r.email || r.id} (${r.chave})`)
        .join("\n");
      setFeedback({
        tipo: "ok",
        titulo: dryRun ? "Pré-visualização de dedup" : "Duplicatas removidas",
        msg: `${resumo}${detalhes ? `\n${detalhes}` : ""}`,
      });
      if (!dryRun) await carregar();
    } catch (e) {
      setErro(e.message || `Falha ao ${tituloAcao}`);
    } finally {
      setBusy(false);
    }
  }

  async function restaurarAssessor(e) {
    e.preventDefault();
    const nome = restaurarForm.nome.trim();
    const email = restaurarForm.email.trim();
    if (!nome || !email) {
      setErro("Informe nome e email do assessor a restaurar.");
      return;
    }
    if (!confirm(`Restaurar assessor "${nome}" (${email})? Se o login ainda existe, só vou recriar o perfil e resetar a senha. Se não, crio do zero.`)) return;
    setBusy(true);
    setErro("");
    setFeedback(null);
    try {
      const res = await callRestaurarAssessor({ nome, email });
      const { authExistia, senhaInicial, resetLink } = res.data || {};
      setFeedback({
        tipo: "ok",
        titulo: authExistia ? "Assessor restaurado" : "Assessor recriado",
        msg: `${nome} · senha: ${senhaInicial} (troca obrigatória no primeiro login)${resetLink ? ` · link de reset: ${resetLink}` : ""}`,
      });
      setRestaurarForm({ nome: "", email: "" });
      await carregar();
    } catch (e) {
      setErro(e.message || "Falha ao restaurar assessor");
    } finally {
      setBusy(false);
    }
  }

  const custodiaPorAssessor = useMemo(() => {
    const map = {};
    for (const c of clientes) {
      const adv = c.advisorId || c.assessorId;
      if (!adv) continue;
      const pat = parsePatrimonio(c.patrimonio);
      map[adv] = (map[adv] || 0) + pat;
    }
    return map;
  }, [clientes]);

  const patrimonioPorUserId = useMemo(() => {
    const map = {};
    for (const c of clientes) {
      if (c.userId) map[c.userId] = parsePatrimonio(c.patrimonio);
    }
    return map;
  }, [clientes]);

  const usersEnriquecidos = useMemo(() => {
    return users.map((u) => {
      let valor = 0;
      if (u.role === "assessor" || u.role === "master") {
        valor = custodiaPorAssessor[u.uid] || 0;
      } else if (u.role === "cliente") {
        valor = patrimonioPorUserId[u.uid] || 0;
      }
      return { ...u, valor };
    });
  }, [users, custodiaPorAssessor, patrimonioPorUserId]);

  const lista = useMemo(() => {
    let arr = usersEnriquecidos;
    if (filtro !== "todos") arr = arr.filter((u) => u.role === filtro);
    const sorted = [...arr];
    switch (ordem) {
      case "nome-asc":
        sorted.sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
        break;
      case "nome-desc":
        sorted.sort((a, b) => (b.nome || "").localeCompare(a.nome || "", "pt-BR"));
        break;
      case "valor-desc":
        sorted.sort((a, b) => (b.valor || 0) - (a.valor || 0));
        break;
      case "valor-asc":
        sorted.sort((a, b) => (a.valor || 0) - (b.valor || 0));
        break;
      default:
        break;
    }
    return sorted;
  }, [usersEnriquecidos, filtro, ordem]);

  const contagem = useMemo(() => {
    const by = { master: 0, assessor: 0, cliente: 0, sem: 0 };
    users.forEach((u) => {
      if (u.role && by[u.role] !== undefined) by[u.role]++;
      else by.sem++;
    });
    return by;
  }, [users]);

  const totalCustodia = useMemo(
    () => Object.values(custodiaPorAssessor).reduce((a, b) => a + b, 0),
    [custodiaPorAssessor]
  );

  if (loading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (!isMaster) return <Navigate to="/dashboard" replace />;

  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar />
      <Navbar showLogout={true} />
      <div className="dashboard-content with-sidebar">
        <div className="admin-users-wrap">
          <header className="admin-users-header">
            <div>
              <div className="admin-users-eyebrow">Administrador</div>
              <h1 className="admin-users-title">Usuários</h1>
              <p className="admin-users-sub">
                Crie assessores e visualize todos os usuários do sistema. Clientes são criados
                automaticamente pelo cadastro de cliente.
              </p>
            </div>
            <div className="admin-users-stats">
              <div className="admin-stat"><span>{contagem.master}</span>Master</div>
              <div className="admin-stat"><span>{contagem.assessor}</span>Assessores</div>
              <div className="admin-stat"><span>{contagem.cliente}</span>Clientes</div>
              <div className="admin-stat"><span style={{fontSize:14}}>{fmtBRL(totalCustodia)}</span>Custódia total</div>
            </div>
          </header>

          <section className="admin-users-card">
            <h2 className="admin-users-card-title">Criar assessor</h2>
            <form onSubmit={criarAssessor} className="admin-users-form">
              <input
                placeholder="Nome completo"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                disabled={busy}
              />
              <input
                type="email"
                placeholder="email@dominio.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={busy}
              />
              <button type="submit" disabled={busy} className="admin-users-btn-primary">
                {busy ? "Criando..." : "Criar assessor"}
              </button>
            </form>
            <div className="admin-users-hint">
              Senha temporária gerada automaticamente. No primeiro login o assessor é forçado a trocar a senha.
            </div>
          </section>

          <section className="admin-users-card">
            <h2 className="admin-users-card-title">Liberar email bloqueado</h2>
            <form onSubmit={limparEmail} className="admin-users-form">
              <input
                type="email"
                placeholder="email@dominio.com"
                value={emailLimpar}
                onChange={(e) => setEmailLimpar(e.target.value)}
                disabled={busy}
                style={{gridColumn:"1 / span 2"}}
              />
              <button type="submit" disabled={busy} className="admin-users-btn-primary">
                {busy ? "Limpando..." : "Liberar email"}
              </button>
            </form>
            <div className="admin-users-hint" style={{color:"#f87171"}}>
              ⚠ Protegido: se o email pertencer a um assessor ou master ativo, a operação é recusada. Use só para emails órfãos (cadastros falhos, testes antigos).
            </div>
          </section>

          <section className="admin-users-card" style={{borderColor:"rgba(239,68,68,0.3)"}}>
            <h2 className="admin-users-card-title">Limpar clientes duplicados</h2>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button
                onClick={() => deduplicarClientes(true)}
                disabled={busy}
                className="admin-users-chip"
                style={{padding:"10px 18px"}}
              >
                {busy ? "Verificando…" : "Pré-visualizar (dry run)"}
              </button>
              <button
                onClick={() => deduplicarClientes(false)}
                disabled={busy}
                className="admin-users-btn-danger"
                style={{padding:"10px 18px"}}
              >
                {busy ? "Apagando…" : "Apagar duplicatas"}
              </button>
            </div>
            <div className="admin-users-hint">
              Agrupa por <strong>email</strong> e <strong>CPF</strong>. Mantém o doc mais completo (com login, carteira ou mais antigo) e apaga os demais. Auth/users do descartado só é removido se role = <code>cliente</code> — assessor/master estão protegidos contra remoção acidental.
            </div>
          </section>

          <section className="admin-users-card" style={{borderColor:"rgba(34,197,94,0.35)"}}>
            <h2 className="admin-users-card-title">Restaurar assessor</h2>
            <form onSubmit={restaurarAssessor} className="admin-users-form">
              <input
                placeholder="Nome completo"
                value={restaurarForm.nome}
                onChange={(e) => setRestaurarForm((f) => ({ ...f, nome: e.target.value }))}
                disabled={busy}
              />
              <input
                type="email"
                placeholder="email@dominio.com"
                value={restaurarForm.email}
                onChange={(e) => setRestaurarForm((f) => ({ ...f, email: e.target.value }))}
                disabled={busy}
              />
              <button type="submit" disabled={busy} className="admin-users-btn-primary">
                {busy ? "Restaurando..." : "Restaurar"}
              </button>
            </form>
            <div className="admin-users-hint">
              Recria o perfil de um assessor que sumiu da lista. Se o login (Auth) ainda existe, reaproveita e reseta a senha para uma senha temporária gerada automaticamente. Se não existe, cria do zero. Troca obrigatória no primeiro acesso.
            </div>
          </section>

          {erro && <div className="admin-users-erro">{erro}</div>}
          {feedback && (
            <div className={`admin-users-feedback ${feedback.tipo}`}>
              <strong>{feedback.titulo}:</strong> {feedback.msg}
            </div>
          )}

          <section className="admin-users-card">
            <div className="admin-users-list-header">
              <h2 className="admin-users-card-title">Todos os usuários</h2>
              <div className="admin-users-filtros">
                {["todos", "master", "assessor", "cliente"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={`admin-users-chip ${filtro === f ? "active" : ""}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              <span style={{fontSize:11,color:"#8895a8",alignSelf:"center",marginRight:4,textTransform:"uppercase",letterSpacing:"0.1em"}}>Ordenar:</span>
              {[
                {k:"valor-desc", l:"Maior valor"},
                {k:"valor-asc", l:"Menor valor"},
                {k:"nome-asc", l:"Nome A-Z"},
                {k:"nome-desc", l:"Nome Z-A"},
              ].map(o => (
                <button
                  key={o.k}
                  onClick={() => setOrdem(o.k)}
                  className={`admin-users-chip ${ordem === o.k ? "active" : ""}`}
                >
                  {o.l}
                </button>
              ))}
              <button onClick={carregar} disabled={carregando} className="admin-users-chip" style={{marginLeft:"auto"}}>
                {carregando ? "Atualizando…" : "↻ Atualizar"}
              </button>
            </div>

            {carregando ? (
              <div className="admin-users-empty">Carregando…</div>
            ) : lista.length === 0 ? (
              <div className="admin-users-empty">Nenhum usuário nesse filtro.</div>
            ) : (
              <div className="admin-users-table">
                <div className="admin-users-row admin-users-row-head">
                  <div>Nome</div>
                  <div>Email</div>
                  <div>Role</div>
                  <div>Patrimônio / Custódia</div>
                  <div>Status</div>
                  <div></div>
                </div>
                {lista.map((u) => (
                  <div key={u.uid} className="admin-users-row">
                    <div>{u.nome || "—"}</div>
                    <div className="admin-users-email">{u.email || "—"}</div>
                    <div>
                      <span className={`admin-users-badge role-${u.role || "none"}`}>
                        {u.role || "—"}
                      </span>
                    </div>
                    <div style={{fontVariantNumeric:"tabular-nums",fontWeight:600,color:u.valor>0?"#F0A202":"#8895a8"}}>
                      {u.role === "assessor" || u.role === "master"
                        ? fmtBRL(u.valor)
                        : u.role === "cliente"
                          ? fmtBRL(u.valor)
                          : "—"}
                    </div>
                    <div>
                      {u.mustResetPassword ? (
                        <span className="admin-users-badge warn">precisa resetar</span>
                      ) : u.active ? (
                        <span className="admin-users-badge ok">ativo</span>
                      ) : (
                        <span className="admin-users-badge muted">inativo</span>
                      )}
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {u.uid !== user.uid && (
                        <>
                          <button
                            onClick={() => resetarSenha(u.uid, u.nome || u.email || u.uid)}
                            disabled={busy}
                            className="admin-users-chip"
                            title="Redefine a senha para a senha padrão do sistema"
                          >
                            🔑 Resetar
                          </button>
                          <button
                            onClick={() => excluir(u.uid, u.nome, u.email, u.role)}
                            disabled={busy}
                            className="admin-users-btn-danger"
                          >
                            Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
