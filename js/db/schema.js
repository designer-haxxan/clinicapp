// IndexedDB schema definition and migrations.
import { CONFIG } from '../config.js';

export const DB_NAME = `${CONFIG.APP_ID}_clinic`;
export const DB_VERSION = 1;

// Stores that make up the clinic data (included in backups).
export const DATA_STORES = [
  'doctors', 'patients', 'services', 'tokens', 'appointments',
  'bills', 'payments', 'payouts', 'expenses', 'auditLog', 'meta',
];

const STORES = {
  meta: { keyPath: 'key', indexes: {} },
  doctors: { indexes: { nameLc: 'nameLc' } },
  patients: { indexes: { nameLc: 'nameLc', phone: 'phone' } },
  services: { indexes: { nameLc: 'nameLc', category: 'category' } },
  tokens: { indexes: { date: 'date', doctorId: 'doctorId', patientId: 'patientId' } },
  appointments: { indexes: { date: 'date', doctorId: 'doctorId', patientId: 'patientId' } },
  bills: { indexes: { number: ['number', true], date: 'date', doctorId: 'doctorId', patientId: 'patientId' } },
  payments: { indexes: { date: 'date', billId: 'billId' } },
  payouts: { indexes: { date: 'date', doctorId: 'doctorId' } },
  expenses: { indexes: { date: 'date' } },
  auditLog: { indexes: { at: 'at' } },
};

export function upgrade(db, oldVersion, t) {
  if (oldVersion < 1) {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.createObjectStore(name, { keyPath: def.keyPath || 'id' });
      for (const [idx, spec] of Object.entries(def.indexes)) {
        const [keyPath, unique] = Array.isArray(spec) ? spec : [spec, false];
        os.createIndex(idx, keyPath, { unique: !!unique });
      }
    }
    t.objectStore('meta').put({ key: 'schemaVersion', value: 1 });
    t.objectStore('meta').put({ key: 'createdAt', value: new Date().toISOString() });
  }
  // Future migrations: if (oldVersion < 2) { ... }
}
