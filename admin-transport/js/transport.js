// ============================================================
// Транспорт: CRUD + фильтры + realtime
// ============================================================
(function () {
  let allTransport = [];
  let routesList = [];
  let driversList = [];
  let channel = null;
  let tbody, emptyEl, countEl, filterStatus, filterSearch;

  const STATUS_LABELS = {
    active: ['Активен', 'ok'],
    maintenance: ['Обслуживание', 'warn'],
    inactive: ['Неактивен', 'err']
  };

  // загрузка справочников и списка
  async function load() {
    const [t, r, d] = await Promise.all([
      window.sb.from('transport').select(`
        id, board_number, model, capacity, route_id, driver_id, status, created_at,
        routes:route_id (id, code, name),
        drivers:driver_id (id, full_name)
      `).order('board_number'),
      window.sb.from('routes').select('id,code,name').order('code'),
      window.sb.from('drivers').select('id,full_name').order('full_name')
    ]);
    if (t.error) { UI.toast(t.error.message, 'err'); return; }
    if (r.error) { UI.toast(r.error.message, 'err'); return; }
    if (d.error) { UI.toast(d.error.message, 'err'); return; }
    allTransport = t.data || [];
    routesList = r.data || [];
    driversList = d.data || [];
    applyFilter();
  }

  function applyFilter() {
    const st = filterStatus.value;
    const q = filterSearch.value.trim().toLowerCase();
    const filtered = allTransport.filter(x => {
      if (st !== 'all' && x.status !== st) return false;
      if (q && !(x.board_number || '').toLowerCase().includes(q)) return false;
      return true;
    });
    countEl.textContent = `Найдено: ${filtered.length}`;
    renderTable(filtered);
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    list.forEach(t => tbody.appendChild(row(t)));
  }

  function row(t) {
    const tr = document.createElement('tr');
    const tdNum = document.createElement('td'); tdNum.textContent = t.board_number;
    const tdModel = document.createElement('td'); tdModel.textContent = t.model;
    const tdCap = document.createElement('td'); tdCap.textContent = t.capacity;

    const tdRoute = document.createElement('td');
    tdRoute.textContent = t.routes ? `${t.routes.code} — ${t.routes.name}` : '—';

    const tdDriver = document.createElement('td');
    tdDriver.textContent = t.drivers ? t.drivers.full_name : '—';

    const tdStatus = document.createElement('td');
    const [label, kind] = STATUS_LABELS[t.status] || [t.status, 'muted'];
    tdStatus.appendChild(UI.badge(label, kind));

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm';
    editBtn.textContent = 'Редактировать';
    editBtn.addEventListener('click', () => openModal(t));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteRow(t));
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdNum);
    tr.appendChild(tdModel);
    tr.appendChild(tdCap);
    tr.appendChild(tdRoute);
    tr.appendChild(tdDriver);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAct);
    return tr;
  }

  async function deleteRow(t) {
    if (!confirm(`Удалить транспорт ${t.board_number}?`)) return;
    try {
      const { count } = await window.sb
        .from('schedules')
        .select('id', { count: 'exact', head: true })
        .eq('transport_id', t.id);
      if ((count || 0) > 0) {
        if (!confirm(`Транспорт связан с ${count} рейсом(ами). Удалить? Связи обнулятся.`)) return;
      }
      const { error } = await window.sb.from('transport').delete().eq('id', t.id);
      if (error) throw error;
      UI.toast('Транспорт удалён', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    }
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function openModal(existing) {
    const isEdit = !!existing;
    const m = UI.createModal({ title: isEdit ? 'Редактировать транспорт' : 'Новый транспорт' });

    const routeOpts = `<option value="">— не назначен —</option>` +
      routesList.map(r =>
        `<option value="${r.id}" ${existing && existing.route_id === r.id ? 'selected' : ''}>${escapeHtml(r.code + ' — ' + r.name)}</option>`
      ).join('');

    const driverOpts = `<option value="">— не назначен —</option>` +
      driversList.map(d =>
        `<option value="${d.id}" ${existing && existing.driver_id === d.id ? 'selected' : ''}>${escapeHtml(d.full_name)}</option>`
      ).join('');

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Бортовой номер *</label>
        <input name="board_number" required maxlength="50"
               value="${existing ? escapeAttr(existing.board_number) : ''}" />
      </div>
      <div class="field">
        <label>Модель *</label>
        <input name="model" required maxlength="120"
               value="${existing ? escapeAttr(existing.model) : ''}" />
      </div>
      <div class="field">
        <label>Вместимость</label>
        <input name="capacity" type="number" min="0" value="${existing ? existing.capacity : 0}" />
      </div>
      <div class="field">
        <label>Маршрут</label>
        <select name="route_id">${routeOpts}</select>
      </div>
      <div class="field">
        <label>Водитель</label>
        <select name="driver_id">${driverOpts}</select>
      </div>
      <div class="field">
        <label>Статус</label>
        <select name="status">
          <option value="active" ${!existing || existing.status === 'active' ? 'selected' : ''}>Активен</option>
          <option value="maintenance" ${existing && existing.status === 'maintenance' ? 'selected' : ''}>Обслуживание</option>
          <option value="inactive" ${existing && existing.status === 'inactive' ? 'selected' : ''}>Неактивен</option>
        </select>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand" id="save-btn">Сохранить</button>
      </div>`;
    m.body.appendChild(form);
    form.querySelector('#cancel-btn').addEventListener('click', m.close);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const cap = parseInt(fd.get('capacity') || '0', 10);
      const payload = {
        board_number: String(fd.get('board_number') || '').trim(),
        model: String(fd.get('model') || '').trim(),
        capacity: Number.isFinite(cap) ? cap : 0,
        route_id: fd.get('route_id') || null,
        driver_id: fd.get('driver_id') || null,
        status: fd.get('status') || 'active'
      };
      if (!payload.board_number || !payload.model) {
        UI.toast('Заполните обязательные поля', 'err');
        return;
      }
      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        if (isEdit) {
          const { error } = await window.sb.from('transport').update(payload).eq('id', existing.id);
          if (error) throw error;
          UI.toast('Транспорт обновлён', 'ok');
        } else {
          const { error } = await window.sb.from('transport').insert(payload);
          if (error) throw error;
          UI.toast('Транспорт создан', 'ok');
        }
        m.close();
        await load();
      } catch (err) {
        const msg = String(err.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          UI.toast('Бортовой номер уже используется', 'err');
        } else {
          UI.toast(err.message || 'Ошибка', 'err');
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
      }
    });
  }

  function setupRealtime() {
    channel = window.sb.channel('transport-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport' }, () => load())
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Транспорт',
      profile,
      active: 'transport.html'
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--brand';
    addBtn.textContent = '➕ Добавить транспорт';
    addBtn.addEventListener('click', () => openModal(null));

    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Статус</label>`;
    filterStatus = document.createElement('select');
    filterStatus.innerHTML = `
      <option value="all">Все</option>
      <option value="active">Активен</option>
      <option value="maintenance">Обслуживание</option>
      <option value="inactive">Неактивен</option>`;
    f1.appendChild(filterStatus);

    const f2 = document.createElement('div');
    f2.className = 'field field--grow';
    f2.innerHTML = `<label>Поиск по бортовому номеру</label>`;
    filterSearch = document.createElement('input');
    filterSearch.placeholder = 'Например, А-001';
    f2.appendChild(filterSearch);

    countEl = document.createElement('span');
    countEl.className = 'muted';

    toolbar.appendChild(addBtn);
    toolbar.appendChild(f1);
    toolbar.appendChild(f2);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Бортовой №</th><th>Модель</th><th>Вместимость</th><th>Маршрут</th><th>Водитель</th><th>Статус</th><th>Действия</th>
          </tr>
        </thead>
        <tbody id="transport-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Транспорта нет';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#transport-tbody');

    filterStatus.addEventListener('change', applyFilter);
    filterSearch.addEventListener('input', UI.debounce(applyFilter, 300));

    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();