/* ═══════════════════════════════════════════════════════════
   adminHandler.js  –  Tab 6: Admin Panel
   • Loads saved connections into dropdown
   • "Collect Schema" → SSE streaming discovery with live log
   • "View Catalog"   → loads & displays stored catalog
   • Results in 4 sub-tabs: Columns | Relations | Views | Samples
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const API_BASE = 'http://localhost:8000/api';

  const AdminHandler = {
    _connections:  [],
    _catalog:      null,
    _activeTab:    'reports',
    _envKeyLoaded: false,   // true when .env has OPENAI_API_KEY

    init() {
      _loadConnections();
      _initButtons();
      _initResultTabs();
      _fetchOpenAIKeyStatus();
      _initAdminModes();
    }
  };

  /* ══════════════════════════════════════════════════════
     Load connections
     ══════════════════════════════════════════════════════ */
  async function _loadConnections() {
    const sel = document.getElementById('adm-conn-select');
    if (!sel) return;
    try {
      const [sqlRes, sfRes] = await Promise.all([
        fetch(`${API_BASE}/connections?source_type=sql`),
        fetch(`${API_BASE}/connections?source_type=snowflake`)
      ]);
      const sqlList = sqlRes.ok ? await sqlRes.json() : [];
      const sfList  = sfRes.ok  ? await sfRes.json()  : [];

      const prev = sel.value;
      sel.innerHTML = '<option value="">-- Select a connection --</option>';

      if (sqlList.length) {
        const g = document.createElement('optgroup');
        g.label = 'SQL Database';
        sqlList.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id; o.textContent = c.name;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
      if (sfList.length) {
        const g = document.createElement('optgroup');
        g.label = 'Snowflake';
        sfList.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id; o.textContent = c.name;
          g.appendChild(o);
        });
        sel.appendChild(g);
      }
      if (prev) sel.value = prev;
    } catch (_) { /* backend offline */ }
  }

  /* ══════════════════════════════════════════════════════
     Buttons
     ══════════════════════════════════════════════════════ */
  function _initButtons() {
    document.getElementById('btn-adm-discover')?.addEventListener('click', _startDiscovery);
    document.getElementById('btn-adm-embed')?.addEventListener('click',    _startEmbedding);
    document.getElementById('btn-adm-catalog')?.addEventListener('click',  _loadCatalog);
    document.getElementById('btn-adm-clear')?.addEventListener('click',    _clearCatalog);
    document.getElementById('btn-adm-metadata')?.addEventListener('click', _openMetadataEditor);

    // Restore saved API key
    const savedKey = localStorage.getItem('adm_openai_key') || '';
    const keyInput = document.getElementById('adm-api-key');
    if (keyInput && savedKey) keyInput.value = savedKey;

    // Refresh connections when tab is opened
    document.querySelectorAll('.step[data-tab="admin"]').forEach(s => {
      s.addEventListener('click', _loadConnections);
    });

    // Reset state when connection changes
    document.getElementById('adm-conn-select')?.addEventListener('change', function () {
      // Clear cached catalog
      AdminHandler._catalog = null;

      // Hide summary bar and log panel
      document.getElementById('adm-summary-bar').style.display  = 'none';
      document.getElementById('adm-log-panel').style.display    = 'none';
      document.getElementById('adm-log').innerHTML              = '';

      // Clear catalog result area
      const tabContent = document.getElementById('adm-tab-content');
      if (tabContent) tabContent.innerHTML = '<div class="adm-empty">Select a connection and click "Collect Schema" or "View Catalog".</div>';

      // Hide metadata panel
      const metaPanel = document.getElementById('adm-metadata-panel');
      if (metaPanel) metaPanel.style.display = 'none';
      const metaContent = document.getElementById('adm-metadata-content');
      if (metaContent) metaContent.innerHTML = '';
    });
  }

  /* ══════════════════════════════════════════════════════
     Open Metadata Editor — standalone panel separate from
     the catalog tabs. Accessible via PS sidebar shortcut.
     ══════════════════════════════════════════════════════ */
  async function _openMetadataEditor() {
    if (typeof window._switchSection === 'function') window._switchSection('admin');
    _switchAdminMode('schema');

    const connId = _connId();
    if (!connId) { toast('warn', 'Select a connection first'); return; }

    // Load catalog if not already loaded
    if (!AdminHandler._catalog) {
      try {
        toast('info', 'Loading schema catalog…');
        const res = await fetch(`${API_BASE}/admin/catalog/${connId}`);
        if (!res.ok) { toast('error', 'Could not load catalog — run Collect Schema first'); return; }
        const data = await res.json();
        AdminHandler._catalog = data;
        _renderSummary(data.summary);
      } catch (err) {
        toast('error', 'Catalog load error: ' + err.message); return;
      }
    }

    // Show the standalone metadata panel
    const panel = document.getElementById('adm-metadata-panel');
    const content = document.getElementById('adm-metadata-content');
    if (!panel || !content) return;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    _renderMetadata(AdminHandler._catalog, content);
  }

  // Wire header buttons (close, export, import) — always present in DOM
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-adm-meta-close')?.addEventListener('click', () => {
      document.getElementById('adm-metadata-panel').style.display = 'none';
    });

    // Export — delegates to the live _buildTreeJSON helper once editor is open
    document.getElementById('btn-adm-meta-export')?.addEventListener('click', () => {
      if (typeof window._admExportJSON === 'function') {
        window._admExportJSON();
      } else {
        toast('warn', 'Open Edit Metadata first, then export.');
      }
    });

    // Import — triggers the hidden file input
    document.getElementById('btn-adm-meta-import')?.addEventListener('click', () => {
      const fi = document.getElementById('adm-meta-import-hdr');
      if (fi) fi.click();
      else toast('warn', 'Open Edit Metadata first, then import.');
    });

    document.getElementById('adm-meta-import-hdr')?.addEventListener('change', function () {
      if (typeof window._admImportJSON === 'function') {
        window._admImportJSON(this);
      } else {
        toast('warn', 'Open Edit Metadata first, then import.');
        this.value = '';
      }
    });
  });

  // Expose globally so PS sidebar button can call it
  window._openMetadataEditor = _openMetadataEditor;

  function _connId() {
    const v = document.getElementById('adm-conn-select')?.value;
    if (!v) { toast('warning', 'Select a connection first'); return null; }
    return v;
  }

  /* ══════════════════════════════════════════════════════
     Fetch OpenAI key status from backend (.env)
     ══════════════════════════════════════════════════════ */
  async function _fetchOpenAIKeyStatus() {
    try {
      const res  = await fetch(`${API_BASE}/admin/openai-key-status`);
      if (!res.ok) return;
      const data = await res.json();
      AdminHandler._envKeyLoaded = data.configured;

      const group = document.getElementById('adm-api-key')?.closest('.adm-conn-group');
      if (!group) return;

      if (data.configured) {
        // Replace the key input with a status badge — backend uses .env key automatically
        group.innerHTML =
          `<span class="env-key-badge">` +
          `<svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13" style="flex-shrink:0"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>` +
          `OpenAI key loaded from <code>.env</code> <span class="env-key-preview">${data.preview}</span>` +
          `</span>`;
      }
    } catch (_) { /* backend offline */ }
  }

  /* ══════════════════════════════════════════════════════
     Collect Schema  — SSE streaming
     ══════════════════════════════════════════════════════ */
  async function _startDiscovery() {
    const id = _connId();
    if (!id) return;

    const btn   = document.getElementById('btn-adm-discover');
    const logEl = document.getElementById('adm-log');

    // Reset log
    document.getElementById('adm-result-panel').style.display = 'none';
    document.getElementById('adm-summary-bar').style.display = 'none';
    const logPanel = document.getElementById('adm-log-panel');
    if (logEl) logEl.innerHTML = '';
    if (logPanel) {
      logPanel.style.display = 'block';
      logPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="border-color:#fff3;border-top-color:#fff"></span> Collecting…';

    _appendLog('info', '⏳ Starting schema discovery…');

    try {
      const res = await fetch(`${API_BASE}/admin/discover/${id}`, { method: 'POST' });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        _appendLog('error', '✗ ' + (err.detail || 'Request failed'));
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE events (split on double-newline)
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete tail

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              _handleSSEEvent(evt);
              // Yield to browser render loop so each entry paints immediately
              await new Promise(r => setTimeout(r, 0));
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      if (err instanceof TypeError || err.message.includes('fetch')) {
        _appendLog('error', '✗ Backend not running — uvicorn api.main:app --reload --port 8000');
      } else {
        _appendLog('error', '✗ ' + err.message);
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg> Collect Schema';
    }
  }

  function _handleSSEEvent(evt) {
    const { type, msg } = evt;
    _appendLog(type, msg);

    if (type === 'done') {
      // Auto-switch to Reports tab so instant visuals show after streaming
      AdminHandler._activeTab = 'reports';
      document.querySelectorAll('.adm-result-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === 'reports');
      });
      _loadCatalog();
    }
  }

  /* ══════════════════════════════════════════════════════
     Generate Embeddings  — SSE streaming
     ══════════════════════════════════════════════════════ */
  async function _startEmbedding() {
    const id = _connId();
    if (!id) return;

    const keyInput = document.getElementById('adm-api-key');
    const apiKey   = (keyInput?.value || '').trim();
    if (!apiKey && !AdminHandler._envKeyLoaded) {
      toast('warning', 'Enter an OpenAI API key (or set OPENAI_API_KEY in .env)');
      keyInput?.focus();
      return;
    }

    // Save key for later (only if user typed one)
    if (apiKey) localStorage.setItem('adm_openai_key', apiKey);

    const btn     = document.getElementById('btn-adm-embed');
    const logEl   = document.getElementById('adm-log');
    const logPanel = document.getElementById('adm-log-panel');

    if (logEl) logEl.innerHTML = '';
    if (logPanel) {
      logPanel.style.display = 'block';
      logPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner" style="border-color:#fff3;border-top-color:#fff"></span> Embedding…';

    _appendLog('info', '⏳ Starting embedding generation…');

    try {
      const res = await fetch(`${API_BASE}/admin/embeddings/${id}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: apiKey, model: 'text-embedding-3-small', chat_model: 'gpt-4o-mini' })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        _appendLog('error', '✗ ' + (err.detail || 'Request failed'));
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              _appendLog(evt.type, evt.msg);
              await new Promise(r => setTimeout(r, 0));
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      if (err instanceof TypeError || err.message.includes('fetch')) {
        _appendLog('error', '✗ Backend not running — uvicorn api.main:app --reload --port 8000');
      } else {
        _appendLog('error', '✗ ' + err.message);
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg> Generate Embeddings';
    }
  }

  function _appendLog(type, msg) {
    const logEl = document.getElementById('adm-log');
    if (!logEl) return;
    const ts  = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const row = document.createElement('div');
    row.className = 'adm-log-entry ' + type;
    row.innerHTML = `<span class="adm-log-ts">${ts}</span><span class="adm-log-msg">${_escHtml(msg)}</span>`;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ══════════════════════════════════════════════════════
     View Catalog  — loads and renders stored data
     ══════════════════════════════════════════════════════ */
  async function _loadCatalog() {
    const id = _connId();
    if (!id) return;

    const btn = document.getElementById('btn-adm-catalog');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
      const res = await fetch(`${API_BASE}/admin/catalog/${id}`);
      if (!res.ok) { toast('error', 'Failed to load catalog'); return; }
      const data = await res.json();
      AdminHandler._catalog = data;
      _renderSummary(data.summary);
      _renderActiveTab();
      document.getElementById('adm-result-panel').style.display = 'block';
      document.getElementById('adm-summary-bar').style.display = 'flex';
    } catch (err) {
      toast('error', 'Catalog load error: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'View Catalog'; }
    }
  }

  /* ══════════════════════════════════════════════════════
     Clear Catalog
     ══════════════════════════════════════════════════════ */
  async function _clearCatalog() {
    const id = _connId();
    if (!id) return;
    if (!confirm('Clear all stored catalog data for this connection?')) return;

    const logEl = document.getElementById('adm-log');
    document.getElementById('adm-log-panel').style.display = 'block';
    if (logEl) logEl.innerHTML = '';

    try {
      const res = await fetch(`${API_BASE}/admin/catalog/${id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        _appendLog('success', '✓ Catalog cleared');
        document.getElementById('adm-result-panel').style.display = 'none';
        toast('success', 'Catalog cleared');
      } else {
        _appendLog('error', '✗ Clear failed');
      }
    } catch (err) {
      _appendLog('error', '✗ ' + err.message);
    }
  }

  /* ══════════════════════════════════════════════════════
     Summary KPI bar
     ══════════════════════════════════════════════════════ */
  function _renderSummary(s) {
    const bar = document.getElementById('adm-summary-bar');
    if (!bar) return;
    bar.innerHTML = [
      { label: 'Tables',    value: s.table_count  },
      { label: 'Columns',   value: s.col_count    },
      { label: 'Relations', value: s.rel_count    },
      { label: 'Views',     value: s.view_count   },
      { label: 'Sampled',   value: s.sample_count },
    ].map(k => `
      <div class="adm-kpi-card">
        <div class="adm-kpi-val">${k.value}</div>
        <div class="adm-kpi-label">${k.label}</div>
      </div>`).join('');
  }

  /* ══════════════════════════════════════════════════════
     Result sub-tabs
     ══════════════════════════════════════════════════════ */
  function _initResultTabs() {
    document.querySelectorAll('.adm-result-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.adm-result-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        AdminHandler._activeTab = tab.dataset.tab;
        _renderActiveTab();
      });
    });
  }

  function _renderActiveTab() {
    const cat = AdminHandler._catalog;
    if (!cat) return;
    switch (AdminHandler._activeTab) {
      case 'columns':   _renderColumns(cat.columns);    break;
      case 'relations': _renderRelations(cat.relations); break;
      case 'views':     _renderViews(cat.views);        break;
      case 'samples':   _renderSamples(cat.samples);    break;
      case 'reports':   _renderCatalogReports(cat);     break;
    }
  }

  /* ── Columns tab ────────────────────────────────────── */
  function _renderColumns(cols) {
    const el = document.getElementById('adm-tab-content');
    if (!el) return;
    if (!cols.length) { el.innerHTML = '<div class="adm-empty">No columns discovered yet.</div>'; return; }

    // Group by table
    const byTable = {};
    cols.forEach(c => {
      const k = `${c.table_schema || 'dbo'}.${c.table_name}`;
      (byTable[k] = byTable[k] || []).push(c);
    });

    let html = '';
    Object.entries(byTable).forEach(([tbl, tcols]) => {
      html += `<div class="adm-table-group">
        <div class="adm-table-header">
          <span class="adm-table-name">${_esc(tbl)}</span>
          <span class="adm-table-meta">${tcols.length} cols</span>
        </div>
        <table class="adm-cat-table">
          <thead><tr>
            <th>Column</th><th>Data Type</th><th>Max Len</th><th>Nullable</th><th>PK</th>
          </tr></thead>
          <tbody>`;
      tcols.forEach(c => {
        const pk   = c.is_primary_key ? '<span class="adm-badge badge-pk">PK</span>' : '';
        const null_ = c.is_nullable === 'NO'
          ? '<span class="adm-badge badge-nn">NOT NULL</span>'
          : '<span class="adm-badge badge-null">NULL</span>';
        const ml = c.max_length == null ? '' : (c.max_length === -1 ? 'MAX' : c.max_length);
        html += `<tr>
          <td class="adm-col-name">${_esc(c.column_name)} ${pk}</td>
          <td class="adm-type">${_esc(c.data_type || '')}</td>
          <td class="adm-maxlen">${ml}</td>
          <td>${null_}</td>
          <td>${c.is_primary_key ? '✓' : ''}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    });
    el.innerHTML = html;
  }

  /* ── Relations tab ──────────────────────────────────── */
  function _renderRelations(rels) {
    const el = document.getElementById('adm-tab-content');
    if (!el) return;
    if (!rels.length) { el.innerHTML = '<div class="adm-empty">No foreign key relationships found.</div>'; return; }

    let html = `<table class="adm-cat-table">
      <thead><tr>
        <th>FK Name</th><th>Parent Table</th><th>Parent Col</th>
        <th></th><th>Referenced Table</th><th>Referenced Col</th>
      </tr></thead><tbody>`;
    rels.forEach(r => {
      html += `<tr>
        <td class="adm-fk-name">${_esc(r.fk_name || '')}</td>
        <td>${_esc(r.parent_table)}</td>
        <td class="adm-col-name">${_esc(r.parent_column)}</td>
        <td class="adm-arrow">→</td>
        <td>${_esc(r.referenced_table)}</td>
        <td class="adm-col-name">${_esc(r.referenced_column)}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  /* ── Views tab ──────────────────────────────────────── */
  function _renderViews(views) {
    const el = document.getElementById('adm-tab-content');
    if (!el) return;
    if (!views.length) { el.innerHTML = '<div class="adm-empty">No views found.</div>'; return; }

    let html = '';
    views.forEach(v => {
      const schema = v.view_schema ? `${v.view_schema}.` : '';
      html += `<div class="adm-view-card">
        <div class="adm-view-header" onclick="
          var pre=this.nextElementSibling;
          var tog=this.querySelector('.adm-view-toggle');
          pre.classList.toggle('collapsed');
          tog.textContent = pre.classList.contains('collapsed') ? '▶' : '▼';
        ">
          <span class="adm-view-name">👁 ${_esc(schema + v.view_name)}</span>
          <span class="adm-view-toggle">▶</span>
        </div>
        <pre class="adm-view-def collapsed">${_esc(v.view_definition || '-- definition not available')}</pre>
      </div>`;
    });
    el.innerHTML = html;
  }

  /* ── Samples tab ────────────────────────────────────── */
  function _renderSamples(samples) {
    const el = document.getElementById('adm-tab-content');
    if (!el) return;
    if (!samples.length) { el.innerHTML = '<div class="adm-empty">No sample rows collected.</div>'; return; }

    let html = '';
    samples.forEach(s => {
      let rows = [];
      try { rows = JSON.parse(s.sample_json || '[]'); } catch (_) {}
      const cols = rows.length ? Object.keys(rows[0]) : [];

      html += `<div class="adm-table-group">
        <div class="adm-table-header">
          <span class="adm-table-name">${_esc(s.table_name)}</span>
          <span class="adm-table-meta">${(s.row_count || 0).toLocaleString()} total rows · showing ${rows.length}</span>
        </div>`;
      if (rows.length) {
        html += `<table class="adm-cat-table"><thead><tr>`;
        cols.forEach(c => { html += `<th>${_esc(c)}</th>`; });
        html += '</tr></thead><tbody>';
        rows.forEach(row => {
          html += '<tr>';
          cols.forEach(c => {
            const v = row[c];
            html += `<td>${v == null ? '<span class="adm-null">NULL</span>' : _esc(String(v))}</td>`;
          });
          html += '</tr>';
        });
        html += '</tbody></table>';
      } else {
        html += '<div class="adm-empty" style="padding:8px">No rows sampled (empty or access denied)</div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════════
     Reports tab — instant reports from collected catalog
     No API call; uses AdminHandler._catalog directly
     ══════════════════════════════════════════════════════ */
  function _renderCatalogReports(cat) {
    const el = document.getElementById('adm-tab-content');
    if (!el) return;

    const cols    = cat.columns  || [];
    const samples = cat.samples  || [];
    const rels    = cat.relations || [];

    if (!cols.length) {
      el.innerHTML = '<div class="adm-empty">No catalog data yet — run Collect Schema first.</div>';
      return;
    }

    // ── Build lookup maps ──────────────────────────────────
    // table key: "schema.name"
    const tableKey = c => `${c.table_schema || 'dbo'}.${c.table_name}`;

    // col count per table
    const colCount = {};
    cols.forEach(c => { const k = tableKey(c); colCount[k] = (colCount[k] || 0) + 1; });

    // has PK per table
    const hasPK = {};
    cols.forEach(c => { if (c.is_primary_key) hasPK[tableKey(c)] = true; });

    // row count from samples (match by table_name, ignoring schema)
    const rowCount = {};
    samples.forEach(s => {
      const k = `${s.table_schema || 'dbo'}.${s.table_name}`;
      rowCount[k] = s.row_count || 0;
      // also index by bare name for fallback
      rowCount[s.table_name] = s.row_count || 0;
    });

    // tables referenced in FKs — index both bare name and any schema-qualified match
    const hasFKTable = new Set();
    rels.forEach(r => {
      hasFKTable.add(r.parent_table);
      hasFKTable.add(r.referenced_table);
    });

    // nullable count per table
    const nullableCount = {};
    cols.forEach(c => {
      const k = tableKey(c);
      if (!nullableCount[k]) nullableCount[k] = { nullable: 0, total: 0 };
      nullableCount[k].total++;
      if (c.is_nullable !== 'NO') nullableCount[k].nullable++;
    });

    // data type distribution across all columns
    const typeCount = {};
    cols.forEach(c => {
      const t = (c.data_type || 'unknown').toLowerCase();
      typeCount[t] = (typeCount[t] || 0) + 1;
    });

    const allTables = Object.keys(colCount).sort();

    // ── 1. Table Summary ───────────────────────────────────
    let html = `<div class="adm-report-section">
      <div class="adm-report-section-title">📋 Table Summary
        <span class="adm-report-section-meta">${allTables.length} tables · ${cols.length} columns · ${samples.length} sampled</span>
      </div>
      <div class="adm-report-table-wrap">
      <table class="adm-cat-table adm-rpt-summary-table">
        <thead><tr>
          <th>Table</th><th style="text-align:right">Cols</th>
          <th style="text-align:right">Rows</th><th>PK</th><th>FK Ref</th>
          <th style="text-align:right">Nullable %</th>
        </tr></thead><tbody>`;

    allTables.forEach(k => {
      const tableName = k.split('.').pop();
      const rc  = rowCount[k] != null ? rowCount[k].toLocaleString()
                : rowCount[tableName] != null ? rowCount[tableName].toLocaleString() : '—';
      const pk  = hasPK[k]  ? '<span class="adm-badge badge-pk">PK</span>'   : '<span class="adm-badge badge-null">none</span>';
      const fk  = hasFKTable.has(tableName) ? '<span class="adm-badge badge-fk">FK</span>' : '';
      const nc  = nullableCount[k] || { nullable: 0, total: 1 };
      const pct = Math.round((nc.nullable / nc.total) * 100);
      const pctColor = pct > 50 ? '#ef4444' : pct > 25 ? '#f59e0b' : '#10b981';
      html += `<tr>
        <td class="adm-col-name">${_esc(k)}</td>
        <td style="text-align:right">${colCount[k]}</td>
        <td style="text-align:right">${_esc(rc)}</td>
        <td>${pk}</td>
        <td>${fk}</td>
        <td style="text-align:right;color:${pctColor}">${pct}%</td>
      </tr>`;
    });

    html += '</tbody></table></div></div>';

    // ── 2. Column Type Distribution ────────────────────────
    const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
    const maxTypeCount = sortedTypes[0]?.[1] || 1;

    html += `<div class="adm-report-section">
      <div class="adm-report-section-title">🗂 Column Type Distribution
        <span class="adm-report-section-meta">${Object.keys(typeCount).length} distinct types</span>
      </div>
      <div class="adm-type-dist">`;

    sortedTypes.forEach(([type, cnt]) => {
      const pct = Math.round((cnt / maxTypeCount) * 100);
      const totalPct = Math.round((cnt / cols.length) * 100);
      html += `<div class="adm-type-row">
        <span class="adm-type-label">${_esc(type)}</span>
        <div class="adm-type-bar-wrap">
          <div class="adm-type-bar" style="width:${pct}%"></div>
        </div>
        <span class="adm-type-count">${cnt} <span class="adm-type-pct">(${totalPct}%)</span></span>
      </div>`;
    });

    html += '</div></div>';

    // ── 3. PK Coverage + Nullable Analysis side by side ───
    const noPKTables  = allTables.filter(k => !hasPK[k]);
    const highNullable = allTables
      .map(k => ({ table: k, pct: Math.round(((nullableCount[k]?.nullable || 0) / (nullableCount[k]?.total || 1)) * 100) }))
      .filter(x => x.pct > 50)
      .sort((a, b) => b.pct - a.pct);

    html += `<div class="adm-report-row-panels">`;

    // PK Coverage panel
    html += `<div class="adm-report-panel">
      <div class="adm-report-section-title">🔑 PK Coverage</div>`;
    if (!noPKTables.length) {
      html += '<div class="adm-report-panel-ok">✓ All tables have a primary key</div>';
    } else {
      html += `<div class="adm-report-panel-warn">${noPKTables.length} table${noPKTables.length > 1 ? 's' : ''} without a primary key:</div>
        <ul class="adm-report-list">`;
      noPKTables.forEach(k => { html += `<li>${_esc(k)}</li>`; });
      html += '</ul>';
    }
    html += '</div>';

    // Nullable hotspots panel
    html += `<div class="adm-report-panel">
      <div class="adm-report-section-title">⚠ High-Nullable Tables <span class="adm-report-section-meta">&gt;50% nullable</span></div>`;
    if (!highNullable.length) {
      html += '<div class="adm-report-panel-ok">✓ No tables with &gt;50% nullable columns</div>';
    } else {
      html += '<ul class="adm-report-list">';
      highNullable.forEach(x => {
        html += `<li><span class="adm-col-name">${_esc(x.table)}</span> <span style="color:#ef4444">${x.pct}%</span></li>`;
      });
      html += '</ul>';
    }
    html += '</div>';

    html += '</div>'; // .adm-report-row-panels

    // ── 4. FK Relationship Map ─────────────────────────────
    if (rels.length) {
      html += `<div class="adm-report-section">
        <div class="adm-report-section-title">🔗 Foreign Key Map
          <span class="adm-report-section-meta">${rels.length} relationship${rels.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="adm-report-table-wrap">
        <table class="adm-cat-table">
          <thead><tr><th>Parent Table</th><th>Column</th><th></th><th>References</th><th>Column</th></tr></thead>
          <tbody>`;
      rels.forEach(r => {
        html += `<tr>
          <td class="adm-col-name">${_esc(r.parent_table)}</td>
          <td>${_esc(r.parent_column)}</td>
          <td class="adm-arrow">→</td>
          <td class="adm-col-name">${_esc(r.referenced_table)}</td>
          <td>${_esc(r.referenced_column)}</td>
        </tr>`;
      });
      html += '</tbody></table></div></div>';
    }

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════════
     Metadata tab — user-defined aliases & descriptions
     for vectorless RAG enrichment
     ══════════════════════════════════════════════════════ */
  async function _renderMetadata(cat, el) {
    if (!el) el = document.getElementById('adm-metadata-content');
    if (!el) return;
    const connId = _connId();
    if (!connId) { el.innerHTML = '<div class="adm-empty">Select a connection first.</div>'; return; }

    el.innerHTML = '<div class="adm-loading">Loading metadata…</div>';

    let existingMeta = [];
    try {
      const res = await fetch(`${API_BASE}/admin/metadata/${connId}`);
      if (res.ok) existingMeta = await res.json();
    } catch (_) {}

    const metaMap = {};
    existingMeta.forEach(m => {
      metaMap[m.table_name + '\0' + (m.column_name || '')] = m;
    });

    // Load AI-generated definitions from embeddings as defaults
    const embMap = {};
    try {
      const r2 = await fetch(`${API_BASE}/admin/embeddings/${connId}/definitions`);
      if (r2.ok) {
        const defs = await r2.json();
        defs.forEach(d => { embMap[d.table_name + '\0' + d.column_name] = d.ai_definition; });
      }
    } catch (_) {}

    const tables = {};
    (cat.columns || []).forEach(c => {
      (tables[c.table_name] = tables[c.table_name] || { cols: [], fks: [] }).cols.push(c);
    });
    (cat.relations || []).forEach(r => {
      if (tables[r.parent_table])     tables[r.parent_table].fks.push('→ ' + r.referenced_table + ' (via ' + r.parent_column + ')');
      if (tables[r.referenced_table]) tables[r.referenced_table].fks.push('← ' + r.parent_table + ' (via ' + r.referenced_column + ')');
    });

    const tblNames = Object.keys(tables).sort();
    if (tblNames.length === 0) {
      el.innerHTML = '<div class="adm-empty">No columns in catalog. Run Collect Schema first.</div>';
      return;
    }

    // ── Count annotated tables ──────────────────────────
    function _countAnnotated() {
      return tblNames.filter(t => {
        const tm = metaMap[t + '\0'];
        return tm && (tm.aliases || tm.description);
      }).length;
    }

    // ── Build toolbar ───────────────────────────────────
    el.innerHTML =
      '<div class="adm-meta-toolbar">' +
        '<input id="adm-meta-search" type="search" class="adm-meta-search" placeholder="🔍 Filter tables…" />' +
        '<div class="adm-meta-toolbar-right">' +
          '<span id="adm-meta-progress" class="adm-meta-progress"></span>' +
          '<button id="adm-meta-expand-all" class="btn btn-ghost btn-sm">Expand All</button>' +
          '<button id="adm-meta-collapse-all" class="btn btn-ghost btn-sm">Collapse All</button>' +
          '<button id="adm-meta-save-all" class="btn btn-primary btn-sm">💾 Save All</button>' +
        '</div>' +
      '</div>' +
      '<p class="adm-meta-intro">Add <strong>aliases</strong> and <strong>descriptions</strong> for tables and columns. ' +
      'Columns with <span class="adm-ai-badge-inline">✦ AI</span> show the AI-generated definition from embeddings as a starting point — edit and save to keep changes.</p>' +
      '<div id="adm-meta-tables"></div>';

    const container = document.getElementById('adm-meta-tables');

    function _updateProgress() {
      const prog = document.getElementById('adm-meta-progress');
      if (prog) prog.textContent = _countAnnotated() + ' / ' + tblNames.length + ' tables annotated';
    }
    _updateProgress();

    // ── Render each table ───────────────────────────────
    tblNames.forEach(tblName => {
      const info    = tables[tblName];
      const tblMeta = metaMap[tblName + '\0'] || {};
      const hasAnnotation = !!(tblMeta.aliases || tblMeta.description);

      const section = document.createElement('details');
      section.className = 'adm-meta-section';
      section.dataset.tbl = tblName;

      const summary = document.createElement('summary');
      summary.className = 'adm-meta-table-summary';
      summary.innerHTML =
        '<span class="adm-meta-status-dot ' + (hasAnnotation ? 'annotated' : '') + '"></span>' +
        '<span class="adm-meta-table-name">' + _esc(tblName) + '</span>' +
        '<span class="adm-meta-col-count">' + info.cols.length + ' col' + (info.cols.length !== 1 ? 's' : '') + '</span>' +
        (tblMeta.aliases ? '<span class="adm-meta-alias-badge">' + _esc(tblMeta.aliases) + '</span>' : '') +
        '<span class="adm-meta-table-desc-preview">' + _esc(tblMeta.description || '') + '</span>';
      section.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'adm-meta-section-body';

      // Table-level row
      body.innerHTML =
        '<div class="adm-meta-row adm-meta-table-row">' +
          '<div class="adm-meta-label">Table</div>' +
          '<div class="adm-meta-fields">' +
            '<input type="text" class="adm-meta-input adm-meta-aliases" placeholder="Aliases — comma separated (e.g. Policy, Premium, Contract)"' +
              ' data-tbl="' + _esc(tblName) + '" data-col=""' +
              ' value="' + _esc(tblMeta.aliases || '') + '">' +
            '<input type="text" class="adm-meta-input adm-meta-desc" placeholder="Description — business context for this table"' +
              ' data-tbl="' + _esc(tblName) + '" data-col=""' +
              ' value="' + _esc(tblMeta.description || '') + '">' +
          '</div>' +
          '<button class="btn btn-xs-secondary adm-meta-save-btn" data-tbl="' + _esc(tblName) + '" data-col="">Save</button>' +
        '</div>';

      if (info.fks.length > 0) {
        body.innerHTML +=
          '<div class="adm-meta-fk-row">' +
            info.fks.map(f => '<span class="adm-meta-fk-badge">' + _esc(f) + '</span>').join('') +
          '</div>';
      }

      // Column rows inside a sub-details
      const colSection = document.createElement('details');
      colSection.className = 'adm-meta-col-details';
      const colSummary = document.createElement('summary');
      colSummary.className = 'adm-meta-col-summary';
      const annotatedCols = info.cols.filter(c => {
        const cm = metaMap[tblName + '\0' + c.column_name];
        return cm && (cm.aliases || cm.description);
      }).length;
      colSummary.innerHTML = 'Columns (' + info.cols.length + ')' +
        (annotatedCols > 0 ? ' <span class="adm-meta-col-annotated-badge">' + annotatedCols + ' annotated</span>' : '');
      colSection.appendChild(colSummary);

      const colBody = document.createElement('div');
      colBody.className = 'adm-meta-col-body';

      info.cols.forEach(c => {
        const colMeta  = metaMap[tblName + '\0' + c.column_name] || {};
        const aiDef    = embMap[tblName + '\0' + c.column_name] || '';
        const descVal  = colMeta.description || aiDef;
        const isAiDef  = !colMeta.description && !!aiDef;
        const hasColMeta = !!(colMeta.aliases || colMeta.description || colMeta.synonyms);
        // Parse stored synonyms (JSON array) or auto-generate
        let storedSyn = [];
        try { storedSyn = JSON.parse(colMeta.synonyms || '[]'); } catch (_) {}
        if (!storedSyn.length) storedSyn = _autoSynonyms(c.column_name);
        const synVal = storedSyn.join(', ');
        colBody.innerHTML +=
          '<div class="adm-meta-row' + (hasColMeta ? ' has-meta' : '') + '">' +
            '<div class="adm-meta-col-info">' +
              '<span class="adm-meta-col-name">' + _esc(c.column_name) + '</span>' +
              '<span class="adm-meta-col-type">' + _esc(c.data_type || '') + '</span>' +
              (isAiDef ? '<span class="adm-ai-badge-inline" title="Populated from AI embeddings">✦ AI</span>' : '') +
            '</div>' +
            '<div class="adm-meta-fields">' +
              '<input type="text" class="adm-meta-input adm-meta-aliases" placeholder="Aliases (e.g. Policy ID, Contract No)"' +
                ' data-tbl="' + _esc(tblName) + '" data-col="' + _esc(c.column_name) + '"' +
                ' value="' + _esc(colMeta.aliases || '') + '">' +
              '<input type="text" class="adm-meta-input adm-meta-desc"' +
                ' placeholder="Description"' +
                ' data-tbl="' + _esc(tblName) + '" data-col="' + _esc(c.column_name) + '"' +
                ' data-ai-def="' + _esc(aiDef) + '"' +
                (isAiDef ? ' data-is-ai-default="1"' : '') +
                ' value="' + _esc(descVal) + '">' +
              '<input type="text" class="adm-meta-input adm-meta-synonyms" placeholder="Synonyms — comma separated"' +
                ' data-tbl="' + _esc(tblName) + '" data-col="' + _esc(c.column_name) + '"' +
                ' value="' + _esc(synVal) + '" title="Auto-generated synonyms + your additions">' +
            '</div>' +
            '<button class="btn btn-xs-secondary adm-meta-save-btn"' +
              ' data-tbl="' + _esc(tblName) + '" data-col="' + _esc(c.column_name) + '">Save</button>' +
          '</div>';
      });

      colSection.appendChild(colBody);
      body.appendChild(colSection);
      section.appendChild(body);
      container.appendChild(section);
    });

    // ── Wire Save (single row) ──────────────────────────
    async function _saveRow(tblName, colName, aliasesVal, descVal, synonymsVal, bizCtxVal) {
      const aliases          = aliasesVal.trim()  || null;
      const desc             = descVal.trim()     || null;
      const synonyms_list    = synonymsVal ? synonymsVal.split(',').map(s => s.trim()).filter(Boolean) : [];
      const synonyms         = synonyms_list.length ? JSON.stringify(synonyms_list) : null;
      const business_context = bizCtxVal?.trim()  || null;
      const res = await fetch(`${API_BASE}/admin/metadata/${connId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_name: tblName, column_name: colName || null,
          aliases, description: desc, synonyms, business_context,
        }),
      });
      if (res.ok) {
        metaMap[tblName + '\0' + (colName || '')] = { aliases, description: desc, synonyms, business_context };
        _updateProgress();
      }
      return res.ok;
    }

    container.querySelectorAll('.adm-meta-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tblName  = btn.dataset.tbl;
        const colName  = btn.dataset.col;
        const row      = btn.closest('.adm-meta-row');
        const aliases  = row.querySelector('.adm-meta-aliases')?.value || '';
        const desc     = row.querySelector('.adm-meta-desc')?.value    || '';
        const synonyms = row.querySelector('.adm-meta-synonyms')?.value || '';
        const bizCtx   = row.querySelector('.adm-meta-bizctx')?.value  || '';
        btn.disabled = true;
        try {
          const ok = await _saveRow(tblName, colName, aliases, desc, synonyms, bizCtx);
          if (ok) {
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1200);
            const section = btn.closest('.adm-meta-section');
            const dot = section?.querySelector('.adm-meta-status-dot');
            if (dot && !colName) dot.classList.toggle('annotated', !!(aliases.trim() || desc.trim()));
          } else { toast('error', 'Save failed'); btn.disabled = false; }
        } catch (_) { toast('error', 'Backend unreachable'); btn.disabled = false; }
      });
    });

    // ── Save All ─────────────────────────────────────────
    document.getElementById('adm-meta-save-all')?.addEventListener('click', async () => {
      const rows = [];
      container.querySelectorAll('.adm-meta-row').forEach(row => {
        const aliasEl  = row.querySelector('.adm-meta-aliases');
        const descEl   = row.querySelector('.adm-meta-desc');
        const synEl    = row.querySelector('.adm-meta-synonyms');
        const bizEl    = row.querySelector('.adm-meta-bizctx');
        if (!aliasEl) return;
        const synList  = synEl ? synEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        rows.push({
          table_name:       aliasEl.dataset.tbl,
          column_name:      aliasEl.dataset.col || null,
          aliases:          aliasEl.value.trim() || null,
          description:      descEl?.value.trim() || null,
          synonyms:         synList.length ? JSON.stringify(synList) : null,
          business_context: bizEl?.value.trim() || null,
        });
      });
      if (!rows.length) return;
      const btn = document.getElementById('adm-meta-save-all');
      btn.disabled = true; btn.textContent = '⏳ Saving…';
      try {
        const res = await fetch(`${API_BASE}/admin/metadata/${connId}/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        });
        if (res.ok) {
          const d = await res.json();
          rows.forEach(r => { metaMap[r.table_name + '\0' + (r.column_name || '')] = r; });
          _updateProgress();
          toast('success', d.saved + ' entries saved');
        } else { toast('error', 'Bulk save failed'); }
      } catch (_) { toast('error', 'Backend unreachable'); }
      btn.disabled = false; btn.textContent = '💾 Save All';
    });

    // ── Synonym auto-generation (structure-based, no embeddings) ─────────
    function _autoSynonyms(colName) {
      const up  = colName.toUpperCase();
      const syn = [];
      if (up.includes('DOB'))  syn.push('date of birth', 'birthdate');
      if (up.includes('ID'))   syn.push('identifier');
      if (up.includes('NAME')) syn.push('name', 'full name');
      return syn;
    }

    // ── Build tree-format JSON from current UI state ──────────────────────
    function _buildTreeJSON() {
      // Collect connection name from selector label
      const selEl  = document.getElementById('adm-conn-select');
      const dbName = selEl?.options[selEl.selectedIndex]?.text || String(connId);

      // Collect FK relationships keyed by table
      const relsByTable = {};
      (cat.relations || []).forEach(r => {
        if (!relsByTable[r.parent_table]) relsByTable[r.parent_table] = [];
        relsByTable[r.parent_table].push({
          column:            r.parent_column,
          references_table:  r.referenced_table,
          references_column: r.referenced_column,
        });
      });

      // Collect data_type per table+column from catalog
      const dtMap = {};
      (cat.columns || []).forEach(c => {
        dtMap[c.table_name + '\0' + c.column_name] = c.data_type || '';
      });

      const tablesOut = {};
      container.querySelectorAll('.adm-meta-section').forEach(section => {
        const tblName    = section.dataset.tbl;
        const tblDescEl  = section.querySelector('.adm-meta-table-row .adm-meta-desc');
        const tblAliasEl = section.querySelector('.adm-meta-table-row .adm-meta-aliases');
        const tblBizEl   = section.querySelector('.adm-meta-table-row .adm-meta-bizctx');
        const columnsOut = {};

        section.querySelectorAll('.adm-meta-col-body .adm-meta-row').forEach(row => {
          const aliasEl  = row.querySelector('.adm-meta-aliases');
          const descEl   = row.querySelector('.adm-meta-desc');
          const synEl    = row.querySelector('.adm-meta-synonyms');
          if (!aliasEl || !aliasEl.dataset.col) return;
          const colName  = aliasEl.dataset.col;
          const desc     = descEl?.value.trim() || '';
          // Synonyms field is the source of truth; fall back to auto if blank
          const synRaw   = synEl?.value.trim() || '';
          const synonyms = synRaw
            ? synRaw.split(',').map(s => s.trim()).filter(Boolean)
            : _autoSynonyms(colName);
          columnsOut[colName] = {
            data_type:        dtMap[tblName + '\0' + colName] || '',
            description:      desc,
            business_context: tblBizEl?.value.trim() || tblDescEl?.value.trim() || '',
            synonyms,
          };
        });

        tablesOut[tblName] = {
          description:      tblDescEl?.value.trim() || '',
          business_context: tblBizEl?.value.trim()  || '',
          aliases:          tblAliasEl?.value.trim() || '',
          columns:          columnsOut,
          relationships:    relsByTable[tblName] || [],
        };
      });

      return { database: dbName, tables: tablesOut };
    }

    // ── Expose export/import to header buttons ─────────────
    window._admExportJSON = function () {
      const tree     = _buildTreeJSON();
      const tblCount = Object.keys(tree.tables).length;
      const colCount = Object.values(tree.tables).reduce((n, t) => n + Object.keys(t.columns).length, 0);
      const blob     = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
      const a        = document.createElement('a');
      a.href         = URL.createObjectURL(blob);
      a.download     = 'schema-' + connId + '.json';
      a.click();
      toast('success', `Exported ${tblCount} tables / ${colCount} columns → schema-${connId}.json`);
    };

    window._admImportJSON = async function (fileInput) {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Validate
        if (typeof data !== 'object' || Array.isArray(data))
          throw new Error('Expected a JSON object (tree format)');
        if (!data.tables || typeof data.tables !== 'object')
          throw new Error('Missing "tables" key');
        const firstTbl = Object.values(data.tables)[0];
        if (firstTbl && typeof firstTbl.columns !== 'object')
          throw new Error('Each table must have a "columns" object');

        let updated = 0;
        Object.entries(data.tables).forEach(([tblName, tblData]) => {
          // Table-level fields
          const esc = CSS.escape(tblName);
          container.querySelectorAll(`.adm-meta-table-row .adm-meta-aliases[data-tbl="${esc}"]`).forEach(aliasEl => {
            if (tblData.aliases      !== undefined) aliasEl.value = tblData.aliases;
            const row = aliasEl.closest('.adm-meta-row');
            const descEl = row?.querySelector('.adm-meta-desc');
            const bizEl  = row?.querySelector('.adm-meta-bizctx');
            if (descEl && tblData.description      !== undefined) descEl.value = tblData.description;
            if (bizEl  && tblData.business_context !== undefined) bizEl.value  = tblData.business_context;
            updated++;
          });
          // Column-level fields
          if (tblData.columns && typeof tblData.columns === 'object') {
            Object.entries(tblData.columns).forEach(([colName, colData]) => {
              const cEsc = CSS.escape(colName);
              container.querySelectorAll(
                `.adm-meta-aliases[data-tbl="${esc}"][data-col="${cEsc}"]`
              ).forEach(aliasEl => {
                const row    = aliasEl.closest('.adm-meta-row');
                const descEl = row?.querySelector('.adm-meta-desc');
                const synEl  = row?.querySelector('.adm-meta-synonyms');
                if (descEl && colData.description !== undefined) {
                  descEl.value = colData.description;
                  descEl.removeAttribute('data-is-ai-default');
                }
                if (synEl && colData.synonyms !== undefined) {
                  synEl.value = Array.isArray(colData.synonyms)
                    ? colData.synonyms.join(', ') : colData.synonyms;
                }
                updated++;
              });
            });
          }
        });
        toast('info', `Imported ${updated} rows — click "💾 Save All" to persist.`);
      } catch (e) {
        toast('error', 'Import failed: ' + e.message);
      }
      fileInput.value = '';
    };

    // ── Expand / Collapse All ─────────────────────────────
    document.getElementById('adm-meta-expand-all')?.addEventListener('click', () => {
      container.querySelectorAll('details').forEach(d => d.open = true);
    });
    document.getElementById('adm-meta-collapse-all')?.addEventListener('click', () => {
      container.querySelectorAll('details').forEach(d => d.open = false);
    });

    // ── Search / filter tables ────────────────────────────
    document.getElementById('adm-meta-search')?.addEventListener('input', function () {
      const q = this.value.toLowerCase();
      container.querySelectorAll('.adm-meta-section').forEach(sec => {
        sec.style.display = sec.dataset.tbl.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     Helpers
     ══════════════════════════════════════════════════════ */
  function _escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _esc(s) { return _escHtml(s); }

  /* ══════════════════════════════════════════════════════
     Admin mode switcher (Schema / Email)
  ══════════════════════════════════════════════════════ */
  function _initAdminModes() {
    document.querySelectorAll('.adm-mode-btn[data-adm-mode]').forEach(btn => {
      btn.addEventListener('click', () => _switchAdminMode(btn.dataset.admMode));
    });
    _initEmailPanel();
  }

  function _switchAdminMode(mode) {
    document.querySelectorAll('.adm-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.admMode === mode);
    });
    const schemaPanel      = document.getElementById('adm-schema-panel');
    const emailPanel       = document.getElementById('adm-email-panel');
    const examplesPanel    = document.getElementById('adm-examples-panel');
    const integrPanel      = document.getElementById('adm-integrations-panel');
    const tracesPanel      = document.getElementById('adm-ai-traces-panel');
    if (schemaPanel)   schemaPanel.style.display   = mode === 'schema'       ? '' : 'none';
    if (emailPanel)    emailPanel.style.display    = mode === 'email'         ? '' : 'none';
    if (examplesPanel) examplesPanel.style.display = mode === 'examples'      ? '' : 'none';
    if (integrPanel)   integrPanel.style.display   = mode === 'integrations'  ? '' : 'none';
    if (tracesPanel)   tracesPanel.style.display   = mode === 'ai-traces'     ? '' : 'none';
    if (mode === 'examples')     _initExamplesPanel();
    if (mode === 'integrations') _initIntegrationsPanel();
    if (mode === 'ai-traces')    _initTracesPanel();
  }

  /* ══════════════════════════════════════════════════════
     Integrations Panel (JIRA / ADO / Git)
     ══════════════════════════════════════════════════════ */
  let _integrInited = false;

  function _initIntegrationsPanel() {
    if (!_integrInited) {
      _integrInited = true;
      _loadIntegrations();
      document.getElementById('btn-adm-jira-save')?.addEventListener('click', () => _saveIntegration('jira'));
      document.getElementById('btn-adm-ado-save')?.addEventListener('click',  () => _saveIntegration('ado'));
      document.getElementById('btn-adm-git-save')?.addEventListener('click',  () => _saveIntegration('git'));
      document.getElementById('btn-adm-jira-delete')?.addEventListener('click', () => _deleteIntegration('jira'));
      document.getElementById('btn-adm-ado-delete')?.addEventListener('click',  () => _deleteIntegration('ado'));
      document.getElementById('btn-adm-git-delete')?.addEventListener('click',  () => _deleteIntegration('git'));
    }
  }

  async function _loadIntegrations() {
    try {
      const res = await fetch(`${API_BASE}/admin/integrations`);
      if (!res.ok) return;
      const list = await res.json();
      list.forEach(intg => {
        if (intg.type === 'jira') {
          _setField('adm-jira-url',  intg.base_url || '');
          _setField('adm-jira-user', intg.username || '');
          _admStatus(document.getElementById('adm-jira-status'), 'ok', intg.has_token ? '✓ Token saved' : '');
        } else if (intg.type === 'ado') {
          _setField('adm-ado-url', intg.base_url || '');
          _admStatus(document.getElementById('adm-ado-status'), 'ok', intg.has_token ? '✓ Token saved' : '');
        } else if (intg.type === 'git') {
          _setField('adm-git-url', intg.base_url || '');
          _admStatus(document.getElementById('adm-git-status'), 'ok', intg.has_token ? '✓ Token saved' : '');
        }
      });
    } catch (_) {}
  }

  async function _saveIntegration(type) {
    const urlMap   = { jira: 'adm-jira-url',  ado: 'adm-ado-url',  git: 'adm-git-url' };
    const userMap  = { jira: 'adm-jira-user', ado: null,            git: null };
    const tokenMap = { jira: 'adm-jira-token', ado: 'adm-ado-token', git: 'adm-git-token' };
    const statMap  = { jira: 'adm-jira-status', ado: 'adm-ado-status', git: 'adm-git-status' };

    const url   = _getField(urlMap[type]);
    const token = _getField(tokenMap[type]);
    const user  = userMap[type] ? _getField(userMap[type]) : null;
    const statEl = document.getElementById(statMap[type]);

    if (!url) { _admStatus(statEl, 'error', '✗ URL required'); return; }
    if (!token) { _admStatus(statEl, 'error', '✗ Token required'); return; }

    try {
      const res = await fetch(`${API_BASE}/admin/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, base_url: url, username: user || null, token }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        _admStatus(statEl, 'ok', '✓ Saved');
        window.toast && window.toast('success', type.toUpperCase() + ' integration saved');
      } else {
        _admStatus(statEl, 'error', '✗ ' + (d.detail || 'Save failed'));
      }
    } catch (_) { _admStatus(statEl, 'error', '✗ Backend unreachable'); }
  }

  async function _deleteIntegration(type) {
    if (!confirm('Remove ' + type.toUpperCase() + ' integration?')) return;
    const statMap = { jira: 'adm-jira-status', ado: 'adm-ado-status', git: 'adm-git-status' };
    const statEl  = document.getElementById(statMap[type]);
    try {
      await fetch(`${API_BASE}/admin/integrations/${type}`, { method: 'DELETE' });
      _admStatus(statEl, '', 'Removed');
      window.toast && window.toast('success', type.toUpperCase() + ' integration removed');
    } catch (_) {}
  }

  /* ══════════════════════════════════════════════════════
     AI Traces Panel
     ══════════════════════════════════════════════════════ */
  let _tracesInited = false;

  function _initTracesPanel() {
    if (!_tracesInited) {
      _tracesInited = true;
      document.getElementById('btn-adm-trace-refresh')?.addEventListener('click', _loadTraces);
      document.getElementById('btn-adm-trace-purge')?.addEventListener('click', _purgeTraces);
      document.getElementById('adm-trace-module')?.addEventListener('change', _loadTraces);
    }
    _loadTraces();
  }

  async function _loadTraces() {
    const list = document.getElementById('adm-traces-list');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--text-3);font-size:12px">Loading…</div>';

    const module = document.getElementById('adm-trace-module')?.value || '';
    const qs = module ? `?module=${encodeURIComponent(module)}&limit=100` : '?limit=100';

    try {
      const res = await fetch(`${API_BASE}/admin/ai-traces${qs}`);
      if (!res.ok) { list.innerHTML = '<div class="adm-empty">Could not load traces.</div>'; return; }
      const traces = await res.json();
      if (!traces.length) { list.innerHTML = '<div class="adm-empty">No traces found.</div>'; return; }

      list.innerHTML = traces.map(t => `
        <div class="dev-trace-row" style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="info-badge" style="text-transform:uppercase">${_esc(t.module)}</span>
            <span style="font-size:11px;color:var(--text-3)">${_esc(t.model)}</span>
            <span style="font-size:11px;color:var(--text-3)">${t.latency_ms ? t.latency_ms + 'ms' : ''}</span>
            <span style="font-size:11px;color:var(--text-3);margin-left:auto">${(t.created_at || '').substring(0,19)}</span>
            <button class="btn btn-ghost btn-xs" style="color:#ef4444" onclick="AdminHandler._deleteTrace(${t.id},this)">✕</button>
          </div>
          <details>
            <summary style="cursor:pointer;font-size:11px;color:var(--text-3)">Prompt / Response</summary>
            <pre style="font-size:11px;background:var(--bg-2);padding:8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;margin:6px 0 0">${_esc((t.prompt_text||'').substring(0,800))}</pre>
            <pre style="font-size:11px;background:var(--bg-3);padding:8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;margin:4px 0 0">${_esc((t.response_text||'').substring(0,800))}</pre>
          </details>
        </div>
      `).join('');
    } catch (err) {
      list.innerHTML = '<div class="dev-error">' + err.message + '</div>';
    }
  }

  async function _purgeTraces() {
    if (!confirm('Delete all AI trace logs older than 30 days?')) return;
    try {
      const res = await fetch(`${API_BASE}/admin/ai-traces?older_than_days=30`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      window.toast && window.toast('success', (d.purged || 0) + ' traces purged');
      _loadTraces();
    } catch (_) { window.toast && window.toast('error', 'Purge failed'); }
  }

  // Expose delete for inline onclick
  const AdminHandler_outer = { _deleteTrace: async (id, btn) => {
    btn.disabled = true;
    try {
      await fetch(`${API_BASE}/admin/ai-traces/${id}`, { method: 'DELETE' });
      btn.closest('.dev-trace-row').remove();
    } catch (_) { btn.disabled = false; }
  }};
  window.AdminHandler = window.AdminHandler || AdminHandler_outer;

  /* ── Email Settings panel (inline in Admin) ─────────── */
  function _initEmailPanel() {
    // Pre-fill from backend
    fetch(`${API_BASE}/ps/email-settings`)
      .then(r => r.ok ? r.json() : {})
      .then(s => {
        _setField('adm-em-host', s.smtp_host || '');
        _setField('adm-em-port', s.smtp_port || 587);
        _setField('adm-em-user', s.smtp_user || '');
        _setField('adm-em-from', s.from_address || '');
        const tls = document.getElementById('adm-em-tls');
        if (tls) tls.checked = s.use_tls !== false;
        const passEl = document.getElementById('adm-em-pass');
        if (passEl && s.has_password) passEl.placeholder = '(saved — leave blank to keep)';
      })
      .catch(() => {});

    document.getElementById('btn-adm-em-save')?.addEventListener('click', _saveEmail);
    document.getElementById('btn-adm-em-test')?.addEventListener('click', _testEmail);
  }

  async function _saveEmail() {
    const statusEl = document.getElementById('adm-em-status');
    const payload = {
      smtp_host:    _getField('adm-em-host'),
      smtp_port:    parseInt(_getField('adm-em-port')) || 587,
      smtp_user:    _getField('adm-em-user') || null,
      smtp_pass:    _getField('adm-em-pass') || null,
      from_address: _getField('adm-em-from'),
      use_tls:      document.getElementById('adm-em-tls')?.checked !== false,
    };
    if (!payload.smtp_host || !payload.from_address) {
      _admStatus(statusEl, 'error', '✗ SMTP host and From address are required');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/ps/email-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        _admStatus(statusEl, 'ok', '✓ Email settings saved');
        window.toast && window.toast('success', 'Email settings saved');
      } else {
        const d = await res.json().catch(() => ({}));
        _admStatus(statusEl, 'error', '✗ ' + (d.detail || 'Save failed'));
      }
    } catch (_) { _admStatus(statusEl, 'error', '✗ Backend unreachable'); }
  }

  async function _testEmail() {
    const to = prompt('Send test email to:');
    if (!to) return;
    try {
      const res = await fetch(`${API_BASE}/ps/email-settings/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: 'Test from Data Conversion Studio', body: 'This is a test email.' }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) window.toast && window.toast('success', 'Test email sent to ' + to);
      else window.toast && window.toast('error', d.detail || 'Send failed');
    } catch (_) { window.toast && window.toast('error', 'Backend unreachable'); }
  }

  function _setField(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  function _getField(id) {
    return (document.getElementById(id)?.value || '').trim();
  }
  function _admStatus(el, state, msg) {
    if (!el) return;
    el.textContent = msg;
    el.className = `conn-status conn-${state}`;
    el.style.display = 'block';
  }

  /* ══════════════════════════════════════════════════════
     Query Examples Panel
     ══════════════════════════════════════════════════════ */
  // ── Query Context (markdown editor per connection) ──────────────────────────

  const _QCTX_TEMPLATE = `## Domain Rules
<!-- Business rules, naming conventions, and data quirks the AI must follow -->
-

## Key Tables
<!-- What each important table represents and when to use it -->
| Table | Purpose |
|-------|---------|
|  |  |

## Column Notes
<!-- Ambiguous columns, lookup codes, enum values, or join keys -->
-

## Example Queries
<!-- Paste working SQL queries as reference. Copy this block for each one.

### [Query Name]
**Purpose**: [what it answers]
**Tables**: [table1, table2]
\`\`\`sql
SELECT ...
\`\`\`
-->

## Filters & Conventions
<!-- Common WHERE conditions, date formats, active-record flags, etc. -->
-`;

  let _qctxInited = false;

  function _initExamplesPanel() {
    if (!_qctxInited) {
      _qctxInited = true;
      _qctxLoadConnections();
      document.getElementById('qctx-conn-select')?.addEventListener('change', _qctxLoad);
      document.getElementById('btn-qctx-save')?.addEventListener('click', _qctxSave);
      document.getElementById('btn-qctx-template')?.addEventListener('click', _qctxInsertTemplate);
    }
    _qctxLoad();
  }

  async function _qctxLoadConnections() {
    try {
      const [sqlRes, sfRes] = await Promise.all([
        fetch(`${API_BASE}/connections?source_type=sql`),
        fetch(`${API_BASE}/connections?source_type=snowflake`)
      ]);
      const list = [
        ...(sqlRes.ok ? await sqlRes.json() : []),
        ...(sfRes.ok  ? await sfRes.json()  : [])
      ];
      const sel = document.getElementById('qctx-conn-select');
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '<option value="">Global (all connections)</option>';
      list.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
      });
      if (prev) sel.value = prev;
    } catch (_) {}
  }

  async function _qctxLoad() {
    const connId   = document.getElementById('qctx-conn-select')?.value || '';
    const editor   = document.getElementById('qctx-editor');
    const statusEl = document.getElementById('qctx-status');
    if (!editor) return;
    if (statusEl) statusEl.style.display = 'none';
    editor.disabled = true;
    editor.value = 'Loading…';
    try {
      const url = `${API_BASE}/admin/query-context` + (connId ? `?conn_id=${connId}` : '');
      const res = await fetch(url);
      const data = res.ok ? await res.json() : {};
      editor.value = data.content || '';
    } catch (_) {
      editor.value = '';
    } finally {
      editor.disabled = false;
    }
  }

  async function _qctxSave() {
    const connId   = document.getElementById('qctx-conn-select')?.value || '';
    const editor   = document.getElementById('qctx-editor');
    const statusEl = document.getElementById('qctx-status');
    if (!editor) return;

    const body = {
      conn_id: connId ? parseInt(connId) : null,
      content: editor.value
    };
    try {
      const res = await fetch(`${API_BASE}/admin/query-context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        if (statusEl) {
          statusEl.textContent = '✓ Saved';
          statusEl.className = 'qctx-status ok';
          statusEl.style.display = '';
          setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
        }
        toast('success', 'Context saved');
      } else {
        const err = await res.json().catch(() => ({}));
        if (statusEl) {
          statusEl.textContent = '✗ ' + (err.detail || 'Save failed');
          statusEl.className = 'qctx-status err';
          statusEl.style.display = '';
        }
      }
    } catch (_) {
      if (statusEl) {
        statusEl.textContent = '✗ Backend not reachable';
        statusEl.className = 'qctx-status err';
        statusEl.style.display = '';
      }
    }
  }

  function _qctxInsertTemplate() {
    const editor = document.getElementById('qctx-editor');
    if (!editor) return;
    if (editor.value.trim() && !confirm('Replace current content with the default template?')) return;
    editor.value = _QCTX_TEMPLATE;
    editor.focus();
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  global.AdminHandler = AdminHandler;

})(window);
