import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Box, Typography, TextField, Button, Select, MenuItem,
  FormControl, CircularProgress, IconButton, Collapse, Chip,
  Drawer, List, ListItem, ListItemText, ListItemButton, Tooltip, Alert, Snackbar,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import PlayArrowIcon     from '@mui/icons-material/PlayArrow'
import ExpandLessIcon    from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon    from '@mui/icons-material/ExpandMore'
import HistoryIcon       from '@mui/icons-material/History'
import StorageIcon       from '@mui/icons-material/Storage'
import PsychologyIcon    from '@mui/icons-material/Psychology'
import RefreshIcon       from '@mui/icons-material/Refresh'
import AutoAwesomeIcon   from '@mui/icons-material/AutoAwesome'

import KPIBar             from './components/KPIBar'
import PipelinePanel      from './components/PipelinePanel'
import ReasoningStream, { ReasoningLine } from './components/ReasoningStream'
import ImpactGraph        from './components/ImpactGraph'
import ActionCenter       from './components/ActionCenter'
import AgentDetailDrawer  from './components/AgentDetailDrawer'
import SprintMiniPanel    from './components/SprintMiniPanel'
import SAIReport          from './SAIReport'

import {
  SaiMode, SaiFinding, SaiAction, SaiApprovalItem,
  SaiReport as SaiReportType, SaiKnowledgeSource,
  SaiRunSummary, SaiStepStatus, SaiAiTrace, SaiQueryUsed, SaiStep,
  DevTaskSummary,
} from '@/types'
import { saiApi, devOpsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'


interface AgentState {
  agent:      string
  status:     SaiStepStatus
  elapsed_ms?: number
}

export default function SAIPage() {
  const activeProject    = useAppStore((s) => s.activeProject)
  const activeConnection = useAppStore((s) => s.activeConnection)

  // Run state
  const [requestText, setRequestText]     = useState('Collect B&C data and analyze issues')
  const [mode, setMode]                   = useState<SaiMode>('assisted')
  const [isStreaming, setIsStreaming]      = useState(false)
  const [currentRunId, setCurrentRunId]   = useState<number | null>(null)

  // Pipeline state
  const [agentStates, setAgentStates]     = useState<Record<string, AgentState>>({})
  const [reasoningLines, setReasoningLines] = useState<ReasoningLine[]>([])
  const [knowledgeSources, setKnowledgeSources] = useState<SaiKnowledgeSource[]>([])
  const [findings, setFindings]           = useState<SaiFinding[]>([])
  const [systems, setSystems]             = useState<string[]>([])
  const [actions, setActions]             = useState<SaiAction[]>([])
  const [approvalItems, setApprovalItems] = useState<SaiApprovalItem[]>([])
  const [report, setReport]               = useState<SaiReportType | null>(null)
  const [queriesUsed, setQueriesUsed]     = useState<SaiQueryUsed[]>([])
  const [aiTraces, setAiTraces]           = useState<SaiAiTrace[]>([])
  const [steps, setSteps]                 = useState<SaiStep[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  // UI state
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [historyOpen, setHistoryOpen]     = useState(false)
  const [queriesOpen, setQueriesOpen]     = useState(false)
  const [tracesOpen, setTracesOpen]       = useState(false)
  const [snackbar, setSnackbar]           = useState<{ open: boolean; message: string }>({ open: false, message: '' })

  // Dev Ops domain
  const [devOpsMode, setDevOpsMode]       = useState<'data_ops' | 'dev_ops'>('data_ops')
  const [isSyncing, setIsSyncing]         = useState(false)
  const [sprintSummary, setSprintSummary] = useState<DevTaskSummary | null>(null)

  // History
  const [runs, setRuns]                   = useState<SaiRunSummary[]>([])

  const readerRef = useRef<ReadableStreamDefaultReader | null>(null)

  // Load runs on mount + whenever history drawer opens
  useEffect(() => { loadRuns() }, [])
  useEffect(() => { if (historyOpen) loadRuns() }, [historyOpen])

  const handleSync = async () => {
    if (!activeProject) return
    setIsSyncing(true)
    try {
      const r = await devOpsApi.sync(activeProject.id)
      setSnackbar({ open: true, message: `Synced ${r.synced} tasks from ${r.sources.join(', ')}` })
      const s = await devOpsApi.getSummary(activeProject.id)
      setSprintSummary(s)
    } catch {
      setSnackbar({ open: true, message: 'Sync failed — check JIRA/ADO credentials in Admin > Integrations' })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleRun = useCallback(async () => {
    if (isStreaming || !activeProject) return

    setAgentStates({})
    setReasoningLines([])
    setKnowledgeSources([])
    setFindings([])
    setSystems([])
    setActions([])
    setApprovalItems([])
    setReport(null)
    setQueriesUsed([])
    setAiTraces([])
    setSteps([])
    setReasoningOpen(true)
    setIsStreaming(true)

    try {
      const effectiveRequest = devOpsMode === 'dev_ops'
        ? `[Developer Ops] ${requestText}`
        : requestText
      const resp = await saiApi.runFetch(
        effectiveRequest,
        mode as import('@/types').SaiMode,
        activeProject?.id,
        activeConnection ? [activeConnection.id] : undefined,
      )

      if (!resp.body) throw new Error('No response body')
      const reader = resp.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const chunk of lines) {
          const dataLine = chunk.split('\n').find(l => l.startsWith('data:'))
          if (!dataLine) continue
          try {
            const evt = JSON.parse(dataLine.slice(5).trim())
            handleSSEEvent(evt)
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      console.error('SAI run error:', err)
    } finally {
      setIsStreaming(false)
      loadRuns()
    }
  }, [requestText, mode, isStreaming, activeProject, activeConnection])

  const handleSSEEvent = useCallback((evt: Record<string, unknown>) => {
    const type = evt.type as string

    if (type === 'step') {
      const agent = evt.agent as string
      setAgentStates(prev => ({
        ...prev,
        [agent]: { agent, status: evt.status as SaiStepStatus, elapsed_ms: evt.elapsed_ms as number },
      }))
    }

    if (type === 'reasoning') {
      setReasoningLines(prev => [...prev, { agent: evt.agent as string, text: evt.text as string, ts: Date.now() }])
    }

    if (type === 'knowledge') {
      const sources = evt.sources as SaiKnowledgeSource[]
      setKnowledgeSources(prev => {
        const seen = new Set(prev.map(s => s.title))
        return [...prev, ...sources.filter(s => !seen.has(s.title))]
      })
    }

    if (type === 'query_used') {
      setQueriesUsed(prev => [...prev, evt as unknown as SaiQueryUsed])
    }

    if (type === 'finding') {
      const f: SaiFinding = {
        issue_type:      evt.issue_type as string,
        severity:        evt.severity as SaiFinding['severity'],
        system_impacted: evt.system as string,
        description:     evt.description as string,
        owner_team:      null,
      }
      setFindings(prev => [...prev, f])
      if (evt.system) setSystems(prev => prev.includes(evt.system as string) ? prev : [...prev, evt.system as string])
    }

    if (type === 'action') {
      setActions(prev => [...prev, {
        type:   evt.action as string,
        detail: evt.detail as string,
        status: evt.status as string,
      } as SaiAction])
    }

    if (type === 'complete') {
      const runId = evt.run_id as number
      setCurrentRunId(runId)
      if (evt.report) setReport(evt.report as SaiReportType)
      if (evt.knowledge_sources) setKnowledgeSources(evt.knowledge_sources as SaiKnowledgeSource[])
      loadApprovalQueue(runId)
      // Load traces + step outputs after run completes
      saiApi.getTraces(runId).then(setAiTraces).catch(() => {})
      saiApi.getRun(runId).then(d => setSteps(d.steps)).catch(() => {})
    }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const data = await saiApi.listRuns({ limit: 30 })
      setRuns(data)
    } catch { /* ignore */ }
  }, [])

  const loadApprovalQueue = useCallback(async (runId: number) => {
    try {
      const data = await saiApi.getRun(runId)
      setApprovalItems(data.approval_queue)   // pass all — ActionCenter handles pending vs decided
    } catch { /* ignore */ }
  }, [])

  const handleApprovalDone = useCallback((dispatchedAction?: SaiAction) => {
    if (currentRunId) loadApprovalQueue(currentRunId)
    if (dispatchedAction) {
      setActions(prev => [...prev, dispatchedAction])
      setSnackbar({ open: true, message: `${dispatchedAction.type.replace(/_/g, ' ')} dispatched` })
    }
  }, [currentRunId])

  const loadHistoricRun = useCallback(async (runId: number) => {
    try {
      const [detail, traces] = await Promise.all([
        saiApi.getRun(runId),
        saiApi.getTraces(runId).catch(() => [] as import('@/types').SaiAiTrace[]),
      ])
      setCurrentRunId(runId)
      setReport(detail.report || null)
      setAiTraces(traces)

      // Rebuild queries from data_collection step output
      const dcStep = detail.steps.find(s => s.agent_name === 'data_collection_agent')
      const datasets = ((dcStep?.output as Record<string, unknown>)?.datasets ?? []) as Record<string, unknown>[]
      setQueriesUsed(
        datasets
          .filter(ds => ds.query_used)
          .map(ds => ({
            conn_id:   ds.conn_id as number,
            label:     ds.label as string,
            query:     ds.query_used as string,
            status:    ds.error ? ('error' as const) : ('ok' as const),
            row_count: ds.row_count as number,
            columns:   ds.columns as string[] | undefined,
            error:     ds.error as string | undefined,
          }))
      )

      // Use db_findings (relational) first, fall back to inline findings_json
      const allFindings = (detail.db_findings?.length ? detail.db_findings : detail.findings) ?? []
      setFindings(allFindings.map(f => ({
        issue_type:      f.issue_type as string,
        severity:        f.severity as SaiFinding['severity'],
        system_impacted: f.system_impacted as string,
        description:     f.description as string,
        owner_team:      f.owner_team as string | null,
      })))
      setSystems([...new Set(allFindings.map(f => f.system_impacted as string).filter(Boolean))])
      setKnowledgeSources(detail.knowledge_sources || [])
      setActions((detail.actions_taken ?? []) as SaiAction[])
      setReasoningLines([])  // no stream replay for historic runs
      setSteps(detail.steps)
      setAgentStates(
        Object.fromEntries(detail.steps.map(s => [s.agent_name, { agent: s.agent_name, status: s.status as SaiStepStatus, elapsed_ms: s.elapsed_ms ?? undefined }]))
      )
      setApprovalItems((detail.approval_queue ?? []).filter(a => a.status === 'pending'))
      setHistoryOpen(false)
    } catch (e) {
      console.error('loadHistoricRun error:', e)
    }
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 2,
        px: 3, py: 1.5, bgcolor: 'background.paper',
        borderBottom: 2, borderColor: 'primary.main',
      }}>
        <Box>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: 'primary.main', letterSpacing: 1 }}>
            SAI MISSION CONTROL
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
            Swift Autonomous Intelligence — Enterprise Operations Platform
          </Typography>
        </Box>

        <Box sx={{ flex: 1, display: 'flex', gap: 1.5, alignItems: 'center', ml: 2 }}>
          {/* Domain toggle */}
          <ToggleButtonGroup
            value={devOpsMode} exclusive size="small"
            onChange={(_, v) => { if (v) setDevOpsMode(v) }}
            sx={{ flexShrink: 0 }}
          >
            <ToggleButton value="data_ops"  sx={{ fontSize: '0.7rem', px: 1.5, py: 0.4 }}>Data Ops</ToggleButton>
            <ToggleButton value="dev_ops"   sx={{ fontSize: '0.7rem', px: 1.5, py: 0.4 }}>Dev Ops</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            size="small"
            value={requestText}
            onChange={e => setRequestText(e.target.value)}
            placeholder={devOpsMode === 'dev_ops'
              ? "e.g. What's blocking the current sprint?"
              : "e.g. Collect B&C data and analyze issues"}
            sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.75 } }}
          />
          {devOpsMode === 'dev_ops' && (
            <Tooltip title={!activeProject ? 'Select a project first' : 'Sync JIRA/ADO tasks'}>
              <span>
                <IconButton size="small" onClick={handleSync}
                  disabled={isSyncing || !activeProject}
                  color={sprintSummary ? 'primary' : 'default'}>
                  {isSyncing ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          {devOpsMode === 'data_ops' && activeConnection && (
            <Typography sx={{
              fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap',
              px: 1, py: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1,
            }}>
              Scope: <span style={{ fontWeight: 600 }}>{activeConnection.name}</span>
            </Typography>
          )}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={mode} onChange={e => setMode(e.target.value as SaiMode)} sx={{ fontSize: '0.8rem' }}>
              <MenuItem value="manual">Manual</MenuItem>
              <MenuItem value="assisted">Assisted</MenuItem>
              <MenuItem value="autonomous">Autonomous</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title={!activeProject ? 'Select a project from the top bar first' : isStreaming ? 'Running…' : 'Run SAI analysis'}>
            <span>
              <Button
                variant="contained"
                startIcon={isStreaming ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PlayArrowIcon />}
                onClick={handleRun}
                disabled={isStreaming || !requestText.trim() || !activeProject}
                sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
              >
                {isStreaming ? 'Running...' : 'Run SAI'}
              </Button>
            </span>
          </Tooltip>

          {/* SQL Queries inspector */}
          <Tooltip title="Data Queries">
            <IconButton size="small" onClick={() => setQueriesOpen(true)}
              color={queriesUsed.length ? 'primary' : 'default'}>
              <StorageIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* AI Trace dashboard */}
          <Tooltip title="AI Activity Dashboard">
            <IconButton size="small" onClick={() => setTracesOpen(true)}
              color={aiTraces.length ? 'primary' : 'default'}>
              <PsychologyIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* History */}
          <Tooltip title="Run History">
            <IconButton size="small" onClick={() => setHistoryOpen(true)}>
              <HistoryIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── No-project warning ───────────────────────────────── */}
      {!activeProject && (
        <Alert severity="warning" sx={{ borderRadius: 0, py: 0.5, px: 3 }}>
          Select a project from the top bar to enable SAI Ops. SAI needs project connections to collect and analyze data.
        </Alert>
      )}

      {/* ── Dev Ops NLP prompt chips ─────────────────────────── */}
      {devOpsMode === 'dev_ops' && (
        <Box sx={{
          px: 3, py: 0.75, bgcolor: 'action.hover',
          borderBottom: 1, borderColor: 'divider',
          display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {[
            "What's blocking the current sprint?",
            "Who owns the failing build tickets?",
            "Summarize today's dev blockers",
            "Sprint health for current iteration",
            "Show all unassigned high-priority bugs",
            "Which tasks are overdue?",
          ].map(p => (
            <Chip key={p} label={p} size="small" variant="outlined" clickable
              onClick={() => setRequestText(p)}
              sx={{ fontSize: '0.7rem' }} />
          ))}
        </Box>
      )}

      {/* ── KPI Bar ──────────────────────────────────────────── */}
      <KPIBar runs={runs} mode={mode} isStreaming={isStreaming} />

      {/* ── Main Content ─────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left — Pipeline */}
        <PipelinePanel
          agentStates={agentStates}
          steps={steps}
          traces={aiTraces}
          onAgentClick={setSelectedAgent}
        />

        {/* Center — Reasoning Stream + Report */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Collapsible Reasoning Stream header */}
          <Box
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              px: 2, py: 0.75, bgcolor: 'background.paper',
              borderBottom: 1, borderColor: 'divider', cursor: 'pointer',
            }}
            onClick={() => setReasoningOpen(v => !v)}
          >
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 1, fontSize: '0.65rem', color: 'text.secondary' }}>
              LIVE REASONING STREAM
              {reasoningLines.length > 0 && (
                <Chip label={reasoningLines.length} size="small"
                  sx={{ ml: 1, height: 16, fontSize: '0.6rem', bgcolor: 'action.selected' }} />
              )}
            </Typography>
            <IconButton size="small" sx={{ p: 0 }}>
              {reasoningOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Box>

          <Collapse in={reasoningOpen} sx={{ flex: reasoningOpen ? 1 : 0, overflow: 'hidden', minHeight: 0 }}>
            <Box sx={{ height: '100%', overflow: 'hidden' }}>
              <ReasoningStream lines={reasoningLines} knowledgeSources={knowledgeSources} />
            </Box>
          </Collapse>


          {/* Report — grows to fill space when reasoning is collapsed */}
          {report && (
            <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, px: 2, pb: 1, bgcolor: 'background.default', borderTop: 1, borderColor: 'divider' }}>
              <SAIReport report={report} />
            </Box>
          )}
        </Box>

        {/* Right — Impact Graph / Sprint Panel */}
        {devOpsMode === 'dev_ops' && sprintSummary
          ? <SprintMiniPanel summary={sprintSummary} onRefresh={handleSync} />
          : <ImpactGraph findings={findings} systems={systems} />
        }
      </Box>

      {/* ── Action Center ────────────────────────────────────── */}
      <ActionCenter
        actions={actions}
        approvalItems={approvalItems}
        runId={currentRunId}
        onApprovalDone={handleApprovalDone}
      />

      {/* ── Data Queries Drawer ──────────────────────────────── */}
      <Drawer anchor="right" open={queriesOpen} onClose={() => setQueriesOpen(false)}
        PaperProps={{ sx: { width: 480, display: 'flex', flexDirection: 'column' } }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <StorageIcon fontSize="small" sx={{ color: 'primary.main' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>Data Queries</Typography>
            <Typography variant="caption" color="text.secondary">
              {queriesUsed.length} quer{queriesUsed.length === 1 ? 'y' : 'ies'} executed by SAI
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {queriesUsed.length === 0 ? (
            <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem', fontStyle: 'italic' }}>
              Run SAI to see what SQL queries are generated and executed.
            </Typography>
          ) : queriesUsed.map((q, i) => (
            <Box key={i} sx={{ mb: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Box sx={{ px: 1.5, py: 1, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <StorageIcon sx={{ fontSize: 14, color: q.status === 'error' ? 'error.main' : 'success.main' }} />
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, flex: 1 }}>{q.label}</Typography>
                {q.status === 'ok'
                  ? <Chip label={`${q.row_count} rows`} size="small" color="success" sx={{ height: 18, fontSize: '0.65rem' }} />
                  : <Chip label="error" size="small" color="error" sx={{ height: 18, fontSize: '0.65rem' }} />
                }
              </Box>
              <Box sx={{ p: 1.5 }}>
                {q.query ? (
                  <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5, fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {q.query}
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: '0.75rem', color: 'error.main' }}>{q.error}</Typography>
                )}
                {q.columns && q.columns.length > 0 && (
                  <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 1 }}>
                    Columns: {q.columns.join(', ')}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Drawer>

      {/* ── AI Traces Dashboard Drawer ────────────────────────── */}
      <Drawer anchor="right" open={tracesOpen} onClose={() => setTracesOpen(false)}
        PaperProps={{ sx: { width: 560, display: 'flex', flexDirection: 'column' } }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeIcon fontSize="small" sx={{ color: 'primary.main' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>AI Activity Dashboard</Typography>
            <Typography variant="caption" color="text.secondary">
              {aiTraces.length} LLM call{aiTraces.length !== 1 ? 's' : ''} — {aiTraces.reduce((s, t) => s + (t.tokens_in || 0) + (t.tokens_out || 0), 0).toLocaleString()} total tokens
            </Typography>
          </Box>
        </Box>

        {/* Summary KPIs */}
        {aiTraces.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
            {[
              { label: 'Agents called', value: aiTraces.length },
              { label: 'Tokens in', value: aiTraces.reduce((s, t) => s + (t.tokens_in || 0), 0).toLocaleString() },
              { label: 'Tokens out', value: aiTraces.reduce((s, t) => s + (t.tokens_out || 0), 0).toLocaleString() },
              { label: 'Avg latency', value: `${Math.round(aiTraces.reduce((s, t) => s + (t.latency_ms || 0), 0) / aiTraces.length)}ms` },
            ].map(k => (
              <Box key={k.label} sx={{ flex: 1, minWidth: 100, bgcolor: 'action.hover', borderRadius: 1, p: 1, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: 'primary.main' }}>{k.value}</Typography>
                <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>{k.label}</Typography>
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {aiTraces.length === 0 ? (
            <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem', fontStyle: 'italic' }}>
              AI activity loads after the run completes. Each agent's LLM call will appear here.
            </Typography>
          ) : aiTraces.map((t, i) => (
            <Box key={i} sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Box sx={{ px: 1.5, py: 1, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Chip label={t.module} size="small" color="primary" sx={{ height: 20, fontSize: '0.65rem' }} />
                <Chip label={t.model} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', ml: 'auto' }}>
                  {(t.tokens_in || 0).toLocaleString()} in · {(t.tokens_out || 0).toLocaleString()} out · {t.latency_ms}ms
                </Typography>
              </Box>
              <Box sx={{ p: 1.5 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>Prompt</Typography>
                <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1, fontSize: '0.7rem', fontFamily: 'monospace', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.primary' }}>
                  {t.prompt_text}
                </Box>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', mt: 1, mb: 0.5 }}>Response</Typography>
                <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1, fontSize: '0.7rem', fontFamily: 'monospace', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.primary' }}>
                  {t.response_text}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Drawer>

      {/* ── Agent Detail Drawer ─────────────────────────────── */}
      <AgentDetailDrawer
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        agentName={selectedAgent ?? ''}
        step={steps.find(s => s.agent_name === selectedAgent)}
        traces={aiTraces}
      />

      {/* ── Dispatch Snackbar ───────────────────────────────── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        message={snackbar.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      {/* ── History Drawer ───────────────────────────────────── */}
      <Drawer anchor="right" open={historyOpen} onClose={() => setHistoryOpen(false)}
        PaperProps={{ sx: { width: 380, display: 'flex', flexDirection: 'column' } }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>Run History</Typography>
            <Typography variant="caption" color="text.secondary">{runs.length} runs — click to load</Typography>
          </Box>
          <IconButton size="small" onClick={loadRuns} title="Refresh">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
        <List dense sx={{ flex: 1, overflowY: 'auto' }}>
          {runs.map(r => (
            <ListItemButton key={r.id} onClick={() => loadHistoricRun(r.id)}
              selected={r.id === currentRunId}>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label={r.status}
                      size="small"
                      color={r.status === 'complete' ? 'success' : r.status === 'error' ? 'error' : 'default'}
                      sx={{ height: 16, fontSize: '0.6rem' }}
                    />
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>#{r.id}</Typography>
                    <Chip label={r.mode} size="small" variant="outlined" sx={{ height: 16, fontSize: '0.6rem' }} />
                    {r.findings_count > 0 && (
                      <Chip label={`${r.findings_count} findings`} size="small" color="warning"
                        sx={{ height: 16, fontSize: '0.6rem' }} />
                    )}
                  </Box>
                }
                secondary={
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.25 }} noWrap>
                      {r.request_text}
                    </Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>
                      {r.started_at ? new Date(r.started_at).toLocaleString() : ''}
                    </Typography>
                  </Box>
                }
              />
            </ListItemButton>
          ))}
          {runs.length === 0 && (
            <ListItem>
              <ListItemText primary={<Typography color="text.disabled" fontSize="0.8rem">No runs yet</Typography>} />
            </ListItem>
          )}
        </List>
      </Drawer>
    </Box>
  )
}
