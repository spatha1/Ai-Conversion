import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Typography, TextField, IconButton, Tooltip,
  Chip, Collapse, CircularProgress, alpha, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  List, ListItem, ListItemIcon, ListItemText, AppBar, Toolbar,
  Paper,
} from '@mui/material'
import {
  AutoAwesomeOutlined, CloseOutlined, SendOutlined,
  ExpandMoreOutlined, ExpandLessOutlined,
  WarningAmberOutlined, ErrorOutlineOutlined, InfoOutlined,
  CheckCircleOutlineOutlined, PlayArrowOutlined,
  MonitorHeartOutlined, DeleteSweepOutlined,
  PrintOutlined, TableChartOutlined, BarChartOutlined,
  ArrowUpwardOutlined, ArrowDownwardOutlined,
} from '@mui/icons-material'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { askAiApi } from '@/api'
import type {
  AskAIResult, AskAIKpi, AskAIAlert, AskAIAction,
  AskAIFollowUp, AskAITraceStep,
} from '@/types'
import { tokens } from '@/theme/theme'

const AI_COLOR    = tokens.violet600 ?? '#7c3aed'
const CHART_COLORS = ['#7c3aed', '#059669', '#d97706', '#0284c7', '#dc2626']

// ── Typing indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', py: 0.5 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 6, height: 6, borderRadius: '50%', bgcolor: AI_COLOR,
            animation: 'aiDot 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
            '@keyframes aiDot': {
              '0%, 80%, 100%': { opacity: 0.3, transform: 'scale(0.85)' },
              '40%':           { opacity: 1,   transform: 'scale(1)' },
            },
          }}
        />
      ))}
    </Box>
  )
}

// ── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct   = Math.round(confidence * 100)
  const color  = confidence >= 0.85 ? 'success' : confidence >= 0.60 ? 'warning' : 'error'
  return (
    <Chip
      label={`${pct}%`}
      size="small"
      color={color}
      variant="outlined"
      sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, ml: 1 }}
    />
  )
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

