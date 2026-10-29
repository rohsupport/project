// ============================================================
// Управление ролями (только admin): быстрая смена через select
// ============================================================
(function () {
  let allProfiles = [];
  let channel = null;
  let tbody, emptyEl, countEl;

  const ROLE_LABELS = {
    admin: 'Администратор',
    dispatcher: 'Диспетчер',
    manager: 'Менеджер',
    driver: 'Водитель'
  };
  const STAFF = ['admin', 'dispatcher', 'manager', 'driver'];

  async function load() {
    const { data, error } = await window.sb
      .from('profiles')
      .select('id,full_name,role,updated_at,is_blocked')
      .in('role', STAFF)
      .order('role')
      .order('full_name');
    if (error) { UI.toast(error.message, 'err'); return; }
    allProfiles = data || [];
    renderTable(allProfiles);
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = 'block';
      countEl.textContent = '';
      return;
    }
    emptyEl.style.display = 'none';
    countEl.textContent = `Всего сотрудников: ${list.length}`;
    list.forEach(p => tbody.appendChild(row(p)));
  }

  function row(p) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = p.full_name || p.id.slice(0, 8);
    if (p.is_blocked) tdName.appendChild(UI.badge('Заблокирован', 'err'));

    const tdRole = document.createElement('td');
    const sel = document.createElement('select');
    sel.style.minWidth = '160px';
    ['admin', 'dispatcher', 'manager', 'driver'].forEach(r => {
      const o = document.createElement('option');
      o.value = r;
      o.textContent = ROLE_LABELS[r];
      if (p.role === r) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => changeRole(p, sel));
    tdRole.appendChild(sel);

    const tdChanged = document.createElement('td');
    tdChanged.textContent = UI.fmtDate(p.updated_at);

    const tdActions = document.createElement('td');
    tdActions.className = 'actions';
    tdActions.textContent = '—';

    tr.appendChild(tdName);
    tr.appendChild(tdRole);
    tr.appendChild(tdChanged);
    tr.appendChild(tdActions);
    return tr;
  }

  async function changeRole(p, selectEl) {
    const newRole = selectEl.value;
    if (newRole === p.role) return;

    // защита последнего админа
    if (p.role === 'admin' && newRole !== 'admin') {
      const { count } = await window.sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if ((count || 0) <= 1) {
        UI.toast('Нельзя понизить последнего администратора', 'err');
        selectEl.value = p.role;
        return;
      }
    }

    selectEl.disabled = true;
    try {
      const { error } = await window.sb
        .from('profiles')
        .update({ role: newRole })
        .eq('id', p.id);
      if (error) throw error;
      UI.toast('Роль обновлена', 'ok');
      await load();
    } catch (e) {
      UI.toast(e.message || 'Ошибка', 'err');
      selectEl.value = p.role;
    } finally {
      selectEl.disabled = false;
    }
  }

  function setupRealtime() {
    channel = window.sb.channel('roles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load())
      .subscribe();
    window.addEventListener('beforeunload', () => {
      if (channel) window.sb.removeChannel(channel);
    });
  }

  async function main() {
    let profile;
    try { ({ profile } = await Auth.requireStaff({ admin: true })); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Управление ролями',
      profile,
      active: 'roles.html'
    });

    const note = document.createElement('div');
    note.className = 'card';
    note.style.marginBottom = '16px';
    note.textContent = 'Только администраторы могут менять роли сотрудников. Все изменения записываются в аудит.';
    content.appendChild(note);

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    countEl = document.createElement('span');
    countEl.className = 'muted';
    toolbar.appendChild(countEl);
    content.appendChild(toolbar);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>ФИО</th><th>Текущая роль</th><th>Изменено</th><th>Действия</th></tr>
        </thead>
        <tbody id="roles-tbody"></tbody>
      </table>`;
    emptyEl = document.createElement('div');
    emptyEl.className = 'empty';
    emptyEl.style.display = 'none';
    emptyEl.textContent = 'Сотрудников нет';
    wrap.appendChild(emptyEl);
    content.appendChild(wrap);
    tbody = wrap.querySelector('#roles-tbody');

    await load();
    setupRealtime();
  }

  document.addEventListener('DOMContentLoaded', main);
})();