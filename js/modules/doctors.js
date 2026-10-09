// Doctors: their share of each bill, the balance the clinic owes them, payouts and a per-doctor statement.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, fmtNum, fmtDate, fmtDateTime, today, round2 } from '../core/utils.js';
import { cur } from '../core/views.js';
import { getSettings } from '../core/settings.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

function openDoctorForm(d = null) {
  return UI.formModal({
    title: d ? 'Edit doctor' : 'New doctor',
    submitLabel: d ? 'Save changes' : 'Add doctor',
    body: `<div class="row g-2">
      <div class="col-12"><label class="form-label">Doctor name *</label><input name="name" class="form-control" required value="${esc(d?.name || '')}"></div>
      <div class="col-12"><label class="form-label">Specialty</label><input name="specialty" class="form-control" placeholder="e.g. Gynaecology" value="${esc(d?.specialty || '')}"></div>
      <div class="col-6"><label class="form-label">Phone</label><input name="phone" type="tel" class="form-control" value="${esc(d?.phone || '')}"></div>
      <div class="col-6"><label class="form-label">Consultation fee</label><input name="fee" inputmode="decimal" class="form-control" value="${d?.fee ?? 0}"></div>
      <div class="col-12"><label class="form-label">Doctor's share of each bill (%) *</label>
        <input name="sharePct" inputmode="decimal" class="form-control" value="${d?.sharePct ?? getSettings().defaultSharePct}">
        <div class="form-text">The rest of every bill belongs to the clinic. Changing this only affects new bills.</div></div>
      ${d ? `<div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="d-active" ${d.active ? 'checked' : ''}><label class="form-check-label" for="d-active">Active (can receive new tokens and bills)</label></div></div>` : ''}
    </div>`,
    onSubmit: (v) => Clinic.saveDoctor(v, d?.id || null),
  });
}

function openPayForm(doc, balance) {
  return UI.formModal({
    title: `Pay ${doc.name}`,
    submitLabel: 'Record payout',
    submitClass: 'btn-success',
    body: `<div class="alert alert-info py-2 small">Balance due to ${esc(doc.name)}: <b class="money">${esc(cur())} ${fmtNum(balance)}</b></div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label">Amount *</label><input name="amount" inputmode="decimal" class="form-control" value="${round2(balance)}"></div>
        <div class="col-6"><label class="form-label">Date</label><input name="date" type="date" class="form-control" value="${today()}"></div>
        <div class="col-6"><label class="form-label">Mode</label><select name="mode" class="form-select">${Object.entries(Clinic.MODES).filter(([k]) => k !== 'credit').map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="col-6"><label class="form-label">Note</label><input name="note" class="form-control" placeholder="Optional"></div>
      </div>`,
    onSubmit: (v) => Clinic.payDoctor(doc.id, v),
  });
}

async function doctorStats(doctors) {
  const all = await idb.read(['bills', 'payouts'], (t) => Promise.all([t.getAll('bills'), t.getAll('payouts')]));
  const [bills, payouts] = all;
  const out = new Map();
  for (const d of doctors) {
    const b = bills.filter((x) => x.doctorId === d.id && x.status !== 'void');
    const earned = round2(b.reduce((s, x) => s + x.doctorShare, 0));
    const paid = round2(payouts.filter((p) => p.doctorId === d.id).reduce((s, p) => s + p.amount, 0));
    out.set(d.id, { earned, paid, balance: round2(earned - paid), bills: b.length });
  }
  return out;
}

async function renderList(el, $el) {
  const doctors = (await idb.getAll('doctors')).sort((a, b) => a.name.localeCompare(b.name));
  const stats = await doctorStats(doctors);
  const manage = Auth.can('doctor.manage');
  const cards = doctors.map((d) => {
    const s = stats.get(d.id);
    return `<div class="col-12 col-md-6 col-xl-4"><a class="doctor-card card-body p-3 d-block text-decoration-none h-100 ${d.active ? '' : 'opacity-50'}" href="#/doctors/${encodeURIComponent(d.id)}">
      <div class="d-flex align-items-center gap-3">${UI.avatar(d.name)}<div class="min-w-0 flex-grow-1">
        <div class="fw-bold text-truncate">${esc(d.name)}</div><div class="small text-body-secondary text-truncate">${esc(d.specialty || 'General')} · ${d.sharePct}% share${d.active ? '' : ' · inactive'}</div></div></div>
      <div class="d-flex gap-2 small mt-3">
        <div class="flex-fill"><div class="text-body-secondary">Earned</div><div class="fw-bold money" data-count="${s.earned}" data-money="1">0</div></div>
        <div class="flex-fill"><div class="text-body-secondary">Paid out</div><div class="fw-bold money">${esc(cur())} ${fmtNum(s.paid)}</div></div>
        <div class="flex-fill"><div class="text-body-secondary">Owed to doctor</div><div class="fw-bold money text-${s.balance > 0 ? 'warning' : 'success'}">${esc(cur())} ${fmtNum(s.balance)}</div></div>
      </div></a></div>`;
  }).join('');
  $el.html(UI.pageHeader('Doctors', manage ? '<button class="btn btn-primary btn-sm d-doc-add"><i class="bi bi-plus-lg me-1"></i>Add</button>' : '') +
    `<div class="row g-2 stagger">${cards || `<div class="col-12">${UI.emptyState('No doctors yet. Add the first doctor to start issuing tokens.', 'person-badge', manage ? '<button class="btn btn-primary btn-sm mt-2 d-doc-add">Add doctor</button>' : '')}</div>`}</div>`);
  UI.countUp(el, (v, node) => (node.dataset.money ? `${cur()} ${fmtNum(v)}` : String(Math.round(v))));
}

