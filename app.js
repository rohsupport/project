// ============================================================
// app.js
// Ядро: инициализация, экраны входа/ПИН, роутер, навигация, тосты
// ============================================================
import {
  supabase,
  getCurrentUser,
  signIn,
  signOut,
  clearUserCache,
  logAction,
  logError,
  getRememberMe,
} from "./lib/supabase.js";
import { todayISO } from "./lib/dates.js";
import {
  registerServiceWorker,
  countUnreadNotifications,
} from "./lib/notify.js";
import { APP_NAME, APP_VERSION, DEBUG } from "./config.js";

// ------------------------------------------------------------
// 0. Ссылки на DOM
// ------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const dom = {
  authScreen: $("#authScreen"),
  authForm: $("#authForm"),
  authError: $("#authError"),
  authSubmit: $("#authSubmit"),
  loginEmail: $("#loginEmail"),
  loginPass: $("#loginPass"),
  rememberMe: $("#rememberMe"),
  rememberRow: $("#rememberRow"),

  pinScreen: $("#pinScreen"),
  pinInput: $("#pinInput"),
  pinError: $("#pinError"),
  pinSubmit: $("#pinSubmit"),
  pinReset: $("#pinReset"),

  pinSetupScreen: $("#pinSetupScreen"),
  pinNew: $("#pinNew"),
  pinNew2: $("#pinNew2"),
  pinSetupError: $("#pinSetupError"),
  pinSave: $("#pinSave"),
  pinSkip: $("#pinSkip"),

  app: $("#app"),
  view: $("#view"),
  pageTitle: $("#pageTitle"),
  navDesktop: $("#navDesktop"),
  navMobile: $("#navMobile"),
  sidebarVersion: $("#sidebarVersion"),

  bellBtn: $("#bellBtn"),
  bellBadge: $("#bellBadge"),

  moreSheet: $("#moreSheet"),
  sheetBackdrop: $("#sheetBackdrop"),
  sheetClose: $("#sheetClose"),

  toastWrap: $("#toastWrap"),
};

// ------------------------------------------------------------
// 1. Утилиты
// ------------------------------------------------------------
export function isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function show(el) {
  el?.classList.remove("hidden");
}

function hide(el) {
  el?.classList.add("hidden");
}

// Тосты
export function toast(message, type = "info", timeout = 3200) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

// ------------------------------------------------------------
// 2. ПИН-код (PBKDF2)
// ------------------------------------------------------------
const PIN_KEY = "sm_pin_v1";
const PIN_TRIES_KEY = "sm_pin_tries";
const PIN_LOCK_KEY = "sm_pin_lock_until";
const PIN_MAX_TRIES = 5;
const PIN_LOCK_MS = 30 * 60 * 1000; // 30 минут

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hashPin(pin, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? b64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(16));
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

