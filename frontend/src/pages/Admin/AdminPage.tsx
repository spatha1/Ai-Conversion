import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Tabs, Tab, Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Divider, Paper, IconButton, Tooltip, LinearProgress,
  CircularProgress, alpha, Accordion, AccordionSummary, AccordionDetails,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Checkbox, FormControlLabel, Switch, List, ListItem, MenuItem, Stack, Alert, Collapse,
  FormControl, InputLabel, Select, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import {
  SearchOutlined, AutoAwesomeOutlined,
  DeleteOutlined, ClearOutlined, TableChartOutlined,
  AccountTreeOutlined, LinkOutlined, DataObjectOutlined,
  EmailOutlined, SaveOutlined, QuizOutlined, EditOutlined,
  ExpandMoreOutlined, ExpandLessOutlined, CheckCircleOutlined, WarningOutlined,
  KeyOutlined, BarChartOutlined, SchemaOutlined, ContentCopyOutlined,
  VisibilityOutlined, GridOnOutlined,
  FileUploadOutlined, FileDownloadOutlined, SmartToyOutlined,
  SendOutlined, CloseOutlined, InfoOutlined, TimelineOutlined,
  AddOutlined, CheckOutlined, FeedbackOutlined, RefreshOutlined,
  BugReportOutlined, StarOutlined, TipsAndUpdatesOutlined, FilterAltOutlined,
  HelpOutlineOutlined, ThumbUpOutlined, FilterListOutlined,
  AttachFileOutlined, DescriptionOutlined, HowToVoteOutlined,
  ThumbDownOutlined, DragHandleOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { adminApi, queryApi, psApi, integrationsApi, connectionsApi, feedbackApi, approvalRequestsApi, approvalWorkflowsApi, projectMembersApi, projectsApi, debugSettingsApi } from '@/api'
import type { IntegrationConfig, ApprovalRequest, ApprovalWorkflow, WorkflowStep } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { Catalog, PromptTemplate, AIReadiness, AIContextSummary, QueryExample, AITraceEntry, CatalogRelationRow, AISuggestedRelation, FeedbackEntry, DebugSetting, DebugLevel, DebugTraceRecord } from '@/types'

// ─── Prompt Templates Tab ────────────────────────────────────────────────────
const TEMPLATE_CATEGORIES = [
  'mapping', 'report', 'ps', 'dev', 'admin', 'admin_enrich', 'dev_brd',
  'dashboard', 'dashboard_widget', 'dashboard_sql',
  'testing', 'agent',
  'knowledge',
  'story_analyzer_parse', 'story_analyzer_usecases', 'story_analyzer_models',
]

// Which module uses each prompt category — displayed as a hint in the table
const CATEGORY_USED_BY: Record<string, string> = {
  mapping:                  'Conversion → Mapping tab — SQL generation',
  report:                   'Conversion → Report tab — NL to SQL',
  ps:                       'Conversion → PS Support — AI chat agent',
  dev:                      'Conversion → Development — SQL plan generation',
  admin:                    'Conversion → Admin — Schema AI context queries',
  admin_enrich:             'Conversion → Admin — Schema AI enrichment chat',
  dev_brd:                  'Conversion → Development — BRD acceptance criteria',
  dashboard:                'Dashboards → Generate from intent',
  dashboard_widget:         'Dashboards → Regenerate single widget',
  dashboard_sql:            'Dashboards → Generate from SQL query',
  testing:                  'Testing → AI generate test cases',
  agent:                    'AI Agents → Pipeline role boundary & decision instructions',
  knowledge:                'SAI Knowledge → ask_sai_answer (Ask SAI response format) | knowledge_processor (KB entry structuring)',
  story_analyzer_parse:     'Development Hub → Call A: parse & consolidate stories into unified intent',
  story_analyzer_usecases:  'Development Hub → Call B: extract distinct use cases + 4 prompts each',
  story_analyzer_models:    'Development Hub → Call C: group use cases into a single consolidated data model',
}

const PLACEHOLDER_CHIPS = [
  { label: '{{schema}}',          hint: 'Full schema: tables, columns, FK relations, descriptions' },
  { label: '{{table_list}}',      hint: 'Comma-separated list of table names' },
  { label: '{{query_examples}}',  hint: 'Saved query examples for this connection' },
  { label: '{{query_context}}',   hint: 'Free-text query context set in Admin' },
  { label: '{{metadata}}',        hint: 'Business metadata / column descriptions' },
  { label: '{{relations}}',       hint: 'FK relationships only' },
]

function PromptTemplatesTab({ connId }: { connId?: number }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [catFilter, setCatFilter]   = useState<string | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [locked, setLocked]         = useState(true)   // true = view-only; false = editable
  const [editTarget, setEditTarget] = useState<PromptTemplate | null>(null)
  const [form, setForm] = useState({ name: '', description: '', category: '', content: '', example_output: '' })
  const contentRef = useRef<HTMLTextAreaElement | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['prompt-templates', catFilter],
    queryFn: () => adminApi.listPromptTemplates(catFilter),
  })

  const saveMut = useMutation({
    mutationFn: () => editTarget
      ? adminApi.updatePromptTemplate(editTarget.id, form)
      : adminApi.createPromptTemplate(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompt-templates'] })
      setDialogOpen(false)
      enqueueSnackbar(editTarget ? 'Template updated' : 'Template created', { variant: 'success' })
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      adminApi.updatePromptTemplate(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompt-templates'] }),
  })

  const openView = (t: PromptTemplate) => {
    setEditTarget(t)
    setForm({ name: t.name, description: t.description ?? '', category: t.category ?? '', content: t.content, example_output: t.example_output ?? '' })
    setLocked(true)
    setDialogOpen(true)
  }

  const openNew = () => {
    setEditTarget(null)
    setForm({ name: '', description: '', category: '', content: '', example_output: '' })
    setLocked(false)
    setDialogOpen(true)
  }

  const insertPlaceholder = (placeholder: string) => {
    const ta = contentRef.current
    if (!ta) {
      setForm((f) => ({ ...f, content: f.content + placeholder }))
      return
    }
    const start = ta.selectionStart ?? ta.value.length
    const end   = ta.selectionEnd   ?? ta.value.length
    const newContent = ta.value.slice(0, start) + placeholder + ta.value.slice(end)
    setForm((f) => ({ ...f, content: newContent }))
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + placeholder.length
    })
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <SmartToyOutlined color="primary" sx={{ flexShrink: 0 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>Prompt Templates</Typography>
        <Button size="small" variant="contained" startIcon={<EditOutlined />} onClick={openNew}>
          New Template
        </Button>
      </Box>

      {/* Category filter chips */}
      <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
        <Chip label="All" size="small" onClick={() => setCatFilter(undefined)} color={!catFilter ? 'primary' : 'default'} variant={!catFilter ? 'filled' : 'outlined'} sx={{ fontSize: '0.72rem' }} />
        {TEMPLATE_CATEGORIES.map((c) => (
          <Chip key={c} label={c} size="small"
            color={catFilter === c ? 'primary' : 'default'}
            variant={catFilter === c ? 'filled' : 'outlined'}
            onClick={() => setCatFilter(c === catFilter ? undefined : c)}
            sx={{ fontSize: '0.72rem' }} />
        ))}
      </Box>

      {isLoading ? <CircularProgress size={24} /> : (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 200 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 180 }}>Category / Used By</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 120 }} align="center">Content</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 80 }} align="center">Active</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 100 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                    No templates — click "New Template" to add one
                  </TableCell>
                </TableRow>
              )}
              {templates.map((t) => (
                <TableRow key={t.id} hover sx={{ cursor: 'pointer' }} onClick={() => openView(t)}>
                  {/* Name */}
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>{t.name}</Typography>
                  </TableCell>

                  {/* Category */}
                  <TableCell>
                    {t.category ? (
                      <Box>
                        <Chip label={t.category} size="small" sx={{ fontSize: '0.688rem', height: 20, mb: 0.5 }} />
                        {CATEGORY_USED_BY[t.category] && (
                          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.65rem', lineHeight: 1.3 }}>
                            {CATEGORY_USED_BY[t.category]}
                          </Typography>
                        )}
                      </Box>
                    ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                  </TableCell>

                  {/* Description */}
                  <TableCell>
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                      {t.description || <span style={{ color: '#aaa' }}>No description</span>}
                    </Typography>
                  </TableCell>

                  {/* Content preview — char count */}
                  <TableCell align="center">
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                      {t.content.length} chars
                    </Typography>
                    {t.example_output && (
                      <Typography variant="caption" color="success.main" sx={{ fontSize: '0.62rem', display: 'block', textAlign: 'center' }}>
                        + example
                      </Typography>
                    )}
                  </TableCell>

                  {/* Active */}
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      size="small" checked={t.is_active}
                      onChange={(e) => toggleActiveMut.mutate({ id: t.id, is_active: e.target.checked })}
                    />
                  </TableCell>

                  {/* Actions — no delete (templates are tool properties) */}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="View / Edit">
                      <IconButton size="small" onClick={() => openView(t)}>
                        <EditOutlined sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* ── Unified view/edit dialog ─────────────────────────── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {editTarget ? form.name : 'New Prompt Template'}
            </Typography>
            {editTarget && form.category && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                <Chip label={form.category} size="small" sx={{ fontSize: '0.688rem', height: 18 }} />
                {CATEGORY_USED_BY[form.category] && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {CATEGORY_USED_BY[form.category]}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          {/* Lock/unlock toggle — only shown for existing templates */}
          {editTarget && (
            locked ? (
              <Tooltip title="Unlock to edit this template">
                <Button size="small" variant="outlined" color="warning" startIcon={<EditOutlined />}
                  onClick={() => setLocked(false)}>
                  Edit
                </Button>
              </Tooltip>
            ) : (
              <Chip label="Editing" size="small" color="warning" variant="outlined"
                sx={{ fontSize: '0.72rem', fontWeight: 700 }} />
            )
          )}
        </DialogTitle>

        <DialogContent dividers sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Name + Category + Description — hidden when locked (shown in title already) */}
          {!locked && (
            <>
              <TextField label="Name" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                fullWidth size="small" required />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField label="Category" value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  size="small" sx={{ flex: 1 }} select>
                  <MenuItem value="">—</MenuItem>
                  {TEMPLATE_CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>
                      <Box>
                        <Typography variant="body2">{c}</Typography>
                        {CATEGORY_USED_BY[c] && <Typography variant="caption" color="text.disabled">{CATEGORY_USED_BY[c]}</Typography>}
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
                <TextField label="Description" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  fullWidth size="small" sx={{ flex: 3 }} />
              </Box>
            </>
          )}

          {/* Prompt content + response context side by side */}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            {/* Left: Prompt Content */}
            <Box sx={{ flex: 1 }}>
              {!locked && (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
                  <Typography variant="caption" color="text.disabled" sx={{ alignSelf: 'center', mr: 0.5 }}>
                    Insert:
                  </Typography>
                  {PLACEHOLDER_CHIPS.map(({ label, hint }) => (
                    <Tooltip key={label} title={hint} placement="top">
                      <Chip label={label} size="small" variant="outlined" color="primary"
                        onClick={() => insertPlaceholder(label)}
                        sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: 22, cursor: 'pointer' }} />
                    </Tooltip>
                  ))}
                </Box>
              )}
              <TextField
                label="Prompt Content"
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                fullWidth multiline minRows={14} size="small"
                inputRef={contentRef}
                disabled={locked}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                helperText={locked
                  ? 'Click "Edit" to unlock and modify this template'
                  : 'Click a chip above to insert a placeholder — it will be auto-filled with live connection data at runtime'}
              />
            </Box>

            {/* Right: Response Context */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary"
                sx={{ display: 'block', mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
                Response Context
              </Typography>
              <TextField
                label="Sample / Expected Response (reference only)"
                value={form.example_output}
                onChange={(e) => setForm((f) => ({ ...f, example_output: e.target.value }))}
                fullWidth multiline minRows={14} size="small"
                disabled={locked}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                helperText={locked
                  ? 'Paste an expected AI response here as a reference for future admins.'
                  : 'Paste a sample AI response here — used for reference only, not sent to the AI.'}
                sx={{ '& .MuiOutlinedInput-root': { borderColor: locked ? undefined : 'warning.main' } }}
              />
            </Box>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>
            {locked ? 'Close' : 'Cancel'}
          </Button>
          {!locked && (
            <Button variant="contained" onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !form.name || !form.content}>
              {saveMut.isPending ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
              {editTarget ? 'Save Changes' : 'Create'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─── AI Intelligence Tab ─────────────────────────────────────────────────────
function AIIntelligenceTab({ connId }: { connId?: number }) {
  const { data: readiness, isLoading: loadingR, refetch: refetchR } = useQuery<AIReadiness>({
    queryKey: ['ai-readiness', connId],
    queryFn: () => adminApi.getReadiness(connId!),
    enabled: connId != null,
  })

  const { data: context, isLoading: loadingC } = useQuery<AIContextSummary>({
    queryKey: ['ai-context', connId],
    queryFn: () => adminApi.getAiContext(connId!),
    enabled: connId != null,
  })

  const invalidateMut = useMutation({
    mutationFn: () => adminApi.invalidateCtx(connId!),
    onSuccess: () => { refetchR() },
  })

  const [readinessOpen, setReadinessOpen] = useState(true)
  const [contextOpen,   setContextOpen]   = useState(true)

  if (!connId) {
    return <Typography color="text.disabled">Select a connection to view AI intelligence.</Typography>
  }

  const score = readiness?.readiness_score ?? 0
  const scoreColor = score >= 0.8 ? '#10b981' : score >= 0.5 ? '#f59e0b' : '#ef4444'
  const scoreLabel = score >= 0.8 ? 'Ready' : score >= 0.5 ? 'Partial' : 'Needs Setup'

  const metrics = readiness ? [
    { label: 'Tables with description', value: readiness.tables_with_description, total: readiness.tables_total },
    { label: 'Columns with embeddings', value: readiness.columns_with_embeddings, total: readiness.tables_total * 5 },
    { label: 'FK relations',            value: readiness.fk_relations,            total: Math.max(readiness.fk_relations, 10) },
    { label: 'Query examples',          value: readiness.query_examples,          total: Math.max(readiness.query_examples, 10) },
    { label: 'Active prompt templates', value: readiness.active_prompt_templates, total: Math.max(readiness.active_prompt_templates, 5) },
  ] : []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── 1. AI Readiness ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: readinessOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setReadinessOpen((v) => !v)}
        >
          {readinessOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <AutoAwesomeOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>AI Readiness</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {readiness && (
              <Chip
                label={`${Math.round(score * 100)}% — ${scoreLabel}`}
                size="small" variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem', borderColor: scoreColor, color: scoreColor }}
              />
            )}
            <Tooltip title="Refresh score">
              <IconButton size="small" onClick={() => refetchR()} disabled={loadingR}>
                <SearchOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Button size="small" variant="outlined" onClick={() => invalidateMut.mutate()} disabled={invalidateMut.isPending}>
              Refresh Cache
            </Button>
          </Box>
        </Box>
        <Collapse in={readinessOpen}>
          <Box sx={{ p: 2 }}>
            {loadingR ? <CircularProgress size={24} /> : readiness ? (
              <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                {/* Score gauge */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <CircularProgress variant="determinate" value={score * 100} size={80} thickness={6} sx={{ color: scoreColor }} />
                    <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography variant="caption" fontWeight={800} sx={{ color: scoreColor, fontSize: '0.95rem' }}>
                        {Math.round(score * 100)}%
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="caption" fontWeight={700} sx={{ color: scoreColor }}>{scoreLabel}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', fontSize: '0.65rem' }}>
                    {readiness.tables_total} tables<br />{readiness.fk_relations} FK relations
                  </Typography>
                </Box>
                {/* Progress bars */}
                <Box sx={{ flex: 1 }}>
                  {metrics.map(({ label, value, total }) => (
                    <Box key={label} sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption">{label}</Typography>
                        <Typography variant="caption" fontWeight={700}>{value} / {total}</Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min((value / Math.max(total, 1)) * 100, 100)}
                        sx={{ height: 5, borderRadius: 3 }}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Typography variant="caption" color="text.disabled">No readiness data yet. Run Schema Discovery first.</Typography>
            )}
          </Box>
        </Collapse>
      </Paper>

      {/* ── 2. Context Preview ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: contextOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setContextOpen((v) => !v)}
        >
          {contextOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <DataObjectOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Context Preview</Typography>
          {context && (
            <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
              <Chip label={`${context.table_count} tables`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
              <Chip label={`${context.column_count} columns`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
              <Chip
                label={context.has_query_context ? 'context set' : 'no context'}
                size="small" color={context.has_query_context ? 'success' : 'default'} variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Box>
          )}
        </Box>
        <Collapse in={contextOpen}>
          <Box sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              This is what all AI modules receive as context for this connection.
            </Typography>
            {loadingC ? <CircularProgress size={20} /> : context ? (
              <Grid container spacing={2}>
                {[
                  { label: 'Tables',           value: context.table_count },
                  { label: 'Columns',          value: context.column_count },
                  { label: 'Relations',        value: context.relation_count },
                  { label: 'Metadata entries', value: context.metadata_count },
                  { label: 'Query examples',   value: context.example_count },
                  { label: 'Active templates', value: context.active_template_count },
                ].map(({ label, value }) => (
                  <Grid key={label} item xs={6} sm={4} md={2}>
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, textAlign: 'center' }}>
                      <Typography variant="h6" fontWeight={800}>{value}</Typography>
                      <Typography variant="caption" color="text.secondary">{label}</Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Typography variant="caption" color="text.disabled">
                No context data. Run Schema Discovery to populate.
              </Typography>
            )}
          </Box>
        </Collapse>
      </Paper>

    </Box>
  )
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────
interface SseLine { type: string; msg: string }

async function streamPost(
  url: string,
  body: unknown,
  onEvent: (evt: SseLine) => void,
): Promise<void> {
  const token = useAppStore.getState().user?.token
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).detail || `Request failed (${res.status})`)
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try { onEvent(JSON.parse(line.slice(6))) } catch { /* ignore */ }
      }
    }
  }
}

// ─── Log line component ───────────────────────────────────────────────────────
function LogLine({ type, msg }: SseLine) {
  const colors: Record<string, string> = {
    success: '#10b981', done: '#10b981',
    error: '#ef4444',
    warn: '#f59e0b', warning: '#f59e0b',
    progress: '#60a5fa',
    info: '#94a3b8',
  }
  const color = colors[type] ?? '#94a3b8'
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 0.25 }}>
      <Box component="span" sx={{ color: '#475569', fontSize: '0.688rem', flexShrink: 0, mt: '1px' }}>{ts}</Box>
      <Box component="span" sx={{ color, fontSize: '0.75rem', fontFamily: 'monospace' }}>{msg}</Box>
    </Box>
  )
}

// ─── Overview Report ──────────────────────────────────────────────────────────
function CatalogOverview({ catalog }: { catalog: Catalog }) {
  const cols = catalog.columns ?? []
  const rels = catalog.relations ?? []
  const samples = (catalog as any).samples_list ?? []

  // col count + PK per table
  const colCount: Record<string, number> = {}
  const hasPK: Record<string, boolean> = {}
  cols.forEach((c) => {
    const k = `${(c as any).table_schema || 'dbo'}.${c.table_name}`
    colCount[k] = (colCount[k] || 0) + 1
    if (c.is_primary_key) hasPK[k] = true
  })

  // row count from samples
  const rowCount: Record<string, number> = {}
  samples.forEach((s: any) => {
    const k = `${s.table_schema || 'dbo'}.${s.table_name}`
    rowCount[k] = s.row_count || 0
    rowCount[s.table_name] = s.row_count || 0
  })

  // FK set
  const hasFKTable = new Set<string>()
  rels.forEach((r) => { hasFKTable.add(r.parent_table); hasFKTable.add(r.referenced_table) })

  // nullable counts
  const nullableCount: Record<string, { nullable: number; total: number }> = {}
  cols.forEach((c) => {
    const k = `${(c as any).table_schema || 'dbo'}.${c.table_name}`
    if (!nullableCount[k]) nullableCount[k] = { nullable: 0, total: 0 }
    nullableCount[k].total++
    if ((c.is_nullable as any) !== false && (c.is_nullable as any) !== 'NO') nullableCount[k].nullable++
  })

  // type distribution
  const typeCount: Record<string, number> = {}
  cols.forEach((c) => {
    const t = (c.data_type || 'unknown').toLowerCase()
    typeCount[t] = (typeCount[t] || 0) + 1
  })

  const allTables = Object.keys(colCount).sort()
  const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1])
  const maxTypeCount = sortedTypes[0]?.[1] || 1

  const noPKTables = allTables.filter((k) => !hasPK[k])
  const highNullable = allTables
    .map((k) => ({
      table: k,
      pct: Math.round(((nullableCount[k]?.nullable || 0) / (nullableCount[k]?.total || 1)) * 100),
    }))
    .filter((x) => x.pct > 50)
    .sort((a, b) => b.pct - a.pct)

  if (!cols.length) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <SchemaOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography color="text.disabled">No catalog data yet — run Collect Schema first.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Table Summary */}
      <Box>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <TableChartOutlined fontSize="small" color="primary" />
          Table Summary
          <Chip label={`${allTables.length} tables · ${cols.length} columns · ${samples.length} sampled`} size="small" sx={{ ml: 1 }} />
        </Typography>
        <Box sx={{ overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Table</TableCell>
                <TableCell align="right">Cols</TableCell>
                <TableCell align="right">Rows</TableCell>
                <TableCell align="center">PK</TableCell>
                <TableCell align="center">FK Ref</TableCell>
                <TableCell align="right">Nullable %</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {allTables.map((k) => {
                const tableName = k.split('.').pop() ?? k
                const rc = rowCount[k] != null ? rowCount[k].toLocaleString()
                  : rowCount[tableName] != null ? rowCount[tableName].toLocaleString() : '—'
                const nc = nullableCount[k] || { nullable: 0, total: 1 }
                const pct = Math.round((nc.nullable / nc.total) * 100)
                const pctColor = pct > 50 ? 'error.main' : pct > 25 ? 'warning.main' : 'success.main'
                return (
                  <TableRow key={k} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.813rem', fontWeight: 600 }}>{k}</TableCell>
                    <TableCell align="right">{colCount[k]}</TableCell>
                    <TableCell align="right">{rc}</TableCell>
                    <TableCell align="center">
                      {hasPK[k]
                        ? <Chip label="PK" size="small" color="primary" />
                        : <Chip label="none" size="small" variant="outlined" sx={{ opacity: 0.4 }} />}
                    </TableCell>
                    <TableCell align="center">
                      {hasFKTable.has(tableName) && <Chip label="FK" size="small" color="secondary" />}
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{ width: 60, height: 6, borderRadius: 3, bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': { bgcolor: pctColor } }}
                        />
                        <Typography variant="caption" sx={{ color: pctColor, fontWeight: 700, minWidth: 32 }}>
                          {pct}%
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      </Box>

      {/* Column Type Distribution */}
      <Box>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <BarChartOutlined fontSize="small" color="secondary" />
          Column Type Distribution
          <Chip label={`${Object.keys(typeCount).length} distinct types`} size="small" sx={{ ml: 1 }} />
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {sortedTypes.map(([type, cnt]) => {
            const pct = Math.round((cnt / maxTypeCount) * 100)
            const totalPct = Math.round((cnt / cols.length) * 100)
            return (
              <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', minWidth: 120, fontWeight: 600 }}>
                  {type}
                </Typography>
                <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 8, overflow: 'hidden' }}>
                  <Box sx={{
                    width: `${pct}%`, height: '100%', borderRadius: 1,
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.7),
                    transition: 'width 0.4s ease',
                  }} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60, textAlign: 'right' }}>
                  {cnt} <span style={{ opacity: 0.6 }}>({totalPct}%)</span>
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Box>

      {/* PK Coverage + High Nullable side by side */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <KeyOutlined fontSize="small" sx={{ color: 'warning.main' }} />
              PK Coverage
            </Typography>
            {noPKTables.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'success.main' }}>
                <CheckCircleOutlined fontSize="small" />
                <Typography variant="body2">All tables have a primary key</Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'warning.main', mb: 1 }}>
                  <WarningOutlined fontSize="small" />
                  <Typography variant="body2">{noPKTables.length} table{noPKTables.length > 1 ? 's' : ''} without a primary key</Typography>
                </Box>
                {noPKTables.map((k) => (
                  <Chip key={k} label={k} size="small" variant="outlined" color="warning" sx={{ mr: 0.5, mb: 0.5 }} />
                ))}
              </>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <WarningOutlined fontSize="small" sx={{ color: 'error.main' }} />
              High-Nullable Tables <Typography variant="caption" color="text.secondary">&gt;50% nullable</Typography>
            </Typography>
            {highNullable.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'success.main' }}>
                <CheckCircleOutlined fontSize="small" />
                <Typography variant="body2">No tables with &gt;50% nullable columns</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {highNullable.map((x) => (
                  <Box key={x.table} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{x.table}</Typography>
                    <Chip label={`${x.pct}%`} size="small" color="error" variant="outlined" />
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}

// ─── Metadata Editor ──────────────────────────────────────────────────────────
interface AiMessage { role: 'user' | 'assistant'; content: string }
interface PendingUpdate {
  table_name: string; column_name?: string | null
  description?: string; business_context?: string
  aliases?: string; synonyms?: string[]
}
interface EditRow {
  description?: string; aliases?: string; synonyms?: string; business_context?: string
}

/** Returns 0 (none) – 3 (full) based on how many key RAG fields are populated */
function _confidence(col: any): number {
  let score = 0
  if (col.description)      score++
  if (col.aliases)          score++
  if (col.synonyms && col.synonyms !== '[]') score++
  return score
}

function MetadataEditor({ connId, onClose }: { connId: number; onClose: () => void }) {
  const { enqueueSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const importInputRef  = useRef<HTMLInputElement>(null)
  const aiChatEndRef    = useRef<HTMLDivElement>(null)
  const docUploadRef      = useRef<HTMLInputElement>(null)
  const tableFileInputRef = useRef<HTMLInputElement>(null)

  const [editMap, setEditMap] = useState<Record<string, EditRow>>({})
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [tableDescMap, setTableDescMap] = useState<Record<string, string>>({})
  const [aiGeneratingTable, setAiGeneratingTable] = useState<string | null>(null)

  // AI panel state
  const [aiOpen, setAiOpen]               = useState(false)
  const [aiHistory, setAiHistory]         = useState<AiMessage[]>([])
  const [aiInput, setAiInput]             = useState('')
  const [aiPending, setAiPending]         = useState(false)
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[] | null>(null)
  const [docUploading, setDocUploading]   = useState(false)
  // Table selection phase — shown before first AI question
  const [selectionPhase, setSelectionPhase] = useState(false)
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  // Per-table document attachments (table name → File)
  const [tableDocs, setTableDocs] = useState<Record<string, File>>({})
  const [attachingTable, setAttachingTable] = useState<string | null>(null)
  // Session history
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)

  const { data: metaList = [], isLoading } = useQuery({
    queryKey: ['admin-metadata', connId],
    queryFn: () => adminApi.getMetadata(connId),
    enabled: !!connId,
  })

  const saveMutation = useMutation({
    mutationFn: (payload: unknown) => adminApi.bulkMetadata(connId, payload),
    onSuccess: () => {
      enqueueSnackbar('Metadata saved', { variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['admin-metadata', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const applyUpdatesMutation = useMutation({
    mutationFn: (rows: unknown[]) => adminApi.bulkMetadata(connId, { rows }),
    onSuccess: (_data, rows) => {
      enqueueSnackbar('AI suggestions applied to schema', { variant: 'success' })
      // Pre-populate editMap with applied values so fields update immediately
      const newEdits: Record<string, EditRow> = {}
      const tablesToExpand = new Set<string>()
      ;(rows as any[]).forEach((r: any) => {
        if (!r.column_name) return
        const key = `${r.table_name}|${r.column_name}`
        newEdits[key] = {
          description:      r.description      || '',
          aliases:          r.aliases          || '',
          synonyms:         r.synonyms         || '[]',
          business_context: r.business_context || '',
        }
        tablesToExpand.add(r.table_name)
      })
      setEditMap((prev) => ({ ...prev, ...newEdits }))
      setExpandedTables((prev) => { const next = new Set(prev); tablesToExpand.forEach((t) => next.add(t)); return next })
      setPendingUpdates(null)
      queryClient.invalidateQueries({ queryKey: ['admin-metadata', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  // Seed tableDescMap from loaded metadata (rows with column_name === '__table__')
  useEffect(() => {
    const tableRows = (metaList as any[]).filter((m: any) => m.column_name === '__table__')
    if (tableRows.length > 0) {
      setTableDescMap((prev) => {
        const next = { ...prev }
        tableRows.forEach((r: any) => { if (!next[r.table_name]) next[r.table_name] = r.description ?? '' })
        return next
      })
    }
  }, [metaList])

  const isDirty = Object.keys(editMap).length > 0 || Object.values(tableDescMap).some((v) => v.trim())

  const handleSave = () => {
    const colMap: Record<string, any> = {}
    ;(metaList as any[]).forEach((m: any) => { colMap[`${m.table_name}|${m.column_name}`] = m })

    // Column-level rows
    const colRows = Object.entries(editMap).map(([key, edits]) => {
      const orig = colMap[key] || {}
      const [table_name, column_name] = key.split('|')
      return {
        table_name,
        column_name,
        description:      edits.description      ?? orig.description      ?? '',
        aliases:          edits.aliases          ?? orig.aliases          ?? '',
        business_context: edits.business_context ?? orig.business_context ?? '',
        synonyms:         edits.synonyms         ?? orig.synonyms         ?? '[]',
      }
    })

    // Table-level description rows stored as column_name = '__table__'
    const tableRows = Object.entries(tableDescMap)
      .filter(([, desc]) => desc.trim())
      .map(([table_name, desc]) => ({
        table_name,
        column_name: '__table__',
        description: desc,
        aliases: '',
        business_context: '',
        synonyms: '[]',
      }))

    saveMutation.mutate({ rows: [...colRows, ...tableRows] })
  }

  const patchEdit = (rowKey: string, field: keyof EditRow, value: string) =>
    setEditMap((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], [field]: value } }))

  // ── Export JSON ────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const data = await adminApi.exportSchema(connId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `schema-${connId}.json`; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { enqueueSnackbar(e.message, { variant: 'error' }) }
  }

  // ── Import JSON ────────────────────────────────────────────
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await adminApi.importSchema(connId, data)
      enqueueSnackbar('Schema imported successfully', { variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['admin-metadata', connId] })
    } catch (e: any) { enqueueSnackbar(e.message || 'Invalid JSON', { variant: 'error' }) }
    finally { if (importInputRef.current) importInputRef.current.value = '' }
  }

  // ── Session queries ─────────────────────────────────────────
  const { data: sessionList = [], refetch: refetchSessions } = useQuery({
    queryKey: ['enrich-sessions', connId],
    queryFn: () => adminApi.listEnrichSessions(connId),
    enabled: aiOpen,
  })

  const startNewSession = async () => {
    try {
      const sess = await adminApi.createEnrichSession(connId)
      setActiveSessionId(sess.id)
      setAiHistory([])
      setPendingUpdates(null)
      setSelectionPhase(true)
      setSelectedTables(new Set())
      refetchSessions()
    } catch (e: any) {
      enqueueSnackbar(e.message, { variant: 'error' })
    }
  }

  const loadSession = async (sessionId: number) => {
    try {
      const data = await adminApi.getEnrichSession(sessionId)
      setActiveSessionId(data.id)
      setAiHistory(data.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })))
      setPendingUpdates(null)
      setSelectionPhase(false)
      setTimeout(() => aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (e: any) {
      enqueueSnackbar(e.message, { variant: 'error' })
    }
  }

  const deleteSession = async (sessionId: number) => {
    try {
      await adminApi.deleteEnrichSession(sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setAiHistory([])
        setSelectionPhase(true)
        setSelectedTables(new Set())
      }
      refetchSessions()
    } catch (e: any) {
      enqueueSnackbar(e.message, { variant: 'error' })
    }
  }

  // Open dialog: auto-start a new session if none active
  const openAiDialog = async () => {
    setAiOpen(true)
    if (!activeSessionId) {
      try {
        const sess = await adminApi.createEnrichSession(connId)
        setActiveSessionId(sess.id)
        setAiHistory([])
        setPendingUpdates(null)
        setSelectionPhase(true)
      } catch { /* ignore */ }
    }
  }

  // ── Document upload ─────────────────────────────────────────
  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (docUploadRef.current) docUploadRef.current.value = ''
    setDocUploading(true)
    // Show upload message in chat
    const userMsg: AiMessage = { role: 'user', content: `📄 Uploading document: ${file.name}…` }
    setAiHistory((prev) => [...prev, userMsg])
    setSelectionPhase(false)
    setTimeout(() => aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    try {
      const res = await adminApi.enrichFromDocument(connId, file, activeSessionId)
      const summary = `📄 **${res.filename}** processed (${res.char_read.toLocaleString()} chars read)\n\n${res.summary}`
      const assistantMsg: AiMessage = { role: 'assistant', content: summary }
      setAiHistory((prev) => [
        ...prev.slice(0, -1),  // replace "uploading…" with actual content
        { role: 'user', content: `📄 Uploaded: ${file.name}` },
        assistantMsg,
      ])
      if (res.updates && (res.updates as any[]).length > 0) {
        setPendingUpdates(res.updates as PendingUpdate[])
      }
      refetchSessions()
    } catch (err: any) {
      enqueueSnackbar(err.response?.data?.detail || err.message, { variant: 'error' })
      setAiHistory((prev) => prev.slice(0, -1)) // remove "uploading…" message
    } finally {
      setDocUploading(false)
      setTimeout(() => aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  // ── Per-table document attach ───────────────────────────────
  const handleTableDocPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && attachingTable) {
      setTableDocs((prev) => ({ ...prev, [attachingTable]: file }))
    }
    if (tableFileInputRef.current) tableFileInputRef.current.value = ''
    setAttachingTable(null)
  }

  // ── AI enrichment ──────────────────────────────────────────
  const sendAiMessage = async (message: string) => {
    if (!message.trim() || aiPending) return
    const userMsg: AiMessage = { role: 'user', content: message }
    const newHistory = [...aiHistory, userMsg]
    setAiHistory(newHistory)
    setAiInput('')
    setAiPending(true)
    setTimeout(() => aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    try {
      const res = await adminApi.aiEnrich(connId, message, aiHistory, activeSessionId)
      const assistantMsg: AiMessage = { role: 'assistant', content: res.response }
      setAiHistory([...newHistory, assistantMsg])
      if (res.updates && res.updates.length > 0) {
        setPendingUpdates(res.updates as PendingUpdate[])
      }
      // Refresh session list to update title/updated_at
      refetchSessions()
    } catch (e: any) {
      enqueueSnackbar(e.message, { variant: 'error' })
    } finally {
      setAiPending(false)
      setTimeout(() => aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  const handleApplyUpdates = () => {
    if (!pendingUpdates) return
    const rows = pendingUpdates.map((u) => ({
      table_name:       u.table_name,
      column_name:      u.column_name || null,
      description:      u.description      || '',
      business_context: u.business_context || '',
      aliases:          u.aliases          || '',
      synonyms:         u.synonyms ? JSON.stringify(u.synonyms) : '[]',
    }))
    applyUpdatesMutation.mutate(rows)
  }

  // When dialog opens with no session, start one automatically
  useEffect(() => {
    if (aiOpen && !activeSessionId) {
      adminApi.createEnrichSession(connId).then((sess) => {
        setActiveSessionId(sess.id)
        setAiHistory([])
        setPendingUpdates(null)
        setSelectionPhase(true)
        refetchSessions()
      }).catch(() => {})
    }
  }, [aiOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTableSelectionConfirm = async () => {
    if (selectedTables.size === 0) return
    const tableList = Array.from(selectedTables).join(', ')
    setSelectionPhase(false)
    setAiPending(true)

    // Upload any per-table documents first and collect summaries
    const docSummaries: string[] = []
    for (const [tbl, file] of Object.entries(tableDocs)) {
      if (!selectedTables.has(tbl)) continue
      try {
        setAiHistory((prev) => [...prev, { role: 'user', content: `📎 Uploading document for ${tbl}: ${file.name}…` }])
        const res = await adminApi.enrichFromDocument(connId, file, activeSessionId)
        docSummaries.push(`Table **${tbl}** — document "${res.filename}":\n${res.summary}`)
        setAiHistory((prev) => [
          ...prev.slice(0, -1),
          { role: 'user', content: `📎 Attached for ${tbl}: ${file.name}` },
          { role: 'assistant', content: `✅ Document for **${tbl}** processed (${res.char_read.toLocaleString()} chars). I'll use this context during enrichment.` },
        ])
        if (res.updates && (res.updates as any[]).length > 0) {
          setPendingUpdates(res.updates as PendingUpdate[])
        }
      } catch {
        setAiHistory((prev) => prev.slice(0, -1))
      }
    }

    const docContext = docSummaries.length > 0
      ? `\n\nAdditional context from uploaded documents:\n${docSummaries.join('\n\n')}`
      : ''

    setAiPending(false)
    sendAiMessage(
      `The following tables are most commonly used by our business users for reporting and queries: ${tableList}.\n\n` +
      `Please focus metadata enrichment on these tables only. Identify which columns have missing or low-confidence metadata ` +
      `(no description, no synonyms, no business context) and start asking me targeted business questions — ` +
      `one table at a time, starting with the one that has the most gaps.` +
      docContext
    )
    // Auto-expand the selected tables in the editor
    setExpandedTables((prev) => { const next = new Set(prev); selectedTables.forEach((t) => next.add(t)); return next })
  }

  if (isLoading) return <LinearProgress />

  // Group by table — exclude __table__ marker rows (used to store table descriptions)
  const byTable: Record<string, any[]> = {}
  ;(metaList as any[]).forEach((m: any) => {
    if (m.column_name === '__table__') return   // skip table-description marker rows
    const key = m.table_name || 'Unknown'
    ;(byTable[key] = byTable[key] || []).push(m)
  })

  if (!Object.keys(byTable).length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.disabled">No metadata yet — run Collect Schema first.</Typography>
      </Box>
    )
  }

  const tableNames = Object.keys(byTable)

  // AI-generate description for all columns in a table
  const aiGenerateTableDesc = async (table: string) => {
    const cols = byTable[table] ?? []
    if (!cols.length) return
    setAiGeneratingTable(table)
    try {
      const colList = cols.map((c: any) => `${c.column_name} (${c.data_type})`).join(', ')
      const prompt = `Given a database table named "${table}" with columns: ${colList}
Generate a one-sentence plain-English description for each column and a one-sentence table-level description.
Respond with JSON: { "table_description": "...", "columns": { "COL_NAME": "description", ... } }`
      const { chatApi } = await import('@/api')
      const res = await chatApi.send(
        [{ role: 'user', content: prompt }],
        '', 'gpt-4o-mini',
      )
      const json = res.message.match(/\{[\s\S]*\}/)?.[0]
      if (json) {
        const parsed = JSON.parse(json)
        if (parsed.table_description) {
          setTableDescMap((prev) => ({ ...prev, [table]: parsed.table_description }))
        }
        if (parsed.columns) {
          const newEdits: Record<string, EditRow> = {}
          Object.entries(parsed.columns as Record<string, string>).forEach(([col, desc]) => {
            const key = `${table}|${col}`
            newEdits[key] = { ...editMap[key], description: desc }
          })
          setEditMap((prev) => ({ ...prev, ...newEdits }))
          setExpandedTables((prev) => new Set([...prev, table]))
        }
      }
    } catch {
      // silently ignore
    } finally {
      setAiGeneratingTable(null)
    }
  }

  // ── Schema tree panel ───────────────────────────────────────
  const schemaPanel = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, overflow: 'auto', flex: 1, minWidth: 0 }}>
      {tableNames.map((table) => {
        const cols       = byTable[table]
        const isExpanded = expandedTables.has(table)
        const lowConf    = cols.filter((c: any) => _confidence(c) === 0).length
        const partConf   = cols.filter((c: any) => _confidence(c) > 0 && _confidence(c) < 3).length
        return (
          <Accordion
            key={table}
            expanded={isExpanded}
            onChange={(_, expanded) => {
              setExpandedTables((prev) => {
                const next = new Set(prev)
                expanded ? next.add(table) : next.delete(table)
                return next
              })
            }}
            disableGutters
            sx={{ borderRadius: '8px !important', '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1, mr: 1, minWidth: 0 }}>
                {/* Row 1: table name + chips + AI button */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>{table}</Typography>
                  <Chip label={`${cols.length} cols`} size="small" sx={{ height: 18, fontSize: '0.625rem' }} />
                  {lowConf > 0 && <Chip label={`${lowConf} no metadata`} size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />}
                  {partConf > 0 && <Chip label={`${partConf} partial`} size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />}
                  {lowConf === 0 && partConf === 0 && <Chip label="complete" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />}
                  <Tooltip title="AI generate descriptions for this table's columns">
                    <span>
                      <IconButton
                        size="small"
                        color="secondary"
                        onClick={(e) => { e.stopPropagation(); aiGenerateTableDesc(table) }}
                        disabled={aiGeneratingTable === table}
                        sx={{ ml: 'auto', flexShrink: 0 }}
                      >
                        {aiGeneratingTable === table ? <CircularProgress size={13} /> : <AutoAwesomeOutlined sx={{ fontSize: 14 }} />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                {/* Row 2: table description field */}
                <TextField
                  size="small" fullWidth
                  placeholder="Table description (plain-English purpose of this table)"
                  value={tableDescMap[table] ?? ''}
                  onChange={(e) => setTableDescMap((prev) => ({ ...prev, [table]: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ '& .MuiInputBase-root': { fontSize: '0.78rem' } }}
                  InputProps={{ sx: { bgcolor: 'background.paper' } }}
                />
              </Box>
            </AccordionSummary>
            {isExpanded && (
              <AccordionDetails sx={{ pt: 0, overflow: 'auto' }}>
                <Table size="small" sx={{ minWidth: 700 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 140 }}>Column</TableCell>
                      <TableCell sx={{ minWidth: 80 }}>Type</TableCell>
                      <TableCell sx={{ minWidth: 180 }}>
                        <Tooltip title="Plain-English purpose of this column"><span>Description</span></Tooltip>
                      </TableCell>
                      <TableCell sx={{ minWidth: 140 }}>
                        <Tooltip title="How business users commonly refer to this column (comma-separated)"><span>Aliases</span></Tooltip>
                      </TableCell>
                      <TableCell sx={{ minWidth: 180 }}>
                        <Tooltip title="Natural-language synonyms used in queries (comma-separated, improves RAG matching)"><span>Synonyms / Query Terms</span></Tooltip>
                      </TableCell>
                      <TableCell sx={{ width: 60, textAlign: 'center' }}>RAG</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cols.map((col: any) => {
                      const rowKey   = `${col.table_name}|${col.column_name}`
                      const conf     = _confidence(col)
                      const confColor = conf === 0 ? 'error.main' : conf < 3 ? 'warning.main' : 'success.main'
                      const confLabel = conf === 0 ? '✗' : conf < 3 ? '~' : '✓'
                      const synDisplay = (() => {
                        try { return (JSON.parse(col.synonyms || '[]') as string[]).join(', ') } catch { return col.synonyms || '' }
                      })()
                      return (
                        <TableRow key={rowKey} hover sx={{ verticalAlign: 'top' }}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.813rem', fontWeight: 600, pt: 1.25 }}>
                            {col.column_name}
                            {col.is_primary_key && <Chip label="PK" size="small" color="primary" sx={{ ml: 0.5 }} />}
                          </TableCell>
                          <TableCell sx={{ pt: 1.25 }}>
                            <Typography variant="caption" color="text.secondary">{col.data_type}</Typography>
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small" fullWidth multiline maxRows={3}
                              placeholder="What does this column represent?"
                              value={editMap[rowKey]?.description ?? col.description ?? ''}
                              onChange={(e) => patchEdit(rowKey, 'description', e.target.value)}
                              sx={{ '& .MuiInputBase-root': { fontSize: '0.8rem' } }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small" fullWidth
                              placeholder="e.g. emp_id, staff no"
                              value={editMap[rowKey]?.aliases ?? col.aliases ?? ''}
                              onChange={(e) => patchEdit(rowKey, 'aliases', e.target.value)}
                              sx={{ '& .MuiInputBase-root': { fontSize: '0.8rem' } }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small" fullWidth
                              placeholder="e.g. employee number, worker id"
                              value={editMap[rowKey]?.synonyms !== undefined
                                ? (() => { try { return (JSON.parse(editMap[rowKey].synonyms!) as string[]).join(', ') } catch { return editMap[rowKey].synonyms! } })()
                                : synDisplay}
                              onChange={(e) => {
                                const syns = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                                patchEdit(rowKey, 'synonyms', JSON.stringify(syns))
                              }}
                              sx={{ '& .MuiInputBase-root': { fontSize: '0.8rem' } }}
                            />
                          </TableCell>
                          <TableCell align="center" sx={{ pt: 1.25 }}>
                            <Typography variant="caption" fontWeight={700} sx={{ color: confColor }}>{confLabel}</Typography>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </AccordionDetails>
            )}
          </Accordion>
        )
      })}
    </Box>
  )

  // ── AI panel (Dialog — kept for structural reference, rendered below) ─────────
  const aiPanel = aiOpen && (
    <Box
      sx={{
        width: 400, flexShrink: 0,
        border: 1, borderColor: (t) => alpha(t.palette.secondary.main, 0.35),
        borderRadius: 2, display: 'flex', flexDirection: 'column',
        bgcolor: (t) => alpha(t.palette.secondary.main, 0.025),
        overflow: 'hidden', maxHeight: 680,
      }}
    >
      {/* Panel header */}
      <Box sx={{
        px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1,
        bgcolor: (t) => alpha(t.palette.secondary.main, 0.06),
      }}>
        <SmartToyOutlined sx={{ color: 'secondary.main', fontSize: 18 }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>Schema AI Assistant</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.688rem' }}>
            Helping SMEs / BAs enrich metadata for better RAG quality
          </Typography>
        </Box>
        <IconButton size="small" onClick={() => { setAiOpen(false); setSelectionPhase(false) }}>
          <CloseOutlined sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {/* ── Table selection phase ── */}
      {selectionPhase && (
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', p: 2, gap: 1.5 }}>
          <Box>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              Which tables do your business users query most often?
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Select the tables to focus enrichment on. AI will ask targeted questions about missing descriptions, synonyms and business context for these tables only.
            </Typography>
          </Box>
          {/* Select All / Clear */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" sx={{ fontSize: '0.7rem' }}
              onClick={() => setSelectedTables(new Set(tableNames))}>
              Select All
            </Button>
            <Button size="small" variant="outlined" sx={{ fontSize: '0.7rem' }}
              onClick={() => setSelectedTables(new Set())}>
              Clear
            </Button>
            <Chip label={`${selectedTables.size} selected`} size="small" color={selectedTables.size > 0 ? 'secondary' : 'default'} sx={{ ml: 'auto' }} />
          </Box>
          {/* Table checklist */}
          <Box sx={{ flex: 1, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5, px: 1 }}>
            <List dense disablePadding>
              {tableNames.map((t) => {
                const cols       = byTable[t]
                const zeroConf   = cols.filter((c: any) => _confidence(c) === 0).length
                const attachedDoc = tableDocs[t]
                return (
                  <ListItem
                    key={t}
                    disablePadding
                    sx={{ py: 0.25 }}
                    secondaryAction={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 0.5 }}>
                        {attachedDoc && (
                          <Tooltip title={attachedDoc.name}>
                            <Chip
                              icon={<DescriptionOutlined sx={{ fontSize: '0.7rem !important' }} />}
                              label={attachedDoc.name.length > 14 ? attachedDoc.name.slice(0, 12) + '…' : attachedDoc.name}
                              size="small"
                              color="primary"
                              variant="outlined"
                              onDelete={() => setTableDocs((prev) => { const n = { ...prev }; delete n[t]; return n })}
                              sx={{ height: 18, fontSize: '0.58rem', maxWidth: 120 }}
                            />
                          </Tooltip>
                        )}
                        <Tooltip title={attachedDoc ? 'Replace document / image' : 'Attach document or image for this table'}>
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); setAttachingTable(t); setTimeout(() => tableFileInputRef.current?.click(), 0) }}
                            sx={{ color: attachedDoc ? 'primary.main' : 'text.disabled', p: 0.4 }}
                          >
                            <AttachFileOutlined sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                  >
                    <FormControlLabel
                      sx={{ width: '100%', m: 0, pr: attachedDoc ? 18 : 6 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={selectedTables.has(t)}
                          onChange={(e) => setSelectedTables((prev) => {
                            const next = new Set(prev)
                            e.target.checked ? next.add(t) : next.delete(t)
                            return next
                          })}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25 }}>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.8rem' }}>
                            {t}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.688rem' }}>
                            {cols.length} cols
                          </Typography>
                          {zeroConf > 0 && (
                            <Chip label={`${zeroConf} missing`} size="small" color="error" variant="outlined"
                              sx={{ height: 16, fontSize: '0.6rem' }} />
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                )
              })}
            </List>
          </Box>
          <Button
            variant="contained"
            color="secondary"
            fullWidth
            disabled={selectedTables.size === 0 || aiPending}
            startIcon={aiPending ? <CircularProgress size={14} color="inherit" /> : <SmartToyOutlined />}
            onClick={handleTableSelectionConfirm}
          >
            Start Enrichment for {selectedTables.size > 0 ? `${selectedTables.size} table${selectedTables.size > 1 ? 's' : ''}` : 'selected tables'}
          </Button>
        </Box>
      )}

      {/* ── Chat phase ── */}
      {!selectionPhase && (
        <>
          {/* Chat history */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {aiHistory.map((msg, i) => (
              <Box
                key={i}
                sx={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  px: 1.5, py: 1,
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  bgcolor: msg.role === 'user'
                    ? (t: any) => alpha(t.palette.primary.main, 0.1)
                    : (t: any) => alpha(t.palette.secondary.main, 0.08),
                  border: 1,
                  borderColor: msg.role === 'user'
                    ? (t: any) => alpha(t.palette.primary.main, 0.2)
                    : (t: any) => alpha(t.palette.secondary.main, 0.2),
                }}
              >
                {msg.role === 'assistant' && (
                  <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 700, display: 'block', mb: 0.25, fontSize: '0.688rem' }}>
                    AI Assistant
                  </Typography>
                )}
                <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.55 }}>
                  {msg.content}
                </Typography>
              </Box>
            ))}
            {aiPending && (
              <Box sx={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75 }}>
                <CircularProgress size={12} color="secondary" />
                <Typography variant="caption" color="text.secondary">Thinking…</Typography>
              </Box>
            )}
            <div ref={aiChatEndRef} />
          </Box>

          {/* Pending updates card */}
          {pendingUpdates && pendingUpdates.length > 0 && (
            <Box sx={{ mx: 1.5, mb: 1, p: 1.5, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.success.main, 0.06), border: 1, borderColor: (t) => alpha(t.palette.success.main, 0.3) }}>
              <Typography variant="caption" fontWeight={700} color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
                <CheckCircleOutlined sx={{ fontSize: 14 }} />
                {pendingUpdates.length} metadata update{pendingUpdates.length > 1 ? 's' : ''} ready to apply
              </Typography>
              <Box sx={{ maxHeight: 100, overflow: 'auto', mb: 1 }}>
                {pendingUpdates.map((u, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mb: 0.25 }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.688rem', color: 'secondary.main', flexShrink: 0 }}>
                      {u.table_name}{u.column_name ? `.${u.column_name}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.688rem' }}>
                      — {(u.description || u.business_context || '').slice(0, 60)}{((u.description || u.business_context || '').length > 60 ? '…' : '')}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="contained" color="success" fullWidth
                  startIcon={applyUpdatesMutation.isPending ? <CircularProgress size={12} color="inherit" /> : <CheckCircleOutlined />}
                  onClick={handleApplyUpdates} disabled={applyUpdatesMutation.isPending} sx={{ fontSize: '0.75rem' }}>
                  Apply to Schema
                </Button>
                <Button size="small" variant="outlined" color="inherit" onClick={() => setPendingUpdates(null)} sx={{ fontSize: '0.75rem', flexShrink: 0 }}>
                  Skip
                </Button>
              </Box>
            </Box>
          )}

          {/* Input */}
          <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <TextField
              size="small" fullWidth multiline maxRows={4}
              placeholder="Type your answer… (Enter to send, Shift+Enter for newline)"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(aiInput) } }}
              sx={{ '& .MuiInputBase-root': { fontSize: '0.813rem' } }}
            />
            <IconButton color="secondary" size="small"
              onClick={() => sendAiMessage(aiInput)} disabled={!aiInput.trim() || aiPending} sx={{ flexShrink: 0 }}>
              <SendOutlined fontSize="small" />
            </IconButton>
          </Box>
        </>
      )}
    </Box>
  )

  const gapCount = (metaList as any[]).filter((c: any) => _confidence(c) === 0).length

  return (
    <Box>
      {/* ── Header row ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>Schema Metadata Editor</Typography>
          <Typography variant="caption" color="text.secondary">
            {tableNames.length} tables · enrich descriptions, aliases and synonyms to improve AI query quality
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="small" variant="outlined" color="secondary"
            startIcon={<SmartToyOutlined />}
            onClick={() => setAiOpen(true)}
            sx={{ borderRadius: 1.5 }}
          >
            AI Assistant
            {gapCount > 0 && (
              <Chip label={gapCount} color="error" size="small" sx={{ ml: 0.75, height: 18, fontSize: '0.625rem' }} />
            )}
          </Button>
          <Tooltip title="Export full schema as JSON"><span>
            <Button size="small" variant="outlined" startIcon={<FileDownloadOutlined />} onClick={handleExport} sx={{ borderRadius: 1.5 }}>Export</Button>
          </span></Tooltip>
          <Tooltip title="Import schema from JSON file"><span>
            <Button size="small" variant="outlined" startIcon={<FileUploadOutlined />} onClick={() => importInputRef.current?.click()} sx={{ borderRadius: 1.5 }}>Import</Button>
          </span></Tooltip>
          <input ref={importInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
          <Button
            size="small" variant="contained"
            startIcon={saveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
            onClick={handleSave} disabled={saveMutation.isPending || !isDirty}
            sx={{ borderRadius: 1.5 }}
          >
            Save Changes
          </Button>
          <Button size="small" variant="outlined" startIcon={<CloseOutlined />} onClick={onClose} sx={{ borderRadius: 1.5 }}>Close</Button>
        </Box>
      </Box>

      {/* ── Schema tree (full width) ── */}
      {schemaPanel}

      {/* ── AI Assistant Dialog ── */}
      <Dialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        fullWidth
        maxWidth="lg"
        PaperProps={{ sx: { borderRadius: 3, height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        {/* Dialog header */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5,
          borderBottom: 1, borderColor: 'divider',
          bgcolor: (t) => alpha(t.palette.secondary.main, 0.04), flexShrink: 0,
        }}>
          <Box sx={{
            width: 32, height: 32, borderRadius: 1.5, flexShrink: 0,
            bgcolor: (t) => alpha(t.palette.secondary.main, 0.15),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SmartToyOutlined sx={{ color: 'secondary.main', fontSize: 18 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.2 }}>Schema AI Assistant</Typography>
            <Typography variant="caption" color="text.secondary">
              Guided metadata enrichment — descriptions, synonyms & business context
            </Typography>
          </Box>
          <Button
            size="small" variant="contained" color="secondary"
            startIcon={<ContentCopyOutlined sx={{ fontSize: 14 }} />}
            onClick={startNewSession}
            sx={{ borderRadius: 1.5, fontSize: '0.75rem' }}
          >
            New Chat
          </Button>
          <Tooltip title="Upload a document (PDF, DOCX, XLSX, CSV, TXT…) — AI extracts metadata from it">
            <span>
              <Button
                size="small" variant="outlined"
                startIcon={docUploading ? <CircularProgress size={13} /> : <FileUploadOutlined sx={{ fontSize: 15 }} />}
                onClick={() => docUploadRef.current?.click()}
                disabled={docUploading}
                sx={{ borderRadius: 1.5, fontSize: '0.75rem' }}
              >
                Upload Doc
              </Button>
            </span>
          </Tooltip>
          <input
            ref={docUploadRef}
            type="file"
            accept=".txt,.pdf,.docx,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff"
            style={{ display: 'none' }}
            onChange={handleDocUpload}
          />
          <IconButton size="small" onClick={() => setAiOpen(false)} sx={{ ml: 0.5 }}>
            <CloseOutlined fontSize="small" />
          </IconButton>
        </Box>

        {/* Dialog body: sidebar + main */}
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── History sidebar ── */}
          <Box sx={{
            width: 240, flexShrink: 0,
            borderRight: 1, borderColor: 'divider',
            display: 'flex', flexDirection: 'column',
            bgcolor: (t) => alpha(t.palette.background.default, 0.5),
          }}>
            <Box sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '0.65rem' }}>
                Chat History
              </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              {(sessionList as any[]).length === 0 && (
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.disabled">No history yet</Typography>
                </Box>
              )}
              {(sessionList as any[]).map((s: any) => (
                <Box
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  sx={{
                    px: 1.5, py: 1.25, cursor: 'pointer', borderBottom: 1, borderColor: 'divider',
                    bgcolor: activeSessionId === s.id ? (t) => alpha(t.palette.secondary.main, 0.1) : 'transparent',
                    borderLeft: activeSessionId === s.id ? 3 : 0,
                    borderLeftColor: 'secondary.main',
                    display: 'flex', alignItems: 'flex-start', gap: 0.75,
                    transition: 'background 0.15s',
                    '&:hover': { bgcolor: (t) => alpha(t.palette.secondary.main, 0.06) },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" fontWeight={600} sx={{
                      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      color: activeSessionId === s.id ? 'secondary.main' : 'text.primary',
                    }}>
                      {s.title || 'New Chat'}
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                      {s.message_count} msg{s.message_count !== 1 ? 's' : ''} · {new Date(s.updated_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}
                    sx={{ opacity: 0.4, '&:hover': { opacity: 1, color: 'error.main' }, flexShrink: 0, p: 0.25 }}
                  >
                    <DeleteOutlined sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>

          {/* ── Main chat area ── */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Table selection phase */}
            {selectionPhase && (
              <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', p: 3, gap: 2 }}>
                <Box>
                  <Typography variant="body1" fontWeight={600} gutterBottom>
                    Which tables do your business users query most often?
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Select the tables to focus on. The AI will ask targeted questions about missing descriptions, synonyms and business context for these tables only.
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button size="small" variant="outlined" onClick={() => setSelectedTables(new Set(tableNames))}>Select All</Button>
                  <Button size="small" variant="outlined" onClick={() => setSelectedTables(new Set())}>Clear</Button>
                  <Chip label={`${selectedTables.size} selected`} size="small" color={selectedTables.size > 0 ? 'secondary' : 'default'} sx={{ ml: 'auto' }} />
                </Box>
                {/* Hidden shared file input for per-table attachments */}
                <input
                  ref={tableFileInputRef}
                  type="file"
                  accept=".txt,.pdf,.docx,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff"
                  style={{ display: 'none' }}
                  onChange={handleTableDocPick}
                />

                <Box sx={{ flex: 1, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                  <List dense disablePadding>
                    {tableNames.map((t) => {
                      const cols       = byTable[t]
                      const zeroConf   = cols.filter((c: any) => _confidence(c) === 0).length
                      const attachedDoc = tableDocs[t]
                      return (
                        <ListItem
                          key={t}
                          disablePadding
                          sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                          secondaryAction={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 0.5 }}>
                              {attachedDoc && (
                                <Tooltip title={attachedDoc.name}>
                                  <Chip
                                    icon={<DescriptionOutlined sx={{ fontSize: '0.75rem !important' }} />}
                                    label={attachedDoc.name.length > 18 ? attachedDoc.name.slice(0, 16) + '…' : attachedDoc.name}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    onDelete={() => setTableDocs((prev) => { const n = { ...prev }; delete n[t]; return n })}
                                    sx={{ height: 20, fontSize: '0.6rem', maxWidth: 140 }}
                                  />
                                </Tooltip>
                              )}
                              <Tooltip title={attachedDoc ? 'Replace document' : 'Attach document or image for this table'}>
                                <IconButton
                                  size="small"
                                  onClick={(e) => { e.stopPropagation(); setAttachingTable(t); setTimeout(() => tableFileInputRef.current?.click(), 0) }}
                                  sx={{ color: attachedDoc ? 'primary.main' : 'text.disabled', p: 0.5 }}
                                >
                                  <AttachFileOutlined sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          }
                        >
                          <FormControlLabel
                            sx={{ width: '100%', m: 0, pl: 2, pr: 1, py: 0.75 }}
                            control={
                              <Checkbox size="small" checked={selectedTables.has(t)}
                                onChange={(e) => setSelectedTables((prev) => {
                                  const next = new Set(prev)
                                  e.target.checked ? next.add(t) : next.delete(t)
                                  return next
                                })}
                              />
                            }
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{t}</Typography>
                                <Typography variant="caption" color="text.disabled">{cols.length} cols</Typography>
                                {zeroConf > 0 && <Chip label={`${zeroConf} missing`} size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />}
                              </Box>
                            }
                          />
                        </ListItem>
                      )
                    })}
                  </List>
                </Box>
                <Button
                  variant="contained" color="secondary" fullWidth size="large"
                  disabled={selectedTables.size === 0 || aiPending}
                  startIcon={aiPending ? <CircularProgress size={16} color="inherit" /> : <SmartToyOutlined />}
                  onClick={handleTableSelectionConfirm} sx={{ borderRadius: 1.5 }}
                >
                  Start Enrichment for {selectedTables.size > 0 ? `${selectedTables.size} table${selectedTables.size > 1 ? 's' : ''}` : 'selected tables'}
                </Button>
              </Box>
            )}

            {/* Chat phase */}
            {!selectionPhase && (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Messages */}
                <Box sx={{ flex: 1, overflow: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {aiHistory.length === 0 && (
                    <Box sx={{ textAlign: 'center', py: 8 }}>
                      <SmartToyOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
                      <Typography variant="body2" color="text.secondary">
                        Ask the AI to help fill in missing metadata, or describe your schema in business terms.
                      </Typography>
                    </Box>
                  )}
                  {aiHistory.map((msg, i) => (
                    <Box key={i} sx={{
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '82%', px: 2, py: 1.25,
                      borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      bgcolor: msg.role === 'user'
                        ? (t: any) => alpha(t.palette.primary.main, 0.1)
                        : (t: any) => alpha(t.palette.secondary.main, 0.07),
                      border: 1,
                      borderColor: msg.role === 'user'
                        ? (t: any) => alpha(t.palette.primary.main, 0.25)
                        : (t: any) => alpha(t.palette.secondary.main, 0.2),
                    }}>
                      {msg.role === 'assistant' && (
                        <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 700, display: 'block', mb: 0.5, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          AI Assistant
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ display: 'block', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
                        {msg.content}
                      </Typography>
                    </Box>
                  ))}
                  {aiPending && (
                    <Box sx={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
                      <CircularProgress size={14} color="secondary" />
                      <Typography variant="caption" color="text.secondary">Thinking…</Typography>
                    </Box>
                  )}
                  <div ref={aiChatEndRef} />
                </Box>

                {/* Pending updates */}
                {pendingUpdates && pendingUpdates.length > 0 && (
                  <Box sx={{ mx: 2.5, mb: 1.5, p: 2, borderRadius: 2, bgcolor: (t) => alpha(t.palette.success.main, 0.05), border: 1, borderColor: (t) => alpha(t.palette.success.main, 0.3) }}>
                    <Typography variant="body2" fontWeight={700} color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                      <CheckCircleOutlined sx={{ fontSize: 16 }} />
                      {pendingUpdates.length} metadata update{pendingUpdates.length > 1 ? 's' : ''} ready to apply
                    </Typography>
                    <Box sx={{ maxHeight: 90, overflow: 'auto', mb: 1.5 }}>
                      {pendingUpdates.map((u, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.375 }}>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'secondary.main', flexShrink: 0 }}>
                            {u.table_name}{u.column_name ? `.${u.column_name}` : ''}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            — {(u.description || u.business_context || '').slice(0, 70)}{((u.description || u.business_context || '').length > 70 ? '…' : '')}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="contained" color="success" fullWidth
                        startIcon={applyUpdatesMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <CheckCircleOutlined />}
                        onClick={handleApplyUpdates} disabled={applyUpdatesMutation.isPending} sx={{ borderRadius: 1.5 }}>
                        Apply to Schema
                      </Button>
                      <Button size="small" variant="outlined" color="inherit" onClick={() => setPendingUpdates(null)} sx={{ borderRadius: 1.5, flexShrink: 0 }}>
                        Skip
                      </Button>
                    </Box>
                  </Box>
                )}

                {/* Input */}
                <Box sx={{ px: 2.5, pb: 2.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                    <TextField
                      size="small" fullWidth multiline maxRows={4}
                      placeholder="Answer the AI's question, or ask it to focus on a specific table… (Enter to send)"
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(aiInput) } }}
                      sx={{ '& .MuiInputBase-root': { borderRadius: 2 } }}
                    />
                    <IconButton color="secondary" onClick={() => sendAiMessage(aiInput)}
                      disabled={!aiInput.trim() || aiPending}
                      sx={{ bgcolor: (t) => alpha(t.palette.secondary.main, 0.1), borderRadius: 2, p: 1 }}>
                      <SendOutlined />
                    </IconButton>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Dialog>
    </Box>
  )
}

// ─── Query Context + Query Examples Tab ──────────────────────────────────────
function QueryContextTab({ connId }: { connId?: number }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  // ── Query Context (free-form markdown) ────────────────────
  const [contextText, setContextText] = useState('')

  const loadCtx = useQuery({
    queryKey: ['query-context', connId],
    queryFn: () => queryApi.getContext(connId!),
    enabled: connId != null,
  })
  useEffect(() => {
    if (loadCtx.data) setContextText((loadCtx.data as any)?.content ?? '')
  }, [loadCtx.data])

  const saveCtxMut = useMutation({
    mutationFn: () => queryApi.saveContext(connId!, contextText),
    onSuccess: () => enqueueSnackbar('Context saved', { variant: 'success' }),
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  // ── Query Examples ────────────────────────────────────────
  const [exDialogOpen, setExDialogOpen] = useState(false)
  const [editEx, setEditEx] = useState<QueryExample | null>(null)
  const [exForm, setExForm] = useState({ name: '', description: '', tables_used: '', example_sql: '', is_active: true })

  const { data: examples = [], isLoading: exLoading, refetch: refetchExamples } = useQuery<QueryExample[]>({
    queryKey: ['query-examples', connId],
    queryFn: () => adminApi.listQueryExamples(connId!),
    enabled: connId != null,
    staleTime: 0,
  })

  const saveExMut = useMutation({
    mutationFn: () =>
      editEx
        ? adminApi.updateQueryExample(connId!, editEx.id, { ...exForm, conn_id: connId })
        : adminApi.createQueryExample(connId!, { ...exForm, conn_id: connId }),
    onSuccess: () => {
      setExDialogOpen(false)
      enqueueSnackbar(editEx ? 'Example updated' : 'Example created', { variant: 'success' })
      refetchExamples()
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const deleteExMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteQueryExample(connId!, id),
    onSuccess: () => {
      enqueueSnackbar('Example deleted', { variant: 'info' })
      refetchExamples()
    },
  })

  const toggleExMut = useMutation({
    mutationFn: ({ id, is_active, ex }: { id: number; is_active: boolean; ex: QueryExample }) =>
      adminApi.updateQueryExample(connId!, id, { name: ex.name, description: ex.description, tables_used: ex.tables_used, example_sql: ex.example_sql, is_active, conn_id: connId }),
    onSuccess: () => refetchExamples(),
  })

  const openNewEx = () => {
    setEditEx(null)
    setExForm({ name: '', description: '', tables_used: '', example_sql: '', is_active: true })
    setExDialogOpen(true)
  }

  const openEditEx = (ex: QueryExample) => {
    setEditEx(ex)
    setExForm({ name: ex.name, description: ex.description ?? '', tables_used: ex.tables_used ?? '', example_sql: ex.example_sql, is_active: ex.is_active })
    setExDialogOpen(true)
  }

  // ── AI helpers for Query Examples ─────────────────────────
  type ExSuggestion = { name: string; description: string; tables_used: string; example_sql: string }

  const [aiSqlLoading, setAiSqlLoading] = useState(false)
  const [batchSuggestions, setBatchSuggestions] = useState<ExSuggestion[]>([])
  const [batchOpen, setBatchOpen] = useState(false)

  // AI Import dialog state
  const [aiImportOpen, setAiImportOpen]   = useState(false)
  const [aiImportTab,  setAiImportTab]    = useState<0 | 1>(0)   // 0 = From Schema, 1 = From Content
  const [aiImportText, setAiImportText]   = useState('')
  const [aiImportFile, setAiImportFile]   = useState<File | null>(null)
  const [aiImportLoading, setAiImportLoading] = useState(false)
  const aiImportFileRef = useRef<HTMLInputElement>(null)

  const generateAiSql = async () => {
    const intent = [exForm.name, exForm.description].filter(Boolean).join(' — ')
    if (!intent.trim()) {
      enqueueSnackbar('Enter a name or description first', { variant: 'warning' })
      return
    }
    setAiSqlLoading(true)
    try {
      const res = await adminApi.aiGenerateExampleSql(connId!, intent)
      setExForm((f) => ({ ...f, example_sql: res.example_sql, tables_used: res.tables_used || f.tables_used }))
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail ?? 'AI generation failed', { variant: 'error' })
    } finally {
      setAiSqlLoading(false)
    }
  }

  const runAiImport = async () => {
    setAiImportLoading(true)
    try {
      let res: { suggestions: ExSuggestion[]; total_found?: number }
      if (aiImportTab === 0) {
        res = await adminApi.aiGenerateExampleBatch(connId!)
      } else {
        if (!aiImportText.trim() && !aiImportFile) {
          enqueueSnackbar('Paste some text or upload a file', { variant: 'warning' })
          setAiImportLoading(false)
          return
        }
        res = await adminApi.aiExtractExamples(connId!, aiImportText, aiImportFile ?? undefined)
      }
      if (res.suggestions.length === 0) {
        enqueueSnackbar('No new examples found', { variant: 'info' })
      } else {
        setBatchSuggestions(res.suggestions)
        setBatchOpen(true)
        setAiImportOpen(false)
        setAiImportText('')
        setAiImportFile(null)
      }
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail ?? 'AI failed', { variant: 'error' })
    } finally {
      setAiImportLoading(false)
    }
  }

  const acceptBatchSuggestion = useMutation({
    mutationFn: (s: ExSuggestion) =>
      adminApi.createQueryExample(connId!, { ...s, is_active: true, conn_id: connId }),
    onSuccess: (_data, s) => {
      setBatchSuggestions((prev) => prev.filter((x) => x.name !== s.name))
      refetchExamples()
      enqueueSnackbar('Example added', { variant: 'success' })
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const acceptAllBatch = async () => {
    for (const s of batchSuggestions) {
      await adminApi.createQueryExample(connId!, { ...s, is_active: true, conn_id: connId })
    }
    setBatchSuggestions([])
    setBatchOpen(false)
    refetchExamples()
    enqueueSnackbar(`${batchSuggestions.length} examples added`, { variant: 'success' })
  }

  const [ctxOpen,      setCtxOpen]      = useState(true)
  const [exOpen,       setExOpen]       = useState(true)
  const [relOpen,      setRelOpen]      = useState(true)
  const [relDialogOpen, setRelDialogOpen] = useState(false)
  const [relForm, setRelForm] = useState({ parent_table: '', parent_column: '', referenced_table: '', referenced_column: '' })
  const [suggestions, setSuggestions]   = useState<AISuggestedRelation[]>([])
  const [suggestOpen,  setSuggestOpen]  = useState(false)
  const [suggesting,   setSuggesting]   = useState(false)

  const { data: relations = [], refetch: refetchRelations } = useQuery<CatalogRelationRow[]>({
    queryKey: ['relations', connId],
    queryFn: () => adminApi.listRelations(connId!),
    enabled: connId != null,
  })

  const addRelMut = useMutation({
    mutationFn: () => adminApi.addRelation(connId!, relForm),
    onSuccess: () => {
      setRelDialogOpen(false)
      enqueueSnackbar('Relation added', { variant: 'success' })
      refetchRelations()
      qc.invalidateQueries({ queryKey: ['ai-readiness', connId] })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail ?? 'Save failed', { variant: 'error' }),
  })

  const delRelMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteRelation(connId!, id),
    onSuccess: () => {
      enqueueSnackbar('Relation removed', { variant: 'info' })
      refetchRelations()
      qc.invalidateQueries({ queryKey: ['ai-readiness', connId] })
    },
  })

  const acceptSuggestion = useMutation({
    mutationFn: (s: AISuggestedRelation) =>
      adminApi.addRelation(connId!, {
        parent_table: s.parent_table, parent_column: s.parent_column,
        referenced_table: s.referenced_table, referenced_column: s.referenced_column,
        fk_name: `ai_${s.parent_table}_${s.parent_column}`,
      }),
    onSuccess: (_data, s) => {
      setSuggestions((prev) => prev.filter(
        (x) => !(x.parent_table === s.parent_table && x.parent_column === s.parent_column &&
                 x.referenced_table === s.referenced_table && x.referenced_column === s.referenced_column)
      ))
      refetchRelations()
      qc.invalidateQueries({ queryKey: ['ai-readiness', connId] })
      enqueueSnackbar('Relation accepted', { variant: 'success' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail ?? 'Already exists', { variant: 'warning' }),
  })

  const runAISuggest = async () => {
    setSuggesting(true)
    setSuggestOpen(true)
    try {
      const res = await adminApi.aiSuggestRelations(connId!)
      setSuggestions(res.suggestions)
      if (res.suggestions.length === 0) enqueueSnackbar('No new suggestions found', { variant: 'info' })
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail ?? 'AI suggest failed', { variant: 'error' })
    } finally {
      setSuggesting(false)
    }
  }

  if (!connId) {
    return <Typography color="text.disabled">Select a connection to manage query context and examples.</Typography>
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── 1. Query Context ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: ctxOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setCtxOpen((v) => !v)}
        >
          {ctxOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <QuizOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Query Context</Typography>
          {contextText && (
            <Chip label={`${contextText.length} chars`} size="small" variant="outlined" color="success" sx={{ height: 20, fontSize: '0.7rem' }} onClick={(e) => e.stopPropagation()} />
          )}
        </Box>
        <Collapse in={ctxOpen}>
          <Box sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Free-form Markdown context injected into every AI prompt for this connection. Describe tables, business rules, common joins.
            </Typography>
            <TextField
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              multiline rows={10} fullWidth size="small"
              placeholder={`# Database Context\n\n## Tables\n- dbo.Employees: Employee records, EmployeeId PK\n- dbo.Departments: DeptCode links to Employees.DeptCode\n\n## Business Rules\n- Active employees have Status = 'A'`}
              sx={{ mb: 1.5, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            />
            <Button variant="contained" size="small" startIcon={<SaveOutlined />}
              onClick={() => saveCtxMut.mutate()} disabled={saveCtxMut.isPending}>
              {saveCtxMut.isPending ? <CircularProgress size={13} sx={{ mr: 1 }} /> : null}Save Context
            </Button>
          </Box>
        </Collapse>
      </Paper>

      {/* ── 2. Query Examples ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: exOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setExOpen((v) => !v)}
        >
          {exOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <DataObjectOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Query Examples</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {examples.length > 0 && (
              <Chip label={`${examples.filter((e) => e.is_active).length} active / ${examples.length}`} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
            )}
            <Tooltip title="Generate examples from schema, file, or pasted SQL">
              <Button size="small" variant="outlined" color="secondary"
                startIcon={<AutoAwesomeOutlined />}
                onClick={() => { setAiImportOpen(true); setAiImportTab(0) }}>
                AI Import
              </Button>
            </Tooltip>
            <Button size="small" variant="contained" startIcon={<EditOutlined />} onClick={openNewEx}>
              Add Example
            </Button>
          </Box>
        </Box>
        <Collapse in={exOpen}>
          <Box>
            {/* AI Batch Suggestions panel */}
            {batchOpen && batchSuggestions.length > 0 && (
              <Box sx={{ mx: 2, mt: 1.5, mb: 1, p: 1.5, bgcolor: (t) => alpha(t.palette.secondary.main, 0.05), border: '1px dashed', borderColor: 'secondary.main', borderRadius: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <AutoAwesomeOutlined sx={{ fontSize: 15, color: 'secondary.main' }} />
                  <Typography variant="caption" fontWeight={700} color="secondary.main">
                    AI Suggestions ({batchSuggestions.length}) — click ✓ to add
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" variant="outlined" color="success" sx={{ py: 0.25, px: 1, fontSize: '0.7rem' }}
                    onClick={acceptAllBatch}>
                    Accept All
                  </Button>
                  <IconButton size="small" onClick={() => { setBatchOpen(false); setBatchSuggestions([]) }}>
                    <CloseOutlined sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
                <Table size="small">
                  <TableBody>
                    {batchSuggestions.map((s, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ width: 180 }}>
                          <Typography variant="caption" fontWeight={700}>{s.name}</Typography>
                          {s.description && (
                            <Typography variant="caption" color="text.secondary" display="block">{s.description}</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ width: 140 }}>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'text.secondary' }}>
                            {s.tables_used}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', whiteSpace: 'pre-wrap', color: 'text.secondary', display: 'block' }}>
                            {s.example_sql.slice(0, 100)}{s.example_sql.length > 100 ? '…' : ''}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title="Accept — add this example">
                            <IconButton size="small" color="success" onClick={() => acceptBatchSuggestion.mutate(s)}>
                              <CheckOutlined sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Dismiss">
                            <IconButton size="small" color="default" onClick={() => setBatchSuggestions((prev) => prev.filter((_, j) => j !== i))}>
                              <CloseOutlined sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
            {exLoading ? <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box> : (
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 200 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 160 }}>Tables Used</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>SQL Preview</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 80 }} align="center">Active</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 90 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {examples.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                        No examples yet. Click "Add Example" to provide sample queries.
                      </TableCell>
                    </TableRow>
                  )}
                  {examples.map((ex) => (
                    <TableRow key={ex.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>{ex.name}</Typography>
                        {ex.description && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3, mt: 0.25 }}>
                            {ex.description}
                          </Typography>
                        )}
                        {ex.conn_id == null && <Chip label="global" size="small" sx={{ height: 16, fontSize: '0.625rem', mt: 0.5 }} />}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                          {ex.tables_used || <span style={{ color: '#bbb' }}>—</span>}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'pre-wrap', color: 'text.secondary', display: 'block' }}>
                          {ex.example_sql.slice(0, 120)}{ex.example_sql.length > 120 ? '…' : ''}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox
                          size="small" checked={ex.is_active}
                          onChange={(e) => toggleExMut.mutate({ id: ex.id, is_active: e.target.checked, ex })}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEditEx(ex)}>
                            <EditOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => deleteExMut.mutate(ex.id)}>
                            <DeleteOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Collapse>
      </Paper>

      {/* Add/Edit Example Dialog */}
      <Dialog open={exDialogOpen} onClose={() => setExDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editEx ? 'Edit Query Example' : 'Add Query Example'}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField label="Name" size="small" fullWidth required
            placeholder="e.g. Monthly Sales by Department"
            value={exForm.name} onChange={(e) => setExForm((f) => ({ ...f, name: e.target.value }))} />
          <TextField label="Description" size="small" fullWidth
            placeholder="Brief description of what this query does"
            value={exForm.description} onChange={(e) => setExForm((f) => ({ ...f, description: e.target.value }))} />
          <TextField label="Tables Used" size="small" fullWidth
            placeholder="dbo.Employees, dbo.Departments (comma-separated)"
            value={exForm.tables_used} onChange={(e) => setExForm((f) => ({ ...f, tables_used: e.target.value }))} />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Example SQL *</Typography>
              <Tooltip title="Generate SQL from the name & description using AI">
                <Button size="small" variant="outlined" color="secondary"
                  startIcon={aiSqlLoading ? <CircularProgress size={11} color="inherit" /> : <AutoAwesomeOutlined sx={{ fontSize: 14 }} />}
                  onClick={generateAiSql} disabled={aiSqlLoading}
                  sx={{ py: 0.25, px: 1, fontSize: '0.72rem' }}>
                  AI Fill SQL
                </Button>
              </Tooltip>
            </Box>
            <TextField
              size="small" fullWidth required multiline minRows={8}
              placeholder="SELECT d.DeptName, COUNT(e.EmployeeId) AS HeadCount&#10;FROM dbo.Departments d&#10;JOIN dbo.Employees e ON e.DeptCode = d.DeptCode&#10;WHERE e.Status = 'A'&#10;GROUP BY d.DeptName"
              value={exForm.example_sql} onChange={(e) => setExForm((f) => ({ ...f, example_sql: e.target.value }))}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            />
          </Box>
          <FormControlLabel
            control={<Checkbox size="small" checked={exForm.is_active} onChange={(e) => setExForm((f) => ({ ...f, is_active: e.target.checked }))} />}
            label={<Typography variant="body2">Active (included in AI prompts)</Typography>}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => saveExMut.mutate()} disabled={saveExMut.isPending || !exForm.name || !exForm.example_sql}>
            {saveExMut.isPending ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}{editEx ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── AI Import Dialog ── */}
      <Dialog open={aiImportOpen} onClose={() => setAiImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeOutlined color="secondary" sx={{ fontSize: 20 }} />
          AI Import Query Examples
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {/* Tab switcher */}
          <Tabs value={aiImportTab} onChange={(_e, v) => setAiImportTab(v as 0 | 1)}
            sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2 }}>
            <Tab label="From Schema" value={0} sx={{ fontSize: '0.8rem', textTransform: 'none', minHeight: 40 }} />
            <Tab label="From File / Text" value={1} sx={{ fontSize: '0.8rem', textTransform: 'none', minHeight: 40 }} />
          </Tabs>

          {/* Tab 0 — Auto-generate from schema */}
          {aiImportTab === 0 && (
            <Box sx={{ p: 2.5 }}>
              <Alert severity="info" icon={<AutoAwesomeOutlined fontSize="small" />} sx={{ mb: 2, fontSize: '0.8rem' }}>
                AI will analyse your database schema and generate 5 diverse, ready-to-use query examples automatically. Run <strong>Collect Schema</strong> in the Schema Tools tab first for best results.
              </Alert>
              <Typography variant="body2" color="text.secondary">
                Examples are tailored to the tables and columns discovered in this connection. You can review and selectively accept each one before saving.
              </Typography>
            </Box>
          )}

          {/* Tab 1 — From file or pasted text */}
          {aiImportTab === 1 && (
            <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Upload a <strong>.sql</strong>, <strong>.txt</strong>, or <strong>.md</strong> file — or paste SQL/descriptions below. AI will extract and name each query automatically.
              </Typography>

              {/* File upload */}
              <Box
                sx={{
                  border: '2px dashed', borderColor: aiImportFile ? 'success.main' : 'divider',
                  borderRadius: 2, p: 2, textAlign: 'center', cursor: 'pointer',
                  bgcolor: aiImportFile ? (t) => alpha(t.palette.success.main, 0.04) : 'transparent',
                  '&:hover': { borderColor: 'primary.main', bgcolor: (t) => alpha(t.palette.primary.main, 0.03) },
                }}
                onClick={() => aiImportFileRef.current?.click()}
              >
                <input
                  ref={aiImportFileRef} type="file" hidden
                  accept=".sql,.txt,.md,.csv"
                  onChange={(e) => setAiImportFile(e.target.files?.[0] ?? null)}
                />
                {aiImportFile ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    <CheckCircleOutlined color="success" sx={{ fontSize: 18 }} />
                    <Typography variant="body2" fontWeight={600} color="success.main">{aiImportFile.name}</Typography>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setAiImportFile(null) }}>
                      <CloseOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ) : (
                  <Box>
                    <FileUploadOutlined sx={{ fontSize: 28, color: 'text.disabled', mb: 0.5 }} />
                    <Typography variant="body2" color="text.secondary">Click to upload a file</Typography>
                    <Typography variant="caption" color="text.disabled">.sql · .txt · .md</Typography>
                  </Box>
                )}
              </Box>

              {/* Free-text paste area */}
              <TextField
                label="Or paste SQL / descriptions here"
                multiline minRows={7}
                fullWidth size="small"
                placeholder={`-- Example: paste one or many queries\nSELECT e.Name, d.DeptName\nFROM Employees e\nJOIN Departments d ON e.DeptCode = d.DeptCode\nWHERE e.Status = 'A'\n\n-- Or plain English:\n-- Monthly headcount per department\n-- Active employees hired in the last 90 days`}
                value={aiImportText}
                onChange={(e) => setAiImportText(e.target.value)}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.78rem' } }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiImportOpen(false)}>Cancel</Button>
          <Button
            variant="contained" color="secondary"
            startIcon={aiImportLoading ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeOutlined />}
            onClick={runAiImport}
            disabled={aiImportLoading}
          >
            {aiImportLoading ? 'Thinking…' : aiImportTab === 0 ? 'Generate from Schema' : 'Extract Examples'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 3. Table Relations ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: relOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setRelOpen((v) => !v)}
        >
          {relOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <AccountTreeOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Table Relations</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {relations.length > 0 && (
              <Chip label={`${relations.length} relation${relations.length !== 1 ? 's' : ''}`} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
            )}
            <Tooltip title="Ask AI to suggest likely joins based on column names">
              <Button size="small" variant="outlined" color="secondary"
                startIcon={suggesting ? <CircularProgress size={12} color="inherit" /> : <AutoAwesomeOutlined />}
                onClick={runAISuggest} disabled={suggesting}>
                AI Suggest
              </Button>
            </Tooltip>
            <Button size="small" variant="contained" startIcon={<AddOutlined />}
              onClick={() => { setRelForm({ parent_table: '', parent_column: '', referenced_table: '', referenced_column: '' }); setRelDialogOpen(true) }}>
              Add Relation
            </Button>
          </Box>
        </Box>
        <Collapse in={relOpen}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1.5, pb: 1 }}>
              FK relations discovered from schema + manually added relations. Used by all AI modules for JOIN generation.
            </Typography>

            {/* AI Suggestions panel */}
            {suggestOpen && suggestions.length > 0 && (
              <Box sx={{ mx: 2, mb: 1.5, p: 1.5, bgcolor: (t) => alpha(t.palette.secondary.main, 0.05), border: '1px dashed', borderColor: 'secondary.main', borderRadius: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <AutoAwesomeOutlined sx={{ fontSize: 15, color: 'secondary.main' }} />
                  <Typography variant="caption" fontWeight={700} color="secondary.main">
                    AI Suggestions — click ✓ to accept
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <IconButton size="small" onClick={() => { setSuggestOpen(false); setSuggestions([]) }}>
                    <CloseOutlined sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
                <Table size="small">
                  <TableBody>
                    {suggestions.map((s, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', py: 0.75 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography component="span" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.75rem' }}>{s.parent_table}.{s.parent_column}</Typography>
                            <Typography component="span" color="text.disabled" sx={{ fontSize: '0.7rem' }}>→</Typography>
                            <Typography component="span" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.75rem' }}>{s.referenced_table}.{s.referenced_column}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ py: 0.75 }}>
                          <Chip
                            label={`${Math.round(s.confidence * 100)}%`}
                            size="small"
                            color={s.confidence >= 0.85 ? 'success' : s.confidence >= 0.7 ? 'warning' : 'default'}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem' }}
                          />
                        </TableCell>
                        <TableCell sx={{ py: 0.75, maxWidth: 300 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>{s.reason}</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ py: 0.75, whiteSpace: 'nowrap' }}>
                          <Tooltip title="Accept — add this relation">
                            <IconButton size="small" color="success" onClick={() => acceptSuggestion.mutate(s)}>
                              <CheckOutlined sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Dismiss">
                            <IconButton size="small" onClick={() => setSuggestions((p) => p.filter((_, j) => j !== i))}>
                              <CloseOutlined sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            {suggesting && suggestions.length === 0 && (
              <Box sx={{ px: 2, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">Analysing schema for likely joins…</Typography>
              </Box>
            )}

            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>From (FK)</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>To (Referenced)</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 80 }} align="center">Source</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 60 }} align="right">Del</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {relations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                      No relations yet. Run Collect Schema to discover FK constraints, or add manually / use AI Suggest.
                    </TableCell>
                  </TableRow>
                )}
                {relations.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}>
                      {r.parent_table}<Typography component="span" color="text.disabled">.</Typography>{r.parent_column}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}>
                      {r.referenced_table}<Typography component="span" color="text.disabled">.</Typography>{r.referenced_column}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={r.source === 'fk' ? 'FK' : r.source === 'ai' ? 'AI' : 'manual'}
                        size="small"
                        color={r.source === 'fk' ? 'primary' : r.source === 'ai' ? 'secondary' : 'default'}
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={r.source === 'fk' ? 'FK relations are removed when you re-run Collect Schema' : 'Remove manual relation'}>
                        <span>
                          <IconButton size="small" color="error" onClick={() => delRelMut.mutate(r.id)}>
                            <DeleteOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Collapse>
      </Paper>

      {/* ── Add Relation Dialog ── */}
      <Dialog open={relDialogOpen} onClose={() => setRelDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Table Relation</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Define a logical join between two tables. This relation will be used by all AI modules for JOIN generation.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField label="From Table" size="small" fullWidth required placeholder="Orders"
              value={relForm.parent_table} onChange={(e) => setRelForm((f) => ({ ...f, parent_table: e.target.value }))} />
            <TextField label="From Column (FK)" size="small" fullWidth required placeholder="customer_id"
              value={relForm.parent_column} onChange={(e) => setRelForm((f) => ({ ...f, parent_column: e.target.value }))} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField label="To Table" size="small" fullWidth required placeholder="Customers"
              value={relForm.referenced_table} onChange={(e) => setRelForm((f) => ({ ...f, referenced_table: e.target.value }))} />
            <TextField label="To Column (PK/Unique)" size="small" fullWidth required placeholder="id"
              value={relForm.referenced_column} onChange={(e) => setRelForm((f) => ({ ...f, referenced_column: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRelDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => addRelMut.mutate()}
            disabled={addRelMut.isPending || !relForm.parent_table || !relForm.parent_column || !relForm.referenced_table || !relForm.referenced_column}>
            {addRelMut.isPending ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}Add Relation
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}

// ─── AI Traces Tab ───────────────────────────────────────────────────────────
const MODULE_OPTIONS = ['all', 'mapping', 'report', 'dev', 'admin', 'dashboard', 'ps', 'testing']

const MODULE_LABELS: Record<string, string> = {
  all: 'All', mapping: 'Mapping', report: 'Report', dev: 'Development',
  admin: 'Admin', dashboard: 'Dashboard', ps: 'PS Support', testing: 'Testing',
}

function AITracesTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [moduleFilter, setModuleFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: traces = [], isLoading, refetch } = useQuery<AITraceEntry[]>({
    queryKey: ['ai-traces', moduleFilter],
    queryFn: () => adminApi.getTraces({ module: moduleFilter === 'all' ? undefined : moduleFilter, limit: 100 }),
    refetchInterval: 30_000,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteTrace(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-traces'] })
      enqueueSnackbar('Trace deleted', { variant: 'info' })
    },
  })

  const purgeMut = useMutation({
    mutationFn: (days: number) => adminApi.purgeTraces(days),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-traces'] })
      enqueueSnackbar('Old traces purged', { variant: 'success' })
    },
  })

  const MODULE_COLORS: Record<string, string> = {
    mapping: '#6366f1', report: '#0ea5e9', dev: '#10b981',
    admin: '#8b5cf6', dashboard: '#f59e0b', ps: '#ec4899', testing: '#14b8a6',
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" fontWeight={700}>AI Traces</Typography>
        <Chip label={`${traces.length} entries`} size="small" color="primary" />
        <Box sx={{ flex: 1 }} />

        {/* Module filter */}
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {MODULE_OPTIONS.map((m) => (
            <Chip key={m} label={MODULE_LABELS[m] ?? m} size="small" clickable
              onClick={() => setModuleFilter(m)}
              color={moduleFilter === m ? 'primary' : 'default'}
              variant={moduleFilter === m ? 'filled' : 'outlined'}
              sx={{ fontSize: '0.688rem' }}
            />
          ))}
        </Box>

        <Button size="small" variant="outlined" onClick={() => refetch()}>Refresh</Button>
        <Button size="small" variant="outlined" color="error"
          startIcon={purgeMut.isPending ? <CircularProgress size={12} /> : <DeleteOutlined />}
          onClick={() => purgeMut.mutate(7)}
          disabled={purgeMut.isPending}
        >
          Purge &gt; 7 days
        </Button>
      </Box>

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      {traces.length === 0 && !isLoading && (
        <Alert severity="info">No AI traces found. Traces are recorded when AI features are used.</Alert>
      )}

      {traces.map((t) => (
        <Accordion key={t.id} disableGutters elevation={0}
          expanded={expandedId === t.id}
          onChange={(_, open) => setExpandedId(open ? t.id : null)}
          sx={{ mb: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&::before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 44, px: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
              <Chip label={MODULE_LABELS[t.module] ?? t.module} size="small"
                sx={{ height: 20, fontSize: '0.625rem', fontWeight: 700, flexShrink: 0,
                  bgcolor: alpha(MODULE_COLORS[t.module] ?? '#64748b', 0.12),
                  color: MODULE_COLORS[t.module] ?? '#64748b' }}
              />
              <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary', flexShrink: 0 }}>
                {t.model}
              </Typography>
              {t.tokens_in != null && (
                <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                  {t.tokens_in}→{t.tokens_out} tok
                </Typography>
              )}
              {t.latency_ms != null && (
                <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                  {(t.latency_ms / 1000).toFixed(1)}s
                </Typography>
              )}
              <Typography variant="caption" color="text.disabled" noWrap sx={{ flex: 1 }}>
                {t.prompt_text?.slice(0, 80)}…
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                {new Date(t.created_at).toLocaleString()}
              </Typography>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(t.id) }}
                sx={{ flexShrink: 0 }}>
                <DeleteOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {t.prompt_text && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    PROMPT
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, maxHeight: 200, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>
                      {t.prompt_text}
                    </Typography>
                  </Paper>
                </Box>
              )}
              {t.response_text && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    RESPONSE
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, maxHeight: 200, overflow: 'auto',
                    bgcolor: (th) => alpha(th.palette.success.main, 0.04) }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>
                      {t.response_text}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  )
}

// ─── Email Settings Section ───────────────────────────────────────────────────
interface EmailSettingsSectionProps {
  smtpHost: string; setSmtpHost: (v: string) => void
  smtpPort: string; setSmtpPort: (v: string) => void
  smtpUser: string; setSmtpUser: (v: string) => void
  smtpPass: string; setSmtpPass: (v: string) => void
  fromAddr: string; setFromAddr: (v: string) => void
  testEmailMutation: { mutate: () => void; isPending: boolean }
  saveEmailMutation: { mutate: () => void; isPending: boolean }
}

function EmailSettingsSection({
  smtpHost, setSmtpHost, smtpPort, setSmtpPort,
  smtpUser, setSmtpUser, smtpPass, setSmtpPass,
  fromAddr, setFromAddr, testEmailMutation, saveEmailMutation,
}: EmailSettingsSectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: open ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setOpen((v) => !v)}
        >
          {open
            ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
            : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <EmailOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>SMTP Configuration</Typography>
          <Box sx={{ display: 'flex', gap: 1 }} onClick={(e) => e.stopPropagation()}>
            <Button size="small" variant="outlined"
              startIcon={testEmailMutation.isPending ? <CircularProgress size={12} color="inherit" /> : <SendOutlined />}
              onClick={() => testEmailMutation.mutate()} disabled={testEmailMutation.isPending || !smtpHost}>
              Send Test
            </Button>
            <Button size="small" variant="contained"
              startIcon={saveEmailMutation.isPending ? <CircularProgress size={12} color="inherit" /> : <SaveOutlined />}
              onClick={() => saveEmailMutation.mutate()} disabled={saveEmailMutation.isPending}>
              Save
            </Button>
          </Box>
        </Box>
        <Collapse in={open}>
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Configure outbound email settings for PS Support workflows and automated notifications.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="SMTP Host" size="small" value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com" sx={{ flex: 3 }} />
              <TextField label="Port" size="small" value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587" sx={{ flex: 1 }} />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="SMTP Username" size="small" value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="user@company.com" sx={{ flex: 1 }} />
              <TextField label="SMTP Password" size="small" type="password" value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="App password or token" sx={{ flex: 1 }} />
            </Box>
            <TextField label="From Address" size="small" value={fromAddr}
              onChange={(e) => setFromAddr(e.target.value)}
              placeholder="noreply@company.com" fullWidth />
          </Box>
        </Collapse>
      </Paper>
    </Box>
  )
}

// ─── Integrations Tab ────────────────────────────────────────────────────────
function IntegrationsTab({ projectId }: { projectId?: number }) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [editType, setEditType] = useState<'jira' | 'ado'>('jira')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ type: 'jira', base_url: '', username: '', token: '' })

  const { data: integrations = [], isLoading } = useQuery<IntegrationConfig[]>({
    queryKey: ['integrations', projectId],
    queryFn: () => integrationsApi.list(projectId),
  })

  const saveMut = useMutation({
    mutationFn: () => integrationsApi.save({ type: form.type, base_url: form.base_url, username: form.username || undefined, token: form.token, project_id: projectId ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      setDialogOpen(false)
      enqueueSnackbar('Integration saved', { variant: 'success' })
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (type: string) => integrationsApi.delete(type, projectId ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      enqueueSnackbar('Integration removed', { variant: 'info' })
    },
  })

  const openEdit = (type: 'jira' | 'ado') => {
    const existing = integrations.find((i) => i.type === type)
    setForm({ type, base_url: existing?.base_url ?? '', username: existing?.username ?? '', token: '' })
    setDialogOpen(true)
  }

  const CONFIGS: Array<{ type: 'jira' | 'ado'; label: string; placeholder: string; userLabel: string }> = [
    { type: 'jira', label: 'Jira', placeholder: 'https://company.atlassian.net', userLabel: 'User Email' },
    { type: 'ado',  label: 'Azure DevOps', placeholder: 'https://dev.azure.com/org/project', userLabel: 'Username (optional)' },
  ]

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ jira: true, ado: true })
  const toggleSection = (key: string) => setOpenSections((s) => ({ ...s, [key]: !s[key] }))

  if (!projectId) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography color="text.disabled">Select a project to configure integrations.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <LinkOutlined color="primary" sx={{ flexShrink: 0 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>External Integrations</Typography>
        <Chip label={`Project #${projectId}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Configure JIRA and Azure DevOps credentials for this project. In the Development tab, enter only the issue or work item number.
      </Typography>

      {CONFIGS.map(({ type, label, placeholder, userLabel }) => {
        const saved = integrations.find((i) => i.type === type)
        const isOpen = openSections[type] ?? true
        return (
          <Paper key={type} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: isOpen ? '1px solid' : 'none', borderColor: 'divider' }}
              onClick={() => toggleSection(type)}
            >
              {isOpen
                ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
                : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
              <LinkOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>{label}</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                {saved
                  ? <Chip label="Configured" color="success" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                  : <Chip label="Not configured" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />}
                <Button size="small" variant="outlined" startIcon={<EditOutlined />} onClick={() => openEdit(type)}>
                  {saved ? 'Edit' : 'Configure'}
                </Button>
                {saved && (
                  <Button size="small" color="error" variant="text" startIcon={<DeleteOutlined />}
                    onClick={() => deleteMut.mutate(type)} disabled={deleteMut.isPending}>
                    Remove
                  </Button>
                )}
              </Box>
            </Box>
            <Collapse in={isOpen}>
              <Box sx={{ px: 2, py: 1.5 }}>
                {saved ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Typography variant="caption" color="text.disabled" sx={{ minWidth: 70 }}>Base URL</Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{saved.base_url}</Typography>
                    </Box>
                    {saved.username && (
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Typography variant="caption" color="text.disabled" sx={{ minWidth: 70 }}>User</Typography>
                        <Typography variant="caption">{saved.username}</Typography>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Typography variant="caption" color="text.disabled" sx={{ minWidth: 70 }}>Token</Typography>
                      <Typography variant="caption">{saved.has_token ? '••••••••' : '(not set)'}</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.disabled">
                    Not configured — click Configure to add credentials.
                  </Typography>
                )}
              </Box>
            </Collapse>
          </Paper>
        )
      })}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Configure {form.type === 'jira' ? 'Jira' : 'Azure DevOps'}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField label="Base URL" size="small" fullWidth required
            placeholder={CONFIGS.find((c) => c.type === form.type)?.placeholder}
            value={form.base_url} onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))} />
          <TextField label={CONFIGS.find((c) => c.type === form.type)?.userLabel ?? 'Username'} size="small" fullWidth
            value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          <TextField label={form.type === 'jira' ? 'API Token' : 'Personal Access Token (PAT)'}
            size="small" fullWidth type="password" required
            helperText={integrations.find((i) => i.type === form.type)?.has_token ? 'Leave blank to keep existing token' : ''}
            value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.base_url}>
            {saveMut.isPending ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─── Feedback Tab ─────────────────────────────────────────────────────────────
const FEEDBACK_MODULES = ['All', 'General', 'Conversion', 'Reporting', 'PS Support', 'Development', 'Admin', 'Testing', 'Dashboards', 'AI Agents']
const FEEDBACK_STATUSES = [
  { value: 'all',         label: 'All',         color: 'default'  as const },
  { value: 'open',        label: 'Open',        color: 'primary'  as const },
  { value: 'in_progress', label: 'In Progress', color: 'warning'  as const },
  { value: 'resolved',    label: 'success',     color: 'success'  as const },
  { value: 'closed',      label: 'Closed',      color: 'default'  as const },
]
const FEEDBACK_TYPES = [
  { value: 'bug',         label: 'Bug',         icon: <BugReportOutlined sx={{ fontSize: 14 }} />,        color: '#EF4444' },
  { value: 'feature',     label: 'Feature',     icon: <StarOutlined sx={{ fontSize: 14 }} />,             color: '#8B5CF6' },
  { value: 'improvement', label: 'Improvement', icon: <TipsAndUpdatesOutlined sx={{ fontSize: 14 }} />,   color: '#3B82F6' },
  { value: 'question',    label: 'Question',    icon: <HelpOutlineOutlined sx={{ fontSize: 14 }} />,      color: '#F59E0B' },
  { value: 'praise',      label: 'Praise',      icon: <ThumbUpOutlined sx={{ fontSize: 14 }} />,          color: '#10B981' },
]
const PRIORITY_COLOR: Record<string, string> = { high: '#EF4444', medium: '#F59E0B', low: '#6B7280' }
const STATUS_CHIP_COLOR: Record<string, 'primary' | 'warning' | 'success' | 'default'> = {
  open: 'primary', in_progress: 'warning', resolved: 'success', closed: 'default',
}

function FeedbackTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('all')
  const [moduleFilter, setModuleFilter] = useState('All')
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [expanded,     setExpanded]     = useState<number | null>(null)
  const [editNotes,    setEditNotes]    = useState<Record<number, string>>({})
  const [editStatus,   setEditStatus]   = useState<Record<number, string>>({})

  const { data: entries = [], isLoading, refetch } = useQuery<FeedbackEntry[]>({
    queryKey: ['feedback', statusFilter, moduleFilter, typeFilter],
    queryFn:  () => feedbackApi.list({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      module: moduleFilter !== 'All' ? moduleFilter : undefined,
      type:   typeFilter   !== 'all' ? typeFilter   : undefined,
    }),
    staleTime: 0,
  })

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['feedback'] })
    qc.invalidateQueries({ queryKey: ['feedback-all'] })
  }

  const updateMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes: string }) =>
      feedbackApi.update(id, { status, admin_notes: notes }),
    onSuccess: () => {
      enqueueSnackbar('Feedback updated', { variant: 'success' })
      invalidateAll()
      setExpanded(null)
    },
    onError: () => enqueueSnackbar('Update failed', { variant: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => feedbackApi.remove(id),
    onSuccess: () => {
      enqueueSnackbar('Deleted', { variant: 'info' })
      invalidateAll()
    },
  })

  const openRow = (e: FeedbackEntry) => {
    setExpanded((prev) => prev === e.id ? null : e.id)
    setEditNotes((n) => ({ ...n, [e.id]: e.admin_notes ?? '' }))
    setEditStatus((s) => ({ ...s, [e.id]: e.status }))
  }

  const typeInfo = (type: string) => FEEDBACK_TYPES.find((t) => t.value === type) ?? FEEDBACK_TYPES[0]

  // Summary counts from all entries (regardless of current filter)
  const { data: allEntries = [] } = useQuery<FeedbackEntry[]>({
    queryKey: ['feedback-all'],
    queryFn: () => feedbackApi.list(),
    staleTime: 30_000,
  })
  const counts = allEntries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FeedbackOutlined color="primary" />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>User Feedback</Typography>
        <Tooltip title="Refresh"><IconButton size="small" onClick={() => { refetch(); invalidateAll() }}><RefreshOutlined fontSize="small" /></IconButton></Tooltip>
      </Box>

      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {[
          { label: 'Open',        key: 'open',        color: '#3B82F6' },
          { label: 'In Progress', key: 'in_progress', color: '#F59E0B' },
          { label: 'Resolved',    key: 'resolved',    color: '#10B981' },
          { label: 'Closed',      key: 'closed',      color: '#6B7280' },
        ].map((s) => (
          <Chip
            key={s.key} size="small"
            label={`${s.label}: ${counts[s.key] ?? 0}`}
            sx={{ bgcolor: alpha(s.color, 0.1), color: s.color, fontWeight: 700, border: `1px solid ${alpha(s.color, 0.3)}` }}
          />
        ))}
        <Chip size="small" label={`Total: ${allEntries.length}`} variant="outlined" sx={{ fontWeight: 600 }} />
      </Box>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterListOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />
          {/* Status */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {['all', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
              <Chip
                key={s} size="small"
                label={s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                onClick={() => setStatusFilter(s)}
                color={statusFilter === s ? STATUS_CHIP_COLOR[s] ?? 'primary' : 'default'}
                variant={statusFilter === s ? 'filled' : 'outlined'}
                sx={{ cursor: 'pointer', fontWeight: statusFilter === s ? 700 : 400, textTransform: 'capitalize' }}
              />
            ))}
          </Box>
          <Divider orientation="vertical" flexItem />
          {/* Module */}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} displayEmpty>
              {FEEDBACK_MODULES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </Select>
          </FormControl>
          {/* Type */}
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} displayEmpty>
              <MenuItem value="all">All Types</MenuItem>
              {FEEDBACK_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      </Paper>

      {/* Table */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {isLoading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
        ) : entries.length === 0 ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <FeedbackOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.disabled">No feedback entries found</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 110 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 100 }}>Module</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 90 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 70 }}>Priority</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Title</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 90 }}>By</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 100 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', width: 80 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((e) => {
                const ti = typeInfo(e.type)
                const isOpen = expanded === e.id
                return (
                  <>
                    <TableRow
                      key={e.id} hover
                      onClick={() => openRow(e)}
                      sx={{ cursor: 'pointer', bgcolor: isOpen ? (t) => alpha(t.palette.primary.main, 0.04) : 'inherit' }}
                    >
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(e.created_at).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" fontWeight={600}>{e.module ?? '—'}</Typography>
                        {e.area && <Typography variant="caption" color="text.disabled" display="block">{e.area}</Typography>}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small" icon={ti.icon}
                          label={ti.label}
                          sx={{ bgcolor: alpha(ti.color, 0.1), color: ti.color, border: `1px solid ${alpha(ti.color, 0.3)}`, height: 22, fontSize: '0.68rem', fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: PRIORITY_COLOR[e.priority ?? 'medium'] }} />
                          <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>{e.priority ?? 'medium'}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>{e.title}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">{e.submitted_by ?? 'anonymous'}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={e.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          color={STATUS_CHIP_COLOR[e.status] ?? 'default'}
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600, textTransform: 'capitalize' }}
                        />
                      </TableCell>
                      <TableCell align="right" onClick={(ev) => ev.stopPropagation()}>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => deleteMut.mutate(e.id)}>
                            <DeleteOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>

                    {/* Expanded detail row */}
                    {isOpen && (
                      <TableRow key={`${e.id}-detail`}>
                        <TableCell colSpan={8} sx={{ p: 0, borderBottom: '2px solid', borderColor: 'primary.main' }}>
                          <Box sx={{ p: 2.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.03), display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {/* Description */}
                            {e.description && (
                              <Box>
                                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Description</Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{e.description}</Typography>
                              </Box>
                            )}
                            {/* Page */}
                            {e.page_url && (
                              <Box>
                                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Page</Typography>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{e.page_url}</Typography>
                              </Box>
                            )}
                            {/* Admin controls */}
                            <Box sx={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 1.5, alignItems: 'flex-start' }}>
                              <FormControl size="small" fullWidth>
                                <InputLabel>Status</InputLabel>
                                <Select label="Status"
                                  value={editStatus[e.id] ?? e.status}
                                  onChange={(ev) => setEditStatus((s) => ({ ...s, [e.id]: ev.target.value }))}>
                                  <MenuItem value="open">Open</MenuItem>
                                  <MenuItem value="in_progress">In Progress</MenuItem>
                                  <MenuItem value="resolved">Resolved</MenuItem>
                                  <MenuItem value="closed">Closed</MenuItem>
                                </Select>
                              </FormControl>
                              <TextField
                                label="Admin Notes" size="small" fullWidth multiline minRows={2}
                                placeholder="Add notes for the team…"
                                value={editNotes[e.id] ?? ''}
                                onChange={(ev) => setEditNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                              />
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button size="small" variant="contained"
                                startIcon={updateMut.isPending ? <CircularProgress size={12} color="inherit" /> : <SaveOutlined />}
                                disabled={updateMut.isPending}
                                onClick={() => updateMut.mutate({ id: e.id, status: editStatus[e.id] ?? e.status, notes: editNotes[e.id] ?? '' })}>
                                Save
                              </Button>
                              <Button size="small" onClick={() => setExpanded(null)}>Collapse</Button>
                            </Box>
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  )
}

// ─── Debug Settings Tab ───────────────────────────────────────────────────────
const DEBUG_MODULE_META: Record<string, { label: string; description: string; color: string }> = {
  development:   { label: 'Development',    description: 'SQL plan & generate endpoints',           color: '#10b981' },
  mapping:       { label: 'Mapping',        description: 'Query generation from schema',            color: '#6366f1' },
  report:        { label: 'Report',         description: 'NL→SQL ask endpoint',                    color: '#0891b2' },
  reconciliation:{ label: 'Reconciliation', description: 'DEV vs BASE reconciliation',             color: '#f59e0b' },
  multi_compare: { label: 'Multi-Compare',  description: 'Multi-source AI comparison',             color: '#8b5cf6' },
}

const LEVEL_COLORS: Record<string, string> = { OFF: '#6b7280', BASIC: '#0891b2', ADVANCED: '#dc2626' }

function DebugSettingsTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [subTab, setSubTab] = useState(0)
  const [traceModule, setTraceModule] = useState<string>('')
  const [traceId, setTraceId] = useState('')
  const [purgeOpen, setPurgeOpen] = useState(false)
  const setDebugLevels = useAppStore((s) => s.setDebugLevels)

  const { data: settingsResp, isLoading } = useQuery({
    queryKey: ['debug-settings'],
    queryFn: () => debugSettingsApi.getAll(),
  })

  const { data: tracesResp, isLoading: tracesLoading, refetch: refetchTraces } = useQuery({
    queryKey: ['debug-traces', traceModule, traceId],
    queryFn: () => debugSettingsApi.getTraces({ module: traceModule || undefined, trace_id: traceId || undefined, limit: 50 }),
    enabled: subTab === 1,
  })

  const [localLevels, setLocalLevels] = useState<Record<string, DebugLevel>>({})

  useEffect(() => {
    if (settingsResp?.settings) {
      const m: Record<string, DebugLevel> = {}
      settingsResp.settings.forEach((s: DebugSetting) => { m[s.module] = s.debug_level })
      setLocalLevels(m)
    }
  }, [settingsResp])

  const saveMut = useMutation({
    mutationFn: () => debugSettingsApi.saveAll(
      Object.entries(localLevels).map(([module, debug_level]) => ({ module: module as DebugSetting['module'], debug_level }))
    ),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['debug-settings'] })
      setDebugLevels(Object.fromEntries(resp.settings.map((s: DebugSetting) => [s.module, s.debug_level])))
      enqueueSnackbar('Debug settings saved', { variant: 'success' })
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const purgeMut = useMutation({
    mutationFn: () => debugSettingsApi.deleteTraces(7),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debug-traces'] })
      refetchTraces()
      setPurgeOpen(false)
      enqueueSnackbar('Traces purged', { variant: 'info' })
    },
    onError: () => enqueueSnackbar('Purge failed', { variant: 'error' }),
  })

  const traces: DebugTraceRecord[] = (tracesResp as any)?.traces ?? []

  const hasChanges = settingsResp?.settings?.some(
    (s: DebugSetting) => localLevels[s.module] !== s.debug_level
  ) ?? false

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <BugReportOutlined sx={{ color: '#dc2626' }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>Debug Settings</Typography>
        <Alert severity="info" sx={{ py: 0.25, px: 1, fontSize: '0.78rem' }}>
          Changes apply to all AI calls system-wide. Use BASIC for active development, ADVANCED for audit trails.
        </Alert>
      </Box>

      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}>
        <Tab label="Module Settings" sx={{ textTransform: 'none', fontSize: '0.85rem' }} />
        <Tab label="Debug Traces" sx={{ textTransform: 'none', fontSize: '0.85rem' }} />
      </Tabs>

      {subTab === 0 && (
        <>
          {isLoading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
          ) : (
            <Grid container spacing={2}>
              {Object.entries(DEBUG_MODULE_META).map(([module, meta]) => {
                const level: DebugLevel = localLevels[module] ?? 'OFF'
                return (
                  <Grid item xs={12} md={6} key={module}>
                    <Paper variant="outlined" sx={{ borderRadius: 2, borderLeft: `4px solid ${meta.color}`, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography fontWeight={700} sx={{ flex: 1 }}>{meta.label}</Typography>
                        <Chip
                          label={level}
                          size="small"
                          sx={{ bgcolor: alpha(LEVEL_COLORS[level], 0.12), color: LEVEL_COLORS[level], fontWeight: 700, fontSize: '0.72rem' }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">{meta.description}</Typography>
                      <ToggleButtonGroup
                        value={level}
                        exclusive
                        size="small"
                        onChange={(_, v) => { if (v) setLocalLevels((prev) => ({ ...prev, [module]: v as DebugLevel })) }}
                        sx={{ '& .MuiToggleButton-root': { fontSize: '0.75rem', py: 0.4, px: 1.5, textTransform: 'none' } }}
                      >
                        <ToggleButton value="OFF">OFF</ToggleButton>
                        <ToggleButton value="BASIC" sx={{ '&.Mui-selected': { color: '#0891b2', bgcolor: alpha('#0891b2', 0.1) } }}>BASIC</ToggleButton>
                        <ToggleButton value="ADVANCED" sx={{ '&.Mui-selected': { color: '#dc2626', bgcolor: alpha('#dc2626', 0.1) } }}>ADVANCED</ToggleButton>
                      </ToggleButtonGroup>
                      {level === 'BASIC' && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          Returns debug steps in response. No DB write.
                        </Typography>
                      )}
                      {level === 'ADVANCED' && (
                        <Typography variant="caption" sx={{ color: '#dc2626', fontStyle: 'italic' }}>
                          Returns debug steps + persists to DB for audit trail. Disable when not needed.
                        </Typography>
                      )}
                    </Paper>
                  </Grid>
                )
              })}
            </Grid>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button
              variant="contained"
              startIcon={saveMut.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !hasChanges}
            >
              Save Settings
            </Button>
          </Box>
        </>
      )}

      {subTab === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Module</InputLabel>
              <Select value={traceModule} label="Module" onChange={(e) => setTraceModule(e.target.value)}>
                <MenuItem value="">All modules</MenuItem>
                {Object.entries(DEBUG_MODULE_META).map(([m, meta]) => (
                  <MenuItem key={m} value={m}>{meta.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField size="small" label="Trace ID" value={traceId} onChange={(e) => setTraceId(e.target.value)} sx={{ minWidth: 280 }} placeholder="UUID filter…" />
            <Tooltip title="Refresh"><IconButton size="small" onClick={() => refetchTraces()}><RefreshOutlined fontSize="small" /></IconButton></Tooltip>
            <Box sx={{ flex: 1 }} />
            <Button size="small" color="error" variant="outlined" startIcon={<DeleteOutlined />} onClick={() => setPurgeOpen(true)}>
              Purge (7d+)
            </Button>
          </Box>

          {tracesLoading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
          ) : traces.length === 0 ? (
            <Box sx={{ p: 5, textAlign: 'center' }}>
              <BugReportOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.disabled">No traces found. Set a module to ADVANCED and run an AI action.</Typography>
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Trace ID</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Module</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Level</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Steps</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {traces.map((t) => {
                    let stepCount = 0
                    try { stepCount = t.steps_json ? JSON.parse(t.steps_json).length : 0 } catch { stepCount = 0 }
                    return (
                      <TableRow key={t.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem', maxWidth: 280 }}>
                          <Tooltip title={t.trace_id}><span style={{ cursor: 'pointer' }}>{t.trace_id.slice(0, 8)}…</span></Tooltip>
                        </TableCell>
                        <TableCell>
                          <Chip label={DEBUG_MODULE_META[t.module]?.label ?? t.module} size="small"
                            sx={{ fontSize: '0.72rem', bgcolor: alpha(DEBUG_MODULE_META[t.module]?.color ?? '#888', 0.12), color: DEBUG_MODULE_META[t.module]?.color ?? '#888' }} />
                        </TableCell>
                        <TableCell>
                          <Chip label={t.debug_level} size="small"
                            sx={{ fontSize: '0.72rem', bgcolor: alpha(LEVEL_COLORS[t.debug_level] ?? '#888', 0.12), color: LEVEL_COLORS[t.debug_level] ?? '#888', fontWeight: 700 }} />
                        </TableCell>
                        <TableCell><Chip label={stepCount} size="small" variant="outlined" sx={{ fontSize: '0.72rem' }} /></TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                          {new Date(t.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Paper>
          )}

          <Dialog open={purgeOpen} onClose={() => setPurgeOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>Purge Old Traces</DialogTitle>
            <DialogContent>
              <Typography>Delete all debug traces older than 7 days? This cannot be undone.</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPurgeOpen(false)}>Cancel</Button>
              <Button color="error" variant="contained" onClick={() => purgeMut.mutate()} disabled={purgeMut.isPending}>
                {purgeMut.isPending ? 'Purging…' : 'Purge'}
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      )}
    </Box>
  )
}

// ─── Approvals Tab ───────────────────────────────────────────────────────────
const PROJECT_ROLES = ['manager', 'team_lead', 'developer']

function ApprovalsTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [subTab, setSubTab] = useState(0)
  const [decideOpen, setDecideOpen] = useState(false)
  const [decideTarget, setDecideTarget] = useState<ApprovalRequest | null>(null)
  const [decideAction, setDecideAction] = useState<'approve' | 'reject'>('approve')
  const [decideNotes, setDecideNotes] = useState('')

  // Workflow editor state
  const [wfProjectId, setWfProjectId] = useState<number | ''>('')
  const [wfDialogOpen, setWfDialogOpen] = useState(false)
  const [wfEditTarget, setWfEditTarget] = useState<ApprovalWorkflow | null>(null)
  const [wfForm, setWfForm] = useState({ name: '', description: '', is_active: true })
  const [wfSteps, setWfSteps] = useState<Omit<WorkflowStep, 'id'>[]>([])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const { data: pendingRequests = [], isLoading: pendingLoading } = useQuery({
    queryKey: ['approval-requests-pending'],
    queryFn: () => approvalRequestsApi.listForMe(),
    refetchInterval: 30000,
  })

  const { data: allRequests = [], isLoading: allLoading } = useQuery({
    queryKey: ['approval-requests-all'],
    queryFn: () => approvalRequestsApi.listAll(),
    enabled: subTab === 1,
  })

  const { data: workflows = [] } = useQuery({
    queryKey: ['approval-workflows', wfProjectId],
    queryFn: () => wfProjectId ? approvalWorkflowsApi.list(wfProjectId as number) : Promise.resolve([]),
    enabled: Boolean(wfProjectId),
  })

  const decideMut = useMutation({
    mutationFn: () => approvalRequestsApi.decide(decideTarget!.id, decideAction, decideNotes || undefined),
    onSuccess: () => {
      enqueueSnackbar(`Request ${decideAction === 'approve' ? 'approved' : 'rejected'}`, { variant: decideAction === 'approve' ? 'success' : 'warning' })
      setDecideOpen(false)
      setDecideNotes('')
      qc.invalidateQueries({ queryKey: ['approval-requests-pending'] })
      qc.invalidateQueries({ queryKey: ['approval-requests-all'] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteWfMut = useMutation({
    mutationFn: (wf: ApprovalWorkflow) => approvalWorkflowsApi.delete(wf.project_id, wf.id),
    onSuccess: () => { enqueueSnackbar('Workflow deleted', { variant: 'info' }); qc.invalidateQueries({ queryKey: ['approval-workflows'] }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveWfMut = useMutation({
    mutationFn: () => {
      const payload = { ...wfForm, steps: wfSteps }
      return wfEditTarget
        ? approvalWorkflowsApi.update(wfEditTarget.project_id, wfEditTarget.id, payload)
        : approvalWorkflowsApi.create(wfProjectId as number, payload)
    },
    onSuccess: () => {
      enqueueSnackbar('Workflow saved', { variant: 'success' })
      setWfDialogOpen(false)
      qc.invalidateQueries({ queryKey: ['approval-workflows'] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  function openWfCreate() {
    setWfEditTarget(null)
    setWfForm({ name: '', description: '', is_active: true })
    setWfSteps([{ step_order: 1, step_name: 'Manager Approval', required_role: 'manager' }])
    setWfDialogOpen(true)
  }

  function openWfEdit(wf: ApprovalWorkflow) {
    setWfEditTarget(wf)
    setWfForm({ name: wf.name, description: wf.description ?? '', is_active: wf.is_active })
    setWfSteps(wf.steps.map(s => ({ step_order: s.step_order, step_name: s.step_name, required_role: s.required_role })))
    setWfDialogOpen(true)
  }

  function addStep() {
    const maxOrder = wfSteps.reduce((m, s) => Math.max(m, s.step_order), 0)
    setWfSteps([...wfSteps, { step_order: maxOrder + 1, step_name: 'New Step', required_role: 'manager' }])
  }

  function removeStep(i: number) {
    setWfSteps(wfSteps.filter((_, idx) => idx !== i))
  }

  function updateStep(i: number, field: string, val: string) {
    setWfSteps(wfSteps.map((s, idx) => idx === i ? { ...s, [field]: val } : s))
  }

  const statusColor = (s: string) => {
    if (s === 'approved') return 'success'
    if (s === 'rejected') return 'error'
    if (s === 'in_progress') return 'warning'
    return 'default'
  }

  const RequestTable = ({ requests, loading }: { requests: ApprovalRequest[], loading: boolean }) => (
    loading ? <CircularProgress size={28} sx={{ m: 2 }} /> :
    requests.length === 0 ? (
      <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
        No requests
      </Typography>
    ) : (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Project</TableCell>
            <TableCell>Context</TableCell>
            <TableCell>Requested by</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Current Step</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {requests.map(req => {
            const currentDecision = req.decisions.find(d => d.step_order === req.current_step_order)
            return (
              <TableRow key={req.id} hover>
                <TableCell>{req.project_name ?? req.project_id}</TableCell>
                <TableCell>
                  <Chip label={req.context_type.replace(/_/g, ' ')} size="small" />
                </TableCell>
                <TableCell>{req.triggered_by_username}</TableCell>
                <TableCell>
                  <Chip label={req.status} size="small" color={statusColor(req.status) as any} />
                </TableCell>
                <TableCell>
                  {currentDecision ? (
                    <Typography variant="caption">
                      Step {req.current_step_order}: {currentDecision.step_name}
                      {' '}(<em>{currentDecision.required_role.replace('_', ' ')}</em>)
                    </Typography>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  {req.status === 'in_progress' && (
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Approve">
                        <IconButton size="small" color="success" onClick={() => { setDecideTarget(req); setDecideAction('approve'); setDecideOpen(true) }}>
                          <CheckOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Reject">
                        <IconButton size="small" color="error" onClick={() => { setDecideTarget(req); setDecideAction('reject'); setDecideOpen(true) }}>
                          <ThumbDownOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  )

  return (
    <Box>
      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={`Pending My Action${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}`} sx={{ textTransform: 'none' }} />
        <Tab label="All Requests" sx={{ textTransform: 'none' }} />
        <Tab label="Workflows" sx={{ textTransform: 'none' }} />
      </Tabs>

      {subTab === 0 && (
        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <RequestTable requests={pendingRequests} loading={pendingLoading} />
        </Paper>
      )}

      {subTab === 1 && (
        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <RequestTable requests={allRequests} loading={allLoading} />
        </Paper>
      )}

      {subTab === 2 && (
        <Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Project</InputLabel>
              <Select
                label="Project"
                value={wfProjectId}
                onChange={(e) => setWfProjectId(e.target.value as number)}
              >
                {(projects as any[]).map((p: any) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddOutlined />}
              disabled={!wfProjectId}
              onClick={openWfCreate}
            >
              New Workflow
            </Button>
          </Box>

          {wfProjectId && (
            <Paper variant="outlined" sx={{ overflow: 'auto' }}>
              {workflows.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                  No workflows for this project. Create one to enable approval gating.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Steps</TableCell>
                      <TableCell>Active</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workflows.map((wf) => (
                      <TableRow key={wf.id} hover>
                        <TableCell>{wf.name}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {wf.steps.map(s => (
                              <Chip key={s.id} label={`${s.step_order}. ${s.step_name}`} size="small" variant="outlined" />
                            ))}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip label={wf.is_active ? 'Active' : 'Inactive'} size="small" color={wf.is_active ? 'success' : 'default'} />
                        </TableCell>
                        <TableCell>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => openWfEdit(wf)}>
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" color="error" onClick={() => deleteWfMut.mutate(wf)}>
                              <DeleteOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paper>
          )}
        </Box>
      )}

      {/* Decide Dialog */}
      <Dialog open={decideOpen} onClose={() => setDecideOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{decideAction === 'approve' ? 'Approve Request' : 'Reject Request'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            {decideTarget && `${decideTarget.context_type.replace(/_/g, ' ')} — requested by ${decideTarget.triggered_by_username}`}
          </Typography>
          <TextField
            label="Notes (optional)"
            multiline
            rows={3}
            fullWidth
            value={decideNotes}
            onChange={(e) => setDecideNotes(e.target.value)}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecideOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={decideAction === 'approve' ? 'success' : 'error'}
            onClick={() => decideMut.mutate()}
            disabled={decideMut.isPending}
          >
            {decideAction === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Workflow Edit Dialog */}
      <Dialog open={wfDialogOpen} onClose={() => setWfDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{wfEditTarget ? 'Edit Workflow' : 'New Approval Workflow'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Workflow Name"
              fullWidth
              value={wfForm.name}
              onChange={(e) => setWfForm({ ...wfForm, name: e.target.value })}
            />
            <TextField
              label="Description (optional)"
              fullWidth
              value={wfForm.description}
              onChange={(e) => setWfForm({ ...wfForm, description: e.target.value })}
            />
            <FormControlLabel
              control={<Checkbox checked={wfForm.is_active} onChange={(e) => setWfForm({ ...wfForm, is_active: e.target.checked })} />}
              label="Active (gates agent/pipeline execution)"
            />
            <Divider />
            <Typography variant="subtitle2">Approval Steps</Typography>
            {wfSteps.map((step, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ minWidth: 24, color: 'text.secondary' }}>{i + 1}.</Typography>
                <TextField
                  size="small"
                  label="Step Name"
                  value={step.step_name}
                  onChange={(e) => updateStep(i, 'step_name', e.target.value)}
                  sx={{ flex: 1 }}
                />
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>Role</InputLabel>
                  <Select
                    label="Role"
                    value={step.required_role}
                    onChange={(e) => updateStep(i, 'required_role', e.target.value)}
                  >
                    {PROJECT_ROLES.map(r => (
                      <MenuItem key={r} value={r}>{r.replace('_', ' ')}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Tooltip title="Remove step">
                  <IconButton size="small" color="error" onClick={() => removeStep(i)}>
                    <CloseOutlined fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
            <Button size="small" startIcon={<AddOutlined />} onClick={addStep}>Add Step</Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWfDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => saveWfMut.mutate()}
            disabled={saveWfMut.isPending || !wfForm.name}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const { enqueueSnackbar } = useSnackbar()
  const { activeConnection, setActiveConnection, activeProject } = useAppStore()
  const connId = activeConnection?.id ?? ''

  // Auto-select first available connection if none is active
  const { data: allConnections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn: () => connectionsApi.list(activeProject?.id),
  })
  useEffect(() => {
    if (!activeConnection && allConnections.length > 0) {
      setActiveConnection(allConnections[0])
    }
  }, [activeConnection, allConnections, setActiveConnection])
  const logRef = useRef<HTMLDivElement>(null)

  const [mainTab, setMainTab] = useState(0)
  const [openAiKey, setOpenAiKey] = useState('')
  const [logLines, setLogLines] = useState<SseLine[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [catalogTab, setCatalogTab] = useState(0)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [showMetadata, setShowMetadata] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(true)
  const [embeddingOpen, setEmbeddingOpen] = useState(true)
  const [logSource, setLogSource] = useState<'discovery' | 'embedding' | null>(null)
  const [queryContext, setQueryContext] = useState('')
  const contextConnId = connId

  // Email settings
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [fromAddr, setFromAddr] = useState('')

  // OpenAI key status from .env
  const { data: keyStatus } = useQuery({
    queryKey: ['openai-key-status'],
    queryFn: adminApi.getOpenAiKeyStatus,
    staleTime: Infinity,
  })

  // Auto-load OpenAI key from .env
  useEffect(() => {
    adminApi.getOpenAiKey().then((r) => {
      if (r.api_key) setOpenAiKey(r.api_key)
    }).catch(() => {})
  }, [])

  // Reset catalog/logs when connection changes, and reload query context
  const prevConnIdRef = useRef<number | ''>(connId)
  useEffect(() => {
    if (prevConnIdRef.current !== connId) {
      prevConnIdRef.current = connId
      setCatalog(null)
      setLogLines([])
      setShowMetadata(false)
      setQueryContext('')
    }
  }, [connId])  // loadContext intentionally excluded — called imperatively below

  // Append log line and auto-scroll
  const appendLog = useCallback((line: SseLine) => {
    setLogLines((prev) => [...prev, line])
    setTimeout(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
    }, 0)
  }, [])

  // Load email settings on mount
  const { data: emailSettings } = useQuery({
    queryKey: ['email-settings'],
    queryFn: psApi.getEmailSettings,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (emailSettings) {
      setSmtpHost((emailSettings as any).smtp_host ?? '')
      setSmtpPort(String((emailSettings as any).smtp_port ?? 587))
      setSmtpUser((emailSettings as any).smtp_user ?? '')
      setFromAddr((emailSettings as any).from_address ?? '')
    }
  }, [emailSettings])

  const [schemaDelta, setSchemaDelta] = useState(false)
  const [embeddingDelta, setEmbeddingDelta] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterSchemas, setFilterSchemas] = useState('')
  const [filterInclude, setFilterInclude] = useState('')
  const [filterExclude, setFilterExclude] = useState('')
  const [filterViews, setFilterViews] = useState(true)

  const parseList = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean)
  const activeFilterCount = [filterSchemas, filterInclude, filterExclude].filter(Boolean).length + (!filterViews ? 1 : 0)

  // Discover schema (POST + SSE stream)
  const startDiscovery = async (forceDelta?: boolean) => {
    if (!connId) { enqueueSnackbar('Select a connection first', { variant: 'warning' }); return }
    const useDelta = forceDelta ?? schemaDelta
    setLogLines([])
    setLogSource('discovery')
    if (!useDelta) setCatalog(null)
    setIsDiscovering(true)
    setSchemaOpen(true)
    appendLog({ type: 'info', msg: useDelta ? '⏳ Starting delta schema sync…' : '⏳ Starting schema discovery…' })
    try {
      const url = `/api/admin/discover/${connId}`
      await streamPost(url, {
        delta: useDelta,
        include_schemas: parseList(filterSchemas),
        include_tables:  parseList(filterInclude),
        exclude_tables:  parseList(filterExclude),
        include_views:   filterViews,
      }, (evt) => {
        appendLog(evt)
      })
      enqueueSnackbar(useDelta ? 'Schema delta sync complete' : 'Schema discovery complete', { variant: 'success' })
      // Auto-load catalog
      const cat = await adminApi.getCatalog(connId as number)
      setCatalog(cat)
      setCatalogTab(0)
    } catch (e: any) {
      appendLog({ type: 'error', msg: `✗ ${e.message}` })
      enqueueSnackbar(e.message, { variant: 'error' })
    } finally {
      setIsDiscovering(false)
    }
  }

  // Generate embeddings (POST + SSE stream)
  const startEmbedding = async (forceDelta?: boolean) => {
    if (!connId) { enqueueSnackbar('Select a connection first', { variant: 'warning' }); return }
    const useDelta = forceDelta ?? embeddingDelta
    const key = openAiKey.trim()
    if (!key && !keyStatus?.configured) {
      enqueueSnackbar('Enter an OpenAI API key (or set OPENAI_API_KEY in .env)', { variant: 'warning' })
      return
    }
    setLogLines([])
    setLogSource('embedding')
    setIsEmbedding(true)
    setEmbeddingOpen(true)
    appendLog({ type: 'info', msg: useDelta ? '⏳ Starting delta embeddings…' : '⏳ Starting embedding generation…' })
    try {
      await streamPost(
        `/api/admin/embeddings/${connId}`,
        { api_key: key, model: 'text-embedding-3-small', chat_model: 'gpt-4o-mini', delta: useDelta },
        (evt) => appendLog(evt),
      )
      enqueueSnackbar(useDelta ? 'Delta embeddings complete' : 'Embeddings generated', { variant: 'success' })
    } catch (e: any) {
      appendLog({ type: 'error', msg: `✗ ${e.message}` })
      enqueueSnackbar(e.message, { variant: 'error' })
    } finally {
      setIsEmbedding(false)
    }
  }

  const clearMutation = useMutation({
    mutationFn: () => adminApi.clearCatalog(connId as number),
    onSuccess: () => {
      setCatalog(null)
      setLogLines([])
      enqueueSnackbar('Catalog cleared', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const viewCatalog = useMutation({
    mutationFn: () => adminApi.getCatalog(connId as number),
    onSuccess: (cat) => { setCatalog(cat); setCatalogTab(0) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveContextMutation = useMutation({
    mutationFn: () => queryApi.saveContext(contextConnId as number, queryContext),
    onSuccess: () => enqueueSnackbar('Context saved', { variant: 'success' }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const loadContext = useMutation({
    mutationFn: () => queryApi.getContext(contextConnId as number),
    onSuccess: (r) => setQueryContext((r as any)?.content ?? ''),
    onError: () => setQueryContext(''),
  })

  // Auto-load query context whenever the active connection changes
  useEffect(() => {
    if (contextConnId) loadContext.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextConnId])

  const saveEmailMutation = useMutation({
    mutationFn: () => psApi.saveEmailSettings({
      smtp_host: smtpHost, smtp_port: Number(smtpPort),
      smtp_user: smtpUser, smtp_pass: smtpPass, from_address: fromAddr, use_tls: true,
    }),
    onSuccess: () => enqueueSnackbar('Email settings saved', { variant: 'success' }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const testEmailMutation = useMutation({
    mutationFn: () => psApi.testEmail(),
    onSuccess: () => enqueueSnackbar('Test email sent successfully', { variant: 'success' }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const sampleCount = catalog ? (catalog as any).samples_list?.length ?? (catalog as any).sample_count ?? 0 : 0

  return (
    <Box sx={{ p: 3 }}>
      {/* Main tabs */}
      <Tabs value={mainTab} onChange={(_, v) => setMainTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab icon={<SchemaOutlined />} iconPosition="start" label="Schema Tools" sx={{ textTransform: 'none' }} />
        <Tab icon={<QuizOutlined />} iconPosition="start" label="Query Context" sx={{ textTransform: 'none' }} />
        <Tab icon={<EmailOutlined />} iconPosition="start" label="Email Settings" sx={{ textTransform: 'none' }} />
        <Tab icon={<SmartToyOutlined />} iconPosition="start" label="Prompt Templates" sx={{ textTransform: 'none' }} />
        <Tab icon={<AutoAwesomeOutlined />} iconPosition="start" label="AI Intelligence" sx={{ textTransform: 'none' }} />
        <Tab icon={<LinkOutlined />} iconPosition="start" label="Integrations" sx={{ textTransform: 'none' }} />
        <Tab icon={<TimelineOutlined />} iconPosition="start" label="AI Traces" sx={{ textTransform: 'none' }} />
        <Tab icon={<BugReportOutlined sx={{ color: mainTab === 7 ? '#dc2626' : undefined }} />} iconPosition="start" label="Debug" sx={{ textTransform: 'none' }} />
        <Tab icon={<FeedbackOutlined />} iconPosition="start" label="Feedback" sx={{ textTransform: 'none' }} />
        <Tab icon={<HowToVoteOutlined />} iconPosition="start" label="Approvals" sx={{ textTransform: 'none' }} />
      </Tabs>

      {/* ── Schema Tools ── */}
      {mainTab === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* ── 1. Schema Discovery ── */}
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: schemaOpen ? '1px solid' : 'none', borderColor: 'divider' }}
              onClick={() => setSchemaOpen((v) => !v)}
            >
              {schemaOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
              <SchemaOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Schema Discovery</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                {catalog && (
                  <>
                    {[
                      { label: `${(catalog.summary as any).table_count ?? 0} tables`, color: 'primary' as const },
                      { label: `${(catalog.summary as any).col_count ?? (catalog.summary as any).column_count ?? 0} cols`, color: 'default' as const },
                      { label: `${(catalog.summary as any).rel_count ?? (catalog.summary as any).relation_count ?? 0} rels`, color: 'success' as const },
                    ].map(({ label, color }) => (
                      <Chip key={label} label={label} size="small" color={color} variant="outlined" sx={{ height: 20, fontSize: '0.68rem' }} />
                    ))}
                  </>
                )}
                {isDiscovering && <Chip label="Collecting…" size="small" color="info" sx={{ height: 20, fontSize: '0.68rem' }} />}
                <Button size="small" variant="contained"
                  startIcon={isDiscovering ? <CircularProgress size={12} color="inherit" /> : <SearchOutlined />}
                  onClick={() => startDiscovery()} disabled={!connId || isDiscovering}>
                  {isDiscovering ? 'Collecting…' : (schemaDelta ? 'Sync Changes' : 'Collect Schema')}
                </Button>
                <Tooltip title={schemaDelta ? 'Delta: only adds new tables/columns, keeps existing' : 'Full refresh: clears and re-collects everything'}>
                  <FormControlLabel
                    control={<Switch size="small" checked={schemaDelta} onChange={(e) => setSchemaDelta(e.target.checked)} disabled={isDiscovering} />}
                    label={<Typography variant="caption" color="text.secondary">Delta</Typography>}
                    sx={{ ml: 0.5, mr: 0 }}
                  />
                </Tooltip>
                <Button size="small" variant="outlined"
                  startIcon={viewCatalog.isPending ? <CircularProgress size={12} /> : <TableChartOutlined />}
                  onClick={() => viewCatalog.mutate()} disabled={!connId || viewCatalog.isPending}>
                  View Catalog
                </Button>
                <Button size="small" variant="outlined" startIcon={<EditOutlined />}
                  onClick={(e) => { e.stopPropagation(); setShowMetadata((v) => !v) }} disabled={!connId}>
                  {showMetadata ? 'Hide Metadata' : 'Edit Metadata'}
                </Button>
                <Button size="small" variant="outlined" color="error" startIcon={<ClearOutlined />}
                  onClick={(e) => { e.stopPropagation(); setClearConfirmOpen(true) }} disabled={!connId || clearMutation.isPending}>
                  Clear
                </Button>
              </Box>
            </Box>
            <Collapse in={schemaOpen}>
              <Box sx={{ p: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1.5, pb: 0.5 }}>
                  Scan tables, columns, relations and sample rows from the selected data source. Results appear below after collection.
                </Typography>

                {/* Filter panel */}
                <Box sx={{ px: 2, pb: filterOpen ? 1.5 : 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button size="small" variant={filterOpen ? 'contained' : 'outlined'} color="inherit"
                      startIcon={<FilterAltOutlined sx={{ fontSize: 14 }} />}
                      onClick={() => setFilterOpen(v => !v)}
                      sx={{ fontSize: '0.72rem', py: 0.3, px: 1, minWidth: 0 }}>
                      Filters
                      {activeFilterCount > 0 && (
                        <Box component="span" sx={{ ml: 0.5, px: 0.6, py: 0.1, borderRadius: 1, bgcolor: 'primary.main', color: '#fff', fontSize: '0.65rem', lineHeight: 1.4 }}>
                          {activeFilterCount}
                        </Box>
                      )}
                    </Button>
                    {activeFilterCount > 0 && !filterOpen && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        {[filterSchemas && `schemas: ${filterSchemas}`, filterInclude && `include: ${filterInclude}`, filterExclude && `exclude: ${filterExclude}`, !filterViews && 'no views'].filter(Boolean).join(' · ')}
                      </Typography>
                    )}
                  </Box>
                  <Collapse in={filterOpen}>
                    <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <TextField size="small" label="Schemas" placeholder="dbo, sales (empty = all)"
                          value={filterSchemas} onChange={e => setFilterSchemas(e.target.value)}
                          sx={{ flex: 1, minWidth: 180 }} disabled={isDiscovering} />
                        <TextField size="small" label="Include tables" placeholder="*Customer*, Orders (wildcards ok)"
                          value={filterInclude} onChange={e => setFilterInclude(e.target.value)}
                          sx={{ flex: 1, minWidth: 220 }} disabled={isDiscovering} />
                        <TextField size="small" label="Exclude tables" placeholder="*_log, *_tmp, *_bak"
                          value={filterExclude} onChange={e => setFilterExclude(e.target.value)}
                          sx={{ flex: 1, minWidth: 180 }} disabled={isDiscovering} />
                      </Box>
                      <FormControlLabel
                        control={<Switch size="small" checked={filterViews} onChange={e => setFilterViews(e.target.checked)} disabled={isDiscovering} />}
                        label={<Typography variant="caption" color="text.secondary">Collect view definitions</Typography>}
                        sx={{ m: 0 }}
                      />
                    </Box>
                  </Collapse>
                </Box>

                {/* Live log — discovery only */}
                {logLines.length > 0 && logSource === 'discovery' && (
                  <Box sx={{ px: 2, pt: 1.5, pb: catalog ? 0 : 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', mr: 1, flexShrink: 0,
                        bgcolor: isDiscovering ? '#10b981' : '#475569',
                        animation: isDiscovering ? 'pulse 1.5s infinite' : 'none',
                        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
                      }} />
                      <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }} color={isDiscovering ? 'success.main' : 'text.secondary'}>
                        {isDiscovering ? 'Running…' : 'Completed'}
                      </Typography>
                      <IconButton size="small" onClick={() => setLogLines([])}>
                        <ClearOutlined sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Box>
                    <Box ref={logRef} sx={{ height: 180, overflow: 'auto', p: 1.5, borderRadius: 1.5, bgcolor: '#0d1117', border: '1px solid', borderColor: alpha('#60a5fa', 0.15) }}>
                      {logLines.map((line, i) => <LogLine key={i} {...line} />)}
                      {isDiscovering && (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: '#60a5fa', mt: 1 }}>
                          <CircularProgress size={10} color="inherit" />
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#60a5fa' }}>Discovering schema…</Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )}

                {/* Metadata Editor (inline) */}
                {showMetadata && connId && (
                  <Box sx={{ px: 2, pt: 1.5, pb: 2, borderTop: logLines.length > 0 ? '1px solid' : 'none', borderColor: 'divider' }}>
                    <MetadataEditor connId={connId as number} onClose={() => setShowMetadata(false)} />
                  </Box>
                )}

                {/* Catalog viewer */}
                {catalog && !showMetadata && (
                  <Box sx={{ px: 2, pt: 1.5, pb: 2, borderTop: logLines.length > 0 ? '1px solid' : 'none', borderColor: 'divider' }}>
                    {/* Summary KPI strip */}
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Tables',    value: (catalog.summary as any).table_count   ?? 0, icon: <TableChartOutlined />,  color: '#2563eb' },
                        { label: 'Columns',   value: (catalog.summary as any).col_count     ?? (catalog.summary as any).column_count   ?? 0, icon: <GridOnOutlined />,       color: '#7c3aed' },
                        { label: 'Relations', value: (catalog.summary as any).rel_count     ?? (catalog.summary as any).relation_count ?? 0, icon: <AccountTreeOutlined />,  color: '#10b981' },
                        { label: 'Views',     value: (catalog.summary as any).view_count    ?? 0, icon: <VisibilityOutlined />,   color: '#f59e0b' },
                        { label: 'Sampled',   value: (catalog.summary as any).sample_count  ?? sampleCount, icon: <GridOnOutlined />, color: '#0284c7' },
                      ].map(({ label, value, icon, color }) => (
                        <Paper
                          key={label}
                          variant="outlined"
                          sx={{
                            px: 2, py: 1.5, borderRadius: 2, flex: 1, minWidth: 80,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25,
                            borderColor: alpha(color, 0.3),
                            bgcolor: alpha(color, 0.04),
                            transition: 'all .15s',
                            '&:hover': { bgcolor: alpha(color, 0.08) },
                          }}
                        >
                          <Box sx={{ color, display: 'flex', mb: 0.25 }}>{icon}</Box>
                          <Typography variant="h5" fontWeight={800} sx={{ color, lineHeight: 1 }}>
                            {value}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.688rem' }}>{label}</Typography>
                        </Paper>
                      ))}
                    </Box>

                  {/* Catalog sub-tabs */}
                  <Tabs
                    value={catalogTab}
                    onChange={(_, v) => setCatalogTab(v)}
                    sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Tab icon={<BarChartOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Overview" sx={{ textTransform: 'none', minHeight: 40, py: 0 }} />
                    <Tab icon={<TableChartOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Columns" sx={{ textTransform: 'none', minHeight: 40, py: 0 }} />
                    <Tab icon={<AccountTreeOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Relations" sx={{ textTransform: 'none', minHeight: 40, py: 0 }} />
                    <Tab icon={<VisibilityOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Views" sx={{ textTransform: 'none', minHeight: 40, py: 0 }} />
                    <Tab icon={<GridOnOutlined sx={{ fontSize: 16 }} />} iconPosition="start" label="Samples" sx={{ textTransform: 'none', minHeight: 40, py: 0 }} />
                  </Tabs>

                  {/* Overview */}
                  {catalogTab === 0 && <CatalogOverview catalog={catalog} />}

                  {/* Columns */}
                  {catalogTab === 1 && (
                    <Box sx={{ overflow: 'auto', maxHeight: 480 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Table</TableCell>
                            <TableCell>Column</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Max Len</TableCell>
                            <TableCell align="center">PK</TableCell>
                            <TableCell align="center">Nullable</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {catalog.columns.map((col, i) => (
                            <TableRow key={i} hover>
                              <TableCell>
                                <Chip label={col.table_name} size="small" variant="outlined" />
                              </TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.813rem', fontWeight: 600 }}>
                                {col.column_name}
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption" color="text.secondary">{col.data_type}</Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption" color="text.disabled">
                                  {(col as any).max_length === -1 ? 'MAX' : (col as any).max_length ?? '—'}
                                </Typography>
                              </TableCell>
                              <TableCell align="center">
                                {col.is_primary_key && <Chip label="PK" size="small" color="primary" />}
                              </TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={col.is_nullable ? 'NULL' : 'NOT NULL'}
                                  size="small"
                                  color={col.is_nullable ? 'default' : 'warning'}
                                  variant="outlined"
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  )}

                  {/* Relations */}
                  {catalogTab === 2 && (
                    catalog.relations.length === 0 ? (
                      <Box sx={{ py: 6, textAlign: 'center' }}>
                        <LinkOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                        <Typography color="text.disabled">No foreign key relationships found.</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ overflow: 'auto', maxHeight: 480 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell>FK Name</TableCell>
                              <TableCell>Parent Table</TableCell>
                              <TableCell>Parent Column</TableCell>
                              <TableCell />
                              <TableCell>Referenced Table</TableCell>
                              <TableCell>Referenced Column</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {catalog.relations.map((rel, i) => (
                              <TableRow key={i} hover>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                                  {(rel as any).fk_name ?? '—'}
                                </TableCell>
                                <TableCell><Chip label={rel.parent_table} size="small" variant="outlined" /></TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.813rem' }}>{rel.parent_column}</TableCell>
                                <TableCell align="center">
                                  <LinkOutlined fontSize="small" color="action" />
                                </TableCell>
                                <TableCell><Chip label={rel.referenced_table} size="small" color="primary" variant="outlined" /></TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.813rem' }}>{rel.referenced_column}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    )
                  )}

                  {/* Views */}
                  {catalogTab === 3 && (
                    catalog.views.length === 0 ? (
                      <Box sx={{ py: 6, textAlign: 'center' }}>
                        <DataObjectOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                        <Typography color="text.disabled">No views found.</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {catalog.views.map((view, i) => (
                          <Accordion key={i} disableGutters sx={{ borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                                👁 {(view as any).view_schema ? `${(view as any).view_schema}.` : ''}{view.name}
                              </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box
                                sx={{
                                  p: 1.5, borderRadius: 1, bgcolor: '#0d1117',
                                  fontFamily: 'monospace', fontSize: '0.75rem',
                                  color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto',
                                }}
                              >
                                {view.definition || '-- definition not available'}
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        ))}
                      </Box>
                    )
                  )}

                  {/* Samples */}
                  {catalogTab === 4 && (
                    Object.keys((catalog as any).samples || {}).length === 0 ? (
                      <Box sx={{ py: 6, textAlign: 'center' }}>
                        <AccountTreeOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                        <Typography color="text.disabled">No sample rows collected.</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 480, overflow: 'auto' }}>
                        {Object.entries((catalog as any).samples || {}).map(([table, rows]) => {
                          const rowArr = rows as any[]
                          const cols2 = rowArr.length ? Object.keys(rowArr[0]) : []
                          return (
                            <Box key={table}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Chip label={table} size="small" color="primary" variant="outlined" />
                                <Typography variant="caption" color="text.secondary">
                                  showing {rowArr.length} rows
                                </Typography>
                              </Box>
                              {rowArr.length > 0 ? (
                                <Box sx={{ overflow: 'auto' }}>
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        {cols2.map((c) => <TableCell key={c}>{c}</TableCell>)}
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {rowArr.map((row, ri) => (
                                        <TableRow key={ri} hover>
                                          {cols2.map((c) => (
                                            <TableCell key={c} sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                              {row[c] == null
                                                ? <Typography variant="caption" color="text.disabled">NULL</Typography>
                                                : String(row[c])}
                                            </TableCell>
                                          ))}
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </Box>
                              ) : (
                                <Typography variant="caption" color="text.disabled" sx={{ pl: 1 }}>
                                  No rows sampled (empty or access denied)
                                </Typography>
                              )}
                            </Box>
                          )
                        })}
                      </Box>
                    )
                  )}
                </Box>
                )}

              </Box>
            </Collapse>
          </Paper>

          {/* ── 2. AI Embeddings ── */}
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: embeddingOpen ? '1px solid' : 'none', borderColor: 'divider' }}
              onClick={() => setEmbeddingOpen((v) => !v)}
            >
              {embeddingOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
              <AutoAwesomeOutlined sx={{ fontSize: 16, color: 'secondary.main', flexShrink: 0 }} />
              <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>AI Embeddings</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                {keyStatus?.configured
                  ? <Chip icon={<CheckCircleOutlined />} label="API Key Ready" color="success" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.68rem' }} />
                  : <Chip label="API Key Required" size="small" variant="outlined" color="warning" sx={{ height: 20, fontSize: '0.68rem' }} />}
                <Button size="small" variant="contained" color="secondary"
                  startIcon={isEmbedding ? <CircularProgress size={12} color="inherit" /> : <AutoAwesomeOutlined />}
                  onClick={() => startEmbedding()} disabled={!connId || isEmbedding}>
                  {isEmbedding ? 'Embedding…' : (embeddingDelta ? 'Embed New Only' : 'Generate Embeddings')}
                </Button>
                <Tooltip title={embeddingDelta ? 'Delta: skips columns already embedded, only processes new ones' : 'Full: clears and re-embeds all columns'}>
                  <FormControlLabel
                    control={<Switch size="small" checked={embeddingDelta} onChange={(e) => setEmbeddingDelta(e.target.checked)} disabled={isEmbedding} />}
                    label={<Typography variant="caption" color="text.secondary">Delta</Typography>}
                    sx={{ ml: 0.5, mr: 0 }}
                  />
                </Tooltip>
              </Box>
            </Box>
            <Collapse in={embeddingOpen}>
              <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Generate semantic vectors for schema-aware AI queries. Enables embedding-based column matching and NL→SQL generation.
                  {!keyStatus?.configured && ' Enter your OpenAI API key below.'}
                </Typography>
                {!keyStatus?.configured && (
                  <TextField label="OpenAI API Key" value={openAiKey} onChange={(e) => setOpenAiKey(e.target.value)}
                    size="small" type="password" fullWidth placeholder="sk-…" sx={{ maxWidth: 400 }} />
                )}
                {/* Live log — embeddings only */}
                {logLines.length > 0 && logSource === 'embedding' && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', mr: 1, flexShrink: 0,
                        bgcolor: isEmbedding ? '#10b981' : '#475569',
                        animation: isEmbedding ? 'pulse 1.5s infinite' : 'none',
                        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
                      }} />
                      <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }} color={isEmbedding ? 'success.main' : 'text.secondary'}>
                        {isEmbedding ? 'Running…' : 'Completed'}
                      </Typography>
                      <IconButton size="small" onClick={() => setLogLines([])}>
                        <ClearOutlined sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Box>
                    <Box ref={logRef} sx={{ height: 200, overflow: 'auto', p: 1.5, borderRadius: 1.5, bgcolor: '#0d1117', border: '1px solid', borderColor: alpha('#60a5fa', 0.15) }}>
                      {logLines.map((line, i) => <LogLine key={i} {...line} />)}
                      {isEmbedding && (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: '#60a5fa', mt: 1 }}>
                          <CircularProgress size={10} color="inherit" />
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#60a5fa' }}>Generating embeddings…</Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )}
              </Box>
            </Collapse>
          </Paper>

        </Box>
      )}

      {/* Clear Catalog Confirmation */}
      <Dialog open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'warning.main' }}>
          <WarningOutlined />
          Clear Catalog Data?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will permanently delete all discovered tables, columns, relations, samples,
            and embeddings for this connection. This cannot be undone.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            You will need to run <strong>Collect Schema</strong> again to restore the catalog.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            startIcon={clearMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <ClearOutlined />}
            disabled={clearMutation.isPending}
            onClick={() => { setClearConfirmOpen(false); clearMutation.mutate() }}
          >
            Yes, Clear
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Query Context + Query Examples ── */}
      {mainTab === 1 && <QueryContextTab connId={activeConnection?.id} />}

      {/* ── Email Settings ── */}
      {mainTab === 2 && (
        <EmailSettingsSection
          smtpHost={smtpHost} setSmtpHost={setSmtpHost}
          smtpPort={smtpPort} setSmtpPort={setSmtpPort}
          smtpUser={smtpUser} setSmtpUser={setSmtpUser}
          smtpPass={smtpPass} setSmtpPass={setSmtpPass}
          fromAddr={fromAddr} setFromAddr={setFromAddr}
          testEmailMutation={testEmailMutation}
          saveEmailMutation={saveEmailMutation}
        />
      )}

      {/* ── Prompt Templates ─────────────────────────────────────── */}
      {mainTab === 3 && <PromptTemplatesTab connId={activeConnection?.id} />}

      {/* ── AI Intelligence ──────────────────────────────────────── */}
      {mainTab === 4 && <AIIntelligenceTab connId={activeConnection?.id} />}

      {/* ── Integrations ─────────────────────────────────────────── */}
      {mainTab === 5 && <IntegrationsTab projectId={activeProject?.id} />}

      {/* ── AI Traces ────────────────────────────────────────────── */}
      {mainTab === 6 && <AITracesTab />}

      {/* ── Debug Settings ───────────────────────────────────────── */}
      {mainTab === 7 && <DebugSettingsTab />}

      {mainTab === 8 && <FeedbackTab />}
      {mainTab === 9 && <ApprovalsTab />}
    </Box>
  )
}
