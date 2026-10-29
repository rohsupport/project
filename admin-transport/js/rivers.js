// ============================================================
// Водители: CRUD + переключатель "на смене" + realtime
// ============================================================
(function () {
  let allDrivers = [];
  let channel = null;
  let tbody, emptyEl, countEl, searchInput;

  async function load() {
    const { data, error } = await window.sb
      .from('drivers')
      .select('*')
      .order('full_name');
    if (error) { UI.toast(error.message, 'err'); return; }
    allDrivers = data || [];
    applyFilter();
  }

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = allDrivers.filter(d => {
      if (!q) return true;
      return (d.full_name || '').toLowerCase().includes(q) ||
             (d.license_number || '').toLowerCase().includes(q);
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
    list.forEach(d => tbody.appendChild(row(d)));
  }

  function row(d) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = d.full_name;
    const tdLic = document.createElement('td'); tdLic.textContent = d.license_number;
    const tdExp = document.createElement('td'); tdExp.textContent = d.experience_years;
    const tdPhone = document.createElement('td'); tdPhone.textContent = d.phone || '—';

    const tdShift = document.createElement('td');
    const shiftBtn = document.createElement('button');
    shiftBtn.className = 'btn btn--sm ' + (d.is_on_shift ? 'btn--ok' : '');
    shiftBtn.textContent = d.is_on_shift ? 'На смене ✓' : 'Не на смене';
    shiftBtn.addEventListener('click', () => toggleShift(d));
    tdShift.appendChild(shiftBtn);

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm';
    editBtn.textContent = 'Редактировать';
    editBtn.addEventListener('click', () => openModal(d));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteRow(d));
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdLic);
    tr.appendChild(tdExp);
    tr.appendChild(tdPhone);
    tr.appendChild(tdShift);
    tr.appendChild(tdAct);
    return tr;
  }

  async function toggleShift(d) {
    try {
      const { error } = await window.sb
        .from('drivers')
        .update({ is_on_shift: !d.is_on_shift })
        .eq('id', d.id);
      if (error) throw error;
      UI.toast(d.is_on_shift ? 'Водитель вышел со смены' : 'Водитель на смене', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    }
  }

  async function deleteRow(d) {
    if (!confirm(`Удалить водителя "${d.full_name}"?`)) return;
    try {
      const { error } = await window.sb.from('drivers').delete().eq('id', d.id);
      if (error) throw error;
      UI.toast('Водитель удалён', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    }
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function openModal(existing) {
    const isEdit = !!existing;
    const m = UI.createModal({ title: isEdit ? 'Редактировать водителя' : 'Новый водитель' });

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>ФИО *</label>
        <input name="full_name" required maxlength="200"
               value="${existing ? escapeAttr(existing.full_name) : ''}" />
      </div>
      <div class="field">
        <label>Лицензия *</label>
        <input name="license_number" required maxlength="50"
               value="${existing ? escapeAttr(existing.license_number) : ''}" />
      </div>
      <div class="field">
        <label>Стаж (лет)</label>
        <input name="experience_years" type="number" min="0"
               value="${existing ? existing.experience_years : 0}" />
      </div>
      <div class="field">
        <label>Телефон</label>
        <input name="phone" type="tel" maxlength="30"
               value="${existing ? escapeAttr(existing.phone || '') : ''}" />
      </div>
      <div class="field" style="flex-direction:row;align-items:center;gap:8px;">
        <input id="drv-shift" name="is_on_shift" type="checkbox" style="width:auto;"
               ${existing && existing.is_on_shift ? 'checked' : ''}/>
        <label for="drv-shift" style="margin:0;">На смене</label>
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
      const exp = parseInt(fd.get('experience_years') || '0', 10);
      const payload = {
        full_name: String(fd.get('full_name') || '').trim(),
        license_number: String(fd.get('license_number') || '').trim(),
        experience_years: Number.isFinite(exp) ? exp : 0,
        phone: String(fd.get('phone') || '').trim() || null,
        is_on_shift: !!fd.get('is_on_shift')
      };
      if (!payload.full_name || !payload.license_number) {
        UI.toast('Заполните обязательные поля', 'err');
        return;
      }
      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        if (isEdit) {
          const { error } = await window.sb.from('drivers').update(payload).eq('id', existing.id);
          if (error) throw error;
          UI.toast('Водитель обновлён', 'ok');
        } else {
          const { error } = await window.sb.from('drivers').insert(payload);
          if (error) throw error;
          UI.toast('Водитель создан', 'ok');
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
    channel = window.sb.channel('drivers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Водители',
      profile,
      active: 'drivers.html'
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--brand';
    addBtn.textContent = '➕ Добавить водителя';
    addBtn.addEventListener('click', () => openModal(null));

    const fSearch = document.createElement('div');
    fSearch.className = 'field field--grow';
    fSearch.innerHTML = `<label>Поиск</label>`;
    searchInput = document.createElement('input');
    searchInput.placeholder = 'ФИО или лицензия';
    fSearch.appendChild(searchInput);

    countEl = document.createElement('span');
    countEl.className = 'muted';

    toolbar.appendChild(addBtn);
    toolbar.appendChild(fSearch);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>ФИО</th><th>Лицензия</th><th>Стаж</th><th>Телефон</th><th>На смене</th><th>Действия</th></tr>
        </thead>
        <tbody id="drv-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Водителей нет';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#drv-tbody');

    searchInput.addEventListener('input', UI.debounce(applyFilter, 300));

    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();