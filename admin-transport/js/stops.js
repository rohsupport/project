// ============================================================
// Остановки: CRUD + Leaflet-карта + фильтры
// ============================================================
(function () {
  let allStops = [];
  let map = null;
  let markerLayer = null;
  let tbody, emptyEl, countEl, searchInput;

  // ленивая инициализация карты
  function initMap() {
    if (map) return;
    map = L.map('map').setView([55.751244, 37.618423], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  // перерисовать маркеры
  function drawMarkers(list) {
    if (!map) initMap();
    markerLayer.clearLayers();
    const points = [];
    list.forEach(s => {
      if (s.is_active === false) return;
      if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) return;
      const m = L.marker([s.latitude, s.longitude]);
      const popup = document.createElement('div');
      const h = document.createElement('strong');
      h.textContent = s.name;
      const addr = document.createElement('div');
      addr.style.color = '#555';
      addr.textContent = s.address || '';
      const btn = document.createElement('button');
      btn.className = 'btn btn--sm';
      btn.style.marginTop = '6px';
      btn.textContent = 'Редактировать';
      btn.addEventListener('click', () => { openModal(s); map.closePopup(); });
      popup.appendChild(h);
      popup.appendChild(addr);
      popup.appendChild(btn);
      m.bindPopup(popup);
      m.addTo(markerLayer);
      points.push([s.latitude, s.longitude]);
    });
    if (points.length > 0) {
      try { map.fitBounds(points, { padding: [30, 30] }); } catch (e) {}
    }
  }

  // загрузка
  async function load() {
    const { data, error } = await window.sb
      .from('stops')
      .select('*')
      .order('name', { ascending: true });
    if (error) { UI.toast(error.message, 'err'); return; }
    allStops = data || [];
    applyFilter();
  }

  // фильтрация + рендер
  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = allStops.filter(s => {
      if (!q) return true;
      return (s.name || '').toLowerCase().includes(q);
    });
    countEl.textContent = `Найдено: ${filtered.length}`;
    drawMarkers(filtered);
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
    list.forEach(s => tbody.appendChild(row(s)));
  }

  function row(s) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td'); tdName.textContent = s.name;
    const tdAddr = document.createElement('td'); tdAddr.textContent = s.address || '—';
    const tdLat = document.createElement('td'); tdLat.textContent = Number(s.latitude).toFixed(6);
    const tdLng = document.createElement('td'); tdLng.textContent = Number(s.longitude).toFixed(6);

    const tdStatus = document.createElement('td');
    tdStatus.appendChild(s.is_active ? UI.badge('Активна', 'ok') : UI.badge('Неактивна', 'muted'));

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';

    const mapBtn = document.createElement('button');
    mapBtn.className = 'btn btn--sm';
    mapBtn.textContent = '🗺️';
    mapBtn.title = 'Показать на карте';
    mapBtn.addEventListener('click', () => {
      window.open(`https://www.google.com/maps?q=${s.latitude},${s.longitude}`, '_blank');
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm';
    editBtn.textContent = 'Редактировать';
    editBtn.addEventListener('click', () => openModal(s));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteStop(s));

    tdAct.appendChild(mapBtn);
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdAddr);
    tr.appendChild(tdLat);
    tr.appendChild(tdLng);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAct);
    return tr;
  }

  async function deleteStop(s) {
    if (!confirm(`Удалить остановку "${s.name}"?`)) return;
    try {
      const { count, error: e1 } = await window.sb
        .from('route_stops')
        .select('id', { count: 'exact', head: true })
        .eq('stop_id', s.id);
      if (e1) throw e1;
      if ((count || 0) > 0) {
        UI.toast('Остановка привязана к маршрутам, сначала отвяжите', 'err');
        return;
      }
      const { error } = await window.sb.from('stops').delete().eq('id', s.id);
      if (error) throw error;
      UI.toast('Остановка удалена', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка удаления', 'err');
    }
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // модалка
  function openModal(existing) {
    const isEdit = !!existing;
    const m = UI.createModal({ title: isEdit ? 'Редактировать остановку' : 'Новая остановка' });

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Название *</label>
        <input name="name" required maxlength="200" value="${existing ? escapeAttr(existing.name) : ''}" />
      </div>
      <div class="field">
        <label>Адрес</label>
        <input name="address" maxlength="300" value="${existing ? escapeAttr(existing.address || '') : ''}" />
      </div>
      <div class="field--row">
        <div class="field">
          <label>Широта *</label>
          <input name="latitude" type="number" step="0.000001" min="-90" max="90" required
                 value="${existing ? existing.latitude : ''}" />
        </div>
        <div class="field">
          <label>Долгота *</label>
          <input name="longitude" type="number" step="0.000001" min="-180" max="180" required
                 value="${existing ? existing.longitude : ''}" />
        </div>
      </div>
      <div class="field" style="flex-direction:row;align-items:center;gap:8px;">
        <input id="stop-active" name="is_active" type="checkbox" style="width:auto;"
               ${!existing || existing.is_active ? 'checked' : ''}/>
        <label for="stop-active" style="margin:0;">Активна</label>
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
      const lat = parseFloat(fd.get('latitude'));
      const lng = parseFloat(fd.get('longitude'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        UI.toast('Введите корректные координаты', 'err');
        return;
      }
      if (lat < -90 || lat > 90) { UI.toast('Широта вне диапазона', 'err'); return; }
      if (lng < -180 || lng > 180) { UI.toast('Долгота вне диапазона', 'err'); return; }

      const payload = {
        name: String(fd.get('name') || '').trim(),
        address: String(fd.get('address') || '').trim() || null,
        latitude: lat,
        longitude: lng,
        is_active: !!fd.get('is_active')
      };
      if (!payload.name) { UI.toast('Введите название', 'err'); return; }

      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        if (isEdit) {
          const { error } = await window.sb.from('stops').update(payload).eq('id', existing.id);
          if (error) throw error;
          UI.toast('Остановка обновлена', 'ok');
        } else {
          const { error } = await window.sb.from('stops').insert(payload);
          if (error) throw error;
          UI.toast('Остановка создана', 'ok');
        }
        m.close();
        await load();
      } catch (err) {
        UI.toast(err.message || 'Ошибка сохранения', 'err');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
      }
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Остановки',
      profile,
      active: 'stops.html'
    });

    // toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--brand';
    addBtn.textContent = '➕ Добавить остановку';
    addBtn.addEventListener('click', () => openModal(null));

    const fSearch = document.createElement('div');
    fSearch.className = 'field field--grow';
    fSearch.innerHTML = `<label>Поиск</label>`;
    searchInput = document.createElement('input');
    searchInput.placeholder = 'Название остановки';
    fSearch.appendChild(searchInput);

    countEl = document.createElement('span');
    countEl.className = 'muted';

    toolbar.appendChild(addBtn);
    toolbar.appendChild(fSearch);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    // карта
    const mapEl = document.createElement('div');
    mapEl.id = 'map';
    content.appendChild(mapEl);
    initMap();

    // таблица
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Название</th><th>Адрес</th><th>Широта</th><th>Долгота</th><th>Статус</th><th>Действия</th>
          </tr>
        </thead>
        <tbody id="stops-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Остановок нет';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#stops-tbody');

    searchInput.addEventListener('input', UI.debounce(applyFilter, 300));
    await load();
  }

  document.addEventListener('DOMContentLoaded', main);
})();