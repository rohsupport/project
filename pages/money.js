// ============================================================
// pages/money.js
// Раздел «Деньги»: вкладки Баланс | Приходы
// ============================================================
import {
  supabase,
  safe,
  getCurrentUser,
  logAction,
  formatMoney,
} from "../lib/supabase.js";
import {
  todayISO,
  formatDate,
  periodRange,
  inRange,
  daysAgo,
} from "../lib/dates.js";
import {
  balance,
  fifo,
  overdueShifts,
  detectIssues,
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
  tab: "balance", // "balance" | "incomes"
  currency: DEFAULT_CURRENCY,
  positions: [],
  addresses: [],
  shifts: [],
  incomes: [],

  filter: {
    type: "all", // "all" | "day" | "week" | "month" | "custom"
    from: "",
    to: "",
  },

  loading: false,
};

let rootEl = null;
let unsubShifts = null;
let unsubIncomes = null;

// ------------------------------------------------------------
// Загрузка данных
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
        <h2>Деньги</h2>
        <p class="sub">Начислено, пришло, должно прийти</p>
      </div>
    </div>

    <div class="tabs" id="mnTabs">
      <button class="tab ${state.tab === "balance" ? "active" : ""}" data-tab="balance">Баланс</button>
      <button class="tab ${state.tab === "incomes" ? "active" : ""}" data-tab="incomes">Приходы</button>
    </div>

    <div id="mnTabBalance" class="tab-panel ${state.tab === "balance" ? "" : "hidden"}"></div>
    <div id="mnTabIncomes" class="tab-panel ${state.tab === "incomes" ? "" : "hidden"}"></div>
  `;

  rootEl.querySelector("#mnTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    rootEl.querySelectorAll("#mnTabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === state.tab)
    );
    rootEl.querySelector("#mnTabBalance").classList.toggle("hidden", state.tab !== "balance");
    rootEl.querySelector("#mnTabIncomes").classList.toggle("hidden", state.tab !== "incomes");
    renderBody();
  });

  await loadAll();

  // Realtime
  try {
    const user = await getCurrentUser();
    if (user) {
      unsubShifts = supabase
        .channel("money-shifts-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shifts", filter: `user_id=eq.${user.id}` },
          () => loadAll()
        )
        .subscribe();
      unsubIncomes = supabase
        .channel("money-incomes-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incomes", filter: `user_id=eq.${user.id}` },
          () => loadAll()
        )
        .subscribe();
    }
  } catch (e) {
    if (DEBUG) console.warn("realtime money failed:", e);
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
// Общий рендер по вкладке
// ------------------------------------------------------------
function renderBody() {
  if (!rootEl) return;

  if (state.tab === "balance") renderBalance();
  else renderIncomes();
}

// ------------------------------------------------------------
// Фильтры дат (общие)
// ------------------------------------------------------------
function filterHtml(idPrefix) {
  const f = state.filter;
  return `
    <div class="filters" id="${idPrefix}Filters">
      <div class="field-inline">
        <label>Период</label>
        <select id="${idPrefix}Type">
          <option value="all" ${f.type === "all" ? "selected" : ""}>Всё время</option>
          <option value="day" ${f.type === "day" ? "selected" : ""}>День</option>
          <option value="week" ${f.type === "week" ? "selected" : ""}>Неделя</option>
          <option value="month" ${f.type === "month" ? "selected" : ""}>Месяц</option>
          <option value="custom" ${f.type === "custom" ? "selected" : ""}>Произвольный</option>
        </select>
      </div>
      <div class="field-inline" id="${idPrefix}Custom" style="${f.type === "custom" ? "display:flex" : "display:none"}">
        <input type="date" id="${idPrefix}From" value="${f.from}" />
        <span>—</span>
        <input type="date" id="${idPrefix}To" value="${f.to}" />
      </div>
    </div>
  `;
}

function bindFilterEvents(prefix) {
  const box = rootEl.querySelector(`#${prefix}Filters`);
  if (!box) return;
  const type = box.querySelector(`#${prefix}Type`);
  const custom = box.querySelector(`#${prefix}Custom`);
  const from = box.querySelector(`#${prefix}From`);
  const to = box.querySelector(`#${prefix}To`);

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

