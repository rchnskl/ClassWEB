// Minimal service worker: receives Web Push events and shows a notification.
self.addEventListener('push', (event) => {
  let data = { title: 'ClassWeb', body: '' };
  try { data = event.data ? event.data.json() : data; } catch { /* ignore malformed payload */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ClassWeb', {
      body: data.body || '',
      icon: '/logos/university.png',
      badge: '/logos/university.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/dashboard'));
});
