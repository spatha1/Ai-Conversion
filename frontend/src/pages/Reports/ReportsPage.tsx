import { useState, useEffect, useRef } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Divider, Paper, Tabs, Tab, IconButton,
  Tooltip, alpha, CircularProgress, List, ListItemButton,
  ListItemText, ListItemIcon, Alert,
} from '@mui/material'
import {
  AutoAwesomeOutlined, PlayArrowOutlined, DownloadOutlined,
  ContentCopyOutlined, BarChartOutlined, TableChartOutlined,
  SaveOutlined, DashboardOutlined, StorageOutlined,
  TrendingUpOutlined, NumbersOutlined, CalendarTodayOutlined,
  DeleteOutlined, BookmarkOutlined,
  CodeOutlined, CheckCircleOutlined,
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
    ? results.rows.slice(0, 20).map((r) => ({ name: String(r[xAxis] ?? ''), value: Number(r[yAxis] ?? 0) })).filter((d) => !isNaN(d.value))
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
        <Grid item xs={12} md={savedReports.length > 0 ? 9 : 12}>

          {/* Connection + AI bar */}
          <Card sx={{ mb: 2 }}>
            <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
              <Grid container spacing={2} alignItems="flex-end">
                <Grid item xs={12} md={10}>
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

          {/* SQL Editor — always visible when connection is selected */}
          {connId ? (
            <Card sx={{ mb: 2 }}>
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
                  <CodeOutlined fontSize="small" color="action" />
                  <Typography variant="subtitle2" fontWeight={700}>SQL Query</Typography>
                  {sql && (
                    <Tooltip title="Copy SQL">
                      <IconButton size="small" onClick={() => navigator.clipboard.writeText(sql)}>
                        <ContentCopyOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
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
            </Card>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              Select a connection above to start writing queries.
            </Alert>
          )}

          {/* Results */}
          {results && (
            <Card>
              <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
                    Query Results
                  </Typography>
                  <Chip label={`${results.row_count ?? results.rows.length} rows`} color="primary" variant="outlined" size="small" />
                  {results.execution_time_ms && (
                    <Chip label={`${results.execution_time_ms}ms`} variant="outlined" size="small" />
                  )}
                  <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} sx={{ minHeight: 36 }}>
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

                {viewMode === 'data' && (
                  <Box sx={{ overflow: 'auto', maxHeight: 480 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {results.columns.map((col) => (
                            <TableCell key={col} sx={{ fontWeight: 700 }}>{col}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {results.rows.map((row, i) => (
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

                {viewMode === 'dashboard' && <DashboardView results={results} />}
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* ── Right: Saved reports ── */}
        {connId && savedReports.length > 0 && (
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <BookmarkOutlined fontSize="small" color="action" />
                  <Typography variant="subtitle2" fontWeight={700}>Saved Reports</Typography>
                  <Chip label={savedReports.length} size="small" sx={{ ml: 'auto' }} />
                </Box>
                <Divider sx={{ mb: 1 }} />
                <List dense disablePadding>
                  {(savedReports as any[]).map((r) => (
                    <ListItemButton
                      key={r.id}
                      sx={{ borderRadius: 1, mb: 0.5, pr: 1 }}
                      onClick={() => {
                        setSql(r.query_sql)
                        setResults(null)
                        runMutation.mutate(r.query_sql)
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <CodeOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={r.name}
                        primaryTypographyProps={{ variant: 'caption', fontWeight: 600, noWrap: true }}
                        secondary={new Date(r.created_at).toLocaleDateString()}
                        secondaryTypographyProps={{ variant: 'caption', color: 'text.disabled' }}
                      />
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          edge="end"
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id) }}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                        >
                          <DeleteOutlined sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </ListItemButton>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  )
}
