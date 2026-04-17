import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Paper, Divider, IconButton, Tooltip, CircularProgress,
  List, ListItemButton, ListItemText, ListItemSecondaryAction,
  Chip, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  Popover, alpha, ToggleButtonGroup, ToggleButton, Tabs, Tab,
  Collapse, Autocomplete,
} from '@mui/material'
import {
  DeleteOutlined, SaveOutlined, AutoAwesomeOutlined,
  AddOutlined, RefreshOutlined, BarChartOutlined,
  TrendingUpOutlined, PieChartOutlined, TableChartOutlined,
  NumbersOutlined, CodeOutlined, PlayArrowOutlined, BugReportOutlined,
  StorageOutlined, DownloadOutlined, AccountTreeOutlined, MenuBookOutlined,
  ExpandMoreOutlined, ExpandLessOutlined, BookmarkOutlined,
} from '@mui/icons-material'
import AIDebugPanel from './AIDebugPanel'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useNavigate } from 'react-router-dom'
import { connectionsApi, myDashboardsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { DashboardWidget, DashboardConfigSchema, SavedDashboard, DashboardDebugMeta, PowerBIExport } from '@/types'

const CHART_COLORS = ['#01398c', '#555555', '#059669', '#D97706', '#DC2626', '#0284C7', '#1A5099']

// ── Widget type icon ──────────────────────────────────────────────────────────
function WidgetTypeIcon({ type }: { type: DashboardWidget['type'] }) {
  const icons: Record<DashboardWidget['type'], React.ReactNode> = {
    kpi:      <NumbersOutlined fontSize="small" />,
    bar:      <BarChartOutlined fontSize="small" />,
    line:     <TrendingUpOutlined fontSize="small" />,
    pie:      <PieChartOutlined fontSize="small" />,
    doughnut: <PieChartOutlined fontSize="small" />,
    table:    <TableChartOutlined fontSize="small" />,
  }
  return <>{icons[type] ?? null}</>
}

// ── Single Widget Renderer ────────────────────────────────────────────────────
function WidgetRenderer({
  widget,
  connId,
  onSqlChange,
}: {
  widget: DashboardWidget
  connId: number
  onSqlChange?: (widgetId: string, sql: string) => void
}) {
  const [sqlAnchor, setSqlAnchor] = useState<HTMLButtonElement | null>(null)
  const [editSql, setEditSql]     = useState(widget.dataBinding.sql)
  const [activeSql, setActiveSql] = useState(widget.dataBinding.sql)
  const sqlOpen = Boolean(sqlAnchor)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['widget-data', connId, widget.id, activeSql],
    queryFn: () => connectionsApi.runQuery(connId, activeSql),
    retry: false,
  })

  // Sync local SQL state when parent updates the widget (e.g. from AIDebugPanel)
  useEffect(() => {
    setActiveSql(widget.dataBinding.sql)
    setEditSql(widget.dataBinding.sql)
  }, [widget.dataBinding.sql])

  const handleApplySql = () => {
    setActiveSql(editSql)
    onSqlChange?.(widget.id, editSql)
    setSqlAnchor(null)
  }

  const sqlPopover = (
    <Popover
      open={sqlOpen}
      anchorEl={sqlAnchor}
      onClose={() => { setSqlAnchor(null); setEditSql(activeSql) }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{ sx: { width: 480, p: 2 } }}
    >
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <CodeOutlined fontSize="small" /> SQL Query — {widget.title}
      </Typography>
      <TextField
        fullWidth multiline minRows={4} maxRows={12} size="small"
        value={editSql}
        onChange={(e) => setEditSql(e.target.value)}
        inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
      />
      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button
          size="small" variant="contained"
          startIcon={<PlayArrowOutlined />}
          disabled={!editSql.trim()}
          onClick={handleApplySql}
        >
          Apply & Run
        </Button>
        <Button size="small" onClick={() => { setEditSql(activeSql); setSqlAnchor(null) }}>
          Cancel
        </Button>
      </Box>
    </Popover>
  )

  const h = widget.layout.h
  // 80px per grid row unit; subtract gap (16px * (h-1))
  const minH = Math.max(h * 80 - (h - 1) * 4, widget.type === 'kpi' ? 160 : 280)

  if (isLoading) {
    return (
      <Card sx={{ height: '100%', minHeight: minH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Card>
    )
  }
  if (error || !data) {
    return (
      <Card sx={{ height: '100%', minHeight: minH }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <WidgetTypeIcon type={widget.type} /> {widget.title}
            </Typography>
            <Tooltip title="Edit SQL">
              <IconButton size="small" onClick={(e) => setSqlAnchor(e.currentTarget)}>
                <CodeOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Alert severity="warning" sx={{ mt: 1, fontSize: '0.75rem' }}>
            {(error as Error)?.message?.slice(0, 160) ?? 'Query failed'}
          </Alert>
          <Button size="small" startIcon={<RefreshOutlined />} onClick={() => refetch()} sx={{ mt: 0.5 }}>
            Retry
          </Button>
          {sqlPopover}
        </CardContent>
      </Card>
    )
  }

  const rows  = data.rows  ?? []
  const cols  = data.columns ?? []
  const { xField, yField, labelField, valueField } = widget.dataBinding

  return (
    <Card sx={{ height: '100%', minHeight: minH, display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', pb: '8px !important' }}>
        {/* Widget header with SQL toggle */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <WidgetTypeIcon type={widget.type} />
            {widget.title}
          </Typography>
          <Tooltip title="View / Edit SQL">
            <IconButton size="small" onClick={(e) => setSqlAnchor(e.currentTarget)} color={sqlOpen ? 'primary' : 'default'}>
              <CodeOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {sqlPopover}

        {/* KPI */}
        {widget.type === 'kpi' && (() => {
          const kpiCol = valueField || cols[0]
          const val = rows[0]?.[kpiCol]
          const numVal = val != null ? Number(val) : null
          const formatted = numVal != null && !isNaN(numVal)
            ? numVal >= 1_000_000 ? `${(numVal / 1_000_000).toFixed(1)}M`
              : numVal >= 1_000 ? numVal.toLocaleString()
              : numVal.toString()
            : val != null ? String(val) : '—'
          return (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 0.5 }}>
              <Typography
                fontWeight={800}
                color="primary"
                sx={{ fontSize: 'clamp(2rem, 4vw, 3rem)', lineHeight: 1.1 }}
              >
                {formatted}
              </Typography>
              {kpiCol && (
                <Typography variant="caption" color="text.disabled" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.688rem' }}>
                  {String(kpiCol).replace(/_/g, ' ')}
                </Typography>
              )}
              {rows.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.688rem' }}>
                  {rows.length} record{rows.length !== 1 ? 's' : ''}
                </Typography>
              )}
            </Box>
          )
        })()}

        {/* BAR */}
        {widget.type === 'bar' && xField && yField && (
          <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(minH - 56, 180)}>
            <BarChart data={rows.map((r) => ({ name: String(r[xField] ?? ''), value: Number(r[yField] ?? 0) }))} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={rows.length > 6 ? -30 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <RechartTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {rows.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* LINE / AREA */}
        {widget.type === 'line' && xField && yField && (
          <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(minH - 56, 180)}>
            <AreaChart data={rows.map((r) => ({ name: String(r[xField] ?? ''), value: Number(r[yField] ?? 0) }))} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
              <defs>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <RechartTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="value" stroke={CHART_COLORS[0]} fill="url(#lineGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* PIE / DOUGHNUT */}
        {(widget.type === 'pie' || widget.type === 'doughnut') && labelField && valueField && (
          <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(minH - 56, 180)}>
            <PieChart>
              <Pie
                data={rows.map((r) => ({ name: String(r[labelField] ?? ''), value: Number(r[valueField] ?? 0) }))}
                cx="50%"
                cy="50%"
                innerRadius={widget.type === 'doughnut' ? '40%' : 0}
                outerRadius="65%"
                dataKey="value"
                nameKey="name"
              >
                {rows.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <RechartTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}

        {/* TABLE */}
        {widget.type === 'table' && (
          <TableContainer sx={{ flex: 1, overflowY: 'auto', maxHeight: Math.max(minH - 56, 240) }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {cols.map((c) => (
                    <TableCell key={c} sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{c}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.slice(0, 50).map((row, i) => (
                  <TableRow key={i} hover>
                    {cols.map((c) => (
                      <TableCell key={c} sx={{ fontSize: '0.75rem' }}>{String(row[c] ?? '')}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Fallback — unsupported type or missing fields */}
        {((widget.type === 'bar' || widget.type === 'line') && (!xField || !yField)) && (
          <Alert severity="info" sx={{ fontSize: '0.75rem' }}>Missing xField/yField in config</Alert>
        )}
        {((widget.type === 'pie' || widget.type === 'doughnut') && (!labelField || !valueField)) && (
          <Alert severity="info" sx={{ fontSize: '0.75rem' }}>Missing labelField/valueField in config</Alert>
        )}
      </CardContent>
    </Card>
  )
}

// ── Widget type minimums ──────────────────────────────────────────────────────
const TYPE_MIN_H: Record<string, number> = {
  kpi: 2, bar: 4, line: 4, pie: 4, doughnut: 4, table: 5,
}
const TYPE_MIN_W: Record<string, number> = {
  kpi: 3, bar: 4, line: 4, pie: 4, doughnut: 4, table: 6,
}

// ── Layout collision fixer ────────────────────────────────────────────────────
function fixLayout(widgets: DashboardWidget[]): DashboardWidget[] {
  // First pass: enforce minimum h/w per widget type
  const enforced = widgets.map((w) => {
    const minH = TYPE_MIN_H[w.type] ?? 3
    const minW = TYPE_MIN_W[w.type] ?? 3
    return {
      ...w,
      layout: {
        ...w.layout,
        h: Math.max(w.layout.h, minH),
        w: Math.min(12, Math.max(w.layout.w, minW)),
      },
    }
  })

  const sorted = [...enforced].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
  const placed: DashboardWidget[] = []
  for (const widget of sorted) {
    let y = widget.layout.y
    let hasOverlap = true
    while (hasOverlap) {
      hasOverlap = false
      for (const p of placed) {
        const xOverlap = widget.layout.x < p.layout.x + p.layout.w &&
                         widget.layout.x + widget.layout.w > p.layout.x
        const yOverlap = y < p.layout.y + p.layout.h &&
                         y + widget.layout.h > p.layout.y
        if (xOverlap && yOverlap) {
          y = p.layout.y + p.layout.h
          hasOverlap = true
          break
        }
      }
    }
    placed.push({ ...widget, layout: { ...widget.layout, y } })
  }
  return placed
}

// ── Dashboard Grid Renderer ───────────────────────────────────────────────────
function DashboardGrid({
  config,
  connId,
  onSqlChange,
}: {
  config: DashboardConfigSchema
  connId: number
  onSqlChange?: (widgetId: string, sql: string) => void
}) {
  const widgets = fixLayout(config.widgets)
  const maxRow = Math.max(...widgets.map((w) => w.layout.y + w.layout.h), 1)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(12, 1fr)',
        gridTemplateRows: `repeat(${maxRow}, 80px)`,
        gap: 2,
        mt: 1,
      }}
    >
      {widgets.map((widget) => (
        <Box
          key={widget.id}
          sx={{
            gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
            gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
          }}
        >
          <WidgetRenderer widget={widget} connId={connId} onSqlChange={onSqlChange} />
        </Box>
      ))}
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MyDashboardsPage() {
  const { activeProject, activeConnection, setActiveConnection, addDaxMeasures, setPowerBiTab } = useAppStore()
  const connId  = activeConnection?.id ?? ''
  const navigate = useNavigate()
  const location = useLocation()
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  // Mode toggle
  const [mode, setMode] = useState<'intent' | 'sql'>('intent')

  // Shared form state
  const [dashName, setDashName]       = useState('')

  // AI Intent mode state
  const [intent, setIntent]           = useState('')
  const [constraints, setConstraints] = useState('')

  // SQL mode state
  const [sqlText, setSqlText]         = useState('')
  const [sqlIntent, setSqlIntent]     = useState('')
  const [sqlRunning, setSqlRunning]   = useState(false)

  // Generated config + debug state
  const [generatedConfig, setGeneratedConfig] = useState<DashboardConfigSchema | null>(null)
  const [activeConnId, setActiveConnId]       = useState<number | null>(null)
  const [debugMeta, setDebugMeta]             = useState<DashboardDebugMeta | null>(null)
  const [debugOpen, setDebugOpen]             = useState(false)

  // Active saved dashboard
  const [activeSaved, setActiveSaved] = useState<SavedDashboard | null>(null)

  // Section collapse
  const [generateOpen,  setGenerateOpen]  = useState(true)
  const [dashboardOpen, setDashboardOpen] = useState(true)

  const handleModeChange = (_: React.MouseEvent, newMode: 'intent' | 'sql' | null) => {
    if (!newMode) return
    // When switching to SQL mode with an active dashboard, populate with the table widget SQL
    // (broadest query) or the first widget SQL as the master query reference
    if (newMode === 'sql' && generatedConfig && !sqlText.trim()) {
      const tableWidget = generatedConfig.widgets.find((w) => w.type === 'table')
      const master = (tableWidget ?? generatedConfig.widgets[0])?.dataBinding?.sql ?? ''
      if (master) setSqlText(master)
    }
    setMode(newMode)
  }

  // Connections
  const { data: connections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn: () => connectionsApi.list(activeProject?.id),
  })

  // Saved dashboards
  const { data: savedList = [], isLoading: loadingSaved, refetch: refetchSaved } = useQuery({
    queryKey: ['my-dashboards', activeProject?.id],
    queryFn: () => myDashboardsApi.list(activeProject?.id),
  })

  // Auto-load dashboard when navigated from Agents artefact card
  // Fetch by ID directly — avoids project_id / conn_id filter mismatches
  useEffect(() => {
    const dashId = (location.state as { dashboardId?: number } | null)?.dashboardId
    if (!dashId) return
    window.history.replaceState({}, '') // clear state so back-nav doesn't re-trigger
    myDashboardsApi.get(dashId)
      .then((d) => {
        handleLoadSaved(d)
        refetchSaved() // refresh the saved list so the dropdown shows the new dashboard
      })
      .catch(() => { /* dashboard may not exist yet — ignore */ })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: () => myDashboardsApi.generate(intent, connId as number, constraints),
    onSuccess: (r) => {
      setGeneratedConfig(r.config)
      setActiveConnId(connId as number)
      setActiveSaved(null)
      // Pick the table widget SQL (or first widget) as the master SQL reference
      const tableW = r.config.widgets.find((w) => w.type === 'table')
      const masterSql = (tableW ?? r.config.widgets[0])?.dataBinding?.sql ?? ''
      setDebugMeta({ ...r.debug, source_sql: masterSql || undefined })
      setDashName(r.config.tabName ?? 'My Dashboard')
      setGenerateOpen(false)
      setDashboardOpen(true)
      enqueueSnackbar('Dashboard generated!', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  // Save mutation — updates existing if activeSaved, otherwise creates new
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name:        dashName || 'Untitled Dashboard',
        description: generatedConfig?.description,
        config_json: JSON.stringify(generatedConfig),
        debug_json:  debugMeta ? JSON.stringify(debugMeta) : undefined,
        conn_id:     activeConnId ?? undefined,
        project_id:  activeProject?.id,
      }
      return activeSaved
        ? myDashboardsApi.update(activeSaved.id, payload)
        : myDashboardsApi.save(payload)
    },
    onSuccess: (saved) => {
      setActiveSaved(saved)
      qc.invalidateQueries({ queryKey: ['my-dashboards'] })
      enqueueSnackbar('Dashboard saved!', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => myDashboardsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-dashboards'] })
      enqueueSnackbar('Deleted', { variant: 'info' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  // Power BI export
  const [pbiResult, setPbiResult]       = useState<PowerBIExport | null>(null)
  const [pbiDialogOpen, setPbiDialogOpen] = useState(false)
  const [pbiTab, setPbiTab]             = useState(0)
  const pbiMutation = useMutation({
    mutationFn: (id: number) => myDashboardsApi.powerBiExport(id),
    onSuccess: (res) => { setPbiResult(res); setPbiTab(0); setPbiDialogOpen(true) },
    onError: () => enqueueSnackbar('Power BI export failed', { variant: 'error' }),
  })

  const _pbiDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }
  const handleDaxDownload  = () => pbiResult && _pbiDownload(pbiResult.dax_script, 'measures.dax', 'text/plain')
  const handleTmslDownload = () => pbiResult && _pbiDownload(JSON.stringify(pbiResult.tmsl_json, null, 2), 'tabular-model.json', 'application/json')
  const handleGuideDownload = () => pbiResult && _pbiDownload(pbiResult.build_guide, 'powerbi-build-guide.md', 'text/markdown')
  const handleFullDownload  = () => pbiResult && _pbiDownload(JSON.stringify(pbiResult, null, 2), 'powerbi-export-full.json', 'application/json')

  const handleRunAndVisualize = async () => {
    if (!sqlText.trim() || !connId) return
    setSqlRunning(true)
    try {
      const result = await connectionsApi.runQuery(connId as number, sqlText)
      const rows    = result.rows   ?? []
      const columns = result.columns ?? []
      if (rows.length === 0) {
        enqueueSnackbar('Query returned no rows', { variant: 'warning' })
        setSqlRunning(false)
        return
      }
      const r = await myDashboardsApi.generateFromSql(
        sqlText,
        columns,
        rows.slice(0, 10) as Record<string, unknown>[],
        connId as number,
        sqlIntent,
      )
      setGeneratedConfig(r.config)
      setActiveConnId(connId as number)
      setActiveSaved(null)
      setDebugMeta({ ...r.debug, source_sql: sqlText })
      setDashName(r.config.tabName ?? 'SQL Dashboard')
      setGenerateOpen(false)
      setDashboardOpen(true)
      enqueueSnackbar('Dashboard generated!', { variant: 'success' })
    } catch (e: unknown) {
      enqueueSnackbar((e as Error).message ?? 'Failed', { variant: 'error' })
    } finally {
      setSqlRunning(false)
    }
  }

  const handleLoadSaved = (d: SavedDashboard) => {
    try {
      const cfg = JSON.parse(d.config_json) as DashboardConfigSchema
      setGeneratedConfig(cfg)
      setActiveConnId(d.conn_id ?? null)
      setActiveSaved(d)
      setDashName(d.name)
      if (d.conn_id) {
        const conn = connections.find((c) => c.id === d.conn_id)
        if (conn) setActiveConnection(conn)
      }
      // Load stored debug metadata if available
      const meta = d.debug_json ? (JSON.parse(d.debug_json) as DashboardDebugMeta) : null
      setDebugMeta(meta)
      // Restore mode based on how the dashboard was generated
      if (meta?.source_sql) {
        setMode('sql')
        setSqlText(meta.source_sql)
      } else {
        setMode('intent')
      }
      // Show the dashboard output; keep generate form collapsed
      setGenerateOpen(false)
      setDashboardOpen(true)
    } catch {
      enqueueSnackbar('Failed to parse dashboard config', { variant: 'error' })
    }
  }

  const currentConfig  = generatedConfig
  const currentConnId  = activeConnId ?? (connId as number | null)

  const savedForConn = savedList.filter((d) => !connId || d.conn_id === connId)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 56 }}>
        <AutoAwesomeOutlined color="primary" sx={{ flexShrink: 0 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flexShrink: 0 }}>My Dashboards</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>AI-generated dynamic dashboards</Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Saved dashboards dropdown */}
          {savedForConn.length > 0 && (
            <Autocomplete
              size="small"
              options={savedForConn}
              getOptionLabel={(d) => d.name}
              value={activeSaved}
              onChange={(_, d) => { if (d) { handleLoadSaved(d); setDashboardOpen(true) } }}
              sx={{ width: 240 }}
              renderInput={(params) => (
                <TextField {...params} placeholder="Load saved dashboard…"
                  InputProps={{ ...params.InputProps, startAdornment: <BookmarkOutlined sx={{ fontSize: 15, color: 'text.disabled', mr: 0.5 }} /> }} />
              )}
              renderOption={(props, d) => (
                <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ overflow: 'hidden' }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{d.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexShrink: 0 }}>
                    <Tooltip title="Export to Power BI">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); pbiMutation.mutate(d.id) }}>
                        {pbiMutation.isPending && pbiMutation.variables === d.id ? <CircularProgress size={13} /> : <BarChartOutlined sx={{ fontSize: 14 }} />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(d.id) }}>
                        <DeleteOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              )}
            />
          )}
          <Tooltip title="New dashboard">
            <IconButton size="small" onClick={() => { setGeneratedConfig(null); setActiveSaved(null); setIntent(''); setDashName(''); setMode('intent'); setGenerateOpen(true) }}>
              <AddOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {/* ── Generate form (collapsible) ── */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2 }}>
          {/* Header */}
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: generateOpen ? '1px solid' : 'none', borderColor: 'divider' }}
            onClick={() => setGenerateOpen((v) => !v)}
          >
            {generateOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={600}>Generate a Dashboard</Typography>
              {/* Preview text when collapsed */}
              {!generateOpen && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block', fontFamily: mode === 'sql' ? 'monospace' : 'inherit', fontSize: '0.72rem', opacity: 0.8 }}
                >
                  {mode === 'sql' && sqlText ? sqlText.replace(/\s+/g, ' ').trim() : mode === 'intent' && intent ? intent : ''}
                </Typography>
              )}
            </Box>
            <Box onClick={(e) => e.stopPropagation()}>
              <ToggleButtonGroup value={mode} exclusive size="small" onChange={handleModeChange}>
                <ToggleButton value="intent" sx={{ px: 1.5, fontSize: '0.75rem', height: 30 }}>
                  <AutoAwesomeOutlined sx={{ fontSize: 14, mr: 0.5 }} /> AI Intent
                </ToggleButton>
                <ToggleButton value="sql" sx={{ px: 1.5, fontSize: '0.75rem', height: 30 }}>
                  <StorageOutlined sx={{ fontSize: 14, mr: 0.5 }} /> SQL Query
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>

          <Collapse in={generateOpen}>
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {mode === 'intent' && (
                <>
                  <TextField fullWidth size="small" label="What do you want to see?"
                    placeholder="e.g. Sales performance by region with monthly trends and top 5 products"
                    value={intent} onChange={(e) => setIntent(e.target.value)} multiline rows={2} />
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <TextField fullWidth size="small"
                      placeholder="Constraints (optional) — e.g. Focus on 2024 data, use bar charts"
                      value={constraints} onChange={(e) => setConstraints(e.target.value)} />
                    <Button variant="contained" sx={{ whiteSpace: 'nowrap', minWidth: 130, height: 36, flexShrink: 0 }}
                      startIcon={generateMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
                      disabled={!intent.trim() || !connId || generateMutation.isPending}
                      onClick={() => generateMutation.mutate()}>
                      {generateMutation.isPending ? 'Generating…' : 'Generate'}
                    </Button>
                  </Box>
                </>
              )}
              {mode === 'sql' && (
                <>
                  <TextField fullWidth size="small" label="SQL Query"
                    placeholder="SELECT * FROM EMP JOIN DEPT ON EMP.DEPTNO = DEPT.DEPTNO"
                    value={sqlText} onChange={(e) => setSqlText(e.target.value)}
                    multiline minRows={3} maxRows={10}
                    inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }} />
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <TextField fullWidth size="small"
                      placeholder="Visualization hint (optional) — e.g. Show trend over time"
                      value={sqlIntent} onChange={(e) => setSqlIntent(e.target.value)} />
                    <Button variant="contained" sx={{ whiteSpace: 'nowrap', minWidth: 160, height: 36, flexShrink: 0 }}
                      startIcon={sqlRunning ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
                      disabled={!sqlText.trim() || !connId || sqlRunning}
                      onClick={handleRunAndVisualize}>
                      {sqlRunning ? 'Running…' : 'Run & Visualize'}
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          </Collapse>
        </Paper>

        {/* ── Dashboard output (collapsible) ── */}
        {currentConfig && currentConnId && (
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2 }}>
            {/* Dashboard header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, borderBottom: dashboardOpen ? '1px solid' : 'none', borderColor: 'divider' }}>
              {/* Left — collapse toggle + title + chips */}
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden' }}
                onClick={() => setDashboardOpen((v) => !v)}
              >
                {dashboardOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
                <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ flexShrink: 0 }}>{currentConfig.tabName}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {currentConfig.widgets.map((w) => (
                    <Chip key={w.id} label={w.type} size="small" icon={<WidgetTypeIcon type={w.type} />} sx={{ height: 20, fontSize: '0.65rem', flexShrink: 0 }} />
                  ))}
                </Box>
              </Box>
              {/* Right — actions */}
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                <Tooltip title="AI Debug Panel">
                  <IconButton size="small" onClick={() => setDebugOpen(true)} color="info">
                    <BugReportOutlined fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={activeSaved ? 'Export to Power BI' : 'Save dashboard first to export to Power BI'}>
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={pbiMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <BarChartOutlined />}
                      disabled={!activeSaved || pbiMutation.isPending}
                      onClick={() => activeSaved && pbiMutation.mutate(activeSaved.id)}
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      Power BI
                    </Button>
                  </span>
                </Tooltip>
                <Button variant="contained" size="small" color="success"
                  startIcon={saveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                  disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  Save
                </Button>
              </Box>
            </Box>

            <Collapse in={dashboardOpen} unmountOnExit>
              <Box sx={{ p: 2 }}>
                {/* Name field + description row */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <TextField size="small" label="Dashboard Name" value={dashName}
                    onChange={(e) => setDashName(e.target.value)} sx={{ width: 260, flexShrink: 0 }} />
                  {currentConfig.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1, lineHeight: 1.4 }}>
                      {currentConfig.description}
                    </Typography>
                  )}
                </Box>
                <DashboardGrid
                  config={currentConfig}
                  connId={currentConnId}
                  onSqlChange={(widgetId, sql) => {
                    setGeneratedConfig((prev) => {
                      if (!prev) return prev
                      return { ...prev, widgets: prev.widgets.map((w) => w.id === widgetId ? { ...w, dataBinding: { ...w.dataBinding, sql } } : w) }
                    })
                  }}
                />
              </Box>
            </Collapse>
          </Paper>
        )}

        {!currentConfig && (
          <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
            <AutoAwesomeOutlined sx={{ fontSize: 48, opacity: 0.3, mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              {mode === 'intent' ? 'Describe what you want to see' : 'Write a SQL query to visualize'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {mode === 'intent'
                ? 'Select a connection, enter your intent, and click Generate'
                : 'Select a connection, enter your SQL, and click Run & Visualize'}
            </Typography>
          </Box>
        )}
      </Box>


      {/* AI Debug Drawer */}
      {currentConfig && currentConnId && (
        <AIDebugPanel
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          config={currentConfig}
          debug={debugMeta}
          connId={currentConnId}
          originalIntent={intent}
          onWidgetUpdate={(updatedWidget) => {
            setGeneratedConfig((prev) => {
              if (!prev) return prev
              return {
                ...prev,
                widgets: prev.widgets.map((w) =>
                  w.id === updatedWidget.id ? updatedWidget : w
                ),
              }
            })
          }}
        />
      )}

      {/* Power BI Export Dialog */}
      {pbiDialogOpen && pbiResult && (
        <Dialog open onClose={() => setPbiDialogOpen(false)} maxWidth="md" fullWidth
          PaperProps={{ sx: { borderRadius: 3, height: '85vh' } }}>
          <DialogTitle sx={{ pb: 0 }}>
            <Typography variant="h6" fontWeight={700}>Power BI Export Package</Typography>
            <Typography variant="caption" color="text.secondary">
              {pbiResult.dax_measures.length} DAX measures &nbsp;·&nbsp;
              {pbiResult.dataset_schema.tables.length} tables &nbsp;·&nbsp;
              {(pbiResult.dataset_schema.relationships ?? []).length} relationships
            </Typography>
          </DialogTitle>

          {/* Tab bar */}
          <Tabs value={pbiTab} onChange={(_, v) => setPbiTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label="Overview"     icon={<BarChartOutlined sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.8rem' }} />
            <Tab label="DAX Measures" icon={<CodeOutlined sx={{ fontSize: 16 }} />}     iconPosition="start" sx={{ minHeight: 40, fontSize: '0.8rem' }} />
            <Tab label="Dataset / TMSL" icon={<StorageOutlined sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.8rem' }} />
            <Tab label="Build Guide"  icon={<MenuBookOutlined sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.8rem' }} />
          </Tabs>

          <DialogContent dividers sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* ── Overview tab ── */}
            {pbiTab === 0 && (
              <Box sx={{ p: 3, overflow: 'auto', flex: 1 }}>
                <Alert severity="success" sx={{ mb: 2 }}>
                  AI-generated Power BI artifacts are ready. Download each file or use the build guide to manually import into Power BI Desktop.
                </Alert>

                {/* Send to Measure Library */}
                {pbiResult.dax_measures.length > 0 && (
                  <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'primary.main',
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.04), display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={700}>Send to Power BI Measure Library</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Import all {pbiResult.dax_measures.length} generated measures into the Measure Library for editing and export.
                      </Typography>
                    </Box>
                    <Button variant="contained" size="small" startIcon={<BarChartOutlined />}
                      sx={{ whiteSpace: 'nowrap' }}
                      onClick={() => {
                        addDaxMeasures(pbiResult.dax_measures.map((m) => ({
                          name:        m.name,
                          table:       m.table ?? 'Measures',
                          code:        m.expression,
                          description: m.description ?? '',
                        })))
                        enqueueSnackbar(`${pbiResult.dax_measures.length} measures added to library`, { variant: 'success' })
                        setPbiDialogOpen(false)
                        setPowerBiTab(1)
                        navigate('/powerbi')
                      }}
                    >
                      Open in Library
                    </Button>
                  </Box>
                )}

                {/* Download buttons */}
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Download Files</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
                  <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={handleDaxDownload}
                    sx={{ borderRadius: 2, textTransform: 'none' }}>
                    measures.dax
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(Tabular Editor)</Typography>
                  </Button>
                  <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={handleTmslDownload}
                    sx={{ borderRadius: 2, textTransform: 'none' }}>
                    tabular-model.json
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(TMSL)</Typography>
                  </Button>
                  <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={handleGuideDownload}
                    sx={{ borderRadius: 2, textTransform: 'none' }}>
                    build-guide.md
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(Markdown)</Typography>
                  </Button>
                  <Button variant="contained" startIcon={<SaveOutlined />} onClick={handleFullDownload}
                    sx={{ borderRadius: 2, textTransform: 'none' }}>
                    Full Export .json
                  </Button>
                </Box>

                {/* Summary cards */}
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={4}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="primary.main">{pbiResult.dax_measures.length}</Typography>
                      <Typography variant="caption" color="text.secondary">DAX Measures</Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={4}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="primary.main">{pbiResult.dataset_schema.tables.length}</Typography>
                      <Typography variant="caption" color="text.secondary">Tables</Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={4}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="primary.main">{(pbiResult.dataset_schema.relationships ?? []).length}</Typography>
                      <Typography variant="caption" color="text.secondary">Relationships</Typography>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Tables list */}
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Tables</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                  {pbiResult.dataset_schema.tables.map((t) => (
                    <Chip key={t.name} icon={<StorageOutlined sx={{ fontSize: 14 }} />}
                      label={`${t.name} (${t.columns.length} cols)`} size="small" variant="outlined" />
                  ))}
                </Box>

                {/* Relationships */}
                {(pbiResult.dataset_schema.relationships ?? []).length > 0 && (<>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Relationships</Typography>
                  {(pbiResult.dataset_schema.relationships ?? []).map((r, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, fontSize: '0.8rem' }}>
                      <AccountTreeOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {r.fromTable}[{r.fromColumn}] → {r.toTable}[{r.toColumn}]
                      </Typography>
                    </Box>
                  ))}
                </>)}
              </Box>
            )}

            {/* ── DAX Measures tab ── */}
            {pbiTab === 1 && (
              <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
                  <Button size="small" startIcon={<DownloadOutlined />} onClick={handleDaxDownload}
                    variant="outlined" sx={{ borderRadius: 2, textTransform: 'none' }}>
                    Download .dax
                  </Button>
                </Box>
                {pbiResult.dax_measures.map((m) => (
                  <Paper key={m.name} variant="outlined" sx={{ p: 1.5, mb: 1, borderRadius: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" fontWeight={700}>{m.name}</Typography>
                      {m.table && <Chip label={m.table} size="small" sx={{ height: 16, fontSize: '0.65rem' }} />}
                    </Box>
                    {m.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {m.description}
                      </Typography>
                    )}
                    <Box sx={{ fontFamily: 'monospace', fontSize: '0.75rem', bgcolor: alpha('#000', 0.04),
                      p: 1, borderRadius: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {m.expression}
                    </Box>
                  </Paper>
                ))}
                {/* Raw .dax script preview */}
                <Divider sx={{ my: 2 }} />
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  .dax script preview (for Tabular Editor)
                </Typography>
                <Box sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.72rem', bgcolor: alpha('#000', 0.04),
                  p: 1.5, borderRadius: 1, whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>
                  {pbiResult.dax_script}
                </Box>
              </Box>
            )}

            {/* ── Dataset / TMSL tab ── */}
            {pbiTab === 2 && (
              <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
                  <Button size="small" startIcon={<DownloadOutlined />} onClick={handleTmslDownload}
                    variant="outlined" sx={{ borderRadius: 2, textTransform: 'none' }}>
                    Download TMSL .json
                  </Button>
                </Box>
                <Alert severity="info" sx={{ mb: 2, fontSize: '0.8rem' }}>
                  TMSL (Tabular Model Scripting Language) can be imported via <strong>Tabular Editor</strong> or executed in SSMS against a Power BI Analysis Services endpoint.
                </Alert>
                <Box sx={{ fontFamily: 'monospace', fontSize: '0.72rem', bgcolor: alpha('#000', 0.04),
                  p: 1.5, borderRadius: 1, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
                  {JSON.stringify(pbiResult.tmsl_json, null, 2)}
                </Box>
              </Box>
            )}

            {/* ── Build Guide tab ── */}
            {pbiTab === 3 && (
              <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
                  <Button size="small" startIcon={<DownloadOutlined />} onClick={handleGuideDownload}
                    variant="outlined" sx={{ borderRadius: 2, textTransform: 'none' }}>
                    Download .md
                  </Button>
                </Box>
                <Box sx={{ fontFamily: 'monospace', fontSize: '0.78rem', whiteSpace: 'pre-wrap',
                  bgcolor: alpha('#000', 0.03), p: 2, borderRadius: 1, lineHeight: 1.7 }}>
                  {pbiResult.build_guide}
                </Box>
              </Box>
            )}

          </DialogContent>

          <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
            <Button onClick={() => setPbiDialogOpen(false)}>Close</Button>
            <Button variant="contained" startIcon={<SaveOutlined />} onClick={handleFullDownload}>
              Download Full Export
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
