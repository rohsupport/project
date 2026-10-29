// ============================================================
// UI-утилиты: shell (sidebar + topbar), toast, modal-helper,
// бейджи, форматирование, debounce
// ============================================================
(function () {

  // ---------- TOAST ----------
  function ensureToastContainer() {
    let c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function toast(msg, type = 'ok', timeout = 3500) {
    const c = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast--out');
      setTimeout(() => el.remove(), 300);
    }, timeout);
  }

  // ---------- SHELL ----------
  const NAV = [
    { href: 'dashboard.html',     label: 'Дашборд',           icon: '🏠' },
    { href: 'routes.html',        label: 'Маршруты',          icon: '🛣️' },
    { href: 'stops.html',         label: 'Остановки',         icon: '📍' },
    { href: 'route-stops.html',   label: 'Маршрут-остановки', icon: '🔗' },
    { href: 'schedule.html',      label: 'Расписание',        icon: '🕒' },
    { href: 'transport.html',     label: 'Транспорт',         icon: '🚌' },
    { href: 'drivers.html',       label: 'Водители',          icon: '🧑‍✈️' },
    { href: 'users.html',         label: 'Пользователи',      icon: '👥' },
    { href: 'roles.html',         label: 'Роли',              icon: '🎛️', admin: true },
    { href: 'notifications.html', label: 'Уведомления',       icon: '🔔' },
    { href: 'complaints.html',    label: 'Жалобы',            icon: '📨' },
    { href: 'analytics.html',     label: 'Аналитика',         icon: '📊' },
    { href: 'audit.html',         label: 'Аудит',             icon: '🧾', admin: true },
    { href: 'profile.html',       label: 'Профиль',           icon: '👤' }
  ];

  const ROLE_LABEL = {
    admin: 'Администратор',
    dispatcher: 'Диспетчер',
    manager: 'Менеджер',
    driver: 'Водитель',
    passenger: 'Пассажир'
  };

  // Отрисовка "оболочки": sidebar + topbar + main
  function renderShell({ title, profile, active }) {
    const current = (active || location.pathname.split('/').pop() || 'dashboard.html');
    // защита: если профиль не передан — не падаем
    const safeProfile = profile || { role: 'passenger', full_name: '' };

    // --- sidebar ---
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.id = 'sidebar';

    const logo = document.createElement('div');
    logo.className = 'sidebar__logo';
    logo.textContent = '🚌 Транспорт';
    sidebar.appendChild(logo);

    const nav = document.createElement('nav');
    nav.className = 'sidebar__nav';
    NAV.forEach(item => {
      if (item.admin && safeProfile.role !== 'admin') return;
      const a = document.createElement('a');
      a.className = 'sidebar__link';
      if (item.href === current) a.classList.add('sidebar__link--active');
      a.href = item.href;
      const ic = document.createElement('span');
      ic.className = 'sidebar__icon';
      ic.textContent = item.icon;
      a.appendChild(ic);
      a.appendChild(document.createTextNode(item.label));
      nav.appendChild(a);
    });
    sidebar.appendChild(nav);

    const logout = document.createElement('button');
    logout.className = 'btn btn--danger sidebar__logout';
    logout.textContent = 'Выйти';
    logout.addEventListener('click', () => window.Auth.signOut());
    sidebar.appendChild(logout);

    // --- topbar ---
    const main = document.createElement('div');
    main.className = 'main';

    const topbar = document.createElement('header');
    topbar.className = 'topbar';

    const burger = document.createElement('button');
    burger.className = 'topbar__burger';
    burger.setAttribute('aria-label', 'Меню');
    burger.textContent = '☰';
    burger.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar--open');
    });

    const h1 = document.createElement('h1');
    h1.className = 'topbar__title';
    h1.textContent = title || '';

    const userBox = document.createElement('div');
    userBox.className = 'topbar__user';
    const userName = document.createElement('span');
    userName.className = 'topbar__name';
    userName.textContent = safeProfile.full_name || (safeProfile.id ? safeProfile.id.slice(0, 8) : '');
    const userRole = document.createElement('span');
    userRole.className = `badge badge--role badge--role-${safeProfile.role || 'passenger'}`;
    userRole.textContent = ROLE_LABEL[safeProfile.role] || safeProfile.role || '';
    userBox.appendChild(userName);
    userBox.appendChild(userRole);

    topbar.appendChild(burger);
    topbar.appendChild(h1);
    topbar.appendChild(userBox);

    // --- content ---
    const content = document.createElement('main');
    content.className = 'content';
    content.id = 'page-content';

    main.appendChild(topbar);
    main.appendChild(content);

    document.body.prepend(main);
    document.body.prepend(sidebar);

    // overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', () => sidebar.classList.remove('sidebar--open'));
    document.body.appendChild(overlay);

    return content;
  }

  // ---------- ФОРМАТ ----------
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  function fmtDateShort(s) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('ru-RU');
  }
  function fmtTime(t) {
    if (!t) return '—';
    return String(t).slice(0, 5);
  }

  // ---------- BADGES ----------
  function badge(text, kind) {
    const b = document.createElement('span');
    b.className = `badge badge--${kind}`;
    b.textContent = text;
    return b;
  }

  // ---------- DEBOUNCE ----------
  function debounce(fn, ms = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ---------- EMPTY ----------
  function emptyState(container, msg = 'Нет данных') {
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'empty';
    el.innerHTML = '<div class="empty__icon">📭</div>';
    const p = document.createElement('p');
    p.textContent = msg;
    el.appendChild(p);
    container.appendChild(el);
  }

  // ---------- MODAL-HELPER ----------
  function createModal({ title, onClose } = {}) {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';

    const header = document.createElement('div');
    header.className = 'modal__header';
    const h = document.createElement('h2');
    h.className = 'modal__title';
    h.textContent = title || '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal__close';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      dlg.close();
      if (onClose) onClose();
      dlg.remove();
    });
    header.appendChild(h);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal__body';

    dlg.appendChild(header);
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    dlg.showModal();

    return {
      dialog: dlg,
      body,
      title: h,
      close() { dlg.close(); if (onClose) onClose(); dlg.remove(); },
      open() { dlg.showModal(); }
    };
  }

  // ---------- LOADING ----------
  function withLoading(btn, fn) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        btn.disabled = false;
        btn.textContent = orig;
      });
  }

  window.UI = {
    renderShell,
    toast,
    fmtDate,
    fmtDateShort,
    fmtTime,
    badge,
    debounce,
    emptyState,
    createModal,
    withLoading,
    ROLE_LABEL
  };
})();
