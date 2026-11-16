// ============================================================
// pages/shifts.js
// Раздел «Смены»: вкладки Добавить | История
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
  formatTime,
  periodRange,
  inRange,
  daysAgo,
} from "../lib/dates.js";
import {
  calcHours,
  calcAmount,
  round2,
  fifo,
  sumShifts,
  toCSV,
  downloadCSV,
} from "../lib/money.js";
import { OVERDUE_DAYS, DEFAULT_CURRENCY, DEBUG } from "../config.js";
import { toast, isMobileViewport } from "../app.js";

// ------------------------------------------------------------
// Состояние модуля
// ------------------------------------------------------------
const state = {
  tab: "add", // "add" | "history"
  positions: [],
  addresses: [],
  currency: DEFAULT_CURRENCY,
  lastShift: null,

  // Форма добавления
  form: {
    date: todayISO(),
    start_time: "",
    end_time: "",
    break_minutes: 0,
    position_id: "",
    address_id: "",
  },

  // История
  history: {
    shifts: [],
    incomes: [],
    filter: {
      type: "month", // day | week | month | custom | all
      from: "",
      to: "",
      position_id: "",
      address_id: "",
      status: "", // "" | "paid" | "partial" | "unpaid"
    },
    sort: { key: "date", dir: "desc" },
    loading: false,
  },
};

let rootEl = null;
let unsubRealtime = null;

