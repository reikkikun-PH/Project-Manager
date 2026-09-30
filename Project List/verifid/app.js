// Prevent highlighting, copying, dragging, and context menu (human paper feel, less AI)
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('selectstart', e => e.preventDefault());
document.addEventListener('copy', e => e.preventDefault());
document.addEventListener('cut', e => e.preventDefault());
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && ['c','a','x','s','p'].includes(e.key.toLowerCase())) e.preventDefault();
});

// --- DOM Elements ---
const adminForm = document.getElementById('adminLoginForm');
const adminUserInput = document.getElementById('adminUser');
const adminPassInput = document.getElementById('adminPass');
const adminStatus = document.getElementById('adminStatus');
const adminDashboard = document.getElementById('adminDashboard');
const logsList = document.getElementById('logsList');
const refreshLogsBtn = document.getElementById('refreshLogsBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

// Employee management DOM
const tabLogsBtn = document.getElementById('tabLogsBtn');
const tabEmployeesBtn = document.getElementById('tabEmployeesBtn');
const logsPanel = document.getElementById('logsPanel');
const employeesPanel = document.getElementById('employeesPanel');
const employeesGrid = document.getElementById('employeesGrid');
const employeesEmpty = document.getElementById('employeesEmpty');
const employeeCountBadge = document.getElementById('employeeCountBadge');
const newEmpName = document.getElementById('newEmpName');
const newEmpFile = document.getElementById('newEmpFile');
const newEmpPreview = document.getElementById('newEmpPreview');
const newEmpPreviewWrap = document.getElementById('newEmpPreviewWrap');
const newEmpPreviewName = document.getElementById('newEmpPreviewName');
const addEmployeeBtn = document.getElementById('addEmployeeBtn');
const refreshEmployeesBtn = document.getElementById('refreshEmployeesBtn');
const employeeStatus = document.getElementById('employeeStatus');

// Cutoff config DOM (Settings tab, admin only)
const presentCutoffInput = document.getElementById('presentCutoffInput');
const saveCutoffBtn = document.getElementById('saveCutoffBtn');
const cutoffStatus = document.getElementById('cutoffStatus');
const tabSettingsBtn = document.getElementById('tabSettingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const logsSearchRow = document.getElementById('logsSearchRow');
const logsSearch = document.getElementById('logsSearch');
const logsStatusFilter = document.getElementById('logsStatusFilter');
let currentCutoff = '09:00';
let lastLogs = [];

// --- Session / Roles ---
// role: 'admin' = full control | 'employee' = own attendance logs only
let session = { username: '', role: 'admin', employee: '' };
const sessionInfo = document.getElementById('sessionInfo');
const roleBadge = document.getElementById('roleBadge');
const tabAccountsBtn = document.getElementById('tabAccountsBtn');
const accountsPanel = document.getElementById('accountsPanel');
const accountsList = document.getElementById('accountsList');
const refreshAccountsBtn = document.getElementById('refreshAccountsBtn');
const newAccUser = document.getElementById('newAccUser');
const newAccPass = document.getElementById('newAccPass');
const newAccRole = document.getElementById('newAccRole');
const newAccEmployee = document.getElementById('newAccEmployee');
const addAccountBtn = document.getElementById('addAccountBtn');
const accountStatus = document.getElementById('accountStatus');

function isAdmin() { return (session.role || 'admin') === 'admin'; }

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function applyRoleUI() {
  const admin = isAdmin();
  if (sessionInfo) sessionInfo.textContent = session.username ? `Signed in: ${session.username}` : '';
  if (roleBadge) {
    roleBadge.textContent = admin ? 'ADMIN' : 'EMPLOYEE';
    roleBadge.style.background = admin ? '#2c7a3a' : '#7a5a2c';
    roleBadge.style.color = '#fff';
  }
  if (tabEmployeesBtn) tabEmployeesBtn.style.display = admin ? '' : 'none';
  if (tabAccountsBtn) tabAccountsBtn.style.display = admin ? '' : 'none';
  if (tabSettingsBtn) tabSettingsBtn.style.display = admin ? '' : 'none';
  if (logsSearchRow) logsSearchRow.style.display = admin ? '' : 'none';
  const heading = document.getElementById('logsHeading');
  if (heading) heading.textContent = admin ? 'Attendance Log' : `My Attendance — ${session.employee || session.username}`;
}

const entryView = document.getElementById('attendanceEntryView');
const cameraView = document.getElementById('attendanceCameraView');
const reviewView = document.getElementById('attendanceReviewView');
const successView = document.getElementById('attendanceSuccessView');

const startCamBtn = document.getElementById('startCamBtn');
const captureBtn = document.getElementById('captureBtn');
const cancelMediaBtn = document.getElementById('cancelMediaBtn');
const submitAttendanceBtn = document.getElementById('submitAttendanceBtn');
const retakeBtn = document.getElementById('retakeBtn');
const resetBtn = document.getElementById('resetBtn');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const webcam = document.getElementById('webcam');
const canvas = document.getElementById('captureCanvas');
const previewImg = document.getElementById('previewImg');
const attendanceMsg = document.getElementById('attendanceMsg');
const timestampDisplay = document.getElementById('timestampDisplay');

// --- State ---
let videoStream = null;
let singleSnapshotDataUrl = null;

function switchView(target) {
  [entryView, cameraView, reviewView, successView].forEach(v => v.classList.remove('active'));
  target.classList.add('active');
  attendanceMsg.textContent = '';
}

// --- Admin Log Management (proper Time + Name + Type + Status view) ---
async function fetchLogs() {
  logsList.innerHTML = '<li class="log-empty">Fetching logs...</li>';
  try {
    const logsUrl = (session && session.username)
      ? 'api/logs?username=' + encodeURIComponent(session.username)
      : 'api/logs';
    const res = await fetch(logsUrl);
    const data = await res.json();
    lastLogs = data.logs || [];
    // Sync cutoff from logs response if present
    if (data.config && (data.config.presentCutoff || data.config.present_cutoff)) {
      const c = data.config.presentCutoff || data.config.present_cutoff;
      currentCutoff = c;
      if (presentCutoffInput && !presentCutoffInput.matches(':focus')) presentCutoffInput.value = c;
      if (cutoffStatus && !cutoffStatus.textContent.includes('Saved')) {
        cutoffStatus.style.color = '#5e5952';
        cutoffStatus.textContent = `Cutoff: ${c}`;
      }
    } else if (data.presentCutoff) {
      currentCutoff = data.presentCutoff;
      if (presentCutoffInput && !presentCutoffInput.matches(':focus')) presentCutoffInput.value = data.presentCutoff;
    }
    renderLogs();
  } catch (err) {
    console.error('Failed to load logs:', err);
    logsList.innerHTML = '<li class="log-empty is-error">Error loading logs</li>';
  }
}

// Client-side search/filter over the last fetched logs (admin only)
function renderLogs() {
  const q = (isAdmin() && typeof logsSearch !== 'undefined' && logsSearch) ? (logsSearch.value || '').trim().toLowerCase() : '';
  const st = (isAdmin() && typeof logsStatusFilter !== 'undefined' && logsStatusFilter) ? logsStatusFilter.value : 'all';
  let logs = lastLogs || [];
  if (q) logs = logs.filter(e => (e.name || '').toLowerCase().includes(q));
  if (st !== 'all') logs = logs.filter(e => (e.status || 'Present') === st);
  logsList.innerHTML = '';

  if (!logs || logs.length === 0) {
    if (q || st !== 'all') {
      logsList.innerHTML = '<li class="log-empty">(No matches — clear search/filter)</li>';
    } else {
      logsList.innerHTML = '<li class="log-empty">' + (isAdmin() ? '(No entries recorded yet)' : '(No attendance records found for you yet)') + '</li>';
    }
    return;
  }

    // Header row
    const header = document.createElement('li');
    header.className = 'log-head';
    header.innerHTML = '<span>Time</span><span>Name</span><span>Status</span>';
    logsList.appendChild(header);

    logs.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'log-row';
      const conf = entry.confidence ? `<span class="log-conf">${escHtml(entry.confidence)}</span>` : '';
      const statusVal = entry.status || 'Present';
      const statusBadge = `<span class="badge ${statusVal === 'Late' ? 'b-late' : 'b-present'}">${escHtml(statusVal)}</span>`;
      li.innerHTML = `
        <span class="log-time"><span class="log-dt">${escHtml(entry.displayTime || '')}</span></span>
        <span class="log-name"><strong>${escHtml(entry.name || '')}</strong><br>${conf}</span>
        ${statusBadge}
      `;
      li.title = `${entry.type || 'LOG'} — ${entry.file || ''}${entry.detail ? ' — ' + entry.detail : ''} — ${statusVal} (cutoff ${currentCutoff})`;
      logsList.appendChild(li);
    });

    // Footer summary
    if (logs.length > 0) {
      const lateCount = logs.filter(l => l.status === 'Late').length;
      const presentCount = logs.length - lateCount;
      const total = (lastLogs || []).length;
      const scoped = (logs.length !== total) ? ` (${logs.length} of ${total})` : '';
      const foot = document.createElement('li');
      foot.className = 'log-foot';
      foot.innerHTML = `
        <div class="log-foot-inner">
          <span class="log-foot-summary"><span class="ok">${presentCount} present</span> · <span class="late">${lateCount} late</span>${scoped}</span>
          <a href="api/logs/csv" target="_blank" class="log-foot-link" style="text-decoration:underline;">Export CSV</a>
        </div>`;
      logsList.appendChild(foot);
    }
}

