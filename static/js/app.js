'use strict';

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.className = `toast ${type} show`;
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
    if (name === 'add') initAddForm();
  });
});

// ── People ─────────────────────────────────────────────────────────────────────
async function addPerson() {
  const input = document.getElementById('personName');
  const name = input.value.trim();
  if (!name) { showToast('Enter a name first', 'error'); return; }

  const res = await fetch('/people/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `name=${encodeURIComponent(name)}`,
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error, 'error'); return; }

  input.value = '';
  showToast(`${name} added`, 'success');

  // Remove placeholder if present
  document.getElementById('peoplePlaceholder')?.remove();

  // Add card to list
  const list = document.getElementById('peopleList');
  const item = document.createElement('div');
  item.className = 'person-item';
  item.id = `person-${data.id}`;
  item.innerHTML = `
    <div class="person-info">
      <div class="avatar">${name[0].toUpperCase()}</div>
      <span>${escHtml(name)}</span>
    </div>
    <button class="btn-icon btn-danger" onclick="deletePerson(${data.id}, this)" aria-label="Remove ${escHtml(name)}">
      <i class="ti ti-trash" aria-hidden="true"></i>
    </button>
  `;
  list.appendChild(item);
  // Store name on element for deletePerson
  item.dataset.name = name;

  // Update add-expense form chips + payer select
  addChipAndPayerOption(name);
  ensureAddExpenseForm();
  updateBadge();
  refreshSettleTab();
}

async function deletePerson(id, btn) {
  const item = btn.closest('.person-item');
  const name = item.querySelector('.person-info span')?.textContent || item.dataset.name;

  // If we have a real DB id, hit the server
  if (id) {
    const res = await fetch(`/people/delete/${id}`, { method: 'POST' });
    if (!res.ok) { showToast('Could not remove person', 'error'); return; }
  }

  item.remove();
  removeChipAndPayerOption(name);
  showToast(`${name} removed`, 'info');

  if (!document.querySelectorAll('.person-item').length) {
    document.getElementById('peopleList').innerHTML =
      `<div class="empty-state" id="peoplePlaceholder"><i class="ti ti-users" aria-hidden="true"></i>No one added yet — start by adding your travel crew</div>`;
    ensureAddExpenseForm();
  }
  updateBadge();
  refreshSettleTab();
}

function addChipAndPayerOption(name) {
  const chipGrid = document.getElementById('involvedChips');
  if (chipGrid) {
    const chip = document.createElement('div');
    chip.className = 'person-chip selected';
    chip.dataset.person = name;
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', 'true');
    chip.setAttribute('tabindex', '0');
    chip.onclick = () => toggleChip(chip);
    chip.innerHTML = `<div class="avatar sm">${name[0].toUpperCase()}</div>${escHtml(name)}`;
    chipGrid.appendChild(chip);
  }

  const payer = document.getElementById('expPayer');
  if (payer) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    payer.appendChild(opt);
  }
}

function removeChipAndPayerOption(name) {
  document.querySelector(`.person-chip[data-person="${CSS.escape(name)}"]`)?.remove();
  const payer = document.getElementById('expPayer');
  if (payer) {
    [...payer.options].find(o => o.value === name)?.remove();
  }
}

// Enter key on person input
document.getElementById('personName')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') addPerson();
});

// ── Add expense form ──────────────────────────────────────────────────────────
let splitMode = 'equal';

function initAddForm() {
  // chips start all selected
  document.querySelectorAll('.person-chip').forEach(c => {
    c.classList.add('selected');
    c.setAttribute('aria-checked', 'true');
  });
  setSplit('equal', document.querySelector('.split-opt'));
}

function toggleChip(el) {
  const selected = el.classList.toggle('selected');
  el.setAttribute('aria-checked', selected);
  if (splitMode === 'custom') rebuildCustomRows();
}

function setSplit(mode, btn) {
  splitMode = mode;
  document.querySelectorAll('.split-opt').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  const custom = document.getElementById('customSplit');
  if (mode === 'custom') {
    custom.classList.add('show');
    rebuildCustomRows();
  } else {
    custom.classList.remove('show');
  }
}

