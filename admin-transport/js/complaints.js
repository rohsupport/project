// ============================================================
// Жалобы: список + realtime + модалка деталей + смена статуса
// ============================================================
(function () {
  let allComplaints = [];
  let channel = null;
  let tbody, emptyEl, filterStatus, filterSearch, countEl;

  const STATUS_LABELS = {
    new: ['Новая', 'info'],
    in_progress: ['В работе', 'warn'],
    resolved: ['Решена', 'ok'],
    rejected: ['Отклонена', 'muted']
  };

  // загрузка списка
  async function load() {
    const { data, error } = await window.sb
      .from('complaints')
      .select(`
        id, message, status, admin_comment, created_at, updated_at,
        passenger_id, route_id,
        passengers:passenger_id (
          id, profile_id,
          profiles:profile_id (id, full_name, phone)
        ),
        routes:route_id (id, name, code)
      `)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { UI.toast(error.message, 'err'); return; }
    allComplaints = data || [];
    applyFilter();
  }

  // фильтрация + рендер
  function applyFilter() {
    const st = filterStatus.value;
    const q = filterSearch.value.trim().toLowerCase();
    const filtered = allComplaints.filter(c => {
      if (st !== 'all' && c.status !== st) return false;
      if (q && !(c.message || '').toLowerCase().includes(q)) return false;
      return true;
    });
    countEl.textContent = `Найдено: ${filtered.length}`;
    renderTable(filtered);
  }

  // вспомогательное: получить ФИО пассажира
  function passengerName(c) {
    const p = c.passengers && c.passengers.profiles;
    return (p && p.full_name) || '—';
  }
  function passengerPhone(c) {
    const p = c.passengers && c.passengers.profiles;
    return (p && p.phone) || '—';
  }
  function routeLabel(c) {
    const r = c.routes;
    return r ? `${r.code} — ${r.name}` : '—';
  }

  // рендер таблицы
  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    list.forEach(c => tbody.appendChild(row(c)));
  }

  // строка
  function row(c) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const tdDate = document.createElement('td');
    tdDate.textContent = UI.fmtDate(c.created_at);

    const tdPass = document.createElement('td');
    tdPass.textContent = passengerName(c);

    const tdRoute = document.createElement('td');
    tdRoute.textContent = routeLabel(c);

    const tdMsg = document.createElement('td');
    const msg = c.message || '';
    tdMsg.textContent = msg.length > 80 ? msg.slice(0, 80) + '…' : msg;

    const tdStatus = document.createElement('td');
    const [label, kind] = STATUS_LABELS[c.status] || [c.status, 'muted'];
    tdStatus.appendChild(UI.badge(label, kind));

    const tdAct = document.createElement('td');
    tdAct.className = 'actions';
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn--sm';
    openBtn.textContent = 'Открыть';
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetails(c);
    });
    tdAct.appendChild(openBtn);

    tr.appendChild(tdDate);
    tr.appendChild(tdPass);
    tr.appendChild(tdRoute);
    tr.appendChild(tdMsg);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAct);

    tr.addEventListener('click', () => openDetails(c));
    return tr;
  }

  // модалка деталей
  function openDetails(c) {
    const m = UI.createModal({ title: 'Детали жалобы' });

    const info = document.createElement('div');
    info.style.display = 'grid';
    info.style.gap = '6px';
    info.style.marginBottom = '16px';

    function infoRow(label, value) {
      const d = document.createElement('div');
      const l = document.createElement('span');
      l.style.color = 'var(--muted)';
      l.style.marginRight = '6px';
      l.textContent = label + ':';
      const v = document.createElement('span');
      v.textContent = value;
      d.appendChild(l);
      d.appendChild(v);
      return d;
    }

    info.appendChild(infoRow('Дата', UI.fmtDate(c.created_at)));
    info.appendChild(infoRow('Пассажир', passengerName(c)));
    info.appendChild(infoRow('Телефон', passengerPhone(c)));
    info.appendChild(infoRow('Маршрут', routeLabel(c)));

    const msgLabel = document.createElement('div');
    msgLabel.style.color = 'var(--muted)';
    msgLabel.style.marginTop = '8px';
    msgLabel.textContent = 'Текст:';
    const msgBox = document.createElement('div');
    msgBox.style.background = 'var(--bg)';
    msgBox.style.border = '1px solid var(--border)';
    msgBox.style.borderRadius = '8px';
    msgBox.style.padding = '10px';
    msgBox.style.marginTop = '4px';
    msgBox.style.whiteSpace = 'pre-wrap';
    msgBox.textContent = c.message || '';

    m.body.appendChild(info);
    m.body.appendChild(msgLabel);
    m.body.appendChild(msgBox);

    // форма редактирования
    const form = document.createElement('form');
    form.className = 'form';
    form.style.marginTop = '16px';
    form.innerHTML = `
      <div class="field">
        <label>Статус</label>
        <select name="status">
          <option value="new">Новая</option>
          <option value="in_progress">В работе</option>
          <option value="resolved">Решена</option>
          <option value="rejected">Отклонена</option>
        </select>
      </div>
      <div class="field">
        <label>Комментарий администратора</label>
        <textarea name="admin_comment" maxlength="1000">${c.admin_comment ? escapeText(c.admin_comment) : ''}</textarea>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="cancel-btn">Отмена</button>
        <button type="submit" class="btn btn--brand" id="save-btn">Сохранить</button>
      </div>`;
    const statusSel = form.querySelector('select[name=status]');
    statusSel.value = c.status;

    m.body.appendChild(form);
    form.querySelector('#cancel-btn').addEventListener('click', m.close);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newStatus = fd.get('status');
      const comment = String(fd.get('admin_comment') || '').trim() || null;
      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        const { error } = await window.sb
          .from('complaints')
          .update({ status: newStatus, admin_comment: comment })
          .eq('id', c.id);
        if (error) throw error;
        UI.toast('Жалоба обновлена', 'ok');
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

  // экранирование textarea значения
  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // realtime
  function setupRealtime() {
    channel = window.sb.channel('complaints-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' }, payload => {
        UI.toast('Новая жалоба', 'warn');
        load();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints' }, () => {
        load();
      })
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  // Главный
  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Жалобы и обращения',
      profile,
      active: 'complaints.html'
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.innerHTML = `<label>Статус</label>`;
    filterStatus = document.createElement('select');
    filterStatus.innerHTML = `
      <option value="all">Все</option>
      <option value="new">Новые</option>
      <option value="in_progress">В работе</option>
      <option value="resolved">Решено</option>
      <option value="rejected">Отклонено</option>`;
    f1.appendChild(filterStatus);

    const f2 = document.createElement('div');
    f2.className = 'field field--grow';
    f2.innerHTML = `<label>Поиск по тексту</label>`;
    filterSearch = document.createElement('input');
    filterSearch.placeholder = 'Поиск...';
    f2.appendChild(filterSearch);

    countEl = document.createElement('span');
    countEl.className = 'muted';

    toolbar.appendChild(f1);
    toolbar.appendChild(f2);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Дата</th><th>Пассажир</th><th>Маршрут</th><th>Текст</th><th>Статус</th><th></th>
          </tr>
        </thead>
        <tbody id="compl-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Жалоб нет';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#compl-tbody');

    filterStatus.addEventListener('change', applyFilter);
    filterSearch.addEventListener('input', UI.debounce(applyFilter, 300));

    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();