// ------------------------------------------------------------
// Загрузка справочников и настроек
// ------------------------------------------------------------
async function loadRefs() {
  const user = await getCurrentUser();
  if (!user) return;

  const [posRes, addrRes, setRes] = await Promise.all([
    safe(
      () =>
        supabase
          .from("positions")
          .select("*")
          .eq("user_id", user.id)
          .eq("archived", false)
          .order("name"),
      "load positions"
    ),
    safe(
      () =>
        supabase
          .from("addresses")
          .select("*")
          .eq("user_id", user.id)
          .eq("archived", false)
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
  ]);

  state.positions = posRes.data || [];
  state.addresses = addrRes.data || [];
  state.currency = setRes.data?.currency || DEFAULT_CURRENCY;
}

// ------------------------------------------------------------
// Загрузка последней смены (для предзаполнения формы)
// ------------------------------------------------------------
async function loadLastShift() {
  const user = await getCurrentUser();
  if (!user) return;
  const res = await safe(
    () =>
      supabase
        .from("shifts")
        .select("start_time,end_time,break_minutes,position_id,address_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    "load last shift"
  );
  state.lastShift = res.data || null;
}

// ------------------------------------------------------------
// Загрузка истории смен и приходов
// ------------------------------------------------------------
async function loadHistory() {
  const user = await getCurrentUser();
  if (!user) return;

  state.history.loading = true;
  renderHistoryBody();

  const f = state.history.filter;
  let from = f.from;
  let to = f.to;

  if (f.type !== "custom" && f.type !== "all") {
    const r = periodRange(f.type);
    from = r.from;
    to = r.to;
  }
  if (f.type === "all") {
    from = "";
    to = "";
  }

  let q = supabase
    .from("shifts")
    .select("*")
    .eq("user_id", user.id);

  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);
  if (f.position_id) q = q.eq("position_id", f.position_id);
  if (f.address_id) q = q.eq("address_id", f.address_id);

  const [shRes, incRes] = await Promise.all([
    safe(() => q, "load shifts"),
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

  state.history.shifts = shRes.data || [];
  state.history.incomes = incRes.data || [];
  state.history.loading = false;
  renderHistoryBody();
}

// ------------------------------------------------------------
// Рендер модуля
// ------------------------------------------------------------
export async function render(container) {
  rootEl = container;

  rootEl.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Смены</h2>
        <p class="sub">Добавление и история отработанных смен</p>
      </div>
    </div>

    <div class="tabs" id="shTabs">
      <button class="tab ${state.tab === "add" ? "active" : ""}" data-tab="add">Добавить</button>
      <button class="tab ${state.tab === "history" ? "active" : ""}" data-tab="history">История</button>
    </div>

    <div id="shTabAdd" class="tab-panel ${state.tab === "add" ? "" : "hidden"}"></div>
    <div id="shTabHistory" class="tab-panel ${state.tab === "history" ? "" : "hidden"}"></div>
  `;

  // Табы
  rootEl.querySelector("#shTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    rootEl.querySelectorAll("#shTabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === state.tab)
    );
    rootEl.querySelector("#shTabAdd").classList.toggle("hidden", state.tab !== "add");
    rootEl.querySelector("#shTabHistory").classList.toggle("hidden", state.tab !== "history");
    if (state.tab === "history" && state.history.shifts.length === 0) {
      loadHistory();
    }
  });

  await loadRefs();
  await loadLastShift();

  renderAddForm();
  renderHistoryShell();

  // Realtime: обновление истории при изменениях
  try {
    const user = await getCurrentUser();
    if (user) {
      unsubRealtime = supabase
        .channel("shifts-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shifts", filter: `user_id=eq.${user.id}` },
          () => {
            if (state.tab === "history") loadHistory();
          }
        )
        .subscribe();
    }
  } catch (e) {
    if (DEBUG) console.warn("realtime shifts failed:", e);
  }

  return () => {
    if (unsubRealtime) {
      try { supabase.removeChannel(unsubRealtime); } catch { /* ignore */ }
      unsubRealtime = null;
    }
  };
}

// ============================================================
// ВКЛАДКА «ДОБАВИТЬ»
// ============================================================
function renderAddForm() {
  const box = rootEl.querySelector("#shTabAdd");
  const f = state.form;

  // Предзаполнение из последней смены (только если пусто)
  if (state.lastShift) {
    if (!f.start_time) f.start_time = state.lastShift.start_time || "";
    if (!f.end_time) f.end_time = state.lastShift.end_time || "";
    if (f.break_minutes === 0) f.break_minutes = state.lastShift.break_minutes || 0;
    if (!f.position_id && state.lastShift.position_id) f.position_id = state.lastShift.position_id;
    if (!f.address_id && state.lastShift.address_id) f.address_id = state.lastShift.address_id;
  }

  // Если должность не выбрана — берём первую
  if (!f.position_id && state.positions[0]) f.position_id = state.positions[0].id;

  const posOptions = state.positions
    .map(
      (p) =>
        `<option value="${p.id}" ${f.position_id === p.id ? "selected" : ""}>${escapeHtml(p.name)} · ${formatMoney(p.rate, state.currency)}/ч</option>`
    )
    .join("");

  const addrOptions =
    `<option value="">— без адреса —</option>` +
    state.addresses
      .map(
        (a) =>
          `<option value="${a.id}" ${f.address_id === a.id ? "selected" : ""}>${escapeHtml(a.label)}${a.address ? " · " + escapeHtml(a.address) : ""}</option>`
      )
      .join("");

  box.innerHTML = `
    <div class="card">
      <form id="addShiftForm" novalidate>
        <div class="form-grid">
          <div class="field">
            <label for="fDate">Дата</label>
            <input type="date" id="fDate" value="${f.date}" required />
          </div>
          <div class="field">
            <label for="fBreak">Перерыв, мин</label>
            <input type="number" id="fBreak" min="0" step="1" value="${f.break_minutes}" />
          </div>
          <div class="field">
            <label for="fStart">Время начала</label>
            <input type="time" id="fStart" value="${f.start_time}" required />
          </div>
          <div class="field">
            <label for="fEnd">Время окончания</label>
            <input type="time" id="fEnd" value="${f.end_time}" required />
          </div>
          <div class="field">
            <label for="fPos">Должность</label>
            <select id="fPos" required ${state.positions.length === 0 ? "disabled" : ""}>
              ${posOptions || `<option value="">— нет должностей —</option>`}
            </select>
          </div>
          <div class="field">
            <label for="fAddr">Адрес</label>
            <select id="fAddr">
              ${addrOptions}
            </select>
          </div>
        </div>

        <div class="preview-box" id="shiftPreview"></div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="addSubmit">Сохранить</button>
        </div>

        ${
          state.positions.length === 0
            ? `<p class="form-hint">Сначала добавьте должность в разделе «Справочники».</p>`
            : ``
        }
      </form>
    </div>
  `;

  const form = box.querySelector("#addShiftForm");
  const fDate = box.querySelector("#fDate");
  const fStart = box.querySelector("#fStart");
  const fEnd = box.querySelector("#fEnd");
  const fBreak = box.querySelector("#fBreak");
  const fPos = box.querySelector("#fPos");
  const fAddr = box.querySelector("#fAddr");
  const preview = box.querySelector("#shiftPreview");

  function updatePreview() {
    const hours = calcHours(fStart.value, fEnd.value, Number(fBreak.value) || 0);
    const pos = state.positions.find((p) => p.id === fPos.value);
    const rate = pos ? Number(pos.rate) : 0;
    const amount = calcAmount(hours, rate);

    if (!fStart.value || !fEnd.value || !pos) {
      preview.innerHTML = `<span class="muted">Заполните время и должность — здесь появятся часы и сумма.</span>`;
      return;
    }

    preview.innerHTML = `
      <div class="preview-row"><span>Часы</span><b>${hours.toFixed(2)}</b></div>
      <div class="preview-row"><span>Ставка</span><b>${formatMoney(rate, state.currency)}/ч</b></div>
      <div class="preview-row accent"><span>Сумма</span><b>${formatMoney(amount, state.currency)}</b></div>
    `;
  }

  [fStart, fEnd, fBreak, fPos].forEach((el) =>
    el?.addEventListener("input", updatePreview)
  );

  updatePreview();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveShift({ fDate, fStart, fEnd, fBreak, fPos, fAddr });
  });
}

async function saveShift({ fDate, fStart, fEnd, fBreak, fPos, fAddr }) {
  const user = await getCurrentUser();
  if (!user) return toast("Нужно войти заново", "danger");

  const date = fDate.value;
  const start = fStart.value;
  const end = fEnd.value;
  const brk = Number(fBreak.value) || 0;
  const positionId = fPos.value;
  const addressId = fAddr.value || null;

  if (!date || !start || !end) {
    toast("Заполните дату, начало и конец", "warn");
    return;
  }
  if (!positionId) {
    toast("Выберите должность", "warn");
    return;
  }

  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) {
    toast("Должность не найдена", "danger");
    return;
  }

  const hours = calcHours(start, end, brk);
  if (hours <= 0) {
    toast("Часы должны быть больше нуля", "warn");
    return;
  }
  const rate = Number(pos.rate) || 0;
  const amount = calcAmount(hours, rate);

  const submitBtn = rootEl.querySelector("#addSubmit");
  if (submitBtn) submitBtn.disabled = true;

  const payload = {
    user_id: user.id,
    date,
    start_time: start,
    end_time: end,
    break_minutes: brk,
    hours,
    rate,
    amount,
    position_id: positionId,
    address_id: addressId,
  };

  const res = await safe(
    () => supabase.from("shifts").insert(payload).select("*").single(),
    "insert shift"
  );

  if (submitBtn) submitBtn.disabled = false;

  if (res.error) {
    toast("Не удалось сохранить смену", "danger");
    return;
  }

  await logAction("shift_create", { id: res.data.id, amount, hours });

  // Обновляем состояние формы (сохраняем время/должность/адрес — не дату)
  state.form.start_time = start;
  state.form.end_time = end;
  state.form.break_minutes = brk;
  state.form.position_id = positionId;
  state.form.address_id = addressId;
  state.form.date = todayISO(); // дата — сегодня для следующей записи

  state.lastShift = {
    start_time: start,
    end_time: end,
    break_minutes: brk,
    position_id: positionId,
    address_id: addressId,
  };

  toast(`Смена сохранена: ${hours.toFixed(2)} ч · ${formatMoney(amount, state.currency)}`, "ok");

  // Перерисовываем форму (сохраняя значения)
  renderAddForm();

  // Если открыта история — обновить
  if (state.tab === "history") loadHistory();
}

// ============================================================
// ВКЛАДКА «ИСТОРИЯ»
// ============================================================
function renderHistoryShell() {
  const box = rootEl.querySelector("#shTabHistory");

  const posOptions = state.positions
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");
  const addrOptions = state.addresses
    .map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`)
    .join("");

  box.innerHTML = `
    <div class="filters" id="shFilters">
      <div class="field-inline">
        <label>Период</label>
        <select id="fType">
          <option value="day">День</option>
          <option value="week">Неделя</option>
          <option value="month" selected>Месяц</option>
          <option value="custom">Произвольный</option>
          <option value="all">Всё время</option>
        </select>
      </div>

      <div class="field-inline" id="customRange" style="display:none">
        <input type="date" id="fFrom" />
        <span>—</span>
        <input type="date" id="fTo" />
      </div>

      <div class="field-inline">
        <label>Должность</label>
        <select id="fPosFilter">
          <option value="">Все</option>
          ${posOptions}
        </select>
      </div>

      <div class="field-inline">
        <label>Адрес</label>
        <select id="fAddrFilter">
          <option value="">Все</option>
          ${addrOptions}
        </select>
      </div>

      <div class="field-inline">
        <label>Статус</label>
        <select id="fStatusFilter">
          <option value="">Все</option>
          <option value="paid">Оплачено</option>
          <option value="partial">Частично</option>
          <option value="unpaid">Не оплачено</option>
        </select>
      </div>

      <div class="spacer"></div>

      <button class="btn btn-ghost btn-sm" id="fReset">Сбросить</button>
      <button class="btn btn-secondary btn-sm" id="fExport">CSV</button>
    </div>

    <div id="historyBody"></div>
  `;

  const fType = box.querySelector("#fType");
  const customRange = box.querySelector("#customRange");
  const fFrom = box.querySelector("#fFrom");
  const fTo = box.querySelector("#fTo");
  const fPos = box.querySelector("#fPosFilter");
  const fAddr = box.querySelector("#fAddrFilter");
  const fStatus = box.querySelector("#fStatusFilter");

  fType.value = state.history.filter.type;
  fFrom.value = state.history.filter.from;
  fTo.value = state.history.filter.to;
  fPos.value = state.history.filter.position_id;
  fAddr.value = state.history.filter.address_id;
  fStatus.value = state.history.filter.status;
  customRange.style.display = fType.value === "custom" ? "flex" : "none";

  fType.addEventListener("change", () => {
    state.history.filter.type = fType.value;
    customRange.style.display = fType.value === "custom" ? "flex" : "none";
    if (fType.value !== "custom") loadHistory();
  });
  fFrom.addEventListener("change", () => {
    state.history.filter.from = fFrom.value;
    loadHistory();
  });
  fTo.addEventListener("change", () => {
    state.history.filter.to = fTo.value;
    loadHistory();
  });
  fPos.addEventListener("change", () => {
    state.history.filter.position_id = fPos.value;
    loadHistory();
  });
  fAddr.addEventListener("change", () => {
    state.history.filter.address_id = fAddr.value;
    loadHistory();
  });
  fStatus.addEventListener("change", () => {
    state.history.filter.status = fStatus.value;
    renderHistoryBody();
  });

  box.querySelector("#fReset").addEventListener("click", () => {
    state.history.filter = {
      type: "month",
      from: "",
      to: "",
      position_id: "",
      address_id: "",
      status: "",
    };
    fType.value = "month";
    fFrom.value = "";
    fTo.value = "";
    fPos.value = "";
    fAddr.value = "";
    fStatus.value = "";
    customRange.style.display = "none";
    loadHistory();
  });

  box.querySelector("#fExport").addEventListener("click", exportCSV);

  if (state.history.shifts.length === 0) {
    loadHistory();
  } else {
    renderHistoryBody();
  }
}

function renderHistoryBody() {
  const box = rootEl?.querySelector("#historyBody");
  if (!box) return;

  if (state.history.loading) {
    box.innerHTML = `<div class="empty">Загрузка…</div>`;
    return;
  }

  const posMap = new Map(state.positions.map((p) => [p.id, p]));
  const addrMap = new Map(state.addresses.map((a) => [a.id, a]));

  // FIFO-статусы
  const f = fifo(state.history.shifts, state.history.incomes);
  const fifoMap = new Map(f.shifts.map((s) => [s.id, s]));

  // Слияние
  let rows = state.history.shifts.map((s) => {
    const fs = fifoMap.get(s.id) || {};
    return {
      ...s,
      status: fs.status || "unpaid",
      paid_amount: fs.paid_amount || 0,
      remaining: fs.remaining ?? s.amount,
      age: daysAgo(s.date),
    };
  });

  // Фильтр по статусу
  if (state.history.filter.status) {
    rows = rows.filter((r) => r.status === state.history.filter.status);
  }

  // Сортировка
  const { key, dir } = state.history.sort;
  rows.sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (typeof va === "string" && typeof vb === "string") {
      return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    va = Number(va) || 0;
    vb = Number(vb) || 0;
    return dir === "asc" ? va - vb : vb - va;
  });

  // Итоги
  const totals = sumShifts(rows);

  if (rows.length === 0) {
    box.innerHTML = `<div class="empty">Нет смен за выбранный период.</div>`;
    return;
  }

  const sortIcon = (k) =>
    state.history.sort.key === k
      ? state.history.sort.dir === "asc"
        ? " ▲"
        : " ▼"
      : "";

  const rowsHtml = rows
    .map((r) => {
      const num = `${r.month_no}.${r.shift_no}`;
      const pos = posMap.get(r.position_id)?.name || "—";
      const addr = addrMap.get(r.address_id)?.label || "—";
      const overdue = r.status !== "paid" && r.age > OVERDUE_DAYS;
      const cls = overdue ? "is-overdue" : r.status === "partial" ? "is-partial" : "";
      const statusTag =
        r.status === "paid"
          ? `<span class="tag ok">Оплачено</span>`
          : r.status === "partial"
          ? `<span class="tag warn">Частично · ${formatMoney(r.paid_amount, state.currency)}</span>`
          : overdue
          ? `<span class="tag danger">Просрочено · ${r.age} дн.</span>`
          : `<span class="tag">Не оплачено</span>`;

      return `
        <tr class="${cls}" data-id="${r.id}">
          <td data-label="№" class="num">${num}</td>
          <td data-label="Дата">${formatDate(r.date)}</td>
          <td data-label="Начало">${formatTime(r.start_time)}</td>
          <td data-label="Конец">${formatTime(r.end_time)}</td>
          <td data-label="Перерыв" class="num">${r.break_minutes || 0}</td>
          <td data-label="Должность">${escapeHtml(pos)}</td>
          <td data-label="Адрес">${escapeHtml(addr)}</td>
          <td data-label="Часы" class="num">${Number(r.hours).toFixed(2)}</td>
          <td data-label="Ставка" class="num">${formatMoney(r.rate, state.currency)}</td>
          <td data-label="Сумма" class="num">${formatMoney(r.amount, state.currency)}</td>
          <td data-label="Статус">${statusTag}</td>
          <td data-label="Действия">
            <div class="row-tools">
              <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">Изм.</button>
              <button class="btn btn-danger btn-sm" data-act="delete" data-id="${r.id}">Удал.</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  box.innerHTML = `
    <div class="table-wrap">
      <table class="data" id="shTable">
        <thead>
          <tr>
            <th class="num sortable" data-sort="month_no">№${sortIcon("month_no")}</th>
            <th class="sortable" data-sort="date">Дата${sortIcon("date")}</th>
            <th>Начало</th>
            <th>Конец</th>
            <th class="num">Перерыв</th>
            <th>Должность</th>
            <th>Адрес</th>
            <th class="num sortable" data-sort="hours">Часы${sortIcon("hours")}</th>
            <th class="num">Ставка</th>
            <th class="num sortable" data-sort="amount">Сумма${sortIcon("amount")}</th>
            <th>Статус</th>
            <th class="num">Действия</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="7">Итого: ${totals.count} смен</td>
            <td class="num">${totals.hours.toFixed(2)}</td>
            <td></td>
            <td class="num">${formatMoney(totals.amount, state.currency)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  // Сортировка
  box.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.history.sort.key === k) {
        state.history.sort.dir = state.history.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.history.sort.key = k;
        state.history.sort.dir = k === "date" ? "desc" : "asc";
      }
      renderHistoryBody();
    });
  });

  // Действия
  box.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "delete") await deleteShift(id);
      if (btn.dataset.act === "edit") openEditShift(id);
    });
  });
}

