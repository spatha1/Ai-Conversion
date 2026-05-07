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
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { knowledgeApi, adminApi, operationalKnowledgeApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import AIDebugPanel from '@/components/ai/AIDebugPanel'
import {
  KNOWLEDGE_ALLOWED_TAGS,
  type KnowledgeEntry, type KnowledgeEntryCreate,
  type OpenQuestion, type AskSAIResult, type AskSAIAnswered, type AskSAIUnanswered,
  type KnowledgeEntryType, type KnowledgeSystemType, type KnowledgeSourceType,
} from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENTRY_TYPES:   KnowledgeEntryType[]  = ['UseCase', 'Question', 'Process', 'Issue']
const SYSTEM_TYPES:  KnowledgeSystemType[] = ['DCT', 'ADO', 'Snowflake', 'General']
const SOURCE_TYPES:  KnowledgeSourceType[] = ['Text', 'Document', 'Link']

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
}

function EntryFormDialog({ open, onClose, onSubmit, loading, dupId, prefillTitle, prefillContent }: EntryFormProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [title,        setTitle]      = useState(prefillTitle || '')
  const [type,         setType]       = useState<KnowledgeEntryType>('UseCase')
  const [system,       setSystem]     = useState<KnowledgeSystemType>('DCT')
  const [tags,         setTags]       = useState<string[]>([])
  const [sourceType,   setSourceType] = useState<KnowledgeSourceType>('Text')
  const [content,      setContent]    = useState(prefillContent || '')
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle(prefillTitle || '')
      setType('UseCase')
      setSystem('DCT')
      setTags([])
      setSourceType('Text')
      setContent(prefillContent || '')
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
    }
  }, [open, prefillTitle, prefillContent])

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

  const valid = title.trim().length > 0 && content.trim().length >= 50

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {prefillContent ? 'Correct & Add to KB' : prefillTitle ? 'Answer Question (Full KB Entry)' : 'Add Knowledge Entry'}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
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
        <TextField label="Title" value={title} onChange={e => setTitle(e.target.value)} required fullWidth />
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
          minRows={6}
          value={content}
          onChange={e => setContent(e.target.value)}
          required
          fullWidth
          placeholder={
            sourceType === 'Document' ? 'Attach a file above — text will be extracted automatically, or paste directly here.'
            : sourceType === 'Link'   ? 'Enter a URL and click Fetch — or paste content directly here.'
            : 'Paste or type the knowledge content here…'
          }
          helperText={`${content.trim().length} chars${content.trim().length < 50 ? ' (min 50)' : ''}`}
          error={content.trim().length > 0 && content.trim().length < 50}
        />

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
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!valid || loading || fetching || (dupId !== null && !skipDup)}
          onClick={() => onSubmit({
            title, type, system, tags, source_type: sourceType, raw_content: content,
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
      </DialogActions>
    </Dialog>
  )
}

// ── Tab 0: Knowledge Base ─────────────────────────────────────────────────────

function KnowledgeBaseTab() {
  const queryClient              = useQueryClient()
  const { enqueueSnackbar }      = useSnackbar()
  const [typeFilter,  setTypeF]  = useState('')
  const [sysFilter,   setSysF]   = useState('')
  const [search,      setSearch] = useState('')
  const [showLow,     setShowLow]= useState(false)
  const [offset,      setOffset] = useState(0)
  const [addOpen,     setAddOpen]= useState(false)
  const [dupId,       setDupId]  = useState<number | null>(null)
  const LIMIT = 50

  const { data: entries = [], isFetching } = useQuery({
    queryKey: ['knowledge-entries', typeFilter, sysFilter, search, showLow, offset],
    queryFn:  () => knowledgeApi.listEntries({
      type:                typeFilter || undefined,
      system:              sysFilter  || undefined,
      search:              search     || undefined,
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
  const bulkImportMutation = useMutation({
    mutationFn: (f: File) => knowledgeApi.bulkImport(f),
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

  const user = useAppStore(s => s.user)
  const canWrite  = user?.role !== 'viewer'
  const canDelete = user?.role === 'admin'

  return (
    <Box>
      {/* Toolbar */}
      <Stack direction="row" spacing={1.5} mb={2} flexWrap="wrap" alignItems="center">
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
        {canWrite && (
          <Button
            variant="outlined"
            startIcon={<CloudDownloadOutlined />}
            onClick={() => { setBulkOpen(true); setBulkFile(null); setBulkResult(null) }}
          >
            Bulk Import
          </Button>
        )}
        {canWrite && (
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => { setAddOpen(true); setDupId(null) }}>
            Add Entry
          </Button>
        )}
      </Stack>

      {isFetching && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>System</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Tags</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Quality</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Embed</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>SAI</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Ver</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
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
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {entry.status === 'LOW_QUALITY' && (
                      <Tooltip title="Low quality — review suggested">
                        <WarningAmberOutlined sx={{ fontSize: 16, color: tokens.amber500 }} />
                      </Tooltip>
                    )}
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{entry.title}</Typography>
                  </Stack>
                  {entry.summary && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {entry.summary.slice(0, 100)}{entry.summary.length > 100 ? '…' : ''}
                    </Typography>
                  )}
                </TableCell>
                <TableCell><Chip label={entry.type} size="small" /></TableCell>
                <TableCell><Chip label={entry.system} size="small" variant="outlined" /></TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {parseTags(entry.tags).map(t => (
                      <Chip key={t} label={t} size="small" sx={{ fontSize: 11 }} />
                    ))}
                  </Stack>
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

      {/* Bulk Import Dialog */}
      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Bulk Import KB Entries</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file with columns:<br />
            <code>title</code>, <code>raw_content</code>, <code>type</code> (opt), <code>system</code> (opt), <code>tags</code> (opt)
          </Typography>
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 2 }}>
            Each row runs through LLM structuring + embeddings — allow ~10–15s per row.
          </Typography>

          <Button
            component="label"
            variant="outlined"
            startIcon={<AttachFileOutlined />}
            sx={{ mb: 2 }}
          >
            {bulkFile ? bulkFile.name : 'Choose File'}
            <input
              type="file"
              hidden
              accept=".csv,.xlsx,.xls"
              onChange={e => { setBulkFile(e.target.files?.[0] ?? null); setBulkResult(null) }}
            />
          </Button>

          {bulkResult && (
            <Box sx={{ mt: 1 }}>
              <Alert severity={bulkResult.failed === 0 ? 'success' : bulkResult.processed === 0 ? 'error' : 'warning'} sx={{ mb: 1 }}>
                <strong>{bulkResult.processed}</strong> of <strong>{bulkResult.total}</strong> rows imported
                {bulkResult.failed > 0 && ` — ${bulkResult.failed} failed`}
              </Alert>
              {bulkResult.errors.length > 0 && (
                <Box sx={{ maxHeight: 160, overflowY: 'auto', fontSize: '0.75rem' }}>
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

const DOC_STORAGE_KEY = 'sai-doc-history'

function loadQAHistory(): QARecord[] {
  try { return JSON.parse(localStorage.getItem(DOC_STORAGE_KEY) ?? '[]') } catch { return [] }
}
function saveQAHistory(h: QARecord[]) {
  localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(h.slice(-50)))
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
  const result = record.result

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
      <Alert severity="warning" icon={<HourglassEmptyOutlined />} sx={{ mt: 1 }}>
        <Typography variant="body2" fontWeight={700} gutterBottom>Not found in knowledge base</Typography>
        <Typography variant="body2">{u.reason}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{u.action}</Typography>
      </Alert>
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
    </Box>
  )
}

function AskSAITab() {
  const { enqueueSnackbar } = useSnackbar()
  const user          = useAppStore(s => s.user)
  const activeProject = useAppStore(s => s.activeProject)
  const [qaHistory,    setQAHistory]    = useState<QARecord[]>(loadQAHistory)
  const [selected,     setSelected]     = useState<QARecord | null>(() => loadQAHistory()[0] ?? null)
  const [inputText,    setInput]        = useState('')
  const [isLoading,    setLoading]      = useState(false)
  const [historyOpen,  setHistoryOpen]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
        question:   q,
        asked_by:   user?.username,
        project_id: activeProject?.id,
        history:    buildHistory(),
      })
      const record: QARecord = { id: crypto.randomUUID(), question: q, result, timestamp: new Date().toISOString() }
      const updated = [record, ...qaHistory]
      setQAHistory(updated)
      saveQAHistory(updated)
      setSelected(record)
    } catch {
      enqueueSnackbar('Ask SAI request failed.', { variant: 'error' })
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
        {/* Input bar */}
        <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Tooltip title={historyOpen ? 'Hide history' : `Show history (${qaHistory.length})`}>
              <IconButton size="small" onClick={() => setHistoryOpen(o => !o)} sx={{ mt: 0.5, color: historyOpen ? 'primary.main' : 'text.disabled' }}>
                <Badge badgeContent={!historyOpen && qaHistory.length > 0 ? qaHistory.length : 0} color="primary" max={99}>
                  <HistoryOutlined fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <TextField
              inputRef={inputRef}
              fullWidth multiline maxRows={3} size="small"
              placeholder="Ask about business processes, reconciliation rules, ownership, incidents…"
              value={inputText}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={isLoading}
            />
            <Tooltip title="Submit (Enter)">
              <span>
                <Button variant="contained" onClick={handleSend} disabled={isLoading || !inputText.trim()} sx={{ mt: 0.25, minWidth: 40, px: 1.5 }}>
                  {isLoading ? <CircularProgress size={16} color="inherit" /> : <SendOutlined />}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Box>

        {/* Answer area */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {!selected && !isLoading && (
            <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 8 }}>
              <ArticleOutlined sx={{ fontSize: 52, opacity: 0.15, mb: 1.5 }} />
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>No document selected</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340, mx: 'auto', mb: 2 }}>
                Ask SAI a question to generate an intelligent knowledge document.
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
          {isLoading && (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <CircularProgress size={28} sx={{ mb: 1.5 }} />
              <Typography variant="body2" color="text.secondary">Generating document…</Typography>
            </Paper>
          )}
          {selected && !isLoading && (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start" mb={1.5}>
                <ArticleOutlined sx={{ color: 'primary.main', fontSize: 20, mt: 0.25 }} />
                <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1, lineHeight: 1.4 }}>
                  {selected.question}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center" ml={3.5} mb={2}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <AccessTimeOutlined sx={{ fontSize: 12, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(selected.timestamp).toLocaleString()}
                  </Typography>
                </Stack>
                <Chip size="small" label={selected.result.status}
                  sx={{ height: 17, fontSize: '0.63rem', fontWeight: 700,
                    bgcolor: selected.result.status === 'ANSWERED' ? tokens.emerald600 : tokens.amber500, color: '#fff' }} />
              </Stack>
              <Divider sx={{ mb: 2 }} />
              <QADocumentView record={selected} />
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ── Mermaid diagram renderer ──────────────────────────────────────────────────

function MermaidDiagram({ code }: { code: string }) {
  const id = `mermaid-${Math.random().toString(36).slice(2)}`
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
      if (ref.current && !cancelled) {
        mermaid.render(id, code).then(({ svg }) => {
          if (ref.current && !cancelled) ref.current.innerHTML = svg
        }).catch(() => {
          if (ref.current && !cancelled)
            ref.current.innerHTML = `<pre style="font-size:11px;overflow:auto">${code}</pre>`
        })
      }
    })
    return () => { cancelled = true }
  }, [code, id])

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
      <Alert severity="warning" icon={<HourglassEmptyOutlined />}>
        <Typography variant="body2" fontWeight={600} gutterBottom>Not yet in the knowledge base</Typography>
        <Typography variant="body2">{result.reason}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {result.action}
        </Typography>
      </Alert>
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
                    <Typography variant="caption" fontWeight={700} color="text.secondary">ANSWER PREVIEW</Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary', fontSize: '0.8rem', lineHeight: 1.6 }}>
                      {trace.response_text.slice(0, 600)}{trace.response_text.length > 600 ? '…' : ''}
                    </Typography>
                  </Box>
                )}
                {trace.prompt_text && (
                  <Box>
                    <Typography variant="caption" fontWeight={700} color="text.secondary">PROMPT SENT</Typography>
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const [tab, setTab] = useState(0)
  const user    = useAppStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const canDebug = user?.role === 'admin' || user?.role === 'developer'

  // Tab index mapping (History=2, AIDebug=3 if canDebug, OpenQ=last if isAdmin)
  const tabLabels = [
    { label: 'Knowledge Base',          show: true },
    { label: 'Ask SAI',                 show: true },
    { label: 'Operational Intelligence',show: true },
    { label: 'History',                 show: true,      icon: <HistoryOutlined sx={{ fontSize: 16 }} /> },
    { label: 'AI Debug',                show: canDebug,  icon: <BugReportOutlined sx={{ fontSize: 16 }} /> },
    { label: 'Open Questions',          show: isAdmin },
  ].filter(t => t.show)

  // Map visual tab index back to logical slot
  const tabSlot = (visual: number) => {
    const labels = ['Knowledge Base', 'Ask SAI', 'Operational Intelligence', 'History',
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
        {tabSlot(tab) === 'Ask SAI'                  && <AskSAITab />}
        {tabSlot(tab) === 'Operational Intelligence'  && <OperationalIntelligenceTab />}
        {tabSlot(tab) === 'History'                  && <HistoryTab />}
        {tabSlot(tab) === 'AI Debug'                 && canDebug && <AIDebugTab />}
        {tabSlot(tab) === 'Open Questions'           && isAdmin  && <OpenQuestionsTab />}
      </Box>
    </Box>
  )
}
