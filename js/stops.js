(function () {
  'use strict';

  let allStops = []; 
  let allCities = [];
  let map = null; 
  let addMarker = null;
  let currentTab = 'list';
  let editId = null; 
  let isProcessing = false;

  // Настройки с дефолтными значениями
  let settings = {
    sound: true,
    showCoords: true,
    mapCenter: [40.1209, 9.0129], // Уджан
    mapZoom: 8
  };

  let contentArea, navTabs, mapContainer;

  // ==========================================
  // 1. УТИЛИТЫ И НАСТРОЙКИ
  // ==========================================
  function loadSettings() {
    const s = localStorage.getItem('stops_settings_v7');
    if (s) { 
      try { 
        settings = { ...settings, ...JSON.parse(s) }; 
      } catch(e) { console.warn('Ошибка загрузки настроек:', e); } 
    }
  }

  function saveSettings() { 
    localStorage.setItem('stops_settings_v7', JSON.stringify(settings)); 
  }

  function playBeep(success) {
    if (!settings.sound) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = success ? 880 : 220;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch(e) {}
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }

  // ==========================================
  // 2. ЗАГРУЗКА ДАННЫХ
  // ==========================================
  async function loadData() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const [rStops, rCities] = await Promise.all([
        window.sb.from('stops').select('*, settlements(name)').order('stop_code', { ascending: false }),
        window.sb.from('settlements').select('*').order('name')
      ]);
      
      if (rStops.error) throw rStops.error;
      if (rCities.error) throw rCities.error;
      
      allStops = rStops.data || [];
      allCities = rCities.data || [];
      
      if (currentTab === 'list') renderTable();
      if (currentTab === 'add') renderMapMarkers();
      
    } catch (err) {
      UI.toast('Ошибка загрузки: ' + err.message, 'err');
      playBeep(false);
    } finally {
      isProcessing = false;
    }
  }

  // ==========================================
  // 3. ВКЛАДКА 1: РЕЕСТР
  // ==========================================
  function renderListTab(container) {
    document.body.classList.remove('fullscreen');
    
    container.innerHTML = `
      <div class="table-wrapper">
        <div class="table-header">
          <select id="filter-city" style="flex:1;"><option value="all">Все города</option></select>
          <select id="filter-status" style="flex:1;">
            <option value="all">Все статусы</option>
            <option value="active">Активна</option>
            <option value="reconstruction">Реконструкция</option>
            <option value="closed">Закрыта</option>
          </select>
          <input id="search-input" placeholder="Поиск по названию, коду, адресу..." style="flex:2;" />
          <button class="btn" id="btn-refresh">Обновить</button>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Город</th>
                <th>Название / Адрес</th>
                ${settings.showCoords ? '<th>Координаты</th>' : ''}
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody id="tbody-list"></tbody>
          </table>
        </div>
      </div>
    `;

    const filterCity = container.querySelector('#filter-city');
    allCities.forEach(c => filterCity.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escapeHtml(c.name)}</option>`));

    // Слушатели фильтров
    container.querySelector('#search-input').addEventListener('input', UI.debounce(renderTable, 300));
    container.querySelector('#filter-status').addEventListener('change', renderTable);
    container.querySelector('#filter-city').addEventListener('change', renderTable);
    container.querySelector('#btn-refresh').addEventListener('click', loadData);

    renderTable();
  }

  function renderTable() {
    const tbody = document.getElementById('tbody-list');
    if (!tbody) return;

    const q = document.getElementById('search-input').value.toLowerCase().trim();
    const st = document.getElementById('filter-status').value;
    const ct = document.getElementById('filter-city').value;

    tbody.innerHTML = '';
    
    const filtered = allStops.filter(s => {
      const matchQ = !q || (s.name||'').toLowerCase().includes(q) || (s.stop_code||'').includes(q) || (s.address||'').toLowerCase().includes(q);
      const matchSt = st === 'all' || (s.status || 'active') === st;
      const matchCt = ct === 'all' || s.settlement_id === ct;
      return matchQ && matchSt && matchCt;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--muted);">Ничего не найдено</td></tr>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(s => {
      const cityName = s.settlements ? s.settlements.name : '—';
      const statusClass = s.status === 'active' ? 'active' : (s.status === 'closed' ? 'closed' : 'reconstruction');
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge--muted" style="font-family:monospace;">${escapeHtml(s.stop_code || '—')}</span></td>
        <td>${escapeHtml(cityName)}</td>
        <td>
          <div style="font-weight:600;">${escapeHtml(s.name)}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">${escapeHtml(s.address || 'Без адреса')}</div>
        </td>
        ${settings.showCoords ? `<td style="font-family:monospace; font-size:12px;">${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</td>` : ''}
        <td>
          <select class="status-select ${statusClass}" data-id="${s.id}">
            <option value="active" ${s.status === 'active' ? 'selected' : ''}>Активна</option>
            <option value="reconstruction" ${s.status === 'reconstruction' ? 'selected' : ''}>Реконструкция</option>
            <option value="closed" ${s.status === 'closed' ? 'selected' : ''}>Закрыта</option>
          </select>
        </td>
        <td style="white-space: nowrap;">
          <button class="btn btn--sm edit-btn" style="margin-right:4px;">Изменить</button>
          <button class="btn btn--sm btn--danger del-btn">Удалить</button>
        </td>
      `;

      // Обработчик смены статуса
      tr.querySelector('.status-select').addEventListener('change', async (e) => {
        const newStatus = e.target.value;
        const oldStatus = s.status;
        
        // Меняем класс визуально
        e.target.className = `status-select ${newStatus === 'active' ? 'active' : (newStatus === 'closed' ? 'closed' : 'reconstruction')}`;
        
        try {
          const { error } = await window.sb.from('stops').update({ status: newStatus }).eq('id', s.id);
          if (error) throw error;
          UI.toast('Статус обновлен', 'ok');
          playBeep(true);
          s.status = newStatus;
        } catch (err) {
          UI.toast('Ошибка: ' + err.message, 'err');
          playBeep(false);
          e.target.value = oldStatus; // Откат
          e.target.className = `status-select ${oldStatus === 'active' ? 'active' : (oldStatus === 'closed' ? 'closed' : 'reconstruction')}`;
        }
      });

      tr.querySelector('.edit-btn').addEventListener('click', () => switchTab('add', s));
      tr.querySelector('.del-btn').addEventListener('click', () => safeDelete(s));
      
      fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
  }

  // ==========================================
  // 4. ВКЛАДКА 2: ДОБАВЛЕНИЕ (СПЛИТ 30/70)
  // ==========================================
  function renderAddTab(container, stopToEdit = null) {
    document.body.classList.add('fullscreen');
    editId = stopToEdit ? stopToEdit.id : null;

    container.innerHTML = `
      <div class="split-layout">
        <div class="split-left">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0; font-size:18px;">${editId ? 'Редактирование' : 'Новая остановка'}</h3>
            <button type="button" class="btn btn--sm" id="btn-close-add">Закрыть</button>
          </div>
          
          <form id="add-form" style="display:flex; flex-direction:column; flex:1;">
            <div class="form-group">
              <label>Населенный пункт *</label>
              <div style="display:flex; gap:8px;">
                <select id="f-city" style="flex:1;" required>
                  <option value="">— Выберите город —</option>
                </select>
                <button type="button" class="btn" id="btn-new-city" style="padding:0 12px; font-weight:bold;">+</button>
              </div>
            </div>

            <div class="form-group">
              <label>Код (6 цифр)</label>
              <input id="f-code" maxlength="6" placeholder="000001" style="font-family:monospace;" />
            </div>

            <div class="form-group">
              <label>Название *</label>
              <input id="f-name" required placeholder="Улица, микрорайон" />
            </div>

            <div class="form-group">
              <label>Адрес / Ориентир</label>
              <textarea id="f-addr" rows="2" placeholder="Например: ул. Ленина, д. 5"></textarea>
            </div>

            <div class="form-group">
              <label>Координаты *</label>
              <input id="f-coords" readonly placeholder="Кликните по карте справа" style="font-family:monospace;" />
            </div>

            <div style="margin-top:auto; display:flex; flex-direction:column; gap:8px; padding-top:16px;">
              <button type="submit" class="btn btn--brand" id="btn-save" style="width:100%; padding:12px;">${editId ? 'Сохранить изменения' : 'Добавить остановку'}</button>
              <div style="font-size:11px; color:var(--muted); text-align:center;">Ctrl+Enter — сохранить, Esc — отмена</div>
            </div>
          </form>
        </div>
        
        <div class="split-right">
          <div id="map-add"></div>
        </div>
      </div>
    `;

    const sel = container.querySelector('#f-city');
    allCities.forEach(c => sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escapeHtml(c.name)}</option>`));

    const coordsInput = container.querySelector('#f-coords');
    const codeInput = container.querySelector('#f-code');
    const form = container.querySelector('#add-form');

    // Заполнение при редактировании
    if (stopToEdit) {
      sel.value = stopToEdit.settlement_id || '';
      codeInput.value = stopToEdit.stop_code || '';
      container.querySelector('#f-name').value = stopToEdit.name || '';
      container.querySelector('#f-addr').value = stopToEdit.address || '';
      coordsInput.value = `${stopToEdit.latitude}, ${stopToEdit.longitude}`;
    }

    // Инициализация карты (с задержкой)
    setTimeout(() => {
      if (map) map.remove();
      mapContainer = document.getElementById('map-add');
      
      // Инициализация строго по сохраненным координатам
      map = L.map('map-add').setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      
      if (stopToEdit) {
        map.setView([stopToEdit.latitude, stopToEdit.longitude], 16);
        placeMarker(stopToEdit.latitude, stopToEdit.longitude, coordsInput);
      }

      map.on('click', (e) => {
        placeMarker(e.latlng.lat, e.latlng.lng, coordsInput);
      });

      renderMapMarkers();
      
      // Фикс "серого" экрана Leaflet
      setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    }, 100);

    // Обработчики формы
    container.querySelector('#btn-close-add').onclick = () => switchTab('list');
    container.querySelector('#btn-new-city').onclick = () => openCityModal(sel);
    
    codeInput.onblur = () => { 
      if (codeInput.value) codeInput.value = codeInput.value.replace(/\D/g, '').padStart(6, '0'); 
    };

    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { 
        e.preventDefault(); 
        form.dispatchEvent(new Event('submit')); 
      }
      if (e.key === 'Escape') { 
        switchTab('list'); 
      }
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (isProcessing) return;
      if (!sel.value) return UI.toast('Выберите город', 'err');
      if (!coordsInput.value) return UI.toast('Кликните по карте для координат', 'err');

      const [lat, lng] = coordsInput.value.split(',').map(Number);
      
      if (isNaN(lat) || isNaN(lng)) return UI.toast('Неверные координаты', 'err');

      const payload = {
        stop_code: codeInput.value || null,
        name: container.querySelector('#f-name').value.trim(),
        address: container.querySelector('#f-addr').value.trim(),
        latitude: lat,
        longitude: lng,
        settlement_id: sel.value
      };

      if (!payload.name) return UI.toast('Введите название', 'err');

      const btn = container.querySelector('#btn-save');
      btn.disabled = true; btn.textContent = 'Сохранение...';
      isProcessing = true;

      try {
        const { error } = editId 
          ? await window.sb.from('stops').update(payload).eq('id', editId)
          : await window.sb.from('stops').insert({ ...payload, status: 'active' });

        if (error) throw error;
        
        playBeep(true);
        UI.toast(editId ? 'Обновлено' : 'Добавлено', 'ok');
        
        if (editId) {
          switchTab('list');
        } else {
          form.reset();
          coordsInput.value = '';
          if (addMarker) { map.removeLayer(addMarker); addMarker = null; }
          codeInput.focus();
          loadData();
        }
      } catch (err) {
        playBeep(false);
        UI.toast('Ошибка: ' + err.message, 'err');
      } finally {
        isProcessing = false;
        btn.disabled = false; 
        btn.textContent = editId ? 'Сохранить изменения' : 'Добавить остановку';
      }
    };
  }

  // ==========================================
  // 5. ВКЛАДКА 3: ИМПОРТ
  // ==========================================
  function renderMassTab(container) {
    document.body.classList.add('fullscreen');
    container.innerHTML = `
      <div style="height:100vh; padding:40px; background:var(--bg); display:flex; justify-content:center; align-items:flex-start;">
        <div style="width:100%; max-width:800px; background:var(--panel); padding:30px; border-radius:12px; border:1px solid var(--border);">
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <h2 style="margin:0;">Массовое добавление (JSON)</h2>
            <button class="btn" id="btn-close-mass">Закрыть</button>
          </div>

          <div class="drop-zone" id="drop-zone">
            Перетащите .json файл сюда<br><br>
            <button class="btn btn--brand" id="btn-browse">Выбрать файл</button>
          </div>
          <input type="file" id="file-input" accept=".json" style="display:none;" />

          <div class="form-group">
            <label>Или вставьте текст JSON:</label>
            <textarea class="json-area" id="json-input" placeholder='[{"name": "Остановка", "city_name": "Уджан", "latitude": 40.12, "longitude": 9.01}]'></textarea>
          </div>

          <div style="display:flex; gap:12px; justify-content:space-between;">
            <button class="btn" id="btn-download-example">Скачать пример файла</button>
            <button class="btn btn--brand" id="btn-import" style="flex:1;">Запустить импорт</button>
          </div>
        </div>
      </div>
    `;

    const area = container.querySelector('#json-input');
    const dropZone = container.querySelector('#drop-zone');
    const fileInput = container.querySelector('#file-input');

    container.querySelector('#btn-close-mass').onclick = () => switchTab('list');
    
    container.querySelector('#btn-browse').onclick = () => fileInput.click();
    
    fileInput.onchange = (e) => {
      const f = e.target.files[0];
      if (f) { 
        const r = new FileReader(); 
        r.onload = ev => area.value = ev.target.result; 
        r.readAsText(f); 
      }
    };

    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = (e) => {
      e.preventDefault(); dropZone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f && f.name.endsWith('.json')) { 
        const r = new FileReader(); 
        r.onload = ev => area.value = ev.target.result; 
        r.readAsText(f); 
      } else {
        UI.toast('Нужен файл с расширением .json', 'err');
      }
    };

    container.querySelector('#btn-download-example').onclick = () => {
      const example = `[\n  {\n    "name": "Центральный рынок",\n    "city_name": "Уджан",\n    "address": "ул. Ленина, 10",\n    "latitude": 40.1209,\n    "longitude": 9.0129\n  }\n]`;
      const blob = new Blob([example], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'stops_example.json';
      link.click();
    };

    container.querySelector('#btn-import').onclick = async () => {
      const btn = container.querySelector('#btn-import');
      let arr;
      try { 
        arr = JSON.parse(area.value); 
        if (!Array.isArray(arr)) throw new Error('Ожидается массив [ ... ]'); 
      } catch (e) { 
        playBeep(false);
        return UI.toast('Неверный JSON: ' + e.message, 'err'); 
      }

      const valid = arr.map(x => {
        let sId = x.settlement_id;
        if (!sId && x.city_name) {
          const c = allCities.find(c => c.name.toLowerCase() === x.city_name.toLowerCase());
          if (c) sId = c.id;
        }
        return {
          stop_code: String(x.code || '').padStart(6, '0') || null,
          name: x.name, 
          address: x.address || null,
          latitude: Number(x.latitude), 
          longitude: Number(x.longitude),
          settlement_id: sId, 
          status: 'active'
        };
      }).filter(x => x.name && x.latitude && x.longitude);

      if (!valid.length) { playBeep(false); return UI.toast('Нет валидных записей', 'err'); }

      btn.disabled = true; btn.textContent = 'Загрузка...';
      
      try {
        const { error } = await window.sb.from('stops').insert(valid);
        if (error) throw error;
        playBeep(true); 
        UI.toast(`Успешно импортировано: ${valid.length}`, 'ok'); 
        area.value = ''; 
        switchTab('list');
        loadData();
      } catch(err) {
        playBeep(false);
        UI.toast(err.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = 'Запустить импорт';
      }
    };
  }

  // ==========================================
  // 6. ВКЛАДКА 4: КАРТА
  // ==========================================
  function renderMapTab(container) {
    document.body.classList.remove('fullscreen');
    container.innerHTML = `
      <div style="height: calc(100vh - 160px); border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border);">
        <div id="map-all" style="width:100%; height:100%;"></div>
      </div>
    `;
    
    setTimeout(() => {
      if (map) map.remove();
      map = L.map('map-all').setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      renderMapMarkers();
      setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    }, 100);
  }

  // ==========================================
  // 7. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ==========================================
  function placeMarker(lat, lng, input) {
    if (!map) return;
    if (addMarker) map.removeLayer(addMarker);
    addMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    addMarker.on('dragend', () => {
      const p = addMarker.getLatLng();
      input.value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    });
    input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  function renderMapMarkers() {
    if (!map) return;
    map.eachLayer(l => { if (l instanceof L.Marker && l !== addMarker) map.removeLayer(l); });
    
    allStops.forEach(s => {
      if (s.status === 'closed') return;
      const popup = document.createElement('div');
      popup.innerHTML = `
        <div style="font-family:sans-serif; min-width:200px;">
          <h4 style="margin:0 0 8px; font-size:14px; color:#000;">${escapeHtml(s.name)}</h4>
          <div style="font-size:12px; color:#555; margin-bottom:4px;"><b>Код:</b> ${escapeHtml(s.stop_code)}</div>
          <div style="font-size:12px; color:#555; margin-bottom:8px;"><b>Адрес:</b> ${escapeHtml(s.address || '—')}</div>
          <div style="display:flex; gap:6px;">
            <button class="p-edit" style="flex:1; padding:6px; cursor:pointer; background:#2563eb; color:#fff; border:none; border-radius:4px;">Изменить</button>
          </div>
        </div>
      `;
      popup.querySelector('.p-edit').onclick = () => switchTab('add', s);
      L.marker([s.latitude, s.longitude]).addTo(map).bindPopup(popup);
    });
  }

  function safeDelete(stop) {
    if (!confirm(`Удалить остановку "${stop.name}"? Это необратимо.`)) return;
    
    // Проверка связей
    window.sb.from('route_stops').select('routes(name)').eq('stop_id', stop.id).then(({data: links}) => {
      if (links && links.length > 0) {
        playBeep(false);
        const names = links.map(l => l.routes.name).join(', ');
        if (confirm(`Удаление заблокировано! Остановка в маршрутах: ${names}.\n\nСделать её неактивной (Закрыта)?`)) {
          window.sb.from('stops').update({ status: 'closed' }).eq('id', stop.id).then(() => {
            UI.toast('Остановка закрыта', 'ok');
            loadData();
          });
        }
        return;
      }
      
      window.sb.from('stops').delete().eq('id', stop.id).then(({ error }) => {
        if (error) return UI.toast(error.message, 'err');
        UI.toast('Остановка удалена', 'ok');
        playBeep(true);
        loadData();
      });
    });
  }

  function openCityModal(selectEl) {
    const m = UI.createModal({ title: 'Новый населенный пункт' });
    m.body.innerHTML = `
      <div class="form-group"><label>Название города *</label><input id="new-city-name" required /></div>
      <div class="modal__actions">
        <button class="btn" id="cancel-city">Отмена</button>
        <button class="btn btn--brand" id="save-city">Добавить</button>
      </div>
    `;
    m.body.querySelector('#cancel-city').onclick = m.close;
    m.body.querySelector('#save-city').onclick = async () => {
      const name = m.body.querySelector('#new-city-name').value.trim();
      if (!name) return;
      const center = map ? map.getCenter() : { lat: settings.mapCenter[0], lng: settings.mapCenter[1] };
      
      try {
        const { data, error } = await window.sb.from('settlements').insert({ name, lat: center.lat, lng: center.lng }).select().single();
        if (error) throw error;
        
        UI.toast('Город добавлен', 'ok');
        playBeep(true);
        m.close();
        allCities.push(data);
        
        if (selectEl) {
          selectEl.insertAdjacentHTML('beforeend', `<option value="${data.id}">${escapeHtml(data.name)}</option>`);
          selectEl.value = data.id;
        }
      } catch (err) {
        UI.toast(err.message, 'err');
      }
    };
  }

  // ==========================================
  // 8. НАСТРОЙКИ (Панель)
  // ==========================================
  function buildSettings() {
    const btn = document.createElement('button');
    btn.className = 'settings-btn';
    btn.innerHTML = 'Настройки';
    btn.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:3000; padding:10px 20px; background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:6px; cursor:pointer; font-weight:bold;';
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.innerHTML = `
      <button class="settings-close" id="close-settings">&times;</button>
      <h2 style="margin-top:0; font-size:20px;">Настройки</h2>
      
      <div class="settings-group">
        <h3>Интерфейс</h3>
        <label style="display:block; margin-bottom:12px;"><input type="checkbox" id="set-sound" ${settings.sound ? 'checked':''}/> Звуковой отклик</label>
        <label style="display:block; margin-bottom:12px;"><input type="checkbox" id="set-coords" ${settings.showCoords ? 'checked':''}/> Показывать координаты в таблице</label>
      </div>

      <div class="settings-group">
        <h3>Карта</h3>
        <p style="font-size:12px; color:var(--muted); margin-top:0;">Переместите карту в нужное место и нажмите кнопку ниже, чтобы сохранить вид.</p>
        <button class="btn btn--brand" id="set-center" style="width:100%;">Зафиксировать текущий вид карты</button>
      </div>

      <div class="settings-group">
        <button class="btn btn--danger" id="set-reset" style="width:100%;">Сбросить настройки</button>
      </div>
    `;
    document.body.appendChild(panel);

    const close = () => { panel.classList.remove('open'); overlay.classList.remove('open'); };
    btn.onclick = () => { panel.classList.add('open'); overlay.classList.add('open'); };
    overlay.onclick = close;
    panel.querySelector('#close-settings').onclick = close;

    panel.querySelector('#set-sound').onchange = e => { settings.sound = e.target.checked; saveSettings(); };
    panel.querySelector('#set-coords').onchange = e => { settings.showCoords = e.target.checked; saveSettings(); if (currentTab === 'list') switchTab('list'); };
    
    panel.querySelector('#set-center').onclick = () => {
      if (map) {
        settings.mapCenter = [map.getCenter().lat, map.getCenter().lng];
        settings.mapZoom = map.getZoom();
        saveSettings();
        UI.toast('Вид карты сохранен', 'ok');
      } else {
        UI.toast('Откройте вкладку с картой', 'err');
      }
    };

    panel.querySelector('#set-reset').onclick = () => {
      if (confirm('Сбросить настройки?')) {
        localStorage.removeItem('stops_settings_v7');
        location.reload();
      }
    };
  }

  // ==========================================
  // 9. ГЛАВНЫЙ КОНТРОЛЛЕР
  // ==========================================
  function switchTab(tab, editStop = null) {
    currentTab = tab;
    contentArea.innerHTML = '';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'list') renderListTab(contentArea);
    if (tab === 'add') renderAddTab(contentArea, editStop);
    if (tab === 'mass') renderMassTab(contentArea);
    if (tab === 'map') renderMapTab(contentArea);
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    loadSettings();
    const content = UI.renderShell({ title: 'Остановки', profile, active: 'stops.html' });
    
    // Создаем контейнер для вкладок
    const tabsWrapper = document.createElement('div');
    tabsWrapper.className = 'tabs-container';
    tabsWrapper.innerHTML = `
      <button class="tab-btn active" data-tab="list">Реестр</button>
      <button class="tab-btn" data-tab="add">Добавление</button>
      <button class="tab-btn" data-tab="mass">Импорт</button>
      <button class="tab-btn" data-tab="map">Карта</button>
    `;
    tabsWrapper.onclick = (e) => {
      const b = e.target.closest('.tab-btn');
      if (b) switchTab(b.dataset.tab);
    };

    // Вставляем вкладки перед контентом
    content.parentElement.insertBefore(tabsWrapper, content);
    contentArea = content;

    buildSettings();
    await loadData();
    switchTab('list');
  }

  document.addEventListener('DOMContentLoaded', main);
})();
