// Dashboard: today's clinic at a glance, doctors' figures, live queue and the last 7 days.
import * as UI from '../core/ui.js';
import { esc, fmtNum, fmtTime, fmtDate, today, localDate, round2, debounce } from '../core/utils.js';
import { cur } from '../core/views.js';
import { drawBarChart } from '../core/charts.js';
import { pref } from '../core/settings.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(localDate(d)); }
  return out;
}

export default {
  async render(el) {
    this.destroy();
    const $el = $(el);
    const u = Auth.user();
    const days = lastDays(7);
    const [dayData, weekData] = await Promise.all([Clinic.loadRange(today(), today()), Clinic.loadRange(days[0], today())]);
    const T = Clinic.summarize(dayData);
    const W = Clinic.summarize(weekData);
    const docs = dayData.doctors.filter((d) => d.active);
    const active = dayData.tokens.filter((t) => Clinic.ACTIVE_TOKEN.includes(t.status));
    const serving = dayData.tokens.filter((t) => t.status === 'in_consult');
    const upcoming = dayData.appointments.filter((a) => a.status === 'booked').sort((a, b) => a.time.localeCompare(b.time));
    const backupDays = pref.get('lastBackupAt') ? Math.floor((Date.now() - new Date(pref.get('lastBackupAt'))) / 86400000) : null;
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const M = (n) => `data-count="${round2(n)}" data-money="1"`;
    const C = cur();

    const tile = (href, icon, tint, title, sub) => `<div class="col-6 col-md-4 col-xl-3">
      <a class="hub-tile" href="${href}"><div class="icon-chip tint-${tint}"><i class="bi bi-${icon}"></i></div>
      <div class="min-w-0"><div class="t">${title}</div><div class="s">${sub}</div></div></a></div>`;
    const kpi = (icon, tint, label, valueAttr, href = null) => `<div class="col-6 col-lg-3"><${href ? `a href="${href}"` : 'div'} class="stat-card card-body d-block text-decoration-none p-3 h-100">
      <div class="kpi"><div class="icon-chip tint-${tint}"><i class="bi bi-${icon}"></i></div><div class="min-w-0"><div class="l">${label}</div><div class="v money" ${valueAttr}>0</div></div></div></${href ? 'a' : 'div'}></div>`;

    const doctorCards = docs.map((d) => {
      const s = T.doctors.find((x) => x.id === d.id);
      const q = active.filter((t) => t.doctorId === d.id);
      const now = serving.find((t) => t.doctorId === d.id);
      return `<div class="col-12 col-sm-6 col-xl-4"><div class="doctor-card card-body p-3 h-100">
        <div class="d-flex align-items-center gap-3 mb-2">${UI.avatar(d.name)}<div class="min-w-0 flex-grow-1">
          <div class="fw-bold text-truncate">${esc(d.name)}</div><div class="small text-body-secondary text-truncate">${esc(d.specialty || 'General')}</div></div>
          <span class="badge rounded-pill ${q.length ? 'text-bg-warning' : 'text-bg-light'}">${q.length} waiting</span></div>
        <div class="d-flex gap-2 small mb-2">
          <div class="flex-fill"><div class="text-body-secondary">Patients</div><div class="fw-bold" data-count="${s?.patients.size || 0}">0</div></div>
          <div class="flex-fill"><div class="text-body-secondary">Billed</div><div class="fw-bold money" ${M(s?.billed || 0)}>0</div></div>
          <div class="flex-fill"><div class="text-body-secondary">Doctor share</div><div class="fw-bold money" ${M(s?.doctorShare || 0)}>0</div></div>
        </div>
        <div class="small ${now ? 'text-success' : 'text-body-secondary'}"><i class="bi bi-${now ? 'activity' : 'hourglass-split'} me-1"></i>${now ? `With doctor: <b>${esc(now.label)} · ${esc(now.patientName)}</b>` : 'No one with the doctor right now'}</div>
      </div></div>`;
    }).join('');

    $el.html(`
      <div class="hero-card">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
          <div><div class="hello">${greet}, ${esc(u.name.split(' ')[0])}</div><div class="date">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
          <span class="pill"><i class="bi bi-${navigator.onLine ? 'cloud-check' : 'wifi-off'}"></i>${navigator.onLine ? 'Online' : 'Offline'}</span>
        </div>
        <div class="lbl">Collected today</div>
        <div class="big money" ${M(T.collected)}>0</div>
        <div class="d-flex flex-wrap gap-2 mt-2 mb-3">
          <span class="pill"><i class="bi bi-people"></i>${T.patients} patient${T.patients === 1 ? '' : 's'}</span>
          <span class="pill"><i class="bi bi-receipt"></i>${T.bills} bill${T.bills === 1 ? '' : 's'}</span>
          <span class="pill"><i class="bi bi-ticket-perforated"></i>${active.length} in queue</span>
        </div>
        <div class="d-flex flex-wrap gap-2">
          ${Auth.can('bill.create') ? '<a class="btn hero-cta" href="#/billing/new"><i class="bi bi-plus-lg me-1"></i>New bill</a>' : ''}
          ${Auth.can('token.manage') ? '<a class="btn btn-outline-light" href="#/reception"><i class="bi bi-ticket-perforated me-1"></i>Reception</a>' : ''}
        </div>
      </div>
      ${!navigator.onLine ? '<div class="alert alert-secondary py-2 small"><i class="bi bi-wifi-off me-1"></i>You are offline. Everything you do is saved on this device.</div>' : ''}
      ${Auth.can('backup.export') && (backupDays === null || backupDays >= 7) ? `<div class="alert alert-warning py-2 small d-flex align-items-center gap-2"><i class="bi bi-shield-exclamation"></i><div class="flex-grow-1">${backupDays === null ? 'No backup has been made on this device yet.' : `Last backup was ${backupDays} days ago.`} Patient records only live on this device.</div><a class="btn btn-sm btn-warning" href="#/backup">Back up</a></div>` : ''}

      <div class="section-title"><h2>Doctors today</h2><a href="#/doctors">All doctors</a></div>
      <div class="row g-2 stagger">${doctorCards || `<div class="col-12">${UI.emptyState('Add a doctor to start issuing tokens', 'person-badge', Auth.can('doctor.manage') ? '<a class="btn btn-primary btn-sm mt-2" href="#/doctors">Add doctor</a>' : '')}</div>`}</div>

      <div class="section-title"><h2>Overview</h2></div>
      <div class="row g-2 stagger">
        ${kpi('receipt', 'indigo', 'Billed today', M(T.billed), '#/billing')}
        ${kpi('building', 'green', 'Clinic share today', M(T.clinicShare))}
        ${kpi('wallet2', 'red', 'Expenses today', M(T.expenses), Auth.can('expense.manage') ? '#/expenses' : null)}
        ${kpi('exclamation-circle', 'amber', 'Dues (last 7 days)', M(W.outstanding), '#/billing')}
      </div>

      <div class="row g-3 mt-1">
        <div class="col-lg-8"><div class="card viz-card h-100">
          <div class="viz-head"><div><div class="ttl">Billing — last 7 days</div><div class="sub">Total ${esc(C)} ${fmtNum(W.billed)} · ${W.bills} bills · ${W.patients} patients</div></div>
            <a class="small fw-semibold text-decoration-none" href="#/reports">Report <i class="bi bi-chevron-right"></i></a></div>
          <div class="viz week-chart"></div>
          <details class="viz-table"><summary>Show as table</summary>
            <table class="table table-sm table-report mt-2 mb-0"><thead><tr><th>Date</th><th class="num">Patients</th><th class="num">Billed</th><th class="num">Collected</th></tr></thead>
            <tbody>${W.daily.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td><td class="num">${d.patients}</td><td class="num">${fmtNum(d.billed)}</td><td class="num">${fmtNum(d.collected)}</td></tr>`).join('')}</tbody></table></details>
        </div></div>
        <div class="col-lg-4"><div class="card viz-card h-100">
          <div class="viz-head"><div><div class="ttl">Income by doctor</div><div class="sub">Billed today</div></div></div>
          ${T.doctors.length ? T.doctors.map((d) => `<div class="hbar"><div class="name">${esc(d.name)}</div><div class="amt money">${fmtNum(d.billed)}</div>
            <div class="track"><div class="fill" style="width:${Math.max(3, (d.billed / T.doctors[0].billed) * 100)}%"></div></div></div>`).join('') : UI.emptyState('No bills today yet', 'graph-up')}
        </div></div>
      </div>

      <div class="row g-3 mt-1">
        <div class="col-md-6"><div class="section-title mt-0"><h2>Live queue</h2><a href="#/reception">Open reception</a></div>
          <div class="list-card">${active.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 8).map((t) => `<a class="list-row" href="#/reception">
            <span class="token-chip ${t.status === 'in_consult' ? 'serving' : ''}">${esc(t.label)}</span>
            <div class="main"><div class="title">${esc(t.patientName)}</div><div class="sub">${esc(t.doctorName)} · ${Clinic.TOKEN_STATUS[t.status]}</div></div>
            <div class="end small text-body-secondary">${fmtTime(t.createdAt)}</div></a>`).join('') || UI.emptyState('The queue is empty', 'ticket-perforated')}</div></div>
        <div class="col-md-6"><div class="section-title mt-0"><h2>Upcoming appointments</h2><a href="#/appointments">All</a></div>
          <div class="list-card">${upcoming.slice(0, 8).map((a) => `<a class="list-row" href="#/appointments">
            <span class="time-chip">${esc(a.time)}</span>
            <div class="main"><div class="title">${esc(a.patientName)}</div><div class="sub">${esc(a.doctorName)}${a.reason ? ' · ' + esc(a.reason) : ''}</div></div>
            <div class="end"><span class="badge text-bg-info-subtle text-info-emphasis">Booked</span></div></a>`).join('') || UI.emptyState('No appointments left today', 'calendar-check')}</div></div>
      </div>

      <div class="section-title"><h2>Modules</h2></div>
      <div class="row g-2 stagger">
        ${tile('#/patients', 'people', 'pink', 'Patients', 'Records, history and visits')}
        ${tile('#/doctors', 'person-badge', 'violet', 'Doctors', 'Shares, balances and payouts')}
        ${tile('#/fees', 'list-check', 'cyan', 'Services & fees', 'Consultation and lab prices')}
        ${tile('#/expenses', 'wallet2', 'red', 'Expenses', 'Rent, salaries, supplies')}
        ${tile('#/reports', 'bar-chart-line', 'indigo', 'Reports', 'Day-end closing, doctor-wise')}
        ${tile('#/backup', 'cloud-arrow-down', 'green', 'Backup', backupDays === null ? 'Not backed up yet' : `Last ${backupDays}d ago`)}
      </div>`);

    UI.countUp(el, (v, node) => (node.dataset.money ? `${C} ${fmtNum(v)}` : String(Math.round(v))));
    const chartBox = el.querySelector('.week-chart');
    const draw = () => drawBarChart(chartBox, W.daily.map((d) => ({ label: d.date === today() ? 'Today' : new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }), value: d.billed, ...d })), {
      ariaLabel: 'Billing for the last 7 days', highlightLast: true,
      tip: (d) => `<b>${esc(fmtDate(d.date))}</b><br>${esc(C)} ${fmtNum(d.billed)} billed · ${esc(C)} ${fmtNum(d.collected)} collected<br>${d.patients} patient${d.patients === 1 ? '' : 's'}`,
    });
    draw();
    this._resize = debounce(() => { if (chartBox.isConnected) draw(); }, 200);
    window.addEventListener('resize', this._resize);

    const refresh = () => { if (location.hash === '' || location.hash.startsWith('#/dashboard')) this.render(el); };
    this._h = refresh;
    document.addEventListener('data:changed', refresh);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    if (this._resize) window.removeEventListener('resize', this._resize);
    this._h = null; this._resize = null;
  },
};
