/* ═══════════════════════════════════════════════════════════
   reportHandler.js  –  Tab 5: Report
   • Loads saved connections (SQL + Snowflake) from Tab 1
   • Runs custom SQL query via backend preview endpoint
   • Renders paginated data table
   • Auto-generates rich dashboard: KPI cards + Chart.js charts
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const API_BASE = 'http://localhost:8000/api';
  const PALETTE  = ['#2563eb','#10b981','#f59e0b','#ef4444',
                    '#8b5cf6','#06b6d4','#f97316','#ec4899',
                    '#14b8a6','#a855f7','#84cc16','#f43f5e'];
  const PAGE_SIZE = 200;

  const ReportHandler = {
    _connections : [],
    _columns     : [],
    _rows        : [],
    _charts      : [],
    _page        : 0,
    _mode        : 'sql',   // 'sql' | 'ai'
    _envKeyLoaded: false,   // true when .env has OPENAI_API_KEY

    init() {
      _loadConnections();
      _initRunButton();
      _initSaveButton();
      _initAskButton();
      _initModeToggle();
      _initExportButton();
      _initRefreshOnTabOpen();
      _fetchOpenAIKeyStatus();
      // Restore saved AI key
      const savedKey = localStorage.getItem('rpt_openai_key') || '';
      const keyEl = document.getElementById('rpt-ai-key');
      if (keyEl && savedKey) keyEl.value = savedKey;
      // Load saved reports when connection changes
      document.getElementById('rpt-conn-select')?.addEventListener('change', function () {
        const val = this.value;
        if (val) {
          const [, id] = val.split(':');
          _loadSavedReports(parseInt(id, 10));
        } else {
          document.getElementById('rpt-saved-panel').style.display = 'none';
        }
      });
    }
  };

  /* ══════════════════════════════════════════════════════
     Refresh connections when the Report tab is clicked
     ══════════════════════════════════════════════════════ */
  function _initRefreshOnTabOpen() {
    document.querySelectorAll('.step[data-tab="report"]').forEach(s => {
      s.addEventListener('click', _loadConnections);
    });
  }

  /* ══════════════════════════════════════════════════════
     Load saved connections into the dropdown
     ══════════════════════════════════════════════════════ */
  async function _loadConnections() {
    const sel = document.getElementById('rpt-conn-select');
    if (!sel) return;

    try {
      const [sqlRes, sfRes] = await Promise.all([
        fetch(`${API_BASE}/connections?source_type=sql`),
        fetch(`${API_BASE}/connections?source_type=snowflake`)
      ]);

      const sqlList = sqlRes.ok ? await sqlRes.json() : [];
      const sfList  = sfRes.ok  ? await sfRes.json()  : [];

      ReportHandler._connections = [
        ...sqlList.map(c => ({ ...c, _type: 'sql' })),
        ...sfList.map(c  => ({ ...c, _type: 'snowflake' }))
      ];

      const prev = sel.value;
      sel.innerHTML = '<option value="">-- Select a saved connection --</option>';

      if (sqlList.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = 'SQL Database';
        sqlList.forEach(c => {
          const opt = document.createElement('option');
          opt.value = `sql:${c.id}`;
          opt.textContent = c.name;
          grp.appendChild(opt);
        });
        sel.appendChild(grp);
      }

      if (sfList.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = 'Snowflake';
        sfList.forEach(c => {
          const opt = document.createElement('option');
          opt.value = `snowflake:${c.id}`;
          opt.textContent = c.name;
          grp.appendChild(opt);
        });
        sel.appendChild(grp);
      }

      if (prev) sel.value = prev; // restore selection
    } catch (_) {
      /* backend offline — silently skip */
    }
  }

  /* ══════════════════════════════════════════════════════
     Fetch OpenAI key status from backend (.env)
     ══════════════════════════════════════════════════════ */
  async function _fetchOpenAIKeyStatus() {
    try {
      const res  = await fetch(`${API_BASE}/admin/openai-key-status`);
      if (!res.ok) return;
      const data = await res.json();
      ReportHandler._envKeyLoaded = data.configured;

      const row = document.getElementById('rpt-ai-key')?.closest('.rpt-ai-key-row');
      if (!row) return;

      if (data.configured) {
        // Replace the key row with a status badge — backend uses .env key automatically
        row.innerHTML =
          `<span class="env-key-badge">` +
          `<svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13" style="flex-shrink:0"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>` +
          `OpenAI key loaded from <code>.env</code> <span class="env-key-preview">${data.preview}</span>` +
          `</span>`;
      }
    } catch (_) { /* backend offline */ }
  }

  /* ══════════════════════════════════════════════════════
     Mode toggle (SQL / AI)
     ══════════════════════════════════════════════════════ */
  function _initModeToggle() {
    document.querySelectorAll('.rpt-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        ReportHandler._mode = mode;
        document.querySelectorAll('.rpt-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('rpt-sql-pane').style.display = mode === 'sql' ? '' : 'none';
        document.getElementById('rpt-ai-pane').style.display  = mode === 'ai'  ? '' : 'none';
        // Show/hide saved reports panel based on mode
        const savedPanel = document.getElementById('rpt-saved-panel');
        if (savedPanel) {
          if (mode === 'ai') {
            savedPanel.style.display = 'none';
          } else {
            // Restore panel if a connection is selected
            const connSel = document.getElementById('rpt-conn-select');
            if (connSel && connSel.value) {
              const [, cid] = connSel.value.split(':');
              _loadSavedReports(parseInt(cid, 10));
            }
          }
        }
        _clearResults();
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     Saved Reports
     ══════════════════════════════════════════════════════ */
  async function _loadSavedReports(connId) {
    const panel   = document.getElementById('rpt-saved-panel');
    const listEl  = document.getElementById('rpt-saved-list');
    if (!panel || !listEl) return;

    try {
      const res = await fetch(`${API_BASE}/reports/saved?conn_id=${connId}`);
      if (!res.ok) throw new Error('load failed');
      const items = await res.json();

      panel.style.display = 'block';

      if (!items.length) {
        listEl.innerHTML = '<div class="saved-conn-empty">No saved reports for this connection yet.</div>';
        return;
      }

      listEl.innerHTML = '';
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'rpt-saved-item';

        const sqlPreview = item.query_sql.replace(/\s+/g, ' ').slice(0, 80) + (item.query_sql.length > 80 ? '…' : '');

        row.innerHTML =
          '<div class="rpt-saved-info" style="cursor:pointer" title="Click to load into editor">' +
            '<div class="rpt-saved-name">' + _escHtml(item.name) + '</div>' +
            '<div class="rpt-saved-meta">' + _escHtml(sqlPreview) + ' · ' + _escHtml(item.created_at) + '</div>' +
          '</div>' +
          '<div class="rpt-saved-actions">' +
            '<button class="btn-xs btn-xs-primary rpt-saved-run" data-id="' + item.id + '" title="Run report">' +
              '<svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M6.3 2.8A1 1 0 005 3.7v12.6a1 1 0 001.3.9l12-6.3a1 1 0 000-1.8l-12-6.3z"/></svg>' +
            '</button>' +
            '<button class="btn-xs btn-xs-danger rpt-saved-del" data-id="' + item.id + '" title="Delete report">' +
              '<svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>' +
            '</button>' +
          '</div>';

        row.querySelector('.rpt-saved-info').addEventListener('click', () => _loadSavedReport(item));
        row.querySelector('.rpt-saved-run').addEventListener('click', () => _runSavedReport(item));
        row.querySelector('.rpt-saved-del').addEventListener('click', () => _deleteSavedReport(item.id, connId));

        listEl.appendChild(row);
      });
    } catch (_) {
      panel.style.display = 'block';
      listEl.innerHTML = '<div class="saved-conn-empty">No saved reports for this connection yet.</div>';
    }
  }

  function _loadSavedReport(item) {
    // Switch to SQL mode and populate query textarea + name field
    ReportHandler._mode = 'sql';
    document.querySelectorAll('.rpt-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'sql'));
    document.getElementById('rpt-sql-pane').style.display = '';
    document.getElementById('rpt-ai-pane').style.display  = 'none';
    const ta = document.getElementById('rpt-query');
    if (ta) ta.value = item.query_sql;
    const nameEl = document.getElementById('rpt-report-name');
    if (nameEl) { nameEl.value = item.name; nameEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    _clearResults();
    toast('info', 'Query loaded — edit then click Save Report to save changes');
  }

  function _runSavedReport(item) {
    _loadSavedReport(item);
    // Trigger run after a short tick so the textarea value is set
    setTimeout(_runReport, 50);
  }

  async function _deleteSavedReport(id, connId) {
    if (!confirm('Delete this saved report?')) return;
    try {
      const res = await fetch(`${API_BASE}/reports/saved/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('delete failed');
      toast('success', 'Report deleted');
      _loadSavedReports(connId);
    } catch (_) {
      toast('error', 'Could not delete report');
    }
  }

  /* ── New Report button ──────────────────────────────────── */
  document.getElementById('btn-rpt-new')?.addEventListener('click', () => {
    const nameEl = document.getElementById('rpt-report-name');
    const ta     = document.getElementById('rpt-query');
    if (nameEl) { nameEl.value = ''; nameEl.focus(); }
    if (ta)     ta.value = '';
    _clearResults();
    document.getElementById('rpt-ai-sql-section').style.display = 'none';
    toast('info', 'Fields cleared — write your query and give it a name, then click Save Report');
  });

  /* ── Save Report button ──────────────────────────────────── */
  function _initSaveButton() {
    document.getElementById('btn-rpt-save')?.addEventListener('click', async () => {
      const sel   = document.getElementById('rpt-conn-select');
      const name  = (document.getElementById('rpt-report-name')?.value || '').trim();
      const query = (document.getElementById('rpt-query')?.value || '').trim();

      if (!sel?.value)  { toast('warning', 'Select a connection first');  return; }
      if (!name)        { toast('warning', 'Enter a report name first');  return; }
      if (!query)       { toast('warning', 'Enter a SQL query to save'); return; }

      const [, id] = sel.value.split(':');
      const btn = document.getElementById('btn-rpt-save');
      btn.disabled = true;

      try {
        const res = await fetch(`${API_BASE}/reports/saved`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conn_id: parseInt(id, 10), name, query_sql: query })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Save failed');
        }
        toast('success', `Report "${name}" saved`);
        _loadSavedReports(parseInt(id, 10));
      } catch (err) {
        toast('error', 'Save error: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ══════════════════════════════════════════════════════
     Run Report button
     ══════════════════════════════════════════════════════ */
  function _initRunButton() {
    document.getElementById('btn-rpt-run')?.addEventListener('click', _runReport);
  }

  async function _runReport() {
    const sel      = document.getElementById('rpt-conn-select');
    const query    = (document.getElementById('rpt-query')?.value || '').trim();
    const btn      = document.getElementById('btn-rpt-run');
    const statusEl = document.getElementById('rpt-status');

    if (!sel?.value) {
      _setStatus(statusEl, 'error', '⚠ Select a connection first');
      return;
    }
    if (!query) {
      _setStatus(statusEl, 'error', '⚠ Enter a SQL query');
      return;
    }

    const [, id] = sel.value.split(':');

    btn.disabled    = true;
    btn.innerHTML   = '<span class="spinner"></span> Running…';
    _setStatus(statusEl, 'running', '⏳ Executing query…');
    _clearResults();

    try {
      // POST directly to the stored-connection run endpoint.
      // Credentials are decrypted server-side — never sent to the browser.
      const res = await fetch(`${API_BASE}/connections/${id}/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: query, limit: 1000 })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Query failed');
      }

      const data = await res.json();
      ReportHandler._columns = data.columns || [];
      ReportHandler._rows    = data.rows    || [];
      ReportHandler._page    = 0;

      const rowCount = ReportHandler._rows.length;
      const colCount = ReportHandler._columns.length;
      _setStatus(statusEl, 'ok', `✓ ${rowCount.toLocaleString()} row(s) · ${colCount} column(s)`);
      toast('success', `Report: ${rowCount.toLocaleString()} rows loaded`);

      _renderTable();
      _renderDashboard();

    } catch (err) {
      if (err instanceof TypeError || err.message.toLowerCase().includes('fetch')) {
        _setStatus(statusEl, 'offline', '⚠ Backend not running — uvicorn api.main:app --reload --port 8000');
        toast('warning', 'Python API not running. Start: uvicorn api.main:app --reload --port 8000');
      } else {
        _setStatus(statusEl, 'error', '✗ ' + err.message);
        toast('error', 'Report error: ' + err.message);
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 2.8A1 1 0 005 3.7v12.6a1 1 0 001.3.9l12-6.3a1 1 0 000-1.8l-12-6.3z"/></svg> Run Report';
    }
  }

  /* ══════════════════════════════════════════════════════
     Ask AI button
     ══════════════════════════════════════════════════════ */
  function _initAskButton() {
    document.getElementById('btn-rpt-ask')?.addEventListener('click', _runAIQuery);
  }

  async function _runAIQuery() {
    const sel      = document.getElementById('rpt-conn-select');
    const question = (document.getElementById('rpt-question')?.value || '').trim();
    const apiKey   = (document.getElementById('rpt-ai-key')?.value   || '').trim();
    const model    = document.getElementById('rpt-ai-model')?.value || 'gpt-4o-mini';
    const btn      = document.getElementById('btn-rpt-ask');
    const statusEl = document.getElementById('rpt-ai-status');

    if (!sel?.value) { _setStatus(statusEl, 'error', '⚠ Select a connection first'); return; }
    if (!question)   { _setStatus(statusEl, 'error', '⚠ Enter a question'); return; }
    if (!apiKey && !ReportHandler._envKeyLoaded) {
      _setStatus(statusEl, 'error', '⚠ Enter an OpenAI API key (or set OPENAI_API_KEY in .env)');
      return;
    }

    const [, id] = sel.value.split(':');
    if (apiKey) localStorage.setItem('rpt_openai_key', apiKey);

    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Generating SQL…';
    _setStatus(statusEl, 'running', '⏳ Asking AI…');
    _clearResults();

    try {
      // Only generate SQL — do NOT execute yet so the user can review/edit first
      const res = await fetch(`${API_BASE}/report/generate-sql`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          conn_id:     parseInt(id, 10),
          question:    question,
          api_key:     apiKey,
          chat_model:  model,
          embed_model: 'text-embedding-3-small',
          top_k:       15
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'AI generation failed');
      }

      const data = await res.json();

      // Populate the SQL textarea and switch to SQL mode for review
      ReportHandler._mode = 'sql';
      document.querySelectorAll('.rpt-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'sql'));
      document.getElementById('rpt-sql-pane').style.display = '';
      document.getElementById('rpt-ai-pane').style.display  = 'none';
      const ta = document.getElementById('rpt-query');
      if (ta) { ta.value = data.sql; ta.focus(); }

      // Show matched-columns banner + generated SQL preview
      const sqlSection = document.getElementById('rpt-ai-sql-section');
      const sqlBox     = document.getElementById('rpt-ai-sql-box');
      const matchedEl  = document.getElementById('rpt-ai-matched');
      if (sqlSection) sqlSection.style.display = 'block';
      if (sqlBox)     sqlBox.textContent = data.sql || '';
      if (matchedEl && data.matched_columns?.length) {
        matchedEl.innerHTML = '<span class="ai-matched-label">Matched columns:</span> '
          + data.matched_columns.map(c =>
              `<span class="ai-matched-chip">${_escHtml(c.table_name)}.${_escHtml(c.column_name)}</span>`
            ).join('');
      }

      _setStatus(statusEl, 'ok', '✓ SQL generated — review above, then click Run Report');
      toast('info', 'SQL generated — review it in the SQL tab, then click Run Report');

      // Highlight the Run button to guide the user
      const runBtn = document.getElementById('btn-rpt-run');
      if (runBtn) {
        runBtn.style.outline = '3px solid var(--primary)';
        setTimeout(() => { runBtn.style.outline = ''; }, 3000);
      }

    } catch (err) {
      if (err instanceof TypeError || err.message.toLowerCase().includes('fetch')) {
        _setStatus(statusEl, 'offline', '⚠ Backend not running — uvicorn api.main:app --reload --port 8000');
      } else {
        _setStatus(statusEl, 'error', '✗ ' + err.message);
        toast('error', 'AI error: ' + err.message);
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg> Ask AI';
    }
  }

  function _clearResults() {
    document.getElementById('rpt-data-section')?.style.setProperty('display', 'none');
    document.getElementById('rpt-dashboard-section')?.style.setProperty('display', 'none');
    document.getElementById('rpt-ai-sql-section')?.style.setProperty('display', 'none');
    ReportHandler._charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    ReportHandler._charts = [];
  }

  /* ══════════════════════════════════════════════════════
     Data Table (paginated)
     ══════════════════════════════════════════════════════ */
  function _renderTable() {
    const section = document.getElementById('rpt-data-section');
    const badge   = document.getElementById('rpt-row-badge');
    const wrapper = document.getElementById('rpt-table-wrapper');
    if (!section || !wrapper) return;

    const { _columns: columns, _rows: rows } = ReportHandler;
    const page  = ReportHandler._page;
    const start = page * PAGE_SIZE;
    const end   = Math.min(start + PAGE_SIZE, rows.length);
    const slice = rows.slice(start, end);

    if (badge) badge.textContent = `${rows.length.toLocaleString()} rows · ${columns.length} cols`;

    const table  = document.createElement('table');
    table.className = 'rpt-table';

    // Header
    const thead = document.createElement('thead');
    const hrow  = document.createElement('tr');
    const numTh = document.createElement('th');
    numTh.textContent = '#';
    hrow.appendChild(numTh);
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col;
      th.title = col;
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    slice.forEach((row, i) => {
      const tr    = document.createElement('tr');
      const numTd = document.createElement('td');
      numTd.textContent = (start + i + 1).toLocaleString();
      numTd.className   = 'rpt-row-num';
      tr.appendChild(numTd);
      columns.forEach(col => {
        const td  = document.createElement('td');
        const val = row[col];
        const txt = val == null ? '' : String(val);
        td.textContent = txt;
        td.title = txt;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrapper.innerHTML = '';
    wrapper.appendChild(table);

    // Pagination controls
    if (rows.length > PAGE_SIZE) {
      const totalPages = Math.ceil(rows.length / PAGE_SIZE);
      const pager = document.createElement('div');
      pager.className = 'rpt-pager';
      pager.innerHTML = `
        <button class="btn btn-ghost btn-sm" id="rpt-prev" ${page === 0 ? 'disabled' : ''}>‹ Prev</button>
        <span class="rpt-page-info">Page ${page + 1} / ${totalPages}  (${(start + 1).toLocaleString()}–${end.toLocaleString()} of ${rows.length.toLocaleString()})</span>
        <button class="btn btn-ghost btn-sm" id="rpt-next" ${end >= rows.length ? 'disabled' : ''}>Next ›</button>`;
      wrapper.appendChild(pager);
      document.getElementById('rpt-prev')?.addEventListener('click', () => {
        ReportHandler._page--; _renderTable();
      });
      document.getElementById('rpt-next')?.addEventListener('click', () => {
        ReportHandler._page++; _renderTable();
      });
    }

    section.style.display = 'block';
  }

  /* ══════════════════════════════════════════════════════
     Dashboard
     ══════════════════════════════════════════════════════ */
  function _renderDashboard() {
    const section = document.getElementById('rpt-dashboard-section');
    if (!section) return;

    const { _columns: columns, _rows: rows } = ReportHandler;
    if (!rows.length) return;

    const analysis = _analyzeColumns(columns, rows);
    _renderKPIs(analysis, rows);
    _renderCharts(analysis, rows);
    section.style.display = 'block';
  }

  /* ── Column analysis ───────────────────────────────────── */
  function _analyzeColumns(columns, rows) {
    const numericCols     = [];
    const categoricalCols = [];
    const dateCols        = [];

    columns.forEach(col => {
      const values = rows.map(r => r[col]).filter(v => v != null && v !== '');
      if (!values.length) return;

      const numCount = values.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).length;
      if (numCount / values.length > 0.75) {
        numericCols.push(col);
        return;
      }

      const dateCount = values.filter(v => {
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
        const d = new Date(v);
        return !isNaN(d.getTime()) && String(v).length >= 6;
      }).length;
      if (dateCount / values.length > 0.75) {
        dateCols.push(col);
        return;
      }

      const unique = new Set(values.map(v => String(v))).size;
      if (unique <= 100) categoricalCols.push(col);
    });

    // Compute stats for numeric columns
    const numericStats = {};
    numericCols.forEach(col => {
      const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
      if (!vals.length) return;
      const sum = vals.reduce((a, b) => a + b, 0);
      numericStats[col] = {
        min: Math.min.apply(null, vals),
        max: Math.max.apply(null, vals),
        avg: sum / vals.length,
        sum: sum,
        count: vals.length
      };
    });

    return { numericCols, categoricalCols, dateCols, numericStats, columns, rows };
  }

  /* ── KPI Cards ─────────────────────────────────────────── */
  function _renderKPIs(analysis, rows) {
    const container = document.getElementById('rpt-kpi-row');
    if (!container) return;
    container.innerHTML = '';

    const kpis = [
      { label: 'Total Rows',    value: rows.length.toLocaleString(),       icon: '⬚', color: 'blue'   },
      { label: 'Columns',       value: analysis.columns.length,            icon: '⊞', color: 'purple' },
      { label: 'Numeric Cols',  value: analysis.numericCols.length,        icon: '#', color: 'green'  },
      { label: 'Category Cols', value: analysis.categoricalCols.length,    icon: '≡', color: 'amber'  }
    ];

    const firstNum = analysis.numericCols[0];
    if (firstNum && analysis.numericStats[firstNum]) {
      const s = analysis.numericStats[firstNum];
      kpis.push(
        { label: firstNum + ' · Sum', value: _fmtNum(s.sum), icon: 'Σ', color: 'blue'   },
        { label: firstNum + ' · Avg', value: _fmtNum(s.avg), icon: 'μ', color: 'green'  },
        { label: firstNum + ' · Max', value: _fmtNum(s.max), icon: '↑', color: 'amber'  },
        { label: firstNum + ' · Min', value: _fmtNum(s.min), icon: '↓', color: 'red'    }
      );
    }

    const secondNum = analysis.numericCols[1];
    if (secondNum && analysis.numericStats[secondNum]) {
      const s = analysis.numericStats[secondNum];
      kpis.push(
        { label: secondNum + ' · Sum', value: _fmtNum(s.sum), icon: 'Σ', color: 'purple' },
        { label: secondNum + ' · Avg', value: _fmtNum(s.avg), icon: 'μ', color: 'blue'   }
      );
    }

    kpis.forEach(kpi => {
      const card = document.createElement('div');
      card.className = 'rpt-kpi-card kpi-' + kpi.color;
      card.innerHTML = '<div class="rpt-kpi-icon">' + kpi.icon + '</div>'
        + '<div class="rpt-kpi-body">'
        + '<div class="rpt-kpi-value">' + _escHtml(String(kpi.value)) + '</div>'
        + '<div class="rpt-kpi-label">' + _escHtml(kpi.label) + '</div>'
        + '</div>';
      container.appendChild(card);
    });
  }

  /* ── Charts ────────────────────────────────────────────── */
  function _renderCharts(analysis, rows) {
    const grid = document.getElementById('rpt-charts-grid');
    if (!grid) return;
    grid.innerHTML = '';
    ReportHandler._charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    ReportHandler._charts = [];

    const { numericCols, categoricalCols, dateCols } = analysis;
    const defs = [];

    // Bar: first categorical × first numeric
    if (categoricalCols.length > 0 && numericCols.length > 0) {
      defs.push({ type: 'bar', title: numericCols[0] + ' by ' + categoricalCols[0],
                  catCol: categoricalCols[0], numCol: numericCols[0], agg: 'sum' });
    }

    // Donut: distribution of first categorical
    if (categoricalCols.length > 0) {
      defs.push({ type: 'pie', title: 'Distribution: ' + categoricalCols[0],
                  catCol: categoricalCols[0] });
    }

    // Line: date × numeric
    if (dateCols.length > 0 && numericCols.length > 0) {
      defs.push({ type: 'line', title: numericCols[0] + ' over time (' + dateCols[0] + ')',
                  dateCol: dateCols[0], numCol: numericCols[0] });
    }

    // Second bar: second categorical × numeric
    if (categoricalCols.length > 1 && numericCols.length > 0) {
      const numCol2 = numericCols.length > 1 ? numericCols[1] : numericCols[0];
      defs.push({ type: 'bar', title: numCol2 + ' by ' + categoricalCols[1],
                  catCol: categoricalCols[1], numCol: numCol2, agg: 'avg' });
    }

    // Horizontal bar: avg of all numeric columns
    if (numericCols.length >= 2) {
      defs.push({ type: 'hbar-stats', title: 'Column Averages',
                  numericCols: numericCols.slice(0, 10) });
    }

    // Scatter: first two numeric cols
    if (numericCols.length >= 2) {
      defs.push({ type: 'scatter', title: numericCols[0] + ' vs ' + numericCols[1],
                  xCol: numericCols[0], yCol: numericCols[1] });
    }

    if (defs.length === 0) {
      grid.innerHTML = '<div class="rpt-no-charts">No chartable columns detected. Try adding numeric or categorical (GROUP BY) columns to your query.</div>';
      return;
    }

    defs.forEach((def, idx) => {
      const card = document.createElement('div');
      card.className = 'rpt-chart-card';

      const titleEl = document.createElement('div');
      titleEl.className = 'rpt-chart-title';
      titleEl.textContent = def.title;

      const wrap   = document.createElement('div');
      wrap.className = 'rpt-canvas-wrap';
      const canvas = document.createElement('canvas');
      canvas.id = 'rpt-canvas-' + idx;
      wrap.appendChild(canvas);

      card.appendChild(titleEl);
      card.appendChild(wrap);
      grid.appendChild(card);

      const chart = _buildChart(canvas, def, rows, analysis);
      if (chart) ReportHandler._charts.push(chart);
    });
  }

  function _buildChart(canvas, def, rows, analysis) {
    if (typeof Chart === 'undefined') return null;

    if (def.type === 'bar') {
      const grouped = _groupBy(rows, def.catCol, def.numCol, def.agg).slice(0, 20);
      const labels  = grouped.map(g => String(g.key));
      const data    = grouped.map(g => g.value);
      return new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{
          label: def.numCol, data,
          backgroundColor: PALETTE[0] + 'cc',
          borderColor: PALETTE[0], borderWidth: 1, borderRadius: 5
        }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxRotation: 40, font: { size: 11 } } },
            y: { beginAtZero: true }
          }
        }
      });
    }

    if (def.type === 'pie') {
      const counts = _valueCounts(rows, def.catCol, 12);
      return new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: counts.map(c => String(c.key)),
          datasets: [{
            data: counts.map(c => c.count),
            backgroundColor: PALETTE.slice(0, counts.length),
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } }
          }
        }
      });
    }

    if (def.type === 'line') {
      const grouped = _groupByDate(rows, def.dateCol, def.numCol);
      return new Chart(canvas, {
        type: 'line',
        data: {
          labels: grouped.map(g => g.key),
          datasets: [{
            label: def.numCol, data: grouped.map(g => g.value),
            borderColor: PALETTE[1], backgroundColor: PALETTE[1] + '22',
            fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { maxRotation: 40, font: { size: 10 } } } }
        }
      });
    }

    if (def.type === 'hbar-stats') {
      const labels = def.numericCols;
      const data   = labels.map(col => {
        const s = analysis.numericStats[col];
        return s ? parseFloat(s.avg.toFixed(4)) : 0;
      });
      return new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Average', data,
            backgroundColor: PALETTE.slice(0, labels.length).map(c => c + 'cc'),
            borderColor:     PALETTE.slice(0, labels.length),
            borderWidth: 1, borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } }
        }
      });
    }

    if (def.type === 'scatter') {
      const pts = rows
        .map(r => ({ x: parseFloat(r[def.xCol]), y: parseFloat(r[def.yCol]) }))
        .filter(p => !isNaN(p.x) && !isNaN(p.y))
        .slice(0, 500);
      return new Chart(canvas, {
        type: 'scatter',
        data: { datasets: [{
          label: def.xCol + ' vs ' + def.yCol, data: pts,
          backgroundColor: PALETTE[3] + '88',
          borderColor: PALETTE[3], pointRadius: 4, pointHoverRadius: 6
        }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: def.xCol, font: { size: 11 } } },
            y: { title: { display: true, text: def.yCol, font: { size: 11 } } }
          }
        }
      });
    }

    return null;
  }

  /* ══════════════════════════════════════════════════════
     Data aggregation helpers
     ══════════════════════════════════════════════════════ */
  function _groupBy(rows, catCol, numCol, agg) {
    const map = {};
    rows.forEach(r => {
      const key = String(r[catCol] == null ? '(null)' : r[catCol]);
      const num = parseFloat(r[numCol]);
      if (isNaN(num)) return;
      if (!map[key]) map[key] = { sum: 0, count: 0 };
      map[key].sum   += num;
      map[key].count += 1;
    });
    return Object.entries(map)
      .map(([key, v]) => ({ key, value: agg === 'avg' ? v.sum / v.count : v.sum }))
      .sort((a, b) => b.value - a.value);
  }

  function _groupByDate(rows, dateCol, numCol) {
    const map = {};
    rows.forEach(r => {
      const raw = r[dateCol];
      if (!raw) return;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return;
      const key = d.toISOString().slice(0, 10);
      const num = parseFloat(r[numCol]);
      if (isNaN(num)) return;
      if (!map[key]) map[key] = { sum: 0, count: 0 };
      map[key].sum   += num;
      map[key].count += 1;
    });
    return Object.entries(map)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, v]) => ({ key, value: v.sum }))
      .slice(0, 60);
  }

  function _valueCounts(rows, col, limit) {
    const map = {};
    rows.forEach(r => {
      const key = String(r[col] == null ? '(null)' : r[col]);
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));
  }

  /* ══════════════════════════════════════════════════════
     Export CSV
     ══════════════════════════════════════════════════════ */
  let _lastDaxExport = null;  // stores last Power BI export for validate DAX

  function _initExportButton() {
    document.getElementById('btn-rpt-export')?.addEventListener('click', _exportCSV);
    document.getElementById('btn-rpt-export-powerbi')?.addEventListener('click', _exportPowerBI);
    document.getElementById('btn-rpt-validate-dax')?.addEventListener('click', _validateDAX);
  }

  /* ══════════════════════════════════════════════════════
     Power BI Export — generate DAX measures from current dataset
     ══════════════════════════════════════════════════════ */
  async function _exportPowerBI() {
    const { _columns: columns, _rows: rows } = ReportHandler;
    if (!rows.length) { toast('warning', 'Run a query first'); return; }

    // Determine connection
    const sel = document.getElementById('rpt-conn-select');
    if (!sel?.value) { toast('warning', 'Select a connection first'); return; }
    const connId = parseInt(sel.value.split(':')[1], 10);

    // Build a fake widget from current SQL so the backend can understand it
    const sqlArea = document.getElementById('rpt-sql-input') || document.getElementById('rpt-ai-sql');
    const sql = sqlArea ? sqlArea.value || sqlArea.textContent || '' : '';

    const model = document.getElementById('rpt-model-input')?.value || 'gpt-4o-mini';

    const btn = document.getElementById('btn-rpt-export-powerbi');
    btn.disabled = true; btn.textContent = '⏳ Generating…';

    try {
      // Use the dashboards generate-dax endpoint via a synthetic request
      const res = await fetch(`${API_BASE}/dashboards/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'Generate Power BI measures from current query results',
          conn_id: connId,
          constraints: `Columns: ${columns.join(', ')}. SQL: ${sql.substring(0, 500)}`,
          model: model,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Power BI export failed');
      }
      const data = await res.json();

      // Try to get powerbi-export from first saved dashboard if available
      // Fallback: build minimal DAX from column names
      const daxMeasures = data.dax_measures || columns
        .filter(c => {
          const vals = rows.map(r => r[c]).filter(v => v != null && v !== '');
          return vals.length && vals.every(v => !isNaN(parseFloat(v)));
        })
        .map(c => ({
          name: `Total ${c}`,
          expression: `SUM(QueryResults[${c}])`,
          description: `Sum of ${c}`,
        }));

      _lastDaxExport = { dax_measures: daxMeasures, dataset_schema: data.dataset_schema, report_json: data.report_json };

      // Offer JSON download
      const blob = new Blob([JSON.stringify(_lastDaxExport, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'powerbi-export.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);

      // Show validate button and panel
      document.getElementById('btn-rpt-validate-dax').style.display = '';
      _renderDaxPanel(daxMeasures);
      toast('success', daxMeasures.length + ' DAX measure(s) exported');
    } catch (err) {
      toast('error', 'Power BI export: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '📊 Power BI Export';
    }
  }

  function _renderDaxPanel(measures) {
    const panel = document.getElementById('rpt-dax-panel');
    if (!panel) return;
    panel.style.display = '';
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:600;margin-bottom:8px">DAX Measures Generated</div>' +
      measures.map(m =>
        `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px">` +
        `<div style="font-size:12px;font-weight:600">${_escHtml(m.name)}</div>` +
        `<code style="font-size:11px;color:var(--primary)">${_escHtml(m.expression)}</code>` +
        `<div style="font-size:11px;color:var(--text-3);margin-top:2px">${_escHtml(m.description||'')}</div>` +
        `</div>`
      ).join('');
  }

  /* ══════════════════════════════════════════════════════
     Validate DAX — check last exported measures for syntax errors
     ══════════════════════════════════════════════════════ */
  async function _validateDAX() {
    if (!_lastDaxExport || !_lastDaxExport.dax_measures?.length) {
      toast('warning', 'Export to Power BI first');
      return;
    }

    const btn = document.getElementById('btn-rpt-validate-dax');
    btn.disabled = true; btn.textContent = '⏳ Validating…';

    try {
      const res = await fetch(`${API_BASE}/dashboards/validate-dax`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measures: _lastDaxExport.dax_measures }),
      });
      const d = await res.json();

      const panel = document.getElementById('rpt-dax-panel');
      if (panel) {
        const results = d.results || [];
        panel.innerHTML =
          `<div style="font-size:13px;font-weight:600;margin-bottom:8px">DAX Validation — ` +
          `<span style="color:${d.all_valid ? '#10b981' : '#ef4444'}">${d.all_valid ? '✓ All Valid' : d.error_count + ' Error(s)'}</span></div>` +
          results.map(r =>
            `<div style="background:var(--bg-2);border:1px solid ${r.valid ? 'var(--border)' : '#ef4444'};border-radius:6px;padding:8px 10px;margin-bottom:6px">` +
            `<div style="font-size:12px;font-weight:600">${_escHtml(r.name)} ` +
            `<span style="color:${r.valid ? '#10b981' : '#ef4444'}">${r.valid ? '✓' : '✗'}</span></div>` +
            `<code style="font-size:11px">${_escHtml(r.expression)}</code>` +
            (r.errors.length ? `<div style="color:#ef4444;font-size:11px;margin-top:4px">${r.errors.map(e => '• ' + _escHtml(e)).join('<br>')}</div>` : '') +
            (r.warnings.length ? `<div style="color:#f59e0b;font-size:11px;margin-top:2px">${r.warnings.map(w => '⚠ ' + _escHtml(w)).join('<br>')}</div>` : '') +
            `</div>`
          ).join('');
      }

      toast(d.all_valid ? 'success' : 'warn', d.all_valid ? 'All DAX measures valid' : d.error_count + ' validation error(s)');
    } catch (err) {
      toast('error', 'DAX validation failed: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '✓ Validate DAX';
    }
  }

  function _exportCSV() {
    const { _columns: columns, _rows: rows } = ReportHandler;
    if (!rows.length) { toast('warning', 'No data to export'); return; }
    const esc   = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [columns.map(esc).join(',')];
    rows.forEach(r => lines.push(columns.map(c => esc(r[c])).join(',')));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'report.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('success', 'CSV downloaded: report.csv');
  }

  /* ══════════════════════════════════════════════════════
     Helpers
     ══════════════════════════════════════════════════════ */
  function _setStatus(el, state, msg) {
    if (!el) return;
    el.textContent = msg;
    el.className   = 'rpt-status rpt-status-' + state;
    el.style.display = 'inline-block';
  }

  function _fmtNum(n) {
    if (Math.abs(n) >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
    if (Math.abs(n) >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
    if (Math.abs(n) >= 1e3)  return (n / 1e3).toFixed(2)  + 'K';
    return parseFloat(n.toFixed(4)).toLocaleString();
  }

  function _escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  global.ReportHandler = ReportHandler;

})(window);
