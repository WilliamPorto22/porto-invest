import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  signOut,
} from "firebase/auth";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useAuth } from "../hooks/useAuth";
import { Sidebar } from "../components/Sidebar";
import { Navbar } from "../components/Navbar";

/**
 * Página de redefinição de senha.
 * Dois modos:
 *   1. Obrigatório (primeiro login): Login.jsx redireciona aqui quando
 *      mustResetPassword=true. Mensagem fala em "primeiro acesso".
 *   2. Voluntário: usuário acessa via botão "Trocar senha" no Navbar a
 *      qualquer momento. Mensagem genérica.
 *
 * Sem o modo voluntário, clientes/assessores que já trocaram a senha não
 * tinham nenhuma forma de mudar de novo dentro do app — só conseguiriam
 * via "Esqueci minha senha" na tela de login.
 */
export default function ResetPassword() {
  const { user, profile, loading, isCliente } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  // Quando o assessor clica "Trocar senha" pelo menu lateral DENTRO do contexto
  // de um cliente, o link traz `?cliente=<id>` — mantemos a sidebar do cliente
  // e oferecemos "Voltar ao painel". Sem o param, modo admin normal.
  const clienteContextoId = searchParams.get("cliente");
  const sidebarMode = isCliente || clienteContextoId ? "cliente" : "admin";
  const sidebarClienteId = isCliente ? profile?.clienteId : clienteContextoId;
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [verAtual, setVerAtual] = useState(false);
  const [verNova, setVerNova] = useState(false);
  const [verConfirmar, setVerConfirmar] = useState(false);

  if (loading) {
    return (
      <div className="protected-loading">
        <div className="protected-loading-text">Carregando...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  const obrigatorio = !!profile?.mustResetPassword;

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (novaSenha.length < 10) {
      setErr("Nova senha precisa ter pelo menos 10 caracteres.");
      return;
    }
    if (!/[A-Z]/.test(novaSenha) || !/[a-z]/.test(novaSenha) || !/[0-9]/.test(novaSenha)) {
      setErr("A senha precisa conter letras maiúsculas, minúsculas e números.");
      return;
    }
    if (novaSenha !== confirmar) {
      setErr("As senhas não coincidem.");
      return;
    }
    if (novaSenha === senhaAtual) {
      setErr("A nova senha deve ser diferente da atual.");
      return;
    }

    setBusy(true);
    try {
      // Reautentica com a senha atual (exigência do Firebase p/ operação sensível)
      const cred = EmailAuthProvider.credential(user.email, senhaAtual);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, novaSenha);
      await updateDoc(doc(db, "users", user.uid), {
        mustResetPassword: false,
        updatedAt: serverTimestamp(),
      });
      // Cliente volta pra própria ficha; resto vai pro dashboard.
      const destino =
        profile?.role === "cliente" && profile?.clienteId
          ? `/cliente/${profile.clienteId}`
          : "/dashboard";
      nav(destino, { replace: true });
    } catch (e) {
      if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        setErr("Senha atual incorreta.");
      } else if (e.code === "auth/weak-password") {
        setErr("Senha muito fraca.");
      } else {
        setErr(e.message || "Falha ao atualizar senha.");
      }
    } finally {
      setBusy(false);
    }
  }

  const eyebrowText = obrigatorio ? "🔒  PRIMEIRO ACESSO" : "🔒  CONTA SEGURA";

  function PassToggle({ visible, onToggle }) {
    return (
      <button
        type="button"
        className="reset-pass-toggle"
        onClick={onToggle}
        disabled={busy}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        title={visible ? "Ocultar senha" : "Mostrar senha"}
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    );
  }

  // Em "primeiro acesso" (mustResetPassword=true) NÃO mostramos a sidebar:
  // o usuário precisa trocar a senha antes de poder navegar para qualquer
  // outro lugar. No modo voluntário (botão "Trocar senha" no menu) mantemos
  // o layout padrão pra ele continuar vendo o resto da plataforma.
  if (obrigatorio) {
    return (
      <div className="reset-wrap">
        <form onSubmit={handleSubmit} className="reset-card">
          {renderFormBody()}
        </form>
      </div>
    );
  }

  // O wrapper `.reset-wrap` tem min-height:100vh !important e background
  // próprio (reset-modern.css). Não dá pra reutilizá-lo dentro do
  // dashboard-content sem criar scroll duplo / cor diferente. Por isso
  // renderizamos só o `.reset-card` aqui, centralizado por flex local.
  return (
    <div className="dashboard-container has-sidebar">
      <Sidebar
        mode={sidebarMode}
        clienteId={sidebarClienteId}
        clienteNome={isCliente ? profile?.nome : null}
      />
      <Navbar
        showLogout={true}
        actionButtons={!isCliente && clienteContextoId ? [
          {
            icon: "←",
            label: "Voltar ao painel",
            variant: "secondary",
            onClick: () => nav(`/cliente/${clienteContextoId}/painel`),
            title: "Voltar ao painel do cliente",
          },
        ] : []}
      />
      <div
        className="dashboard-content with-sidebar cliente-zoom"
        style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 28px 60px", display: "flex", justifyContent: "center" }}
      >
        <form onSubmit={handleSubmit} className="reset-card" style={{ marginTop: 20 }}>
          {renderFormBody()}
        </form>
      </div>
    </div>
  );

  function renderFormBody() {
    return (
      <>
        <span className="reset-eyebrow">{eyebrowText}</span>
        <h1 className="reset-title">{obrigatorio ? "Defina uma nova senha" : "Trocar senha"}</h1>
        <p className="reset-sub">
          {obrigatorio
            ? "Este é seu primeiro acesso. Por segurança, é obrigatório trocar a senha antes de continuar."
            : "Informe a senha atual e a nova senha. Você continua logado depois da troca."}
        </p>

        {err && <div className="reset-err">{err}</div>}

        <div className="reset-field">
          <label>Senha atual</label>
          <div className="reset-pass-wrap">
            <input
              type={verAtual ? "text" : "password"}
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <PassToggle visible={verAtual} onToggle={() => setVerAtual(v => !v)} />
          </div>
        </div>
        <div className="reset-field">
          <label>Nova senha (mín. 10 caracteres, com maiúscula, minúscula e número)</label>
          <div className="reset-pass-wrap">
            <input
              type={verNova ? "text" : "password"}
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              disabled={busy}
            />
            <PassToggle visible={verNova} onToggle={() => setVerNova(v => !v)} />
          </div>
        </div>
        <div className="reset-field">
          <label>Confirmar nova senha</label>
          <div className="reset-pass-wrap">
            <input
              type={verConfirmar ? "text" : "password"}
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              disabled={busy}
            />
            <PassToggle visible={verConfirmar} onToggle={() => setVerConfirmar(v => !v)} />
          </div>
        </div>

        <button type="submit" disabled={busy} className="reset-btn">
          {busy ? "Atualizando..." : "Salvar nova senha"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              await signOut(auth);
            } catch { /* ignora */ }
            nav("/", { replace: true });
          }}
          style={{
            width: "100%",
            height: 44,
            marginTop: 12,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 10,
            color: "#8FA3BF",
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          Sair e voltar pra tela de login
        </button>
      </>
    );
  }
}
