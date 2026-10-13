/* LB's admin: shows staff notifications pushed by the server (new orders, tables calling, orders ready,
   bookings), with the phone's own sound, even when the admin isn't open. Tapping one opens the admin. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let msg = { title: "LB's admin", body: 'Something needs you.', tag: 'lbs', url: '/admin' };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    /* keep the default */
  }
  e.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      data: { url: msg.url },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      silent: false,
    }),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/admin', self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = wins.find(w => new URL(w.url).pathname.startsWith('/admin'));
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
