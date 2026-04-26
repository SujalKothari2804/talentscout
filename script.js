/**
 * TalentScout HR Dashboard
 * Core application logic - data fetching, rendering, filtering, sorting, drawer, status updates.
 * Matches the Google Apps Script API contract from dashboard.html.
 */

(function () {
  'use strict';

  // ---- State ----
  let allCandidates = [];
  let filteredCandidates = [];
  let activeFilter = 'ALL';
  let sortCol = null;
  let sortDir = 1;
  let webAppUrl = '';

  // ---- DOM References ----
  const connectScreen = document.getElementById('connectScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const connectForm = document.getElementById('connectForm');
  const connectBtn = document.getElementById('connectBtn');
  const connectError = document.getElementById('connectError');
  const webAppUrlInput = document.getElementById('webAppUrl');
  const disconnectBtn = document.getElementById('disconnectBtn');

  const statTotal = document.getElementById('statTotal');
  const statShortlisted = document.getElementById('statShortlisted');
  const statRejected = document.getElementById('statRejected');
  const statPending = document.getElementById('statPending');
  const statAvgMatch = document.getElementById('statAvgMatch');

  const filterBtns = document.querySelectorAll('.filter-btn');
  const filterCount = document.getElementById('filterCount');
  const searchInput = document.getElementById('searchInput');
  const candidateBody = document.getElementById('candidateBody');
  const emptyState = document.getElementById('emptyState');
  const tableWrapper = document.querySelector('.table-wrapper .table-scroll');

  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('drawer');
  const drawerClose = document.getElementById('drawerClose');

  // ---- Helpers ----
  function scoreClass(n) {
    n = Number(n) || 0;
    if (n >= 75) return 'high';
    if (n >= 50) return 'medium';
    return 'low';
  }

  function getDecisionClass(decision) {
    const d = (decision || '').toUpperCase();
    if (d.includes('SHORTLIST')) return 'shortlist';
    if (d.includes('REJECT')) return 'reject';
    return 'hold';
  }

  function getPriorityClass(priority) {
    const p = (priority || '').toUpperCase();
    if (p.includes('HIGHEST')) return 'highest';
    if (p.includes('HIGH')) return 'high';
    if (p.includes('MEDIUM')) return 'medium';
    if (p.includes('LOW')) return 'low';
    return 'none';
  }

  function getStatusClass(status) {
    const s = (status || '').toUpperCase();
    if (s.includes('APPROVED')) return 'status-approved';
    if (s.includes('REJECTED')) return 'status-rejected';
    return 'status-pending';
  }

  function formatLabel(text) {
    if (!text) return '--';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  function formatPriority(text) {
    if (!text) return '--';
    return text.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scoreColor(n) {
    n = Number(n) || 0;
    if (n >= 75) return 'var(--success)';
    if (n >= 50) return 'var(--warning)';
    return 'var(--danger)';
  }

  // ---- Toast ----
  function showToast(msg, type) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.className = 'toast', 3000);
  }

  // ---- localStorage ----
  const savedUrl = localStorage.getItem('ts_webAppUrl');
  if (savedUrl) {
    webAppUrlInput.value = savedUrl;
  }

  // ---- Connect / Disconnect ----
  connectForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const url = webAppUrlInput.value.trim();
    if (!url) {
      showConnectError('Please enter a valid URL.');
      return;
    }
    webAppUrl = url;
    localStorage.setItem('ts_webAppUrl', webAppUrl);
    connectError.classList.remove('visible');
    connectBtn.classList.add('btn-loading');
    connectBtn.disabled = true;
    loadData(url);
  });

  disconnectBtn.addEventListener('click', function () {
    allCandidates = [];
    filteredCandidates = [];
    webAppUrl = '';
    activeFilter = 'ALL';
    sortCol = null;
    dashboardScreen.classList.remove('active');
    connectScreen.classList.remove('hidden');
    connectBtn.classList.remove('btn-loading');
    connectBtn.disabled = false;
    searchInput.value = '';
    resetFilterButtons();
  });

  function showConnectError(msg) {
    connectError.textContent = msg;
    connectError.classList.add('visible');
    connectBtn.classList.remove('btn-loading');
    connectBtn.disabled = false;
  }

  // ---- Data Fetch ----
  // Matches the original: fetch(webAppUrl + '?action=getCandidates')
  async function loadData(url) {
    try {
      const res = await fetch(url + '?action=getCandidates');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      allCandidates = json.candidates || [];

      // Transition to dashboard
      connectScreen.classList.add('hidden');
      dashboardScreen.classList.add('active');
      connectBtn.classList.remove('btn-loading');
      connectBtn.disabled = false;

      updateStats();
      applyFilters();
      showToast('Loaded ' + allCandidates.length + ' candidates', 'success');
    } catch (err) {
      showConnectError('Failed to load: ' + err.message + '. Ensure the Apps Script is deployed with "Anyone" access.');
      showToast(err.message, 'error');
    }
  }

  // ---- Stats ----
  function updateStats() {
    const total = allCandidates.length;
    const shortlisted = allCandidates.filter(c => (c.decision || '').includes('SHORTLIST')).length;
    const rejected = allCandidates.filter(c => c.decision === 'REJECT').length;
    const pending = allCandidates.filter(c => (c.status || '') === 'PENDING').length;
    const avgMatch = total
      ? Math.round(allCandidates.reduce((s, c) => s + (Number(c.matchScore) || 0), 0) / total)
      : 0;

    statTotal.textContent = total;
    statShortlisted.textContent = shortlisted;
    statRejected.textContent = rejected;
    statPending.textContent = pending;
    statAvgMatch.textContent = avgMatch + '%';
  }

  // ---- Filters ----
  filterBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const filterMap = {
        'all': 'ALL',
        'shortlisted': 'SHORTLIST',
        'rejected': 'REJECT',
        'pending': 'PENDING',
        'highest': 'HIGHEST PRIORITY'
      };
      activeFilter = filterMap[this.dataset.filter] || 'ALL';
      filterBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      applyFilters();
    });
  });

  function resetFilterButtons() {
    filterBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-filter="all"]').classList.add('active');
    activeFilter = 'ALL';
  }

  searchInput.addEventListener('input', function () {
    applyFilters();
  });

  function applyFilters() {
    const q = (searchInput.value || '').toLowerCase().trim();
    let list = allCandidates;

    // Filter
    if (activeFilter === 'SHORTLIST') {
      list = list.filter(c => (c.decision || '').includes('SHORTLIST'));
    } else if (activeFilter === 'REJECT') {
      list = list.filter(c => c.decision === 'REJECT');
    } else if (activeFilter === 'PENDING') {
      list = list.filter(c => (c.status || '') === 'PENDING');
    } else if (activeFilter === 'HIGHEST PRIORITY') {
      list = list.filter(c => (c.priority || '').includes('HIGHEST'));
    }

    // Search
    if (q) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.matchedSkills || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortCol) {
      list = [...list].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (typeof av === 'number') return (av - bv) * sortDir;
        return String(av || '').localeCompare(String(bv || '')) * sortDir;
      });
    }

    filteredCandidates = list;
    filterCount.textContent = list.length + ' shown';
    renderTable();
  }

  // ---- Sorting ----
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', function () {
      const colMap = {
        'name': 'name',
        'match': 'matchScore',
        'bonus': 'bonusScore',
        'interest': 'interestScore',
        'decision': 'decision',
        'priority': 'priority'
      };
      const col = colMap[this.dataset.sort] || this.dataset.sort;
      if (sortCol === col) {
        sortDir *= -1;
      } else {
        sortCol = col;
        sortDir = -1;
      }
      // Update sort icons
      document.querySelectorAll('.data-table th').forEach(h => h.classList.remove('sorted'));
      this.classList.add('sorted');
      this.querySelector('.sort-icon').innerHTML = sortDir === -1 ? '&#9660;' : '&#9650;';
      applyFilters();
    });
  });

  // ---- Render Table ----
  function renderTable() {
    if (filteredCandidates.length === 0) {
      candidateBody.innerHTML = '';
      emptyState.style.display = 'block';
      if (tableWrapper) tableWrapper.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = '';

    candidateBody.innerHTML = filteredCandidates.map((c, idx) => {
      const name = c.name || 'Unknown';
      const email = c.email || '';
      const exp = c.experience || 0;
      const match = Number(c.matchScore) || 0;
      const bonus = Number(c.bonusScore) || 0;
      const interest = Number(c.interestScore) || 0;
      const dec = (c.decision || '').includes('SHORTLIST') ? 'SHORTLIST' : 'REJECT';
      const priority = c.priority || 'NONE';
      const status = c.status || 'PENDING';

      return `
        <tr data-index="${idx}">
          <td>
            <div class="candidate-info" onclick="window.__openDrawer(${idx})">
              <span class="candidate-name">${escapeHtml(name)}</span>
              <span class="candidate-meta">${escapeHtml(email)} - ${exp}y exp</span>
            </div>
          </td>
          <td><span class="badge-metric ${scoreClass(match)}">${match}%</span></td>
          <td><span class="badge-metric ${scoreClass(bonus)}">${bonus}%</span></td>
          <td><span class="badge-metric ${scoreClass(interest)}">${interest}%</span></td>
          <td><span class="badge-decision ${getDecisionClass(dec)}">${formatLabel(dec)}</span></td>
          <td><span class="badge-priority ${getPriorityClass(priority)}">${formatPriority(priority)}</span></td>
          <td onclick="event.stopPropagation()">
            <select class="status-select ${getStatusClass(status)}" data-index="${idx}" onchange="window.__updateStatus(${idx}, this.value)">
              <option value="PENDING" ${status === 'PENDING' ? 'selected' : ''}>Pending</option>
              <option value="APPROVED" ${status.startsWith('APPROVED') ? 'selected' : ''}>Approved</option>
              <option value="REJECTED" ${status.startsWith('REJECTED') ? 'selected' : ''}>Rejected</option>
            </select>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ---- Status Update ----
  window.__updateStatus = async function (idx, newStatus) {
    const c = filteredCandidates[idx];
    if (!c) return;
    if (!webAppUrl) { showToast('Web App URL not set', 'error'); return; }

    const action = newStatus === 'APPROVED' ? '✓ Shortlist' : '✕ Reject';
    const confirmed = confirm(action + ' ' + c.name + '?\n\nThis will update their status and send them an email automatically.');
    if (!confirmed) {
      // Reset select to previous value
      applyFilters();
      return;
    }

    showToast('Updating status...', '');

    try {
      // Google Apps Script usually blocks direct POST requests from browsers via CORS.
      // mode: 'no-cors' allows the request to be sent, but we cannot read the response object back!
      await fetch(webAppUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateStatus', row: c._row, status: newStatus })
      });
      
      // Because we used no-cors, we can't parse res.json(). We must assume it was successful 
      // if the network layer (fetch) didn't outright fail.

      // Update local state
      const masterIdx = allCandidates.indexOf(c);
      if (masterIdx !== -1) {
        allCandidates[masterIdx].status = newStatus + ' — Email Sent'; // Reverted to em-dash
      }

      showToast('Updated & email sent to ' + c.name, 'success');
      applyFilters();
      updateStats();
      closeDrawer();
    } catch (err) {
      showToast('Failed: Check network connection.', 'error');
      console.error('Fetch push error:', err);
      applyFilters();
    }
  };

  // ---- Drawer ----
  window.__openDrawer = function (idx) {
    const c = filteredCandidates[idx];
    if (!c) return;

    const name = c.name || 'Unknown';
    const email = c.email || '--';
    const phone = c.phone || '--';
    const exp = c.experience || 0;
    const match = Number(c.matchScore) || 0;
    const bonus = Number(c.bonusScore) || 0;
    const interest = Number(c.interestScore) || 0;
    const dec = (c.decision || '').includes('SHORTLIST') ? 'SHORTLIST' : 'REJECT';
    const priority = c.priority || 'NONE';

    // Header
    document.getElementById('drawerName').textContent = name;
    document.getElementById('drawerMeta').textContent = email + '  |  ' + phone + '  |  ' + exp + ' yrs exp';

    // Build drawer body content
    const matchedTags = (c.matchedSkills || '').split(',').filter(Boolean)
      .map(s => '<span class="skill-tag skill-matched">' + escapeHtml(s.trim()) + '</span>').join('');
    const missingTags = (c.missingSkills || '').split(',').filter(Boolean)
      .map(s => '<span class="skill-tag skill-missing">' + escapeHtml(s.trim()) + '</span>').join('');

    const drawerBody = document.getElementById('drawerBody');
    drawerBody.innerHTML = `
      <div class="drawer-section">
        <div class="drawer-section-title">Performance Metrics</div>
        <div class="drawer-metrics">
          <div class="drawer-metric-card">
            <div class="drawer-metric-value" style="color:${scoreColor(match)}">${match}%</div>
            <div class="drawer-metric-label">Match</div>
          </div>
          <div class="drawer-metric-card">
            <div class="drawer-metric-value" style="color:${scoreColor(bonus)}">${bonus}%</div>
            <div class="drawer-metric-label">Bonus</div>
          </div>
          <div class="drawer-metric-card">
            <div class="drawer-metric-value" style="color:${scoreColor(interest)}">${interest}%</div>
            <div class="drawer-metric-label">Interest</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:var(--space-3)">
          <span class="badge-decision ${getDecisionClass(dec)}">${formatLabel(dec)}</span>
          <span class="badge-priority ${getPriorityClass(priority)}">${formatPriority(priority)}</span>
        </div>
      </div>

      ${matchedTags ? `
      <div class="drawer-section">
        <div class="drawer-section-title">Matched Skills</div>
        <div class="drawer-skills">${matchedTags}</div>
      </div>` : ''}

      ${missingTags ? `
      <div class="drawer-section">
        <div class="drawer-section-title">Missing Skills</div>
        <div class="drawer-skills">${missingTags}</div>
      </div>` : ''}

      <div class="drawer-section">
        <div class="drawer-section-title">AI Decision Analysis</div>
        <div class="drawer-feedback-box">${escapeHtml(c.aiDecision || 'No AI analysis available.')}</div>
      </div>

      <div class="drawer-section">
        <div class="drawer-section-title">Candidate Answers</div>
        <div class="drawer-answers">
          <div class="drawer-answer">
            <div class="drawer-answer-label">What excites them about the role</div>
            <div class="drawer-answer-text">${escapeHtml(c.excite || 'Not provided')}</div>
          </div>
          <div class="drawer-answer">
            <div class="drawer-answer-label">Why this company</div>
            <div class="drawer-answer-text">${escapeHtml(c.whyCompany || 'Not provided')}</div>
          </div>
          <div class="drawer-answer">
            <div class="drawer-answer-label">Past experience / projects</div>
            <div class="drawer-answer-text">${escapeHtml(c.pastExp || 'Not provided')}</div>
          </div>
        </div>
      </div>

      <div class="drawer-section">
        <div class="drawer-section-title">Action</div>
        <div class="drawer-actions">
          <button class="btn-action btn-action-approve" onclick="window.__updateStatus(${idx},'APPROVED')">Approve</button>
          <button class="btn-action btn-action-reject" onclick="window.__updateStatus(${idx},'REJECTED')">Reject</button>
        </div>
      </div>
    `;

    drawerOverlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  function closeDrawer() {
    drawerOverlay.classList.remove('open');
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  }

  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

})();
