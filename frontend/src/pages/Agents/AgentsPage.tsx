import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Button, TextField, Paper, Chip, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, FormControl,
  InputLabel, Select, MenuItem, Alert, Stack, alpha, Collapse,
  Accordion, AccordionSummary, AccordionDetails, LinearProgress, Divider,
  Tab, Tabs, Grid, Card, CardContent, CardActions, Checkbox,
  FormControlLabel, FormGroup, ToggleButton, ToggleButtonGroup, Autocomplete,
} from '@mui/material'
import {
  AddOutlined, PlayArrowOutlined, PauseOutlined, DeleteOutlined,
  VisibilityOutlined, AutoAwesomeOutlined, ExpandMoreOutlined,
  CheckCircleOutlined, ErrorOutlined, HourglassEmptyOutlined,
  WarningAmberOutlined, EditOutlined, RefreshOutlined,
  WorkspacesOutlined, DashboardOutlined, PersonOutlined,
  BoltOutlined, KeyboardArrowRightOutlined, HistoryOutlined,
  ExpandLess, ExpandMore, BadgeOutlined, LoopOutlined,
  ThumbUpOutlined, ThumbDownOutlined, AutoFixHighOutlined,
  CloudDownloadOutlined, LinkOutlined, TextFieldsOutlined,
  BookmarkOutlined, ScheduleOutlined, SaveOutlined, StorageOutlined,
  AssessmentOutlined, CodeOutlined, BugReportOutlined, OpenInNewOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import ReactMarkdown from 'react-markdown'
import { agentsApi, agenticApi, developmentApi, integrationsApi, connectionsApi, conversionAgentApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type {
  AIAgent, AIAgentLog, AgentRole, AgentCard,
  WorkflowExecution, WorkflowExecutionStep, SavedAgenticWorkflow,
  AgentRunLog, QueryVersion, ValidationResultEntry, ColumnProfile, ValueMapping,
} from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const TEAL  = '#0EA5E9'
const PURPLE = '#8B5CF6'
const NAVY   = '#1E3A5F'
const ROLE_PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4']
const roleColor = (idx: number) => ROLE_PALETTE[idx % ROLE_PALETTE.length]

const STATUS_COLORS: Record<string, string> = {
  active: tokens.emerald600, paused: tokens.amber600, inactive: '#64748B',
}
const RUN_STATUS_COLORS: Record<string, string> = {
  success: tokens.emerald600, partial: tokens.amber600,
  failed: tokens.red600, running: tokens.sky600, escalated: '#F97316',
}
const DECISION_META: Record<string, { icon: JSX.Element; color: string; label: string }> = {
  APPROVE:   { icon: <ThumbUpOutlined sx={{ fontSize: 13 }} />,   color: tokens.emerald600, label: 'Approved' },
  REJECT:    { icon: <ThumbDownOutlined sx={{ fontSize: 13 }} />,  color: tokens.red600,     label: 'Rejected' },
  REVISE:    { icon: <LoopOutlined sx={{ fontSize: 13 }} />,       color: tokens.amber600,   label: 'Revise' },
  ESCALATED: { icon: <WarningAmberOutlined sx={{ fontSize: 13 }} />, color: '#F97316',       label: 'Escalated' },
}
const TONE_OPTIONS = ['analytical', 'strict QA', 'business-friendly', 'collaborative', 'executive']
const QUICK_CHIPS = [
  'Read the BRD and create a development plan with tasks',
  'Validate premium mismatch across source and target',
  'Analyse claim rejection rates and summarise findings',
  'Check for duplicate policy records and report issues',
]

// ── Shared ────────────────────────────────────────────────────────────────────

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'success')   return <CheckCircleOutlined sx={{ fontSize: 15, color: tokens.emerald600 }} />
  if (status === 'escalated') return <WarningAmberOutlined sx={{ fontSize: 15, color: '#F97316' }} />
  if (status === 'failed')    return <ErrorOutlined sx={{ fontSize: 15, color: tokens.red600 }} />
  return <HourglassEmptyOutlined sx={{ fontSize: 15, color: tokens.sky600 }} />
}

