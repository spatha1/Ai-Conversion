import React, { useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse,
  Dialog, DialogContent, DialogTitle, Divider,
  FormControl, Grid, IconButton, InputLabel, Menu, MenuItem, Paper, Select,
  Snackbar, Step, StepLabel, Stepper, Tab, Table,
  TableBody, TableCell, TableHead, TableRow, Tabs,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography, alpha,
} from '@mui/material'
import {
  AddCircleOutline, AutoFixHigh, CheckCircleOutline,
  CloudDownload, CodeOutlined, ContentCopyOutlined, DeleteOutline,
  DynamicFormOutlined, EditOutlined, ErrorOutline, FormatListBulleted,
  GridView as GridViewIcon, MoreVertOutlined,
  OpenInNewOutlined, PlayArrowOutlined, RefreshOutlined, SaveOutlined,
  TableChartOutlined, ViewStreamOutlined, VisibilityOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formBuilderApi, connectionsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import SectionCard from '@/components/FormBuilder/SectionCard'
import LayoutEditor from '@/components/FormBuilder/LayoutEditor'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import type {
  FormTemplate, FormSection, FormFieldDef,
  FormDataBinding, FormExecution, FormOutputFormat,
  FormSchemaJson, FormBulkExecuteItem,
} from '@/types'

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function FormBuilderPage() {
  const [tab, setTab] = useState(0)
  const [editTemplate, setEditTemplate] = useState<FormTemplate | null>(null)
  const { activeProject } = useAppStore()

  const handleEdit = (t: FormTemplate) => {
    setEditTemplate(t)
    setTab(1)
  }

  const handleBuilderSaved = () => {
    setEditTemplate(null)
    setTab(0)
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 3, pt: 3, pb: 1 }}>
        <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DynamicFormOutlined /> Form Builder
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Configure → Save → Bind → Execute
        </Typography>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); if (v !== 1) setEditTemplate(null) }}>
          <Tab icon={<ViewStreamOutlined />} label="Templates" iconPosition="start" />
          <Tab icon={<DynamicFormOutlined />} label="Builder" iconPosition="start" />
          <Tab icon={<PlayArrowOutlined />} label="Execute" iconPosition="start" />
          <Tab icon={<TableChartOutlined />} label="History" iconPosition="start" />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {tab === 0 && <TemplatesTab projectId={activeProject?.id} onBuild={() => setTab(1)} onEdit={handleEdit} />}
        {tab === 1 && <BuilderTab key={editTemplate?.id ?? 'new'} editTemplate={editTemplate} onSaved={handleBuilderSaved} />}
        {tab === 2 && <ExecuteTab />}
        {tab === 3 && <HistoryTab />}
      </Box>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Tab 0 — Templates list
// ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onView,
  onEdit,
  onDelete,
  deleting,
}: {
  template: FormTemplate
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)

  const schema = (() => {
    try { return template.form_schema_json ? JSON.parse(template.form_schema_json) : null }
    catch { return null }
  })()
  const sectionCount = schema?.sections?.length ?? 0
  const fieldCount   = (schema?.sections ?? []).reduce((n: number, s: any) => n + (s.fields?.length ?? 0), 0)

  const statusColor = template.status === 'active' ? 'success'
    : template.status === 'configured' ? 'primary' : 'default'

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 0, display: 'flex', flexDirection: 'column', height: '100%',
        borderRadius: 2, overflow: 'hidden',
        transition: 'box-shadow .15s ease',
        '&:hover': { boxShadow: 4 },
      }}
    >
      {/* Colour bar */}
      <Box sx={{
        height: 4,
        background: template.status === 'active'
          ? 'linear-gradient(90deg,#16a34a,#22c55e)'
          : template.status === 'configured'
          ? 'linear-gradient(90deg,#4f46e5,#7c3aed)'
          : 'linear-gradient(90deg,#94a3b8,#cbd5e1)',
      }} />

      {/* Body */}
      <Box sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={700} noWrap sx={{ fontSize: '0.95rem' }}>{template.name}</Typography>
            {template.description && (
              <Typography variant="caption" color="text.secondary" sx={{
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {template.description}
              </Typography>
            )}
          </Box>
          <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} sx={{ ml: 0.5, flexShrink: 0 }}>
            <MoreVertOutlined fontSize="small" />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem onClick={() => { setAnchor(null); onView() }}>
              <VisibilityOutlined fontSize="small" sx={{ mr: 1 }} /> View
            </MenuItem>
            <MenuItem onClick={() => { setAnchor(null); onEdit() }}>
              <EditOutlined fontSize="small" sx={{ mr: 1 }} /> Edit
            </MenuItem>
            <MenuItem
              onClick={() => { setAnchor(null); onDelete() }}
              disabled={deleting}
              sx={{ color: 'error.main' }}
            >
              <DeleteOutline fontSize="small" sx={{ mr: 1 }} /> Delete
            </MenuItem>
          </Menu>
        </Box>

        {/* Chips */}
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Chip label={`v${template.version}`} size="small" />
          <Chip label={template.status} size="small" color={statusColor as any} />
          {template.category && <Chip label={template.category} size="small" variant="outlined" />}
          {template.source_type && <Chip label={template.source_type} size="small" variant="outlined" />}
        </Box>

        {/* Stats row */}
        <Box sx={{ display: 'flex', gap: 2, mt: 'auto', pt: 1 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" lineHeight={1} fontWeight={700}>{sectionCount}</Typography>
            <Typography variant="caption" color="text.secondary">sections</Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" lineHeight={1} fontWeight={700}>{fieldCount}</Typography>
            <Typography variant="caption" color="text.secondary">fields</Typography>
          </Box>
          <Box sx={{ ml: 'auto', alignSelf: 'flex-end' }}>
            <Typography variant="caption" color="text.secondary">
              {new Date(template.created_at).toLocaleDateString()}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Footer actions */}
      <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 1 }}>
        <Button
          size="small" variant="outlined"
          startIcon={<VisibilityOutlined />}
          onClick={onView}
          sx={{ borderRadius: 1.5, flex: 1 }}
        >
          View
        </Button>
        <Button
          size="small" variant="contained"
          startIcon={<EditOutlined />}
          onClick={onEdit}
          sx={{ borderRadius: 1.5, flex: 1 }}
        >
          Edit
        </Button>
      </Box>
    </Paper>
  )
}

