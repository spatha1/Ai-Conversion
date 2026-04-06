/* ═══════════════════════════════════════════════════════════
   xmlGenerator.js
   Generates output XML from the template + mappings + source data.

   Algorithm:
   1. Clone the template DOM.
   2. Walk every element.
   3. For elements with each="SheetName":
        - Collect all mappings whose targetPath starts within
          this element's path and whose eachSheet = SheetName.
        - For every row in that sheet, clone the element,
          fill placeholders, append to parent.
        - Remove the template element.
   4. For non-iterative leaf nodes / attributes with a mapping:
        - Apply the formula using global context (first row or
          static values).
   5. Serialise.

   Formula evaluator supports:
     {ColName}                 – field reference
     {SheetName.ColName}       – explicit sheet reference
     UPPER({x})                – uppercase
     LOWER({x})                – lowercase
     TRIM({x})                 – trim
     CONCAT({a}, " ", {b})     – concatenation
     IF({x}="val","y","n")     – simple conditional
     FORMAT_DATE({x},"fmt")    – date formatting (YYYY-MM-DD etc.)
     LEN({x})                  – string length
     TODAY()                   – current date YYYY-MM-DD
     NOW()                     – current datetime
     "literal"                 – constant string
     {a} + {b}                 – arithmetic

   Exposes: window.XMLGenerator
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const XMLGenerator = {

    /* ── Main entry point ──────────────────────────────── */
    /*
      templateDoc  : parsed XML Document (from XMLHandler)
      mappings     : array of mapping objects (from Mapper)
      sourceSheets : array of { name, columns, rows } (from ExcelHandler)

      Returns: { xml: string, errors: [] }
    */
    generate(templateDoc, mappings, sourceSheets) {
      if (!templateDoc) return { xml: '', errors: ['No XML template loaded.'] };
      if (!mappings || mappings.length === 0) return { xml: '', errors: ['No mappings defined.'] };

      const errors = [];

      // Build sheet lookup: name → sheet
      const sheetMap = {};
      (sourceSheets || []).forEach(s => { sheetMap[s.name] = s; });

      // Clone the template
      const doc = templateDoc.cloneNode(true);
      const root = doc.documentElement;

      // Process iterative nodes first (depth-first, inner to outer handled by recursion)
      _processElement(root, mappings, sheetMap, {}, errors);

      // Serialise
      const serialiser = new XMLSerializer();
      let raw = serialiser.serializeToString(doc);

      // Prettify
      raw = _prettify(raw);

      return { xml: raw, errors };
    },

    /* ── Send to API ───────────────────────────────────── */
    async sendToAPI(xmlString, config) {
      const { url, method, contentType, token, extraHeaders } = config;
      if (!url) throw new Error('API URL is required.');

      const headers = { 'Content-Type': contentType || 'application/xml' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      let extra = {};
      try { if (extraHeaders) extra = JSON.parse(extraHeaders); } catch (_) {}
      Object.assign(headers, extra);

      const t0 = Date.now();
      const response = await fetch(url, {
        method: method || 'POST',
        headers,
        body: xmlString
      });

      const elapsed = Date.now() - t0;
      let body = '';
      try { body = await response.text(); } catch (_) {}

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body,
        elapsed
      };
    }
  };

  /* ══════════════════════════════════════════════════════
     Internal helpers
     ══════════════════════════════════════════════════════ */

  /* Recursively process an element */
  function _processElement(el, mappings, sheetMap, rowCtx, errors) {
    const eachSheet = el.getAttribute ? el.getAttribute('each') : null;

    if (eachSheet && sheetMap[eachSheet]) {
      // ── Iterative node ────────────────────────────────
      const sheet   = sheetMap[eachSheet];
      const parent  = el.parentNode;
      const myPath  = _elPath(el);

      // Mappings that live inside this each scope
      const scopeMappings = mappings.filter(m => m.eachSheet === eachSheet);

      sheet.rows.forEach((row, rowIdx) => {
        const ctx = Object.assign({}, rowCtx, row, { '__ROW_INDEX__': rowIdx + 1 });
        const clone = el.cloneNode(true);
        clone.removeAttribute('each');

        // Fill all text nodes and attributes in the clone
        _fillNode(clone, scopeMappings, sheetMap, ctx, myPath, errors);

        // Recurse for nested each nodes inside the clone
        _processNestedEach(clone, mappings, sheetMap, ctx, errors);

        parent.insertBefore(clone, el);
      });

      parent.removeChild(el);
    } else {
      // ── Non-iterative: fill any direct mappings ───────
      _fillNode(el, mappings.filter(m => !m.eachSheet), sheetMap, rowCtx, _elPath(el), errors);

      // Recurse into children
      [...el.childNodes].forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          _processElement(child, mappings, sheetMap, rowCtx, errors);
        }
      });
    }
  }

  /* Handle nested each inside an already-cloned iterative node */
  function _processNestedEach(el, mappings, sheetMap, parentCtx, errors) {
    // Find direct child elements with each attribute
    [...el.childNodes].forEach(child => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const childEach = child.getAttribute ? child.getAttribute('each') : null;
      if (childEach) {
        _processElement(child, mappings, sheetMap, parentCtx, errors);
      } else {
        _processNestedEach(child, mappings, sheetMap, parentCtx, errors);
      }
    });
  }

  /* Fill text/attribute placeholders in an element (non-recursive on each) */
  function _fillNode(el, mappings, sheetMap, ctx, basePath, errors) {
    // Build path→mapping lookup
    const pathMap = {};
    mappings.forEach(m => { pathMap[m.targetPath] = m; });

    _walkFill(el, pathMap, sheetMap, ctx, '', errors);
  }

  function _walkFill(el, pathMap, sheetMap, ctx, parentPath, errors) {
    if (el.nodeType !== Node.ELEMENT_NODE) return;

    const myPath = parentPath + '/' + el.nodeName;

    // Fill attributes
    if (el.attributes) {
      for (const attr of el.attributes) {
        const attrPath = myPath + '/@' + attr.name;
        const m = pathMap[attrPath];
        if (m && m.formula) {
          try { attr.value = _evalFormula(m.formula, ctx, sheetMap); }
          catch (e) { errors.push(`Attr ${attrPath}: ${e.message}`); }
        } else {
          // Inline placeholder fill even if no explicit mapping
          attr.value = _fillPlaceholders(attr.value, ctx, sheetMap, errors);
        }
      }
    }

    // Fill text content of leaf nodes
    const hasChildElems = [...el.childNodes].some(n => n.nodeType === Node.ELEMENT_NODE);

    if (!hasChildElems) {
      const textPath = myPath;
      const m = pathMap[textPath];
      if (m && m.formula) {
        try { _setTextContent(el, _evalFormula(m.formula, ctx, sheetMap)); }
        catch (e) { errors.push(`Node ${textPath}: ${e.message}`); }
      } else {
        // Inline placeholder fill
        const raw = _getDirectText(el).trim();
        if (raw) _setTextContent(el, _fillPlaceholders(raw, ctx, sheetMap, errors));
      }
    } else {
      [...el.childNodes].forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          _walkFill(child, pathMap, sheetMap, ctx, myPath, errors);
        }
      });
    }
  }

  function _setTextContent(el, value) {
    // Remove existing text nodes and set new value
    [...el.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .forEach(n => el.removeChild(n));
    if (value !== null && value !== undefined) {
      el.appendChild(el.ownerDocument.createTextNode(String(value)));
    }
  }

  function _getDirectText(node) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
    }
    return text;
  }

  /* Inline {placeholder} fill (for nodes without an explicit mapping) */
  function _fillPlaceholders(str, ctx, sheetMap, errors) {
    return str.replace(/\{([^}]+)\}/g, (match, expr) => {
      try { return _evalFormula(match, ctx, sheetMap); }
      catch (e) { errors && errors.push(e.message); return match; }
    });
  }

  /* Build an XPath-like path for an element */
  function _elPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      parts.unshift(cur.nodeName);
      cur = cur.parentNode;
    }
    return '/' + parts.join('/');
  }

  /* ══════════════════════════════════════════════════════
     Formula Evaluator
     ══════════════════════════════════════════════════════ */

  /*
    Evaluates a formula string against a context (row data).
    Supports:
      {ColName}            → ctx[ColName]
      {Sheet.ColName}      → sheetMap[Sheet].rows[0][ColName]
      TODAY()              → current date
      NOW()                → current datetime
      UPPER(expr)          → uppercase
      LOWER(expr)          → lowercase
      TRIM(expr)           → trim
      LEN(expr)            → string length
      CONCAT(a, b, ...)    → join
      IF(cond, then, else) → conditional (string equality or number comparison)
      FORMAT_DATE(val,fmt) → date format
      "literal"            → constant
      arithmetic (+,-,*,/) on numeric values
  */
  function _evalFormula(formula, ctx, sheetMap) {
    if (!formula || !formula.trim()) return '';
    const f = formula.trim();

    // Pure literal string
    if (/^"[^"]*"$/.test(f)) return f.slice(1, -1);

    // TODAY()
    if (/^TODAY\(\)$/i.test(f)) return _todayStr();
    // NOW()
    if (/^NOW\(\)$/i.test(f)) return new Date().toISOString().replace('T', ' ').slice(0, 19);

    // UPPER(...)
    if (/^UPPER\(/i.test(f)) {
      const inner = _extractArg(f, 'UPPER');
      return _evalFormula(inner, ctx, sheetMap).toUpperCase();
    }
    // LOWER(...)
    if (/^LOWER\(/i.test(f)) {
      const inner = _extractArg(f, 'LOWER');
      return _evalFormula(inner, ctx, sheetMap).toLowerCase();
    }
    // TRIM(...)
    if (/^TRIM\(/i.test(f)) {
      const inner = _extractArg(f, 'TRIM');
      return _evalFormula(inner, ctx, sheetMap).trim();
    }
    // LEN(...)
    if (/^LEN\(/i.test(f)) {
      const inner = _extractArg(f, 'LEN');
      return String(_evalFormula(inner, ctx, sheetMap).length);
    }

    // CONCAT(a, b, c, ...)
    if (/^CONCAT\(/i.test(f)) {
      const args = _splitArgs(_extractArg(f, 'CONCAT'));
      return args.map(a => _evalFormula(a.trim(), ctx, sheetMap)).join('');
    }

    // IF(cond, then, else)
    if (/^IF\(/i.test(f)) {
      const args = _splitArgs(_extractArg(f, 'IF'));
      if (args.length < 3) return '';
      const condResult = _evalCondition(args[0].trim(), ctx, sheetMap);
      return condResult
        ? _evalFormula(args[1].trim(), ctx, sheetMap)
        : _evalFormula(args[2].trim(), ctx, sheetMap);
    }

    // FORMAT_DATE(val, format)
    if (/^FORMAT_DATE\(/i.test(f)) {
      const args = _splitArgs(_extractArg(f, 'FORMAT_DATE'));
      if (args.length < 2) return '';
      const dateVal = _evalFormula(args[0].trim(), ctx, sheetMap);
      const fmt = _evalFormula(args[1].trim(), ctx, sheetMap);
      return _formatDate(dateVal, fmt);
    }

    // {ColName} or {Sheet.ColName}
    const placeholderMatch = /^\{([^}]+)\}$/.exec(f);
    if (placeholderMatch) {
      return _resolveField(placeholderMatch[1], ctx, sheetMap);
    }

    // Arithmetic expression: replace {X} and evaluate
    if (/\{[^}]+\}/.test(f)) {
      const expanded = f.replace(/\{([^}]+)\}/g, (_, name) => {
        const v = _resolveField(name, ctx, sheetMap);
        const n = parseFloat(v);
        return isNaN(n) ? JSON.stringify(v) : n;
      });
      // Safe arithmetic evaluation (no eval with arbitrary code)
      try { return String(_safeArith(expanded)); }
      catch (_) { return expanded; }
    }

    // Raw string fallback
    return f;
  }

  function _resolveField(name, ctx, sheetMap) {
    name = name.trim();
    // __ROW_INDEX__ special
    if (name === '__ROW_INDEX__') return String(ctx['__ROW_INDEX__'] || '');

    // Sheet.Column
    if (name.includes('.')) {
      const [sheet, col] = name.split('.', 2);
      const s = sheetMap && sheetMap[sheet];
      if (s && s.rows && s.rows[0]) return String(s.rows[0][col] || '');
      return '';
    }
    // Direct context lookup
    if (ctx && ctx[name] !== undefined) return String(ctx[name]);
    return '';
  }

  /* Safe arithmetic: only allow numbers, operators, parens, spaces */
  function _safeArith(expr) {
    if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expr)) return expr;
    // Use Function constructor but only with a clean numeric expression
    return Function('"use strict"; return (' + expr + ')')();
  }

  /* Evaluate a simple condition: a=b, a!=b, a>b, a<b */
  function _evalCondition(cond, ctx, sheetMap) {
    // Try a=b pattern (with optional spaces)
    const eqMatch = /^(.+?)\s*=\s*(.+)$/.exec(cond);
    if (eqMatch) {
      const lhs = _evalFormula(eqMatch[1].trim(), ctx, sheetMap);
      const rhs = _evalFormula(eqMatch[2].trim(), ctx, sheetMap);
      return lhs === rhs;
    }
    // Truthy check
    const val = _evalFormula(cond, ctx, sheetMap);
    return val !== '' && val !== '0' && val !== 'false';
  }

  /* Extract inner argument from FNAME(args) */
  function _extractArg(f, fname) {
    const start = fname.length + 1; // skip "FNAME("
    const end = _matchingParen(f, start - 1);
    return f.slice(start, end);
  }

  /* Find matching closing paren position */
  function _matchingParen(s, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return s.length;
  }

  /* Split function args by comma, respecting nested parens and quotes */
  function _splitArgs(s) {
    const args = [];
    let cur = '', depth = 0, inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { inQ = !inQ; cur += c; }
      else if (!inQ && c === '(') { depth++; cur += c; }
      else if (!inQ && c === ')') { depth--; cur += c; }
      else if (!inQ && c === ',' && depth === 0) { args.push(cur); cur = ''; }
      else { cur += c; }
    }
    if (cur.trim()) args.push(cur);
    return args;
  }

  /* Date helpers */
  function _todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function _formatDate(val, fmt) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d)) return val;
    const pad = n => String(n).padStart(2, '0');
    return fmt
      .replace('YYYY', d.getFullYear())
      .replace('MM', pad(d.getMonth() + 1))
      .replace('DD', pad(d.getDate()))
      .replace('HH', pad(d.getHours()))
      .replace('mm', pad(d.getMinutes()))
      .replace('ss', pad(d.getSeconds()));
  }

  /* ══════════════════════════════════════════════════════
     XML Prettifier
     ══════════════════════════════════════════════════════ */
  function _prettify(xml) {
    // Remove XML declaration added by serialiser (we add our own)
    xml = xml.replace(/<\?xml[^?]*\?>\s*/i, '');
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;

    // Basic indent by splitting on tags
    let result = '', indent = 0;
    const TAB = '  ';

    xml.split(/>\s*</).forEach((node, i) => {
      if (i > 0) node = '<' + node;
      if (i < xml.split(/>\s*</).length - 1) node += '>';

      // Closing tag
      if (/^<\//.test(node)) indent = Math.max(0, indent - 1);

      result += TAB.repeat(indent) + node.trim() + '\n';

      // Opening tag (not self-closing, not closing, not declaration)
      if (!/^\s*<\//.test(node) && !/\/>$/.test(node) && /^<[^?!]/.test(node)) {
        indent++;
      }
    });

    return result;
  }

  /* ══════════════════════════════════════════════════════
     Syntax highlighter for display
     ══════════════════════════════════════════════════════ */
  XMLGenerator.highlight = function (xml) {
    const esc = s => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return esc(xml)
      // Processing instructions
      .replace(/(&lt;\?xml[^?]*\?&gt;)/g,
        '<span class="xml-out-pi">$1</span>')
      // Comments
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g,
        '<span class="xml-out-comment">$1</span>')
      // Closing tags
      .replace(/(&lt;\/)([\w:\-]+)(&gt;)/g,
        '<span class="xml-out-tag">$1$2$3</span>')
      // Opening/self-closing tags (tag name + attrs)
      .replace(/(&lt;)([\w:\-]+)((?:\s[\w:\-]+="[^"]*")*\s*\/?&gt;)/g,
        (_, lt, name, rest) => {
          const attrs = rest.replace(/([\w:\-]+)=("[^"]*")/g,
            '<span class="xml-out-attr-name">$1</span>=<span class="xml-out-attr-val">$2</span>');
          return `<span class="xml-out-tag">${lt}${name}</span>${attrs}`;
        });
  };

  global.XMLGenerator = XMLGenerator;
})(window);
