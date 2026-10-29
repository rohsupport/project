// ============================================================
// Остановки: Реестр с сортировкой + Полноэкранное добавление
// ============================================================
(function () {
  let allStops = [];
  let map = null;
  let marker = null;
  let geocoder = null;

  // DOM-контейнеры
  let listView, addView, tbodyList, recentList;
  let currentSort = { field: 'stop_code', dir: 'desc' };

  // Координаты для Сардинии (Центр острова)
  const SARDINIA_CENTER = [40.1209, 9.0129];
  const SARDINIA_ZOOM = 8;

  // ========== 1. Загрузка данных ==========
  async function load() {
    try {
      const { data, error } = await window.sb
        .from('stops')
        .select('*');
      if (error) throw error;
      allStops = data || [];
      renderTable();
    } catch (err) {
      UI.toast('Ошибка загрузки: ' + err.message, 'err');
    }
  }

  // ========== 2. Рендер реестра с сортировкой ==========
  function renderTable() {
    const q = document.getElementById('search-input').value.trim().toLowerCase();
    
    // Фильтрация
    let filtered = allStops.filter(s => {
      if (!q) return true;
      return `${s.name} ${s.address || ''} ${s.city || ''} ${s.stop_code || ''}`.toLowerCase().includes(q);
    });

    // Сортировка
    filtered.sort((a, b) => {
      let valA = a[currentSort.field] || '';
      let valB = b[currentSort.field] || '';
      
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
      if (valA > valB) return currentSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    // Обновляем заголовки
    document.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.field === currentSort.field) {
        th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    // Рендер строк
    tbodyList.innerHTML = '';
    if (filtered.length === 0) {
      tbodyList.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted);">Ничего не найдено</td></tr>';
      return;
    }

    filtered.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge--muted" style="font-family:monospace;">${s.stop_code}</span></td>
        <td>${s.name}</td>
        <td>${s.city || '—'}</td>
        <td>${s.address || '—'}${s.landmark ? `<br><small style="color:var(--muted)">📍 ${s.landmark}</small>` : ''}</td>
        <td style="font-family:monospace; font-size:12px; color:var(--muted);">${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</td>
        <td>
          <button class="btn btn--sm btn--danger delete-btn" data-id="${s.id}">Удалить</button>
        </td>
      `;
      
      tr.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Удалить ${s.stop_code}?`)) return;
        await window.sb.from('stops').delete().eq('id', s.id);
        await load();
      });
      
      tbodyList.appendChild(tr);
    });
  }

  // ========== 3. Переключение видов ==========
  function showList() {
    addView.style.display = 'none';
    listView.style.display = 'block';
    if (map) { map.remove(); map = null; marker = null; }
  }

  function showAdd() {
    listView.style.display = 'none';
    addView.style.display = 'flex';
    
    // Сброс формы
    document.getElementById('add-form').reset();
    if (marker) { map.removeLayer(marker); marker = null; }
    
    // Инициализация карты (нужна задержка для отрисовки DOM)
    setTimeout(() => {
      if (!map) {
        initMap();
      } else {
        map.invalidateSize();
        map.setView(SARDINIA_CENTER, SARDINIA_ZOOM);
      }
    }, 100);
  }

  // ========== 4. Карта ==========
  function initMap() {
    map = L.map('page-map').setView(SARDINIA_CENTER, SARDINIA_ZOOM);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OSM'
    }).addTo(map);

    geocoder = L.Control.geocoder({
      defaultMarkGeocode: false,
      placeholder: 'Найти город или улицу...',
    }).on('markgeocode', (e) => {
      const center = e.geocode.center;
      map.setView(center, 15);
      placeMarker(center.lat, center.lng);
    }).addTo(map);

    map.on('click', (e) => {
      placeMarker(e.latlng.lat, e.latlng.lng);
    });
  }

  function placeMarker(lat, lng) {
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      updateCoordsInput(pos.lat, pos.lng);
    });
    updateCoordsInput(lat, lng);
  }

  function updateCoordsInput(lat, lng) {
    const input = document.getElementById('coords-input');
    if (input) input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  // ========== 5. Построение полноэкранного вида ==========
  function buildAddView() {
    addView = document.createElement('div');
    addView.className = 'fullscreen-add';
    addView.style.display = 'none';

    // 30% - Форма
    const formCol = document.createElement('div');
    formCol.className = 'fullscreen-form-col';
    formCol.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0; font-size:18px;">Новая остановка</h2>
        <button type="button" class="btn btn--sm" id="back-btn">← Назад к реестру</button>
      </div>

      <form id="add-form" class="form" style="flex:1; display:flex; flex-direction:column; gap:12px;">
        <div class="field">
          <label>Код (автоматически)</label>
          <input id="preview-code" readonly style="font-family:monospace; font-weight:bold; color:var(--brand);" />
        </div>
        <div class="field">
          <label>Название остановки *</label>
          <input name="name" required maxlength="200" placeholder="Например: Via Roma" />
        </div>
        <div class="field">
          <label>Город / Район</label>
          <input name="city" maxlength="100" placeholder="Например: Кальяри" />
        </div>
        <div class="field">
          <label>Адрес (улица, дом)</label>
          <input name="address" maxlength="300" placeholder="Via Roma, 10" />
        </div>
        <div class="field">
          <label>Ориентир</label>
          <input name="landmark" maxlength="300" placeholder="Напротив мэрии" />
        </div>
        <div class="field">
          <label>Координаты *</label>
          <input name="coords" id="coords-input" required placeholder="40.1209, 9.0129" style="font-family:monospace; font-size:12px;" />
          <small style="color:var(--muted); font-size:11px;">Кликните по карте справа</small>
        </div>
        
        <button type="submit" class="btn btn--brand" id="save-btn" style="margin-top:10px;">Добавить остановку</button>
      </form>

      <div class="recent-box">
        <h4 style="margin:0 0 8px; font-size:13px; color:var(--muted);">Последние добавленные:</h4>
        <div id="recent-list" style="max-height:150px; overflow-y:auto;"></div>
      </div>
    `;

    // 70% - Карта
    const mapCol = document.createElement('div');
    mapCol.className = 'fullscreen-map-col';
    mapCol.innerHTML = `<div id="page-map"></div>`;

    addView.appendChild(formCol);
    addView.appendChild(mapCol);

    // Обработчики
    formCol.querySelector('#back-btn').addEventListener('click', showList);
    
    const form = formCol.querySelector('#add-form');
    form.querySelector('#coords-input').addEventListener('change', (e) => {
      const parsed = parseCoords(e.target.value);
      if (parsed && map) {
        map.setView([parsed.lat, parsed.lng], 15);
        placeMarker(parsed.lat, parsed.lng);
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const parsed = parseCoords(fd.get('coords'));
      
      if (!parsed) { UI.toast('Неверный формат координат', 'err'); return; }
      
      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';

      try {
        const { data, error } = await window.sb.from('stops').insert({
          name: fd.get('name'),
          city: fd.get('city') || null,
          address: fd.get('address') || null,
          landmark: fd.get('landmark') || null,
          latitude: parsed.lat,
          longitude: parsed.lng,
          is_active: true
        }).select().single();

        if (error) throw error;
        
        UI.toast(`Добавлена: ${data.stop_code}`, 'ok');
        
        // Добавляем в "Последние"
        addRecent(data);
        
        // Очищаем форму для следующей
        form.reset();
        if (marker) { map.removeLayer(marker); marker = null; }
        
        // Обновляем превью кода
        updatePreviewCode();
        
        // Обновляем основной реестр в фоне
        load();
        
      } catch (err) {
        UI.toast(err.message, 'err');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Добавить остановку';
      }
    });

    return addView;
  }

  function addRecent(stop) {
    const list = document.getElementById('recent-list');
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `<span>${stop.name}</span> <span class="badge badge--muted" style="font-family:monospace;">${stop.stop_code}</span>`;
    list.prepend(div);
  }

  function updatePreviewCode() {
    const maxCode = allStops.reduce((max, s) => {
      const n = parseInt(s.stop_code || '0', 10);
      return n > max ? n : max;
    }, 0);
    document.getElementById('preview-code').value = String(maxCode + 1).padStart(6, '0');
  }

  // ========== 6. Массовое добавление ==========
  function openMassAdd() {
    const m = UI.createModal({ title: 'Массовое добавление (JSON)' });
    m.dialog.style.width = 'min(700px, 95vw)';

    const JSON_EXAMPLE = `[
  {
    "name": "Piazza Matteotti",
    "city": "Кальяри",
    "address": "Piazza Matteotti",
    "landmark": "У ратуши",
    "latitude": 39.2165,
    "longitude": 9.1142
  },
  {
    "name": "Stazione FS",
    "city": "Кальяри",
    "latitude": 39.2151,
    "longitude": 9.1086
  }
]`;

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Вставьте JSON-массив остановок</label>
        <textarea id="json-area" style="height:250px; font-family:monospace; font-size:12px; background:var(--bg); color:var(--text); border:1px solid var(--border); padding:10px; border-radius:8px; resize:vertical;" placeholder='[{"name": "..."}]'></textarea>
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn" id="ex-btn">Показать пример</button>
        <button type="button" class="btn" id="copy-btn">Скопировать пример</button>
        <button type="submit" class="btn btn--brand" style="flex:1;" id="load-btn">Загрузить</button>
      </div>
    `;
    m.body.appendChild(form);

    const area = form.querySelector('#json-area');
    const loadBtn = form.querySelector('#load-btn');

    form.querySelector('#ex-btn').addEventListener('click', () => {
      area.value = JSON_EXAMPLE;
    });

    form.querySelector('#copy-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON_EXAMPLE);
        UI.toast('Пример скопирован в буфер', 'ok');
      } catch (e) {
        UI.toast('Не удалось скопировать', 'err');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = area.value.trim();
      if (!raw) return;

      let arr;
      try {
        arr = JSON.parse(raw);
        if (!Array.isArray(arr)) throw new Error('Ожидается массив [ ... ]');
      } catch (err) {
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
          city: item.city || null,
          address: item.address || null,
          landmark: item.landmark || null,
          latitude: item.latitude,
          longitude: item.longitude,
          is_active: true
        });
      }

      if (valid.length === 0) { UI.toast('Нет валидных записей', 'err'); return; }

      loadBtn.disabled = true;
      loadBtn.textContent = 'Загрузка...';
      try {
        const { error } = await window.sb.from('stops').insert(valid);
        if (error) throw error;
        UI.toast(`Добавлено ${valid.length} остановок`, 'ok');
        m.close();
        await load();
      } catch (err) {
        UI.toast(err.message, 'err');
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Загрузить';
      }
    });
  }

  // ========== 7. Парсер координат ==========
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

  // ========== 8. Главный экран (Реестр) ==========
  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({ title: 'Остановки', profile, active: 'stops.html' });

    // --- РЕЕСТР (список) ---
    listView = document.createElement('div');
    listView.innerHTML = `
      <div class="toolbar">
        <button class="btn btn--brand" id="btn-add">➕ Добавить остановку</button>
        <button class="btn" id="btn-mass">📦 Массовое добавление</button>
        <div class="field field--grow" style="margin:0;">
          <input id="search-input" placeholder="Поиск по названию, коду или городу..." />
        </div>
        <span id="count-badge" class="muted"></span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" data-field="stop_code">Код</th>
              <th class="sortable" data-field="name">Название</th>
              <th class="sortable" data-field="city">Город</th>
              <th class="sortable" data-field="address">Адрес / Ориентир</th>
              <th>Координаты</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody id="tbody-list"></tbody>
        </table>
      </div>
    `;
    content.appendChild(listView);

    tbodyList = listView.querySelector('#tbody-list');
    
    // Слушатели
    listView.querySelector('#btn-add').addEventListener('click', showAdd);
    listView.querySelector('#btn-mass').addEventListener('click', openMassAdd);
    
    listView.querySelector('#search-input').addEventListener('input', UI.debounce(() => {
      renderTable();
      const count = tbodyList.children.length;
      listView.querySelector('#count-badge').textContent = `Найдено: ${count}`;
    }, 300));

    // Сортировка
    listView.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.field;
        if (currentSort.field === field) {
          currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort.field = field;
          currentSort.dir = 'asc';
        }
        renderTable();
      });
    });

    // --- ДОБАВЛЕНИЕ (Полный экран) ---
    content.appendChild(buildAddView());

    // Загрузка данных
    await load();
    listView.querySelector('#count-badge').textContent = `Всего: ${allStops.length}`;
    
    // Обновляем превью кода при входе
    updatePreviewCode();
  }

  document.addEventListener('DOMContentLoaded', main);
})();
