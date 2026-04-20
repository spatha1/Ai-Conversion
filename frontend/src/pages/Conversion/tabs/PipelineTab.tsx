import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, Typography, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Chip, Divider,
  CircularProgress, Alert, Paper, Collapse,
  alpha, Switch, FormControlLabel, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  IconButton,
} from '@mui/material'
import {
  PlayArrowOutlined, AccountTreeOutlined, AutoAwesomeOutlined,
  OutputOutlined, VerifiedOutlined, SendOutlined,
  CheckCircleOutlined, ErrorOutlined, RemoveCircleOutline,
  ScheduleOutlined, HistoryOutlined, SaveOutlined,
  RefreshOutlined, ExpandMoreOutlined, ExpandLessOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { pipelineApi } from '@/api'
import type { PipelineRun, PipelineStepResult, PipelineSchedule, PipelineStatus } from '@/api'
import { useAppStore } from '@/store/useAppStore'

// ── Step definitions (always shown in the flow) ───────────────

const PIPELINE_STEPS: { key: string; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'generate', label: 'Generate Output', icon: <OutputOutlined />,       color: '#10B981' },
  { key: 'validate', label: 'Validate',         icon: <VerifiedOutlined />,     color: '#F59E0B' },
  { key: 'dispatch', label: 'Dispatch',         icon: <SendOutlined />,         color: '#EF4444' },
]

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ── Status helpers ────────────────────────────────────────────

function stepChip(status?: string) {
  if (!status || status === 'pending')
    return <Chip icon={<RemoveCircleOutline />} label="Pending" size="small" variant="outlined" sx={{ color: 'text.disabled' }} />
  if (status === 'running')
    return <Chip icon={<CircularProgress size={12} />} label="Running" size="small" color="info" />
  if (status === 'success')
    return <Chip icon={<CheckCircleOutlined />} label="Success" size="small" color="success" />
  if (status === 'fail')
    return <Chip icon={<ErrorOutlined />} label="Failed" size="small" color="error" />
  if (status === 'skipped')
    return <Chip label="Skipped" size="small" variant="outlined" sx={{ color: 'text.secondary' }} />
  return <Chip label={status} size="small" variant="outlined" />
}

