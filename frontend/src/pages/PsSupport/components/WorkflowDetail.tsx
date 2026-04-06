import { useState } from 'react'
import {
  Box, Typography, Button, Chip, Divider,
  Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Tooltip, Paper, alpha, CircularProgress, LinearProgress,
} from '@mui/material'
import {
  PlayArrowOutlined, EditOutlined, DeleteOutlined, ContentCopyOutlined,
  CodeOutlined, LinkOutlined, EmailOutlined, AutoAwesomeOutlined,
  HistoryOutlined, CheckCircleOutlined, ErrorOutlined,
  AccessTimeOutlined, ScheduleOutlined, CloseOutlined,
  ArrowDownwardOutlined, SettingsOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { psApi } from '@/api'
import type { Workflow } from '@/types'

const STEP_META: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  sql:      { icon: <CodeOutlined />,        color: '#2563eb', bg: '#dbeafe', label: 'SQL Query'  },
  api:      { icon: <LinkOutlined />,        color: '#7c3aed', bg: '#ede9fe', label: 'API Call'   },
  api_loop: { icon: <AutoAwesomeOutlined />, color: '#059669', bg: '#d1fae5', label: 'API Loop'   },
  email:    { icon: <EmailOutlined />,       color: '#d97706', bg: '#fef3c7', label: 'Send Email' },
}

function StatusChip({ status }: { status: string }) {
  const cfg: Record<string, { color: 'success' | 'error' | 'warning' | 'default'; icon: React.ReactNode }> = {
    success: { color: 'success', icon: <CheckCircleOutlined sx={{ fontSize: '14px !important' }} /> },
    failed:  { color: 'error',   icon: <ErrorOutlined      sx={{ fontSize: '14px !important' }} /> },
    partial: { color: 'warning', icon: <AccessTimeOutlined sx={{ fontSize: '14px !important' }} /> },
    running: { color: 'default', icon: <CircularProgress size={10} /> },
  }
  const { color, icon } = cfg[status] ?? { color: 'default' as const, icon: null }
  return (
    <Chip icon={icon as any} label={status.charAt(0).toUpperCase() + status.slice(1)}
      color={color} size="small" variant="outlined" sx={{ fontWeight: 700 }} />
  )
}

function FlowNode({ step, index, total }: { step: any; index: number; total: number }) {
  const [expanded, setExpanded] = useState(false)
  const type = step.step_type ?? 'sql'
  const meta = STEP_META[type] ?? STEP_META.sql

  let configObj: Record<string, unknown> = {}
  try { configObj = JSON.parse(step.config_json ?? '{}') } catch { /* ignore */ }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <Paper
        elevation={0}
        sx={{
          width: '100%', maxWidth: 560,
          border: '2px solid', borderColor: meta.color,
          borderRadius: 3, overflow: 'hidden',
          boxShadow: `0 4px 24px ${alpha(meta.color, 0.12)}`,
          transition: 'box-shadow .2s',
          '&:hover': { boxShadow: `0 6px 32px ${alpha(meta.color, 0.25)}` },
        }}
      >
        {/* Header row */}
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5,
            bgcolor: (t) => t.palette.mode === 'dark' ? alpha(meta.color, 0.15) : alpha(meta.color, 0.06),
          }}
        >
          {/* Step number */}
          <Box sx={{
            width: 28, height: 28, borderRadius: '50%',
            bgcolor: meta.color, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 800, flexShrink: 0,
          }}>
            {index + 1}
          </Box>
          {/* Type icon */}
          <Box sx={{
            width: 32, height: 32, borderRadius: 1.5, flexShrink: 0,
            bgcolor: (t) => t.palette.mode === 'dark' ? alpha(meta.color, 0.3) : meta.bg,
            color: meta.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            '& svg': { fontSize: 18 },
          }}>
            {meta.icon}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} noWrap>
              {step.label ?? step.name ?? `Step ${index + 1}`}
            </Typography>
            <Chip label={meta.label} size="small" sx={{
              height: 18, fontSize: '0.625rem', fontWeight: 700, mt: 0.25,
              bgcolor: (t) => t.palette.mode === 'dark' ? alpha(meta.color, 0.25) : meta.bg,
              color: meta.color,
            }} />
          </Box>
          {Object.keys(configObj).length > 0 && (
            <Tooltip title={expanded ? 'Hide config' : 'Show config'}>
              <IconButton size="small" onClick={() => setExpanded(v => !v)} sx={{ color: meta.color }}>
                <SettingsOutlined sx={{ fontSize: 16, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Config panel */}
        {expanded && Object.keys(configObj).length > 0 && (
          <Box sx={{
            px: 2.5, py: 1.5,
            fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary',
            bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.3) : alpha('#f8fafc', 0.9),
            whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto',
            borderTop: `1px solid ${alpha(meta.color, 0.15)}`,
          }}>
            {type === 'sql' && configObj.sql
              ? String(configObj.sql)
              : type === 'email'
              ? `To: ${configObj.to}\nSubject: ${configObj.subject}\n\n${configObj.body}`
              : JSON.stringify(configObj, null, 2)}
          </Box>
        )}
      </Paper>

      {/* Arrow connector */}
      {index < total - 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', my: 0.25 }}>
          <Box sx={{ width: 2, height: 14, bgcolor: 'divider' }} />
          <ArrowDownwardOutlined sx={{ fontSize: 20, color: 'text.disabled' }} />
          <Box sx={{ width: 2, height: 8, bgcolor: 'divider' }} />
        </Box>
      )}
    </Box>
  )
}