async function renderDetail(el, $el, id) {
  const doc = await idb.get('doctors', id);
  if (!doc) { $el.html(UI.pageHeader('Doctor', '', '#/doctors') + UI.emptyState('This doctor was not found.', 'person-x')); return; }
  const [bills, payouts] = await idb.read(['bills', 'payouts'], (t) => Promise.all([t.getAllByIndex('bills', 'doctorId', id), t.getAllByIndex('payouts', 'doctorId', id)]));
  const s = await doctorStats([doc]).then((m) => m.get(id));
  const list = bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pays = payouts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const manage = Auth.can('doctor.manage');
  $el.html(UI.pageHeader(doc.name, `${manage ? '<button class="btn btn-outline-secondary btn-sm d-doc-edit"><i class="bi bi-pencil"></i> Edit</button>' : ''}${Auth.can('payout.create') && s.balance > 0 ? '<button class="btn btn-success btn-sm d-doc-pay"><i class="bi bi-cash-stack me-1"></i>Pay</button>' : ''}`, '#/doctors') + `
    <div class="card card-body mb-3">
      <div class="d-flex align-items-center gap-3 mb-3">${UI.avatar(doc.name, 'round')}<div class="min-w-0"><div class="fw-bold fs-5 text-truncate">${esc(doc.name)}</div>
        <div class="small text-body-secondary">${esc(doc.specialty || 'General')} · share ${doc.sharePct}% · fee ${esc(cur())} ${fmtNum(doc.fee)}${doc.phone ? ` · ${esc(doc.phone)}` : ''}</div></div></div>
      <div class="row g-2">
        <div class="col-4"><div class="stat-card p-2 text-center"><div class="small text-body-secondary">Earned</div><div class="fw-bold money">${esc(cur())} ${fmtNum(s.earned)}</div></div></div>
        <div class="col-4"><div class="stat-card p-2 text-center"><div class="small text-body-secondary">Paid out</div><div class="fw-bold money">${esc(cur())} ${fmtNum(s.paid)}</div></div></div>
        <div class="col-4"><div class="stat-card p-2 text-center"><div class="small text-body-secondary">Owed</div><div class="fw-bold money text-${s.balance > 0 ? 'warning' : 'success'}">${esc(cur())} ${fmtNum(s.balance)}</div></div></div>
      </div>
    </div>
    <div class="section-title mt-0"><h2>Bills</h2></div>
    <div class="list-card">${list.map((b) => `<a class="list-row" href="#/billing/${encodeURIComponent(b.id)}">
      <div class="main"><div class="title">${esc(b.number)} · ${esc(b.patientName)}</div><div class="sub">${esc(fmtDate(b.date))} · doctor share ${esc(cur())} ${fmtNum(b.doctorShare)}</div></div>
      <div class="end"><div class="fw-bold money">${esc(cur())} ${fmtNum(b.total)}</div>${b.status === 'void' ? '<span class="badge text-bg-secondary">Void</span>' : ''}</div></a>`).join('') || UI.emptyState('No bills for this doctor yet', 'receipt')}</div>
    <div class="section-title"><h2>Payouts</h2></div>
    <div class="list-card">${pays.map((p) => `<div class="list-row"><div class="main"><div class="title">${esc(cur())} ${fmtNum(p.amount)}</div><div class="sub">${esc(fmtDate(p.date))} · ${esc(Clinic.MODES[p.mode] || p.mode)}${p.note ? ' · ' + esc(p.note) : ''}</div></div><div class="small text-body-secondary">${fmtDateTime(p.createdAt)}</div></div>`).join('') || UI.emptyState('No payouts yet', 'cash-stack')}</div>`);
  UI.countUp(el, (v) => `${cur()} ${fmtNum(v)}`);

  $el.off('click.dd').on('click.dd', '.d-doc-edit', async () => {
    const saved = await openDoctorForm(doc);
    if (saved) { UI.toast('Doctor updated'); renderDetail(el, $el, id); }
  });
  $el.on('click.dd', '.d-doc-pay', async () => {
    const latest = await doctorStats([doc]).then((m) => m.get(id));
    const saved = await openPayForm(doc, latest.balance);
    if (saved) { UI.toast(`Paid ${cur()} ${fmtNum(saved.amount)} to ${doc.name}`); renderDetail(el, $el, id); }
  });
}

export default {
  async render(el, { params }) {
    this.destroy();
    const $el = $(el);
    if (params[0]) return renderDetail(el, $el, params[0]);
    await renderList(el, $el);
    $el.on('click', '.d-doc-add', async () => {
      const saved = await openDoctorForm();
      if (saved) { UI.toast(`Added ${saved.name}`); renderList(el, $el); }
    });
    this._h = () => { if (location.hash === '#/doctors') renderList(el, $el); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
