// ============================================================
// lib/money.js
// Расчёты: часы, суммы, FIFO, агрегаты, аналитика
// ============================================================
import { OVERDUE_DAYS, DEBUG } from "../config.js";
import { daysAgo, inRange } from "./dates.js";

// ------------------------------------------------------------
// 1. Расчёт часов из времени
// ------------------------------------------------------------
// Переход через полночь: если конец <= начало -> +24ч.
// Перерыв вычитается (в минутах).
export function calcHours(startTime, endTime, breakMinutes = 0) {
  if (!startTime || !endTime) return 0;

  const toMin = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  let start = toMin(startTime);
  let end = toMin(endTime);
  if (end <= start) end += 24 * 60;

  const total = end - start - (Number(breakMinutes) || 0);
  return total > 0 ? round2(total / 60) : 0;
}

// ------------------------------------------------------------
// 2. Сумма смены
// ------------------------------------------------------------
export function calcAmount(hours, rate) {
  return round2((Number(hours) || 0) * (Number(rate) || 0));
}

// ------------------------------------------------------------
// 3. Округление до 2 знаков
// ------------------------------------------------------------
export function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

// ------------------------------------------------------------
// 4. Агрегаты по массиву смен
// ------------------------------------------------------------
// Возвращает { hours, amount, count }.
export function sumShifts(shifts) {
  const list = Array.isArray(shifts) ? shifts : [];
  let hours = 0;
  let amount = 0;
  for (const s of list) {
    hours += Number(s.hours) || 0;
    amount += Number(s.amount) || 0;
  }
  return { hours: round2(hours), amount: round2(amount), count: list.length };
}

// ------------------------------------------------------------
// 5. Баланс: начислено / пришло / должно прийти
// ------------------------------------------------------------
// shifts и incomes — массивы записей (уже отфильтрованные при необходимости).
export function balance(shifts, incomes) {
  const accrued = sumShifts(shifts).amount;
  const paid = round2(
    (Array.isArray(incomes) ? incomes : []).reduce(
      (acc, i) => acc + (Number(i.amount) || 0),
      0
    )
  );
  const due = round2(accrued - paid);
  return { accrued, paid, due };
}

// ------------------------------------------------------------
// 6. FIFO: распределение приходов по сменам
// ------------------------------------------------------------
// Приходы сортируются по дате, смены — по дате (и номеру).
// Каждый приход закрывает самые старые неоплаченные смены.
// Возвращает массив смен с полями:
//   paid_amount  — сколько закрыто (0..amount)
//   remaining    — остаток к оплате
//   status       — "paid" | "partial" | "unpaid"
//   paid_date    — дата прихода, который закрыл смену (или null)
// Также возвращает leftover — нераспределённый остаток приходов (аванс).
export function fifo(shifts, incomes) {
  const shiftList = (Array.isArray(shifts) ? shifts : [])
    .slice()
    .sort((a, b) => {
      if (a.date === b.date) return (a.shift_no || 0) - (b.shift_no || 0);
      return a.date < b.date ? -1 : 1;
    })
    .map((s) => ({
      ...s,
      paid_amount: 0,
      remaining: round2(Number(s.amount) || 0),
      status: "unpaid",
      paid_date: null,
    }));

  const incomeList = (Array.isArray(incomes) ? incomes : [])
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let si = 0;
  let leftover = 0;

  for (const inc of incomeList) {
    let pool = round2(Number(inc.amount) || 0);
    while (pool > 0 && si < shiftList.length) {
      const sh = shiftList[si];
      const need = sh.remaining;
      if (need <= 0) {
        si++;
        continue;
      }
      const apply = Math.min(pool, need);
      sh.paid_amount = round2(sh.paid_amount + apply);
      sh.remaining = round2(sh.remaining - apply);
      pool = round2(pool - apply);
      if (!sh.paid_date) sh.paid_date = inc.date;
      if (sh.remaining <= 0) {
        sh.status = "paid";
        si++;
      } else {
        sh.status = "partial";
      }
    }
    if (pool > 0) leftover = round2(leftover + pool);
  }

  // добить статусы (unpaid остаётся)
  for (const sh of shiftList) {
    if (sh.remaining <= 0) sh.status = "paid";
    else if (sh.paid_amount > 0) sh.status = "partial";
    else sh.status = "unpaid";
  }

  return { shifts: shiftList, leftover };
}

