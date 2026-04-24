/**
 * Testing / Reconciliation Page — Dev vs Base Reconciliation Engine
 *
 * Tabs:
 *   0. BASE Query Library  — auto-generate & manage Q2 (BASE) queries
 *   1. Run DEV vs BASE     — select Q1 (DEV) source, launch reconciliation
 *   2. Results & Insights  — per-run expandable result cards + AI root-cause
 *   3. Dashboard           — KPIs, confidence gauge, root-cause distribution
 */
import {
  Box, Typography, Tabs, Tab, Button, Chip, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Select, FormControl, InputLabel,
  CircularProgress, Alert, Tooltip, alpha, Divider, Grid,
  Card, CardContent, Collapse, LinearProgress, ToggleButton,
  ToggleButtonGroup, Stack, Badge,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, PlayArrowOutlined,
  AutoAwesomeOutlined, RefreshOutlined, CheckCircleOutlined,
  CancelOutlined, ErrorOutlined, FactCheckOutlined,
  AssessmentOutlined, EditOutlined, ExpandMoreOutlined,
  ExpandLessOutlined, LightbulbOutlined, InfoOutlined,
  StorageOutlined, CodeOutlined, CompareArrowsOutlined,
  BarChartOutlined, TuneOutlined, WarningAmberOutlined,
  SkipNextOutlined, TableChartOutlined, UploadFileOutlined,
  InsertDriveFileOutlined, ClearOutlined,
} from '@mui/icons-material'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { reconciliationApi, connectionsApi, reportApi, psApi, myDashboardsApi, developmentApi, multiCompareApi } from '@/api'
import type {
  TestQuery, TestQueryCreate, ReconciliationResult, RecRunSummary,
  CollectQueriesResult, AiInsight, SavedDashboard,
  DevArtifact, Workflow, SourceSummaryGroup,
  SourceConnection, MultiCompareResult, MultiCompareCheck,
} from '@/types'
import { tokens } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'

// ── Types ──────────────────────────────────────────────────────────────────────

type DevSourceType = 'mapper' | 'dashboard' | 'report' | 'ps_workflow' | 'dev_artifact' | 'adhoc'

interface SavedReport { id: number; name: string; query_sql?: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const QUERY_TYPE_LABELS: Record<string, string> = {
  count:          'Row Count',
  agg:            'Aggregate',
  distribution:   'Distribution',
  set_diff:       'Set Diff',
  duplicate:      'Duplicate',
  join_explosion: 'Join Explosion',
  filter_impact:  'Filter Impact',
  sample_value:   'Sample Value',
  custom:         'Custom',
}

const QUERY_TYPE_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'> = {
  count:          'primary',
  agg:            'info',
  distribution:   'secondary',
  set_diff:       'warning',
  duplicate:      'error',
  join_explosion: 'error',
  filter_impact:  'warning',
  sample_value:   'default',
  custom:         'default',
}

const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  PASS:  'success',
  FAIL:  'error',
  WARN:  'warning',
  ERROR: 'error',
  SKIP:  'default',
}

const ROOT_CAUSE_LABELS: Record<string, string> = {
  join_duplication:        'Join Duplication',
  filter_exclusion:        'Filter Exclusion',
  missing_records:         'Missing Records',
  aggregation_distortion:  'Aggregation Distortion',
  value_mapping_mismatch:  'Value Mapping Mismatch',
  unknown:                 'Unknown',
}

const DEV_SOURCE_OPTIONS: { value: DevSourceType; label: string }[] = [
  { value: 'mapper',       label: 'Conversion Mapper' },
  { value: 'dashboard',    label: 'Dashboard Widget' },
  { value: 'report',       label: 'Saved Report' },
  { value: 'ps_workflow',  label: 'PS Workflow Step' },
  { value: 'dev_artifact', label: 'Dev Artifact' },
  { value: 'adhoc',        label: 'Ad-hoc SQL' },
]

const VALID_QUERY_TYPES = [
  'count', 'agg', 'distribution', 'set_diff', 'duplicate',
  'join_explosion', 'filter_impact', 'sample_value', 'custom',
] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const icons: Record<string, React.ReactNode> = {
    PASS:  <CheckCircleOutlined fontSize="small" />,
    FAIL:  <CancelOutlined fontSize="small" />,
    WARN:  <WarningAmberOutlined fontSize="small" />,
    ERROR: <ErrorOutlined fontSize="small" />,
    SKIP:  <SkipNextOutlined fontSize="small" />,
  }
  return (
    <Chip
      size="small"
      color={STATUS_COLORS[status] ?? 'default'}
      icon={icons[status] as any}
      label={status}
      sx={{ fontWeight: 700, minWidth: 72 }}
    />
  )
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error'
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Confidence Score</Typography>
        <Typography variant="caption" fontWeight={700} color={`${color}.main`}>{pct}%</Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={color}
        sx={{ height: 8, borderRadius: 4 }}
      />
    </Box>
  )
}

