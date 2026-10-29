// ============================================================
// Пользователи: 2 вкладки (пассажиры / сотрудники) + блокировка + смена роли
// ============================================================
(function () {
  let allProfiles = [];
  let channel = null;
  let currentTab = 'passengers';
  let tableBody, emptyEl, countEl, searchInput, tabsEl;
  let myRole = 'manager';

  const ROLE_LABELS = {
    admin: 'Администратор',
    dispatcher: 'Диспетчер',
    manager: 'Менеджер',
    driver: 'Водитель',
    passenger: 'Пассажир'
  };
  const STAFF = ['admin', 'dispatcher', 'manager', 'driver'];

  async function load() {
    const { data, error } = await window.sb
      .from('profiles')
      .select('id,full_name,phone,role,is_blocked,created_at')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) { UI.toast(error.message, 'err'); return; }
    allProfiles = data || [];
    applyFilter();
  }

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    let list;
    if (currentTab === 'passengers') {
      list = allProfiles.filter(p => p.role === 'passenger');
    } else {
      list = allProfiles.filter(p => STAFF.includes(p.role));
    }
    if (q) {
      list = list.filter(p =>
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q)
      );
    }
    countEl.textContent = `Найдено: ${list.length}`;
    renderTable(list);
  }

  function renderTable(list) {
    tableBody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    list.forEach(p => tableBody.appendChild(currentTab === 'passengers' ? passengerRow(p) : staffRow(p)));
  }

  function passengerRow(p) {
    const tr = document.createElement('tr');
    const tdN = document.createElement('td'); tdN.textContent = p.full_name || '—';
    const tdP = document.createElement('td'); tdP.textContent = p.phone || '—';
    const tdB = document.createElement('td');
    tdB.appendChild(p.is_blocked ? UI.badge('Заблокирован', 'err') : UI.badge('Активен', 'ok'));
    const tdD = document.createElement('td'); tdD.textContent = UI.fmtDateShort(p.created_at);

    const tdA = document.createElement('td');
    tdA.className = 'actions';
    const btn = document.createElement('button');
    btn.className = 'btn btn--sm ' + (p.is_blocked ? 'btn--ok' : 'btn--danger');
    btn.textContent = p.is_blocked ? 'Разблокировать' : 'Блокировать';
    btn.addEventListener('click', () => toggleBlock(p));
    tdA.appendChild(btn);

    tr.appendChild(tdN);
    tr.appendChild(tdP);
    tr.appendChild(tdB);
    tr.appendChild(tdD);
    tr.appendChild(tdA);
    return tr;
  }

  function staffRow(p) {
    const tr = document.createElement('tr');
    const tdN = document.createElement('td'); tdN.textContent = p.full_name || '—';
    const tdR = document.createElement('td');
    const badgeCls = 'badge--role badge--role-' + p.role;
    const b = document.createElement('span');
    b.className = 'badge ' + badgeCls;
    b.textContent = ROLE_LABELS[p.role] || p.role;
    tdR.appendChild(b);
    const tdP = document.createElement('td'); tdP.textContent = p.phone || '—';
    const tdB = document.createElement('td');
    tdB.appendChild(p.is_blocked ? UI.badge('Заблокирован', 'err') : UI.badge('Активен', 'ok'));

    const tdA = document.createElement('td');
    tdA.className = 'actions';

    if (myRole === 'admin') {
      const roleBtn = document.createElement('button');
      roleBtn.className = 'btn btn--sm';
      roleBtn.textContent = 'Сменить роль';
      roleBtn.addEventListener('click', () => openRoleModal(p));
      tdA.appendChild(roleBtn);

      const blockBtn = document.createElement('button');
      blockBtn.className = 'btn btn--sm ' + (p.is_blocked ? 'btn--ok' : 'btn--danger');
      blockBtn.textContent = p.is_blocked ? 'Разблокировать' : 'Блокировать';
      blockBtn.addEventListener('click', () => toggleBlock(p));
      tdA.appendChild(blockBtn);
    } else {
      tdA.textContent = '—';
    }

    tr.appendChild(tdN);
    tr.appendChild(tdR);
    tr.appendChild(tdP);
    tr.appendChild(tdB);
    tr.appendChild(tdA);
    return tr;
  }

  async function toggleBlock(p) {
    const action = p.is_blocked ? 'разблокировать' : 'заблокировать';
    if (!confirm(`Вы уверены, что хотите ${action} пользователя "${p.full_name || p.id.slice(0,8)}"?`)) return;
    try {
      const { error } = await window.sb
        .from('profiles')
        .update({ is_blocked: !p.is_blocked })
        .eq('id', p.id);
      if (error) throw error;
      UI.toast(p.is_blocked ? 'Пользователь разблокирован' : 'Пользователь заблокирован', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
    }
  }

  async function openRoleModal(p) {
    // защита: не даём понизить последнего админа
    if (p.role === 'admin') {
      const { count, error } = await window.sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (error) { UI.toast(error.message, 'err'); return; }
      if ((count || 0) <= 1) {
        UI.toast('Нельзя понизить последнего администратора', 'err');
        return;
      }
    }

    const m = UI.createModal({ title: `Сменить роль: ${p.full_name || p.id.slice(0,8)}` });
    const form = document.createElement('form');
    form.className = 'form';
    form.innerHTML = `
      <div class="field">
        <label>Новая роль</label>
        <select name="role">
          <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Администратор</option>
          <option value="dispatcher" ${p.role === 'dispatcher' ? 'selected' : ''}>Диспетчер</option>
          <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>Менеджер</option>
          <option value="driver" ${p.role === 'driver' ? 'selected' : ''}>Водитель</option>
        </select>
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
      const newRole = fd.get('role');
      if (newRole === p.role) { m.close(); return; }

      // если понижаем админа — ещё раз проверим
      if (p.role === 'admin' && newRole !== 'admin') {
        const { count } = await window.sb
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');
        if ((count || 0) <= 1) {
          UI.toast('Нельзя понизить последнего администратора', 'err');
          return;
        }
      }

      const saveBtn = form.querySelector('#save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';
      try {
        const { error } = await window.sb
          .from('profiles')
          .update({ role: newRole })
          .eq('id', p.id);
        if (error) throw error;
        UI.toast('Роль обновлена', 'ok');
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

  function setupRealtime() {
    channel = window.sb.channel('profiles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load())
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff()); } catch (e) { return; }
    myRole = profile.role;

    const content = UI.renderShell({
      title: 'Пользователи',
      profile,
      active: 'users.html'
    });

    // вкладки
    tabsEl = document.createElement('div');
    tabsEl.className = 'tabs';
    const t1 = document.createElement('button');
    t1.className = 'tab tab--active';
    t1.textContent = 'Пассажиры';
    t1.dataset.tab = 'passengers';
    const t2 = document.createElement('button');
    t2.className = 'tab';
    t2.textContent = 'Сотрудники';
    t2.dataset.tab = 'staff';
    tabsEl.appendChild(t1);
    tabsEl.appendChild(t2);
    content.appendChild(tabsEl);

    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      currentTab = btn.dataset.tab;
      tabsEl.querySelectorAll('.tab').forEach(x => x.classList.toggle('tab--active', x === btn));
      applyFilter();
    });

    // toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const fSearch = document.createElement('div');
    fSearch.className = 'field field--grow';
    fSearch.innerHTML = `<label>Поиск</label>`;
    searchInput = document.createElement('input');
    searchInput.placeholder = 'ФИО или телефон';
    fSearch.appendChild(searchInput);
    countEl = document.createElement('span');
    countEl.className = 'muted';
    toolbar.appendChild(fSearch);
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead id="users-thead"></thead>
        <tbody id="users-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Нет данных';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tableBody = wrap.querySelector('#users-tbody');

    // обновление шапки при смене вкладки
    function renderHead() {
      const thead = wrap.querySelector('#users-thead');
      const cols = currentTab === 'passengers'
        ? ['ФИО', 'Телефон', 'Заблокирован', 'Дата регистрации', 'Действия']
        : ['ФИО', 'Роль', 'Телефон', 'Заблокирован', 'Действия'];
      thead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
    }
    renderHead();

    // переключение вкладки обновляет шапку
    tabsEl.addEventListener('click', renderHead);

    searchInput.addEventListener('input', UI.debounce(applyFilter, 300));

    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();