// --- Admin Tabs (only Logs for employees; Employees/Accounts/Settings are admin-only) ---
function switchAdminTab(tab) {
  if (!isAdmin()) tab = 'logs';
  const showLogs = tab === 'logs';
  const showEmps = tab === 'employees' && isAdmin();
  const showAccs = tab === 'accounts' && isAdmin();
  const showSet = tab === 'settings' && isAdmin();
  logsPanel.style.display = showLogs ? 'flex' : 'none';
  employeesPanel.style.display = showEmps ? 'flex' : 'none';
  if (accountsPanel) accountsPanel.style.display = showAccs ? 'flex' : 'none';
  if (settingsPanel) settingsPanel.style.display = showSet ? 'flex' : 'none';
  tabLogsBtn.classList.toggle('btn-accent', showLogs);
  tabEmployeesBtn.classList.toggle('btn-accent', showEmps);
  if (tabAccountsBtn) tabAccountsBtn.classList.toggle('btn-accent', showAccs);
  if (tabSettingsBtn) tabSettingsBtn.classList.toggle('btn-accent', showSet);
  if (showEmps) fetchEmployees();
  if (showAccs) fetchAccounts();
  if (showSet) fetchConfig();
  if (showLogs) fetchLogs();
}

// --- Attendance Cutoff Config ---
async function fetchConfig() {
  if (!presentCutoffInput) return;
  try {
    const res = await fetch('api/config');
    const data = await res.json();
    const cutoff = data.presentCutoff || data.present_cutoff || data.cutoff || '09:00';
    currentCutoff = cutoff;
    presentCutoffInput.value = cutoff;
    if (cutoffStatus) {
      cutoffStatus.style.color = '#5e5952';
      cutoffStatus.textContent = `Cutoff: ${cutoff}`;
    }
  } catch (err) {
    console.error('Failed to load config:', err);
    if (cutoffStatus) {
      cutoffStatus.style.color = '#8b3a2b';
      cutoffStatus.textContent = 'Load failed — using 09:00';
    }
  }
}

