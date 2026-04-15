/* ═══════════════════════════════════════════════════════════
   devHandler.js — Development Module
   • AI-powered data engineering plan generator
   • Pipeline-level Generate All / Validate All
   • BRD → Acceptance Criteria analysis
   • JIRA / ADO export from AC plan
   • Git repository check-in
   ═══════════════════════════════════════════════════════════ */
var DevHandler = (function () {
  'use strict';

  var API_BASE = 'http://localhost:8000/api';

  /* ── State ──────────────────────────────────────────────── */
  var _connId      = null;
  var _model       = 'gpt-4o-mini';
  var _artifactId  = null;
  var _steps       = [];        // current plan steps
  var _acCriteria  = [];        // acceptance criteria from BRD

  /* ── DOM helpers ─────────────────────────────────────────── */
  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _el(id) { return document.getElementById(id); }
  function _status(msg, type) {
    var el = _el('dev-pipeline-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'error' ? '#ef4444' : type === 'ok' ? '#10b981' : 'var(--text-3)';
  }

  /* ════════════════════════════════════════════════════════
     Init
  ════════════════════════════════════════════════════════ */
  function init() {
    var panel = _el('section-development');
    if (!panel) return;

    _loadConnections();
    _bindEvents();
  }

  /* ── Load connections into dropdown ─────────────────────── */
  async function _loadConnections() {
    var sel = _el('dev-conn-select');
    if (!sel) return;
    try {
      var [sqlRes, sfRes] = await Promise.all([
        fetch(API_BASE + '/connections?source_type=sql'),
        fetch(API_BASE + '/connections?source_type=snowflake'),
      ]);
      var sqlList = sqlRes.ok ? await sqlRes.json() : [];
      var sfList  = sfRes.ok  ? await sfRes.json()  : [];

      sel.innerHTML = '<option value="">-- Select a connection --</option>';
      if (sqlList.length) {
        var g = document.createElement('optgroup');
        g.label = 'SQL Database';
        sqlList.forEach(function (c) {
          var o = document.createElement('option');
          o.value = c.id; o.textContent = c.name;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
      if (sfList.length) {
        var g2 = document.createElement('optgroup');
        g2.label = 'Snowflake';
        sfList.forEach(function (c) {
          var o = document.createElement('option');
          o.value = c.id; o.textContent = c.name;
          g2.appendChild(o);
        });
        sel.appendChild(g2);
      }
    } catch (_) {}
  }

  /* ── Bind all button events ─────────────────────────────── */
  function _bindEvents() {
    _el('dev-conn-select')?.addEventListener('change', function () {
      _connId = this.value ? parseInt(this.value, 10) : null;
    });
    _el('dev-model-select')?.addEventListener('change', function () {
      _model = this.value || 'gpt-4o-mini';
    });

    _el('btn-dev-plan')?.addEventListener('click', _generatePlan);
    _el('btn-dev-brd')?.addEventListener('click', _analyzeBRD);
    _el('btn-dev-ext-fetch')?.addEventListener('click', _fetchExternal);
    _el('btn-dev-history')?.addEventListener('click', _toggleHistory);

    // Pipeline-level controls
    _el('btn-dev-generate-all')?.addEventListener('click', _generateAll);
    _el('btn-dev-validate-all')?.addEventListener('click', _validateAll);
    _el('btn-dev-run-pipeline')?.addEventListener('click', _runPipeline);
    _el('btn-dev-git-checkin')?.addEventListener('click', _gitCheckin);
    _el('btn-dev-export-jira')?.addEventListener('click', function () { _exportAC('jira'); });
    _el('btn-dev-export-ado')?.addEventListener('click',  function () { _exportAC('ado'); });
  }

  /* ════════════════════════════════════════════════════════
     Generate Plan
  ════════════════════════════════════════════════════════ */
  async function _generatePlan() {
    if (!_connId) { _toast('warn', 'Select a connection first'); return; }
    var task = (_el('dev-task-input')?.value || '').trim();
    if (!task) { _toast('warn', 'Enter a task description'); return; }

    var btn = _el('btn-dev-plan');
    btn.disabled = true; btn.textContent = '⏳ Planning…';
    _el('dev-plan-area').innerHTML = '<div class="dev-loading">Generating plan…</div>';

    try {
      var res = await fetch(API_BASE + '/dev/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conn_id: _connId, task_description: task, model: _model }),
      });
      if (!res.ok) {
        var d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Plan generation failed');
      }
      var data = await res.json();
      _artifactId = data.artifact_id;
      _steps = data.steps || [];
      _renderPlan(_steps);
      _showPipelineControls();
      _toast('success', _steps.length + ' steps generated');
    } catch (err) {
      _el('dev-plan-area').innerHTML = '<div class="dev-error">Error: ' + _esc(err.message) + '</div>';
      _toast('error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = '⚡ Generate Plan';
    }
  }

  /* ════════════════════════════════════════════════════════
     Render Plan Steps
  ════════════════════════════════════════════════════════ */
  function _renderPlan(steps) {
    var area = _el('dev-plan-area');
    if (!steps || !steps.length) {
      area.innerHTML = '<div class="dev-empty">No steps generated.</div>';
      return;
    }
    area.innerHTML = '<div class="dev-section-title">Plan Steps</div>';
    steps.forEach(function (step) {
      var card = document.createElement('div');
      card.className = 'dev-step-card';
      card.id = 'dev-step-' + step.step_number;
      card.innerHTML =
        '<div class="dev-step-header">' +
          '<span class="dev-step-num">' + step.step_number + '</span>' +
          '<span class="dev-step-name">' + _esc(step.name || step.objective || '') + '</span>' +
          '<span class="dev-step-type">' + _esc(step.type || 'sql') + '</span>' +
        '</div>' +
        '<div class="dev-step-desc">' + _esc(step.description || '') + '</div>' +
        (step.depends_on && step.depends_on.length ?
          '<div class="dev-step-deps">Depends on: steps ' + step.depends_on.join(', ') + '</div>' : '') +
        '<div class="dev-step-sql-wrap" style="display:none">' +
          '<textarea class="dev-sql-editor" id="dev-sql-' + step.step_number + '" rows="6" ' +
            'placeholder="Click Generate to create SQL…"></textarea>' +
        '</div>' +
        '<div class="dev-step-actions">' +
          '<button class="btn btn-xs-secondary btn-dev-gen-step" data-step="' + step.step_number + '">⚡ Generate SQL</button>' +
          '<button class="btn btn-xs-secondary btn-dev-val-step" data-step="' + step.step_number + '">✓ Validate</button>' +
          '<button class="btn btn-xs-secondary btn-dev-exec-step" data-step="' + step.step_number + '">▶ Execute</button>' +
        '</div>' +
        '<div class="dev-step-result" id="dev-step-result-' + step.step_number + '"></div>';

      card.querySelector('.btn-dev-gen-step').addEventListener('click', function () {
        _generateStep(parseInt(this.dataset.step, 10));
      });
      card.querySelector('.btn-dev-val-step').addEventListener('click', function () {
        _validateStep(parseInt(this.dataset.step, 10));
      });
      card.querySelector('.btn-dev-exec-step').addEventListener('click', function () {
        _executeStep(parseInt(this.dataset.step, 10));
      });

      area.appendChild(card);
    });
  }

  function _showPipelineControls() {
    var panel = _el('dev-pipeline-controls');
    if (panel) panel.style.display = '';
    var badge = _el('dev-artifact-badge');
    if (badge) badge.textContent = 'Artifact #' + _artifactId;
  }

  function _setStepStatus(stepNum, status, sql, error) {
    var card = _el('dev-step-' + stepNum);
    if (!card) return;

    // Remove old status class
    card.classList.remove('dev-step-generated', 'dev-step-error', 'dev-step-executed', 'dev-step-skipped');
    if (status === 'generated') card.classList.add('dev-step-generated');
    else if (status === 'error')  card.classList.add('dev-step-error');
    else if (status === 'executed') card.classList.add('dev-step-executed');
    else if (status === 'skipped') card.classList.add('dev-step-skipped');

    if (sql) {
      var wrap = card.querySelector('.dev-step-sql-wrap');
      if (wrap) wrap.style.display = '';
      var ta = _el('dev-sql-' + stepNum);
      if (ta) ta.value = sql;
    }
    if (error) {
      var res = _el('dev-step-result-' + stepNum);
      if (res) res.innerHTML = '<div class="dev-step-err-msg">' + _esc(error) + '</div>';
    }
  }

  /* ════════════════════════════════════════════════════════
     Per-step Generate / Validate / Execute
  ════════════════════════════════════════════════════════ */
  async function _generateStep(stepNum) {
    if (!_artifactId) return;
    var btn = document.querySelector('.btn-dev-gen-step[data-step="' + stepNum + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      var res = await fetch(API_BASE + '/dev/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact_id: _artifactId, step_number: stepNum, model: _model }),
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Generate failed');
      _setStepStatus(stepNum, 'generated', d.sql, null);
    } catch (err) {
      _setStepStatus(stepNum, 'error', null, err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate SQL'; }
    }
  }

  async function _validateStep(stepNum) {
    if (!_connId) return;
    var ta = _el('dev-sql-' + stepNum);
    var sql = ta ? ta.value.trim() : '';
    if (!sql) { _toast('warn', 'Generate SQL first'); return; }

    var res = await fetch(API_BASE + '/dev/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conn_id: _connId, sql: sql }),
    });
    var d = await res.json();
    var resultEl = _el('dev-step-result-' + stepNum);
    if (!resultEl) return;
    if (d.passed) {
      resultEl.innerHTML = '<div class="dev-val-ok">✓ Validation passed' +
        (d.warnings.length ? ' — ' + d.warnings.join('; ') : '') + '</div>';
    } else {
      resultEl.innerHTML = '<div class="dev-val-fail">✗ ' + d.errors.join('<br>') + '</div>';
    }
  }

  async function _executeStep(stepNum) {
    if (!_connId) return;
    var ta = _el('dev-sql-' + stepNum);
    var sql = ta ? ta.value.trim() : '';
    if (!sql) { _toast('warn', 'Generate SQL first'); return; }

    var resultEl = _el('dev-step-result-' + stepNum);
    if (resultEl) resultEl.innerHTML = '<div class="dev-loading">Executing…</div>';

    try {
      var res = await fetch(API_BASE + '/dev/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conn_id: _connId, sql: sql, limit: 100 }),
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Execute failed');
      var rows = d.rows || [];
      var cols = d.columns || [];
      var html = '<div class="dev-result-wrap"><div class="dev-result-count">' + (d.total || rows.length) + ' rows</div>';
      if (cols.length && rows.length) {
        html += '<div style="overflow-x:auto"><table class="dev-result-table"><thead><tr>' +
          cols.map(function (c) { return '<th>' + _esc(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.slice(0, 20).map(function (r) {
            return '<tr>' + cols.map(function (c) { return '<td>' + _esc(r[c] != null ? r[c] : '') + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }
      html += '</div>';
      if (resultEl) resultEl.innerHTML = html;
      _setStepStatus(stepNum, 'executed', null, null);
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<div class="dev-val-fail">✗ ' + _esc(err.message) + '</div>';
    }
  }

  /* ════════════════════════════════════════════════════════
     Pipeline-level: Generate All
  ════════════════════════════════════════════════════════ */
  async function _generateAll() {
    if (!_artifactId) { _toast('warn', 'Generate a plan first'); return; }
    var btn = _el('btn-dev-generate-all');
    btn.disabled = true; btn.textContent = '⏳ Generating…';
    _status('Generating SQL for all steps…', '');

    try {
      var res = await fetch(API_BASE + '/dev/pipeline/' + _artifactId + '/generate-all?model=' + _model, {
        method: 'POST',
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Generate all failed');

      (d.steps || []).forEach(function (item) {
        _setStepStatus(item.step_number, item.status, item.sql || null, item.error || null);
      });

      var errCount = (d.errors || []).length;
      _status(
        d.generated + '/' + (d.steps || []).length + ' steps generated' +
        (errCount ? ' — ' + errCount + ' error(s)' : ''),
        errCount ? 'error' : 'ok'
      );
      _toast(errCount ? 'warn' : 'success',
        d.generated + ' steps generated' + (errCount ? ' with ' + errCount + ' error(s)' : ''));
    } catch (err) {
      _status('Error: ' + err.message, 'error');
      _toast('error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = '⚡ Generate All SQL';
    }
  }

  /* ════════════════════════════════════════════════════════
     Pipeline-level: Validate All
  ════════════════════════════════════════════════════════ */
  async function _validateAll() {
    if (!_artifactId) { _toast('warn', 'Generate a plan first'); return; }
    var btn = _el('btn-dev-validate-all');
    btn.disabled = true; btn.textContent = '⏳ Validating…';
    _status('Validating all steps…', '');

    var resultsEl = _el('dev-validate-results');
    if (resultsEl) { resultsEl.style.display = ''; resultsEl.innerHTML = '<div class="dev-loading">Running validation…</div>'; }

    try {
      var res = await fetch(API_BASE + '/dev/pipeline/' + _artifactId + '/validate-all', {
        method: 'POST',
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Validate all failed');

      var validations = d.validations || [];
      var failCount = validations.filter(function (v) { return !v.passed; }).length;

      // Update per-step result elements
      validations.forEach(function (v) {
        var res2El = _el('dev-step-result-' + v.step_number);
        if (!res2El) return;
        if (v.passed) {
          res2El.innerHTML = '<div class="dev-val-ok">✓ Validation passed' +
            (v.warnings.length ? '<br><small>' + v.warnings.join('; ') + '</small>' : '') + '</div>';
        } else {
          res2El.innerHTML = '<div class="dev-val-fail">✗ ' + v.errors.join('<br>') + '</div>';
        }
      });

      if (resultsEl) {
        resultsEl.innerHTML = '<div class="dev-val-summary ' + (d.all_passed ? 'dev-val-ok' : 'dev-val-fail') + '">' +
          (d.all_passed ? '✓ All ' + validations.length + ' steps passed' :
            '✗ ' + failCount + ' of ' + validations.length + ' steps failed') + '</div>';
      }
      _status(d.all_passed ? 'All steps valid' : failCount + ' step(s) failed validation', d.all_passed ? 'ok' : 'error');
      _toast(d.all_passed ? 'success' : 'warn', d.all_passed ? 'All steps valid' : failCount + ' step(s) failed');
    } catch (err) {
      _status('Error: ' + err.message, 'error');
      if (resultsEl) resultsEl.innerHTML = '<div class="dev-error">' + _esc(err.message) + '</div>';
      _toast('error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = '✓ Validate All';
    }
  }

  /* ════════════════════════════════════════════════════════
     Execute Full Pipeline
  ════════════════════════════════════════════════════════ */
  async function _runPipeline() {
    if (!_artifactId) { _toast('warn', 'Generate a plan first'); return; }
    if (!confirm('Execute all pipeline steps against the database. Continue?')) return;

    var btn = _el('btn-dev-run-pipeline');
    btn.disabled = true; btn.textContent = '⏳ Running…';
    _status('Pipeline running…', '');

    try {
      var res = await fetch(API_BASE + '/dev/pipeline/' + _artifactId + '/run', { method: 'POST' });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Pipeline run failed');

      (d.steps || []).forEach(function (item) {
        _setStepStatus(item.step_number, item.status, null, item.error || null);
        if (item.result) {
          var resEl = _el('dev-step-result-' + item.step_number);
          if (resEl) resEl.innerHTML = '<div class="dev-result-count">' + (item.result.total || 0) + ' rows</div>';
        }
      });
      _status('Pipeline ' + d.status, d.status === 'complete' ? 'ok' : 'error');
      _toast(d.status === 'complete' ? 'success' : 'warn', 'Pipeline ' + d.status);
    } catch (err) {
      _status('Error: ' + err.message, 'error');
      _toast('error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = '▶ Execute Pipeline';
    }
  }

  /* ════════════════════════════════════════════════════════
     Git Check-in
  ════════════════════════════════════════════════════════ */
  async function _gitCheckin() {
    if (!_artifactId) { _toast('warn', 'Generate a plan first'); return; }
    var branch = prompt('Branch name:', 'main');
    if (!branch) return;
    var dir = prompt('Target directory in repo:', 'sql-artifacts');
    if (dir === null) return;

    var btn = _el('btn-dev-git-checkin');
    btn.disabled = true; btn.textContent = '⏳ Checking in…';
    _status('Pushing to Git…', '');

    try {
      var res = await fetch(API_BASE + '/dev/git-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact_id: _artifactId, branch: branch, directory: dir,
          commit_message: 'chore: add generated SQL artifacts' }),
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Git check-in failed');
      var pushed = (d.pushed || []).length;
      var errors = (d.errors || []).length;
      _status(pushed + ' files pushed to ' + d.repo + ' / ' + d.branch + (errors ? ' — ' + errors + ' error(s)' : ''), pushed ? 'ok' : 'error');
      _toast(pushed ? 'success' : 'warn', pushed + ' file(s) pushed to Git' + (errors ? ', ' + errors + ' error(s)' : ''));
    } catch (err) {
      _status('Error: ' + err.message, 'error');
      _toast('error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = '⬆ Check-in to Git';
    }
  }

  /* ════════════════════════════════════════════════════════
     BRD Analysis → Acceptance Criteria
  ════════════════════════════════════════════════════════ */
  async function _analyzeBRD() {
    if (!_connId) { _toast('warn', 'Select a connection first'); return; }
    var brd = (_el('dev-task-input')?.value || '').trim();
    if (!brd) { _toast('warn', 'Paste a BRD / requirement text first'); return; }

    var btn = _el('btn-dev-brd');
    btn.disabled = true; btn.textContent = '⏳ Analyzing…';
    _el('dev-ac-area').innerHTML = '<div class="dev-loading">Analyzing BRD…</div>';

    try {
      var res = await fetch(API_BASE + '/dev/brd-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conn_id: _connId, brd_text: brd, model: _model }),
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'BRD analysis failed');
      _acCriteria = d.criteria || [];
      _renderAC(_acCriteria);

      // Show export buttons if integrations configured
      _showACExportButtons();
      _toast('success', _acCriteria.length + ' acceptance criteria generated');
    } catch (err) {
      _el('dev-ac-area').innerHTML = '<div class="dev-error">Error: ' + _esc(err.message) + '</div>';
      _toast('error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = '📄 Analyze BRD';
    }
  }

  function _renderAC(criteria) {
    var area = _el('dev-ac-area');
    if (!criteria.length) { area.innerHTML = ''; return; }

    var html = '<div class="dev-section-title">Acceptance Criteria (' + criteria.length + ')</div>';
    criteria.forEach(function (ac) {
      var pClass = ac.priority === 'high' ? 'dev-ac-high' : ac.priority === 'low' ? 'dev-ac-low' : 'dev-ac-medium';
      html +=
        '<div class="dev-ac-card">' +
          '<div class="dev-ac-header">' +
            '<span class="dev-ac-id">#' + (ac.id || '?') + '</span>' +
            '<span class="dev-ac-feature">' + _esc(ac.feature || '') + '</span>' +
            '<span class="dev-ac-badge ' + pClass + '">' + (ac.priority || 'medium') + '</span>' +
            '<span class="dev-ac-badge" style="background:var(--bg-3)">' + (ac.complexity || '') + '</span>' +
          '</div>' +
          '<div class="dev-ac-row"><b>Given:</b> ' + _esc(ac.given || '') + '</div>' +
          '<div class="dev-ac-row"><b>When:</b> '  + _esc(ac.when  || '') + '</div>' +
          '<div class="dev-ac-row"><b>Then:</b> '  + _esc(ac.then  || '') + '</div>' +
          (ac.sql_validation ? '<details class="dev-ac-sql"><summary>SQL Validation</summary><pre>' + _esc(ac.sql_validation) + '</pre></details>' : '') +
          (ac.notes ? '<div class="dev-ac-notes">' + _esc(ac.notes) + '</div>' : '') +
        '</div>';
    });
    area.innerHTML = html;
  }

  async function _showACExportButtons() {
    try {
      var res = await fetch(API_BASE + '/admin/integrations');
      if (!res.ok) return;
      var list = await res.json();
      var types = list.map(function (i) { return i.type; });
      var jiraBtn = _el('btn-dev-export-jira');
      var adoBtn  = _el('btn-dev-export-ado');
      if (jiraBtn) jiraBtn.style.display = types.includes('jira') ? '' : 'none';
      if (adoBtn)  adoBtn.style.display  = types.includes('ado')  ? '' : 'none';
    } catch (_) {}
  }

  /* ════════════════════════════════════════════════════════
     Export AC to JIRA / ADO
  ════════════════════════════════════════════════════════ */
  async function _exportAC(target) {
    if (!_acCriteria.length) { _toast('warn', 'Analyze a BRD first to generate AC'); return; }
    var projKey = prompt('Project key / name (e.g. MYPROJ or MyProject):', '');
    if (!projKey) return;

    var btn = _el(target === 'jira' ? 'btn-dev-export-jira' : 'btn-dev-export-ado');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Exporting…'; }
    _status('Exporting to ' + target.toUpperCase() + '…', '');

    try {
      var res = await fetch(API_BASE + '/dev/export-ac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: target,
          criteria: _acCriteria,
          project_key: projKey,
          story_type: target === 'jira' ? 'Story' : 'User Story',
          task_type: 'Task',
        }),
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Export failed');

      var created = (d.created || []).length;
      var errors  = (d.errors  || []).length;
      _status(created + ' items created in ' + target.toUpperCase() + (errors ? ' — ' + errors + ' error(s)' : ''), created ? 'ok' : 'error');
      _toast(created ? 'success' : 'warn', created + ' items exported to ' + target.toUpperCase() +
        (errors ? '\n' + d.errors.slice(0, 2).join('\n') : ''));
    } catch (err) {
      _status('Error: ' + err.message, 'error');
      _toast('error', err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = target === 'jira' ? '⬆ Export to JIRA' : '⬆ Export to ADO'; }
    }
  }

  /* ════════════════════════════════════════════════════════
     Fetch External (JIRA / ADO) Work Item → populate task input
  ════════════════════════════════════════════════════════ */
  async function _fetchExternal() {
    var type = _el('dev-ext-type')?.value || 'jira';
    var id   = (_el('dev-ext-id')?.value || '').trim();
    if (!id) { _toast('warn', 'Enter a JIRA issue key or ADO work item ID'); return; }

    var statusEl = _el('dev-ext-status');
    if (statusEl) statusEl.textContent = 'Fetching…';

    try {
      var res = await fetch(API_BASE + '/dev/fetch-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: type, resource_id: id }),
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Fetch failed');

      var ta = _el('dev-task-input');
      if (ta) ta.value = d.text || '';
      if (statusEl) statusEl.textContent = 'Loaded from ' + type.toUpperCase() + ' #' + id;
      _toast('success', 'Requirement loaded from ' + type.toUpperCase());
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Error: ' + err.message;
      _toast('error', err.message);
    }
  }

  /* ════════════════════════════════════════════════════════
     History Panel
  ════════════════════════════════════════════════════════ */
  async function _toggleHistory() {
    var panel = _el('dev-history-panel');
    if (!panel) return;
    if (panel.style.display === 'none') {
      panel.style.display = '';
      await _loadHistory();
    } else {
      panel.style.display = 'none';
    }
  }

  async function _loadHistory() {
    if (!_connId) { _toast('warn', 'Select a connection first'); return; }
    var list = _el('dev-history-list');
    if (!list) return;
    list.textContent = 'Loading…';
    try {
      var res = await fetch(API_BASE + '/dev/history/' + _connId);
      var data = res.ok ? await res.json() : [];
      if (!data.length) { list.innerHTML = '<div class="dev-empty">No history yet.</div>'; return; }
      list.innerHTML = data.map(function (a) {
        return '<div class="dev-history-item" data-id="' + a.id + '">' +
          '<div class="dev-history-task">' + _esc((a.task_description || '').substring(0, 80)) + '</div>' +
          '<div class="dev-history-meta">' + _esc(a.status || '') + ' · ' + (a.created_at || '').substring(0, 10) + '</div>' +
          '</div>';
      }).join('');
      list.querySelectorAll('.dev-history-item').forEach(function (item) {
        item.addEventListener('click', function () { _loadArtifact(parseInt(this.dataset.id, 10)); });
      });
    } catch (err) {
      list.textContent = 'Error: ' + err.message;
    }
  }

  async function _loadArtifact(id) {
    try {
      var res = await fetch(API_BASE + '/dev/artifacts/' + id);
      if (!res.ok) return;
      var a = await res.json();
      _artifactId = a.id;
      _steps = a.plan_json ? JSON.parse(a.plan_json) : [];
      var ta = _el('dev-task-input');
      if (ta) ta.value = a.task_description || '';
      _renderPlan(_steps);
      _showPipelineControls();

      // Re-fill SQL editors from artifacts_json
      if (a.artifacts_json) {
        try {
          JSON.parse(a.artifacts_json).forEach(function (item) {
            _setStepStatus(item.step_number, item.status, item.sql || null, item.error || null);
          });
        } catch (_) {}
      }
      _toast('success', 'Loaded artifact #' + id);
    } catch (err) {
      _toast('error', 'Could not load artifact: ' + err.message);
    }
  }

  /* ── Toast helper ────────────────────────────────────── */
  function _toast(type, msg) {
    if (typeof window.toast === 'function') {
      window.toast(type, msg);
    } else if (typeof window.showToast === 'function') {
      window.showToast(type, msg);
    }
  }

  /* ── Public API ─────────────────────────────────────── */
  return { init: init };
}());

document.addEventListener('DOMContentLoaded', function () {
  DevHandler.init();
});
