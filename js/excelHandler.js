/* ═══════════════════════════════════════════════════════════
   excelHandler.js
   Parses Excel / CSV files using SheetJS and renders a data grid.
   Exposes: window.ExcelHandler
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── State ────────────────────────────────────────────── */
  let _sheets = [];          // [{ name, columns:[], rows:[] }]
  let _activeSheet = 0;

  /* ── Public API ───────────────────────────────────────── */
  const ExcelHandler = {
    sheets: [],              // shared reference updated on parse

    /* Parse a File object and render the grid */
    async parseFile(file, opts = {}) {
      _sheets = [];
      ExcelHandler.sheets = _sheets;
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'csv') {
        await _parseCSV(file);   // SheetJS with BOM-strip + delimiter detection
      } else {
        await _parseExcel(file); // SheetJS binary
      }

      if (_sheets.length === 0) throw new Error('No readable sheets found.');
      _activeSheet = 0;
      ExcelHandler.sheets = _sheets;
      return _sheets;
    },

    /* Render viewer for the given sheets array */
    renderViewer(sheets, containerId = 'data-grid-container',
                 sheetTabsId = 'sheet-tabs') {
      _sheets = sheets;
      ExcelHandler.sheets = sheets;
      _activeSheet = 0;
      _renderSheetTabs(sheetTabsId);
      _renderGrid(_sheets[0], containerId);
      _updateBadges(_sheets[0]);
    },

    /* Get all source fields as {sheet, column} pairs */
    getSourceFields() {
      const fields = [];
      for (const sheet of _sheets) {
        for (const col of sheet.columns) {
          fields.push({ sheet: sheet.name, column: col });
        }
      }
      return fields;
    },

    /* Get a specific sheet by name */
    getSheet(name) {
      return _sheets.find(s => s.name === name) || null;
    }
  };

  /* ── Excel / CSV Parsing (all via SheetJS) ───────────── */
  async function _parseExcel(file) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    _sheetsFromWorkbook(wb);
  }

  async function _parseCSV(file) {
    // Read as ArrayBuffer so SheetJS handles BOM + any encoding correctly
    const buffer = await file.arrayBuffer();

    // Try SheetJS first — it auto-detects comma / tab / semicolon delimiters
    try {
      const wb = XLSX.read(buffer, {
        type: 'array',
        raw: false,
        // SheetJS treats .csv as a single-sheet workbook
      });
      _sheetsFromWorkbook(wb, file.name.replace(/\.csv$/i, ''));
      return;
    } catch (_) { /* fall through to manual parse */ }

    // Fallback: manual parse with delimiter detection
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, ''); // strip BOM
    _parseCSVText(text, file.name.replace(/\.csv$/i, ''));
  }

  /* Convert a SheetJS workbook into our _sheets array */
  function _sheetsFromWorkbook(wb, forceName) {
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        raw: false,
        dateNF: 'YYYY-MM-DD'
      });
      if (raw.length === 0) continue;

      // Skip rows that are entirely empty
      const nonEmpty = raw.filter(r => r.some(c => String(c).trim() !== ''));
      if (nonEmpty.length === 0) continue;

      const headers = (nonEmpty[0] || []).map((h, i) =>
        String(h).trim().replace(/^\uFEFF/, '') || `Col${i + 1}`  // strip per-cell BOM
      );

      const rows = nonEmpty.slice(1).map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? String(r[i]) : ''; });
        return obj;
      });

      _sheets.push({ name: forceName || sheetName, columns: headers, rows });
    }
  }

  /* Manual CSV fallback with delimiter detection */
  function _parseCSVText(text, sheetName) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return;

    // Detect delimiter: count occurrences of , \t ; in first line
    const first = lines[0];
    const delim = [',', '\t', ';'].reduce((best, d) =>
      (first.split(d).length > first.split(best).length ? d : best), ',');

    const split = line => {
      const res = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === delim && !inQ) { res.push(cur); cur = ''; }
        else { cur += c; }
      }
      res.push(cur);
      return res;
    };

    const headers = split(lines[0]).map((h, i) =>
      h.trim().replace(/^\uFEFF/, '') || `Col${i + 1}`
    );
    const rows = lines.slice(1).map(line => {
      const cells = split(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
      return obj;
    });

    _sheets.push({ name: sheetName, columns: headers, rows });
  }

  /* ── Sheet Tabs ───────────────────────────────────────── */
  function _renderSheetTabs(tabsId) {
    const container = document.getElementById(tabsId);
    if (!container) return;
    container.innerHTML = '';
    _sheets.forEach((sheet, idx) => {
      const tab = document.createElement('button');
      tab.className = 'sheet-tab' + (idx === 0 ? ' active' : '');
      tab.textContent = sheet.name;
      tab.addEventListener('click', () => {
        _activeSheet = idx;
        container.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _renderGrid(_sheets[idx], 'data-grid-container');
        _updateBadges(_sheets[idx]);
      });
      container.appendChild(tab);
    });
  }

  /* ── Data Grid ────────────────────────────────────────── */
  function _renderGrid(sheet, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const MAX_ROWS = 500; // display cap
    const rows = sheet.rows.slice(0, MAX_ROWS);

    const table = document.createElement('table');
    // Header
    const thead = table.createTHead();
    const hr = thead.insertRow();
    const th0 = document.createElement('th');
    th0.textContent = '#';
    hr.appendChild(th0);
    sheet.columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col;
      th.title = col;
      hr.appendChild(th);
    });

    // Body
    const tbody = table.createTBody();
    rows.forEach((row, ri) => {
      const tr = tbody.insertRow();
      const td0 = tr.insertCell();
      td0.textContent = ri + 1;
      sheet.columns.forEach(col => {
        const td = tr.insertCell();
        const val = row[col] !== undefined ? row[col] : '';
        td.textContent = val;
        td.title = val;
      });
    });

    if (sheet.rows.length > MAX_ROWS) {
      const tr = tbody.insertRow();
      const td = tr.insertCell();
      td.colSpan = sheet.columns.length + 1;
      td.style.cssText = 'text-align:center;color:#94a3b8;padding:8px;font-style:italic;font-size:11px';
      td.textContent = `Showing first ${MAX_ROWS} of ${sheet.rows.length} rows`;
    }

    container.innerHTML = '';
    container.appendChild(table);
  }

  /* ── Badge Update ─────────────────────────────────────── */
  function _updateBadges(sheet) {
    const rowBadge = document.getElementById('excel-row-count');
    const colBadge = document.getElementById('excel-col-count');
    if (rowBadge) rowBadge.textContent = `${sheet.rows.length} rows`;
    if (colBadge) colBadge.textContent = `${sheet.columns.length} cols`;
  }

  global.ExcelHandler = ExcelHandler;
})(window);