function applyDateFilter(arr, from, to) {
  if (!from && !to) return arr;
  return arr.filter((x) => inRange(x.date, from, to));
}

// ============================================================
// ВКЛАДКА «БАЛАНС»
// ============================================================
function renderBalance() {
  const box = rootEl.querySelector("#mnTabBalance");

  const { from, to } = currentRange();
  const filteredShifts = applyDateFilter(state.shifts, from, to);
  const filteredIncomes = applyDateFilter(state.incomes, from, to);

  // Баланс — считается по ВСЕМ сменам (долг всегда за всё время)
  const bal = balance(state.shifts, state.incomes);
  const fifoRes = fifo(state.shifts, state.incomes);
  const overdue = overdueShifts(fifoRes.shifts);

  // В рамках фильтра — начислено и пришло
  const balFiltered = balance(filteredShifts, filteredIncomes);

  // Анализ — по всем данным
  const issues = detectIssues({
    shifts: state.shifts,
    incomes: state.incomes,
    positions: state.positions,
    addresses: state.addresses,
  });

  // Неоплаченные смены (FIFO)
  const unpaid = fifoRes.shifts
    .filter((s) => s.status !== "paid")
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const issuesHtml = issues.length
    ? issues
        .map(
          (i) => `
        <div class="analysis-item ${i.level}">
          <div class="ai-body">
            <div class="ai-title">${escapeHtml(i.message)}</div>
            ${
              i.type === "overdue"
                ? `<div class="ai-sub">Порог просрочки: ${OVERDUE_DAYS} дней</div>`
                : ""
            }
          </div>
        </div>`
        )
        .join("")
    : `<div class="analysis-item good"><div class="ai-body"><div class="ai-title">Проблем не обнаружено</div></div></div>`;

  const unpaidHtml = unpaid.length
    ? unpaid
        .map((s) => {
          const overdueRow = s.remaining > 0 && daysAgo(s.date) > OVERDUE_DAYS;
          const tag = overdueRow
            ? `<span class="tag danger">просрочено ${daysAgo(s.date)} дн.</span>`
            : s.status === "partial"
            ? `<span class="tag warn">частично</span>`
            : `<span class="tag">не оплачено</span>`;
          const num = `${s.month_no}.${s.shift_no}`;
          return `
            <div class="list-row">
              <div class="row-main">
                <div class="row-title">№ ${num} · ${formatDate(s.date)}</div>
                <div class="row-meta">${Number(s.hours).toFixed(2)} ч · ${formatMoney(s.rate, state.currency)}/ч ${tag}</div>
              </div>
              <div class="row-value">${formatMoney(s.remaining, state.currency)}</div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty">Все смены оплачены.</div>`;

  box.innerHTML = `
    ${filterHtml("bal")}

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Начислено (в периоде)</div>
        <div class="stat-value">${formatMoney(balFiltered.accrued, state.currency)}</div>
        <div class="stat-foot">по ${filteredShifts.length} сменам</div>
      </div>
      <div class="stat">
        <div class="stat-label">Пришло (в периоде)</div>
        <div class="stat-value">${formatMoney(balFiltered.paid, state.currency)}</div>
        <div class="stat-foot">по ${filteredIncomes.length} приходам</div>
      </div>
      <div class="stat accent">
        <div class="stat-label">Должно прийти (всего)</div>
        <div class="stat-value">${formatMoney(Math.max(0, bal.due), state.currency)}</div>
        <div class="stat-foot">
          начислено ${formatMoney(bal.accrued, state.currency)} · пришло ${formatMoney(bal.paid, state.currency)}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Анализ</h3>
        <span class="hint">${issues.length} наблюдений</span>
      </div>
      <div class="analysis">${issuesHtml}</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Неоплаченные смены</h3>
        <div class="list-actions">
          <button class="btn btn-ghost btn-sm" id="balExportUnpaid">CSV</button>
        </div>
      </div>
      <div class="list">${unpaidHtml}</div>
    </div>

    ${
      overdue.length > 0
        ? `<div class="section">
            <div class="section-head">
              <h3>Просрочка</h3>
              <span class="hint">>${OVERDUE_DAYS} дней · ${overdue.length} смен</span>
            </div>
            <div class="list">
              ${overdue
                .map(
                  (s) => `
                <div class="list-row">
                  <div class="row-main">
                    <div class="row-title">№ ${s.month_no}.${s.shift_no} · ${formatDate(s.date)}</div>
                    <div class="row-meta">${s.age} дней · ${formatMoney(s.remaining, state.currency)}</div>
                  </div>
                  <div class="row-value">${formatMoney(s.remaining, state.currency)}</div>
                </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
  `;

  bindFilterEvents("bal");

  box.querySelector("#balExportUnpaid")?.addEventListener("click", () => {
    const rows = unpaid.map((s) => ({
      number: `${s.month_no}.${s.shift_no}`,
      date: s.date,
      hours: Number(s.hours).toFixed(2),
      rate: Number(s.rate).toFixed(2),
      amount: Number(s.amount).toFixed(2),
      paid: Number(s.paid_amount).toFixed(2),
      remaining: Number(s.remaining).toFixed(2),
      status: s.status,
    }));
    const csv = toCSV(rows, [
      { key: "number", label: "№" },
      { key: "date", label: "Дата" },
      { key: "hours", label: "Часы" },
      { key: "rate", label: "Ставка" },
      { key: "amount", label: "Сумма" },
      { key: "paid", label: "Оплачено" },
      { key: "remaining", label: "Остаток" },
      { key: "status", label: "Статус" },
    ]);
    downloadCSV(`unpaid_${todayISO()}.csv`, csv);
  });
}

// ============================================================
// ВКЛАДКА «ПРИХОДЫ»
// ============================================================
function renderIncomes() {
  const box = rootEl.querySelector("#mnTabIncomes");
  const { from, to } = currentRange();
  const filtered = applyDateFilter(state.incomes, from, to);

  // Сортировка: новые сверху
  const sorted = filtered.slice().sort((a, b) => {
    if (a.date === b.date) {
      return (b.created_at || "").localeCompare(a.created_at || "");
    }
    return a.date < b.date ? 1 : -1;
  });

  const total = round2(sorted.reduce((acc, i) => acc + (Number(i.amount) || 0), 0));

  const listHtml = sorted.length
    ? sorted
        .map(
          (i) => `
        <div class="list-row" data-id="${i.id}">
          <div class="row-main">
            <div class="row-title">${formatDate(i.date)}</div>
            ${i.note ? `<div class="row-meta">${escapeHtml(i.note)}</div>` : ""}
          </div>
          <div class="row-value">${formatMoney(i.amount, state.currency)}</div>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${i.id}">Изм.</button>
            <button class="btn btn-danger btn-sm" data-act="delete" data-id="${i.id}">Удал.</button>
          </div>
        </div>`
        )
        .join("")
    : `<div class="empty">Нет приходов за выбранный период.</div>`;

  box.innerHTML = `
    ${filterHtml("inc")}

    <div class="section">
      <div class="section-head">
        <h3>Добавить приход</h3>
        <div class="list-actions">
          <button class="btn btn-ghost btn-sm" id="incExport">CSV</button>
        </div>
      </div>
      <div class="card">
        <form id="incomeForm" class="form-grid">
          <div class="field">
            <label for="incDate">Дата получения</label>
            <input type="date" id="incDate" value="${todayISO()}" required />
          </div>
          <div class="field">
            <label for="incAmount">Сумма</label>
            <input type="number" id="incAmount" min="0" step="0.01" placeholder="0.00" required />
          </div>
          <div class="field span-2">
            <label for="incNote">Заметка (необязательно)</label>
            <input type="text" id="incNote" maxlength="200" placeholder="Например, аванс или зарплата за первую половину" />
          </div>
          <div class="form-actions span-2">
            <button class="btn btn-primary" type="submit" id="incSubmit">Добавить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>История приходов</h3>
        <span class="hint">Итого: ${formatMoney(total, state.currency)} · ${sorted.length}</span>
      </div>
      <div class="list">${listHtml}</div>
    </div>
  `;

  bindFilterEvents("inc");

  // Добавление
  const form = box.querySelector("#incomeForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await addIncome(box);
  });

  // Действия над записями
  box.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "delete") await deleteIncome(id);
      if (btn.dataset.act === "edit") openEditIncome(id);
    });
  });

  // Экспорт
  box.querySelector("#incExport")?.addEventListener("click", () => {
    const rows = sorted.map((i) => ({
      date: i.date,
      amount: Number(i.amount).toFixed(2),
      note: i.note || "",
    }));
    const csv = toCSV(rows, [
      { key: "date", label: "Дата" },
      { key: "amount", label: "Сумма" },
      { key: "note", label: "Заметка" },
    ]);
    downloadCSV(`incomes_${todayISO()}.csv`, csv);
  });
}

