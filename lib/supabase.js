// ============================================================
// lib/supabase.js
// Единый Supabase-клиент + хранение сессии + логирование
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  DEBUG,
} from "../config.js";

// ------------------------------------------------------------
// 1. Адаптер хранения сессии
// ------------------------------------------------------------
// По умолчанию Supabase хранит сессию в localStorage.
// Нам нужно переключаться между localStorage («запомнить меня»)
// и sessionStorage (сессия живёт до закрытия вкладки).
//
// Решение: свой storage-адаптер, который смотрит на флаг
// remember_me в localStorage. Если флаг true — пишем в localStorage,
// иначе — в sessionStorage.
// ------------------------------------------------------------

const REMEMBER_FLAG = "sm_remember_me";

function isRemembered() {
  try {
    return localStorage.getItem(REMEMBER_FLAG) === "1";
  } catch {
    return true;
  }
}

export function setRememberMe(remember) {
  try {
    localStorage.setItem(REMEMBER_FLAG, remember ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function getRememberMe() {
  return isRemembered();
}

// Адаптер, совместимый с интерфейсом Storage
const hybridStorage = {
  getItem(key) {
    try {
      const fromSession = sessionStorage.getItem(key);
      if (fromSession !== null) return fromSession;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      if (isRemembered()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// ------------------------------------------------------------
// 2. Клиент Supabase
// ------------------------------------------------------------
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: hybridStorage,
    storageKey: "sm_auth",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      "x-application-name": "smeny-app",
    },
  },
});

// ------------------------------------------------------------
// 3. Текущий пользователь (кэш)
// ------------------------------------------------------------
let cachedUser = null;

export async function getCurrentUser() {
  if (cachedUser) return cachedUser;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (DEBUG) console.warn("[supabase] getUser error:", error.message);
    return null;
  }
  cachedUser = data?.user ?? null;
  return cachedUser;
}

export function clearUserCache() {
  cachedUser = null;
}

// Подписка на изменение сессии — сбрасываем кэш пользователя
supabase.auth.onAuthStateChange((_event, session) => {
  cachedUser = session?.user ?? null;
});

// ------------------------------------------------------------
// 4. Логирование действий в таблицу logs
// ------------------------------------------------------------
export async function logAction(action, details = {}) {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    await supabase.from("logs").insert({
      user_id: user.id,
      action,
      details,
    });
  } catch (e) {
    if (DEBUG) console.warn("[supabase] logAction failed:", e?.message);
  }
}

// ------------------------------------------------------------
// 5. Логирование ошибок в таблицу errors
// ------------------------------------------------------------
export async function logError(message, context = {}) {
  try {
    const user = await getCurrentUser();
    await supabase.from("errors").insert({
      user_id: user?.id ?? null,
      message: String(message).slice(0, 2000),
      context,
    });
  } catch (e) {
    if (DEBUG) console.warn("[supabase] logError failed:", e?.message);
  }
}

// ------------------------------------------------------------
// 6. Обёртка для безопасного вызова Supabase
// ------------------------------------------------------------
// Использование:
//   const data = await safe(() => supabase.from("shifts").select("*"), "load shifts");
// При ошибке — пишет в errors и возвращает { data: null, error }.
// ------------------------------------------------------------
export async function safe(fn, label = "supabase call") {
  try {
    const result = await fn();
    if (result?.error) {
      await logError(result.error.message || "unknown", {
        label,
        code: result.error.code,
        details: result.error.details,
        hint: result.error.hint,
      });
      if (DEBUG) console.warn(`[supabase] ${label} error:`, result.error);
    }
    return result;
  } catch (e) {
    await logError(e?.message || "exception", { label });
    if (DEBUG) console.error(`[supabase] ${label} exception:`, e);
    return { data: null, error: e };
  }
}

// ------------------------------------------------------------
// 7. Вход / выход
// ------------------------------------------------------------
export async function signIn(email, password, remember) {
  setRememberMe(!!remember);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (!error) {
    cachedUser = data?.user ?? null;
    await logAction("login", { email });
  }
  return { data, error };
}

export async function signOut() {
  await logAction("logout", {});
  clearUserCache();
  const { error } = await supabase.auth.signOut();
  // Чистим и локальное, и сессионное хранилище токенов
  try {
    localStorage.removeItem("sm_auth");
    sessionStorage.removeItem("sm_auth");
  } catch {
    /* ignore */
  }
  return { error };
}

// ------------------------------------------------------------
// 8. Утилита: форматирование суммы по валюте
// ------------------------------------------------------------
export function formatMoney(value, currency = "GBP") {
  const num = Number(value || 0);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}