function readPinRecord() {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hasPin() {
  return !!readPinRecord();
}

async function savePin(pin) {
  const { hash, salt } = await hashPin(pin);
  localStorage.setItem(
    PIN_KEY,
    JSON.stringify({ hash, salt, created_at: Date.now() })
  );
  localStorage.removeItem(PIN_TRIES_KEY);
  localStorage.removeItem(PIN_LOCK_KEY);
}

function clearPin() {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(PIN_TRIES_KEY);
  localStorage.removeItem(PIN_LOCK_KEY);
}

async function verifyPin(pin) {
  const rec = readPinRecord();
  if (!rec) return false;
  const { hash } = await hashPin(pin, rec.salt);
  return hash === rec.hash;
}

function pinLockedUntil() {
  const v = Number(localStorage.getItem(PIN_LOCK_KEY) || 0);
  return v > Date.now() ? v : 0;
}

function bumpPinTries() {
  const tries = Number(localStorage.getItem(PIN_TRIES_KEY) || 0) + 1;
  localStorage.setItem(PIN_TRIES_KEY, String(tries));
  if (tries >= PIN_MAX_TRIES) {
    localStorage.setItem(PIN_LOCK_KEY, String(Date.now() + PIN_LOCK_MS));
  }
  return tries;
}

function resetPinTries() {
  localStorage.removeItem(PIN_TRIES_KEY);
  localStorage.removeItem(PIN_LOCK_KEY);
}

// ------------------------------------------------------------
// 3. Экраны
// ------------------------------------------------------------
function hideAllScreens() {
  hide(dom.authScreen);
  hide(dom.pinScreen);
  hide(dom.pinSetupScreen);
  hide(dom.app);
}

function showAuth() {
  hideAllScreens();
  show(dom.authScreen);
  dom.rememberMe.checked = getRememberMe();
  // «Запомнить меня» только на ПК
  if (isMobileViewport()) {
    dom.rememberRow?.classList.add("hidden");
  } else {
    dom.rememberRow?.classList.remove("hidden");
  }
  setTimeout(() => dom.loginEmail?.focus(), 50);
}

function showPin() {
  hideAllScreens();
  show(dom.pinScreen);
  dom.pinInput.value = "";
  dom.pinError.textContent = "";
  setTimeout(() => dom.pinInput?.focus(), 50);
}

function showPinSetup() {
  hideAllScreens();
  show(dom.pinSetupScreen);
  dom.pinNew.value = "";
  dom.pinNew2.value = "";
  dom.pinSetupError.textContent = "";
  setTimeout(() => dom.pinNew?.focus(), 50);
}

async function showApp() {
  hideAllScreens();
  show(dom.app);
  dom.sidebarVersion.textContent = `v${APP_VERSION}`;
  await registerServiceWorker();
  await refreshBell();
  const initial = currentPageFromHash() || "shifts";
  await navigate(initial, { replaceHash: true });
}

// ------------------------------------------------------------
// 4. Вход
// ------------------------------------------------------------
dom.authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  dom.authError.textContent = "";
  dom.authSubmit.disabled = true;

  const email = dom.loginEmail.value.trim();
  const pass = dom.loginPass.value;
  const remember = isMobileViewport() ? true : dom.rememberMe.checked;

  if (!email || !pass) {
    dom.authError.textContent = "Введите логин и пароль";
    dom.authSubmit.disabled = false;
    return;
  }

  try {
    const { error } = await signIn(email, pass, remember);
    if (error) {
      dom.authError.textContent =
        error.message === "Invalid login credentials"
          ? "Неверный логин или пароль"
          : error.message || "Ошибка входа";
      dom.authSubmit.disabled = false;
      return;
    }

    // Если телефон — ПИН
    if (isMobileViewport()) {
      if (hasPin()) {
        showPin();
      } else {
        showPinSetup();
      }
    } else {
      await showApp();
    }
  } catch (err) {
    await logError(err?.message || "auth exception", { label: "authForm" });
    dom.authError.textContent = "Ошибка сети. Попробуйте снова.";
  } finally {
    dom.authSubmit.disabled = false;
  }
});

// ------------------------------------------------------------
// 5. ПИН: ввод
// ------------------------------------------------------------
dom.pinSubmit?.addEventListener("click", tryPin);
dom.pinInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryPin();
});

async function tryPin() {
  dom.pinError.textContent = "";
  const pin = dom.pinInput.value.trim();

  const lockedUntil = pinLockedUntil();
  if (lockedUntil) {
    const min = Math.ceil((lockedUntil - Date.now()) / 60000);
    dom.pinError.textContent = `Заблокировано. Попробуйте через ${min} мин.`;
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    dom.pinError.textContent = "ПИН — 4 цифры";
    return;
  }

  const ok = await verifyPin(pin);
  if (ok) {
    resetPinTries();
    await showApp();
  } else {
    const tries = bumpPinTries();
    const left = PIN_MAX_TRIES - tries;
    if (left <= 0) {
      dom.pinError.textContent = "Слишком много попыток. Блокировка на 30 минут.";
    } else {
      dom.pinError.textContent = `Неверный ПИН. Осталось попыток: ${left}`;
    }
    dom.pinInput.value = "";
    dom.pinInput.focus();
  }
}

dom.pinReset?.addEventListener("click", async () => {
  clearPin();
  await signOut();
  showAuth();
});

// ------------------------------------------------------------
// 6. ПИН: установка
// ------------------------------------------------------------
dom.pinSave?.addEventListener("click", async () => {
  dom.pinSetupError.textContent = "";
  const p1 = dom.pinNew.value.trim();
  const p2 = dom.pinNew2.value.trim();

  if (!/^\d{4}$/.test(p1)) {
    dom.pinSetupError.textContent = "ПИН — 4 цифры";
    return;
  }
  if (p1 !== p2) {
    dom.pinSetupError.textContent = "ПИН не совпадает";
    return;
  }

  await savePin(p1);
  await logAction("pin_setup", {});
  await showApp();
});

dom.pinSkip?.addEventListener("click", async () => {
  await showApp();
});

