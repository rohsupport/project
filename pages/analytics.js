// ============================================================
// pages/analytics.js
// Раздел «Аналитика»: графики Chart.js
// ============================================================
import {
  supabase,
  safe,
  getCurrentUser,
  formatMoney,
} from "../lib/supabase.js";
import {
  todayISO,
  periodRange,
  inRange,
  periodLabel,
  lastPeriods,
} from "../lib/dates.js";
import {
  groupByPosition,
  groupByAddress,
  groupByDay,
  seriesByPeriods,
  dueDynamics,
} from "../lib/money.js";
import { DEFAULT_CURRENCY, DEBUG } from "../config.js";
import { toast } from "../app.js";

// ------------------------------------------------------------
// Chart.js через CDN (подгружаем один раз)
// ------------------------------------------------------------
const CHART_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
let chartLibPromise = null;

function loadChartLib() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartLibPromise) return chartLibPromise;
  chartLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHART_CDN;
    s.async = true;
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error("Chart.js failed to load"));
    document.head.appendChild(s);
  });
  return chartLibPromise;
}

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

  granularity: "day", // для графиков 5 и 6: "week" | "month"
  loading: false,
};

let rootEl = null;
const chartInstances = new Map();
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
      () => supabase.from("positions").select("*").eq("user_id", user.id).order("name"),
      "load positions"
    ),
    safe(
      () => supabase.from("addresses").select("*").eq("user_id", user.id).order("label"),
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
        <h2>Аналитика</h2>
        <p class="sub">Графики заработка, часов и долга</p>
      </div>
    </div>

    <div class="filters" id="anFilters">
      <div class="field-inline">
        <label>Период</label>
        <select id="anType">
          <option value="day">День</option>
          <option value="week">Неделя</option>
          <option value="month" selected>Месяц</option>
          <option value="custom">Произвольный</option>
          <option value="all">Всё время</option>
        </select>
      </div>
      <div class="field-inline" id="anCustom" style="display:none">
        <input type="date" id="anFrom" />
        <span>—</span>
        <input type="date" id="anTo" />
      </div>
      <div class="field-inline">
        <label>Разбивка</label>
        <select id="anGran">
          <option value="day">По дням</option>
          <option value="week">По неделям</option>
          <option value="month">По месяцам</option>
        </select>
      </div>
    </div>

    <div id="anBody"></div>
  `;

  bindFilters();
  await loadAll();

  try {
    const user = await getCurrentUser();
    if (user) {
      unsubShifts = supabase
        .channel("analytics-shifts-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shifts", filter: `user_id=eq.${user.id}` },
          () => loadAll()
        )
        .subscribe();
      unsubIncomes = supabase
        .channel("analytics-incomes-rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incomes", filter: `user_id=eq.${user.id}` },
          () => loadAll()
        )
        .subscribe();
    }
  } catch (e) {
    if (DEBUG) console.warn("realtime analytics failed:", e);
  }

  return () => {
    destroyAllCharts();
    try {
      if (unsubShifts) supabase.removeChannel(unsubShifts);
      if (unsubIncomes) supabase.removeChannel(unsubIncomes);
    } catch { /* ignore */ }
    unsubShifts = null;
    unsubIncomes = null;
  };
}

function bindFilters() {
  const type = rootEl.querySelector("#anType");
  const custom = rootEl.querySelector("#anCustom");
  const from = rootEl.querySelector("#anFrom");
  const to = rootEl.querySelector("#anTo");
  const gran = rootEl.querySelector("#anGran");

  type.value = state.filter.type;
  from.value = state.filter.from;
  to.value = state.filter.to;
  gran.value = state.granularity;
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
  gran.addEventListener("change", () => {
    state.granularity = gran.value;
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
  const box = rootEl.querySelector("#anBody");
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

  if (shifts.length === 0 && incomes.length === 0) {
    box.innerHTML = `<div class="empty">Нет данных за выбранный период.</div>`;
    return;
  }

  box.innerHTML = `
    <p class="rp-period">Период: <b>${escapeHtml(periodLabel(state.filter.type, from, to))}</b></p>
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-head"><div class="chart-title">Заработок по дням</div></div>
        <div class="chart-canvas-wrap"><canvas id="chAmountDay"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head"><div class="chart-title">Часы по дням</div></div>
        <div class="chart-canvas-wrap"><canvas id="chHoursDay"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head"><div class="chart-title">По должностям</div></div>
        <div class="chart-canvas-wrap"><canvas id="chPos"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head"><div class="chart-title">По адресам</div></div>
        <div class="chart-canvas-wrap"><canvas id="chAddr"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head">
          <div class="chart-title">Начислено vs Пришло</div>
          <div class="chart-sub">${state.granularity === "day" ? "по дням" : state.granularity === "week" ? "по неделям" : "по месяцам"}</div>
        </div>
        <div class="chart-canvas-wrap"><canvas id="chAccruedPaid"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head">
          <div class="chart-title">Динамика долга</div>
          <div class="chart-sub">на конец периода</div>
        </div>
        <div class="chart-canvas-wrap"><canvas id="chDue"></canvas></div>
      </div>
    </div>
  `;

  drawCharts({ shifts, incomes });
}

// ------------------------------------------------------------
// Отрисовка графиков
// ------------------------------------------------------------
async function drawCharts({ shifts, incomes }) {
  let Chart;
  try {
    Chart = await loadChartLib();
  } catch {
    toast("Не удалось загрузить библиотеку графиков", "danger");
    return;
  }

  destroyAllCharts();

  const css = getComputedStyle(document.documentElement);
  const textColor = css.getPropertyValue("--text").trim() || "#000";
  const muteColor = css.getPropertyValue("--text-mute").trim() || "#888";
  const borderColor = css.getPropertyValue("--border").trim() || "#eee";
  const accent = css.getPropertyValue("--accent").trim() || "#000";

  Chart.defaults.font.family = "Inter, sans-serif";
  Chart.defaults.color = muteColor;
  Chart.defaults.borderColor = borderColor;
  Chart.defaults.font.size = 11;

  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: accent,
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: muteColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
      },
      y: {
        beginAtZero: true,
        grid: { color: borderColor },
        ticks: { color: muteColor },
      },
    },
  };

  // 1. Заработок по дням
  const byDay = groupByDay(shifts);
  drawBar("chAmountDay", Chart, byDay.map((d) => shortDate(d.date)), byDay.map((d) => d.amount), accent, baseOpts, (v) => formatMoney(v, state.currency));

  // 2. Часы по дням
  drawBar("chHoursDay", Chart, byDay.map((d) => shortDate(d.date)), byDay.map((d) => d.hours), accent, baseOpts, (v) => `${Number(v).toFixed(2)} ч`);

  // 3. По должностям (doughnut)
  const byPos = groupByPosition(shifts, state.positions);
  drawDoughnut("chPos", Chart, byPos.map((p) => p.name), byPos.map((p) => p.amount), baseOpts, state.currency);

  // 4. По адресам (doughnut)
  const byAddr = groupByAddress(shifts, state.addresses);
  drawDoughnut("chAddr", Chart, byAddr.map((a) => a.label), byAddr.map((a) => a.amount), baseOpts, state.currency);

  // 5. Начислено vs Пришло (grouped bar)
  const periods = lastPeriods(state.granularity, 12);
  const series = seriesByPeriods(state.shifts, state.incomes, periods);
  drawGrouped("chAccruedPaid", Chart, series, baseOpts, state.currency);

  // 6. Динамика долга (line)
  const dueSeries = dueDynamics(state.shifts, state.incomes, periods);
  drawLine("chDue", Chart, dueSeries.map((d) => d.label), dueSeries.map((d) => d.due), baseOpts, state.currency);
}

function drawBar(id, Chart, labels, data, color, opts, tooltipFmt) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const inst = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: color,
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: {
          ...opts.plugins.tooltip,
          callbacks: { label: (ctx) => tooltipFmt(ctx.parsed.y) },
        },
      },
    },
  });
  chartInstances.set(id, inst);
}

function drawDoughnut(id, Chart, labels, data, opts, currency) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const palette = [
    "#0b0b0c", "#3a3a40", "#5c5c63", "#8a8a92", "#b4b4ba",
    "#2c5fa8", "#1e874b", "#b8860b", "#c0392b", "#6b4fa8",
  ];
  const inst = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: labels.length ? labels : ["—"],
      datasets: [
        {
          data: data.length ? data : [1],
          backgroundColor: palette.slice(0, Math.max(1, labels.length)),
          borderWidth: 2,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue("--bg-elevated").trim() || "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 8, boxHeight: 8, padding: 10 } },
        tooltip: {
          ...opts.plugins.tooltip,
          displayColors: false,
          callbacks: { label: (ctx) => `${ctx.label}: ${formatMoney(ctx.parsed, currency)}` },
        },
      },
    },
  });
  chartInstances.set(id, inst);
}

function drawGrouped(id, Chart, series, opts, currency) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const inst = new Chart(canvas, {
    type: "bar",
    data: {
      labels: series.map((s) => s.label),
      datasets: [
        { label: "Начислено", data: series.map((s) => s.amount), backgroundColor: "#5c5c63", borderRadius: 4, maxBarThickness: 18 },
        { label: "Пришло", data: series.map((s) => s.paid), backgroundColor: "#1e874b", borderRadius: 4, maxBarThickness: 18 },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        legend: { display: true, position: "bottom", labels: { boxWidth: 8, boxHeight: 8, padding: 10 } },
        tooltip: {
          ...opts.plugins.tooltip,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y, currency)}`,
          },
        },
      },
    },
  });
  chartInstances.set(id, inst);
}

function drawLine(id, Chart, labels, data, opts, currency) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const inst = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: "#c0392b",
          backgroundColor: "rgba(192,57,43,0.08)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: "#c0392b",
        },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: {
          ...opts.plugins.tooltip,
          callbacks: { label: (ctx) => formatMoney(ctx.parsed.y, currency) },
        },
      },
    },
  });
  chartInstances.set(id, inst);
}

function destroyAllCharts() {
  for (const [id, inst] of chartInstances) {
    try { inst.destroy(); } catch { /* ignore */ }
    chartInstances.delete(id);
  }
}

// ------------------------------------------------------------
// Хелперы
// ------------------------------------------------------------
function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}