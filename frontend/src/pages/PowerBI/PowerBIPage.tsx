import { useState, useRef, useCallback, type MouseEvent } from 'react'
import {
  Box, Typography, Button, TextField, Paper, Grid,
  Chip, IconButton, Tooltip, CircularProgress, Alert,
  Tab, Tabs, Table, TableHead, TableRow, TableCell, TableBody,
  alpha, Accordion, AccordionSummary, AccordionDetails,
  Select, MenuItem, FormControl, Popover, Stack, Divider,
  Checkbox,
} from '@mui/material'
import {
  AutoAwesomeOutlined, ContentCopyOutlined,
  DownloadOutlined, AddOutlined, DeleteOutlined,
  ExpandMoreOutlined, StorageOutlined, CalculateOutlined,
  FunctionsOutlined, TableChartOutlined,
  BarChartOutlined, CheckCircleOutlined, InfoOutlined,
  ChevronLeftOutlined, ChevronRightOutlined, FlashOnOutlined,
  BookmarkAddOutlined, EditOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { adminApi, myDashboardsApi } from '@/api'
import { useAppStore, type DaxLibraryMeasure } from '@/store/useAppStore'

// ── DAX function reference data ───────────────────────────────────────────────
const DAX_FUNCTIONS: Array<{ name: string; category: string; syntax: string; description: string }> = [
  { name: 'CALCULATE',       category: 'Filter',           syntax: 'CALCULATE(<expression>, <filter1>, ...)',                  description: 'Evaluates an expression in a modified filter context.' },
  { name: 'SUMX',            category: 'Aggregation',      syntax: 'SUMX(<table>, <expression>)',                              description: 'Returns sum of an expression evaluated for each row in a table.' },
  { name: 'AVERAGEX',        category: 'Aggregation',      syntax: 'AVERAGEX(<table>, <expression>)',                          description: 'Returns average of an expression over a table.' },
  { name: 'COUNTROWS',       category: 'Aggregation',      syntax: 'COUNTROWS([<table>])',                                     description: 'Counts the number of rows in a table.' },
  { name: 'DISTINCTCOUNT',   category: 'Aggregation',      syntax: 'DISTINCTCOUNT(<column>)',                                  description: 'Counts the number of distinct values in a column.' },
  { name: 'ALL',             category: 'Filter',           syntax: 'ALL([<table or column>])',                                 description: 'Returns all rows in a table, ignoring filters.' },
  { name: 'ALLEXCEPT',       category: 'Filter',           syntax: 'ALLEXCEPT(<table>, <column>, ...)',                        description: 'Returns all rows except filters applied to specified columns.' },
  { name: 'FILTER',          category: 'Filter',           syntax: 'FILTER(<table>, <filter expression>)',                     description: 'Returns a subset of a table that satisfies a condition.' },
  { name: 'RELATED',         category: 'Relationship',     syntax: 'RELATED(<column>)',                                        description: 'Returns a related value from another table via relationship.' },
  { name: 'RELATEDTABLE',    category: 'Relationship',     syntax: 'RELATEDTABLE(<table>)',                                    description: 'Returns a table related to the current table.' },
  { name: 'USERELATIONSHIP', category: 'Relationship',     syntax: 'USERELATIONSHIP(<column1>, <column2>)',                    description: 'Specifies a relationship to use in a calculation.' },
  { name: 'DIVIDE',          category: 'Math',             syntax: 'DIVIDE(<numerator>, <denominator>, [<alternate result>])', description: 'Safe division that handles divide-by-zero.' },
  { name: 'IF',              category: 'Logical',          syntax: 'IF(<condition>, <true>, [<false>])',                       description: 'Checks a condition and returns one value if true, another if false.' },
  { name: 'SWITCH',          category: 'Logical',          syntax: 'SWITCH(<expression>, <value>, <result>, ...)',             description: 'Evaluates an expression against a list of values.' },
  { name: 'DATEADD',         category: 'Time Intelligence', syntax: 'DATEADD(<dates>, <intervals>, <interval_type>)',           description: 'Returns a table of dates shifted by specified intervals.' },
  { name: 'SAMEPERIODLASTYEAR', category: 'Time Intelligence', syntax: 'SAMEPERIODLASTYEAR(<dates>)',                          description: 'Returns dates one year prior for the period specified.' },
  { name: 'TOTALYTD',        category: 'Time Intelligence', syntax: 'TOTALYTD(<expression>, <dates>)',                         description: 'Evaluates value year-to-date.' },
  { name: 'RANKX',           category: 'Statistical',      syntax: 'RANKX(<table>, <expression>, [<value>], [<order>])',       description: 'Returns ranking of a number in a list.' },
  { name: 'TOPN',            category: 'Statistical',      syntax: 'TOPN(<n>, <table>, <expression>, [<order>])',              description: 'Returns top N rows from a table.' },
  { name: 'CONCATENATEX',    category: 'Text',             syntax: 'CONCATENATEX(<table>, <expression>, [<delimiter>])',       description: 'Concatenates an expression for each row of a table.' },
  { name: 'FORMAT',          category: 'Text',             syntax: 'FORMAT(<value>, <format_string>)',                         description: 'Converts a value to text in a specified format.' },
  { name: 'VAR',             category: 'Variables',        syntax: 'VAR <name> = <expression> RETURN <result>',               description: 'Stores result of expression in named variable.' },
]

const DAX_CATEGORIES = ['All', ...Array.from(new Set(DAX_FUNCTIONS.map((f) => f.category)))]

const DAX_SNIPPETS = [
  { label: 'YoY Growth %', code: `YoY Growth % =\nVAR CY = [Total Sales]\nVAR PY = CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))\nRETURN\n    DIVIDE(CY - PY, PY, 0)` },
  { label: 'Running Total', code: `Running Total =\nCALCULATE(\n    SUM(Sales[Amount]),\n    FILTER(\n        ALL('Date'[Date]),\n        'Date'[Date] <= MAX('Date'[Date])\n    )\n)` },
  { label: 'Market Share', code: `Market Share =\nDIVIDE(\n    [Total Sales],\n    CALCULATE([Total Sales], ALL(Products[Category])),\n    0\n)` },
  { label: 'Dynamic Rank', code: `Sales Rank =\nRANKX(\n    ALL(Products[Product]),\n    [Total Sales],\n    ,\n    DESC,\n    DENSE\n)` },
  { label: 'MTD Sales', code: `MTD Sales =\nTOTALMTD([Total Sales], 'Date'[Date])` },
  { label: 'Budget vs Actual', code: `Variance =\nVAR Actual = [Total Sales]\nVAR Budget = SUM(Budget[BudgetAmount])\nRETURN\n    Actual - Budget` },
]

// Quick DAX patterns generated for a column reference
function quickPatterns(table: string, col: string, dataType: string) {
  const ref = `${table}[${col}]`
  const t = dataType.toLowerCase()
  const isNumeric = t.includes('int') || t.includes('decimal') || t.includes('numeric') || t.includes('float') || t.includes('money') || t.includes('real')
  const isDate = t.includes('date') || t.includes('time')

  if (isNumeric) return [
    { label: 'SUM',      code: `SUM(${ref})` },
    { label: 'AVERAGE',  code: `AVERAGE(${ref})` },
    { label: 'MAX',      code: `MAX(${ref})` },
    { label: 'MIN',      code: `MIN(${ref})` },
    { label: 'SUMX row', code: `SUMX('${table}', ${ref})` },
    { label: 'Running total', code: `CALCULATE(\n    SUM(${ref}),\n    FILTER(ALL('${table}'), ${ref} <= MAX(${ref}))\n)` },
    { label: 'YTD',      code: `TOTALYTD(SUM(${ref}), 'Date'[Date])` },
  ]
  if (isDate) return [
    { label: 'MAX date', code: `MAX(${ref})` },
    { label: 'MIN date', code: `MIN(${ref})` },
    { label: 'YoY',      code: `CALCULATE([Measure], SAMEPERIODLASTYEAR(${ref}))` },
    { label: 'MTD',      code: `TOTALMTD([Measure], ${ref})` },
    { label: 'DATEADD -1Y', code: `DATEADD(${ref}, -1, YEAR)` },
  ]
  // Text / key column
  return [
    { label: 'COUNT DISTINCT', code: `DISTINCTCOUNT(${ref})` },
    { label: 'COUNTROWS',      code: `COUNTROWS(FILTER('${table}', ${ref} = "value"))` },
    { label: 'CONCATENATE',    code: `CONCATENATEX('${table}', ${ref}, ", ")` },
    { label: 'VALUES',         code: `VALUES(${ref})` },
    { label: 'HASONEVALUE',    code: `IF(HASONEVALUE(${ref}), VALUES(${ref}), "Multiple")` },
  ]
}

// ── Schema Sidebar ────────────────────────────────────────────────────────────
interface SchemaSidebarProps {
  connId: number | null
  collapsed: boolean
  onToggle: () => void
  onColumnClick: (table: string, col: string, dataType: string, mode: 'insert' | 'copy' | 'select') => void
  mode: 'insert' | 'copy' | 'select'
}

function SchemaSidebar({ connId, collapsed, onToggle, onColumnClick, mode }: SchemaSidebarProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [schemaSearch, setSchemaSearch] = useState('')
  const [expandedTable, setExpandedTable] = useState<string | false>(false)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)
  const [popoverCol, setPopoverCol]     = useState<{ table: string; col: string; dataType: string } | null>(null)

  const { data: catalog, isLoading } = useQuery({
    queryKey: ['catalog', connId],
    queryFn:  () => adminApi.getCatalog(connId!),
    enabled:  connId != null,
  })

  const tableMap = (catalog?.columns ?? []).reduce<Record<string, Array<{ column_name: string; data_type: string }>>>((acc, col: any) => {
    if (!acc[col.table_name]) acc[col.table_name] = []
    acc[col.table_name].push({ column_name: col.column_name, data_type: col.data_type })
    return acc
  }, {})

  const tableNames = Object.keys(tableMap)
  const filteredTables = schemaSearch
    ? tableNames.filter((t) =>
        t.toLowerCase().includes(schemaSearch.toLowerCase()) ||
        tableMap[t].some((c) => c.column_name.toLowerCase().includes(schemaSearch.toLowerCase()))
      )
    : tableNames

  const handleColClick = (e: MouseEvent<HTMLElement>, table: string, col: string, dataType: string) => {
    if (mode === 'insert') {
      setPopoverCol({ table, col, dataType })
      setPopoverAnchor(e.currentTarget)
    } else if (mode === 'copy') {
      const ref = `${table}[${col}]`
      navigator.clipboard.writeText(ref)
      enqueueSnackbar(`Copied: ${ref}`, { variant: 'success' })
    }
    // 'select' mode: just notify parent — patterns render in the main content area
    onColumnClick(table, col, dataType, mode)
  }

  const handlePatternClick = (code: string, label: string) => {
    navigator.clipboard.writeText(code)
    enqueueSnackbar(`Copied: ${label}`, { variant: 'success' })
    setPopoverAnchor(null)
    if (popoverCol) onColumnClick(popoverCol.table, popoverCol.col, popoverCol.dataType, 'insert')
  }

  if (collapsed) {
    return (
      <Box sx={{ width: 36, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1 }}>
        <Tooltip title="Expand schema" placement="right">
          <IconButton size="small" onClick={onToggle}><ChevronRightOutlined sx={{ fontSize: 18 }} /></IconButton>
        </Tooltip>
        <Box sx={{ mt: 2, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', letterSpacing: '0.04em' }}>SCHEMA</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ width: 260, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <StorageOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
        <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>Schema</Typography>
        {tableNames.length > 0 && (
          <Chip label={`${tableNames.length} tables`} size="small" color="primary" sx={{ height: 16, fontSize: '0.6rem' }} />
        )}
        <Tooltip title="Collapse">
          <IconButton size="small" onClick={onToggle} sx={{ ml: 0.5 }}><ChevronLeftOutlined sx={{ fontSize: 16 }} /></IconButton>
        </Tooltip>
      </Box>

      {/* Mode hint */}
      {connId && tableNames.length > 0 && (
        <Box sx={{ px: 1.5, py: 0.75, bgcolor: (t) => alpha(t.palette.primary.main, 0.05), borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="primary" sx={{ fontSize: '0.68rem' }}>
            {mode === 'insert'
              ? '⚡ Click a column to insert into prompt & see DAX patterns'
              : mode === 'select'
              ? '👆 Click a column to show DAX calculations on the right'
              : '📋 Click a column to copy DAX reference'}
          </Typography>
        </Box>
      )}

      {/* Search */}
      <Box sx={{ px: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        {!connId ? (
          <Typography variant="caption" color="text.disabled">Select a connection</Typography>
        ) : isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">Loading…</Typography>
          </Box>
        ) : tableNames.length === 0 ? (
          <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.7rem' }}>
            No schema. Run Schema Discovery in Admin.
          </Typography>
        ) : (
          <TextField
            size="small" fullWidth placeholder="Search tables / columns…"
            value={schemaSearch} onChange={(e) => setSchemaSearch(e.target.value)}
            inputProps={{ style: { fontSize: '0.75rem', padding: '4px 8px' } }}
          />
        )}
      </Box>

      {/* Table tree */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {filteredTables.map((tableName) => {
          const cols = tableMap[tableName]
          const visibleCols = schemaSearch
            ? cols.filter((c) =>
                c.column_name.toLowerCase().includes(schemaSearch.toLowerCase()) ||
                tableName.toLowerCase().includes(schemaSearch.toLowerCase())
              )
            : cols

          return (
            <Accordion
              key={tableName} disableGutters elevation={0}
              expanded={expandedTable === tableName}
              onChange={(_, open) => setExpandedTable(open ? tableName : false)}
              sx={{ '&::before': { display: 'none' }, borderBottom: '1px solid', borderColor: (t) => alpha(t.palette.divider, 0.6) }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreOutlined sx={{ fontSize: 13 }} />}
                sx={{ minHeight: 32, px: 1.5, '& .MuiAccordionSummary-content': { my: 0.25, alignItems: 'center', gap: 0.75 } }}
              >
                <TableChartOutlined sx={{ fontSize: 12, color: 'primary.main', flexShrink: 0 }} />
                <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'monospace', fontSize: '0.72rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tableName}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled', flexShrink: 0 }}>{cols.length}</Typography>
              </AccordionSummary>

              <AccordionDetails sx={{ p: 0 }}>
                {/* Table-level copy */}
                <Tooltip title={`Copy: '${tableName}'`} placement="right">
                  <Box
                    onClick={() => { navigator.clipboard.writeText(`'${tableName}'`); enqueueSnackbar(`Copied: '${tableName}'`, { variant: 'success' }) }}
                    sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.04), borderBottom: '1px solid', borderColor: 'divider', cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.1) } }}
                  >
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'primary.main', flex: 1 }}>
                      '{tableName}'
                    </Typography>
                    <ContentCopyOutlined sx={{ fontSize: 10, color: 'text.disabled' }} />
                  </Box>
                </Tooltip>

                {/* Column rows */}
                {visibleCols.map((col) => {
                  const t = col.data_type.toLowerCase()
                  const isNum  = t.includes('int') || t.includes('decimal') || t.includes('float') || t.includes('numeric') || t.includes('money')
                  const isDate = t.includes('date') || t.includes('time')
                  const typeColor = isNum ? '#0891b2' : isDate ? '#7c3aed' : '#64748b'

                  return (
                    <Tooltip key={col.column_name} title={mode === 'insert' ? `Insert & see patterns for ${tableName}[${col.column_name}]` : mode === 'select' ? `Show DAX calculations for ${tableName}[${col.column_name}]` : `Copy: ${tableName}[${col.column_name}]`} placement="right">
                      <Box
                        onClick={(e) => handleColClick(e, tableName, col.column_name, col.data_type)}
                        sx={{ px: 1.5, py: 0.4, display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: '1px solid', borderColor: (t) => alpha(t.palette.divider, 0.4), cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } }}
                      >
                        {mode === 'insert'
                          ? <FlashOnOutlined sx={{ fontSize: 10, color: 'warning.main', flexShrink: 0 }} />
                          : mode === 'select'
                          ? <CalculateOutlined sx={{ fontSize: 10, color: 'primary.main', flexShrink: 0 }} />
                          : <ContentCopyOutlined sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }} />
                        }
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          [{col.column_name}]
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: typeColor, flexShrink: 0, fontWeight: 600 }}>
                          {isNum ? 'num' : isDate ? 'date' : 'text'}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )
                })}
              </AccordionDetails>
            </Accordion>
          )
        })}
      </Box>

      {/* Quick patterns popover */}
      <Popover
        open={Boolean(popoverAnchor)}
        anchorEl={popoverAnchor}
        onClose={() => setPopoverAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { width: 320, borderRadius: 2, p: 0, overflow: 'hidden' } }}
      >
        {popoverCol && (
          <>
            <Box sx={{ px: 2, py: 1.25, bgcolor: (t) => alpha(t.palette.primary.main, 0.08), borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" fontWeight={700} color="primary">
                {popoverCol.table}[{popoverCol.col}]
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.68rem' }}>
                {popoverCol.dataType} · Click a pattern to copy it
              </Typography>
            </Box>
            <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 320, overflowY: 'auto' }}>
              {quickPatterns(popoverCol.table, popoverCol.col, popoverCol.dataType).map((p) => (
                <Box
                  key={p.label}
                  onClick={() => handlePatternClick(p.code, p.label)}
                  sx={{ px: 1.5, py: 0.75, borderRadius: 1, border: '1px solid', borderColor: 'divider', cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.06), borderColor: 'primary.main' } }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.25 }}>
                    <Typography variant="caption" fontWeight={700} sx={{ fontSize: '0.72rem' }}>{p.label}</Typography>
                    <ContentCopyOutlined sx={{ fontSize: 11, color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
                    {p.code}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
      </Popover>
    </Box>
  )
}

// ── AI DAX Generator ─────────────────────────────────────────────────────────
function DAXGenerator({ connId, insertRef }: { connId: number | null; insertRef: string }) {
  const { enqueueSnackbar } = useSnackbar()
  const addDaxMeasures = useAppStore((s) => s.addDaxMeasures)
  const [request, setRequest] = useState('')
  const [model, setModel]     = useState('gpt-4o-mini')
  const [result, setResult]   = useState('')
  const [explanation, setExplanation] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Auto-insert column reference when sidebar column is clicked
  const prevInsertRef = useRef('')
  if (insertRef && insertRef !== prevInsertRef.current) {
    prevInsertRef.current = insertRef
    setRequest((prev) => prev ? `${prev}\n\nUse column: ${insertRef}` : `Create a DAX measure using ${insertRef}`)
  }

  const { data: catalog } = useQuery({
    queryKey: ['catalog', connId],
    queryFn:  () => adminApi.getCatalog(connId!),
    enabled:  connId != null,
  })

  const genMut = useMutation({
    mutationFn: async () => {
      if (!connId) throw new Error('No connection selected')
      const tables = catalog?.columns
        ? Object.entries(
            catalog.columns.reduce<Record<string, string[]>>((acc, col: any) => {
              if (!acc[col.table_name]) acc[col.table_name] = []
              acc[col.table_name].push(`${col.column_name} (${col.data_type})`)
              return acc
            }, {}),
          )
            .slice(0, 15)
            .map(([t, cols]) => `Table: ${t}\n  Columns: ${cols.slice(0, 10).join(', ')}`)
            .join('\n')
        : 'Schema not loaded'

      const prompt = `You are a Power BI DAX expert. Generate a DAX measure for the following request.

Schema (use EXACT table and column names as shown):
${tables}

Request: ${request}

Rules:
- Use VAR for intermediate calculations
- Use DIVIDE() to handle division (never use /)
- Reference columns as TableName[ColumnName]
- Reference tables as 'TableName' (with quotes if spaces)
- Use proper Time Intelligence functions when dates are involved

Respond with:
1. The DAX measure code in a \`\`\`dax code block
2. A brief explanation`

      const { chatApi } = await import('@/api')
      const res = await chatApi.send([
        { role: 'system', content: 'You are a Power BI DAX expert. Always provide production-ready DAX code using exact column and table names from the schema.' },
        { role: 'user', content: prompt },
      ], '', model)

      const codeMatch = res.message.match(/```(?:dax|DAX)?\s*([\s\S]*?)```/)
      const code = codeMatch ? codeMatch[1].trim() : res.message
      const expl = res.message.replace(/```[\s\S]*?```/g, '').trim()
      return { code, explanation: expl }
    },
    onSuccess: ({ code, explanation: expl }) => { setResult(code); setExplanation(expl) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* ── Prompt card ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* Card header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, borderBottom: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.primary.main, 0.03) }}>
          <AutoAwesomeOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>AI DAX Generator</Typography>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select value={model} onChange={(e) => setModel(e.target.value)} sx={{ fontSize: '0.8rem' }}>
              <MenuItem value="gpt-4o-mini">GPT-4o Mini</MenuItem>
              <MenuItem value="gpt-4o">GPT-4o</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained" size="small"
            startIcon={genMut.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeOutlined sx={{ fontSize: 14 }} />}
            disabled={!request.trim() || genMut.isPending || !connId}
            onClick={() => genMut.mutate()}
            sx={{ height: 32, whiteSpace: 'nowrap' }}
          >
            {genMut.isPending ? 'Generating…' : 'Generate DAX'}
          </Button>
        </Box>

        {/* Prompt body */}
        <Box sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Click a column in the schema panel on the left → it appears in the prompt automatically. Or describe freely.
          </Typography>
          <TextField
            fullWidth multiline minRows={3} size="small"
            placeholder="e.g. Calculate year-over-year growth for the Sales column&#10;Tip: Click a column in the left panel to auto-fill table/column references"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            inputProps={{ ref: textRef }}
          />
          {!connId && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
              Select a connection first to load schema context.
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ── Result card ── */}
      {result && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, borderBottom: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.success.main, 0.04) }}>
            <FunctionsOutlined sx={{ fontSize: 16, color: 'success.main' }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Generated DAX</Typography>
            <Tooltip title="Copy DAX">
              <IconButton size="small" onClick={() => { navigator.clipboard.writeText(result); enqueueSnackbar('Copied!', { variant: 'success' }) }}>
                <ContentCopyOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Save to Measure Library">
              <IconButton size="small" color="primary" onClick={() => {
                const firstLine = result.split('\n')[0] ?? ''
                const name = firstLine.includes('=') ? firstLine.split('=')[0].trim() : 'Generated Measure'
                const tableMatch = result.match(/\b([A-Za-z_][A-Za-z0-9_ ]*)\[/)
                const table = tableMatch ? tableMatch[1].trim() : 'Measures'
                addDaxMeasures([{ name, table, code: result, description: '' }])
                enqueueSnackbar(`"${name}" saved to Measure Library`, { variant: 'success' })
              }}>
                <BookmarkAddOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ p: 2 }}>
            <Box
              component="pre"
              sx={{ m: 0, p: 2, borderRadius: 1.5, fontSize: '0.813rem', lineHeight: 1.7, bgcolor: (t) => alpha(t.palette.primary.main, 0.04), border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.2), overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
            >
              {result}
            </Box>
            {explanation && (
              <Alert severity="info" icon={<InfoOutlined />} sx={{ mt: 1.5, fontSize: '0.8rem' }}>
                {explanation}
              </Alert>
            )}
          </Box>
        </Paper>
      )}
    </Box>
  )
}