function parseAiInsight(raw: string | null): AiInsight | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ── ResultCard ─────────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: ReconciliationResult }) {
  const [open, setOpen] = useState(false)
  const insight = parseAiInsight(result.ai_insight)

  const baseParsed = useMemo(() => {
    if (!result.base_result) return null
    try { return JSON.parse(result.base_result) } catch { return result.base_result }
  }, [result.base_result])

  const devParsed = useMemo(() => {
    if (!result.dev_result) return null
    try { return JSON.parse(result.dev_result) } catch { return result.dev_result }
  }, [result.dev_result])

  return (
    <Paper variant="outlined" sx={{ mb: 1, overflow: 'hidden' }}>
      {/* Collapsed header */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, p: 1.5,
          cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={() => setOpen(o => !o)}
      >
        <StatusChip status={result.status} />
        <Chip
          size="small"
          label={QUERY_TYPE_LABELS[result.query_type] ?? result.query_type}
          color={QUERY_TYPE_COLORS[result.query_type] ?? 'default'}
          variant="outlined"
        />
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }} noWrap>
          {result.test_name}
        </Typography>
        {result.execution_time_ms != null && (
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
            {result.execution_time_ms}ms
          </Typography>
        )}
        {open ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
      </Box>

      {/* Expanded detail */}
      <Collapse in={open}>
        <Divider />
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* SQL blocks */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" gutterBottom>
                Q2 BASE SQL
              </Typography>
              <Box
                component="pre"
                sx={{
                  bgcolor: 'action.hover', p: 1.5, borderRadius: 1,
                  fontSize: '0.72rem', overflow: 'auto', maxHeight: 160,
                  fontFamily: 'monospace', m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}
              >
                {result.q2_base_sql ?? '—'}
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" gutterBottom>
                Derived Q1 DEV SQL
              </Typography>
              <Box
                component="pre"
                sx={{
                  bgcolor: 'action.hover', p: 1.5, borderRadius: 1,
                  fontSize: '0.72rem', overflow: 'auto', maxHeight: 160,
                  fontFamily: 'monospace', m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}
              >
                {result.q1_dev_sql ?? '(not derived — set_diff or custom)'}
              </Box>
            </Grid>
          </Grid>

          {/* Result comparison */}
          {(baseParsed || devParsed) && (
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" gutterBottom>
                BASE vs DEV Results
              </Typography>
              <Grid container spacing={1}>
                <Grid item xs={6}>
                  <Paper variant="outlined" sx={{ p: 1 }}>
                    <Typography variant="caption" color="text.secondary">BASE</Typography>
                    <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                      {typeof baseParsed === 'object' ? JSON.stringify(baseParsed, null, 2) : String(baseParsed ?? '—')}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6}>
                  <Paper variant="outlined" sx={{ p: 1 }}>
                    <Typography variant="caption" color="text.secondary">DEV</Typography>
                    <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                      {typeof devParsed === 'object' ? JSON.stringify(devParsed, null, 2) : String(devParsed ?? '—')}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Issue */}
          {result.issue && (
            <Alert severity="error" icon={<CancelOutlined />}>
              {result.issue}
            </Alert>
          )}

          {/* AI Insight */}
          {insight && (
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <LightbulbOutlined color="warning" fontSize="small" />
                <Typography variant="subtitle2">AI Root Cause Analysis</Typography>
                <Chip
                  size="small"
                  label={ROOT_CAUSE_LABELS[insight.root_cause_category] ?? insight.root_cause_category}
                  color="warning"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`${Math.round((insight.confidence ?? 0) * 100)}% confident`}
                  variant="outlined"
                />
              </Box>
              <Typography variant="body2" fontStyle="italic" color="text.secondary" gutterBottom>
                {insight.explanation}
              </Typography>
              <Alert severity="info" icon={<LightbulbOutlined />} sx={{ mt: 1 }}>
                <strong>Suggestion:</strong> {insight.suggestion}
              </Alert>
              {insight.ai_suggested_fix && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    Suggested Fix SQL
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      bgcolor: 'background.paper', p: 1, borderRadius: 1, mt: 0.5,
                      fontSize: '0.72rem', overflow: 'auto', maxHeight: 120,
                      fontFamily: 'monospace', m: 0, whiteSpace: 'pre-wrap',
                    }}
                  >
                    {insight.ai_suggested_fix}
                  </Box>
                </Box>
              )}
            </Paper>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

// ── Tab 0: BASE Query Library ─────────────────────────────────────────────────

function QueryLibraryTab({ connId }: { connId: number }) {
  const [queries, setQueries] = useState<TestQuery[]>([])
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectResult, setCollectResult] = useState<CollectQueriesResult | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editRow, setEditRow] = useState<TestQuery | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [form, setForm] = useState<TestQueryCreate>({
    query_type: 'custom', name: '', sql_text: '', priority: 0, severity: 'error', dev_source_tag: null,
  })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    reconciliationApi.listQueries(connId)
      .then(setQueries)
      .catch(e => setError(e?.response?.data?.detail ?? e.message))
      .finally(() => setLoading(false))
  }, [connId])

  useEffect(() => { load() }, [load])

  const handleCollect = async () => {
    setCollecting(true)
    setCollectResult(null)
    setError(null)
    try {
      const res = await reconciliationApi.collectQueries(connId)
      setCollectResult(res)
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message)
    } finally {
      setCollecting(false)
    }
  }

  const handleSave = async () => {
    try {
      if (editRow) {
        await reconciliationApi.updateQuery(connId, editRow.id, form)
      } else {
        await reconciliationApi.addQuery(connId, form)
      }
      setAddOpen(false)
      setEditRow(null)
      setForm({ query_type: 'custom', name: '', sql_text: '', priority: 0, severity: 'error' })
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await reconciliationApi.deleteQuery(connId, deleteId)
      setDeleteId(null)
      load()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message)
    }
  }

  const filtered = filterType === 'all' ? queries : queries.filter(q => q.query_type === filterType)

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          startIcon={collecting ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
          onClick={handleCollect}
          disabled={collecting}
        >
          {collecting ? 'Generating…' : 'Auto-Generate from Schema'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<AddOutlined />}
          onClick={() => { setEditRow(null); setForm({ query_type: 'custom', name: '', sql_text: '', priority: 0, severity: 'error', dev_source_tag: null }); setAddOpen(true) }}
        >
          Add Manually
        </Button>
        <Button variant="outlined" startIcon={<RefreshOutlined />} onClick={load} disabled={loading}>
          Refresh
        </Button>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Filter by type</InputLabel>
          <Select value={filterType} label="Filter by type" onChange={e => setFilterType(e.target.value)}>
            <MenuItem value="all">All types</MenuItem>
            {VALID_QUERY_TYPES.map(t => (
              <MenuItem key={t} value={t}>{QUERY_TYPE_LABELS[t]}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Collect result summary */}
      {collectResult && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCollectResult(null)}>
          Generated {collectResult.generated} queries —{' '}
          {Object.entries(collectResult.by_type).map(([k, v]) => `${k}: ${v}`).join(', ')}
          {collectResult.coverage && ` · Coverage: ${Math.round(collectResult.coverage.overall * 100)}%`}
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Table */}
      {loading ? (
        <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Table / Column</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>Origin</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No queries yet. Click "Auto-Generate from Schema" to get started.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map(q => (
                <TableRow key={q.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{q.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={QUERY_TYPE_LABELS[q.query_type] ?? q.query_type}
                      color={QUERY_TYPE_COLORS[q.query_type] ?? 'default'} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {[q.table_name, q.column_name].filter(Boolean).join('.')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {q.priority === 1
                      ? <Chip size="small" label="Critical" color="error" />
                      : <Chip size="small" label="Normal" />}
                  </TableCell>
                  <TableCell>
                    {q.dev_source_tag
                      ? <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {q.dev_source_tag.split(',').map(tag => (
                            <Chip key={tag} size="small"
                              label={DEV_SOURCE_OPTIONS.find(o => o.value === tag)?.label ?? tag}
                              color={SOURCE_TYPE_COLORS[tag] ?? 'default'} variant="outlined" />
                          ))}
                        </Box>
                      : <Chip size="small" label="Global" variant="outlined" />}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={q.is_auto_generated ? 'Auto' : 'Manual'}
                      variant="outlined" color={q.is_auto_generated ? 'info' : 'default'} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => {
                        setEditRow(q)
                        setForm({ query_type: q.query_type as any, name: q.name, sql_text: q.sql_text,
                          table_name: q.table_name ?? undefined, column_name: q.column_name ?? undefined,
                          priority: q.priority, severity: q.severity, dev_source_tag: q.dev_source_tag })
                        setAddOpen(true)
                      }}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setDeleteId(q.id)}>
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editRow ? 'Edit Query' : 'Add BASE Query'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} fullWidth required />
          <FormControl fullWidth>
            <InputLabel>Query Type</InputLabel>
            <Select value={form.query_type} label="Query Type"
              onChange={e => setForm(f => ({ ...f, query_type: e.target.value as any }))}>
              {VALID_QUERY_TYPES.map(t => (
                <MenuItem key={t} value={t}>{QUERY_TYPE_LABELS[t]}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="SQL Text" value={form.sql_text}
            onChange={e => setForm(f => ({ ...f, sql_text: e.target.value }))}
            multiline minRows={4} fullWidth required />
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField label="Table Name (optional)" value={form.table_name ?? ''}
                onChange={e => setForm(f => ({ ...f, table_name: e.target.value || undefined }))} fullWidth />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Column Name (optional)" value={form.column_name ?? ''}
                onChange={e => setForm(f => ({ ...f, column_name: e.target.value || undefined }))} fullWidth />
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select value={form.priority ?? 0} label="Priority"
                  onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}>
                  <MenuItem value={0}>Normal</MenuItem>
                  <MenuItem value={1}>Critical</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Source Scope</InputLabel>
                <Select
                  multiple
                  value={form.dev_source_tag ? form.dev_source_tag.split(',') : []}
                  label="Source Scope"
                  onChange={e => {
                    const vals = typeof e.target.value === 'string'
                      ? e.target.value.split(',')
                      : e.target.value as string[]
                    setForm(f => ({ ...f, dev_source_tag: vals.length ? vals.join(',') : null }))
                  }}
                  renderValue={selected =>
                    (selected as string[]).length === 0
                      ? 'Global (all sources)'
                      : (selected as string[]).map(v => DEV_SOURCE_OPTIONS.find(o => o.value === v)?.label ?? v).join(', ')
                  }
                >
                  {DEV_SOURCE_OPTIONS.map(o => (
                    <MenuItem key={o.value} value={o.value}>
                      <input
                        type="checkbox"
                        checked={(form.dev_source_tag ?? '').split(',').includes(o.value)}
                        readOnly
                        style={{ marginRight: 8 }}
                      />
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name || !form.sql_text}>
            {editRow ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onClose={() => setDeleteId(null)}>
        <DialogTitle>Delete Query</DialogTitle>
        <DialogContent>Are you sure you want to delete this query?</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ── Tab 1: Run DEV vs BASE ────────────────────────────────────────────────────

function RunTab({
  connId,
  onRunComplete,
}: {
  connId: number
  onRunComplete: (runId: string) => void
}) {
  const [sourceType, setSourceType] = useState<DevSourceType>('mapper')
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [sourceSubId, setSourceSubId] = useState<number | null>(null)
  const [adhocSql, setAdhocSql] = useState('')
  const [samplingMode, setSamplingMode] = useState<'top_n' | 'random' | 'stratified'>('top_n')
  const [sampleSize, setSampleSize] = useState(100000)
  const [baseQueryScope, setBaseQueryScope] = useState<'auto' | 'all' | 'tagged_only'>('auto')

  // Dynamic lists
  const [reports, setReports] = useState<SavedReport[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [dashboards, setDashboards] = useState<SavedDashboard[]>([])
  const [artifacts, setArtifacts] = useState<DevArtifact[]>([])

  const [queryCount, setQueryCount] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Q1 preview state
  const [q1Sql, setQ1Sql] = useState<string | null>(null)
  const [q1Loading, setQ1Loading] = useState(false)
  const [q1Error, setQ1Error] = useState<string | null>(null)

  // Load count
  useEffect(() => {
    reconciliationApi.listQueries(connId)
      .then(qs => setQueryCount(qs.length))
      .catch(() => setQueryCount(null))
  }, [connId])

  // Auto-fetch Q1 preview whenever source selection changes
  // (skip adhoc — user is still typing; skip if required id not yet chosen)
  useEffect(() => {
    if (sourceType === 'adhoc') {
      setQ1Sql(null)
      return
    }
    const needsId = ['dashboard', 'report', 'ps_workflow', 'dev_artifact'].includes(sourceType)
    if (needsId && !sourceId) {
      setQ1Sql(null)
      return
    }
    setQ1Loading(true)
    setQ1Error(null)
    setQ1Sql(null)
    reconciliationApi.previewQ1(connId, {
      source_type: sourceType,
      source_id: sourceId,
      source_sub_id: sourceSubId,
    })
      .then(r => setQ1Sql(r.sql))
      .catch(e => setQ1Error(e?.response?.data?.detail ?? e.message))
      .finally(() => setQ1Loading(false))
  }, [connId, sourceType, sourceId, sourceSubId])

  // Load dynamic options based on source type
  useEffect(() => {
    if (sourceType === 'report') {
      reportApi.listSaved(connId).then((d: any) => setReports(d ?? [])).catch(() => setReports([]))
    } else if (sourceType === 'ps_workflow') {
      psApi.listWorkflows(connId).then(setWorkflows).catch(() => setWorkflows([]))
    } else if (sourceType === 'dashboard') {
      myDashboardsApi.list(undefined, connId).then(setDashboards).catch(() => setDashboards([]))
    } else if (sourceType === 'dev_artifact') {
      developmentApi.history(connId).then(setArtifacts).catch(() => setArtifacts([]))
    }
    setSourceId(null)
    setSourceSubId(null)
  }, [sourceType, connId])

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await reconciliationApi.run(connId, {
        source_type: sourceType,
        source_id: sourceId,
        source_sub_id: sourceSubId,
        adhoc_sql: sourceType === 'adhoc' ? adhocSql : null,
        sampling_mode: samplingMode,
        sample_size: sampleSize,
        base_query_scope: baseQueryScope,
      })
      onRunComplete(res.run_id)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message)
    } finally {
      setRunning(false)
    }
  }

  // Render dynamic sub-selector
  const renderSubSelector = () => {
    if (sourceType === 'mapper') {
      return (
        <Alert severity="info" icon={<InfoOutlined />}>
          Uses the latest Conversion Mapper query for this connection automatically.
        </Alert>
      )
    }
    if (sourceType === 'adhoc') {
      return (
        <TextField
          label="Ad-hoc SQL (Q1 DEV query)"
          value={adhocSql}
          onChange={e => setAdhocSql(e.target.value)}
          multiline minRows={5}
          fullWidth
          placeholder="SELECT e.EMPNO, e.ENAME, d.DNAME FROM EMP e JOIN DEPT d ON e.DEPTNO = d.DEPTNO"
        />
      )
    }
    if (sourceType === 'report') {
      return (
        <FormControl fullWidth>
          <InputLabel>Select Saved Report</InputLabel>
          <Select value={sourceId ?? ''} label="Select Saved Report"
            onChange={e => setSourceId(Number(e.target.value))}>
            {reports.map(r => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
          </Select>
        </FormControl>
      )
    }
    if (sourceType === 'ps_workflow') {
      return (
        <FormControl fullWidth>
          <InputLabel>Select PS Workflow</InputLabel>
          <Select value={sourceId ?? ''} label="Select PS Workflow"
            onChange={e => setSourceId(Number(e.target.value))}>
            {workflows.map(w => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
          </Select>
        </FormControl>
      )
    }
    if (sourceType === 'dashboard') {
      return (
        <FormControl fullWidth>
          <InputLabel>Select Dashboard</InputLabel>
          <Select value={sourceId ?? ''} label="Select Dashboard"
            onChange={e => setSourceId(Number(e.target.value))}>
            {dashboards.map(d => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </Select>
        </FormControl>
      )
    }
    if (sourceType === 'dev_artifact') {
      return (
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <FormControl fullWidth>
              <InputLabel>Select Dev Artifact</InputLabel>
              <Select value={sourceId ?? ''} label="Select Dev Artifact"
                onChange={e => setSourceId(Number(e.target.value))}>
                {artifacts.map(a => (
                  <MenuItem key={a.id} value={a.id}>{a.task_description.slice(0, 60)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Step Index (0-based)"
              type="number"
              value={sourceSubId ?? 0}
              onChange={e => setSourceSubId(Number(e.target.value))}
              fullWidth
            />
          </Grid>
        </Grid>
      )
    }
    return null
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Connection info */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          <StorageOutlined fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
          Connection #{connId}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {queryCount !== null
            ? `${queryCount} BASE queries loaded. ${queryCount === 0 ? 'Go to BASE Query Library tab to generate them first.' : 'Ready to run.'}`
            : 'Loading query count…'}
        </Typography>
      </Paper>

      {/* Source type selector */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          <CodeOutlined fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
          Q1 DEV Query Source
        </Typography>
        <ToggleButtonGroup
          value={sourceType}
          exclusive
          onChange={(_, v) => v && setSourceType(v)}
          size="small"
          sx={{ flexWrap: 'wrap', gap: 0.5 }}
        >
          {DEV_SOURCE_OPTIONS.map(o => (
            <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none' }}>
              {o.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Dynamic sub-selector */}
      {renderSubSelector()}

      {/* Q1 DEV SQL Preview */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <CodeOutlined fontSize="small" color="primary" />
          <Typography variant="subtitle2">Q1 DEV Query Preview</Typography>
          {q1Loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
          {q1Sql && !q1Loading && (
            <Chip size="small" label="Resolved" color="success" variant="outlined" sx={{ ml: 'auto' }} />
          )}
        </Box>

        {sourceType === 'adhoc' ? (
          adhocSql.trim() ? (
            <Box
              component="pre"
              sx={{
                bgcolor: 'action.hover', p: 1.5, borderRadius: 1, m: 0,
                fontSize: '0.75rem', fontFamily: 'monospace', overflow: 'auto',
                maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}
            >
              {adhocSql}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Enter the SQL above to preview it here.
            </Typography>
          )
        ) : q1Error ? (
          <Alert severity="warning" sx={{ py: 0.5 }}>{q1Error}</Alert>
        ) : q1Sql ? (
          <>
            <Box
              component="pre"
              sx={{
                bgcolor: 'action.hover', p: 1.5, borderRadius: 1, m: 0,
                fontSize: '0.75rem', fontFamily: 'monospace', overflow: 'auto',
                maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}
            >
              {q1Sql}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {q1Sql.length} characters · This exact SQL will be wrapped per BASE test type
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {['dashboard', 'report', 'ps_workflow', 'dev_artifact'].includes(sourceType) && !sourceId
              ? 'Select a source above to preview the Q1 query.'
              : q1Loading ? 'Resolving query…' : 'No query found for this source.'}
          </Typography>
        )}
      </Paper>

      {/* Sampling options */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          <TuneOutlined fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
          Sampling Options
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Sampling Mode</InputLabel>
              <Select value={samplingMode} label="Sampling Mode"
                onChange={e => setSamplingMode(e.target.value as any)}>
                <MenuItem value="top_n">Top N</MenuItem>
                <MenuItem value="random">Random</MenuItem>
                <MenuItem value="stratified">Stratified</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Sample Size"
              type="number"
              size="small"
              value={sampleSize}
              onChange={e => setSampleSize(Math.max(1, Number(e.target.value)))}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>BASE Query Scope</InputLabel>
              <Select value={baseQueryScope} label="BASE Query Scope"
                onChange={e => setBaseQueryScope(e.target.value as any)}>
                <MenuItem value="auto">Auto (tagged + global)</MenuItem>
                <MenuItem value="all">All queries</MenuItem>
                <MenuItem value="tagged_only">Tagged for this source only</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {(() => {
        const needsSourceId = ['dashboard', 'report', 'ps_workflow', 'dev_artifact'].includes(sourceType)
        const missingSourceId = needsSourceId && !sourceId
        const missingAdhoc = sourceType === 'adhoc' && !adhocSql.trim()
        const noQueries = queryCount !== null && queryCount === 0
        const btnDisabled = running || noQueries || missingSourceId || missingAdhoc
        const hint = noQueries
          ? 'No BASE queries — generate them in the BASE Query Library tab first.'
          : missingSourceId
          ? `Select a ${DEV_SOURCE_OPTIONS.find(o => o.value === sourceType)?.label ?? sourceType} to continue.`
          : missingAdhoc
          ? 'Enter the Ad-hoc SQL query above.'
          : null
        return (
          <>
            {hint && <Alert severity="warning" sx={{ py: 0.5 }}>{hint}</Alert>}
            <Button
              variant="contained"
              size="large"
              startIcon={running ? <CircularProgress size={18} color="inherit" /> : <PlayArrowOutlined />}
              onClick={handleRun}
              disabled={btnDisabled}
              sx={{ alignSelf: 'flex-start' }}
            >
              {running ? 'Running Reconciliation…' : 'Run Reconciliation'}
            </Button>
          </>
        )
      })()}

      {running && (
        <Alert severity="info">
          Executing BASE queries and comparing against DEV query. This may take a minute for large datasets.
        </Alert>
      )}
    </Box>
  )
}

// ── Tab 2: Results & Insights ─────────────────────────────────────────────────

function ResultsTab({ connId, selectedRunId }: { connId: number; selectedRunId?: string }) {
  const [runs, setRuns] = useState<RecRunSummary[]>([])
  const [runId, setRunId] = useState<string>(selectedRunId ?? '')
  const [results, setResults] = useState<ReconciliationResult[]>([])
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRuns = useCallback(() => {
    setLoadingRuns(true)
    reconciliationApi.listRuns(connId)
      .then(r => { setRuns(r); if (r.length && !runId) setRunId(r[0].run_id) })
      .catch(e => setError(e?.response?.data?.detail ?? e.message))
      .finally(() => setLoadingRuns(false))
  }, [connId, runId])

  useEffect(() => { loadRuns() }, [connId])

  useEffect(() => {
    if (selectedRunId) setRunId(selectedRunId)
  }, [selectedRunId])

  useEffect(() => {
    if (!runId) return
    setLoadingResults(true)
    reconciliationApi.getRun(connId, runId)
      .then(setResults)
      .catch(e => setError(e?.response?.data?.detail ?? e.message))
      .finally(() => setLoadingResults(false))
  }, [connId, runId])

  const selectedSummary = runs.find(r => r.run_id === runId)

  const [hideOutOfScope, setHideOutOfScope] = useState(true)

  const filtered = useMemo(() => {
    let r = results
    if (filterStatus !== 'all') r = r.filter(x => x.status === filterStatus)
    if (filterType !== 'all') r = r.filter(x => x.query_type === filterType)
    // Hide SKIPs caused by table-scoping (table not in Q1 DEV query) — they add noise
    if (hideOutOfScope) {
      r = r.filter(x => !(x.status === 'SKIP' && x.issue?.includes('not referenced in Q1 DEV query')))
    }
    return r
  }, [results, filterStatus, filterType, hideOutOfScope])

  const failCount = results.filter(r => r.status === 'FAIL').length
  const passCount = results.filter(r => r.status === 'PASS').length
  const warnCount = results.filter(r => r.status === 'WARN').length
  const errCount  = results.filter(r => r.status === 'ERROR').length

  return (
    <Box>
      {/* Run selector */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 320 }}>
          <InputLabel>Select Run</InputLabel>
          <Select
            value={runId}
            label="Select Run"
            onChange={e => setRunId(e.target.value)}
            disabled={loadingRuns}
          >
            {runs.map(r => (
              <MenuItem key={r.run_id} value={r.run_id}>
                {new Date(r.created_at).toLocaleString()} — {r.passed}/{r.total} passed
                {r.dev_source_type ? ` (${r.dev_source_type})` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" startIcon={<RefreshOutlined />} size="small" onClick={loadRuns}>
          Refresh
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Summary bar */}
      {selectedSummary && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={6}>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip icon={<CheckCircleOutlined />} label={`PASS ${passCount}`} color="success" />
                <Chip icon={<CancelOutlined />} label={`FAIL ${failCount}`} color="error" />
                <Chip icon={<WarningAmberOutlined />} label={`WARN ${warnCount}`} color="warning" />
                <Chip icon={<ErrorOutlined />} label={`ERROR ${errCount}`} color="error" variant="outlined" />
                <Chip icon={<SkipNextOutlined />} label={`SKIP ${selectedSummary.skipped}`} />
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <ConfidenceBar score={selectedSummary.confidence_score} />
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* Filter chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', 'FAIL', 'WARN', 'PASS', 'ERROR', 'SKIP'].map(s => (
          <Chip key={s} label={s === 'all' ? 'All' : s} size="small"
            color={filterStatus === s ? (STATUS_COLORS[s] ?? 'primary') : 'default'}
            variant={filterStatus === s ? 'filled' : 'outlined'}
            onClick={() => setFilterStatus(s)} />
        ))}
        <Chip
          size="small"
          label="Hide out-of-scope"
          color={hideOutOfScope ? 'warning' : 'default'}
          variant={hideOutOfScope ? 'filled' : 'outlined'}
          onClick={() => setHideOutOfScope(v => !v)}
          title="Hide SKIP results for tables not referenced in the Q1 DEV query"
        />
        <Divider orientation="vertical" flexItem />
        <Chip label="All types" size="small"
          variant={filterType === 'all' ? 'filled' : 'outlined'}
          color={filterType === 'all' ? 'primary' : 'default'}
          onClick={() => setFilterType('all')} />
        {VALID_QUERY_TYPES.map(t => (
          <Chip key={t} label={QUERY_TYPE_LABELS[t]} size="small"
            color={filterType === t ? (QUERY_TYPE_COLORS[t] ?? 'primary') : 'default'}
            variant={filterType === t ? 'filled' : 'outlined'}
            onClick={() => setFilterType(t)} />
        ))}
      </Box>

      {/* Results */}
      {loadingResults ? (
        <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>
      ) : filtered.length === 0 ? (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
          {runId ? 'No results match the current filter.' : 'Select a run above.'}
        </Typography>
      ) : (
        <Box>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            Showing {filtered.length} of {results.length} results
          </Typography>
          {filtered.map(r => <ResultCard key={r.id} result={r} />)}
        </Box>
      )}
    </Box>
  )
}

// ── Tab 3: Dashboard ──────────────────────────────────────────────────────────

function DashboardTab({ connId }: { connId: number }) {
  const [runs, setRuns] = useState<RecRunSummary[]>([])
  const [latestResults, setLatestResults] = useState<ReconciliationResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Email report state
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailRunId, setEmailRunId] = useState<string>('')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    reconciliationApi.listRuns(connId)
      .then(async rs => {
        setRuns(rs)
        if (rs.length) {
          const latest = await reconciliationApi.getRun(connId, rs[0].run_id)
          setLatestResults(latest)
        }
      })
      .catch(e => setError(e?.response?.data?.detail ?? e.message))
      .finally(() => setLoading(false))
  }, [connId])

  const handleOpenEmail = async () => {
    setEmailOpen(true)
    setEmailError(null)
    setEmailSuccess(null)
    setPreviewHtml(null)
    setPreviewLoading(true)
    const rid = emailRunId || runs[0]?.run_id
    try {
      const { html } = await reconciliationApi.emailPreview(connId, rid || undefined)
      setPreviewHtml(html)
    } catch (e: any) {
      setEmailError(e?.response?.data?.detail ?? e.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSendEmail = async () => {
    if (!emailTo.trim()) { setEmailError('Enter a recipient email address.'); return }
    setSending(true)
    setEmailError(null)
    try {
      const res = await reconciliationApi.sendEmail(
        connId, emailTo.trim(),
        emailSubject || undefined,
        emailRunId || undefined,
      )
      setEmailSuccess(`Report sent to ${res.to}`)
    } catch (e: any) {
      setEmailError(e?.response?.data?.detail ?? e.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) return <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
  if (error) return <Alert severity="error">{error}</Alert>

  if (runs.length === 0) {
    return (
      <Alert severity="info">
        No reconciliation runs yet. Go to the "Run DEV vs BASE" tab to start your first run.
      </Alert>
    )
  }

  const latest = runs[0]

  // By-type breakdown from latest results
  const byType: Record<string, { total: number; pass: number; fail: number; error: number; skip: number }> = {}
  for (const r of latestResults) {
    if (!byType[r.query_type]) byType[r.query_type] = { total: 0, pass: 0, fail: 0, error: 0, skip: 0 }
    byType[r.query_type].total++
    if (r.status === 'PASS') byType[r.query_type].pass++
    else if (r.status === 'FAIL') byType[r.query_type].fail++
    else if (r.status === 'ERROR') byType[r.query_type].error++
    else if (r.status === 'SKIP') byType[r.query_type].skip++
  }

  // Root cause distribution from ai_insight JSON
  const rootCauseCounts: Record<string, number> = {}
  for (const r of latestResults) {
    const ins = parseAiInsight(r.ai_insight)
    if (ins?.root_cause_category) {
      rootCauseCounts[ins.root_cause_category] = (rootCauseCounts[ins.root_cause_category] ?? 0) + 1
    }
  }

  // Critical failures
  const criticalFails = latestResults.filter(r => r.status === 'FAIL' && r.query_type !== 'agg')
  const avgExec = latestResults.filter(r => r.execution_time_ms != null)
  const avgMs = avgExec.length
    ? Math.round(avgExec.reduce((s, r) => s + (r.execution_time_ms ?? 0), 0) / avgExec.length)
    : 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* KPI cards */}
      <Grid container spacing={2}>
        {[
          { label: 'Total Tests', value: latest.total, color: 'primary.main' },
          {
            label: 'Pass Rate',
            value: latest.total ? `${Math.round((latest.passed / latest.total) * 100)}%` : '—',
            color: latest.passed / (latest.total || 1) >= 0.8 ? 'success.main' : 'warning.main',
          },
          {
            label: 'Confidence Score',
            value: `${Math.round(latest.confidence_score * 100)}%`,
            color: latest.confidence_score >= 0.8 ? 'success.main' : latest.confidence_score >= 0.5 ? 'warning.main' : 'error.main',
          },
          { label: 'Critical Failures', value: criticalFails.length, color: criticalFails.length > 0 ? 'error.main' : 'success.main' },
          { label: 'Skipped', value: latest.skipped, color: 'text.secondary' },
          { label: 'Avg Exec (ms)', value: avgMs, color: 'text.primary' },
        ].map(kpi => (
          <Grid item xs={6} sm={4} md={2} key={kpi.label}>
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={700} color={kpi.color}>{kpi.value}</Typography>
              <Typography variant="caption" color="text.secondary">{kpi.label}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Confidence bar */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <ConfidenceBar score={latest.confidence_score} />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          Coverage score: {Math.round(latest.coverage_score * 100)}%
        </Typography>
      </Paper>

      {/* By-type breakdown */}
      <Paper variant="outlined">
        <Box sx={{ p: 2, pb: 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            <TableChartOutlined fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
            By Query Type
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Pass</TableCell>
                <TableCell align="right">Fail</TableCell>
                <TableCell align="right">Skip</TableCell>
                <TableCell align="right">Error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(byType).map(([type, s]) => (
                <TableRow key={type} hover>
                  <TableCell>
                    <Chip size="small" label={QUERY_TYPE_LABELS[type] ?? type}
                      color={QUERY_TYPE_COLORS[type] ?? 'default'} />
                  </TableCell>
                  <TableCell align="right">{s.total}</TableCell>
                  <TableCell align="right">
                    <Typography color="success.main" fontWeight={600}>{s.pass}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography color={s.fail > 0 ? 'error.main' : 'text.primary'} fontWeight={s.fail > 0 ? 700 : 400}>
                      {s.fail}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography color={s.skip > 0 ? 'text.secondary' : 'text.primary'}>{s.skip}</Typography>
                  </TableCell>
                  <TableCell align="right">{s.error}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Root cause distribution */}
      {Object.keys(rootCauseCounts).length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            <LightbulbOutlined fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
            Root Cause Distribution (AI Insights)
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Root Cause</TableCell>
                  <TableCell align="right">Failure Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(rootCauseCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, cnt]) => (
                    <TableRow key={cat} hover>
                      <TableCell>
                        <Chip size="small" label={ROOT_CAUSE_LABELS[cat] ?? cat}
                          color="warning" variant="outlined" />
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight={700}>{cnt}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Critical failures */}
      {criticalFails.length > 0 && (
        <Alert severity="error" icon={<ErrorOutlined />}>
          <strong>Critical Failures ({criticalFails.length}):</strong>{' '}
          {criticalFails.slice(0, 5).map(r => r.test_name).join(', ')}
          {criticalFails.length > 5 && ` and ${criticalFails.length - 5} more`}
        </Alert>
      )}

      {/* Last 5 runs */}
      <Paper variant="outlined">
        <Box sx={{ p: 2, pb: 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            <AssessmentOutlined fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
            Last {Math.min(5, runs.length)} Runs
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Source</TableCell>
                <TableCell align="right">Pass / Fail / Skip</TableCell>
                <TableCell align="right">Confidence</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.slice(0, 5).map(r => (
                <TableRow key={r.run_id} hover>
                  <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip size="small" label={r.dev_source_type ?? 'unknown'} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Typography fontWeight={600} color="success.main">{r.passed}</Typography>
                      <Typography color="text.secondary">/</Typography>
                      <Typography fontWeight={600} color={r.failed > 0 ? 'error.main' : 'text.secondary'}>{r.failed}</Typography>
                      <Typography color="text.secondary">/</Typography>
                      <Typography color="text.secondary">{r.skipped}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Chip
                      size="small"
                      label={`${Math.round(r.confidence_score * 100)}%`}
                      color={r.confidence_score >= 0.8 ? 'success' : r.confidence_score >= 0.5 ? 'warning' : 'error'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Email Report */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>Email Reconciliation Report</Typography>
            <Typography variant="body2" color="text.secondary">
              Send a summary of passed/failed tests by source (Report, Dashboard, Conversion) to any email address.
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<AssessmentOutlined />} onClick={handleOpenEmail}>
            Preview &amp; Send Email
          </Button>
        </Box>
      </Paper>

      {/* Email dialog */}
      <Dialog open={emailOpen} onClose={() => setEmailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Email Reconciliation Report</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="info" sx={{ py: 0.5 }}>
              SMTP settings are read from <strong>Admin → Email Settings</strong>. Configure them there if the send fails.
            </Alert>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="To (email address)"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  fullWidth size="small"
                  placeholder="recipient@example.com"
                  type="email"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Subject (optional)"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  fullWidth size="small"
                  placeholder="Reconciliation Report — Connection #…"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Run (optional — defaults to all)</InputLabel>
                  <Select
                    value={emailRunId}
                    label="Run (optional — defaults to all)"
                    onChange={e => {
                      setEmailRunId(e.target.value as string)
                      setPreviewHtml(null)
                    }}
                  >
                    <MenuItem value="">All runs</MenuItem>
                    {runs.map(r => (
                      <MenuItem key={r.run_id} value={r.run_id}>
                        {new Date(r.created_at).toLocaleString()} — {r.passed}/{r.total} passed
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              {!previewHtml && (
                <Grid item xs={12} sm={6} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Button
                    variant="outlined" size="small"
                    onClick={async () => {
                      setPreviewLoading(true)
                      try {
                        const { html } = await reconciliationApi.emailPreview(connId, emailRunId || undefined)
                        setPreviewHtml(html)
                      } catch (e: any) {
                        setEmailError(e?.response?.data?.detail ?? e.message)
                      } finally { setPreviewLoading(false) }
                    }}
                    disabled={previewLoading}
                  >
                    {previewLoading ? 'Loading preview…' : 'Refresh Preview'}
                  </Button>
                </Grid>
              )}
            </Grid>

            {emailError && <Alert severity="error" onClose={() => setEmailError(null)}>{emailError}</Alert>}
            {emailSuccess && <Alert severity="success">{emailSuccess}</Alert>}

            {previewLoading && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={32} /></Box>}

            {previewHtml && (
              <Box>
                <Typography variant="caption" color="text.secondary" gutterBottom>Preview</Typography>
                <Box
                  sx={{
                    border: '1px solid', borderColor: 'divider', borderRadius: 1,
                    maxHeight: 420, overflow: 'auto', bgcolor: '#fff',
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSendEmail}
            disabled={sending || !emailTo.trim()}
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <AssessmentOutlined />}
          >
            {sending ? 'Sending…' : 'Send Report'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ── Tab 4: By Source ──────────────────────────────────────────────────────────

const SOURCE_TYPE_COLORS: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  mapper:       'primary',
  dashboard:    'secondary',
  report:       'info',
  ps_workflow:  'warning',
  dev_artifact: 'default',
  adhoc:        'default',
  unknown:      'default',
}

function SourceHealthBar({ passed, total }: { passed: number; total: number }) {
  const nonSkip = total  // total from latest already excludes full-skips in display
  if (!nonSkip) return <Typography variant="caption" color="text.secondary">No data</Typography>
  const pct = Math.round((passed / nonSkip) * 100)
  const color = pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error'
  return (
    <Box sx={{ minWidth: 120 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography variant="caption" color="text.secondary">{passed}/{total}</Typography>
        <Typography variant="caption" fontWeight={700} color={`${color}.main`}>{pct}%</Typography>
      </Box>
      <LinearProgress variant="determinate" value={pct} color={color} sx={{ height: 6, borderRadius: 3 }} />
    </Box>
  )
}

function BySourceTab({ connId }: { connId: number }) {
  const [groups, setGroups] = useState<SourceSummaryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    reconciliationApi.sourceSummary(connId)
      .then(setGroups)
      .catch(e => setError(e?.response?.data?.detail ?? e.message))
      .finally(() => setLoading(false))
  }, [connId])

  useEffect(() => { load() }, [load])

  if (loading) return <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
  if (error)   return <Alert severity="error">{error}</Alert>
  if (!groups.length) {
    return (
      <Alert severity="info">
        No reconciliation runs yet. Run DEV vs BASE first, then come back here.
      </Alert>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          Reconciliation results grouped by DEV query source — Conversion, Dashboard, Report, etc.
        </Typography>
        <Button variant="outlined" size="small" startIcon={<RefreshOutlined />} onClick={load}>
          Refresh
        </Button>
      </Box>

      {/* Summary cards across all sources */}
      <Grid container spacing={2}>
        {groups.map(g => {
          const failPct = g.total ? Math.round((g.failed / g.total) * 100) : 0
          const passPct = g.total ? Math.round((g.passed / g.total) * 100) : 0
          return (
            <Grid item xs={12} sm={6} md={4} key={g.source_type}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2, cursor: 'pointer',
                  border: expanded === g.source_type ? '2px solid' : '1px solid',
                  borderColor: expanded === g.source_type ? 'primary.main' : 'divider',
                  '&:hover': { borderColor: 'primary.light' },
                }}
                onClick={() => setExpanded(e => e === g.source_type ? null : g.source_type)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <Chip
                    size="small"
                    label={g.label}
                    color={SOURCE_TYPE_COLORS[g.source_type] ?? 'default'}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    {g.sources.length} source{g.sources.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight={700} color="success.main">{g.passed}</Typography>
                    <Typography variant="caption" color="text.secondary">Passed</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight={700} color="error.main">{g.failed}</Typography>
                    <Typography variant="caption" color="text.secondary">Failed</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight={700} color="text.secondary">{g.skipped}</Typography>
                    <Typography variant="caption" color="text.secondary">Skipped</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight={700}>{g.total}</Typography>
                    <Typography variant="caption" color="text.secondary">Total</Typography>
                  </Box>
                </Box>
                <SourceHealthBar passed={g.passed} total={g.total} />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {expanded === g.source_type ? <ExpandLessOutlined fontSize="inherit" /> : <ExpandMoreOutlined fontSize="inherit" />}
                  {expanded === g.source_type ? 'Hide details' : 'Show details'}
                </Typography>
              </Paper>
            </Grid>
          )
        })}
      </Grid>

      {/* Expanded detail: per-source drill-down */}
      {groups.filter(g => g.source_type === expanded).map(g => (
        <Paper key={g.source_type} variant="outlined">
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip size="small" label={g.label} color={SOURCE_TYPE_COLORS[g.source_type] ?? 'default'} />
            <Typography variant="subtitle1" fontWeight={700}>Source Detail</Typography>
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Source Name</TableCell>
                  <TableCell align="center">Last Run</TableCell>
                  <TableCell align="center">Passed</TableCell>
                  <TableCell align="center">Failed</TableCell>
                  <TableCell align="center">Skipped</TableCell>
                  <TableCell align="center">Confidence</TableCell>
                  <TableCell align="center">Pass Rate</TableCell>
                  <TableCell align="center">Runs</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {g.sources.map((src, i) => {
                  const l = src.latest
                  const hasData = l && l.total != null
                  const passPct = hasData && l.total ? Math.round((l.passed / l.total) * 100) : 0
                  const confPct = hasData ? Math.round((l.confidence_score ?? 0) * 100) : 0
                  return (
                    <TableRow key={i} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{src.source_name}</Typography>
                        {src.source_id && (
                          <Typography variant="caption" color="text.secondary">ID: {src.source_id}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="caption" color="text.secondary">
                          {hasData ? new Date(l.created_at).toLocaleDateString() : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography fontWeight={600} color="success.main">{hasData ? l.passed : '—'}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography fontWeight={600} color={hasData && l.failed > 0 ? 'error.main' : 'text.primary'}>
                          {hasData ? l.failed : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography color="text.secondary">{hasData ? l.skipped : '—'}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        {hasData ? (
                          <Chip
                            size="small"
                            label={`${confPct}%`}
                            color={confPct >= 80 ? 'success' : confPct >= 50 ? 'warning' : 'error'}
                          />
                        ) : '—'}
                      </TableCell>
                      <TableCell align="center">
                        {hasData ? (
                          <Box sx={{ minWidth: 80 }}>
                            <LinearProgress
                              variant="determinate"
                              value={passPct}
                              color={passPct >= 80 ? 'success' : passPct >= 50 ? 'warning' : 'error'}
                              sx={{ height: 6, borderRadius: 3 }}
                            />
                            <Typography variant="caption" color="text.secondary">{passPct}%</Typography>
                          </Box>
                        ) : '—'}
                      </TableCell>
                      <TableCell align="center">
                        <Chip size="small" label={src.runs.length} variant="outlined" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Run history for each source */}
          {g.sources.map((src, i) => src.runs.length > 1 && (
            <Box key={i} sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" gutterBottom>
                Run History — {src.source_name}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                {src.runs.map(r => (
                  <Tooltip key={r.run_id} title={`${new Date(r.created_at).toLocaleString()} · ${r.passed} passed · ${r.failed} failed · ${r.skipped} skipped`}>
                    <Chip
                      size="small"
                      label={`${Math.round(r.confidence_score * 100)}%`}
                      color={r.confidence_score >= 0.8 ? 'success' : r.confidence_score >= 0.5 ? 'warning' : 'error'}
                      variant="outlined"
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          ))}
        </Paper>
      ))}
    </Box>
  )
}

// ── Tab 5: Multi-Source AI Compare ───────────────────────────────────────────

function AITracePanel({ result }: { result: MultiCompareResult }) {
  const [open, setOpen] = useState(false)
  return (
    <Paper variant="outlined" sx={{ borderColor: 'divider' }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer' }}
        onClick={() => setOpen(p => !p)}
      >
        <CodeOutlined fontSize="small" color="action" />
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>AI Trace</Typography>
        <Chip size="small" label={`${result.tokens_in}↑ ${result.tokens_out}↓ tokens`} variant="outlined" />
        <Chip size="small" label={`${Math.round(result.elapsed_ms / 1000)}s`} variant="outlined" />
        <Chip size="small" label="gpt-4o-mini" variant="outlined" color="primary" />
        {open ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
      </Box>
      <Collapse in={open}>
        <Divider />
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom>
              PROMPT SENT TO AI
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1,
                fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', maxHeight: 320, overflow: 'auto',
              }}
            >
              {result.prompt_text}
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom>
              TOKEN USAGE
            </Typography>
            <Stack direction="row" spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">Prompt tokens</Typography>
                <Typography variant="body2" fontWeight={700}>{result.tokens_in.toLocaleString()}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Completion tokens</Typography>
                <Typography variant="body2" fontWeight={700}>{result.tokens_out.toLocaleString()}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Total</Typography>
                <Typography variant="body2" fontWeight={700}>{(result.tokens_in + result.tokens_out).toLocaleString()}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Latency</Typography>
                <Typography variant="body2" fontWeight={700}>{result.elapsed_ms}ms</Typography>
              </Box>
            </Stack>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  )
}

type SlotSourceType = 'db' | 'file' | null

interface SlotState {
  source_type:    SlotSourceType
  conn_id:        number | null
  sql:            string
  label:          string
  file:           File | null
  file_row_count: number | null
  file_name:      string | null
}

const EMPTY_SLOT: SlotState = {
  source_type: null, conn_id: null, sql: '', label: '',
  file: null, file_row_count: null, file_name: null,
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PASS: <CheckCircleOutlined fontSize="small" />,
  FAIL: <CancelOutlined fontSize="small" />,
  WARN: <WarningAmberOutlined fontSize="small" />,
  INFO: <InfoOutlined fontSize="small" />,
}

function MultiSourceCompareTab() {
  const activeProject = useAppStore(s => s.activeProject)
  const [slots, setSlots] = useState<SlotState[]>([
    { ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT },
  ])
  const [connections, setConnections] = useState<SourceConnection[]>([])
  const [userInstructions, setUserInstructions] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MultiCompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRefs = [
    useState<HTMLInputElement | null>(null),
    useState<HTMLInputElement | null>(null),
    useState<HTMLInputElement | null>(null),
    useState<HTMLInputElement | null>(null),
  ]

  useEffect(() => {
    connectionsApi.list(activeProject?.id).then(setConnections).catch(() => {})
  }, [activeProject?.id])

  const updateSlot = (idx: number, patch: Partial<SlotState>) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  const clearSlot = (idx: number) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...EMPTY_SLOT } : s))
  }

  const handleFileChange = async (idx: number, file: File) => {
    updateSlot(idx, { file, file_name: file.name, file_row_count: null })
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      try {
        const XLSX = await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]
        const rowCount = Math.max(0, data.length - 1)
        updateSlot(idx, { file_row_count: rowCount })
      } catch {
        /* row count stays null */
      }
    }
  }

  const filledSlots = slots.filter((s, i) => {
    if (s.source_type === 'db') return !!(s.conn_id && s.sql.trim())
    if (s.source_type === 'file') return !!s.file
    return false
  })
  const canRun = filledSlots.length >= 2 && !running

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const slotConfigs = slots
        .map((s, i) => ({ ...s, slot_index: i }))
        .filter(s => s.source_type !== null)
        .map(s => ({
          slot_index:     s.slot_index,
          source_type:    s.source_type as 'db' | 'file',
          conn_id:        s.conn_id,
          sql:            s.sql || null,
          label:          s.label || null,
          file_name:      s.file_name,
          file_row_count: s.file_row_count,
        }))
      const files = slots.map(s => s.file)
      const res = await multiCompareApi.run(slotConfigs, files, userInstructions)
      setResult(res)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message ?? 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  const verdictColor = (v: string): 'success' | 'error' | 'warning' => {
    if (v === 'PASS') return 'success'
    if (v === 'FAIL') return 'error'
    return 'warning'
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          <CompareArrowsOutlined sx={{ mr: 1, verticalAlign: 'middle' }} />
          Multi-Source AI Comparison
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Configure up to 4 data sources (DB queries or uploaded files). AI will analyze all datasets and produce a structured comparison report.
        </Typography>
      </Box>

      {/* Slot cards — 2×2 grid */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {slots.map((slot, idx) => (
          <Grid item xs={12} md={6} key={idx}>
            <Paper variant="outlined" sx={{ p: 2, position: 'relative' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Dataset {idx + 1}
                </Typography>
                {slot.source_type && (
                  <Tooltip title="Clear slot">
                    <IconButton size="small" onClick={() => clearSlot(idx)} sx={{ ml: 'auto' }}>
                      <ClearOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>

              {/* Source type toggle */}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={slot.source_type}
                onChange={(_, v) => {
                  if (v !== null) updateSlot(idx, { source_type: v, conn_id: null, sql: '', file: null, file_name: null, file_row_count: null })
                  else updateSlot(idx, { source_type: null })
                }}
                sx={{ mb: 1.5 }}
              >
                <ToggleButton value="db">
                  <StorageOutlined fontSize="small" sx={{ mr: 0.5 }} />DB Query
                </ToggleButton>
                <ToggleButton value="file">
                  <UploadFileOutlined fontSize="small" sx={{ mr: 0.5 }} />File Upload
                </ToggleButton>
              </ToggleButtonGroup>

              {slot.source_type === 'db' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Connection</InputLabel>
                    <Select
                      label="Connection"
                      value={slot.conn_id ?? ''}
                      onChange={e => updateSlot(idx, { conn_id: Number(e.target.value) || null })}
                    >
                      {connections.map(c => (
                        <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="SQL Query"
                    size="small"
                    fullWidth
                    multiline
                    rows={4}
                    value={slot.sql}
                    onChange={e => updateSlot(idx, { sql: e.target.value })}
                    placeholder="SELECT * FROM ..."
                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
                  />
                </Box>
              )}

              {slot.source_type === 'file' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.json,.xml"
                    style={{ display: 'none' }}
                    id={`file-input-${idx}`}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleFileChange(idx, f)
                    }}
                  />
                  <label htmlFor={`file-input-${idx}`}>
                    <Button
                      variant="outlined"
                      component="span"
                      startIcon={<UploadFileOutlined />}
                      size="small"
                      fullWidth
                    >
                      Choose File
                    </Button>
                  </label>
                  {slot.file_name && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <InsertDriveFileOutlined fontSize="small" color="primary" />
                      <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                        {slot.file_name}
                      </Typography>
                      {slot.file_row_count !== null && (
                        <Chip size="small" label={`${slot.file_row_count.toLocaleString()} rows`} />
                      )}
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Supported: .xlsx, .xls, .csv, .json, .xml
                  </Typography>
                </Box>
              )}

              {/* Optional label */}
              {slot.source_type && (
                <TextField
                  label="Label (optional)"
                  size="small"
                  fullWidth
                  value={slot.label}
                  onChange={e => updateSlot(idx, { label: e.target.value })}
                  placeholder={`e.g. Production DB, Legacy Export`}
                  sx={{ mt: 1.5 }}
                />
              )}

              {/* Readiness indicator */}
              {slot.source_type === 'db' && slot.conn_id && slot.sql.trim() && (
                <Chip size="small" color="success" label="Ready" icon={<CheckCircleOutlined />} sx={{ mt: 1 }} />
              )}
              {slot.source_type === 'file' && slot.file && (
                <Chip size="small" color="success" label="Ready" icon={<CheckCircleOutlined />} sx={{ mt: 1 }} />
              )}
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Instructions */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Comparison Instructions (optional)
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={2}
          size="small"
          placeholder="e.g. Check if record counts match. Verify no NULLs in the ID column. Focus on date range differences. — Leave blank for AI to decide."
          value={userInstructions}
          onChange={e => setUserInstructions(e.target.value)}
        />
      </Paper>

      {/* Run section */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={running ? <CircularProgress size={18} color="inherit" /> : <CompareArrowsOutlined />}
          onClick={handleRun}
          disabled={!canRun}
        >
          {running ? 'Running AI Comparison…' : 'Run AI Comparison'}
        </Button>
        {filledSlots.length < 2 && (
          <Alert severity="info" sx={{ py: 0.5 }}>
            Configure at least 2 data source slots to run.
          </Alert>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      {/* Results */}
      {result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

          {/* Dataset summaries */}
          <Box>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Dataset Summaries
            </Typography>
            <Grid container spacing={2}>
              {result.datasets.map(ds => (
                <Grid item xs={12} sm={6} md={3} key={ds.slot_index}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      {ds.source_type === 'db'
                        ? <StorageOutlined fontSize="small" color="primary" />
                        : <InsertDriveFileOutlined fontSize="small" color="action" />}
                      <Typography variant="subtitle2" fontWeight={700} noWrap>{ds.label}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {ds.row_count.toLocaleString()} rows · {ds.column_count} columns
                    </Typography>
                    {ds.file_name && (
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {ds.file_name}
                      </Typography>
                    )}
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {ds.columns.slice(0, 8).map(col => (
                        <Chip key={col} label={col} size="small" variant="outlined" sx={{ fontSize: 10 }} />
                      ))}
                      {ds.columns.length > 8 && (
                        <Chip label={`+${ds.columns.length - 8}`} size="small" sx={{ fontSize: 10 }} />
                      )}
                    </Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* Checks AI chose */}
          {result.checks_performed.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Checks Performed
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {result.checks_performed.map(c => (
                  <Chip key={c} label={c} size="small" color="primary" variant="outlined" />
                ))}
              </Box>
            </Box>
          )}

          {/* Checks table */}
          {result.checks.length > 0 && (
            <Box>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Comparison Results
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Check</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Datasets</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Detail</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.checks.map((chk: MultiCompareCheck, i: number) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{chk.check_name}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            icon={STATUS_ICONS[chk.status] as any}
                            label={chk.status}
                            color={STATUS_COLORS[chk.status] ?? 'default'}
                            sx={{ fontWeight: 700 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {chk.datasets_involved.map(d => (
                              <Chip key={d} size="small" label={`D${d + 1}`} variant="outlined" />
                            ))}
                          </Box>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 400 }}>
                          <Typography variant="body2">{chk.detail}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {/* Overall verdict + narrative */}
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderColor: result.overall_verdict === 'PASS' ? 'success.main'
                : result.overall_verdict === 'FAIL' ? 'error.main' : 'warning.main',
              borderWidth: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <LightbulbOutlined color={verdictColor(result.overall_verdict)} />
              <Typography variant="h6" fontWeight={700}>AI Verdict</Typography>
              <Chip
                label={result.overall_verdict}
                color={verdictColor(result.overall_verdict)}
                icon={STATUS_ICONS[result.overall_verdict] as any}
                sx={{ fontWeight: 700 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                {Math.round(result.elapsed_ms / 1000)}s
              </Typography>
            </Box>
            <Typography variant="body1" fontWeight={600} gutterBottom>
              {result.verdict_summary}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {result.ai_narrative}
            </Typography>
            {result.user_instructions && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Instructions used: <em>{result.user_instructions}</em>
                </Typography>
              </Box>
            )}
          </Paper>

          {/* AI Trace */}
          <AITracePanel result={result} />
        </Box>
      )}
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TestingPage() {
  const activeConnection = useAppStore(s => s.activeConnection)
  const connId = activeConnection?.id ?? null

  const [tab, setTab] = useState(0)
  const [lastRunId, setLastRunId] = useState<string | undefined>()

  const handleRunComplete = (runId: string) => {
    setLastRunId(runId)
    setTab(2) // auto-navigate to Results tab
  }

  const noConnAlert = (
    <Alert severity="info" icon={<StorageOutlined />}>
      Select a connection in the top bar to use the Reconciliation Engine.
    </Alert>
  )

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Page header */}
      <Box sx={{ px: 3, pt: 3, pb: 1 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          <CompareArrowsOutlined sx={{ mr: 1, verticalAlign: 'middle' }} />
          Testing &amp; Reconciliation
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Dev vs Base reconciliation engine · Multi-source AI comparison
        </Typography>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab icon={<StorageOutlined />} iconPosition="start" label="BASE Query Library" />
          <Tab icon={<PlayArrowOutlined />} iconPosition="start" label="Run DEV vs BASE" />
          <Tab
            icon={
              <Badge color="error" variant="dot" invisible={!lastRunId}>
                <FactCheckOutlined />
              </Badge>
            }
            iconPosition="start"
            label="Results & Insights"
          />
          <Tab icon={<BarChartOutlined />} iconPosition="start" label="Dashboard" />
          <Tab icon={<TableChartOutlined />} iconPosition="start" label="By Source" />
          <Tab icon={<CompareArrowsOutlined />} iconPosition="start" label="Multi-Source Compare" />
        </Tabs>
      </Box>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {tab === 0 && (connId ? <QueryLibraryTab connId={connId} /> : noConnAlert)}
        {tab === 1 && (connId ? <RunTab connId={connId} onRunComplete={handleRunComplete} /> : noConnAlert)}
        {tab === 2 && (connId ? <ResultsTab connId={connId} selectedRunId={lastRunId} /> : noConnAlert)}
        {tab === 3 && (connId ? <DashboardTab connId={connId} /> : noConnAlert)}
        {tab === 4 && (connId ? <BySourceTab connId={connId} /> : noConnAlert)}
        {tab === 5 && <MultiSourceCompareTab />}
      </Box>
    </Box>
  )
}
