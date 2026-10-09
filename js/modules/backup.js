// Backup & restore page: download a checksummed backup, or restore one after checking its contents.
import * as UI from '../core/ui.js';
import { esc, fmtDateTime, downloadFile, nowISO, fmtNum } from '../core/utils.js';
import { pref } from '../core/settings.js';
import { DATA_STORES } from '../db/schema.js';
import * as Auth from '../services/auth.js';
import * as Backup from '../services/backup.js';

const $ = window.jQuery;

const LABELS = {
  doctors: 'Doctors', patients: 'Patients', services: 'Services', tokens: 'Tokens', appointments: 'Appointments',
  bills: 'Bills', payments: 'Payments', payouts: 'Doctor payouts', expenses: 'Expenses', auditLog: 'Audit log', meta: 'Counters',
};

function counts(c) {
  return `<div class="table-responsive"><table class="table table-sm table-report mb-0"><tbody>
    ${DATA_STORES.filter((n) => n !== 'meta').map((n) => `<tr><td>${esc(LABELS[n] || n)}</td><td class="num">${fmtNum(c[n] || 0)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

export default {
  async render(el) {
    this.destroy();
    const $el = $(el).off();
    const canExport = Auth.can('backup.export');
    const last = pref.get('lastBackupAt');
    $el.html(UI.pageHeader('Backup & Restore') + `
      <div class="alert alert-warning small"><i class="bi bi-shield-exclamation me-1"></i>All patient and billing records live only on this device. Make a backup regularly and keep it somewhere safe. Backups contain patient information, so keep the file private.</div>
      <div class="row g-3">
        <div class="col-lg-6"><div class="card card-body h-100">
          <h2 class="h6"><i class="bi bi-cloud-arrow-down me-2"></i>Back up</h2>
          <p class="small text-body-secondary">Downloads one JSON file with every record. No passwords are included.</p>
          <div class="small mb-3">Last backup: <b>${last ? esc(fmtDateTime(last)) : 'never'}</b></div>
          <button class="btn btn-primary b-export" ${canExport ? '' : 'disabled'}><i class="bi bi-download me-1"></i>Download backup</button>
          ${canExport ? '' : '<div class="form-text">Only the clinic owner can make backups.</div>'}
        </div></div>
        <div class="col-lg-6"><div class="card card-body h-100">
          <h2 class="h6"><i class="bi bi-cloud-arrow-up me-2"></i>Restore</h2>
          <p class="small text-body-secondary">Choose a backup file. It is checked first, and nothing changes until you confirm. Restoring <b>replaces all data on this device</b>.</p>
          <input type="file" accept="application/json,.json" class="form-control b-file" ${canExport ? '' : 'disabled'}>
          <div class="b-preview mt-3"></div>
        </div></div>
      </div>`);

    $el.on('click', '.b-export', async () => {
      try {
        const text = await UI.withLoading(() => Backup.exportBackup(), 'Preparing backup…');
        const stamp = nowISO().slice(0, 16).replace(/[:T]/g, '-');
        downloadFile(`clinicpro-backup-${stamp}.json`, text, 'application/json');
        pref.set('lastBackupAt', nowISO());
        UI.toast('Backup downloaded');
        this.render(el);
      } catch (e) { UI.toastError(e); }
    });

    $el.on('change', '.b-file', async (e) => {
      const file = e.currentTarget.files?.[0];
      const $p = $el.find('.b-preview').empty();
      if (!file) return;
      try {
        const parsed = await Backup.parseBackup(await file.text());
        const h = parsed.header;
        $p.html(`<div class="alert alert-success small py-2">Backup is valid: created ${esc(fmtDateTime(h.createdAt))} by ${esc(h.createdBy || 'unknown')}.</div>
          ${counts(h.counts)}
          <form class="mt-3 b-confirm"><label class="form-label small">Type <b>REPLACE</b> to erase this device's data and load the backup</label>
            <div class="d-flex gap-2"><input class="form-control b-word" autocomplete="off" placeholder="REPLACE">
            <button class="btn btn-danger b-go" disabled>Restore</button></div></form>`);
        $p.find('.b-word').on('input', function () { $p.find('.b-go').prop('disabled', this.value !== 'REPLACE'); });
        $p.find('.b-confirm').on('submit', async (ev) => {
          ev.preventDefault();
          if ($p.find('.b-word').val() !== 'REPLACE') return;
          try {
            await UI.withLoading(() => Backup.replaceFromBackup(parsed), 'Restoring…');
            UI.toast('Backup restored');
            location.hash = '#/dashboard';
          } catch (err) { UI.toastError(err); }
        });
      } catch (err) {
        $p.html(`<div class="alert alert-danger small py-2">${esc(err.message || String(err))}</div>`);
      }
    });
  },
  destroy() {},
};
