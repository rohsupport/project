(function () {
  'use strict';

  // ==========================================
  // 1. СОСТОЯНИЕ
  // ==========================================
  let allStops = [];
  let allCities = [];
  let map = null;
  let addMarker = null;
  let editId = null;
  let isProcessing = false;
  let resizeObserver = null;

  // Состояние таблицы
  let currentPage = 1;
  const itemsPerPage = 20;
  let sortField = 'stop_code';
  let sortDir = 'desc';
  let selectedIds = new Set();

  // Фильтры
  let filterQuery = '';
  let filterCity = 'all';
  let filterStatus = 'all';

  // Настройки
  let settings = {
    showCoords: true,
    mapCenter: [40.1209, 9.0129], // Уджан / Сардиния
    mapZoom: 8
  };

  // DOM
  let contentArea;

  // ==========================================
  // 2. УТИЛИТЫ
  // ==========================================
  function loadSettings() {
    const s = localStorage.getItem('stops_settings_v11');
    if (s) { try { settings = { ...settings, ...JSON.parse(s) }; } catch(e){} }
  }
  function saveSettings() { localStorage.setItem('stops_settings_v11', JSON.stringify(settings)); }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }

  // ==========================================
  // 3. ЗАГРУЗКА ДАННЫХ
  // ==========================================
  async function loadData() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const [rStops, rCities] = await Promise.all([
        window.sb.from('stops').select('*, settlements(name)'),
        window.sb.from('settlements').select('*').order('name')
      ]);
      if (rStops.error) throw rStops.error;
      if (rCities.error) throw rCities.error;
      
      allStops = rStops.data || [];
      allCities = rCities.data || [];
      
      renderCitySelects();
      renderTable();
      renderMapMarkers();
    } catch (err) {
      UI.toast('Ошибка загрузки: ' + err.message, 'err');
    } finally {
      isProcessing = false;
    }
  }

  function renderCitySelects() {
    const filterSel = document.getElementById('filter-city');
    const formSel = document.getElementById('f-city');
    
    if (filterSel) {
      const val = filterSel.value;
      filterSel.innerHTML = '<option value="all">Все города</option>';
      allCities.forEach(c => filterSel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escapeHtml(c.name)}</option>`));
      if (val) filterSel.value = val;
    }
    
    if (formSel) {
      const val = formSel.value;
      formSel.innerHTML = '<option value="">— Выберите город —</option>';
      allCities.forEach(c => formSel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escapeHtml(c.name)}</option>`));
      if (val) formSel.value = val;
    }
  }

  // ==========================================
  // 4. ТАБЛИЦА
  // ==========================================
  function renderTable() {
    const tbody = document.getElementById('tbody-list');
    if (!tbody) return;

    // Фильтрация
    let filtered = allStops.filter(s => {
      const q = filterQuery.toLowerCase();
      const matchQ = !q || (s.name||'').toLowerCase().includes(q) || (s.stop_code||'').includes(q) || (s.address||'').toLowerCase().includes(q);
      const matchSt = filterStatus === 'all' || (s.status || 'active') === filterStatus;
      const matchCt = filterCity === 'all' || s.settlement_id === filterCity;
      return matchQ && matchSt && matchCt;
    });

    // Сортировка
    filtered.sort((a, b) => {
      let valA = a[sortField] || '';
      let valB = b[sortField] || '';
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // Пагинация
    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const startIdx = (currentPage - 1) * itemsPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + itemsPerPage);

    // Отрисовка
    tbody.innerHTML = '';
    if (pageItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--muted);">Ничего не найдено</td></tr>';
    } else {
      pageItems.forEach(s => {
        const cityName = s.settlements ? s.settlements.name : '—';
        const statusClass = s.status === 'active' ? 'active' : (s.status === 'closed' ? 'closed' : 'reconstruction');
        const isChecked = selectedIds.has(s.id) ? 'checked' : '';
        
        const tr = document.createElement('tr');
        if (isChecked) tr.classList.add('selected');

        tr.innerHTML = `
          <td style="text-align:center;"><input type="checkbox" class="row-checkbox" data-id="${s.id}" ${isChecked} /></td>
          <td><span class="badge badge--muted" style="font-family:monospace;">${escapeHtml(s.stop_code || '—')}</span></td>
          <td>${escapeHtml(cityName)}</td>
          <td>
            <div style="font-weight:600; cursor:pointer; color:var(--brand);" class="locate-btn" data-lat="${s.latitude}" data-lng="${s.longitude}">${escapeHtml(s.name)}</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">${escapeHtml(s.address || '—')}</div>
          </td>
          <td>
            <select class="status-select ${statusClass}" data-id="${s.id}">
              <option value="active" ${s.status === 'active' ? 'selected' : ''}>Активна</option>
              <option value="reconstruction" ${s.status === 'reconstruction' ? 'selected' : ''}>Реконструкция</option>
              <option value="closed" ${s.status === 'closed' ? 'selected' : ''}>Закрыта</option>
            </select>
          </td>
          <td style="white-space:nowrap; text-align:right;">
            <button class="btn btn--sm edit-btn" style="padding:6px 10px; margin-right:4px; background:var(--card); border:1px solid var(--border);">Ред.</button>
            <button class="btn btn--sm btn--danger del-btn" style="padding:6px 10px;">Удал.</button>
          </td>
        `;

        tr.querySelector('.row-checkbox').onchange = (e) => {
          if (e.target.checked) { selectedIds.add(s.id); tr.classList.add('selected'); }
          else { selectedIds.delete(s.id); tr.classList.remove('selected'); }
          updateBulkPanel();
        };

        tr.querySelector('.locate-btn').onclick = () => {
          if (map) {
            map.setView([s.latitude, s.longitude], 16);
            if (addMarker) map.removeLayer(addMarker);
            addMarker = L.marker([s.latitude, s.longitude]).addTo(map);
            addMarker.bindPopup(`<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.address||'')}`).openPopup();
          }
        };

        tr.querySelector('.status-select').onchange = async (e) => {
          const newStatus = e.target.value;
          const oldStatus = s.status;
          e.target.className = `status-select ${newStatus === 'active' ? 'active' : (newStatus === 'closed' ? 'closed' : 'reconstruction')}`;
          try {
            const { error } = await window.sb.from('stops').update({ status: newStatus }).eq('id', s.id);
            if (error) throw error;
            s.status = newStatus;
            UI.toast('Статус обновлен', 'ok');
            renderMapMarkers();
          } catch (err) {
            UI.toast(err.message, 'err');
            e.target.value = oldStatus;
          }
        };

        tr.querySelector('.edit-btn').onclick = () => fillForm(s);
        tr.querySelector('.del-btn').onclick = () => safeDelete(s);

        tbody.appendChild(tr);
      });
    }

    document.getElementById('page-info').textContent = `Стр. ${currentPage} из ${totalPages} (Всего: ${filtered.length})`;
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = currentPage === totalPages;

    updateBulkPanel();
  }

  function updateBulkPanel() {
    const panel = document.getElementById('bulk-panel');
    const count = document.getElementById('bulk-count');
    if (!panel || !count) return;
    if (selectedIds.size > 0) {
      panel.style.display = 'flex';
      count.textContent = `Выбрано: ${selectedIds.size}`;
    } else {
      panel.style.display = 'none';
    }
  }

  async function bulkChangeStatus(newStatus) {
    if (selectedIds.size === 0) return;
    if (!confirm(`Изменить статус у ${selectedIds.size} остановок?`)) return;
    
    const ids = Array.from(selectedIds);
    try {
      const { error } = await window.sb.from('stops').update({ status: newStatus }).in('id', ids);
      if (error) throw error;
      UI.toast('Статусы обновлены', 'ok');
      selectedIds.clear();
      await loadData();
    } catch (err) {
      UI.toast(err.message, 'err');
    }
  }

  // ==========================================
  // 5. ФОРМА
  // ==========================================
  function resetForm() {
    editId = null;
    document.getElementById('f-city').value = '';
    document.getElementById('f-code').value = '';
    document.getElementById('f-name').value = '';
    document.getElementById('f-addr').value = '';
    document.getElementById('f-coords').value = '';
    document.getElementById('form-title').textContent = 'Новая остановка';
    document.getElementById('btn-save').textContent = 'Добавить остановку';
    document.getElementById('btn-cancel-edit').style.display = 'none';
    
    if (addMarker && map) { map.removeLayer(addMarker); addMarker = null; }
  }

  function fillForm(stop) {
    editId = stop.id;
    document.getElementById('f-city').value = stop.settlement_id || '';
    document.getElementById('f-code').value = stop.stop_code || '';
    document.getElementById('f-name').value = stop.name || '';
    document.getElementById('f-addr').value = stop.address || '';
    document.getElementById('f-coords').value = `${stop.latitude}, ${stop.longitude}`;
    document.getElementById('form-title').textContent = `Редактирование: ${stop.name}`;
    document.getElementById('btn-save').textContent = 'Сохранить изменения';
    document.getElementById('btn-cancel-edit').style.display = 'block';
    
    if (map) {
      map.setView([stop.latitude, stop.longitude], 16);
      if (addMarker) map.removeLayer(addMarker);
      addMarker = L.marker([stop.latitude, stop.longitude]).addTo(map);
    }
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ru`);
      const data = await res.json();
      if (data && data.display_name) {
        return data.display_name.split(',').slice(0, 2).join(',').trim();
      }
    } catch (e) {}
    return '';
  }

  // ==========================================
  // 6. КАРТА
  // ==========================================
  function initMap() {
    if (map) return;
    const container = document.getElementById('main-map');
    if (!container) return;

    map = L.map('main-map', { zoomControl: true }).setView(settings.mapCenter, settings.mapZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    map.on('click', async (e) => {
      if (editId) {
        if (!confirm('Отменить редактирование?')) return;
        resetForm();
      }
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      
      if (addMarker) map.removeLayer(addMarker);
      addMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
      
      document.getElementById('f-coords').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('f-addr').value = 'Определение адреса...';
      
      const addr = await reverseGeocode(lat, lng);
      if (document.getElementById('f-coords').value === `${lat.toFixed(6)}, ${lng.toFixed(6)}`) {
        document.getElementById('f-addr').value = addr || '';
      }

      addMarker.on('dragend', () => {
        const p = addMarker.getLatLng();
        document.getElementById('f-coords').value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
      });
    });

    // ФИКС ИСЧЕЗНОВЕНИЯ КАРТЫ (ResizeObserver)
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (map) map.invalidateSize();
      });
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
    }

    setTimeout(() => { if (map) map.invalidateSize(); }, 300);
  }

  function renderMapMarkers() {
    if (!map) return;
    map.eachLayer(l => { if (l instanceof L.Marker && l !== addMarker) map.removeLayer(l); });

    allStops.forEach(s => {
      let color = '#16a34a'; // active
      if (s.status === 'reconstruction') color = '#f59e0b';
      if (s.status === 'closed') color = '#6b7280';

      const markerHtml = `<div style="background:${color}; width:14px; height:14px; border-radius:50%; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`;
      const icon = L.divIcon({ html: markerHtml, className: 'custom-marker', iconSize: [18, 18], iconAnchor: [9, 9] });

      const marker = L.marker([s.latitude, s.longitude], { icon: icon }).addTo(map);
      
      marker.bindPopup(`
        <div style="font-family:sans-serif; min-width:180px;">
          <h4 style="margin:0 0 6px; font-size:14px; color:#000;">${escapeHtml(s.name)}</h4>
          <div style="font-size:12px; color:#555; margin-bottom:4px;"><b>Код:</b> ${escapeHtml(s.stop_code || '—')}</div>
          <div style="font-size:12px; color:#555; margin-bottom:8px;"><b>Адрес:</b> ${escapeHtml(s.address || '—')}</div>
          <button class="popup-edit-btn" style="width:100%; padding:6px; cursor:pointer; background:#2563eb; color:#fff; border:none; border-radius:4px;">Редактировать</button>
        </div>
      `);
      
      marker.on('popupopen', () => {
        const btn = document.querySelector('.popup-edit-btn');
        if (btn) btn.onclick = () => { map.closePopup(); fillForm(s); };
      });
    });
  }

  // ==========================================
  // 7. УДАЛЕНИЕ
  // ==========================================
  async function safeDelete(stop) {
    if (!confirm(`Удалить остановку "${stop.name}"?`)) return;
    try {
      const { data: links } = await window.sb.from('route_stops').select('routes(name)').eq('stop_id', stop.id);
      if (links && links.length > 0) {
        if (confirm(`Остановка в маршрутах: ${links.map(l=>l.routes.name).join(', ')}. Сделать её "Закрыта"?`)) {
          await window.sb.from('stops').update({ status: 'closed' }).eq('id', stop.id);
          UI.toast('Остановка закрыта', 'ok');
          loadData();
        }
        return;
      }
      await window.sb.from('stops').delete().eq('id', stop.id);
      UI.toast('Остановка удалена', 'ok');
      loadData();
    } catch (err) {
      UI.toast(err.message, 'err');
    }
  }

  // ==========================================
  // 8. МОДАЛКИ (Импорт)
  // ==========================================
  function openImportModal() {
    const m = UI.createModal({ title: 'Импорт JSON' });
    m.body.innerHTML = `
      <div class="form-group">
        <textarea class="json-area" id="json-input" placeholder='[{"name": "Остановка", "city_name": "Уджан", "latitude": 40.12, "longitude": 9.01}]'></textarea>
      </div>
      <div class="modal__actions">
        <button class="btn" id="cancel-json">Отмена</button>
        <button class="btn btn--brand" id="run-import">Импортировать</button>
      </div>
    `;
    m.body.querySelector('#cancel-json').onclick = m.close;
    m.body.querySelector('#run-import').onclick = async () => {
      let arr;
      try { arr = JSON.parse(m.body.querySelector('#json-input').value); if (!Array.isArray(arr)) throw new Error(); } 
      catch (e) { return UI.toast('Неверный JSON', 'err'); }

      const valid = arr.map(x => {
        let sId = x.settlement_id;
        if (!sId && x.city_name) {
          const c = allCities.find(c => c.name.toLowerCase() === x.city_name.toLowerCase());
          if (c) sId = c.id;
        }
        return { stop_code: String(x.code || '').padStart(6, '0') || null, name: x.name, address: x.address || null, latitude: Number(x.latitude), longitude: Number(x.longitude), settlement_id: sId, status: 'active' };
      }).filter(x => x.name && x.latitude && x.longitude);

      if (!valid.length) return UI.toast('Нет валидных данных', 'err');
      try {
        const { error } = await window.sb.from('stops').insert(valid);
        if (error) throw error;
        UI.toast(`Импортировано: ${valid.length}`, 'ok'); m.close(); loadData();
      } catch (err) { UI.toast(err.message, 'err'); }
    };
  }

  // ==========================================
  // 9. НАСТРОЙКИ
  // ==========================================
  function buildSettings() {
    const btn = document.createElement('button');
    btn.innerHTML = 'Настройки';
    btn.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:3000; padding:10px 20px; background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:6px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
    document.body.appendChild(btn);

    const overlay = document.createElement('div'); overlay.className = 'settings-overlay'; document.body.appendChild(overlay);
    const panel = document.createElement('div'); panel.className = 'settings-panel';
    panel.innerHTML = `
      <button class="settings-close" id="close-settings">&times;</button>
      <h2 style="margin-top:0; font-size:20px;">Настройки</h2>
      
      <div class="settings-group">
        <h3>Интерфейс</h3>
        <label style="display:block; margin-bottom:12px;"><input type="checkbox" id="set-coords" ${settings.showCoords ? 'checked':''}/> Показывать координаты</label>
      </div>
      <div class="settings-group">
        <h3>Карта</h3>
        <p style="font-size:12px; color:var(--muted); margin-top:0;">Переместите карту в нужное место и нажмите кнопку ниже, чтобы сохранить стартовый вид.</p>
        <button class="btn btn--brand" id="set-center" style="width:100%; margin-bottom:8px;">Зафиксировать вид</button>
      </div>
      <div class="settings-group">
        <h3>Данные</h3>
        <button class="btn" id="btn-import" style="width:100%; margin-bottom:8px;">Импорт JSON</button>
        <button class="btn" id="btn-export" style="width:100%;">Экспорт CSV</button>
      </div>
    `;
    document.body.appendChild(panel);

    const close = () => { panel.classList.remove('open'); overlay.classList.remove('open'); };
    btn.onclick = () => { panel.classList.add('open'); overlay.classList.add('open'); };
    overlay.onclick = close;
    panel.querySelector('#close-settings').onclick = close;

    panel.querySelector('#set-coords').onchange = e => { settings.showCoords = e.target.checked; saveSettings(); renderTable(); };
    panel.querySelector('#set-center').onclick = () => {
      if (map) {
        settings.mapCenter = [map.getCenter().lat, map.getCenter().lng];
        settings.mapZoom = map.getZoom();
        saveSettings(); UI.toast('Вид сохранен', 'ok');
      }
    };
    panel.querySelector('#btn-import').onclick = () => { close(); openImportModal(); };
    panel.querySelector('#btn-export').onclick = () => {
      let csv = '\uFEFFКод;Город;Название;Адрес;Широта;Долгота;Статус\n';
      allStops.forEach(s => {
        const city = s.settlements ? s.settlements.name : '';
        csv += `${s.stop_code};${city};"${s.name}";"${s.address||''}";${s.latitude};${s.longitude};${s.status}\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'stops.csv'; link.click();
    };
  }

  // ==========================================
  // 10. ИНЖЕКТ HTML
  // ==========================================
  function injectHTML() {
    if (!window.UI || !window.UI.renderShell) return false;
    const profile = window.currentProfile || { role: 'admin', full_name: 'Администратор' };
    const content = window.UI.renderShell({ title: 'Остановки', profile: profile, active: 'stops.html' });
    content.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'master-layout';

    layout.innerHTML = `
      <div class="master-left">
        <div class="add-card">
          <h3 id="form-title">Новая остановка</h3>
          <form id="add-form" class="form-grid">
            <div class="form-group full-width">
              <label>Город *</label>
              <select id="f-city" required></select>
            </div>
            <div class="form-group">
              <label>Код</label>
              <input id="f-code" maxlength="6" placeholder="000001" style="font-family:monospace;" />
            </div>
            <div class="form-group">
              <label>Название *</label>
              <input id="f-name" required />
            </div>
            <div class="form-group full-width">
              <label>Адрес</label>
              <input id="f-addr" placeholder="Улица, дом" />
            </div>
            <div class="form-group full-width">
              <label>Координаты *</label>
              <input id="f-coords" readonly placeholder="Кликните по карте" />
            </div>
            <div class="full-width" style="margin-top:8px; display:flex; gap:8px;">
              <button type="submit" class="btn btn--brand" id="btn-save" style="flex:1;">Добавить</button>
              <button type="button" class="btn" id="btn-cancel-edit" style="display:none;">Отмена</button>
            </div>
          </form>
        </div>
        <div class="list-card">
          <div class="list-header">
            <select id="filter-city" style="flex:1;"><option value="all">Все города</option></select>
            <select id="filter-status" style="flex:1;">
              <option value="all">Все статусы</option>
              <option value="active">Активна</option>
              <option value="reconstruction">Реконструкция</option>
              <option value="closed">Закрыта</option>
            </select>
            <input id="search-input" placeholder="Поиск..." style="flex:1;" />
          </div>
          <div id="bulk-panel" class="bulk-panel">
            <span id="bulk-count"></span>
            <select id="bulk-status">
              <option value="active">Сделать Активными</option>
              <option value="reconstruction">Реконструкция</option>
              <option value="closed">Закрытыми</option>
            </select>
            <button class="btn btn--sm btn--brand" id="btn-bulk-apply">Применить</button>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style="width:30px; text-align:center;"><input type="checkbox" id="check-all" /></th>
                  <th data-sort="stop_code">Код ↕</th>
                  <th data-sort="name">Название / Адрес ↕</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody id="tbody-list"></tbody>
            </table>
          </div>
          <div class="pagination">
            <button id="btn-prev">← Назад</button>
            <span id="page-info" style="font-size:12px; color:var(--muted);"></span>
            <button id="btn-next">Вперед →</button>
          </div>
        </div>
      </div>
      <div class="master-right"><div id="main-map"></div></div>
    `;
    content.appendChild(layout);
    return true;
  }

  // ==========================================
  // 11. СОБЫТИЯ
  // ==========================================
  function setupEvents() {
    const form = document.getElementById('add-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (isProcessing) return;
      
      const cityId = document.getElementById('f-city').value;
      const name = document.getElementById('f-name').value.trim();
      const code = document.getElementById('f-code').value.trim();
      const address = document.getElementById('f-addr').value.trim();
      const coords = document.getElementById('f-coords').value;

      if (!cityId) return UI.toast('Выберите город', 'err');
      if (!name) return UI.toast('Введите название', 'err');
      if (!coords) return UI.toast('Кликните по карте', 'err');

      const [lat, lng] = coords.split(',').map(Number);
      
      // Проверка на дубликаты
      const isDuplicate = allStops.some(s => s.id !== editId && (s.name.toLowerCase() === name.toLowerCase() || (Math.abs(s.latitude - lat) < 0.0001 && Math.abs(s.longitude - lng) < 0.0001)));
      if (isDuplicate && !confirm('Похоже, такая остановка уже есть (совпадает имя или координаты). Продолжить?')) return;

      isProcessing = true;
      const btn = document.getElementById('btn-save');
      btn.disabled = true; btn.textContent = 'Сохранение...';

      const payload = { stop_code: code ? code.padStart(6, '0') : null, name, address, latitude: lat, longitude: lng, settlement_id: cityId };

      try {
        const { error } = editId 
          ? await window.sb.from('stops').update(payload).eq('id', editId)
          : await window.sb.from('stops').insert({ ...payload, status: 'active' });

        if (error) throw error;
        UI.toast(editId ? 'Обновлено' : 'Добавлено', 'ok');
        resetForm();
        await loadData();
      } catch (err) {
        UI.toast(err.message, 'err');
      } finally {
        isProcessing = false; btn.disabled = false;
      }
    };

    document.getElementById('btn-cancel-edit').onclick = resetForm;
    document.getElementById('search-input').oninput = UI.debounce(e => { filterQuery = e.target.value; currentPage = 1; renderTable(); }, 300);
    document.getElementById('filter-city').onchange = e => { filterCity = e.target.value; currentPage = 1; renderTable(); };
    document.getElementById('filter-status').onchange = e => { filterStatus = e.target.value; currentPage = 1; renderTable(); };

    document.getElementById('btn-prev').onclick = () => { if (currentPage > 1) { currentPage--; renderTable(); } };
    document.getElementById('btn-next').onclick = () => { currentPage++; renderTable(); };

    document.getElementById('check-all').onchange = (e) => {
      document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = e.target.checked;
        if (e.target.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        cb.closest('tr').classList.toggle('selected', e.target.checked);
      });
      updateBulkPanel();
    };
    document.getElementById('btn-bulk-apply').onclick = () => bulkChangeStatus(document.getElementById('bulk-status').value);

    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.onclick = () => {
        const field = th.dataset.sort;
        if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortField = field; sortDir = 'asc'; }
        renderTable();
      };
    });
  }

  // ==========================================
  // 12. СТАРТ
  // ==========================================
  async function main() {
    try { if (window.Auth && window.Auth.requireStaff) await window.Auth.requireStaff(); } catch (e) { return; }
    loadSettings();
    if (!injectHTML()) return;
    setupEvents();
    buildSettings();
    
    setTimeout(() => {
      initMap();
      setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    }, 100);

    await loadData();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();

})();