function TemplatesTab({ projectId, onBuild, onEdit }: { projectId?: number; onBuild: () => void; onEdit: (t: FormTemplate) => void }) {
  const qc = useQueryClient()
  const [viewTemplate, setViewTemplate] = useState<FormTemplate | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['form-templates', projectId],
    queryFn: () => formBuilderApi.listTemplates(projectId),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => formBuilderApi.deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form-templates'] }),
  })

  if (isLoading) return <CircularProgress size={24} />

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Form Templates</Typography>
          <Typography variant="body2" color="text.secondary">{templates.length} template{templates.length !== 1 ? 's' : ''} saved</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddCircleOutline />} onClick={onBuild}>
          New Template
        </Button>
      </Box>

      {templates.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }} variant="outlined">
          <DynamicFormOutlined sx={{ fontSize: 56, color: 'text.disabled', mb: 1.5 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>No templates yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create your first form template using the AI-assisted builder.
          </Typography>
          <Button variant="contained" startIcon={<AddCircleOutline />} onClick={onBuild}>
            Create Template
          </Button>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {templates.map((t) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={t.id}>
              <TemplateCard
                template={t}
                onView={() => setViewTemplate(t)}
                onEdit={() => onEdit(t)}
                onDelete={() => deleteMut.mutate(t.id)}
                deleting={deleteMut.isPending}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {viewTemplate && (
        <TemplateViewDialog template={viewTemplate} onClose={() => setViewTemplate(null)} />
      )}
    </Box>
  )
}

function TemplateViewDialog({ template, onClose }: { template: FormTemplate; onClose: () => void }) {
  const schema: FormSchemaJson | null = template.form_schema_json
    ? (() => { try { return JSON.parse(template.form_schema_json) } catch { return null } })()
    : null

  const totalFields = schema?.sections.reduce((n, s) => n + s.fields.length, 0) ?? 0

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DynamicFormOutlined fontSize="small" />
        {template.name}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Chip label={`v${template.version}`} size="small" />
          <Chip
            label={template.status}
            size="small"
            color={template.status === 'active' ? 'success' : template.status === 'configured' ? 'primary' : 'default'}
          />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {template.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{template.description}</Typography>
        )}

        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {template.category && <Chip label={`Category: ${template.category}`} size="small" variant="outlined" />}
          {template.source_type && <Chip label={`Source: ${template.source_type}`} size="small" variant="outlined" />}
          <Chip label={`${schema?.sections.length ?? 0} sections`} size="small" variant="outlined" />
          <Chip label={`${totalFields} fields`} size="small" variant="outlined" />
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Created {new Date(template.created_at).toLocaleDateString()}
          </Typography>
        </Box>

        {schema ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {schema.sections.map((sec, si) => (
              <Paper key={sec.id} variant="outlined" sx={{ overflow: 'hidden' }}>
                <Box sx={{
                  px: 2, py: 1.25,
                  bgcolor: 'action.hover',
                  display: 'flex', alignItems: 'center', gap: 1,
                }}>
                  <Typography fontWeight={700} variant="body2">{sec.title || `Section ${si + 1}`}</Typography>
                  <Chip label={`${sec.columns}-col`} size="small" />
                  <Chip label={`${sec.fields.length} field${sec.fields.length !== 1 ? 's' : ''}`} size="small" variant="outlined" />
                </Box>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Label</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Required</TableCell>
                      <TableCell>Default</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sec.fields.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>{f.label}</TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{f.name}</Typography>
                        </TableCell>
                        <TableCell><Chip label={f.type} size="small" variant="outlined" /></TableCell>
                        <TableCell>{f.required ? <Chip label="yes" size="small" color="error" /> : '—'}</TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">{f.default_value || '—'}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            ))}
          </Box>
        ) : (
          <Alert severity="warning">No schema saved for this template.</Alert>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────
// Tab 1 — Builder (4-step wizard)
// ─────────────────────────────────────────────────────────────

const BUILDER_STEPS = ['Input & Name', 'AI Draft', 'Configure', 'Save']

function BuilderTab({ onSaved, editTemplate }: { onSaved: () => void; editTemplate?: FormTemplate | null }) {
  const qc = useQueryClient()
  const { formBuilderStep, formBuilderDraft, setFormBuilderStep, setFormBuilderDraft, clearFormBuilder, activeProject } = useAppStore()

  const isEdit = !!editTemplate
  const initialSchema: FormSchemaJson | null = isEdit
    ? (() => { try { return editTemplate.form_schema_json ? JSON.parse(editTemplate.form_schema_json) : null } catch { return null } })()
    : (formBuilderDraft?.schema ?? null)

  const step = formBuilderStep

  const [formName, setFormName]       = useState(isEdit ? editTemplate.name : (formBuilderDraft?.schema?.form_name ?? ''))
  const [category, setCategory]       = useState(isEdit ? (editTemplate.category ?? '') : '')
  const [sourceType, setSourceType]   = useState<'text' | 'image' | 'pdf'>(
    (isEdit ? (editTemplate.source_type as any) : (formBuilderDraft?.source_type as any)) ?? 'text'
  )
  const [textPrompt, setTextPrompt]   = useState('')
  const [file, setFile]               = useState<File | null>(null)
  const [schema, setSchema]           = useState<FormSchemaJson | null>(initialSchema)
  const [description, setDescription] = useState(isEdit ? (editTemplate.description ?? '') : '')
  const [snack, setSnack]             = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({ open: false, msg: '', sev: 'success' })
  const [sampleJson, setSampleJson]   = useState('')
  const [mappingPreview, setMappingPreview] = useState<Record<string, string>>({})
  const [layoutMode, setLayoutMode]         = useState(false)
  const [layoutInstruction, setLayoutInstruction] = useState('')
  const [layoutSuggesting, setLayoutSuggesting]   = useState(false)

  // When editing, jump straight to Configure step (step 2)
  React.useEffect(() => {
    if (isEdit) setFormBuilderStep(2)
  }, [isEdit])

  const draftMut = useMutation({
    mutationFn: (fd: FormData) => formBuilderApi.draft(fd),
    onSuccess: (data) => {
      // Embed extracted image values into the schema so they survive template save
      const schemaWithSample: FormSchemaJson = (data.sample_data && Object.keys(data.sample_data).length > 0)
        ? { ...data.schema, _sample_data: data.sample_data }
        : data.schema
      setSchema(schemaWithSample)
      setFormBuilderDraft({ ...data, schema: schemaWithSample })
      setFormBuilderStep(1)
    },
    onError: (e: any) => setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Draft failed', sev: 'error' }),
  })

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        name: formName,
        description,
        category: category || undefined,
        status: 'configured' as const,
        form_schema_json: schema ? JSON.stringify(schema) : undefined,
        source_type: sourceType,
        project_id: activeProject?.id,
      }
      return isEdit
        ? formBuilderApi.updateTemplate(editTemplate!.id, payload)
        : formBuilderApi.saveTemplate(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['form-templates'] })
      clearFormBuilder()
      setSchema(null)
      setFormName('')
      setSnack({ open: true, msg: isEdit ? 'Template updated!' : 'Template saved!', sev: 'success' })
      onSaved()
    },
    onError: (e: any) => setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Save failed', sev: 'error' }),
  })

  const handleGenerateDraft = () => {
    if (!formName.trim()) { setSnack({ open: true, msg: 'Form name is required', sev: 'error' }); return }
    const fd = new FormData()
    fd.append('form_name', formName)
    fd.append('source_type', sourceType)
    if (category) fd.append('category', category)
    if (sourceType === 'text') {
      fd.append('text_prompt', textPrompt)
    } else if (file) {
      fd.append('file', file)
    }
    draftMut.mutate(fd)
  }

  const updateSection = (idx: number, updated: FormSection) => {
    if (!schema) return
    const sections = [...schema.sections]
    sections[idx] = updated
    setSchema({ ...schema, sections })
  }

  const deleteSection = (idx: number) => {
    if (!schema) return
    setSchema({ ...schema, sections: schema.sections.filter((_, i) => i !== idx) })
  }

  const addSection = () => {
    if (!schema) return
    const newSec: FormSection = {
      id: `s${Date.now()}`,
      title: `Section ${schema.sections.length + 1}`,
      order: schema.sections.length + 1,
      columns: 1,
      fields: [],
    }
    setSchema({ ...schema, sections: [...schema.sections, newSec] })
  }

  const moveSection = (idx: number, dir: -1 | 1) => {
    if (!schema) return
    const sections = [...schema.sections]
    const other = idx + dir
    ;[sections[idx], sections[other]] = [sections[other], sections[idx]]
    setSchema({ ...schema, sections })
  }

  const handleAutoMapPreview = async () => {
    if (!schema || !sampleJson.trim()) return
    try {
      const parsed = JSON.parse(sampleJson)
      const keys = Object.keys(parsed)
      const allFields = schema.sections.flatMap((s) => s.fields)
      // Use a simple name-match fallback client-side for the preview sidebar
      const preview: Record<string, string> = {}
      for (const f of allFields) {
        const match = keys.find((k) => k.toLowerCase().includes(f.name.toLowerCase()) || f.name.toLowerCase().includes(k.toLowerCase()))
        preview[f.name] = match ? String(parsed[match]) : ''
      }
      setMappingPreview(preview)
    } catch {
      setSnack({ open: true, msg: 'Invalid JSON in sample data', sev: 'error' })
    }
  }

  const allFields = schema?.sections.flatMap((s) => s.fields) ?? []

  return (
    <Box>
      {isEdit && (
        <Alert severity="info" icon={<EditOutlined />} sx={{ mb: 2 }}>
          Editing <strong>{editTemplate!.name}</strong> (v{editTemplate!.version}) — saving will create a new version.
        </Alert>
      )}
      <Stepper activeStep={step} sx={{ mb: 3 }}>
        {BUILDER_STEPS.map((label) => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {/* Step 0 — Input & Name */}
      {step === 0 && (
        <Box sx={{ maxWidth: 640 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField label="Form Name *" value={formName} onChange={(e) => setFormName(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ flex: 1 }} />
          </Box>
          <ToggleButtonGroup value={sourceType} exclusive onChange={(_, v) => v && setSourceType(v)} sx={{ mb: 2 }}>
            <ToggleButton value="text">Text Prompt</ToggleButton>
            <ToggleButton value="image">Image</ToggleButton>
            <ToggleButton value="pdf">PDF</ToggleButton>
          </ToggleButtonGroup>

          {sourceType === 'text' ? (
            <TextField
              label="Describe the form"
              multiline rows={5}
              fullWidth
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              placeholder="e.g. A policy proposal form with sections for personal info, coverage details, and nominee information."
            />
          ) : (
            <Box
              sx={{ border: '2px dashed', borderColor: 'divider', borderRadius: 2, p: 3, textAlign: 'center', cursor: 'pointer' }}
              onClick={() => document.getElementById('fb-file-input')?.click()}
            >
              <input
                id="fb-file-input"
                type="file"
                accept={sourceType === 'pdf' ? '.pdf' : 'image/*'}
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <Typography>{file.name}</Typography>
              ) : (
                <Typography color="text.secondary">Click to upload {sourceType === 'pdf' ? 'PDF' : 'image'} (max 10 MB)</Typography>
              )}
            </Box>
          )}

          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={handleGenerateDraft}
            disabled={draftMut.isPending || !formName.trim()}
            startIcon={draftMut.isPending ? <CircularProgress size={16} /> : <AutoFixHigh />}
          >
            {draftMut.isPending ? 'Extracting…' : 'Generate AI Draft'}
          </Button>
        </Box>
      )}

      {/* Step 1 — AI Draft review */}
      {step === 1 && schema && (
        <Box sx={{ maxWidth: 700 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            AI extraction is approximate — review carefully before configuring.
          </Alert>
          {schema.sections.map((sec) => (
            <Paper key={sec.id} variant="outlined" sx={{ p: 2, mb: 1 }}>
              <Typography fontWeight={600}>{sec.title}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {sec.fields.map((f) => (
                  <Chip key={f.id} label={`${f.label} (${f.type})`} size="small" variant="outlined" />
                ))}
              </Box>
            </Paper>
          ))}
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button onClick={() => setFormBuilderStep(0)}>Back</Button>
            <Button variant="contained" onClick={() => setFormBuilderStep(2)}>Looks Good, Configure →</Button>
          </Box>
        </Box>
      )}

      {/* Step 2 — Configure */}
      {step === 2 && schema && (
        <Box sx={{ display: 'flex', gap: 3 }}>
          {/* Left: section editor + layout editor */}
          <Box sx={{ flex: 1 }}>
            {/* Mode toggle + NLP layout bar */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={layoutMode ? 'layout' : 'structure'}
                onChange={(_, v) => { if (v !== null) setLayoutMode(v === 'layout') }}
              >
                <ToggleButton value="structure" sx={{ px: 2 }}>
                  <FormatListBulleted sx={{ fontSize: 16, mr: 0.5 }} /> Structure
                </ToggleButton>
                <ToggleButton value="layout" sx={{ px: 2 }}>
                  <GridViewIcon sx={{ fontSize: 16, mr: 0.5 }} /> Layout
                </ToggleButton>
              </ToggleButtonGroup>

              {layoutMode && (
                <Box sx={{ display: 'flex', gap: 1, flex: 1, minWidth: 200 }}>
                  <TextField
                    size="small"
                    placeholder="e.g. Put first_name and last_name side by side, address full width…"
                    value={layoutInstruction}
                    onChange={(e) => setLayoutInstruction(e.target.value)}
                    sx={{ flex: 1 }}
                    disabled={layoutSuggesting || !editTemplate?.id}
                  />
                  <Tooltip title={!editTemplate?.id ? 'Save the template first to use AI layout' : ''}>
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={layoutSuggesting ? <CircularProgress size={14} /> : <AutoFixHigh />}
                        disabled={layoutSuggesting || !layoutInstruction.trim() || !editTemplate?.id}
                        onClick={async () => {
                          if (!editTemplate?.id || !layoutInstruction.trim()) return
                          setLayoutSuggesting(true)
                          try {
                            const result = await formBuilderApi.suggestLayout(editTemplate.id, layoutInstruction)
                            setSchema((prev) => {
                              if (!prev) return prev
                              return {
                                ...prev,
                                sections: prev.sections.map((sec, secIdx) => {
                                  const secLayout =
                                    result.sections.find(
                                      (s) => s.section.trim().toLowerCase() === sec.title.trim().toLowerCase()
                                    ) ?? result.sections[secIdx]
                                  if (!secLayout) return sec

                                  if (result.layout_type === 'label_value') {
                                    return {
                                      ...sec,
                                      layout_type: 'label_value' as const,
                                      columns: 1 as const,
                                      fields: sec.fields.map((f) => {
                                        const pos = secLayout.fields.find((fp) => fp.name === f.name)
                                        return pos
                                          ? { ...f, row: pos.row, column: undefined, col_span: undefined, row_span: undefined, height: undefined, full_width: false }
                                          : f
                                      }),
                                    }
                                  } else {
                                    const hasMultiCol = secLayout.fields.some((fp) => fp.column === 2 || fp.col_span === 2)
                                    const cols: 1 | 2 = hasMultiCol ? 2 : 1
                                    return {
                                      ...sec,
                                      layout_type: 'grid' as const,
                                      columns: cols,
                                      fields: sec.fields.map((f) => {
                                        const pos = secLayout.fields.find((fp) => fp.name === f.name)
                                        if (!pos) return f
                                        const colSpan = pos.col_span ?? 1
                                        return {
                                          ...f,
                                          row: pos.row,
                                          column: (pos.column ?? 1) as 1 | 2,
                                          col_span: colSpan as 1 | 2,
                                          row_span: pos.row_span,
                                          height: pos.height,
                                          full_width: colSpan === 2,
                                        }
                                      }),
                                    }
                                  }
                                }),
                              }
                            })
                            setSnack({ open: true, msg: 'Layout applied!', sev: 'success' })
                          } catch (e: any) {
                            setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Layout suggestion failed', sev: 'error' })
                          } finally {
                            setLayoutSuggesting(false)
                          }
                        }}
                      >
                        {layoutSuggesting ? 'Generating…' : 'Generate Layout'}
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
              )}
            </Box>

            {/* Structure mode */}
            {!layoutMode && (
              <>
                {schema.sections.map((sec, si) => (
                  <SectionCard
                    key={sec.id}
                    section={sec}
                    sectionIndex={si}
                    totalSections={schema.sections.length}
                    onChange={(u) => updateSection(si, u)}
                    onDelete={() => deleteSection(si)}
                    onMoveUp={() => moveSection(si, -1)}
                    onMoveDown={() => moveSection(si, 1)}
                  />
                ))}
                <Button startIcon={<AddCircleOutline />} onClick={addSection} sx={{ mt: 1 }}>
                  Add Section
                </Button>
              </>
            )}

            {/* Layout mode */}
            {layoutMode && (
              <LayoutEditor schema={schema} onChange={(s) => setSchema(s)} />
            )}

            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              {!isEdit && <Button onClick={() => setFormBuilderStep(1)}>Back</Button>}
              <Button variant="contained" onClick={() => setFormBuilderStep(3)}>
                Review &amp; {isEdit ? 'Update' : 'Save'} →
              </Button>
            </Box>
          </Box>

          {/* Right: mapping preview sidebar */}
          <Box sx={{ width: 300, flexShrink: 0 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Mapping Preview</Typography>
              <TextField
                label="Paste sample JSON"
                multiline rows={4}
                fullWidth size="small"
                value={sampleJson}
                onChange={(e) => setSampleJson(e.target.value)}
                sx={{ mb: 1 }}
              />
              <Button size="small" startIcon={<RefreshOutlined />} onClick={handleAutoMapPreview} fullWidth>
                Preview Mapping
              </Button>
              {Object.keys(mappingPreview).length > 0 && (
                <Box sx={{ mt: 1 }}>
                  {allFields.map((f) => (
                    <Box key={f.id} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                      <Typography variant="caption" color="text.secondary">{f.name}</Typography>
                      <Typography variant="caption" fontWeight={500}>
                        {mappingPreview[f.name] || <span style={{ color: '#aaa' }}>—</span>}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          </Box>
        </Box>
      )}

      {/* Step 3 — Save */}
      {step === 3 && schema && (
        <Box sx={{ maxWidth: 500 }}>
          <TextField
            label="Form Name *"
            fullWidth
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            error={!formName.trim()}
            helperText={!formName.trim() ? 'Required' : undefined}
            sx={{ mb: 2 }}
          />
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {schema.sections.length} section{schema.sections.length !== 1 ? 's' : ''} ·{' '}
              {schema.sections.reduce((n, s) => n + s.fields.length, 0)} fields
            </Typography>
          </Paper>
          <TextField
            label="Description (optional)"
            fullWidth multiline rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button onClick={() => setFormBuilderStep(2)}>Back</Button>
            <Button
              variant="contained"
              startIcon={saveMut.isPending ? <CircularProgress size={16} /> : <SaveOutlined />}
              onClick={() => {
                if (!formName.trim()) { setSnack({ open: true, msg: 'Form name is required', sev: 'error' }); return }
                saveMut.mutate()
              }}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? (isEdit ? 'Updating…' : 'Saving…') : (isEdit ? 'Update Template' : 'Save Template')}
            </Button>
          </Box>
        </Box>
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.sev} onClose={() => setSnack((s) => ({ ...s, open: false }))}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Tab 2 — Execute
// ─────────────────────────────────────────────────────────────

const EXEC_STEPS = ['Select Template', 'Data Source', 'Field Mapping', 'Generate']

function ExecuteTab() {
  const [step, setStep]                   = useState(0)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('')
  const [dataSource, setDataSource]       = useState<'db' | 'api' | 'manual'>('manual')
  const [manualJson, setManualJson]       = useState('')
  const [apiEndpoint, setApiEndpoint]     = useState('')
  const [apiMethod, setApiMethod]         = useState('GET')
  const [dbConnId, setDbConnId]           = useState<number | ''>('')
  const [dbQuery, setDbQuery]             = useState('')
  const [dbPreviewCols, setDbPreviewCols]   = useState<string[]>([])
  const [dbPreviewRows, setDbPreviewRows]   = useState<Record<string, unknown>[]>([])
  const [dbPreviewTotal, setDbPreviewTotal] = useState<number>(0)
  const [dbPreviewing, setDbPreviewing]     = useState(false)
  const [expandedTable, setExpandedTable]   = useState<string | null>(null)
  const [dbSuggesting, setDbSuggesting]  = useState(false)
  const [mappingRows, setMappingRows]     = useState<Array<{ name: string; path: string }>>([])
  const [outputFormat, setOutputFormat]   = useState<FormOutputFormat>('api')
  const [execResult, setExecResult]       = useState<FormExecution | null>(null)
  const [bulkMode, setBulkMode]           = useState(false)
  const [savedBindingId, setSavedBindingId] = useState<number | null>(null)
  const [execTrace, setExecTrace]         = useState<{ dataSource: string; config: object; mapping: Record<string, string>; ts: string } | null>(null)
  const [traceOpen, setTraceOpen]         = useState(false)
  const [imageDataPrefilled, setImageDataPrefilled] = useState(false)
  const [imageSourceTemplate, setImageSourceTemplate] = useState(false)
  const [snack, setSnack]                 = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({ open: false, msg: '', sev: 'success' })
  const qc = useQueryClient()
  const { activeProject } = useAppStore()

  const { data: templates = [] } = useQuery({
    queryKey: ['form-templates'],
    queryFn: () => formBuilderApi.listTemplates(),
  })

  const { data: schemaTables = [] } = useQuery({
    queryKey: ['form-builder-schema-tables', dbConnId],
    queryFn: () => formBuilderApi.schemaTables(dbConnId as number),
    enabled: Boolean(dbConnId),
  })

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)

  // Memoize schema so effects get a stable reference (JSON.parse creates a new object each render)
  const schema: FormSchemaJson | null = React.useMemo(() => {
    if (!selectedTemplate?.form_schema_json) return null
    try { return JSON.parse(selectedTemplate.form_schema_json) } catch { return null }
  }, [selectedTemplate?.id, selectedTemplate?.version])

  const allFields = schema?.sections.flatMap((s) => s.fields) ?? []

  // Sync mapping rows when template changes
  React.useEffect(() => {
    setMappingRows(allFields.map((f) => ({ name: f.name, path: f.name })))
  }, [selectedTemplateId])

  // Pre-fill Manual JSON when template is selected
  // Depends on both selectedTemplateId AND schema so it fires correctly even when
  // templates refetch after the template ID changes (schema = null on first fire)
  React.useEffect(() => {
    if (!selectedTemplateId || !schema) return

    const isImageSource = selectedTemplate?.source_type === 'image' || selectedTemplate?.source_type === 'pdf'
    if (!isImageSource) { setImageDataPrefilled(false); setImageSourceTemplate(false); return }

    const fieldNames = schema.sections.flatMap((s) => s.fields.map((f) => f.name))
    if (fieldNames.length === 0) return

    const extracted = schema._sample_data ?? {}
    // Build complete JSON: extracted values where present, empty string otherwise
    const jsonData: Record<string, string> = {}
    for (const name of fieldNames) jsonData[name] = extracted[name] ?? ''

    setManualJson(JSON.stringify(jsonData, null, 2))
    setDataSource('manual')
    setImageSourceTemplate(true)
    setImageDataPrefilled(Object.values(extracted).some(Boolean))
  }, [selectedTemplateId, schema])

  const handleDbPreview = async () => {
    if (!dbConnId || !dbQuery.trim()) return
    setDbPreviewing(true)
    try {
      const result = await connectionsApi.runQuery(dbConnId as number, dbQuery)
      setDbPreviewCols(result.columns)
      setDbPreviewRows(result.rows.slice(0, 5) as Record<string, unknown>[])
      setDbPreviewTotal(result.total ?? result.rows.length)
    } catch (e: any) {
      setDbPreviewCols([])
      setDbPreviewRows([])
      setDbPreviewTotal(0)
      setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Query failed', sev: 'error' })
    } finally {
      setDbPreviewing(false)
    }
  }

  const handleSuggestQuery = async () => {
    if (!dbConnId || !selectedTemplateId) return
    setDbSuggesting(true)
    try {
      const result = await formBuilderApi.suggestQuery(selectedTemplateId as number, dbConnId as number)
      setDbQuery(result.sql)
      setDbPreviewCols([])
      setDbPreviewRows([])
    } catch (e: any) {
      setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Could not suggest query', sev: 'error' })
    } finally {
      setDbSuggesting(false)
    }
  }

  const autoMapMut = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) return
      let keys: string[] = []
      if (dataSource === 'manual' && manualJson.trim()) {
        try {
          const parsed = JSON.parse(manualJson)
          keys = Object.keys(Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed)
        } catch {}
      } else if (dataSource === 'db') {
        keys = dbPreviewCols
      } else if (dataSource === 'api') {
        keys = []  // API keys not known without a preview run
      }
      const res = await formBuilderApi.autoMap(selectedTemplateId as number, keys)
      const rows = allFields.map((f) => ({ name: f.name, path: res.mapping[f.name] ?? f.name }))
      setMappingRows(rows)
    },
  })

  const saveBindingMut = useMutation({
    mutationFn: () => {
      const mapping: Record<string, string> = {}
      mappingRows.forEach((r) => { mapping[r.name] = r.path })
      const config = dataSource === 'manual'
        ? { raw_json: manualJson }
        : dataSource === 'api'
        ? { endpoint: apiEndpoint, method: apiMethod }
        : { conn_id: dbConnId, query: dbQuery }
      return formBuilderApi.saveBinding(selectedTemplateId as number, {
        template_id: selectedTemplateId as number,
        template_version: selectedTemplate?.version ?? 1,
        data_source: dataSource,
        config_json: JSON.stringify(config),
        mapping_json: JSON.stringify(mapping),
      })
    },
    onSuccess: (binding) => {
      setSavedBindingId(binding.id)
      setSnack({ open: true, msg: 'Binding saved', sev: 'success' })
    },
  })

  const [rowsBulkResult, setRowsBulkResult] = useState<any>(null)

  const executeRowsMut = useMutation({
    mutationFn: async () => {
      let bid = savedBindingId
      if (!bid) {
        const binding = await saveBindingMut.mutateAsync()
        bid = (binding as FormDataBinding).id
      }
      return formBuilderApi.executeRows(selectedTemplateId as number, bid!, outputFormat)
    },
    onSuccess: (res) => {
      setRowsBulkResult(res)
      qc.invalidateQueries({ queryKey: ['form-executions', selectedTemplateId] })
    },
    onError: (e: any) => setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Row execution failed', sev: 'error' }),
  })

  const executeMut = useMutation({
    mutationFn: async () => {
      let bid = savedBindingId
      if (!bid) {
        const binding = await saveBindingMut.mutateAsync()
        bid = (binding as FormDataBinding).id
      }
      return formBuilderApi.execute(selectedTemplateId as number, bid!, outputFormat)
    },
    onSuccess: (exec) => {
      setExecResult(exec)
      qc.invalidateQueries({ queryKey: ['form-executions', selectedTemplateId] })
      const mapping: Record<string, string> = {}
      mappingRows.forEach((r) => { mapping[r.name] = r.path })
      const config = dataSource === 'manual'
        ? { raw_json: manualJson.slice(0, 200) + (manualJson.length > 200 ? '…' : '') }
        : dataSource === 'api'
        ? { endpoint: apiEndpoint, method: apiMethod }
        : { conn_id: dbConnId, query: dbQuery }
      setExecTrace({ dataSource, config, mapping, ts: new Date().toISOString() })
      setTraceOpen(true)
    },
    onError: (e: any) => setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Execution failed', sev: 'error' }),
  })

  const canProceed = [
    Boolean(selectedTemplateId),
    true,
    mappingRows.length > 0,
    true,
  ]

  return (
    <Box>
      <Stepper activeStep={step} sx={{ mb: 3 }}>
        {EXEC_STEPS.map((label) => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {/* Step 0 */}
      {step === 0 && (
        <Box sx={{ maxWidth: 480 }}>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Select Template</InputLabel>
            <Select value={selectedTemplateId} label="Select Template" onChange={(e) => setSelectedTemplateId(e.target.value as number)}>
              {templates.filter((t) => t.status !== 'draft').map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name} <Chip label={`v${t.version}`} size="small" sx={{ ml: 1 }} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {selectedTemplate && (
            <Alert severity="info">
              {schema?.sections.length ?? 0} sections · {allFields.length} fields · status: <b>{selectedTemplate.status}</b>
            </Alert>
          )}
          <Button sx={{ mt: 2 }} variant="contained" disabled={!selectedTemplateId} onClick={() => setStep(1)}>
            Next →
          </Button>
        </Box>
      )}

      {/* Step 1 — Data Source */}
      {step === 1 && (
        <Box sx={{ maxWidth: 640 }}>
          <ToggleButtonGroup value={dataSource} exclusive onChange={(_, v) => v && setDataSource(v)} sx={{ mb: 2 }}>
            <ToggleButton value="manual">Manual JSON</ToggleButton>
            <ToggleButton value="api">API</ToggleButton>
            <ToggleButton value="db">Database</ToggleButton>
          </ToggleButtonGroup>

          {dataSource === 'manual' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {imageSourceTemplate && (
                <Alert
                  severity={imageDataPrefilled ? 'success' : 'info'}
                  icon={false}
                  action={
                    <Button size="small" color="inherit" onClick={() => {
                      setManualJson('')
                      setImageDataPrefilled(false)
                      setImageSourceTemplate(false)
                    }}>
                      Clear
                    </Button>
                  }
                >
                  {imageDataPrefilled
                    ? 'Values extracted from the uploaded image. Edit as needed before executing.'
                    : 'Field names pre-filled from image template. No values were detected in the image — fill them in below.'}
                </Alert>
              )}
              <TextField
                label="JSON data"
                multiline rows={8} fullWidth
                value={manualJson}
                onChange={(e) => { setManualJson(e.target.value); setImageDataPrefilled(false) }}
                placeholder='{ "policy_number": "POL123", "customer_name": "Sai" }'
              />
            </Box>
          )}
          {dataSource === 'api' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Select value={apiMethod} onChange={(e) => setApiMethod(e.target.value)} size="small" sx={{ width: 100 }}>
                  <MenuItem value="GET">GET</MenuItem>
                  <MenuItem value="POST">POST</MenuItem>
                </Select>
                <TextField label="API Endpoint URL" value={apiEndpoint} onChange={(e) => setApiEndpoint(e.target.value)} size="small" sx={{ flex: 1 }} />
              </Box>
              <Alert severity="info">API auth headers can be provided at execution time and are never stored.</Alert>
            </Box>
          )}
          {dataSource === 'db' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <ConnectionSelector
                value={dbConnId as number | ''}
                onChange={(_, id) => { setDbConnId(id); setDbPreviewCols([]); setDbPreviewRows([]); setDbPreviewTotal(0); setExpandedTable(null) }}
                label="Database Connection"
                includeGlobal
              />

              {/* Schema browser — shown when connection is selected */}
              {dbConnId && schemaTables.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 1 }}>
                    Available tables ({schemaTables.length}) — click to insert SELECT
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {schemaTables.map((t) => (
                      <Box key={t.table}>
                        <Chip
                          label={`${t.table} (${t.column_count})`}
                          size="small"
                          variant={expandedTable === t.table ? 'filled' : 'outlined'}
                          onClick={() => {
                            setExpandedTable(expandedTable === t.table ? null : t.table)
                            setDbQuery(`SELECT TOP 10 * FROM ${t.table}`)
                            setDbPreviewCols([]); setDbPreviewRows([]); setDbPreviewTotal(0)
                          }}
                          sx={{ cursor: 'pointer' }}
                        />
                        {expandedTable === t.table && (
                          <Box sx={{ mt: 0.5, mb: 0.5, pl: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              {t.columns.join(' · ')}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Paper>
              )}
              {dbConnId && schemaTables.length === 0 && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  No catalog found for this connection. Run <strong>Admin → Collect Schema</strong> first to enable AI query suggestions.
                </Alert>
              )}

              <TextField
                label="SQL Query"
                multiline rows={4} fullWidth size="small"
                value={dbQuery}
                onChange={(e) => { setDbQuery(e.target.value); setDbPreviewCols([]); setDbPreviewRows([]); setDbPreviewTotal(0) }}
                placeholder="SELECT * FROM policies WHERE id = 1"
              />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined" size="small"
                  startIcon={dbSuggesting ? <CircularProgress size={14} /> : <AutoFixHigh />}
                  onClick={handleSuggestQuery}
                  disabled={!dbConnId || !selectedTemplateId || dbSuggesting}
                >
                  {dbSuggesting ? 'Generating…' : '✨ AI Suggest Query'}
                </Button>
                <Button
                  variant="outlined" size="small" color="inherit"
                  startIcon={dbPreviewing ? <CircularProgress size={14} /> : <VisibilityOutlined />}
                  onClick={handleDbPreview}
                  disabled={!dbConnId || !dbQuery.trim() || dbPreviewing}
                >
                  {dbPreviewing ? 'Running…' : 'Preview Query'}
                </Button>
              </Box>
              {dbPreviewCols.length > 0 && (
                <Alert severity="success">
                  <strong>{dbPreviewTotal} row{dbPreviewTotal !== 1 ? 's' : ''}</strong> · {dbPreviewCols.length} columns: {dbPreviewCols.slice(0, 8).join(', ')}{dbPreviewCols.length > 8 ? ` +${dbPreviewCols.length - 8} more` : ''}
                  {dbPreviewTotal > 1 && (
                    <Box component="span" sx={{ ml: 1, fontWeight: 600 }}>
                      — "Generate for all rows" will create {dbPreviewTotal} executions
                    </Box>
                  )}
                </Alert>
              )}
              {dbPreviewRows.length > 0 && (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {dbPreviewCols.map((c) => <TableCell key={c}>{c}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dbPreviewRows.map((row, i) => (
                        <TableRow key={i}>
                          {dbPreviewCols.map((c) => (
                            <TableCell key={c} sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {String(row[c] ?? '')}
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

          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="contained" onClick={() => setStep(2)}>Next →</Button>
          </Box>
        </Box>
      )}

      {/* Step 2 — Field Mapping */}
      {step === 2 && (
        <Box sx={{ maxWidth: 700 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="subtitle1">Map template fields to data paths</Typography>
            <Button size="small" startIcon={<AutoFixHigh />} onClick={() => autoMapMut.mutate()} disabled={autoMapMut.isPending}>
              {autoMapMut.isPending ? 'Auto-mapping…' : 'Auto-Map'}
            </Button>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Template Field</TableCell>
                <TableCell>Data Path</TableCell>
                <TableCell width={80}>Required</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappingRows.map((row, ri) => {
                const fieldDef = allFields.find((f) => f.name === row.name)
                const missing  = fieldDef?.required && !row.path.trim()
                return (
                  <TableRow key={row.name} sx={{ bgcolor: missing ? 'error.lighter' : 'inherit' }}>
                    <TableCell>
                      <Typography variant="body2">{fieldDef?.label ?? row.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{row.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small" fullWidth
                        value={row.path}
                        onChange={(e) => {
                          const rows = [...mappingRows]
                          rows[ri] = { ...row, path: e.target.value }
                          setMappingRows(rows)
                        }}
                        error={missing}
                        placeholder="e.g. customer.name"
                      />
                    </TableCell>
                    <TableCell>
                      {fieldDef?.required && (
                        <Chip label="req" size="small" color={missing ? 'error' : 'default'} />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="outlined" startIcon={<SaveOutlined />} onClick={() => saveBindingMut.mutate()} disabled={saveBindingMut.isPending}>
              Save Binding
            </Button>
            <Button variant="contained" onClick={() => setStep(3)}>Next →</Button>
          </Box>
        </Box>
      )}

      {/* Step 3 — Generate */}
      {step === 3 && (
        <Box sx={{ maxWidth: 600 }}>
          <ToggleButtonGroup
            exclusive value={bulkMode ? 'bulk' : 'single'}
            onChange={(_, v) => v && setBulkMode(v === 'bulk')}
            sx={{ mb: 3 }}
          >
            <ToggleButton value="single">Single</ToggleButton>
            <ToggleButton value="bulk">Bulk</ToggleButton>
          </ToggleButtonGroup>

          {!bulkMode && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Output Format</Typography>
              <ToggleButtonGroup exclusive value={outputFormat} onChange={(_, v) => v && setOutputFormat(v)} sx={{ mb: 2 }}>
                <ToggleButton value="api">JSON</ToggleButton>
                <ToggleButton value="pdf">PDF</ToggleButton>
                <ToggleButton value="fillable">Fillable PDF</ToggleButton>
                <ToggleButton value="ui">Web UI</ToggleButton>
              </ToggleButtonGroup>

              <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <Button onClick={() => setStep(2)}>Back</Button>
                <Button
                  variant="contained"
                  startIcon={executeMut.isPending ? <CircularProgress size={16} /> : <PlayArrowOutlined />}
                  onClick={() => executeMut.mutate()}
                  disabled={executeMut.isPending || executeRowsMut.isPending || selectedTemplate?.status === 'draft'}
                >
                  {executeMut.isPending ? 'Executing…' : 'Execute (first row)'}
                </Button>
                {dataSource === 'db' && dbPreviewTotal > 1 && (
                  <Button
                    variant="outlined"
                    color="secondary"
                    startIcon={executeRowsMut.isPending ? <CircularProgress size={16} /> : <PlayArrowOutlined />}
                    onClick={() => executeRowsMut.mutate()}
                    disabled={executeMut.isPending || executeRowsMut.isPending || selectedTemplate?.status === 'draft'}
                  >
                    {executeRowsMut.isPending ? 'Generating…' : `Generate for all ${dbPreviewTotal} rows`}
                  </Button>
                )}
              </Box>

              {selectedTemplate?.status === 'draft' && (
                <Alert severity="warning">Template must be saved (status = configured) before execution.</Alert>
              )}

              {execResult && <ExecutionResultCard exec={execResult} />}

              {rowsBulkResult && (
                <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                  <Typography fontWeight={600} gutterBottom>
                    Row Bulk Run — {rowsBulkResult.total_rows} rows · {rowsBulkResult.executions?.filter((e: any) => e.status === 'completed').length ?? 0} completed
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Output</TableCell>
                        <TableCell>Error</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(rowsBulkResult.executions ?? []).map((exec: FormExecution, i: number) => (
                        <TableRow key={exec.id}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell>
                            <Chip label={exec.status} size="small" color={exec.status === 'completed' ? 'success' : 'error'} />
                          </TableCell>
                          <TableCell><ExecOutputButtons exec={exec} /></TableCell>
                          <TableCell>
                            <Typography variant="caption" color="error.main">{exec.error_message ?? ''}</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              )}

              {execTrace && (
                <Box sx={{ mt: 2 }}>
                  <Button
                    size="small"
                    startIcon={<CodeOutlined />}
                    onClick={() => setTraceOpen((v) => !v)}
                    variant="outlined"
                    color="inherit"
                    sx={{ mb: 1 }}
                  >
                    {traceOpen ? 'Hide Trace' : 'Show Execution Trace'}
                  </Button>
                  <Collapse in={traceOpen}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        Executed at {execTrace.ts}
                      </Typography>
                      <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5 }}>
                        Data Source: <Chip label={execTrace.dataSource} size="small" sx={{ ml: 0.5 }} />
                      </Typography>
                      <Box
                        component="pre"
                        sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5, fontSize: 11, overflow: 'auto', mb: 1.5 }}
                      >
                        {JSON.stringify(execTrace.config, null, 2)}
                      </Box>
                      <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5 }}>
                        Field Mapping Applied ({Object.keys(execTrace.mapping).length} fields)
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Field</TableCell>
                            <TableCell>Data Path</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.entries(execTrace.mapping).map(([field, path]) => (
                            <TableRow key={field}>
                              <TableCell><Typography variant="caption">{field}</Typography></TableCell>
                              <TableCell><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{path || '—'}</Typography></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Collapse>
                </Box>
              )}
            </Box>
          )}

          {bulkMode && selectedTemplateId && (
            <BulkPanel
              bindingId={savedBindingId}
              templates={templates}
              currentTemplateId={selectedTemplateId as number}
              onSaveBinding={() => saveBindingMut.mutate()}
            />
          )}
        </Box>
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.sev} onClose={() => setSnack((s) => ({ ...s, open: false }))}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Shared execution view dialog + output buttons
// ─────────────────────────────────────────────────────────────

function ExecutionViewDialog({ exec, onClose }: { exec: FormExecution; onClose: () => void }) {
  const outputJson = exec.output_json ? (() => { try { return JSON.parse(exec.output_json!) } catch { return null } })() : null
  const pdfBase = exec.output_file_path
    ? `/api/form-builder/outputs/${exec.output_file_path.split(/[/\\]/).pop()}`
    : null
  const pdfUrl     = pdfBase                  // inline — for iframe / new tab
  const pdfDlUrl   = pdfBase ? `${pdfBase}?dl=1` : null  // attachment — for download
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(outputJson, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <VisibilityOutlined fontSize="small" />
        Execution #{exec.id} — Output
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Chip label={exec.output_format} size="small" />
          <Chip
            label={exec.status}
            size="small"
            color={exec.status === 'completed' ? 'success' : 'error'}
          />
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {exec.error_message && (
          <Alert severity="error" sx={{ m: 2 }}>{exec.error_message}</Alert>
        )}

        {/* JSON output */}
        {exec.output_format === 'api' && outputJson && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Button
                size="small" startIcon={<ContentCopyOutlined />}
                onClick={handleCopy} color={copied ? 'success' : 'inherit'}
              >
                {copied ? 'Copied!' : 'Copy JSON'}
              </Button>
            </Box>
            <Box
              component="pre"
              sx={{
                m: 0, p: 2.5, fontSize: 12, lineHeight: 1.6,
                bgcolor: (t) => t.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                overflow: 'auto', maxHeight: '65vh',
                fontFamily: 'monospace',
              }}
            >
              {JSON.stringify(outputJson, null, 2)}
            </Box>
          </Box>
        )}

        {/* Web UI output */}
        {exec.output_format === 'ui' && outputJson && (
          <Box sx={{ p: 2.5, maxHeight: '65vh', overflow: 'auto' }}>
            <LiveFormPreview spec={outputJson} />
          </Box>
        )}

        {/* PDF — embed in iframe */}
        {(exec.output_format === 'pdf' || exec.output_format === 'fillable') && pdfUrl && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1, borderBottom: 1, borderColor: 'divider', gap: 1 }}>
              <Button
                size="small" startIcon={<OpenInNewOutlined />}
                href={pdfUrl} target="_blank" component="a"
              >
                Open in new tab
              </Button>
              <Button
                size="small" startIcon={<CloudDownload />}
                href={pdfDlUrl ?? undefined} download component="a" variant="outlined"
              >
                Download
              </Button>
            </Box>
            <Box
              component="iframe"
              src={pdfUrl}
              sx={{ width: '100%', height: '65vh', border: 'none', display: 'block' }}
            />
          </Box>
        )}

        {!exec.error_message && !outputJson && !pdfUrl && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">No output available.</Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Renders View + Download buttons for a table cell or card, opening the dialog on View
function ExecOutputButtons({ exec, variant = 'table' }: { exec: FormExecution; variant?: 'table' | 'card' }) {
  const [viewOpen, setViewOpen] = useState(false)
  const pdfDlUrl = exec.output_file_path
    ? `/api/form-builder/outputs/${exec.output_file_path.split(/[/\\]/).pop()}?dl=1`
    : null
  const hasOutput = exec.output_json || exec.output_file_path

  if (!hasOutput || exec.status !== 'completed') {
    return exec.error_message ? (
      <Tooltip title={exec.error_message}>
        <ErrorOutline color="error" fontSize="small" />
      </Tooltip>
    ) : null
  }

  const size = variant === 'table' ? 'small' : 'small'

  return (
    <>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        <Button
          size={size} variant="outlined" startIcon={<VisibilityOutlined />}
          onClick={() => setViewOpen(true)}
        >
          View
        </Button>
        {pdfDlUrl && (
          <Button
            size={size} variant="outlined" startIcon={<CloudDownload />}
            href={pdfDlUrl} download component="a"
          >
            Download
          </Button>
        )}
      </Box>
      {viewOpen && <ExecutionViewDialog exec={exec} onClose={() => setViewOpen(false)} />}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Execution result card
// ─────────────────────────────────────────────────────────────

function ExecutionResultCard({ exec }: { exec: FormExecution }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        {exec.status === 'completed'
          ? <CheckCircleOutline color="success" />
          : <ErrorOutline color="error" />}
        <Typography fontWeight={600}>
          {exec.status === 'completed' ? 'Execution complete' : 'Execution failed'}
        </Typography>
        <Chip label={exec.output_format} size="small" sx={{ ml: 'auto' }} />
      </Box>

      {exec.error_message && <Alert severity="error" sx={{ mb: 1.5 }}>{exec.error_message}</Alert>}

      {exec.status === 'completed' && <ExecOutputButtons exec={exec} variant="card" />}
    </Paper>
  )
}

function LiveFormPreview({ spec }: { spec: any }) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Live Form Preview</Typography>
      {(spec.sections ?? []).map((sec: any) => (
        <Box key={sec.id} sx={{ mb: 2 }}>
          <Typography variant="caption" color="primary" fontWeight={600}>{sec.title}</Typography>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: sec.columns === 3 ? '1fr 1fr 1fr' : sec.columns === 2 ? '1fr 1fr' : '1fr',
            gap: 1,
            mt: 0.5,
          }}>
            {(sec.fields ?? []).map((f: any) => (
              <Box key={f.name}>
                <Typography variant="caption" color="text.secondary">{f.label}</Typography>
                <TextField
                  size="small" fullWidth
                  defaultValue={f.value ?? ''}
                  placeholder={f.placeholder}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Bulk execution panel
// ─────────────────────────────────────────────────────────────

function BulkPanel({ bindingId, templates, currentTemplateId, onSaveBinding }: {
  bindingId: number | null
  templates: FormTemplate[]
  currentTemplateId: number
  onSaveBinding: () => void
}) {
  const [selected, setSelected]   = useState<Set<number>>(new Set([currentTemplateId]))
  const [format, setFormat]       = useState<FormOutputFormat>('pdf')
  const [bulkResult, setBulkResult] = useState<any>(null)
  const [snack, setSnack]         = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({ open: false, msg: '', sev: 'success' })

  const bulkMut = useMutation({
    mutationFn: async () => {
      let bid = bindingId
      if (!bid) {
        setSnack({ open: true, msg: 'Please save the binding first (Step 3 → Save Binding)', sev: 'error' })
        return
      }
      const items: FormBulkExecuteItem[] = [...selected].map((id) => {
        const t = templates.find((x) => x.id === id)!
        return { template_id: id, template_version: t.version, output_format: format }
      })
      return formBuilderApi.bulkExecute(bid, items)
    },
    onSuccess: (res) => { if (res) setBulkResult(res) },
    onError: (e: any) => setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Bulk execution failed', sev: 'error' }),
  })

  const toggle = (id: number) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>Select Templates to Execute</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
        {templates.filter((t) => t.status !== 'draft').map((t) => (
          <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
            <Typography variant="body2">{t.name}</Typography>
            <Chip label={`v${t.version}`} size="small" />
          </Box>
        ))}
      </Box>
      <ToggleButtonGroup exclusive value={format} onChange={(_, v) => v && setFormat(v)} sx={{ mb: 2 }}>
        <ToggleButton value="api">JSON</ToggleButton>
        <ToggleButton value="pdf">PDF</ToggleButton>
        <ToggleButton value="fillable">Fillable PDF</ToggleButton>
        <ToggleButton value="ui">Web UI</ToggleButton>
      </ToggleButtonGroup>
      <Button
        variant="contained"
        startIcon={bulkMut.isPending ? <CircularProgress size={16} /> : <PlayArrowOutlined />}
        onClick={() => bulkMut.mutate()}
        disabled={bulkMut.isPending || selected.size === 0}
      >
        {bulkMut.isPending ? 'Executing…' : `Execute ${selected.size} template${selected.size !== 1 ? 's' : ''}`}
      </Button>

      {bulkResult && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Bulk Run: {bulkResult.bulk_run_id}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Template</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Output</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {bulkResult.executions.map((exec: FormExecution) => {
                const t = templates.find((x) => x.id === exec.template_id)
                return (
                  <TableRow key={exec.id}>
                    <TableCell>{t?.name ?? exec.template_id}</TableCell>
                    <TableCell>
                      <Chip
                        label={exec.status}
                        size="small"
                        color={exec.status === 'completed' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell><ExecOutputButtons exec={exec} /></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.sev} onClose={() => setSnack((s) => ({ ...s, open: false }))}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Tab 3 — History
// ─────────────────────────────────────────────────────────────

function HistoryTab() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('')

  const { data: templates = [] } = useQuery({
    queryKey: ['form-templates'],
    queryFn: () => formBuilderApi.listTemplates(),
  })

  const { data: executions = [], isLoading } = useQuery({
    queryKey: ['form-executions', selectedTemplateId],
    queryFn: () => formBuilderApi.listExecutions(selectedTemplateId as number),
    enabled: Boolean(selectedTemplateId),
  })

  return (
    <Box>
      <FormControl sx={{ minWidth: 300, mb: 2 }}>
        <InputLabel>Template</InputLabel>
        <Select value={selectedTemplateId} label="Template" onChange={(e) => setSelectedTemplateId(e.target.value as number)}>
          {templates.map((t) => (
            <MenuItem key={t.id} value={t.id}>{t.name} (v{t.version})</MenuItem>
          ))}
        </Select>
      </FormControl>

      {isLoading && <CircularProgress size={24} />}

      {executions.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Format</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Triggered</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Output</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {executions.map((exec) => (
              <TableRow key={exec.id}>
                <TableCell>{exec.id}</TableCell>
                <TableCell>v{exec.template_version}</TableCell>
                <TableCell><Chip label={exec.output_format} size="small" /></TableCell>
                <TableCell>
                  <Chip
                    label={exec.status}
                    size="small"
                    color={exec.status === 'completed' ? 'success' : exec.status === 'failed' ? 'error' : 'default'}
                  />
                </TableCell>
                <TableCell>{exec.triggered_by}</TableCell>
                <TableCell>{new Date(exec.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ExecOutputButtons exec={exec} />
                    {exec.bulk_run_id && (
                      <Chip label="bulk" size="small" variant="outlined" />
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selectedTemplateId && !isLoading && executions.length === 0 && (
        <Typography color="text.secondary">No executions yet for this template.</Typography>
      )}
    </Box>
  )
}
