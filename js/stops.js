(function () {
  'use strict';

  let allStops = [];
  let allCities = [];
  let map = null;
  let addMarker = null;
  let editId = null;
  let isProcessing = false;
  let currentFilters = { query: '', status: 'all', city: 'all' };
  let currentSort = { field: 'stop_code', dir: 'desc' };
  let isFormDirty = false;

  let settings = {
    sound: true,
    isMirrored: false,
    ratio: 45,
    mapCenter: [40.1209, 9.0129],
    mapZoom: 8,
    autoSaveDraft: true,
    confirmDelete: true,
    showClosedOnMap: false
  };

  const DOM = {
    grid: null, leftPanel: null, form: null, citySelect: null, codeInput: null,
    nameInput: null, addrInput: null, coordsInput: null, saveBtn: null, resetBtn: null,
    newCityBtn: null, tableBody: null, searchInput: null, filterCity: null,
    filterStatus: null, formTitle: null, mapContainer: null
  };

  function initDOM() {
    DOM.grid = document.querySelector('.workspace-grid');
    DOM.leftPanel = document.querySelector('.left-panel');
    DOM.form = document.getElementById('add-form');
    DOM.citySelect = document.getElementById('f-city');
    DOM.codeInput = document.getElementById('f-code');
    DOM.nameInput = document.getElementById('f-name');
    DOM.addrInput = document.getElementById('f-addr');
    DOM.coordsInput = document.getElementById('f-coords');
    DOM.saveBtn = document.getElementById('btn-save');
    DOM.resetBtn = document.getElementById('btn-reset');
    DOM.newCityBtn = document.getElementById('btn-new-city');
    DOM.tableBody = document.getElementById('tbody-list');
    DOM.searchInput = document.getElementById('search-input');
    DOM.filterCity = document.getElementById('filter-city');
    DOM.filterStatus = document.getElementById('filter-status');
    DOM.formTitle = document.getElementById('form-title');
    DOM.mapContainer = document.getElementById('main-map');
  }

  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  function showToast(msg, type = 'ok') {
    if (window.UI && window.UI.toast) window.UI.toast(msg, type);
    else alert(msg);
  }

  function playSound(type) {
    if (!settings.sound) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      if (type === 'success') { osc.frequency.setValueAtTime(800, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1); }
      else if (type === 'error') { osc.frequency.setValueAtTime(300, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.15); }
      else { osc.frequency.setValueAtTime(600, ctx.currentTime); }
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem('stops_global_settings');
      if (saved) settings = Object.assign({}, settings, JSON.parse(saved));
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem('stops_global_settings', JSON.stringify(settings));
    } catch (e) {}
  }

  function applySettings() {
    if (DOM.grid) {
      DOM.grid.style.gridTemplateColumns = settings.isMirrored 
        ? `1fr ${settings.ratio}%` 
        : `${settings.ratio}% 1fr`;
    }
    saveSettings();
    if (map) setTimeout(() => map.invalidateSize(), 250);
  }

  function loadDraft() {
    if (!settings.autoSaveDraft || editId) return;
    try {
      const d = localStorage.getItem('stops_form_draft');
      if (!d) return;
      const draft = JSON.parse(d);
      if (draft.city) DOM.citySelect.value = draft.city;
      if (draft.name) DOM.nameInput.value = draft.name;
      if (draft.addr) DOM.addrInput.value = draft.addr;
      if (draft.coords && map) {
        DOM.coordsInput.value = draft.coords;
        const [lat, lng] = draft.coords.split(',').map(Number);
        map.setView([lat, lng], 16);
        placeMarker(lat, lng);
      }
      isFormDirty = true;
    } catch (e) {}
  }

  function saveDraft() {
    if (!settings.autoSaveDraft || editId) return;
    try {
      const draft = {
        city: DOM.citySelect.value,
        name: DOM.nameInput.value,
        addr: DOM.addrInput.value,
        coords: DOM.coordsInput.value
      };
      localStorage.setItem('stops_form_draft', JSON.stringify(draft));
    } catch (e) {}
  }

  function clearDraft() {
    localStorage.removeItem('stops_form_draft');
    isFormDirty = false;
  }

  async function fetchData() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const [stopsRes, citiesRes] = await Promise.all([
        window.sb.from('stops').select('*, settlements(name)'),
        window.sb.from('settlements').select('*').order('name')
      ]);
      if (stopsRes.error) throw stopsRes.error;
      if (citiesRes.error) throw citiesRes.error;
      allStops = stopsRes.data || [];
      allCities = citiesRes.data || [];
      populateCities();
      renderTable();
      renderMarkers();
    } catch (err) {
      showToast('Ошибка загрузки данных: ' + err.message, 'err');
      playSound('error');
    } finally {
      isProcessing = false;
    }
  }

  function populateCities() {
    if (!DOM.citySelect || !DOM.filterCity) return;
    const currentCityVal = DOM.citySelect.value;
    const currentFilterVal = DOM.filterCity.value;
    
    DOM.citySelect.innerHTML = '<option value="">— Выберите город —</option>';
    DOM.filterCity.innerHTML = '<option value="all">Все города</option>';
    
    allCities.forEach(c => {
      const opt1 = document.createElement('option');
      opt1.value = c.id; opt1.textContent = c.name;
      DOM.citySelect.appendChild(opt1);
      
      const opt2 = document.createElement('option');
      opt2.value = c.id; opt2.textContent = c.name;
      DOM.filterCity.appendChild(opt2);
    });
    
    if (currentCityVal) DOM.citySelect.value = currentCityVal;
    if (currentFilterVal) DOM.filterCity.value = currentFilterVal;
  }

  function getFilteredStops() {
    return allStops.filter(s => {
      if (currentFilters.status !== 'all' && (s.status || 'active') !== currentFilters.status) return false;
      if (currentFilters.city !== 'all' && s.settlement_id !== currentFilters.city) return false;
      
      if (currentFilters.query) {
        const q = currentFilters.query.toLowerCase();
        const cityName = (s.settlements ? s.settlements.name : '').toLowerCase();
        const haystack = `${s.name} ${s.stop_code} ${s.address} ${cityName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      let valA = a[currentSort.field] || '';
      let valB = b[currentSort.field] || '';
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
      if (valA > valB) return currentSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function renderTable() {
    if (!DOM.tableBody) return;
    DOM.tableBody.innerHTML = '';
    const filtered = getFilteredStops();
    
    if (filtered.length === 0) {
      DOM.tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--muted);">Ничего не найдено</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    
    filtered.forEach(s => {
      const cityName = s.settlements ? s.settlements.name : '—';
      let statusLabel = 'Неизвестно', statusClass = 'muted';
      if (s.status === 'active') { statusLabel = 'Активна'; statusClass = 'ok'; }
      else if (s.status === 'reconstruction') { statusLabel = 'Реконструкция'; statusClass = 'warn'; }
      else if (s.status === 'closed') { statusLabel = 'Закрыта'; statusClass = 'err'; }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge--muted" style="font-family:monospace;">${escapeHTML(s.stop_code || '—')}</span></td>
        <td>${escapeHTML(cityName)}</td>
        <td>
          <div style="font-weight:500;">${escapeHTML(s.name)}</div>
          <div style="font-size:11px; color:var(--muted);">${escapeHTML(s.address || 'Без адреса')}</div>
        </td>
        <td><span class="badge badge--${statusClass}">${statusLabel}</span></td>
        <td>
          <button class="btn btn--sm edit-btn" data-id="${s.id}">Изменить</button>
          <button class="btn btn--sm btn--danger del-btn" data-id="${s.id}">Удалить</button>
        </td>
      `;
      
      tr.querySelector('.edit-btn').addEventListener('click', () => {
        const stop = allStops.find(x => x.id === s.id);
        if (stop) fillForm(stop);
      });
      
      tr.querySelector('.del-btn').addEventListener('click', () => {
        const stop = allStops.find(x => x.id === s.id);
        if (stop) deleteStop(stop);
      });
      
      fragment.appendChild(tr);
    });
    
    DOM.tableBody.appendChild(fragment);
  }

  function fillForm(stop) {
    editId = stop.id;
    DOM.citySelect.value = stop.settlement_id || '';
    DOM.codeInput.value = stop.stop_code || '';
    DOM.nameInput.value = stop.name || '';
    DOM.addrInput.value = stop.address || '';
    DOM.coordsInput.value = stop.latitude && stop.longitude ? `${stop.latitude}, ${stop.longitude}` : '';
    
    DOM.saveBtn.textContent = 'Сохранить изменения';
    DOM.resetBtn.style.display = 'block';
    DOM.formTitle.textContent = `Редактирование: ${stop.name}`;
    
    if (map && stop.latitude && stop.longitude) {
      map.setView([stop.latitude, stop.longitude], 16);
      placeMarker(stop.latitude, stop.longitude);
    }
    isFormDirty = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    editId = null;
    DOM.form.reset();
    DOM.coordsInput.value = '';
    DOM.saveBtn.textContent = 'Добавить остановку';
    DOM.resetBtn.style.display = 'none';
    DOM.formTitle.textContent = 'Новая остановка';
    
    if (addMarker && map) {
      map.removeLayer(addMarker);
      addMarker = null;
    }
    
    clearDraft();
    DOM.codeInput.focus();
  }

  async function submitForm(e) {
    if (e) e.preventDefault();
    if (isProcessing) return;
    
    const cityId = DOM.citySelect.value;
    const coordsStr = DOM.coordsInput.value;
    const name = DOM.nameInput.value.trim();
    const code = DOM.codeInput.value.trim();
    const address = DOM.addrInput.value.trim();

    if (!cityId) { showToast('Выберите населенный пункт', 'err'); playSound('error'); return; }
    if (!name) { showToast('Введите название остановки', 'err'); playSound('error'); DOM.nameInput.focus(); return; }
    if (!coordsStr) { showToast('Кликните по карте, чтобы указать координаты', 'err'); playSound('error'); return; }

    const parts = coordsStr.split(',');
    if (parts.length !== 2) { showToast('Неверный формат координат', 'err'); playSound('error'); return; }
    
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showToast('Координаты вне допустимого диапазона', 'err'); playSound('error'); return;
    }

    isProcessing = true;
    DOM.saveBtn.disabled = true;
    const originalText = DOM.saveBtn.textContent;
    DOM.saveBtn.innerHTML = 'Сохранение...';

    const payload = {
      name: name,
      address: address || null,
      latitude: lat,
      longitude: lng,
      settlement_id: cityId,
      status: 'active'
    };

    if (code) {
      if (!/^\d{1,6}$/.test(code)) {
        showToast('Код должен содержать только цифры (до 6 знаков)', 'err');
        playSound('error');
        isProcessing = false; DOM.saveBtn.disabled = false; DOM.saveBtn.textContent = originalText;
        return;
      }
      payload.stop_code = code.padStart(6, '0');
    }

    try {
      let error;
      if (editId) {
        const res = await window.sb.from('stops').update(payload).eq('id', editId);
        error = res.error;
      } else {
        const res = await window.sb.from('stops').insert(payload);
        error = res.error;
      }

      if (error) throw error;

      showToast(editId ? 'Остановка обновлена' : 'Остановка добавлена', 'ok');
      playSound('success');
      resetForm();
      await fetchData();
    } catch (err) {
      showToast('Ошибка сохранения: ' + err.message, 'err');
      playSound('error');
    } finally {
      isProcessing = false;
      DOM.saveBtn.disabled = false;
      DOM.saveBtn.textContent = editId ? 'Сохранить изменения' : 'Добавить остановку';
    }
  }

  async function deleteStop(stop) {
    if (settings.confirmDelete && !confirm(`Вы уверены, что хотите удалить остановку "${stop.name}"? Это действие необратимо.`)) return;
    
    if (isProcessing) return;
    isProcessing = true;

    try {
      const { data: links, error: linkError } = await window.sb
        .from('route_stops')
        .select('routes(code, name)')
        .eq('stop_id', stop.id);

      if (linkError) throw linkError;

      if (links && links.length > 0) {
        playSound('error');
        const routeNames = links.map(l => l.routes ? `${l.routes.code} (${l.routes.name})` : 'Неизвестный').join('\n');
        const confirmMsg = `Удаление невозможно!\n\nОстановка привязана к маршрутам:\n${routeNames}\n\nНажмите "ОК", чтобы деактивировать её (скрыть с карты, не ломая маршруты).`;
        
        if (confirm(confirmMsg)) {
          const { error } = await window.sb.from('stops').update({ status: 'closed' }).eq('id', stop.id);
          if (error) throw error;
          showToast('Остановка переведена в статус "Закрыта"', 'ok');
          playSound('success');
          await fetchData();
        }
        return;
      }

      const { error } = await window.sb.from('stops').delete().eq('id', stop.id);
      if (error) throw error;
      
      showToast('Остановка удалена', 'ok');
      playSound('success');
      await fetchData();
    } catch (err) {
      showToast('Ошибка при удалении: ' + err.message, 'err');
      playSound('error');
    } finally {
      isProcessing = false;
    }
  }

  function initMap() {
    if (map || !DOM.mapContainer) return;
    
    try {
      map = L.map('main-map', { zoomControl: true, attributionControl: true }).setView(settings.mapCenter, settings.mapZoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      
      map.on('click', (e) => {
        if (editId) {
          if (!confirm('Отменить редактирование и создать новую остановку?')) return;
          resetForm();
        }
        placeMarker(e.latlng.lat, e.latlng.lng);
        saveDraft();
      });

      setTimeout(() => { if (map) map.invalidateSize(); }, 300);
    } catch (e) {
      showToast('Ошибка инициализации карты', 'err');
    }
  }

  function placeMarker(lat, lng) {
    if (!map) return;
    if (addMarker) {
      addMarker.setLatLng([lat, lng]);
    } else {
      addMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
      addMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        DOM.coordsInput.value = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;
        saveDraft();
      });
    }
    DOM.coordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  function renderMarkers() {
    if (!map) return;
    
    map.eachLayer(layer => {
      if (layer instanceof L.Marker && layer !== addMarker) {
        map.removeLayer(layer);
      }
    });

    allStops.forEach(s => {
      if (s.status === 'closed' && !settings.showClosedOnMap) return;
      if (!s.latitude || !s.longitude) return;

      const cityName = s.settlements ? s.settlements.name : '—';
      const popup = document.createElement('div');
      popup.innerHTML = `
        <div style="font-family:sans-serif; min-width:200px;">
          <h4 style="margin:0 0 8px 0; font-size:14px; color:#000;">${escapeHTML(s.name)}</h4>
          <div style="font-size:12px; color:#555; margin-bottom:4px;"><b>Код:</b> ${escapeHTML(s.stop_code || '—')}</div>
          <div style="font-size:12px; color:#555; margin-bottom:4px;"><b>Город:</b> ${escapeHTML(cityName)}</div>
          <div style="font-size:12px; color:#555; margin-bottom:8px;"><b>Адрес:</b> ${escapeHTML(s.address || '—')}</div>
          <div style="display:flex; gap:6px;">
            <button class="btn-popup-edit" style="flex:1; padding:6px; cursor:pointer; background:#2563eb; color:#fff; border:none; border-radius:4px;">Изменить</button>
            <button class="btn-popup-del" style="flex:1; padding:6px; cursor:pointer; background:#dc2626; color:#fff; border:none; border-radius:4px;">Удалить</button>
          </div>
        </div>
      `;
      
      popup.querySelector('.btn-popup-edit').addEventListener('click', () => fillForm(s));
      popup.querySelector('.btn-popup-del').addEventListener('click', () => deleteStop(s));

      L.marker([s.latitude, s.longitude]).addTo(map).bindPopup(popup);
    });
  }

  function openCityModal() {
    if (window.UI && window.UI.createModal) {
      const m = window.UI.createModal({ title: 'Новый населенный пункт' });
      m.body.innerHTML = `
        <div class="field"><label>Название города *</label><input id="new-city-name" required /></div>
        <div class="modal__actions">
          <button class="btn" id="cancel-city">Отмена</button>
          <button class="btn btn--brand" id="save-city">Добавить</button>
        </div>
      `;
      m.body.querySelector('#cancel-city').onclick = m.close;
      m.body.querySelector('#save-city').onclick = async () => {
        const nameInput = m.body.querySelector('#new-city-name');
        const name = nameInput.value.trim();
        if (!name) return;
        
        const center = map ? map.getCenter() : { lat: 40.12, lng: 9.01 };
        const { data, error } = await window.sb.from('settlements').insert({ name, lat: center.lat, lng: center.lng }).select().single();
        if (error) return showToast(error.message, 'err');
        
        showToast('Город добавлен', 'ok');
        playSound('success');
        m.close();
        allCities.push(data);
        populateCities();
        DOM.citySelect.value = data.id;
      };
    } else {
      const name = prompt('Введите название нового города:');
      if (name) {
        window.sb.from('settlements').insert({ name: name.trim() }).then(({ data, error }) => {
          if (error) return showToast(error.message, 'err');
          showToast('Город добавлен', 'ok');
          fetchData();
        });
      }
    }
  }

  function openImportModal() {
    if (window.UI && window.UI.createModal) {
      const m = window.UI.createModal({ title: 'Массовое добавление (JSON)' });
      m.dialog.style.width = 'min(800px, 95vw)';
      m.body.innerHTML = `
        <div class="field">
          <label>Массив данных (JSON)</label>
          <textarea id="json-input" style="width:100%; height:300px; font-family:monospace; font-size:12px; background:var(--bg); color:var(--text); border:1px solid var(--border); padding:10px; border-radius:8px; resize:vertical;"></textarea>
        </div>
        <div class="modal__actions">
          <button class="btn" id="cancel-import">Отмена</button>
          <button class="btn btn--brand" id="run-import">Запустить импорт</button>
        </div>
      `;
      m.body.querySelector('#cancel-import').onclick = m.close;
      m.body.querySelector('#run-import').onclick = async () => {
        const text = m.body.querySelector('#json-input').value;
        let arr;
        try {
          arr = JSON.parse(text);
          if (!Array.isArray(arr)) throw new Error('Ожидается массив');
        } catch (e) {
          return showToast('Ошибка JSON: ' + e.message, 'err');
        }

        const valid = arr.map(x => {
          let sId = x.settlement_id;
          if (!sId && x.city_name) {
            const found = allCities.find(c => c.name.toLowerCase() === x.city_name.toLowerCase());
            if (found) sId = found.id;
          }
          return {
            stop_code: x.code ? String(x.code).padStart(6, '0') : null,
            name: x.name,
            address: x.address || null,
            latitude: Number(x.latitude),
            longitude: Number(x.longitude),
            settlement_id: sId,
            status: 'active'
          };
        }).filter(x => x.name && x.latitude && x.longitude);

        if (valid.length === 0) return showToast('Нет валидных данных', 'err');

        const { error } = await window.sb.from('stops').insert(valid);
        if (error) return showToast(error.message, 'err');

        showToast(`Импортировано: ${valid.length}`, 'ok');
        playSound('success');
        m.close();
        fetchData();
      };
    }
  }

  function buildSettings() {
    const btn = document.createElement('button');
    btn.className = 'settings-btn';
    btn.textContent = 'Настройки';
    btn.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:998; padding:10px 16px; background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:6px; cursor:pointer; font-weight:bold;';
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.innerHTML = `
      <button class="settings-close" id="close-settings" style="position:absolute; top:15px; right:15px; background:none; border:none; color:var(--muted); font-size:24px; cursor:pointer;">&times;</button>
      <h2 style="margin-top:0; font-size:18px;">Настройки раздела</h2>
      
      <div class="settings-group" style="margin-bottom:24px; border-bottom:1px solid var(--border); padding-bottom:16px;">
        <h3 style="font-size:14px; color:var(--muted); margin-bottom:12px;">Интерфейс</h3>
        <label style="display:block; margin-bottom:8px;"><input type="checkbox" id="set-sound" ${settings.sound ? 'checked':''}/> Звуковой отклик</label>
        <label style="display:block; margin-bottom:8px;"><input type="checkbox" id="set-autosave" ${settings.autoSaveDraft ? 'checked':''}/> Автосохранение черновика</label>
        <label style="display:block; margin-bottom:8px;"><input type="checkbox" id="set-closed-map" ${settings.showClosedOnMap ? 'checked':''}/> Показывать закрытые на карте</label>
        <button class="btn" id="set-mirror" style="width:100%; margin-bottom:8px;">Зеркалировать панели</button>
        <label style="font-size:13px; color:var(--muted);">Пропорция формы (${settings.ratio}%)</label>
        <input type="range" id="set-ratio" min="30" max="70" value="${settings.ratio}" style="width:100%;" />
      </div>

      <div class="settings-group" style="margin-bottom:24px; border-bottom:1px solid var(--border); padding-bottom:16px;">
        <h3 style="font-size:14px; color:var(--muted); margin-bottom:12px;">Карта</h3>
        <button class="btn btn--brand" id="set-center" style="width:100%;">Зафиксировать текущий вид</button>
      </div>

      <div class="settings-group" style="margin-bottom:24px; border-bottom:1px solid var(--border); padding-bottom:16px;">
        <h3 style="font-size:14px; color:var(--muted); margin-bottom:12px;">Данные</h3>
        <button class="btn" id="btn-import" style="width:100%; margin-bottom:8px;">Импорт JSON</button>
        <button class="btn" id="btn-export" style="width:100%;">Экспорт CSV</button>
      </div>

      <div class="settings-group">
        <h3 style="font-size:14px; color:var(--muted); margin-bottom:12px;">Опасная зона</h3>
        <button class="btn btn--danger" id="set-reset" style="width:100%;">Сбросить настройки</button>
      </div>
    `;
    document.body.appendChild(panel);

    const close = () => { panel.classList.remove('open'); overlay.classList.remove('open'); };
    btn.onclick = () => { panel.classList.add('open'); overlay.classList.add('open'); };
    overlay.onclick = close;
    panel.querySelector('#close-settings').onclick = close;

    panel.querySelector('#set-sound').onchange = e => { settings.sound = e.target.checked; saveSettings(); };
    panel.querySelector('#set-autosave').onchange = e => { settings.autoSaveDraft = e.target.checked; saveSettings(); if(!settings.autoSaveDraft) clearDraft(); };
    panel.querySelector('#set-closed-map').onchange = e => { settings.showClosedOnMap = e.target.checked; saveSettings(); renderMarkers(); };
    
    panel.querySelector('#set-mirror').onclick = () => { settings.isMirrored = !settings.isMirrored; applySettings(); };
    
    panel.querySelector('#set-ratio').onchange = e => { 
      settings.ratio = parseInt(e.target.value); 
      applySettings(); 
      panel.querySelector('label[for="set-ratio"]').textContent = `Пропорция формы (${settings.ratio}%)`;
    };
    
    panel.querySelector('#set-center').onclick = () => {
      if (map) {
        settings.mapCenter = [map.getCenter().lat, map.getCenter().lng];
        settings.mapZoom = map.getZoom();
        saveSettings();
        showToast('Вид карты зафиксирован', 'ok');
      }
    };
    
    panel.querySelector('#btn-import').onclick = () => { close(); openImportModal(); };
    
    panel.querySelector('#btn-export').onclick = () => {
      let csv = '\uFEFFКод;Город;Название;Адрес;Широта;Долгота;Статус\n';
      getFilteredStops().forEach(s => {
        const city = s.settlements ? s.settlements.name : '';
        csv += `${s.stop_code};${city};"${s.name}";"${s.address||''}";${s.latitude};${s.longitude};${s.status}\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'stops_export.csv';
      link.click();
    };

    panel.querySelector('#set-reset').onclick = () => {
      if (confirm('Сбросить все настройки раздела к заводским?')) {
        localStorage.removeItem('stops_global_settings');
        localStorage.removeItem('stops_form_draft');
        location.reload();
      }
    };
  }

  function setupEvents() {
    if (!DOM.form) return;
    
    DOM.form.addEventListener('submit', submitForm);
    
    DOM.form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitForm();
      }
      if (e.key === 'Escape') {
        if (isFormDirty && !confirm('Отменить заполнение формы?')) return;
        resetForm();
      }
    });

    ['input', 'change'].forEach(evt => {
      DOM.form.addEventListener(evt, () => { isFormDirty = true; saveDraft(); });
    });

    DOM.citySelect.addEventListener('change', () => {
      if (editId) return;
      const c = allCities.find(x => x.id === DOM.citySelect.value);
      if (c && c.lat && c.lng && map) {
        map.setView([c.lat, c.lng], 12);
      }
    });

    DOM.codeInput.addEventListener('blur', () => {
      let val = DOM.codeInput.value.replace(/\D/g, '');
      if (val) DOM.codeInput.value = val.padStart(6, '0');
    });

    DOM.codeInput.addEventListener('input', () => {
      DOM.codeInput.value = DOM.codeInput.value.replace(/\D/g, '').slice(0, 6);
    });

    DOM.resetBtn.addEventListener('click', () => {
      if (isFormDirty && !confirm('Отменить заполнение формы?')) return;
      resetForm();
    });

    DOM.newCityBtn.addEventListener('click', openCityModal);

    DOM.searchInput.addEventListener('input', window.UI && window.UI.debounce ? window.UI.debounce(() => {
      currentFilters.query = DOM.searchInput.value;
      renderTable();
    }, 300) : () => {
      currentFilters.query = DOM.searchInput.value;
      renderTable();
    });

    DOM.filterCity.addEventListener('change', () => {
      currentFilters.city = DOM.filterCity.value;
      renderTable();
    });

    DOM.filterStatus.addEventListener('change', () => {
      currentFilters.status = DOM.filterStatus.value;
      renderTable();
    });

    window.addEventListener('beforeunload', (e) => {
      if (isFormDirty && !editId) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function injectHTML() {
    if (!window.UI || !window.UI.renderShell) {
      document.body.innerHTML = '<h1 style="color:red; padding:20px;">Ошибка: UI модуль не загружен</h1>';
      return null;
    }

    let profile;
    try {
      profile = window.currentProfile || { role: 'admin', full_name: 'Администратор' };
    } catch (e) {
      profile = { role: 'admin', full_name: 'Администратор' };
    }

    const content = window.UI.renderShell({ title: 'Остановки', profile: profile, active: 'stops.html' });
    content.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      .workspace-grid { display: grid; grid-template-columns: 45% 1fr; gap: 16px; height: calc(100vh - 160px); min-height: 600px; transition: grid-template-columns 0.2s ease; }
      .left-panel { display: flex; flex-direction: column; gap: 16px; height: 100%; overflow: hidden; }
      .add-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .add-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .add-form .full-width { grid-column: span 2; }
      .add-form .field { margin: 0; display: flex; flex-direction: column; gap: 4px; }
      .add-form label { font-size: 12px; color: var(--muted); font-weight: 600; }
      .add-form input, .add-form select { padding: 8px; font-size: 13px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; transition: border-color 0.2s; }
      .add-form input:focus, .add-form select:focus { outline: none; border-color: var(--brand); }
      .add-form input[readonly] { background: rgba(255,255,255,0.05); color: var(--muted); cursor: not-allowed; }
      .list-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); flex: 1; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .list-header { padding: 12px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; background: rgba(0,0,0,0.1); }
      .list-header select, .list-header input { padding: 6px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
      .list-scroll { flex: 1; overflow-y: auto; }
      .list-scroll table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .list-scroll th { position: sticky; top: 0; background: var(--panel); z-index: 10; padding: 10px 8px; text-align: left; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
      .list-scroll td { padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
      .list-scroll tr:hover td { background: rgba(37,99,235,0.05); }
      .map-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      #main-map { width: 100%; height: 100%; z-index: 1; }
      .settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 2000; display: none; backdrop-filter: blur(2px); }
      .settings-overlay.open { display: block; }
      .settings-panel { position: fixed; top: 0; right: -350px; width: 350px; height: 100vh; background: var(--panel); border-left: 1px solid var(--border); z-index: 2001; transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1); padding: 20px; box-shadow: -5px 0 20px rgba(0,0,0,0.3); overflow-y: auto; }
      .settings-panel.open { right: 0; }
    `;
    document.head.appendChild(style);

    const grid = document.createElement('div');
    grid.className = 'workspace-grid';

    grid.innerHTML = `
      <div class="left-panel">
        <div class="add-card">
          <h3 id="form-title" style="margin: 0 0 12px 0; font-size: 15px; color: var(--text);">Новая остановка</h3>
          <form id="add-form" class="add-form">
            <div class="field full-width">
              <label>Населенный пункт *</label>
              <div style="display:flex; gap:6px;">
                <select name="city" id="f-city" style="flex:1;" required></select>
                <button type="button" class="btn" id="btn-new-city" style="padding:0 10px;" title="Создать город">+</button>
              </div>
            </div>
            <div class="field">
              <label>Код (6 цифр)</label>
              <input name="code" id="f-code" maxlength="6" placeholder="000001" style="font-family:monospace;" />
            </div>
            <div class="field">
              <label>Название *</label>
              <input name="name" id="f-name" required placeholder="Улица, микрорайон" />
            </div>
            <div class="field full-width">
              <label>Адрес / Ориентир</label>
              <input name="addr" id="f-addr" placeholder="Например: ул. Ленина, д. 5" />
            </div>
            <div class="field full-width">
              <label>Координаты *</label>
              <input name="coords" id="f-coords" readonly placeholder="Кликните по карте" />
            </div>
            <div class="full-width" style="margin-top:8px; display:flex; gap:8px;">
              <button type="submit" class="btn btn--brand" id="btn-save" style="flex:1;">Добавить остановку</button>
              <button type="button" class="btn" id="btn-reset" style="display:none; color:var(--err);">Отмена</button>
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
            <input id="search-input" placeholder="Поиск..." style="width:100%;" />
          </div>
          <div class="list-scroll">
            <table>
              <thead><tr><th>Код</th><th>Город</th><th>Название / Адрес</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody id="tbody-list"></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="map-card">
        <div id="main-map"></div>
      </div>
    `;
    
    content.appendChild(grid);
    return true;
  }

  async function main() {
    try {
      if (window.Auth && window.Auth.requireStaff) {
        await window.Auth.requireStaff();
      }
    } catch (e) {
      return;
    }

    loadSettings();

    if (!injectHTML()) return;

    initDOM();
    applySettings();
    setupEvents();
    buildSettings();

    setTimeout(() => {
      initMap();
      loadDraft();
    }, 200);

    await fetchData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
