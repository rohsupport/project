// ============================================================
// pages/admin.js
// Раздел «Администратор»: Логи | Ошибки | Решения | Данные | Система
// ============================================================
import {
  supabase,
  safe,
  getCurrentUser,
  logAction,
  formatMoney,
} from "../lib/supabase.js";
import { todayISO, formatDate } from "../lib/dates.js";
import {
  fifo,
  overdueShifts,
  detectIssues,
  toCSV,
  downloadCSV,
  round2,
} from "../lib/money.js";
import {
  countUnreadNotifications,
  subscribePush,
  showLocalNotification,
  getPushStatus,
} from "../lib/notify.js";
import { APP_VERSION, SUPABASE_URL, OVERDUE_DAYS, DEBUG } from "../config.js";
import { toast } from "../app.js";

// ------------------------------------------------------------
// Состояние
// ------------------------------------------------------------
const state = {
  tab: "logs", // logs | errors | decisions | data | system
  logs: [],
  errors: [],
  shifts: [],
  incomes: [],
  positions: [],
  addresses: [],
  notifications: [],
  issues: [],
  counts: { logs: 0, errors: 0, shifts: 0, incomes: 0, positions: 0, addresses: 0, notifications: 0 },
  push: { supported: false, subscribed: false, permission: "default" },
  loading: false,
};

let rootEl = null;