function ToolChips({ toolsJson }: { toolsJson?: string | null }) {
  let tools: string[] = []
  try { tools = JSON.parse(toolsJson || '[]') } catch { tools = [] }
  if (!tools.length) return null
  return (
    <Stack direction="row" flexWrap="wrap" gap={0.5}>
      {tools.map((t) => (
        <Chip key={t} label={t} size="small"
          sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
      ))}
    </Stack>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 0 — AGENTS (named employees)
// ══════════════════════════════════════════════════════════════════════════════

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
        {!isLoading && logs.length === 0 && <Alert severity="info">No executions yet.</Alert>}
        {logs.map((log) => (
          <Accordion key={log.id} disableGutters elevation={0}
            expanded={expanded === log.id}
            onChange={(_, o) => setExpanded(o ? log.id : null)}
            sx={{ mb: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&::before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 44, px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                <RunStatusIcon status={log.status} />
                <Chip label={log.status} size="small"
                  sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700,
                    bgcolor: alpha(RUN_STATUS_COLORS[log.status] ?? '#64748B', 0.1),
                    color: RUN_STATUS_COLORS[log.status] ?? '#64748B' }} />
                <Typography variant="caption" color="text.secondary">{log.steps_executed ?? 0} steps</Typography>
                {log.execution_time != null && (
                  <Typography variant="caption" color="text.disabled">{(log.execution_time / 1000).toFixed(1)}s</Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.disabled">{new Date(log.created_at).toLocaleString()}</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
              {log.result_summary && (
                <Alert severity={log.status === 'success' ? 'success' : 'warning'} sx={{ mb: 1.5, fontSize: '0.813rem' }}>
                  {log.result_summary}
                </Alert>
              )}
              {log.error && <Alert severity="error" sx={{ mb: 1.5, fontSize: '0.813rem' }}>{log.error}</Alert>}
            </AccordionDetails>
          </Accordion>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  )
}

function AgentDialog({ open, onClose, initial, roles, availableTools }: {
  open: boolean; onClose: () => void; initial?: AIAgent | null
  roles: AgentRole[]
  availableTools: Array<{ key: string; label: string }>
}) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection = useAppStore((s) => s.activeConnection)

  const [name, setName]         = useState(initial?.name ?? '')
  const [description, setDesc]  = useState(initial?.description ?? '')
  const [goal, setGoal]         = useState(initial?.goal ?? '')
  const [schedule, setSchedule] = useState(initial?.schedule ?? 'manual')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [roleId, setRoleId]     = useState<number | ''>(initial?.role_id ?? '')
  const [tools, setTools]       = useState<string[]>(() => {
    try { return JSON.parse(initial?.tools_json || '[]') } catch { return [] }
  })

  const isEdit = !!initial
  const toggleTool = (key: string) =>
    setTools((prev) => prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key])

  const toolsJsonStr = JSON.stringify(tools)
  const saveMut = useMutation({
    mutationFn: () => isEdit
      ? agentsApi.update(initial!.id, {
          name, description, goal, schedule,
          role_id:    roleId !== '' ? Number(roleId) : undefined,
          category:   category || undefined,
          tools_json: toolsJsonStr,
        })
      : agentsApi.create({
          name, description, goal, schedule,
          conn_id:    activeConnection?.id,
          role_id:    roleId !== '' ? Number(roleId) : undefined,
          category:   category || undefined,
          tools_json: toolsJsonStr,
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['agentic-resources'] })
      enqueueSnackbar(isEdit ? 'Agent updated' : 'Agent onboarded', { variant: 'success' })
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Save failed', { variant: 'error' }),
  })

  const assignedRole = roles.find((r) => r.id === Number(roleId))

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BadgeOutlined />
          <Typography fontWeight={700}>{isEdit ? 'Edit Employee' : 'Onboard New Employee'}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>

        {/* Identity */}
        <TextField size="small" fullWidth required label="Full Name"
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sai, Chand, Alice" />
        <TextField size="small" fullWidth label="Description / Title"
          value={description} onChange={(e) => setDesc(e.target.value)}
          placeholder="e.g. Senior Data Developer" />

        {/* Position */}
        <FormControl size="small" fullWidth required>
          <InputLabel>Position (Role)</InputLabel>
          <Select label="Position (Role)" value={roleId}
            onChange={(e) => setRoleId(e.target.value as number | '')}>
            <MenuItem value="">— Select a role —</MenuItem>
            {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.role_name}</MenuItem>)}
          </Select>
        </FormControl>

        {assignedRole && (
          <Alert severity="info" sx={{ py: 0.5, fontSize: '0.75rem' }}>
            <strong>{assignedRole.role_name}</strong>
            {assignedRole.description && ` — ${assignedRole.description}`}
          </Alert>
        )}

        <TextField size="small" fullWidth label="Department / Category"
          value={category} onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Engineering, QA, PMO" />

        {/* IT Access (Tools) */}
        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary"
            sx={{ display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
            IT Access Provisioning (Tools)
          </Typography>
          <FormGroup row>
            {availableTools.map((t) => (
              <FormControlLabel key={t.key}
                control={
                  <Checkbox size="small" checked={tools.includes(t.key)}
                    onChange={() => toggleTool(t.key)}
                    sx={{ py: 0.5, color: TEAL, '&.Mui-checked': { color: TEAL } }} />
                }
                label={<Typography variant="caption">{t.key}</Typography>}
                sx={{ mr: 1.5 }}
              />
            ))}
          </FormGroup>
          <Typography variant="caption" color="text.disabled">
            These determine what context (schema, APIs, JIRA, etc.) is injected into this employee's prompts.
          </Typography>
        </Box>

        {/* Goal */}
        <TextField size="small" fullWidth required multiline minRows={3} label="Goal / Objective"
          value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="What does this employee do? e.g. Write and validate SQL queries for premium reconciliation."
          helperText="Used when this employee runs as an autonomous agent." />

        <FormControl size="small" fullWidth>
          <InputLabel>Schedule</InputLabel>
          <Select label="Schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            <MenuItem value="manual">Manual</MenuItem>
            <MenuItem value="daily">Daily</MenuItem>
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="hourly">Hourly</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !name.trim() || !goal.trim()}
          startIcon={saveMut.isPending ? <CircularProgress size={14} /> : <BadgeOutlined />}>
          {isEdit ? 'Save Changes' : 'Onboard Employee'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function AgentsTab({ roles, availableTools }: { roles: AgentRole[]; availableTools: Array<{ key: string; label: string }> }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId = activeConnection?.id

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AIAgent | null>(null)
  const [logsAgent, setLogsAgent]   = useState<AIAgent | null>(null)
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set())
  const [model, setModel]           = useState('gpt-4o-mini')

  const { data: agents = [], isLoading, refetch } = useQuery<AIAgent[]>({
    queryKey: ['agents', connId],
    queryFn: () => agentsApi.list(connId),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => agentsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); enqueueSnackbar('Employee removed', { variant: 'info' }) },
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
        log.status === 'success' ? `Done — ${log.steps_executed} steps`
          : log.status === 'partial' ? 'Completed with issues' : 'Run failed',
        { variant: log.status === 'success' ? 'success' : log.status === 'partial' ? 'warning' : 'error' },
      )
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Run failed', { variant: 'error' }),
  })

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Model</InputLabel>
          <Select label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
            <MenuItem value="gpt-4o-mini">gpt-4o-mini</MenuItem>
            <MenuItem value="gpt-4o">gpt-4o</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh"><IconButton size="small" onClick={() => refetch()}><RefreshOutlined /></IconButton></Tooltip>
        <Button variant="contained" startIcon={<BadgeOutlined />} onClick={() => setCreateOpen(true)}>
          Onboard Employee
        </Button>
      </Box>

      {isLoading && <LinearProgress sx={{ mb: 1 }} />}

      {!isLoading && agents.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <BadgeOutlined sx={{ fontSize: 64, color: 'text.disabled', opacity: 0.4 }} />
          <Typography variant="h6" color="text.secondary">No employees onboarded yet</Typography>
          <Typography variant="body2" color="text.disabled" textAlign="center" sx={{ maxWidth: 420 }}>
            Each employee gets a name, a position (role), IT access (tools), and a goal.
            Multiple employees can share the same role — e.g. Sai and Chand can both be Developers.
          </Typography>
          <Button variant="contained" startIcon={<BadgeOutlined />} onClick={() => setCreateOpen(true)}>
            Onboard First Employee
          </Button>
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', flex: 1, overflowY: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Employee</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Position (Role)</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>IT Access (Tools)</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Goal</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Schedule</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {agents.map((agent) => {
                const isRunning = runningIds.has(agent.id)
                const role      = roles.find((r) => r.id === agent.role_id)
                const rIdx      = role ? roles.indexOf(role) : -1
                const color     = rIdx >= 0 ? roleColor(rIdx) : '#64748B'
                return (
                  <TableRow key={agent.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: alpha(color, 0.15),
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Typography variant="caption" fontWeight={700} sx={{ color }}>
                            {agent.name.slice(0, 2).toUpperCase()}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="body2" fontWeight={700}>{agent.name}</Typography>
                          {agent.description && (
                            <Typography variant="caption" color="text.secondary">{agent.description}</Typography>
                          )}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {role ? (
                        <Chip label={role.role_name} size="small"
                          sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700,
                            bgcolor: alpha(color, 0.12), color }} />
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <ToolChips toolsJson={agent.tools_json} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
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
                      <Chip label={agent.status} size="small"
                        sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700,
                          bgcolor: alpha(STATUS_COLORS[agent.status] ?? '#64748B', 0.12),
                          color: STATUS_COLORS[agent.status] ?? '#64748B' }} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Run"><span>
                          <IconButton size="small" color="success"
                            onClick={() => runMut.mutate(agent.id)}
                            disabled={isRunning || agent.status === 'inactive'}>
                            {isRunning ? <CircularProgress size={14} /> : <PlayArrowOutlined sx={{ fontSize: 16 }} />}
                          </IconButton>
                        </span></Tooltip>
                        <Tooltip title={agent.status === 'active' ? 'Pause' : 'Activate'}>
                          <IconButton size="small" color="warning"
                            onClick={() => pauseMut.mutate(agent.id)} disabled={pauseMut.isPending}>
                            {agent.status === 'active' ? <PauseOutlined sx={{ fontSize: 16 }} /> : <PlayArrowOutlined sx={{ fontSize: 16 }} />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Logs">
                          <IconButton size="small" onClick={() => setLogsAgent(agent)}><VisibilityOutlined sx={{ fontSize: 16 }} /></IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => setEditTarget(agent)}><EditOutlined sx={{ fontSize: 16 }} /></IconButton>
                        </Tooltip>
                        <Tooltip title="Remove">
                          <IconButton size="small" color="error"
                            onClick={() => deleteMut.mutate(agent.id)} disabled={deleteMut.isPending}>
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

      <AgentDialog open={createOpen} onClose={() => setCreateOpen(false)} roles={roles} availableTools={availableTools} />
      {editTarget && <AgentDialog open={!!editTarget} onClose={() => setEditTarget(null)} initial={editTarget} roles={roles} availableTools={availableTools} />}
      {logsAgent  && <LogsDialog agent={logsAgent} open={!!logsAgent} onClose={() => setLogsAgent(null)} />}
    </Box>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — ROLES (job templates)
// ══════════════════════════════════════════════════════════════════════════════

function RoleDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: AgentRole | null }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [form, setForm]     = useState<Partial<AgentRole>>(initial ?? { is_active: true, tone: 'analytical' })
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  // Reset form every time the dialog opens so stale data from a previous session is cleared
  useEffect(() => {
    if (open) setForm(initial ?? { is_active: true, tone: 'analytical' })
  }, [open, initial])

  const set = (k: keyof AgentRole) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }))

  const isEdit = !!initial

  const saveMut = useMutation({
    mutationFn: () => isEdit ? agenticApi.updateRole(initial!.id, form) : agenticApi.createRole(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentic-roles'] })
      qc.invalidateQueries({ queryKey: ['agentic-resources'] })
      enqueueSnackbar(isEdit ? 'Role updated' : 'Role created', { variant: 'success' })
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Save failed', { variant: 'error' }),
  })

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    try {
      const data = await agenticApi.aiGenerateRole(aiPrompt)
      setForm((p) => ({ ...p, ...data }))
      setAiOpen(false)
      enqueueSnackbar('Role fields populated — review and save', { variant: 'info' })
    } catch { enqueueSnackbar('AI generation failed', { variant: 'error' })
    } finally { setAiLoading(false) }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WorkspacesOutlined />
            <Typography fontWeight={700}>{isEdit ? 'Edit Role Template' : 'New Role Template'}</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" startIcon={<AutoAwesomeOutlined />}
              onClick={() => setAiOpen(true)}
              sx={{ color: PURPLE, borderColor: PURPLE, '&:hover': { bgcolor: alpha(PURPLE, 0.08) } }}>
              AI Generate
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField size="small" fullWidth required label="Role Name"
            value={form.role_name ?? ''} onChange={set('role_name')} placeholder="e.g. Data Developer, PMO, Team Lead" />
          <TextField size="small" fullWidth label="Description"
            value={form.description ?? ''} onChange={set('description')} />
          <TextField size="small" fullWidth multiline minRows={2} label="Responsibilities"
            value={form.responsibilities ?? ''} onChange={set('responsibilities')} />
          <TextField size="small" fullWidth label="Skills"
            value={form.skills ?? ''} onChange={set('skills')} />
          <TextField size="small" fullWidth multiline minRows={2} label="Input Expectation"
            value={form.input_expectation ?? ''} onChange={set('input_expectation')} />
          <TextField size="small" fullWidth multiline minRows={2} label="Output Expectation"
            value={form.output_expectation ?? ''} onChange={set('output_expectation')} />
          <TextField size="small" fullWidth multiline minRows={2} label="Decision Logic"
            value={form.decision_logic ?? ''} onChange={set('decision_logic')} />
          <TextField size="small" fullWidth label="Deliverables"
            value={form.deliverables ?? ''} onChange={set('deliverables')} />
          <FormControl size="small" fullWidth>
            <InputLabel>Tone</InputLabel>
            <Select label="Tone" value={form.tone ?? 'analytical'}
              onChange={(e) => setForm((p) => ({ ...p, tone: e.target.value }))}>
              {TONE_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !form.role_name?.trim()}
            startIcon={saveMut.isPending ? <CircularProgress size={14} /> : undefined}>
            {isEdit ? 'Save Changes' : 'Create Role'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={aiOpen} onClose={() => setAiOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>AI Generate Role Template</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Describe the role and AI will generate all fields.
          </Typography>
          <TextField size="small" fullWidth multiline minRows={3} autoFocus
            label="Describe the role"
            value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="e.g. PMO role responsible for reading BRDs and creating JIRA tickets" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAiGenerate}
            disabled={aiLoading || !aiPrompt.trim()}
            startIcon={aiLoading ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
            sx={{ bgcolor: PURPLE, '&:hover': { bgcolor: '#7C3AED' } }}>
            Generate
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function RolesTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [editRole, setEditRole] = useState<AgentRole | null>(null)
  const [newOpen, setNewOpen]   = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: roles = [], isLoading, refetch } = useQuery<AgentRole[]>({
    queryKey: ['agentic-roles'],
    queryFn: agenticApi.listRoles,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => agenticApi.deleteRole(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agentic-roles'] }); enqueueSnackbar('Role deleted', { variant: 'info' }) },
  })

  const FIELDS = [
    { label: 'Description',       key: 'description' as const },
    { label: 'Responsibilities',  key: 'responsibilities' as const },
    { label: 'Skills',            key: 'skills' as const },
    { label: 'Input Expectation', key: 'input_expectation' as const },
    { label: 'Output Expectation',key: 'output_expectation' as const },
    { label: 'Decision Logic',    key: 'decision_logic' as const },
    { label: 'Deliverables',      key: 'deliverables' as const },
  ]

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Role templates define behaviour — multiple employees can share the same role.
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh"><IconButton size="small" onClick={() => refetch()}><RefreshOutlined /></IconButton></Tooltip>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setNewOpen(true)}>New Role</Button>
      </Box>

      {isLoading && <LinearProgress />}
      {!isLoading && roles.length === 0 && (
        <Alert severity="info">No roles yet. Default roles (BA, Developer, QA, Manager) are seeded on first migration.</Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 32 }} />
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Role Name</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Tone</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roles.map((role, idx) => {
              const color = roleColor(idx)
              const isOpen = expanded === role.id
              return (
                <>
                  <TableRow key={role.id} hover sx={{ cursor: 'pointer' }}
                    onClick={() => setExpanded(isOpen ? null : role.id)}>
                    <TableCell sx={{ width: 32, color: 'text.disabled' }}>
                      {isOpen ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: alpha(color, 0.15),
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <WorkspacesOutlined sx={{ fontSize: 15, color }} />
                        </Box>
                        <Typography variant="body2" fontWeight={600}>{role.role_name}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {role.tone && (
                        <Chip label={role.tone} size="small"
                          sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(color, 0.1), color }} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={role.is_active ? 'active' : 'inactive'} size="small"
                        sx={{ height: 18, fontSize: '0.65rem',
                          bgcolor: role.is_active ? alpha(tokens.emerald600, 0.1) : alpha('#64748B', 0.1),
                          color: role.is_active ? tokens.emerald600 : '#64748B' }} />
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => setEditRole(role)}><EditOutlined sx={{ fontSize: 15 }} /></IconButton>
                      <IconButton size="small" color="error" disabled={deleteMut.isPending}
                        onClick={() => deleteMut.mutate(role.id)}><DeleteOutlined sx={{ fontSize: 15 }} /></IconButton>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={`${role.id}-detail`}>
                      <TableCell colSpan={5} sx={{ py: 0, bgcolor: (t) => alpha(color, t.palette.mode === 'dark' ? 0.04 : 0.02) }}>
                        <Collapse in={isOpen} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1.5 }}>
                            {FIELDS.map(({ label, key }) => role[key] ? (
                              <Box key={key}>
                                <Typography variant="caption" fontWeight={700} color="text.disabled"
                                  sx={{ display: 'block', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.25 }}>
                                  {label}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
                                  {role[key]}
                                </Typography>
                              </Box>
                            ) : null)}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      <RoleDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {editRole && <RoleDialog open={!!editRole} onClose={() => setEditRole(null)} initial={editRole} />}
    </Box>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — CARDS (workflow pipeline builder)
// ══════════════════════════════════════════════════════════════════════════════

function PipelinePreview({ cards, roles, agents }: {
  cards: AgentCard[]
  roles: AgentRole[]
  agents: Array<{ id: number; name: string; role_id?: number }>
}) {
  const active = cards.filter((c) => c.is_active).slice(0, 10)
  if (!active.length) return (
    <Alert severity="info" sx={{ mb: 2 }}>No active cards yet. Add cards below to build your pipeline.</Alert>
  )
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, overflowX: 'auto' }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary"
        sx={{ display: 'block', mb: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Workflow Pipeline
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content' }}>
        {active.map((card, idx) => {
          const agent  = agents.find((a) => a.id === card.agent_id)
          const role   = roles.find((r) => r.id === (card.role_id ?? agent?.role_id))
          const rIdx   = role ? roles.indexOf(role) : -1
          const color  = rIdx >= 0 ? roleColor(rIdx) : '#64748B'
          const hasLoop = !!card.on_reject_card_id
          return (
            <Box key={card.id} sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ textAlign: 'center', mx: 0.5 }}>
                <Box sx={{ position: 'relative' }}>
                  <Box sx={{ width: 48, height: 48, borderRadius: '50%',
                    bgcolor: alpha(color, 0.15), border: `2px solid ${color}`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    mx: 'auto', mb: 0.5 }}>
                    <Typography variant="caption" fontWeight={700} sx={{ color, fontSize: '0.7rem', lineHeight: 1 }}>
                      {idx + 1}
                    </Typography>
                  </Box>
                  {hasLoop && (
                    <Tooltip title={`On reject: route back to step`}>
                      <LoopOutlined sx={{ position: 'absolute', top: -6, right: -6, fontSize: 14, color: tokens.amber600 }} />
                    </Tooltip>
                  )}
                </Box>
                <Typography variant="caption" fontWeight={700}
                  sx={{ display: 'block', color, fontSize: '0.65rem', maxWidth: 72, textAlign: 'center', lineHeight: 1.2 }}>
                  {agent?.name ?? card.name}
                </Typography>
                {role && (
                  <Typography variant="caption"
                    sx={{ display: 'block', color: 'text.disabled', fontSize: '0.6rem', maxWidth: 72, textAlign: 'center' }}>
                    {role.role_name}
                  </Typography>
                )}
              </Box>
              {idx < active.length - 1 && (
                <KeyboardArrowRightOutlined sx={{ color: 'text.disabled', fontSize: 20, mx: 0 }} />
              )}
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
}

function CardDialog({ open, onClose, initial, roles, agents, allCards }: {
  open: boolean; onClose: () => void; initial?: AgentCard | null
  roles: AgentRole[]
  agents: Array<{ id: number; name: string; role_id?: number; description?: string }>
  allCards: AgentCard[]
}) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [form, setForm] = useState<Partial<AgentCard>>(
    initial ?? { is_mandatory: true, is_active: true, execution_order: 0, max_iterations: 3 }
  )

  const isEdit = !!initial

  // When agent changes, auto-fill role from agent's role
  const handleAgentChange = (agentId: number | '') => {
    const agent = agents.find((a) => a.id === Number(agentId))
    setForm((p) => ({
      ...p,
      agent_id: agentId ? Number(agentId) : undefined,
      role_id: agent?.role_id ?? p.role_id,
    }))
  }

  const saveMut = useMutation({
    mutationFn: () => isEdit ? agenticApi.updateCard(initial!.id, form) : agenticApi.createCard(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentic-cards'] })
      enqueueSnackbar(isEdit ? 'Card updated' : 'Card created', { variant: 'success' })
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      enqueueSnackbar(e.response?.data?.detail ?? 'Save failed', { variant: 'error' }),
  })

  const selectedAgent = agents.find((a) => a.id === form.agent_id)
  const selectedRole  = roles.find((r) => r.id === form.role_id)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Workflow Card' : 'New Workflow Card'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <TextField size="small" fullWidth required label="Step Name"
          value={form.name ?? ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <TextField size="small" fullWidth label="Description"
          value={form.description ?? ''} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />

        {/* Primary: who does this step */}
        <FormControl size="small" fullWidth required>
          <InputLabel>Assigned Employee</InputLabel>
          <Select label="Assigned Employee" value={form.agent_id ?? ''}
            onChange={(e) => handleAgentChange(e.target.value as number | '')}>
            <MenuItem value="">— None (role-based) —</MenuItem>
            {agents.map((a) => {
              const r = roles.find((r) => r.id === a.role_id)
              return (
                <MenuItem key={a.id} value={a.id}>
                  {a.name}{r ? ` (${r.role_name})` : ''}
                </MenuItem>
              )
            })}
          </Select>
        </FormControl>

        {selectedAgent && (
          <Alert severity="info" sx={{ py: 0.5, fontSize: '0.75rem' }}>
            <strong>{selectedAgent.name}</strong>{selectedAgent.description ? ` — ${selectedAgent.description}` : ''}
            {selectedRole && ` · Role: ${selectedRole.role_name}`}
          </Alert>
        )}

        {/* Secondary: override role */}
        <FormControl size="small" fullWidth>
          <InputLabel>Role Override (optional)</InputLabel>
          <Select label="Role Override (optional)" value={form.role_id ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, role_id: e.target.value ? Number(e.target.value) : undefined }))}>
            <MenuItem value="">— Use employee's role —</MenuItem>
            {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.role_name}</MenuItem>)}
          </Select>
        </FormControl>

        <TextField size="small" fullWidth type="number" label="Execution Order"
          value={form.execution_order ?? 0}
          onChange={(e) => setForm((p) => ({ ...p, execution_order: Number(e.target.value) }))} />

        <Divider><Typography variant="caption" color="text.secondary">Loop-Back Routing</Typography></Divider>

        <FormControl size="small" fullWidth>
          <InputLabel>On Reject → Route back to</InputLabel>
          <Select label="On Reject → Route back to" value={form.on_reject_card_id ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, on_reject_card_id: e.target.value ? Number(e.target.value) : undefined }))}>
            <MenuItem value="">— No loop (advance to next) —</MenuItem>
            {allCards.filter((c) => c.id !== initial?.id).map((c) => {
              const a = agents.find((ag) => ag.id === c.agent_id)
              return (
                <MenuItem key={c.id} value={c.id}>
                  [{c.execution_order}] {a?.name ?? c.name}
                </MenuItem>
              )
            })}
          </Select>
        </FormControl>

        <TextField size="small" fullWidth type="number" label="Max Iterations (before escalation)"
          value={form.max_iterations ?? 3}
          onChange={(e) => setForm((p) => ({ ...p, max_iterations: Number(e.target.value) }))}
          helperText="How many times this step can loop back before being escalated" />

        <FormControl size="small" fullWidth>
          <InputLabel>Mandatory</InputLabel>
          <Select label="Mandatory" value={form.is_mandatory ? 'yes' : 'no'}
            onChange={(e) => setForm((p) => ({ ...p, is_mandatory: e.target.value === 'yes' }))}>
            <MenuItem value="yes">Yes</MenuItem>
            <MenuItem value="no">No (skip if blocked)</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !form.name?.trim()}
          startIcon={saveMut.isPending ? <CircularProgress size={14} /> : undefined}>
          {isEdit ? 'Save Changes' : 'Add Card'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function CardsTab({ roles }: { roles: AgentRole[] }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [newOpen, setNewOpen]   = useState(false)
  const [editCard, setEditCard] = useState<AgentCard | null>(null)

  const { data: cards = [], isLoading, refetch } = useQuery<AgentCard[]>({
    queryKey: ['agentic-cards'], queryFn: agenticApi.listCards,
  })
  const { data: resources } = useQuery({
    queryKey: ['agentic-resources'], queryFn: () => agenticApi.getResources(),
  })
  const agents = resources?.agents ?? []

  const deleteMut = useMutation({
    mutationFn: (id: number) => agenticApi.deleteCard(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agentic-cards'] }); enqueueSnackbar('Card removed', { variant: 'info' }) },
  })

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Each card assigns a named employee to a workflow step. Set "On Reject" to enable loop-back reviews.
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh"><IconButton size="small" onClick={() => refetch()}><RefreshOutlined /></IconButton></Tooltip>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setNewOpen(true)}>Add Card</Button>
      </Box>

      <PipelinePreview cards={cards} roles={roles} agents={agents} />

      {isLoading && <LinearProgress />}

      {cards.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 60 }}>Order</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Step / Employee</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Position</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>On Reject</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Max Loops</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Active</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cards.map((card) => {
                const agent      = agents.find((a) => a.id === card.agent_id)
                const role       = roles.find((r) => r.id === (card.role_id ?? agent?.role_id))
                const rejectCard = cards.find((c) => c.id === card.on_reject_card_id)
                const rejectAgent = agents.find((a) => a.id === rejectCard?.agent_id)
                const rIdx  = role ? roles.indexOf(role) : -1
                const color = rIdx >= 0 ? roleColor(rIdx) : '#64748B'
                return (
                  <TableRow key={card.id} hover>
                    <TableCell>
                      <Chip label={card.execution_order} size="small"
                        sx={{ height: 20, fontWeight: 700, bgcolor: alpha(color, 0.12), color }} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {agent ? (
                          <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: alpha(color, 0.15),
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Typography variant="caption" fontWeight={700} sx={{ color, fontSize: '0.6rem' }}>
                              {agent.name.slice(0, 2).toUpperCase()}
                            </Typography>
                          </Box>
                        ) : (
                          <Tooltip title="No employee assigned — click Edit to assign one">
                            <Box sx={{ width: 28, height: 28, borderRadius: '50%',
                              border: `2px dashed ${tokens.amber600}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <PersonOutlined sx={{ fontSize: 14, color: tokens.amber600 }} />
                            </Box>
                          </Tooltip>
                        )}
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography variant="body2" fontWeight={600}>{agent?.name ?? card.name}</Typography>
                            {!agent && (
                              <Chip label="Assign employee" size="small"
                                onClick={() => setEditCard(card)}
                                sx={{ height: 16, fontSize: '0.58rem', cursor: 'pointer',
                                  bgcolor: alpha(tokens.amber600, 0.1), color: tokens.amber600,
                                  '&:hover': { bgcolor: alpha(tokens.amber600, 0.2) } }} />
                            )}
                          </Box>
                          {card.description && <Typography variant="caption" color="text.secondary">{card.description}</Typography>}
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {role ? (
                        <Chip label={role.role_name} size="small"
                          sx={{ height: 18, fontSize: '0.625rem', bgcolor: alpha(color, 0.1), color }} />
                      ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                    </TableCell>
                    <TableCell>
                      {rejectCard ? (
                        <Chip icon={<LoopOutlined sx={{ fontSize: 12 }} />}
                          label={rejectAgent?.name ?? rejectCard.name} size="small"
                          sx={{ height: 18, fontSize: '0.625rem', bgcolor: alpha(tokens.amber600, 0.1), color: tokens.amber600 }} />
                      ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{card.max_iterations ?? 3}×</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={card.is_active ? 'Yes' : 'No'} size="small"
                        sx={{ height: 18, fontSize: '0.625rem',
                          bgcolor: card.is_active ? alpha(tokens.sky600, 0.1) : alpha('#64748B', 0.1),
                          color: card.is_active ? tokens.sky600 : '#64748B' }} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => setEditCard(card)}><EditOutlined sx={{ fontSize: 16 }} /></IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => deleteMut.mutate(card.id)} disabled={deleteMut.isPending}>
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

      <CardDialog open={newOpen} onClose={() => setNewOpen(false)} roles={roles} agents={agents} allCards={cards} />
      {editCard && <CardDialog open={!!editCard} onClose={() => setEditCard(null)} initial={editCard} roles={roles} agents={agents} allCards={cards} />}
    </Box>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

function DecisionBadge({ decision }: { decision?: string }) {
  if (!decision) return null
  const meta = DECISION_META[decision]
  if (!meta) return null
  return (
    <Chip icon={meta.icon} label={meta.label} size="small"
      sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha(meta.color, 0.12), color: meta.color }} />
  )
}

function StepNode({ step, index, total, selected, onClick }: {
  step: WorkflowExecutionStep; index: number; total: number; selected: boolean; onClick: () => void
}) {
  const color =
    step.status === 'success'   ? tokens.emerald600
    : step.status === 'failed'  ? tokens.red600
    : step.status === 'escalated' ? '#F97316'
    : step.status === 'running' ? TEAL
    : '#94A3B8'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Box sx={{ textAlign: 'center', cursor: 'pointer', minWidth: 72 }} onClick={onClick}>
        <Box sx={{ position: 'relative', display: 'inline-block' }}>
          <Box sx={{
            width: 44, height: 44, borderRadius: '50%',
            bgcolor: alpha(color, selected ? 0.25 : 0.12),
            border: `2px solid ${color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            mx: 'auto', mb: 0.5, transition: 'all 0.2s',
            boxShadow: selected ? `0 0 0 3px ${alpha(color, 0.3)}` : 'none',
            ...(step.status === 'running' ? {
              animation: 'wfPulse 1.2s ease-in-out infinite',
              '@keyframes wfPulse': {
                '0%, 100%': { boxShadow: `0 0 0 0 ${alpha(color, 0.4)}` },
                '50%': { boxShadow: `0 0 0 8px ${alpha(color, 0)}` },
              },
            } : {}),
          }}>
            {step.status === 'success'   ? <CheckCircleOutlined sx={{ fontSize: 18, color }} />
             : step.status === 'failed'  ? <ErrorOutlined sx={{ fontSize: 18, color }} />
             : step.status === 'escalated' ? <WarningAmberOutlined sx={{ fontSize: 18, color }} />
             : step.status === 'running' ? <CircularProgress size={16} sx={{ color }} />
             : <Typography variant="caption" fontWeight={700} sx={{ color }}>{index + 1}</Typography>}
          </Box>
          {/* Iteration badge */}
          {step.iteration > 1 && (
            <Box sx={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16,
              borderRadius: '50%', bgcolor: tokens.amber600, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: '0.55rem', color: '#fff', fontWeight: 700 }}>{step.iteration}</Typography>
            </Box>
          )}
        </Box>
        {/* Name */}
        <Typography variant="caption" fontWeight={700}
          sx={{ display: 'block', color, fontSize: '0.65rem', maxWidth: 72, lineHeight: 1.2 }}>
          {step.agent_name ?? step.card_name ?? `Step ${index + 1}`}
        </Typography>
        <Typography variant="caption"
          sx={{ display: 'block', color: 'text.disabled', fontSize: '0.6rem', maxWidth: 72 }}>
          {step.role_name ?? ''}
        </Typography>
        {step.execution_time_ms != null && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: '0.6rem' }}>
            {(step.execution_time_ms / 1000).toFixed(1)}s
          </Typography>
        )}
        {step.decision && <DecisionBadge decision={step.decision} />}
      </Box>
      {index < total - 1 && (
        <Box sx={{ width: 20, height: 2, bgcolor: 'divider', mx: 0.5, flexShrink: 0 }} />
      )}
    </Box>
  )
}

// ── Artefact extraction ───────────────────────────────────────────────────────
type Artefact = { type: string; label: string; body: string }

function parseArtefacts(output: string): { clean: string; artefacts: Artefact[] } {
  const markers = [
    { key: 'Report Result',          color: '#0ea5e9', icon: '📊' },
    { key: 'Report Error',           color: '#ef4444', icon: '⚠️' },
    { key: 'Dev Plan Created',       color: '#22c55e', icon: '🛠️' },
    { key: 'Dev Plan Error',         color: '#ef4444', icon: '⚠️' },
    { key: 'Dashboard Generated',    color: '#a855f7', icon: '📈' },
    { key: 'Dashboard Error',        color: '#ef4444', icon: '⚠️' },
    { key: 'Test Cases Generated',   color: '#f59e0b', icon: '✅' },
    { key: 'Test Error',             color: '#ef4444', icon: '⚠️' },
  ]
  const artefacts: Artefact[] = []
  // Split on --- separator blocks that contain a marker
  const parts = output.split(/\n---\n/)
  const cleanParts: string[] = []
  for (const part of parts) {
    const found = markers.find(m => part.includes(`**[${m.key}]**`))
    if (found) {
      const firstLine = part.trim().split('\n')[0]
      const label = firstLine.replace(/\*\*/g, '').replace(/\[|\]/g, '').trim()
      artefacts.push({ type: found.key, label, body: part.trim() })
    } else {
      cleanParts.push(part)
    }
  }
  return { clean: cleanParts.join('\n---\n').trim(), artefacts }
}

type ArtefactMetaEntry = {
  color: string
  MuiIcon: React.ElementType
  route: string
  label: string
}
const ARTEFACT_META: Record<string, ArtefactMetaEntry> = {
  'Report Result':        { color: '#0ea5e9', MuiIcon: AssessmentOutlined,  route: '/reports',     label: 'Open in Reports' },
  'Dev Plan Created':     { color: '#22c55e', MuiIcon: CodeOutlined,         route: '/development', label: 'Open in Development' },
  'Dashboard Generated':  { color: '#a855f7', MuiIcon: DashboardOutlined,   route: '/dashboards',  label: 'Open in Dashboards' },
  'Test Cases Generated': { color: '#f59e0b', MuiIcon: BugReportOutlined,   route: '/testing',     label: 'Open in Testing' },
  'Report Error':         { color: '#ef4444', MuiIcon: ErrorOutlined,        route: '',             label: '' },
  'Dev Plan Error':       { color: '#ef4444', MuiIcon: ErrorOutlined,        route: '',             label: '' },
  'Dashboard Error':      { color: '#ef4444', MuiIcon: ErrorOutlined,        route: '',             label: '' },
  'Test Error':           { color: '#ef4444', MuiIcon: ErrorOutlined,        route: '',             label: '' },
}

function ArtefactCard({ a }: { a: Artefact }) {
  const navigate = useNavigate()
  const meta = ARTEFACT_META[a.type] ?? { color: '#ef4444', MuiIcon: ErrorOutlined, route: '', label: '' }
  const { color, MuiIcon, route, label } = meta
  const isError = a.type.includes('Error')

  // Extract key details from body text
  const rowMatch      = a.body.match(/Rows returned:\s*(\d+)/)
  const colsMatch     = a.body.match(/Columns:\s*(.+)/)
  const idMatch       = a.body.match(/(?:artifact_id|report #|dashboard #)\s*[=]?\s*(\d+)/i)
  const sqlMatch      = a.body.match(/SQL:\s*`([^`]+)`/)
  const stepsMatch    = a.body.match(/Steps \((\d+)\):(.+)/)
  const widgetMatch   = a.body.match(/Widgets:\s*(\d+)/)
  const casesMatch    = a.body.match(/(\d+) cases/)
  const caseNames     = a.body.match(/Cases: (.+)/)
  const testConnMatch = a.body.match(/conn_id=(\d+)/)

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    const state: Record<string, unknown> = {}
    if (a.type === 'Report Result'        && sqlMatch)       state.autoRunSql  = sqlMatch[1]
    if (a.type === 'Dev Plan Created'     && idMatch)        state.artifactId  = Number(idMatch[1])
    if (a.type === 'Dashboard Generated'  && idMatch)        state.dashboardId = Number(idMatch[1])
    if (a.type === 'Test Cases Generated' && testConnMatch)  state.testConnId  = Number(testConnMatch[1])
    navigate(route, { state })
  }

  return (
    <Card variant="outlined" sx={{
      borderRadius: 2, borderColor: alpha(color, 0.35), mb: 1.25,
      borderLeft: `4px solid ${color}`,
      bgcolor: (t) => alpha(color, t.palette.mode === 'dark' ? 0.06 : 0.03),
    }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: isError || !route ? 1.5 : 0 } }}>

        {/* ── Header ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isError ? 0.5 : 1 }}>
          <MuiIcon sx={{ fontSize: 18, color }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ color, flex: 1 }}>
            {a.type}
          </Typography>
          {idMatch && (
            <Chip label={`#${idMatch[1]}`} size="small"
              sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700,
                bgcolor: alpha(color, 0.12), color }} />
          )}
        </Box>

        {/* ── Error body ── */}
        {isError && (
          <Alert severity="error" sx={{ py: 0.25, fontSize: '0.72rem' }}>
            {a.body.replace(/^.*?\n/, '').trim()}
          </Alert>
        )}

        {/* ── Success metrics ── */}
        {!isError && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {rowMatch && (
              <Box>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.4 }}>Rows</Typography>
                <Typography variant="body2" fontWeight={700} sx={{ color }}>{rowMatch[1]}</Typography>
              </Box>
            )}
            {widgetMatch && (
              <Box>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.4 }}>Widgets</Typography>
                <Typography variant="body2" fontWeight={700} sx={{ color }}>{widgetMatch[1]}</Typography>
              </Box>
            )}
            {casesMatch && (
              <Box>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.4 }}>Test Cases</Typography>
                <Typography variant="body2" fontWeight={700} sx={{ color }}>{casesMatch[1]}</Typography>
              </Box>
            )}
            {stepsMatch && (
              <Box>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.4 }}>Steps</Typography>
                <Typography variant="body2" fontWeight={700} sx={{ color }}>{stepsMatch[1]}</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* ── Secondary details ── */}
        {!isError && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {sqlMatch && (
              <Box sx={{ fontFamily: 'monospace', fontSize: '0.68rem',
                bgcolor: (t) => alpha(t.palette.text.primary, 0.04),
                borderRadius: 1, px: 1, py: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 72, overflowY: 'auto', color: 'text.secondary' }}>
                {sqlMatch[1]}
              </Box>
            )}
            {colsMatch && (
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>
                {colsMatch[1]}
              </Typography>
            )}
            {stepsMatch && stepsMatch[2] && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {stepsMatch[2].trim()}
              </Typography>
            )}
            {caseNames && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                {caseNames[1]}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>

      {/* ── Action footer ── */}
      {route && (
        <CardActions sx={{ px: 2, pt: 0, pb: 1.25 }}>
          <Button
            fullWidth
            variant="outlined"
            size="small"
            startIcon={<OpenInNewOutlined sx={{ fontSize: 15 }} />}
            onClick={handleOpen}
            sx={{ fontSize: '0.75rem', fontWeight: 700, borderColor: alpha(color, 0.5), color,
              '&:hover': { borderColor: color, bgcolor: alpha(color, 0.06) } }}
          >
            {label}
          </Button>
        </CardActions>
      )}
    </Card>
  )
}