// ------------------------------------------------------------
// 7. Роутер
// ------------------------------------------------------------
const ROUTES = {
  shifts: { title: "Смены", module: "./pages/shifts.js" },
  money: { title: "Деньги", module: "./pages/money.js" },
  reports: { title: "Отчёты", module: "./pages/reports.js" },
  analytics: { title: "Аналитика", module: "./pages/analytics.js" },
  refs: { title: "Справочники", module: "./pages/refs.js" },
  notifications: { title: "Уведомления", module: "./pages/notifications.js" },
  admin: { title: "Администратор", module: "./pages/admin.js" },
  settings: { title: "Настройки", module: "./pages/settings.js" },
};

let currentPage = null;
let currentCleanup = null;

function currentPageFromHash() {
  const h = location.hash.replace(/^#\/?/, "").trim();
  return ROUTES[h] ? h : null;
}

function setActiveNav(page) {
  dom.navDesktop
    ?.querySelectorAll(".nav-item")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  dom.navMobile
    ?.querySelectorAll(".mnav-item")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
}

export async function navigate(page, { replaceHash = false } = {}) {
  if (!ROUTES[page]) page = "shifts";
  if (currentPage === page) return;

  // cleanup предыдущего модуля
  if (typeof currentCleanup === "function") {
    try {
      currentCleanup();
    } catch (e) {
      if (DEBUG) console.warn("cleanup failed:", e);
    }
    currentCleanup = null;
  }

  currentPage = page;
  dom.pageTitle.textContent = ROUTES[page].title;
  setActiveNav(page);

  if (replaceHash) {
    history.replaceState(null, "", `#/${page}`);
  } else {
    history.pushState(null, "", `#/${page}`);
  }

  // заглушка загрузки
  dom.view.innerHTML = `<div class="empty">Загрузка…</div>`;

  try {
    const mod = await import(ROUTES[page].module);
    dom.view.innerHTML = "";
    const cleanup = await mod.render(dom.view, { navigate });
    if (typeof cleanup === "function") currentCleanup = cleanup;
    dom.view.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
  } catch (e) {
    await logError(e?.message || "route load failed", { page });
    dom.view.innerHTML = `<div class="empty">Не удалось загрузить раздел. Обновите страницу.</div>`;
    if (DEBUG) console.error(`route ${page} failed:`, e);
  }
}

window.addEventListener("popstate", () => {
  const p = currentPageFromHash() || "shifts";
  navigate(p, { replaceHash: true });
});

// ------------------------------------------------------------
// 8. Навигация: клики
// ------------------------------------------------------------
function bindNav(root, attr = "page") {
  root?.addEventListener("click", (e) => {
    const btn = e.target.closest(`[data-${attr}]`);
    if (!btn) return;
    const page = btn.dataset[attr];

    if (page === "more") {
      openSheet();
      return;
    }
    closeSheet();
    navigate(page);
  });
}

bindNav(dom.navDesktop);
bindNav(dom.navMobile);
bindNav(dom.moreSheet, "page");

// ------------------------------------------------------------
// 9. Шторка «Ещё»
// ------------------------------------------------------------
function openSheet() {
  dom.sheetBackdrop?.classList.remove("hidden");
  dom.moreSheet?.classList.remove("hidden");
}

function closeSheet() {
  dom.sheetBackdrop?.classList.add("hidden");
  dom.moreSheet?.classList.add("hidden");
}

dom.sheetBackdrop?.addEventListener("click", closeSheet);
dom.sheetClose?.addEventListener("click", closeSheet);

// ------------------------------------------------------------
// 10. Колокольчик
// ------------------------------------------------------------
export async function refreshBell() {
  try {
    const count = await countUnreadNotifications();
    if (!dom.bellBadge) return;
    if (count > 0) {
      dom.bellBadge.textContent = count > 99 ? "99+" : String(count);
      dom.bellBadge.classList.remove("hidden");
    } else {
      dom.bellBadge.classList.add("hidden");
    }
  } catch {
    /* ignore */
  }
}

dom.bellBtn?.addEventListener("click", () => {
  navigate("notifications");
});

// ------------------------------------------------------------
// 11. Старт
// ------------------------------------------------------------
async function boot() {
  document.title = APP_NAME;

  try {
    const user = await getCurrentUser();

    if (!user) {
      showAuth();
      return;
    }

    // Пользователь есть — на телефоне спрашиваем ПИН
    if (isMobileViewport()) {
      if (hasPin()) {
        showPin();
      } else {
        showPinSetup();
      }
    } else {
      await showApp();
    }
  } catch (err) {
    await logError(err?.message || "boot exception", { label: "boot" });
    showAuth();
  }
}

boot();