// ------------------------------------------------------------
// Загрузка
// ------------------------------------------------------------
async function loadLogs() {
  const user = await getCurrentUser();
  if (!user) return [];
  const res = await safe(
    () =>
      supabase
        .from("logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
    "load logs"
  );
  return res.data || [];
}

async function loadErrors() {
  const user = await getCurrentUser();
  if (!user) return [];
  const res = await safe(
    () =>
      supabase
        .from("errors")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
    "load errors"
  );
  return res.data || [];
}

async function loadEverything() {
  const user = await getCurrentUser();
  if (!user) return;

  state.loading = true;
  renderBody();

  const [logs, errs, shiftsRes, incRes, posRes, addrRes, notifRes, push] =
    await Promise.all([
      loadLogs(),
      loadErrors(),
      safe(
        () => supabase.from("shifts").select("*").eq("user_id", user.id).order("date", { ascending: true }),
        "load shifts"
      ),
      safe(
        () => supabase.from("incomes").select("*").eq("user_id", user.id).order("date", { ascending: true }),
        "load incomes"
      ),
      safe(
        () => supabase.from("positions").select("*").eq("user_id", user.id),
        "load positions"
      ),
      safe(
        () => supabase.from("addresses").select("*").eq("user_id", user.id),
        "load addresses"
      ),
      safe(
        () => supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        "load notifications"
      ),
      getPushStatus(),
    ]);

  state.logs = logs;
  state.errors = errs;
  state.shifts = shiftsRes.data || [];
  state.incomes = incRes.data || [];
  state.positions = posRes.data || [];
  state.addresses = addrRes.data || [];
  state.notifications = notifRes.data || [];
  state.push = push;

  state.counts = {
    logs: state.logs.length,
    errors: state.errors.length,
    shifts: state.shifts.length,
    incomes: state.incomes.length,
    positions: state.positions.length,
    addresses: state.addresses.length,
    notifications: state.notifications.length,
  };

  state.issues = detectIssues({
    shifts: state.shifts,
    incomes: state.incomes,
    positions: state.positions,
    addresses: state.addresses,
  });

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
        <h2>Администратор</h2>
        <p class="sub">Логи, ошибки, решения, данные и состояние системы</p>
      </div>
    </div>

    <div class="tabs" id="adTabs">
      <button class="tab ${state.tab === "logs" ? "active" : ""}" data-tab="logs">Логи</button>
      <button class="tab ${state.tab === "errors" ? "active" : ""}" data-tab="errors">Ошибки</button>
      <button class="tab ${state.tab === "decisions" ? "active" : ""}" data-tab="decisions">Решения</button>
      <button class="tab ${state.tab === "data" ? "active" : ""}" data-tab="data">Данные</button>
      <button class="tab ${state.tab === "system" ? "active" : ""}" data-tab="system">Система</button>
    </div>

    <div id="adBody"></div>
  `;

  rootEl.querySelector("#adTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    rootEl.querySelectorAll("#adTabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === state.tab)
    );
    renderBody();
  });

  await loadEverything();

  return () => {
    rootEl = null;
  };
}

function renderBody() {
  if (!rootEl) return;
  const box = rootEl.querySelector("#adBody");
  if (!box) return;

  if (state.loading) {
    box.innerHTML = `<div class="empty">Загрузка…</div>`;
    return;
  }

  switch (state.tab) {
    case "logs": renderLogs(box); break;
    case "errors": renderErrors(box); break;
    case "decisions": renderDecisions(box); break;
    case "data": renderData(box); break;
    case "system": renderSystem(box); break;
  }
}

// ============================================================
// ЛОГИ
// ============================================================
function renderLogs(box) {
  const rows = state.logs.length
    ? state.logs.map(
        (l) => `
      <tr>
        <td data-label="Время">${formatDateTime(l.created_at)}</td>
        <td data-label="Действие">${escapeHtml(l.action)}</td>
        <td data-label="Детали">${escapeHtml(JSON.stringify(l.details || {}))}</td>
      </tr>`
      ).join("")
    : `<tr><td colspan="3"><div class="empty">Логи пусты.</div></td></tr>`;

  box.innerHTML = `
    <div class="section">
      <div class="section-head">
        <h3>Логи действий</h3>
        <button class="btn btn-ghost btn-sm" id="adLogsClear">Очистить</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Время</th><th>Действие</th><th>Детали</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  box.querySelector("#adLogsClear").addEventListener("click", async () => {
    if (!confirm("Удалить все логи?")) return;
    const user = await getCurrentUser();
    if (!user) return;
    await safe(() => supabase.from("logs").delete().eq("user_id", user.id), "clear logs");
    toast("Логи очищены", "ok");
    await loadEverything();
  });
}

// ============================================================
// ОШИБКИ
// ============================================================
function renderErrors(box) {
  const rows = state.errors.length
    ? state.errors.map(
        (er) => `
      <tr>
        <td data-label="Время">${formatDateTime(er.created_at)}</td>
        <td data-label="Сообщение">${escapeHtml(er.message)}</td>
        <td data-label="Контекст">${escapeHtml(JSON.stringify(er.context || {}))}</td>
      </tr>`
      ).join("")
    : `<tr><td colspan="3"><div class="empty">Ошибок нет.</div></td></tr>`;

  box.innerHTML = `
    <div class="section">
      <div class="section-head">
        <h3>Журнал ошибок</h3>
        <button class="btn btn-ghost btn-sm" id="adErrClear">Очистить</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Время</th><th>Сообщение</th><th>Контекст</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  box.querySelector("#adErrClear").addEventListener("click", async () => {
    if (!confirm("Удалить все ошибки?")) return;
    const user = await getCurrentUser();
    if (!user) return;
    await safe(() => supabase.from("errors").delete().eq("user_id", user.id), "clear errors");
    toast("Ошибки очищены", "ok");
    await loadEverything();
  });
}

// ============================================================
// РЕШЕНИЯ
// ============================================================
function renderDecisions(box) {
  const issues = state.issues;
  const isSubscribed = state.push.subscribed;

  const items = issues.length
    ? issues.map(
        (i) => `
        <div class="analysis-item ${i.level}">
          <div class="ai-body">
            <div class="ai-title">${escapeHtml(i.message)}</div>
            ${i.level === "bad" ? `<div class="ai-sub">Рекомендация: внесите приход в разделе «Деньги».</div>` : ""}
            ${i.type === "no_positions" ? `<div class="ai-sub">Рекомендация: добавьте должность в «Справочниках».</div>` : ""}
            ${i.type === "due" ? `<div class="ai-sub">Рекомендация: проверьте, оплатили ли работу.</div>` : ""}
          </div>
        </div>`
      ).join("")
    : `<div class="analysis-item good"><div class="ai-body"><div class="ai-title">Проблем не обнаружено</div></div></div>`;

  box.innerHTML = `
    <div class="section">
      <div class="section-head">
        <h3>Наблюдения</h3>
        <span class="hint">${issues.length} пунктов</span>
      </div>
      <div class="analysis">${items}</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Действия администратора</h3>
      </div>
      <div class="card">
        <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:10px">
          <button class="btn btn-primary" id="adEnablePush" ${isSubscribed ? "disabled" : ""}>
            ${isSubscribed ? "Push включён" : "Включить push"}
          </button>
          <button class="btn btn-secondary" id="adTestPush" ${state.push.permission !== "granted" ? "disabled" : ""}>Тест push</button>
          <button class="btn btn-ghost" id="adCreateNotify">Создать уведомление</button>
        </div>
        <p class="muted small" style="margin-top:10px">
          Ежедневная проверка запускается на сервере (pg_cron в Supabase) и отправляет push через Edge Function.
          Если смена не записана, есть долг или просрочка — придёт уведомление.
          Порог просрочки: ${OVERDUE_DAYS} дней.
        </p>
      </div>
    </div>
  `;

  box.querySelector("#adEnablePush").addEventListener("click", async () => {
    const r = await subscribePush();
    if (!r.ok) return toast(r.error || "Не удалось включить", "danger");
    toast("Push включён", "ok");
    await loadEverything();
  });

  box.querySelector("#adTestPush").addEventListener("click", async () => {
    const ok = await showLocalNotification("Смены", "Проверка уведомлений");
    if (ok) toast("Отправлено", "ok");
    else toast("Разрешение не выдано", "warn");
  });

  box.querySelector("#adCreateNotify").addEventListener("click", () => {
    openCreateNotificationModal(async () => {
      await loadEverything();
    });
  });
}

function openCreateNotificationModal(onDone) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">Новое уведомление</div>
        <button class="modal-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <form class="form-grid" id="cnForm">
        <div class="field span-2">
          <label>Заголовок</label>
          <input type="text" id="cnTitle" maxlength="120" required />
        </div>
        <div class="field span-2">
          <label>Текст</label>
          <textarea id="cnBody" maxlength="500"></textarea>
        </div>
        <div class="field span-2">
          <label>Тип</label>
          <select id="cnType">
            <option value="info">Информация</option>
            <option value="warn">Предупреждение</option>
            <option value="bad">Проблема</option>
            <option value="good">Хорошо</option>
          </select>
        </div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" id="cnSave">Создать</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#cnSave").addEventListener("click", async () => {
    const title = modal.querySelector("#cnTitle").value.trim();
    const body = modal.querySelector("#cnBody").value.trim() || null;
    const type = modal.querySelector("#cnType").value;
    if (!title) return toast("Введите заголовок", "warn");

    const user = await getCurrentUser();
    if (!user) return;

    const res = await safe(
      () =>
        supabase.from("notifications").insert({
          user_id: user.id,
          title,
          body,
          type,
        }),
      "create notification"
    );
    if (res.error) return toast("Не удалось создать", "danger");
    await logAction("notification_create", { title });
    toast("Уведомление создано", "ok");
    close();
    onDone?.();
  });
}

// ============================================================
// ДАННЫЕ
// ============================================================
function renderData(box) {
  const c = state.counts;
  box.innerHTML = `
    <div class="section">
      <div class="section-head">
        <h3>Счётчики</h3>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Смены</div><div class="stat-value">${c.shifts}</div></div>
        <div class="stat"><div class="stat-label">Приходы</div><div class="stat-value">${c.incomes}</div></div>
        <div class="stat"><div class="stat-label">Должности</div><div class="stat-value">${c.positions}</div></div>
        <div class="stat"><div class="stat-label">Адреса</div><div class="stat-value">${c.addresses}</div></div>
        <div class="stat"><div class="stat-label">Уведомления</div><div class="stat-value">${c.notifications}</div></div>
        <div class="stat"><div class="stat-label">Логи</div><div class="stat-value">${c.logs}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Экспорт</h3>
      </div>
      <div class="card">
        <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:10px">
          <button class="btn btn-primary" id="adExportJSON">Скачать JSON (всё)</button>
          <button class="btn btn-secondary" id="adExportShiftsCSV">Смены CSV</button>
          <button class="btn btn-secondary" id="adExportIncomesCSV">Приходы CSV</button>
        </div>
        <p class="muted small" style="margin-top:10px">
          JSON содержит все данные текущего пользователя и может быть использован для резервной копии.
        </p>
      </div>
    </div>
  `;

  box.querySelector("#adExportJSON").addEventListener("click", () => {
    const payload = {
      generated_at: new Date().toISOString(),
      version: APP_VERSION,
      shifts: state.shifts,
      incomes: state.incomes,
      positions: state.positions,
      addresses: state.addresses,
      notifications: state.notifications,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  box.querySelector("#adExportShiftsCSV").addEventListener("click", () => {
    const rows = state.shifts.map((s) => ({
      number: `${s.month_no}.${s.shift_no}`,
      date: s.date,
      start: s.start_time,
      end: s.end_time,
      hours: Number(s.hours).toFixed(2),
      rate: Number(s.rate).toFixed(2),
      amount: Number(s.amount).toFixed(2),
    }));
    downloadCSV(`shifts_${todayISO()}.csv`, toCSV(rows, [
      { key: "number", label: "№" },
      { key: "date", label: "Дата" },
      { key: "start", label: "Начало" },
      { key: "end", label: "Конец" },
      { key: "hours", label: "Часы" },
      { key: "rate", label: "Ставка" },
      { key: "amount", label: "Сумма" },
    ]));
  });

  box.querySelector("#adExportIncomesCSV").addEventListener("click", () => {
    const rows = state.incomes.map((i) => ({
      date: i.date,
      amount: Number(i.amount).toFixed(2),
      note: i.note || "",
    }));
    downloadCSV(`incomes_${todayISO()}.csv`, toCSV(rows, [
      { key: "date", label: "Дата" },
      { key: "amount", label: "Сумма" },
      { key: "note", label: "Заметка" },
    ]));
  });
}

// ============================================================
// СИСТЕМА
// ============================================================
function renderSystem(box) {
  const fifoRes = fifo(state.shifts, state.incomes);
  const overdue = overdueShifts(fifoRes.shifts);

  box.innerHTML = `
    <div class="section">
      <div class="section-head"><h3>Окружение</h3></div>
      <div class="card">
        <div class="list">
          <div class="list-row"><div class="row-main"><div class="row-title">Версия приложения</div></div><div class="row-value">${APP_VERSION}</div></div>
          <div class="list-row"><div class="row-main"><div class="row-title">Supabase URL</div><div class="row-meta">${escapeHtml(SUPABASE_URL)}</div></div></div>
          <div class="list-row"><div class="row-main"><div class="row-title">Онлайн</div></div><div class="row-value">${navigator.onLine ? "да" : "нет"}</div></div>
          <div class="list-row"><div class="row-main"><div class="row-title">User agent</div><div class="row-meta">${escapeHtml(navigator.userAgent)}</div></div></div>
          <div class="list-row"><div class="row-main"><div class="row-title">Push</div></div><div class="row-value">${state.push.supported ? (state.push.subscribed ? "включён" : "выключен") : "не поддерживается"}</div></div>
          <div class="list-row"><div class="row-main"><div class="row-title">Порог просрочки</div></div><div class="row-value">${OVERDUE_DAYS} дней</div></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Показатели</h3></div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Начислено</div><div class="stat-value">${formatMoney(
          state.shifts.reduce((a, s) => a + (Number(s.amount) || 0), 0)
        )}</div></div>
        <div class="stat"><div class="stat-label">Пришло</div><div class="stat-value">${formatMoney(
          state.incomes.reduce((a, i) => a + (Number(i.amount) || 0), 0)
        )}</div></div>
        <div class="stat accent"><div class="stat-label">К выплате</div><div class="stat-value">${formatMoney(
          Math.max(0, state.shifts.reduce((a, s) => a + (Number(s.amount) || 0), 0) - state.incomes.reduce((a, i) => a + (Number(i.amount) || 0), 0))
        )}</div></div>
        <div class="stat"><div class="stat-label">Просрочено</div><div class="stat-value">${overdue.length}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Проверка целостности</h3></div>
      <div class="card">
        <button class="btn btn-secondary" id="adCheckIntegrity">Проверить</button>
        <div id="adIntegrityResult" class="muted small" style="margin-top:10px"></div>
      </div>
    </div>
  `;

  box.querySelector("#adCheckIntegrity").addEventListener("click", async () => {
    const out = box.querySelector("#adIntegrityResult");
    out.textContent = "Проверка…";
    const issues = detectIssues({
      shifts: state.shifts,
      incomes: state.incomes,
      positions: state.positions,
      addresses: state.addresses,
    });
    if (issues.length === 0) {
      out.textContent = "Данные корректны.";
    } else {
      out.innerHTML = issues.map((i) => `• ${escapeHtml(i.message)}`).join("<br>");
    }
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

function formatDateTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${formatDate(date)} · ${time}`;
  } catch {
    return iso;
  }
}