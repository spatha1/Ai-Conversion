import { useState, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box, Typography, Tabs, Tab, Paper, Table, TableHead, TableBody,
  TableRow, TableCell, TableContainer, Button, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, Select,
  MenuItem, FormControl, InputLabel, Chip, CircularProgress, Alert,
  Stack, Autocomplete, Tooltip, Badge, LinearProgress, Accordion,
  AccordionSummary, AccordionDetails, ToggleButtonGroup, ToggleButton,
  alpha, Collapse, List, ListItemButton, ListItemText, Divider,
  Stepper, Step, StepLabel, OutlinedInput, Checkbox,
  ListItemText as MuiListItemText,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, SendOutlined, AutoAwesomeOutlined,
  RefreshOutlined, ExpandMoreOutlined, WarningAmberOutlined,
  CheckCircleOutlined, HourglassEmptyOutlined,
  AttachFileOutlined, LinkOutlined, CloudDownloadOutlined,
  BugReportOutlined, HistoryOutlined, ExpandLessOutlined,
  ThumbDownOutlined, FlagOutlined,
  ContentCopyOutlined, PrintOutlined,
  DownloadOutlined, ArticleOutlined, AccessTimeOutlined,
  InfoOutlined, AutoFixHighOutlined, RuleOutlined,
  CategoryOutlined, EventNoteOutlined, GavelOutlined,
  AssignmentOutlined, PeopleOutlined, PlayCircleOutlined,
  CloseOutlined, OpenInNewOutlined, EditOutlined,
  CheckOutlined, CancelOutlined, ReportProblemOutlined,
  QuestionMarkOutlined, MemoryOutlined, TaskAltOutlined,
  UploadFileOutlined, LayersClearOutlined,
  FolderCopyOutlined, InsertDriveFileOutlined, ChevronRight,
} from '@mui/icons-material'
import { Popover } from '@mui/material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { knowledgeApi, adminApi, operationalKnowledgeApi, connectionsApi, documentsApi } from '@/api'
import { uuid } from '@/utils/uuid'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import AIDebugPanel from '@/components/ai/AIDebugPanel'
import {
  KNOWLEDGE_ALLOWED_TAGS,
  type KnowledgeEntry, type KnowledgeEntryCreate,
  type OpenQuestion, type AskSAIResult, type AskSAIAnswered, type AskSAIUnanswered,
  type KnowledgeEntryType, type KnowledgeSystemType, type KnowledgeSourceType,
  type KnowledgeSchema, type KnowledgeSchemaCreate,
  type RequirementSession, type SessionCreate, type SessionArtifact,
  type SessionType, type ArtifactType, type SessionAttachment,
  type ContentBlock, type ContentBlockType, type ResponseType,
  type KTSqlObject, type KTObjectType,
  type AfsFolder, type AfsFile, type DocumentsScope,
} from '@/types'
import OperationalDecisionCard from '@/components/knowledge/OperationalDecisionCard'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENTRY_TYPES:   KnowledgeEntryType[]  = ['UseCase', 'Question', 'Process', 'Issue', 'ViewDefinition', 'QueryExample', 'QueryLibrary', 'SchemaDefinition']
const SYSTEM_TYPES:  KnowledgeSystemType[] = ['DCT', 'ADO', 'Snowflake', 'General']
const SOURCE_TYPES:  KnowledgeSourceType[] = ['Text', 'Document', 'Link']

const RESPONSE_TYPES: { value: ResponseType; label: string; icon: string; color: string }[] = [
  { value: 'answer',       label: 'Answer',              icon: '💬', color: '#4f46e5' },
  { value: 'teach_me',     label: 'Teach Me',            icon: '🎓', color: '#0891b2' },
  { value: 'generate',     label: 'Generate',            icon: '⚡', color: '#059669' },
  { value: 'review',       label: 'Review',              icon: '🔍', color: '#d97706' },
  { value: 'troubleshoot', label: 'Troubleshoot',        icon: '🔧', color: '#dc2626' },
  { value: 'plan',         label: 'Implementation Plan', icon: '🗺️',  color: '#7c3aed' },
  { value: 'summary',      label: 'Executive Summary',   icon: '📋', color: '#0f766e' },
]

const BLOCK_TYPES: { type: ContentBlockType; label: string; icon: string }[] = [
  { type: 'text',       label: 'Text / Notes',   icon: '📝' },
  { type: 'image',      label: 'Image / Diagram', icon: '🖼️' },
  { type: 'sql',        label: 'SQL Query',       icon: '🗄️' },
  { type: 'document',   label: 'Document (PDF/DOCX)', icon: '📄' },
  { type: 'transcript', label: 'Transcript / Meeting Notes', icon: '🎙️' },
]

function qualityColor(q: string | null) {
  if (q === 'HIGH')   return tokens.emerald600
  if (q === 'MEDIUM') return tokens.amber500
  if (q === 'LOW')    return tokens.red500
  return tokens.amber500
}

function embColor(s: string) {
  if (s === 'complete') return tokens.emerald600
  if (s === 'partial')  return tokens.amber500
  if (s === 'failed')   return tokens.red500
  return '#888'
}

function daysOpenColor(days: number | null) {
  if (days === null) return '#888'
  if (days <= 7)    return '#888'
  if (days <= 14)   return tokens.amber500
  return tokens.red500
}

function parseTags(raw: string | null): string[] {
  try { return JSON.parse(raw || '[]') } catch { return [] }
}

// ── Info-icon field-guide popovers ────────────────────────────────────────────

