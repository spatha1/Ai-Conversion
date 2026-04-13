import { useState } from 'react'
import {
  Box, Typography, Button, TextField, Paper, Grid, Card, CardContent,
  Chip, Divider, IconButton, Tooltip, CircularProgress, Alert,
  Tab, Tabs, Table, TableHead, TableRow, TableCell, TableBody,
  alpha, List, ListItem, ListItemText, ListItemIcon, Accordion,
  AccordionSummary, AccordionDetails, Select, MenuItem, FormControl,
  InputLabel,
} from '@mui/material'
import {
  AutoAwesomeOutlined, PlayArrowOutlined, ContentCopyOutlined,
  DownloadOutlined, RefreshOutlined, AddOutlined, DeleteOutlined,
  ExpandMoreOutlined, StorageOutlined, CalculateOutlined,
  FunctionsOutlined, TableChartOutlined, BugReportOutlined,
  BarChartOutlined, CheckCircleOutlined, InfoOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { connectionsApi, adminApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'

// ── DAX function reference ───────────────────────────────────────────────────
const DAX_FUNCTIONS: Array<{ name: string; category: string; syntax: string; description: string }> = [
  { name: 'CALCULATE',    category: 'Filter',        syntax: 'CALCULATE(<expression>, <filter1>, ...)', description: 'Evaluates an expression in a modified filter context.' },
  { name: 'SUMX',         category: 'Aggregation',   syntax: 'SUMX(<table>, <expression>)',             description: 'Returns sum of an expression evaluated for each row in a table.' },
  { name: 'AVERAGEX',     category: 'Aggregation',   syntax: 'AVERAGEX(<table>, <expression>)',         description: 'Returns average of an expression over a table.' },
  { name: 'COUNTROWS',    category: 'Aggregation',   syntax: 'COUNTROWS([<table>])',                    description: 'Counts the number of rows in a table.' },
  { name: 'DISTINCTCOUNT',category: 'Aggregation',   syntax: 'DISTINCTCOUNT(<column>)',                 description: 'Counts the number of distinct values in a column.' },
  { name: 'ALL',          category: 'Filter',        syntax: 'ALL([<table or column>])',                description: 'Returns all rows in a table, ignoring filters.' },
  { name: 'ALLEXCEPT',    category: 'Filter',        syntax: 'ALLEXCEPT(<table>, <column>, ...)',       description: 'Returns all rows except filters applied to specified columns.' },
  { name: 'FILTER',       category: 'Filter',        syntax: 'FILTER(<table>, <filter expression>)',    description: 'Returns a subset of a table that satisfies a condition.' },
  { name: 'RELATED',      category: 'Relationship',  syntax: 'RELATED(<column>)',                       description: 'Returns a related value from another table via relationship.' },
  { name: 'RELATEDTABLE', category: 'Relationship',  syntax: 'RELATEDTABLE(<table>)',                   description: 'Returns a table related to the current table.' },
  { name: 'USERELATIONSHIP', category: 'Relationship', syntax: 'USERELATIONSHIP(<column1>, <column2>)', description: 'Specifies a relationship to use in a calculation.' },
  { name: 'DIVIDE',       category: 'Math',          syntax: 'DIVIDE(<numerator>, <denominator>, [<alternate result>])', description: 'Safe division that handles divide-by-zero.' },
  { name: 'IF',           category: 'Logical',       syntax: 'IF(<condition>, <true>, [<false>])',      description: 'Checks a condition and returns one value if true, another if false.' },
  { name: 'SWITCH',       category: 'Logical',       syntax: 'SWITCH(<expression>, <value>, <result>, ...)', description: 'Evaluates an expression against a list of values.' },
  { name: 'DATEADD',      category: 'Time Intelligence', syntax: 'DATEADD(<dates>, <intervals>, <interval_type>)', description: 'Returns a table of dates shifted by specified intervals.' },
  { name: 'SAMEPERIODLASTYEAR', category: 'Time Intelligence', syntax: 'SAMEPERIODLASTYEAR(<dates>)', description: 'Returns dates one year prior for the period specified.' },
  { name: 'TOTALYTD',     category: 'Time Intelligence', syntax: 'TOTALYTD(<expression>, <dates>)',     description: 'Evaluates value year-to-date.' },
  { name: 'RANKX',        category: 'Statistical',   syntax: 'RANKX(<table>, <expression>, [<value>], [<order>])', description: 'Returns ranking of a number in a list.' },
  { name: 'TOPN',         category: 'Statistical',   syntax: 'TOPN(<n>, <table>, <expression>, [<order>])', description: 'Returns top N rows from a table.' },
  { name: 'CONCATENATEX', category: 'Text',          syntax: 'CONCATENATEX(<table>, <expression>, [<delimiter>])', description: 'Concatenates an expression for each row of a table.' },
  { name: 'FORMAT',       category: 'Text',          syntax: 'FORMAT(<value>, <format_string>)',        description: 'Converts a value to text in a specified format.' },
  { name: 'VAR',          category: 'Variables',     syntax: 'VAR <name> = <expression> RETURN <result>', description: 'Stores result of expression in named variable.' },
]

const DAX_CATEGORIES = ['All', ...Array.from(new Set(DAX_FUNCTIONS.map((f) => f.category)))]

const DAX_SNIPPETS = [
  {
    label: 'YoY Growth %',
    code: `YoY Growth % =
VAR CY = [Total Sales]
VAR PY = CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))
RETURN
    DIVIDE(CY - PY, PY, 0)`,
  },
  {
    label: 'Running Total',
    code: `Running Total =
CALCULATE(
    SUM(Sales[Amount]),
    FILTER(
        ALL('Date'[Date]),
        'Date'[Date] <= MAX('Date'[Date])
    )
)`,
  },
  {
    label: 'Market Share',
    code: `Market Share =
DIVIDE(
    [Total Sales],
    CALCULATE([Total Sales], ALL(Products[Category])),
    0
)`,
  },
  {
    label: 'Dynamic Rank',
    code: `Sales Rank =
RANKX(
    ALL(Products[Product]),
    [Total Sales],
    ,
    DESC,
    DENSE
)`,
  },
  {
    label: 'MTD Sales',
    code: `MTD Sales =
TOTALMTD([Total Sales], 'Date'[Date])`,
  },
  {
    label: 'Budget vs Actual',
    code: `Variance =
VAR Actual = [Total Sales]
VAR Budget = SUM(Budget[BudgetAmount])
RETURN
    Actual - Budget`,
  },
]

// ── AI DAX Generator ─────────────────────────────────────────────────────────
function DAXGenerator({ connId }: { connId: number | null }) {
  const { enqueueSnackbar } = useSnackbar()
  const [request, setRequest] = useState('')
  const [model, setModel]     = useState('gpt-4o-mini')
  const [result, setResult]   = useState('')
  const [explanation, setExplanation] = useState('')

  const { data: catalog } = useQuery({
    queryKey: ['catalog', connId],
    queryFn:  () => adminApi.getCatalog(connId!),
    enabled:  connId != null,
  })

  const genMut = useMutation({
    mutationFn: async () => {
      if (!connId) throw new Error('No connection selected')
      // Build schema summary for the prompt
      const tables = catalog?.columns
        ? Object.entries(
            catalog.columns.reduce<Record<string, string[]>>((acc, col: any) => {
              if (!acc[col.table_name]) acc[col.table_name] = []
              acc[col.table_name].push(col.column_name)
              return acc
            }, {}),
          )
            .slice(0, 10)
            .map(([t, cols]) => `Table: ${t}, Columns: ${cols.slice(0, 8).join(', ')}`)
            .join('\n')
        : 'Schema not loaded'

      const prompt = `You are a Power BI DAX expert. Generate a DAX measure for the following request.

Schema:
${tables}

Request: ${request}

Respond with:
1. The DAX measure code in a code block
2. A brief explanation of what it does and how it works

Use best practices: use VAR for intermediate calculations, handle divide-by-zero with DIVIDE(), use proper time intelligence functions.`

      const { chatApi } = await import('@/api')
      const res = await chatApi.send([
        { role: 'system', content: 'You are a Power BI DAX expert. Always provide production-ready DAX code.' },
        { role: 'user', content: prompt },
      ], '', model)

      // Extract code block
      const codeMatch = res.message.match(/```(?:dax|DAX)?\s*([\s\S]*?)```/)
      const code = codeMatch ? codeMatch[1].trim() : res.message
      // Remove code block from explanation
      const expl = res.message.replace(/```[\s\S]*?```/g, '').trim()
      return { code, explanation: expl }
    },
    onSuccess: ({ code, explanation: expl }) => {
      setResult(code)
      setExplanation(expl)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
        AI DAX Generator
      </Typography>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={9}>
          <TextField
            fullWidth multiline minRows={3} size="small"
            label="Describe the measure you need"
            placeholder="e.g. Calculate year-over-year sales growth as a percentage, comparing current period to same period last year"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </Grid>
        <Grid item xs={12} sm={3} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Model</InputLabel>
            <Select value={model} label="Model" onChange={(e) => setModel(e.target.value)}>
              <MenuItem value="gpt-4o-mini">GPT-4o Mini</MenuItem>
              <MenuItem value="gpt-4o">GPT-4o</MenuItem>
            </Select>
          </FormControl>
          <Button
            fullWidth variant="contained"
            startIcon={genMut.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
            disabled={!request.trim() || genMut.isPending || !connId}
            onClick={() => genMut.mutate()}
          >
            Generate DAX
          </Button>
        </Grid>
      </Grid>

      {!connId && (
        <Alert severity="info" sx={{ mb: 2 }}>Select a connection to use the schema-aware generator.</Alert>
      )}

      {result && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography variant="caption" fontWeight={700} color="primary">Generated DAX</Typography>
            <Tooltip title="Copy">
              <IconButton size="small" onClick={() => { navigator.clipboard.writeText(result); enqueueSnackbar('Copied!', { variant: 'success' }) }}>
                <ContentCopyOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Box
            component="pre"
            sx={{
              p: 2, borderRadius: 1.5, fontSize: '0.813rem', lineHeight: 1.7,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
              border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.2),
              overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace',
            }}
          >
            {result}
          </Box>
          {explanation && (
            <Alert severity="info" icon={<InfoOutlined />} sx={{ mt: 1, fontSize: '0.8rem' }}>
              {explanation}
            </Alert>
          )}
        </Box>
      )}
    </Box>
  )
}

// ── DAX Editor ───────────────────────────────────────────────────────────────
function DAXEditor() {
  const { enqueueSnackbar } = useSnackbar()
  const [measures, setMeasures] = useState<Array<{ name: string; table: string; code: string; description: string }>>([
    { name: 'Total Sales', table: 'Sales', code: 'Total Sales = SUM(Sales[Amount])', description: 'Sum of all sales amounts' },
    { name: 'Sales Count', table: 'Sales', code: 'Sales Count = COUNTROWS(Sales)', description: 'Number of sales records' },
  ])
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', table: '', code: '', description: '' })

  const openEdit = (i: number) => {
    setEditIdx(i)
    setForm({ ...measures[i] })
  }
  const openNew = () => {
    setEditIdx(-1)
    setForm({ name: '', table: '', code: '', description: '' })
  }
  const handleSave = () => {
    if (editIdx === -1) {
      setMeasures((m) => [...m, { ...form }])
    } else if (editIdx != null) {
      setMeasures((m) => m.map((x, i) => i === editIdx ? { ...form } : x))
    }
    setEditIdx(null)
  }
  const handleDelete = (i: number) => {
    setMeasures((m) => m.filter((_, idx) => idx !== i))
  }
  const handleExport = () => {
    const json = {
      version: '1.0',
      measures: measures.map((m) => ({
        name: m.name,
        table: m.table,
        expression: m.code,
        description: m.description,
      })),
    }
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'dax-measures.json'; a.click()
    URL.revokeObjectURL(url)
    enqueueSnackbar('DAX measures exported', { variant: 'success' })
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>Measure Library</Typography>
        <Button size="small" variant="outlined" startIcon={<DownloadOutlined />} onClick={handleExport}>
          Export JSON
        </Button>
        <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={openNew}>
          New Measure
        </Button>
      </Box>

      {editIdx != null && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="caption" fontWeight={700} sx={{ mb: 1.5, display: 'block' }}>
            {editIdx === -1 ? 'New Measure' : 'Edit Measure'}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6}><TextField fullWidth size="small" label="Measure Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="Table" value={form.table} onChange={(e) => setForm((f) => ({ ...f, table: e.target.value }))} /></Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth multiline minRows={4} size="small"
                label="DAX Expression"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.813rem' } }}
              />
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
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Measure</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Table</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Expression</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {measures.map((m, i) => (
              <TableRow key={i} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <FunctionsOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
                    <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                  </Box>
                  {m.description && <Typography variant="caption" color="text.secondary">{m.description}</Typography>}
                </TableCell>
                <TableCell><Chip label={m.table} size="small" sx={{ height: 18, fontSize: '0.688rem' }} /></TableCell>
                <TableCell>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {m.code.slice(0, 60)}{m.code.length > 60 ? '…' : ''}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Copy">
                    <IconButton size="small" onClick={() => { navigator.clipboard.writeText(m.code); enqueueSnackbar('Copied!', { variant: 'success' }) }}>
                      <ContentCopyOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  <IconButton size="small" onClick={() => openEdit(i)}><CheckCircleOutlined sx={{ fontSize: 14, color: 'primary.main' }} /></IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(i)}><DeleteOutlined sx={{ fontSize: 14 }} /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {measures.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.disabled' }}>No measures yet. Click "New Measure" to start.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}

// ── DAX Function Reference ────────────────────────────────────────────────────
function DAXReference() {
  const [catFilter, setCatFilter] = useState('All')
  const [search, setSearch]       = useState('')

  const filtered = DAX_FUNCTIONS.filter((f) =>
    (catFilter === 'All' || f.category === catFilter) &&
    (f.name.toLowerCase().includes(search.toLowerCase()) || f.description.toLowerCase().includes(search.toLowerCase())),
  )

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small" placeholder="Search functions…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 220 }}
        />
        {DAX_CATEGORIES.map((c) => (
          <Chip key={c} label={c} size="small"
            onClick={() => setCatFilter(c)}
            variant={catFilter === c ? 'filled' : 'outlined'}
            color={catFilter === c ? 'primary' : 'default'}
            sx={{ fontSize: '0.75rem' }}
          />
        ))}
      </Box>

      {DAX_SNIPPETS.length > 0 && catFilter === 'All' && !search && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Common Patterns
          </Typography>
          <Grid container spacing={1.5}>
            {DAX_SNIPPETS.map((s) => (
              <Grid item xs={12} sm={6} key={s.label}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                    <Typography variant="caption" fontWeight={700}>{s.label}</Typography>
                    <Tooltip title="Copy">
                      <IconButton size="small" onClick={() => navigator.clipboard.writeText(s.code)}>
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
              <Box
                component="pre"
                sx={{
                  m: 0, p: 1, borderRadius: 1, fontSize: '0.75rem', fontFamily: 'monospace',
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                  border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.15),
                  whiteSpace: 'pre-wrap',
                }}
              >
                {f.syntax}
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
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

  if (!connId) {
    return <Alert severity="info">Select a connection to view the dataset schema.</Alert>
  }
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
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
          Dataset Tables ({Object.keys(tableMap).length})
        </Typography>
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
                    <TableCell sx={{ py: 0.25 }}>
                      <Chip label={mapToPbiType(col.data_type)} size="small" sx={{ height: 16, fontSize: '0.625rem' }} />
                    </TableCell>
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
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <BarChartOutlined color="primary" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Power BI Development</Typography>
          <Typography variant="body2" color="text.secondary">
            DAX formula editor, AI generator and dataset schema browser
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {connId && (
          <Chip
            icon={<StorageOutlined />}
            label={activeConnection?.name}
            size="small"
            color="primary"
            variant="outlined"
          />
        )}
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 44 }}>
          <Tab icon={<AutoAwesomeOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="AI DAX Generator" sx={{ minHeight: 44, textTransform: 'none' }} />
          <Tab icon={<FunctionsOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Measure Library" sx={{ minHeight: 44, textTransform: 'none' }} />
          <Tab icon={<CalculateOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="DAX Reference" sx={{ minHeight: 44, textTransform: 'none' }} />
          <Tab icon={<TableChartOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Dataset Schema" sx={{ minHeight: 44, textTransform: 'none' }} />
        </Tabs>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {tab === 0 && <DAXGenerator connId={connId} />}
        {tab === 1 && <DAXEditor />}
        {tab === 2 && <DAXReference />}
        {tab === 3 && <DatasetSchemaViewer connId={connId} />}
      </Box>
    </Box>
  )
}
