// Reception: issue today's tokens, call patients in order, track who is with the doctor, and send finished visits to billing.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, today, fmtTime } from '../core/utils.js';
import { pickPatient, pickDoctor } from '../core/pickers.js';
import { openPatientForm } from './patients.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

// Buttons available for a token, by its status.
function actions(t) {
  const out = [];
  const can = Auth.can('token.manage');
  if (can && t.status === 'waiting') out.push(['call', 'megaphone', 'Call', 'btn-primary']);
  if (can && t.status === 'called') out.push(['consult', 'person-check', 'With doctor', 'btn-success']);
  if (can && t.status === 'in_consult') out.push(['done', 'check2-circle', 'Done', 'btn-success']);
  if (can && ['waiting', 'called'].includes(t.status)) out.push(['cancel', 'x-circle', 'Cancel', 'btn-outline-danger']);
  if (Auth.can('bill.create') && ['in_consult', 'done'].includes(t.status) && !t.billId) out.push(['bill', 'receipt', 'Bill', 'btn-outline-primary']);
  return out;
}

const STATUS_TINT = { waiting: 'text-bg-warning', called: 'text-bg-info', in_consult: 'text-bg-success', done: 'text-bg-light', cancelled: 'text-bg-secondary' };

function queueRow(t) {
  const acts = actions(t).map(([act, icon, label, cls]) => `<button class="btn btn-sm ${cls} r-act" data-act="${act}" data-id="${esc(t.id)}"><i class="bi bi-${icon} me-1"></i>${label}</button>`).join('');
  return `<div class="list-row queue-row ${t.status === 'in_consult' ? 'is-serving' : ''}" data-id="${esc(t.id)}">
    <span class="token-chip ${t.status === 'in_consult' ? 'serving' : ''}">${esc(t.label)}</span>
    <div class="main"><div class="title">${esc(t.patientName)}</div>
      <div class="sub">${esc(t.doctorName)} · ${fmtTime(t.createdAt)}${t.billId ? ' · <span class="text-success">billed</span>' : ''}</div>
      <div class="d-flex flex-wrap gap-1 mt-2 r-actions">${acts}</div></div>
    <span class="badge ${STATUS_TINT[t.status]} align-self-start">${esc(Clinic.TOKEN_STATUS[t.status])}</span></div>`;
}

function servingCard(doc, tokens) {
  const now = tokens.find((t) => t.status === 'in_consult');
  const next = tokens.filter((t) => t.status === 'waiting').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const called = tokens.find((t) => t.status === 'called');
  const waiting = tokens.filter((t) => t.status === 'waiting').length;
  return `<div class="col-12 col-md-6 col-xl-4"><div class="card serve-card h-100 ${now ? 'is-live' : ''}">
    <div class="card-body">
      <div class="d-flex align-items-center gap-2 mb-2">${UI.avatar(doc.name)}<div class="min-w-0 flex-grow-1"><div class="fw-bold text-truncate">${esc(doc.name)}</div><div class="small text-body-secondary">${esc(doc.specialty || 'General')} · ${waiting} waiting</div></div></div>
      <div class="serve-num ${now ? 'pulse' : ''}">${now ? esc(now.label) : called ? esc(called.label) : '—'}</div>
      <div class="serve-name text-truncate">${now ? esc(now.patientName) : called ? `Called: ${esc(called.patientName)}` : 'Nobody with the doctor'}</div>
      <button class="btn btn-primary w-100 mt-3 r-next" data-doc="${esc(doc.id)}" ${next ? '' : 'disabled'}><i class="bi bi-megaphone me-1"></i>${next ? `Call next · ${esc(next.label)}` : 'No one waiting'}</button>
    </div></div></div>`;
}