function StartNode() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', mb: 0 }}>
      <Box sx={{
        px: 3.5, py: 0.875, borderRadius: 6,
        border: '2px solid', borderColor: 'success.main',
        bgcolor: t => alpha(t.palette.success.main, 0.08),
        display: 'flex', alignItems: 'center', gap: 1,
      }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main',
          boxShadow: t => `0 0 0 3px ${alpha(t.palette.success.main, 0.25)}` }} />
        <Typography variant="caption" fontWeight={800} color="success.main" sx={{ letterSpacing: '0.12em' }}>
          START
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', my: 0.25 }}>
        <Box sx={{ width: 2, height: 14, bgcolor: 'divider' }} />
        <ArrowDownwardOutlined sx={{ fontSize: 20, color: 'text.disabled' }} />
        <Box sx={{ width: 2, height: 8, bgcolor: 'divider' }} />
      </Box>
    </Box>
  )
}

function EndNode() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <Box sx={{ width: 2, height: 14, bgcolor: 'divider', mt: 0.25 }} />
      <Box sx={{
        px: 3.5, py: 0.875, borderRadius: 6, mt: 0.25,
        border: '2px solid', borderColor: 'text.disabled',
        bgcolor: 'action.hover',
        display: 'flex', alignItems: 'center', gap: 1,
      }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
        <Typography variant="caption" fontWeight={800} color="text.disabled" sx={{ letterSpacing: '0.12em' }}>
          END
        </Typography>
      </Box>
    </Box>
  )
}

interface Props {
  workflow: Workflow
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}

