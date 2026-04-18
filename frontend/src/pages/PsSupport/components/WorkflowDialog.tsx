import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Button, TextField, Typography, IconButton, Divider,
  Select, MenuItem, FormControl, InputLabel, Chip, Paper,
  Tooltip, Alert, alpha, Avatar, Collapse,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, CloseOutlined, DragHandleOutlined,
  CodeOutlined, LinkOutlined, EmailOutlined, AutoAwesomeOutlined,
  ExpandMoreOutlined, ExpandLessOutlined, SaveOutlined,
} from '@mui/icons-material'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import { psApi } from '@/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import type { Workflow } from '@/types'

type StepType = 'sql' | 'api' | 'api_loop' | 'email'

interface StepDraft {
  id: string
  step_type: StepType
  label: string
  // SQL
  sql?: string
  // API
  api_id?: number
  payload?: string
  // API Loop
  loop_sql?: string
  payload_template?: string
  // Email
  to?: string
  subject?: string
  body?: string
}

const STEP_META: Record<StepType, { label: string; color: string; icon: React.ReactNode }> = {
  sql: { label: 'SQL Query', color: '#2563eb', icon: <CodeOutlined /> },
  api: { label: 'API Call', color: '#7c3aed', icon: <LinkOutlined /> },
  api_loop: { label: 'API Loop', color: '#059669', icon: <AutoAwesomeOutlined /> },
  email: { label: 'Send Email', color: '#d97706', icon: <EmailOutlined /> },
}

