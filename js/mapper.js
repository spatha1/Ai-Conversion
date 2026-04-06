/* ═══════════════════════════════════════════════════════════
   mapper.js
   Handles auto-mapping logic and the mapping table UI.

   Each mapping row:
     { id, sourceSheet, sourceColumn, formula, targetPath,
       eachSheet, confidence, autoMapped }

   Exposes: window.Mapper
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const API_BASE = 'http://localhost:8000/api';

  /* ── State ────────────────────────────────────────────── */
  let _mappings     = [];
  let _rowIdSeq     = 0;
  let _sourceFields = [];   // [{sheet, column}]
  let _targetPaths  = [];   // XMLHandler.paths items
  let _connId             = null; // currently selected connection ID
  let _isSql              = false; // true when connection source_type is 'sql' or 'snowflake'
  let _savedSql           = '';   // last generated/saved SQL
  let _sqlColumns         = [];   // alias names parsed from _savedSql SELECT list
  let _identifierColumn        = '';   // PK / grouping column
  let _identifierTable         = '';   // table that owns it
  let _identifierUserModified  = false; // true once user manually edits the identifier input

  /* ── Public API ───────────────────────────────────────── */
  const Mapper = {

    /* Load source + target data */
    init(sourceFields, targetPaths) {
      _sourceFields = sourceFields;
      _targetPaths  = targetPaths;
    },

    /* Set active connection (called when mapping-conn-select changes) */
    setConnection(connId) {
      _connId = connId ? parseInt(connId, 10) : null;
      _identifierUserModified = false; // reset on connection change so AI detection works fresh
      _sqlColumns = [];
    },

    /* Set whether current connection is SQL-based (no sheet/column selects needed) */
    setConnectionType(sourceType) {
      _isSql = sourceType === 'sql' || sourceType === 'snowflake';
    },

    getConnection() { return _connId; },
    isSqlConnection() { return _isSql; },
    hasMappingData() { return _mappings.length > 0 || !!_savedSql; },

    /* Auto-map: match target paths to best source field (Jaccard) */
    autoMap() {
      _mappings = [];

      // Build a Set of SQL aliases for O(1) lookup (SQL mode)
      const sqlAliasSet = new Set(_sqlColumns);

      for (const tp of _targetPaths) {
        const nodeName = _leafName(tp.path);
        let sourceColumn = '', formula = '', confidence = 0, autoMapped = false;

        if (_isSql && sqlAliasSet.size > 0) {
          // SQL mode: alias IS the target path — direct match first
          if (sqlAliasSet.has(tp.path)) {
            sourceColumn = tp.path;
            formula      = `{${tp.path}}`;
            confidence   = 100;
            autoMapped   = true;
          } else {
            // Fallback: Jaccard on leaf name vs alias leaf names
            const { field: aliasField, score } = _bestMatch(nodeName,
              _sqlColumns.map(a => ({ sheet: '', column: a })));
            if (aliasField) {
              sourceColumn = aliasField.column;
              formula      = `{${aliasField.column}}`;
              confidence   = score;
              autoMapped   = true;
            } else if (tp.hasPlaceholder) {
              formula = tp.placeholder;
            }
          }
        } else {
          // Excel / file mode: Jaccard on actual column names
          const { field, score } = _bestMatch(nodeName, _sourceFields);
          if (field) {
            sourceColumn = field.column;
            formula      = tp.hasPlaceholder ? tp.placeholder : `{${field.column}}`;
            confidence   = score;
            autoMapped   = true;
          } else if (tp.hasPlaceholder) {
            formula = tp.placeholder;
          }
        }

        _mappings.push({
          id: ++_rowIdSeq,
          sourceSheet:  '',
          sourceColumn,
          formula,
          targetPath:   tp.path,
          eachSheet:    tp.eachSheet || '',
          confidence,
          autoMapped,
        });
      }
      _renderTable();
      _updateBadge();
      return _mappings;
    },

    /* Generate SQL query only — does NOT touch mapping rows */
    async generateQueryOnly() {
      if (!_connId) {
        if (typeof toast === 'function') toast('warning', 'Select a connection first.');
        return;
      }
      const btn      = document.getElementById('btn-gen-query');
      const statusEl = document.getElementById('mapping-ai-status');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Building…'; }
      if (statusEl) statusEl.style.display = 'none';

      try {
        const res = await fetch(`${API_BASE}/mapping/generate/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body:   JSON.stringify({ conn_id: _connId }),
        });
        let data;
        try { data = await res.json(); } catch (_) { data = { detail: res.statusText }; }
        if (!res.ok) {
          const msg = data.detail || res.statusText;
          _setStatus(statusEl, 'error', '✗ ' + msg);
          if (typeof toast === 'function') toast('error', msg);
          return;
        }
        _savedSql         = data.query_sql        || '';
        _identifierColumn = data.identifier_column || '';
        _identifierTable  = data.identifier_table  || '';
        _showSqlPanel(_savedSql);
        _updateIdentifierUI(_identifierColumn, _identifierTable, true);
        _setStatus(statusEl, 'success', '✓ Query generated — edit if needed, then click Generate Mapping');
        if (typeof toast === 'function') toast('success', 'SQL query generated. Edit if needed, then Generate Mapping.');
      } catch (_) {
        _setStatus(statusEl, 'error', '✗ Backend unreachable');
        if (typeof toast === 'function') toast('error', 'Could not reach backend.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg> Generate Query';
        }
      }
    },

    /* Generate mapping rows only — does NOT regenerate or overwrite SQL */
    async aiGenerateMapping() {
      if (!_connId) {
        if (typeof toast === 'function') toast('warning', 'Select a connection first.');
        return;
      }
      const btn      = document.getElementById('btn-ai-map');
      const statusEl = document.getElementById('mapping-ai-status');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mapping…'; }
      if (statusEl) statusEl.style.display = 'none';

      try {
        const res = await fetch(`${API_BASE}/mapping/generate/rows`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body:   JSON.stringify({ conn_id: _connId }),
        });
        let data;
        try { data = await res.json(); } catch (_) { data = { detail: res.statusText }; }
        if (!res.ok) {
          const msg = data.detail || res.statusText;
          _setStatus(statusEl, 'error', '✗ ' + msg);
          if (typeof toast === 'function') toast('error', msg);
          return;
        }
        _mappings = (data.rows || []).map(r => ({
          id:           ++_rowIdSeq,
          sourceSheet:  r.source_sheet  || '',
          sourceColumn: r.source_column || '',
          formula:      r.formula       || '',
          targetPath:   r.target_path   || '',
          eachSheet:    r.each_sheet    || '',
          confidence:   r.confidence    || 0,
          // autoMapped=true if AI gave us a confidence, OR if source_column is set
          // (DB rows saved before confidence was stored should not show "manual")
          autoMapped:   r.confidence > 0 || !!(r.source_column),
        }));
        _identifierColumn = data.identifier_column || _identifierColumn;
        _identifierTable  = data.identifier_table  || _identifierTable;
        _renderTable();
        _updateBadge();
        _updateIdentifierUI(_identifierColumn, _identifierTable, true);
        _setStatus(statusEl, 'success', `✓ ${_mappings.length} paths mapped · #${data.mapping_id}`);
        if (typeof toast === 'function') toast('success', `Mapping generated: ${_mappings.length} paths`);
      } catch (_) {
        _setStatus(statusEl, 'error', '✗ Backend unreachable');
        if (typeof toast === 'function') toast('error', 'Could not reach backend.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg> Generate Mapping';
        }
      }
    },

    /* Save current mapping rows to DB */
    async saveMapping() {
      if (!_connId) {
        if (typeof toast === 'function') toast('warning', 'Select a connection first.');
        return;
      }
      if (_mappings.length === 0) {
        if (typeof toast === 'function') toast('warning', 'No mappings to save.');
        return;
      }

      const btn = document.getElementById('btn-save-mapping');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…'; }

      // Read identifier directly from input field so manual edits are captured
      const identInp = document.getElementById('mapping-identifier-input');
      if (identInp && identInp.value.trim()) {
        _identifierColumn = identInp.value.trim();
        const row = _mappings.find(m => m.sourceColumn === _identifierColumn && m.targetPath !== '__identifier__');
        _identifierTable = row ? row.sourceSheet : (_identifierTable || '');
      }

      // Also sync the SQL textarea in case user edited it
      const ta = document.getElementById('mapping-sql-text');
      if (ta && ta.value.trim()) _savedSql = ta.value.trim();

      const rows = _mappings.map(m => ({
        source_sheet:  m.sourceSheet,
        source_column: m.sourceColumn,
        formula:       m.formula,
        target_path:   m.targetPath,
        each_sheet:    m.eachSheet,
        confidence:    m.confidence,
      }));

      try {
        const res  = await fetch(`${API_BASE}/mapping/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            conn_id:          _connId,
            rows,
            query_sql:        _savedSql,
            identifier_column: _identifierColumn || null,
            identifier_table:  _identifierTable  || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (typeof toast === 'function') toast('error', data.detail || 'Save failed');
        } else {
          if (typeof toast === 'function')
            toast('success', `Mapping saved — ${data.rows_saved} row(s) · v${data.mapping_id}`);
        }
      } catch (err) {
        if (typeof toast === 'function') toast('error', 'Backend unreachable.');
      } finally {
        if (btn) {
          btn.disabled  = false;
          btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M17 16v1a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h9l4 4v9zM13 3v4h2.586L13 4.414V3zM5 9h10v1H5V9zm0 3h10v1H5v-1zm0 3h6v1H5v-1z"/></svg> Save';
        }
      }
    },

    /* Load latest mapping from DB for a connection */
    async loadMapping(connId) {
      if (!connId) return;
      try {
        const [mRes, qRes] = await Promise.all([
          fetch(`${API_BASE}/mapping/${connId}`),
          fetch(`${API_BASE}/mapping/${connId}/query`),
        ]);
        if (mRes.ok) {
          const mData = await mRes.json();
          // New format: { rows, identifier_column, identifier_table }
          const rows = Array.isArray(mData) ? mData : (mData.rows || []);
          if (rows.length > 0) {
            _mappings = rows.map(r => ({
              id:           ++_rowIdSeq,
              sourceSheet:  r.source_sheet  || '',
              sourceColumn: r.source_column || '',
              formula:      r.formula       || '',
              targetPath:   r.target_path   || '',
              eachSheet:    r.each_sheet    || '',
              confidence:   r.confidence    || 0,
              autoMapped:   r.confidence > 0 || !!(r.source_column),
            }));
            _renderTable();
            _updateBadge();
          }
          if (!Array.isArray(mData) && mData.identifier_column) {
            _identifierColumn = mData.identifier_column || '';
            _identifierTable  = mData.identifier_table  || '';
            _updateIdentifierUI(_identifierColumn, _identifierTable, false);
          }
        }
        if (qRes.ok) {
          const qData = await qRes.json();
          _savedSql = qData.query_sql || '';
          if (_savedSql) _showSqlPanel(_savedSql);
          if (qData.identifier_column && !_identifierColumn) {
            _identifierColumn = qData.identifier_column;
            _identifierTable  = qData.identifier_table || '';
            _updateIdentifierUI(_identifierColumn, _identifierTable, false);
          }
        }
      } catch (_) { /* backend offline */ }
    },

    /* Add a blank row */
    addRow() {
      // Flush any in-flight formula edits from DOM before re-rendering
      const tbody = document.getElementById('mapping-tbody');
      if (tbody) {
        tbody.querySelectorAll('.formula-input').forEach(inp => {
          const id = +inp.dataset.id;
          const m  = _mappings.find(x => x.id === id);
          if (m) m.formula = inp.value;
        });
        tbody.querySelectorAll('.src-col-sql-sel').forEach(sel => {
          const id = +sel.dataset.id;
          const m  = _mappings.find(x => x.id === id);
          if (m && sel.value) m.sourceColumn = sel.value;
        });
      }
      _mappings.push({
        id:           ++_rowIdSeq,
        sourceSheet:  '',
        sourceColumn: '',
        formula:      '',
        targetPath:   _targetPaths[0] ? _targetPaths[0].path : '',
        eachSheet:    '',
        confidence:   0,
        autoMapped:   false,
      });
      _renderTable();
      _updateBadge();
      // Focus the new last row's first editable cell
      const tbodyAfter = document.getElementById('mapping-tbody');
      if (tbodyAfter) {
        const lastRow = tbodyAfter.lastElementChild;
        if (lastRow) {
          const inp = lastRow.querySelector('.src-col-input, .src-col-sel, .src-col-sql-sel, .formula-input');
          if (inp) inp.focus();
        }
      }
    },

    clearAll() {
      _mappings = [];
      _savedSql = '';
      _renderTable();
      _updateBadge();
      _hideSqlPanel();
    },

    getMappings() { return _mappings.slice(); },

    /* Save / load as JSON (local) */
    exportJSON() {
      return JSON.stringify({ mappings: _mappings, version: 1 }, null, 2);
    },

    importJSON(json) {
      const data = JSON.parse(json);
      _mappings = data.mappings || [];
      _rowIdSeq = _mappings.reduce((mx, m) => Math.max(mx, m.id), 0);
      _renderTable();
      _updateBadge();
    },
  };

  /* ── SQL panel helpers ────────────────────────────────── */
  function _showSqlPanel(sql) {
    const panel = document.getElementById('mapping-sql-panel');
    const ta    = document.getElementById('mapping-sql-text');
    if (!panel || !ta) return;
    ta.value = sql;
    panel.style.display = '';
    _sqlColumns = _parseSqlColumns(sql);
    // Sync edits back to _savedSql and reparse columns (idempotent listener)
    if (!ta._sqlListenerAttached) {
      ta._sqlListenerAttached = true;
      ta.addEventListener('input', () => {
        _savedSql   = ta.value;
        _sqlColumns = _parseSqlColumns(ta.value);
      });
    }
  }

  function _hideSqlPanel() {
    const panel = document.getElementById('mapping-sql-panel');
    if (panel) panel.style.display = 'none';
  }

  function _setStatus(el, type, msg) {
    if (!el) return;
    el.className   = `conn-status ${type === 'error' ? 'error' : 'success'}`;
    el.textContent = msg;
    el.style.display = 'inline-flex';
  }

  /* ── Auto-match Algorithm ─────────────────────────────── */

  function _leafName(path) {
    return path.split('/').pop().replace(/^@/, '').toLowerCase();
  }

  function _norm(s) {
    return s.toLowerCase().replace(/[_\-\s\.]+/g, '');
  }

  function _bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  function _jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    const ba = _bigrams(_norm(a));
    const bb = _bigrams(_norm(b));
    let intersection = 0;
    for (const bi of ba) { if (bb.has(bi)) intersection++; }
    const union = ba.size + bb.size - intersection;
    return union ? intersection / union : 0;
  }

  function _score(target, source) {
    const nt = _norm(target), ns = _norm(source);
    if (nt === ns) return 1.0;
    if (nt.includes(ns) || ns.includes(nt)) return 0.85;
    return _jaccard(target, source);
  }

  function _bestMatch(nodeName, sourceFields) {
    let best = null, bestScore = 0.4;
    for (const f of sourceFields) {
      const s = _score(nodeName, f.column);
      if (s > bestScore) { bestScore = s; best = f; }
    }
    return { field: best, score: Math.round(bestScore * 100) };
  }

  /* ── Parse SELECT alias names from SQL string ─────────── */
  function _parseSqlColumns(sql) {
    if (!sql) return [];
    const cols = [], seen = new Set();
    // Match AS [alias], AS "alias", or AS alias_word
    const re = /\bAS\s+(?:\[([^\]]*)\]|"([^"]*)"|([\w\$#]+))/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const alias = (m[1] || m[2] || m[3] || '').trim();
      if (alias && !seen.has(alias)) { seen.add(alias); cols.push(alias); }
    }
    return cols;
  }

  /* ── Table Rendering ──────────────────────────────────── */
  function _renderTable() {
    const tbody = document.getElementById('mapping-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Update column header based on connection type
    const srcHeader = document.querySelector('#mapping-table thead th.col-src');
    if (srcHeader) {
      srcHeader.textContent = (_isSql || (_sourceFields.length === 0 && _mappings.some(m => m.sourceSheet)))
        ? 'Source Table · Column'
        : 'Source Sheet · Column';
    }

    if (_mappings.length === 0) {
      const tr = tbody.insertRow();
      const td = tr.insertCell();
      td.colSpan = 6;
      td.innerHTML = '<div class="empty-state"><p>Select a connection → click <strong>AI Generate Mapping</strong> to auto-map XML paths to source columns.</p></div>';
      return;
    }

    // Scroll mapping table into view (page-level scroll)
    setTimeout(() => {
      document.querySelector('.mapping-table-wrapper')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);

    _mappings.forEach(m => {
      const tr = tbody.insertRow();
      tr.dataset.id = m.id;

      // Source column
      const tdSrc = tr.insertCell();
      tdSrc.className = 'col-src';
      if (_isSql || (_sourceFields.length === 0 && (m.sourceSheet || !_sourceFields.length))) {
        if (_sqlColumns.length > 0) {
          // Show dropdown of alias names parsed from the SQL query
          // Ensure current value is in the list (may be an old-style column not yet aliased)
          const aliasMatch = _sqlColumns.includes(m.sourceColumn);
          const extraOpts = m.sourceColumn && !aliasMatch
            ? `<option value="${_esc(m.sourceColumn)}" selected>${_esc(m.sourceColumn)}</option>`
            : '';
          const opts = _sqlColumns.map(c =>
            `<option value="${_esc(c)}"${c === m.sourceColumn ? ' selected' : ''}>${_esc(c)}</option>`
          ).join('');
          tdSrc.innerHTML = `<select class="mapping-select src-col-sql-sel" data-id="${m.id}">
            <option value=""${!m.sourceColumn ? ' selected' : ''}>-- select column --</option>
            ${extraOpts}${opts}
          </select>`;
        } else if (m.sourceColumn) {
          // No SQL parsed yet — show editable input so user can correct it
          const val = m.sourceSheet ? `${m.sourceSheet}.${m.sourceColumn}` : m.sourceColumn;
          tdSrc.innerHTML = `<input class="mapping-input src-col-input" data-id="${m.id}"
            value="${_esc(val)}" placeholder="TABLE.column or alias"
            title="No SQL loaded — type column alias or TABLE.column"
            style="font-family:var(--mono);font-size:12px;border-color:#f59e0b" />`;
        } else {
          // New/empty row — free-text input
          tdSrc.innerHTML = `<input class="mapping-input src-col-input" data-id="${m.id}"
            value="" placeholder="column or alias" style="font-family:var(--mono);font-size:12px" />`;
        }
      } else {
        tdSrc.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:3px">
            <select class="mapping-select src-sheet-sel" data-id="${m.id}">
              ${_sheetOptions(m.sourceSheet)}
            </select>
            <select class="mapping-select src-col-sel" data-id="${m.id}">
              ${_colOptions(m.sourceSheet, m.sourceColumn)}
            </select>
          </div>`;
      }

      // Formula
      const tdFml = tr.insertCell();
      tdFml.className = 'col-formula';
      tdFml.innerHTML = `<input class="mapping-input formula-input" data-id="${m.id}"
          value="${_esc(m.formula)}" placeholder="{ColumnName} or formula…" />`;

      // Arrow
      const tdArrow = tr.insertCell();
      tdArrow.className = 'col-arrow';
      tdArrow.innerHTML = '→';

      // Target path
      const tdTgt = tr.insertCell();
      tdTgt.className = 'col-tgt';
      if (_targetPaths.length > 0) {
        tdTgt.innerHTML = `<select class="mapping-select tgt-path-sel" data-id="${m.id}">
          ${_pathOptions(m.targetPath)}
        </select>`;
      } else {
        // No XML loaded — show as plain text (AI-generated rows have exact paths)
        tdTgt.innerHTML = `<span class="mapping-path-text" title="${_esc(m.targetPath)}">${_esc(m.targetPath)}</span>`;
      }

      // Confidence badge
      const tdConf = tr.insertCell();
      tdConf.className = 'col-conf';
      if (m.sourceColumn && m.confidence > 0) {
        const cls = m.confidence >= 80 ? 'conf-high' : m.confidence >= 55 ? 'conf-medium' : 'conf-low';
        tdConf.innerHTML = `<span class="conf-badge ${cls}">${m.confidence}%</span>`;
      } else if (m.sourceColumn && m.autoMapped) {
        // auto-mapped but confidence not stored (legacy DB rows) — show neutral "auto" badge
        tdConf.innerHTML = `<span class="conf-badge conf-medium" title="Auto-mapped">auto</span>`;
      } else if (m.sourceColumn && !m.autoMapped) {
        tdConf.innerHTML = `<span class="conf-badge conf-manual">manual</span>`;
      } else if (!m.sourceColumn && m.formula) {
        tdConf.innerHTML = `<span class="conf-badge conf-manual">default</span>`;
      } else if (!m.sourceColumn && m.targetPath && m.targetPath !== '__identifier__') {
        tdConf.innerHTML = `<span class="conf-badge conf-low" title="No match found — type source column">?</span>`;
      }

      // Delete
      const tdAct = tr.insertCell();
      tdAct.className = 'col-act';
      tdAct.innerHTML = `<button class="btn-del-row" data-id="${m.id}" title="Remove row">×</button>`;
    });

    _attachTableListeners(tbody);
  }

  /* ── Select option helpers ────────────────────────────── */
  function _sheetOptions(selected) {
    const sheets = [...new Set(_sourceFields.map(f => f.sheet))];
    return ['', ...sheets].map(s =>
      `<option value="${_esc(s)}" ${s === selected ? 'selected' : ''}>${s || '— sheet —'}</option>`
    ).join('');
  }

  function _colOptions(sheet, selected) {
    const cols = _sourceFields.filter(f => f.sheet === sheet).map(f => f.column);
    return ['', ...cols].map(c =>
      `<option value="${_esc(c)}" ${c === selected ? 'selected' : ''}>${c || '— column —'}</option>`
    ).join('');
  }

  function _pathOptions(selected) {
    // Show all target paths; if selected value not in list, add it at top
    const inList = _targetPaths.some(p => p.path === selected);
    const extra  = selected && !inList
      ? `<option value="${_esc(selected)}" selected>${_esc(selected)}</option>` : '';
    return extra + _targetPaths.map(p =>
      `<option value="${_esc(p.path)}" ${p.path === selected ? 'selected' : ''}>${p.path}</option>`
    ).join('');
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /* ── Table Event Listeners ────────────────────────────── */
  function _attachTableListeners(tbody) {
    // SQL mode: editable source column input (TABLE.COLUMN)
    tbody.querySelectorAll('.src-col-input').forEach(inp => {
      inp.addEventListener('change', e => {
        const id  = +e.target.dataset.id;
        const m   = _mappings.find(x => x.id === id);
        if (!m) return;
        const raw = e.target.value.trim();
        const dot = raw.lastIndexOf('.');
        if (dot !== -1) {
          m.sourceSheet  = raw.slice(0, dot);
          m.sourceColumn = raw.slice(dot + 1);
        } else {
          m.sourceSheet  = '';
          m.sourceColumn = raw;
        }
        m.autoMapped = false;
        if (m.sourceColumn && !m.formula) {
          m.formula = `{${m.sourceColumn}}`;
          const fi = e.target.closest('tr')?.querySelector('.formula-input');
          if (fi) fi.value = m.formula;
        }
      });
    });

    tbody.querySelectorAll('.src-sheet-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        const id = +e.target.dataset.id;
        const m  = _mappings.find(x => x.id === id);
        if (!m) return;
        m.sourceSheet  = e.target.value;
        m.sourceColumn = '';
        m.autoMapped   = false;
        const colSel = e.target.closest('tr').querySelector('.src-col-sel');
        if (colSel) colSel.innerHTML = _colOptions(m.sourceSheet, '');
      });
    });

    tbody.querySelectorAll('.src-col-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        const id = +e.target.dataset.id;
        const m  = _mappings.find(x => x.id === id);
        if (!m) return;
        m.sourceColumn = e.target.value;
        m.autoMapped   = false;
        if (m.sourceColumn && !m.formula) {
          m.formula = `{${m.sourceColumn}}`;
          const fi = e.target.closest('tr').querySelector('.formula-input');
          if (fi) fi.value = m.formula;
        }
      });
    });

    // SQL mode: dropdown of alias names from the generated query
    tbody.querySelectorAll('.src-col-sql-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        const id = +e.target.dataset.id;
        const m  = _mappings.find(x => x.id === id);
        if (!m) return;
        m.sourceColumn = e.target.value;
        m.sourceSheet  = '';   // alias names have no sheet prefix
        m.autoMapped   = false;
        // Auto-fill formula with the alias placeholder
        m.formula = m.sourceColumn ? `{${m.sourceColumn}}` : '';
        const fi = e.target.closest('tr')?.querySelector('.formula-input');
        if (fi) fi.value = m.formula;
      });
    });

    tbody.querySelectorAll('.formula-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const id = +e.target.dataset.id;
        const m  = _mappings.find(x => x.id === id);
        if (m) m.formula = e.target.value;
      });
    });

    tbody.querySelectorAll('.tgt-path-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        const id = +e.target.dataset.id;
        const m  = _mappings.find(x => x.id === id);
        if (!m) return;
        m.targetPath = e.target.value;
        const tp = _targetPaths.find(p => p.path === m.targetPath);
        if (tp) m.eachSheet = tp.eachSheet || '';
      });
    });

    tbody.querySelectorAll('.btn-del-row').forEach(btn => {
      btn.addEventListener('click', e => {
        const id = +e.target.dataset.id;
        _mappings = _mappings.filter(m => m.id !== id);
        _renderTable();
        _updateBadge();
      });
    });
  }

  /* ── Identifier UI ───────────────────────────────────── */
  function _updateIdentifierUI(identifierColumn, identifierTable, aiDetected) {
    const inp   = document.getElementById('mapping-identifier-input');
    const dl    = document.getElementById('mapping-identifier-list');
    const badge = document.getElementById('mapping-identifier-badge');
    const btext = document.getElementById('mapping-identifier-badge-text');
    if (!inp) return;

    // Build unique column suggestions from current mappings (skip __identifier__ marker row)
    const cols = [];
    const seen = new Set();
    _mappings.forEach(m => {
      if (m.sourceColumn && m.targetPath !== '__identifier__' && !seen.has(m.sourceColumn)) {
        seen.add(m.sourceColumn);
        cols.push({ sheet: m.sourceSheet, column: m.sourceColumn });
      }
    });

    if (dl) {
      dl.innerHTML = cols.map(c =>
        `<option value="${_esc(c.column)}">${_esc(c.column)}${c.sheet ? ' (' + _esc(c.sheet) + ')' : ''}</option>`
      ).join('');
    }

    // Update internal state — but never overwrite a value the user manually set
    if (identifierColumn && !_identifierUserModified) {
      _identifierColumn = identifierColumn;
      _identifierTable  = identifierTable || '';
      inp.value = identifierColumn;
    }

    // Show/hide AI-detected badge
    if (badge) {
      if (aiDetected && identifierColumn) {
        if (btext) btext.textContent = `AI detected: ${identifierColumn}`;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Wire input event (idempotent)
    if (!inp._identListenerAttached) {
      inp._identListenerAttached = true;
      inp.addEventListener('input', e => {
        _identifierUserModified = true;
        _identifierColumn = e.target.value.trim();
        // Try to find the matching table from mapped rows
        const row = _mappings.find(m => m.sourceColumn === _identifierColumn && m.targetPath !== '__identifier__');
        _identifierTable  = row ? row.sourceSheet : '';
        if (badge) badge.style.display = 'none';
      });
    }
  }

  /* ── Badge ────────────────────────────────────────────── */
  function _updateBadge() {
    const badge = document.getElementById('mapping-count-badge');
    if (!badge) return;
    const n = _mappings.length;
    badge.textContent  = n;
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
  }

  global.Mapper = Mapper;
})(window);
