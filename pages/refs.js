// ============================================================
// pages/refs.js
// Раздел «Справочники»: Должности | Адреса
// ============================================================
import {
  supabase,
  safe,
  getCurrentUser,
  logAction,
  formatMoney,
} from "../lib/supabase.js";
import { DEFAULT_CURRENCY, DEBUG } from "../config.js";
import { toast } from "../app.js";

// ------------------------------------------------------------
// Состояние
// ------------------------------------------------------------
const state = {
  tab: "positions", // "positions" | "addresses"
  currency: DEFAULT_CURRENCY,
  positions: [],
  addresses: [],
  showArchived: false,
  loading: false,
};

let rootEl = null;

// ------------------------------------------------------------
// Загрузка
// ------------------------------------------------------------
async function loadAll() {
  const user = await getCurrentUser();
  if (!user) return;

  state.loading = true;
  renderBody();

  const [setRes, posRes, addrRes] = await Promise.all([
    safe(
      () =>
        supabase
          .from("user_settings")
          .select("currency")
          .eq("user_id", user.id)
          .maybeSingle(),
      "load settings"
    ),
    safe(
      () =>
        supabase
          .from("positions")
          .select("*")
          .eq("user_id", user.id)
          .order("archived", { ascending: true })
          .order("name"),
      "load positions"
    ),
    safe(
      () =>
        supabase
          .from("addresses")
          .select("*")
          .eq("user_id", user.id)
          .order("archived", { ascending: true })
          .order("label"),
      "load addresses"
    ),
  ]);

  state.currency = setRes.data?.currency || DEFAULT_CURRENCY;
  state.positions = posRes.data || [];
  state.addresses = addrRes.data || [];
  state.loading = false;
  renderBody();
}

// ------------------------------------------------------------
// Рендер
// ------------------------------------------------------------
export async function render(container) {
  rootEl = container;

  rootEl.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Справочники</h2>
        <p class="sub">Должности с часовой ставкой и адреса работы</p>
      </div>
    </div>

    <div class="tabs" id="rfTabs">
      <button class="tab ${state.tab === "positions" ? "active" : ""}" data-tab="positions">Должности</button>
      <button class="tab ${state.tab === "addresses" ? "active" : ""}" data-tab="addresses">Адреса</button>
    </div>

    <div class="filters">
      <label class="check">
        <input type="checkbox" id="rfArchived" ${state.showArchived ? "checked" : ""} />
        <span class="check-box" aria-hidden="true"></span>
        <span>Показать архив</span>
      </label>
    </div>

    <div id="rfBody"></div>
  `;

  rootEl.querySelector("#rfTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    rootEl.querySelectorAll("#rfTabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === state.tab)
    );
    renderBody();
  });

  rootEl.querySelector("#rfArchived").addEventListener("change", (e) => {
    state.showArchived = e.target.checked;
    renderBody();
  });

  await loadAll();

  return () => {
    rootEl = null;
  };
}

function renderBody() {
  if (!rootEl) return;
  const box = rootEl.querySelector("#rfBody");
  if (!box) return;

  if (state.loading) {
    box.innerHTML = `<div class="empty">Загрузка…</div>`;
    return;
  }

  if (state.tab === "positions") renderPositions(box);
  else renderAddresses(box);
}

// ============================================================
// ДОЛЖНОСТИ
// ============================================================
function renderPositions(box) {
  const list = state.showArchived
    ? state.positions
    : state.positions.filter((p) => !p.archived);

  const rows = list.length
    ? list
        .map(
          (p) => `
      <div class="list-row ${p.archived ? "archived" : ""}" data-id="${p.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)}</div>
          <div class="row-meta">${formatMoney(p.rate, state.currency)} / час${p.archived ? " · архив" : ""}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">Изм.</button>
          ${
            p.archived
              ? `<button class="btn btn-ghost btn-sm" data-act="restore" data-id="${p.id}">Вернуть</button>`
              : `<button class="btn btn-ghost btn-sm" data-act="archive" data-id="${p.id}">Архив</button>`
          }
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty">Нет должностей. Добавьте первую ниже.</div>`;

  box.innerHTML = `
    <div class="section">
      <div class="section-head">
        <h3>Добавить должность</h3>
      </div>
      <div class="card">
        <form id="posForm" class="form-grid">
          <div class="field">
            <label for="posName">Название</label>
            <input type="text" id="posName" maxlength="80" placeholder="Например, бариста" required />
          </div>
          <div class="field">
            <label for="posRate">Ставка за час</label>
            <input type="number" id="posRate" min="0" step="0.01" placeholder="0.00" required />
          </div>
          <div class="form-actions span-2">
            <button class="btn btn-primary" type="submit" id="posSubmit">Добавить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Список должностей</h3>
        <span class="hint">${list.length}</span>
      </div>
      <div class="list">${rows}</div>
    </div>
  `;

  const form = box.querySelector("#posForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = box.querySelector("#posName").value.trim();
    const rate = Number(box.querySelector("#posRate").value);
    if (!name) return toast("Введите название", "warn");
    if (!rate || rate <= 0) return toast("Ставка должна быть больше 0", "warn");

    const user = await getCurrentUser();
    if (!user) return;

    const btn = box.querySelector("#posSubmit");
    if (btn) btn.disabled = true;

    const res = await safe(
      () =>
        supabase.from("positions").insert({
          user_id: user.id,
          name,
          rate,
        }),
      "insert position"
    );

    if (btn) btn.disabled = false;

    if (res.error) return toast("Не удалось добавить", "danger");
    await logAction("position_create", { name, rate });
    toast("Должность добавлена", "ok");
    await loadAll();
  });

  box.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === "edit") openEditPosition(id);
      if (act === "archive") await toggleArchivePosition(id, true);
      if (act === "restore") await toggleArchivePosition(id, false);
    });
  });
}

