// Billing: create bills for visits (consultation, lab, procedures), collect dues, print receipts and void mistakes.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, fmtNum, fmtDate, fmtTime, round2, num, debounce } from '../core/utils.js';
import { cur, bindDateFilter, dateFilter, rangeFor, pager } from '../core/views.js';
import { getSettings } from '../core/settings.js';
import { pickPatient, pickDoctor, pickService } from '../core/pickers.js';
import { openPatientForm } from './patients.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

// ---------- Receipt ----------
export function printReceipt(b) {
  const s = getSettings();
  const C = s.currency;
  const lines = b.items.map((i) => `<tr><td colspan="2">${esc(i.name)}</td></tr>
    <tr><td>${i.qty} × ${fmtNum(i.rate)}</td><td class="r">${fmtNum(i.amount)}</td></tr>`).join('');
  const html = `<div class="receipt w80">
    <div class="c b big">${esc(s.clinic.name)}</div>
    ${s.clinic.address ? `<div class="c">${esc(s.clinic.address)}</div>` : ''}
    ${s.clinic.phone ? `<div class="c">Tel: ${esc(s.clinic.phone)}</div>` : ''}
    <hr>
    <div>Bill: <b>${esc(b.number)}</b></div>
    <div>Date: ${esc(fmtDate(b.date))} ${esc(fmtTime(b.createdAt))}</div>
    <div>Patient: ${esc(b.patientName)}</div>
    <div>Doctor: ${esc(b.doctorName)}</div>
    <hr><table>${lines}</table><hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${fmtNum(b.subtotal)}</td></tr>
      ${b.discount ? `<tr><td>Discount</td><td class="r">−${fmtNum(b.discount)}</td></tr>` : ''}
      <tr class="b"><td>Total (${esc(C)})</td><td class="r">${fmtNum(b.total)}</td></tr>
      <tr><td>Paid</td><td class="r">${fmtNum(b.paid)}</td></tr>
      ${b.due > 0.004 ? `<tr class="b"><td>Due</td><td class="r">${fmtNum(b.due)}</td></tr>` : ''}
    </table><hr>
    <div class="c">${esc(s.clinic.footer)}</div></div>`;
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const done = () => { area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

const statusBadge = (b) => (b.status === 'void'
  ? '<span class="badge text-bg-secondary">Void</span>'
  : b.due > 0.004 ? `<span class="badge text-bg-warning">Due ${fmtNum(b.due)}</span>` : '<span class="badge bg-success-subtle text-success-emphasis">Paid</span>');

// ---------- List ----------
async function renderList(el, $el, range) {
  const [from, to] = range;
  const d = await Clinic.loadRange(from, to);
  const S = Clinic.summarize(d);
  const list = d.bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $el.find('.b-summary').html(`
    <div class="col-6 col-lg-3"><div class="stat-card p-3"><div class="l small text-body-secondary">Billed</div><div class="fw-bold fs-5 money" data-count="${S.billed}" data-money="1">0</div></div></div>
    <div class="col-6 col-lg-3"><div class="stat-card p-3"><div class="l small text-body-secondary">Collected</div><div class="fw-bold fs-5 money" data-count="${S.collected}" data-money="1">0</div></div></div>
    <div class="col-6 col-lg-3"><div class="stat-card p-3"><div class="l small text-body-secondary">Still due</div><div class="fw-bold fs-5 money text-warning" data-count="${S.outstanding}" data-money="1">0</div></div></div>
    <div class="col-6 col-lg-3"><div class="stat-card p-3"><div class="l small text-body-secondary">Bills</div><div class="fw-bold fs-5" data-count="${S.bills}">0</div></div></div>`);
  UI.countUp($el[0], (v, node) => (node.dataset.money ? `${cur()} ${fmtNum(v)}` : String(Math.round(v))));
  pager($el.find('.b-list'), list, (b) => `<a class="list-row" href="#/billing/${encodeURIComponent(b.id)}">
    <div class="main"><div class="title">${esc(b.number)} · ${esc(b.patientName)}</div>
      <div class="sub">${esc(fmtDate(b.date))} · ${esc(b.doctorName)} · ${b.items.map((i) => esc(i.name)).join(', ')}</div></div>
    <div class="end"><div class="fw-bold money">${esc(cur())} ${fmtNum(b.total)}</div>${statusBadge(b)}</div></a>`, 60,
  UI.emptyState('No bills in this period', 'receipt'));
}

// ---------- New bill ----------
function renderNew(el, $el, st) {
  const subtotal = round2(st.lines.reduce((s, l) => s + round2(l.qty * l.rate), 0));
  const disc = round2(Math.min(subtotal, Math.max(0, num(st.discount, 0))));
  const total = round2(subtotal - disc);
  const paid = round2(Math.min(total, Math.max(0, num(st.paid, 0))));
  const due = round2(total - paid);
  const C = cur();
  const lines = st.lines.map((l, i) => `<div class="cart-line">
      <div class="info"><div class="name">${esc(l.name)}</div><div class="meta">${esc(Clinic.SERVICE_CATEGORIES[l.category] || l.category)}</div></div>
      <div class="qty-ctl"><button type="button" class="b-q" data-i="${i}" data-d="-1">−</button><input class="b-qty" data-i="${i}" value="${l.qty}" inputmode="numeric"><button type="button" class="b-q" data-i="${i}" data-d="1">+</button></div>
      <input class="form-control form-control-sm b-rate" data-i="${i}" inputmode="decimal" value="${l.rate}" style="width:92px">
      <div class="amt money">${fmtNum(round2(l.qty * l.rate))}</div>
      <button type="button" class="btn btn-sm btn-link text-danger px-1 b-rm" data-i="${i}" aria-label="Remove"><i class="bi bi-x-lg"></i></button></div>`).join('');

  $el.html(UI.pageHeader('New bill', '', '#/billing') + `
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card card-body mb-3">
          <div class="row g-2">
            <div class="col-md-6"><div class="small text-body-secondary">Patient</div>
              <button type="button" class="btn btn-outline-secondary w-100 text-start b-pick-patient">${st.patient ? `<i class="bi bi-person-check me-1"></i><b>${esc(st.patient.name)}</b>` : '<i class="bi bi-person-plus me-1"></i>Choose patient'}</button></div>
            <div class="col-md-6"><div class="small text-body-secondary">Doctor</div>
              <button type="button" class="btn btn-outline-secondary w-100 text-start b-pick-doctor">${st.doctor ? `<i class="bi bi-person-badge me-1"></i><b>${esc(st.doctor.name)}</b> · ${st.doctor.sharePct}% share` : '<i class="bi bi-person-badge me-1"></i>Choose doctor'}</button></div>
          </div>
          ${st.token ? `<div class="small text-body-secondary mt-2"><span class="token-chip">${esc(st.token.label)}</span> linked to this token</div>` : ''}
        </div>
        <div class="card card-body">
          <div class="d-flex flex-wrap gap-2 mb-2 align-items-center">
            <button type="button" class="btn btn-primary btn-sm b-add"><i class="bi bi-plus-lg me-1"></i>Add service</button>
            ${st.doctor && st.doctor.fee > 0 ? `<button type="button" class="btn btn-outline-primary btn-sm b-fee"><i class="bi bi-stethoscope me-1"></i>Consultation fee · ${C} ${fmtNum(st.doctor.fee)}</button>` : ''}
          </div>
          <div class="b-lines">${lines || UI.emptyState('Add the services for this visit', 'basket')}</div>
        </div>
      </div>
      <div class="col-lg-5"><div class="card card-body pos-footer-card sticky-lg-top" style="top:72px">
        <div class="d-flex justify-content-between small mb-2"><span>Subtotal</span><span class="money">${C} ${fmtNum(subtotal)}</span></div>
        <div class="row g-2 align-items-center mb-2"><div class="col-6 small">Discount</div>
          <div class="col-6"><input class="form-control form-control-sm text-end b-disc" inputmode="decimal" value="${st.discount || ''}" placeholder="0"></div></div>
        <div class="d-flex justify-content-between align-items-end border-top pt-2 mb-3"><span class="fw-semibold">Total</span><span class="total money b-total">${C} ${fmtNum(total)}</span></div>
        <div class="row g-2 mb-2">
          <div class="col-6"><label class="form-label small mb-0">Paid now</label><input class="form-control b-paid" inputmode="decimal" value="${st.paid || ''}" placeholder="0"></div>
          <div class="col-6"><label class="form-label small mb-0">Mode</label><select class="form-select b-mode">${Object.entries(Clinic.MODES).map(([k, l]) => `<option value="${k}" ${st.mode === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="d-flex justify-content-between small mb-3"><span>Due after payment</span><span class="fw-bold money b-due ${due > 0.004 ? 'text-warning' : 'text-success'}">${C} ${fmtNum(due)}</span></div>
        <div class="d-grid gap-2">
          <button type="button" class="btn btn-pay b-save" ${!st.patient || !st.doctor || !st.lines.length || !Auth.can('bill.create') ? 'disabled' : ''}><i class="bi bi-check2-circle me-1"></i>Save bill</button>
          <button type="button" class="btn btn-outline-secondary b-save-print" ${!st.patient || !st.doctor || !st.lines.length ? 'disabled' : ''}><i class="bi bi-printer me-1"></i>Save &amp; print receipt</button>
        </div>
      </div></div>
    </div>`);

  $el.off('click.nb change.nb input.nb');
  $el.on('click.nb', '.b-pick-patient', async () => {
    const p = await pickPatient(openPatientForm);
    if (p) { st.patient = p; renderNew(el, $el, st); }
  });
  $el.on('click.nb', '.b-pick-doctor', async () => {
    const d = await pickDoctor();
    if (d) { st.doctor = d; renderNew(el, $el, st); }
  });
  $el.on('click.nb', '.b-add', async () => {
    const svc = await pickService();
    if (!svc) return;
    addLine(st, { serviceId: svc.id, name: svc.name, category: svc.category, rate: svc.price, qty: 1 });
    renderNew(el, $el, st);
  });
  $el.on('click.nb', '.b-fee', () => {
    addLine(st, { serviceId: null, name: `Consultation · ${st.doctor.name}`, category: 'consultation', rate: st.doctor.fee, qty: 1 });
    renderNew(el, $el, st);
  });
  $el.on('click.nb', '.b-q', function () {
    const l = st.lines[+this.dataset.i]; l.qty = Math.max(1, l.qty + Number(this.dataset.d));
    renderNew(el, $el, st);
  });
  $el.on('click.nb', '.b-rm', function () { st.lines.splice(+this.dataset.i, 1); renderNew(el, $el, st); });
  $el.on('change.nb', '.b-qty', function () { st.lines[+this.dataset.i].qty = Math.max(1, Math.round(num(this.value, 1))); renderNew(el, $el, st); });
  $el.on('change.nb', '.b-rate', function () { st.lines[+this.dataset.i].rate = Math.max(0, num(this.value, 0)); renderNew(el, $el, st); });
  $el.on('change.nb', '.b-mode', function () { st.mode = this.value; });
  // Discount and payment update the totals as you type, without redrawing the form (keeps focus).
  const totals = debounce(() => renderNew(el, $el, st), 0);
  $el.on('input.nb', '.b-disc', function () { st.discount = this.value; updateTotals(el, st); });
  $el.on('input.nb', '.b-paid', function () { st.paid = this.value; updateTotals(el, st); });
  $el.on('change.nb', '.b-disc, .b-paid', totals);
  $el.on('click.nb', '.b-save, .b-save-print', async (e) => {
    const print = e.currentTarget.classList.contains('b-save-print');
    try {
      const b = await Clinic.createBill({
        patientId: st.patient.id, doctorId: st.doctor.id, tokenId: st.token?.id || null,
        items: st.lines, discount: num(st.discount, 0), paid: num(st.paid, 0), mode: st.mode,
      });
      UI.toast(`Saved ${b.number}`);
      if (print) printReceipt(b);
      location.hash = `#/billing/${encodeURIComponent(b.id)}`;
    } catch (err) { UI.toastError(err); }
  });
}

function addLine(st, line) {
  const same = st.lines.find((l) => l.serviceId && l.serviceId === line.serviceId && l.rate === line.rate);
  if (same) same.qty += 1; else st.lines.push(line);
}

// Recalculates the totals card in place (used while typing discount or payment).
function updateTotals(el, st) {
  const $el = $(el);
  const subtotal = round2(st.lines.reduce((s, l) => s + round2(l.qty * l.rate), 0));
  const disc = round2(Math.min(subtotal, Math.max(0, num(st.discount, 0))));
  const total = round2(subtotal - disc);
  const paid = round2(Math.min(total, Math.max(0, num(st.paid, 0))));
  const due = round2(total - paid);
  $el.find('.b-total').text(`${cur()} ${fmtNum(total)}`);
  $el.find('.b-due').text(`${cur()} ${fmtNum(due)}`).toggleClass('text-warning', due > 0.004).toggleClass('text-success', due <= 0.004);
}

async function startNew(params) {
  const st = { patient: null, doctor: null, token: null, lines: [], discount: '', paid: '', mode: 'cash' };
  const [kind, id] = [params[1], params[2]];
  if (kind === 'token' && id) {
    const tok = await idb.get('tokens', id);
    if (!tok) throw new Error('This token was not found.');
    if (tok.billId) { location.hash = `#/billing/${encodeURIComponent(tok.billId)}`; return null; }
    st.token = tok;
    st.patient = await idb.get('patients', tok.patientId);
    st.doctor = await idb.get('doctors', tok.doctorId);
  } else if (kind === 'patient' && id) {
    st.patient = await idb.get('patients', id);
  }
  return st;
}

// ---------- Detail ----------
async function renderDetail(el, $el, id) {
  const b = await idb.get('bills', id);
  if (!b) { $el.html(UI.pageHeader('Bill', '', '#/billing') + UI.emptyState('This bill was not found.', 'receipt')); return; }
  const payments = (await idb.getAllByIndex('payments', 'billId', id)).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const isVoid = b.status === 'void';
  const C = cur();
  $el.html(UI.pageHeader(b.number, '', '#/billing') + `
    <div class="card card-body mb-3 ${isVoid ? 'bill-void' : ''}">
      <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
        <div><div class="fw-bold fs-5">${esc(b.patientName)}</div><div class="small text-body-secondary">${esc(fmtDate(b.date))} · ${esc(fmtTime(b.createdAt))} · ${esc(b.doctorName)}</div></div>
        <div>${statusBadge(b)}</div>
      </div>
      ${isVoid ? `<div class="alert alert-secondary py-2 small mb-3"><i class="bi bi-slash-circle me-1"></i>Voided: ${esc(b.voidReason || '')}</div>` : ''}
      <div class="list-card mb-3">${b.items.map((i) => `<div class="list-row"><div class="main"><div class="title">${esc(i.name)}</div><div class="sub">${i.qty} × ${esc(C)} ${fmtNum(i.rate)}</div></div><div class="fw-bold money">${fmtNum(i.amount)}</div></div>`).join('')}</div>
      <div class="bill-totals small">
        <div class="d-flex justify-content-between"><span>Subtotal</span><span class="money">${fmtNum(b.subtotal)}</span></div>
        <div class="d-flex justify-content-between"><span>Discount</span><span class="money">${fmtNum(b.discount)}</span></div>
        <div class="d-flex justify-content-between fs-6 fw-bold"><span>Total</span><span class="money">${esc(C)} ${fmtNum(b.total)}</span></div>
        <div class="d-flex justify-content-between"><span>Paid</span><span class="money">${fmtNum(b.paid)}</span></div>
        <div class="d-flex justify-content-between"><span>Due</span><span class="money ${b.due > 0.004 ? 'text-warning fw-bold' : ''}">${fmtNum(b.due)}</span></div>
        <hr class="my-2">
        <div class="d-flex justify-content-between text-body-secondary"><span>Doctor share (${b.doctorSharePct}%)</span><span class="money">${fmtNum(b.doctorShare)}</span></div>
        <div class="d-flex justify-content-between text-body-secondary"><span>Clinic share</span><span class="money">${fmtNum(b.clinicShare)}</span></div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button class="btn btn-outline-secondary b-print"><i class="bi bi-printer me-1"></i>Print receipt</button>
        ${!isVoid && b.due > 0.004 && Auth.can('payment.collect') ? '<button class="btn btn-success b-collect"><i class="bi bi-cash-coin me-1"></i>Collect due</button>' : ''}
        ${!isVoid && Auth.can('bill.void') ? '<button class="btn btn-outline-danger b-void"><i class="bi bi-slash-circle me-1"></i>Void bill</button>' : ''}
      </div>
    </div>
    <div class="section-title mt-0"><h2>Payments</h2></div>
    <div class="list-card">${payments.map((p) => `<div class="list-row"><div class="main"><div class="title">${esc(C)} ${fmtNum(p.amount)}</div><div class="sub">${esc(fmtDate(p.date))} · ${esc(Clinic.MODES[p.mode] || p.mode)}</div></div></div>`).join('') || UI.emptyState('No payments yet', 'cash-coin')}</div>`);

  $el.off('click.bd').on('click.bd', '.b-print', () => printReceipt(b));
  $el.on('click.bd', '.b-collect', async () => {
    const r = await UI.formModal({
      title: 'Collect due',
      submitLabel: 'Collect',
      submitClass: 'btn-success',
      body: `<div class="alert alert-warning py-2 small">Amount due: <b class="money">${esc(C)} ${fmtNum(b.due)}</b></div>
        <div class="row g-2"><div class="col-6"><label class="form-label">Amount *</label><input name="amount" inputmode="decimal" class="form-control" value="${round2(b.due)}"></div>
        <div class="col-6"><label class="form-label">Mode</label><select name="mode" class="form-select">${Object.entries(Clinic.MODES).filter(([k]) => k !== 'credit').map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div></div>`,
      onSubmit: (v) => Clinic.collectDue(b.id, v),
    });
    if (r) { UI.toast('Payment recorded'); renderDetail(el, $el, id); }
  });
  $el.on('click.bd', '.b-void', async () => {
    const r = await UI.formModal({
      title: `Void ${b.number}?`,
      submitLabel: 'Void bill',
      submitClass: 'btn-danger',
      body: `<p class="small">A voided bill stays in the records but no longer counts in totals, doctor shares or reports.</p>
        <label class="form-label">Reason *</label><input name="reason" class="form-control" placeholder="e.g. entered wrong patient" required>`,
      onSubmit: (v) => Clinic.voidBill(b.id, v.reason),
    });
    if (r) { UI.toast('Bill voided'); renderDetail(el, $el, id); }
  });
}

export default {
  async render(el, { params }) {
    this.destroy();
    const $el = $(el);
    if (params[0] === 'new') {
      const st = await startNew(params);
      if (!st) return;
      if (!Auth.can('bill.create')) return $el.html(UI.emptyState('You do not have permission to create bills.', 'shield-lock'));
      return renderNew(el, $el, st);
    }
    if (params[0]) return renderDetail(el, $el, params[0]);

    const range = rangeFor('today');
    $el.html(UI.pageHeader('Billing', Auth.can('bill.create') ? '<a class="btn btn-primary btn-sm" href="#/billing/new"><i class="bi bi-plus-lg me-1"></i>New bill</a>' : '') +
      dateFilter(range[0], range[1]) +
      `<div class="row g-2 mb-3 b-summary stagger"></div><div class="list-card b-list"></div>`);
    bindDateFilter($el, (f, t) => { range[0] = f; range[1] = t; renderList(el, $el, range); });
    await renderList(el, $el, range);
    this._h = () => { if (location.hash.startsWith('#/billing') && !location.hash.slice(9)) renderList(el, $el, range); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