async function addIncome(box) {
  const user = await getCurrentUser();
  if (!user) return toast("Нужно войти заново", "danger");

  const date = box.querySelector("#incDate").value;
  const amount = Number(box.querySelector("#incAmount").value);
  const note = box.querySelector("#incNote").value.trim() || null;

  if (!date) return toast("Укажите дату", "warn");
  if (!amount || amount <= 0) return toast("Сумма должна быть больше 0", "warn");

  const btn = box.querySelector("#incSubmit");
  if (btn) btn.disabled = true;

  const res = await safe(
    () =>
      supabase.from("incomes").insert({
        user_id: user.id,
        date,
        amount,
        note,
      }),
    "insert income"
  );

  if (btn) btn.disabled = false;

  if (res.error) return toast("Не удалось добавить приход", "danger");

  await logAction("income_create", { date, amount });
  toast(`Приход ${formatMoney(amount, state.currency)} добавлен`, "ok");
  await loadAll();
}

async function deleteIncome(id) {
  const ok = window.confirm("Удалить приход?");
  if (!ok) return;
  const user = await getCurrentUser();
  if (!user) return;

  const res = await safe(
    () =>
      supabase
        .from("incomes")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id),
    "delete income"
  );

  if (res.error) return toast("Не удалось удалить", "danger");
  await logAction("income_delete", { id });
  toast("Приход удалён", "ok");
  await loadAll();
}