// ------------------------------------------------------------
// 7. Просрочка: смены, не оплаченные дольше OVERDUE_DAYS
// ------------------------------------------------------------
// Принимает результат fifo().shifts.
export function overdueShifts(fifoShifts, todayIso) {
  const out = [];
  for (const s of Array.isArray(fifoShifts) ? fifoShifts : []) {
    if (s.status === "paid") continue;
    const age = daysAgo(s.date);
    if (age > OVERDUE_DAYS) {
      out.push({ ...s, age });
    }
  }
  return out;
}

// ------------------------------------------------------------
// 8. Группировки для отчётов и графиков
// ------------------------------------------------------------

// По должностям: [{ position_id, name, hours, amount, count }]
export function groupByPosition(shifts, positions) {
  const posMap = new Map((positions || []).map((p) => [p.id, p]));
  const acc = new Map();
  for (const s of shifts || []) {
    const key = s.position_id || "__none__";
    if (!acc.has(key)) {
      const pos = posMap.get(key);
      acc.set(key, {
        position_id: s.position_id || null,
        name: pos?.name || "Без должности",
        hours: 0,
        amount: 0,
        count: 0,
      });
    }
    const row = acc.get(key);
    row.hours = round2(row.hours + (Number(s.hours) || 0));
    row.amount = round2(row.amount + (Number(s.amount) || 0));
    row.count += 1;
  }
  return Array.from(acc.values()).sort((a, b) => b.amount - a.amount);
}

// По адресам: [{ address_id, label, hours, amount, count }]
export function groupByAddress(shifts, addresses) {
  const addrMap = new Map((addresses || []).map((a) => [a.id, a]));
  const acc = new Map();
  for (const s of shifts || []) {
    const key = s.address_id || "__none__";
    if (!acc.has(key)) {
      const a = addrMap.get(key);
      acc.set(key, {
        address_id: s.address_id || null,
        label: a?.label || "Без адреса",
        hours: 0,
        amount: 0,
        count: 0,
      });
    }
    const row = acc.get(key);
    row.hours = round2(row.hours + (Number(s.hours) || 0));
    row.amount = round2(row.amount + (Number(s.amount) || 0));
    row.count += 1;
  }
  return Array.from(acc.values()).sort((a, b) => b.amount - a.amount);
}

// По дням: [{ date, hours, amount, count }] — только дни со сменами
export function groupByDay(shifts) {
  const acc = new Map();
  for (const s of shifts || []) {
    if (!acc.has(s.date)) {
      acc.set(s.date, { date: s.date, hours: 0, amount: 0, count: 0 });
    }
    const row = acc.get(s.date);
    row.hours = round2(row.hours + (Number(s.hours) || 0));
    row.amount = round2(row.amount + (Number(s.amount) || 0));
    row.count += 1;
  }
  return Array.from(acc.values()).sort((a, b) =>
    a.date < b.date ? -1 : 1
  );
}

// ------------------------------------------------------------
// 9. Ряды для графиков (нулевые периоды не теряются)
// ------------------------------------------------------------
// Принимает periods = [{ from, to, label }] из lib/dates.lastPeriods().
// Возвращает [{ label, hours, amount, paid }].
// paid — приходы за этот период.
export function seriesByPeriods(shifts, incomes, periods) {
  return (periods || []).map((p) => {
    const sh = (shifts || []).filter((s) => inRange(s.date, p.from, p.to));
    const inc = (incomes || []).filter((i) => inRange(i.date, p.from, p.to));
    const shSum = sumShifts(sh);
    const paid = round2(inc.reduce((a, i) => a + (Number(i.amount) || 0), 0));
    return {
      label: p.label,
      from: p.from,
      to: p.to,
      hours: shSum.hours,
      amount: shSum.amount,
      paid,
    };
  });
}

