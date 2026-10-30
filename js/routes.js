(function () {
  'use strict';

  let allRoutes = [];
  let allStops = [];
  let selectedRouteId = null;
  
  // Карты
  let mapList = null; 
  let mapEditor = null;
  let listLayer = null;
  let editorLayer = null;

  // Состояние редактора
  let editId = null;
  let direction = 'forward'; // 'forward' или 'backward'
  let fwdStops = [];
  let bwdStops = [];
  let draggableInstance = null;

  // ==========================================
  // 1. ЗАГРУЗКА ДАННЫХ
  // ==========================================
  async function loadData() {
    try {
      const [rRes, sRes] = await Promise.all([
        window.sb.from('routes').select('*, route_stops(count)').order('code'),
        window.sb.from('stops').select('id, name, stop_code, latitude, longitude').order('name')
      ]);
      
      if (rRes.error) throw rRes.error;
      if (sRes.error) throw sRes.error;

      allRoutes = rRes.data || [];
      allStops = sRes.data || [];

      renderTable();
    } catch (err) {
      UI.toast('Ошибка загрузки: ' + err.message, 'err');
    }
  }

  // ==========================================
  // 2. ТАБЛИЦА (РЕЕСТР)
  // ==========================================
  function renderTable() {
    const tbody = document.getElementById('routes-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (allRoutes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--muted);">Нет маршрутов</td></tr>';
      return;
    }

    allRoutes.forEach(r => {
      const tr = document.createElement('tr');
      if (r.id === selectedRouteId) tr.classList.add('active');
      
      tr.innerHTML = `
        <td><span class="route-color" style="background:${r.color || '#2563eb'}"></span> <strong>${r.code}</strong></td>
        <td>${r.name}</td>
        <td><span class="badge badge--muted">${r.route_stops ? r.route_stops[0].count : 0} ост.</span></td>
        <td style="text-align:right;">
          <button class="btn btn--sm edit-btn" style="padding:4px 8px; margin-right:4px;">Ред.</button>
          <button class="btn btn--sm btn--danger del-btn" style="padding:4px 8px;">Удал.</button>
        </td>
      `;

      tr.onclick = (e) => {
        if (e.target.closest('button')) return;
        selectRoute(r.id);
      };

      tr.querySelector('.edit-btn').onclick = (e) => { e.stopPropagation(); openEditor(r); };
      tr.querySelector('.del-btn').onclick = (e) => { e.stopPropagation(); deleteRoute(r); };

      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // 3. КАРТА СПИСКА (СПРАВА)
  // ==========================================
  function initMapList() {
    if (mapList) return;
    mapList = L.map('route-map').setView([40.1209, 9.0129], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapList);
    listLayer = L.layerGroup().addTo(mapList);
    
    if (window.ResizeObserver) new ResizeObserver(() => { if (mapList) mapList.invalidateSize(); }).observe(document.getElementById('route-map'));
    setTimeout(() => { if (mapList) mapList.invalidateSize(); }, 300);
  }

  async function selectRoute(routeId) {
    selectedRouteId = routeId;
    renderTable();

    if (!mapList) return;
    listLayer.clearLayers();

    try {
      const { data: routeStops } = await window.sb.from('route_stops')
        .select('order_index, stops(id, name, latitude, longitude)')
        .eq('route_id', routeId).eq('direction', 'forward').order('order_index');

      if (!routeStops || routeStops.length === 0) return;

      const latlngs = [];
      routeStops.forEach(rs => {
        if (!rs.stops || !rs.stops.latitude) return;
        const ll = [rs.stops.latitude, rs.stops.longitude];
        latlngs.push(ll);
        L.circleMarker(ll, { radius: 6, fillColor: '#2563eb', color: '#fff', weight: 2 }).addTo(listLayer).bindPopup(rs.stops.name);
      });

      if (latlngs.length > 1) L.polyline(latlngs, { color: '#2563eb', weight: 4 }).addTo(listLayer);
      mapList.fitBounds(latlngs, { padding: [40, 40] });
    } catch (err) {}
  }

  // ==========================================
  // 4. ПОЛНОЭКРАННЫЙ РЕДАКТОР
  // ==========================================
  async function openEditor(route = null) {
    document.getElementById('view-list').style.display = 'none';
    document.getElementById('view-editor').style.display = 'flex';
    
    editId = route ? route.id : null;
    fwdStops = [];
    bwdStops = [];
    direction = 'forward';

    document.getElementById('ed-code').value = route ? route.code : '';
    document.getElementById('ed-name').value = route ? route.name : '';
    document.getElementById('ed-color').value = route ? route.color : '#2563eb';
    document.getElementById('editor-title').textContent = editId ? 'Редактирование маршрута' : 'Новый маршрут';

    // Загружаем остановки, если редактируем
    if (editId) {
      const { data } = await window.sb.from('route_stops').select('stop_id, direction').eq('route_id', editId).order('order_index');
      if (data) {
        data.forEach(rs => {
          const stop = allStops.find(s => s.id === rs.stop_id);
          if (!stop) return;
          if (rs.direction === 'forward') fwdStops.push(stop);
          else bwdStops.push(stop);
        });
      }
    }

    // Инициализируем карту редактора
    setTimeout(() => {
      if (!mapEditor) {
        mapEditor = L.map('editor-map-canvas').setView([40.1209, 9.0129], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapEditor);
        editorLayer = L.layerGroup().addTo(mapEditor);
        if (window.ResizeObserver) new ResizeObserver(() => { if (mapEditor) mapEditor.invalidateSize(); }).observe(document.getElementById('editor-map-canvas'));
      }
      mapEditor.invalidateSize();
      renderEditorStops();
    }, 100);

    setupTabs();
    setupSearch();
  }

  function closeEditor() {
    document.getElementById('view-editor').style.display = 'none';
    document.getElementById('view-list').style.display = 'flex';
    editId = null;
    if (mapEditor) { mapEditor.remove(); mapEditor = null; }
  }

  // ==========================================
  // 5. ЛОГИКА ВКЛАДОК И СПИСКА В РЕДАКТОРЕ
  // ==========================================
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        direction = btn.dataset.dir;
        renderEditorStops();
      };
    });
  }

  function renderEditorStops() {
    const container = document.getElementById('editor-stops-list');
    const stopsArr = direction === 'forward' ? fwdStops : bwdStops;
    
    container.innerHTML = '';
    if (stopsArr.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted); font-size:12px;">Остановок нет</div>';
    } else {
      stopsArr.forEach((stop, index) => {
        const div = document.createElement('div');
        div.className = 'stop-item';
        div.draggable = true;
        div.dataset.index = index;
        div.innerHTML = `
          <span><span style="color:var(--muted); margin-right:8px;">☰</span> ${index + 1}. ${stop.name}</span>
          <button class="btn-remove" title="Удалить">&times;</button>
        `;
        
        div.querySelector('.btn-remove').onclick = () => {
          if (direction === 'forward') fwdStops.splice(index, 1);
          else bwdStops.splice(index, 1);
          renderEditorStops();
          drawEditorMap();
        };

        // Drag & Drop
        div.ondragstart = (e) => { e.dataTransfer.setData('text/plain', index); div.classList.add('dragging'); };
        div.ondragend = () => { div.classList.remove('dragging'); };
        div.ondragover = (e) => { e.preventDefault(); };
        div.ondrop = (e) => {
          e.preventDefault();
          const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
          const toIndex = index;
          if (fromIndex === toIndex) return;
          
          const arr = direction === 'forward' ? fwdStops : bwdStops;
          const moved = arr.splice(fromIndex, 1)[0];
          arr.splice(toIndex, 0, moved);
          
          renderEditorStops();
          drawEditorMap();
        };

        container.appendChild(div);
      });
    }
    drawEditorMap();
  }

  // Поиск остановок (автокомплит)
  function setupSearch() {
    const input = document.getElementById('search-stop');
    const results = document.getElementById('search-results');

    input.oninput = () => {
      const q = input.value.toLowerCase();
      if (!q) { results.style.display = 'none'; return; }

      const matched = allStops.filter(s => s.name.toLowerCase().includes(q) && !fwdStops.find(x=>x.id===s.id) && !bwdStops.find(x=>x.id===s.id)).slice(0, 10);
      
      results.innerHTML = '';
      if (matched.length === 0) { results.style.display = 'none'; return; }

      matched.forEach(s => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.textContent = `${s.name} (${s.stop_code})`;
        div.onclick = () => {
          if (direction === 'forward') fwdStops.push(s);
          else bwdStops.push(s);
          input.value = '';
          results.style.display = 'none';
          renderEditorStops();
        };
        results.appendChild(div);
      });
      results.style.display = 'block';
    };

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !results.contains(e.target)) results.style.display = 'none';
    });
  }

  // Отрисовка карты в редакторе
  function drawEditorMap() {
    if (!mapEditor) return;
    editorLayer.clearLayers();

    const stopsArr = direction === 'forward' ? fwdStops : bwdStops;
    const latlngs = [];

    stopsArr.forEach((stop, idx) => {
      const ll = [stop.latitude, stop.longitude];
      latlngs.push(ll);
      
      const color = direction === 'forward' ? '#2563eb' : '#f59e0b';
      L.circleMarker(ll, { radius: 6, fillColor: color, color: '#fff', weight: 2 }).addTo(editorLayer)
        .bindPopup(`<b>${idx + 1}. ${stop.name}</b>`).openPopup();
    });

    if (latlngs.length > 1) {
      const color = direction === 'forward' ? '#2563eb' : '#f59e0b';
      L.polyline(latlngs, { color: color, weight: 4 }).addTo(editorLayer);
      mapEditor.fitBounds(latlngs, { padding: [30, 30] });
    } else if (latlngs.length === 1) {
      mapEditor.setView(latlngs[0], 15);
    }
  }

  // Генерация обратного пути
  document.getElementById('btn-reverse')?.addEventListener('click', () => {
    if (fwdStops.length === 0) return UI.toast('Сначала добавьте остановки "Туда"', 'err');
    bwdStops = [...fwdStops].reverse();
    document.querySelector('.tab-btn[data-dir="backward"]').click();
    UI.toast('Обратный путь сгенерирован', 'ok');
  });

  // ==========================================
  // 6. СОХРАНЕНИЕ
  // ==========================================
  async function saveRoute() {
    const code = document.getElementById('ed-code').value.trim();
    const name = document.getElementById('ed-name').value.trim();
    const color = document.getElementById('ed-color').value;

    if (!code || !name) return UI.toast('Заполните код и название', 'err');
    if (fwdStops.length === 0) return UI.toast('Добавьте хотя бы одну остановку "Туда"', 'err');

    const btn = document.getElementById('btn-save-route');
    btn.disabled = true; btn.textContent = 'Сохранение...';

    try {
      let routeId = editId;
      const payload = { code, name, color, is_active: true };

      // 1. Маршрут
      if (editId) {
        await window.sb.from('routes').update(payload).eq('id', editId);
      } else {
        const { data, error } = await window.sb.from('routes').insert(payload).select().single();
        if (error) throw error;
        routeId = data.id;
      }

      // 2. Удаляем старые остановки
      await window.sb.from('route_stops').delete().eq('route_id', routeId);

      // 3. Вставляем новые
      const inserts = [];
      fwdStops.forEach((s, i) => inserts.push({ route_id: routeId, stop_id: s.id, direction: 'forward', order_index: i + 1 }));
      bwdStops.forEach((s, i) => inserts.push({ route_id: routeId, stop_id: s.id, direction: 'backward', order_index: i + 1 }));

      if (inserts.length > 0) {
        const { error } = await window.sb.from('route_stops').insert(inserts);
        if (error) throw error;
      }

      UI.toast('Маршрут сохранен', 'ok');
      closeEditor();
      await loadData();
      selectRoute(routeId);

    } catch (err) {
      UI.toast(err.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Сохранить маршрут';
    }
  }

  // ==========================================
  // 7. УДАЛЕНИЕ
  // ==========================================
  async function deleteRoute(route) {
    if (!confirm(`Удалить маршрут ${route.code}?`)) return;
    try {
      await window.sb.from('routes').delete().eq('id', route.id);
      UI.toast('Маршрут удален', 'ok');
      if (selectedRouteId === route.id) { selectedRouteId = null; if (listLayer) listLayer.clearLayers(); }
      await loadData();
    } catch (err) { UI.toast(err.message, 'err'); }
  }

  // ==========================================
  // 8. ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ
  // ==========================================
  async function main() {
    try { if (window.Auth) await window.Auth.requireStaff(); } catch (e) { return; }

    const content = UI.renderShell({ title: 'Маршруты', profile: window.currentProfile, active: 'routes.html' });
    content.innerHTML = `
      <!-- ВЬЮ 1: СПИСОК (Master-Detail) -->
      <div id="view-list" class="master-layout">
        <div class="master-left">
          <div class="list-card">
            <div class="list-header">
              <input id="search-route" placeholder="Поиск..." style="flex:1;" />
              <button class="btn btn--brand" id="btn-create">+ Создать</button>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Код</th><th>Название</th><th>Ост.</th><th>Действия</th></tr></thead>
                <tbody id="routes-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="master-right"><div id="route-map"></div></div>
      </div>

      <!-- ВЬЮ 2: РЕДАКТОР -->
      <div id="view-editor" class="editor-view">
        <!-- Карта -->
        <div class="editor-map"><div id="editor-map-canvas"></div></div>
        
        <!-- Панель управления -->
        <div class="editor-panel">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h2 id="editor-title" style="margin:0; font-size:18px;">Новый маршрут</h2>
            <button class="btn btn--sm" onclick="document.getElementById('btn-close-editor').click()">Закрыть</button>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="form-group"><label>Код *</label><input id="ed-code" placeholder="А-1" /></div>
            <div class="form-group"><label>Название *</label><input id="ed-name" placeholder="Центр - Вокзал" /></div>
          </div>
          <div class="form-group"><label>Цвет</label><input id="ed-color" type="color" value="#2563eb" style="height:40px;" /></div>

          <div class="tabs-nav" style="margin-top:12px;">
            <button class="tab-btn active" data-dir="forward">Туда</button>
            <button class="tab-btn" data-dir="backward">Обратно</button>
          </div>

          <!-- Поиск остановки -->
          <div style="position:relative; margin-bottom:12px;">
            <input id="search-stop" placeholder="Найти остановку..." style="width:100%; padding:10px; background:var(--bg); border:1px solid var(--border); border-radius:6px;" />
            <div id="search-results" class="search-results"></div>
          </div>

          <!-- Список остановок -->
          <div class="stop-list" id="editor-stops-list" style="flex:1;"></div>

          <div style="margin-top:16px; display:flex; gap:8px; flex-direction:column;">
            <button class="btn" id="btn-reverse" style="background:var(--card);">Развернуть обратно (из Туда)</button>
            <div style="display:flex; gap:8px;">
              <button class="btn" id="btn-close-editor" style="flex:1; color:var(--err);">Отмена</button>
              <button class="btn btn--brand" id="btn-save-route" style="flex:2;">Сохранить маршрут</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(content);

    // Слушатели
    document.getElementById('btn-create').onclick = () => openEditor(null);
    document.getElementById('btn-close-editor').onclick = closeEditor;
    document.getElementById('btn-save-route').onclick = saveRoute;
    document.getElementById('search-route').oninput = () => {
      const q = document.getElementById('search-route').value.toLowerCase();
      document.querySelectorAll('#routes-tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };

    initMapList();
    await loadData();
  }

  document.addEventListener('DOMContentLoaded', main);
})();
