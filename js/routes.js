// ============================================================
// Маршруты: CRUD + модалка + фильтры + realtime
// ============================================================
(function () {
  let allRoutes = [];
  let channel = null;
  let tbody, emptyEl, countEl, filterStatus, filterSearch;

  // загрузка списка
  async function load() {
    const { data, error } = await window.sb
      .from('routes')
      .select('*')
      .order('code', { ascending: true });
    if (error) { UI.toast(error.message, 'err'); return; }
    allRoutes = data || [];
    applyFilter();
  }

  // клиентская фильтрация + рендер
  function applyFilter() {
    const status = filterStatus.value;
    const q = filterSearch.value.trim().toLowerCase();

    const filtered = allRoutes.filter(r => {
      if (status === 'active' && !r.is_active) return false;
      if (status === 'inactive' && r.is_active) return false;
      if (q) {
        const hay = (r.name + ' ' + r.code).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    countEl.textContent = `Найдено: ${filtered.length}`;
    renderTable(filtered);
  }

  // рендер таблицы
  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    list.forEach(r => tbody.appendChild(row(r)));
  }

  // строка
  function row(r) {
    const tr = document.createElement('tr');

    const tdCode = document.createElement('td');
    tdCode.textContent = r.code;

    const tdName = document.createElement('td');
    tdName.textContent = r.name;

    const tdDesc = document.createElement('td');
    tdDesc.textContent = r.description || '—';

    const tdColor = document.createElement('td');
    const colorBox = document.createElement('span');
    colorBox.style.display = 'inline-block';
    colorBox.style.width = '18px';
    colorBox.style.height = '18px';
    colorBox.style.borderRadius = '4px';
    colorBox.style.background = r.color || '#2563eb';
    colorBox.style.border = '1px solid var(--border)';
    tdColor.appendChild(colorBox);
    const colorHex = document.createElement('span');
    colorHex.style.marginLeft = '8px';
    colorHex.style.color = 'var(--muted)';
    colorHex.style.fontSize = '12px';
    colorHex.textContent = r.color || '';
    tdColor.appendChild(colorHex);

    const tdStatus = document.createElement('td');
    tdStatus.appendChild(r.is_active ? UI.badge('Активен', 'ok') : UI.badge('Неактивен', 'muted'));

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm';
    editBtn.textContent = 'Редактировать';
    editBtn.addEventListener('click', () => openModal(r));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteRoute(r));

    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdCode);
    tr.appendChild(tdName);
    tr.appendChild(tdDesc);
    tr.appendChild(tdColor);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAct);
    return tr;
  }

  // удаление с проверками
  async function deleteRoute(r) {
    if (!confirm(`Удалить маршрут ${r.code}? Действие необратимо.`)) return;
    try {
      const { count: tCount, error: e1 } = await window.sb
        .from('transport')
        .select('id', { count: 'exact', head: true })
        .eq('route_id', r.id);
      if (e1) throw e1;
      const { count: sCount, error: e2 } = await window.sb
        .from('schedules')
        .select('id', { count: 'exact', head: true })
        .eq('route_id', r.id);
      if (e2) throw e2;
      if ((tCount || 0) + (sCount || 0) > 0) {
        UI.toast('Нельзя удалить: есть транспорт или расписание', 'err');
        return;
      }
      const { error } = await window.sb.from('routes').delete().eq('id', r.id);
      if (error) throw error;
      UI.toast('Маршрут удалён', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка удаления', 'err');
    }
  }

  // модалка создания/редактирования
  function openModal(existing) {
    const isEdit = !!existing;
    const m = UI.createModal({ title: isEdit ? 'Редактировать маршрут' : 'Новый маршрут' });

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Код *</label>
        <input name="code" required maxlength="20" value="${existing ? escapeAttr(existing.code) : ''}" />
      </div>
      <div class="field">
        <label>Название *</label>
        <input name="name" required maxlength="120" value="${existing ? escapeAttr(existing.name) : ''}" />
      </div>
      <div class="field">
        <label>Описание</label>
        <textarea name="description" maxlength="500">${existing ? escapeAttr(existing.description || '') : ''}</textarea>
      </div>
      <div class="field">
        <label>Цвет</label>
        <input name="color" type="color" value="${existing ? escapeAttr(existing.color || '#2563eb') : '#2563eb'}" />
      </div>
      <div class="field" style="flex-direction:row;align-items:center;gap:8px;">
        <input id="route-active" name="is_active" type="checkbox" style="width:auto;" ${!existing || existing.is_active ? 'checked' : ''}/>
        <label for="route-active" style="margin:0;">Активен</label>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand" id="save-btn">Сохранить</button>
      </div>`;

    m.body.appendChild(form);
    m.body.querySelector('#cancel-btn').addEventListener('click', m.close);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        code: String(fd.get('code') || '').trim(),
        name: String(fd.get('name') || '').trim(),
        description: String(fd.get('description') || '').trim() || null,
        color: String(fd.get('color') || '#2563eb'),
        is_active: !!fd.get('is_active')
      };
      if (!payload.code || !payload.name) {
        UI.toast('Заполните обязательные поля', 'err');
        return;
      }
      const saveBtn = m.body.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        if (isEdit) {
          const { error } = await window.sb.from('routes').update(payload).eq('id', existing.id);
          if (error) throw error;
          UI.toast('Маршрут обновлён', 'ok');
        } else {
          const { error } = await window.sb.from('routes').insert(payload);
          if (error) throw error;
          UI.toast('Маршрут создан', 'ok');
        }
        m.close();
        await load();
      } catch (err) {
        const msg = String(err.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          UI.toast('Код уже используется', 'err');
        } else {
          UI.toast(err.message || 'Ошибка сохранения', 'err');
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
      }
    });
  }

  // экранирование атрибута (для подстановки в value="")
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // realtime
  function setupRealtime() {
    channel = window.sb.channel('routes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, () => {
        load();
      })
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  // Главный
  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Маршруты',
      profile,
      active: 'routes.html'
    });

    // toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    // добавить
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--brand';
    addBtn.textContent = '➕ Добавить маршрут';
    addBtn.addEventListener('click', () => openModal(null));

    // фильтр по статусу
    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Статус</label>`;
    filterStatus = document.createElement('select');
    filterStatus.innerHTML = `
      <option value="all">Все</option>
      <option value="active">Активные</option>
      <option value="inactive">Неактивные</option>`;
    f1.appendChild(filterStatus);

    // поиск
    const f2 = document.createElement('div');
    f2.className = 'field field--grow';
    f2.innerHTML = `<label>Поиск</label>`;
    filterSearch = document.createElement('input');
    filterSearch.placeholder = 'Название или код';
    f2.appendChild(filterSearch);

    countEl = document.createElement('span');
    countEl.className = 'muted';

    toolbar.appendChild(addBtn);
    toolbar.appendChild(f1);
    toolbar.appendChild(f2);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    // таблица
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Код</th><th>Название</th><th>Описание</th><th>Цвет</th><th>Статус</th><th>Действия</th>
          </tr>
        </thead>
        <tbody id="routes-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Нет маршрутов';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);

    tbody = wrap.querySelector('#routes-tbody');

    // события фильтров
    filterStatus.addEventListener('change', applyFilter);
    filterSearch.addEventListener('input', UI.debounce(applyFilter, 300));

    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();