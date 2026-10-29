// ============================================================
// Полноценный модуль остановок: 1/3 форма, 2/3 карта, JSON-импорт
// ============================================================
(function () {
  let allStops = [];
  let map = null;
  let marker = null;
  let geocoder = null;
  
  // DOM-элементы
  let formPanel, jsonPanel, recentPanel, listPanel;
  let form, jsonArea, jsonBtn, recentList, stopsList;
  let coordsInput, nameInput, addressInput, landmarkInput, activeCheck, previewCode;

  // ========== 1. Загрузка данных ==========
  async function load() {
    try {
      const { data, error } = await window.sb
        .from('stops')
        .select('*')
        .order('stop_code', { ascending: false }); // Сначала новые
      if (error) throw error;
      
      allStops = data || [];
      renderStopsList();
      updatePreviewCode();
    } catch (err) {
      UI.toast('Ошибка загрузки: ' + err.message, 'err');
    }
  }

  // Обновляем превью следующего кода
  function updatePreviewCode() {
    if (allStops.length === 0) {
      previewCode.textContent = '000001';
      return;
    }
    // Находим максимальный код и прибавляем 1
    const maxCode = allStops.reduce((max, s) => {
      const n = parseInt(s.stop_code || '0', 10);
      return n > max ? n : max;
    }, 0);
    previewCode.textContent = String(maxCode + 1).padStart(6, '0');
  }

  // ========== 2. Рендер списков ==========
  function renderStopsList() {
    stopsList.innerHTML = '';
    
    const recent = allStops.slice(0, 5);
    recentList.innerHTML = '';
    
    if (recent.length === 0) {
      recentList.innerHTML = '<div style="color:var(--muted);font-size:12px;">Пока нет остановок</div>';
    } else {
      recent.forEach(s => {
        const div = document.createElement('div');
        div.className = 'recent-item';
        div.innerHTML = `
          <div>
            <div style="font-weight:500;">${s.name}</div>
            <div style="font-size:11px;color:var(--muted);">${s.address || 'Без адреса'}</div>
          </div>
          <div class="recent-code">${s.stop_code}</div>
        `;
        div.addEventListener('click', () => showOnMap(s));
        recentList.appendChild(div);
      });
    }

    if (allStops.length === 0) {
      stopsList.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">Нет остановок в базе</div>';
      return;
    }
    
    const fragment = document.createDocumentFragment();
    allStops.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge--muted" style="font-family:monospace;">${s.stop_code}</span></td>
        <td>${s.name}</td>
        <td>${s.address || '—'}</td>
        <td>${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</td>
      `;
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => showOnMap(s));
      fragment.appendChild(tr);
    });
    stopsList.appendChild(fragment);
  }

  // Показать остановку на карте
  function showOnMap(s) {
    if (!map) return;
    map.setView([s.latitude, s.longitude], 17);
    if (marker) map.removeLayer(marker);
    marker = L.marker([s.latitude, s.longitude]).addTo(map);
    marker.bindPopup(`<b>${s.name}</b><br>${s.stop_code}`).openPopup();
  }

  // ========== 3. Карта ==========
  function initMap() {
    map = L.map('main-map').setView([55.7558, 37.6173], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OSM'
    }).addTo(map);

    geocoder = L.Control.geocoder({
      defaultMarkGeocode: false,
      placeholder: 'Найти адрес...',
      errorMessage: 'Адрес не найден'
    }).on('markgeocode', (e) => {
      const center = e.geocode.center;
      map.setView(center, 16);
      placeMarker(center.lat, center.lng);
      updateFormCoords(center.lat, center.lng);
    }).addTo(map);

    map.on('click', (e) => {
      placeMarker(e.latlng.lat, e.latlng.lng);
      updateFormCoords(e.latlng.lat, e.latlng.lng);
    });
  }

  function placeMarker(lat, lng) {
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      updateFormCoords(pos.lat, pos.lng);
    });
  }

  function updateFormCoords(lat, lng) {
    if (coordsInput) coordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  // ========== 4. Форма добавления ==========
  function buildForm() {
    form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="margin:0;">Новая остановка</h3>
        <div style="font-size:12px; color:var(--muted);">
          Код: <span id="preview-code" style="font-family:monospace; color:var(--brand); font-weight:bold;">...</span>
        </div>
      </div>
      
      <div class="field">
        <label>Название *</label>
        <input name="name" required maxlength="200" placeholder="Например: ул. Ленина" />
      </div>
      
      <div class="field">
        <label>Адрес</label>
        <input name="address" maxlength="300" placeholder="Улица, дом" />
      </div>
      
      <div class="field">
        <label>Ориентир</label>
        <input name="landmark" maxlength="300" placeholder="Напротив ТЦ" />
      </div>
      
      <div class="field">
        <label>Координаты *</label>
        <div style="display:flex; gap:6px;">
          <input name="coords" id="coords-input" required placeholder="55.7558, 37.6173" style="font-family:monospace; font-size:12px;" />
          <button type="button" class="btn btn--sm" id="paste-btn" title="Вставить">📋</button>
        </div>
        <small style="color:var(--muted); font-size:11px;">Кликните по карте</small>
      </div>
      
      <div class="field" style="flex-direction:row; align-items:center; gap:8px;">
        <input id="stop-active" name="is_active" type="checkbox" style="width:auto;" checked />
        <label for="stop-active" style="margin:0; font-size:13px;">Активна</label>
      </div>
      
      <button type="submit" class="btn btn--brand" id="save-btn">Добавить остановку</button>
    `;
    formPanel.appendChild(form);

    coordsInput = form.querySelector('#coords-input');
    const pasteBtn = form.querySelector('#paste-btn');
    const saveBtn = form.querySelector('#save-btn');

    coordsInput.addEventListener('change', () => {
      const parsed = parseCoords(coordsInput.value);
      if (parsed && map) {
        map.setView([parsed.lat, parsed.lng], 16);
        placeMarker(parsed.lat, parsed.lng);
      }
    });

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        coordsInput.value = text;
        coordsInput.dispatchEvent(new Event('change'));
      } catch (e) { UI.toast('Разрешите доступ к буферу', 'err'); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const parsed = parseCoords(coordsInput.value);
      if (!parsed) { UI.toast('Неверные координаты', 'err'); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';

      try {
        const { error } = await window.sb.from('stops').insert({
          name: String(fd.get('name') || '').trim(),
          address: String(fd.get('address') || '').trim() || null,
          landmark: String(fd.get('landmark') || '').trim() || null,
          latitude: parsed.lat,
          longitude: parsed.lng,
          is_active: !!fd.get('is_active')
        });
        if (error) throw error;
        
        UI.toast('Остановка добавлена', 'ok');
        form.reset();
        if (marker) { map.removeLayer(marker); marker = null; }
        await load();
      } catch (err) {
        UI.toast(err.message, 'err');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Добавить остановку';
      }
    });
  }

  // ========== 5. JSON-импорт ==========
  const JSON_TEMPLATE = `[
  {
    "name": "Площадь Победы",
    "address": "ул. Ленина, 10",
    "landmark": "У фонтана",
    "latitude": 55.7558,
    "longitude": 37.6173
  },
  {
    "name": "Центральный рынок",
    "latitude": 55.7602,
    "longitude": 37.6205
  }
]`;

  function buildJsonPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'form';
    wrapper.innerHTML = `
      <h3 style="margin:0;">Массовое добавление (JSON)</h3>
      <small style="color:var(--muted); font-size:11px; margin-bottom:8px; display:block;">
        Вставьте массив объектов. Обязательно: name, latitude, longitude.
      </small>
      <textarea class="json-textarea" id="json-input" placeholder="${JSON_TEMPLATE.replace(/</g, '&lt;')}"></textarea>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" class="btn btn--sm" id="json-example">Пример</button>
        <button type="button" class="btn btn--sm btn--brand" id="json-load" style="flex:1;">Загрузить</button>
      </div>
    `;
    jsonPanel.appendChild(wrapper);

    jsonArea = wrapper.querySelector('#json-input');
    const exampleBtn = wrapper.querySelector('#json-example');
    const loadBtn = wrapper.querySelector('#json-load');

    exampleBtn.addEventListener('click', () => {
      jsonArea.value = JSON_TEMPLATE;
      jsonArea.classList.remove('error');
    });

    loadBtn.addEventListener('click', async () => {
      const raw = jsonArea.value.trim();
      if (!raw) { UI.toast('Вставьте JSON', 'err'); return; }

      let arr;
      try {
        arr = JSON.parse(raw);
        if (!Array.isArray(arr)) throw new Error('Ожидается массив [...]');
      } catch (err) {
        jsonArea.classList.add('error');
        UI.toast('Ошибка JSON: ' + err.message, 'err');
        return;
      }

      const valid = [];
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (!item.name || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
          UI.toast(`Элемент #${i+1} пропущен (нет name/lat/lng)`, 'warn');
          continue;
        }
        valid.push({
          name: String(item.name),
          address: item.address || null,
          landmark: item.landmark || null,
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          is_active: item.is_active !== false
        });
      }

      if (valid.length === 0) { UI.toast('Нет валидных записей', 'err'); return; }

      loadBtn.disabled = true;
      loadBtn.textContent = 'Загрузка...';
      try {
        const { error } = await window.sb.from('stops').insert(valid);
        if (error) throw error;
        UI.toast(`Добавлено: ${valid.length} остановок`, 'ok');
        jsonArea.value = '';
        jsonArea.classList.remove('error');
        await load();
        switchTab('list');
      } catch (err) {
        UI.toast(err.message, 'err');
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Загрузить';
      }
    });
  }

  // ========== 6. Парсинг координат ==========
  function parseCoords(str) {
    if (!str) return null;
    const clean = String(str).replace(/[^\d.,\-\s]/g, ' ').trim();
    const parts = clean.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2) return null;
    let lat = parseFloat(parts[0].replace(',', '.'));
    let lng = parseFloat(parts[1].replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  // ========== 7. Вкладки в левой панели ==========
  let tabsContainer, tabButtons, tabContents;
  function buildTabs() {
    tabsContainer = document.createElement('div');
    tabsContainer.className = 'tabs';
    tabsContainer.innerHTML = `
      <button class="tab tab--active" data-tab="form">Одна</button>
      <button class="tab" data-tab="json">Массово</button>
      <button class="tab" data-tab="recent">Последние</button>
    `;
    formPanel = document.createElement('div');
    jsonPanel = document.createElement('div');
    recentPanel = document.createElement('div');
    
    formPanel.style.display = 'block';
    jsonPanel.style.display = 'none';
    recentPanel.style.display = 'none';

    tabContents = { form: formPanel, json: jsonPanel, recent: recentPanel };
    
    tabsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });

    return tabsContainer;
  }

  function switchTab(name) {
    Object.keys(tabContents).forEach(k => {
      tabContents[k].style.display = k === name ? 'block' : 'none';
    });
    tabsContainer.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('tab--active', b.dataset.tab === name);
    });
  }

  // ========== 8. Главный экран ==========
  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({ title: 'Остановки', profile, active: 'stops.html' });

    // Тулбар сверху
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = `
      <div class="field field--grow" style="margin:0;">
        <input id="global-search" placeholder="Поиск по названию, адресу или коду..." />
      </div>
      <span id="count-badge" class="muted"></span>
    `;
    content.appendChild(toolbar);

    // Основной лэйаут
    const layout = document.createElement('div');
    layout.className = 'stops-layout';

    // Левая панель
    const left = document.createElement('div');
    left.className = 'stops-panel';
    
    // Карта
    const right = document.createElement('div');
    right.className = 'stops-map-wrapper';
    right.innerHTML = '<div id="main-map"></div>';

    layout.appendChild(left);
    layout.appendChild(right);
    content.appendChild(layout);

    // Карта
    setTimeout(initMap, 100);

    // Вкладки
    left.appendChild(buildTabs());
    left.appendChild(formPanel);
    left.appendChild(jsonPanel);
    left.appendChild(recentPanel);

    // Строим содержимое вкладок
    buildForm();
    buildJsonPanel();
    
    recentList = document.createElement('div');
    recentList.className = 'recent-list';
    recentPanel.innerHTML = `<h3 style="margin:0 0 12px;">Последние добавленные</h3>`;
    recentPanel.appendChild(recentList);

    // Список всех (внизу страницы)
    const listWrap = document.createElement('div');
    listWrap.className = 'table-wrap';
    listWrap.style.marginTop = '16px';
    listWrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Код</th><th>Название</th><th>Адрес</th><th>Координаты</th></tr>
        </thead>
        <tbody id="stops-list"></tbody>
      </table>
    `;
    content.appendChild(listWrap);
    stopsList = listWrap.querySelector('#stops-list');

    // Поиск
    const searchInput = toolbar.querySelector('#global-search');
    const countBadge = toolbar.querySelector('#count-badge');
    searchInput.addEventListener('input', UI.debounce(() => {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? allStops.filter(s => 
        `${s.name} ${s.address||''} ${s.stop_code||''}`.toLowerCase().includes(q)
      ) : allStops;
      
      countBadge.textContent = `Найдено: ${filtered.length}`;
      
      // Обновляем основную таблицу
      stopsList.innerHTML = '';
      filtered.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="badge badge--muted" style="font-family:monospace;">${s.stop_code}</span></td>
          <td>${s.name}</td>
          <td>${s.address || '—'}</td>
          <td style="font-family:monospace; font-size:12px; color:var(--muted);">${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</td>
        `;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => showOnMap(s));
        stopsList.appendChild(tr);
      });
    }, 300));

    previewCode = document.createElement('span'); // временный, реально ищется в form
    await load();
    
    // Превью-код внутри формы
    previewCode = form.querySelector('#preview-code');
    updatePreviewCode();
  }

  document.addEventListener('DOMContentLoaded', main);
})();