function rebuildCustomRows() {
  const involved = [...document.querySelectorAll('.person-chip.selected')].map(c => c.dataset.person);
  const custom = document.getElementById('customSplit');
  custom.innerHTML = involved.map(name => `
    <div class="custom-row">
      <div class="person-info">
        <div class="avatar sm">${name[0].toUpperCase()}</div>
        <span style="font-size:14px;">${escHtml(name)}</span>
      </div>
      <input type="number" id="custom_${CSS.escape(name)}" data-person="${escHtml(name)}"
             placeholder="0.00" min="0" step="0.01" style="width:110px;">
    </div>
  `).join('');
}

async function addExpense() {
  const desc   = document.getElementById('expDesc')?.value.trim();
  const amount = parseFloat(document.getElementById('expAmount')?.value);
  const payer  = document.getElementById('expPayer')?.value;
  const chips  = [...document.querySelectorAll('.person-chip.selected')];
  const involved = chips.map(c => c.dataset.person);

  if (!desc)           { showToast('Add a description', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
  if (!involved.length) { showToast('Select at least one person', 'error'); return; }

  let shares = {};
  if (splitMode === 'equal') {
    const each = amount / involved.length;
    involved.forEach(p => shares[p] = each);
  } else {
    let total = 0;
    for (const p of involved) {
      const v = parseFloat(document.getElementById('custom_' + CSS.escape(p))?.value || 0);
      shares[p] = v; total += v;
    }
    if (Math.abs(total - amount) > 0.02) {
      showToast(`Custom amounts total $${total.toFixed(2)}, expense is $${amount.toFixed(2)}`, 'error');
      return;
    }
  }

  const res = await fetch('/expenses/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: desc, amount, payer, split_mode: splitMode, shares }),
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error, 'error'); return; }

  showToast('Expense saved', 'success');
  document.getElementById('expDesc').value = '';
  document.getElementById('expAmount').value = '';
  initAddForm();
  appendExpenseToLog({ id: data.id, desc, amount, payer, shares, split_mode: splitMode });
  ensureMetricRow();
  updateBadge();
  updateMetrics(amount);
  refreshSettleTab();
}

function appendExpenseToLog({ id, desc, amount, payer, shares, split_mode }) {
  const list = document.getElementById('txList');
  // Remove empty state if present
  list.querySelector('.empty-state')?.remove();

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const chips = Object.entries(shares)
    .map(([p, a]) => `<span class="tx-chip">${escHtml(p)}: $${parseFloat(a).toFixed(2)}</span>`)
    .join('');

  const item = document.createElement('div');
  item.className = 'tx-item';
  if (id) item.id = `expense-${id}`;
  const deleteHandler = id ? `deleteExpense(${id}, this)` : 'deleteExpense(null, this)';
  item.innerHTML = `
    <div class="tx-header">
      <div>
        <div class="tx-desc">${escHtml(desc)}</div>
        <div class="tx-meta">
          ${today} · Paid by ${escHtml(payer)}
          <span class="split-badge">${split_mode}</span>
        </div>
      </div>
      <div class="tx-right">
        <span class="tx-amount">$${amount.toFixed(2)}</span>
        <button class="btn-icon btn-danger" onclick="${deleteHandler}" aria-label="Delete expense">
          <i class="ti ti-trash" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="tx-chips">${chips}</div>
  `;
  list.prepend(item);
}

async function deleteExpense(id, btn) {
  const item = btn.closest('.tx-item');
  if (id) {
    const res = await fetch(`/expenses/delete/${id}`, { method: 'POST' });
    if (!res.ok) { showToast('Could not delete expense', 'error'); return; }
  }
  const amt = parseFloat(item.querySelector('.tx-amount')?.textContent.replace('$', '')) || 0;
  item.remove();
  showToast('Expense deleted', 'info');
  updateMetrics(-amt);
  updateBadge();

  if (!document.querySelectorAll('.tx-item').length) {
    document.getElementById('txList').innerHTML =
      `<div class="empty-state"><i class="ti ti-receipt" aria-hidden="true"></i>No expenses yet — add one to get started</div>`;
    document.querySelector('#tab-log .metric-row')?.remove();
  }
  refreshSettleTab();
}

// ── Live metric updates ───────────────────────────────────────────────────────
function updateMetrics(delta) {
  ensureMetricRow();
  const totalEl = document.querySelector('#tab-log .metric-val');
  if (!totalEl) return;
  const cur = parseFloat(totalEl.textContent.replace('$', '')) || 0;
  totalEl.textContent = '$' + Math.max(0, cur + delta).toFixed(2);
  const countEl = document.querySelectorAll('#tab-log .metric-val')[1];
  if (countEl) {
    const c = parseInt(countEl.textContent) || 0;
    countEl.textContent = Math.max(0, c + (delta > 0 ? 1 : -1));
  }
}

function ensureMetricRow() {
  const logTab = document.getElementById('tab-log');
  if (!logTab || logTab.querySelector('.metric-row')) return;
  const count = document.querySelectorAll('.tx-item').length;
  if (!count) return;
  const row = document.createElement('div');
  row.className = 'metric-row';
  row.innerHTML = `
    <div class="metric">
      <div class="metric-label">Total spent</div>
      <div class="metric-val">$0.00</div>
    </div>
    <div class="metric">
      <div class="metric-label">Expenses</div>
      <div class="metric-val">${count}</div>
    </div>
    <div class="metric">
      <div class="metric-label">People</div>
      <div class="metric-val">${getPeopleFromDom().length}</div>
    </div>
  `;
  logTab.insertBefore(row, document.getElementById('txList'));
}

function updateBadge() {
  const count = document.querySelectorAll('.tx-item').length;
  const tab = document.querySelector('.tab[data-tab="log"]');
  if (!tab) return;
  let badge = tab.querySelector('.badge');
  if (count > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; tab.appendChild(badge); }
    badge.textContent = count;
  } else {
    badge?.remove();
  }
}

