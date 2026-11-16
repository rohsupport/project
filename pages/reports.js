// ============================================================
// pages/reports.js
// Раздел «Отчёты»: сводка, по должностям, по адресам, по дням,
// смены, приходы; фильтр периода; экспорт CSV
// ============================================================
import {
  supabase,
  safe,
  getCurrentUser,
  formatMoney,
} from "../lib/supabase.js";
import {
  todayISO,
  formatDate,
  formatTime,
  periodRange,
  inRange,
  periodLabel,
  daysAgo,
} from "../lib/dates.js";
import {
  balance,
  fifo,
  sumShifts,
  groupByPosition,
  groupByAddress,
  groupByDay,
  toCSV,
  downloadCSV,
  round2,
} from "../lib/money.js";
import { OVERDUE_DAYS, DEFAULT_CURRENCY, DEBUG } from "../config.js";
import { toast } from "../app.js";

// ------------------------------------------------------------
// Состояние
// ------------------------------------------------------------
const state = {
  currency: DEFAULT_CURRENCY,
  positions: [],
  addresses: [],
  shifts: [],
  incomes: [],
  filter: {
    type: "month", // day | week | month | custom | all
    from: "",
    to: "",
  },
  loading: false,
};

let rootEl = null;
let unsubShifts = null;
let unsubIncomes = null;