async function toggleArchivePosition(id, archived) {
  const user = await getCurrentUser();
  if (!user) return;
  const res = await safe(
    () =>
      supabase
        .from("positions")
        .update({ archived })
        .eq("id", id)
        .eq("user_id", user.id),
    "archive position"
  );
  if (res.error) return toast("Не удалось обновить", "danger");
  await logAction(archived ? "position_archive" : "position_restore", { id });
  toast(archived ? "Должность в архиве" : "Должность восстановлена", "ok");
  await loadAll();
}

function openEditPosition(id) {
  const p = state.positions.find((x) => x.id === id);
  if (!p) return;

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">Редактировать должность</div>
        <button class="modal-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <form class="form-grid" id="ePosForm">
        <div class="field span-2">
          <label>Название</label>
          <input type="text" id="epName" maxlength="80" value="${escapeAttr(p.name)}" required />
        </div>
        <div class="field span-2">
          <label>Ставка за час</label>
          <input type="number" id="epRate" min="0" step="0.01" value="${Number(p.rate).toFixed(2)}" required />
        </div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" id="epSave">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#epSave").addEventListener("click", async () => {
    const name = modal.querySelector("#epName").value.trim();
    const rate = Number(modal.querySelector("#epRate").value);
    if (!name) return toast("Введите название", "warn");
    if (!rate || rate <= 0) return toast("Ставка должна быть больше 0", "warn");

    const user = await getCurrentUser();
    if (!user) return;

    const res = await safe(
      () =>
        supabase
          .from("positions")
          .update({ name, rate })
          .eq("id", id)
          .eq("user_id", user.id),
      "update position"
    );
    if (res.error) return toast("Не удалось сохранить", "danger");
    await logAction("position_update", { id, name, rate });
    toast("Должность обновлена", "ok");
    close();
    await loadAll();
  });
}

