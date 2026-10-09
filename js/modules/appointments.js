// Appointments: book a visit for a day and time, then check the patient in to create a token.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, today, fmtDate } from '../core/utils.js';
import { pickPatient, pickDoctor } from '../core/pickers.js';
import { openPatientForm } from './patients.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

const STATUS_TINT = { booked: 'text-bg-info-subtle text-info-emphasis', arrived: 'text-bg-success-subtle text-success-emphasis', completed: 'bg-success-subtle text-success-emphasis', no_show: 'text-bg-danger-subtle text-danger-emphasis', cancelled: 'text-bg-secondary-subtle text-secondary-emphasis' };

async function openBooking(date) {
  const patient = await pickPatient(openPatientForm);
  if (!patient) return;
  const doc = await pickDoctor();
  if (!doc) return;
  return UI.formModal({
    title: `Book for ${patient.name}`,
    submitLabel: 'Book appointment',
    body: `<div class="alert alert-light border small py-2 mb-3"><b>${esc(patient.name)}</b> with <b>${esc(doc.name)}</b></div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label">Date *</label><input name="date" type="date" class="form-control" required value="${esc(date)}"></div>
        <div class="col-6"><label class="form-label">Time *</label><input name="time" type="time" class="form-control" required value="09:00"></div>
        <div class="col-12"><label class="form-label">Reason</label><input name="reason" class="form-control" placeholder="e.g. follow-up, checkup"></div>
      </div>`,
    onSubmit: (v) => Clinic.saveAppointment({ ...v, patientId: patient.id, doctorId: doc.id }),
  });
}

async function renderDay(el, $el, state) {
  const appts = await idb.getAllByIndex('appointments', 'date', IDBKeyRange.only(state.date));
  const list = appts
    .filter((a) => !state.doctorId || a.doctorId === state.doctorId)
    .sort((a, b) => a.time.localeCompare(b.time));
  const manage = Auth.can('appointment.manage');
  const rows = list.map((a) => {
    const open = a.status === 'booked';
    return `<div class="list-row appt-row" data-id="${esc(a.id)}">
      <span class="time-chip">${esc(a.time)}</span>
      <div class="main"><div class="title">${esc(a.patientName)}</div>
        <div class="sub">${esc(a.doctorName)}${a.reason ? ' · ' + esc(a.reason) : ''}${a.phone ? ' · ' + esc(a.phone) : ''}</div>
        ${manage && open ? `<div class="d-flex flex-wrap gap-1 mt-2">
          <button class="btn btn-sm btn-success a-act" data-act="checkin" data-id="${esc(a.id)}"><i class="bi bi-person-check me-1"></i>Check in</button>
          <button class="btn btn-sm btn-outline-danger a-act" data-act="no_show" data-id="${esc(a.id)}">No-show</button>
          <button class="btn btn-sm btn-outline-secondary a-act" data-act="cancelled" data-id="${esc(a.id)}">Cancel</button></div>` : ''}</div>
      <span class="badge ${STATUS_TINT[a.status] || 'text-bg-light'}">${esc(Clinic.APPT_STATUS[a.status] || a.status)}</span></div>`;
  }).join('');
  const booked = list.filter((a) => a.status === 'booked').length;
  $el.find('.a-body').html(`
    <div class="d-flex flex-wrap gap-2 mb-3 align-items-center">
      <div class="stat-card px-3 py-2 small"><b class="fs-5" data-count="${list.length}">0</b> appointments</div>
      <div class="stat-card px-3 py-2 small"><b class="fs-5" data-count="${booked}">0</b> still to come</div>
    </div>
    <div class="list-card">${rows || UI.emptyState(`No appointments on ${fmtDate(state.date)}`, 'calendar2-week')}</div>`);
  UI.countUp($el[0], (v) => String(Math.round(v)));
}

export default {
  async render(el) {
    this.destroy();
    const $el = $(el);
    const state = { date: today(), doctorId: '' };
    const doctors = (await idb.getAll('doctors')).filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name));
    $el.html(UI.pageHeader('Appointments', Auth.can('appointment.manage') ? '<button class="btn btn-primary btn-sm ap-book"><i class="bi bi-plus-lg me-1"></i>Book</button>' : '') + `
      <div class="filters">
        <div><label class="form-label small mb-0">Date</label><input type="date" class="form-control form-control-sm ap-date" value="${esc(state.date)}"></div>
        <div><label class="form-label small mb-0">Doctor</label><select class="form-select form-select-sm ap-doc"><option value="">All doctors</option>
          ${doctors.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></div>
        <div class="d-flex align-items-end gap-1" style="flex:0 0 auto"><button class="btn btn-outline-secondary btn-sm ap-today">Today</button></div>
      </div>
      <div class="a-body"></div>`);
    await renderDay(el, $el, state);

    $el.on('change', '.ap-date', (e) => { state.date = e.currentTarget.value || today(); renderDay(el, $el, state); });
    $el.on('change', '.ap-doc', (e) => { state.doctorId = e.currentTarget.value; renderDay(el, $el, state); });
    $el.on('click', '.ap-today', () => { state.date = today(); $el.find('.ap-date').val(state.date); renderDay(el, $el, state); });
    $el.on('click', '.ap-book', async () => {
      try {
        const saved = await openBooking(state.date);
        if (saved) {
          UI.toast(`Booked ${saved.patientName} at ${saved.time}`);
          if (saved.date !== state.date) { state.date = saved.date; $el.find('.ap-date').val(state.date); }
          renderDay(el, $el, state);
        }
      } catch (e) { UI.toastError(e); }
    });
    $el.on('click', '.a-act', async (e) => {
      const { id, act } = e.currentTarget.dataset;
      try {
        if (act === 'checkin') {
          const a = await idb.get('appointments', id);
          const tok = await Clinic.issueToken({ doctorId: a.doctorId, patientId: a.patientId, appointmentId: id });
          UI.toast(`Checked in. Token ${tok.label} issued.`);
        } else {
          const label = act === 'no_show' ? 'Mark as no-show?' : 'Cancel this appointment?';
          if (!(await UI.confirmDialog(label, { okLabel: 'Yes', okClass: act === 'cancelled' ? 'btn-danger' : 'btn-primary' }))) return;
          await Clinic.setAppointmentStatus(id, act);
          UI.toast('Appointment updated');
        }
      } catch (err) { UI.toastError(err); }
    });
    this._h = () => { if (location.hash.startsWith('#/appointments')) renderDay(el, $el, state); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