async function saveCutoff() {
  if (!presentCutoffInput || !saveCutoffBtn) return;
  const val = presentCutoffInput.value.trim();
  if (!val || !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) {
    if (cutoffStatus) { cutoffStatus.style.color = '#8b3a2b'; cutoffStatus.textContent = 'Invalid — use HH:MM'; }
    return;
  }
  saveCutoffBtn.disabled = true;
  const orig = saveCutoffBtn.textContent;
  saveCutoffBtn.textContent = 'Saving...';
  if (cutoffStatus) { cutoffStatus.style.color = '#5e5952'; cutoffStatus.textContent = 'Saving...'; }
  try {
    const res = await fetch('api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presentCutoff: val, requester: session.username })
    });
    const data = await res.json();
    if (data.ok) {
      currentCutoff = data.presentCutoff || val;
      if (cutoffStatus) { cutoffStatus.style.color = '#2c7a3a'; cutoffStatus.textContent = `Saved: ${currentCutoff}`; }
      fetchLogs();
    } else {
      if (cutoffStatus) { cutoffStatus.style.color = '#8b3a2b'; cutoffStatus.textContent = data.error || 'Save failed'; }
    }
  } catch (err) {
    console.error('Save cutoff error:', err);
    if (cutoffStatus) { cutoffStatus.style.color = '#8b3a2b'; cutoffStatus.textContent = 'Save error'; }
  } finally {
    saveCutoffBtn.disabled = false;
    saveCutoffBtn.textContent = orig;
  }
}

