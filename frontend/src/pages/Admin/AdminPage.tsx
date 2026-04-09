import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, TextField,
  Tabs, Tab, Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Divider, Paper, IconButton, Tooltip, LinearProgress,
  CircularProgress, alpha, Accordion, AccordionSummary, AccordionDetails,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Checkbox, FormControlLabel, List, ListItem,
} from '@mui/material'
import {
  SearchOutlined, AutoAwesomeOutlined,
  DeleteOutlined, ClearOutlined, TableChartOutlined,
  AccountTreeOutlined, LinkOutlined, DataObjectOutlined,
  EmailOutlined, SaveOutlined, QuizOutlined, EditOutlined,
  ExpandMoreOutlined, CheckCircleOutlined, WarningOutlined,
  KeyOutlined, BarChartOutlined, SchemaOutlined, ContentCopyOutlined,
  VisibilityOutlined, GridOnOutlined,
  FileUploadOutlined, FileDownloadOutlined, SmartToyOutlined,
  SendOutlined, CloseOutlined, InfoOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import { adminApi, queryApi, psApi } from '@/api'
import type { Catalog } from '@/types'

// ─── SSE helpers ──────────────────────────────────────────────────────────────
interface SseLine { type: string; msg: string }

async function streamPost(
  url: string,
  body: unknown,
  onEvent: (evt: SseLine) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const docUploadRef    = useRef<HTMLInputElement>(null)

  const [editMap, setEditMap] = useState<Record<string, EditRow>>({})
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())

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

  const handleSave = () => {
    const colMap: Record<string, any> = {}
    ;(metaList as any[]).forEach((m: any) => { colMap[`${m.table_name}|${m.column_name}`] = m })
    const rows = Object.entries(editMap).map(([key, edits]) => {
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
    saveMutation.mutate({ rows })
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

  const handleTableSelectionConfirm = () => {
    if (selectedTables.size === 0) return
    const tableList = Array.from(selectedTables).join(', ')
    setSelectionPhase(false)
    sendAiMessage(
      `The following tables are most commonly used by our business users for reporting and queries: ${tableList}.\n\n` +
      `Please focus metadata enrichment on these tables only. Identify which columns have missing or low-confidence metadata ` +
      `(no description, no synonyms, no business context) and start asking me targeted business questions — ` +
      `one table at a time, starting with the one that has the most gaps.`
    )
    // Auto-expand the selected tables in the editor
    setExpandedTables((prev) => { const next = new Set(prev); selectedTables.forEach((t) => next.add(t)); return next })
  }

  if (isLoading) return <LinearProgress />

  // Group by table
  const byTable: Record<string, any[]> = {}
  ;(metaList as any[]).forEach((m: any) => {
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
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                  {table}
                </Typography>
                <Chip label={`${cols.length} cols`} size="small" sx={{ height: 18, fontSize: '0.625rem' }} />
                {lowConf > 0 && (
                  <Chip label={`${lowConf} no metadata`} size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />
                )}
                {partConf > 0 && (
                  <Chip label={`${partConf} partial`} size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />
                )}
                {lowConf === 0 && partConf === 0 && (
                  <Chip label="complete" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.625rem' }} />
                )}
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
                const cols     = byTable[t]
                const zeroConf = cols.filter((c: any) => _confidence(c) === 0).length
                return (
                  <ListItem key={t} disablePadding sx={{ py: 0.25 }}>
                    <FormControlLabel
                      sx={{ width: '100%', m: 0 }}
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
                              sx={{ height: 16, fontSize: '0.6rem', ml: 'auto' }} />
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
            onClick={handleSave} disabled={saveMutation.isPending || Object.keys(editMap).length === 0}
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
            accept="*"
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
                <Box sx={{ flex: 1, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                  <List dense disablePadding>
                    {tableNames.map((t) => {
                      const cols     = byTable[t]
                      const zeroConf = cols.filter((c: any) => _confidence(c) === 0).length
                      return (
                        <ListItem key={t} disablePadding sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                          <FormControlLabel
                            sx={{ width: '100%', m: 0, px: 2, py: 0.75 }}
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
                                {zeroConf > 0 && <Chip label={`${zeroConf} missing`} size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: '0.625rem', ml: 'auto' }} />}
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const { enqueueSnackbar } = useSnackbar()
  const logRef = useRef<HTMLDivElement>(null)

  const [mainTab, setMainTab] = useState(0)
  const [connId, setConnId] = useState<number | ''>('')
  const [openAiKey, setOpenAiKey] = useState('')
  const [logLines, setLogLines] = useState<SseLine[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [catalogTab, setCatalogTab] = useState(0)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [showMetadata, setShowMetadata] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [queryContext, setQueryContext] = useState('')
  const [contextConnId, setContextConnId] = useState<number | ''>('')

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

  // Discover schema (POST + SSE stream)
  const startDiscovery = async () => {
    if (!connId) { enqueueSnackbar('Select a connection first', { variant: 'warning' }); return }
    setLogLines([])
    setCatalog(null)
    setIsDiscovering(true)
    appendLog({ type: 'info', msg: '⏳ Starting schema discovery…' })
    try {
      await streamPost(`/api/admin/discover/${connId}`, null, (evt) => {
        appendLog(evt)
      })
      enqueueSnackbar('Schema discovery complete', { variant: 'success' })
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
  const startEmbedding = async () => {
    if (!connId) { enqueueSnackbar('Select a connection first', { variant: 'warning' }); return }
    const key = openAiKey.trim()
    if (!key && !keyStatus?.configured) {
      enqueueSnackbar('Enter an OpenAI API key (or set OPENAI_API_KEY in .env)', { variant: 'warning' })
      return
    }
    setLogLines([])
    setIsEmbedding(true)
    appendLog({ type: 'info', msg: '⏳ Starting embedding generation…' })
    try {
      await streamPost(
        `/api/admin/embeddings/${connId}`,
        { api_key: key, model: 'text-embedding-3-small', chat_model: 'gpt-4o-mini' },
        (evt) => appendLog(evt),
      )
      enqueueSnackbar('Embeddings generated', { variant: 'success' })
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
      </Tabs>

      {/* ── Schema Tools ── */}
      {mainTab === 0 && (
        <Grid container spacing={3}>

          {/* ── Left column: actions ── */}
          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Connection selector */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="overline" fontWeight={700} color="text.secondary" sx={{ fontSize: '0.688rem', display: 'block', mb: 1.5 }}>
                    Data Source
                  </Typography>
                  <ConnectionSelector
                    value={connId}
                    onChange={(_, id) => { setConnId(id); setCatalog(null); setLogLines([]); setShowMetadata(false) }}
                    sx={{ width: '100%' }}
                  />
                </CardContent>
              </Card>

              {/* Schema Discovery */}
              <Card variant="outlined" sx={{ borderRadius: 2, borderColor: (t) => alpha(t.palette.primary.main, 0.3) }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <SchemaOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
                    </Box>
                    <Typography variant="subtitle2" fontWeight={700}>Schema Discovery</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    Scan tables, columns, relations and sample rows from the selected data source.
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Button
                      variant="contained"
                      fullWidth
                      startIcon={isDiscovering ? <CircularProgress size={15} color="inherit" /> : <SearchOutlined />}
                      onClick={startDiscovery}
                      disabled={!connId || isDiscovering}
                      sx={{ borderRadius: 1.5 }}
                    >
                      {isDiscovering ? 'Collecting…' : 'Collect Schema'}
                    </Button>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="outlined"
                        fullWidth
                        size="small"
                        startIcon={viewCatalog.isPending ? <CircularProgress size={13} /> : <TableChartOutlined />}
                        onClick={() => viewCatalog.mutate()}
                        disabled={!connId || viewCatalog.isPending}
                        sx={{ borderRadius: 1.5 }}
                      >
                        View Catalog
                      </Button>
                      <Button
                        variant="outlined"
                        fullWidth
                        size="small"
                        color="error"
                        startIcon={<ClearOutlined />}
                        onClick={() => setClearConfirmOpen(true)}
                        disabled={!connId || clearMutation.isPending}
                        sx={{ borderRadius: 1.5 }}
                      >
                        Clear
                      </Button>
                    </Box>
                    <Button
                      variant="outlined"
                      fullWidth
                      size="small"
                      startIcon={<EditOutlined />}
                      onClick={() => setShowMetadata((v) => !v)}
                      disabled={!connId}
                      sx={{ borderRadius: 1.5 }}
                    >
                      Edit Metadata
                    </Button>
                  </Box>
                </CardContent>
              </Card>

              {/* AI Embeddings */}
              <Card variant="outlined" sx={{ borderRadius: 2, borderColor: (t) => alpha(t.palette.secondary.main, 0.3) }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.secondary.main, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AutoAwesomeOutlined sx={{ fontSize: 16, color: 'secondary.main' }} />
                    </Box>
                    <Typography variant="subtitle2" fontWeight={700}>AI Embeddings</Typography>
                    {keyStatus?.configured && (
                      <Chip icon={<CheckCircleOutlined />} label="Key loaded" color="success" size="small" variant="outlined" sx={{ ml: 'auto', height: 20, fontSize: '0.625rem' }} />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    Generate semantic vectors for schema-aware AI queries. Requires OpenAI key.
                  </Typography>
                  {!keyStatus?.configured && (
                    <TextField
                      label="OpenAI API Key"
                      value={openAiKey}
                      onChange={(e) => setOpenAiKey(e.target.value)}
                      size="small"
                      type="password"
                      fullWidth
                      placeholder="sk-…"
                      sx={{ mb: 1.5 }}
                    />
                  )}
                  <Button
                    variant="contained"
                    color="secondary"
                    fullWidth
                    startIcon={isEmbedding ? <CircularProgress size={15} color="inherit" /> : <AutoAwesomeOutlined />}
                    onClick={startEmbedding}
                    disabled={!connId || isEmbedding}
                    sx={{ borderRadius: 1.5 }}
                  >
                    {isEmbedding ? 'Embedding…' : 'Generate Embeddings'}
                  </Button>
                </CardContent>
              </Card>
            </Box>
          </Grid>

          {/* ── Right column: log + catalog ── */}
          <Grid item xs={12} md={8}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Discovery log */}
              {logLines.length > 0 && (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: (isDiscovering || isEmbedding) ? '#10b981' : '#475569', mr: 1,
                        animation: (isDiscovering || isEmbedding) ? 'pulse 1.5s infinite' : 'none',
                        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
                      }} />
                      <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
                        {(isDiscovering || isEmbedding) ? 'Running…' : 'Completed'}
                      </Typography>
                      <IconButton size="small" onClick={() => setLogLines([])}>
                        <ClearOutlined sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                    <Box
                      ref={logRef}
                      sx={{
                        height: 200, overflow: 'auto', p: 1.5, borderRadius: 1.5,
                        bgcolor: '#0d1117', border: '1px solid', borderColor: alpha('#60a5fa', 0.15),
                      }}
                    >
                      {logLines.map((line, i) => <LogLine key={i} {...line} />)}
                      {(isDiscovering || isEmbedding) && (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: '#60a5fa', mt: 1 }}>
                          <CircularProgress size={10} color="inherit" />
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#60a5fa' }}>
                            {isDiscovering ? 'Discovering schema…' : 'Generating embeddings…'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              )}

              {/* Metadata Editor (inline) */}
              {showMetadata && connId && (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2.5 }}>
                    <MetadataEditor connId={connId as number} onClose={() => setShowMetadata(false)} />
                  </CardContent>
                </Card>
              )}

              {/* Catalog viewer */}
              {catalog && !showMetadata && (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2 }}>
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
                </CardContent>
              </Card>
              )}

            </Box>
          </Grid>

        </Grid>
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

      {/* ── Query Context ── */}
      {mainTab === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={700} gutterBottom>Query Context</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Write any context the AI should know when generating SQL queries for this connection.
                  Supports Markdown. Example: table descriptions, business rules, common joins.
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'flex-end' }}>
                  <ConnectionSelector
                    value={contextConnId}
                    onChange={(_, id) => {
                      setContextConnId(id)
                      if (id) loadContext.mutate()
                    }}
                    sx={{ minWidth: 240 }}
                  />
                  <Button
                    variant="contained"
                    startIcon={<SaveOutlined />}
                    onClick={() => saveContextMutation.mutate()}
                    disabled={!contextConnId || saveContextMutation.isPending}
                  >
                    Save Context
                  </Button>
                </Box>
                <TextField
                  value={queryContext}
                  onChange={(e) => setQueryContext(e.target.value)}
                  multiline
                  rows={16}
                  fullWidth
                  placeholder={`# Database Context\n\n## Tables\n- dbo.Employees: Contains employee records. EmployeeId is the primary key.\n- dbo.Departments: Department list. DeptCode links to Employees.DeptCode.\n\n## Business Rules\n- Active employees have Status = 'A'`}
                  sx={{
                    '& .MuiInputBase-root': {
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
                    },
                  }}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* ── Email Settings ── */}
      {mainTab === 2 && (
        <Grid container spacing={3} justifyContent="center">
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <EmailOutlined color="primary" />
                  <Typography variant="h6" fontWeight={700}>SMTP Configuration</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={8}>
                      <TextField label="SMTP Host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} fullWidth />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField label="Port" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} fullWidth />
                    </Grid>
                  </Grid>
                  <TextField label="Username" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} fullWidth />
                  <TextField label="Password" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} fullWidth />
                  <TextField label="From Address" value={fromAddr} onChange={(e) => setFromAddr(e.target.value)} fullWidth />
                  <Divider />
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant="outlined"
                      fullWidth
                      startIcon={testEmailMutation.isPending ? <CircularProgress size={14} /> : <EmailOutlined />}
                      onClick={() => testEmailMutation.mutate()}
                      disabled={!fromAddr || testEmailMutation.isPending}
                    >
                      Send Test Email
                    </Button>
                    <Button
                      variant="contained"
                      fullWidth
                      startIcon={saveEmailMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                      onClick={() => saveEmailMutation.mutate()}
                      disabled={saveEmailMutation.isPending}
                    >
                      Save Settings
                    </Button>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  )
}
