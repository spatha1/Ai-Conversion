/* ═══════════════════════════════════════════════════════════
   workflowHandler.js — PS Workflow Management Page
   LangGraph-style visual workflow editor + scheduler + email settings
   ═══════════════════════════════════════════════════════════ */
var WorkflowHandler = (function () {
  'use strict';

  var API_BASE = 'http://localhost:8000/api';
  var _workflows = [];
  var _selectedWf = null;

  /* ── Icons ──────────────────────────────────────────────── */
  var STEP_ICONS = { sql: '🗃', api: '⚡', api_loop: '🔁', email: '📧' };
  var STEP_COLORS = { sql: '#3b82f6', api: '#8b5cf6', api_loop: '#7c3aed', email: '#f59e0b' };
  var STATUS_ICONS = { success: '✅', failed: '❌', running: '⏳', partial: '⚠️', pending: '⏸' };

  /* ── Public API ──────────────────────────────────────────── */
  function init() {
    // Workflows now lives inside #ps-page-workflows (PS section)
    var tab = document.getElementById('wf-list');
    if (!tab) return;
    _loadWorkflows();
    document.getElementById('btn-wf-new')?.addEventListener('click', _showCreateModal);
  }

  /* ══════════════════════════════════════════════════════════
     Workflow List
  ══════════════════════════════════════════════════════════ */
  async function _loadWorkflows() {
    try {
      var res = await fetch(API_BASE + '/ps/workflows');
      _workflows = res.ok ? await res.json() : [];
    } catch (_) { _workflows = []; }
    _renderList();
    if (_workflows.length > 0) _selectWorkflow(_workflows[0].id);
  }

  function _renderList() {
    var list = document.getElementById('wf-list');
    if (!list) return;
    if (_workflows.length === 0) {
      list.innerHTML = '<div class="wf-list-empty">No workflows yet.<br>Save one from PS chat →</div>';
      return;
    }
    list.innerHTML = '';
    _workflows.forEach(function (wf) {
      var item = document.createElement('div');
      item.className = 'wf-list-item' + (_selectedWf && _selectedWf.id === wf.id ? ' active' : '');
      item.dataset.id = wf.id;
      var schedBadge = '';
      if (wf.schedule) {
        var st = wf.schedule.schedule_type;
        var enabled = wf.schedule.is_enabled;
        schedBadge = '<span class="wf-sched-badge ' + (enabled && st !== 'manual' ? 'enabled' : 'manual') + '">' +
          (st === 'manual' ? '⏸ manual' : (enabled ? '🕐 ' + st : '⏸ paused')) + '</span>';
      }
      var lastStatus = wf.last_run ? STATUS_ICONS[wf.last_run.status] || '' : '';
      item.innerHTML =
        '<div class="wf-list-name">' + _esc(wf.name) + '</div>' +
        '<div class="wf-list-meta">' +
          '<span>' + (wf.steps ? wf.steps.length : 0) + ' steps</span>' +
          (lastStatus ? '<span>' + lastStatus + ' last run</span>' : '') +
          schedBadge +
        '</div>';
      item.addEventListener('click', function () { _selectWorkflow(wf.id); });
      list.appendChild(item);
    });
  }

  async function _selectWorkflow(id) {
    try {
      var res = await fetch(API_BASE + '/ps/workflows/' + id);
      if (!res.ok) return;
      _selectedWf = await res.json();
    } catch (_) { return; }
    _renderDetail();
    _renderList(); // refresh active state
  }

  /* ══════════════════════════════════════════════════════════
     Workflow Detail
  ══════════════════════════════════════════════════════════ */
  function _renderDetail() {
    var detail = document.getElementById('wf-detail');
    if (!detail || !_selectedWf) return;

    _propsPanelOpen = false;  // reset when switching workflows
    var wf = _selectedWf;
    detail.innerHTML =
      '<div class="wf-detail-header">' +
        '<div>' +
          '<div class="wf-detail-title">' + _esc(wf.name) + '</div>' +
          (wf.description ? '<div class="wf-detail-desc">' + _esc(wf.description) + '</div>' : '') +
        '</div>' +
        '<div class="wf-detail-actions">' +
          '<button class="btn btn-primary btn-sm" id="btn-wf-run-now">▶ Run Now</button>' +
          '<button class="btn btn-xs-secondary" id="btn-wf-properties">⚙ Properties</button>' +
          '<button class="btn btn-xs-secondary" id="btn-wf-clone">⎘ Clone</button>' +
          '<button class="btn btn-xs-secondary" id="btn-wf-delete" style="color:#ef4444">🗑 Delete</button>' +
        '</div>' +
      '</div>' +
      '<div id="wf-properties-panel"></div>' +
      '<div class="wf-section-label">Workflow</div>' +
      '<div id="wf-graph-container" class="wf-graph-container"></div>' +
      '<div class="wf-panels-row">' +
        '<div class="wf-panel wf-schedule-panel">' +
          '<div class="wf-panel-title">⏱ Schedule</div>' +
          '<div id="wf-schedule-form"></div>' +
        '</div>' +
        '<div class="wf-panel wf-history-panel">' +
          '<div class="wf-panel-title">📋 Run History</div>' +
          '<div id="wf-run-history"></div>' +
        '</div>' +
      '</div>';

    _renderGraph(wf);
    _renderScheduleForm(wf);
    _loadRunHistory(wf.id);

    document.getElementById('btn-wf-run-now').addEventListener('click', function () {
      _runNow(wf.id);
    });
    document.getElementById('btn-wf-properties').addEventListener('click', function () {
      _togglePropertiesPanel(wf);
    });
    document.getElementById('btn-wf-clone').addEventListener('click', function () {
      _cloneWorkflow(wf.id);
    });
    document.getElementById('btn-wf-delete').addEventListener('click', function () {
      if (confirm('Delete workflow "' + wf.name + '"?')) _deleteWorkflow(wf.id);
    });
  }

  /* ── LangGraph-style graph ─────────────────────────────── */
  function _renderGraph(wf) {
    var container = document.getElementById('wf-graph-container');
    if (!container) return;
    container.innerHTML = '';

    var graph = document.createElement('div');
    graph.className = 'wf-graph';

    // START node
    graph.appendChild(_makeNode('start', '▶', 'START', null, null));

    wf.steps.forEach(function (step, idx) {
      graph.appendChild(_makeEdge());
      graph.appendChild(_makeNode(step.step_type, STEP_ICONS[step.step_type] || '?', step.label || step.step_type, step, null));
    });

    // END node
    graph.appendChild(_makeEdge());
    graph.appendChild(_makeNode('end', '⏹', 'END', null, null));

    container.appendChild(graph);
  }

  function _makeNode(type, icon, label, step, status) {
    var wrap = document.createElement('div');
    wrap.className = 'wf-graph-node';

    var iconDiv = document.createElement('div');
    iconDiv.className = 'wf-graph-icon wf-type-' + type + (status ? ' wf-status-' + status : '');
    iconDiv.textContent = icon;
    iconDiv.title = label;

    var labelDiv = document.createElement('div');
    labelDiv.className = 'wf-graph-label';
    labelDiv.textContent = label.length > 16 ? label.slice(0, 14) + '…' : label;

    wrap.appendChild(iconDiv);
    wrap.appendChild(labelDiv);

    if (step) {
      iconDiv.style.cursor = 'pointer';
      iconDiv.addEventListener('click', function () { _showStepDetail(step); });
    }
    return wrap;
  }

  function _makeEdge() {
    var e = document.createElement('div');
    e.className = 'wf-graph-edge';
    return e;
  }

  function _showStepDetail(step) {
    var cfg = {};
    try { cfg = JSON.parse(step.config_json || '{}'); } catch (_) {}
    var info = '';
    if (step.step_type === 'sql') {
      info = '<pre class="wf-step-sql">' + _esc(cfg.sql || '') + '</pre>';
    } else if (step.step_type === 'api') {
      info = '<div>API ID: ' + _esc(String(cfg.api_id || '')) + '</div>' +
             '<pre class="wf-step-sql">' + _esc(JSON.stringify(cfg.payload || {}, null, 2)) + '</pre>';
    } else if (step.step_type === 'email') {
      info = '<div><strong>To:</strong> ' + _esc(cfg.to || '') + '</div>' +
             '<div><strong>Subject:</strong> ' + _esc(cfg.subject || '') + '</div>' +
             '<div class="wf-step-body">' + _escHtml(cfg.body || '') + '</div>';
    }
    _showModal('Step: ' + _esc(step.label || step.step_type), info);
  }

  /* ── Schedule form ─────────────────────────────────────── */
  function _renderScheduleForm(wf) {
    var el = document.getElementById('wf-schedule-form');
    if (!el) return;
    var s = wf.schedule || {};
    var type = s.schedule_type || 'manual';
    el.innerHTML =
      '<div class="wf-form-row">' +
        '<label>Type</label>' +
        '<select id="wf-sched-type">' +
          '<option value="manual"' + (type==='manual' ? ' selected' : '') + '>Manual only</option>' +
          '<option value="interval"' + (type==='interval' ? ' selected' : '') + '>Every N minutes</option>' +
          '<option value="daily"' + (type==='daily' ? ' selected' : '') + '>Daily at time</option>' +
          '<option value="weekly"' + (type==='weekly' ? ' selected' : '') + '>Weekly</option>' +
        '</select>' +
      '</div>' +
      '<div id="wf-sched-options"></div>' +
      '<div class="wf-form-row" id="wf-sched-enabled-row" style="' + (type==='manual' ? 'display:none' : '') + '">' +
        '<label>Enabled</label>' +
        '<input type="checkbox" id="wf-sched-enabled"' + (s.is_enabled ? ' checked' : '') + '>' +
      '</div>' +
      (s.next_run_at ? '<div class="wf-sched-next">Next run: ' + new Date(s.next_run_at).toLocaleString() + '</div>' : '') +
      '<button class="btn btn-primary btn-sm" id="btn-save-schedule" style="margin-top:10px">Save Schedule</button>';

    _updateSchedOptions(type, s);
    document.getElementById('wf-sched-type').addEventListener('change', function () {
      var t = this.value;
      _updateSchedOptions(t, s);
      document.getElementById('wf-sched-enabled-row').style.display = t === 'manual' ? 'none' : '';
    });
    document.getElementById('btn-save-schedule').addEventListener('click', function () {
      _saveSchedule(wf.id);
    });
  }

  function _updateSchedOptions(type, s) {
    var el = document.getElementById('wf-sched-options');
    if (!el) return;
    if (type === 'interval') {
      el.innerHTML = '<div class="wf-form-row"><label>Every (min)</label>' +
        '<input type="number" id="wf-sched-interval" value="' + (s.interval_minutes || 60) + '" min="1" style="width:80px"></div>';
    } else if (type === 'daily') {
      el.innerHTML = '<div class="wf-form-row"><label>At time</label>' +
        '<input type="time" id="wf-sched-time" value="' + (s.run_at_time || '09:00') + '"></div>';
    } else if (type === 'weekly') {
      var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      var dayOpts = days.map(function (d, i) {
        return '<option value="' + i + '"' + (s.run_on_day === i ? ' selected' : '') + '>' + d + '</option>';
      }).join('');
      el.innerHTML = '<div class="wf-form-row"><label>Day</label><select id="wf-sched-day">' + dayOpts + '</select></div>' +
        '<div class="wf-form-row"><label>At time</label><input type="time" id="wf-sched-time" value="' + (s.run_at_time || '09:00') + '"></div>';
    } else {
      el.innerHTML = '';
    }
  }

  async function _saveSchedule(wfId) {
    var type = document.getElementById('wf-sched-type').value;
    var enabled = document.getElementById('wf-sched-enabled')?.checked ?? (type !== 'manual');
    var payload = { schedule_type: type, is_enabled: enabled };
    if (type === 'interval') payload.interval_minutes = parseInt(document.getElementById('wf-sched-interval')?.value || '60');
    if (type === 'daily' || type === 'weekly') payload.run_at_time = document.getElementById('wf-sched-time')?.value || '09:00';
    if (type === 'weekly') payload.run_on_day = parseInt(document.getElementById('wf-sched-day')?.value || '0');
    try {
      var res = await fetch(API_BASE + '/ps/workflows/' + wfId + '/schedule', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json();
      if (res.ok) {
        window.toast && window.toast('success', 'Schedule saved' + (data.next_run_at ? ' · next: ' + new Date(data.next_run_at).toLocaleString() : ''));
        _selectWorkflow(wfId);
      } else {
        window.toast && window.toast('error', data.detail || 'Save failed');
      }
    } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
  }

  /* ── Run history ───────────────────────────────────────── */
  async function _loadRunHistory(wfId) {
    var el = document.getElementById('wf-run-history');
    if (!el) return;
    el.innerHTML = '<div class="wf-loading">Loading…</div>';
    try {
      var res = await fetch(API_BASE + '/ps/workflows/' + wfId + '/runs?limit=10');
      if (!res.ok) { el.innerHTML = '<div class="wf-list-empty">No runs yet.</div>'; return; }
      var runs = await res.json();
      if (runs.length === 0) { el.innerHTML = '<div class="wf-list-empty">No runs yet. Click ▶ Run Now.</div>'; return; }
      el.innerHTML = '';
      runs.forEach(function (run) {
        var item = document.createElement('div');
        item.className = 'wf-run-item';
        var stepSummary = (run.steps || []).map(function (s) {
          var errTip = s.error ? ' title="' + _esc(s.error) + '"' : '';
          var errMsg = s.error ? '<span class="wf-run-step-error">⚠ ' + _esc(s.error) + '</span>' : '';
          return '<span class="wf-run-step-badge wf-run-step-' + s.status + '"' + errTip + '>' +
            (STATUS_ICONS[s.status] || '') + ' ' + _esc(s.label || s.step_type || '') + '</span>' + errMsg;
        }).join('');
        item.innerHTML =
          '<div class="wf-run-header">' +
            '<span class="wf-run-status wf-run-s-' + run.status + '">' + (STATUS_ICONS[run.status] || run.status) + ' ' + run.status + '</span>' +
            '<span class="wf-run-time">' + (run.started_at ? new Date(run.started_at).toLocaleString() : '') + '</span>' +
            '<span class="wf-run-by">' + (run.triggered_by || '') + '</span>' +
          '</div>' +
          (stepSummary ? '<div class="wf-run-steps">' + stepSummary + '</div>' : '');
        el.appendChild(item);
      });
    } catch (_) { el.innerHTML = '<div class="wf-list-empty">Failed to load history.</div>'; }
  }

  /* ── Run now ───────────────────────────────────────────── */
  async function _runNow(wfId) {
    var btn = document.getElementById('btn-wf-run-now');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
    try {
      var res = await fetch(API_BASE + '/ps/workflows/' + wfId + '/run', { method: 'POST' });
      var data = await res.json();
      if (res.ok) {
        var statusMsg = data.status === 'success' ? '✅ Run completed' :
                        data.status === 'partial' ? '⚠️ Partial success' : '❌ Run failed';
        window.toast && window.toast(data.status === 'success' ? 'success' : 'warning', statusMsg);
        _selectWorkflow(wfId);
      } else {
        window.toast && window.toast('error', data.detail || 'Run failed');
      }
    } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
    finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ Run Now'; }
    }
  }

  /* ── Delete workflow ──────────────────────────────────── */
  async function _deleteWorkflow(wfId) {
    try {
      await fetch(API_BASE + '/ps/workflows/' + wfId, { method: 'DELETE' });
      _selectedWf = null;
      document.getElementById('wf-detail').innerHTML = '<div class="wf-list-empty" style="padding:40px;text-align:center">Select a workflow from the left.</div>';
      await _loadWorkflows();
    } catch (_) { window.toast && window.toast('error', 'Delete failed'); }
  }

  /* ── Clone workflow ────────────────────────────────────── */
  async function _cloneWorkflow(wfId) {
    try {
      var res = await fetch(API_BASE + '/ps/workflows/' + wfId + '/clone', { method: 'POST' });
      var data = await res.json();
      if (res.ok) {
        window.toast && window.toast('success', 'Cloned as "' + data.name + '"');
        await _loadWorkflows();
        _selectWorkflow(data.id);
      } else {
        window.toast && window.toast('error', data.detail || 'Clone failed');
      }
    } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
  }

  /* ── Properties / Settings panel ───────────────────────── */
  var _propsPanelOpen = false;

  function _togglePropertiesPanel(wf) {
    var panel = document.getElementById('wf-properties-panel');
    if (!panel) return;
    if (_propsPanelOpen) {
      panel.innerHTML = '';
      _propsPanelOpen = false;
      document.getElementById('btn-wf-properties').textContent = '⚙ Properties';
      return;
    }
    _propsPanelOpen = true;
    document.getElementById('btn-wf-properties').textContent = '⚙ Close';
    _renderPropertiesPanel(wf, panel);
  }

  function _renderPropertiesPanel(wf, panel) {
    var stepsHtml = (wf.steps || []).map(function (s) {
      var cfg = {};
      try { cfg = JSON.parse(s.config_json || '{}'); } catch (_) {}

      var configEditor = '';
      if (s.step_type === 'sql') {
        configEditor =
          '<label class="wf-prop-field-label">SQL Query</label>' +
          '<textarea class="wf-prop-textarea" data-step-id="' + s.id + '" data-field="sql">' + _esc(cfg.sql || '') + '</textarea>';
      } else if (s.step_type === 'api') {
        configEditor =
          '<label class="wf-prop-field-label">API ID</label>' +
          '<input type="number" class="wf-input wf-prop-inline" data-step-id="' + s.id + '" data-field="api_id" value="' + (cfg.api_id || '') + '">' +
          '<label class="wf-prop-field-label">Payload (JSON)</label>' +
          '<textarea class="wf-prop-textarea" data-step-id="' + s.id + '" data-field="payload">' + _esc(JSON.stringify(cfg.payload || {}, null, 2)) + '</textarea>';
      } else if (s.step_type === 'email') {
        configEditor =
          '<label class="wf-prop-field-label">To</label>' +
          '<input type="text" class="wf-input" data-step-id="' + s.id + '" data-field="to" value="' + _esc(cfg.to || '') + '">' +
          '<label class="wf-prop-field-label">Subject</label>' +
          '<input type="text" class="wf-input" data-step-id="' + s.id + '" data-field="subject" value="' + _esc(cfg.subject || '') + '">' +
          '<label class="wf-prop-field-label">Body</label>' +
          '<textarea class="wf-prop-textarea" data-step-id="' + s.id + '" data-field="body">' + _esc(cfg.body || '') + '</textarea>';
      }

      return '<div class="wf-prop-step" data-step-id="' + s.id + '">' +
        '<div class="wf-prop-step-header">' +
          '<span class="wf-step-type-badge wf-step-type-' + s.step_type + '">' + (STEP_ICONS[s.step_type] || '') + ' ' + s.step_type.toUpperCase() + '</span>' +
          '<input type="text" class="wf-input wf-prop-label-input" data-step-id="' + s.id + '" data-field="label" value="' + _esc(s.label || '') + '" placeholder="Step label">' +
          '<button class="btn btn-xs-secondary wf-prop-step-save" data-step-id="' + s.id + '">Save</button>' +
        '</div>' +
        configEditor +
      '</div>';
    }).join('');

    panel.innerHTML =
      '<div class="wf-props-panel">' +
        '<div class="wf-panel-title">⚙ Properties</div>' +
        '<div class="wf-form-row">' +
          '<label>Name</label>' +
          '<input type="text" id="wf-prop-name" class="wf-input" value="' + _esc(wf.name) + '">' +
        '</div>' +
        '<div class="wf-form-row">' +
          '<label>Description</label>' +
          '<input type="text" id="wf-prop-desc" class="wf-input" value="' + _esc(wf.description || '') + '">' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:12px">' +
          '<button class="btn btn-primary btn-sm" id="btn-wf-save-props">Save Name/Desc</button>' +
        '</div>' +
        '<div class="wf-panel-title" style="margin-top:8px">Steps</div>' +
        (stepsHtml || '<div class="wf-list-empty">No steps.</div>') +
      '</div>';

    document.getElementById('btn-wf-save-props').addEventListener('click', async function () {
      var name = document.getElementById('wf-prop-name').value.trim();
      var desc = document.getElementById('wf-prop-desc').value.trim();
      if (!name) return;
      try {
        var res = await fetch(API_BASE + '/ps/workflows/' + wf.id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, description: desc || null }),
        });
        if (res.ok) {
          window.toast && window.toast('success', 'Workflow updated');
          _propsPanelOpen = false;
          _selectWorkflow(wf.id);
          await _loadWorkflows();
        } else {
          var d = await res.json();
          window.toast && window.toast('error', d.detail || 'Save failed');
        }
      } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
    });

    // Per-step save buttons
    panel.querySelectorAll('.wf-prop-step-save').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var stepId = parseInt(btn.dataset.stepId);
        var stepEl = panel.querySelector('.wf-prop-step[data-step-id="' + stepId + '"]');
        if (!stepEl) return;

        var label = stepEl.querySelector('[data-field="label"]')?.value.trim() || '';
        var stepType = stepEl.querySelector('.wf-step-type-badge')?.className.includes('sql') ? 'sql' :
                       stepEl.querySelector('.wf-step-type-badge')?.className.includes('api') ? 'api' : 'email';

        // Rebuild config from fields
        var newCfg = {};
        if (stepType === 'sql') {
          newCfg.sql = stepEl.querySelector('[data-field="sql"]')?.value || '';
        } else if (stepType === 'api') {
          newCfg.api_id = parseInt(stepEl.querySelector('[data-field="api_id"]')?.value) || null;
          try { newCfg.payload = JSON.parse(stepEl.querySelector('[data-field="payload"]')?.value || '{}'); } catch (_) { newCfg.payload = {}; }
        } else {
          newCfg.to      = stepEl.querySelector('[data-field="to"]')?.value || '';
          newCfg.subject = stepEl.querySelector('[data-field="subject"]')?.value || '';
          newCfg.body    = stepEl.querySelector('[data-field="body"]')?.value || '';
        }

        try {
          var res = await fetch(API_BASE + '/ps/workflows/' + wf.id + '/steps/' + stepId, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: label, config_json: JSON.stringify(newCfg) }),
          });
          if (res.ok) {
            window.toast && window.toast('success', 'Step saved');
            // Refresh workflow data in background, keep panel open
            var fresh = await fetch(API_BASE + '/ps/workflows/' + wf.id);
            if (fresh.ok) { _selectedWf = await fresh.json(); }
            _renderGraph(_selectedWf);
          } else {
            var d = await res.json();
            window.toast && window.toast('error', d.detail || 'Step save failed');
          }
        } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
      });
    });
  }

  /* ── Create from conversation modal ───────────────────── */
  function _showCreateModal(convId, steps) {
    var stepsHtml = (steps || []).map(function (s, i) {
      var raw = s.label || '';
      // Build a short human-readable title (not the SQL itself — that goes in the preview)
      var stepTitle = 'Step ' + (i + 1);
      if (s.step_type === 'sql') {
        var sql = raw.replace(/^SQL:\s*/i, '').trim().toUpperCase();
        if (sql.startsWith('SELECT'))       stepTitle = 'Step ' + (i + 1) + ' \u2014 SELECT query';
        else if (sql.startsWith('UPDATE'))  stepTitle = 'Step ' + (i + 1) + ' \u2014 UPDATE';
        else if (sql.startsWith('INSERT'))  stepTitle = 'Step ' + (i + 1) + ' \u2014 INSERT';
        else if (sql.startsWith('DELETE'))  stepTitle = 'Step ' + (i + 1) + ' \u2014 DELETE';
        else                                stepTitle = 'Step ' + (i + 1) + ' \u2014 SQL';
      } else if (s.step_type === 'api')      { stepTitle = 'Step ' + (i + 1) + ' \u2014 API call'; }
        else if (s.step_type === 'api_loop') { stepTitle = 'Step ' + (i + 1) + ' \u2014 Bulk API loop'; }
        else if (s.step_type === 'email')    { stepTitle = 'Step ' + (i + 1) + ' \u2014 Send email'; }

      // Show the raw SQL/payload in the preview block
      var previewHtml = '';
      if (s.step_type === 'sql' || s.step_type === 'api_loop') {
        var preview = raw.replace(/^(SQL|Bulk API[^:]*|API[^:]*):\s*/i, '').trim();
        previewHtml = '<pre class="wf-step-preview">' + _esc(preview) + '</pre>';
      } else if (s.step_type === 'api' || s.step_type === 'email') {
        var preview2 = raw.replace(/^[^:]+:\s*/i, '').trim();
        if (preview2) previewHtml = '<div class="wf-step-preview-text">' + _esc(preview2) + '</div>';
      }

      return '<div class="wf-step-item">' +
        '<label class="wf-step-check">' +
          '<input type="checkbox" name="step" value="' + i + '" checked>' +
          '<span class="wf-step-type-badge wf-step-type-' + s.step_type + '">' + (STEP_ICONS[s.step_type] || '') + ' ' + s.step_type.replace('_', ' ').toUpperCase() + '</span>' +
          '<span class="wf-step-label">' + _esc(stepTitle) + '</span>' +
        '</label>' +
        previewHtml +
      '</div>';
    }).join('');

    var body =
      '<div class="wf-form-row"><label>Name *</label><input type="text" id="wf-create-name" placeholder="e.g. Fix EMP Records" class="wf-input" required></div>' +
      '<div class="wf-form-row"><label>Description</label><input type="text" id="wf-create-desc" placeholder="Optional description" class="wf-input"></div>' +
      (stepsHtml ? '<div class="wf-form-row"><label>Steps to include</label><div class="wf-steps-list">' + stepsHtml + '</div></div>' : '') +
      '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="btn btn-ghost" id="btn-wf-cancel-create">Cancel</button>' +
        '<button class="btn btn-primary" id="btn-wf-confirm-create">Save Workflow</button>' +
      '</div>';

    _showModal('Save as Workflow', body);

    document.getElementById('btn-wf-cancel-create').addEventListener('click', _closeModal);
    document.getElementById('btn-wf-confirm-create').addEventListener('click', async function () {
      var name = document.getElementById('wf-create-name').value.trim();
      if (!name) { document.getElementById('wf-create-name').focus(); return; }
      var desc = document.getElementById('wf-create-desc').value.trim();
      var checked = Array.from(document.querySelectorAll('input[name="step"]:checked'))
                         .map(function (el) { return parseInt(el.value); });
      try {
        var res = await fetch(API_BASE + '/ps/workflows/from-conversation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: convId, name: name, description: desc || null, step_indices: checked }),
        });
        var data = await res.json();
        if (res.ok) {
          _closeModal();
          window.toast && window.toast('success', 'Workflow "' + name + '" saved (' + (data.steps ? data.steps.length : '') + ' steps)');
          await _loadWorkflows();
          // Switch to PS → Workflows tab
          if (window._switchSection) window._switchSection('ps');
          if (window._switchPsTab)   window._switchPsTab('workflows');
        } else {
          window.toast && window.toast('error', data.detail || 'Failed to save workflow');
        }
      } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
    });
  }

  /* ── Email settings form ───────────────────────────────── */
  async function _showEmailSettingsForm() {
    var current = {};
    try {
      var res = await fetch(API_BASE + '/ps/email-settings');
      if (res.ok) current = await res.json();
    } catch (_) {}

    var body =
      '<div class="wf-form-row"><label>SMTP Host</label><input type="text" id="em-host" value="' + _esc(current.smtp_host || '') + '" class="wf-input" placeholder="smtp.gmail.com"></div>' +
      '<div class="wf-form-row"><label>Port</label><input type="number" id="em-port" value="' + (current.smtp_port || 587) + '" class="wf-input" style="width:80px"></div>' +
      '<div class="wf-form-row"><label>Username</label><input type="text" id="em-user" value="' + _esc(current.smtp_user || '') + '" class="wf-input"></div>' +
      '<div class="wf-form-row"><label>Password</label><input type="password" id="em-pass" class="wf-input" placeholder="' + (current.has_password ? '(saved — leave blank to keep)' : 'enter password') + '"></div>' +
      '<div class="wf-form-row"><label>From Address</label><input type="email" id="em-from" value="' + _esc(current.from_address || '') + '" class="wf-input"></div>' +
      '<div class="wf-form-row"><label>Use TLS</label><input type="checkbox" id="em-tls"' + (current.use_tls !== false ? ' checked' : '') + '></div>' +
      '<div style="margin-top:14px;display:flex;gap:8px">' +
        '<button class="btn btn-ghost" id="btn-em-test">📨 Test</button>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-ghost" id="btn-em-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="btn-em-save">Save</button>' +
      '</div>';

    _showModal('Email Settings (SMTP)', body);

    document.getElementById('btn-em-cancel').addEventListener('click', _closeModal);
    document.getElementById('btn-em-save').addEventListener('click', async function () {
      var payload = {
        smtp_host:    document.getElementById('em-host').value.trim(),
        smtp_port:    parseInt(document.getElementById('em-port').value) || 587,
        smtp_user:    document.getElementById('em-user').value.trim() || null,
        smtp_pass:    document.getElementById('em-pass').value || null,
        from_address: document.getElementById('em-from').value.trim(),
        use_tls:      document.getElementById('em-tls').checked,
      };
      if (!payload.smtp_host || !payload.from_address) {
        window.toast && window.toast('warning', 'SMTP host and From address are required.');
        return;
      }
      try {
        var res = await fetch(API_BASE + '/ps/email-settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) { _closeModal(); window.toast && window.toast('success', 'Email settings saved'); }
        else { var d = await res.json(); window.toast && window.toast('error', d.detail || 'Save failed'); }
      } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
    });
    document.getElementById('btn-em-test').addEventListener('click', async function () {
      var to = prompt('Send test email to:');
      if (!to) return;
      try {
        var res = await fetch(API_BASE + '/ps/email-settings/test', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to, subject: 'Test from Data Conversion Studio', body: 'This is a test email.' }),
        });
        var d = await res.json();
        if (res.ok) window.toast && window.toast('success', 'Test email sent to ' + to);
        else window.toast && window.toast('error', d.detail || 'Send failed');
      } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
    });
  }

  /* ── Modal helpers ─────────────────────────────────────── */
  function _showModal(title, bodyHtml) {
    var existing = document.getElementById('wf-modal-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'wf-modal-overlay';
    overlay.className = 'wf-modal-overlay';
    overlay.innerHTML =
      '<div class="wf-modal">' +
        '<div class="wf-modal-header">' +
          '<span>' + title + '</span>' +
          '<button class="wf-modal-close" id="btn-wf-modal-close">✕</button>' +
        '</div>' +
        '<div class="wf-modal-body">' + bodyHtml + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeModal(); });
    document.getElementById('btn-wf-modal-close').addEventListener('click', _closeModal);
  }

  function _closeModal() {
    var overlay = document.getElementById('wf-modal-overlay');
    if (overlay) overlay.remove();
  }

  /* ── Utilities ─────────────────────────────────────────── */
  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _escHtml(s) { return _esc(s).replace(/\n/g,'<br>'); }

  /* ── Public surface ────────────────────────────────────── */
  return {
    init: init,
    refresh: _loadWorkflows,            // called when Workflows tab becomes visible
    showCreateModal: _showCreateModal,  // called from psHandler.js
    showEmailSettings: _showEmailSettingsForm,
  };
})();