// ------------------------------------------------------------
// Удаление смены
// ------------------------------------------------------------
async function deleteShift(id) {
  const ok = window.confirm("Удалить смену? Действие необратимо.");
  if (!ok) return;
  const user = await getCurrentUser();
  if (!user) return;

  const res = await safe(
    () =>
      supabase
        .from("shifts")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id),
    "delete shift"
  );

  if (res.error) {
    toast("Не удалось удалить", "danger");
    return;
  }

  await logAction("shift_delete", { id });
  toast("Смена удалена", "ok");
  await loadHistory();
}

// ------------------------------------------------------------
// Редактирование смены (модалка)
// ------------------------------------------------------------
function openEditShift(id) {
  const shift = state.history.shifts.find((s) => s.id === id);
  if (!shift) return;

  const posOptions = state.positions
    .map(
      (p) =>
        `<option value="${p.id}" ${shift.position_id === p.id ? "selected" : ""}>${escapeHtml(p.name)} · ${formatMoney(p.rate, state.currency)}/ч</option>`
    )
    .join("");

  const addrOptions =
    `<option value="">— без адреса —</option>` +
    state.addresses
      .map(
        (a) =>
          `<option value="${a.id}" ${shift.address_id === a.id ? "selected" : ""}>${escapeHtml(a.label)}</option>`
      )
      .join("");

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">Редактировать смену ${shift.month_no}.${shift.shift_no}</div>
        <button class="modal-close" data-close aria-label="Закрыть">✕</button>
      </div>

      <form id="editForm" class="form-grid">
        <div class="field">
          <label>Дата</label>
          <input type="date" id="eDate" value="${shift.date}" required />
        </div>
        <div class="field">
          <label>Перерыв, мин</label>
          <input type="number" id="eBreak" min="0" value="${shift.break_minutes || 0}" />
        </div>
        <div class="field">
          <label>Начало</label>
          <input type="time" id="eStart" value="${formatTime(shift.start_time)}" required />
        </div>
        <div class="field">
          <label>Конец</label>
          <input type="time" id="eEnd" value="${formatTime(shift.end_time)}" required />
        </div>
        <div class="field span-2">
          <label>Должность</label>
          <select id="ePos">${posOptions}</select>
        </div>
        <div class="field span-2">
          <label>Адрес</label>
          <select id="eAddr">${addrOptions}</select>
        </div>
      </form>

      <div class="form-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" id="eSave">Сохранить</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#eSave").addEventListener("click", async () => {
    const date = modal.querySelector("#eDate").value;
    const start = modal.querySelector("#eStart").value;
    const end = modal.querySelector("#eEnd").value;
    const brk = Number(modal.querySelector("#eBreak").value) || 0;
    const posId = modal.querySelector("#ePos").value;
    const addrId = modal.querySelector("#eAddr").value || null;

    const pos = state.positions.find((p) => p.id === posId);
    if (!pos) return toast("Выберите должность", "warn");

    const hours = calcHours(start, end, brk);
    const rate = Number(pos.rate) || 0;
    const amount = calcAmount(hours, rate);

    const user = await getCurrentUser();
    if (!user) return;

    const res = await safe(
      () =>
        supabase
          .from("shifts")
          .update({
            date,
            start_time: start,
            end_time: end,
            break_minutes: brk,
            hours,
            rate,
            amount,
            position_id: posId,
            address_id: addrId,
          })
          .eq("id", id)
          .eq("user_id", user.id),
      "update shift"
    );

    if (res.error) return toast("Не удалось сохранить", "danger");

    await logAction("shift_update", { id, amount, hours });
    toast("Смена обновлена", "ok");
    close();
    await loadHistory();
  });
}

// ------------------------------------------------------------
// Экспорт CSV
// ------------------------------------------------------------
function exportCSV() {
  const posMap = new Map(state.positions.map((p) => [p.id, p]));
  const addrMap = new Map(state.addresses.map((a) => [a.id, a]));
  const f = fifo(state.history.shifts, state.history.incomes);
  const fifoMap = new Map(f.shifts.map((s) => [s.id, s]));

  const rows = state.history.shifts.map((s) => ({
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

  const csv = toCSV(rows, [
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
  ]);

  downloadCSV(`shifts_${todayISO()}.csv`, csv);
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