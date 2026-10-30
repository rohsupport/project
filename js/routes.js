(function () {
  'use strict';

  // --- Глобальное состояние ---
  let currentStep = 1;
  let map = null;
  let routeLine = null;
  let stopMarkers = [];
  let allStopsDb = []; // Справочник всех остановок города
  
  // Данные маршрута
  let routeData = {
    code: '',
    name: '',
    isTransit: false,
    forwardStops: [],
    backwardStops: [],
    schedule: {
      startTime: '06:00',
      endTime: '22:00',
      interval: 15,
      days: [1, 2, 3, 4, 5, 6, 7] // Пн-Вс
    },
    fare: {
      type: 'flat',
      basePrice: 50,
      stopPrices: []
    }
  };

  let currentDirection = 'forward'; // 'forward' | 'backward'

  // ==========================================
  // ИНИЦИАЛИЗАЦИЯ
  // ==========================================
  async function init() {
    console.log('🚀 Мастер запущен');
    
    // Загружаем все остановки для поиска
    const { data, error } = await window.sb.from('stops').select('*');
    if (error) {
      UI.toast('Ошибка загрузки остановок: ' + error.message, 'err');
    } else {
      allStopsDb = data || [];
      console.log(`Загружено ${allStopsDb.length} остановок`);
    }

    setupNavigation();
    setupStep1();
    setupStep2();
    setupStep3();
    setupStep4();

    goToStep(1);
  }

  // ==========================================
  // НАВИГАЦИЯ
  // ==========================================
  function setupNavigation() {
    document.getElementById('btn-next').addEventListener('click', () => {
      console.log(`Клик: Далее с шага ${currentStep}`);
      if (validateStep(currentStep)) {
        goToStep(currentStep + 1);
      }
    });

    document.getElementById('btn-prev').addEventListener('click', () => {
      console.log(`Клик: Назад с шага ${currentStep}`);
      goToStep(currentStep - 1);
    });

    document.getElementById('btn-save').addEventListener('click', saveAllData);
  }

  function goToStep(step) {
    // Скрываем все шаги
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    document.getElementById('step-' + step).classList.add('active');

    // Обновляем индикаторы
    document.querySelectorAll('.step-dot').forEach((el, idx) => {
      const s = idx + 1;
      el.classList.remove('active', 'done');
      if (s < step) el.classList.add('done');
      if (s === step) el.classList.add('active');
    });

    // Управление кнопками
    document.getElementById('btn-prev').style.display = step > 1 ? 'block' : 'none';
    document.getElementById('btn-next').style.display = step < 4 ? 'block' : 'none';
    document.getElementById('btn-save').style.display = step === 4 ? 'block' : 'none';

    currentStep = step;

    // Триггеры для шагов
    if (step === 2) {
      setTimeout(initMap, 100); // Ждем отрисовки DOM
      renderStopsList();
    }
    if (step === 3) {
      renderScheduleStops();
    }
    if (step === 4) {
      renderFareStep();
    }
  }

  // ==========================================
  // ШАГ 1: ОСНОВНОЕ
  // ==========================================
  function setupStep1() {
    document.getElementById('f-code').addEventListener('input', e => routeData.code = e.target.value.trim());
    document.getElementById('f-name').addEventListener('input', e => routeData.name = e.target.value.trim());
    document.getElementById('f-transit').addEventListener('change', e => routeData.isTransit = e.target.checked);
  }

  // ==========================================
  // ШАГ 2: ОСТАНОВКИ И КАРТА
  // ==========================================
  function setupStep2() {
    // Переключение вкладок Туда/Обратно
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDirection = btn.dataset.dir;
        renderStopsList();
      });
    });

    // Добавление остановки
    document.getElementById('btn-add-stop').addEventListener('click', () => {
      const select = document.getElementById('select-stop');
      const stopId = select.value;
      if (!stopId) return;
      
      const stopObj = allStopsDb.find(s => s.id === stopId);
      if (!stopObj) return;

      const arr = currentDirection === 'forward' ? routeData.forwardStops : routeData.backwardStops;
      
      // Проверка на дубликат в этом направлении
      if (arr.find(s => s.id === stopId)) {
        return UI.toast('Эта остановка уже добавлена', 'warn');
      }

      arr.push({ ...stopObj, travel_time_from_prev: 5 }); // По умолчанию 5 минут в пути
      select.value = ''; // Сброс
      
      renderStopsList();
      drawMapRoute();
      console.log(`Добавлена остановка: ${stopObj.name} (${currentDirection})`);
    });

    // Заполнение селекта
    const select = document.getElementById('select-stop');
    allStopsDb.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`;
      select.appendChild(opt);
    });
  }

  function initMap() {
    if (map) return; // Уже есть
    console.log('🗺️ Инициализация карты Leaflet');

    map = L.map('map-container').setView([40.1209, 9.0129], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (map) map.invalidateSize(); }).observe(document.getElementById('map-container'));
    }
    setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    drawMapRoute();
  }

  function drawMapRoute() {
    if (!map) return;

    // Очищаем старые маркеры и линию
    stopMarkers.forEach(m => map.removeLayer(m));
    stopMarkers = [];
    if (routeLine) map.removeLayer(routeLine);

    const stops = currentDirection === 'forward' ? routeData.forwardStops : routeData.backwardStops;
    if (stops.length === 0) return;

    const latlngs = [];
    stops.forEach((s, idx) => {
      const ll = [s.latitude, s.longitude];
      latlngs.push(ll);

      const marker = L.marker(ll).addTo(map);
      marker.bindPopup(`<b>${idx + 1}. ${s.name}</b>`);
      stopMarkers.push(marker);
    });

    if (latlngs.length > 1) {
      routeLine = L.polyline(latlngs, { color: currentDirection === 'forward' ? '#2563eb' : '#f59e0b', weight: 5 }).addTo(map);
      map.fitBounds(latlngs, { padding: [40, 40] });
    } else if (latlngs.length === 1) {
      map.setView(latlngs[0], 15);
    }
  }

  function renderStopsList() {
    const container = document.getElementById('stops-list-container');
    container.innerHTML = '';
    const stops = currentDirection === 'forward' ? routeData.forwardStops : routeData.backwardStops;

    if (stops.length === 0) {
      container.innerHTML = '<div style="text-align:center; color:var(--muted); padding:20px;">Нет остановок</div>';
      return;
    }

    stops.forEach((s, idx) => {
      const div = document.createElement('div');
      div.className = 'stop-item-drag';
      div.draggable = true;
      div.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="drag-handle">☰</span>
          <span><b>${idx + 1}.</b> ${s.name}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" class="travel-time" value="${s.travel_time_from_prev}" title="Время в пути от предыдущей (мин)" data-idx="${idx}" />
          <button class="btn btn--sm btn--danger btn-remove" data-idx="${idx}">×</button>
        </div>
      `;

      // Удаление
      div.querySelector('.btn-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        stops.splice(idx, 1);
        renderStopsList();
        drawMapRoute();
      });

      // Изменение времени в пути
      div.querySelector('.travel-time').addEventListener('change', (e) => {
        const newVal = parseInt(e.target.value) || 0;
        stops[idx].travel_time_from_prev = newVal;
        console.log(`Время в пути для ${s.name} изменено на ${newVal}`);
      });

      // Drag & Drop
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        div.classList.add('dragging');
      });

      div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
      });

      div.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      div.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        if (fromIdx === idx) return;

        const moved = stops.splice(fromIdx, 1)[0];
        stops.splice(idx, 0, moved);

        renderStopsList();
        drawMapRoute();
        console.log(`Остановка перемещена: ${fromIdx} -> ${idx}`);
      });

      container.appendChild(div);
    });
  }

  // ==========================================
  // ШАГ 3: РАСПИСАНИЕ
  // ==========================================
  function setupStep3() {
    document.getElementById('s-start').addEventListener('change', e => routeData.schedule.startTime = e.target.value);
    document.getElementById('s-end').addEventListener('change', e => routeData.schedule.endTime = e.target.value);
    document.getElementById('s-interval').addEventListener('input', e => routeData.schedule.interval = parseInt(e.target.value) || 15);

    // Чекбоксы дней
    document.querySelectorAll('.day-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        routeData.schedule.days = Array.from(document.querySelectorAll('.day-checkbox:checked')).map(c => parseInt(c.value));
      });
    });
  }

  function renderScheduleStops() {
    const container = document.getElementById('schedule-stops-container');
    container.innerHTML = '';
    
    // Берем маршрут "Туда" для отображения
    const stops = routeData.forwardStops;
    if (stops.length === 0) {
      container.innerHTML = '<div style="color:var(--err)">Сначала добавьте остановки на шаге 2!</div>';
      return;
    }

    stops.forEach((s, idx) => {
      const div = document.createElement('div');
      div.className = 'stop-item-drag';
      div.style.cursor = 'default';
      div.innerHTML = `
        <span><b>${idx + 1}.</b> ${s.name}</span>
        <span style="color:var(--muted); font-size:12px;">
          ${idx === 0 ? 'Начальная' : `+${s.travel_time_from_prev} мин от пред.`}
        </span>
      `;
      container.appendChild(div);
    });
  }

  // ==========================================
  // ШАГ 4: ЦЕНЫ
  // ==========================================
  function setupStep4() {
    document.querySelectorAll('input[name="fare-type"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        routeData.fare.type = e.target.value;
        renderFareStep();
      });
    });

    document.getElementById('f-base-price').addEventListener('input', e => routeData.fare.basePrice = parseFloat(e.target.value) || 0);
  }

  function renderFareStep() {
    const flatBox = document.getElementById('fare-flat-box');
    const stopBox = document.getElementById('fare-stop-box');
    const tableBody = document.getElementById('fare-table-body');

    if (routeData.fare.type === 'flat') {
      flatBox.style.display = 'block';
      stopBox.style.display = 'none';
    } else {
      flatBox.style.display = 'none';
      stopBox.style.display = 'block';

      tableBody.innerHTML = '';
      const stops = routeData.forwardStops;
      
      // Генерируем матрицу "Откуда - Куда" (упрощенно: все со всеми)
      stops.forEach((fromStop, i) => {
        stops.forEach((toStop, j) => {
          if (i >= j) return; // Только вперед

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${fromStop.name}</td>
            <td>${toStop.name}</td>
            <td><input type="number" class="fare-input" data-from="${fromStop.id}" data-to="${toStop.id}" value="50" /></td>
          `;
          tableBody.appendChild(tr);
        });
      });

      // Сохраняем цены при изменении
      document.querySelectorAll('.fare-input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const from = e.target.dataset.from;
          const to = e.target.dataset.to;
          const price = parseFloat(e.target.value) || 0;
          
          // Обновляем массив
          const existing = routeData.fare.stopPrices.find(p => p.from === from && p.to === to);
          if (existing) existing.price = price;
          else routeData.fare.stopPrices.push({ from, to, price });
        });
      });
    }
  }

  // ==========================================
  // ВАЛИДАЦИЯ
  // ==========================================
  function validateStep(step) {
    if (step === 1) {
      if (!routeData.code || !routeData.name) {
        UI.toast('Заполните код и название маршрута', 'err');
        return false;
      }
    }
    if (step === 2) {
      if (routeData.forwardStops.length < 2) {
        UI.toast('Добавьте минимум 2 остановки в направление "Туда"', 'err');
        return false;
      }
      if (routeData.backwardStops.length > 0 && routeData.backwardStops.length < 2) {
        UI.toast('В направлении "Обратно" должно быть минимум 2 остановки (или 0)', 'err');
        return false;
      }
    }
    if (step === 3) {
      if (routeData.schedule.days.length === 0) {
        UI.toast('Выберите хотя бы один день недели', 'err');
        return false;
      }
    }
    return true;
  }

  // ==========================================
  // СОХРАНЕНИЕ В БД И ГЕНЕРАЦИЯ РЕЙСОВ
  // ==========================================
  async function saveAllData() {
    console.log('💾 Начинаем сохранение...');
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    btn.textContent = 'Сохранение...';

    try {
      // 1. Сохраняем маршрут
      const { data: routeDataDb, error: routeErr } = await window.sb.from('routes').insert({
        code: routeData.code,
        name: routeData.name,
        is_transit: routeData.isTransit
      }).select().single();

      if (routeErr) throw routeErr;
      const routeId = routeDataDb.id;
      console.log('✅ Маршрут создан ID:', routeId);

      // 2. Сохраняем остановки
      const stopsInserts = [];
      routeData.forwardStops.forEach((s, idx) => {
        stopsInserts.push({ route_id: routeId, stop_id: s.id, direction: 'forward', order_index: idx + 1, travel_time_from_prev: s.travel_time_from_prev || 0 });
      });
      routeData.backwardStops.forEach((s, idx) => {
        stopsInserts.push({ route_id: routeId, stop_id: s.id, direction: 'backward', order_index: idx + 1, travel_time_from_prev: s.travel_time_from_prev || 0 });
      });

      if (stopsInserts.length > 0) {
        const { error: stopsErr } = await window.sb.from('route_stops').insert(stopsInserts);
        if (stopsErr) throw stopsErr;
        console.log('✅ Остановки сохранены:', stopsInserts.length);
      }

      // 3. Сохраняем расписание
      const { error: schedErr } = await window.sb.from('schedules').insert({
        route_id: routeId,
        start_time: routeData.schedule.startTime,
        end_time: routeData.schedule.endTime,
        interval_minutes: routeData.schedule.interval,
        days_of_week: routeData.schedule.days
      });
      if (schedErr) throw schedErr;
      console.log('✅ Расписание сохранено');

      // 4. Генерируем рейсы (Trips)
      await generateTrips(routeId);

      // 5. Сохраняем тарифы
      if (routeData.fare.type === 'flat') {
        await window.sb.from('fares').insert({
          route_id: routeId,
          fare_type: 'flat',
          base_price: routeData.fare.basePrice
        });
      } else {
        for (const p of routeData.fare.stopPrices) {
          await window.sb.from('fares').insert({
            route_id: routeId,
            fare_type: 'stop_based',
            from_stop_id: p.from,
            to_stop_id: p.to,
            price: p.price
          });
        }
      }
      console.log('✅ Тарифы сохранены');

      UI.toast('Маршрут успешно сохранен!', 'ok');
      setTimeout(() => { location.href = 'routes.html'; }, 1000);

    } catch (err) {
      console.error('❌ Ошибка сохранения:', err);
      UI.toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Сохранить маршрут';
    }
  }

  async function generateTrips(routeId) {
    const { startTime, endTime, interval, days } = routeData.schedule;
    
    // Парсим время
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);

    let currentMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;

    const tripsToInsert = [];

    // Генерируем времена рейсов для каждого дня
    days.forEach(day => {
      currentMins = startH * 60 + startM;
      while (currentMins <= endMins) {
        const h = String(Math.floor(currentMins / 60)).padStart(2, '0');
        const m = String(currentMins % 60).padStart(2, '0');
        const timeStr = `${h}:${m}:00`;

        tripsToInsert.push({
          route_id: routeId,
          departure_time: timeStr,
          day_of_week: day
        });

        currentMins += interval;
      }
    });

    if (tripsToInsert.length > 0) {
      const { error } = await window.sb.from('trips').insert(tripsToInsert);
      if (error) throw error;
      console.log(`✅ Сгенерировано ${tripsToInsert.length} рейсов в БД`);
    }
  }

  // --- Старт ---
  document.addEventListener('DOMContentLoaded', init);
})();
