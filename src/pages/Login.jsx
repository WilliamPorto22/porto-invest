import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { T, C } from "../theme";
import { getValidationError } from "../utils/validators";
import { getErrorMessage, logError } from "../utils/errorHandler";
import { Message } from "../components/Message";
import { Logo } from "../components/Logo";
import { whatsappUrl } from "../constants/contato";

// Prefetch de rotas quentes em idle time — após a tela de login montar,
// pré-carrega Dashboard e ClienteFicha no cache do browser em background
// para que a navegação pós-login seja instantânea. Dashboard já importa
// Sidebar/Navbar estaticamente, então eles vêm no mesmo prefetch.
// Se o usuário nunca logar, o custo extra é < 30KB gzipped em background.
function prefetchRotasQuentes() {
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
  idle(() => {
    import("./Dashboard").catch(() => {});
    import("./ClienteFicha").catch(() => {});
  });
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // URL original que o usuário tentou acessar antes de ser redirecionado pro login
  const from = location.state?.from || null;

  useEffect(() => { prefetchRotasQuentes(); }, []);

  function validarFormulario() {
    // Validar email
    const emailErr = getValidationError("Email", email, "email");
    setEmailError(emailErr || "");

    // Validar senha
    if (!senha || senha.length < 6) {
      setErro("Senha deve ter no mínimo 6 caracteres");
      return false;
    }

    if (emailErr) {
      setErro("Corrija os erros antes de continuar");
      return false;
    }

    return true;
  }

  async function entrar() {
    setErro("");
    setEmailError("");

    if (!validarFormulario()) return;

    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), senha);
      // Checa se precisa trocar senha no primeiro login
      let destino = "/dashboard";
      let profileData = null;
      try {
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (snap.exists()) {
          profileData = snap.data();
          if (profileData.mustResetPassword) destino = "/reset-password";
          else if (profileData.role === "cliente" && profileData.clienteId)
            destino = "/me/home";
        }
      } catch { /* falha ao ler users — segue pro dashboard */ }
      // Registra evento de login no histórico
      addDoc(collection(db, "activity"), {
        userId: cred.user.uid,
        type: "login",
        nome: profileData?.nome || cred.user.displayName || cred.user.email?.split("@")[0] || "Usuário",
        role: profileData?.role || null,
        email: cred.user.email,
        timestamp: serverTimestamp(),
      }).catch(() => {});
      // Se o usuário foi redirecionado pro login a partir de uma URL protegida,
      // devolve pra lá após autenticar (exceto se precisar trocar senha).
      if (from && destino !== "/reset-password") destino = from;
      navigate(destino, { replace: true });
    } catch (e) {
      const mensagem = getErrorMessage(e);
      setErro(mensagem);
      logError("Login", e);
    }
    setLoading(false);
  }

  async function esqueciSenha() {
    setErro("");
    setAviso("");
    const emailErr = getValidationError("Email", email, "email");
    if (emailErr) {
      setEmailError(emailErr);
      setErro("Informe seu e-mail acima para receber o link de redefinição.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      // Mensagem neutra de propósito: não confirma se o e-mail existe
      // (prática de segurança — evita enumerar contas).
      setAviso(`Se houver uma conta com ${email.trim()}, enviamos um link para redefinir a senha. Confira sua caixa de entrada e a pasta de spam.`);
    } catch (e) {
      // user-not-found: exibimos a mesma mensagem neutra pra não vazar
      // se o email existe ou não. Demais erros (rede, rate limit) mostramos.
      if (e.code === "auth/user-not-found") {
        setAviso(`Se houver uma conta com ${email.trim()}, enviamos um link para redefinir a senha. Confira sua caixa de entrada e a pasta de spam.`);
      } else {
        setErro(getErrorMessage(e));
      }
      logError("SendPasswordResetEmail", e);
    }
    setLoading(false);
  }

  function onKey(e) {
    if (e.key === "Enter" && !loading) entrar();
  }

  return (
    <div className="login-container">
      <div className="login-wrapper">

        {/* Logo */}
        <div className="login-logo-section">
          <div className="login-logo-content" style={{ flexDirection: "column", gap: 10 }}>
            <Logo variant="login" height={72} />
            <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8FA3BF", fontWeight: 500 }}>
              Assessoria de Investimentos
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="login-card">
          <div className="login-header">
            <div className="login-title">Acesso à plataforma</div>
            <div className="login-subtitle">Ambiente exclusivo de gestão patrimonial</div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-email">E-mail</label>
            <input
              id="login-email"
              name="email"
              autoComplete="email"
              inputMode="email"
              className="form-input"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={e=>{setEmail(e.target.value);setEmailError("");}}
              onKeyDown={onKey}
              disabled={loading}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "login-email-error" : undefined}
              style={{
                borderColor: emailError ? "#ef4444" : undefined,
                opacity: loading ? 0.6 : 1,
              }}
            />
            {emailError && <div id="login-email-error" style={{fontSize:11,color:"#ef4444",marginTop:4}}>{emailError}</div>}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-senha">Senha</label>
            <div className="login-pass-wrap">
              <input
                id="login-senha"
                name="password"
                autoComplete="current-password"
                className="form-input"
                type={mostrarSenha ? "text" : "password"}
                placeholder="••••••••"
                value={senha}
                onChange={e=>setSenha(e.target.value)}
                onKeyDown={onKey}
                disabled={loading}
                style={{opacity: loading ? 0.6 : 1}}
              />
              <button
                type="button"
                className="login-pass-toggle"
                onClick={() => setMostrarSenha(v => !v)}
                disabled={loading}
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              >
                {mostrarSenha ? (
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
            </div>
          </div>

          {erro && <Message text={erro} type="error" duration={5000} onClose={()=>setErro("")} />}
          {aviso && <Message text={aviso} type="success" duration={8000} onClose={()=>setAviso("")} />}

          <div className="login-button-wrapper">
            <button className="btn btn-primary" onClick={entrar} disabled={loading}>
              {loading ? "Acessando..." : "Entrar"}
            </button>
          </div>

          <div className="login-forgot-row">
            <button
              type="button"
              className="login-forgot-btn"
              onClick={esqueciSenha}
              disabled={loading}
              title="Enviaremos um link para redefinir sua senha no e-mail cadastrado"
            >
              Esqueci minha senha
            </button>
          </div>

          <div className="login-footer">
            Acesso seguro · Dados protegidos
          </div>
        </div>

        {/* CTA de venda — leva o lead pro WhatsApp com mensagem pré-preenchida.
            Centralizado em src/constants/contato.js (atualize o número real lá). */}
        <div style={{
          marginTop: 18,
          textAlign: "center",
          fontSize: 13,
          color: "#9EB8D0",
          letterSpacing: "0.01em",
        }}>
          Ainda não é cliente?{" "}
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#22c55e",
              textDecoration: "none",
              fontWeight: 600,
              borderBottom: "1px dashed rgba(34,197,94,0.4)",
              paddingBottom: 1,
            }}
          >
            Fale com o William
          </a>
        </div>
      </div>
    </div>
  );
}