function overallChip(status?: string) {
  if (!status)
    return <Chip label="Not run" size="small" variant="outlined" sx={{ color: 'text.disabled' }} />
  if (status === 'running')
    return <Chip icon={<CircularProgress size={12} />} label="Running" size="small" color="info" />
  if (status === 'success')
    return <Chip icon={<CheckCircleOutlined />} label="Success" size="small" color="success" />
  if (status === 'partial')
    return <Chip icon={<CheckCircleOutlined />} label="Partial" size="small" color="warning" />
  if (status === 'fail')
    return <Chip icon={<ErrorOutlined />} label="Failed" size="small" color="error" />
  return <Chip label={status} size="small" />
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function fmtDuration(startIso?: string, endIso?: string | null) {
  if (!startIso || !endIso) return null
  try {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  } catch { return null }
}

// ── Step card in flow ─────────────────────────────────────────

function StepCard({
  def, result, isLast,
}: {
  def: typeof PIPELINE_STEPS[0]
  result?: PipelineStepResult
  isLast: boolean
}) {
  const status = result?.status
  const active = Boolean(status && status !== 'pending')

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
      <Paper
        variant="outlined"
        sx={{
          flex: 1, p: 2, borderRadius: 2,
          borderColor: status === 'success' ? 'success.main'
            : status === 'fail' ? 'error.main'
            : status === 'skipped' ? 'divider'
            : 'divider',
          bgcolor: (t) => status === 'success'
            ? alpha(t.palette.success.main, 0.04)
            : status === 'fail'
            ? alpha(t.palette.error.main, 0.04)
            : 'background.paper',
          transition: 'all .2s ease',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 1.5,
            bgcolor: alpha(def.color, 0.12),
            '& svg': { fontSize: 18, color: def.color },
          }}>
            {def.icon}
          </Box>
          <Typography variant="body2" fontWeight={700}>{def.label}</Typography>
          <Box sx={{ flex: 1 }} />
          {stepChip(status)}
        </Box>

        {result?.message && (
          <Typography variant="caption" color={status === 'fail' ? 'error' : 'text.secondary'}
            sx={{ display: 'block', wordBreak: 'break-word' }}>
            {result.message}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {result?.count != null && result.count > 0 && (
            <Chip label={`${result.count} records`} size="small" variant="outlined" />
          )}
          {result?.elapsed_ms != null && (
            <Chip label={`${result.elapsed_ms}ms`} size="small" variant="outlined" sx={{ color: 'text.secondary' }} />
          )}
        </Box>
      </Paper>

      {!isLast && (
        <Box sx={{
          display: 'flex', alignItems: 'center', px: 1,
          color: 'text.disabled', fontSize: 24, userSelect: 'none',
        }}>
          →
        </Box>
      )}
    </Box>
  )
}

// ── Main component ────────────────────────────────────────────

export default function PipelineTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const { activeConnection, templateFormat } = useAppStore()
  const connId = activeConnection?.id ?? ''

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [historyOpen,  setHistoryOpen]  = useState(false)

  // Schedule form state
  const [sched, setSched] = useState<Omit<PipelineSchedule, 'id' | 'conn_id' | 'next_run_at' | 'last_run_at' | 'last_run_status'>>({
    schedule_type: 'manual', is_enabled: true,
  })

  // Load last run
  const { data: lastRun, refetch: refetchLastRun, isFetching: runFetching } = useQuery<PipelineRun | null>({
    queryKey: ['pipeline-last-run', connId],
    queryFn: () => pipelineApi.lastRun(connId as number),
    enabled: Boolean(connId),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 3000 : false,
  })

  // Load schedule
  const { data: savedSched, refetch: refetchSched } = useQuery<PipelineSchedule>({
    queryKey: ['pipeline-schedule', connId],
    queryFn: () => pipelineApi.getSchedule(connId as number),
    enabled: Boolean(connId),
  })

  useEffect(() => {
    if (!savedSched) return
    setSched({
      schedule_type:    savedSched.schedule_type ?? 'manual',
      interval_minutes: savedSched.interval_minutes ?? undefined,
      run_at_time:      savedSched.run_at_time ?? undefined,
      run_on_day:       savedSched.run_on_day ?? undefined,
      is_enabled:       savedSched.is_enabled ?? true,
    })
  }, [savedSched])

  // Load current data status (generated/validated counts)
  const { data: pipeStatus } = useQuery<PipelineStatus>({
    queryKey: ['pipeline-status', connId],
    queryFn: () => pipelineApi.getStatus(connId as number),
    enabled: Boolean(connId),
    refetchInterval: 10000,
  })

  // Load history
  const { data: history = [] } = useQuery<PipelineRun[]>({
    queryKey: ['pipeline-history', connId],
    queryFn: () => pipelineApi.history(connId as number, 8),
    enabled: Boolean(connId) && historyOpen,
  })

  const runMut = useMutation({
    mutationFn: () => pipelineApi.run(connId as number),
    onSuccess: (r) => {
      enqueueSnackbar(
        r.status === 'success' ? 'Pipeline completed successfully'
        : r.status === 'partial' ? 'Pipeline completed with some failures'
        : 'Pipeline failed',
        { variant: r.status === 'success' ? 'success' : r.status === 'partial' ? 'warning' : 'error' }
      )
      qc.setQueryData(['pipeline-last-run', connId], r)
      qc.invalidateQueries({ queryKey: ['pipeline-history', connId] })
      qc.invalidateQueries({ queryKey: ['pipeline-status', connId] })
      qc.invalidateQueries({ queryKey: ['generated-xml', connId] })
      qc.invalidateQueries({ queryKey: ['dispatch-xmls', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveSched = useMutation({
    mutationFn: () => pipelineApi.saveSchedule(connId as number, sched),
    onSuccess: () => {
      enqueueSnackbar('Schedule saved', { variant: 'success' })
      refetchSched()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const isRunning = runMut.isPending || lastRun?.status === 'running'

  // Map step results by key for the flow display.
  // If no pipeline run exists yet, synthesise step results from existing data counts.
  const stepMap: Record<string, PipelineStepResult> = {}
  if (lastRun?.steps) {
    for (const s of lastRun.steps) stepMap[s.step] = s
  } else if (pipeStatus && !isRunning) {
    const fmt = pipeStatus.format_type ?? 'xml'
    if (pipeStatus.generated_count > 0) {
      stepMap['generate'] = {
        step: 'generate', label: `Generate ${fmt.toUpperCase()} Output`,
        status: 'success',
        message: `${pipeStatus.generated_count} record(s) already generated (via Output tab)`,
        count: pipeStatus.generated_count,
      }
    }
    if (pipeStatus.validated_pass > 0 || pipeStatus.validated_fail > 0) {
      const total = pipeStatus.validated_pass + pipeStatus.validated_fail
      stepMap['validate'] = {
        step: 'validate', label: 'Validate',
        status: pipeStatus.validated_fail === 0 ? 'success' : 'fail',
        message: `${pipeStatus.validated_pass} passed, ${pipeStatus.validated_fail} failed (via Validation tab)`,
        count: pipeStatus.validated_pass,
      }
    }
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>Conversion Pipeline</Typography>
          <Typography variant="body2" color="text.secondary">
            Generate → Validate → Dispatch in one click
          </Typography>
        </Box>

        {lastRun && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {overallChip(lastRun.status)}
            <Typography variant="caption" color="text.secondary">
              last run {fmtTime(lastRun.started_at)}
              {lastRun.finished_at && ` (${fmtDuration(lastRun.started_at, lastRun.finished_at)})`}
            </Typography>
          </Box>
        )}

        <Tooltip title="Refresh last run">
          <span>
            <IconButton size="small" onClick={() => refetchLastRun()} disabled={!connId || runFetching}>
              <RefreshOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Button
          variant="contained"
          size="large"
          startIcon={isRunning ? <CircularProgress size={18} color="inherit" /> : <PlayArrowOutlined />}
          onClick={() => runMut.mutate()}
          disabled={!connId || isRunning}
          sx={{ minWidth: 140 }}
        >
          {isRunning ? 'Running…' : 'Run Now'}
        </Button>
      </Box>

      {!connId && (
        <Alert severity="info">Select a connection to use the pipeline.</Alert>
      )}

      {/* ── Pipeline Flow ─────────────────────────────────────── */}
      <Card>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            {/* Implicit steps: Target + Mapping are prerequisites */}
            <Paper variant="outlined" sx={{
              p: 2, borderRadius: 2, display: 'flex', flexDirection: 'column',
              gap: 1, minWidth: 140, bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
              borderColor: 'primary.main',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: 1.5,
                  bgcolor: alpha('#8B5CF6', 0.12),
                  '& svg': { fontSize: 18, color: '#8B5CF6' },
                }}>
                  <AccountTreeOutlined />
                </Box>
                <Typography variant="body2" fontWeight={700}>Target + Mapping</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Prerequisites — configure in Target and Agent Pipeline tabs
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Chip
                  label={`Template: ${pipeStatus?.has_template ? '✓' : '✗'}`}
                  size="small" variant="outlined"
                  color={pipeStatus?.has_template ? 'success' : 'default'}
                />
                <Chip
                  label={`Mapping: ${pipeStatus?.has_mapping ? '✓' : '✗'}`}
                  size="small" variant="outlined"
                  color={pipeStatus?.has_mapping ? 'success' : 'default'}
                />
                <Chip
                  label={`Query: ${pipeStatus?.has_query ? '✓' : '✗'}`}
                  size="small" variant="outlined"
                  color={pipeStatus?.has_query ? 'success' : 'default'}
                />
              </Box>
            </Paper>

            <Box sx={{ display: 'flex', alignItems: 'center', px: 1, color: 'text.disabled', fontSize: 24 }}>→</Box>

            {PIPELINE_STEPS.map((def, idx) => (
              <StepCard
                key={def.key}
                def={def}
                result={stepMap[def.key]}
                isLast={idx === PIPELINE_STEPS.length - 1}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* ── Schedule ─────────────────────────────────────────── */}
      <Card>
        <CardContent sx={{ p: 2, pb: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setScheduleOpen((v) => !v)}>
            <ScheduleOutlined sx={{ mr: 1, color: 'text.secondary' }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
              Schedule
              {savedSched && savedSched.schedule_type !== 'manual' && savedSched.is_enabled && (
                <Chip label={savedSched.schedule_type} size="small" color="primary" sx={{ ml: 1, fontWeight: 600 }} />
              )}
              {savedSched?.next_run_at && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  next: {fmtTime(savedSched.next_run_at)}
                </Typography>
              )}
            </Typography>
            {scheduleOpen ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
          </Box>
        </CardContent>

        <Collapse in={scheduleOpen}>
          <CardContent sx={{ pt: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <FormControl sx={{ minWidth: 160 }}>
                  <InputLabel>Schedule Type</InputLabel>
                  <Select
                    value={sched.schedule_type}
                    label="Schedule Type"
                    onChange={(e) => setSched({ ...sched, schedule_type: e.target.value })}
                  >
                    <MenuItem value="manual">Manual only</MenuItem>
                    <MenuItem value="interval">Every N minutes</MenuItem>
                    <MenuItem value="daily">Daily at time</MenuItem>
                    <MenuItem value="weekly">Weekly on day</MenuItem>
                  </Select>
                </FormControl>

                {sched.schedule_type === 'interval' && (
                  <TextField
                    label="Interval (minutes)" type="number"
                    value={sched.interval_minutes ?? ''}
                    onChange={(e) => setSched({ ...sched, interval_minutes: Number(e.target.value) || undefined })}
                    sx={{ width: 160 }}
                    inputProps={{ min: 1 }}
                  />
                )}

                {(sched.schedule_type === 'daily' || sched.schedule_type === 'weekly') && (
                  <TextField
                    label="Run at (HH:MM)" placeholder="08:00"
                    value={sched.run_at_time ?? ''}
                    onChange={(e) => setSched({ ...sched, run_at_time: e.target.value })}
                    sx={{ width: 140 }}
                  />
                )}

                {sched.schedule_type === 'weekly' && (
                  <FormControl sx={{ minWidth: 140 }}>
                    <InputLabel>Day of Week</InputLabel>
                    <Select
                      value={sched.run_on_day ?? 0}
                      label="Day of Week"
                      onChange={(e) => setSched({ ...sched, run_on_day: Number(e.target.value) })}
                    >
                      {DAY_NAMES.map((d, i) => (
                        <MenuItem key={i} value={i}>{d}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                {sched.schedule_type !== 'manual' && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={sched.is_enabled}
                        onChange={(e) => setSched({ ...sched, is_enabled: e.target.checked })}
                        color="primary"
                      />
                    }
                    label="Enabled"
                  />
                )}
              </Box>

              <Box>
                <Button
                  variant="contained"
                  startIcon={<SaveOutlined />}
                  onClick={() => saveSched.mutate()}
                  disabled={!connId || saveSched.isPending}
                >
                  {saveSched.isPending ? 'Saving…' : 'Save Schedule'}
                </Button>
              </Box>

              {savedSched?.last_run_at && (
                <Typography variant="caption" color="text.secondary">
                  Last run: {fmtTime(savedSched.last_run_at)} —{' '}
                  {overallChip(savedSched.last_run_status ?? undefined)}
                </Typography>
              )}
            </Box>
          </CardContent>
        </Collapse>
      </Card>

      {/* ── Run History ──────────────────────────────────────── */}
      <Card>
        <CardContent sx={{ p: 2, pb: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setHistoryOpen((v) => !v)}>
            <HistoryOutlined sx={{ mr: 1, color: 'text.secondary' }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
              Run History
            </Typography>
            {historyOpen ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
          </Box>
        </CardContent>

        <Collapse in={historyOpen}>
          {history.length === 0 ? (
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="body2" color="text.secondary">No run history yet.</Typography>
            </CardContent>
          ) : (
            <TableContainer component={Paper} elevation={0}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Triggered</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Started</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Duration</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Generate</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Validate</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Dispatch</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map((run) => {
                    const sm: Record<string, PipelineStepResult> = {}
                    for (const s of run.steps ?? []) sm[s.step] = s
                    return (
                      <TableRow key={run.id}
                        sx={{
                          bgcolor: run.status === 'fail'
                            ? (t) => alpha(t.palette.error.main, 0.03)
                            : run.status === 'success'
                            ? (t) => alpha(t.palette.success.main, 0.03)
                            : undefined,
                        }}
                      >
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">#{run.id}</Typography>
                        </TableCell>
                        <TableCell>{overallChip(run.status)}</TableCell>
                        <TableCell>
                          <Chip label={run.triggered_by} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{fmtTime(run.started_at)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {fmtDuration(run.started_at, run.finished_at) ?? '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>{stepChip(sm['generate']?.status)}</TableCell>
                        <TableCell>{stepChip(sm['validate']?.status)}</TableCell>
                        <TableCell>{stepChip(sm['dispatch']?.status)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Collapse>
      </Card>

    </Box>
  )
}
