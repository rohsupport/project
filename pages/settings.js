// ============================================================
// pages/settings.js
// Раздел «Настройки»: валюта, начало учёта, ПИН, push, выход
// ============================================================
import {
  supabase,
  safe,
  getCurrentUser,
  signOut,
  logAction,
  formatMoney,
} from "../lib/supabase.js";
import { todayISO, formatDate } from "../lib/dates.js";
import {
  getPushStatus,
  subscribePush,
  unsubscribePush,
  showLocalNotification,
} from "../lib/notify.js";
import { APP_NAME, APP_VERSION, DEFAULT_CURRENCY } from "../config.js";
import { toast, isMobileViewport } from "../app.js";

// ------------------------------------------------------------
// Состояние
// ------------------------------------------------------------
const state = {
  currency: DEFAULT_CURRENCY,
  accountingStart: "",
  email: "",
  push: { supported: false, subscribed: false, permission: "default" },
  loading: false,
};

let rootEl = null;

// ------------------------------------------------------------
// ПИН (используем тот же формат, что app.js — читаем localStorage)
// ------------------------------------------------------------
const PIN_KEY = "sm_pin_v1";

function hasPin() {
  try {
    return !!localStorage.getItem(PIN_KEY);
  } catch {
    return false;
  }
}

function clearPin() {
  try {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem("sm_pin_tries");
    localStorage.removeItem("sm_pin_lock_until");
  } catch { /* ignore */ }
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function hashPin(pin, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64
    ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(pin)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    baseKey,
    256
  );
  return { hash: bufToB64(bits), salt: bufToB64(salt) };
}

async function savePin(pin) {
  const { hash, salt } = await hashPin(pin);
  localStorage.setItem(
    PIN_KEY,
    JSON.stringify({ hash, salt, created_at: Date.now() })
  );
}

