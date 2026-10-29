// ============================================================
// Дашборд: RPC analytics_summary + realtime на complaints/notifications
// ============================================================
(function () {
  let complaintsChannel = null;
  let notificationsChannel = null;

  // Рендер одной карточки-виджета
  function widget(label, value, sub, accent) {
    const w = document.createElement('div');
    w.className = 'widget' + (accent ? ' widget--accent' : '');
    const l = document.createElement('div');
    l.className = 'widget__label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'widget__value';
    v.textContent = value ?? '—';
    w.appendChild(l);
    w.appendChild(v);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'widget__sub';
      s.textContent = sub;
      w.appendChild(s);
    }
    return w;
  }

  // Рендер всех 8 виджетов
  function renderWidgets(container, d) {
    container.innerHTML = '';
    container.appendChild(widget('Маршруты', d.routes_total, `активных: ${d.routes_active}`));
    container.appendChild(widget('Транспорт', d.transport_total, `активных: ${d.transport_active}`));
    container.appendChild(widget('Водители на смене', d.drivers_on_shift));
    container.appendChild(widget('Новые жалобы', d.complaints_new, '', Number(d.complaints_new) > 0));
    container.appendChild(widget('Жалобы в работе', d.complaints_in_progress));
    container.appendChild(widget('Уведомления', d.notifications_total));
    container.appendChild(widget('Пользователи', d.users_total));
    container.appendChild(widget('Заблокированные', d.users_blocked));
  }

  // Загрузка сводки через RPC
  async function loadSummary(widgetsEl) {
    const { data, error } = await window.sb.rpc('analytics_summary');
    if (error) { UI.toast(error.message, 'err'); return; }
    renderWidgets(widgetsEl, data || {});
  }

  // Загрузка последних уведомлений
  async function loadNotifications(tbody, emptyEl) {
    const { data, error } = await window.sb
      .from('notifications')
      .select('id,title,type,created_at,route_id,routes(name,code)')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) { UI.toast(error.message, 'err'); return; }
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    data.forEach(n => tbody.appendChild(notificationRow(n)));
  }

  // строка уведомления
  function notificationRow(n) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = n.title;
    const td2 = document.createElement('td');
    td2.appendChild(badgeForType(n.type));
    const td3 = document.createElement('td');
    td3.textContent = UI.fmtDate(n.created_at);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    return tr;
  }

  // бейдж типа уведомления
  function badgeForType(type) {
    const map = { info: ['info', 'Инфо'], warning: ['warn', 'Внимание'], critical: ['err', 'Критично'] };
    const [kind, label] = map[type] || ['muted', type];
    return UI.badge(label, kind);
  }

  // Загрузка последних новых жалоб
  async function loadComplaints(tbody, emptyEl) {
    const { data, error } = await window.sb
      .from('complaints')
      .select('id,message,created_at,status,routes(name,code)')
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) { UI.toast(error.message, 'err'); return; }
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    data.forEach(c => tbody.appendChild(complaintRow(c)));
  }

  // строка жалобы
  function complaintRow(c) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = UI.fmtDate(c.created_at);
    const td2 = document.createElement('td');
    const msg = c.message || '';
    td2.textContent = msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
    const td3 = document.createElement('td');
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn--sm';
    openBtn.textContent = 'Открыть';
    openBtn.addEventListener('click', () => {
      location.href = 'complaints.html';
    });
    td3.appendChild(openBtn);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    return tr;
  }

  // Инициализация realtime
  function setupRealtime(refs) {
    complaintsChannel = window.sb.channel('dash-complaints')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' }, payload => {
        UI.toast('Новая жалоба', 'warn');
        loadSummary(refs.widgetsEl);
        // вставить сверху
        const tr = complaintRow(payload.new);
        const tbody = refs.complaintsTbody;
        tbody.prepend(tr);
        while (tbody.children.length > 5) tbody.lastChild.remove();
        refs.complaintsEmpty.style.display = 'none';
      })
      .subscribe();

    notificationsChannel = window.sb.channel('dash-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
        UI.toast('Новое уведомление', 'ok');
        const tr = notificationRow(payload.new);
        const tbody = refs.notifTbody;
        tbody.prepend(tr);
        while (tbody.children.length > 5) tbody.lastChild.remove();
        refs.notifEmpty.style.display = 'none';
        loadSummary(refs.widgetsEl);
      })
      .subscribe();
  }

  // Главный
  async function main() {
    const content = UI.renderShell({
      title: 'Дашборд',
      profile: null,
      active: 'dashboard.html'
    });

    let profile;
    try {
      const r = await Auth.requireStaff();
      profile = r.profile;
    } catch (e) { return; }

    // Перерисуем topbar с реальным именем
    const userBox = document.querySelector('.topbar__user');
    if (userBox) {
      userBox.innerHTML = '';
      const nameEl = document.createElement('span');
      nameEl.className = 'topbar__name';
      nameEl.textContent = profile.full_name || profile.id.slice(0, 8);
      const roleEl = document.createElement('span');
      roleEl.className = 'badge badge--role badge--role-' + profile.role;
      roleEl.textContent = UI.ROLE_LABEL[profile.role] || profile.role;
      userBox.appendChild(nameEl);
      userBox.appendChild(roleEl);
    }

    // кнопка "Обновить"
    const head = document.createElement('div');
    head.className = 'section-head';
    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.style.margin = '0';
    h2.textContent = 'Сводка';
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn--sm';
    refreshBtn.textContent = '🔄 Обновить';
    head.appendChild(h2);
    head.appendChild(refreshBtn);
    content.appendChild(head);

    const widgetsEl = document.createElement('div');
    widgetsEl.className = 'grid-widgets';
    content.appendChild(widgetsEl);

    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      await loadSummary(widgetsEl);
      refreshBtn.disabled = false;
      UI.toast('Данные обновлены', 'ok');
    });

    // Последние уведомления
    const nHead = document.createElement('div');
    nHead.className = 'section-head';
    nHead.style.marginTop = '24px';
    const nTitle = document.createElement('h2');
    nTitle.className = 'section-title';
    nTitle.style.margin = '0';
    nTitle.textContent = 'Последние 5 уведомлений';
    const nAllBtn = document.createElement('a');
    nAllBtn.className = 'btn btn--sm';
    nAllBtn.href = 'notifications.html';
    nAllBtn.textContent = 'Все уведомления';
    nHead.appendChild(nTitle);
    nHead.appendChild(nAllBtn);
    content.appendChild(nHead);

    const nWrap = document.createElement('div');
    nWrap.className = 'table-wrap';
    nWrap.innerHTML = `
      <table>
        <thead><tr><th>Заголовок</th><th>Тип</th><th>Дата</th></tr></thead>
        <tbody id="dash-notif-tbody"></tbody>
      </table>`;
    const nEmpty = document.createElement('div');
    nEmpty.className = 'empty';
    nEmpty.style.display = 'none';
    nEmpty.textContent = 'Пока нет уведомлений';
    nWrap.appendChild(nEmpty);
    content.appendChild(nWrap);

    // Жалобы
    const cHead = document.createElement('div');
    cHead.className = 'section-head';
    cHead.style.marginTop = '24px';
    const cTitle = document.createElement('h2');
    cTitle.className = 'section-title';
    cTitle.style.margin = '0';
    cTitle.textContent = 'Новые жалобы';
    const cAllBtn = document.createElement('a');
    cAllBtn.className = 'btn btn--sm';
    cAllBtn.href = 'complaints.html';
    cAllBtn.textContent = 'Все жалобы';
    cHead.appendChild(cTitle);
    cHead.appendChild(cAllBtn);
    content.appendChild(cHead);

    const cWrap = document.createElement('div');
    cWrap.className = 'table-wrap';
    cWrap.innerHTML = `
      <table>
        <thead><tr><th>Дата</th><th>Текст</th><th></th></tr></thead>
        <tbody id="dash-compl-tbody"></tbody>
      </table>`;
    const cEmpty = document.createElement('div');
    cEmpty.className = 'empty';
    cEmpty.style.display = 'none';
    cEmpty.textContent = 'Новых жалоб нет';
    cWrap.appendChild(cEmpty);
    content.appendChild(cWrap);

    const refs = {
      widgetsEl,
      notifTbody: nWrap.querySelector('#dash-notif-tbody'),
      notifEmpty: nEmpty,
      complaintsTbody: cWrap.querySelector('#dash-compl-tbody'),
      complaintsEmpty: cEmpty
    };

    // первичная загрузка
    await Promise.all([
      loadSummary(widgetsEl),
      loadNotifications(refs.notifTbody, refs.notifEmpty),
      loadComplaints(refs.complaintsTbody, refs.complaintsEmpty)
    ]);

    // realtime
    setupRealtime(refs);

    // отписка
    window.addEventListener('beforeunload', () => {
      if (complaintsChannel) window.sb.removeChannel(complaintsChannel);
      if (notificationsChannel) window.sb.removeChannel(notificationsChannel);
    });
  }

  document.addEventListener('DOMContentLoaded', main);
})();