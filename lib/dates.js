// ============================================================
// lib/dates.js
// Работа с датами и периодами
// ============================================================
import { TIMEZONE } from "../config.js";

// ------------------------------------------------------------
// 1. «Сегодня» в нужном часовом поясе (строка YYYY-MM-DD)
// ------------------------------------------------------------
export function todayISO(tz = TIMEZONE) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // en-CA даёт YYYY-MM-DD
}

// ------------------------------------------------------------
// 2. Преобразование в Date без сдвига часового пояса
// ------------------------------------------------------------
export function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// ------------------------------------------------------------
// 3. Форматирование даты для UI
// ------------------------------------------------------------
export function formatDate(iso, opts = {}) {
  const d = parseISODate(iso);
  if (!d) return "—";
  const { withYear = true, short = false } = opts;
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: short ? "short" : "2-digit",
    year: withYear ? "numeric" : undefined,
  });
  return fmt.format(d);
}

// ------------------------------------------------------------
// 4. Форматирование времени (time -> HH:MM)
// ------------------------------------------------------------
export function formatTime(t) {
  if (!t) return "—";
  // Supabase возвращает "HH:MM:SS"
  return String(t).slice(0, 5);
}

// ------------------------------------------------------------
// 5. Название месяца (1-12) по-русски
// ------------------------------------------------------------
const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export function monthName(monthIndex1to12) {
  return MONTHS_RU[(monthIndex1to12 - 1 + 12) % 12] || "";
}

// ------------------------------------------------------------
// 6. Границы периодов
// ------------------------------------------------------------
// Возвращает { from, to } в ISO (YYYY-MM-DD), включительно.
// type: "day" | "week" | "month" | "custom"
// ------------------------------------------------------------
export function periodRange(type, customFrom, customTo, tz = TIMEZONE) {
  const today = parseISODate(todayISO(tz));

  if (type === "day") {
    const iso = todayISO(tz);
    return { from: iso, to: iso };
  }

  if (type === "week") {
    // Неделя: понедельник–воскресенье
    const day = today.getDay(); // 0=вс, 1=пн, ...
    const diffToMon = (day + 6) % 7; // сколько дней назад до пн
    const mon = new Date(today);
    mon.setDate(today.getDate() - diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: toISO(mon), to: toISO(sun) };
  }

  if (type === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: toISO(first), to: toISO(last) };
  }

  // custom
  const f = customFrom || "";
  const t = customTo || "";
  if (f && t && f > t) return { from: t, to: f };
  return { from: f, to: t };
}

// ------------------------------------------------------------
// 7. Ближайшие границы для отчётов (прошлые N периодов)
// ------------------------------------------------------------
// Для графиков «по дням/неделям/месяцам» нужны списки интервалов.
// Возвращает массив { from, to, label }.
// ------------------------------------------------------------
export function lastPeriods(unit, count, tz = TIMEZONE) {
  const today = parseISODate(todayISO(tz));
  const out = [];

  if (unit === "day") {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = toISO(d);
      out.push({ from: iso, to: iso, label: formatShortDay(d) });
    }
    return out;
  }

  if (unit === "week") {
    for (let i = count - 1; i >= 0; i--) {
      const ref = new Date(today);
      ref.setDate(today.getDate() - i * 7);
      const day = ref.getDay();
      const diffToMon = (day + 6) % 7;
      const mon = new Date(ref);
      mon.setDate(ref.getDate() - diffToMon);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      out.push({
        from: toISO(mon),
        to: toISO(sun),
        label: `${formatShortDay(mon)}–${formatShortDay(sun)}`,
      });
    }
    return out;
  }

  if (unit === "month") {
    for (let i = count - 1; i >= 0; i--) {
      const first = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const last = new Date(
        today.getFullYear(),
        today.getMonth() - i + 1,
        0
      );
      out.push({
        from: toISO(first),
        to: toISO(last),
        label: `${monthName(first.getMonth() + 1)} ${first.getFullYear()}`,
      });
    }
    return out;
  }

  return out;
}

// ------------------------------------------------------------
// 8. Внутренние хелперы
// ------------------------------------------------------------
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatShortDay(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

// ------------------------------------------------------------
// 9. Проверка попадания даты в диапазон
// ------------------------------------------------------------
export function inRange(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

// ------------------------------------------------------------
// 10. Номер смены M.N -> { month, shift } и обратно
// ------------------------------------------------------------
export function parseShiftNumber(monthNo, shiftNo) {
  return `${monthNo}.${shiftNo}`;
}

export function splitShiftNumber(str) {
  if (!str) return { month: null, shift: null };
  const [m, n] = String(str).split(".");
  return { month: Number(m) || null, shift: Number(n) || null };
}

// ------------------------------------------------------------
// 11. «Сколько дней назад» — для подсветки просрочки
// ------------------------------------------------------------
export function daysAgo(iso, tz = TIMEZONE) {
  const a = parseISODate(iso);
  const b = parseISODate(todayISO(tz));
  if (!a || !b) return 0;
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((b - a) / MS);
}

// ------------------------------------------------------------
// 12. Подпись периода для заголовков отчётов
// ------------------------------------------------------------
export function periodLabel(type, from, to) {
  if (type === "day") return formatDate(from);
  if (type === "week") return `неделя ${formatDate(from)} — ${formatDate(to)}`;
  if (type === "month") {
    const d = parseISODate(from);
    if (!d) return "месяц";
    return `${monthName(d.getMonth() + 1)} ${d.getFullYear()}`;
  }
  if (from && to) return `${formatDate(from)} — ${formatDate(to)}`;
  return "всё время";
}