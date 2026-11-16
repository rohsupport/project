// ============================================================
// lib/notify.js
// Push-подписка + лента уведомлений
// ============================================================
import { supabase, getCurrentUser, safe, logAction, logError } from "./supabase.js";
import { VAPID_PUBLIC_KEY, DEBUG } from "../config.js";

// ------------------------------------------------------------
// 1. Поддержка push в браузере
// ------------------------------------------------------------
export function isPushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

// ------------------------------------------------------------
// 2. Конвертация VAPID-ключа
// ------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------
// 3. Регистрация Service Worker
// ------------------------------------------------------------
let swRegistration = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    await navigator.serviceWorker.ready;
    if (DEBUG) console.log("[notify] SW registered:", swRegistration.scope);
    return swRegistration;
  } catch (e) {
    await logError(e?.message || "SW registration failed", { label: "registerServiceWorker" });
    return null;
  }
}

// ------------------------------------------------------------
// 4. Подписка на push
// ------------------------------------------------------------
// Вызывать по жесту пользователя (кнопка в настройках).
// На iOS — только после установки PWA на «Домой».
export async function subscribePush() {
  if (!isPushSupported()) {
    return { ok: false, error: "Push не поддерживается этим браузером" };
  }

  if (Notification.permission === "denied") {
    return { ok: false, error: "Уведомления запрещены в настройках браузера" };
  }

  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, error: "Разрешение не выдано" };
    }
  }

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, error: "Service Worker не зарегистрирован" };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (e) {
      await logError(e?.message || "push subscribe failed", { label: "subscribePush" });
      return { ok: false, error: "Не удалось подписаться на push" };
    }
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Пользователь не авторизован" };

  const p256dh = btoa(
    String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")))
  );
  const auth = btoa(
    String.fromCharCode(...new Uint8Array(sub.getKey("auth")))
  );

  const res = await safe(
    () =>
      supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh,
          auth,
        },
        { onConflict: "user_id,endpoint" }
      ),
    "save push subscription"
  );

  if (res.error) {
    return { ok: false, error: "Ошибка сохранения подписки" };
  }

  await logAction("push_subscribe", { endpoint: sub.endpoint });
  return { ok: true, endpoint: sub.endpoint };
}

// ------------------------------------------------------------
// 5. Отписка от push
// ------------------------------------------------------------
export async function unsubscribePush() {
  if (!("serviceWorker" in navigator)) return { ok: false };

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };

    const endpoint = sub.endpoint;
    await sub.unsubscribe();

    const user = await getCurrentUser();
    if (user) {
      await safe(
        () =>
          supabase
            .from("push_subscriptions")
            .delete()
            .eq("user_id", user.id)
            .eq("endpoint", endpoint),
        "delete push subscription"
      );
    }
    await logAction("push_unsubscribe", { endpoint });
    return { ok: true };
  } catch (e) {
    await logError(e?.message || "unsubscribe failed", { label: "unsubscribePush" });
    return { ok: false, error: "Не удалось отписаться" };
  }
}

// ------------------------------------------------------------
// 6. Текущий статус подписки
// ------------------------------------------------------------
export async function getPushStatus() {
  if (!isPushSupported()) return { supported: false, subscribed: false };
  const reg = await registerServiceWorker();
  if (!reg) return { supported: true, subscribed: false };
  const sub = await reg.pushManager.getSubscription();
  return {
    supported: true,
    subscribed: !!sub,
    permission: pushPermission(),
    endpoint: sub?.endpoint || null,
  };
}

// ------------------------------------------------------------
// 7. Тестовое уведомление (локальное, без сервера)
// ------------------------------------------------------------
export async function showLocalNotification(title, body) {
  if (Notification.permission !== "granted") return false;
  const reg = await registerServiceWorker();
  if (!reg) return false;
  await reg.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  });
  return true;
}

// ============================================================
// ЛЕНТА УВЕДОМЛЕНИЙ В ПРИЛОЖЕНИИ
// ============================================================

// ------------------------------------------------------------
// 8. Загрузка уведомлений пользователя
// ------------------------------------------------------------
// limit — сколько последних; unreadOnly — только непрочитанные.
export async function loadNotifications({ limit = 100, unreadOnly = false } = {}) {
  const user = await getCurrentUser();
  if (!user) return [];

  let q = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) q = q.eq("read", false);

  const res = await safe(() => q, "load notifications");
  return res.data || [];
}

// ------------------------------------------------------------
// 9. Непрочитанные (для бейджа на колокольчике)
// ------------------------------------------------------------
export async function countUnreadNotifications() {
  const user = await getCurrentUser();
  if (!user) return 0;
  const res = await safe(
    () =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false),
    "count unread notifications"
  );
  return res.count || 0;
}

// ------------------------------------------------------------
// 10. Пометить уведомление прочитанным
// ------------------------------------------------------------
export async function markNotificationRead(id) {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const res = await safe(
    () =>
      supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id)
        .eq("user_id", user.id),
    "mark notification read"
  );
  return { ok: !res.error };
}

// ------------------------------------------------------------
// 11. Пометить все прочитанными
// ------------------------------------------------------------
export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const res = await safe(
    () =>
      supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false),
    "mark all notifications read"
  );
  return { ok: !res.error };
}

// ------------------------------------------------------------
// 12. Удалить уведомление
// ------------------------------------------------------------
export async function deleteNotification(id) {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const res = await safe(
    () =>
      supabase
        .from("notifications")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id),
    "delete notification"
  );
  return { ok: !res.error };
}

// ------------------------------------------------------------
// 13. Создать уведомление (для администратора / тестов)
// ------------------------------------------------------------
export async function createNotification(title, body, type = "info") {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const res = await safe(
    () =>
      supabase.from("notifications").insert({
        user_id: user.id,
        title,
        body,
        type,
      }),
    "create notification"
  );
  return { ok: !res.error };
}