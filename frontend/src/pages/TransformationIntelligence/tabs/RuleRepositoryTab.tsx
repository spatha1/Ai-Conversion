import { useState } from 'react'
import {
  Box, Typography, Paper, Chip, Button, CircularProgress, Alert, Stack, alpha,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, Collapse,
} from '@mui/material'
import {
  AddOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined,
  CancelOutlined, ExpandMoreOutlined, ExpandLessOutlined,
  ThumbUpOutlined, ThumbDownOutlined, HistoryOutlined,
  AutoAwesomeOutlined, AccountTreeOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TransformationRule, TransformationRuleCreate, RuleCategory, ExecutionStage } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

const CATEGORY_COLORS: Record<string, string> = {
  DirectMapping: TEAL, LookupMapping: tokens.amber600, ConditionalRule: PURPLE,
  DefaultValue: '#64748B', Formula: tokens.sky600, DataValidation: tokens.emerald600,
  DataQualityRule: tokens.red600, ReferenceDataRule: '#8B5CF6',
}
const STATUS_COLORS: Record<string, string> = {
  draft: '#64748B', pending_review: tokens.amber600,
  approved: tokens.emerald600, rejected: tokens.red600, deprecated: '#94A3B8',
}
const STAGE_COLORS: Record<string, string> = {
  PreTransform: tokens.sky600, Transform: TEAL,
  PostTransform: PURPLE, Validation: tokens.emerald600,
}

const CATEGORIES: RuleCategory[] = [
  'DirectMapping','LookupMapping','ConditionalRule','DefaultValue',
  'Formula','DataValidation','DataQualityRule','ReferenceDataRule',
]
const STAGES: ExecutionStage[] = ['PreTransform','Transform','PostTransform','Validation']

interface Props {
  connId: number | null
  selectedRuleId: number | null
  onSelectRule: (id: number) => void
  onNavigateTab: (tab: number) => void
}

const EMPTY: TransformationRuleCreate = {
  rule_name: '', category: 'DirectMapping', execution_stage: 'Transform',
  description: '', source_object: '', source_column: '', target_path: '',
  condition_json: '', transformation_json: '', tags_json: '', priority: 0, stage_order: 0,
}

