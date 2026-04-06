/* ═══════════════════════════════════════════════════════════
   sourceConnector.js
   Manages the Source tab: type selector (File / SQL / Snowflake),
   connection forms, Test Connection, Preview Data.

   Preview calls POST /api/sources/test and /api/sources/preview.
   If the backend is not running it shows an actionable notice —
   no crash, the rest of the UI keeps working.

   Exposes: window.SourceConnector
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── Config ───────────────────────────────────────────── */
  const API_BASE = 'http://localhost:8000/api';

  const DIALECT_PORTS = {
    postgresql: '5432',
    mysql:      '3306',
    mssql:      '1433',
    sqlite:     ''
  };

  /* ── Public API ───────────────────────────────────────── */
  const SourceConnector = {
    currentType: 'sql',    // 'sql' | 'snowflake' | 'chat'
    apiBase: API_BASE,

    init() {
      _initTypeSelector();
      _initSQLForm();
      _initSnowflakeForm();
      _initChangeSourceBtn();
      _initSaveButtons();
      _pingBackend();
    }
  };

  /* ══════════════════════════════════════════════════════
     Source type selector (segmented bar)
     ══════════════════════════════════════════════════════ */
  function _initTypeSelector() {
    document.querySelectorAll('.src-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.src-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;
        SourceConnector.currentType = type;
        document.querySelectorAll('.source-pane').forEach(p => {
          p.style.display = 'none';
        });
        document.getElementById('src-pane-' + type).style.display = 'block';
        // Hide the grid viewer when switching type
        const viewer = document.getElementById('excel-viewer');
        if (viewer) viewer.style.display = 'none';
        // Auto-load saved connections when switching to SQL or Snowflake
        if (type === 'sql' || type === 'snowflake') {
          _loadSavedConnections(type);
        }
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     SQL form
     ══════════════════════════════════════════════════════ */
  function _initSQLForm() {
    const dialectSel = document.getElementById('sql-dialect');
    const portInput  = document.getElementById('sql-port');

    if (dialectSel) {
      dialectSel.addEventListener('change', () => {
        const d = dialectSel.value;
        if (portInput) portInput.value = DIALECT_PORTS[d] || '';

        const isSQLite = d === 'sqlite';
        const hostGroup = document.getElementById('sql-host-group');
        const authGroup = document.getElementById('sql-auth-group');
        const hostLabel = document.getElementById('sql-host-label');

        if (hostGroup) hostGroup.style.display = isSQLite ? 'none' : '';
        if (authGroup) authGroup.style.display = isSQLite ? 'none' : '';
        if (hostLabel) hostLabel.textContent   = isSQLite ? 'Database File Path' : 'Host';

        // For SQLite move file path into the database field label
        const dbLabel = document.querySelector('label[for="sql-database"]') ||
                        document.getElementById('sql-database')?.previousElementSibling;
        if (dbLabel) dbLabel.textContent = isSQLite ? 'Database File Path' : 'Database / File Path';
      });
    }

    _initConnDropdown('sql');

    document.getElementById('btn-sql-test')?.addEventListener('click', () =>
      _testConnection('sql'));
    document.getElementById('btn-sql-preview')?.addEventListener('click', () =>
      _previewData('sql'));
  }

  /* ══════════════════════════════════════════════════════
     Snowflake form
     ══════════════════════════════════════════════════════ */
  function _initSnowflakeForm() {
    document.querySelectorAll('.sf-auth-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sf-auth-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const authType       = btn.dataset.auth;
        const pwGroup        = document.getElementById('sf-password-group');
        const keyGroup       = document.getElementById('sf-key-group');
        const passphraseGroup= document.getElementById('sf-passphrase-group');
        if (pwGroup)         pwGroup.style.display        = authType === 'password' ? '' : 'none';
        if (keyGroup)        keyGroup.style.display        = authType === 'key'      ? '' : 'none';
        if (passphraseGroup) passphraseGroup.style.display = authType === 'key'      ? '' : 'none';
      });
    });

    _initConnDropdown('snowflake');

    document.getElementById('btn-sf-test')?.addEventListener('click', () =>
      _testConnection('snowflake'));
    document.getElementById('btn-sf-preview')?.addEventListener('click', () =>
      _previewData('snowflake'));
  }

  /* ══════════════════════════════════════════════════════
     Connection Name dropdown — auto-fill on selection
     ══════════════════════════════════════════════════════ */
  function _initConnDropdown(type) {
    const prefix       = type === 'sql' ? 'sql' : 'sf';
    const sel          = document.getElementById(`${prefix}-conn-name`);
    const newNameInput = document.getElementById(`${prefix}-conn-new-name`);
    if (!sel) return;

    sel.addEventListener('change', async () => {
      const id = sel.value;
      if (!id) {
        // New connection: show name input, clear form fields
        if (newNameInput) newNameInput.style.display = '';
        _clearForm(type);
      } else {
        // Existing connection: hide name input, fill form
        if (newNameInput) newNameInput.style.display = 'none';
        try {
          const res = await fetch(`${API_BASE}/connections/${id}`);
          if (res.ok) _fillForm(await res.json(), type);
        } catch (_) { /* backend offline */ }
      }
    });
  }

  function _clearForm(type) {
    if (type === 'sql') {
      ['sql-host', 'sql-port', 'sql-database', 'sql-schema',
       'sql-username', 'sql-password', 'sql-query', 'sql-alias'].forEach(id => _val(id, ''));
    } else {
      ['sf-account', 'sf-warehouse', 'sf-role', 'sf-database', 'sf-schema',
       'sf-username', 'sf-password', 'sf-private-key', 'sf-passphrase', 'sf-query', 'sf-alias'].forEach(id => _val(id, ''));
    }
  }

  /* ══════════════════════════════════════════════════════
     "Change Source" button — goes back to the upload pane
     ══════════════════════════════════════════════════════ */
  function _initChangeSourceBtn() {
    document.getElementById('btn-change-source')?.addEventListener('click', () => {
      document.getElementById('excel-viewer').style.display = 'none';
      const type = SourceConnector.currentType;
      document.getElementById('src-pane-' + type).style.display = 'block';
    });
  }

  /* ══════════════════════════════════════════════════════
     Build config objects
     ══════════════════════════════════════════════════════ */
  function _buildSQLConfig() {
    const dialect = document.getElementById('sql-dialect')?.value || 'postgresql';
    return {
      source_type: 'sql',
      dialect,
      host:         document.getElementById('sql-host')?.value.trim()     || '',
      port:         parseInt(document.getElementById('sql-port')?.value)  || null,
      database:     document.getElementById('sql-database')?.value.trim() || '',
      schema:       document.getElementById('sql-schema')?.value.trim()   || '',
      username:     document.getElementById('sql-username')?.value.trim() || '',
      password:     document.getElementById('sql-password')?.value        || '',
      query:        document.getElementById('sql-query')?.value.trim()    || '',
      sheet_alias:  (document.getElementById('sql-alias')?.value.trim()   || 'Sheet1')
    };
  }

  function _buildSnowflakeConfig() {
    const authType = document.querySelector('.sf-auth-btn.active')?.dataset.auth || 'password';
    return {
      source_type:  'snowflake',
      account:      document.getElementById('sf-account')?.value.trim()      || '',
      warehouse:    document.getElementById('sf-warehouse')?.value.trim()     || '',
      database:     document.getElementById('sf-database')?.value.trim()      || '',
      schema:       document.getElementById('sf-schema')?.value.trim()        || '',
      role:         document.getElementById('sf-role')?.value.trim()          || '',
      username:     document.getElementById('sf-username')?.value.trim()      || '',
      password:     authType === 'password'
                      ? (document.getElementById('sf-password')?.value || '')
                      : null,
      private_key:  authType === 'key'
                      ? (document.getElementById('sf-private-key')?.value.trim() || null)
                      : null,
      private_key_passphrase: authType === 'key'
                      ? (document.getElementById('sf-passphrase')?.value || null)
                      : null,
      query:        document.getElementById('sf-query')?.value.trim()         || '',
      sheet_alias:  (document.getElementById('sf-alias')?.value.trim()        || 'Sheet1')
    };
  }

  /* ══════════════════════════════════════════════════════
     Test Connection
     ══════════════════════════════════════════════════════ */
  async function _testConnection(type) {
    const prefix = type === 'sql' ? 'sql' : 'sf';
    const btn      = document.getElementById(`btn-${prefix}-test`);
    const statusEl = document.getElementById(`${prefix}-conn-status`);

    _setStatus(statusEl, 'testing', '⏳ Testing connection…');
    if (btn) btn.disabled = true;

    try {
      const config = type === 'sql' ? _buildSQLConfig() : _buildSnowflakeConfig();

      if (!_validateConfig(config, statusEl)) { if (btn) btn.disabled = false; return; }

      const res  = await _apiFetch('/sources/test', config);
      const data = await res.json();

      if (res.ok) {
        _setStatus(statusEl, 'ok', `✓ Connected — ${data.message || 'Success'}`);
        toast('success', `${type === 'sql' ? 'SQL' : 'Snowflake'} connection successful`);
      } else {
        _setStatus(statusEl, 'error', `✗ ${data.detail || 'Connection failed'}`);
      }
    } catch (err) {
      _handleNetworkError(err, statusEl);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ══════════════════════════════════════════════════════
     Preview Data  →  load into grid
     ══════════════════════════════════════════════════════ */
  async function _previewData(type) {
    const prefix = type === 'sql' ? 'sql' : 'sf';
    const btn      = document.getElementById(`btn-${prefix}-preview`);
    const statusEl = document.getElementById(`${prefix}-conn-status`);

    _setStatus(statusEl, 'testing', '⏳ Fetching preview…');
    if (btn) btn.disabled = true;

    try {
      const config = type === 'sql' ? _buildSQLConfig() : _buildSnowflakeConfig();

      if (!_validateConfig(config, statusEl)) { if (btn) btn.disabled = false; return; }

      const res = await _apiFetch('/sources/preview', config);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        _setStatus(statusEl, 'error', `✗ ${data.detail || 'Preview failed'}`);
        if (btn) btn.disabled = false;
        return;
      }

      /* Expected response: { columns: string[], rows: object[], total: number } */
      const data = await res.json();
      const alias = config.sheet_alias;

      /* Build a sheet compatible with ExcelHandler */
      const sheet = { name: alias, columns: data.columns, rows: data.rows };

      /* Inject into ExcelHandler and render */
      ExcelHandler.sheets = [sheet];
      ExcelHandler.renderViewer([sheet], 'data-grid-container', 'sheet-tabs');

      /* Show the shared viewer, hide the form pane */
      document.getElementById(`src-pane-${type}`).style.display = 'none';
      document.getElementById('excel-viewer').style.display     = 'block';

      /* Update source-type badge in viewer toolbar */
      const badge = document.getElementById('source-type-badge');
      if (badge) {
        badge.textContent = type === 'sql' ? '🗄 SQL' : '❄ Snowflake';
        badge.style.display = 'inline-flex';
      }

      /* Notify app.js that source is loaded */
      if (typeof window._onSourceLoaded === 'function') window._onSourceLoaded();

      _setStatus(statusEl, 'ok', `✓ ${data.rows.length} row(s) loaded as "${alias}"`);
      toast('success', `${data.rows.length} rows previewed — sheet "${alias}" ready`);

    } catch (err) {
      _handleNetworkError(err, statusEl);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ══════════════════════════════════════════════════════
     Helpers
     ══════════════════════════════════════════════════════ */
  function _apiFetch(path, body) {
    return fetch(API_BASE + path, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
  }

  function _validateConfig(config, statusEl) {
    if (config.source_type === 'sql') {
      if (!config.database) {
        _setStatus(statusEl, 'error', '✗ Database / file path is required');
        return false;
      }
      if (config.dialect !== 'sqlite' && !config.host) {
        _setStatus(statusEl, 'error', '✗ Host is required');
        return false;
      }
    }
    if (config.source_type === 'snowflake') {
      if (!config.account || !config.warehouse || !config.database || !config.username) {
        _setStatus(statusEl, 'error', '✗ Account, warehouse, database and username are required');
        return false;
      }
    }
    if (!config.query) {
      _setStatus(statusEl, 'error', '✗ SQL query is required');
      return false;
    }
    return true;
  }

  function _handleNetworkError(err, statusEl) {
    if (err instanceof TypeError || (err.message && err.message.toLowerCase().includes('fetch'))) {
      _setStatus(statusEl, 'offline',
        '⚠ Backend not running — run: uvicorn api.main:app --reload (Phase 2a)');
      toast('warning', 'Python API not running. Fill in connection details now — they will work once Phase 2a is set up.');
    } else {
      _setStatus(statusEl, 'error', '✗ ' + err.message);
      toast('error', err.message);
    }
  }

  function _setStatus(el, state, msg) {
    if (!el) return;
    el.textContent = msg;
    el.className   = `conn-status conn-${state}`;
    el.style.display = 'block';
  }

  /* ══════════════════════════════════════════════════════
     Save Connection button (appears after test/preview)
     ══════════════════════════════════════════════════════ */
  function _initSaveButtons() {
    document.getElementById('btn-sql-save')?.addEventListener('click', () => _saveConnection('sql'));
    document.getElementById('btn-sf-save')?.addEventListener('click',  () => _saveConnection('snowflake'));
  }

  async function _saveConnection(type) {
    const prefix       = type === 'sql' ? 'sql' : 'sf';
    const statusEl     = document.getElementById(`${prefix}-conn-status`);
    const sel          = document.getElementById(`${prefix}-conn-name`);
    const newNameInput = document.getElementById(`${prefix}-conn-new-name`);

    const existingId = sel?.value || '';
    const name = existingId
      ? (sel.options[sel.selectedIndex]?.textContent || '').trim()
      : (newNameInput?.value || '').trim();

    if (!name) {
      _setStatus(statusEl, 'error', 'Enter a Connection Name before saving');
      newNameInput?.focus();
      return;
    }

    const cfg  = type === 'sql' ? _buildSQLConfig() : _buildSnowflakeConfig();
    const body = type === 'sql'
      ? { name, source_type: 'sql', dialect: cfg.dialect, host: cfg.host,
          port: cfg.port, database_name: cfg.database, schema_name: cfg.schema,
          username: cfg.username, password: cfg.password,
          query_text: cfg.query, sheet_alias: cfg.sheet_alias }
      : { name, source_type: 'snowflake', sf_account: cfg.account,
          sf_warehouse: cfg.warehouse, sf_role: cfg.role,
          sf_database: cfg.database, sf_schema: cfg.schema,
          sf_username: cfg.username, sf_password: cfg.password,
          sf_private_key: cfg.private_key,
          sf_private_key_passphrase: cfg.private_key_passphrase,
          query_text: cfg.query, sheet_alias: cfg.sheet_alias };

    const url    = existingId ? `${API_BASE}/connections/${existingId}` : `${API_BASE}/connections`;
    const method = existingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const saved = await res.json();
        const verb  = existingId ? 'Updated' : 'Saved';
        _setStatus(statusEl, 'ok', `✓ ${verb} "${name}"`);
        toast('success', `Connection "${name}" ${verb.toLowerCase()}`);
        await _loadSavedConnections(type);
        if (sel) sel.value = String(saved.id);
        if (newNameInput) { newNameInput.value = ''; newNameInput.style.display = 'none'; }
      } else {
        const err = await res.json().catch(() => ({}));
        _setStatus(statusEl, 'error', '✗ Save failed: ' + (err.detail || res.statusText));
      }
    } catch (err) {
      _handleNetworkError(err, statusEl);
    }
  }

  /* ── Load saved connections into the select dropdown ────── */
  async function _loadSavedConnections(type) {
    const prefix = type === 'sql' ? 'sql' : 'sf';
    const sel    = document.getElementById(`${prefix}-conn-name`);
    if (!sel) return;

    try {
      const res  = await fetch(`${API_BASE}/connections?source_type=${type}`);
      if (!res.ok) return;
      const list = await res.json();

      const current = sel.value; // preserve selection across refresh
      sel.innerHTML  = '<option value="">-- New Connection --</option>';
      list.forEach(c => {
        const opt      = document.createElement('option');
        opt.value      = String(c.id);
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
      if (current) sel.value = current; // restore if still present

      // Sync the new-name input visibility
      const newNameInput = document.getElementById(`${prefix}-conn-new-name`);
      if (newNameInput) newNameInput.style.display = sel.value ? 'none' : '';
    } catch (_) { /* backend offline — silently skip */ }
  }

  async function _previewStored(connId, type) {
    const statusEl = document.getElementById(type === 'sql' ? 'sql-conn-status' : 'sf-conn-status');
    _setStatus(statusEl, 'testing', '⏳ Fetching preview from saved connection…');
    try {
      const res  = await fetch(`${API_BASE}/connections/${connId}/preview`, { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        _setStatus(statusEl, 'error', '✗ ' + (e.detail || 'Preview failed'));
        return;
      }
      const data = await res.json();
      const sheet = { name: data.sheet_alias, columns: data.columns, rows: data.rows };
      ExcelHandler.sheets = [sheet];
      ExcelHandler.renderViewer([sheet], 'data-grid-container', 'sheet-tabs');
      document.getElementById(`src-pane-${type}`).style.display = 'none';
      document.getElementById('excel-viewer').style.display     = 'block';
      if (typeof window._onSourceLoaded === 'function') window._onSourceLoaded();
      _setStatus(statusEl, 'ok', `✓ ${data.rows.length} rows loaded`);
      toast('success', `${data.rows.length} rows from saved connection "${data.sheet_alias}"`);
    } catch (err) {
      _handleNetworkError(err, statusEl);
    }
  }

  function _fillForm(c, type) {
    if (type === 'sql') {
      const sqlSel = document.getElementById('sql-conn-name');
      if (sqlSel && c.id) sqlSel.value = String(c.id);
      _val('sql-dialect',   c.dialect       || 'mssql');
      _val('sql-host',      c.host          || '');
      _val('sql-port',      c.port          || 1433);
      _val('sql-database',  c.database_name || '');
      _val('sql-schema',    c.schema_name   || '');
      _val('sql-username',  c.username      || '');
      _val('sql-alias',     c.sheet_alias   || '');
      _val('sql-query',     c.query_text    || '');
      // trigger dialect change to show/hide SQLite-specific fields
      document.getElementById('sql-dialect')?.dispatchEvent(new Event('change'));
    } else {
      const sfSel = document.getElementById('sf-conn-name');
      if (sfSel && c.id) sfSel.value = String(c.id);
      _val('sf-account',    c.sf_account    || '');
      _val('sf-warehouse',  c.sf_warehouse  || '');
      _val('sf-role',       c.sf_role       || '');
      _val('sf-database',   c.sf_database   || '');
      _val('sf-schema',     c.sf_schema     || '');
      _val('sf-username',   c.sf_username   || '');
      _val('sf-alias',      c.sheet_alias   || '');
      _val('sf-query',      c.query_text    || '');
    }
  }

  function _val(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Ping backend to update header status dot ─────────── */
  async function _pingBackend() {
    const dot   = document.querySelector('.status-dot');
    const label = document.getElementById('project-status');
    try {
      const res = await fetch(API_BASE + '/health', { method: 'GET' });
      if (res.ok) {
        if (dot)   dot.className   = 'status-dot dot-online';
        if (label) label.innerHTML = '<span class="status-dot dot-online"></span>API Connected';
        // Load saved connections for both panes once backend is up
        _loadSavedConnections('sql');
        _loadSavedConnections('snowflake');
      }
    } catch (_) {
      /* backend not running — default offline state already shown */
    }
  }

  global.SourceConnector = SourceConnector;
})(window);
