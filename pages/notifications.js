// ============================================================
// pages/notifications.js
// Раздел «Уведомления»: лента + настройка push
// ============================================================
import { getCurrentUser, logAction } from "../lib/supabase.js";
import { formatDate } from "../lib/dates.js";
import {
  loadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  getPushStatus,
  subscribePush,
  unsubscribePush,
  showLocalNotification,
} from "../lib/notify.js";
import { DEBUG } from "../config.js";
import { toast, isMobileViewport } from "../app.js";

// ------------------------------------------------------------
// Состояние
// ------------------------------------------------------------
const state = {
  items: [],
  onlyUnread: false,
  push: { supported: false, subscribed: false, permission: "default" },
  loading: false,
};

let rootEl = null;

// ------------------------------------------------------------
// Загрузка
// ------------------------------------------------------------
async function loadAll() {
  state.loading = true;
  renderBody();

  state.items = await loadNotifications({ limit: 200, unreadOnly: false });
  state.push = await getPushStatus();

  state.loading = false;
  renderBody();
}

// ------------------------------------------------------------
// Рендер
// ------------------------------------------------------------
export async function render(container) {
  rootEl = container;

  rootEl.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Уведомления</h2>
        <p class="sub">Напоминания, просрочки, долги</p>
      </div>
    </div>

    <div class="filters" id="ntFilters">
      <label class="check">
        <input type="checkbox" id="ntUnread" />
        <span class="check-box" aria-hidden="true"></span>
        <span>Только непрочитанные</span>
      </label>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" id="ntReadAll">Прочитать все</button>
    </div>

    <div id="ntPushBlock" class="section"></div>

    <div class="section">
      <div class="section-head">
        <h3>Лента</h3>
        <span class="hint" id="ntCount">—</span>
      </div>
      <div id="ntBody"></div>
    </div>
  `;

  rootEl.querySelector("#ntUnread").addEventListener("change", (e) => {
    state.onlyUnread = e.target.checked;
    renderBody();
  });

  rootEl.querySelector("#ntReadAll").addEventListener("click", async () => {
    await markAllNotificationsRead();
    toast("Все уведомления прочитаны", "ok");
    await loadAll();
  });

  await loadAll();

  return () => {
    rootEl = null;
  };
}

function renderBody() {
  if (!rootEl) return;

  // Push-блок
  const pushBlock = rootEl.querySelector("#ntPushBlock");
  if (pushBlock) {
    if (!state.push.supported) {
      pushBlock.innerHTML = `<div class="empty">Push-уведомления не поддерживаются этим браузером.</div>`;
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const needsInstall = isIOS && !window.matchMedia("(display-mode: standalone)").matches;

      pushBlock.innerHTML = `
        <div class="card">
          <div class="section-head">
            <h3>Push-уведомления</h3>
            <span class="tag ${state.push.subscribed ? "ok" : ""}">
              ${state.push.subscribed ? "включены" : "выключены"}
            </span>
          </div>
          ${
            needsInstall
              ? `<p class="muted small">На iPhone уведомления работают только после добавления на экран «Домой».</p>`
              : ""
          }
          <div class="form-actions" style="justify-content:flex-start">
            ${
              state.push.subscribed
                ? `<button class="btn btn-ghost" id="ntUnsub">Отключить</button>`
                : `<button class="btn btn-primary" id="ntSub">Включить</button>`
            }
            <button class="btn btn-secondary" id="ntTest" ${state.push.permission !== "granted" ? "disabled" : ""}>Тест</button>
          </div>
          <p class="muted small" style="margin-top:8px">
            Каждый день система проверяет: если смена не записана, есть долг или просрочка — придёт уведомление.
            Проверка срабатывает на сервере (Supabase Cron), доставка — через Service Worker.
          </p>
        </div>
      `;

      const subBtn = pushBlock.querySelector("#ntSub");
      if (subBtn) {
        subBtn.addEventListener("click", async () => {
          const r = await subscribePush();
          if (!r.ok) return toast(r.error || "Не удалось включить", "danger");
          toast("Уведомления включены", "ok");
          await loadAll();
        });
      }
      const unsubBtn = pushBlock.querySelector("#ntUnsub");
      if (unsubBtn) {
        unsubBtn.addEventListener("click", async () => {
          await unsubscribePush();
          toast("Уведомления отключены", "ok");
          await loadAll();
        });
      }
      const testBtn = pushBlock.querySelector("#ntTest");
      if (testBtn) {
        testBtn.addEventListener("click", async () => {
          const ok = await showLocalNotification("Смены", "Это тестовое уведомление");
          if (ok) toast("Отправлено", "ok");
          else toast("Разрешение не выдано", "warn");
        });
      }
    }
  }

  // Лента
  const body = rootEl.querySelector("#ntBody");
  if (!body) return;

  if (state.loading) {
    body.innerHTML = `<div class="empty">Загрузка…</div>`;
    return;
  }

  const filtered = state.onlyUnread
    ? state.items.filter((n) => !n.read)
    : state.items;

  rootEl.querySelector("#ntCount").textContent =
    `${filtered.length}${state.onlyUnread ? " непрочитанных" : ""}`;

  if (!filtered.length) {
    body.innerHTML = `<div class="empty">Нет уведомлений.</div>`;
    return;
  }

  const listHtml = filtered
    .map((n) => {
      const tag =
        n.type === "bad" ? "danger" :
        n.type === "warn" ? "warn" :
        n.type === "good" ? "ok" : "";
      return `
        <div class="list-row ${n.read ? "" : "unread"}" data-id="${n.id}">
          <div class="row-main">
            <div class="row-title">${escapeHtml(n.title)}</div>
            <div class="row-meta">${escapeHtml(n.body || "")}</div>
            <div class="row-meta">${formatDateTime(n.created_at)} ${tag ? `<span class="tag ${tag}">${escapeHtml(tag)}</span>` : ""}</div>
          </div>
          <div class="row-actions">
            ${!n.read ? `<button class="btn btn-ghost btn-sm" data-act="read" data-id="${n.id}">Прочитано</button>` : ""}
            <button class="btn btn-danger btn-sm" data-act="delete" data-id="${n.id}">Удалить</button>
          </div>
        </div>
      `;
    })
    .join("");

  body.innerHTML = `<div class="list">${listHtml}</div>`;

  body.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "read") {
        await markNotificationRead(id);
        await loadAll();
      }
      if (btn.dataset.act === "delete") {
        await deleteNotification(id);
        await loadAll();
      }
    });
  });
}

// ------------------------------------------------------------
// Хелперы
// ------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${formatDate(date)} · ${time}`;
  } catch {
    return iso;
  }
}