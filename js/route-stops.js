// ============================================================
// Привязка остановок к маршруту: список + порядок + swap + drag&drop
// ============================================================
(function () {
  let routesList = [];
  let stopsList = [];
  let routeSelect, directionSelect, tbody, emptyEl, addBtn, counter;
  let currentItems = []; // route_stops + stops join
  let channel = null;
  let dragSrcIndex = null;

  // загрузка всех маршрутов и остановок
  async function bootstrapLists() {
    const [r, s] = await Promise.all([
      window.sb.from('routes').select('id,code,name,is_active').eq('is_active', true).order('code'),
      window.sb.from('stops').select('id,name,address,is_active').order('name')
    ]);
    if (r.error) { UI.toast(r.error.message, 'err'); return false; }
    if (s.error) { UI.toast(s.error.message, 'err'); return false; }
    routesList = r.data || [];
    stopsList = s.data || [];

    routeSelect.innerHTML = '<option value="">— выберите маршрут —</option>';
    routesList.forEach(x => {
      const o = document.createElement('option');
      o.value = x.id;
      o.textContent = `${x.code} — ${x.name}`;
      routeSelect.appendChild(o);
    });
    return true;
  }

  // загрузка привязанных остановок
  async function load() {
    const routeId = routeSelect.value;
    const direction = directionSelect.value;
    if (!routeId) {
      currentItems = [];
      render();
      return;
    }
    const { data, error } = await window.sb
      .from('route_stops')
      .select(`
        id, order_index, direction, route_id, stop_id,
        stops:stop_id (id, name, address, is_active)
      `)
      .eq('route_id', routeId)
      .eq('direction', direction)
      .order('order_index', { ascending: true });
    if (error) { UI.toast(error.message, 'err'); return; }
    currentItems = data || [];
    render();
  }

  // рендер таблицы
  function render() {
    tbody.innerHTML = '';
    if (!routeSelect.value) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Выберите маршрут и направление';
      counter.textContent = '';
      addBtn.disabled = true;
      return;
    }
    addBtn.disabled = false;
    if (currentItems.length === 0) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Пока нет остановок, добавьте первую';
      counter.textContent = '';
      return;
    }
    emptyEl.style.display = 'none';
    counter.textContent = `Всего: ${currentItems.length}`;
    currentItems.forEach((it, idx) => {
      tbody.appendChild(row(it, idx));
    });
  }

  // строка
  function row(it, idx) {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.index = idx;

    // drag&drop
    tr.addEventListener('dragstart', (e) => {
      dragSrcIndex = idx;
      tr.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });
    tr.addEventListener('dragend', () => {
      tr.style.opacity = '';
      dragSrcIndex = null;
    });
    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tr.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === idx) return;
      await moveItem(dragSrcIndex, idx);
    });

    const tdNum = document.createElement('td');
    tdNum.textContent = it.order_index;

    const tdName = document.createElement('td');
    tdName.textContent = (it.stops && it.stops.name) || '—';

    const tdAddr = document.createElement('td');
    tdAddr.textContent = (it.stops && it.stops.address) || '—';

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';

    const upBtn = document.createElement('button');
    upBtn.className = 'btn btn--sm';
    upBtn.textContent = '↑';
    upBtn.title = 'Вверх';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => moveItem(idx, idx - 1));

    const downBtn = document.createElement('button');
    downBtn.className = 'btn btn--sm';
    downBtn.textContent = '↓';
    downBtn.title = 'Вниз';
    downBtn.disabled = idx === currentItems.length - 1;
    downBtn.addEventListener('click', () => moveItem(idx, idx + 1));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteItem(it));

    tdAct.appendChild(upBtn);
    tdAct.appendChild(downBtn);
    tdAct.appendChild(delBtn);

    tr.appendChild(tdNum);
    tr.appendChild(tdName);
    tr.appendChild(tdAddr);
    tr.appendChild(tdAct);
    return tr;
  }

  // поменять элементы местами (idxA <-> idxB) через upsert
  async function moveItem(from, to) {
    if (to < 0 || to >= currentItems.length) return;
    // переставляем в массиве
    const arr = currentItems.slice();
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    // пересчитываем order_index
    const updates = arr.map((item, i) => ({
      id: item.id,
      route_id: item.route_id,
      stop_id: item.stop_id,
      direction: item.direction,
      order_index: i + 1
    }));
    // upsert (он обновит записи по id)
    const { error } = await window.sb
      .from('route_stops')
      .upsert(updates, { onConflict: 'id' });
    if (error) {
      UI.toast(error.message, 'err');
      return;
    }
    // обновим локальный массив и перерисуем
    currentItems = arr.map((it, i) => ({ ...it, order_index: i + 1 }));
    render();
  }

  async function deleteItem(it) {
    if (!confirm(`Удалить остановку "${(it.stops && it.stops.name) || ''}" из маршрута?`)) return;
    try {
      const { error } = await window.sb.from('route_stops').delete().eq('id', it.id);
      if (error) throw error;
      UI.toast('Остановка удалена из маршрута', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    }
  }

  // модалка добавления остановки
  function openAddModal() {
    const routeId = routeSelect.value;
    const direction = directionSelect.value;
    if (!routeId) { UI.toast('Выберите маршрут', 'err'); return; }

    const usedStopIds = new Set(currentItems.map(x => x.stop_id));
    const available = stopsList.filter(s => !usedStopIds.has(s.id));
    if (available.length === 0) {
      UI.toast('Все остановки уже привязаны', 'warn');
      return;
    }

    const nextIdx = currentItems.length + 1;

    const m = UI.createModal({ title: 'Добавить остановку в маршрут' });
    const form = document.createElement('form');
    form.className = 'form';

    const opts = available.map(s =>
      `<option value="${s.id}">${escapeHtml(s.name)}${s.address ? ' — ' + escapeHtml(s.address) : ''}</option>`
    ).join('');

    form.innerHTML = `
      <div class="field">
        <label>Остановка *</label>
        <select name="stop_id" required>${opts}</select>
      </div>
      <div class="field">
        <label>Позиция (order_index)</label>
        <input name="order_index" type="number" min="1" value="${nextIdx}" required />
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand" id="save-btn">Сохранить</button>
      </div>`;
    m.body.appendChild(form);
    form.querySelector('#cancel-btn').addEventListener('click', m.close);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const stop_id = fd.get('stop_id');
      const order_index = parseInt(fd.get('order_index'), 10);
      if (!stop_id || !Number.isFinite(order_index) || order_index < 1) {
        UI.toast('Заполните поля корректно', 'err');
        return;
      }
      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        // если позиция занята — сдвигаем
        const existing = currentItems.find(x => x.order_index === order_index);
        if (existing) {
          // сначала вставим с временным большим order_index, потом пересчёт
          const tmp = 100000;
          await window.sb.from('route_stops')
            .update({ order_index: tmp })
            .eq('id', existing.id);
          const { error } = await window.sb.from('route_stops').insert({
            route_id: routeId, stop_id, direction, order_index
          });
          if (error) throw error;
          await window.sb.from('route_stops')
            .update({ order_index: order_index + 1 })
            .eq('id', existing.id);
        } else {
          const { error } = await window.sb.from('route_stops').insert({
            route_id: routeId, stop_id, direction, order_index
          });
          if (error) throw error;
        }
        UI.toast('Остановка добавлена', 'ok');
        m.close();
        await load();
      } catch (err) {
        UI.toast(err.message || 'Ошибка', 'err');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
      }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // realtime
  function setupRealtime() {
    channel = window.sb.channel('route-stops-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops' }, () => {
        load();
      })
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Остановки маршрута',
      profile,
      active: 'route-stops.html'
    });

    // toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Маршрут</label>`;
    routeSelect = document.createElement('select');
    f1.appendChild(routeSelect);

    const f2 = document.createElement('div');
    f2.className = 'field';
    f2.innerHTML = `<label>Направление</label>`;
    directionSelect = document.createElement('select');
    directionSelect.innerHTML = `
      <option value="forward">Прямое</option>
      <option value="backward">Обратное</option>`;
    f2.appendChild(directionSelect);

    addBtn = document.createElement('button');
    addBtn.className = 'btn btn--brand';
    addBtn.textContent = '➕ Добавить остановку';
    addBtn.disabled = true;
    addBtn.addEventListener('click', openAddModal);

    counter = document.createElement('span');
    counter.className = 'muted';

    toolbar.appendChild(f1);
    toolbar.appendChild(f2);
    toolbar.appendChild(addBtn);
    toolbar.appendChild(counter);
    content.appendChild(toolbar);

    // таблица
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>№</th><th>Остановка</th><th>Адрес</th><th>Действия</th></tr>
        </thead>
        <tbody id="rs-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.textContent = 'Выберите маршрут и направление';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#rs-tbody');

    routeSelect.addEventListener('change', load);
    directionSelect.addEventListener('change', load);

    const ok = await bootstrapLists();
    if (ok) {
      // авто-выбор первого маршрута
      if (routesList.length > 0) {
        routeSelect.value = routesList[0].id;
        await load();
      }
      setupRealtime();
    }
  }

  document.addEventListener('DOMContentLoaded', main);
})();