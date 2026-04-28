import { useLocation, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { lerClienteComFallback } from "../services/lerClienteFallback";
import { useAuth } from "../hooks/useAuth";
import { SilentBoundary } from "./SilentBoundary";

/**
 * WhatsAppButton — Pílula flutuante.
 *
 * Aparece apenas para o role CLIENTE, e somente quando há um assessor
 * vinculado ao cliente (advisorId/assessorId) com telefone cadastrado em
 * /users/{advisorId}.telefone. Sem default global — se o assessor ainda
 * não confirmou seus dados, a pílula simplesmente não aparece.
 *
 * Defer: monta após a primeira pintura via requestIdleCallback.
 */

function WhatsAppButtonInner() {
  const { pathname } = useLocation();
  const { id } = useParams();
  const { user, profile, isCliente } = useAuth();
  const [clienteNome, setClienteNome] = useState("");
  const [assessor, setAssessor]       = useState(null);

  // Esconde no Login e em rotas públicas
  const hide = pathname === "/" || pathname === "/reset-password";

  // Resolve qual cliente estamos olhando:
  //  • Se rota /cliente/:id → :id
  //  • Senão, cai no profile.clienteId (cliente final logado)
  const clienteId = id && id !== "novo" ? id : profile?.clienteId;

  // Carrega o cliente para descobrir advisorId + nome
  useEffect(() => {
    if (hide || !clienteId) { setClienteNome(""); setAssessor(null); return; }
    let cancel = false;
    (async () => {
      try {
        const r = await lerClienteComFallback(clienteId, { isAlive: () => !cancel });
        if (cancel || !r.exists || !r.data) return;
        setClienteNome(r.data.nome || "");
        const advisorId = r.data.advisorId || r.data.assessorId;
        if (!advisorId) { setAssessor(null); return; }
        const userSnap = await getDoc(doc(db, "users", advisorId));
        if (cancel) return;
        if (userSnap.exists()) setAssessor(userSnap.data());
      } catch { /* silencia */ }
    })();
    return () => { cancel = true; };
  }, [clienteId, hide]);

  if (hide || !user) return null;
  // Só mostra para clientes (assessor/master não recebem essa pílula)
  if (!isCliente) return null;
  // Sem assessor vinculado ou sem telefone confirmado → não exibe
  if (!assessor?.telefone) return null;

  const telefoneLimpo = String(assessor.telefone).replace(/\D/g, "");
  if (!telefoneLimpo) return null;

  const primeiroNomeCliente  = (clienteNome || profile?.nome || "").split(" ")[0];
  const primeiroNomeAssessor = String(assessor.nome || "").split(" ")[0] || "seu assessor";

  const remetente = primeiroNomeCliente
    ? `Olá ${primeiroNomeAssessor}, aqui é ${primeiroNomeCliente}. Gostaria de conversar sobre meu planejamento.`
    : `Olá ${primeiroNomeAssessor}, gostaria de conversar.`;

  const url = `https://wa.me/${telefoneLimpo}?text=${encodeURIComponent(remetente)}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="pi-whatsapp"
      aria-label={`Falar com ${primeiroNomeAssessor} no WhatsApp`}
    >
      <span className="pi-whatsapp-pulse" aria-hidden="true" />
      <svg className="pi-whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01ZM12.05 20.15h-.01a8.21 8.21 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.16 8.16 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.49-.4-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.86.85-.86 2.06s.88 2.39 1 2.55c.12.16 1.74 2.66 4.21 3.73.59.26 1.05.41 1.41.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.18-.47-.31Z"
        />
      </svg>
      <span className="pi-whatsapp-label">Falar com {primeiroNomeAssessor}</span>
    </a>
  );
}

// Wrapper exportado: defer mount + SilentBoundary
export default function WhatsAppButton() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancel = false;
    const mount = () => { if (!cancel) setReady(true); };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(mount, { timeout: 600 });
      return () => {
        cancel = true;
        if (window.cancelIdleCallback) window.cancelIdleCallback(id);
      };
    }
    const t = setTimeout(mount, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, []);

  if (!ready) return null;

  return (
    <SilentBoundary>
      <WhatsAppButtonInner />
    </SilentBoundary>
  );
}
