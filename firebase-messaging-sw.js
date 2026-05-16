importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAD1KJbggqncxkiqMWna8HaZdtjWHIvzpU",
  authDomain: "alkiswani-store.firebaseapp.com",
  projectId: "alkiswani-store",
  storageBucket: "alkiswani-store.firebasestorage.app",
  messagingSenderId: "60330492719",
  appId: "1:60330492719:web:71e36dd5327db3e54017da"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const title = (payload.notification && payload.notification.title) || 'الكسواني روزميري';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    tag: (payload.data && payload.data.tag) || 'alkiswani',
    data: payload.data || {},
    requireInteraction: true,
    vibrate: [200, 100, 200]
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
