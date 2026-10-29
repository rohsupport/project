// ============================================================
// Аудит (только admin): фильтры + пагинация
// ============================================================
(function () {
  let tbody, emptyEl, countEl, pagerEl, fTable, fAction, fFrom, fTo, fAdmin;
  let adminsList = [];
  const PAGE_SIZE = 50;
  let page = 0;
  let totalRows = 0;

  async function loadAdmins() {
    const { data, error } = await window.sb
      .from('profiles')
      .select('id,full_name,role')
      .in('role', ['admin', 'dispatcher', 'manager'])
      .order('full_name');
    if (error) { UI.toast(error.message, 'err'); return; }
    adminsList = data || [];
    fAdmin.innerHTML = `<option value="">Все администраторы</option>` +
      adminsList.map(a => `<option value="${a.id}">${escapeHtml(a.full_name || a.id.slice(0,8))}</option>`).join('');
  }

  // построение запроса с фильтрами
  function buildQuery() {
    let q = window.sb.from('audit_log').select(`
      id, action, table_name, record_id, payload, created_at, admin_id,
      profiles:admin_id (id, full_name, role)
    `, { count: 'exact' });

    if (fTable.value) q = q.eq('table_name', fTable.value);
    if (fAction.value) q = q.eq('action', fAction.value);
    if (fFrom.value) q = q.gte('created_at', fFrom.value + 'T00:00:00');
    if (fTo.value) q = q.lte('created_at', fTo.value + 'T23:59:59');
    if (fAdmin.value) q = q.eq('admin_id', fAdmin.value);

    q = q.order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    return q;
  }

  async function load() {
    tbody.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="6"><span class="spinner"></span></td></tr>';
    try {
      const { data, error, count } = await buildQuery();
      if (error) throw error;
      totalRows = count || 0;
      renderTable(data || []);
      renderPager();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
      tbody.innerHTML = '';
    }
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    list.forEach(a => tbody.appendChild(row(a)));
  }

  function row(a) {
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td');
    tdDate.textContent = UI.fmtDate(a.created_at);
    const tdAdmin = document.createElement('td');
    tdAdmin.textContent = a.profiles ? a.profiles.full_name : '—';

    const tdAction = document.createElement('td');
    const actMap = { INSERT: ['Добавление', 'ok'], UPDATE: ['Изменение', 'warn'], DELETE: ['Удаление', 'err'] };
    const [label, kind] = actMap[a.action] || [a.action, 'muted'];
    tdAction.appendChild(UI.badge(label, kind));

    const tdTable = document.createElement('td');
    tdTable.textContent = a.table_name;

    const tdRec = document.createElement('td');
    const rec = a.record_id ? String(a.record_id) : '';
    tdRec.textContent = rec ? rec.slice(0, 8) + '…' : '—';
    tdRec.title = rec;

    const tdPayload = document.createElement('td');
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'Показать';
    sum.style.cursor = 'pointer';
    sum.style.color = 'var(--brand-2)';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(a.payload, null, 2);
    det.appendChild(sum);
    det.appendChild(pre);
    tdPayload.appendChild(det);

    tr.appendChild(tdDate);
    tr.appendChild(tdAdmin);
    tr.appendChild(tdAction);
    tr.appendChild(tdTable);
    tr.appendChild(tdRec);
    tr.appendChild(tdPayload);
    return tr;
  }

  function renderPager() {
    pagerEl.innerHTML = '';
    const from = totalRows === 0 ? 0 : page * PAGE_SIZE + 1;
    const to = Math.min((page + 1) * PAGE_SIZE, totalRows);
    const info = document.createElement('span');
    info.className = 'muted';
    info.textContent = `${from}–${to} из ${totalRows}`;

    const prev = document.createElement('button');
    prev.className = 'btn btn--sm';
    prev.textContent = '← Назад';
    prev.disabled = page === 0;
    prev.addEventListener('click', () => { if (page > 0) { page--; load(); } });

    const next = document.createElement('button');
    next.className = 'btn btn--sm';
    next.textContent = 'Вперёд →';
    next.disabled = (page + 1) * PAGE_SIZE >= totalRows;
    next.addEventListener('click', () => {
      if ((page + 1) * PAGE_SIZE < totalRows) { page++; load(); }
    });

    pagerEl.appendChild(prev);
    pagerEl.appendChild(info);
    pagerEl.appendChild(next);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff({ admin: true })); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Журнал действий',
      profile,
      active: 'audit.html'
    });

    // фильтры
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Таблица</label>`;
    fTable = document.createElement('select');
    fTable.innerHTML = `
      <option value="">Все</option>
      <option value="routes">routes</option>
      <option value="transport">transport</option>
      <option value="drivers">drivers</option>
      <option value="profiles">profiles</option>
      <option value="notifications">notifications</option>
      <option value="complaints">complaints</option>`;
    f1.appendChild(fTable);

    const f2 = document.createElement('div');
    f2.className = 'field';
    f2.innerHTML = `<label>Действие</label>`;
    fAction = document.createElement('select');
    fAction.innerHTML = `
      <option value="">Все</option>
      <option value="INSERT">INSERT</option>
      <option value="UPDATE">UPDATE</option>
      <option value="DELETE">DELETE</option>`;
    f2.appendChild(fAction);

    const f3 = document.createElement('div');
    f3.className = 'field';
    f3.innerHTML = `<label>Дата с</label>`;
    fFrom = document.createElement('input');
    fFrom.type = 'date';
    f3.appendChild(fFrom);

    const f4 = document.createElement('div');
    f4.className = 'field';
    f4.innerHTML = `<label>Дата по</label>`;
    fTo = document.createElement('input');
    fTo.type = 'date';
    f4.appendChild(fTo);

    const f5 = document.createElement('div');
    f5.className = 'field';
    f5.innerHTML = `<label>Администратор</label>`;
    fAdmin = document.createElement('select');
    f5.appendChild(fAdmin);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn--brand';
    applyBtn.textContent = 'Применить';
    applyBtn.addEventListener('click', () => { page = 0; load(); });

    toolbar.appendChild(f1);
    toolbar.appendChild(f2);
    toolbar.appendChild(f3);
    toolbar.appendChild(f4);
    toolbar.appendChild(f5);
    toolbar.appendChild(applyBtn);
    content.appendChild(toolbar);

    countEl = document.createElement('div');
    countEl.className = 'muted';
    countEl.style.marginBottom = '8px';
    content.appendChild(countEl);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Дата</th><th>Админ</th><th>Действие</th><th>Таблица</th><th>Record ID</th><th>Payload</th></tr>
        </thead>
        <tbody id="audit-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Записей нет';
    wrap.appendChild(emptyEl);

    pagerEl = document.createElement('div');
    pagerEl.className = 'pagination';
    wrap.appendChild(pagerEl);

    content.appendChild(wrap);
    tbody = wrap.querySelector('#audit-tbody');

    await loadAdmins();
    await load();
  }

  document.addEventListener('DOMContentLoaded', main);
})();