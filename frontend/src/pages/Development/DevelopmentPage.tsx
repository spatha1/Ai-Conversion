/**
 * Development Intelligence Page
 */
import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Box, Typography, Button, TextField, MenuItem, Select, FormControl, InputLabel,
  Paper, Chip, CircularProgress, Alert, Divider, Stack, IconButton, Collapse,
  Checkbox, FormControlLabel, alpha, Tooltip, Table, TableHead, TableRow,
  TableCell, TableBody, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails,
  Card, CardContent, LinearProgress, ToggleButtonGroup, ToggleButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import {
  PlayArrowOutlined, CheckCircleOutlineOutlined, ErrorOutlineOutlined,
  ExpandMoreOutlined, ExpandLessOutlined, AutoAwesomeOutlined,
  DeleteOutlined, HistoryOutlined, BugReportOutlined, AssignmentOutlined,
  CodeOutlined, VerifiedOutlined, TextFieldsOutlined, LinkOutlined,
  CloudDownloadOutlined, WarningAmberOutlined, AllInclusiveOutlined,
  FactCheckOutlined, CloudUploadOutlined, IosShareOutlined,
  FileDownloadOutlined, VisibilityOutlined, ContentCopyOutlined,
  ThumbUpOutlined, ThumbDownOutlined, HowToVoteOutlined,
  BuildOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { developmentApi, integrationsApi } from '@/api'
import type { IntegrationConfig } from '@/api'
import AIDebugPanel from '@/components/ai/AIDebugPanel'
import DebugStepsPanel from '@/components/ai/DebugStepsPanel'
import { tokens } from '@/theme/theme'
import type { PlanStep, DevArtifactItem, DevArtifact, SQLValidationResult, BRDCriterion, DebugPayload } from '@/types'

const MODELS = ['gpt-4o-mini', 'gpt-4o']

const SQL_TYPE_COLORS: Record<string, string> = {
  SELECT:           tokens.sky600,
  INSERT:           tokens.emerald600,
  UPDATE:           tokens.amber600,
  DELETE:           tokens.red600,
  CREATE_TABLE:     tokens.violet600,
  STORED_PROCEDURE: tokens.indigo600,
  DDL:              tokens.indigo600,
  SCRIPT:           '#64748B',
}

const PRIORITY_COLORS: Record<string, string> = {
  high:   tokens.red600,
  medium: tokens.amber600,
  low:    tokens.emerald600,
}

const BUG_WIZARD_STEPS = ['Describe', 'SQL Input', 'Context', 'Fix Plan'] as const

function analyzeSqlForBugs(sql: string): { issues: string[]; types: string[] } {
  const u = sql.toUpperCase().trim()
  if (!u) return { issues: [], types: [] }
  const issues: string[] = []
  const types = new Set<string>()
  if ((u.includes('UPDATE') || u.includes('DELETE')) && !u.includes('WHERE')) {
    issues.push('No WHERE clause on UPDATE/DELETE — will affect all rows'); types.add('Missing Filter')
  }
  if (u.includes('SUM(') && !u.includes('WHERE')) {
    issues.push('SUM() without WHERE filter — may aggregate unintended rows'); types.add('Aggregation Error')
  }
  if (u.includes('JOIN') && u.includes('SUM(') && !u.includes('DISTINCT')) {
    issues.push('JOIN + SUM without DISTINCT — possible row multiplication'); types.add('Double Count')
  }
  if (u.includes('GROUP BY') && u.includes('SUM(') && !u.includes('HAVING') && !u.includes('WHERE')) {
    issues.push('GROUP BY + SUM with no filter or HAVING — aggregating all rows'); types.add('Unfiltered Aggregate')
  }
  if (u.includes('SELECT *')) {
    issues.push('SELECT * — may pull in unexpected columns or data'); types.add('Wide Select')
  }
  if (u.includes('SELECT') && u.includes('FROM') && !u.includes('WHERE') && !u.includes('JOIN') && !u.includes('GROUP')) {
    issues.push('No WHERE clause — full table scan on every row'); types.add('Missing Filter')
  }
  return { issues: issues.slice(0, 4), types: [...types] }
}

function getBugHint(issueText: string): string {
  const t = issueText.toLowerCase()
  if (!t.trim()) return ''
  if (t.match(/balance|amount|sum|total|off by/)) return 'Sounds like an aggregation or calculation error. Check GROUP BY, SUM(), and reversal/adjustment handling.'
  if (t.match(/duplicate|double|twice|repeat/)) return 'Likely a JOIN duplication issue or missing DISTINCT. Check JOIN cardinality for 1:many relationships.'
  if (t.match(/missing|not show|empty|null|zero result/)) return 'Could be a LEFT JOIN vs INNER JOIN mismatch, or a NULL/empty filter in WHERE clause.'
  if (t.match(/slow|timeout|perform|long/)) return 'Performance issue. Check for missing indexes, SELECT *, or unfiltered full-table scans in the query.'
  if (t.match(/wrong|incorrect|invalid|unexpected/)) return 'Data accuracy issue. Check date range boundaries, rounding in calculations, or incorrect JOIN conditions.'
  return 'Describe the expected vs actual behavior to help the AI generate a more targeted fix plan.'
}

type ApprovalStatus = 'pending' | 'approved' | 'rejected'

// ── History Row ───────────────────────────────────────────────────────────────

function HistoryRow({
  h, active, meta, onLoad, onRerun, onDelete,
}: {
  h: DevArtifact
  active: boolean
  meta?: { name: string; jira_key: string }
  onLoad: () => void
  onRerun: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const steps: PlanStep[] = h.plan_json ? (() => { try { return JSON.parse(h.plan_json) } catch { return [] } })() : []
  const statusColor = h.status === 'complete' ? tokens.emerald600 : h.status === 'error' ? tokens.red600 : tokens.amber600
  const displayName = meta?.name || h.task_description.slice(0, 80)

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
      {/* Row header */}
      <Box sx={{
        px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1,
        '&:hover': { bgcolor: 'action.hover' },
        ...(active ? { bgcolor: alpha(tokens.indigo600, 0.05), borderLeft: `3px solid ${tokens.indigo600}` } : {}),
      }}>
        {/* Main info area (non-clickable — use explicit buttons) */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={active ? 700 : 500} noWrap>
            {displayName}{displayName.length >= 80 && !meta?.name ? '…' : ''}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center" mt={0.25} flexWrap="wrap">
            <Chip label={h.status} size="small"
              sx={{ height: 16, fontSize: '0.563rem', fontWeight: 700,
                bgcolor: alpha(statusColor, 0.12), color: statusColor, border: 'none' }} />
            {steps.length > 0 && (
              <Chip label={`${steps.length} steps`} size="small" variant="outlined"
                sx={{ height: 16, fontSize: '0.563rem' }} />
            )}
            {meta?.jira_key && (
              <Chip label={meta.jira_key} size="small" variant="outlined"
                sx={{ height: 16, fontSize: '0.563rem', borderColor: tokens.indigo600, color: tokens.indigo600 }} />
            )}
            {h.created_at && (
              <Typography variant="caption" color="text.disabled">
                {new Date(h.created_at).toLocaleDateString()}
              </Typography>
            )}
          </Stack>
        </Box>

        {/* Action buttons */}
        <Tooltip title="Load this plan into the SQL Plan tab">
          <Button size="small" variant="outlined"
            onClick={onLoad}
            sx={{ fontSize: '0.688rem', py: 0.25, px: 1, minWidth: 0, whiteSpace: 'nowrap',
              ...(active ? { borderColor: tokens.indigo600, color: tokens.indigo600 } : {}) }}>
            {active ? 'Active' : 'View'}
          </Button>
        </Tooltip>
        <Tooltip title="Re-run this plan with the same requirements">
          <Button size="small" variant="text" color="secondary"
            onClick={onRerun}
            sx={{ fontSize: '0.688rem', py: 0.25, px: 1, minWidth: 0, whiteSpace: 'nowrap' }}>
            Rerun
          </Button>
        </Tooltip>
        <Tooltip title={expanded ? 'Collapse steps' : 'Expand steps'}>
          <IconButton size="small" onClick={() => setExpanded(p => !p)} sx={{ p: 0.5 }}>
            {expanded
              ? <ExpandLessOutlined sx={{ fontSize: 16 }} />
              : <ExpandMoreOutlined sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" color="error" onClick={onDelete} sx={{ p: 0.5 }}>
            <DeleteOutlined sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
      {/* Collapsed step list */}
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {steps.length === 0 && (
            <Typography variant="caption" color="text.disabled">No plan steps recorded.</Typography>
          )}
          {steps.map(s => (
            <Chip
              key={s.step_number}
              label={`${s.step_number}. ${s.title}`}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.688rem' }}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Step Card ─────────────────────────────────────────────────────────────────

function StepCard({
  step, artifact, connId, model, onSqlChange, approvalStatus, onApprovalChange,
}: {
  step: PlanStep
  artifact: DevArtifact | null
  connId: number
  model: string
  onSqlChange: (stepNum: number, sql: string) => void
  approvalStatus: ApprovalStatus
  onApprovalChange: (status: ApprovalStatus) => void
}) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const items: DevArtifactItem[] = artifact?.artifacts_json ? JSON.parse(artifact.artifacts_json) : []
  const item = items.find((i) => i.step_number === step.step_number)

  const [sql, setSql]             = useState(item?.sql ?? '')
  const [showExplain, setExplain] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [validation, setValidation]   = useState<SQLValidationResult | null>(item?.validation ?? null)
  const [skipVal, setSkipVal]         = useState(false)

  const prevSqlRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const incoming = item?.sql
    if (incoming && incoming !== prevSqlRef.current) {
      setSql(incoming)
      prevSqlRef.current = incoming
    }
  }, [item?.sql])
  const color = SQL_TYPE_COLORS[step.sql_type] ?? tokens.indigo600

  const genMut = useMutation({
    mutationFn: () => developmentApi.generate(artifact!.id, step.step_number, model),
    onSuccess: (res) => {
      setSql(res.sql)
      onSqlChange(step.step_number, res.sql)
      qc.invalidateQueries({ queryKey: ['dev-artifact', artifact?.id] })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Generate failed', { variant: 'error' }),
  })

  const validateMut = useMutation({
    mutationFn: () => developmentApi.validate(connId, sql),
    onSuccess: (res) => {
      setValidation(res)
      enqueueSnackbar(res.passed ? 'Validation passed' : `${res.errors.length} error(s)`, {
        variant: res.passed ? 'success' : 'warning',
      })
    },
    onError: () => enqueueSnackbar('Validation failed', { variant: 'error' }),
  })

  const explainMut = useMutation({
    mutationFn: () => developmentApi.explain(connId, sql, model),
    onSuccess: (res) => { setExplanation(res.explanation); setExplain(true) },
    onError: () => enqueueSnackbar('Explain failed', { variant: 'error' }),
  })

  const fixMut = useMutation({
    mutationFn: () =>
      developmentApi.suggestFix(connId, validation?.errors.join('; ') ?? '', sql, model),
    onSuccess: (res) => {
      setSql(res.sql)
      onSqlChange(step.step_number, res.sql)
      setValidation(null)
    },
    onError: () => enqueueSnackbar('Suggest fix failed', { variant: 'error' }),
  })

  const executeMut = useMutation({
    mutationFn: () => developmentApi.execute(connId, sql, 500, skipVal),
    onSuccess: () => {
      enqueueSnackbar(`Step ${step.step_number} executed`, { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['dev-artifact', artifact?.id] })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Execute failed', { variant: 'error' }),
  })

  const approvalBorderColor = approvalStatus === 'approved'
    ? tokens.emerald600
    : approvalStatus === 'rejected'
    ? tokens.red600
    : undefined

  return (
    <Paper variant="outlined" sx={{
      borderRadius: 2, overflow: 'hidden', mb: 1.5,
      ...(approvalBorderColor ? { borderColor: approvalBorderColor, borderWidth: 2 } : {}),
    }}>
      <Box sx={{
        px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1,
        bgcolor: alpha(color, 0.06), borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Chip label={`Step ${step.step_number}`} size="small"
          sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700, bgcolor: alpha(color, 0.15), color }} />
        <Chip label={step.sql_type} size="small" variant="outlined"
          sx={{ height: 20, fontSize: '0.625rem', borderColor: color, color }} />
        <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{step.title}</Typography>
        {item?.status === 'executed' && <CheckCircleOutlineOutlined sx={{ fontSize: 16, color: 'success.main' }} />}
        {item?.status === 'error' && <ErrorOutlineOutlined sx={{ fontSize: 16, color: 'error.main' }} />}
        <Tooltip title="Approve this step">
          <IconButton size="small"
            onClick={() => onApprovalChange(approvalStatus === 'approved' ? 'pending' : 'approved')}
            sx={{ color: approvalStatus === 'approved' ? tokens.emerald600 : 'text.disabled', p: 0.5 }}>
            <ThumbUpOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reject this step">
          <IconButton size="small"
            onClick={() => onApprovalChange(approvalStatus === 'rejected' ? 'pending' : 'rejected')}
            sx={{ color: approvalStatus === 'rejected' ? tokens.red600 : 'text.disabled', p: 0.5 }}>
            <ThumbDownOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        {approvalStatus !== 'pending' && (
          <Chip
            label={approvalStatus === 'approved' ? 'Approved' : 'Rejected'}
            size="small"
            sx={{
              height: 18, fontSize: '0.563rem', fontWeight: 700,
              bgcolor: alpha(approvalStatus === 'approved' ? tokens.emerald600 : tokens.red600, 0.12),
              color: approvalStatus === 'approved' ? tokens.emerald600 : tokens.red600,
            }}
          />
        )}
      </Box>

      <Box sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {step.description}
        </Typography>
        {step.depends_on?.length > 0 && (
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 1 }}>
            Depends on: steps {step.depends_on.join(', ')}
          </Typography>
        )}
        <TextField
          multiline minRows={3} fullWidth size="small"
          placeholder="Click Generate to create SQL…"
          value={sql}
          onChange={(e) => { setSql(e.target.value); onSqlChange(step.step_number, e.target.value); setValidation(null) }}
          sx={{ mb: 1, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
        />
        {validation && (
          <Box sx={{ mb: 1 }}>
            {validation.passed ? (
              <Alert severity="success" sx={{ py: 0.25 }}>Validation passed</Alert>
            ) : (
              <Alert severity="error" sx={{ py: 0.25 }}>
                {validation.errors.map((e, i) => <div key={i}>{e}</div>)}
              </Alert>
            )}
            {validation.warnings?.length > 0 && (
              <Alert severity="warning" sx={{ py: 0.25, mt: 0.5 }}>
                {validation.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}
          </Box>
        )}
        <Collapse in={showExplain && !!explanation}>
          <Alert severity="info" sx={{ mb: 1, fontSize: '0.75rem' }}>{explanation}</Alert>
        </Collapse>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" gap={0.5}>
          <Button size="small" variant="outlined"
            startIcon={genMut.isPending ? <CircularProgress size={10} /> : <AutoAwesomeOutlined />}
            onClick={() => genMut.mutate()}
            disabled={genMut.isPending || !artifact}
            sx={{ fontSize: '0.75rem' }}>
            Generate
          </Button>
          <Button size="small" variant="outlined"
            startIcon={validateMut.isPending ? <CircularProgress size={10} /> : <VerifiedOutlined />}
            onClick={() => validateMut.mutate()}
            disabled={validateMut.isPending || !sql}
            sx={{ fontSize: '0.75rem' }}>
            Validate
          </Button>
          <Button size="small" variant="text"
            startIcon={explainMut.isPending ? <CircularProgress size={10} /> : <CodeOutlined />}
            onClick={() => showExplain ? setExplain(false) : explainMut.mutate()}
            disabled={explainMut.isPending || !sql}
            sx={{ fontSize: '0.75rem' }}>
            {showExplain ? 'Hide' : 'Explain'}
          </Button>
          {validation && !validation.passed && (
            <Button size="small" color="warning" variant="text"
              startIcon={fixMut.isPending ? <CircularProgress size={10} /> : <AutoAwesomeOutlined />}
              onClick={() => fixMut.mutate()}
              disabled={fixMut.isPending}
              sx={{ fontSize: '0.75rem' }}>
              Suggest Fix
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <FormControlLabel
            control={<Checkbox size="small" checked={skipVal} onChange={(e) => setSkipVal(e.target.checked)} />}
            label={<Typography variant="caption">Skip validation</Typography>}
            sx={{ mr: 0 }}
          />
          <Button size="small" variant="contained" color="success"
            startIcon={executeMut.isPending ? <CircularProgress size={12} /> : <PlayArrowOutlined />}
            onClick={() => executeMut.mutate()}
            disabled={executeMut.isPending || (!skipVal && validation != null && !validation.passed)}
            sx={{ fontSize: '0.75rem' }}>
            Execute
          </Button>
        </Stack>
      </Box>
    </Paper>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DevelopmentPage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const location = useLocation()
  const activeConnection = useAppStore((s) => s.activeConnection)
  const activeProject    = useAppStore((s) => s.activeProject)
  const connId = activeConnection?.id

  const [sourceType, setSourceType] = useState<'text' | 'jira' | 'ado'>('text')
  const [reqText, setReqText] = useState(
    (location.state as { prefillPrompt?: string } | null)?.prefillPrompt ?? ''
  )
  const [jiraKey, setJiraKey]   = useState('')
  const [adoWiId, setAdoWiId]   = useState('')

  const { data: integrations = [] } = useQuery<IntegrationConfig[]>({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
    staleTime: 60_000,
  })
  const jiraConfigured = integrations.some((i) => i.type === 'jira' && i.has_token)
  const adoConfigured  = integrations.some((i) => i.type === 'ado' && i.has_token)

  const [model, setModel]         = useState('gpt-4o-mini')
  const [criteria, setCriteria]   = useState<BRDCriterion[]>([])
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([])
  const [artifactId, setArtifactId] = useState<number | null>(null)
  const [sqlMap, setSqlMap]     = useState<Map<number, string>>(new Map())
  const [approvalMap, setApprovalMap] = useState<Map<number, ApprovalStatus>>(new Map())
  const [confirmPipelineOpen, setConfirmPipelineOpen] = useState(false)

  const [historyOpen, setHistoryOpen]   = useState(false)
  const [debugPayload, setDebugPayload] = useState<DebugPayload | null>(null)
  const [reqPanelOpen, setReqPanelOpen] = useState(true)   // collapsible requirements panel
  const [mainPanelOpen, setMainPanelOpen] = useState(true) // collapsible main content panel

  // Main tab: 0=AC, 1=SQL Plan, 2=Bug Fix, 3=Exec Log, 4=AI Traces
  const [mainTab, setMainTab] = useState(0)

  // Bug Fix: link to existing dev plan (auto-default to active artifact)
  const [bugLinkedArtifactId, setBugLinkedArtifactId] = useState<number | null>(null)
  // When switching to Bug Fix tab, default the linked plan to the current active artifact
  useEffect(() => {
    if (mainTab === 2 && artifactId && bugLinkedArtifactId === null) {
      setBugLinkedArtifactId(artifactId)
    }
  }, [mainTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const [viewAllOpen, setViewAllOpen]   = useState(false)
  const [acSqlMap, setAcSqlMap]         = useState<Record<number, string>>({})
  const [acResults, setAcResults]       = useState<Record<number, { rows: unknown[]; columns: string[] }>>({})

  // ── Bug Fix Wizard state ──────────────────────────────────────────────────
  const [bugWizardStep, setBugWizardStep] = useState(0)
  // Step 1 – structured description
  const [bugSourceType, setBugSourceType] = useState<'text' | 'jira' | 'ado'>('text')
  const [bugJiraKey,    setBugJiraKey]    = useState('')
  const [bugAdoWiId,    setBugAdoWiId]    = useState('')
  const [bugIssue,      setBugIssue]      = useState('')
  const [bugExpected,   setBugExpected]   = useState('')
  const [bugActual,     setBugActual]     = useState('')
  const [bugImpact,     setBugImpact]     = useState<'high' | 'medium' | 'low'>('medium')
  const [bugAiHint,     setBugAiHint]     = useState('')
  // Step 2 – SQL analysis
  const [bugSqlAnalysis, setBugSqlAnalysis] = useState<{ issues: string[]; types: string[] }>({ issues: [], types: [] })
  // Imported/manual fallback description
  const [bugDescription, setBugDescription] = useState('')
  const [bugBeforeSql,  setBugBeforeSql]  = useState('')   // current/broken SQL snapshot
  const [bugFixSteps,   setBugFixSteps]   = useState<PlanStep[]>([])
  const [bugArtifactId, setBugArtifactId] = useState<number | null>(null)
  const [bugSqlMap,     setBugSqlMap]     = useState<Map<number, string>>(new Map())
  const [bugApprovalMap, setBugApprovalMap] = useState<Map<number, ApprovalStatus>>(new Map())
  const [bugVersionOpen, setBugVersionOpen] = useState(false)

  interface BugVersion {
    version: number
    bug_key: string
    bug_description: string
    before_sql: string
    fix_step_titles: string[]
    timestamp: string
  }
  const [bugVersions, setBugVersions] = useState<BugVersion[]>([])

  // ── Plan naming (localStorage) ────────────────────────────────────────────
  const PLAN_NAMES_KEY = 'dev_plan_meta'
  const [planMeta, setPlanMeta] = useState<Record<number, { name: string; jira_key: string }>>(() => {
    try { return JSON.parse(localStorage.getItem(PLAN_NAMES_KEY) || '{}') } catch { return {} }
  })
  const [savePlanOpen, setSavePlanOpen]     = useState(false)
  const [savePlanName, setSavePlanName]     = useState('')
  const [savePlanJira, setSavePlanJira]     = useState('')
  const [pendingSaveId, setPendingSaveId]   = useState<number | null>(null)

  function commitPlanMeta(id: number, name: string, jira_key: string) {
    const updated = { ...planMeta, [id]: { name: name.trim() || 'Untitled Plan', jira_key: jira_key.trim() } }
    setPlanMeta(updated)
    localStorage.setItem(PLAN_NAMES_KEY, JSON.stringify(updated))
    setSavePlanOpen(false)
  }

  const { data: artifact } = useQuery({
    queryKey: ['dev-artifact', artifactId],
    queryFn:  () => developmentApi.getArtifact(artifactId!),
    enabled:  artifactId != null,
    refetchInterval: (q) => q.state.data?.status === 'running' ? 2000 : false,
  })

  const { data: bugArtifact } = useQuery({
    queryKey: ['dev-artifact', bugArtifactId],
    queryFn:  () => developmentApi.getArtifact(bugArtifactId!),
    enabled:  bugArtifactId != null,
    refetchInterval: (q) => q.state.data?.status === 'running' ? 2000 : false,
  })

  const pendingArtifactId = useRef<number | null>(
    (location.state as { artifactId?: number } | null)?.artifactId ?? null
  )
  useEffect(() => {
    if (pendingArtifactId.current) {
      setArtifactId(pendingArtifactId.current)
      setHistoryOpen(true)
      window.history.replaceState({}, '')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (artifact && artifact.id === artifactId && artifact.plan_json) {
      try {
        const steps = JSON.parse(artifact.plan_json)
        if (steps.length > 0) {
          setPlanSteps(steps)
          if (artifact.task_description) setReqText(artifact.task_description)
          setMainTab(1)
        }
      } catch { /* ignore */ }
    }
  }, [artifact]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: history = [] } = useQuery({
    queryKey: ['dev-history', connId],
    queryFn:  () => developmentApi.history(connId!),
    enabled:  connId != null && (historyOpen || mainTab === 2),  // also load when Bug Fix tab is open
  })

  // ── Fetch from JIRA / ADO ─────────────────────────────────────────────────
  const fetchMut = useMutation({
    mutationFn: () => {
      if (sourceType === 'jira') {
        return developmentApi.fetchExternal({ source_type: 'jira', resource_id: jiraKey, project_id: activeProject?.id })
      } else {
        return developmentApi.fetchExternal({ source_type: 'ado', resource_id: adoWiId, project_id: activeProject?.id })
      }
    },
    onSuccess: (res) => {
      setReqText(res.text)
      enqueueSnackbar(`Fetched ${res.source_type.toUpperCase()} ${res.resource_id}`, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Fetch failed', { variant: 'error' }),
  })

  // ── Fetch bug from JIRA / ADO ─────────────────────────────────────────────
  const fetchBugMut = useMutation({
    mutationFn: () => {
      if (bugSourceType === 'jira') {
        return developmentApi.fetchExternal({ source_type: 'jira', resource_id: bugJiraKey, project_id: activeProject?.id })
      } else {
        return developmentApi.fetchExternal({ source_type: 'ado', resource_id: bugAdoWiId, project_id: activeProject?.id })
      }
    },
    onSuccess: (res) => {
      setBugDescription(res.text)
      enqueueSnackbar(`Bug imported: ${res.resource_id}`, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Bug fetch failed', { variant: 'error' }),
  })

  // ── Bug wizard debounced effects ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setBugAiHint(getBugHint(bugIssue)), 600)
    return () => clearTimeout(t)
  }, [bugIssue])
  useEffect(() => {
    const t = setTimeout(() => setBugSqlAnalysis(analyzeSqlForBugs(bugBeforeSql)), 800)
    return () => clearTimeout(t)
  }, [bugBeforeSql])

  // ── Analyze → AC ──────────────────────────────────────────────────────────
  const analyzeMut = useMutation({
    mutationFn: () => developmentApi.analyzeBrd(connId!, reqText, model),
    onSuccess: (res) => {
      setCriteria(res.criteria)
      setMainTab(0)
      enqueueSnackbar(res.summary, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Analysis failed', { variant: 'error' }),
  })

  const rerunTextRef = useRef<string | null>(null)

  // ── Plan → SQL steps ──────────────────────────────────────────────────────
  const planMut = useMutation({
    mutationFn: () => developmentApi.plan(connId!, rerunTextRef.current ?? reqText, model),
    onSuccess: (res) => {
      rerunTextRef.current = null
      setArtifactId(res.artifact_id)
      setPlanSteps(res.steps)
      setApprovalMap(new Map())
      setMainTab(1)
      setDebugPayload(res.debug ?? null)
      // Prompt user to name the plan
      setPendingSaveId(res.artifact_id)
      setSavePlanName('')
      setSavePlanJira(jiraKey || '')
      setSavePlanOpen(true)
      enqueueSnackbar(`Plan generated: ${res.steps.length} steps`, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Plan generation failed', { variant: 'error' }),
  })

  // ── Bug Fix plan ──────────────────────────────────────────────────────────
  const bugFixMut = useMutation({
    mutationFn: () => {
      const composedDesc = bugIssue
        ? [
            `Issue: ${bugIssue}`,
            bugExpected && `Expected: ${bugExpected}`,
            bugActual   && `Actual: ${bugActual}`,
            `Impact: ${bugImpact}`,
            bugBeforeSql && `Current SQL:\n${bugBeforeSql}`,
          ].filter(Boolean).join('\n')
        : bugDescription
      const linkedArt = bugLinkedArtifactId
        ? (history as DevArtifact[]).find(h => h.id === bugLinkedArtifactId)
        : null
      const linkedContext = linkedArt?.plan_json
        ? `\n\nExisting Development Plan Steps:\n${
            (JSON.parse(linkedArt.plan_json) as PlanStep[])
              .map(s => `  Step ${s.step_number} (${s.sql_type}): ${s.title} — ${s.description}`)
              .join('\n')
          }`
        : ''
      return developmentApi.plan(
        connId!,
        `[BUG FIX REQUEST]\n\nBug Description:\n${composedDesc}${linkedContext}\n\nAnalyze this bug and generate SQL fix steps to resolve it. Reference the existing plan steps above if relevant.`,
        model,
      )
    },
    onSuccess: (res) => {
      setBugArtifactId(res.artifact_id)
      setBugFixSteps(res.steps)
      setBugApprovalMap(new Map())
      setBugWizardStep(3)
      const bugKey = bugJiraKey || (bugAdoWiId ? `ADO-${bugAdoWiId}` : 'manual')
      setBugVersions(prev => [...prev, {
        version: prev.length + 1,
        bug_key: bugKey,
        bug_description: bugIssue || bugDescription,
        before_sql: bugBeforeSql,
        fix_step_titles: res.steps.map((s: PlanStep) => `${s.step_number}. ${s.title}`),
        timestamp: new Date().toISOString(),
      }])
      enqueueSnackbar(`Bug fix plan: ${res.steps.length} steps`, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Bug fix plan failed', { variant: 'error' }),
  })

  const analyzeAndPlan = async () => {
    if (!connId || !reqText.trim()) return
    analyzeMut.mutate()
    planMut.mutate()
  }

  const buildCombinedSql = (steps: PlanStep[], sMap: Map<number, string>, art: DevArtifact | null | undefined): string => {
    const items: DevArtifactItem[] = art?.artifacts_json ? JSON.parse(art.artifacts_json) : []
    return steps
      .map((step) => {
        const sql = sMap.get(step.step_number)
          ?? items.find((i) => i.step_number === step.step_number)?.sql
          ?? ''
        if (!sql.trim()) return null
        return [
          `-- ${'='.repeat(72)}`,
          `-- Step ${step.step_number}: ${step.title}`,
          `-- Type: ${step.sql_type}`,
          `-- ${'='.repeat(72)}`,
          sql.trim(),
          '',
        ].join('\n')
      })
      .filter(Boolean)
      .join('\n')
  }

  const handleDownloadAll = () => {
    const combined = buildCombinedSql(planSteps, sqlMap, artifact)
    if (!combined.trim()) {
      enqueueSnackbar('No generated SQL to download', { variant: 'warning' })
      return
    }
    const blob = new Blob([combined], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'development_plan.sql'; a.click()
    URL.revokeObjectURL(url)
  }

  const approvedStepNumbers = planSteps
    .map((s) => s.step_number)
    .filter((n) => (approvalMap.get(n) ?? 'pending') === 'approved')

  const pipelineMut = useMutation({
    mutationFn: () => developmentApi.runPipeline(
      artifactId!,
      approvedStepNumbers.length > 0 ? approvedStepNumbers : undefined,
    ),
    onSuccess: () => {
      setConfirmPipelineOpen(false)
      enqueueSnackbar('Pipeline completed', { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['dev-artifact', artifactId] })
    },
    onError: () => {
      setConfirmPipelineOpen(false)
      enqueueSnackbar('Pipeline failed', { variant: 'error' })
    },
  })

  const acRunMut = useMutation({
    mutationFn: ({ id, sql }: { id: number; sql: string }) =>
      developmentApi.execute(connId!, sql, 50, true),
    onSuccess: (res, { id }) =>
      setAcResults((prev) => ({ ...prev, [id]: res as { rows: unknown[]; columns: string[] } })),
    onError: (_e, { id }) =>
      enqueueSnackbar(`Validation query for AC-${id} failed`, { variant: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => developmentApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-history', connId] })
      enqueueSnackbar('Deleted', { variant: 'success' })
    },
  })

  const [genAllInstructions, setGenAllInstructions] = useState('')
  const [genAllOpen, setGenAllOpen] = useState(false)

  const genAllMut = useMutation({
    mutationFn: () => developmentApi.generateAll(artifactId!, model, genAllInstructions || undefined),
    onSuccess: (res) => {
      enqueueSnackbar(`Generated ${res.generated}/${planSteps.length} steps`, {
        variant: res.errors.length > 0 ? 'warning' : 'success',
      })
      qc.invalidateQueries({ queryKey: ['dev-artifact', artifactId] })
    },
    onError: () => enqueueSnackbar('Generate All failed', { variant: 'error' }),
  })

  const valAllMut = useMutation({
    mutationFn: () => developmentApi.validateAll(artifactId!),
    onSuccess: (res) => {
      setValAllResults(res.validations)
      enqueueSnackbar(res.all_passed ? 'All steps passed' : 'Some steps have errors', {
        variant: res.all_passed ? 'success' : 'warning',
      })
    },
    onError: () => enqueueSnackbar('Validate All failed', { variant: 'error' }),
  })

  const [valAllResults, setValAllResults] = useState<
    { step_number: number; passed: boolean; errors: string[]; warnings: string[] }[]
  >([])

  const [acExpandedIds, setAcExpandedIds] = useState<Set<number>>(new Set())
  const [exportAcOpen, setExportAcOpen] = useState(false)
  const [exportDest, setExportDest] = useState<'jira' | 'ado'>('jira')
  const [exportProjectKey, setExportProjectKey] = useState('')
  const [exportEpicKey, setExportEpicKey] = useState('')
  const [exportIssueType, setExportIssueType] = useState('Task')

  const exportAcMut = useMutation({
    mutationFn: () => developmentApi.exportAc({
      criteria, destination: exportDest,
      project_key: exportProjectKey || undefined,
      epic_key: exportEpicKey || undefined,
      story_type: exportIssueType,
    }),
    onSuccess: (res) => {
      enqueueSnackbar(
        res.errors.length > 0
          ? `Exported ${res.created} item(s) — ${res.errors.length} failed`
          : `Exported ${res.created} item(s) to ${exportDest.toUpperCase()}`,
        { variant: res.errors.length > 0 ? 'warning' : 'success' },
      )
      setExportAcOpen(false)
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Export failed', { variant: 'error' }),
  })

  const [gitOpen, setGitOpen] = useState(false)
  const [gitRepo, setGitRepo] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitPath, setGitPath] = useState('sql/')
  const [gitToken, setGitToken] = useState('')
  const [gitMessage, setGitMessage] = useState('')

  const gitCheckinMut = useMutation({
    mutationFn: () => developmentApi.gitCheckin({
      artifact_id: artifactId ?? undefined,
      repo: gitRepo, branch: gitBranch || undefined,
      path: gitPath || undefined, token: gitToken, message: gitMessage || undefined,
    }),
    onSuccess: (res) => {
      enqueueSnackbar(`Committed ${res.committed} file(s)`, {
        variant: res.errors.length > 0 ? 'warning' : 'success',
      })
      setGitOpen(false)
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Git check-in failed', { variant: 'error' }),
  })

  const exportCriteria = () => {
    const blob = new Blob([JSON.stringify(criteria, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'acceptance-criteria.json'; a.click(); URL.revokeObjectURL(a.href)
  }

  const items: DevArtifactItem[] = artifact?.artifacts_json ? JSON.parse(artifact.artifacts_json) : []
  const execLog = items.filter((i) => i.status !== 'pending')
  const isBusy = analyzeMut.isPending || planMut.isPending

  if (!connId) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
        <AutoAwesomeOutlined sx={{ fontSize: 48, color: 'text.disabled' }} />
        <Typography variant="h6" color="text.secondary">No Connection Selected</Typography>
        <Typography variant="body2" color="text.disabled">
          Select a connection from the header dropdown to use Development Intelligence.
        </Typography>
      </Box>
    )
  }

  return (
    <>
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>

      {/* ── Page Header ─────────────────────────────────────────── */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CodeOutlined sx={{ fontSize: 28, color: 'primary.main' }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>Development Intelligence</Typography>
          <Typography variant="body2" color="text.secondary">
            Requirements → Acceptance Criteria → SQL Plan → Execution
          </Typography>
        </Box>
      </Stack>

      {/* ── Requirements Input (collapsible) ─────────────────────── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>

        {/* ── Header row (always visible) ── */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{
          px: 2, py: 1, borderBottom: reqPanelOpen ? '1px solid' : 'none', borderColor: 'divider',
        }}>
          {/* Source toggle */}
          <ToggleButtonGroup value={sourceType} exclusive size="small"
            onChange={(_, v) => v && setSourceType(v)}>
            <ToggleButton value="text" sx={{ fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5 }}>
              <TextFieldsOutlined sx={{ fontSize: 13, mr: 0.5 }} />Free Text
            </ToggleButton>
            <ToggleButton value="jira" sx={{ fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5 }}>
              <LinkOutlined sx={{ fontSize: 13, mr: 0.5 }} />JIRA
            </ToggleButton>
            <ToggleButton value="ado" sx={{ fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5 }}>
              <LinkOutlined sx={{ fontSize: 13, mr: 0.5 }} />Azure DevOps
            </ToggleButton>
          </ToggleButtonGroup>

          {/* JIRA key input */}
          {sourceType === 'jira' && (
            <>
              {!jiraConfigured
                ? <Chip label="JIRA not configured — Admin → Integrations" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                : <>
                    <TextField size="small" placeholder="e.g. PROJ-123" value={jiraKey}
                      onChange={(e) => setJiraKey(e.target.value)} sx={{ width: 155 }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && jiraKey) fetchMut.mutate() }} />
                    <Button size="small" variant="outlined"
                      startIcon={fetchMut.isPending ? <CircularProgress size={11} /> : <CloudDownloadOutlined />}
                      onClick={() => fetchMut.mutate()}
                      disabled={fetchMut.isPending || !jiraKey}>
                      Fetch
                    </Button>
                  </>
              }
            </>
          )}

          {/* ADO work item input */}
          {sourceType === 'ado' && (
            <>
              {!adoConfigured
                ? <Chip label="ADO not configured — Admin → Integrations" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                : <>
                    <TextField size="small" placeholder="Work item ID" value={adoWiId}
                      onChange={(e) => setAdoWiId(e.target.value)} sx={{ width: 155 }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && adoWiId) fetchMut.mutate() }} />
                    <Button size="small" variant="outlined"
                      startIcon={fetchMut.isPending ? <CircularProgress size={11} /> : <CloudDownloadOutlined />}
                      onClick={() => fetchMut.mutate()}
                      disabled={fetchMut.isPending || !adoWiId}>
                      Fetch
                    </Button>
                  </>
              }
            </>
          )}

          <Box sx={{ flex: 1 }} />

          {/* Model */}
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>AI Model</InputLabel>
            <Select label="AI Model" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Actions */}
          <Button variant="contained" size="small"
            startIcon={isBusy ? <CircularProgress size={12} /> : <AutoAwesomeOutlined />}
            onClick={analyzeAndPlan} disabled={isBusy || !reqText.trim()}>
            {isBusy ? 'Working…' : 'Analyze & Plan'}
          </Button>
          <Button size="small" variant="outlined"
            startIcon={analyzeMut.isPending ? <CircularProgress size={10} /> : <AssignmentOutlined />}
            onClick={() => analyzeMut.mutate()} disabled={isBusy || !reqText.trim()}>
            AC Only
          </Button>
          <Button size="small" variant="outlined"
            startIcon={planMut.isPending ? <CircularProgress size={10} /> : <CodeOutlined />}
            onClick={() => planMut.mutate()} disabled={isBusy || !reqText.trim()}>
            Plan Only
          </Button>

          {/* Collapse toggle */}
          <Tooltip title={reqPanelOpen ? 'Collapse requirements' : 'Expand requirements'}>
            <IconButton size="small" onClick={() => setReqPanelOpen(p => !p)} sx={{ p: 0.5 }}>
              {reqPanelOpen ? <ExpandLessOutlined sx={{ fontSize: 16 }} /> : <ExpandMoreOutlined sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        </Stack>

        {/* ── Collapsible textarea row ── */}
        <Collapse in={reqPanelOpen}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <TextField
              multiline minRows={4} maxRows={10} fullWidth size="small"
              label={sourceType === 'text' ? 'BRD / Requirements' : 'Fetched Requirements (editable)'}
              placeholder={
                sourceType === 'text'
                  ? 'Paste your BRD, user stories, or requirements here…'
                  : 'Click Fetch above to load from JIRA / ADO, or paste directly…'
              }
              value={reqText}
              onChange={(e) => setReqText(e.target.value)}
            />
          </Box>
        </Collapse>

      </Paper>

      {/* ── Main Content Tabs ────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, display: 'flex', flexDirection: 'column', flex: mainPanelOpen ? 1 : 'none', minHeight: 0, overflow: 'hidden' }}>
        {/* Tab bar — always visible, collapse button pinned right */}
        <Stack direction="row" alignItems="center" sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <Tabs
            value={mainTab}
            onChange={(_, v) => { setMainTab(v); setMainPanelOpen(true) }}
            sx={{ flex: 1, px: 1, minHeight: 44 }}
          >
            <Tab icon={<AssignmentOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label={`Acceptance Criteria${criteria.length > 0 ? ` (${criteria.length})` : ''}`}
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
            <Tab icon={<CodeOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label={`SQL Plan${planSteps.length > 0 ? ` (${planSteps.length})` : ''}`}
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
            <Tab icon={<BugReportOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label="Bug Fix"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
            <Tab icon={<PlayArrowOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label={`Execution Log${execLog.length > 0 ? ` (${execLog.length})` : ''}`}
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
            <Tab icon={<BugReportOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label="AI Traces"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
          </Tabs>
          <Tooltip title={mainPanelOpen ? 'Collapse panel' : 'Expand panel'}>
            <IconButton size="small" onClick={() => setMainPanelOpen(p => !p)} sx={{ mx: 1 }}>
              {mainPanelOpen ? <ExpandLessOutlined sx={{ fontSize: 16 }} /> : <ExpandMoreOutlined sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Collapse in={mainPanelOpen}>
        <Box sx={{ overflowY: 'auto', p: 2, minHeight: 360, maxHeight: 'calc(100vh - 300px)' }}>

          {/* ── Tab 0: Acceptance Criteria ── */}
          {mainTab === 0 && (
            criteria.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled' }}>
                <AssignmentOutlined sx={{ fontSize: 64, opacity: 0.3 }} />
                <Typography variant="h6" color="text.secondary" fontWeight={500}>
                  {isBusy ? 'Analyzing requirements…' : 'No acceptance criteria yet'}
                </Typography>
                {isBusy && <CircularProgress size={24} />}
                {!isBusy && (
                  <Typography variant="body2" color="text.disabled" textAlign="center" sx={{ maxWidth: 400 }}>
                    Enter requirements above and click "Analyze &amp; Plan"
                  </Typography>
                )}
              </Box>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" fontWeight={700}>Acceptance Criteria</Typography>
                  <Chip label={criteria.length} size="small" color="primary" />
                  <Box sx={{ flex: 1 }} />
                  {(['high','medium','low'] as const).map((p) => {
                    const cnt = criteria.filter((c) => c.priority === p).length
                    return cnt > 0 ? (
                      <Chip key={p} label={`${p}: ${cnt}`} size="small"
                        sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700,
                          bgcolor: alpha(PRIORITY_COLORS[p], 0.1), color: PRIORITY_COLORS[p] }} />
                    ) : null
                  })}
                  <Button size="small" variant="outlined" onClick={exportCriteria}>Export JSON</Button>
                  <Tooltip title="Export to JIRA / Azure DevOps">
                    <Button size="small" variant="outlined" color="secondary"
                      startIcon={<IosShareOutlined sx={{ fontSize: 14 }} />}
                      onClick={() => setExportAcOpen(true)}>
                      Export to JIRA / ADO
                    </Button>
                  </Tooltip>
                  <Button size="small" variant="text"
                    onClick={() => {
                      if (acExpandedIds.size === criteria.length) {
                        setAcExpandedIds(new Set())
                      } else {
                        setAcExpandedIds(new Set(criteria.map(c => c.id)))
                      }
                    }}
                    endIcon={acExpandedIds.size === criteria.length ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
                    sx={{ fontSize: '0.75rem' }}>
                    {acExpandedIds.size === criteria.length ? 'Collapse All' : 'Expand All'}
                  </Button>
                </Box>

                {criteria.map((c) => (
                  <Accordion key={c.id} disableGutters elevation={0}
                    expanded={acExpandedIds.has(c.id)}
                    onChange={(_, open) => setAcExpandedIds(prev => {
                      const next = new Set(prev); open ? next.add(c.id) : next.delete(c.id); return next
                    })}
                    sx={{ mb: 1, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&::before': { display: 'none' } }}>
                    <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 44 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                        <Chip label={`AC-${c.id}`} size="small"
                          sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700, flexShrink: 0,
                            bgcolor: alpha(tokens.indigo600, 0.1), color: tokens.indigo600 }} />
                        <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>{c.feature}</Typography>
                        <Chip label={c.priority} size="small"
                          sx={{ height: 18, fontSize: '0.625rem', fontWeight: 700, flexShrink: 0,
                            bgcolor: alpha(PRIORITY_COLORS[c.priority] ?? tokens.indigo600, 0.1),
                            color: PRIORITY_COLORS[c.priority] ?? tokens.indigo600 }} />
                        <Chip label={c.complexity} size="small" variant="outlined"
                          sx={{ height: 18, fontSize: '0.625rem', flexShrink: 0 }} />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                      <Card variant="outlined" sx={{ borderRadius: 1.5, mb: 1.5 }}>
                        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                          {[
                            { label: 'GIVEN', text: c.given,  color: tokens.sky600 },
                            { label: 'WHEN',  text: c.when,   color: tokens.violet600 },
                            { label: 'THEN',  text: c.then,   color: tokens.emerald600 },
                          ].map(({ label, text, color }) => (
                            <Box key={label} sx={{ display: 'flex', gap: 1, mb: 0.75 }}>
                              <Typography variant="caption" fontWeight={800}
                                sx={{ color, width: 48, flexShrink: 0, lineHeight: 1.6 }}>
                                {label}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>{text}</Typography>
                            </Box>
                          ))}
                          {c.notes && (
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="caption" fontWeight={700} color="text.disabled" sx={{ width: 48, flexShrink: 0 }}>NOTE</Typography>
                              <Typography variant="caption" color="text.disabled">{c.notes}</Typography>
                            </Box>
                          )}
                        </CardContent>
                      </Card>

                      {c.sql_validation && (
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                            <CodeOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
                            <Typography variant="caption" fontWeight={700} color="text.secondary">SQL Validation</Typography>
                            <Box sx={{ flex: 1 }} />
                            {acResults[c.id] && (
                              <Chip icon={<VerifiedOutlined sx={{ fontSize: 12 }} />}
                                label={`${(acResults[c.id].rows as unknown[])?.length ?? 0} rows`}
                                size="small" color="success" variant="outlined"
                                sx={{ height: 20, fontSize: '0.625rem' }} />
                            )}
                            <Button size="small" variant="outlined"
                              startIcon={acRunMut.isPending ? <CircularProgress size={10} /> : <PlayArrowOutlined />}
                              onClick={() => acRunMut.mutate({ id: c.id, sql: acSqlMap[c.id] ?? c.sql_validation! })}
                              disabled={acRunMut.isPending}
                              sx={{ fontSize: '0.688rem', py: 0.25 }}>
                              Run
                            </Button>
                          </Box>
                          <TextField multiline fullWidth size="small"
                            value={acSqlMap[c.id] ?? c.sql_validation}
                            onChange={(e) => setAcSqlMap((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                          />
                          {acResults[c.id] && (acResults[c.id].rows as unknown[]).length > 0 && (
                            <Box sx={{ mt: 1, maxHeight: 130, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                              <Table size="small" stickyHeader>
                                <TableHead>
                                  <TableRow>
                                    {acResults[c.id].columns.map((col) => (
                                      <TableCell key={col} sx={{ fontWeight: 700, fontSize: '0.688rem', py: 0.5 }}>{col}</TableCell>
                                    ))}
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(acResults[c.id].rows as Record<string, unknown>[]).slice(0, 8).map((row, i) => (
                                    <TableRow key={i}>
                                      {acResults[c.id].columns.map((col) => (
                                        <TableCell key={col} sx={{ fontSize: '0.688rem', py: 0.25 }}>
                                          {String(row[col] ?? '')}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </Box>
                          )}
                        </Box>
                      )}
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            )
          )}

          {/* ── Tab 1: SQL Plan ── */}
          {mainTab === 1 && (
            planSteps.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled' }}>
                <CodeOutlined sx={{ fontSize: 64, opacity: 0.3 }} />
                <Typography variant="h6" color="text.secondary" fontWeight={500}>
                  {isBusy ? 'Generating plan…' : 'No SQL plan yet'}
                </Typography>
                {isBusy && <CircularProgress size={24} />}
                {!isBusy && (
                  <Typography variant="body2" color="text.disabled" textAlign="center" sx={{ maxWidth: 400 }}>
                    Enter requirements above and click "Analyze &amp; Plan" or "Plan Only"
                  </Typography>
                )}
              </Box>
            ) : (
              <Box>
                {/* Plan toolbar */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" fontWeight={700}>SQL Development Plan</Typography>
                  <Chip label={`${planSteps.length} steps`} size="small" color="primary" />
                  <Box sx={{ flex: 1 }} />
                  {artifactId && (
                    <>
                      <Tooltip title="Generate SQL for all steps">
                        <Button size="small" variant="outlined"
                          startIcon={genAllMut.isPending ? <CircularProgress size={12} /> : <AllInclusiveOutlined />}
                          onClick={() => setGenAllOpen(true)}
                          disabled={genAllMut.isPending || valAllMut.isPending || pipelineMut.isPending}>
                          {genAllMut.isPending ? 'Generating…' : 'Generate All'}
                        </Button>
                      </Tooltip>
                      <Tooltip title="Validate all generated SQL">
                        <Button size="small" variant="outlined" color="warning"
                          startIcon={valAllMut.isPending ? <CircularProgress size={12} /> : <FactCheckOutlined />}
                          onClick={() => valAllMut.mutate()}
                          disabled={genAllMut.isPending || valAllMut.isPending || pipelineMut.isPending}>
                          Validate All
                        </Button>
                      </Tooltip>
                      <Tooltip title="Push SQL to GitHub">
                        <Button size="small" variant="outlined" color="secondary"
                          startIcon={<CloudUploadOutlined />}
                          onClick={() => setGitOpen(true)}>
                          Git Check-in
                        </Button>
                      </Tooltip>
                      <Tooltip title="Approve all steps with generated SQL">
                        <Button size="small" variant="outlined" color="success"
                          startIcon={<HowToVoteOutlined />}
                          onClick={() => {
                            const next = new Map(approvalMap)
                            planSteps.forEach((s) => {
                              const items2: DevArtifactItem[] = artifact?.artifacts_json ? JSON.parse(artifact.artifacts_json) : []
                              const hasSql = sqlMap.get(s.step_number) || items2.find((i) => i.step_number === s.step_number)?.sql
                              if (hasSql) next.set(s.step_number, 'approved')
                            })
                            setApprovalMap(next)
                          }}>
                          Approve All
                        </Button>
                      </Tooltip>
                      <Button size="small" variant="contained" color="success"
                        startIcon={<PlayArrowOutlined />}
                        onClick={() => setConfirmPipelineOpen(true)}
                        disabled={pipelineMut.isPending || genAllMut.isPending}>
                        Run Pipeline
                      </Button>
                      <Tooltip title="View all SQL in one place">
                        <Button size="small" variant="outlined"
                          startIcon={<VisibilityOutlined />}
                          onClick={() => setViewAllOpen(true)}>
                          View All
                        </Button>
                      </Tooltip>
                      <Tooltip title="Download as .sql file">
                        <Button size="small" variant="outlined"
                          startIcon={<FileDownloadOutlined />}
                          onClick={handleDownloadAll}>
                          Download
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </Box>

                {valAllResults.length > 0 && (
                  <Alert
                    severity={valAllResults.every((v) => v.passed) ? 'success' : 'warning'}
                    sx={{ mb: 2, fontSize: '0.813rem' }}
                    onClose={() => setValAllResults([])}
                  >
                    <strong>Validation Results:</strong>{' '}
                    {valAllResults.filter((v) => v.passed).length}/{valAllResults.length} steps passed.
                    {valAllResults.filter((v) => !v.passed).map((v) => (
                      <Box key={v.step_number} sx={{ mt: 0.5 }}>
                        <strong>Step {v.step_number}:</strong> {v.errors.join(', ')}
                      </Box>
                    ))}
                  </Alert>
                )}

                {planSteps.map((step) => (
                  <StepCard
                    key={step.step_number}
                    step={step}
                    artifact={artifact ?? null}
                    connId={connId}
                    model={model}
                    onSqlChange={(num, sql) => setSqlMap((prev) => new Map(prev).set(num, sql))}
                    approvalStatus={approvalMap.get(step.step_number) ?? 'pending'}
                    onApprovalChange={(status) => setApprovalMap((prev) => new Map(prev).set(step.step_number, status))}
                  />
                ))}

                {debugPayload && (
                  <DebugStepsPanel debug={debugPayload} module="development" />
                )}
              </Box>
            )
          )}

          {/* ── Tab 2: Bug Fix Wizard ── */}
          {mainTab === 2 && (
            <Box>
              {/* ── Wizard header ── */}
              <Stack direction="row" alignItems="center" mb={3}>
                <BugReportOutlined sx={{ color: 'error.main', fontSize: 20, mr: 1 }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700}>Bug Fix Assistant</Typography>
                  <Typography variant="caption" color="text.secondary">AI-guided, step-by-step bug analysis and fix generation</Typography>
                </Box>
                {bugVersions.length > 0 && (
                  <Button size="small" variant="outlined" color="warning"
                    startIcon={<HistoryOutlined sx={{ fontSize: 14 }} />}
                    onClick={() => setBugVersionOpen(true)} sx={{ mr: 1 }}>
                    {bugVersions.length} Version{bugVersions.length !== 1 ? 's' : ''}
                  </Button>
                )}
                <Button size="small" variant="text" color="error"
                  onClick={() => {
                    setBugWizardStep(0); setBugIssue(''); setBugExpected(''); setBugActual('')
                    setBugBeforeSql(''); setBugDescription(''); setBugFixSteps([])
                    setBugAiHint(''); setBugSqlAnalysis({ issues: [], types: [] })
                  }}>
                  Start Over
                </Button>
              </Stack>

              {/* ── Step progress bar ── */}
              <Box sx={{ mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={0}>
                  {BUG_WIZARD_STEPS.map((label, i) => {
                    const done      = bugWizardStep > i
                    const active    = bugWizardStep === i
                    const stepColor = done ? tokens.emerald600 : active ? tokens.indigo600 : '#CBD5E1'
                    return (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', flex: i < BUG_WIZARD_STEPS.length - 1 ? 1 : 'none' }}>
                        {/* Circle */}
                        <Tooltip title={done ? `Go back to ${label}` : label}>
                          <Box onClick={() => done && setBugWizardStep(i)}
                            sx={{
                              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              bgcolor: done || active ? stepColor : 'transparent',
                              border: `2px solid ${stepColor}`,
                              cursor: done ? 'pointer' : 'default',
                              transition: 'all 0.2s',
                            }}>
                            {done
                              ? <CheckCircleOutlineOutlined sx={{ fontSize: 14, color: '#fff' }} />
                              : <Typography variant="caption" fontWeight={700}
                                  sx={{ color: active ? '#fff' : '#94A3B8', fontSize: '0.7rem' }}>{i + 1}</Typography>}
                          </Box>
                        </Tooltip>
                        {/* Label */}
                        <Typography variant="caption" fontWeight={active ? 700 : 500}
                          sx={{ ml: 0.75, color: active ? stepColor : done ? tokens.emerald600 : 'text.disabled',
                            fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {label}
                        </Typography>
                        {/* Connector line */}
                        {i < BUG_WIZARD_STEPS.length - 1 && (
                          <Box sx={{ flex: 1, height: 2, mx: 1.5,
                            bgcolor: done ? tokens.emerald600 : '#E2E8F0', borderRadius: 1, transition: 'all 0.2s' }} />
                        )}
                      </Box>
                    )
                  })}
                </Stack>
              </Box>

              {/* ══════════════════════════════════════
                  STEP 1 — Describe the Bug
              ══════════════════════════════════════ */}
              {bugWizardStep === 0 && (
                <Box>
                  {/* Source row */}
                  <Stack direction="row" spacing={0.75} alignItems="center" mb={2} flexWrap="wrap" gap={0.5}>
                    <ToggleButtonGroup value={bugSourceType} exclusive size="small"
                      onChange={(_, v) => v && setBugSourceType(v)}>
                      <ToggleButton value="text" sx={{ fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5 }}>
                        <TextFieldsOutlined sx={{ fontSize: 13, mr: 0.5 }} />Manual
                      </ToggleButton>
                      <ToggleButton value="jira" sx={{ fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5 }}>
                        <LinkOutlined sx={{ fontSize: 13, mr: 0.5 }} />JIRA
                      </ToggleButton>
                      <ToggleButton value="ado" sx={{ fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5 }}>
                        <LinkOutlined sx={{ fontSize: 13, mr: 0.5 }} />ADO
                      </ToggleButton>
                    </ToggleButtonGroup>

                    {bugSourceType === 'jira' && (
                      !jiraConfigured
                        ? <Chip label="JIRA not configured" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                        : <>
                            <TextField size="small" placeholder="PROJ-456" value={bugJiraKey}
                              onChange={(e) => setBugJiraKey(e.target.value)} sx={{ width: 130 }}
                              onKeyDown={(e) => { if (e.key === 'Enter' && bugJiraKey) fetchBugMut.mutate() }} />
                            <Button size="small" variant="outlined"
                              startIcon={fetchBugMut.isPending ? <CircularProgress size={11} /> : <CloudDownloadOutlined />}
                              onClick={() => fetchBugMut.mutate()}
                              disabled={fetchBugMut.isPending || !bugJiraKey}>Import
                            </Button>
                          </>
                    )}
                    {bugSourceType === 'ado' && (
                      !adoConfigured
                        ? <Chip label="ADO not configured" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                        : <>
                            <TextField size="small" placeholder="Work item ID" value={bugAdoWiId}
                              onChange={(e) => setBugAdoWiId(e.target.value)} sx={{ width: 130 }}
                              onKeyDown={(e) => { if (e.key === 'Enter' && bugAdoWiId) fetchBugMut.mutate() }} />
                            <Button size="small" variant="outlined"
                              startIcon={fetchBugMut.isPending ? <CircularProgress size={11} /> : <CloudDownloadOutlined />}
                              onClick={() => fetchBugMut.mutate()}
                              disabled={fetchBugMut.isPending || !bugAdoWiId}>Import
                            </Button>
                          </>
                    )}
                  </Stack>

                  {/* Imported text from JIRA/ADO OR structured fields */}
                  {(bugSourceType !== 'text' && bugDescription) ? (
                    <TextField multiline minRows={5} maxRows={10} fullWidth size="small"
                      label="Imported Bug Description (editable)" value={bugDescription}
                      onChange={(e) => setBugDescription(e.target.value)} sx={{ mb: 2 }} />
                  ) : (
                    <Stack spacing={1.5} mb={2}>
                      <TextField fullWidth size="small" label="What's the issue? *"
                        placeholder="e.g. GL reconciliation shows incorrect balance for reversal accounts"
                        value={bugIssue} onChange={(e) => setBugIssue(e.target.value)} />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <TextField fullWidth size="small" label="Expected behavior"
                          placeholder="e.g. Net balance = sum of journal entries"
                          value={bugExpected} onChange={(e) => setBugExpected(e.target.value)} />
                        <TextField fullWidth size="small" label="Actual behavior"
                          placeholder="e.g. Balance is off by the reversal amount"
                          value={bugActual} onChange={(e) => setBugActual(e.target.value)} />
                      </Stack>
                    </Stack>
                  )}

                  {/* Impact selector */}
                  <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary">Impact:</Typography>
                    {(['high', 'medium', 'low'] as const).map(level => (
                      <Chip key={level} label={level.charAt(0).toUpperCase() + level.slice(1)} size="small"
                        onClick={() => setBugImpact(level)}
                        sx={{
                          fontWeight: bugImpact === level ? 800 : 500,
                          fontSize: '0.7rem', cursor: 'pointer',
                          bgcolor: bugImpact === level ? alpha(PRIORITY_COLORS[level], 0.15) : 'transparent',
                          color: bugImpact === level ? PRIORITY_COLORS[level] : 'text.secondary',
                          border: `1px solid ${bugImpact === level ? PRIORITY_COLORS[level] : '#E2E8F0'}`,
                        }} />
                    ))}
                  </Stack>

                  {/* AI Hint */}
                  {bugAiHint && (
                    <Alert severity="info" icon={<AutoAwesomeOutlined sx={{ fontSize: 16 }} />}
                      sx={{ mb: 2, fontSize: '0.813rem', py: 0.5, borderRadius: 2 }}>
                      <strong>AI Hint:</strong> {bugAiHint}
                    </Alert>
                  )}
                </Box>
              )}

              {/* ══════════════════════════════════════
                  STEP 2 — SQL Input
              ══════════════════════════════════════ */}
              {bugWizardStep === 1 && (
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <Chip label="BEFORE" size="small"
                      sx={{ height: 18, fontSize: '0.563rem', fontWeight: 800, bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600, border: 'none' }} />
                    <Typography variant="caption" fontWeight={700} color="text.secondary">
                      Current / Broken SQL
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.disabled">Snapshot saved automatically when you proceed</Typography>
                  </Stack>

                  <TextField
                    multiline minRows={8} maxRows={14} fullWidth size="small"
                    autoFocus
                    placeholder={'-- Paste the current SQL that contains the bug\nSELECT account_id, SUM(amount) AS balance\nFROM gl_entries\nGROUP BY account_id'}
                    value={bugBeforeSql}
                    onChange={(e) => setBugBeforeSql(e.target.value)}
                    sx={{ mb: 1.5, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.6 } }}
                  />

                  {/* AI Analysis panel */}
                  {bugSqlAnalysis.issues.length > 0 && (
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 1.5,
                      bgcolor: alpha(tokens.amber600, 0.03), borderColor: alpha(tokens.amber600, 0.3) }}>
                      <Stack direction="row" alignItems="center" spacing={0.75} mb={1}>
                        <AutoAwesomeOutlined sx={{ fontSize: 15, color: tokens.amber600 }} />
                        <Typography variant="caption" fontWeight={700} color="text.secondary">AI Analysis</Typography>
                      </Stack>
                      <Stack spacing={0.5} mb={1}>
                        {bugSqlAnalysis.issues.map((issue, i) => (
                          <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                            <WarningAmberOutlined sx={{ fontSize: 13, color: tokens.amber600, mt: 0.15, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ fontSize: '0.78rem' }}>{issue}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                      {bugSqlAnalysis.types.length > 0 && (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                          <Typography variant="caption" color="text.disabled" sx={{ mr: 0.5 }}>Likely bug types:</Typography>
                          {bugSqlAnalysis.types.map(t => (
                            <Chip key={t} label={t} size="small" variant="outlined"
                              sx={{ height: 18, fontSize: '0.63rem', borderColor: tokens.amber600, color: tokens.amber600 }} />
                          ))}
                        </Stack>
                      )}
                    </Paper>
                  )}
                  {!bugBeforeSql.trim() && (
                    <Alert severity="info" sx={{ fontSize: '0.78rem', py: 0.5, borderRadius: 2 }}>
                      No SQL? You can skip this step — the AI will generate a fix plan based on your description alone.
                    </Alert>
                  )}
                </Box>
              )}

              {/* ══════════════════════════════════════
                  STEP 3 — Context (Link to Plan)
              ══════════════════════════════════════ */}
              {bugWizardStep === 2 && (
                <Box>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Link to an existing development plan so the AI understands your current database state.
                    This is optional but significantly improves fix quality.
                  </Typography>

                  {/* No context option */}
                  <Box onClick={() => setBugLinkedArtifactId(null)}
                    sx={{
                      p: 1.5, mb: 1, borderRadius: 2, border: '2px solid',
                      borderColor: bugLinkedArtifactId === null ? tokens.indigo600 : 'divider',
                      bgcolor: bugLinkedArtifactId === null ? alpha(tokens.indigo600, 0.04) : 'transparent',
                      cursor: 'pointer', '&:hover': { borderColor: tokens.indigo600, bgcolor: alpha(tokens.indigo600, 0.03) },
                      transition: 'all 0.15s',
                    }}>
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <Box sx={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid`,
                        borderColor: bugLinkedArtifactId === null ? tokens.indigo600 : '#CBD5E1',
                        bgcolor: bugLinkedArtifactId === null ? tokens.indigo600 : 'transparent', flexShrink: 0 }} />
                      <Box>
                        <Typography variant="body2" fontWeight={600}>No context — standalone bug fix</Typography>
                        <Typography variant="caption" color="text.disabled">AI uses only the bug description and SQL you provided</Typography>
                      </Box>
                    </Stack>
                  </Box>

                  {/* Plan cards */}
                  {(history as DevArtifact[]).length === 0 && (
                    <Alert severity="info" sx={{ fontSize: '0.78rem', borderRadius: 2 }}>
                      No development plans found. Run "Plan Only" from the requirements panel to create one.
                    </Alert>
                  )}
                  {(history as DevArtifact[]).map((h) => {
                    const hSteps: PlanStep[] = h.plan_json ? (() => { try { return JSON.parse(h.plan_json) } catch { return [] } })() : []
                    const hMeta = planMeta[h.id]
                    const isSelected = bugLinkedArtifactId === h.id
                    return (
                      <Box key={h.id} onClick={() => setBugLinkedArtifactId(h.id)}
                        sx={{
                          p: 1.5, mb: 1, borderRadius: 2, border: '2px solid',
                          borderColor: isSelected ? tokens.indigo600 : 'divider',
                          bgcolor: isSelected ? alpha(tokens.indigo600, 0.04) : 'transparent',
                          cursor: 'pointer', '&:hover': { borderColor: tokens.indigo600, bgcolor: alpha(tokens.indigo600, 0.03) },
                          transition: 'all 0.15s',
                        }}>
                        <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                          <Box sx={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid', mt: 0.3,
                            borderColor: isSelected ? tokens.indigo600 : '#CBD5E1',
                            bgcolor: isSelected ? tokens.indigo600 : 'transparent', flexShrink: 0 }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" spacing={1} alignItems="center" mb={0.25} flexWrap="wrap">
                              <Typography variant="body2" fontWeight={600} noWrap>
                                {hMeta?.name || h.task_description.slice(0, 60)}
                              </Typography>
                              {hMeta?.jira_key && (
                                <Chip label={hMeta.jira_key} size="small" variant="outlined"
                                  sx={{ height: 16, fontSize: '0.563rem', borderColor: tokens.indigo600, color: tokens.indigo600 }} />
                              )}
                              <Chip label={`${hSteps.length} steps`} size="small" variant="outlined"
                                sx={{ height: 16, fontSize: '0.563rem' }} />
                              {h.created_at && (
                                <Typography variant="caption" color="text.disabled">
                                  {new Date(h.created_at).toLocaleDateString()}
                                </Typography>
                              )}
                            </Stack>
                            {isSelected && hSteps.length > 0 && (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mt: 0.5 }}>
                                {hSteps.slice(0, 5).map(s => (
                                  <Chip key={s.step_number} label={`${s.step_number}. ${s.title}`} size="small"
                                    variant="outlined" sx={{ fontSize: '0.63rem', height: 18,
                                      borderColor: alpha(tokens.indigo600, 0.3), color: tokens.indigo600 }} />
                                ))}
                                {hSteps.length > 5 && (
                                  <Chip label={`+${hSteps.length - 5} more`} size="small"
                                    sx={{ fontSize: '0.63rem', height: 18, bgcolor: alpha(tokens.indigo600, 0.08) }} />
                                )}
                              </Box>
                            )}
                          </Box>
                        </Stack>
                      </Box>
                    )
                  })}

                  {bugLinkedArtifactId !== null && (
                    <Alert severity="success" icon={<CheckCircleOutlineOutlined sx={{ fontSize: 16 }} />}
                      sx={{ mt: 1, fontSize: '0.78rem', py: 0.5, borderRadius: 2 }}>
                      AI will reference the selected plan's schema and {
                        (() => {
                          const linked = (history as DevArtifact[]).find(h => h.id === bugLinkedArtifactId)
                          const s: PlanStep[] = linked?.plan_json ? (() => { try { return JSON.parse(linked.plan_json) } catch { return [] } })() : []
                          return s.length
                        })()
                      } existing steps when generating the fix.
                    </Alert>
                  )}
                </Box>
              )}

              {/* ══════════════════════════════════════
                  STEP 4 — Fix Plan (Output)
              ══════════════════════════════════════ */}
              {bugWizardStep === 3 && (
                <Box>
                  {bugFixMut.isPending ? (
                    <Box sx={{ textAlign: 'center', py: 6 }}>
                      <CircularProgress size={36} color="error" sx={{ mb: 2 }} />
                      <Typography variant="body1" fontWeight={600}>Analyzing bug & generating fix plan…</Typography>
                      <Typography variant="caption" color="text.secondary">
                        AI is reviewing the SQL, understanding the root cause, and building fix steps
                      </Typography>
                      <LinearProgress color="error" sx={{ mt: 2, borderRadius: 1 }} />
                    </Box>
                  ) : bugFixSteps.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
                      <BugReportOutlined sx={{ fontSize: 48, opacity: 0.2, mb: 1 }} />
                      <Typography variant="body2">Complete the steps above then click "Generate Fix Plan"</Typography>
                    </Box>
                  ) : (
                    <Box>
                      {/* Root cause summary */}
                      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2,
                        bgcolor: alpha(tokens.red600, 0.03), borderColor: alpha(tokens.red600, 0.2) }}>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          <BugReportOutlined sx={{ fontSize: 18, color: tokens.red600, mt: 0.2, flexShrink: 0 }} />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="caption" fontWeight={700} color="error" display="block" mb={0.5}>
                              Root Cause Analysis
                            </Typography>
                            {bugSqlAnalysis.issues.length > 0 ? (
                              <Stack spacing={0.4}>
                                {bugSqlAnalysis.issues.map((issue, i) => (
                                  <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: '0.813rem' }}>
                                    • {issue}
                                  </Typography>
                                ))}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.813rem' }}>
                                Based on the bug description: <em>{bugIssue || bugDescription.slice(0, 120)}</em>
                              </Typography>
                            )}
                            {bugSqlAnalysis.types.length > 0 && (
                              <Stack direction="row" spacing={0.5} mt={0.75} flexWrap="wrap" gap={0.5}>
                                {bugSqlAnalysis.types.map(t => (
                                  <Chip key={t} label={t} size="small"
                                    sx={{ height: 18, fontSize: '0.625rem', fontWeight: 700,
                                      bgcolor: alpha(tokens.red600, 0.1), color: tokens.red600, border: 'none' }} />
                                ))}
                              </Stack>
                            )}
                          </Box>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Chip label={`v${bugVersions.length}`} size="small" variant="outlined"
                              sx={{ height: 18, fontSize: '0.563rem' }} />
                            {(bugJiraKey || bugAdoWiId) && (
                              <Chip label={bugJiraKey || `ADO-${bugAdoWiId}`} size="small" variant="outlined"
                                sx={{ height: 18, fontSize: '0.563rem', borderColor: tokens.indigo600, color: tokens.indigo600 }} />
                            )}
                          </Stack>
                        </Stack>
                      </Paper>

                      {/* Before vs After diff */}
                      {bugBeforeSql.trim() && (
                        <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden' }}>
                          <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="caption" fontWeight={700} color="text.secondary">Before vs After</Typography>
                            <Box sx={{ flex: 1 }} />
                            <Chip label="BEFORE" size="small"
                              sx={{ height: 16, fontSize: '0.5rem', fontWeight: 800, mr: 0.5,
                                bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600, border: 'none' }} />
                            <Chip label="AFTER" size="small"
                              sx={{ height: 16, fontSize: '0.5rem', fontWeight: 800,
                                bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600, border: 'none' }} />
                          </Stack>
                          <Stack direction="row" divider={<Divider orientation="vertical" flexItem />}>
                            <Box sx={{ flex: 1, p: 1.5, bgcolor: alpha(tokens.red600, 0.02) }}>
                              <Box component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: '0.75rem',
                                lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.secondary' }}>
                                {bugBeforeSql}
                              </Box>
                            </Box>
                            <Box sx={{ flex: 1, p: 1.5, bgcolor: alpha(tokens.emerald600, 0.02) }}>
                              {(() => {
                                const firstSql = bugSqlMap.size > 0 ? bugSqlMap.get(1) : null
                                const artifactSql = bugArtifact?.artifacts_json
                                  ? (JSON.parse(bugArtifact.artifacts_json) as { step_number: number; sql?: string }[]).find(i => i.step_number === 1)?.sql
                                  : null
                                const afterSql = firstSql || artifactSql
                                return afterSql ? (
                                  <Box component="pre" sx={{ m: 0, fontFamily: 'monospace', fontSize: '0.75rem',
                                    lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: tokens.emerald600 }}>
                                    {afterSql}
                                  </Box>
                                ) : (
                                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                                    justifyContent: 'center', height: '100%', py: 3, gap: 0.5 }}>
                                    <CodeOutlined sx={{ fontSize: 24, color: 'text.disabled', opacity: 0.4 }} />
                                    <Typography variant="caption" color="text.disabled" textAlign="center">
                                      Generate SQL for Step 1 to see the fix here
                                    </Typography>
                                  </Box>
                                )
                              })()}
                            </Box>
                          </Stack>
                        </Paper>
                      )}

                      {/* Fix steps */}
                      <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                        <Chip label="AFTER" size="small"
                          sx={{ height: 18, fontSize: '0.563rem', fontWeight: 800, bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600, border: 'none' }} />
                        <Typography variant="subtitle2" fontWeight={700}>Fix Plan</Typography>
                        <Chip label={`${bugFixSteps.length} steps`} size="small" color="error" />
                        <Box sx={{ flex: 1 }} />
                        <FormControl size="small" sx={{ minWidth: 140 }}>
                          <InputLabel>AI Model</InputLabel>
                          <Select label="AI Model" value={model} onChange={(e) => setModel(e.target.value)}>
                            {MODELS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                          </Select>
                        </FormControl>
                      </Stack>
                      {bugFixSteps.map((step) => (
                        <StepCard
                          key={step.step_number}
                          step={step}
                          artifact={bugArtifact ?? null}
                          connId={connId}
                          model={model}
                          onSqlChange={(num, sql) => setBugSqlMap((prev) => new Map(prev).set(num, sql))}
                          approvalStatus={bugApprovalMap.get(step.step_number) ?? 'pending'}
                          onApprovalChange={(status) => setBugApprovalMap((prev) => new Map(prev).set(step.step_number, status))}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              )}

              {/* ══════════════════════════════════════
                  Navigation footer
              ══════════════════════════════════════ */}
              <Stack direction="row" justifyContent="space-between" alignItems="center" mt={3}
                sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Button variant="outlined" size="small"
                  startIcon={<ExpandLessOutlined sx={{ transform: 'rotate(-90deg)', fontSize: 16 }} />}
                  onClick={() => setBugWizardStep(p => Math.max(0, p - 1))}
                  disabled={bugWizardStep === 0}
                  sx={{ visibility: bugWizardStep === 0 ? 'hidden' : 'visible' }}>
                  Back
                </Button>

                <Typography variant="caption" color="text.disabled">
                  Step {bugWizardStep + 1} of {BUG_WIZARD_STEPS.length}
                </Typography>

                {bugWizardStep < 2 && (
                  <Button variant="contained" size="small"
                    endIcon={<ExpandMoreOutlined sx={{ transform: 'rotate(-90deg)', fontSize: 16 }} />}
                    onClick={() => setBugWizardStep(p => p + 1)}
                    disabled={bugWizardStep === 0 && !bugIssue.trim() && !bugDescription.trim()}>
                    Next
                  </Button>
                )}
                {bugWizardStep === 2 && (
                  <Button variant="contained" color="error" size="small"
                    startIcon={bugFixMut.isPending ? <CircularProgress size={13} color="inherit" /> : <BuildOutlined sx={{ fontSize: 16 }} />}
                    onClick={() => { setBugWizardStep(3); bugFixMut.mutate() }}
                    disabled={bugFixMut.isPending || !connId}>
                    {bugFixMut.isPending ? 'Generating…' : 'Generate Fix Plan'}
                  </Button>
                )}
                {bugWizardStep === 3 && !bugFixMut.isPending && (
                  <Button variant="outlined" color="error" size="small"
                    startIcon={<BuildOutlined sx={{ fontSize: 16 }} />}
                    onClick={() => bugFixMut.mutate()}
                    disabled={bugFixMut.isPending}>
                    Regenerate
                  </Button>
                )}
              </Stack>

            </Box>
          )}
          {/* ── Tab 3: Execution Log ── */}
          {mainTab === 3 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>Execution Log</Typography>
              {execLog.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
                  <PlayArrowOutlined sx={{ fontSize: 48, opacity: 0.25, mb: 1 }} />
                  <Typography variant="body2">
                    Execute steps from the SQL Plan tab to see results here.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={0.75}>
                  {execLog.map((item) => {
                    const step = planSteps.find((s) => s.step_number === item.step_number)
                    const color = item.status === 'executed'
                      ? tokens.emerald600
                      : item.status === 'error'
                      ? tokens.red600
                      : '#64748B'
                    return (
                      <Paper key={item.step_number} variant="outlined"
                        sx={{ p: 1.5, borderRadius: 1.5, borderColor: alpha(color, 0.3) }}>
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          {item.status === 'executed'
                            ? <CheckCircleOutlineOutlined sx={{ fontSize: 16, color: 'success.main' }} />
                            : <ErrorOutlineOutlined sx={{ fontSize: 16, color: 'error.main' }} />}
                          <Typography variant="body2" fontWeight={600} sx={{ color }}>
                            Step {item.step_number}: {step?.title}
                          </Typography>
                          {item.result && (
                            <Chip
                              label={`${(item.result as { total?: number }).total ?? 0} rows`}
                              size="small" variant="outlined"
                              sx={{ height: 18, fontSize: '0.625rem', ml: 'auto !important' }} />
                          )}
                        </Stack>
                        {item.error && (
                          <Typography variant="caption" color="error"
                            sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', fontSize: '0.688rem' }}>
                            {item.error}
                          </Typography>
                        )}
                      </Paper>
                    )
                  })}
                </Stack>
              )}

            </Box>
          )}

          {/* ── Tab 4: AI Traces ── */}
          {mainTab === 4 && (
            <Box>
              <AIDebugPanel connId={connId} module="development" maxHeight={600} />
            </Box>
          )}

        </Box>
        </Collapse>
      </Paper>

      {/* ── Plan History ─────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* History header row */}
        <Box
          sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' } }}
          onClick={() => setHistoryOpen((p) => !p)}
        >
          <HistoryOutlined sx={{ fontSize: 18, color: 'text.secondary', mr: 1 }} />
          <Typography variant="subtitle2" fontWeight={700}>Plan History</Typography>
          {(history as DevArtifact[]).length > 0 && (
            <Chip label={(history as DevArtifact[]).length} size="small"
              sx={{ ml: 1, height: 18, fontSize: '0.625rem' }} />
          )}
          <Box sx={{ flex: 1 }} />
          {historyOpen ? <ExpandLessOutlined sx={{ fontSize: 18 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18 }} />}
        </Box>

        <Collapse in={historyOpen}>
          {(history as DevArtifact[]).length === 0 && (
            <Box sx={{ px: 2, pb: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.disabled">No plan history yet.</Typography>
            </Box>
          )}
          {(history as DevArtifact[]).map((h) => (
            <HistoryRow
              key={h.id}
              h={h}
              active={artifactId === h.id}
              meta={planMeta[h.id]}
              onLoad={() => {
                setArtifactId(h.id)
                const steps = h.plan_json ? (() => { try { return JSON.parse(h.plan_json) } catch { return [] } })() : []
                setPlanSteps(steps)
                setReqText(h.task_description)
                setMainTab(1)
              }}
              onRerun={() => {
                rerunTextRef.current = h.task_description
                setReqText(h.task_description)
                setMainTab(1)
                planMut.mutate()
                rerunTextRef.current = null
              }}
              onDelete={() => deleteMut.mutate(h.id)}
            />
          ))}
        </Collapse>
      </Paper>

    </Box>

    {/* ── Save Plan Dialog ─────────────────────────────────────── */}
    <Dialog open={savePlanOpen} onClose={() => savePlanOpen && commitPlanMeta(pendingSaveId!, savePlanName, savePlanJira)}
      maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <HistoryOutlined sx={{ fontSize: 18, color: 'primary.main' }} />
        Save Development Plan
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1.5 }}>
        <TextField
          autoFocus
          size="small" fullWidth required
          label="Plan Name"
          placeholder="e.g. GL Reconciliation — Phase 1"
          value={savePlanName}
          onChange={(e) => setSavePlanName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && savePlanName.trim()) commitPlanMeta(pendingSaveId!, savePlanName, savePlanJira) }}
          helperText="A short name for this plan shown in history"
        />
        <TextField
          size="small" fullWidth
          label="JIRA / ADO Number (optional)"
          placeholder="e.g. PROJ-123 or #456"
          value={savePlanJira}
          onChange={(e) => setSavePlanJira(e.target.value)}
          helperText="Link this plan to a ticket for easy reference"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => commitPlanMeta(pendingSaveId!, savePlanName || 'Untitled Plan', savePlanJira)}>
          Skip
        </Button>
        <Button variant="contained"
          onClick={() => commitPlanMeta(pendingSaveId!, savePlanName, savePlanJira)}
          disabled={!savePlanName.trim()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>

    {/* ── Export AC Dialog ──────────────────────────────────────── */}
    <Dialog open={exportAcOpen} onClose={() => setExportAcOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Export Acceptance Criteria</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <FormControl size="small" fullWidth>
          <InputLabel>Destination</InputLabel>
          <Select label="Destination" value={exportDest} onChange={(e) => setExportDest(e.target.value as 'jira' | 'ado')}>
            <MenuItem value="jira">JIRA</MenuItem>
            <MenuItem value="ado">Azure DevOps</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small" fullWidth
          label={exportDest === 'jira' ? 'JIRA Project Key' : 'ADO Project Name'}
          placeholder={exportDest === 'jira' ? 'e.g. KAN' : 'e.g. MyProject'}
          value={exportProjectKey}
          onChange={(e) => setExportProjectKey(e.target.value)}
        />
        {exportDest === 'jira' && (
          <>
            <FormControl size="small" fullWidth>
              <InputLabel>Issue Type</InputLabel>
              <Select label="Issue Type" value={exportIssueType} onChange={(e) => setExportIssueType(e.target.value)}>
                <MenuItem value="Task">Task</MenuItem>
                <MenuItem value="Story">Story</MenuItem>
                <MenuItem value="Bug">Bug</MenuItem>
                <MenuItem value="Sub-task">Sub-task</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" fullWidth label="Epic Key (optional)"
              placeholder="e.g. KAN-1" value={exportEpicKey}
              onChange={(e) => setExportEpicKey(e.target.value)} />
          </>
        )}
        <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
          {criteria.length} acceptance criteria will be exported as{' '}
          {exportDest === 'jira' ? 'JIRA Stories' : 'ADO Work Items'}.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setExportAcOpen(false)}>Cancel</Button>
        <Button variant="contained"
          startIcon={exportAcMut.isPending ? <CircularProgress size={14} /> : <IosShareOutlined />}
          onClick={() => exportAcMut.mutate()}
          disabled={exportAcMut.isPending || criteria.length === 0}>
          Export
        </Button>
      </DialogActions>
    </Dialog>

    {/* ── View All SQL Dialog ───────────────────────────────────── */}
    <Dialog open={viewAllOpen} onClose={() => setViewAllOpen(false)} maxWidth="md" fullWidth
      PaperProps={{ sx: { height: '85vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CodeOutlined sx={{ fontSize: 18 }} />
          <Typography fontWeight={700}>All Generated SQL — {planSteps.length} steps</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" startIcon={<ContentCopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(buildCombinedSql(planSteps, sqlMap, artifact))
              enqueueSnackbar('Copied to clipboard', { variant: 'success' })
            }}>
            Copy
          </Button>
          <Button size="small" variant="outlined" startIcon={<FileDownloadOutlined />} onClick={handleDownloadAll}>
            Download .sql
          </Button>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TextField
          multiline fullWidth
          value={buildCombinedSql(planSteps, sqlMap, artifact) || '-- No SQL generated yet'}
          InputProps={{
            readOnly: true,
            sx: {
              fontFamily: 'monospace', fontSize: '0.78rem', height: '100%',
              alignItems: 'flex-start',
              '& textarea': { height: '100% !important', overflow: 'auto !important' },
            },
          }}
          sx={{ flex: 1, '& .MuiOutlinedInput-root': { height: '100%', borderRadius: 0, border: 'none' }, '& fieldset': { border: 'none' } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setViewAllOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>

    {/* ── Git Check-in Dialog ───────────────────────────────────── */}
    <Dialog open={gitOpen} onClose={() => setGitOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>Git Check-in — Push SQL to GitHub</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <TextField size="small" fullWidth required label="Repository (owner/repo)"
          placeholder="e.g. myorg/myrepo" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} />
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth label="Branch" placeholder="main"
            value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
          <TextField size="small" fullWidth label="Path prefix" placeholder="sql/"
            value={gitPath} onChange={(e) => setGitPath(e.target.value)} />
        </Stack>
        <TextField size="small" fullWidth required label="GitHub Personal Access Token"
          type="password" value={gitToken} onChange={(e) => setGitToken(e.target.value)}
          helperText="Needs repo write access" />
        <TextField size="small" fullWidth label="Commit Message (optional)"
          value={gitMessage} onChange={(e) => setGitMessage(e.target.value)}
          placeholder="feat: add generated SQL scripts" />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setGitOpen(false)}>Cancel</Button>
        <Button variant="contained" color="secondary"
          startIcon={gitCheckinMut.isPending ? <CircularProgress size={14} /> : <CloudUploadOutlined />}
          onClick={() => gitCheckinMut.mutate()}
          disabled={gitCheckinMut.isPending || !gitRepo || !gitToken}>
          Push to GitHub
        </Button>
      </DialogActions>
    </Dialog>

    {/* ── Generate All Dialog ───────────────────────────────────── */}
    <Dialog open={genAllOpen} onClose={() => setGenAllOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AllInclusiveOutlined sx={{ fontSize: 20 }} />
        Generate All SQL
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Alert severity="info" sx={{ fontSize: '0.813rem' }}>
          AI will generate SQL for all {planSteps.length} steps in dependency order.
        </Alert>
        <TextField
          multiline minRows={3} maxRows={8} fullWidth size="small"
          label="Additional Instructions (optional)"
          placeholder={
            'e.g. "Use staging schema prefix for all source tables"\n' +
            '"Add TRY_CAST for nullable numeric columns"'
          }
          value={genAllInstructions}
          onChange={(e) => setGenAllInstructions(e.target.value)}
          helperText="Appended to every step's description before generation."
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">Model:</Typography>
          <Chip label={model} size="small" variant="outlined" sx={{ fontSize: '0.688rem' }} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setGenAllOpen(false)}>Cancel</Button>
        <Button variant="contained"
          startIcon={genAllMut.isPending ? <CircularProgress size={14} /> : <AllInclusiveOutlined />}
          onClick={() => { setGenAllOpen(false); genAllMut.mutate() }}
          disabled={genAllMut.isPending}>
          Generate All
        </Button>
      </DialogActions>
    </Dialog>

    {/* ── Pipeline Confirmation Dialog ──────────────────────────── */}
    {(() => {
      const approvedCount = approvedStepNumbers.length
      const rejectedCount = planSteps.filter((s) => (approvalMap.get(s.step_number) ?? 'pending') === 'rejected').length
      const pendingCount  = planSteps.length - approvedCount - rejectedCount
      const runAll = approvedCount === 0
      return (
        <Dialog open={confirmPipelineOpen} onClose={() => setConfirmPipelineOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HowToVoteOutlined sx={{ fontSize: 20, color: 'success.main' }} /> Run Pipeline
          </DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            {runAll ? (
              <Alert severity="info" sx={{ fontSize: '0.813rem' }}>
                No steps approved — <strong>all {planSteps.length} steps</strong> will execute.
              </Alert>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Chip icon={<ThumbUpOutlined sx={{ fontSize: 14 }} />}
                    label={`${approvedCount} approved`} size="small" color="success" variant="outlined" />
                  {rejectedCount > 0 && (
                    <Chip icon={<ThumbDownOutlined sx={{ fontSize: 14 }} />}
                      label={`${rejectedCount} rejected`} size="small" color="error" variant="outlined" />
                  )}
                  {pendingCount > 0 && (
                    <Chip label={`${pendingCount} pending`} size="small" variant="outlined" />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Only <strong>{approvedCount}</strong> approved step{approvedCount !== 1 ? 's' : ''} will run.
                </Typography>
              </Box>
            )}
            <Alert severity="warning" sx={{ fontSize: '0.75rem' }}>
              SQL will execute against the active database. This cannot be undone.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmPipelineOpen(false)}>Cancel</Button>
            <Button variant="contained" color="success"
              startIcon={pipelineMut.isPending ? <CircularProgress size={14} /> : <PlayArrowOutlined />}
              onClick={() => pipelineMut.mutate()}
              disabled={pipelineMut.isPending}>
              {runAll ? `Run All ${planSteps.length} Steps` : `Run ${approvedCount} Approved`}
            </Button>
          </DialogActions>
        </Dialog>
      )
    })()}

    {/* ── Bug Version History Dialog ────────────────────────────── */}
    <Dialog open={bugVersionOpen} onClose={() => setBugVersionOpen(false)} maxWidth="md" fullWidth
      PaperProps={{ sx: { maxHeight: '80vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <HistoryOutlined sx={{ fontSize: 18, color: 'warning.main' }} />
        <Typography fontWeight={700}>Bug Fix Version History</Typography>
        <Chip label={`${bugVersions.length} version${bugVersions.length !== 1 ? 's' : ''}`}
          size="small" color="warning" sx={{ ml: 0.5 }} />
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {bugVersions.slice().reverse().map((v) => (
          <Box key={v.version} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            {/* Version header */}
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1,
              bgcolor: alpha(tokens.amber500, 0.04) }}>
              <Chip label={`v${v.version}`} size="small"
                sx={{ height: 20, fontSize: '0.625rem', fontWeight: 800,
                  bgcolor: alpha(tokens.amber500, 0.15), color: tokens.amber600, border: 'none' }} />
              {v.bug_key !== 'manual' && (
                <Chip label={v.bug_key} size="small" variant="outlined"
                  sx={{ height: 18, fontSize: '0.625rem' }} />
              )}
              <Typography variant="caption" color="text.secondary">
                {new Date(v.timestamp).toLocaleString()}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="outlined"
                onClick={() => {
                  setBugDescription(v.bug_description)
                  setBugBeforeSql(v.before_sql)
                  setBugVersionOpen(false)
                }}>
                Restore
              </Button>
            </Box>

            {/* Before / After columns */}
            <Stack direction="row" sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              {/* BEFORE */}
              <Box sx={{ flex: 1, p: 1.5, borderRight: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" alignItems="center" spacing={0.5} mb={0.75}>
                  <Chip label="BEFORE" size="small"
                    sx={{ height: 16, fontSize: '0.5rem', fontWeight: 800,
                      bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600, border: 'none' }} />
                  <Typography variant="caption" color="text.secondary">Broken SQL / Bug</Typography>
                </Stack>
                {v.before_sql ? (
                  <Box component="pre" sx={{
                    m: 0, p: 1, borderRadius: 1, fontSize: '0.7rem', lineHeight: 1.5,
                    bgcolor: alpha(tokens.red600, 0.04), fontFamily: 'monospace',
                    overflow: 'auto', maxHeight: 140, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {v.before_sql}
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.disabled" display="block" sx={{ p: 1 }}>
                    <em>No SQL snapshot captured</em>
                  </Typography>
                )}
                {v.bug_description && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}
                    title={v.bug_description}>
                    {v.bug_description.slice(0, 100)}{v.bug_description.length > 100 ? '…' : ''}
                  </Typography>
                )}
              </Box>

              {/* AFTER */}
              <Box sx={{ flex: 1, p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={0.5} mb={0.75}>
                  <Chip label="AFTER" size="small"
                    sx={{ height: 16, fontSize: '0.5rem', fontWeight: 800,
                      bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600, border: 'none' }} />
                  <Typography variant="caption" color="text.secondary">Fix Plan</Typography>
                  <Chip label={`${v.fix_step_titles.length} steps`} size="small"
                    sx={{ height: 14, fontSize: '0.5rem' }} />
                </Stack>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {v.fix_step_titles.map((title, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <CheckCircleOutlineOutlined sx={{ fontSize: 12, color: tokens.emerald600 }} />
                      <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>{title}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Stack>
          </Box>
        ))}
        {bugVersions.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>
            <Typography variant="body2">No versions yet — analyze a bug to create the first version.</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setBugVersionOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>

    </>
  )
}
