/* Service Worker — кэш + офлайн + maintenance */
const VERSION = 'v1';
const SHELL_CACHE = `afisha-shell-${VERSION}`;
const DATA_CACHE = `afisha-data-${VERSION}`;
const IMG_CACHE = `afisha-img-${VERSION}`;

const SHELL = ['./', './index.html', './sw.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![SHELL_CACHE,DATA_CACHE,IMG_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  if (url.hostname.includes('supabase.co') && url.pathname.startsWith('/rest/')) {
    e.respondWith(networkFirst(req, DATA_CACHE, 4000));
    return;
  }
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(url.pathname)) {
    e.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(navStrategy(req));
    return;
  }
});

async function navStrategy(req){
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req) || await cache.match('./index.html');
    return cached || new Response(offlineHTML(), {headers:{'Content-Type':'text/html; charset=utf-8'}, status:503});
  }
}

async function networkFirst(req, cacheName, timeout){
  const cache = await caches.open(cacheName);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const fresh = await fetch(req, {signal: ctrl.signal});
    clearTimeout(t);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response(JSON.stringify({error:'offline', cached:false}), {headers:{'Content-Type':'application/json'}, status:503});
  }
}

async function cacheFirst(req, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response('', {status:503});
  }
}

function offlineHTML(){
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Нет интернета</title>
  <style>body{font-family:system-ui,sans-serif;background:#0a0b10;color:#f3f5fa;display:grid;place-items:center;min-height:100dvh;margin:0;text-align:center;padding:24px}
  h1{font-size:22px;margin:0 0 10px}p{color:#8b93a8;margin:0 0 20px}button{background:#ff4d6d;color:#fff;border:none;padding:12px 22px;border-radius:12px;font-weight:600;font-size:15px;cursor:pointer}</style>
  <div><h1>Нет интернета</h1><p>Проверьте соединение и попробуйте снова.</p><button onclick="location.reload()">Повторить</button></div></html>`;
}