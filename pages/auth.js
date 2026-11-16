// ============================================================
// pages/auth.js
// Утилиты ПИН-кода (PBKDF2). Используются в app.js и settings.js
// ============================================================

const PIN_KEY = "sm_pin_v1";
const PIN_TRIES_KEY = "sm_pin_tries";
const PIN_LOCK_KEY = "sm_pin_lock_until";
const PIN_MAX_TRIES = 5;
const PIN_LOCK_MS = 30 * 60 * 1000; // 30 минут

// ------------------------------------------------------------
// 1. Кодирование буферов
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// 2. Хэширование
// ------------------------------------------------------------
export async function hashPin(pin, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64
    ? b64ToBuf(saltB64)
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

// ------------------------------------------------------------
// 3. Чтение/запись/удаление
// ------------------------------------------------------------
export function readPinRecord() {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasPin() {
  return !!readPinRecord();
}

export async function savePin(pin) {
  const { hash, salt } = await hashPin(pin);
  localStorage.setItem(
    PIN_KEY,
    JSON.stringify({ hash, salt, created_at: Date.now() })
  );
  resetPinTries();
}

export function clearPin() {
  try {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(PIN_TRIES_KEY);
    localStorage.removeItem(PIN_LOCK_KEY);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------
// 4. Проверка
// ------------------------------------------------------------
export async function verifyPin(pin) {
  const rec = readPinRecord();
  if (!rec) return false;
  const { hash } = await hashPin(pin, rec.salt);
  return hash === rec.hash;
}

// ------------------------------------------------------------
// 5. Блокировка после неудачных попыток
// ------------------------------------------------------------
export function pinLockedUntil() {
  try {
    const v = Number(localStorage.getItem(PIN_LOCK_KEY) || 0);
    return v > Date.now() ? v : 0;
  } catch {
    return 0;
  }
}

export function bumpPinTries() {
  try {
    const tries = Number(localStorage.getItem(PIN_TRIES_KEY) || 0) + 1;
    localStorage.setItem(PIN_TRIES_KEY, String(tries));
    if (tries >= PIN_MAX_TRIES) {
      localStorage.setItem(PIN_LOCK_KEY, String(Date.now() + PIN_LOCK_MS));
    }
    return tries;
  } catch {
    return 0;
  }
}

export function resetPinTries() {
  try {
    localStorage.removeItem(PIN_TRIES_KEY);
    localStorage.removeItem(PIN_LOCK_KEY);
  } catch { /* ignore */ }
}

export const PIN_LIMITS = {
  MAX_TRIES: PIN_MAX_TRIES,
  LOCK_MS: PIN_LOCK_MS,
};