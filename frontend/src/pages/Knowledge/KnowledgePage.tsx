import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box, Typography, Tabs, Tab, Paper, Table, TableHead, TableBody,
  TableRow, TableCell, TableContainer, Button, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, Select,
  MenuItem, FormControl, InputLabel, Chip, CircularProgress, Alert,
  Stack, Autocomplete, Tooltip, Badge, LinearProgress, Accordion,
  AccordionSummary, AccordionDetails, ToggleButtonGroup, ToggleButton,
  alpha, Collapse,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, SendOutlined, AutoAwesomeOutlined,
  RefreshOutlined, ExpandMoreOutlined, WarningAmberOutlined,
  CheckCircleOutlined, HourglassEmptyOutlined,
  AttachFileOutlined, LinkOutlined, CloudDownloadOutlined,
  BugReportOutlined, HistoryOutlined, ExpandLessOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { knowledgeApi, adminApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import AIDebugPanel from '@/components/ai/AIDebugPanel'
import {
  KNOWLEDGE_ALLOWED_TAGS,
  type KnowledgeEntry, type KnowledgeEntryCreate,
  type OpenQuestion, type AskSAIResult, type AskSAIAnswered,
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

// ── Entry form dialog ─────────────────────────────────────────────────────────

interface EntryFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: KnowledgeEntryCreate, skipDup: boolean) => void
  loading: boolean
  dupId: number | null
  prefillTitle?: string
}

function EntryFormDialog({ open, onClose, onSubmit, loading, dupId, prefillTitle }: EntryFormProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [title,        setTitle]      = useState(prefillTitle || '')
  const [type,         setType]       = useState<KnowledgeEntryType>('UseCase')
  const [system,       setSystem]     = useState<KnowledgeSystemType>('DCT')
  const [tags,         setTags]       = useState<string[]>([])
  const [sourceType,   setSourceType] = useState<KnowledgeSourceType>('Text')
  const [content,      setContent]    = useState('')
  const [skipDup,      setSkipDup]    = useState(false)
  const [urlInput,     setUrlInput]   = useState('')
  const [attachedFile, setAttached]   = useState<string>('')  // display name
  const [fetching,     setFetching]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle(prefillTitle || '')
      setType('UseCase')
      setSystem('DCT')
      setTags([])
      setSourceType('Text')
      setContent('')
      setSkipDup(false)
      setUrlInput('')
      setAttached('')
    }
  }, [open, prefillTitle])

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
        {prefillTitle ? 'Answer Question (Full KB Entry)' : 'Add Knowledge Entry'}
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
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!valid || loading || fetching || (dupId !== null && !skipDup)}
          onClick={() => onSubmit({ title, type, system, tags, source_type: sourceType, raw_content: content }, skipDup)}
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

      <EntryFormDialog
        open={addOpen}
        onClose={() => { setAddOpen(false); setDupId(null) }}
        onSubmit={(data, skip) => addMutation.mutate({ data, skip })}
        loading={addMutation.isPending}
        dupId={dupId}
      />
    </Box>
  )
}

// ── Tab 1: Ask SAI ────────────────────────────────────────────────────────────

const CHAT_STORAGE_KEY = 'sai-chat-history'

