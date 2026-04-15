import { useState } from 'react'
import {
  Box, Typography, Button, TextField, Paper, Chip, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, FormControl,
  InputLabel, Select, MenuItem, Alert, Stack, alpha, Collapse,
  Accordion, AccordionSummary, AccordionDetails, LinearProgress, Divider,
} from '@mui/material'
import {
  AddOutlined, PlayArrowOutlined, PauseOutlined, DeleteOutlined,
  VisibilityOutlined, AutoAwesomeOutlined, ExpandMoreOutlined,
  CheckCircleOutlined, ErrorOutlined, HourglassEmptyOutlined,
  WarningAmberOutlined, EditOutlined, RefreshOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { agentsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type { AIAgent, AIAgentLog } from '@/types'

const STATUS_COLORS: Record<string, string> = {
  active:   tokens.emerald600,
  paused:   tokens.amber600,
  inactive: '#64748B',
}

const RUN_STATUS_COLORS: Record<string, string> = {
  success: tokens.emerald600,
  partial: tokens.amber600,
  failed:  tokens.red600,
  running: tokens.sky600,
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircleOutlined sx={{ fontSize: 15, color: tokens.emerald600 }} />
  if (status === 'partial')  return <WarningAmberOutlined sx={{ fontSize: 15, color: tokens.amber600 }} />
  if (status === 'failed')   return <ErrorOutlined sx={{ fontSize: 15, color: tokens.red600 }} />
  return <HourglassEmptyOutlined sx={{ fontSize: 15, color: tokens.sky600 }} />
}

// ── Agent Logs Dialog ─────────────────────────────────────────
function LogsDialog({ agent, open, onClose }: { agent: AIAgent; open: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: logs = [], isLoading, refetch } = useQuery<AIAgentLog[]>({
    queryKey: ['agent-logs', agent.id],
    queryFn: () => agentsApi.logs(agent.id, 30),
    enabled: open,
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeOutlined color="primary" />
          <Typography fontWeight={700}>Execution Logs — {agent.name}</Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => refetch()}><RefreshOutlined sx={{ fontSize: 16 }} /></IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        {isLoading && <LinearProgress />}
        {!isLoading && logs.length === 0 && (
          <Alert severity="info">No executions yet. Click "Run" on the agent to start.</Alert>
        )}
        {logs.map((log) => (
          <Accordion key={log.id} disableGutters elevation={0}
            expanded={expanded === log.id}
            onChange={(_, open) => setExpanded(open ? log.id : null)}
            sx={{ mb: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&::before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 44, px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                <RunStatusIcon status={log.status} />
                <Chip label={log.status} size="small"
                  sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700,
                    bgcolor: alpha(RUN_STATUS_COLORS[log.status] ?? '#64748B', 0.1),
                    color: RUN_STATUS_COLORS[log.status] ?? '#64748B' }} />
                <Typography variant="caption" color="text.secondary">
                  {log.steps_executed ?? 0} steps executed
                </Typography>
                {log.execution_time != null && (
                  <Typography variant="caption" color="text.disabled">
                    {(log.execution_time / 1000).toFixed(1)}s
                  </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.disabled">
                  {new Date(log.created_at).toLocaleString()}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
              {log.result_summary && (
                <Alert severity={log.status === 'success' ? 'success' : log.status === 'partial' ? 'warning' : 'error'}
                  sx={{ mb: 1.5, fontSize: '0.813rem' }}>
                  {log.result_summary}
                </Alert>
              )}
              {log.error && (
                <Alert severity="error" sx={{ mb: 1.5, fontSize: '0.813rem' }}>{log.error}</Alert>
              )}
              {log.generated_plan && (() => {
                try {
                  const parsed = JSON.parse(log.generated_plan)
                  const results: unknown[] = parsed.results ?? []
                  return (
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        EXECUTION STEPS
                      </Typography>
                      {(results as { step?: number; type?: string; description?: string; status?: string; rows_returned?: number; error?: string; reason?: string }[]).map((r, i) => (
                        <Paper key={i} variant="outlined" sx={{ p: 1, mb: 0.5, borderRadius: 1.5,
                          borderColor: alpha(RUN_STATUS_COLORS[r.status ?? ''] ?? '#64748B', 0.3) }}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="caption" fontWeight={700} color="text.disabled">
                              {r.step ?? i + 1}.
                            </Typography>
                            <Chip label={r.type} size="small" sx={{ height: 16, fontSize: '0.563rem' }} />
                            <Typography variant="caption" sx={{ flex: 1 }}>{r.description}</Typography>
                            <Chip label={r.status} size="small"
                              sx={{ height: 16, fontSize: '0.563rem', fontWeight: 700,
                                color: RUN_STATUS_COLORS[r.status ?? ''] ?? '#64748B' }} variant="outlined" />
                            {r.rows_returned != null && (
                              <Typography variant="caption" color="text.disabled">{r.rows_returned} rows</Typography>
                            )}
                          </Stack>
                          {(r.error || r.reason) && (
                            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', fontSize: '0.688rem' }}>
                              {r.error ?? r.reason}
                            </Typography>
                          )}
                        </Paper>
                      ))}
                    </Box>
                  )
                } catch { return null }
              })()}
            </AccordionDetails>
          </Accordion>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Create / Edit Agent Dialog ────────────────────────────────
function AgentDialog({
  open, onClose, initial,
}: {
  open: boolean
  onClose: () => void
  initial?: AIAgent | null
}) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection = useAppStore((s) => s.activeConnection)

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDesc] = useState(initial?.description ?? '')
  const [goal, setGoal] = useState(initial?.goal ?? '')
  const [schedule, setSchedule] = useState(initial?.schedule ?? 'manual')

  const isEdit = !!initial

  const saveMut = useMutation({
    mutationFn: () => isEdit
      ? agentsApi.update(initial!.id, { name, description, goal, schedule })
      : agentsApi.create({ name, description, goal, conn_id: activeConnection?.id, schedule }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      enqueueSnackbar(isEdit ? 'Agent updated' : 'Agent created', { variant: 'success' })
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Save failed', { variant: 'error' }),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Agent' : 'Create AI Agent'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <TextField size="small" fullWidth required
          label="Agent Name"
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Data Quality Monitor"
        />
        <TextField size="small" fullWidth
          label="Description (optional)"
          value={description} onChange={(e) => setDesc(e.target.value)}
        />
        <TextField size="small" fullWidth required multiline minRows={4}
          label="Goal"
          value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe what this agent should do in plain language. Example: Check for missing data between policy and billing tables and summarize discrepancies."
          helperText="The AI will dynamically generate and execute steps at runtime based on this goal."
        />
        <FormControl size="small" fullWidth>
          <InputLabel>Schedule</InputLabel>
          <Select label="Schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            <MenuItem value="manual">Manual (run on demand)</MenuItem>
            <MenuItem value="daily">Daily</MenuItem>
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="hourly">Hourly</MenuItem>
          </Select>
        </FormControl>
        <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
          The agent stores only your goal — no SQL, no fixed steps. Each run dynamically generates
          an execution plan based on your current schema and context.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained"
          startIcon={saveMut.isPending ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !name.trim() || !goal.trim()}
        >
          {isEdit ? 'Save Changes' : 'Create Agent'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function AgentsPage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId = activeConnection?.id

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AIAgent | null>(null)
  const [logsAgent, setLogsAgent] = useState<AIAgent | null>(null)
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set())
  const [model, setModel] = useState('gpt-4o-mini')

  const { data: agents = [], isLoading, refetch } = useQuery<AIAgent[]>({
    queryKey: ['agents', connId],
    queryFn: () => agentsApi.list(connId),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => agentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      enqueueSnackbar('Agent deleted', { variant: 'info' })
    },
  })

  const pauseMut = useMutation({
    mutationFn: (id: number) => agentsApi.pause(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  const runMut = useMutation({
    mutationFn: (id: number) => agentsApi.run(id, model),
    onMutate: (id) => setRunningIds((s) => new Set(s).add(id)),
    onSettled: (_, __, id) => setRunningIds((s) => { const n = new Set(s); n.delete(id); return n }),
    onSuccess: (log, id) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['agent-logs', id] })
      enqueueSnackbar(
        log.status === 'success' ? `Agent ran successfully — ${log.steps_executed} steps`
          : log.status === 'partial' ? `Agent completed with some issues`
          : 'Agent run failed',
        { variant: log.status === 'success' ? 'success' : log.status === 'partial' ? 'warning' : 'error' },
      )
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Run failed', { variant: 'error' }),
  })

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <AutoAwesomeOutlined color="primary" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>AI Agents</Typography>
          <Typography variant="caption" color="text.secondary">
            Autonomous agents that dynamically plan and execute actions at runtime
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Model</InputLabel>
          <Select label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
            <MenuItem value="gpt-4o-mini">gpt-4o-mini</MenuItem>
            <MenuItem value="gpt-4o">gpt-4o</MenuItem>
          </Select>
        </FormControl>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => refetch()}><RefreshOutlined /></IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreateOpen(true)}>
          New Agent
        </Button>
      </Box>

      {/* Summary chips */}
      {agents.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          {(['active', 'paused', 'inactive'] as const).map((s) => {
            const count = agents.filter((a) => a.status === s).length
            return count > 0 ? (
              <Chip key={s} label={`${count} ${s}`} size="small"
                sx={{ bgcolor: alpha(STATUS_COLORS[s], 0.1), color: STATUS_COLORS[s], fontWeight: 700, fontSize: '0.688rem' }} />
            ) : null
          })}
        </Stack>
      )}

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Empty state */}
      {!isLoading && agents.length === 0 && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 64, color: 'text.disabled', opacity: 0.4 }} />
          <Typography variant="h6" color="text.secondary">No agents yet</Typography>
          <Typography variant="body2" color="text.disabled" textAlign="center" sx={{ maxWidth: 400 }}>
            Create an AI Agent from a goal or from a PS Support conversation.
            Agents dynamically plan and execute SQL, API calls, and summaries at runtime.
          </Typography>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreateOpen(true)}>
            Create First Agent
          </Button>
        </Box>
      )}

      {/* Agents table */}
      {agents.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', flex: 1, overflowY: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Agent</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Goal</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Schedule</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Last Run</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {agents.map((agent) => {
                const isRunning = runningIds.has(agent.id)
                return (
                  <TableRow key={agent.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{agent.name}</Typography>
                      {agent.description && (
                        <Typography variant="caption" color="text.secondary">{agent.description}</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="caption" color="text.secondary"
                        sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {agent.goal}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={agent.schedule ?? 'manual'} size="small"
                        sx={{ height: 18, fontSize: '0.625rem', textTransform: 'capitalize' }} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      {agent.last_run_at
                        ? <Typography variant="caption" color="text.secondary">
                            {new Date(agent.last_run_at).toLocaleString()}
                          </Typography>
                        : <Typography variant="caption" color="text.disabled">Never</Typography>
                      }
                    </TableCell>
                    <TableCell>
                      <Chip label={agent.status} size="small"
                        sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700,
                          bgcolor: alpha(STATUS_COLORS[agent.status] ?? '#64748B', 0.12),
                          color: STATUS_COLORS[agent.status] ?? '#64748B' }} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Run agent now">
                          <span>
                            <IconButton size="small" color="success"
                              onClick={() => runMut.mutate(agent.id)}
                              disabled={isRunning || agent.status === 'inactive'}
                            >
                              {isRunning
                                ? <CircularProgress size={14} />
                                : <PlayArrowOutlined sx={{ fontSize: 16 }} />}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={agent.status === 'active' ? 'Pause agent' : 'Activate agent'}>
                          <IconButton size="small" color="warning"
                            onClick={() => pauseMut.mutate(agent.id)}
                            disabled={pauseMut.isPending}
                          >
                            {agent.status === 'active'
                              ? <PauseOutlined sx={{ fontSize: 16 }} />
                              : <PlayArrowOutlined sx={{ fontSize: 16 }} />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="View logs">
                          <IconButton size="small" onClick={() => setLogsAgent(agent)}>
                            <VisibilityOutlined sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit agent">
                          <IconButton size="small" onClick={() => setEditTarget(agent)}>
                            <EditOutlined sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete agent">
                          <IconButton size="small" color="error"
                            onClick={() => deleteMut.mutate(agent.id)}
                            disabled={deleteMut.isPending}
                          >
                            <DeleteOutlined sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Dialogs */}
      <AgentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editTarget && (
        <AgentDialog open={!!editTarget} onClose={() => setEditTarget(null)} initial={editTarget} />
      )}
      {logsAgent && (
        <LogsDialog agent={logsAgent} open={!!logsAgent} onClose={() => setLogsAgent(null)} />
      )}
    </Box>
  )
}
