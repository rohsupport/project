// ============================================================
// Полноценный модуль управления остановками
// ============================================================
(function () {
  let allStops = [];
  let tbody, emptyEl, countEl, searchInput;
  
  // Переменные для карты
  let map = null;
  let marker = null;
  let geocoder = null;

  // 1. Загрузка данных
  async function load() {
    try {
      const { data, error } = await window.sb
        .from('stops')
        .select('*')
        .order('stop_code', { ascending: true });
      
      if (error) throw error;
      allStops = data || [];
      applyFilter();
    } catch (err) {
      UI.toast('Ошибка загрузки остановок: ' + err.message, 'err');
    }
  }

  // 2. Фильтрация и рендер
  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = allStops.filter(s => {
      if (!q) return true;
      return `${s.name} ${s.address || ''} ${s.landmark || ''} ${s.stop_code || ''}`.toLowerCase().includes(q);
    });
    
    countEl.textContent = `Всего: ${filtered.length}`;
    renderTable(filtered);
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    
    // Используем DocumentFragment для скорости (если остановок тысячи)
    const fragment = document.createDocumentFragment();
    list.forEach(s => fragment.appendChild(row(s)));
    tbody.appendChild(fragment);
  }

  // 3. Отрисовка строки таблицы
  function row(s) {
    const tr = document.createElement('tr');
    
    const tdCode = document.createElement('td');
    tdCode.innerHTML = `<span class="badge badge--muted" style="font-family:monospace; font-size:13px;">${s.stop_code || '—'}</span>`;

    const tdName = document.createElement('td');
    tdName.textContent = s.name;

    const tdAddr = document.createElement('td');
    tdAddr.textContent = s.address || '—';
    if (s.landmark) {
      const l = document.createElement('div');
      l.style.color = 'var(--muted)';
      l.style.fontSize = '12px';
      l.textContent = `📍 ${s.landmark}`;
      tdAddr.appendChild(l);
    }

    const tdCoords = document.createElement('td');
    tdCoords.textContent = `${Number(s.latitude).toFixed(6)}, ${Number(s.longitude).toFixed(6)}`;
    tdCoords.style.fontFamily = 'monospace';
    tdCoords.style.fontSize = '12px';
    tdCoords.style.color = 'var(--muted)';

    const tdStatus = document.createElement('td');
    tdStatus.appendChild(s.is_active ? UI.badge('Активна', 'ok') : UI.badge('Неактивна', 'muted'));

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm';
    editBtn.textContent = 'Изменить';
    editBtn.addEventListener('click', () => openModal(s));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteStop(s));

    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdCode);
    tr.appendChild(tdName);
    tr.appendChild(tdAddr);
    tr.appendChild(tdCoords);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAct);
    return tr;
  }

  // 4. Удаление
  async function deleteStop(s) {
    if (!confirm(`Удалить остановку ${s.stop_code} - "${s.name}"?`)) return;
    try {
      // Проверка: привязана ли к маршрутам
      const { count, error: e1 } = await window.sb
        .from('route_stops')
        .select('id', { count: 'exact', head: true })
        .eq('stop_id', s.id);
      if (e1) throw e1;
      
      if ((count || 0) > 0) {
        UI.toast('Нельзя удалить: остановка используется в маршрутах.', 'err');
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

  // 5. Утилиты (экранирование, парсинг)
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function parseCoords(str) {
    if (!str) return null;
    // Убираем всё кроме цифр, точки, минуса и запятой
    const clean = String(str).replace(/[^\d.,\-\s]/g, ' ').trim();
    const parts = clean.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2) return null;

    let lat = parseFloat(parts[0].replace(',', '.'));
    let lng = parseFloat(parts[1].replace(',', '.'));
    
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  // 6. Модальное окно (Создание/Редактирование)
  function openModal(existing) {
    const isEdit = !!existing;
    const m = UI.createModal({ 
      title: isEdit ? `Редактировать остановку (${existing.stop_code})` : 'Добавить остановку' 
    });
    
    // Делаем модалку шире для карты
    m.dialog.style.width = 'min(800px, 95vw)';

    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="modal-map-wrapper">
        <!-- Форма слева -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
          ${isEdit ? `
          <div class="field">
            <label>Реестровый номер</label>
            <input value="${existing.stop_code}" readonly style="font-family:monospace; font-weight:bold; opacity:0.7;" />
          </div>` : ''}
          
          <div class="field">
            <label>Название остановки *</label>
            <input name="name" required maxlength="200" value="${existing ? escapeAttr(existing.name) : ''}" placeholder="Например: ул. Ленина" />
          </div>
          
          <div class="field">
            <label>Адрес</label>
            <input name="address" maxlength="300" value="${existing ? escapeAttr(existing.address || '') : ''}" placeholder="Город, улица, дом" />
          </div>

          <div class="field">
            <label>Ориентир (если адрес неточный)</label>
            <input name="landmark" maxlength="300" value="${existing ? escapeAttr(existing.landmark || '') : ''}" placeholder="Напротив магазина" />
          </div>

          <div class="field" style="margin-top: auto;">
            <label>Координаты (Широта, Долгота) *</label>
            <div class="coords-input-group">
              <input name="coords" id="coords-input" required placeholder="55.7558, 37.6173" value="${existing ? `${existing.latitude}, ${existing.longitude}` : ''}" />
              <button type="button" class="btn" id="paste-btn" title="Вставить из буфера">📋</button>
            </div>
            <small style="color:var(--muted); font-size:11px; margin-top:2px;">Кликните по карте, чтобы выбрать точку</small>
          </div>
        </div>

        <!-- Карта справа -->
        <div class="map-container">
          <div id="modal-map"></div>
        </div>
      </div>

      <div class="field" style="flex-direction:row; align-items:center; gap:8px;">
        <input id="stop-active" name="is_active" type="checkbox" style="width:auto;" ${!existing || existing.is_active ? 'checked' : ''}/>
        <label for="stop-active" style="margin:0;">Остановка активна (видна пассажирам)</label>
      </div>

      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand" id="save-btn">Сохранить</button>
      </div>`;

    m.body.appendChild(form);
    form.querySelector('#cancel-btn').addEventListener('click', m.close);

    const coordsInput = form.querySelector('#coords-input');
    
    // Инициализация карты (с задержкой, чтобы DOM отрисовался)
    setTimeout(() => {
      initMap(existing, coordsInput);
    }, 100);

    // Обработка ручного ввода координат
    coordsInput.addEventListener('change', () => {
      const parsed = parseCoords(coordsInput.value);
      if (parsed && map && marker) {
        marker.setLatLng([parsed.lat, parsed.lng]);
        map.setView([parsed.lat, parsed.lng], 16);
      }
    });

    // Кнопка "Вставить из буфера"
    form.querySelector('#paste-btn').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        coordsInput.value = text;
        coordsInput.dispatchEvent(new Event('change'));
      } catch (err) {
        UI.toast('Нет доступа к буферу обмена', 'err');
      }
    });

    // Сохранение
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      
      const parsed = parseCoords(coordsInput.value);
      if (!parsed) {
        UI.toast('Неверный формат координат. Нужно: 55.7558, 37.6173', 'err');
        return;
      }

      const payload = {
        name: String(fd.get('name') || '').trim(),
        address: String(fd.get('address') || '').trim() || null,
        landmark: String(fd.get('landmark') || '').trim() || null,
        latitude: parsed.lat,
        longitude: parsed.lng,
        is_active: !!fd.get('is_active')
      };

      if (!payload.name) {
        UI.toast('Введите название', 'err');
        return;
      }

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
          UI.toast('Остановка создана. Номер присвоен.', 'ok');
        }
        
        // Очищаем карту при закрытии
        if (map) { map.remove(); map = null; marker = null; geocoder = null; }
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

  // 7. Инициализация карты внутри модалки
  function initMap(existing, coordsInput) {
    const mapDiv = document.getElementById('modal-map');
    if (!mapDiv) return;

    // Координаты по умолчанию (если создаем новую, ставим на центр Москвы или Тюмени)
    let initialLat = 55.7558;
    let initialLng = 37.6173;
    
    if (existing && existing.latitude) {
      initialLat = existing.latitude;
      initialLng = existing.longitude;
    }

    map = L.map('modal-map').setView([initialLat, initialLng], existing ? 16 : 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // Добавляем поиск по адресу (Geocoder)
    geocoder = L.Control.geocoder({
      defaultMarkGeocode: false,
      placeholder: 'Поиск адреса...',
      errorMessage: 'Адрес не найден',
      geocoder: L.Control.Geocoder.nominatim()
    }).on('markgeocode', function(e) {
      const center = e.geocode.center;
      map.setView(center, 16);
      placeMarker(center.lat, center.lng, coordsInput);
    }).addTo(map);

    // Ставим маркер, если редактируем
    if (existing && existing.latitude) {
      placeMarker(initialLat, initialLng, coordsInput);
    }

    // Клик по карте
    map.on('click', (e) => {
      placeMarker(e.latlng.lat, e.latlng.lng, coordsInput);
    });

    // Обязательный вызов для корректного отображения карты в модалке
    setTimeout(() => map.invalidateSize(), 200);
  }

  // Вспомогательная функция установки маркера
  function placeMarker(lat, lng, coordsInput) {
    if (marker) {
      marker.setLatLng([lat, lng]);
    } else {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      // При перетаскивании маркера обновляем координаты
      marker.on('dragend', (e) => {
        const pos = marker.getLatLng();
        coordsInput.value = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;
      });
    }
    coordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  // 8. Точка входа
  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Остановки',
      profile,
      active: 'stops.html'
    });

    // Тулбар
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
    searchInput.placeholder = 'Название, адрес, ориентир или код (000001)';
    fSearch.appendChild(searchInput);

    countEl = document.createElement('span');
    countEl.className = 'muted';

    toolbar.appendChild(addBtn);
    toolbar.appendChild(fSearch);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    // Таблица
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Код</th><th>Название</th><th>Адрес / Ориентир</th><th>Координаты</th><th>Статус</th><th>Действия</th>
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
