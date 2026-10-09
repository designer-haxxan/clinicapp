// Patients: searchable register, add/edit, and a per-patient history of visits, tokens and bills.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, lc, fmtDate, fmtDateTime, debounce, fmtNum } from '../core/utils.js';
import { cur, pager } from '../core/views.js';
import { pickDoctor } from '../core/pickers.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

// Opens the add/edit form. Resolves to the saved patient row, or undefined if cancelled.
export function openPatientForm(p = null) {
  return UI.formModal({
    title: p ? 'Edit patient' : 'New patient',
    submitLabel: p ? 'Save changes' : 'Add patient',
    body: `<div class="row g-2">
      <div class="col-12"><label class="form-label">Full name *</label><input name="name" class="form-control" required value="${esc(p?.name || '')}"></div>
      <div class="col-6"><label class="form-label">Phone</label><input name="phone" type="tel" inputmode="tel" class="form-control" value="${esc(p?.phone || '')}"></div>
      <div class="col-3"><label class="form-label">Age</label><input name="age" inputmode="numeric" class="form-control" value="${p?.age ?? ''}"></div>
      <div class="col-3"><label class="form-label">Gender</label><select name="gender" class="form-select">
        <option value="">—</option>${Object.entries(Clinic.GENDERS).map(([k, l]) => `<option value="${k}" ${p?.gender === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label">Address</label><input name="address" class="form-control" value="${esc(p?.address || '')}"></div>
    </div>`,
    onSubmit: (v) => Clinic.savePatient(v, p?.id || null),
  });
}

const patientLine = (p) => [p.phone, p.age != null ? `${p.age} yrs` : '', Clinic.GENDERS[p.gender] || ''].filter(Boolean).join(' · ');

async function renderList(el, $el, state) {
  const q = lc(state.q);
  const digits = state.q.replace(/\D/g, '');
  const all = (await idb.getAll('patients')).sort((a, b) => a.name.localeCompare(b.name));
  const list = all.filter((p) => !q || p.nameLc.includes(q) || (digits && String(p.phone || '').replace(/\D/g, '').includes(digits)));
  $el.find('.count').text(`${all.length} patient${all.length === 1 ? '' : 's'}`);
  pager($el.find('.p-list'), list, (p) => `<a class="list-row" href="#/patients/${encodeURIComponent(p.id)}">${UI.avatar(p.name)}
    <div class="main"><div class="title">${esc(p.name)}</div><div class="sub">${esc(patientLine(p) || 'No details')}</div></div>
    <i class="bi bi-chevron-right text-body-secondary"></i></a>`, 60,
  UI.emptyState(all.length ? 'No patients match your search' : 'No patients yet. Add the first one.', 'people',
    Auth.can('patient.edit') && !all.length ? '<button class="btn btn-primary btn-sm mt-2 p-add-empty">Add patient</button>' : ''));
}

async function renderDetail(el, $el, id) {
  const p = await idb.get('patients', id);
  if (!p) { $el.html(UI.pageHeader('Patient', '', '#/patients') + UI.emptyState('This patient was not found.', 'person-x')); return; }
  const [bills, tokens, appts] = await idb.read(['bills', 'tokens', 'appointments'], (t) => Promise.all([
    t.getAllByIndex('bills', 'patientId', id), t.getAllByIndex('tokens', 'patientId', id), t.getAllByIndex('appointments', 'patientId', id),
  ]));
  const billsSorted = bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const billed = billsSorted.filter((b) => b.status !== 'void').reduce((s, b) => s + b.total, 0);
  const due = billsSorted.filter((b) => b.status !== 'void').reduce((s, b) => s + b.due, 0);
  $el.html(`${UI.pageHeader(p.name, `${Auth.can('patient.edit') ? '<button class="btn btn-outline-secondary btn-sm p-edit"><i class="bi bi-pencil"></i> Edit</button>' : ''}`, '#/patients')}
    <div class="card card-body mb-3">
      <div class="d-flex align-items-center gap-3 mb-3">${UI.avatar(p.name, 'round')}<div class="min-w-0"><div class="fw-bold fs-5 text-truncate">${esc(p.name)}</div>
        <div class="small text-body-secondary">${esc(patientLine(p) || 'No details recorded')}</div></div></div>
      ${p.address ? `<div class="small"><i class="bi bi-geo-alt me-1"></i>${esc(p.address)}</div>` : ''}
      <div class="row g-2 mt-2">
        <div class="col-4"><div class="stat-card p-2 text-center"><div class="small text-body-secondary">Visits</div><div class="fw-bold" data-count="${tokens.length}">0</div></div></div>
        <div class="col-4"><div class="stat-card p-2 text-center"><div class="small text-body-secondary">Billed</div><div class="fw-bold money">${esc(cur())} ${fmtNum(billed)}</div></div></div>
        <div class="col-4"><div class="stat-card p-2 text-center"><div class="small text-body-secondary">Due</div><div class="fw-bold money text-${due > 0 ? 'danger' : 'success'}">${esc(cur())} ${fmtNum(due)}</div></div></div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        ${Auth.can('token.manage') ? '<button class="btn btn-primary btn-sm p-token"><i class="bi bi-ticket-perforated me-1"></i>Issue token</button>' : ''}
        ${Auth.can('bill.create') ? `<a class="btn btn-outline-primary btn-sm" href="#/billing/new/patient/${encodeURIComponent(p.id)}"><i class="bi bi-receipt me-1"></i>New bill</a>` : ''}
      </div>
    </div>
    <div class="section-title mt-0"><h2>Bills</h2></div>
    <div class="list-card">${billsSorted.map((b) => `<a class="list-row" href="#/billing/${encodeURIComponent(b.id)}">
      <div class="main"><div class="title">${esc(b.number)} · ${esc(b.doctorName)}</div><div class="sub">${esc(fmtDate(b.date))} · ${b.items.map((i) => esc(i.name)).join(', ')}</div></div>
      <div class="end"><div class="fw-bold money">${esc(cur())} ${fmtNum(b.total)}</div>${b.status === 'void' ? '<span class="badge text-bg-secondary">Void</span>' : b.due > 0.004 ? `<span class="badge text-bg-warning">Due ${fmtNum(b.due)}</span>` : '<span class="badge bg-success-subtle text-success-emphasis">Paid</span>'}</div></a>`).join('') || UI.emptyState('No bills yet', 'receipt')}</div>
    <div class="section-title"><h2>Visits</h2></div>
    <div class="list-card">${tokens.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => `<div class="list-row">
      <span class="token-chip">${esc(t.label)}</span>
      <div class="main"><div class="title">${esc(t.doctorName)}</div><div class="sub">${esc(fmtDateTime(t.createdAt))}</div></div>
      <span class="small text-body-secondary">${esc(Clinic.TOKEN_STATUS[t.status])}</span></div>`).join('') || UI.emptyState('No visits yet', 'ticket-perforated')}</div>
    ${appts.length ? `<div class="section-title"><h2>Appointments</h2></div><div class="list-card">${appts.sort((a, b) => b.date.localeCompare(a.date)).map((a) => `<div class="list-row">
      <span class="time-chip">${esc(a.time)}</span><div class="main"><div class="title">${esc(fmtDate(a.date))} · ${esc(a.doctorName)}</div><div class="sub">${esc(a.reason || '')}</div></div>
      <span class="small text-body-secondary">${esc(Clinic.APPT_STATUS[a.status])}</span></div>`).join('')}</div>` : ''}`);
  UI.countUp(el, (v) => String(Math.round(v)));

  $el.off('click.pd').on('click.pd', '.p-edit', async () => {
    const saved = await openPatientForm(p);
    if (saved) { UI.toast('Patient updated'); renderDetail(el, $el, id); }
  });
  $el.on('click.pd', '.p-token', async () => {
    const doc = await pickDoctor();
    if (!doc) return;
    try {
      const tok = await Clinic.issueToken({ doctorId: doc.id, patientId: p.id });
      UI.toast(`Token ${tok.label} issued for ${doc.name}`);
    } catch (e) { UI.toastError(e); }
  });
}

export default {
  async render(el, { params }) {
    this.destroy();
    const $el = $(el);
    if (params[0]) return renderDetail(el, $el, params[0]);

    const state = { q: '' };
    $el.html(UI.pageHeader('Patients', Auth.can('patient.edit') ? '<button class="btn btn-primary btn-sm p-add"><i class="bi bi-plus-lg me-1"></i>Add</button>' : '') + `
      <div class="filters"><div class="flex-grow-2"><input type="search" class="form-control p-q" placeholder="Search by name or phone" autocomplete="off"></div></div>
      <div class="small text-body-secondary mb-2 count"></div>
      <div class="list-card p-list"></div>`);
    const refresh = () => renderList(el, $el, state);
    await refresh();

    $el.on('input', '.p-q', debounce(function () { state.q = this.value.trim(); refresh(); }, 150));
    $el.on('click', '.p-add, .p-add-empty', async () => {
      const saved = await openPatientForm();
      if (saved) { UI.toast(`Added ${saved.name}`); refresh(); }
    });
    this._h = () => { if (location.hash.startsWith('#/patients') && !location.hash.slice(10)) refresh(); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
