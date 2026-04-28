/* ─── Firebase Messaging Service Worker ───────────────────────────────────
   Recebe notificações push quando o app está em background ou fechado.
   Versão do SDK deve ser compatível com firebase ^12.x no app.
   ───────────────────────────────────────────────────────────────────────── */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB7aeZnsTbfrsOyPBRL6FBvIKJgrkBkg1E",
  authDomain: "william-porto.firebaseapp.com",
  projectId: "william-porto",
  storageBucket: "william-porto.firebasestorage.app",
  messagingSenderId: "169446627134",
  appId: "1:169446627134:web:d1922bb76f65790217fe6f",
});

const messaging = firebase.messaging();

// Mensagens em background: exibe notificação do sistema
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Porto Invest';
  const body  = payload.notification?.body  || '';
  const link  = payload.data?.link || '/';

  self.registration.showNotification(title, {
    body,
    icon:  '/pwa-192.png',
    badge: '/favicon-32.png',
    data:  { link },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  });
});

// Clique na notificação: abre/foca o app e navega para o link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const match = wins.find((w) => w.url.includes(self.location.origin));
      if (match) {
        match.focus();
        match.postMessage({ type: 'NAVIGATE', link });
      } else {
        clients.openWindow(link);
      }
    })
  );
});
