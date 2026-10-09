// Backup & restore: one versioned JSON file with a SHA-256 checksum over the data.
// Import validates everything before any data changes, and Replace runs in one transaction.
import { CONFIG } from '../config.js';
import * as idb from '../db/idb.js';
import { DATA_STORES, DB_VERSION } from '../db/schema.js';
import { AppError, nowISO } from '../core/utils.js';
import { getSettings, replaceSettings } from '../core/settings.js';
import * as Auth from './auth.js';

export const BACKUP_FORMAT = 'clinicpro-backup';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Reads every data store and returns the backup text (no credentials are included).
export async function exportBackup() {
  Auth.require('backup.export');
  const data = {};
  await idb.read(DATA_STORES, async (t) => {
    for (const name of DATA_STORES) data[name] = await t.getAll(name);
  });
  const counts = Object.fromEntries(DATA_STORES.map((n) => [n, data[n].length]));
  const checksum = await sha256(JSON.stringify(data));
  const header = {
    format: BACKUP_FORMAT, backupVersion: CONFIG.BACKUP_VERSION, appVersion: CONFIG.APP_VERSION,
    schemaVersion: DB_VERSION, createdAt: nowISO(), createdBy: Auth.user()?.username || '', counts, checksum,
  };
  return JSON.stringify({ ...header, settings: getSettings(), data }, null, 2);
}

// Parses and checks a backup file. Returns { header, data, settings } or throws a readable error.
export async function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new AppError('This file is not valid JSON.'); }
  if (obj?.format !== BACKUP_FORMAT) throw new AppError('This is not a ClinicPro backup file.');
  if (obj.backupVersion !== CONFIG.BACKUP_VERSION) throw new AppError(`Unsupported backup version (${obj.backupVersion}).`);
  if (!obj.data || typeof obj.data !== 'object') throw new AppError('The backup has no data.');
  for (const name of DATA_STORES) {
    if (!Array.isArray(obj.data[name])) throw new AppError(`Backup is missing "${name}".`);
    if (obj.counts?.[name] !== obj.data[name].length) throw new AppError(`Record count for "${name}" does not match the header (the file may be cut off).`);
  }
  if ((await sha256(JSON.stringify(obj.data))) !== obj.checksum) throw new AppError('Checksum mismatch: the backup was changed or damaged.');
  for (const b of obj.data.bills) if (!b.id || !b.number) throw new AppError('A bill in the backup is missing its id or number.');
  const ids = new Set(obj.data.bills.map((b) => b.number));
  if (ids.size !== obj.data.bills.length) throw new AppError('The backup contains duplicate bill numbers.');
  return { header: obj, data: obj.data, settings: obj.settings || null };
}

// Replaces ALL local data with the backup, in one transaction.
export async function replaceFromBackup(parsed) {
  Auth.require('backup.export');
  await idb.write(DATA_STORES, async (t) => {
    for (const name of DATA_STORES) {
      await t.clear(name);
      for (const row of parsed.data[name]) await t.put(name, row);
    }
    await t.put('auditLog', { id: `restore-${Date.now()}`, at: nowISO(), by: Auth.user()?.username || '', action: 'backup.restore', detail: `Restored backup from ${parsed.header.createdAt}` });
  });
  if (parsed.settings) replaceSettings(parsed.settings);
  document.dispatchEvent(new CustomEvent('data:changed'));
}
