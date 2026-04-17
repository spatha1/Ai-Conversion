/**
 * Development Intelligence Page
 *
 * Single unified page combining:
 * - Requirements input (Free Text / JIRA / Azure DevOps)
 * - AI analysis → Acceptance Criteria (Given/When/Then)
 * - SQL Development Plan generation + step-by-step execution
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
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { developmentApi, integrationsApi } from '@/api'
import type { IntegrationConfig } from '@/api'
import AIDebugPanel from '@/components/ai/AIDebugPanel'
import { tokens } from '@/theme/theme'
import type { PlanStep, DevArtifactItem, DevArtifact, SQLValidationResult, BRDCriterion } from '@/types'

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

// ── Step Card ─────────────────────────────────────────────────────────────────

function StepCard({
  step, artifact, connId, model, onSqlChange,
}: {
  step: PlanStep
  artifact: DevArtifact | null
  connId: number
  model: string
  onSqlChange: (stepNum: number, sql: string) => void
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

  // Sync sql state when artifact data updates (e.g. after Generate All)
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

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 1.5 }}>
      {/* Header */}
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

        {/* SQL Editor */}
        <TextField
          multiline minRows={3}
          fullWidth size="small"
          placeholder="Click Generate SQL to create the query…"
          value={sql}
          onChange={(e) => { setSql(e.target.value); onSqlChange(step.step_number, e.target.value); setValidation(null) }}
          sx={{ mb: 1, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
        />

        {/* Validation result */}
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

        {/* AI Explanation */}
        <Collapse in={showExplain && !!explanation}>
          <Alert severity="info" sx={{ mb: 1, fontSize: '0.75rem' }}>{explanation}</Alert>
        </Collapse>

        {/* Action bar */}
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

  // Source type: 'text' | 'jira' | 'ado'
  const [sourceType, setSourceType] = useState<'text' | 'jira' | 'ado'>('text')

  // Free text BRD
  const [reqText, setReqText] = useState('')

  // Issue/work-item identifier (JIRA key or ADO ID)
  const [jiraKey, setJiraKey]   = useState('')
  const [adoWiId, setAdoWiId]   = useState('')

  // Configured integrations from Admin
  const { data: integrations = [] } = useQuery<IntegrationConfig[]>({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
    staleTime: 60_000,
  })
  const jiraConfigured = integrations.some((i) => i.type === 'jira' && i.has_token)
  const adoConfigured  = integrations.some((i) => i.type === 'ado' && i.has_token)

  // Model & results
  const [model, setModel]         = useState('gpt-4o-mini')
  const [criteria, setCriteria]   = useState<BRDCriterion[]>([])
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([])
  const [artifactId, setArtifactId] = useState<number | null>(null)

  // SQL states per step
  const [sqlMap, setSqlMap]     = useState<Map<number, string>>(new Map())

  // UI state
  const [debugOpen, setDebugOpen]       = useState(false)
  const [historyOpen, setHistoryOpen]   = useState(false)
  const [activeSection, setActiveSection] = useState<'ac' | 'plan'>('ac')

  // Validation SQL run states for AC
  const [acSqlMap, setAcSqlMap]         = useState<Record<number, string>>({})
  const [acResults, setAcResults]       = useState<Record<number, { rows: unknown[]; columns: string[] }>>({})

  const { data: artifact } = useQuery({
    queryKey: ['dev-artifact', artifactId],
    queryFn:  () => developmentApi.getArtifact(artifactId!),
    enabled:  artifactId != null,
    refetchInterval: (q) => q.state.data?.status === 'running' ? 2000 : false,
  })

  // Auto-select artifact when navigated from Agents artefact card
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

  // When artifact loads (via useQuery), populate planSteps and switch to plan view
  useEffect(() => {
    if (artifact && artifact.id === artifactId && artifact.plan_json) {
      try {
        const steps = JSON.parse(artifact.plan_json)
        if (steps.length > 0) {
          setPlanSteps(steps)
          if (artifact.task_description) setReqText(artifact.task_description)
          setActiveSection('plan')
        }
      } catch { /* ignore */ }
    }
  }, [artifact]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: history = [] } = useQuery({
    queryKey: ['dev-history', connId],
    queryFn:  () => developmentApi.history(connId!),
    enabled:  connId != null && historyOpen,
  })

  // ── Fetch from JIRA / ADO ──────────────────────────────────
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

  // ── Analyze → AC ──────────────────────────────────────────
  const analyzeMut = useMutation({
    mutationFn: () => developmentApi.analyzeBrd(connId!, reqText, model),
    onSuccess: (res) => {
      setCriteria(res.criteria)
      setActiveSection('ac')
      enqueueSnackbar(res.summary, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Analysis failed', { variant: 'error' }),
  })

  // ── Plan → SQL steps ──────────────────────────────────────
  const planMut = useMutation({
    mutationFn: () => developmentApi.plan(connId!, reqText, model),
    onSuccess: (res) => {
      setArtifactId(res.artifact_id)
      setPlanSteps(res.steps)
      setActiveSection('plan')
      enqueueSnackbar(`Plan generated: ${res.steps.length} steps`, { variant: 'success' })
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Plan generation failed', { variant: 'error' }),
  })

  // ── Analyze & Plan (both) ────────────────────────────────
  const analyzeAndPlan = async () => {
    if (!connId || !reqText.trim()) return
    analyzeMut.mutate()
    planMut.mutate()
  }

  const pipelineMut = useMutation({
    mutationFn: () => developmentApi.runPipeline(artifactId!),
    onSuccess: () => {
      enqueueSnackbar('Pipeline completed', { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['dev-artifact', artifactId] })
    },
    onError: () => enqueueSnackbar('Pipeline failed', { variant: 'error' }),
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

  // ── Generate All / Validate All ───────────────────────────────
  const genAllMut = useMutation({
    mutationFn: () => developmentApi.generateAll(artifactId!, model),
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
      enqueueSnackbar(res.all_passed ? 'All steps passed validation' : 'Some steps have validation errors', {
        variant: res.all_passed ? 'success' : 'warning',
      })
    },
    onError: () => enqueueSnackbar('Validate All failed', { variant: 'error' }),
  })

  const [valAllResults, setValAllResults] = useState<
    { step_number: number; passed: boolean; errors: string[]; warnings: string[] }[]
  >([])

  // ── Export AC to JIRA/ADO ─────────────────────────────────────
  const [exportAcOpen, setExportAcOpen] = useState(false)
  const [exportDest, setExportDest] = useState<'jira' | 'ado'>('jira')
  const [exportProjectKey, setExportProjectKey] = useState('')
  const [exportEpicKey, setExportEpicKey] = useState('')
  const [exportIssueType, setExportIssueType] = useState('Task')

  const exportAcMut = useMutation({
    mutationFn: () => developmentApi.exportAc({
      criteria,
      destination: exportDest,
      project_key: exportProjectKey || undefined,
      epic_key: exportEpicKey || undefined,
      story_type: exportIssueType,
    }),
    onSuccess: (res) => {
      if (res.errors.length > 0) {
        enqueueSnackbar(`Exported ${res.created} item(s) to ${exportDest.toUpperCase()} — ${res.errors.length} failed: ${res.errors[0]}`, {
          variant: 'warning',
          autoHideDuration: 8000,
        })
      } else {
        enqueueSnackbar(`Exported ${res.created} item(s) to ${exportDest.toUpperCase()} successfully`, { variant: 'success' })
      }
      setExportAcOpen(false)
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Export failed', { variant: 'error', autoHideDuration: 8000 }),
  })

  // ── Git Check-in ──────────────────────────────────────────────
  const [gitOpen, setGitOpen] = useState(false)
  const [gitRepo, setGitRepo] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitPath, setGitPath] = useState('sql/')
  const [gitToken, setGitToken] = useState('')
  const [gitMessage, setGitMessage] = useState('')

  const gitCheckinMut = useMutation({
    mutationFn: () => developmentApi.gitCheckin({
      artifact_id: artifactId ?? undefined,
      repo: gitRepo,
      branch: gitBranch || undefined,
      path: gitPath || undefined,
      token: gitToken,
      message: gitMessage || undefined,
    }),
    onSuccess: (res) => {
      enqueueSnackbar(`Committed ${res.committed} file(s) to GitHub`, {
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
    <Box sx={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── Left Panel — Requirements Input ──────────────────── */}
      <Box sx={{
        width: 340, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={700}>Requirements Source</Typography>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Source selector */}
          <ToggleButtonGroup
            value={sourceType}
            exclusive
            onChange={(_, v) => v && setSourceType(v)}
            size="small"
            fullWidth
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

          {/* JIRA config */}
          {sourceType === 'jira' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {jiraConfigured ? (
                <Chip icon={<VerifiedOutlined />} label="JIRA configured in Admin" color="success" size="small" variant="outlined" />
              ) : (
                <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                  JIRA not configured. Go to <strong>Admin → Integrations</strong> to set it up.
                </Alert>
              )}
              <TextField label="Issue / Task Key" size="small" fullWidth
                placeholder="PROJ-123 or numeric ID"
                value={jiraKey} onChange={(e) => setJiraKey(e.target.value)} />
              <Button variant="outlined" size="small" fullWidth
                startIcon={fetchMut.isPending ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
                onClick={() => fetchMut.mutate()}
                disabled={fetchMut.isPending || !jiraKey || !jiraConfigured}
              >
                Fetch Item
              </Button>
            </Box>
          )}

          {/* ADO config */}
          {sourceType === 'ado' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {adoConfigured ? (
                <Chip icon={<VerifiedOutlined />} label="Azure DevOps configured in Admin" color="success" size="small" variant="outlined" />
              ) : (
                <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                  ADO not configured. Go to <strong>Admin → Integrations</strong> to set it up.
                </Alert>
              )}
              <TextField label="Work Item ID" size="small" fullWidth
                placeholder="456"
                value={adoWiId} onChange={(e) => setAdoWiId(e.target.value)} />
              <Button variant="outlined" size="small" fullWidth
                startIcon={fetchMut.isPending ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
                onClick={() => fetchMut.mutate()}
                disabled={fetchMut.isPending || !adoWiId || !adoConfigured}
              >
                Fetch Work Item
              </Button>
            </Box>
          )}

          {/* Requirements textarea — always visible */}
          <TextField
            multiline minRows={sourceType === 'text' ? 10 : 6}
            fullWidth size="small"
            label={sourceType === 'text' ? 'BRD / Requirements' : 'Fetched Requirements (editable)'}
            placeholder={
              sourceType === 'text'
                ? 'Paste your BRD, user stories, or requirements here…\n\nExample:\n- Show department-wise employee count\n- Highlight departments with above-average salary\n- Create monthly salary trend report'
                : 'Click "Fetch" above to load from JIRA or ADO, or type here…'
            }
            value={reqText}
            onChange={(e) => setReqText(e.target.value)}
          />

          {/* Model selector */}
          <FormControl fullWidth size="small">
            <InputLabel>AI Model</InputLabel>
            <Select label="AI Model" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Action buttons */}
          <Button
            fullWidth variant="contained"
            startIcon={isBusy ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
            onClick={analyzeAndPlan}
            disabled={isBusy || !reqText.trim()}
          >
            {isBusy ? 'Analyzing & Planning…' : 'Analyze & Plan'}
          </Button>

          <Stack direction="row" spacing={1}>
            <Button
              size="small" variant="outlined" sx={{ flex: 1 }}
              startIcon={analyzeMut.isPending ? <CircularProgress size={11} /> : <AssignmentOutlined />}
              onClick={() => analyzeMut.mutate()}
              disabled={isBusy || !reqText.trim()}
            >
              AC Only
            </Button>
            <Button
              size="small" variant="outlined" sx={{ flex: 1 }}
              startIcon={planMut.isPending ? <CircularProgress size={11} /> : <CodeOutlined />}
              onClick={() => planMut.mutate()}
              disabled={isBusy || !reqText.trim()}
            >
              Plan Only
            </Button>
          </Stack>

          {/* History toggle */}
          <Divider />
          <Button fullWidth size="small" variant="text"
            startIcon={<HistoryOutlined />}
            onClick={() => setHistoryOpen((p) => !p)}
            endIcon={historyOpen ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            sx={{ justifyContent: 'flex-start', fontSize: '0.75rem' }}
          >
            Plan History
          </Button>
          <Collapse in={historyOpen}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {history.length === 0 && <Typography variant="caption" color="text.disabled">No history</Typography>}
              {(history as DevArtifact[]).map((h) => (
                <Paper key={h.id} variant="outlined" sx={{
                  p: 1, borderRadius: 1.5, cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                  ...(artifactId === h.id ? { borderColor: 'primary.main' } : {}),
                }} onClick={() => {
                  setArtifactId(h.id)
                  const steps = h.plan_json ? JSON.parse(h.plan_json) : []
                  setPlanSteps(steps)
                  setReqText(h.task_description)
                }}>
                  <Typography variant="caption" fontWeight={600} noWrap display="block">
                    {h.task_description.slice(0, 50)}…
                  </Typography>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Chip label={h.status} size="small" sx={{ height: 16, fontSize: '0.563rem' }} />
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(h.id) }}>
                      <DeleteOutlined sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Stack>
                </Paper>
              ))}
            </Box>
          </Collapse>
        </Box>
      </Box>

      {/* ── Center Panel — Analysis Results ──────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Section tabs */}
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2, flexShrink: 0 }}>
          <Tabs value={activeSection} onChange={(_, v) => setActiveSection(v)} sx={{ minHeight: 44 }}>
            <Tab value="ac" icon={<AssignmentOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label={`Acceptance Criteria${criteria.length > 0 ? ` (${criteria.length})` : ''}`}
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
            <Tab value="plan" icon={<CodeOutlined sx={{ fontSize: 15 }} />} iconPosition="start"
              label={`SQL Plan${planSteps.length > 0 ? ` (${planSteps.length} steps)` : ''}`}
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.813rem' }} />
          </Tabs>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>

          {/* ── Acceptance Criteria ── */}
          {activeSection === 'ac' && (
            criteria.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled' }}>
                <AssignmentOutlined sx={{ fontSize: 64, opacity: 0.3 }} />
                <Typography variant="h6" color="text.secondary" fontWeight={500}>
                  {isBusy ? 'Analyzing requirements…' : 'No acceptance criteria yet'}
                </Typography>
                {isBusy && <CircularProgress size={24} />}
                {!isBusy && (
                  <Typography variant="body2" color="text.disabled" textAlign="center" sx={{ maxWidth: 400 }}>
                    Enter requirements in the left panel (free text, JIRA, or Azure DevOps) and click "Analyze &amp; Plan"
                  </Typography>
                )}
              </Box>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" fontWeight={700}>Acceptance Criteria</Typography>
                  <Chip label={criteria.length} size="small" color="primary" />
                  <Box sx={{ flex: 1 }} />
                  {/* Priority summary */}
                  {(['high','medium','low'] as const).map((p) => {
                    const cnt = criteria.filter((c) => c.priority === p).length
                    return cnt > 0 ? (
                      <Chip key={p} label={`${p}: ${cnt}`} size="small"
                        sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700,
                          bgcolor: alpha(PRIORITY_COLORS[p], 0.1), color: PRIORITY_COLORS[p] }} />
                    ) : null
                  })}
                  <Button size="small" variant="outlined" onClick={exportCriteria}>Export JSON</Button>
                  <Tooltip title="Export AC as JIRA Stories or Azure DevOps Work Items">
                    <Button size="small" variant="outlined" color="secondary"
                      startIcon={<IosShareOutlined sx={{ fontSize: 14 }} />}
                      onClick={() => setExportAcOpen(true)}
                    >
                      Export to JIRA / ADO
                    </Button>
                  </Tooltip>
                </Box>

                {criteria.map((c) => (
                  <Accordion key={c.id} disableGutters elevation={0}
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

          {/* ── SQL Plan ── */}
          {activeSection === 'plan' && (
            planSteps.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled' }}>
                <CodeOutlined sx={{ fontSize: 64, opacity: 0.3 }} />
                <Typography variant="h6" color="text.secondary" fontWeight={500}>
                  {isBusy ? 'Generating plan…' : 'No SQL plan yet'}
                </Typography>
                {isBusy && <CircularProgress size={24} />}
                {!isBusy && (
                  <Typography variant="body2" color="text.disabled" textAlign="center" sx={{ maxWidth: 400 }}>
                    Enter requirements and click "Analyze &amp; Plan" or "Plan Only"
                  </Typography>
                )}
              </Box>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" fontWeight={700}>SQL Development Plan</Typography>
                  <Chip label={`${planSteps.length} steps`} size="small" color="primary" />
                  <Box sx={{ flex: 1 }} />
                  {artifactId && (
                    <>
                      <Tooltip title="Generate SQL for all steps sequentially">
                        <Button size="small" variant="outlined"
                          startIcon={genAllMut.isPending ? <CircularProgress size={12} /> : <AllInclusiveOutlined />}
                          onClick={() => genAllMut.mutate()}
                          disabled={genAllMut.isPending || valAllMut.isPending || pipelineMut.isPending}
                        >
                          Generate All
                        </Button>
                      </Tooltip>
                      <Tooltip title="Validate all generated SQL steps">
                        <Button size="small" variant="outlined" color="warning"
                          startIcon={valAllMut.isPending ? <CircularProgress size={12} /> : <FactCheckOutlined />}
                          onClick={() => valAllMut.mutate()}
                          disabled={genAllMut.isPending || valAllMut.isPending || pipelineMut.isPending}
                        >
                          Validate All
                        </Button>
                      </Tooltip>
                      <Tooltip title="Push generated SQL scripts to GitHub">
                        <Button size="small" variant="outlined" color="secondary"
                          startIcon={<CloudUploadOutlined />}
                          onClick={() => setGitOpen(true)}
                        >
                          Git Check-in
                        </Button>
                      </Tooltip>
                      <Button size="small" variant="outlined" color="success"
                        startIcon={pipelineMut.isPending ? <CircularProgress size={12} /> : <PlayArrowOutlined />}
                        onClick={() => pipelineMut.mutate()}
                        disabled={pipelineMut.isPending || genAllMut.isPending}
                      >
                        Run Pipeline
                      </Button>
                    </>
                  )}
                </Box>

                {/* Validate All results banner */}
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
                  />
                ))}
              </Box>
            )
          )}
        </Box>
      </Box>

      {/* ── Right Panel — Execution Log + Debug ──────────────── */}
      <Box sx={{
        width: 300, flexShrink: 0, borderLeft: '1px solid', borderColor: 'divider',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={700}>Execution Log</Typography>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5 }}>
          {execLog.length === 0 ? (
            <Typography variant="caption" color="text.disabled">
              Execute steps from the Plan tab to see results here.
            </Typography>
          ) : (
            execLog.map((item) => {
              const step = planSteps.find((s) => s.step_number === item.step_number)
              const color = item.status === 'executed'
                ? tokens.emerald600
                : item.status === 'error'
                ? tokens.red600
                : tokens.slate500 ?? '#64748B'
              return (
                <Paper key={item.step_number} variant="outlined" sx={{ p: 1, borderRadius: 1.5, mb: 0.75, borderColor: alpha(color, 0.3) }}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    {item.status === 'executed'
                      ? <CheckCircleOutlineOutlined sx={{ fontSize: 14, color: 'success.main' }} />
                      : <ErrorOutlineOutlined sx={{ fontSize: 14, color: 'error.main' }} />}
                    <Typography variant="caption" fontWeight={600} sx={{ color }}>
                      Step {item.step_number}: {step?.title}
                    </Typography>
                  </Stack>
                  {item.error && (
                    <Typography variant="caption" color="error"
                      sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', fontSize: '0.688rem' }}>
                      {item.error}
                    </Typography>
                  )}
                  {item.result && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {(item.result as { total?: number }).total} rows
                    </Typography>
                  )}
                </Paper>
              )
            })
          )}
        </Box>

        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Button fullWidth size="small" variant="text"
            startIcon={<BugReportOutlined />}
            onClick={() => setDebugOpen((p) => !p)}
            endIcon={debugOpen ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            sx={{ justifyContent: 'flex-start', fontSize: '0.75rem' }}
          >
            AI Debug
          </Button>
          <Collapse in={debugOpen}>
            <Box sx={{ mt: 1 }}>
              <AIDebugPanel connId={connId} module="development" maxHeight={250} />
            </Box>
          </Collapse>
        </Box>
      </Box>

    </Box>

    {/* ── Export AC Dialog ─────────────────────────────────────── */}
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
          placeholder={exportDest === 'jira' ? 'e.g. KAN (from KAN-4 in your board URL)' : 'e.g. MyProject'}
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
            <TextField size="small" fullWidth
              label="Epic Key (optional)"
              placeholder="e.g. KAN-1"
              value={exportEpicKey}
              onChange={(e) => setExportEpicKey(e.target.value)}
            />
          </>
        )}
        <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
          {criteria.length} acceptance criteria will be exported as{' '}
          {exportDest === 'jira' ? 'JIRA Stories' : 'ADO Work Items'}.
          Ensure <strong>Admin → Integrations</strong> is configured.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setExportAcOpen(false)}>Cancel</Button>
        <Button variant="contained"
          startIcon={exportAcMut.isPending ? <CircularProgress size={14} /> : <IosShareOutlined />}
          onClick={() => exportAcMut.mutate()}
          disabled={exportAcMut.isPending || criteria.length === 0}
        >
          Export
        </Button>
      </DialogActions>
    </Dialog>

    {/* ── Git Check-in Dialog ──────────────────────────────────── */}
    <Dialog open={gitOpen} onClose={() => setGitOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>Git Check-in — Push SQL to GitHub</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <TextField size="small" fullWidth required
          label="Repository (owner/repo)"
          placeholder="e.g. myorg/myrepo"
          value={gitRepo}
          onChange={(e) => setGitRepo(e.target.value)}
        />
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth
            label="Branch"
            placeholder="main"
            value={gitBranch}
            onChange={(e) => setGitBranch(e.target.value)}
          />
          <TextField size="small" fullWidth
            label="Path prefix"
            placeholder="sql/"
            value={gitPath}
            onChange={(e) => setGitPath(e.target.value)}
          />
        </Stack>
        <TextField size="small" fullWidth required
          label="GitHub Personal Access Token"
          type="password"
          value={gitToken}
          onChange={(e) => setGitToken(e.target.value)}
          helperText="Needs repo write access"
        />
        <TextField size="small" fullWidth
          label="Commit Message (optional)"
          value={gitMessage}
          onChange={(e) => setGitMessage(e.target.value)}
          placeholder="feat: add generated SQL scripts"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setGitOpen(false)}>Cancel</Button>
        <Button variant="contained" color="secondary"
          startIcon={gitCheckinMut.isPending ? <CircularProgress size={14} /> : <CloudUploadOutlined />}
          onClick={() => gitCheckinMut.mutate()}
          disabled={gitCheckinMut.isPending || !gitRepo || !gitToken}
        >
          Push to GitHub
        </Button>
      </DialogActions>
    </Dialog>

    </>
  )
}
