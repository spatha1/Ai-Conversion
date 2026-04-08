/* ═══════════════════════════════════════════════════════════
   psHandler.js — Production Support AI Chat Panel
   Features: streaming progress, drag-resize, SQL magnify,
             query results dashboard (Chart.js)
   ═══════════════════════════════════════════════════════════ */
var PSHandler = (function () {
  'use strict';

  var API_BASE = 'http://localhost:8000/api';

  /* ── State ─────────────────────────────────────────────── */
  var _convId        = null;
  var _connId        = null;
  var _model         = 'gpt-4o-mini';
  var _sending       = false;
  var _lastSqlResult = null;   /* {columns, rows, row_count} from last execute_sql */

  /* ── DOM refs ───────────────────────────────────────────── */
  var $panel, $backdrop, $messages, $input, $convSel, $connSel, $modelInput;

  /* ── Chart instances (for cleanup) ─────────────────────── */
  var _dashCharts = [];

  /* ═══════════════════════════════════════════════════════
     Public init
  ═══════════════════════════════════════════════════════ */
  function init() {
    $messages   = document.getElementById('ps-messages');
    $input      = document.getElementById('ps-input');
    $convSel    = document.getElementById('ps-conv-select');
    $connSel    = document.getElementById('ps-conn-select');
    $modelInput = document.getElementById('ps-model-input');
    // PS is now an inline section — no panel/backdrop needed
    $panel      = document.getElementById('ps-fp-layout') || document.getElementById('ps-page-chat');
    $backdrop   = null;
    if (!$messages) return;

    document.getElementById('btn-ps-new-chat').addEventListener('click', _newChat);

    /* Rename button — injected next to Session row */
    var renameBtn = document.createElement('button');
    renameBtn.id = 'btn-ps-rename';
    renameBtn.className = 'btn btn-xs-secondary';
    renameBtn.title = 'Rename this session';
    renameBtn.innerHTML = '&#9998;';
    renameBtn.style.cssText = 'padding:2px 7px;font-size:13px;flex-shrink:0';
    var sessionRow = document.getElementById('btn-ps-new-chat').parentNode;
    sessionRow.appendChild(renameBtn);
    renameBtn.addEventListener('click', _renameConversation);

    /* Export button — downloads current conversation */
    var exportBtn = document.createElement('button');
    exportBtn.id = 'btn-ps-export';
    exportBtn.className = 'btn btn-xs-secondary';
    exportBtn.title = 'Export chat history (JSON / TXT)';
    exportBtn.innerHTML = '&#8659; Export';
    exportBtn.style.cssText = 'padding:2px 8px;font-size:12px;flex-shrink:0';
    sessionRow.appendChild(exportBtn);
    exportBtn.addEventListener('click', _exportConversation);

    /* Save as Workflow button */
    var wfBtn = document.createElement('button');
    wfBtn.id = 'btn-ps-save-workflow';
    wfBtn.className = 'btn btn-xs-secondary';
    wfBtn.title = 'Save actions from this chat as a reusable workflow';
    wfBtn.innerHTML = '⚡ Workflow';
    wfBtn.style.cssText = 'padding:2px 8px;font-size:12px;flex-shrink:0';
    sessionRow.appendChild(wfBtn);
    wfBtn.addEventListener('click', _saveAsWorkflow);

    $convSel.addEventListener('change', function () {
      var id = parseInt($convSel.value, 10);
      if (id) _loadConversation(id); else _newChat();
    });
    $connSel.addEventListener('change', function () {
      _connId = $connSel.value ? parseInt($connSel.value, 10) : null;
      if (_debugOpen) _refreshDebug();
    });
    $modelInput.addEventListener('change', function () {
      _model = $modelInput.value.trim() || 'gpt-4o-mini';
    });

    document.getElementById('btn-ps-send').addEventListener('click', _send);
    $input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });

    /* Debug panel */
    document.getElementById('btn-ps-debug')?.addEventListener('click', _toggleDebug);
    document.getElementById('btn-ps-debug-close')?.addEventListener('click', _hideDebug);
    document.getElementById('btn-ps-debug-refresh')?.addEventListener('click', _refreshDebug);

    document.getElementById('btn-ps-add-api').addEventListener('click', function () { _showApiForm(null); });
    document.getElementById('btn-ps-import-collection')?.addEventListener('click', _triggerImportCollection);
    document.getElementById('ps-import-file')?.addEventListener('change', _handleImportFile);

    document.getElementById('btn-ps-edit-metadata')?.addEventListener('click', function () {
      if (typeof window._openMetadataEditor === 'function') {
        window._openMetadataEditor();
      } else {
        // fallback: just switch to Admin
        window._switchSection && window._switchSection('admin');
      }
    });

    _initResize();
    _initSqlModal();
    _initDashModal();
    _loadConnections();
    _loadConversations();
    _loadApiCollection();
  }

  /* ═══════════════════════════════════════════════════════
     Drag-resize
  ═══════════════════════════════════════════════════════ */
  function _initResize() {
    var handle  = document.getElementById('ps-sidebar-resize');
    var sidebar = document.querySelector('.ps-fp-sidebar');
    if (!handle || !sidebar) return;

    var dragging = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      startX   = e.clientX;
      startW   = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor     = 'col-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var newW = Math.max(160, Math.min(480, startW + (e.clientX - startX)));
      sidebar.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
    });
  }

  /* ═══════════════════════════════════════════════════════
     SQL expand modal
  ═══════════════════════════════════════════════════════ */
  function _initSqlModal() {
    var modal = document.createElement('div');
    modal.id = 'ps-sql-modal';
    modal.className = 'ps-modal-backdrop';
    modal.style.display = 'none';
    modal.innerHTML =
      '<div class="ps-modal">' +
        '<div class="ps-modal-header">' +
          '<span>&#128203; SQL Query</span>' +
          '<div style="display:flex;gap:8px">' +
            '<button id="ps-sql-copy" class="btn btn-xs-secondary">&#128203; Copy</button>' +
            '<button id="ps-sql-close" class="btn btn-ghost btn-xs">&#10005;</button>' +
          '</div>' +
        '</div>' +
        '<div class="ps-modal-body"><pre id="ps-sql-content" style="white-space:pre-wrap;word-break:break-word"></pre></div>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('ps-sql-close').addEventListener('click', function () { modal.style.display = 'none'; });
    document.getElementById('ps-sql-copy').addEventListener('click', function () {
      var txt = document.getElementById('ps-sql-content').textContent;
      navigator.clipboard && navigator.clipboard.writeText(txt);
      window.toast && window.toast('success', 'SQL copied!');
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
  }

  function _openSqlModal(sql) {
    document.getElementById('ps-sql-content').textContent = sql;
    document.getElementById('ps-sql-modal').style.display = 'flex';
  }

  /* ═══════════════════════════════════════════════════════
     Dashboard modal (eye icon)
  ═══════════════════════════════════════════════════════ */
  function _initDashModal() {
    var modal = document.createElement('div');
    modal.id = 'ps-dash-modal';
    modal.className = 'ps-modal-backdrop';
    modal.style.display = 'none';
    modal.innerHTML =
      '<div class="ps-modal ps-modal-wide">' +
        '<div class="ps-modal-header">' +
          '<span>&#128202; Query Dashboard</span>' +
          '<div class="ps-dash-tabs">' +
            '<button class="ps-dash-tab active" data-tab="charts">&#128202; Charts</button>' +
            '<button class="ps-dash-tab" data-tab="data">&#128196; Data</button>' +
            '<button class="ps-dash-tab" data-tab="report">&#128221; Report</button>' +
          '</div>' +
          '<button id="ps-dash-close" class="btn btn-ghost btn-xs">&#10005;</button>' +
        '</div>' +
        '<div class="ps-modal-body" id="ps-dash-body">' +
          '<div id="ps-dash-pane-charts" class="ps-dash-pane"></div>' +
          '<div id="ps-dash-pane-data"    class="ps-dash-pane" style="display:none"></div>' +
          '<div id="ps-dash-pane-report"  class="ps-dash-pane" style="display:none"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    /* Tab switching */
    modal.querySelectorAll('.ps-dash-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.querySelectorAll('.ps-dash-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var target = btn.getAttribute('data-tab');
        modal.querySelectorAll('.ps-dash-pane').forEach(function (p) { p.style.display = 'none'; });
        document.getElementById('ps-dash-pane-' + target).style.display = 'block';
      });
    });

    var closeModal = function () {
      modal.style.display = 'none';
      _dashCharts.forEach(function (c) { try { c.destroy(); } catch(e){} });
      _dashCharts = [];
    };
    document.getElementById('ps-dash-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  }

  var _dashSortCol = -1, _dashSortAsc = true, _dashPage = 0;
  var _dashCols = [], _dashRows = [];
  var _DASH_PAGE_SIZE = 25;

  function _openDashboard(columns, rows) {
    _dashCharts.forEach(function (c) { try { c.destroy(); } catch(e){} });
    _dashCharts = [];
    _dashCols = columns; _dashRows = rows;
    _dashSortCol = -1; _dashSortAsc = true; _dashPage = 0;

    /* Reset to Charts tab */
    var modal = document.getElementById('ps-dash-modal');
    modal.querySelectorAll('.ps-dash-tab').forEach(function (b) { b.classList.remove('active'); });
    modal.querySelector('[data-tab="charts"]').classList.add('active');
    modal.querySelectorAll('.ps-dash-pane').forEach(function (p) { p.style.display = 'none'; });
    document.getElementById('ps-dash-pane-charts').style.display = 'block';

    var analysis = _analyzeColumns(columns, rows);

    /* ── Charts pane ──────────────────────────────── */
    var chartsPane = document.getElementById('ps-dash-pane-charts');
    chartsPane.innerHTML = '';

    /* KPI row */
    var kpiRow = document.createElement('div');
    kpiRow.className = 'ps-dash-kpi-row';
    kpiRow.innerHTML =
      _kpiCard('Total Rows', rows.length) +
      _kpiCard('Columns', columns.length);
    if (analysis.numericCols.length) {
      var nc = analysis.numericCols[0];
      var vals = analysis.numericData[nc];
      kpiRow.innerHTML += _kpiCard(nc + ' Sum', _fmtNum(_sum(vals)));
      kpiRow.innerHTML += _kpiCard(nc + ' Avg', _fmtNum(_sum(vals) / vals.length));
      if (analysis.numericCols.length > 1) {
        var nc2 = analysis.numericCols[1];
        var vals2 = analysis.numericData[nc2];
        kpiRow.innerHTML += _kpiCard(nc2 + ' Max', _fmtNum(Math.max.apply(null, vals2)));
      }
    }
    chartsPane.appendChild(kpiRow);

    /* Charts grid */
    var grid = document.createElement('div');
    grid.className = 'ps-dash-charts';
    chartsPane.appendChild(grid);

    if (analysis.catCols.length && analysis.numericCols.length) {
      var cat = analysis.catCols[0], num = analysis.numericCols[0];
      var grouped = _groupBy(rows, columns, cat, num, 'sum');
      _addChart(grid, 'bar', Object.keys(grouped), [Object.values(grouped)], [num], num + ' by ' + cat);
    }
    if (analysis.catCols.length) {
      var vc = _valueCounts(rows, columns, analysis.catCols[0]);
      _addChart(grid, 'pie', Object.keys(vc), [Object.values(vc)], [analysis.catCols[0]], analysis.catCols[0] + ' Distribution');
    }
    if (analysis.dateCols.length && analysis.numericCols.length) {
      var dc = analysis.dateCols[0], dn = analysis.numericCols[0];
      var dg = _groupByDate(rows, columns, dc, dn);
      _addChart(grid, 'line', Object.keys(dg), [Object.values(dg)], [dn], dn + ' over time');
    }
    if (analysis.catCols.length > 1 && analysis.numericCols.length) {
      var cat2 = analysis.catCols[1], num2 = analysis.numericCols[0];
      var g2 = _groupBy(rows, columns, cat2, num2, 'avg');
      _addChart(grid, 'bar', Object.keys(g2), [Object.values(g2)], [cat2], 'Avg ' + num2 + ' by ' + cat2);
    }
    if (analysis.numericCols.length >= 2) {
      var nx = analysis.numericCols[0], ny = analysis.numericCols[1];
      var nxi = columns.indexOf(nx), nyi = columns.indexOf(ny);
      var pts = rows.slice(0, 500).map(function (r) {
        return { x: parseFloat(_getVal(r, columns, nxi)) || 0, y: parseFloat(_getVal(r, columns, nyi)) || 0 };
      });
      _addScatter(grid, pts, nx, ny);
    }
    if (!grid.children.length) {
      grid.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:12px">No numeric or categorical columns detected for charts.</p>';
    }

    /* ── Data pane ────────────────────────────────── */
    _renderDataPane();

    /* ── Report pane ──────────────────────────────── */
    _renderReportPane(columns, rows, analysis);

    modal.style.display = 'flex';
  }

  function _renderDataPane() {
    var pane = document.getElementById('ps-dash-pane-data');
    pane.innerHTML = '';

    var cols = _dashCols, rows = _dashRows;

    /* Toolbar: search + export */
    var toolbar = document.createElement('div');
    toolbar.className = 'ps-data-toolbar';
    toolbar.innerHTML =
      '<input id="ps-data-search" class="ps-data-search" type="text" placeholder="&#128269; Search rows…" />' +
      '<span id="ps-data-rowcount" class="ps-data-rowcount"></span>' +
      '<button id="ps-data-export" class="btn btn-xs-secondary">&#8659; CSV</button>';
    pane.appendChild(toolbar);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'ps-data-table-wrap';
    pane.appendChild(tableWrap);

    var pagBar = document.createElement('div');
    pagBar.className = 'ps-data-pager';
    pane.appendChild(pagBar);

    function _filteredRows() {
      var q = (document.getElementById('ps-data-search') || {}).value || '';
      q = q.trim().toLowerCase();
      if (!q) return _dashRows;
      return _dashRows.filter(function (row) {
        var vals = Array.isArray(row) ? row : cols.map(function (c) { return row[c]; });
        return vals.some(function (v) { return String(v === null || v === undefined ? '' : v).toLowerCase().indexOf(q) !== -1; });
      });
    }

    function _sortedRows(filtered) {
      if (_dashSortCol < 0) return filtered;
      var ci = _dashSortCol;
      return filtered.slice().sort(function (a, b) {
        var av = _getVal(a, cols, ci), bv = _getVal(b, cols, ci);
        var an = parseFloat(av), bn = parseFloat(bv);
        var cmp = (!isNaN(an) && !isNaN(bn)) ? (an - bn) : String(av||'').localeCompare(String(bv||''));
        return _dashSortAsc ? cmp : -cmp;
      });
    }

    function _renderTable() {
      var filtered = _filteredRows();
      var sorted   = _sortedRows(filtered);
      var totalPages = Math.max(1, Math.ceil(sorted.length / _DASH_PAGE_SIZE));
      if (_dashPage >= totalPages) _dashPage = totalPages - 1;
      var pageRows = sorted.slice(_dashPage * _DASH_PAGE_SIZE, (_dashPage + 1) * _DASH_PAGE_SIZE);

      /* Row count */
      var rc = document.getElementById('ps-data-rowcount');
      if (rc) rc.textContent = sorted.length + ' row(s)' + (filtered.length < _dashRows.length ? ' (filtered)' : '');

      /* Table */
      var t = document.createElement('table');
      t.className = 'ps-data-full-table';
      var thead = '<thead><tr>' + cols.map(function (c, i) {
        var arrow = (_dashSortCol === i) ? (_dashSortAsc ? ' &#9650;' : ' &#9660;') : ' <span style="opacity:.3">&#8597;</span>';
        return '<th data-ci="' + i + '">' + _esc(c) + arrow + '</th>';
      }).join('') + '</tr></thead>';
      var tbody = '<tbody>' + pageRows.map(function (row) {
        var vals = Array.isArray(row) ? row : cols.map(function (c) { return row[c]; });
        return '<tr>' + vals.map(function (v) {
          return '<td>' + _esc(v === null || v === undefined ? '' : v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
      t.innerHTML = thead + tbody;
      t.querySelectorAll('th[data-ci]').forEach(function (th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function () {
          var ci = parseInt(th.getAttribute('data-ci'), 10);
          if (_dashSortCol === ci) { _dashSortAsc = !_dashSortAsc; } else { _dashSortCol = ci; _dashSortAsc = true; }
          _dashPage = 0;
          _renderTable();
        });
      });
      tableWrap.innerHTML = '';
      tableWrap.appendChild(t);

      /* Pager */
      pagBar.innerHTML = '';
      if (totalPages > 1) {
        var prev = document.createElement('button');
        prev.className = 'btn btn-xs-secondary'; prev.textContent = '‹ Prev';
        prev.disabled = _dashPage === 0;
        prev.addEventListener('click', function () { _dashPage--; _renderTable(); });

        var info = document.createElement('span');
        info.style.cssText = 'font-size:12px;color:#64748b;padding:0 8px';
        info.textContent = 'Page ' + (_dashPage + 1) + ' / ' + totalPages;

        var next = document.createElement('button');
        next.className = 'btn btn-xs-secondary'; next.textContent = 'Next ›';
        next.disabled = _dashPage >= totalPages - 1;
        next.addEventListener('click', function () { _dashPage++; _renderTable(); });

        pagBar.appendChild(prev); pagBar.appendChild(info); pagBar.appendChild(next);
      }
    }

    _renderTable();

    toolbar.querySelector('#ps-data-search').addEventListener('input', function () {
      _dashPage = 0; _renderTable();
    });

    /* CSV export */
    toolbar.querySelector('#ps-data-export').addEventListener('click', function () {
      var lines = [cols.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',')];
      _dashRows.forEach(function (row) {
        var vals = Array.isArray(row) ? row : cols.map(function (c) { return row[c]; });
        lines.push(vals.map(function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }).join(','));
      });
      var blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'query_results.csv';
      a.click();
    });
  }

  function _renderReportPane(columns, rows, analysis) {
    var pane = document.getElementById('ps-dash-pane-report');
    pane.innerHTML = '';

    var lines = [];
    lines.push('## Query Result Report');
    lines.push('');
    lines.push('**' + rows.length + ' rows · ' + columns.length + ' columns**');
    lines.push('');

    /* Numeric summary table */
    if (analysis.numericCols.length) {
      lines.push('### Numeric Summary');
      lines.push('');
      lines.push('| Column | Min | Max | Sum | Avg |');
      lines.push('|--------|-----|-----|-----|-----|');
      analysis.numericCols.forEach(function (col) {
        var vals = analysis.numericData[col];
        var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
        var sm = _sum(vals), av = sm / vals.length;
        lines.push('| ' + col + ' | ' + _fmtNum(mn) + ' | ' + _fmtNum(mx) + ' | ' + _fmtNum(sm) + ' | ' + _fmtNum(av) + ' |');
      });
      lines.push('');
    }

    /* Categorical frequency */
    if (analysis.catCols.length) {
      lines.push('### Category Breakdown');
      lines.push('');
      analysis.catCols.slice(0, 3).forEach(function (col) {
        var vc = _valueCounts(rows, columns, col);
        var total = rows.length;
        lines.push('**' + col + '**');
        lines.push('');
        lines.push('| Value | Count | % |');
        lines.push('|-------|-------|---|');
        Object.keys(vc).slice(0, 10).forEach(function (k) {
          var pct = ((vc[k] / total) * 100).toFixed(1);
          lines.push('| ' + k + ' | ' + vc[k] + ' | ' + pct + '% |');
        });
        lines.push('');
      });
    }

    /* Full data table (up to 100 rows) */
    lines.push('### Data Sample (first 100 rows)');
    lines.push('');
    lines.push('| ' + columns.join(' | ') + ' |');
    lines.push('| ' + columns.map(function () { return '---'; }).join(' | ') + ' |');
    rows.slice(0, 100).forEach(function (row) {
      var vals = Array.isArray(row) ? row : columns.map(function (c) { return row[c]; });
      lines.push('| ' + vals.map(function (v) { return String(v === null || v === undefined ? '' : v).replace(/\|/g, '&#124;'); }).join(' | ') + ' |');
    });
    if (rows.length > 100) lines.push('', '*... and ' + (rows.length - 100) + ' more rows*');

    var md = (typeof marked !== 'undefined') ? marked.parse(lines.join('\n')) : '<pre>' + lines.join('\n') + '</pre>';
    var wrap = document.createElement('div');
    wrap.className = 'ps-report-pane-content';
    wrap.innerHTML = md;
    pane.appendChild(wrap);

    /* Copy markdown button */
    var copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-xs-secondary';
    copyBtn.style.cssText = 'margin-top:10px';
    copyBtn.innerHTML = '&#128203; Copy Report';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard && navigator.clipboard.writeText(lines.join('\n'));
      window.toast && window.toast('success', 'Report copied!');
    });
    pane.appendChild(copyBtn);
  }

  /* ═══════════════════════════════════════════════════════
     Panel open / close / new chat
  ═══════════════════════════════════════════════════════ */
  function _open()  { if (window._switchSection) window._switchSection('ps'); $input && $input.focus(); }
  function _close() { /* no-op — PS is a section, not a drawer */ }
  function _newChat() {
    /* reset all session state */
    _convId   = null;
    _connId   = null;
    _sending  = false;
    _lastSqlResult = null;
    document.getElementById('btn-ps-send').disabled = false;
    $convSel.value = '';
    _clearMessages();
    _appendWelcome();
    _unlockConnection();
  }

  /* ═══════════════════════════════════════════════════════
     Load helpers
  ═══════════════════════════════════════════════════════ */
  function _loadConnections() {
    fetch(API_BASE + '/connections')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        $connSel.innerHTML = '<option value="">— none —</option>';
        (list || []).forEach(function (c) {
          var o = document.createElement('option');
          o.value = c.id; o.textContent = c.name + ' (' + c.source_type + ')';
          $connSel.appendChild(o);
        });
      }).catch(function () {});
  }

  function _loadConversations() {
    fetch(API_BASE + '/ps/conversations')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        $convSel.innerHTML = '<option value="">— New chat —</option>';
        (list || []).forEach(function (c) {
          var o = document.createElement('option');
          o.value = c.id; o.textContent = (c.title || 'Chat #' + c.id).substring(0, 45);
          $convSel.appendChild(o);
        });
      }).catch(function () {});
  }

  function _loadConversation(id) {
    fetch(API_BASE + '/ps/conversations/' + id)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        _convId = data.conversation.id;
        if (data.conversation.conn_id) {
          _connId = data.conversation.conn_id;
          $connSel.value = _connId;
          _lockConnection();   /* session already has a connection — lock it */
        } else {
          _unlockConnection();
        }
        $modelInput.value = data.conversation.model || 'gpt-4o-mini';
        _model = $modelInput.value;
        _clearMessages();
        (data.messages || []).forEach(function (m) {
          if (m.role === 'user') _appendBubble('user', m.content);
          else if (m.role === 'assistant' && m.content) _appendBubble('asst', m.content);
          else if (m.role === 'tool') _appendToolCard(m.tool_name, null, m.tool_output_json);
        });
      }).catch(function () {});
  }

  /* ═══════════════════════════════════════════════════════
     Send — streaming
  ═══════════════════════════════════════════════════════ */
  function _lockConnection() {
    $connSel.disabled = true;
    $connSel.title = 'Connection is locked for this session. Start a new chat to change it.';
  }

  function _unlockConnection() {
    $connSel.disabled = false;
    $connSel.title = '';
  }

  function _send() {
    if (_sending) return;
    var text = $input.value.trim();
    if (!text) return;

    _model  = $modelInput.value.trim() || 'gpt-4o-mini';
    /* Only read connId on the FIRST message — lock it after that */
    if (!_convId) {
      _connId = $connSel.value ? parseInt($connSel.value, 10) : null;
    }

    $input.value = '';
    _sending = true;
    document.getElementById('btn-ps-send').disabled = true;

    /* Lock connection once session starts */
    _lockConnection();

    _appendBubble('user', text);

    /* Live progress container */
    var progressEl = _appendProgress();

    var body = JSON.stringify({
      conversation_id:   _convId,
      message:           text,
      conn_id:           _connId,
      model:             _model,
      pending_approvals: []
    });

    fetch(API_BASE + '/ps/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    })
    .then(function (resp) {
      if (!resp.ok) {
        return resp.json().then(function (e) { throw new Error(e.detail || 'Chat failed'); });
      }
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function read() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { _onStreamDone(progressEl); return; }
          buffer += decoder.decode(chunk.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (!line) return;
            try { _handleStreamEvent(JSON.parse(line), progressEl); } catch(e) {}
          });
          return read();
        });
      }
      return read();
    })
    .catch(function (err) {
      if (progressEl) _collapseProgress(progressEl);
      _appendBubble('asst', '**Error:** ' + _esc(err.message));
      _onStreamDone(null);
    });
  }

  function _onStreamDone(progressEl) {
    if (progressEl) _collapseProgress(progressEl);
    _sending = false;
    document.getElementById('btn-ps-send').disabled = false;
    _loadConversations();
    if (_convId) $convSel.value = _convId;
  }

  /* ═══════════════════════════════════════════════════════
     Stream event handler
  ═══════════════════════════════════════════════════════ */
  function _handleStreamEvent(ev, progressEl) {
    if (ev.conversation_id) _convId = ev.conversation_id;

    if (ev.type === 'tool_start') {
      _updateProgress(progressEl, ev.tool, ev.label, 'running');
    }
    else if (ev.type === 'tool_done') {
      _updateProgress(progressEl, ev.tool, null, 'done');
      _appendToolCard(ev.tool, null, JSON.stringify(ev.output));
      /* Cache last SQL result so we can attach eye button to assistant bubble */
      if (ev.tool === 'execute_sql' && ev.output && ev.output.columns) {
        _lastSqlResult = ev.output;
      }
    }
    else if (ev.type === 'approval_needed') {
      _updateProgress(progressEl, ev.tool, null, 'waiting');
      // For execute_api_bulk, extract bulk fields from fn_args (ev.input)
      var rowCount = null;
      if (ev.tool === 'execute_api_bulk' && ev.preview) {
        var m = ev.preview.match(/(\d+)\s+record/);
        if (m) rowCount = parseInt(m[1], 10);
      }
      _appendApprovalCard({
        tool_call_id:          ev.tool_call_id,
        tool:                  ev.tool,
        input:                 ev.input,
        preview:               ev.preview,
        bulk_sql:              (ev.input && ev.input.sql)              || null,
        bulk_payload_template: (ev.input && ev.input.payload_template) || null,
        row_count:             rowCount
      });
    }
    else if (ev.type === 'message') {
      var bubble = _appendBubble('asst', ev.content || '');
      /* If there's SQL data, attach a dashboard button directly to the bubble */
      if (_lastSqlResult && _lastSqlResult.columns && _lastSqlResult.rows) {
        _attachDashBtn(bubble, _lastSqlResult);
        _lastSqlResult = null;
      }
    }
    else if (ev.type === 'title_update') {
      /* Update or add conversation in the session dropdown */
      var convId = ev.conversation_id;
      var title  = (ev.title || 'Chat #' + convId).substring(0, 45);
      var opt = $convSel.querySelector('option[value="' + convId + '"]');
      if (opt) {
        opt.textContent = title;
      } else {
        var newOpt = document.createElement('option');
        newOpt.value = convId;
        newOpt.textContent = title;
        $convSel.insertBefore(newOpt, $convSel.options[1] || null);
      }
      $convSel.value = String(convId);
    }
    else if (ev.type === 'error') {
      _appendBubble('asst', '**Error:** ' + _esc(ev.detail || 'Unknown error'));
      _onStreamDone(progressEl);
    }
    else if (ev.type === 'done') {
      _onStreamDone(progressEl);
    }
  }

  /* ═══════════════════════════════════════════════════════
     Approval submit
  ═══════════════════════════════════════════════════════ */
  function _submitApproval(toolCallId, approved, cardEl, pa) {
    cardEl.remove();
    var progressEl = _appendProgress();

    // Send full tool input back so backend can execute directly — no LLM replay needed
    var approvalEntry = { tool_call_id: toolCallId, approved: approved };
    if (pa && pa.input) {
      if (pa.input.api_id != null)  approvalEntry.api_id  = pa.input.api_id;
      if (pa.input.payload)         approvalEntry.payload = pa.input.payload;
      if (pa.input.sql)             approvalEntry.sql     = pa.input.sql;
    }
    // Bulk API: pass bulk_sql + bulk_payload_template so backend can loop without LLM replay
    if (pa && pa.tool === 'execute_api_bulk' && pa.input && pa.input.sql) {
      approvalEntry.api_id                = pa.input.api_id != null ? pa.input.api_id : null;
      approvalEntry.bulk_sql              = pa.input.sql;
      approvalEntry.bulk_payload_template = pa.input.payload_template || {};
    }

    fetch(API_BASE + '/ps/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id:   _convId,
        message:           approved ? '[Approved: ' + toolCallId + ']' : '[Rejected: ' + toolCallId + ']',
        conn_id:           _connId,
        model:             _model,
        pending_approvals: [approvalEntry]
      })
    })
    .then(function (resp) {
      if (!resp.ok) return resp.json().then(function (e) { throw new Error(e.detail || 'Failed'); });
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function read() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { _onStreamDone(progressEl); return; }
          buffer += decoder.decode(chunk.value, { stream: true });
          var lines = buffer.split('\n'); buffer = lines.pop();
          lines.forEach(function (line) {
            line = line.trim(); if (!line) return;
            try { _handleStreamEvent(JSON.parse(line), progressEl); } catch(e) {}
          });
          return read();
        });
      }
      return read();
    })
    .catch(function (err) {
      if (progressEl) _collapseProgress(progressEl);
      _appendBubble('asst', '**Error:** ' + _esc(err.message));
    });
  }

  /* ═══════════════════════════════════════════════════════
     Progress display
  ═══════════════════════════════════════════════════════ */
  var _toolIcons = {
    lookup_schema:     '&#128269;',
    generate_sql:      '&#128203;',
    execute_sql:       '&#9654;',
    list_api_endpoints:'&#128279;',
    execute_api:       '&#9889;',
    preview_email:     '&#128140;',
    generate_report:   '&#128202;'
  };

  function _appendProgress() {
    var wrap = document.createElement('div');
    wrap.className = 'ps-progress-wrap';
    wrap._stepCount = 0;
    wrap.innerHTML =
      '<div class="ps-progress-header">' +
        '<span class="ps-progress-spinner"></span>' +
        '<span class="ps-progress-title">Agent is working…</span>' +
      '</div>' +
      '<div class="ps-progress-steps"></div>';
    $messages.appendChild(wrap);
    _scroll();
    return wrap;
  }

  function _updateProgress(wrap, tool, label, state) {
    if (!wrap) return;
    var steps = wrap.querySelector('.ps-progress-steps');
    if (!steps) return;
    var existing = steps.querySelector('[data-tool-instance="' + tool + '-' + state + '"]') ||
                   steps.querySelector('[data-tool="' + tool + '"][data-state="running"]');
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'ps-progress-step';
      existing.setAttribute('data-tool', tool);
      existing.innerHTML =
        '<span class="ps-step-icon">' + (_toolIcons[tool] || '&#128296;') + '</span>' +
        '<span class="ps-step-label">' + (label || _toolLabel(tool)) + '</span>' +
        '<span class="ps-step-state"></span>';
      steps.appendChild(existing);
      wrap._stepCount = (wrap._stepCount || 0) + 1;
    }
    existing.setAttribute('data-state', state);
    var stateEl = existing.querySelector('.ps-step-state');
    if (state === 'running') {
      existing.className = 'ps-progress-step running';
      stateEl.innerHTML = '<span class="ps-step-spinner"></span>';
    } else if (state === 'done') {
      existing.className = 'ps-progress-step done';
      stateEl.innerHTML = '<span style="color:#10b981;font-weight:700">&#10003;</span>';
    } else if (state === 'waiting') {
      existing.className = 'ps-progress-step waiting';
      stateEl.innerHTML = '<span style="color:#f59e0b">&#9654; Waiting approval</span>';
    }
    _scroll();
  }

  function _collapseProgress(wrap) {
    if (!wrap || !wrap.parentNode) return;
    var stepCount = wrap._stepCount || wrap.querySelectorAll('.ps-progress-step').length;
    if (stepCount === 0) { wrap.remove(); return; }

    /* Replace the header with a collapsed summary that can be toggled open */
    var header = wrap.querySelector('.ps-progress-header');
    var steps   = wrap.querySelector('.ps-progress-steps');
    if (header) {
      header.innerHTML =
        '<span class="ps-prog-toggle-arrow">&#9654;</span>' +
        '<span style="font-size:13px">&#128203;</span>' +
        '<span class="ps-progress-title" style="color:#374151">' +
          stepCount + ' step' + (stepCount !== 1 ? 's' : '') + ' completed' +
        '</span>';
      header.style.cursor = 'pointer';
      header.style.background = '#f1f5f9';
      /* Remove spinner */
      wrap.querySelector('.ps-progress-spinner') && wrap.querySelector('.ps-progress-spinner').remove();
    }
    if (steps) steps.style.display = 'none';   /* collapsed by default */

    /* Toggle on click */
    if (header) {
      header.addEventListener('click', function () {
        var open = steps.style.display !== 'none';
        steps.style.display = open ? 'none' : 'block';
        var arrow = header.querySelector('.ps-prog-toggle-arrow');
        if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
      });
    }
    wrap.className = 'ps-progress-wrap ps-progress-done';
  }

  /* ═══════════════════════════════════════════════════════
     Rename conversation
  ═══════════════════════════════════════════════════════ */
  function _renameConversation() {
    if (!_convId) { window.toast && window.toast('warning', 'No active session to rename.'); return; }
    var current = ($convSel.querySelector('option[value="' + _convId + '"]') || {}).textContent || '';
    var newTitle = window.prompt('Rename this session:', current);
    if (!newTitle || !newTitle.trim()) return;
    newTitle = newTitle.trim();
    fetch(API_BASE + '/ps/conversations/' + _convId + '/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
    .then(function () {
      var opt = $convSel.querySelector('option[value="' + _convId + '"]');
      if (opt) opt.textContent = newTitle.substring(0, 45);
      window.toast && window.toast('success', 'Session renamed.');
    })
    .catch(function () { window.toast && window.toast('error', 'Rename failed.'); });
  }

  /* ═══════════════════════════════════════════════════════
     Export conversation
  ═══════════════════════════════════════════════════════ */
  function _exportConversation() {
    if (!_convId) { window.toast && window.toast('warning', 'No active session to export.'); return; }
    var fmt = window.confirm('Click OK for JSON (structured), Cancel for plain text transcript.') ? 'json' : 'text';
    var url = API_BASE + '/ps/conversations/' + _convId + '/export?fmt=' + fmt;
    var a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ═══════════════════════════════════════════════════════
     Dashboard button attached to assistant bubble
  ═══════════════════════════════════════════════════════ */
  function _attachDashBtn(bubble, sqlResult) {
    var bar = document.createElement('div');
    bar.className = 'ps-bubble-dash-bar';
    var btn = document.createElement('button');
    btn.className = 'ps-bubble-dash-btn';
    btn.innerHTML = '&#128202; View Dashboard &amp; Full Data';
    btn.addEventListener('click', function () {
      _openDashboard(sqlResult.columns, sqlResult.rows);
    });
    bar.appendChild(btn);
    /* Also show row count */
    var cnt = document.createElement('span');
    cnt.className = 'ps-bubble-dash-count';
    cnt.textContent = (sqlResult.row_count || sqlResult.rows.length) + ' rows';
    bar.insertBefore(cnt, btn);
    bubble.appendChild(bar);
  }

  /* ═══════════════════════════════════════════════════════
     Message rendering
  ═══════════════════════════════════════════════════════ */
  function _appendWelcome() {
    var div = document.createElement('div');
    div.className = 'ps-bubble ps-bubble-asst';
    div.innerHTML = '<p>&#128075; Hi! I&rsquo;m your Production Support assistant.</p>' +
      '<p>Select a <strong>data source</strong> above, then ask me anything &mdash; I can query your data, identify issues, call APIs, and generate reports.</p>';
    $messages.appendChild(div);
  }

  function _appendBubble(role, text) {
    var div = document.createElement('div');
    div.className = 'ps-bubble ps-bubble-' + (role === 'user' ? 'user' : 'asst');
    if (role === 'asst') {
      var md = (typeof marked !== 'undefined') ? marked.parse(text || '') : _escHtml(text || '');
      div.innerHTML = md;
    } else {
      div.textContent = text || '';
    }
    $messages.appendChild(div);
    _scroll();
    return div;
  }

  function _appendToolCard(toolName, inputJson, outputJson) {
    var icon = _toolIcons[toolName] || '&#128296;';
    var card = document.createElement('div');
    card.className = 'ps-tool-card';

    /* Header row — always visible, click to toggle body */
    var header = document.createElement('div');
    header.className = 'ps-tool-card-header';
    var startOpen = (toolName === 'execute_sql' || toolName === 'generate_sql');
    header.innerHTML =
      '<span class="ps-tool-card-arrow">' + (startOpen ? '&#9660;' : '&#9654;') + '</span>' +
      '<span class="ps-tool-card-icon">' + icon + '</span>' +
      '<span class="ps-tool-card-label">' + _toolLabel(toolName) + '</span>';
    card.appendChild(header);

    /* Body — collapsible */
    var body = document.createElement('div');
    body.className = 'ps-tool-card-body';
    body.style.display = startOpen ? 'block' : 'none';

    try {
      var output = outputJson ? JSON.parse(outputJson) : {};
      if (toolName === 'execute_sql' && output.columns && output.rows !== undefined) {
        body.appendChild(_buildResultSection(output.columns, output.rows, output.row_count));
      } else if (toolName === 'preview_email' && output.type === 'email_preview') {
        body.appendChild(_buildEmailCard(output));
      } else if (toolName === 'generate_sql' && output.sql) {
        body.appendChild(_buildSqlBlock(output.sql));
      } else if (toolName === 'generate_report' && output.report) {
        var rDiv = document.createElement('div');
        rDiv.style.cssText = 'font-size:12px;line-height:1.5';
        rDiv.innerHTML = (typeof marked !== 'undefined') ? marked.parse(output.report) : _escHtml(output.report);
        body.appendChild(rDiv);
      } else if (toolName === 'lookup_schema' && output.matched_columns) {
        body.appendChild(_buildSchemaTable(output.matched_columns));
      } else {
        var pre = document.createElement('pre');
        pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:11px';
        pre.textContent = JSON.stringify(output, null, 2);
        body.appendChild(pre);
      }
    } catch (e) {
      var pre2 = document.createElement('pre');
      pre2.style.cssText = 'white-space:pre-wrap;font-size:11px';
      pre2.textContent = outputJson || '';
      body.appendChild(pre2);
    }

    card.appendChild(body);

    /* Toggle on header click */
    header.addEventListener('click', function () {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      header.querySelector('.ps-tool-card-arrow').innerHTML = open ? '&#9654;' : '&#9660;';
      _scroll();
    });

    $messages.appendChild(card);
    _scroll();
  }

  /* ── SQL block with magnify icon ────────────────────────── */
  function _buildSqlBlock(sql) {
    var wrap = document.createElement('div');
    wrap.style.position = 'relative';

    var btn = document.createElement('button');
    btn.className = 'ps-sql-expand-btn';
    btn.innerHTML = '&#128269;';
    btn.title = 'Expand SQL';
    btn.addEventListener('click', function () { _openSqlModal(sql); });
    wrap.appendChild(btn);

    var pre = document.createElement('pre');
    pre.className = 'ps-sql-pre';
    pre.textContent = sql;
    wrap.appendChild(pre);
    return wrap;
  }

  /* ── Schema lookup table ────────────────────────────────── */
  function _buildSchemaTable(cols) {
    if (!cols || !cols.length) {
      var p = document.createElement('p'); p.textContent = 'No matches found.'; return p;
    }
    var t = '<table class="ps-result-table"><thead><tr><th>Table</th><th>Column</th><th>Match</th></tr></thead><tbody>';
    cols.slice(0, 15).forEach(function (c) {
      var pct = Math.round((c.score || 0) * 100);
      var bar = '<div style="background:#dbeafe;border-radius:3px;height:6px;width:100%;margin-top:2px"><div style="background:var(--primary);height:6px;border-radius:3px;width:' + pct + '%"></div></div>';
      t += '<tr><td>' + _esc(c.table_name) + '</td><td>' + _esc(c.column_name) + '</td><td>' + pct + '%' + bar + '</td></tr>';
    });
    t += '</tbody></table>';
    var wrap = document.createElement('div');
    wrap.innerHTML = t;
    return wrap;
  }

  /* ── SQL results with eye icon ──────────────────────────── */
  function _buildResultSection(columns, rows, rowCount) {
    var wrap = document.createElement('div');

    /* Action bar */
    var bar = document.createElement('div');
    bar.className = 'ps-result-bar';

    var count = document.createElement('span');
    count.className = 'ps-result-count';
    count.textContent = (rowCount || rows.length) + ' row(s)' + (rows.length > 10 ? ' · showing first 10' : '');
    bar.appendChild(count);

    var eyeBtn = document.createElement('button');
    eyeBtn.className = 'ps-eye-btn';
    eyeBtn.innerHTML = '&#128065; Dashboard';
    eyeBtn.title = 'Open chart dashboard';
    eyeBtn.addEventListener('click', function () { _openDashboard(columns, rows); });
    bar.appendChild(eyeBtn);
    wrap.appendChild(bar);

    /* Table */
    var t = document.createElement('table');
    t.className = 'ps-result-table';
    var thead = '<thead><tr>' + columns.map(function (c) { return '<th>' + _esc(c) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>';
    rows.slice(0, 10).forEach(function (row) {
      var vals = Array.isArray(row) ? row : columns.map(function (c) { return row[c]; });
      tbody += '<tr>' + vals.map(function (v) { return '<td>' + _esc(v === null || v === undefined ? '' : v) + '</td>'; }).join('') + '</tr>';
    });
    tbody += '</tbody>';
    t.innerHTML = thead + tbody;
    wrap.appendChild(t);
    return wrap;
  }

  function _appendApprovalCard(pa) {
    var div = document.createElement('div');
    div.className = 'ps-approval-card';
    var isBulk = pa.tool === 'execute_api_bulk';
    var titleIcon = isBulk ? '&#9889;' : '&#9888;';
    var titleText = isBulk
      ? 'Bulk API Approval: ' + (pa.row_count != null ? '<strong>' + pa.row_count + ' record(s)</strong>' : 'multiple records')
      : 'Approval Required: ' + _toolLabel(pa.tool);
    div.innerHTML =
      '<div class="ps-approval-title">' + titleIcon + ' ' + titleText + '</div>' +
      (isBulk && pa.row_count != null
        ? '<div class="ps-approval-bulk-count">&#128260; Will call API <strong>' + pa.row_count + '</strong> time(s) — one per record</div>'
        : '') +
      '<div class="ps-approval-preview">' + _esc(pa.preview || '') + '</div>' +
      '<div class="ps-approval-btns">' +
        '<button class="ps-btn-approve">&#10003; ' + (isBulk ? 'Approve All' : 'Approve') + '</button>' +
        '<button class="ps-btn-reject">&#10005; Reject</button>' +
      '</div>';
    div.querySelector('.ps-btn-approve').addEventListener('click', function () { _submitApproval(pa.tool_call_id, true, div, pa); });
    div.querySelector('.ps-btn-reject').addEventListener('click', function () { _submitApproval(pa.tool_call_id, false, div, pa); });
    $messages.appendChild(div);
    // Always scroll to approval card — it requires user action and must be visible regardless of position
    $messages.scrollTop = $messages.scrollHeight;
  }

  function _buildEmailCard(data) {
    var div = document.createElement('div');
    div.className = 'ps-email-card';
    var sendBtn = '<button class="ps-email-send-btn" data-to="' + _esc(data.to||'') + '" data-subject="' + _esc(data.subject||'') + '" data-body="' + _esc(data.body||'') + '">📨 Send Email</button>';
    div.innerHTML =
      '<div class="ps-email-header">✉ Email Preview</div>' +
      '<div class="ps-email-meta"><span><strong>To:</strong> ' + _esc(data.to || '') + '</span><span><strong>Subject:</strong> ' + _esc(data.subject || '') + '</span></div>' +
      '<div class="ps-email-body">' + _escHtml(data.body || '') + '</div>' +
      '<div class="ps-email-footer">⚠ Preview only — no email was sent. ' + sendBtn + '</div>';
    // Wire send button
    setTimeout(function () {
      div.querySelectorAll('.ps-email-send-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          btn.disabled = true; btn.textContent = '⏳ Sending…';
          try {
            var res = await fetch(API_BASE + '/ps/email/send', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: btn.dataset.to, subject: btn.dataset.subject, body: btn.dataset.body }),
            });
            var d = await res.json();
            if (res.ok) {
              btn.textContent = '✅ Sent';
              window.toast && window.toast('success', 'Email sent to ' + btn.dataset.to);
            } else {
              btn.disabled = false; btn.textContent = '📨 Send Email';
              window.toast && window.toast('error', d.detail || 'Send failed');
            }
          } catch (_) {
            btn.disabled = false; btn.textContent = '📨 Send Email';
            window.toast && window.toast('error', 'Backend unreachable');
          }
        });
      });
    }, 0);
    return div;
  }

  function _clearMessages() { $messages.innerHTML = ''; }
  function _scroll() {
    /* Only auto-scroll if the user is already near the bottom (within 120px) */
    var atBottom = $messages.scrollHeight - $messages.scrollTop - $messages.clientHeight < 120;
    if (atBottom) {
      $messages.scrollTop = $messages.scrollHeight;
    }
  }

  /* ═══════════════════════════════════════════════════════
     Dashboard helpers (column analysis + Chart.js)
  ═══════════════════════════════════════════════════════ */
  var _PALETTE = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16','#06b6d4','#a855f7'];

  function _getVal(row, columns, ci) {
    return Array.isArray(row) ? row[ci] : row[columns[ci]];
  }

  function _analyzeColumns(columns, rows) {
    var numericCols = [], catCols = [], dateCols = [], numericData = {};
    columns.forEach(function (col, ci) {
      var vals = rows.map(function (r) { return _getVal(r, columns, ci); }).filter(function (v) { return v !== null && v !== '' && v !== undefined; });
      if (!vals.length) return;
      /* Numeric? */
      var numParsed = vals.map(function (v) { return parseFloat(v); }).filter(function (v) { return !isNaN(v); });
      if (numParsed.length / vals.length >= 0.75) { numericCols.push(col); numericData[col] = numParsed; return; }
      /* Date? */
      var dateParsed = vals.filter(function (v) { return !isNaN(Date.parse(v)); });
      if (dateParsed.length / vals.length >= 0.75) { dateCols.push(col); return; }
      /* Categorical */
      var unique = new Set(vals);
      if (unique.size <= 100) catCols.push(col);
    });
    return { numericCols: numericCols, catCols: catCols, dateCols: dateCols, numericData: numericData };
  }

  function _groupBy(rows, columns, catCol, numCol, aggr) {
    var ci = columns.indexOf(catCol), ni = columns.indexOf(numCol);
    var groups = {}, counts = {};
    rows.forEach(function (r) {
      var k = String(_getVal(r, columns, ci) || ''), v = parseFloat(_getVal(r, columns, ni)) || 0;
      groups[k] = (groups[k] || 0) + v;
      counts[k] = (counts[k] || 0) + 1;
    });
    if (aggr === 'avg') Object.keys(groups).forEach(function (k) { groups[k] = groups[k] / counts[k]; });
    /* Top 15 */
    var sorted = Object.keys(groups).sort(function (a, b) { return groups[b] - groups[a]; }).slice(0, 15);
    var out = {};
    sorted.forEach(function (k) { out[k] = Math.round(groups[k] * 100) / 100; });
    return out;
  }

  function _groupByDate(rows, columns, dateCol, numCol) {
    var di = columns.indexOf(dateCol), ni = columns.indexOf(numCol);
    var groups = {}, counts = {};
    rows.forEach(function (r) {
      var raw = _getVal(r, columns, di) || '';
      var k = raw.toString().substring(0, 10);
      var v = parseFloat(_getVal(r, columns, ni)) || 0;
      groups[k] = (groups[k] || 0) + v; counts[k] = (counts[k] || 0) + 1;
    });
    var sorted = Object.keys(groups).sort();
    var out = {};
    sorted.forEach(function (k) { out[k] = Math.round(groups[k] * 100) / 100; });
    return out;
  }

  function _valueCounts(rows, columns, col) {
    var ci = columns.indexOf(col), counts = {};
    rows.forEach(function (r) { var k = String(_getVal(r, columns, ci) || ''); counts[k] = (counts[k] || 0) + 1; });
    var sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 12);
    var out = {};
    sorted.forEach(function (k) { out[k] = counts[k]; });
    return out;
  }

  function _sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  function _fmtNum(n) {
    if (isNaN(n)) return '—';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function _kpiCard(label, value) {
    return '<div class="ps-kpi-card"><div class="ps-kpi-val">' + value + '</div><div class="ps-kpi-label">' + _esc(label) + '</div></div>';
  }

  function _addChart(grid, type, labels, datasets, dsLabels, title) {
    if (!labels.length) return;
    if (typeof Chart === 'undefined') return;
    var wrap = document.createElement('div'); wrap.className = 'ps-dash-chart-wrap';
    var titleEl = document.createElement('div'); titleEl.className = 'ps-dash-chart-title'; titleEl.textContent = title;
    /* Chart.js requires a position:relative container with a fixed CSS height */
    var canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;height:240px;width:100%';
    var canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);
    wrap.appendChild(titleEl); wrap.appendChild(canvasWrap);
    grid.appendChild(wrap);

    var ds = datasets.map(function (data, i) {
      return {
        label: dsLabels[i] || '',
        data: data,
        backgroundColor: type === 'pie'
          ? _PALETTE.slice(0, data.length)
          : _PALETTE[i % _PALETTE.length] + (type === 'bar' ? 'cc' : ''),
        borderColor: type === 'line' ? _PALETTE[i % _PALETTE.length] : undefined,
        borderWidth: type === 'line' ? 2 : 1,
        fill: type === 'line' ? false : undefined,
        tension: 0.3,
        pointRadius: type === 'line' ? 3 : undefined,
      };
    });

    var chart = new Chart(canvas, {
      type: type,
      data: { labels: labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: type === 'pie', position: 'bottom', labels: { font: { size: 11 } } } },
        scales: type !== 'pie' ? { x: { ticks: { font: { size: 10 }, maxRotation: 35 } }, y: { ticks: { font: { size: 10 } } } } : undefined,
      }
    });
    _dashCharts.push(chart);
  }

  function _addScatter(grid, pts, xLabel, yLabel) {
    if (!pts.length || typeof Chart === 'undefined') return;
    var wrap = document.createElement('div'); wrap.className = 'ps-dash-chart-wrap';
    var titleEl = document.createElement('div'); titleEl.className = 'ps-dash-chart-title'; titleEl.textContent = xLabel + ' vs ' + yLabel;
    var canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;height:240px;width:100%';
    var canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);
    wrap.appendChild(titleEl); wrap.appendChild(canvasWrap);
    grid.appendChild(wrap);
    var chart = new Chart(canvas, {
      type: 'scatter',
      data: { datasets: [{ label: xLabel + ' / ' + yLabel, data: pts, backgroundColor: _PALETTE[0] + '99', pointRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: xLabel, font: { size: 11 } }, ticks: { font: { size: 10 } } },
          y: { title: { display: true, text: yLabel, font: { size: 11 } }, ticks: { font: { size: 10 } } }
        }
      }
    });
    _dashCharts.push(chart);
  }

  /* ═══════════════════════════════════════════════════════
     API Collection management
  ═══════════════════════════════════════════════════════ */
  function _loadApiCollection() {
    fetch(API_BASE + '/ps/api-collection')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        var container = document.getElementById('ps-api-list');
        if (!container) return;
        if (!list || !list.length) {
          container.innerHTML = '<p style="font-size:11px;color:#94a3b8;margin:4px 0">No APIs defined yet.</p>';
          return;
        }
        var t = '<table class="ps-api-table"><thead><tr><th>Name</th><th>Method</th><th>URL</th><th></th></tr></thead><tbody>';
        list.forEach(function (e) {
          t += '<tr><td>' + _esc(e.name) + '</td><td><span class="method-badge">' + _esc(e.method) + '</span></td>' +
            '<td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(e.url) + '">' + _esc(e.url) + '</td>' +
            '<td><button class="btn btn-xs-danger" data-del="' + e.id + '" style="padding:1px 6px;font-size:10px">&#10005;</button></td></tr>';
        });
        t += '</tbody></table>';
        container.innerHTML = t;
        container.querySelectorAll('[data-del]').forEach(function (btn) {
          btn.addEventListener('click', function () { _deleteApi(parseInt(btn.getAttribute('data-del'), 10)); });
        });
      }).catch(function () {});
  }

  function _showApiForm(existing) {
    var wrap = document.getElementById('ps-api-form-wrap');
    if (!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML =
      '<div class="ps-api-form">' +
        '<label>Name</label><input id="ps-f-name" type="text" placeholder="e.g. Create Policy" value="' + (existing ? _esc(existing.name) : '') + '" />' +
        '<label>URL</label><input id="ps-f-url" type="text" placeholder="https://api.example.com/endpoint" value="' + (existing ? _esc(existing.url) : '') + '" />' +
        '<label>Method</label><select id="ps-f-method">' + ['POST','GET','PUT','DELETE','PATCH'].map(function(m){ return '<option' + (existing && existing.method===m?' selected':'') + '>' + m + '</option>'; }).join('') + '</select>' +
        '<label>Description</label><input id="ps-f-desc" type="text" placeholder="What does this API do?" value="' + (existing ? _esc(existing.description || '') : '') + '" />' +
        '<label>Auth Type</label><select id="ps-f-auth">' + ['none','bearer','basic'].map(function(a){ return '<option' + (existing && existing.auth_type===a?' selected':'') + '>' + a + '</option>'; }).join('') + '</select>' +
        '<label>Auth Token</label><input id="ps-f-token" type="password" placeholder="Leave blank to keep existing" />' +
        '<label>Body Template (use {{field}} placeholders)</label><textarea id="ps-f-body" rows="3" style="font-family:monospace">' + (existing ? _esc(existing.body_template || '') : '') + '</textarea>' +
        '<div class="ps-api-form-btns"><button id="btn-ps-api-cancel" class="btn btn-xs-secondary">Cancel</button><button id="btn-ps-api-save" class="btn btn-xs-primary">Save</button></div>' +
      '</div>';
    wrap.querySelector('#btn-ps-api-cancel').addEventListener('click', function () { wrap.style.display='none'; wrap.innerHTML=''; });
    wrap.querySelector('#btn-ps-api-save').addEventListener('click', function () { _saveApi(existing ? existing.id : null); });
  }

  function _saveApi(existingId) {
    var payload = {
      name: document.getElementById('ps-f-name').value.trim(),
      url: document.getElementById('ps-f-url').value.trim(),
      method: document.getElementById('ps-f-method').value,
      description: document.getElementById('ps-f-desc').value.trim(),
      auth_type: document.getElementById('ps-f-auth').value,
      auth_value: document.getElementById('ps-f-token').value || null,
      body_template: document.getElementById('ps-f-body').value || null,
    };
    if (!payload.name || !payload.url) { window.toast && window.toast('warning', 'Name and URL are required.'); return; }
    var method = existingId ? 'PUT' : 'POST';
    var url = API_BASE + '/ps/api-collection' + (existingId ? '/' + existingId : '');
    fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || 'Save failed'); }); return r.json(); })
      .then(function () {
        var wrap = document.getElementById('ps-api-form-wrap');
        if (wrap) { wrap.style.display='none'; wrap.innerHTML=''; }
        _loadApiCollection();
        window.toast && window.toast('success', 'API saved.');
      })
      .catch(function (err) { window.toast && window.toast('error', err.message); });
  }

  function _deleteApi(id) {
    if (!confirm('Delete this API endpoint?')) return;
    fetch(API_BASE + '/ps/api-collection/' + id, { method: 'DELETE' }).then(function () { _loadApiCollection(); }).catch(function () {});
  }

  function _triggerImportCollection() {
    var fi = document.getElementById('ps-import-file');
    if (fi) { fi.value = ''; fi.click(); }
  }

  function _handleImportFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var raw = ev.target.result;
      var col;
      try { col = JSON.parse(raw); } catch (_) { window.toast && window.toast('error', 'Invalid JSON file'); return; }
      _importCollection(col);
    };
    reader.readAsText(file);
  }

  async function _importCollection(col) {
    try {
      var overwrite = confirm(
        'Do you want to REPLACE existing API entries for this connection?\n' +
        'Click OK to overwrite, Cancel to append.'
      );
      var res = await fetch(API_BASE + '/ps/api-collection/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: col,
          conn_id:    _connId || null,
          overwrite:  overwrite,
        }),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        window.toast && window.toast('error', err.detail || 'Import failed');
        return;
      }
      var data = await res.json();
      _loadApiCollection();
      window.toast && window.toast('success', data.imported + ' API(s) imported successfully');
    } catch (ex) {
      window.toast && window.toast('error', 'Import error: ' + ex.message);
    }
  }

  /* ═══════════════════════════════════════════════════════
     Utilities
  ═══════════════════════════════════════════════════════ */
  function _toolLabel(name) {
    var labels = { lookup_schema:'Schema Lookup', generate_sql:'SQL Generated', execute_sql:'SQL Executed', list_api_endpoints:'API List', execute_api:'API Call', preview_email:'Email Preview', generate_report:'Report' };
    return labels[name] || name;
  }
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _escHtml(s) { return _esc(s).replace(/\n/g,'<br>'); }

  /* ═══════════════════════════════════════════════════════
     AI Debug panel
  ═══════════════════════════════════════════════════════ */
  var _debugOpen = false;

  function _toggleDebug() {
    _debugOpen = !_debugOpen;
    var panel = document.getElementById('ps-debug-toolbar');
    if (!panel) return;
    panel.style.display = _debugOpen ? 'flex' : 'none';
    if (_debugOpen) _refreshDebug();
  }

  function _hideDebug() {
    _debugOpen = false;
    var panel = document.getElementById('ps-debug-toolbar');
    if (panel) panel.style.display = 'none';
  }

  async function _refreshDebug() {
    var pre = document.getElementById('ps-debug-prompt');
    if (!pre) return;
    pre.textContent = 'Loading…';
    try {
      var url = API_BASE + '/ps/debug/system-prompt' + (_connId ? '?conn_id=' + _connId : '');
      var res = await fetch(url);
      if (!res.ok) { pre.textContent = 'Error: ' + res.status; return; }
      var data = await res.json();
      pre.textContent = '── Rendered System Prompt (' + (data.length || 0) + ' chars) ──\n\n' + (data.system_prompt || '');
    } catch (e) {
      pre.textContent = 'Error: ' + e.message;
    }
  }

  async function _saveAsWorkflow() {
    if (!_convId) {
      window.toast && window.toast('warning', 'No active session to save as workflow.');
      return;
    }
    // Extract steps from conversation first
    try {
      var res = await fetch(API_BASE + '/ps/workflows/extract-steps?conversation_id=' + _convId);
      if (!res.ok) { window.toast && window.toast('error', 'Could not extract steps.'); return; }
      var data = await res.json();
      if (!data.steps || data.steps.length === 0) {
        window.toast && window.toast('warning', 'No executable actions (SQL / API / Email) found in this session.');
        return;
      }
      // Delegate to WorkflowHandler modal
      if (typeof WorkflowHandler !== 'undefined') {
        WorkflowHandler.showCreateModal(_convId, data.steps);
      }
    } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
  }

  return { init: init };
}());
