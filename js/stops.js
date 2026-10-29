(function () {
  let allStops = [], allCities = [];
  let mapAdd = null, mapAll = null, addMarker = null;
  let currentTab = 'list';
  let editId = null;

  // Строго те настройки, что в ТЗ
  let settings = {
    sound: true,
    isMirrored: false,
    ratio: 30,
    mapCenter: [40.1209, 9.0129],
    mapZoom: 8
  };

  let contentArea;

  // ========== 1. УТИЛИТЫ ==========
  function playBeep(success) {
    if (!settings.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.connect(ctx.destination);
      osc.frequency.value = success ? 880 : 220;
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } catch(e) {}
  }

  function loadSettings() {
    const s = localStorage.getItem('stops_settings');
    if (s) {
      try { settings = { ...settings, ...JSON.parse(s) }; } catch(e){}
    }
  }
  
  function saveSettings() {
    localStorage.setItem('stops_settings', JSON.stringify(settings));
  }

  // ========== 2. ЗАГРУЗКА ДАННЫХ ==========
  async function loadData() {
    const [resStops, resCities] = await Promise.all([
      window.sb.from('stops').select('*, settlements(name)'),
      window.sb.from('settlements').select('*').order('name')
    ]);
    if (resStops.error) UI.toast(resStops.error.message, 'err');
    else allStops = resStops.data || [];

    if (resCities.error) UI.toast(resCities.error.message, 'err');
    else { allCities = resCities.data || []; }

    if (currentTab === 'list') renderList();
    if (currentTab === 'map') renderAllMap();
  }

  // ========== 3. БЕЗОПАСНОЕ УДАЛЕНИЕ ==========
  async function safeDelete(stop) {
    if (!confirm(`Вы уверены, что хотите полностью удалить остановку "${stop.name}"? Это действие необратимо.`)) return;
    
    const { data: links } = await window.sb.from('route_stops').select('routes(name)').eq('stop_id', stop.id);
    if (links && links.length > 0) {
      playBeep(false);
      const names = links.map(l => l.routes.name).join(', ');
      if (confirm(`Удаление заблокировано!\nОстановка привязана к маршрутам: ${names}.\n\nСделать её неактивной (скрыть)?`)) {
        await window.sb.from('stops').update({ status: 'closed' }).eq('id', stop.id);
        UI.toast('Остановка деактивирована', 'ok');
        loadData();
      }
      return;
    }
    
    await window.sb.from('stops').delete().eq('id', stop.id);
    UI.toast('Остановка удалена', 'ok');
    playBeep(true);
    loadData();
  }

  // ========== 4. РЕЕСТР ==========
  function initListTab() {
    document.body.classList.remove('fullscreen');
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
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th><th>Город</th><th>Название</th><th>Адрес / Ориентир</th><th>Координаты</th><th>Статус</th><th>Действия</th>
            </tr>
          </thead>
          <tbody id="tbody-list"></tbody>
        </table>
      </div>
    `;

    const searchInput = div.querySelector('#search-input');
    const statusFilter = div.querySelector('#filter-status');
    const cityFilter = div.querySelector('#filter-city');
    const tbody = div.querySelector('#tbody-list');

    allCities.forEach(c => cityFilter.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.name}</option>`));

    const filter = () => {
      const q = searchInput.value.toLowerCase();
      const st = statusFilter.value;
      const ct = cityFilter.value;
      
      tbody.innerHTML = '';
      allStops.filter(s => {
        const matchQ = !q || (s.name||'').toLowerCase().includes(q) || (s.stop_code||'').includes(q);
        const matchSt = st === 'all' || (s.status || 'active') === st;
        const matchCt = ct === 'all' || s.settlement_id === ct;
        return matchQ && matchSt && matchCt;
      }).forEach(s => {
        const cityName = s.settlements ? s.settlements.name : '—';
        const statusLabel = s.status === 'active' ? 'Активна' : (s.status === 'closed' ? 'Закрыта' : 'Реконструкция');
        const coords = `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="badge badge--muted" style="font-family:monospace;">${s.stop_code}</span></td>
          <td>${cityName}</td>
          <td>${s.name}</td>
          <td>${s.address || '—'}</td>
          <td style="font-family:monospace; font-size:12px;">${coords}</td>
          <td><span class="badge">${statusLabel}</span></td>
          <td>
            <button class="btn btn--sm edit-btn">Изменить</button>
            <button class="btn btn--sm btn--danger del-btn">Удалить</button>
          </td>
        `;
        
        tr.querySelector('.del-btn').onclick = () => safeDelete(s);
        tr.querySelector('.edit-btn').onclick = () => {
          switchTab('add');
          setTimeout(() => fillAddForm(s), 200);
        };
        tbody.appendChild(tr);
      });
    };

    searchInput.oninput = UI.debounce(filter, 300);
    statusFilter.onchange = filter;
    cityFilter.onchange = filter;
    setTimeout(filter, 50);
    return div;
  }

  // ========== 5. СПЛИТ-ЭКРАН (ДОБАВЛЕНИЕ) ==========
  function initAddTab() {
    document.body.classList.add('fullscreen');
    const wrapper = document.createElement('div');
    wrapper.className = 'split';
    if (settings.isMirrored) wrapper.classList.add('mirrored');

    const formPanel = document.createElement('div');
    formPanel.className = 'split-form';
    formPanel.style.flex = `0 0 ${settings.ratio}%`;
    formPanel.innerHTML = `
      <h3 style="margin:0; font-size:18px;">${editId ? 'Редактирование' : 'Новая остановка'}</h3>
      <form id="add-form" class="form" style="flex:1; display:flex; flex-direction:column; gap:12px;">
        
        <div class="field">
          <label>Населенный пункт *</label>
          <div style="display:flex; gap:8px;">
            <select name="settlement" id="f-settlement" style="flex:1;" required>
              <option value="">— Выберите город —</option>
            </select>
            <button type="button" class="btn" id="btn-add-city" style="padding:0 12px;">+</button>
          </div>
        </div>

        <div class="field">
          <label>Код (6 цифр)</label>
          <input name="code" id="f-code" maxlength="6" placeholder="000001" style="font-family:monospace;" />
        </div>

        <div class="field">
          <label>Название *</label>
          <input name="name" id="f-name" required />
        </div>

        <div class="field">
          <label>Адрес / Ориентир</label>
          <textarea name="addr" id="f-addr" rows="2"></textarea>
        </div>

        <div class="field">
          <label>Координаты (кликните по карте)</label>
          <input name="coords" id="f-coords" readonly placeholder="Нажмите на карту" />
        </div>
        
        <div style="margin-top:auto; display:flex; flex-direction:column; gap:8px;">
          <button type="submit" class="btn btn--brand" id="btn-save">Сохранить (Ctrl+Enter)</button>
          <div style="font-size:11px; color:var(--muted); text-align:center;">Esc — отмена</div>
          <button type="button" class="btn" id="btn-back">← Назад к реестру</button>
        </div>
      </form>
    `;

    const resizer = document.createElement('div');
    resizer.className = 'resizer';

    const mapPanel = document.createElement('div');
    mapPanel.className = 'split-map';
    mapPanel.innerHTML = `<div id="map-add"></div>`;

    if (settings.isMirrored) {
      wrapper.appendChild(mapPanel);
      wrapper.appendChild(resizer);
      wrapper.appendChild(formPanel);
    } else {
      wrapper.appendChild(formPanel);
      wrapper.appendChild(resizer);
      wrapper.appendChild(mapPanel);
    }

    setTimeout(() => {
      mapAdd = L.map('map-add').setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapAdd);
      mapAdd.on('click', e => placeMarker(e.latlng.lat, e.latlng.lng));
      if (editId) {
        const s = allStops.find(x => x.id === editId);
        mapAdd.setView([s.latitude, s.longitude], 16);
        placeMarker(s.latitude, s.longitude);
      }
    }, 100);

    const form = formPanel.querySelector('#add-form');
    const sel = formPanel.querySelector('#f-settlement');
    const code = formPanel.querySelector('#f-code');

    allCities.forEach(c => sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.name}</option>`));
    
    sel.onchange = () => {
      const c = allCities.find(x => x.id === sel.value);
      if (c && c.lat && c.lng && mapAdd) mapAdd.setView([c.lat, c.lng], 12);
    };

    formPanel.querySelector('#btn-back').onclick = () => switchTab('list');
    formPanel.querySelector('#btn-add-city').onclick = openCityModal;

    // Хоткеи формы (Ctrl+Enter, Esc)
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
      if (e.key === 'Escape') {
        if (confirm('Отменить ввод?')) {
          form.reset();
          if (addMarker) { mapAdd.removeLayer(addMarker); addMarker = null; }
        }
      }
    });

    // Интерактивный ресайзер
    resizer.onmousedown = (e) => {
      e.preventDefault();
      document.onmousemove = (moveEvent) => {
        const rect = wrapper.getBoundingClientRect();
        let percentage = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        if (settings.isMirrored) percentage = 100 - percentage;
        
        // Ограничиваем от 20% до 80%
        percentage = Math.max(20, Math.min(80, percentage));
        formPanel.style.flex = `0 0 ${percentage}%`;
        
        if (mapAdd) mapAdd.invalidateSize();
      };
      document.onmouseup = () => {
        document.onmousemove = null;
        document.onmouseup = null;
        settings.ratio = parseFloat(formPanel.style.flex.split(' ')[0].replace('%', ''));
        saveSettings();
      };
    };

    code.onblur = () => { if(code.value) code.value = code.value.padStart(6, '0'); };

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!sel.value) return UI.toast('Выберите город', 'err');
      if (!formPanel.querySelector('#f-coords').value) return UI.toast('Укажите точку на карте', 'err');

      const [lat, lng] = formPanel.querySelector('#f-coords').value.split(',').map(Number);
      const payload = {
        stop_code: code.value || null,
        name: formPanel.querySelector('#f-name').value,
        address: formPanel.querySelector('#f-addr').value,
        latitude: lat,
        longitude: lng,
        settlement_id: sel.value,
        status: 'active'
      };

      const btn = formPanel.querySelector('#btn-save');
      btn.disabled = true; btn.textContent = '...';

      const { error } = editId 
        ? await window.sb.from('stops').update(payload).eq('id', editId)
        : await window.sb.from('stops').insert(payload);

      if (error) { playBeep(false); UI.toast(error.message, 'err'); }
      else {
        playBeep(true);
        UI.toast(editId ? 'Обновлено' : 'Добавлено', 'ok');
        if (!editId) {
          form.reset();
          if (addMarker) { mapAdd.removeLayer(addMarker); addMarker = null; }
          code.focus();
        } else {
          switchTab('list');
        }
        editId = null;
        loadData();
      }
      btn.disabled = false; btn.textContent = 'Сохранить (Ctrl+Enter)';
    };

    return wrapper;
  }

  function placeMarker(lat, lng) {
    if (addMarker) mapAdd.removeLayer(addMarker);
    addMarker = L.marker([lat, lng]).addTo(mapAdd);
    document.getElementById('f-coords').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  function fillAddForm(stop) {
    editId = stop.id;
    document.getElementById('f-settlement').value = stop.settlement_id || '';
    document.getElementById('f-code').value = stop.stop_code || '';
    document.getElementById('f-name').value = stop.name || '';
    document.getElementById('f-addr').value = stop.address || '';
    document.getElementById('f-coords').value = `${stop.latitude}, ${stop.longitude}`;
  }

  // ========== 6. МОДАЛКА ГОРОДА ==========
  function openCityModal() {
    const m = UI.createModal({ title: 'Новый населенный пункт' });
    m.body.innerHTML = `
      <div class="field">
        <label>Название города *</label>
        <input id="new-city-name" required />
      </div>
      <div class="modal__actions">
        <button class="btn" id="cancel-city">Отмена</button>
        <button class="btn btn--brand" id="save-city">Добавить</button>
      </div>
    `;
    m.body.querySelector('#cancel-city').onclick = m.close;
    m.body.querySelector('#save-city').onclick = async () => {
      const name = m.body.querySelector('#new-city-name').value.trim();
      if (!name) return;
      
      const center = mapAdd ? mapAdd.getCenter() : { lat: 40.12, lng: 9.01 };
      const { data, error } = await window.sb.from('settlements').insert({ name, lat: center.lat, lng: center.lng }).select().single();
      
      if (error) return UI.toast(error.message, 'err');
      
      UI.toast('Город добавлен', 'ok');
      m.close();
      allCities.push(data);
      
      const sel = document.getElementById('f-settlement');
      sel.insertAdjacentHTML('beforeend', `<option value="${data.id}">${data.name}</option>`);
      sel.value = data.id;
    };
  }

  // ========== 7. МАССОВОЕ ДОБАВЛЕНИЕ ==========
  function initMassTab() {
    document.body.classList.remove('fullscreen');
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="field">
        <label>Импорт данных (JSON)</label>
        <div class="drop-zone" id="drop-zone">Перетащите .json файл сюда</div>
        <input type="file" id="file-input" accept=".json" style="display:none;" />
        <textarea id="json-area" style="height:300px; font-family:monospace; font-size:12px; background:var(--bg); color:var(--text); border:1px solid var(--border); padding:10px; border-radius:8px; resize:vertical; width:100%;"></textarea>
      </div>
      <div style="margin-top:16px;">
        <button class="btn btn--brand" id="btn-load">Запустить импорт</button>
      </div>
    `;
    
    const area = div.querySelector('#json-area');
    div.querySelector('#drop-zone').onclick = () => div.querySelector('#file-input').click();
    div.querySelector('#file-input').onchange = (e) => {
      const f = e.target.files[0];
      if (f) {
        const r = new FileReader();
        r.onload = ev => area.value = ev.target.result;
        r.readAsText(f);
      }
    };

    div.querySelector('#btn-load').onclick = async () => {
      let arr;
      try { arr = JSON.parse(area.value); if (!Array.isArray(arr)) throw new Error(); } 
      catch (e) { return UI.toast('Неверный JSON', 'err'); }

      const valid = arr.map(x => {
        let s_id = x.settlement_id;
        if (!s_id && x.city_name) {
          const c = allCities.find(c => c.name.toLowerCase() === x.city_name.toLowerCase());
          if (c) s_id = c.id;
        }
        return {
          stop_code: String(x.code || '').padStart(6, '0') || null,
          name: x.name,
          address: x.address || null,
          latitude: Number(x.latitude),
          longitude: Number(x.longitude),
          settlement_id: s_id,
          status: 'active'
        };
      }).filter(x => x.name && x.latitude && x.longitude);

      const { error } = await window.sb.from('stops').insert(valid);
      if (error) { playBeep(false); UI.toast(error.message, 'err'); }
      else { playBeep(true); UI.toast(`Загружено: ${valid.length}`, 'ok'); area.value = ''; loadData(); }
    };

    return div;
  }

  // ========== 8. КАРТА ==========
  function initMapTab() {
    document.body.classList.remove('fullscreen');
    const div = document.createElement('div');
    div.style.height = 'calc(100vh - 160px)';
    div.style.borderRadius = 'var(--radius)';
    div.style.overflow = 'hidden';
    div.innerHTML = `<div id="map-all" style="height:100%;"></div>`;
    
    setTimeout(() => {
      if (mapAll) mapAll.remove();
      mapAll = L.map('map-all').setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapAll);
      renderAllMap();
    }, 100);

    return div;
  }

  function renderAllMap() {
    if (!mapAll) return;
    mapAll.eachLayer(l => { if (l instanceof L.Marker) mapAll.removeLayer(l); });

    allStops.forEach(s => {
      const cityName = s.settlements ? s.settlements.name : '—';
      const popup = document.createElement('div');
      popup.className = 'popup-content';
      popup.innerHTML = `
        <h4>${s.name} <small>[${s.stop_code}]</small></h4>
        <p>Город: ${cityName}</p>
        <p>Адрес: ${s.address || '—'}</p>
        <div class="popup-actions">
          <button class="edit">Изменить</button>
          <button class="del">Удалить</button>
        </div>
      `;
      popup.querySelector('.edit').onclick = () => { switchTab('add'); setTimeout(() => fillAddForm(s), 200); };
      popup.querySelector('.del').onclick = () => safeDelete(s);

      L.marker([s.latitude, s.longitude]).addTo(mapAll).bindPopup(popup);
    });
  }

  // ========== 9. НАСТРОЙКИ (СТРОГО ПО ТЗ) ==========
  function buildSettings() {
    const btn = document.createElement('button');
    btn.className = 'settings-btn';
    btn.textContent = 'Настройки';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.innerHTML = `
      <h2 style="margin-top:0; font-size:18px;">Настройки</h2>
      
      <div style="margin-bottom:24px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="set-sound" ${settings.sound ? 'checked':''}/>
          <span>Звуковой отклик</span>
        </label>
      </div>

      <div style="margin-bottom:24px;">
        <button class="btn" id="set-mirror" style="width:100%;">Зеркалировать интерфейс</button>
      </div>

      <div style="margin-bottom:24px;">
        <label style="font-size:13px; color:var(--muted);">Пропорции формы / карты</label>
        <input type="range" id="set-ratio" min="20" max="80" value="${settings.ratio}" style="width:100%; margin-top:8px;" />
        <div style="text-align:right; font-size:12px; color:var(--muted);" id="ratio-val">${settings.ratio}%</div>
      </div>

      <div style="margin-bottom:24px;">
        <button class="btn btn--brand" id="set-center" style="width:100%;">Зафиксировать текущий вид карты</button>
      </div>

      <button class="btn btn--danger" id="set-reset" style="width:100%;">Сбросить настройки</button>
    `;
    document.body.appendChild(panel);

    btn.onclick = () => panel.classList.toggle('open');
    
    panel.querySelector('#set-sound').onchange = e => { settings.sound = e.target.checked; saveSettings(); };
    panel.querySelector('#set-mirror').onclick = () => { settings.isMirrored = !settings.isMirrored; saveSettings(); if(currentTab === 'add') switchTab('add'); };
    
    const ratioInput = panel.querySelector('#set-ratio');
    const ratioVal = panel.querySelector('#ratio-val');
    ratioInput.oninput = e => { ratioVal.textContent = e.target.value + '%'; };
    ratioInput.onchange = e => { 
      settings.ratio = parseInt(e.target.value); 
      saveSettings(); 
      const form = document.querySelector('.split-form');
      if (form) form.style.flex = `0 0 ${settings.ratio}%`;
    };

    panel.querySelector('#set-center').onclick = () => {
      const activeMap = currentTab === 'add' ? mapAdd : (currentTab === 'map' ? mapAll : null);
      if (activeMap) {
        const c = activeMap.getCenter();
        settings.mapCenter = [c.lat, c.lng];
        settings.mapZoom = activeMap.getZoom();
        saveSettings();
        UI.toast('Текущий вид карты зафиксирован', 'ok');
      } else {
        UI.toast('Откройте карту для фиксации', 'err');
      }
    };

    panel.querySelector('#set-reset').onclick = () => {
      localStorage.removeItem('stops_settings');
      location.reload();
    };
  }

  // ========== 10. КОНТРОЛЛЕР ==========
  function switchTab(tab) {
    currentTab = tab;
    contentArea.innerHTML = '';
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'list') contentArea.appendChild(initListTab());
    if (tab === 'add') contentArea.appendChild(initAddTab());
    if (tab === 'mass') contentArea.appendChild(initMassTab());
    if (tab === 'map') contentArea.appendChild(initMapTab());
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    loadSettings();
    const content = UI.renderShell({ title: 'Остановки', profile, active: 'stops.html' });
    contentArea = content;

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.innerHTML = `
      <button class="tab active" data-tab="list">Реестр</button>
      <button class="tab" data-tab="add">Добавление</button>
      <button class="tab" data-tab="mass">Импорт</button>
      <button class="tab" data-tab="map">Карта</button>
    `;
    tabs.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) switchTab(b.dataset.tab);
    };

    // Хоткеи
    document.addEventListener('keydown', (e) => {
      if (e.altKey) {
        if (e.key === '1') { e.preventDefault(); switchTab('list'); }
        if (e.key === '2') { e.preventDefault(); switchTab('add'); }
        if (e.key === '3') { e.preventDefault(); switchTab('mass'); }
        if (e.key === '4') { e.preventDefault(); switchTab('map'); }
      }
    });

    content.parentElement.insertBefore(tabs, content);

    buildSettings();
    await loadData();
    switchTab('list');
  }

  document.addEventListener('DOMContentLoaded', main);
})();