function FieldInfoPopover({ rows, title }: {
  title: string
  rows: { col: string; req: string; desc: string; vals: string }[]
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Tooltip title={`Show ${title} field guide`}>
        <IconButton size="small" onClick={e => setAnchor(e.currentTarget)} sx={{ color: 'info.main' }}>
          <InfoOutlined sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { p: 2, maxWidth: 620, boxShadow: 4 } }}
      >
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>{title}</Typography>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
          <Box component="thead">
            <Box component="tr" sx={{ bgcolor: 'action.hover' }}>
              {['Column', 'Required?', 'Description', 'Values / Examples'].map(h => (
                <Box component="th" key={h} sx={{ px: 1, py: 0.6, textAlign: 'left', fontWeight: 700, borderBottom: '2px solid', borderColor: 'divider', fontSize: '0.7rem' }}>{h}</Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map(r => (
              <Box component="tr" key={r.col} sx={{ '&:nth-of-type(even)': { bgcolor: 'action.hover' } }}>
                <Box component="td" sx={{ px: 1, py: 0.5, fontFamily: 'monospace', fontWeight: 600, color: 'primary.main', borderBottom: '1px solid', borderColor: 'divider' }}>{r.col}</Box>
                <Box component="td" sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' }}>{r.req}</Box>
                <Box component="td" sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>{r.desc}</Box>
                <Box component="td" sx={{ px: 1, py: 0.5, fontSize: '0.68rem', color: 'text.secondary', borderBottom: '1px solid', borderColor: 'divider' }}>{r.vals}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Popover>
    </>
  )
}

function BulkImportFieldInfo() {
  return (
    <FieldInfoPopover
      title="Bulk Import — Accepted Fields"
      rows={[
        { col: 'title',       req: '✅ Required', desc: 'Short name shown in KB list',                              vals: 'Any text (max 500 chars)' },
        { col: 'raw_content', req: '✅ Required', desc: 'Full text — LLM extracts summary, key points, decisions',  vals: 'Plain text, markdown, or text with SQL snippets' },
        { col: 'type',        req: 'Optional',   desc: 'Entry category (default: UseCase)',                         vals: 'UseCase · Process · Issue · Question · ViewDefinition · QueryLibrary · SchemaDefinition' },
        { col: 'system',      req: 'Optional',   desc: 'Source system (default: General)',                          vals: 'DCT · ADO · Snowflake · MSSQL · General' },
        { col: 'tags',        req: 'Optional',   desc: 'Search tags, comma-separated',                              vals: 'reconciliation, finance, GL, policy…' },
        { col: 'op_category', req: 'Optional',   desc: 'Operational Intelligence category — shows entry in that tab', vals: 'ReconRule · Ownership · Remediation · Lineage · DCTMapping · IncidentHistory · BusinessProcess' },
        { col: 'severity',    req: 'Optional',   desc: 'Priority level for the entry',                              vals: 'CRITICAL · HIGH · MEDIUM · LOW' },
        { col: 'owner_team',  req: 'Optional',   desc: 'Team responsible for this entry',                           vals: 'e.g. GL/Data Team · DCT Billing · Data Engineering' },
      ]}
    />
  )
}

function QueryLibraryFieldInfo() {
  return (
    <FieldInfoPopover
      title="Import Query Library — Accepted Fields"
      rows={[
        { col: 'title', req: '✅ Required', desc: 'Query / view name', vals: 'Also: name, table_name, view_name' },
        { col: 'sql', req: '✅ Required', desc: 'Full SQL body', vals: 'Also: query, view_definition, definition' },
        { col: 'description', req: 'Optional', desc: 'Human summary of what the SQL does', vals: 'Also: summary, desc' },
        { col: 'system', req: 'Optional', desc: 'Source system (default: Snowflake)', vals: 'Snowflake · MSSQL · PostgreSQL · General' },
        { col: 'tags', req: 'Optional', desc: 'Comma-separated search tags', vals: 'Also: tag' },
        { col: 'type', req: 'Optional', desc: 'Auto-detected from SQL if omitted', vals: 'ViewDefinition · QueryLibrary · SchemaDefinition' },
      ]}
    />
  )
}

// ── Operational Knowledge categories (shared) ─────────────────────────────────

const OP_CATEGORIES = [
  { key: 'ReconRule',      label: 'Reconciliation Rules', color: '#ef4444' },
  { key: 'Ownership',      label: 'Ownership Map',        color: '#8b5cf6' },
  { key: 'Remediation',    label: 'Remediation Workflows',color: '#10b981' },
  { key: 'Lineage',        label: 'System Lineage',       color: '#3b82f6' },
  { key: 'DCTMapping',     label: 'DCT Mappings',         color: '#f59e0b' },
  { key: 'IncidentHistory',label: 'Incident History',     color: '#6366f1' },
  { key: 'BusinessProcess',label: 'Business Process',     color: '#0ea5e9' },
] as const

type OpCategoryKey = typeof OP_CATEGORIES[number]['key']

// ── Entry form dialog ─────────────────────────────────────────────────────────

interface EntryFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: KnowledgeEntryCreate, skipDup: boolean) => void
  loading: boolean
  dupId: number | null
  prefillTitle?: string
  prefillContent?: string
  prefillSessionId?: number
  prefillBlocks?: ContentBlock[]
}

function EntryFormDialog({ open, onClose, onSubmit, loading, dupId, prefillTitle, prefillContent, prefillSessionId, prefillBlocks }: EntryFormProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [title,        setTitle]      = useState(prefillTitle || '')
  const [type,         setType]       = useState<KnowledgeEntryType>('UseCase')
  const [system,       setSystem]     = useState<KnowledgeSystemType>('DCT')
  const [tags,         setTags]       = useState<string[]>([])
  const [sourceType,   setSourceType] = useState<KnowledgeSourceType>('Text')
  const [content,      setContent]    = useState(prefillContent || '')
  const [sessionId,    setSessionId]  = useState<number | null>(prefillSessionId ?? null)
  const [schemaId,     setSchemaId]   = useState<number | null>(null)
  const [quickSessionOpen, setQuickSessionOpen] = useState(false)
  const [qsTitle,      setQsTitle]    = useState('')
  const [qsType,       setQsType]     = useState<SessionType>('MeetingNotes')
  const [qsCreating,   setQsCreating] = useState(false)
  const [skipDup,      setSkipDup]    = useState(false)
  const [urlInput,     setUrlInput]   = useState('')
  const [attachedFile, setAttached]   = useState<string>('')  // display name
  const [fetching,     setFetching]   = useState(false)
  // Operational Intelligence fields
  const [opCategory,      setOpCategory]     = useState<string>('')
  const [opSeverity,      setOpSeverity]     = useState<string>('')
  const [opOwnerTeam,     setOpOwnerTeam]    = useState<string>('')
  const [opSystems,       setOpSystems]      = useState<string>('')  // comma-separated
  const [opSqlTemplate,   setOpSqlTemplate]  = useState<string>('')
  const [opValidation,    setOpValidation]   = useState<string>('')
  const [opShowFields,    setOpShowFields]   = useState(false)
  // Content blocks
  const [contentBlocks, setContentBlocks]   = useState<ContentBlock[]>([])
  const [blockMenuOpen, setBlockMenuOpen]   = useState(false)
  const [imgProcessing, setImgProcessing]   = useState<string | null>(null)  // block id being processed
  const [previewOpen,   setPreviewOpen]     = useState(false)
  const [previewData,   setPreviewData]     = useState<any[] | null>(null)
  const [previewLoading,setPreviewLoading]  = useState(false)
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const blockFileRef    = useRef<{ [key: string]: HTMLInputElement | null }>({})

  function addBlock(type: ContentBlockType) {
    setContentBlocks(prev => [...prev, { id: uuid(), block_type: type, name: '', content: '', explanation: '' }])
    setBlockMenuOpen(false)
  }
  function removeBlock(id: string) { setContentBlocks(prev => prev.filter(b => b.id !== id)) }
  function updateBlock(id: string, patch: Partial<ContentBlock>) {
    setContentBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b))
  }

  async function handleBlockImage(id: string, file: File) {
    if (file.size > 10 * 1024 * 1024) { enqueueSnackbar('Image too large (max 10 MB)', { variant: 'warning' }); return }
    setImgProcessing(id)
    try {
      const res = await knowledgeApi.processImage(file)
      updateBlock(id, { vision_text: res.vision_text, file_name: res.file_name })
      enqueueSnackbar('Image analyzed by vision AI', { variant: 'success' })
    } catch {
      enqueueSnackbar('Vision analysis failed', { variant: 'error' })
    } finally {
      setImgProcessing(null)
    }
  }

  async function handlePreview() {
    if (!hasBlockContent && content.trim().length < 10) {
      enqueueSnackbar('Add content or blocks to preview', { variant: 'warning' }); return
    }
    setPreviewLoading(true)
    setPreviewOpen(true)
    setPreviewData(null)
    try {
      const res = await knowledgeApi.previewEntry(
        title,
        contentBlocks.map(b => ({
          block_type:  b.block_type,
          content:     b.content || '',
          explanation: b.explanation || '',
          vision_text: b.vision_text || '',
          file_name:   b.file_name || '',
        })),
        content,
      )
      setPreviewData(res.previews)
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail || 'Preview failed', { variant: 'error' })
      setPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleQuickCreateSession() {
    if (!qsTitle.trim()) return
    setQsCreating(true)
    try {
      const s = await knowledgeApi.createSession({
        title: qsTitle.trim(),
        session_type: qsType,
        ...(schemaId ? { kb_schema_id: schemaId } : {}),
      } as any)
      setSessionId(s.id)
      await refetchSessions()
      setQuickSessionOpen(false)
      setQsTitle('')
      enqueueSnackbar(`Session "${s.title}" created`, { variant: 'success' })
    } catch {
      enqueueSnackbar('Failed to create session', { variant: 'error' })
    } finally {
      setQsCreating(false)
    }
  }

  async function handleBlockDocument(id: string, file: File) {
    setFetching(true)
    try {
      const res = await knowledgeApi.parseFile(file)
      updateBlock(id, { content: res.text, file_name: file.name })
      enqueueSnackbar(`Extracted ${res.chars?.toLocaleString()} chars`, { variant: 'success' })
    } catch {
      enqueueSnackbar('File extraction failed', { variant: 'error' })
    } finally {
      setFetching(false)
    }
  }

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['knowledge-sessions-forentry', schemaId],
    queryFn:  () => knowledgeApi.listSessions({ limit: 100, kb_schema_id: schemaId ?? undefined }),
    enabled:  open,
  })

  const { data: schemasForEntry = [] } = useQuery({
    queryKey: ['knowledge-schemas-forentry'],
    queryFn:  () => knowledgeApi.listSchemas(),
    enabled:  open,
  })

  useEffect(() => {
    if (open) {
      setTitle(prefillTitle || '')
      setType('UseCase')
      setSystem('DCT')
      setTags([])
      setSourceType('Text')
      setContent(prefillContent || '')
      setSessionId(prefillSessionId ?? null)
      setSchemaId(null)
      setQuickSessionOpen(false)
      setQsTitle('')
      setQsType('MeetingNotes')
      setSkipDup(false)
      setUrlInput('')
      setAttached('')
      setOpCategory('')
      setOpSeverity('')
      setOpOwnerTeam('')
      setOpSystems('')
      setOpSqlTemplate('')
      setOpValidation('')
      setOpShowFields(false)
      setContentBlocks(prefillBlocks ? prefillBlocks.map(b => ({ ...b, id: uuid(), name: b.name || '' })) : [])
      setBlockMenuOpen(false)
      setImgProcessing(null)
    }
  }, [open, prefillTitle, prefillContent, prefillSessionId, prefillBlocks])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFetching(true)
    try {
      const result = await knowledgeApi.parseFile(file)
      setContent(result.text)
      setAttached(file.name)
      enqueueSnackbar(`Extracted ${result.chars.toLocaleString()} chars from ${file.name}`, { variant: 'success' })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Failed to parse file.', { variant: 'error' })
    } finally {
      setFetching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleFetchUrl() {
    const url = urlInput.trim()
    if (!url) return
    setFetching(true)
    try {
      const result = await knowledgeApi.fetchUrl(url)
      setContent(result.text)
      enqueueSnackbar(`Fetched ${result.chars.toLocaleString()} chars from URL`, { variant: 'success' })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Failed to fetch URL.', { variant: 'error' })
    } finally {
      setFetching(false)
    }
  }

  const hasBlockContent = contentBlocks.some(b =>
    (b.content && b.content.trim().length > 0) ||
    (b.vision_text && b.vision_text.trim().length > 0)
  )
  const valid = title.trim().length > 0 && (content.trim().length >= 10 || hasBlockContent)

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth
      PaperProps={{ sx: { minHeight: '80vh', maxHeight: '92vh' } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>
        {prefillContent ? 'Correct & Add to KB' : prefillTitle ? 'Answer Question (Full KB Entry)' : 'Add Knowledge Entry'}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important', overflowY: 'auto' }}>
        {dupId !== null && !skipDup && (
          <Alert
            severity="warning"
            action={
              <Button size="small" color="inherit" onClick={() => setSkipDup(true)}>
                Submit anyway
              </Button>
            }
          >
            A near-duplicate entry already exists (ID: {dupId}). Review before submitting.
          </Alert>
        )}
        {/* ── Title row ── */}
        <TextField label="Title *" value={title} onChange={e => setTitle(e.target.value)} required fullWidth />

        {/* ── Schema + Session row ── */}
        <Stack direction="row" spacing={2} alignItems="flex-start">
          {/* Schema selector */}
          <FormControl sx={{ flex: 1 }}>
            <InputLabel>Schema (optional)</InputLabel>
            <Select value={schemaId ?? ''} label="Schema (optional)"
              onChange={e => setSchemaId(e.target.value ? Number(e.target.value) : null)}>
              <MenuItem value="">— None —</MenuItem>
              {(schemasForEntry as KnowledgeSchema[]).map((s: KnowledgeSchema) => (
                <MenuItem key={s.id} value={s.id}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color_hex, flexShrink: 0 }} />
                    <span>{s.name}</span>
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Session selector + create button */}
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Link to Session (optional)</InputLabel>
              <Select value={sessionId ?? ''} label="Link to Session (optional)"
                onChange={e => setSessionId(e.target.value ? Number(e.target.value) : null)}>
                <MenuItem value="">— None —</MenuItem>
                {(sessions as RequirementSession[]).map((s: RequirementSession) => (
                  <MenuItem key={s.id} value={s.id}>
                    <Box>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>{s.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.session_type} · {s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Create a new session and link it">
              <IconButton size="small" onClick={() => setQuickSessionOpen(true)}
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.75, flexShrink: 0 }}>
                <AddOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={2}>
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select value={type} label="Type" onChange={e => setType(e.target.value as KnowledgeEntryType)}>
              {ENTRY_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>System</InputLabel>
            <Select value={system} label="System" onChange={e => setSystem(e.target.value as KnowledgeSystemType)}>
              {SYSTEM_TYPES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Source Type</InputLabel>
            <Select value={sourceType} label="Source Type" onChange={e => { setSourceType(e.target.value as KnowledgeSourceType); setContent(''); setUrlInput(''); setAttached('') }}>
              {SOURCE_TYPES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        <Autocomplete
          multiple
          options={[...KNOWLEDGE_ALLOWED_TAGS]}
          value={tags}
          onChange={(_, v) => setTags(v)}
          disableCloseOnSelect
          renderInput={params => <TextField {...params} label="Tags" />}
          renderTags={(val, getProps) =>
            val.map((tag, i) => <Chip {...getProps({ index: i })} key={tag} label={tag} size="small" />)
          }
        />

        {/* ── Document: file upload ── */}
        {sourceType === 'Document' && (
          <Box>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <Button
                variant="outlined"
                startIcon={fetching ? <CircularProgress size={16} /> : <AttachFileOutlined />}
                onClick={() => fileInputRef.current?.click()}
                disabled={fetching}
                size="small"
              >
                {fetching ? 'Extracting…' : attachedFile ? 'Change File' : 'Attach File'}
              </Button>
              {attachedFile && (
                <Chip
                  label={attachedFile}
                  size="small"
                  onDelete={() => { setAttached(''); setContent('') }}
                  icon={<AttachFileOutlined style={{ fontSize: 14 }} />}
                />
              )}
              <Typography variant="caption" color="text.secondary">PDF, DOCX, TXT, MD, CSV</Typography>
            </Stack>
          </Box>
        )}

        {/* ── Link: URL input + fetch ── */}
        {sourceType === 'Link' && (
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="URL"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleFetchUrl() } }}
              fullWidth
              size="small"
              placeholder="https://…"
              InputProps={{ startAdornment: <LinkOutlined sx={{ mr: 1, color: 'text.disabled', fontSize: 18 }} /> }}
            />
            <Button
              variant="outlined"
              startIcon={fetching ? <CircularProgress size={16} /> : <CloudDownloadOutlined />}
              onClick={handleFetchUrl}
              disabled={fetching || !urlInput.trim()}
              sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {fetching ? 'Fetching…' : 'Fetch'}
            </Button>
          </Stack>
        )}

        <TextField
          label="Content"
          multiline
          minRows={4}
          value={content}
          onChange={e => setContent(e.target.value)}
          fullWidth
          placeholder={
            sourceType === 'Document' ? 'Attach a file above — text will be extracted automatically, or paste directly here.'
            : sourceType === 'Link'   ? 'Enter a URL and click Fetch — or paste content directly here.'
            : 'Paste or type the main knowledge content here… or use Content Blocks below for multi-type KT.'
          }
          helperText={`${content.trim().length} chars${!hasBlockContent && content.trim().length < 10 ? ' — add content here or via blocks below' : ''}`}
          error={!hasBlockContent && content.trim().length > 0 && content.trim().length < 10}
        />

        {/* ── Content Blocks (Rich KT) ── */}
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} mb={contentBlocks.length > 0 ? 1.5 : 0}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Content Blocks
            </Typography>
            <Typography variant="caption" color="text.disabled">— add images, SQL, transcripts, documents</Typography>
            <Box sx={{ flex: 1 }} />
            <Box sx={{ position: 'relative' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddOutlined />}
                onClick={() => setBlockMenuOpen(o => !o)}
                sx={{ textTransform: 'none', fontSize: 12, py: 0.25 }}
              >
                Add Block
              </Button>
              {blockMenuOpen && (
                <Paper variant="outlined" sx={{ position: 'absolute', right: 0, top: '110%', zIndex: 10, minWidth: 220, py: 0.5 }}>
                  {BLOCK_TYPES.map(bt => (
                    <MenuItem key={bt.type} onClick={() => addBlock(bt.type)} sx={{ fontSize: 13, gap: 1 }}>
                      <span>{bt.icon}</span> {bt.label}
                    </MenuItem>
                  ))}
                </Paper>
              )}
            </Box>
          </Stack>

          <Stack spacing={1.5}>
            {contentBlocks.map((block, idx) => {
              const bt = BLOCK_TYPES.find(b => b.type === block.block_type)
              return (
                <Paper key={block.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, borderColor: 'divider', position: 'relative' }}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <Chip size="small" label={`${bt?.icon} ${bt?.label}`}
                      sx={{ fontWeight: 700, fontSize: 11, height: 22, flexShrink: 0 }} />
                    <TextField
                      size="small"
                      placeholder={`Block name — e.g. "GL Recon Query" (Ask SAI can reference by name)`}
                      value={block.name}
                      onChange={e => updateBlock(block.id, { name: e.target.value })}
                      sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
                      InputProps={{ sx: { height: 28 } }}
                    />
                    <IconButton size="small" onClick={() => removeBlock(block.id)} sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'error.main' }, flexShrink: 0 }}>
                      <CloseOutlined sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Stack>

                  {block.block_type === 'text' && (
                    <Stack spacing={1}>
                      <TextField size="small" label="Notes / Explanation" multiline minRows={3}
                        value={block.content} onChange={e => updateBlock(block.id, { content: e.target.value })}
                        fullWidth placeholder="Paste or type your notes, explanation, or context…" />
                    </Stack>
                  )}

                  {block.block_type === 'image' && (
                    <Stack spacing={1}>
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        ref={el => { blockFileRef.current[block.id] = el }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleBlockImage(block.id, f) }} />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Button size="small" variant="outlined" startIcon={imgProcessing === block.id ? <CircularProgress size={14} /> : <AttachFileOutlined />}
                          onClick={() => blockFileRef.current[block.id]?.click()}
                          disabled={imgProcessing === block.id}>
                          {block.file_name ? 'Change Image' : 'Upload Image'}
                        </Button>
                        {block.file_name && <Chip size="small" label={block.file_name} />}
                        <Typography variant="caption" color="text.disabled">PNG, JPG, GIF, WebP — vision AI will analyze</Typography>
                      </Stack>
                      {block.vision_text && (
                        <Alert severity="success" sx={{ py: 0.5, fontSize: 12 }}>
                          <strong>Vision analysis:</strong> {block.vision_text.slice(0, 200)}{block.vision_text.length > 200 ? '…' : ''}
                        </Alert>
                      )}
                      <TextField size="small" label="What does this image show? (context for SAI)"
                        value={block.explanation} onChange={e => updateBlock(block.id, { explanation: e.target.value })}
                        fullWidth placeholder="e.g. Flowchart showing the GL posting process for month-end close" />
                    </Stack>
                  )}

                  {block.block_type === 'sql' && (
                    <Stack spacing={1}>
                      <TextField size="small" label="SQL Query" multiline minRows={4}
                        value={block.content} onChange={e => updateBlock(block.id, { content: e.target.value })}
                        fullWidth placeholder="SELECT * FROM …" sx={{ fontFamily: 'monospace', '& textarea': { fontFamily: 'monospace', fontSize: 12 } }} />
                      <TextField size="small" label="Why was this written? (purpose, context, use case)"
                        value={block.explanation} onChange={e => updateBlock(block.id, { explanation: e.target.value })}
                        fullWidth placeholder="e.g. This query finds GL entries that failed to post due to missing cost center mapping" />
                    </Stack>
                  )}

                  {block.block_type === 'document' && (
                    <Stack spacing={1}>
                      <input type="file" accept=".pdf,.docx,.txt,.md,.csv" style={{ display: 'none' }}
                        ref={el => { blockFileRef.current[`doc_${block.id}`] = el }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleBlockDocument(block.id, f) }} />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Button size="small" variant="outlined" startIcon={<AttachFileOutlined />}
                          onClick={() => blockFileRef.current[`doc_${block.id}`]?.click()} disabled={fetching}>
                          {block.file_name ? 'Change Document' : 'Upload Document'}
                        </Button>
                        {block.file_name && <Chip size="small" label={block.file_name} />}
                        <Typography variant="caption" color="text.disabled">PDF, DOCX, TXT, MD, CSV</Typography>
                      </Stack>
                      {block.content && (
                        <Typography variant="caption" color="text.secondary">
                          Extracted: {block.content.length.toLocaleString()} chars
                        </Typography>
                      )}
                      <TextField size="small" label="Additional context about this document"
                        value={block.explanation} onChange={e => updateBlock(block.id, { explanation: e.target.value })}
                        fullWidth placeholder="e.g. This is the official GL reconciliation SOP from Finance team, v2.3" />
                    </Stack>
                  )}

                  {block.block_type === 'transcript' && (
                    <Stack spacing={1}>
                      <TextField size="small" label="Transcript / Meeting Notes" multiline minRows={5}
                        value={block.content} onChange={e => updateBlock(block.id, { content: e.target.value })}
                        fullWidth placeholder="Paste meeting transcript, call notes, or video transcript here…" />
                      <TextField size="small" label="Session context (attendees, date, topic)"
                        value={block.explanation} onChange={e => updateBlock(block.id, { explanation: e.target.value })}
                        fullWidth placeholder="e.g. GL team KT session with Sai, 2024-01-15 — covered month-end close process" />
                    </Stack>
                  )}
                </Paper>
              )
            })}
          </Stack>
        </Box>

        {/* Operational Intelligence section */}
        <Box>
          <Button
            size="small"
            variant="text"
            onClick={() => setOpShowFields(v => !v)}
            sx={{ textTransform: 'none', color: 'text.secondary', mb: opShowFields ? 1 : 0 }}
          >
            {opShowFields ? '▲ Hide' : '▼ Add'} Operational Intelligence fields (optional)
          </Button>
          <Collapse in={opShowFields}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Operational Category</InputLabel>
                  <Select value={opCategory} label="Operational Category" onChange={e => setOpCategory(e.target.value)}>
                    <MenuItem value="">— None —</MenuItem>
                    {OP_CATEGORIES.map(c => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>Severity</InputLabel>
                  <Select value={opSeverity} label="Severity" onChange={e => setOpSeverity(e.target.value)}>
                    <MenuItem value="">— None —</MenuItem>
                    {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField size="small" label="Owner Team" value={opOwnerTeam} onChange={e => setOpOwnerTeam(e.target.value)} fullWidth placeholder="e.g. Claims Integration Team" />
                <TextField size="small" label="Systems Involved (comma-separated)" value={opSystems} onChange={e => setOpSystems(e.target.value)} fullWidth placeholder="Billing, Claims, Policy" />
              </Stack>
              {(opCategory === 'ReconRule' || opCategory === 'Remediation') && (
                <TextField size="small" label="SQL Template" multiline minRows={3} value={opSqlTemplate} onChange={e => setOpSqlTemplate(e.target.value)} fullWidth placeholder="SELECT COUNT(*) FROM …" sx={{ fontFamily: 'monospace' }} />
              )}
              {(opCategory === 'ReconRule' || opCategory === 'Remediation') && (
                <TextField size="small" label="Validation Query" multiline minRows={2} value={opValidation} onChange={e => setOpValidation(e.target.value)} fullWidth placeholder="SELECT COUNT(*) FROM … WHERE … = 0" sx={{ fontFamily: 'monospace' }} />
              )}
            </Stack>
          </Collapse>
        </Box>

        {/* ── AI Understanding Preview — inside DialogContent so it's scrollable and visible ── */}
        {(previewOpen || previewLoading) && (
          <Box ref={(el: HTMLDivElement | null) => { if (el && previewOpen) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100) }}
            sx={{ mt: 2, border: '2px solid', borderColor: 'primary.main', borderRadius: 2, overflow: 'hidden' }}>
            <Stack direction="row" alignItems="center" spacing={1} px={2} py={1.25}
              sx={{ bgcolor: alpha('#4f46e5', 0.06), borderBottom: '1px solid', borderColor: alpha('#4f46e5', 0.2) }}>
              <AutoAwesomeOutlined sx={{ color: 'primary.main', fontSize: 18 }} />
              <Typography variant="subtitle2" fontWeight={700} color="primary.main">AI Understanding Preview</Typography>
              <Typography variant="caption" color="text.secondary">— review before saving</Typography>
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" onClick={() => setPreviewOpen(false)} sx={{ p: 0.25 }}>
                <CloseOutlined sx={{ fontSize: 16 }} />
              </IconButton>
            </Stack>

            <Box sx={{ p: 2 }}>
              {previewLoading ? (
                <Stack alignItems="center" spacing={1.5} py={3}>
                  <CircularProgress size={32} />
                  <Typography variant="body2" color="text.secondary">Analysing content blocks with AI…</Typography>
                </Stack>
              ) : (
                <Stack spacing={1.5}>
                  {(previewData || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" textAlign="center" py={2}>
                      No blocks to preview yet. Add content blocks above first.
                    </Typography>
                  )}
                  {(previewData || []).map((p: any, i: number) => {
                    const bt = BLOCK_TYPES.find(b => b.type === p.block_type)
                    const valueColor = p.knowledge_value === 'HIGH' ? 'success' : p.knowledge_value === 'LOW' ? 'warning' : 'info'
                    return (
                      <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                        <Stack direction="row" spacing={1} alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={`${bt?.icon || '📎'} ${bt?.label || p.block_type}`}
                            sx={{ fontWeight: 700, fontSize: 11, height: 20 }} />
                          {p.file_name && <Typography variant="caption" color="text.secondary">{p.file_name}</Typography>}
                          {p.knowledge_value && (
                            <Chip size="small" label={`Quality: ${p.knowledge_value}`} color={valueColor as any}
                              sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                          )}
                          {p.suggested_type && (
                            <Chip size="small" label={`Type: ${p.suggested_type}`} variant="outlined"
                              sx={{ height: 18, fontSize: 10 }} />
                          )}
                        </Stack>
                        {p.summary && <Typography variant="body2" sx={{ mb: 0.75 }}>{p.summary}</Typography>}
                        {p.tables_used?.length > 0 && (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" mb={0.5}>
                            <Typography variant="caption" color="text.secondary">Tables:</Typography>
                            {p.tables_used.map((t: string) => (
                              <Chip key={t} size="small" label={t} variant="outlined" sx={{ height: 16, fontSize: 10 }} />
                            ))}
                          </Stack>
                        )}
                        {p.purpose && <Typography variant="caption" color="text.secondary" display="block" mb={0.5}><strong>Purpose:</strong> {p.purpose}</Typography>}
                        {p.returns && <Typography variant="caption" color="text.secondary" display="block" mb={0.5}><strong>Returns:</strong> {p.returns}</Typography>}
                        {p.key_topics?.length > 0 && (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" mb={0.5}>
                            <Typography variant="caption" color="text.secondary">Topics:</Typography>
                            {p.key_topics.map((t: string) => (
                              <Chip key={t} size="small" label={t} sx={{ height: 16, fontSize: 10, bgcolor: alpha('#4f46e5', 0.08) }} />
                            ))}
                          </Stack>
                        )}
                        {(p.issues?.length > 0 || p.gaps?.length > 0) && (
                          <Box sx={{ mt: 0.5 }}>
                            {(p.issues || p.gaps || []).map((issue: string, j: number) => (
                              <Stack key={j} direction="row" spacing={0.5} alignItems="flex-start">
                                <WarningAmberOutlined sx={{ fontSize: 12, color: 'warning.main', mt: 0.25, flexShrink: 0 }} />
                                <Typography variant="caption" color="text.secondary">{issue}</Typography>
                              </Stack>
                            ))}
                          </Box>
                        )}
                      </Paper>
                    )
                  })}
                </Stack>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            color="secondary"
            disabled={(!hasBlockContent && content.trim().length < 10) || previewLoading}
            startIcon={previewLoading ? <CircularProgress size={14} /> : <AutoFixHighOutlined />}
            onClick={handlePreview}
            sx={{ textTransform: 'none' }}
          >
            {previewLoading ? 'Analysing…' : '🔍 Preview AI Understanding'}
          </Button>
        <Button
          variant="contained"
          disabled={!valid || loading || fetching || (dupId !== null && !skipDup)}
          onClick={() => onSubmit({
            title, type, system, tags, source_type: sourceType, raw_content: content,
            ...(sessionId  ? { session_id:   sessionId  } : {}),
            ...(schemaId   ? { kb_schema_id: schemaId   } : {}),
            ...(contentBlocks.length > 0 ? {
              content_blocks: contentBlocks.map(b => ({
                block_type:  b.block_type,
                name:        b.name || undefined,
                content:     b.content || undefined,
                explanation: b.explanation || undefined,
                vision_text: b.vision_text || undefined,
                file_name:   b.file_name || undefined,
              })),
            } : {}),
            ...(opCategory ? {
              op_category:      opCategory as any,
              severity:         opSeverity || undefined,
              owner_team:       opOwnerTeam || undefined,
              systems_involved: opSystems ? opSystems.split(',').map(s => s.trim()).filter(Boolean) : undefined,
              sql_template:     opSqlTemplate || undefined,
              validation_query: opValidation || undefined,
            } : {}),
          }, skipDup)}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
        >
          {loading ? 'Processing…' : 'Process & Save'}
        </Button>
        </Stack>
      </DialogActions>
    </Dialog>

    {/* ── Quick Create Session mini-dialog ── */}
    <Dialog open={quickSessionOpen} onClose={() => setQuickSessionOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 16 }}>New Session</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        <TextField label="Title *" value={qsTitle} onChange={e => setQsTitle(e.target.value)}
          fullWidth autoFocus size="small" placeholder="e.g. GL Month-End Review, Billing Queries v2" />
        <FormControl fullWidth size="small">
          <InputLabel>Session Type</InputLabel>
          <Select value={qsType} label="Session Type" onChange={e => setQsType(e.target.value as SessionType)}>
            {SESSION_TYPE_GROUPS.map(g => [
              <MenuItem key={g.label} disabled sx={{ fontSize: 11, fontWeight: 700, color: 'text.disabled', py: 0.25 }}>{g.label}</MenuItem>,
              ...g.types.map(t => (
                <MenuItem key={t} value={t}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {SESSION_TYPE_ICONS[t]}
                    <span>{t}</span>
                  </Stack>
                </MenuItem>
              ))
            ])}
          </Select>
        </FormControl>
        {schemasForEntry.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Schema will be inherited from the Schema selector above.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5 }}>
        <Button size="small" onClick={() => setQuickSessionOpen(false)}>Cancel</Button>
        <Button size="small" variant="contained" disabled={!qsTitle.trim() || qsCreating}
          startIcon={qsCreating ? <CircularProgress size={14} /> : <AddOutlined />}
          onClick={handleQuickCreateSession}>
          {qsCreating ? 'Creating…' : 'Create & Link'}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}

// ── Guided KT Wizard ─────────────────────────────────────────────────────────

const KT_STEPS = ['Project Setup', 'Upload Schema', 'SQL Objects', 'KT Session', 'Review & Save']

const KT_OBJECT_TYPES: { value: KTObjectType; label: string; icon: string }[] = [
  { value: 'View',             label: 'View',             icon: '👁️' },
  { value: 'StoredProcedure',  label: 'Stored Procedure', icon: '⚙️' },
  { value: 'Function',         label: 'Function',         icon: '𝑓' },
  { value: 'Table',            label: 'Table',            icon: '📋' },
  { value: 'Other',            label: 'Other',            icon: '📄' },
]

function KTWizardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { enqueueSnackbar }  = useSnackbar()
  const activeProject        = useAppStore(s => s.activeProject)
  const user                 = useAppStore(s => s.user)

  const [step,     setStep]    = useState(0)
  const [saving,   setSaving]  = useState(false)
  const [done,     setDone]    = useState(false)

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [schemaId,     setSchemaId]     = useState<number | null>(null)
  const [newSchemaName,setNewSchemaNm]  = useState('')
  const [newSchemaClr, setNewSchemaClr] = useState('#6366f1')
  const [creatingSchema, setCreatingSchema] = useState(false)
  const [ktTitle,      setKtTitle]      = useState('')
  const [ktSystem,     setKtSystem]     = useState<KnowledgeSystemType>('Snowflake')
  const [ktDesc,       setKtDesc]       = useState('')

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [schemaContent,  setSchemaContent]  = useState('')
  const [schemaFile,     setSchemaFile]     = useState<File | null>(null)
  const [importResult,   setImportResult]   = useState<{ connId: number; tables: number; columns: number } | null>(null)
  const [importing,      setImporting]      = useState(false)
  const schemaFileRef = useRef<HTMLInputElement>(null)

  // ── Step 3 state ──────────────────────────────────────────────────────────
  const [sqlObjects,  setSqlObjects]  = useState<KTSqlObject[]>([])
  const [addingObj,   setAddingObj]   = useState(false)
  const [newObj,      setNewObj]      = useState<Partial<KTSqlObject>>({ objectType: 'View' })

  // ── Step 4 state ──────────────────────────────────────────────────────────
  const [transcript,   setTranscript]   = useState('')
  const [sessionId,    setSessionId]    = useState<number | null>(null)
  const [analysing,    setAnalysing]    = useState(false)
  const [suggestions,  setSuggestions]  = useState<any[]>([])
  const [selectedSugg, setSelectedSugg] = useState<Set<number>>(new Set())
  const transcriptFileRef = useRef<HTMLInputElement>(null)

  // ── Step 5 state ──────────────────────────────────────────────────────────
  const [saveResult, setSaveResult] = useState<{ entries: number; links: number } | null>(null)

  const queryClient = useQueryClient()

  const { data: schemas = [] } = useQuery({
    queryKey: ['knowledge-schemas'],
    queryFn:  () => knowledgeApi.listSchemas(),
    enabled: open,
  })

  const activeSchemaObj = (schemas as KnowledgeSchema[]).find(s => s.id === schemaId)

  function reset() {
    setStep(0); setDone(false); setSaving(false)
    setSchemaId(null); setNewSchemaNm(''); setKtTitle(''); setKtDesc(''); setKtSystem('Snowflake')
    setSchemaContent(''); setSchemaFile(null); setImportResult(null)
    setSqlObjects([]); setAddingObj(false); setNewObj({ objectType: 'View' })
    setTranscript(''); setSessionId(null); setSuggestions([]); setSelectedSugg(new Set())
    setSaveResult(null)
  }

  // ── Step 1: create schema inline ─────────────────────────────────────────
  async function handleCreateSchema() {
    if (!newSchemaName.trim()) return
    setCreatingSchema(true)
    try {
      const s = await knowledgeApi.createSchema({ name: newSchemaName.trim(), description: ktDesc, color_hex: newSchemaClr })
      setSchemaId(s.id)
      queryClient.invalidateQueries({ queryKey: ['knowledge-schemas'] })
      enqueueSnackbar(`Schema "${s.name}" created`, { variant: 'success' })
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail || 'Schema creation failed', { variant: 'error' })
    } finally {
      setCreatingSchema(false)
    }
  }

  // ── Step 2: import DB schema ──────────────────────────────────────────────
  async function handleImport() {
    if (!schemaContent.trim() && !schemaFile) { enqueueSnackbar('Paste DDL or upload a file', { variant: 'warning' }); return }
    setImporting(true)
    try {
      const res = await knowledgeApi.importSchema(
        activeSchemaObj?.name || ktTitle || 'KT Schema',
        schemaContent,
        activeProject?.id,
        schemaFile ?? undefined,
      )
      setImportResult({ connId: res.conn_id, tables: res.tables, columns: res.columns })
      enqueueSnackbar(res.message, { variant: 'success' })
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail || 'Import failed', { variant: 'error' })
    } finally {
      setImporting(false)
    }
  }

  // ── Step 3: SQL objects ───────────────────────────────────────────────────
  function saveNewObj() {
    if (!newObj.name?.trim() || !newObj.sql?.trim()) { enqueueSnackbar('Name and SQL are required', { variant: 'warning' }); return }
    setSqlObjects(prev => [...prev, { id: uuid(), name: newObj.name!, objectType: newObj.objectType || 'View', sql: newObj.sql!, purpose: newObj.purpose || '', xmlGroup: newObj.xmlGroup || '', feedsInto: newObj.feedsInto || null, ...newObj }])
    setNewObj({ objectType: 'View' })
    setAddingObj(false)
  }
  function removeObj(id: string) { setSqlObjects(prev => prev.filter(o => o.id !== id)) }

  // ── Step 4: session + suggest ─────────────────────────────────────────────
  async function handleAnalyse() {
    if (!transcript.trim()) { enqueueSnackbar('Paste some KT notes or transcript first', { variant: 'warning' }); return }
    setAnalysing(true)
    try {
      const sess = await knowledgeApi.createSession({
        title: ktTitle || 'KT Session',
        session_type: 'KnowledgeUpload' as any,
        kb_schema_id: schemaId ?? undefined,
        transcript_raw: transcript.trim(),
      } as any)
      setSessionId(sess.id)
      const res = await knowledgeApi.suggestKBContent(sess.id)
      setSuggestions(res.suggestions || [])
      setSelectedSugg(new Set(res.suggestions.map((_: any, i: number) => i)))
      enqueueSnackbar(`Session created. ${res.suggestions.length} KB entries suggested.`, { variant: 'success' })
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail || 'Analysis failed', { variant: 'error' })
    } finally {
      setAnalysing(false)
    }
  }

  // ── Step 5: save all ──────────────────────────────────────────────────────
  async function handleSaveAll() {
    setSaving(true)
    try {
      const entryIds: { name: string; id: number }[] = []

      // Save each SQL object as a QueryExample entry
      for (const obj of sqlObjects) {
        const spFields = obj.objectType === 'StoredProcedure' ? `\nFormula/Template: ${(obj as any).formula || 'N/A'}\nSource View: ${(obj as any).sourceView || 'N/A'}\nTarget Table: ${(obj as any).targetTable || 'N/A'}` : ''
        try {
          const entry = await knowledgeApi.processEntry({
            title: obj.name,
            type: obj.objectType === 'StoredProcedure' ? 'Process' : 'QueryExample',
            system: ktSystem,
            raw_content: '',
            source_type: 'Text',
            ...(schemaId ? { kb_schema_id: schemaId } : {}),
            ...(sessionId ? { session_id: sessionId } : {}),
            content_blocks: [
              { block_type: 'sql', name: obj.name, content: obj.sql, explanation: obj.purpose + spFields },
              ...(obj.xmlGroup ? [{ block_type: 'text', name: 'Output', content: `Feeds XML Group: ${obj.xmlGroup}`, explanation: '' }] : []),
            ],
          } as any, false)
          entryIds.push({ name: obj.name, id: (entry as any).id })
        } catch (e) {
          console.warn(`Failed to save ${obj.name}:`, e)
        }
      }

      // Save selected suggestions
      const selectedList = suggestions.filter((_: any, i: number) => selectedSugg.has(i))
      for (const s of selectedList) {
        try {
          await knowledgeApi.processEntry({
            title: s.title, type: s.type, system: s.system || ktSystem,
            raw_content: '',
            source_type: 'Text',
            ...(schemaId ? { kb_schema_id: schemaId } : {}),
            ...(sessionId ? { session_id: sessionId } : {}),
            content_blocks: (s.blocks || []).map((b: any) => ({
              block_type: b.block_type, name: b.content?.slice(0, 30) || '', content: b.content, explanation: b.explanation,
            })),
          } as any, false)
        } catch (e) {
          console.warn(`Failed to save suggestion ${s.title}:`, e)
        }
      }

      // Create links for feedsInto relationships
      let linkCount = 0
      for (const obj of sqlObjects) {
        if (obj.feedsInto) {
          const src = entryIds.find(e => e.name === obj.name)
          const tgt = entryIds.find(e => e.name === obj.feedsInto)
          if (src && tgt) {
            try {
              await knowledgeApi.createEntryLink(src.id, tgt.id, 'feeds')
              linkCount++
            } catch (e) {
              console.warn('Link creation failed:', e)
            }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
      setSaveResult({ entries: entryIds.length + selectedList.length, links: linkCount })
      setDone(true)
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail || 'Save failed', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // ── Flow text preview ─────────────────────────────────────────────────────
  function buildFlowText(): string {
    const lines: string[] = []
    for (const obj of sqlObjects) {
      const icon = obj.objectType === 'View' ? '👁️' : obj.objectType === 'StoredProcedure' ? '⚙️' : '📄'
      const target = obj.feedsInto ? ` → ${obj.feedsInto}` : ''
      const output = obj.xmlGroup ? ` → [${obj.xmlGroup} XML]` : ''
      lines.push(`${icon} ${obj.name}${target}${output}`)
    }
    return lines.join('\n') || '(no objects added yet)'
  }

  const canAdvance = [
    ktTitle.trim().length > 0 && schemaId !== null,
    true, // step 2 optional but show warning
    sqlObjects.length > 0,
    sessionId !== null,
    true,
  ]

  return (
    <Dialog open={open} onClose={() => { if (!saving) { reset(); onClose() } }} maxWidth="lg" fullWidth
      PaperProps={{ sx: { minHeight: '75vh' } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 0 }}>
        🎓 Guided KT Wizard
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
          Capture a full Knowledge Transfer into SAI — schema, SQL objects, session notes, and links.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {/* Stepper header */}
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {KT_STEPS.map((label, i) => (
            <Step key={label} completed={step > i || done}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* ── Step 0: Project Setup ─────────────────────────────────────── */}
        {step === 0 && (
          <Stack spacing={2.5}>
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary">1. Select or create a KB Schema for this project</Typography>
            <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap" useFlexGap>
              <FormControl sx={{ minWidth: 220 }}>
                <InputLabel>Select Existing Schema</InputLabel>
                <Select value={schemaId ?? ''} label="Select Existing Schema"
                  onChange={e => setSchemaId(e.target.value ? Number(e.target.value) : null)}>
                  <MenuItem value="">— Create new below —</MenuItem>
                  {(schemas as KnowledgeSchema[]).map(s => (
                    <MenuItem key={s.id} value={s.id}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color_hex }} />
                        <span>{s.name}</span>
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">or</Typography>
              <TextField size="small" label="New schema name" placeholder="e.g. Policy Conversion"
                value={newSchemaName} onChange={e => setNewSchemaNm(e.target.value)} sx={{ width: 200 }} />
              <input type="color" value={newSchemaClr} onChange={e => setNewSchemaClr(e.target.value)}
                style={{ width: 36, height: 36, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              <Button size="small" variant="outlined" disabled={!newSchemaName.trim() || creatingSchema}
                startIcon={creatingSchema ? <CircularProgress size={14} /> : <AddOutlined />}
                onClick={handleCreateSchema}>
                Create
              </Button>
            </Stack>

            {activeSchemaObj && (
              <Alert severity="success" sx={{ py: 0.5 }}>
                Schema: <strong>{activeSchemaObj.name}</strong> — all entries will be saved under this schema.
              </Alert>
            )}

            <Divider />
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary">2. KT details</Typography>
            <TextField label="KT Title *" fullWidth value={ktTitle} onChange={e => setKtTitle(e.target.value)}
              placeholder="e.g. Policy Conversion — GL Group XML Architecture" />
            <Stack direction="row" spacing={2}>
              <FormControl sx={{ minWidth: 180 }}>
                <InputLabel>System</InputLabel>
                <Select value={ktSystem} label="System" onChange={e => setKtSystem(e.target.value as KnowledgeSystemType)}>
                  {SYSTEM_TYPES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField label="Short description" fullWidth value={ktDesc} onChange={e => setKtDesc(e.target.value)}
                placeholder="e.g. Legacy data → staging → views → small XMLs → big XML via Snowflake SPs" />
            </Stack>
          </Stack>
        )}

        {/* ── Step 1: Upload DB Schema ──────────────────────────────────── */}
        {step === 1 && (
          <Stack spacing={2.5}>
            <Alert severity="info" sx={{ py: 0.5 }}>
              No DB access needed. Paste DDL, upload an Excel data dictionary, or drop an ER diagram image.
              SAI will embed every column so schema-aware search works.
            </Alert>
            <TextField label="Paste DDL / CREATE VIEW / CREATE TABLE scripts" multiline minRows={8} fullWidth
              value={schemaContent} onChange={e => setSchemaContent(e.target.value)}
              placeholder={`CREATE VIEW PolicyHeader_VW AS\nSELECT policy_id, policy_number, effective_date\nFROM staging.Policy;\n\nCREATE VIEW ClaimsGroup_VW AS ...`}
              sx={{ fontFamily: 'monospace', '& textarea': { fontFamily: 'monospace', fontSize: 12 } }} />

            <Stack direction="row" spacing={1} alignItems="center">
              <input ref={schemaFileRef} type="file" style={{ display: 'none' }}
                accept=".sql,.ddl,.csv,.xlsx,.xls,.pdf,.txt,.png,.jpg,.jpeg"
                onChange={e => setSchemaFile(e.target.files?.[0] ?? null)} />
              <Button variant="outlined" startIcon={<AttachFileOutlined />}
                onClick={() => schemaFileRef.current?.click()}>
                {schemaFile ? 'Change File' : 'Upload File / Image'}
              </Button>
              {schemaFile && <Chip size="small" label={schemaFile.name} onDelete={() => setSchemaFile(null)} />}
              <Typography variant="caption" color="text.secondary">SQL, Excel, CSV, PDF, or ER diagram image</Typography>
            </Stack>

            <Button variant="contained" startIcon={importing ? <CircularProgress size={16} /> : <AutoAwesomeOutlined />}
              disabled={importing || (!schemaContent.trim() && !schemaFile)}
              onClick={handleImport} sx={{ alignSelf: 'flex-start' }}>
              {importing ? 'Importing & Embedding…' : 'Import & Embed Schema'}
            </Button>

            {importResult && (
              <Alert severity="success">
                ✅ <strong>{importResult.tables} tables</strong>, <strong>{importResult.columns} columns</strong> embedded.
                SAI now knows the full schema and can answer schema-specific questions.
              </Alert>
            )}
            {!importResult && (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                Schema import is optional but recommended. Skip with Next if you don't have DDL yet.
              </Alert>
            )}
          </Stack>
        )}

        {/* ── Step 2: SQL Objects ───────────────────────────────────────── */}
        {step === 2 && (
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>
                SQL Objects ({sqlObjects.length})
              </Typography>
              <Typography variant="caption" color="text.secondary">— add each view, SP, and function</Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="contained" startIcon={<AddOutlined />}
                onClick={() => { setAddingObj(true); setNewObj({ objectType: 'View' }) }}>
                + Add Object
              </Button>
            </Stack>

            {/* Add object form */}
            {addingObj && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5, borderColor: 'primary.main' }}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>New SQL Object</Typography>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={2}>
                    <TextField size="small" label="Name *" value={newObj.name || ''} fullWidth
                      onChange={e => setNewObj(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. PolicyHeader_VW, GenerateSmallXML_SP" />
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>Type</InputLabel>
                      <Select value={newObj.objectType || 'View'} label="Type"
                        onChange={e => setNewObj(p => ({ ...p, objectType: e.target.value as KTObjectType }))}>
                        {KT_OBJECT_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.icon} {t.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Stack>

                  <TextField size="small" label="SQL Code *" multiline minRows={5}
                    value={newObj.sql || ''}
                    onChange={e => setNewObj(p => ({ ...p, sql: e.target.value }))}
                    fullWidth placeholder="Paste the SQL here…"
                    sx={{ fontFamily: 'monospace', '& textarea': { fontFamily: 'monospace', fontSize: 12 } }} />

                  <TextField size="small" label="Purpose / What it does"
                    value={newObj.purpose || ''} onChange={e => setNewObj(p => ({ ...p, purpose: e.target.value }))}
                    fullWidth placeholder="e.g. Extracts PolicyHeader fields from staging for XML generation" />

                  {newObj.objectType === 'StoredProcedure' && (
                    <Stack spacing={1} sx={{ pl: 1, borderLeft: '3px solid', borderColor: 'primary.main' }}>
                      <Typography variant="caption" color="primary.main" fontWeight={700}>Dynamic SP Parameters</Typography>
                      <Stack direction="row" spacing={1.5}>
                        <TextField size="small" label="Source View" fullWidth
                          value={(newObj as any).sourceView || ''}
                          onChange={e => setNewObj(p => ({ ...p, sourceView: e.target.value } as any))}
                          placeholder="e.g. PolicyHeader_VW" />
                        <TextField size="small" label="Target Table" fullWidth
                          value={(newObj as any).targetTable || ''}
                          onChange={e => setNewObj(p => ({ ...p, targetTable: e.target.value } as any))}
                          placeholder="e.g. xml_output_policy" />
                      </Stack>
                      <TextField size="small" label="Formula / {} Template" fullWidth
                        value={(newObj as any).formula || ''}
                        onChange={e => setNewObj(p => ({ ...p, formula: e.target.value } as any))}
                        placeholder="e.g. SELECT {policy_id}, {policy_number} FROM {source_view}" />
                    </Stack>
                  )}

                  <Stack direction="row" spacing={2}>
                    <TextField size="small" label="XML Group Output" fullWidth
                      value={newObj.xmlGroup || ''} onChange={e => setNewObj(p => ({ ...p, xmlGroup: e.target.value }))}
                      placeholder="e.g. PolicyHeader, Claims, BIG_XML" />
                    <FormControl size="small" fullWidth>
                      <InputLabel>Feeds Into</InputLabel>
                      <Select value={newObj.feedsInto || ''} label="Feeds Into"
                        onChange={e => setNewObj(p => ({ ...p, feedsInto: e.target.value || null }))}>
                        <MenuItem value="">— None —</MenuItem>
                        {sqlObjects.map(o => <MenuItem key={o.id} value={o.name}>{o.name}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Stack>

                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" onClick={() => setAddingObj(false)}>Cancel</Button>
                    <Button size="small" variant="contained"
                      disabled={!newObj.name?.trim() || !newObj.sql?.trim()}
                      onClick={saveNewObj}>Save Object</Button>
                  </Stack>
                </Stack>
              </Paper>
            )}

            {/* Object list */}
            {sqlObjects.length === 0 && !addingObj && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Add each view and SP. At least one required to proceed.
              </Alert>
            )}
            <Stack spacing={1}>
              {sqlObjects.map(obj => {
                const t = KT_OBJECT_TYPES.find(t => t.value === obj.objectType)
                return (
                  <Paper key={obj.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" sx={{ fontSize: 18 }}>{t?.icon}</Typography>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" fontWeight={700}>{obj.name}</Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap">
                          <Chip size="small" label={t?.label} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                          {obj.xmlGroup && <Chip size="small" label={`→ [${obj.xmlGroup}]`} sx={{ height: 18, fontSize: 10, bgcolor: alpha('#059669', 0.1), color: '#059669' }} />}
                          {obj.feedsInto && <Chip size="small" label={`feeds: ${obj.feedsInto}`} sx={{ height: 18, fontSize: 10 }} />}
                          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>{obj.purpose?.slice(0, 60)}</Typography>
                        </Stack>
                      </Box>
                      <IconButton size="small" onClick={() => removeObj(obj.id)} sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                        <DeleteOutlined sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          </Stack>
        )}

        {/* ── Step 3: KT Session ───────────────────────────────────────── */}
        {step === 3 && (
          <Stack direction="row" spacing={2.5} sx={{ height: 420 }}>
            {/* Left: transcript */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>KT Notes / Transcript</Typography>
              <TextField
                label="Paste the employee's explanation or meeting transcript"
                multiline fullWidth
                value={transcript} onChange={e => setTranscript(e.target.value)}
                sx={{ flex: 1, '& .MuiInputBase-root': { height: '100%', alignItems: 'flex-start' } }}
                placeholder="Paste the KT meeting transcript, design doc, or explanation here…&#10;&#10;The employee explains how the views work, what each SP does, the {} placeholder convention, etc."
              />
              <Stack direction="row" spacing={1} alignItems="center">
                <input ref={transcriptFileRef} type="file" style={{ display: 'none' }}
                  accept=".txt,.md,.pdf,.docx"
                  onChange={async e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    try {
                      const res = await knowledgeApi.parseFile(f)
                      setTranscript(res.text)
                    } catch { enqueueSnackbar('File parse failed', { variant: 'error' }) }
                  }} />
                <Button size="small" variant="outlined" startIcon={<AttachFileOutlined />}
                  onClick={() => transcriptFileRef.current?.click()}>
                  Upload transcript
                </Button>
                <Button size="small" variant="contained" startIcon={analysing ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
                  disabled={analysing || !transcript.trim()} onClick={handleAnalyse}>
                  {analysing ? 'Analysing…' : sessionId ? 'Re-analyse' : 'Create Session & Analyse'}
                </Button>
              </Stack>
            </Box>

            {/* Right: suggestions */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                SAI Suggestions {suggestions.length > 0 && `(${suggestions.length})`}
              </Typography>
              {suggestions.length === 0 ? (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
                  <Typography variant="caption" color="text.disabled">
                    Paste notes and click "Create Session & Analyse" to get suggestions
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ flex: 1, overflowY: 'auto' }}>
                  <Stack spacing={1}>
                    {suggestions.map((s: any, i: number) => (
                      <Paper key={i} variant="outlined"
                        onClick={() => setSelectedSugg(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })}
                        sx={{ p: 1.25, borderRadius: 1.5, cursor: 'pointer',
                          borderColor: selectedSugg.has(i) ? 'primary.main' : 'divider',
                          borderWidth: selectedSugg.has(i) ? 2 : 1,
                          bgcolor: selectedSugg.has(i) ? alpha('#4f46e5', 0.04) : 'transparent' }}>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          <Box sx={{ width: 16, height: 16, border: '2px solid', borderColor: selectedSugg.has(i) ? 'primary.main' : 'divider',
                            borderRadius: 0.5, flexShrink: 0, mt: 0.25,
                            bgcolor: selectedSugg.has(i) ? 'primary.main' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {selectedSugg.has(i) && <CheckOutlined sx={{ fontSize: 10, color: '#fff' }} />}
                          </Box>
                          <Box>
                            <Stack direction="row" spacing={0.75} mb={0.25} flexWrap="wrap">
                              <Typography variant="caption" fontWeight={700}>{s.title}</Typography>
                              <Chip size="small" label={s.type} sx={{ height: 16, fontSize: 9 }} />
                            </Stack>
                            <Typography variant="caption" color="text.secondary">{s.reason}</Typography>
                          </Box>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              )}
              {suggestions.length > 0 && (
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => setSelectedSugg(new Set(suggestions.map((_:any,i:number)=>i)))}>Select all</Button>
                  <Button size="small" onClick={() => setSelectedSugg(new Set())}>Clear</Button>
                </Stack>
              )}
            </Box>
          </Stack>
        )}

        {/* ── Step 4: Review & Save ─────────────────────────────────────── */}
        {step === 4 && !done && (
          <Stack spacing={2.5}>
            <Typography variant="subtitle2" fontWeight={700}>Review before saving</Typography>

            <Stack spacing={1.5}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">📂 Schema</Typography>
                <Typography variant="body2">{activeSchemaObj?.name || '—'}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Stack direction="row" spacing={2}>
                  <Box>
                    <Typography variant="caption" fontWeight={700} color="text.secondary">🗄️ SQL Objects</Typography>
                    <Typography variant="body2">{sqlObjects.length} objects ({sqlObjects.filter(o=>o.objectType==='View').length} views, {sqlObjects.filter(o=>o.objectType==='StoredProcedure').length} SPs)</Typography>
                  </Box>
                  {importResult && (
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">📊 Schema Embedded</Typography>
                      <Typography variant="body2">{importResult.tables} tables, {importResult.columns} columns</Typography>
                    </Box>
                  )}
                  <Box>
                    <Typography variant="caption" fontWeight={700} color="text.secondary">💡 KB Entries from Session</Typography>
                    <Typography variant="body2">{selectedSugg.size} of {suggestions.length} selected</Typography>
                  </Box>
                </Stack>
              </Paper>

              {/* Pipeline flow preview */}
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" gutterBottom display="block">
                  🔗 Pipeline Flow
                </Typography>
                <Typography component="pre" variant="caption"
                  sx={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                  {buildFlowText()}
                </Typography>
              </Paper>
            </Stack>
          </Stack>
        )}

        {/* ── Done ─────────────────────────────────────────────────────────── */}
        {done && saveResult && (
          <Stack spacing={2} alignItems="center" py={4}>
            <CheckCircleOutlined sx={{ fontSize: 56, color: 'success.main' }} />
            <Typography variant="h6" fontWeight={700}>KT Successfully Captured!</Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              <strong>{saveResult.entries} KB entries</strong> created with embeddings.<br />
              <strong>{saveResult.links} dependency links</strong> established between objects.<br />
              All entries are now searchable in Ask SAI under the <strong>{activeSchemaObj?.name}</strong> schema.
            </Typography>
            <Alert severity="info" sx={{ maxWidth: 480, textAlign: 'left' }}>
              <strong>Next step:</strong> Go to Ask SAI → select DB Schema: {activeSchemaObj?.name || 'your schema'} → ask <em>"Show the full pipeline flow from staging to XML"</em> with the <strong>Flow Diagram</strong> format.
            </Alert>
            <Button variant="contained" onClick={() => { reset(); onClose() }}>Done</Button>
          </Stack>
        )}
      </DialogContent>

      {!done && (
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Button onClick={() => { if (step === 0) { reset(); onClose() } else setStep(s => s - 1) }}
            disabled={saving}>
            {step === 0 ? 'Cancel' : '← Back'}
          </Button>
          {step < 4 ? (
            <Tooltip title={step === 2 && sqlObjects.length === 0 ? 'Add at least one SQL object to continue' : ''}>
              <span>
                <Button variant="contained"
                  disabled={step === 0 && (!ktTitle.trim() || !schemaId) || step === 2 && sqlObjects.length === 0}
                  onClick={() => setStep(s => s + 1)}>
                  Next →
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button variant="contained" color="success"
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : <CheckOutlined />}
              onClick={handleSaveAll}>
              {saving ? 'Saving…' : '✅ Save All to KB'}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}

// ── Tab 0: Knowledge Base ─────────────────────────────────────────────────────

function KnowledgeBaseTab() {
  const queryClient              = useQueryClient()
  const { enqueueSnackbar }      = useSnackbar()
  const [typeFilter,   setTypeF]     = useState('')
  const [sysFilter,    setSysF]      = useState('')
  const [schemaFilter, setSchemaF]   = useState<number | ''>('')
  const [search,       setSearch]    = useState('')
  const [showLow,      setShowLow]   = useState(false)
  const [offset,       setOffset]    = useState(0)
  const [addOpen,      setAddOpen]   = useState(false)
  const [dupId,        setDupId]     = useState<number | null>(null)
  const [ktOpen,       setKtOpen]    = useState(false)
  const LIMIT = 50

  const { data: schemas = [] } = useQuery({
    queryKey: ['knowledge-schemas'],
    queryFn:  () => knowledgeApi.listSchemas(),
  })

  const { data: entries = [], isFetching } = useQuery({
    queryKey: ['knowledge-entries', typeFilter, sysFilter, schemaFilter, search, showLow, offset],
    queryFn:  () => knowledgeApi.listEntries({
      type:                typeFilter    || undefined,
      system:              sysFilter     || undefined,
      kb_schema_id:        schemaFilter  || undefined,
      search:              search        || undefined,
      include_low_quality: showLow,
      limit:               LIMIT,
      offset,
    }),
    refetchInterval: (query) =>
      (query.state.data as import('@/types').KnowledgeEntry[] | undefined)
        ?.some(e => e.embedding_status === 'pending') ? 8_000 : false,
  })

  const addMutation = useMutation({
    mutationFn: ({ data, skip }: { data: KnowledgeEntryCreate; skip: boolean }) =>
      knowledgeApi.processEntry(data, skip),
    onSuccess: () => {
      enqueueSnackbar('Entry processed and embedded.', { variant: 'success' })
      setAddOpen(false)
      setDupId(null)
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      if (typeof detail === 'object' && detail?.existing_id) {
        setDupId(detail.existing_id)
      } else {
        enqueueSnackbar(typeof detail === 'string' ? detail : 'Failed to process entry.', { variant: 'error' })
      }
    },
  })

  const reprocessMutation = useMutation({
    mutationFn: (id: number) => knowledgeApi.reprocessEntry(id),
    onSuccess: () => {
      enqueueSnackbar('Entry reprocessed.', { variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: () => enqueueSnackbar('Reprocess failed.', { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => knowledgeApi.deleteEntry(id),
    onSuccess: () => {
      enqueueSnackbar('Entry deleted.', { variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: () => enqueueSnackbar('Delete failed.', { variant: 'error' }),
  })

  const rebuildMutation = useMutation({
    mutationFn: () => knowledgeApi.rebuildEmbeddings(),
    onSuccess: (res) => {
      enqueueSnackbar(
        `Rebuilt ${res.rebuilt} entr${res.rebuilt !== 1 ? 'ies' : 'y'} — ${res.failed} failed.`,
        { variant: res.failed > 0 ? 'warning' : 'success' },
      )
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: () => enqueueSnackbar('Rebuild failed.', { variant: 'error' }),
  })

  const [versionEntry,   setVersionEntry]  = useState<KnowledgeEntry | null>(null)
  const [viewEntry,      setViewEntry]     = useState<KnowledgeEntry | null>(null)
  const { data: versions = [], isFetching: versionsLoading } = useQuery({
    queryKey: ['kb-versions', versionEntry?.id],
    queryFn:  () => knowledgeApi.listVersions(versionEntry!.id),
    enabled:  !!versionEntry,
  })
  const restoreMutation = useMutation({
    mutationFn: ({ id, ver }: { id: number; ver: number }) => knowledgeApi.restoreVersion(id, ver),
    onSuccess: () => {
      enqueueSnackbar('Version restored.', { variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
      queryClient.invalidateQueries({ queryKey: ['kb-versions'] })
    },
    onError: () => enqueueSnackbar('Restore failed.', { variant: 'error' }),
  })

  const [bulkOpen,       setBulkOpen]      = useState(false)
  const [bulkFile,       setBulkFile]      = useState<File | null>(null)
  const [bulkResult,     setBulkResult]    = useState<{ total: number; processed: number; failed: number; errors: { row: number; reason: string }[] } | null>(null)
  const [bulkSchemaId,   setBulkSchemaId]  = useState<number | null>(null)
  const [bulkSessionId,  setBulkSessionId] = useState<number | null>(null)
  const bulkImportMutation = useMutation({
    mutationFn: (f: File) => knowledgeApi.bulkImport(f, bulkSchemaId ?? undefined, bulkSessionId ?? undefined),
    onSuccess: (res) => {
      setBulkResult(res)
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Bulk import failed.'
      enqueueSnackbar(detail, { variant: 'error' })
      setBulkResult({ total: 0, processed: 0, failed: 1, errors: [{ row: 0, reason: detail }] })
    },
  })

  const [importQueriesOpen, setImportQueriesOpen] = useState(false)
  const [importQueriesFile, setImportQueriesFile] = useState<File | null>(null)
  const [importQueriesResult, setImportQueriesResult] = useState<{
    total: number; processed: number; skipped: number; failed: number
    ai_detected?: boolean
    errors: { row: number; reason: string }[]
  } | null>(null)
  const importQueriesRef = useRef<HTMLInputElement>(null)

  const importQueriesMutation = useMutation({
    mutationFn: (f: File) => knowledgeApi.bulkImportQueries(f),
    onSuccess: (res) => {
      setImportQueriesResult(res)
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? 'Import failed.'
      enqueueSnackbar(detail, { variant: 'error' })
      setImportQueriesResult({ total: 0, processed: 0, skipped: 0, failed: 1, errors: [{ row: 0, reason: detail }] })
    },
  })

  // ── Import Documents (bulk multi-file) ───────────────────────────────────────
  type BulkDocEvent = { file?: string; status?: string; entries_created?: number; error?: string; done?: boolean; total?: number; processed?: number; failed?: number }
  const [importDocsOpen,    setImportDocsOpen]    = useState(false)
  const [importDocsFiles,   setImportDocsFiles]   = useState<File[]>([])
  const [importDocsSchema,  setImportDocsSchema]  = useState<number | null>(null)
  const [importDocsSystem,  setImportDocsSystem]  = useState<string>('DCT')
  const [importDocsRunning, setImportDocsRunning] = useState(false)
  const [importDocsEvents,  setImportDocsEvents]  = useState<BulkDocEvent[]>([])
  const [importDocsDone,    setImportDocsDone]    = useState<BulkDocEvent | null>(null)
  const importDocsRef = useRef<HTMLInputElement>(null)

  const runImportDocs = () => {
    if (!importDocsFiles.length) return
    setImportDocsRunning(true)
    setImportDocsEvents([])
    setImportDocsDone(null)
    knowledgeApi.bulkDocuments(
      importDocsFiles,
      { kbSchemaId: importDocsSchema ?? undefined, system: importDocsSystem },
      (evt) => {
        if (evt.done) {
          setImportDocsDone(evt)
          setImportDocsRunning(false)
          queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
        } else {
          setImportDocsEvents(prev => [...prev, evt])
        }
      },
    ).catch((err: any) => {
      enqueueSnackbar(err?.message ?? 'Import failed', { variant: 'error' })
      setImportDocsRunning(false)
    })
  }

  const user = useAppStore(s => s.user)
  const canWrite  = user?.role !== 'viewer'
  const canDelete = user?.role === 'admin'

  const { data: sessions = [] } = useQuery({
    queryKey: ['knowledge-sessions-bulk', bulkSchemaId],
    queryFn:  () => knowledgeApi.listSessions({ limit: 100, kb_schema_id: bulkSchemaId ?? undefined }),
  })

  const [deleteKwOpen, setDeleteKwOpen] = useState(false)
  const [deleteKw,     setDeleteKw]     = useState('')
  const [deleteKwBusy, setDeleteKwBusy] = useState(false)

  async function handleBulkDeleteByKeyword() {
    if (!deleteKw.trim()) return
    setDeleteKwBusy(true)
    try {
      const r = await knowledgeApi.bulkDeleteByKeyword(deleteKw.trim())
      enqueueSnackbar(`Deleted ${r.deleted} entr${r.deleted !== 1 ? 'ies' : 'y'} matching "${r.keyword}"`, { variant: 'success' })
      setDeleteKwOpen(false)
      setDeleteKw('')
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Delete failed', { variant: 'error' })
    } finally { setDeleteKwBusy(false) }
  }

  return (
    <Box>
      {/* Toolbar — Row 1: Filters + primary CTA */}
      <Stack direction="row" spacing={1.5} mb={1} flexWrap="wrap" useFlexGap alignItems="center">
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Type</InputLabel>
          <Select value={typeFilter} label="Type" onChange={e => { setTypeF(e.target.value); setOffset(0) }}>
            <MenuItem value="">All</MenuItem>
            {ENTRY_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>System</InputLabel>
          <Select value={sysFilter} label="System" onChange={e => { setSysF(e.target.value); setOffset(0) }}>
            <MenuItem value="">All</MenuItem>
            {SYSTEM_TYPES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        {schemas.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Schema</InputLabel>
            <Select
              value={schemaFilter}
              label="Schema"
              onChange={e => { setSchemaF(e.target.value as number | ''); setOffset(0) }}
            >
              <MenuItem value="">All Schemas</MenuItem>
              {schemas.map(s => (
                <MenuItem key={s.id} value={s.id}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color_hex, flexShrink: 0 }} />
                    {s.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <TextField
          size="small" label="Search" value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0) }}
          sx={{ minWidth: 200 }}
        />
        <Button
          size="small" variant={showLow ? 'contained' : 'outlined'}
          color="warning"
          onClick={() => { setShowLow(v => !v); setOffset(0) }}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {showLow ? 'Hide Low Quality' : 'Show Low Quality'}
        </Button>
        <Box sx={{ flex: 1 }} />
        {canWrite && (
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => { setAddOpen(true); setDupId(null) }}>
            Add Entry
          </Button>
        )}
      </Stack>

      {/* Toolbar — Row 2: Import / utility actions */}
      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap alignItems="center">
        {canWrite && (
          <Button
            size="small" variant="outlined"
            startIcon={<UploadFileOutlined />}
            onClick={() => { setImportDocsOpen(true); setImportDocsFiles([]); setImportDocsEvents([]); setImportDocsDone(null) }}
          >
            Import Documents
          </Button>
        )}
        {canWrite && (
          <Button
            size="small" variant="outlined"
            startIcon={<ArticleOutlined />}
            onClick={() => { setImportQueriesOpen(true); setImportQueriesFile(null); setImportQueriesResult(null) }}
          >
            Import Queries
          </Button>
        )}
        {canWrite && (
          <Button
            size="small" variant="outlined"
            startIcon={<CloudDownloadOutlined />}
            onClick={() => { setBulkOpen(true); setBulkFile(null); setBulkResult(null) }}
          >
            Bulk Import
          </Button>
        )}
        {canWrite && (
          <Button size="small" variant="outlined" color="secondary"
            startIcon={<AutoAwesomeOutlined />}
            onClick={() => setKtOpen(true)}
            sx={{ textTransform: 'none', fontWeight: 600 }}>
            🎓 Guided KT
          </Button>
        )}
        {canWrite && (
          <Tooltip title="Re-embed entries that have no search index yet (no LLM re-call)">
            <Button
              size="small" variant="outlined"
              disabled={rebuildMutation.isPending}
              startIcon={rebuildMutation.isPending ? <CircularProgress size={14} /> : <RefreshOutlined />}
              onClick={() => rebuildMutation.mutate()}
            >
              Rebuild Embeddings
            </Button>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {canDelete && (
          <Tooltip title="Delete all entries matching a keyword (title, summary, or content)">
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteOutlined />}
              onClick={() => { setDeleteKwOpen(true); setDeleteKw('') }}>
              Delete Matching
            </Button>
          </Tooltip>
        )}
      </Stack>

      {isFetching && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: '30%' }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 130 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 90 }}>System</TableCell>
              <TableCell sx={{ fontWeight: 700, width: '18%' }}>Tags</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 70 }}>Quality</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 80 }}>Embed</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 75 }}>SAI</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 40 }}>Ver</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 110 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map(entry => (
              <TableRow
                key={entry.id}
                sx={entry.status === 'LOW_QUALITY' ? {
                  borderLeft: `3px solid ${tokens.amber500}`,
                  bgcolor: alpha(tokens.amber500, 0.04),
                } : undefined}
              >
                <TableCell sx={{ overflow: 'hidden' }}>
                  <Stack direction="row" spacing={0.5} alignItems="flex-start">
                    {entry.status === 'LOW_QUALITY' && (
                      <Tooltip title="Low quality — review suggested">
                        <WarningAmberOutlined sx={{ fontSize: 16, color: tokens.amber500, flexShrink: 0, mt: '2px' }} />
                      </Tooltip>
                    )}
                    <Tooltip title={entry.title} placement="top-start" enterDelay={400}>
                      <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.title}
                      </Typography>
                    </Tooltip>
                  </Stack>
                  {entry.summary && (
                    <Tooltip title={entry.summary} placement="bottom-start" enterDelay={400}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.summary}
                      </Typography>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell><Chip label={entry.type} size="small" /></TableCell>
                <TableCell><Chip label={entry.system} size="small" variant="outlined" /></TableCell>
                <TableCell sx={{ overflow: 'hidden' }}>
                  <Tooltip title={parseTags(entry.tags).join(', ')} enterDelay={400} disableHoverListener={parseTags(entry.tags).length <= 2}>
                    <Stack direction="row" spacing={0.5} flexWrap="nowrap" sx={{ overflow: 'hidden' }}>
                      {parseTags(entry.tags).slice(0, 3).map(t => (
                        <Chip key={t} label={t} size="small" sx={{ fontSize: 11, maxWidth: 80, overflow: 'hidden' }} />
                      ))}
                      {parseTags(entry.tags).length > 3 && (
                        <Chip label={`+${parseTags(entry.tags).length - 3}`} size="small" sx={{ fontSize: 11 }} />
                      )}
                    </Stack>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Chip
                    label={entry.quality_score || '—'}
                    size="small"
                    sx={{ bgcolor: qualityColor(entry.quality_score), color: '#fff', fontWeight: 700 }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={entry.embedding_status}
                    size="small"
                    sx={{ bgcolor: embColor(entry.embedding_status), color: '#fff', fontSize: 11 }}
                  />
                </TableCell>
                <TableCell>
                  {(() => {
                    const available = entry.embedding_status === 'complete' && entry.status !== 'LOW_QUALITY'
                    const partial   = entry.embedding_status === 'partial'  && entry.status !== 'LOW_QUALITY'
                    if (available) return (
                      <Tooltip title="Embedded and available to Ask SAI">
                        <Chip label="Active" size="small"
                          icon={<CheckCircleOutlined style={{ fontSize: 13 }} />}
                          sx={{ bgcolor: tokens.emerald600, color: '#fff', fontSize: 11, pl: 0.5 }} />
                      </Tooltip>
                    )
                    if (partial) return (
                      <Tooltip title="Partially embedded — some chunks available to Ask SAI">
                        <Chip label="Partial" size="small"
                          sx={{ bgcolor: tokens.amber500, color: '#fff', fontSize: 11 }} />
                      </Tooltip>
                    )
                    return (
                      <Tooltip title={entry.status === 'LOW_QUALITY' ? 'Excluded — low quality entry' : 'Not yet embedded — not available to Ask SAI'}>
                        <Chip label="Inactive" size="small"
                          sx={{ bgcolor: '#9CA3AF', color: '#fff', fontSize: 11 }} />
                      </Tooltip>
                    )
                  })()}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">v{entry.version}</Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title="View full details">
                      <IconButton size="small" onClick={() => setViewEntry(entry)} sx={{ color: 'primary.main' }}>
                        <InfoOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Version history">
                      <IconButton size="small" onClick={() => setVersionEntry(entry)}>
                        <HistoryOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canWrite && (
                      <Tooltip title="Reprocess">
                        <IconButton size="small" onClick={() => reprocessMutation.mutate(entry.id)}>
                          <RefreshOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {canDelete && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small" color="error"
                          onClick={() => {
                            if (window.confirm(`Delete entry "${entry.title}"?`))
                              deleteMutation.mutate(entry.id)
                          }}
                        >
                          <DeleteOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && !isFetching && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No entries found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      <Stack direction="row" spacing={1} justifyContent="flex-end" mt={1}>
        <Button size="small" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}>
          ← Prev
        </Button>
        <Typography variant="caption" sx={{ alignSelf: 'center', color: 'text.secondary' }}>
          {offset + 1}–{offset + entries.length}
        </Typography>
        <Button size="small" disabled={entries.length < LIMIT} onClick={() => setOffset(o => o + LIMIT)}>
          Next →
        </Button>
      </Stack>

      {/* Version History Dialog */}
      <Dialog open={!!versionEntry} onClose={() => setVersionEntry(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Version History — {versionEntry?.title}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            (current: v{versionEntry?.version})
          </Typography>
        </DialogTitle>
        <DialogContent>
          {versionsLoading && <LinearProgress sx={{ mb: 1 }} />}
          {!versionsLoading && versions.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No version history yet. Previous states are saved automatically on each Reprocess.
            </Typography>
          )}
          {versions.map((v) => (
            <Paper key={v.id} variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Chip label={`v${v.version_num}`} size="small" sx={{ fontWeight: 700, fontSize: '0.7rem' }} />
                <Typography variant="caption" color="text.secondary">
                  {v.changed_at ? new Date(v.changed_at).toLocaleString() : ''}
                  {v.changed_by ? ` · ${v.changed_by}` : ''}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {canWrite && (
                  <Button
                    size="small" variant="outlined"
                    disabled={restoreMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Restore v${v.version_num}? Current state will be saved as a new version.`))
                        restoreMutation.mutate({ id: versionEntry!.id, ver: v.version_num })
                    }}
                  >
                    Restore
                  </Button>
                )}
              </Box>
              <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>
                <strong>Summary:</strong> {v.snapshot?.summary || <em>—</em>}
              </Typography>
              {v.snapshot?.quality_score && (
                <Typography variant="caption" color="text.secondary">
                  Quality: {v.snapshot.quality_score} · Status: {v.snapshot.status}
                </Typography>
              )}
            </Paper>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVersionEntry(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <EntryFormDialog
        open={addOpen}
        onClose={() => { setAddOpen(false); setDupId(null) }}
        onSubmit={(data, skip) => addMutation.mutate({ data, skip })}
        loading={addMutation.isPending}
        dupId={dupId}
      />

      <KTWizardDialog open={ktOpen} onClose={() => setKtOpen(false)} />

      {/* ── Entry Detail Viewer ── */}
      {viewEntry && (
        <Dialog open={!!viewEntry} onClose={() => setViewEntry(null)} maxWidth="md" fullWidth
          PaperProps={{ sx: { minHeight: '70vh' } }}>
          <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" fontWeight={700}>{viewEntry.title}</Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" mt={0.5}>
                  <Chip size="small" label={viewEntry.type} sx={{ fontWeight: 700, fontSize: 11 }} />
                  <Chip size="small" label={viewEntry.system} variant="outlined" sx={{ fontSize: 11 }} />
                  {viewEntry.quality_score && (
                    <Chip size="small" label={viewEntry.quality_score}
                      sx={{ bgcolor: qualityColor(viewEntry.quality_score), color: '#fff', fontWeight: 700, fontSize: 11 }} />
                  )}
                  <Chip size="small" label={viewEntry.embedding_status}
                    sx={{ bgcolor: embColor(viewEntry.embedding_status), color: '#fff', fontSize: 11 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>v{viewEntry.version}</Typography>
                </Stack>
              </Box>
              <IconButton size="small" onClick={() => setViewEntry(null)}><CloseOutlined /></IconButton>
            </Stack>
          </DialogTitle>

          <DialogContent sx={{ pt: 1 }}>
            <Stack spacing={2.5}>
              {/* Tags */}
              {parseTags(viewEntry.tags).length > 0 && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.75 }}>Tags</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {parseTags(viewEntry.tags).map(t => (
                      <Chip key={t} size="small" label={t} sx={{ fontSize: 11, bgcolor: alpha('#4f46e5', 0.08), color: 'primary.main' }} />
                    ))}
                  </Stack>
                </Box>
              )}

              {/* Summary */}
              {viewEntry.summary && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>Summary</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: alpha('#4f46e5', 0.02) }}>
                    <Typography variant="body2">{viewEntry.summary}</Typography>
                  </Paper>
                </Box>
              )}

              {/* AI Understanding — detailed explanation + key points */}
              {(viewEntry.detailed_explanation || viewEntry.key_points) && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                    AI Understanding
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: alpha('#059669', 0.02) }}>
                    {viewEntry.detailed_explanation && (
                      <Typography variant="body2" sx={{ mb: viewEntry.key_points ? 1.5 : 0 }}>
                        {viewEntry.detailed_explanation}
                      </Typography>
                    )}
                    {viewEntry.key_points && (() => {
                      try {
                        const kp = JSON.parse(viewEntry.key_points)
                        if (Array.isArray(kp) && kp.length > 0) return (
                          <Box>
                            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Key Points</Typography>
                            <Stack spacing={0.5}>
                              {kp.map((pt: string, i: number) => (
                                <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                                  <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#059669', mt: 0.75, flexShrink: 0 }} />
                                  <Typography variant="body2">{pt}</Typography>
                                </Stack>
                              ))}
                            </Stack>
                          </Box>
                        )
                      } catch { return null }
                    })()}
                  </Paper>
                </Box>
              )}

              {/* Decision / Reason */}
              {(viewEntry.decision || viewEntry.reason) && (
                <Stack direction="row" spacing={2}>
                  {viewEntry.decision && (
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>Decision</Typography>
                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                        <Typography variant="body2">{viewEntry.decision}</Typography>
                      </Paper>
                    </Box>
                  )}
                  {viewEntry.reason && (
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>Reason</Typography>
                      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                        <Typography variant="body2">{viewEntry.reason}</Typography>
                      </Paper>
                    </Box>
                  )}
                </Stack>
              )}

              {/* Generated entities / operational fields */}
              {(viewEntry.op_category || viewEntry.severity || viewEntry.owner_team || viewEntry.sql_template) && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.75 }}>Generated Entities</Typography>
                  <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                    {viewEntry.op_category && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Category</Typography>
                        <Chip size="small" label={viewEntry.op_category} sx={{ display: 'block', mt: 0.25, fontSize: 11 }} />
                      </Box>
                    )}
                    {viewEntry.severity && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Severity</Typography>
                        <Chip size="small" label={viewEntry.severity}
                          sx={{ display: 'block', mt: 0.25, fontSize: 11,
                            bgcolor: viewEntry.severity === 'CRITICAL' ? '#dc2626' : viewEntry.severity === 'HIGH' ? '#d97706' : '#6b7280',
                            color: '#fff', fontWeight: 700 }} />
                      </Box>
                    )}
                    {viewEntry.owner_team && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Owner Team</Typography>
                        <Chip size="small" label={viewEntry.owner_team} variant="outlined" sx={{ display: 'block', mt: 0.25, fontSize: 11 }} />
                      </Box>
                    )}
                    {viewEntry.quality_score && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Quality</Typography>
                        <Chip size="small" label={viewEntry.quality_score}
                          sx={{ display: 'block', mt: 0.25, fontSize: 11,
                            bgcolor: qualityColor(viewEntry.quality_score), color: '#fff', fontWeight: 700 }} />
                      </Box>
                    )}
                  </Stack>
                  {viewEntry.sql_template && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={700}>SQL Template</Typography>
                      <Paper variant="outlined" sx={{ p: 1.25, mt: 0.5, borderRadius: 1.5, bgcolor: '#0f172a' }}>
                        <Typography component="pre" sx={{ fontFamily: 'monospace', fontSize: 12, color: '#34d399', whiteSpace: 'pre-wrap', m: 0 }}>
                          {viewEntry.sql_template}
                        </Typography>
                      </Paper>
                    </Box>
                  )}
                </Box>
              )}

              {/* Suggestions from AI */}
              {viewEntry.suggestions && (() => {
                try {
                  const sugg = JSON.parse(viewEntry.suggestions)
                  if (Array.isArray(sugg) && sugg.length > 0) return (
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>AI Suggestions to Improve</Typography>
                      <Stack spacing={0.5}>
                        {sugg.map((s: string, i: number) => (
                          <Stack key={i} direction="row" spacing={0.75} alignItems="flex-start">
                            <WarningAmberOutlined sx={{ fontSize: 14, color: 'warning.main', mt: 0.3, flexShrink: 0 }} />
                            <Typography variant="body2" color="text.secondary">{s}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  )
                } catch { return null }
              })()}

              {/* Raw content */}
              {viewEntry.raw_content && (
                <Box>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>Full Content</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, maxHeight: 300, overflowY: 'auto', bgcolor: alpha('#f8fafc', 0.5) }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>
                      {viewEntry.raw_content}
                    </Typography>
                  </Paper>
                </Box>
              )}

              {/* Metadata footer */}
              <Stack direction="row" spacing={2} flexWrap="wrap">
                {viewEntry.created_by && <Typography variant="caption" color="text.secondary">Created by: {viewEntry.created_by}</Typography>}
                {viewEntry.source_type && <Typography variant="caption" color="text.secondary">Source: {viewEntry.source_type}</Typography>}
                {viewEntry.session_id && <Typography variant="caption" color="text.secondary">Session ID: {viewEntry.session_id}</Typography>}
              </Stack>
            </Stack>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Import Queries Dialog ─────────────────────────────────────────────── */}
      <Dialog open={importQueriesOpen} onClose={() => setImportQueriesOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flex: 1 }}>
              Import Query Library
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                CSV/Excel (direct) · TXT/SQL/PDF/DOCX (AI extracts entries automatically)
              </Typography>
            </Box>
            <QueryLibraryFieldInfo />
          </Stack>
        </DialogTitle>
        <DialogContent>
          {/* Supported formats chips */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.75 }}>
              Accepted file types
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {[
                { label: '.csv / .xlsx', note: 'Direct (no AI)', color: 'primary' },
                { label: '.txt / .sql', note: 'AI extracts', color: 'success' },
                { label: '.md / .json', note: 'AI extracts', color: 'success' },
                { label: '.pdf / .docx', note: 'AI extracts', color: 'success' },
              ].map(f => (
                <Chip key={f.label} label={`${f.label} — ${f.note}`} size="small"
                  color={f.color as any} variant="outlined"
                  sx={{ fontSize: '0.68rem', height: 22, fontFamily: 'monospace' }} />
              ))}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Button component="label" variant="outlined" startIcon={<AttachFileOutlined />}>
              {importQueriesFile ? importQueriesFile.name : 'Choose File'}
              <input ref={importQueriesRef} type="file" hidden
                accept=".csv,.xlsx,.xls,.txt,.sql,.md,.json,.pdf,.docx"
                onChange={e => { setImportQueriesFile(e.target.files?.[0] ?? null); setImportQueriesResult(null) }} />
            </Button>
            {importQueriesFile && (
              <Typography variant="caption" color="text.secondary">
                {(importQueriesFile.size / 1024).toFixed(1)} KB · {importQueriesFile.name.split('.').pop()?.toUpperCase()}
              </Typography>
            )}
            <Button size="small" variant="text" startIcon={<DownloadOutlined />} sx={{ ml: 'auto' }}
              onClick={() => {
                const template = [
                  { title: 'V_GL_DETAIL_AU', sql: 'SELECT * FROM CML_CUSTOM_BRONZE.GL.V_GL_DETAIL_AU', description: 'Monthly GL transactions for Australia', system: 'Snowflake', tags: 'GL,Australia', type: 'ViewDefinition' },
                  { title: 'Get Active Policies', sql: "SELECT * FROM policies WHERE status = 'active'", description: 'Returns all active policies', system: 'MSSQL', tags: 'policy,active', type: 'QueryLibrary' },
                  { title: 'Customers Table', sql: 'CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(200))', description: 'Core customers table', system: 'MSSQL', tags: 'schema,customers', type: 'SchemaDefinition' },
                ]
                const ws = XLSX.utils.json_to_sheet(template, { header: ['title','sql','description','system','tags','type'] })
                ws['!cols'] = [{ wch: 30 }, { wch: 60 }, { wch: 40 }, { wch: 14 }, { wch: 20 }, { wch: 18 }]
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'KB Query Template')
                XLSX.writeFile(wb, 'kb-query-template.xlsx')
              }}>
              Template
            </Button>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Button component="label" variant="outlined" startIcon={<AttachFileOutlined />}>
              {importQueriesFile ? importQueriesFile.name : 'Choose File (any format)'}
              <input
                ref={importQueriesRef}
                type="file" hidden
                accept=".csv,.xlsx,.xls,.txt,.sql,.md,.json,.pdf,.docx"
                onChange={e => { setImportQueriesFile(e.target.files?.[0] ?? null); setImportQueriesResult(null) }}
              />
            </Button>
            {importQueriesFile && (
              <Typography variant="caption" color="text.secondary">
                {(importQueriesFile.size / 1024).toFixed(1)} KB · {importQueriesFile.name.split('.').pop()?.toUpperCase()}
              </Typography>
            )}
          </Box>

          {importQueriesResult && (
            <Box sx={{ mt: 2 }}>
              {importQueriesResult.ai_detected && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  AI extracted and structured {importQueriesResult.total} entries from this file
                </Alert>
              )}
              <Alert severity={importQueriesResult.failed === 0 ? 'success' : importQueriesResult.processed === 0 ? 'error' : 'warning'}>
                <strong>{importQueriesResult.processed}</strong> of <strong>{importQueriesResult.total}</strong> entries imported
                {importQueriesResult.skipped > 0 && `, ${importQueriesResult.skipped} skipped`}
                {importQueriesResult.failed > 0 && `, ${importQueriesResult.failed} failed`}
              </Alert>
              {importQueriesResult.errors.length > 0 && (
                <Box sx={{ maxHeight: 120, overflowY: 'auto', mt: 1, fontSize: '0.75rem' }}>
                  {importQueriesResult.errors.map((e, idx) => (
                    <Typography key={idx} variant="caption" display="block" color="error.main">
                      #{e.row}: {e.reason}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportQueriesOpen(false)}>Close</Button>
          <Button
            variant="contained"
            disabled={!importQueriesFile || importQueriesMutation.isPending}
            startIcon={importQueriesMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <ArticleOutlined />}
            onClick={() => importQueriesFile && importQueriesMutation.mutate(importQueriesFile)}
          >
            {importQueriesMutation.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Import Documents Dialog ─────────────────────────────────────────── */}
      <Dialog open={importDocsOpen} onClose={() => { if (!importDocsRunning) { setImportDocsOpen(false) } }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          Import Documents
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, mt: 0.25 }}>
            Upload .docx, .sql, .xlsx, or .xml files. Each file is processed into KB entries automatically.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          {/* File picker */}
          <Box
            sx={{
              border: '2px dashed', borderColor: importDocsFiles.length ? 'primary.main' : 'divider',
              borderRadius: 2, p: 2.5, textAlign: 'center', cursor: 'pointer',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }, transition: 'all 0.15s',
            }}
            onClick={() => importDocsRef.current?.click()}
          >
            <input
              ref={importDocsRef}
              type="file"
              multiple
              accept=".docx,.sql,.xlsx,.xls,.xml"
              style={{ display: 'none' }}
              onChange={e => {
                const picked = Array.from(e.target.files || [])
                setImportDocsFiles(picked)
                setImportDocsEvents([])
                setImportDocsDone(null)
              }}
            />
            <UploadFileOutlined sx={{ fontSize: 32, color: importDocsFiles.length ? 'primary.main' : 'text.disabled', mb: 0.5 }} />
            <Typography variant="body2" color={importDocsFiles.length ? 'primary.main' : 'text.secondary'}>
              {importDocsFiles.length
                ? `${importDocsFiles.length} file${importDocsFiles.length > 1 ? 's' : ''} selected`
                : 'Click to select files (.docx, .sql, .xlsx, .xml)'}
            </Typography>
          </Box>

          {/* Show selected file chips */}
          {importDocsFiles.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {importDocsFiles.map((f, i) => {
                const ext = f.name.split('.').pop()?.toLowerCase() || ''
                const color = ext === 'xml' ? 'success' : ext === 'sql' ? 'warning' : ext === 'docx' ? 'primary' : 'secondary'
                return (
                  <Chip key={i} label={f.name} size="small" color={color as any} variant="outlined"
                    onDelete={importDocsRunning ? undefined : () => setImportDocsFiles(prev => prev.filter((_, j) => j !== i))} />
                )
              })}
            </Box>
          )}

          {/* Schema + System options */}
          <Stack direction="row" spacing={2}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>KB Schema (optional)</InputLabel>
              <Select
                value={importDocsSchema ?? ''}
                label="KB Schema (optional)"
                onChange={e => setImportDocsSchema(e.target.value ? Number(e.target.value) : null)}
              >
                <MenuItem value="">— None —</MenuItem>
                {(schemas as KnowledgeSchema[]).map((s: KnowledgeSchema) => (
                  <MenuItem key={s.id} value={s.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color_hex, flexShrink: 0 }} />
                      <span>{s.name}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ width: 130 }}>
              <InputLabel>System</InputLabel>
              <Select value={importDocsSystem} label="System"
                onChange={e => setImportDocsSystem(e.target.value)}>
                <MenuItem value="DCT">DCT</MenuItem>
                <MenuItem value="General">General</MenuItem>
                <MenuItem value="Snowflake">Snowflake</MenuItem>
                <MenuItem value="ADO">ADO</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {/* Progress feed */}
          {importDocsEvents.length > 0 && (
            <Box sx={{ maxHeight: 180, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
              {importDocsEvents.map((evt, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                  {evt.status === 'done'
                    ? <CheckCircleOutlined fontSize="small" color="success" />
                    : evt.status === 'error'
                      ? <WarningAmberOutlined fontSize="small" color="error" />
                      : <HourglassEmptyOutlined fontSize="small" color="action" />
                  }
                  <Typography variant="caption" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {evt.file}
                  </Typography>
                  {evt.status === 'done' && (
                    <Chip label={`+${evt.entries_created} entries`} size="small" color="success" variant="outlined" />
                  )}
                  {evt.status === 'error' && (
                    <Typography variant="caption" color="error.main" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {evt.error}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Box>
          )}

          {importDocsRunning && <LinearProgress />}

          {importDocsDone && (
            <Alert severity={importDocsDone.failed === 0 ? 'success' : importDocsDone.processed === 0 ? 'error' : 'warning'}>
              <strong>{importDocsDone.processed}</strong> of <strong>{importDocsDone.total}</strong> files processed
              {(importDocsDone.failed ?? 0) > 0 && `, ${importDocsDone.failed} failed`}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportDocsOpen(false)} disabled={importDocsRunning}>Close</Button>
          <Button
            variant="contained"
            disabled={!importDocsFiles.length || importDocsRunning || !!importDocsDone}
            startIcon={importDocsRunning ? <CircularProgress size={14} color="inherit" /> : <UploadFileOutlined />}
            onClick={runImportDocs}
          >
            {importDocsRunning ? 'Importing…' : 'Import All'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete by Keyword Dialog */}
      <Dialog open={deleteKwOpen} onClose={() => { if (!deleteKwBusy) setDeleteKwOpen(false) }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: 'error.main' }}>Delete Matching Entries</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <Alert severity="warning">
            This will permanently delete <strong>all</strong> KB entries whose title, summary, or content contains the keyword. This cannot be undone.
          </Alert>
          <TextField
            autoFocus
            label="Keyword to match"
            placeholder="e.g. GL, reconciliation, ADF"
            size="small"
            value={deleteKw}
            onChange={e => setDeleteKw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && deleteKw.trim()) handleBulkDeleteByKeyword() }}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteKwOpen(false)} disabled={deleteKwBusy}>Cancel</Button>
          <Button variant="contained" color="error" disabled={!deleteKw.trim() || deleteKwBusy}
            startIcon={deleteKwBusy ? <CircularProgress size={14} color="inherit" /> : <DeleteOutlined />}
            onClick={handleBulkDeleteByKeyword}>
            {deleteKwBusy ? 'Deleting…' : 'Delete All Matching'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flex: 1 }}>
              Bulk Import KB Entries
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                Upload CSV or Excel — LLM structures each row (~10–15s per row).
              </Typography>
            </Box>
            <BulkImportFieldInfo />
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2, fontSize: '0.78rem' }}>
            For SQL views/queries use <strong>Import Query Library</strong> — it's much faster (no LLM per row).
          </Alert>

          {/* Schema + Session assignment */}
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>Schema *</InputLabel>
              <Select value={bulkSchemaId ?? ''} label="Schema *"
                onChange={e => setBulkSchemaId(e.target.value ? Number(e.target.value) : null)}>
                <MenuItem value="">— Select schema —</MenuItem>
                {(schemas as KnowledgeSchema[]).map(s => (
                  <MenuItem key={s.id} value={s.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color_hex, flexShrink: 0 }} />
                      {s.name}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>Session (optional)</InputLabel>
              <Select value={bulkSessionId ?? ''} label="Session (optional)"
                onChange={e => setBulkSessionId(e.target.value ? Number(e.target.value) : null)}>
                <MenuItem value="">— None —</MenuItem>
                {(bulkSchemaId
                  ? (sessions as any[]).filter((s: any) => s.kb_schema_id === bulkSchemaId)
                  : (sessions as any[])
                ).map((s: any) => (
                  <MenuItem key={s.id} value={s.id}>
                    <Box>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>{s.title}</Typography>
                      <Typography variant="caption" color="text.secondary">{s.session_type}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Button component="label" variant="outlined" startIcon={<AttachFileOutlined />}>
              {bulkFile ? bulkFile.name : 'Choose CSV / Excel'}
              <input type="file" hidden accept=".csv,.xlsx,.xls"
                onChange={e => { setBulkFile(e.target.files?.[0] ?? null); setBulkResult(null) }} />
            </Button>
            <Button size="small" variant="text" startIcon={<DownloadOutlined />}
              onClick={() => {
                const template = [
                  { title: 'Stop Batch When GL Recon Fails', raw_content: 'When GL reconciliation variance exceeds threshold, halt the nightly batch immediately and alert the GL team. Do not process downstream until recon is cleared.', type: 'OperationalRule', system: 'GL', tags: 'recon,stop,GL', op_category: 'StopCondition', severity: 'CRITICAL', owner_team: 'GL/Data Team' },
                  { title: 'Validate Policy Exists Before Processing', raw_content: 'Before processing any transaction, verify the policy number exists in ADO. If not found, flag as MISSING_POLICY and skip the row. Log the failure for daily review.', type: 'OperationalRule', system: 'ADO', tags: 'validation,policy', op_category: 'ValidationRule', severity: 'HIGH', owner_team: 'Policy Ops' },
                  { title: 'Premium Reconciliation Recovery Steps', raw_content: 'When premium recon fails: 1) Freeze GL postings. 2) Pull variance report from Snowflake. 3) Notify Finance lead. 4) Rerun recon job after fix. 5) Confirm zero variance before resuming.', type: 'OperationalRule', system: 'DCT', tags: 'reconciliation,recovery', op_category: 'RecoveryRule', severity: 'HIGH', owner_team: 'Finance Team' },
                  { title: 'GL Reconciliation Process Overview', raw_content: 'GL reconciliation runs monthly. Source: Snowflake CML_CUSTOM_BRONZE.GL. Target: MSSQL. Match key: policy_number + effective_date.', type: 'UseCase', system: 'Snowflake', tags: 'GL,reconciliation', op_category: 'ReconRule', severity: '', owner_team: '' },
                ]
                const ws = XLSX.utils.json_to_sheet(template, { header: ['title','raw_content','type','system','tags','op_category','severity','owner_team'] })
                ws['!cols'] = [{ wch: 38 }, { wch: 80 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 20 }, { wch: 10 }, { wch: 18 }]
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'KB Bulk Import')
                XLSX.writeFile(wb, 'kb-bulk-import-template.xlsx')
              }}>
              Template
            </Button>
          </Stack>

          {bulkResult && (
            <Box sx={{ mt: 1 }}>
              <Alert severity={bulkResult.failed === 0 ? 'success' : bulkResult.processed === 0 ? 'error' : 'warning'}>
                <strong>{bulkResult.processed}</strong> of <strong>{bulkResult.total}</strong> rows imported
                {bulkResult.failed > 0 && ` — ${bulkResult.failed} failed`}
              </Alert>
              {bulkResult.errors.length > 0 && (
                <Box sx={{ maxHeight: 140, overflowY: 'auto', mt: 1, fontSize: '0.75rem' }}>
                  {bulkResult.errors.map((e, i) => (
                    <Typography key={i} variant="caption" display="block" color="error.main">
                      Row {e.row}: {e.reason}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpen(false)}>Close</Button>
          <Button
            variant="contained"
            disabled={!bulkFile || bulkImportMutation.isPending}
            startIcon={bulkImportMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <CloudDownloadOutlined />}
            onClick={() => bulkFile && bulkImportMutation.mutate(bulkFile)}
          >
            {bulkImportMutation.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ── Tab 1: Ask SAI (document-style) ──────────────────────────────────────────

interface QARecord {
  id:        string
  question:  string
  result:    AskSAIResult
  timestamp: string
}

function _qaKey(username?: string | null) {
  return `sai-doc-history-${username ?? 'anon'}`
}
function loadQAHistory(username?: string | null): QARecord[] {
  try { return JSON.parse(localStorage.getItem(_qaKey(username)) ?? '[]') } catch { return [] }
}
function saveQAHistory(h: QARecord[], username?: string | null) {
  localStorage.setItem(_qaKey(username), JSON.stringify(h.slice(-50)))
}

function exportQAToExcel(records: QARecord[]) {
  if (!records.length) return
  const rows = records.map(r => {
    if (r.result.status === 'ANSWERED') {
      const a = r.result as AskSAIAnswered
      return {
        'Question':    r.question,
        'Status':      'Answered',
        'Answer':      a.answer,
        'Sources':     a.sources.map(s => s.entry_title).join('; '),
        'Confidence':  a.sources.length
          ? (a.sources.reduce((s, x) => s + x.score, 0) / a.sources.length * 100).toFixed(0) + '%'
          : '',
        'Model':        a.debug?.model ?? '',
        'Tokens In':    a.debug?.tokens_in ?? '',
        'Tokens Out':   a.debug?.tokens_out ?? '',
        'Latency (ms)': a.debug?.latency_ms ?? '',
        'Timestamp':    new Date(r.timestamp).toLocaleString(),
      }
    } else {
      const u = r.result as AskSAIUnanswered
      return {
        'Question':    r.question,
        'Status':      'Unanswered',
        'Answer':      u.reason,
        'Sources':     '', 'Confidence': '', 'Model': '',
        'Tokens In':   '', 'Tokens Out': '', 'Latency (ms)': '',
        'Timestamp':   new Date(r.timestamp).toLocaleString(),
      }
    }
  })
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['Question','Status','Answer','Sources','Confidence','Model','Tokens In','Tokens Out','Latency (ms)','Timestamp'],
  })
  ws['!cols'] = [{ wch: 50 },{ wch: 12 },{ wch: 80 },{ wch: 40 },{ wch: 12 },{ wch: 18 },{ wch: 10 },{ wch: 10 },{ wch: 14 },{ wch: 22 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ask SAI')
  XLSX.writeFile(wb, `ask-sai-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function QADocumentView({ record }: { record: QARecord }) {
  const { enqueueSnackbar } = useSnackbar()
  const user   = useAppStore(s => s.user)
  const result = record.result

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [submitting,   setSubmitting]   = useState(false)

  const submitFeedback = async (feedbackType: string) => {
    setSubmitting(true)
    try {
      const answer = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
      await knowledgeApi.flagResponse({
        question: record.question, ai_answer: answer,
        feedback_type: feedbackType, asked_by: user?.username,
      })
      setFeedbackDone(true)
      setFeedbackOpen(false)
      enqueueSnackbar('Feedback noted — added to review queue', { variant: 'success' })
    } catch {
      enqueueSnackbar('Failed to submit feedback', { variant: 'error' })
    } finally { setSubmitting(false) }
  }

  const handleCopy = () => {
    const text = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
    navigator.clipboard.writeText(text).then(() => enqueueSnackbar('Copied', { variant: 'success' }))
  }
  const handlePrint = () => {
    const answer = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>SAI Document</title>
      <style>body{font-family:'Segoe UI',sans-serif;padding:48px 64px;max-width:860px;margin:auto;color:#111;font-size:14px;line-height:1.7}
      .header{border-bottom:2px solid #4f46e5;padding-bottom:16px;margin-bottom:28px}.question{font-size:18px;font-weight:700;color:#111;margin:8px 0 4px}
      .meta{font-size:12px;color:#9ca3af}h2{color:#4f46e5;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-top:24px}
      code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:12px;font-family:monospace}pre{background:#f3f4f6;padding:12px;white-space:pre-wrap}
      ul,ol{padding-left:20px}@media print{body{padding:24px}}</style>
    </head><body><div class="header">
      <div class="question">${record.question.replace(/</g,'&lt;')}</div>
      <div class="meta">${new Date(record.timestamp).toLocaleString()}</div>
    </div><div id="c"></div>
    <script>document.getElementById('c').innerHTML=${JSON.stringify(
      answer.replace(/## (.*)/g,'<h2>$1</h2>').replace(/### (.*)/g,'<h3>$1</h3>')
        .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'))};
    window.onload=()=>{window.print();window.close();}</script></body></html>`)
    win.document.close()
  }

  if (result.status === 'UNANSWERED') {
    const u = result as AskSAIUnanswered
    return (
      <Box>
        <Alert severity="warning" icon={<HourglassEmptyOutlined />} sx={{ mt: 1 }}>
          <Typography variant="body2" fontWeight={700} gutterBottom>Not found in knowledge base</Typography>
          <Typography variant="body2">{u.reason}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{u.action}</Typography>
        </Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
          {feedbackDone ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
              <Typography variant="caption" color="success.main">Feedback sent — queued for review</Typography>
            </Box>
          ) : feedbackOpen ? (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>What's the issue?</Typography>
              {FEEDBACK_OPTIONS.map(opt => (
                <Chip key={opt.value} label={opt.label} size="small" variant="outlined"
                  disabled={submitting} onClick={() => submitFeedback(opt.value)}
                  sx={{ fontSize: 11, height: 22, cursor: 'pointer',
                    '&:hover': { bgcolor: 'error.50', borderColor: 'error.main', color: 'error.main' } }}
                />
              ))}
              <Chip label="Cancel" size="small" onClick={() => setFeedbackOpen(false)}
                sx={{ fontSize: 11, height: 22, cursor: 'pointer' }} />
            </>
          ) : (
            <Tooltip title="Flag as unanswered / needs improvement">
              <Chip icon={<ThumbDownOutlined sx={{ fontSize: 13 }} />}
                label="Not answered properly?" size="small" variant="outlined"
                onClick={() => setFeedbackOpen(true)}
                sx={{ fontSize: 11, height: 24, cursor: 'pointer', color: 'text.secondary',
                  '&:hover': { borderColor: 'error.main', color: 'error.main' } }}
              />
            </Tooltip>
          )}
        </Box>
      </Box>
    )
  }

  const answered = result as AskSAIAnswered
  const avgConf = answered.sources.length
    ? (answered.sources.reduce((s, x) => s + x.score, 0) / answered.sources.length * 100).toFixed(0)
    : null

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        {avgConf && (
          <Chip size="small" label={`${avgConf}% confidence`}
            sx={{ bgcolor: parseInt(avgConf) >= 70 ? tokens.emerald600 : tokens.amber500, color: '#fff', fontWeight: 600, fontSize: '0.72rem' }} />
        )}
        {answered.debug?.model && (
          <Chip size="small" label={answered.debug.model} variant="outlined" sx={{ fontSize: '0.7rem' }} />
        )}
        {answered.debug && (
          <Chip size="small" label={`${answered.debug.tokens_in + answered.debug.tokens_out} tok · ${answered.debug.latency_ms}ms`}
            variant="outlined" sx={{ fontSize: '0.7rem' }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Copy"><IconButton size="small" onClick={handleCopy}><ContentCopyOutlined sx={{ fontSize: 15 }} /></IconButton></Tooltip>
        <Tooltip title="Print"><IconButton size="small" onClick={handlePrint}><PrintOutlined sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      </Box>

      {/* Operational payload card */}
      {answered.operational && (
        <Box sx={{ mb: 1.5 }}>
          <OperationalDecisionCard payload={answered.operational} compact={false} />
        </Box>
      )}

      {/* Answer body */}
      <Box sx={{ borderLeft: '3px solid', borderColor: 'primary.main', pl: 2.5, py: 0.5, mb: 2 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h2: ({ children }) => (
              <Typography variant="subtitle1" fontWeight={700}
                sx={{ mt: 2, mb: 0.75, color: 'primary.main', borderBottom: '1px solid', borderColor: 'divider', pb: 0.5 }}>
                {children}
              </Typography>
            ),
            h3: ({ children }) => <Typography variant="body1" fontWeight={700} sx={{ mt: 1.5, mb: 0.5 }}>{children}</Typography>,
            p:  ({ children }) => <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.75 }}>{children}</Typography>,
            ul: ({ children }) => <Box component="ul" sx={{ pl: 3, my: 0.75, '& li': { mb: 0.5 } }}>{children}</Box>,
            ol: ({ children }) => <Box component="ol" sx={{ pl: 3, my: 0.75, '& li': { mb: 0.5 } }}>{children}</Box>,
            li: ({ children }) => <Typography component="li" variant="body2" sx={{ lineHeight: 1.65 }}>{children}</Typography>,
            strong: ({ children }) => <Box component="strong" sx={{ fontWeight: 700 }}>{children}</Box>,
            code: ({ className, children }: React.ComponentProps<'code'> & { className?: string }) => {
              const lang = (className || '').replace('language-', '')
              if (lang === 'mermaid') return <MermaidDiagram code={String(children).trim()} />
              return (
                <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.78rem', bgcolor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 0.5 }}>
                  {children}
                </Box>
              )
            },
            pre: ({ children }) => (
              <Box component="pre" sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1, overflowX: 'auto', fontSize: '0.78rem', fontFamily: 'monospace', my: 1 }}>
                {children}
              </Box>
            ),
            table: ({ children }) => (
              <Box sx={{ overflowX: 'auto', my: 1.5 }}>
                <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
                  {children}
                </Box>
              </Box>
            ),
            thead: ({ children }) => (
              <Box component="thead" sx={{ bgcolor: 'action.selected' }}>{children}</Box>
            ),
            tbody: ({ children }) => <Box component="tbody">{children}</Box>,
            tr: ({ children }) => (
              <Box component="tr" sx={{ '&:nth-of-type(even)': { bgcolor: 'action.hover' } }}>{children}</Box>
            ),
            th: ({ children }) => (
              <Box component="th" sx={{
                px: 1.5, py: 0.75, textAlign: 'left', fontWeight: 700,
                borderBottom: '2px solid', borderColor: 'divider',
                whiteSpace: 'nowrap', fontSize: '0.78rem',
              }}>
                {children}
              </Box>
            ),
            td: ({ children }) => (
              <Box component="td" sx={{
                px: 1.5, py: 0.75, verticalAlign: 'top',
                borderBottom: '1px solid', borderColor: 'divider',
                fontSize: '0.8rem', minWidth: 80,
              }}>
                {children}
              </Box>
            ),
          }}
        >
          {answered.answer}
        </ReactMarkdown>
      </Box>

      {/* References */}
      {answered.sources.length > 0 && (
        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            References ({answered.sources.length})
          </Typography>
          <Stack spacing={0.5} mt={0.5}>
            {answered.sources.map((s, idx) => (
              <Box key={s.chunk_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.disabled" sx={{ minWidth: 18 }}>[{idx + 1}]</Typography>
                <Chip label={s.entry_system} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{s.entry_title}</Typography>
                {s.topic && <Typography variant="caption" color="text.secondary">— {s.topic}</Typography>}
                <Box sx={{ width: 56 }}>
                  <LinearProgress variant="determinate" value={s.score * 100}
                    sx={{ height: 3, borderRadius: 2, '& .MuiLinearProgress-bar': { bgcolor: tokens.emerald600 } }} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32, textAlign: 'right' }}>
                  {(s.score * 100).toFixed(0)}%
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {/* Feedback */}
      <Box sx={{ mt: 1.5, pt: 1.25, borderTop: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {feedbackDone ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
            <Typography variant="caption" color="success.main">Feedback sent — queued for review</Typography>
          </Box>
        ) : feedbackOpen ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>What's the issue?</Typography>
            {FEEDBACK_OPTIONS.map(opt => (
              <Chip key={opt.value} label={opt.label} size="small" variant="outlined"
                disabled={submitting} onClick={() => submitFeedback(opt.value)}
                sx={{ fontSize: '0.68rem', height: 22, cursor: 'pointer',
                  '&:hover': { bgcolor: 'error.light', borderColor: 'error.main', color: 'error.dark' } }}
              />
            ))}
            <Chip label="Cancel" size="small" onClick={() => setFeedbackOpen(false)}
              sx={{ fontSize: '0.68rem', height: 22, cursor: 'pointer' }} />
          </>
        ) : (
          <>
            <Typography variant="caption" color="text.disabled" sx={{ flex: 1 }}>Was this helpful?</Typography>
            <Tooltip title="Flag this response for review">
              <IconButton size="small" onClick={() => setFeedbackOpen(true)}
                sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                <ThumbDownOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
    </Box>
  )
}

function AskSAITab() {
  const { enqueueSnackbar } = useSnackbar()
  const user          = useAppStore(s => s.user)
  const activeProject = useAppStore(s => s.activeProject)
  const username = user?.username ?? null
  const [qaHistory,       setQAHistory]       = useState<QARecord[]>(() => loadQAHistory(username))
  const [selected,        setSelected]        = useState<QARecord | null>(() => loadQAHistory(username)[0] ?? null)

  // Reload history when the logged-in user changes (different user, different history)
  useEffect(() => {
    const h = loadQAHistory(username)
    setQAHistory(h)
    setSelected(h[0] ?? null)
  }, [username])
  const [inputText,       setInput]           = useState('')
  const [isLoading,       setLoading]         = useState(false)
  const [historyOpen,     setHistoryOpen]      = useState(false)
  const [selectedSchemaId,setSelectedSchemaId] = useState<number | null>(null)
  const [askMode,         setAskMode]          = useState<'global' | 'scoped'>('global')
  const [responseType,    setResponseType]     = useState<ResponseType>('answer')
  const [selectedConnId,  setSelectedConnId]   = useState<number | null>(null)

  // Document scope state
  const [docsScope,         setDocsScope]         = useState<DocumentsScope>('kb')
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [selectedFileIds,   setSelectedFileIds]   = useState<number[]>([])

  const inputRef    = useRef<HTMLInputElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [qaHistory.length, isLoading])

  const { data: connOptions = [] } = useQuery({
    queryKey: ['connections-for-asksai', activeProject?.id],
    queryFn:  () => connectionsApi.list(activeProject?.id),
    enabled:  !!activeProject?.id,
  })

  const { data: docsFolders = [] } = useQuery<AfsFolder[]>({
    queryKey: ['afs-folders'],
    queryFn:  () => documentsApi.getFolders(),
    staleTime: 30_000,
  })

  const { data: allFilesFlat = [] } = useQuery<AfsFile[]>({
    queryKey: ['afs-all-files-kp', (docsFolders as AfsFolder[]).map((f: AfsFolder) => f.id)],
    queryFn:  async () => {
      const results = await Promise.all((docsFolders as AfsFolder[]).map((f: AfsFolder) => documentsApi.getFolderFiles(f.id)))
      return results.flat()
    },
    enabled: docsScope === 'files' && (docsFolders as AfsFolder[]).length > 0,
    staleTime: 30_000,
  })

  const { data: schemas = [] } = useQuery({
    queryKey: ['knowledge-schemas'],
    queryFn:  () => knowledgeApi.listSchemas(),
  })
  const activeSchema = schemas.find((s: KnowledgeSchema) => s.id === selectedSchemaId) ?? null

  const buildHistory = useCallback(() =>
    qaHistory.slice(-6).flatMap(r => ([
      { role: 'user',      content: r.question },
      { role: 'assistant', content: r.result.status === 'ANSWERED' ? (r.result as AskSAIAnswered).answer : '' },
    ])), [qaHistory])

  async function handleSend() {
    const q = inputText.trim()
    if (!q || isLoading) return
    setInput('')
    setLoading(true)
    try {
      const result = await knowledgeApi.ask({
        question:      q,
        asked_by:      user?.username,
        project_id:    activeProject?.id,
        history:       buildHistory(),
        schema_id:     askMode === 'scoped' && selectedSchemaId ? selectedSchemaId : undefined,
        response_type: responseType,
        conn_id:       selectedConnId ?? undefined,
        scope:         docsScope,
        file_ids:      docsScope === 'files' && selectedFileIds.length ? selectedFileIds : undefined,
        folder_ids:    docsScope === 'folders' && selectedFolderIds.length ? selectedFolderIds : undefined,
      })
      const record: QARecord = { id: uuid(), question: q, result, timestamp: new Date().toISOString() }
      const updated = [record, ...qaHistory]
      setQAHistory(updated)
      saveQAHistory(updated, username)
      setSelected(record)
    } catch (e: any) {
      const status = e?.response?.status
      const msg = status === 401 ? 'Session expired — please log in again.'
                : status === 500 ? 'SAI backend error — please try again in a moment.'
                : status === 503 ? 'SAI is temporarily unavailable — retrying shortly.'
                : 'Ask SAI request failed — check your connection.'
      enqueueSnackbar(msg, { variant: 'error' })
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleDelete(id: string) {
    const updated = qaHistory.filter(r => r.id !== id)
    setQAHistory(updated)
    saveQAHistory(updated)
    if (selected?.id === id) setSelected(updated[0] ?? null)
  }

  function getSuggestedFollowUps(r: QARecord): string[] {
    const rt = r.result.status === 'ANSWERED' ? ((r.result as AskSAIAnswered).response_type ?? 'answer') : 'answer'
    if (rt === 'teach_me')     return ['Can you give a concrete example?', 'What are common pitfalls?', 'How is this typically implemented?']
    if (rt === 'troubleshoot') return ['What are the root causes?', 'How do I prevent this?', 'What logs should I check?']
    if (rt === 'plan')         return ['What are the risks?', 'What is the first step?', 'Who should be involved?']
    if (rt === 'generate')     return ['Can you optimise this?', 'Add error handling to this', 'Explain how this works']
    if (rt === 'review')       return ['What are the critical issues?', 'How do I fix the top issue?', 'Are there security concerns?']
    if (rt === 'summary')      return ['Go deeper on this', 'What are the key decisions?', 'Who are the stakeholders?']
    return ['Tell me more', 'Give me an example', 'How does this work in practice?']
  }

  return (
    <Box sx={{ display: 'flex', height: 640, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>

      {/* History sidebar — collapsible */}
      <Collapse orientation="horizontal" in={historyOpen}
        sx={{ flexShrink: 0, '& .MuiCollapse-wrapperInner': { display: 'flex' } }}>
        <Box sx={{ width: 256, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <HistoryOutlined sx={{ fontSize: 15, color: 'primary.main' }} />
              <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>History</Typography>
              <Tooltip title="Export to Excel">
                <IconButton size="small" disabled={qaHistory.length === 0} onClick={() => exportQAToExcel(qaHistory)}>
                  <DownloadOutlined sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>

          <List dense disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
            {qaHistory.length === 0 && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="caption" color="text.disabled">No queries yet</Typography>
              </Box>
            )}
            {qaHistory.map(r => (
              <ListItemButton key={r.id} selected={selected?.id === r.id} onClick={() => setSelected(r)}
                sx={{ py: 0.75, px: 1.25, alignItems: 'flex-start',
                  '&.Mui-selected': { bgcolor: alpha('#4f46e5', 0.06), borderLeft: '3px solid', borderColor: 'primary.main', pl: '7px' } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <ListItemText
                    primary={r.question}
                    primaryTypographyProps={{ variant: 'caption', fontWeight: 600, noWrap: true }}
                    secondary={new Date(r.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    secondaryTypographyProps={{ variant: 'caption', fontSize: '0.65rem' }}
                  />
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center" mt={0.5}>
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    bgcolor: r.result.status === 'ANSWERED' ? tokens.emerald600 : tokens.amber500 }} />
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={e => { e.stopPropagation(); handleDelete(r.id) }}
                      sx={{ p: 0.25, opacity: 0.35, '&:hover': { opacity: 1 } }}>
                      <DeleteOutlined sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Collapse>

      {/* Document view */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Schema scope banner */}
        {activeSchema && (
          <Box sx={{ px: 2, py: 0.75, bgcolor: activeSchema.color_hex + '18',
            borderBottom: `2px solid ${activeSchema.color_hex}`,
            display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: activeSchema.color_hex, flexShrink: 0 }} />
            <Typography variant="caption" fontWeight={700} sx={{ color: activeSchema.color_hex }}>
              Searching within schema: {activeSchema.name}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Chip label="Clear scope" size="small" variant="outlined"
              onClick={() => setSelectedSchemaId(null)}
              sx={{ fontSize: 11, height: 20, color: activeSchema.color_hex, borderColor: activeSchema.color_hex }} />
          </Box>
        )}
        {/* ── Input bar — unified query builder ── */}
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          {/* Top toolbar: scope + format in one row */}
          <Box sx={{ px: 2, pt: 1.5, pb: 1.25, borderBottom: '1px solid', borderColor: 'divider', bgcolor: alpha('#4f46e5', 0.02), display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {/* Row 1: history + new chat + scope + schema connections */}
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
              <Tooltip title={historyOpen ? 'Hide history' : `History (${qaHistory.length})`}>
                <IconButton size="small" onClick={() => setHistoryOpen(o => !o)}
                  sx={{ color: historyOpen ? 'primary.main' : 'text.disabled', p: 0.5 }}>
                  <Badge badgeContent={!historyOpen && qaHistory.length > 0 ? qaHistory.length : 0} color="primary" max={99}>
                    <HistoryOutlined sx={{ fontSize: 18 }} />
                  </Badge>
                </IconButton>
              </Tooltip>
              <Tooltip title="New Chat — clear history and start fresh (Ctrl+N)">
                <Button size="small" variant="outlined" startIcon={<AddOutlined sx={{ fontSize: 13 }} />}
                  onClick={() => { setQAHistory([]); setSelected(null); setInput('') }}
                  sx={{ px: 1, py: 0.25, fontSize: '0.7rem', fontWeight: 700, minHeight: 24, textTransform: 'none',
                        borderColor: 'primary.main', color: 'primary.main', '&:hover': { bgcolor: 'primary.50' } }}>
                  New Chat
                </Button>
              </Tooltip>

              {/* Scope: global vs scoped */}
              {schemas.length > 0 && (
                <>
                  <Box sx={{ width: '1px', height: 18, bgcolor: 'divider', flexShrink: 0 }} />
                  <ToggleButtonGroup size="small" exclusive value={askMode}
                    onChange={(_, v) => { if (!v) return; setAskMode(v); if (v === 'global') setSelectedSchemaId(null) }}
                    sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.25, fontSize: 11, textTransform: 'none', minHeight: 22, border: '1px solid', borderColor: 'divider' } }}>
                    <ToggleButton value="global">🌐 Global</ToggleButton>
                    <ToggleButton value="scoped">🔍 Scoped</ToggleButton>
                  </ToggleButtonGroup>
                  {askMode === 'scoped' && (schemas as KnowledgeSchema[]).map(s => (
                    <Chip key={s.id} label={s.name} size="small"
                      variant={selectedSchemaId === s.id ? 'filled' : 'outlined'}
                      onClick={() => setSelectedSchemaId(prev => prev === s.id ? null : s.id)}
                      icon={<Box sx={{ width: 7, height: 7, borderRadius: '50%',
                        bgcolor: selectedSchemaId === s.id ? '#fff' : s.color_hex, ml: '4px !important' }} />}
                      sx={{ fontSize: 11, height: 20,
                        ...(selectedSchemaId === s.id
                          ? { bgcolor: s.color_hex, color: '#fff' }
                          : { borderColor: s.color_hex + '80', color: s.color_hex }) }} />
                  ))}
                </>
              )}

              {/* Connection selector — schema embeddings */}
              {(connOptions as any[]).length > 0 && (
                <>
                  <Box sx={{ width: '1px', height: 18, bgcolor: 'divider', flexShrink: 0 }} />
                  <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, letterSpacing: 0.3, flexShrink: 0 }}>
                    DB Schema:
                  </Typography>
                  <Chip label="All" size="small"
                    variant={selectedConnId === null ? 'filled' : 'outlined'}
                    onClick={() => setSelectedConnId(null)}
                    sx={{ fontSize: 11, height: 22, cursor: 'pointer',
                      ...(selectedConnId === null ? { bgcolor: '#64748b', color: '#fff' } : { borderColor: 'divider' }) }}
                  />
                  {(connOptions as any[]).map((c: any) => (
                    <Chip key={c.id} label={c.name} size="small"
                      variant={selectedConnId === c.id ? 'filled' : 'outlined'}
                      onClick={() => setSelectedConnId(prev => prev === c.id ? null : c.id)}
                      sx={{ fontSize: 11, height: 22, cursor: 'pointer',
                        ...(selectedConnId === c.id ? { bgcolor: '#0891b2', color: '#fff' } : { borderColor: 'divider' }) }}
                    />
                  ))}
                </>
              )}
            </Stack>

            {/* Row 2: all dropdowns in one row — I need + Search in + conditional folder/file picker */}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', gap: 1 }}>
              <FormControl size="small" sx={{ minWidth: 175 }}>
                <InputLabel sx={{ fontSize: '0.72rem' }}>I need</InputLabel>
                <Select
                  value={responseType}
                  label="I need"
                  onChange={e => setResponseType(e.target.value as ResponseType)}
                  sx={{ fontSize: '0.75rem' }}
                >
                  {RESPONSE_TYPES.map(rt => (
                    <MenuItem key={rt.value} value={rt.value}>
                      <Box component="span" sx={{ mr: 0.75 }}>{rt.icon}</Box>{rt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel sx={{ fontSize: '0.72rem' }}>Search in</InputLabel>
                <Select
                  value={docsScope}
                  label="Search in"
                  onChange={e => {
                    const v = e.target.value as DocumentsScope
                    setDocsScope(v)
                    if (v === 'kb' || v === 'all') { setSelectedFolderIds([]); setSelectedFileIds([]) }
                  }}
                  sx={{ fontSize: '0.75rem' }}
                >
                  <MenuItem value="kb"><Box component="span" sx={{ mr: 0.75 }}>📚</Box>KB Schema</MenuItem>
                  <MenuItem value="all"><Box component="span" sx={{ mr: 0.75 }}>🌐</Box>All Knowledge</MenuItem>
                  <MenuItem value="folders"><Box component="span" sx={{ mr: 0.75 }}>📁</Box>Folders</MenuItem>
                  <MenuItem value="files"><Box component="span" sx={{ mr: 0.75 }}>📄</Box>Files</MenuItem>
                </Select>
              </FormControl>

              {docsScope === 'folders' && (
                <FormControl size="small" sx={{ minWidth: 200, maxWidth: 340 }}>
                  <InputLabel sx={{ fontSize: '0.72rem' }}>
                    {`Folders${selectedFolderIds.length > 0 ? ` (${selectedFolderIds.length})` : ''}`}
                  </InputLabel>
                  <Select
                    multiple
                    value={selectedFolderIds}
                    onChange={e => setSelectedFolderIds(e.target.value as number[])}
                    input={<OutlinedInput label={`Folders${selectedFolderIds.length > 0 ? ` (${selectedFolderIds.length})` : ''}`} />}
                    renderValue={selected =>
                      (docsFolders as AfsFolder[]).filter(f => (selected as number[]).includes(f.id)).map(f => f.name).join(', ')
                    }
                    sx={{ fontSize: '0.75rem' }}
                  >
                    {(docsFolders as AfsFolder[]).length === 0
                      ? <MenuItem disabled><Typography variant="caption">No folders yet</Typography></MenuItem>
                      : (docsFolders as AfsFolder[]).map((f: AfsFolder) => (
                        <MenuItem key={f.id} value={f.id} dense>
                          <Checkbox size="small" checked={selectedFolderIds.includes(f.id)} sx={{ p: 0.5 }} />
                          <MuiListItemText primary={f.name} primaryTypographyProps={{ fontSize: '0.8rem' }} />
                        </MenuItem>
                      ))
                    }
                  </Select>
                </FormControl>
              )}

              {docsScope === 'files' && (
                <FormControl size="small" sx={{ minWidth: 220, maxWidth: 380 }}>
                  <InputLabel sx={{ fontSize: '0.72rem' }}>
                    {`Files${selectedFileIds.length > 0 ? ` (${selectedFileIds.length})` : ''}`}
                  </InputLabel>
                  <Select
                    multiple
                    value={selectedFileIds}
                    onChange={e => setSelectedFileIds(e.target.value as number[])}
                    input={<OutlinedInput label={`Files${selectedFileIds.length > 0 ? ` (${selectedFileIds.length})` : ''}`} />}
                    renderValue={selected =>
                      (allFilesFlat as AfsFile[]).filter(f => (selected as number[]).includes(f.id)).map(f => f.filename).join(', ') || 'Select files…'
                    }
                    sx={{ fontSize: '0.75rem' }}
                  >
                    {(docsFolders as AfsFolder[]).map((folder: AfsFolder) => {
                      const folderFiles = (allFilesFlat as AfsFile[]).filter((f: AfsFile) => f.folder_id === folder.id)
                      if (folderFiles.length === 0) return null
                      return [
                        <MenuItem key={`hdr-${folder.id}`} disabled dense sx={{ opacity: 0.6 }}>
                          <FolderCopyOutlined sx={{ fontSize: 12, mr: 1 }} />
                          <Typography variant="caption" fontWeight={700}>{folder.name}</Typography>
                        </MenuItem>,
                        ...folderFiles.map((f: AfsFile) => (
                          <MenuItem key={f.id} value={f.id} dense sx={{ pl: 3 }}>
                            <Checkbox size="small" checked={selectedFileIds.includes(f.id)} sx={{ p: 0.5 }} />
                            <MuiListItemText primary={f.filename} primaryTypographyProps={{ fontSize: '0.78rem' }} />
                          </MenuItem>
                        )),
                      ]
                    })}
                    {(allFilesFlat as AfsFile[]).length === 0 && (
                      <MenuItem disabled><Typography variant="caption">No extracted files yet</Typography></MenuItem>
                    )}
                  </Select>
                </FormControl>
              )}
            </Stack>
          </Box>

        </Box>

        {/* Conversational thread — oldest first, newest at bottom */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5, display: 'flex', flexDirection: 'column' }}>
          {qaHistory.length === 0 && !isLoading && (
            <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 8 }}>
              <ArticleOutlined sx={{ fontSize: 52, opacity: 0.15, mb: 1.5 }} />
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>Start a conversation with SAI</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340, mx: 'auto', mb: 2 }}>
                Ask SAI a question to begin. Follow-up questions will appear in this thread.
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                {['Which team owns billing reconciliation?', 'What are the missing policy validation rules?', 'Explain the premium reconciliation process'].map(s => (
                  <Chip key={s} label={s} size="small" variant="outlined" onClick={() => setInput(s)}
                    sx={{ cursor: 'pointer', fontSize: '0.71rem', maxWidth: 220,
                      height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5, lineHeight: 1.4 } }} />
                ))}
              </Stack>
            </Box>
          )}

          {[...qaHistory].reverse().map(r => (
            <Box key={r.id} sx={{ mb: 2.5 }}>
              {/* User question bubble */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, maxWidth: '85%' }}>
                  <Paper elevation={0} sx={{
                    px: 2, py: 1.25, borderRadius: '16px 16px 4px 16px',
                    bgcolor: alpha('#4f46e5', 0.08), border: '1px solid', borderColor: alpha('#4f46e5', 0.15),
                  }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', lineHeight: 1.5 }}>
                      {r.question}
                    </Typography>
                    <Typography variant="caption" color="text.disabled"
                      sx={{ display: 'block', mt: 0.25, textAlign: 'right', fontSize: '0.62rem' }}>
                      {new Date(r.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </Paper>
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => handleDelete(r.id)}
                      sx={{ mt: 0.5, p: 0.25, opacity: 0.3, flexShrink: 0, '&:hover': { opacity: 1 } }}>
                      <DeleteOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* SAI answer */}
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: '#4f46e5', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.5 }}>
                  <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 800 }}>S</Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <AssistantBubble result={r.result} question={r.question} />
                  {r.result.status === 'ANSWERED' && (
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {getSuggestedFollowUps(r).map(s => (
                        <Chip key={s} label={s} size="small" variant="outlined"
                          onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50) }}
                          sx={{ fontSize: '0.7rem', height: 24, cursor: 'pointer', borderColor: 'divider',
                            color: 'text.secondary', borderRadius: '12px',
                            '&:hover': { borderColor: 'primary.main', color: 'primary.main', bgcolor: alpha('#4f46e5', 0.04) } }} />
                      ))}
                    </Stack>
                  )}
                </Box>
              </Box>
            </Box>
          ))}

          {isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mb: 2 }}>
              <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: '#4f46e5', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.5 }}>
                <Typography sx={{ color: '#fff', fontSize: 11, fontWeight: 800 }}>S</Typography>
              </Box>
              <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={14} />
                  <Typography variant="body2" color="text.secondary">SAI is thinking…</Typography>
                </Stack>
              </Paper>
            </Box>
          )}
          <div ref={threadEndRef} />
        </Box>

        {/* Input row — anchored to bottom */}
        <Box sx={{ px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
          {(() => {
            const activeRt = RESPONSE_TYPES.find(r => r.value === responseType)!
            return (
              <Stack direction="row" spacing={1} alignItems="flex-end">
                <TextField
                  inputRef={inputRef}
                  fullWidth multiline maxRows={4}
                  placeholder={
                    responseType === 'generate'      ? 'What do you need generated? e.g. "SQL to find GL posting gaps for last month"'
                    : responseType === 'teach_me'    ? 'What do you want to learn? e.g. "Explain the GL reconciliation process"'
                    : responseType === 'review'      ? 'What should SAI review? e.g. "Review the premium reconciliation SQL"'
                    : responseType === 'troubleshoot'? 'Describe the issue… e.g. "Claims are duplicating during delta loads"'
                    : responseType === 'plan'        ? 'What do you want a plan for? e.g. "Plan for migrating GL layer to Snowflake"'
                    : responseType === 'summary'     ? 'What do you want summarised? e.g. "Summarise the GL reconciliation process"'
                    : 'Ask a question or follow up on the conversation…'
                  }
                  value={inputText}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  disabled={isLoading}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      fontSize: 14,
                      '&.Mui-focused fieldset': { borderColor: activeRt.color, borderWidth: 2 },
                    }
                  }}
                />
                <Button variant="contained" onClick={handleSend}
                  disabled={isLoading || !inputText.trim()}
                  sx={{ mb: 0.25, minWidth: 48, px: 1.5, height: 40, borderRadius: 2, flexShrink: 0,
                    bgcolor: activeRt.color, '&:hover': { bgcolor: activeRt.color, filter: 'brightness(0.9)' } }}>
                  {isLoading ? <CircularProgress size={16} color="inherit" /> : <SendOutlined />}
                </Button>
              </Stack>
            )
          })()}
        </Box>
      </Box>
    </Box>
  )
}

// ── Mermaid diagram renderer ──────────────────────────────────────────────────

// Serialize all Mermaid renders to prevent ID conflicts when multiple diagrams mount at once
let _mermaidQueue: Promise<void> = Promise.resolve()

function MermaidDiagram({ code }: { code: string }) {
  const id  = useRef(`mermaid-${Math.random().toString(36).slice(2)}`).current
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    _mermaidQueue = _mermaidQueue.then(async () => {
      if (cancelled || !ref.current) return
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
        const { svg } = await mermaid.render(id, code)
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      } catch {
        if (!cancelled && ref.current)
          ref.current.innerHTML = `<pre style="font-size:11px;overflow:auto;white-space:pre-wrap">${code}</pre>`
      }
    })
    return () => { cancelled = true }
  }, [code]) // id is stable — not needed in deps

  return <Box ref={ref} sx={{ my: 1, '& svg': { maxWidth: '100%', height: 'auto' } }} />
}

const FEEDBACK_OPTIONS = [
  { value: 'not_answered_well', label: 'Not answered well' },
  { value: 'not_satisfied',     label: 'Not satisfied'     },
  { value: 'incorrect',         label: 'Seems incorrect'   },
  { value: 'incomplete',        label: 'Incomplete answer' },
]

function AssistantBubble({ result, question }: { result: AskSAIResult; question: string }) {
  const { enqueueSnackbar } = useSnackbar()
  const user = useAppStore(s => s.user)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handlePrint = () => {
    const answer = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
    const win = window.open('', '_blank', 'width=800,height=600')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head>
      <title>SAI Answer</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; max-width: 800px; margin: auto; color: #111; }
        h2 { color: #4f46e5; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-top: 24px; }
        h3 { margin-top: 16px; }
        pre, code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
        pre { padding: 12px; white-space: pre-wrap; }
        ul, ol { padding-left: 20px; }
        .question { color: #6b7280; font-size: 13px; border-left: 3px solid #4f46e5; padding-left: 12px; margin-bottom: 20px; }
        @media print { body { padding: 16px; } }
      </style>
    </head><body>
      <div class="question"><strong>Question:</strong> ${question.replace(/</g, '&lt;')}</div>
      <div id="content"></div>
      <script>
        document.getElementById('content').innerHTML = ${JSON.stringify(answer
          .replace(/## (.*)/g, '<h2>$1</h2>')
          .replace(/### (.*)/g, '<h3>$1</h3>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>'))};
        window.onload = () => { window.print(); window.close(); }
      </script>
    </body></html>`)
    win.document.close()
  }

  const submitFeedback = async (feedbackType: string) => {
    setSubmitting(true)
    try {
      const answer = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
      await knowledgeApi.flagResponse({
        question, ai_answer: answer, feedback_type: feedbackType, asked_by: user?.username,
      })
      setFeedbackDone(true)
      setFeedbackOpen(false)
      enqueueSnackbar('Feedback noted — added to review queue', { variant: 'success' })
    } catch {
      enqueueSnackbar('Failed to submit feedback', { variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  if (result.status === 'UNANSWERED') {
    return (
      <Box>
        <Alert severity="warning" icon={<HourglassEmptyOutlined />}>
          <Typography variant="body2" fontWeight={600} gutterBottom>Not yet in the knowledge base</Typography>
          <Typography variant="body2">{result.reason}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {result.action}
          </Typography>
        </Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
          {feedbackDone ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
              <Typography variant="caption" color="success.main">Feedback sent — queued for review</Typography>
            </Box>
          ) : feedbackOpen ? (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>What's the issue?</Typography>
              {FEEDBACK_OPTIONS.map(opt => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  size="small"
                  variant="outlined"
                  disabled={submitting}
                  onClick={() => submitFeedback(opt.value)}
                  sx={{ fontSize: 11, height: 22, cursor: 'pointer',
                    '&:hover': { bgcolor: 'error.50', borderColor: 'error.main', color: 'error.main' } }}
                />
              ))}
              <Chip label="Cancel" size="small" onClick={() => setFeedbackOpen(false)}
                sx={{ fontSize: 11, height: 22, cursor: 'pointer' }} />
            </>
          ) : (
            <Tooltip title="Flag this as unanswered / needs improvement">
              <Chip
                icon={<ThumbDownOutlined sx={{ fontSize: 13 }} />}
                label="Not answered properly?"
                size="small"
                variant="outlined"
                onClick={() => setFeedbackOpen(true)}
                sx={{ fontSize: 11, height: 24, cursor: 'pointer', color: 'text.secondary',
                  '&:hover': { borderColor: 'error.main', color: 'error.main' } }}
              />
            </Tooltip>
          )}
        </Box>
      </Box>
    )
  }

  const answered = result as AskSAIAnswered

  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2, maxWidth: '100%' }}>
      {/* ── Action toolbar ── */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mb: 0.5 }}>
        <Tooltip title={copied ? 'Copied!' : 'Copy answer'}>
          <IconButton size="small" onClick={handleCopy}
            sx={{ color: copied ? 'success.main' : 'text.disabled', '&:hover': { color: 'primary.main' } }}>
            <ContentCopyOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Print answer">
          <IconButton size="small" onClick={handlePrint}
            sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}>
            <PrintOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {answered.operational && (
        <OperationalDecisionCard payload={answered.operational} compact={false} />
      )}

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <Typography variant="subtitle2" fontWeight={700}
              sx={{ mt: 1.5, mb: 0.5, color: 'primary.main', borderBottom: '1px solid', borderColor: 'divider', pb: 0.25 }}>
              {children}
            </Typography>
          ),
          h3: ({ children }) => (
            <Typography variant="body2" fontWeight={700} sx={{ mt: 1, mb: 0.25 }}>
              {children}
            </Typography>
          ),
          p: ({ children }) => (
            <Typography variant="body2" sx={{ mb: 0.75, lineHeight: 1.65 }}>
              {children}
            </Typography>
          ),
          ul: ({ children }) => (
            <Box component="ul" sx={{ pl: 2.5, my: 0.5, '& li': { mb: 0.25 } }}>{children}</Box>
          ),
          ol: ({ children }) => (
            <Box component="ol" sx={{ pl: 2.5, my: 0.5, '& li': { mb: 0.25 } }}>{children}</Box>
          ),
          li: ({ children }) => (
            <Typography component="li" variant="body2" sx={{ lineHeight: 1.6 }}>{children}</Typography>
          ),
          strong: ({ children }) => (
            <Box component="strong" sx={{ fontWeight: 700 }}>{children}</Box>
          ),
          code: ({ className, children, ...props }: React.ComponentProps<'code'> & { className?: string }) => {
            const lang = (className || '').replace('language-', '')
            if (lang === 'mermaid') {
              return <MermaidDiagram code={String(children).trim()} />
            }
            const isBlock = !!(props as { node?: { type?: string } }).node
            return (
              <Box component="code" sx={{
                fontFamily: 'monospace', fontSize: '0.78rem',
                bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5,
                display: isBlock ? 'block' : 'inline', whiteSpace: 'pre-wrap',
              }}>
                {children}
              </Box>
            )
          },
          pre: ({ children }) => (
            <Box component="pre" sx={{ m: 0, p: 0 }}>{children}</Box>
          ),
          table: ({ children }) => (
            <Box sx={{ overflowX: 'auto', my: 1.5 }}>
              <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
                {children}
              </Box>
            </Box>
          ),
          thead: ({ children }) => (
            <Box component="thead" sx={{ bgcolor: 'action.selected' }}>{children}</Box>
          ),
          tbody: ({ children }) => <Box component="tbody">{children}</Box>,
          tr: ({ children }) => (
            <Box component="tr" sx={{ '&:nth-of-type(even)': { bgcolor: 'action.hover' } }}>{children}</Box>
          ),
          th: ({ children }) => (
            <Box component="th" sx={{
              px: 1.5, py: 0.75, textAlign: 'left', fontWeight: 700,
              borderBottom: '2px solid', borderColor: 'divider',
              whiteSpace: 'nowrap', fontSize: '0.78rem',
            }}>
              {children}
            </Box>
          ),
          td: ({ children }) => (
            <Box component="td" sx={{
              px: 1.5, py: 0.75, verticalAlign: 'top',
              borderBottom: '1px solid', borderColor: 'divider',
              fontSize: '0.8rem', minWidth: 80,
            }}>
              {children}
            </Box>
          ),
        }}
      >
        {answered.answer}
      </ReactMarkdown>

      {answered.sources.length > 0 && (
        <Accordion disableGutters elevation={0} sx={{ mt: 1, bgcolor: 'transparent', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ px: 0, minHeight: 32, '& .MuiAccordionSummary-content': { my: 0 } }}>
            <Typography variant="caption" color="text.secondary">
              {answered.sources.length} source{answered.sources.length !== 1 ? 's' : ''}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0 }}>
            <Stack spacing={0.75}>
              {answered.sources.map(s => (
                <Stack key={s.chunk_id} direction="row" spacing={1} alignItems="center">
                  <Chip label={s.entry_system} size="small" variant="outlined" sx={{ fontSize: 10 }} />
                  <Typography variant="caption" fontWeight={600}>{s.entry_title}</Typography>
                  {s.topic && <Typography variant="caption" color="text.secondary">· {s.topic}</Typography>}
                  <Box sx={{ flex: 1 }} />
                  <Box sx={{ width: 60 }}>
                    <LinearProgress
                      variant="determinate" value={s.score * 100}
                      sx={{ height: 4, borderRadius: 2,
                        '& .MuiLinearProgress-bar': { bgcolor: tokens.emerald600 } }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34 }}>
                    {(s.score * 100).toFixed(0)}%
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      {/* ── Inline debug chips ── */}
      {answered.debug && (
        <Stack direction="row" spacing={0.75} mt={0.75} flexWrap="wrap">
          <Chip
            size="small"
            icon={<BugReportOutlined style={{ fontSize: 11 }} />}
            label={answered.debug.model}
            sx={{ height: 18, fontSize: '0.6rem', bgcolor: alpha('#7C3AED', 0.08), color: '#7C3AED', border: 'none' }}
          />
          <Chip
            size="small"
            label={`${answered.debug.tokens_in}↑ ${answered.debug.tokens_out}↓ tokens`}
            sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'action.hover', border: 'none' }}
          />
          <Chip
            size="small"
            label={`${answered.debug.latency_ms}ms`}
            sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'action.hover', border: 'none' }}
          />
        </Stack>
      )}

      {/* ── Response feedback ── */}
      <Box sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1 }}>
        {feedbackDone ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
            <Typography variant="caption" color="success.main">Feedback sent — queued for review</Typography>
          </Box>
        ) : feedbackOpen ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>What's the issue?</Typography>
            {FEEDBACK_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                size="small"
                variant="outlined"
                disabled={submitting}
                onClick={() => submitFeedback(opt.value)}
                sx={{ fontSize: '0.68rem', height: 22, cursor: 'pointer',
                  '&:hover': { bgcolor: 'error.light', borderColor: 'error.main', color: 'error.dark' } }}
              />
            ))}
            <IconButton size="small" onClick={() => setFeedbackOpen(false)} sx={{ ml: 'auto' }}>
              <ExpandLessOutlined fontSize="small" />
            </IconButton>
          </>
        ) : (
          <>
            <Typography variant="caption" color="text.disabled" sx={{ flex: 1 }}>Was this helpful?</Typography>
            <Tooltip title="Flag this response for review">
              <IconButton size="small" onClick={() => setFeedbackOpen(true)}
                sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                <ThumbDownOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
    </Paper>
  )
}

// ── Tab 2: History ────────────────────────────────────────────────────────────

function HistoryTab() {
  const [expanded, setExpanded] = useState<number | null>(null)
  const { data: traces = [], isFetching, refetch } = useQuery({
    queryKey: ['ai-traces', 'knowledge'],
    queryFn: () => adminApi.getTraces({ module: 'knowledge', limit: 100 }),
    staleTime: 30_000,
  })

  return (
    <Box>
      <Stack direction="row" alignItems="center" mb={2} spacing={1}>
        <HistoryOutlined sx={{ color: 'text.secondary', fontSize: 18 }} />
        <Typography variant="subtitle2" fontWeight={700}>SAI Interaction History</Typography>
        <Box flex={1} />
        {isFetching && <CircularProgress size={14} />}
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => refetch()}>
            <RefreshOutlined sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {traces.length === 0 && !isFetching && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
          No SAI interactions yet — ask a question in the Ask SAI tab.
        </Typography>
      )}

      {traces.map(trace => {
        let question = ''
        try {
          const snap = JSON.parse(trace.schema_snapshot || '{}')
          question = snap.question || ''
        } catch { /* ignore */ }
        const isOpen = expanded === trace.id
        const color = '#7C3AED'

        return (
          <Paper
            key={trace.id}
            variant="outlined"
            sx={{ mb: 1, borderRadius: 2, overflow: 'hidden', borderColor: alpha(color, 0.18) }}
          >
            <Box
              sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
                '&:hover': { bgcolor: alpha(color, 0.03) } }}
              onClick={() => setExpanded(isOpen ? null : trace.id)}
            >
              <AutoAwesomeOutlined sx={{ fontSize: 15, color, flexShrink: 0 }} />
              <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }} noWrap>
                {question || '(question not recorded)'}
              </Typography>
              <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
                {trace.tokens_in != null && (
                  <Typography variant="caption" color="text.disabled">
                    {trace.tokens_in}↑ {trace.tokens_out}↓
                  </Typography>
                )}
                {trace.latency_ms != null && (
                  <Typography variant="caption" color="text.disabled">{trace.latency_ms}ms</Typography>
                )}
                <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
                  {new Date(trace.created_at).toLocaleString()}
                </Typography>
                <IconButton size="small" sx={{ p: 0 }}>
                  {isOpen ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
                </IconButton>
              </Stack>
            </Box>

            <Collapse in={isOpen}>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1.5 }}>
                {trace.response_text && (
                  <Box sx={{ mb: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">ANSWER PREVIEW</Typography>
                      <Tooltip title="Copy answer">
                        <IconButton size="small" sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(trace.response_text || '').catch(() => {}) }}>
                          <ContentCopyOutlined sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary', fontSize: '0.8rem', lineHeight: 1.6 }}>
                      {trace.response_text.slice(0, 600)}{trace.response_text.length > 600 ? '…' : ''}
                    </Typography>
                  </Box>
                )}
                {trace.prompt_text && (
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">PROMPT SENT</Typography>
                      <Tooltip title="Copy prompt">
                        <IconButton size="small" sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(trace.prompt_text || '').catch(() => {}) }}>
                          <ContentCopyOutlined sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    <Box component="pre" sx={{
                      mt: 0.5, p: 1, borderRadius: 1, fontSize: '0.675rem', lineHeight: 1.5,
                      bgcolor: alpha('#000', 0.04), overflow: 'auto', maxHeight: 180,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0,
                    }}>
                      {trace.prompt_text}
                    </Box>
                  </Box>
                )}
              </Box>
            </Collapse>
          </Paper>
        )
      })}
    </Box>
  )
}

// ── Tab 3: AI Debug ───────────────────────────────────────────────────────────

function AIDebugTab() {
  return (
    <Box>
      <AIDebugPanel module="knowledge" maxHeight={600} />
    </Box>
  )
}

// ── Tab 4: Open Questions ─────────────────────────────────────────────────────

function OpenQuestionsTab() {
  const queryClient         = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const user                = useAppStore(s => s.user)
  const canWrite            = user?.role !== 'viewer'

  const [statusFilter,       setStatusFilter]       = useState('open')
  const [quickId,            setQuickId]            = useState<number | null>(null)
  const [quickText,          setQuickText]          = useState('')
  const [answerQ,            setAnswerQ]            = useState<OpenQuestion | null>(null)
  const [answerPrefillContent, setAnswerPrefillContent] = useState<string | undefined>(undefined)
  const [dupId,              setDupId]              = useState<number | null>(null)

  const { data: questions = [], isFetching } = useQuery({
    queryKey: ['open-questions', statusFilter],
    queryFn:  () => knowledgeApi.listOpenQuestions(statusFilter),
  })

  const quickMutation = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) =>
      knowledgeApi.quickAnswerQuestion(id, text, user?.username),
    onSuccess: () => {
      enqueueSnackbar('Question answered.', { variant: 'success' })
      setQuickId(null)
      setQuickText('')
      queryClient.invalidateQueries({ queryKey: ['open-questions'] })
    },
    onError: () => enqueueSnackbar('Quick answer failed.', { variant: 'error' }),
  })

  const resolveMutation = useMutation({
    mutationFn: ({ id, data, skip }: { id: number; data: KnowledgeEntryCreate; skip: boolean }) =>
      knowledgeApi.resolveQuestion(id, data, user?.username),
    onSuccess: () => {
      enqueueSnackbar('Question resolved and KB entry created.', { variant: 'success' })
      setAnswerQ(null)
      setDupId(null)
      queryClient.invalidateQueries({ queryKey: ['open-questions'] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      if (typeof detail === 'object' && detail?.existing_id) {
        setDupId(detail.existing_id)
      } else {
        enqueueSnackbar(typeof detail === 'string' ? detail : 'Resolve failed.', { variant: 'error' })
      }
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: number) => knowledgeApi.dismissQuestion(id, user?.username),
    onSuccess: () => {
      enqueueSnackbar('Question dismissed.', { variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['open-questions'] })
    },
    onError: () => enqueueSnackbar('Dismiss failed.', { variant: 'error' }),
  })

  return (
    <Box>
      <ToggleButtonGroup
        value={statusFilter}
        exclusive
        onChange={(_, v) => { if (v) setStatusFilter(v) }}
        size="small"
        sx={{ mb: 2 }}
      >
        {['flagged', 'open', 'quick_answered', 'resolved', 'dismissed', 'all'].map(s => (
          <ToggleButton key={s} value={s} sx={{ textTransform: 'capitalize', px: 2,
            ...(s === 'flagged' && { color: 'error.main', '&.Mui-selected': { bgcolor: 'error.light' } }) }}>
            {s === 'quick_answered' ? 'Quick Answered' : s === 'flagged' ? '🚩 Flagged' : s}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isFetching && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Question</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Freq</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Tags</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Days Open</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {questions.map((q: OpenQuestion) => {
              const tags = parseTags(q.detected_tags)
              const systemTag = typeof q.detected_tags === 'string'
                ? (() => { try { return JSON.parse(q.detected_tags)?.system } catch { return null } })()
                : null
              return (
                <TableRow key={q.id}>
                  <TableCell sx={{ maxWidth: 340 }}>
                    <Tooltip title={q.question} placement="top-start">
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {q.question.slice(0, 80)}{q.question.length > 80 ? '…' : ''}
                      </Typography>
                    </Tooltip>
                    {q.feedback_type && (
                      <Chip
                        icon={<FlagOutlined style={{ fontSize: 11 }} />}
                        label={q.feedback_type.replace(/_/g, ' ')}
                        size="small"
                        sx={{ mt: 0.5, fontSize: '0.65rem', height: 18, bgcolor: 'error.light', color: 'error.dark', border: 'none' }}
                      />
                    )}
                    {q.resolution_text && (
                      <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.25 }}>
                        ✓ {q.resolution_text.slice(0, 80)}
                      </Typography>
                    )}
                    {q.ai_answer && q.status === 'flagged' && (
                      <Tooltip title={q.ai_answer} placement="bottom-start">
                        <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', maxWidth: 280, mt: 0.25 }}>
                          AI said: {q.ai_answer.slice(0, 60)}…
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge badgeContent={q.frequency > 1 ? q.frequency : null} color="primary">
                      <CheckCircleOutlined sx={{ fontSize: 18, opacity: 0.3 }} />
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {systemTag && <Chip label={systemTag} size="small" variant="outlined" sx={{ fontSize: 11 }} />}
                  </TableCell>
                  <TableCell>
                    {(q.status === 'open' || q.status === 'quick_answered') && q.days_open !== null ? (
                      <Chip
                        label={`${q.days_open}d`} size="small"
                        sx={{ bgcolor: daysOpenColor(q.days_open), color: '#fff', fontSize: 11 }}
                      />
                    ) : q.days_to_resolve !== null ? (
                      <Typography variant="caption" color="text.secondary">{q.days_to_resolve}d to resolve</Typography>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={q.status === 'quick_answered' ? 'Quick Answered' : q.status === 'flagged' ? '🚩 Flagged' : q.status}
                      size="small"
                      color={q.status === 'open' ? 'warning' : q.status === 'resolved' ? 'success' : q.status === 'flagged' ? 'error' : 'default'}
                      sx={q.status === 'quick_answered' ? { bgcolor: '#f59e0b', color: '#fff' } : undefined}
                    />
                  </TableCell>
                  <TableCell>
                    {canWrite && q.status === 'flagged' ? (
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Write a corrected answer and add it as a KB entry">
                          <Button
                            size="small" variant="contained" color="error"
                            startIcon={<FlagOutlined sx={{ fontSize: 14 }} />}
                            onClick={() => {
                              setAnswerQ(q)
                              setAnswerPrefillContent(q.ai_answer ?? '')
                              setDupId(null)
                            }}
                          >
                            Correct &amp; Add to KB
                          </Button>
                        </Tooltip>
                        <Tooltip title="Dismiss">
                          <IconButton
                            size="small" color="error"
                            onClick={() => {
                              if (window.confirm('Dismiss this flagged question?'))
                                dismissMutation.mutate(q.id)
                            }}
                          >
                            <DeleteOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ) : canWrite && (q.status === 'open' || q.status === 'quick_answered') ? (
                      <Stack direction="row" spacing={0.5}>
                        {q.status === 'open' && (
                          <Tooltip title="Quick Answer — partial, does not close the question">
                            <Button size="small" variant="outlined" onClick={() => { setQuickId(q.id); setQuickText('') }}>
                              Quick Answer
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip title="Full Answer (creates KB entry and closes question)">
                          <Button size="small" variant="outlined" color="primary" onClick={() => { setAnswerQ(q); setAnswerPrefillContent(undefined); setDupId(null) }}>
                            Full Answer
                          </Button>
                        </Tooltip>
                        <Tooltip title="Dismiss">
                          <IconButton
                            size="small" color="error"
                            onClick={() => {
                              if (window.confirm('Dismiss this question?'))
                                dismissMutation.mutate(q.id)
                            }}
                          >
                            <DeleteOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ) : !canWrite ? (
                      <Tooltip title="Requires developer role">
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      </Tooltip>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
            {questions.length === 0 && !isFetching && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No questions with status "{statusFilter}".
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Quick answer dialog */}
      <Dialog open={quickId !== null} onClose={() => setQuickId(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Quick Answer</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <TextField
            fullWidth multiline minRows={4}
            label="Answer"
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            helperText="Partial answer — sets status to 'Quick Answered'. Use Full Answer to create a KB entry and fully close this question."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setQuickId(null)} disabled={quickMutation.isPending}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!quickText.trim() || quickMutation.isPending}
            onClick={() => quickMutation.mutate({ id: quickId!, text: quickText })}
            startIcon={quickMutation.isPending ? <CircularProgress size={16} /> : undefined}
          >
            Save Answer
          </Button>
        </DialogActions>
      </Dialog>

      {/* Full answer / correct-flagged dialog */}
      <EntryFormDialog
        open={answerQ !== null}
        onClose={() => { setAnswerQ(null); setAnswerPrefillContent(undefined); setDupId(null) }}
        onSubmit={(data, skip) => resolveMutation.mutate({ id: answerQ!.id, data, skip })}
        loading={resolveMutation.isPending}
        dupId={dupId}
        prefillTitle={answerQ?.question.slice(0, 100)}
        prefillContent={answerPrefillContent}
      />
    </Box>
  )
}

// ── Tab 5: Operational Intelligence ──────────────────────────────────────────

function severityColor(s: string | null) {
  if (s === 'CRITICAL') return '#ef4444'
  if (s === 'HIGH')     return '#f97316'
  if (s === 'MEDIUM')   return '#f59e0b'
  if (s === 'LOW')      return '#10b981'
  return '#888'
}

function OperationalIntelligenceTab() {
  const { enqueueSnackbar } = useSnackbar()
  const [activeCategory, setActiveCategory] = useState<OpCategoryKey>('ReconRule')
  const [expandedId, setExpandedId]         = useState<number | null>(null)

  const { data: entries = [], isFetching } = useQuery({
    queryKey: ['op-knowledge', activeCategory],
    queryFn: () => operationalKnowledgeApi.listByCategory(activeCategory),
  })

  const catMeta = OP_CATEGORIES.find(c => c.key === activeCategory)!

  return (
    <Box sx={{ display: 'flex', height: '100%', gap: 2 }}>
      {/* Category sidebar */}
      <Box sx={{ width: 210, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ px: 1, mb: 1, display: 'block' }}>
          KNOWLEDGE CATEGORIES
        </Typography>
        <Stack spacing={0.5}>
          {OP_CATEGORIES.map(cat => (
            <Box
              key={cat.key}
              onClick={() => { setActiveCategory(cat.key); setExpandedId(null) }}
              sx={{
                px: 1.5, py: 1, borderRadius: 1, cursor: 'pointer',
                bgcolor: activeCategory === cat.key ? alpha(cat.color, 0.12) : 'transparent',
                border: activeCategory === cat.key ? `1px solid ${cat.color}40` : '1px solid transparent',
                '&:hover': { bgcolor: alpha(cat.color, 0.08) },
              }}
            >
              <Typography
                variant="body2"
                fontWeight={activeCategory === cat.key ? 700 : 400}
                sx={{ color: activeCategory === cat.key ? cat.color : 'text.primary' }}
              >
                {cat.label}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      {/* Entry list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ color: catMeta.color }}>
            {catMeta.label}
          </Typography>
          {isFetching && <CircularProgress size={16} />}
          <Typography variant="caption" color="text.secondary">
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </Typography>
        </Stack>

        {entries.length === 0 && !isFetching && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            No {catMeta.label} entries in the Knowledge Base yet.
            Create entries with <strong>op_category = {activeCategory}</strong> from the Knowledge Base tab.
          </Alert>
        )}

        <Stack spacing={1.5}>
          {entries.map(entry => {
            const isExpanded = expandedId === entry.id
            return (
              <Paper
                key={entry.id}
                variant="outlined"
                sx={{ borderRadius: 2, overflow: 'hidden', cursor: 'pointer' }}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                {/* Header row */}
                <Stack
                  direction="row" alignItems="center" spacing={1.5}
                  sx={{ px: 2, py: 1.5, bgcolor: alpha(catMeta.color, 0.04) }}
                >
                  {entry.severity && (
                    <Chip
                      label={entry.severity}
                      size="small"
                      sx={{ bgcolor: alpha(severityColor(entry.severity), 0.15), color: severityColor(entry.severity), fontWeight: 700, fontSize: 11 }}
                    />
                  )}
                  <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                    {entry.title}
                  </Typography>
                  {(entry.systems_involved || []).map(s => (
                    <Chip key={s} label={s} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                  ))}
                  {entry.owner_team && (
                    <Chip label={entry.owner_team} size="small" sx={{ bgcolor: '#1e293b', color: '#94a3b8', fontSize: 11 }} />
                  )}
                  {isExpanded ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />}
                </Stack>

                {/* Summary line */}
                {entry.summary && !isExpanded && (
                  <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 1.5, display: 'block' }}>
                    {entry.summary.slice(0, 180)}{entry.summary.length > 180 ? '…' : ''}
                  </Typography>
                )}

                {/* Expanded detail */}
                <Collapse in={isExpanded}>
                  <Box sx={{ px: 2, pb: 2, pt: 1 }}>
                    {entry.summary && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {entry.summary}
                      </Typography>
                    )}

                    {/* SQL Template (ReconRule) */}
                    {entry.sql_template && (
                      <Box sx={{ mb: 1.5 }}>
                        <Typography variant="caption" fontWeight={700} color="text.secondary">
                          SQL RULE TEMPLATE
                        </Typography>
                        <Box sx={{ bgcolor: '#0f172a', borderRadius: 1, p: 1.5, mt: 0.5, fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                          {entry.sql_template}
                        </Box>
                      </Box>
                    )}

                    {/* Validation Query */}
                    {entry.validation_query && (
                      <Box sx={{ mb: 1.5 }}>
                        <Typography variant="caption" fontWeight={700} color="text.secondary">
                          VALIDATION QUERY
                        </Typography>
                        <Box sx={{ bgcolor: '#0f172a', borderRadius: 1, p: 1.5, mt: 0.5, fontFamily: 'monospace', fontSize: 12, color: '#a3e635', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                          {entry.validation_query}
                        </Box>
                      </Box>
                    )}

                    {/* Remediation workflow (Remediation category) */}
                    {entry.remediation?.steps?.length > 0 && (
                      <Box sx={{ mb: 1.5 }}>
                        <Typography variant="caption" fontWeight={700} color="text.secondary">
                          REMEDIATION STEPS
                        </Typography>
                        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                          {entry.remediation.steps.map((step, i) => (
                            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                              <Chip label={i + 1} size="small" sx={{ fontSize: 10, minWidth: 22, height: 20, bgcolor: catMeta.color + '22', color: catMeta.color }} />
                              <Typography variant="body2">{step}</Typography>
                            </Stack>
                          ))}
                        </Stack>
                        {entry.remediation.ps_module && (
                          <Chip label={`PS Module: ${entry.remediation.ps_module}`} size="small" sx={{ mt: 1, bgcolor: '#10b98122', color: '#10b981' }} />
                        )}
                      </Box>
                    )}

                    {/* Key points */}
                    {entry.key_points?.length > 0 && (
                      <Box>
                        <Typography variant="caption" fontWeight={700} color="text.secondary">KEY POINTS</Typography>
                        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                          {entry.key_points.map((kp, i) => (
                            <Typography key={i} variant="body2" color="text.secondary">• {kp}</Typography>
                          ))}
                        </Stack>
                      </Box>
                    )}
                  </Box>
                </Collapse>
              </Paper>
            )
          })}
        </Stack>
      </Box>
    </Box>
  )
}

// ── Operational Rule categories ───────────────────────────────────────────────

const RULE_CATEGORIES = [
  { key: 'ValidationRule',     label: 'Validation Rule',     color: '#ef4444' },
  { key: 'ProcessingRule',     label: 'Processing Rule',     color: '#f59e0b' },
  { key: 'FailureRule',        label: 'Failure Rule',        color: '#dc2626' },
  { key: 'RecoveryRule',       label: 'Recovery Rule',       color: '#10b981' },
  { key: 'ReconciliationRule', label: 'Reconciliation Rule', color: '#3b82f6' },
  { key: 'OwnershipRule',      label: 'Ownership Rule',      color: '#8b5cf6' },
  { key: 'StopCondition',      label: 'Stop Condition',      color: '#f97316' },
  { key: 'ExceptionRule',      label: 'Exception Rule',      color: '#6366f1' },
] as const

type RuleCategoryKey = typeof RULE_CATEGORIES[number]['key']

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626', HIGH: '#f59e0b', MEDIUM: '#3b82f6', LOW: '#10b981',
}

function parseJsonArray(v: string | null): string[] {
  if (!v) return []
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
}

// ── Operational Rules Tab ─────────────────────────────────────────────────────

function OperationalRulesTab() {
  const queryClient         = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [catFilter, setCatFilter] = useState<RuleCategoryKey | ''>('')
  const [expanded,  setExpanded]  = useState<number | null>(null)
  const [addOpen,   setAddOpen]   = useState(false)
  const [decompOpen, setDecompOpen] = useState(false)

  // Rule form state
  const [rTitle,       setRTitle]       = useState('')
  const [rCat,         setRCat]         = useState<RuleCategoryKey>('ValidationRule')
  const [rTrigger,     setRTrigger]     = useState('')
  const [rActions,     setRActions]     = useState('')   // newline-separated
  const [rStop,        setRStop]        = useState('')
  const [rRecovery,    setRRecovery]    = useState('')   // newline-separated
  const [rSeverity,    setRSeverity]    = useState('HIGH')
  const [rOwner,       setROwner]       = useState('')
  const [rSystems,     setRSystems]     = useState('')
  const [rSql,         setRSql]         = useState('')
  // Phase 3 orchestration fields
  const [rDecision,    setRDecision]    = useState('')
  const [rScope,       setRScope]       = useState('')
  const [rDependsOn,   setRDependsOn]   = useState('')   // comma-separated rule titles
  const [saving,    setSaving]    = useState(false)

  // Decompose dialog state
  const [decompText,     setDecompText]     = useState('')
  const [decompLoading,  setDecompLoading]  = useState(false)
  const [decompEntries,  setDecompEntries]  = useState<any[]>([])
  const [decompSelected, setDecompSelected] = useState<Set<number>>(new Set())
  const [decompSaving,   setDecompSaving]   = useState(false)

  // Bulk reprocess state
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessResult, setReprocessResult] = useState<{ total: number; ok: number; low_quality: number; errors: number } | null>(null)

  // Quick-add (direct save, no LLM) state
  const [quickOpen,   setQuickOpen]   = useState(false)
  const [quickText,   setQuickText]   = useState('')
  const [quickSaving, setQuickSaving] = useState(false)

  const { data: entries = [], isFetching, refetch } = useQuery({
    queryKey: ['op-rules', catFilter],
    queryFn: () => knowledgeApi.listEntries({
      type: 'OperationalRule',
      ...(catFilter ? { op_category: catFilter } : {}),
      limit: 200,
    }),
  })

  const { data: unansweredOp = [] } = useQuery({
    queryKey: ['op-unanswered'],
    queryFn: () => knowledgeApi.listOperationalOpenQuestions(),
    refetchInterval: 60000,
  })

  async function handleQuickAdd() {
    if (!quickText.trim()) return
    setQuickSaving(true)
    try {
      // Parse blocks separated by "---"
      const blocks = quickText.split(/\n---+\n/).map(b => b.trim()).filter(Boolean)
      const rules: any[] = []
      for (const block of blocks) {
        const get = (key: string) => {
          const m = block.match(new RegExp(`^${key}:\\s*(.+)`, 'im'))
          return m ? m[1].trim() : ''
        }
        const getLines = (key: string) => {
          const m = block.match(new RegExp(`^${key}:\\s*(.+)`, 'im'))
          if (!m) return []
          return m[1].split(/[;|]/).map((s: string) => s.trim()).filter(Boolean)
        }
        const title = get('title')
        const trigger = get('trigger_condition') || get('trigger')
        if (!title || !trigger) continue
        rules.push({
          title,
          op_category:       get('op_category') || get('category') || 'ValidationRule',
          trigger_condition: trigger,
          action_steps:      getLines('action_steps') || getLines('action'),
          stop_condition:    get('stop_condition') || get('stop') || null,
          recovery_steps:    getLines('recovery_steps') || getLines('recovery'),
          severity:          get('severity') || 'HIGH',
          owner_team:        get('owner_team') || get('owner') || null,
          systems_involved:  (get('systems_involved') || get('system') || '').split(',').map((s:string)=>s.trim()).filter(Boolean),
          summary:           get('summary') || '',
          tags:              (get('tags') || '').split(',').map((s:string)=>s.trim()).filter(Boolean),
          system:            get('system_context') || 'General',
        })
      }
      if (!rules.length) {
        enqueueSnackbar('No valid rules found — check format', { variant: 'warning' })
        return
      }
      const r = await knowledgeApi.directSaveRules(rules)
      enqueueSnackbar(`Saved ${r.saved} rule${r.saved !== 1 ? 's' : ''}${r.failed ? ` (${r.failed} failed)` : ''}`, {
        variant: r.failed > 0 ? 'warning' : 'success',
      })
      setQuickOpen(false)
      setQuickText('')
      queryClient.invalidateQueries({ queryKey: ['op-rules'] })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Save failed', { variant: 'error' })
    } finally { setQuickSaving(false) }
  }

  async function handleReprocessAll() {
    setReprocessing(true)
    setReprocessResult(null)
    try {
      const r = await knowledgeApi.reprocessRules()
      setReprocessResult(r)
      queryClient.invalidateQueries({ queryKey: ['op-rules'] })
      const msg = `Reprocessed ${r.total} rule${r.total !== 1 ? 's' : ''}: ${r.ok} ok, ${r.low_quality} low-quality, ${r.errors} errors`
      enqueueSnackbar(msg, { variant: r.errors > 0 ? 'warning' : 'success' })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Bulk reprocess failed', { variant: 'error' })
    } finally { setReprocessing(false) }
  }

  async function handleSaveRule() {
    if (!rTitle.trim() || !rTrigger.trim()) return
    setSaving(true)
    const actionArr  = rActions.split('\n').map(s => s.trim()).filter(Boolean)
    const recovArr   = rRecovery.split('\n').map(s => s.trim()).filter(Boolean)
    const sysArr     = rSystems.split(',').map(s => s.trim()).filter(Boolean)
    const depsArr    = rDependsOn.split(',').map(s => s.trim()).filter(Boolean)
    try {
      await knowledgeApi.processEntry({
        title: rTitle.trim(),
        type: 'OperationalRule' as any,
        system: 'General',
        tags: [],
        source_type: 'Text',
        raw_content: `RULE: ${rTitle}\nTRIGGER: ${rTrigger}\nACTION: ${actionArr.join('; ')}\nSTOP: ${rStop}\nRECOVERY: ${recovArr.join('; ')}`,
        op_category: rCat as any,
        severity: rSeverity as any,
        owner_team: rOwner || undefined,
        systems_involved: sysArr.length ? sysArr : undefined,
        sql_template: rSql || undefined,
        trigger_condition: rTrigger || undefined,
        action_steps: actionArr.length ? actionArr : undefined,
        stop_condition: rStop || undefined,
        recovery_steps: recovArr.length ? recovArr : undefined,
        decision_type: rDecision || undefined,
        execution_scope: rScope || undefined,
        depends_on: depsArr.length ? depsArr : undefined,
      } as any, false)
      enqueueSnackbar('Rule saved successfully', { variant: 'success' })
      setAddOpen(false)
      setRTitle(''); setRTrigger(''); setRActions(''); setRStop(''); setRRecovery('')
      setROwner(''); setRSystems(''); setRSql('')
      setRDecision(''); setRScope(''); setRDependsOn('')
      queryClient.invalidateQueries({ queryKey: ['op-rules'] })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Save failed', { variant: 'error' })
    } finally { setSaving(false) }
  }

  async function handleDecompose() {
    if (!decompText.trim()) return
    setDecompLoading(true)
    setDecompEntries([])
    setDecompSelected(new Set())
    try {
      const r = await knowledgeApi.decomposeDocument(decompText)
      setDecompEntries(r.entries)
      if (r.entries.length === 0) enqueueSnackbar('No operational rules found in document', { variant: 'warning' })
    } catch (err: any) {
      enqueueSnackbar(err?.response?.data?.detail || 'Decompose failed', { variant: 'error' })
    } finally { setDecompLoading(false) }
  }

  async function handleSaveSelected() {
    const toSave = decompEntries.filter((_, i) => decompSelected.has(i))
    if (!toSave.length) return
    setDecompSaving(true)
    let saved = 0, failed = 0
    for (const entry of toSave) {
      try {
        const actionArr = Array.isArray(entry.action_steps) ? entry.action_steps : []
        const recovArr  = Array.isArray(entry.recovery_steps) ? entry.recovery_steps : []
        const sysArr    = Array.isArray(entry.systems_involved_json) ? entry.systems_involved_json : []
        await knowledgeApi.processEntry({
          title: entry.title || 'Untitled Rule',
          type: 'OperationalRule' as any,
          system: 'General',
          tags: [],
          source_type: 'Text',
          raw_content: `RULE: ${entry.title}\nTRIGGER: ${entry.trigger_condition || ''}\nACTION: ${actionArr.join('; ')}\nSTOP: ${entry.stop_condition || ''}\nRECOVERY: ${recovArr.join('; ')}`,
          op_category: (entry.op_category || 'ValidationRule') as any,
          severity: (entry.severity || 'MEDIUM') as any,
          owner_team: entry.owner_team || undefined,
          systems_involved: sysArr.length ? sysArr : undefined,
          sql_template: entry.sql_template || undefined,
          trigger_condition: entry.trigger_condition || undefined,
          action_steps: actionArr.length ? actionArr : undefined,
          stop_condition: entry.stop_condition || undefined,
          recovery_steps: recovArr.length ? recovArr : undefined,
        } as any, false)
        saved++
      } catch { failed++ }
    }
    setDecompSaving(false)
    enqueueSnackbar(`Saved ${saved} rule(s)${failed ? `, ${failed} failed` : ''}`, { variant: saved > 0 ? 'success' : 'error' })
    if (saved > 0) {
      queryClient.invalidateQueries({ queryKey: ['op-rules'] })
      setDecompOpen(false)
      setDecompText(''); setDecompEntries([]); setDecompSelected(new Set())
    }
  }

  const catMeta = RULE_CATEGORIES.find(c => c.key === catFilter) || null

  return (
    <Box>
      {/* Header toolbar */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <RuleOutlined sx={{ color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>Operational Rules</Typography>
        {(isFetching || reprocessing) && <CircularProgress size={16} />}
        <Typography variant="caption" color="text.secondary">{entries.length} rule{entries.length !== 1 ? 's' : ''}</Typography>
        {reprocessResult && (
          <Chip
            size="small"
            label={`Reprocessed: ${reprocessResult.ok} ok · ${reprocessResult.low_quality} low-quality · ${reprocessResult.errors} errors`}
            color={reprocessResult.errors > 0 ? 'warning' : 'success'}
            onDelete={() => setReprocessResult(null)}
          />
        )}
        <Tooltip title="Re-run LLM extraction on all existing rule entries to populate trigger, action, stop, and recovery fields">
          <span>
            <Button size="small" variant="outlined" color="warning"
              startIcon={reprocessing ? <CircularProgress size={14} /> : <RefreshOutlined />}
              disabled={reprocessing}
              onClick={handleReprocessAll}>
              Reprocess All Rules
            </Button>
          </span>
        </Tooltip>
        <Button size="small" variant="outlined" startIcon={<AutoFixHighOutlined />} onClick={() => setDecompOpen(true)}>
          Decompose Document
        </Button>
        <Button size="small" variant="outlined" color="success" startIcon={<AddOutlined />} onClick={() => setQuickOpen(true)}>
          Quick Add Rules
        </Button>
        <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={() => setAddOpen(true)}>
          Add Rule
        </Button>
      </Stack>

      {/* Category filter chips */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 0.75 }}>
        <Chip
          label="All"
          size="small"
          variant={catFilter === '' ? 'filled' : 'outlined'}
          onClick={() => setCatFilter('')}
          sx={{ fontWeight: catFilter === '' ? 700 : 400 }}
        />
        {RULE_CATEGORIES.map(c => (
          <Chip
            key={c.key}
            label={c.label}
            size="small"
            variant={catFilter === c.key ? 'filled' : 'outlined'}
            onClick={() => setCatFilter(c.key)}
            sx={{
              fontWeight: catFilter === c.key ? 700 : 400,
              ...(catFilter === c.key ? { bgcolor: c.color + '22', color: c.color, borderColor: c.color } : {}),
            }}
          />
        ))}
      </Stack>

      {/* Rule list */}
      {entries.length === 0 && !isFetching && (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          No operational rules yet. Use <strong>Add Rule</strong> to create one-at-a-time, or
          <strong> Decompose Document</strong> to extract many rules from existing documentation.
        </Alert>
      )}

      <Stack spacing={1.5}>
        {entries.map(entry => {
          const isExp  = expanded === entry.id
          const rMeta  = RULE_CATEGORIES.find(c => c.key === (entry as any).op_category) || null
          const sevClr = SEVERITY_COLORS[(entry as any).severity || ''] || '#888'
          const actions = parseJsonArray((entry as any).action_steps)
          const recovery = parseJsonArray((entry as any).recovery_steps)
          return (
            <Paper key={entry.id} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', cursor: 'pointer', borderLeft: `3px solid ${sevClr}` }}
              onClick={() => setExpanded(isExp ? null : entry.id)}
            >
              {/* Header row */}
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.5, bgcolor: alpha(sevClr, 0.04) }}>
                {(entry as any).severity && (
                  <Chip label={(entry as any).severity} size="small"
                    sx={{ bgcolor: alpha(sevClr, 0.15), color: sevClr, fontWeight: 700, fontSize: 11, minWidth: 70 }} />
                )}
                {rMeta && (
                  <Chip label={rMeta.label} size="small" variant="outlined"
                    sx={{ color: rMeta.color, borderColor: rMeta.color + '60', fontSize: 11 }} />
                )}
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{entry.title}</Typography>
                {(entry as any).owner_team && (
                  <Chip label={(entry as any).owner_team} size="small"
                    sx={{ bgcolor: '#1e293b', color: '#94a3b8', fontSize: 11 }} />
                )}
                {isExp ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />}
              </Stack>

              {/* Collapsed summary */}
              {!isExp && (entry as any).trigger_condition && (
                <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 1.5, display: 'block' }}>
                  TRIGGER: {((entry as any).trigger_condition as string).slice(0, 160)}
                </Typography>
              )}

              {/* Expanded detail */}
              <Collapse in={isExp}>
                <Box sx={{ px: 2, pb: 2, pt: 1 }}>
                  {(entry as any).trigger_condition && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">TRIGGER CONDITION</Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>{(entry as any).trigger_condition}</Typography>
                    </Box>
                  )}
                  {actions.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">ACTION STEPS</Typography>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {actions.map((a, i) => (
                          <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                            <Chip label={i + 1} size="small" sx={{ fontSize: 10, minWidth: 22, height: 20, bgcolor: sevClr + '22', color: sevClr }} />
                            <Typography variant="body2">{a}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {(entry as any).stop_condition && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">STOP CONDITION</Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>{(entry as any).stop_condition}</Typography>
                    </Box>
                  )}
                  {recovery.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">RECOVERY STEPS</Typography>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {recovery.map((r, i) => (
                          <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                            <Chip label={i + 1} size="small" sx={{ fontSize: 10, minWidth: 22, height: 20, bgcolor: '#10b98122', color: '#10b981' }} />
                            <Typography variant="body2">{r}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {(entry as any).sql_template && (
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary">SQL TEMPLATE</Typography>
                      <Box sx={{ bgcolor: '#0f172a', borderRadius: 1, p: 1.5, mt: 0.5, fontFamily: 'monospace', fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                        {(entry as any).sql_template}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Collapse>
            </Paper>
          )
        })}
      </Stack>

      {/* ── Unanswered Operational Questions ── */}
      {unansweredOp.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <WarningAmberOutlined sx={{ color: 'warning.main', fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={700} color="warning.main">
              Unanswered / Flagged Operational Questions
            </Typography>
            <Badge badgeContent={unansweredOp.length} color="warning" sx={{ ml: 1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              — questions SAI couldn't answer or users flagged as wrong. Add rules to close these gaps.
            </Typography>
          </Stack>
          <Stack spacing={0.75}>
            {unansweredOp.map((q: any) => (
              <Paper
                key={q.id}
                variant="outlined"
                sx={{
                  px: 2, py: 1.25, borderRadius: 1.5,
                  borderColor: q.feedback_type ? 'warning.main' : 'divider',
                  bgcolor: q.feedback_type ? 'warning.50' : 'background.paper',
                  display: 'flex', alignItems: 'center', gap: 1.5,
                }}
              >
                {q.feedback_type && (
                  <Chip
                    label="Flagged"
                    size="small"
                    color="warning"
                    sx={{ fontSize: '0.68rem', height: 20, fontWeight: 700 }}
                  />
                )}
                <Typography variant="body2" sx={{ flex: 1, fontSize: '0.82rem' }}>
                  {q.question}
                </Typography>
                {q.frequency > 1 && (
                  <Chip
                    label={`×${q.frequency}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.68rem', height: 20 }}
                  />
                )}
                {q.days_open !== null && (
                  <Typography variant="caption" color="text.secondary">
                    {q.days_open}d open
                  </Typography>
                )}
                <Tooltip title="Add a rule to answer this question">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddOutlined />}
                    onClick={() => {
                      setRTrigger(q.question)
                      setAddOpen(true)
                    }}
                    sx={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                  >
                    Add Rule
                  </Button>
                </Tooltip>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      {/* ── Add Rule Dialog ── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add Operational Rule</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <Alert severity="info" sx={{ fontSize: '0.78rem' }}>
            One rule = one action. Keep title as an imperative statement (e.g. "Stop batch when reconciliation fails").
          </Alert>
          <TextField label="Rule Title" required fullWidth value={rTitle} onChange={e => setRTitle(e.target.value)}
            placeholder="Stop batch when reconciliation fails" />
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Category</InputLabel>
              <Select value={rCat} label="Category" onChange={e => setRCat(e.target.value as RuleCategoryKey)}>
                {RULE_CATEGORIES.map(c => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Severity</InputLabel>
              <Select value={rSeverity} label="Severity" onChange={e => setRSeverity(e.target.value)}>
                {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <TextField label="Trigger Condition" required fullWidth multiline minRows={2} value={rTrigger}
            onChange={e => setRTrigger(e.target.value)}
            placeholder="When reconciliation result = FAIL and error_count > 0" />
          <TextField label="Action Steps (one per line)" fullWidth multiline minRows={3} value={rActions}
            onChange={e => setRActions(e.target.value)}
            placeholder={"Halt the batch run\nAlert GL Operations team\nLog to conversion_error_log"} />
          <Stack direction="row" spacing={2}>
            <TextField label="Stop Condition" fullWidth value={rStop} onChange={e => setRStop(e.target.value)}
              placeholder="Stop when error threshold > 5% of records" size="small" />
            <TextField label="Owner Team" fullWidth value={rOwner} onChange={e => setROwner(e.target.value)}
              placeholder="GL Operations" size="small" />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Systems Involved (comma-sep)" fullWidth value={rSystems} onChange={e => setRSystems(e.target.value)}
              placeholder="Billing, GL, Policy" size="small" />
          </Stack>
          <TextField label="Recovery Steps (one per line)" fullWidth multiline minRows={2} value={rRecovery}
            onChange={e => setRRecovery(e.target.value)}
            placeholder={"Rollback the transaction\nRe-queue the batch with corrected data"} />
          <TextField label="SQL Template (optional)" fullWidth multiline minRows={3} value={rSql}
            onChange={e => setRSql(e.target.value)}
            placeholder="SELECT COUNT(*) FROM conversion_recon_results WHERE status = 'FAIL'"
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }} />
          {/* Phase 3 orchestration fields */}
          <Stack direction="row" spacing={2}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Decision Type</InputLabel>
              <Select value={rDecision} label="Decision Type" onChange={e => setRDecision(e.target.value)}>
                <MenuItem value="">— none —</MenuItem>
                {['CONTINUE','PARTIAL_CONTINUE','STOP','ESCALATE','RETRY','WAIT'].map(d => (
                  <MenuItem key={d} value={d}>{d}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Execution Scope</InputLabel>
              <Select value={rScope} label="Execution Scope" onChange={e => setRScope(e.target.value)}>
                <MenuItem value="">— none —</MenuItem>
                {['system','batch','monthly_cycle','policy'].map(s => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <TextField label="Depends On (comma-sep rule titles)" fullWidth value={rDependsOn}
            onChange={e => setRDependsOn(e.target.value)} size="small"
            placeholder="Stop Batch When GL Recon Fails, Validate TRF Before Posting" />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveRule} disabled={saving || !rTitle.trim() || !rTrigger.trim()}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}>
            {saving ? 'Processing…' : 'Save Rule'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Quick Add Rules Dialog ── */}
      <Dialog open={quickOpen} onClose={() => { if (!quickSaving) setQuickOpen(false) }} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Quick Add Rules — Direct Save (No LLM)</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <Alert severity="info" sx={{ fontSize: '0.78rem' }}>
            Paste one or more rules separated by <strong>---</strong>. Each block needs at minimum <strong>title</strong> and <strong>trigger_condition</strong>.
            Rules are saved directly — no LLM processing.
          </Alert>
          <Box sx={{ bgcolor: 'grey.50', p: 1.5, borderRadius: 1, fontFamily: 'monospace', fontSize: '0.72rem', color: 'text.secondary', border: '1px solid', borderColor: 'divider' }}>
            {`title: ADF Validation Rule\nop_category: ValidationRule\ntrigger_condition: When ADF pipelines are not triggered successfully\naction_steps: Stop GL processing | Do not generate Full TRF files\nseverity: CRITICAL\nowner_team: Data Engineering\nsystem_context: Snowflake\ntags: ADF,validation,TRF\n---\ntitle: Full TRF Hold Rule\nop_category: StopCondition\ntrigger_condition: When reconciliation fails or GL totals mismatch\nstop_condition: Complete TRF generation must stop\nrecovery_steps: Reconcile GL totals | Rerun GL processing | Regenerate TRF\nseverity: CRITICAL\nowner_team: GL/Data Team`}
          </Box>
          <TextField
            label="Rules (--- separated blocks)"
            multiline minRows={12} maxRows={28}
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            placeholder={'title: ...\nop_category: StopCondition\ntrigger_condition: When X happens\naction_steps: Do A | Do B\nstop_condition: Stop when Y\nrecovery_steps: Rollback A | Alert B\nseverity: CRITICAL\nowner_team: GL Team\ntags: gl,stop\n---\ntitle: Next rule...'}
            sx={{ fontFamily: 'monospace', '& textarea': { fontFamily: 'monospace', fontSize: '0.82rem' } }}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setQuickOpen(false); setQuickText('') }} disabled={quickSaving}>Cancel</Button>
          <Button variant="contained" color="success" disabled={!quickText.trim() || quickSaving}
            startIcon={quickSaving ? <CircularProgress size={14} /> : <AddOutlined />}
            onClick={handleQuickAdd}>
            {quickSaving ? 'Saving…' : 'Save Rules'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Decompose Document Dialog ── */}
      <Dialog open={decompOpen} onClose={() => { if (!decompLoading && !decompSaving) setDecompOpen(false) }} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Decompose Document into Operational Rules</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <Alert severity="info" sx={{ fontSize: '0.78rem' }}>
            Paste a document, runbook, or process description. AI will extract every distinct rule, validation,
            failure condition, recovery step, and ownership mapping as separate atomic entries.
          </Alert>
          {decompEntries.length === 0 ? (
            <TextField label="Document Text" multiline minRows={12} fullWidth value={decompText}
              onChange={e => setDecompText(e.target.value)}
              placeholder="Paste your GL Operating Model, runbook, or process document here…"
              disabled={decompLoading} />
          ) : (
            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {decompEntries.length} rules extracted — select which to save
                </Typography>
                <Button size="small" variant="text" onClick={() => setDecompSelected(new Set(decompEntries.map((_, i) => i)))}>
                  Select All
                </Button>
                <Button size="small" variant="text" onClick={() => setDecompSelected(new Set())}>
                  Clear
                </Button>
                <Button size="small" variant="text" color="secondary" onClick={() => { setDecompEntries([]); setDecompSelected(new Set()) }}>
                  ← Back
                </Button>
              </Stack>
              <Box sx={{ maxHeight: 480, overflowY: 'auto' }}>
                <Stack spacing={1}>
                  {decompEntries.map((entry, i) => {
                    const rMeta = RULE_CATEGORIES.find(c => c.key === entry.op_category) || null
                    const sevClr = SEVERITY_COLORS[entry.severity || ''] || '#888'
                    const isSelected = decompSelected.has(i)
                    return (
                      <Paper key={i} variant="outlined" onClick={() => {
                        setDecompSelected(prev => {
                          const next = new Set(prev)
                          if (next.has(i)) next.delete(i); else next.add(i)
                          return next
                        })
                      }}
                        sx={{ px: 2, py: 1.5, cursor: 'pointer', borderRadius: 1.5,
                          bgcolor: isSelected ? alpha(sevClr, 0.08) : 'transparent',
                          borderColor: isSelected ? sevClr : 'divider',
                          borderWidth: isSelected ? 2 : 1,
                        }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Box sx={{ width: 18, height: 18, border: `2px solid ${isSelected ? sevClr : '#666'}`,
                            borderRadius: 0.5, bgcolor: isSelected ? sevClr : 'transparent',
                            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <Box sx={{ width: 10, height: 10, bgcolor: 'white', borderRadius: 0.25 }} />}
                          </Box>
                          {entry.severity && (
                            <Chip label={entry.severity} size="small"
                              sx={{ bgcolor: alpha(sevClr, 0.15), color: sevClr, fontWeight: 700, fontSize: 11 }} />
                          )}
                          {rMeta && (
                            <Chip label={rMeta.label} size="small" variant="outlined"
                              sx={{ color: rMeta.color, borderColor: rMeta.color + '60', fontSize: 11 }} />
                          )}
                          <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{entry.title}</Typography>
                        </Stack>
                        {entry.trigger_condition && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', pl: 3.5 }}>
                            TRIGGER: {entry.trigger_condition}
                          </Typography>
                        )}
                      </Paper>
                    )
                  })}
                </Stack>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { if (!decompLoading && !decompSaving) { setDecompOpen(false); setDecompEntries([]); setDecompText('') } }}>
            Cancel
          </Button>
          {decompEntries.length === 0 ? (
            <Button variant="contained" onClick={handleDecompose}
              disabled={decompLoading || !decompText.trim()}
              startIcon={decompLoading ? <CircularProgress size={16} /> : <AutoFixHighOutlined />}>
              {decompLoading ? 'Extracting Rules…' : 'Extract Rules'}
            </Button>
          ) : (
            <Button variant="contained" onClick={handleSaveSelected}
              disabled={decompSaving || decompSelected.size === 0}
              startIcon={decompSaving ? <CircularProgress size={16} /> : undefined}>
              {decompSaving ? 'Saving…' : `Save ${decompSelected.size} Rule${decompSelected.size !== 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ── Tab: Schema Management ────────────────────────────────────────────────────

const SESSION_TYPES: SessionType[] = [
  'MeetingNotes', 'RequirementGathering', 'BusinessDiscussion',
  'ArchitectureReview', 'MappingWorkshop', 'DefectReview',
  'ProductionIssue', 'ClientFeedback',
  'Document', 'QueryLibrary', 'KnowledgeUpload', 'WorkingSession',
]

const SESSION_TYPE_ICONS: Record<string, React.ReactNode> = {
  RequirementGathering: <AssignmentOutlined fontSize="small" />,
  ArchitectureReview:   <MemoryOutlined fontSize="small" />,
  MappingWorkshop:      <LinkOutlined fontSize="small" />,
  DefectReview:         <BugReportOutlined fontSize="small" />,
  BusinessDiscussion:   <PeopleOutlined fontSize="small" />,
  ProductionIssue:      <ReportProblemOutlined fontSize="small" />,
  ClientFeedback:       <FlagOutlined fontSize="small" />,
  MeetingNotes:         <EventNoteOutlined fontSize="small" />,
  Document:             <AttachFileOutlined fontSize="small" />,
  QueryLibrary:         <InfoOutlined fontSize="small" />,
  KnowledgeUpload:      <CloudDownloadOutlined fontSize="small" />,
  WorkingSession:       <EditOutlined fontSize="small" />,
}

const SESSION_TYPE_GROUPS: { label: string; types: SessionType[] }[] = [
  { label: '📅 Meetings', types: ['MeetingNotes', 'RequirementGathering', 'BusinessDiscussion', 'ArchitectureReview', 'MappingWorkshop', 'DefectReview', 'ProductionIssue', 'ClientFeedback'] },
  { label: '📄 Documents & Queries', types: ['Document', 'QueryLibrary', 'KnowledgeUpload', 'WorkingSession'] },
]

const ARTIFACT_TYPES: ArtifactType[] = [
  'Requirement', 'Decision', 'ActionItem', 'Risk', 'TechnicalMetadata', 'OpenQuestion',
]

const ARTIFACT_ICON: Record<ArtifactType, React.ReactNode> = {
  Requirement:      <AssignmentOutlined fontSize="small" />,
  Decision:         <GavelOutlined fontSize="small" />,
  ActionItem:       <TaskAltOutlined fontSize="small" />,
  Risk:             <ReportProblemOutlined fontSize="small" />,
  TechnicalMetadata:<MemoryOutlined fontSize="small" />,
  OpenQuestion:     <QuestionMarkOutlined fontSize="small" />,
}

const SESSION_STATUS_COLOR: Record<string, string> = {
  DRAFT:       '#888',
  UPLOADED:    '#64b5f6',
  TRANSCRIBING:'#ffb74d',
  TRANSCRIBED: '#ffd54f',
  EXTRACTING:  '#ff8a65',
  EMBEDDING:   '#ba68c8',
  READY:       '#66bb6a',
  FAILED:      '#ef5350',
  PARTIAL:     '#ffb74d',
  ARCHIVED:    '#90a4ae',
}

const ARTIFACT_STATUS_COLOR: Record<string, string> = {
  PENDING_REVIEW: '#ffb74d',
  APPROVED:       '#66bb6a',
  REJECTED:       '#ef5350',
  IN_PROGRESS:    '#64b5f6',
  DONE:           '#90a4ae',
}

function SchemaManagementTab() {
  const queryClient         = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const user                = useAppStore(s => s.user)
  const activeProject       = useAppStore(s => s.activeProject)
  const canWrite            = user?.role !== 'viewer'
  const canDelete           = user?.role === 'admin'

  const [creating, setCreating]   = useState(false)
  const [newName,  setNewName]    = useState('')
  const [newDesc,  setNewDesc]    = useState('')
  const [newColor, setNewColor]   = useState('#6366f1')

  // ── Manual DB Schema Import ────────────────────────────────────────────────
  const [importOpen,    setImportOpen]    = useState(false)
  const [importName,    setImportName]    = useState('')
  const [importContent, setImportContent] = useState('')
  const [importFile,    setImportFile]    = useState<File | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult,  setImportResult]  = useState<{ tables: number; columns: number; embeddings: number; conn_name: string } | null>(null)
  const [importProgress, setImportProgress] = useState<Array<{ msg: string; current?: number; total?: number; table?: string; cols?: number }>>([])
  const importFileRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    if (!importName.trim() && !importFile) { enqueueSnackbar('Enter a schema name', { variant: 'warning' }); return }
    if (!importContent.trim() && !importFile) { enqueueSnackbar('Paste DDL or upload a file', { variant: 'warning' }); return }
    setImportLoading(true)
    setImportProgress([])
    setImportResult(null)
    try {
      await knowledgeApi.importSchemaStream(
        importName.trim() || importFile?.name || 'Manual Schema',
        importContent,
        activeProject?.id,
        importFile ?? undefined,
        (event) => {
          if (event.type === 'error') {
            enqueueSnackbar(event.message, { variant: 'error' })
          } else if (event.done) {
            setImportResult({ tables: event.tables ?? 0, columns: event.column_count ?? 0, embeddings: event.embeddings ?? 0, conn_name: event.conn_id ? String(event.conn_id) : 'imported' })
            queryClient.invalidateQueries({ queryKey: ['connections-for-asksai'] })
          } else {
            setImportProgress(prev => [...prev, {
              msg: event.message,
              current: event.current,
              total: event.total,
              table: event.table,
              cols: event.columns,
            }])
          }
        }
      )
    } catch (e: any) {
      enqueueSnackbar(e?.message || 'Import failed', { variant: 'error' })
    } finally {
      setImportLoading(false)
    }
  }

  const { data: schemas = [], isLoading } = useQuery({
    queryKey: ['knowledge-schemas'],
    queryFn:  () => knowledgeApi.listSchemas(),
  })

  const createMut = useMutation({
    mutationFn: (d: KnowledgeSchemaCreate) => knowledgeApi.createSchema(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-schemas'] })
      enqueueSnackbar('Schema created', { variant: 'success' })
      setCreating(false); setNewName(''); setNewDesc(''); setNewColor('#6366f1')
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Create failed', { variant: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.deleteSchema(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-schemas'] })
      enqueueSnackbar('Schema deleted', { variant: 'success' })
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.detail || 'Delete failed'
      enqueueSnackbar(msg, { variant: 'error' })
    },
  })

  const clearEntriesMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.clearSchemaEntries(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-schemas'] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
      enqueueSnackbar(`Cleared ${res.deleted_entries} entries from schema`, { variant: 'success' })
    },
    onError: (e: any) => {
      enqueueSnackbar(e?.response?.data?.detail || 'Clear failed', { variant: 'error' })
    },
  })

  const clearAndDeleteMut = useMutation({
    mutationFn: async (s: KnowledgeSchema) => {
      await knowledgeApi.clearSchemaEntries(s.id)
      await knowledgeApi.deleteSchema(s.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-schemas'] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
      enqueueSnackbar('Schema and all entries deleted', { variant: 'success' })
    },
    onError: (e: any) => {
      enqueueSnackbar(e?.response?.data?.detail || 'Delete failed', { variant: 'error' })
    },
  })

  return (
    <Box sx={{ p: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
        <CategoryOutlined sx={{ color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={600}>Knowledge Schemas</Typography>
        <Box sx={{ flex: 1 }} />
        {canWrite && (
          <>
            <Button variant="outlined" startIcon={<CloudDownloadOutlined />}
              onClick={() => { setImportOpen(true); setImportResult(null); setImportProgress([]) }}
              sx={{ textTransform: 'none' }}>
              Import DB Schema
            </Button>
            <Button variant="contained" startIcon={<AddOutlined />}
              onClick={() => setCreating(true)}>
              New KB Schema
            </Button>
          </>
        )}
      </Stack>

      {/* Create form */}
      {creating && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>New Schema</Typography>
          <Stack direction="row" spacing={2} alignItems="flex-end" flexWrap="wrap" useFlexGap>
            <TextField
              label="Name *" size="small" value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. GL, AR, AP, Claims"
              sx={{ width: 180 }}
            />
            <TextField
              label="Description" size="small" value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              sx={{ width: 320 }}
            />
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">Color</Typography>
              <input type="color" value={newColor}
                onChange={e => setNewColor(e.target.value)}
                style={{ width: 44, height: 36, padding: 2, border: '1px solid #ccc',
                  borderRadius: 6, cursor: 'pointer', background: 'none' }} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" size="small"
                disabled={!newName.trim() || createMut.isPending}
                startIcon={createMut.isPending ? <CircularProgress size={14} /> : <CheckOutlined />}
                onClick={() => createMut.mutate({ name: newName.trim(), description: newDesc.trim() || undefined, color_hex: newColor })}>
                Create
              </Button>
              <Button size="small" onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); setNewColor('#6366f1') }}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : schemas.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
          <CategoryOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No schemas yet. Create one to scope your knowledge entries.</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
          {schemas.map((s: KnowledgeSchema) => (
            <Paper key={s.id} variant="outlined" sx={{ p: 2.5, borderRadius: 2,
              borderLeft: `4px solid ${s.color_hex}`, position: 'relative',
              '&:hover': { boxShadow: 2 }, transition: 'box-shadow 0.15s' }}>
              <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: s.color_hex,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Typography variant="caption" fontWeight={800} color="white" fontSize={11}>
                    {s.name.substring(0, 2).toUpperCase()}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" fontWeight={700}>{s.name}</Typography>
                  {s.description && (
                    <Typography variant="body2" color="text.secondary" sx={{
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.description}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.disabled">
                    Created {new Date(s.created_at).toLocaleDateString()}
                  </Typography>
                </Box>
                {canDelete && (
                  <Stack direction="column" spacing={0.5}>
                    <Tooltip title="Clear all entries in this schema (keeps schema)">
                      <IconButton size="small" color="warning"
                        disabled={clearEntriesMut.isPending || clearAndDeleteMut.isPending}
                        onClick={() => {
                          if (confirm(`Delete all KB entries in "${s.name}"? The schema itself will be kept.`))
                            clearEntriesMut.mutate(s.id)
                        }}>
                        <LayersClearOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete schema + all entries">
                      <IconButton size="small" color="error"
                        disabled={clearEntriesMut.isPending || clearAndDeleteMut.isPending}
                        onClick={() => {
                          if (confirm(`Delete schema "${s.name}" AND all its entries? This cannot be undone.`))
                            clearAndDeleteMut.mutate(s)
                        }}>
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </Stack>
            </Paper>
          ))}
        </Box>
      )}

      {/* ── Import DB Schema dialog ── */}
      <Dialog open={importOpen} onClose={() => !importLoading && setImportOpen(false)} maxWidth="md" fullWidth
        PaperProps={{ sx: { minHeight: importLoading || importProgress.length > 0 ? 560 : 'auto' } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          Import DB Schema
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400, mt: 0.25 }}>
            Provide schema without live DB access — paste DDL, upload a file, or drop an ER diagram image.
            SAI will parse it and make it available for schema-aware Q&A.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          {importResult ? (
            <Alert severity="success" sx={{ borderRadius: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>✅ Schema imported successfully</Typography>
              <Typography variant="body2">
                <strong>{importResult.conn_name}</strong> — {importResult.tables} tables, {importResult.columns} columns,
                {importResult.embeddings} embeddings generated.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                This schema now appears in the Ask SAI "Schema:" selector. Select it before asking schema-related questions.
              </Typography>
            </Alert>
          ) : (
            <>
              <TextField label="Schema Name *" value={importName} onChange={e => setImportName(e.target.value)}
                fullWidth size="small" placeholder="e.g. GL Module, Billing Tables, Claims DB" />

              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                  Input — choose one or combine:
                </Typography>
                <Stack spacing={1.5}>
                  <TextField
                    label="Paste DDL / Data Dictionary / Description"
                    multiline minRows={6} fullWidth size="small"
                    value={importContent} onChange={e => setImportContent(e.target.value)}
                    placeholder={`-- Paste CREATE TABLE statements, CSV column list, or describe the schema in plain text:

CREATE TABLE GL_Headers (
  header_id INT PRIMARY KEY,
  period_date DATE NOT NULL,
  entity_code VARCHAR(10)
);`}
                    sx={{ fontFamily: 'monospace', '& textarea': { fontFamily: 'monospace', fontSize: 12 } }}
                  />

                  <Stack direction="row" spacing={1} alignItems="center">
                    <input ref={importFileRef} type="file" style={{ display: 'none' }}
                      accept=".sql,.ddl,.csv,.xlsx,.xls,.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif"
                      onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
                    <Button size="small" variant="outlined" startIcon={<AttachFileOutlined />}
                      onClick={() => importFileRef.current?.click()}>
                      {importFile ? 'Change File' : 'Upload File / Image'}
                    </Button>
                    {importFile && (
                      <Chip size="small" label={importFile.name}
                        onDelete={() => setImportFile(null)} />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      SQL, CSV, Excel, PDF, or ER diagram image
                    </Typography>
                  </Stack>
                </Stack>
              </Box>

              <Alert severity="info" sx={{ py: 0.5 }}>
                <Typography variant="caption">
                  SAI parses your full DDL (no character limit), embeds every column table-by-table with progress shown.
                  After import, select this schema in Ask SAI for schema-aware answers and SQL generation.
                </Typography>
              </Alert>
            </>
          )}

          {/* ── Live progress panel ── */}
          {(importLoading || importProgress.length > 0) && !importResult && (
            <Box sx={{ mt: 2 }}>
              {/* Status header */}
              {importLoading && (() => {
                const last = importProgress[importProgress.length - 1]
                return (
                  <Box sx={{ mb: 1.5, p: 1.5, borderRadius: 1.5, bgcolor: alpha('#4f46e5', 0.08),
                    border: '1px solid', borderColor: alpha('#4f46e5', 0.25) }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <CircularProgress size={20} thickness={4} />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={700} color="primary.main">
                          {last?.table ? `Embedding: ${last.table}` : 'Parsing schema with AI…'}
                        </Typography>
                        {last?.current && last?.total && (
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                            <LinearProgress variant="determinate"
                              value={(last.current / last.total) * 100}
                              sx={{ flex: 1, height: 6, borderRadius: 3 }} />
                            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 50, textAlign: 'right' }}>
                              {last.current} / {last.total} tables
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                )
              })()}

              {/* Full log */}
              <Box sx={{ bgcolor: '#0f172a', borderRadius: 1.5, p: 2, maxHeight: 260, overflowY: 'auto',
                border: '1px solid rgba(99,102,241,0.2)' }}>
                <Typography variant="caption" sx={{ color: '#475569', fontFamily: 'monospace', display: 'block', mb: 1 }}>
                  ── Import Log ──────────────────────────────────
                </Typography>
                {importProgress.map((p, i) => (
                  <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 0.5 }}>
                    {p.current && p.total ? (
                      <Typography sx={{ color: '#475569', fontFamily: 'monospace', fontSize: 13, minWidth: 52, flexShrink: 0 }}>
                        [{String(p.current).padStart(2, '0')}/{p.total}]
                      </Typography>
                    ) : (
                      <Typography sx={{ color: '#475569', fontFamily: 'monospace', fontSize: 13, minWidth: 52, flexShrink: 0 }}>
                        {'  ···  '}
                      </Typography>
                    )}
                    <Typography sx={{
                      color: p.table ? '#34d399' : p.msg.includes('Done') ? '#fbbf24' : '#60a5fa',
                      fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5,
                    }}>
                      {p.msg}
                      {p.cols ? <span style={{ color: '#94a3b8' }}>{` — ${p.cols} columns`}</span> : null}
                    </Typography>
                  </Stack>
                ))}
                {importLoading && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#60a5fa',
                      animation: 'pulse 1s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }} />
                    <Typography sx={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 13 }}>
                      working…
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          {importResult ? (
            <Button onClick={() => { setImportOpen(false); setImportResult(null); setImportName(''); setImportContent(''); setImportFile(null); setImportProgress([]) }}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setImportOpen(false)} disabled={importLoading}>Cancel</Button>
              <Button variant="contained" onClick={handleImport}
                disabled={importLoading || (!importContent.trim() && !importFile)}
                startIcon={importLoading ? <CircularProgress size={16} /> : <AutoAwesomeOutlined />}>
                {importLoading ? 'Embedding…' : 'Import & Embed'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ── Tab: Sessions ─────────────────────────────────────────────────────────────

function SessionsTab() {
  const queryClient         = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const user                = useAppStore(s => s.user)
  const canWrite            = user?.role !== 'viewer'
  const canApprove          = user?.role === 'developer' || user?.role === 'admin'

  const [schemaFilter,  setSchemaFilter]  = useState<number | ''>('')
  const [statusFilter,  setStatusFilter]  = useState('')
  const [typeFilter,    setTypeFilter]    = useState('')
  const [selectedSession, setSelectedSession] = useState<RequirementSession | null>(null)
  const [detailTab,     setDetailTab]     = useState(0)
  const [artifactTab,   setArtifactTab]   = useState(0)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [editTranscript, setEditTranscript] = useState('')
  const [savingTranscript, setSavingTranscript] = useState(false)
  const [addLinkArtifact,  setAddLinkArtifact]  = useState<SessionArtifact | null>(null)
  const [linkTargetCode,   setLinkTargetCode]   = useState('')
  const [linkRelType,      setLinkRelType]      = useState('requires')
  const [uploadingFile,    setUploadingFile]    = useState(false)
  const [kbSuggestions,    setKbSuggestions]    = useState<any[]>([])
  const [suggestLoading,   setSuggestLoading]   = useState(false)
  const [suggestOpen,      setSuggestOpen]      = useState(false)
  const [addEntryOpen,     setAddEntryOpen]     = useState(false)
  const [prefillEntry,     setPrefillEntry]     = useState<{ title: string; blocks: ContentBlock[]; sessionId: number } | null>(null)
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // New session form state
  const [nTitle,     setNTitle]     = useState('')
  const [nType,      setNType]      = useState<SessionType>('MeetingNotes')
  const [nSchema,    setNSchema]    = useState<number | ''>('')
  const [nDate,      setNDate]      = useState('')
  const [nDuration,  setNDuration]  = useState('')
  const [nAttendees, setNAttendees] = useState('')
  const [nTranscript,    setNTranscript]     = useState('')
  const [nRecording,     setNRecording]     = useState('')
  const [nDbSchemaName,  setNDbSchemaName]  = useState('')
  const [nDbConnName,    setNDbConnName]    = useState('')
  const [nSourceSystem,  setNSourceSystem]  = useState('')
  const [nEnvName,       setNEnvName]       = useState('')
  const [nTechContext,   setNTechContext]    = useState('')
  const [techCtxOpen,    setTechCtxOpen]    = useState(false)

  const { data: schemas = [] } = useQuery({
    queryKey: ['knowledge-schemas'],
    queryFn:  () => knowledgeApi.listSchemas(),
  })

  const { data: sessions = [], isFetching: sessionsFetching } = useQuery({
    queryKey: ['knowledge-sessions', schemaFilter, statusFilter, typeFilter],
    queryFn:  () => knowledgeApi.listSessions({
      kb_schema_id: schemaFilter  || undefined,
      status:       statusFilter  || undefined,
      session_type: typeFilter    || undefined,
      limit: 100,
    }),
  })

  const { data: selectedSessionData, refetch: refetchSelected } = useQuery({
    queryKey: ['knowledge-session', selectedSession?.id],
    queryFn:  () => knowledgeApi.getSession(selectedSession!.id),
    enabled:  !!selectedSession,
    refetchInterval: (query) => {
      const status = (query.state.data as RequirementSession)?.status
      return (status === 'EXTRACTING' || status === 'EMBEDDING') ? 3000 : false
    },
  })

  const { data: artifacts = [] } = useQuery({
    queryKey: ['knowledge-session-artifacts', selectedSession?.id],
    queryFn:  () => knowledgeApi.listSessionArtifacts(selectedSession!.id),
    enabled:  !!selectedSession && selectedSessionData?.status === 'READY',
  })

  const activeSession = selectedSessionData ?? selectedSession

  useEffect(() => {
    if (activeSession?.status === 'READY' || activeSession?.status === 'FAILED') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [activeSession?.status])

  useEffect(() => {
    if (selectedSession) {
      setEditTranscript(selectedSession.transcript_raw ?? '')
      setDetailTab(0)
      setArtifactTab(0)
    }
  }, [selectedSession?.id])

  const { data: attachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ['session-attachments', selectedSession?.id],
    queryFn:  () => knowledgeApi.listAttachments(selectedSession!.id),
    enabled:  !!selectedSession,
    refetchInterval: (query) => {
      const data = query?.state?.data
      if (!Array.isArray(data)) return false
      return (data as SessionAttachment[]).some(a =>
        a.processing_status === 'EXTRACTING' || a.processing_status === 'PROCESSING'
      ) ? 3000 : false
    },
  })

  const createMut = useMutation({
    mutationFn: (d: SessionCreate) => knowledgeApi.createSession(d),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sessions'] })
      enqueueSnackbar('Session created', { variant: 'success' })
      setNewSessionOpen(false)
      setSelectedSession(s)
      setNTitle(''); setNType('MeetingNotes'); setNSchema(''); setNDate('')
      setNDuration(''); setNAttendees(''); setNTranscript(''); setNRecording('')
      setNDbSchemaName(''); setNDbConnName(''); setNSourceSystem(''); setNEnvName(''); setNTechContext('')
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Create failed', { variant: 'error' }),
  })

  const uploadAttachMut = useMutation({
    mutationFn: (file: File) => knowledgeApi.uploadAttachment(selectedSession!.id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-attachments', selectedSession?.id] })
      enqueueSnackbar('File uploaded', { variant: 'success' })
      setUploadingFile(false)
    },
    onError: (e: any) => {
      enqueueSnackbar(e?.response?.data?.detail || 'Upload failed', { variant: 'error' })
      setUploadingFile(false)
    },
  })

  const processAttachMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.processAttachment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-attachments', selectedSession?.id] })
      enqueueSnackbar('Processing started', { variant: 'info' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed', { variant: 'error' }),
  })

  const deleteAttachMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.deleteAttachment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-attachments', selectedSession?.id] })
      enqueueSnackbar('Attachment deleted', { variant: 'success' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed', { variant: 'error' }),
  })

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedSession) return
    e.target.value = ''
    setUploadingFile(true)
    uploadAttachMut.mutate(file)
  }

  const updateSessionMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => knowledgeApi.updateSession(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sessions'] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-session', selectedSession?.id] })
      enqueueSnackbar('Saved', { variant: 'success' })
      setSavingTranscript(false)
    },
    onError: (e: any) => { enqueueSnackbar(e?.response?.data?.detail || 'Save failed', { variant: 'error' }); setSavingTranscript(false) },
  })

  const processSessionMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.processSession(id, { create_kb_entries: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-session', selectedSession?.id] })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Process failed', { variant: 'error' }),
  })

  const addEntryMut = useMutation({
    mutationFn: ({ data, skip }: { data: KnowledgeEntryCreate; skip: boolean }) =>
      knowledgeApi.processEntry(data, skip),
    onSuccess: () => {
      enqueueSnackbar('Knowledge entry added from session.', { variant: 'success' })
      setAddEntryOpen(false)
      setPrefillEntry(null)
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed to add entry', { variant: 'error' }),
  })

  async function handleSuggest() {
    if (!selectedSession) return
    setSuggestLoading(true)
    setSuggestOpen(true)
    setKbSuggestions([])
    try {
      const res = await knowledgeApi.suggestKBContent(selectedSession.id)
      setKbSuggestions(res.suggestions || [])
      if (!res.suggestions?.length) enqueueSnackbar('No new suggestions — KB may already be up to date.', { variant: 'info' })
    } catch (e: any) {
      enqueueSnackbar(e?.response?.data?.detail || 'Suggestion failed', { variant: 'error' })
      setSuggestOpen(false)
    } finally {
      setSuggestLoading(false)
    }
  }

  function handleAddSuggestion(s: any) {
    const blocks: ContentBlock[] = (s.blocks || []).map((b: any) => ({
      id: uuid(),
      block_type: b.block_type as ContentBlockType,
      content: b.content || '',
      explanation: b.explanation || '',
    }))
    setPrefillEntry({ title: s.title || '', blocks, sessionId: selectedSession!.id })
    setAddEntryOpen(true)
  }

  const deleteMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sessions'] })
      setSelectedSession(null)
      enqueueSnackbar('Session deleted', { variant: 'success' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Delete failed', { variant: 'error' }),
  })

  const approveMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.approveArtifact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-session-artifacts', selectedSession?.id] })
      enqueueSnackbar('Artifact approved', { variant: 'success' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed', { variant: 'error' }),
  })

  const rejectMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.rejectArtifact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-session-artifacts', selectedSession?.id] })
      enqueueSnackbar('Artifact rejected', { variant: 'warning' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed', { variant: 'error' }),
  })

  const promoteMut = useMutation({
    mutationFn: (id: number) => knowledgeApi.promoteArtifact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-session-artifacts', selectedSession?.id] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-entries'] })
      enqueueSnackbar('Promoted to Knowledge Base', { variant: 'success' })
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed', { variant: 'error' }),
  })

  const createLinkMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { target_artifact_id: number; relationship_type: string } }) =>
      knowledgeApi.createArtifactLink(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-session-artifacts', selectedSession?.id] })
      enqueueSnackbar('Link created', { variant: 'success' })
      setAddLinkArtifact(null); setLinkTargetCode(''); setLinkRelType('requires')
    },
    onError: (e: any) => enqueueSnackbar(e?.response?.data?.detail || 'Failed', { variant: 'error' }),
  })

  function getSchemaForSession(s: RequirementSession): KnowledgeSchema | undefined {
    return schemas.find((sc: KnowledgeSchema) => sc.id === s.kb_schema_id)
  }

  const filteredArtifactTypes = ARTIFACT_TYPES.filter(t =>
    artifacts.some((a: SessionArtifact) => a.artifact_type === t)
  )
  const activeArtifactType = filteredArtifactTypes[artifactTab] ?? null

  const displayedArtifacts = activeArtifactType
    ? artifacts.filter((a: SessionArtifact) => a.artifact_type === activeArtifactType)
    : []

  const isProcessing = activeSession?.status === 'EXTRACTING' || activeSession?.status === 'EMBEDDING'

  function handleSaveTranscript() {
    if (!selectedSession) return
    setSavingTranscript(true)
    updateSessionMut.mutate({ id: selectedSession.id, data: { transcript_raw: editTranscript } })
  }

  const STATUS_CHIPS = ['DRAFT', 'EXTRACTING', 'READY', 'FAILED', 'ARCHIVED']

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 220px)', gap: 2 }}>
      {/* Left: Session list */}
      <Box sx={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* Filter bar */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {canWrite && (
            <Button size="small" variant="contained" startIcon={<AddOutlined />}
              onClick={() => {
                // Pre-fill schema from active filter
                if (schemaFilter) setNSchema(schemaFilter)
                setNewSessionOpen(true)
              }}>
              New
            </Button>
          )}
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>Schema</InputLabel>
            <Select value={schemaFilter} label="Schema"
              onChange={e => setSchemaFilter(e.target.value as number | '')}>
              <MenuItem value="">All</MenuItem>
              {schemas.map((s: KnowledgeSchema) => (
                <MenuItem key={s.id} value={s.id}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color_hex }} />
                    {s.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status"
              onChange={e => setStatusFilter(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {STATUS_CHIPS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>

        {/* Session list */}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {sessionsFetching && sessions.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : sessions.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
              <EventNoteOutlined sx={{ fontSize: 36, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">No sessions yet</Typography>
            </Paper>
          ) : (
            <Stack spacing={1}>
              {(sessions as RequirementSession[]).map(s => {
                const schema = getSchemaForSession(s)
                const isActive = selectedSession?.id === s.id
                const statusColor = SESSION_STATUS_COLOR[s.status] ?? '#888'
                return (
                  <Paper key={s.id} variant="outlined"
                    onClick={() => setSelectedSession(s)}
                    sx={{ p: 1.5, borderRadius: 2, cursor: 'pointer',
                      borderColor: isActive ? 'primary.main' : 'divider',
                      borderWidth: isActive ? 2 : 1,
                      borderLeft: schema ? `4px solid ${schema.color_hex}` : undefined,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                          {schema && (
                            <Chip label={schema.name} size="small"
                              sx={{ bgcolor: schema.color_hex + '22', color: schema.color_hex,
                                fontWeight: 700, fontSize: 10, height: 18 }} />
                          )}
                          <Chip label={s.status} size="small"
                            sx={{ bgcolor: statusColor + '22', color: statusColor, fontSize: 10, height: 18 }} />
                        </Stack>
                        <Typography variant="body2" fontWeight={600} sx={{
                          mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {s.session_type}
                          {s.meeting_datetime && ` · ${new Date(s.meeting_datetime).toLocaleDateString()}`}
                        </Typography>
                      </Box>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          )}
        </Box>
      </Box>

      {/* Right: Session detail */}
      {activeSession ? (
        <Paper variant="outlined" sx={{ flex: 1, borderRadius: 2, display: 'flex',
          flexDirection: 'column', overflow: 'hidden' }}>
          {/* Detail header */}
          <Box sx={{ px: 2.5, pt: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.5}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                  {(() => {
                    const sc = schemas.find((x: KnowledgeSchema) => x.id === activeSession.kb_schema_id)
                    return sc ? (
                      <Chip label={sc.name} size="small"
                        sx={{ bgcolor: sc.color_hex + '22', color: sc.color_hex, fontWeight: 700 }} />
                    ) : null
                  })()}
                  <Chip label={activeSession.status} size="small"
                    sx={{ bgcolor: (SESSION_STATUS_COLOR[activeSession.status] ?? '#888') + '22',
                      color: SESSION_STATUS_COLOR[activeSession.status] ?? '#888', fontWeight: 700 }} />
                  <Chip icon={SESSION_TYPE_ICONS[activeSession.session_type] as any}
                    label={activeSession.session_type} size="small" variant="outlined" />
                  {activeSession.meeting_datetime && (
                    <Chip icon={<AccessTimeOutlined />}
                      label={new Date(activeSession.meeting_datetime).toLocaleDateString()} size="small" variant="outlined" />
                  )}
                </Stack>
                <Typography variant="h6" fontWeight={700} noWrap>{activeSession.title}</Typography>
                {activeSession.attendees_json && (() => {
                  try {
                    const att: string[] = JSON.parse(activeSession.attendees_json)
                    return att.length > 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        <PeopleOutlined sx={{ fontSize: 13, verticalAlign: 'middle', mr: 0.5 }} />
                        {att.join(', ')}
                      </Typography>
                    ) : null
                  } catch { return null }
                })()}
              </Box>
              <Stack direction="row" spacing={0.5}>
                {canApprove && activeSession.status !== 'READY' && activeSession.status !== 'EXTRACTING' && activeSession.status !== 'EMBEDDING' && (
                  <Tooltip title="Run AI Extraction">
                    <span>
                      <Button size="small" variant="contained" color="primary"
                        disabled={processSessionMut.isPending || isProcessing || !activeSession.transcript_raw?.trim()}
                        startIcon={isProcessing ? <CircularProgress size={14} /> : <PlayCircleOutlined />}
                        onClick={() => { if (selectedSession) processSessionMut.mutate(selectedSession.id) }}>
                        {isProcessing ? activeSession.status : 'Extract'}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                <Tooltip title="Ask SAI what to add to the Knowledge Base from this session">
                  <span>
                    <Button size="small" variant="outlined" color="secondary"
                      disabled={suggestLoading || (!activeSession.transcript_raw?.trim() && !activeSession.summary?.trim())}
                      startIcon={suggestLoading ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
                      onClick={handleSuggest}
                      sx={{ textTransform: 'none' }}>
                      {suggestLoading ? 'Analyzing…' : 'Ask SAI What to Feed'}
                    </Button>
                  </span>
                </Tooltip>
                {isProcessing && (
                  <Chip label={activeSession.status} size="small"
                    sx={{ bgcolor: (SESSION_STATUS_COLOR[activeSession.status]) + '33',
                      color: SESSION_STATUS_COLOR[activeSession.status] }} />
                )}
                {canWrite && (
                  <Tooltip title="Delete session">
                    <IconButton size="small" color="error"
                      onClick={() => { if (confirm('Delete this session?')) deleteMut.mutate(activeSession.id) }}>
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <IconButton size="small" onClick={() => setSelectedSession(null)}>
                  <CloseOutlined fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
            {activeSession.last_error && (
              <Alert severity="error" sx={{ mt: 1, py: 0.5 }}>
                {activeSession.last_error}
              </Alert>
            )}
            {isProcessing && <LinearProgress sx={{ mt: 1 }} />}
          </Box>

          {/* Detail tabs */}
          <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)}
            sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40, px: 2 }}>
            <Tab label="Transcript" sx={{ minHeight: 40, textTransform: 'none', fontSize: 13 }} />
            <Tab label={`Artifacts${artifacts.length > 0 ? ` (${artifacts.length})` : ''}`}
              sx={{ minHeight: 40, textTransform: 'none', fontSize: 13 }}
              disabled={activeSession.status !== 'READY' && activeSession.status !== 'PARTIAL'} />
            <Tab label="Summary"
              sx={{ minHeight: 40, textTransform: 'none', fontSize: 13 }}
              disabled={!activeSession.summary} />
            <Tab label={`Attachments${attachments.length > 0 ? ` (${attachments.length})` : ''}`}
              sx={{ minHeight: 40, textTransform: 'none', fontSize: 13 }} />
          </Tabs>

          <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
            {/* Transcript tab */}
            {detailTab === 0 && (
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    Paste meeting notes or transcript below, then run AI Extraction.
                  </Typography>
                  {canWrite && (
                    <Button size="small" variant="outlined"
                      disabled={savingTranscript || updateSessionMut.isPending}
                      startIcon={savingTranscript ? <CircularProgress size={12} /> : <EditOutlined />}
                      onClick={handleSaveTranscript}>
                      Save
                    </Button>
                  )}
                </Stack>
                <TextField
                  multiline minRows={14} fullWidth
                  placeholder="Paste meeting notes, transcript, or discussion summary here…"
                  value={editTranscript}
                  onChange={e => setEditTranscript(e.target.value)}
                  disabled={!canWrite}
                  sx={{ fontFamily: 'monospace', fontSize: 13 }}
                  inputProps={{ style: { fontSize: 13, lineHeight: 1.6 } }}
                />
              </Stack>
            )}

            {/* Artifacts tab */}
            {detailTab === 1 && (
              <Box>
                {filteredArtifactTypes.length === 0 ? (
                  <Alert severity="info">No artifacts extracted yet. Run AI Extraction first.</Alert>
                ) : (
                  <>
                    <Tabs value={artifactTab} onChange={(_, v) => setArtifactTab(v)}
                      variant="scrollable" scrollButtons="auto"
                      sx={{ mb: 2, '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontSize: 12 } }}>
                      {filteredArtifactTypes.map((t, i) => (
                        <Tab key={t} label={`${t} (${artifacts.filter((a: SessionArtifact) => a.artifact_type === t).length})`} />
                      ))}
                    </Tabs>
                    <Stack spacing={1.5}>
                      {displayedArtifacts.map((a: SessionArtifact) => {
                        const statusColor = ARTIFACT_STATUS_COLOR[a.status ?? ''] ?? '#888'
                        return (
                          <Paper key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                            <Stack direction="row" spacing={1.5} alignItems="flex-start">
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                  <Chip label={a.artifact_code} size="small"
                                    sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11,
                                      bgcolor: (() => { const sc = schemas.find((x: KnowledgeSchema) => x.id === a.kb_schema_id); return sc ? sc.color_hex + '22' : 'primary.main' + '22' })(),
                                      color: (() => { const sc = schemas.find((x: KnowledgeSchema) => x.id === a.kb_schema_id); return sc?.color_hex ?? 'primary.main' })(),
                                    }} />
                                  <Chip label={a.status ?? 'PENDING_REVIEW'} size="small"
                                    sx={{ bgcolor: statusColor + '22', color: statusColor, fontSize: 11 }} />
                                  {a.priority && (
                                    <Chip label={a.priority} size="small" variant="outlined"
                                      sx={{ fontSize: 11,
                                        color: a.priority === 'CRITICAL' ? '#ef5350' : a.priority === 'HIGH' ? '#ff8a65' : '#888' }} />
                                  )}
                                  {a.owner && (
                                    <Typography variant="caption" color="text.secondary">
                                      Owner: <strong>{a.owner}</strong>
                                    </Typography>
                                  )}
                                  {a.due_date && (
                                    <Typography variant="caption" color="text.secondary">
                                      Due: {a.due_date}
                                    </Typography>
                                  )}
                                </Stack>
                                <Typography variant="body2" fontWeight={600} sx={{ mt: 0.75 }}>{a.title}</Typography>
                                {a.description && (
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
                                    {a.description}
                                  </Typography>
                                )}
                                {a.confidence_score != null && (
                                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ width: 90 }}>
                                      Confidence
                                    </Typography>
                                    <LinearProgress variant="determinate"
                                      value={a.confidence_score * 100}
                                      color={a.confidence_score >= 0.8 ? 'success' : a.confidence_score >= 0.5 ? 'warning' : 'error'}
                                      sx={{ flex: 1, height: 6, borderRadius: 3 }} />
                                    <Typography variant="caption" color="text.secondary">
                                      {Math.round(a.confidence_score * 100)}%
                                    </Typography>
                                  </Stack>
                                )}
                                {a.systems_involved && (() => {
                                  try {
                                    const sys: string[] = JSON.parse(a.systems_involved)
                                    return sys.length > 0 ? (
                                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                                        {sys.map(sys => <Chip key={sys} label={sys} size="small" variant="outlined"
                                          sx={{ fontSize: 10, height: 18 }} />)}
                                      </Stack>
                                    ) : null
                                  } catch { return null }
                                })()}
                              </Box>
                              {/* Action buttons */}
                              {canApprove && (
                                <Stack spacing={0.5}>
                                  {a.status !== 'APPROVED' && (
                                    <Tooltip title="Approve">
                                      <IconButton size="small" color="success"
                                        onClick={() => approveMut.mutate(a.id)}>
                                        <CheckOutlined fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {a.status !== 'REJECTED' && (
                                    <Tooltip title="Reject">
                                      <IconButton size="small" color="error"
                                        onClick={() => rejectMut.mutate(a.id)}>
                                        <CancelOutlined fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {a.status === 'APPROVED' && !a.kb_entry_id && (
                                    <Tooltip title="Promote to Knowledge Base">
                                      <IconButton size="small" color="primary"
                                        onClick={() => promoteMut.mutate(a.id)}>
                                        <OpenInNewOutlined fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {a.kb_entry_id && (
                                    <Tooltip title={`In KB (entry #${a.kb_entry_id})`}>
                                      <CheckCircleOutlined fontSize="small" color="success" />
                                    </Tooltip>
                                  )}
                                </Stack>
                              )}
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Stack>
                  </>
                )}
              </Box>
            )}

            {/* Attachments tab */}
            {detailTab === 3 && (
              <Box>
                {/* Hidden file input */}
                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.sql,.md"
                  style={{ display: 'none' }} onChange={handleFileSelect} />

                {/* Upload zone */}
                {canWrite && (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderStyle: 'dashed',
                    borderColor: 'primary.main', textAlign: 'center', cursor: 'pointer',
                    '&:hover': { bgcolor: 'primary.main', opacity: 0.04 } }}
                    onClick={() => fileInputRef.current?.click()}>
                    <AttachFileOutlined sx={{ fontSize: 28, color: 'primary.main', mb: 0.5 }} />
                    <Typography variant="body2" color="primary.main" fontWeight={600}>
                      Click to upload a file
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      PDF, DOCX, XLSX, CSV, TXT, SQL — max 50 MB
                    </Typography>
                    {uploadingFile && <LinearProgress sx={{ mt: 1 }} />}
                  </Paper>
                )}

                {/* Attachment list */}
                {attachments.length === 0 && !uploadingFile && (
                  <Alert severity="info" sx={{ borderRadius: 2 }}>
                    No attachments yet. Upload a file to extract knowledge from it.
                  </Alert>
                )}
                <Stack spacing={1.5}>
                  {(attachments as SessionAttachment[]).map(att => {
                    const statusColors: Record<string, string> = {
                      PENDING: '#888', EXTRACTING: '#1976d2', EXTRACTED: '#0288d1',
                      PROCESSING: '#9c27b0', READY: '#2e7d32', FAILED: '#d32f2f',
                    }
                    const statusColor = statusColors[att.processing_status] ?? '#888'
                    const isWorking = att.processing_status === 'EXTRACTING' || att.processing_status === 'PROCESSING'
                    return (
                      <Paper key={att.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <AttachFileOutlined sx={{ color: 'text.secondary', fontSize: 18, flexShrink: 0 }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>{att.file_name}</Typography>
                            <Stack direction="row" spacing={1} alignItems="center" mt={0.25}>
                              {att.file_size_bytes && (
                                <Typography variant="caption" color="text.secondary">
                                  {(att.file_size_bytes / 1024).toFixed(1)} KB
                                </Typography>
                              )}
                              <Chip label={att.processing_status} size="small"
                                sx={{ fontSize: 10, height: 18,
                                  bgcolor: statusColor + '22', color: statusColor }} />
                              {isWorking && <CircularProgress size={10} />}
                            </Stack>
                            {att.last_error && (
                              <Tooltip title={att.last_error}>
                                <Typography variant="caption" color="error" sx={{ display: 'block', cursor: 'help' }}>
                                  Error (hover to view)
                                </Typography>
                              </Tooltip>
                            )}
                          </Box>
                          {canWrite && att.processing_status !== 'READY' && !isWorking && (
                            <Tooltip title="Extract text &amp; run AI pipeline">
                              <Button size="small" variant="outlined" sx={{ fontSize: 11, py: 0.25 }}
                                onClick={() => processAttachMut.mutate(att.id)}>
                                Extract
                              </Button>
                            </Tooltip>
                          )}
                          {canWrite && (
                            <Tooltip title="Delete attachment">
                              <IconButton size="small" color="error"
                                onClick={() => { if (confirm('Delete this attachment?')) deleteAttachMut.mutate(att.id) }}>
                                <DeleteOutlined fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </Paper>
                    )
                  })}
                </Stack>
              </Box>
            )}

            {/* Summary tab */}
            {detailTab === 2 && activeSession.summary && (
              <Box>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>AI Summary</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{activeSession.summary}</Typography>
                </Paper>
                {activeSession.decisions_json && (() => {
                  try {
                    const items: string[] = JSON.parse(activeSession.decisions_json)
                    return items.length > 0 ? (
                      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>Decisions</Typography>
                        {items.map((d, i) => (
                          <Stack key={i} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="flex-start">
                            <GavelOutlined sx={{ fontSize: 15, color: 'primary.main', mt: 0.3, flexShrink: 0 }} />
                            <Typography variant="body2">{d}</Typography>
                          </Stack>
                        ))}
                      </Paper>
                    ) : null
                  } catch { return null }
                })()}
                {activeSession.action_items_json && (() => {
                  try {
                    const items: any[] = JSON.parse(activeSession.action_items_json)
                    return items.length > 0 ? (
                      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>Action Items</Typography>
                        {items.map((a, i) => (
                          <Stack key={i} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="flex-start">
                            <TaskAltOutlined sx={{ fontSize: 15, color: 'success.main', mt: 0.3, flexShrink: 0 }} />
                            <Box>
                              <Typography variant="body2">{typeof a === 'string' ? a : a.task}</Typography>
                              {a.owner && <Typography variant="caption" color="text.secondary">Owner: {a.owner}</Typography>}
                            </Box>
                          </Stack>
                        ))}
                      </Paper>
                    ) : null
                  } catch { return null }
                })()}
                {activeSession.risks_json && (() => {
                  try {
                    const items: any[] = JSON.parse(activeSession.risks_json)
                    return items.length > 0 ? (
                      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>Risks</Typography>
                        {items.map((r, i) => (
                          <Stack key={i} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="flex-start">
                            <ReportProblemOutlined sx={{ fontSize: 15, color: 'warning.main', mt: 0.3, flexShrink: 0 }} />
                            <Typography variant="body2">{typeof r === 'string' ? r : r.risk ?? r.title}</Typography>
                          </Stack>
                        ))}
                      </Paper>
                    ) : null
                  } catch { return null }
                })()}
              </Box>
            )}
          </Box>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ flex: 1, borderRadius: 2, display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
          <EventNoteOutlined sx={{ fontSize: 56, color: 'text.disabled' }} />
          <Typography color="text.secondary">Select a session to view details</Typography>
        </Paper>
      )}

      {/* New Session Dialog */}
      <Dialog open={newSessionOpen} onClose={() => setNewSessionOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Session</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Title" required fullWidth size="small"
              value={nTitle} onChange={e => setNTitle(e.target.value)} />
            <FormControl size="small" fullWidth>
              <InputLabel>Session Type</InputLabel>
              <Select value={nType} label="Session Type"
                onChange={e => setNType(e.target.value as SessionType)}>
                {SESSION_TYPE_GROUPS.map(g => [
                  <MenuItem key={g.label} disabled sx={{ fontSize: 11, fontWeight: 700, color: 'text.disabled', py: 0.25 }}>{g.label}</MenuItem>,
                  ...g.types.map(t => (
                  <MenuItem key={t} value={t}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {SESSION_TYPE_ICONS[t]}
                      <span>{t}</span>
                    </Stack>
                  </MenuItem>
                  ))
                ])}
              </Select>
            </FormControl>
            {schemas.length > 0 && (
              <FormControl size="small" fullWidth required error={!nSchema}>
                <InputLabel required>Schema *</InputLabel>
                <Select value={nSchema} label="Schema *"
                  onChange={e => setNSchema(e.target.value as number | '')}>
                  <MenuItem value="" disabled>— Select a schema —</MenuItem>
                  {schemas.map((s: KnowledgeSchema) => (
                    <MenuItem key={s.id} value={s.id}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color_hex }} />
                        {s.name}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {/* Meeting-only fields */}
            {SESSION_TYPE_GROUPS[0].types.includes(nType) && (
              <>
                <Stack direction="row" spacing={2}>
                  <TextField label="Date / Time" type="datetime-local" size="small" fullWidth
                    value={nDate} onChange={e => setNDate(e.target.value)}
                    InputLabelProps={{ shrink: true }} />
                  <TextField label="Duration (min)" type="number" size="small" sx={{ width: 160 }}
                    value={nDuration} onChange={e => setNDuration(e.target.value)} />
                </Stack>
                <TextField label="Attendees (comma-separated)" size="small" fullWidth
                  value={nAttendees} onChange={e => setNAttendees(e.target.value)}
                  placeholder="Alice <alice@co.com>, Bob" />
                <TextField label="Recording URL (optional)" size="small" fullWidth
                  value={nRecording} onChange={e => setNRecording(e.target.value)} />
              </>
            )}
            <TextField
              label={SESSION_TYPE_GROUPS[0].types.includes(nType) ? 'Meeting notes / Transcript' : 'Description / Content'}
              multiline minRows={6} fullWidth size="small"
              value={nTranscript} onChange={e => setNTranscript(e.target.value)}
              placeholder={SESSION_TYPE_GROUPS[0].types.includes(nType)
                ? 'Paste notes or leave empty to add later…'
                : 'Describe this document/query collection, or paste content directly…'}
            />
            {/* Technical Context collapsible */}
            <Accordion expanded={techCtxOpen} onChange={() => setTechCtxOpen(o => !o)}
              variant="outlined" sx={{ borderRadius: '8px !important', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <MemoryOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" fontWeight={600}>Technical Context (optional)</Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5}>
                    <TextField label="DB Schema" size="small" sx={{ flex: 1 }}
                      value={nDbSchemaName} onChange={e => setNDbSchemaName(e.target.value)}
                      placeholder="e.g. finance_gl" />
                    <TextField label="Connection / DB Name" size="small" sx={{ flex: 1 }}
                      value={nDbConnName} onChange={e => setNDbConnName(e.target.value)}
                      placeholder="e.g. ClarityDW" />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    <TextField label="Source System" size="small" sx={{ flex: 1 }}
                      value={nSourceSystem} onChange={e => setNSourceSystem(e.target.value)}
                      placeholder="e.g. DuckCreek, Guidewire" />
                    <TextField label="Environment" size="small" sx={{ flex: 1 }}
                      value={nEnvName} onChange={e => setNEnvName(e.target.value)}
                      placeholder="DEV / UAT / PROD" />
                  </Stack>
                  <TextField label="Technical Context JSON" multiline minRows={3} fullWidth size="small"
                    value={nTechContext} onChange={e => setNTechContext(e.target.value)}
                    placeholder={'{\n  "database": "ClarityDW",\n  "schema": "finance_gl",\n  "tables": ["GL_TRANS", "PREMIUM_LEDGER"]\n}'} />
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNewSessionOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!nTitle.trim() || !nSchema || createMut.isPending}
            startIcon={createMut.isPending ? <CircularProgress size={14} /> : <AddOutlined />}
            onClick={() => {
              const attendees = nAttendees.split(',').map(s => s.trim()).filter(Boolean)
              createMut.mutate({
                title:                   nTitle.trim(),
                session_type:            nType,
                kb_schema_id:            nSchema || undefined,
                meeting_datetime:        nDate || undefined,
                duration_minutes:        nDuration ? parseInt(nDuration) : undefined,
                attendees:               attendees.length > 0 ? attendees : undefined,
                transcript_raw:          nTranscript.trim() || undefined,
                recording_url:           nRecording.trim() || undefined,
                db_schema_name:          nDbSchemaName.trim() || undefined,
                db_connection_name:      nDbConnName.trim() || undefined,
                source_system:           nSourceSystem.trim() || undefined,
                environment_name:        nEnvName.trim() || undefined,
                technical_context_json:  nTechContext.trim() || undefined,
              } as SessionCreate)
            }}>
            Create Session
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── SAI Suggestions Panel ── */}
      {suggestOpen && (
        <Dialog open={suggestOpen} onClose={() => setSuggestOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeOutlined sx={{ color: 'primary.main' }} />
            SAI Knowledge Suggestions
            {selectedSession && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                for "{selectedSession.title}"
              </Typography>
            )}
          </DialogTitle>
          <DialogContent>
            {suggestLoading ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <CircularProgress size={32} sx={{ mb: 1.5 }} />
                <Typography variant="body2" color="text.secondary">
                  SAI is reading the session and checking what's already in the KB…
                </Typography>
              </Box>
            ) : kbSuggestions.length === 0 ? (
              <Alert severity="info">No new suggestions — the Knowledge Base already covers this session well.</Alert>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="caption" color="text.secondary">
                  {kbSuggestions.length} knowledge item{kbSuggestions.length !== 1 ? 's' : ''} suggested — click "Add to KB" to save any of them.
                </Typography>
                {kbSuggestions.map((s: any, i: number) => (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" mb={0.5} flexWrap="wrap">
                          <Typography variant="subtitle2" fontWeight={700}>{s.title}</Typography>
                          <Chip size="small" label={s.type} sx={{ height: 18, fontSize: 10 }} />
                          <Chip size="small" label={s.system} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                          {s.reason}
                        </Typography>
                        {(s.blocks || []).map((b: any, j: number) => (
                          <Chip key={j} size="small" variant="outlined"
                            label={`${BLOCK_TYPES.find(bt => bt.type === b.block_type)?.icon || '📎'} ${b.block_type}`}
                            sx={{ mr: 0.5, mb: 0.5, fontSize: 11, height: 20 }} />
                        ))}
                      </Box>
                      <Button size="small" variant="contained" onClick={() => { handleAddSuggestion(s); setSuggestOpen(false) }}
                        sx={{ flexShrink: 0, textTransform: 'none', fontSize: 12 }}>
                        Add to KB
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSuggestOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Entry form pre-filled from suggestion */}
      {prefillEntry && (
        <EntryFormDialog
          open={addEntryOpen}
          onClose={() => { setAddEntryOpen(false); setPrefillEntry(null) }}
          onSubmit={(data, skip) => addEntryMut.mutate({ data, skip })}
          loading={addEntryMut.isPending}
          dupId={null}
          prefillTitle={prefillEntry.title}
          prefillSessionId={prefillEntry.sessionId}
          prefillBlocks={prefillEntry.blocks}
        />
      )}
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const [tab, setTab] = useState(0)
  const user    = useAppStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const canDebug = user?.role === 'admin' || user?.role === 'developer'

  // Tab index mapping
  const tabLabels = [
    { label: 'Knowledge Base',          show: true },
    { label: 'Sessions',                show: true,      icon: <EventNoteOutlined sx={{ fontSize: 16 }} /> },
    { label: 'Schemas',                 show: true,      icon: <CategoryOutlined sx={{ fontSize: 16 }} /> },
    { label: 'Ask SAI',                 show: true },
    { label: 'Operational Rules',       show: false,     icon: <RuleOutlined sx={{ fontSize: 16 }} /> },
    { label: 'Operational Intelligence',show: false },
    { label: 'History',                 show: true,      icon: <HistoryOutlined sx={{ fontSize: 16 }} /> },
    { label: 'AI Debug',                show: canDebug,  icon: <BugReportOutlined sx={{ fontSize: 16 }} /> },
    { label: 'Open Questions',          show: isAdmin },
  ].filter(t => t.show)

  // Map visual tab index back to logical slot
  const tabSlot = (visual: number) => {
    const labels = ['Knowledge Base', 'Sessions', 'Schemas', 'Ask SAI', 'History',
      ...(canDebug ? ['AI Debug'] : []),
      ...(isAdmin  ? ['Open Questions'] : []),
    ]
    return labels[visual] ?? ''
  }

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <AutoAwesomeOutlined sx={{ fontSize: 28, color: 'primary.main' }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>SAI Knowledge Base</Typography>
          <Typography variant="body2" color="text.secondary">
            Smart Architect Intelligence — structured knowledge retrieval &amp; Q&amp;A
          </Typography>
        </Box>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {tabLabels.map((t, i) => (
          <Tab
            key={t.label}
            label={t.label}
            iconPosition="start"
            icon={t.icon as React.ReactElement | undefined}
            sx={{ minHeight: 44, textTransform: 'none' }}
          />
        ))}
      </Tabs>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tabSlot(tab) === 'Knowledge Base'           && <KnowledgeBaseTab />}
        {tabSlot(tab) === 'Sessions'                 && <SessionsTab />}
        {tabSlot(tab) === 'Schemas'                  && <SchemaManagementTab />}
        {tabSlot(tab) === 'Ask SAI'                  && <AskSAITab />}
        {tabSlot(tab) === 'Operational Rules'        && <OperationalRulesTab />}
        {tabSlot(tab) === 'Operational Intelligence'  && <OperationalIntelligenceTab />}
        {tabSlot(tab) === 'History'                  && <HistoryTab />}
        {tabSlot(tab) === 'AI Debug'                 && canDebug && <AIDebugTab />}
        {tabSlot(tab) === 'Open Questions'           && isAdmin  && <OpenQuestionsTab />}
      </Box>
    </Box>
  )
}