function setCutoffPreset(val) {
  if (!presentCutoffInput || !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) return;
  presentCutoffInput.value = val;
  if (cutoffStatus) {
    cutoffStatus.style.color = '#5e5952';
    cutoffStatus.textContent = `${val} — Save to apply`;
  }
}

// --- Employee Management ---
async function fetchEmployees() {
  if (!employeesGrid) return;
  employeesGrid.innerHTML = '<p class="list-empty">Loading employees...</p>';
  if (employeeStatus) employeeStatus.textContent = '';
  try {
    const res = await fetch('api/employees');
    const data = await res.json();
    const employees = data.employees || [];
    renderEmployees(employees);
  } catch (err) {
    console.error('Failed to load employees:', err);
    employeesGrid.innerHTML = '<p class="list-empty is-error">Error loading employees</p>';
  }
}

function renderEmployees(employees) {
  employeesGrid.innerHTML = '';
  if (employeeCountBadge) employeeCountBadge.textContent = employees.length;
  if (!employees || employees.length === 0) {
    if (employeesEmpty) employeesEmpty.style.display = 'block';
    return;
  }
  if (employeesEmpty) employeesEmpty.style.display = 'none';
  employees.forEach(emp => {
    const card = document.createElement('div');
    card.className = 'emp-card';
    card.innerHTML = `
      <img src="${escHtml(emp.url)}" alt="${escHtml(emp.name)}" class="emp-avatar" onerror="this.style.background='#eee8da'; this.src=''" />
      <strong class="emp-name">${escHtml(emp.name)}</strong>
      <button type="button" data-file="${escHtml(emp.file)}" class="btn btn-sm btn-danger btn-block" title="${escHtml(emp.file)}">Remove</button>
    `;
    const btn = card.querySelector('button');
    btn.addEventListener('click', () => deleteEmployee(emp.file, emp.name, btn));
    employeesGrid.appendChild(card);
  });
}

async function deleteEmployee(fileName, displayName, btnEl) {
  if (!confirm(`Remove "${displayName}" (${fileName}) from database? This cannot be undone.`)) return;
  const origText = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Removing...'; }
  if (employeeStatus) { employeeStatus.style.color = '#5e5952'; employeeStatus.textContent = `Removing ${displayName}...`; }
  try {
    const res = await fetch('api/employees/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: fileName, requester: session.username })
    });
    const data = await res.json();
    if (data.ok) {
      if (employeeStatus) { employeeStatus.style.color = '#2c7a3a'; employeeStatus.textContent = `Removed ${displayName}`; }
      renderEmployees(data.employees || []);
    } else {
      if (employeeStatus) { employeeStatus.style.color = '#8b3a2b'; employeeStatus.textContent = data.error || 'Failed to remove.'; }
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = origText; }
    }
  } catch (err) {
    console.error('Delete error:', err);
    if (employeeStatus) { employeeStatus.style.color = '#8b3a2b'; employeeStatus.textContent = 'Error connecting to server.'; }
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origText; }
  }
}