function StepCard({
  step,
  index,
  onUpdate,
  onDelete,
  apiEntries,
}: {
  step: StepDraft
  index: number
  onUpdate: (s: StepDraft) => void
  onDelete: () => void
  apiEntries: Array<{ id: number; name: string }>
}) {
  const [expanded, setExpanded] = useState(true)
  const meta = STEP_META[step.step_type]

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        borderColor: alpha(meta.color, 0.4),
        borderLeftWidth: 4,
        borderLeftColor: meta.color,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          px: 2, py: 1,
          bgcolor: (t) => alpha(meta.color, t.palette.mode === 'dark' ? 0.12 : 0.05),
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <DragHandleOutlined sx={{ color: 'text.disabled', fontSize: 18 }} />
        <Avatar sx={{ width: 26, height: 26, bgcolor: meta.color, fontSize: 14 }}>
          {index + 1}
        </Avatar>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {meta.icon}
          <Chip label={meta.label} size="small" sx={{ bgcolor: meta.color, color: 'white', fontWeight: 700, fontSize: '0.688rem' }} />
        </Box>
        <TextField
          value={step.label}
          onChange={(e) => { e.stopPropagation(); onUpdate({ ...step, label: e.target.value }) }}
          onClick={(e) => e.stopPropagation()}
          size="small"
          placeholder="Step name…"
          variant="standard"
          sx={{ flex: 1, '& input': { fontWeight: 600, fontSize: '0.875rem' } }}
        />
        <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onDelete() }}>
          <DeleteOutlined fontSize="small" />
        </IconButton>
        {expanded ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
      </Box>

      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {step.step_type === 'sql' && (
            <TextField
              label="SQL Query"
              value={step.sql ?? ''}
              onChange={(e) => onUpdate({ ...step, sql: e.target.value })}
              multiline rows={4} fullWidth
              placeholder="SELECT * FROM dbo.Employees WHERE Status = 'A'"
              sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
            />
          )}

          {step.step_type === 'api' && (
            <>
              <FormControl fullWidth size="small">
                <InputLabel>API Endpoint</InputLabel>
                <Select
                  value={step.api_id ?? ''}
                  label="API Endpoint"
                  onChange={(e) => onUpdate({ ...step, api_id: Number(e.target.value) })}
                >
                  {apiEntries.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField
                label="Payload (JSON)"
                value={step.payload ?? ''}
                onChange={(e) => onUpdate({ ...step, payload: e.target.value })}
                multiline rows={3} fullWidth
                placeholder='{"employeeId": 123, "status": "A"}'
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
              />
            </>
          )}

          {step.step_type === 'api_loop' && (
            <>
              <FormControl fullWidth size="small">
                <InputLabel>API Endpoint</InputLabel>
                <Select
                  value={step.api_id ?? ''}
                  label="API Endpoint"
                  onChange={(e) => onUpdate({ ...step, api_id: Number(e.target.value) })}
                >
                  {apiEntries.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField
                label="SQL to get rows"
                value={step.loop_sql ?? ''}
                onChange={(e) => onUpdate({ ...step, loop_sql: e.target.value })}
                multiline rows={3} fullWidth
                placeholder="SELECT EmployeeId, Name FROM dbo.Employees"
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
              />
              <TextField
                label="Payload Template (map API fields to SQL columns)"
                value={step.payload_template ?? ''}
                onChange={(e) => onUpdate({ ...step, payload_template: e.target.value })}
                multiline rows={2} fullWidth
                placeholder='{"empId": "EmployeeId", "name": "Name"}'
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
                helperText="Map API payload field names → SQL column names"
              />
            </>
          )}

          {step.step_type === 'email' && (
            <>
              <TextField
                label="To"
                value={step.to ?? ''}
                onChange={(e) => onUpdate({ ...step, to: e.target.value })}
                fullWidth placeholder="recipient@example.com"
              />
              <TextField
                label="Subject"
                value={step.subject ?? ''}
                onChange={(e) => onUpdate({ ...step, subject: e.target.value })}
                fullWidth
              />
              <TextField
                label="Body"
                value={step.body ?? ''}
                onChange={(e) => onUpdate({ ...step, body: e.target.value })}
                multiline rows={4} fullWidth
                placeholder="Hi team,\n\nHere are the results:\n\n{{sql_results}}\n\nRegards"
                helperText="Use {{sql_results}} to insert prior SQL step output as an HTML table"
              />
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  existing?: Workflow | null
  connId?: number | null
  onCreated?: (wf: Workflow) => void
}

function buildConfigJson(step: StepDraft): string {
  switch (step.step_type) {
    case 'sql':
      return JSON.stringify({ sql: step.sql ?? '' })
    case 'api':
      return JSON.stringify({
        api_id: step.api_id,
        payload: step.payload ? (() => { try { return JSON.parse(step.payload!) } catch { return {} } })() : {},
      })
    case 'api_loop':
      return JSON.stringify({
        api_id: step.api_id,
        sql: step.loop_sql ?? '',
        payload_template: step.payload_template
          ? (() => { try { return JSON.parse(step.payload_template!) } catch { return {} } })()
          : {},
      })
    case 'email':
      return JSON.stringify({ to: step.to ?? '', subject: step.subject ?? '', body: step.body ?? '' })
    default:
      return '{}'
  }
}

let _counter = 0
const uid = () => `step-${++_counter}-${Date.now()}`

export default function WorkflowDialog({ open, onClose, existing, connId: pageConnId, onCreated }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [connId, setConnId] = useState<number | ''>('')
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [scheduleType, setScheduleType] = useState<'manual' | 'interval' | 'daily' | 'weekly'>('manual')
  const [intervalMins, setIntervalMins] = useState(60)
  const [runAtTime, setRunAtTime] = useState('09:00')

  const { data: apiEntries = [] } = useQuery({
    queryKey: ['ps-api-collection', pageConnId],
    queryFn: () => psApi.listApiCollection(pageConnId ?? undefined),
    enabled: open,
  })

  // Populate from existing workflow
  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setDescription(existing.description ?? '')
      const steps_: StepDraft[] = (existing.steps ?? []).map((s) => {
        const cfg = s.config ? JSON.parse(JSON.stringify(s.config)) : {}
        return {
          id: uid(),
          step_type: (s.step_type as StepType) ?? 'sql',
          label: s.name ?? '',
          sql: cfg.sql,
          api_id: cfg.api_id,
          payload: cfg.payload ? JSON.stringify(cfg.payload, null, 2) : undefined,
          loop_sql: cfg.sql,
          payload_template: cfg.payload_template ? JSON.stringify(cfg.payload_template, null, 2) : undefined,
          to: cfg.to,
          subject: cfg.subject,
          body: cfg.body,
        }
      })
      setSteps(steps_)
    } else {
      setName('')
      setDescription('')
      setConnId('')
      setSteps([])
      setScheduleType('manual')
    }
  }, [existing, open])

  const createMutation = useMutation({
    mutationFn: () =>
      psApi.createWorkflow({
        name: name.trim(),
        description: description.trim() || undefined,
        conn_id: connId !== '' ? (connId as number) : undefined,
        steps: steps.map((s, i) => ({
          step_type: s.step_type,
          label: s.label || `Step ${i + 1}`,
          config_json: buildConfigJson(s),
        })),
      }),
    onSuccess: async (wf) => {
      if (scheduleType !== 'manual') {
        await psApi.setSchedule(wf.id, {
          schedule_type: scheduleType,
          interval_minutes: scheduleType === 'interval' ? intervalMins : undefined,
          run_at_time: scheduleType !== 'interval' ? runAtTime : undefined,
          is_enabled: true,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
      enqueueSnackbar(`Workflow "${wf.name}" created`, { variant: 'success' })
      onClose()
      onCreated?.(wf)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      psApi.updateWorkflow(existing!.id, { name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ps-workflows'] })
      enqueueSnackbar('Workflow updated', { variant: 'success' })
      onClose()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const addStep = (type: StepType) => {
    setSteps((prev) => [
      ...prev,
      {
        id: uid(),
        step_type: type,
        label: `${STEP_META[type].label} ${prev.filter((s) => s.step_type === type).length + 1}`,
      },
    ])
  }

  const updateStep = (id: string, updated: StepDraft) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? updated : s)))
  }

  const deleteStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id))

  const isEditing = Boolean(existing)
  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>
            {isEditing ? 'Edit Workflow' : 'Create Workflow'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isEditing ? 'Update workflow name and description' : 'Define steps, schedule, and connection'}
          </Typography>
        </Box>
        <IconButton onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Basic info */}
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Basic Information</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField
                label="Workflow Name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth autoFocus
              />
              <TextField
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth multiline rows={2}
              />
              {!isEditing && (
                <ConnectionSelector
                  value={connId}
                  onChange={(_, id) => setConnId(id)}
                  label="Data Source Connection (optional)"
                  sx={{ width: '100%' }}
                />
              )}
            </Box>
          </Box>

          {/* Steps (only for create) */}
          {!isEditing && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
                  Steps
                  {steps.length > 0 && <Chip label={steps.length} size="small" sx={{ ml: 1 }} />}
                </Typography>
                <Typography variant="caption" color="text.secondary">Executed in order ↓</Typography>
              </Box>

              {/* Add step buttons */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {(Object.entries(STEP_META) as [StepType, typeof STEP_META[StepType]][]).map(([type, meta]) => (
                  <Button
                    key={type}
                    size="small"
                    variant="outlined"
                    startIcon={meta.icon}
                    onClick={() => addStep(type)}
                    sx={{ borderColor: alpha(meta.color, 0.5), color: meta.color, '&:hover': { bgcolor: alpha(meta.color, 0.06) } }}
                  >
                    + {meta.label}
                  </Button>
                ))}
              </Box>

              {/* Step list */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {steps.length === 0 ? (
                  <Paper
                    variant="outlined"
                    sx={{ p: 4, textAlign: 'center', borderRadius: 2, borderStyle: 'dashed' }}
                  >
                    <Typography variant="body2" color="text.disabled">
                      No steps yet — add steps above to define what this workflow does
                    </Typography>
                  </Paper>
                ) : (
                  steps.map((step, i) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      index={i}
                      onUpdate={(updated) => updateStep(step.id, updated)}
                      onDelete={() => deleteStep(step.id)}
                      apiEntries={apiEntries.map((a) => ({ id: a.id, name: a.name }))}
                    />
                  ))
                )}
              </Box>
            </Box>
          )}

          {/* Schedule (only for create) */}
          {!isEditing && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Schedule</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Schedule Type</InputLabel>
                  <Select value={scheduleType} label="Schedule Type" onChange={(e) => setScheduleType(e.target.value as any)}>
                    <MenuItem value="manual">Manual only</MenuItem>
                    <MenuItem value="interval">Every N minutes</MenuItem>
                    <MenuItem value="daily">Daily at time</MenuItem>
                    <MenuItem value="weekly">Weekly on day</MenuItem>
                  </Select>
                </FormControl>
                {scheduleType === 'interval' && (
                  <TextField
                    label="Interval (minutes)"
                    type="number"
                    value={intervalMins}
                    onChange={(e) => setIntervalMins(Number(e.target.value))}
                    size="small"
                    sx={{ width: 160 }}
                  />
                )}
                {(scheduleType === 'daily' || scheduleType === 'weekly') && (
                  <TextField
                    label="Run at (HH:MM)"
                    value={runAtTime}
                    onChange={(e) => setRunAtTime(e.target.value)}
                    size="small"
                    sx={{ width: 140 }}
                    placeholder="09:00"
                  />
                )}
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="outlined">Cancel</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || isPending}
          startIcon={<SaveOutlined />}
          onClick={() => isEditing ? updateMutation.mutate() : createMutation.mutate()}
        >
          {isPending ? 'Saving…' : isEditing ? 'Update Workflow' : 'Create Workflow'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
