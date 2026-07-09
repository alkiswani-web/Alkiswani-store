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

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png'
  });
});

const CACHE = 'alkiswani-v121';
const FB = 'https://www.gstatic.com/firebasejs/10.12.0';

const PRECACHE = [
  '/app.js',
  `${FB}/firebase-app-compat.js`,
  `${FB}/firebase-auth-compat.js`,
  `${FB}/firebase-firestore-compat.js`,
  `${FB}/firebase-storage-compat.js`,
  `${FB}/firebase-functions-compat.js`,
  `${FB}/firebase-messaging-compat.js`,
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// network-first مع مهلة: لو النت بطيء نعرض النسخة المخزنة فوراً والتحديث ينزل بالخلفية للفتحة الجاية
function networkFirstWithTimeout(req, timeoutMs) {
  return caches.match(req).then(cached => {
    const networkFetch = fetch(req).then(res => {
      if(res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return res;
    });
    if(!cached) return networkFetch; // أول زيارة: لازم النت
    const timer = new Promise(resolve => setTimeout(() => resolve(cached), timeoutMs));
    return Promise.race([networkFetch.catch(() => cached), timer]);
  });
}

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // app.js: network-first with timeout fallback to cache
  if(url.endsWith('/app.js') || url.includes('/app.js?')) {
    e.respondWith(networkFirstWithTimeout(e.request, 2500));
    return;
  }

  // Firebase SDK (gstatic): cache-first — versioned, never changes
  if(url.includes('gstatic.com/firebasejs/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if(res && res.status === 200)
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Firestore/FCM API calls: never cache
  if(url.includes('firestore.googleapis.com') ||
     url.includes('fcm.googleapis.com') ||
     url.includes('firebase.googleapis.com') ||
     url.includes('identitytoolkit') ||
     url.includes('securetoken')) {
    return;
  }

  // HTML (navigation): network-first with timeout fallback to cache
  if(e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(networkFirstWithTimeout(e.request, 2500));
    return;
  }

  // Other static assets: network-first, cache fallback
  e.respondWith(
    fetch(e.request).then(res => {
      if(res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