// ------------------------------------------------------------
// 10. Динамика долга на конец периода
// ------------------------------------------------------------
// Для каждого периода считаем: начислено до конца периода минус приходы до конца периода.
// Возвращает [{ label, due }].
export function dueDynamics(shifts, incomes, periods) {
  return (periods || []).map((p) => {
    const acc = (shifts || [])
      .filter((s) => s.date <= p.to)
      .reduce((a, s) => a + (Number(s.amount) || 0), 0);
    const paid = (incomes || [])
      .filter((i) => i.date <= p.to)
      .reduce((a, i) => a + (Number(i.amount) || 0), 0);
    return { label: p.label, due: round2(acc - paid) };
  });
}

// ------------------------------------------------------------
// 11. Проверки аномалий (для администратора)
// ------------------------------------------------------------
// Возвращает массив { type, level, message, count }.
// level: "info" | "warn" | "bad" | "good"
export function detectIssues({ shifts, incomes, positions, addresses }) {
  const issues = [];
  const sh = shifts || [];
  const inc = incomes || [];

  // 11.1 Смены без должности
  const noPos = sh.filter((s) => !s.position_id).length;
  if (noPos > 0) {
    issues.push({
      type: "shift_no_position",
      level: "warn",
      message: `Смен без должности: ${noPos}`,
      count: noPos,
    });
  }

  // 11.2 Смены без адреса
  const noAddr = sh.filter((s) => !s.address_id).length;
  if (noAddr > 0) {
    issues.push({
      type: "shift_no_address",
      level: "info",
      message: `Смен без адреса: ${noAddr}`,
      count: noAddr,
    });
  }

  // 11.3 FIFO-анализ
  const f = fifo(sh, inc);
  const overdue = overdueShifts(f.shifts);
  if (overdue.length > 0) {
    const sum = round2(overdue.reduce((a, s) => a + s.remaining, 0));
    issues.push({
      type: "overdue",
      level: "bad",
      message: `Просрочено смен: ${overdue.length} на £${sum.toFixed(2)}`,
      count: overdue.length,
    });
  }

  // 11.4 Долг (в целом)
  const bal = balance(sh, inc);
  if (bal.due > 0) {
    issues.push({
      type: "due",
      level: "warn",
      message: `Должно прийти: £${bal.due.toFixed(2)}`,
      count: 1,
    });
  } else if (bal.due < 0) {
    issues.push({
      type: "overpaid",
      level: "info",
      message: `Переплата / аванс: £${Math.abs(bal.due).toFixed(2)}`,
      count: 1,
    });
  } else if (sh.length > 0) {
    issues.push({
      type: "all_paid",
      level: "good",
      message: "Все смены оплачены",
      count: 0,
    });
  }

  // 11.5 Аномальные часы (> 16ч за смену)
  const huge = sh.filter((s) => (Number(s.hours) || 0) > 16);
  if (huge.length > 0) {
    issues.push({
      type: "huge_hours",
      level: "warn",
      message: `Смен с часами > 16: ${huge.length}`,
      count: huge.length,
    });
  }

  // 11.6 Приход без смен
  if (inc.length > 0 && sh.length === 0) {
    issues.push({
      type: "income_no_shifts",
      level: "info",
      message: "Есть приходы, но нет смен",
      count: 1,
    });
  }

  // 11.7 Справочники пусты
  if ((positions || []).filter((p) => !p.archived).length === 0) {
    issues.push({
      type: "no_positions",
      level: "info",
      message: "Добавьте хотя бы одну должность",
      count: 0,
    });
  }

  // 11.8 Аванс (нераспределённые приходы)
  if (f.leftover > 0) {
    issues.push({
      type: "leftover",
      level: "info",
      message: `Аванс (нераспределённые приходы): £${f.leftover.toFixed(2)}`,
      count: 1,
    });
  }

  if (DEBUG && issues.length === 0) {
    console.log("[money] detectIssues: no issues");
  }

  return issues;
}

// ------------------------------------------------------------
// 12. Экспорт CSV
// ------------------------------------------------------------
// rows — массив объектов, columns — [{ key, label }].
export function toCSV(rows, columns) {
  const cols = columns || [];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = cols.map((c) => esc(c.label)).join(";");
  const body = (rows || []).map((r) =>
    cols.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(";")
  );
  return [header, ...body].join("\n");
}

// ------------------------------------------------------------
// 13. Скачать CSV-файл
// ------------------------------------------------------------
export function downloadCSV(filename, csvText) {
  // BOM для Excel (кириллица)
  const blob = new Blob(["\uFEFF" + csvText], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}