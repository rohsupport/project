
// ============================================================
// sw.js
// Service Worker: приём push-уведомлений и клики по ним
// ============================================================

const SW_VERSION = "1.0.0";

// ------------------------------------------------------------
// Установка и активация
// ------------------------------------------------------------
self.addEventListener("install", (event) => {
  // Активируемся сразу, не ждём закрытия старых вкладок
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ------------------------------------------------------------
// Приём push-уведомлений
// ------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = { title: "Смены", body: "Напоминание", url: "/", icon: "/icon-192.png" };

  try {
    if (event.data) {
      const incoming = event.data.json();
      data = { ...data, ...incoming };
    }
  } catch (e) {
    // если пришёл не JSON — используем текст
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch { /* ignore */ }
  }

  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: data.tag || "default",
    renotify: !!data.tag,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title || "Смены", options));
});

// ------------------------------------------------------------
// Клик по уведомлению
// ------------------------------------------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Если есть открытое окно приложения — фокусируем его
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            if ("focus" in client) await client.focus();
            if ("navigate" in client) {
              try { await client.navigate(targetUrl); } catch { /* ignore */ }
            }
            return;
          }
        } catch { /* ignore */ }
      }

      // Иначе открываем новое окно
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// ------------------------------------------------------------
// Закрытие уведомления
// ------------------------------------------------------------
self.addEventListener("notificationclose", (event) => {
  // можно логировать, сейчас не нужно
});

// ------------------------------------------------------------
// Сообщения из приложения (например, ручной запрос версии SW)
// ------------------------------------------------------------
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "PING") {
    event.source?.postMessage({ type: "PONG", version: SW_VERSION });
  }
});