async function addEmployee() {
  const name = newEmpName ? newEmpName.value.trim() : '';
  const file = newEmpFile ? newEmpFile.files[0] : null;
  if (!name) {
    if (employeeStatus) { employeeStatus.style.color = '#8b3a2b'; employeeStatus.textContent = 'Enter a name (2+ chars).'; }
    return;
  }
  if (!file) {
    if (employeeStatus) { employeeStatus.style.color = '#8b3a2b'; employeeStatus.textContent = 'Choose a photo file.'; }
    return;
  }
  if (employeeStatus) { employeeStatus.style.color = '#5e5952'; employeeStatus.textContent = 'Uploading & validating...'; }
  if (addEmployeeBtn) { addEmployeeBtn.disabled = true; addEmployeeBtn.textContent = 'Adding...'; }

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await fetch('api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, image: dataUrl, requester: session.username })
    });
    const data = await res.json();
    if (data.ok) {
      if (employeeStatus) { employeeStatus.style.color = '#2c7a3a'; employeeStatus.textContent = `Added "${name}" as ${data.file}`; }
      if (newEmpName) newEmpName.value = '';
      if (newEmpFile) newEmpFile.value = '';
      if (newEmpPreviewWrap) newEmpPreviewWrap.style.display = 'none';
      renderEmployees(data.employees || []);
    } else {
      if (employeeStatus) { employeeStatus.style.color = '#8b3a2b'; employeeStatus.textContent = data.error || 'Failed to add.'; }
    }
  } catch (err) {
    console.error('Add error:', err);
    if (employeeStatus) { employeeStatus.style.color = '#8b3a2b'; employeeStatus.textContent = 'Failed to connect to server.'; }
  } finally {
    if (addEmployeeBtn) { addEmployeeBtn.disabled = false; addEmployeeBtn.textContent = 'Add to Database'; }
  }
}

function handleNewEmpFilePreview(e) {
  const file = e.target.files[0];
  if (!file || !newEmpPreview || !newEmpPreviewWrap) return;
  const reader = new FileReader();
  reader.onload = ev => {
    newEmpPreview.src = ev.target.result;
    newEmpPreviewWrap.style.display = 'block';
    if (newEmpPreviewName) newEmpPreviewName.textContent = file.name + ` (${(file.size/1024).toFixed(1)} KB)`;
  };
  reader.readAsDataURL(file);
}

// --- Account Management (admin only) ---
async function fetchAccounts() {
  if (!accountsList || !isAdmin()) return;
  accountsList.innerHTML = '<p class="list-empty">Loading accounts...</p>';
  if (accountStatus) accountStatus.textContent = '';
  try {
    const res = await fetch('api/accounts?username=' + encodeURIComponent(session.username));
    const data = await res.json();
    if (data.accounts) {
      renderAccounts(data.accounts);
    } else {
      accountsList.innerHTML = '';
      if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = data.error || 'Failed to load.'; }
    }
  } catch (err) {
    console.error('Failed to load accounts:', err);
    accountsList.innerHTML = '<p class="list-empty is-error">Error loading accounts</p>';
  }
}

function renderAccounts(accounts) {
  accountsList.innerHTML = '';
  if (!accounts || accounts.length === 0) {
    accountsList.innerHTML = '<p class="list-empty">No accounts.</p>';
    return;
  }
  accounts.forEach(acc => {
    const isSelf = acc.username === session.username;
    const card = document.createElement('div');
    card.className = 'acc-card';
    card.innerHTML = `
      <div class="acc-top">
        <strong class="acc-name">${escHtml(acc.username)}${isSelf ? ' (you)' : ''}</strong>
        <span class="badge ${acc.role === 'admin' ? 'b-admin' : 'b-employee'}">${escHtml((acc.role || '').toUpperCase())}</span>
      </div>
      <div class="acc-row">
        <select aria-label="Role" class="acc-role">
          <option value="admin"${acc.role === 'admin' ? ' selected' : ''}>Admin</option>
          <option value="employee"${acc.role === 'employee' ? ' selected' : ''}>Employee</option>
        </select>
        <input type="text" value="${escHtml(acc.employee || '')}" placeholder="Linked name" aria-label="Linked employee name" class="acc-link" maxlength="48" />
      </div>
      <div class="acc-actions">
        <button type="button" class="btn btn-accent acc-save">Save</button>
        <button type="button" class="btn acc-pw">Reset PW</button>
        <button type="button" class="btn btn-danger acc-del"${isSelf ? ' disabled' : ''}>Remove</button>
      </div>
    `;
    const roleSel = card.querySelector('select');
    const empInput = card.querySelector('input');
    card.querySelector('.acc-save').addEventListener('click', () => updateAccount(acc.username, roleSel.value, empInput.value.trim()));
    card.querySelector('.acc-pw').addEventListener('click', () => resetAccountPassword(acc.username));
    if (!isSelf) card.querySelector('.acc-del').addEventListener('click', () => deleteAccount(acc.username));
    accountsList.appendChild(card);
  });
}

