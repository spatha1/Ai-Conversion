import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Divider, Paper, Tabs, Tab, IconButton,
  Tooltip, alpha, CircularProgress, List, ListItemButton,
  ListItemText, ListItemIcon, Alert, Collapse, Autocomplete,
  Stack,
} from '@mui/material'
import {
  AutoAwesomeOutlined, PlayArrowOutlined, DownloadOutlined,
  ContentCopyOutlined, BarChartOutlined, TableChartOutlined,
  SaveOutlined, DashboardOutlined, StorageOutlined,
  TrendingUpOutlined, NumbersOutlined, CalendarTodayOutlined,
  DeleteOutlined, BookmarkOutlined,
  CodeOutlined, CheckCircleOutlined, FilterListOutlined,
  ClearOutlined, DateRangeOutlined, ExpandMoreOutlined, ExpandLessOutlined,
} from '@mui/icons-material'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { reportApi, connectionsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'

const CHART_COLORS = ['#2563eb', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#0284c7']

// ── Dashboard summary view (extracted to avoid IIFE in JSX) ──────────────────
function DashboardView({ results }: {
  results: { columns: string[]; rows: Record<string, unknown>[]; row_count?: number }
}) {
  const numCols = results.columns.filter((c) =>
    results.rows.length > 0 &&
    results.rows.slice(0, 5).every((r) => r[c] !== null && r[c] !== '' && !isNaN(Number(r[c])))
  )
  const textCols = results.columns.filter((c) => !numCols.includes(c))
  const kpis = numCols.slice(0, 4).map((col) => {
    const vals = results.rows.map((r) => Number(r[col] ?? 0))
    return { col, total: vals.reduce((a, b) => a + b, 0) }
  })
  const dashXAxis = textCols[0] ?? results.columns[0] ?? ''
  const dashYAxis = numCols[0] ?? ''
  const dashData = dashYAxis
    ? results.rows.slice(0, 20).map((r) => ({
        name: String(r[dashXAxis] ?? ''),
        value: Number(r[dashYAxis] ?? 0),
      }))
    : []
  const KPI_META = [
    { Icon: TrendingUpOutlined, color: '#10b981' },
    { Icon: NumbersOutlined,    color: '#f59e0b' },
    { Icon: BarChartOutlined,   color: '#0284c7' },
    { Icon: CalendarTodayOutlined, color: '#7c3aed' },
  ]
  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center', borderColor: alpha('#2563eb', 0.3), bgcolor: alpha('#2563eb', 0.04) }}>
            <StorageOutlined sx={{ fontSize: 28, color: '#2563eb', mb: 0.5 }} />
            <Typography variant="h5" fontWeight={700} color="#2563eb">{(results.row_count ?? results.rows.length).toLocaleString()}</Typography>
            <Typography variant="caption" color="text.secondary">Total Rows</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center', borderColor: alpha('#7c3aed', 0.3), bgcolor: alpha('#7c3aed', 0.04) }}>
            <TableChartOutlined sx={{ fontSize: 28, color: '#7c3aed', mb: 0.5 }} />
            <Typography variant="h5" fontWeight={700} color="#7c3aed">{results.columns.length}</Typography>
            <Typography variant="caption" color="text.secondary">Columns</Typography>
          </Paper>
        </Grid>
        {kpis.slice(0, 2).map((kpi, i) => {
          const { Icon, color } = KPI_META[i] ?? KPI_META[0]
          return (
            <Grid item xs={6} sm={3} key={kpi.col}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center', borderColor: alpha(color, 0.3), bgcolor: alpha(color, 0.04) }}>
                <Icon sx={{ fontSize: 28, color, mb: 0.5 }} />
                <Typography variant="h5" fontWeight={700} sx={{ color }}>{kpi.total.toLocaleString(undefined, { maximumFractionDigits: 1 })}</Typography>
                <Typography variant="caption" color="text.secondary">Total {kpi.col}</Typography>
              </Paper>
            </Grid>
          )
        })}
      </Grid>
      {dashData.length > 0 ? (
        <Box sx={{ height: 320 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{dashXAxis} × {dashYAxis}</Typography>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dashData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <RechartTooltip />
              <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]}>
                {dashData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>
          <BarChartOutlined sx={{ fontSize: 40, mb: 1 }} />
          <Typography variant="body2">No numeric columns detected for chart</Typography>
        </Box>
      )}
    </Box>
  )
}

export default function ReportsPage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const prevConnIdRef = useRef<number | ''>(connId)
  const [nlQuery, setNlQuery] = useState('')
  const [sql, setSql] = useState('')
  const [saveName, setSaveName] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [results, setResults] = useState<{ columns: string[]; rows: Record<string, unknown>[]; row_count?: number; execution_time_ms?: number } | null>(null)
  const [viewMode, setViewMode] = useState<'data' | 'chart' | 'dashboard'>('data')
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar')
  const [xAxis, setXAxis] = useState('')
  const [yAxis, setYAxis] = useState('')

  // ── Section collapse ─────────────────────────────────────────
  const [sqlOpen,     setSqlOpen]     = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)

  // ── Filters ──────────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false)
  // ordered list of columns the user has added as filters
  const [activeFilterCols, setActiveFilterCols] = useState<string[]>([])
  const [textFilters,    setTextFilters]    = useState<Record<string, string[]>>({})
  const [numericFilters, setNumericFilters] = useState<Record<string, { min: string; max: string }>>({})
  const [dateFilters,    setDateFilters]    = useState<Record<string, { from: string; to: string }>>({})

  type ColType = 'date' | 'numeric' | 'text'

  const colTypes = useMemo((): Record<string, ColType> => {
    if (!results) return {}
    const out: Record<string, ColType> = {}
    for (const col of results.columns) {
      const samples = results.rows.slice(0, 20).map((r) => String(r[col] ?? '')).filter(Boolean)
      if (samples.length === 0) { out[col] = 'text'; continue }
      // Must look like a real date string (has separators), not just a plain number
      const DATE_RE = /^\d{4}-\d{2}-\d{2}|^\d{2}[\/\-]\d{2}[\/\-]\d{4}/
      const allDate = samples.every((v) => DATE_RE.test(v.trim()) && !isNaN(Date.parse(v)))
      if (allDate) { out[col] = 'date'; continue }
      const allNum = samples.every((v) => !isNaN(Number(v)) && v.trim() !== '')
      out[col] = allNum ? 'numeric' : 'text'
    }
    return out
  }, [results])

  const uniqueValues = useMemo((): Record<string, string[]> => {
    if (!results) return {}
    const out: Record<string, string[]> = {}
    for (const col of results.columns) {
      if (colTypes[col] !== 'text') continue
      const set = new Set<string>()
      for (const row of results.rows) { const v = String(row[col] ?? ''); if (v) set.add(v) }
      out[col] = Array.from(set).sort().slice(0, 300)
    }
    return out
  }, [results, colTypes])

  const filteredRows = useMemo(() => {
    if (!results) return []
    return results.rows.filter((row) => {
      for (const col of activeFilterCols) {
        const type = colTypes[col]
        if (type === 'text') {
          const sel = textFilters[col] ?? []
          if (sel.length > 0 && !sel.includes(String(row[col] ?? ''))) return false
        } else if (type === 'numeric') {
          const { min, max } = numericFilters[col] ?? {}
          const val = Number(row[col])
          if (min && !isNaN(Number(min)) && val < Number(min)) return false
          if (max && !isNaN(Number(max)) && val > Number(max)) return false
        } else if (type === 'date') {
          const { from, to } = dateFilters[col] ?? {}
          const val = row[col] ? new Date(String(row[col])) : null
          if (from && val && val < new Date(from)) return false
          if (to   && val && val > new Date(to + 'T23:59:59')) return false
        }
      }
      return true
    })
  }, [results, activeFilterCols, textFilters, numericFilters, dateFilters, colTypes])

  const hasActiveFilters = activeFilterCols.length > 0

  const addFilterCol = (col: string) => {
    if (!activeFilterCols.includes(col)) setActiveFilterCols((p) => [...p, col])
  }
  const removeFilterCol = (col: string) => {
    setActiveFilterCols((p) => p.filter((c) => c !== col))
    setTextFilters((f)    => { const n = { ...f };    delete n[col]; return n })
    setNumericFilters((f) => { const n = { ...f };    delete n[col]; return n })
    setDateFilters((f)    => { const n = { ...f };    delete n[col]; return n })
  }
  const clearFilters = () => {
    setActiveFilterCols([])
    setTextFilters({})
    setNumericFilters({})
    setDateFilters({})
  }

  useEffect(() => { clearFilters() }, [results])  // eslint-disable-line react-hooks/exhaustive-deps

  // Clear SQL + results when the global connection changes
  useEffect(() => {
    if (prevConnIdRef.current !== connId) {
      prevConnIdRef.current = connId
      setSql('')
      setResults(null)
      setNlQuery('')
      setShowSave(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  // Saved reports for this connection
  const { data: savedReports = [] } = useQuery({
    queryKey: ['saved-reports', connId],
    queryFn: () => reportApi.listSaved(connId as number),
    enabled: !!connId,
  })

  const genSqlMutation = useMutation({
    mutationFn: () => reportApi.generateSql(connId as number, nlQuery),
    onSuccess: (r) => {
      setSql(r.sql)
      setResults(null)
      enqueueSnackbar('SQL generated — review and run', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const runMutation = useMutation({
    mutationFn: (sqlOverride?: string) => connectionsApi.runQuery(connId as number, sqlOverride ?? sql),
    onSuccess: (r) => {
      setResults(r)
      // Pick a sensible default: text col for X, first numeric col for Y
      const sample = r.rows.slice(0, 5)
      const numericCols = r.columns.filter((c) =>
        sample.length > 0 && sample.every((row) => row[c] !== null && row[c] !== '' && !isNaN(Number(row[c])))
      )
      const textCols = r.columns.filter((c) => !numericCols.includes(c))
      setXAxis(textCols[0] ?? r.columns[0] ?? '')
      setYAxis(numericCols[0] ?? r.columns[1] ?? '')
      enqueueSnackbar(`${r.row_count ?? r.rows.length} rows returned`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMutation = useMutation({
    mutationFn: () => reportApi.save(connId as number, saveName.trim(), sql),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-reports', connId] })
      setSaveName('')
      setShowSave(false)
      enqueueSnackbar('Report saved', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => reportApi.deleteSaved(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports', connId] }),
  })

  const exportCsv = () => {
    if (!results) return
    const header = results.columns.join(',')
    const rows = results.rows.map((r) =>
      results.columns.map((c) => JSON.stringify(r[c] ?? '')).join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'report.csv'; a.click()
    URL.revokeObjectURL(a.href)
  }

  const allNumericCols = results
    ? results.columns.filter((c) => {
        const sample = results.rows.slice(0, 5)
        return sample.length > 0 && sample.every((row) => row[c] !== null && row[c] !== '' && !isNaN(Number(row[c])))
      })
    : []

  const chartData = results && yAxis
    ? filteredRows.slice(0, 20).map((r) => ({ name: String(r[xAxis] ?? ''), value: Number(r[yAxis] ?? 0) })).filter((d) => !isNaN(d.value))
    : []

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <BarChartOutlined sx={{ fontSize: 28, color: 'primary.main', mr: 1 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>Reports & Analytics</Typography>
          <Typography variant="body2" color="text.secondary">
            Ask questions in plain English or write SQL to analyze your data
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* ── Left: Query builder + results ── */}
        <Grid item xs={12}>

          {/* Connection + AI bar */}
          <Card sx={{ mb: 2 }}>
            <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
              <Grid container spacing={2} alignItems="flex-end">
                <Grid item xs={12} md={savedReports.length > 0 ? 7 : 10}>
                  <TextField
                    label="Ask a question in plain English"
                    value={nlQuery}
                    onChange={(e) => setNlQuery(e.target.value)}
                    fullWidth
                    size="small"
                    placeholder="e.g. How many employees in each department?"
                    disabled={!connId}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && connId && nlQuery.trim()) {
                        e.preventDefault()
                        genSqlMutation.mutate()
                      }
                    }}
                  />
                </Grid>
                {savedReports.length > 0 && (
                  <Grid item xs={12} md={3}>
                    <Autocomplete
                      size="small"
                      options={savedReports as any[]}
                      getOptionLabel={(r: any) => r.name}
                      onChange={(_, r: any) => {
                        if (r) { setSql(r.query_sql); setResults(null); runMutation.mutate(r.query_sql) }
                      }}
                      value={null}
                      blurOnSelect
                      clearOnBlur
                      renderInput={(params) => (
                        <TextField {...params} label="Load Saved Report" placeholder="Search reports…"
                          InputProps={{ ...params.InputProps, startAdornment: <BookmarkOutlined sx={{ fontSize: 16, color: 'text.disabled', mr: 0.5 }} /> }} />
                      )}
                      renderOption={(props, r: any) => (
                        <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                          <Box>
                            <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{new Date(r.created_at).toLocaleDateString()}</Typography>
                          </Box>
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id) }}
                              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                              <DeleteOutlined sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      )}
                    />
                  </Grid>
                )}
                <Grid item xs={12} md={2}>
                  <Button
                    variant="contained"
                    color="secondary"
                    fullWidth
                    startIcon={genSqlMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
                    onClick={() => genSqlMutation.mutate()}
                    disabled={!connId || !nlQuery.trim() || genSqlMutation.isPending}
                    sx={{ py: 1 }}
                  >
                    AI Generate
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* SQL Editor */}
          {connId ? (
            <Card sx={{ mb: 2 }}>
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.2, cursor: 'pointer', borderBottom: sqlOpen ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}
                onClick={() => setSqlOpen((v) => !v)}
              >
                <CodeOutlined fontSize="small" color="action" />
                <Typography variant="subtitle2" fontWeight={700}>SQL Query</Typography>
                {sql && !sqlOpen && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, ml: 1, fontFamily: 'monospace' }}>
                    {sql.slice(0, 80)}{sql.length > 80 ? '…' : ''}
                  </Typography>
                )}
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {sql && (
                    <Tooltip title="Copy SQL">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(sql) }}>
                        <ContentCopyOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <IconButton size="small">
                    {sqlOpen ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
                  </IconButton>
                </Box>
              </Box>
              <Collapse in={sqlOpen}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <TextField
                  value={sql}
                  onChange={(e) => { setSql(e.target.value); setResults(null) }}
                  multiline
                  rows={5}
                  fullWidth
                  placeholder="-- Write SQL directly or use AI Generate above&#10;SELECT * FROM dbo.Employees"
                  sx={{
                    '& .MuiInputBase-root': {
                      fontFamily: 'monospace',
                      fontSize: '0.813rem',
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
                    },
                  }}
                />
                <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={runMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
                    onClick={() => runMutation.mutate(sql)}
                    disabled={!sql.trim() || runMutation.isPending}
                  >
                    Run Query
                  </Button>
                  {sql.trim() && results && (
                    <>
                      {!showSave ? (
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<SaveOutlined />}
                          onClick={() => setShowSave(true)}
                        >
                          Save Report
                        </Button>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <TextField
                            size="small"
                            placeholder="Report name…"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            sx={{ width: 200 }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && saveName.trim()) saveMutation.mutate()
                              if (e.key === 'Escape') setShowSave(false)
                            }}
                            autoFocus
                          />
                          <Button
                            variant="contained"
                            size="small"
                            disabled={!saveName.trim() || saveMutation.isPending}
                            onClick={() => saveMutation.mutate()}
                            startIcon={saveMutation.isPending ? <CircularProgress size={12} color="inherit" /> : <CheckCircleOutlined />}
                          >
                            Save
                          </Button>
                          <Button size="small" onClick={() => setShowSave(false)}>Cancel</Button>
                        </Box>
                      )}
                    </>
                  )}
                  {sql && (
                    <Button
                      variant="text"
                      size="small"
                      color="inherit"
                      sx={{ color: 'text.disabled', ml: 'auto' }}
                      onClick={() => { setSql(''); setResults(null); setNlQuery('') }}
                    >
                      Clear
                    </Button>
                  )}
                </Box>
                </CardContent>
              </Collapse>
            </Card>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              Select a connection above to start writing queries.
            </Alert>
          )}

          {/* Results */}
          {results && (
            <Card>
              {/* Results header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: resultsOpen ? '1px solid' : 'none', borderColor: 'divider' }}>
                {/* Left: title + chips — clicking here toggles collapse */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', flex: '0 0 auto' }}
                  onClick={() => setResultsOpen((v) => !v)}>
                  <IconButton size="small" sx={{ p: 0.25 }}>
                    {resultsOpen ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
                  </IconButton>
                  <Typography variant="subtitle2" fontWeight={700}>Query Results</Typography>
                  <Chip
                    label={hasActiveFilters
                      ? `${filteredRows.length} / ${results.row_count ?? results.rows.length} rows`
                      : `${results.row_count ?? results.rows.length} rows`}
                    color={hasActiveFilters ? 'warning' : 'primary'}
                    variant="outlined" size="small"
                  />
                  {results.execution_time_ms && (
                    <Chip label={`${results.execution_time_ms}ms`} variant="outlined" size="small" />
                  )}
                </Box>

                {/* Right: controls — independent of collapse */}
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Tooltip title={filtersOpen ? 'Hide Filters' : 'Filter Results'}>
                    <IconButton size="small"
                      onClick={() => { setResultsOpen(true); setFiltersOpen((v) => !v) }}
                      color={hasActiveFilters ? 'warning' : 'default'}>
                      <FilterListOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tabs value={viewMode} onChange={(_, v) => { setResultsOpen(true); setViewMode(v) }} sx={{ minHeight: 36 }}>
                    <Tab value="data" icon={<StorageOutlined fontSize="small" />} iconPosition="start" label="Data" sx={{ minHeight: 36, py: 0, textTransform: 'none' }} />
                    <Tab value="chart" icon={<BarChartOutlined fontSize="small" />} iconPosition="start" label="Chart" sx={{ minHeight: 36, py: 0, textTransform: 'none' }} />
                    <Tab value="dashboard" icon={<DashboardOutlined fontSize="small" />} iconPosition="start" label="Dashboard" sx={{ minHeight: 36, py: 0, textTransform: 'none' }} />
                  </Tabs>
                  <Tooltip title="Export CSV">
                    <IconButton size="small" onClick={exportCsv}>
                      <DownloadOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              <Collapse in={resultsOpen} unmountOnExit>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                {/* ── Filter Panel ── */}
                <Collapse in={filtersOpen}>
                  <Box sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                    {/* Panel header */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.04), borderBottom: '1px solid', borderColor: 'divider' }}>
                      <FilterListOutlined sx={{ fontSize: 15, color: 'primary.main' }} />
                      <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ letterSpacing: 0.5 }}>
                        FILTERS
                      </Typography>
                      {hasActiveFilters && (
                        <Chip label={`${filteredRows.length} of ${results.rows.length} rows`} size="small" color="primary" variant="outlined" sx={{ ml: 0.5, height: 20, fontSize: '0.7rem' }} />
                      )}
                      <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
                        {/* Add Filter dropdown */}
                        <Autocomplete
                          size="small"
                          options={results.columns.filter((c) => !activeFilterCols.includes(c))}
                          value={null}
                          onChange={(_, col) => { if (col) addFilterCol(col) }}
                          sx={{ width: 180 }}
                          renderInput={(params) => (
                            <TextField {...params} placeholder="+ Add filter" size="small"
                              sx={{ '& .MuiInputBase-root': { height: 30, fontSize: '0.8rem' } }} />
                          )}
                          blurOnSelect
                          clearOnBlur
                          clearIcon={null}
                        />
                        {hasActiveFilters && (
                          <Button size="small" color="error" startIcon={<ClearOutlined sx={{ fontSize: 13 }} />}
                            onClick={clearFilters} sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                            Clear All
                          </Button>
                        )}
                      </Box>
                    </Box>

                    {/* Filter rows */}
                    {activeFilterCols.length === 0 ? (
                      <Box sx={{ px: 2, py: 1.5, color: 'text.disabled' }}>
                        <Typography variant="caption">Use "+ Add filter" above to filter by any column.</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        {activeFilterCols.map((col, idx) => {
                          const type = colTypes[col] ?? 'text'
                          return (
                            <Box key={col} sx={{
                              display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1,
                              borderBottom: idx < activeFilterCols.length - 1 ? '1px solid' : 'none',
                              borderColor: 'divider',
                            }}>
                              {/* Column name */}
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 120 }}>
                                {type === 'date'    && <DateRangeOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />}
                                {type === 'numeric' && <NumbersOutlined   sx={{ fontSize: 14, color: 'text.secondary' }} />}
                                {type === 'text'    && <FilterListOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />}
                                <Typography variant="body2" fontWeight={600} noWrap>{col}</Typography>
                                <Chip label={type} size="small" variant="outlined"
                                  sx={{ fontSize: '0.6rem', height: 16, ml: 0.5,
                                    color: type === 'date' ? 'secondary.main' : type === 'numeric' ? 'success.main' : 'info.main',
                                    borderColor: type === 'date' ? 'secondary.main' : type === 'numeric' ? 'success.main' : 'info.main',
                                  }} />
                              </Box>

                              {/* Filter control */}
                              <Box sx={{ flex: 1 }}>
                                {type === 'date' && (() => {
                                  const { from = '', to = '' } = dateFilters[col] ?? {}
                                  return (
                                    <Stack direction="row" spacing={1} alignItems="center">
                                      <TextField size="small" type="date" label="From" value={from}
                                        onChange={(e) => setDateFilters((f) => ({ ...f, [col]: { from: e.target.value, to: f[col]?.to ?? '' } }))}
                                        InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
                                      <Typography variant="caption" color="text.secondary">to</Typography>
                                      <TextField size="small" type="date" label="To" value={to}
                                        onChange={(e) => setDateFilters((f) => ({ ...f, [col]: { from: f[col]?.from ?? '', to: e.target.value } }))}
                                        InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
                                    </Stack>
                                  )
                                })()}

                                {type === 'numeric' && (() => {
                                  const { min = '', max = '' } = numericFilters[col] ?? {}
                                  return (
                                    <Stack direction="row" spacing={1} alignItems="center">
                                      <TextField size="small" type="number" label="Min" value={min}
                                        onChange={(e) => setNumericFilters((f) => ({ ...f, [col]: { min: e.target.value, max: f[col]?.max ?? '' } }))}
                                        sx={{ width: 130 }} />
                                      <Typography variant="caption" color="text.secondary">to</Typography>
                                      <TextField size="small" type="number" label="Max" value={max}
                                        onChange={(e) => setNumericFilters((f) => ({ ...f, [col]: { min: f[col]?.min ?? '', max: e.target.value } }))}
                                        sx={{ width: 130 }} />
                                    </Stack>
                                  )
                                })()}

                                {type === 'text' && (
                                  <Autocomplete
                                    multiple size="small"
                                    options={uniqueValues[col] ?? []}
                                    value={textFilters[col] ?? []}
                                    onChange={(_, v) => setTextFilters((f) => ({ ...f, [col]: v }))}
                                    disableCloseOnSelect limitTags={3}
                                    sx={{ maxWidth: 500 }}
                                    renderInput={(params) => (
                                      <TextField {...params} placeholder={(textFilters[col]?.length ?? 0) === 0 ? 'Select values (multi-select)…' : undefined} />
                                    )}
                                    renderTags={(value, getTagProps) =>
                                      value.map((option, index) => (
                                        <Chip {...getTagProps({ index })} key={option} label={option}
                                          size="small" color="primary" variant="outlined"
                                          sx={{ fontSize: '0.7rem', height: 22 }} />
                                      ))
                                    }
                                  />
                                )}
                              </Box>

                              {/* Remove filter */}
                              <Tooltip title="Remove filter">
                                <IconButton size="small" onClick={() => removeFilterCol(col)}
                                  sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                                  <ClearOutlined sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )
                        })}
                      </Box>
                    )}
                  </Box>
                </Collapse>

                {viewMode === 'data' && (
                  <Box sx={{ overflow: 'auto', maxHeight: 480 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {results.columns.map((col) => {
                            const type = colTypes[col]
                            const isFiltered =
                              (type === 'text'    && (textFilters[col]?.length ?? 0) > 0) ||
                              (type === 'numeric' && !!(numericFilters[col]?.min || numericFilters[col]?.max)) ||
                              (type === 'date'    && !!(dateFilters[col]?.from   || dateFilters[col]?.to))
                            return (
                              <TableCell key={col} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  {col}
                                  {isFiltered && <FilterListOutlined sx={{ fontSize: 12, color: 'primary.main' }} />}
                                </Box>
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={results.columns.length} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                              No rows match the current filters
                            </TableCell>
                          </TableRow>
                        ) : filteredRows.map((row, i) => (
                          <TableRow key={i} hover>
                            {results.columns.map((col) => (
                              <TableCell key={col}>
                                <Typography variant="caption">{String(row[col] ?? '')}</Typography>
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}

                {viewMode === 'chart' && (
                  <Box>
                    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        {(['bar', 'pie'] as const).map((t) => (
                          <Chip key={t} label={t.toUpperCase()} onClick={() => setChartType(t)}
                            color={chartType === t ? 'primary' : 'default'}
                            variant={chartType === t ? 'filled' : 'outlined'} size="small" />
                        ))}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <TextField select size="small" label="X Axis" value={xAxis} onChange={(e) => setXAxis(e.target.value)} sx={{ minWidth: 120 }}
                          SelectProps={{ native: true }}>
                          {results.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                        </TextField>
                        <TextField select size="small" label="Y Axis (numeric)" value={yAxis} onChange={(e) => setYAxis(e.target.value)} sx={{ minWidth: 140 }}
                          SelectProps={{ native: true }}>
                          {(allNumericCols.length > 0 ? allNumericCols : results.columns).map((c) => <option key={c} value={c}>{c}</option>)}
                        </TextField>
                      </Box>
                    </Box>
                    <Box sx={{ height: 360 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        {chartType === 'bar' ? (
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <RechartTooltip />
                            <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        ) : (
                          <PieChart>
                            <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={140}
                              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                              {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Pie>
                            <RechartTooltip />
                          </PieChart>
                        )}
                      </ResponsiveContainer>
                    </Box>
                    {chartData.length === 0 && (
                      <Alert severity="info" sx={{ mt: 1, borderRadius: 2 }}>
                        No numeric data to chart. Select a numeric column for Y Axis, or run a query that returns numeric values.
                      </Alert>
                    )}
                  </Box>
                )}

                {viewMode === 'dashboard' && <DashboardView results={{ ...results, rows: filteredRows, row_count: filteredRows.length }} />}
                </CardContent>
              </Collapse>
            </Card>
          )}
        </Grid>

      </Grid>
    </Box>
  )
}
