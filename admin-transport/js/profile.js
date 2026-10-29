// ============================================================
// Профиль: редактирование full_name/phone + смена пароля + выход
// ============================================================
(function () {
  async function main() {
    let profile, user;
    try { ({ profile, user } = await Auth.requireStaff()); } catch (e) { return; }

    const content = UI.renderShell({
      title: 'Мой профиль',
      profile,
      active: 'profile.html'
    });

    // --- данные профиля ---
    const card1 = document.createElement('div');
    card1.className = 'card';
    card1.innerHTML = `<h2>Личные данные</h2>`;
    const form1 = document.createElement('form');
    form1.className = 'form';
    form1.innerHTML = `
      <div class="field">
        <label>Email</label>
        <input name="email" readonly value="${escapeAttr(user.email || '')}" />
      </div>
      <div class="field">
        <label>ФИО</label>
        <input name="full_name" maxlength="200" value="${escapeAttr(profile.full_name || '')}" />
      </div>
      <div class="field">
        <label>Телефон</label>
        <input name="phone" type="tel" maxlength="30" value="${escapeAttr(profile.phone || '')}" />
      </div>
      <div class="field">
        <label>Роль</label>
        <div><span class="badge badge--role badge--role-${profile.role}">${UI.ROLE_LABEL[profile.role] || profile.role}</span></div>
      </div>
      <div class="modal__actions">
        <button type="submit" class="btn btn--brand" id="save-profile">Сохранить изменения</button>
      </div>`;
    card1.appendChild(form1);
    content.appendChild(card1);

    form1.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form1);
      const btn = form1.querySelector('#save-profile');
      btn.disabled = true;
      btn.textContent = 'Сохранение...';
      try {
        const { error } = await window.sb
          .from('profiles')
          .update({
            full_name: String(fd.get('full_name') || '').trim(),
            phone: String(fd.get('phone') || '').trim() || null
          })
          .eq('id', profile.id);
        if (error) throw error;
        UI.toast('Профиль обновлён', 'ok');
        // обновим topbar
        const nameEl = document.querySelector('.topbar__name');
        if (nameEl) nameEl.textContent = String(fd.get('full_name') || '').trim() || profile.id.slice(0,8);
      } catch (err) {
        UI.toast(err.message || 'Ошибка', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить изменения';
      }
    });

    // --- смена пароля ---
    const card2 = document.createElement('div');
    card2.className = 'card';
    card2.innerHTML = `<h2>Сменить пароль</h2>`;
    const form2 = document.createElement('form');
    form2.className = 'form';
    form2.innerHTML = `
      <div class="field">
        <label>Новый пароль (мин. 6 символов)</label>
        <input name="password" type="password" minlength="6" required autocomplete="new-password" />
      </div>
      <div class="field">
        <label>Повторите пароль</label>
        <input name="password2" type="password" minlength="6" required autocomplete="new-password" />
      </div>
      <div class="modal__actions">
        <button type="submit" class="btn btn--brand" id="save-pass">Сменить пароль</button>
      </div>`;
    card2.appendChild(form2);
    content.appendChild(card2);

    form2.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form2);
      const p1 = fd.get('password');
      const p2 = fd.get('password2');
      if (p1 !== p2) { UI.toast('Пароли не совпадают', 'err'); return; }
      if (!p1 || p1.length < 6) { UI.toast('Пароль слишком короткий', 'err'); return; }
      const btn = form2.querySelector('#save-pass');
      btn.disabled = true;
      btn.textContent = 'Смена...';
      try {
        const { error } = await window.sb.auth.updateUser({ password: p1 });
        if (error) throw error;
        UI.toast('Пароль обновлён', 'ok');
        form2.reset();
      } catch (err) {
        UI.toast(err.message || 'Ошибка', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сменить пароль';
      }
    });

    // --- выход ---
    const card3 = document.createElement('div');
    card3.className = 'card';
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn--danger';
    logoutBtn.textContent = 'Выйти из аккаунта';
    logoutBtn.addEventListener('click', () => {
      if (confirm('Выйти из аккаунта?')) Auth.signOut();
    });
    card3.appendChild(logoutBtn);
    content.appendChild(card3);
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  document.addEventListener('DOMContentLoaded', main);
})();