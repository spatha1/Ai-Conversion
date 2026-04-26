import React, { useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse,
  Dialog, DialogContent, DialogTitle, Divider,
  FormControl, InputLabel, MenuItem, Paper, Select,
  Snackbar, Step, StepLabel, Stepper, Tab, Table,
  TableBody, TableCell, TableHead, TableRow, Tabs,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography,
} from '@mui/material'
import {
  AddCircleOutline, AutoFixHigh, CheckCircleOutline,
  CloudDownload, CodeOutlined, DeleteOutline,
  DynamicFormOutlined, ErrorOutline, PlayArrowOutlined,
  RefreshOutlined, SaveOutlined, TableChartOutlined,
  ViewStreamOutlined, VisibilityOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formBuilderApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import SectionCard from '@/components/FormBuilder/SectionCard'
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
  const { activeProject } = useAppStore()

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
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab icon={<ViewStreamOutlined />} label="Templates" iconPosition="start" />
          <Tab icon={<DynamicFormOutlined />} label="Builder" iconPosition="start" />
          <Tab icon={<PlayArrowOutlined />} label="Execute" iconPosition="start" />
          <Tab icon={<TableChartOutlined />} label="History" iconPosition="start" />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {tab === 0 && <TemplatesTab projectId={activeProject?.id} onBuild={() => setTab(1)} />}
        {tab === 1 && <BuilderTab onSaved={() => setTab(0)} />}
        {tab === 2 && <ExecuteTab />}
        {tab === 3 && <HistoryTab />}
      </Box>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Tab 0 — Templates list
// ─────────────────────────────────────────────────────────────

function TemplatesTab({ projectId, onBuild }: { projectId?: number; onBuild: () => void }) {
  const qc = useQueryClient()
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Saved Templates ({templates.length})</Typography>
        <Button variant="contained" startIcon={<AddCircleOutline />} onClick={onBuild}>
          New Template
        </Button>
      </Box>

      {templates.length === 0 && (
        <Paper sx={{ p: 4, textAlign: 'center' }} variant="outlined">
          <DynamicFormOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No templates yet. Click "New Template" to create one.</Typography>
        </Paper>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {templates.map((t) => (
          <Paper key={t.id} variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography fontWeight={600}>{t.name}</Typography>
              {t.description && <Typography variant="body2" color="text.secondary">{t.description}</Typography>}
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                <Chip label={`v${t.version}`} size="small" />
                <Chip label={t.status} size="small" color={t.status === 'active' ? 'success' : t.status === 'configured' ? 'primary' : 'default'} />
                {t.category && <Chip label={t.category} size="small" variant="outlined" />}
              </Box>
            </Box>
            <Tooltip title="Delete">
              <span>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutline />}
                  onClick={() => deleteMut.mutate(t.id)}
                  disabled={deleteMut.isPending}
                >
                  Delete
                </Button>
              </span>
            </Tooltip>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}

// ─────────────────────────────────────────────────────────────
// Tab 1 — Builder (4-step wizard)
// ─────────────────────────────────────────────────────────────

const BUILDER_STEPS = ['Input & Name', 'AI Draft', 'Configure', 'Save']

function BuilderTab({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient()
  const { formBuilderStep, formBuilderDraft, setFormBuilderStep, setFormBuilderDraft, clearFormBuilder } = useAppStore()
  const step = formBuilderStep

  const [formName, setFormName]       = useState('')
  const [category, setCategory]       = useState('')
  const [sourceType, setSourceType]   = useState<'text' | 'image' | 'pdf'>('text')
  const [textPrompt, setTextPrompt]   = useState('')
  const [file, setFile]               = useState<File | null>(null)
  const [schema, setSchema]           = useState<FormSchemaJson | null>(formBuilderDraft?.schema ?? null)
  const [description, setDescription] = useState('')
  const [snack, setSnack]             = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({ open: false, msg: '', sev: 'success' })
  const [sampleJson, setSampleJson]   = useState('')
  const [mappingPreview, setMappingPreview] = useState<Record<string, string>>({})

  const draftMut = useMutation({
    mutationFn: (fd: FormData) => formBuilderApi.draft(fd),
    onSuccess: (data) => {
      setSchema(data.schema)
      setFormBuilderDraft(data)
      setFormBuilderStep(1)
    },
    onError: (e: any) => setSnack({ open: true, msg: e?.response?.data?.detail ?? 'Draft failed', sev: 'error' }),
  })

  const saveMut = useMutation({
    mutationFn: () => formBuilderApi.saveTemplate({
      name: formName,
      description,
      category: category || undefined,
      status: 'configured',
      form_schema_json: schema ? JSON.stringify(schema) : undefined,
      source_type: sourceType,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['form-templates'] })
      clearFormBuilder()
      setSchema(null)
      setFormName('')
      setSnack({ open: true, msg: 'Template saved!', sev: 'success' })
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
          {/* Left: section editor */}
          <Box sx={{ flex: 1 }}>
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
            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button onClick={() => setFormBuilderStep(1)}>Back</Button>
              <Button variant="contained" onClick={() => setFormBuilderStep(3)}>
                Review &amp; Save →
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
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography fontWeight={600}>{formName}</Typography>
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
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? 'Saving…' : 'Save Template'}
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
  const [mappingRows, setMappingRows]     = useState<Array<{ name: string; path: string }>>([])
  const [outputFormat, setOutputFormat]   = useState<FormOutputFormat>('api')
  const [execResult, setExecResult]       = useState<FormExecution | null>(null)
  const [bulkMode, setBulkMode]           = useState(false)
  const [savedBindingId, setSavedBindingId] = useState<number | null>(null)
  const [snack, setSnack]                 = useState<{ open: boolean; msg: string; sev: 'success' | 'error' }>({ open: false, msg: '', sev: 'success' })
  const qc = useQueryClient()

  const { data: templates = [] } = useQuery({
    queryKey: ['form-templates'],
    queryFn: () => formBuilderApi.listTemplates(),
  })

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)
  const schema: FormSchemaJson | null = selectedTemplate?.form_schema_json
    ? JSON.parse(selectedTemplate.form_schema_json)
    : null
  const allFields = schema?.sections.flatMap((s) => s.fields) ?? []

  // Sync mapping rows when template changes
  React.useEffect(() => {
    setMappingRows(allFields.map((f) => ({ name: f.name, path: f.name })))
  }, [selectedTemplateId])

  const autoMapMut = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) return
      let keys: string[] = []
      if (dataSource === 'manual' && manualJson.trim()) {
        try { keys = Object.keys(JSON.parse(manualJson)) } catch {}
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
        : {}
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

  const executeMut = useMutation({
    mutationFn: async () => {
      let bid = savedBindingId
      if (!bid) {
        const binding = await saveBindingMut.mutateAsync()
        bid = (binding as FormDataBinding).id
      }
      return formBuilderApi.execute(selectedTemplateId as number, bid, outputFormat)
    },
    onSuccess: (exec) => {
      setExecResult(exec)
      qc.invalidateQueries({ queryKey: ['form-executions', selectedTemplateId] })
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
            <TextField
              label="Paste JSON data"
              multiline rows={8} fullWidth
              value={manualJson}
              onChange={(e) => setManualJson(e.target.value)}
              placeholder='{ "policy_number": "POL123", "customer_name": "Sai" }'
            />
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
            <Alert severity="info">Save the binding first; you can edit the SQL query in the binding settings.</Alert>
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

              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Button onClick={() => setStep(2)}>Back</Button>
                <Button
                  variant="contained"
                  startIcon={executeMut.isPending ? <CircularProgress size={16} /> : <PlayArrowOutlined />}
                  onClick={() => executeMut.mutate()}
                  disabled={executeMut.isPending || selectedTemplate?.status === 'draft'}
                >
                  {executeMut.isPending ? 'Executing…' : 'Execute'}
                </Button>
              </Box>

              {selectedTemplate?.status === 'draft' && (
                <Alert severity="warning">Template must be saved (status = configured) before execution.</Alert>
              )}

              {execResult && <ExecutionResultCard exec={execResult} />}
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
// Execution result card
// ─────────────────────────────────────────────────────────────

function ExecutionResultCard({ exec }: { exec: FormExecution }) {
  const outputJson = exec.output_json ? JSON.parse(exec.output_json) : null

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {exec.status === 'completed'
          ? <CheckCircleOutline color="success" />
          : <ErrorOutline color="error" />}
        <Typography fontWeight={600}>{exec.status === 'completed' ? 'Execution complete' : 'Execution failed'}</Typography>
        <Chip label={exec.output_format} size="small" sx={{ ml: 'auto' }} />
      </Box>

      {exec.error_message && <Alert severity="error" sx={{ mb: 1 }}>{exec.error_message}</Alert>}

      {exec.output_file_path && (
        <Button
          startIcon={<CloudDownload />}
          href={`/api/form-builder/outputs/${exec.output_file_path.split(/[/\\]/).pop()}`}
          target="_blank"
          variant="outlined"
          size="small"
          sx={{ mb: 1 }}
        >
          Download {exec.output_format === 'fillable' ? 'Fillable PDF' : 'PDF'}
        </Button>
      )}

      {exec.output_format === 'api' && outputJson && (
        <Box
          component="pre"
          sx={{ bgcolor: 'grey.100', borderRadius: 1, p: 2, overflow: 'auto', fontSize: 12, maxHeight: 300 }}
        >
          {JSON.stringify(outputJson, null, 2)}
        </Box>
      )}

      {exec.output_format === 'ui' && outputJson && (
        <LiveFormPreview spec={outputJson} />
      )}
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
            gridTemplateColumns: sec.columns === 2 ? '1fr 1fr' : '1fr',
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
                    <TableCell>
                      {exec.output_file_path && (
                        <Button
                          size="small"
                          href={`/api/form-builder/outputs/${exec.output_file_path.split(/[/\\]/).pop()}`}
                          target="_blank"
                          startIcon={<CloudDownload />}
                        >
                          Download
                        </Button>
                      )}
                      {exec.error_message && (
                        <Tooltip title={exec.error_message}>
                          <ErrorOutline color="error" fontSize="small" />
                        </Tooltip>
                      )}
                    </TableCell>
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
                  {exec.output_file_path && (
                    <Button
                      size="small"
                      href={`/api/form-builder/outputs/${exec.output_file_path.split(/[/\\]/).pop()}`}
                      target="_blank"
                      startIcon={<CloudDownload />}
                    >
                      Download
                    </Button>
                  )}
                  {exec.bulk_run_id && (
                    <Chip label="bulk" size="small" variant="outlined" sx={{ ml: 0.5 }} />
                  )}
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
