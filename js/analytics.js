// ============================================================
// Аналитика: 4 графика на Chart.js + RPC + select
// ============================================================
(function () {
  let charts = { complaints: null, load: null, statuses: null, top5: null };
  let periodSelect;

  const BRAND = '#2563eb';
  const BRAND2 = '#3b82f6';
  const OK = '#16a34a';
  const WARN = '#f59e0b';
  const ERR = '#dc2626';
  const MUTED = '#64748b';
  const INFO = '#0ea5e9';

  // создаём canvas-wrap контейнер
  function chartCard(titleText) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    const h = document.createElement('h3');
    h.textContent = titleText;
    const wrap = document.createElement('div');
    wrap.className = 'canvas-wrap';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    card.appendChild(h);
    card.appendChild(wrap);
    return { card, canvas };
  }

  // общие настройки Chart.js для тёмной темы
  const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#e2e8f0' } },
      tooltip: { enabled: true }
    },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.15)' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.15)' } }
    }
  };

  // --- График 1: жалобы по дням ---
  async function drawComplaints(refs, days) {
    const { data, error } = await window.sb.rpc('analytics_complaints_by_day', { days });
    if (error) { UI.toast(error.message, 'err'); return; }
    const labels = (data || []).map(r => {
      const d = new Date(r.day);
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    });
    const values = (data || []).map(r => Number(r.count));
    if (charts.complaints) charts.complaints.destroy();
    charts.complaints = new Chart(refs.canvasComplaints, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Жалобы',
          data: values,
          borderColor: BRAND2,
          backgroundColor: 'rgba(59,130,246,.18)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        }]
      },
      options: CHART_DEFAULTS
    });
  }

  // --- График 2: загруженность маршрутов ---
  async function drawLoad(refs) {
    const { data, error } = await window.sb.rpc('analytics_load_by_route');
    if (error) { UI.toast(error.message, 'err'); return; }
    const labels = (data || []).map(r => r.route_name);
    const values = (data || []).map(r => Number(r.trips_count));
    if (charts.load) charts.load.destroy();
    charts.load = new Chart(refs.canvasLoad, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Рейсов',
          data: values,
          backgroundColor: BRAND,
          borderRadius: 6
        }]
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: { legend: { display: false } }
      }
    });
  }

  // --- График 3: жалобы по статусам ---
  async function drawStatuses(refs) {
    const { data, error } = await window.sb
      .from('complaints')
      .select('status');
    if (error) { UI.toast(error.message, 'err'); return; }
    const counts = { new: 0, in_progress: 0, resolved: 0, rejected: 0 };
    (data || []).forEach(r => {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });
    const labels = ['Новые', 'В работе', 'Решены', 'Отклонены'];
    const values = [counts.new, counts.in_progress, counts.resolved, counts.rejected];
    const bg = [INFO, WARN, OK, MUTED];
    if (charts.statuses) charts.statuses.destroy();
    charts.statuses = new Chart(refs.canvasStatuses, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: bg, borderColor: '#111827', borderWidth: 2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e2e8f0' } } }
      }
    });
  }

  // --- График 4: топ-5 маршрутов по жалобам ---
  async function drawTop5(refs) {
    const { data, error } = await window.sb
      .from('complaints')
      .select('route_id, routes:route_id(name, code)');
    if (error) { UI.toast(error.message, 'err'); return; }
    const byRoute = {};
    (data || []).forEach(r => {
      if (!r.routes) return;
      const key = `${r.routes.code} — ${r.routes.name}`;
      byRoute[key] = (byRoute[key] || 0) + 1;
    });
    const sorted = Object.entries(byRoute)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const labels = sorted.map(([k]) => k);
    const values = sorted.map(([, v]) => v);

    if (charts.top5) charts.top5.destroy();
    charts.top5 = new Chart(refs.canvasTop5, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Жалоб',
          data: values,
          backgroundColor: ERR,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        ...CHART_DEFAULTS,
        plugins: { legend: { display: false } }
      }
    });
  }

  // Главный
  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Аналитика',
      profile,
      active: 'analytics.html'
    });

    // фильтр периода
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Период (дней)</label>`;
    periodSelect = document.createElement('select');
    periodSelect.innerHTML = `
      <option value="7">7</option>
      <option value="30" selected>30</option>
      <option value="90">90</option>`;
    f1.appendChild(periodSelect);
    toolbar.appendChild(f1);
    content.appendChild(toolbar);

    // сетка графиков
    const grid = document.createElement('div');
    grid.className = 'chart-grid';

    const c1 = chartCard('Жалобы по дням');
    const c2 = chartCard('Загруженность маршрутов (рейсов)');
    const c3 = chartCard('Жалобы по статусам');
    const c4 = chartCard('Топ-5 маршрутов по жалобам');

    grid.appendChild(c1.card);
    grid.appendChild(c2.card);
    grid.appendChild(c3.card);
    grid.appendChild(c4.card);
    content.appendChild(grid);

    const refs = {
      canvasComplaints: c1.canvas,
      canvasLoad: c2.canvas,
      canvasStatuses: c3.canvas,
      canvasTop5: c4.canvas
    };

    // рендер всех графиков
    async function renderAll() {
      const days = Number(periodSelect.value);
      try {
        await Promise.all([
          drawComplaints(refs, days),
          drawLoad(refs),
          drawStatuses(refs),
          drawTop5(refs)
        ]);
      } catch (e) {
        UI.toast(e.message || 'Ошибка графиков', 'err');
      }
    }

    periodSelect.addEventListener('change', renderAll);
    await renderAll();
  }

  document.addEventListener('DOMContentLoaded', main);
})();