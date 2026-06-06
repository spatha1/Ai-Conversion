import { useState, useRef, useEffect } from 'react'
import { uuid } from '@/utils/uuid'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box, Typography, Paper, TextField, Button, CircularProgress,
  Stack, Chip, LinearProgress, Alert, Divider, List, ListItemButton,
  Tooltip, IconButton, Badge, Menu, MenuItem, ListItemIcon, ListItemText,
  Collapse,
} from '@mui/material'
import {
  SendOutlined, AutoAwesomeOutlined, HourglassEmptyOutlined,
  DownloadOutlined, PrintOutlined, ContentCopyOutlined,
  ArticleOutlined, DeleteOutlined, AccessTimeOutlined,
  AddOutlined, EditOutlined, PublicOutlined, FilterAltOutlined,
  FolderCopyOutlined, InsertDriveFileOutlined, ExpandMore, ChevronRight,
} from '@mui/icons-material'
import { useSnackbar } from 'notistack'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { knowledgeApi, documentsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type { AskSAIResult, AskSAIAnswered, AskSAIUnanswered, KnowledgeSchema, AfsFolder, AfsFile, DocumentsScope } from '@/types'
import OperationalDecisionCard from '@/components/knowledge/OperationalDecisionCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface QARecord {
  id:        string
  question:  string
  result:    AskSAIResult
  timestamp: string
}

interface Session {
  id:        string
  name:      string
  createdAt: string
  updatedAt: string
  records:   QARecord[]  // oldest first — append new records at the end
}

// ── Storage ───────────────────────────────────────────────────────────────────

const SESSIONS_KEY = 'sai-sessions'
const LEGACY_KEY   = 'sai-doc-history'

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) return JSON.parse(raw)
    // one-time migration from old flat history format
    const old = localStorage.getItem(LEGACY_KEY)
    if (old) {
      const records: QARecord[] = JSON.parse(old)
      if (records.length > 0) {
        const session: Session = {
          id:        uuid(),
          name:      (records[records.length - 1].question || 'Imported Session').slice(0, 45),
          createdAt: records[records.length - 1].timestamp,
          updatedAt: records[0].timestamp,
          records:   [...records].reverse(),  // old format was newest-first
        }
        return [session]
      }
    }
    return []
  } catch { return [] }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 30)))
}

function makeSession(): Session {
  const now = new Date().toISOString()
  return { id: uuid(), name: 'New Session', createdAt: now, updatedAt: now, records: [] }
}

// ── Excel export ──────────────────────────────────────────────────────────────

