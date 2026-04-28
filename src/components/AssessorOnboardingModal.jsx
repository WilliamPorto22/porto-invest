import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../hooks/useAuth";
import "../styles/assessor-onboarding-modal.css";

/**
 * AssessorOnboardingModal
 *
 * Aparece UMA vez para cada assessor (ou master) que entra na plataforma sem
 * ter o telefone cadastrado em /users/{uid}. Pede confirmação de:
 *   • Nome
 *   • E-mail
 *   • Telefone (WhatsApp)
 *
 * Após salvar, os clientes daquele assessor passam a ter os botões de WhatsApp
 * apontando para o número correto — sem default global hardcoded.
 */
export default function AssessorOnboardingModal() {
  const { user, profile, loading, isMaster, isAssessor, isCliente } = useAuth();
  const { pathname } = useLocation();

  const [open, setOpen]         = useState(false);
  const [nome, setNome]         = useState("");
  const [email, setEmail]       = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro]         = useState("");

  useEffect(() => {
    // Bloqueia em rotas públicas (login, reset, raiz) — independente do estado de auth
    if (pathname === "/" || pathname === "/reset-password") { setOpen(false); return; }

    // Só aparece quando o assessor está efetivamente dentro da plataforma — na tela inicial
    if (pathname !== "/dashboard") { setOpen(false); return; }

    // Aguarda o auth e o profile estarem totalmente carregados
    if (loading) return;
    if (!user || !profile) return;

    // Cliente nunca vê esse modal
    if (isCliente) return;
    // Apenas master/assessor cadastrados (não bootstrap-master sem doc ainda)
    if (!(isMaster || isAssessor)) return;

    // Já confirmou? Não incomoda mais.
    if (profile.telefone && String(profile.telefone).trim()) return;

    // Delay de 2 segundos depois que o cliente já está no dashboard, para não
    // explodir na cara assim que carrega.
    const timer = setTimeout(() => {
      setNome(profile.nome || user.displayName || "");
      setEmail(profile.email || user.email || "");
      setTelefone("");
      setErro("");
      setOpen(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [pathname, loading, user, profile, isMaster, isAssessor, isCliente]);

  function formatarTelefoneInput(v) {
    const d = v.replace(/\D/g, "").slice(0, 13);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 9) return `(${d.slice(0,2)}) ${d.slice(2,3)} ${d.slice(3)}`;
    if (d.length <= 11) return `(${d.slice(0,2)}) ${d.slice(2,3)} ${d.slice(3,7)}-${d.slice(7)}`;
    // com DDI 55
    return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,5)} ${d.slice(5,9)}-${d.slice(9)}`;
  }

  async function salvar() {
    setErro("");
    if (!nome.trim())  { setErro("Informe o nome completo."); return; }
    if (!email.trim()) { setErro("Informe o e-mail."); return; }

    let tel = telefone.replace(/\D/g, "");
    if (tel.length < 10) {
      setErro("Telefone inválido. Inclua DDD + número (ex: 51 9 9999-9999).");
      return;
    }
    if (!tel.startsWith("55")) tel = "55" + tel;
    if (tel.length < 12 || tel.length > 13) {
      setErro("Telefone com formato inválido. Confira o número.");
      return;
    }

    setSalvando(true);
    try {
      await setDoc(doc(db, "users", user.uid), {
        nome: nome.trim(),
        email: email.trim(),
        telefone: tel,
        dadosConfirmadosEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setOpen(false);
    } catch (e) {
      const msg = e?.code === "permission-denied"
        ? "Permissão negada pelo Firestore. Recarregue a página e tente novamente — se persistir, contate o suporte técnico."
        : (e?.message ? `Erro ao salvar: ${e.message}` : "Não foi possível salvar agora. Tente novamente em instantes.");
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  function fechar() {
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="aom-overlay" role="dialog" aria-modal="true">
      <div className="aom-modal">
        <button
          type="button"
          className="aom-close"
          onClick={fechar}
          aria-label="Fechar"
        >×</button>
        <h2 className="aom-titulo">Confirme seus dados de contato</h2>
        <p className="aom-sub">
          Para que seus clientes possam falar diretamente com você pelo WhatsApp da plataforma,
          confirme as informações abaixo. Esses dados ficam vinculados aos seus clientes.
        </p>

        <label className="aom-label">
          <span>Nome completo</span>
          <input
            className="aom-input"
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Como você quer ser chamado"
            autoFocus
          />
        </label>

        <label className="aom-label">
          <span>E-mail</span>
          <input
            className="aom-input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
          />
        </label>

        <label className="aom-label">
          <span>Telefone (WhatsApp)</span>
          <input
            className="aom-input"
            value={formatarTelefoneInput(telefone)}
            onChange={e => setTelefone(e.target.value)}
            placeholder="(51) 9 9999-9999"
            inputMode="tel"
          />
          <small className="aom-hint">DDD + número. O DDI 55 é adicionado automaticamente.</small>
        </label>

        {erro && <div className="aom-erro">{erro}</div>}

        <button
          className="aom-btn-primary"
          onClick={salvar}
          disabled={salvando}
        >
          {salvando ? "Salvando…" : "Confirmar e continuar"}
        </button>
        <button
          type="button"
          className="aom-btn-link"
          onClick={fechar}
          disabled={salvando}
        >
          Lembrar depois
        </button>
      </div>
    </div>
  );
}
