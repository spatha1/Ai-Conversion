/**
 * Clarity Studio — Automated Screenshot Capture
 * Logs in, visits every page, captures full-page screenshots.
 * Run: node capture.js
 */

const { chromium } = require('playwright')
const path = require('path')
const fs   = require('fs')

const BASE      = 'http://localhost:3000'
const OUT_DIR   = path.join(__dirname, 'screenshots')
const CREDS     = { username: 'admin', password: 'clarity2024' }

// ── Pages to capture ────────────────────────────────────────────────────────
// Each entry: { route, file, label, description, waitFor? }
const PAGES = [
  // Login
  {
    route: '/login', file: '00_login', label: 'Login Page',
    description: 'The login screen where users authenticate with their username and password. Includes a branded left panel with product highlights and a clean right-side form.',
    noAuth: true,
  },

  // Projects
  {
    route: '/projects', file: '01_projects', label: 'Projects',
    description: 'Project selection screen. Users can create new projects or switch between existing ones. Each project card shows its name, status, connection count, and last updated date.',
  },

  // Dashboard
  {
    route: '/dashboard', file: '02_dashboard', label: 'Project Dashboard',
    description: 'High-level project overview. KPI cards show Connections, Mappings, XML Generated, Reports, Dashboards, Tests, and Admin (prompt templates, agents, test cases). Charts display XML generation trends.',
    waitFor: '.recharts-responsive-container',
  },

  // Connections
  {
    route: '/connections', file: '03_connections', label: 'Connections',
    description: 'Manage source data connections. Supports SQL Server, PostgreSQL, MySQL, Snowflake, and file-based sources. Each connection can be tested, previewed, and used across modules.',
  },

  // Conversion
  {
    route: '/conversion', file: '04_conversion', label: 'Conversion',
    description: 'Core XML conversion workflow. Upload XML templates, configure field mappings (manual or AI-assisted), generate SQL queries, produce XML output per identifier, validate against rules, and dispatch via API.',
  },

  // Development
  {
    route: '/development', file: '05_development', label: 'Development',
    description: 'AI-powered SQL development workspace. Describe a task in plain English or paste a BRD — the AI creates a multi-step execution plan, generates SQL for each step, validates it, and runs it against the selected connection. Supports JIRA and Azure DevOps ticket import.',
  },

  // Dashboards
  {
    route: '/dashboards', file: '06_dashboards', label: 'My Dashboards',
    description: 'AI-generated analytics dashboards. Describe what you want to analyse and the AI builds a full dashboard with KPI cards, bar charts, line charts, pie charts, and data tables — all connected to live SQL queries. Includes an AI Debug Panel for inspecting and regenerating individual widgets.',
  },

  // Reports
  {
    route: '/reports', file: '07_reports', label: 'Reports',
    description: 'Natural language to SQL reporting. Type a question in plain English, the AI generates the SQL, runs it, and displays results in an interactive table. Save frequently used queries as named reports.',
  },

  // PS Support
  {
    route: '/ps-support', file: '08_ps_support', label: 'PS Support',
    description: 'Professional Services AI assistant. Chat with an AI that has full knowledge of the project\'s data schema and saved API endpoints. Ask data questions, trigger workflows, and manage conversation history.',
  },

  // API Collection
  {
    route: '/ps-support/api-collection', file: '09_api_collection', label: 'API Collection',
    description: 'Manage the API endpoint library used by the PS Support AI. Add, edit, and test REST API entries with authentication configuration. The AI uses these endpoints to answer questions and trigger actions.',
  },

  // Agents
  {
    route: '/agents', file: '10_agents', label: 'AI Agents',
    description: 'Autonomous AI agents that run SQL analysis tasks on a schedule or on demand. Each agent has a goal, a target connection, and an execution log showing results, plans, and step counts.',
  },

  // Testing
  {
    route: '/testing', file: '11_testing', label: 'Testing & Reconciliation',
    description: 'Automated data validation framework. Create test cases that compare source vs target queries using count, sum, null check, duplicate detection, or full row-level reconciliation. Run all tests at once and view pass/fail results with mismatch details.',
  },

  // PowerBI
  {
    route: '/powerbi', file: '12_powerbi', label: 'Power BI Export',
    description: 'Export your data schema and AI-generated DAX measures for Power BI. Produces a full TMSL dataset definition, DAX script, and a step-by-step build guide for importing into Power BI Desktop.',
  },

  // Admin — tabs
  {
    route: '/admin', file: '13_admin_overview', label: 'Admin — Overview',
    description: 'Administration panel with 8 tabs: Schema, AI Intelligence, Metadata, Prompt Templates, Query Examples, Integrations, Workflows, and Feedback. Central configuration hub for the platform.',
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  // MUI TextField renders a plain <input> inside the wrapper
  const inputs = page.locator('input')
  await inputs.nth(0).fill(CREDS.username)
  await inputs.nth(1).fill(CREDS.password)
  await page.locator('button[type="submit"]').click()
  // Wait until redirected away from /login
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 })
  // Select first project if on /projects
  if (page.url().includes('/projects')) {
    try {
      await page.waitForSelector('.MuiCard-root', { timeout: 8000 })
      await page.locator('.MuiCard-root').first().click()
      await page.waitForURL((url) => !url.toString().includes('/projects'), { timeout: 10000 })
    } catch {
      console.warn('  ⚠ Could not auto-select project')
    }
  }
}

async function capture(page, entry) {
  const filePath = path.join(OUT_DIR, `${entry.file}.png`)
  console.log(`  📸 ${entry.label} → ${entry.file}.png`)

  try {
    await page.goto(`${BASE}${entry.route}`, { waitUntil: 'networkidle', timeout: 20000 })

    if (entry.waitFor) {
      await page.waitForSelector(entry.waitFor, { timeout: 8000 }).catch(() => {})
    }

    // Small pause so lazy-loaded content settles
    await page.waitForTimeout(1500)

    await page.screenshot({ path: filePath, fullPage: true })
    console.log(`  ✅ saved`)
    return true
  } catch (err) {
    console.warn(`  ❌ failed: ${err.message}`)
    return false
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  await ensureDir(OUT_DIR)

  const browser = await chromium.launch({ headless: true })
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page    = await ctx.newPage()

  console.log('\n🚀 Clarity Studio — Screenshot Capture\n')

  // Capture login page before auth
  const loginEntry = PAGES.find(p => p.noAuth)
  if (loginEntry) {
    console.log(`📄 ${loginEntry.label}`)
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: path.join(OUT_DIR, `${loginEntry.file}.png`), fullPage: true })
    console.log('  ✅ saved\n')
  }

  // Log in once
  console.log('🔐 Logging in…')
  await login(page)
  console.log('  ✅ authenticated\n')

  // Capture all authenticated pages
  for (const entry of PAGES.filter(p => !p.noAuth)) {
    console.log(`📄 ${entry.label}`)
    await capture(page, entry)
    await page.waitForTimeout(500)
  }

  await browser.close()

  // ── Write metadata JSON (for document generation) ───────────────────────
  const meta = PAGES.map(p => ({
    file:        `${p.file}.png`,
    label:       p.label,
    description: p.description,
    route:       p.route,
  }))
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2))

  console.log(`\n✅ Done! Screenshots saved to: ${OUT_DIR}\n`)
})()
