// Services & fees: the price list for consultations, lab tests, procedures and medicines used on bills.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, fmtNum, lc } from '../core/utils.js';
import { cur } from '../core/views.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

function openServiceForm(s = null) {
  return UI.formModal({
    title: s ? 'Edit service' : 'New service',
    submitLabel: s ? 'Save changes' : 'Add service',
    body: `<div class="row g-2">
      <div class="col-12"><label class="form-label">Name *</label><input name="name" class="form-control" required value="${esc(s?.name || '')}" placeholder="e.g. CBC blood test"></div>
      <div class="col-6"><label class="form-label">Category *</label><select name="category" class="form-select">
        ${Object.entries(Clinic.SERVICE_CATEGORIES).map(([k, l]) => `<option value="${k}" ${s?.category === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="col-6"><label class="form-label">Price (${esc(cur())}) *</label><input name="price" inputmode="decimal" class="form-control" value="${s?.price ?? ''}"></div>
      ${s ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="sv-active" ${s.active ? 'checked' : ''}><label class="form-check-label" for="sv-active">Active (can be added to bills)</label></div></div>` : ''}
    </div>`,
    onSubmit: (v) => Clinic.saveService(v, s?.id || null),
  });
}

async function renderList(el, $el, state) {
  const all = await idb.getAll('services');
  const q = lc(state.q);
  const list = all.filter((s) => !q || s.nameLc.includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const manage = Auth.can('fee.manage');
  const groups = Object.entries(Clinic.SERVICE_CATEGORIES).map(([cat, label]) => {
    const rows = list.filter((s) => s.category === cat);
    if (!rows.length) return '';
    return `<div class="section-title"><h2>${esc(label)}</h2><span class="small text-body-secondary">${rows.length}</span></div>
      <div class="list-card">${rows.map((s) => `<div class="list-row ${s.active ? '' : 'opacity-50'}">
        <div class="main"><div class="title">${esc(s.name)}</div><div class="sub">${s.active ? 'Active' : 'Inactive'}</div></div>
        <div class="fw-bold money me-2">${esc(cur())} ${fmtNum(s.price)}</div>
        ${manage ? `<button class="btn btn-sm btn-outline-secondary f-edit" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.name)}"><i class="bi bi-pencil"></i></button>` : ''}</div>`).join('')}</div>`;
  }).join('');
  $el.find('.f-body').html(groups || UI.emptyState(all.length ? 'No services match your search' : 'No services yet. Add your consultation fees, lab tests and procedures.', 'list-check',
    manage && !all.length ? '<button class="btn btn-primary btn-sm mt-2 f-add">Add service</button>' : ''));
}

export default {
  async render(el) {
    this.destroy();
    const $el = $(el);
    const state = { q: '' };
    $el.html(UI.pageHeader('Services & fees', Auth.can('fee.manage') ? '<button class="btn btn-primary btn-sm f-add"><i class="bi bi-plus-lg me-1"></i>Add</button>' : '') + `
      <div class="filters"><div class="flex-grow-2"><input type="search" class="form-control f-q" placeholder="Search services" autocomplete="off"></div></div>
      <div class="f-body"></div>`);
    await renderList(el, $el, state);

    $el.on('input', '.f-q', function () { state.q = this.value.trim(); renderList(el, $el, state); });
    $el.on('click', '.f-add', async () => {
      const saved = await openServiceForm();
      if (saved) { UI.toast(`Added ${saved.name}`); renderList(el, $el, state); }
    });
    $el.on('click', '.f-edit', async (e) => {
      const s = await idb.get('services', e.currentTarget.dataset.id);
      if (!s) return;
      const saved = await openServiceForm(s);
      if (saved) { UI.toast('Service updated'); renderList(el, $el, state); }
    });
    this._h = () => { if (location.hash === '#/fees') renderList(el, $el, state); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
