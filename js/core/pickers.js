// Searchable pickers for patients and doctors, used by reception, appointments and billing.
import * as UI from './ui.js';
import { lc, fmtNum } from './utils.js';
import * as idb from '../db/idb.js';
import { cur } from './views.js';

const byName = (a, b) => a.name.localeCompare(b.name);

// Resolves to the chosen patient row, or undefined if cancelled. openForm() creates a new patient (returns the row).
export function pickPatient(openForm = null) {
  return UI.pick({
    title: 'Choose patient',
    placeholder: 'Name or phone number',
    addNew: openForm ? { label: 'New patient', create: async () => { const p = await openForm(); return p ? { value: p } : undefined; } } : null,
    search: async (q) => {
      const s = lc(q); const digits = String(q || '').replace(/\D/g, '');
      const all = await idb.getAll('patients');
      return all
        .filter((p) => !s || p.nameLc.includes(s) || (digits && String(p.phone || '').replace(/\D/g, '').includes(digits)))
        .sort(byName).slice(0, 60)
        .map((p) => ({
          id: p.id, title: p.name,
          subtitle: [p.phone, p.age != null ? `${p.age} yrs` : '', p.gender ? p.gender : ''].filter(Boolean).join(' · '),
          value: p,
        }));
    },
  }).then((r) => r?.value);
}

// Resolves to the chosen active doctor row, or undefined.
export function pickDoctor() {
  return UI.pick({
    title: 'Choose doctor',
    placeholder: 'Doctor name or specialty',
    search: async (q) => {
      const s = lc(q);
      const all = await idb.getAll('doctors');
      return all
        .filter((d) => d.active && (!s || d.nameLc.includes(s) || lc(d.specialty).includes(s)))
        .sort(byName)
        .map((d) => ({ id: d.id, title: d.name, subtitle: d.specialty || 'General', right: `${d.sharePct}% share`, value: d }));
    },
  }).then((r) => r?.value);
}

// Resolves to the chosen service row (with a qty default), or undefined.
export function pickService() {
  return UI.pick({
    title: 'Add service',
    placeholder: 'Search services',
    search: async (q) => {
      const s = lc(q);
      const all = await idb.getAll('services');
      return all
        .filter((x) => x.active && (!s || x.nameLc.includes(s)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => ({ id: x.id, title: x.name, subtitle: x.category, right: `${cur()} ${fmtNum(x.price)}`, value: x }));
    },
  }).then((r) => r?.value);
}
