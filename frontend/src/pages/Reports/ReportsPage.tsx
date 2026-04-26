import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Table, TableContainer, TableHead, TableRow, TableCell, TableBody,
  Chip, Divider, Paper, Tabs, Tab, IconButton,
  Tooltip, alpha, CircularProgress, List, ListItemButton,
  ListItemText, ListItemIcon, Alert, Collapse, Autocomplete,
  Stack, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import {
  AutoAwesomeOutlined, PlayArrowOutlined, DownloadOutlined,
  ContentCopyOutlined, BarChartOutlined, TableChartOutlined,
  SaveOutlined, DashboardOutlined, StorageOutlined,
  TrendingUpOutlined, NumbersOutlined, CalendarTodayOutlined,
  DeleteOutlined, BookmarkOutlined,
  CodeOutlined, CheckCircleOutlined, FilterListOutlined,
  ClearOutlined, DateRangeOutlined, ExpandMoreOutlined, ExpandLessOutlined,
  AccountTreeOutlined, AttachFileOutlined, SlideshowOutlined,
  InfoOutlined, LightbulbOutlined, ErrorOutlineOutlined,
  WarningAmberOutlined, TipsAndUpdatesOutlined, RefreshOutlined,
  LinkOutlined, CloudDownloadOutlined, TextFieldsOutlined,
} from '@mui/icons-material'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { reportApi, connectionsApi, approvalRequestsApi, developmentApi, integrationsApi } from '@/api'
import type { IntegrationConfig } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import DebugStepsPanel from '@/components/ai/DebugStepsPanel'
import type { DebugPayload } from '@/types'
import SchemaExplorer from './SchemaExplorer'

