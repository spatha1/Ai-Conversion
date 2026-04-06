import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Paper, Divider, IconButton, Tooltip, CircularProgress,
  List, ListItemButton, ListItemText, ListItemSecondaryAction,
  Select, MenuItem, FormControl, InputLabel, Chip, Alert,
  Popover, alpha, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import {
  DeleteOutlined, SaveOutlined, AutoAwesomeOutlined,
  AddOutlined, RefreshOutlined, BarChartOutlined,
  TrendingUpOutlined, PieChartOutlined, TableChartOutlined,
  NumbersOutlined, CodeOutlined, PlayArrowOutlined, BugReportOutlined,
  StorageOutlined,
} from '@mui/icons-material'
import AIDebugPanel from './AIDebugPanel'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { connectionsApi, myDashboardsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { DashboardWidget, DashboardConfigSchema, SavedDashboard, DashboardDebugMeta } from '@/types'

const CHART_COLORS = ['#2563eb', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#0284c7', '#db2777']

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
  const minH = h <= 2 ? 100 : h <= 4 ? 220 : 320

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
          const val = valueField ? rows[0]?.[valueField] : rows[0]?.[cols[0]]
          return (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Typography variant="h3" fontWeight={700} color="primary">
                {val != null ? String(val) : '—'}
              </Typography>
            </Box>
          )
        })()}

        {/* BAR */}
        {widget.type === 'bar' && xField && yField && (
          <ResponsiveContainer width="100%" height={Math.max(minH - 60, 140)}>
            <BarChart data={rows.map((r) => ({ name: String(r[xField] ?? ''), value: Number(r[yField] ?? 0) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {rows.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* LINE / AREA */}
        {widget.type === 'line' && xField && yField && (
          <ResponsiveContainer width="100%" height={Math.max(minH - 60, 140)}>
            <AreaChart data={rows.map((r) => ({ name: String(r[xField] ?? ''), value: Number(r[yField] ?? 0) }))}>
              <defs>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="value" stroke={CHART_COLORS[0]} fill="url(#lineGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* PIE / DOUGHNUT */}
        {(widget.type === 'pie' || widget.type === 'doughnut') && labelField && valueField && (
          <ResponsiveContainer width="100%" height={Math.max(minH - 60, 140)}>
            <PieChart>
              <Pie
                data={rows.map((r) => ({ name: String(r[labelField] ?? ''), value: Number(r[valueField] ?? 0) }))}
                cx="50%"
                cy="50%"
                innerRadius={widget.type === 'doughnut' ? '45%' : 0}
                outerRadius="75%"
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
          <TableContainer sx={{ flex: 1, overflowY: 'auto', maxHeight: Math.max(minH - 60, 200) }}>
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

// ── Layout collision fixer ────────────────────────────────────────────────────
function fixLayout(widgets: DashboardWidget[]): DashboardWidget[] {
  const sorted = [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
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
        gridTemplateRows: `repeat(${maxRow}, 100px)`,
        gap: 1.5,
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
  const { activeProject } = useAppStore()
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  // Mode toggle
  const [mode, setMode] = useState<'intent' | 'sql'>('intent')

  // Shared form state
  const [connId, setConnId]           = useState<number | ''>('')
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
  const { data: savedList = [], isLoading: loadingSaved } = useQuery({
    queryKey: ['my-dashboards', activeProject?.id],
    queryFn: () => myDashboardsApi.list(activeProject?.id),
  })

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
      if (d.conn_id) setConnId(d.conn_id)
      // Load stored debug metadata if available
      const meta = d.debug_json ? (JSON.parse(d.debug_json) as DashboardDebugMeta) : null
      setDebugMeta(meta)
      // Restore SQL mode + query if this was a SQL-generated dashboard
      if (meta?.source_sql) {
        setMode('sql')
        setSqlText(meta.source_sql)
      }
    } catch {
      enqueueSnackbar('Failed to parse dashboard config', { variant: 'error' })
    }
  }

  const currentConfig  = generatedConfig
  const currentConnId  = activeConnId ?? (connId as number | null)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeOutlined color="primary" />
        <Typography variant="h6" fontWeight={700}>My Dashboards</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          AI-generated dynamic dashboards from your data
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── Left panel: saved list ── */}
        <Box
          sx={{
            width: 250, flexShrink: 0, borderRight: 1, borderColor: 'divider',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" fontWeight={600}>Saved</Typography>
            <Tooltip title="New dashboard">
              <IconButton size="small" onClick={() => { setGeneratedConfig(null); setActiveSaved(null); setIntent(''); setDashName('') }}>
                <AddOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Divider />
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            {loadingSaved && (
              <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={20} />
              </Box>
            )}
            {!loadingSaved && savedList.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
                No saved dashboards yet.
              </Typography>
            )}
            <List dense disablePadding>
              {savedList.map((d) => (
                <ListItemButton
                  key={d.id}
                  selected={activeSaved?.id === d.id}
                  onClick={() => handleLoadSaved(d)}
                  sx={{ pr: 5 }}
                >
                  <ListItemText
                    primary={d.name}
                    secondary={d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: activeSaved?.id === d.id ? 600 : 400, noWrap: true }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                  <ListItemSecondaryAction>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(d.id) }}
                      >
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItemButton>
              ))}
            </List>
          </Box>
        </Box>

        {/* ── Right panel: generate + view ── */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {/* Generate form */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={600}>Generate a Dashboard</Typography>
              <ToggleButtonGroup
                value={mode}
                exclusive
                size="small"
                onChange={handleModeChange}
              >
                <ToggleButton value="intent" sx={{ px: 1.5, fontSize: '0.75rem' }}>
                  <AutoAwesomeOutlined sx={{ fontSize: 14, mr: 0.5 }} /> AI Intent
                </ToggleButton>
                <ToggleButton value="sql" sx={{ px: 1.5, fontSize: '0.75rem' }}>
                  <StorageOutlined sx={{ fontSize: 14, mr: 0.5 }} /> SQL Query
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>

            <Grid container spacing={2}>
              {/* Connection selector — shared by both modes */}
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Data Connection</InputLabel>
                  <Select
                    value={connId}
                    label="Data Connection"
                    onChange={(e) => setConnId(e.target.value as number)}
                  >
                    {connections.map((c) => (
                      <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {mode === 'intent' && (
                <>
                  <Grid item xs={12} sm={8}>
                    <TextField
                      fullWidth size="small"
                      label="What do you want to see?"
                      placeholder="e.g. Sales performance by region with monthly trends and top 5 products"
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                      multiline rows={2}
                    />
                  </Grid>
                  <Grid item xs={12} sm={8}>
                    <TextField
                      fullWidth size="small"
                      label="Constraints (optional)"
                      placeholder="e.g. Focus on 2024 data, use bar charts for comparisons"
                      value={constraints}
                      onChange={(e) => setConstraints(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button
                      fullWidth variant="contained"
                      startIcon={generateMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
                      disabled={!intent.trim() || !connId || generateMutation.isPending}
                      onClick={() => generateMutation.mutate()}
                    >
                      {generateMutation.isPending ? 'Generating…' : 'Generate'}
                    </Button>
                  </Grid>
                </>
              )}

              {mode === 'sql' && (
                <>
                  <Grid item xs={12} sm={8}>
                    <TextField
                      fullWidth size="small"
                      label="SQL Query"
                      placeholder="Write one master SQL query — e.g. SELECT * FROM EMP JOIN DEPT ON EMP.DEPTNO = DEPT.DEPTNO"
                      value={sqlText}
                      onChange={(e) => setSqlText(e.target.value)}
                      multiline minRows={4} maxRows={10}
                      inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={8}>
                    <TextField
                      fullWidth size="small"
                      label="Visualization hint (optional)"
                      placeholder="e.g. Show trend over time, highlight top categories"
                      value={sqlIntent}
                      onChange={(e) => setSqlIntent(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'flex-end' }}>
                    <Button
                      fullWidth variant="contained"
                      startIcon={sqlRunning ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
                      disabled={!sqlText.trim() || !connId || sqlRunning}
                      onClick={handleRunAndVisualize}
                    >
                      {sqlRunning ? 'Running…' : 'Run & Visualize'}
                    </Button>
                  </Grid>
                </>
              )}
            </Grid>
          </Paper>

          {/* Generated / loaded dashboard */}
          {currentConfig && currentConnId && (
            <>
              {/* Save bar */}
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5,
                borderRadius: 2, bgcolor: (t) => alpha(t.palette.success.main, 0.06),
                border: '1px solid', borderColor: (t) => alpha(t.palette.success.main, 0.2),
              }}>
                <AutoAwesomeOutlined sx={{ color: 'success.main', fontSize: 18 }} />
                <TextField
                  size="small"
                  label="Dashboard name"
                  value={dashName}
                  onChange={(e) => setDashName(e.target.value)}
                  sx={{ flex: 1, maxWidth: 280 }}
                />
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flex: 1 }}>
                  {currentConfig.widgets.map((w) => (
                    <Chip key={w.id} label={w.type} size="small" icon={<WidgetTypeIcon type={w.type} />} />
                  ))}
                </Box>
                <Tooltip title="AI Debug Panel — view prompts, SQL, regenerate widgets">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<BugReportOutlined />}
                    onClick={() => setDebugOpen(true)}
                    color="info"
                  >
                    AI Debug
                  </Button>
                </Tooltip>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={saveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                  color="success"
                >
                  Save
                </Button>
              </Box>

              {/* Dashboard title */}
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                {currentConfig.tabName}
              </Typography>
              {currentConfig.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {currentConfig.description}
                </Typography>
              )}

              {/* Widget grid */}
              <DashboardGrid
                config={currentConfig}
                connId={currentConnId}
                onSqlChange={(widgetId, sql) => {
                  setGeneratedConfig((prev) => {
                    if (!prev) return prev
                    return {
                      ...prev,
                      widgets: prev.widgets.map((w) =>
                        w.id === widgetId
                          ? { ...w, dataBinding: { ...w.dataBinding, sql } }
                          : w
                      ),
                    }
                  })
                }}
              />
            </>
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
    </Box>
  )
}