// ── Settle up (live) ─────────────────────────────────────────────────────────
function getPeopleFromDom() {
  return [...document.querySelectorAll('.person-item .person-info span')]
    .map(el => el.textContent.trim())
    .filter(Boolean);
}

function ensureAddExpenseForm() {
  const card = document.getElementById('addExpenseCard');
  if (!card) return;

  const people = getPeopleFromDom();
  if (!people.length) {
    card.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-users" aria-hidden="true"></i>
        Add people to the trip first
      </div>`;
    return;
  }

  if (document.getElementById('expDesc')) return;

  const payerOptions = people.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
  const chips = people.map(p => `
    <div class="person-chip selected" data-person="${escHtml(p)}" onclick="toggleChip(this)" role="checkbox" aria-checked="true" tabindex="0">
      <div class="avatar sm">${p[0].toUpperCase()}</div>
      ${escHtml(p)}
    </div>`).join('');

  card.innerHTML = `
    <div class="form-row">
      <label for="expDesc">Description</label>
      <input type="text" id="expDesc" placeholder="e.g. Dinner at Trattoria" autocomplete="off" maxlength="200">
    </div>
    <div class="form-grid">
      <div class="form-row">
        <label for="expAmount">Amount ($)</label>
        <input type="number" id="expAmount" placeholder="0.00" min="0.01" step="0.01">
      </div>
      <div class="form-row">
        <label for="expPayer">Paid by</label>
        <select id="expPayer">${payerOptions}</select>
      </div>
    </div>
    <div class="form-row">
      <label>Who was involved?</label>
      <div class="chip-grid" id="involvedChips">${chips}</div>
    </div>
    <div class="form-row">
      <label>How was it split?</label>
      <div class="split-toggle">
        <button class="split-opt active" onclick="setSplit('equal', this)">Equally</button>
        <button class="split-opt" onclick="setSplit('custom', this)">Custom amounts</button>
      </div>
      <div id="customSplit" class="custom-split"></div>
    </div>
    <button class="btn-primary" onclick="addExpense()">
      <i class="ti ti-check" aria-hidden="true"></i> Save expense
    </button>`;
  splitMode = 'equal';
}

function balanceLabel(amount) {
  if (amount > 0.005) return `<span class="balance-gets">gets back $${amount.toFixed(2)}</span>`;
  if (amount < -0.005) return `<span class="balance-owes">owes $${Math.abs(amount).toFixed(2)}</span>`;
  return `<span class="balance-settled">settled up ✓</span>`;
}

function renderSettlePanel(data) {
  const panel = document.getElementById('settlePanel');
  if (!panel) return;

  if (!data.expense_count || !Object.keys(data.balances).length) {
    panel.innerHTML = `
      <div class="empty-state large">
        <i class="ti ti-scale" aria-hidden="true"></i>
        Add some expenses to see who owes what
      </div>`;
    return;
  }

  const balanceRows = Object.entries(data.balances).map(([person, b]) => `
    <tr>
      <td>
        <div class="person-info">
          <div class="avatar sm">${person[0].toUpperCase()}</div>
          ${escHtml(person)}
        </div>
      </td>
      <td>${balanceLabel(b)}</td>
    </tr>`).join('');

  const settlements = (data.settlements || []).map(s => `
    <div class="settlement-item">
      <div class="avatar sm">${s.from[0].toUpperCase()}</div>
      <span class="s-from">${escHtml(s.from)}</span>
      <i class="ti ti-arrow-right arrow" aria-hidden="true"></i>
      <span class="s-to">${escHtml(s.to)}</span>
      <div class="avatar sm">${s.to[0].toUpperCase()}</div>
      <span class="s-amt">$${s.amount.toFixed(2)}</span>
    </div>`).join('');

  panel.innerHTML = `
    <div class="metric-row" style="margin-bottom:1rem;">
      <div class="metric">
        <div class="metric-label">Trip total</div>
        <div class="metric-val">$${data.total.toFixed(2)}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Expenses</div>
        <div class="metric-val">${data.expense_count}</div>
      </div>
      <div class="metric">
        <div class="metric-label">People</div>
        <div class="metric-val">${data.people_count}</div>
      </div>
    </div>
    <p class="section-title">Final balances</p>
    <div class="card" style="margin-bottom:1rem;">
      <table class="balance-table" aria-label="Balance summary">
        <thead><tr><th>Person</th><th>Net balance</th></tr></thead>
        <tbody>${balanceRows}</tbody>
      </table>
    </div>
    ${data.settlements.length ? `
      <p class="section-title">Who pays whom</p>
      <div class="settlement-list">${settlements}</div>` : ''}
    <div class="settle-actions">
      <button class="btn-primary" onclick="goToDiscord()">
        <i class="ti ti-brand-discord" aria-hidden="true"></i> Send to Discord
      </button>
    </div>`;
}

async function refreshSettleTab() {
  try {
    const res = await fetch('/api/summary');
    const data = await res.json();
    renderSettlePanel(data);
    const peopleMetric = document.querySelector('#tab-log .metric-val:last-child');
    if (peopleMetric) peopleMetric.textContent = data.people_count;
  } catch {
    // ignore transient errors
  }
}

function goToDiscord() {
  document.querySelector('.tab[data-tab="discord"]')?.click();
}

// ── Discord ────────────────────────────────────────────────────────────────────
async function sendToDiscord() {
  const token = document.getElementById('dcToken')?.value.trim();
  const channelId = document.getElementById('dcChannel')?.value.trim();
  const statusEl = document.getElementById('discordStatus');

  if (!token || !channelId) {
    statusEl.textContent = 'Fill in your bot token and channel ID first.';
    statusEl.className = 'dc-status error';
    return;
  }

  statusEl.textContent = 'Sending…';
  statusEl.className = 'dc-status';

  const res = await fetch('/discord/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, channel_id: channelId }),
  });
  const data = await res.json();

  if (res.ok) {
    statusEl.textContent = '✓ Sent to Discord';
    statusEl.className = 'dc-status';
  } else {
    statusEl.textContent = data.error || 'Something went wrong.';
    statusEl.className = 'dc-status error';
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}