export default function RuleRepositoryTab({ connId, selectedRuleId, onSelectRule, onNavigateTab }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [filterCat, setFilterCat]    = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterStage, setFilterStage]  = useState('')
  const [searchText, setSearchText]   = useState('')
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [editRule, setEditRule]       = useState<TransformationRule | null>(null)
  const [form, setForm]               = useState<TransformationRuleCreate>(EMPTY)
  const [versionsRuleId, setVersionsRuleId] = useState<number | null>(null)

  const { data: result, isLoading } = useQuery({
    queryKey: ['ti-rules', connId, filterCat, filterStatus, filterStage],
    queryFn: () => transformationApi.listRules({
      conn_id: connId ?? undefined,
      category: filterCat || undefined,
      approval_status: filterStatus || undefined,
      execution_stage: filterStage || undefined,
      is_active: true,
      limit: 200,
    }),
    enabled: connId != null,
  })

  const { data: versions } = useQuery({
    queryKey: ['ti-rule-versions', versionsRuleId],
    queryFn: () => transformationApi.getRuleVersions(versionsRuleId!),
    enabled: versionsRuleId != null,
  })

  const rules = result?.items ?? []
  const filtered = rules.filter(r =>
    !searchText || r.rule_name.toLowerCase().includes(searchText.toLowerCase())
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ti-rules', connId] })
    qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
  }

  const createMut = useMutation({
    mutationFn: (data: TransformationRuleCreate) => transformationApi.createRule({ ...data, conn_id: connId ?? undefined }),
    onSuccess: () => { invalidate(); setDialogOpen(false); enqueueSnackbar('Rule created', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TransformationRuleCreate }) =>
      transformationApi.updateRule(id, data),
    onSuccess: () => { invalidate(); setDialogOpen(false); setEditRule(null); enqueueSnackbar('Rule updated (new version)', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => transformationApi.deleteRule(id),
    onSuccess: () => { invalidate(); enqueueSnackbar('Rule deactivated', { variant: 'info' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const approveMut = useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) => transformationApi.approveRule(id, by),
    onSuccess: () => { invalidate(); enqueueSnackbar('Rule approved', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const rejectMut = useMutation({
    mutationFn: (id: number) => transformationApi.rejectRule(id, ''),
    onSuccess: () => { invalidate(); enqueueSnackbar('Rule rejected', { variant: 'info' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  function openCreate() {
    setEditRule(null)
    setForm({ ...EMPTY, conn_id: connId ?? undefined })
    setDialogOpen(true)
  }

  function openEdit(r: TransformationRule) {
    setEditRule(r)
    setForm({
      rule_name: r.rule_name, category: r.category as RuleCategory,
      execution_stage: r.execution_stage as ExecutionStage,
      description: r.description ?? '', source_object: r.source_object ?? '',
      source_column: r.source_column ?? '', target_path: r.target_path ?? '',
      condition_json: r.condition_json ?? '', transformation_json: r.transformation_json ?? '',
      tags_json: r.tags_json ?? '', priority: r.priority, stage_order: r.stage_order,
    })
    setDialogOpen(true)
  }

  function handleSave() {
    if (editRule) {
      updateMut.mutate({ id: editRule.id, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  return (
    <Box sx={{ p: 2.5 }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <TextField
          size="small" placeholder="Search rules…"
          value={searchText} onChange={(e) => setSearchText(e.target.value)}
          sx={{ width: 180, '& input': { fontSize: '0.78rem' } }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ fontSize: '0.78rem' }}>Category</InputLabel>
          <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} label="Category"
            sx={{ fontSize: '0.78rem' }}>
            <MenuItem value="">All</MenuItem>
            {CATEGORIES.map(c => <MenuItem key={c} value={c} sx={{ fontSize: '0.78rem' }}>{c}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ fontSize: '0.78rem' }}>Status</InputLabel>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} label="Status"
            sx={{ fontSize: '0.78rem' }}>
            <MenuItem value="">All</MenuItem>
            {['draft','pending_review','approved','rejected','deprecated'].map(s =>
              <MenuItem key={s} value={s} sx={{ fontSize: '0.78rem' }}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ fontSize: '0.78rem' }}>Stage</InputLabel>
          <Select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} label="Stage"
            sx={{ fontSize: '0.78rem' }}>
            <MenuItem value="">All</MenuItem>
            {STAGES.map(s => <MenuItem key={s} value={s} sx={{ fontSize: '0.78rem' }}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <Button size="small" variant="contained" startIcon={<AddOutlined />}
          onClick={openCreate} sx={{ ml: 'auto', fontSize: '0.75rem' }}>
          New Rule
        </Button>
      </Box>

      {isLoading && <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><CircularProgress size={16} /><Typography variant="caption">Loading…</Typography></Box>}

      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        {filtered.length} rule{filtered.length !== 1 ? 's' : ''} {filterCat || filterStatus || filterStage || searchText ? '(filtered)' : ''}
      </Typography>

      {/* Rule table */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Rule Name</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Category</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Stage</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Source → Target</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Conf</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>v</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700, width: 120 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}
                onClick={() => onSelectRule(r.id)}
                sx={{ cursor: 'pointer',
                  bgcolor: selectedRuleId === r.id ? alpha(TEAL, 0.06) : undefined,
                  '&:hover': { bgcolor: 'action.hover' } }}>
                <TableCell>
                  <Box>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{r.rule_name}</Typography>
                    {r.ai_generated && (
                      <Chip label="AI" size="small" icon={<AutoAwesomeOutlined sx={{ fontSize: '10px !important' }} />}
                        sx={{ height: 14, fontSize: '0.55rem', bgcolor: alpha(PURPLE, 0.1), color: PURPLE }} />
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip label={r.category} size="small"
                    sx={{ height: 18, fontSize: '0.62rem',
                      bgcolor: alpha(CATEGORY_COLORS[r.category] ?? '#64748B', 0.12),
                      color: CATEGORY_COLORS[r.category] ?? '#64748B' }} />
                </TableCell>
                <TableCell>
                  <Chip label={r.execution_stage} size="small"
                    sx={{ height: 18, fontSize: '0.62rem',
                      bgcolor: alpha(STAGE_COLORS[r.execution_stage] ?? '#64748B', 0.12),
                      color: STAGE_COLORS[r.execution_stage] ?? '#64748B' }} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'text.secondary', maxWidth: 220 }}>
                  <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.source_object ? `${r.source_object}.${r.source_column || '?'}` : (r.source_column || '—')}
                    {(r.source_column || r.source_object) && r.target_path && ' → '}
                    {r.target_path || ''}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip label={r.approval_status} size="small"
                    sx={{ height: 18, fontSize: '0.62rem',
                      bgcolor: alpha(STATUS_COLORS[r.approval_status] ?? '#64748B', 0.12),
                      color: STATUS_COLORS[r.approval_status] ?? '#64748B' }} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.72rem', fontWeight: 700,
                  color: r.confidence_score != null
                    ? (r.confidence_score >= 0.7 ? tokens.emerald600 : r.confidence_score >= 0.4 ? tokens.amber600 : tokens.red600)
                    : 'text.disabled' }}>
                  {r.confidence_score != null ? `${Math.round(r.confidence_score * 100)}%` : '—'}
                </TableCell>
                <TableCell sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>v{r.version}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Box sx={{ display: 'flex', gap: 0.25 }}>
                    {r.approval_status === 'pending_review' && (
                      <>
                        <Tooltip title="Approve">
                          <IconButton size="small" color="success"
                            onClick={() => approveMut.mutate({ id: r.id, by: 'admin' })}>
                            <ThumbUpOutlined sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Reject">
                          <IconButton size="small" color="error"
                            onClick={() => rejectMut.mutate(r.id)}>
                            <ThumbDownOutlined sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip title="Edit (creates new version)">
                      <IconButton size="small" onClick={() => openEdit(r)}>
                        <EditOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Version history">
                      <IconButton size="small"
                        onClick={() => setVersionsRuleId(versionsRuleId === r.id ? null : r.id)}>
                        <HistoryOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Simulate this rule">
                      <IconButton size="small" color="primary"
                        onClick={() => { onSelectRule(r.id); onNavigateTab(4) }}>
                        <AutoAwesomeOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Impact analysis">
                      <IconButton size="small"
                        onClick={() => { onSelectRule(r.id); onNavigateTab(8) }}>
                        <AccountTreeOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Deactivate">
                      <IconButton size="small" color="error"
                        onClick={() => deleteMut.mutate(r.id)}>
                        <DeleteOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={8} sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="caption" color="text.disabled">
                    No rules found. Click <strong>New Rule</strong> or use <strong>AI Discovery</strong> to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* Version history panel */}
      {versionsRuleId && versions && versions.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: alpha(PURPLE, 0.02) }}>
          <Typography variant="caption" fontWeight={700} sx={{ fontSize: '0.68rem', display: 'block', mb: 1, color: PURPLE }}>
            Version History — Rule #{versionsRuleId}
          </Typography>
          {versions.map((v) => (
            <Box key={v.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.5,
              borderBottom: 1, borderColor: 'divider' }}>
              <Chip label={`v${v.version}`} size="small"
                sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
              <Chip label={v.approval_status} size="small"
                sx={{ height: 16, fontSize: '0.6rem',
                  bgcolor: alpha(STATUS_COLORS[v.approval_status] ?? '#64748B', 0.12),
                  color: STATUS_COLORS[v.approval_status] ?? '#64748B' }} />
              <Typography sx={{ fontSize: '0.67rem', color: 'text.secondary', flex: 1 }}>
                {v.rule_name}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>
                {v.created_at ? new Date(v.created_at).toLocaleDateString() : ''}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditRule(null) }}
        fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1, fontSize: '0.95rem', fontWeight: 700 }}>
          {editRule ? `Edit Rule — v${editRule.version + 1}` : 'New Transformation Rule'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField label="Rule Name" size="small" fullWidth required
              value={form.rule_name} onChange={(e) => setForm(f => ({ ...f, rule_name: e.target.value }))} />
            <TextField label="Description" size="small" fullWidth multiline minRows={2}
              value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Category</InputLabel>
                <Select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value as RuleCategory }))} label="Category">
                  {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>Execution Stage</InputLabel>
                <Select value={form.execution_stage} onChange={(e) => setForm(f => ({ ...f, execution_stage: e.target.value as ExecutionStage }))} label="Execution Stage">
                  {STAGES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField label="Source Object" size="small" fullWidth
                value={form.source_object} onChange={(e) => setForm(f => ({ ...f, source_object: e.target.value }))} />
              <TextField label="Source Column" size="small" fullWidth
                value={form.source_column} onChange={(e) => setForm(f => ({ ...f, source_column: e.target.value }))} />
            </Box>
            <TextField label="Target Path" size="small" fullWidth
              value={form.target_path} onChange={(e) => setForm(f => ({ ...f, target_path: e.target.value }))} />
            <TextField label="Condition JSON" size="small" fullWidth multiline minRows={2}
              placeholder='{"logic":"AND","conditions":[{"field":"Premium","operator":">","value":"10000"}]}'
              value={form.condition_json} onChange={(e) => setForm(f => ({ ...f, condition_json: e.target.value }))}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.72rem' } }} />
            <TextField label="Transformation JSON" size="small" fullWidth multiline minRows={2}
              placeholder='{"action":"set","target_field":"Tier","cases":[{"when":{...},"then":"Gold"},{"else":"Standard"}]}'
              value={form.transformation_json} onChange={(e) => setForm(f => ({ ...f, transformation_json: e.target.value }))}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.72rem' } }} />
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField label="Priority" size="small" type="number" sx={{ width: 100 }}
                value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: Number(e.target.value) }))} />
              <TextField label="Stage Order" size="small" type="number" sx={{ width: 100 }}
                value={form.stage_order} onChange={(e) => setForm(f => ({ ...f, stage_order: Number(e.target.value) }))} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => { setDialogOpen(false); setEditRule(null) }}>Cancel</Button>
          <Button size="small" variant="contained"
            disabled={!form.rule_name || createMut.isPending || updateMut.isPending}
            onClick={handleSave}>
            {editRule ? 'Save New Version' : 'Create Rule'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
