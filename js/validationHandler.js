(function (global) {
  'use strict';

  var ValidationHandler = {};
  var API_BASE = 'http://localhost:8000/api';

  var _connId   = null;
  var _inited   = false;
  var _xsdText  = '';   // last generated XSD for download

  // ── Public init ────────────────────────────────────────────────────────────

  ValidationHandler.init = function (connId) {
    _connId = connId || null;
    if (!_inited) {
      _inited = true;
      _wireButtons();
    }
    _loadConnections().then(function () {
      if (_connId) {
        document.getElementById('val-conn-select').value = String(_connId);
        _loadRules();
      }
    });
  };

  // ── Wire buttons ───────────────────────────────────────────────────────────

  function _wireButtons() {
    document.getElementById('val-conn-select')?.addEventListener('change', function () {
      _connId = this.value ? parseInt(this.value) : null;
      _loadRules();
    });
    document.getElementById('btn-val-import')?.addEventListener('click', _importPaths);
    document.getElementById('btn-val-save')?.addEventListener('click', _saveRules);
    document.getElementById('btn-val-add-row')?.addEventListener('click', function () {
      _addRow('', false, 'string', '', '', '', '', '', '');
    });
    document.getElementById('btn-val-gen-xsd')?.addEventListener('click', _generateXsd);
    document.getElementById('btn-val-download-xsd')?.addEventListener('click', _downloadXsd);
    document.getElementById('btn-val-run')?.addEventListener('click', _runValidation);
  }

  // ── Load connections ───────────────────────────────────────────────────────

  async function _loadConnections() {
    try {
      const res  = await fetch(API_BASE + '/connections');
      const list = res.ok ? await res.json() : [];
      const sel = document.getElementById('val-conn-select');
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '<option value="">— select connection —</option>';
      list.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
      });
      if (prev) sel.value = prev;
    } catch (_) {}
  }

  // ── Load saved rules ───────────────────────────────────────────────────────

  async function _loadRules() {
    if (!_connId) { _clearTable(); return; }
    try {
      const res  = await fetch(API_BASE + '/validation/rules?conn_id=' + _connId);
      const rules = res.ok ? await res.json() : [];
      _clearTable();
      if (rules.length === 0) {
        _showEmptyRow('No rules yet. Click Import Paths or Add Row.');
        return;
      }
      rules.forEach(function (r) {
        _addRow(
          r.target_path, r.is_required, r.data_type || 'string',
          r.min_length ?? '', r.max_length ?? '',
          r.pattern || '', r.enumeration || '',
          r.min_value || '', r.max_value || ''
        );
      });
    } catch (_) {
      _showEmptyRow('Backend not reachable.');
    }
  }

  // ── Import paths from target formula rules ─────────────────────────────────

  async function _importPaths() {
    if (!_connId) { alert('Select a connection first.'); return; }
    try {
      const res  = await fetch(API_BASE + '/target-formulas?conn_id=' + _connId);
      if (!res.ok) { alert('No template saved for this connection. Save a template in the Target tab first.'); return; }
      const rules = await res.json();
      if (!rules.length) { alert('No paths found. Save a template in the Target tab first.'); return; }

      // Get existing paths so we don't duplicate
      var existingPaths = _getRowPaths();
      var added = 0;
      rules.forEach(function (r) {
        if (!r.target_path || existingPaths.includes(r.target_path)) return;
        _addRow(r.target_path, false, 'string', '', '', '', '', '', '');
        added++;
      });

      if (added === 0) {
        _showStatus(document.getElementById('val-save-status'), 'ok', 'All paths already imported');
      } else {
        _showStatus(document.getElementById('val-save-status'), 'ok', added + ' paths imported');
      }
      // Remove empty placeholder row
      var emptyRow = document.getElementById('val-empty-row');
      if (emptyRow) emptyRow.remove();
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  }

  // ── Save rules ─────────────────────────────────────────────────────────────

  async function _saveRules() {
    if (!_connId) { alert('Select a connection first.'); return; }
    var rules = _collectRules();
    var statusEl = document.getElementById('val-save-status');
    try {
      var res = await fetch(API_BASE + '/validation/rules', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conn_id: _connId, rules: rules })
      });
      if (res.ok) {
        _showStatus(statusEl, 'ok', '✓ Saved ' + rules.length + ' rules');
        if (typeof toast === 'function') toast('success', 'Validation rules saved');
      } else {
        var err = await res.json().catch(function () { return {}; });
        _showStatus(statusEl, 'err', '✗ ' + (err.detail || 'Save failed'));
      }
    } catch (_) {
      _showStatus(statusEl, 'err', '✗ Backend not reachable');
    }
  }

  // ── Generate XSD ──────────────────────────────────────────────────────────

  async function _generateXsd() {
    if (!_connId) { alert('Select a connection first.'); return; }
    var preview = document.getElementById('val-xsd-preview');
    var dlBtn   = document.getElementById('btn-val-download-xsd');
    preview.textContent = 'Generating…';
    dlBtn.disabled = true;
    try {
      var res  = await fetch(API_BASE + '/validation/xsd?conn_id=' + _connId);
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        preview.textContent = 'Error: ' + (err.detail || 'Generation failed');
        return;
      }
      var data = await res.json();
      _xsdText = data.xsd || '';
      preview.textContent = _xsdText;
      dlBtn.disabled = false;
    } catch (e) {
      preview.textContent = 'Error: ' + e.message;
    }
  }

  function _downloadXsd() {
    if (!_xsdText) return;
    var blob = new Blob([_xsdText], { type: 'application/xml' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'validation_schema_conn' + (_connId || 0) + '.xsd';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Run validation ─────────────────────────────────────────────────────────

  async function _runValidation() {
    if (!_connId) { alert('Select a connection first.'); return; }
    var wrap    = document.getElementById('val-results-wrap');
    var summary = document.getElementById('val-summary');
    wrap.innerHTML = '<div class="val-empty">Running validation…</div>';
    summary.style.display = 'none';
    try {
      var res = await fetch(API_BASE + '/validation/run?conn_id=' + _connId, { method: 'POST' });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        wrap.innerHTML = '<div class="val-empty val-err-text">✗ ' + (err.detail || 'Validation failed') + '</div>';
        return;
      }
      var data = await res.json();
      _renderResults(data, wrap, summary);
    } catch (e) {
      wrap.innerHTML = '<div class="val-empty val-err-text">✗ Backend not reachable</div>';
    }
  }

  function _renderResults(data, wrap, summary) {
    // Summary bar
    summary.textContent = data.passed + ' / ' + data.total + ' passed';
    summary.className   = 'val-summary ' + (data.failed === 0 ? 'all-pass' : 'has-fail');
    summary.style.display = '';

    if (!data.results || data.results.length === 0) {
      wrap.innerHTML = '<div class="val-empty">No records found.</div>';
      return;
    }

    var table = document.createElement('table');
    table.className = 'val-results-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th>Identifier</th>' +
      '<th style="width:70px">Status</th>' +
      '<th>Errors</th>' +
      '</tr></thead>';
    var tbody = document.createElement('tbody');

    data.results.forEach(function (r) {
      var tr   = document.createElement('tr');
      tr.className = r.status === 'pass' ? 'val-row-pass' : 'val-row-fail';
      var icon = r.status === 'pass' ? '✓' : '✗';
      var errHtml = r.comment
        ? r.comment.split(';').map(function (e) {
            return '<div class="val-err-item">' + _esc(e.trim()) + '</div>';
          }).join('')
        : '<span style="color:var(--text-3)">—</span>';
      tr.innerHTML =
        '<td class="val-id-cell">' + _esc(r.identifier_value || '(no id)') + '</td>' +
        '<td class="val-status-cell ' + (r.status === 'pass' ? 'val-pass' : 'val-fail') + '">' + icon + '</td>' +
        '<td class="val-errs-cell">' + errHtml + '</td>';
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.innerHTML = '';
    wrap.appendChild(table);
  }

  // ── Table helpers ──────────────────────────────────────────────────────────

  function _addRow(path, required, dataType, minLen, maxLen, pattern, enumeration, minVal, maxVal) {
    var emptyRow = document.getElementById('val-empty-row');
    if (emptyRow) emptyRow.remove();

    var tbody = document.getElementById('val-rules-tbody');
    var tr    = document.createElement('tr');
    tr.className = 'val-rule-row';

    tr.innerHTML =
      '<td><input type="text"     class="val-input val-path"  value="' + _escAttr(path)        + '" placeholder="/Root/Field" /></td>' +
      '<td style="text-align:center"><input type="checkbox" class="val-check val-req"' + (required ? ' checked' : '') + ' /></td>' +
      '<td><select class="val-sel val-type">' +
        '<option value="string"' + (dataType === 'string'  ? ' selected' : '') + '>string</option>' +
        '<option value="integer"'+ (dataType === 'integer' ? ' selected' : '') + '>integer</option>' +
        '<option value="decimal"'+ (dataType === 'decimal' ? ' selected' : '') + '>decimal</option>' +
        '<option value="date"'   + (dataType === 'date'    ? ' selected' : '') + '>date</option>' +
        '<option value="boolean"'+ (dataType === 'boolean' ? ' selected' : '') + '>boolean</option>' +
      '</select></td>' +
      '<td><input type="number"   class="val-input val-minlen" value="' + _escAttr(minLen)      + '" min="0" /></td>' +
      '<td><input type="number"   class="val-input val-maxlen" value="' + _escAttr(maxLen)      + '" min="0" /></td>' +
      '<td><input type="text"     class="val-input val-pattern" value="' + _escAttr(pattern)    + '" placeholder="regex" /></td>' +
      '<td><input type="text"     class="val-input val-enum"   value="' + _escAttr(enumeration) + '" placeholder="A,B,C" /></td>' +
      '<td><input type="text"     class="val-input val-minval" value="' + _escAttr(minVal)      + '" /></td>' +
      '<td><input type="text"     class="val-input val-maxval" value="' + _escAttr(maxVal)      + '" /></td>' +
      '<td><button class="btn btn-ghost btn-xs-danger val-del-btn" title="Remove row">✕</button></td>';

    tr.querySelector('.val-del-btn').addEventListener('click', function () {
      tr.remove();
      if (!document.querySelector('.val-rule-row')) {
        _showEmptyRow('No rules. Click Import Paths or Add Row.');
      }
    });

    tbody.appendChild(tr);
  }

  function _clearTable() {
    var tbody = document.getElementById('val-rules-tbody');
    if (tbody) tbody.innerHTML = '';
    _showEmptyRow('Select a connection and click Import Paths or Add Row.');
  }

  function _showEmptyRow(msg) {
    var tbody = document.getElementById('val-rules-tbody');
    if (!tbody) return;
    if (!document.getElementById('val-empty-row')) {
      var tr = document.createElement('tr');
      tr.id = 'val-empty-row';
      tr.innerHTML = '<td colspan="10" class="val-empty">' + msg + '</td>';
      tbody.appendChild(tr);
    }
  }

  function _collectRules() {
    var rows = document.querySelectorAll('.val-rule-row');
    var rules = [];
    rows.forEach(function (tr) {
      var path = tr.querySelector('.val-path')?.value.trim();
      if (!path) return;
      rules.push({
        target_path: path,
        is_required: tr.querySelector('.val-req')?.checked || false,
        data_type:   tr.querySelector('.val-type')?.value  || 'string',
        min_length:  _toInt(tr.querySelector('.val-minlen')?.value),
        max_length:  _toInt(tr.querySelector('.val-maxlen')?.value),
        pattern:     tr.querySelector('.val-pattern')?.value.trim() || null,
        enumeration: tr.querySelector('.val-enum')?.value.trim()    || null,
        min_value:   tr.querySelector('.val-minval')?.value.trim()  || null,
        max_value:   tr.querySelector('.val-maxval')?.value.trim()  || null,
      });
    });
    return rules;
  }

  function _getRowPaths() {
    return Array.from(document.querySelectorAll('.val-path')).map(function (el) {
      return el.value.trim();
    });
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  function _toInt(val) {
    var n = parseInt(val);
    return isNaN(n) ? null : n;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function _showStatus(el, type, msg) {
    if (!el) return;
    el.textContent    = msg;
    el.className      = 'val-status ' + type;
    el.style.display  = '';
    setTimeout(function () { el.style.display = 'none'; }, 3000);
  }

  global.ValidationHandler = ValidationHandler;

})(window);
