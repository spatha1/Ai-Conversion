import { useState } from 'react'
import {
  Box, Typography, Button, Paper, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem, Alert, CircularProgress,
  alpha,
} from '@mui/material'
import {
  LibraryBooksOutlined,
  AddOutlined,
  LockOutlined,
  EditOutlined,
  BlockOutlined,
  ArrowForwardOutlined,
  CheckOutlined,
  RefreshOutlined,
  VisibilityOutlined,
  ContentCopyOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { agentMapperTemplatesApi } from '@/api'
import { tokens } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import type { AgentMapperTemplate } from '@/types'

const LOB_OPTIONS     = ['Auto', 'Property', 'GL']
const ENTITY_OPTIONS  = ['Account', 'Policy', 'Risk', 'Coverage']
const TYPE_OPTIONS    = ['extra', 'base', 'dynamic', 'reference', 'risk', 'controller']

function XmlDialog({ name, xml, onClose }: { name: string; xml: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(xml).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
          {name}
        </Typography>
        <Tooltip title={copied ? 'Copied!' : 'Copy XML'} arrow>
          <IconButton size="small" onClick={handleCopy}>
            <ContentCopyOutlined sx={{ fontSize: 16, color: copied ? 'success.main' : undefined }} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box
          component="pre"
          sx={{
            fontFamily: 'monospace', fontSize: '0.78rem',
            bgcolor: 'background.default',
            borderTop: '1px solid', borderColor: 'divider',
            p: 2, m: 0, overflow: 'auto', maxHeight: 520,
            whiteSpace: 'pre',
          }}
        >
          {xml}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button size="small" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

function TypeChip({ label }: { label: string | null }) {
  if (!label) return <Typography variant="caption" color="text.disabled">—</Typography>
  return (
    <Chip label={label} size="small"
      sx={{ bgcolor: alpha(tokens.indigo600, 0.08), color: tokens.indigo700, fontWeight: 700, fontSize: '0.68rem', height: 20, border: 'none' }} />
  )
}

interface EditDialogProps {
  template: AgentMapperTemplate | null
  open:     boolean
  onClose:  () => void
  onSave:   (data: Partial<AgentMapperTemplate>) => void
  saving:   boolean
}

function EditDialog({ template, open, onClose, onSave, saving }: EditDialogProps) {
  const [name,        setName]        = useState(template?.name        ?? '')
  const [templateKey, setTemplateKey] = useState(template?.template_key ?? '')
  const [mappingType, setMappingType] = useState(template?.mapping_type ?? '')
  const [entity,      setEntity]      = useState(template?.entity      ?? '')
  const [lob,         setLob]         = useState(template?.lob         ?? '')
  const [xml,         setXml]         = useState(template?.template_xml ?? '')
  const [notes,       setNotes]       = useState(template?.notes       ?? '')


  const isNew = !template

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isNew ? 'Add Custom Template' : `Edit: ${template?.name}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" required />
          <TextField label="Template Key" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}
            fullWidth size="small" required disabled={!isNew}
            helperText={isNew ? 'Unique identifier (e.g. my_risk_auto)' : undefined}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel>Mapping Type</InputLabel>
            <Select value={mappingType} label="Mapping Type" onChange={(e) => setMappingType(e.target.value)}>
              <MenuItem value=""><em>— None —</em></MenuItem>
              {TYPE_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel>Entity</InputLabel>
            <Select value={entity} label="Entity" onChange={(e) => setEntity(e.target.value)}>
              <MenuItem value=""><em>— None —</em></MenuItem>
              {ENTITY_OPTIONS.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel>LOB</InputLabel>
            <Select value={lob} label="LOB" onChange={(e) => setLob(e.target.value)}>
              <MenuItem value=""><em>— None —</em></MenuItem>
              {LOB_OPTIONS.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <TextField
          label="Template XML" value={xml} onChange={(e) => setXml(e.target.value)}
          multiline minRows={8}
          inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          fullWidth required
        />
        <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} fullWidth />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !name.trim() || !templateKey.trim() || !xml.trim()}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <CheckOutlined />}
          onClick={() => onSave({
            name, template_key: templateKey,
            mapping_type: mappingType || null,
            entity: entity || null,
            lob: lob || null,
            template_xml: xml,
            notes: notes || null,
          })}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function AgentMapperTemplatesPage() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const isDark    = useAppStore((s) => s.themeMode) === 'dark'

  const [filterEntity, setFilterEntity] = useState('')
  const [filterLob,    setFilterLob]    = useState('')
  const [editTarget,   setEditTarget]   = useState<AgentMapperTemplate | null | 'new'>('new')
  const [dialogOpen,   setDialogOpen]   = useState(false)
  const [seedMsg,      setSeedMsg]      = useState<string | null>(null)
  const [previewTpl,   setPreviewTpl]   = useState<AgentMapperTemplate | null>(null)

  const { data: templates = [], isLoading } = useQuery<AgentMapperTemplate[]>({
    queryKey: ['agent-mapper-templates', filterEntity, filterLob],
    queryFn:  () => agentMapperTemplatesApi.list({
      entity: filterEntity || undefined,
      lob:    filterLob    || undefined,
    }),
  })

  const seed = useMutation({
    mutationFn: agentMapperTemplatesApi.seed,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['agent-mapper-templates'] })
      setSeedMsg(`Seeded ${res.seeded} template(s). ${res.skipped} already existed.`)
      setTimeout(() => setSeedMsg(null), 5000)
    },
  })

  const createMut = useMutation({
    mutationFn: (data: Partial<AgentMapperTemplate>) =>
      agentMapperTemplatesApi.create(data as Parameters<typeof agentMapperTemplatesApi.create>[0]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-mapper-templates'] })
      setDialogOpen(false)
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AgentMapperTemplate> }) =>
      agentMapperTemplatesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-mapper-templates'] })
      setDialogOpen(false)
    },
  })

  const disableMut = useMutation({
    mutationFn: (id: number) => agentMapperTemplatesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-mapper-templates'] }),
  })

  const handleUseAsBase = (tpl: AgentMapperTemplate) => {
    sessionStorage.setItem('agentmapper_base_xml', tpl.template_xml)
    navigate('/agent-mapper')
  }

  const handleSave = (data: Partial<AgentMapperTemplate>) => {
    if (editTarget === 'new') {
      createMut.mutate(data)
    } else if (editTarget) {
      updateMut.mutate({ id: editTarget.id, data })
    }
  }

  const saving = createMut.isPending || updateMut.isPending

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <LibraryBooksOutlined sx={{ color: tokens.indigo600, fontSize: 26 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Mapper Templates</Typography>
            <Typography variant="caption" color="text.secondary">OOTB + custom DCT manuscript templates</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={seed.isPending ? <CircularProgress size={14} /> : <RefreshOutlined sx={{ fontSize: 16 }} />}
            disabled={seed.isPending}
            onClick={() => seed.mutate()}
            sx={{ fontSize: '0.75rem' }}
          >
            Seed OOTB
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddOutlined sx={{ fontSize: 16 }} />}
            onClick={() => { setEditTarget('new'); setDialogOpen(true) }}
            sx={{ fontSize: '0.75rem', background: `linear-gradient(135deg, ${tokens.indigo600}, ${tokens.violet600})` }}
          >
            Add Custom
          </Button>
        </Box>
      </Box>

      {seedMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSeedMsg(null)}>{seedMsg}</Alert>}
      {seed.isError && <Alert severity="error" sx={{ mb: 2 }}>Seed failed: {(seed.error as Error)?.message}</Alert>}

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Entity</InputLabel>
          <Select value={filterEntity} label="Entity" onChange={(e) => setFilterEntity(e.target.value)}>
            <MenuItem value="">All Entities</MenuItem>
            {ENTITY_OPTIONS.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>LOB</InputLabel>
          <Select value={filterLob} label="LOB" onChange={(e) => setFilterLob(e.target.value)}>
            <MenuItem value="">All LOBs</MenuItem>
            {LOB_OPTIONS.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {['#', 'Name', 'Entity', 'LOB', 'Type', 'Source', 'KB', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.disabled', fontSize: '0.85rem' }}>
                  No templates found — click <strong>Seed OOTB</strong> to load default templates.
                </TableCell>
              </TableRow>
            )}
            {templates.map((tpl) => (
              <>
                <TableRow key={tpl.id} hover>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>{tpl.id}</TableCell>
                  <TableCell sx={{ fontSize: '0.82rem', fontWeight: 600 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {tpl.is_ootb && <LockOutlined sx={{ fontSize: 12, color: 'text.disabled' }} />}
                      {tpl.name}
                    </Box>
                  </TableCell>
                  <TableCell><TypeChip label={tpl.entity} /></TableCell>
                  <TableCell sx={{ fontSize: '0.78rem' }}>{tpl.lob ?? '—'}</TableCell>
                  <TableCell><TypeChip label={tpl.mapping_type} /></TableCell>
                  <TableCell>
                    <Chip
                      label={tpl.is_ootb ? 'OOTB' : 'Custom'}
                      size="small"
                      sx={{
                        height: 18, fontSize: '0.62rem', fontWeight: 700,
                        bgcolor: tpl.is_ootb ? alpha('#22c55e', 0.12) : alpha(tokens.indigo600, 0.1),
                        color:   tpl.is_ootb ? '#15803d' : tokens.indigo700,
                        border: 'none',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {tpl.kb_entry_id ? (
                      <Chip
                        label="KB ✓"
                        size="small"
                        sx={{
                          height: 18, fontSize: '0.62rem', fontWeight: 700,
                          bgcolor: alpha('#8b5cf6', 0.12), color: '#6d28d9',
                          border: 'none',
                        }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Preview XML" arrow>
                        <IconButton size="small" onClick={() => setPreviewTpl(tpl)}>
                          <VisibilityOutlined sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Use as Base in Agent Mapper" arrow>
                        <IconButton size="small" color="primary" onClick={() => handleUseAsBase(tpl)}>
                          <ArrowForwardOutlined sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      {!tpl.is_ootb && (
                        <>
                          <Tooltip title="Edit" arrow>
                            <IconButton size="small" onClick={() => { setEditTarget(tpl); setDialogOpen(true) }}>
                              <EditOutlined sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Disable" arrow>
                            <IconButton size="small" color="error" disabled={disableMut.isPending}
                              onClick={() => disableMut.mutate(tpl.id)}>
                              <BlockOutlined sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              </>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Edit/Create Dialog */}
      <EditDialog
        template={editTarget === 'new' ? null : editTarget}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        saving={saving}
      />

      {/* XML Preview Dialog */}
      {previewTpl && (
        <XmlDialog
          name={previewTpl.name}
          xml={previewTpl.template_xml}
          onClose={() => setPreviewTpl(null)}
        />
      )}
    </Box>
  )
}