function openEditIncome(id) {
  const inc = state.incomes.find((i) => i.id === id);
  if (!inc) return;

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">Редактировать приход</div>
        <button class="modal-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <form class="form-grid" id="eIncomeForm">
        <div class="field">
          <label>Дата</label>
          <input type="date" id="eiDate" value="${inc.date}" required />
        </div>
        <div class="field">
          <label>Сумма</label>
          <input type="number" id="eiAmount" min="0" step="0.01" value="${Number(inc.amount).toFixed(2)}" required />
        </div>
        <div class="field span-2">
          <label>Заметка</label>
          <input type="text" id="eiNote" maxlength="200" value="${inc.note ? escapeAttr(inc.note) : ""}" />
        </div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" id="eiSave">Сохранить</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#eiSave").addEventListener("click", async () => {
    const date = modal.querySelector("#eiDate").value;
    const amount = Number(modal.querySelector("#eiAmount").value);
    const note = modal.querySelector("#eiNote").value.trim() || null;

    if (!date) return toast("Укажите дату", "warn");
    if (!amount || amount <= 0) return toast("Сумма должна быть больше 0", "warn");

    const user = await getCurrentUser();
    if (!user) return;

    const res = await safe(
      () =>
        supabase
          .from("incomes")
          .update({ date, amount, note })
          .eq("id", id)
          .eq("user_id", user.id),
      "update income"
    );

    if (res.error) return toast("Не удалось сохранить", "danger");
    await logAction("income_update", { id, amount });
    toast("Приход обновлён", "ok");
    close();
    await loadAll();
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