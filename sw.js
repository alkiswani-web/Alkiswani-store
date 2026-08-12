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

const CACHE = 'alkiswani-v225';
// كاش ثابت لملفات لا تتغيّر أبداً (رابطها يحمل رقم إصدارها).
// اسمه لا يتغيّر مع رفع النسخة، فلا يُعاد تنزيل Firebase SDK في كل مرة.
const STATIC = 'alkiswani-static-1';
const FB = 'https://www.gstatic.com/firebasejs/10.12.0';

const PRECACHE_STATIC = [
  `${FB}/firebase-app-compat.js`,
  `${FB}/firebase-auth-compat.js`,
  `${FB}/firebase-firestore-compat.js`,
  `${FB}/firebase-storage-compat.js`,
  `${FB}/firebase-functions-compat.js`,
  `${FB}/firebase-messaging-compat.js`,
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC).then(cache => cache.addAll(PRECACHE_STATIC)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // ننقل أي نسخة app.js مخزّنة إلى الكاش الدائم قبل حذف كاش النسخ القديمة.
    // كان الحذف فورياً، فيبقى الجهاز بلا أي app.js حتى ينزل الجديد — وإن
    // تعذّر التنزيل (شبكة ضعيفة) بقي التطبيق بلا شيفرة ولا مسار تعافٍ.
    const stat = await caches.open(STATIC);
    const keys = await caches.keys();
    for (const name of keys) {
      if (name === STATIC) continue;
      try {
        const c = await caches.open(name);
        for (const req of await c.keys()) {
          if (!req.url.includes('/app.js')) continue;
          const r = await c.match(req);
          if (r) await stat.put(req, r.clone());
        }
      } catch (err) {}
    }
    await Promise.all(keys.filter(k => k !== CACHE && k !== STATIC).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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

  // app.js?vNNN: الرابط يحمل رقم النسخة، فمحتواه ثابت لهذا الرابط ⇒ cache-first.
  // كان network-first بمهلة 2.5 ثانية: كل فتحة تنتظر الشبكة لملف ~1MB بلا داعٍ.
  if(url.endsWith('/app.js') || url.includes('/app.js?')) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        // نتحقّق أنّ الرد شيفرة فعلاً: أثناء النشر قد يردّ المضيف صفحة خطأ
        // بترويسة HTML وحالة 200. وبما أنّ القراءة cache-first، تخزينها
        // يُعطِّل التطبيق بشكل دائم ولا يُصلحه إلا مسح بيانات الموقع يدوياً.
        const ct = (res && res.headers && res.headers.get('content-type')) || '';
        const isJs = /javascript|ecmascript/i.test(ct);
        if (res && res.status === 200 && isJs) {
          // يُخزَّن في الكاش الدائم لا كاش النسخة، فلا يمحوه رفع النسخة التالي
          const c = await caches.open(STATIC);
          await c.put(e.request, res.clone());
          // لا نحذف النسخ الأقدم إلا بعد نجاح تخزين الجديدة
          for (const k of await c.keys())
            if (k.url.includes('/app.js') && k.url !== e.request.url) await c.delete(k);
        }
        return res;
      } catch (err) {
        // سقطت الشبكة ولا نسخة لهذا الرابط: أعِد أي app.js مخزّنة.
        // شيفرة أقدم بقليل خير من تطبيق ميت.
        for (const name of await caches.keys()) {
          const c = await caches.open(name);
          const prev = (await c.keys()).find(k => k.url.includes('/app.js'));
          if (prev) return c.match(prev);
        }
        throw err;
      }
    })());
    return;
  }

  // Firebase SDK (gstatic): cache-first في الكاش الثابت — لا يُعاد تنزيله مع رفع النسخة
  if(url.includes('gstatic.com/firebasejs/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if(res && res.status === 200)
          caches.open(STATIC).then(c => c.put(e.request, res.clone()));
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
