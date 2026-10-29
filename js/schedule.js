// ============================================================
// Расписание: список по маршруту/дню + CRUD
// ============================================================
(function () {
  let routesList = [];
  let transportList = [];
  let routeSelect, daySelect, tbody, emptyEl, addBtn, counter;
  let channel = null;

  const DAY_LABELS = { weekday: 'Будни', weekend: 'Выходные', holiday: 'Праздники' };

  // загрузка справочников
  async function bootstrapLists() {
    const [r, t] = await Promise.all([
      window.sb.from('routes').select('id,code,name,is_active').eq('is_active', true).order('code'),
      window.sb.from('transport').select('id,board_number,model,status').eq('status', 'active').order('board_number')
    ]);
    if (r.error) { UI.toast(r.error.message, 'err'); return false; }
    if (t.error) { UI.toast(t.error.message, 'err'); return false; }
    routesList = r.data || [];
    transportList = t.data || [];

    routeSelect.innerHTML = '<option value="">— выберите маршрут —</option>';
    routesList.forEach(x => {
      const o = document.createElement('option');
      o.value = x.id;
      o.textContent = `${x.code} — ${x.name}`;
      routeSelect.appendChild(o);
    });
    return true;
  }

  // загрузка расписания
  async function load() {
    const routeId = routeSelect.value;
    const dayType = daySelect.value;
    if (!routeId) {
      tbody.innerHTML = '';
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Выберите маршрут';
      addBtn.disabled = true;
      counter.textContent = '';
      return;
    }
    addBtn.disabled = false;

    const { data, error } = await window.sb
      .from('schedules')
      .select(`
        id, departure_time, arrival_time, day_type, route_id, transport_id,
        transport:transport_id (id, board_number, model)
      `)
      .eq('route_id', routeId)
      .eq('day_type', dayType)
      .order('departure_time', { ascending: true });
    if (error) { UI.toast(error.message, 'err'); return; }

    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Рейсов нет, добавьте первый';
      counter.textContent = '';
      return;
    }
    emptyEl.style.display = 'none';
    counter.textContent = `Всего: ${data.length}`;
    data.forEach(s => tbody.appendChild(row(s)));
  }

  function row(s) {
    const tr = document.createElement('tr');
    const tdDep = document.createElement('td'); tdDep.textContent = UI.fmtTime(s.departure_time);
    const tdArr = document.createElement('td'); tdArr.textContent = UI.fmtTime(s.arrival_time);
    const tdTr = document.createElement('td');
    tdTr.textContent = s.transport
      ? `${s.transport.board_number} (${s.transport.model})`
      : '—';
    const tdDay = document.createElement('td');
    tdDay.textContent = DAY_LABELS[s.day_type] || s.day_type;

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm';
    editBtn.textContent = 'Редактировать';
    editBtn.addEventListener('click', () => openModal(s));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteRow(s));
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdDep);
    tr.appendChild(tdArr);
    tr.appendChild(tdTr);
    tr.appendChild(tdDay);
    tr.appendChild(tdAct);
    return tr;
  }

  async function deleteRow(s) {
    if (!confirm('Удалить этот рейс?')) return;
    try {
      const { error } = await window.sb.from('schedules').delete().eq('id', s.id);
      if (error) throw error;
      UI.toast('Рейс удалён', 'ok');
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

  // модалка
  function openModal(existing) {
    const isEdit = !!existing;
    const m = UI.createModal({ title: isEdit ? 'Редактировать рейс' : 'Новый рейс' });

    const routeOptions = routesList.map(r =>
      `<option value="${r.id}" ${existing && existing.route_id === r.id ? 'selected' : ''}>${escapeHtml(r.code + ' — ' + r.name)}</option>`
    ).join('');

    const trOptions = `<option value="">— не назначен —</option>` +
      transportList.map(t =>
        `<option value="${t.id}" ${existing && existing.transport_id === t.id ? 'selected' : ''}>${escapeHtml(t.board_number + ' (' + t.model + ')')}</option>`
      ).join('');

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Маршрут *</label>
        <select name="route_id" required>${routeOptions}</select>
      </div>
      <div class="field">
        <label>Транспорт</label>
        <select name="transport_id">${trOptions}</select>
      </div>
      <div class="field--row">
        <div class="field">
          <label>Отправление *</label>
          <input name="departure_time" type="time" required
                 value="${existing ? String(existing.departure_time).slice(0,5) : ''}" />
        </div>
        <div class="field">
          <label>Прибытие</label>
          <input name="arrival_time" type="time"
                 value="${existing && existing.arrival_time ? String(existing.arrival_time).slice(0,5) : ''}" />
        </div>
      </div>
      <div class="field">
        <label>Тип дня</label>
        <select name="day_type">
          <option value="weekday" ${existing && existing.day_type === 'weekday' ? 'selected' : ''}>Будни</option>
          <option value="weekend" ${existing && existing.day_type === 'weekend' ? 'selected' : ''}>Выходные</option>
          <option value="holiday" ${existing && existing.day_type === 'holiday' ? 'selected' : ''}>Праздники</option>
        </select>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand" id="save-btn">Сохранить</button>
      </div>`;

    m.body.appendChild(form);
    form.querySelector('#cancel-btn').addEventListener('click', m.close);

    // при создании по умолчанию ставим текущий маршрут
    if (!isEdit) {
      form.querySelector('select[name=route_id]').value = routeSelect.value;
      form.querySelector('select[name=day_type]').value = daySelect.value;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const route_id = fd.get('route_id');
      const transport_id = fd.get('transport_id') || null;
      const departure_time = fd.get('departure_time');
      const arrival_time = fd.get('arrival_time') || null;
      const day_type = fd.get('day_type');

      if (!route_id || !departure_time) {
        UI.toast('Заполните обязательные поля', 'err');
        return;
      }
      // валидация времени
      if (arrival_time && arrival_time <= departure_time) {
        UI.toast('Время прибытия должно быть позже отправления', 'err');
        return;
      }

      // предупреждение о занятости транспорта
      if (transport_id) {
        try {
          const { data: conflicts } = await window.sb
            .from('schedules')
            .select('id,departure_time,arrival_time')
            .eq('transport_id', transport_id)
            .eq('day_type', day_type);
          const overlap = (conflicts || []).some(c => {
            if (isEdit && c.id === existing.id) return false;
            // простая проверка: если отправление совпадает
            return String(c.departure_time).slice(0, 5) === departure_time;
          });
          if (overlap) {
            if (!confirm('Транспорт уже занят в это время в этот день. Продолжить?')) return;
          }
        } catch (_) { /* игнор */ }
      }

      const payload = {
        route_id,
        transport_id,
        departure_time,
        arrival_time,
        day_type
      };

      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        if (isEdit) {
          const { error } = await window.sb.from('schedules').update(payload).eq('id', existing.id);
          if (error) throw error;
          UI.toast('Рейс обновлён', 'ok');
        } else {
          const { error } = await window.sb.from('schedules').insert(payload);
          if (error) throw error;
          UI.toast('Рейс создан', 'ok');
        }
        m.close();
        await load();
      } catch (err) {
        UI.toast(err.message || 'Ошибка', 'err');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
      }
    });
  }

  function setupRealtime() {
    channel = window.sb.channel('schedules-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
        load();
      })
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Расписание',
      profile,
      active: 'schedule.html'
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Маршрут</label>`;
    routeSelect = document.createElement('select');
    f1.appendChild(routeSelect);

    const f2 = document.createElement('div');
    f2.className = 'field';
    f2.innerHTML = `<label>Тип дня</label>`;
    daySelect = document.createElement('select');
    daySelect.innerHTML = `
      <option value="weekday">Будни</option>
      <option value="weekend">Выходные</option>
      <option value="holiday">Праздники</option>`;
    f2.appendChild(daySelect);

    addBtn = document.createElement('button');
    addBtn.className = 'btn btn--brand';
    addBtn.textContent = '➕ Добавить рейс';
    addBtn.disabled = true;
    addBtn.addEventListener('click', () => openModal(null));

    counter = document.createElement('span');
    counter.className = 'muted';

    toolbar.appendChild(f1);
    toolbar.appendChild(f2);
    toolbar.appendChild(addBtn);
    toolbar.appendChild(counter);
    content.appendChild(toolbar);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Отправление</th><th>Прибытие</th><th>Транспорт</th><th>Тип дня</th><th>Действия</th></tr>
        </thead>
        <tbody id="sched-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.textContent = 'Выберите маршрут';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#sched-tbody');

    routeSelect.addEventListener('change', load);
    daySelect.addEventListener('change', load);

    const ok = await bootstrapLists();
    if (ok) {
      if (routesList.length > 0) {
        routeSelect.value = routesList[0].id;
        await load();
      } else {
        emptyEl.style.display = 'block';
      }
      setupRealtime();
    }
  }

  document.addEventListener('DOMContentLoaded', main);
})();