// BodyLog Service Worker — 資産キャッシュ＋オフライン時のページ表示
const VERSION = 'v1';
const STATIC_CACHE = `bl-static-${VERSION}`;
const PAGE_CACHE = `bl-pages-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('bl-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // Supabase等の外部通信には触らない
  if (url.pathname.startsWith('/api/')) return;     // APIは常にネットワーク

  // ページ遷移: ネットワーク優先→失敗したらキャッシュ（オフライン起動の要）
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(PAGE_CACHE);
        cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = await caches.match('/log');
        return fallback || Response.error();
      }
    })());
    return;
  }

  // ハッシュ付き静的資産: キャッシュ優先（変更されない前提のファイル群）
  if (url.pathname.startsWith('/_next/static/') || /\.(js|css|woff2?|png|jpe?g|svg|ico|webp)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
  }
});