async function updateAccount(username, role, employee) {
  if (accountStatus) { accountStatus.style.color = '#5e5952'; accountStatus.textContent = `Saving ${username}...`; }
  try {
    const res = await fetch('api/accounts/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester: session.username, target: username, role, employee })
    });
    const data = await res.json();
    if (data.ok) {
      if (accountStatus) { accountStatus.style.color = '#2c7a3a'; accountStatus.textContent = `Saved ${username}`; }
      renderAccounts(data.accounts || []);
    } else if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = data.error || 'Save failed.'; }
  } catch (err) {
    console.error('Update account error:', err);
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Error connecting to server.'; }
  }
}

async function resetAccountPassword(username) {
  const pw = prompt(`New password for "${username}" (4+ chars):`);
  if (pw === null) return;
  if (pw.length < 4) {
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Password must be 4+ chars.'; }
    return;
  }
  if (accountStatus) { accountStatus.style.color = '#5e5952'; accountStatus.textContent = 'Updating password...'; }
  try {
    const res = await fetch('api/accounts/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester: session.username, target: username, password: pw })
    });
    const data = await res.json();
    if (data.ok) {
      if (accountStatus) { accountStatus.style.color = '#2c7a3a'; accountStatus.textContent = `Password updated for ${username}`; }
      renderAccounts(data.accounts || []);
    } else if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = data.error || 'Update failed.'; }
  } catch (err) {
    console.error('Reset PW error:', err);
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Error connecting to server.'; }
  }
}

async function deleteAccount(username) {
  if (!confirm(`Remove login account "${username}"? They will no longer be able to sign in.`)) return;
  if (accountStatus) { accountStatus.style.color = '#5e5952'; accountStatus.textContent = `Removing ${username}...`; }
  try {
    const res = await fetch('api/accounts/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester: session.username, target: username })
    });
    const data = await res.json();
    if (data.ok) {
      if (accountStatus) { accountStatus.style.color = '#2c7a3a'; accountStatus.textContent = `Removed ${username}`; }
      renderAccounts(data.accounts || []);
    } else if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = data.error || 'Remove failed.'; }
  } catch (err) {
    console.error('Delete account error:', err);
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Error connecting to server.'; }
  }
}

async function addAccount() {
  const username = newAccUser ? newAccUser.value.trim() : '';
  const password = newAccPass ? newAccPass.value : '';
  const role = newAccRole ? newAccRole.value : 'employee';
  const employee = newAccEmployee ? newAccEmployee.value.trim() : '';
  if (!username) {
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Enter a username (3+ chars).'; }
    return;
  }
  if (!password || password.length < 4) {
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Enter a password (4+ chars).'; }
    return;
  }
  if (accountStatus) { accountStatus.style.color = '#5e5952'; accountStatus.textContent = 'Creating account...'; }
  if (addAccountBtn) { addAccountBtn.disabled = true; addAccountBtn.textContent = 'Creating...'; }
  try {
    const res = await fetch('api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester: session.username, username, password, role, employee })
    });
    const data = await res.json();
    if (data.ok) {
      if (accountStatus) { accountStatus.style.color = '#2c7a3a'; accountStatus.textContent = `Created "${username}" (${role})`; }
      if (newAccUser) newAccUser.value = '';
      if (newAccPass) newAccPass.value = '';
      if (newAccEmployee) newAccEmployee.value = '';
      renderAccounts(data.accounts || []);
    } else if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = data.error || 'Failed to create.'; }
  } catch (err) {
    console.error('Add account error:', err);
    if (accountStatus) { accountStatus.style.color = '#8b3a2b'; accountStatus.textContent = 'Failed to connect to server.'; }
  } finally {
    if (addAccountBtn) { addAccountBtn.disabled = false; addAccountBtn.textContent = 'Create Account'; }
  }
}

