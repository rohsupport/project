// ============================================================
// Уведомления: создание + история + realtime
// ============================================================
(function () {
  let allNotifications = [];
  let routesList = [];
  let channel = null;
  let tbody, emptyEl, countEl, filterType, form, titleInput, bodyInput, typeInput, routeInput, sendBtn;

  const TYPE_LABELS = { info: ['Инфо', 'info'], warning: ['Внимание', 'warn'], critical: ['Критично', 'err'] };

  async function loadRoutes() {
    const { data, error } = await window.sb
      .from('routes')
      .select('id,code,name')
      .order('code');
    if (error) { UI.toast(error.message, 'err'); return; }
    routesList = data || [];
    routeInput.innerHTML = `<option value="">— Все —</option>` +
      routesList.map(r => `<option value="${r.id}">${escapeHtml(r.code + ' — ' + r.name)}</option>`).join('');
  }

  async function load() {
    const { data, error } = await window.sb
      .from('notifications')
      .select(`
        id,title,body,type,created_at,route_id,
        routes:route_id (id,code,name),
        created_by,
        profiles:created_by (id,full_name)
      `)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { UI.toast(error.message, 'err'); return; }
    allNotifications = data || [];
    applyFilter();
  }

  function applyFilter() {
    const t = filterType.value;
    const list = allNotifications.filter(n => t === 'all' || n.type === t);
    countEl.textContent = `Всего: ${list.length}`;
    renderTable(list);
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    list.forEach(n => tbody.appendChild(row(n)));
  }

  function row(n) {
    const tr = document.createElement('tr');
    const tdT = document.createElement('td'); tdT.textContent = n.title;
    const tdType = document.createElement('td');
    const [label, kind] = TYPE_LABELS[n.type] || [n.type, 'muted'];
    tdType.appendChild(UI.badge(label, kind));
    const tdRoute = document.createElement('td');
    tdRoute.textContent = n.routes ? `${n.routes.code} — ${n.routes.name}` : 'Все';
    const tdAuth = document.createElement('td');
    tdAuth.textContent = n.profiles ? n.profiles.full_name : '—';
    const tdDate = document.createElement('td');
    tdDate.textContent = UI.fmtDate(n.created_at);
    const tdAct = document.createElement('td');
    tdAct.className = 'actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--sm btn--danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteNotif(n));
    tdAct.appendChild(delBtn);

    tr.appendChild(tdT);
    tr.appendChild(tdType);
    tr.appendChild(tdRoute);
    tr.appendChild(tdAuth);
    tr.appendChild(tdDate);
    tr.appendChild(tdAct);
    return tr;
  }

  async function deleteNotif(n) {
    if (!confirm(`Удалить уведомление "${n.title}"?`)) return;
    try {
      const { error } = await window.sb.from('notifications').delete().eq('id', n.id);
      if (error) throw error;
      UI.toast('Уведомление удалено', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function sendNotification(forceNoRoute) {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    const type = typeInput.value;
    const route_id = forceNoRoute ? null : (routeInput.value || null);

    if (!title || !body) {
      UI.toast('Заполните заголовок и текст', 'err');
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Отправка...';
    try {
      const session = await window.Auth.getSession();
      const { error } = await window.sb.from('notifications').insert({
        title, body, type,
        route_id,
        created_by: session.user.id
      });
      if (error) throw error;
      UI.toast('Уведомление отправлено', 'ok');
      titleInput.value = '';
      bodyInput.value = '';
      typeInput.value = 'info';
      routeInput.value = '';
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Отправить';
    }
  }

  function setupRealtime() {
    channel = window.sb.channel('notif-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => load())
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Уведомления',
      profile,
      active: 'notifications.html'
    });

    // сетка две колонки
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'minmax(280px, 380px) 1fr';
    grid.style.gap = '16px';
    if (window.innerWidth < 900) grid.style.gridTemplateColumns = '1fr';
    content.appendChild(grid);

    // левая форма
    const left = document.createElement('div');
    left.className = 'card';
    left.innerHTML = `<h2>Создать уведомление</h2>`;
    form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Заголовок *</label>
        <input name="title" required maxlength="100" id="nf-title" />
      </div>
      <div class="field">
        <label>Текст *</label>
        <textarea name="body" required maxlength="500" id="nf-body"></textarea>
      </div>
      <div class="field">
        <label>Тип</label>
        <select name="type" id="nf-type">
          <option value="info">Инфо</option>
          <option value="warning">Внимание</option>
          <option value="critical">Критично</option>
        </select>
      </div>
      <div class="field">
        <label>Привязать к маршруту</label>
        <select name="route_id" id="nf-route"><option value="">— Все —</option></select>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="submit" class="btn btn--brand" id="nf-send" style="flex:1;">Отправить</button>
        <button type="button" class="btn" id="nf-broadcast" style="flex:1;">Всем</button>
      </div>`;
    left.appendChild(form);
    grid.appendChild(left);

    titleInput = form.querySelector('#nf-title');
    bodyInput = form.querySelector('#nf-body');
    typeInput = form.querySelector('#nf-type');
    routeInput = form.querySelector('#nf-route');
    sendBtn = form.querySelector('#nf-send');

    // блокировка, пока пусто
    function updateSendState() {
      sendBtn.disabled = !titleInput.value.trim() || !bodyInput.value.trim();
    }
    titleInput.addEventListener('input', updateSendState);
    bodyInput.addEventListener('input', updateSendState);
    updateSendState();

    form.addEventListener('submit', (e) => { e.preventDefault(); sendNotification(false); });
    form.querySelector('#nf-broadcast').addEventListener('click', () => sendNotification(true));

    // правая история
    const right = document.createElement('div');
    right.className = 'card';
    const head = document.createElement('div');
    head.className = 'section-head';
    const h2 = document.createElement('h2');
    h2.style.margin = '0';
    h2.textContent = 'История';
    const fWrap = document.createElement('div');
    fWrap.className = 'field';
    fWrap.style.minWidth = '150px';
    fWrap.style.margin = '0';
    filterType = document.createElement('select');
    filterType.innerHTML = `
      <option value="all">Все типы</option>
      <option value="info">Инфо</option>
      <option value="warning">Внимание</option>
      <option value="critical">Критично</option>`;
    fWrap.appendChild(filterType);
    head.appendChild(h2);
    head.appendChild(fWrap);
    right.appendChild(head);

    countEl = document.createElement('div');
    countEl.className = 'muted';
    countEl.style.marginBottom = '8px';
    right.appendChild(countEl);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Заголовок</th><th>Тип</th><th>Маршрут</th><th>Автор</th><th>Дата</th><th></th></tr>
        </thead>
        <tbody id="nf-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Уведомлений нет';
    wrap.appendChild(emptyEl);
    right.appendChild(wrap);
    tbody = wrap.querySelector('#nf-tbody');
    grid.appendChild(right);

    filterType.addEventListener('change', applyFilter);

    await loadRoutes();
    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();