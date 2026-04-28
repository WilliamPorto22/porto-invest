/**
 * pushNotifications.js — FCM Web Push para clientes Porto Invest
 *
 * SETUP (uma vez):
 *   1. Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
 *   2. Clique em "Generate key pair" → copie a chave pública VAPID
 *   3. Cole abaixo substituindo o placeholder
 *
 * O token FCM é salvo em clientes/{id}.fcmToken e lido pela Cloud Function
 * `notificarAportesAtrasados` para enviar a notificação diária.
 */

import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { doc, setDoc } from "firebase/firestore";
import { app, db } from "../firebase";

// ─── VAPID key — gerada no Firebase Console → Cloud Messaging → Web Push ───
const VAPID_KEY = "SEU_VAPID_KEY_AQUI";

let _messaging = null;

function getMsg() {
  if (!_messaging) _messaging = getMessaging(app);
  return _messaging;
}

/**
 * Solicita permissão de notificação, obtém token FCM e salva em Firestore.
 * Idempotente: re-chamar com token já salvo não produz efeitos extras.
 *
 * @param {string} clienteId
 * @returns {Promise<string|null>} token ou null se bloqueado/não suportado
 */
export async function registrarPushCliente(clienteId) {
  if (!clienteId) return null;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;
  // Safari < 16.1 não suporta FCM web push
  if (!("PushManager" in window)) return null;

  try {
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm !== "granted") return null;

    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMsg(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;

    // Persiste token — Cloud Function usa pra enviar push
    await setDoc(
      doc(db, "clientes", clienteId),
      { fcmToken: token },
      { merge: true }
    );
    return token;
  } catch (e) {
    // Silencioso em prod — browser bloqueou ou VAPID inválida
    console.warn("[Push] erro ao registrar:", e.message || e);
    return null;
  }
}

/**
 * Listener de mensagens enquanto o app está em foreground.
 * Retorna a função de cancelamento (unsubscribe).
 *
 * @param {function} callback  ({ title, body, data }) => void
 * @returns {function} unsubscribe
 */
export function ouvirMensagensForeground(callback) {
  try {
    return onMessage(getMsg(), (payload) => {
      callback({
        title: payload.notification?.title || "Porto Invest",
        body:  payload.notification?.body  || "",
        data:  payload.data || {},
      });
    });
  } catch {
    return () => {};
  }
}
