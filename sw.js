// Service Worker — roda em segundo plano no navegador, mesmo com o site fechado.
// Arquivo: sw.js (precisa ficar na RAIZ do site, não numa subpasta)

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Disparado quando o servidor envia um push (via efi-webhook.js)
self.addEventListener('push', (event) => {
  let data = { title: 'Formatura', body: 'Você tem uma nova notificação.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // payload não era JSON válido: mantém o padrão acima
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'formatura-pix',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Formatura', options));
});

// Quando a pessoa clica na notificação, abre (ou foca) o site
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