export default function WorkflowDetail({ workflow, onEdit, onDelete, onClose }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [showHistory, setShowHistory] = useState(false)

  const { data: runs = [], isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['workflow-runs', workflow.id],
    queryFn: () => psApi.getWorkflowRuns(workflow.id, 10),
    enabled: showHistory,
  })

  const runMutation = useMutation({
    mutationFn: () => psApi.runWorkflow(workflow.id),
    onSuccess: (r: any) => {
      enqueueSnackbar(`Workflow completed — Status: ${r.status}`, { variant: r.status === 'success' ? 'success' : 'warning' })
      queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
      if (showHistory) refetchRuns()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const cloneMutation = useMutation({
    mutationFn: () => psApi.cloneWorkflow(workflow.id),
    onSuccess: (wf) => {
      queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
      enqueueSnackbar(`Cloned as "${wf.name}"`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const schedule = (workflow as any).schedule
  const lastRun  = (workflow as any).last_run
  const steps    = workflow.steps ?? []

  const formatSchedule = () => {
    if (!schedule || schedule.schedule_type === 'manual') return 'Manual trigger only'
    if (schedule.schedule_type === 'interval') return `Every ${schedule.interval_minutes} minutes`
    if (schedule.schedule_type === 'daily')    return `Daily at ${schedule.run_at_time}`
    if (schedule.schedule_type === 'weekly') {
      const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
      return `Weekly on ${days[schedule.run_on_day ?? 0]} at ${schedule.run_at_time}`
    }
    return 'Unknown'
  }

  const formatDuration = (s: string, f: string) => {
    if (!s || !f) return '—'
    const ms = new Date(f).getTime() - new Date(s).getTime()
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{
        px: 3, py: 2,
        background: t => t.palette.mode === 'dark'
          ? 'linear-gradient(135deg, rgba(37,99,235,.15) 0%, rgba(124,58,237,.15) 100%)'
          : 'linear-gradient(135deg, rgba(37,99,235,.06) 0%, rgba(124,58,237,.06) 100%)',
        borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={800} gutterBottom>{workflow.name}</Typography>
            {workflow.description && <Typography variant="body2" color="text.secondary">{workflow.description}</Typography>}
          </Box>
          <IconButton size="small" onClick={onClose}><CloseOutlined fontSize="small" /></IconButton>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {lastRun && <StatusChip status={lastRun.status} />}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ScheduleOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary">{formatSchedule()}</Typography>
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            <Tooltip title="Clone workflow">
              <IconButton size="small" onClick={() => cloneMutation.mutate()}>
                <ContentCopyOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={onEdit}>Edit</Button>
            <Button size="small" variant="contained" color="error" startIcon={<DeleteOutlined />} onClick={onDelete}>Delete</Button>
            <Button
              variant="contained" color="success"
              startIcon={runMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlined />}
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              sx={{ minWidth: 110 }}
            >
              {runMutation.isPending ? 'Running…' : 'Run Now'}
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>

        {/* Flow diagram title */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2.5, gap: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>Workflow Flow</Typography>
          <Chip label={`${steps.length} steps`} size="small" />
          {lastRun && (
            <Chip
              label={`Last run: ${lastRun.status}`} size="small"
              color={lastRun.status === 'success' ? 'success' : lastRun.status === 'failed' ? 'error' : 'warning'}
              variant="outlined"
            />
          )}
        </Box>

        {steps.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2, borderStyle: 'dashed' }}>
            <Typography variant="body2" color="text.disabled">No steps defined</Typography>
          </Paper>
        ) : (
          <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            py: 3, px: 2,
            bgcolor: t => t.palette.mode === 'dark' ? alpha('#000', 0.12) : alpha('#f8fafc', 0.8),
            borderRadius: 3, border: '1px solid', borderColor: 'divider',
          }}>
            <StartNode />
            {steps.map((step, i) => (
              <FlowNode key={(step as any).id ?? i} step={step} index={i} total={steps.length} />
            ))}
            <EndNode />
          </Box>
        )}

        {/* Run History */}
        <Box sx={{ mt: 3 }}>
          <Button
            variant="outlined" size="small" startIcon={<HistoryOutlined />}
            onClick={() => setShowHistory(!showHistory)} sx={{ mb: 2 }}
          >
            {showHistory ? 'Hide' : 'Show'} Run History
          </Button>

          {showHistory && (
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>Recent Runs</Typography>
              </Box>
              <Divider />
              {runsLoading ? <LinearProgress /> : runs.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.disabled">No runs yet</Typography>
                </Box>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell>Triggered By</TableCell>
                      <TableCell>Started</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Steps</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(runs as any[]).map((run) => (
                      <TableRow key={run.id} hover>
                        <TableCell><StatusChip status={run.status} /></TableCell>
                        <TableCell>
                          <Chip label={run.triggered_by} size="small" variant="outlined"
                            color={run.triggered_by === 'manual' ? 'primary' : 'secondary'}
                            sx={{ fontSize: '0.688rem' }} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{formatDuration(run.started_at, run.finished_at)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {(run.steps ?? []).map((s: any, i: number) => (
                              <Tooltip key={i} title={`${s.label}: ${s.status}${s.error ? ` — ${s.error}` : ''}`}>
                                <Box sx={{
                                  width: 10, height: 10, borderRadius: '50%',
                                  bgcolor: s.status === 'success' ? 'success.main'
                                    : s.status === 'failed' ? 'error.main' : 'warning.main',
                                }} />
                              </Tooltip>
                            ))}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  )
}
