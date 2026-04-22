import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Box, Typography, TextField, IconButton, Tooltip,
  Chip, Collapse, CircularProgress, alpha,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  List, ListItem, ListItemIcon, ListItemText, AppBar, Toolbar,
} from '@mui/material'
import {
  AutoAwesomeOutlined, CloseOutlined, SendOutlined,
  ExpandMoreOutlined, ExpandLessOutlined,
  WarningAmberOutlined, ErrorOutlineOutlined, InfoOutlined,
  CheckCircleOutlineOutlined, PlayArrowOutlined,
  MonitorHeartOutlined, DeleteSweepOutlined,
} from '@mui/icons-material'
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { askAiApi } from '@/api'
import type {
  AskAIResult, AskAIKpi, AskAIAlert, AskAIAction,
  AskAIFollowUp, AskAITraceStep, AskAISection,
} from '@/types'
import { tokens } from '@/theme/theme'

const AI_COLOR = tokens.violet600 ?? '#7c3aed'

// ── Typing indicator ────────────────────────────────────────────────────────

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
  const pct  = Math.round(confidence * 100)
  const color = confidence >= 0.85 ? 'success' : confidence >= 0.60 ? 'warning' : 'error'
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
    warning:  tokens.amber600  ?? '#d97706',
    critical: tokens.red600    ?? '#dc2626',
    neutral:  '#94a3b8',
  }
  const color = statusColor[kpi.status ?? 'neutral']

  const displayValue = () => {
    if (kpi.value === null || kpi.value === undefined) return '—'
    if (kpi.type === 'currency') return `$${Number(kpi.value).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
    if (kpi.type === 'percentage') return `${kpi.value}%`
    if (kpi.type === 'score') return String(kpi.value)
    return String(kpi.value)
  }

  const isScore = kpi.type === 'score'

  return (
    <Box
      sx={{
        px: 1.5, py: 1, borderRadius: 2, minWidth: 100, flexShrink: 0,
        border: '1px solid', borderColor: alpha(color, 0.25),
        bgcolor: alpha(color, isDark ? 0.1 : 0.05),
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {kpi.label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
        {isScore && (
          <MonitorHeartOutlined sx={{ fontSize: 14, color }} />
        )}
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
    error:   <ErrorOutlineOutlined sx={{ fontSize: 14, color: tokens.red600 ?? '#dc2626' }} />,
    warning: <WarningAmberOutlined sx={{ fontSize: 14, color: tokens.amber600 ?? '#d97706' }} />,
    info:    <InfoOutlined         sx={{ fontSize: 14, color: tokens.sky600  ?? '#0284c7' }} />,
  }
  const colors = {
    error:   tokens.red600   ?? '#dc2626',
    warning: tokens.amber600 ?? '#d97706',
    info:    tokens.sky600   ?? '#0284c7',
  }
  const color = colors[alert.level]
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, py: 0.25 }}>
      {icons[alert.level]}
      <Typography variant="caption" sx={{ color, lineHeight: 1.4 }}>{alert.message}</Typography>
    </Box>
  )
}

// ── Data source bar ───────────────────────────────────────────────────────────

function DataSourceBar({ summary }: { summary: string }) {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75,
        px: 1.25, py: 0.5, mt: 1,
        borderTop: '1px dashed', borderColor: 'divider',
        borderRadius: '0 0 8px 8px',
      }}
    >
      <InfoOutlined sx={{ fontSize: 12, color: 'text.disabled', flexShrink: 0 }} />
      <Typography variant="caption" color="text.disabled" sx={{ flex: 1, lineHeight: 1.35 }}>
        {summary}
      </Typography>
    </Box>
  )
}

// ── Trace accordion ───────────────────────────────────────────────────────────

function TraceAccordion({ steps }: { steps: AskAITraceStep[] }) {
  const [open, setOpen] = useState(false)
  if (!steps?.length) return null

  const totalMs = steps.reduce((s, t) => s + (t.duration_ms ?? 0), 0)

  return (
    <Box sx={{ mt: 0.5 }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          cursor: 'pointer', color: 'text.disabled',
          '&:hover': { color: AI_COLOR },
          transition: 'color .15s ease',
        }}
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
                {step.confidence !== undefined && (
                  <ConfidenceBadge confidence={step.confidence} />
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ pl: 2.5, display: 'block', lineHeight: 1.4 }}>
                {step.summary}
              </Typography>
              {step.guardrail_triggered && (
                <Typography variant="caption" sx={{ pl: 2.5, display: 'block', color: tokens.amber600, fontWeight: 600 }}>
                  Guardrail triggered — awaiting clarification
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Entity form view ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  currency:   tokens.emerald600 ?? '#059669',
  date:       tokens.sky600     ?? '#0284c7',
  status:     tokens.violet600  ?? '#7c3aed',
  count:      tokens.amber600   ?? '#d97706',
  percentage: tokens.indigo600  ?? '#4f46e5',
  duration:   tokens.sky600     ?? '#0284c7',
  score:      tokens.emerald600 ?? '#059669',
}

function EntityFormView({ sections }: { sections: AskAISection[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const isDark = useAppStore((s) => s.themeMode) === 'dark'

  if (!sections?.length) return null

  const toggle = (tbl: string) =>
    setExpanded((prev) => ({ ...prev, [tbl]: !prev[tbl] }))

  return (
    <Box sx={{ mt: 1.5, mb: 1 }}>
      {sections.map((sec) => {
        const isOpen = expanded[sec.table] !== false  // open by default
        return (
          <Box
            key={sec.table}
            sx={{
              mb: 1, borderRadius: 2, overflow: 'hidden',
              border: '1px solid', borderColor: 'divider',
            }}
          >
            {/* Section header */}
            <Box
              onClick={() => toggle(sec.table)}
              sx={{
                px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1,
                cursor: 'pointer', userSelect: 'none',
                bgcolor: isDark ? alpha(AI_COLOR, 0.08) : alpha(AI_COLOR, 0.04),
                borderBottom: isOpen ? '1px solid' : 'none',
                borderColor: 'divider',
                '&:hover': { bgcolor: alpha(AI_COLOR, isDark ? 0.14 : 0.07) },
                transition: 'background .15s ease',
              }}
            >
              <Typography variant="caption" fontWeight={700} sx={{ flex: 1, color: AI_COLOR, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.7rem' }}>
                {sec.title}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ mr: 0.5 }}>
                {sec.fields.length} field{sec.fields.length !== 1 ? 's' : ''}
              </Typography>
              {isOpen
                ? <ExpandLessOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
                : <ExpandMoreOutlined  sx={{ fontSize: 16, color: 'text.disabled' }} />
              }
            </Box>

            {/* Fields grid */}
            <Collapse in={isOpen}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 0,
                }}
              >
                {sec.fields.map((field, fi) => {
                  const typeColor = TYPE_COLORS[field.type] ?? 'text.secondary'
                  return (
                    <Box
                      key={field.column}
                      sx={{
                        px: 2, py: 1,
                        borderRight: '1px solid', borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderRight: 'none' },
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ display: 'block', color: 'text.disabled', fontSize: '0.65rem', fontWeight: 600, mb: 0.25, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                      >
                        {field.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, color: field.type === 'status' ? typeColor : 'text.primary', wordBreak: 'break-word' }}
                      >
                        {field.value}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </Collapse>
          </Box>
        )
      })}
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
      <DialogTitle sx={{ fontSize: '0.9rem', fontWeight: 700 }}>
        Confirm Action
      </DialogTitle>
      <DialogContent dividers sx={{ pt: 1.5, pb: 1 }}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          This will execute: <strong>{action.label}</strong>
          {action.entity && ` for ${action.entity} ${action.entity_id ?? ''}`}
        </Typography>

        <Box
          component="button"
          onClick={() => setShowPreview((v) => !v)}
          sx={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5,
            mt: 1, color: AI_COLOR, fontSize: '0.75rem', fontWeight: 600,
          }}
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

// ── AI response bubble ────────────────────────────────────────────────────────

interface ResponseBubbleProps {
  result:      AskAIResult
  connId:      number
  sessionId:   string | null
  onFollowUp:  (q: string) => void
}

function ResponseBubble({ result, connId, sessionId, onFollowUp }: ResponseBubbleProps) {
  const [confirmAction, setConfirmAction] = useState<AskAIAction | null>(null)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const isDark = useAppStore((s) => s.themeMode) === 'dark'

  // If clarification needed
  if (result.clarification_prompt) {
    return (
      <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: alpha(tokens.amber600 ?? '#d97706', isDark ? 0.12 : 0.06), border: '1px solid', borderColor: alpha(tokens.amber600 ?? '#d97706', 0.25) }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 14, color: AI_COLOR }} />
          <Typography variant="caption" fontWeight={700} color="text.primary">Ask AI</Typography>
          <WarningAmberOutlined sx={{ fontSize: 14, color: tokens.amber600 }} />
          <Typography variant="caption" color={tokens.amber600} fontWeight={600}>Needs clarification</Typography>
        </Box>
        <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6 }}>
          {result.clarification_prompt}
        </Typography>
      </Box>
    )
  }

  const healthKpi = result.kpis?.find((k) => k.type === 'score')
  const otherKpis = result.kpis?.filter((k) => k.type !== 'score') ?? []
  const displayKpis = [...otherKpis, ...(healthKpi ? [healthKpi] : [])].filter((k) => k.value !== null)

  return (
    <>
      <Box
        sx={{
          mt: 1.5, borderRadius: 2, overflow: 'hidden',
          border: '1px solid', borderColor: 'divider',
          bgcolor: isDark ? alpha(AI_COLOR, 0.04) : alpha(AI_COLOR, 0.02),
        }}
      >
        {/* Header */}
        <Box sx={{ px: 1.5, pt: 1.25, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 15, color: AI_COLOR }} />
          <Typography variant="caption" fontWeight={700} color="text.primary">Ask AI</Typography>
          {result.intent?.entity && (
            <Typography variant="caption" color="text.secondary">
              · {result.intent.entity}{result.intent.entity_id ? ` #${result.intent.entity_id}` : ''}
            </Typography>
          )}
          {result.intent?.confidence !== undefined && (
            <ConfidenceBadge confidence={result.intent.confidence} />
          )}
        </Box>

        <Box sx={{ px: 1.5, pb: 1.25 }}>
          {/* KPI tiles */}
          {displayKpis.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
              {displayKpis.map((kpi, i) => <KpiTile key={i} kpi={kpi} />)}
            </Box>
          )}

          {/* Full entity form sections */}
          {result.sections?.length > 0 && (
            <EntityFormView sections={result.sections} />
          )}

          {/* Narrative */}
          {result.narrative && (
            <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.7, mb: 1 }}>
              {result.narrative}
            </Typography>
          )}

          {/* Alerts */}
          {result.alerts?.length > 0 && (
            <Box sx={{ mb: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {result.alerts.map((a, i) => <AlertBanner key={i} alert={a} />)}
            </Box>
          )}

          {/* PII notice */}
          {result.pii_masked?.length > 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.75, fontStyle: 'italic' }}>
              Some sensitive fields were masked: {result.pii_masked.join(', ')}
            </Typography>
          )}

          {/* Actions */}
          {result.actions?.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: actionFeedback ? 0.75 : 0 }}>
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
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
              {actionFeedback}
            </Typography>
          )}
        </Box>

        {/* Trace + data source bar */}
        {result.trace_steps?.length > 0 && (
          <Box sx={{ px: 1.5, pb: 1 }}>
            <TraceAccordion steps={result.trace_steps} />
          </Box>
        )}

        {result.data_sources?.summary && (
          <DataSourceBar summary={result.data_sources.summary} />
        )}
      </Box>

      {/* Follow-up suggestions */}
      {result.follow_ups?.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
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

      {/* Action confirmation dialog */}
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
  id:     string
  role:   'user' | 'assistant'
  text?:  string
  result?: AskAIResult
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AskAIPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const bottomRef               = useRef<HTMLDivElement>(null)
  const inputRef                = useRef<HTMLInputElement>(null)
  const isDark = useAppStore((s) => s.themeMode) === 'dark'

  const askAIOpen    = useAppStore((s) => s.askAIOpen)
  const setAskAIOpen = useAppStore((s) => s.setAskAIOpen)

  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId = activeConnection?.id ?? 0

  const chatMutation = useMutation({
    mutationFn: (msg: string) =>
      askAiApi.chat({ message: msg, conn_id: connId, session_id: sessionId }),
    onSuccess: (result) => {
      if (result.session_id && !sessionId) setSessionId(result.session_id)
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', result },
      ])
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? err.message ?? 'Something went wrong'
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: `Error: ${msg}` },
      ])
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatMutation.isPending])

  const handleSend = useCallback(() => {
    const msg = input.trim()
    if (!msg || chatMutation.isPending) return
    if (!connId) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: 'Please select a connection first.' },
      ])
      return
    }
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text: msg },
    ])
    setInput('')
    chatMutation.mutate(msg)
  }, [input, chatMutation, connId])

  const handleFollowUp = useCallback((q: string) => {
    setInput(q)
    setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Dialog
      open={askAIOpen}
      onClose={() => setAskAIOpen(false)}
      fullScreen
      sx={{ zIndex: 1300 }}
      PaperProps={{
        sx: {
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
        },
      }}
    >
      {/* Full-screen header bar */}
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: isDark ? alpha(AI_COLOR, 0.18) : alpha(AI_COLOR, 0.08),
          borderBottom: '1px solid',
          borderColor: alpha(AI_COLOR, 0.2),
          color: 'text.primary',
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

      {/* Two-column layout: chat left, sidebar right */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Chat column */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Messages */}
          <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, md: 4 }, py: 3, maxWidth: 900, width: '100%', mx: 'auto' }}>
            {messages.length === 0 && (
              <Box sx={{ textAlign: 'center', mt: 8 }}>
                <AutoAwesomeOutlined sx={{ fontSize: 56, color: alpha(AI_COLOR, 0.25), mb: 2 }} />
                <Typography variant="h5" fontWeight={700} color="text.primary" gutterBottom>
                  Ask anything about your data
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                  Query across all your connected tables with natural language.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center', mt: 2 }}>
                  {[
                    'Explain policy 12345',
                    'Show open claims',
                    'Total billing this month',
                    'Which employees are overdue for review?',
                    'Compare claim 5678 with claim 5679',
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

            {messages.map((msg) => (
              <Box key={msg.id} sx={{ mb: 2 }}>
                {msg.role === 'user' ? (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Box
                      sx={{
                        maxWidth: '70%', px: 2, py: 1, borderRadius: 3,
                        bgcolor: AI_COLOR, color: '#fff',
                      }}
                    >
                      <Typography variant="body1" sx={{ lineHeight: 1.6 }}>{msg.text}</Typography>
                    </Box>
                  </Box>
                ) : msg.result ? (
                  <ResponseBubble
                    result={msg.result}
                    connId={connId}
                    sessionId={sessionId}
                    onFollowUp={handleFollowUp}
                  />
                ) : (
                  <Box sx={{ maxWidth: '85%', px: 2, py: 1, borderRadius: 3, bgcolor: 'action.hover' }}>
                    <Typography variant="body1" color="text.primary" sx={{ lineHeight: 1.6 }}>
                      {msg.text}
                    </Typography>
                  </Box>
                )}
              </Box>
            ))}

            {chatMutation.isPending && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <AutoAwesomeOutlined sx={{ fontSize: 16, color: AI_COLOR }} />
                <TypingDots />
              </Box>
            )}

            <div ref={bottomRef} />
          </Box>

          {/* Input bar */}
          <Box
            sx={{
              px: { xs: 2, md: 4 }, py: 2,
              borderTop: '1px solid', borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Box sx={{ maxWidth: 900, mx: 'auto', display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
              <TextField
                inputRef={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your data — queries span all connected tables..."
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
        </Box>
      </Box>
    </Dialog>
  )
}
