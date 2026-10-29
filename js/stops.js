(function () {
  // --- Глобальное состояние ---
  let allStops = [];
  let allSettlements = [];
  let mapAdd = null, mapAll = null, addMarker = null;
  let currentTab = 'list';
  let currentSort = { field: 'stop_code', dir: 'desc' };
  let editId = null;

  // Настройки сессии
  let settings = {
    soundEnabled: true,
    isMirrored: false,
    splitRatio: 30,
    mapCenter: [40.1209, 9.0129], // Центр Сардинии
    mapZoom: 8
  };

  // DOM-элементы
  let contentArea, navTabs;
  let tbody, searchInput, statusFilter, cityFilter;
  let settingsPanel, addForm;

  // ==========================================
  // 1. УТИЛИТЫ
  // ==========================================
  function loadSettings() {
    const saved = localStorage.getItem('stops_settings');
    if (saved) { try { settings = { ...settings, ...JSON.parse(saved) }; } catch(e) {} }
  }
  function saveSettings() { localStorage.setItem('stops_settings', JSON.stringify(settings)); }

  function playBeep(success = true) {
    if (!settings.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = success ? 880 : 220;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  // ==========================================
  // 2. ЗАГРУЗКА ДАННЫХ
  // ==========================================
  async function loadData() {
    const [stopsRes, settleRes] = await Promise.all([
      window.sb.from('stops').select('*, settlements(name)'),
      window.sb.from('settlements').select('*').order('name')
    ]);
    
    if (stopsRes.error) UI.toast(stopsRes.error.message, 'err');
    else { allStops = stopsRes.data || []; }
    
    if (settleRes.error) UI.toast(settleRes.error.message, 'err');
    else { allSettlements = settleRes.data || []; renderCityDropdowns(); }
    
    if (currentTab === 'list') renderList();
    if (currentTab === 'map') renderAllMap();
  }

  function renderCityDropdowns() {
    if (cityFilter) {
      cityFilter.innerHTML = '<option value="all">Все города</option>';
      allSettlements.forEach(s => cityFilter.insertAdjacentHTML('beforeend', `<option value="${s.id}">${s.name}</option>`));
    }
    const formCity = document.getElementById('f-settlement');
    if (formCity) {
      const currentVal = formCity.value;
      formCity.innerHTML = '<option value="">— Выберите город —</option>';
      allSettlements.forEach(s => formCity.insertAdjacentHTML('beforeend', `<option value="${s.id}">${s.name}</option>`));
      if (currentVal) formCity.value = currentVal;
    }
  }

  // ==========================================
  // 3. БЕЗОПАСНОЕ УДАЛЕНИЕ
  // ==========================================
  async function safeDelete(stop) {
    if (!confirm(`Вы уверены, что хотите полностью удалить остановку "${stop.name}"? Это действие необратимо.`)) return;

    const { data: links } = await window.sb.from('route_stops')
      .select('route_id, routes(code, name)').eq('stop_id', stop.id);

    if (links && links.length > 0) {
      playBeep(false);
      const routeList = links.map(l => `${l.routes.code} — ${l.routes.name}`).join('\n');
      const offerDeactivate = confirm(
        `Удаление заблокировано.\nОстановка привязана к маршрутам:\n${routeList}\n\n` +
        `Нажмите "ОК", чтобы ДЕАКТИВИРОВАТЬ её (статус "Закрыта").\n` +
        `Или "Отмена", чтобы отказаться.`
      );
      if (offerDeactivate) {
        await window.sb.from('stops').update({ status: 'closed' }).eq('id', stop.id);
        UI.toast('Остановка деактивирована', 'ok');
        playBeep(true);
        loadData();
      }
      return;
    }

    const { error } = await window.sb.from('stops').delete().eq('id', stop.id);
    if (error) { UI.toast(error.message, 'err'); playBeep(false); return; }
    UI.toast('Остановка удалена', 'ok');
    playBeep(true);
    loadData();
  }

  // ==========================================
  // 4. РЕЕСТР (ВКЛАДКА 1)
  // ==========================================
  function initListTab() {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="toolbar" style="margin-bottom:16px;">
        <div class="field" style="margin:0;">
          <select id="filter-city"><option value="all">Все города</option></select>
        </div>
        <div class="field" style="margin:0;">
          <select id="filter-status">
            <option value="all">Все статусы</option>
            <option value="active">Активна</option>
            <option value="reconstruction">Реконструкция</option>
            <option value="closed">Закрыта</option>
          </select>
        </div>
        <div class="field field--grow" style="margin:0;">
          <input id="search-input" placeholder="Поиск по названию, коду или адресу" />
        </div>
        <span id="count-badge" class="muted"></span>
      </div>
      <div class="table-wrap" style="max-height: calc(100vh - 260px); overflow-y: auto;">
        <table>
          <thead style="position:sticky;top:0;z-index:10;">
            <tr>
              <th class="sortable" data-field="stop_code">Код</th>
              <th>Город</th>
              <th class="sortable" data-field="name">Название</th>
              <th>Адрес / Ориентир</th>
              <th>Координаты</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody id="tbody-list"></tbody>
        </table>
      </div>
    `;

    searchInput = div.querySelector('#search-input');
    statusFilter = div.querySelector('#filter-status');
    cityFilter = div.querySelector('#filter-city');
    tbody = div.querySelector('#tbody-list');
    const countBadge = div.querySelector('#count-badge');

    searchInput.addEventListener('input', UI.debounce(() => {
      renderList();
      countBadge.textContent = `Найдено: ${tbody.children.length - (tbody.innerHTML.includes('Ничего не найдено') ? 1 : 0)}`;
    }, 300));
    statusFilter.addEventListener('change', renderList);
    cityFilter.addEventListener('change', renderList);

    div.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const f = th.dataset.field;
        if (currentSort.field === f) currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        else currentSort = { field: f, dir: 'asc' };
        renderList();
      });
    });

    return div;
  }

  function renderList() {
    if (!tbody) return;
    const q = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    const cityId = cityFilter.value;

    let filtered = allStops.filter(s => {
      const matchQ = !q || (s.name||'').toLowerCase().includes(q) || (s.stop_code||'').includes(q) || (s.address||'').toLowerCase().includes(q);
      const matchStatus = status === 'all' || (s.status || 'active') === status;
      const matchCity = cityId === 'all' || s.settlement_id === cityId;
      return matchQ && matchStatus && matchCity;
    });

    if (currentSort.field) {
      filtered.sort((a, b) => {
        let valA = a[currentSort.field] || '';
        let valB = b[currentSort.field] || '';
        if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    document.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.field === currentSort.field) th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted);">Ничего не найдено</td></tr>';
      return;
    }

    filtered.forEach(s => {
      const tr = document.createElement('tr');
      const statusMap = { active: ['Активна', 'ok'], reconstruction: ['Реконструкция', 'warn'], closed: ['Закрыта', 'err'] };
      const [label, color] = statusMap[s.status || 'active'] || ['Неизвестно', 'muted'];
      const cityName = s.settlements ? s.settlements.name : '—';

      tr.innerHTML = `
        <td><span class="badge badge--muted" style="font-family:monospace;">${s.stop_code}</span></td>
        <td>${cityName}</td>
        <td>${s.name}</td>
        <td>${s.address || '—'}${s.landmark ? `<br><small style="color:var(--muted)">${s.landmark}</small>` : ''}</td>
        <td style="font-family:monospace; font-size:12px; color:var(--muted);">${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</td>
        <td><span class="badge badge--${color}">${label}</span></td>
        <td>
          <button class="btn btn--sm edit-btn" style="margin-right:4px;">Изменить</button>
          <button class="btn btn--sm btn--danger del-btn">Удалить</button>
        </td>
      `;
      tr.querySelector('.del-btn').addEventListener('click', () => safeDelete(s));
      tr.querySelector('.edit-btn').addEventListener('click', () => {
        switchTab('add');
        fillAddForm(s);
      });
      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // 5. СПЛИТ-ЭКРАН (ВКЛАДКА 2)
  // ==========================================
  function initAddTab() {
    const wrapper = document.createElement('div');
    wrapper.className = 'split-container';
    wrapper.id = 'split-container';

    const formPanel = document.createElement('div');
    formPanel.className = 'split-form-panel split-panel';
    formPanel.id = 'split-form-panel';
    formPanel.innerHTML = `
      <h3 style="margin:0 0 16px; font-weight:600;">Добавление остановки</h3>
      <form id="add-form" class="form" style="flex:1; display:flex; flex-direction:column; gap:16px;">
        
        <div class="field">
          <label>Населенный пункт *</label>
          <div style="display:flex; gap:8px;">
            <select name="settlement" id="f-settlement" style="flex:1;" required>
              <option value="">— Выберите город —</option>
            </select>
            <button type="button" class="btn btn--brand" id="btn-add-city" style="padding:0 12px;" title="Добавить новый город">+</button>
          </div>
        </div>

        <div class="field">
          <label>Код остановки (6 цифр)</label>
          <input name="code" id="f-code" maxlength="6" placeholder="000001" style="font-family:monospace;" />
        </div>

        <div class="field">
          <label>Название остановки *</label>
          <input name="name" id="f-name" required placeholder="Улица или пункт" />
        </div>

        <div class="field">
          <label>Адрес / Ориентир</label>
          <textarea name="addr" id="f-addr" rows="2" placeholder="Дом, строение или ориентир"></textarea>
        </div>

        <div class="field">
          <label>Статус</label>
          <select name="status" id="f-status">
            <option value="active">Активна</option>
            <option value="reconstruction">Реконструкция</option>
            <option value="closed">Закрыта</option>
          </select>
        </div>

        <div class="field">
          <label>Координаты (кликните по карте)</label>
          <input name="coords" id="f-coords" readonly placeholder="Точка не выбрана" />
        </div>
        
        <div style="margin-top:auto; display:flex; flex-direction:column; gap:8px;">
          <button type="submit" class="btn btn--brand" id="btn-save">Сохранить (Ctrl+Enter)</button>
          <div style="font-size:11px; color:var(--muted); text-align:center;">Esc — отмена</div>
        </div>
      </form>
    `;

    const mapPanel = document.createElement('div');
    mapPanel.className = 'split-map-panel split-panel';
    mapPanel.innerHTML = `<div id="add-map"></div>`;

    wrapper.appendChild(formPanel);
    wrapper.appendChild(mapPanel);

    setTimeout(() => {
      mapAdd = L.map('add-map').setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapAdd);
      
      L.Control.geocoder({ defaultMarkGeocode: false, placeholder: 'Поиск адреса' })
        .on('markgeocode', e => { mapAdd.setView(e.geocode.center, 16); placeAddMarker(e.geocode.center.lat, e.geocode.center.lng); })
        .addTo(mapAdd);

      mapAdd.on('click', e => placeAddMarker(e.latlng.lat, e.latlng.lng));
    }, 100);

    // Ресайзер
    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    resizer.onmousedown = () => {
      document.onmousemove = (e) => {
        const rect = wrapper.getBoundingClientRect();
        let percentage = ((e.clientX - rect.left) / rect.width) * 100;
        if (settings.isMirrored) percentage = 100 - percentage;
        percentage = Math.max(20, Math.min(80, percentage));
        formPanel.style.flex = `0 0 ${percentage}%`;
        mapAdd.invalidateSize();
      };
      document.onmouseup = () => {
        document.onmousemove = null;
        document.onmouseup = null;
        settings.splitRatio = ((formPanel.offsetWidth / wrapper.offsetWidth) * 100);
        saveSettings();
      };
    };
    wrapper.appendChild(resizer);

    // Форма
    addForm = formPanel.querySelector('#add-form');
    const codeInput = addForm.querySelector('#f-code');
    const settlementSelect = addForm.querySelector('#f-settlement');
    
    // Кнопка добавления города
    addForm.querySelector('#btn-add-city').onclick = openAddCityModal;

    // Перелет карты при выборе города
    settlementSelect.addEventListener('change', () => {
      const city = allSettlements.find(s => s.id === settlementSelect.value);
      if (city && mapAdd && city.lat && city.lng) {
        mapAdd.setView([city.lat, city.lng], city.zoom || 12);
      }
    });

    codeInput.addEventListener('blur', () => {
      let v = codeInput.value.replace(/\D/g, '');
      if (v) codeInput.value = v.padStart(6, '0');
    });

    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(addForm);
      const coords = fd.get('coords');
      const settlementId = fd.get('settlement');
      
      if (!settlementId) { playBeep(false); return UI.toast('Выберите населенный пункт', 'err'); }
      if (!coords) { playBeep(false); return UI.toast('Укажите координаты на карте', 'err'); }

      const [lat, lng] = coords.split(',').map(n => parseFloat(n));
      const payload = {
        stop_code: codeInput.value.trim() || null,
        name: fd.get('name'),
        address: fd.get('addr'),
        status: fd.get('status'),
        latitude: lat,
        longitude: lng,
        settlement_id: settlementId
      };

      const btn = addForm.querySelector('#btn-save');
      btn.disabled = true; btn.textContent = 'Сохранение...';

      try {
        if (editId) {
          const { error } = await window.sb.from('stops').update(payload).eq('id', editId);
          if (error) throw error;
          UI.toast('Остановка обновлена', 'ok');
          editId = null;
          btn.textContent = 'Сохранить (Ctrl+Enter)';
        } else {
          const { error } = await window.sb.from('stops').insert(payload);
          if (error) throw error;
          UI.toast('Остановка добавлена', 'ok');
          resetForm();
        }
        playBeep(true);
        loadData();
        codeInput.focus();
      } catch (err) {
        playBeep(false);
        UI.toast(err.message, 'err');
      } finally {
        btn.disabled = false; if (btn.textContent === 'Сохранение...') btn.textContent = 'Сохранить (Ctrl+Enter)';
      }
    });

    addForm.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addForm.dispatchEvent(new Event('submit')); }
      if (e.key === 'Escape') {
        if (confirm('Отменить ввод?')) resetForm();
      }
    });

    function resetForm() {
      addForm.reset();
      editId = null;
      addForm.querySelector('#btn-save').textContent = 'Сохранить (Ctrl+Enter)';
      document.getElementById('f-coords').value = '';
      if (addMarker) { mapAdd.removeLayer(addMarker); addMarker = null; }
      document.getElementById('f-code').focus();
    }

    setTimeout(() => {
      if (settings.isMirrored) wrapper.classList.add('mirrored');
      formPanel.style.flex = `0 0 ${settings.splitRatio}%`;
    }, 50);

    return wrapper;
  }

  // Модалка добавления города
  function openAddCityModal() {
    const m = UI.createModal({ title: 'Новый населенный пункт' });
    m.dialog.style.width = '400px';
    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Название города *</label>
        <input name="name" required placeholder="Название" />
      </div>
      <div class="field">
        <label>Область / Регион</label>
        <input name="region" placeholder="Регион" />
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand">Добавить</button>
      </div>
    `;
    m.body.appendChild(form);
    form.querySelector('#cancel-btn').onclick = m.close;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = fd.get('name').trim();
      if (!name) return;

      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '...';

      try {
        // Берем текущие координаты центра карты для нового города
        const center = mapAdd ? mapAdd.getCenter() : { lat: settings.mapCenter[0], lng: settings.mapCenter[1] };
        const { data, error } = await window.sb.from('settlements').insert({
          name: name,
          region: fd.get('region') || null,
          lat: center.lat,
          lng: center.lng,
          zoom: 12
        }).select().single();

        if (error) throw error;
        
        UI.toast('Город добавлен', 'ok');
        playBeep(true);
        m.close();
        
        await loadData();
        const sel = document.getElementById('f-settlement');
        if (sel) {
          sel.value = data.id;
          // Триггерим перелет карты
          sel.dispatchEvent(new Event('change'));
        }
        
      } catch (err) {
        playBeep(false);
        UI.toast(err.message, 'err');
        btn.disabled = false; btn.textContent = 'Добавить';
      }
    };
  }

  function placeAddMarker(lat, lng) {
    if (addMarker) mapAdd.removeLayer(addMarker);
    addMarker = L.marker([lat, lng]).addTo(mapAdd);
    document.getElementById('f-coords').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  function fillAddForm(stop) {
    setTimeout(() => {
      if (!addForm) return;
      editId = stop.id;
      addForm.querySelector('#f-settlement').value = stop.settlement_id || '';
      addForm.querySelector('#f-code').value = stop.stop_code;
      addForm.querySelector('#f-name').value = stop.name;
      addForm.querySelector('#f-addr').value = stop.address || '';
      addForm.querySelector('#f-status').value = stop.status || 'active';
      addForm.querySelector('#f-coords').value = `${stop.latitude}, ${stop.longitude}`;
      addForm.querySelector('#btn-save').textContent = 'Обновить';
      
      if (mapAdd) {
        mapAdd.setView([stop.latitude, stop.longitude], 16);
        placeAddMarker(stop.latitude, stop.longitude);
      }
    }, 150);
  }

  // ==========================================
  // 6. МАССОВОЕ ДОБАВЛЕНИЕ (ВКЛАДКА 3)
  // ==========================================
  function initMassTab() {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="field">
        <label>Импорт данных (JSON)</label>
        <div class="drop-zone" id="drop-zone">Перетащите .json файл сюда или выберите на диске<br><br><button type="button" class="btn" id="btn-browse">Выбрать файл</button></div>
        <input type="file" id="file-input" accept=".json" style="display:none;" />
        <textarea id="json-area" style="height:300px; font-family:monospace; font-size:12px; background:var(--bg); color:var(--text); border:1px solid var(--border); padding:10px; border-radius:8px; resize:vertical;"></textarea>
      </div>
      <div style="display:flex; gap:8px; margin-top:16px;">
        <button class="btn" id="btn-example">Показать пример</button>
        <button class="btn btn--brand" id="btn-load" style="flex:1;">Запустить импорт</button>
      </div>
    `;

    const area = div.querySelector('#json-area');
    const dropZone = div.querySelector('#drop-zone');
    const fileInput = div.querySelector('#file-input');

    const example = `[
  {
    "code": "000101",
    "settlement_name": "Кальяри",
    "name": "Piazza Matteotti",
    "address": "Piazza Matteotti",
    "latitude": 39.2165,
    "longitude": 9.1142
  }
]`;

    div.querySelector('#btn-example').onclick = () => area.value = example;
    div.querySelector('#btn-browse').onclick = () => fileInput.click();
    
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => area.value = ev.target.result;
      reader.readAsText(file);
    };

    dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = e => {
      e.preventDefault(); dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith('.json')) return UI.toast('Только .json файлы', 'err');
      const reader = new FileReader();
      reader.onload = ev => area.value = ev.target.result;
      reader.readAsText(file);
    };

    div.querySelector('#btn-load').onclick = async () => {
      let arr;
      try {
        arr = JSON.parse(area.value);
        if (!Array.isArray(arr)) throw new Error('Ожидается массив');
      } catch (e) {
        playBeep(false);
        return UI.toast('Ошибка JSON: ' + e.message, 'err');
      }

      const valid = [];
      const unknownCities = new Set();

      for (const x of arr) {
        if (!x.name || !x.latitude || !x.longitude) continue;
        
        let settlement_id = x.settlement_id || null;
        if (!settlement_id && x.settlement_name) {
          const city = allSettlements.find(c => c.name.toLowerCase() === x.settlement_name.toLowerCase());
          if (city) settlement_id = city.id;
          else unknownCities.add(x.settlement_name);
        }

        valid.push({
          stop_code: String(x.code || '').padStart(6, '0') || null,
          name: x.name,
          address: x.address || null,
          status: x.status || 'active',
          latitude: Number(x.latitude),
          longitude: Number(x.longitude),
          settlement_id: settlement_id
        });
      }

      if (!valid.length) return UI.toast('Нет валидных записей', 'err');

      if (unknownCities.size > 0) {
        if (!confirm(`Не найдены города: ${Array.from(unknownCities).join(', ')}.\nИмпортировать без привязки к городу?`)) return;
      }

      const existingCodes = new Set(allStops.map(s => s.stop_code));
      const duplicates = valid.filter(v => v.stop_code && existingCodes.has(v.stop_code));

      try {
        if (duplicates.length > 0) {
          if (!confirm(`Найдено ${duplicates.length} совпадений по коду. Перезаписать?`)) return;
          const { error } = await window.sb.from('stops').upsert(valid, { onConflict: 'stop_code' });
          if (error) throw error;
        } else {
          const { error } = await window.sb.from('stops').insert(valid);
          if (error) throw error;
        }

        playBeep(true);
        UI.toast(`Импортировано: ${valid.length}`, 'ok');
        area.value = '';
        loadData();
      } catch (err) {
        playBeep(false);
        UI.toast(err.message, 'err');
      }
    };

    return div;
  }

  // ==========================================
  // 7. КАРТА ВСЕХ ОСТАНОВОК (ВКЛАДКА 4)
  // ==========================================
  function initMapTab() {
    const div = document.createElement('div');
    div.style.height = 'calc(100vh - 160px)';
    div.style.borderRadius = 'var(--radius)';
    div.style.overflow = 'hidden';
    div.style.border = '1px solid var(--border)';
    div.innerHTML = `<div id="main-map"></div>`;
    
    setTimeout(() => {
      if (mapAll) { mapAll.remove(); }
      mapAll = L.map('main-map').setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapAll);
      renderAllMap();
    }, 100);

    return div;
  }

  function renderAllMap() {
    if (!mapAll) return;
    mapAll.eachLayer(l => { if (l instanceof L.Marker) mapAll.removeLayer(l); });

    allStops.forEach(s => {
      const marker = L.marker([s.latitude, s.longitude]).addTo(mapAll);
      const statusMap = { active: 'Активна', reconstruction: 'Реконструкция', closed: 'Закрыта' };
      const cityName = s.settlements ? s.settlements.name : '—';
      
      const popup = document.createElement('div');
      popup.className = 'popup-content';
      popup.innerHTML = `
        <h4>${s.name} <span style="font-size:11px;color:var(--muted);font-family:monospace;">[${s.stop_code}]</span></h4>
        <p><b>Город:</b> ${cityName}</p>
        <p><b>Адрес:</b> ${s.address || '—'}${s.landmark ? '<br>' + s.landmark : ''}</p>
        <p><b>Координаты:</b> ${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</p>
        <p><b>Статус:</b> ${statusMap[s.status || 'active']}</p>
        <div class="popup-actions">
          <button class="edit">Изменить</button>
          <button class="deactivate">Деактивировать</button>
          <button class="del">Удалить</button>
        </div>
      `;
      
      popup.querySelector('.edit').onclick = () => { switchTab('add'); fillAddForm(s); };
      popup.querySelector('.deactivate').onclick = async () => {
        await window.sb.from('stops').update({ status: 'closed' }).eq('id', s.id);
        UI.toast('Деактивирована', 'ok'); loadData();
      };
      popup.querySelector('.del').onclick = () => safeDelete(s);

      marker.bindPopup(popup);
    });
  }

  // ==========================================
  // 8. ПАНЕЛЬ НАСТРОЕК
  // ==========================================
  function buildSettings() {
    const btn = document.createElement('button');
    btn.className = 'settings-btn';
    btn.textContent = 'Настройки';
    btn.onclick = () => {
      settingsPanel.classList.add('open');
      document.querySelector('.settings-overlay').classList.add('open');
    };
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.onclick = () => {
      settingsPanel.classList.remove('open');
      overlay.classList.remove('open');
    };
    document.body.appendChild(overlay);

    settingsPanel = document.createElement('div');
    settingsPanel.className = 'settings-panel';
    settingsPanel.innerHTML = `
      <h2 style="margin-top:0; font-size:18px;">Настройки</h2>
      
      <div style="margin-bottom:20px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="set-sound" ${settings.soundEnabled ? 'checked' : ''} />
          <span>Звуковой отклик</span>
        </label>
      </div>

      <div style="margin-bottom:20px;">
        <button class="btn" id="set-mirror" style="width:100%;">Зеркалировать интерфейс</button>
      </div>

      <div style="margin-bottom:20px;">
        <label style="font-size:13px; color:var(--muted);">Пропорция формы / карты</label>
        <input type="range" id="set-ratio" min="20" max="80" value="${settings.splitRatio}" style="width:100%; margin-top:8px;" />
        <span id="ratio-val" style="font-size:12px; color:var(--muted);">${settings.splitRatio}%</span>
      </div>

      <div style="margin-bottom:20px;">
        <button class="btn btn--brand" id="set-center" style="width:100%;">Зафиксировать текущий вид</button>
      </div>

      <div>
        <button class="btn btn--danger" id="set-reset" style="width:100%;">Сбросить настройки</button>
      </div>
    `;
    document.body.appendChild(settingsPanel);

    // Обработчики
    settingsPanel.querySelector('#set-sound').onchange = (e) => {
      settings.soundEnabled = e.target.checked; saveSettings();
    };
    
    settingsPanel.querySelector('#set-mirror').onclick = () => {
      settings.isMirrored = !settings.isMirrored; saveSettings();
      if (currentTab === 'add') switchTab('add');
    };

    const ratioInput = settingsPanel.querySelector('#set-ratio');
    const ratioVal = settingsPanel.querySelector('#ratio-val');
    ratioInput.oninput = (e) => { ratioVal.textContent = e.target.value + '%'; };
    ratioInput.onchange = (e) => {
      settings.splitRatio = parseInt(e.target.value);
      saveSettings();
      if (currentTab === 'add') switchTab('add');
    };

    settingsPanel.querySelector('#set-center').onclick = () => {
      const activeMap = currentTab === 'add' ? mapAdd : (currentTab === 'map' ? mapAll : null);
      if (activeMap) {
        const c = activeMap.getCenter();
        settings.mapCenter = [c.lat, c.lng];
        settings.mapZoom = activeMap.getZoom();
        saveSettings();
        UI.toast('Текущий вид карты сохранен', 'ok');
      } else {
        UI.toast('Откройте карту для фиксации', 'err');
      }
    };

    settingsPanel.querySelector('#set-reset').onclick = () => {
      localStorage.removeItem('stops_settings');
      location.reload();
    };
  }

  // ==========================================
  // 9. ГЛАВНЫЙ КОНТРОЛЛЕР
  // ==========================================
  function switchTab(tab) {
    currentTab = tab;
    navTabs.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    contentArea.innerHTML = '';
    
    if (tab === 'list') contentArea.appendChild(initListTab());
    if (tab === 'add') contentArea.appendChild(initAddTab());
    if (tab === 'mass') contentArea.appendChild(initMassTab());
    if (tab === 'map') contentArea.appendChild(initMapTab());
    
    if (tab === 'list') renderList();
    if (tab === 'map') setTimeout(renderAllMap, 150);
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    loadSettings();
    const content = UI.renderShell({ title: 'Остановки', profile, active: 'stops.html' });

    // Вкладки
    navTabs = document.createElement('div');
    navTabs.className = 'nav-tabs';
    navTabs.innerHTML = `
      <button data-tab="list" class="active">Реестр</button>
      <button data-tab="add">Добавление остановки</button>
      <button data-tab="mass">Массовое добавление</button>
      <button data-tab="map">Карта остановок</button>
    `;
    navTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) switchTab(btn.dataset.tab);
    });
    content.appendChild(navTabs);

    contentArea = document.createElement('div');
    content.appendChild(contentArea);

    buildSettings();

    // Хоткеи
    document.addEventListener('keydown', (e) => {
      if (e.altKey) {
        if (e.key === '1') { e.preventDefault(); switchTab('list'); }
        if (e.key === '2') { e.preventDefault(); switchTab('add'); }
        if (e.key === '3') { e.preventDefault(); switchTab('mass'); }
        if (e.key === '4') { e.preventDefault(); switchTab('map'); }
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          switchTab('list');
          setTimeout(() => { if (searchInput) searchInput.focus(); }, 100);
        }
      }
    });

    await loadData();
    switchTab('list');
  }

  document.addEventListener('DOMContentLoaded', main);
})();