function exportToExcel(records: QARecord[], sessionName = 'Ask SAI') {
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
        'Model':       a.debug?.model ?? '',
        'Tokens In':   a.debug?.tokens_in ?? '',
        'Tokens Out':  a.debug?.tokens_out ?? '',
        'Latency (ms)': a.debug?.latency_ms ?? '',
        'Timestamp':   new Date(r.timestamp).toLocaleString(),
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
  ws['!cols'] = [
    { wch: 50 }, { wch: 12 }, { wch: 80 }, { wch: 40 }, { wch: 12 },
    { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 22 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ask SAI')
  XLSX.writeFile(wb, `ask-sai-${sessionName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`)
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

// ── Document answer renderer ──────────────────────────────────────────────────

function DocumentAnswer({ record }: { record: QARecord }) {
  const { enqueueSnackbar } = useSnackbar()
  const result = record.result

  const handleCopy = () => {
    const text = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
    navigator.clipboard.writeText(text).then(() => enqueueSnackbar('Copied to clipboard', { variant: 'success' }))
  }

  const handlePrint = () => {
    const answer = result.status === 'ANSWERED' ? (result as AskSAIAnswered).answer : ''
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head>
      <title>SAI Document</title>
      <style>
        body{font-family:'Segoe UI',sans-serif;padding:48px 64px;max-width:860px;margin:auto;color:#111;font-size:14px;line-height:1.7}
        .header{border-bottom:2px solid #4f46e5;padding-bottom:16px;margin-bottom:28px}
        .label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600}
        .question{font-size:18px;font-weight:700;color:#111;margin:8px 0 4px}
        .meta{font-size:12px;color:#9ca3af;margin-bottom:0}
        h2{color:#4f46e5;font-size:15px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-top:24px}
        h3{font-size:14px;margin-top:16px}
        pre,code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:12px;font-family:monospace}
        pre{padding:12px;white-space:pre-wrap;display:block}
        ul,ol{padding-left:20px}
        @media print{body{padding:24px}}
      </style>
    </head><body>
      <div class="header">
        <div class="label">SAI Knowledge Query</div>
        <div class="question">${record.question.replace(/</g,'&lt;')}</div>
        <div class="meta">${new Date(record.timestamp).toLocaleString()}</div>
      </div>
      <div id="content"></div>
      <script>
        document.getElementById('content').innerHTML=${JSON.stringify(
          answer
            .replace(/## (.*)/g,'<h2>$1</h2>')
            .replace(/### (.*)/g,'<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
            .replace(/`([^`]+)`/g,'<code>$1</code>')
            .replace(/\n/g,'<br>')
        )};
        window.onload=()=>{window.print();window.close();}
      </script>
    </body></html>`)
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
  const avgConfidence = answered.sources.length
    ? (answered.sources.reduce((s, x) => s + x.score, 0) / answered.sources.length * 100).toFixed(0)
    : null

  return (
    <Box>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        {avgConfidence && (
          <Chip size="small" label={`${avgConfidence}% confidence`}
            sx={{ bgcolor: parseInt(avgConfidence) >= 70 ? tokens.emerald600 : tokens.amber500, color: '#fff', fontWeight: 600, fontSize: '0.72rem' }} />
        )}
        {answered.debug?.model && (
          <Chip size="small" label={answered.debug.model} variant="outlined" sx={{ fontSize: '0.7rem' }} />
        )}
        {answered.debug && (
          <Chip size="small" label={`${answered.debug.tokens_in + answered.debug.tokens_out} tokens · ${answered.debug.latency_ms}ms`} variant="outlined" sx={{ fontSize: '0.7rem' }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Copy answer">
          <IconButton size="small" onClick={handleCopy}><ContentCopyOutlined sx={{ fontSize: 16 }} /></IconButton>
        </Tooltip>
        <Tooltip title="Print document">
          <IconButton size="small" onClick={handlePrint}><PrintOutlined sx={{ fontSize: 16 }} /></IconButton>
        </Tooltip>
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
            h3: ({ children }) => (
              <Typography variant="body1" fontWeight={700} sx={{ mt: 1.5, mb: 0.5 }}>{children}</Typography>
            ),
            p: ({ children }) => (
              <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.75 }}>{children}</Typography>
            ),
            ul: ({ children }) => (
              <Box component="ul" sx={{ pl: 3, my: 0.75, '& li': { mb: 0.5 } }}>{children}</Box>
            ),
            ol: ({ children }) => (
              <Box component="ol" sx={{ pl: 3, my: 0.75, '& li': { mb: 0.5 } }}>{children}</Box>
            ),
            li: ({ children }) => (
              <Typography component="li" variant="body2" sx={{ lineHeight: 1.65 }}>{children}</Typography>
            ),
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
            pre: ({ children }) => {
              let rawText = ''
              let lang = ''
              try {
                const child = (children as any)?.props
                rawText = String(child?.children ?? '')
                lang = (child?.className ?? '').replace('language-', '')
              } catch { /* ignore */ }
              return (
                <Box sx={{ position: 'relative', my: 1 }}>
                  {lang && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                               bgcolor: 'action.selected', px: 1.5, py: 0.5, borderRadius: '4px 4px 0 0',
                               borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Typography sx={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'text.secondary', textTransform: 'uppercase' }}>
                        {lang}
                      </Typography>
                      <Tooltip title="Copy">
                        <IconButton size="small" onClick={() => navigator.clipboard?.writeText(rawText)}>
                          <ContentCopyOutlined sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                  <Box component="pre" sx={{
                    bgcolor: 'action.hover', p: 1.5, borderRadius: lang ? '0 0 4px 4px' : 1,
                    overflowX: 'auto', fontSize: '0.78rem', fontFamily: 'monospace', my: 0,
                  }}>
                    {children}
                  </Box>
                </Box>
              )
            },
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

      {/* Sources */}
      {answered.sources.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            References ({answered.sources.length})
          </Typography>
          <Stack spacing={0.75} mt={0.75}>
            {answered.sources.map((s, idx) => (
              <Box key={s.chunk_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.disabled" sx={{ minWidth: 18 }}>[{idx + 1}]</Typography>
                <Chip label={s.entry_system} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                {(s as any).kb_schema_id && (
                  <Chip
                    label={(s as any).kb_schema_name ?? `Schema ${(s as any).kb_schema_id}`}
                    size="small"
                    sx={{ fontSize: 10, height: 20, bgcolor: (s as any).schema_color ?? '#6366f1', color: '#fff' }}
                  />
                )}
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AskSAIPage() {
  const { enqueueSnackbar } = useSnackbar()
  const user          = useAppStore(s => s.user)
  const activeProject = useAppStore(s => s.activeProject)

  const [sessions,   setSessions]   = useState<Session[]>(() => {
    const s = loadSessions()
    return s.length > 0 ? s : [makeSession()]
  })
  const [activeId,   setActiveId]   = useState<string>(() => {
    const s = loadSessions()
    return s.length > 0 ? s[0].id : ''
  })
  const [renamingId,      setRenamingId]      = useState<string | null>(null)
  const [renameText,      setRenameText]      = useState('')
  const [inputText,       setInput]           = useState('')
  const [isLoading,       setLoading]         = useState(false)
  const [selectedSchemaId, setSelectedSchemaId] = useState<number | null>(null)
  const [schemaMenuAnchor, setSchemaMenuAnchor] = useState<null | HTMLElement>(null)

  // Scope selector state
  const [scopeExpanded,   setScopeExpanded]   = useState(false)
  const [docsScope,       setDocsScope]       = useState<DocumentsScope>('kb')
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [selectedFileIds,   setSelectedFileIds]   = useState<number[]>([])
  const [scopeFolderOpen,   setScopeFolderOpen]   = useState<number | null>(null)

  const { data: schemas = [] } = useQuery<KnowledgeSchema[]>({
    queryKey: ['knowledge-schemas'],
    queryFn:  () => knowledgeApi.listSchemas(),
    staleTime: 60_000,
  })

  const { data: allFolders = [] } = useQuery<AfsFolder[]>({
    queryKey: ['afs-folders'],
    queryFn:  () => documentsApi.getFolders(),
    staleTime: 30_000,
    enabled: scopeExpanded,
  })

  const { data: scopeFolderFiles = [] } = useQuery<AfsFile[]>({
    queryKey: ['afs-files', scopeFolderOpen],
    queryFn:  () => scopeFolderOpen ? documentsApi.getFolderFiles(scopeFolderOpen) : Promise.resolve([]),
    enabled: !!scopeFolderOpen,
  })

  const selectedSchema = schemas.find(s => s.id === selectedSchemaId) ?? null

  function toggleFolderId(id: number) {
    setSelectedFolderIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleFileId(id: number) {
    setSelectedFileIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const inputRef     = useRef<HTMLInputElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0]

  useEffect(() => {
    if (!activeId && sessions.length > 0) setActiveId(sessions[0].id)
  }, [sessions, activeId])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.records.length, isLoading])

  function buildHistoryPayload() {
    const records = activeSession?.records ?? []
    return records.slice(-6).flatMap(r => ([
      { role: 'user',      content: r.question },
      { role: 'assistant', content: r.result.status === 'ANSWERED' ? (r.result as AskSAIAnswered).answer : '' },
    ]))
  }

  function updateSessions(updater: (prev: Session[]) => Session[]) {
    setSessions(prev => {
      const next = updater(prev)
      saveSessions(next)
      return next
    })
  }

  async function handleSend() {
    const q = inputText.trim()
    if (!q || isLoading || !activeSession) return
    setInput('')
    setLoading(true)
    try {
      const result = await knowledgeApi.ask({
        question:   q,
        asked_by:   user?.username,
        project_id: activeProject?.id,
        history:    buildHistoryPayload(),
        schema_id:  selectedSchemaId ?? undefined,
        scope:      docsScope,
        file_ids:   docsScope === 'files' && selectedFileIds.length ? selectedFileIds : undefined,
        folder_ids: docsScope === 'folders' && selectedFolderIds.length ? selectedFolderIds : undefined,
      })
      const record: QARecord = {
        id:        uuid(),
        question:  q,
        result,
        timestamp: new Date().toISOString(),
      }
      updateSessions(prev => prev.map(s => {
        if (s.id !== activeSession.id) return s
        const isFirst = s.records.length === 0
        return {
          ...s,
          name:      isFirst ? q.slice(0, 50) + (q.length > 50 ? '…' : '') : s.name,
          updatedAt: record.timestamp,
          records:   [...s.records, record],
        }
      }))
    } catch {
      enqueueSnackbar('Ask SAI request failed.', { variant: 'error' })
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleNewSession() {
    const s = makeSession()
    updateSessions(prev => [s, ...prev])
    setActiveId(s.id)
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function handleDeleteSession(id: string) {
    updateSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (next.length === 0) {
        const fresh = makeSession()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (activeId === id) setActiveId(next[0].id)
      return next
    })
  }

  function handleRenameStart(id: string, name: string) {
    setRenamingId(id)
    setRenameText(name)
  }

  function handleRenameCommit() {
    if (!renamingId) return
    const name = renameText.trim() || 'Unnamed Session'
    updateSessions(prev => prev.map(s => s.id === renamingId ? { ...s, name } : s))
    setRenamingId(null)
  }

  function handleClearAll() {
    if (!window.confirm('Delete all sessions and start fresh?')) return
    const fresh = makeSession()
    setSessions([fresh])
    setActiveId(fresh.id)
    saveSessions([fresh])
    localStorage.removeItem(LEGACY_KEY)
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: Session sidebar ── */}
      <Box sx={{
        width: 260, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ArticleOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
            <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1, fontSize: '0.8rem' }}>
              Sessions
            </Typography>
            <Badge badgeContent={sessions.length} color="primary" max={99}><Box /></Badge>
            <Tooltip title="New Session (Ctrl+N)">
              <IconButton size="small" onClick={handleNewSession} color="primary"
                sx={{ bgcolor: 'primary.50', '&:hover': { bgcolor: 'primary.100' } }}>
                <AddOutlined sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {/* Session list */}
        <List dense disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map(s => (
            <ListItemButton
              key={s.id}
              selected={s.id === activeId}
              onClick={() => setActiveId(s.id)}
              sx={{ py: 1, px: 1.5, alignItems: 'flex-start',
                '&.Mui-selected': { bgcolor: 'primary.50', borderLeft: '3px solid', borderColor: 'primary.main', pl: '9px' } }}
            >
              <Box sx={{ flex: 1, minWidth: 0, pr: 0.5 }}>
                {renamingId === s.id ? (
                  <TextField
                    size="small"
                    value={renameText}
                    onChange={e => setRenameText(e.target.value)}
                    onBlur={handleRenameCommit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameCommit()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    autoFocus fullWidth
                    inputProps={{ style: { fontSize: '0.75rem', padding: '3px 6px' } }}
                  />
                ) : (
                  <Typography variant="caption" fontWeight={600} noWrap
                    onDoubleClick={e => { e.stopPropagation(); handleRenameStart(s.id, s.name) }}
                    sx={{ display: 'block', fontSize: '0.78rem' }}
                    title={`${s.name} — double-click to rename`}
                  >
                    {s.name}
                  </Typography>
                )}
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', display: 'block', mt: 0.25 }}>
                  {s.records.length} msg{s.records.length !== 1 ? 's' : ''} · {
                    new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
                  }
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.25} alignItems="center" mt={0.5} flexShrink={0}>
                <Tooltip title="Rename">
                  <IconButton size="small" onClick={e => { e.stopPropagation(); handleRenameStart(s.id, s.name) }}
                    sx={{ p: 0.25, opacity: 0.35, '&:hover': { opacity: 1 } }}>
                    <EditOutlined sx={{ fontSize: 12 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete session">
                  <IconButton size="small" onClick={e => { e.stopPropagation(); handleDeleteSession(s.id) }}
                    sx={{ p: 0.25, opacity: 0.35, '&:hover': { opacity: 1, color: 'error.main' } }}>
                    <DeleteOutlined sx={{ fontSize: 12 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </ListItemButton>
          ))}
        </List>

        {/* Footer */}
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
          <Tooltip title="Export active session to Excel">
            <span style={{ flex: 1 }}>
              <Button fullWidth size="small" variant="outlined" startIcon={<DownloadOutlined />}
                disabled={!activeSession?.records.length}
                onClick={() => exportToExcel(activeSession?.records ?? [], activeSession?.name)}
                sx={{ fontSize: '0.7rem' }}>
                Export
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Delete all sessions">
            <IconButton size="small" onClick={handleClearAll} color="error" sx={{ flexShrink: 0 }}>
              <DeleteOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Right: Conversation thread ── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Session name bar */}
        <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
                   bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 1, minHeight: 48 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }} noWrap>
            {activeSession?.name ?? 'No Session'}
          </Typography>
          <Tooltip title="Rename this session">
            <IconButton size="small"
              onClick={() => { if (activeSession) handleRenameStart(activeSession.id, activeSession.name) }}>
              <EditOutlined sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Chip size="small"
            label={`${activeSession?.records.length ?? 0} msg${(activeSession?.records.length ?? 0) !== 1 ? 's' : ''}`}
            variant="outlined" sx={{ fontSize: '0.68rem', height: 22 }} />
        </Box>

        {/* Schema scope banner — only when a schema is selected */}
        {selectedSchema && (
          <Box sx={{
            px: 2, py: 0.75,
            bgcolor: selectedSchema.color_hex + '18',
            borderBottom: '2px solid',
            borderColor: selectedSchema.color_hex,
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: selectedSchema.color_hex, flexShrink: 0 }} />
            <Typography variant="caption" fontWeight={700} sx={{ color: selectedSchema.color_hex }}>
              Searching within: {selectedSchema.name}
            </Typography>
            {selectedSchema.description && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                — {selectedSchema.description}
              </Typography>
            )}
            <Chip
              label="Clear scope"
              size="small"
              onDelete={() => setSelectedSchemaId(null)}
              sx={{ fontSize: '0.65rem', height: 20 }}
            />
          </Box>
        )}

        {/* Thread — oldest record first, newest at bottom */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5 }}>

          {!activeSession?.records.length && !isLoading && (
            <Box sx={{ m: 'auto', textAlign: 'center', color: 'text.secondary', mt: 8 }}>
              <AutoAwesomeOutlined sx={{ fontSize: 56, opacity: 0.12, mb: 2 }} />
              <Typography variant="h6" fontWeight={600} gutterBottom>Start the conversation</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400, mx: 'auto', mb: 3 }}>
                Ask SAI a question. Answers appear here in a continuous thread.
                SAI can generate SQL queries, architecture diagrams, and process flows.
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                {[
                  'Which team owns billing reconciliation failures?',
                  'How does the premium reconciliation process work?',
                  'Write a query to find unprocessed policies in the GL views',
                  'Show the architecture of the DCT conversion pipeline',
                ].map(s => (
                  <Chip key={s} label={s} size="small" variant="outlined" onClick={() => setInput(s)}
                    sx={{ cursor: 'pointer', fontSize: '0.72rem', maxWidth: 260,
                      height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5, lineHeight: 1.4 } }} />
                ))}
              </Stack>
            </Box>
          )}

          {(activeSession?.records ?? []).map(r => (
            <Paper key={r.id} variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Box sx={{ mb: 2 }}>
                <Stack direction="row" alignItems="flex-start" spacing={1} mb={0.5}>
                  <ArticleOutlined sx={{ color: 'primary.main', fontSize: 18, mt: 0.2, flexShrink: 0 }} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1, lineHeight: 1.35 }}>
                    {r.question}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1.5} alignItems="center" ml={3.25}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <AccessTimeOutlined sx={{ fontSize: 12, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">
                      {new Date(r.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </Stack>
                  <Chip size="small" label={r.result.status}
                    sx={{ height: 17, fontSize: '0.62rem', fontWeight: 700,
                      bgcolor: r.result.status === 'ANSWERED' ? tokens.emerald600 : tokens.amber500, color: '#fff' }} />
                </Stack>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <DocumentAnswer record={r} />
            </Paper>
          ))}

          {isLoading && (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
              <CircularProgress size={28} sx={{ mb: 1.5 }} />
              <Typography variant="body2" color="text.secondary">SAI is generating your answer…</Typography>
            </Paper>
          )}

          <div ref={threadEndRef} />
        </Box>

        {/* Input bar */}
        <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          {/* Document scope picker — collapsed by default */}
          <Box sx={{ mb: 1 }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}
              onClick={() => setScopeExpanded(p => !p)}
            >
              {scopeExpanded ? <ExpandMore sx={{ fontSize: 15, color: 'text.secondary' }} /> : <ChevronRight sx={{ fontSize: 15, color: 'text.secondary' }} />}
              <FolderCopyOutlined sx={{ fontSize: 13, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">Document scope</Typography>
              {docsScope !== 'kb' && (
                <Chip
                  size="small"
                  label={docsScope === 'folders' ? `${selectedFolderIds.length} folder(s)` : docsScope === 'files' ? `${selectedFileIds.length} file(s)` : 'All'}
                  color="secondary"
                  sx={{ height: 18, fontSize: '0.62rem', ml: 0.5 }}
                />
              )}
            </Box>
            <Collapse in={scopeExpanded}>
              <Box sx={{ mt: 1, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {([
                    { key: 'kb',      label: 'KB Schema',     icon: <FilterAltOutlined sx={{ fontSize: 13 }} /> },
                    { key: 'folders', label: 'Folder(s)',      icon: <FolderCopyOutlined sx={{ fontSize: 13 }} /> },
                    { key: 'files',   label: 'File(s)',        icon: <InsertDriveFileOutlined sx={{ fontSize: 13 }} /> },
                    { key: 'all',     label: 'All Knowledge',  icon: <PublicOutlined sx={{ fontSize: 13 }} /> },
                  ] as { key: DocumentsScope; label: string; icon: React.ReactNode }[]).map(opt => (
                    <Chip
                      key={opt.key}
                      size="small"
                      icon={opt.icon as any}
                      label={opt.label}
                      onClick={() => { setDocsScope(opt.key); if (opt.key === 'kb' || opt.key === 'all') { setSelectedFolderIds([]); setSelectedFileIds([]) } }}
                      variant={docsScope === opt.key ? 'filled' : 'outlined'}
                      color={docsScope === opt.key ? 'secondary' : 'default'}
                      sx={{ fontSize: '0.7rem', height: 22 }}
                    />
                  ))}
                </Stack>

                {/* Folder picker */}
                {docsScope === 'folders' && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {allFolders.map(f => (
                      <Chip
                        key={f.id}
                        size="small"
                        label={f.name}
                        icon={<FolderCopyOutlined sx={{ fontSize: 12 }} />}
                        onClick={() => toggleFolderId(f.id)}
                        variant={selectedFolderIds.includes(f.id) ? 'filled' : 'outlined'}
                        color={selectedFolderIds.includes(f.id) ? 'secondary' : 'default'}
                        sx={{ fontSize: '0.68rem', height: 20 }}
                      />
                    ))}
                    {allFolders.length === 0 && (
                      <Typography variant="caption" color="text.secondary">No folders yet. Create folders in the Documents page.</Typography>
                    )}
                  </Box>
                )}

                {/* File picker — select folder first */}
                {docsScope === 'files' && (
                  <Box>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mb={0.75}>
                      {allFolders.map(f => (
                        <Chip
                          key={f.id}
                          size="small"
                          label={f.name}
                          icon={<FolderCopyOutlined sx={{ fontSize: 12 }} />}
                          onClick={() => setScopeFolderOpen(scopeFolderOpen === f.id ? null : f.id)}
                          variant={scopeFolderOpen === f.id ? 'filled' : 'outlined'}
                          sx={{ fontSize: '0.68rem', height: 20 }}
                        />
                      ))}
                    </Stack>
                    {scopeFolderOpen && (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {scopeFolderFiles.map(f => (
                          <Chip
                            key={f.id}
                            size="small"
                            label={f.filename}
                            icon={<InsertDriveFileOutlined sx={{ fontSize: 12 }} />}
                            onClick={() => toggleFileId(f.id)}
                            variant={selectedFileIds.includes(f.id) ? 'filled' : 'outlined'}
                            color={selectedFileIds.includes(f.id) ? 'secondary' : 'default'}
                            sx={{ fontSize: '0.68rem', height: 20 }}
                          />
                        ))}
                        {scopeFolderFiles.length === 0 && (
                          <Typography variant="caption" color="text.secondary">No files in this folder.</Typography>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            </Collapse>
          </Box>

          {/* Schema scope picker row */}
          {schemas.length > 0 && (
            <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <FilterAltOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Knowledge scope:</Typography>
              <Chip
                size="small"
                icon={<PublicOutlined sx={{ fontSize: 13 }} />}
                label="All Knowledge"
                onClick={() => setSelectedSchemaId(null)}
                variant={selectedSchemaId === null ? 'filled' : 'outlined'}
                color={selectedSchemaId === null ? 'primary' : 'default'}
                sx={{ fontSize: '0.7rem', height: 22 }}
              />
              {schemas.map(schema => (
                <Chip
                  key={schema.id}
                  size="small"
                  icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: schema.color_hex, ml: '6px !important', mr: '-2px !important', flexShrink: 0 }} />}
                  label={schema.name}
                  onClick={() => setSelectedSchemaId(schema.id)}
                  variant={selectedSchemaId === schema.id ? 'filled' : 'outlined'}
                  sx={{
                    fontSize: '0.7rem', height: 22,
                    ...(selectedSchemaId === schema.id ? {
                      bgcolor: schema.color_hex, color: '#fff',
                      '& .MuiChip-icon': { color: '#fff' },
                    } : {
                      borderColor: schema.color_hex + '60',
                      '&:hover': { bgcolor: schema.color_hex + '15' },
                    }),
                  }}
                />
              ))}
            </Box>
          )}

          <Stack direction="row" spacing={1} alignItems="flex-start">
            <AutoAwesomeOutlined sx={{ color: 'primary.main', mt: 1, fontSize: 20 }} />
            <TextField
              inputRef={inputRef}
              fullWidth multiline maxRows={4} size="small"
              placeholder="Ask about processes, SQL queries, architecture, or flows — SAI answers in context of the full session…"
              value={inputText}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={isLoading}
            />
            <Tooltip title="Send (Enter)">
              <span>
                <Button variant="contained" onClick={handleSend}
                  disabled={isLoading || !inputText.trim()}
                  sx={{ mt: 0.25, minWidth: 44, px: 1.5 }}>
                  {isLoading ? <CircularProgress size={18} color="inherit" /> : <SendOutlined />}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Box>

        {/* Schema dropdown menu (unused — kept for extensibility) */}
        <Menu anchorEl={schemaMenuAnchor} open={Boolean(schemaMenuAnchor)} onClose={() => setSchemaMenuAnchor(null)}>
          <MenuItem onClick={() => { setSelectedSchemaId(null); setSchemaMenuAnchor(null) }}>
            <ListItemIcon><PublicOutlined fontSize="small" /></ListItemIcon>
            <ListItemText>All Knowledge</ListItemText>
          </MenuItem>
          {schemas.map(s => (
            <MenuItem key={s.id} onClick={() => { setSelectedSchemaId(s.id); setSchemaMenuAnchor(null) }}>
              <ListItemIcon>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: s.color_hex }} />
              </ListItemIcon>
              <ListItemText>{s.name}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
      </Box>
    </Box>
  )
}
