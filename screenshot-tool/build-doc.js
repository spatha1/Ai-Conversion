/**
 * Build a self-contained HTML feature document from screenshots + meta.json
 * Run: node build-doc.js
 */

const fs   = require('fs')
const path = require('path')

const SCREENSHOTS = path.join(__dirname, 'screenshots')
const OUT_FILE    = path.join(__dirname, 'Clarity_Studio_Feature_Guide.html')

const meta = JSON.parse(fs.readFileSync(path.join(SCREENSHOTS, 'meta.json'), 'utf8'))

// Extended feature bullet points per page
const FEATURES = {
  '00_login.png': [
    'Branded split-panel layout — navy left panel with product highlights, clean white right form',
    'Username + password authentication with demo credential shortcut',
    'One-click "DEMO ACCESS" card to auto-fill credentials',
    'Redirects to project selection after successful login',
  ],
  '01_projects.png': [
    'Create unlimited projects to separate workstreams',
    'Project cards show name, description, connection count, mapping count, and last-updated date',
    'Status badges: Active, Draft, Archived',
    'Click a project to set it as the active context — all modules then operate within that project',
  ],
  '02_dashboard.png': [
    '7 KPI cards: Connections, Mappings, XML Generated, Reports, Dashboards, Tests, Admin (templates · agents · tests)',
    'XML generation trend chart (last 30 days)',
    'Quick-access links to every module',
    'Live counts pulled directly from the project database',
  ],
  '03_connections.png': [
    'Connect to SQL Server, PostgreSQL, MySQL, SQLite, Snowflake, or file-based sources (Excel/CSV)',
    'Encrypted credential storage — passwords and API keys never returned in API responses',
    'Test Connection button — validates connectivity and returns sample row count',
    'Data Preview — browse live table data directly in the browser',
    'Connections are shared across Conversion, Reports, Dashboards, Development, and Admin',
  ],
  '04_conversion.png': [
    'Upload XML templates with placeholder syntax ({ColumnName}, each="TableName")',
    'AI Field Mapping — automatically matches source columns to XML paths using semantic embeddings',
    'Manual mapping editor with drag-and-drop row reordering',
    'AI Query Generation — builds optimised SQL with JOINs from FK relationship graph',
    'Bulk XML Generation — produces one XML file per identifier row',
    'Validation engine — check XML output against configurable rules (required, type, length, pattern, enum)',
    'API Dispatch — send generated XML to any REST endpoint with bearer, API-key, basic, or OAuth2 auth',
    'Dispatch log tracks status, HTTP response code, retry count, and response time per record',
  ],
  '05_development.png': [
    'Natural-language task description → AI creates a multi-step execution plan',
    'BRD / Acceptance Criteria import — paste a BRD or fetch from JIRA/Azure DevOps ticket',
    'AI generates SQL for each step, validates syntax, and runs against the live connection',
    'Dependency graph — steps execute in the correct order based on declared dependencies',
    'Run All — execute the full pipeline with a single click',
    'JIRA and Azure DevOps integration — fetch ticket content directly into the development workflow (per-project credentials)',
  ],
  '06_dashboards.png': [
    'Plain-English dashboard generation — describe what you want to analyse, AI builds it',
    'Widget types: KPI card, bar chart, line chart, pie chart, doughnut, data table',
    'All widgets powered by AI-generated SQL queries running against the live connection',
    'AI Debug Panel — inspect the full prompt, schema used, and per-widget SQL; edit and re-run SQL inline',
    'Regenerate with AI — refine any individual widget with a natural-language instruction',
    'Save dashboards and reload them at any time',
    'Power BI export — convert any dashboard to a full TMSL + DAX package',
  ],
  '07_reports.png': [
    'Natural language → SQL: ask a question, get results instantly',
    'Full SQL editor for manual queries and edits',
    'Results displayed in a paginated, sortable data table',
    'Save frequently used queries as named reports',
    'Execution time shown per query',
  ],
  '08_ps_support.png': [
    'AI chatbot with full knowledge of the project schema and saved API endpoints',
    'Ask data questions in plain English — the AI writes and runs the SQL',
    'Trigger saved API endpoints from chat (e.g. "run payroll sync for employee 12345")',
    'Conversation history — create, rename, and revisit past sessions',
    'Context-aware responses using schema metadata and relationship graph',
  ],
  '09_api_collection.png': [
    'Manage the REST API library available to the PS Support AI',
    'Configure method, URL, headers, body template, required fields, and auth type per endpoint',
    'Auth types: None, Bearer Token, API Key, Basic',
    'Test any endpoint directly from the UI',
    'Endpoints are referenced by name in chat ("run the payroll API")',
  ],
  '10_agents.png': [
    'Create autonomous AI agents that run SQL analysis goals on a schedule',
    'Each agent has a goal description, a target connection, and an optional cron schedule',
    'Agents generate their own execution plan, run SQL steps, and produce a result summary',
    'Run on-demand with a single button or trigger automatically via schedule',
    'Full execution log: status, steps executed, result summary, errors, and timing',
    'Status control: Active, Paused, Inactive',
  ],
  '11_testing.png': [
    'Create test cases that compare source and target queries',
    'Validation types: Row Count, Sum, Null Check, Duplicate Detection, Custom SQL, Row-Level Diff, Column-Level Diff',
    'Row-level reconciliation: finds missing rows in source/target and highlights per-column mismatches',
    'Run all tests in one click — summary shows total, passed, failed, errors',
    'Group test cases by area or feature for organised test suites',
    'Detailed mismatch report: shows which rows differ and what changed in each column',
  ],
  '12_powerbi.png': [
    'AI-generates DAX measures from the project schema and intent description',
    'Full dataset schema export: tables, columns, data types, and relationships',
    'TMSL JSON — ready to import into Power BI Desktop as a dataset',
    'DAX script — all measures in one file, paste directly into Power BI',
    'Step-by-step build guide generated alongside the export',
  ],
  '13_admin_overview.png': [
    'Schema tab — collect table/column metadata, FK relationships, and sample data from the source database',
    'AI Intelligence tab — readiness score, AI context summary, query context editor, AI trace log',
    'Metadata tab — document every table and column with descriptions, business context, and synonyms; AI auto-fill available',
    'Prompt Templates tab — manage system prompts used by every AI feature; override defaults per-connection',
    'Query Examples tab — maintain a library of example SQL queries used to guide AI generation',
    'Integrations tab — configure JIRA and Azure DevOps credentials per project',
    'Workflows tab — build multi-step automation workflows (SQL → API → Email)',
    'Feedback tab — review all user-submitted feedback with status management and admin notes',
  ],
}

