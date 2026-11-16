// ============================================================
// config.js
// Центральные настройки приложения «Смены»
// ============================================================
// ВАЖНО:
// 1. Значения ниже — ЗАМЕНИ на свои из Supabase Dashboard.
// 2. SUPABASE_ANON_KEY — публичный ключ (можно держать в клиенте).
// 3. НИКОГДА не клади сюда service_role key.
// 4. VAPID_PUBLIC_KEY нужен для push-уведомлений (см. sw.js / lib/notify.js).
// ============================================================

// ---------- Supabase ----------
// Где взять: Supabase Dashboard -> Project Settings -> API
export const SUPABASE_URL = "https://nsenrqmcfrvocmtdwtkx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zZW5ycW1jZnJ2b2NtdGR3dGt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NDY0NDMsImV4cCI6MjExMDQyMjQ0M30.lvtFJGqy961UqNFYc6xi92RjSk1yqUmlyx1tJsF5aHs";

// ---------- Push-уведомления (VAPID) ----------
// Где взять: `npx web-push generate-vapid-keys`
// Публичный ключ — только он попадает в клиент.
// Приватный ключ хранится ТОЛЬКО в секретах Supabase (Edge Function).
export const VAPID_PUBLIC_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

// ---------- Общие настройки приложения ----------
// Название приложения (отображается в шапке / title)
export const APP_NAME = "Смены";

// Валюта по умолчанию (можно менять в Настройках; хранится в user_settings)
export const DEFAULT_CURRENCY = "GBP";

// Порог просрочки оплаты смены (в днях) — используется в анализе и уведомлениях
export const OVERDUE_DAYS = 14;

// Часовой пояс для расчёта «сегодня» и cron-уведомлений
export const TIMEZONE = "Europe/London";

// ---------- Флаги окружения ----------
// Режим отладки: true — пишет подробные console.log и логирует ошибки в таблицу errors
export const DEBUG = true;

// Версия приложения (отображается в Настройках -> Администратор)
export const APP_VERSION = "1.0.0";