interface Message {
  role: 'user' | 'assistant'
  content: string | AskSAIResult
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function buildContextualQuery(question: string, history: Message[]): string {
  // Include the last 2 answered Q&A pairs so follow-up questions carry context
  const answered = history.filter(m => m.role === 'user') .slice(-2)
  if (answered.length === 0) return question
  const ctx = answered.map(m => `- ${m.content as string}`).join('\n')
  return `Context from this conversation:\n${ctx}\n\nQuestion: ${question}`
}

function AskSAITab() {
  const { enqueueSnackbar } = useSnackbar()
  const user          = useAppStore(s => s.user)
  const activeProject = useAppStore(s => s.activeProject)
  const [messages,  setMessages] = useState<Message[]>(loadMessages)
  const [inputText, setInput]    = useState('')
  const [isLoading, setLoading]  = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Persist to localStorage whenever messages change
  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function handleSend() {
    const q = inputText.trim()
    if (!q || isLoading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setLoading(true)
    try {
      const contextualQ = buildContextualQuery(q, messages)
      const result = await knowledgeApi.ask({
        question:   contextualQ,
        asked_by:   user?.username,
        project_id: activeProject?.id,
      })
      setMessages(prev => [...prev, { role: 'assistant', content: result }])
    } catch {
      enqueueSnackbar('Ask SAI request failed.', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 600 }}>
      {/* Message list */}
      <Box
        ref={scrollRef}
        sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {messages.length === 0 && (
          <Box sx={{ m: 'auto', textAlign: 'center', color: 'text.secondary' }}>
            <AutoAwesomeOutlined sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
            <Typography>Ask SAI anything about the knowledge base.</Typography>
          </Box>
        )}
        {messages.map((msg, i) => (
          <Box key={i} sx={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'user' ? (
              <Paper sx={{ px: 2, py: 1, maxWidth: '70%', bgcolor: 'primary.main', color: '#fff', borderRadius: 2 }}>
                <Typography variant="body2">{msg.content as string}</Typography>
              </Paper>
            ) : (
              <Box sx={{ maxWidth: '80%' }}>
                <AssistantBubble result={msg.content as AskSAIResult} />
              </Box>
            )}
          </Box>
        ))}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
            <Paper sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
              <CircularProgress size={16} />
            </Paper>
          </Box>
        )}
      </Box>

      {/* Input row */}
      <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          fullWidth size="small" placeholder="Ask a question…"
          value={inputText}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          disabled={isLoading}
        />
        <IconButton color="primary" onClick={handleSend} disabled={isLoading || !inputText.trim()}>
          <SendOutlined />
        </IconButton>
        {messages.length > 0 && (
          <Tooltip title="Clear chat history">
            <IconButton size="small" onClick={() => { setMessages([]); localStorage.removeItem(CHAT_STORAGE_KEY) }}>
              <DeleteOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
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

function AssistantBubble({ result }: { result: AskSAIResult }) {
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

  const [statusFilter, setStatusFilter] = useState('open')
  const [quickId,      setQuickId]      = useState<number | null>(null)
  const [quickText,    setQuickText]    = useState('')
  const [answerQ,      setAnswerQ]      = useState<OpenQuestion | null>(null)
  const [dupId,        setDupId]        = useState<number | null>(null)

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
        {['open', 'quick_answered', 'resolved', 'dismissed', 'all'].map(s => (
          <ToggleButton key={s} value={s} sx={{ textTransform: 'capitalize', px: 2 }}>
            {s === 'quick_answered' ? 'Quick Answered' : s}
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
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Tooltip title={q.question} placement="top-start">
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {q.question.slice(0, 80)}{q.question.length > 80 ? '…' : ''}
                      </Typography>
                    </Tooltip>
                    {q.resolution_text && (
                      <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.25 }}>
                        ✓ {q.resolution_text.slice(0, 80)}
                      </Typography>
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
                      label={q.status === 'quick_answered' ? 'Quick Answered' : q.status}
                      size="small"
                      color={q.status === 'open' ? 'warning' : q.status === 'resolved' ? 'success' : 'default'}
                      sx={q.status === 'quick_answered' ? { bgcolor: '#f59e0b', color: '#fff' } : undefined}
                    />
                  </TableCell>
                  <TableCell>
                    {canWrite && (q.status === 'open' || q.status === 'quick_answered') ? (
                      <Stack direction="row" spacing={0.5}>
                        {q.status === 'open' && (
                          <Tooltip title="Quick Answer — partial, does not close the question">
                            <Button size="small" variant="outlined" onClick={() => { setQuickId(q.id); setQuickText('') }}>
                              Quick Answer
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip title="Full Answer (creates KB entry and closes question)">
                          <Button size="small" variant="outlined" color="primary" onClick={() => { setAnswerQ(q); setDupId(null) }}>
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

      {/* Full answer dialog */}
      <EntryFormDialog
        open={answerQ !== null}
        onClose={() => { setAnswerQ(null); setDupId(null) }}
        onSubmit={(data, skip) => resolveMutation.mutate({ id: answerQ!.id, data, skip })}
        loading={resolveMutation.isPending}
        dupId={dupId}
        prefillTitle={answerQ?.question.slice(0, 100)}
      />
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
    { label: 'Knowledge Base',  show: true },
    { label: 'Ask SAI',         show: true },
    { label: 'History',         show: true,      icon: <HistoryOutlined sx={{ fontSize: 16 }} /> },
    { label: 'AI Debug',        show: canDebug,  icon: <BugReportOutlined sx={{ fontSize: 16 }} /> },
    { label: 'Open Questions',  show: isAdmin },
  ].filter(t => t.show)

  // Map visual tab index back to logical slot
  const tabSlot = (visual: number) => {
    const labels = ['Knowledge Base', 'Ask SAI', 'History',
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
        {tabSlot(tab) === 'Knowledge Base'  && <KnowledgeBaseTab />}
        {tabSlot(tab) === 'Ask SAI'         && <AskSAITab />}
        {tabSlot(tab) === 'History'         && <HistoryTab />}
        {tabSlot(tab) === 'AI Debug'        && canDebug && <AIDebugTab />}
        {tabSlot(tab) === 'Open Questions'  && isAdmin  && <OpenQuestionsTab />}
      </Box>
    </Box>
  )
}
