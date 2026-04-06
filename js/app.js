/* ═══════════════════════════════════════════════════════════
   app.js  –  Main controller for Data Conversion Studio
   Coordinates ExcelHandler, XMLHandler, Mapper, XMLGenerator
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── State ────────────────────────────────────────────── */
  const API_BASE     = 'http://localhost:8000/api';
  let _sourceLoaded  = false;
  let _targetLoaded  = false;
  let _generatedXML  = '';

  /* ══════════════════════════════════════════════════════
     Section Navigation (Conversion / PS / Admin)
     ══════════════════════════════════════════════════════ */
  function _initSections() {
    document.querySelectorAll('.sec-btn[data-section]').forEach(btn => {
      btn.addEventListener('click', () => _switchSection(btn.dataset.section));
    });
    // PS sub-tabs (Chat / Workflows)
    document.querySelectorAll('.ps-sec-tab[data-ps-tab]').forEach(btn => {
      btn.addEventListener('click', () => _switchPsTab(btn.dataset.psTab));
    });
    // Restore last section
    const saved = localStorage.getItem('activeSection') || 'conversion';
    _switchSection(saved, true);
  }

  function _switchSection(sectionId, silent) {
    document.querySelectorAll('.section-container').forEach(s => {
      s.style.display = s.id === 'section-' + sectionId ? '' : 'none';
    });
    document.querySelectorAll('.sec-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.section === sectionId);
    });
    document.body.dataset.section = sectionId;
    if (!silent) localStorage.setItem('activeSection', sectionId);
    // When switching to PS, trigger WorkflowHandler refresh if on workflows tab
    if (sectionId === 'ps') {
      const wfTab = document.querySelector('.ps-sec-tab.active');
      if (wfTab && wfTab.dataset.psTab === 'workflows' && typeof WorkflowHandler !== 'undefined') {
        WorkflowHandler.refresh && WorkflowHandler.refresh();
      }
    }
  }
  // Expose globally so psHandler can switch to PS section
  window._switchSection = _switchSection;

  function _switchPsTab(tabId) {
    document.querySelectorAll('.ps-page-tab').forEach(p => {
      p.style.display = p.id === 'ps-page-' + tabId ? '' : 'none';
    });
    document.querySelectorAll('.ps-sec-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.psTab === tabId);
    });
    if (tabId === 'workflows' && typeof WorkflowHandler !== 'undefined') {
      WorkflowHandler.refresh && WorkflowHandler.refresh();
    }
  }
  window._switchPsTab = _switchPsTab;

  function _initTabs() {
    document.querySelectorAll('.step[data-tab]').forEach(step => {
      step.addEventListener('click', () => _switchTab(step.dataset.tab));
    });
  }

  function _switchTab(tabId) {
    // Only affect panels within the conversion section
    document.querySelectorAll('#section-conversion .tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + tabId);
    });
    document.querySelectorAll('.step[data-tab]').forEach(s => {
      s.classList.toggle('active', s.dataset.tab === tabId);
    });
  }

  /* ══════════════════════════════════════════════════════
     Source – Excel Upload
     ══════════════════════════════════════════════════════ */
  function _initSourceUpload() {
    const dropZone = document.getElementById('excel-drop-zone');
    const fileInput = document.getElementById('excel-file-input');
    if (!dropZone || !fileInput) return;

    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) _handleExcelFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault(); dropZone.classList.add('dragging');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) _handleExcelFile(file);
    });
  }

  async function _handleExcelFile(file) {
    try {
      toast('info', `Parsing "${file.name}"…`);
      const sheets = await ExcelHandler.parseFile(file);

      // Show viewer
      const dropZoneEl = document.getElementById('excel-drop-zone');
      if (dropZoneEl) dropZoneEl.style.display = 'none';
      const viewer = document.getElementById('excel-viewer');
      viewer.style.display = 'block';

      ExcelHandler.renderViewer(sheets, 'data-grid-container', 'sheet-tabs');
      _sourceLoaded = true;

      // If target already loaded, refresh Mapper source list
      if (_targetLoaded) Mapper.init(ExcelHandler.getSourceFields(), XMLHandler.getPaths());

      toast('success', `Loaded ${sheets.length} sheet(s) from "${file.name}"`);
    } catch (err) {
      toast('error', 'Excel error: ' + err.message);
    }
  }

  /* ══════════════════════════════════════════════════════
     Target – XML Upload
     ══════════════════════════════════════════════════════ */
  function _initTargetUpload() {
    const dropZone = document.getElementById('xml-drop-zone');
    const fileInput = document.getElementById('xml-file-input');

    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) _handleXMLFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault(); dropZone.classList.add('dragging');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) _handleXMLFile(file);
    });

    // Sample XML button
    document.getElementById('btn-load-sample-xml').addEventListener('click', () => {
      try {
        XMLHandler.parseString(XMLHandler.SAMPLE_TEMPLATE);
        _showXMLViewer('sample-template.xml');
        toast('success', 'Sample XML template loaded.');
      } catch (err) {
        toast('error', 'Sample XML error: ' + err.message);
      }
    });

    // Re-upload button — resets back to upload area
    document.getElementById('btn-reupload-xml').addEventListener('click', () => {
      document.getElementById('xml-upload-area').style.display = 'flex';
      document.getElementById('xml-file-bar').style.display = 'none';
      document.getElementById('xml-viewer').style.display = 'none';
      // Collapse all sections and reset toggles
      document.querySelectorAll('.collapsible-body').forEach(b => b.classList.add('collapsed'));
      document.querySelectorAll('.collapsible-toggle').forEach(t => t.textContent = '▶');
      // Reset process status
      const s = document.getElementById('process-formula-status');
      if (s) s.style.display = 'none';
      _targetLoaded = false;
    });
  }

  async function _handleXMLFile(file) {
    try {
      toast('info', `Parsing "${file.name}"…`);
      await XMLHandler.parseFile(file);
      _showXMLViewer(file.name);
      toast('success', `XML template "${file.name}" loaded — ${XMLHandler.getPaths().length} paths found.`);
    } catch (err) {
      toast('error', 'XML error: ' + err.message);
    }
  }

  function _showXMLViewer(fileName) {
    document.getElementById('xml-upload-area').style.display = 'none';
    document.getElementById('xml-file-bar').style.display = 'flex';
    document.getElementById('xml-viewer').style.display = 'block';

    // Update file bar
    if (fileName) document.getElementById('xml-file-name').textContent = fileName;
    const paths = XMLHandler.getPaths();
    document.getElementById('xml-file-stats').textContent = paths.length + ' paths';

    // Render tree (collapsed by default — sections handle visibility)
    XMLHandler.renderTree('xml-tree', 'xml-paths-list');

    // Reset formula rules hint
    const hint = document.getElementById('formula-rules-hint');
    if (hint) hint.style.display = 'inline';

    _targetLoaded = true;
    if (_sourceLoaded) Mapper.init(ExcelHandler.getSourceFields(), XMLHandler.getPaths());
  }

  /* ══════════════════════════════════════════════════════
     Target – Process Formula Rules (sends XML to backend)
     ══════════════════════════════════════════════════════ */
  function _initTargetProcess() {
    const btn       = document.getElementById('btn-process-formulas');
    const statusEl  = document.getElementById('process-formula-status');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      if (!_targetLoaded) {
        toast('warning', 'Load a Target XML template first.');
        return;
      }

      const xmlContent = XMLHandler.getTemplateRaw();
      if (!xmlContent) {
        toast('warning', 'No XML content available.');
        return;
      }

      const connId = document.getElementById('target-conn-select')?.value || null;
      if (!connId) {
        toast('warning', 'Select a source connection first — the template must be linked to a connection.');
        statusEl.textContent = '⚠ Select a source connection above before saving.';
        statusEl.className = 'conn-status error';
        statusEl.style.display = 'inline-flex';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving…';
      statusEl.style.display = 'none';

      try {
        const fileName = document.getElementById('xml-file-name')?.textContent || 'template.xml';
        const res = await fetch(`${API_BASE}/target-formulas/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            xml_content: xmlContent,
            conn_id: connId ? parseInt(connId, 10) : null,
            name: fileName,
          })
        });

        const data = await res.json();

        if (!res.ok) {
          const msg = data.detail || res.statusText;
          statusEl.textContent = 'Error: ' + msg;
          statusEl.className = 'conn-status error';
          statusEl.style.display = 'inline-flex';
          toast('error', 'Process failed: ' + msg);
        } else {
          statusEl.textContent = `✓ Template saved · ${data.inserted} formula rule(s) extracted`;
          statusEl.className = 'conn-status success';
          statusEl.style.display = 'inline-flex';
          toast('success', `Template saved for connection · ${data.inserted} formula rules extracted.`);
          // Re-render formula rules panel from backend data (source of truth)
          _renderFormulaRulesPaths(data.rules);
          const pathBadge = document.getElementById('xml-path-count');
          if (pathBadge) pathBadge.textContent = data.inserted + ' rules';
          // Auto-expand formula rules section and hide hint
          const body = document.getElementById('body-formulas');
          if (body) { body.classList.remove('collapsed'); }
          const toggle = document.querySelector('[data-target="body-formulas"] .collapsible-toggle');
          if (toggle) toggle.textContent = '▼';
          const hint = document.getElementById('formula-rules-hint');
          if (hint) hint.style.display = 'none';
        }
      } catch (err) {
        statusEl.textContent = 'Backend unreachable';
        statusEl.className = 'conn-status error';
        statusEl.style.display = 'inline-flex';
        toast('error', 'Could not reach backend. Is uvicorn running on port 8000?');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M17 16v1a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h9l4 4v9zM13 3v4h2.586L13 4.414V3zM5 9h10v1H5V9zm0 3h10v1H5v-1zm0 3h6v1H5v-1z"/></svg> Save Template';
      }
    });
  }

  /* Render paths panel from backend formula rules (source of truth after processing) */
  function _renderFormulaRulesPaths(rules) {
    const container = document.getElementById('xml-paths-list');
    const titleEl   = document.querySelector('.xml-paths-panel .panel-section-title');
    if (!container) return;
    if (titleEl) titleEl.childNodes[0].textContent = 'Formula Rules ';
    container.innerHTML = '';
    rules.forEach(r => {
      const item = document.createElement('div');
      item.className = 'xml-path-item';
      const pathText = document.createElement('span');
      pathText.className = 'xml-path-text';
      pathText.textContent = r.target_path || '';
      item.appendChild(pathText);
      const badges = document.createElement('div');
      badges.className = 'xml-path-badges';
      if (r.formula_type) {
        const tb = document.createElement('span');
        tb.className = r.formula_type === 'DEFAULT' ? 'xml-path-default-tag' : 'xml-path-direct-tag';
        tb.textContent = r.formula_type;
        badges.appendChild(tb);
      }
      if (r.default_value) {
        const vb = document.createElement('span');
        vb.className = 'xml-path-value-tag';
        vb.textContent = r.default_value.length > 20 ? r.default_value.slice(0, 20) + '…' : r.default_value;
        badges.appendChild(vb);
      }
      item.appendChild(badges);
      container.appendChild(item);
    });
  }

  /* ══════════════════════════════════════════════════════
     Connection selectors — Target tab + Mapping tab
     ══════════════════════════════════════════════════════ */
  async function _initConnectionSelectors() {
    let connections = [];
    try {
      const res = await fetch(`${API_BASE}/connections`);
      if (res.ok) connections = await res.json();
    } catch (_) { /* backend offline */ }

    function _fillSelect(id) {
      const sel = document.getElementById(id);
      if (!sel) return;
      const prev = sel.value;
      // Keep first placeholder option, then fill
      while (sel.options.length > 1) sel.remove(1);
      connections.forEach(c => {
        const opt = document.createElement('option');
        opt.value       = c.id;
        opt.textContent = `${c.name} (${c.source_type})`;
        sel.appendChild(opt);
      });
      if (prev) sel.value = prev;
    }

    _fillSelect('target-conn-select');
    _fillSelect('mapping-conn-select');

    // Target tab: show badge when connection selected
    document.getElementById('target-conn-select')?.addEventListener('change', e => {
      const connId = e.target.value;
      const badge  = document.getElementById('target-conn-badge');
      const text   = document.getElementById('target-conn-badge-text');
      if (connId && badge && text) {
        const conn = connections.find(c => String(c.id) === String(connId));
        text.textContent = conn ? `${conn.name} selected` : 'Connection selected';
        badge.style.display = 'inline-flex';
      } else if (badge) {
        badge.style.display = 'none';
      }
    });

    // Mapping tab: update Mapper state + load existing mapping + check template exists
    document.getElementById('mapping-conn-select')?.addEventListener('change', async e => {
      const connId  = e.target.value;
      const statusEl = document.getElementById('mapping-ai-status');
      Mapper.setConnection(connId);
      const conn = connections.find(c => String(c.id) === String(connId));
      Mapper.setConnectionType(conn ? conn.source_type : '');

      if (!connId) {
        if (statusEl) statusEl.style.display = 'none';
        return;
      }

      Mapper.loadMapping(parseInt(connId, 10));

      // Check if XML template has been saved for this connection
      try {
        const res   = await fetch(`${API_BASE}/target-formulas?conn_id=${connId}`);
        if (res.ok) {
          const rules = await res.json();
          if (!rules || rules.length === 0) {
            if (statusEl) {
              statusEl.textContent = '⚠ No XML template saved for this connection — go to the Target tab, select this connection, upload your XML and click Save Template first.';
              statusEl.className   = 'conn-status error';
              statusEl.style.display = 'inline-flex';
            }
            toast('warning', 'No XML template for this connection. Save one in the Target tab first.');
          } else {
            if (statusEl) statusEl.style.display = 'none';
          }
        }
      } catch (_) { /* backend offline */ }
    });

    // Copy SQL button
    document.getElementById('btn-copy-sql')?.addEventListener('click', () => {
      const ta = document.getElementById('mapping-sql-text');
      const sql = ta ? ta.value.trim() : '';
      if (sql) {
        navigator.clipboard.writeText(sql)
          .then(() => toast('success', 'SQL copied to clipboard'))
          .catch(() => toast('error', 'Copy failed — select the SQL text and use Ctrl+C'));
      } else {
        toast('warning', 'No SQL to copy — generate mapping first.');
      }
    });

    // Preview button — reads live textarea content, not stored SQL
    document.getElementById('btn-preview-sql')?.addEventListener('click', async () => {
      const connId = Mapper.getConnection();
      if (!connId) { toast('warning', 'Select a connection first.'); return; }

      // Get current SQL from textarea (may differ from what's in DB if user edited)
      const ta  = document.getElementById('mapping-sql-text');
      const sql = ta ? ta.value.trim() : '';
      if (!sql) { toast('warning', 'No SQL query to preview. Run AI Generate Mapping first.'); return; }

      const modal = document.getElementById('preview-modal');
      const body  = document.getElementById('preview-modal-body');
      if (!modal || !body) return;

      body.innerHTML = '<div class="preview-loading"><span class="spinner"></span> Running query…</div>';
      modal.style.display = 'flex';

      try {
        const res  = await fetch(`${API_BASE}/connections/${connId}/run`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ query: sql, limit: 10 }),
        });
        const data = await res.json();
        if (!res.ok) {
          body.innerHTML = `<div class="preview-error">${data.detail || 'Query failed'}</div>`;
          return;
        }
        const { columns = [], rows = [] } = data;
        if (!columns.length) {
          body.innerHTML = '<div class="preview-loading">No columns returned.</div>';
          return;
        }
        const thead = columns.map(c => `<th>${_escHtml(c)}</th>`).join('');
        const tbody = rows.map(r =>
          `<tr>${columns.map(c => `<td title="${_escHtml(String(r[c] ?? ''))}">${_escHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`
        ).join('');
        body.innerHTML = `
          <div class="preview-table-wrap">
            <table class="preview-table">
              <thead><tr>${thead}</tr></thead>
              <tbody>${tbody}</tbody>
            </table>
          </div>
          <div class="preview-count">${rows.length} row(s) returned</div>`;
      } catch (_) {
        body.innerHTML = '<div class="preview-error">Backend unreachable.</div>';
      }
    });

    // Close preview modal
    document.getElementById('btn-close-preview')?.addEventListener('click', () => {
      const modal = document.getElementById('preview-modal');
      if (modal) modal.style.display = 'none';
    });
    document.getElementById('preview-modal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });
  }

  function _escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ══════════════════════════════════════════════════════
     Mapping Tab
     ══════════════════════════════════════════════════════ */
  function _initMappingActions() {
    // Step 2: Generate Query only (SQL + identifier, no mapping rows)
    document.getElementById('btn-gen-query')?.addEventListener('click', () => {
      Mapper.generateQueryOnly();
    });

    // Step 3: Generate Mapping rows only (SQL untouched)
    document.getElementById('btn-ai-map')?.addEventListener('click', () => {
      Mapper.aiGenerateMapping();
    });

    // Auto Map — for SQL: reload from DB if data exists; for Excel: Jaccard
    document.getElementById('btn-auto-map').addEventListener('click', () => {
      if (Mapper.isSqlConnection()) {
        const connId = Mapper.getConnection();
        if (Mapper.hasMappingData()) {
          Mapper.loadMapping(connId);
          toast('info', 'Mapping reloaded from saved state.');
        } else {
          Mapper.aiGenerateMapping();
        }
        return;
      }
      if (!_sourceLoaded) { toast('warning', 'Please upload a Source Excel file first.'); return; }
      if (!_targetLoaded) { toast('warning', 'Please upload a Target XML template first.'); return; }
      Mapper.init(ExcelHandler.getSourceFields(), XMLHandler.getPaths());
      const mappings = Mapper.autoMap();
      toast('success', `Auto-mapped ${mappings.length} path(s).`);
    });

    // Save to DB
    document.getElementById('btn-save-mapping')?.addEventListener('click', () => {
      Mapper.saveMapping();
    });

    document.getElementById('btn-add-mapping').addEventListener('click', () => {
      Mapper.addRow();
    });

    document.getElementById('btn-clear-mapping').addEventListener('click', () => {
      if (confirm('Clear all mappings?')) Mapper.clearAll();
    });
  }

  /* ══════════════════════════════════════════════════════
     Save / Load Mapping (local JSON — kept for compatibility)
     ══════════════════════════════════════════════════════ */
  function _initMappingSaveLoad() {
    const loadInput = document.getElementById('load-mapping-input');
    if (!loadInput) return;
    document.getElementById('btn-save-mapping-json')?.addEventListener('click', () => {
      const json = Mapper.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'mapping.json'; a.click();
    });
    document.getElementById('btn-load-mapping-json')?.addEventListener('click', () => loadInput.click());
    loadInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        Mapper.importJSON(text);
        toast('success', 'Mapping loaded from ' + file.name);
      } catch (err) {
        toast('error', 'Failed to load mapping: ' + err.message);
      }
      loadInput.value = '';
    });
  }

  /* ══════════════════════════════════════════════════════
     Output – SQL identifier-driven XML generation panel
     ══════════════════════════════════════════════════════ */
  function _initOutputSql() {
    const panel       = document.getElementById('output-sql-panel');
    const connSel     = document.getElementById('output-conn-select');
    const btnGenerate = document.getElementById('btn-generate-all-xml');
    const idSel       = document.getElementById('output-identifier-select');
    const recordCount = document.getElementById('output-record-count');
    const statusEl    = document.getElementById('output-sql-status');
    const connBadge   = document.getElementById('output-conn-badge');
    if (!panel || !connSel) return;

    let _sqlConnections = [];

    function _setStatus(type, msg) {
      if (!statusEl) return;
      if (!msg) { statusEl.style.display = 'none'; return; }
      statusEl.className = `conn-status ${type === 'error' ? 'error' : 'success'}`;
      statusEl.textContent = msg;
      statusEl.style.display = 'inline-flex';
    }

    // Populate identifier dropdown from saved DB records
    async function _loadExistingRecords(connId) {
      if (!connId) return;
      idSel.innerHTML = '<option value="">-- Loading… --</option>';
      try {
        const res  = await fetch(`${API_BASE}/mapping/${connId}/generated-xml`);
        if (!res.ok) {
          idSel.innerHTML = '<option value="">-- Generate XML first --</option>';
          if (recordCount) recordCount.textContent = '';
          return;
        }
        const list = await res.json();
        if (list.length === 0) {
          idSel.innerHTML = '<option value="">-- No records yet · click Generate XML --</option>';
          if (recordCount) recordCount.textContent = '';
          return;
        }
        idSel.innerHTML = '<option value="">-- Select identifier --</option>';
        list.forEach(r => {
          const opt = document.createElement('option');
          opt.value       = r.id;
          opt.textContent = r.identifier_value;
          idSel.appendChild(opt);
        });
        if (recordCount) recordCount.textContent = `(${list.length} records)`;
      } catch (_) {
        idSel.innerHTML = '<option value="">-- Backend offline --</option>';
      }
    }

    // Load connections, auto-select from mapping tab
    async function _loadConnections() {
      try {
        const res = await fetch(`${API_BASE}/connections`);
        if (!res.ok) return;
        _sqlConnections = await res.json();
        const sqlConns = _sqlConnections.filter(c =>
          c.source_type === 'sql' || c.source_type === 'snowflake'
        );
        while (connSel.options.length > 1) connSel.remove(1);
        sqlConns.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.source_type})`;
          connSel.appendChild(opt);
        });
        // Auto-select from mapping tab connection
        const mappingConnId = Mapper.getConnection ? String(Mapper.getConnection() || '') : '';
        if (mappingConnId && sqlConns.some(c => String(c.id) === mappingConnId)) {
          connSel.value = mappingConnId;
          const conn = sqlConns.find(c => String(c.id) === mappingConnId);
          if (connBadge && conn) { connBadge.textContent = conn.name; connBadge.style.display = 'inline-flex'; }
          btnGenerate.disabled = false;
          await _loadExistingRecords(mappingConnId);
        }
      } catch (_) { /* backend offline */ }
    }

    connSel.addEventListener('change', async () => {
      const connId = connSel.value;
      btnGenerate.disabled = !connId;
      _setStatus('', '');
      if (!connId) {
        if (connBadge) connBadge.style.display = 'none';
        idSel.innerHTML = '<option value="">-- Select connection first --</option>';
        if (recordCount) recordCount.textContent = '';
        return;
      }
      const conn = _sqlConnections.find(c => String(c.id) === String(connId));
      if (connBadge) { connBadge.textContent = conn ? conn.name : ''; connBadge.style.display = 'inline-flex'; }
      await _loadExistingRecords(connId);
    });

    btnGenerate.addEventListener('click', async () => {
      const connId = connSel.value;
      if (!connId) { toast('warning', 'Select a connection first.'); return; }

      btnGenerate.disabled = true;
      btnGenerate.innerHTML = '<span class="spinner"></span> Generating…';
      _setStatus('', '');
      idSel.innerHTML = '<option value="">-- Generating… --</option>';

      try {
        const res  = await fetch(`${API_BASE}/mapping/${connId}/generate-all-xml`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          _setStatus('error', data.detail || 'Generation failed');
          toast('error', data.detail || 'XML generation failed');
          idSel.innerHTML = '<option value="">-- Generation failed --</option>';
          return;
        }
        const records = data.records || [];
        const errs    = data.errors  || [];

        // Populate identifier dropdown from returned records
        idSel.innerHTML = records.length > 0
          ? '<option value="">-- Select identifier --</option>'
          : '<option value="">-- No records generated --</option>';
        records.forEach(r => {
          const opt = document.createElement('option');
          opt.value       = r.id;
          opt.textContent = r.identifier_value;
          idSel.appendChild(opt);
        });
        if (recordCount) recordCount.textContent = `(${records.length} records)`;

        if (records.length === 0 && errs.length > 0) {
          _setStatus('error', `XML generation failed — ${errs[0]}`);
          toast('error', errs[0]);
        } else {
          const errNote = errs.length > 0 ? ` · ${errs.length} error(s): ${errs[0]}` : '';
          _setStatus('success', `✓ Generated ${records.length} XML record(s) saved to DB${errNote}`);
          toast('success', `${records.length} XML record(s) generated and saved`);
        }
      } catch (_) {
        _setStatus('error', 'Backend unreachable.');
        toast('error', 'Could not reach backend.');
      } finally {
        btnGenerate.disabled = false;
        btnGenerate.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M6.3 2.8A1 1 0 005 3.7v12.6a1 1 0 000-1.8l-12-6.3z"/></svg> Generate XML`;
      }
    });

    idSel.addEventListener('change', async () => {
      const connId   = connSel.value;
      const recordId = idSel.value;
      if (!connId || !recordId) return;

      const xmlOutputEl = document.getElementById('xml-output');
      const statusMain  = document.getElementById('run-status');
      if (xmlOutputEl) xmlOutputEl.innerHTML = '<span class="output-placeholder">Loading…</span>';

      try {
        const res  = await fetch(`${API_BASE}/mapping/${connId}/generated-xml/${recordId}`);
        const data = await res.json();
        if (!res.ok) {
          if (xmlOutputEl) xmlOutputEl.innerHTML = `<span style="color:var(--danger)">${data.detail || 'Error loading XML'}</span>`;
          return;
        }
        const xml = data.xml_content || '';
        _generatedXML = xml;
        if (xmlOutputEl) xmlOutputEl.innerHTML = _highlightXML(xml);
        document.getElementById('btn-download-xml').disabled = false;
        document.getElementById('btn-copy-xml').disabled     = false;
        const dlName = `${data.identifier_value || 'output'}.xml`;
        document.getElementById('btn-download-xml').onclick = () => _downloadText(xml, dlName, 'application/xml');
        if (statusMain) {
          statusMain.textContent = `"${data.identifier_value}" · ${_countLines(xml)} lines`;
          statusMain.className   = 'run-status success';
        }
      } catch (_) {
        if (xmlOutputEl) xmlOutputEl.innerHTML = '<span style="color:var(--danger)">Backend unreachable</span>';
      }
    });

    // Reload on tab switch to pick up mapping tab connection
    document.querySelectorAll('.step[data-tab="output"]').forEach(s => {
      s.addEventListener('click', () => _loadConnections());
    });

    // Init ValidationHandler when Validation tab is opened
    document.querySelectorAll('.step[data-tab="validation"]').forEach(s => {
      s.addEventListener('click', () => {
        const connId = document.getElementById('output-conn-select')?.value || null;
        if (typeof ValidationHandler !== 'undefined') ValidationHandler.init(connId);
      });
    });

    _loadConnections();
  }

  /* ══════════════════════════════════════════════════════
     Output – Download / Copy / Send API
     ══════════════════════════════════════════════════════ */
  function _initOutput() {
    const btnDownload = document.getElementById('btn-download-xml');
    const btnCopy     = document.getElementById('btn-copy-xml');
    const btnSendAPI  = document.getElementById('btn-send-api');

    btnDownload?.addEventListener('click', () => {
      if (_generatedXML) _downloadText(_generatedXML, 'output.xml', 'application/xml');
    });

    btnCopy?.addEventListener('click', () => {
      navigator.clipboard.writeText(_generatedXML)
        .then(() => toast('success', 'Copied to clipboard!'))
        .catch(() => toast('error', 'Clipboard access denied.'));
    });

    btnSendAPI?.addEventListener('click', _sendToAPI);
  }

  async function _sendToAPI() {
    if (!_generatedXML) { toast('warning', 'Run generation first.'); return; }

    const config = {
      url:          document.getElementById('api-url').value.trim(),
      method:       document.getElementById('api-method').value,
      contentType:  document.getElementById('api-content-type').value,
      token:        document.getElementById('api-token').value.trim(),
      extraHeaders: document.getElementById('api-extra-headers').value.trim()
    };

    if (!config.url) { toast('warning', 'Enter an API endpoint URL.'); return; }

    const btn = document.getElementById('btn-send-api');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';

    const responseBox    = document.getElementById('api-response-box');
    const responseStatus = document.getElementById('api-response-status');
    const responseTime   = document.getElementById('api-response-time');
    const responseBody   = document.getElementById('api-response-body');

    try {
      const res = await XMLGenerator.sendToAPI(_generatedXML, config);

      responseBox.style.display = 'block';
      responseStatus.textContent  = `${res.status} ${res.statusText}`;
      responseStatus.className    = 'api-status-badge ' + (res.ok ? 'ok' : 'err');
      responseTime.textContent    = `${res.elapsed}ms`;
      responseBody.textContent    = res.body ? res.body.slice(0, 2000) : '(empty)';

      if (res.ok) {
        toast('success', `API responded: ${res.status} ${res.statusText}`);
      } else {
        toast('error', `API error: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      responseBox.style.display = 'block';
      responseStatus.textContent = 'Network Error';
      responseStatus.className   = 'api-status-badge err';
      responseBody.textContent   = err.message;
      toast('error', 'Request failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l.053-.012L10 16.33l6.67 1.62.054.012a1 1 0 001.17-1.409l-7-14z"/></svg> Send to API`;
    }
  }

  /* ══════════════════════════════════════════════════════
     Utility helpers
     ══════════════════════════════════════════════════════ */

  /* XML syntax highlight for display */
  function _highlightXML(xml) {
    const esc = s => s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return esc(xml)
      // PI
      .replace(/(&lt;\?[^?]*\?&gt;)/g,
        '<span class="xml-out-pi">$1</span>')
      // Comments
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g,
        '<span class="xml-out-comment">$1</span>')
      // Closing tags  </tag>
      .replace(/(&lt;\/)([\w:\-\.]+)(&gt;)/g,
        '<span class="xml-out-tag">$1$2$3</span>')
      // Opening/self-closing tags with attrs
      .replace(/(&lt;)([\w:\-\.]+)((\s+[\w:\-\.]+="[^"]*")*\s*\/?\s*&gt;)/g,
        (_, lt, name, rest) => {
          const attrsHtml = rest.replace(/([\w:\-\.]+)=("[^"]*")/g,
            '<span class="xml-out-attr-name">$1</span>=<span class="xml-out-attr-val">$2</span>');
          return `<span class="xml-out-tag">${lt}${name}</span>${attrsHtml}`;
        });
  }

  function _countLines(str) {
    return (str.match(/\n/g) || []).length + 1;
  }

  function _downloadText(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* ══════════════════════════════════════════════════════
     Toast Notifications (global helper)
     ══════════════════════════════════════════════════════ */
  window.toast = function (type, message, duration = 4000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${_escHtml(message)}</span><span class="toast-dismiss" onclick="this.parentElement.remove()">×</span>`;
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
  };

  function _escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ══════════════════════════════════════════════════════
     Global utility: password toggle
     ══════════════════════════════════════════════════════ */
  window.togglePassword = function (btn, inputId) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
    else                        { inp.type = 'password'; btn.textContent = 'Show'; }
  };

  /* ══════════════════════════════════════════════════════
     Boot
     ══════════════════════════════════════════════════════ */
  function _initCollapsibles() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
      header.addEventListener('click', () => {
        const body   = document.getElementById(header.dataset.target);
        const toggle = header.querySelector('.collapsible-toggle');
        if (!body) return;
        const isCollapsed = body.classList.toggle('collapsed');
        toggle.textContent = isCollapsed ? '▶' : '▼';
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     AI Chat Source
     ══════════════════════════════════════════════════════ */
  function _initChatSource() {
    // Restore saved API key / model
    const keyInput   = document.getElementById('chat-api-key');
    const modelInput = document.getElementById('chat-model');
    if (keyInput && ChatHandler.getApiKey())   keyInput.value  = ChatHandler.getApiKey();
    if (modelInput && ChatHandler.getModel()) modelInput.value = ChatHandler.getModel();

    // Check if .env has the key and hide the input if so
    fetch(`${API_BASE}/admin/openai-key-status`).then(r => r.ok ? r.json() : null).then(data => {
      if (!data?.configured) return;
      const field = document.getElementById('chat-api-key')?.closest('.chat-config-field');
      if (!field) return;
      field.innerHTML =
        `<span class="env-key-badge">` +
        `<svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13" style="flex-shrink:0"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>` +
        `OpenAI key loaded from <code>.env</code> <span class="env-key-preview">${data.preview}</span>` +
        `</span>`;
    }).catch(() => {});

    ChatHandler.init(_onChatDataReady);

    document.getElementById('btn-chat-start').addEventListener('click', _startChat);
    document.getElementById('btn-chat-reset').addEventListener('click', _resetChat);
    document.getElementById('btn-chat-send').addEventListener('click',  _sendChatMessage);
    document.getElementById('btn-chat-load').addEventListener('click',  _loadChatData);

    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendChatMessage(); }
    });

    // Auto-resize textarea
    document.getElementById('chat-input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Save API key/model on change
    keyInput  && keyInput.addEventListener('change',  () => ChatHandler.saveApiKey(keyInput.value));
    modelInput && modelInput.addEventListener('change', () => ChatHandler.saveModel(modelInput.value));

    // RSA key file upload
    const rsaFileInput = document.getElementById('chat-rsa-file');
    if (rsaFileInput) {
      rsaFileInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const pem = await file.text();
        ChatHandler.setPrivateKey(file.name, pem);
        // Show status
        const statusEl = document.getElementById('chat-rsa-status');
        if (statusEl) statusEl.textContent = '✓ ' + file.name + ' attached';
        // Notify AI that the key was uploaded
        _appendChatMessage('user', `RSA private key uploaded: ${file.name}`);
        const sendBtn = document.getElementById('btn-chat-send');
        sendBtn.disabled = true;
        _appendTypingIndicator();
        try {
          const reply = await ChatHandler.sendMessage(`RSA private key uploaded: ${file.name}`);
          _removeTypingIndicator();
          _appendChatMessage('assistant', reply);
        } catch (err) {
          _removeTypingIndicator();
          toast('error', 'Chat error: ' + err.message);
        } finally {
          sendBtn.disabled = false;
        }
        rsaFileInput.value = ''; // reset so same file can be re-uploaded
      });
    }
  }

  async function _startChat() {
    const key = (document.getElementById('chat-api-key')?.value || '').trim();
    // key may be empty — backend falls back to OPENAI_API_KEY in .env
    ChatHandler.saveApiKey(key);
    ChatHandler.saveModel(document.getElementById('chat-model').value);
    ChatHandler.init(_onChatDataReady);

    const btn = document.getElementById('btn-chat-start');
    btn.disabled = true;
    try {
      const reply = await ChatHandler.startConversation();
      _appendChatMessage('assistant', reply);
      document.getElementById('chat-input-bar').style.display = 'flex';
      document.getElementById('btn-chat-reset').style.display = 'inline-flex';
      btn.style.display = 'none';
    } catch (err) {
      toast('error', 'Chat error: ' + err.message);
      btn.disabled = false;
    }
  }

  async function _sendChatMessage() {
    const inp  = document.getElementById('chat-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    inp.style.height = 'auto';

    // Mask PII before displaying in chat bubble and before sending to LLM
    const { display, safe } = ChatHandler.maskUserInput(text);
    _appendChatMessage('user', display);

    const sendBtn = document.getElementById('btn-chat-send');
    sendBtn.disabled = true;
    _appendTypingIndicator();

    try {
      const reply = await ChatHandler.sendMessage(safe);
      _removeTypingIndicator();
      _appendChatMessage('assistant', reply);
    } catch (err) {
      _removeTypingIndicator();
      toast('error', 'Chat error: ' + err.message);
    } finally {
      sendBtn.disabled = false;
      inp.focus();
    }
  }

  function _onChatDataReady(data) {
    const bar     = document.getElementById('chat-data-bar');
    const summary = document.getElementById('chat-data-summary');
    if (!bar) return;
    const label = data.connection_type === 'snowflake'
      ? 'Snowflake connection ready'
      : `SQL (${data.dialect || 'DB'}) connection ready`;
    summary.textContent = label + ' — click to apply to form';
    bar.style.display = 'flex';
  }

  function _loadChatData() {
    const data = ChatHandler.getPendingData();
    if (!data) return;

    if (data.connection_type === 'sql') {
      _fillSqlForm(data);
    } else if (data.connection_type === 'snowflake') {
      _fillSnowflakeForm(data);
    }

    document.getElementById('chat-data-bar').style.display = 'none';
    ChatHandler.clearPendingData();
  }

  function _fillSqlForm(d) {
    // Switch to SQL pane
    document.querySelectorAll('.src-type-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-type="sql"]').classList.add('active');
    document.querySelectorAll('.source-pane').forEach(p => p.style.display = 'none');
    document.getElementById('src-pane-sql').style.display = 'block';

    _setVal('sql-dialect',  d.dialect      || 'mssql');
    _setVal('sql-host',     d.host         || '');
    _setVal('sql-port',     d.port         || 1433);
    _setVal('sql-database', d.database_name|| '');
    _setVal('sql-schema',   d.schema_name  || 'dbo');
    _setVal('sql-username', d.username     || '');
    _setVal('sql-password', d.password     || '');
    _setVal('sql-alias',    d.sheet_alias  || '');
    _setVal('sql-query',    d.query_text   || '');

    toast('success', 'SQL connection details applied — review and click Test or Preview.');
  }

  function _fillSnowflakeForm(d) {
    // Switch to Snowflake pane
    document.querySelectorAll('.src-type-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-type="snowflake"]').classList.add('active');
    document.querySelectorAll('.source-pane').forEach(p => p.style.display = 'none');
    document.getElementById('src-pane-snowflake').style.display = 'block';

    _setVal('sf-account',   d.sf_account   || '');
    _setVal('sf-warehouse', d.sf_warehouse || '');
    _setVal('sf-database',  d.sf_database  || '');
    _setVal('sf-schema',    d.sf_schema    || 'PUBLIC');
    _setVal('sf-role',      d.sf_role      || '');
    _setVal('sf-username',  d.sf_username  || d.username || '');
    _setVal('sf-alias',     d.sheet_alias  || '');
    _setVal('sf-query',     d.query_text   || '');

    const useKey = d.auth_type === 'key' && ChatHandler.hasPrivateKey();

    if (useKey) {
      // Switch to Private Key auth mode
      document.querySelectorAll('.sf-auth-btn').forEach(b => b.classList.remove('active'));
      const keyBtn = document.querySelector('.sf-auth-btn[data-auth="key"]');
      if (keyBtn) keyBtn.classList.add('active');
      const pwGroup         = document.getElementById('sf-password-group');
      const keyGroup        = document.getElementById('sf-key-group');
      const passphraseGroup = document.getElementById('sf-passphrase-group');
      if (pwGroup)         pwGroup.style.display         = 'none';
      if (keyGroup)        keyGroup.style.display        = '';
      if (passphraseGroup) passphraseGroup.style.display = '';

      // Fill private key PEM from uploaded file
      _setVal('sf-private-key', ChatHandler.getPrivateKey());

      // Fill passphrase into the dedicated passphrase field
      if (d.sf_private_key_passphrase) {
        _setVal('sf-passphrase', d.sf_private_key_passphrase);
      }

      toast('success', `Snowflake RSA key auth applied (${ChatHandler.getPrivateKeyName()}) — review and click Test or Preview.`);
    } else {
      // Password auth mode
      document.querySelectorAll('.sf-auth-btn').forEach(b => b.classList.remove('active'));
      const pwBtn = document.querySelector('.sf-auth-btn[data-auth="password"]');
      if (pwBtn) pwBtn.classList.add('active');
      const pwGroup  = document.getElementById('sf-password-group');
      const keyGroup = document.getElementById('sf-key-group');
      if (pwGroup)  pwGroup.style.display  = '';
      if (keyGroup) keyGroup.style.display = 'none';
      _setVal('sf-password', d.sf_password || '');

      toast('success', 'Snowflake connection details applied — review and click Test or Preview.');
    }
  }

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function _resetChat() {
    ChatHandler.reset();
    document.getElementById('chat-messages').innerHTML = `
      <div class="chat-placeholder">
        <svg viewBox="0 0 48 48" fill="none" width="40" height="40"><path d="M42 24c0 9.941-8.059 18-18 18a17.93 17.93 0 01-8.284-2.018L6 42l2.018-9.716A17.93 17.93 0 016 24C6 14.059 14.059 6 24 6s18 8.059 18 18z" stroke="#cbd5e1" stroke-width="2"/></svg>
        <p>Enter your OpenAI API key and click <strong>Start</strong> to begin.</p>
        <p class="chat-placeholder-sub">The AI will ask you questions one by one to configure a SQL or Snowflake connection.</p>
      </div>`;
    document.getElementById('chat-input-bar').style.display = 'none';
    document.getElementById('chat-rsa-bar').style.display = 'none';
    document.getElementById('chat-data-bar').style.display = 'none';
    document.getElementById('btn-chat-reset').style.display = 'none';
    document.getElementById('btn-chat-start').style.display = 'inline-flex';
    document.getElementById('btn-chat-start').disabled = false;
    const rsaStatus = document.getElementById('chat-rsa-status');
    if (rsaStatus) rsaStatus.textContent = '';
    ChatHandler.clearPrivateKey();
  }

  function _appendChatMessage(role, text) {
    const container = document.getElementById('chat-messages');
    const placeholder = container.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    const msg = document.createElement('div');
    msg.className = 'chat-msg chat-msg-' + role;
    const formatted = _formatChatText(text);
    msg.innerHTML = `<div class="chat-bubble">${formatted}</div>`;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;

    // Show RSA bar only when AI mentions RSA/private key for Snowflake
    if (role === 'assistant') {
      const lower = text.toLowerCase();
      const mentionsRsa = lower.includes('rsa') || lower.includes('private key')
                        || lower.includes('.p8') || lower.includes('.pem')
                        || lower.includes('attach');
      const rsaBar = document.getElementById('chat-rsa-bar');
      if (rsaBar && mentionsRsa) rsaBar.style.display = 'flex';
    }
  }

  function _formatChatText(text) {
    // Replace ```json blocks with a styled pre
    text = text.replace(/```json([\s\S]*?)```/gi, (_, code) =>
      `<pre class="chat-code-block">${_escapeHtml(code.trim())}</pre>`);
    // Replace other ``` blocks
    text = text.replace(/```([\s\S]*?)```/gi, (_, code) =>
      `<pre class="chat-code-block">${_escapeHtml(code.trim())}</pre>`);
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Line breaks to <br>
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function _escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _appendTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg-assistant chat-typing';
    el.id = 'chat-typing-indicator';
    el.innerHTML = '<div class="chat-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function _removeTypingIndicator() {
    const el = document.getElementById('chat-typing-indicator');
    if (el) el.remove();
  }

  function _init() {
    _initSections();
    _initTabs();
    _initSourceUpload();
    _initTargetUpload();
    _initTargetProcess();
    _initCollapsibles();
    _initChatSource();
    _initConnectionSelectors();
    _initMappingActions();
    _initMappingSaveLoad();
    _initOutput();
    _initOutputSql();

    // Phase 2b: source connector (SQL / Snowflake forms)
    if (typeof SourceConnector  !== 'undefined') SourceConnector.init();

    // Reports section (standalone page — uses original rpt-* IDs)
    if (typeof ReportHandler !== 'undefined') ReportHandler.init();

    // Tab 6: Admin Panel
    if (typeof AdminHandler !== 'undefined') AdminHandler.init();

    // Production Support floating panel
    if (typeof PSHandler !== 'undefined') PSHandler.init();

    // Workflow management tab
    if (typeof WorkflowHandler !== 'undefined') WorkflowHandler.init();

    // Callback used by SourceConnector when preview data is loaded
    window._onSourceLoaded = function () {
      _sourceLoaded = true;
      if (_targetLoaded) Mapper.init(ExcelHandler.getSourceFields(), XMLHandler.getPaths());
    };

    // If XLSX not available, warn
    if (typeof XLSX === 'undefined') {
      toast('warning', 'SheetJS not loaded. Excel parsing may be limited — check your internet connection.');
    }
  }

  /* ══════════════════════════════════════════════════════
     Login / Logout
     ══════════════════════════════════════════════════════ */
  const USERS = { 'admin': 'clarity123', 'demo': 'demo' };

  function _initLogin() {
    const screen   = document.getElementById('login-screen');
    const app      = document.getElementById('app-container');
    const errEl    = document.getElementById('login-error');
    const userSpan = document.getElementById('header-username');

    // Logout (always wire, regardless of session state)
    document.getElementById('btn-logout')?.addEventListener('click', function () {
      sessionStorage.removeItem('csUser');
      location.reload();
    });

    // Check session
    const savedUser = sessionStorage.getItem('csUser');
    if (savedUser) {
      screen.style.display = 'none';
      app.style.display = '';
      if (userSpan) userSpan.textContent = savedUser;
      _init();
      return;
    }

    // Login submit
    document.getElementById('btn-login')?.addEventListener('click', function () {
      const u = document.getElementById('login-username')?.value.trim();
      const p = document.getElementById('login-password')?.value;
      if (!u || !p) { errEl.textContent = 'Please enter username and password.'; return; }
      if (USERS[u] && USERS[u] === p) {
        sessionStorage.setItem('csUser', u);
        screen.style.display = 'none';
        app.style.display = '';
        if (userSpan) userSpan.textContent = u;
        _init();
      } else {
        errEl.textContent = 'Invalid username or password.';
        document.getElementById('login-password').value = '';
      }
    });

    // Allow Enter key in password field
    document.getElementById('login-password')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('btn-login')?.click();
    });
    document.getElementById('login-username')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('login-password')?.focus();
    });
  }

  /* ══════════════════════════════════════════════════════
     Theme Switcher
     ══════════════════════════════════════════════════════ */
  const THEME_CLASSES = ['theme-dark', 'theme-ocean', 'theme-forest', 'theme-sunset'];

  function _initThemes() {
    // Restore saved theme
    const saved = localStorage.getItem('csTheme') || '';
    _applyTheme(saved);

    document.getElementById('btn-open-themes')?.addEventListener('click', function () {
      document.getElementById('theme-overlay').style.display = 'flex';
    });
    document.getElementById('btn-theme-close')?.addEventListener('click', function () {
      document.getElementById('theme-overlay').style.display = 'none';
    });
    document.getElementById('theme-overlay')?.addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });
    document.querySelectorAll('.theme-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const theme = card.dataset.theme || '';
        _applyTheme(theme);
        localStorage.setItem('csTheme', theme);
        document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
      });
    });
  }

  function _applyTheme(theme) {
    THEME_CLASSES.forEach(c => document.body.classList.remove(c));
    if (theme) document.body.classList.add('theme-' + theme);
    // Mark active card
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('active', (c.dataset.theme || '') === theme);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      _initThemes();
      _initLogin();
    });
  } else {
    _initThemes();
    _initLogin();
  }

})();