// --- Admin Authentication (server-side, keeps credentials.json private) ---
adminForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const enteredUser = adminUserInput.value.trim();
  const enteredPass = adminPassInput.value;

  adminStatus.style.color = '#5e5952';
  adminStatus.textContent = 'Verifying credentials...';

  try {
    const response = await fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: enteredUser, password: enteredPass })
    });
    const data = await response.json();

    if (data.ok) {
      session = { username: data.username || enteredUser, role: data.role || 'admin', employee: data.employee || '' };
      adminStatus.textContent = '';
      adminForm.style.display = 'none';
      adminDashboard.style.display = 'flex';
      adminPassInput.value = '';
      applyRoleUI();
      switchAdminTab('logs');
      fetchLogs();
      if (isAdmin()) { fetchEmployees(); fetchConfig(); }
    } else {
      adminStatus.style.color = '#8b3a2b';
      adminStatus.textContent = data.error || 'Invalid username or passcode.';
    }
  } catch (error) {
    console.error('Credential validation error:', error);
    adminStatus.style.color = '#8b3a2b';
    adminStatus.textContent = 'Error connecting to server.';
  }
});

adminLogoutBtn.addEventListener('click', () => {
  session = { username: '', role: 'admin', employee: '' };
  adminDashboard.style.display = 'none';
  adminForm.style.display = 'block';
  adminUserInput.value = '';
  adminStatus.textContent = '';
  if (employeeStatus) employeeStatus.textContent = '';
  if (cutoffStatus) cutoffStatus.textContent = '';
  if (accountStatus) accountStatus.textContent = '';
});

refreshLogsBtn.addEventListener('click', () => { fetchLogs(); fetchConfig(); });
if (refreshEmployeesBtn) refreshEmployeesBtn.addEventListener('click', fetchEmployees);
if (tabLogsBtn) tabLogsBtn.addEventListener('click', () => switchAdminTab('logs'));
if (tabEmployeesBtn) tabEmployeesBtn.addEventListener('click', () => switchAdminTab('employees'));
if (tabAccountsBtn) tabAccountsBtn.addEventListener('click', () => switchAdminTab('accounts'));
if (tabSettingsBtn) tabSettingsBtn.addEventListener('click', () => switchAdminTab('settings'));
if (logsSearch) logsSearch.addEventListener('input', renderLogs);
if (logsStatusFilter) logsStatusFilter.addEventListener('change', renderLogs);
if (refreshAccountsBtn) refreshAccountsBtn.addEventListener('click', fetchAccounts);
if (addAccountBtn) addAccountBtn.addEventListener('click', addAccount);
if (addEmployeeBtn) addEmployeeBtn.addEventListener('click', addEmployee);
if (newEmpFile) newEmpFile.addEventListener('change', handleNewEmpFilePreview);
if (saveCutoffBtn) saveCutoffBtn.addEventListener('click', saveCutoff);
if (presentCutoffInput) presentCutoffInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveCutoff(); } });
// Quick preset buttons
document.querySelectorAll('.cutoff-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-cutoff');
    if (v) setCutoffPreset(v);
  });
});