// ============================================================
// АДРЕСА
// ============================================================
function renderAddresses(box) {
  const list = state.showArchived
    ? state.addresses
    : state.addresses.filter((a) => !a.archived);

  const rows = list.length
    ? list
        .map(
          (a) => `
      <div class="list-row ${a.archived ? "archived" : ""}" data-id="${a.id}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(a.label)}</div>
          <div class="row-meta">${escapeHtml(a.address || "—")}${a.archived ? " · архив" : ""}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${a.id}">Изм.</button>
          ${
            a.archived
              ? `<button class="btn btn-ghost btn-sm" data-act="restore" data-id="${a.id}">Вернуть</button>`
              : `<button class="btn btn-ghost btn-sm" data-act="archive" data-id="${a.id}">Архив</button>`
          }
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty">Нет адресов. Добавьте первый ниже.</div>`;

  box.innerHTML = `
    <div class="section">
      <div class="section-head">
        <h3>Добавить адрес</h3>
      </div>
      <div class="card">
        <form id="addrForm" class="form-grid">
          <div class="field">
            <label for="addrLabel">Метка</label>
            <input type="text" id="addrLabel" maxlength="80" placeholder="Например, Офис 1" required />
          </div>
          <div class="field">
            <label for="addrText">Адрес (необязательно)</label>
            <input type="text" id="addrText" maxlength="200" placeholder="Улица, дом" />
          </div>
          <div class="form-actions span-2">
            <button class="btn btn-primary" type="submit" id="addrSubmit">Добавить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Список адресов</h3>
        <span class="hint">${list.length}</span>
      </div>
      <div class="list">${rows}</div>
    </div>
  `;

  const form = box.querySelector("#addrForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = box.querySelector("#addrLabel").value.trim();
    const address = box.querySelector("#addrText").value.trim() || null;
    if (!label) return toast("Введите метку", "warn");

    const user = await getCurrentUser();
    if (!user) return;

    const btn = box.querySelector("#addrSubmit");
    if (btn) btn.disabled = true;

    const res = await safe(
      () =>
        supabase.from("addresses").insert({
          user_id: user.id,
          label,
          address,
        }),
      "insert address"
    );

    if (btn) btn.disabled = false;

    if (res.error) return toast("Не удалось добавить", "danger");
    await logAction("address_create", { label });
    toast("Адрес добавлен", "ok");
    await loadAll();
  });

  box.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === "edit") openEditAddress(id);
      if (act === "archive") await toggleArchiveAddress(id, true);
      if (act === "restore") await toggleArchiveAddress(id, false);
    });
  });
}

async function toggleArchiveAddress(id, archived) {
  const user = await getCurrentUser();
  if (!user) return;
  const res = await safe(
    () =>
      supabase
        .from("addresses")
        .update({ archived })
        .eq("id", id)
        .eq("user_id", user.id),
    "archive address"
  );
  if (res.error) return toast("Не удалось обновить", "danger");
  await logAction(archived ? "address_archive" : "address_restore", { id });
  toast(archived ? "Адрес в архиве" : "Адрес восстановлен", "ok");
  await loadAll();
}

function openEditAddress(id) {
  const a = state.addresses.find((x) => x.id === id);
  if (!a) return;

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">Редактировать адрес</div>
        <button class="modal-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <form class="form-grid" id="eAddrForm">
        <div class="field span-2">
          <label>Метка</label>
          <input type="text" id="eaLabel" maxlength="80" value="${escapeAttr(a.label)}" required />
        </div>
        <div class="field span-2">
          <label>Адрес</label>
          <input type="text" id="eaText" maxlength="200" value="${a.address ? escapeAttr(a.address) : ""}" />
        </div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" id="eaSave">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("#eaSave").addEventListener("click", async () => {
    const label = modal.querySelector("#eaLabel").value.trim();
    const address = modal.querySelector("#eaText").value.trim() || null;
    if (!label) return toast("Введите метку", "warn");

    const user = await getCurrentUser();
    if (!user) return;

    const res = await safe(
      () =>
        supabase
          .from("addresses")
          .update({ label, address })
          .eq("id", id)
          .eq("user_id", user.id),
      "update address"
    );
    if (res.error) return toast("Не удалось сохранить", "danger");
    await logAction("address_update", { id, label });
    toast("Адрес обновлён", "ok");
    close();
    await loadAll();
  });
}

// ------------------------------------------------------------
// Хелперы
// ------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}