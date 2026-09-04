// A service worker that caches nothing.
//
// WHY IT EXISTS AT ALL
//
// One reason only: notifications. On iOS and iPadOS the `new Notification(...)`
// constructor does not exist — a web page there can show a notification ONLY
// through `ServiceWorkerRegistration.showNotification()`, and only when the app
// has been added to the Home Screen. So without this file, the pomodoro alarm
// works on the Mac and is silently impossible on the phone. It also fixes
// notification CLICKS everywhere: without a `notificationclick` handler,
// clicking one does nothing at all.
//
// WHY IT DELIBERATELY DOES NOT CACHE
//
// The obvious next step — intercept `fetch`, serve from a cache, make the app
// work offline — is the single most common way a PWA breaks. A caching worker
// that outlives a deploy serves yesterday's JavaScript against today's
// database, and the symptom is a dashboard that is subtly, unreproducibly wrong
// for one person on one device until they clear site data. This app is online
// by nature: every tab it has reads Supabase or a market API, so offline mode
// would show empty cards rather than useful ones. The trade is all cost.
//
// There is NO `fetch` listener below, on purpose. That means the browser goes to
// the network for everything exactly as if this file did not exist, and a bad
// deploy of this worker cannot make the app unreachable. If offline support is
// ever genuinely wanted, it should be added with a versioned cache name and a
// deliberate invalidation story, not by adding four lines here.

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close. There is
  // no cache to migrate, so there is nothing an old worker is protecting.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Clicking the notification should put you back where you were.
//
// Focus an existing window if one is open — opening a second copy of the
// dashboard is worse than doing nothing — and only open a new one if there is
// none. `includeUncontrolled` matters: a tab loaded before this worker claimed
// it is still a window the person is looking at.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('/');
    return undefined;
  })());
});