const CHART_COLORS = ['#2563eb', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#0284c7']

// ── Dashboard summary view ────────────────────────────────────────────────────
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

// ── Insights panel ────────────────────────────────────────────────────────────
function InsightsPanel({ insights, loading, onDeepen, hasResults }: {
  insights: Record<string, unknown> | null
  loading: boolean
  onDeepen: () => void
  hasResults: boolean
}) {
  if (loading) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 2 }}>
      <CircularProgress size={32} />
      <Typography variant="body2" color="text.secondary">Analysing data…</Typography>
    </Box>
  )
  if (!insights) return (
    <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
      <LightbulbOutlined sx={{ fontSize: 40, mb: 1 }} />
      <Typography variant="body2">{hasResults ? 'Could not load insights — check browser console for details.' : 'Run a query and open this tab to generate insights.'}</Typography>
    </Box>
  )

  const summary = insights.summary as string ?? ''
  const trends = (insights.trends as any[]) ?? []
  const outliers = (insights.outliers as any[]) ?? []
  const patterns = (insights.patterns as any[]) ?? []
  const nulls = (insights.nulls as any[]) ?? []
  const narrative = insights.narrative as Record<string, string> | undefined

  return (
    <Box>
      {/* Narrative from LLM */}
      {narrative && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.04), borderColor: 'primary.light' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <TipsAndUpdatesOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
            <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ letterSpacing: 0.5 }}>AI NARRATIVE</Typography>
          </Box>
          {narrative.executive_summary && <Typography variant="body2" sx={{ mb: 0.5 }}>{narrative.executive_summary}</Typography>}
          {narrative.key_finding && <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Key finding: {narrative.key_finding}</Typography>}
          {narrative.recommendation && <Typography variant="body2" color="text.secondary">Recommendation: {narrative.recommendation}</Typography>}
        </Paper>
      )}

      {/* Summary */}
      {summary && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{summary}</Typography>
      )}

      <Grid container spacing={2}>
        {/* Trends */}
        {trends.length > 0 && (
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                <TrendingUpOutlined sx={{ fontSize: 16, color: 'success.main' }} />
                <Typography variant="caption" fontWeight={700} color="success.main" sx={{ letterSpacing: 0.5 }}>TRENDS</Typography>
              </Box>
              {trends.map((t: any, i: number) => (
                <Box key={i} sx={{ mb: 0.5, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Chip label={t.direction ?? '↑'} size="small" color="success" variant="outlined" sx={{ fontSize: '0.65rem', height: 18, mt: 0.2 }} />
                  <Typography variant="caption">{t.note}</Typography>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {/* Outliers */}
        {outliers.length > 0 && (
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                <ErrorOutlineOutlined sx={{ fontSize: 16, color: 'warning.main' }} />
                <Typography variant="caption" fontWeight={700} color="warning.main" sx={{ letterSpacing: 0.5 }}>OUTLIERS</Typography>
              </Box>
              {outliers.map((o: any, i: number) => (
                <Box key={i} sx={{ mb: 0.5 }}>
                  <Typography variant="caption">{o.note}</Typography>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {/* Patterns */}
        {patterns.length > 0 && (
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                <BarChartOutlined sx={{ fontSize: 16, color: 'info.main' }} />
                <Typography variant="caption" fontWeight={700} color="info.main" sx={{ letterSpacing: 0.5 }}>PATTERNS</Typography>
              </Box>
              {patterns.map((p: any, i: number) => (
                <Box key={i} sx={{ mb: 1 }}>
                  <Typography variant="caption" fontWeight={600}>{p.column}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.3 }}>
                    {(p.values ?? []).slice(0, 5).map((v: string, j: number) => (
                      <Chip key={j} label={v} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                    ))}
                  </Box>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {/* Nulls */}
        {nulls.length > 0 && (
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                <WarningAmberOutlined sx={{ fontSize: 16, color: 'error.main' }} />
                <Typography variant="caption" fontWeight={700} color="error.main" sx={{ letterSpacing: 0.5 }}>DATA QUALITY</Typography>
              </Box>
              {nulls.map((n: any, i: number) => (
                <Box key={i} sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip label={n.null_rate} size="small" color="error" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                  <Typography variant="caption">'{n.column}' has missing values</Typography>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}
      </Grid>

      {!narrative && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined" size="small"
            startIcon={<TipsAndUpdatesOutlined />}
            onClick={onDeepen}
          >
            Deepen with AI
          </Button>
        </Box>
      )}
    </Box>
  )
}

export default function ReportsPage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const location = useLocation()

  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const prevConnIdRef = useRef<number | ''>(connId)
  const _locState = location.state as { prefillPrompt?: string; prefillSql?: string } | null
  const [nlQuery, setNlQuery] = useState(_locState?.prefillPrompt ?? '')
  const [importSource, setImportSource] = useState<'text' | 'jira' | 'ado'>('text')
  const [importKey, setImportKey]       = useState('')
  const [sql, setSql] = useState(_locState?.prefillSql ?? '')
  const [saveName, setSaveName] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [results, setResults] = useState<{ columns: string[]; rows: Record<string, unknown>[]; row_count?: number; execution_time_ms?: number } | null>(null)
  const [viewMode, setViewMode] = useState<'data' | 'chart' | 'dashboard' | 'insights'>('data')
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar')
  const [xAxis, setXAxis] = useState('')
  const [yAxis, setYAxis] = useState('')

  // Session / AI state
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<number | null>(null)
  const [askMeta, setAskMeta] = useState<{
    confidence?: number
    query_explanation?: string
    follow_up_suggestions?: string[]
    ambiguities?: string[]
  } | null>(null)
  const [insights, setInsights] = useState<Record<string, unknown> | null>(null)
  const [debugPayload, setDebugPayload] = useState<DebugPayload | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [docList, setDocList] = useState<{ id: number; filename: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Section collapse ─────────────────────────────────────────
  const [sqlOpen,     setSqlOpen]     = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)

  // ── Filters ──────────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false)
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

  // Clear state + create new session when connection changes
  useEffect(() => {
    if (prevConnIdRef.current !== connId) {
      prevConnIdRef.current = connId
      setSql('')
      setResults(null)
      setNlQuery('')
      setShowSave(false)
      setAskMeta(null)
      setInsights(null)
      setDocList([])
      setPendingApproval(null)
      setTurnCount(0)
    }
    if (connId) {
      reportApi.createSession(connId as number)
        .then((r) => setSessionId(r.session_id))
        .catch(() => setSessionId(null))
      // Re-discover any pending approvals in case user navigated away and back
      reportApi.getPendingApprovals(connId as number)
        .then((pending) => {
          const approved = pending.find((p) => p.status === 'approved')
          if (approved) { setPendingApproval(approved.id); return }
          const pending_ = pending.find((p) => p.status === 'pending' || p.status === 'in_progress')
          if (pending_) setPendingApproval(pending_.id)
        })
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  // Approval polling — check every 4s while a query is pending approval
  const pendingApprovalRef = useRef(pendingApproval)
  pendingApprovalRef.current = pendingApproval

  const _doResume = async (approvalId: number) => {
    try {
      const result = await reportApi.resumeQuery(approvalId)
      setPendingApproval(null)
      const r = result as any
      setSql(r.sql ?? '')
      if (r.columns && r.rows) {
        setResults({ columns: r.columns, rows: r.rows, row_count: r.total ?? r.rows.length })
        setTurnCount((t) => t + 1)
        _syncAxes(r.columns, r.rows)
      }
      setInsights(null)
      enqueueSnackbar('Query approved and executed successfully', { variant: 'success' })
    } catch (e: any) {
      enqueueSnackbar(`Resume failed: ${e.message ?? 'Unknown error'}`, { variant: 'error' })
    }
  }

  useEffect(() => {
    if (!pendingApproval) return
    const ivl = setInterval(async () => {
      try {
        const reqs = await approvalRequestsApi.listMyRequests()
        const req = reqs.find((r) => r.id === pendingApprovalRef.current)
        if (req?.status === 'approved') {
          clearInterval(ivl)
          await _doResume(pendingApprovalRef.current!)
        } else if (req?.status === 'rejected' || req?.status === 'cancelled') {
          setPendingApproval(null)
          enqueueSnackbar('Query was rejected by approver', { variant: 'error' })
        }
      } catch { /* network error — keep polling */ }
    }, 4000)
    return () => clearInterval(ivl)
  }, [pendingApproval]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch insights when switching to insights tab OR when results change while on tab
  useEffect(() => {
    if (viewMode === 'insights' && results && !insightsLoading) {
      _fetchInsights(false)
    }
  }, [viewMode, results]) // eslint-disable-line react-hooks/exhaustive-deps

  // Saved reports for this connection
  const { data: savedReports = [] } = useQuery({
    queryKey: ['saved-reports', connId],
    queryFn: () => reportApi.listSaved(connId as number),
    enabled: !!connId,
  })

  // Auto-run SQL when navigated from Agents artefact card
  const pendingSqlRef = useRef<string | null>(
    (location.state as { autoRunSql?: string } | null)?.autoRunSql ?? null
  )
  useEffect(() => {
    if (pendingSqlRef.current && connId) {
      const autoSql = pendingSqlRef.current
      pendingSqlRef.current = null
      setSql(autoSql)
      window.history.replaceState({}, '')
      connectionsApi.runQuery(connId as number, autoSql)
        .then((r) => {
          setResults(r)
          _syncAxes(r.columns, r.rows)
          enqueueSnackbar(`${r.row_count ?? r.rows.length} rows returned`, { variant: 'success' })
        })
        .catch(() => enqueueSnackbar('Auto-run failed — click Run Query to retry', { variant: 'warning' }))
    }
  }, [connId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────
  function _syncAxes(cols: string[], rows: Record<string, unknown>[]) {
    const sample = rows.slice(0, 5)
    const numericCols = cols.filter((c) =>
      sample.length > 0 && sample.every((row) => row[c] !== null && row[c] !== '' && !isNaN(Number(row[c])))
    )
    const textCols = cols.filter((c) => !numericCols.includes(c))
    setXAxis(textCols[0] ?? cols[0] ?? '')
    setYAxis(numericCols[0] ?? cols[1] ?? '')
  }

  async function _fetchInsights(useLlm: boolean) {
    if (!results) return
    setInsightsLoading(true)
    setInsights(null)
    try {
      const ins = await reportApi.getInsights(results.columns, results.rows, useLlm, nlQuery)
      setInsights(ins as Record<string, unknown>)
    } catch (e: any) {
      console.error('Insights fetch failed', e)
      enqueueSnackbar(e.message ?? 'Insights generation failed', { variant: 'error' })
    } finally {
      setInsightsLoading(false)
    }
  }

  // ── Mutations ────────────────────────────────────────────────
  const genSqlMutation = useMutation({
    mutationFn: () => sessionId
      ? reportApi.askFollowup({ session_id: sessionId, question: nlQuery, conn_id: connId as number })
      : reportApi.generateSql(connId as number, nlQuery),
    onSuccess: (r: any) => {
      // Approval-gated response (202 body)
      if (r.status === 'pending_approval') {
        setPendingApproval(r.approval_request_id)
        enqueueSnackbar('Query requires approval — you\'ll be notified when it\'s reviewed', { variant: 'warning' })
        return
      }
      setSql(r.sql)
      if (r.columns && r.rows) {
        setResults({ columns: r.columns, rows: r.rows, row_count: r.total ?? r.rows.length, execution_time_ms: r.execution_time_ms })
        setTurnCount((t) => t + 1)
        _syncAxes(r.columns, r.rows)
        setInsights(null)
        enqueueSnackbar(`${r.total ?? r.rows.length} rows returned`, { variant: 'success' })
      } else {
        setResults(null)
        enqueueSnackbar('SQL generated — review and run', { variant: 'success' })
      }
      if (r.confidence !== undefined || r.follow_up_suggestions) {
        setAskMeta({
          confidence: r.confidence,
          query_explanation: r.query_explanation,
          follow_up_suggestions: r.follow_up_suggestions,
          ambiguities: r.ambiguities,
        })
      } else {
        setAskMeta(null)
      }
      setDebugPayload((r as any).debug ?? null)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const runMutation = useMutation({
    mutationFn: (sqlOverride?: string) => connectionsApi.runQuery(connId as number, sqlOverride ?? sql),
    onSuccess: (r) => {
      setResults(r)
      _syncAxes(r.columns, r.rows)
      setAskMeta(null)
      setInsights(null)
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

  // ── JIRA / ADO import ─────────────────────────────────────────
  const { data: integrations = [] } = useQuery<IntegrationConfig[]>({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
    staleTime: 60_000,
  })
  const jiraConfigured = integrations.some((i) => i.type === 'jira' && i.has_token)
  const adoConfigured  = integrations.some((i) => i.type === 'ado'  && i.has_token)

  const importMut = useMutation({
    mutationFn: () => developmentApi.fetchExternal({
      source_type: importSource as 'jira' | 'ado',
      resource_id: importKey.trim(),
    }),
    onSuccess: (res) => {
      setNlQuery(res.text)
      enqueueSnackbar(`Imported from ${res.source_type.toUpperCase()} ${res.resource_id}`, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Import failed', { variant: 'error' }),
  })

  // ── Export ───────────────────────────────────────────────────
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

  const exportPpt = async () => {
    if (!results) return
    try {
      const blob = await reportApi.exportPpt(
        connId as number, nlQuery, results.columns, results.rows,
        chartData.length > 0 ? chartData : undefined,
      )
      const url = URL.createObjectURL(blob as Blob)
      const a = document.createElement('a'); a.href = url; a.download = 'report.pptx'; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      enqueueSnackbar(e.message ?? 'PPT export failed', { variant: 'error' })
    }
  }

  // ── Document upload ──────────────────────────────────────────
  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !sessionId) return
    e.target.value = ''
    try {
      const r = await reportApi.uploadDoc(sessionId, file)
      setDocList((d) => [...d, { id: r.doc_id, filename: r.filename }])
      enqueueSnackbar(`Uploaded ${r.filename} — content will be included in your next query`, { variant: 'success' })
    } catch (err: any) {
      enqueueSnackbar(err.message ?? 'Upload failed', { variant: 'error' })
    }
  }

  const removeDoc = async (docId: number) => {
    if (!sessionId) return
    try {
      await reportApi.deleteDoc(sessionId, docId)
      setDocList((d) => d.filter((x) => x.id !== docId))
    } catch {}
  }

  // ── Chart data ───────────────────────────────────────────────
  const allNumericCols = results
    ? results.columns.filter((c) => {
        const sample = results.rows.slice(0, 5)
        return sample.length > 0 && sample.every((row) => row[c] !== null && row[c] !== '' && !isNaN(Number(row[c])))
      })
    : []

  const chartData = results && yAxis
    ? filteredRows.slice(0, 20).map((r) => ({ name: String(r[xAxis] ?? ''), value: Number(r[yAxis] ?? 0) })).filter((d) => !isNaN(d.value))
    : []

  const confidenceColor = (c?: number) => {
    if (!c) return 'default' as const
    if (c >= 0.75) return 'success' as const
    if (c >= 0.5) return 'warning' as const
    return 'error' as const
  }

  return (
    <>
      {/* Hidden file input for doc upload */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        accept=".pdf,.docx,.xlsx,.csv,.txt"
        onChange={handleDocUpload}
      />

      <Box sx={{ p: 3, transition: 'margin-right 0.2s', mr: schemaOpen ? '300px' : 0 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <BarChartOutlined sx={{ fontSize: 28, color: 'primary.main', mr: 1 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={700}>Reports & Analytics</Typography>
            <Typography variant="body2" color="text.secondary">
              Ask questions in plain English or write SQL to analyze your data
            </Typography>
          </Box>
          {/* Session chip */}
          {sessionId && turnCount > 0 && (
            <Chip
              label={`Session · turn ${turnCount}`}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ mr: 1, fontSize: '0.72rem' }}
              onDelete={() => {
                reportApi.createSession(connId as number)
                  .then((r) => { setSessionId(r.session_id); setTurnCount(0); setDocList([]) })
                  .catch(() => {})
                enqueueSnackbar('New session started', { variant: 'info' })
              }}
              deleteIcon={<Tooltip title="Start new session"><RefreshOutlined /></Tooltip>}
            />
          )}
          {/* Browse Schema button */}
          {connId && (
            <Tooltip title={schemaOpen ? 'Close Schema Explorer' : 'Browse Schema'}>
              <IconButton
                onClick={() => setSchemaOpen((v) => !v)}
                color={schemaOpen ? 'primary' : 'default'}
                size="small"
              >
                <AccountTreeOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Approval pending alert */}
        {pendingApproval && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label={`Request #${pendingApproval}`} size="small" variant="outlined" color="warning" />
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  onClick={() => _doResume(pendingApproval)}
                  sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}
                >
                  Resume Now
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={async () => {
                    try { await approvalRequestsApi.deleteAllPending() } catch { /* already gone */ }
                    setPendingApproval(null)
                  }}
                  sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'text.secondary' }}
                >
                  Dismiss
                </Button>
              </Box>
            }
          >
            This query is awaiting approval. Auto-executes when approved — or click <strong>Resume Now</strong> if already approved.
          </Alert>
        )}

        <Grid container spacing={3}>
          <Grid item xs={12}>

            {/* Connection + AI bar */}
            <Card sx={{ mb: 2 }}>
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>

                {/* Source toggle */}
                <ToggleButtonGroup
                  value={importSource} exclusive size="small" fullWidth
                  onChange={(_, v) => v && setImportSource(v)}
                  sx={{ mb: 1.5 }}
                >
                  <ToggleButton value="text" sx={{ flex: 1, fontSize: '0.75rem', textTransform: 'none' }}>
                    <TextFieldsOutlined sx={{ fontSize: 15, mr: 0.5 }} /> Free Text
                  </ToggleButton>
                  <ToggleButton value="jira" sx={{ flex: 1, fontSize: '0.75rem', textTransform: 'none' }}>
                    <LinkOutlined sx={{ fontSize: 15, mr: 0.5 }} /> JIRA
                  </ToggleButton>
                  <ToggleButton value="ado" sx={{ flex: 1, fontSize: '0.75rem', textTransform: 'none' }}>
                    <LinkOutlined sx={{ fontSize: 15, mr: 0.5 }} /> Azure DevOps
                  </ToggleButton>
                </ToggleButtonGroup>

                {/* JIRA fetch panel */}
                {importSource === 'jira' && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
                    {jiraConfigured ? (
                      <Chip icon={<CheckCircleOutlined />} label="JIRA configured in Admin" color="success" size="small" variant="outlined" />
                    ) : (
                      <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                        JIRA not configured. Go to <strong>Admin → Integrations</strong> to set it up.
                      </Alert>
                    )}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <TextField label="Issue / Task Key" size="small" sx={{ flex: 1 }}
                        placeholder="PROJ-123 or numeric ID"
                        value={importKey} onChange={(e) => setImportKey(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && importKey.trim() && jiraConfigured) importMut.mutate() }} />
                      <Button variant="outlined" size="small"
                        startIcon={importMut.isPending ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
                        onClick={() => importMut.mutate()}
                        disabled={importMut.isPending || !importKey.trim() || !jiraConfigured}
                        sx={{ whiteSpace: 'nowrap' }}>
                        Fetch Item
                      </Button>
                    </Box>
                  </Box>
                )}

                {/* ADO fetch panel */}
                {importSource === 'ado' && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
                    {adoConfigured ? (
                      <Chip icon={<CheckCircleOutlined />} label="Azure DevOps configured in Admin" color="success" size="small" variant="outlined" />
                    ) : (
                      <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                        ADO not configured. Go to <strong>Admin → Integrations</strong> to set it up.
                      </Alert>
                    )}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <TextField label="Work Item ID" size="small" sx={{ flex: 1 }}
                        placeholder="456"
                        value={importKey} onChange={(e) => setImportKey(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && importKey.trim() && adoConfigured) importMut.mutate() }} />
                      <Button variant="outlined" size="small"
                        startIcon={importMut.isPending ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
                        onClick={() => importMut.mutate()}
                        disabled={importMut.isPending || !importKey.trim() || !adoConfigured}
                        sx={{ whiteSpace: 'nowrap' }}>
                        Fetch Work Item
                      </Button>
                    </Box>
                  </Box>
                )}

                <Grid container spacing={2} alignItems="flex-end">
                  <Grid item xs={12} md={savedReports.length > 0 ? 7 : 10}>
                    <TextField
                      label={importSource === 'text' ? 'Ask a question in plain English' : 'Fetched Requirement (editable)'}
                      value={nlQuery}
                      onChange={(e) => setNlQuery(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder={importSource === 'text' ? 'e.g. How many employees in each department?' : 'Click "Fetch" above to load from JIRA or ADO, or type here…'}
                      disabled={!connId}
                      multiline
                      minRows={1}
                      maxRows={6}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && connId && (nlQuery.trim() || docList.length > 0)) {
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
                      disabled={!connId || (!nlQuery.trim() && docList.length === 0) || genSqlMutation.isPending}
                      sx={{ py: 1 }}
                    >
                      AI Generate
                    </Button>
                  </Grid>
                </Grid>

                {/* Attached document chips */}
                {docList.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1.5 }}>
                    {docList.map((doc) => (
                      <Chip
                        key={doc.id}
                        label={doc.filename}
                        size="small"
                        icon={<AttachFileOutlined />}
                        onDelete={() => removeDoc(doc.id)}
                        color="primary"
                        variant="outlined"
                        sx={{ fontSize: '0.72rem' }}
                      />
                    ))}
                  </Box>
                )}

                {/* Attach doc + session controls */}
                {sessionId && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                    <Tooltip title="Attach a document (PDF, Word, Excel, CSV, TXT) — content will be merged with your next query">
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<AttachFileOutlined sx={{ fontSize: 14 }} />}
                        onClick={() => fileInputRef.current?.click()}
                        sx={{ fontSize: '0.75rem', color: 'text.secondary' }}
                      >
                        Attach Document
                      </Button>
                    </Tooltip>
                  </Box>
                )}
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
                    {/* Confidence badge */}
                    {askMeta?.confidence !== undefined && (
                      <Chip
                        label={`Confidence: ${Math.round(askMeta.confidence * 100)}%`}
                        size="small"
                        color={confidenceColor(askMeta.confidence)}
                        variant="outlined"
                        sx={{ fontSize: '0.7rem', height: 20 }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {/* Query explanation tooltip */}
                    {askMeta?.query_explanation && (
                      <Tooltip title={askMeta.query_explanation} arrow>
                        <InfoOutlined sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} onClick={(e) => e.stopPropagation()} />
                      </Tooltip>
                    )}
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

                {/* Ambiguity warnings */}
                {askMeta?.ambiguities && askMeta.ambiguities.length > 0 && sqlOpen && (
                  <Box sx={{ px: 2, pt: 1 }}>
                    {askMeta.ambiguities.map((a, i) => (
                      <Alert key={i} severity="info" sx={{ py: 0.2, mb: 0.5, fontSize: '0.75rem' }}>{a}</Alert>
                    ))}
                  </Box>
                )}

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
                        onClick={() => { setSql(''); setResults(null); setNlQuery(''); setAskMeta(null); setInsights(null) }}
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
                  {/* Left: title + chips */}
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

                  {/* Right: controls */}
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
                      <Tab value="insights" icon={<LightbulbOutlined fontSize="small" />} iconPosition="start" label="Insights" sx={{ minHeight: 36, py: 0, textTransform: 'none' }} />
                    </Tabs>
                    <Tooltip title="Export CSV">
                      <IconButton size="small" onClick={exportCsv}>
                        <DownloadOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Export PPT">
                      <IconButton size="small" onClick={exportPpt}>
                        <SlideshowOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Collapse in={resultsOpen} unmountOnExit>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  {/* ── Filter Panel ── */}
                  <Collapse in={filtersOpen}>
                    <Box sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.04), borderBottom: '1px solid', borderColor: 'divider' }}>
                        <FilterListOutlined sx={{ fontSize: 15, color: 'primary.main' }} />
                        <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ letterSpacing: 0.5 }}>
                          FILTERS
                        </Typography>
                        {hasActiveFilters && (
                          <Chip label={`${filteredRows.length} of ${results.rows.length} rows`} size="small" color="primary" variant="outlined" sx={{ ml: 0.5, height: 20, fontSize: '0.7rem' }} />
                        )}
                        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
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
                    <TableContainer sx={{ maxHeight: 480 }}>
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
                    </TableContainer>
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

                  {viewMode === 'insights' && (
                    <InsightsPanel
                      insights={insights}
                      loading={insightsLoading}
                      onDeepen={() => _fetchInsights(true)}
                      hasResults={!!results}
                    />
                  )}
                  </CardContent>
                </Collapse>

                {/* Follow-up suggestion chips — always shown when results exist */}
                {results && (() => {
                  const suggestions = askMeta?.follow_up_suggestions?.length
                    ? askMeta.follow_up_suggestions
                    : ['Show trends over time', 'Detect anomalies', 'Summarize this dataset', 'Export as PPT']
                  return (
                    <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.secondary.main, 0.03) }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>Ask next:</Typography>
                      <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {suggestions.map((s, i) => (
                          <Chip
                            key={i}
                            label={s}
                            size="small"
                            variant="outlined"
                            color="secondary"
                            clickable
                            sx={{ fontSize: '0.72rem' }}
                            onClick={() => {
                              setNlQuery(s)
                              setTimeout(() => genSqlMutation.mutate(), 50)
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )
                })()}
              </Card>
            )}
          </Grid>
        </Grid>
      </Box>

      {debugPayload && (
        <Box sx={{ px: 3, pb: 2 }}>
          <DebugStepsPanel debug={debugPayload} module="report" />
        </Box>
      )}

      {/* Schema Explorer drawer */}
      <SchemaExplorer
        connId={connId}
        open={schemaOpen}
        onClose={() => setSchemaOpen(false)}
        onInsert={(text) => setNlQuery((q) => (q + ' ' + text).trim())}
      />
    </>
  )
}
