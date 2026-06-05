import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  TextField, Chip, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Divider, List, ListItem, ListItemText,
} from '@mui/material'
import {
  AccountTreeOutlined, AddOutlined, DeleteOutlined, EditOutlined,
  PlayArrowOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TIRuleSet, TIPipeline, TIPipelineStep, ExecutionStage } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

const SET_TYPES = ['Policy', 'Billing', 'Claims', 'ReferenceData', 'Custom']
const STAGES: ExecutionStage[] = ['PreTransform', 'Transform', 'PostTransform', 'Validation']

interface Props { connId: number | null }

export default function RuleSetsAndPipelinesTab({ connId }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [rsDialogOpen, setRsDialogOpen] = useState(false)
  const [rsForm, setRsForm] = useState({ name: '', description: '', set_type: 'Policy' })
  const [selectedRs, setSelectedRs]   = useState<TIRuleSet | null>(null)

  const [plDialogOpen, setPlDialogOpen] = useState(false)
  const [plForm, setPlForm] = useState({ name: '', description: '' })
  const [selectedPl, setSelectedPl]     = useState<TIPipeline | null>(null)
  const [stepDialogOpen, setStepDialogOpen] = useState(false)
  const [stepForm, setStepForm] = useState({
    step_number: 1, step_name: '', execution_stage: 'Transform' as ExecutionStage, description: '',
  })

  const invalidateRs = () => qc.invalidateQueries({ queryKey: ['ti-rule-sets', connId] })
  const invalidatePl = () => qc.invalidateQueries({ queryKey: ['ti-pipelines', connId] })

  const { data: ruleSets = [] } = useQuery<TIRuleSet[]>({
    queryKey: ['ti-rule-sets', connId],
    queryFn: () => transformationApi.listRuleSets(connId ?? undefined),
    enabled: connId != null,
  })

  const { data: pipelines = [] } = useQuery<TIPipeline[]>({
    queryKey: ['ti-pipelines', connId],
    queryFn: () => transformationApi.listPipelines(connId ?? undefined),
    enabled: connId != null,
  })

  const createRsMut = useMutation({
    mutationFn: () => transformationApi.createRuleSet({ ...rsForm, conn_id: connId ?? undefined }),
    onSuccess: () => { invalidateRs(); setRsDialogOpen(false); enqueueSnackbar('Rule set created', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteRsMut = useMutation({
    mutationFn: (id: number) => transformationApi.deleteRuleSet(id),
    onSuccess: () => { invalidateRs(); if (selectedRs) setSelectedRs(null) },
  })

  const createPlMut = useMutation({
    mutationFn: () => transformationApi.createPipeline({ ...plForm, conn_id: connId ?? undefined }),
    onSuccess: () => { invalidatePl(); setPlDialogOpen(false); enqueueSnackbar('Pipeline created', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const addStepMut = useMutation({
    mutationFn: () => transformationApi.addPipelineStep(selectedPl!.id, stepForm),
    onSuccess: () => { invalidatePl(); setStepDialogOpen(false); enqueueSnackbar('Step added', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const delStepMut = useMutation({
    mutationFn: ({ pid, sid }: { pid: number; sid: number }) => transformationApi.deletePipelineStep(pid, sid),
    onSuccess: () => { invalidatePl(); enqueueSnackbar('Step removed', { variant: 'info' }) },
  })

  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
        {/* Rule Sets */}
        <Box sx={{ flex: '1 1 300px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="body2" fontWeight={700}>Rule Sets</Typography>
            <Chip label={ruleSets.length} size="small" sx={{ height: 18, fontSize: '0.62rem' }} />
            <Button size="small" variant="outlined" startIcon={<AddOutlined />}
              onClick={() => { setRsForm({ name: '', description: '', set_type: 'Policy' }); setRsDialogOpen(true) }}
              sx={{ ml: 'auto', fontSize: '0.72rem' }}>
              New Set
            </Button>
          </Box>
          <Stack spacing={1}>
            {ruleSets.map((rs) => (
              <Paper key={rs.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5,
                cursor: 'pointer',
                borderColor: selectedRs?.id === rs.id ? alpha(PURPLE, 0.5) : undefined,
                bgcolor: selectedRs?.id === rs.id ? alpha(PURPLE, 0.04) : undefined,
                '&:hover': { bgcolor: 'action.hover' } }}
                onClick={() => setSelectedRs(rs)}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{rs.name}</Typography>
                    {rs.description && (
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{rs.description}</Typography>
                    )}
                    {rs.set_type && (
                      <Chip label={rs.set_type} size="small"
                        sx={{ height: 16, fontSize: '0.6rem', mt: 0.5, bgcolor: alpha(PURPLE, 0.1), color: PURPLE }} />
                    )}
                  </Box>
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteRsMut.mutate(rs.id) }}>
                      <DeleteOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Paper>
            ))}
            {ruleSets.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ p: 1 }}>
                No rule sets yet. Create sets like "Policy Conversion", "Billing", "Claims".
              </Typography>
            )}
          </Stack>
        </Box>

        {/* Pipelines */}
        <Box sx={{ flex: '2 1 400px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <AccountTreeOutlined sx={{ fontSize: 16, color: TEAL }} />
            <Typography variant="body2" fontWeight={700}>Transformation Pipelines</Typography>
            <Chip label={pipelines.length} size="small" sx={{ height: 18, fontSize: '0.62rem' }} />
            <Button size="small" variant="outlined" startIcon={<AddOutlined />}
              onClick={() => { setPlForm({ name: '', description: '' }); setPlDialogOpen(true) }}
              sx={{ ml: 'auto', fontSize: '0.72rem' }}>
              New Pipeline
            </Button>
          </Box>

          {pipelines.map((pl) => (
            <Paper key={pl.id} variant="outlined" sx={{ borderRadius: 2, mb: 1.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1,
                bgcolor: 'action.hover', cursor: 'pointer' }}
                onClick={() => setSelectedPl(selectedPl?.id === pl.id ? null : pl)}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, flex: 1 }}>{pl.name}</Typography>
                {pl.description && (
                  <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{pl.description}</Typography>
                )}
                <Chip label={`${pl.steps?.length ?? 0} steps`} size="small"
                  sx={{ height: 18, fontSize: '0.62rem' }} />
              </Box>

              {selectedPl?.id === pl.id && (
                <Box sx={{ p: 1.5 }}>
                  {/* Stage columns */}
                  <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 0.5 }}>
                    {STAGES.map((stage) => {
                      const stageSteps = (pl.steps ?? []).filter(s => s.execution_stage === stage)
                      return (
                        <Box key={stage} sx={{ minWidth: 160, flex: 1 }}>
                          <Box sx={{ px: 1, py: 0.5, mb: 0.5, borderRadius: 1,
                            bgcolor: alpha(TEAL, 0.08), textAlign: 'center' }}>
                            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: TEAL, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              {stage}
                            </Typography>
                          </Box>
                          <Stack spacing={0.5}>
                            {stageSteps.map((step) => (
                              <Box key={step.id} sx={{ p: 0.75, borderRadius: 1,
                                bgcolor: alpha(PURPLE, 0.06), border: 1, borderColor: alpha(PURPLE, 0.15),
                                display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box sx={{ flex: 1 }}>
                                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 600 }}>
                                    {step.step_number}. {step.step_name}
                                  </Typography>
                                </Box>
                                <IconButton size="small"
                                  onClick={() => delStepMut.mutate({ pid: pl.id, sid: step.id })}>
                                  <DeleteOutlined sx={{ fontSize: 12 }} />
                                </IconButton>
                              </Box>
                            ))}
                            {stageSteps.length === 0 && (
                              <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled',
                                textAlign: 'center', py: 1 }}>
                                No steps
                              </Typography>
                            )}
                          </Stack>
                        </Box>
                      )
                    })}
                  </Box>
                  <Button size="small" variant="outlined" startIcon={<AddOutlined />}
                    onClick={() => { setSelectedPl(pl); setStepDialogOpen(true) }}
                    sx={{ mt: 1, fontSize: '0.7rem' }}>
                    Add Step
                  </Button>
                </Box>
              )}
            </Paper>
          ))}
          {pipelines.length === 0 && (
            <Typography variant="caption" color="text.disabled">
              No pipelines yet. Create an execution pipeline to define the order: Normalize → Lookup → Business Rules → XML → Validate.
            </Typography>
          )}
        </Box>
      </Box>

      {/* Rule Set Create Dialog */}
      <Dialog open={rsDialogOpen} onClose={() => setRsDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700 }}>New Rule Set</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField label="Name" size="small" fullWidth required
              value={rsForm.name} onChange={(e) => setRsForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Policy Conversion Rules" />
            <TextField label="Description" size="small" fullWidth multiline minRows={2}
              value={rsForm.description} onChange={(e) => setRsForm(f => ({ ...f, description: e.target.value }))} />
            <FormControl size="small" fullWidth>
              <InputLabel>Type</InputLabel>
              <Select value={rsForm.set_type} onChange={(e) => setRsForm(f => ({ ...f, set_type: e.target.value }))} label="Type">
                {SET_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setRsDialogOpen(false)}>Cancel</Button>
          <Button size="small" variant="contained" disabled={!rsForm.name || createRsMut.isPending}
            onClick={() => createRsMut.mutate()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Pipeline Create Dialog */}
      <Dialog open={plDialogOpen} onClose={() => setPlDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700 }}>New Pipeline</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField label="Name" size="small" fullWidth required
              value={plForm.name} onChange={(e) => setPlForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. P&C Full Conversion Pipeline" />
            <TextField label="Description" size="small" fullWidth multiline minRows={2}
              value={plForm.description} onChange={(e) => setPlForm(f => ({ ...f, description: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setPlDialogOpen(false)}>Cancel</Button>
          <Button size="small" variant="contained" disabled={!plForm.name || createPlMut.isPending}
            onClick={() => createPlMut.mutate()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Step Add Dialog */}
      <Dialog open={stepDialogOpen} onClose={() => setStepDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700 }}>Add Pipeline Step</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField label="Step #" size="small" type="number" sx={{ width: 90 }}
                value={stepForm.step_number} onChange={(e) => setStepForm(f => ({ ...f, step_number: Number(e.target.value) }))} />
              <TextField label="Step Name" size="small" sx={{ flex: 1 }} required
                value={stepForm.step_name} onChange={(e) => setStepForm(f => ({ ...f, step_name: e.target.value }))}
                placeholder="e.g. Apply Lookup Rules" />
            </Box>
            <FormControl size="small" fullWidth>
              <InputLabel>Execution Stage</InputLabel>
              <Select value={stepForm.execution_stage}
                onChange={(e) => setStepForm(f => ({ ...f, execution_stage: e.target.value as ExecutionStage }))} label="Execution Stage">
                {STAGES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Description" size="small" fullWidth
              value={stepForm.description} onChange={(e) => setStepForm(f => ({ ...f, description: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setStepDialogOpen(false)}>Cancel</Button>
          <Button size="small" variant="contained" disabled={!stepForm.step_name || addStepMut.isPending}
            onClick={() => addStepMut.mutate()}>Add Step</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