// ------------------------------------------------------------
// Загрузка
// ------------------------------------------------------------
async function loadAll() {
  const user = await getCurrentUser();
  if (!user) return;

  state.loading = true;
  renderBody();

  const [posRes, addrRes, setRes, shRes, incRes] = await Promise.all([
    safe(
      () =>
        supabase
          .from("positions")
          .select("*")
          .eq("user_id", user.id)
          .order("name"),
      "load positions"
    ),
    safe(
      () =>
        supabase
          .from("addresses")
          .select("*")
          .eq("user_id", user.id)
          .order("label"),
      "load addresses"
    ),
    safe(
      () =>
        supabase
          .from("user_settings")
          .select("currency")
          .eq("user_id", user.id)
          .maybeSingle(),
      "load settings"
    ),
    safe(
      () =>
        supabase
          .from("shifts")
          .select("*")
          .eq("user_id", user.id)
          .order("date", { ascending: true }),
      "load shifts"
    ),
    safe(
      () =>
        supabase
          .from("incomes")
          .select("*")
          .eq("user_id", user.id)
          .order("date", { ascending: true }),
      "load incomes"
    ),
  ]);

  state.positions = posRes.data || [];
  state.addresses = addrRes.data || [];
  state.currency = setRes.data?.currency || DEFAULT_CURRENCY;
  state.shifts = shRes.data || [];
  state.incomes = incRes.data || [];
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
        <h2>Отчёты</h2>
        <p class="sub">Сводки, разбивки и полные списки за период</p>
      </div>
    </div>

    <div class="filters" id="rpFilters">
      <div class="field-inline">
        <label>Период</label>
        <select id="rpType">
          <option value="day">День</option>
          <option value="week">Неделя</option>
          <option value="month" selected>Месяц</option>
          <option value="custom">Произвольный</option>
          <option value="all">Всё время</option>
        </select>
      </div>
      <div class="field-inline" id="rpCustom" style="display:none">
        <input type="date" id="rpFrom" />
        <span>—</span>
        <input type="date" id="rpTo" />
      </div>
      <div class="spacer"></div>
      <button class="btn btn-secondary btn-sm" id="rpExportAll">CSV (всё)</button>
    </div>

    <div id="rpBody"></div>
  `;

  bindFilters();
  rootEl.querySelector("#rpExportAll").addEventListener("click", exportAll);
  await loadAll();

  try {
    const user = await getCurrentUser();
    if (user) {
      unsubShifts = supabase
        .channel("reports-shifts-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shifts", filter: `user_id=eq.${user.id}` },
          () => loadAll()
        )
        .subscribe();
      unsubIncomes = supabase
        .channel("reports-incomes-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incomes", filter: `user_id=eq.${user.id}` },
          () => loadAll()
        )
        .subscribe();
    }
  } catch (e) {
    if (DEBUG) console.warn("realtime reports failed:", e);
  }

  return () => {
    try {
      if (unsubShifts) supabase.removeChannel(unsubShifts);
      if (unsubIncomes) supabase.removeChannel(unsubIncomes);
    } catch { /* ignore */ }
    unsubShifts = null;
    unsubIncomes = null;
  };
}

// ------------------------------------------------------------
// Фильтры
// ------------------------------------------------------------
function bindFilters() {
  const type = rootEl.querySelector("#rpType");
  const custom = rootEl.querySelector("#rpCustom");
  const from = rootEl.querySelector("#rpFrom");
  const to = rootEl.querySelector("#rpTo");

  type.value = state.filter.type;
  from.value = state.filter.from;
  to.value = state.filter.to;
  custom.style.display = state.filter.type === "custom" ? "flex" : "none";

  type.addEventListener("change", () => {
    state.filter.type = type.value;
    custom.style.display = type.value === "custom" ? "flex" : "none";
    if (type.value !== "custom") renderBody();
  });
  from.addEventListener("change", () => {
    state.filter.from = from.value;
    renderBody();
  });
  to.addEventListener("change", () => {
    state.filter.to = to.value;
    renderBody();
  });
}

function currentRange() {
  const f = state.filter;
  if (f.type === "all") return { from: "", to: "" };
  if (f.type === "custom") {
    let from = f.from, to = f.to;
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  return periodRange(f.type);
}

// ------------------------------------------------------------
// Основной рендер
// ------------------------------------------------------------
function renderBody() {
  if (!rootEl) return;
  const box = rootEl.querySelector("#rpBody");
  if (!box) return;

  if (state.loading) {
    box.innerHTML = `<div class="empty">Загрузка…</div>`;
    return;
  }

  const { from, to } = currentRange();
  const shifts = (from || to)
    ? state.shifts.filter((s) => inRange(s.date, from, to))
    : state.shifts.slice();
  const incomes = (from || to)
    ? state.incomes.filter((i) => inRange(i.date, from, to))
    : state.incomes.slice();

  const headerLabel = periodLabel(state.filter.type, from, to);

  const summary = buildSummary(shifts, incomes);
  const byPosition = groupByPosition(shifts, state.positions);
  const byAddress = groupByAddress(shifts, state.addresses);
  const byDay = groupByDay(shifts);

  const fifoRes = fifo(state.shifts, state.incomes);
  const fifoMap = new Map(fifoRes.shifts.map((s) => [s.id, s]));

  box.innerHTML = `
    <p class="rp-period">Период: <b>${escapeHtml(headerLabel)}</b></p>

    <div class="section">
      <div class="section-head">
        <h3>Сводный отчёт</h3>
        <button class="btn btn-ghost btn-sm" data-export="summary">CSV</button>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Начислено</div>
          <div class="stat-value">${formatMoney(summary.accrued, state.currency)}</div>
          <div class="stat-foot">${summary.count} смен</div>
        </div>
        <div class="stat">
          <div class="stat-label">Пришло</div>
          <div class="stat-value">${formatMoney(summary.paid, state.currency)}</div>
          <div class="stat-foot">${summary.incomeCount} приходов</div>
        </div>
        <div class="stat accent">
          <div class="stat-label">Должно прийти</div>
          <div class="stat-value">${formatMoney(summary.due, state.currency)}</div>
          <div class="stat-foot">за выбранный период</div>
        </div>
        <div class="stat">
          <div class="stat-label">Часы</div>
          <div class="stat-value">${summary.hours.toFixed(2)}</div>
          <div class="stat-foot">средняя ставка ${formatMoney(summary.avgRate, state.currency)}/ч</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>По должностям</h3>
        <button class="btn btn-ghost btn-sm" data-export="positions">CSV</button>
      </div>
      ${buildPositionTable(byPosition, summary.totalAmount)}
    </div>

    <div class="section">
      <div class="section-head">
        <h3>По адресам</h3>
        <button class="btn btn-ghost btn-sm" data-export="addresses">CSV</button>
      </div>
      ${buildAddressTable(byAddress)}
    </div>

    <div class="section">
      <div class="section-head">
        <h3>По дням</h3>
        <span class="hint">${byDay.length} дней</span>
        <button class="btn btn-ghost btn-sm" data-export="days">CSV</button>
      </div>
      ${buildDayTable(byDay)}
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Смены</h3>
        <span class="hint">${shifts.length}</span>
        <button class="btn btn-ghost btn-sm" data-export="shifts">CSV</button>
      </div>
      ${buildShiftsTable(shifts, fifoMap)}
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Приходы</h3>
        <span class="hint">${incomes.length}</span>
        <button class="btn btn-ghost btn-sm" data-export="incomes">CSV</button>
      </div>
      ${buildIncomesTable(incomes)}
    </div>
  `;

  box.querySelectorAll("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => {
      exportReport(btn.dataset.export, {
        shifts,
        incomes,
        summary,
        byPosition,
        byAddress,
        byDay,
        fifoMap,
        label: headerLabel,
      });
    });
  });
}

// ------------------------------------------------------------
// Сводка
// ------------------------------------------------------------
function buildSummary(shifts, incomes) {
  const shSum = sumShifts(shifts);
  const paid = round2(incomes.reduce((a, i) => a + (Number(i.amount) || 0), 0));
  const due = round2(shSum.amount - paid);
  const avgRate = shSum.hours > 0 ? round2(shSum.amount / shSum.hours) : 0;
  return {
    accrued: shSum.amount,
    paid,
    due,
    hours: shSum.hours,
    count: shSum.count,
    incomeCount: incomes.length,
    avgRate,
    totalAmount: shSum.amount,
  };
}

// ------------------------------------------------------------
// Таблицы
// ------------------------------------------------------------
function buildPositionTable(rows, total) {
  if (!rows.length) return `<div class="empty">Нет смен по должностям.</div>`;
  const body = rows
    .map((r) => {
      const share = total > 0 ? ((r.amount / total) * 100).toFixed(1) : "0.0";
      return `
        <tr>
          <td data-label="Должность">${escapeHtml(r.name)}</td>
          <td data-label="Смены" class="num">${r.count}</td>
          <td data-label="Часы" class="num">${r.hours.toFixed(2)}</td>
          <td data-label="Сумма" class="num">${formatMoney(r.amount, state.currency)}</td>
          <td data-label="Доля" class="num">${share}%</td>
        </tr>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Должность</th>
            <th class="num">Смены</th>
            <th class="num">Часы</th>
            <th class="num">Сумма</th>
            <th class="num">Доля</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function buildAddressTable(rows) {
  if (!rows.length) return `<div class="empty">Нет смен по адресам.</div>`;
  const body = rows
    .map(
      (r) => `
      <tr>
        <td data-label="Адрес">${escapeHtml(r.label)}</td>
        <td data-label="Смены" class="num">${r.count}</td>
        <td data-label="Часы" class="num">${r.hours.toFixed(2)}</td>
        <td data-label="Сумма" class="num">${formatMoney(r.amount, state.currency)}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Адрес</th>
            <th class="num">Смены</th>
            <th class="num">Часы</th>
            <th class="num">Сумма</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function buildDayTable(rows) {
  if (!rows.length) return `<div class="empty">Нет смен по дням.</div>`;
  const totals = rows.reduce(
    (acc, r) => {
      acc.hours += r.hours;
      acc.amount += r.amount;
      acc.count += r.count;
      return acc;
    },
    { hours: 0, amount: 0, count: 0 }
  );
  const body = rows
    .map(
      (r) => `
      <tr>
        <td data-label="Дата">${formatDate(r.date)}</td>
        <td data-label="Смены" class="num">${r.count}</td>
        <td data-label="Часы" class="num">${r.hours.toFixed(2)}</td>
        <td data-label="Сумма" class="num">${formatMoney(r.amount, state.currency)}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Дата</th>
            <th class="num">Смены</th>
            <th class="num">Часы</th>
            <th class="num">Сумма</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td>Итого</td>
            <td class="num">${totals.count}</td>
            <td class="num">${totals.hours.toFixed(2)}</td>
            <td class="num">${formatMoney(totals.amount, state.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function buildShiftsTable(shifts, fifoMap) {
  if (!shifts.length) return `<div class="empty">Нет смен за период.</div>`;
  const posMap = new Map(state.positions.map((p) => [p.id, p]));
  const addrMap = new Map(state.addresses.map((a) => [a.id, a]));

  const body = shifts
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((s) => {
      const f = fifoMap.get(s.id) || {};
      const status = f.status || "unpaid";
      const overdueRow = status !== "paid" && daysAgo(s.date) > OVERDUE_DAYS;
      const cls = overdueRow ? "is-overdue" : status === "partial" ? "is-partial" : "";
      const tag =
        status === "paid"
          ? `<span class="tag ok">Оплачено</span>`
          : status === "partial"
          ? `<span class="tag warn">Частично</span>`
          : overdueRow
          ? `<span class="tag danger">Просрочено</span>`
          : `<span class="tag">Не оплачено</span>`;

      return `
        <tr class="${cls}">
          <td data-label="№" class="num">${s.month_no}.${s.shift_no}</td>
          <td data-label="Дата">${formatDate(s.date)}</td>
          <td data-label="Начало">${formatTime(s.start_time)}</td>
          <td data-label="Конец">${formatTime(s.end_time)}</td>
          <td data-label="Должность">${escapeHtml(posMap.get(s.position_id)?.name || "—")}</td>
          <td data-label="Адрес">${escapeHtml(addrMap.get(s.address_id)?.label || "—")}</td>
          <td data-label="Часы" class="num">${Number(s.hours).toFixed(2)}</td>
          <td data-label="Ставка" class="num">${formatMoney(s.rate, state.currency)}</td>
          <td data-label="Сумма" class="num">${formatMoney(s.amount, state.currency)}</td>
          <td data-label="Статус">${tag}</td>
        </tr>`;
    })
    .join("");

  const totals = sumShifts(shifts);
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th class="num">№</th>
            <th>Дата</th>
            <th>Начало</th>
            <th>Конец</th>
            <th>Должность</th>
            <th>Адрес</th>
            <th class="num">Часы</th>
            <th class="num">Ставка</th>
            <th class="num">Сумма</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td colspan="6">Итого</td>
            <td class="num">${totals.hours.toFixed(2)}</td>
            <td></td>
            <td class="num">${formatMoney(totals.amount, state.currency)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function buildIncomesTable(incomes) {
  if (!incomes.length) return `<div class="empty">Нет приходов за период.</div>`;
  const sorted = incomes.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = round2(sorted.reduce((a, i) => a + (Number(i.amount) || 0), 0));
  const body = sorted
    .map(
      (i) => `
      <tr>
        <td data-label="Дата">${formatDate(i.date)}</td>
        <td data-label="Сумма" class="num">${formatMoney(i.amount, state.currency)}</td>
        <td data-label="Заметка">${escapeHtml(i.note || "—")}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Дата</th>
            <th class="num">Сумма</th>
            <th>Заметка</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td>Итого</td>
            <td class="num">${formatMoney(total, state.currency)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------
function exportReport(kind, ctx) {
  const { shifts, incomes, summary, byPosition, byAddress, byDay, fifoMap, label } = ctx;
  const safeLabel = slug(label);
  const filename = `${kind}_${safeLabel}_${todayISO()}.csv`;

  if (kind === "summary") {
    const rows = [
      { metric: "Начислено", value: summary.accrued.toFixed(2) },
      { metric: "Пришло", value: summary.paid.toFixed(2) },
      { metric: "Должно прийти", value: summary.due.toFixed(2) },
      { metric: "Часы", value: summary.hours.toFixed(2) },
      { metric: "Смены", value: summary.count },
      { metric: "Приходы", value: summary.incomeCount },
      { metric: "Средняя ставка", value: summary.avgRate.toFixed(2) },
    ];
    downloadCSV(filename, toCSV(rows, [
      { key: "metric", label: "Показатель" },
      { key: "value", label: "Значение" },
    ]));
    return;
  }

  if (kind === "positions") {
    const rows = byPosition.map((r) => ({
      name: r.name,
      count: r.count,
      hours: r.hours.toFixed(2),
      amount: r.amount.toFixed(2),
    }));
    downloadCSV(filename, toCSV(rows, [
      { key: "name", label: "Должность" },
      { key: "count", label: "Смены" },
      { key: "hours", label: "Часы" },
      { key: "amount", label: "Сумма" },
    ]));
    return;
  }

  if (kind === "addresses") {
    const rows = byAddress.map((r) => ({
      label: r.label,
      count: r.count,
      hours: r.hours.toFixed(2),
      amount: r.amount.toFixed(2),
    }));
    downloadCSV(filename, toCSV(rows, [
      { key: "label", label: "Адрес" },
      { key: "count", label: "Смены" },
      { key: "hours", label: "Часы" },
      { key: "amount", label: "Сумма" },
    ]));
    return;
  }

  if (kind === "days") {
    const rows = byDay.map((r) => ({
      date: r.date,
      count: r.count,
      hours: r.hours.toFixed(2),
      amount: r.amount.toFixed(2),
    }));
    downloadCSV(filename, toCSV(rows, [
      { key: "date", label: "Дата" },
      { key: "count", label: "Смены" },
      { key: "hours", label: "Часы" },
      { key: "amount", label: "Сумма" },
    ]));
    return;
  }

  if (kind === "shifts") {
    const posMap = new Map(state.positions.map((p) => [p.id, p]));
    const addrMap = new Map(state.addresses.map((a) => [a.id, a]));
    const rows = shifts
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((s) => ({
        number: `${s.month_no}.${s.shift_no}`,
        date: s.date,
        start: formatTime(s.start_time),
        end: formatTime(s.end_time),
        break_min: s.break_minutes || 0,
        position: posMap.get(s.position_id)?.name || "",
        address: addrMap.get(s.address_id)?.label || "",
        hours: Number(s.hours).toFixed(2),
        rate: Number(s.rate).toFixed(2),
        amount: Number(s.amount).toFixed(2),
        status: fifoMap.get(s.id)?.status || "unpaid",
      }));
    downloadCSV(filename, toCSV(rows, [
      { key: "number", label: "№" },
      { key: "date", label: "Дата" },
      { key: "start", label: "Начало" },
      { key: "end", label: "Конец" },
      { key: "break_min", label: "Перерыв (мин)" },
      { key: "position", label: "Должность" },
      { key: "address", label: "Адрес" },
      { key: "hours", label: "Часы" },
      { key: "rate", label: "Ставка" },
      { key: "amount", label: "Сумма" },
      { key: "status", label: "Статус" },
    ]));
    return;
  }

  if (kind === "incomes") {
    const rows = incomes
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((i) => ({
        date: i.date,
        amount: Number(i.amount).toFixed(2),
        note: i.note || "",
      }));
    downloadCSV(filename, toCSV(rows, [
      { key: "date", label: "Дата" },
      { key: "amount", label: "Сумма" },
      { key: "note", label: "Заметка" },
    ]));
    return;
  }
}

// ------------------------------------------------------------
// Экспорт всего (сводный CSV)
// ------------------------------------------------------------
function exportAll() {
  const { from, to } = currentRange();
  const shifts = (from || to)
    ? state.shifts.filter((s) => inRange(s.date, from, to))
    : state.shifts.slice();
  const incomes = (from || to)
    ? state.incomes.filter((i) => inRange(i.date, from, to))
    : state.incomes.slice();

  const summary = buildSummary(shifts, incomes);
  const byPosition = groupByPosition(shifts, state.positions);
  const byAddress = groupByAddress(shifts, state.addresses);
  const byDay = groupByDay(shifts);
  const label = periodLabel(state.filter.type, from, to);

  const parts = [];
  parts.push(`Отчёт за период: ${label}`);
  parts.push(`Сформирован: ${todayISO()}`);
  parts.push("");
  parts.push("СВОДКА");
  parts.push(`Начислено;${summary.accrued.toFixed(2)}`);
  parts.push(`Пришло;${summary.paid.toFixed(2)}`);
  parts.push(`Должно прийти;${summary.due.toFixed(2)}`);
  parts.push(`Часы;${summary.hours.toFixed(2)}`);
  parts.push(`Смены;${summary.count}`);
  parts.push("");
  parts.push("ПО ДОЛЖНОСТЯМ");
  parts.push("Должность;Смены;Часы;Сумма");
  byPosition.forEach((r) =>
    parts.push(`${r.name};${r.count};${r.hours.toFixed(2)};${r.amount.toFixed(2)}`)
  );
  parts.push("");
  parts.push("ПО АДРЕСАМ");
  parts.push("Адрес;Смены;Часы;Сумма");
  byAddress.forEach((r) =>
    parts.push(`${r.label};${r.count};${r.hours.toFixed(2)};${r.amount.toFixed(2)}`)
  );
  parts.push("");
  parts.push("ПО ДНЯМ");
  parts.push("Дата;Смены;Часы;Сумма");
  byDay.forEach((r) =>
    parts.push(`${r.date};${r.count};${r.hours.toFixed(2)};${r.amount.toFixed(2)}`)
  );

  downloadCSV(`report_all_${slug(label)}_${todayISO()}.csv`, parts.join("\n"));
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

function slug(str) {
  return (
    String(str || "")
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "period"
  );
}