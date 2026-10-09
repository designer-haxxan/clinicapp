// Settings: clinic profile for bills and reports, defaults, appearance, account and storage.
import { CONFIG } from '../config.js';
import * as UI from '../core/ui.js';
import { esc, num, fmtDateTime } from '../core/utils.js';
import { getSettings, saveSettings } from '../core/settings.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

function section(title, icon, body) {
  return `<div class="card mb-3"><div class="card-body"><h2 class="h6 mb-3"><i class="bi bi-${icon} me-2"></i>${title}</h2>${body}</div></div>`;
}

export default {
  async render(el) {
    const $el = $(el).off();
    const s = getSettings();
    const u = Auth.user();
    const manage = Auth.can('settings.manage');
    const ro = manage ? '' : 'disabled';
    $el.html(UI.pageHeader('Settings') + `<div class="row g-3"><div class="col-lg-6">
      ${section('Clinic profile', 'hospital', `<form class="f-clinic row g-2">
        <div class="col-12"><label class="form-label">Clinic name</label><input name="name" class="form-control" value="${esc(s.clinic.name)}" ${ro}></div>
        <div class="col-12"><label class="form-label">Address</label><input name="address" class="form-control" value="${esc(s.clinic.address)}" ${ro}></div>
        <div class="col-6"><label class="form-label">Phone</label><input name="phone" class="form-control" value="${esc(s.clinic.phone)}" ${ro}></div>
        <div class="col-6"><label class="form-label">Registration no.</label><input name="regNo" class="form-control" value="${esc(s.clinic.regNo)}" ${ro}></div>
        <div class="col-8"><label class="form-label">Receipt footer</label><input name="footer" class="form-control" value="${esc(s.clinic.footer)}" ${ro}></div>
        <div class="col-4"><label class="form-label">Currency</label><input name="currency" class="form-control" maxlength="5" value="${esc(s.currency)}" ${ro}></div>
        ${manage ? '<div class="col-12"><button class="btn btn-primary">Save</button></div>' : ''}</form>`)}
      ${section('Defaults', 'sliders', `<form class="f-defaults row g-2">
        <div class="col-12"><label class="form-label">Default doctor share of each bill (%)</label><input name="defaultSharePct" class="form-control" inputmode="decimal" value="${s.defaultSharePct}" ${ro}>
          <div class="form-text">Used when you add a new doctor. Each doctor's own share can be changed on their record.</div></div>
        ${manage ? '<div class="col-12"><button class="btn btn-primary">Save</button></div>' : ''}</form>`)}
      ${section('Appearance', 'palette', `<select class="form-select f-theme"><option value="auto">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select>`)}
    </div><div class="col-lg-6">
      ${section('My account', 'person-circle', `<div class="mb-2"><b>${esc(u.username)}</b><div class="small text-body-secondary">${esc(Auth.ROLES[u.role] || u.role)}</div></div>
        <div class="small">Session valid until <b>${esc(fmtDateTime(new Date(Auth.expiresAt()).toISOString()))}</b>. After that, sign in again while online.</div>
        <div class="small mt-1">Device ID: <code class="user-select-all">${esc(Auth.deviceId())}</code></div>
        <div class="form-text">This account is linked to this device. To move it to another phone or change the password, call ${esc(CONFIG.SUPPORT_PHONE)}.</div>`)}
      ${section('App & data', 'phone', `<div class="small mb-2">Version ${esc(CONFIG.APP_VERSION)} · <span class="storage-info">checking storage…</span></div>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-secondary btn-install d-none"><i class="bi bi-download me-1"></i>Install app</button>
        </div>
        <div class="small text-body-secondary mt-3 ios-hint d-none">On iPhone/iPad: tap <i class="bi bi-box-arrow-up"></i> Share → <b>Add to Home Screen</b> to install.</div>`)}
    </div></div>`);

    $el.find('.f-theme').val(s.theme).on('change', function () { saveSettings({ theme: this.value }); });
    $el.on('submit', '.f-clinic', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target).entries());
      if (!v.name.trim()) return UI.toast('Clinic name is required', 'warning');
      saveSettings({ clinic: { name: v.name.trim(), address: v.address.trim(), phone: v.phone.trim(), regNo: v.regNo.trim(), footer: v.footer.trim() }, currency: v.currency.trim() || 'Rs' });
      UI.toast('Clinic profile saved');
    });
    $el.on('submit', '.f-defaults', (e) => {
      e.preventDefault();
      const v = num(new FormData(e.target).get('defaultSharePct'), NaN);
      if (!(v >= 0 && v <= 100)) return UI.toast('Share must be between 0 and 100', 'warning');
      saveSettings({ defaultSharePct: v });
      UI.toast('Defaults saved');
    });
    const { canInstall, promptInstall } = await import('../app.js');
    if (canInstall()) $el.find('.btn-install').removeClass('d-none').on('click', promptInstall);
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) $el.find('.ios-hint').removeClass('d-none');
    if (navigator.storage?.estimate) {
      const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false]);
      $el.find('.storage-info').text(`${(est.usage / 1048576).toFixed(1)} MB used · storage ${persisted ? 'persistent' : 'best-effort (may be cleared by the browser under pressure)'}`);
    } else $el.find('.storage-info').text('');
  },
  destroy() {},
};
