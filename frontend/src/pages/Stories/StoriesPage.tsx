/**
 * StoriesPage — Development Hub
 *
 * Input modes: Manual / JIRA / ADO batch import
 * AI pipeline: Call A (parse/consolidate) → Call B (use case extraction) → Call C (model grouping)
 * Features: Save & History, Export SQL, Update Clarity, Refine, Data Model gated steps
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Button, TextField, Paper, Chip, CircularProgress,
  Alert, Stack, IconButton, Tooltip, Accordion, AccordionSummary,
  AccordionDetails, Divider, alpha, Card, CardContent,
  ToggleButtonGroup, ToggleButton, Drawer, List, ListItem,
  ListItemText, ListItemSecondaryAction, Select, MenuItem,
  FormControl, InputLabel, Dialog, DialogTitle, DialogContent,
  DialogActions, LinearProgress, Stepper, Step, StepLabel,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, AutoAwesomeOutlined, ExpandMoreOutlined,
  CodeOutlined, DashboardCustomizeOutlined,
  FactCheckOutlined, WarningAmberOutlined, InfoOutlined,
  CloudDownloadOutlined, TextFieldsOutlined, LinkOutlined,
  VerifiedOutlined, ErrorOutlined, SaveOutlined, HistoryOutlined,
  FileDownloadOutlined, PsychologyOutlined, CheckCircleOutlined,
  RefreshOutlined, CloseOutlined, NoteAddOutlined, SchemaOutlined,
  PlayArrowOutlined, LockOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { storiesApi, integrationsApi, connectionsApi } from '@/api'
import { tokens } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import type {
  StoryInput, ExtractedUseCase, StoryAnalysisResult,
  ParsedStory, StoryConflict, SavedAnalysisOut, DataModel, SourceConnection,
} from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  high:   tokens.red600   ?? '#DC2626',
  medium: tokens.amber600 ?? '#D97706',
  low:    tokens.sky600   ?? '#0284C7',
}

const TYPE_LABELS: Record<string, string> = {
  trend:          'Trend',
  aggregation:    'Aggregation',
  reconciliation: 'Reconciliation',
  detail:         'Detail View',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StoryCard({
  story, index, onChange, onDelete, canDelete,
}: {
  story: StoryInput
  index: number
  onChange: (updated: StoryInput) => void
  onDelete: () => void
  canDelete: boolean
}) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2, borderRadius: 2.5,
        borderColor: isDark ? 'divider' : alpha(tokens.indigo600 ?? '#4F46E5', 0.18),
        bgcolor: isDark ? 'background.paper' : alpha(tokens.indigo600 ?? '#4F46E5', 0.02),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Story {index + 1}
        </Typography>
        {canDelete && (
          <Tooltip title="Remove story">
            <IconButton size="small" onClick={onDelete} color="error" sx={{ p: 0.5 }}>
              <DeleteOutlined sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Stack spacing={1.25}>
        <TextField label="Title" size="small" fullWidth value={story.title}
          onChange={(e) => onChange({ ...story, title: e.target.value })}
          placeholder="As a user, I want to…" />
        <TextField label="Description" size="small" fullWidth multiline minRows={2}
          value={story.description}
          onChange={(e) => onChange({ ...story, description: e.target.value })}
          placeholder="Describe the business need…" />
        <TextField label="Acceptance Criteria (optional)" size="small" fullWidth multiline minRows={1}
          value={story.acceptance_criteria ?? ''}
          onChange={(e) => onChange({ ...story, acceptance_criteria: e.target.value })}
          placeholder="Given… When… Then…" />
      </Stack>
    </Paper>
  )
}

// ── Import section ────────────────────────────────────────────────────────────

function ImportSection({ onImported }: { onImported: (stories: StoryInput[]) => void }) {
  const { activeProject } = useAppStore()
  const { enqueueSnackbar } = useSnackbar()
  const [source, setSource] = useState<'manual' | 'jira' | 'ado'>('manual')
  const [rawIds, setRawIds] = useState('')
  const [failedItems, setFailedItems] = useState<{ resource_id: string; error: string }[]>([])

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', activeProject?.id],
    queryFn:  () => integrationsApi.list(activeProject?.id),
    staleTime: 60_000,
  })
  const jiraConfigured = integrations.some((i) => i.type === 'jira' && i.has_token)
  const adoConfigured  = integrations.some((i) => i.type === 'ado'  && i.has_token)

  const fetchMut = useMutation({
    mutationFn: () => {
      const ids = rawIds.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      if (!ids.length) throw new Error('Enter at least one issue key or work item ID.')
      return storiesApi.fetchExternal({
        source_type: source as 'jira' | 'ado',
        resource_ids: ids,
        project_id: activeProject?.id ?? null,
      })
    },
    onSuccess: (res) => {
      setFailedItems(res.failed)
      if (res.stories.length) {
        onImported(res.stories)
        enqueueSnackbar(
          `Imported ${res.stories.length} ${source.toUpperCase()} ${res.stories.length === 1 ? 'story' : 'stories'}` +
          (res.failed.length ? ` (${res.failed.length} failed)` : ''),
          { variant: res.failed.length ? 'warning' : 'success' }
        )
      } else {
        enqueueSnackbar('No stories could be fetched — check IDs and integration config.', { variant: 'error' })
      }
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Fetch failed', { variant: 'error' }),
  })

  const isConfigured = source === 'jira' ? jiraConfigured : adoConfigured

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, borderColor: 'divider' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Import Stories</Typography>
      <ToggleButtonGroup
        value={source} exclusive
        onChange={(_, v) => { if (v) { setSource(v); setFailedItems([]) } }}
        size="small" fullWidth sx={{ mb: 2 }}
      >
        <ToggleButton value="manual" sx={{ fontSize: '0.75rem', textTransform: 'none', gap: 0.5 }}>
          <TextFieldsOutlined sx={{ fontSize: 15 }} /> Manual
        </ToggleButton>
        <ToggleButton value="jira" sx={{ fontSize: '0.75rem', textTransform: 'none', gap: 0.5 }}>
          <LinkOutlined sx={{ fontSize: 15 }} /> JIRA
        </ToggleButton>
        <ToggleButton value="ado" sx={{ fontSize: '0.75rem', textTransform: 'none', gap: 0.5 }}>
          <LinkOutlined sx={{ fontSize: 15 }} /> Azure DevOps
        </ToggleButton>
      </ToggleButtonGroup>

      {source === 'manual' && (
        <Alert severity="info" icon={<InfoOutlined fontSize="small" />} sx={{ fontSize: '0.8rem' }}>
          Add stories manually using the cards below, or switch to JIRA / ADO to import directly.
        </Alert>
      )}

      {(source === 'jira' || source === 'ado') && (
        <Stack spacing={1.5}>
          {(source === 'jira' ? jiraConfigured : adoConfigured) ? (
            <Chip icon={<VerifiedOutlined />} label={`${source === 'jira' ? 'JIRA' : 'Azure DevOps'} configured in Admin`} color="success" size="small" variant="outlined" />
          ) : (
            <Alert severity="warning" sx={{ fontSize: '0.78rem', py: 0.5 }}>
              {source === 'jira' ? 'JIRA' : 'ADO'} not configured. Go to <strong>Admin → Integrations</strong>.
            </Alert>
          )}
          <TextField
            label={source === 'jira' ? 'Issue Keys' : 'Work Item IDs'}
            size="small" fullWidth value={rawIds}
            onChange={(e) => setRawIds(e.target.value)}
            placeholder={source === 'jira' ? 'PROJ-123, PROJ-124' : '456, 457, 458'}
            helperText="Comma or space-separated. Max 20."
          />
          <Button
            variant="outlined" size="small" fullWidth
            startIcon={fetchMut.isPending ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
            onClick={() => fetchMut.mutate()}
            disabled={fetchMut.isPending || !rawIds.trim() || !isConfigured}
          >
            {fetchMut.isPending ? 'Fetching…' : `Import from ${source === 'jira' ? 'JIRA' : 'Azure DevOps'}`}
          </Button>
        </Stack>
      )}

      {failedItems.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          {failedItems.map((f) => (
            <Alert key={f.resource_id} severity="error" icon={<ErrorOutlined fontSize="small" />} sx={{ fontSize: '0.75rem', py: 0.25 }}>
              <strong>{f.resource_id}</strong>: {f.error}
            </Alert>
          ))}
        </Stack>
      )}
    </Paper>
  )
}

// ── Results sub-components ────────────────────────────────────────────────────

function ParsedStoriesAccordion({ stories }: { stories: ParsedStory[] }) {
  if (!stories.length) return null
  return (
    <Accordion defaultExpanded={false} disableGutters elevation={0}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
        <Typography variant="subtitle2" fontWeight={700}>Parsed Stories ({stories.length})</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {stories.map((ps, i) => (
            <Box key={i}>
              <Typography variant="body2" fontWeight={600} gutterBottom>{ps.title}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {ps.entities.map((e)   => <Chip key={e} label={e} size="small" color="primary"   variant="outlined" />)}
                {ps.metrics.map((m)    => <Chip key={m} label={m} size="small" color="secondary" variant="outlined" />)}
                {ps.dimensions.map((d) => <Chip key={d} label={d} size="small" variant="outlined" />)}
                <Chip label={`⏱ ${ps.time_granularity}`} size="small" variant="outlined" />
                <Chip label={ps.use_case}                 size="small" variant="outlined" />
              </Box>
              {i < stories.length - 1 && <Divider sx={{ mt: 1.5 }} />}
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

function UnifiedIntentAccordion({ intent }: { intent: StoryAnalysisResult['unified_intent'] }) {
  if (!intent) return null
  const sections = [
    { label: 'Entities',    items: intent.entities,         color: 'primary'   as const },
    { label: 'Metrics',     items: intent.metrics,          color: 'secondary' as const },
    { label: 'Dimensions',  items: intent.dimensions,       color: 'default'   as const },
    { label: 'Filters',     items: intent.filters,          color: 'default'   as const },
    { label: 'Granularity', items: intent.time_granularity, color: 'default'   as const },
  ]
  return (
    <Accordion defaultExpanded={false} disableGutters elevation={0}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
        <Typography variant="subtitle2" fontWeight={700}>Unified Intent</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          {sections.map(({ label, items, color }) =>
            items?.length ? (
              <Box key={label}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{label}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {items.map((it) => <Chip key={it} label={it} size="small" color={color} variant="outlined" />)}
                </Box>
              </Box>
            ) : null
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

function ConflictsSection({ conflicts }: { conflicts: StoryConflict[] }) {
  if (!conflicts.length) return null
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <WarningAmberOutlined sx={{ fontSize: 16, color: 'warning.main' }} />
        Conflicts Detected ({conflicts.length})
      </Typography>
      <Stack spacing={1}>
        {conflicts.map((c, i) => (
          <Alert key={i} severity="warning" icon={<WarningAmberOutlined fontSize="small" />}>
            <Typography variant="body2" fontWeight={600}>{c.type.replace(/_/g, ' ')}</Typography>
            <Typography variant="caption">{c.description}</Typography>
          </Alert>
        ))}
      </Stack>
    </Box>
  )
}

function UseCasesReferenceAccordion({ use_cases }: { use_cases: ExtractedUseCase[] }) {
  if (!use_cases.length) return null
  return (
    <Accordion defaultExpanded={false} disableGutters elevation={0}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
        <Typography variant="subtitle2" fontWeight={700}>
          Extracted Use Cases ({use_cases.length}) — reference
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          {use_cases.map((uc, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', py: 0.5 }}>
              <Typography variant="body2" fontWeight={600} sx={{ minWidth: 200 }}>{uc.name}</Typography>
              <Chip
                label={uc.priority.toUpperCase()} size="small"
                sx={{ bgcolor: alpha(PRIORITY_COLORS[uc.priority] ?? '#6B7280', 0.12), color: PRIORITY_COLORS[uc.priority] ?? '#6B7280', fontWeight: 700, fontSize: '0.62rem' }}
              />
              <Chip label={TYPE_LABELS[uc.type] ?? uc.type} size="small" variant="outlined" sx={{ fontSize: '0.62rem' }} />
              {uc.entities.slice(0, 3).map((e) => (
                <Chip key={e} label={e} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.62rem' }} />
              ))}
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

// Detect whether a prompt string is SQL or natural language
function isSqlPrompt(text: string): boolean {
  const t = text.trim().toUpperCase()
  return /^(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|MERGE)\b/.test(t)
}

// ── Data Model constants ───────────────────────────────────────────────────────

const MODEL_TYPE_COLORS: Record<string, string> = {
  history:        tokens.sky600      ?? '#0284C7',
  aggregation:    tokens.emerald600  ?? '#059669',
  summary:        '#0D9488',
  reconciliation: tokens.amber600    ?? '#D97706',
}

const MODEL_TYPE_LABELS: Record<string, string> = {
  history:        'History',
  aggregation:    'Aggregation',
  summary:        'Summary',
  reconciliation: 'Reconciliation',
}

// ── Model step state ──────────────────────────────────────────────────────────

interface SchemaColumn { name: string; type: string; isPk: boolean }
interface SchemaTable  { name: string; schema?: string; columns: SchemaColumn[] }
interface SchemaRelation { parentTable: string; parentCol: string; refTable: string; refCol: string }
interface SchemaContext {
  tableCount: number
  tables:     SchemaTable[]
  relations:  SchemaRelation[]
}

interface ModelStepState {
  devDone:          boolean
  schemaConnId:     number | null
  schemaCollected:  boolean
  schemaCollecting: boolean
  schemaContext:    SchemaContext | null
}

const DEFAULT_STEP_STATE: ModelStepState = {
  devDone: false, schemaConnId: null, schemaCollected: false, schemaCollecting: false, schemaContext: null,
}

// Build a compact SchemaContext from the raw /admin/catalog response
function buildSchemaContext(data: Record<string, unknown>): SchemaContext {
  const byTable: Record<string, SchemaTable> = {}
  for (const col of (data.columns as Array<Record<string, unknown>>) ?? []) {
    const key = col.table_name as string
    if (!byTable[key]) byTable[key] = { name: key, schema: col.table_schema as string | undefined, columns: [] }
    byTable[key].columns.push({
      name:  col.column_name as string,
      type:  (col.data_type as string | undefined) ?? '',
      isPk:  !!(col.is_primary_key),
    })
  }
  return {
    tableCount: ((data.summary as Record<string, unknown>)?.table_count as number) ?? 0,
    tables:     Object.values(byTable),
    relations:  ((data.relations as Array<Record<string, unknown>>) ?? []).map((r) => ({
      parentTable: r.parent_table  as string,
      parentCol:   r.parent_column as string,
      refTable:    r.referenced_table  as string,
      refCol:      r.referenced_column as string,
    })),
  }
}

// Fuzzy entity→table match: table name contains entity word (case-insensitive)
function tableMatchesEntity(tableName: string, entities: string[]): boolean {
  const t = tableName.toLowerCase()
  return entities.some((e) => t.includes(e.toLowerCase()) || e.toLowerCase().includes(t))
}

// ── DataModelCard ─────────────────────────────────────────────────────────────

function DataModelCard({
  model, index, stepState, onStepChange, connections,
}: {
  model: DataModel
  index: number
  stepState: ModelStepState
  onStepChange: (s: ModelStepState) => void
  connections: SourceConnection[]
}) {
  const navigate            = useNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const [devDialogOpen, setDevDialogOpen] = useState(false)
  const typeColor = MODEL_TYPE_COLORS[model.type] ?? (tokens.indigo600 ?? '#4F46E5')

  // ── Schema: fetch catalog from backend ────────────────────────────────────
  const fetchCatalog = async (connId: number, apiBase: string, token: string): Promise<SchemaContext> => {
    const res = await fetch(`${apiBase}/api/admin/catalog/${connId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Catalog fetch failed: HTTP ${res.status}`)
    return buildSchemaContext(await res.json())
  }

  // ── Schema: run full SSE discovery ────────────────────────────────────────
  const runSseDiscovery = async (connId: number, apiBase: string, token: string): Promise<void> => {
    const res = await fetch(`${apiBase}/api/admin/discover/${connId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) throw new Error(`Discovery failed: HTTP ${res.status}`)
    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()
    let done = false
    while (!done) {
      const { value, done: streamDone } = await reader.read()
      done = streamDone
      if (value) {
        const chunk = decoder.decode(value)
        if (chunk.includes('event: done') || chunk.includes('"done"')) done = true
      }
    }
  }

  // ── Collect Schema — check first, collect only if missing ─────────────────
  const handleCollectSchema = async (forceRediscover = false) => {
    if (!stepState.schemaConnId) {
      enqueueSnackbar('Select a connection first', { variant: 'warning' })
      return
    }
    const connId  = stepState.schemaConnId
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'
    const token   = localStorage.getItem('access_token') ?? ''

    onStepChange({ ...stepState, schemaCollecting: true })

    try {
      if (!forceRediscover) {
        // Check if schema already exists
        const ctx = await fetchCatalog(connId, apiBase, token)
        if (ctx.tableCount > 0) {
          onStepChange({ ...stepState, schemaCollecting: false, schemaCollected: true, schemaContext: ctx })
          enqueueSnackbar(`Schema ready — ${ctx.tableCount} tables found`, { variant: 'info' })
          return
        }
      }
      // Run full discovery, then load catalog
      await runSseDiscovery(connId, apiBase, token)
      const ctx = await fetchCatalog(connId, apiBase, token)
      onStepChange({ ...stepState, schemaCollecting: false, schemaCollected: true, schemaContext: ctx })
      enqueueSnackbar(`Schema collected — ${ctx.tableCount} tables, Reports & Dashboards unlocked`, { variant: 'success' })
    } catch {
      onStepChange({ ...stepState, schemaCollecting: false })
      enqueueSnackbar('Schema collection failed — check connection and retry', { variant: 'error' })
    }
  }

  const activeStep = stepState.schemaCollected ? 4 : stepState.devDone ? 1 : 0

  const lockedOverlay = (
    <Box sx={{
      position: 'absolute', inset: 0, borderRadius: 1.5,
      bgcolor: alpha('#9CA3AF', 0.18),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 1,
    }}>
      <Tooltip title="Collect schema first">
        <LockOutlined sx={{ color: 'text.disabled', fontSize: 20 }} />
      </Tooltip>
    </Box>
  )

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, borderLeft: `4px solid ${typeColor}` }}>
      <CardContent>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>{model.name}</Typography>
            <Typography variant="caption" color="text.secondary">{model.grain}</Typography>
          </Box>
          <Chip
            label={MODEL_TYPE_LABELS[model.type] ?? model.type}
            size="small"
            sx={{ bgcolor: alpha(typeColor, 0.12), color: typeColor, fontWeight: 700, fontSize: '0.65rem' }}
          />
        </Box>

        {/* Chips */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          {model.entities.map((e)        => <Chip key={e} label={e} size="small" color="primary"   variant="outlined" sx={{ fontSize: '0.68rem' }} />)}
          {model.metrics.map((m)         => <Chip key={m} label={m} size="small" color="secondary" variant="outlined" sx={{ fontSize: '0.68rem' }} />)}
          {model.derived_metrics.map((d) => <Chip key={d} label={d} size="small" sx={{ fontSize: '0.68rem', bgcolor: alpha('#7C3AED', 0.1), color: '#7C3AED', border: '1px solid', borderColor: alpha('#7C3AED', 0.3) }} />)}
          {model.dimensions.map((d)      => <Chip key={d} label={d} size="small" variant="outlined" sx={{ fontSize: '0.68rem' }} />)}
        </Box>

        {/* Use-case coverage */}
        {model.use_cases.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>Covers:</Typography>
            {model.use_cases.map((uc) => <Chip key={uc} label={uc} size="small" variant="outlined" color="info" sx={{ fontSize: '0.65rem' }} />)}
          </Box>
        )}

        {/* Stepper */}
        <Stepper activeStep={activeStep} sx={{ mb: 2.5 }} alternativeLabel>
          {['Development', 'Collect Schema', 'Reports', 'Dashboards', 'Testing'].map((label) => (
            <Step key={label}><StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: '0.7rem' } }}>{label}</StepLabel></Step>
          ))}
        </Stepper>

        <Stack spacing={2}>
          {/* ── Step 1: Development ─────────────────────────────────── */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
              Step 1 — Development
            </Typography>
            <TextField
              value={model.development_prompt} multiline minRows={3} maxRows={6}
              size="small" fullWidth
              InputProps={{ readOnly: true, sx: { fontSize: '0.73rem', fontFamily: 'monospace' } }}
              sx={{ mb: 1 }}
            />
            {!stepState.devDone ? (
              <Button
                variant="contained" size="small"
                startIcon={<CodeOutlined sx={{ fontSize: 14 }} />}
                onClick={() => navigate('/development', { state: { prefillPrompt: model.development_prompt } })}
                sx={{ bgcolor: tokens.indigo600 ?? '#4F46E5', '&:hover': { bgcolor: tokens.indigo600, filter: 'brightness(0.88)' }, fontSize: '0.74rem', mr: 1 }}
              >
                Run Development
              </Button>
            ) : null}
            <Button
              variant={stepState.devDone ? 'outlined' : 'text'}
              size="small" color={stepState.devDone ? 'success' : 'inherit'}
              startIcon={stepState.devDone ? <CheckCircleOutlined sx={{ fontSize: 14 }} /> : undefined}
              onClick={() => !stepState.devDone && setDevDialogOpen(true)}
              disabled={stepState.devDone}
              sx={{ fontSize: '0.74rem' }}
            >
              {stepState.devDone ? 'Development Complete' : 'Mark Development Done'}
            </Button>
          </Box>

          {/* ── Step 2: Collect Schema ───────────────────────────────── */}
          <Box sx={{ opacity: stepState.devDone ? 1 : 0.45, transition: 'opacity 0.2s', pointerEvents: stepState.devDone ? 'auto' : 'none' }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
              Step 2 — Collect Schema {!stepState.devDone && <Chip label="locked" size="small" sx={{ fontSize: '0.6rem', ml: 0.5, height: 16 }} />}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel sx={{ fontSize: '0.78rem' }}>Connection</InputLabel>
                <Select
                  value={stepState.schemaConnId ?? ''}
                  label="Connection"
                  onChange={(e) => onStepChange({ ...stepState, schemaConnId: e.target.value as number || null })}
                  sx={{ fontSize: '0.78rem' }}
                  disabled={stepState.schemaCollecting}
                >
                  <MenuItem value=""><em>Select connection…</em></MenuItem>
                  {connections.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined" size="small"
                startIcon={stepState.schemaCollecting
                  ? <CircularProgress size={13} />
                  : stepState.schemaCollected
                    ? <CheckCircleOutlined sx={{ fontSize: 14 }} />
                    : <SchemaOutlined sx={{ fontSize: 14 }} />
                }
                onClick={() => handleCollectSchema(false)}
                disabled={stepState.schemaCollecting || !stepState.schemaConnId}
                color={stepState.schemaCollected ? 'success' : 'primary'}
                sx={{ fontSize: '0.74rem' }}
              >
                {stepState.schemaCollecting ? 'Checking…' : stepState.schemaCollected ? 'Schema Ready' : 'Collect Schema'}
              </Button>
              {stepState.schemaCollected && (
                <Tooltip title="Force full re-scan of the database schema">
                  <Button
                    variant="text" size="small" color="inherit"
                    startIcon={<RefreshOutlined sx={{ fontSize: 13 }} />}
                    onClick={() => handleCollectSchema(true)}
                    disabled={stepState.schemaCollecting}
                    sx={{ fontSize: '0.7rem', color: 'text.secondary' }}
                  >
                    Re-collect
                  </Button>
                </Tooltip>
              )}
            </Box>
            {stepState.schemaCollecting && <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />}

            {/* Schema Context Panel */}
            {stepState.schemaContext && stepState.schemaContext.tableCount > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Accordion disableGutters elevation={0}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SchemaOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
                      <Typography variant="caption" fontWeight={700} color="text.secondary">
                        Schema Definitions — {stepState.schemaContext.tableCount} tables
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0.5 }}>
                    <Stack spacing={1}>
                      {stepState.schemaContext.tables.map((tbl) => {
                        const isMatch = tableMatchesEntity(tbl.name, model.entities)
                        return (
                          <Accordion key={tbl.name} disableGutters elevation={0}
                            sx={{
                              border: '1px solid', borderRadius: '6px !important',
                              borderColor: isMatch ? alpha(tokens.emerald600 ?? '#059669', 0.5) : 'divider',
                              bgcolor: isMatch ? alpha(tokens.emerald600 ?? '#059669', 0.04) : 'transparent',
                              '&:before': { display: 'none' },
                            }}
                          >
                            <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 14 }} />} sx={{ minHeight: 32, '& .MuiAccordionSummary-content': { my: 0.25 } }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'monospace', color: isMatch ? (tokens.emerald600 ?? '#059669') : 'text.primary' }}>
                                  {tbl.name}
                                </Typography>
                                {isMatch && <Chip label="matched" size="small" color="success" variant="outlined" sx={{ fontSize: '0.58rem', height: 16 }} />}
                                <Typography variant="caption" color="text.secondary">({tbl.columns.length} cols)</Typography>
                              </Box>
                            </AccordionSummary>
                            <AccordionDetails sx={{ pt: 0, pb: 0.5 }}>
                              <Stack spacing={0.25}>
                                {tbl.columns.map((col) => (
                                  <Box key={col.name} sx={{ display: 'flex', gap: 1, alignItems: 'center', px: 0.5 }}>
                                    {col.isPk && <Chip label="PK" size="small" color="primary" sx={{ fontSize: '0.55rem', height: 14, fontWeight: 700 }} />}
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: col.isPk ? 700 : 400 }}>{col.name}</Typography>
                                    {col.type && <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>{col.type}</Typography>}
                                  </Box>
                                ))}
                              </Stack>
                            </AccordionDetails>
                          </Accordion>
                        )
                      })}
                      {stepState.schemaContext.relations.length > 0 && (
                        <Box sx={{ pt: 0.5 }}>
                          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Relationships ({stepState.schemaContext.relations.length})
                          </Typography>
                          <Stack spacing={0.25}>
                            {stepState.schemaContext.relations.map((r, i) => (
                              <Typography key={i} variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'text.secondary' }}>
                                {r.parentTable}.{r.parentCol} → {r.refTable}.{r.refCol}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Box>
            )}
          </Box>

          {/* ── Step 3: Reports ──────────────────────────────────────── */}
          <Box sx={{ position: 'relative' }}>
            {!stepState.schemaCollected && lockedOverlay}
            <Accordion disableGutters elevation={0}
              sx={{
                border: '1px solid', borderColor: 'divider', borderRadius: '8px !important',
                '&:before': { display: 'none' },
                opacity: stepState.schemaCollected ? 1 : 0.5,
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Step 3 — Reports ({model.reports.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {model.reports.map((report, ri) => (
                    <Paper key={ri} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{report.name}</Typography>
                      {report.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>{report.description}</Typography>
                      )}
                      <TextField
                        value={report.prompt} multiline minRows={2} maxRows={4}
                        size="small" fullWidth
                        InputProps={{ readOnly: true, sx: { fontSize: '0.72rem', fontFamily: 'monospace' } }}
                        sx={{ mb: 1 }}
                      />
                      <Button
                        variant="contained" size="small"
                        startIcon={<PlayArrowOutlined sx={{ fontSize: 14 }} />}
                        onClick={() => navigate('/reports', {
                          state: isSqlPrompt(report.prompt)
                            ? { prefillSql: report.prompt }
                            : { prefillPrompt: report.prompt },
                        })}
                        disabled={!stepState.schemaCollected}
                        sx={{ bgcolor: tokens.emerald600 ?? '#059669', '&:hover': { bgcolor: tokens.emerald600, filter: 'brightness(0.88)' }, fontSize: '0.72rem' }}
                      >
                        Run Report
                      </Button>
                    </Paper>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Box>

          {/* ── Step 4: Dashboard ────────────────────────────────────── */}
          <Box sx={{ position: 'relative' }}>
            {!stepState.schemaCollected && lockedOverlay}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, opacity: stepState.schemaCollected ? 1 : 0.5 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Step 4 — Dashboard
              </Typography>
              <TextField
                value={model.dashboard_prompt} multiline minRows={3} maxRows={6}
                size="small" fullWidth
                InputProps={{ readOnly: true, sx: { fontSize: '0.73rem', fontFamily: 'monospace' } }}
                sx={{ mb: 1 }}
              />
              <Button
                variant="contained" size="small"
                startIcon={<DashboardCustomizeOutlined sx={{ fontSize: 14 }} />}
                onClick={() => navigate('/dashboards', { state: { prefillPrompt: model.dashboard_prompt } })}
                disabled={!stepState.schemaCollected}
                sx={{ bgcolor: tokens.violet600 ?? '#7C3AED', '&:hover': { bgcolor: tokens.violet600, filter: 'brightness(0.88)' }, fontSize: '0.74rem' }}
              >
                Run Dashboard
              </Button>
            </Box>
          </Box>

          {/* ── Step 5: Testing ──────────────────────────────────────── */}
          <Box sx={{ position: 'relative' }}>
            {!stepState.schemaCollected && lockedOverlay}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, opacity: stepState.schemaCollected ? 1 : 0.5 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Step 5 — Testing
              </Typography>
              <TextField
                value={model.testing_prompt} multiline minRows={3} maxRows={6}
                size="small" fullWidth
                InputProps={{ readOnly: true, sx: { fontSize: '0.73rem', fontFamily: 'monospace' } }}
                sx={{ mb: 1 }}
              />
              <Button
                variant="contained" size="small"
                startIcon={<FactCheckOutlined sx={{ fontSize: 14 }} />}
                onClick={() => navigate('/testing', { state: { prefillPrompt: model.testing_prompt } })}
                disabled={!stepState.schemaCollected}
                sx={{ bgcolor: tokens.amber600 ?? '#D97706', '&:hover': { bgcolor: tokens.amber600, filter: 'brightness(0.88)' }, fontSize: '0.74rem' }}
              >
                Run Testing
              </Button>
            </Box>
          </Box>
        </Stack>
      </CardContent>

      {/* Confirm Development Done dialog */}
      <Dialog open={devDialogOpen} onClose={() => setDevDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>Confirm Development Complete</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Confirm that you have built <strong>{model.name}</strong> in the Development module before unlocking the next step.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDevDialogOpen(false)} size="small">Cancel</Button>
          <Button
            variant="contained" color="success" size="small"
            onClick={() => {
              setDevDialogOpen(false)
              onStepChange({ ...stepState, devDone: true })
            }}
          >
            Yes, Mark Complete
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

// ── Session-storage helpers (project-scoped) ─────────────────────────────────

function ssKey(suffix: string, projectId?: number) {
  return `stories_page_${suffix}_${projectId ?? 'none'}`
}

function loadStories(key: string): StoryInput[] {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return [{ title: '', description: '', acceptance_criteria: '' }]
}

function loadResult(key: string): StoryAnalysisResult | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

function loadRefinement(key: string): string {
  try { return sessionStorage.getItem(key) ?? '' } catch { return '' }
}

const BLANK_STORY: StoryInput = { title: '', description: '', acceptance_criteria: '' }

// ── History drawer ────────────────────────────────────────────────────────────

function HistoryDrawer({
  open, onClose, onRestore, activeProjectId,
}: {
  open: boolean
  onClose: () => void
  onRestore: (stories: StoryInput[], result: StoryAnalysisResult) => void
  activeProjectId?: number
}) {
  const { enqueueSnackbar } = useSnackbar()

  const { data: analyses = [], refetch } = useQuery<SavedAnalysisOut[]>({
    queryKey: ['story-analyses', activeProjectId],
    queryFn:  () => storiesApi.listAnalyses(activeProjectId ?? null),
    enabled:  open,
    staleTime: 0,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => storiesApi.deleteAnalysis(id),
    onSuccess: () => { refetch(); enqueueSnackbar('Analysis deleted', { variant: 'info' }) },
    onError: () => enqueueSnackbar('Delete failed', { variant: 'error' }),
  })

  const handleRestore = async (id: number) => {
    try {
      const full = await storiesApi.getAnalysis(id)
      onRestore(full.stories, full.result)
      onClose()
      enqueueSnackbar(`Restored: ${full.title}`, { variant: 'success' })
    } catch {
      enqueueSnackbar('Could not load analysis', { variant: 'error' })
    }
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 380 } }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryOutlined /> Analysis History
        </Typography>
        <IconButton size="small" onClick={onClose}><CloseOutlined fontSize="small" /></IconButton>
      </Box>
      {analyses.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No saved analyses yet.</Typography>
          <Typography variant="caption" color="text.secondary">Run an analysis and click Save to add one.</Typography>
        </Box>
      ) : (
        <List dense disablePadding>
          {analyses.map((a) => (
            <ListItem
              key={a.id}
              divider
              button
              onClick={() => handleRestore(a.id)}
              sx={{ alignItems: 'flex-start', py: 1.5 }}
            >
              <ListItemText
                primary={
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 260 }}>
                    {a.title}
                  </Typography>
                }
                secondary={
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                    <Chip label={`${a.use_case_count} use case${a.use_case_count !== 1 ? 's' : ''}`} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                    {a.model && <Chip label={a.model} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />}
                    <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                      {new Date(a.created_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <Tooltip title="Delete">
                  <IconButton
                    size="small" edge="end" color="error"
                    onClick={(e) => { e.stopPropagation(); deleteMut.mutate(a.id) }}
                    disabled={deleteMut.isPending}
                  >
                    <DeleteOutlined sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}
    </Drawer>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StoriesPage() {
  const { enqueueSnackbar }   = useSnackbar()
  const isDark                = useAppStore((s) => s.themeMode) === 'dark'
  const { activeProject }     = useAppStore()
  const projectId             = activeProject?.id

  // Project-scoped sessionStorage keys
  const ssStories    = ssKey('cards',     projectId)
  const ssResult     = ssKey('result',    projectId)
  const ssRefinement = ssKey('refinement', projectId)

  // Core state — restored from project-scoped sessionStorage
  const [stories, setStories]             = useState<StoryInput[]>(() => loadStories(ssStories))
  const [result,  setResult]              = useState<StoryAnalysisResult | null>(() => loadResult(ssResult))

  // Single model step state (project-scoped sessionStorage)
  const ssModelStep = ssKey('model_step', projectId)
  const [modelStep, setModelStep] = useState<ModelStepState>(() => {
    try {
      const raw = sessionStorage.getItem(ssKey('model_step', projectId))
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return DEFAULT_STEP_STATE
  })

  // Save / history state
  const [saveTitle, setSaveTitle]         = useState('')
  const [isSaved,   setIsSaved]           = useState(false)
  const [historyOpen, setHistoryOpen]     = useState(false)

  // Refine state
  const [refinementText, setRefinementText] = useState<string>(() => loadRefinement(ssRefinement))

  // Clarity state
  const [clarityConnId, setClarityConnId] = useState<number | ''>('')
  const [clarityDone,   setClarityDone]   = useState(false)

  // Persist model step state to project-scoped sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem(ssModelStep, JSON.stringify(modelStep)) } catch { /* ignore */ }
  }, [modelStep, ssModelStep])

  // ── Reset state when project changes ────────────────────────────────────────
  const prevProjectIdRef = useRef(projectId)
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId
      const newSsStories    = ssKey('cards',       projectId)
      const newSsResult     = ssKey('result',      projectId)
      const newSsRefinement = ssKey('refinement',  projectId)
      setStories(loadStories(newSsStories))
      setResult(loadResult(newSsResult))
      setRefinementText(loadRefinement(newSsRefinement))
      setSaveTitle('')
      setIsSaved(false)
      setClarityDone(false)
      setModelStep(DEFAULT_STEP_STATE)
    }
  }, [projectId])

  // Auto-populate save title from first story
  useEffect(() => {
    if (!saveTitle && stories[0]?.title) {
      setSaveTitle(stories[0].title)
    }
  }, [stories]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to project-scoped sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem(ssStories, JSON.stringify(stories)) } catch { /* ignore */ }
  }, [stories, ssStories])

  useEffect(() => {
    try {
      if (result) sessionStorage.setItem(ssResult, JSON.stringify(result))
      else        sessionStorage.removeItem(ssResult)
    } catch { /* ignore */ }
  }, [result, ssResult])

  useEffect(() => {
    try { sessionStorage.setItem(ssRefinement, refinementText) } catch { /* ignore */ }
  }, [refinementText, ssRefinement])

  // Connections for Clarity selector — always fresh so global project/connection changes are reflected
  const { data: connections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn:  () => connectionsApi.list(activeProject?.id),
    staleTime: 0,
  })

  // ── Mutations ───────────────────────────────────────────────────────────────

  const analyzeMut = useMutation({
    mutationFn: (opts?: { refinement?: string; prev?: StoryAnalysisResult }) => {
      const filled = stories.filter((s) => s.title.trim() || s.description.trim())
      if (!filled.length) throw new Error('Add at least one story with a title or description.')
      return storiesApi.analyze(filled, 'gpt-4o-mini', opts?.refinement, opts?.prev ?? null)
    },
    onSuccess: (data, opts) => {
      setResult(data)
      setIsSaved(false)
      setClarityDone(false)
      setModelStep(DEFAULT_STEP_STATE)
      enqueueSnackbar(
        opts?.refinement
          ? `Re-analysis complete — ${data.use_cases.length} use case${data.use_cases.length !== 1 ? 's' : ''} refined`
          : `Analysis complete — ${data.use_cases.length} use case${data.use_cases.length !== 1 ? 's' : ''} extracted`,
        { variant: 'success' }
      )
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Analysis failed', { variant: 'error' }),
  })

  const saveMut = useMutation({
    mutationFn: () => {
      if (!result) throw new Error('No result to save.')
      const title = saveTitle.trim() || `Analysis — ${new Date().toLocaleDateString()}`
      return storiesApi.saveAnalysis({
        title,
        stories_json: JSON.stringify(stories),
        result_json:  JSON.stringify(result),
        project_id:   activeProject?.id ?? null,
        model:        'gpt-4o-mini',
      })
    },
    onSuccess: () => {
      setIsSaved(true)
      enqueueSnackbar('Analysis saved', { variant: 'success' })
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const exportMut = useMutation({
    mutationFn: () => {
      if (!result?.use_cases?.length) throw new Error('No use cases to export.')
      return storiesApi.exportSql(result.use_cases, result.models ?? [])
    },
    onSuccess: () => enqueueSnackbar('SQL exported — check your downloads', { variant: 'success' }),
    onError:   () => enqueueSnackbar('Export failed', { variant: 'error' }),
  })

  const clarityMut = useMutation({
    mutationFn: () => {
      if (!result?.use_cases?.length) throw new Error('No use cases to push.')
      return storiesApi.pushToClarity({
        use_cases:  result.use_cases,
        models:     result.models ?? [],
        conn_id:    clarityConnId !== '' ? clarityConnId : null,
        project_id: activeProject?.id ?? null,
      })
    },
    onSuccess: (data) => {
      setClarityDone(true)
      enqueueSnackbar(
        `Clarity updated — ${data.query_contexts_added} context${data.query_contexts_added !== 1 ? 's' : ''} + ${data.query_examples_added} example${data.query_examples_added !== 1 ? 's' : ''} added`,
        { variant: 'success' }
      )
    },
    onError: () => enqueueSnackbar('Update Clarity failed', { variant: 'error' }),
  })

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const handleNewAnalysis = () => {
    setStories([{ ...BLANK_STORY }])
    setResult(null)
    setRefinementText('')
    setSaveTitle('')
    setIsSaved(false)
    setClarityDone(false)
    setModelStep(DEFAULT_STEP_STATE)
    try {
      sessionStorage.removeItem(ssStories)
      sessionStorage.removeItem(ssResult)
      sessionStorage.removeItem(ssRefinement)
      sessionStorage.removeItem(ssModelStep)
    } catch { /* ignore */ }
  }

  const handleImported = (fetched: StoryInput[]) => {
    setStories((prev) => {
      const hasOnlyBlank = prev.length === 1 && !prev[0].title && !prev[0].description
      return hasOnlyBlank ? fetched : [...prev, ...fetched]
    })
    setResult(null)
    setIsSaved(false)
  }

  const addStory = () => {
    if (stories.length >= 20) {
      enqueueSnackbar('Maximum 20 stories per analysis', { variant: 'warning' })
      return
    }
    setStories((prev) => [...prev, { title: '', description: '', acceptance_criteria: '' }])
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 3 } }}>

      {/* ── Page header ───────────────────────────────────────────── */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Box>
            <Typography variant="h5" fontWeight={800} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesomeOutlined sx={{ color: tokens.indigo600 ?? '#4F46E5' }} />
              Development Hub
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Import from JIRA / Azure DevOps or type stories manually — AI extracts use cases and builds a unified data model.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined" size="small"
              startIcon={<NoteAddOutlined />}
              onClick={handleNewAnalysis}
              sx={{ whiteSpace: 'nowrap' }}
            >
              New Analysis
            </Button>
            <Button
              variant="contained" size="small"
              startIcon={<HistoryOutlined />}
              onClick={() => setHistoryOpen(true)}
              sx={{
                whiteSpace: 'nowrap',
                bgcolor: tokens.indigo600 ?? '#4F46E5',
                '&:hover': { bgcolor: tokens.indigo600 ?? '#4F46E5', filter: 'brightness(0.88)' },
              }}
            >
              Saved Analyses
            </Button>
          </Stack>
        </Box>
      </Box>

      {/* ── Import section ─────────────────────────────────────────── */}
      <Box sx={{ mb: 3 }}>
        <ImportSection onImported={handleImported} />
      </Box>

      {/* ── Story cards (collapsible) ───────────────────────────────── */}
      <Accordion defaultExpanded disableGutters elevation={0}
        sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ px: 2, minHeight: 44 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', pr: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Stories ({stories.length})
            </Typography>
            <Button
              size="small" startIcon={<AddOutlined />}
              onClick={(e) => { e.stopPropagation(); addStory() }}
              variant="outlined" sx={{ minWidth: 0, py: 0.3, px: 1.2, fontSize: '0.75rem' }}
            >
              Add
            </Button>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1.5}>
            {stories.map((story, i) => (
              <StoryCard
                key={i} story={story} index={i}
                onChange={(updated) => setStories((prev) => prev.map((s, idx) => idx === i ? updated : s))}
                onDelete={() => setStories((prev) => prev.filter((_, idx) => idx !== i))}
                canDelete={stories.length > 1}
              />
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* ── Analyze button ─────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 4 }}>
        <Button
          variant="contained" size="large"
          startIcon={analyzeMut.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
          onClick={() => analyzeMut.mutate(undefined)}
          disabled={analyzeMut.isPending}
          sx={{
            background: `linear-gradient(135deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})`,
            px: 4,
          }}
        >
          {analyzeMut.isPending ? 'Analyzing…' : 'Analyze Stories'}
        </Button>
      </Box>

      {/* ── Results ────────────────────────────────────────────────── */}
      {result && (
        <Stack spacing={3}>

          {/* Trace metadata row */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label={`${result.tokens_in + result.tokens_out} tokens`} size="small" icon={<InfoOutlined />} variant="outlined" />
            <Chip label={`${(result.latency_ms / 1000).toFixed(1)}s`} size="small" variant="outlined" />
            <Chip label={`${result.use_cases.length} use case${result.use_cases.length !== 1 ? 's' : ''}`} size="small" color="primary" variant="outlined" />
            {result.conflicts.length > 0 && (
              <Chip label={`${result.conflicts.length} conflict${result.conflicts.length !== 1 ? 's' : ''}`}
                size="small" color="warning" variant="outlined" icon={<WarningAmberOutlined />} />
            )}
          </Box>

          {/* ── Save panel ─────────────────────────────────────────── */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: isDark ? 'divider' : alpha(tokens.indigo600 ?? '#4F46E5', 0.2) }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 1 }}>
              Save Analysis
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                size="small" placeholder="Analysis title…"
                value={saveTitle} onChange={(e) => { setSaveTitle(e.target.value); setIsSaved(false) }}
                sx={{ flex: 1, minWidth: 200, '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
              />
              <Button
                variant="contained" size="small"
                startIcon={isSaved ? <CheckCircleOutlined /> : (saveMut.isPending ? <CircularProgress size={13} color="inherit" /> : <SaveOutlined />)}
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || isSaved}
                color={isSaved ? 'success' : 'primary'}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {isSaved ? '✓ Saved' : 'Save Analysis'}
              </Button>
              <Button
                variant="outlined" size="small"
                startIcon={exportMut.isPending ? <CircularProgress size={13} /> : <FileDownloadOutlined />}
                onClick={() => exportMut.mutate()}
                disabled={exportMut.isPending}
              >
                Export SQL
              </Button>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel sx={{ fontSize: '0.78rem' }}>Clarity Connection</InputLabel>
                <Select
                  value={clarityConnId}
                  label="Clarity Connection"
                  onChange={(e) => { setClarityConnId(e.target.value as number | ''); setClarityDone(false) }}
                  sx={{ fontSize: '0.78rem' }}
                >
                  <MenuItem value=""><em>Global (no connection)</em></MenuItem>
                  {connections.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined" size="small"
                startIcon={clarityDone ? <CheckCircleOutlined /> : (clarityMut.isPending ? <CircularProgress size={13} /> : <PsychologyOutlined />)}
                onClick={() => clarityMut.mutate()}
                disabled={clarityMut.isPending || clarityDone}
                color={clarityDone ? 'success' : 'primary'}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {clarityDone ? '✓ Clarity Updated' : 'Update Clarity'}
              </Button>
            </Box>
          </Paper>

          <ParsedStoriesAccordion stories={result.parsed_stories} />
          <UnifiedIntentAccordion intent={result.unified_intent} />
          <ConflictsSection conflicts={result.conflicts} />

          <UseCasesReferenceAccordion use_cases={result.use_cases} />

          {/* ── Project Data Model ───────────────────────────────── */}
          {result.models?.[0] && (
            <Box>
              <Divider sx={{ mb: 2.5 }} />
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={700}>Project Data Model</Typography>
                <Typography variant="body2" color="text.secondary">
                  Complete each step in order — collect schema before running reports or dashboards.
                </Typography>
              </Box>
              <DataModelCard
                model={result.models[0]}
                index={0}
                stepState={modelStep}
                onStepChange={setModelStep}
                connections={connections}
              />
            </Box>
          )}

          {/* ── Refine section ───────────────────────────────────── */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, borderColor: 'divider', mt: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <RefreshOutlined sx={{ fontSize: 18, color: tokens.indigo600 ?? '#4F46E5' }} />
              Refine Analysis
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Review the use cases above, then type feedback below to re-analyze with your guidance.
            </Typography>
            <TextField
              fullWidth multiline minRows={2} size="small"
              value={refinementText}
              onChange={(e) => setRefinementText(e.target.value)}
              placeholder='e.g. "Focus more on monthly trends, add a reconciliation use case, split Customer Insights into two"'
              sx={{ mb: 1.5 }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained" size="small"
                startIcon={analyzeMut.isPending ? <CircularProgress size={13} color="inherit" /> : <RefreshOutlined />}
                onClick={() => analyzeMut.mutate({ refinement: refinementText, prev: result })}
                disabled={analyzeMut.isPending || !refinementText.trim()}
                sx={{ background: `linear-gradient(135deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})` }}
              >
                {analyzeMut.isPending ? 'Re-analyzing…' : 'Re-analyze with Feedback'}
              </Button>
            </Box>
          </Paper>
        </Stack>
      )}

      {/* ── History drawer ─────────────────────────────────────────── */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        activeProjectId={activeProject?.id}
        onRestore={(s, r) => {
          setStories(s)
          setResult(r)
          setIsSaved(true)
          setSaveTitle('')
          setClarityDone(false)
        }}
      />
    </Box>
  )
}
