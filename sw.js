// ============================================================
// sw.js
// Service Worker: кэширование, приём push, клики по уведомлениям
// Версия 1.2.0 — относительные пути, безопасный прекэш
// ============================================================

const SW_VERSION = "1.2.0";
const CACHE_NAME = `smeny-cache-${SW_VERSION}`;

// Файлы для предварительного кэширования.
// Все пути относительные — работают и на localhost, и на GitHub Pages.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// ------------------------------------------------------------
// 1. Установка
// ------------------------------------------------------------
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Кэшируем по одному: если файла нет — пропускаем, не валим всю установку.
      for (const url of PRECACHE_URLS) {
        try {
          const res = await fetch(url, { cache: "no-cache" });
          if (res && res.status === 200) {
            await cache.put(url, res.clone());
          }
        } catch (e) {
          console.warn("[sw] precache skip:", url, e?.message || e);
        }
      }
    })()
  );
});

// ------------------------------------------------------------
// 2. Активация — чистим старые кэши
// ------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("smeny-cache-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ------------------------------------------------------------
// 3. Fetch — обязателен для установки PWA в Chrome на Android
// ------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Внешние запросы (Supabase и др.) — не трогаем
  if (url.origin !== self.location.origin) return;

  // Навигация
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Статика
  if (/\.(?:css|js|png|jpg|jpeg|svg|webp|ico|json|woff2?)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Остальное — сеть
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) {
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    const fallback = await cache.match("./index.html");
    if (fallback) return fallback;
    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// ------------------------------------------------------------
// 4. Push
// ------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = {
    title: "Смены",
    body: "Напоминание",
    url: "./",
    icon: "./icon-192.png",
    tag: "default",
  };

  try {
    if (event.data) {
      const incoming = event.data.json();
      data = { ...data, ...incoming };
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch {}
  }

  const options = {
    body: data.body || "",
    icon: data.icon || "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: data.url || "./" },
    tag: data.tag || "default",
    renotify: !!data.tag,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title || "Смены", options));
});

// ------------------------------------------------------------
// 5. Клик по уведомлению
// ------------------------------------------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || "./";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            if ("focus" in client) await client.focus();
            if ("navigate" in client) {
              try {
                await client.navigate(targetUrl);
              } catch {}
            }
            return;
          }
        } catch {}
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// ------------------------------------------------------------
// 6. Закрытие уведомления
// ------------------------------------------------------------
self.addEventListener("notificationclose", () => {});

// ------------------------------------------------------------
// 7. Сообщения
// ------------------------------------------------------------
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "PING") {
    event.source?.postMessage({ type: "PONG", version: SW_VERSION });
  }
  if (msg.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});