function KpiTile({ kpi }: { kpi: AskAIKpi }) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'

  const statusColor: Record<string, string> = {
    good:     tokens.emerald600 ?? '#059669',
    warning:  tokens.amber600   ?? '#d97706',
    critical: tokens.red600     ?? '#dc2626',
    neutral:  '#94a3b8',
  }
  const color = statusColor[kpi.status ?? 'neutral']

  const displayValue = () => {
    if (kpi.value === null || kpi.value === undefined) return '—'
    if (kpi.type === 'currency')   return `$${Number(kpi.value).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
    if (kpi.type === 'percentage') return `${kpi.value}%`
    if (kpi.type === 'score')      return String(kpi.value)
    return String(kpi.value)
  }

  const isScore = kpi.type === 'score'

  return (
    <Box
      sx={{
        px: 1.5, py: 1, borderRadius: 2, minWidth: 110, flexShrink: 0,
        border: '1px solid', borderColor: alpha(color, 0.3),
        bgcolor: alpha(color, isDark ? 0.1 : 0.06),
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {kpi.label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
        {isScore && <MonitorHeartOutlined sx={{ fontSize: 14, color }} />}
        <Typography variant="body2" fontWeight={700} sx={{ color }}>
          {displayValue()}
        </Typography>
      </Box>
      {isScore && (kpi as any)._band && (
        <Typography sx={{ fontSize: '0.6rem', color, fontWeight: 600, mt: 0.25 }}>
          {(kpi as any)._band}
        </Typography>
      )}
    </Box>
  )
}

// ── Alert banner ─────────────────────────────────────────────────────────────

function AlertBanner({ alert }: { alert: AskAIAlert }) {
  const icons = {
    error:   <ErrorOutlineOutlined   sx={{ fontSize: 14, color: tokens.red600   ?? '#dc2626', flexShrink: 0 }} />,
    warning: <WarningAmberOutlined   sx={{ fontSize: 14, color: tokens.amber600 ?? '#d97706', flexShrink: 0 }} />,
    info:    <InfoOutlined           sx={{ fontSize: 14, color: tokens.sky600   ?? '#0284c7', flexShrink: 0 }} />,
  }
  const colors = { error: tokens.red600 ?? '#dc2626', warning: tokens.amber600 ?? '#d97706', info: tokens.sky600 ?? '#0284c7' }
  const color   = colors[alert.level]
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, py: 0.25 }}>
      {icons[alert.level]}
      <Typography variant="caption" sx={{ color, lineHeight: 1.4 }}>{alert.message}</Typography>
    </Box>
  )
}

// ── Trace accordion ───────────────────────────────────────────────────────────

function TraceAccordion({ steps }: { steps: AskAITraceStep[] }) {
  const [open, setOpen] = useState(false)
  if (!steps?.length) return null
  const totalMs = steps.reduce((s, t) => s + (t.duration_ms ?? 0), 0)

  return (
    <Box>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.disabled', '&:hover': { color: AI_COLOR }, transition: 'color .15s' }}
      >
        {open ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem' }}>
          {open ? 'Hide' : 'Show'} AI Trace · {totalMs}ms
        </Typography>
      </Box>

      <Collapse in={open}>
        <Box sx={{ mt: 0.75, pl: 1, borderLeft: `2px solid ${alpha(AI_COLOR, 0.3)}` }}>
          {steps.map((step) => (
            <Box key={step.step_number} sx={{ mb: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <CheckCircleOutlineOutlined
                  sx={{ fontSize: 12, color: step.status === 'success' ? tokens.emerald600 : tokens.red600 }}
                />
                <Typography variant="caption" fontWeight={700} color="text.primary">
                  Step {step.step_number}: {step.step_name}
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', flexShrink: 0 }}>
                  {step.duration_ms}ms
                </Typography>
                {step.confidence !== undefined && <ConfidenceBadge confidence={step.confidence} />}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ pl: 2.5, display: 'block', lineHeight: 1.4 }}>
                {step.summary}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Data grid ─────────────────────────────────────────────────────────────────

const MAX_DISPLAY_ROWS = 200

function DataGrid({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const isDark  = useAppStore((s) => s.themeMode) === 'dark'
  const [sortCol, setSortCol]   = useState<string | null>(null)
  const [sortAsc, setSortAsc]   = useState(true)
  const [showAll, setShowAll]   = useState(false)

  if (!columns.length) return null

  const sorted = useMemo(() => {
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
  }, [rows, sortCol, sortAsc])

  const displayed = showAll ? sorted : sorted.slice(0, MAX_DISPLAY_ROWS)

  const handleSort = (col: string) => {
    if (sortCol === col) { setSortAsc((v) => !v) } else { setSortCol(col); setSortAsc(true) }
  }

  const cellBg    = (i: number) => isDark
    ? (i % 2 === 0 ? 'transparent' : alpha('#fff', 0.03))
    : (i % 2 === 0 ? '#fff' : '#f8fafc')

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <TableChartOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
          Data · {rows.length} row{rows.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      <Box sx={{ overflowX: 'auto', borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <Box component="thead">
            <Box component="tr">
              {columns.map((col) => (
                <Box
                  key={col}
                  component="th"
                  onClick={() => handleSort(col)}
                  sx={{
                    px: 1.5, py: 0.75, textAlign: 'left', whiteSpace: 'nowrap',
                    bgcolor: isDark ? alpha(AI_COLOR, 0.12) : alpha(AI_COLOR, 0.06),
                    borderBottom: '1px solid', borderColor: 'divider',
                    cursor: 'pointer', userSelect: 'none', fontWeight: 700,
                    color: sortCol === col ? AI_COLOR : 'text.primary',
                    '&:hover': { bgcolor: isDark ? alpha(AI_COLOR, 0.2) : alpha(AI_COLOR, 0.1) },
                    transition: 'background .15s',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {col}
                    {sortCol === col && (
                      sortAsc
                        ? <ArrowUpwardOutlined sx={{ fontSize: 11 }} />
                        : <ArrowDownwardOutlined sx={{ fontSize: 11 }} />
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {displayed.map((row, ri) => (
              <Box component="tr" key={ri} sx={{ bgcolor: cellBg(ri), '&:hover': { bgcolor: alpha(AI_COLOR, 0.04) } }}>
                {columns.map((col) => (
                  <Box
                    key={col}
                    component="td"
                    sx={{
                      px: 1.5, py: 0.6, borderBottom: ri < displayed.length - 1 ? '1px solid' : 'none',
                      borderColor: 'divider', whiteSpace: 'nowrap', maxWidth: 260,
                      overflow: 'hidden', textOverflow: 'ellipsis', color: 'text.primary',
                    }}
                    title={String(row[col] ?? '')}
                  >
                    {row[col] === null || row[col] === undefined ? (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    ) : String(row[col])}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {rows.length > MAX_DISPLAY_ROWS && !showAll && (
        <Box sx={{ mt: 0.75, textAlign: 'center' }}>
          <Button size="small" variant="text" onClick={() => setShowAll(true)} sx={{ fontSize: '0.7rem', color: AI_COLOR }}>
            Show all {rows.length} rows
          </Button>
        </Box>
      )}
    </Box>
  )
}

// ── Auto chart ────────────────────────────────────────────────────────────────

function AutoChart({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'

  // Only render for 2–100 rows
  if (rows.length < 2 || rows.length > 100 || !columns.length) return null

  // Find numeric columns and a label column
  const numericCols = columns.filter((col) => rows.some((r) => typeof r[col] === 'number'))
  if (!numericCols.length) return null

  const labelCol    = columns.find((col) => typeof rows[0][col] === 'string') ?? columns[0]
  const barCols     = numericCols.slice(0, 3)

  const chartData = rows.slice(0, 50).map((row) => {
    const entry: Record<string, unknown> = { _label: String(row[labelCol] ?? '') }
    barCols.forEach((col) => { entry[col] = Number(row[col]) || 0 })
    return entry
  })

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <BarChartOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
          Chart
        </Typography>
      </Box>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} />
          <XAxis
            dataKey="_label"
            tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }} width={48} />
          <ReTooltip
            contentStyle={{
              background: isDark ? '#1e293b' : '#fff',
              border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          {barCols.length > 1 && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />}
          {barCols.map((col, i) => (
            <Bar key={col} dataKey={col} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

// ── Action safety dialog ──────────────────────────────────────────────────────

interface ActionDialogProps {
  action:    AskAIAction | null
  connId:    number
  sessionId: string | null
  onClose:   () => void
  onDone:    (msg: string) => void
}

function ActionSafetyDialog({ action, connId, sessionId, onClose, onDone }: ActionDialogProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [running, setRunning]         = useState(false)

  if (!action) return null

  const handleConfirm = async () => {
    setRunning(true)
    try {
      const res = await askAiApi.executeAction({
        action_type: action.action_type,
        entity:      action.entity,
        entity_id:   action.entity_id,
        conn_id:     connId,
        session_id:  sessionId,
        confirmed:   true,
        query_sql:   action.query_sql,
      })
      onDone(res.message)
    } catch (err: any) {
      onDone(`Error: ${err?.response?.data?.detail ?? err.message}`)
    } finally {
      setRunning(false)
      onClose()
    }
  }

  return (
    <Dialog open maxWidth="xs" fullWidth onClose={onClose}>
      <DialogTitle sx={{ fontSize: '0.9rem', fontWeight: 700 }}>Confirm Action</DialogTitle>
      <DialogContent dividers sx={{ pt: 1.5, pb: 1 }}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          This will execute: <strong>{action.label}</strong>
          {action.entity && ` for ${action.entity} ${action.entity_id ?? ''}`}
        </Typography>

        <Box
          component="button"
          onClick={() => setShowPreview((v) => !v)}
          sx={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, color: AI_COLOR, fontSize: '0.75rem', fontWeight: 600 }}
        >
          {showPreview ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
          Preview steps
        </Box>

        <Collapse in={showPreview}>
          <List dense sx={{ mt: 0.5 }}>
            {action.preview_steps.map((step, i) => (
              <ListItem key={i} disableGutters sx={{ py: 0.25 }}>
                <ListItemIcon sx={{ minWidth: 24 }}>
                  <Typography variant="caption" color="text.disabled" fontWeight={700}>{i + 1}.</Typography>
                </ListItemIcon>
                <ListItemText primary={<Typography variant="caption">{step}</Typography>} />
              </ListItem>
            ))}
          </List>
        </Collapse>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5 }}>
        <Button size="small" onClick={onClose} disabled={running}>Cancel</Button>
        <Button
          size="small" variant="contained" color="primary"
          onClick={handleConfirm} disabled={running}
          startIcon={running ? <CircularProgress size={12} color="inherit" /> : <PlayArrowOutlined />}
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Document card (A4-style AI response) ─────────────────────────────────────

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

interface DocumentCardProps {
  result:     AskAIResult
  connId:     number
  sessionId:  string | null
  onFollowUp: (q: string) => void
}

function DocumentCard({ result, connId, sessionId, onFollowUp }: DocumentCardProps) {
  const [confirmAction, setConfirmAction] = useState<AskAIAction | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const isDark = useAppStore((s) => s.themeMode) === 'dark'

  const handlePrint = () => window.print()

  // If clarification needed → simple inline message
  if (result.clarification_prompt) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 2, borderRadius: 2, mt: 1.5,
          borderColor: alpha(tokens.amber600 ?? '#d97706', 0.35),
          bgcolor: alpha(tokens.amber600 ?? '#d97706', isDark ? 0.08 : 0.04),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 14, color: AI_COLOR }} />
          <Typography variant="caption" fontWeight={700} color="text.primary">Ask AI</Typography>
          <WarningAmberOutlined sx={{ fontSize: 14, color: tokens.amber600 }} />
          <Typography variant="caption" color={tokens.amber600} fontWeight={600}>Needs clarification</Typography>
        </Box>
        <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6 }}>
          {result.clarification_prompt}
        </Typography>
      </Paper>
    )
  }

  const healthKpi  = result.kpis?.find((k) => k.type === 'score')
  const otherKpis  = result.kpis?.filter((k) => k.type !== 'score') ?? []
  const displayKpis = [...otherKpis, ...(healthKpi ? [healthKpi] : [])].filter((k) => k.value !== null)

  const rawColumns = result.raw_data?.columns ?? []
  const rawRows    = result.raw_data?.rows    ?? []

  const entityLabel = result.intent?.entity
    ? `${result.intent.entity}${result.intent.entity_id ? ` #${result.intent.entity_id}` : ''}`
    : null

  return (
    <>
      {/* A4 document card */}
      <Paper
        className="ask-ai-document"
        elevation={2}
        sx={{
          mt: 1.5,
          maxWidth: 794,   // A4 width at 96dpi
          width: '100%',
          borderRadius: 3,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          '@media print': {
            boxShadow: 'none',
            borderRadius: 0,
            maxWidth: '100%',
          },
        }}
      >
        {/* Document header */}
        <Box
          sx={{
            px: 2.5, py: 1.5,
            display: 'flex', alignItems: 'center', gap: 1,
            bgcolor: isDark ? alpha(AI_COLOR, 0.14) : alpha(AI_COLOR, 0.06),
            borderBottom: '1px solid', borderColor: 'divider',
            '@media print': { bgcolor: '#f1f5f9' },
          }}
        >
          <AutoAwesomeOutlined sx={{ fontSize: 16, color: AI_COLOR, flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={700} color={AI_COLOR} sx={{ flex: 1 }}>
            Ask AI{entityLabel ? ` · ${entityLabel}` : ''}
          </Typography>
          {result.intent?.confidence !== undefined && (
            <ConfidenceBadge confidence={result.intent.confidence} />
          )}
          <Tooltip title="Print this document">
            <IconButton
              onClick={handlePrint}
              size="small"
              sx={{ color: 'text.secondary', ml: 0.5, '@media print': { display: 'none' } }}
            >
              <PrintOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* KPI tiles */}
          {displayKpis.length > 0 && (
            <Box>
              <Typography variant="caption" sx={{ ...SECTION_LABEL, color: 'text.disabled', display: 'block', mb: 0.75 }}>
                Summary
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {displayKpis.map((kpi, i) => <KpiTile key={i} kpi={kpi} />)}
              </Box>
            </Box>
          )}

          {/* Alerts */}
          {result.alerts?.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {result.alerts.map((a, i) => <AlertBanner key={i} alert={a} />)}
            </Box>
          )}

          {/* Narrative */}
          {result.narrative && (
            <Box>
              <Typography variant="caption" sx={{ ...SECTION_LABEL, color: 'text.disabled', display: 'block', mb: 0.5 }}>
                Analysis
              </Typography>
              <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.8 }}>
                {result.narrative}
              </Typography>
            </Box>
          )}

          {/* Data grid */}
          {rawColumns.length > 0 && rawRows.length > 0 && (
            <Box>
              <DataGrid columns={rawColumns} rows={rawRows} />
            </Box>
          )}

          {/* Chart */}
          {rawColumns.length > 0 && rawRows.length > 0 && (
            <AutoChart columns={rawColumns} rows={rawRows} />
          )}

          {/* PII notice */}
          {result.pii_masked?.length > 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
              Sensitive fields masked: {result.pii_masked.join(', ')}
            </Typography>
          )}

          {/* Data source + trace */}
          {(result.data_sources?.summary || result.trace_steps?.length > 0) && (
            <Box
              sx={{
                pt: 1.5, borderTop: '1px dashed', borderColor: 'divider',
                display: 'flex', flexDirection: 'column', gap: 0.75,
                '@media print': { display: 'none' },
              }}
            >
              {result.data_sources?.summary && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <InfoOutlined sx={{ fontSize: 12, color: 'text.disabled', flexShrink: 0 }} />
                  <Typography variant="caption" color="text.disabled" sx={{ lineHeight: 1.35 }}>
                    {result.data_sources.summary}
                  </Typography>
                </Box>
              )}
              <TraceAccordion steps={result.trace_steps} />
            </Box>
          )}

          {/* Actions */}
          {result.actions?.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', '@media print': { display: 'none' } }}>
              {result.actions.map((action, i) => (
                <Button
                  key={i}
                  size="small"
                  variant="outlined"
                  onClick={async () => {
                    if (action.requires_confirmation) {
                      setConfirmAction(action)
                    } else {
                      try {
                        const res = await askAiApi.executeAction({
                          action_type: action.action_type,
                          entity:      action.entity,
                          entity_id:   action.entity_id,
                          conn_id:     connId,
                          session_id:  sessionId,
                          confirmed:   true,
                          query_sql:   action.query_sql,
                        })
                        setActionFeedback((res as any).message ?? `${action.label}: done.`)
                      } catch {
                        setActionFeedback(`${action.label}: navigate to the relevant tab.`)
                      }
                    }
                  }}
                  sx={{
                    fontSize: '0.7rem', fontWeight: 600, textTransform: 'none',
                    borderColor: alpha(AI_COLOR, 0.4), color: AI_COLOR,
                    '&:hover': { borderColor: AI_COLOR, bgcolor: alpha(AI_COLOR, 0.06) },
                  }}
                  startIcon={action.requires_confirmation ? <WarningAmberOutlined sx={{ fontSize: 12 }} /> : undefined}
                >
                  {action.label}
                </Button>
              ))}
            </Box>
          )}

          {actionFeedback && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {actionFeedback}
            </Typography>
          )}
        </Box>
      </Paper>

      {/* Follow-up suggestions — outside the printed card */}
      {result.follow_ups?.length > 0 && (
        <Box sx={{ mt: 0.75, '@media print': { display: 'none' } }}>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.5 }}>
            You might also ask:
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {result.follow_ups.map((f, i) => (
              <Chip
                key={i}
                label={f.label}
                size="small"
                onClick={() => onFollowUp(f.query)}
                sx={{
                  fontSize: '0.68rem', cursor: 'pointer', height: 22,
                  bgcolor: alpha(AI_COLOR, 0.07), color: AI_COLOR,
                  border: `1px solid ${alpha(AI_COLOR, 0.25)}`,
                  '&:hover': { bgcolor: alpha(AI_COLOR, 0.14) },
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Confirmation dialog */}
      <ActionSafetyDialog
        action={confirmAction}
        connId={connId}
        sessionId={sessionId}
        onClose={() => setConfirmAction(null)}
        onDone={(msg) => setActionFeedback(msg)}
      />
    </>
  )
}

// ── Message types ─────────────────────────────────────────────────────────────

interface Message {
  id:      string
  role:    'user' | 'assistant'
  text?:   string
  result?: AskAIResult
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AskAIPanel() {
  const [messages,   setMessages]   = useState<Message[]>([])
  const [input,      setInput]      = useState('')
  const [sessionId,  setSessionId]  = useState<string | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const isDark     = useAppStore((s) => s.themeMode) === 'dark'

  const askAIOpen    = useAppStore((s) => s.askAIOpen)
  const setAskAIOpen = useAppStore((s) => s.setAskAIOpen)

  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId           = activeConnection?.id ?? 0

  const chatMutation = useMutation({
    mutationFn: (msg: string) =>
      askAiApi.chat({ message: msg, conn_id: connId, session_id: sessionId }),
    onSuccess: (result) => {
      if (result.session_id && !sessionId) setSessionId(result.session_id)
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', result }])
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? err.message ?? 'Something went wrong'
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', text: `Error: ${msg}` }])
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatMutation.isPending])

  const submit = useCallback((msg: string) => {
    const q = msg.trim()
    if (!q || chatMutation.isPending) return
    if (!connId) {
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', text: 'Please select a connection first.' }])
      return
    }
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: q }])
    setInput('')
    chatMutation.mutate(q)
  }, [chatMutation, connId])

  const handleSend    = useCallback(() => submit(input), [submit, input])
  const handleFollowUp = useCallback((q: string) => submit(q), [submit])
  const handleKeyDown  = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <Dialog
      open={askAIOpen}
      onClose={() => setAskAIOpen(false)}
      fullScreen
      sx={{ zIndex: 1300 }}
      PaperProps={{ sx: { display: 'flex', flexDirection: 'column', bgcolor: 'background.default' } }}
    >
      {/* Header */}
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: isDark ? alpha(AI_COLOR, 0.18) : alpha(AI_COLOR, 0.08),
          borderBottom: '1px solid', borderColor: 'divider',
          '@media print': { display: 'none' },
        }}
      >
        <Toolbar sx={{ minHeight: '52px !important', px: 3, gap: 1.5 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 20, color: AI_COLOR }} />
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1, color: AI_COLOR, fontSize: '1rem' }}>
            Ask AI
          </Typography>
          {activeConnection && (
            <Chip
              label={activeConnection.name}
              size="small"
              sx={{ height: 22, fontSize: '0.7rem', bgcolor: alpha(AI_COLOR, 0.12), color: AI_COLOR, border: `1px solid ${alpha(AI_COLOR, 0.25)}` }}
            />
          )}
          {messages.length > 0 && (
            <Tooltip title="Clear conversation">
              <IconButton
                onClick={() => { setMessages([]); setSessionId(null) }}
                sx={{ color: 'text.secondary', '&:hover': { color: tokens.red600 ?? '#dc2626' } }}
              >
                <DeleteSweepOutlined />
              </IconButton>
            </Tooltip>
          )}
          <IconButton onClick={() => setAskAIOpen(false)} sx={{ color: 'text.secondary' }}>
            <CloseOutlined />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Scrollable document feed */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, md: 5 }, py: 3 }}>
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>

          {/* Empty state */}
          {messages.length === 0 && (
            <Box sx={{ textAlign: 'center', mt: 8 }}>
              <AutoAwesomeOutlined sx={{ fontSize: 56, color: alpha(AI_COLOR, 0.2), mb: 2 }} />
              <Typography variant="h5" fontWeight={700} color="text.primary" gutterBottom>
                Ask anything about your data
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                Results appear as printable documents with data grids and charts.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center', mt: 2 }}>
                {[
                  'How many rows are in each table?',
                  'Show all records',
                  'Show me the first 10 records',
                  'What tables are available?',
                  'Show records with issues',
                ].map((s) => (
                  <Chip
                    key={s} label={s} size="medium"
                    onClick={() => { setInput(s); inputRef.current?.focus() }}
                    sx={{
                      cursor: 'pointer', fontSize: '0.8rem', height: 32,
                      bgcolor: alpha(AI_COLOR, 0.07), color: AI_COLOR,
                      border: `1px solid ${alpha(AI_COLOR, 0.2)}`,
                      '&:hover': { bgcolor: alpha(AI_COLOR, 0.14) },
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <Box key={msg.id} sx={{ mb: 2.5 }}>
              {msg.role === 'user' ? (
                /* User question — compact label above the document */
                <Box sx={{ mb: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  <Box sx={{ px: 2, py: 0.75, borderRadius: 3, bgcolor: AI_COLOR, color: '#fff', maxWidth: '70%' }}>
                    <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{msg.text}</Typography>
                  </Box>
                </Box>
              ) : msg.result ? (
                <DocumentCard
                  result={msg.result}
                  connId={connId}
                  sessionId={sessionId}
                  onFollowUp={handleFollowUp}
                />
              ) : (
                <Paper
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2, mt: 1, maxWidth: '85%' }}
                >
                  <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6 }}>
                    {msg.text}
                  </Typography>
                </Paper>
              )}
            </Box>
          ))}

          {/* Typing indicator */}
          {chatMutation.isPending && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <AutoAwesomeOutlined sx={{ fontSize: 16, color: AI_COLOR }} />
              <TypingDots />
              <Typography variant="caption" color="text.secondary">Generating document…</Typography>
            </Box>
          )}

          <div ref={bottomRef} />
        </Box>
      </Box>

      {/* Input bar */}
      <Box
        sx={{
          px: { xs: 2, md: 5 }, py: 2,
          borderTop: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          '@media print': { display: 'none' },
        }}
      >
        <Box sx={{ maxWidth: 860, mx: 'auto', display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
          <TextField
            inputRef={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything — e.g. 'How many rows per table?' or 'Show policy 12345'…"
            multiline
            maxRows={5}
            fullWidth
            size="small"
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: '0.9rem',
                borderRadius: 2.5,
                '&.Mui-focused fieldset': { borderColor: AI_COLOR },
              },
            }}
          />
          <IconButton
            onClick={handleSend}
            disabled={chatMutation.isPending || !input.trim()}
            sx={{
              bgcolor: AI_COLOR, color: '#fff', borderRadius: 2.5, p: 1,
              flexShrink: 0, alignSelf: 'flex-end',
              '&:hover': { bgcolor: '#6d28d9' },
              '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
            }}
          >
            {chatMutation.isPending
              ? <CircularProgress size={20} color="inherit" />
              : <SendOutlined sx={{ fontSize: 20 }} />
            }
          </IconButton>
        </Box>
      </Box>
    </Dialog>
  )
}
