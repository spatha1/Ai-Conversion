import { useState, useEffect } from 'react'
import {
  Box, Typography, TextField, Button, Paper, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Tooltip,
  CircularProgress, Alert, Divider, alpha, Collapse, ToggleButton,
  ToggleButtonGroup, Popover, List, ListItemButton, ListItemText,
  RadioGroup, FormControlLabel, Radio,
} from '@mui/material'
import {
  AutoAwesomeOutlined,
  ContentCopyOutlined,
  DownloadOutlined,
  RestoreOutlined,
  CheckOutlined,
  ExpandMoreOutlined,
  ExpandLessOutlined,
  AddCircleOutlineOutlined,
  MergeTypeOutlined,
  CodeOutlined,
  WarningAmberOutlined,
  UploadFileOutlined,
  LibraryBooksOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentMapperApi, agentMapperTemplatesApi } from '@/api'
import type { AgentMapperTemplate } from '@/types'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type {
  AgentMapperResult,
  AgentMapperSession,
  AgentMapperGridRow,
  AgentMapperIntent,
  AgentMapperMappingModel,
} from '@/types'

// ── Type / Rule chip colors ───────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  base:       { bg: '#64748b22', text: '#64748b' },
  derived:    { bg: '#f59e0b22', text: '#b45309' },
  user:       { bg: '#0ea5e922', text: '#0369a1' },
  iterator:   { bg: '#1e3a5f22', text: '#1e3a5f' },
  reference:  { bg: '#8b5cf622', text: '#6d28d9' },
  extra:      { bg: '#10b98122', text: '#059669' },
  controller: { bg: '#6b728022', text: '#374151' },
  risk:       { bg: '#ef444422', text: '#b91c1c' },
  existing:   { bg: '#e2e8f022', text: '#94a3b8' },
}
const RULE_COLORS: Record<string, { bg: string; text: string }> = {
  OOTB:        { bg: '#22c55e22', text: '#15803d' },
  conditional: { bg: '#f9731622', text: '#c2410c' },
  direct:      { bg: '#3b82f622', text: '#1d4ed8' },
  reference:   { bg: '#8b5cf622', text: '#6d28d9' },
  extra:       { bg: '#10b98122', text: '#059669' },
  existing:    { bg: '#e2e8f022', text: '#94a3b8' },
}

function TypeChip({ label }: { label: string }) {
  const c = TYPE_COLORS[label] ?? { bg: '#e5e7eb', text: '#374151' }
  return (
    <Chip label={label} size="small"
      sx={{ bgcolor: c.bg, color: c.text, fontWeight: 700, fontSize: '0.68rem', height: 20, border: 'none' }} />
  )
}
function RuleChip({ label }: { label: string }) {
  const c = RULE_COLORS[label] ?? { bg: '#e5e7eb', text: '#374151' }
  return (
    <Chip label={label} size="small"
      sx={{ bgcolor: c.bg, color: c.text, fontWeight: 600, fontSize: '0.68rem', height: 20, border: 'none' }} />
  )
}

function CopyButton({ text, size = 'small' }: { text: string; size?: 'small' | 'medium' }) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'} arrow>
      <IconButton size={size} onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true); setTimeout(() => setCopied(false), 1500)
        })
      }}>
        {copied
          ? <CheckOutlined sx={{ fontSize: 16, color: 'success.main' }} />
          : <ContentCopyOutlined sx={{ fontSize: 16 }} />}
      </IconButton>
    </Tooltip>
  )
}

// ── Collapsible Section ───────────────────────────────────────────────────────
function Section({
  title, badge, children, defaultOpen = true,
}: {
  title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, bgcolor: isDark ? 'rgba(255,255,255,.03)' : '#fafafa' }}>
      <Box
        onClick={() => setOpen(!open)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25,
          cursor: 'pointer', userSelect: 'none',
          '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.02)' },
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.disabled', flex: 1 }}>
          {title}
        </Typography>
        {badge && (
          <Chip label={badge} size="small"
            sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: alpha(tokens.indigo600, 0.1), color: tokens.indigo700, border: 'none' }} />
        )}
        <IconButton size="small" sx={{ p: 0.25 }}>
          {open ? <ExpandLessOutlined sx={{ fontSize: 16 }} /> : <ExpandMoreOutlined sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
          {children}
        </Box>
      </Collapse>
    </Paper>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mb: 0.5 }}>
      <Typography variant="caption" color="text.disabled" sx={{ minWidth: 90, fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{value}</Typography>
    </Box>
  )
}