// ── DAX Editor (Measure Library) ──────────────────────────────────────────────
function DAXEditor() {
  const { enqueueSnackbar } = useSnackbar()

  // Persist measures in global store so they survive navigation
  const measures        = useAppStore((s) => s.daxLibrary)
  const addDaxMeasures  = useAppStore((s) => s.addDaxMeasures)
  const removeDaxMeasure = useAppStore((s) => s.removeDaxMeasure)
  const updateDaxMeasure = useAppStore((s) => s.updateDaxMeasure)

  const [editIdx, setEditIdx]   = useState<number | null>(null)
  const [form, setForm]         = useState<DaxLibraryMeasure>({ name: '', table: '', code: '', description: '' })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [valResults, setValResults] = useState<{ name: string; passed: boolean; errors: string[]; warnings: string[] }[] | null>(null)

  const validateMut = useMutation({
    mutationFn: () => myDashboardsApi.validateDax(
      measures.map((m) => ({ name: m.name, expression: m.code }))
    ),
    onSuccess: (res) => {
      setValResults(res.results)
      enqueueSnackbar(res.all_valid ? 'All DAX measures valid' : 'Some measures have issues', {
        variant: res.all_valid ? 'success' : 'warning',
      })
    },
    onError: () => enqueueSnackbar('Validation failed', { variant: 'error' }),
  })

  const openNew  = () => { setEditIdx(-1); setForm({ name: '', table: '', code: '', description: '' }) }
  const openEdit = (i: number) => { setEditIdx(i); setForm({ ...measures[i] }) }

  const handleSave = () => {
    if (editIdx === -1) addDaxMeasures([{ ...form }])
    else if (editIdx != null) updateDaxMeasure(editIdx, { ...form })
    setEditIdx(null)
  }

  const toggleSelect = (i: number) =>
    setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  const toggleAll = () =>
    setSelected(selected.size === measures.length ? new Set() : new Set(measures.map((_, i) => i)))

  // Build .dax script from the given subset of measures
  const buildDaxScript = (subset: DaxLibraryMeasure[]) => {
    const lines = [
      '// ============================================================',
      '// Power BI DAX Measures — Measure Library Export',
      `// Exported: ${new Date().toLocaleString()}`,
      '// ============================================================',
      '',
    ]
    const byTable: Record<string, DaxLibraryMeasure[]> = {}
    subset.forEach((m) => { byTable[m.table] = [...(byTable[m.table] ?? []), m] })
    Object.entries(byTable).forEach(([tbl, ms]) => {
      lines.push(`// ── ${tbl} ──────────────────────────────────────────`)
      ms.forEach((m) => {
        lines.push(`MEASURE '${tbl}'[${m.name}] =`)
        m.code.split('\n').forEach((ln) => lines.push(`    ${ln}`))
        if (m.description) lines.push(`    // ${m.description}`)
        lines.push('')
      })
    })
    return lines.join('\n')
  }

  const downloadDax = (subset: DaxLibraryMeasure[], filename: string) => {
    const blob = new Blob([buildDaxScript(subset)], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
    enqueueSnackbar(`${filename} downloaded`, { variant: 'success' })
  }

  const selectedMeasures = measures.filter((_, i) => selected.has(i))
  const allSelected      = measures.length > 0 && selected.size === measures.length
  const someSelected     = selected.size > 0 && selected.size < measures.length

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
          Measure Library
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {measures.length} measure{measures.length !== 1 ? 's' : ''}
          </Typography>
        </Typography>

        {/* Export selected .dax */}
        {selected.size > 0 && (
          <Button size="small" variant="contained" color="secondary"
            startIcon={<DownloadOutlined />}
            onClick={() => downloadDax(selectedMeasures, 'selected-measures.dax')}
          >
            Export {selected.size} Selected .dax
          </Button>
        )}

        <Button size="small" variant="outlined" startIcon={<DownloadOutlined />}
          onClick={() => downloadDax(measures, 'all-measures.dax')}
          disabled={measures.length === 0}
        >
          Export All .dax
        </Button>

        <Button size="small" variant="outlined" color="warning"
          startIcon={validateMut.isPending ? <CircularProgress size={13} /> : <CheckCircleOutlined />}
          onClick={() => validateMut.mutate()}
          disabled={validateMut.isPending || measures.length === 0}
        >
          Validate DAX
        </Button>
        <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={openNew}>
          New Measure
        </Button>
      </Box>

      {/* Validation results */}
      {valResults && (
        <Alert
          severity={valResults.every((r) => r.passed) ? 'success' : 'warning'}
          sx={{ mb: 2, fontSize: '0.813rem' }}
          onClose={() => setValResults(null)}
        >
          <strong>DAX Validation:</strong>{' '}
          {valResults.filter((r) => r.passed).length}/{valResults.length} measures passed.
          {valResults.filter((r) => !r.passed).map((r) => (
            <Box key={r.name} sx={{ mt: 0.5 }}>
              <strong>{r.name}:</strong> {r.errors.join('; ')}
            </Box>
          ))}
        </Alert>
      )}

      {/* Edit / New form */}
      {editIdx != null && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="caption" fontWeight={700} sx={{ mb: 1.5, display: 'block' }}>
            {editIdx === -1 ? 'New Measure' : 'Edit Measure'}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6}><TextField fullWidth size="small" label="Measure Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="Table" value={form.table} onChange={(e) => setForm((f) => ({ ...f, table: e.target.value }))} helperText="e.g. Sales" /></Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline minRows={5} size="small" label="DAX Expression"
                value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.813rem' } }}
                placeholder="Total Sales = SUM(Sales[Amount])" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth size="small" label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Grid>
          </Grid>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button size="small" variant="contained" onClick={handleSave} disabled={!form.name || !form.code}>Save</Button>
            <Button size="small" onClick={() => setEditIdx(null)}>Cancel</Button>
          </Box>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
              <TableCell padding="checkbox" sx={{ width: 40 }}>
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              </TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Measure</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Table</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Expression</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {measures.map((m, i) => (
              <TableRow key={i} hover selected={selected.has(i)}
                sx={selected.has(i) ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } : {}}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selected.has(i)} onChange={() => toggleSelect(i)} />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <FunctionsOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
                    <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                  </Box>
                  {m.description && <Typography variant="caption" color="text.secondary">{m.description}</Typography>}
                </TableCell>
                <TableCell><Chip label={m.table || '—'} size="small" sx={{ height: 18, fontSize: '0.688rem' }} /></TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.75rem',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {m.code}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Copy">
                    <IconButton size="small" onClick={() => { navigator.clipboard.writeText(m.code); enqueueSnackbar('Copied!', { variant: 'success' }) }}>
                      <ContentCopyOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Export this measure as .dax">
                    <IconButton size="small" onClick={() => downloadDax([m], `${m.name.replace(/\s+/g, '_')}.dax`)}>
                      <DownloadOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => openEdit(i)}>
                      <EditOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => { removeDaxMeasure(i); setSelected((s) => { const n = new Set(s); n.delete(i); return n }) }}>
                      <DeleteOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {measures.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.disabled' }}>
                  No measures yet. Click "New Measure" or generate one with AI DAX Generator.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}

// ── DAX Function Reference ────────────────────────────────────────────────────
function DAXReference({ selectedCol }: { selectedCol: { table: string; col: string; dataType: string } | null }) {
  const { enqueueSnackbar } = useSnackbar()
  const [catFilter, setCatFilter] = useState('All')
  const [search, setSearch]       = useState('')

  const filtered = DAX_FUNCTIONS.filter((f) =>
    (catFilter === 'All' || f.category === catFilter) &&
    (f.name.toLowerCase().includes(search.toLowerCase()) || f.description.toLowerCase().includes(search.toLowerCase())),
  )

  const patterns = selectedCol ? quickPatterns(selectedCol.table, selectedCol.col, selectedCol.dataType) : []
  const colRef   = selectedCol ? `${selectedCol.table}[${selectedCol.col}]` : ''

  const copyCode = (code: string, label: string) => {
    navigator.clipboard.writeText(code)
    enqueueSnackbar(`Copied: ${label}`, { variant: 'success' })
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, height: '100%' }}>

      {/* ── Left: functions + snippets ── */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField size="small" placeholder="Search functions…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ width: 200 }} />
          {DAX_CATEGORIES.map((c) => (
            <Chip key={c} label={c} size="small" onClick={() => setCatFilter(c)}
              variant={catFilter === c ? 'filled' : 'outlined'} color={catFilter === c ? 'primary' : 'default'} sx={{ fontSize: '0.75rem' }} />
          ))}
        </Box>

        {catFilter === 'All' && !search && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Common Patterns
            </Typography>
            <Grid container spacing={1.5}>
              {DAX_SNIPPETS.map((s) => (
                <Grid item xs={12} sm={6} key={s.label}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, '&:hover': { borderColor: 'primary.main' } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                      <Typography variant="caption" fontWeight={700}>{s.label}</Typography>
                      <Tooltip title="Copy">
                        <IconButton size="small" onClick={() => copyCode(s.code, s.label)}>
                          <ContentCopyOutlined sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Box component="pre" sx={{ m: 0, fontSize: '0.688rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                      {s.code.slice(0, 120)}{s.code.length > 120 ? '…' : ''}
                    </Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        <Box>
          {filtered.map((f) => (
            <Accordion key={f.name} disableGutters elevation={0} sx={{ mb: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace', color: 'primary.main' }}>{f.name}</Typography>
                  <Chip label={f.category} size="small" sx={{ height: 16, fontSize: '0.625rem' }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{f.description}</Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                  <Box component="pre" sx={{ flex: 1, m: 0, p: 1, borderRadius: 1, fontSize: '0.75rem', fontFamily: 'monospace', bgcolor: (t) => alpha(t.palette.primary.main, 0.04), border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.15), whiteSpace: 'pre-wrap' }}>
                    {/* If a column is selected, substitute it into the syntax as an example */}
                    {selectedCol
                      ? f.syntax
                          .replace(/<column>/gi, colRef)
                          .replace(/<table>/gi, `'${selectedCol.table}'`)
                      : f.syntax}
                  </Box>
                  <Tooltip title="Copy syntax">
                    <IconButton size="small" onClick={() => copyCode(f.syntax, f.name)}>
                      <ContentCopyOutlined sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      </Box>

      {/* ── Right: Column DAX Calculations panel ── */}
      <Box sx={{ width: 340, flexShrink: 0 }}>
        {!selectedCol ? (
          <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, textAlign: 'center', bgcolor: (t) => alpha(t.palette.primary.main, 0.02) }}>
            <CalculateOutlined sx={{ fontSize: 36, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" fontWeight={700} color="text.secondary">No column selected</Typography>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              Click any column in the schema panel on the left to see ready-to-use DAX calculations for it.
            </Typography>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', position: 'sticky', top: 0 }}>
            {/* Column header */}
            <Box sx={{ px: 2, py: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.07), borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FunctionsOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" fontWeight={800} color="primary" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {colRef}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                    {selectedCol.dataType} · {selectedCol.table}
                  </Typography>
                </Box>
                <Tooltip title={`Copy ${colRef}`}>
                  <IconButton size="small" onClick={() => copyCode(colRef, colRef)}>
                    <ContentCopyOutlined sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {/* Patterns list */}
            <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.65rem', px: 0.5 }}>
                DAX Calculations
              </Typography>
              {patterns.map((p) => (
                <Paper
                  key={p.label}
                  variant="outlined"
                  sx={{ borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s', '&:hover': { borderColor: 'primary.main', bgcolor: (t) => alpha(t.palette.primary.main, 0.02) } }}
                  onClick={() => copyCode(p.code, p.label)}
                >
                  <Box sx={{ px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.02) }}>
                    <Typography variant="caption" fontWeight={700} sx={{ fontSize: '0.75rem' }}>{p.label}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>click to copy</Typography>
                      <ContentCopyOutlined sx={{ fontSize: 12, color: 'text.disabled' }} />
                    </Box>
                  </Box>
                  <Box
                    component="pre"
                    sx={{ m: 0, px: 1.5, py: 1, fontSize: '0.72rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'primary.main', bgcolor: 'transparent' }}
                  >
                    {p.code}
                  </Box>
                </Paper>
              ))}
            </Box>
          </Paper>
        )}
      </Box>

    </Box>
  )
}

// ── Dataset Schema Viewer ─────────────────────────────────────────────────────
function DatasetSchemaViewer({ connId }: { connId: number | null }) {
  const { data: catalog } = useQuery({
    queryKey: ['catalog', connId],
    queryFn:  () => adminApi.getCatalog(connId!),
    enabled:  connId != null,
  })

  if (!connId) return <Alert severity="info">Select a connection to view the dataset schema.</Alert>
  if (!catalog) return <CircularProgress size={24} />

  const tableMap = (catalog.columns ?? []).reduce<Record<string, { column_name: string; data_type: string; is_nullable: boolean }[]>>((acc, col: any) => {
    if (!acc[col.table_name]) acc[col.table_name] = []
    acc[col.table_name].push({ column_name: col.column_name, data_type: col.data_type, is_nullable: col.is_nullable })
    return acc
  }, {})

  const mapToPbiType = (dbType: string) => {
    const t = dbType.toLowerCase()
    if (t.includes('int') || t.includes('numeric') || t.includes('decimal') || t.includes('float')) return 'Decimal Number'
    if (t.includes('date') || t.includes('time')) return 'Date/Time'
    if (t.includes('bit') || t.includes('bool')) return 'True/False'
    return 'Text'
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>Dataset Tables ({Object.keys(tableMap).length})</Typography>
        <Chip label="Power BI Compatible" color="success" size="small" icon={<CheckCircleOutlined />} />
      </Box>
      {Object.entries(tableMap).map(([tableName, cols]) => (
        <Accordion key={tableName} disableGutters elevation={0} sx={{ mb: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&::before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TableChartOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
              <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>{tableName}</Typography>
              <Chip label={`${cols.length} cols`} size="small" sx={{ height: 16, fontSize: '0.625rem' }} />
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0, px: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', py: 0.5 }}>Column</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', py: 0.5 }}>DB Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', py: 0.5 }}>Power BI Type</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cols.map((col) => (
                  <TableRow key={col.column_name}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', py: 0.25 }}>{col.column_name}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.25, color: 'text.secondary' }}>{col.data_type}</TableCell>
                    <TableCell sx={{ py: 0.25 }}><Chip label={mapToPbiType(col.data_type)} size="small" sx={{ height: 16, fontSize: '0.625rem' }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PowerBIPage() {
  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId = activeConnection?.id ?? null
  const tab        = useAppStore((s) => s.powerBiTab)
  const setTab     = useAppStore((s) => s.setPowerBiTab)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [lastInsertRef, setLastInsertRef] = useState('')
  const [selectedCol, setSelectedCol] = useState<{ table: string; col: string; dataType: string } | null>(null)

  const handleColumnClick = useCallback((table: string, col: string, dataType: string, mode: 'insert' | 'copy' | 'select') => {
    if (mode === 'insert') {
      setLastInsertRef(`${table}[${col}]_${Date.now()}`)
    } else if (mode === 'select') {
      setSelectedCol({ table, col, dataType })
    }
  }, [])

  // Mode per tab: insert on Generator, select on DAX Reference, copy elsewhere
  const sidebarMode: 'insert' | 'copy' | 'select' = tab === 0 ? 'insert' : tab === 2 ? 'select' : 'copy'

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header — matches Reports / Dashboards style */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 56, flexShrink: 0 }}>
        <BarChartOutlined color="primary" sx={{ flexShrink: 0 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flexShrink: 0 }}>Power BI Development</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>DAX formula editor · AI generator · Schema browser</Typography>
        <Box sx={{ flex: 1 }} />
        {connId && <Chip icon={<StorageOutlined />} label={activeConnection?.name} size="small" color="primary" variant="outlined" />}
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, flexShrink: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 40 }}>
          <Tab icon={<AutoAwesomeOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="AI DAX Generator" sx={{ minHeight: 40, textTransform: 'none', fontSize: '0.813rem' }} />
          <Tab icon={<FunctionsOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Measure Library" sx={{ minHeight: 40, textTransform: 'none', fontSize: '0.813rem' }} />
          <Tab icon={<CalculateOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="DAX Reference" sx={{ minHeight: 40, textTransform: 'none', fontSize: '0.813rem' }} />
          <Tab icon={<TableChartOutlined sx={{ fontSize: 15 }} />} iconPosition="start" label="Dataset Schema" sx={{ minHeight: 40, textTransform: 'none', fontSize: '0.813rem' }} />
        </Tabs>
      </Box>

      {/* Body: sidebar + content */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Persistent schema sidebar (all tabs) */}
        <SchemaSidebar
          connId={connId}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
          onColumnClick={handleColumnClick}
          mode={sidebarMode}
        />

        {/* Main content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {tab === 0 && <DAXGenerator connId={connId} insertRef={lastInsertRef} />}
          {tab === 1 && <DAXEditor />}
          {tab === 2 && <DAXReference selectedCol={selectedCol} />}
          {tab === 3 && <DatasetSchemaViewer connId={connId} />}
        </Box>
      </Box>
    </Box>
  )
}