// --- Camera Management ---
async function startCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    webcam.srcObject = videoStream;
    switchView(cameraView);
  } catch (err) {
    console.error('Camera access error:', err);
    attendanceMsg.style.color = '#8b3a2b';
    attendanceMsg.textContent = 'Camera permission denied or unavailable. Try file upload.';
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

// Single-shot Capture
function captureSinglePhoto() {
  if (!videoStream) return;

  canvas.width = webcam.videoWidth || 320;
  canvas.height = webcam.videoHeight || 240;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(webcam, 0, 0, canvas.width, canvas.height);

  singleSnapshotDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  previewImg.src = singleSnapshotDataUrl;

  stopCamera();
  switchView(reviewView);
}

function retakePhoto() {
  singleSnapshotDataUrl = null;
  startCamera();
}

function cancelMedia() {
  stopCamera();
  singleSnapshotDataUrl = null;
  switchView(entryView);
}

// --- File Upload Fallback ---
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    previewImg.src = event.target.result;
    singleSnapshotDataUrl = event.target.result;
    switchView(reviewView);
  };
  reader.readAsDataURL(file);
}

// --- Verification & Attendance Logging ---
async function submitAttendance() {
  if (!singleSnapshotDataUrl) {
    attendanceMsg.style.color = '#8b3a2b';
    attendanceMsg.textContent = 'No image captured to submit.';
    return;
  }

  attendanceMsg.style.color = '#5e5952';
  attendanceMsg.textContent = 'Verifying identity with local AI...';
  submitAttendanceBtn.disabled = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('api/verify-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: singleSnapshotDataUrl }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Server ${res.status} ${res.statusText} ${txt.slice(0,120)}`);
    }

    const data = await res.json();

    if (data.matched) {
      const now = new Date();
      const statusVal = data.status || 'Present';
      const statusColor = statusVal === 'Late' ? '#8b3a2b' : '#2c7a3a';
      timestampDisplay.innerHTML = `
        <strong>${escHtml(data.name)}</strong><br>
        <span style="font-size: 0.95rem; color: var(--ink-muted);">${escHtml(data.confidence || '')}</span><br>
        <span style="display:inline-block; background:${statusColor}; color:#fff; padding:2px 8px; border-radius:8px; font-size:0.85rem; font-weight:bold; margin:4px 0;">${escHtml(statusVal)}</span><br>
        <span style="font-size:0.85rem; color:var(--ink-muted);">${now.toLocaleTimeString()}</span>
      `;
      switchView(successView);

      if (adminDashboard.style.display !== 'none') {
        fetchLogs();
      }
    } else {
      attendanceMsg.style.color = '#8b3a2b';
      attendanceMsg.textContent = data.error || 'Face not recognized.';
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Submission error:', err);
    attendanceMsg.style.color = '#8b3a2b';
    const name = err.name === 'AbortError' ? 'Timeout (25s) — slow network, try retake with smaller image' : err.message;
    // Help cloudflared users: detect network vs server error
    let hint = '';
    if (name.includes('Failed to fetch') || name.includes('NetworkError') || name.includes('Load failed')) {
      hint = ' — check you opened the https://xxxx.trycloudflare.com URL shown in the host.bat console (not http://127.0.0.1:8000). Keep host.bat + Backend window open. If expired, re-run host.bat for a new URL.';
    }
    attendanceMsg.textContent = `Failed to connect to verification server: ${name}${hint}`;
    // quick health probe to differentiate server down vs bad image
    try {
      const probe = await fetch('api/logs', { method: 'GET', cache: 'no-store' });
      if (!probe.ok) attendanceMsg.textContent += ` [probe ${probe.status}]`;
    } catch (e2) {
      attendanceMsg.textContent += ` [probe failed: ${e2.message}]`;
    }
  } finally {
    submitAttendanceBtn.disabled = false;
  }
}

function resetAttendance() {
  stopCamera();
  singleSnapshotDataUrl = null;
  fileInput.value = '';
  switchView(entryView);
}

// --- Listeners ---
startCamBtn.addEventListener('click', startCamera);
captureBtn.addEventListener('click', captureSinglePhoto);
cancelMediaBtn.addEventListener('click', cancelMedia);
retakeBtn.addEventListener('click', retakePhoto);
submitAttendanceBtn.addEventListener('click', submitAttendance);
resetBtn.addEventListener('click', resetAttendance);

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);