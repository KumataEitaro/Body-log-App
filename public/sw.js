// BodyLog オフラインシェル（機内モード対応）。
// 設計原則（過去にSW+動的importでネイティブ機能が固まった事故の再発防止）:
//  1. ネットワーク優先: オンライン時の挙動を一切変えない（4秒待って失敗した時だけキャッシュ）
//  2. 介入は最小限: API(/api/*)・外部オリジン(Supabase等)・GET以外・RSCフェッチには触らない
//  3. キャッシュ優先はハッシュ付き静的アセット(/_next/static/*)のみ（内容不変なので安全）
const CACHE = 'bl-shell-v2';
const NAV_TIMEOUT_MS = 4000;
const PRECACHE = ['/log', '/dashboard', '/goal', '/settings'];

// リダイレクト経由のレスポンスはそのままキャッシュするとオフライン表示時にブラウザが拒否するため、
// 素のレスポンスに包み直してから保存する
async function putSafe(cache, key, res) {
  if (res.redirected) {
    const body = await res.clone().blob();
    await cache.put(key, new Response(body, { status: 200, statusText: 'OK', headers: res.headers }));
  } else {
    await cache.put(key, res.clone());
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (p) => {
      try {
        const r = await fetch(p, { cache: 'no-store' });
        if (r.ok) await putSafe(c, p, r);
      } catch { /* オフライン中のインストールでは諦める */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeoutFetch(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('nav-timeout')), ms);
    fetch(req).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase等の外部は素通し
  if (url.pathname.startsWith('/api/')) return;      // APIは素通し
  if (req.headers.get('RSC') || req.headers.get('Next-Router-State-Tree')) return; // Next内部フェッチは素通し

  // ① ハッシュ付き静的アセット: キャッシュ優先
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    })());
    return;
  }

  // ② ページ遷移: ネットワーク優先（4秒）→ キャッシュ → /logのキャッシュ → 案内ページ
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await timeoutFetch(req, NAV_TIMEOUT_MS);
        if (res.ok) { const c = await caches.open(CACHE); putSafe(c, req, res); }
        return res;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const home = await caches.match('/log');
        if (home) return home;
        return new Response(
          '<!doctype html><html lang="ja"><body style="font-family:sans-serif;padding:48px 24px;text-align:center;color:#0e1116"><h2>オフラインです</h2><p style="color:#6a7280">一度オンラインでアプリを開くと、以後はオフラインでも表示できます。</p></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
    })());
  }
  // ③ それ以外のGETは素通し（介入しない）
});