// ── SQL extraction + inline execution ────────────────────────────────────────

function extractSqlBlocks(text: string): string[] {
  const blocks: string[] = []
  // Match ```sql ... ``` and ``` ... ``` fences
  const fenceRe = /```(?:sql)?\s*\n?([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    const sql = m[1].trim()
    if (sql.length > 10) blocks.push(sql)
  }
  return blocks
}

function SqlBlock({ sql, connId }: { sql: string; connId?: number }) {
  const [status, setStatus]   = useState<'idle' | 'confirm' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult]   = useState<{ type: string; rowcount?: number; message?: string; columns?: string[]; rows?: unknown[][] } | null>(null)
  const [errMsg, setErrMsg]   = useState('')
  const isDml = /^\s*(INSERT|UPDATE|DELETE|MERGE|EXEC)/i.test(sql)

  async function handleRun(confirmed = false) {
    if (!connId) { setErrMsg('No connection selected — select a connection in the global header first.'); setStatus('error'); return }
    if (isDml && !confirmed) { setStatus('confirm'); return }
    setStatus('running'); setResult(null); setErrMsg('')
    try {
      const res = await connectionsApi.executeSql(connId, sql, confirmed || !isDml)
      setResult(res as typeof result)
      setStatus('done')
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string | { message?: string } } } })?.response?.data?.detail
      const msg = typeof detail === 'object' ? detail?.message ?? 'Execution failed' : (detail ?? 'Execution failed')
      setErrMsg(msg)
      setStatus('error')
    }
  }

  return (
    <Box sx={{ my: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      {/* SQL code block */}
      <Box sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.04), px: 1.5, py: 1,
        fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        overflowX: 'auto', maxHeight: 200, overflowY: 'auto', color: 'text.primary', lineHeight: 1.6 }}>
        {sql}
      </Box>

      {/* Action bar */}
      <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1, bgcolor: (t) => alpha(t.palette.background.paper, 0.6) }}>
        {isDml && (
          <Chip label="DML" size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700,
            bgcolor: alpha(tokens.amber600, 0.12), color: tokens.amber600 }} />
        )}
        {status === 'idle' && (
          <Tooltip title={!connId ? 'Select a connection in the header to run queries' : ''}>
            <span>
              <Button size="small" variant="contained" onClick={() => handleRun(false)}
                disabled={!connId}
                startIcon={<PlayArrowOutlined sx={{ fontSize: 14 }} />}
                sx={{ fontSize: '0.7rem', py: 0.25, px: 1.25, bgcolor: isDml ? tokens.amber600 : TEAL,
                  '&:hover': { bgcolor: isDml ? '#D97706' : '#0284C7' } }}>
                {isDml ? 'Execute (DML)' : 'Run Query'}
              </Button>
            </span>
          </Tooltip>
        )}
        {status === 'confirm' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="warning.main" fontWeight={600}>
              This will modify data. Are you sure?
            </Typography>
            <Button size="small" variant="contained" color="warning" onClick={() => handleRun(true)}
              sx={{ fontSize: '0.7rem', py: 0.2, px: 1 }}>Confirm Execute</Button>
            <Button size="small" onClick={() => setStatus('idle')}
              sx={{ fontSize: '0.7rem', py: 0.2, px: 1 }}>Cancel</Button>
          </Box>
        )}
        {status === 'running' && <CircularProgress size={14} sx={{ color: TEAL }} />}
        {status === 'done' && result && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleOutlined sx={{ fontSize: 14, color: tokens.emerald600 }} />
            <Typography variant="caption" color="success.main" fontWeight={600}>
              {result.type === 'dml' ? result.message : `${result.rows?.length ?? 0} row(s) returned`}
            </Typography>
            <Button size="small" onClick={() => setStatus('idle')} sx={{ fontSize: '0.68rem', p: 0, minWidth: 0, color: 'text.disabled' }}>Reset</Button>
          </Box>
        )}
        {status === 'error' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ErrorOutlined sx={{ fontSize: 14, color: tokens.red600 }} />
            <Typography variant="caption" color="error" sx={{ fontSize: '0.7rem' }}>{errMsg}</Typography>
            <Button size="small" onClick={() => setStatus('idle')} sx={{ fontSize: '0.68rem', p: 0, minWidth: 0, color: 'text.disabled' }}>Reset</Button>
          </Box>
        )}
      </Box>

      {/* Results table for SELECT */}
      {status === 'done' && result?.type === 'select' && result.rows && result.rows.length > 0 && (
        <Box sx={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto', borderTop: '1px solid', borderColor: 'divider' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.04) }}>
                {result.columns?.map((c) => (
                  <TableCell key={c} sx={{ fontWeight: 700, fontSize: '0.65rem', py: 0.5, whiteSpace: 'nowrap' }}>{c}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {result.rows.slice(0, 50).map((row, ri) => (
                <TableRow key={ri} hover>
                  {(row as unknown[]).map((cell, ci) => (
                    <TableCell key={ci} sx={{ fontSize: '0.68rem', py: 0.4, whiteSpace: 'nowrap' }}>
                      {String(cell ?? '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  )
}

function StepDetail({ step }: { step: WorkflowExecutionStep }) {
  const activeConnection = useAppStore((s) => s.activeConnection)
  const [showInput, setShowInput]     = useState(false)
  const [showPrompt, setShowPrompt]   = useState(false)
  const [showFull, setShowFull]       = useState(false)
  const raw = step.output_text ?? ''
  const { clean: output, artefacts } = parseArtefacts(raw)
  const truncated = output.length > 600
  const sqlBlocks = extractSqlBlocks(raw)

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, mt: 1.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {step.agent_name ?? step.card_name}
        </Typography>
        {step.role_name && (
          <Chip label={step.role_name} size="small"
            sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(PURPLE, 0.1), color: PURPLE }} />
        )}
        {step.iteration > 1 && (
          <Chip icon={<LoopOutlined sx={{ fontSize: 11 }} />} label={`Iteration ${step.iteration}`}
            size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(tokens.amber600, 0.1), color: tokens.amber600 }} />
        )}
        <DecisionBadge decision={step.decision} />
        {step.execution_time_ms != null && (
          <Chip label={`${(step.execution_time_ms / 1000).toFixed(2)}s`} size="small"
            sx={{ height: 16, fontSize: '0.6rem' }} />
        )}
      </Box>

      {/* Decision notes */}
      {step.decision_notes && step.decision !== 'APPROVE' && (
        <Alert severity={step.decision === 'REJECT' || step.decision === 'REVISE' ? 'warning' : 'info'}
          sx={{ mb: 1.5, fontSize: '0.75rem', py: 0.5 }}>
          <strong>Feedback:</strong> {step.decision_notes}
        </Alert>
      )}

      {/* Output */}
      <Typography variant="caption" fontWeight={700} color="text.disabled"
        sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
        Output
      </Typography>
      <Box sx={{ fontSize: '0.8rem', lineHeight: 1.6, mb: 1.5,
        '& p': { mb: 0.75 }, '& ul, & ol': { pl: 2.5, mb: 0.75 },
        '& code': { fontFamily: 'monospace', fontSize: '0.75rem',
          bgcolor: (t) => alpha(t.palette.text.primary, 0.06), px: 0.5, borderRadius: 0.5 } }}>
        <ReactMarkdown>{showFull || !truncated ? output : output.slice(0, 600) + '…'}</ReactMarkdown>
        {truncated && (
          <Button size="small" onClick={() => setShowFull((v) => !v)} sx={{ fontSize: '0.7rem', p: 0 }}>
            {showFull ? 'Show less' : 'Show more'}
          </Button>
        )}
      </Box>

      {/* Artefacts created by module tools */}
      {artefacts.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" fontWeight={700} color="text.disabled"
            sx={{ display: 'block', mb: 0.75, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
            Artefacts Created ({artefacts.length})
          </Typography>
          {artefacts.map((a, i) => <ArtefactCard key={i} a={a} />)}
        </Box>
      )}

      {/* Executable SQL blocks */}
      {sqlBlocks.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography variant="caption" fontWeight={700} color="text.disabled"
              sx={{ textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
              Execute SQL ({sqlBlocks.length} {sqlBlocks.length === 1 ? 'block' : 'blocks'})
            </Typography>
            {!activeConnection && (
              <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.65rem' }}>
                — select a connection in the header to enable
              </Typography>
            )}
          </Box>
          {sqlBlocks.map((sql, i) => (
            <SqlBlock key={i} sql={sql} connId={activeConnection?.id} />
          ))}
        </Box>
      )}

      {/* Collapsibles */}
      <Button size="small" onClick={() => setShowInput((v) => !v)}
        endIcon={showInput ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
        sx={{ fontSize: '0.7rem', color: 'text.secondary', p: 0, mb: 0.5 }}>Input</Button>
      <Collapse in={showInput}>
        <Box sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03), borderRadius: 1.5, p: 1, mb: 1,
          fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 160, overflowY: 'auto', color: 'text.secondary' }}>
          {step.input_text ?? '—'}
        </Box>
      </Collapse>

      <Button size="small" onClick={() => setShowPrompt((v) => !v)}
        endIcon={showPrompt ? <ExpandLess sx={{ fontSize: 14 }} /> : <ExpandMore sx={{ fontSize: 14 }} />}
        sx={{ fontSize: '0.7rem', color: 'text.secondary', p: 0 }}>Prompt Used</Button>
      <Collapse in={showPrompt}>
        <Box sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03), borderRadius: 1.5, p: 1, mt: 0.5,
          fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 200, overflowY: 'auto', color: 'text.secondary' }}>
          {step.prompt_used ?? '—'}
        </Box>
      </Collapse>
    </Paper>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — WORKFLOWS (combined execution + saved workflows)
// ══════════════════════════════════════════════════════════════════════════════

const SCHEDULE_OPTIONS = [
  { value: 'none',    label: 'On-demand only' },
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

function WorkflowsTab({ setTab }: { setTab: (v: number) => void }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection = useAppStore((s) => s.activeConnection)

  // ── Dialog state (new / edit workflow) ────────────────────────────────────
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [editingWf, setEditingWf]     = useState<SavedAgenticWorkflow | null>(null)

  // ── Workflow metadata fields (used in dialog) ──────────────────────────────
  const [wfName, setWfName]           = useState('')
  const [wfDesc, setWfDesc]           = useState('')
  const [wfSched, setWfSched]         = useState('none')
  const [model, setModel]             = useState('gpt-4o-mini')
  const [query, setQuery]             = useState('')

  // Connection always comes from the global active connection in the header
  const connId = activeConnection?.id ?? ''

  // ── Execution output ───────────────────────────────────────────────────────
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const [result, setResult]           = useState<{ execution: WorkflowExecution; steps: WorkflowExecutionStep[] } | null>(null)
  const [running, setRunning]         = useState(false)
  const [runningWfId, setRunningWfId] = useState<number | null>(null)
  const [runError, setRunError]       = useState<string | null>(null)
  const resultsRef  = useRef<HTMLDivElement>(null)
  const abortRef    = useRef<AbortController | null>(null)
  const [pendingAutoRun, setPendingAutoRun] = useState(false)

  // Live streaming state
  const [liveSteps,    setLiveSteps]    = useState<WorkflowExecutionStep[]>([])
  const [thinkingCard, setThinkingCard] = useState<{ step_number: number; card_name: string; agent_name?: string; role_name?: string } | null>(null)
  const [totalSteps,   setTotalSteps]   = useState(0)

  // Auto-scroll to live panel when streaming starts
  useEffect(() => {
    if ((running || result) && resultsRef.current) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }, [running, result])

  // ── Dialog helpers ─────────────────────────────────────────────────────────
  function openNewDialog() {
    setEditingWf(null)
    setWfName(''); setWfDesc(''); setWfSched('none'); setModel('gpt-4o-mini'); setQuery('')
    setDialogOpen(true)
  }

  function openEditDialog(w: SavedAgenticWorkflow) {
    setEditingWf(w)
    setWfName(w.name)
    setWfDesc(w.description ?? '')
    setWfSched(w.schedule_label ?? 'none')
    setModel(w.model ?? 'gpt-4o-mini')
    setQuery(w.user_query)
    setDialogOpen(true)
  }

  // Kept for rerun from History tab
  const [quickRunOpen, setQuickRunOpen] = useState(false)
  const [quickRunQuery, setQuickRunQuery] = useState('')

  // ── Shared streaming runner ────────────────────────────────────────────────
  async function startStream(userQuery: string, wf?: SavedAgenticWorkflow) {
    if (running) return
    // Cancel any previous stream
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setResult(null); setRunError(null); setSelectedStep(null)
    setLiveSteps([]); setThinkingCard(null); setTotalSteps(0)
    setRunning(true)
    if (wf) setRunningWfId(wf.id)

    try {
      await agenticApi.streamWorkflow(
        { conn_id: connId ? Number(connId) : undefined, user_query: userQuery, model: wf?.model ?? model },
        {
          onStart: (d) => setTotalSteps(d.total_steps),
          onThinking: (d) => setThinkingCard({ step_number: d.step_number, card_name: d.card_name, agent_name: d.agent_name, role_name: d.role_name }),
          onStep: (step) => {
            setThinkingCard(null)
            setLiveSteps((prev) => [...prev, step])
          },
          onDone: (res) => {
            setThinkingCard(null)
            setResult(res)
            setLiveSteps([])
            refetchExecs()
            if (wf) refetchWorkflows()
            enqueueSnackbar(
              `${wf ? `"${wf.name}"` : 'Workflow'} complete — ${res.steps.length} steps`,
              { variant: 'success' }
            )
          },
          onError: (msg) => setRunError(msg),
        },
        ac.signal,
      )
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') return
      setRunError((e instanceof Error ? e.message : 'Workflow failed'))
    } finally {
      setRunning(false)
      setRunningWfId(null)
      setThinkingCard(null)
    }
  }

  async function handleQuickRun() {
    if (!quickRunQuery.trim()) return
    setQuickRunOpen(false)
    startStream(quickRunQuery)
  }

  async function runPipelineDirectly() {
    // Auto-generate query from the pipeline cards — no user input needed
    const activeCards = cards.filter(c => c.is_active).sort((a, b) => a.execution_order - b.execution_order)
    const pipelineDesc = activeCards
      .map(c => {
        const agent = allAgents.find((a: { id: number; name: string }) => a.id === c.agent_id)
        return `${agent?.name ?? c.name}: ${c.description ?? c.name}`
      })
      .join(' → ')
    const autoQuery = `Execute the defined pipeline workflow.\n\nPipeline steps:\n${pipelineDesc}\n\nEach employee should carry out their assigned step based on the pipeline design and hand off their output to the next step.`

    setQuery(autoQuery)
    startStream(autoQuery)
  }

  const [designOpen, setDesignOpen]   = useState(false)
  const [designReq, setDesignReq]     = useState('')
  const [designBrd, setDesignBrd]     = useState('')
  const [designing, setDesigning]     = useState(false)
  const [applying, setApplying]       = useState(false)
  const [designResult, setDesignResult] = useState<Array<Partial<AgentCard> & { rationale?: string; suggested_tools?: string[] }>>([])

  // JIRA / source toggle inside designer
  const [brdSource, setBrdSource]   = useState<'text' | 'jira'>('text')
  const [jiraKey, setJiraKey]       = useState('')
  const [jiraFetching, setJiraFetching] = useState(false)

  const activeProject = useAppStore((s) => s.activeProject)
  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
    staleTime: 60_000,
  })
  const jiraConfigured = integrations.some((i: { type: string; has_token: boolean }) => i.type === 'jira' && i.has_token)

  async function fetchFromJira() {
    if (!jiraKey.trim()) return
    setJiraFetching(true)
    try {
      const res = await developmentApi.fetchExternal({
        source_type: 'jira',
        resource_id: jiraKey.trim(),
        project_id: activeProject?.id,
      })
      setDesignBrd(res.text)
      if (!designReq.trim()) setDesignReq(`Read JIRA ${jiraKey.trim()} and create a workflow`)
      enqueueSnackbar(`JIRA ${jiraKey.trim()} loaded — ${res.text.length} chars`, { variant: 'success' })
    } catch (e: unknown) {
      enqueueSnackbar((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'JIRA fetch failed', { variant: 'error' })
    } finally { setJiraFetching(false) }
  }

  const { data: executions = [], refetch: refetchExecs } = useQuery<WorkflowExecution[]>({
    queryKey: ['agentic-executions'], queryFn: () => agenticApi.listExecutions(10),
  })

  // Load cards + resources to detect unassigned employees
  const { data: cards = [] } = useQuery<AgentCard[]>({
    queryKey: ['agentic-cards'], queryFn: agenticApi.listCards,
  })
  const { data: resources } = useQuery({
    queryKey: ['agentic-resources'], queryFn: () => agenticApi.getResources(),
  })
  const allRoles  = resources?.roles  ?? []
  const allAgents = resources?.agents ?? []

  // Quick-assign state: cardId → selected agentId
  const [quickAssign, setQuickAssign] = useState<Record<number, number | ''>>({})
  const unassignedCards = cards.filter((c) => c.is_active && !c.agent_id)

  async function saveQuickAssign(cardId: number) {
    const agentId = quickAssign[cardId]
    if (!agentId) return
    const card = cards.find((c) => c.id === cardId)
    if (!card) return
    const agent = allAgents.find((a) => a.id === Number(agentId))
    try {
      await agenticApi.updateCard(cardId, {
        ...card,
        agent_id: Number(agentId),
        role_id: card.role_id ?? agent?.role_id ?? undefined,
      })
      qc.invalidateQueries({ queryKey: ['agentic-cards'] })
      enqueueSnackbar(`${agent?.name ?? 'Employee'} assigned to "${card.name}"`, { variant: 'success' })
      setQuickAssign((p) => { const n = { ...p }; delete n[cardId]; return n })
    } catch {
      enqueueSnackbar('Assign failed', { variant: 'error' })
    }
  }

  async function handleRun() {
    if (!query.trim()) return
    startStream(query)
  }

  // On mount: pick up rerun request from History tab (stored in sessionStorage)
  useEffect(() => {
    const pending = sessionStorage.getItem('agenticRerun')
    if (!pending) return
    sessionStorage.removeItem('agenticRerun')
    try {
      const d = JSON.parse(pending)
      if (d.query)  setQuery(d.query)
      if (d.model)  setModel(d.model)
      setPendingAutoRun(true)
    } catch { /* ignore malformed data */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fire once query state has settled after a rerun request
  useEffect(() => {
    if (pendingAutoRun && query.trim()) {
      setPendingAutoRun(false)
      handleRun()
    }
  }, [pendingAutoRun, query]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDesign() {
    if (!designReq.trim()) return
    setDesigning(true)
    try {
      const res = await agenticApi.designWorkflow(
        designReq,
        connId ? Number(connId) : undefined,
        designBrd.trim() || undefined,
      )
      setDesignResult(res.cards)
      enqueueSnackbar(`AI designed ${res.cards.length} workflow steps — review below`, { variant: 'info' })
    } catch (e: unknown) {
      enqueueSnackbar((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Design failed', { variant: 'error' })
    } finally { setDesigning(false) }
  }

  async function handleApplyWorkflow() {
    if (!designResult.length) return
    setApplying(true)
    try {
      const res = await agenticApi.applyWorkflow(designResult)
      enqueueSnackbar(`Pipeline applied — ${res.created} cards created. Go to the Cards tab to review.`, { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['agentic-cards'] })
      setDesignOpen(false)
      setDesignResult([])
      setDesignReq('')
      setDesignBrd('')
      setJiraKey('')
      setBrdSource('text')
    } catch (e: unknown) {
      enqueueSnackbar((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Apply failed', { variant: 'error' })
    } finally { setApplying(false) }
  }

  async function loadExecution(id: number) {
    try {
      const res = await agenticApi.getExecution(id)
      setResult(res); setSelectedStep(null)
    } catch { enqueueSnackbar('Failed to load execution', { variant: 'error' }) }
  }

  // ── Saved workflows query ──────────────────────────────────────────────────
  const { data: workflows = [], isLoading: wfLoading, refetch: refetchWorkflows } = useQuery<SavedAgenticWorkflow[]>({
    queryKey: ['saved-agentic-workflows'],
    queryFn: () => agenticApi.listSavedWorkflows(),
  })

  // ── Save / Update (dialog submit) ─────────────────────────────────────────
  async function handleDialogSave() {
    if (!wfName.trim()) { enqueueSnackbar('Workflow name is required', { variant: 'warning' }); return }
    try {
      const payload = {
        name: wfName, description: wfDesc || undefined, user_query: query,
        conn_id: connId ? Number(connId) : undefined, model, schedule_label: wfSched,
      }
      if (editingWf) {
        await agenticApi.updateSavedWorkflow(editingWf.id, payload)
        enqueueSnackbar('Workflow updated', { variant: 'success' })
      } else {
        await agenticApi.createSavedWorkflow(payload)
        enqueueSnackbar('Workflow saved', { variant: 'success' })
      }
      await refetchWorkflows()
      setDialogOpen(false)
    } catch (e: unknown) {
      enqueueSnackbar((e as Error).message ?? 'Save failed', { variant: 'error' })
    }
  }

  async function handleDeleteWorkflow(w: SavedAgenticWorkflow) {
    try {
      await agenticApi.deleteSavedWorkflow(w.id)
      await refetchWorkflows()
      if (result) { setResult(null); setRunError(null) }
      enqueueSnackbar('Workflow deleted', { variant: 'info' })
    } catch (e: unknown) {
      enqueueSnackbar((e as Error).message ?? 'Delete failed', { variant: 'error' })
    }
  }

  // ── Run a specific saved workflow ──────────────────────────────────────────
  function runSavedWorkflow(w: SavedAgenticWorkflow) {
    startStream(w.user_query, w)
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Fixed header bar ──────────────────────────────────────────────── */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex',
        alignItems: 'center', gap: 1.5, minHeight: 56, flexShrink: 0 }}>
        <BoltOutlined color="primary" sx={{ fontSize: 22 }} />
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>Workflows</Typography>
          <Typography variant="caption" color="text.secondary">AI-powered multi-agent workflows</Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {activeConnection ? (
            <Chip icon={<StorageOutlined sx={{ fontSize: 14 }} />}
              label={activeConnection.name} size="small" variant="outlined"
              sx={{ fontSize: '0.72rem', borderColor: alpha(TEAL, 0.4), color: TEAL }} />
          ) : (
            <Chip label="No connection" size="small" variant="outlined" sx={{ fontSize: '0.72rem', opacity: 0.5 }} />
          )}
          <Button variant="contained" size="small" startIcon={<AddOutlined sx={{ fontSize: 16 }} />}
            onClick={openNewDialog}
            sx={{ bgcolor: TEAL, '&:hover': { bgcolor: '#0284C7' }, fontWeight: 700, fontSize: '0.8rem' }}>
            New Workflow
          </Button>
        </Box>
      </Box>


      {/* ── Main scrollable area ──────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

        {/* ── Pipeline flow (LangGraph-style) ───────────────────────────── */}
        {cards.filter(c => c.is_active).length > 0 && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary"
              sx={{ display: 'block', mb: 1.5, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
              Active Pipeline — {cards.filter(c => c.is_active).length} steps
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0 }}>
              {cards.filter(c => c.is_active).sort((a, b) => a.execution_order - b.execution_order).map((card, idx, arr) => {
                const agent = allAgents.find((a: { id: number; name: string; role_id?: number }) => a.id === card.agent_id)
                const role  = allRoles.find((r: AgentRole) => r.id === (card.role_id ?? (agent as { role_id?: number } | undefined)?.role_id))
                const rIdx  = role ? allRoles.indexOf(role) : -1
                const col   = rIdx >= 0 ? roleColor(rIdx) : '#64748B'
                const isLast = idx === arr.length - 1
                const hasLoop = card.on_reject_card_id != null
                return (
                  <Box key={card.id} sx={{ display: 'flex', alignItems: 'center' }}>
                    {/* Node */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 88 }}>
                      <Box sx={{ width: 56, height: 56, borderRadius: '50%',
                        border: `2px solid ${col}`,
                        bgcolor: agent ? alpha(col, 0.12) : 'transparent',
                        borderStyle: agent ? 'solid' : 'dashed',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative' }}>
                        <Typography variant="caption" fontWeight={800}
                          sx={{ color: col, fontSize: '0.7rem', textAlign: 'center', lineHeight: 1.1, px: 0.5 }}>
                          {agent ? agent.name.slice(0, 2).toUpperCase() : '?'}
                        </Typography>
                        {hasLoop && (
                          <Box sx={{ position: 'absolute', top: -4, right: -4,
                            width: 14, height: 14, borderRadius: '50%',
                            bgcolor: tokens.amber600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <LoopOutlined sx={{ fontSize: 9, color: '#fff' }} />
                          </Box>
                        )}
                      </Box>
                      <Typography variant="caption" sx={{ mt: 0.5, fontSize: '0.65rem', fontWeight: 600, color: col, textAlign: 'center', maxWidth: 80, lineHeight: 1.2 }}>
                        {agent?.name ?? <span style={{ color: tokens.amber600 }}>Unassigned</span>}
                      </Typography>
                      {role && (
                        <Typography variant="caption" sx={{ fontSize: '0.58rem', color: 'text.disabled', textAlign: 'center' }}>
                          {role.role_name}
                        </Typography>
                      )}
                    </Box>
                    {/* Arrow */}
                    {!isLast && (
                      <Box sx={{ display: 'flex', alignItems: 'center', mx: 0.25 }}>
                        <Box sx={{ width: 20, height: 2, bgcolor: 'divider' }} />
                        <KeyboardArrowRightOutlined sx={{ fontSize: 16, color: 'text.disabled', mx: -0.5 }} />
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          </Paper>
        )}

        {/* ── Saved Workflows Table ──────────────────────────────────────── */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {running && <LinearProgress sx={{ height: 3 }} />}
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Schedule</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Model</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Last Run</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 120 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {wfLoading && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: 'center', py: 3 }}>
                    <CircularProgress size={24} sx={{ color: TEAL }} />
                  </TableCell>
                </TableRow>
              )}
              {!wfLoading && workflows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Box sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>
                      <BoltOutlined sx={{ fontSize: 36, opacity: 0.25, display: 'block', mx: 'auto', mb: 1 }} />
                      <Typography variant="body2">No workflows yet</Typography>
                      <Typography variant="caption">Click "New Workflow" to create your first one</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
              {workflows.map((w) => {
                const schedLabel = SCHEDULE_OPTIONS.find(o => o.value === (w.schedule_label ?? 'none'))?.label ?? 'On-demand'
                const lastRan    = w.last_run_at ? new Date(w.last_run_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'
                const isRunningThis = runningWfId === w.id
                return (
                  <TableRow key={w.id} hover
                    sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{w.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary"
                        sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {w.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {w.schedule_label && w.schedule_label !== 'none' ? (
                        <Chip icon={<ScheduleOutlined sx={{ fontSize: 12 }} />} label={schedLabel}
                          size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(PURPLE, 0.08), color: PURPLE }} />
                      ) : (
                        <Typography variant="caption" color="text.disabled">On-demand</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{w.model ?? 'gpt-4o-mini'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">{lastRan}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title={isRunningThis ? 'Running…' : running ? 'Another workflow is running' : 'Run workflow'}>
                          <span>
                            <IconButton size="small"
                              onClick={() => { if (!running) runSavedWorkflow(w) }}
                              disabled={running}
                              sx={{
                                color: isRunningThis ? TEAL : running ? 'text.disabled' : TEAL,
                                '&:hover': { bgcolor: running ? 'transparent' : alpha(TEAL, 0.08) },
                                pointerEvents: running ? 'none' : 'auto',
                              }}>
                              {isRunningThis
                                ? <CircularProgress size={16} sx={{ color: TEAL }} />
                                : <PlayArrowOutlined sx={{ fontSize: 18 }} />}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <span>
                            <IconButton size="small" onClick={() => openEditDialog(w)}
                              disabled={running}
                              sx={{ color: 'text.secondary', '&:hover': { bgcolor: alpha(TEAL, 0.06) } }}>
                              <EditOutlined sx={{ fontSize: 16 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <span>
                            <IconButton size="small" onClick={() => handleDeleteWorkflow(w)}
                              disabled={running}
                              sx={{ color: 'text.secondary', '&:hover': { color: tokens.red600, bgcolor: alpha(tokens.red600, 0.06) } }}>
                              <DeleteOutlined sx={{ fontSize: 16 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Paper>

        {/* ── Run error ─────────────────────────────────────────────────── */}
        {runError && (
          <Alert severity="error" onClose={() => setRunError(null)}>
            <Typography variant="body2" fontWeight={600} gutterBottom>Workflow Error</Typography>
            <Typography variant="body2">{runError}</Typography>
            {runError.includes('No active workflow cards') && (
              <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
                Go to the <strong>Cards</strong> tab and add at least one active card.
              </Typography>
            )}
          </Alert>
        )}


        {/* ── Live streaming timeline ─────────────────────────────────── */}
        {(running || liveSteps.length > 0) && !result && (
          <Box ref={resultsRef} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} sx={{ color: TEAL }} />
              <Typography variant="caption" fontWeight={700} sx={{ color: TEAL, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 0.5 }}>
                {runningWfId ? `Running "${workflows.find(w => w.id === runningWfId)?.name ?? 'workflow'}"` : 'Running workflow'} — Step {liveSteps.length + (thinkingCard ? 1 : 0)}{totalSteps > 0 ? ` of ${totalSteps}` : ''}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="outlined" onClick={() => { abortRef.current?.abort(); setRunning(false); setThinkingCard(null) }}
                sx={{ fontSize: '0.68rem', py: 0.2, px: 1, borderRadius: 1.5, borderColor: 'divider', color: 'text.secondary' }}>
                Cancel
              </Button>
            </Box>

            {/* Progress bar */}
            {totalSteps > 0 && (
              <LinearProgress variant="determinate"
                value={Math.round((liveSteps.length / totalSteps) * 100)}
                sx={{ height: 4, borderRadius: 2 }} />
            )}
            {totalSteps === 0 && <LinearProgress sx={{ height: 4, borderRadius: 2 }} />}

            {/* Completed steps */}
            {liveSteps.map((step, idx) => {
              const statusColor = RUN_STATUS_COLORS[step.status] ?? '#64748B'
              const isOpen = selectedStep === idx
              const output = step.output_text ?? ''
              const preview = output.length > 200 ? output.slice(0, 200) + '…' : output
              return (
                <Paper key={step.id ?? idx} variant="outlined" sx={{ borderRadius: 2,
                  borderLeft: `3px solid ${statusColor}`,
                  bgcolor: (t) => alpha(statusColor, t.palette.mode === 'dark' ? 0.04 : 0.02) }}>
                  <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }}
                    onClick={() => setSelectedStep(isOpen ? null : idx)}>
                    <RunStatusIcon status={step.status} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2" fontWeight={700} noWrap>
                          {step.agent_name ?? step.card_name ?? `Step ${step.step_number}`}
                        </Typography>
                        {step.role_name && <Chip label={step.role_name} size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />}
                        {step.iteration && step.iteration > 1 && <Chip label={`iter ${step.iteration}`} size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha('#F59E0B', 0.1), color: '#F59E0B' }} />}
                        {step.decision && DECISION_META[step.decision] && (
                          <Chip icon={DECISION_META[step.decision].icon} label={DECISION_META[step.decision].label}
                            size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(DECISION_META[step.decision].color, 0.1), color: DECISION_META[step.decision].color }} />
                        )}
                        <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto' }}>
                          {step.execution_time_ms ? `${(step.execution_time_ms / 1000).toFixed(1)}s` : ''}
                        </Typography>
                      </Box>
                      {!isOpen && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{preview}</Typography>}
                    </Box>
                    {isOpen ? <ExpandLess sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} /> : <ExpandMore sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />}
                  </Box>
                  <Collapse in={isOpen}>
                    <Divider />
                    <Box sx={{ p: 1.5, pt: 1 }}>
                      <StepDetail step={step} />
                    </Box>
                  </Collapse>
                </Paper>
              )
            })}

            {/* Thinking card — pulsing, current step */}
            {thinkingCard && (
              <Paper variant="outlined" sx={{ borderRadius: 2, borderLeft: `3px solid ${TEAL}`,
                bgcolor: (t) => alpha(TEAL, t.palette.mode === 'dark' ? 0.06 : 0.03),
                animation: 'pulse 1.6s ease-in-out infinite',
                '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } } }}>
                <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <CircularProgress size={16} sx={{ color: TEAL, flexShrink: 0 }} />
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={700}>
                        {thinkingCard.agent_name ?? thinkingCard.card_name}
                      </Typography>
                      {thinkingCard.role_name && (
                        <Chip label={thinkingCard.role_name} size="small"
                          sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">thinking…</Typography>
                  </Box>
                  <Typography variant="caption" color="text.disabled">
                    Step {thinkingCard.step_number}
                  </Typography>
                </Box>
              </Paper>
            )}
          </Box>
        )}

        {result && !running && (
          <Box ref={resultsRef} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* ── Status bar ───────────────────────────────────── */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                label={result.execution.status.toUpperCase()}
                size="small"
                sx={{ fontWeight: 700, fontSize: '0.7rem',
                  bgcolor: alpha(RUN_STATUS_COLORS[result.execution.status] ?? '#64748B', 0.12),
                  color: RUN_STATUS_COLORS[result.execution.status] ?? '#64748B' }}
              />
              <Typography variant="caption" color="text.secondary">
                {result.steps.filter(s => s.status === 'success').length} completed ·{' '}
                {result.steps.filter(s => s.status === 'escalated').length > 0 &&
                  `${result.steps.filter(s => s.status === 'escalated').length} escalated · `}
                {result.steps.filter(s => s.status === 'failed').length > 0 &&
                  `${result.steps.filter(s => s.status === 'failed').length} failed · `}
                {result.steps.length} total steps
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.disabled">
                {new Date(result.execution.created_at).toLocaleString()}
              </Typography>
              <Button size="small" variant="outlined"
                startIcon={<RefreshOutlined sx={{ fontSize: 14 }} />}
                onClick={() => setResult(null)}
                sx={{ fontSize: '0.7rem', py: 0.25, px: 1.25, borderRadius: 1.5,
                  borderColor: 'divider', color: 'text.secondary' }}>
                Clear
              </Button>
            </Box>

            {/* ── Final Summary — FIRST, most visible ─────────── */}
            {result.execution.final_summary ? (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2,
                borderLeft: `4px solid ${TEAL}`,
                bgcolor: (t) => alpha(TEAL, t.palette.mode === 'dark' ? 0.05 : 0.02) }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <CheckCircleOutlined sx={{ fontSize: 16, color: TEAL }} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ color: TEAL }}>
                    Final Output
                  </Typography>
                </Box>
                <Box sx={{ fontSize: '0.875rem', lineHeight: 1.75,
                  '& p': { mb: 1 }, '& ul, & ol': { pl: 2.5, mb: 1 },
                  '& h1,& h2,& h3': { fontWeight: 700, mb: 0.5, mt: 1.5 },
                  '& code': { fontFamily: 'monospace', fontSize: '0.8rem',
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.06), px: 0.5, borderRadius: 0.5 },
                  '& strong': { fontWeight: 700 } }}>
                  <ReactMarkdown>{result.execution.final_summary}</ReactMarkdown>
                </Box>
              </Paper>
            ) : (
              <Alert severity="warning" sx={{ fontSize: '0.75rem' }}>
                No final summary produced. Check the step outputs below — the last step may have failed or produced no output.
              </Alert>
            )}

            {/* ── Per-employee task cards ──────────────────────── */}
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary"
                sx={{ display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
                Step-by-step work log ({result.steps.length} steps)
              </Typography>

              {result.steps.map((step, idx) => {
                const statusColor = RUN_STATUS_COLORS[step.status] ?? '#64748B'
                const isOpen = selectedStep === idx
                const output = step.output_text ?? ''
                const preview = output.length > 280 ? output.slice(0, 280) + '…' : output

                return (
                  <Paper key={step.id} variant="outlined" sx={{ mb: 1.5, borderRadius: 2,
                    borderLeft: `3px solid ${statusColor}`,
                    bgcolor: isOpen ? (t) => alpha(statusColor, t.palette.mode === 'dark' ? 0.06 : 0.02) : 'background.paper',
                    transition: 'background 0.15s' }}>

                    {/* Card header — always visible */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, cursor: 'pointer' }}
                      onClick={() => setSelectedStep(isOpen ? null : idx)}>

                      {/* Status circle */}
                      <Box sx={{ width: 36, height: 36, borderRadius: '50%',
                        bgcolor: alpha(statusColor, 0.12), border: `2px solid ${statusColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {step.status === 'success'    ? <CheckCircleOutlined sx={{ fontSize: 17, color: statusColor }} />
                         : step.status === 'failed'   ? <ErrorOutlined sx={{ fontSize: 17, color: statusColor }} />
                         : step.status === 'escalated'? <WarningAmberOutlined sx={{ fontSize: 17, color: statusColor }} />
                         : <Typography variant="caption" fontWeight={700} sx={{ color: statusColor }}>{idx + 1}</Typography>}
                      </Box>

                      {/* Identity */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                          <Typography variant="body2" fontWeight={700}>
                            {step.agent_name ?? step.card_name ?? `Step ${idx + 1}`}
                          </Typography>
                          {step.role_name && (
                            <Chip label={step.role_name} size="small"
                              sx={{ height: 16, fontSize: '0.58rem', bgcolor: alpha(PURPLE, 0.08), color: PURPLE }} />
                          )}
                          {step.iteration > 1 && (
                            <Chip icon={<LoopOutlined sx={{ fontSize: 10 }} />}
                              label={`Iteration ${step.iteration}`} size="small"
                              sx={{ height: 16, fontSize: '0.58rem', bgcolor: alpha(tokens.amber600, 0.1), color: tokens.amber600 }} />
                          )}
                          <DecisionBadge decision={step.decision} />
                        </Box>
                        {/* Output preview */}
                        {!isOpen && output && (
                          <Typography variant="caption" color="text.secondary"
                            sx={{ display: '-webkit-box', WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden', mt: 0.25 }}>
                            {preview}
                          </Typography>
                        )}
                      </Box>

                      {/* Right meta */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                        {step.execution_time_ms != null && (
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                            {(step.execution_time_ms / 1000).toFixed(1)}s
                          </Typography>
                        )}
                        {isOpen
                          ? <ExpandLess sx={{ fontSize: 16, color: 'text.disabled' }} />
                          : <ExpandMore sx={{ fontSize: 16, color: 'text.disabled' }} />}
                      </Box>
                    </Box>

                    {/* Expanded detail */}
                    <Collapse in={isOpen}>
                      <Divider />
                      <Box sx={{ p: 1.5, pt: 1 }}>
                        <StepDetail step={step} />
                      </Box>
                    </Collapse>
                  </Paper>
                )
              })}

              {/* Pending steps (cards not yet executed) */}
              {(() => {
                const executedCardIds = new Set(result.steps.map(s => s.card_id).filter(Boolean))
                const pendingCards = cards.filter(c => c.is_active && !executedCardIds.has(c.id))
                if (!pendingCards.length) return null
                return (
                  <Box sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                      <HourglassEmptyOutlined sx={{ fontSize: 13 }} />
                      {pendingCards.length} step{pendingCards.length > 1 ? 's' : ''} not yet executed
                    </Typography>
                    {pendingCards.map((card) => {
                      const agent = allAgents.find((a: { id: number; name: string }) => a.id === card.agent_id)
                      return (
                        <Paper key={card.id} variant="outlined" sx={{ mb: 1, borderRadius: 2, p: 1.5,
                          borderLeft: '3px solid #CBD5E1', opacity: 0.6 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box sx={{ width: 36, height: 36, borderRadius: '50%',
                              bgcolor: alpha('#94A3B8', 0.1), border: '2px dashed #CBD5E1',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <HourglassEmptyOutlined sx={{ fontSize: 15, color: '#94A3B8' }} />
                            </Box>
                            <Box>
                              <Typography variant="body2" fontWeight={600} color="text.secondary">
                                {agent?.name ?? card.name}
                              </Typography>
                              <Typography variant="caption" color="text.disabled">{card.name} — pending</Typography>
                            </Box>
                          </Box>
                        </Paper>
                      )
                    })}
                  </Box>
                )
              })()}
            </Box>
          </Box>
        )}
      </Box>

      {/* ── New / Edit Workflow Dialog ─────────────────────────────────────── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BoltOutlined sx={{ color: TEAL }} />
            <Typography fontWeight={700}>{editingWf ? 'Edit Workflow' : 'New Workflow'}</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <Grid container spacing={2} sx={{ mt: 0 }}>

            {/* ── Workflow identity ── */}
            <Grid item xs={12} sm={6}>
              <TextField fullWidth size="small" label="Workflow Name" required autoFocus
                value={wfName} onChange={(e) => setWfName(e.target.value)}
                placeholder="e.g. Premium Reconciliation Weekly" />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth size="small" label="Description (optional)"
                value={wfDesc} onChange={(e) => setWfDesc(e.target.value)}
                placeholder="What does this workflow do?" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Schedule</InputLabel>
                <Select label="Schedule" value={wfSched} onChange={(e) => setWfSched(e.target.value)}>
                  {SCHEDULE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Model</InputLabel>
                <Select label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
                  <MenuItem value="gpt-4o-mini">gpt-4o-mini</MenuItem>
                  <MenuItem value="gpt-4o">gpt-4o</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} sx={{ display: 'flex', alignItems: 'center' }}>
              {activeConnection ? (
                <Chip icon={<StorageOutlined sx={{ fontSize: 14 }} />}
                  label={`Using: ${activeConnection.name}`} size="small" variant="outlined"
                  sx={{ fontSize: '0.72rem', borderColor: alpha(TEAL, 0.4), color: TEAL }} />
              ) : (
                <Alert severity="warning" sx={{ py: 0, fontSize: '0.72rem', flex: 1 }}>
                  No connection selected — pick one in the header
                </Alert>
              )}
            </Grid>

            {/* ── Task / Query ── */}
            <Grid item xs={12}>
              <TextField fullWidth multiline minRows={3} size="small"
                label="Task / Query *"
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Validate premium mismatch across source and target"
                helperText="This is what every agent in the pipeline will work on" />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {QUICK_CHIPS.map((chip) => (
                  <Chip key={chip} label={chip} size="small" clickable onClick={() => setQuery(chip)}
                    sx={{ fontSize: '0.675rem', bgcolor: alpha(TEAL, 0.08), color: TEAL,
                      border: `1px solid ${alpha(TEAL, 0.25)}`, '&:hover': { bgcolor: alpha(TEAL, 0.15) } }} />
                ))}
              </Box>
            </Grid>

            {/* ── AI Pipeline Designer (collapsible) ── */}
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: alpha(PURPLE, 0.35), overflow: 'hidden' }}>
                <Box onClick={() => setDesignOpen((v) => !v)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25,
                    cursor: 'pointer', userSelect: 'none',
                    '&:hover': { bgcolor: (t) => alpha(PURPLE, t.palette.mode === 'dark' ? 0.08 : 0.03) } }}>
                  <AutoFixHighOutlined sx={{ fontSize: 17, color: PURPLE }} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ color: PURPLE, flex: 1 }}>
                    AI Pipeline Designer
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Load a BRD or JIRA ticket and auto-build the pipeline
                  </Typography>
                  {designOpen
                    ? <ExpandLess sx={{ fontSize: 16, color: PURPLE }} />
                    : <ExpandMore sx={{ fontSize: 16, color: PURPLE }} />}
                </Box>

                <Collapse in={designOpen}>
                  <Divider />
                  <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>

                    <TextField fullWidth multiline minRows={2} size="small"
                      label="What should the pipeline do? (required)"
                      value={designReq} onChange={(e) => setDesignReq(e.target.value)}
                      placeholder="e.g. Read BRD, Developer writes SQL, QA validates, Manager approves" />

                    {/* BRD Source toggle */}
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary"
                        sx={{ display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
                        BRD Source (optional)
                      </Typography>
                      <ToggleButtonGroup size="small" exclusive value={brdSource}
                        onChange={(_, v) => { if (v) { setBrdSource(v); setDesignBrd('') } }}
                        sx={{ mb: 1.5 }}>
                        <ToggleButton value="text"
                          sx={{ fontSize: '0.75rem', textTransform: 'none', px: 2 }}>
                          <TextFieldsOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Paste Text
                        </ToggleButton>
                        <ToggleButton value="jira"
                          sx={{ fontSize: '0.75rem', textTransform: 'none', px: 2 }}>
                          <LinkOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Read from JIRA
                        </ToggleButton>
                      </ToggleButtonGroup>

                      {brdSource === 'jira' && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {jiraConfigured ? (
                            <Chip icon={<CheckCircleOutlined />} label="JIRA configured"
                              size="small" color="success" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                          ) : (
                            <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                              JIRA not configured. Go to <strong>Admin → Integrations</strong> to set it up.
                            </Alert>
                          )}
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField size="small" fullWidth label="JIRA Issue Key"
                              placeholder="e.g. PROJ-123"
                              value={jiraKey} onChange={(e) => setJiraKey(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') fetchFromJira() }} />
                            <Button variant="outlined" size="small"
                              sx={{ whiteSpace: 'nowrap', minWidth: 110 }}
                              disabled={!jiraKey.trim() || jiraFetching}
                              startIcon={jiraFetching ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
                              onClick={fetchFromJira}>
                              {jiraFetching ? 'Loading…' : 'Fetch BRD'}
                            </Button>
                          </Box>
                          {designBrd && (
                            <Alert severity="success" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                              Loaded {designBrd.length} characters from {jiraKey}
                            </Alert>
                          )}
                        </Box>
                      )}

                      {brdSource === 'text' && (
                        <TextField fullWidth multiline minRows={3} size="small"
                          label="Paste BRD / Requirements Document"
                          value={designBrd} onChange={(e) => setDesignBrd(e.target.value)}
                          placeholder="Paste the full BRD text here…"
                          sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }} />
                      )}
                    </Box>

                    {/* Design button */}
                    <Button variant="contained" onClick={handleDesign}
                      disabled={designing || !designReq.trim()}
                      startIcon={designing ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighOutlined />}
                      sx={{ bgcolor: PURPLE, '&:hover': { bgcolor: '#7C3AED' }, alignSelf: 'flex-start' }}>
                      {designing ? 'Designing…' : designResult.length ? 'Redesign Pipeline' : 'Design Pipeline'}
                    </Button>

                    {/* Proposed cards */}
                    {designResult.length > 0 && (
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Typography variant="caption" fontWeight={700} color="text.secondary"
                            sx={{ textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                            Proposed Pipeline ({designResult.length} steps)
                          </Typography>
                          <Chip label="Review & apply below" size="small"
                            sx={{ bgcolor: alpha(PURPLE, 0.1), color: PURPLE, height: 20, fontSize: '0.65rem' }} />
                        </Box>
                        <Alert severity="success" sx={{ mb: 1, fontSize: '0.75rem' }}>
                          Click <strong>"Apply to Pipeline"</strong> to save as Cards (replaces existing pipeline).
                        </Alert>
                        {designResult.map((card, idx) => (
                          <Paper key={idx} variant="outlined" sx={{ p: 1.25, mb: 0.75, borderRadius: 1.5, borderColor: alpha(TEAL, 0.3) }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: alpha(TEAL, 0.12),
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Typography variant="caption" fontWeight={700} sx={{ color: TEAL, fontSize: '0.62rem' }}>{idx + 1}</Typography>
                              </Box>
                              <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{card.name}</Typography>
                              {card.suggested_tools && card.suggested_tools.length > 0 && (
                                <Stack direction="row" spacing={0.5}>
                                  {card.suggested_tools.map((t) => (
                                    <Chip key={t} label={t} size="small"
                                      sx={{ height: 16, fontSize: '0.58rem', bgcolor: alpha(TEAL, 0.08), color: TEAL }} />
                                  ))}
                                </Stack>
                              )}
                            </Box>
                            {card.description && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                {card.description}
                              </Typography>
                            )}
                            {card.rationale && (
                              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontStyle: 'italic', mt: 0.25 }}>
                                Why: {card.rationale}
                              </Typography>
                            )}
                          </Paper>
                        ))}
                        <Button variant="outlined" fullWidth onClick={handleApplyWorkflow}
                          disabled={applying}
                          startIcon={applying ? <CircularProgress size={14} /> : <CheckCircleOutlined />}
                          sx={{ color: tokens.emerald600, borderColor: tokens.emerald600, mt: 0.5 }}>
                          {applying ? 'Applying…' : 'Apply to Pipeline'}
                        </Button>
                      </Box>
                    )}
                  </Box>
                </Collapse>
              </Paper>
            </Grid>

          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setDialogOpen(false); setDesignResult([]); setDesignReq(''); setDesignBrd(''); setJiraKey(''); setBrdSource('text') }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleDialogSave}
            disabled={!wfName.trim() || !query.trim()}
            sx={{ bgcolor: TEAL, '&:hover': { bgcolor: '#0284C7' }, fontWeight: 700 }}>
            {editingWf ? 'Update Workflow' : 'Save Workflow'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Quick Run Dialog */}
      <Dialog open={quickRunOpen} onClose={() => setQuickRunOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BoltOutlined sx={{ color: TEAL }} />
            <Typography fontWeight={700}>Run Pipeline</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            What do you want the team to work on? Each employee in the pipeline will receive this as their task.
          </Typography>

          {/* Pipeline summary inline */}
          <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {cards.filter(c => c.is_active).map((card, idx) => {
              const agent = allAgents.find((a: { id: number; name: string }) => a.id === card.agent_id)
              const role  = allRoles.find((r: AgentRole) => r.id === (card.role_id ?? (agent as { role_id?: number } | undefined)?.role_id))
              const rIdx  = role ? allRoles.indexOf(role) : -1
              const col   = rIdx >= 0 ? roleColor(rIdx) : '#64748B'
              return (
                <Box key={card.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: alpha(col, 0.15),
                    border: `1.5px solid ${col}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" fontWeight={700} sx={{ color: col, fontSize: '0.58rem' }}>
                      {(agent?.name ?? card.name).slice(0, 2).toUpperCase()}
                    </Typography>
                  </Box>
                  {idx < cards.filter(c => c.is_active).length - 1 && (
                    <KeyboardArrowRightOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
                  )}
                </Box>
              )
            })}
          </Box>

          <TextField autoFocus fullWidth multiline minRows={4} size="small"
            label="Task / Query"
            value={quickRunQuery}
            onChange={(e) => setQuickRunQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleQuickRun() }}
            placeholder="e.g. Read the BRD from JIRA KAN-49 and create a development plan with tasks assigned to each team member"
            helperText="Ctrl+Enter to run" />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
            {QUICK_CHIPS.map((chip) => (
              <Chip key={chip} label={chip} size="small" clickable onClick={() => setQuickRunQuery(chip)}
                sx={{ fontSize: '0.675rem', bgcolor: alpha(TEAL, 0.08), color: TEAL,
                  border: `1px solid ${alpha(TEAL, 0.25)}`, '&:hover': { bgcolor: alpha(TEAL, 0.15) } }} />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuickRunOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleQuickRun}
            disabled={!quickRunQuery.trim() || running}
            startIcon={running ? <CircularProgress size={14} color="inherit" /> : <BoltOutlined />}
            sx={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${TEAL} 100%)`, fontWeight: 700 }}>
            {running ? 'Running…' : 'Run Workflow'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Workflow Designer Dialog */}
      <Dialog open={designOpen} onClose={() => setDesignOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoFixHighOutlined sx={{ color: PURPLE }} />
            <Typography fontWeight={700}>AI Workflow Designer</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Describe the task or load a BRD from JIRA. AI will design a full pipeline — which employees,
            what order, review loops — based on your existing team and roles.
          </Typography>

          <TextField fullWidth multiline minRows={3} size="small" autoFocus
            label="Task / Requirement (required)"
            value={designReq} onChange={(e) => setDesignReq(e.target.value)}
            placeholder="e.g. Read BRD, create developer tasks, developer writes SQL, team lead reviews, manager approves" />

          {/* BRD Source toggle */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary"
              sx={{ display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
              BRD Source (optional)
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={brdSource}
              onChange={(_, v) => { if (v) { setBrdSource(v); setDesignBrd('') } }}
              sx={{ mb: 1.5 }}>
              <ToggleButton value="text" sx={{ fontSize: '0.75rem', textTransform: 'none', px: 2 }}>
                <TextFieldsOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Paste Text
              </ToggleButton>
              <ToggleButton value="jira" sx={{ fontSize: '0.75rem', textTransform: 'none', px: 2 }}>
                <LinkOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Read from JIRA
              </ToggleButton>
            </ToggleButtonGroup>

            {brdSource === 'jira' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {jiraConfigured ? (
                  <Chip icon={<CheckCircleOutlined />} label="JIRA configured"
                    size="small" color="success" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                ) : (
                  <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                    JIRA not configured. Go to <strong>Admin → Integrations</strong> to set it up.
                  </Alert>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField size="small" fullWidth label="JIRA Issue Key"
                    placeholder="e.g. PROJ-123"
                    value={jiraKey} onChange={(e) => setJiraKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchFromJira() }} />
                  <Button variant="outlined" size="small" sx={{ whiteSpace: 'nowrap', minWidth: 120 }}
                    disabled={!jiraKey.trim() || jiraFetching}
                    startIcon={jiraFetching ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
                    onClick={fetchFromJira}>
                    {jiraFetching ? 'Loading…' : 'Fetch BRD'}
                  </Button>
                </Box>
                {designBrd && (
                  <Alert severity="success" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                    Loaded {designBrd.length} characters from {jiraKey}
                  </Alert>
                )}
              </Box>
            )}

            {brdSource === 'text' && (
              <TextField fullWidth multiline minRows={4} size="small"
                label="Paste BRD / Requirements Document"
                value={designBrd} onChange={(e) => setDesignBrd(e.target.value)}
                placeholder="Paste the full BRD text here. AI will extract tasks and assign them to the right employees."
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }} />
            )}
          </Box>

          {designResult.length > 0 && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
                  Proposed Pipeline ({designResult.length} steps)
                </Typography>
                <Chip label="Review & apply below" size="small"
                  sx={{ bgcolor: alpha(PURPLE, 0.1), color: PURPLE, height: 20, fontSize: '0.65rem' }} />
              </Box>
              <Alert severity="success" sx={{ mb: 1.5, fontSize: '0.75rem' }}>
                AI has designed {designResult.length} workflow steps. Click <strong>"Apply to Pipeline"</strong> to
                save them as Cards (replaces existing pipeline) or go to the Cards tab to add manually.
              </Alert>
              {designResult.map((card, idx) => (
                <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, borderRadius: 2,
                  borderColor: alpha(TEAL, 0.3) }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Box sx={{ width: 24, height: 24, borderRadius: '50%',
                      bgcolor: alpha(TEAL, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Typography variant="caption" fontWeight={700} sx={{ color: TEAL, fontSize: '0.65rem' }}>{idx + 1}</Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{card.name}</Typography>
                    {card.suggested_tools && card.suggested_tools.length > 0 && (
                      <Stack direction="row" spacing={0.5}>
                        {card.suggested_tools.map((t) => (
                          <Chip key={t} label={t} size="small"
                            sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(TEAL, 0.08), color: TEAL }} />
                        ))}
                      </Stack>
                    )}
                  </Box>
                  {card.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {card.description}
                    </Typography>
                  )}
                  {card.rationale && (
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontStyle: 'italic', mt: 0.5 }}>
                      Why: {card.rationale}
                    </Typography>
                  )}
                </Paper>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDesignOpen(false); setDesignResult([]); setDesignReq(''); setDesignBrd(''); setJiraKey(''); setBrdSource('text') }}>Cancel</Button>
          {designResult.length > 0 && (
            <Button variant="outlined" onClick={handleApplyWorkflow}
              disabled={applying}
              startIcon={applying ? <CircularProgress size={14} /> : <CheckCircleOutlined />}
              sx={{ color: tokens.emerald600, borderColor: tokens.emerald600 }}>
              Apply to Pipeline
            </Button>
          )}
          <Button variant="contained" onClick={handleDesign}
            disabled={designing || !designReq.trim()}
            startIcon={designing ? <CircularProgress size={14} /> : <AutoFixHighOutlined />}
            sx={{ bgcolor: PURPLE, '&:hover': { bgcolor: '#7C3AED' } }}>
            {designing ? 'Designing…' : designResult.length ? 'Redesign' : 'Design Workflow'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}



function HistoryTab({ setTab }: { setTab: (v: number) => void }) {
  const { enqueueSnackbar } = useSnackbar()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch]             = useState('')
  const [selected, setSelected]         = useState<{ execution: WorkflowExecution; steps: WorkflowExecutionStep[] } | null>(null)
  const [selectedStep, setSelectedStep] = useState<number | null>(null)

  const { data: executions = [], isLoading, refetch } = useQuery<WorkflowExecution[]>({
    queryKey: ['agentic-executions-history', statusFilter],
    queryFn: () => agenticApi.listExecutions(100, statusFilter === 'all' ? undefined : statusFilter),
    refetchInterval: (query) => {
      const rows = query.state.data as WorkflowExecution[] | undefined
      return rows?.some(e => e.status === 'running') ? 5000 : false
    },
  })

  const { data: resources } = useQuery({
    queryKey: ['agentic-resources'], queryFn: () => agenticApi.getResources(),
  })
  const allAgents = resources?.agents ?? []

  const filtered = executions.filter((e) =>
    !search.trim() || e.user_query.toLowerCase().includes(search.toLowerCase())
  )

  const running   = executions.filter(e => e.status === 'running')
  const pending   = executions.filter(e => e.status === 'pending')
  const succeeded = executions.filter(e => e.status === 'success')
  const failed    = executions.filter(e => ['failed', 'partial', 'escalated'].includes(e.status))

  async function loadDetail(id: number) {
    try {
      const res = await agenticApi.getExecution(id)
      setSelected(res); setSelectedStep(null)
    } catch { enqueueSnackbar('Failed to load execution', { variant: 'error' }) }
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Fixed header bar ──────────────────────────────────────────────── */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex',
        alignItems: 'center', gap: 1.5, minHeight: 56, flexShrink: 0 }}>
        <HistoryOutlined color="primary" sx={{ fontSize: 22 }} />
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>Execution History</Typography>
          <Typography variant="caption" color="text.secondary">Past workflow runs and step logs</Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField size="small" placeholder="Search query…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            sx={{ width: 200 }}
            InputProps={{ sx: { fontSize: '0.8rem' } }} />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ fontSize: '0.8rem' }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="running">Running</MenuItem>
              <MenuItem value="success">Success</MenuItem>
              <MenuItem value="partial">Partial</MenuItem>
              <MenuItem value="failed">Failed</MenuItem>
              <MenuItem value="escalated">Escalated</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => refetch()}><RefreshOutlined /></IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>

      {/* Left: list */}
      <Box sx={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.5,
        borderRight: 1, borderColor: 'divider', p: 2, overflow: 'hidden' }}>

        {/* Summary cards */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 1 }}>
          {[
            { label: 'Running',   count: running.length,   color: tokens.sky600 },
            { label: 'Succeeded', count: succeeded.length, color: tokens.emerald600 },
            { label: 'Failed',    count: failed.length,    color: tokens.red600 },
            { label: 'Total',     count: executions.length, color: '#64748B' },
          ].map((s) => (
            <Paper key={s.label} variant="outlined" sx={{ p: 1, borderRadius: 2, textAlign: 'center',
              borderColor: alpha(s.color, 0.3), bgcolor: alpha(s.color, 0.04),
              cursor: 'pointer' }}
              onClick={() => setStatusFilter(s.label === 'Total' ? 'all' : s.label.toLowerCase().replace('succeeded','success').replace('failed','failed'))}>
              <Typography variant="h6" fontWeight={700} sx={{ color: s.color, lineHeight: 1 }}>{s.count}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>{s.label}</Typography>
            </Paper>
          ))}
        </Box>

        {/* Running banner */}
        {running.length > 0 && (
          <Alert severity="info" sx={{ py: 0.5, fontSize: '0.75rem' }}
            icon={<CircularProgress size={14} />}>
            {running.length} workflow{running.length > 1 ? 's' : ''} currently running — auto-refreshing
          </Alert>
        )}

        {/* Execution list */}
        {isLoading && <LinearProgress />}
        <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {filtered.length === 0 && !isLoading && (
            <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
              <HistoryOutlined sx={{ fontSize: 40, opacity: 0.3, display: 'block', mx: 'auto', mb: 1 }} />
              <Typography variant="body2">No executions found</Typography>
            </Box>
          )}
          {filtered.map((ex) => {
            const isRunning = ex.status === 'running'
            const statusColor = RUN_STATUS_COLORS[ex.status] ?? '#64748B'
            const isSelected = selected?.execution.id === ex.id
            return (
              <Paper key={ex.id} variant="outlined" onClick={() => loadDetail(ex.id)}
                sx={{ p: 1.5, cursor: 'pointer', borderRadius: 2,
                  borderLeft: `3px solid ${statusColor}`,
                  bgcolor: isSelected ? (t) => alpha(statusColor, t.palette.mode === 'dark' ? 0.1 : 0.04) : 'background.paper',
                  '&:hover': { bgcolor: (t) => alpha(statusColor, t.palette.mode === 'dark' ? 0.08 : 0.03) },
                  transition: 'background 0.15s' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Chip label={ex.status} size="small"
                    sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700,
                      bgcolor: alpha(statusColor, 0.12), color: statusColor }} />
                  {isRunning && <CircularProgress size={12} sx={{ color: statusColor }} />}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                    #{ex.id}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={600}
                  sx={{ display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden', mb: 0.5 }}>
                  {ex.user_query}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {ex.completed_steps}/{ex.total_steps} steps
                  </Typography>
                  <LinearProgress variant="determinate"
                    value={ex.total_steps > 0 ? (ex.completed_steps / ex.total_steps) * 100 : 0}
                    sx={{ flex: 1, height: 4, borderRadius: 2,
                      bgcolor: alpha(statusColor, 0.12),
                      '& .MuiLinearProgress-bar': { bgcolor: statusColor } }} />
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                    {new Date(ex.created_at).toLocaleDateString()} {new Date(ex.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                </Box>
              </Paper>
            )
          })}
        </Box>
      </Box>

      {/* Right: detail */}
      <Box sx={{ flex: 1, overflowY: 'auto', minWidth: 0, p: 2 }}>
        {!selected && (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: 'text.disabled', gap: 1.5 }}>
            <HistoryOutlined sx={{ fontSize: 56, opacity: 0.25 }} />
            <Typography variant="body1">Select an execution to view details</Typography>
            <Typography variant="caption">Click any row on the left to see the full step-by-step log</Typography>
          </Box>
        )}

        {selected && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  {selected.execution.user_query}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label={selected.execution.status} size="small"
                    sx={{ height: 20, fontWeight: 700, fontSize: '0.65rem',
                      bgcolor: alpha(RUN_STATUS_COLORS[selected.execution.status] ?? '#64748B', 0.12),
                      color: RUN_STATUS_COLORS[selected.execution.status] ?? '#64748B' }} />
                  <Chip label={`${selected.steps.length} steps`} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                  <Chip label={selected.execution.model} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                  <Typography variant="caption" color="text.disabled" sx={{ alignSelf: 'center' }}>
                    {new Date(selected.execution.created_at).toLocaleString()}
                    {selected.execution.finished_at && ` → ${new Date(selected.execution.finished_at).toLocaleTimeString()}`}
                  </Typography>
                </Stack>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RefreshOutlined sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    sessionStorage.setItem('agenticRerun', JSON.stringify({
                      query: selected.execution.user_query,
                      connId: selected.execution.conn_id ?? null,
                      model: selected.execution.model,
                    }))
                    setTab(3)
                  }}
                  sx={{ fontSize: '0.7rem', py: 0.25, px: 1.25, borderRadius: 1.5,
                    borderColor: TEAL, color: TEAL,
                    '&:hover': { bgcolor: alpha(TEAL, 0.06), borderColor: TEAL } }}
                >
                  Rerun
                </Button>
                <IconButton size="small" onClick={() => setSelected(null)}><ErrorOutlined sx={{ fontSize: 16 }} /></IconButton>
              </Stack>
            </Box>

            {/* Final summary */}
            {selected.execution.final_summary && (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2,
                borderLeft: `4px solid ${TEAL}`,
                bgcolor: (t) => alpha(TEAL, t.palette.mode === 'dark' ? 0.05 : 0.02) }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <CheckCircleOutlined sx={{ fontSize: 16, color: TEAL }} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ color: TEAL }}>Final Output</Typography>
                </Box>
                <Box sx={{ fontSize: '0.875rem', lineHeight: 1.75,
                  '& p': { mb: 1 }, '& ul,& ol': { pl: 2.5, mb: 1 },
                  '& h1,& h2,& h3': { fontWeight: 700, mb: 0.5, mt: 1.5 },
                  '& code': { fontFamily: 'monospace', fontSize: '0.8rem',
                    bgcolor: (t) => alpha(t.palette.text.primary, 0.06), px: 0.5, borderRadius: 0.5 } }}>
                  <ReactMarkdown>{selected.execution.final_summary}</ReactMarkdown>
                </Box>
              </Paper>
            )}

            {/* Step log */}
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary"
                sx={{ display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.625rem', letterSpacing: 0.5 }}>
                Work log — {selected.steps.length} steps
              </Typography>
              {selected.steps.map((step, idx) => {
                const statusColor = RUN_STATUS_COLORS[step.status] ?? '#64748B'
                const isOpen = selectedStep === idx
                return (
                  <Paper key={step.id} variant="outlined" sx={{ mb: 1.25, borderRadius: 2,
                    borderLeft: `3px solid ${statusColor}` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, cursor: 'pointer' }}
                      onClick={() => setSelectedStep(isOpen ? null : idx)}>
                      <Box sx={{ width: 32, height: 32, borderRadius: '50%',
                        bgcolor: alpha(statusColor, 0.12), border: `2px solid ${statusColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {step.status === 'success'    ? <CheckCircleOutlined sx={{ fontSize: 15, color: statusColor }} />
                         : step.status === 'failed'   ? <ErrorOutlined sx={{ fontSize: 15, color: statusColor }} />
                         : step.status === 'escalated'? <WarningAmberOutlined sx={{ fontSize: 15, color: statusColor }} />
                         : <Typography variant="caption" fontWeight={700} sx={{ color: statusColor, fontSize: '0.6rem' }}>{idx + 1}</Typography>}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                          <Typography variant="body2" fontWeight={700}>
                            {step.agent_name ?? step.card_name ?? `Step ${idx + 1}`}
                          </Typography>
                          {step.role_name && (
                            <Chip label={step.role_name} size="small"
                              sx={{ height: 16, fontSize: '0.58rem', bgcolor: alpha(PURPLE, 0.08), color: PURPLE }} />
                          )}
                          {step.iteration > 1 && (
                            <Chip icon={<LoopOutlined sx={{ fontSize: 10 }} />}
                              label={`×${step.iteration}`} size="small"
                              sx={{ height: 16, fontSize: '0.58rem', bgcolor: alpha(tokens.amber600, 0.1), color: tokens.amber600 }} />
                          )}
                          <DecisionBadge decision={step.decision} />
                        </Box>
                        {!isOpen && step.output_text && (
                          <Typography variant="caption" color="text.secondary"
                            sx={{ display: '-webkit-box', WebkitLineClamp: 1,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {step.output_text.slice(0, 200)}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                        {step.execution_time_ms != null && (
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                            {(step.execution_time_ms / 1000).toFixed(1)}s
                          </Typography>
                        )}
                        {isOpen ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
                      </Box>
                    </Box>
                    <Collapse in={isOpen}>
                      <Divider />
                      <Box sx={{ p: 1.5, pt: 1 }}>
                        <StepDetail step={step} />
                      </Box>
                    </Collapse>
                  </Paper>
                )
              })}
            </Box>
          </Box>
        )}
      </Box>

      </Box>
    </Box>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — CONVERSION PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

const MAPPING_TYPE_COLOR: Record<string, string> = {
  manual: tokens.emerald600,
  ai:     tokens.sky600,
  rule:   PURPLE,
  pending_review: tokens.amber600,
}
const MAPPING_STATUS_COLOR: Record<string, string> = {
  approved: tokens.emerald600,
  pending:  tokens.amber600,
  rejected: tokens.red600,
}

function ConversionPipelineTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId = activeConnection?.id ?? null

  const [running, setRunning]   = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [profiling, setProfiling]   = useState(false)
  const [lastResult, setLastResult] = useState<{ status: string; attempts: number; version: number; errors: string[]; validation_summary: { passed: boolean; checks: Array<{ name: string; passed: boolean }>; xml_count: number } } | null>(null)
  const [editingMid, setEditingMid] = useState<number | null>(null)
  const [editValue, setEditValue]   = useState('')
  const [profileTab, setProfileTab] = useState(0)  // 0=profiles, 1=mappings

  const enabled = connId != null

  const { data: runLogs = [], refetch: refetchLogs } = useQuery<AgentRunLog[]>({
    queryKey: ['conv-run-logs', connId], queryFn: () => conversionAgentApi.getRunLogs(connId!),
    enabled, refetchInterval: running ? 3000 : false,
  })
  const { data: versions = [] } = useQuery<QueryVersion[]>({
    queryKey: ['conv-versions', connId], queryFn: () => conversionAgentApi.getVersions(connId!),
    enabled,
  })
  const { data: validations = [] } = useQuery<ValidationResultEntry[]>({
    queryKey: ['conv-validation', connId], queryFn: () => conversionAgentApi.getValidation(connId!),
    enabled,
  })
  const { data: profiles = [] } = useQuery<ColumnProfile[]>({
    queryKey: ['conv-profiles', connId], queryFn: () => conversionAgentApi.getProfiles(connId!),
    enabled,
  })
  const { data: mappings = [], refetch: refetchMappings } = useQuery<ValueMapping[]>({
    queryKey: ['conv-mappings', connId], queryFn: () => conversionAgentApi.getValueMappings(connId!),
    enabled,
  })

  async function handleRun() {
    if (!connId) return
    setRunning(true)
    setLastResult(null)
    try {
      const res = await conversionAgentApi.run(connId, 3)
      setLastResult(res)
      qc.invalidateQueries({ queryKey: ['conv-run-logs', connId] })
      qc.invalidateQueries({ queryKey: ['conv-versions', connId] })
      qc.invalidateQueries({ queryKey: ['conv-validation', connId] })
      enqueueSnackbar(`Pipeline ${res.status} — v${res.version} (${res.attempts} attempt${res.attempts !== 1 ? 's' : ''})`, {
        variant: res.status === 'success' ? 'success' : res.status === 'partial' ? 'warning' : 'error',
      })
    } catch (e: unknown) {
      enqueueSnackbar((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Pipeline failed', { variant: 'error' })
    } finally { setRunning(false); refetchLogs() }
  }

  async function handleProfile() {
    if (!connId) return
    setProfiling(true)
    try {
      const res = await conversionAgentApi.triggerProfile(connId)
      qc.invalidateQueries({ queryKey: ['conv-profiles', connId] })
      enqueueSnackbar(`Profiled ${res.profiled_columns} columns`, { variant: 'success' })
    } catch { enqueueSnackbar('Profiling failed', { variant: 'error' }) }
    finally { setProfiling(false) }
  }

  async function handleSuggest() {
    if (!connId) return
    setSuggesting(true)
    try {
      const res = await conversionAgentApi.suggestValueMappings(connId)
      await refetchMappings()
      enqueueSnackbar(`${res.new_mappings} new mappings across ${res.categorical_columns_checked} columns`, { variant: 'success' })
    } catch { enqueueSnackbar('Suggest failed', { variant: 'error' }) }
    finally { setSuggesting(false) }
  }

  async function handleApprove(m: ValueMapping) {
    await conversionAgentApi.updateValueMapping(connId!, m.id, { status: 'approved' })
    refetchMappings()
  }
  async function handleReject(m: ValueMapping) {
    await conversionAgentApi.updateValueMapping(connId!, m.id, { status: 'rejected' })
    refetchMappings()
  }
  async function handleSaveEdit(m: ValueMapping) {
    await conversionAgentApi.updateValueMapping(connId!, m.id, { target_value: editValue })
    setEditingMid(null)
    refetchMappings()
  }
  async function handleDelete(m: ValueMapping) {
    await conversionAgentApi.deleteValueMapping(connId!, m.id)
    refetchMappings()
  }

  // Compute last-attempt summary from run logs
  const lastManagerLog = runLogs.find((l) => l.agent_name === 'manager')
  const lastMapperLog  = runLogs.find((l) => l.agent_name === 'mapper')
  const lastValidLog   = runLogs.find((l) => l.agent_name === 'validator')

  // Group profiles by table
  const profilesByTable: Record<string, ColumnProfile[]> = {}
  for (const p of profiles) {
    if (!profilesByTable[p.table_name]) profilesByTable[p.table_name] = []
    profilesByTable[p.table_name].push(p)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Header controls ── */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {activeConnection ? (
          <Chip icon={<StorageOutlined sx={{ fontSize: 14 }} />}
            label={activeConnection.name}
            size="small"
            sx={{ bgcolor: alpha(TEAL, 0.1), color: TEAL, fontWeight: 600 }} />
        ) : (
          <Alert severity="warning" sx={{ py: 0, fontSize: '0.78rem' }}>
            No connection selected — pick one from the top bar first.
          </Alert>
        )}
        <Button variant="contained" startIcon={running ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlined />}
          onClick={handleRun} disabled={!connId || running} size="small">
          {running ? 'Running…' : 'Run Pipeline'}
        </Button>
        <Button variant="outlined" startIcon={profiling ? <CircularProgress size={14} /> : <AssessmentOutlined />}
          onClick={handleProfile} disabled={!connId || profiling} size="small">
          {profiling ? 'Profiling…' : 'Re-Profile'}
        </Button>
      </Box>

      {/* ── Status cards ── */}
      {enabled && (
        <Grid container spacing={1.5}>
          {([
            { label: 'Manager', log: lastManagerLog },
            { label: 'Mapper',  log: lastMapperLog },
            { label: 'Validator', log: lastValidLog },
          ] as Array<{ label: string; log: AgentRunLog | undefined }>).map(({ label, log }) => (
            <Grid item xs={12} sm={4} key={label}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.625rem' }}>{label}</Typography>
                {log ? (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                      <Chip label={log.status} size="small"
                        sx={{ height: 18, fontSize: '0.65rem',
                          bgcolor: alpha(RUN_STATUS_COLORS[log.status] ?? '#64748B', 0.12),
                          color: RUN_STATUS_COLORS[log.status] ?? '#64748B' }} />
                      {log.attempt > 1 && <Chip label={`Attempt ${log.attempt}`} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />}
                    </Box>
                    {log.duration_ms != null && (
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                        {(log.duration_ms / 1000).toFixed(1)}s
                      </Typography>
                    )}
                  </>
                ) : (
                  <Typography variant="caption" color="text.disabled">No runs yet</Typography>
                )}
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      {/* ── Last-run result banner ── */}
      {lastResult && (
        <Alert severity={lastResult.status === 'success' ? 'success' : lastResult.status === 'partial' ? 'warning' : 'error'}
          sx={{ fontSize: '0.8rem' }}>
          <strong>Status:</strong> {lastResult.status} &nbsp;|&nbsp;
          <strong>Version:</strong> {lastResult.version} &nbsp;|&nbsp;
          <strong>Validation:</strong> {lastResult.validation_summary.passed ? 'Passed' : 'Failed'} &nbsp;|&nbsp;
          <strong>XML records:</strong> {lastResult.validation_summary.xml_count}
          {lastResult.errors.length > 0 && (
            <Box mt={0.5}>{lastResult.errors.map((e, i) => <div key={i}>• {e}</div>)}</Box>
          )}
        </Alert>
      )}

      {running && <LinearProgress />}

      {/* ── Validation results ── */}
      {enabled && validations.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <BugReportOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={700}>Validation Results</Typography>
            <Typography variant="caption" color="text.secondary">({validations.length})</Typography>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: '0.7rem' }}>Check</TableCell>
                <TableCell sx={{ fontSize: '0.7rem' }}>Status</TableCell>
                <TableCell sx={{ fontSize: '0.7rem' }}>Detail</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {validations.slice(0, 30).map((v) => (
                <TableRow key={v.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                  <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{v.check_name}</TableCell>
                  <TableCell>
                    <Chip label={v.passed ? 'Pass' : 'Fail'} size="small"
                      sx={{ height: 18, fontSize: '0.65rem',
                        bgcolor: alpha(v.passed ? tokens.emerald600 : tokens.red600, 0.12),
                        color: v.passed ? tokens.emerald600 : tokens.red600 }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.72rem', color: 'text.secondary', maxWidth: 400 }}>{v.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* ── Version history ── */}
      {enabled && versions.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <HistoryOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={700}>Version History</Typography>
          </Box>
          {versions.map((v) => (
            <Accordion key={v.id} disableGutters elevation={0}
              sx={{ '&:before': { display: 'none' }, borderBottom: 1, borderColor: 'divider' }}>
              <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Chip label={`v${v.version}`} size="small"
                    sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
                  <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>{v.created_at.slice(0, 19).replace('T', ' ')}</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc', p: 0 }}>
                <Box component="pre" sx={{ m: 0, p: 2, fontSize: '0.7rem', overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {v.sql_text}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Paper>
      )}

      {/* ── Profiles + Value Mappings ── */}
      {enabled && (profiles.length > 0 || mappings.length > 0) && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={profileTab} onChange={(_, v) => setProfileTab(v)} sx={{ minHeight: 36 }}>
              <Tab label="Column Profiles" sx={{ minHeight: 36, fontSize: '0.78rem', textTransform: 'none' }} />
              <Tab label="Value Mappings" sx={{ minHeight: 36, fontSize: '0.78rem', textTransform: 'none' }} />
            </Tabs>
          </Box>

          {profileTab === 0 && (
            <Box sx={{ p: 0 }}>
              {Object.entries(profilesByTable).map(([tbl, cols]) => (
                <Box key={tbl}>
                  <Box sx={{ px: 2, py: 0.75, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StorageOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', fontSize: '0.68rem' }}>{tbl}</Typography>
                  </Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Column</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Null%</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Distinct</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Pattern</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Min / Max</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {cols.map((c) => (
                        <TableRow key={c.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                          <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{c.column_name}</TableCell>
                          <TableCell sx={{ fontSize: '0.72rem' }}>{c.null_pct != null ? `${c.null_pct.toFixed(1)}%` : '—'}</TableCell>
                          <TableCell sx={{ fontSize: '0.72rem' }}>{c.distinct_count ?? '—'}</TableCell>
                          <TableCell>
                            {c.pattern_hint && (
                              <Chip label={c.pattern_hint} size="small"
                                sx={{ height: 16, fontSize: '0.6rem',
                                  bgcolor: alpha(c.pattern_hint === 'categorical' ? PURPLE : TEAL, 0.1),
                                  color: c.pattern_hint === 'categorical' ? PURPLE : TEAL }} />
                            )}
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                            {c.min_val && c.max_val ? `${c.min_val} / ${c.max_val}` : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ))}
            </Box>
          )}

          {profileTab === 1 && (
            <Box>
              <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                <Button size="small" variant="outlined" startIcon={suggesting ? <CircularProgress size={12} /> : <AutoFixHighOutlined />}
                  onClick={handleSuggest} disabled={!connId || suggesting}>
                  {suggesting ? 'Suggesting…' : 'Suggest Mappings'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {mappings.length} mapping{mappings.length !== 1 ? 's' : ''}
                  {' • '}
                  {mappings.filter((m) => m.status === 'pending').length} pending review
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Table.Column</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Source</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Target</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Type</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Status</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                      <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'text.secondary' }}>
                        {m.table_name}.{m.column_name}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{m.source_value}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', minWidth: 120 }}>
                        {editingMid === m.id ? (
                          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <TextField size="small" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              sx={{ width: 120, '& input': { fontSize: '0.75rem', py: 0.5 } }} autoFocus />
                            <Tooltip title="Save">
                              <IconButton size="small" onClick={() => handleSaveEdit(m)} color="success"><CheckCircleOutlined sx={{ fontSize: 14 }} /></IconButton>
                            </Tooltip>
                            <Tooltip title="Cancel">
                              <IconButton size="small" onClick={() => setEditingMid(null)}><ErrorOutlined sx={{ fontSize: 14 }} /></IconButton>
                            </Tooltip>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <span>{m.target_value ?? '—'}</span>
                            <Tooltip title="Edit">
                              <IconButton size="small" onClick={() => { setEditingMid(m.id); setEditValue(m.target_value ?? '') }}>
                                <EditOutlined sx={{ fontSize: 12 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip label={m.mapping_type} size="small"
                          sx={{ height: 16, fontSize: '0.6rem',
                            bgcolor: alpha(MAPPING_TYPE_COLOR[m.mapping_type] ?? '#64748B', 0.12),
                            color: MAPPING_TYPE_COLOR[m.mapping_type] ?? '#64748B' }} />
                      </TableCell>
                      <TableCell>
                        <Chip label={m.status} size="small"
                          sx={{ height: 16, fontSize: '0.6rem',
                            bgcolor: alpha(MAPPING_STATUS_COLOR[m.status] ?? '#64748B', 0.12),
                            color: MAPPING_STATUS_COLOR[m.status] ?? '#64748B' }} />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.25 }}>
                          {m.status === 'pending' && (
                            <>
                              <Tooltip title="Approve">
                                <IconButton size="small" color="success" onClick={() => handleApprove(m)}>
                                  <ThumbUpOutlined sx={{ fontSize: 13 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Reject">
                                <IconButton size="small" color="error" onClick={() => handleReject(m)}>
                                  <ThumbDownOutlined sx={{ fontSize: 13 }} />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={() => handleDelete(m)}>
                              <DeleteOutlined sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      )}

      {enabled && profiles.length === 0 && mappings.length === 0 && !running && (
        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
          No profiles yet. Click <strong>Re-Profile</strong> to scan columns, then <strong>Run Pipeline</strong> to generate mappings and SQL.
        </Alert>
      )}
    </Box>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════

export default function AgentsPage() {
  const [tab, setTab] = useState(0)

  const { data: resources } = useQuery({
    queryKey: ['agentic-resources'],
    queryFn: () => agenticApi.getResources(),
  })
  const roles          = resources?.roles ?? []
  const availableTools = resources?.available_tools ?? []

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
        <AutoAwesomeOutlined color="primary" sx={{ fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Agentic AI Organisation</Typography>
          <Typography variant="caption" color="text.secondary">
            Onboard employees · Assign roles · Build pipelines · Run A2A workflows with feedback loops
          </Typography>
        </Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 40 }}>
          <Tab label="Employees" icon={<BadgeOutlined sx={{ fontSize: 16 }} />} iconPosition="start"
            sx={{ minHeight: 40, fontSize: '0.813rem', textTransform: 'none' }} />
          <Tab label="Roles" icon={<WorkspacesOutlined sx={{ fontSize: 16 }} />} iconPosition="start"
            sx={{ minHeight: 40, fontSize: '0.813rem', textTransform: 'none' }} />
          <Tab label="Pipeline Cards" icon={<DashboardOutlined sx={{ fontSize: 16 }} />} iconPosition="start"
            sx={{ minHeight: 40, fontSize: '0.813rem', textTransform: 'none' }} />
          <Tab label="Workflows" icon={<BoltOutlined sx={{ fontSize: 16 }} />} iconPosition="start"
            sx={{ minHeight: 40, fontSize: '0.813rem', textTransform: 'none' }} />
          <Tab label="History" icon={<HistoryOutlined sx={{ fontSize: 16 }} />} iconPosition="start"
            sx={{ minHeight: 40, fontSize: '0.813rem', textTransform: 'none' }} />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 0 && <AgentsTab roles={roles} availableTools={availableTools} />}
        {tab === 1 && <RolesTab />}
        {tab === 2 && <CardsTab roles={roles} />}
        {tab === 3 && <WorkflowsTab setTab={setTab} />}
        {tab === 4 && <HistoryTab setTab={setTab} />}
      </Box>
    </Box>
  )
}
