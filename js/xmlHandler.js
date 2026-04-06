/* ═══════════════════════════════════════════════════════════
   xmlHandler.js
   Parses an XML template, builds a tree view, and extracts
   all mappable paths.

   Template conventions:
     each="SheetName"  → iterative node (loops over sheet rows)
     {ColumnName}      → placeholder in text / attribute value

   Exposes: window.XMLHandler
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── State ────────────────────────────────────────────── */
  let _templateDoc = null;   // parsed DOM
  let _templateRaw = '';     // raw XML string
  let _paths = [];           // extracted mappable paths

  /* ── Public API ───────────────────────────────────────── */
  const XMLHandler = {
    templateDoc: null,
    templateRaw: '',
    paths: [],

    /* Parse an XML File and render */
    async parseFile(file) {
      _templateRaw = await file.text();
      return XMLHandler.parseString(_templateRaw);
    },

    /* Parse an XML string directly */
    parseString(xmlString) {
      _templateRaw = xmlString;
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'application/xml');
      const errNode = doc.querySelector('parsererror');
      if (errNode) throw new Error('XML parse error: ' + errNode.textContent.slice(0, 200));
      _templateDoc = doc;
      XMLHandler.templateDoc = doc;
      XMLHandler.templateRaw = xmlString;

      // Deduplicate by path — repeated nodes (e.g. <Order each="Orders">) produce duplicate paths
      const _rawPaths = _extractPaths(doc.documentElement, '', null);
      const _seen = new Set();
      _paths = _rawPaths.filter(p => { if (_seen.has(p.path)) return false; _seen.add(p.path); return true; });
      XMLHandler.paths = _paths;

      return { doc, paths: _paths };
    },

    /* Render tree into container */
    renderTree(treeContainerId = 'xml-tree', pathsContainerId = 'xml-paths-list') {
      _renderTree(_templateDoc.documentElement, document.getElementById(treeContainerId));
      _renderPathsList(document.getElementById(pathsContainerId));

      const nodeBadge = document.getElementById('xml-node-count');
      const pathBadge = document.getElementById('xml-path-count');
      if (nodeBadge) nodeBadge.textContent = _countNodes(_templateDoc.documentElement) + ' nodes';
      if (pathBadge) pathBadge.textContent = _paths.length + ' paths';
    },

    getPaths() { return _paths; },
    getTemplateDoc() { return _templateDoc; },
    getTemplateRaw() { return _templateRaw; }
  };

  /* ── Extract Mappable Paths ───────────────────────────── */
  /*
    Returns [{
      path,           // e.g. "/Root/Orders/Order/ID"
      eachSheet,      // inherited each="…" scope, or null
      isAttr,         // true if attribute
      attrName,       // attribute name if isAttr
      hasPlaceholder, // has {…} in template
      placeholder,    // e.g. "{OrderID}"
    }]
  */
  function _extractPaths(node, parentPath, inheritedEach) {
    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const myEach = node.getAttribute ? node.getAttribute('each') : null;
    const eachSheet = myEach || inheritedEach;
    const myPath = parentPath + '/' + node.nodeName;

    const results = [];

    // Attributes (excluding "each" itself)
    if (node.attributes) {
      for (const attr of node.attributes) {
        if (attr.name === 'each') continue;
        const ph = _extractPlaceholders(attr.value);
        results.push({
          path: myPath + '/@' + attr.name,
          eachSheet,
          isAttr: true,
          attrName: attr.name,
          hasPlaceholder: ph.length > 0,
          placeholder: ph[0] || attr.value,
          rawValue: attr.value
        });
      }
    }

    // Text content (leaf nodes only or nodes with direct text)
    const textContent = _getDirectText(node).trim();
    const hasChildren = [...node.childNodes].some(n => n.nodeType === Node.ELEMENT_NODE);

    if (textContent && !hasChildren) {
      const ph = _extractPlaceholders(textContent);
      results.push({
        path: myPath,
        eachSheet,
        isAttr: false,
        hasPlaceholder: ph.length > 0,
        placeholder: ph[0] || textContent,
        rawValue: textContent
      });
    } else if (!hasChildren) {
      // Empty leaf - still mappable
      results.push({
        path: myPath,
        eachSheet,
        isAttr: false,
        hasPlaceholder: false,
        placeholder: '',
        rawValue: ''
      });
    }

    // Recurse into child elements
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        results.push(..._extractPaths(child, myPath, eachSheet));
      }
    }

    return results;
  }

  function _getDirectText(node) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
    }
    return text;
  }

  function _extractPlaceholders(str) {
    const matches = [];
    const re = /\{[^}]+\}/g;
    let m;
    while ((m = re.exec(str)) !== null) matches.push(m[0]);
    return matches;
  }

  /* ── Tree Rendering ───────────────────────────────────── */
  function _renderTree(node, container) {
    if (!container) return;
    container.innerHTML = '';
    _buildTreeNode(node, container, '');
  }

  function _buildTreeNode(node, parent, indent) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'xml-node';

    const row = document.createElement('div');
    row.className = 'xml-node-row';

    const hasChildren = [...node.childNodes].some(n => n.nodeType === Node.ELEMENT_NODE);
    const eachAttr = node.getAttribute ? node.getAttribute('each') : null;

    // Toggle button
    const toggle = document.createElement('span');
    toggle.className = 'xml-toggle';
    toggle.textContent = hasChildren ? '▼' : ' ';
    row.appendChild(toggle);

    // Tag name
    const tag = document.createElement('span');
    tag.className = 'xml-node-tag';
    tag.textContent = '<' + node.nodeName;
    row.appendChild(tag);

    // Attributes
    if (node.attributes) {
      for (const attr of node.attributes) {
        const attrSpan = document.createElement('span');
        attrSpan.className = 'xml-node-attr';
        attrSpan.textContent = ` ${attr.name}="${attr.value}"`;
        row.appendChild(attrSpan);
      }
    }

    const tagClose = document.createElement('span');
    tagClose.className = 'xml-node-tag';
    tagClose.textContent = hasChildren ? '>' : '/>';
    row.appendChild(tagClose);

    // each badge
    if (eachAttr) {
      const badge = document.createElement('span');
      badge.className = 'xml-node-each';
      badge.textContent = '↻ each: ' + eachAttr;
      row.appendChild(badge);
    }

    // Text content preview
    const text = _getDirectText(node).trim();
    if (text && !hasChildren) {
      const textSpan = document.createElement('span');
      textSpan.className = 'xml-node-text';
      textSpan.textContent = ' ' + text;
      row.appendChild(textSpan);
    }

    wrapper.appendChild(row);

    // Children container
    if (hasChildren) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'xml-node-children';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          _buildTreeNode(child, childrenDiv, indent + '  ');
        }
      }
      wrapper.appendChild(childrenDiv);

      // Toggle behaviour
      toggle.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const collapsed = childrenDiv.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '▶' : '▼';
      });
    }

    parent.appendChild(wrapper);
  }

  /* ── Paths List Rendering ─────────────────────────────── */
  function _renderPathsList(container) {
    if (!container) return;
    container.innerHTML = '';

    _paths.forEach(p => {
      const item = document.createElement('div');
      item.className = 'xml-path-item';
      item.title = p.path;

      const pathText = document.createElement('span');
      pathText.className = 'xml-path-text';
      pathText.textContent = p.path;
      item.appendChild(pathText);

      // badges row (only if any badge needed)
      if (p.eachSheet || p.isAttr) {
        const badges = document.createElement('div');
        badges.className = 'xml-path-badges';

        if (p.eachSheet) {
          const b = document.createElement('span');
          b.className = 'xml-path-each-tag';
          b.textContent = '↻ ' + p.eachSheet;
          badges.appendChild(b);
        }
        if (p.isAttr) {
          const b = document.createElement('span');
          b.className = 'xml-path-attr-tag';
          b.textContent = 'attr';
          badges.appendChild(b);
        }
        item.appendChild(badges);
      }

      container.appendChild(item);
    });
  }

  /* ── Node Count ───────────────────────────────────────── */
  function _countNodes(node, count = 0) {
    if (node.nodeType !== Node.ELEMENT_NODE) return count;
    count++;
    for (const c of node.childNodes) count = _countNodes(c, count);
    return count;
  }

  /* ── Sample XML Template ──────────────────────────────── */
  XMLHandler.SAMPLE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<DataExport>
  <Header>
    <ExportDate>{TODAY()}</ExportDate>
    <ExportedBy>{UPPER(CreatedBy)}</ExportedBy>
  </Header>
  <Orders>
    <Order each="Orders">
      <OrderID>{OrderID}</OrderID>
      <CustomerName>{CONCAT(FirstName," ",LastName)}</CustomerName>
      <OrderDate>{OrderDate}</OrderDate>
      <Status>{Status}</Status>
      <TotalAmount>{TotalAmount}</TotalAmount>
    </Order>
  </Orders>
  <Products>
    <Product each="Products">
      <ProductCode>{ProductCode}</ProductCode>
      <ProductName>{ProductName}</ProductName>
      <Price>{Price}</Price>
      <Category>{Category}</Category>
    </Product>
  </Products>
</DataExport>`;

  global.XMLHandler = XMLHandler;
})(window);
