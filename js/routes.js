(function () {
  'use strict';

  let allRoutes = [];
  let allStops = [];
  let selectedRouteId = null;
  let map = null;
  let routeLayer = null;
  let stopMarkers = [];

  // Состояние модалки
  let editId = null;
  let currentForwardStops = []; // Для модалки
  let currentBackwardStops = []; // Для модалки

  // ==========================================
  // 1. ЗАГРУЗКА ДАННЫХ
  // ==========================================
  async function loadData() {
    try {
      const [rRes, sRes] = await Promise.all([
        window.sb.from('routes').select('*, route_stops(count)').order('code'),
        window.sb.from('stops').select('id, name, stop_code, latitude, longitude, settlements(name)').order('name')
      ]);
      
      if (rRes.error) throw rRes.error;
      if (sRes.error) throw sRes.error;

      allRoutes = rRes.data || [];
      allStops = sRes.data || [];

      renderRoutesTable();
    } catch (err) {
      UI.toast('Ошибка загрузки: ' + err.message, 'err');
    }
  }

  // ==========================================
  // 2. ТАБЛИЦА МАРШРУТОВ
  // ==========================================
  function renderRoutesTable() {
    const tbody = document.getElementById('routes-tbody');
    if (!tbody) return;

    const search = document.getElementById('search-route').value.toLowerCase();
    
    let filtered = allRoutes.filter(r => 
      (r.code || '').toLowerCase().includes(search) || 
      (r.name || '').toLowerCase().includes(search)
    );

    tbody.innerHTML = '';
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--muted);">Маршрутов не найдено</td></tr>';
      return;
    }

    filtered.forEach(r => {
      const tr = document.createElement('tr');
      if (r.id === selectedRouteId) tr.classList.add('active');
      
      tr.innerHTML = `
        <td>
          <span class="route-color" style="background:${r.color || '#2563eb'}"></span>
          <strong>${r.code}</strong>
        </td>
        <td>${r.name}</td>
        <td><span class="badge badge--muted">${r.route_stops ? r.route_stops[0].count : 0} ост.</span></td>
        <td style="text-align:right;">
          <button class="btn btn--sm edit-btn" style="padding:4px 8px; margin-right:4px;">Ред.</button>
          <button class="btn btn--sm btn--danger del-btn" style="padding:4px 8px;">Удал.</button>
        </td>
      `;

      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        selectRoute(r.id);
      });

      tr.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openRouteModal(r);
      });

      tr.querySelector('.del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRoute(r);
      });

      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // 3. КАРТА И ОТРИСОВКА МАРШРУТА
  // ==========================================
  function initMap() {
    if (map) return;
    map = L.map('route-map', { zoomControl: true }).setView([40.1209, 9.0129], 10); // Центр Уджана/Сардинии
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    routeLayer = L.layerGroup().addTo(map);

    // Фикс исчезновения карты
    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (map) map.invalidateSize(); }).observe(document.getElementById('route-map'));
    }
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);
  }

  async function selectRoute(routeId) {
    selectedRouteId = routeId;
    renderRoutesTable(); // Обновить подсветку

    if (!map) return;
    routeLayer.clearLayers();

    // Загружаем остановки выбранного маршрута
    try {
      const { data: routeStops, error } = await window.sb
        .from('route_stops')
        .select('order_index, direction, stops(id, name, latitude, longitude)')
        .eq('route_id', routeId)
        .eq('direction', 'forward')
        .order('order_index');

      if (error) throw error;

      if (!routeStops || routeStops.length === 0) {
        UI.toast('У этого маршрута пока нет остановок', 'warn');
        return;
      }

      const latlngs = [];
      routeStops.forEach((rs, idx) => {
        const stop = rs.stops;
        if (!stop || !stop.latitude) return;

        const ll = [stop.latitude, stop.longitude];
        latlngs.push(ll);

        // Рисуем маркер
        const marker = L.circleMarker(ll, {
          radius: 6, fillColor: '#2563eb', color: '#fff', weight: 2, fillOpacity: 1
        }).addTo(routeLayer);
        
        marker.bindPopup(`<b>${idx + 1}. ${stop.name}</b>`);
      });

      // Рисуем линию
      if (latlngs.length > 1) {
        L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.8 }).addTo(routeLayer);
      }

      // Центрируем карту
      map.fitBounds(latlngs, { padding: [40, 40] });

    } catch (err) {
      UI.toast('Ошибка загрузки маршрута: ' + err.message, 'err');
    }
  }

  // ==========================================
  // 4. МОДАЛКА РЕДАКТИРОВАНИЯ
  // ==========================================
  async function openRouteModal(route = null) {
    editId = route ? route.id : null;
    currentForwardStops = [];
    currentBackwardStops = [];

    const m = UI.createModal({ title: editId ? 'Редактировать маршрут' : 'Новый маршрут' });
    m.dialog.classList.add('modal-route');

    // Если редактируем - загружаем остановки
    if (editId) {
      const { data } = await window.sb.from('route_stops')
        .select('stop_id, order_index, direction')
        .eq('route_id', editId)
        .order('order_index');
      
      if (data) {
        data.forEach(rs => {
          const stopObj = allStops.find(s => s.id === rs.stop_id);
          if (!stopObj) return;
          if (rs.direction === 'forward') currentForwardStops.push(stopObj);
          else currentBackwardStops.push(stopObj);
        });
      }
    }

    m.body.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Код маршрута *</label>
          <input id="m-code" required value="${route ? route.code : ''}" placeholder="А-1" />
        </div>
        <div class="field">
          <label>Название *</label>
          <input id="m-name" required value="${route ? route.name : ''}" placeholder="Центр - Вокзал" />
        </div>
        <div class="field">
          <label>Цвет на карте</label>
          <input id="m-color" type="color" value="${route ? route.color : '#2563eb'}" style="height:38px; padding:2px;" />
        </div>
        <div class="field">
          <label>Статус</label>
          <select id="m-active">
            <option value="true" ${!route || route.is_active ? 'selected' : ''}>Активен</option>
            <option value="false" ${route && !route.is_active ? 'selected' : ''}>Отключен</option>
          </select>
        </div>
      </div>

      <div class="stops-manager">
        <div class="stops-col">
          <h4>Доступные остановки</h4>
          <input type="text" id="search-stops" placeholder="Поиск..." style="padding:6px; margin-bottom:4px;" />
          <div class="stops-list" id="available-stops"></div>
        </div>
        
        <div style="display:flex; flex-direction:column; justify-content:center; gap:8px;">
          <button class="btn" id="btn-add-forward" title="Добавить в 'Туда'">➡️</button>
          <button class="btn" id="btn-add-backward" title="Добавить в 'Обратно'">⬅️</button>
        </div>

        <div class="stops-col">
          <h4>Маршрут (Туда)</h4>
          <div class="stops-list" id="forward-list"></div>
        </div>

        <div class="stops-col">
          <h4>Маршрут (Обратно)</h4>
          <div class="stops-list" id="backward-list"></div>
        </div>
      </div>

      <div class="modal__actions" style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
        <button class="btn" id="m-cancel">Отмена</button>
        <button class="btn btn--brand" id="m-save">Сохранить маршрут</button>
      </div>
    `;

    // Отрисовка списков
    const renderLists = () => {
      // 1. Доступные
      const search = document.getElementById('search-stops').value.toLowerCase();
      const availEl = document.getElementById('available-stops');
      availEl.innerHTML = '';
      
      const usedIds = new Set([...currentForwardStops.map(s=>s.id), ...currentBackwardStops.map(s=>s.id)]);
      
      allStops.filter(s => !usedIds.has(s.id) && s.name.toLowerCase().includes(search)).forEach(s => {
        const div = document.createElement('div');
        div.className = 'stop-item';
        div.innerHTML = `<span>${s.name}</span> <small style="color:var(--muted)">${s.stop_code}</small>`;
        div.onclick = () => div.classList.toggle('selected');
        availEl.appendChild(div);
      });

      // 2. Туда
      const fwdEl = document.getElementById('forward-list');
      fwdEl.innerHTML = '';
      currentForwardStops.forEach((s, idx) => {
        const div = document.createElement('div');
        div.className = 'stop-item';
        div.innerHTML = `
          <span><span class="drag-handle">☰</span> ${idx+1}. ${s.name}</span>
          <div class="stop-actions">
            <button class="btn btn--sm btn-arrow up" data-idx="${idx}">↑</button>
            <button class="btn btn--sm btn-arrow down" data-idx="${idx}">↓</button>
            <button class="btn btn--sm btn--danger rm-fwd" data-idx="${idx}">×</button>
          </div>
        `;
        // Обработчики кнопок
        div.querySelector('.up').onclick = (e) => { e.stopPropagation(); if(idx>0){ [currentForwardStops[idx-1], currentForwardStops[idx]] = [currentForwardStops[idx], currentForwardStops[idx-1]]; renderLists(); } };
        div.querySelector('.down').onclick = (e) => { e.stopPropagation(); if(idx<currentForwardStops.length-1){ [currentForwardStops[idx+1], currentForwardStops[idx]] = [currentForwardStops[idx], currentForwardStops[idx+1]]; renderLists(); } };
        div.querySelector('.rm-fwd').onclick = (e) => { e.stopPropagation(); currentForwardStops.splice(idx, 1); renderLists(); };
        fwdEl.appendChild(div);
      });

      // 3. Обратно
      const bwdEl = document.getElementById('backward-list');
      bwdEl.innerHTML = '';
      currentBackwardStops.forEach((s, idx) => {
        const div = document.createElement('div');
        div.className = 'stop-item';
        div.innerHTML = `
          <span><span class="drag-handle">☰</span> ${idx+1}. ${s.name}</span>
          <div class="stop-actions">
            <button class="btn btn--sm btn-arrow up" data-idx="${idx}">↑</button>
            <button class="btn btn--sm btn-arrow down" data-idx="${idx}">↓</button>
            <button class="btn btn--sm btn--danger rm-bwd" data-idx="${idx}">×</button>
          </div>
        `;
        div.querySelector('.up').onclick = (e) => { e.stopPropagation(); if(idx>0){ [currentBackwardStops[idx-1], currentBackwardStops[idx]] = [currentBackwardStops[idx], currentBackwardStops[idx-1]]; renderLists(); } };
        div.querySelector('.down').onclick = (e) => { e.stopPropagation(); if(idx<currentBackwardStops.length-1){ [currentBackwardStops[idx+1], currentBackwardStops[idx]] = [currentBackwardStops[idx], currentBackwardStops[idx+1]]; renderLists(); } };
        div.querySelector('.rm-bwd').onclick = (e) => { e.stopPropagation(); currentBackwardStops.splice(idx, 1); renderLists(); };
        bwdEl.appendChild(div);
      });
    };

    // Слушатели кнопок добавления
    document.getElementById('search-stops').oninput = renderLists;
    
    document.getElementById('btn-add-forward').onclick = () => {
      const selected = Array.from(document.querySelectorAll('#available-stops .stop-item.selected'));
      selected.forEach(el => {
        const name = el.querySelector('span').textContent;
        const stop = allStops.find(s => s.name === name);
        if (stop) currentForwardStops.push(stop);
      });
      renderLists();
    };

    document.getElementById('btn-add-backward').onclick = () => {
      const selected = Array.from(document.querySelectorAll('#available-stops .stop-item.selected'));
      selected.forEach(el => {
        const name = el.querySelector('span').textContent;
        const stop = allStops.find(s => s.name === name);
        if (stop) currentBackwardStops.push(stop);
      });
      renderLists();
    };

    // Авто-генерация обратного пути
    document.getElementById('btn-add-backward').ondblclick = () => {
      if (currentForwardStops.length > 0) {
        currentBackwardStops = [...currentForwardStops].reverse();
        renderLists();
        UI.toast('Обратный путь сгенерирован', 'ok');
      }
    };

    renderLists();

    // Сохранение
    document.getElementById('m-cancel').onclick = m.close;
    document.getElementById('m-save').onclick = async () => {
      const code = document.getElementById('m-code').value.trim();
      const name = document.getElementById('m-name').value.trim();
      const color = document.getElementById('m-color').value;
      const is_active = document.getElementById('m-active').value === 'true';

      if (!code || !name) return UI.toast('Заполните код и название', 'err');

      const btn = document.getElementById('m-save');
      btn.disabled = true; btn.textContent = 'Сохранение...';

      try {
        // 1. Сохраняем/обновляем сам маршрут
        const payload = { code, name, color, is_active };
        let routeId = editId;

        if (editId) {
          const { error } = await window.sb.from('routes').update(payload).eq('id', editId);
          if (error) throw error;
        } else {
          const { data, error } = await window.sb.from('routes').insert(payload).select().single();
          if (error) throw error;
          routeId = data.id;
        }

        // 2. Удаляем старые остановки
        await window.sb.from('route_stops').delete().eq('route_id', routeId);

        // 3. Вставляем новые
        const inserts = [];
        currentForwardStops.forEach((s, idx) => {
          inserts.push({ route_id: routeId, stop_id: s.id, direction: 'forward', order_index: idx + 1 });
        });
        currentBackwardStops.forEach((s, idx) => {
          inserts.push({ route_id: routeId, stop_id: s.id, direction: 'backward', order_index: idx + 1 });
        });

        if (inserts.length > 0) {
          const { error } = await window.sb.from('route_stops').insert(inserts);
          if (error) throw error;
        }

        UI.toast('Маршрут сохранен', 'ok');
        m.close();
        await loadData();
        selectRoute(routeId);

      } catch (err) {
        UI.toast(err.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = 'Сохранить маршрут';
      }
    };
  }

  // ==========================================
  // 5. УДАЛЕНИЕ
  // ==========================================
  async function deleteRoute(route) {
    if (!confirm(`Удалить маршрут ${route.code} - ${route.name}?`)) return;
    try {
      await window.sb.from('routes').delete().eq('id', route.id);
      UI.toast('Маршрут удален', 'ok');
      if (selectedRouteId === route.id) {
        selectedRouteId = null;
        if (routeLayer) routeLayer.clearLayers();
      }
      await loadData();
    } catch (err) {
      UI.toast(err.message, 'err');
    }
  }

  // ==========================================
  // 6. ИНИЦИАЛИЗАЦИЯ
  // ==========================================
  async function main() {
    try { if (window.Auth) await window.Auth.requireStaff(); } catch (e) { return; }

    const content = UI.renderShell({ title: 'Маршруты', profile: window.currentProfile, active: 'routes.html' });
    content.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'master-layout';
    layout.innerHTML = `
      <div class="master-left">
        <div class="list-card">
          <div class="list-header">
            <input id="search-route" placeholder="Поиск по коду или названию..." style="flex:1;" />
            <button class="btn btn--brand" id="btn-create-route">+ Создать</button>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Название</th>
                  <th>Остановки</th>
                  <th style="text-align:right;">Действия</th>
                </tr>
              </thead>
              <tbody id="routes-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="master-right">
        <div id="route-map"></div>
      </div>
    `;
    content.appendChild(layout);

    initMap();
    await loadData();

    document.getElementById('search-route').addEventListener('input', UI.debounce(renderRoutesTable, 300));
    document.getElementById('btn-create-route').addEventListener('click', () => openRouteModal(null));
  }

  document.addEventListener('DOMContentLoaded', main);
})();
