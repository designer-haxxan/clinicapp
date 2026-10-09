// Clinic operations: doctors, patients, services, tokens, appointments, bills, payments, payouts, expenses
// and the figures derived from them. Every write runs in ONE IndexedDB transaction (all or nothing), writes an
// audit record and then notifies the UI with a `data:changed` event.
import * as idb from '../db/idb.js';
import { AppError, uuid, nowISO, today, round2, num, clean, lc, localDate } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import * as Auth from './auth.js';

export const MODES = { cash: 'Cash', card: 'Card', bank: 'Bank transfer', credit: 'Credit (pay later)' };
export const GENDERS = { F: 'Female', M: 'Male', O: 'Other' };
export const SERVICE_CATEGORIES = { consultation: 'Consultation', lab: 'Lab test', procedure: 'Procedure', medicine: 'Medicine', other: 'Other' };
export const EXPENSE_CATEGORIES = { rent: 'Rent', salaries: 'Salaries', utilities: 'Utilities', supplies: 'Medical supplies', maintenance: 'Maintenance', other: 'Other' };
export const TOKEN_STATUS = {
  waiting: 'Waiting', called: 'Called', in_consult: 'With doctor', done: 'Done', cancelled: 'Cancelled',
};
export const APPT_STATUS = { booked: 'Booked', arrived: 'Checked in', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' };

const TOKEN_NEXT = {
  waiting: ['called', 'cancelled'],
  called: ['in_consult', 'waiting', 'cancelled'],
  in_consult: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};
const TOKEN_TIME = { called: 'calledAt', in_consult: 'startedAt', done: 'doneAt' };
export const ACTIVE_TOKEN = ['waiting', 'called', 'in_consult'];

const notify = () => document.dispatchEvent(new CustomEvent('data:changed'));
const audit = (t, action, detail) => t.put('auditLog', { id: uuid(), at: nowISO(), by: Auth.user()?.username || '', action, detail });
const money2 = (n) => round2(Math.max(0, n));
export const tokenLabel = (n) => `T-${String(n).padStart(3, '0')}`;
const billNumber = (n) => `BILL-${String(n).padStart(6, '0')}`;

async function nextCounter(t, key) {
  const n = ((await t.get('meta', key))?.value || 0) + 1;
  await t.put('meta', { key, value: n });
  return n;
}

function requireDate(d, label = 'Date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) throw new AppError(`${label} is not valid.`);
  return d;
}

// ---------- Doctors ----------
export async function saveDoctor(data, id = null) {
  Auth.require('doctor.manage');
  const name = clean(data.name, 80);
  if (!name) throw new AppError('Doctor name is required.');
  const sharePct = num(data.sharePct, NaN);
  if (!(sharePct >= 0 && sharePct <= 100)) throw new AppError('Doctor share must be between 0 and 100%.');
  const fee = num(data.fee, 0);
  if (fee < 0) throw new AppError('Consultation fee cannot be negative.');
  const now = nowISO();
  const row = await idb.write(['doctors', 'auditLog'], async (t) => {
    const existing = id ? await t.get('doctors', id) : null;
    if (id && !existing) throw new AppError('Doctor not found.');
    const r = {
      ...(existing || {}), id: id || uuid(), name, nameLc: lc(name),
      specialty: clean(data.specialty, 80), phone: clean(data.phone, 30),
      sharePct: round2(sharePct), fee: round2(fee), active: data.active !== false,
      createdAt: existing?.createdAt || now, updatedAt: now,
    };
    await t.put('doctors', r);
    await audit(t, existing ? 'doctor.update' : 'doctor.create', name);
    return r;
  });
  notify();
  return row;
}

// Earned = sum of doctor shares on active bills; paid = payouts. Balance = what the clinic still owes.
export async function doctorBalance(doctorId) {
  const [bills, payouts] = await idb.read(['bills', 'payouts'], (t) => Promise.all([
    t.getAllByIndex('bills', 'doctorId', doctorId), t.getAllByIndex('payouts', 'doctorId', doctorId),
  ]));
  const earned = round2(bills.filter((b) => b.status !== 'void').reduce((s, b) => s + b.doctorShare, 0));
  const paid = round2(payouts.reduce((s, p) => s + p.amount, 0));
  return { earned, paid, balance: round2(earned - paid) };
}

export async function payDoctor(doctorId, { amount, mode = 'cash', note = '', date = today() }) {
  Auth.require('payout.create');
  requireDate(date);
  const amt = round2(num(amount, 0));
  if (!(amt > 0)) throw new AppError('Enter an amount greater than zero.');
  if (!MODES[mode]) throw new AppError('Choose a payment mode.');
  const row = await idb.write(['doctors', 'bills', 'payouts', 'auditLog'], async (t) => {
    const doctor = await t.get('doctors', doctorId);
    if (!doctor) throw new AppError('Doctor not found.');
    const bills = await t.getAllByIndex('bills', 'doctorId', doctorId);
    const payouts = await t.getAllByIndex('payouts', 'doctorId', doctorId);
    const earned = bills.filter((b) => b.status !== 'void').reduce((s, b) => s + b.doctorShare, 0);
    const paid = payouts.reduce((s, p) => s + p.amount, 0);
    const balance = round2(earned - paid);
    if (amt > balance + 0.004) throw new AppError(`Amount is more than the balance due (${round2(balance)}).`);
    const p = { id: uuid(), date, doctorId, doctorName: doctor.name, amount: amt, mode, note: clean(note, 200), createdAt: nowISO() };
    await t.put('payouts', p);
    await audit(t, 'payout.create', `${doctor.name}: ${amt}`);
    return p;
  });
  notify();
  return row;
}

// ---------- Patients ----------
export async function savePatient(data, id = null) {
  Auth.require('patient.edit');
  const name = clean(data.name, 80);
  if (!name) throw new AppError('Patient name is required.');
  const age = data.age === '' || data.age == null ? null : num(data.age, NaN);
  if (age !== null && !(age >= 0 && age <= 130)) throw new AppError('Age must be between 0 and 130.');
  const gender = GENDERS[data.gender] ? data.gender : '';
  const now = nowISO();
  const row = await idb.write(['patients', 'auditLog'], async (t) => {
    const existing = id ? await t.get('patients', id) : null;
    if (id && !existing) throw new AppError('Patient not found.');
    const r = {
      ...(existing || {}), id: id || uuid(), name, nameLc: lc(name), phone: clean(data.phone, 30),
      age, gender, address: clean(data.address, 200), createdAt: existing?.createdAt || now, updatedAt: now,
    };
    await t.put('patients', r);
    await audit(t, existing ? 'patient.update' : 'patient.create', name);
    return r;
  });
  notify();
  return row;
}

// ---------- Services & fees ----------
export async function saveService(data, id = null) {
  Auth.require('fee.manage');
  const name = clean(data.name, 120);
  if (!name) throw new AppError('Service name is required.');
  if (!SERVICE_CATEGORIES[data.category]) throw new AppError('Choose a category.');
  const price = num(data.price, NaN);
  if (!(price >= 0)) throw new AppError('Price must be zero or more.');
  const now = nowISO();
  const row = await idb.write(['services', 'auditLog'], async (t) => {
    const existing = id ? await t.get('services', id) : null;
    if (id && !existing) throw new AppError('Service not found.');
    const r = {
      ...(existing || {}), id: id || uuid(), name, nameLc: lc(name), category: data.category,
      price: round2(price), active: data.active !== false, createdAt: existing?.createdAt || now, updatedAt: now,
    };
    await t.put('services', r);
    await audit(t, existing ? 'service.update' : 'service.create', name);
    return r;
  });
  notify();
  return row;
}

// ---------- Appointments ----------
export async function saveAppointment(data) {
  Auth.require('appointment.manage');
  requireDate(data.date, 'Appointment date');
  if (!/^\d{2}:\d{2}$/.test(String(data.time || ''))) throw new AppError('Choose a time.');
  if (!data.doctorId) throw new AppError('Choose a doctor.');
  if (!data.patientId) throw new AppError('Choose a patient.');
  const now = nowISO();
  const row = await idb.write(['doctors', 'patients', 'appointments', 'auditLog'], async (t) => {
    const doctor = await t.get('doctors', data.doctorId);
    const patient = await t.get('patients', data.patientId);
    if (!doctor || !patient) throw new AppError('Doctor or patient not found.');
    const r = {
      id: uuid(), date: data.date, time: data.time, doctorId: doctor.id, doctorName: doctor.name,
      patientId: patient.id, patientName: patient.name, phone: patient.phone || '',
      reason: clean(data.reason, 200), status: 'booked', tokenId: null, createdAt: now, updatedAt: now,
    };
    await t.put('appointments', r);
    await audit(t, 'appointment.create', `${patient.name} with ${doctor.name} on ${data.date} ${data.time}`);
    return r;
  });
  notify();
  return row;
}

export async function setAppointmentStatus(id, status) {
  Auth.require('appointment.manage');
  if (!['booked', 'no_show', 'cancelled'].includes(status)) throw new AppError('Invalid status.');
  const row = await idb.write(['appointments', 'auditLog'], async (t) => {
    const a = await t.get('appointments', id);
    if (!a) throw new AppError('Appointment not found.');
    if (a.status === 'arrived' || a.status === 'completed') throw new AppError('This patient has already checked in.');
    const r = { ...a, status, updatedAt: nowISO() };
    await t.put('appointments', r);
    await audit(t, 'appointment.status', `${a.patientName}: ${status}`);
    return r;
  });
  notify();
  return row;
}

// ---------- Tokens (queue) ----------
// Issues today's token for a doctor. If it comes from an appointment, the appointment is marked checked in.
export async function issueToken({ doctorId, patientId, appointmentId = null }) {
  Auth.require('token.manage');
  const date = today();
  const row = await idb.write(['doctors', 'patients', 'tokens', 'appointments', 'auditLog'], async (t) => {
    const doctor = await t.get('doctors', doctorId);
    if (!doctor || !doctor.active) throw new AppError('Choose an active doctor.');
    const patient = await t.get('patients', patientId);
    if (!patient) throw new AppError('Choose a patient.');
    const seq = (await t.getAllByIndex('tokens', 'date', date)).length + 1;
    const token = {
      id: uuid(), date, number: seq, label: tokenLabel(seq), doctorId: doctor.id, doctorName: doctor.name,
      patientId: patient.id, patientName: patient.name, appointmentId, billId: null, status: 'waiting',
      createdAt: nowISO(), calledAt: null, startedAt: null, doneAt: null,
    };
    await t.put('tokens', token);
    if (appointmentId) {
      const a = await t.get('appointments', appointmentId);
      if (a) await t.put('appointments', { ...a, status: 'arrived', tokenId: token.id, updatedAt: nowISO() });
    }
    await audit(t, 'token.issue', `${token.label} · ${doctor.name} · ${patient.name}`);
    return token;
  });
  notify();
  return row;
}

export async function setTokenStatus(id, status) {
  Auth.require('token.manage');
  const row = await idb.write(['tokens', 'auditLog'], async (t) => {
    const tok = await t.get('tokens', id);
    if (!tok) throw new AppError('Token not found.');
    if (!TOKEN_NEXT[tok.status]?.includes(status)) throw new AppError(`A ${TOKEN_STATUS[tok.status].toLowerCase()} token cannot change to ${TOKEN_STATUS[status].toLowerCase()}.`);
    const now = nowISO();
    const r = { ...tok, status };
    if (TOKEN_TIME[status]) r[TOKEN_TIME[status]] = now;
    await t.put('tokens', r);
    await audit(t, 'token.status', `${tok.label}: ${status}`);
    return r;
  });
  notify();
  return row;
}

// ---------- Bills ----------
// items: [{ serviceId, name, category, qty, rate }]. Doctor share is taken from the doctor's percentage at billing time.
export async function createBill({ patientId, doctorId, tokenId = null, items, discount = 0, paid = 0, mode = 'cash', date = today() }) {
  Auth.require('bill.create');
  requireDate(date);
  if (!patientId) throw new AppError('Choose a patient.');
  if (!doctorId) throw new AppError('Choose the doctor.');
  if (!Array.isArray(items) || !items.length) throw new AppError('Add at least one service.');
  if (!MODES[mode]) throw new AppError('Choose a payment mode.');

  const lines = items.map((i) => {
    const qty = Math.max(1, Math.round(num(i.qty, 1)));
    const rate = money2(num(i.rate, 0));
    return { serviceId: i.serviceId || null, name: clean(i.name, 120), category: i.category || 'other', qty, rate, amount: round2(qty * rate) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (!(subtotal > 0)) throw new AppError('The bill total must be more than zero.');
  const disc = round2(Math.min(subtotal, money2(num(discount, 0))));
  const total = round2(subtotal - disc);
  const paidAmt = round2(Math.min(total, money2(num(paid, 0))));
  const due = round2(total - paidAmt);

  const bill = await idb.write(['patients', 'doctors', 'tokens', 'bills', 'payments', 'meta', 'auditLog'], async (t) => {
    const patient = await t.get('patients', patientId);
    const doctor = await t.get('doctors', doctorId);
    if (!patient) throw new AppError('Patient not found.');
    if (!doctor) throw new AppError('Doctor not found.');
    const token = tokenId ? await t.get('tokens', tokenId) : null;
    if (tokenId && !token) throw new AppError('Token not found.');
    if (token?.billId) throw new AppError('This token has already been billed.');

    const n = await nextCounter(t, 'counter.bill');
    const doctorShare = round2(total * doctor.sharePct / 100);
    const row = {
      id: uuid(), number: billNumber(n), date, createdAt: nowISO(),
      patientId: patient.id, patientName: patient.name, doctorId: doctor.id, doctorName: doctor.name,
      tokenId: token?.id || null, items: lines, subtotal, discount: disc, total,
      paid: paidAmt, due, doctorSharePct: doctor.sharePct, doctorShare, clinicShare: round2(total - doctorShare),
      status: 'active', by: Auth.user()?.username || '',
    };
    await t.put('bills', row);
    if (paidAmt > 0) await t.put('payments', { id: uuid(), billId: row.id, date, amount: paidAmt, mode, kind: 'payment', createdAt: nowISO() });
    if (token) {
      const r = { ...token, billId: row.id };
      if (token.status !== 'done' && token.status !== 'cancelled') { r.status = 'done'; r.doneAt = nowISO(); }
      await t.put('tokens', r);
    }
    await audit(t, 'bill.create', `${row.number} · ${patient.name} · ${doctor.name} · ${total}`);
    return row;
  });
  notify();
  return bill;
}

export async function collectDue(billId, { amount, mode = 'cash' }) {
  Auth.require('payment.collect');
  const amt = round2(num(amount, 0));
  if (!(amt > 0)) throw new AppError('Enter an amount greater than zero.');
  if (!MODES[mode]) throw new AppError('Choose a payment mode.');
  const row = await idb.write(['bills', 'payments', 'auditLog'], async (t) => {
    const b = await t.get('bills', billId);
    if (!b || b.status === 'void') throw new AppError('Bill not found.');
    if (amt > b.due + 0.004) throw new AppError(`Amount is more than the amount due (${b.due}).`);
    const r = { ...b, paid: round2(b.paid + amt), due: round2(b.due - amt) };
    await t.put('bills', r);
    await t.put('payments', { id: uuid(), billId, date: today(), amount: amt, mode, kind: 'payment', createdAt: nowISO() });
    await audit(t, 'bill.collect', `${b.number}: ${amt}`);
    return r;
  });
  notify();
  return row;
}

export async function voidBill(billId, reason) {
  Auth.require('bill.void');
  const why = clean(reason, 200);
  if (!why) throw new AppError('Give a reason for voiding the bill.');
  const row = await idb.write(['bills', 'auditLog'], async (t) => {
    const b = await t.get('bills', billId);
    if (!b) throw new AppError('Bill not found.');
    if (b.status === 'void') throw new AppError('This bill is already void.');
    const r = { ...b, status: 'void', voidReason: why, voidedAt: nowISO() };
    await t.put('bills', r);
    await audit(t, 'bill.void', `${b.number}: ${why}`);
    return r;
  });
  notify();
  return row;
}

// ---------- Expenses ----------
export async function saveExpense(data, id = null) {
  Auth.require('expense.manage');
  requireDate(data.date, 'Expense date');
  const title = clean(data.title, 120);
  if (!title) throw new AppError('Describe the expense.');
  const amount = num(data.amount, NaN);
  if (!(amount > 0)) throw new AppError('Amount must be more than zero.');
  if (!EXPENSE_CATEGORIES[data.category]) throw new AppError('Choose a category.');
  const row = await idb.write(['expenses', 'auditLog'], async (t) => {
    const existing = id ? await t.get('expenses', id) : null;
    const r = { ...(existing || {}), id: id || uuid(), date: data.date, title, category: data.category, amount: round2(amount), note: clean(data.note, 200), createdAt: existing?.createdAt || nowISO() };
    await t.put('expenses', r);
    await audit(t, existing ? 'expense.update' : 'expense.create', `${title}: ${amount}`);
    return r;
  });
  notify();
  return row;
}

export async function deleteExpense(id) {
  Auth.require('expense.manage');
  await idb.write(['expenses', 'auditLog'], async (t) => {
    const e = await t.get('expenses', id);
    if (!e) return;
    await t.delete('expenses', id);
    await audit(t, 'expense.delete', `${e.title}: ${e.amount}`);
  });
  notify();
}

// ---------- Reads & figures ----------
// Loads every record dated between from and to (inclusive, YYYY-MM-DD).
export async function loadRange(from, to) {
  const r = IDBKeyRange.bound(from, to);
  const [bills, payments, tokens, appointments, expenses, payouts, patients, doctors] = await idb.read(
    ['bills', 'payments', 'tokens', 'appointments', 'expenses', 'payouts', 'patients', 'doctors'],
    (t) => Promise.all([
      t.getAllByIndex('bills', 'date', r), t.getAllByIndex('payments', 'date', r), t.getAllByIndex('tokens', 'date', r),
      t.getAllByIndex('appointments', 'date', r), t.getAllByIndex('expenses', 'date', r), t.getAllByIndex('payouts', 'date', r),
      t.getAll('patients'), t.getAll('doctors'),
    ]),
  );
  return { from, to, bills, payments, tokens, appointments, expenses, payouts, patients, doctors };
}

// Pure summary of loadRange() output. Voided bills and their payments are excluded.
export function summarize(d) {
  const live = d.bills.filter((b) => b.status !== 'void');
  const voidIds = new Set(d.bills.filter((b) => b.status === 'void').map((b) => b.id));
  const pays = d.payments.filter((p) => !voidIds.has(p.billId));
  const sum = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));

  const byMode = {};
  for (const p of pays) byMode[p.mode] = round2((byMode[p.mode] || 0) + p.amount);

  const doctors = new Map();
  for (const doc of d.doctors) doctors.set(doc.id, { id: doc.id, name: doc.name, patients: new Set(), bills: 0, billed: 0, doctorShare: 0, clinicShare: 0, collected: 0 });
  const get = (id, name) => {
    if (!doctors.has(id)) doctors.set(id, { id, name, patients: new Set(), bills: 0, billed: 0, doctorShare: 0, clinicShare: 0, collected: 0 });
    return doctors.get(id);
  };
  for (const b of live) {
    const x = get(b.doctorId, b.doctorName);
    x.patients.add(b.patientId); x.bills++; x.billed += b.total; x.doctorShare += b.doctorShare; x.clinicShare += b.clinicShare;
  }
  for (const p of pays) {
    const bill = d.bills.find((b) => b.id === p.billId);
    if (bill && bill.status !== 'void') get(bill.doctorId, bill.doctorName).collected += p.amount;
  }

  const services = new Map();
  for (const b of live) for (const l of b.items) {
    const s = services.get(l.name) || { name: l.name, qty: 0, amount: 0 };
    s.qty += l.qty; s.amount += l.amount; services.set(l.name, s);
  }

  const patientIds = new Set([...live.map((b) => b.patientId), ...d.tokens.map((t) => t.patientId)]);
  const expenses = sum(d.expenses, (e) => e.amount);
  const payouts = sum(d.payouts, (p) => p.amount);
  const billed = sum(live, (b) => b.total);
  const collected = sum(pays, (p) => p.amount);
  const clinicShare = sum(live, (b) => b.clinicShare);

  return {
    bills: live.length,
    voided: voidIds.size,
    billed,
    discount: sum(live, (b) => b.discount),
    collected,
    outstanding: sum(live, (b) => b.due),
    doctorShare: sum(live, (b) => b.doctorShare),
    clinicShare,
    expenses,
    payouts,
    netClinic: round2(clinicShare - expenses),
    cashFlow: round2(collected - expenses - payouts),
    patients: patientIds.size,
    byMode,
    doctors: [...doctors.values()].filter((x) => x.bills || x.collected).sort((a, b) => b.billed - a.billed),
    services: [...services.values()].sort((a, b) => b.amount - a.amount),
    tokens: {
      issued: d.tokens.length,
      done: d.tokens.filter((t) => t.status === 'done').length,
      waiting: d.tokens.filter((t) => ACTIVE_TOKEN.includes(t.status)).length,
      cancelled: d.tokens.filter((t) => t.status === 'cancelled').length,
    },
    appointments: {
      total: d.appointments.length,
      arrived: d.appointments.filter((a) => ['arrived', 'completed'].includes(a.status)).length,
      noShow: d.appointments.filter((a) => a.status === 'no_show').length,
      booked: d.appointments.filter((a) => a.status === 'booked').length,
    },
    daily: dailyTotals(d.from, d.to, live, pays),
  };
}

// Totals for each day of the range (used by the charts). Ranges longer than 62 days return no daily series.
function dailyTotals(from, to, bills, pays) {
  const start = new Date(from + 'T00:00:00'); const end = new Date(to + 'T00:00:00');
  const days = Math.round((end - start) / 86400000) + 1;
  if (!(days > 0 && days <= 62)) return [];
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = localDate(d);
    out.push({
      date: key,
      billed: round2(bills.filter((b) => b.date === key).reduce((s, b) => s + b.total, 0)),
      patients: new Set(bills.filter((b) => b.date === key).map((b) => b.patientId)).size,
      collected: round2(pays.filter((p) => p.date === key).reduce((s, p) => s + p.amount, 0)),
      bills: bills.filter((b) => b.date === key).length,
    });
  }
  return out;
}

// ---------- Export helpers ----------
export const settingsSnapshot = () => getSettings();