export default {
  async render(el, { params }) {
    this.destroy();
    const $el = $(el);
    this._doctor = params[0] ? decodeURIComponent(params[0]) : (this._doctor || '');
    const day = await idb.read(['doctors', 'tokens'], async (t) => ({ doctors: await t.getAll('doctors'), tokens: await t.getAllByIndex('tokens', 'date', today()) }));
    const doctors = day.doctors.filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name));
    const sel = doctors.find((d) => d.id === this._doctor) ? this._doctor : '';
    this._doctor = sel;
    const tokens = day.tokens.sort((a, b) => a.number - b.number);
    const shown = sel ? tokens.filter((t) => t.doctorId === sel) : tokens;
    const active = shown.filter((t) => Clinic.ACTIVE_TOKEN.includes(t.status));
    const finished = shown.filter((t) => !Clinic.ACTIVE_TOKEN.includes(t.status));
    const waitingAll = tokens.filter((t) => t.status === 'waiting').length;

    const chips = [`<button class="chip ${!sel ? 'active' : ''}" data-doc="">All doctors <span class="badge rounded-pill text-bg-light ms-1">${waitingAll} waiting</span></button>`]
      .concat(doctors.map((d) => `<button class="chip ${sel === d.id ? 'active' : ''}" data-doc="${esc(d.id)}">${esc(d.name)}</button>`)).join('');

    $el.html(UI.pageHeader('Reception', Auth.can('token.manage') ? `<button class="btn btn-primary btn-sm r-issue"><i class="bi bi-plus-lg me-1"></i>Issue token</button>` : '') +
      `<div class="chips mb-3 r-chips">${chips}</div>` +
      (doctors.length
        ? `<div class="row g-3 stagger mb-2">${sel ? servingCard(doctors.find((d) => d.id === sel), shown) : doctors.map((d) => servingCard(d, tokens.filter((t) => t.doctorId === d.id))).join('')}</div>`
        : UI.emptyState('Add a doctor before issuing tokens.', 'person-badge', Auth.can('doctor.manage') ? '<a class="btn btn-primary btn-sm mt-2" href="#/doctors">Add doctor</a>' : '')) +
      `<div class="section-title"><h2>Queue · ${active.length} active</h2><span class="small text-body-secondary">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }))}</span></div>
      <div class="list-card queue-list">${active.map(queueRow).join('') || UI.emptyState('No one in the queue. Issue a token to start.', 'ticket-perforated')}</div>
      ${finished.length ? `<div class="section-title"><h2>Finished today</h2></div><div class="list-card">${finished.map(queueRow).join('')}</div>` : ''}`);

    $el.off('click.rc');
    $el.on('click.rc', '.r-chips [data-doc]', (e) => {
      this._doctor = e.currentTarget.dataset.doc;
      this.render(el, { params: [this._doctor] });
    });
    $el.on('click.rc', '.r-issue', () => this.issue(el));
    $el.on('click.rc', '.r-next', async (e) => {
      const docId = e.currentTarget.dataset.doc;
      const next = tokens.filter((t) => t.doctorId === docId && t.status === 'waiting').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next) return;
      await this.run(() => Clinic.setTokenStatus(next.id, 'called'), `Calling ${next.label}`);
    });
    $el.on('click.rc', '.r-act', async (e) => {
      const id = e.currentTarget.dataset.id; const act = e.currentTarget.dataset.act;
      const tok = tokens.find((t) => t.id === id);
      if (act === 'bill') return (location.hash = `#/billing/new/token/${encodeURIComponent(id)}`);
      if (act === 'cancel' && !(await UI.confirmDialog(`Cancel token ${tok.label} for ${tok.patientName}?`, { okLabel: 'Cancel token', okClass: 'btn-danger' }))) return;
      const to = { call: 'called', consult: 'in_consult', done: 'done', cancel: 'cancelled' }[act];
      await this.run(() => Clinic.setTokenStatus(id, to), `${tok.label}: ${Clinic.TOKEN_STATUS[to]}`);
    });
    this._h = () => { if (location.hash.startsWith('#/reception')) this.render(el, { params: [this._doctor] }); };
    document.addEventListener('data:changed', this._h);
  },

  async run(fn, okMessage) {
    try { await fn(); UI.toast(okMessage); } catch (e) { UI.toastError(e); }
  },

  // Issue a token: choose the patient (or add one), then the doctor.
  async issue(el) {
    try {
      const patient = await pickPatient(openPatientForm);
      if (!patient) return;
      const doc = await pickDoctor();
      if (!doc) return;
      const tok = await Clinic.issueToken({ doctorId: doc.id, patientId: patient.id });
      UI.toast(`Token ${tok.label} issued to ${patient.name} for ${doc.name}`);
    } catch (e) { UI.toastError(e); }
  },

  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
