// ============================================================
// Аутентификация и проверка ролей
// ============================================================
(function () {
  const STAFF_ROLES = ['admin', 'dispatcher', 'manager'];
  const ADMIN_ONLY = ['admin'];

  // получить текущую сессию
  async function getSession() {
    const { data, error } = await window.sb.auth.getSession();
    if (error) return null;
    return data.session;
  }

  // получить профиль по auth.uid()
  async function getProfile(userId) {
    const { data, error } = await window.sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // требовать авторизации + роль >= staff
  // opts.admin = true → только admin
  // Возвращает { user, profile }
  async function requireStaff(opts = {}) {
    const session = await getSession();
    if (!session) {
      location.href = 'index.html';
      throw new Error('no-session');
    }
    let profile;
    try {
      profile = await getProfile(session.user.id);
    } catch (e) {
      await window.sb.auth.signOut();
      location.href = 'index.html';
      throw e;
    }
    if (!profile) {
      await window.sb.auth.signOut();
      location.href = 'index.html';
      throw new Error('no-profile');
    }
    if (profile.is_blocked) {
      await window.sb.auth.signOut();
      location.href = 'index.html';
      throw new Error('blocked');
    }
    const allowed = opts.admin ? ADMIN_ONLY : STAFF_ROLES;
    if (!allowed.includes(profile.role)) {
      location.href = 'dashboard.html';
      throw new Error('forbidden');
    }
    window.currentUser = session.user;
    window.currentProfile = profile;
    return { user: session.user, profile };
  }

  // вход
  async function signIn(email, password) {
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // выход
  async function signOut() {
    await window.sb.auth.signOut();
    location.href = 'index.html';
  }

  window.Auth = {
    getSession,
    getProfile,
    requireStaff,
    signIn,
    signOut,
    STAFF_ROLES,
    ADMIN_ONLY
  };
})();