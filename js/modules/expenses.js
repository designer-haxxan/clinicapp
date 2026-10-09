// Expenses: clinic running costs (rent, salaries, supplies). They reduce the clinic's net in the day-end report.
import * as UI from '../core/ui.js';
import * as idb from '../db/idb.js';
import { esc, fmtNum, fmtDate, today } from '../core/utils.js';
import { cur, bindDateFilter, dateFilter, rangeFor, pager } from '../core/views.js';
import * as Auth from '../services/auth.js';
import * as Clinic from '../services/clinic.js';

const $ = window.jQuery;

function openExpenseForm(e = null) {
  return UI.formModal({
    title: e ? 'Edit expense' : 'New expense',
    submitLabel: e ? 'Save changes' : 'Add expense',
    body: `<div class="row g-2">
      <div class="col-12"><label class="form-label">What was it for? *</label><input name="title" class="form-control" required value="${esc(e?.title || '')}" placeholder="e.g. Electricity bill"></div>
      <div class="col-6"><label class="form-label">Amount (${esc(cur())}) *</label><input name="amount" inputmode="decimal" class="form-control" value="${e?.amount ?? ''}"></div>
      <div class="col-6"><label class="form-label">Date *</label><input name="date" type="date" class="form-control" value="${e?.date || today()}"></div>
      <div class="col-12"><label class="form-label">Category</label><select name="category" class="form-select">
        ${Object.entries(Clinic.EXPENSE_CATEGORIES).map(([k, l]) => `<option value="${k}" ${e?.category === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label">Note</label><input name="note" class="form-control" value="${esc(e?.note || '')}"></div>
    </div>`,
    onSubmit: (v) => Clinic.saveExpense(v, e?.id || null),
  });
}

async function renderList(el, $el, range) {
  const list = (await idb.getAllByIndex('expenses', 'date', IDBKeyRange.bound(range[0], range[1]))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const total = list.reduce((s, e) => s + e.amount, 0);
  const manage = Auth.can('expense.manage');
  $el.find('.x-total').html(`<div class="stat-card p-3 d-flex justify-content-between align-items-center"><div><div class="small text-body-secondary">Total in period</div>
    <div class="fw-bold fs-4 money">${esc(cur())} ${fmtNum(total)}</div></div><div class="small text-body-secondary">${list.length} expense${list.length === 1 ? '' : 's'}</div></div>`);
  pager($el.find('.x-list'), list, (e) => `<div class="list-row">
    <div class="main"><div class="title">${esc(e.title)}</div><div class="sub">${esc(fmtDate(e.date))} · ${esc(Clinic.EXPENSE_CATEGORIES[e.category] || e.category)}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
    <div class="fw-bold money">${esc(cur())} ${fmtNum(e.amount)}</div>
    ${manage ? `<button class="btn btn-sm btn-link px-1 x-edit" data-id="${esc(e.id)}" aria-label="Edit"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-link text-danger px-1 x-del" data-id="${esc(e.id)}" aria-label="Delete"><i class="bi bi-trash"></i></button>` : ''}</div>`, 60,
  UI.emptyState('No expenses in this period', 'wallet2'));
}

export default {
  async render(el) {
    this.destroy();
    const $el = $(el);
    const range = rangeFor('month');
    $el.html(UI.pageHeader('Expenses', Auth.can('expense.manage') ? '<button class="btn btn-primary btn-sm x-add"><i class="bi bi-plus-lg me-1"></i>Add</button>' : '') +
      dateFilter(range[0], range[1]) + `<div class="x-total mb-3"></div><div class="list-card x-list"></div>`);
    bindDateFilter($el, (f, t) => { range[0] = f; range[1] = t; renderList(el, $el, range); });
    await renderList(el, $el, range);

    $el.on('click', '.x-add', async () => {
      const saved = await openExpenseForm();
      if (saved) { UI.toast('Expense added'); renderList(el, $el, range); }
    });
    $el.on('click', '.x-edit', async (e) => {
      const row = await idb.get('expenses', e.currentTarget.dataset.id);
      if (!row) return;
      const saved = await openExpenseForm(row);
      if (saved) { UI.toast('Expense updated'); renderList(el, $el, range); }
    });
    $el.on('click', '.x-del', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!(await UI.confirmDialog('Delete this expense? It will no longer count in reports.', { okLabel: 'Delete', okClass: 'btn-danger' }))) return;
      try { await Clinic.deleteExpense(id); UI.toast('Expense deleted'); } catch (err) { UI.toastError(err); }
      renderList(el, $el, range);
    });
    this._h = () => { if (location.hash === '#/expenses') renderList(el, $el, range); };
    document.addEventListener('data:changed', this._h);
  },
  destroy() {
    if (this._h) document.removeEventListener('data:changed', this._h);
    this._h = null;
  },
};
