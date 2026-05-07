import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Box, Typography, Paper, TextField, Button, CircularProgress,
  Stack, Chip, LinearProgress, Alert, Divider, List, ListItemButton,
  ListItemText, Tooltip, IconButton, Badge,
} from '@mui/material'
import {
  SendOutlined, AutoAwesomeOutlined, HourglassEmptyOutlined,
  DownloadOutlined, PrintOutlined, ContentCopyOutlined,
  ArticleOutlined, DeleteOutlined, AccessTimeOutlined,
} from '@mui/icons-material'
import { useSnackbar } from 'notistack'
import * as XLSX from 'xlsx'
import { knowledgeApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type { AskSAIResult, AskSAIAnswered, AskSAIUnanswered } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface QARecord {
  id:        string
  question:  string
  result:    AskSAIResult
  timestamp: string
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sai-doc-history'

function loadHistory(): QARecord[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(h: QARecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-50)))
}

// ── Excel export ──────────────────────────────────────────────────────────────

function exportToExcel(records: QARecord[]) {
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
        'Sources':     '',
        'Confidence':  '',
        'Model':       '',
        'Tokens In':   '',
        'Tokens Out':  '',
        'Latency (ms)': '',
        'Timestamp':   new Date(r.timestamp).toLocaleString(),
      }
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['Question','Status','Answer','Sources','Confidence','Model','Tokens In','Tokens Out','Latency (ms)','Timestamp'],
  })

  // Header row style + column widths
  ws['!cols'] = [
    { wch: 50 },  // Question
    { wch: 12 },  // Status
    { wch: 80 },  // Answer
    { wch: 40 },  // Sources
    { wch: 12 },  // Confidence
    { wch: 18 },  // Model
    { wch: 10 },  // Tokens In
    { wch: 10 },  // Tokens Out
    { wch: 14 },  // Latency
    { wch: 22 },  // Timestamp
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ask SAI')
  XLSX.writeFile(wb, `ask-sai-${new Date().toISOString().slice(0, 10)}.xlsx`)
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
        .sources{margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px}
        .src-item{font-size:12px;color:#6b7280;padding:4px 0;border-bottom:1px solid #f3f4f6}
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
      <Alert severity="warning" icon={<HourglassEmptyOutlined />} sx={{ mt: 2 }}>
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
      {/* Document toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        {avgConfidence && (
          <Chip
            size="small"
            label={`${avgConfidence}% confidence`}
            sx={{ bgcolor: parseInt(avgConfidence) >= 70 ? tokens.emerald600 : tokens.amber500, color: '#fff', fontWeight: 600, fontSize: '0.72rem' }}
          />
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

      {/* Document body */}
      <Box sx={{
        borderLeft: '3px solid', borderColor: 'primary.main',
        pl: 2.5, py: 0.5, mb: 2,
      }}>
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

      {/* Sources */}
      {answered.sources.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            References ({answered.sources.length})
          </Typography>
          <Stack spacing={0.75} mt={0.75}>
            {answered.sources.map((s, idx) => (
              <Box key={s.chunk_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.disabled" sx={{ minWidth: 18 }}>[{idx + 1}]</Typography>
                <Chip label={s.entry_system} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{s.entry_title}</Typography>
                {s.topic && <Typography variant="caption" color="text.secondary">— {s.topic}</Typography>}
                <Box sx={{ width: 56 }}>
                  <LinearProgress
                    variant="determinate" value={s.score * 100}
                    sx={{ height: 3, borderRadius: 2, '& .MuiLinearProgress-bar': { bgcolor: tokens.emerald600 } }}
                  />
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

  const [history,    setHistory]    = useState<QARecord[]>(loadHistory)
  const [selected,   setSelected]   = useState<QARecord | null>(history[0] ?? null)
  const [inputText,  setInput]      = useState('')
  const [isLoading,  setLoading]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function buildHistoryPayload() {
    return history.slice(-6).map(r => ([
      { role: 'user',      content: r.question },
      { role: 'assistant', content: r.result.status === 'ANSWERED' ? (r.result as AskSAIAnswered).answer : '' },
    ])).flat()
  }

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
        history:    buildHistoryPayload(),
      })
      const record: QARecord = {
        id:        crypto.randomUUID(),
        question:  q,
        result,
        timestamp: new Date().toISOString(),
      }
      const updated = [record, ...history]
      setHistory(updated)
      saveHistory(updated)
      setSelected(record)
    } catch {
      enqueueSnackbar('Ask SAI request failed.', { variant: 'error' })
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleDelete(id: string) {
    const updated = history.filter(r => r.id !== id)
    setHistory(updated)
    saveHistory(updated)
    if (selected?.id === id) setSelected(updated[0] ?? null)
  }

  function handleClearAll() {
    if (!window.confirm('Clear all Ask SAI history?')) return
    setHistory([])
    setSelected(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel: History list ── */}
      <Box sx={{
        width: 280, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Sidebar header */}
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ArticleOutlined sx={{ fontSize: 18, color: 'primary.main' }} />
            <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>History</Typography>
            <Badge badgeContent={history.length} color="primary" max={99}>
              <Box />
            </Badge>
          </Stack>
        </Box>

        {/* History entries */}
        <List dense disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
          {history.length === 0 && (
            <Box sx={{ p: 2, textAlign: 'center', color: 'text.disabled' }}>
              <Typography variant="caption">No queries yet</Typography>
            </Box>
          )}
          {history.map(r => (
            <ListItemButton
              key={r.id}
              selected={selected?.id === r.id}
              onClick={() => setSelected(r)}
              sx={{ py: 1, px: 1.5, alignItems: 'flex-start', gap: 0.5,
                '&.Mui-selected': { bgcolor: 'primary.50', borderLeft: '3px solid', borderColor: 'primary.main', pl: 1 } }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <ListItemText
                  primary={r.question}
                  primaryTypographyProps={{ variant: 'caption', fontWeight: 600, noWrap: true }}
                  secondary={new Date(r.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  secondaryTypographyProps={{ variant: 'caption', fontSize: '0.65rem' }}
                />
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center" mt={0.25}>
                <Box sx={{
                  width: 8, height: 8, borderRadius: '50%',
                  bgcolor: r.result.status === 'ANSWERED' ? tokens.emerald600 : tokens.amber500,
                }} />
                <Tooltip title="Delete">
                  <IconButton size="small" onClick={e => { e.stopPropagation(); handleDelete(r.id) }}
                    sx={{ p: 0.25, opacity: 0.4, '&:hover': { opacity: 1 } }}>
                    <DeleteOutlined sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </ListItemButton>
          ))}
        </List>

        {/* Sidebar footer */}
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
          <Tooltip title="Export all to Excel">
            <span style={{ flex: 1 }}>
              <Button
                fullWidth size="small" variant="outlined"
                startIcon={<DownloadOutlined />}
                disabled={history.length === 0}
                onClick={() => exportToExcel(history)}
                sx={{ fontSize: '0.72rem' }}
              >
                Export Excel
              </Button>
            </span>
          </Tooltip>
          {history.length > 0 && (
            <Tooltip title="Clear all history">
              <IconButton size="small" onClick={handleClearAll} color="error" sx={{ flexShrink: 0 }}>
                <DeleteOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* ── Right panel: Document view ── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Query input bar */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <AutoAwesomeOutlined sx={{ color: 'primary.main', mt: 1, fontSize: 22 }} />
            <TextField
              inputRef={inputRef}
              fullWidth
              multiline
              maxRows={4}
              size="small"
              placeholder="Ask a question about business processes, reconciliation rules, system ownership, incidents…"
              value={inputText}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={isLoading}
            />
            <Tooltip title="Submit (Enter)">
              <span>
                <Button
                  variant="contained"
                  onClick={handleSend}
                  disabled={isLoading || !inputText.trim()}
                  sx={{ mt: 0.25, minWidth: 44, px: 1.5 }}
                >
                  {isLoading ? <CircularProgress size={18} color="inherit" /> : <SendOutlined />}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Box>

        {/* Document content area */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {!selected && !isLoading && (
            <Box sx={{ m: 'auto', textAlign: 'center', color: 'text.secondary', mt: 10 }}>
              <ArticleOutlined sx={{ fontSize: 64, opacity: 0.15, mb: 2 }} />
              <Typography variant="h6" fontWeight={600} gutterBottom>No document selected</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380, mx: 'auto', mb: 3 }}>
                Ask SAI a question to generate an intelligent document. Your query history appears on the left.
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
                {[
                  'Which team owns billing reconciliation failures?',
                  'What are the validation rules for missing policies?',
                  'How does the premium reconciliation process work?',
                ].map(s => (
                  <Chip key={s} label={s} size="small" variant="outlined" onClick={() => setInput(s)}
                    sx={{ cursor: 'pointer', fontSize: '0.72rem', maxWidth: 260,
                      height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5, lineHeight: 1.4 } }} />
                ))}
              </Stack>
            </Box>
          )}

          {isLoading && (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress size={32} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">SAI is generating your document…</Typography>
            </Paper>
          )}

          {selected && !isLoading && (
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
              {/* Document header */}
              <Box sx={{ mb: 2.5 }}>
                <Stack direction="row" alignItems="flex-start" spacing={1} mb={0.5}>
                  <ArticleOutlined sx={{ color: 'primary.main', fontSize: 20, mt: 0.25 }} />
                  <Typography variant="h6" fontWeight={700} sx={{ flex: 1, lineHeight: 1.3 }}>
                    {selected.question}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1.5} alignItems="center" ml={3.5}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <AccessTimeOutlined sx={{ fontSize: 13, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">
                      {new Date(selected.timestamp).toLocaleString()}
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label={selected.result.status}
                    sx={{
                      height: 18, fontSize: '0.65rem', fontWeight: 700,
                      bgcolor: selected.result.status === 'ANSWERED' ? tokens.emerald600 : tokens.amber500,
                      color: '#fff',
                    }}
                  />
                </Stack>
              </Box>

              <Divider sx={{ mb: 2.5 }} />

              <DocumentAnswer record={selected} />
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  )
}