// ── Intent card (one per parsed intent) ──────────────────────────────────────
function IntentCard({ intent, lowConfidence }: { intent: AgentMapperIntent; lowConfidence?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, mb: 1, borderColor: lowConfidence ? 'warning.main' : undefined }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 700 }}>
          {intent.field || 'field'}
        </Typography>
        {lowConfidence && (
          <Chip
            icon={<WarningAmberOutlined sx={{ fontSize: '12px !important' }} />}
            label="entity inferred"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }}
          />
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <KV label="entity" value={<TypeChip label={intent.entity} />} />
        <KV label="field"  value={intent.field  || '—'} />
        <KV label="source" value={intent.source || '—'} />
        <KV label="type"   value={<TypeChip label={intent.type} />} />
        <KV label="lob"    value={intent.lob} />
      </Box>
    </Paper>
  )
}

// ── Mapping model card ────────────────────────────────────────────────────────
function ModelCard({ model }: { model: AgentMapperMappingModel }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, mb: 1 }}>
      <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 700, mb: 0.5, display: 'block' }}>
        template: <strong>{model.template_name}</strong>
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <KV label="target"  value={model.target ?? '(none — controller)'} />
        <KV label="inherit" value={model.inherit ?? '—'} />
        <KV label="include" value={model.include.join(', ') || '—'} />
        <KV label="lob"     value={model.lob} />
        {model.key_source  && <KV label="key_source"  value={model.key_source} />}
        {model.name_source && <KV label="name_source" value={model.name_source} />}
        {model.desc_source && <KV label="desc_source" value={model.desc_source} />}
      </Box>
    </Paper>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentMapperPage() {
  const activeProject = useAppStore((s) => s.activeProject)
  const qc = useQueryClient()

  const [instruction, setInstruction]       = useState('')
  const [mode, setMode]                     = useState<'create' | 'extend'>('create')
  const [existingXml, setExistingXml]       = useState('')
  const [result, setResult]                 = useState<AgentMapperResult | null>(null)
  const [libAnchor, setLibAnchor]           = useState<HTMLElement | null>(null)
  const [entityOverride, setEntityOverride] = useState<string | null>(null)
  const [pendingAutoRun, setPendingAutoRun] = useState(false)

  // Pre-populate Extend mode if Template Library pushed a base XML via sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('agentmapper_base_xml')
    if (saved) {
      setExistingXml(saved)
      setMode('extend')
      sessionStorage.removeItem('agentmapper_base_xml')
    }
    // Pre-populate instruction from Mapping Assistant "Use in Mapper" click
    const prefill = sessionStorage.getItem('agentmapper_intent_prefill')
    if (prefill) {
      setInstruction(prefill)
      setPendingAutoRun(true)
      sessionStorage.removeItem('agentmapper_intent_prefill')
    }
  }, [])

  // Auto-run once instruction state is committed from prefill
  useEffect(() => {
    if (pendingAutoRun && instruction.trim()) {
      setPendingAutoRun(false)
      generate.mutate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoRun, instruction])

  const generate = useMutation({
    mutationFn: () =>
      agentMapperApi.generate(
        instruction.trim(),
        activeProject?.id,
        mode === 'extend' ? existingXml.trim() || undefined : undefined,
        mode,
      ),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['agent-mapper-sessions'] })
      // Persist last result for Mapping Assistant context
      try {
        const ctx = {
          entity:        data.mapping_models[0]?.entity,
          field:         data.mapping_models[0]?.field,
          template_name: data.mapping_models[0]?.template_name,
          generated_xml: data.generated_xml,
          grid:          data.grid,
        }
        sessionStorage.setItem('agentmapper_last_result', JSON.stringify(ctx))
      } catch { /* quota exceeded — ignore */ }
    },
  })

  const { data: sessions = [] } = useQuery<AgentMapperSession[]>({
    queryKey: ['agent-mapper-sessions'],
    queryFn: () => agentMapperApi.sessions(20),
  })

  const { data: libraryTemplates = [] } = useQuery<AgentMapperTemplate[]>({
    queryKey: ['agent-mapper-templates-picker'],
    queryFn:  () => agentMapperTemplatesApi.list(),
    enabled:  mode === 'extend',
  })

  const restore = useMutation({
    mutationFn: (id: number) => agentMapperApi.session(id),
    onSuccess: (detail) => {
      setInstruction(detail.user_input)
      setResult({
        session_id:     detail.id,
        user_input:     detail.user_input,
        parsed_intents: detail.parsed_intents,
        mapping_models: detail.mapping_models,
        generated_xml:  detail.generated_xml,
        grid:           detail.grid,
        mode:           'create',
        warnings:       [],
        tokens_in:      0,
        tokens_out:     0,
        latency_ms:     0,
        prompt_text:    '',
        response_text:  '',
      })
    },
  })

  const handleDownload = () => {
    if (!result) return
    const first = result.mapping_models[0]
    const blob = new Blob([result.generated_xml], { type: 'application/xml' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${first.lob}_${first.entity}_${first.template_name}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const fieldCount = result?.parsed_intents.length ?? 0

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <AutoAwesomeOutlined sx={{ color: tokens.indigo600, fontSize: 28 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>Agent Mapper</Typography>
          <Typography variant="caption" color="text.secondary">DCT Extract Manuscript Generator</Typography>
        </Box>
      </Box>

      {/* ① Instruction + mode — full width */}
      <Section title="1 · User Instruction">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
          <Typography variant="caption" color="text.disabled" fontWeight={600}>Mode:</Typography>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => { if (v) setMode(v) }}>
            <ToggleButton value="create" sx={{ gap: 0.5, fontSize: '0.75rem', px: 1.5 }}>
              <AddCircleOutlineOutlined sx={{ fontSize: 14 }} />Create New
            </ToggleButton>
            <ToggleButton value="extend" sx={{ gap: 0.5, fontSize: '0.75rem', px: 1.5 }}>
              <MergeTypeOutlined sx={{ fontSize: 14 }} />Extend Existing
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Collapse in={mode === 'extend'}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Button
              component="label"
              size="small"
              variant="outlined"
              startIcon={<UploadFileOutlined sx={{ fontSize: 15 }} />}
              sx={{ fontSize: '0.75rem' }}
            >
              Upload XML
              <input
                type="file"
                accept=".xml"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = (ev) => setExistingXml((ev.target?.result as string) ?? '')
                  reader.readAsText(file)
                  e.target.value = ''
                }}
              />
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<LibraryBooksOutlined sx={{ fontSize: 15 }} />}
              sx={{ fontSize: '0.75rem' }}
              onClick={(e) => setLibAnchor(e.currentTarget)}
            >
              From Library
            </Button>

            {existingXml && (
              <Typography variant="caption" color="text.secondary">
                {existingXml.length.toLocaleString()} chars loaded
              </Typography>
            )}
          </Box>

          {/* Template library picker popover */}
          <Popover
            open={Boolean(libAnchor)}
            anchorEl={libAnchor}
            onClose={() => setLibAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <Box sx={{ p: 1, minWidth: 280, maxWidth: 360 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, px: 1, color: 'text.disabled', textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.07em' }}>
                Template Library
              </Typography>
              {libraryTemplates.length === 0 ? (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 1, py: 1 }}>
                  No templates — seed OOTB first on Mapper Templates page.
                </Typography>
              ) : (
                <List dense disablePadding sx={{ mt: 0.5, maxHeight: 320, overflow: 'auto' }}>
                  {libraryTemplates.map((tpl) => (
                    <ListItemButton
                      key={tpl.id}
                      sx={{ borderRadius: 1.5, mb: 0.25 }}
                      onClick={() => {
                        setExistingXml(tpl.template_xml)
                        setLibAnchor(null)
                      }}
                    >
                      <ListItemText
                        primary={tpl.name}
                        secondary={[tpl.lob, tpl.entity, tpl.mapping_type].filter(Boolean).join(' · ')}
                        primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: 600 }}
                        secondaryTypographyProps={{ fontSize: '0.7rem' }}
                      />
                      {!tpl.is_ootb && (
                        <Chip label="custom" size="small"
                          sx={{ height: 16, fontSize: '0.6rem', ml: 0.5, bgcolor: alpha(tokens.indigo600, 0.1), color: tokens.indigo700, border: 'none' }} />
                      )}
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Box>
          </Popover>
          <TextField
            fullWidth multiline minRows={4}
            label="Existing Manuscript XML"
            placeholder="Paste your existing <ManuScript>...</ManuScript> here, or upload above"
            value={existingXml}
            onChange={(e) => setExistingXml(e.target.value)}
            sx={{ mb: 1.5, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.82rem' } }}
          />
        </Collapse>

        <TextField
          fullWidth multiline minRows={2}
          placeholder='e.g. "Add VehicleVIN and EffectiveDate to Risk for Auto"'
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && instruction.trim() && !generate.isPending) {
              generate.mutate()
            }
          }}
          sx={{ mb: 1.5, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.9rem' } }}
        />
        <Button
          variant="contained"
          startIcon={generate.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
          disabled={!instruction.trim() || generate.isPending}
          onClick={() => generate.mutate()}
          sx={{ background: `linear-gradient(135deg, ${tokens.indigo600}, ${tokens.violet600})` }}
        >
          {generate.isPending ? 'Generating…' : mode === 'extend' ? 'Extend Manuscript' : 'Generate Manuscript'}
        </Button>

        {generate.isError && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {(generate.error as Error)?.message ?? 'Generation failed'}
          </Alert>
        )}
      </Section>

      {result && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Entity confirmation — shown when any intent has low_confidence */}
          {result.mapping_models.some((m) => m.low_confidence) && (
            <Alert
              severity="warning"
              sx={{ borderRadius: 2 }}
              action={
                <Button
                  size="small" color="warning" variant="outlined"
                  disabled={!entityOverride}
                  onClick={() => {
                    if (!entityOverride) return
                    const overridden = instruction.replace(
                      /\b(Account|Policy|Risk|Coverage)\b/gi,
                      entityOverride,
                    ) + (instruction.match(/\b(Account|Policy|Risk|Coverage)\b/i)
                      ? '' : ` for ${entityOverride}`)
                    setInstruction(overridden.trim())
                    setEntityOverride(null)
                    generate.mutate()
                  }}
                >
                  Confirm & Re-run
                </Button>
              }
            >
              <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
                Entity was inferred — please confirm:
              </Typography>
              <RadioGroup row value={entityOverride ?? ''} onChange={(e) => setEntityOverride(e.target.value)}>
                {['Policy', 'Risk', 'Coverage', 'Account'].map((e) => (
                  <FormControlLabel key={e} value={e} control={<Radio size="small" />}
                    label={<Typography variant="caption" fontWeight={600}>{e}</Typography>} />
                ))}
              </RadioGroup>
            </Alert>
          )}

          {/* Warnings banner */}
          {result.warnings.length > 0 && (
            <Alert
              severity="warning"
              icon={<WarningAmberOutlined fontSize="small" />}
              sx={{ borderRadius: 2, '& .MuiAlert-message': { width: '100%' } }}
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {result.warnings.map((w, i) => (
                  <Chip
                    key={i}
                    label={w}
                    size="small"
                    sx={{ bgcolor: 'warning.light', color: 'warning.dark', fontWeight: 600, fontSize: '0.72rem', height: 22 }}
                  />
                ))}
              </Box>
            </Alert>
          )}

          {/* ② Intent Extraction */}
          <Section
            title="2 · Intent Extraction (AI)"
            badge={`gpt-4o-mini · ${result.latency_ms}ms · ${result.tokens_in}↑ ${result.tokens_out}↓ · ${fieldCount} field${fieldCount !== 1 ? 's' : ''}`}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {result.parsed_intents.map((intent, i) => (
                <Box key={i} sx={{ flex: '1 1 320px', minWidth: 0 }}>
                  <IntentCard
                    intent={intent}
                    lowConfidence={result.mapping_models[i]?.low_confidence}
                  />
                </Box>
              ))}
            </Box>
          </Section>

          {/* ③ Mapping Model */}
          <Section
            title="3 · Mapping Model (Rule Engine)"
            badge={`${result.mapping_models.length} template${result.mapping_models.length !== 1 ? 's' : ''} · mode: ${result.mode}`}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {result.mapping_models.map((model, i) => (
                <Box key={i} sx={{ flex: '1 1 320px', minWidth: 0 }}>
                  <ModelCard model={model} />
                </Box>
              ))}
            </Box>
          </Section>

          {/* ④ Generated XML */}
          <Section title="4 · Generated Manuscript XML">
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 1 }}>
              <CopyButton text={result.generated_xml} />
              <Tooltip title="Download XML" arrow>
                <IconButton size="small" onClick={handleDownload}>
                  <DownloadOutlined sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
            <Box
              component="pre"
              sx={{
                fontFamily: 'monospace', fontSize: '0.78rem',
                bgcolor: 'background.default', border: '1px solid',
                borderColor: 'divider', borderRadius: 1.5,
                p: 1.5, overflow: 'auto', maxHeight: 360, m: 0, whiteSpace: 'pre',
              }}
            >
              {result.generated_xml}
            </Box>
          </Section>

          {/* ⑤ Mapping Grid */}
          {result.grid.length > 0 && (
            <Section title="5 · Mapping Grid" badge={`${result.grid.length} fieldMap${result.grid.length !== 1 ? 's' : ''}`}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {['Entity', 'Target Table', 'Target Field', 'Source', 'Type', 'Rule', 'Inherit'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.grid.map((row: AgentMapperGridRow, i) => (
                      <TableRow key={i} hover sx={row.type === 'existing' ? { opacity: 0.6 } : undefined}>
                        <TableCell sx={{ fontSize: '0.78rem' }}>{row.entity}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{row.target_table}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{row.target_field}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>
                          <Tooltip title={row.source} arrow><span>{row.source}</span></Tooltip>
                        </TableCell>
                        <TableCell><TypeChip label={row.type} /></TableCell>
                        <TableCell><RuleChip label={row.rule} /></TableCell>
                        <TableCell sx={{ fontSize: '0.72rem', color: 'text.disabled', fontFamily: 'monospace' }}>
                          {row.inherit ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Section>
          )}

          {/* ⑥ AI Traces */}
          {(result.prompt_text || result.response_text) && (
            <Section title="6 · AI Trace" defaultOpen={false} badge={`${result.tokens_in + result.tokens_out} tokens`}>
              <Box sx={{ display: 'grid', gridTemplateColumns: result.prompt_text && result.response_text ? '1fr 1fr' : '1fr', gap: 2 }}>
                {result.prompt_text && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <CodeOutlined sx={{ fontSize: 13, color: 'text.disabled' }} />
                      <Typography variant="caption" color="text.disabled" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '0.66rem', flex: 1 }}>
                        Prompt sent to model
                      </Typography>
                      <CopyButton text={result.prompt_text} />
                    </Box>
                    <Box component="pre" sx={{
                      fontFamily: 'monospace', fontSize: '0.72rem', bgcolor: 'background.default',
                      border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25,
                      overflow: 'auto', maxHeight: 260, m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {result.prompt_text}
                    </Box>
                  </Box>
                )}
                {result.response_text && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <CodeOutlined sx={{ fontSize: 13, color: 'text.disabled' }} />
                      <Typography variant="caption" color="text.disabled" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '0.66rem', flex: 1 }}>
                        Raw model response
                      </Typography>
                      <CopyButton text={result.response_text} />
                    </Box>
                    <Box component="pre" sx={{
                      fontFamily: 'monospace', fontSize: '0.72rem', bgcolor: 'background.default',
                      border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25,
                      overflow: 'auto', maxHeight: 260, m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {result.response_text}
                    </Box>
                  </Box>
                )}
              </Box>
            </Section>
          )}
        </Box>
      )}

      {/* ⑦ History — full width */}
      {sessions.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.disabled' }}>
            7 · History (last 20)
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mt: 1.5, borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['#', 'LOB', 'Entity', 'Template', 'Field', 'Time', ''].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>{s.id}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>{s.lob ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>{s.entity ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{s.mapping_type ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Tooltip title={s.field ?? ''} arrow><span>{s.field ?? '—'}</span></Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                      {new Date(s.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Restore" arrow>
                        <IconButton size="small" disabled={restore.isPending} onClick={() => restore.mutate(s.id)}>
                          <RestoreOutlined sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  )
}