// ------------------------------------------------------------
// Загрузка настроек
// ------------------------------------------------------------
async function loadAll() {
  const user = await getCurrentUser();
  if (!user) return;

  state.loading = true;
  renderBody();

  const [setRes, push] = await Promise.all([
    safe(
      () =>
        supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
      "load settings"
    ),
    getPushStatus(),
  ]);

  state.currency = setRes.data?.currency || DEFAULT_CURRENCY;
  state.accountingStart = setRes.data?.accounting_start || todayISO();
  state.email = user.email || "";
  state.push = push;

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
        <h2>Настройки</h2>
        <p class="sub">${APP_NAME} · v${APP_VERSION}</p>
      </div>
    </div>

    <div id="stBody"></div>
  `;

  await loadAll();

  return () => {
    rootEl = null;
  };
}

function renderBody() {
  if (!rootEl) return;
  const box = rootEl.querySelector("#stBody");
  if (!box) return;

  if (state.loading) {
    box.innerHTML = `<div class="empty">Загрузка…</div>`;
    return;
  }

  box.innerHTML = `
    <div class="section">
      <div class="section-head"><h3>Аккаунт</h3></div>
      <div class="card">
        <div class="list">
          <div class="list-row">
            <div class="row-main"><div class="row-title">Email</div></div>
            <div class="row-value">${escapeHtml(state.email)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Параметры учёта</h3></div>
      <div class="card">
        <form id="stForm" class="form-grid">
          <div class="field">
            <label for="stCurrency">Валюта (ISO-код, 3 буквы)</label>
            <input type="text" id="stCurrency" maxlength="3" value="${escapeAttr(state.currency)}" />
          </div>
          <div class="field">
            <label for="stStart">Начало учёта (месяц №1)</label>
            <input type="date" id="stStart" value="${state.accountingStart}" />
          </div>
          <div class="form-actions span-2">
            <button class="btn btn-primary" type="submit" id="stSave">Сохранить</button>
          </div>
        </form>
        <p class="muted small" style="margin-top:10px">
          Номера смен имеют вид «M.N»: M — порядковый месяц учёта от указанной даты, N — номер смены внутри месяца.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3>ПИН-код</h3></div>
      <div class="card">
        <p class="muted small" style="margin-bottom:12px">
          ПИН используется для быстрого входа на телефоне. Хранится только на этом устройстве (PBKDF2).
        </p>
        <div class="form-actions" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" id="stPinSet">
            ${hasPin() ? "Сменить ПИН" : "Установить ПИН"}
          </button>
          ${hasPin() ? `<button class="btn btn-danger" id="stPinRemove">Удалить ПИН</button>` : ""}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Push-уведомления</h3></div>
      <div class="card">
        <p class="muted small" style="margin-bottom:12px">
          Включите, чтобы получать ежедневные напоминания: отметить смену, проверить долг, увидеть просрочку.
        </p>
        <div class="form-actions" style="justify-content:flex-start;gap:10px;flex-wrap:wrap">
          ${
            state.push.subscribed
              ? `<button class="btn btn-ghost" id="stPushOff">Отключить</button>`
              : `<button class="btn btn-primary" id="stPushOn" ${!state.push.supported ? "disabled" : ""}>Включить</button>`
          }
          <button class="btn btn-secondary" id="stPushTest" ${state.push.permission !== "granted" ? "disabled" : ""}>Тест</button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Сессия</h3></div>
      <div class="card">
        <button class="btn btn-danger" id="stLogout">Выйти из аккаунта</button>
      </div>
    </div>
  `;

  const form = box.querySelector("#stForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currency = box.querySelector("#stCurrency").value.trim().toUpperCase();
    const accounting_start = box.querySelector("#stStart").value;

    if (!/^[A-Z]{3}$/.test(currency)) {
      toast("Код валюты — 3 буквы, например GBP", "warn");
      return;
    }
    if (!accounting_start) {
      toast("Укажите дату начала учёта", "warn");
      return;
    }

    const user = await getCurrentUser();
    if (!user) return;

    const btn = box.querySelector("#stSave");
    if (btn) btn.disabled = true;

    const res = await safe(
      () =>
        supabase
          .from("user_settings")
          .upsert(
            {
              user_id: user.id,
              currency,
              accounting_start,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          ),
      "save settings"
    );

    if (btn) btn.disabled = false;

    if (res.error) return toast("Не удалось сохранить", "danger");
    await logAction("settings_update", { currency, accounting_start });
    toast("Настройки сохранены", "ok");
    await loadAll();
  });

  // ПИН
  box.querySelector("#stPinSet").addEventListener("click", () => {
    openPinModal(async () => {
      await loadAll();
    });
  });

  const pinRemoveBtn = box.querySelector("#stPinRemove");
  if (pinRemoveBtn) {
    pinRemoveBtn.addEventListener("click", async () => {
      if (!confirm("Удалить ПИН на этом устройстве?")) return;
      clearPin();
      toast("ПИН удалён", "ok");
      await loadAll();
    });
  }

  // Push
  const pushOnBtn = box.querySelector("#stPushOn");
  if (pushOnBtn) {
    pushOnBtn.addEventListener("click", async () => {
      const r = await subscribePush();
      if (!r.ok) return toast(r.error || "Не удалось включить", "danger");
      toast("Push включён", "ok");
      await loadAll();
    });
  }
  const pushOffBtn = box.querySelector("#stPushOff");
  if (pushOffBtn) {
    pushOffBtn.addEventListener("click", async () => {
      await unsubscribePush();
      toast("Push отключён", "ok");
      await loadAll();
    });
  }
  const testBtn = box.querySelector("#stPushTest");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const ok = await showLocalNotification("Смены", "Тестовое уведомление");
      if (ok) toast("Отправлено", "ok");
      else toast("Разрешение не выдано", "warn");
    });
  }

  // Выход
  box.querySelector("#stLogout").addEventListener("click", async () => {
    if (!confirm("Выйти из аккаунта?")) return;
    await signOut();
    location.reload();
  });
}

// ------------------------------------------------------------
// Модалка: установка/смена ПИН
// ------------------------------------------------------------
function openPinModal(onDone) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">${hasPin() ? "Сменить ПИН" : "Установить ПИН"}</div>
        <button class="modal-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <div class="form-grid">
        <div class="field span-2">
          <label>Новый ПИН (4 цифры)</label>
          <input type="password" inputmode="numeric" maxlength="4" id="npPin" class="pin-input" />
        </div>
        <div class="field span-2">
          <label>Повтор</label>
          <input type="password" inputmode="numeric" maxlength="4" id="npPin2" class="pin-input" />
        </div>
      </div>
      <p class="form-error" id="npErr"></p>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" id="npSave">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#npSave").addEventListener("click", async () => {
    const p1 = modal.querySelector("#npPin").value.trim();
    const p2 = modal.querySelector("#npPin2").value.trim();
    const err = modal.querySelector("#npErr");
    err.textContent = "";

    if (!/^\d{4}$/.test(p1)) {
      err.textContent = "ПИН — 4 цифры";
      return;
    }
    if (p1 !== p2) {
      err.textContent = "ПИН не совпадает";
      return;
    }
    await savePin(p1);
    await logAction("pin_set", {});
    toast("ПИН сохранён", "ok");
    close();
    onDone?.();
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

function escapeAttr(str) {
  return escapeHtml(str);
}