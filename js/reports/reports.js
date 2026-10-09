// Reports: end-of-day closing and date-range reports with doctor-wise shares, payment modes and charts. Print and CSV.
import * as UI from '../core/ui.js';
import { esc, fmtNum, fmtDate, fmtTime, round2, toCSV, downloadFile, debounce } from '../core/utils.js';
import { cur, bindDateFilter, dateFilter, rangeFor } from '../core/views.js';
import { drawBarChart } from '../core/charts.js';
import { getSettings } from '../core/settings.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;
let onResize = null;

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function kpi(label, value, hint = '') {
  return `<div class="col-6 col-lg-4 col-xl-2"><div class="stat-card p-3 h-100">
    <div class="small text-body-secondary text-uppercase fw-semibold" style="font-size:.7rem;letter-spacing:.04em">${esc(label)}</div>
    <div class="fw-bold fs-5 money" data-count="${round2(value)}" data-money="1">0</div>
    ${hint ? `<div class="small text-body-secondary">${esc(hint)}</div>` : ''}</div></div>`;
}

function reportHTML(S, from, to, s) {
  const C = s.currency;
  const doctorRows = S.doctors.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${d.patients.size}</td><td class="num">${d.bills}</td>
    <td class="num">${fmtNum(d.billed)}</td><td class="num">${fmtNum(d.doctorShare)}</td><td class="num">${fmtNum(d.clinicShare)}</td><td class="num">${fmtNum(d.collected)}</td></tr>`).join('');
  const modeRows = Object.entries(S.byMode).map(([m, v]) => `<tr><td>${esc(Clinic.MODES[m] || m)}</td><td class="num">${fmtNum(v)}</td></tr>`).join('');
  return `<div class="print-report">
    <h2>${esc(s.clinic.name)}: ${from === to ? 'Day-end closing' : 'Report'}</h2>
    <div>${esc(from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`)} · Printed ${esc(new Date().toLocaleString())}</div>
    <p><b>Billed</b> ${esc(C)} ${fmtNum(S.billed)} · <b>Collected</b> ${esc(C)} ${fmtNum(S.collected)} · <b>Still due</b> ${esc(C)} ${fmtNum(S.outstanding)}</p>
    <p><b>Doctors' share</b> ${esc(C)} ${fmtNum(S.doctorShare)} · <b>Clinic share</b> ${esc(C)} ${fmtNum(S.clinicShare)} · <b>Expenses</b> ${esc(C)} ${fmtNum(S.expenses)} · <b>Net to clinic</b> ${esc(C)} ${fmtNum(S.netClinic)}</p>
    <p><b>Patients</b> ${S.patients} · <b>Bills</b> ${S.bills} · <b>Tokens</b> ${S.tokens.issued} (done ${S.tokens.done}, cancelled ${S.tokens.cancelled})</p>
    <h2>By doctor</h2>
    <table><thead><tr><th>Doctor</th><th class="num">Patients</th><th class="num">Bills</th><th class="num">Billed</th><th class="num">Doctor share</th><th class="num">Clinic share</th><th class="num">Collected</th></tr></thead>
    <tbody>${doctorRows || '<tr><td colspan="7">No bills</td></tr>'}</tbody></table>
    <h2>Payments by mode</h2>
    <table><thead><tr><th>Mode</th><th class="num">Amount</th></tr></thead><tbody>${modeRows || '<tr><td colspan="2">No payments</td></tr>'}</tbody></table>
    <h2>Services</h2>
    <table><thead><tr><th>Service</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>${S.services.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.qty}</td><td class="num">${fmtNum(x.amount)}</td></tr>`).join('') || '<tr><td colspan="3">No services</td></tr>'}</tbody></table>
    <p>Expenses ${esc(C)} ${fmtNum(S.expenses)} · Doctor payouts ${esc(C)} ${fmtNum(S.payouts)} · Cash flow ${esc(C)} ${fmtNum(S.cashFlow)}</p>
  </div>`;
}

async function renderReport(el, $el, range) {
  const [from, to] = range;
  const d = await Clinic.loadRange(from, to);
  const S = Clinic.summarize(d);
  const s = getSettings();
  const C = cur();
  const single = from === to;
  const maxDoc = S.doctors[0]?.billed || 0;
  const modeTotal = Object.values(S.byMode).reduce((a, b) => a + b, 0);
  const modeList = Object.entries(S.byMode).sort((a, b) => b[1] - a[1]);

  $el.find('.r-body').html(`
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3 no-print">
      <button class="btn btn-outline-secondary btn-sm r-print"><i class="bi bi-printer me-1"></i>${single ? 'Print day-end closing' : 'Print report'}</button>
      <button class="btn btn-outline-secondary btn-sm r-csv"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
      <span class="small text-body-secondary ms-auto">${S.bills} bills · ${S.voided} voided in period</span>
    </div>
    <div class="row g-2 stagger">
      ${kpi('Billed', S.billed)}${kpi('Collected', S.collected)}${kpi('Still due', S.outstanding)}
      ${kpi('Doctors’ share', S.doctorShare)}${kpi('Clinic share', S.clinicShare)}
      ${kpi('Expenses', S.expenses)}${kpi('Doctor payouts', S.payouts)}
      ${kpi('Net to clinic', S.netClinic, 'Clinic share − expenses')}
      ${kpi('Cash flow', S.cashFlow, 'Collected − expenses − payouts')}
    </div>
    <div class="row g-3 mt-1">
      <div class="col-lg-7">${S.daily.length ? `<div class="card viz-card h-100">
        <div class="viz-head"><div><div class="ttl">Billed per day</div><div class="sub">${S.patients} patients in this period</div></div></div>
        <div class="viz r-chart"></div></div>` : `<div class="card card-body h-100">${UI.emptyState('Daily chart is shown for periods up to 62 days', 'graph-up')}</div>`}</div>
      <div class="col-lg-5"><div class="card viz-card h-100">
        <div class="viz-head"><div><div class="ttl">Payments by mode</div><div class="sub">${esc(C)} ${fmtNum(modeTotal)} collected</div></div></div>
        ${modeList.length ? modeList.map(([m, v]) => `<div class="hbar"><div class="name">${esc(Clinic.MODES[m] || m)}</div><div class="amt money">${fmtNum(v)} <span class="small text-body-secondary">${pct(v, modeTotal)}%</span></div>
          <div class="track"><div class="fill" style="width:${Math.max(3, pct(v, modeTotal))}%"></div></div></div>`).join('') : UI.emptyState('No payments in this period', 'cash-coin')}
      </div></div>
    </div>
    <div class="section-title"><h2>Doctor-wise</h2><span class="small text-body-secondary">Shares of each bill</span></div>
    <div class="list-card mb-3">${S.doctors.map((x) => `<div class="list-row">
        <div class="main"><div class="title">${esc(x.name)}</div>
          <div class="sub">${x.patients.size} patients · ${x.bills} bills · doctor ${esc(C)} ${fmtNum(x.doctorShare)} · clinic ${esc(C)} ${fmtNum(x.clinicShare)}</div>
          <div class="track mt-1" style="height:6px;border-radius:6px;background:var(--bs-secondary-bg);overflow:hidden"><div class="fill" style="height:100%;width:${Math.max(3, pct(x.billed, maxDoc))}%;background:var(--viz-bar);border-radius:6px"></div></div></div>
        <div class="end"><div class="fw-bold money">${esc(C)} ${fmtNum(x.billed)}</div><div class="small text-body-secondary">collected ${fmtNum(x.collected)}</div></div></div>`).join('') || UI.emptyState('No bills in this period', 'person-badge')}</div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="section-title mt-0"><h2>Top services</h2></div>
        <div class="list-card">${S.services.slice(0, 10).map((x) => `<div class="list-row"><div class="main"><div class="title">${esc(x.name)}</div><div class="sub">${x.qty} sold</div></div><div class="fw-bold money">${esc(C)} ${fmtNum(x.amount)}</div></div>`).join('') || UI.emptyState('No services billed', 'list-check')}</div></div>
      <div class="col-lg-6"><div class="section-title mt-0"><h2>Tokens & appointments</h2></div>
        <div class="list-card">
          <div class="list-row"><div class="main"><div class="title">Tokens issued</div><div class="sub">${S.tokens.done} done · ${S.tokens.waiting} still in queue · ${S.tokens.cancelled} cancelled</div></div><div class="fw-bold" data-count="${S.tokens.issued}">0</div></div>
          <div class="list-row"><div class="main"><div class="title">Appointments</div><div class="sub">${S.appointments.arrived} checked in · ${S.appointments.booked} still booked · ${S.appointments.noShow} no-show</div></div><div class="fw-bold" data-count="${S.appointments.total}">0</div></div>
        </div></div>
    </div>
    <div class="section-title"><h2>Bills</h2></div>
    <div class="list-card">${d.bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map((b) => `<a class="list-row" href="#/billing/${encodeURIComponent(b.id)}">
      <div class="main"><div class="title">${esc(b.number)} · ${esc(b.patientName)}</div><div class="sub">${esc(fmtDate(b.date))} ${esc(fmtTime(b.createdAt))} · ${esc(b.doctorName)}</div></div>
      <div class="end"><div class="fw-bold money">${esc(C)} ${fmtNum(b.total)}</div>${b.status === 'void' ? '<span class="badge text-bg-secondary">Void</span>' : ''}</div></a>`).join('') || UI.emptyState('No bills', 'receipt')}</div>
    ${d.bills.length > 100 ? `<div class="small text-body-secondary mt-2">Showing the latest 100 bills. Export CSV for all of them.</div>` : ''}`);

  UI.countUp($el[0], (v, node) => (node.dataset.money ? `${C} ${fmtNum(v)}` : String(Math.round(v))));
  if (S.daily.length) {
    const box = el.querySelector('.r-chart');
    const draw = () => drawBarChart(box, S.daily.map((x) => ({ label: single ? 'Today' : (x.date.slice(8) + '/' + x.date.slice(5, 7)), value: x.billed, ...x })), {
      ariaLabel: 'Billed per day', highlightLast: single,
      tip: (x) => `<b>${esc(fmtDate(x.date))}</b><br>${esc(C)} ${fmtNum(x.billed)} billed · ${esc(C)} ${fmtNum(x.collected)} collected<br>${x.patients} patients · ${x.bills} bills`,
    });
    draw();
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = debounce(() => { if (box.isConnected) draw(); }, 200);
    window.addEventListener('resize', onResize);
  }

  $el.off('click.rp').on('click.rp', '.r-print', () => {
    const area = document.getElementById('print-area');
    area.innerHTML = reportHTML(S, from, to, s);
    const done = () => { area.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  });
  $el.on('click.rp', '.r-csv', () => {
    const rows = [
      ['Clinic report', `${from} to ${to}`],
      [],
      ['Bill', 'Date', 'Patient', 'Doctor', 'Services', 'Subtotal', 'Discount', 'Total', 'Paid', 'Due', 'Doctor share %', 'Doctor share', 'Clinic share', 'Status'],
      ...d.bills.map((b) => [b.number, b.date, b.patientName, b.doctorName, b.items.map((i) => `${i.name} x${i.qty}`).join('; '), b.subtotal, b.discount, b.total, b.paid, b.due, b.doctorSharePct, b.doctorShare, b.clinicShare, b.status]),
      [],
      ['By doctor', 'Patients', 'Bills', 'Billed', 'Doctor share', 'Clinic share', 'Collected'],
      ...S.doctors.map((x) => [x.name, x.patients.size, x.bills, x.billed, x.doctorShare, x.clinicShare, x.collected]),
      [],
      ['Expenses', S.expenses], ['Doctor payouts', S.payouts], ['Net to clinic', S.netClinic], ['Cash flow', S.cashFlow],
    ];
    downloadFile(`clinic-report-${from}-to-${to}.csv`, '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
  });
}

export default {
  async render(el) {
    this.destroy();
    const $el = $(el);
    const range = rangeFor('today');
    $el.html(UI.pageHeader('Reports') + dateFilter(range[0], range[1]) + '<div class="r-body"></div>');
    bindDateFilter($el, (f, t) => { range[0] = f; range[1] = t; renderReport(el, $el, range); });
    await renderReport(el, $el, range);
    this._h = () => { if (location.hash === '#/reports') renderReport(el, $el, range); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    if (onResize) window.removeEventListener('resize', onResize);
    this._h = null; onResize = null;
  },
};