// ── Build HTML ────────────────────────────────────────────────────────────────
function imgBase64(file) {
  const p = path.join(SCREENSHOTS, file)
  if (!fs.existsSync(p)) return ''
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')
}

function bullets(file) {
  const items = FEATURES[file] || []
  if (!items.length) return ''
  return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
}

const tocItems = meta.map((p, i) =>
  `<li><a href="#section-${i}">${p.label}</a></li>`
).join('\n')

const sections = meta.map((p, i) => {
  const b64 = imgBase64(p.file)
  const img = b64
    ? `<img src="${b64}" alt="${p.label}" />`
    : `<div class="no-img">Screenshot not found: ${p.file}</div>`
  return `
  <section id="section-${i}">
    <div class="section-header">
      <span class="section-num">${String(i + 1).padStart(2, '0')}</span>
      <div>
        <h2>${p.label}</h2>
        <code class="route">${p.route}</code>
      </div>
    </div>
    <p class="desc">${p.description}</p>
    ${bullets(p.file)}
    <div class="screenshot-wrap">${img}</div>
  </section>`
}).join('\n')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Clarity Studio — Feature Guide</title>
<style>
  :root {
    --navy: #01398c;
    --navy2: #1A5099;
    --accent: #7C3AED;
    --bg: #f8fafc;
    --card: #ffffff;
    --border: #e2e8f0;
    --text: #1e293b;
    --muted: #64748b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }

  /* Cover */
  .cover {
    background: linear-gradient(135deg, var(--navy) 0%, var(--navy2) 50%, #0E2A5A 100%);
    color: white;
    padding: 80px 60px;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }
  .cover::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(circle at 80% 20%, rgba(124,58,237,.25) 0%, transparent 60%);
  }
  .cover-badge {
    display: inline-block;
    background: rgba(255,255,255,.15);
    border: 1px solid rgba(255,255,255,.3);
    border-radius: 20px;
    padding: 4px 14px;
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: uppercase;
    margin-bottom: 28px;
  }
  .cover h1 { font-size: 52px; font-weight: 800; letter-spacing: -1px; margin-bottom: 12px; }
  .cover h1 span { color: #93c5fd; }
  .cover .subtitle { font-size: 18px; color: rgba(255,255,255,.75); margin-bottom: 48px; }
  .cover-meta { display: flex; gap: 32px; flex-wrap: wrap; }
  .cover-meta div { background: rgba(255,255,255,.1); border-radius: 12px; padding: 16px 24px; }
  .cover-meta .label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,.6); }
  .cover-meta .value { font-size: 20px; font-weight: 700; margin-top: 4px; }

  /* Layout */
  .container { max-width: 1100px; margin: 0 auto; padding: 40px 32px; }

  /* TOC */
  .toc { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px; margin-bottom: 48px; }
  .toc h2 { font-size: 20px; font-weight: 700; color: var(--navy); margin-bottom: 20px; border-bottom: 2px solid var(--border); padding-bottom: 12px; }
  .toc ol { padding-left: 20px; column-count: 2; column-gap: 32px; }
  .toc li { margin-bottom: 6px; }
  .toc a { color: var(--navy2); text-decoration: none; font-size: 14px; }
  .toc a:hover { text-decoration: underline; }

  /* Sections */
  section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    margin-bottom: 48px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .section-header {
    display: flex; align-items: flex-start; gap: 16px;
    padding: 28px 32px 16px;
    border-bottom: 1px solid var(--border);
  }
  .section-num {
    background: linear-gradient(135deg, var(--navy), var(--navy2));
    color: white;
    font-size: 13px; font-weight: 800;
    border-radius: 8px;
    padding: 6px 10px;
    flex-shrink: 0;
    margin-top: 4px;
  }
  section h2 { font-size: 22px; font-weight: 700; color: var(--navy); }
  .route { font-size: 12px; color: var(--accent); background: rgba(124,58,237,.08); padding: 2px 8px; border-radius: 4px; margin-top: 4px; display: inline-block; }
  .desc { padding: 16px 32px 4px; color: var(--muted); font-size: 15px; }
  section ul { padding: 8px 32px 20px 52px; }
  section ul li { color: var(--text); font-size: 14px; margin-bottom: 5px; }
  .screenshot-wrap { padding: 0 24px 24px; }
  .screenshot-wrap img { width: 100%; border: 1px solid var(--border); border-radius: 10px; display: block; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
  .no-img { padding: 40px; text-align: center; color: var(--muted); background: var(--bg); border-radius: 10px; }

  /* Footer */
  .footer { text-align: center; padding: 32px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); margin-top: 16px; }

  @media print {
    .cover { page-break-after: always; }
    section { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<!-- Cover -->
<div class="cover">
  <div class="cover-badge">Feature Documentation</div>
  <h1>Clarity <span>Studio</span></h1>
  <p class="subtitle">AI-Powered Data Conversion &amp; Analytics Platform — Complete Feature Guide</p>
  <div class="cover-meta">
    <div><div class="label">Modules</div><div class="value">13</div></div>
    <div><div class="label">Document Date</div><div class="value">April 2026</div></div>
    <div><div class="label">Version</div><div class="value">1.0</div></div>
  </div>
</div>

<div class="container">

  <!-- Table of Contents -->
  <div class="toc">
    <h2>Table of Contents</h2>
    <ol>${tocItems}</ol>
  </div>

  <!-- Sections -->
  ${sections}

  <div class="footer">
    Clarity Studio · AI-Powered Data Conversion Platform · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
  </div>
</div>
</body>
</html>`

fs.writeFileSync(OUT_FILE, html, 'utf8')
const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)
console.log(`\n✅  Document written: ${OUT_FILE}`)
console.log(`    Size: ${sizeMB} MB (self-contained — all screenshots embedded as base64)\n`)
